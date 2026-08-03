import AppKit
import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// CURSOR GUIDE — a cursor-anchored, no-grant, click-through instruction chip that
// rides the pointer and steps a human through a scripted checklist. Two modes:
//
//   • .tour  — onboarding / "show me how": each ⌃⌥ tap just ADVANCES. No result file.
//   • .test  — GUIDED TESTING (docs/GUIDED-TESTING.md): the human signals PASS / FAIL /
//              SKIP per step and the run writes a machine-readable ~/.relay/test-result.json
//              that Claude reads directly — closing the "Claude can't click the notch GUI,
//              so it waits on the human" gap.
//
// Everything here lives in ONE file and is fully self-contained: it owns its own
// borderless non-activating overlay window (same recipe as GodGlowView's `glow` panel),
// its own 30fps NSEvent.mouseLocation cursor poll (a free read — no Accessibility /
// Input-Monitoring grant), and its own passive .flagsChanged / .keyDown monitors that
// are installed ONLY while a run is active. It reuses the module's design tokens
// (Color.lime, SB, SBr, Font.label/hanken, …) but touches nothing in RelayMenuBar.swift.
//
// It stays dormant until a trigger file appears, so it can never disturb the running app.
// Trigger it by writing ~/.relay/guide-run.json (or the ~/.relay/test-run.json alias).
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Model

enum GuideMode: String { case tour, test }

struct GuideStep {
    let id: String
    let text: String
    let hint: String?   // optional dim second line (the schema's `hint` / `expect`)
}

// A screenshot and/or a note the human left on a step during a guide run. Both optional and
// independent — a step may have a shot, a note, both, or (the common case) neither.
struct StepFeedback {
    var screenshot: String?   // absolute path to an fn-drag jpg (in NSTemporaryDirectory)
    var note: String?         // raw typed + dictated text, no cleanup
    var isEmpty: Bool { (screenshot?.isEmpty ?? true) && (note?.isEmpty ?? true) }
}

struct GuideResult {
    let id: String
    let text: String
    var verdict: String   // "pass" | "fail" | "skipped" | "unrun" | "done" (tour)
    var notedAt: Date?
    var feedback: StepFeedback? = nil   // set by the feedback-capture flow (fn-drag shot + typed/dictated note)
}

enum GuideFlash { case pass, fail, skip, next, back }

/// The overlay's observable payload — the caption view watches this; the controller writes it.
@MainActor
final class GuideOverlayModel: ObservableObject {
    @Published var visible = false
    @Published var cursor: CGPoint = .zero      // overlay-view (top-left) coords, synced to the mouse
    @Published var screenSize: CGSize = .zero    // for the screen-edge clamp
    @Published var mode: GuideMode = .tour
    @Published var title: String? = nil          // optional guide title, shown dim in the kicker
    @Published var text: String = ""
    @Published var hint: String? = nil
    @Published var progress: String = ""         // "3/8"
    @Published var canBack = false               // idx > 0 → the Back chip appears
    @Published var flash: GuideFlash? = nil       // brief ✓/✗ confirmation that a signal landed
    @Published var done: String? = nil            // non-nil → show the completion summary card
    @Published var reduceMotion = false
}

// MARK: - The caption chip (rides the cursor)

/// A small frosted/dark chip anchored below-right of the pointer, click-through, lime-accented.
/// Flips to the other side of the pointer near a screen edge. Honors reduce-motion (no pulsing).
struct GuideCaptionView: View {
    @ObservedObject var m: GuideOverlayModel
    private let cardW: CGFloat = 300
    private let estH: CGFloat = 96   // nominal card height, used only to pick the flip side

