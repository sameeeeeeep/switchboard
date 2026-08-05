// OSShellView.swift — the native Switchboard OS shell (the windowed "come back to" desk).
//
// Grounds on docs/OS.md: §2 (the persistent left rail + single-window content swap), §3.1 (Home is the
// canonical landing), and the surface list §3.1–3.13. This is the desk the notch points back to — one
// window, one @State selected surface, the detail pane swaps (never a second window). Home + rail + nav
// are REAL; the other 12 surfaces are honest stub panes (title + section kickers + a "building" note) so
// the navigation is real and the skeletons are correct.
//
// Design law (NOTCH-DESIGN / OS.md §3.1): "discipline in the frame, color in the icons." The chrome is
// monochrome graphite (`panel`/`edge`/`ink`), chrome accents are lime (active/CTA) + indigo (local /
// project). The ONLY vibrant color is in the app-dock isometric tiles (one deterministic hue per app id)
// and artifact thumbnails. Reuses the menubar's tokens (Color.page/panel/edge/ink/lime, Font.hanken/
// splMono, DotMatrix as the one loader) — this file only ADDS `indigo`/`inkSec` (kept out of the shared
// token block so RelayMenuBar.swift stays untouched save the open hook).

import AppKit
import SwiftUI

// ---- tokens this surface adds (the rest come from RelayMenuBar.swift's Color/Font extensions) ----
extension Color {
    static let indigo  = Color(red: 0x5B/255.0, green: 0x4F/255.0, blue: 0xE8/255.0) // local / project chrome pull
    static let inkSec  = Color(red: 0xB4/255.0, green: 0xBE/255.0, blue: 0xCE/255.0) // secondary body ink
    static let edgeSoft = Color(red: 0x1A/255.0, green: 0x1D/255.0, blue: 0x25/255.0)
}

// =====================================================================================================
// MARK: - OSLaunch — the real wrapp-launch seam (mirrors the web OS's `url + "#os=" + ctx` contract)
// =====================================================================================================
//
// The OS surfaces are pure SwiftUI with no reference to the AppDelegate. RelayMenuBar installs `handler`
// once at startup (→ resolves an app id to a catalog listing and opens its page, carrying item context
// as `#os=<encoded {artifact,kind,project}>` so the wrapp opens AT the item). Surfaces call
// `OSLaunch.launch(appId, ctx)` at every tile that references a real app. When no handler is installed —
// the SnapshotOS render harness, SwiftUI previews — `isLive` is false and the site falls back to
// in-OS navigation (`.apps`/`.bank`), so a tap is NEVER a dead end and those targets still compile.

/// Item context carried into a launched wrapp (the native twin of the web `data-ctx` JSON).
struct OSLaunchContext {
    var artifact: String? = nil   // the thing the user clicked (a doc/mark/ad title)
    var kind: String? = nil       // its kind (doc/mark/ad/image/text…)
    var project: String? = nil    // the owning project id, when known
    var isEmpty: Bool { artifact == nil && kind == nil && project == nil }
}

enum OSLaunch {
    /// Installed by RelayMenuBar at launch: (appId, context) → open the real wrapp page.
    static var handler: ((String, OSLaunchContext) -> Void)? = nil
    /// True only when a real launcher is wired (the running app), false under SnapshotOS / previews.
    static var isLive: Bool { handler != nil }
    /// Open the wrapp for `appId`, carrying item context. No-op when no handler is installed.
    static func launch(_ appId: String, _ context: OSLaunchContext = .init()) {
        handler?(appId, context)
    }
    /// Launch `appId` when it's non-nil AND a real launcher is wired; otherwise run `fallback`
    /// (in-OS navigation). This is what every tile uses, so a tap is NEVER a dead end — under the
    /// SnapshotOS harness (no handler) it degrades to the same navigation the stubs had.
    static func launchOr(_ appId: String?, _ context: OSLaunchContext = .init(), else fallback: () -> Void) {
        if let id = appId, let h = handler { h(id, context) } else { fallback() }
    }
}

// =====================================================================================================
// MARK: - Deterministic per-app hue (OS.md §3.1 — "one hue each, from the app id")
// =====================================================================================================

/// A STABLE hue for an app id: FNV-1a hash → a fixed point on the wheel, rendered at a fixed vibrant
/// saturation/brightness. Same id → same color forever, no lookup table, so a new wrapp gets a distinct
/// tile the moment it appears. (The web mock hard-codes hues; native derives them so the catalog can
/// grow without a palette edit.)
func hueForId(_ id: String) -> Double {
    var h: UInt64 = 1469598103934665603            // FNV-1a offset basis
    for b in id.lowercased().utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
    return Double(h % 360) / 360.0
}

/// The flat swatch color (chips, source dots) for an id.
func colorForId(_ id: String) -> Color {
    Color(hue: hueForId(id), saturation: 0.60, brightness: 0.82)
}

// =====================================================================================================
// MARK: - The isometric app tile (the one vibrant mark — a stacked iso block, ported from the web mock)
// =====================================================================================================

/// A classic isometric stacked block (base slab + cube on top), three shaded faces, drawn in a SwiftUI
/// `Canvas`. Faithful to os-home.html's `isoTile`: top = full hue, left = 0.68×, right = 0.5× brightness.
/// The hue is deterministic-from-id (see `hueForId`). This is the single spot of color on Home.
struct IsoTile: View {
    let hue: Double
    var animateHint: Bool = false

