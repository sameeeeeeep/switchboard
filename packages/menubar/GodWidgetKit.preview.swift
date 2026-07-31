// NOTE: standalone ImageRenderer PREVIEW / basis for the in-app port — NOT in build.sh (has its own main). The components below (tokens T, WidgetHeader, ActionRow, result renderers, NotchWidget) port into RelayMenuBar.swift as the notch widget kit.
import AppKit
import SwiftUI

// ============================================================================
// THE NOTCH WIDGET KIT — one frame, many wrapps, phone-widget grammar.
// The notch is the OS-provided frame; each wrapp ships a glanceable widget
// (a slice of itself + tap-to-open-full). Result-type renderers ARE the widget
// size classes: text = small, image = medium, gallery/cards = large.
// Synthesized from variant-b (structure) + variant-a (polish), generalized to
// render ANY wrapp's tool output, not just Prism images.
// ============================================================================

@MainActor func snap<V: View>(_ name: String, _ view: V) {
    let r = ImageRenderer(content: view.frame(width: 600).fixedSize(horizontal: false, vertical: true))
    r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    let path = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-settings-layout-overflow-2ee5dc/57a992f5-298f-4ee6-a2e0-04e931b231db/scratchpad/\(name).png"
    try? png.write(to: URL(fileURLWithPath: path)); print("wrote \(path)")
}

// ---- house palette (verbatim from RelayMenuBar.swift ~L171) ----
extension Color {
    static let page = Color(red: 0, green: 0, blue: 0)
    static let rail = Color(red: 0x0A/255.0, green: 0x0A/255.0, blue: 0x0B/255.0)
    static let panel = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let danger = Color(red: 0xFF/255.0, green: 0x2D/255.0, blue: 0x6E/255.0)
    static let ok = Color(red: 0x3D/255.0, green: 0xD6/255.0, blue: 0x8C/255.0)
}
extension Font {
    static func brico(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .system(size: s, weight: w) }
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
extension View { func kicker() -> some View { self.font(.splMono(9.5)).kerning(1.4).foregroundColor(.inkFaint) } }

// ---- design tokens: one 4pt scale, one radius scale (unifies the ad-hoc set) ----
enum T {
    static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20, s6: CGFloat = 24
    static let rSm: CGFloat = 7, rMd: CGFloat = 12, rLg: CGFloat = 16
    static let width: CGFloat = 600, ear: CGFloat = 14, padH: CGFloat = 22, hair: CGFloat = 1
}

// ---- notch silhouette (verbatim from RelayMenuBar.swift ~L1665) ----
struct NotchDropShape: Shape {
    var ear: CGFloat = 14, botR: CGFloat = 20
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

// ============================================================================
// SHARED CHROME — every widget wears these, so 33 widgets read as one system.
// ============================================================================

// Header: status dot + kicker (wrapp · capability) + title, and a close chip.
struct WidgetHeader: View {
    let kicker: String, title: String; var accent: Color = .ok
    var body: some View {
        HStack(alignment: .center, spacing: T.s3) {
            Circle().fill(accent).frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(kicker).kicker()
                Text(title).font(.brico(14, .semibold)).foregroundColor(.ink).lineLimit(1)
            }
            Spacer(minLength: T.s3)
            IconChip(icon: "xmark")
        }
    }
}
struct IconChip: View {
    let icon: String; var tint: Color = .inkDim
    var body: some View {
        Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundColor(tint)
            .frame(width: 26, height: 26)
            .background(RoundedRectangle(cornerRadius: T.rSm).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: T.rSm).stroke(Color.edge, lineWidth: T.hair))
    }
}
struct Hairline: View { var body: some View { Rectangle().fill(Color.edge).frame(height: T.hair) } }

struct CaptionLine: View {
    let text: String; var icon: String = "text.alignleft"
    var body: some View {
        HStack(spacing: T.s2) {
            Image(systemName: icon).font(.system(size: 9, weight: .semibold)).foregroundColor(.inkFaint)
            Text(text).font(.hanken(11.5)).foregroundColor(.inkDim).lineLimit(1)
            Spacer(minLength: 0)
        }
    }
}

