// OSSurfaceDo.swift — the two "Do" surfaces of the Switchboard OS, ported from the web shell.
//
// Grounds on docs/OS.md §3.12 (Apps) and §3.13 (Store), and the web mock's
// examples/apps/src/os/surfaces/apps.js + store.js. These are the two real "Do" lenses:
//   • AppsSurface  — the installed-tools dock, grouped Pinned / Studios / Tools & Agents / Fun,
//     with a category filter, live + "God can drive" marks, and a Store door at the foot.
//   • StoreSurface — the door-only pane (the OS never rebuilds the store); a primary "Open the
//     Store" door plus category + featured chips, every one a real navigation, no dead ends.
//
// Design law (NOTCH-DESIGN / OS.md §3.1): "discipline in the frame, color in the icons." Chrome is
// monochrome graphite; the only vibrant color is the isometric app tiles (deterministic hue per id).
// Reuses the shared theme from OSShellView.swift / RelayMenuBar.swift: Color tokens (page/rail/panel/
// raised/edge/edgeSoft/ink/inkSec/inkDim/inkFaint/lime/indigo/ok/danger), Font.hanken/.splMono,
// IsoTile, hueForId, colorForId, SectionHead, the Surface enum, and Sample.apps. Nothing here
// redefines any of those — it only ADDS the two surface views and their private models.

import SwiftUI
import Combine

// =====================================================================================================
// MARK: - Apps surface — private model + sample catalog (mirrors apps.js SAMPLE)
// =====================================================================================================

// ═══ LIVE model — Apps renders the REAL install state: ~/.relay/catalog.json (the 76 WrappListings),
// grants.json (which wrapps hold a standing grant = your working set), and the audit log (which were
// active today). No invented live/pinned flags.

private struct DoApp: Identifiable {
    let id: String            // listing id (also the icon + hue key)
    let name: String
    let tagline: String
    let cat: String           // "studio" | "tool" | "skill" | "agent" | "fun"
    let toolCount: Int        // hands a wrapp exposes (what God/the connector can drive)
    let needCount: Int        // requires[] — surfaced, never hidden
    let connected: Bool       // has a standing grant in grants.json (indigo)
    let lastActive: Double    // ms epoch of the latest audit session, 0 = none
    let broken: Bool          // listing failed minimal validation → dimmed, never dropped

    var activeToday: Bool { lastActive > Date().timeIntervalSince1970 * 1000 - 86_400_000 }
}

func doAppsCatalogPath() -> String { (NSHomeDirectory() as NSString).appendingPathComponent(".relay/catalog.json") }

private func doApps() -> [DoApp] {
    guard let obj = readJSON(doAppsCatalogPath()) as? [String: Any],
          let listings = obj["listings"] as? [[String: Any]] else { return [] }
    // wrapp ids holding a standing grant — resolved from grant origins the same way storage origins are
    var granted = Set<String>()
    if let grants = readJSON((NSHomeDirectory() as NSString).appendingPathComponent(".relay/grants.json")) as? [[String: Any]] {
        for g in grants { if let o = g["origin"] as? String { granted.insert(wrappFromOrigin(o).lowercased()) } }
    }
    var lastActive: [String: Double] = [:]
    for s in osSessions(windowDays: 7) { lastActive[s.app.lowercased()] = s.endMs }
    return listings.map { l in
        let id = (l["id"] as? String) ?? ""
        let name = (l["name"] as? String) ?? ""
        return DoApp(id: id,
                     name: name.isEmpty ? id : name,
                     tagline: (l["tagline"] as? String) ?? "",
                     cat: (l["category"] as? String) ?? "tool",
                     toolCount: ((l["tools"] as? [[String: Any]]) ?? []).count,
                     needCount: ((l["requires"] as? [[String: Any]]) ?? []).count,
                     connected: granted.contains(id.lowercased()),
                     lastActive: lastActive[id.lowercased()] ?? 0,
                     broken: id.isEmpty || name.isEmpty)
    }
    .sorted { a, b in a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending }
}

