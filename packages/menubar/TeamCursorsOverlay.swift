// TeamCursorsOverlay — the multiplayer "remote sprite on your screen" surface (docs/MULTIPLAYER-VISION.md).
// A full-screen, click-through, all-Spaces overlay that renders every teammate's LIVE cursor as a sprite,
// driven by the daemon's `teamCursor` events (which ride the sealed team transport). It also streams THIS
// machine's cursor up to the daemon (control team.cursor) so teammates see us. Ephemeral: nothing persists.
//
// Reuses the proven overlay recipe (glow / NotchTray): borderless non-activating panel, screenSaver level,
// clear, ignoresMouseEvents=true, [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]. Coordinates are
// normalized 0..1 (top-left) so different screen sizes/resolutions line up.
//
// Sprite v1 is a labelled coloured pointer (colour keyed on deviceId, like the presence dots). Swapping in
// real emote.js character sprites is a later, isolated change to RemoteSpriteView.
import AppKit
import SwiftUI

struct RemoteCursor: Identifiable, Equatable {
    let deviceId: String
    var name: String
    var x: Double            // normalized 0..1 (left→right)
    var y: Double            // normalized 0..1 (top→bottom)
    var lastSeen: Date
    var id: String { deviceId }
}

// The /hijack "pester" sprite (docs/SLACK-CONNECTOR.md): NOT a remote teammate — it's the SENDER's
// avatar rendered on YOUR screen, trailing your OWN cursor to nudge you into doing the task they
// hijacked you with. It never controls the pointer; it just follows + won't leave until you finish
// the specced guided run. x,y are normalized 0..1 (top-left) and lerp toward your live cursor.
struct PesterSprite: Equatable {
    var from: String
    var task: String
}

@MainActor final class TeamCursorsModel: ObservableObject {
    @Published var cursors: [RemoteCursor] = []
    @Published var pester: PesterSprite? = nil
    @Published var userCat = false   // your OWN ambient cat — trails your cursor, independent of team/pester
    @Published var userCatIntro = false          // show the one-time "hi, I'm your cat" bubble
    @Published var userCatFrame: CGRect = .zero   // the cat's live rect (top-left px) — for right-click hit-testing
    // Callbacks the overlay wires so the cat's right-click menu can act on the controller.
    var onHideCat: (() -> Void)?
    var onCatSettings: (() -> Void)?
}

/// The companion cat's little voice. Plays the bundled mew (Resources/sounds/mew.wav); no-op if absent.
enum CatVoice {
    private static var sound: NSSound? = {
        if let u = Bundle.main.url(forResource: "mew", withExtension: "wav", subdirectory: "sounds")
            ?? Bundle.main.url(forResource: "mew", withExtension: "wav") { return NSSound(contentsOf: u, byReference: true) }
        return nil
    }()
    static func mew() { sound?.stop(); sound?.play() }
}

@MainActor final class TeamCursorsOverlay {
    static let shared = TeamCursorsOverlay()
    private let model = TeamCursorsModel()
    private var panel: NSPanel?
    private var localTimer: Timer?
    private var pruneTimer: Timer?
    private var active = false
    private var lastSent: (Double, Double) = (-1, -1)
    // ── /hijack pester state (independent of team `active` — a pest can chase you with no team) ──
    private var pesterFrom = ""
    private var pesterTask = ""

    /// Set by the controller to actually send our cursor to the daemon (→ team). x,y normalized 0..1.
    var onLocalCursor: ((Double, Double) -> Void)?

    /// Wired by the controller: the cat's "Cat settings…" menu item opens the panel's Companion section.
    var onCatSettings: (() -> Void)? { didSet { model.onCatSettings = onCatSettings } }

    /// A teammate's cursor arrived (from the daemon `teamCursor` event). Show the overlay + upsert.
    func update(deviceId: String, name: String, x: Double, y: Double) {
        guard !deviceId.isEmpty else { return }
        ensurePanel()
        if let i = model.cursors.firstIndex(where: { $0.deviceId == deviceId }) {
            model.cursors[i].x = x; model.cursors[i].y = y; model.cursors[i].name = name; model.cursors[i].lastSeen = Date()
        } else {
            model.cursors.append(RemoteCursor(deviceId: deviceId, name: name, x: x, y: y, lastSeen: Date()))
        }
    }

