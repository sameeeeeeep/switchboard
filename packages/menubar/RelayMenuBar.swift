// Switchboard — macOS menu-bar app. The ambient face of the sidekick.
// The ICON is the real Switchboard mark (lime rounded square, page-dark notch): slate when the
// daemon is offline, lime when connected, breathing while your model is actually WORKING (a live
// `claude … stream-json` child under the daemon — the process table knows what no log shows).
// Clicking it opens a designed POPOVER, not a text menu: status, your contexts as marks, the last
// thing that happened, and quiet icon controls. Reads ~/.relay's files directly; no daemon changes.
import AppKit
import SwiftUI
import Darwin
import CoreText

let LABEL = "com.relay.sidekick"
let PORT: UInt16 = 8787
let RELAY_DIR = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
let TOKEN_FILE = (RELAY_DIR as NSString).appendingPathComponent("pairing-token")
let LOG_FILE = (RELAY_DIR as NSString).appendingPathComponent("sidekick.log")
let CONTEXTS_FILE = (RELAY_DIR as NSString).appendingPathComponent("contexts.json")
let SELECTION_FILE = (RELAY_DIR as NSString).appendingPathComponent("context-selection.json")
let GRANTS_FILE = (RELAY_DIR as NSString).appendingPathComponent("grants.json")
let AUDIT_FILE = (RELAY_DIR as NSString).appendingPathComponent("audit.log")
let FAVICON_DIR = (RELAY_DIR as NSString).appendingPathComponent("favicons")
let PLIST = (NSHomeDirectory() as NSString).appendingPathComponent("Library/LaunchAgents/\(LABEL).plist")

// ---------- the bundled daemon + its LaunchAgent ----------
// A packaged Relay.app carries the whole runtime in Resources: a copied node binary plus a
// single-file daemon bundle (and the agent SDK's native claude CLI beside it). The app is then
// the plist's AUTHOR — it writes a LaunchAgent pointing INTO ITS OWN BUNDLE. Three rules keep
// that honest: only on an explicit click (never silently), never over someone else's plist
// (a dev checkout's plist gets a separate confirmed "take over"), and never while Gatekeeper
// has translocated us (the randomized /AppTranslocation path dies on next login).
let BUNDLED_NODE = ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("node")
let BUNDLED_ENTRY = ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("daemon/sidekick.mjs")
func hasBundledDaemon() -> Bool {
    FileManager.default.fileExists(atPath: BUNDLED_NODE) && FileManager.default.fileExists(atPath: BUNDLED_ENTRY)
}
func isTranslocated() -> Bool { Bundle.main.bundlePath.contains("/AppTranslocation/") }

enum PlistState { case missing, ours, staleOurs, foreign }

/// Who owns ~/Library/LaunchAgents/com.relay.sidekick.plist right now?
///   missing   — no plist; a packaged app may create one on the start click
///   ours      — points into THIS bundle and the entry file exists (healthy)
///   staleOurs — points into this bundle but the file is gone (app updated/relaid-out) → repair
///   foreign   — anything else, e.g. a dev checkout's plist (node from nvm + repo dist) → leave it
func plistState(at path: String = PLIST, bundlePath: String = Bundle.main.bundlePath) -> PlistState {
    guard let data = FileManager.default.contents(atPath: path) else { return .missing }
    guard let obj = try? PropertyListSerialization.propertyList(from: data, format: nil),
          let dict = obj as? [String: Any],
          let args = dict["ProgramArguments"] as? [String], args.count >= 2,
          args[1].hasPrefix(bundlePath) else { return .foreign }
    return FileManager.default.fileExists(atPath: args[1]) ? .ours : .staleOurs
}

/// The plist the packaged app installs — same shape the dev installer proved out, but pointing at
/// the bundle's own runtime. PATH is load-bearing: launchd's default PATH is bare, and both the
/// daemon's system-claude fallback (warm sessions) and npx-based stdio MCP servers need real bins.
func writeDaemonPlist(to path: String = PLIST) throws {
    let home = NSHomeDirectory()
    let spec: [String: Any] = [
        "Label": LABEL,
        "ProgramArguments": [BUNDLED_NODE, BUNDLED_ENTRY],
        "RunAtLoad": true,
        "KeepAlive": true,
        "StandardOutPath": LOG_FILE,
        "StandardErrorPath": LOG_FILE,
        "WorkingDirectory": home,
        "EnvironmentVariables": [
            "HOME": home,
            "PATH": "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
            // Point warm sessions and claudeBin() checks at the CLI this bundle SHIPS. Without
            // this the daemon hunted the system PATH for a claude the user may not have, while
            // a perfectly good Anthropic-signed one sat beside sidekick.mjs unused.
            "RELAY_CLAUDE_CLI": ((Bundle.main.resourcePath ?? "") as NSString)
                .appendingPathComponent("daemon/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"),
        ],
    ]
    // launchd opens the log path at spawn — make sure ~/.relay exists (0700, same as the daemon).
    try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true,
                                             attributes: [.posixPermissions: 0o700])
    try FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent,
                                            withIntermediateDirectories: true)
    let data = try PropertyListSerialization.data(fromPropertyList: spec, format: .xml, options: 0)
    try data.write(to: URL(fileURLWithPath: path))
}

// ---------- is the running daemon stale vs the bundle? (the recurring install gotcha) ----------
// Installing a new Switchboard.app does NOT restart the LaunchAgent — launchd keeps the old node
// process (old code in memory) until it's kickstarted. Detect it: if OUR plist is what's running
// and the bundle's daemon file is NEWER than the running process's start time, an update is waiting.
func firstPid(matching pattern: String) -> Int32? {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    p.arguments = ["-f", pattern]
    let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
    try? p.run(); p.waitUntilExit()
    let data = out.fileHandleForReading.readDataToEndOfFile()
    guard let s = String(data: data, encoding: .utf8) else { return nil }
    for line in s.split(separator: "\n") {
        if let pid = Int32(line.trimmingCharacters(in: .whitespaces)) { return pid }
    }
    return nil
}
func processElapsedSeconds(_ pid: Int32) -> Int? {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/ps")
    p.arguments = ["-o", "etimes=", "-p", "\(pid)"]
    let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
    try? p.run(); p.waitUntilExit()
    let data = out.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8).flatMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
}
/// True when a newer daemon is bundled than the one currently resident. Only for OUR plist (a dev
/// checkout's foreign plist is left alone). Runs two short child processes — call it off the main thread.
func daemonUpdateReady() -> Bool {
    guard hasBundledDaemon(), !isTranslocated(), plistState() == .ours else { return false }
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: BUNDLED_ENTRY),
          let mtime = attrs[.modificationDate] as? Date else { return false }
    guard let pid = firstPid(matching: BUNDLED_ENTRY), let etimes = processElapsedSeconds(pid) else { return false }
    let started = Date().addingTimeInterval(-Double(etimes))
    // 5s guard so a fresh restart (mtime ≈ start time) doesn't flicker as "update ready".
    return mtime.timeIntervalSince(started) > 5
}

// ---------- house palette ----------
let LIME_NS = NSColor(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0, alpha: 1)
let PAGE_NS = NSColor(red: 0x0A/255.0, green: 0x0C/255.0, blue: 0x10/255.0, alpha: 1)
let SLATE_NS = NSColor(red: 0x6E/255.0, green: 0x7C/255.0, blue: 0x90/255.0, alpha: 1)
// The house danger colour (--danger #FF2D6E). Rung 4 (STATES.md §4) is the ONE place a red glyph is
// warranted: the daemon runs, everything reads green, but Claude Code isn't signed in on this Mac.
let DANGER_NS = NSColor(red: 0xFF/255.0, green: 0x2D/255.0, blue: 0x6E/255.0, alpha: 1)
extension Color {
    static let page = Color(red: 0x00/255.0, green: 0x00/255.0, blue: 0x00/255.0)   // pure black
    static let rail = Color(red: 0x0A/255.0, green: 0x0A/255.0, blue: 0x0B/255.0)   // the left rail
    static let panel = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)  // neutral card
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)   // neutral hairline
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)  // neutral, no blue
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let danger = Color(red: 0xFF/255.0, green: 0x2D/255.0, blue: 0x6E/255.0)
    static let ok = Color(red: 0x3D/255.0, green: 0xD6/255.0, blue: 0x8C/255.0)   // "connected" green
}