    func face(_ b: Double, _ s: Double = 0.62) -> Color { Color(hue: hue, saturation: s, brightness: b) }

    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 10.6                 // web: 64px viewbox, S=6.2  →  64/6.2 ≈ 10.3
            let k = 0.866 * s, hh = 0.5 * s
            let cx = size.width / 2, cy = size.height * 0.60
            func p(_ x: Double, _ y: Double, _ z: Double) -> CGPoint {
                CGPoint(x: cx + CGFloat(x - y) * k, y: cy + CGFloat(x + y) * hh - CGFloat(z) * s)
            }
            func poly(_ pts: [(Double, Double, Double)], _ color: Color) {
                var path = Path()
                for (i, t) in pts.enumerated() {
                    let pt = p(t.0, t.1, t.2)
                    if i == 0 { path.move(to: pt) } else { path.addLine(to: pt) }
                }
                path.closeSubpath()
                ctx.fill(path, with: .color(color))
            }
            // one cube: right face (dark), left face (mid), top face (full hue) — painter order matters.
            func box(_ ox: Double, _ oy: Double, _ oz: Double, _ side: Double, _ h: Double) {
                let x0 = ox, x1 = ox + side, y0 = oy, y1 = oy + side, z0 = oz, z1 = oz + h
                poly([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], face(0.42, 0.66)) // right
                poly([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], face(0.58, 0.64)) // left
                poly([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], face(0.82, 0.60)) // top
            }
            box(-2.2, -2.2, 0, 4.4, 1.4)              // base slab
            box(-1.2, -1.2, 1.4, 2.4, 2.4)            // cube on top
        }
        .allowsHitTesting(false)
    }
}

// =====================================================================================================
// MARK: - Surfaces (the 13 rail items, in the four escalation groups of OS.md §2.1)
// =====================================================================================================

enum Surface: String, CaseIterable, Identifiable {
    case home, tasks, calendar, bank                 // WORKSPACE
    case dashboard, needs, routines, workflows       // AUTOMATE
    case history, graph, dictionary                  // KNOWLEDGE
    case apps, store                                 // DO
    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home";          case .tasks: return "Tasks"
        case .calendar: return "Calendar";  case .bank: return "Bank"
        case .dashboard: return "Dashboard"; case .needs: return "Needs attention"
        case .routines: return "Routines";  case .workflows: return "Workflows"
        case .history: return "History";    case .graph: return "Graph"
        case .dictionary: return "Dictionary"; case .apps: return "Apps"
        case .store: return "Store"
        }
    }
    /// A single ASCII glyph in the rail (mono), matching the mock's spare rail marks.
    var glyph: String {
        switch self {
        case .home: return "⌂";      case .tasks: return "✓";     case .calendar: return "▦"
        case .bank: return "▤";      case .dashboard: return "▚"; case .needs: return "!"
        case .routines: return "⟳";  case .workflows: return "⇉"; case .history: return "⟲"
        case .graph: return "⊹";     case .dictionary: return "Aa"; case .apps: return "▥"
        case .store: return "+"
        }
    }
    /// The surface's "one job" (OS.md §3.x) — shown as the stub subtitle so the skeleton is truthful.
    var oneJob: String {
        switch self {
        case .home: return "Ground me in what I'm working on, in one glance."
        case .tasks: return "See and move everything I've committed to, across every project and wrapp, in one board."
        case .calendar: return "Put my tasks, milestones, and history onto a timeline — the shape of my week."
        case .bank: return "Where a project is established, shown, browsed, and edited — the model behind every lens."
        case .dashboard: return "Tell me the status and health of everything, at a glance — is it all okay?"
        case .needs: return "Show me everything waiting on ME, and give me the one action for each."
        case .routines: return "Manage and monitor the things that run without me."
        case .workflows: return "Run and manage my multi-step pipelines — the reusable batch recipes."
        case .history: return "Let me find and reopen anything I did — every God/wrapp run as a receipt."
        case .graph: return "Show how everything connects, so I can navigate by relationship, not just by list."
        case .dictionary: return "Hold what my words mean — so every surface and wrapp speaks my language."
        case .apps: return "Launch, manage, and understand the tools I have."
        case .store: return "Find and add a new capability, honestly."
        }
    }
    /// The section kickers each stub scaffolds (from the per-surface layouts in OS.md §3.x).
    var kickers: [String] {
        switch self {
        case .home: return []
        case .tasks: return ["Board / List", "Todo", "Doing", "Blocked", "Done"]
        case .calendar: return ["Month / Week / Agenda", "Due tasks", "Milestones", "Past runs"]
        case .bank: return ["Establish", "Projects", "Overview", "Tasks", "Brain", "Artifacts", "Capture"]
        case .dashboard: return ["Stat tiles", "Projects", "Routines", "Workflows", "Subsystems"]
        case .needs: return ["Grants to resolve", "Ready results", "Overdue", "Failures"]
        case .routines: return ["Active", "Paused", "Last run", "Next run", "Logs"]
        case .workflows: return ["Pipelines", "Steps", "Runs", "Templates"]
        case .history: return ["Today", "Yesterday", "Filters", "Reopen"]
        case .graph: return ["Canvas", "Filters", "Inspector", "List view"]
        case .dictionary: return ["A–Z index", "Term", "Definition", "Scope", "Source"]
        case .apps: return ["Pinned", "All apps", "Categories", "God can drive"]
        case .store: return ["Featured", "Categories", "Requirements", "Install"]
        }
    }
}

struct RailGroup: Identifiable { let name: String; let items: [Surface]; var id: String { name } }
let OS_GROUPS: [RailGroup] = [
    RailGroup(name: "Workspace", items: [.home, .tasks, .calendar, .bank]),
    RailGroup(name: "Automate",  items: [.dashboard, .needs, .routines, .workflows]),
    RailGroup(name: "Knowledge", items: [.history, .graph, .dictionary]),
    RailGroup(name: "Do",        items: [.apps, .store]),
]

// =====================================================================================================
// MARK: - Sample data (a struct/array so real Bank reads swap in later — OS.md §1.2 read/write contract)
// =====================================================================================================

