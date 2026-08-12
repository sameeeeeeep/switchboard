// Standalone SNAPSHOT twin for the Explain-mode decision card — NOT in build.sh (own @main). Renders the
// three states so the frontend is reviewable without a live daemon/model/voice: (1) a decision card with
// the "Explain" chip, (2) explaining…, (3) explained — the trade-off diagram in the media zone + options.
// Faithful port of CursorGuide.swift optionsRow/optionCard + the new Explain chip (illustrative diagram).
//   cd packages/menubar
//   swiftc -parse-as-library NotchExplainSnap.preview.swift -o /tmp/notchexplainsnap && /tmp/notchexplainsnap
import AppKit
import SwiftUI

extension Color {
    static let page     = Color(red: 0, green: 0, blue: 0)
    static let panel    = Color(red: 0x14/255.0, green: 0x16/255.0, blue: 0x1B/255.0)
    static let edge     = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink      = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkSec   = Color(red: 0xB4/255.0, green: 0xBE/255.0, blue: 0xCE/255.0)
    static let inkDim   = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime     = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let indigo   = Color(red: 0x5B/255.0, green: 0x8D/255.0, blue: 0xEF/255.0)
}
extension Font {
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
enum SBr { static let xs: CGFloat = 7 }

struct Opt { let label: String; let detail: String; var recommended = false }

// The Explain chip — verbatim look from optionsRow.
struct ExplainChip: View {
    var explaining: Bool
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: explaining ? "waveform" : "sparkles").font(.system(size: 8, weight: .bold))
            Text(explaining ? "explaining…" : "Explain").font(.splMono(9)).tracking(0.4)
        }.foregroundColor(explaining ? .inkFaint : .lime)
         .padding(.horizontal, 7).padding(.vertical, 3)
         .background(Capsule().fill(Color.lime.opacity(0.08)))
         .overlay(Capsule().stroke(Color.lime.opacity(explaining ? 0.2 : 0.4), lineWidth: 1))
    }
}

// An illustrative trade-off diagram (stands in for HtmlCapability.makeDiagram's live PNG in the media zone).
struct TradeoffDiagram: View {
    var body: some View {
        ZStack {
            Rectangle().fill(Color.black)
            GeometryReader { g in
                let w = g.size.width, h = g.size.height
                Path { p in p.move(to: CGPoint(x: 34, y: 12)); p.addLine(to: CGPoint(x: 34, y: h - 22)); p.addLine(to: CGPoint(x: w - 16, y: h - 22)) }
                    .stroke(Color.inkFaint, lineWidth: 1)
                Text("effort").font(.splMono(8)).foregroundColor(.inkFaint).rotationEffect(.degrees(-90)).position(x: 14, y: h/2)
                Text("reward →").font(.splMono(8)).foregroundColor(.inkFaint).position(x: w/2, y: h - 9)
                Group {
                    dot("A", .init(x: 0.30, y: 0.30), w, h, rec: false)
                    dot("B", .init(x: 0.55, y: 0.55), w, h, rec: false)
                    dot("C", .init(x: 0.80, y: 0.40), w, h, rec: true)
                }
            }
        }
        .frame(height: 132)
        .clipShape(RoundedRectangle(cornerRadius: SBr.xs))
        .overlay(RoundedRectangle(cornerRadius: SBr.xs).stroke(Color.edge, lineWidth: 1))
    }
    func dot(_ l: String, _ f: CGPoint, _ w: CGFloat, _ h: CGFloat, rec: Bool) -> some View {
        let x = 34 + (w - 50) * f.x, y = 12 + (h - 34) * f.y
        return ZStack {
            Circle().fill(rec ? Color.lime : Color.indigo).frame(width: rec ? 13 : 10, height: rec ? 13 : 10)
            if rec { Text("★").font(.system(size: 8)).foregroundColor(.page) }
        }.overlay(Text(l).font(.splMono(8)).foregroundColor(.inkSec).offset(y: -13)).position(x: x, y: y)
    }
}

struct OptCard: View {
    let i: Int; let opt: Opt
    var body: some View {
        let letter = ["A", "B", "C"][i]
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(letter).font(.splMono(10.5)).foregroundColor(.inkFaint)
                Text(opt.label).font(.hanken(13.5, .semibold)).foregroundColor(.inkSec)
                    .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
            }
            Text(opt.detail).font(.hanken(11.5)).foregroundColor(.inkDim)
                .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(7).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.xs).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: SBr.xs).stroke(opt.recommended ? Color.lime.opacity(0.4) : Color.edge, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            if opt.recommended { Text("★").font(.system(size: 9)).foregroundColor(.lime).padding(3).background(Circle().fill(Color.page.opacity(0.85))).padding(4) }
        }
    }
}

struct DecisionCard: View {
    let title: String
    let opts: [Opt]
    var state: Int   // 0 = idle chip · 1 = explaining · 2 = explained (diagram shown)
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.hanken(14.5, .semibold)).foregroundColor(.ink)
            if state == 2 { TradeoffDiagram() }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    Text("PICK ONE — UPDATES LIVE").font(.splMono(9.5)).tracking(0.6).foregroundColor(.indigo)
                    Text("★ recommended").font(.splMono(9)).foregroundColor(.lime.opacity(0.9))
                    Spacer(minLength: 6)
                    if state != 2 { ExplainChip(explaining: state == 1) }
                }
                HStack(alignment: .top, spacing: 7) { ForEach(Array(opts.enumerated()), id: \.offset) { OptCard(i: $0, opt: $1) } }
            }
        }
        .padding(16).frame(width: 460, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.page))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
    }
}

@MainActor func writePNG<V: View>(_ name: String, _ view: V) {
    let r = ImageRenderer(content: view); r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    try? png.write(to: URL(fileURLWithPath: "/tmp/snap-\(name).png")); print("wrote /tmp/snap-\(name).png")
}

@main struct NotchExplainSnap {
    @MainActor static func main() {
        let opts = [
            Opt(label: "Session cookies", detail: "Fastest to ship; ties you to one server."),
            Opt(label: "JWT tokens", detail: "Stateless, scales — but revocation is fiddly."),
            Opt(label: "Managed auth (Clerk)", detail: "A day now; reversible, less to own.", recommended: true),
        ]
        let panel = VStack(spacing: 22) {
            ForEach(Array([("① decision card — the Explain chip", 0),
                           ("② explaining… (generating diagram + Moira script)", 1),
                           ("③ explained — trade-off diagram + options resurface", 2)].enumerated()), id: \.offset) { _, s in
                VStack(spacing: 7) {
                    Text(s.0).font(.splMono(9)).foregroundColor(.inkDim).frame(maxWidth: .infinity, alignment: .leading)
                    DecisionCard(title: "Which auth approach for the new app?", opts: opts, state: s.1)
                }
            }
        }.padding(28).frame(width: 528).background(Color(red: 0.03, green: 0.03, blue: 0.04))
        writePNG("explain", panel)
    }
}
