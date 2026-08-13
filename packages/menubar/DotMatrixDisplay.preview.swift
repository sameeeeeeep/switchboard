// Standalone prototype for the DOT-MATRIX LED dictation strip (founder art-direction 2026-08-13) — NOT in build.sh.
// A single horizontal dot-matrix panel, like an old LED ticker, split into two regions on a true-black notch bg:
//   LEFT  — the phase word ("LISTENING" / "THINKING" / "SPEAKING") spelled in a 5×7 (or 5×5) dot font.
//           ON dots = the letters, lit lime (or near-white); OFF dots = dim grey lamps (white @ ~0.14).
//   RIGHT — a live voice waveform: each column's lit height = mic amplitude, mid-anchored (symmetric).
//           ON dots = LIME; OFF dots = dim/unlit lime lamps (~0.14) so the whole region reads as a lamp grid.
// The render is a PURE FUNCTION of (text, levels) — ready to drop into RelayMenuBar.swift reading MicLevelModel.levels.
// Build: swiftc packages/menubar/DotMatrixDisplay.preview.swift -o /tmp/dmd && /tmp/dmd   (do NOT pass -parse-as-library)
import AppKit
import SwiftUI

let OUT = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-zealous-davinci-5c96d7/95729692-3f75-4a54-90a8-0fd4cbb597b5/scratchpad"

@MainActor func snap<V: View>(_ name: String, _ view: V) {
    let r = ImageRenderer(content: view.fixedSize()); r.scale = 3
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    try? png.write(to: URL(fileURLWithPath: "\(OUT)/\(name).png")); print("wrote \(name).png")
}