struct SBApp: Identifiable { let id: String; let name: String; let live: Bool }
struct SBArtifact: Identifiable { let id = UUID(); let title: String; let app: String; let time: String; let kind: String; var category: String = "made" }
struct SBTask: Identifiable { let id = UUID(); let glyph: String; let title: String; let detail: String; let suggested: Bool }
struct SBProject: Identifiable { let id: String; let name: String; let essence: String; let facets: [String]; let progress: Double; var kind: String = "project"; var pending: Int = 0; var updated: String = "" }

// LIVE projects — read the real ~/.relay/contexts.json (the same store the pill + wrapps use), so the
// command centre spans every real project, not a fictional sample. Essence is derived from the context's
// own data (products / positioning / audience) so a card is never blank.
func osProjects() -> [SBProject] {
    guard let arr = readJSON(CONTEXTS_FILE) as? [[String: Any]] else { return [] }
    let now = Date().timeIntervalSince1970 * 1000
    return arr.compactMap { c in
        guard let id = c["id"] as? String, let name = c["name"] as? String else { return nil }
        let kind = (c["kind"] as? String) ?? "context"
        let data = c["data"] as? [String: Any]
        var essence = ""
        if let prods = data?["products"] as? [String], let first = prods.first, !first.isEmpty { essence = first }
        else if let pos = data?["positioning"] as? String, !pos.isEmpty { essence = pos }
        else if let aud = data?["audience"] as? String, !aud.isEmpty { essence = aud }
        if essence.count > 68 { essence = String(essence.prefix(66)) + "…" }
        if essence.isEmpty { essence = kind }
        let updatedMs = (c["updatedAt"] as? NSNumber)?.doubleValue ?? 0
        return SBProject(id: id, name: name, essence: essence, facets: [kind], progress: 0,
                         kind: kind, pending: 0, updated: updatedMs > 0 ? relAgo(now - updatedMs) : "")
    }
}
func osActiveId() -> String? { readDefaultId() }
private func relAgo(_ ms: Double) -> String {
    let s = ms / 1000
    if s < 3600 { return "\(max(1, Int(s/60)))m" }
    if s < 86400 { return "\(Int(s/3600))h" }
    if s < 86400 * 8 { return "\(Int(s/86400))d" }
    return "\(Int(s/604800))w"
}

