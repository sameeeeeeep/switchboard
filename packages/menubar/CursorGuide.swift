import AppKit
import SwiftUI
import Vision
import CoreGraphics

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

enum GuideMode: String { case tour, test, teach }

struct GuideStep {
    let id: String
    let text: String
    let hint: String?   // optional dim second line (the schema's `hint` / `expect`)
    // ── teach-mode additions (all optional; absent → behaves exactly like a tour/test step) ──
    var say: String? = nil          // line to speak (falls back to `text`)
    var point: CGPoint? = nil       // overlay top-left coords (already mapped from shot pixels in begin())
    var copy: String? = nil         // clipboard payload to pre-load when the step shows (opt-in via autoClipboard)
    var hold: Double? = nil         // ms to dwell before auto-advancing (teach only)
    var doneWhen: Predicate? = nil  // locally-sensed completion condition → auto-advance
    var timeoutMs: Double? = nil    // after this long, stop watching doneWhen and fall back to manual-only
}

// A locally-decidable completion condition. Either a boolean combinator (any/all) or a leaf that the
// CursorGuide watcher evaluates against a fresh AmbientSignal (+ bounded AX / local Vision OCR). A
// mis-authored predicate can NEVER wedge the user: manual fn→ always advances regardless.
indirect enum Predicate {
    case any([Predicate])
    case all([Predicate])
    case appFrontmost(bundleId: String)
    case windowTitleMatches(pattern: String, mode: String)   // mode: contains | regex | equals
    case urlHostIs(host: String, pathContains: String?)
    case fieldFocused
    case fieldNonEmpty
    case fieldContains(text: String?, regex: String?)
    case elementExists(role: String, titleContains: String?, enabled: Bool?)
    case checkboxState(titleContains: String, checked: Bool)
    case onScreenTextAppeared(text: String?, regex: String?, region: CGRect?)   // LOCAL Apple Vision OCR
    case unknown   // unrecognized leaf → never satisfied (manual-only), never crashes

    /// Parse a predicate from the JSON schema. Returns nil only for a non-object; unknown leaves
    /// decode to `.unknown` so a typo degrades to manual-only rather than aborting the whole run.
    static func parse(_ raw: Any?) -> Predicate? {
        guard let d = raw as? [String: Any] else { return nil }
        if let arr = d["any"] as? [[String: Any]] { return .any(arr.compactMap { parse($0) }) }
        if let arr = d["all"] as? [[String: Any]] { return .all(arr.compactMap { parse($0) }) }
        guard let kind = d["kind"] as? String else { return .unknown }
        switch kind {
        case "app-frontmost":
            return .appFrontmost(bundleId: (d["bundleId"] as? String) ?? "")
        case "window-title-matches":
            return .windowTitleMatches(pattern: (d["pattern"] as? String) ?? "",
                                       mode: (d["mode"] as? String) ?? "contains")
        case "url-host-is":
            return .urlHostIs(host: (d["host"] as? String) ?? "", pathContains: d["pathContains"] as? String)
        case "field-focused":
            return .fieldFocused
        case "field-non-empty":
            return .fieldNonEmpty
        case "field-contains":
            return .fieldContains(text: d["text"] as? String, regex: d["regex"] as? String)
        case "element-exists":
            return .elementExists(role: (d["role"] as? String) ?? "",
                                  titleContains: d["titleContains"] as? String,
                                  enabled: d["enabled"] as? Bool)
        case "checkbox-state":
            return .checkboxState(titleContains: (d["titleContains"] as? String) ?? "",
                                  checked: (d["checked"] as? Bool) ?? true)
        case "on-screen-text-appeared":
            var region: CGRect? = nil
            if let r = d["region"] as? [String: Any],
               let x = (r["x"] as? NSNumber)?.doubleValue, let y = (r["y"] as? NSNumber)?.doubleValue,
               let w = (r["w"] as? NSNumber)?.doubleValue, let h = (r["h"] as? NSNumber)?.doubleValue {
                region = CGRect(x: x, y: y, width: w, height: h)
            }
            return .onScreenTextAppeared(text: d["text"] as? String, regex: d["regex"] as? String, region: region)
        default:
            return .unknown
        }
    }

    /// True if any leaf in this predicate tree is an OCR check (drives the async Vision path).
    var needsOCR: Bool {
        switch self {
        case .any(let ps), .all(let ps): return ps.contains { $0.needsOCR }
        case .onScreenTextAppeared: return true
        default: return false
        }
    }
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
    @Published var target: CGPoint? = nil         // teach mode: overlay-coords point to ring + anchor the chip to (nil = ride the cursor)
    // Spoken voiceover on/off — persisted so it's a durable preference; toggled live with fn m.
    @Published var muted: Bool = UserDefaults.standard.bool(forKey: "relay.guide.muted")
}

