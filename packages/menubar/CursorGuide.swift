import AppKit
import SwiftUI
import Vision
import CoreGraphics
import ApplicationServices   // AXIsProcessTrusted — the permission strip check

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

// A picture or looping GIF shown in a step's media zone (show-don't-tell). `src` is an absolute file
// path or an http(s) URL; loaded lazily when the step appears (docs/GUIDE-CARD-SPEC §6 media states).
struct GuideMedia {
    let src: String
    var caption: String? = nil
}

// One A/B/C variant the user compares + approves (Redline-style). A variant can BE media (an image
// thumbnail) OR a labelled swatch — `media` wins when present. Picking one (⌥1/2/3) previews it; ⌥→
// approves. The chosen id is recorded in the result so the wrapp/God can apply it (the live-apply hook).
struct GuideOption: Identifiable {
    let id: String
    let label: String
    var media: GuideMedia? = nil
    var accent: String? = nil        // "lime" | "indigo" | "pink" — the swatch bar when there's no media
    var detail: String? = nil        // one-line "why" (adhd-pm: make the trade-off scannable)
    var recommended: Bool = false    // ⭐ the recommended pick — pre-selected so ⌥→ takes it instantly
}

struct GuideStep {
    let id: String
    let text: String
    let hint: String?   // optional dim second line (the schema's `hint` / `expect`)
    // ── teach-mode additions (all optional; absent → behaves exactly like a tour/test step) ──
    var say: String? = nil          // line to speak (falls back to `text`)
    var point: CGPoint? = nil       // overlay top-left coords (already mapped from shot pixels in begin())
    var copy: String? = nil         // TEXT clipboard payload to pre-load when the step shows (opt-in via autoClipboard)
    var copyImage: String? = nil    // IMAGE (file path / http url) to pre-load onto the clipboard — the user just pastes it
    var hold: Double? = nil         // ms to dwell before auto-advancing (teach only)
    var doneWhen: Predicate? = nil  // locally-sensed completion condition → auto-advance
    var timeoutMs: Double? = nil    // after this long, stop watching doneWhen and fall back to manual-only
    var media: GuideMedia? = nil    // an image/gif for this step (zone 4)
    var options: [GuideOption]? = nil  // A/B/C variants to compare + approve (zone 5); ⌥→ = approve selected
    var placement: String? = nil    // "notch" | "dock" | "cursor" — where the card sits (nil = smart default)
}

// Where the presence/guide card sits. notch = fixed top-center + CLICKABLE; dock = fixed bottom (keyboard);
// cursor = rides the pointer (opt-in). See docs/PRESENCE.md §2.
enum GuidePlacement: String { case notch, dock, cursor }

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
    case pasted   // satisfied once the user presses ⌘V while the step is active → paste auto-advances
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
        case "pasted":
            return .pasted
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
    var chosenOption: String? = nil     // the A/B/C variant the user approved on an options step
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
    @Published var progress: String = ""         // "3/8" (kept for logs / a11y)
    @Published var stepIndex: Int = 0            // 0-based, drives the segment progress bar
    @Published var stepTotal: Int = 0
    @Published var autoSensing = false           // this step self-advances (doneWhen/hold) → AUTO pill + status line
    @Published var canBack = false               // idx > 0 → the Back chip appears
    @Published var flash: GuideFlash? = nil       // brief ✓/✗ confirmation that a signal landed
    @Published var done: String? = nil            // non-nil → show the completion summary card
    @Published var reduceMotion = false
    @Published var target: CGPoint? = nil         // a step's point → the ring indicates it (nil = no ring this step)
    @Published var collapsed = false              // card collapsed to a small docked pill (⌥. toggles)
    @Published var media: GuideMedia? = nil       // zone 4 — an image/gif for this step
    @Published var options: [GuideOption] = []    // zone 5 — A/B/C variants to compare + approve
    @Published var selectedOption = 0             // ⌥1/2/3 highlight; ⌥→ approves this one
    @Published var dockTop = false                // dock the card at the TOP when the target is in the bottom band
    @Published var placement: GuidePlacement = .dock   // notch / dock / cursor (⌥/ toggles notch↔dock)
    @Published var source: String? = nil          // provenance: who's asking (thread/agent/wrapp), e.g. "Claude Code · migrate-db"
    @Published var sourceId: String? = nil        // stable THREAD identity → a deterministic colour (tell threads apart)
    @Published var project: String? = nil         // provenance: the project this run is grounded in
    @Published var clipboardHint: String? = nil   // "⌘V — pasted for you" cursor hint when a step preloads the clipboard
    @Published var applyingOption: Int? = nil     // an option is being applied live (shows the working dot-matrix)
    @Published var optionError = false            // last apply failed (danger line; never blocks)
    // Spoken voiceover on/off — persisted so it's a durable preference; toggled live with fn m.
    @Published var muted: Bool = UserDefaults.standard.bool(forKey: "relay.guide.muted")
}