// ---------- house fonts (self-hosted so the panel reads in the brand's type, not the OS default) ----------
// Bricolage Grotesque (display) · Hanken Grotesk (body) · Spline Sans Mono (numbers/kickers) — the same
// stack as the extension + brandbrain. Register any .ttf/.otf shipped in Resources/fonts (packaged) or
// beside the dev binary. Until the files are present, Font.custom falls back to the system font, so the
// panel always renders — drop the three OFL files into packages/menubar/fonts/ and they light up.
func registerBundledFonts() {
    var dirs: [String] = []
    if let rp = Bundle.main.resourcePath { dirs.append((rp as NSString).appendingPathComponent("fonts")) }
    let exeDir = (CommandLine.arguments.first as NSString?)?.deletingLastPathComponent ?? "."
    dirs.append((exeDir as NSString).appendingPathComponent("fonts"))
    for dir in dirs {
        guard let items = try? FileManager.default.contentsOfDirectory(atPath: dir) else { continue }
        for f in items where f.hasSuffix(".ttf") || f.hasSuffix(".otf") {
            CTFontManagerRegisterFontsForURL(URL(fileURLWithPath: (dir as NSString).appendingPathComponent(f)) as CFURL, .process, nil)
        }
    }
}
extension Font {
    static func brico(_ size: CGFloat, _ w: Font.Weight = .semibold) -> Font { .custom("Bricolage Grotesque", size: size).weight(w) }
    static func hanken(_ size: CGFloat, _ w: Font.Weight = .regular) -> Font { .custom("Hanken Grotesk", size: size).weight(w) }
    static func splMono(_ size: CGFloat) -> Font { .custom("Spline Sans Mono", size: size) }
}

// ---------- the status-bar glyph (matches the chip/panel mark) ----------
func glyphImage(running: Bool, working: Bool, signedIn: Bool, phase: Int) -> NSImage {
    let size = NSSize(width: 18, height: 18)
    let img = NSImage(size: size, flipped: false) { rect in
        // Stopped: draw in black and let template rendering recolor it — slate #6E7C90 was
        // near-invisible against a dark menu bar, which is exactly the state a first-run user
        // must find. Running: the lime brand mark — but RED when the daemon is up yet signed out
        // (rung 4), the one state where "on" would be a lie the user pays for on their first action.
        let body = running ? (signedIn ? LIME_NS : DANGER_NS) : NSColor.black
        let alpha: CGFloat = working ? (phase % 2 == 0 ? 1.0 : 0.55) : 1.0
        body.withAlphaComponent(alpha).setFill()
        let r = rect.insetBy(dx: 1.5, dy: 1.5)
        NSBezierPath(roundedRect: r, xRadius: 4.5, yRadius: 4.5).fill()
        let dot = running ? PAGE_NS : NSColor.black
        dot.withAlphaComponent(running ? alpha : 0).setFill()
        let d: CGFloat = 3.6
        NSBezierPath(ovalIn: NSRect(x: r.maxX - d - 3.0, y: r.maxY - d - 3.0, width: d, height: d)).fill()
        return true
    }
    // Template when stopped: macOS renders it in the menu bar's own foreground ink (white on
    // dark, black on light), so the mark is findable in the state where finding it matters most.
    img.isTemplate = !running
    return img
}

// ---------- readers over ~/.relay ----------
struct Ctx: Identifiable { let id: String; let name: String; let kind: String }
struct LastAct { let origin: String; let verb: String; let note: String; let ts: Double }

func readJSON(_ path: String) -> Any? {
    guard let data = FileManager.default.contents(atPath: path) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
}
func readContexts() -> [Ctx] {
    guard let arr = readJSON(CONTEXTS_FILE) as? [[String: Any]] else { return [] }
    return arr.compactMap { c in
        guard let name = c["name"] as? String, let id = c["id"] as? String else { return nil }
        return Ctx(id: id, name: name, kind: (c["kind"] as? String) ?? "context")
    }
}
func readDefaultId() -> String? { (readJSON(SELECTION_FILE) as? [String: String])?["*global*"] }
/// The menubar's half of the context selector: set (or clear, for "unconnected") the GLOBAL default
/// context every app inherits unless it picked its own. Merges into the per-origin selection map so a
/// wrapp's own choice is never clobbered. nil id → run unconnected (no global context).
func writeGlobalContext(_ id: String?) {
    var sel = (readJSON(SELECTION_FILE) as? [String: String]) ?? [:]
    if let id = id { sel["*global*"] = id } else { sel.removeValue(forKey: "*global*") }
    guard let data = try? JSONSerialization.data(withJSONObject: sel, options: [.prettyPrinted]) else { return }
    try? data.write(to: URL(fileURLWithPath: SELECTION_FILE))
}
func readGrantCount() -> Int {
    if let arr = readJSON(GRANTS_FILE) as? [[String: Any]] { return arr.count }
    if let map = readJSON(GRANTS_FILE) as? [String: Any] { return map.count }
    return 0
}

// A connected principal, classified by the SAME prefixes the daemon keys grants on: a real web
// origin (https://…), a TabSidekick principal (tabsidekick@…), or a NATIVE app (native@…).
enum AppKind { case web, native, iphone, tab }
struct AppRow: Identifiable { let id: String; let label: String; let kind: AppKind; let tools: Int; let appId: String?; let lastSeen: Double; let icon: NSImage? }

func classify(_ origin: String) -> (AppKind, String) {
    if origin.hasPrefix("native@") { return (.native, String(origin.dropFirst("native@".count))) }
    if origin.hasPrefix("bridge@") { return (.iphone, String(origin.dropFirst("bridge@".count))) }  // "<device>/<origin>"
    if origin.hasPrefix("tabsidekick@") { return (.tab, String(origin.dropFirst("tabsidekick@".count))) }
    return (.web, hostOf(origin))
}
/** appId → display name, from the daemon's app-tokens file — so a native app shows "Flow", not "ai.thelastprompt.flow". */
func nativeNames() -> [String: String] {
    guard let obj = readJSON((RELAY_DIR as NSString).appendingPathComponent("app-tokens.json")) as? [String: Any],
          let apps = obj["apps"] as? [[String: Any]] else { return [:] }
    var out: [String: String] = [:]
    for a in apps { if let id = a["appId"] as? String { out[id] = (a["name"] as? String) ?? id } }
    return out
}
/** origin → most-recent activity ts, from the audit tail — drives active-first ordering. */
func lastSeenByOrigin() -> [String: Double] {
    guard let data = FileManager.default.contents(atPath: AUDIT_FILE),
          let text = String(data: data.suffix(65_536), encoding: .utf8) else { return [:] }
    var out: [String: Double] = [:]
    for line in text.split(separator: "\n") {
        guard let d = line.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let origin = o["origin"] as? String, let ts = o["ts"] as? Double else { continue }
        if ts > (out[origin] ?? 0) { out[origin] = ts }
    }
    return out
}
func readApps() -> [AppRow] {
    guard let arr = readJSON(GRANTS_FILE) as? [[String: Any]] else { return [] }
    let names = nativeNames(); let seen = lastSeenByOrigin()
    let rows: [AppRow] = arr.compactMap { g in
        guard let origin = g["origin"] as? String else { return nil }
        let (kind, ident) = classify(origin)
        let label: String
        switch kind {
        case .native: label = names[ident] ?? ident
        case .iphone:  label = hostOf(ident.contains("/") ? String(ident.split(separator: "/", maxSplits: 1)[1]) : ident)
        default:       label = ident
        }
        let tools = (g["tools"] as? [[String: Any]])?.count ?? 0
        let bundleId: String? = kind == .native ? ident : nil
        return AppRow(id: origin, label: label, kind: kind, tools: tools, appId: bundleId, lastSeen: seen[origin] ?? 0, icon: bundleId.flatMap(nativeAppIcon))
    }
    // Active-first: most-recently-active first; TabSidekick helpers always last.
    return rows.sorted {
        if ($0.kind == .tab) != ($1.kind == .tab) { return $1.kind == .tab }
        return $0.lastSeen > $1.lastSeen
    }
}
// Native apps that have been REGISTERED (allowed) — read straight from the daemon's app-tokens file.
func readNativeApps() -> [String] {
    guard let obj = readJSON((RELAY_DIR as NSString).appendingPathComponent("app-tokens.json")) as? [String: Any],
          let apps = obj["apps"] as? [[String: Any]] else { return [] }
    return apps.compactMap { $0["appId"] as? String }
}