// MARK: - The caption chip (rides the cursor)

/// A small frosted/dark chip anchored below-right of the pointer, click-through, lime-accented.
/// Flips to the other side of the pointer near a screen edge. Honors reduce-motion (no pulsing).
struct GuideCaptionView: View {
    @ObservedObject var m: GuideOverlayModel
    @State private var ringPulse = false
    private let cardW: CGFloat = 300
    private let estH: CGFloat = 96   // nominal card height, used only to pick the flip side

    // The point the chip hangs off: the marked target in teach mode, else the live cursor.
    private var anchor: CGPoint { m.target ?? m.cursor }

    // Top-left origin of the card in overlay coords, clamped to the screen frame.
    private func origin() -> CGPoint {
        let a = anchor
        var x = a.x + 18
        var y = a.y + 22
        let W = m.screenSize.width, H = m.screenSize.height
        if W > 0, x + cardW > W - 8 { x = a.x - 18 - cardW }   // flip left
        if H > 0, y + estH > H - 8 { y = a.y - 22 - estH }      // flip up
        return CGPoint(x: max(8, x), y: max(8, y))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            // Teach-mode pointer ring — the SAME pulsing lime circle GodGlowView draws, so God and the
            // guide share one visual vocabulary. The pulse is gated on reduce-motion (falls to a still ring).
            if m.visible, let t = m.target {
                Circle().stroke(Color.lime.opacity(0.85), lineWidth: 2)
                    .frame(width: 40, height: 40)
                    .scaleEffect(m.reduceMotion ? 1.0 : (ringPulse ? 1.12 : 0.82))
                    .opacity(m.reduceMotion ? 0.9 : (ringPulse ? 0.3 : 0.95))
                    .animation(m.reduceMotion ? nil : .easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: ringPulse)
                    .position(t)
            }
            if m.visible {
                card
                    .frame(width: cardW, alignment: .leading)
                    .offset(x: origin().x, y: origin().y)
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear { ringPulse = true }
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
        a.append(("fn ↓", "Feedback", false))   // screenshot + note, any mode
        a.append(("fn m", m.muted ? "Unmute" : "Mute", false))
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
                // voiceover state — at-a-glance speaker icon (toggle with fn m)
                Image(systemName: m.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 9))
                    .foregroundColor(m.muted ? .inkFaint : .lime)
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

    // Spoken concierge: RelayController wires these to God's voice (Pocket-TTS on :7897, macOS say
    // fallback). In .tour AND .teach mode each step is read aloud as it appears, so the guide talks you through it.
    var onSpeak: ((String) -> Void)?     // speak a line (interrupts any in-flight speech)
    var onStopSpeak: (() -> Void)?       // silence on teardown/abort

    // Teach mode senses locally. CursorGuide owns no sensor, so RelayController injects a closure that
    // returns a fresh AmbientSignal (frontmost app / window title / url / focused-field value). The
    // doneWhen watcher samples this to decide when a step is locally "done". nil → AX predicates no-op
    // (manual-only), which is a safe degrade, never a wedge.
    var sampleSignal: (() -> AmbientSignal?)?

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
    private var doneTimer: Timer?          // ~4Hz doneWhen watcher (teach)
    private var holdTimer: Timer?          // dwell-then-auto-advance (teach `hold`)
    private var timeoutTimer: Timer?       // per-step doneWhen timeout → drop to manual-only
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

    // ── teach run state
    private var autoClipboard = false
    private var savedClipboard: String?      // the user's clipboard before the run — restored on end/abort
    private var doneStreak = 0               // consecutive satisfied ticks (debounce: advance on 2)
    private var ocrInFlight = false          // one Vision pass at a time
    private var ocrMatched = false           // last OCR verdict for the current step
    private var ocrStepIdx = -1              // which step the cached ocrMatched belongs to

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

        // Run-level: shot describes the pixel space the step `point`s live in; autoClipboard opts into
        // pre-loading the clipboard from each step's `copy`. Both optional (default: main-screen points).
        let autoClip = (obj["autoClipboard"] as? Bool) ?? false
        let mapper = pointMapper(shot: obj["shot"] as? [String: Any])

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
            var step = GuideStep(id: id, text: text, hint: hint)
            // ── teach fields (all optional) ──
            step.say = s["say"] as? String
            step.copy = s["copy"] as? String
            if let h = (s["hold"] as? NSNumber)?.doubleValue { step.hold = h }
            if let t = (s["timeoutMs"] as? NSNumber)?.doubleValue { step.timeoutMs = t }
            if let p = s["point"] as? [String: Any],
               let px = (p["x"] as? NSNumber)?.doubleValue, let py = (p["y"] as? NSNumber)?.doubleValue {
                step.point = mapper(CGPoint(x: px, y: py))
            }
            step.doneWhen = Predicate.parse(s["doneWhen"])
            parsed.append(step)
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
        self.autoClipboard = autoClip
        // Preserve the user's clipboard for the whole run when we're going to overwrite it per step.
        if autoClip { savedClipboard = NSPasteboard.general.string(forType: .string) }

        ensureOverlay()
        installMonitors()
        model.mode = m
        model.done = nil
        model.target = nil
        model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        showStep()
        showOverlay()
        startCursorTimer()
        NSLog("[cursor-guide] START mode=\(m.rawValue) title=\"\(title)\" steps=\(parsed.count) autoClipboard=\(autoClip)")
    }

