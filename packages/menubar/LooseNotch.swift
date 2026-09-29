// LooseNotch — phase 1 of "The Loose Notch" PRD: the notch's dot field (with its eyes) can be pulled down
// off the notch into a free pill, dragged anywhere, snapped to eight anchors, and docked back.
//
// Shape of the change: the docked notch window (the orb) never moves, because cards, the panel and God's
// drops are all positioned against it. Detaching shows a SEPARATE small panel (the creature) and makes the
// notch window invisible and click-through (founder: "removed, not in both places"); docking reverses both. The creature panel is only as big as the
// pill plus a margin, so it never swallows clicks elsewhere (lesson from the full-screen cat overlay).
//
//   pull the notch down past 24 pt → loose · drag → move · drop near an anchor → snap
//   drop in the notch zone, double-click, or hover → DOCK → docked · position kept in ~/.relay/presence.json
import AppKit
import SwiftUI

@MainActor
final class LooseNotch {
    static let shared = LooseNotch()

    private var panel: NotchPanel?
    private weak var model: Model?
    private var notchFrame: () -> NSRect = { .zero }
    private var onOpen: () -> Void = {}
    private var setNotchGone: (Bool) -> Void = { _ in }   // loose = the notch leaves its spot entirely (never in both places)
    private var grab = CGPoint.zero          // pointer offset inside the pill while dragging it
    static let size = CGSize(width: 132, height: 40)       // pill 120×32 + 6 pt margin all round
    private let pullThreshold: CGFloat = 24
    private let dockRadius: CGFloat = 60
    private let snapRadius: CGFloat = 140

    private var statePath: String { (NSHomeDirectory() as NSString).appendingPathComponent(".relay/presence.json") }

    func attach(model: Model, notchFrame: @escaping () -> NSRect, onOpen: @escaping () -> Void,
                setNotchGone: @escaping (Bool) -> Void) {
        self.model = model; self.notchFrame = notchFrame; self.onOpen = onOpen; self.setNotchGone = setNotchGone
        if let d = FileManager.default.contents(atPath: statePath),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any], j["mode"] as? String == "free",
           let x = j["x"] as? Double, let y = j["y"] as? Double {
            let origin = CGPoint(x: x, y: y)
            if NSScreen.screens.contains(where: { $0.visibleFrame.insetBy(dx: -4, dy: -4).contains(NSRect(origin: origin, size: Self.size)) }) {
                show(at: origin)
            }
        }
    }

    // MARK: pulling it off the notch (called by the orb's drag gesture)

    func pullFromNotch(translation: CGSize, ended: Bool) {
        let loose = model?.creatureLoose ?? false
        if !loose {
            guard translation.height > pullThreshold else { return }
            grab = CGPoint(x: Self.size.width / 2, y: Self.size.height / 2)
            show(at: originUnderPointer())
        } else {
            panel?.setFrameOrigin(originUnderPointer())
        }
        if ended { settle() }
    }

    // MARK: dragging the pill itself

    func dragChanged(first: Bool) {
        guard let panel else { return }
        let m = NSEvent.mouseLocation
        if first { grab = CGPoint(x: m.x - panel.frame.minX, y: m.y - panel.frame.minY) }
        panel.setFrameOrigin(originUnderPointer())
    }
    func dragEnded() { settle() }

    func open() { onOpen() }

    // Where the eyes are on screen, so they can look at the pointer.
    nonisolated func notchCenter() -> CGPoint? { MainActor.assumeIsolated { let f = notchFrame(); return f == .zero ? nil : CGPoint(x: f.midX, y: f.midY) } }
    nonisolated func creatureCenter() -> CGPoint? { MainActor.assumeIsolated { panel.map { CGPoint(x: $0.frame.midX, y: $0.frame.midY) } } }

    func dock() {
        panel?.orderOut(nil)
        model?.creatureLoose = false
        setNotchGone(false)
        save(mode: "docked", origin: nil)
    }

    // MARK: internals

    private func originUnderPointer() -> CGPoint {
        let m = NSEvent.mouseLocation
        return CGPoint(x: m.x - grab.x, y: m.y - grab.y)
    }

    private func show(at origin: CGPoint) {
        if panel == nil {
            let p = NotchPanel(contentRect: NSRect(origin: origin, size: Self.size), styleMask: [.borderless, .nonactivatingPanel],
                               backing: .buffered, defer: true)
            p.isOpaque = false
            p.backgroundColor = .clear
            p.hasShadow = false
            p.level = .popUpMenu
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
            p.acceptsMouseMovedEvents = true
            if let model { p.contentView = NoInsetHostingView(rootView: CreatureView(model: model, loose: self)) }
            panel = p
        }
        panel?.setFrameOrigin(origin)
        panel?.orderFrontRegardless()
        model?.creatureLoose = true
        setNotchGone(true)
    }

    /// Drop logic: back in the notch zone → dock; near one of eight anchors → snap there; else stay put.
    private func settle() {
        guard let panel, let screen = panel.screen ?? NSScreen.main else { return }
        let f = panel.frame
        let notch = notchFrame()
        if hypot(f.midX - notch.midX, f.maxY - notch.minY) < dockRadius || f.maxY > screen.visibleFrame.maxY + 4 {
            dock(); return
        }
        let v = screen.visibleFrame.insetBy(dx: 16, dy: 16)
        let w = f.width, h = f.height
        let anchors: [CGPoint] = [
            CGPoint(x: v.minX, y: v.maxY - h), CGPoint(x: v.midX - w / 2, y: v.maxY - h), CGPoint(x: v.maxX - w, y: v.maxY - h),
            CGPoint(x: v.minX, y: v.midY - h / 2), CGPoint(x: v.maxX - w, y: v.midY - h / 2),
            CGPoint(x: v.minX, y: v.minY), CGPoint(x: v.midX - w / 2, y: v.minY), CGPoint(x: v.maxX - w, y: v.minY),
        ]
        var target = CGPoint(x: min(max(f.minX, v.minX), v.maxX - w), y: min(max(f.minY, v.minY), v.maxY - h))
        if let near = anchors.min(by: { hypot($0.x - f.minX, $0.y - f.minY) < hypot($1.x - f.minX, $1.y - f.minY) }),
           hypot(near.x - f.minX, near.y - f.minY) < snapRadius {
            target = near
        }
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.18
            panel.animator().setFrameOrigin(target)
        }
        save(mode: "free", origin: target)
    }

    private func save(mode: String, origin: CGPoint?) {
        var j: [String: Any] = ["mode": mode]
        if let o = origin { j["x"] = o.x; j["y"] = o.y }
        if let d = try? JSONSerialization.data(withJSONObject: j) { try? d.write(to: URL(fileURLWithPath: statePath)) }
    }
}