// ---------- connectors + tools ----------
// The daemon's live tool inventory (connectors it can grant to apps) doesn't live in a file the
// panel can read — the servers are inherited via the claude.ai SDK. So the daemon writes a small
// status.json on each health poll; until it does, this reads empty and the TOOLS section hides.
let STATUS_FILE = (RELAY_DIR as NSString).appendingPathComponent("status.json")
struct Connector: Identifiable { let id: String; let name: String; let tools: Int; let ok: Bool }
func readConnectors() -> [Connector] {
    guard let obj = readJSON(STATUS_FILE) as? [String: Any],
          let arr = obj["connectors"] as? [[String: Any]] else { return [] }
    return arr.compactMap { c in
        guard let name = c["name"] as? String else { return nil }
        return Connector(id: name, name: name, tools: (c["tools"] as? Int) ?? 0, ok: (c["ok"] as? Bool) ?? true)
    }
}
func readToolCount() -> Int {
    if let n = (readJSON(STATUS_FILE) as? [String: Any])?["toolCount"] as? Int { return n }
    return readConnectors().reduce(0) { $0 + $1.tools }
}

// ---------- local models (Ollama — a SEPARATE process the daemon can't see) ----------
// The panel talks to Ollama directly: GET /api/tags for EVERY installed model, GET /api/ps for the
// ones resident right now, POST /api/generate with keep_alive:0 to unload one. ONE unified list:
// loaded models are highlighted (RAM + idle countdown + unload ×), the rest are shown greyed.
struct LocalModel: Identifiable { let id: String; let name: String; let sizeGB: Double; let loaded: Bool; let vramGB: Double; let expiresIn: String }
func ollamaExpiry(_ iso: String?) -> String {
    guard let iso = iso else { return "" }
    let withFrac = ISO8601DateFormatter(); withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = withFrac.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
    let s = max(0, Int(d.timeIntervalSinceNow))
    if s <= 0 { return "" }
    return String(format: "%d:%02d", s / 60, s % 60)
}
@MainActor
final class OllamaMonitor: ObservableObject {
    @Published var models: [LocalModel] = []   // ALL installed, loaded-first
    @Published var reachable = false           // the Ollama server answered at all
    private let base = "http://127.0.0.1:11434"
    var up: Bool { reachable }
    var loadedCount: Int { models.filter { $0.loaded }.count }
    var totalVramGB: Double { (models.reduce(0) { $0 + $1.vramGB } * 10).rounded() / 10 }

    // Merge /api/tags (everything installed) with /api/ps (what's resident) into one list. Two short
    // requests; whichever answers proves the server is up. Loaded models sort to the top.
    func refresh() {
        let group = DispatchGroup()
        var tags: [(String, Double)] = []          // name → on-disk size (GB)
        var ps: [String: (Double, String)] = [:]   // name → (vramGB, idle countdown)
        var sawTags = false, sawPs = false
        group.enter()
        Self.fetchJSON(base + "/api/tags") { j in
            if let j = j { sawTags = true
                for m in (j["models"] as? [[String: Any]] ?? []) {
                    let name = (m["name"] as? String) ?? (m["model"] as? String) ?? "?"
                    let gb = (((m["size"] as? Double) ?? 0) / 1_073_741_824.0 * 10).rounded() / 10
                    tags.append((name, gb))
                }
            }
            group.leave()
        }
        group.enter()
        Self.fetchJSON(base + "/api/ps") { j in
            if let j = j { sawPs = true
                for m in (j["models"] as? [[String: Any]] ?? []) {
                    let name = (m["name"] as? String) ?? (m["model"] as? String) ?? "?"
                    let gb = (((m["size_vram"] as? Double) ?? (m["size"] as? Double) ?? 0) / 1_073_741_824.0 * 10).rounded() / 10
                    ps[name] = (gb, ollamaExpiry(m["expires_at"] as? String))
                }
            }
            group.leave()
        }
        group.notify(queue: .main) {
            var names = tags.map { $0.0 }
            for n in ps.keys where !names.contains(n) { names.append(n); tags.append((n, 0)) }
            let sizeOf = Dictionary(tags, uniquingKeysWith: { a, _ in a })
            var list = names.map { name -> LocalModel in
                let r = ps[name]
                return LocalModel(id: name, name: name, sizeGB: sizeOf[name] ?? 0,
                                  loaded: r != nil, vramGB: r?.0 ?? 0, expiresIn: r?.1 ?? "")
            }
            list.sort { ($0.loaded ? 0 : 1, $0.name) < ($1.loaded ? 0 : 1, $1.name) }
            self.reachable = sawTags || sawPs
            self.models = list
        }
    }

    nonisolated static func fetchJSON(_ urlString: String, _ done: @escaping @Sendable ([String: Any]?) -> Void) {
        guard let url = URL(string: urlString) else { done(nil); return }
        var req = URLRequest(url: url); req.timeoutInterval = 1.2
        URLSession.shared.dataTask(with: req) { data, _, _ in
            done(data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] })
        }.resume()
    }

    func unload(_ name: String) {
        guard let url = URL(string: base + "/api/generate") else { return }
        var req = URLRequest(url: url); req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["model": name, "keep_alive": 0])
        URLSession.shared.dataTask(with: req) { _, _, _ in Task { @MainActor in self.refresh() } }.resume()
    }
}

// ---------- icons: real marks, never monograms ----------
// Web wrapps → their OWN favicon (first-party; we already talk to that origin). Connectors → their
// brand favicon (the brand's own domain). Native apps → the real .app bundle icon. Everything caches
// to ~/.relay/favicons and degrades to an SF Symbol. NEVER a third-party favicon aggregator — the
// only hosts contacted are a wrapp's own origin or a brand's own domain (see CONNECTOR_DOMAINS).

// Curated connector → brand domain, ported from packages/extension/src/icons.ts so the two surfaces
// agree on what "Higgsfield" looks like. Matched against a normalized connector name.
let CONNECTOR_DOMAINS: [String: String] = [
    "higgsfield": "higgsfield.ai", "shopify": "shopify.com", "gmail": "mail.google.com",
    "google": "google.com", "drive": "drive.google.com", "sheets": "sheets.google.com",
    "clickup": "clickup.com", "granola": "granola.ai", "notion": "notion.so",
    "huggingface": "huggingface.co", "facebook": "facebook.com", "meta": "facebook.com",
    "metaads": "facebook.com", "claude": "claude.ai", "claudeai": "claude.ai",
    "anthropic": "claude.ai", "github": "github.com", "figma": "figma.com",
    "canva": "canva.com", "linear": "linear.app", "slack": "slack.com",
]
// A fallback SF Symbol per connector capability — used until (or unless) a favicon loads. Never a
// letter tile. Unknown connectors get a neutral puzzle-piece mark.
let CONNECTOR_SYMBOLS: [String: String] = [
    "gmail": "envelope.fill", "shopify": "bag.fill", "drive": "externaldrive.fill",
    "sheets": "tablecells", "clickup": "checklist", "notion": "doc.text",
    "github": "chevron.left.forwardslash.chevron.right", "figma": "pencil.and.outline",
    "slack": "number", "granola": "calendar", "higgsfield": "sparkles",
    "linear": "square.stack.3d.up.fill", "canva": "paintpalette", "huggingface": "cpu",
    "claude": "sparkle", "web": "globe", "pencil": "pencil.tip.crop.circle",
]
func normalizeConnector(_ raw: String) -> String {
    raw.lowercased().replacingOccurrences(of: "mcp__", with: "").replacingOccurrences(of: "claude_ai_", with: "")
        .filter { $0.isLetter || $0.isNumber }
}
func connectorSymbol(_ name: String) -> String { CONNECTOR_SYMBOLS[normalizeConnector(name)] ?? "puzzlepiece.extension.fill" }
func connectorDomain(_ name: String) -> String? { CONNECTOR_DOMAINS[normalizeConnector(name)] }

// The real .app icon for a native app, resolved from its bundle id (e.g. ai.thelastprompt.flow) with
// NO daemon-side capture needed. nil when the app isn't installed/resolvable → caller shows a symbol.
func nativeAppIcon(_ bundleId: String) -> NSImage? {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { return nil }
    let icon = NSWorkspace.shared.icon(forFile: url.path)
    icon.size = NSSize(width: 32, height: 32)
    return icon
}

@MainActor
final class IconStore: ObservableObject {
    @Published private(set) var cache: [String: NSImage] = [:]
    private var inflight = Set<String>()
    private var failed = Set<String>()   // don't re-hammer a host that has no favicon