// ── LIVE recent work — the most-recently-saved wrapp artifacts across ~/.relay/storage/<origin>/*.json.
// Each file is a wrapp's saved blob; mtime = recency, its `name`/`title`/`oneLine` (or a prettified key) is
// the title, the origin resolves to the wrapp. Real activity, no fictional samples.
func osRecentWork(limit: Int = 16) -> [SBArtifact] {
    let base = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/storage")
    let fm = FileManager.default
    guard let origins = try? fm.contentsOfDirectory(atPath: base) else { return [] }
    let now = Date().timeIntervalSince1970 * 1000
    var scored: [(SBArtifact, Double)] = []
    for origin in origins {
        let dir = base + "/" + origin
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue,
              let files = try? fm.contentsOfDirectory(atPath: dir) else { continue }
        let app = wrappFromOrigin(origin)
        for f in files where f.hasSuffix(".json") {
            let path = dir + "/" + f
            let m = (((try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000
            guard m > 0 else { continue }
            let (title, cat, kind) = classifyArtifact(path, key: f)
            scored.append((SBArtifact(title: title, app: app, time: relAgo(now - m), kind: kind, category: cat), m))
        }
    }
    // hierarchy: newest first, but genuine "made" artifacts float above "working" state at the same glance.
    return scored.sorted { a, b in
        if (a.0.category == "made") != (b.0.category == "made") { return a.0.category == "made" }
        return a.1 > b.1
    }.prefix(limit).map { $0.0 }
}
// Nothing is dropped — each file is TAGGED: "made" (a real created object — the blob names itself) vs
// "working" (wrapp state/config). The Recent-work section filters on this, defaulting to Made.
private func classifyArtifact(_ path: String, key: String) -> (title: String, category: String, kind: String) {
    let name = key.hasSuffix(".json") ? String(key.dropLast(5)) : key
    let lower = name.lowercased()
    let stateHints = ["state", "profile", "workspace", "recents", "wallet", "vendors", "bindings", "config", "settings", "session", "prefs", "cache"]
    let looksState = stateHints.contains { lower.hasSuffix($0) || lower == $0 || lower.hasSuffix("-\($0)") }
    if let obj = readJSON(path) as? [String: Any] {
        for k in ["name", "title", "oneLine"] {
            if let v = obj[k] as? String, !v.isEmpty {
                let t = v.count > 60 ? String(v.prefix(58)) + "…" : v
                return (t, looksState ? "working" : "made", "doc")   // has a self-name → a real object
            }
        }
    }
    let pretty = name.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
    let titled = pretty.prefix(1).uppercased() + pretty.dropFirst()
    return (String(titled), looksState ? "working" : "made", looksState ? "text" : "doc")
}
private func wrappFromOrigin(_ o: String) -> String {
    var s = o
    for p in ["https_", "http_", "tabsidekick_", "bridge_", "native_"] where s.hasPrefix(p) { s = String(s.dropFirst(p.count)); break }
    if let r = s.range(of: ".thelastprompt.ai") { return String(s[..<r.lowerBound]) }   // subdomain = wrapp id
    if s.contains("5178") { return "brandbrain" }
    if s.contains("5190") { return "os" }
    return s.split(separator: ".").first.map(String.init) ?? s
}
// ── LIVE pending — genuine "needs attention": connectors that are down (status.json ok:false) + a paused
// global routine loop. Real, actionable; empty when nothing needs the user.
func osPending() -> [SBTask] {
    var out: [SBTask] = []
    let statusPath = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/status.json")
    if let st = readJSON(statusPath) as? [String: Any], let cs = st["connectors"] as? [[String: Any]] {
        for c in cs where (c["ok"] as? Bool) == false {
            if let n = c["name"] as? String {
                out.append(SBTask(glyph: "⚠", title: "Reconnect \(n)", detail: "connector is down — 0 tools", suggested: false))
            }
        }
    }
    return out
}

enum Sample {
    static let project = SBProject(
        id: "indeur", name: "IndEur Club",
        essence: "Indo-European supper club, launching Q4",
        facets: ["brand", "4 logo marks", "palette: Terracotta & Indigo", "updated 20m ago"],
        progress: 0.62)

    static let apps: [SBApp] = [
        .init(id: "brandbrain", name: "brandbrain", live: true),
        .init(id: "crest", name: "Crest", live: true),
        .init(id: "flow", name: "Flow", live: true),
        .init(id: "god", name: "God", live: true),
        .init(id: "adforge", name: "AdForge", live: false),
        .init(id: "ideabrain", name: "ideabrain", live: false),
        .init(id: "prism", name: "Prism", live: false),
        .init(id: "bank", name: "Bank", live: false),
        .init(id: "redline", name: "Redline", live: false),
        .init(id: "adpulse", name: "AdPulse", live: false),
    ]

    static let work: [SBArtifact] = [
        .init(title: "Switch Ligature monogram", app: "crest", time: "20m", kind: "mark"),
        .init(title: "IndEur — 4 marks", app: "crest", time: "22m", kind: "gallery"),
        .init(title: "Launch ad — \"Find your people\"", app: "adforge", time: "1h", kind: "ad"),
        .init(title: "Community meetup — notes", app: "flow", time: "3h", kind: "text"),
        .init(title: "Terracotta beam render", app: "prism", time: "yesterday", kind: "image"),
        .init(title: "IndEur thesis + reach-outs", app: "ideabrain", time: "yesterday", kind: "doc"),
    ]

    static let whatsNext: [SBTask] = [
        .init(glyph: "✦", title: "Render your IndEur mark", detail: "you kept 2 wireframes in Crest — turn one into an image.", suggested: true),
        .init(glyph: "↻", title: "Draft the launch post", detail: "brandbrain has your voice — write the IndEur announce.", suggested: true),
    ]

    // Needs-attention drives the rail badge (§2.1) and the top-of-Home strip when non-empty.
    static let needs: [SBTask] = [
        .init(glyph: "⧗", title: "Q4 palette needs a decision", detail: "brandbrain paused, waiting on your pick.", suggested: false),
        .init(glyph: "✓", title: "Launch ad is ready to review", detail: "AdForge finished — 20m ago.", suggested: false),
    ]
    static var needsCount: Int { needs.count }
}

// =====================================================================================================
// MARK: - The shell (persistent rail + a SINGLE content pane that swaps on selection — OS.md §2.1)
// =====================================================================================================

struct OSShellView: View {
    @State private var selected: Surface     // the one-window nav: rail sets this, detail swaps
    init(initial: Surface = .home) { _selected = State(initialValue: initial) }

    var body: some View {
        HStack(spacing: 0) {
            RailView(selected: $selected)
            Divider().overlay(Color.edgeSoft)
            VStack(spacing: 0) {
                OmniBar()
                Group {
                    switch selected {
                    case .home:       HomeDetail(selected: $selected)
                    case .tasks:      TasksSurface(onNavigate: { selected = $0 })
                    case .calendar:   CalendarSurface(onNavigate: { selected = $0 })
                    case .bank:       BankSurface(onNavigate: { selected = $0 })
                    case .dashboard:  DashboardSurface(onNavigate: { selected = $0 })
                    case .needs:      NeedsSurface(onNavigate: { selected = $0 })
                    case .routines:   RoutinesSurface(onNavigate: { selected = $0 })
                    case .workflows:  WorkflowsSurface(onNavigate: { selected = $0 })
                    case .history:    HistorySurface(onNavigate: { selected = $0 })
                    case .graph:      GraphSurface(onNavigate: { selected = $0 })
                    case .dictionary: DictionarySurface(onNavigate: { selected = $0 })
                    case .apps:       AppsSurface(onNavigate: { selected = $0 })
                    case .store:      StoreSurface(onNavigate: { selected = $0 })
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.page)
        }
        .frame(minWidth: 920, minHeight: 620)
        .background(Color.page)
        .preferredColorScheme(.dark)
    }
}

// ---- the left rail: groups, the 13 items, active highlight (lime), the needs-attention badge ----
struct RailView: View {
    @Binding var selected: Surface

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // wordmark
            HStack(spacing: 9) {
                Circle().fill(Color.lime).frame(width: 9, height: 9)
                    .shadow(color: Color.lime.opacity(0.5), radius: 5)
                Text("Switchboard").font(.hanken(14, .semibold)).foregroundColor(.ink)
            }
            .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 14)

            ForEach(OS_GROUPS) { group in
                Text(group.name.uppercased())
                    .font(.splMono(9.5)).tracking(1.6).foregroundColor(.inkFaint)
                    .padding(.horizontal, 10).padding(.top, 15).padding(.bottom, 5)
                ForEach(group.items) { item in
                    RailItem(surface: item,
                             active: selected == item,
                             badge: item == .needs && Sample.needsCount > 0 ? Sample.needsCount : nil,
                             action: { selected = item })
                }
            }

            Spacer(minLength: 12)
            Divider().overlay(Color.edgeSoft).padding(.horizontal, 8)
            // active-project switcher (foot of rail — the one place it's set, OS.md §2.3). Live: the real
            // active context (falls back to the first project, then the sample name if there are none yet).
            let projs = osProjects()
            let activeProj = projs.first { $0.id == osActiveId() } ?? projs.first
            HStack(spacing: 9) {
                IsoTile(hue: hueForId(activeProj?.id ?? Sample.project.id)).frame(width: 22, height: 22)
                Text(activeProj?.name ?? Sample.project.name).font(.hanken(11, .medium)).foregroundColor(.inkSec).lineLimit(1)
                Spacer(minLength: 0)
                Text("▾").font(.splMono(9)).foregroundColor(.inkFaint)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            HStack(spacing: 11) {
                Text("⚙").font(.splMono(11)).foregroundColor(.inkFaint).frame(width: 18)
                Text("Settings").font(.hanken(11, .medium)).foregroundColor(.inkDim)
            }
            .padding(.horizontal, 10).padding(.bottom, 14)
        }
        .frame(width: 210, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.rail)
    }
}

struct RailItem: View {
    let surface: Surface
    let active: Bool
    var badge: Int? = nil
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 11) {
                // active = 2px lime left bar (OS.md §2.1 rail spec)
                Rectangle().fill(active ? Color.lime : .clear).frame(width: 2, height: 16)
                Text(surface.glyph)
                    .font(.splMono(11))
                    .foregroundColor(active ? .lime : .inkFaint)
                    .frame(width: 18)
                Text(surface.title)
                    .font(.hanken(11.5, active ? .semibold : .medium))
                    .foregroundColor(active ? .ink : .inkDim)
                Spacer(minLength: 0)
                if let b = badge {
                    Text("\(b)")
                        .font(.splMono(9))
                        .foregroundColor(.lime)                 // lime only because Needs is actionable
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Capsule().fill(Color.panel))
                }
            }
            .padding(.trailing, 10).padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 9)
                    .fill(active ? Color.panel : (hover ? Color.raised : .clear))
                    .padding(.leading, 6)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 4)
        .onHover { hover = $0 }
    }
}