/// The loose notch: the same lamp field and eyes as the notch, cut to a pill. Click opens the panel,
/// double-click docks, drag moves it; hover shows STOP WATCHING (when journaling) and DOCK.
struct CreatureView: View {
    @ObservedObject var model: Model
    let loose: LooseNotch
    @State private var hovering = false
    @State private var dragging = false
    var body: some View {
        let tint = model.running ? (model.signedIn ? Color.lime : Color.danger) : Color.inkFaint
        let shape = Capsule()
        ZStack {
            shape.fill(Color.page)
            NotchField(accent: tint, working: model.working, animated: model.running, eyes: true,
                       eyeColor: model.cameraOn ? Color.senseCamera : (model.listening ? Color.senseAudio : nil),
                       gaze: { loose.creatureCenter() })
                .padding(.horizontal, 6).padding(.vertical, 3)
                .clipShape(shape)
            shape.stroke(tint.opacity(hovering ? 0.55 : 0.22), lineWidth: hovering ? 1.1 : 0.75)
            if hovering && !dragging {
                // The pill is small: icon buttons, with tooltips, instead of the notch's word pills.
                HStack(spacing: 8) {
                    SensesPill()
                    CreatureIconButton(symbol: "arrow.up.to.line", help: "Put it back in the notch") { loose.dock() }
                }
            }
        }
        .frame(width: 120, height: 32)
        .shadow(color: Color.lime.opacity(0.18), radius: 4, y: 1)
        .frame(width: LooseNotch.size.width, height: LooseNotch.size.height)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .gesture(DragGesture(minimumDistance: 3, coordinateSpace: .global)
            .onChanged { _ in loose.dragChanged(first: !dragging); dragging = true }
            .onEnded { _ in dragging = false; loose.dragEnded() })
        .onTapGesture(count: 2) { loose.dock() }
        .onTapGesture { loose.open() }
        .help("Drag to move. Double-click to put it back in the notch.")
    }
}

struct CreatureIconButton: View {
    let symbol: String
    let help: String
    var action: () -> Void
    @State private var over = false
    var body: some View {
        Image(systemName: symbol).font(.system(size: 9, weight: .bold))
            .foregroundColor(over ? Color.page : Color.lime)
            .frame(width: 22, height: 18)
            .background(Capsule().fill(over ? Color.lime : Color.page))
            .overlay(Capsule().stroke(Color.lime.opacity(0.8), lineWidth: 0.8))
            .contentShape(Capsule())
            .onHover { over = $0 }
            .onTapGesture { action() }
            .help(help)
    }
}