    // Kick off a first-party favicon load for `key` from `hosts` (memory → disk → network). Safe to
    // call from .onAppear; mutates published state only after the async fetch, never during a view body.
    func request(key: String, hosts: [String]) {
        if cache[key] != nil || inflight.contains(key) || failed.contains(key) { return }
        if let img = Self.diskImage(key) { cache[key] = img; return }
        if hosts.isEmpty { failed.insert(key); return }
        inflight.insert(key)
        Self.fetch(key: key, hosts: hosts) { img in
            Task { @MainActor in
                self.inflight.remove(key)
                if let img = img { self.cache[key] = img } else { self.failed.insert(key) }
            }
        }
    }

    nonisolated static func diskPath(_ key: String) -> String {
        let safe = key.filter { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }
        return (FAVICON_DIR as NSString).appendingPathComponent(safe + ".png")
    }
    nonisolated static func diskImage(_ key: String) -> NSImage? {
        let p = diskPath(key)
        guard FileManager.default.fileExists(atPath: p), let img = NSImage(contentsOfFile: p) else { return nil }
        return img
    }
    // Try, in order, apple-touch-icon then favicon.ico on each host; first 200-with-image wins, is
    // cached to disk, and handed back. NEVER a third-party favicon service — only the given hosts.
    nonisolated static func fetch(key: String, hosts: [String], done: @escaping @Sendable (NSImage?) -> Void) {
        var urls: [URL] = []
        for h in hosts {
            let b = h.contains("://") ? h : "https://\(h)"
            if let u = URL(string: b + "/apple-touch-icon.png") { urls.append(u) }
            if let u = URL(string: b + "/favicon.ico") { urls.append(u) }
        }
        func attempt(_ i: Int) {
            if i >= urls.count { done(nil); return }
            var req = URLRequest(url: urls[i]); req.timeoutInterval = 2.5
            URLSession.shared.dataTask(with: req) { data, resp, _ in
                if let data = data, (resp as? HTTPURLResponse)?.statusCode == 200,
                   let img = NSImage(data: data), img.size.width > 0 {
                    if let png = pngData(img) {
                        try? FileManager.default.createDirectory(atPath: FAVICON_DIR, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                        try? png.write(to: URL(fileURLWithPath: diskPath(key)))
                    }
                    done(img)
                } else { attempt(i + 1) }
            }.resume()
        }
        attempt(0)
    }
    nonisolated static func pngData(_ img: NSImage) -> Data? {
        guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }
}

// A square icon tile: the cached favicon once it lands, else an SF Symbol on a neutral fill. The load
// is triggered in .onAppear so reading `store.cache[key]` in the body stays a pure read.
struct IconView: View {
    @ObservedObject var store: IconStore
    let key: String
    let hosts: [String]
    let symbol: String
    let tint: Color
    let bg: Color
    let size: CGFloat
    let corner: CGFloat
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: corner).fill(bg)
            if let img = store.cache[key] {
                Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
                    .frame(width: size * 0.72, height: size * 0.72)
                    .clipShape(RoundedRectangle(cornerRadius: max(2, corner * 0.6)))
            } else {
                Image(systemName: symbol).font(.system(size: size * 0.5, weight: .medium)).foregroundColor(tint)
            }
        }
        .frame(width: size, height: size)
        .onAppear { store.request(key: key, hosts: hosts) }
    }
}

func readLastAct() -> LastAct? {
    guard let data = FileManager.default.contents(atPath: AUDIT_FILE),
          let text = String(data: data.suffix(16_384), encoding: .utf8) else { return nil }
    for line in text.split(separator: "\n").reversed() {
        guard let d = line.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let ts = o["ts"] as? Double, let origin = o["origin"] as? String else { continue }
        let what = (o["toolName"] as? String) ?? (o["method"] as? String) ?? ""
        if ["claude_permissions", "claude_capabilities", "claude_context", "claude_storage", ""].contains(what) { continue }
        let verb: String
        if what.contains("__publish") { verb = "published" }
        else if what.contains("__use") { verb = "borrowed" }
        else if what.contains("__get") || what.contains("__set") { verb = "touched storage" }
        else if what == "connect" { verb = "connected" }
        else if what == "consent" { verb = "asked consent" }
        else if what == "claude_complete" { verb = "ran a completion" }
        else if what == "claude_transcribe" { verb = "transcribed audio" }
        else if what == "claude_speak" { verb = "spoke aloud" }
        else if what.hasPrefix("mcp__") { verb = what.components(separatedBy: "__").last ?? "ran a tool" }
        else { verb = what }
        return LastAct(origin: origin, verb: verb, note: (o["note"] as? String) ?? "", ts: ts)
    }
    return nil
}
// Rung 4 (STATES.md §4). The SAME marker the daemon reads — ~/.claude.json → oauthAccount.accountUuid
// — a non-secret, non-prompting file on this machine. Cached 30s (it changes only on sign-in/out).
// Defaults to TRUE and only returns false on a CONFIDENT negative (a readable file that plainly lacks
// the account); a missing/unreadable file stays "signed in" so the menubar never cries wolf — the
// daemon's call-time verdict is the backstop for the expired-token case the marker can't see.
private var signedInCache: (at: Date, val: Bool)? = nil
// One remediation, matching the shared copy the browser surfaces use (protocol SIGNED_OUT_MESSAGE).
let SIGN_IN_HINT = "Claude Code isn\u{2019}t signed in on this Mac — open Terminal, run `claude`, and log in once."
func readSignedIn() -> Bool {
    if let c = signedInCache, Date().timeIntervalSince(c.at) < 30 { return c.val }
    var val = true
    let path = (NSHomeDirectory() as NSString).appendingPathComponent(".claude.json")
    if let obj = readJSON(path) as? [String: Any] {
        if let acct = obj["oauthAccount"] as? [String: Any] {
            val = !((acct["accountUuid"] as? String) ?? "").isEmpty
        } else {
            val = false // ran claude, but no account on file → signed out
        }
    } // missing/unreadable → leave true (unknown; never assert signed-out from absence)
    signedInCache = (Date(), val)
    return val
}
func hostOf(_ origin: String) -> String {
    origin.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
}
func agoText(_ ts: Double) -> String {
    let s = max(0, Date().timeIntervalSince1970 - ts / 1000)
    if s < 60 { return "\(Int(s))s" }
    if s < 3600 { return "\(Int(s / 60))m" }
    if s < 86_400 { return "\(Int(s / 3600))h" }
    return "\(Int(s / 86_400))d"
}

// ---------- observable state ----------
@MainActor
final class Model: ObservableObject {
    @Published var running = false
    @Published var working = false
    /** Rung 4: Claude Code signed in on this Mac. Defaults true; poll() refreshes from the marker. */
    @Published var signedIn = true
    @Published var contexts: [Ctx] = []
    @Published var defaultId: String? = nil
    @Published var apps = 0
    @Published var appList: [AppRow] = []
    @Published var nativeApps: [String] = []
    @Published var connectors: [Connector] = []
    @Published var toolCount = 0
    @Published var last: LastAct? = nil
    @Published var plist: PlistState = plistState()
    @Published var updateAvailable = false
    let bundled = hasBundledDaemon()
    let translocated = isTranslocated()
    var toast: String? = nil { didSet { objectWillChange.send() } }

    func refreshFiles() {
        contexts = readContexts()
        defaultId = readDefaultId()
        appList = readApps()
        apps = appList.count
        nativeApps = readNativeApps()
        connectors = readConnectors()
        toolCount = readToolCount()
        last = readLastAct()
        plist = plistState()
    }
}

// ---------- the popover — the side panel's grammar, not a list ----------
// Hierarchy mirrors the Chrome side panel: top bar (glyph + wordmark + on-dot), ONE hero card for
// the default context (lime stripe, mark tile, name + honest meta), a marks strip for the rest of
// the library, one line of life, quiet controls. Information display = hero + kicker + marks.
// A wrapping HStack (chips flow onto the next line when they run out of width). macOS 13+.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, total: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > maxW, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height); total = max(total, x - spacing)
        }
        return CGSize(width: maxW == .infinity ? total : maxW, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxW = bounds.width
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > maxW, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}

