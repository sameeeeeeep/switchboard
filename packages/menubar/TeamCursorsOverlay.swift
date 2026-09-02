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
    var x: Double
    var y: Double
    var facingRight: Bool = true   // flips the cat to face the way it's chasing
}

@MainActor final class TeamCursorsModel: ObservableObject {
    @Published var cursors: [RemoteCursor] = []
    @Published var pester: PesterSprite? = nil
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
    private var pesterTimer: Timer?
    private var pesterFrom = ""
    private var pesterTask = ""
    private var pesterPos: (Double, Double)? = nil   // current lerped sprite pos (normalized), nil until first tick

    /// Set by the controller to actually send our cursor to the daemon (→ team). x,y normalized 0..1.
    var onLocalCursor: ((Double, Double) -> Void)?

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
        if pesterPos == nil { pesterPos = currentCursorNorm() }   // spawn ON the cursor, then trail it
        let p = pesterPos ?? (0.5, 0.5)
        model.pester = PesterSprite(from: from, task: task, x: p.0, y: p.1)
        if pesterTimer == nil {
            pesterTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.tickPester() }
            }
        }
    }

    /// Stop pestering (task done, or the daemon cleared ~/.relay/pester.json). Idempotent.
    func stopPester() {
        guard model.pester != nil || pesterTimer != nil else { return }
        pesterTimer?.invalidate(); pesterTimer = nil
        pesterFrom = ""; pesterTask = ""; pesterPos = nil
        model.pester = nil
        updatePanelVisibility()
    }

    // Ease the sprite toward the live cursor each frame — a lagging chase (never snaps onto the pointer,
    // so it reads as "following you", not "your cursor").
    private func tickPester() {
        guard model.pester != nil, let target = currentCursorNorm() else { return }
        let cur = pesterPos ?? target
        let k = 0.12   // chase stiffness — lower = more laggy pest
        let dx = target.0 - cur.0
        let nx = cur.0 + dx * k
        let ny = cur.1 + (target.1 - cur.1) * k
        pesterPos = (nx, ny)
        model.pester?.x = nx
        model.pester?.y = ny
        if abs(dx) > 0.0015 { model.pester?.facingRight = dx > 0 }   // face the chase (ignore jitter when caught up)
    }

    // This machine's pointer as normalized 0..1 top-left coords (same convention as tickLocal).
    private func currentCursorNorm() -> (Double, Double)? {
        guard let screen = NSScreen.main else { return nil }
        let f = screen.frame
        guard f.width > 0, f.height > 0 else { return nil }
        let loc = NSEvent.mouseLocation
        let nx = min(max((loc.x - f.minX) / f.width, 0), 1)
        let ny = min(max(1 - (loc.y - f.minY) / f.height, 0), 1)
        return (Double(nx), Double(ny))
    }

    // Show the overlay iff SOMETHING wants it (a teammate cursor or a pester); otherwise tear it down.
    private func updatePanelVisibility() {
        if model.cursors.isEmpty && model.pester == nil {
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
        p.ignoresMouseEvents = true                            // pure decoration — clicks pass through
        p.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        p.contentView = NSHostingView(rootView: TeamCursorsView(model: model, screenSize: screen.frame.size))
        p.setFrame(screen.frame, display: true)
        p.orderFrontRegardless()
        panel = p
    }
}

