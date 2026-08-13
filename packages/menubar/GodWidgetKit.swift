// THE NOTCH WIDGET KIT — one frame, many wrapps, phone-widget grammar (docs/GOD-HANDS.md #4).
// The notch is the OS-provided frame; each wrapp ships a glanceable widget (a slice + tap-to-open-full).
// Result-type renderers ARE the widget size classes: text=small, image=medium, gallery/cards=large.
// This is the IN-APP port of GodWidgetKit.preview.swift — Color/Font/.kicker()/NotchDropShape live in
// RelayMenuBar.swift (same module), so only the widget-specific pieces are here.
import AppKit
import SwiftUI

// design tokens: sourced from the module-level SB/SBr scales (RelayMenuBar.swift) so there is ONE grid and
// ONE radius scale across panel · widgets · ambient · store (NOTCH-DESIGN §4/§5), not three copies.
enum WK {
    static let s1 = SB.s1, s2 = SB.s2, s3 = SB.s3, s4 = SB.s4, s5 = SB.s5, s6 = SB.s6
    static let rSm = SBr.xs, rMd = SBr.sm, rLg = SBr.md
    static let width: CGFloat = 600, ear: CGFloat = 14, padH: CGFloat = 22, hair: CGFloat = 1
}

// Drag a generated file OUT of the widget (Finder / any app / Flow). Only attached when a file exists.
extension View {
    @ViewBuilder func dragOut(_ path: String?) -> some View {
        if let path { self.onDrag { NSItemProvider(contentsOf: URL(fileURLWithPath: path)) ?? NSItemProvider() } }
        else { self }
    }
}

// ---------- shared chrome (every widget wears these) ----------
struct WidgetHeader: View {
    // One accent (NOTCH-DESIGN §2.2): the "healthy" header dot is lime, never a second green.
    let kicker: String, title: String; var accent: Color = .lime
    var projects: [(id: String, name: String)] = []      // context-first: the project the run is grounded in
    var activeProjectId: String? = nil
    var onSelectProject: ((String?) -> Void)? = nil
    var onClose: () -> Void = {}
    var body: some View {
        HStack(alignment: .center, spacing: WK.s3) {
            Circle().fill(accent).frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(kicker).kicker()
                Text(title).font(.brico(14, .semibold)).foregroundColor(.ink).lineLimit(1)
            }
            Spacer(minLength: WK.s3)
            if !projects.isEmpty {
                ProjectChip(projects: projects, activeId: activeProjectId, onSelect: onSelectProject ?? { _ in })
            }
            WKIconChip(icon: "xmark", action: onClose)
        }
    }
}
// The PROJECT chip — a context-dependent command ("make me an ad") is only right if the right project
// is lent, so the selector lives ON the widget, not buried in the panel. Writes the same global
// default the panel's picker writes; self-updating via local state.
struct ProjectChip: View {
    let projects: [(id: String, name: String)]
    let onSelect: (String?) -> Void
    @State private var currentId: String?
    init(projects: [(id: String, name: String)], activeId: String?, onSelect: @escaping (String?) -> Void) {
        self.projects = projects; self.onSelect = onSelect; _currentId = State(initialValue: activeId)
    }
    private var label: String { projects.first { $0.id == currentId }?.name ?? "no project" }
    var body: some View {
        Menu {
            ForEach(projects, id: \.id) { p in
                Button(action: { currentId = p.id; onSelect(p.id) }) {
                    if p.id == currentId { Label(p.name, systemImage: "checkmark") } else { Text(p.name) }
                }
            }
            Divider()
            Button(action: { currentId = nil; onSelect(nil) }) {
                if currentId == nil { Label("No project", systemImage: "checkmark") } else { Text("No project") }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "folder").font(.system(size: 9, weight: .semibold))
                Text(label).font(.hanken(11, .medium)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold))
            }
            .foregroundColor(currentId == nil ? .inkFaint : .inkDim)
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: WK.rSm).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: WK.rSm).stroke(currentId == nil ? Color.edge : Color.lime.opacity(0.45), lineWidth: WK.hair))
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .help("The project this run is grounded in — switch it before running")
    }
}
struct WKIconChip: View {
    let icon: String; var tint: Color = .inkDim; var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundColor(tint)
                .frame(width: 26, height: 26)
                .background(RoundedRectangle(cornerRadius: WK.rSm).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: WK.rSm).stroke(Color.edge, lineWidth: WK.hair))
        }.buttonStyle(.plain)
    }
}
struct WKHairline: View { var body: some View { Rectangle().fill(Color.edge).frame(height: WK.hair) } }