struct Panel: View {
    @ObservedObject var model: Model
    @ObservedObject var ollama: OllamaMonitor
    @ObservedObject var icons: IconStore
    let onToken: () -> Void
    let onLogs: () -> Void
    let onRestart: () -> Void
    let onStop: () -> Void
    let onTakeOver: () -> Void
    let onRepair: () -> Void
    let onQuit: () -> Void
    let onDisconnect: (String) -> Void   // disconnect a native app by appId
    let onUpdate: () -> Void             // restart a stale daemon after an app update
    let onPickContext: (String?) -> Void // set/clear the global default context (nil = unconnected)
    @State private var breathe = false
    @State private var pickerOpen = false

    private var signedOut: Bool { model.running && !model.signedIn }
    private var heroTitle: String { signedOut ? "Sign in" : (model.working ? "Working" : (model.running ? "Idle" : "Offline")) }
    private var heroColor: Color { signedOut ? .danger : (model.working ? .lime : (model.running ? .ink : .inkDim)) }
    private var heroDot: Color { signedOut ? .danger : (model.working ? .lime : .inkFaint) }
    private var momentMeta: String {
        if signedOut { return "" }
        if model.running { return "\(model.apps) app\(model.apps == 1 ? "" : "s") · \(model.contexts.count) context\(model.contexts.count == 1 ? "" : "s")" }
        if model.bundled && model.translocated { return "move Switchboard to /Applications, then reopen" }
        return "the daemon is stopped"
    }

    // the app/site behind an activity line, by its real display name (never a raw principal)
    private func actorName(_ a: LastAct) -> String {
        let (kind, ident) = classify(a.origin)
        if kind == .native { return model.appList.first(where: { $0.appId == ident })?.label ?? ident }
        if kind == .iphone { return hostOf(ident.contains("/") ? String(ident.split(separator: "/", maxSplits: 1)[1]) : ident) }
        return ident
    }

