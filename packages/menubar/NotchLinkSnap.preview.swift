// Standalone SNAPSHOT twin for the two founder-approved notch surfaces — NOT in build.sh (own @main).
// The "see the frontend without the human" harness (same pattern as NotchCardSnap / SnapshotSuite):
//   A) the REAL notch — the notch SHAPE ITSELF, full-bleed dot-matrix, health-tinted (wireframe A).
//   B) the pair-light CONNECT-GRANT card — the LINK hero + compact scope (wireframe B).
// The views below are faithful ports of the structs in RelayMenuBar.swift (intentionally duplicated —
// re-sync when the real ones change). Reduce-motion is forced so frames are deterministic. Run:
//   cd packages/menubar
//   swiftc -parse-as-library NotchLinkSnap.preview.swift -o /tmp/notchlinksnap && /tmp/notchlinksnap
import AppKit
import SwiftUI

extension Color {
    static let page     = Color(red: 0, green: 0, blue: 0)
    static let raised   = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge     = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink      = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim   = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime     = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let danger   = Color(red: 1.0, green: 0.42, blue: 0.37)
}
extension Font {
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}

// ── notch silhouette (verbatim from RelayMenuBar.swift) ──
struct NotchDropShape: Shape {
    var ear: CGFloat = 14
    var botR: CGFloat = 20
    func path(in r: CGRect) -> Path {
        let w = r.width, h = r.height
        let e = min(ear, w / 2), b = min(botR, (w - 2 * e) / 2)
        var p = Path()
        p.move(to: CGPoint(x: 0, y: 0))
        p.addLine(to: CGPoint(x: w, y: 0))
        p.addQuadCurve(to: CGPoint(x: w - e, y: e), control: CGPoint(x: w - e, y: 0))
        p.addLine(to: CGPoint(x: w - e, y: h - b))
        p.addQuadCurve(to: CGPoint(x: w - e - b, y: h), control: CGPoint(x: w - e, y: h))
        p.addLine(to: CGPoint(x: e + b, y: h))
        p.addQuadCurve(to: CGPoint(x: e, y: h - b), control: CGPoint(x: e, y: h))
        p.addLine(to: CGPoint(x: e, y: e))
        p.addQuadCurve(to: CGPoint(x: 0, y: 0), control: CGPoint(x: e, y: 0))
        p.closeSubpath()
        return p
    }
}

// ── NotchField (verbatim) — full-bleed dot-matrix, still frame for the snapshot ──
struct NotchField: View {
    var accent: Color
    var working: Bool
    private func bright(_ c: Int, _ r: Int, _ t: Double) -> Double {
        let cx = Double(c), rx = Double(r)
        if working { return 0.16 + 0.84 * (0.5 + 0.5 * sin(cx * 0.55 - t * 2.6)) }
        let s = 0.5 + 0.5 * sin((cx + rx) * 0.6 - t * 2.1)
        return 0.13 + 0.87 * (s * s * s)
    }
    private func draw(_ ctx: GraphicsContext, _ size: CGSize, _ t: Double) {
        let gap: CGFloat = 4.0, d: CGFloat = 1.8
        let cols = max(1, Int(size.width / gap)), rows = max(1, Int(size.height / gap))
        let ox = (size.width - CGFloat(cols - 1) * gap) / 2, oy = (size.height - CGFloat(rows - 1) * gap) / 2
        for c in 0..<cols {
            for r in 0..<rows {
                let x = ox + CGFloat(c) * gap - d / 2, y = oy + CGFloat(r) * gap - d / 2
                ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: d, height: d)), with: .color(accent.opacity(bright(c, r, t))))
            }
        }
    }
    var body: some View { Canvas { ctx, size in draw(ctx, size, working ? 0.9 : 0.6) } }
}

