// Full-notch LED field — founder's corrected brief (2026-08-13): the WHOLE notch is one dot-matrix lamp
// field (green), and the phase word + waveform are just the lamps that light BRIGHT within it. Not a
// content-hugging canvas floating in black — one continuous lamp surface, edge to edge, that changes what
// it lights per state. swiftc packages/menubar/NotchFieldLED.preview.swift -o /tmp/nfl && /tmp/nfl
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
struct NotchDropShape: Shape { var ear: CGFloat = 9, botR: CGFloat = 10
    func path(in r: CGRect) -> Path { let w=r.width,h=r.height,e=min(ear,w/2),b=min(botR,(w-2*e)/2); var p=Path()
        p.move(to:.init(x:0,y:0));p.addLine(to:.init(x:w,y:0));p.addQuadCurve(to:.init(x:w-e,y:e),control:.init(x:w-e,y:0))
        p.addLine(to:.init(x:w-e,y:h-b));p.addQuadCurve(to:.init(x:w-e-b,y:h),control:.init(x:w-e,y:h));p.addLine(to:.init(x:e+b,y:h))
        p.addQuadCurve(to:.init(x:e,y:h-b),control:.init(x:e,y:h));p.addLine(to:.init(x:e,y:e));p.addQuadCurve(to:.init(x:0,y:0),control:.init(x:e,y:0));p.closeSubpath();return p } }
let FONT5: [Character:[Int]] = ["A":[0b01110,0b10001,0b11111,0b10001,0b10001],"C":[0b01110,0b10001,0b10000,0b10001,0b01110],"D":[0b11110,0b10001,0b10001,0b10001,0b11110],"E":[0b11111,0b10000,0b11110,0b10000,0b11111],"F":[0b11111,0b10000,0b11110,0b10000,0b10000],"G":[0b01110,0b10000,0b10011,0b10001,0b01110],"H":[0b10001,0b10001,0b11111,0b10001,0b10001],"I":[0b01110,0b00100,0b00100,0b00100,0b01110],"K":[0b10010,0b10100,0b11000,0b10100,0b10010],"L":[0b10000,0b10000,0b10000,0b10000,0b11111],"N":[0b10001,0b11001,0b10101,0b10011,0b10001],"P":[0b11110,0b10001,0b11110,0b10000,0b10000],"R":[0b11110,0b10001,0b11110,0b10100,0b10010],"S":[0b01111,0b10000,0b01110,0b00001,0b11110],"T":[0b11111,0b00100,0b00100,0b00100,0b00100]," ":[0,0,0,0,0]]