    // ---------- icons ----------
    @ViewBuilder private func appIcon(_ app: AppRow, size: CGFloat) -> some View {
        let corner = size * 0.24
        switch app.kind {
        case .native:
            if let icon = app.icon {
                Image(nsImage: icon).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: corner))
            } else {
                ZStack { RoundedRectangle(cornerRadius: corner).fill(Color.panel)
                    Image(systemName: "app.dashed").font(.system(size: size * 0.5)).foregroundColor(.lime) }.frame(width: size, height: size)
            }
        case .web:
            IconView(store: icons, key: app.id, hosts: [hostOf(app.id)], symbol: "globe", tint: .inkDim, bg: Color.panel, size: size, corner: corner)
        case .iphone:
            IconView(store: icons, key: app.id, hosts: [app.label], symbol: "globe", tint: .inkDim, bg: Color.panel, size: size, corner: corner)
        case .tab:
            ZStack { RoundedRectangle(cornerRadius: corner).fill(Color.raised)
                Image(systemName: "square.on.square.dashed").font(.system(size: size * 0.42)).foregroundColor(.inkFaint) }.frame(width: size, height: size)
        }
    }
    @ViewBuilder private func activityIcon(_ a: LastAct) -> some View {
        if let row = model.appList.first(where: { $0.id == a.origin }) { appIcon(row, size: 20) }
        else { IconView(store: icons, key: a.origin, hosts: [hostOf(a.origin)], symbol: "globe", tint: .inkDim, bg: Color.panel, size: 20, corner: 6) }
    }

    // ---------- LEFT RAIL: identity · the moment · daemon controls ----------
    private var rail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                RoundedRectangle(cornerRadius: 5).fill(Color.lime).frame(width: 17, height: 17)
                    .overlay(Circle().fill(Color.rail).frame(width: 5, height: 5).offset(x: 4.5, y: -4.5))
                    .shadow(color: Color.lime.opacity(0.4), radius: 6)
                Text("Switchboard").font(.brico(15, .bold)).foregroundColor(.ink)
                Spacer(minLength: 0)
                Circle().fill(signedOut ? Color.danger : (model.running ? Color.ok : Color.inkFaint)).frame(width: 6, height: 6)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 11) {
                    Circle().fill(heroDot).frame(width: 9, height: 9)
                        .opacity(model.working ? (breathe ? 1.0 : 0.3) : 1.0)
                        .shadow(color: model.working ? Color.lime.opacity(0.7) : .clear, radius: 6)
                        .animation(model.working ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : .default, value: breathe)
                    Text(heroTitle).font(.brico(model.running ? 26 : 22, .bold)).foregroundColor(heroColor).lineLimit(1).minimumScaleFactor(0.7)
                }
                if signedOut {
                    Text(SIGN_IN_HINT).font(.hanken(11)).foregroundColor(.inkDim).padding(.top, 12).fixedSize(horizontal: false, vertical: true)
                } else if model.running, let a = model.last {
                    HStack(alignment: .top, spacing: 8) {
                        activityIcon(a)
                        (Text(actorName(a)).foregroundColor(.inkDim).fontWeight(.semibold)
                            + Text(" \(a.verb)").foregroundColor(.inkFaint)).font(.hanken(11.5)).lineLimit(2)
                    }.padding(.top, 14)
                    Text("\(agoText(a.ts)) ago").font(.splMono(10)).foregroundColor(.inkFaint).padding(.top, 6).padding(.leading, 28)
                } else {
                    Text(momentMeta).font(.hanken(11)).foregroundColor(.inkDim).padding(.top, 12).fixedSize(horizontal: false, vertical: true)
                }
            }.padding(.top, 30)

            if model.running { contextSelector.padding(.top, 18) }

            Spacer(minLength: 24)

            VStack(alignment: .leading, spacing: 9) {
                if let t = model.toast { Text(t).font(.hanken(10)).foregroundColor(.lime).lineLimit(1) }
                Text("DAEMON").kicker()
                HStack(spacing: 8) {
                    GhostButton(icon: "link", label: "pairing", action: onToken).help("Copy the pairing token")
                    GhostButton(icon: "text.alignleft", label: "logs", action: onLogs).help("Open the daemon log")
                }
                HStack(spacing: 8) {
                    if model.running {
                        GhostButton(icon: "arrow.clockwise", label: nil, action: onRestart).help("Restart the daemon")
                        GhostButton(icon: "stop.fill", label: nil, action: onStop).help("Stop the daemon")
                    } else {
                        GhostButton(icon: "play.fill", label: "start", action: onRestart).help("Start the daemon")
                    }
                    Spacer(minLength: 0)
                    GhostButton(icon: "power", label: nil, action: onQuit).help("Quit this app; the daemon keeps running")
                }
            }
        }
        .padding(18)
        .frame(width: 206, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Color.rail)
    }

    // ---------- context selector: optional, defaults to none; personalises every app at once ----------
    private var currentContext: Ctx? { model.contexts.first { $0.id == model.defaultId } }
    private func kindMark(_ kind: String?) -> some View {
        let sym: String = { switch kind {
            case "brand": return "tag"; case "project": return "folder"; case "data": return "cylinder.split.1x2"
            case "idea": return "lightbulb"; case "personal": return "person"; default: return "circle.dashed" } }()
        return Image(systemName: sym).font(.system(size: 11)).foregroundColor(.inkDim).frame(width: 16)
    }
    private var contextSelector: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("CONTEXT").kicker()
            Button(action: { withAnimation(.easeOut(duration: 0.12)) { pickerOpen.toggle() } }) {
                HStack(spacing: 8) {
                    kindMark(currentContext?.kind)
                    Text(currentContext?.name ?? "No context").font(.hanken(12, .medium))
                        .foregroundColor(currentContext == nil ? .inkDim : .ink).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: pickerOpen ? "chevron.up" : "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundColor(.inkFaint)
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel)
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(currentContext == nil ? Color.edge : Color.lime.opacity(0.4), lineWidth: 1)))
            }.buttonStyle(.plain).focusable(false)
            if pickerOpen {
                VStack(spacing: 0) {
                    contextRow(nil, "No context", nil)   // run unconnected
                    if !model.contexts.isEmpty {
                        Rectangle().fill(Color.edge).frame(height: 1)
                        ScrollView { VStack(spacing: 0) { ForEach(model.contexts) { c in contextRow(c.id, c.name, c.kind) } } }
                            .frame(maxHeight: 156)
                    } else {
                        Text("Bank a brand or project in the store to personalise here.")
                            .font(.hanken(10.5)).foregroundColor(.inkFaint).padding(10).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.raised).overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1)))
            }
        }
    }
    private func contextRow(_ id: String?, _ name: String, _ kind: String?) -> some View {
        let selected = id == model.defaultId
        return Button(action: { onPickContext(id); withAnimation { pickerOpen = false } }) {
            HStack(spacing: 8) {
                kindMark(kind)
                Text(name).font(.hanken(11.5)).foregroundColor(selected ? .lime : .ink).lineLimit(1)
                Spacer(minLength: 4)
                if selected { Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundColor(.lime) }
            }.padding(.horizontal, 10).padding(.vertical, 7).contentShape(Rectangle())
        }.buttonStyle(.plain).focusable(false)
    }

    // ---------- RIGHT CONTENT ----------
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            if model.updateAvailable {
                banner(icon: "arrow.down.circle", tint: .lime, text: "A newer daemon shipped with this app",
                       button: ("arrow.clockwise", "update", onUpdate))
                Rectangle().fill(Color.edge).frame(height: 1)
            } else if model.bundled && !model.translocated && model.plist == .foreign {
                banner(icon: "arrow.triangle.2.circlepath", tint: .inkDim, text: "Daemon managed by a dev install",
                       button: ("arrow.triangle.2.circlepath", "take over", onTakeOver))
                Rectangle().fill(Color.edge).frame(height: 1)
            } else if model.bundled && !model.translocated && model.plist == .staleOurs {
                banner(icon: "wrench.adjustable", tint: .inkDim, text: "Daemon points at a missing install",
                       button: ("wrench.adjustable", "repair", onRepair))
                Rectangle().fill(Color.edge).frame(height: 1)
            }
            if model.running {
                appsRow
                Rectangle().fill(Color.edge).frame(height: 1)
                HStack(alignment: .top, spacing: 0) {
                    modelsColumn.frame(maxWidth: .infinity, alignment: .leading)
                    Rectangle().fill(Color.edge).frame(width: 1)
                    toolsColumn.frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Daemon offline").font(.brico(15, .bold)).foregroundColor(.inkDim)
                    Text("Start it from the rail to see your connected apps, models, and tools.")
                        .font(.hanken(12)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private func banner(icon: String, tint: Color, text: String, button: (String, String, () -> Void)) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundColor(tint)
            Text(text).font(.hanken(11)).foregroundColor(.inkDim).lineLimit(1)
            Spacer()
            GhostButton(icon: button.0, label: button.1, action: button.2)
        }.padding(.horizontal, 18).padding(.vertical, 10).background(tint == .lime ? Color.lime.opacity(0.05) : Color.clear)
    }

    // apps — the real-icon row across the top
    private var appsRow: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 6) { Text("CONNECTED APPS").kicker(); Text("· \(model.apps)").font(.splMono(9.5)).foregroundColor(.inkFaint); Spacer() }
            if model.appList.isEmpty {
                Text("No apps yet — open a wrapp and it'll ask to connect.").font(.hanken(11.5)).foregroundColor(.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) { ForEach(model.appList) { appTile($0) } }.padding(.trailing, 18)
                }
            }
        }.padding(.horizontal, 18).padding(.vertical, 16)
    }
    @ViewBuilder private func platformBadge(_ kind: AppKind) -> some View {
        let sym: String = { switch kind {
            case .web: return "globe"; case .native: return "laptopcomputer"
            case .iphone: return "iphone"; case .tab: return "square.on.square.dashed" } }()
        ZStack {
            Circle().fill(Color.page).overlay(Circle().stroke(Color.edge, lineWidth: 1))
            Image(systemName: sym).font(.system(size: 8, weight: .semibold)).foregroundColor(.inkDim)
        }.frame(width: 15, height: 15)
    }
    private func appTile(_ app: AppRow) -> some View {
        VStack(spacing: 7) {
            ZStack(alignment: .topTrailing) {
                appIcon(app, size: 44).overlay(alignment: .bottomTrailing) { platformBadge(app.kind).offset(x: 4, y: 4) }
                if app.kind == .native, let id = app.appId {
                    Button(action: { onDisconnect(id) }) {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 13))
                            .foregroundColor(.inkFaint).background(Circle().fill(Color.page).frame(width: 11, height: 11))
                    }.buttonStyle(.plain).offset(x: 6, y: -6).help("Disconnect this app")
                }
            }
            Text(app.label).font(.hanken(10.5, .medium)).foregroundColor(app.kind == .tab ? .inkFaint : .inkDim).lineLimit(1).frame(width: 60)
        }.frame(width: 60)
    }

    // models — cloud + local, one accent for the loaded model
    private var modelsColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack { Text("MODELS").kicker(); Spacer()
                if ollama.up && ollama.loadedCount > 0 {
                    Text("\(ollama.loadedCount) loaded · \(String(format: "%.1f GB", ollama.totalVramGB))").font(.splMono(9.5)).foregroundColor(.inkDim)
                }
            }.padding(.bottom, 12)
            HStack(spacing: 8) {
                IconView(store: icons, key: "conn:claude", hosts: ["claude.ai"], symbol: "sparkle",
                         tint: model.signedIn ? .ok : .danger, bg: Color.panel, size: 15, corner: 4)
                Text(model.signedIn ? "CLAUDE CODE" : "CLAUDE CODE · SIGNED OUT").font(.splMono(9)).kerning(0.4)
                    .foregroundColor(model.signedIn ? .inkDim : .danger)
            }.padding(.bottom, 8)
            FlowLayout(spacing: 6) {
                ForEach(["Opus 4.8", "Sonnet", "Haiku"], id: \.self) { t in
                    modelChip(t, live: false, dim: !model.signedIn, mono: false, detail: nil, onUnload: nil)
                }
            }.padding(.bottom, 14)
            HStack(spacing: 8) {
                ZStack { RoundedRectangle(cornerRadius: 4).fill(Color.raised)
                    Image(systemName: "cpu").font(.system(size: 9)).foregroundColor(.inkDim) }.frame(width: 15, height: 15)
                Text(ollama.up ? "OLLAMA" : "OLLAMA · NOT RUNNING").font(.splMono(9)).kerning(0.4).foregroundColor(.inkDim)
            }.padding(.bottom, 8)
            if ollama.up && !ollama.models.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(ollama.models) { m in
                        modelChip(m.name, live: m.loaded, dim: !m.loaded, mono: true,
                                  detail: m.loaded ? (m.expiresIn.isEmpty ? String(format: "%.1fGB", m.vramGB) : m.expiresIn) : (m.sizeGB > 0 ? String(format: "%.1fGB", m.sizeGB) : nil),
                                  onUnload: m.loaded ? { ollama.unload(m.name) } : nil)
                    }
                }
            } else if ollama.up {
                Text("No local models — pull one with `ollama pull`").font(.hanken(10.5)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(18)
    }
    private func modelChip(_ name: String, live: Bool, dim: Bool, mono: Bool, detail: String?, onUnload: (() -> Void)?) -> some View {
        HStack(spacing: 7) {
            if live { Circle().fill(Color.lime).frame(width: 6, height: 6).shadow(color: Color.lime.opacity(0.5), radius: 3) }
            Text(name).font(mono ? .splMono(11) : .hanken(11, .medium)).foregroundColor(dim ? .inkFaint : .ink).lineLimit(1)
            if let d = detail { Text(d).font(.splMono(9)).foregroundColor(.inkFaint) }
            if let u = onUnload {
                Button(action: u) { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundColor(.danger) }
                    .buttonStyle(.plain).help("Unload now, free the memory")
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 9).fill(live ? Color.lime.opacity(0.09) : Color.panel)
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(live ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1)))
        .opacity(dim ? 0.5 : 1)
    }

    // tools — real brand logos, a tidy vertical list
    private var toolsColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack { Text("TOOLS").kicker(); Spacer()
                Text("\(model.toolCount)").font(.splMono(9.5)).foregroundColor(.inkFaint) }.padding(.bottom, 12)
            if model.connectors.isEmpty {
                Text("Warming up…").font(.hanken(11)).foregroundColor(.inkFaint)
            } else {
                VStack(alignment: .leading, spacing: 9) { ForEach(model.connectors) { toolRow($0) } }
            }
        }.padding(18)
    }
    private func toolRow(_ c: Connector) -> some View {
        HStack(spacing: 9) {
            IconView(store: icons, key: "conn:" + normalizeConnector(c.name),
                     hosts: connectorDomain(c.name).map { [$0] } ?? [], symbol: connectorSymbol(c.name),
                     tint: c.ok ? .inkDim : .inkFaint, bg: Color.panel, size: 22, corner: 6)
            Text(c.name).font(.hanken(12)).foregroundColor(c.ok ? .ink : .inkDim).lineLimit(1)
            Spacer(minLength: 6)
            if c.tools > 0 { Text("\(c.tools)").font(.splMono(9)).foregroundColor(.inkFaint) }
        }.opacity(c.ok ? 1 : 0.55)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            rail
            Rectangle().fill(Color.edge).frame(width: 1)
            content
        }
        .frame(width: 620)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.page)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 2, bottomLeadingRadius: 20, bottomTrailingRadius: 20, topTrailingRadius: 2))
        .overlay(UnevenRoundedRectangle(topLeadingRadius: 2, bottomLeadingRadius: 20, bottomTrailingRadius: 20, topTrailingRadius: 2).stroke(Color.edge, lineWidth: 1))
        .ignoresSafeArea()
        .onAppear { breathe = true }
    }
}