    // Top-left origin of the card in overlay coords, clamped to the screen frame.
    private func origin() -> CGPoint {
        var x = m.cursor.x + 18
        var y = m.cursor.y + 22
        let W = m.screenSize.width, H = m.screenSize.height
        if W > 0, x + cardW > W - 8 { x = m.cursor.x - 18 - cardW }   // flip left
        if H > 0, y + estH > H - 8 { y = m.cursor.y - 22 - estH }      // flip up
        return CGPoint(x: max(8, x), y: max(8, y))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            if m.visible {
                card
                    .frame(width: cardW, alignment: .leading)
                    .offset(x: origin().x, y: origin().y)
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private var card: some View {
        if let summary = m.done {
            summaryCard(summary)
        } else {
            stepCard
        }
    }

    // The action chips available for the current step + mode. Primary (Pass/Next) is lime.
    // Back is hidden on step 1 (nothing to go back to); Fail only exists in test mode.
    private var actions: [(combo: String, label: String, primary: Bool)] {
        var a: [(String, String, Bool)] = []
        if m.mode == .test {
            a.append(("fn →", "Pass", true))
            a.append(("fn ←", "Fail", false))
        } else {
            a.append(("fn →", "Next", true))
        }
        if m.canBack { a.append(("fn ↑", "Back", false)) }
        a.append(("esc", "Close", false))
        return a.map { (combo: $0.0, label: $0.1, primary: $0.2) }
    }

    private var stepCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            // kicker: N/total + optional guide title
            HStack(spacing: 7) {
                Text(m.progress)
                    .font(.splMono(9.5))
                    .foregroundColor(.lime)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: SBr.xs).fill(Color.lime.opacity(0.14)))
                    .overlay(RoundedRectangle(cornerRadius: SBr.xs).stroke(Color.lime.opacity(0.35), lineWidth: 1))
                if let t = m.title, !t.isEmpty {
                    Text(t.uppercased())
                        .font(.splMono(8.5))
                        .tracking(0.6)
                        .foregroundColor(.inkFaint)
                        .lineLimit(1).truncationMode(.tail)
                }
                Spacer(minLength: 0)
            }
            // the instruction — the readable line
            Text(m.text)
                .font(.hanken(13, .medium))
                .foregroundColor(.ink)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let h = m.hint, !h.isEmpty {
                Text(h)
                    .font(.hanken(11, .regular))
                    .foregroundColor(.inkDim)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // keycap action chips — one per available action
            HStack(spacing: 5) {
                ForEach(Array(actions.enumerated()), id: \.offset) { _, act in
                    GuideActionChip(combo: act.combo, label: act.label, primary: act.primary)
                }
            }
            .padding(.top, 1)
        }
        .padding(.horizontal, SB.s3).padding(.vertical, SB.s3)
        .background(chipBackground)
        .overlay(alignment: .topTrailing) { flashBadge }
    }

    private func summaryCard(_ summary: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 13)).foregroundColor(.lime)
            Text(summary)
                .font(.hanken(11.5, .medium)).foregroundColor(.ink)
                .lineLimit(4).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, SB.s3).padding(.vertical, SB.s2 + 2)
        .background(chipBackground)
    }

    private var chipBackground: some View {
        RoundedRectangle(cornerRadius: SBr.sm)
            .fill(Color.panel.opacity(0.98))
            .overlay(RoundedRectangle(cornerRadius: SBr.sm).stroke(Color.lime.opacity(0.45), lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 12, x: 0, y: 6)
    }

    @ViewBuilder private var flashBadge: some View {
        if let f = m.flash {
            let (sym, col): (String, Color) = {
                switch f {
                case .pass, .next: return ("checkmark", .lime)
                case .fail:        return ("xmark", .danger)
                case .skip:        return ("arrow.right.to.line", .inkDim)
                case .back:        return ("arrow.uturn.left", .inkDim)
                }
            }()
            Image(systemName: sym)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.page)
                .frame(width: 20, height: 20)
                .background(Circle().fill(col))
                .offset(x: 7, y: -7)
                .transition(.opacity)
        }
    }
}

/// A keycap-style action indicator: the key(s) to press rendered as a little keycap, plus its label.
/// Primary (Pass/Next) wears the lime accent; the rest are ghost. Purely visual (the caption is click-through).
struct GuideActionChip: View {
    let combo: String   // e.g. "fn →", "esc"
    let label: String   // e.g. "Pass", "Close"
    let primary: Bool
    var body: some View {
        HStack(spacing: 4) {
            Text(combo)
                .font(.splMono(9.5))
                .foregroundColor(primary ? .page : .ink)
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4).fill(primary ? Color.lime : Color.raised)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(primary ? Color.clear : Color.edge, lineWidth: 1))
                )
            Text(label)
                .font(.hanken(10, .medium))
                .foregroundColor(primary ? .lime : .inkDim)
        }
    }
}

// MARK: - The controller

@MainActor
final class CursorGuide {
    static let shared = CursorGuide()
    private init() {}

    /// True while a run is active. The main app reads this to SUPPRESS ⌃⌥ dictation and ⌃⌃
    /// summon during a run (add the one-line guard shown in the integration notes).
    private(set) var isActive = false