enum Mode { case wave, think }
// STATIC full-notch field (founder 2026-08-13 final: "smaller words, stay there, no ticker, wider notch ok").
// The drop sizes to fit the WHOLE word + waveform; dim-green lamps fill the whole band; word+wave bright;
// empty rows top & bottom. No scroll.
struct StaticFieldLED: View {
    var text: String; var mode: Mode = .wave; var levels: [Double]
    var pitch: CGFloat = 3.8; var dot: CGFloat = 3.0     // BIGGER dots
    var dimAmt: Double = 0.0                              // 0 = no greyed surround · >0 = subtle dim field
    var marginRows = 1; var sideCols = 1; var gapCols = 3; var waveCols = 12   // tight (little black)
    var pad: CGFloat = 5                                  // black around the grid — small
    let gw = 5, cgap = 1, glyphRows = 5
    var chars: [Character] { Array(text.uppercased()) }
    var wordCols: Int { chars.isEmpty ? 0 : chars.count*gw + (chars.count-1)*cgap }
    var cols: Int { sideCols + wordCols + gapCols + waveCols + sideCols }
    var rows: Int { glyphRows + 2*marginRows }
    var w: CGFloat { CGFloat(cols-1)*pitch + dot + 2*pad }
    var h: CGFloat { CGFloat(rows-1)*pitch + dot + 2*pad }
    func draw(_ ctx: GraphicsContext) {
        let ox = (w - CGFloat(cols-1)*pitch)/2, oy = (h - CGFloat(rows-1)*pitch)/2
        func lamp(_ c: Int,_ r: Int,_ col: Color){ ctx.fill(Path(ellipseIn: CGRect(x: ox+CGFloat(c)*pitch-dot/2, y: oy+CGFloat(r)*pitch-dot/2, width: dot, height: dot)), with: .color(col)) }
        if dimAmt > 0 { let dim = Color.lime.opacity(dimAmt); for c in 0..<cols { for r in 0..<rows { lamp(c, r, dim) } } }
        let top = marginRows
        var c0 = sideCols
        for (i, ch) in chars.enumerated() {
            let g = FONT5[ch] ?? FONT5[" "]!
            for gc in 0..<gw { for r in 0..<glyphRows where (g[r] >> (gw-1-gc)) & 1 == 1 { lamp(c0+gc, top+r, .lime) } }
            c0 += gw; if i < chars.count-1 { c0 += cgap }
        }
        let ws = sideCols + wordCols + gapCols, mid = Double(glyphRows-1)/2
        for j in 0..<waveCols {
            switch mode {
            case .wave:
                let lv = levels.isEmpty ? 0 : levels[min(levels.count-1, j % levels.count)]
                let reach = min(1.0,max(0.0,lv))*mid
                for r in 0..<glyphRows where abs(Double(r)-mid) <= reach+0.001 { lamp(ws+j, top+r, .lime) }
            case .think:
                for r in 0..<glyphRows { let s=0.5+0.5*sin((Double(j)+Double(r))*0.7 - 2.0); if s*s*s>0.5 { lamp(ws+j, top+r, .lime) } }
            }
        }
    }
    var body: some View { Canvas { c,_ in draw(c) }.frame(width: w, height: h).background(Color.page).clipShape(NotchDropShape(ear: 9, botR: 10)) }
}
// The full-notch lamp field as a TICKER (founder 2026-08-13): the whole notch is a green dot-matrix; the
// word + waveform form ONE content strip that SCROLLS leftward and wraps, like an LED ticker. Empty rows
// top & bottom (the lit band sits in the middle with margin). Chunky lamps. `scroll` = ticker offset (cols).
struct NotchFieldLED: View {
    var text: String
    var mode: Mode = .wave
    var w: CGFloat = 240, h: CGFloat = 34
    var pitch: CGFloat = 5.0, dot: CGFloat = 3.4      // chunky lamps
    var marginRows = 1                                 // empty rows top & bottom
    let gw = 5, cgap = 1, glyphRows = 5
    var levels: [Double]
    var scroll: Int = 0                                // ticker position (cols scrolled)
    private var cols: Int { max(1, Int(w / pitch)) }
    private var rows: Int { max(glyphRows + 2*marginRows, Int(h / pitch)) }
    private var chars: [Character] { Array(text.uppercased()) }
    private var wordCols: Int { chars.isEmpty ? 0 : chars.count*gw + (chars.count-1)*cgap }
    private var waveCols: Int { 12 }
    private var gapCols: Int { 4 }
    private var stripCols: Int { wordCols + gapCols + waveCols + gapCols }   // one repeat of the ticker
    // What's at absolute strip-column s (0..<stripCols): (kind, localCol). kind 0=blank 1=word 2=wave.
    private func at(_ s: Int) -> (Int, Int) {
        if s < wordCols { return (1, s) }
        if s < wordCols + gapCols { return (0, 0) }
        if s < wordCols + gapCols + waveCols { return (2, s - wordCols - gapCols) }
        return (0, 0)
    }
    private func draw(_ ctx: GraphicsContext, _ t: Double) {
        let ox = (w - CGFloat(cols-1)*pitch)/2, oy = (h - CGFloat(rows-1)*pitch)/2
        let dim = Color.lime.opacity(0.16)
        func lamp(_ c: Int,_ r: Int,_ col: Color){ ctx.fill(Path(ellipseIn: CGRect(x: ox+CGFloat(c)*pitch-dot/2, y: oy+CGFloat(r)*pitch-dot/2, width: dot, height: dot)), with: .color(col)) }
        let top = marginRows, bot = rows - marginRows            // lit band rows [top, bot)
        // dim field only in the middle band (empty rows top & bottom)
        for c in 0..<cols { for r in top..<bot { lamp(c, r, dim) } }
        let bandRows = bot - top, mid = Double(bandRows-1)/2
        for c in 0..<cols {
            let s = ((c + scroll) % stripCols + stripCols) % stripCols
            let (kind, lc) = at(s)
            if kind == 1 {                                        // word column
                let ci = lc / gw
                if ci < chars.count {
                    let gc = lc % gw; let g = FONT5[chars[ci]] ?? FONT5[" "]!
                    for r in 0..<glyphRows where (g[r] >> (gw-1-gc)) & 1 == 1 { lamp(c, top + r, .lime) }
                }
            } else if kind == 2 {                                 // wave / sweep column
                switch mode {
                case .wave:
                    let lv = levels.isEmpty ? 0 : levels[min(levels.count-1, abs(lc) % levels.count)]
                    let reach = min(1.0, max(0.0, lv)) * mid
                    for r in 0..<bandRows where abs(Double(r)-mid) <= reach+0.001 { lamp(c, top + r, .lime) }
                case .think:
                    for r in 0..<bandRows { let sv = 0.5+0.5*sin((Double(c)+Double(r))*0.7 - t*3.0); if sv*sv*sv > 0.55 { lamp(c, top + r, .lime) } }
                }
            }
        }
    }
    var body: some View {
        Canvas { ctx, _ in draw(ctx, 0.7) }.frame(width: w, height: h)
            .background(Color.page).clipShape(NotchDropShape(ear: 9, botR: 10))
    }
}
let SPEECH: [Double] = (0..<40).map { (i: Int) -> Double in
    let a = abs(sin(Double(i)*0.5)); let b = 0.4 + 0.6*abs(sin(Double(i)*0.16)); return 0.2 + 0.8*a*b }
struct Lbl: View { var t: String; var v: AnyView
    var body: some View { VStack(alignment:.leading,spacing:7){ Text(t).font(.splMono(11)).foregroundColor(.white.opacity(0.5)); v } } }
let app = NSApplication.shared; app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    snap("nfl", VStack(alignment: .leading, spacing: 18) {
        Lbl(t: "A · bigger dots · NO greyed surround · tight (little black)", v: AnyView(StaticFieldLED(text: "DICTATING", levels: SPEECH, dimAmt: 0)))
        Lbl(t: "B · bigger dots · SUBTLE dim field (0.10) · tight", v: AnyView(StaticFieldLED(text: "DICTATING", levels: SPEECH, dimAmt: 0.10)))
        Lbl(t: "A · LISTENING", v: AnyView(StaticFieldLED(text: "LISTENING", levels: SPEECH, dimAmt: 0)))
        Lbl(t: "A · THINKING (sweep)", v: AnyView(StaticFieldLED(text: "THINKING", mode: .think, levels: SPEECH, dimAmt: 0)))
        Lbl(t: "A · even bigger dots (pitch 4.4 / dot 3.6)", v: AnyView(StaticFieldLED(text: "DICTATING", levels: SPEECH, pitch: 4.4, dot: 3.6, dimAmt: 0)))
    }.padding(28).background(Color(white: 0.07)))
    exit(0)
}
app.run()