    /// Turn the whole thing on/off with team membership. On: start streaming our cursor + pruning stale peers.
    func setActive(_ on: Bool) {
        guard on != active else { return }
        active = on
        if on {
            localTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tickLocal() }
            }
            pruneTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.prune() }
            }
        } else {
            localTimer?.invalidate(); localTimer = nil
            pruneTimer?.invalidate(); pruneTimer = nil
            model.cursors.removeAll()
            updatePanelVisibility()   // keep the panel iff a pester is still chasing
        }
    }

    // ── /hijack pester: the sender's sprite trails YOUR cursor until you finish the task ────────────────
    /// Start (or refresh) the pest. Idempotent — the 0.3s guide watcher calls this every tick while
    /// ~/.relay/pester.json is active, so re-calling with the same from/task must be a no-op.
    func startPester(from: String, task: String) {
        if model.pester != nil && pesterFrom == from && pesterTask == task { return }  // already chasing this one
        pesterFrom = from; pesterTask = task
        ensurePanel()
        model.pester = PesterSprite(from: from, task: task)   // PesterCatView owns the chase + animation
    }

    /// Stop pestering (task done, or the daemon cleared ~/.relay/pester.json). Idempotent.
    func stopPester() {
        guard model.pester != nil else { return }
        pesterFrom = ""; pesterTask = ""
        model.pester = nil
        updatePanelVisibility()
    }

    // ── your OWN cat: the first ambient "cat wrapp" (founder 2026-09-04). A MacCat that trails YOUR
    // cursor all the time — not a teammate, not a pest — presence you add. Independent of team/pester,
    // so it lives even with no team online. Persisted by the controller.
    func setUserCat(_ on: Bool) {
        guard on != model.userCat else { return }
        model.userCat = on
        if on {
            ensurePanel()
            if !UserDefaults.standard.bool(forKey: "userCatIntroShown") {
                model.userCatIntro = true
                UserDefaults.standard.set(true, forKey: "userCatIntroShown")
            }
            CatVoice.mew()                       // a hello mew
        } else {
            model.userCatFrame = .zero
            updatePanelVisibility()
        }
    }

    /// Re-show the intro bubble (+ a mew) — the "What's this?" right-click item.
    func showCatIntro() { guard model.userCat else { return }; model.userCatIntro = true; CatVoice.mew() }

    // Show the overlay iff SOMETHING wants it (a teammate cursor, a pester, or your own cat); else tear down.
    private func updatePanelVisibility() {
        if model.cursors.isEmpty && model.pester == nil && !model.userCat {
            panel?.orderOut(nil); panel = nil
        } else {
            ensurePanel()
        }
    }

    // Read our own pointer, normalize against the main screen, send only when it MOVED (idle = silent).
    private func tickLocal() {
        guard let screen = NSScreen.main else { return }
        let f = screen.frame
        guard f.width > 0, f.height > 0 else { return }
        let loc = NSEvent.mouseLocation                       // screen coords, bottom-left origin
        let nx = min(max((loc.x - f.minX) / f.width, 0), 1)
        let ny = min(max(1 - (loc.y - f.minY) / f.height, 0), 1)   // flip → top-left
        if abs(nx - lastSent.0) < 0.001 && abs(ny - lastSent.1) < 0.001 { return }
        lastSent = (nx, ny)
        onLocalCursor?(nx, ny)
    }

    // Drop teammates we haven't heard from in a while; hide the overlay when none remain.
    private func prune() {
        let cutoff = Date().addingTimeInterval(-5)
        let before = model.cursors.count
        model.cursors.removeAll { $0.lastSeen < cutoff }
        if model.cursors.isEmpty && before > 0 { updatePanelVisibility() }  // keep panel iff a pester remains
    }

    private func ensurePanel() {
        guard panel == nil, let screen = NSScreen.main else { return }
        let p = NSPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.level = .screenSaver
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = false
        // NOT globally click-through: the CatHitView below passes every click through EXCEPT one that lands
        // on your cat, so right-click reaches the cat while the rest of the screen stays untouched.
        p.ignoresMouseEvents = false
        p.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        let host = NSHostingView(rootView: TeamCursorsView(model: model, screenSize: screen.frame.size))
        host.frame = NSRect(origin: .zero, size: screen.frame.size)
        host.autoresizingMask = [.width, .height]
        // "Hide the cat" is self-contained — turn it off + remember the choice.
        model.onHideCat = { [weak self] in self?.setUserCat(false); UserDefaults.standard.set(false, forKey: "userCatOn") }
        let hit = CatHitView(frame: NSRect(origin: .zero, size: screen.frame.size))
        hit.model = model
        hit.addSubview(host)
        p.contentView = hit
        p.setFrame(screen.frame, display: true)
        p.orderFrontRegardless()
        panel = p
    }
}