// MARK: - The caption chip (rides the cursor)

/// A small frosted/dark chip anchored below-right of the pointer, click-through, lime-accented.
/// Flips to the other side of the pointer near a screen edge. Honors reduce-motion (no pulsing).
struct GuideCaptionView: View {
    @ObservedObject var m: GuideOverlayModel
    @State private var ringPulse = false
    private let cardW: CGFloat = 320

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear.allowsHitTesting(false)
            // Pointer ring — shown ONLY when a step declares a target to indicate (m.target). Pulsing lime
            // circle, matching God's [POINT] ring. The RING follows/points; the CARD is placed separately.
            if m.visible, let t = m.target {
                Circle().stroke(Color.lime.opacity(0.85), lineWidth: 2)
                    .frame(width: 40, height: 40)
                    .scaleEffect(m.reduceMotion ? 1.0 : (ringPulse ? 1.12 : 0.82))
                    .opacity(m.reduceMotion ? 0.9 : (ringPulse ? 0.3 : 0.95))
                    .animation(m.reduceMotion ? nil : .easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: ringPulse)
                    .position(t)
                    .allowsHitTesting(false)
            }
            // Cursor hint — a tiny chip by the pointer when a step preloaded the clipboard, so the user knows
            // to just paste (the full step stays at the notch/dock). Rides the cursor; never hit-tested.
            if m.visible, let hint = m.clipboardHint {
                HStack(spacing: 5) {
                    Image(systemName: "doc.on.clipboard.fill").font(.system(size: 9)).foregroundColor(.lime)
                    Text(hint).font(.splMono(9.5)).foregroundColor(.ink)
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(Capsule().fill(Color.page.opacity(0.96)).overlay(Capsule().stroke(Color.lime.opacity(0.5), lineWidth: 1)))
                .position(x: min(m.cursor.x + 74, max(90, m.screenSize.width - 90)), y: m.cursor.y + 24)
                .allowsHitTesting(false)
            }
            // Placement (docs/PRESENCE.md §2): notch = fixed top-center + CLICKABLE; dock = bottom (or top on
            // a low target); cursor = rides the pointer (opt-in). Only the NOTCH card is hit-testable — the
            // rest of the overlay stays click-through so the app underneath is never blocked.
            if m.visible {
                placedCard
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)   // overlay never captures clicks — the app underneath stays interactive
                    .animation(.easeOut(duration: 0.16), value: m.collapsed)
                    .animation(.easeOut(duration: 0.18), value: m.placement)
            }
        }
        .ignoresSafeArea()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear { ringPulse = true }
    }

    @ViewBuilder private var placedCard: some View {
        switch m.placement {
        case .notch:
            VStack(spacing: 0) { cardOrPill; Spacer(minLength: 0) }   // flush at top — the drop merges into the notch
        case .cursor:
            VStack(spacing: 0) { Spacer(minLength: 0); cardOrPill }.padding(.bottom, 54)   // (rides-cursor is a later refinement; docks bottom for now)
        case .dock:
            VStack(spacing: 0) {
                if m.dockTop { cardOrPill; Spacer(minLength: 0) } else { Spacer(minLength: 0); cardOrPill }
            }.padding(m.dockTop ? .top : .bottom, 54)
        }
    }

    @ViewBuilder private var cardOrPill: some View {
        if m.collapsed { collapsedPill } else { card.frame(width: cardW, alignment: .leading) }
    }

    // Collapsed: a small docked pill — a live pulse, the step count, and how to bring the card back.
    private var collapsedPill: some View {
        HStack(spacing: 8) {
            Circle().fill(Color.lime).frame(width: 6, height: 6).shadow(color: Color.lime.opacity(0.7), radius: 3)
            Text("\(m.stepIndex + 1)/\(max(m.stepTotal, 1))").font(.splMono(10)).foregroundColor(.ink)
            Text("guide").font(.hanken(11, .semibold)).foregroundColor(.inkDim)
            Text("⌥. expand").font(.splMono(8.5)).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(chipBackground)
    }

    @ViewBuilder private var card: some View {
        if let summary = m.done {
            summaryCard(summary)
        } else {
            stepCard
        }
    }

    // The action chips, split into a PRIMARY row (advance / fail / back) and a META row (feedback / mute /
    // close). Two rows so labels never wrap or get cut in the 300pt card, whatever the count. Primary
    // (Pass/Next) is lime. Back is hidden on step 1 (nothing to go back to); Fail only exists in test mode.
    // Accelerators use ⌃⌘+arrow — NOT fn+arrow, which macOS maps to PageUp/PageDown and scrolls the app
    // underneath the guide. (Manual advance is also a click on the chip; auto-advance is the primary path.)
    private var primaryActions: [(combo: String, label: String, primary: Bool)] {
        var a: [(String, String, Bool)] = []
        if !m.options.isEmpty {                                   // options step → try variants, then approve
            let combo = (1...m.options.count).map { "⌥\($0)" }.joined(separator: "·")
            a.append((combo, "try", false))
            a.append(("⌥→", "Approve", true))
        } else if m.mode == .test {
            a.append(("⌥→", "Pass", true))
            a.append(("⌥←", "Fail", false))
        } else {
            a.append(("⌥→", "Next", true))
        }
        if m.canBack { a.append(("⌥↑", "Back", false)) }
        return a.map { (combo: $0.0, label: $0.1, primary: $0.2) }
    }
    private var metaActions: [(combo: String, label: String, primary: Bool)] {
        [("⌥↓", "Feedback", false),                         // screenshot + note, any mode
         ("⌥M", m.muted ? "Unmute" : "Mute", false),
         ("esc", "Close", false)]
        .map { (combo: $0.0, label: $0.1, primary: $0.2) }
    }

    // A slim segment bar: one pill per step, filled up to the current one. Reads as progress at a glance
    // (replaces the "3/6" text — show, don't count).
    // Readability: for a long step, break the FIRST sentence out as the bold lead (the thing to focus on)
    // and render the rest as dimmer detail. Short steps stay a single line (rest = nil).
    private func splitInstruction(_ t: String) -> (lead: String, rest: String?) {
        guard t.count > 88, let r = t.range(of: ". ") else { return (t, nil) }
        let lead = String(t[..<r.upperBound]).trimmingCharacters(in: .whitespaces)
        let rest = String(t[r.upperBound...]).trimmingCharacters(in: .whitespaces)
        return rest.isEmpty ? (t, nil) : (lead, rest)
    }

    // Route a clicked action chip to the same handler as its key (notch-clickable).
    private func chipTap(_ label: String) {
        switch label {
        case "Next", "Pass", "Approve": CursorGuide.shared.tapPrimary()
        case "Fail":                     CursorGuide.shared.tapFail()
        case "Back":                     CursorGuide.shared.tapBack()
        case "Feedback":                 CursorGuide.shared.tapFeedback()
        case "Mute", "Unmute":           CursorGuide.shared.tapMute()
        case "Close":                    CursorGuide.shared.tapClose()
        default: break   // "try" (⌥1·2·3) has no single action — the option cards handle taps
        }
    }

    private var segmentBar: some View {
        HStack(spacing: 3) {
            ForEach(0..<max(m.stepTotal, 1), id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(i <= m.stepIndex ? Color.lime : Color.raised)
                    .frame(height: 4)
            }
        }
    }

    // Zone 5: the A/B/C variant cards. Each shows its media (or an accent swatch), a bold label, and a
    // one-line "why" (adhd-pm: make the trade-off scannable). The ⭐recommended one is pre-selected + badged
    // so a single ⌥→ / click takes it. Selected = lime border. Tappable at the notch. ⌥→ approves.
    private var optionsRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Text("PICK ONE — UPDATES LIVE").font(.splMono(8.5)).tracking(0.6).foregroundColor(.indigo)
                if m.options.contains(where: { $0.recommended }) {
                    Text("★ recommended").font(.splMono(8)).foregroundColor(.lime.opacity(0.9))
                }
            }
            HStack(alignment: .top, spacing: 7) {
                ForEach(Array(m.options.enumerated()), id: \.element.id) { (i, opt) in optionCard(i, opt) }
            }
        }
    }
    private func optionCard(_ i: Int, _ opt: GuideOption) -> some View {
        let sel = i == m.selectedOption
        let letter = i < 3 ? ["A", "B", "C"][i] : "\(i + 1)"
        return VStack(alignment: .leading, spacing: 5) {
            ZStack(alignment: .topTrailing) {
                if let md = opt.media {
                    GuideMediaView(media: md, reduceMotion: m.reduceMotion, compact: true)
                } else {
                    RoundedRectangle(cornerRadius: 5).fill(accentColor(opt.accent)).frame(maxWidth: .infinity).frame(height: 40)
                }
                if opt.recommended {
                    Text("★").font(.system(size: 9)).foregroundColor(.lime)
                        .padding(3).background(Circle().fill(Color.page.opacity(0.75))).padding(4)
                }
            }
            HStack(spacing: 4) {
                Text(sel ? "\(letter)✓" : letter).font(.splMono(9)).foregroundColor(sel ? .lime : .inkFaint)
                Text(opt.label).font(.hanken(11, .semibold)).foregroundColor(sel ? .ink : .inkDim).lineLimit(1)
            }
            if let d = opt.detail, !d.isEmpty {
                Text(d).font(.hanken(9.5)).foregroundColor(.inkFaint)
                    .lineLimit(3).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.xs).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: SBr.xs)
            .stroke(sel ? Color.lime : (opt.recommended ? Color.lime.opacity(0.4) : Color.edge), lineWidth: sel ? 1.5 : 1))
        .contentShape(Rectangle())
        .onTapGesture { CursorGuide.shared.tapOption(i) }   // clickable at the notch (no-op elsewhere: not hit-testable)
    }
    private func accentColor(_ name: String?) -> Color {
        switch (name ?? "").lowercased() {
        case "indigo": return .indigo
        case "pink", "danger": return .danger
        default: return .lime
        }
    }

    private var stepCard: some View {
        VStack(alignment: .leading, spacing: 9) {
            // ── provenance: WHO is asking (thread/agent) + which PROJECT, so a card is never a mystery. ──
            if (m.source?.isEmpty == false) || (m.project?.isEmpty == false) {
                HStack(spacing: 7) {
                    if let s = m.source, !s.isEmpty {
                        // Per-THREAD colour dot (deterministic from the thread id) — tell two threads apart at a glance.
                        Circle().fill(colorForId(m.sourceId ?? s)).frame(width: 7, height: 7)
                            .shadow(color: colorForId(m.sourceId ?? s).opacity(0.6), radius: 2)
                        Text("⌘ \(s)").font(.splMono(9)).foregroundColor(.inkDim).lineLimit(1)
                    }
                    if let p = m.project, !p.isEmpty {
                        Text("◆ \(p)").font(.splMono(9)).foregroundColor(.indigo).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }
            // ── permission strip: keys need Accessibility. Shown only when not trusted; the guide still
            //    renders + esc works, but keyboard signals won't fire until granted (spec §6). ──
            if !AXIsProcessTrusted() {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundColor(.danger)
                    Text("Keys need Accessibility — grant it in Settings").font(.hanken(10, .medium)).foregroundColor(.danger)
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: SBr.xs).fill(Color.danger.opacity(0.12)))
            }
            // ── header rail: segment progress · title · AUTO pill · voice ──
            HStack(spacing: 8) {
                segmentBar.frame(width: 92)
                if let t = m.title, !t.isEmpty {
                    Text(t.uppercased())
                        .font(.splMono(8.5)).tracking(0.7)
                        .foregroundColor(.inkFaint)
                        .lineLimit(1).truncationMode(.tail)
                }
                Spacer(minLength: 0)
                if m.autoSensing {
                    HStack(spacing: 4) {
                        DotMatrix(pattern: .working, accent: .lime, cols: 5, rows: 3, dot: 2, gap: 2, animated: !m.reduceMotion)
                        Text("AUTO").font(.splMono(8)).tracking(0.5).foregroundColor(.lime)
                    }
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Capsule().stroke(Color.lime.opacity(0.4), lineWidth: 1))
                }
                Image(systemName: m.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 9))
                    .foregroundColor(m.muted ? .inkFaint : .lime)
                Text("⌥.").font(.splMono(8)).foregroundColor(.inkFaint)   // hint: ⌥. collapses the card to a pill
            }
            // ── the instruction — a bold LEAD line (what to focus on) + dimmer detail, so a dense step is
            //    scannable instead of a wall. Short steps render as one line. NO line limit (never cut). ──
            let parts = splitInstruction(m.text)
            Text(parts.lead)
                .font(.brico(15, .semibold))
                .foregroundColor(.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let rest = parts.rest {
                Text(rest)
                    .font(.hanken(12, .regular))
                    .foregroundColor(.inkDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let h = m.hint, !h.isEmpty {
                Text(h)
                    .font(.hanken(11.5, .regular))
                    .foregroundColor(.inkDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // ── zone 4: media (image / gif) ──
            if let media = m.media {
                GuideMediaView(media: media, reduceMotion: m.reduceMotion, compact: false)
            }
            // ── zone 5: options — A/B/C variants to compare + approve ──
            if !m.options.isEmpty { optionsRow }
            // ── auto-status / applying / error line (dot-matrix — the Switchboard sensing language) ──
            if m.optionError {
                HStack(spacing: 6) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 10)).foregroundColor(.danger)
                    Text("couldn't apply — try another or skip (⌥→)").font(.hanken(10.5, .medium)).foregroundColor(.danger)
                }
            } else if let ai = m.applyingOption, ai < m.options.count {
                HStack(spacing: 6) {
                    DotMatrix(pattern: .working, accent: .indigo, cols: 5, rows: 3, dot: 2, gap: 2, animated: !m.reduceMotion)
                    Text("applying \(m.options[ai].label)…").font(.hanken(10.5, .medium)).foregroundColor(.indigo)
                }
            } else if m.autoSensing {
                HStack(spacing: 6) {
                    DotMatrix(pattern: .working, accent: .lime, cols: 5, rows: 3, dot: 2, gap: 2, animated: !m.reduceMotion)
                    Text("watching — I'll advance on my own").font(.hanken(10.5, .medium)).foregroundColor(.lime.opacity(0.9))
                }
            }
            // keycap action chips — two rows (primary, then meta) so labels never wrap/cut. At the NOTCH they
            // are clickable (tap → same path as the key); elsewhere the tap is inert (card isn't hit-tested).
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    ForEach(Array(primaryActions.enumerated()), id: \.offset) { _, act in
                        GuideActionChip(combo: act.combo, label: act.label, primary: act.primary)
                            .contentShape(Rectangle()).onTapGesture { chipTap(act.label) }
                    }
                }
                HStack(spacing: 5) {
                    ForEach(Array(metaActions.enumerated()), id: \.offset) { _, act in
                        GuideActionChip(combo: act.combo, label: act.label, primary: act.primary)
                            .contentShape(Rectangle()).onTapGesture { chipTap(act.label) }
                    }
                }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, m.placement == .notch ? 20 : SB.s3)
        .padding(.top, m.placement == .notch ? 34 : SB.s3)      // clear the physical notch — content drops below it
        .padding(.bottom, m.placement == .notch ? 13 : SB.s3)
        .modifier(CardChrome(notch: m.placement == .notch))
        .overlay(alignment: .topTrailing) { flashBadge }
    }

    private func summaryCard(_ summary: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 13)).foregroundColor(.lime)
            Text(summary)
                .font(.hanken(11.5, .medium)).foregroundColor(.ink)
                .fixedSize(horizontal: false, vertical: true)
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
// The card chrome. At the NOTCH it IS the notch canvas — Color.page + NotchDropShape (the exact silhouette
// God's status drop + the consent drop use), so it descends from the notch and blends in. Elsewhere it's
// the rounded, shadowed card. (NotchDropShape + Color.page come from RelayMenuBar — same build target.)
struct CardChrome: ViewModifier {
    let notch: Bool
    func body(content: Content) -> some View {
        if notch {
            content
                .frame(minWidth: 130)
                .padding(.horizontal, 14)   // room for the notch "ears" (the shape flares to full width up top)
                .background(Color.page)
                .clipShape(NotchDropShape())
        } else {
            content.background(
                RoundedRectangle(cornerRadius: SBr.sm).fill(Color.panel.opacity(0.98))
                    .overlay(RoundedRectangle(cornerRadius: SBr.sm).stroke(Color.lime.opacity(0.45), lineWidth: 1))
                    .shadow(color: .black.opacity(0.45), radius: 12, x: 0, y: 6))
        }
    }
}

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
                .lineLimit(1).fixedSize()   // never break a keycap label mid-word
        }
    }
}

