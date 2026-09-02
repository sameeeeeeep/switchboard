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

enum GuideMode: String { case tour, test, teach, grab }

// A picture or looping GIF shown in a step's media zone (show-don't-tell). `src` is an absolute file
// path or an http(s) URL; loaded lazily when the step appears (docs/GUIDE-CARD-SPEC §6 media states).
struct GuideMedia {
    let src: String
    var caption: String? = nil
    var tall: Bool = false   // true → render as a full board/diagram (fit, taller) instead of the 96px thumbnail
}

// A shortcut to TEACH, rendered as keycap buttons + a name (e.g. [⌃][⌃] Ask). Prominent in the card body
// so the user reads the keys as buttons, not buried in prose. `caps` = the individual keys drawn as caps.
struct GuideKeyGroup: Identifiable {
    let id = UUID()
    let caps: [String]      // e.g. ["⌃","⌃"] or ["⌥","⌥"]
    let name: String        // e.g. "Ask", "Dictate", "Launch"
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
    var copy: String? = nil         // TEXT clipboard payload to pre-load when the step shows (explicit → always loads)
    var value: String? = nil        // a value the step asks the user to TYPE — pre-copied so they paste (priority over copy)
    var copyImage: String? = nil    // IMAGE (file path / http url) to pre-load onto the clipboard — the user just pastes it
    var hold: Double? = nil         // ms to dwell before auto-advancing (teach only)
    var doneWhen: Predicate? = nil  // locally-sensed completion condition → auto-advance
    var timeoutMs: Double? = nil    // after this long, stop watching doneWhen and fall back to manual-only
    var media: GuideMedia? = nil    // an image/gif for this step (zone 4)
    var options: [GuideOption]? = nil  // A/B/C variants to compare + approve (zone 5); ⌥→ = approve selected
    var placement: String? = nil    // "notch" | "dock" | "cursor" — where the card sits (nil = smart default)
    var keys: [GuideKeyGroup]? = nil   // shortcut(s) to teach, drawn as keycap buttons (zone: taught-keys)
    var yieldsTo: String? = nil     // this step's practice opens a full surface ("launcher"|"summon"): collapse the
                                    // card while that surface is up, and advance only once it CLOSES — never draw over it
    var gated: Bool = false         // a practice step you can't ⌥→ PAST — only actually DOING it (doneWhen) advances;
                                    // onboarding must teach, not let you click through. esc still leaves.
}

// Where the presence/guide card sits. notch = fixed top-center + CLICKABLE; dock = fixed bottom (keyboard);
// cursor = rides the pointer (opt-in); free = dropped ANYWHERE by dragging the card (remembered). See docs/PRESENCE.md §2.
enum GuidePlacement: String { case notch, dock, cursor, free }

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
    case event(String)   // satisfied once the app reports this named action (summon/dictation/launcher) — the
                         // user PERFORMING the taught gesture advances the step, no ⌥→ needed
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
        case "event":
            return .event((d["name"] as? String) ?? "")
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
    var screenshot: String?          // FIRST fn-drag jpg (back-compat; = screenshots.first)
    var screenshots: [String] = []   // ALL grabs on this step — multiple fn-drags accumulate here
    var note: String?                // raw typed + dictated text, no cleanup
    var isEmpty: Bool { screenshots.isEmpty && (screenshot?.isEmpty ?? true) && (note?.isEmpty ?? true) }
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

// A lightweight NOTCH ACK (docs/GUIDE-QUEUE-RESUME.md §notch feedback): a session-side action —
// "task captured", "spec added", a "▸ Resume" offer — surfaced as a brief toast at the notch, without
// a full guided run. `kind` picks the glyph/accent; `action` (+`actionLabel`) makes it tappable.
struct GuideNotify {
    let text: String
    let kind: String            // "captured" (✓) · "info" (•) · "resume" (▸) — drives glyph + accent
    let source: String?
    let project: String?
    let action: String?         // e.g. "resume" — a tap performs it; nil = passive toast
    let actionLabel: String?
}

// One line in the PIP stream (docs/PM-NOTCH-OPERATOR.md): a PM event, kept in a rolling buffer and
// rendered as a persistent multi-thread feed at the notch when /pip mode is on. Deterministic — filled
// from the same free event writes, no model.
struct PipRow: Identifiable {
    let id = UUID(); let kicker: String; let text: String; let accent: Color; let source: String; let at: Date
}

/// Kicker label + accent for an adhd-pm event kind — one source of truth for the toast AND the PIP feed.
func pmKindStyle(_ kind: String) -> (kicker: String, accent: Color) {
    switch kind {
    case "captured": return ("CAPTURED", .lime)
    case "picked":   return ("WORKING", .lime)
    case "decided":  return ("DECIDED", .lime)
    case "spec":     return ("BOARD", .blue)
    case "thread":   return ("THREAD", .indigo)
    case "resume":   return ("RESUME", .lime)
    default:          return ("NOTE", .blue)
    }
}

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
    @Published var actionDone = false            // a GATED practice step whose real action just fired → UNLOCK ⌥→ (don't auto-jump; let them keep playing)
    @Published var canBack = false               // idx > 0 → the Back chip appears
    @Published var flash: GuideFlash? = nil       // brief ✓/✗ confirmation that a signal landed
    @Published var queueDepth: Int = 0            // >0 → "+N queued" — runs waiting behind this one (no-clobber queue)
    @Published var notify: GuideNotify? = nil     // a lightweight ack toast (e.g. "task captured"), shown when idle
    @Published var pipActive = false              // /pip mode: a persistent multi-thread event feed lives at the notch
    @Published var pipRows: [PipRow] = []         // the rolling stream, newest first (capped)
    @Published var pipFilter: String? = nil       // /pip thread selector: non-nil → feed shows ONLY this source; tap its dot again to clear
    @Published var inRun = false                  // a guided run is on screen → its card overrides the PIP feed
    @Published var done: String? = nil            // non-nil → show the completion summary card
    @Published var reduceMotion = false
    @Published var target: CGPoint? = nil         // a step's point → the ring indicates it (nil = no ring this step)
    @Published var collapsed = false              // card collapsed to a small docked pill (⌥. toggles)
    @Published var media: GuideMedia? = nil       // zone 4 — an image/gif for this step
    @Published var keys: [GuideKeyGroup] = []     // taught-keys zone — shortcut(s) as keycap buttons
    @Published var options: [GuideOption] = []    // zone 5 — A/B/C variants to compare + approve
    @Published var selectedOption = 0             // ⌥1/2/3 highlight; ⌥→ approves this one
    @Published var dockTop = false                // dock the card at the TOP when the target is in the bottom band
    @Published var placement: GuidePlacement = .dock   // notch / dock / cursor (⌥/ toggles notch↔dock)
    var placementPinned = false                        // user MOVED the card (⌥/ or ⌥;) → keep that placement across steps; don't re-derive per step
    @Published var source: String? = nil          // provenance: who's asking (thread/agent/wrapp), e.g. "Claude Code · migrate-db"
    @Published var sourceId: String? = nil        // stable THREAD identity → a deterministic colour (tell threads apart)
    @Published var project: String? = nil         // provenance: the project this run is grounded in
    @Published var clipboardHint: String? = nil   // "⌘V — pasted for you" cursor hint when a step preloads the clipboard
    @Published var applyingOption: Int? = nil     // an option is being applied live (shows the working dot-matrix)
    @Published var optionError = false            // last apply failed (danger line; never blocks)
    // Explain mode: the user asked to be TAUGHT the decision — a trade-off diagram becomes this step's
    // media (zone 4) while Moira narrates it, then the options resurface. `explaining` = generating;
    // `explained` = an explanation is showing (hide the affordance so it isn't re-triggered).
    @Published var explaining = false
    @Published var explained = false
    // The card's rendered frame in the overlay (SwiftUI top-left coords). The hosting view hit-tests ONLY
    // inside this rect so the card + its buttons are clickable while every other pixel passes clicks THROUGH.
    @Published var cardFrame: CGRect = .zero
    // Where the card sits in .cursor placement — a SNAPSHOT of the pointer (overlay top-left pts) taken
    // when ⌥; cycles into cursor mode, so the card appears where you're working and stays put (clickable).
    @Published var cursorAnchor: CGPoint = .zero
    // Free placement: the card's top-left in overlay top-left pts, set by DRAGGING the card ANYWHERE.
    // Persisted (relay.guide.free.*) so a dragged position is REMEMBERED across steps AND across runs —
    // it stays where you dropped it until you move it back (⌥/ ⌥; forget the saved spot).
    @Published var freeAnchor: CGPoint = CGPoint(
        x: UserDefaults.standard.double(forKey: "relay.guide.free.x"),
        y: UserDefaults.standard.double(forKey: "relay.guide.free.y"))
    var freeRemembered = UserDefaults.standard.bool(forKey: "relay.guide.free.set")  // a saved free spot exists
    var isDraggingCard = false        // a drag is in flight → force the overlay clickable so the gesture never drops
    @Published var dragOffset: CGSize = .zero   // live drag translation, applied WITHOUT changing placement mid-drag
                                                // (switching .notch→.free mid-gesture recreates the view + kills the drag)
    // User-chosen card WIDTH (drag the resize grip). 0 = default. Persisted + clamped [minCardW, screen−48]
    // so text always has room to wrap and never clips. Height stays content-driven with a min floor.
    @Published var userCardW: CGFloat = CGFloat(UserDefaults.standard.double(forKey: "relay.guide.cardW"))
    var isResizingCard = false        // a width-resize is in flight → keep the overlay clickable
    // Spoken voiceover on/off — persisted so it's a durable preference; toggled live with fn m.
    @Published var muted: Bool = UserDefaults.standard.bool(forKey: "relay.guide.muted")

    // Grab the card → switch to free placement and pin it (don't re-derive per step). The view sets
    // freeAnchor from the drag translation; passthrough stays clickable via isDraggingCard.
    func beginCardDrag() { placement = .free; placementPinned = true; isDraggingCard = true }
    // Release → persist the dropped spot so it's remembered next run.
    func endCardDrag() {
        isDraggingCard = false; freeRemembered = true
        let d = UserDefaults.standard
        d.set(Double(freeAnchor.x), forKey: "relay.guide.free.x")
        d.set(Double(freeAnchor.y), forKey: "relay.guide.free.y")
        d.set(true, forKey: "relay.guide.free.set")
    }
    // Moving the card via the keyboard (⌥/ ⌥;) forgets the saved free spot so it won't snap back.
    func forgetFree() { freeRemembered = false; UserDefaults.standard.set(false, forKey: "relay.guide.free.set") }
    // Dropped in the notch zone → re-dock to the notch (don't persist a free spot). The affordance:
    // drag the card home and it snaps back where it belongs.
    func snapToNotch() { isDraggingCard = false; placement = .notch; forgetFree() }

    static let minCardW: CGFloat = 320   // never let the card get narrow enough to break text
    static let defCardW: CGFloat = 600
    // Set the width live while dragging the resize grip (clamped to sane bounds; screen clamp is in the view).
    func setCardWidth(_ w: CGFloat) { isResizingCard = true; userCardW = max(GuideOverlayModel.minCardW, w) }
    // Release the grip → persist the chosen width so it's remembered next run.
    func endCardResize() {
        isResizingCard = false
        UserDefaults.standard.set(Double(userCardW), forKey: "relay.guide.cardW")
    }
}

// Reports the guide card's rendered frame (SwiftUI top-left coords) up to the overlay, so the hosting
// view can hit-test clicks against exactly the card's rect and pass every other pixel through.
struct GuideCardFrameKey: PreferenceKey {
    static var defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let n = nextValue(); if n != .zero { value = n }
    }
}

// MARK: - The caption chip (rides the cursor)

