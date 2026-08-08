// OSShellView.swift — the native Switchboard OS shell (the windowed "come back to" desk).
//
// Grounds on docs/OS.md: §2 (the persistent left rail + single-window content swap), §3.1 (Home is the
// canonical landing), and the surface list §3.1–3.13. This is the desk the notch points back to — one
// window, one @State selected surface, the detail pane swaps (never a second window). Home + rail + nav
// are REAL; every surface routes to a real view that reads live ~/.relay data (no stub panes).
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

// A catalog hit for the omni spotlight — a light struct so OmniBar never references RelayMenuBar's SBListing
// (keeps the OS views compilable under the SnapshotOS harness). The host wires OSCatalog.search at launch.
struct OmniApp: Identifiable { let id: String; let name: String; let sub: String }
enum OSCatalog {
    static var search: ((String) -> [OmniApp])? = nil     // (query) → matching apps from the live catalog
}
// Ask-across-your-work seam — the omni's "ask" row routes here (host wires it to God). No-op under previews.
enum OSAsk {
    static var handler: ((String) -> Void)? = nil
    static func ask(_ q: String) { handler?(q) }
}
// The Store door — the OS never rebuilds the store; this opens the REAL native front (StoreFrontView
// via showStore()). Host wires it at launch; under the harness it degrades to the fallback navigation.
enum OSStoreDoor {
    static var handler: (() -> Void)? = nil
    static func open(else fallback: () -> Void) { if let h = handler { h() } else { fallback() } }
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
        case .tasks: return ["Board / List", "Todo", "Done"]
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
struct SpotFile: Identifiable { let id = UUID(); let name: String; let path: String; let folder: String }
struct SBTask: Identifiable { let id = UUID(); let glyph: String; let title: String; let detail: String; let suggested: Bool }
struct SBProject: Identifiable { let id: String; let name: String; let essence: String; let facets: [String]; let progress: Double; var kind: String = "project"; var pending: Int = 0; var updated: String = ""; var updatedMs: Double = 0 }

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
                         kind: kind, pending: 0, updated: updatedMs > 0 ? relAgo(now - updatedMs) : "",
                         updatedMs: updatedMs)
    }
    .sorted { $0.updatedMs > $1.updatedMs }   // recency-first — the command centre leads with what's warm
}
func osActiveId() -> String? { readDefaultId() }
func relAgo(_ ms: Double) -> String {
    let s = ms / 1000
    if s < 3600 { return "\(max(1, Int(s/60)))m" }
    if s < 86400 { return "\(Int(s/3600))h" }
    if s < 86400 * 8 { return "\(Int(s/86400))d" }
    return "\(Int(s/604800))w"
}