extension Color {
    static let page = Color(red: 0, green: 0, blue: 0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    // near-white lit-text option (warm white so it sits in the lime family)
    static let nearWhite = Color(red: 0xF4/255.0, green: 0xFA/255.0, blue: 0xE8/255.0)
}

// The notch silhouette (ear 9, botR 9) — panel sits inside this on a black bg.
struct NotchDropShape: Shape {
    var ear: CGFloat = 9, botR: CGFloat = 9
    func path(in r: CGRect) -> Path {
        let w = r.width, h = r.height, e = min(ear, w/2), b = min(botR, (w - 2*e)/2)
        var p = Path()
        p.move(to: .init(x: 0, y: 0)); p.addLine(to: .init(x: w, y: 0))
        p.addQuadCurve(to: .init(x: w-e, y: e), control: .init(x: w-e, y: 0))
        p.addLine(to: .init(x: w-e, y: h-b))
        p.addQuadCurve(to: .init(x: w-e-b, y: h), control: .init(x: w-e, y: h))
        p.addLine(to: .init(x: e+b, y: h))
        p.addQuadCurve(to: .init(x: e, y: h-b), control: .init(x: e, y: h))
        p.addLine(to: .init(x: e, y: e))
        p.addQuadCurve(to: .init(x: 0, y: 0), control: .init(x: e, y: 0))
        p.closeSubpath(); return p
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - 5×7 uppercase dot font
// Each glyph = 7 rows of 5-bit masks. Bit 4 (0b10000) = leftmost column, bit 0 = rightmost.
// Full A–Z + space. Classic dot-matrix shapes; verified to spell LISTENING / THINKING / SPEAKING.
// ─────────────────────────────────────────────────────────────────────────────
let FONT7: [Character: [Int]] = [
    "A": [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
    "B": [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
    "C": [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
    "D": [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
    "E": [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
    "F": [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
    "G": [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
    "H": [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
    "I": [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
    "J": [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
    "K": [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
    "L": [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
    "M": [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
    "N": [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
    "O": [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
    "P": [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
    "Q": [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
    "R": [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
    "S": [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
    "T": [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
    "U": [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
    "V": [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
    "W": [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
    "X": [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
    "Y": [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
    "Z": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
    " ": [0, 0, 0, 0, 0, 0, 0],
]

// 5×5 compressed font — same 5-bit-mask convention, 5 rows tall. Fits closer to menu-bar height.
let FONT5: [Character: [Int]] = [
    "A": [0b01110, 0b10001, 0b11111, 0b10001, 0b10001],
    "B": [0b11110, 0b10001, 0b11110, 0b10001, 0b11110],
    "C": [0b01110, 0b10001, 0b10000, 0b10001, 0b01110],
    "D": [0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
    "E": [0b11111, 0b10000, 0b11110, 0b10000, 0b11111],
    "F": [0b11111, 0b10000, 0b11110, 0b10000, 0b10000],
    "G": [0b01110, 0b10000, 0b10011, 0b10001, 0b01110],
    "H": [0b10001, 0b10001, 0b11111, 0b10001, 0b10001],
    "I": [0b01110, 0b00100, 0b00100, 0b00100, 0b01110],
    "J": [0b00111, 0b00010, 0b00010, 0b10010, 0b01100],
    "K": [0b10010, 0b10100, 0b11000, 0b10100, 0b10010],
    "L": [0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
    "M": [0b10001, 0b11011, 0b10101, 0b10001, 0b10001],
    "N": [0b10001, 0b11001, 0b10101, 0b10011, 0b10001],
    "O": [0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
    "P": [0b11110, 0b10001, 0b11110, 0b10000, 0b10000],
    "Q": [0b01110, 0b10001, 0b10101, 0b10010, 0b01101],
    "R": [0b11110, 0b10001, 0b11110, 0b10100, 0b10010],
    "S": [0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
    "T": [0b11111, 0b00100, 0b00100, 0b00100, 0b00100],
    "U": [0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
    "V": [0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
    "W": [0b10001, 0b10001, 0b10101, 0b11011, 0b10001],
    "X": [0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
    "Y": [0b10001, 0b01010, 0b00100, 0b00100, 0b00100],
    "Z": [0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
    " ": [0, 0, 0, 0, 0],
]

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - DotMatrixDisplay
// Pure function of (text, levels). One continuous lamp grid: word on the left, waveform on the right.
// ─────────────────────────────────────────────────────────────────────────────
struct DotMatrixDisplay: View {
    var text: String
    var levels: [Double]           // 0…1 amplitudes, oldest→newest
    var rows: Int = 7              // 7 or 5
    var litText: Color = .lime     // lit LETTER dots (lime or nearWhite)
    var pitch: CGFloat = 4.0       // lamp-to-lamp spacing (px)
    var dot: CGFloat = 2.6         // lamp diameter (px) — "slightly denser" lamp feel
    var padX: CGFloat = 5.0        // horizontal inset
    var padY: CGFloat = 4.0        // vertical inset
    var regionGapCols: Int = 2     // blank lamp columns between word and waveform
    var charGapCols: Int = 1       // blank lamp columns between letters

    private let glyphW = 5

    private var font: [Character: [Int]] { rows >= 7 ? FONT7 : FONT5 }
    private var chars: [Character] { Array(text.uppercased()) }

    private var leftCols: Int {
        guard !chars.isEmpty else { return 0 }
        return chars.count * glyphW + (chars.count - 1) * charGapCols
    }
    private var rightCols: Int { max(1, levels.count) }
    private var totalCols: Int { leftCols + regionGapCols + rightCols }

    private var panelW: CGFloat { padX * 2 + CGFloat(totalCols - 1) * pitch + dot }
    private var panelH: CGFloat { padY * 2 + CGFloat(rows - 1) * pitch + dot }

    // lamp center for (col,row)
    private func center(_ col: Int, _ row: Int) -> CGPoint {
        CGPoint(x: padX + dot/2 + CGFloat(col) * pitch,
                y: padY + dot/2 + CGFloat(row) * pitch)
    }
    private func lamp(_ ctx: GraphicsContext, _ col: Int, _ row: Int, _ color: Color) {
        let c = center(col, row)
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - dot/2, y: c.y - dot/2, width: dot, height: dot)), with: .color(color))
    }

    private func draw(_ ctx: GraphicsContext, _ size: CGSize) {
        let textOff = Color.white.opacity(0.14)   // unlit letter-region lamps (dim grey)
        let waveOff = Color.lime.opacity(0.14)     // unlit waveform-region lamps (dim green)

        // ── LEFT: the word in dots ──
        // Fill the whole left region with dim lamps first (incl. inter-letter gaps) so it reads
        // as one continuous lamp field, then light the letter dots on top.
        for c in 0..<leftCols { for r in 0..<rows { lamp(ctx, c, r, textOff) } }
        var col = 0
        for (i, ch) in chars.enumerated() {
            let g = font[ch] ?? font[" "]!
            for gc in 0..<glyphW {
                for r in 0..<rows where (g[r] >> (glyphW - 1 - gc)) & 1 == 1 {
                    lamp(ctx, col + gc, r, litText)
                }
            }
            col += glyphW
            if i < chars.count - 1 { col += charGapCols }
        }

        // ── RIGHT: the waveform in dots, mid-anchored & symmetric ──
        let waveStart = leftCols + regionGapCols
        let centerRow = Double(rows - 1) / 2.0
        for (j, lvRaw) in levels.enumerated() {
            let lv = min(1.0, max(0.0, lvRaw))
            let reach = lv * centerRow                     // how far up/down from centre lights up
            for r in 0..<rows {
                let dist = abs(Double(r) - centerRow)
                let on = dist <= reach + 0.001             // centre row always lit (dist 0)
                lamp(ctx, waveStart + j, r, on ? Color.lime : waveOff)
            }
        }
    }

    var body: some View {
        Canvas { ctx, size in draw(ctx, size) }
            .frame(width: panelW, height: panelH)
    }
}

// Panel dropped into the notch silhouette on true black.
struct NotchStrip: View {
    var text: String
    var levels: [Double]
    var rows: Int = 7
    var litText: Color = .lime
    var pitch: CGFloat = 4.0
    var dot: CGFloat = 2.6
    var body: some View {
        let panel = DotMatrixDisplay(text: text, levels: levels, rows: rows, litText: litText, pitch: pitch, dot: dot)
        ZStack {
            panel.padding(.horizontal, 8)
        }
        .background(Color.page)
        .clipShape(NotchDropShape(ear: 9, botR: 9))
    }
}

// Labeled row so the founder can compare variants at a glance.
struct Compare: View {
    var label: String
    var view: AnyView
    var body: some View {
        HStack(spacing: 12) {
            Text(label).font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(.white.opacity(0.55)).frame(width: 150, alignment: .leading)
            view
        }.padding(.vertical, 3)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - main
// ─────────────────────────────────────────────────────────────────────────────
// Seeded, plausible speech envelopes.
func speechEnvelope(_ n: Int) -> [Double] {
    (0..<n).map { i in
        let t = Double(i)
        let syl = 0.5 + 0.5 * sin(t * 0.9)             // syllable rhythm
        let word = 0.65 + 0.35 * sin(t * 0.23 + 0.5)   // slower word envelope
        let v = 0.3 + 0.7 * max(0, syl) * max(0.35, word)   // livelier: keeps the wave off the floor
        return min(1.0, v)
    }
}
let speaking = speechEnvelope(24)
let quiet = (0..<24).map { i in 0.08 + 0.06 * abs(sin(Double(i) * 0.7)) }   // near-flat
let loud = (0..<24).map { i in 0.55 + 0.45 * abs(sin(Double(i) * 0.9 + 0.3)) }

@MainActor func run() {
    defer { exit(0) }
    // 7-row variants — the legible, taller panel
    snap("dmd_listening_7_lime",  NotchStrip(text: "LISTENING", levels: speaking, rows: 7, litText: .lime))
    snap("dmd_listening_7_white", NotchStrip(text: "LISTENING", levels: speaking, rows: 7, litText: .nearWhite))
    snap("dmd_listening_7_quiet", NotchStrip(text: "LISTENING", levels: quiet,    rows: 7, litText: .lime))
    snap("dmd_thinking_7_lime",   NotchStrip(text: "THINKING",  levels: loud,     rows: 7, litText: .lime))
    snap("dmd_speaking_7_lime",   NotchStrip(text: "SPEAKING",  levels: speaking, rows: 7, litText: .lime))

    // 5-row variants — fits closer to menu-bar height
    snap("dmd_listening_5_lime",  NotchStrip(text: "LISTENING", levels: speaking, rows: 5, litText: .lime))
    snap("dmd_listening_5_white", NotchStrip(text: "LISTENING", levels: speaking, rows: 5, litText: .nearWhite))
    snap("dmd_thinking_5_lime",   NotchStrip(text: "THINKING",  levels: loud,     rows: 5, litText: .lime))
    snap("dmd_speaking_5_lime",   NotchStrip(text: "SPEAKING",  levels: speaking, rows: 5, litText: .lime))

    // Side-by-side comparison sheet (row count × text colour), all on black.
    let sheet = VStack(alignment: .leading, spacing: 2) {
        Compare(label: "7-row · lime",  view: AnyView(NotchStrip(text: "LISTENING", levels: speaking, rows: 7, litText: .lime)))
        Compare(label: "7-row · white", view: AnyView(NotchStrip(text: "LISTENING", levels: speaking, rows: 7, litText: .nearWhite)))
        Compare(label: "5-row · lime",  view: AnyView(NotchStrip(text: "LISTENING", levels: speaking, rows: 5, litText: .lime)))
        Compare(label: "5-row · white", view: AnyView(NotchStrip(text: "LISTENING", levels: speaking, rows: 5, litText: .nearWhite)))
        Compare(label: "7 · THINKING",  view: AnyView(NotchStrip(text: "THINKING",  levels: loud,     rows: 7, litText: .lime)))
        Compare(label: "7 · SPEAKING",  view: AnyView(NotchStrip(text: "SPEAKING",  levels: speaking, rows: 7, litText: .lime)))
        Compare(label: "7 · quiet",     view: AnyView(NotchStrip(text: "LISTENING", levels: quiet,    rows: 7, litText: .lime)))
    }
    .padding(16).background(Color(white: 0.06))
    snap("dmd_sheet", sheet)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.main.async { run() }
app.run()