/// The overlay's content view: transparent to the mouse EVERYWHERE except over your cat's live rect, so a
/// right-click on the cat opens its menu while every other click falls through to the app underneath.
/// Flipped so its coordinates match the SwiftUI/brain space (top-left origin) the cat frame is reported in.
final class CatHitView: NSView {
    weak var model: TeamCursorsModel?
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let model, model.userCat, model.userCatFrame.contains(point) else { return nil }
        return super.hitTest(point)   // → the SwiftUI host → the cat's .contextMenu
    }
}

private struct TeamCursorsView: View {
    @ObservedObject var model: TeamCursorsModel
    let screenSize: CGSize
    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            // Each teammate is a MacCat too — it trails their live cursor (relayed) around the shared screen.
            ForEach(model.cursors) { c in
                RemoteCatView(deviceId: c.deviceId, name: c.name, model: model,
                              screenW: screenSize.width, screenH: screenSize.height)
                    .id(c.deviceId)
            }
            if let p = model.pester {
                PesterCatView(from: p.from, screenW: screenSize.width, screenH: screenSize.height)
                    .id(p.from)   // rebuild (re-spawn) when the sender changes
            }
            if model.userCat {
                UserCatView(model: model, screenW: screenSize.width, screenH: screenSize.height)
            }
        }
        .ignoresSafeArea()
        // Hit-testing stays ON so your cat's right-click menu works; the AppKit CatHitView gates it — only
        // a click on the cat's rect reaches SwiftUI, everything else falls through to the app underneath.
    }
    // Deterministic per-person colour (same idea as the presence dots).
    static func color(for id: String) -> Color {
        var h: UInt64 = 1469598103934665603
        for b in id.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return Color(hue: Double(h % 360) / 360.0, saturation: 0.7, brightness: 1.0)
    }
}

// The /hijack pest: a MacCat — a real animated pixel cat (sprites + behaviour ported from the maccat
// repo). It WALKS toward your cursor, sits & faces you when it catches up, and grooms/stretches while it
// waits — a living pet nagging you to do the task. Its colour is keyed to the sender, so "a cat shows up
// and you work out who it's from" is the whole charm; a name tag says who when you give up guessing.
enum CatAction { case idle, sitting, walking, jumping, grooming, playing, stretch, sleeping, lieDown }

