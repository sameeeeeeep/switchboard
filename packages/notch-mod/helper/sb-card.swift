// sb-card — one-shot native card for the Switchboard notch mod.
//
// Shows ONE question as a Dynamic-Island-style card dropped from the notch (or beside the cursor),
// waits for the answer, prints it as JSON on stdout, and exits. No daemon, no Switchboard.app,
// no TCC permissions: it only draws its own window and reads the public mouse position.
//
//   sb-card '<json>'
//   json: { title?, question, options:[{label, detail?, recommended?}], at?: "notch"|"cursor",
//           source?, timeout?: seconds }
//   stdout: {"answer":"<label>","index":n} | {"answer":"<typed>","typed":true}
//           | {"cancelled":true,"reason":"esc"|"timeout"}
//
// Keys: 1-4 pick · ↑↓ move · ⏎ confirm · type + ⏎ answers in your own words · esc cancels.

import AppKit
import SwiftUI

struct CardOption: Decodable { let label: String; let detail: String?; let recommended: Bool? }
struct CardSpec: Decodable {
    let title: String?; let question: String; let options: [CardOption]
    let at: String?; let source: String?; let timeout: Double?
}

// Claude's design language: warm ivory / warm charcoal surfaces, terracotta accent, serif voice.
struct Palette {
    let bg, raised, border, text, muted, accent: Color
    static func hex(_ v: UInt32) -> Color {
        Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
    static let light = Palette(bg: hex(0xFAF9F5), raised: hex(0xF0EEE6), border: hex(0xE3E0D5),
                               text: hex(0x141413), muted: hex(0x6B6A65), accent: hex(0xD97757))
    static let dark = Palette(bg: hex(0x262624), raised: hex(0x30302E), border: hex(0x3E3E3A),
                              text: hex(0xFAF9F5), muted: hex(0xA3A29C), accent: hex(0xD97757))
}

func emit(_ obj: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

final class Model: ObservableObject {
    let spec: CardSpec
    @Published var selected: Int
    @Published var typed = ""
    @Published var shown = false
    init(_ spec: CardSpec) {
        self.spec = spec
        selected = spec.options.firstIndex { $0.recommended == true } ?? 0
    }
    func pick(_ i: Int) { emit(["answer": spec.options[i].label, "index": i]) }
    func submit() {
        let t = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { emit(["answer": t, "typed": true]) }
        if !spec.options.isEmpty { pick(selected) }
    }
}

struct CardView: View {
    @ObservedObject var m: Model
    @Environment(\.colorScheme) var scheme
    @FocusState var fieldFocused: Bool
    var p: Palette { scheme == .dark ? .dark : .light }
    var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 20,
                               bottomTrailingRadius: 20, topTrailingRadius: 12)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Text("✻").font(.system(size: 13, weight: .bold)).foregroundColor(p.accent)
                Text(m.spec.title ?? "Claude has a question")
                    .font(.system(size: 11.5, weight: .medium)).foregroundColor(p.muted)
                Spacer()
                if let s = m.spec.source {
                    Text(s).font(.system(size: 10.5)).foregroundColor(p.muted.opacity(0.8)).lineLimit(1)
                }
            }
            Text(m.spec.question)
                .font(.system(size: 16, weight: .regular, design: .serif)).foregroundColor(p.text)
                .lineSpacing(2).fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 6) {
                ForEach(Array(m.spec.options.enumerated()), id: \.offset) { i, o in row(i, o) }
            }
            TextField("", text: $m.typed,
                      prompt: Text("Something else? Type it here").foregroundColor(p.muted.opacity(0.7)))
                .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundColor(p.text)
                .padding(.horizontal, 11).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 10).fill(p.bg))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(p.border, lineWidth: 1))
                .focused($fieldFocused)
                .onSubmit { m.submit() }
            HStack(spacing: 10) {
                hint("1–\(max(1, m.spec.options.count))", "choose")
                hint("↵", "confirm")
                hint("esc", "dismiss")
            }
        }
        .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 14)
        .frame(width: 440)
        .background(shape.fill(p.bg))
        .overlay(shape.stroke(p.border, lineWidth: 1))
        .scaleEffect(m.shown ? 1 : 0.92, anchor: .top)
        .opacity(m.shown ? 1 : 0)
        .onAppear { fieldFocused = true }
    }

    func hint(_ key: String, _ what: String) -> some View {
        HStack(spacing: 4) {
            Text(key).font(.system(size: 9.5, weight: .medium)).foregroundColor(p.muted)
                .padding(.horizontal, 4).padding(.vertical, 1)
                .background(RoundedRectangle(cornerRadius: 4).stroke(p.border, lineWidth: 1))
            Text(what).font(.system(size: 10)).foregroundColor(p.muted)
        }
    }

    func row(_ i: Int, _ o: CardOption) -> some View {
        let on = i == m.selected
        return Button { m.pick(i) } label: {
            HStack(alignment: .top, spacing: 10) {
                Text("\(i + 1)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(on ? .white : p.muted)
                    .frame(width: 20, height: 20)
                    .background(RoundedRectangle(cornerRadius: 6).fill(on ? p.accent : p.bg))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(on ? .clear : p.border, lineWidth: 1))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(o.label).font(.system(size: 13, weight: .medium)).foregroundColor(p.text)
                        if o.recommended == true {
                            Text("Recommended").font(.system(size: 9.5, weight: .medium))
                                .foregroundColor(p.accent)
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background(Capsule().fill(p.accent.opacity(0.12)))
                        }
                    }
                    if let d = o.detail, !d.isEmpty {
                        Text(d).font(.system(size: 11.5)).foregroundColor(p.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 11).fill(on ? p.raised : .clear))
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(on ? p.accent.opacity(0.55) : p.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { if $0 { m.selected = i } }
    }
}

final class CardPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

// ── main ──
guard CommandLine.arguments.count > 1,
      let spec = try? JSONDecoder().decode(CardSpec.self, from: Data(CommandLine.arguments[1].utf8)) else {
    FileHandle.standardError.write(Data("usage: sb-card '<json>'\n".utf8)); exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
// Test hook: force an appearance (SB_CARD_APPEARANCE=light|dark); otherwise follow the system.
if let a = ProcessInfo.processInfo.environment["SB_CARD_APPEARANCE"] {
    app.appearance = NSAppearance(named: a == "dark" ? .darkAqua : .aqua)
}

let model = Model(spec)
let host = NSHostingView(rootView: CardView(m: model))
host.layoutSubtreeIfNeeded()
let size = host.fittingSize

// Notch: the screen with a top safe-area inset (the notch), else the main screen; flush to its top
// edge so the black card reads as the notch growing down. Cursor: just below-right of the pointer.
let mouse = NSEvent.mouseLocation
let atCursor = spec.at == "cursor"
let screen: NSScreen = atCursor
    ? (NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main!)
    : (NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main!)
var origin: NSPoint
if atCursor {
    origin = NSPoint(x: mouse.x + 14, y: mouse.y - 18 - size.height)
    let f = screen.visibleFrame
    origin.x = min(max(origin.x, f.minX + 8), f.maxX - size.width - 8)
    origin.y = min(max(origin.y, f.minY + 8), f.maxY - size.height - 8)
} else {
    origin = NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height)
}

let panel = CardPanel(contentRect: NSRect(origin: origin, size: size),
                      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
panel.contentView = host
panel.isOpaque = false
panel.backgroundColor = .clear
panel.hasShadow = true
panel.level = .popUpMenu                      // above the menu bar, so it can sit in the notch
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
panel.isMovableByWindowBackground = false
panel.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
DispatchQueue.main.async {
    withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) { model.shown = true }
}

// Keys the text field doesn't consume: digits pick (only while the field is empty), arrows move,
// esc dismisses. Return is handled by the field's onSubmit.
NSEvent.addLocalMonitorForEvents(matching: .keyDown) { ev in
    switch ev.keyCode {
    case 53: emit(["cancelled": true, "reason": "esc"])
    case 125: model.selected = min(model.selected + 1, max(0, spec.options.count - 1)); return nil
    case 126: model.selected = max(model.selected - 1, 0); return nil
    default: break
    }
    if model.typed.isEmpty, let c = ev.charactersIgnoringModifiers, let n = Int(c),
       n >= 1, n <= spec.options.count {
        model.pick(n - 1)
    }
    return ev
}

let timeout = spec.timeout ?? 540
DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { emit(["cancelled": true, "reason": "timeout"]) }

app.run()
