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

// =====================================================================================================
// MARK: - Apps surface — private model + sample catalog (mirrors apps.js SAMPLE)
// =====================================================================================================

/// A richer app record than the shared `SBApp` (which is just {id,name,live}): carries the category
/// and the pinned / god flags the grouped dock needs. Private so it never collides with `SBApp`.
private struct DoApp: Identifiable {
    let id: String            // also the display name here (matches apps.js, where id == the shown name)
    let cat: String           // "studio" | "tool" | "agent" | "fun"
    let live: Bool            // running right now (lime dot)
    let god: Bool             // a granted hand God can drive (indigo badge)
    let pinned: Bool          // shows in the Pinned group + drives the Home dock order
}

private let DO_APPS: [DoApp] = [
    DoApp(id: "brandbrain", cat: "studio", live: true,  god: true,  pinned: true),
    DoApp(id: "Crest",      cat: "studio", live: true,  god: true,  pinned: true),
    DoApp(id: "ideabrain",  cat: "studio", live: false, god: true,  pinned: false),
    DoApp(id: "Prism",      cat: "tool",   live: false, god: true,  pinned: false),
    DoApp(id: "Bank",       cat: "tool",   live: false, god: true,  pinned: true),
    DoApp(id: "Redline",    cat: "tool",   live: false, god: true,  pinned: true),
    DoApp(id: "AdPulse",    cat: "tool",   live: false, god: false, pinned: false),
    DoApp(id: "God",        cat: "agent",  live: true,  god: false, pinned: true),
    DoApp(id: "Autopilot",  cat: "agent",  live: false, god: true,  pinned: false),
    DoApp(id: "Sidequest",  cat: "fun",    live: false, god: false, pinned: false),
]

/// The category filter segment (All / Studios / Tools / Fun / Agents — matches apps.js `.seg`).
private enum AppFilter: String, CaseIterable, Identifiable {
    case all = "All", studios = "Studios", tools = "Tools", fun = "Fun", agents = "Agents"
    var id: String { rawValue }
}

/// A rendered group of tiles (title + optional note + apps). Non-empty groups only.
private struct AppGroup: Identifiable { let title: String; let note: String?; let apps: [DoApp]; var id: String { title } }

// =====================================================================================================
// MARK: - AppsSurface (the installed-tools dock — real filter, real Store door, no dead ends)
// =====================================================================================================

struct AppsSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var filter: AppFilter = .all

    /// The groups to render for the current filter. All → the four escalation shelves; a specific
    /// filter → just its matching shelf (mirrors apps.js `wire`, which hides the non-matching groups).
    private var groups: [AppGroup] {
        func nonEmpty(_ gs: [AppGroup]) -> [AppGroup] { gs.filter { !$0.apps.isEmpty } }
        switch filter {
        case .all:
            return nonEmpty([
                AppGroup(title: "Pinned", note: "drives the Home dock order", apps: DO_APPS.filter { $0.pinned }),
                AppGroup(title: "Studios", note: nil, apps: DO_APPS.filter { $0.cat == "studio" }),
                AppGroup(title: "Tools & Agents", note: nil, apps: DO_APPS.filter { $0.cat == "tool" || $0.cat == "agent" }),
                AppGroup(title: "Fun", note: nil, apps: DO_APPS.filter { $0.cat == "fun" }),
            ])
        case .studios:
            return nonEmpty([AppGroup(title: "Studios", note: nil, apps: DO_APPS.filter { $0.cat == "studio" })])
        case .tools:
            return nonEmpty([AppGroup(title: "Tools & Agents", note: nil, apps: DO_APPS.filter { $0.cat == "tool" || $0.cat == "agent" })])
        case .agents:
            return nonEmpty([AppGroup(title: "Agents", note: nil, apps: DO_APPS.filter { $0.cat == "agent" })])
        case .fun:
            return nonEmpty([AppGroup(title: "Fun", note: nil, apps: DO_APPS.filter { $0.cat == "fun" })])
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                AppsHead(count: DO_APPS.count, filter: $filter)
                AppsLegend()

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
    }
}

// ---- header: kicker · title · count pill · filter segment ----
private struct AppsHead: View {
    let count: Int
    @Binding var filter: AppFilter
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("APPS").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                Text("Your installed tools").font(.hanken(20, .semibold)).foregroundColor(.ink)
                Text("\(count) installed").font(.splMono(11)).foregroundColor(.inkDim)
                    .padding(.horizontal, 10).padding(.vertical, 2)
                    .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
                Spacer(minLength: 0)
            }
            FilterSegment(filter: $filter)
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