    // ── Feedback capture ─────────────────────────────────────────────────────
    // True while the human is leaving a screenshot/note on a step. The main app reads this to route a
    // ⌃⌥ dictation transcript to the note (instead of pasting) and to raise the notch input surface.
    private(set) var capturingFeedback = false
    private var feedbackIdx: Int? = nil          // the result index the capture attaches to

    // Wired ONCE by RelayController at launch (it owns the capture UI). CursorGuide has no notch/mouse
    // access of its own, so it delegates the UI and just receives the artifacts back.
    var onFeedbackBegin: ((_ stepId: String) -> Void)?   // raise fn-drag capture + the notch note field
    var onFeedbackEnd:   (() -> Void)?                    // tear the capture UI down

    // Enter capture for the CURRENT step. The verdict is already set by the time this runs, so it
    // never changes it — it just opens capture.
    private func beginFeedback() {
        guard isActive, idx < results.count, !capturingFeedback else { return }
        capturingFeedback = true
        feedbackIdx = idx
        if results[idx].feedback == nil { results[idx].feedback = StepFeedback() }
        onFeedbackBegin?(results[idx].id)
    }

    // RelayController pushes the fn-drag jpg here as soon as a region is grabbed.
    func attachFeedbackScreenshot(_ path: String) {
        guard capturingFeedback, let i = feedbackIdx, i < results.count else { return }
        var fb = results[i].feedback ?? StepFeedback()
        fb.screenshot = path
        results[i].feedback = fb
    }

    // RelayController pushes typed/dictated text here. Dictation may fire twice (two ⌃⌥ holds); APPEND so
    // a second utterance doesn't clobber the first. Typing replaces via the panel's commit.
    func attachFeedbackNote(_ text: String, append: Bool = false) {
        guard capturingFeedback, let i = feedbackIdx, i < results.count else { return }
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        var fb = results[i].feedback ?? StepFeedback()
        if append, let existing = fb.note, !existing.isEmpty { fb.note = existing + " " + t }
        else { fb.note = t }
        results[i].feedback = fb
    }

    // Save what's staged and move on. Called on ↵ / fn→ from the notch field.
    func commitFeedback() {
        guard capturingFeedback, let i = feedbackIdx else { return }
        if let fb = results[i].feedback, fb.isEmpty { results[i].feedback = nil }   // nothing staged → no key
        endFeedback()
        advance()
    }

    // Discard the in-progress shot/note (KEEP the verdict) and move on. Called on esc.
    func cancelFeedback() {
        guard capturingFeedback, let i = feedbackIdx else { return }
        results[i].feedback = nil
        endFeedback()
        advance()
    }

    private func endFeedback() {
        capturingFeedback = false
        feedbackIdx = nil
        onFeedbackEnd?()
    }

    private let model = GuideOverlayModel()
    private var overlay: NSPanel?
    private var hosting: NSHostingView<GuideCaptionView>?

    private var watchTimer: Timer?
    private var cursorTimer: Timer?
    private var flashTimer: Timer?
    private var flagsMonitorG: Any?
    private var flagsMonitorL: Any?
    private var keyMonitorG: Any?
    private var keyMonitorL: Any?

    // ── run state
    private var mode: GuideMode = .tour
    private var title = ""
    private var steps: [GuideStep] = []
    private var idx = 0
    private var results: [GuideResult] = []
    private var startedAt = Date()

    // ── chord edge-detect (⌃⌥ down → release = one signal; +⇧ while held = fail)
    private var chordDown = false
    private var chordHadShift = false

    private var relayDir: String { RELAY_DIR }
    private func rel(_ f: String) -> String { (relayDir as NSString).appendingPathComponent(f) }
    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()