/// The category filter segment — the REAL catalog categories (skill is the biggest shelf).
private enum AppFilter: String, CaseIterable, Identifiable {
    case all = "All", studios = "Studios", tools = "Tools", skills = "Skills", agents = "Agents", fun = "Fun"
    var id: String { rawValue }
    var cat: String? {
        switch self {
        case .all: return nil
        case .studios: return "studio"; case .tools: return "tool"
        case .skills: return "skill"; case .agents: return "agent"; case .fun: return "fun"
        }
    }
}

/// A rendered group of tiles (title + optional note + apps). Non-empty groups only.
private struct AppGroup: Identifiable { let title: String; let note: String?; let apps: [DoApp]; var id: String { title } }

// =====================================================================================================
// MARK: - AppsSurface (the installed-tools dock — real filter, real Store door, no dead ends)
// =====================================================================================================

struct AppsSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var filter: AppFilter = .all
    @State private var query = ""
    @State private var apps: [DoApp] = []

    private var searched: [DoApp] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return apps }
        return apps.filter { $0.name.lowercased().contains(q) || $0.id.lowercased().contains(q) || $0.tagline.lowercased().contains(q) }
    }

    /// All → Connected (the working set — wrapps with a standing grant) leads, then the real category
    /// shelves. A specific filter → just its shelf. Search cuts across everything.
    private var groups: [AppGroup] {
        func nonEmpty(_ gs: [AppGroup]) -> [AppGroup] { gs.filter { !$0.apps.isEmpty } }
        let src = searched
        if let c = filter.cat {
            return nonEmpty([AppGroup(title: filter.rawValue, note: nil, apps: src.filter { $0.cat == c })])
        }
        let connected = src.filter { $0.connected }
        return nonEmpty([
            AppGroup(title: "Connected", note: "your working set — wrapps holding a standing grant", apps: connected),
            AppGroup(title: "Studios", note: nil, apps: src.filter { $0.cat == "studio" && !$0.connected }),
            AppGroup(title: "Tools", note: nil, apps: src.filter { $0.cat == "tool" && !$0.connected }),
            AppGroup(title: "Skills", note: "small hands — most expose tools God can drive", apps: src.filter { $0.cat == "skill" && !$0.connected }),
            AppGroup(title: "Agents", note: nil, apps: src.filter { $0.cat == "agent" && !$0.connected }),
            AppGroup(title: "Fun", note: nil, apps: src.filter { $0.cat == "fun" && !$0.connected }),
        ])
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                AppsHead(total: apps.count, connected: apps.filter { $0.connected }.count,
                         filter: $filter, query: $query)
                AppsLegend()

                if apps.isEmpty {
                    // catalog.json missing/unreadable — say so, point at the real fix
                    HStack(spacing: 12) {
                        Text("!").font(.splMono(13)).foregroundColor(.amber)
                        Text("No catalog at ~/.relay/catalog.json — is the daemon running? The Store rebuilds it.")
                            .font(.hanken(13)).foregroundColor(.inkSec)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.amber.opacity(0.4), lineWidth: 1))
                    .padding(.top, 16)
                } else if groups.isEmpty {
                    Text("Nothing matches \"\(query)\".").font(.hanken(13)).foregroundColor(.inkDim).padding(.top, 20)
                }

                ForEach(groups) { g in
                    AppGroupHead(title: g.title, note: g.note)
                    AppTileGrid(apps: g.apps) { app in
                        OSLaunch.launchOr(app.id, .init(kind: "app")) { onNavigate(.apps) }
                    }
                }

                // the one door to discovery — foot of the dock (apps.js .footdoor)
                StoreFootDoor { onNavigate(.store) }
                    .padding(.top, 30)
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { apps = doApps() }
            .onReceive(OSPulse.shared.$tick) { _ in apps = doApps() }
    }
}