extension Text {
    func kicker() -> some View {
        self.font(.splMono(9.5)).kerning(1.4).foregroundColor(.inkFaint)
    }
}

struct GhostButton: View {
    let icon: String
    let label: String?
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 10, weight: .semibold))
                if let l = label { Text(l).font(.hanken(10.5, .medium)).lineLimit(1).fixedSize() }
            }
            .fixedSize() // never let the row compress a control into wrapped/truncated text
            .foregroundColor(hover ? .ink : .inkDim)
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 7).fill(hover ? Color.raised : Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .focusable(false) // click-driven popover — the OS focus ring is noise here
        .onHover { hover = $0 }
    }
}

// ---------- native consent surface ----------
// A NATIVE app's "Allow this app?" belongs HERE — the menu bar, a native surface — not a browser
// side panel. We connect to the daemon as a `surface:"menubar"` client; the daemon routes native
// consent prompts to us. Auto-reconnects (daemon restart, or not paired yet).
final class ConsentClient: NSObject {
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private let port: UInt16
    private let tokenProvider: () -> String?
    private let onPrompt: (String, [String: Any]) -> Void   // (id, body) for consent:native-connect

    init(port: UInt16, tokenProvider: @escaping () -> String?, onPrompt: @escaping (String, [String: Any]) -> Void) {
        self.port = port; self.tokenProvider = tokenProvider; self.onPrompt = onPrompt
        super.init(); connect()
    }
    private func connect() {
        guard let token = tokenProvider() else { retry(); return } // daemon not paired yet
        task = session.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task?.resume(); receive()
        send(["type": "auth", "token": token, "surface": "menubar"])
    }
    private func retry() { DispatchQueue.global().asyncAfter(deadline: .now() + 2) { [weak self] in self?.connect() } }
    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure: self.retry()
            case .success(let msg):
                if case let .string(s) = msg, let d = s.data(using: .utf8),
                   let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                   o["type"] as? String == "prompt", (o["kind"] as? String) == "consent:native-connect",
                   let id = o["id"] as? String {
                    self.onPrompt(id, (o["body"] as? [String: Any]) ?? [:])
                }
                self.receive()
            }
        }
    }
    func reply(_ id: String, _ result: Bool) { send(["type": "reply", "id": id, "result": result]) }
    /** Fire a daemon control action over the same authed socket (e.g. disconnectNativeApp). The panel
     *  re-reads its files right after, so we don't need the reply. */
    func control(_ action: String, _ args: [String: Any]) { send(["type": "control", "id": UUID().uuidString, "action": action, "args": args]) }
    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }
}

// A panel that hangs from the menu bar without the window server nudging it back below the menu bar
// (default windows are constrained to visibleFrame; a notch/top-docked panel must not be).
final class NotchPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

// NSHostingView applies a top safe-area inset when the window sits at the screen top (near the menu
// bar), which pushes the SwiftUI content down and leaves a gap under the flush top edge. Zero it so
// the black panel reaches its own top edge.
final class NoInsetHostingView<V: View>: NSHostingView<V> {
    override var safeAreaInsets: NSEdgeInsets { NSEdgeInsets() }
}

