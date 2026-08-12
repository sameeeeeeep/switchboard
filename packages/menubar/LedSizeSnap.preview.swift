// Quick size study for the notch LED sign — founder (2026-08-13): "should not occupy dots through the
// height and width, little smaller." Renders the LED inside a bar-height notch strip WITH margin, at a
// few sizes, so we pick the one that reads as a small sign floating in the notch (not edge-to-edge).
// swiftc packages/menubar/LedSizeSnap.preview.swift -o /tmp/led && /tmp/led
import AppKit
import SwiftUI
let OUT = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-zealous-davinci-5c96d7/95729692-3f75-4a54-90a8-0fd4cbb597b5/scratchpad"
@MainActor func snap<V: View>(_ n: String, _ v: V) {
    let r = ImageRenderer(content: v.fixedSize()); r.scale = 3
    guard let i = r.nsImage, let t = i.tiffRepresentation, let b = NSBitmapImageRep(data: t), let p = b.representation(using: .png, properties: [:]) else { print("FAIL"); return }
    try? p.write(to: URL(fileURLWithPath: "\(OUT)/\(n).png")); print("wrote \(n).png")
}
extension Color { static let page = Color.black; static let lime = Color(red: 0xC8/255, green: 0xF2/255, blue: 0x50/255) }
extension Font { static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) } }
struct NotchDropShape: Shape { var ear: CGFloat = 9, botR: CGFloat = 9
    func path(in r: CGRect) -> Path { let w=r.width,h=r.height,e=min(ear,w/2),b=min(botR,(w-2*e)/2); var p=Path()
        p.move(to:.init(x:0,y:0));p.addLine(to:.init(x:w,y:0));p.addQuadCurve(to:.init(x:w-e,y:e),control:.init(x:w-e,y:0))
        p.addLine(to:.init(x:w-e,y:h-b));p.addQuadCurve(to:.init(x:w-e-b,y:h),control:.init(x:w-e,y:h));p.addLine(to:.init(x:e+b,y:h))
        p.addQuadCurve(to:.init(x:e,y:h-b),control:.init(x:e,y:h));p.addLine(to:.init(x:e,y:e));p.addQuadCurve(to:.init(x:0,y:0),control:.init(x:e,y:0));p.closeSubpath();return p } }
let FONT7: [Character:[Int]] = ["A":[0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],"C":[0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110],"D":[0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],"E":[0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],"G":[0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01111],"I":[0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],"L":[0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],"N":[0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],"S":[0b01111,0b10000,0b10000,0b01110,0b00001,0b00001,0b11110],"T":[0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100]," ":[0,0,0,0,0,0,0]]
struct LED: View {
    var text: String; var levels: [Double]; var rows = 7; var pitch: CGFloat; var dot: CGFloat
    var padX: CGFloat = 3, padY: CGFloat = 2, gap = 2, cgap = 1; let gw = 5
    var chars: [Character] { Array(text.uppercased()) }
    var leftCols: Int { chars.isEmpty ? 0 : chars.count*gw + (chars.count-1)*cgap }
    var totalCols: Int { leftCols + gap + max(1, levels.count) }
    var w: CGFloat { padX*2 + CGFloat(totalCols-1)*pitch + dot }
    var h: CGFloat { padY*2 + CGFloat(rows-1)*pitch + dot }
    func lamp(_ c: GraphicsContext,_ col: Int,_ row: Int,_ col2: Color){ c.fill(Path(ellipseIn: CGRect(x: padX+CGFloat(col)*pitch, y: padY+CGFloat(row)*pitch, width: dot, height: dot)), with: .color(col2)) }
    func draw(_ ctx: GraphicsContext){ let tOff = Color.white.opacity(0.13), wOff = Color.lime.opacity(0.13)
        for c in 0..<leftCols { for r in 0..<rows { lamp(ctx,c,r,tOff) } }
        var col=0; for (i,ch) in chars.enumerated(){ let g=FONT7[ch] ?? FONT7[" "]!; for gc in 0..<gw { for r in 0..<rows where (g[r]>>(gw-1-gc))&1==1 { lamp(ctx,col+gc,r,.lime) } }; col+=gw; if i<chars.count-1 { col+=cgap } }
        let ws=leftCols+gap, mid=Double(rows-1)/2; for (j,lv) in levels.enumerated(){ let reach=min(1,max(0,lv))*mid; for r in 0..<rows { lamp(ctx,ws+j,r, abs(Double(r)-mid)<=reach+0.001 ? .lime : wOff) } } }
    var body: some View { Canvas { c,_ in draw(c) }.frame(width: w, height: h) }
}
// LED floated inside a notch strip with generous margin (so it doesn't run edge-to-edge)
let SPEECH: [Double] = (0..<16).map { (i: Int) -> Double in
    let a: Double = abs(sin(Double(i) * 0.6))
    let b: Double = 0.4 + 0.6 * abs(sin(Double(i) * 0.19))
    return 0.2 + 0.8 * a * b
}
struct Strip: View { var label: String; var pitch: CGFloat; var dot: CGFloat; var barH: CGFloat
    var lv: [Double] = SPEECH
    var body: some View {
        HStack { LED(text: label, levels: lv, pitch: pitch, dot: dot) }
            .padding(.horizontal, 16).frame(height: barH).padding(.horizontal, 12)
            .background(Color.page).clipShape(NotchDropShape(ear: 9, botR: 9))
    }
}
struct Lbl: View { var t: String; var v: AnyView
    var body: some View { VStack(alignment:.leading,spacing:6){ Text(t).font(.splMono(11)).foregroundColor(.white.opacity(0.5)); v } } }
let app = NSApplication.shared; app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    snap("led-size", VStack(alignment: .leading, spacing: 20) {
        Lbl(t: "A — current (pitch 4 / dot 2.6) · fills the strip", v: AnyView(Strip(label: "LISTENING", pitch: 4, dot: 2.6, barH: 40)))
        Lbl(t: "B — smaller (pitch 3.0 / dot 2.0) · bar ~30", v: AnyView(Strip(label: "LISTENING", pitch: 3.0, dot: 2.0, barH: 30)))
        Lbl(t: "C — smallest (pitch 2.6 / dot 1.7) · bar ~26 (menu-bar)", v: AnyView(Strip(label: "LISTENING", pitch: 2.6, dot: 1.7, barH: 26)))
        Lbl(t: "C · DICTATING", v: AnyView(Strip(label: "DICTATING", pitch: 2.6, dot: 1.7, barH: 26)))
    }.padding(28).background(Color(white: 0.07)))
    exit(0)
}
app.run()