struct CaptionLine: View {
    let text: String; var icon: String = "text.alignleft"
    var body: some View {
        HStack(spacing: WK.s2) {
            Image(systemName: icon).font(.system(size: 9, weight: .semibold)).foregroundColor(.inkFaint)
            Text(text).font(.hanken(12)).foregroundColor(.inkDim).lineLimit(1)
            Spacer(minLength: 0)
        }
    }
}
// The one primary/ghost button (unifies the ad-hoc lime buttons + ghost).
struct WKActionButton: View {
    let icon: String, label: String; var primary: Bool = false; var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 10, weight: .semibold))
                Text(label).font(.hanken(11, .semibold)).lineLimit(1).fixedSize()
            }
            .foregroundColor(primary ? .page : .inkDim)
            .padding(.horizontal, 11).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: WK.rSm).fill(primary ? Color.lime : Color.panel))
            .overlay(RoundedRectangle(cornerRadius: WK.rSm).stroke(primary ? Color.clear : Color.edge, lineWidth: WK.hair))
        }.buttonStyle(.plain)
    }
}
// Dashed "drag to place" affordance — draggable when a file is present.
struct DragChip: View {
    var label = "drag to place"; var file: String? = nil
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "hand.draw").font(.system(size: 10, weight: .semibold))
            Text(label).font(.hanken(11, .semibold))
        }
        .foregroundColor(.inkDim).padding(.horizontal, 11).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: WK.rSm).fill(Color.panel.opacity(0.5)))
        .overlay(RoundedRectangle(cornerRadius: WK.rSm)
            .strokeBorder(style: StrokeStyle(lineWidth: WK.hair, dash: [4, 3])).foregroundColor(.edge))
        .dragOut(file)
    }
}
struct ActionRow: View {
    let openLabel: String; var draggable: Bool = true; var canRegen: Bool = true; var file: String? = nil
    var copyText: String? = nil                      // what Copy puts on the pasteboard (text results)
    var onOpen: () -> Void = {}; var onRegen: () -> Void = {}
    @State private var copied = false
    var body: some View {
        HStack(spacing: WK.s2) {
            if draggable {
                DragChip(file: file)
            } else {
                WKActionButton(icon: copied ? "checkmark" : "doc.on.doc", label: copied ? "Copied" : "Copy") {
                    guard let t = copyText, !t.isEmpty else { return }
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(t, forType: .string)
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { copied = false }
                }
            }
            if canRegen { WKActionButton(icon: "arrow.clockwise", label: "Regenerate", action: onRegen) }
            Spacer(minLength: WK.s3)
            WKActionButton(icon: "arrow.up.right.square.fill", label: openLabel, primary: true, action: onOpen)
        }
    }
}
struct SteerRow: View {
    let chips: [String]; var onSteer: (String) -> Void = { _ in }
    var body: some View {
        VStack(alignment: .leading, spacing: WK.s2) {
            Text("STEER").kicker()
            HStack(spacing: WK.s2) {
                ForEach(chips, id: \.self) { c in
                    Button(action: { onSteer(c) }) {
                        Text(c).font(.hanken(11, .medium)).foregroundColor(.inkDim)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Capsule().fill(Color.panel))
                            .overlay(Capsule().stroke(Color.edge, lineWidth: WK.hair))
                    }.buttonStyle(.plain)
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

// ---------- result renderers = the widget size classes ----------
struct ResultImage: View {
    var file: String? = nil
    var body: some View {
        Group {
            if let file, let img = NSImage(contentsOfFile: file) {
                Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
            } else {
                PlaceholderArt(symbol: "sparkles", tint: .lime, symbolSize: 40).aspectRatio(4.0/3.0, contentMode: .fit)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: WK.rLg))
        .overlay(RoundedRectangle(cornerRadius: WK.rLg).stroke(Color.edge, lineWidth: WK.hair))
        .dragOut(file)
    }
}
struct ResultGallery: View {
    let items: [String]
    let cols = [GridItem(.flexible(), spacing: WK.s2), GridItem(.flexible(), spacing: WK.s2)]
    var body: some View {
        LazyVGrid(columns: cols, spacing: WK.s2) {
            ForEach(items, id: \.self) { label in
                VStack(spacing: 5) {
                    PlaceholderArt(symbol: "photo", tint: .lime, symbolSize: 18)
                        .aspectRatio(1, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: WK.rMd))
                        .overlay(RoundedRectangle(cornerRadius: WK.rMd).stroke(Color.edge, lineWidth: WK.hair))
                    Text(label).font(.splMono(9)).foregroundColor(.inkFaint).lineLimit(1)
                }
            }
        }
    }
}
struct CardItem: Identifiable { let id = UUID(); let label: String; let text: String; var rec = false }
struct ResultCards: View {
    let items: [CardItem]
    var body: some View {
        VStack(spacing: WK.s2) {
            ForEach(items) { c in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: WK.s2) {
                        Text(c.label).font(.hanken(12, .semibold)).foregroundColor(.ink)
                        if c.rec {
                            Text("recommended").font(.splMono(9)).foregroundColor(.lime)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Capsule().fill(Color.lime.opacity(0.12)))
                        }
                        Spacer(minLength: 0)
                    }
                    Text(c.text).font(.hanken(11)).foregroundColor(.inkDim).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                .padding(WK.s3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: WK.rMd).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: WK.rMd).stroke(c.rec ? Color.lime.opacity(0.45) : Color.edge, lineWidth: WK.hair))
            }
        }
    }
}
struct ResultText: View {
    let text: String
    private var inner: some View {
        Text(text).font(.hanken(12)).foregroundColor(.ink).lineSpacing(4)
            .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            .padding(WK.s4)
    }
    var body: some View {
        // Long results scroll INSIDE the widget instead of stretching the drop taller than the screen
        // (same containment rule as the panel's connection list).
        Group {
            if text.count > 700 { ScrollView(showsIndicators: false) { inner }.frame(maxHeight: 340) }
            else { inner }
        }
        .background(RoundedRectangle(cornerRadius: WK.rMd).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: WK.rMd).stroke(Color.edge, lineWidth: WK.hair))
    }
}
// Honest loading state — NOT a fake image. A driving wrapp used to show a big placeholder-art box that
// read like the result; now it's a clear "working" treatment: a live spinner + the status line, and a
// genuinely INDETERMINATE (moving) bar. Nothing here pretends to be output.
struct WorkingCanvas: View {
    let line: String
    @State private var slide = false
    var body: some View {
        VStack(alignment: .leading, spacing: WK.s3) {
            HStack(spacing: WK.s2) {
                ProgressView().controlSize(.small).tint(.lime)
                Text(line).font(.hanken(12)).foregroundColor(.inkDim).lineLimit(2)
                Spacer(minLength: 0)
            }
            // indeterminate bar: a lime segment sweeping left→right on a loop, so it reads as "in flight"
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.panel)
                    Capsule().fill(LinearGradient(colors: [.lime.opacity(0.15), .lime, .lime.opacity(0.15)], startPoint: .leading, endPoint: .trailing))
                        .frame(width: g.size.width * 0.33)
                        .offset(x: slide ? g.size.width * 0.67 : -g.size.width * 0.02)
                        .animation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: slide)
                }
            }.frame(height: 4)
        }
        .padding(.vertical, WK.s2)
        .onAppear { slide = true }
    }
}