// The one primary/ghost button (unifies the 6 ad-hoc lime buttons + ghost).
struct ActionButton: View {
    let icon: String, label: String; var primary: Bool = false
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold))
            Text(label).font(.hanken(11, .semibold)).lineLimit(1).fixedSize()
        }
        .foregroundColor(primary ? .page : .inkDim)
        .padding(.horizontal, 11).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: T.rSm).fill(primary ? Color.lime : Color.panel))
        .overlay(RoundedRectangle(cornerRadius: T.rSm).stroke(primary ? Color.clear : Color.edge, lineWidth: T.hair))
    }
}
// Dashed "drag to place" affordance (borrowed from variant-a) — for file-y results.
struct DragChip: View {
    var label = "drag to place"
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "hand.draw").font(.system(size: 10, weight: .semibold))
            Text(label).font(.hanken(11, .semibold))
        }
        .foregroundColor(.inkDim).padding(.horizontal, 11).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: T.rSm).fill(Color.panel.opacity(0.5)))
        .overlay(RoundedRectangle(cornerRadius: T.rSm)
            .strokeBorder(style: StrokeStyle(lineWidth: T.hair, dash: [4, 3])).foregroundColor(.edge))
    }
}
// Action bar: a leading affordance (drag/copy) + trailing open-full. Adapts per result.
struct ActionRow: View {
    let openLabel: String; var draggable: Bool = true; var canRegen: Bool = true
    var body: some View {
        HStack(spacing: T.s2) {
            if draggable { DragChip() } else { ActionButton(icon: "doc.on.doc", label: "Copy") }
            if canRegen { ActionButton(icon: "arrow.clockwise", label: "Regenerate") }
            Spacer(minLength: T.s3)
            ActionButton(icon: "arrow.up.right.square.fill", label: openLabel, primary: true)
        }
    }
}
struct SteerRow: View {
    let chips: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: T.s2) {
            Text("STEER").kicker()
            HStack(spacing: T.s2) {
                ForEach(chips, id: \.self) { c in
                    Text(c).font(.hanken(10.5, .medium)).foregroundColor(.inkDim)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Capsule().fill(Color.panel))
                        .overlay(Capsule().stroke(Color.edge, lineWidth: T.hair))
                }
                Spacer(minLength: 0)
            }
        }
    }
}
struct PlaceholderArt: View {
    var symbol = "photo", tint: Color = .lime, symbolSize: CGFloat = 22
    var body: some View {
        ZStack {
            LinearGradient(colors: [tint.opacity(0.22), .raised, .panel], startPoint: .topLeading, endPoint: .bottomTrailing)
            Image(systemName: symbol).font(.system(size: symbolSize)).foregroundColor(tint.opacity(0.85))
        }
    }
}

// ============================================================================
// RESULT RENDERERS = the widget SIZE CLASSES (one per output shape).
// ============================================================================

// image (medium): the dominant generated image.
struct ResultImage: View {
    var body: some View {
        PlaceholderArt(symbol: "sparkles", tint: .lime, symbolSize: 40)
            .aspectRatio(4.0/3.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: T.rLg))
            .overlay(RoundedRectangle(cornerRadius: T.rLg).stroke(Color.edge, lineWidth: T.hair))
    }
}
// gallery (large): several images (yearbook eras, emote stickers, reel scenes).
struct ResultGallery: View {
    let items: [String]   // labels
    let cols = [GridItem(.flexible(), spacing: T.s2), GridItem(.flexible(), spacing: T.s2)]
    var body: some View {
        LazyVGrid(columns: cols, spacing: T.s2) {
            ForEach(items, id: \.self) { label in
                VStack(spacing: 5) {
                    PlaceholderArt(symbol: "photo", tint: .lime, symbolSize: 18)
                        .aspectRatio(1, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: T.rMd))
                        .overlay(RoundedRectangle(cornerRadius: T.rMd).stroke(Color.edge, lineWidth: T.hair))
                    Text(label).font(.splMono(9)).foregroundColor(.inkFaint).lineLimit(1)
                }
            }
        }
    }
}
// cards (large): option/concept cards, exactly one recommended (doctrine).
struct CardItem: Identifiable { let id = UUID(); let label: String; let text: String; var rec = false }
struct ResultCards: View {
    let items: [CardItem]
    var body: some View {
        VStack(spacing: T.s2) {
            ForEach(items) { c in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: T.s2) {
                        Text(c.label).font(.hanken(12.5, .semibold)).foregroundColor(.ink)
                        if c.rec {
                            Text("recommended").font(.splMono(8.5)).foregroundColor(.lime)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Capsule().fill(Color.lime.opacity(0.12)))
                        }
                        Spacer(minLength: 0)
                    }
                    Text(c.text).font(.hanken(11)).foregroundColor(.inkDim).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                .padding(T.s3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: T.rMd).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: T.rMd).stroke(c.rec ? Color.lime.opacity(0.5) : Color.edge, lineWidth: T.hair))
            }
        }
    }
}
// text (small): a roast, a reading, an answer. Panel with a soft bottom fade.
struct ResultText: View {
    let text: String
    var body: some View {
        Text(text).font(.hanken(12.5)).foregroundColor(.ink).lineSpacing(4)
            .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            .padding(T.s4)
            .background(RoundedRectangle(cornerRadius: T.rMd).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: T.rMd).stroke(Color.edge, lineWidth: T.hair))
    }
}
// working: the generating state, reusable across all types.
struct WorkingCanvas: View {
    let line: String
    var body: some View {
        VStack(alignment: .leading, spacing: T.s3) {
            ZStack {
                PlaceholderArt(symbol: "wand.and.stars", tint: .lime, symbolSize: 34)
                LinearGradient(colors: [.clear, .white.opacity(0.06), .clear], startPoint: .leading, endPoint: .trailing)
            }
            .aspectRatio(16.0/6.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: T.rLg))
            .overlay(RoundedRectangle(cornerRadius: T.rLg).stroke(Color.edge, lineWidth: T.hair))
            CaptionLine(text: line, icon: "wand.and.stars")
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.panel)
                    Capsule().fill(LinearGradient(colors: [.lime.opacity(0.5), .lime], startPoint: .leading, endPoint: .trailing))
                        .frame(width: g.size.width * 0.42)
                }
            }.frame(height: 4)
        }
    }
}