// The idle notch composition (verbatim from OrbView.body).
struct IdleNotch: View {
    var tint: Color
    var working: Bool = false
    var running: Bool = true
    var body: some View {
        let shape = NotchDropShape(ear: 8, botR: 9)
        ZStack {
            shape.fill(Color.page)
            NotchField(accent: tint, working: working)
                .padding(.horizontal, 5).padding(.top, 1).padding(.bottom, 3)
                .clipShape(shape)
            shape.stroke(tint.opacity(running ? 0.20 : 0.10), lineWidth: 0.75)
        }
        .frame(width: 168, height: 30)
        .shadow(color: (running && !working) ? Color.lime.opacity(0.18) : .clear, radius: 4, y: 1)
    }
}

// ── Sunburst + PairLink (verbatim; reduce-motion static "linked" state) ──
struct Sunburst: Shape {
    var spokes: Int = 8
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let r = min(rect.width, rect.height) / 2
        let inner = r * 0.16
        for i in 0..<spokes {
            let a = Double(i) / Double(spokes) * 2 * .pi
            let ca = CGFloat(cos(a)), sa = CGFloat(sin(a))
            p.move(to: CGPoint(x: c.x + ca * inner, y: c.y + sa * inner))
            p.addLine(to: CGPoint(x: c.x + ca * r, y: c.y + sa * r))
        }
        return p
    }
}

struct PairLink: View {
    let appInitial: String
    private func endpoint(app: Bool, glow: Double) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(app ? Color.lime : Color.raised)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(app ? Color.clear : Color.edge, lineWidth: 1))
                .frame(width: 36, height: 36)
                .shadow(color: Color.lime.opacity(glow * 0.7), radius: 9 * glow)
            if app { Text(appInitial).font(.hanken(15, .bold)).foregroundColor(.page) }
            else { Sunburst(spokes: 8).stroke(Color.lime, style: StrokeStyle(lineWidth: 1.7, lineCap: .round)).frame(width: 19, height: 19) }
        }
    }
    private func dots(_ ctx: GraphicsContext, _ size: CGSize) {
        let n = 9; let baseR: CGFloat = 2.1
        for i in 0..<n {
            let p = Double(i) / Double(n - 1)
            let x = baseR + (size.width - 2 * baseR) * CGFloat(p)
            let y = size.height / 2
            ctx.fill(Path(ellipseIn: CGRect(x: x - baseR, y: y - baseR, width: baseR * 2, height: baseR * 2)), with: .color(Color.lime.opacity(0.5)))
        }
    }
    var body: some View {   // the reduce-motion static "linked" state (all dots lit, both ends steady)
        HStack(spacing: 10) {
            endpoint(app: true, glow: 0.55)
            Canvas { ctx, size in dots(ctx, size) }.frame(height: 16)
            endpoint(app: false, glow: 0.55)
        }
    }
}