// YOUR cat — the first ambient "cat wrapp" (founder 2026-09-04). A MacCat that trails your OWN cursor all
// the time; not a teammate, not a pest. Brand-lime, no name tag — it's yours. Same brain as the pester
// (wander = a lively pet, not stuck on the pointer), targeting the live LOCAL cursor.
private struct UserCatView: View {
    @ObservedObject var model: TeamCursorsModel
    @StateObject private var brain: PesterCatBrain
    init(model: TeamCursorsModel, screenW: CGFloat, screenH: CGFloat) {
        self.model = model
        _brain = StateObject(wrappedValue: PesterCatBrain(screenW: screenW, screenH: screenH, wander: true, target: {
            let l = NSEvent.mouseLocation
            return CGPoint(x: l.x, y: screenH - l.y)   // local cursor, top-left px
        }))
    }
    var body: some View {
        VStack(spacing: 2) {
            if model.userCatIntro {
                Text("hi, i'm your cat — i hang out while you work.\nright-click me anytime.")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .multilineTextAlignment(.center).foregroundColor(.black)
                    .padding(.horizontal, 9).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.lime))
                    .fixedSize().transition(.opacity)
            }
            catBody
                .scaleEffect(x: brain.facingRight ? 1 : -1, y: 1)
                .contentShape(Rectangle())
                .contextMenu {
                    Button("What's this?") { TeamCursorsOverlay.shared.showCatIntro() }
                    Button("Hide the cat") { model.onHideCat?() }
                    Button("Cat settings…") { model.onCatSettings?() }
                }
        }
        .position(x: brain.catX, y: brain.catY)
        .onAppear { brain.start(); reportFrame(); if model.userCatIntro { hideIntroSoon() } }
        .onDisappear { brain.stop() }
        .onChange(of: brain.catX) { _ in reportFrame() }
        .onChange(of: brain.catY) { _ in reportFrame() }
        .onChange(of: model.userCatIntro) { show in if show { hideIntroSoon() } }
    }
    // The cat's LOOK: a coloured body with GLOWING LIME STRIPES, plus a lime halo. No custom art needed —
    // the white sprite is used as a MASK, and (base colour + diagonal lime bars) is painted through it, so
    // the stripes conform to the cat's silhouette on EVERY animation frame. Body colour is one line to flip.
    private static let bodyColor = Color.black    // black cat, lime stripes (most on-brand); swap for purple
    private var catBody: some View {
        ZStack {
            catImage.interpolation(.none).resizable().frame(width: 66, height: 66)
                .colorMultiply(.lime).blur(radius: 7).opacity(0.8)                 // lime glow halo behind
            ZStack {
                UserCatView.bodyColor
                HStack(spacing: 7) {                                                // diagonal lime stripes
                    ForEach(0..<14, id: \.self) { _ in Rectangle().fill(Color.lime).frame(width: 4) }
                }
                .frame(width: 140, height: 140)
                .rotationEffect(.degrees(32))
            }
            .frame(width: 60, height: 60)
            .mask(catImage.interpolation(.none).resizable().frame(width: 60, height: 60))   // clip to the cat
            .shadow(color: .lime.opacity(0.55), radius: 4)                          // outer glow
        }
    }
    private func reportFrame() { model.userCatFrame = CGRect(x: brain.catX - 34, y: brain.catY - 40, width: 68, height: 82) }
    private func hideIntroSoon() {
        Task { @MainActor in try? await Task.sleep(nanoseconds: 6_000_000_000); withAnimation { model.userCatIntro = false } }
    }
    private var catImage: Image {
        if let img = PesterCats.frame(PesterCats.spriteName(brain.action, brain.frame)) { return Image(nsImage: img) }
        return Image(systemName: "cat.fill")
    }
}

private struct PesterCatView: View {
    let from: String
    @StateObject private var brain: PesterCatBrain
    init(from: String, screenW: CGFloat, screenH: CGFloat) {
        self.from = from
        _brain = StateObject(wrappedValue: PesterCatBrain(screenW: screenW, screenH: screenH, wander: true, target: {
            let l = NSEvent.mouseLocation
            return CGPoint(x: l.x, y: screenH - l.y)   // local cursor, top-left px
        }))
    }
    var body: some View {
        VStack(spacing: 1) {
            catImage
                .interpolation(.none).resizable()
                .frame(width: 64, height: 64)
                .colorMultiply(PesterCats.tint(for: from))   // white base sprite → the sender's colour
                .scaleEffect(x: brain.facingRight ? 1 : -1, y: 1)   // base art faces RIGHT (maccat convention)
                .shadow(color: .black.opacity(0.3), radius: 2, x: 0, y: 2)
            Text(from.isEmpty ? "someone" : from)
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
                .padding(.horizontal, 5).padding(.vertical, 1)
                .background(Capsule().fill(.black.opacity(0.55)))
        }
        .position(x: brain.catX, y: brain.catY)
        .onAppear { brain.start() }
        .onDisappear { brain.stop() }
    }
    private var catImage: Image {
        if let img = PesterCats.frame(PesterCats.spriteName(brain.action, brain.frame)) { return Image(nsImage: img) }
        return Image(systemName: "cat.fill")
    }
}