// ---- the top omni bar (⌃⌃ search/ask — the universal invoke, OS.md §2.2) ----
struct OmniBar: View {
    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: 9) {
                Text("⌃⌃").font(.splMono(10)).foregroundColor(.inkFaint)
                Text("ask, or search your work").font(.hanken(12)).foregroundColor(.inkFaint)
                Spacer(minLength: 0)
                Text("⌃⌃").font(.splMono(9)).foregroundColor(.inkFaint)
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.edge, lineWidth: 1))
            }
            .padding(.horizontal, 13).padding(.vertical, 8)
            .frame(maxWidth: 440)
            .background(RoundedRectangle(cornerRadius: 11).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.edge, lineWidth: 1))
            Spacer(minLength: 0)
            Text("⚙").font(.system(size: 13)).foregroundColor(.inkDim)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
        }
        .padding(.horizontal, 28).padding(.top, 18).padding(.bottom, 12)
    }
}

// =====================================================================================================
// MARK: - Home (the real detail — hero · needs strip · recent work · app dock · what's next)
// =====================================================================================================

struct HomeDetail: View {
    @Binding var selected: Surface
    @State private var projects: [SBProject] = []
    @State private var activeId: String? = nil
    @State private var recent: [SBArtifact] = []
    @State private var pending: [SBTask] = []

    private var active: SBProject? { projects.first { $0.id == activeId } ?? projects.first }
    private var others: [SBProject] { projects.filter { $0.id != active?.id } }

    private func load() { projects = osProjects(); activeId = osActiveId(); recent = osRecentWork(); pending = osPending() }
    private func switchTo(_ id: String) { writeGlobalContext(id); activeId = id }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // greeting — the command centre spans EVERY project
                (Text("Evening, Sameep. ").foregroundColor(.ink)
                    + Text(projects.isEmpty ? "Here's where you left off." : "\(projects.count) projects · pick up anywhere.").foregroundColor(.inkDim))
                    .font(.brico(28, .bold)).tracking(-0.5)
                    .padding(.top, 6).padding(.bottom, 4)

                if let a = active {
                    SectionHead(kicker: "Jump back in", more: nil)
                    ProjectCard(p: a, big: true, isActive: true) { switchTo(a.id); selected = .bank }
                    if !others.isEmpty {
                        SectionHead(kicker: "Projects", more: "manage →")
                        ProjectsGrid(projects: others) { switchTo($0) }
                    }
                } else {
                    ActiveProjectCard()   // fallback (no contexts yet) — the sample card
                }

                // LIVE needs-attention + recent work (real ~/.relay reads); each hidden when empty so the
                // command centre never shows fictional filler.
                if !pending.isEmpty { NeedsStrip(items: pending).padding(.top, 16) }
                if !recent.isEmpty {
                    SectionHead(kicker: "Recent work", more: "everything you've made →")
                    RecentWorkGrid(items: recent)
                }

                SectionHead(kicker: "Your apps", more: "get more →")
                AppDock(selected: $selected)

                Text("the home you come back to · every surface in the rail is a lens on your Bank · chrome stays lime + indigo, apps go vibrant")
                    .font(.splMono(10)).foregroundColor(.inkFaint)
                    .padding(.top, 34)
            }
            .padding(.horizontal, 28).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear(perform: load)
    }
}

// A branded per-project MONOGRAM — the initial in Bricolage on a two-stop tint of the project's own hue.
// Reads as a crafted mark, not a generic cube.
struct Monogram: View {
    let name: String; let hue: Double; var size: CGFloat = 40
    private var top: Color { Color(hue: hue, saturation: 0.60, brightness: 0.84) }
    private var bot: Color { Color(hue: hue, saturation: 0.72, brightness: 0.34) }
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.3)
            .fill(LinearGradient(colors: [top, bot], startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: size, height: size)
            .overlay(Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(.brico(size * 0.46, .bold)).foregroundColor(.white)
                .shadow(color: .black.opacity(0.3), radius: 1, y: 1))
            .overlay(RoundedRectangle(cornerRadius: size * 0.3).stroke(Color.white.opacity(0.16), lineWidth: 1))
            .shadow(color: .black.opacity(0.35), radius: 4, y: 2)
    }
}

func kindTint(_ k: String) -> Color { k == "brand" ? .lime : (k == "idea" ? .amber : .indigo) }