// ---------- app shell ----------
@MainActor
final class RelayController: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var panel: NSPanel!
    private var hosting: NSHostingView<Panel>!
    private var clickMonitor: Any?
    private var timer: Timer?
    private var phase = 0
    private let model = Model()
    private let ollama = OllamaMonitor()
    private let icons = IconStore()
    private var consent: ConsentClient?

    // Native "Allow this app?" dialog — a real macOS alert, from the trusted Switchboard app itself.
    private func showNativeConsent(_ id: String, _ body: [String: Any]) {
        let appId = body["appId"] as? String ?? "an app"
        // The app's OWN display name if it gave one (legible); else, honestly, the last id segment.
        let name = (body["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? (appId.contains(".") ? String(appId.split(separator: ".").last!).capitalized : appId)
        let reason = body["reason"] as? String ?? ""
        let canDo = (body["canDo"] as? [String])?.joined(separator: " · ") ?? "Use your local models and your Claude, through the gate"
        let a = NSAlert()
        a.messageText = "Allow \u{201C}\(name)\u{201D} to connect?"
        a.informativeText = "\(appId) — a native app on this Mac."
            + (reason.isEmpty ? "" : "\n\u{201C}\(reason)\u{201D}")
            + "\n\nCan do: \(canDo)"
            + "\n\nIdentity isn\u{2019}t signature-verified yet — only allow an app you installed yourself."
        a.addButton(withTitle: "Allow")
        a.addButton(withTitle: "Deny")
        // Make it a real, commanding modal: bring the (accessory) app forward, float the alert above
        // every other window, and center it — a system-style "allow this app" moment, not a stray popup.
        NSApp.activate(ignoringOtherApps: true)
        let win = a.window
        win.level = .modalPanel
        win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        win.center()
        win.makeKeyAndOrderFront(nil)
        consent?.reply(id, a.runModal() == .alertFirstButtonReturn)
    }

    // Disconnect an approved native app (the "×"). Confirms first — it's reversible (the app re-asks
    // next time) but still a real revocation. Drops the token + grant via the daemon, then refreshes.
    private func disconnectNativeApp(_ appId: String) {
        let name = nativeNames()[appId] ?? appId
        let a = NSAlert()
        a.messageText = "Disconnect \u{201C}\(name)\u{201D}?"
        a.informativeText = "It loses access now. It'll ask to connect again the next time you use it."
        a.addButton(withTitle: "Disconnect")
        a.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard a.runModal() == .alertFirstButtonReturn else { return }
        consent?.control("disconnectNativeApp", ["appId": appId])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.model.refreshFiles() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        registerBundledFonts()
        NSApp.setActivationPolicy(.accessory)
        // Become the daemon's native consent surface — native apps' "Allow?" prompts show HERE.
        consent = ConsentClient(port: PORT,
            tokenProvider: {
                guard let raw = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8) else { return nil }
                let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : t
            },
            onPrompt: { [weak self] id, body in Task { @MainActor in self?.showNativeConsent(id, body) } })
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = glyphImage(running: false, working: false, signedIn: true, phase: 0)
        statusItem.button?.action = #selector(togglePopover)
        statusItem.button?.target = self

        hosting = NoInsetHostingView(rootView: Panel(
            model: model,
            ollama: ollama,
            icons: icons,
            onToken: { [weak self] in self?.copyToken() },
            onLogs: { NSWorkspace.shared.open(URL(fileURLWithPath: LOG_FILE)) },
            onRestart: { [weak self] in self?.startOrRestart() },
            onStop: { [weak self] in self?.stopDaemon() },
            onTakeOver: { [weak self] in self?.takeOverDaemon() },
            onRepair: { [weak self] in self?.repairDaemon() },
            onQuit: { NSApp.terminate(nil) },
            onDisconnect: { [weak self] appId in self?.disconnectNativeApp(appId) },
            onUpdate: { [weak self] in self?.updateDaemon() },
            onPickContext: { [weak self] id in writeGlobalContext(id); self?.model.refreshFiles() }
        ))
        // A borderless, non-activating panel pinned under the icon — NSPopover kept anchoring into
        // mid-air, and the arrow is noise anyway. The SwiftUI view brings its own rounded corners.
        panel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .popUpMenu   // above the system menu bar, so the panel can overlap it
        panel.collectionBehavior = [.canJoinAllSpaces, .transient]
        panel.contentView = hosting

        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }

        // FIRST RUN: launching the app IS the user's intent to run the daemon it ships — the
        // landing page promises "Launch it once — it prints a pairing token", so keep it. Auto-
        // install only when NO LaunchAgent exists (a dev checkout's plist is never touched here;
        // take-over stays an explicit, confirmed button) and never from a translocated path.
        let firstRun = !FileManager.default.fileExists(atPath: TOKEN_FILE)
        switch plistState() {
        case .missing where hasBundledDaemon() && !isTranslocated():
            installAndStart(verb: "installed")
        case .staleOurs:
            // App was moved/updated since the plist was written — heal without being asked.
            repairDaemon()
        default:
            break
        }
        // …and SHOW the app once. An accessory app's launch is otherwise invisible: no Dock icon,
        // no window — just an 18px mark appearing in a crowded menu bar. Presenting the popover
        // one time teaches where Relay lives and puts the token button on screen. Never again
        // after that (the token file exists on every later launch).
        if firstRun {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
                guard let self, self.panel?.isVisible != true else { return }
                NSApp.activate(ignoringOtherApps: true)
                self.togglePopover()
            }
        }
    }

    @objc private func togglePopover() {
        if panel.isVisible { hidePanel(); return }
        guard let btnWindow = statusItem.button?.window, let screen = btnWindow.screen ?? NSScreen.main else { return }
        model.refreshFiles()
        ollama.refresh()
        let size = hosting.fittingSize
        panel.setContentSize(size)
        let icon = btnWindow.frame
        // right-align the sheet to the icon, clamped inside the screen, 6pt below the menu bar
        // Notch app: hang the panel flush under the menu bar, centred on the notch (screen centre on
        // notched Macs), clamped on-screen. Squared top + rounded bottom → it reads as one black shape
        // growing out of the notch. Fades in as it drops.
        let centreX = screen.frame.midX - size.width / 2
        let x = min(max(centreX, screen.visibleFrame.minX + 8), screen.visibleFrame.maxX - size.width - 8)
        // Flush to the menu bar on ANY Mac (notch or not): icon.minY is the status item window's
        // bottom = the TRUE menu-bar bottom edge (mainMenu.menuBarHeight lies on some displays). The
        // NotchPanel subclass below refuses re-constraining, so the top lands exactly here.
        panel.setFrameTopLeftPoint(NSPoint(x: x, y: screen.frame.maxY))   // top of the menu bar = screen top
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in ctx.duration = 0.18; panel.animator().alphaValue = 1 }
        // transient: any click outside puts it away
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor in self?.hidePanel() }
        }
    }

    private func hidePanel() {
        panel.orderOut(nil)
        if let m = clickMonitor { NSEvent.removeMonitor(m); clickMonitor = nil }
    }

    private func poll() {
        checkReachable { ok in
            self.checkWorking { busy in
                let updateReady = ok ? daemonUpdateReady() : false
                Task { @MainActor in
                    // Rung 4: only meaningful once the daemon is up. When up-but-signed-out, the glyph
                    // goes RED and the tooltip names the one fix — the cliff caught before the first call.
                    let signedIn = ok ? readSignedIn() : true
                    self.model.running = ok
                    self.model.working = ok && busy && signedIn
                    self.model.signedIn = signedIn
                    self.model.updateAvailable = updateReady
                    self.phase += 1
                    self.statusItem.button?.image = glyphImage(running: ok, working: self.model.working, signedIn: signedIn, phase: self.phase)
                    self.statusItem.button?.toolTip = !ok ? "Switchboard — sidekick offline"
                        : !signedIn ? "Switchboard — \(SIGN_IN_HINT)"
                        : (ok && busy) ? "Switchboard — your model is working…" : "Switchboard — connected"
                    if self.panel.isVisible { self.model.refreshFiles(); self.ollama.refresh() }
                }
            }
        }
    }

    private nonisolated func checkReachable(_ completion: @escaping @Sendable (Bool) -> Void) {
        DispatchQueue.global().async {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            if fd < 0 { completion(false); return }
            defer { close(fd) }
            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = PORT.bigEndian
            inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr)
            let rc = withUnsafePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            completion(rc == 0)
        }
    }

    private nonisolated func checkWorking(_ completion: @escaping @Sendable (Bool) -> Void) {
        DispatchQueue.global().async {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
            p.arguments = ["-f", "claude -p --input-format stream-json"]
            p.standardOutput = Pipe(); p.standardError = Pipe()
            try? p.run()
            p.waitUntilExit()
            completion(p.terminationStatus == 0)
        }
    }

    private func copyToken() {
        guard let token = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8) else {
            toast("no token yet — start the sidekick")
            return
        }
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(token.trimmingCharacters(in: .whitespacesAndNewlines), forType: .string)
        toast("token copied")
    }

    private func startOrRestart() {
        let uid = getuid()
        if model.running {
            launchctl(["kickstart", "-k", "gui/\(uid)/\(LABEL)"])
            toast("restarting…")
        } else {
            switch plistState() {
            case .ours, .foreign:
                // A plist exists — start it as-is. Foreign (dev checkout) plists are never
                // rewritten here; taking over is its own explicit, confirmed button.
                launchctl(["bootstrap", "gui/\(uid)", PLIST])
                toast("starting…")
            case .staleOurs:
                repairDaemon()
            case .missing where hasBundledDaemon():
                if isTranslocated() {
                    // Gatekeeper ran us from a randomized path; a plist would die on next login.
                    toast("move Switchboard to /Applications, then reopen it")
                } else {
                    installAndStart(verb: "installed")
                }
            case .missing:
                toast("not installed — npm run daemon:install")
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.poll() }
        model.plist = plistState()
    }

    /// Actually stop the daemon: bootout unloads the job entirely, so KeepAlive cannot respawn
    /// it. The plist stays on disk — the start button bootstraps it again. Before this existed
    /// there was NO way to stop the daemon from any UI; quitting the app just orphaned it.
    private func stopDaemon() {
        launchctl(["bootout", "gui/\(getuid())/\(LABEL)"])
        toast("sidekick stopped")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.poll() }
    }

    /// A newer daemon shipped inside this app bundle but the old one is still resident (launchd
    /// does NOT restart on an app update). kickstart -k kills + relaunches the SAME job, so it
    /// re-reads the bundle's now-newer sidekick.mjs. Paths are unchanged — no plist rewrite needed.
    private func updateDaemon() {
        launchctl(["kickstart", "-k", "gui/\(getuid())/\(LABEL)"])
        toast("updating daemon…")
        model.updateAvailable = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { self.poll() }
    }

    /// Write the bundle-pointing plist and bootstrap it. The one path that creates the LaunchAgent.
    private func installAndStart(verb: String) {
        do {
            try writeDaemonPlist()
            launchctl(["bootstrap", "gui/\(getuid())", PLIST])
            toast("daemon \(verb) — starting…")
        } catch {
            toast("could not write LaunchAgent")
        }
    }

    /// Explicit, confirmed migration off a dev-checkout plist. ~/.relay is untouched: the token,
    /// grants, contexts and audit log all survive byte-for-byte — only the plist changes hands.
    private func takeOverDaemon() {
        guard hasBundledDaemon(), !isTranslocated() else {
            toast(isTranslocated() ? "move Switchboard to /Applications first" : "no bundled daemon in this build")
            return
        }
        hidePanel()
        let alert = NSAlert()
        alert.messageText = "Take over the Switchboard daemon?"
        alert.informativeText = "A Switchboard daemon is already installed from a dev checkout. Take over to run the daemon bundled with this app instead. Your contexts, apps and pairing token in ~/.relay are kept."
        alert.addButton(withTitle: "Take Over")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        launchctl(["bootout", "gui/\(getuid())/\(LABEL)"])
        installAndStart(verb: "taken over")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.poll() }
        model.plist = plistState()
    }

    /// Our plist, but its entry file is gone (app updated or re-laid-out): rewrite + reload.
    /// bootout+bootstrap, not kickstart — launchd caches ProgramArguments at bootstrap time,
    /// so a kickstart would just respawn the dead paths.
    private func repairDaemon() {
        guard hasBundledDaemon(), !isTranslocated() else {
            toast(isTranslocated() ? "move Switchboard to /Applications first" : "no bundled daemon in this build")
            return
        }
        launchctl(["bootout", "gui/\(getuid())/\(LABEL)"])
        installAndStart(verb: "repaired")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.poll() }
        model.plist = plistState()
    }

    private func toast(_ t: String) {
        model.toast = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.model.toast = nil }
    }

    private func launchctl(_ args: [String]) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = args
        try? p.run()
        p.waitUntilExit()
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let controller = RelayController()
    app.delegate = controller
    app.run()
}