// A teammate rendered as a MacCat that trails their live (relayed) cursor — the multiplayer "sprites, not
// cursors" surface. Same brain as the pester, but the target is the teammate's cursor from the shared
// model and it stays put on them (no wandering). Colour keyed to their name; name tag underneath.
private struct RemoteCatView: View {
    let name: String
    @StateObject private var brain: PesterCatBrain
    init(deviceId: String, name: String, model: TeamCursorsModel, screenW: CGFloat, screenH: CGFloat) {
        self.name = name
        _brain = StateObject(wrappedValue: PesterCatBrain(screenW: screenW, screenH: screenH, wander: false, target: { [weak model] in
            guard let c = model?.cursors.first(where: { $0.deviceId == deviceId }) else { return nil }
            return CGPoint(x: CGFloat(c.x) * screenW, y: CGFloat(c.y) * screenH)   // teammate's relayed cursor → px
        }))
    }
    var body: some View {
        VStack(spacing: 1) {
            catImage
                .interpolation(.none).resizable().frame(width: 56, height: 56)
                .colorMultiply(PesterCats.tint(for: name))
                .scaleEffect(x: brain.facingRight ? 1 : -1, y: 1)
                .shadow(color: .black.opacity(0.3), radius: 2, x: 0, y: 2)
            Text(name.isEmpty ? "teammate" : name)
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
                .padding(.horizontal, 5).padding(.vertical, 1)
                .background(Capsule().fill(.black.opacity(0.55)))
        }
        .position(x: brain.catX, y: brain.catY)
        .onAppear { brain.start() }
        .onDisappear { brain.stop() }
    }
    private var catImage: Image {
        if let img = PesterCats.frame(PesterCats.spriteName(brain.action, brain.frame)) { return Image(nsImage: img) }
        return Image(systemName: "cat.fill")
    }
}

// The cat's simulation — a faithful port of maccat's WalkingCatView movement (follow / platformWalk /
// staircaseTo / diagonalHop / idle wander), minus the app-specific bits (drag, toss, toys, focus timer,
// sound, buddy). A class so the recursive completion-driven walks stay clean.
@MainActor
final class PesterCatBrain: ObservableObject {
    @Published var catX: CGFloat
    @Published var catY: CGFloat
    @Published var action: CatAction = .idle
    @Published var frame = 0
    @Published var facingRight = true

    private let screenW: CGFloat
    private let screenH: CGFloat
    private let platformHeight: CGFloat = 60
    private let wander: Bool                 // pester = true (lively pet); teammate = false (stays on their cursor)
    private let targetFn: () -> CGPoint?     // where to head (top-left px): local mouse for pester, remote cursor for a teammate
    private var isFollowingMouse = false
    private var running = false
    private var frameTimer: Timer?
    private var idleTimer: Timer?
    private var walkTimer: Timer?
    private var mouseTracker: Timer?
    private var lastMouse: CGPoint = .zero

    init(screenW: CGFloat, screenH: CGFloat, wander: Bool = true, target: @escaping () -> CGPoint?) {
        self.screenW = screenW; self.screenH = screenH; self.wander = wander; self.targetFn = target
        self.catX = screenW / 2; self.catY = screenH / 2
    }

