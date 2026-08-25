// NotchTray — a small floating tray at the notch that holds MINIMISED surfaces as chips (founder 2026-08-25).
//
// Minimise any surface (the whiteboard first; notch cards / God / apps later) and instead of collapsing in
// place, it HIDES and drops a chip here; click the chip to restore it. The notch becomes the home for
// everything you've stashed — a Dock, but for the notch. Multiple things coexist as a row of chips.
//
// Shared singleton so any surface (each in its own window) can register: `NotchTray.shared.add(id:…, restore:{…})`
// drops a chip; clicking it calls `restore()` and clears the chip; `remove(id:)` clears it without restoring
// (e.g. the surface was closed while stashed). The tray panel shows only while ≥1 chip exists, and rides a
// native-fullscreen Space (same [.canJoinAllSpaces, .transient, .fullScreenAuxiliary] recipe as the notch).
import AppKit
import SwiftUI

struct TrayItem: Identifiable {
    let id: String
    var label: String
    var glyph: String            // short brand glyph shown on the chip (e.g. "◆" for the whiteboard)
    var restore: () -> Void
}

@MainActor
final class NotchTrayModel: ObservableObject {
    @Published var items: [TrayItem] = []
}

@MainActor
final class NotchTray {
    static let shared = NotchTray()
    private init() {}

    private let model = NotchTrayModel()
    private var panel: NotchTrayPanel?

    /// Stash a surface as a chip (idempotent per id — re-adding updates it). `restore` is invoked on tap.
    func add(id: String, label: String, glyph: String, restore: @escaping () -> Void) {
        let item = TrayItem(id: id, label: label, glyph: glyph, restore: restore)
        if let i = model.items.firstIndex(where: { $0.id == id }) { model.items[i] = item }
        else { model.items.append(item) }
        ensurePanel(); reflow()
    }

    /// Clear a chip WITHOUT restoring (the surface was closed, or already restored).
    func remove(id: String) { model.items.removeAll { $0.id == id }; reflow() }

    /// Is this surface currently stashed as a chip?
    func isStashed(_ id: String) -> Bool { model.items.contains { $0.id == id } }

    /// Tap handler: restore the surface, then drop its chip.
    private func restore(id: String) {
        guard let it = model.items.first(where: { $0.id == id }) else { return }
        it.restore()
        remove(id: id)
    }

    private func ensurePanel() {
        guard panel == nil else { return }
        panel = NotchTrayPanel(model: model, onTap: { [weak self] id in self?.restore(id: id) })
    }

    private func reflow() {
        guard let p = panel else { return }
        if model.items.isEmpty { p.orderOut(nil) }
        else { p.reposition(); p.orderFrontRegardless() }
    }
}

// MARK: - Panel

/// A small borderless floating panel, top-centre just under the notch, hosting the chips row. Non-activating
/// but key-capable so the chips are clickable without stealing focus from whatever you're doing.
final class NotchTrayPanel: NSPanel {
    private let host: NSHostingView<NotchTrayView>

    init(model: NotchTrayModel, onTap: @escaping (String) -> Void) {
        host = NSHostingView(rootView: NotchTrayView(model: model, onTap: onTap))
        super.init(contentRect: NSRect(x: 0, y: 0, width: 120, height: 40),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .popUpMenu
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]  // ride fullscreen like the notch
        isReleasedWhenClosed = false
        contentView = host
    }

    override var canBecomeKey: Bool { true }     // chips must accept clicks
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }

    /// Size to the chips and centre it under the notch (top-centre of the main screen).
    func reposition() {
        host.layoutSubtreeIfNeeded()
        let fit = host.fittingSize
        let w = max(60, fit.width), h = max(28, fit.height)
        guard let scr = NSScreen.main else { return }
        let x = scr.frame.midX - w / 2
        let y = scr.frame.maxY - h - 6            // just below the very top / notch
        setFrame(NSRect(x: x, y: y, width: w, height: h), display: true)
    }
}

// MARK: - View

private struct NotchTrayView: View {
    @ObservedObject var model: NotchTrayModel
    let onTap: (String) -> Void
    @State private var hover: String? = nil

    private let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    private let panelBg = Color(red: 0x12/255.0, green: 0x16/255.0, blue: 0x0C/255.0)
    private let ink = Color(red: 0xE8/255.0, green: 0xEF/255.0, blue: 0xD8/255.0)

    var body: some View {
        HStack(spacing: 6) {
            ForEach(model.items) { it in
                Button(action: { onTap(it.id) }) {
                    HStack(spacing: 6) {
                        Text(it.glyph).font(.system(size: 12, weight: .bold)).foregroundColor(lime)
                        if hover == it.id {
                            Text(it.label).font(.system(size: 11, weight: .medium)).foregroundColor(ink).lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 9).padding(.vertical, 6)
                    .background(
                        Capsule().fill(panelBg)
                            .overlay(Capsule().stroke(lime.opacity(hover == it.id ? 0.85 : 0.35), lineWidth: 1))
                    )
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .onHover { inside in hover = inside ? it.id : (hover == it.id ? nil : hover) }
                .help("Restore \(it.label)")
            }
        }
        .padding(6)
        .fixedSize()
    }
}
