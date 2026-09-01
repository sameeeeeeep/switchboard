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

@MainActor final class TeamCursorsModel: ObservableObject {
    @Published var cursors: [RemoteCursor] = []
}

@MainActor final class TeamCursorsOverlay {
    static let shared = TeamCursorsOverlay()
    private let model = TeamCursorsModel()
    private var panel: NSPanel?
    private var localTimer: Timer?
    private var pruneTimer: Timer?
    private var active = false
    private var lastSent: (Double, Double) = (-1, -1)

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
            panel?.orderOut(nil); panel = nil
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
        if model.cursors.isEmpty && before > 0 { panel?.orderOut(nil); panel = nil }
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
