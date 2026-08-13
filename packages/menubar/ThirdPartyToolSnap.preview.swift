// Standalone ImageRenderer snapshot for the THIRD-PARTY TOOL redesign — NOT in build.sh (own main).
// Verifies the two surfaces the founder disliked, without the human:
//   1. the tool GRANT card (ToolGrantDrop) — provenance-forward, keys-local lane badge, no model pills
//   2. the tool RESULTS widget (.results → ResultList/ResultCard) — real search cards, not a text dump
// The view code below is copied VERBATIM from RelayMenuBar.swift / GodWidgetKit.swift (the structs are
// module-internal there); tokens are stubbed to match the house palette. Build + run:
//   swiftc -parse-as-library packages/menubar/ThirdPartyToolSnap.preview.swift -o /tmp/tpsnap && /tmp/tpsnap
import AppKit
import SwiftUI

let OUT = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-zealous-davinci-5c96d7/95729692-3f75-4a54-90a8-0fd4cbb597b5/scratchpad"
@MainActor func snap<V: View>(_ name: String, _ view: V, width: CGFloat) {
    let r = ImageRenderer(content: view.frame(width: width).fixedSize(horizontal: false, vertical: true))
    r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    try? png.write(to: URL(fileURLWithPath: "\(OUT)/\(name).png")); print("wrote \(OUT)/\(name).png")
}

// ---- house palette + fonts (match RelayMenuBar.swift) ----
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
    static func brico(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .system(size: s, weight: w) }
}
enum WK { static let s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20, s6: CGFloat = 24
    static let rSm: CGFloat = 7, rMd: CGFloat = 12, ear: CGFloat = 14, padH: CGFloat = 22, hair: CGFloat = 1 }
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

// ═══════════ VERBATIM: ResultItem / ResultCard / ResultList (GodWidgetKit.swift) ═══════════
struct ResultItem: Identifiable {
    let id = UUID()
    let title: String; let url: String; let source: String; let snippet: String; let meta: String
}
struct ResultCard: View {
    let item: ResultItem; var index: Int; var onOpen: (String) -> Void
    @State private var hover = false
    private var openable: Bool { !item.url.isEmpty }
    var body: some View {
        Button(action: { if openable { onOpen(item.url) } }) {
            HStack(alignment: .top, spacing: WK.s3) {
                Text("\(index)").font(.splMono(11)).foregroundColor(hover ? .page : .inkFaint)
                    .frame(width: 24, height: 24)
                    .background(RoundedRectangle(cornerRadius: WK.rSm).fill(hover ? Color.lime : Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: WK.rSm).stroke(Color.edge, lineWidth: hover ? 0 : WK.hair))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: WK.s2) {
                        if !item.source.isEmpty {
                            HStack(spacing: 4) {
                                Circle().fill(Color.lime).frame(width: 4, height: 4)
                                Text(item.source).font(.splMono(9)).foregroundColor(.inkFaint).lineLimit(1)
                            }
                        }
                        Spacer(minLength: WK.s2)
                        if !item.meta.isEmpty {
                            Text(item.meta).font(.splMono(9)).foregroundColor(.inkDim).lineLimit(1)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Capsule().fill(Color.raised))
                        }
                        if openable {
                            Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .bold))
                                .foregroundColor(hover ? .lime : .inkFaint)
                        }
                    }
                    Text(item.title).font(.hanken(13, .semibold)).foregroundColor(.ink)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if !item.snippet.isEmpty {
                        Text(item.snippet).font(.hanken(11.5)).foregroundColor(.inkDim).lineSpacing(2)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(WK.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: WK.rMd).fill(hover ? Color.raised.opacity(0.7) : Color.panel))
            .overlay(RoundedRectangle(cornerRadius: WK.rMd).stroke(hover ? Color.lime.opacity(0.5) : Color.edge, lineWidth: WK.hair))
        }
        .buttonStyle(.plain).onHover { hover = $0 && openable }
    }
}
struct ResultList: View {
    let items: [ResultItem]; var onOpen: (String) -> Void = { _ in }
    var body: some View {
        VStack(spacing: WK.s2) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, it in
                ResultCard(item: it, index: i + 1, onOpen: onOpen)
            }
        }
    }
}
// minimal notch frame to show the results widget in context (header + caption + list)
struct ResultsWidgetPreview: View {
    let kicker: String; let summary: String; let items: [ResultItem]
    var body: some View {
        VStack(alignment: .leading, spacing: WK.s4) {
            HStack(spacing: WK.s3) {
                Circle().fill(Color.lime).frame(width: 6, height: 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(kicker).font(.splMono(9.5)).kerning(1.4).foregroundColor(.inkFaint)
                    Text(summary).font(.brico(14, .semibold)).foregroundColor(.ink).lineLimit(1)
                }
                Spacer(minLength: WK.s3)
                Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundColor(.inkDim)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: WK.rSm).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: WK.rSm).stroke(Color.edge, lineWidth: WK.hair))
            }
            Rectangle().fill(Color.edge).frame(height: WK.hair)
            HStack(spacing: WK.s2) {
                Image(systemName: "magnifyingglass").font(.system(size: 9, weight: .semibold)).foregroundColor(.inkFaint)
                Text("\(items.count) results · \(summary)").font(.hanken(12)).foregroundColor(.inkDim).lineLimit(1)
                Spacer(minLength: 0)
            }
            ResultList(items: items)
            HStack(spacing: WK.s2) {
                Spacer(minLength: WK.s3)
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.right.square.fill").font(.system(size: 10, weight: .semibold))
                    Text("Drop into chat").font(.hanken(11, .semibold))
                }.foregroundColor(.page).padding(.horizontal, 11).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: WK.rSm).fill(Color.lime))
            }
        }
        .padding(.top, WK.s5).padding(.horizontal, WK.ear + WK.padH).padding(.bottom, WK.s6)
        .frame(width: 600, alignment: .leading)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: WK.ear, botR: 24))
        .overlay(NotchDropShape(ear: WK.ear, botR: 24).stroke(Color.edge.opacity(0.5), lineWidth: WK.hair))
    }
}