    // ─────────────────────────────────────────────────────────────────────────
    // Install — start the (always-on, cheap) trigger-file watcher. Call once from
    // applicationDidFinishLaunching. Polling a file that isn't there is a no-op, so
    // the controller is genuinely dormant until a run is written.
    // ─────────────────────────────────────────────────────────────────────────
    func install() {
        watchTimer?.invalidate()
        watchTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.pollTrigger() }
        }
        NSLog("[cursor-guide] watcher armed — write ~/.relay/guide-run.json (or test-run.json) to start")
    }

    private func pollTrigger() {
        // guide-run.json (mode from its `mode` field, default .tour) OR test-run.json (implies .test).
        let fm = FileManager.default
        let guidePath = rel("guide-run.json")
        let testPath  = rel("test-run.json")
        if fm.fileExists(atPath: guidePath) {
            let obj = readJSON(guidePath)
            try? fm.removeItem(atPath: guidePath)            // consume so a re-write re-triggers
            begin(obj, defaultMode: .tour)
        } else if fm.fileExists(atPath: testPath) {
            let obj = readJSON(testPath)
            try? fm.removeItem(atPath: testPath)
            begin(obj, defaultMode: .test)
        }
    }

    // MARK: parse + start

    private func begin(_ raw: Any?, defaultMode: GuideMode) {
        guard let obj = raw as? [String: Any] else { logMalformed(); return }
        let m = GuideMode(rawValue: (obj["mode"] as? String) ?? "") ?? defaultMode
        let title = (obj["title"] as? String) ?? "Untitled"
        guard let rawSteps = obj["steps"] as? [[String: Any]], !rawSteps.isEmpty else { logMalformed(); return }
        var parsed: [GuideStep] = []
        for (i, s) in rawSteps.enumerated() {
            // `text` is the field; `instruction` is accepted as an alias (matches the spec's schema).
            guard let text = (s["text"] as? String) ?? (s["instruction"] as? String), !text.isEmpty else { continue }
            let id: String
            if let sid = s["id"] as? String { id = sid }
            else if let nid = s["id"] as? Int { id = String(nid) }
            else { id = "step-\(i + 1)" }
            // `hint` is the field; `expect` is accepted as an alias.
            let hint = (s["hint"] as? String) ?? (s["expect"] as? String)
            parsed.append(GuideStep(id: id, text: text, hint: hint))
        }
        guard !parsed.isEmpty else { logMalformed(); return }

        if isActive { abort(reason: "superseded") }   // last-writer-wins re-entry

        self.mode = m
        self.title = title
        self.steps = parsed
        self.idx = 0
        self.results = parsed.map { GuideResult(id: $0.id, text: $0.text, verdict: "unrun", notedAt: nil) }
        self.startedAt = Date()
        self.isActive = true

        ensureOverlay()
        installMonitors()
        model.mode = m
        model.done = nil
        model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        showStep()
        showOverlay()
        startCursorTimer()
        NSLog("[cursor-guide] START mode=\(m.rawValue) title=\"\(title)\" steps=\(parsed.count)")
    }

    private func logMalformed() {
        NSLog("[cursor-guide] trigger malformed — ignored (need {title, steps:[{text|instruction}]})")
    }

    private func showStep() {
        guard idx >= 0, idx < steps.count else { return }
        let s = steps[idx]
        model.done = nil
        model.text = s.text
        model.hint = s.hint
        model.progress = "\(idx + 1)/\(steps.count)"
        model.canBack = idx > 0
    }

    // MARK: signals

    private func handleAdvance(fail: Bool) {
        guard isActive, idx < steps.count, !capturingFeedback else { return }
        if mode == .test {
            record(verdict: fail ? "fail" : "pass")
            flash(fail ? .fail : .pass)
            if fail { beginFeedback(); return }   // pause on the step; commit/cancel advances
        } else {
            results[idx].verdict = "done"; results[idx].notedAt = Date()
            flash(.next)
        }
        advance()
    }

    private func goBack() {
        guard isActive, idx > 0 else { return }
        // step back re-opens the previous step; clear the verdict we're returning to so re-answering overwrites.
        idx -= 1
        results[idx].verdict = mode == .test ? "unrun" : "done"
        results[idx].notedAt = nil
        results[idx].feedback = nil            // re-answering a step overwrites its feedback too
        flash(.back)
        showStep()
    }

    private func record(verdict: String) {
        guard idx < results.count else { return }
        results[idx].verdict = verdict
        results[idx].notedAt = Date()
        flushProgress()
    }

    private func advance() {
        idx += 1
        if idx >= steps.count { finish(outcome: "completed") }
        else { showStep() }
    }

    private func flash(_ f: GuideFlash) {
        model.flash = f
        flashTimer?.invalidate()
        flashTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.model.flash = nil }
        }
    }

    // MARK: finish / abort

    private func abort(reason: String) {
        guard isActive else { return }
        if capturingFeedback { capturingFeedback = false; feedbackIdx = nil; onFeedbackEnd?() }  // tear down any in-flight capture
        // Any not-yet-verdicted step becomes "skipped" (unrun in the file's terms → skipped on abort).
        for i in idx..<results.count where results[i].verdict == "unrun" { results[i].verdict = "skipped" }
        finish(outcome: "aborted")
        NSLog("[cursor-guide] ABORT (\(reason))")
    }

    private func finish(outcome: String) {
        let finishedAt = Date()
        let passed = results.filter { $0.verdict == "pass" }.count
        let failed = results.filter { $0.verdict == "fail" }.count
        let skipped = results.filter { $0.verdict == "skipped" }.count

        // Always emit ~/.relay/guide-result.json (BOTH modes) so the daemon's `guide_run` capability can
        // read the outcome and return it to the calling Claude (onboarding/tour completions included).
        // Test mode additionally emits the test-result.json/.txt twins + the on-screen summary card.
        writeResult(outcome: outcome, finishedAt: finishedAt, passed: passed, failed: failed, skipped: skipped)
        if mode == .test {
            writeResultText(passed: passed, failed: failed, skipped: skipped)
            let line = "\(title) — \(passed) passed · \(failed) failed · \(skipped) skipped"
            NSLog("[cursor-guide] DONE \(outcome): \(line) → ~/.relay/guide-result.json")
            showCompletion(line)
        } else {
            NSLog("[cursor-guide] DONE \(outcome): tour \"\(title)\" (\(results.count) steps) → ~/.relay/guide-result.json")
            teardown()
        }
    }

    private func writeResult(outcome: String, finishedAt: Date, passed: Int, failed: Int, skipped: Int) {
        var stepDicts: [[String: Any]] = []
        for r in results {
            var d: [String: Any] = [
                "id": r.id,
                "text": r.text,
                "verdict": r.verdict,
                "notedAt": r.notedAt.map { iso.string(from: $0) } ?? NSNull(),
            ]
            if let fb = r.feedback, !fb.isEmpty {
                var fbo: [String: Any] = [:]
                if let s = fb.screenshot, !s.isEmpty { fbo["screenshot"] = s }
                if let n = fb.note, !n.isEmpty { fbo["note"] = n }
                d["feedback"] = fbo
            }
            stepDicts.append(d)
        }
        let out: [String: Any] = [
            "title": title,
            "mode": mode.rawValue,
            "outcome": outcome,
            "startedAt": iso.string(from: startedAt),
            "finishedAt": iso.string(from: finishedAt),
            "passed": passed, "failed": failed, "skipped": skipped, "total": results.count,
            "results": stepDicts,
        ]
        writeAtomic(out, to: rel("guide-result.json"))               // unified result the daemon reads (both modes)
        if mode == .test { writeAtomic(out, to: rel("test-result.json")) }  // back-compat twin for the direct file path
    }

    private func writeResultText(passed: Int, failed: Int, skipped: Int) {
        var lines = ["\(title) — \(passed) passed · \(failed) failed · \(skipped) skipped"]
        for r in results {
            let mark: String
            switch r.verdict {
            case "pass": mark = "✓"
            case "fail": mark = "✗"
            case "skipped": mark = "–"
            default: mark = "·"
            }
            lines.append("  \(mark) \(r.id)")
        }
        try? (lines.joined(separator: "\n") + "\n").data(using: .utf8)?.write(to: URL(fileURLWithPath: rel("test-result.txt")), options: .atomic)
    }

    // Crash-safe progress flush each verdict (a tail still shows where the run got to).
    private func flushProgress() {
        let verdicts = results.map { $0.verdict }
        let obj: [String: Any] = ["i": idx, "total": steps.count, "title": title, "verdicts": verdicts]
        writeAtomic(obj, to: rel("test-progress.json"))
    }

    private func writeAtomic(_ obj: [String: Any], to path: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) else { return }
        try? data.write(to: URL(fileURLWithPath: path), options: .atomic)   // .atomic = temp-write + rename
    }

    private func showCompletion(_ line: String) {
        model.done = line
        // Hold the summary card by the cursor briefly, then tear down.
        flashTimer?.invalidate()
        Timer.scheduledTimer(withTimeInterval: 2.2, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.teardown() }
        }
    }

    private func teardown() {
        isActive = false
        model.visible = false
        model.done = nil
        model.flash = nil
        overlay?.orderOut(nil)
        stopCursorTimer()
        removeMonitors()
    }

    // MARK: overlay window (borderless, non-activating, click-through — the glow recipe)

    private func ensureOverlay() {
        guard overlay == nil, let screen = NSScreen.main else {
            if let scr = NSScreen.main { overlay?.setFrame(scr.frame, display: false); model.screenSize = scr.frame.size }
            return
        }
        let host = NoInsetHostingView(rootView: GuideCaptionView(m: model))
        let panel = NotchPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .screenSaver
        panel.ignoresMouseEvents = true      // pure guide — the human clicks THROUGH it onto the real UI
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.contentView = host
        panel.setFrame(screen.frame, display: false)
        panel.orderOut(nil)
        self.overlay = panel
        self.hosting = host
        model.screenSize = screen.frame.size
    }

    private func showOverlay() {
        guard let panel = overlay else { return }
        if let scr = NSScreen.main { panel.setFrame(scr.frame, display: false); model.screenSize = scr.frame.size }
        updateCursor()
        model.visible = true
        panel.orderFrontRegardless()
    }

    private func startCursorTimer() {
        cursorTimer?.invalidate()
        cursorTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateCursor() }
        }
    }
    private func stopCursorTimer() { cursorTimer?.invalidate(); cursorTimer = nil }

    private func updateCursor() {
        guard let screen = NSScreen.main else { return }
        let p = NSEvent.mouseLocation                                   // global, bottom-left origin
        model.cursor = CGPoint(x: p.x - screen.frame.minX, y: screen.frame.maxY - p.y)   // → overlay top-left
    }

    // MARK: passive monitors (installed ONLY while active — no new grant)

    private func installMonitors() {
        removeMonitors()
        chordDown = false; chordHadShift = false
        flagsMonitorG = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged]) { [weak self] ev in
            MainActor.assumeIsolated { self?.onFlags(ev.modifierFlags) }
        }
        flagsMonitorL = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged]) { [weak self] ev in
            MainActor.assumeIsolated { self?.onFlags(ev.modifierFlags) }; return ev
        }
        keyMonitorG = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] ev in
            MainActor.assumeIsolated { _ = self?.onKey(ev.keyCode, ev.modifierFlags) }
        }
        keyMonitorL = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] ev in
            var swallow = false
            MainActor.assumeIsolated { swallow = self?.onKey(ev.keyCode, ev.modifierFlags) ?? false }
            return swallow ? nil : ev
        }
    }

    private func removeMonitors() {
        for mon in [flagsMonitorG, flagsMonitorL, keyMonitorG, keyMonitorL] { if let m = mon { NSEvent.removeMonitor(m) } }
        flagsMonitorG = nil; flagsMonitorL = nil; keyMonitorG = nil; keyMonitorL = nil
    }

    // No-op: guide signals moved to fn+arrow keys (onKey) so they never collide with ⌃⌥ dictation, which
    // stays live during a guide for spoken feedback. Kept as a hook so the flags monitors have a target.
    private func onFlags(_ flags: NSEvent.ModifierFlags) { }

    // fn+arrow signals. On a Mac laptop fn+arrow arrives as Home/End/PageUp; we also accept the raw arrow
    // keyCodes when .function is present (external keyboards). Esc closes. ⌃⌥ dictation is left untouched.
    @discardableResult private func onKey(_ keyCode: UInt16, _ flags: NSEvent.ModifierFlags) -> Bool {
        guard isActive else { return false }
        // While capturing feedback, the notch input panel is key and owns ↵/esc (RelayMenuBar
        // showFeedbackNote). CursorGuide's global monitor must NOT also act on those, or esc double-fires
        // (cancel here AND abort). Swallow keys so they can't leak to the app, but take no action.
        if capturingFeedback { return true }
        let fn = flags.contains(.function)
        switch keyCode {
        case 53: abort(reason: "esc"); return true                                     // Esc — Close
        case 119: handleAdvance(fail: false); return true                              // End (fn →) — Pass/Next
        case 124 where fn: handleAdvance(fail: false); return true                     // → +fn
        case 115: if mode == .test { handleAdvance(fail: true) }; return true          // Home (fn ←) — Fail
        case 123 where fn: if mode == .test { handleAdvance(fail: true) }; return true // ← +fn
        case 116: goBack(); return true                                                // PageUp (fn ↑) — Back
        case 126 where fn: goBack(); return true                                       // ↑ +fn
        case 121: if mode == .test { beginFeedback() }; return true                    // PageDown (fn ↓) — Note (any verdict)
        case 125 where fn: if mode == .test { beginFeedback() }; return true           // ↓ +fn
        default: return false
        }
    }
}