// ---- header: kicker · title · real counts · filter segment · search ----
private struct AppsHead: View {
    let total: Int
    let connected: Int
    @Binding var filter: AppFilter
    @Binding var query: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("APPS").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                Text("Your installed tools").font(.hanken(20, .semibold)).foregroundColor(.ink)
                Text("\(total) in catalog · \(connected) connected").font(.splMono(11)).foregroundColor(.inkDim)
                    .padding(.horizontal, 10).padding(.vertical, 2)
                    .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
                Spacer(minLength: 0)
            }
            HStack(spacing: 10) {
                FilterSegment(filter: $filter)
                HStack(spacing: 7) {
                    Text("⌕").font(.system(size: 12)).foregroundColor(.inkFaint)
                    TextField("Search apps", text: $query)
                        .textFieldStyle(.plain).font(.hanken(12.5)).foregroundColor(.ink)
                        .frame(width: 160)
                }
                .padding(.horizontal, 11).padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1))
                Spacer(minLength: 0)
            }
        }
        .padding(.top, 2).padding(.bottom, 6)
    }
}

private struct FilterSegment: View {
    @Binding var filter: AppFilter
    var body: some View {
        HStack(spacing: 2) {
            ForEach(AppFilter.allCases) { f in
                FilterChip(title: f.rawValue, active: filter == f) { filter = f }
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1))
    }
}

private struct FilterChip: View {
    let title: String; let active: Bool; let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.hanken(12, active ? .semibold : .regular))
                .foregroundColor(active ? .ink : (hover ? .inkSec : .inkDim))
                .padding(.horizontal, 11).padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 7).fill(active ? Color.raised : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// ---- legend: active today · connected · the hint (every mark is a real state) ----
private struct AppsLegend: View {
    var body: some View {
        HStack(spacing: 16) {
            HStack(spacing: 6) {
                Circle().fill(Color.lime).frame(width: 6, height: 6)
                Text("active today").font(.hanken(11)).foregroundColor(.inkDim)
            }
            HStack(spacing: 6) {
                Circle().fill(Color.indigo).frame(width: 6, height: 6)
                Text("connected — holds a standing grant").font(.hanken(11)).foregroundColor(.inkDim)
            }
            Text("click a tile to launch · hover for its hands + needs").font(.hanken(11)).foregroundColor(.inkFaint)
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
    }
}

// ---- one group header (kicker + count/note) ----
private struct AppGroupHead: View {
    let title: String; let note: String?
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title.uppercased()).font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
            if let n = note { Text(n).font(.splMono(10)).foregroundColor(.inkFaint) }
            Spacer(minLength: 0)
        }
        .padding(.top, 26).padding(.bottom, 14)
    }
}

// ---- the tile grid (the closest reference is AppDock in OSShellView.swift) ----
private struct AppTileGrid: View {
    let apps: [DoApp]
    let onLaunch: (DoApp) -> Void
    private let cols = [GridItem(.adaptive(minimum: 104), spacing: 18)]
    var body: some View {
        LazyVGrid(columns: cols, spacing: 18) {
            ForEach(apps) { app in AppTile(app: app, onTap: { onLaunch(app) }) }
        }
    }
}

private struct AppTile: View {
    let app: DoApp
    let onTap: () -> Void
    @State private var hover = false
    private var tip: String {
        var bits: [String] = []
        if !app.tagline.isEmpty { bits.append(app.tagline) }
        if app.toolCount > 0 { bits.append("\(app.toolCount) tool\(app.toolCount == 1 ? "" : "s") God can drive") }
        if app.needCount > 0 { bits.append("\(app.needCount) need\(app.needCount == 1 ? "" : "s")") }
        if app.lastActive > 0 { bits.append("active \(relAgo(Date().timeIntervalSince1970 * 1000 - app.lastActive)) ago") }
        return bits.joined(separator: " · ")
    }
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 9) {
                OSAppGlyph(id: app.id, size: 72)
                    .background(RoundedRectangle(cornerRadius: 18).fill(Color(red: 0x11/255, green: 0x12/255, blue: 0x18/255)))
                    .overlay(RoundedRectangle(cornerRadius: 18)
                        .stroke(hover ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1))
                    .overlay(alignment: .topTrailing) {
                        if app.activeToday {
                            Circle().fill(Color.lime).frame(width: 6, height: 6).padding(9)
                        }
                    }
                    .overlay(alignment: .bottomLeading) {
                        if app.connected {
                            Circle().fill(Color.indigo).frame(width: 6, height: 6).padding(9)
                        }
                    }
                Text(app.name).font(.hanken(12.5, .medium)).foregroundColor(.inkSec).lineLimit(1)
                Text(app.cat).font(.splMono(10)).foregroundColor(.inkFaint)
            }
            .opacity(app.broken ? 0.45 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(tip)
    }
}