private struct TeamCursorsView: View {
    @ObservedObject var model: TeamCursorsModel
    let screenSize: CGSize
    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            ForEach(model.cursors) { c in
                RemoteSpriteView(name: c.name, color: Self.color(for: c.deviceId))
                    .position(x: CGFloat(c.x) * screenSize.width, y: CGFloat(c.y) * screenSize.height)
                    .animation(.linear(duration: 1.0 / 30.0), value: c.x)
                    .animation(.linear(duration: 1.0 / 30.0), value: c.y)
            }
            if let p = model.pester {
                PesterSpriteView(from: p.from, facingRight: p.facingRight)
                    .position(x: CGFloat(p.x) * screenSize.width, y: CGFloat(p.y) * screenSize.height)
                    .animation(.linear(duration: 1.0 / 30.0), value: p.x)
                    .animation(.linear(duration: 1.0 / 30.0), value: p.y)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
    // Deterministic per-person colour (same idea as the presence dots).
    static func color(for id: String) -> Color {
        var h: UInt64 = 1469598103934665603
        for b in id.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return Color(hue: Double(h % 360) / 360.0, saturation: 0.7, brightness: 1.0)
    }
}

// The /hijack pest: a MacCat — a real animated pixel cat (sprites from the maccat repo) that trails your
// cursor. Which cat you get is keyed to the sender, so "a cat shows up and you work out who it's from"
// is the whole charm. A small name tag underneath says who (for when you give up guessing).
private struct PesterSpriteView: View {
    let from: String
    let facingRight: Bool
    @State private var frame = 0
    private let ticker = Timer.publish(every: 0.09, on: .main, in: .common).autoconnect()   // ~11fps walk cycle
    var body: some View {
        let sheet = CatSprites.walk(for: from)
        return VStack(spacing: 1) {
            if let sheet, !sheet.frames.isEmpty {
                Image(decorative: sheet.frames[frame % sheet.frames.count], scale: 1.0)
                    .interpolation(.none)                       // crisp pixels, no blur when upscaled
                    .resizable()
                    .frame(width: 60, height: 60)
                    .scaleEffect(x: facingRight ? 1 : -1, y: 1)  // face the chase
                    .hueRotation(.degrees(CatSprites.hue(for: from)))   // per-sender tint → more distinct cats
                    .shadow(color: .black.opacity(0.28), radius: 2, x: 0, y: 2)
            } else {
                Text("🐱").font(.system(size: 34))               // fallback if the sheet is missing
            }
            Text(from.isEmpty ? "someone" : from)
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
                .padding(.horizontal, 5).padding(.vertical, 1)
                .background(Capsule().fill(.black.opacity(0.55)))
        }
        .fixedSize()
        .onReceive(ticker) { _ in frame &+= 1 }
    }
}

// Loads the maccat sprite roster (Resources/sprites/*.png), slices each horizontal sheet into square
// frames, and picks a per-sender cat. Cached so the view doesn't re-decode every frame.
@MainActor
final class SpriteSheet {
    let frames: [CGImage]
    init?(resource: String) {
        guard let url = Bundle.main.url(forResource: resource, withExtension: "png", subdirectory: "sprites"),
              let img = NSImage(contentsOf: url) else { return nil }
        var rect = CGRect(origin: .zero, size: img.size)
        guard let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil), cg.height > 0 else { return nil }
        let fw = cg.height                                   // square frames (sheet is a horizontal strip)
        let n = max(1, cg.width / fw)
        var fs: [CGImage] = []
        for i in 0..<n {
            if let c = cg.cropping(to: CGRect(x: i * fw, y: 0, width: fw, height: cg.height)) { fs.append(c) }
        }
        guard !fs.isEmpty else { return nil }
        frames = fs
    }
}

@MainActor
enum CatSprites {
    static let variants = ["cat-orange", "cat-navy"]        // "cats to begin with"; add more sheets here
    private static var cache: [String: SpriteSheet?] = [:]

    static func walk(for from: String) -> SpriteSheet? {
        let name = variants[bucket(from, count: variants.count)] + "-walk"
        if let cached = cache[name] { return cached }
        let s = SpriteSheet(resource: name)
        cache[name] = s
        return s
    }
    // A per-sender hue shift (6 buckets) multiplies the 2 base cats into ~a dozen distinguishable cats.
    static func hue(for from: String) -> Double { Double(bucket(from + "#hue", count: 6)) * 52.0 }

    private static func bucket(_ s: String, count: Int) -> Int {
        var h: UInt64 = 1469598103934665603
        for b in s.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return Int(h % UInt64(max(1, count)))
    }
}

// Sprite v1: a pointer + a name pill in the person's colour. (Placeholder for a real emote character sprite.)
private struct RemoteSpriteView: View {
    let name: String
    let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            // pointer
            Image(systemName: "cursorarrow.fill")
                .font(.system(size: 20))
                .foregroundColor(color)
                .shadow(color: .black.opacity(0.5), radius: 2, x: 0, y: 1)
            // name pill
            Text(name.isEmpty ? "teammate" : name)
                .font(.custom("Spline Sans Mono", size: 11))
                .foregroundColor(.black)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Capsule().fill(color))
                .shadow(color: .black.opacity(0.35), radius: 3, x: 0, y: 1)
                .offset(x: 12)
        }
        .fixedSize()
    }
}
