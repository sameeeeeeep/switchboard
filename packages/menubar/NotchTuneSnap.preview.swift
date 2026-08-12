// Standalone snapshots for the NOTCH TUNE pass (founder art-direction 2026-08-13) — NOT in build.sh.
//   1. density: base NotchField (dense, pitch 4 / dot 1.8) vs. tuned (pitch 6 / dot 3, the dictation lamp feel)
//   2. menu-bar-height ⌃⌃ strip — step 1 (listening) stays bar-height; step 2 (project) WIDENS, same height
//   3. the dot-matrix reshaped as a live VOICE WAVEFORM (mic amplitude → lamp column heights)
// Build: swiftc packages/menubar/NotchTuneSnap.preview.swift -o /tmp/nts && /tmp/nts
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
    static let panel = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
}
extension Font {
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
struct NotchDropShape: Shape {
    var ear: CGFloat = 9, botR: CGFloat = 10
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

// NotchField with tunable density — proves dense (current) vs. lamp (tuned).
struct NotchField: View {
    var accent: Color; var working: Bool; var gap: CGFloat; var d: CGFloat
    private func bright(_ c: Int, _ r: Int, _ t: Double) -> Double {
        let cx = Double(c), rx = Double(r)
        if working { return 0.16 + 0.84 * (0.5 + 0.5 * sin(cx * 0.55 - t * 2.6)) }
        let s = 0.5 + 0.5 * sin((cx + rx) * 0.6 - t * 2.1)
        return 0.13 + 0.87 * (s * s * s)
    }
    private func draw(_ ctx: GraphicsContext, _ size: CGSize, _ t: Double) {
        let cols = max(1, Int(size.width / gap)), rows = max(1, Int(size.height / gap))
        let ox = (size.width - CGFloat(cols - 1) * gap) / 2, oy = (size.height - CGFloat(rows - 1) * gap) / 2
        for c in 0..<cols { for r in 0..<rows {
            let x = ox + CGFloat(c) * gap - d/2, y = oy + CGFloat(r) * gap - d/2
            ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: d, height: d)), with: .color(accent.opacity(bright(c, r, t))))
        } }
    }
    var body: some View { Canvas { ctx, size in draw(ctx, size, 0.6) } }
}
// The base idle notch at menu-bar height (26pt), tunable density.
struct IdleNotch: View {
    var gap: CGFloat; var d: CGFloat; var w: CGFloat = 184; var h: CGFloat = 26
    var body: some View {
        let shape = NotchDropShape(ear: 9, botR: 8)
        ZStack {
            shape.fill(Color.page)
            NotchField(accent: .lime, working: false, gap: gap, d: d)
                .padding(.horizontal, 6).padding(.top, 1).padding(.bottom, 3).clipShape(shape)
            shape.stroke(Color.lime.opacity(0.10), lineWidth: 0.75)
        }.frame(width: w, height: h)
    }
}

// VOICE WAVEFORM — the dot-matrix reshaped: each column = a time slice; its lit height = mic amplitude
// at that moment. Newest sample at the right; a lamp VU that literally traces the user's voice.
struct VoiceWaveField: View {
    var levels: [Double]        // 0…1 amplitude, oldest→newest
    var accent: Color = .lime
    var gap: CGFloat = 6; var d: CGFloat = 3
    private func draw(_ ctx: GraphicsContext, _ size: CGSize) {
        let cols = max(1, Int(size.width / gap)), rows = max(1, Int(size.height / gap))
        let mid = Double(rows - 1) / 2
        let ox = (size.width - CGFloat(cols - 1) * gap) / 2, oy = (size.height - CGFloat(rows - 1) * gap) / 2
        for c in 0..<cols {
            // map column → a sample in the level buffer (right = newest)
            let li = Double(c) / Double(max(1, cols - 1)) * Double(max(0, levels.count - 1))
            let amp = levels.isEmpty ? 0 : levels[min(levels.count - 1, Int(li.rounded()))]
            let half = amp * mid                              // how many rows above/below the mid to light
            for r in 0..<rows {
                let dist = abs(Double(r) - mid)
                let on = dist <= half + 0.001
                let a = on ? (0.35 + 0.65 * (1 - dist / max(0.5, mid))) : 0.09
                let x = ox + CGFloat(c) * gap - d/2, y = oy + CGFloat(r) * gap - d/2
                ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: d, height: d)), with: .color(accent.opacity(a)))
            }
        }
    }
    var body: some View { Canvas { ctx, size in draw(ctx, size) } }
}