/// A small frosted/dark chip anchored below-right of the pointer, click-through, lime-accented.
/// Flips to the other side of the pointer near a screen edge. Honors reduce-motion (no pulsing).
struct GuideCaptionView: View {
    @ObservedObject var m: GuideOverlayModel
    @State private var ringPulse = false
    @State private var dragOrigin: CGPoint? = nil   // card's top-left captured at drag-start (nil = not dragging)
    // Responsive width: the user's chosen width (resize grip) or the 600 default, clamped to a MIN (so text
    // never crushes/breaks) and to the screen width (24pt margin each side, never past the notch).
    private var cardW: CGFloat {
        let target = m.userCardW > 0 ? m.userCardW : GuideOverlayModel.defCardW
        guard m.screenSize.width > 0 else { return max(target, GuideOverlayModel.minCardW) }
        let maxW = max(GuideOverlayModel.minCardW, m.screenSize.width - 48)
        return min(max(target, GuideOverlayModel.minCardW), maxW)
    }

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
                // The card IS hit-testable (its buttons + option cards must click). The overlay only ever
                // captures clicks WITHIN the reported card frame — the hosting view passes everything else
                // through — so the app underneath stays fully interactive.
                placedCard
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .animation(.easeOut(duration: 0.16), value: m.collapsed)
                    .animation(.easeOut(duration: 0.18), value: m.placement)
            }
        }
        .ignoresSafeArea()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onPreferenceChange(GuideCardFrameKey.self) { m.cardFrame = $0 }
        .onAppear { ringPulse = true }
    }

    @ViewBuilder private var placedCard: some View {
        switch m.placement {
        case .notch:
            VStack(spacing: 0) { cardOrPill; Spacer(minLength: 0) }   // flush at top — the drop merges into the notch
        case .cursor:
            // Anchored at the pointer snapshot (⌥; into cursor mode), offset down-right so it doesn't sit
            // under the cursor, clamped so the whole card stays on-screen. Publishes its frame like the
            // others → the click-tracking follows it here too.
            VStack(spacing: 0) { HStack(spacing: 0) { cardOrPill; Spacer(minLength: 0) }; Spacer(minLength: 0) }
                .offset(cursorOffset)
        case .free:
            // Dropped anywhere by dragging the card — sits at its remembered anchor, stays put + clickable.
            VStack(spacing: 0) { HStack(spacing: 0) { cardOrPill; Spacer(minLength: 0) }; Spacer(minLength: 0) }
                .offset(freeOffset)
        case .dock:
            VStack(spacing: 0) {
                if m.dockTop { cardOrPill; Spacer(minLength: 0) } else { Spacer(minLength: 0); cardOrPill }
            }.padding(m.dockTop ? .top : .bottom, 54)
        }
    }

    // The card's top-left offset in .cursor placement: near the pointer snapshot (+14,+14 so it clears
    // the cursor), clamped so the whole card stays on-screen.
    private var cursorOffset: CGSize {
        let cw = cardW
        let ax = min(max(m.cursorAnchor.x + 14, 8), max(8, m.screenSize.width - cw - 8))
        let ay = min(max(m.cursorAnchor.y + 14, 8), max(8, m.screenSize.height - 380))
        return CGSize(width: ax, height: ay)
    }

    // The card's top-left offset in .free placement: the dragged anchor, clamped so it can't leave the
    // screen (keeps the full width on, and at least the header band vertically reachable).
    private var freeOffset: CGSize {
        let cw = cardW
        let ax = min(max(m.freeAnchor.x, 8), max(8, m.screenSize.width - cw - 8))
        let ay = min(max(m.freeAnchor.y, 8), max(8, m.screenSize.height - 120))
        return CGSize(width: ax, height: ay)
    }

    @ViewBuilder private var cardOrPill: some View {
        Group {
            if m.collapsed {
                collapsedPill
            } else {
                card.frame(width: cardW, alignment: .leading)
                    .frame(minHeight: 60, alignment: .topLeading)   // never a sliver — text always has room
                    // Native-style EDGE resize: invisible strips on BOTH side edges (cursor → ↔), drag either
                    // to resize — like a real window (the opposite edge stays put). Only when detached from the
                    // notch (the notch shape clips edges). Height auto-fits content, so no top/bottom handles.
                    .overlay(alignment: .trailing) { if m.placement != .notch { edgeResize(leading: false) } }
                    .overlay(alignment: .leading)  { if m.placement != .notch { edgeResize(leading: true) } }
            }
        }
        // Publish the card's actual on-screen rect so the hosting view knows exactly where clicks land.
        .background(GeometryReader { geo in
            Color.clear.preference(key: GuideCardFrameKey.self, value: geo.frame(in: .global))
        })
        // Live drag follows here — applied AFTER the frame is published, and dragOrigin is captured once
        // (while this is .zero), so the base position never double-counts the offset.
        .offset(m.dragOffset)
        .gesture(cardDrag)
    }

    // Native-style edge resize: an invisible ~8pt strip down the card's right edge. Hovering it shows the
    // ↔ resize cursor; dragging it left/right resizes the card width — exactly like dragging a window edge.
    // Bounded by the responsive clamp (min so text never breaks, max = screen) and remembered next run.
    // highPriority so the edge-drag wins over the card-move drag when you grab the edge.
    @State private var resizeStartW: CGFloat? = nil
    @State private var resizeStartAnchorX: CGFloat? = nil
    private func edgeResize(leading: Bool) -> some View {
        Color.clear
            .frame(width: 8)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .highPriorityGesture(
                DragGesture(minimumDistance: 2, coordinateSpace: .global)
                    .onChanged { v in
                        if resizeStartW == nil { resizeStartW = cardW; resizeStartAnchorX = m.freeAnchor.x }
                        let startW = resizeStartW ?? cardW
                        // Right edge grows with a rightward drag; left edge grows with a leftward drag.
                        m.setCardWidth(leading ? startW - v.translation.width : startW + v.translation.width)
                        // Left-edge resize keeps the RIGHT edge fixed: shift the free anchor by the actual width change.
                        if leading, m.placement == .free {
                            m.freeAnchor.x = (resizeStartAnchorX ?? m.freeAnchor.x) + (startW - cardW)
                        }
                    }
                    .onEnded { _ in resizeStartW = nil; resizeStartAnchorX = nil; m.endCardResize() }
            )
    }

    // Pick the card up and drop it ANYWHERE — a real free-drag. Grabbing it switches to .free placement
    // and moves the card by the drag translation from wherever it currently sits (no jump: the base is the
    // card's live top-left). On release the spot is pinned + persisted so it's remembered next run.
    // minimumDistance keeps taps on the card's buttons/option cards working — a click is not a drag.
    private var cardDrag: some Gesture {
        DragGesture(minimumDistance: 6, coordinateSpace: .global)
            .onChanged { v in
                // Do NOT change placement here: switching .notch→.free mid-gesture rebuilds the view tree
                // and cancels the drag (the old "first drag detaches, second one moves it" bug). Instead
                // the card follows a live offset; placement only commits on release, so one drag does it.
                if dragOrigin == nil { dragOrigin = m.cardFrame.origin; m.isDraggingCard = true }
                m.dragOffset = v.translation
            }
            .onEnded { v in
                let base = dragOrigin ?? m.cardFrame.origin
                dragOrigin = nil
                m.dragOffset = .zero
                let finalX = base.x + v.translation.width, finalY = base.y + v.translation.height
                // Dropped in the notch zone (top band, roughly centred) → re-dock; else float at the drop.
                let inNotchZone = finalY < 72 && abs(finalX + cardW / 2 - m.screenSize.width / 2) < 220
                if inNotchZone { m.snapToNotch() }
                else { m.freeAnchor = CGPoint(x: finalX, y: finalY); m.placement = .free; m.placementPinned = true; m.endCardDrag() }
            }
    }

    // Collapsed: a small docked pill — a live pulse, the step count, and how to bring the card back.
    private var collapsedPill: some View {
        HStack(spacing: 8) {
            Circle().fill(Color.lime).frame(width: 6, height: 6).shadow(color: Color.lime.opacity(0.7), radius: 3)
            Text("\(m.stepIndex + 1)/\(max(m.stepTotal, 1))").font(.splMono(10)).foregroundColor(.ink)
            Text("guide").font(.hanken(11, .semibold)).foregroundColor(.inkDim)
            Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 8)).foregroundColor(.inkFaint)
            Text("tap · ⌥.").font(.splMono(8.5)).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(chipBackground)
        .contentShape(Capsule())
        .onTapGesture { m.collapsed = false }   // the pill is tappable to reopen (⌥. also works) — the minimise button's inverse
    }

    @ViewBuilder private var card: some View {
        if let n = m.notify {
            notifyCard(n)
        } else if let summary = m.done {
            summaryCard(summary)
        } else if m.pipActive && !m.inRun {
            pipFeedCard            // /pip resting state: the persistent multi-thread stream
        } else {
            stepCard
        }
    }

    // PIP FEED — ONE event at a time, in Switchboard's dot-matrix language (Doto face + an animated
    // DotMatrix beacon), not a stacked list (founder 2026-08-24). The latest event is the display; a "+N"
    // counts the ones behind it. Deterministic — every event came from a free write, no model. Draggable
    // off the notch (the shared cardDrag gesture) to sit anywhere.
    //
    // Two controls the founder asked for (2026-08-24):
    //   • DISMISS  — a ✕ in the header hides the whole feed (writes ~/.relay/pip.json active:false; reopen
    //                with /pip). No model, reversible.
    //   • THREAD FILTER — each distinct source is a tappable per-thread colour dot; tap one to show ONLY
    //                that thread, tap it again (or the whole-feed dot) to clear. Deterministic; free.

    // Distinct event sources in the buffer, most-recent first — the thread dots. The active filter's source
    // is kept present even if its rows have scrolled out of the 8-row buffer, so the user can always clear it.
    private var pipSources: [String] {
        var seen = Set<String>(); var out: [String] = []
        for row in m.pipRows where !row.source.isEmpty && row.source != "•" {
            if seen.insert(row.source).inserted { out.append(row.source) }
        }
        if let f = m.pipFilter, !f.isEmpty, !seen.contains(f) { out.append(f) }
        return out
    }
    // The rows the feed actually shows — all of them, or just the selected thread's when a filter is on.
    private var pipVisibleRows: [PipRow] {
        guard let f = m.pipFilter else { return m.pipRows }
        return m.pipRows.filter { $0.source == f }
    }

    private var pipFeedCard: some View {
        let sources = pipSources
        let rows = pipVisibleRows
        let r = rows.first
        return VStack(alignment: .leading, spacing: 10) {
            // ── header: PIP badge · +N behind · dismiss ✕ ──
            HStack(spacing: 7) {
                Circle().fill(Color.lime).frame(width: 6, height: 6).shadow(color: Color.lime.opacity(0.7), radius: 3)
                Text("PIP").font(.splMono(9)).tracking(1.6).foregroundColor(.lime)
                Spacer(minLength: 0)
                if rows.count > 1 {
                    Text("+\(rows.count - 1)").font(.splMono(8.5)).foregroundColor(.inkFaint)
                }
                // DISMISS — hide the feed (persists pip.json active:false; /pip brings it back).
                Button(action: { CursorGuide.shared.dismissPip() }) {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundColor(.inkDim)
                        .frame(width: 18, height: 18)
                        .background(Circle().fill(Color.white.opacity(0.06)))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Dismiss the PIP feed — reopen with /pip")
            }
            // ── thread selector: one tappable colour dot per thread (only worth showing with ≥2 threads,
            //    or while a filter is pinned). Tap a dot to filter to that thread; tap again to clear. ──
            if sources.count >= 2 || m.pipFilter != nil {
                HStack(spacing: 6) {
                    Text(m.pipFilter == nil ? "THREADS" : "ONLY").font(.splMono(7.5)).tracking(0.8)
                        .foregroundColor(m.pipFilter == nil ? .inkFaint : .lime)
                    // "all" dot: clears the filter (highlighted when nothing is filtered).
                    pipDot(source: nil, on: m.pipFilter == nil)
                    ForEach(sources, id: \.self) { s in
                        pipDot(source: s, on: m.pipFilter == s)
                    }
                    Spacer(minLength: 0)
                }
            }
            // ── body: the shown event, or an empty/quiet state ──
            if let r {
                HStack(alignment: .center, spacing: 13) {
                    DotMatrix(pattern: .working, accent: r.accent, cols: 6, rows: 6, dot: 2, gap: 2.4,
                              animated: !m.reduceMotion)
                        .frame(width: 42, height: 42)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(r.kicker).font(.splMono(8.5)).tracking(0.9).foregroundColor(r.accent)
                            Spacer(minLength: 0)
                            Text(pipAgo(r.at)).font(.splMono(8.5)).foregroundColor(.inkFaint)
                        }
                        Text(r.text).font(.doto(15, .bold)).foregroundColor(.ink)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: 5) {
                            Circle().fill(colorForId(r.source)).frame(width: 5, height: 5)
                            Text(r.source).font(.splMono(8)).foregroundColor(.inkFaint).lineLimit(1)
                        }
                    }
                }
            } else if let f = m.pipFilter {
                // Filtered to a thread that has nothing in the buffer (yet) — quiet, not broken.
                HStack(alignment: .center, spacing: 13) {
                    Circle().fill(colorForId(f)).frame(width: 10, height: 10).opacity(0.6)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("THREAD QUIET").font(.doto(12, .bold)).tracking(1).foregroundColor(.inkFaint)
                        Text("waiting for \(f)").font(.splMono(8)).foregroundColor(.inkFaint).lineLimit(1)
                    }
                }
            } else {
                Text("WATCHING YOUR THREADS").font(.doto(12, .bold)).tracking(1).foregroundColor(.inkFaint)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, m.placement == .notch ? 20 : SB.s3)
        .padding(.top, m.placement == .notch ? 24 : SB.s3)
        .padding(.bottom, m.placement == .notch ? 13 : SB.s3)
        .modifier(CardChrome(notch: m.placement == .notch))
    }

    // One thread-selector dot. `source == nil` is the "all" dot (clears the filter). `on` = currently the
    // active selection → lime ring + full size; otherwise the thread's own deterministic colour, dimmed.
    // A generous 20pt hit area wraps the small visible dot so it's tappable at the notch.
    private func pipDot(source: String?, on: Bool) -> some View {
        let fill: Color = source == nil ? .inkDim : colorForId(source!)
        return Circle().fill(fill)
            .frame(width: on ? 9 : 7, height: on ? 9 : 7)
            .opacity(on ? 1 : 0.5)
            .overlay(Circle().stroke(Color.lime, lineWidth: on ? 1.5 : 0).padding(-3))
            .frame(width: 20, height: 20)          // hit target
            .contentShape(Circle())
            .onTapGesture { CursorGuide.shared.tapPipFilter(source) }
            .help(source == nil ? "Show all threads" : "Show only \(source!)")
    }
    private func pipAgo(_ d: Date) -> String {
        let s = Int(max(0, Date().timeIntervalSince(d)))
        if s < 5 { return "now" }; if s < 60 { return "\(s)s" }
        let m = s / 60; if m < 60 { return "\(m)m" }; return "\(m/60)h"
    }

    // NOTCH ACK card — built from the SAME notch grammar as the guide card (provenance dot + ⌘source +
    // ◆project · splMono kicker · Hanken body · NotchDropShape chrome), NOT a bespoke look. A notify is a
    // "I heard you" for a session-side action (/task), so it shows the kicker + the thing, no step chrome.
    private func notifyCard(_ n: GuideNotify) -> some View {
        // The adhd-pm event vocabulary (docs/PM-NOTCH-OPERATOR.md) — each kind a distinct kicker + accent
        // so the stream reads at a glance: what just happened, in which thread's colour.
        let (kicker, accent): (String, Color) = {
            switch n.kind {
            case "captured": return ("CAPTURED → BOARD", .lime)
            case "picked":   return ("▸ WORKING", .lime)
            case "decided":  return ("✓ DECIDED", .lime)
            case "spec":     return ("BOARD UPDATED", .blue)
            case "thread":   return ("NEW THREAD", .indigo)
            case "resume":   return ("RESUME", .lime)
            default:          return ("HEADS UP", .blue)
            }
        }()
        // The caller may pass "Task captured: <thing>"; the kicker already says CAPTURED, so show just the thing.
        let body = n.text
            .replacingOccurrences(of: "Task captured: ", with: "")
            .replacingOccurrences(of: "Task captured:", with: "")
        return VStack(alignment: .leading, spacing: 8) {
            // provenance — the guide card's exact grammar: per-thread colour dot + ⌘source + ◆project
            if (n.source?.isEmpty == false) || (n.project?.isEmpty == false) {
                HStack(spacing: 7) {
                    if let s = n.source, !s.isEmpty {
                        Circle().fill(colorForId(s)).frame(width: 7, height: 7)
                            .shadow(color: colorForId(s).opacity(0.6), radius: 2)
                        Text("⌘ \(s)").font(.splMono(9)).foregroundColor(.inkDim).lineLimit(1)
                    }
                    if let p = n.project, !p.isEmpty {
                        Text("◆ \(p)").font(.splMono(9)).foregroundColor(.indigo).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }
            // kicker (what happened) — no dot: the provenance row already carries the identity dot, a
            // second lime dot here just reads as redundant.
            Text(kicker).font(.splMono(9)).tracking(1.2).foregroundColor(accent).lineLimit(1)
            // body (the thing)
            Text(body).font(.hanken(13, .medium)).foregroundColor(.ink)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let a = n.action, let label = n.actionLabel {
                GuideActionChip(combo: "⌥→", label: label, primary: true, onTap: { notifyAction(a) })
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, m.placement == .notch ? 20 : SB.s3)
        // Just enough to clear the physical notch — the guide card's 34 is too airy for a compact ack.
        .padding(.top, m.placement == .notch ? 24 : SB.s3)
        .padding(.bottom, m.placement == .notch ? 13 : SB.s3)
        .modifier(CardChrome(notch: m.placement == .notch))
    }

    // The action chips, split into a PRIMARY row (advance / fail / back) and a META row (feedback / mute /
    // close). Two rows so labels never wrap or get cut in the 300pt card, whatever the count. Primary
    // (Pass/Next) is lime. Back is hidden on step 1 (nothing to go back to); Fail only exists in test mode.
    // Accelerators use ⌃⌘+arrow — NOT fn+arrow, which macOS maps to PageUp/PageDown and scrolls the app
    // underneath the guide. (Manual advance is also a click on the chip; auto-advance is the primary path.)
    private var primaryActions: [(combo: String, label: String, primary: Bool)] {
        var a: [(String, String, Bool)] = []
        if !m.options.isEmpty {                                   // options step → click/⌥1·2·3 to pick, then approve
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
        [("⌥↓", "Note", false),                             // say it in your own words (or a screenshot) — any mode
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
    private func notifyAction(_ action: String) { CursorGuide.shared.performNotifyAction(action) }

    private func chipTap(_ label: String) {
        switch label {
        case "Next", "Pass", "Approve": CursorGuide.shared.tapPrimary()
        case "Fail":                     CursorGuide.shared.tapFail()
        case "Back":                     CursorGuide.shared.tapBack()
        case "Note":                     CursorGuide.shared.tapFeedback()
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

    // The line under the SWITCHBOARD wordmark: WHO is asking + which project (provenance), else the run
    // title. Nil when there's nothing to say (a bare guide) → the wordmark sits alone.
    private var headerKicker: String? {
        var parts: [String] = []
        if let s = m.source, !s.isEmpty { parts.append(s) }
        else if let t = m.title, !t.isEmpty { parts.append(t) }
        if let p = m.project, !p.isEmpty { parts.append(p) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // Zone 5: the A/B/C variant cards. Each shows its media (or an accent swatch), a bold label, and a
    // one-line "why" (adhd-pm: make the trade-off scannable). The ⭐recommended one is pre-selected + badged
    // so a single ⌥→ / click takes it. Selected = lime border. Tappable at the notch. ⌥→ approves.
    private var optionsRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Text("PICK ONE — UPDATES LIVE").font(.splMono(9.5)).tracking(0.6).foregroundColor(.indigo)
                if m.options.contains(where: { $0.recommended }) {
                    Text("★ recommended").font(.splMono(9)).foregroundColor(.lime.opacity(0.9))
                }
                Spacer(minLength: 6)
                // Explain: teach me this trade-off first — Moira narrates a generated diagram, then the
                // options resurface. Shown only when a live explainer is wired + not already explained.
                if CursorGuide.shared.onExplain != nil && !m.explained {
                    Button(action: { CursorGuide.shared.requestExplain() }) {
                        HStack(spacing: 3) {
                            Image(systemName: m.explaining ? "waveform" : "sparkles").font(.system(size: 8, weight: .bold))
                            Text(m.explaining ? "explaining…" : "Explain").font(.splMono(9)).tracking(0.4)
                        }.foregroundColor(m.explaining ? .inkFaint : .lime)
                         .padding(.horizontal, 7).padding(.vertical, 3)
                         .background(Capsule().fill(Color.lime.opacity(0.08)))
                         .overlay(Capsule().stroke(Color.lime.opacity(m.explaining ? 0.2 : 0.4), lineWidth: 1))
                    }.buttonStyle(.plain).disabled(m.explaining)
                     .help("Teach me this decision — a diagram + a spoken walk-through before I pick")
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
        return VStack(alignment: .leading, spacing: 6) {
            // Media zone ONLY when the option actually carries media (show diagrams/images when needed). An
            // explicit accent gets a THIN bar — never a big filled block. Neither → a clean text-only card.
            if let md = opt.media {
                GuideMediaView(media: md, reduceMotion: m.reduceMotion, compact: true)
            } else if let ac = opt.accent, !ac.isEmpty {
                RoundedRectangle(cornerRadius: 2).fill(accentColor(ac))
                    .frame(maxWidth: .infinity).frame(height: 3)
            }
            // labels + details WRAP FULLY (cards grow vertically) — a cut "Build voi…" is an unreadable option
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(sel ? "\(letter)✓" : letter).font(.splMono(10.5)).foregroundColor(sel ? .lime : .inkFaint)
                Text(opt.label).font(.hanken(13.5, .semibold)).foregroundColor(sel ? .ink : .inkSec)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let d = opt.detail, !d.isEmpty {
                Text(d).font(.hanken(11.5)).foregroundColor(.inkDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.xs).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: SBr.xs)
            .stroke(sel ? Color.lime : (opt.recommended ? Color.lime.opacity(0.4) : Color.edge), lineWidth: sel ? 1.5 : 1))
        .overlay(alignment: .topTrailing) {
            if opt.recommended {
                Text("★").font(.system(size: 9)).foregroundColor(.lime)
                    .padding(3).background(Circle().fill(Color.page.opacity(0.85))).padding(4)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { CursorGuide.shared.tapOption(i) }   // click = pick; click the already-picked one = approve
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
            // ── dot-matrix header: the SWITCHBOARD wordmark + provenance kicker. This is the notch identity
            //    every guide/onboarding card now wears (founder 2026-08-31: "our notch should look like the
            //    mockup"). The Doto lamp wordmark + lime is the brand mark; the per-thread dot + source/project
            //    become the kicker underneath, so a card is still never a mystery. ──
            HStack(spacing: 9) {
                DotMatrix(pattern: .working, accent: .lime, cols: 5, rows: 3, dot: 2, gap: 2, animated: !m.reduceMotion)
                VStack(alignment: .leading, spacing: 1) {
                    Text("SWITCHBOARD").font(.doto(11.5, .heavy)).tracking(0.6).foregroundColor(.lime)
                        .shadow(color: .lime.opacity(0.30), radius: 5)
                    if let kick = headerKicker {
                        HStack(spacing: 5) {
                            if let s = m.source, !s.isEmpty {
                                Circle().fill(colorForId(m.sourceId ?? s)).frame(width: 6, height: 6)
                                    .shadow(color: colorForId(m.sourceId ?? s).opacity(0.6), radius: 2)
                            }
                            Text(kick).font(.splMono(9.5)).foregroundColor(.inkDim).lineLimit(1).truncationMode(.tail)
                        }
                    }
                }
                Spacer(minLength: 0)
                // No-clobber queue: how many runs are waiting behind this one (docs/GUIDE-QUEUE-RESUME.md).
                if m.queueDepth > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "square.stack.3d.up.fill").font(.system(size: 8)).foregroundColor(.inkDim)
                        Text("+\(m.queueDepth)").font(.splMono(9)).foregroundColor(.inkDim)
                    }
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Capsule().fill(Color.white.opacity(0.06)))
                    .help("\(m.queueDepth) more queued — they run when this one ends")
                }
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
                // MINIMISE — a real tappable button; ⌥. also collapses. The pill (tap) or ⌥. reopens it.
                Button(action: { m.collapsed = true }) {
                    Text("⌥.").font(.splMono(9)).foregroundColor(.inkFaint)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().stroke(Color.edge, lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .help("Minimise to a pill (⌥.)")
            }
            // ── progress: a FULL-WIDTH segment bar + STEP n / N in the Doto face (mockup layout — the bar was
            //    a cramped 92pt sliver crammed beside the title; now it reads across the whole card). ──
            VStack(alignment: .leading, spacing: 6) {
                segmentBar
                Text("STEP \(min(m.stepIndex + 1, max(m.stepTotal, 1))) / \(max(m.stepTotal, 1))")
                    .font(.doto(9.5, .bold)).tracking(1.4).foregroundColor(.inkFaint)
            }
            // ── permission strip: keys need Accessibility. Shown only when not trusted; the guide still
            //    renders + esc works, but keyboard signals won't fire until granted (spec §6). ──
            if !AXIsProcessTrusted() {
                Button(action: { CursorGuide.shared.openAccessibilitySettings() }) {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundColor(.danger)
                        Text("Keys need Accessibility — tap to open Settings").font(.hanken(10, .medium)).foregroundColor(.danger)
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.forward.app").font(.system(size: 9)).foregroundColor(.danger.opacity(0.85))
                    }
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: SBr.xs).fill(Color.danger.opacity(0.12)))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
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
            // ── taught-keys zone: the shortcut(s) this step teaches, as keycap buttons (⌃⌃ Ask, …) ──
            if !m.keys.isEmpty {
                HStack(spacing: 8) {
                    ForEach(m.keys) { g in KeyChip(group: g) }
                    Spacer(minLength: 0)
                }
                .padding(.top, 1)
            }
            // ── zone 4: media (image / gif) ──
            if let media = m.media {
                GuideMediaView(media: media, reduceMotion: m.reduceMotion, compact: false)
                    .allowsHitTesting(false)   // display-only — never let the image swallow the card's drag/clicks
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
                        GuideActionChip(combo: act.combo, label: act.label, primary: act.primary,
                                        onTap: { chipTap(act.label) })
                    }
                }
                HStack(spacing: 5) {
                    ForEach(Array(metaActions.enumerated()), id: \.offset) { _, act in
                        GuideActionChip(combo: act.combo, label: act.label, primary: act.primary,
                                        onTap: { chipTap(act.label) })
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

// One keyboard key drawn as a physical keycap.
struct KeyCap: View {
    let glyph: String
    var big = false
    var filled = false            // lime-filled (the primary action) vs raised
    // recessed = a blackish, slightly-transparent key that sits ON a coloured BUTTON (Deny/Approve) — a
    // pressed-in cap, not the grey raised chip (which is for caps on the black notch). Founder 2026-08-13.
    var recessed = false
    var body: some View {
        Text(glyph)
            .font(.splMono(big ? 12 : 9.5))
            .foregroundColor(recessed ? .ink : (filled ? .page : .ink))
            .frame(minWidth: big ? 20 : 13)
            .padding(.horizontal, big ? 6 : 4).padding(.vertical, big ? 4 : 2)
            .background(
                RoundedRectangle(cornerRadius: big ? 6 : 4)
                    .fill(recessed ? Color.black.opacity(0.22) : (filled ? Color.lime : Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: big ? 6 : 4).stroke(recessed || filled ? Color.clear : Color.edge, lineWidth: 1))
            )
    }
}

// A taught shortcut rendered as a button: its keycaps + a name (e.g. [⌃][⌃] Ask). The prominent, scannable
// way to teach a hotkey — keys as buttons, not prose.
struct KeyChip: View {
    let group: GuideKeyGroup
    var body: some View {
        HStack(spacing: 7) {
            HStack(spacing: 3) { ForEach(Array(group.caps.enumerated()), id: \.offset) { _, c in KeyCap(glyph: c, big: true) } }
            if !group.name.isEmpty {
                Text(group.name).font(.hanken(12.5, .semibold)).foregroundColor(.ink).lineLimit(1).fixedSize()
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color.page.opacity(0.45))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1)))
    }
}

// A tappable action button: the LABEL on top, its keyboard shortcut as a small mono caption UNDERNEATH.
// Flat editorial look — hairline border, lime fill for the primary (Approve/Next/Pass), no gradients/emoji.
// The guide card's action buttons now render through the ONE canonical SBButton (RelayMenuBar.swift) —
// primary = solid lime CTA, Fail = danger, the rest = ghost, matching every other surface. The tap is a
// no-op here: the card routes clicks through chipTap + the keyboard handler (a parent .onTapGesture on
// the row), so this only needs the button's LOOK. Keeps this adapter's combo/label/primary API so the
// call sites are untouched; the STYLE is now shared + single-source.
struct GuideActionChip: View {
    let combo: String   // the shortcut caption, e.g. "⌥→", "esc"
    let label: String   // e.g. "Approve", "Close"
    let primary: Bool
    var onTap: () -> Void = {}
    private var style: SBButtonStyle { primary ? .primary : (label == "Fail" ? .danger : .ghost) }
    var body: some View {
        SBButton(label: label, style: style, kbd: combo, fullWidth: true, action: onTap)
    }
}

// Zone 4 / option thumbnail — loads a local file path OR an http(s) url. While loading: the working
// dot-matrix. On failure: a small "preview unavailable" (the instruction still stands — spec §6 media).
struct GuideMediaView: View {
    let media: GuideMedia
    var reduceMotion = false
    var compact = false
    // Media is NEVER cropped — an option mockup a user has to compare must be shown WHOLE (a 40px .fill sliver
    // was unreadable: you saw a strip of one board, not the layout). So compact media fits the card width and
    // its height tracks that width, capped — which means it GROWS when the notch/card is expanded and shrinks
    // on the narrow drop, instead of a dead fixed tile. `tall` just raises the band for a portrait mockup. A
    // STEP diagram (non-compact) fits at a taller cap. Both dynamic — a fixed box chops wide diagrams/mockups.
    private let stepCapH: CGFloat = 460
    private var fillMode: ContentMode { .fit }   // all media FITS (no crop) — option mockups included

    var body: some View {
        Group {
            if compact {
                content.frame(maxWidth: .infinity)
                    .frame(minHeight: media.tall ? 220 : 120, maxHeight: media.tall ? 480 : 300)
            } else {
                // dynamic: image sizes to width by aspect (fit), height capped so tall boards don't overflow
                content.frame(maxWidth: .infinity).frame(maxHeight: stepCapH)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: SBr.xs))
        .overlay(RoundedRectangle(cornerRadius: SBr.xs).stroke(Color.edge, lineWidth: 1))
    }

    @ViewBuilder private var content: some View {
        if media.src.hasPrefix("http"), let url = URL(string: media.src) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: fillMode)
                case .failure: unavailable
                default: loading
                }
            }
        } else if let img = NSImage(contentsOfFile: media.src) {
            Image(nsImage: img).resizable().aspectRatio(contentMode: fillMode)
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

// The overlay's hosting view. The overlay is full-screen, but only the CARD should catch clicks — every
// other pixel must pass through to the app underneath. So we hit-test against the card's reported frame
// (model.cardFrame, in SwiftUI `.global`/top-left coords): a point inside it resolves to the SwiftUI
// control there (button / option card); a point outside returns nil, which lets AppKit deliver the click
// to the window below. When the card is hidden or collapsed we return nil everywhere → the overlay is
// fully click-through (a pure ring/hint step). (Subclasses NSHostingView directly — NoInsetHostingView is
// `final` — and drops the safe-area inset the same way.)
final class GuideHostingView: NSHostingView<GuideCaptionView> {
    weak var model: GuideOverlayModel?
    override var safeAreaInsets: NSEdgeInsets { NSEdgeInsets() }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }   // first click lands even when not key
    override func hitTest(_ point: NSPoint) -> NSView? {
        MainActor.assumeIsolated {
            guard let m = model, m.visible, !m.collapsed, m.cardFrame.width > 1 else { return nil }
            let local = convert(point, from: superview)   // this view's own coords
            // cardFrame is SwiftUI top-left; make the point top-left too regardless of the view's flip.
            let tl = isFlipped ? local : CGPoint(x: local.x, y: bounds.height - local.y)
            guard m.cardFrame.contains(tl) else { return nil }
            return super.hitTest(point)
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

    // Per-step side effect: fired with the step id whenever a step becomes active, so the app can
    // ACTIVELY INITIALIZE that beat's surface (onboarding §10: the operator sets the thing up, the user
    // does it). e.g. onboarding's "first-wrapp" beat opens a real seeded wrapp when it's reached.
    var onStepEnter: ((_ id: String) -> Void)?

    // The live-apply hook (Redline-style options). CursorGuide only knows WHICH variant the user is
    // eyeing/approved; APPLYING it to the real work (re-render the doc/page) is the app/wrapp's job.
    // preview = ⌥1/2/3 (compare live); approve = ⌥→. Absent → options are still recorded, just not applied.
    var onOptionPreview: ((_ stepId: String, _ optionId: String) -> Void)?
    var onOptionApprove: ((_ stepId: String, _ optionId: String) -> Void)?

    // Explain mode: the user tapped "Explain" on a decision card to be TAUGHT the trade-off before
    // picking. RelayController generates a diagram + a short Moira voiceover grounded in the question +
    // options, shows the diagram as this step's media (showExplanation), and speaks it (onSpeak). Absent
    // → the Explain affordance stays hidden. See docs/NOTCH-EXPLAIN.md.
    var onExplain: ((_ stepId: String, _ question: String, _ options: [GuideOption]) -> Void)?

    // Teach mode senses locally. CursorGuide owns no sensor, so RelayController injects a closure that
    // returns a fresh AmbientSignal (frontmost app / window title / url / focused-field value). The
    // doneWhen watcher samples this to decide when a step is locally "done". nil → AX predicates no-op
    // (manual-only), which is a safe degrade, never a wedge.
    var sampleSignal: (() -> AmbientSignal?)?

    // The header for the ⌥↓ note field. ⌥↓ is a GENERAL "say it in your own words" input — a note or a
    // freeform answer — NOT always a problem report. Only frame it as an error when the current step was
    // actually marked failed; every other case is neutral (a positive "pass, but…" note read as an error
    // was the tell). Read by the note-field UI in RelayMenuBar.
    var feedbackPrompt: (title: String, icon: String, danger: Bool) {
        if mode == .test, idx >= 0, idx < results.count, results[idx].verdict == "fail" {
            return ("What went wrong?", "exclamationmark.bubble.fill", true)
        }
        return ("In your own words", "text.bubble.fill", false)
    }

    // Direct grab (mode:"grab") — the /screen + /reference path. No guide card, no pill, no ⌥↓ to arm:
    // set up ONE synthetic result and drop straight into the feedback grab + note panel (fn+drag captures,
    // multiple accumulate, note field owns the top of the screen). ↵ saves → the run finishes and writes
    // guide-result.json with feedback.screenshots + note, exactly like the normal feedback path.
    private func beginGrab(title: String, source: String?, project: String?) {
        self.steps = [GuideStep(id: "grab", text: title, hint: nil)]
        self.idx = 0
        self.results = [GuideResult(id: "grab", text: title, verdict: "done", notedAt: nil)]
        self.startedAt = Date()
        self.isActive = true
        self.autoClipboard = false
        clipboardSaved = false; savedClipboard = nil
        model.source = source
        model.project = project
        model.mode = .grab
        model.done = nil; model.target = nil
        model.visible = false               // never render a card — the note panel is the only surface
        ensureOverlay()                     // the overlay panel exists (invisible) so keys/monitors work
        installMonitors()
        beginFeedback()                     // straight into the grab + note
    }

    // Enter capture for the CURRENT step. The verdict is already set by the time this runs, so it
    // never changes it — it just opens capture.
    private func beginFeedback() {
        guard isActive, idx < results.count, !capturingFeedback else { return }
        capturingFeedback = true
        feedbackIdx = idx
        if results[idx].feedback == nil { results[idx].feedback = StepFeedback() }
        // Hide the guide card/pill ENTIRELY while capturing, so the feedback note panel owns the top of the
        // screen (no collapsed pill sitting above it). Restored on endFeedback.
        wasCollapsedBeforeFeedback = model.collapsed
        wasVisibleBeforeFeedback = model.visible
        model.visible = false
        onFeedbackBegin?(results[idx].id)
    }
    private var wasCollapsedBeforeFeedback = false
    private var wasVisibleBeforeFeedback = true

    // RelayController pushes the fn-drag jpg here as soon as a region is grabbed.
    func attachFeedbackScreenshot(_ path: String) {
        guard capturingFeedback, let i = feedbackIdx, i < results.count else { return }
        var fb = results[i].feedback ?? StepFeedback()
        fb.screenshots.append(path)                       // ACCUMULATE — multiple grabs per step
        if fb.screenshot == nil { fb.screenshot = path }  // legacy single = the first grab
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
        model.collapsed = wasCollapsedBeforeFeedback   // re-expand the card (unless it was already collapsed)
        model.visible = wasVisibleBeforeFeedback       // re-show the guide card (hidden during capture)
        onFeedbackEnd?()
    }

    private let model = GuideOverlayModel()
    private var overlay: NSPanel?
    private var hosting: GuideHostingView?

    private var watchTimer: Timer?
    private var cursorTimer: Timer?
    private var flashTimer: Timer?
    var onTeamSetupRequested: (() -> Void)?   // ~/.relay/team-setup.json {open:true} → controller opens the Team notch flow
    private var notifyTimer: Timer?            // auto-dismiss for the notch ack toast
    private var pendingNotifyAction: String?   // the action a tappable notify (e.g. "resume") performs
    private var pendingHumanAck: String?       // the choice the human just approved → confirm at the notch on close
    private var doneTimer: Timer?          // ~4Hz doneWhen watcher (teach)
    private var holdTimer: Timer?          // dwell-then-auto-advance (teach `hold`)
    private var timeoutTimer: Timer?       // per-step doneWhen timeout → drop to manual-only
    private var flagsMonitorG: Any?
    private var flagsMonitorL: Any?
    private var keyMonitorG: Any?
    private var keyMonitorL: Any?
    private var mouseMonitorG: Any?
    private var mouseMonitorL: Any?
    // The key-consuming TAP — layered on top of the passive monitors while a guide is active. A passive
    // monitor can only OBSERVE, so an Option-chord (⌥;=…, ⌥/=÷, ⌥.=≥, ⌥M=µ, ⌥1/2/3=¡™£) also leaks its
    // character into the focused field. A session tap sits in front of the app and returns nil to DELETE
    // the event, so the chord does its action and NO character lands. It swallows ONLY the guide's own
    // Option-chords; typing, esc, ⌘V and everything else pass straight through. If the tap can't be created
    // (accessibility not yet granted) we simply don't install it → behaviour is exactly as before.
    private var keyTap: CFMachPort?
    private var keyTapSource: CFRunLoopSource?

    // ── run state
    private var mode: GuideMode = .tour
    private var title = ""
    private var steps: [GuideStep] = []
    private var idx = 0
    private var results: [GuideResult] = []
    // NO-CLOBBER QUEUE (docs/GUIDE-QUEUE-RESUME.md): runs that arrive while one is active wait here
    // (FIFO) instead of superseding the live card — so two sessions can't knock each other off the notch.
    // Each entry already has its resolved `mode` injected, so a queued test-run resumes as a test.
    private var pendingRuns: [[String: Any]] = []
    private var rawRun: [String: Any]? = nil   // the original run JSON — re-saved (with startIndex) on abort so a guide can be RESUMED from the menu
    private var callerRunId: String? = nil     // optional unique id from the run → also write guide-results/<id>.json (collision-proof result)
    private var startedAt = Date()

    // ── teach run state
    private var autoClipboard = false
    private var savedClipboard: String?      // the user's clipboard before the run — restored on end/abort
    private var clipboardSaved = false       // did any step overwrite the clipboard? (drives capture-once + restore, independent of autoClipboard)
    private var doneStreak = 0               // consecutive satisfied ticks (debounce: advance on 2)
    private var ocrInFlight = false          // one Vision pass at a time
    private var ocrMatched = false           // last OCR verdict for the current step
    private var ocrStepIdx = -1              // which step the cached ocrMatched belongs to
    private var pasteObserved = false        // ⌘V seen during THIS step (drives the `.pasted` doneWhen)
    private var observedEvent: String? = nil // app-reported gesture seen during THIS step (drives `.event`)

    /// The app calls this when a taught gesture actually fires (summon/dictation/launcher), so a step whose
    /// doneWhen is `{kind:"event",name:…}` advances the moment the user DOES it — no ⌥→ needed. Only counts
    /// while a guide is active; the ~4Hz watcher picks it up on its next tick.
    // Which full surface the current step yielded to (launcher/orb) — we MOVED ASIDE for it and are waiting
    // for it to CLOSE before advancing, so the next card never draws over it (the launcher-clash fix).
    private var yieldingSurface: String? = nil
    // Saved placement to restore when the yielded surface closes (founder 2026-08-31: the card must MOVE out
    // of the notch to the screen side — staying READABLE beside the surface — not collapse to a blind pill).
    private var preYieldPlacement: GuidePlacement = .notch
    private var preYieldPinned = false
    private var preYieldAnchor: CGPoint = .zero

    func noteEvent(_ name: String) {
        guard isActive, !capturingFeedback else { return }
        // If the CURRENT step yields to this surface, get out of its way: SLIDE the card from the notch to the
        // screen side (still fully readable) and DON'T advance yet. We advance when the surface closes
        // (noteEventClose) so the next card can't overlap it.
        if idx < steps.count, steps[idx].yieldsTo == name {
            yieldingSurface = name
            moveAsideForSurface()
            return
        }
        observedEvent = name
    }

    // The surface a step yielded to has CLOSED — bring the card home (to the notch) and let the step advance.
    func noteEventClose(_ name: String) {
        guard isActive, yieldingSurface == name else { return }
        yieldingSurface = nil
        restoreFromSide()
        observedEvent = name   // now the step's doneWhen(event) can fire → advance to the next card
    }

    // Slide the card OUT of the notch to a fixed spot on the LEFT of the screen (upper third — clear of the
    // top-center notch/orb and a centre launcher), so guidance and the surface are both visible, no overlap.
    private func moveAsideForSurface() {
        preYieldPlacement = model.placement
        preYieldPinned = model.placementPinned
        preYieldAnchor = model.freeAnchor
        let y = max(90, model.screenSize.height * 0.30)
        model.freeAnchor = CGPoint(x: 40, y: y)
        model.placement = .free
        model.placementPinned = true   // don't let showStep re-derive it back to the notch mid-yield
        model.collapsed = false
    }
    private func restoreFromSide() {
        model.placement = preYieldPlacement
        model.placementPinned = preYieldPinned
        model.freeAnchor = preYieldAnchor
    }

    // App-driven park (vs. the event-driven yield above): a beat that OPENS its own window (the dictation
    // scratch field) asks the card to step aside so it never covers the thing to try, then bring it home.
    private var parked = false
    func parkAside() { guard isActive, !parked else { return }; moveAsideForSurface(); parked = true }
    func unpark()    { guard parked else { return }; restoreFromSide(); parked = false }

    // ── chord edge-detect (⌃⌥ down → release = one signal; +⇧ while held = fail)
    private var chordDown = false
    private var chordHadShift = false

    // ── speech dedupe: which step index we've already spoken. onSpeak interrupts any in-flight speech, so
    // speaking the SAME step twice (any accidental re-entry) would cut the first utterance short. Guard it.
    private var spokenStepIdx = -1

    // Enqueue the full spoken line for the current step exactly once — `muted` and re-entry are respected
    // here so the utterance is never truncated by a redundant call or a mid-utterance state refresh.
    private func speakStep(_ text: String) {
        guard !model.muted, !text.isEmpty, spokenStepIdx != idx else { return }
        spokenStepIdx = idx
        onSpeak?(text)
    }

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
        // Recovery: if a run was left suspended (a previous session, a crash, or an esc the user wants to
        // return to), surface a "▸ Resume" toast at the notch shortly after launch (docs §3). Delayed so
        // the screen/overlay are ready; a no-op when there's nothing suspended.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            MainActor.assumeIsolated { self?.offerResumeIfSuspended() }
        }
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
        // Multi-run QUEUE dir (docs/GUIDE-QUEUE-RESUME.md §2): any session can drop
        // ~/.relay/guide-queue/<id>.json without clobbering the single-slot guide-run.json. Consume
        // oldest-first; begin() enqueues (not supersedes) if one is already active. Runs every tick.
        let qdir = rel("guide-queue")
        if let items = try? fm.contentsOfDirectory(atPath: qdir), !items.isEmpty {
            for path in items.filter({ $0.hasSuffix(".json") })
                .map({ (qdir as NSString).appendingPathComponent($0) })
                .sorted(by: { mtime($0) < mtime($1) }) {
                let obj = readJSON(path)
                try? fm.removeItem(atPath: path)
                begin(obj, defaultMode: .tour)
            }
        }
        // Session-action NOTIFY (docs §"notch feedback"): a lightweight ack — e.g. "task captured" — that
        // a Claude session (or the connector) drops without a full guided run. Shown as a brief notch toast.
        let notifyPath = rel("guide-notify.json")
        if fm.fileExists(atPath: notifyPath) {
            let obj = readJSON(notifyPath)
            try? fm.removeItem(atPath: notifyPath)
            showNotify(obj)
        }
        // /pip MODE toggle (docs/PM-NOTCH-OPERATOR.md): ~/.relay/pip.json {"active":true} → the persistent
        // stream feed lives at the notch; absent/false → off. Polled each tick; deterministic, no model.
        let pipOn = (readJSON(rel("pip.json")) as? [String: Any])?["active"] as? Bool ?? false
        if pipOn != model.pipActive { setPip(pipOn) }
        // Team Mode setup at the notch: ~/.relay/team-setup.json {"open":true} → run the card flow. A
        // one-shot trigger (consumed) so the panel button, the launcher, or a Claude session can all open it.
        let teamSetupPath = rel("team-setup.json")
        if fm.fileExists(atPath: teamSetupPath) {
            let open = (readJSON(teamSetupPath) as? [String: Any])?["open"] as? Bool ?? true
            try? fm.removeItem(atPath: teamSetupPath)
            if open { onTeamSetupRequested?() }
        }
        // /hijack PESTER (docs/SLACK-CONNECTOR.md): ~/.relay/pester.json {"active":true,"from":..,"task":..}
        // → the sender's sprite trails YOUR cursor until you finish the specced guided run. startPester is
        // idempotent, so re-asserting it every tick is fine. Cleared by finish() on a completed run, or when
        // the daemon removes the file.
        let pesterObj = readJSON(rel("pester.json")) as? [String: Any]
        if (pesterObj?["active"] as? Bool) ?? false {
            let from = (pesterObj?["from"] as? String) ?? "Someone"
            let task = (pesterObj?["task"] as? String) ?? ""
            Task { @MainActor in TeamCursorsOverlay.shared.startPester(from: from, task: task) }
        } else {
            Task { @MainActor in TeamCursorsOverlay.shared.stopPester() }
        }
    }

    // MARK: parse + start

    private func begin(_ raw: Any?, defaultMode: GuideMode) {
        guard let obj = raw as? [String: Any] else { logMalformed(); return }
        let m = GuideMode(rawValue: (obj["mode"] as? String) ?? "") ?? defaultMode
        let title = (obj["title"] as? String) ?? "Untitled"
        // Direct-grab mode (/screen + /reference): NO guide card at all — go straight to the fn+drag grab +
        // note panel. Needs no `steps`, so branch out before the steps guard below.
        if m == .grab {
            beginGrab(title: title, source: obj["source"] as? String, project: obj["project"] as? String)
            return
        }
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
            step.value = s["value"] as? String
            step.copyImage = s["copyImage"] as? String
            if let h = (s["hold"] as? NSNumber)?.doubleValue { step.hold = h }
            if let t = (s["timeoutMs"] as? NSNumber)?.doubleValue { step.timeoutMs = t }
            if let p = s["point"] as? [String: Any],
               let px = (p["x"] as? NSNumber)?.doubleValue, let py = (p["y"] as? NSNumber)?.doubleValue {
                step.point = mapper(CGPoint(x: px, y: py))
            }
            step.doneWhen = Predicate.parse(s["doneWhen"])
            step.gated = (s["gated"] as? Bool) ?? false
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
            step.yieldsTo = s["yieldsTo"] as? String
            if let rawKeys = s["keys"] as? [[String: Any]] {
                let groups: [GuideKeyGroup] = rawKeys.compactMap { g in
                    guard let caps = g["caps"] as? [String], !caps.isEmpty else { return nil }
                    return GuideKeyGroup(caps: caps, name: (g["name"] as? String) ?? "")
                }
                if !groups.isEmpty { step.keys = groups }
            }
            parsed.append(step)
        }
        guard !parsed.isEmpty else { logMalformed(); return }

        // NO-CLOBBER QUEUE: a run arriving mid-run is ENQUEUED, not superseded (was: abort "superseded",
        // which is exactly how two live sessions knocked each other's cards off the notch). It runs when
        // the current one ends (teardown → drainQueue). Inject the resolved mode so a queued test-run
        // stays a test even though it waited behind a tour. Archive it first so it's resumable if dropped.
        if isActive {
            var q = obj; q["mode"] = m.rawValue
            pendingRuns.append(q)
            model.queueDepth = pendingRuns.count
            archiveRun(obj, title: title)
            NSLog("[cursor-guide] QUEUED \"\(title)\" (depth \(pendingRuns.count)) — will run when the active guide ends")
            return
        }
        archiveRun(obj, title: title)   // full-fidelity archive for resume (docs §1)

        self.mode = m
        self.title = title
        self.steps = parsed
        model.placementPinned = false              // a fresh guide re-derives per-step smart placement again (until the user moves the card)
        self.rawRun = obj                          // keep the raw run so we can re-save it (with startIndex) to resume
        // Per-run result routing: the caller can pass a unique `runId`; we write the result to a per-run file
        // (guide-results/<runId>.json) so a later card — or another session — can NEVER clobber this answer in
        // the single shared guide-result.json. The raiser polls its own file by id. (founder 2026-08-31)
        self.callerRunId = obj["runId"] as? String
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
        model.inRun = true                          // a run is on screen → it overrides the PIP feed
        self.spokenStepIdx = -1                     // fresh run → speak from the first step shown
        self.autoClipboard = autoClip
        // Preserve the user's clipboard for the whole run — captured lazily the first time a step actually
        // overwrites it (so explicit copy/value work even when autoClipboard is off, and we still restore).
        clipboardSaved = false; savedClipboard = nil

        ensureOverlay()
        installMonitors()
        // Keys need Accessibility — BOTH the CGEvent tap AND the global keyDown monitor are gated on it, so
        // without the grant every ⌥-chord is silently dead in whatever app the user is being guided through.
        // Don't just show the strip: proactively OPEN the grant pane (once per launch). An ad-hoc-signed
        // rebuild churns the TCC grant, which is the usual reason a previously-working guide goes key-dead.
        if !AXIsProcessTrusted() {
            NSLog("[cursor-guide] Accessibility NOT granted — ⌥-chords will not fire; opening Settings")
            if !didOpenAxSettings { didOpenAxSettings = true; openAccessibilitySettings() }
            if !model.muted { onSpeak?("The guide keys need Accessibility permission. I've opened Settings — switch Switchboard on, then relaunch.") }
        }
        model.mode = m
        model.done = nil
        model.target = nil
        model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        showStep()
        showOverlay()
        startCursorTimer()
        NSLog("[cursor-guide] START mode=\(m.rawValue) title=\"\(title)\" steps=\(parsed.count) autoClipboard=\(autoClip)")
    }

    // Whether we've already popped the Accessibility grant pane this launch (don't re-open it on every guide).
    private var didOpenAxSettings = false

    /// Open System Settings → Privacy & Security → Accessibility. Called at guide start when the process
    /// isn't trusted (keys can't fire) and from the tappable permission strip on the card.
    func openAccessibilitySettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") else { return }
        NSWorkspace.shared.open(url)
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
        return GuideMedia(src: src, caption: d["caption"] as? String, tall: (d["tall"] as? Bool) ?? false)
    }

    // Load an image for the clipboard-preload (file path or http url). Small helper images only.
    private func loadImage(_ src: String) -> NSImage? {
        if src.hasPrefix("http"), let url = URL(string: src), let d = try? Data(contentsOf: url) { return NSImage(data: d) }
        return NSImage(contentsOfFile: src)
    }

    private func logMalformed() {
        NSLog("[cursor-guide] trigger malformed — ignored (need {title, steps:[{text|instruction}]})")
    }

    /// Save the user's real clipboard the FIRST time a step overwrites it, so end/abort can restore it —
    /// independent of the `autoClipboard` flag (explicit copy/value load regardless, and must still restore).
    private func captureClipboardOnce() {
        if clipboardSaved { return }
        savedClipboard = NSPasteboard.general.string(forType: .string)
        clipboardSaved = true
    }

    /// The first http(s) URL mentioned in a step's caption, so "go to <site>" becomes one paste.
    private func firstURL(in text: String) -> String? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let m = detector.firstMatch(in: text, options: [], range: NSRange(text.startIndex..., in: text))
        guard let url = m?.url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        return url.absoluteString
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
        model.actionDone = false   // fresh step: a gated beat is locked again until its real action fires
        model.autoSensing = (s.doneWhen != nil) || ((s.hold ?? 0) > 0)   // step advances itself → AUTO
        model.canBack = idx > 0
        model.media = s.media
        model.keys = s.keys ?? []
        model.options = s.options ?? []
        // adhd-pm: pre-select the ⭐recommended option so a single ⌥→ (or click) takes the recommendation.
        model.selectedOption = (s.options ?? []).firstIndex(where: { $0.recommended }) ?? 0
        model.applyingOption = nil
        model.explaining = false; model.explained = false   // each step earns its own Explain

        model.optionError = false
        onStepEnter?(s.id)   // let the app actively initialize this beat's surface (e.g. open a seeded wrapp)
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
        // Honor a manual placement (⌥/ or ⌥;) across steps: only re-derive when the user hasn't moved the card.
        if !model.placementPinned {
            // PIP: if the user dragged the feed off to a floating spot, a card fires THERE and persists —
            // don't snap it back to the notch (even if the step says "notch"), so they never re-drag it.
            if model.pipActive && model.freeRemembered { model.placement = .free }
            else if let p = s.placement, let pl = GuidePlacement(rawValue: p) { model.placement = pl }
            else if model.freeRemembered { model.placement = .free }   // a dragged spot is remembered across runs
            else { model.placement = (s.point != nil) ? .dock : .notch }
        }
        applyMousePolicy()   // notch → the card becomes clickable; else pure click-through
        model.target = s.point        // teach: point the ring + anchor the chip; nil → chip rides the cursor
        // The concierge reads the step aloud in tour AND teach (say overrides text); test stays silent.
        // Speak the FULL line — an explicit `say`, else the whole instruction (+ hint) — once per step, so a
        // state refresh mid-utterance can't cancel/re-truncate it (see speakStep).
        if mode == .tour || mode == .teach {
            let spoken = s.say ?? [s.text, s.hint]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: ". ")
            speakStep(spoken)
        }
        // Pre-load the clipboard with this step's paste payload (opt-in; user's clipboard is restored on end).
        // An IMAGE wins if present (copyImage); else text (copy). The cursor hint tells the user it's ready.
        model.clipboardHint = nil
        // Clipboard leverage: pre-load so the user just pastes. EXPLICIT payloads (image/value/copy) load
        // whether or not autoClipboard is set — the author put them there on purpose. autoClipboard only
        // governs the URL auto-detect heuristic (so legacy tours aren't surprised). Priority:
        // image → value (type this) → copy (paste this) → a URL found in the step's own caption.
        if let imgSrc = s.copyImage, let img = loadImage(imgSrc) {
            captureClipboardOnce()
            NSPasteboard.general.clearContents(); NSPasteboard.general.writeObjects([img])
            model.clipboardHint = "⌘V — image ready"
        } else if let v = s.value, !v.isEmpty {
            captureClipboardOnce()
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(v, forType: .string)
            model.clipboardHint = "⌘V — type ready"
        } else if let c = s.copy, !c.isEmpty {
            captureClipboardOnce()
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(c, forType: .string)
            model.clipboardHint = "⌘V — pasted for you"
        } else if autoClipboard, let link = firstURL(in: s.text) {
            captureClipboardOnce()
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(link, forType: .string)
            model.clipboardHint = "⌘V — link ready"
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
        observedEvent = nil          // an app-reported gesture only counts for the step it happens on
        guard idx < steps.count else { return }
        let s = steps[idx]
        // Dwell-then-advance: a purely timed step (e.g. "watch this happen for 3s"). Teach-only.
        if mode == .teach, let ms = s.hold, ms > 0 {
            holdTimer = Timer.scheduledTimer(withTimeInterval: ms / 1000.0, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.handleAdvance(fail: false, auto: true) }
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
            if steps[idx].gated {
                // The real action fired on a GATED practice beat → UNLOCK ⌥→ but DON'T yank them to the next
                // step: let them keep trying it (founder: "how will they test it if you auto-progress?").
                if !model.actionDone {
                    model.actionDone = true
                    model.autoSensing = false
                    model.hint = "✓ nice — take your time. ⌥→ when you're ready."
                    onSpeak?("Nice — that's it. Play with it, and press option-right when you're ready to move on.")
                }
            } else {
                handleAdvance(fail: false, auto: true)   // normal teach step → auto-advance on success
            }
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
        case .event(let name):
            return observedEvent == name   // set by noteEvent() when the app fires the taught gesture
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

    private func handleAdvance(fail: Bool, auto: Bool = false) {
        guard isActive, idx < steps.count, !capturingFeedback else { return }
        // GATED practice beat: you can't ⌥→ past it — only actually DOING it (its doneWhen event / hold, which
        // arrive with auto=true) advances, so onboarding teaches instead of letting you click through. A MANUAL
        // ⌥→/click (auto=false) is refused with a nudge; esc still leaves. (Options steps are exempt — ⌥→ IS the
        // pick — so this only bites a gated non-options step.)
        if !fail, !auto, steps[idx].gated, !model.actionDone, (steps[idx].options?.isEmpty ?? true) {
            flash(.back)
            onSpeak?("Give it a try — I'll move on the moment you do.")
            return
        }
        // Options step: ⌥→ APPROVES the selected variant — record it + fire the live-apply hook.
        if !fail, let opts = steps[idx].options, !opts.isEmpty {
            let i = min(max(model.selectedOption, 0), opts.count - 1)
            results[idx].chosenOption = opts[i].id
            pendingHumanAck = opts[i].label     // confirm THIS choice at the notch when the card closes
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

    // ── mouse policy: the overlay is click-through by DEFAULT and becomes clickable ONLY while the
    //    pointer is over the card (updateMousePassthrough, driven by the mouse-move monitors). A
    //    full-screen `ignoresMouseEvents=false` window eats every click regardless of hitTest — that
    //    locked the screen — so we never do that; cursor-tracking is the lock-proof approach. ──
    private func applyMousePolicy() { updateMousePassthrough() }
    func tapPrimary()      { handleAdvance(fail: false) }
    func tapFail()         { if mode == .test { handleAdvance(fail: true) } }
    // Click an option: pick it; clicking the already-selected/recommended card approves (same as ⌥→).
    func tapOption(_ i: Int) {
        guard isActive, i < model.options.count else { return }
        if i == model.selectedOption { handleAdvance(fail: false) } else { selectOption(i) }
    }
    // ── Explain mode ──────────────────────────────────────────────────────────────────────────────
    // The user asked to be TAUGHT this decision. Hand the question + options to RelayController (onExplain),
    // which generates the diagram + Moira script; it calls showExplanation when the diagram lands. Guarded
    // so it fires once per step and only when there's a real decision (options) + a wired explainer.
    func requestExplain() {
        guard isActive, idx < steps.count, !model.explaining, !model.explained,
              !model.options.isEmpty, let cb = onExplain else { return }
        model.explaining = true
        cb(steps[idx].id, steps[idx].text, model.options)
    }
    // The diagram is ready → show it as this step's media (Moira narrates via onSpeak). The options stay
    // put for the pick. explaining ends; explained hides the affordance so it isn't re-triggered.
    func showExplanation(media: GuideMedia?) {
        if let media { model.media = media }
        model.explaining = false
        model.explained = true
    }
    // Explain couldn't be produced (daemon down / no diagram) — clear the spinner, leave the options intact.
    func explainFailed() { model.explaining = false }
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
            // /hijack: finishing the specced run shakes off the pest. An ABORT deliberately does NOT —
            // dodge the task and the sender's sprite keeps chasing you (docs/SLACK-CONNECTOR.md).
            if FileManager.default.fileExists(atPath: rel("pester.json")) {
                try? FileManager.default.removeItem(atPath: rel("pester.json"))
                Task { @MainActor in TeamCursorsOverlay.shared.stopPester() }
            }
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
                if let s = fb.screenshot, !s.isEmpty { fbo["screenshot"] = s }   // first (back-compat)
                if !fb.screenshots.isEmpty { fbo["screenshots"] = fb.screenshots }  // ALL grabs
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
        // Per-run result file — collision-proof: only THIS run's caller reads guide-results/<runId>.json.
        if let rid = callerRunId, !rid.isEmpty {
            let dir = rel("guide-results")
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            writeAtomic(out, to: (dir as NSString).appendingPathComponent("\(rid).json"))
        }
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

    private func mtime(_ path: String) -> TimeInterval {
        ((try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
    }

    // Full-fidelity archive of an ingested run, keyed by runId (docs/GUIDE-QUEUE-RESUME.md §1) — lets a
    // RESUME restore each step's hint/point/doneWhen, not just the text the history log preserves.
    // Best-effort; never fatal. Returns the runId it filed under.
    @discardableResult
    private func archiveRun(_ obj: [String: Any], title: String) -> String {
        let runId = (obj["runId"] as? String) ?? String(Int(Date().timeIntervalSince1970))
        let dir = rel("guide-runs")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        var o = obj; o["runId"] = runId; o["archivedTitle"] = title
        writeAtomic(o, to: (dir as NSString).appendingPathComponent("\(runId).json"))
        return runId
    }

    // Run the next QUEUED run (no-clobber queue). A short delay lets this overlay fully tear down first,
    // so the next card animates in cleanly rather than reusing a half-dismantled overlay.
    private func drainQueue() {
        guard !pendingRuns.isEmpty else { model.queueDepth = 0; return }
        let next = pendingRuns.removeFirst()
        model.queueDepth = pendingRuns.count
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            MainActor.assumeIsolated { self?.begin(next, defaultMode: .tour) }
        }
    }

    // MARK: notch ack toast (session-side feedback — "task captured", "▸ Resume", …)

    private func showNotify(_ raw: Any?) {
        guard let obj = raw as? [String: Any], let text = obj["text"] as? String, !text.isEmpty else { return }
        // Never hijack a live guided run — the notch belongs to the run; just log the ack. (A resume offer
        // arriving mid-run is moot anyway; it re-surfaces from guide-suspended.json when the run ends.)
        if isActive { NSLog("[cursor-guide] notify suppressed (run active): \(text)"); return }
        let n = GuideNotify(text: text,
                            kind: (obj["kind"] as? String) ?? "info",
                            source: obj["source"] as? String,
                            project: obj["project"] as? String,
                            action: obj["action"] as? String,
                            actionLabel: obj["actionLabel"] as? String)
        // /pip mode: events join the PERSISTENT stream, not a one-shot toast.
        if model.pipActive { appendPipRow(n); showPipFeed(); return }
        pendingNotifyAction = n.action
        model.notify = n
        // Force a CLEAN notch render — a prior run can leave placement at .free/.cursor with a stale
        // anchor, which is why the toast was landing mid-screen instead of under the notch. Pin it so
        // nothing re-derives, and clear any remembered free position.
        model.placement = .notch
        model.placementPinned = true
        model.collapsed = false
        model.dockTop = false
        model.target = nil
        model.forgetFree()
        model.source = n.source
        model.project = n.project
        ensureOverlay()
        showOverlay()
        installNotifyKeyMonitor()                       // ⌥→ performs the action, esc dismisses
        // Auto-dismiss (default 2.6s; a tappable resume offer lingers longer so it's actually catchable).
        let ttl = (obj["ttl"] as? NSNumber)?.doubleValue ?? (n.action != nil ? 8.0 : 2.6)
        notifyTimer?.invalidate()
        notifyTimer = Timer.scheduledTimer(withTimeInterval: ttl, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.dismissNotify() }
        }
        NSLog("[cursor-guide] notify: \(text)")
    }

    private func dismissNotify() {
        notifyTimer?.invalidate(); notifyTimer = nil
        removeNotifyKeyMonitor()
        pendingNotifyAction = nil
        model.notify = nil
        if !isActive { model.visible = false; overlay?.orderOut(nil) }
    }

    /// Perform a tappable notify's action (⌥→ or click). Today: "resume" → re-enter the suspended run.
    func performNotifyAction(_ action: String) {
        dismissNotify()
        switch action {
        case "resume": resumeSuspended()
        default: break
        }
    }

    /// Re-enter the guide-suspended.json run (written on abandon) at the step it stopped on. This is the
    /// notch-side of resume — no Claude session needed (docs/GUIDE-QUEUE-RESUME.md §3).
    func resumeSuspended() {
        guard let obj = readJSON(rel("guide-suspended.json")) as? [String: Any] else { return }
        try? FileManager.default.removeItem(atPath: rel("guide-suspended.json"))
        begin(obj, defaultMode: GuideMode(rawValue: (obj["mode"] as? String) ?? "") ?? .tour)
    }

    /// Offer to resume an abandoned run AT THE NOTCH — call after a run ends (or at launch) when a
    /// guide-suspended.json exists. Surfaces the persistent "▸ Resume (N left)" toast the founder asked for.
    func offerResumeIfSuspended() {
        guard !isActive, model.notify == nil,
              let s = readJSON(rel("guide-suspended.json")) as? [String: Any] else { return }
        let title = (s["suspendedTitle"] as? String) ?? (s["title"] as? String) ?? "your walkthrough"
        showNotify(["text": "Resume \(title)?", "kind": "resume", "action": "resume", "actionLabel": "Resume",
                    "source": s["source"] as Any, "project": s["project"] as Any, "ttl": 10.0])
    }

    // A tiny key monitor active only while a notify toast is up: ⌥→ performs the action, esc dismisses.
    // Separate from the run monitors so it works when no guide is active.
    private var notifyKeyMonitor: Any?
    private func installNotifyKeyMonitor() {
        removeNotifyKeyMonitor()
        notifyKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] ev in
            guard let self = self, self.model.notify != nil else { return ev }
            if ev.keyCode == 53 { self.dismissNotify(); return nil }                 // esc
            if ev.modifierFlags.contains(.option) && ev.keyCode == 124,             // ⌥→
               let a = self.pendingNotifyAction { self.performNotifyAction(a); return nil }
            return ev
        }
    }
    private func removeNotifyKeyMonitor() {
        if let m = notifyKeyMonitor { NSEvent.removeMonitor(m); notifyKeyMonitor = nil }
    }

    // MARK: PIP mode — the persistent, deterministic multi-thread stream (docs/PM-NOTCH-OPERATOR.md)

    /// Toggle /pip mode. On → a standing feed lives at the notch; off → clear + hide (if nothing else is up).
    private func setPip(_ active: Bool) {
        guard active != model.pipActive else { return }
        model.pipActive = active
        model.pipFilter = nil                          // fresh session: never inherit a stale thread filter
        if active {
            NSLog("[cursor-guide] PIP mode ON")
            if !isActive && model.notify == nil { showPipFeed() }
        } else {
            NSLog("[cursor-guide] PIP mode OFF")
            model.pipRows = []
            if !isActive && model.notify == nil {
                model.visible = false
                removeMonitors(); stopCursorTimer()   // release the passthrough monitors + restore clicks
                overlay?.ignoresMouseEvents = true
                overlay?.orderOut(nil)
            }
        }
    }

    /// Thread selector (founder ask 2026-08-24). The "all" dot (source==nil) or tapping the already-active
    /// thread clears the filter; tapping a different thread's dot filters the feed to just that source.
    /// Deterministic — no model.
    func tapPipFilter(_ source: String?) {
        model.pipFilter = (source == nil || model.pipFilter == source) ? nil : source
    }

    /// DISMISS the PIP feed from the notch ✕ (founder ask 2026-08-24). Reversible: persists pip.json
    /// active:false so the next watch tick agrees (else it'd flip straight back on), then tears the feed
    /// down now. `/pip` (writes active:true) brings it back. Deterministic — no model.
    func dismissPip() {
        writeAtomic(["active": false], to: rel("pip.json"))
        setPip(false)
    }

    /// Show the persistent feed (no dismiss timer — it stays until a run/notify takes over or /pip ends).
    /// Respects a dragged-off position: once the user pulls it anywhere (placement .free / remembered),
    /// new events update it in place instead of snapping it back to the notch.
    private func showPipFeed() {
        model.notify = nil
        model.collapsed = false
        if model.placement != .free && !model.freeRemembered {
            model.placement = .notch; model.placementPinned = true; model.target = nil
        }
        ensureOverlay(); showOverlay()
        installPipMouse()      // CRITICAL: without the passthrough monitors the full-screen overlay eats
        startCursorTimer()     // every click and locks the screen. This makes it click-through except the card.
    }

    // Just the mouse-passthrough monitors for PIP — NOT the run's key monitors/tap (PIP has no run to
    // drive, and swallowing the ⌥-chords would break the user's own Option shortcuts). The overlay stays
    // click-through EXCEPT when the pointer is over the (draggable) feed card — the lock-proof default.
    private func installPipMouse() {
        overlay?.ignoresMouseEvents = true
        // Include .leftMouseUp so the moment a drag ENDS, click-through re-evaluates — without it the
        // panel stays clickable-everywhere (eating clicks / "screen frozen") until the next mouse-move.
        if mouseMonitorG == nil {
            mouseMonitorG = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged, .leftMouseUp]) { [weak self] _ in
                MainActor.assumeIsolated { self?.updateMousePassthrough() }
            }
        }
        if mouseMonitorL == nil {
            mouseMonitorL = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged, .leftMouseUp]) { [weak self] ev in
                MainActor.assumeIsolated { self?.updateMousePassthrough() }; return ev
            }
        }
        updateMousePassthrough()
    }

    /// Add an event to the rolling stream (newest first, capped). Deterministic — no model.
    private func appendPipRow(_ n: GuideNotify) {
        let style = pmKindStyle(n.kind)
        model.pipRows.insert(PipRow(kicker: style.kicker, text: n.text, accent: style.accent,
                                    source: n.source ?? "•", at: Date()), at: 0)
        if model.pipRows.count > 8 { model.pipRows.removeLast(model.pipRows.count - 8) }
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
        spokenStepIdx = -1      // next run must speak its first step afresh
        onStopSpeak?()          // silence the concierge voice when the guide ends
        // Teach timers off, and restore the clipboard we borrowed (opt-in runs only).
        holdTimer?.invalidate(); holdTimer = nil
        doneTimer?.invalidate(); doneTimer = nil
        timeoutTimer?.invalidate(); timeoutTimer = nil
        if clipboardSaved {
            NSPasteboard.general.clearContents()
            if let s = savedClipboard { NSPasteboard.general.setString(s, forType: .string) }
            savedClipboard = nil
            clipboardSaved = false
        }
        autoClipboard = false
        model.visible = false
        model.done = nil
        model.flash = nil
        model.target = nil
        overlay?.orderOut(nil)
        stopCursorTimer()
        removeMonitors()
        // Human-action feedback (docs/PM-NOTCH-OPERATOR.md): the founder just picked something and the
        // card closed — confirm it at the notch so acting on the notch is FELT, not silent. Deterministic
        // (no model). A queued run takes precedence over the ack (it needs the notch).
        model.inRun = false
        let ack = pendingHumanAck; pendingHumanAck = nil
        if !pendingRuns.isEmpty {
            drainQueue()                 // next queued run takes the notch
        } else if model.pipActive {
            // /pip: the choice joins the persistent stream (as a 'decided' row); the feed stays up.
            if let ack, !ack.isEmpty {
                appendPipRow(GuideNotify(text: ack, kind: "decided", source: model.source, project: model.project, action: nil, actionLabel: nil))
            }
            model.queueDepth = 0
            showPipFeed()
        } else if let ack, !ack.isEmpty {
            model.queueDepth = 0
            showNotify(["text": ack, "kind": "decided", "ttl": 2.2])
        }
    }

    // MARK: overlay window (borderless, non-activating, click-through — the glow recipe)

    private func ensureOverlay() {
        guard overlay == nil, let screen = NSScreen.main else {
            if let scr = NSScreen.main { overlay?.setFrame(scr.frame, display: false); model.screenSize = scr.frame.size }
            return
        }
        let host = GuideHostingView(rootView: GuideCaptionView(m: model))
        host.model = model                   // so hitTest knows where the card is (clickable card, pass-through elsewhere)
        let panel = NotchPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .screenSaver
        panel.hidesOnDeactivate = false      // NSPanel defaults this TRUE → the card vanished the moment you switched
                                             // to another app/Space and only returned when Switchboard was frontmost.
                                             // The presence card must persist across apps/Spaces (you act on it while away).
        panel.ignoresMouseEvents = true      // DEFAULT click-through; the cursor-tracking monitor flips it clickable ONLY while the pointer is over the card (lock-proof)
        // .transient (NOT .stationary) + .fullScreenAuxiliary so the card/PIP feed composites OVER another
        // app's native-fullscreen Space. .stationary marks a window desktop-attached — the window server then
        // treats it like wallpaper, which a fullscreen Space obscures, so the whole notch went dark whenever a
        // fullscreen app was frontmost (feed AND every ask card invisible). .transient is what the other
        // over-fullscreen notch panels (godStatus/ambient/notchWidget) use and are proven to ride fullscreen.
        panel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        panel.contentView = host
        panel.setFrame(screen.frame, display: false)
        panel.orderOut(nil)
        self.overlay = panel
        self.hosting = host
        model.screenSize = screen.frame.size
    }

    private func showOverlay() {
        guard let panel = overlay else {
            NSLog("[cursor-guide] showOverlay: overlay is nil — card cannot be shown (should never happen; ensureOverlay ran?)")
            return
        }
        if let scr = NSScreen.main { panel.setFrame(scr.frame, display: false); model.screenSize = scr.frame.size }
        updateCursor()
        model.collapsed = false     // a fresh guide always opens expanded
        model.visible = true
        // Re-assert the over-fullscreen behavior on every show (cheap; guards against any reset) and order
        // front. Then order front ONCE MORE after the run-loop settles: when a native-fullscreen Space is
        // frontmost, the window server can drop the first orderFront until the Space transition finishes, so
        // a single call sometimes left the card invisible on fullscreen. The second assert lands it.
        panel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        panel.orderFrontRegardless()
        DispatchQueue.main.async { [weak self] in self?.overlay?.orderFrontRegardless() }
    }

    private func startCursorTimer() {
        cursorTimer?.invalidate()
        cursorTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateCursor(); self?.updateMousePassthrough() }
        }
    }
    // Re-evaluate click-through 30×/sec while the overlay is up. Belt-and-suspenders for the mouse
    // monitors: mouse-UP fires neither .mouseMoved nor .leftMouseDragged, so a drag that ends over the
    // card would otherwise leave the full-screen panel `ignoresMouseEvents=false` (eating every click)
    // until the next mouse-move. The timer self-corrects it within a frame.
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
        // MUTUAL EXCLUSION with the CGEvent tap: when the tap is live it already handles+swallows the
        // Option-chords, so the monitors must NOT fire onKey for those too — a second call cancels every
        // TOGGLE/CYCLE chord (⌥/ ⌥. ⌥M ⌥;) back to a no-op and over-advances ⌥→. The monitors STILL own
        // Esc (53) and ⌘V (9), which the tap never touches. When the tap is dead (no accessibility grant),
        // keyTap == nil → the monitors handle everything (chords work, char just leaks) — the old fallback.
        keyMonitorG = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] ev in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.keyTap != nil && self.isGuideOptionChord(ev.keyCode, ev.modifierFlags) { return }  // tap owns it
                _ = self.onKey(ev.keyCode, ev.modifierFlags)
            }
        }
        keyMonitorL = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] ev in
            var swallow = false
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.keyTap != nil && self.isGuideOptionChord(ev.keyCode, ev.modifierFlags) { return }  // tap owns it
                swallow = self.onKey(ev.keyCode, ev.modifierFlags)
            }
            return swallow ? nil : ev
        }
        // Cursor tracking → the overlay only ACCEPTS clicks while the pointer is over the card, and is
        // otherwise fully click-through. This is the lock-proof way to make a full-screen overlay
        // selectively clickable: a full-screen `ignoresMouseEvents=false` window eats EVERY click
        // (hitTest returning nil does NOT forward to the app below) — that locked the screen. Here the
        // DEFAULT is pass-through and we flip to clickable only when the pointer is provably inside a
        // sane-sized card rect, so any mis-computation fails safe to pass-through, never a lock.
        mouseMonitorG = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateMousePassthrough() }
        }
        mouseMonitorL = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] ev in
            MainActor.assumeIsolated { self?.updateMousePassthrough() }; return ev
        }
        _ = installKeyTap()   // additive: swallow the Option-chords so their character never leaks (best-effort)
    }

    /// Set the overlay click-through UNLESS the pointer is over the card. Default-safe: only captures
    /// when the cursor is inside a validly-sized card rect (never near full-screen), so a coord bug
    /// degrades to "card not clickable", not a locked screen. esc/⌥-keys work regardless.
    @MainActor private func updateMousePassthrough() {
        guard let ov = overlay else { return }
        // While a free-drag OR a width-resize is in flight, force the overlay clickable so the gesture can
        // never be dropped by the frame lagging the pointer. Ends when the drag/resize clears its flag.
        if model.isDraggingCard || model.isResizingCard { ov.ignoresMouseEvents = false; return }
        // In .cursor placement the card FOLLOWS the pointer live (offset in cursorOffset so it trails
        // the cursor rather than sitting under it) — driven by these same mouse-move events.
        if model.placement == .cursor, model.visible {
            let ml = NSEvent.mouseLocation
            model.cursorAnchor = CGPoint(x: ml.x - ov.frame.minX, y: ov.frame.maxY - ml.y)
        }
        // When collapsed, the pill publishes its own (small) frame like the card does, so we no longer force
        // click-through — the frame check below captures clicks ONLY over the pill, making it tappable to reopen.
        guard model.visible else { ov.ignoresMouseEvents = true; return }
        let cf = model.cardFrame, win = ov.frame
        guard cf.width > 1, cf.height > 1,
              cf.width < win.width * 0.9, cf.height < win.height * 0.9 else { ov.ignoresMouseEvents = true; return }
        // cardFrame is SwiftUI .global (window space, top-left origin); the overlay fills the screen.
        // Convert to screen coords (bottom-left origin) to test against NSEvent.mouseLocation.
        let cardScreen = CGRect(x: win.minX + cf.minX, y: win.maxY - cf.maxY, width: cf.width, height: cf.height).insetBy(dx: -4, dy: -4)
        ov.ignoresMouseEvents = !cardScreen.contains(NSEvent.mouseLocation)
    }

    private func removeMonitors() {
        for mon in [flagsMonitorG, flagsMonitorL, keyMonitorG, keyMonitorL, mouseMonitorG, mouseMonitorL] { if let m = mon { NSEvent.removeMonitor(m) } }
        flagsMonitorG = nil; flagsMonitorL = nil; keyMonitorG = nil; keyMonitorL = nil; mouseMonitorG = nil; mouseMonitorL = nil
        removeKeyTap()
    }

    // The guide's Option-chords (keyCodes bound in onKey under the OPTION modifier). Kept in sync with
    // onKey's switch: ⌥→123/124, ⌥↑↓125/126, ⌥M46, ⌥.47, ⌥/44, ⌥;41, ⌥1/2/3 18/19/20. These are the ones
    // whose bare Option press would ALSO emit a character, so the tap swallows exactly this set.
    private static let optionChordCodes: Set<UInt16> = [124, 123, 126, 125, 46, 47, 44, 41, 18, 19, 20]

    /// Side-effect-free test: would onKey act on this key AND is it an Option-chord that leaks a character?
    /// (Mirrors onKey's own guards: active, not capturing feedback, Option held, no Control/Command.)
    @MainActor private func isGuideOptionChord(_ keyCode: UInt16, _ flags: NSEvent.ModifierFlags) -> Bool {
        isActive && !capturingFeedback
            && flags.contains(.option) && !flags.contains(.control) && !flags.contains(.command)
            && CursorGuide.optionChordCodes.contains(keyCode)
    }

    /// Install the consuming tap (best-effort). Returns false if the OS won't give us a tap (e.g.
    /// accessibility not yet granted) — the passive monitors still run, so the chords still WORK, they
    /// just also leak a character until the grant lands. Tap only runs while a guide is active.
    private func installKeyTap() -> Bool {
        removeKeyTap()
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
            let me = Unmanaged<CursorGuide>.fromOpaque(refcon).takeUnretainedValue()
            // The system disables a tap if a callback is too slow or on user input — re-enable and pass.
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                MainActor.assumeIsolated { if let t = me.keyTap { CGEvent.tapEnable(tap: t, enable: true) } }
                return Unmanaged.passUnretained(event)
            }
            guard type == .keyDown else { return Unmanaged.passUnretained(event) }
            let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
            let flags = NSEvent.ModifierFlags(rawValue: UInt(event.flags.rawValue))
            var swallow = false
            // We attach the source to the MAIN run loop, so the callback runs on the main thread.
            MainActor.assumeIsolated {
                if me.isGuideOptionChord(keyCode, flags) { _ = me.onKey(keyCode, flags); swallow = true }
            }
            return swallow ? nil : Unmanaged.passUnretained(event)
        }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                          options: .defaultTap, eventsOfInterest: mask,
                                          callback: callback, userInfo: refcon) else { return false }
        keyTap = tap
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        keyTapSource = src
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    private func removeKeyTap() {
        if let tap = keyTap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let src = keyTapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), src, .commonModes) }
        keyTap = nil; keyTapSource = nil
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
        case 44:  model.placement = (model.placement == .notch ? .dock : .notch); model.forgetFree(); model.placementPinned = true; applyMousePolicy(); return true  // ⌥/ — notch ↔ dock (also exits free)
        case 41:                                                                       // ⌥; — cycle notch → below → cursor (from free → notch)
            let nextPl: GuidePlacement = model.placement == .notch ? .dock : (model.placement == .dock ? .cursor : .notch)
            if nextPl == .cursor, let ov = overlay {
                let ml = NSEvent.mouseLocation                                          // screen bottom-left → overlay top-left
                model.cursorAnchor = CGPoint(x: ml.x - ov.frame.minX, y: ov.frame.maxY - ml.y)
            }
            model.placement = nextPl; model.forgetFree(); model.placementPinned = true; applyMousePolicy(); return true
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