// ---- legend: live now · God can drive · the hint ----
private struct AppsLegend: View {
    var body: some View {
        HStack(spacing: 16) {
            HStack(spacing: 6) {
                Circle().fill(Color.lime).frame(width: 6, height: 6)
                Text("live now").font(.hanken(11)).foregroundColor(.inkDim)
            }
            HStack(spacing: 6) {
                Circle().fill(Color.indigo).frame(width: 6, height: 6)
                Text("God can drive (a granted hand)").font(.hanken(11)).foregroundColor(.inkDim)
            }
            Text("click a tile to launch").font(.hanken(11)).foregroundColor(.inkFaint)
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
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 9) {
                OSAppGlyph(id: app.id, size: 72)
                    .background(RoundedRectangle(cornerRadius: 18)
                        .fill(LinearGradient(colors: [Color(red: 0x15/255, green: 0x16/255, blue: 0x1d/255),
                                                      Color(red: 0x0d/255, green: 0x0e/255, blue: 0x13/255)],
                                             startPoint: .topLeading, endPoint: .bottomTrailing)))
                    .overlay(RoundedRectangle(cornerRadius: 18)
                        .stroke(hover ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1))
                    .overlay(alignment: .topTrailing) {
                        if app.live {
                            Circle().fill(Color.lime).frame(width: 6, height: 6)
                                .shadow(color: Color.lime.opacity(0.6), radius: 3)
                                .padding(9)
                        }
                    }
                    .overlay(alignment: .bottomLeading) {
                        if app.god {
                            HStack(spacing: 3) {
                                Circle().fill(Color.indigo).frame(width: 5, height: 5)
                                Text("God").font(.splMono(8.5)).foregroundColor(.indigo)
                            }
                            .padding(.horizontal, 4).padding(.vertical, 1)
                            .background(Capsule().fill(Color.indigo.opacity(0.14)))
                            .overlay(Capsule().stroke(Color.indigo.opacity(0.35), lineWidth: 1))
                            .padding(8)
                        }
                    }
                Text(app.id).font(.hanken(12.5, .medium)).foregroundColor(.inkSec)
                Text(app.cat).font(.splMono(10)).foregroundColor(.inkFaint)
            }
            .offset(y: hover ? -2 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
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

private struct StoreCat: Identifiable { let title: String; var id: String { title } }
private struct StoreChip: Identifiable { let title: String; let app: String?; var id: String { title } }
private struct StoreTeaser: Identifiable { let kicker: String; let desc: String; let items: [StoreChip]; var id: String { kicker } }

private let STORE_CATS: [StoreCat] = [
    StoreCat(title: "Browse all"), StoreCat(title: "Studios"),
    StoreCat(title: "Skills"), StoreCat(title: "Fun & personal"),
]

private let STORE_TEASERS: [StoreTeaser] = [
    StoreTeaser(kicker: "Featured",
                desc: "Your brand, extracted — voice, palette, positioning.",
                items: [StoreChip(title: "Brandbrain", app: "brandbrain")]),
    StoreTeaser(kicker: "Apps we love",
                desc: "Studios and tools — resource profile shown before Get.",
                items: [StoreChip(title: "Prism", app: "Prism"),
                        StoreChip(title: "Redline", app: "Redline"),
                        StoreChip(title: "ideabrain", app: "ideabrain")]),
    StoreTeaser(kicker: "New skills",
                desc: "Small hands you can give God to drive.",
                items: [StoreChip(title: "Cast", app: nil),
                        StoreChip(title: "Flow", app: "Flow"),
                        StoreChip(title: "Batch", app: nil)]),
]

// =====================================================================================================
// MARK: - StoreSurface (door only — the OS never rebuilds the store; every chip is a real navigation)
// =====================================================================================================

struct StoreSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // head + rule
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("STORE").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                    Text("Get more capability").font(.hanken(20, .semibold)).foregroundColor(.ink)
                    Spacer(minLength: 0)
                }
                .padding(.top, 2)
                Rectangle().fill(Color.edgeSoft).frame(height: 1).padding(.top, 14).padding(.bottom, 20)

                // the primary door — for native this stays in-app (.store); no dead end.
                StoreOpenDoor { onNavigate(.store) }   // TODO open ./index.html external store

                // category chips — each a real door into the store view
                OSDoFlowChips(items: STORE_CATS.map { $0.title }) { _ in onNavigate(.store) }
                    .padding(.top, 16)

                // teasers — each app chip is a live launch (no inert element)
                VStack(spacing: 12) {
                    ForEach(STORE_TEASERS) { t in
                        StoreTeaserCard(teaser: t) { chip in
                            OSLaunch.launchOr(chip.app) { onNavigate(.apps) }   // nil-app chip (unlisted) → the store grid
                        }
                    }
                }
                .padding(.top, 16)

                Text("you're shopping, not working — the store opens in its own view · nothing installs without resolving its requirements first")
                    .font(.splMono(11)).foregroundColor(.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 20)
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