// A project as a card — branded monogram + name + essence + kind/pending/updated. Click switches the
// active project (writeGlobalContext). `big` = the "jump back in" hero variant.
struct ProjectCard: View {
    let p: SBProject; var big = false; var isActive = false; let onOpen: () -> Void
    @State private var hovered = false
    private var tint: Color { kindTint(p.kind) }
    var body: some View {
        HStack(spacing: big ? 18 : 14) {
            Monogram(name: p.name, hue: hueForId(p.id), size: big ? 52 : 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(p.name).font(big ? .brico(20, .bold) : .hanken(14.5, .semibold)).foregroundColor(.ink).lineLimit(1)
                    if isActive {
                        Text("ACTIVE").font(.splMono(8)).tracking(0.9).foregroundColor(.lime)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(RoundedRectangle(cornerRadius: 5).fill(Color.lime.opacity(0.08)))
                            .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.lime.opacity(0.35), lineWidth: 1))
                    }
                }
                Text(p.essence).font(.hanken(big ? 13.5 : 12.5)).foregroundColor(big ? .inkSec : .inkDim).lineLimit(1).padding(.top, big ? 4 : 2)
                HStack(spacing: 12) {
                    HStack(spacing: 5) {
                        Circle().fill(tint).frame(width: 5, height: 5)
                        Text(p.kind.uppercased()).font(.splMono(10)).tracking(0.6).foregroundColor(tint)
                    }
                    if p.pending > 0 { Text("\(p.pending) PENDING").font(.splMono(10)).tracking(0.6).foregroundColor(.amber) }
                    if !p.updated.isEmpty { Text(p.updated.uppercased()).font(.splMono(10)).tracking(0.6).foregroundColor(.inkFaint) }
                    if big && hovered { Spacer(minLength: 0); Text("Resume →").font(.hanken(12, .medium)).foregroundColor(.lime) }
                }.padding(.top, 8)
            }
            Spacer(minLength: 0)
        }
        .padding(big ? 20 : 15)
        .background(RoundedRectangle(cornerRadius: big ? 20 : 16)
            .fill(LinearGradient(colors: big ? [Color(red: 0x18/255, green: 0x15/255, blue: 0x28/255), Color(red: 0x12/255, green: 0x12/255, blue: 0x18/255)]
                                              : [Color(red: 0x14/255, green: 0x18/255, blue: 0x21/255), Color(red: 0x10/255, green: 0x13/255, blue: 0x1a/255)],
                                 startPoint: .top, endPoint: .bottom)))
        .overlay(RoundedRectangle(cornerRadius: big ? 20 : 16)
            .stroke(isActive || big ? Color.indigo.opacity(hovered ? 0.6 : 0.32) : (hovered ? Color.lime.opacity(0.45) : Color.edgeSoft), lineWidth: 1))
        .shadow(color: .black.opacity(hovered ? 0.4 : 0.25), radius: hovered ? 12 : 6, y: hovered ? 5 : 3)
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture { onOpen() }
    }
}

struct ProjectsGrid: View {
    let projects: [SBProject]; let onSwitch: (String) -> Void
    let cols = [GridItem(.adaptive(minimum: 240), spacing: 12)]
    var body: some View {
        LazyVGrid(columns: cols, spacing: 12) {
            ForEach(projects) { p in ProjectCard(p: p, big: false, isActive: false) { onSwitch(p.id) } }
        }
    }
}

struct SectionHead: View {
    let kicker: String; let more: String?
    var body: some View {
        HStack(spacing: 14) {
            Text(kicker.uppercased()).font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
            Rectangle().fill(LinearGradient(colors: [Color.edgeSoft, .clear], startPoint: .leading, endPoint: .trailing)).frame(height: 1)
            if let m = more { Text(m).font(.hanken(12)).foregroundColor(.inkDim) }
        }
        .padding(.top, 34).padding(.bottom, 15)
    }
}

struct ActiveProjectCard: View {
    let p = Sample.project
    var body: some View {
        HStack(spacing: 16) {
            IsoTile(hue: hueForId(p.id))
                .frame(width: 46, height: 46)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color(red: 0x1b/255, green: 0x1a/255, blue: 0x2e/255)))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.indigo.opacity(0.4), lineWidth: 1))
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(p.name).font(.hanken(16, .semibold)).foregroundColor(.ink)
                    Text(p.essence).font(.hanken(12)).foregroundColor(.inkDim)
                }
                // progress + facet chips
                HStack(spacing: 8) {
                    ProgressBar(value: p.progress).frame(width: 96, height: 6)
                    Text("\(Int(p.progress * 100))%").font(.splMono(9)).foregroundColor(.inkFaint)
                    ForEach(p.facets.prefix(3), id: \.self) { f in
                        Text(f).font(.hanken(11)).foregroundColor(.inkDim)
                            .padding(.horizontal, 9).padding(.vertical, 2)
                            .background(Capsule().fill(Color.panel))
                            .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
                    }
                }
            }
            Spacer(minLength: 0)
            Text("Switch project ▾").font(.hanken(12)).foregroundColor(.indigo)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.indigo.opacity(0.14)))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.indigo.opacity(0.35), lineWidth: 1))
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
        .overlay(RoundedRectangle(cornerRadius: 16).fill(.clear)
            .overlay(HStack { Rectangle().fill(Color.indigo).frame(width: 2); Spacer() })
            .clipShape(RoundedRectangle(cornerRadius: 16)))
    }
}

struct ProgressBar: View {
    let value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.raised)
                Capsule().fill(Color.lime).frame(width: g.size.width * value)
            }
        }
    }
}