// ============================================================================
// THE WIDGET — shared chrome × a result renderer chosen by output shape.
// ============================================================================
enum WidgetResult {
    case working(String)
    case image(caption: String, steer: [String])
    case gallery(caption: String, items: [String])
    case cards(caption: String, items: [CardItem])
    case text(String)
}
struct WidgetSpec {
    let kicker: String       // "PRISM · IMAGE"
    let title: String        // "From your selection"
    let openLabel: String    // "Open in Prism"
    let result: WidgetResult
}
struct NotchWidget: View {
    let spec: WidgetSpec
    var accent: Color { if case .working = spec.result { return .lime }; return .ok }
    var body: some View {
        VStack(alignment: .leading, spacing: T.s4) {
            WidgetHeader(kicker: spec.kicker, title: spec.title, accent: accent)
            Hairline()
            renderer
        }
        .padding(.top, T.s5).padding(.horizontal, T.ear + T.padH).padding(.bottom, T.s6)
        .frame(width: T.width, alignment: .leading)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: T.ear, botR: 24))
        .overlay(NotchDropShape(ear: T.ear, botR: 24).stroke(Color.edge.opacity(0.5), lineWidth: T.hair))
    }
    @ViewBuilder var renderer: some View {
        switch spec.result {
        case .working(let l):
            WorkingCanvas(line: l)
        case .image(let cap, let steer):
            VStack(alignment: .leading, spacing: T.s4) {
                ResultImage(); CaptionLine(text: cap); Hairline()
                SteerRow(chips: steer); ActionRow(openLabel: spec.openLabel, draggable: true)
            }
        case .gallery(let cap, let items):
            VStack(alignment: .leading, spacing: T.s4) {
                ResultGallery(items: items); CaptionLine(text: cap)
                ActionRow(openLabel: spec.openLabel, draggable: true)
            }
        case .cards(let cap, let items):
            VStack(alignment: .leading, spacing: T.s4) {
                ResultCards(items: items); CaptionLine(text: cap)
                ActionRow(openLabel: spec.openLabel, draggable: false)
            }
        case .text(let body):
            VStack(alignment: .leading, spacing: T.s4) {
                ResultText(text: body)
                ActionRow(openLabel: spec.openLabel, draggable: false)
            }
        }
    }
}

// ============================================================================
// RENDER — one widget per capability type, proving the kit is generic.
// ============================================================================
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    snap("kit-prism-image", NotchWidget(spec: .init(
        kicker: "PRISM · IMAGE", title: "From your selection", openLabel: "Open in Prism",
        result: .image(caption: "A soft editorial illustration based on your selection.",
                        steer: ["Warmer", "More detail", "Flat vector", "Photoreal"]))))

    snap("kit-roast-text", NotchWidget(spec: .init(
        kicker: "ROAST · TEXT", title: "Acqui-Hire Alchemist", openLabel: "Open in Roast",
        result: .text("\"3x exited.\" Let's translate that from Founder-ese to English: three separate times, a company looked at your team, said \"we don't want the product, but fine, we'll take the people,\" and quietly absorbed you into middle management.\n\nThat's not an exit. That's being adopted. Three times. By strangers."))))

    snap("kit-adforge-cards", NotchWidget(spec: .init(
        kicker: "ADFORGE · CONCEPTS", title: "This week's ads", openLabel: "Open in AdForge",
        result: .cards(caption: "Three angles, grounded in your brand.", items: [
            CardItem(label: "Lead with the outcome", text: "Ship AI apps without paying for inference — your users bring the compute.", rec: true),
            CardItem(label: "Name the pain", text: "You already pay for Claude. Why pay twice to ship a wrapper?"),
            CardItem(label: "Proof & specifics", text: "75% of revenue to devs, by usage. The broker never sees your data.")]))))

    snap("kit-yearbook-gallery", NotchWidget(spec: .init(
        kicker: "YEARBOOK · GALLERY", title: "Through the decades", openLabel: "Open in Yearbook",
        result: .gallery(caption: "Four eras from your photo.", items: ["Class of '77", "Class of '88", "Class of '99", "Class of '09"]))))

    snap("kit-working", NotchWidget(spec: .init(
        kicker: "PRISM · IMAGE", title: "Making an image…", openLabel: "Open in Prism",
        result: .working("Making an image from your selection…"))))
    exit(0)
}
app.run()