// The menu-bar-height ⌃⌃ / dictation STRIP. Step 1 = label + waveform. Step 2 = + inline project chip
// (WIDENS, same height). Refs/clipboard would stack below only when actually present (a God request).
struct StripInline: View {
    var label: String; var levels: [Double]; var project: String? = nil
    var body: some View {
        HStack(spacing: 12) {
            Text(label).font(.hanken(12.5, .semibold)).foregroundColor(.ink).fixedSize()
            VoiceWaveField(levels: levels).frame(width: 66, height: 18)
            if let p = project {
                HStack(spacing: 5) {
                    Image(systemName: "folder").font(.system(size: 9, weight: .semibold))
                    Text(p).font(.hanken(11, .medium)).fixedSize()
                    Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold))
                }.foregroundColor(.lime)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.lime.opacity(0.45), lineWidth: 1))
            }
        }
        .padding(.horizontal, 18).frame(height: 26).padding(.horizontal, 14)
        .background(Color.page).clipShape(NotchDropShape(ear: 9, botR: 9))
    }
}

// a plausible speech envelope for the still snapshot
let speech: [Double] = (0..<24).map { i in
    let t = Double(i)
    let env = 0.25 + 0.75 * abs(sin(t * 0.5)) * (0.4 + 0.6 * abs(sin(t * 0.17)))
    return min(1, env)
}

struct Row: View { var title: String; var content: AnyView
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.splMono(11)).foregroundColor(.inkFaint)
            content
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    // density comparison
    snap("nt-density", VStack(alignment: .leading, spacing: 22) {
        Row(title: "CURRENT — base notch (pitch 4 · dot 1.8) — denser", content: AnyView(IdleNotch(gap: 4, d: 1.8)))
        Row(title: "TUNED — matches the dictation lamps (pitch 6 · dot 3)", content: AnyView(IdleNotch(gap: 6, d: 3)))
        Row(title: "TUNED · a touch bolder (pitch 7 · dot 3.2)", content: AnyView(IdleNotch(gap: 7, d: 3.2)))
    }.padding(28).background(Color(white: 0.06)))

    // menu-bar-height strip: step 1 vs step 2 (widens)
    snap("nt-strip", VStack(alignment: .leading, spacing: 22) {
        Row(title: "STEP 1 — ⌃⌃ / dictation · menu-bar height", content: AnyView(StripInline(label: "listening…", levels: speech)))
        Row(title: "STEP 2 — project selection · WIDENS, same height", content: AnyView(StripInline(label: "thinking…", levels: speech, project: "Switchboard")))
    }.padding(28).background(Color(white: 0.06)))

    // the waveform on its own, a few amplitudes
    snap("nt-wave", VStack(alignment: .leading, spacing: 18) {
        Row(title: "quiet", content: AnyView(VoiceWaveField(levels: (0..<24).map { _ in 0.15 }).frame(width: 150, height: 26).background(Color.page)))
        Row(title: "speaking", content: AnyView(VoiceWaveField(levels: speech).frame(width: 150, height: 26).background(Color.page)))
        Row(title: "loud", content: AnyView(VoiceWaveField(levels: (0..<24).map { i in 0.6 + 0.4 * abs(sin(Double(i) * 0.9)) }).frame(width: 150, height: 26).background(Color.page)))
    }.padding(28).background(Color(white: 0.06)))
    exit(0)
}
app.run()