// ═══════════ VERBATIM: ToolGrantDrop (RelayMenuBar.swift) ═══════════
enum ToolCredLane { case localNoKey, pool, myKey }
// mirrors CursorGuide.KeyCap (the canonical shortcut cap the app now uses)
struct KeyCap: View {
    let glyph: String; var big = false; var filled = false; var recessed = false
    var body: some View {
        Text(glyph)
            .font(.splMono(big ? 12 : 9.5))
            .foregroundColor(recessed ? .ink : (filled ? .page : .ink))
            .frame(minWidth: big ? 20 : 13)
            .padding(.horizontal, big ? 6 : 4).padding(.vertical, big ? 4 : 2)
            .background(RoundedRectangle(cornerRadius: big ? 6 : 4).fill(recessed ? Color.black.opacity(0.22) : (filled ? Color.lime : Color.raised))
                .overlay(RoundedRectangle(cornerRadius: big ? 6 : 4).stroke(recessed || filled ? Color.clear : Color.edge, lineWidth: 1)))
    }
}
struct ToolGrantAction: Identifiable { let id = UUID(); let label: String; let desc: String; let write: Bool }
struct ToolGrantDrop: View {
    let toolName: String; let tagline: String; let server: String
    let actions: [ToolGrantAction]
    let grantTools: [[String: Any]]
    let budgets: [String: Any]; let contextKinds: [String]
    var lane: ToolCredLane = .localNoKey
    var onApprove: ([String: Any]) -> Void
    var onDeny: () -> Void
    private let red = Color(red: 1, green: 0.42, blue: 0.37)
    private var hasWrite: Bool { actions.contains { $0.write } }
    private var hero: some View {
        HStack(spacing: 11) {
            RoundedRectangle(cornerRadius: 11).fill(Color.lime).frame(width: 40, height: 40)
                .overlay(Image(systemName: "wrench.and.screwdriver.fill").font(.system(size: 17, weight: .bold)).foregroundColor(.page))
            HStack(spacing: 5) {
                ForEach(0..<7, id: \.self) { i in
                    Circle().fill(Color.lime.opacity(0.28 + 0.5 * (1 - Double(abs(i - 3)) / 3))).frame(width: 4, height: 4)
                }
            }
            RoundedRectangle(cornerRadius: 11).fill(Color.raised).frame(width: 40, height: 40)
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.edge, lineWidth: 1))
                .overlay(Image(systemName: "lock.laptopcomputer").font(.system(size: 16, weight: .semibold)).foregroundColor(.lime))
        }
    }
    private func actionRow(_ a: ToolGrantAction) -> some View {
        HStack(spacing: 8) {
            Circle().fill(a.write ? red : Color.lime).frame(width: 6, height: 6)
            Text(a.label).font(.hanken(12, .semibold)).foregroundColor(.ink).lineLimit(1).fixedSize()
            if !a.desc.isEmpty { Text(a.desc).font(.hanken(10.5)).foregroundColor(.inkDim).lineLimit(1) }
            Spacer(minLength: 6)
            Text(a.write ? "write" : "read").font(.splMono(8)).foregroundColor(a.write ? red : .inkFaint)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color.raised.opacity(0.5)))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1))
    }
    @ViewBuilder private var laneBadge: some View {
        let (icon, head, sub, tag): (String, String, String, String) = {
            switch lane {
            case .localNoKey: return ("lock.fill", "Runs on your machine", "No key needed · nothing leaves your Mac", "LOCAL")
            case .pool:       return ("bolt.fill", "Metered · via the pool", "Runs now, no signup — brokered, keys never held by us", "POOL")
            case .myKey:      return ("key.fill", "Your key, kept local", "Stored 0600 in ~/.relay · nothing leaves your Mac", "MY KEY")
            }
        }()
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 8).fill(Color.lime.opacity(0.14)).frame(width: 30, height: 30)
                .overlay(Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundColor(.lime))
            VStack(alignment: .leading, spacing: 1) {
                Text(head).font(.hanken(11.5, .semibold)).foregroundColor(.ink)
                Text(sub).font(.hanken(10)).foregroundColor(.inkDim).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            Text(tag).font(.splMono(8)).foregroundColor(.lime)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Capsule().fill(Color.lime.opacity(0.12)))
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 11).fill(Color.raised.opacity(0.45)))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.lime.opacity(0.28), lineWidth: 1))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            hero.frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 3) {
                (Text("Run ").foregroundColor(.ink) + Text(toolName).foregroundColor(.lime) + Text("?").foregroundColor(.ink)).font(.hanken(14.5, .semibold))
                if !tagline.isEmpty { Text(tagline).font(.hanken(10.5)).foregroundColor(.inkFaint).lineLimit(2).fixedSize(horizontal: false, vertical: true) }
            }
            Rectangle().fill(Color.edge).frame(height: 1)
            if !actions.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("THIS TOOL RUNS").font(.splMono(9)).foregroundColor(.inkFaint).tracking(1.4)
                        Spacer(minLength: 0)
                        Text(hasWrite ? "read + write" : "read-only").font(.splMono(9)).foregroundColor(hasWrite ? red : .inkFaint)
                    }
                    ForEach(actions) { actionRow($0) }
                }
            }
            laneBadge
            Text("via server “\(server)” · a tool you didn't build — running it is your call")
                .font(.splMono(9)).foregroundColor(.inkFaint).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                HStack(spacing: 7) {
                    Text("Deny").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                    KeyCap(glyph: "Esc", recessed: true)
                }
                .padding(.leading, 13).padding(.trailing, 9).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Image(systemName: "play.fill").font(.system(size: 9, weight: .bold))
                    Text("Approve").font(.hanken(11.5, .semibold))
                    KeyCap(glyph: "↵", recessed: true)
                }.foregroundColor(.page).padding(.leading, 14).padding(.trailing, 10).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
            }.padding(.top, 1)
        }
        .padding(16).frame(width: 344, alignment: .leading).padding(.horizontal, 14)
        .background(Color.page).clipShape(NotchDropShape())
    }
}