// Zone 4 / option thumbnail — loads a local file path OR an http(s) url. While loading: the working
// dot-matrix. On failure: a small "preview unavailable" (the instruction still stands — spec §6 media).
struct GuideMediaView: View {
    let media: GuideMedia
    var reduceMotion = false
    var compact = false
    private var h: CGFloat { compact ? 40 : 96 }

    var body: some View {
        content
            .frame(maxWidth: .infinity)
            .frame(height: h)
            .clipShape(RoundedRectangle(cornerRadius: SBr.xs))
            .overlay(RoundedRectangle(cornerRadius: SBr.xs).stroke(Color.edge, lineWidth: 1))
    }

    @ViewBuilder private var content: some View {
        if media.src.hasPrefix("http"), let url = URL(string: media.src) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                case .failure: unavailable
                default: loading
                }
            }
        } else if let img = NSImage(contentsOfFile: media.src) {
            Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
        } else {
            unavailable
        }
    }
    private var loading: some View {
        DotMatrix(pattern: .working, accent: .lime, cols: 5, rows: 3, dot: 2, gap: 2, animated: !reduceMotion)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.raised)
    }
    private var unavailable: some View {
        HStack(spacing: 5) {
            if !compact { Image(systemName: "photo").font(.system(size: 10)) }
            Text(compact ? "—" : "preview unavailable").font(.hanken(compact ? 9 : 10)).foregroundColor(.inkFaint)
        }
        .foregroundColor(.inkFaint).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.raised)
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

    // The live-apply hook (Redline-style options). CursorGuide only knows WHICH variant the user is
    // eyeing/approved; APPLYING it to the real work (re-render the doc/page) is the app/wrapp's job.
    // preview = ⌥1/2/3 (compare live); approve = ⌥→. Absent → options are still recorded, just not applied.
    var onOptionPreview: ((_ stepId: String, _ optionId: String) -> Void)?
    var onOptionApprove: ((_ stepId: String, _ optionId: String) -> Void)?

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
    private var rawRun: [String: Any]? = nil   // the original run JSON — re-saved (with startIndex) on abort so a guide can be RESUMED from the menu
    private var startedAt = Date()

    // ── teach run state
    private var autoClipboard = false
    private var savedClipboard: String?      // the user's clipboard before the run — restored on end/abort
    private var doneStreak = 0               // consecutive satisfied ticks (debounce: advance on 2)
    private var ocrInFlight = false          // one Vision pass at a time
    private var ocrMatched = false           // last OCR verdict for the current step
    private var ocrStepIdx = -1              // which step the cached ocrMatched belongs to
    private var pasteObserved = false        // ⌘V seen during THIS step (drives the `.pasted` doneWhen)

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
            step.copyImage = s["copyImage"] as? String
            if let h = (s["hold"] as? NSNumber)?.doubleValue { step.hold = h }
            if let t = (s["timeoutMs"] as? NSNumber)?.doubleValue { step.timeoutMs = t }
            if let p = s["point"] as? [String: Any],
               let px = (p["x"] as? NSNumber)?.doubleValue, let py = (p["y"] as? NSNumber)?.doubleValue {
                step.point = mapper(CGPoint(x: px, y: py))
            }
            step.doneWhen = Predicate.parse(s["doneWhen"])
            step.media = parseMedia(s["media"])
            if let rawOpts = s["options"] as? [[String: Any]] {
                let opts: [GuideOption] = rawOpts.enumerated().compactMap { (j, o) in
                    guard let label = (o["label"] as? String) ?? (o["id"] as? String) else { return nil }
                    let oid = (o["id"] as? String) ?? "opt-\(j + 1)"
                    return GuideOption(id: oid, label: label, media: parseMedia(o["media"]),
                                       accent: o["accent"] as? String, detail: o["detail"] as? String,
                                       recommended: (o["recommended"] as? Bool) ?? false)
                }
                if !opts.isEmpty { step.options = Array(opts.prefix(3)) }   // cap at A/B/C (spec §7)
            }
            step.placement = (s["placement"] as? String)
            parsed.append(step)
        }
        guard !parsed.isEmpty else { logMalformed(); return }

        if isActive { abort(reason: "superseded") }   // last-writer-wins re-entry

        self.mode = m
        self.title = title
        self.steps = parsed
        self.rawRun = obj                          // keep the raw run so we can re-save it (with startIndex) to resume
        // Provenance (docs/PRESENCE.md §4b): who's asking + which project, so a card is never a mystery prompt.
        model.source = (obj["source"] as? String)
        model.sourceId = (obj["sourceId"] as? String)
        model.project = (obj["project"] as? String)
        // Resume support: a run may carry startIndex (written by the "resume" menu item) → begin partway in.
        self.idx = max(0, min((obj["startIndex"] as? Int) ?? 0, parsed.count - 1))
        self.results = parsed.map { GuideResult(id: $0.id, text: $0.text, verdict: "unrun", notedAt: nil) }
        for i in 0..<idx where i < results.count { results[i].verdict = "done" }   // steps before the resume point are done
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

    // media may be a bare string (src) or an object {src|url|path, caption}. nil → no media zone.
    private func parseMedia(_ raw: Any?) -> GuideMedia? {
        if let s = raw as? String, !s.isEmpty { return GuideMedia(src: s) }
        guard let d = raw as? [String: Any] else { return nil }
        let src = (d["src"] as? String) ?? (d["url"] as? String) ?? (d["path"] as? String)
        guard let src, !src.isEmpty else { return nil }
        return GuideMedia(src: src, caption: d["caption"] as? String)
    }

    // Load an image for the clipboard-preload (file path or http url). Small helper images only.
    private func loadImage(_ src: String) -> NSImage? {
        if src.hasPrefix("http"), let url = URL(string: src), let d = try? Data(contentsOf: url) { return NSImage(data: d) }
        return NSImage(contentsOfFile: src)
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
        model.stepIndex = idx
        model.stepTotal = steps.count
        model.autoSensing = (s.doneWhen != nil) || ((s.hold ?? 0) > 0)   // step advances itself → AUTO
        model.canBack = idx > 0
        model.media = s.media
        model.options = s.options ?? []
        // adhd-pm: pre-select the ⭐recommended option so a single ⌥→ (or click) takes the recommendation.
        model.selectedOption = (s.options ?? []).firstIndex(where: { $0.recommended }) ?? 0
        model.applyingOption = nil
        model.optionError = false
        // Dock-edge flip (spec §7): if the ring's target sits in the bottom band where the card lives,
        // dock the card at the TOP so it never covers the thing it's pointing at.
        if let t = s.point, model.screenSize.height > 0 {
            model.dockTop = t.y > model.screenSize.height * 0.62
        } else {
            model.dockTop = false
        }
        // Placement (docs/PRESENCE.md §2): explicit wins; else smart — a choose/approve step (options) goes
        // to the clickable NOTCH, everything else docks. ⌥/ can move it live afterwards.
        // Smart default: presence lives at the NOTCH. Only a step that POINTS at a target docks (bottom),
        // so the card never covers the ring's target. Everything else — asks, questions, reading — → notch.
        if let p = s.placement, let pl = GuidePlacement(rawValue: p) { model.placement = pl }
        else { model.placement = (s.point != nil) ? .dock : .notch }
        applyMousePolicy()   // notch → the card becomes clickable; else pure click-through
        model.target = s.point        // teach: point the ring + anchor the chip; nil → chip rides the cursor
        // The concierge reads the step aloud in tour AND teach (say overrides text); test stays silent.
        if (mode == .tour || mode == .teach) && !model.muted { onSpeak?(s.say ?? s.text) }
        // Pre-load the clipboard with this step's paste payload (opt-in; user's clipboard is restored on end).
        // An IMAGE wins if present (copyImage); else text (copy). The cursor hint tells the user it's ready.
        model.clipboardHint = nil
        if autoClipboard, let imgSrc = s.copyImage, let img = loadImage(imgSrc) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.writeObjects([img])
            model.clipboardHint = "⌘V — image ready"
        } else if autoClipboard, let c = s.copy {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(c, forType: .string)
            model.clipboardHint = "⌘V — pasted for you"
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
        pasteObserved = false        // a paste only counts for the step it happens on
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
        case .pasted:
            return pasteObserved   // set by onKey on ⌘V for THIS step (reset in armStepWatchers)
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
        // Options step: ⌥→ APPROVES the selected variant — record it + fire the live-apply hook.
        if !fail, let opts = steps[idx].options, !opts.isEmpty {
            let i = min(max(model.selectedOption, 0), opts.count - 1)
            results[idx].chosenOption = opts[i].id
            onOptionApprove?(steps[idx].id, opts[i].id)
        }
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

    // ⌥1/2/3 — preview a variant live (compare); the wrapp applies it via onOptionPreview.
    private func selectOption(_ i: Int) {
        guard isActive, idx < steps.count, !model.options.isEmpty, i < model.options.count else { return }
        model.selectedOption = i
        model.optionError = false
        onOptionPreview?(steps[idx].id, model.options[i].id)
    }

    // ── mouse policy: the overlay is ALWAYS click-through (ignoresMouseEvents=true) so it NEVER blocks the
    //    app underneath — the user must be able to click form fields / real UI while a guide is up. Cards
    //    are keyboard-driven (⌥→ etc.). (Making the notch card itself clickable safely needs its OWN small
    //    bounded panel, not flipping the full-screen overlay — that blocked clicks to the app. Follow-up.) ──
    private func applyMousePolicy() { overlay?.ignoresMouseEvents = true }
    func tapPrimary()      { handleAdvance(fail: false) }
    func tapFail()         { if mode == .test { handleAdvance(fail: true) } }
    func tapOption(_ i: Int) { selectOption(i) }
    func tapBack()         { goBack() }
    func tapFeedback()     { beginFeedback() }
    func tapMute()         { toggleMute() }
    func tapClose()        { abort(reason: "click-close") }

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
        // Suspend for RESUME: if there are steps left, re-save the raw run with startIndex=idx so the
        // menu can pick it up right where the user left off. (Only when abandoned mid-way, not at the end.)
        if let raw = rawRun, idx < steps.count {
            var suspended = raw
            suspended["startIndex"] = idx
            suspended["suspendedTitle"] = "\(title) — step \(idx + 1)/\(steps.count)"
            writeAtomic(suspended, to: rel("guide-suspended.json"))
        }
        // Any not-yet-verdicted step becomes "skipped" (unrun in the file's terms → skipped on abort).
        for i in idx..<results.count where results[i].verdict == "unrun" { results[i].verdict = "skipped" }
        finish(outcome: "aborted")
        NSLog("[cursor-guide] ABORT (\(reason))")
    }

    private func finish(outcome: String) {
        if outcome == "completed" {   // ran to the end → nothing to resume; clear any suspended guide
            try? FileManager.default.removeItem(atPath: rel("guide-suspended.json"))
        }
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
            if let ch = r.chosenOption { d["chosenOption"] = ch }   // the approved A/B/C variant
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
        persistDurable(out)                                          // append-only history + durable screenshots
    }

    // Make a guide run READABLE BY ANY LATER CLAUDE THREAD — not just the one that triggered it. guide-result.json
    // is consumed-then-deleted by the daemon and its screenshots live in /tmp; here we (1) copy each feedback
    // screenshot out of /tmp into ~/.relay/guide-shots so the path survives a reboot, and (2) APPEND the run
    // (with the durable paths + the user's per-step verdicts/choices) to ~/.relay/guide-history.jsonl, which is
    // never deleted. The switchboard connector's `guide_history` tool reads this file. (docs: carried context /
    // Bank-as-substrate — this is the machine-readable memory of what the user has done + seen.)
    private func persistDurable(_ out: [String: Any]) {
        let runId = String(Int(startedAt.timeIntervalSince1970))
        let shotDir = rel("guide-shots")
        try? FileManager.default.createDirectory(atPath: shotDir, withIntermediateDirectories: true)
        var rec = out
        rec["runId"] = runId
        if var steps = rec["results"] as? [[String: Any]] {
            for i in steps.indices {
                guard var fb = steps[i]["feedback"] as? [String: Any],
                      let src = fb["screenshot"] as? String, !src.isEmpty,
                      FileManager.default.fileExists(atPath: src) else { continue }
                let stepId = ((steps[i]["id"] as? String) ?? "\(i)").replacingOccurrences(of: "/", with: "_")
                let dst = shotDir + "/" + runId + "-" + stepId + ".jpg"
                try? FileManager.default.removeItem(atPath: dst)
                if (try? FileManager.default.copyItem(atPath: src, toPath: dst)) != nil {
                    fb["screenshot"] = dst          // point the durable record at the surviving copy
                    steps[i]["feedback"] = fb
                }
            }
            rec["results"] = steps
        }
        guard let data = try? JSONSerialization.data(withJSONObject: rec, options: []),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        let path = rel("guide-history.jsonl")
        if let fh = FileHandle(forWritingAtPath: path) {          // append-only: never truncates prior runs
            defer { try? fh.close() }
            fh.seekToEndOfFile()
            if let d = line.data(using: .utf8) { fh.write(d) }
        } else {
            try? line.data(using: .utf8)?.write(to: URL(fileURLWithPath: path))
        }
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
        model.collapsed = false     // a fresh guide always opens expanded
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

    // ⌥+arrow accelerators — ONE modifier, arrows for next/back (intuitive + one-handed). We moved OFF
    // fn+arrow (macOS maps fn+↑/↓ → PageUp/PageDown → scrolled the app under the guide) and off the clunky
    // ⌃⌘ chord. ⌥+arrow doesn't scroll or switch Spaces; its only side effect is a harmless word-jump when
    // the cursor happens to sit in a text field. Esc closes. ⌃⌥ dictation (both held) is left untouched:
    // we require .option but NOT .control, so a ⌃⌥ hold never triggers a guide signal. Auto-advance
    // (doneWhen) remains the primary path; this is the manual accelerator.
    @discardableResult private func onKey(_ keyCode: UInt16, _ flags: NSEvent.ModifierFlags) -> Bool {
        guard isActive else { return false }
        // While capturing feedback, the notch note field is key + focused and owns typing + ↵/esc (via
        // RelayMenuBar's feedbackKeyMonitor). CursorGuide must take NO action here — but it must NOT swallow
        // either, or it eats the keystrokes meant for the note field (the "can't type" bug). Return false so
        // every key flows to the focused field; the feedbackKeyMonitor is the sole handler of ↵/esc.
        if capturingFeedback { return false }
        // ⌘V (keyCode 9) — mark a paste so a step whose doneWhen is `pasted` auto-advances. NEVER swallow:
        // the paste itself must reach the app. The ~4Hz watcher picks up the flag on its next tick.
        if keyCode == 9, flags.contains(.command) { pasteObserved = true; return false }
        if keyCode == 53 { abort(reason: "esc"); return true }                          // Esc — Close
        // Everything needs OPTION held (never Control — ⌃⌥ dictation + ⌃→ Spaces are left alone). Option is
        // required so a BARE arrow (which the user needs for normal navigation — fields, dropdowns) never
        // advances the guide by accident. ⌥+arrow doesn't page-scroll either.
        guard flags.contains(.option), !flags.contains(.control) else { return false }
        switch keyCode {
        case 124: handleAdvance(fail: false); return true                              // ⌥→ — Pass/Next
        case 123: if mode == .test { handleAdvance(fail: true) }; return true          // ⌥← — Fail (test)
        case 126: goBack(); return true                                                // ⌥↑ — Back
        case 125: beginFeedback(); return true                                         // ⌥↓ — screenshot + note
        case 46:  toggleMute(); return true                                            // ⌥M — voiceover on/off
        case 47:  model.collapsed.toggle(); return true                               // ⌥. — collapse ↔ expand the card
        case 44:  model.placement = (model.placement == .notch ? .dock : .notch); applyMousePolicy(); return true  // ⌥/ — notch ↔ dock
        case 18:  selectOption(0); return true                                        // ⌥1 — preview variant A
        case 19:  selectOption(1); return true                                        // ⌥2 — preview variant B
        case 20:  selectOption(2); return true                                        // ⌥3 — preview variant C
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

    // Public mirror of the fn-m voiceover preference, so Settings can surface the same toggle as a row.
    // Reads/writes the identical persisted key + live model as toggleMute; silences speech when turned off.
    var voiceoverOn: Bool { !model.muted }
    func setVoiceover(_ on: Bool) {
        model.muted = !on
        UserDefaults.standard.set(model.muted, forKey: "relay.guide.muted")
        if model.muted { onStopSpeak?() }
    }
}