    // Build a pixel→overlay-point mapper from the run's `shot`. The overlay fills the main screen in
    // TOP-LEFT points; a screenshot is TOP-LEFT pixels of size shot{w,h}. So map by the axis scale
    // (screenPoints / shotPixels). No shot → the point is already in main-screen points (identity+clamp).
    // (This mirrors the RelayMenuBar ~L4981 intent — land a model/user point in the overlay's coord space.)
    private func pointMapper(shot: [String: Any]?) -> (CGPoint) -> CGPoint {
        let screen = NSScreen.main?.frame.size ?? CGSize(width: 1440, height: 900)
        var sx = 1.0, sy = 1.0
        if let shot = shot,
           let w = (shot["w"] as? NSNumber)?.doubleValue, w > 0,
           let h = (shot["h"] as? NSNumber)?.doubleValue, h > 0 {
            sx = screen.width / w
            sy = screen.height / h
        }
        return { raw in
            let x = min(max(0, raw.x * sx), screen.width)
            let y = min(max(0, raw.y * sy), screen.height)
            return CGPoint(x: x, y: y)
        }
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
        model.target = s.point        // teach: point the ring + anchor the chip; nil → chip rides the cursor
        // The concierge reads the step aloud in tour AND teach (say overrides text); test stays silent.
        if (mode == .tour || mode == .teach) && !model.muted { onSpeak?(s.say ?? s.text) }
        // Pre-load the clipboard with this step's paste payload (opt-in; user's clipboard is restored on end).
        if autoClipboard, let c = s.copy {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(c, forType: .string)
        }
        armStepWatchers()
    }

