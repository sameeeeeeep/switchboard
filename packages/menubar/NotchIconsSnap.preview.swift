// Prototype (founder ask 2026-08-13): the notch hover should NOT open the big panel — instead show small
// ICONS in the notch that trigger specific things (launcher · recent · God · drop). Small in w+h.
// A few options to react to. swiftc packages/menubar/NotchIconsSnap.preview.swift -o /tmp/ni && /tmp/ni
import AppKit
import SwiftUI
let OUT = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-zealous-davinci-5c96d7/95729692-3f75-4a54-90a8-0fd4cbb597b5/scratchpad"
@MainActor func snap<V: View>(_ n: String, _ v: V) {
    let r = ImageRenderer(content: v.fixedSize()); r.scale = 3
    guard let i = r.nsImage, let t = i.tiffRepresentation, let b = NSBitmapImageRep(data: t), let p = b.representation(using: .png, properties: [:]) else { print("FAIL"); return }
    try? p.write(to: URL(fileURLWithPath: "\(OUT)/\(n).png")); print("wrote \(n).png")
}
extension Color {
    static let page = Color.black
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
}
extension Font { static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) } }
struct NotchDropShape: Shape { var ear: CGFloat = 9, botR: CGFloat = 9
    func path(in r: CGRect) -> Path { let w=r.width,h=r.height,e=min(ear,w/2),b=min(botR,(w-2*e)/2); var p=Path()
        p.move(to:.init(x:0,y:0));p.addLine(to:.init(x:w,y:0));p.addQuadCurve(to:.init(x:w-e,y:e),control:.init(x:w-e,y:0))
        p.addLine(to:.init(x:w-e,y:h-b));p.addQuadCurve(to:.init(x:w-e-b,y:h),control:.init(x:w-e,y:h));p.addLine(to:.init(x:e+b,y:h))
        p.addQuadCurve(to:.init(x:e,y:h-b),control:.init(x:e,y:h));p.addLine(to:.init(x:e,y:e));p.addQuadCurve(to:.init(x:0,y:0),control:.init(x:e,y:0));p.closeSubpath();return p } }

// one small icon button in the notch
struct NotchIcon: View {
    var symbol: String; var accent: Bool = false; var d: CGFloat = 24
    var body: some View {
        Image(systemName: symbol).font(.system(size: d*0.46, weight: .semibold))
            .foregroundColor(accent ? .page : .ink)
            .frame(width: d, height: d)
            .background(RoundedRectangle(cornerRadius: d*0.28).fill(accent ? Color.lime : Color.raised))
            .overlay(RoundedRectangle(cornerRadius: d*0.28).stroke(accent ? Color.clear : Color.edge, lineWidth: 1))
    }
}
// the notch as a small icon strip (not the big panel)
struct IconNotch: View {
    var icons: [(String, Bool)]; var d: CGFloat = 24; var label: String? = nil
    var body: some View {
        HStack(spacing: 7) {
            if let l = label { Text(l).font(.splMono(9)).foregroundColor(.inkDim) }
            ForEach(Array(icons.enumerated()), id: \.offset) { _, ic in NotchIcon(symbol: ic.0, accent: ic.1, d: d) }
        }
        .padding(.horizontal, 12).padding(.vertical, 5)
        .background(Color.page).clipShape(NotchDropShape(ear: 9, botR: 9))
    }
}
struct Lbl: View { var t: String; var v: AnyView
    var body: some View { VStack(alignment:.leading,spacing:8){ Text(t).font(.splMono(11)).foregroundColor(.white.opacity(0.55)); v } } }

let app = NSApplication.shared; app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    snap("notch-icons", VStack(alignment: .leading, spacing: 22) {
        Lbl(t: "A · minimal — launcher + recent (2 icons, small)", v: AnyView(
            IconNotch(icons: [("square.grid.2x2.fill", false), ("clock.arrow.circlepath", false)])))
        Lbl(t: "B · launcher · recent · God (3 icons)", v: AnyView(
            IconNotch(icons: [("square.grid.2x2.fill", false), ("clock.arrow.circlepath", false), ("sparkles", true)])))
        Lbl(t: "C · + drop target (4 icons)", v: AnyView(
            IconNotch(icons: [("square.grid.2x2.fill", false), ("clock.arrow.circlepath", false), ("sparkles", true), ("tray.and.arrow.down.fill", false)])))
        Lbl(t: "D · with a tiny label + launcher · recent app · God", v: AnyView(
            IconNotch(icons: [("square.grid.2x2.fill", false), ("safari.fill", false), ("sparkles", true)], label: "⌥⌥")))
        Lbl(t: "E · bigger icons (d 28), launcher · recent · God · drop", v: AnyView(
            IconNotch(icons: [("square.grid.2x2.fill", false), ("clock.arrow.circlepath", false), ("sparkles", true), ("tray.and.arrow.down.fill", false)], d: 28)))
    }.padding(28).background(Color(white: 0.07)))
    exit(0)
}
app.run()