    func start() {
        guard !running else { return }
        running = true
        let m = targetFn() ?? CGPoint(x: screenW / 2, y: screenH / 2)
        if wander {
            catY = min(max(m.y, 60), screenH - 60)
            catX = m.x > screenW / 2 ? 40 : screenW - 40       // pester trots in from the far edge
        } else {
            catX = m.x; catY = m.y                             // teammate cat starts ON their cursor
        }
        frameTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.frame += 1 }
        }
        startMouseTracking()
        pickNextAction()
    }
    func stop() {
        running = false
        [frameTimer, idleTimer, walkTimer, mouseTracker].forEach { $0?.invalidate() }
        frameTimer = nil; idleTimer = nil; walkTimer = nil; mouseTracker = nil
    }

    // ── Follow the cursor: walk if roughly level, hop up/down like stairs otherwise ──
    private func startMouseTracking() {
        mouseTracker = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let m = self.targetFn() else { return }
                let moved = abs(m.x - self.lastMouse.x) > 3 || abs(m.y - self.lastMouse.y) > 3
                self.lastMouse = m
                if self.action == .sleeping || self.action == .lieDown { return }
                guard moved else { return }
                let dx = m.x - self.catX, dy = m.y - self.catY
                let dist = hypot(dx, dy)
                if dist < 70 {                                    // caught up → sit and face you
                    if self.action == .walking || self.action == .jumping {
                        self.walkTimer?.invalidate()
                        self.action = .idle; self.facingRight = dx > 0; self.isFollowingMouse = false
                    }
                    return
                }
                self.idleTimer?.invalidate(); self.walkTimer?.invalidate()
                self.isFollowingMouse = true
                if abs(dy) < self.platformHeight * 0.6 {
                    let tx = self.clampX(self.catX + dx * 0.7)
                    self.platformWalk(to: tx) { self.action = .idle; self.isFollowingMouse = false }
                } else {
                    self.staircaseTo(targetX: m.x, targetY: m.y) { self.action = .idle; self.isFollowingMouse = false }
                }
            }
        }
    }

    // Hop one platform-height at a time toward the target (the diagonal "stairs" climb).
    private func staircaseTo(targetX: CGFloat, targetY: CGFloat, completion: @escaping () -> Void) {
        let dy = targetY - catY
        if abs(dy) < platformHeight * 0.5 {
            let finalX = clampX(catX + (targetX - catX) * 0.6)
            platformWalk(to: finalX, completion: completion); return
        }
        let steps = Int(ceil(abs(dy) / platformHeight))
        let hopDx = (targetX - catX) / CGFloat(max(1, steps))
        let hopDy: CGFloat = dy < 0 ? -platformHeight : platformHeight
        let hopX = clampX(catX + hopDx)
        let hopY = max(40, min(screenH - 40, catY + hopDy))
        diagonalHop(toX: hopX, toY: hopY) {
            if abs(targetY - self.catY) < self.platformHeight * 0.5 {
                let finalX = self.clampX(self.catX + (targetX - self.catX) * 0.6)
                self.platformWalk(to: finalX, completion: completion)
            } else {
                self.staircaseTo(targetX: targetX, targetY: targetY, completion: completion)
            }
        }
    }

    // A single parabolic jump arc from here to (targetX,targetY).
    private func diagonalHop(toX targetX: CGFloat, toY targetY: CGFloat, completion: @escaping () -> Void) {
        let startX = catX, startY = catY
        let arcHeight: CGFloat = 22, totalSteps = 14
        facingRight = targetX > catX
        action = .jumping
        var step = 0
        walkTimer?.invalidate()
        walkTimer = Timer.scheduledTimer(withTimeInterval: 0.018, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); return }
                step += 1
                let p = CGFloat(step) / CGFloat(totalSteps)
                self.catX = startX + (targetX - startX) * p
                self.catY = startY + (targetY - startY) * p - 4.0 * arcHeight * p * (1 - p)
                if step >= totalSteps { timer.invalidate(); self.catX = targetX; self.catY = targetY; completion() }
            }
        }
    }

    // Walk horizontally to targetX at a steady trot.
    private func platformWalk(to targetX: CGFloat, completion: @escaping () -> Void) {
        let dx = targetX - catX
        let speed: CGFloat = 3.0
        let steps = Int(abs(dx) / speed)
        guard steps > 1 else { completion(); return }
        let stepX = dx / CGFloat(steps)
        facingRight = dx > 0
        action = .walking
        var n = 0
        walkTimer?.invalidate()
        walkTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); return }
                self.catX += stepX; n += 1
                if n >= steps { timer.invalidate(); self.catX = targetX; completion() }
            }
        }
    }

    private func walkTo(x targetX: CGFloat, y targetY: CGFloat, completion: @escaping () -> Void) {
        if abs(targetY - catY) > platformHeight * 0.5 { staircaseTo(targetX: targetX, targetY: targetY, completion: completion) }
        else { platformWalk(to: targetX, completion: completion) }
    }

    // ── Idle personality when you're not moving the cursor: wander to a window top, groom, stretch, sit ──
    private func pickNextAction() {
        idleTimer?.invalidate(); walkTimer?.invalidate()
        if isFollowingMouse || !running { return }
        // A teammate cat stays ON their cursor — no wandering off. Just sit and occasionally groom in place.
        if !wander {
            let roll = Int.random(in: 0...100)
            if roll < 45 { action = .grooming; frame = 0; scheduleNext(after: 3) { self.action = .idle; self.scheduleNext(after: 2) } }
            else if roll < 70 { action = .stretch; frame = 0; scheduleNext(after: 2) { self.action = .idle; self.scheduleNext(after: 2) } }
            else { action = .idle; frame = 0; scheduleNext(after: Double.random(in: 2...4)) }
            return
        }
        let roll = Int.random(in: 0...100)
        if roll < 30, let t = getWindowTops().randomElement() {
            let tx = clampX(CGFloat.random(in: (t.minX + 40)...max(t.minX + 41, t.maxX - 40)))
            walkTo(x: tx, y: t.minY) { self.action = .idle; self.scheduleNext(after: Double.random(in: 3...6)) }
        } else if roll < 55 {
            let dist = CGFloat.random(in: 80...240)
            let tx = clampX(Bool.random() ? catX + dist : catX - dist)
            platformWalk(to: tx) { self.action = .idle; self.scheduleNext(after: Double.random(in: 1.5...4)) }
        } else if roll < 72 {
            action = .grooming; frame = 0; scheduleNext(after: 3) { self.action = .idle; self.scheduleNext(after: 1) }
        } else if roll < 86 {
            action = .stretch; frame = 0; scheduleNext(after: 2) { self.action = .idle; self.scheduleNext(after: 1.5) }
        } else {
            action = .sitting; frame = 0; scheduleNext(after: Double.random(in: 2...5))
        }
    }

    private func scheduleNext(after seconds: Double, then: (() -> Void)? = nil) {
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { if let then { then() } else { self?.pickNextAction() } }
        }
    }

    // Real windows on screen → the platforms the cat walks/hops on (top edge of each), like maccat.
    private func getWindowTops() -> [CGRect] {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
        var tops: [CGRect] = []
        for w in list {
            guard let b = w[kCGWindowBounds as String] as? [String: CGFloat],
                  let layer = w[kCGWindowLayer as String] as? Int,
                  let owner = w[kCGWindowOwnerName as String] as? String, layer == 0 else { continue }
            if owner == "Relay" || owner == "Switchboard" || owner == "Window Server" { continue }
            let x = b["X"] ?? 0, y = b["Y"] ?? 0, wd = b["Width"] ?? 0, ht = b["Height"] ?? 0
            if wd > 100 && ht > 50 && y > 60 && y < screenH - 40 {
                tops.append(CGRect(x: x, y: y, width: wd, height: 30))
            }
        }
        return tops
    }

    private func clampX(_ x: CGFloat) -> CGFloat { max(40, min(screenW - 40, x)) }
}