// ── LIVE recent work — what you ACTUALLY did, not just what left a file behind.
// Two evidence streams, merged and ordered by true recency:
//   · artifacts — wrapp blobs across ~/.relay/storage/<origin>/*.json (mtime = when it was saved)
//   · sessions  — the audit log (~/.relay/audit.log), the ground truth of every real run: God asks,
//     dictations, wrapp runs that keep no files. Storage mtimes alone made week-old blobs pose as
//     "recent" while yesterday's actual work (no blob) was invisible.
func osRecentWork(limit: Int = 16) -> [SBArtifact] {
    let H = NSHomeDirectory() as NSString
    let base = H.appendingPathComponent(".relay/storage")
    let fm = FileManager.default
    let now = Date().timeIntervalSince1970 * 1000
    // 2b — SCOPE recents to the ACTIVE PROJECT. An artifact belongs to it when: it's in the project's own
    // vault folder, OR its origin's attribution sidecar maps its key → the project, OR (no per-key record)
    // the origin is currently lent to the project. With no active project we fall back to global + sessions.
    let activeId = osActiveId()
    let sel = (readJSON(H.appendingPathComponent(".relay/context-selection.json")) as? [String: String]) ?? [:]
    var activeFolder: String? = nil
    if let id = activeId, let ctxs = readJSON(H.appendingPathComponent(".relay/contexts.json")) as? [[String: Any]],
       let c = ctxs.first(where: { $0["id"] as? String == id }) {
        activeFolder = (c["data"] as? [String: Any])?["folder"] as? String
    }
    var scored: [(SBArtifact, Double)] = []
    func addFile(_ path: String, key: String, app: String) {
        let m = (((try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000
        guard m > 0 else { return }
        let (title, cat, kind) = classifyArtifact(path, key: key)
        scored.append((SBArtifact(title: title, app: app, time: relAgo(now - m), kind: kind, category: cat), m))
    }
    for origin in (try? fm.contentsOfDirectory(atPath: base)) ?? [] {
        let dir = base + "/" + origin
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue,
              let files = try? fm.contentsOfDirectory(atPath: dir) else { continue }
        let app = wrappFromOrigin(origin)
        let attr = (readJSON(dir + "/.attribution.json") as? [String: String]) ?? [:]
        let originLentToActive = (activeId != nil && sel[origin] == activeId)
        for f in files where f.hasSuffix(".json") && f != ".attribution.json" {
            if let id = activeId {                                  // scoped: only THIS project's artifacts
                let pid = attr[f] ?? attr[String(f.dropLast(5))]
                guard pid == id || (pid == nil && originLentToActive) else { continue }
            }
            addFile(dir + "/" + f, key: f, app: app)
        }
    }
    // the active project's own vault folder — its files ARE this project's artifacts
    if let folder = activeFolder, let files = try? fm.contentsOfDirectory(atPath: folder) {
        for f in files where f.hasSuffix(".json") { addFile(folder + "/" + f, key: f, app: "bank") }
    }
    // audit sessions fill in work that left no file — GLOBAL view only (scoped recents = this project's artifacts).
    if activeId == nil {
        for s in osSessions() {
            if scored.contains(where: { $0.0.app == s.app && abs($0.1 - s.endMs) < 3 * 3_600_000 }) { continue }
            scored.append((SBArtifact(title: sessionTitle(s), app: s.app, time: relAgo(now - s.endMs),
                                      kind: "session", category: "session"), s.endMs))
        }
    }
    // strict recency — no category floats above; "recent" must mean recent or the section lies.
    return scored.sorted { $0.1 > $1.1 }.prefix(limit).map { $0.0 }
}

// ── Activity sessions from the audit log. Only WORK events count (runs, dictations, saves, publishes);
// plumbing (permissions/capabilities/context reads) is not work. Events per app are split into sessions
// on a 45-min gap; each app contributes its most recent session so one busy wrapp can't flood the grid.
struct SBSession { let app: String; let endMs: Double; let counts: [String: Int] }

func osSessions(windowDays: Double = 14) -> [SBSession] {
    let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/audit.log")
    guard let fh = FileHandle(forReadingAtPath: path) else { return [] }
    let size = (try? fh.seekToEnd()) ?? 0
    let cap: UInt64 = 2_000_000                      // tail ≈ weeks of an append-only log
    let tailed = size > cap
    try? fh.seek(toOffset: tailed ? size - cap : 0)
    let data = fh.readDataToEndOfFile(); try? fh.close()
    guard let text = String(data: data, encoding: .utf8) else { return [] }
    let minTs = Date().timeIntervalSince1970 * 1000 - windowDays * 86_400_000
    var lines = text.split(separator: "\n"); if tailed, !lines.isEmpty { lines.removeFirst() }   // torn line
    var events: [String: [(ts: Double, verb: String)]] = [:]
    for line in lines {
        guard let d = line.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let ts = (o["ts"] as? NSNumber)?.doubleValue, ts >= minTs,
              let origin = o["origin"] as? String,
              (o["outcome"] as? String) != "denied" else { continue }
        let name = (o["toolName"] as? String) ?? (o["method"] as? String) ?? ""
        guard let verb = workVerb(kind: o["kind"] as? String ?? "", name: name) else { continue }
        let app = wrappFromOrigin(origin)
        guard !app.isEmpty else { continue }
        events[app, default: []].append((ts, verb))
    }
    var out: [SBSession] = []
    for (app, evsUnsorted) in events {
        let evs = evsUnsorted.sorted { $0.ts < $1.ts }
        // walk back from the newest event to the start of its session (gap between neighbours > 45min ends it)
        var i = evs.count - 1
        var counts: [String: Int] = [evs[i].verb: 1]
        while i > 0, evs[i].ts - evs[i - 1].ts <= 45 * 60_000 {
            i -= 1
            counts[evs[i].verb, default: 0] += 1
        }
        out.append(SBSession(app: app, endMs: evs.last!.ts, counts: counts))
    }
    return out
}
// what counts as work, and what to call it on the card
private func workVerb(kind: String, name: String) -> String? {
    if kind == "tool_call" {
        if name.contains("transcribe") { return "dictation" }
        if name.contains("storage__set") { return "save" }
        if name.contains("context__publish") { return "publish" }
        if name.contains("__get") || name.contains("__list") { return nil }   // reads aren't work
        return "run"
    }
    if kind == "request" {
        switch name {
        case "claude_complete", "claude_stream": return "run"
        case "claude_transcribe": return "dictation"
        case "claude_speak": return "reply"
        default: return nil
        }
    }
    return nil
}
private func sessionTitle(_ s: SBSession) -> String {
    let plural = ["run": "runs", "save": "saves", "dictation": "dictations", "publish": "publishes", "reply": "replies"]
    let parts = s.counts.sorted { $0.value > $1.value }.prefix(2)
        .map { "\($0.value) \($0.value == 1 ? $0.key : (plural[$0.key] ?? $0.key))" }
    let t = parts.joined(separator: " · ")
    return t.isEmpty ? "Session" : t.prefix(1).uppercased() + t.dropFirst()
}
// Nothing is dropped — each file is TAGGED: "made" (a real created object — the blob names itself) vs
// "working" (wrapp state/config). The Recent-work section filters on this, defaulting to Made.
func classifyArtifact(_ path: String, key: String) -> (title: String, category: String, kind: String) {
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
// Resolves BOTH origin spellings to a wrapp id: storage-dir form ("https_batch.thelastprompt.ai")
// and audit-log form ("https://batch.thelastprompt.ai", "native@ai.thelastprompt.god", "panel").
// Returns "" for chrome that isn't a wrapp (the panel itself, unknown origins).
func wrappFromOrigin(_ o: String) -> String {
    if o == "panel" || o == "?" || o.isEmpty { return "" }
    var s = o
    if s.hasPrefix("native@") {
        s = String(s.dropFirst(7))
        if s.hasPrefix("widget:") { return String(s.dropFirst(7)) }        // native@widget:adforge
        return s.split(separator: ".").last.map(String.init) ?? s          // ai.thelastprompt.god → god
    }
    if let r = s.range(of: "://") { s = String(s[r.upperBound...]) }        // URL form → host[:port]
    for p in ["https_", "http_", "tabsidekick_", "bridge_"] where s.hasPrefix(p) { s = String(s.dropFirst(p.count)); break }
    if let r = s.range(of: ".thelastprompt.ai") { return String(s[..<r.lowerBound]) }   // subdomain = wrapp id
    if s.contains("5178") { return "brandbrain" }
    if s.contains("5190") { return "os" }
    if s.contains("5188") { return "batch" }                               // local dev ports with a known tenant
    if s.contains("5174") { return "store" }
    if s.contains("sameep.ai") { return "autopilot" }
    if s.contains("github.io") { return "store" }
    return s.split(separator: ".").first.map(String.init) ?? s
}
// ── The bound "vault" folders (from storage-bindings.json) — the search scope for ⌥⌥ file search.
func osVaultFolders() -> [String] {
    let bindingsPath = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/storage-bindings.json")
    var folders = Set<String>()
    if let obj = readJSON(bindingsPath) as? [String: Any] {
        for (_, v) in obj { if let m = v as? [String: Any], let f = m["folder"] as? String, !f.isEmpty { folders.insert(f) } }
    }
    return Array(folders)
}

// ── Query-time file search over the vaults — leverages macOS SPOTLIGHT (mdfind, the prebuilt system index:
// complete + instant, no manual walk/cap). Per folder: mdfind by filename; if Spotlight doesn't index that
// folder (hidden/.noindex), fall back to a small bounded name-walk so a vault is never invisible. Runs off
// the main thread (Process); the caller updates UI on the result.
func vaultSearch(_ query: String, folders: [String], limit: Int = 8) -> [SpotFile] {
    let q = query.trimmingCharacters(in: .whitespaces)
    guard q.count >= 2 else { return [] }
    var out: [SpotFile] = []
    let perFolder = max(3, limit / max(1, folders.count))
    for folder in folders {
        if out.count >= limit { break }
        var hits = mdfindNames(q, in: folder, limit: perFolder)
        if hits.isEmpty { hits = walkNames(q, in: folder, limit: perFolder) }   // Spotlight didn't index it → walk
        let fn = (folder as NSString).lastPathComponent
        for path in hits { out.append(SpotFile(name: (path as NSString).lastPathComponent, path: path, folder: fn)); if out.count >= limit { break } }
    }
    return out
}
private func mdfindNames(_ q: String, in folder: String, limit: Int) -> [String] {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/mdfind")
    p.arguments = ["-onlyin", folder, "-name", q]
    let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
    guard (try? p.run()) != nil else { return [] }
    let data = out.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
    return (String(data: data, encoding: .utf8) ?? "").split(separator: "\n").prefix(limit).map(String.init)
}
private func walkNames(_ q: String, in folder: String, limit: Int) -> [String] {
    let ql = q.lowercased()
    let skip: Set<String> = ["node_modules", ".git", "dist", "build", ".next", ".cache", "Pods", "venv", ".venv", "__pycache__"]
    let fm = FileManager.default; var out: [String] = []; var stack: [(String, Int)] = [(folder, 0)]
    while let (dir, d) = stack.popLast(), out.count < limit {
        guard d <= 5, let items = try? fm.contentsOfDirectory(atPath: dir) else { continue }
        for it in items {
            if it.hasPrefix(".") || skip.contains(it) { continue }
            let pth = dir + "/" + it; var isD: ObjCBool = false
            guard fm.fileExists(atPath: pth, isDirectory: &isD) else { continue }
            if isD.boolValue { stack.append((pth, d + 1)) }
            else if it.lowercased().contains(ql) { out.append(pth); if out.count >= limit { break } }
        }
    }
    return out
}

// ── LIVE pending — genuine "needs attention": connectors that are down (status.json ok:false) + a paused
// global routine loop. Real, actionable; empty when nothing needs the user.
func osPending() -> [SBTask] {
    var out: [SBTask] = []
    let relay = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
    if let st = readJSON(relay + "/status.json") as? [String: Any], let cs = st["connectors"] as? [[String: Any]] {
        for c in cs where (c["ok"] as? Bool) == false {
            if let n = c["name"] as? String {
                out.append(SBTask(glyph: "⚠", title: "Reconnect \(n)", detail: "connector is down — 0 tools", suggested: false))
            }
        }
    }
    // the same real states the Needs-attention inbox derives — the strip and badge never disagree with it
    if readJSON(relay + "/guide-suspended.json") != nil {
        out.append(SBTask(glyph: "▸", title: "Resume the tour", detail: "you left a walkthrough partway", suggested: false))
    }
    if (readJSON(relay + "/routines-control.json") as? [String: Any])?["off"] as? Bool == true {
        out.append(SBTask(glyph: "⏸", title: "Routines are off", detail: "nothing will run on schedule", suggested: false))
    }
    for t in osTasksAll().tasks.filter({ $0.over }).prefix(5) {
        out.append(SBTask(glyph: "☐", title: "Overdue: \(t.title)", detail: t.due.map { "due \($0)" } ?? "", suggested: false))
    }
    return out
}

enum Sample {
    static let project = SBProject(
        id: "indeur", name: "IndEur Club",
        essence: "Indo-European supper club, launching Q4",
        facets: ["brand", "4 logo marks", "palette: Terracotta & Indigo", "updated 20m ago"],
        progress: 0.62)

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
    @State private var homeReload = 0        // bumped on a project switch so Home re-grounds
    init(initial: Surface = .home) { _selected = State(initialValue: initial) }

    var body: some View {
        HStack(spacing: 0) {
            RailView(selected: $selected)
            Divider().overlay(Color.edgeSoft)
            VStack(spacing: 0) {
                OmniBar(selected: $selected, onSwitchProject: { writeGlobalContext($0); homeReload += 1 })
                Group {
                    switch selected {
                    case .home:       HomeDetail(selected: $selected).id(homeReload)
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
    @State private var needsCount = 0     // live inbox size — the badge never disagrees with the surface

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // wordmark
            HStack(spacing: 9) {
                Circle().fill(Color.lime).frame(width: 9, height: 9)
                    .shadow(color: Color.lime.opacity(0.5), radius: 5)
                Text("Switchboard").font(.hanken(14, .semibold)).foregroundColor(.ink)
            }
            .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 14)
            .onAppear { needsCount = osPending().count }

            ForEach(OS_GROUPS) { group in
                Text(group.name.uppercased())
                    .font(.splMono(9.5)).tracking(1.6).foregroundColor(.inkFaint)
                    .padding(.horizontal, 10).padding(.top, 15).padding(.bottom, 5)
                ForEach(group.items) { item in
                    RailItem(surface: item,
                             active: selected == item,
                             badge: item == .needs && needsCount > 0 ? needsCount : nil,
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
// The OS Home's spotlight — one bar that reaches anywhere: projects · apps · files (Spotlight) · recent ·
// surfaces · ask. Results drop as an overlay; ↑↓/↵/esc; leads straight to the thing.
struct OmniBar: View {
    @Binding var selected: Surface
    var onSwitchProject: (String) -> Void

    @State private var query = ""
    @State private var projects: [SBProject] = []
    @State private var recent: [SBArtifact] = []
    @State private var folders: [String] = []
    @State private var disk: [SpotFile] = []
    @State private var sel = 0
    @State private var gen = 0
    @FocusState private var focused: Bool

    private struct Row: Identifiable { let id: String; let kind: String; let label: String; let sub: String; let payload: String; let hue: Double }
    private var q: String { query.trimmingCharacters(in: .whitespaces).lowercased() }

    private var rows: [Row] {
        guard !q.isEmpty else { return [] }
        var out: [Row] = []
        out += projects.filter { $0.name.lowercased().contains(q) }.prefix(5).map { Row(id: "p-" + $0.id, kind: "project", label: $0.name, sub: $0.kind, payload: $0.id, hue: hueForId($0.id)) }
        out += (OSCatalog.search?(q) ?? []).prefix(5).map { Row(id: "a-" + $0.id, kind: "app", label: $0.name, sub: $0.sub, payload: $0.id, hue: hueForId($0.id)) }
        out += disk.prefix(6).map { Row(id: "d-" + $0.path, kind: "file", label: $0.name, sub: $0.folder, payload: $0.path, hue: -1) }
        out += recent.filter { $0.title.lowercased().contains(q) || $0.app.lowercased().contains(q) }.prefix(4).map { Row(id: "r-" + $0.title, kind: "recent", label: $0.title, sub: "\($0.app) · \($0.time)", payload: $0.app, hue: hueForId($0.app)) }
        out += Surface.allCases.filter { $0.title.lowercased().contains(q) }.map { Row(id: "s-" + $0.rawValue, kind: "surface", label: $0.title, sub: "surface", payload: $0.rawValue, hue: -1) }
        out.append(Row(id: "ask", kind: "ask", label: "“\(query.trimmingCharacters(in: .whitespaces))”", sub: "ask across your work", payload: query, hue: -1))
        return out
    }

    private func choose(_ r: Row) {
        switch r.kind {
        case "project":            onSwitchProject(r.payload); selected = .home
        case "app", "recent":      OSLaunch.launch(r.payload)
        case "file":               NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: r.payload)])
        case "surface":            if let s = Surface(rawValue: r.payload) { selected = s }
        case "ask":                OSAsk.ask(query.trimmingCharacters(in: .whitespaces))
        default: break
        }
        query = ""; sel = 0; focused = false
    }

    var body: some View {
        HStack(spacing: 14) {
            field
            Spacer(minLength: 0)
            Text("⚙").font(.system(size: 13)).foregroundColor(.inkDim)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
        }
        .padding(.horizontal, 28).padding(.top, 18).padding(.bottom, 12)
        .zIndex(50)
        .onAppear { projects = osProjects(); recent = osRecentWork(); folders = osVaultFolders() }
        .onChange(of: query) { _, newVal in
            sel = 0; gen += 1; let g = gen
            let qq = newVal.trimmingCharacters(in: .whitespaces)
            guard qq.count >= 2, !folders.isEmpty else { disk = []; return }
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.12) {
                let res = vaultSearch(qq, folders: folders, limit: 8)
                DispatchQueue.main.async { if g == gen { disk = res } }
            }
        }
    }

    private var field: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundColor(.inkFaint)
            TextField("Search projects, apps, files — or ask", text: $query)
                .textFieldStyle(.plain).font(.hanken(12.5)).foregroundColor(.ink).focused($focused)
                .onSubmit { if rows.indices.contains(sel) { choose(rows[sel]) } }
            if !query.isEmpty {
                Button(action: { query = "" }) { Image(systemName: "xmark.circle.fill").font(.system(size: 12)).foregroundColor(.inkFaint) }.buttonStyle(.plain)
            } else {
                Text("⌥⌥").font(.splMono(9)).foregroundColor(.inkFaint)
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.edge, lineWidth: 1))
            }
        }
        .padding(.horizontal, 13).padding(.vertical, 9)
        .frame(maxWidth: 460)
        .background(RoundedRectangle(cornerRadius: 11).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(focused ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1))
        .overlay(alignment: .topLeading) { if !rows.isEmpty && focused { resultsPanel.offset(y: 46) } }
        .onKeyPress(.downArrow) { if !rows.isEmpty { sel = min(sel + 1, rows.count - 1) }; return .handled }
        .onKeyPress(.upArrow) { if !rows.isEmpty { sel = max(sel - 1, 0) }; return .handled }
        .onKeyPress(.escape) { query = ""; focused = false; return .handled }
    }

    private var resultsPanel: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                HStack(spacing: 11) {
                    omniIcon(r).frame(width: 24, height: 24)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(r.label).font(.hanken(12.5, .semibold)).foregroundColor(.ink).lineLimit(1)
                        Text(r.sub).font(.hanken(10.5)).foregroundColor(.inkDim).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Text(actionWord(r.kind)).font(.splMono(9)).foregroundColor(i == sel ? .lime : .inkFaint)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(i == sel ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1))
                }
                .padding(.horizontal, 9).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 8).fill(i == sel ? Color.raised : Color.clear))
                .contentShape(Rectangle())
                .onTapGesture { choose(r) }
                .onHover { if $0 { sel = i } }
            }
        }
        .padding(6)
        .frame(width: 460, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.edge, lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 18, y: 10)
    }

    private func actionWord(_ k: String) -> String {
        switch k { case "project": return "switch"; case "app", "recent": return "open"; case "file": return "reveal"; case "surface": return "go"; default: return "↵" }
    }
    @ViewBuilder private func omniIcon(_ r: Row) -> some View {
        switch r.kind {
        case "project", "recent", "app":
            if r.hue >= 0 { Monogram(name: r.label, hue: r.hue, size: 24) }
            else { RoundedRectangle(cornerRadius: 6).fill(Color.raised).overlay(Image(systemName: "app").font(.system(size: 11)).foregroundColor(.inkDim)) }
        case "file":    RoundedRectangle(cornerRadius: 6).fill(Color.raised).overlay(Image(systemName: "folder").font(.system(size: 10)).foregroundColor(.inkDim))
        case "surface": RoundedRectangle(cornerRadius: 6).fill(Color.raised).overlay(Image(systemName: "rectangle.split.2x1").font(.system(size: 10)).foregroundColor(.inkDim))
        default:        RoundedRectangle(cornerRadius: 6).fill(Color.lime.opacity(0.15)).overlay(Text("✦").font(.splMono(12)).foregroundColor(.lime))
        }
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

    // Real greeting — time-of-day + the name from ~/.relay/profile.json (readUserName). No hardcoded name;
    // when the name is unset we greet by time alone rather than inventing one.
    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Morning" : (h < 17 ? "Afternoon" : "Evening")
        let name = readUserName()
        return name.isEmpty ? part : "\(part), \(name)"
    }

    private func load() { projects = osProjects(); activeId = osActiveId(); recent = osRecentWork(); pending = osPending() }
    private func switchTo(_ id: String) { writeGlobalContext(id); activeId = id }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // greeting — real name (profile.json) + real time-of-day; the command centre spans EVERY project
                (Text(greeting + ". ").foregroundColor(.ink)
                    + Text(projects.isEmpty ? "Open a wrapp to begin." : "\(projects.count) projects · pick up anywhere.").foregroundColor(.inkDim))
                    .font(.brico(28, .bold)).tracking(-0.5)
                    .padding(.top, 6).padding(.bottom, 4)

                if let a = active {
                    SectionHead(kicker: "Jump back in", more: nil)
                    ProjectCard(p: a, big: true, isActive: true) { switchTo(a.id); selected = .bank }
                } else {
                    // First-run: an honest Establish CTA — never a fabricated sample project.
                    VStack(alignment: .leading, spacing: 10) {
                        Text("No project yet").font(.hanken(16, .semibold)).foregroundColor(.ink)
                        Text("A project is a few .md files you own — essence, tasks, notes. Establish one to make this home yours.")
                            .font(.hanken(12.5)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
                        LimeButton(label: "+ Establish a project") { OSLaunch.launchOr("bank", .init(kind: "project")) { selected = .apps } }
                    }
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
                }

                // ACTIVITY leads (live ~/.relay reads, hidden when empty): what needs you, then what you
                // just made — the "pick up where you left off" core. Projects follow as compact rows.
                if !pending.isEmpty { NeedsStrip(items: pending).padding(.top, 16) }
                if !recent.isEmpty {
                    SectionHead(kicker: "Recent work", more: "everything you've made →")
                    RecentWorkGrid(items: recent)
                }
                if !others.isEmpty {
                    SectionHead(kicker: "Recent projects", more: nil)
                    ProjectRows(projects: Array(others.prefix(6))) { switchTo($0) }
                    HStack {
                        Spacer()
                        Text("all \(projects.count) projects →").font(.hanken(12)).foregroundColor(.inkDim)
                            .contentShape(Rectangle()).onTapGesture { selected = .bank }
                        Spacer()
                    }.padding(.top, 10)
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
    // Flat, product-style mark: one deep tint of the project's hue + the initial in Bricolage. No gradients
    // or drop shadows — matches the panel's flat-with-hairline language; the hue itself is the color moment.
    private var fill: Color { Color(hue: hue, saturation: 0.55, brightness: 0.30) }
    private var inkC: Color { Color(hue: hue, saturation: 0.45, brightness: 0.95) }
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.24)
            .fill(fill)
            .frame(width: size, height: size)
            .overlay(Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(.brico(size * 0.46, .bold)).foregroundColor(inkC))
            .overlay(RoundedRectangle(cornerRadius: size * 0.24).stroke(Color.white.opacity(0.10), lineWidth: 1))
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
        HStack(spacing: big ? 16 : 13) {
            Monogram(name: p.name, hue: hueForId(p.id), size: big ? 46 : 36)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(p.name).font(big ? .brico(18, .bold) : .hanken(14, .semibold)).foregroundColor(.ink).lineLimit(1)
                    if isActive {
                        Text("ACTIVE").font(.splMono(8)).tracking(0.9).foregroundColor(.lime)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.lime.opacity(0.35), lineWidth: 1))
                    }
                    if big && hovered { Spacer(minLength: 0); Text("Resume →").font(.hanken(12, .medium)).foregroundColor(.lime) }
                }
                Text(p.essence).font(.hanken(12.5)).foregroundColor(.inkDim).lineLimit(1).padding(.top, 1)
                HStack(spacing: 12) {
                    HStack(spacing: 5) {
                        Circle().fill(tint).frame(width: 4, height: 4)
                        Text(p.kind.uppercased()).font(.splMono(9.5)).tracking(0.6).foregroundColor(tint)
                    }
                    if p.pending > 0 { Text("\(p.pending) PENDING").font(.splMono(9.5)).tracking(0.6).foregroundColor(.amber) }
                    if !p.updated.isEmpty { Text(p.updated.uppercased()).font(.splMono(9.5)).tracking(0.6).foregroundColor(.inkFaint) }
                }.padding(.top, 5)
            }
            Spacer(minLength: 0)
        }
        .padding(big ? 16 : 12)
        .background(RoundedRectangle(cornerRadius: 13).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 13)
            .stroke(isActive || big ? Color.indigo.opacity(0.35) : (hovered ? Color.lime.opacity(0.4) : Color.edge), lineWidth: 1))
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture { onOpen() }
    }
}