// ---- the Store door at the foot of the dock (apps.js .footdoor) ----
private struct StoreFootDoor: View {
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Text("+").font(.splMono(18)).foregroundColor(.lime)
                    .frame(width: 34, height: 34)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.edge, lineWidth: 1))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Get more apps in the Store").font(.hanken(13.5, .semibold)).foregroundColor(.ink)
                    Text("the one door to discovery — featured, shelves, and the resource profile before you Get")
                        .font(.hanken(12)).foregroundColor(.inkDim)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Text("▸").font(.system(size: 16)).foregroundColor(hover ? .lime : .inkDim)
            }
            .padding(.horizontal, 18).padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(hover ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// =====================================================================================================
// MARK: - Store surface — private teaser model (mirrors store.js CATS + TEASERS)
// =====================================================================================================

private struct StoreChip: Identifiable { let title: String; let app: String?; var id: String { title } }
private struct StoreTeaser: Identifiable { let kicker: String; let desc: String; let items: [StoreChip]; var id: String { kicker } }

// The door's chips come from the REAL catalog: category counts, the founder-curated Start-here hero
// (brandbrain), community ports (listings carrying an author), and skills you haven't connected yet.
private func storeCats(_ apps: [DoApp]) -> [String] {
    var out = ["Browse all (\(apps.count))"]
    let order = [("studio", "Studios"), ("tool", "Tools"), ("skill", "Skills"), ("agent", "Agents"), ("fun", "Fun")]
    for (cat, label) in order {
        let n = apps.filter { $0.cat == cat }.count
        if n > 0 { out.append("\(label) (\(n))") }
    }
    return out
}

private func storeTeasers(_ apps: [DoApp]) -> [StoreTeaser] {
    guard !apps.isEmpty else { return [] }
    var out: [StoreTeaser] = []
    if let bb = apps.first(where: { $0.id == "brandbrain" }) {
        out.append(StoreTeaser(kicker: "Start here",
                               desc: bb.tagline.isEmpty ? "Your brand, extracted." : bb.tagline,
                               items: [StoreChip(title: bb.name, app: bb.id)]))
    }
    let skills = apps.filter { $0.cat == "skill" && !$0.connected }.prefix(6)
    if !skills.isEmpty {
        out.append(StoreTeaser(kicker: "Skills you haven't connected",
                               desc: "small hands — most expose tools God can drive; resource profile shown before Get.",
                               items: skills.map { StoreChip(title: $0.name, app: $0.id) }))
    }
    let studios = apps.filter { $0.cat == "studio" && !$0.connected }.prefix(6)
    if !studios.isEmpty {
        out.append(StoreTeaser(kicker: "Studios",
                               desc: "the big rooms — a whole working surface per craft.",
                               items: studios.map { StoreChip(title: $0.name, app: $0.id) }))
    }
    return out
}

// =====================================================================================================
// MARK: - StoreSurface (door only — the OS never rebuilds the store; every chip is a real navigation)
// =====================================================================================================

struct StoreSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var apps: [DoApp] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // head + rule
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("STORE").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                    Text("Get more capability").font(.hanken(20, .semibold)).foregroundColor(.ink)
                    if !apps.isEmpty {
                        Text("\(apps.count) in catalog").font(.splMono(11)).foregroundColor(.inkDim)
                            .padding(.horizontal, 10).padding(.vertical, 2)
                            .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, 2)
                Rectangle().fill(Color.edgeSoft).frame(height: 1).padding(.top, 14).padding(.bottom, 20)

                // the primary door — opens the REAL native store front (featured page + shelves + detail)
                StoreOpenDoor { OSStoreDoor.open { onNavigate(.apps) } }

                if apps.isEmpty {
                    HStack(spacing: 12) {
                        Text("!").font(.splMono(13)).foregroundColor(.amber)
                        Text("No catalog at ~/.relay/catalog.json — is the daemon running? The Store rebuilds it.")
                            .font(.hanken(13)).foregroundColor(.inkSec)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.amber.opacity(0.4), lineWidth: 1))
                    .padding(.top, 16)
                } else {
                    // real category counts — each chip opens the store front (its tabs pre-filter there)
                    OSDoFlowChips(items: storeCats(apps)) { _ in OSStoreDoor.open { onNavigate(.apps) } }
                        .padding(.top, 16)

                    // teasers from the live catalog — every chip launches that real wrapp
                    VStack(spacing: 12) {
                        ForEach(storeTeasers(apps)) { t in
                            StoreTeaserCard(teaser: t) { chip in
                                OSLaunch.launchOr(chip.app) { onNavigate(.apps) }
                            }
                        }
                    }
                    .padding(.top, 16)
                }

                Text("you're shopping, not working — the store opens in its own view · nothing installs without resolving its requirements first")
                    .font(.splMono(11)).foregroundColor(.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 20)
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { apps = doApps() }
            .onReceive(OSPulse.shared.$tick) { _ in apps = doApps() }
    }
}