// the top-of-Home action inbox (Needs attention lives everywhere, OS.md §2.1) — LIVE items from osPending()
struct NeedsStrip: View {
    let items: [SBTask]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("!").font(.splMono(10)).foregroundColor(.amber)
                Text("\(items.count) \(items.count == 1 ? "thing needs" : "things need") you").font(.hanken(12, .semibold)).foregroundColor(.ink)
                Spacer()
                Text("open Needs attention →").font(.hanken(11)).foregroundColor(.inkDim)
            }
            ForEach(items) { n in
                HStack(spacing: 10) {
                    Text(n.glyph).font(.splMono(11)).foregroundColor(.amber).frame(width: 16)
                    Text(n.title).font(.hanken(12, .medium)).foregroundColor(.inkSec)
                    Text(n.detail).font(.hanken(11)).foregroundColor(.inkFaint).lineLimit(1)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 13).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.amber.opacity(0.28), lineWidth: 1))
    }
}

struct RecentWorkGrid: View {
    let items: [SBArtifact]
    @State private var filter = "made"     // Made (default) · Working · All — noise is one tap away, never gone
    let cols = [GridItem(.adaptive(minimum: 184), spacing: 14)]

    private var madeCount: Int { items.filter { $0.category == "made" }.count }
    private var workingCount: Int { items.filter { $0.category == "working" }.count }
    // default to Made, but if there are no made items fall back to All so the section is never empty-looking
    private var effective: String { (filter == "made" && madeCount == 0) ? "all" : filter }
    private var shown: [SBArtifact] { effective == "all" ? items : items.filter { $0.category == effective } }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 7) {
                chip("made", "Made", madeCount)
                chip("working", "Working", workingCount)
                chip("all", "All", items.count)
                Spacer(minLength: 0)
            }
            LazyVGrid(columns: cols, spacing: 14) {
                ForEach(shown) { w in ArtifactCard(art: w) }
            }
        }
    }

    private func chip(_ id: String, _ label: String, _ count: Int) -> some View {
        let on = effective == id
        return Button(action: { filter = id }) {
            HStack(spacing: 6) {
                Text(label).font(.hanken(11.5, on ? .semibold : .medium))
                Text("\(count)").font(.splMono(9.5)).foregroundColor(on ? .page.opacity(0.7) : .inkFaint)
            }
            .foregroundColor(on ? .page : .inkDim)
            .padding(.horizontal, 11).padding(.vertical, 5)
            .background(Capsule().fill(on ? Color.lime : Color.panel))
            .overlay(Capsule().stroke(on ? Color.clear : Color.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .opacity(count == 0 ? 0.45 : 1)
        .disabled(count == 0)
    }
}

struct ArtifactCard: View {
    let art: SBArtifact
    var hue: Double { hueForId(art.app) }
    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                LinearGradient(colors: [Color(red: 0x10/255, green: 0x12/255, blue: 0x18/255),
                                        Color(red: 0x0b/255, green: 0x0c/255, blue: 0x11/255)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                ArtifactThumb(kind: art.kind, hue: hue)
            }
            .frame(height: 104)
            .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
            VStack(alignment: .leading, spacing: 7) {
                Text(art.title).font(.hanken(13, .medium)).foregroundColor(.ink).lineLimit(2)
                HStack(spacing: 6) {
                    OSAppGlyph(id: art.app, size: 14)   // the real app icon (iso-tile fallback), not a flat swatch
                    Text(art.app).font(.splMono(10)).foregroundColor(.inkFaint)
                    Spacer(minLength: 0)
                    Text(art.time).font(.splMono(10)).foregroundColor(.inkFaint)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// result-shape-aware thumbnails (image/mark · gallery · ad · doc/text) — "content color", like a preview
struct ArtifactThumb: View {
    let kind: String; let hue: Double
    var c: Color { Color(hue: hue, saturation: 0.6, brightness: 0.82) }
    var body: some View {
        switch kind {
        case "mark":
            // a logo lockup: vibrant tile + a filled mark block (reads as real art, not a hollow placeholder)
            RoundedRectangle(cornerRadius: 12)
                .fill(LinearGradient(colors: [c, Color(hue: hue, saturation: 0.7, brightness: 0.38)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 56, height: 56)
                .overlay(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.92)).frame(width: 24, height: 24)
                    .overlay(RoundedRectangle(cornerRadius: 4).fill(c).frame(width: 10, height: 10)))
        case "image":
            // a "render": layered diagonal tones with a horizon, so it looks like a generated image
            RoundedRectangle(cornerRadius: 12)
                .fill(LinearGradient(colors: [Color(hue: hue, saturation: 0.65, brightness: 0.9),
                                              Color(hue: hue, saturation: 0.55, brightness: 0.5),
                                              Color(red: 0x0d/255, green: 0x0e/255, blue: 0x13/255)],
                                     startPoint: .top, endPoint: .bottom))
                .frame(width: 78, height: 56)
                .overlay(Circle().fill(Color.white.opacity(0.85)).frame(width: 12, height: 12)
                    .offset(x: 18, y: -10))
                .clipShape(RoundedRectangle(cornerRadius: 12))
        case "gallery":
            LazyVGrid(columns: [GridItem(.fixed(22), spacing: 4), GridItem(.fixed(22), spacing: 4)], spacing: 4) {
                ForEach(0..<4, id: \.self) { _ in RoundedRectangle(cornerRadius: 5).fill(c.opacity(0.85)).frame(width: 22, height: 22) }
            }.frame(width: 48)
        case "ad":
            RoundedRectangle(cornerRadius: 8).fill(c.opacity(0.9)).frame(width: 78, height: 56)
                .overlay(VStack(alignment: .leading, spacing: 4) {
                    Spacer()
                    RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.85)).frame(width: 54, height: 5)
                    RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.6)).frame(width: 34, height: 4)
                }.padding(6), alignment: .bottomLeading)
        default: // doc / text
            VStack(alignment: .leading, spacing: 5) {
                ForEach([0.8, 0.6, 0.9, 0.5, 0.7], id: \.self) { w in
                    RoundedRectangle(cornerRadius: 2).fill(w == 0.9 ? c : Color(red: 0x3a/255, green: 0x3f/255, blue: 0x4b/255))
                        .frame(width: 40 * w, height: 3)
                }
            }
            .padding(9).frame(width: 56, height: 60)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color(red: 0x0f/255, green: 0x11/255, blue: 0x16/255)))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.edge, lineWidth: 1))
        }
    }
}

