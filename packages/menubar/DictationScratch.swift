// DictationScratch — the onboarding dictation demo's REAL target (ONBOARDING-SPEC §11). The founder asked,
// repeatedly, that teaching dictation OPEN a native window with a focused text field to talk INTO — not
// "hold in any field, go find one". This is that window: a dot-matrix-framed panel with a big focused text
// view, opened when the dictation beat is reached (onStepEnter) so ⌃⌥ speech lands visibly in front of you.
import AppKit
import SwiftUI

@MainActor final class DictationScratch {
    static let shared = DictationScratch()
    private var panel: NSPanel?

    private let lime = NSColor(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0, alpha: 1)
    private let ink  = NSColor(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0, alpha: 1)
    private let panelBG = NSColor(red: 0x12/255.0, green: 0x15/255.0, blue: 0x1C/255.0, alpha: 1)
    private let edge = NSColor(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0, alpha: 1)

    /// Open the scratch window and focus its field, so the very next ⌃⌥ dictation types into it.
    func show() {
        if let p = panel { p.makeKeyAndOrderFront(nil); focusField(); return }
        guard let screen = NSScreen.main else { return }
        let w: CGFloat = 560, h: CGFloat = 260
        let rect = NSRect(x: screen.frame.midX - w/2, y: screen.frame.midY - h/2 + 40, width: w, height: h)
        let p = NSPanel(contentRect: rect, styleMask: [.titled, .closable, .nonactivatingPanel, .fullSizeContentView],
                        backing: .buffered, defer: false)
        p.titlebarAppearsTransparent = true
        p.titleVisibility = .hidden
        p.isMovableByWindowBackground = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.backgroundColor = panelBG
        p.hasShadow = true

        let root = NSView(frame: NSRect(x: 0, y: 0, width: w, height: h))
        root.wantsLayer = true
        root.layer?.backgroundColor = panelBG.cgColor
        root.layer?.cornerRadius = 16
        root.layer?.borderWidth = 1
        root.layer?.borderColor = lime.withAlphaComponent(0.38).cgColor

        // header
        let title = NSTextField(labelWithString: "SCRATCH — SAY SOMETHING")
        title.font = NSFont(name: "Doto", size: 12) ?? .boldSystemFont(ofSize: 12)
        title.textColor = lime
        title.frame = NSRect(x: 20, y: h - 40, width: w - 40, height: 20)
        root.addSubview(title)

        let hint = NSTextField(labelWithString: "Hold  ⌃⌥  and talk · release  ⌃  · watch it land ↓")
        hint.font = NSFont(name: "Spline Sans Mono", size: 11) ?? .systemFont(ofSize: 11)
        hint.textColor = NSColor(white: 0.6, alpha: 1)
        hint.frame = NSRect(x: 20, y: h - 62, width: w - 40, height: 18)
        root.addSubview(hint)

        // the field — a bordered, focused text view the dictation pastes into
        let scroll = NSScrollView(frame: NSRect(x: 20, y: 20, width: w - 40, height: h - 92))
        scroll.wantsLayer = true
        scroll.layer?.cornerRadius = 11
        scroll.layer?.backgroundColor = NSColor(red: 0x0d/255.0, green: 0x0f/255.0, blue: 0x14/255.0, alpha: 1).cgColor
        scroll.layer?.borderWidth = 1
        scroll.layer?.borderColor = edge.cgColor
        scroll.hasVerticalScroller = false
        scroll.drawsBackground = false

        let tv = NSTextView(frame: scroll.bounds)
        tv.isEditable = true
        tv.isRichText = false
        tv.drawsBackground = false
        tv.font = NSFont(name: "Spline Sans Mono", size: 17) ?? .systemFont(ofSize: 17)
        tv.textColor = ink
        tv.insertionPointColor = lime
        tv.textContainerInset = NSSize(width: 12, height: 12)
        tv.autoresizingMask = [.width, .height]
        tv.string = ""
        scroll.documentView = tv
        root.addSubview(scroll)

        p.contentView = root
        p.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        p.makeFirstResponder(tv)
        panel = p
        self.field = tv
    }

    private weak var field: NSTextView?
    private func focusField() { if let f = field { f.window?.makeFirstResponder(f) } }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
        field = nil
    }
}