// ---------- result LIST = the search-result surface (title · source · snippet · link) ----------
// A third-party tool that speaks the results envelope (examples/tools/README-envelope.md) lands here
// instead of a raw text dump: each hit is a real CARD you can click to open, with its source + a meta tag.
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
                // rank chip — grounds the list order and gives the card a visual anchor (no favicons to fetch)
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
        .buttonStyle(.plain)
        .onHover { hover = $0 && openable }
        .help(openable ? item.url : item.title)
    }
}
struct ResultList: View {
    let items: [ResultItem]; var onOpen: (String) -> Void = { _ in }
    var body: some View {
        // Long result sets scroll INSIDE the widget (same containment rule as ResultText / the panel list).
        let list = VStack(spacing: WK.s2) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, it in
                ResultCard(item: it, index: i + 1, onOpen: onOpen)
            }
        }
        Group {
            if items.count > 5 { ScrollView(showsIndicators: false) { list }.frame(maxHeight: 420) }
            else { list }
        }
    }
}

// ---------- the widget: shared chrome × a result renderer chosen by output shape ----------
enum WidgetResult {
    case working(String)
    case image(caption: String, steer: [String], file: String?)
    case gallery(caption: String, items: [String])
    case cards(caption: String, items: [CardItem])
    case results(summary: String, items: [ResultItem])
    case text(String)
}
struct WidgetSpec {
    let kicker: String
    let title: String
    let openLabel: String
    let result: WidgetResult
}
struct NotchWidget: View {
    let spec: WidgetSpec
    var projects: [(id: String, name: String)] = []
    var activeProjectId: String? = nil
    var onSelectProject: ((String?) -> Void)? = nil
    var onClose: () -> Void = {}
    var onOpen: () -> Void = {}
    var onRegen: () -> Void = {}
    var onSteer: (String) -> Void = { _ in }
    var onOpenLink: (String) -> Void = { _ in }   // a result card was clicked → open its URL
    var accent: Color { .lime }   // one accent — working vs done reads from the renderer, not a hue swap
    var body: some View {
        VStack(alignment: .leading, spacing: WK.s4) {
            WidgetHeader(kicker: spec.kicker, title: spec.title, accent: accent,
                         projects: projects, activeProjectId: activeProjectId,
                         onSelectProject: onSelectProject, onClose: onClose)
            WKHairline()
            renderer
        }
        .padding(.top, WK.s5).padding(.horizontal, WK.ear + WK.padH).padding(.bottom, WK.s6)
        .frame(width: WK.width, alignment: .leading)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: WK.ear, botR: 24))
        .overlay(NotchDropShape(ear: WK.ear, botR: 24).stroke(Color.edge.opacity(0.5), lineWidth: WK.hair))
    }
    @ViewBuilder var renderer: some View {
        switch spec.result {
        case .working(let l):
            WorkingCanvas(line: l)
        case .image(let cap, let steer, let file):
            VStack(alignment: .leading, spacing: WK.s4) {
                ResultImage(file: file); CaptionLine(text: cap); WKHairline()
                SteerRow(chips: steer, onSteer: onSteer)
                ActionRow(openLabel: spec.openLabel, draggable: true, file: file, onOpen: onOpen, onRegen: onRegen)
            }
        case .gallery(let cap, let items):
            VStack(alignment: .leading, spacing: WK.s4) {
                ResultGallery(items: items); CaptionLine(text: cap)
                ActionRow(openLabel: spec.openLabel, draggable: true, onOpen: onOpen, onRegen: onRegen)
            }
        case .cards(let cap, let items):
            VStack(alignment: .leading, spacing: WK.s4) {
                ResultCards(items: items); CaptionLine(text: cap)
                ActionRow(openLabel: spec.openLabel, draggable: false,
                          copyText: items.map { "\($0.label) — \($0.text)" }.joined(separator: "\n\n"),
                          onOpen: onOpen, onRegen: onRegen)
            }
        case .results(let summary, let items):
            VStack(alignment: .leading, spacing: WK.s4) {
                if !summary.isEmpty { CaptionLine(text: "\(items.count) result\(items.count == 1 ? "" : "s") · \(summary)", icon: "magnifyingglass") }
                ResultList(items: items, onOpen: onOpenLink)
                ActionRow(openLabel: spec.openLabel, draggable: false, canRegen: true,
                          copyText: nil, onOpen: onOpen, onRegen: onRegen)
            }
        case .text(let body):
            VStack(alignment: .leading, spacing: WK.s4) {
                ResultText(text: body)
                ActionRow(openLabel: spec.openLabel, draggable: false, copyText: body,
                          onOpen: onOpen, onRegen: onRegen)
            }
        }
    }
}