    // (Re)arm the per-step teach timers: a dwell auto-advance (`hold`) and the ~4Hz doneWhen watcher.
    // Both are always superseded by manual fn→/esc, and by the next showStep(). No-ops outside teach.
    private func armStepWatchers() {
        holdTimer?.invalidate(); holdTimer = nil
        doneTimer?.invalidate(); doneTimer = nil
        timeoutTimer?.invalidate(); timeoutTimer = nil
        doneStreak = 0
        ocrMatched = false; ocrStepIdx = idx
        guard idx < steps.count else { return }
        let s = steps[idx]
        // Dwell-then-advance: a purely timed step (e.g. "watch this happen for 3s"). Teach-only.
        if mode == .teach, let ms = s.hold, ms > 0 {
            holdTimer = Timer.scheduledTimer(withTimeInterval: ms / 1000.0, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.handleAdvance(fail: false) }
            }
        }
        // Locally-sensed completion: sample the signal ~4x/sec and advance on a debounced satisfy.
        // Mode-agnostic (a test step can auto-pass on doneWhen too); manual fn→ always stays live.
        if s.doneWhen != nil {
            doneTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.doneTick() }
            }
            // A mis-authored doneWhen can never wedge the user: manual fn→ is always live, and an
            // optional timeoutMs stops the watcher entirely (falls back to manual-only) after a while.
            if let t = s.timeoutMs, t > 0 {
                timeoutTimer = Timer.scheduledTimer(withTimeInterval: t / 1000.0, repeats: false) { [weak self] _ in
                    MainActor.assumeIsolated {
                        self?.doneTimer?.invalidate(); self?.doneTimer = nil
                        NSLog("[cursor-guide] doneWhen timed out on step \(self?.idx ?? -1) — manual-only now")
                    }
                }
            }
        }
    }

    // One ~4Hz doneWhen sample. Evaluates AX-decidable leaves synchronously off a fresh signal and
    // kicks the async Vision OCR when the predicate needs it; advances on 2 consecutive satisfied ticks.
    private func doneTick() {
        guard isActive, !capturingFeedback, idx < steps.count, let pred = steps[idx].doneWhen else { return }
        // Keep an OCR pass warm for this step if the predicate needs one.
        if pred.needsOCR { kickOCRIfNeeded(pred) }
        let ok = evaluate(pred)
        doneStreak = ok ? doneStreak + 1 : 0
        if doneStreak >= 2 {   // debounce: two clean ticks in a row before we auto-advance
            doneStreak = 0
            handleAdvance(fail: false)   // same path as manual fn→ (records + flashes + advances)
        }
    }

    // Evaluate a predicate against a freshly-sampled signal + bounded local AX. OCR leaves read the
    // async-cached ocrMatched. Everything here is LOCAL (AmbientSignal + AX BFS + on-device Vision).
    private func evaluate(_ p: Predicate) -> Bool {
        let sig = sampleSignal?()
        return evaluate(p, sig)
    }

    private func evaluate(_ p: Predicate, _ sig: AmbientSignal?) -> Bool {
        switch p {
        case .any(let ps): return ps.contains { evaluate($0, sig) }
        case .all(let ps): return ps.allSatisfy { evaluate($0, sig) }
        case .appFrontmost(let b):
            return (sig?.bundleId.lowercased() ?? "") == b.lowercased()
        case .windowTitleMatches(let pattern, let mode):
            return textMatches(sig?.windowTitle, pattern: pattern, mode: mode)
        case .urlHostIs(let host, let pathContains):
            guard let url = sig?.url, let comps = URLComponents(string: url), let h = comps.host else { return false }
            let hostOK = h.lowercased() == host.lowercased() || h.lowercased().hasSuffix("." + host.lowercased())
            guard hostOK else { return false }
            if let pc = pathContains, !pc.isEmpty { return comps.path.lowercased().contains(pc.lowercased()) }
            return true
        case .fieldFocused:
            return sig?.focusedFormField ?? false
        case .fieldNonEmpty:
            return !((sig?.focusedValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        case .fieldContains(let text, let regex):
            let v = sig?.focusedValue ?? ""
            if let t = text, !t.isEmpty { return v.lowercased().contains(t.lowercased()) }
            if let rx = regex, !rx.isEmpty { return (try? NSRegularExpression(pattern: rx, options: [.caseInsensitive]))?.firstMatch(in: v, range: NSRange(v.startIndex..., in: v)) != nil }
            return !v.isEmpty
        case .elementExists(let role, let titleContains, let enabled):
            guard let el = findElement(role: role, titleContains: titleContains, valueEquals: nil) else { return false }
            if let want = enabled { return (axEnabled(el) ?? true) == want }
            return true
        case .checkboxState(let titleContains, let checked):
            return checkboxChecked(titleContains: titleContains) == checked
        case .onScreenTextAppeared:
            return (ocrStepIdx == idx) && ocrMatched   // set by the async Vision pass for THIS step
        case .unknown:
            return false
        }
    }

    private func textMatches(_ value: String?, pattern: String, mode: String) -> Bool {
        guard let v = value else { return false }
        switch mode {
        case "equals": return v == pattern
        case "regex":  return (try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]))?.firstMatch(in: v, range: NSRange(v.startIndex..., in: v)) != nil
        default:       return v.lowercased().contains(pattern.lowercased())   // "contains"
        }
    }

    // MARK: local Vision OCR (on-device, for on-screen-text-appeared)
    //
    // Screen-Recording-gated (the app already holds the grant). Captures the main display, crops to the
    // step's region (default = a box around the step's point), runs a FAST VNRecognizeTextRequest off the
    // main thread, and writes ocrMatched back on main. One pass at a time. Any failure logs and leaves
    // ocrMatched=false → the step is manual-only, never wedged. If Vision is unavailable this whole path
    // simply never satisfies (fn→ still advances).

    private func kickOCRIfNeeded(_ pred: Predicate) {
        guard !ocrInFlight else { return }
        guard let leaf = firstOCRLeaf(pred) else { return }
        let stepAtLaunch = idx
        let region = ocrRegion(for: leaf)
        ocrInFlight = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let hit = CursorGuide.runOCR(region: region, needle: leaf)
            Task { @MainActor in
                guard let self = self else { return }
                self.ocrInFlight = false
                if self.idx == stepAtLaunch { self.ocrStepIdx = stepAtLaunch; self.ocrMatched = hit }
            }
        }
    }

    private func firstOCRLeaf(_ p: Predicate) -> (text: String?, regex: String?, region: CGRect?)? {
        switch p {
        case .onScreenTextAppeared(let t, let rx, let r): return (t, rx, r)
        case .any(let ps), .all(let ps):
            for sub in ps { if let f = firstOCRLeaf(sub) { return f } }
            return nil
        default: return nil
        }
    }

    // Region to OCR, in TOP-LEFT screen POINTS. Explicit region wins; else a 320×200pt box centered on
    // the step's target point; else the whole main screen.
    private func ocrRegion(for leaf: (text: String?, regex: String?, region: CGRect?)) -> CGRect {
        let screen = NSScreen.main?.frame.size ?? CGSize(width: 1440, height: 900)
        if let r = leaf.region { return r }
        if idx < steps.count, let t = steps[idx].point {
            let w: CGFloat = 320, h: CGFloat = 200
            return CGRect(x: max(0, t.x - w/2), y: max(0, t.y - h/2), width: w, height: h)
        }
        return CGRect(origin: .zero, size: screen)
    }

    // The actual capture + recognize. Captures just the region with the LOCAL /usr/sbin/screencapture
    // (the same tool the app's God flow uses — no ScreenCaptureKit, no deprecated CGDisplayCreateImage),
    // then runs on-device Vision over the crop. `region` is TOP-LEFT points, which is exactly what
    // `screencapture -R x,y,w,h` expects — so no pixel/scale math is needed.
    nonisolated private static func runOCR(region: CGRect, needle: (text: String?, regex: String?, region: CGRect?)) -> Bool {
        let tmp = NSTemporaryDirectory() + "guide-ocr.png"
        try? FileManager.default.removeItem(atPath: tmp)
        let r = region.integral
        let cap = Process()
        cap.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        cap.arguments = ["-x", "-R", "\(Int(r.minX)),\(Int(r.minY)),\(Int(max(1, r.width))),\(Int(max(1, r.height)))", "-t", "png", tmp]
        do { try cap.run() } catch {
            NSLog("[cursor-guide] OCR: screencapture launch failed: \(error) — step stays manual-only"); return false
        }
        cap.waitUntilExit()
        guard let img = NSImage(contentsOfFile: tmp),
              let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            NSLog("[cursor-guide] OCR: no image (Screen Recording not granted?) — step stays manual-only"); return false
        }
        try? FileManager.default.removeItem(atPath: tmp)

        var found = false
        let req = VNRecognizeTextRequest { request, _ in
            guard let obs = request.results as? [VNRecognizedTextObservation] else { return }
            let lines = obs.compactMap { $0.topCandidates(1).first?.string }
            let hay = lines.joined(separator: "\n")
            if let t = needle.text, !t.isEmpty {
                found = hay.lowercased().contains(t.lowercased())
            } else if let rx = needle.regex, !rx.isEmpty {
                found = (try? NSRegularExpression(pattern: rx, options: [.caseInsensitive]))?
                    .firstMatch(in: hay, range: NSRange(hay.startIndex..., in: hay)) != nil
            } else {
                found = !hay.isEmpty   // any text at all
            }
        }
        req.recognitionLevel = .fast
        req.usesLanguageCorrection = false
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([req]) } catch {
            NSLog("[cursor-guide] OCR perform failed: \(error) — step stays manual-only")
            return false
        }
        return found
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
        onStopSpeak?()          // silence the concierge voice when the guide ends
        // Teach timers off, and restore the clipboard we borrowed (opt-in runs only).
        holdTimer?.invalidate(); holdTimer = nil
        doneTimer?.invalidate(); doneTimer = nil
        timeoutTimer?.invalidate(); timeoutTimer = nil
        if autoClipboard {
            NSPasteboard.general.clearContents()
            if let s = savedClipboard { NSPasteboard.general.setString(s, forType: .string) }
            savedClipboard = nil
            autoClipboard = false
        }
        model.visible = false
        model.done = nil
        model.flash = nil
        model.target = nil
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
        case 121: beginFeedback(); return true                                         // PageDown (fn ↓) — screenshot + note (any mode)
        case 125 where fn: beginFeedback(); return true                                // ↓ +fn
        case 46 where fn: toggleMute(); return true                                    // fn m — voiceover on/off
        default: return false
        }
    }

    // fn m — toggle the spoken voiceover on/off. Persisted (durable preference). Muting silences
    // any in-flight speech; un-muting re-reads the current step aloud so the change is audible.
    private func toggleMute() {
        model.muted.toggle()
        UserDefaults.standard.set(model.muted, forKey: "relay.guide.muted")
        if model.muted {
            onStopSpeak?()
        } else if isActive, idx >= 0, idx < steps.count, mode == .tour || mode == .teach {
            onSpeak?(steps[idx].say ?? steps[idx].text)
        }
    }
}