// ---- the primary "Open the Store" door ----
private struct StoreOpenDoor: View {
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Text("+").font(.splMono(20)).foregroundColor(.lime)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 11).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.edge, lineWidth: 1))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Open the Store").font(.hanken(15, .semibold)).foregroundColor(.ink)
                    Text("the one door to discovery — featured, shelves, and each app's resource profile (weight, egress, model need) shown before you Get.")
                        .font(.hanken(12.5)).foregroundColor(.inkDim)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Text("Open ▸").font(.splMono(12)).foregroundColor(.lime)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.lime.opacity(0.14)))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.lime.opacity(hover ? 0.6 : 0.35), lineWidth: 1))
            }
            .padding(.horizontal, 22).padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(hover ? Color.lime.opacity(0.6) : Color.edge, lineWidth: 1))
            .offset(y: hover ? -1 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// ---- wrapped row of pill chips (categories) ----
private struct OSDoFlowChips: View {
    let items: [String]
    let onTap: (String) -> Void
    private let cols = [GridItem(.adaptive(minimum: 110), spacing: 8, alignment: .leading)]
    var body: some View {
        LazyVGrid(columns: cols, alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { t in CatChip(title: t) { onTap(t) } }
        }
    }
}

private struct CatChip: View {
    let title: String; let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(title).font(.splMono(11)).tracking(0.4)
                .foregroundColor(hover ? .ink : .inkSec)
                .padding(.horizontal, 13).padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .background(Capsule().fill(hover ? Color.panel : Color.raised))
                .overlay(Capsule().stroke(hover ? Color.indigo : Color.edge, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// ---- one teaser card (kicker + chips + description) ----
private struct StoreTeaserCard: View {
    let teaser: StoreTeaser
    let onTapChip: (StoreChip) -> Void
    private let cols = [GridItem(.adaptive(minimum: 90), spacing: 6, alignment: .leading)]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(teaser.kicker.uppercased()).font(.splMono(9.5)).tracking(1.4).foregroundColor(.inkFaint)
            LazyVGrid(columns: cols, alignment: .leading, spacing: 6) {
                ForEach(teaser.items) { it in TeaserChip(chip: it) { onTapChip(it) } }
            }
            Text(teaser.desc).font(.hanken(12)).foregroundColor(.inkDim)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 15).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 13).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.edge, lineWidth: 1))
    }
}

private struct TeaserChip: View {
    let chip: StoreChip; let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(chip.title).font(.hanken(13, .semibold))
                .foregroundColor(hover ? .lime : .ink)
                .padding(.horizontal, 11).padding(.vertical, 5)
                .frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 8).fill(hover ? Color.panel : Color.raised))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(hover ? Color.lime : Color.edge, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