// ═══════════ render ═══════════
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    snap("tp-grant", ToolGrantDrop(
        toolName: "Hacker News", tagline: "the front-page pulse for tech & AI news — titles, points, and links.",
        server: "hn",
        actions: [ToolGrantAction(label: "search news", desc: "Find trending / recent stories by topic", write: false)],
        grantTools: [["name": "mcp__hn__search_news", "access": "read"]], budgets: [:], contextKinds: [],
        lane: .localNoKey, onApprove: { _ in }, onDeny: {}), width: 372)

    snap("tp-grant-pool", ToolGrantDrop(
        toolName: "Weather API", tagline: "current conditions + forecast for any city.",
        server: "openweather",
        actions: [ToolGrantAction(label: "get forecast", desc: "5-day forecast by city", write: false),
                  ToolGrantAction(label: "set alert", desc: "notify on severe weather", write: true)],
        grantTools: [["name": "mcp__ow__forecast", "access": "read"]], budgets: [:], contextKinds: [],
        lane: .pool, onApprove: { _ in }, onDeny: {}), width: 372)

    snap("tp-results", ResultsWidgetPreview(kicker: "TOOL · WEB SEARCH", summary: "Web · “apple vision pro”", items: [
        ResultItem(title: "Apple Vision Pro", url: "https://apple.com/vision-pro", source: "en.wikipedia.org",
                   snippet: "A mixed-reality headset developed by Apple, announced in June 2023 and released in early 2024.", meta: "instant answer"),
        ResultItem(title: "Virtual reality headsets", url: "https://duckduckgo.com/vr", source: "duckduckgo.com",
                   snippet: "A head-mounted device that provides virtual reality for the wearer.", meta: "related"),
        ResultItem(title: "Apple Inc. hardware", url: "https://en.wikipedia.org/wiki/Apple_Inc", source: "en.wikipedia.org",
                   snippet: "The hardware products designed and sold by Apple Inc.", meta: "Wikipedia"),
    ]), width: 600)

    snap("tp-results-hn", ResultsWidgetPreview(kicker: "TOOL · HACKER NEWS", summary: "Hacker News · “AI”", items: [
        ResultItem(title: "Don't post generated/AI-edited comments. HN is for conversation between humans",
                   url: "https://news.ycombinator.com/item?id=1", source: "news.ycombinator.com",
                   snippet: "4229 points · 1668 comments on Hacker News", meta: "4229 pts · 1668 💬"),
        ResultItem(title: "Open source AI is the path forward", url: "https://about.fb.com/ai",
                   source: "about.fb.com", snippet: "2360 points · 887 comments on Hacker News", meta: "2360 pts · 887 💬"),
    ]), width: 600)
    exit(0)
}
app.run()