// Recent projects as compact ROWS in one edged panel (the product's row grammar — like the menu-bar panel's
// connection rows), not a wall of cards. Hairline separators; tap switches.
struct ProjectRows: View {
    let projects: [SBProject]; let onSwitch: (String) -> Void
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(projects.enumerated()), id: \.element.id) { i, p in
                ProjectRow(p: p) { onSwitch(p.id) }
                if i < projects.count - 1 { Divider().overlay(Color.edgeSoft).padding(.leading, 52) }
            }
        }
        .background(RoundedRectangle(cornerRadius: 13).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 13))
    }
}
struct ProjectRow: View {
    let p: SBProject; let onOpen: () -> Void
    @State private var hovered = false
    private var tint: Color { kindTint(p.kind) }
    var body: some View {
        HStack(spacing: 12) {
            Monogram(name: p.name, hue: hueForId(p.id), size: 28)
            Text(p.name).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
            Text(p.essence).font(.hanken(11.5)).foregroundColor(.inkFaint).lineLimit(1)
            Spacer(minLength: 8)
            if p.pending > 0 { Text("\(p.pending)").font(.splMono(9.5)).foregroundColor(.amber) }
            Circle().fill(tint).frame(width: 4, height: 4)
            Text(p.updated.isEmpty ? p.kind : p.updated).font(.splMono(9.5)).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(hovered ? Color.raised : Color.clear)
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture { onOpen() }
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
    // All (default — strict recency, the honest view) · Made (named blobs) · Activity (state saves + sessions).
    // The old Made-first default let week-old blobs pose as "recent work"; recency truth now leads.
    @State private var filter = "all"
    let cols = [GridItem(.adaptive(minimum: 184), spacing: 14)]

    private var madeCount: Int { items.filter { $0.category == "made" }.count }
    private var activityCount: Int { items.filter { $0.category != "made" }.count }
    private var effective: String { filter }
    private var shown: [SBArtifact] {
        switch effective {
        case "made": return items.filter { $0.category == "made" }
        case "activity": return items.filter { $0.category != "made" }
        default: return items
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 7) {
                chip("all", "All", items.count)
                chip("made", "Made", madeCount)
                chip("activity", "Activity", activityCount)
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
        case "session":
            // an activity pulse — event bars of varying height, reads as "a work session", not a file
            HStack(alignment: .bottom, spacing: 5) {
                ForEach(Array([0.35, 0.7, 0.5, 1.0, 0.6, 0.85].enumerated()), id: \.offset) { _, h in
                    RoundedRectangle(cornerRadius: 2).fill(c.opacity(h == 1.0 ? 1 : 0.55))
                        .frame(width: 7, height: 40 * h)
                }
            }
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

// Real starter apps for the Home dock — read the ACTUAL catalog (~/.relay/catalog.json); connected state
// from grants.json. Never a hardcoded set. Connected apps first, then alphabetical; capped.
func osStarterApps(limit: Int = 10) -> [SBApp] {
    guard let obj = readJSON(doAppsCatalogPath()) as? [String: Any],
          let listings = obj["listings"] as? [[String: Any]] else { return [] }
    var granted = Set<String>()
    if let grants = readJSON((NSHomeDirectory() as NSString).appendingPathComponent(".relay/grants.json")) as? [[String: Any]] {
        for g in grants { if let o = g["origin"] as? String { granted.insert(wrappFromOrigin(o).lowercased()) } }
    }
    let apps: [SBApp] = listings.compactMap { l in
        guard let id = l["id"] as? String, !id.isEmpty else { return nil }
        return SBApp(id: id, name: (l["name"] as? String) ?? id, live: granted.contains(id.lowercased()))
    }
    return Array(apps.sorted { a, b in
        if a.live != b.live { return a.live && !b.live }
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }.prefix(limit))
}

struct AppDock: View {
    @Binding var selected: Surface
    @State private var apps: [SBApp] = []
    let cols = [GridItem(.adaptive(minimum: 96), spacing: 16)]
    var body: some View {
        Group {
            if apps.isEmpty {
                // No catalog yet (fresh install before the daemon writes it) — an honest door, not a fake dock.
                Text("Browse the store →").font(.hanken(12)).foregroundColor(.inkDim)
                    .contentShape(Rectangle()).onTapGesture { selected = .store }
            } else {
                LazyVGrid(columns: cols, spacing: 16) {
                    ForEach(apps) { app in
                        VStack(spacing: 8) {
                            ZStack(alignment: .bottomTrailing) {
                                OSAppGlyph(id: app.id, size: 72)
                                    .background(RoundedRectangle(cornerRadius: 18)
                                        .fill(LinearGradient(colors: [Color(red: 0x15/255, green: 0x16/255, blue: 0x1d/255),
                                                                      Color(red: 0x0d/255, green: 0x0e/255, blue: 0x13/255)],
                                                             startPoint: .topLeading, endPoint: .bottomTrailing)))
                                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.edge, lineWidth: 1))
                                if app.live {   // live = a real standing grant (connected), never a fabricated flag
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
        .onAppear { apps = osStarterApps() }
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