// An app glyph: the real bundled icon (Resources/icons/<id>.png, via storeIcon) when present,
// else the deterministic iso tile. Keeps native app tiles at parity with the web OS.
struct OSAppGlyph: View {
    let id: String
    var size: CGFloat = 72
    var body: some View {
        if let img = storeIcon(id.lowercased()) {
            Image(nsImage: img).resizable().interpolation(.high)
                .aspectRatio(contentMode: .fill)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.25))
        } else {
            IsoTile(hue: hueForId(id)).frame(width: size, height: size)
        }
    }
}

struct AppDock: View {
    @Binding var selected: Surface
    let cols = [GridItem(.adaptive(minimum: 96), spacing: 16)]
    var body: some View {
        LazyVGrid(columns: cols, spacing: 16) {
            ForEach(Sample.apps) { app in
                VStack(spacing: 8) {
                    ZStack(alignment: .bottomTrailing) {
                        OSAppGlyph(id: app.id, size: 72)
                            .background(RoundedRectangle(cornerRadius: 18)
                                .fill(LinearGradient(colors: [Color(red: 0x15/255, green: 0x16/255, blue: 0x1d/255),
                                                              Color(red: 0x0d/255, green: 0x0e/255, blue: 0x13/255)],
                                                     startPoint: .topLeading, endPoint: .bottomTrailing)))
                            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.edge, lineWidth: 1))
                        if app.live {
                            Circle().fill(Color.lime).frame(width: 6, height: 6)
                                .shadow(color: Color.lime.opacity(0.6), radius: 3)
                                .padding(9)
                        }
                    }
                    Text(app.name).font(.hanken(12)).foregroundColor(.inkSec)
                }
            }
        }
    }
}

struct WhatsNext: View {
    var body: some View {
        // one row per suggestion; a flow layout via a simple VStack of side-by-side pairs
        VStack(spacing: 12) {
            ForEach(Sample.whatsNext) { t in
                HStack(spacing: 12) {
                    Text(t.glyph).font(.splMono(13))
                        .foregroundColor(.lime).frame(width: 32, height: 32)
                        .background(RoundedRectangle(cornerRadius: 9).fill(Color(red: 0x20/255, green: 0x26/255, blue: 0x0c/255)))
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.lime.opacity(0.3), lineWidth: 1))
                    (Text(t.title + " ").font(.hanken(13, .medium)).foregroundColor(.ink)
                        + Text("— " + t.detail).font(.hanken(13)).foregroundColor(.inkSec))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if t.suggested {
                        Text("suggested").font(.splMono(9)).foregroundColor(.inkFaint)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 13).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.edge, lineWidth: 1))
            }
        }
    }
}

// =====================================================================================================
// MARK: - Stub detail (the other 12 surfaces — real nav, correct skeleton, honest "building" note)
// =====================================================================================================

struct StubDetail: View {
    let surface: Surface
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    Text(surface.glyph).font(.splMono(15)).foregroundColor(.lime)
                    Text(surface.title.uppercased()).font(.splMono(13)).tracking(2).foregroundColor(.inkFaint)
                    Text("· \(Sample.project.name)").font(.splMono(11)).foregroundColor(.inkFaint)
                }
                Text(surface.oneJob)
                    .font(.hanken(18, .medium)).foregroundColor(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)

                // the section kickers this surface will scaffold — the skeleton is correct now
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(surface.kickers, id: \.self) { k in
                        HStack(spacing: 12) {
                            Text(k.uppercased()).font(.splMono(10)).tracking(1.4).foregroundColor(.inkDim)
                                .frame(width: 150, alignment: .leading)
                            DotMatrix(pattern: .thinking, accent: .inkFaint, cols: 22, rows: 2, dot: 2, gap: 3, animated: false)
                                .frame(height: 12)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 10).padding(.horizontal, 14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 11).fill(Color.panel))
                        .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.edge, lineWidth: 1))
                    }
                }
                .padding(.top, 26)

                HStack(spacing: 8) {
                    DotMatrix(pattern: .working, accent: .lime, cols: 5, rows: 5, dot: 2, gap: 2.4)
                        .frame(width: 34, height: 34)
                    Text("Building — this lens is scaffolded; Home + the rail are live.")
                        .font(.hanken(12)).foregroundColor(.inkDim)
                }
                .padding(.top, 28)
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// =====================================================================================================
// MARK: - Window host (the single OS window — lazily created, shown from the status menu)
// =====================================================================================================

/// Hosts `OSShellView` in one standard resizable dark window. Single-window by construction: nav swaps
/// the detail pane in-place (OSShellView's `@State selected`), never a second window. `shared.show()` is
/// the open hook the status menu calls.
@MainActor
final class OSShellWindowController: NSObject, NSWindowDelegate {
    static let shared = OSShellWindowController()
    private var window: NSWindow?

    func show(_ initial: Surface? = nil) {
        if window == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                             backing: .buffered, defer: false)
            w.title = "Switchboard OS"
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.isMovableByWindowBackground = true
            w.backgroundColor = NSColor.black
            w.isReleasedWhenClosed = false
            w.minSize = NSSize(width: 920, height: 620)
            w.contentView = NSHostingView(rootView: OSShellView(initial: initial ?? .home))
            w.center()
            w.delegate = self
            window = w
        } else if let initial {
            // already open → swap to the requested surface (spotlight "go to")
            window?.contentView = NSHostingView(rootView: OSShellView(initial: initial))
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