// ── ConnectGrantDrop (verbatim, static selection) ──
struct GrantCard: View {
    let origin = "localhost:8891"
    let reason = "Redline — review this page on your own Claude"
    let models = ["sonnet", "opus", "haiku"]
    let selModels: Set<String> = ["sonnet"]
    let tools: [(name: String, access: String, label: String)] = [
        ("higgsfield", "write", "Higgsfield"), ("web", "read", "Web"), ("vault", "read", "Vault"),
    ]
    private var appInitial: String { "R" }
    private var writeCount: Int { tools.filter { $0.access == "write" }.count }
    private func chunked(_ a: [String], _ n: Int) -> [[String]] { stride(from: 0, to: a.count, by: n).map { Array(a[$0..<min($0 + n, a.count)]) } }
    private func pill(_ m: String, _ on: Bool) -> some View {
        Text(m).font(.hanken(12, on ? .semibold : .regular)).foregroundColor(on ? .page : .inkDim).lineLimit(1)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 8).fill(on ? Color.lime : Color.raised.opacity(0.55)))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? Color.clear : Color.edge, lineWidth: 1))
    }
    private func toolChip(_ t: (name: String, access: String, label: String), _ on: Bool) -> some View {
        let write = t.access == "write"
        return HStack(spacing: 6) {
            Circle().fill(on ? (write ? Color.danger : Color.lime) : Color.inkFaint).frame(width: 6, height: 6)
            Text(t.label).font(.hanken(11.5, on ? .medium : .regular)).foregroundColor(on ? .ink : .inkDim).lineLimit(1)
            if write { Text("write").font(.splMono(8)).foregroundColor(on ? Color.danger : .inkFaint) }
        }
        .padding(.horizontal, 9).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(on ? Color.lime.opacity(0.10) : Color.raised.opacity(0.5)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? Color.lime.opacity(0.45) : Color.edge, lineWidth: 1))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            PairLink(appInitial: appInitial).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 3) {
                (Text("Connect to ").foregroundColor(.ink) + Text(origin).foregroundColor(.lime) + Text("?").foregroundColor(.ink)).font(.hanken(14.5, .semibold))
                Text("\u{201C}\(reason)\u{201D}").font(.hanken(10.5)).italic().foregroundColor(.inkFaint).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            Rectangle().fill(Color.edge).frame(height: 1)
            VStack(alignment: .leading, spacing: 11) {
                VStack(alignment: .leading, spacing: 7) {
                    Text("MODELS").font(.splMono(9)).foregroundColor(.inkFaint).tracking(1.4)
                    ForEach(chunked(models, 3), id: \.self) { row in
                        HStack(spacing: 7) { ForEach(row, id: \.self) { m in pill(m, selModels.contains(m)) }; Spacer(minLength: 0) }
                    }
                }
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("TOOLS").font(.splMono(9)).foregroundColor(.inkFaint).tracking(1.4)
                        Spacer(minLength: 0)
                        Text("\(tools.count) requested \u{00B7} \(writeCount) write").font(.splMono(9)).foregroundColor(.inkFaint)
                    }
                    ForEach(chunked(tools.map { $0.name }, 2), id: \.self) { row in
                        HStack(spacing: 7) { ForEach(row, id: \.self) { name in if let t = tools.first(where: { $0.name == name }) { toolChip(t, true) } }; Spacer(minLength: 0) }
                    }
                }
            }
            HStack(spacing: 8) {
                Text("Deny").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                Spacer(minLength: 0)
                Text("Approve \u{00B7} 3 tools").font(.hanken(11.5, .semibold)).foregroundColor(.page)
                    .padding(.horizontal, 16).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
            }.padding(.top, 1)
        }
        .padding(16)
        .frame(width: 344, alignment: .leading)
        .padding(.horizontal, 14)
        .background(Color.page)
        .clipShape(NotchDropShape())
    }
}

// ── render helper ──
@MainActor func writePNG<V: View>(_ name: String, _ view: V) {
    let r = ImageRenderer(content: view)
    r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL render \(name)"); return }
    let path = "/tmp/snap-\(name).png"
    try? png.write(to: URL(fileURLWithPath: path))
    print("wrote \(path)")
}

@main
struct NotchLinkSnap {
    @MainActor static func main() {
        // A) the real notch, three health states + working, on a faux-desktop strip so the shape reads.
        let notchStrip = VStack(spacing: 20) {
            ForEach(Array([("idle · connected", Color.lime, false, true),
                           ("working · model running", Color.lime, true, true),
                           ("signed out", Color.danger, false, true),
                           ("daemon down", Color.inkFaint, false, false)].enumerated()), id: \.offset) { _, s in
                VStack(spacing: 6) {
                    ZStack(alignment: .top) {
                        LinearGradient(colors: [Color(red: 0.90, green: 0.79, blue: 0.63), Color(red: 0.49, green: 0.54, blue: 0.69)], startPoint: .topLeading, endPoint: .bottomTrailing)
                            .frame(width: 320, height: 54).clipShape(RoundedRectangle(cornerRadius: 10))
                        IdleNotch(tint: s.1, working: s.2, running: s.3)
                    }
                    Text(s.0).font(.splMono(9)).foregroundColor(.inkDim)
                }
            }
        }.padding(24).background(Color(red: 0.03, green: 0.03, blue: 0.04))
        writePNG("notch", notchStrip)

        // B) the pair-light grant card on the dark desktop.
        let card = GrantCard().padding(40).background(Color(red: 0.03, green: 0.03, blue: 0.04))
        writePNG("grant", card)
    }
}