// Loads the maccat cat frames (Resources/sprites/cat/<name>.png), caches them, maps CatAction→frame name
// (following maccat's WalkingCatView), and picks a per-sender colour.
@MainActor
enum PesterCats {
    private static var cache: [String: NSImage?] = [:]

    static func frame(_ name: String) -> NSImage? {
        if let cached = cache[name] { return cached }
        let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "sprites/cat")
        let img = url.flatMap { NSImage(contentsOf: $0) }
        cache[name] = img
        return img
    }

    static func spriteName(_ a: CatAction, _ frame: Int) -> String {
        switch a {
        case .idle:     return "sit_\(frame % 4)"
        case .sitting:  return "sit_alt_\(frame % 4)"
        case .walking:  let w = [3, 4, 5, 6]; return "stretch_\(w[frame % 4])"   // all-fours leg cycle
        case .jumping:  return "play_\(2 + (frame % 2))"                          // mid-air frames
        case .grooming: return "groom_\(frame % 6)"
        case .playing:  return "play_\(frame % 7)"
        case .stretch:  return "stretch_\(frame % 8)"
        case .sleeping: return "sleep_loop_\(frame % 4)"
        case .lieDown:  return "liedown_\(min(frame % 8, 7))"
        }
    }

    // MacCat's cat palette — the white base sprite colour-multiplied per sender.
    static let tints: [Color] = [
        Color(red: 1.0, green: 0.78, blue: 0.45),   // orange
        Color(red: 0.42, green: 0.44, blue: 0.5),   // grey/black
        Color(red: 0.98, green: 0.98, blue: 1.0),   // white
        Color(red: 1.0, green: 0.66, blue: 0.28),   // ginger
        Color(red: 0.6,  green: 0.72, blue: 1.0),   // blue
        Color(red: 1.0,  green: 0.7,  blue: 0.82),  // pink
        Color(red: 1.0,  green: 0.85, blue: 0.42),  // golden
    ]
    static func tint(for from: String) -> Color {
        var h: UInt64 = 1469598103934665603
        for b in from.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return tints[Int(h % UInt64(tints.count))]
    }
}
