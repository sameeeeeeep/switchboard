// Switchboard — macOS menu-bar app. The ambient face of the sidekick.
// The ICON is the real Switchboard mark (lime rounded square, page-dark notch): slate when the
// daemon is offline, lime when connected, breathing while your model is actually WORKING (a live
// `claude … stream-json` child under the daemon — the process table knows what no log shows).
// Clicking it opens a designed POPOVER, not a text menu: status, your contexts as marks, the last
// thing that happened, and quiet icon controls. Reads ~/.relay's files directly; no daemon changes.
import AppKit
import SwiftUI
import Darwin

let LABEL = "com.relay.sidekick"
let PORT: UInt16 = 8787
let RELAY_DIR = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
let TOKEN_FILE = (RELAY_DIR as NSString).appendingPathComponent("pairing-token")
let LOG_FILE = (RELAY_DIR as NSString).appendingPathComponent("sidekick.log")
let CONTEXTS_FILE = (RELAY_DIR as NSString).appendingPathComponent("contexts.json")
let SELECTION_FILE = (RELAY_DIR as NSString).appendingPathComponent("context-selection.json")
let GRANTS_FILE = (RELAY_DIR as NSString).appendingPathComponent("grants.json")
let AUDIT_FILE = (RELAY_DIR as NSString).appendingPathComponent("audit.log")
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

// ---------- house palette ----------
let LIME_NS = NSColor(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0, alpha: 1)
let PAGE_NS = NSColor(red: 0x0A/255.0, green: 0x0C/255.0, blue: 0x10/255.0, alpha: 1)
let SLATE_NS = NSColor(red: 0x6E/255.0, green: 0x7C/255.0, blue: 0x90/255.0, alpha: 1)
// The house danger colour (--danger #FF2D6E). Rung 4 (STATES.md §4) is the ONE place a red glyph is
// warranted: the daemon runs, everything reads green, but Claude Code isn't signed in on this Mac.
let DANGER_NS = NSColor(red: 0xFF/255.0, green: 0x2D/255.0, blue: 0x6E/255.0, alpha: 1)
extension Color {
    static let page = Color(red: 0x0A/255.0, green: 0x0C/255.0, blue: 0x10/255.0)
    static let panel = Color(red: 0x12/255.0, green: 0x15/255.0, blue: 0x1C/255.0)
    static let raised = Color(red: 0x1A/255.0, green: 0x1F/255.0, blue: 0x29/255.0)
    static let edge = Color(red: 0x26/255.0, green: 0x2C/255.0, blue: 0x38/255.0)
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim = Color(red: 0x99/255.0, green: 0xA3/255.0, blue: 0xB7/255.0)
    static let inkFaint = Color(red: 0x6E/255.0, green: 0x7C/255.0, blue: 0x90/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let danger = Color(red: 0xFF/255.0, green: 0x2D/255.0, blue: 0x6E/255.0)
    static let ok = Color(red: 0x3D/255.0, green: 0xD6/255.0, blue: 0x8C/255.0)   // "connected" green
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
func readGrantCount() -> Int {
    if let arr = readJSON(GRANTS_FILE) as? [[String: Any]] { return arr.count }
    if let map = readJSON(GRANTS_FILE) as? [String: Any] { return map.count }
    return 0
}

// A connected principal, classified by the SAME prefixes the daemon keys grants on: a real web
// origin (https://…), a TabSidekick principal (tabsidekick@…), or a NATIVE app (native@…).
enum AppKind { case web, native, tab }
struct AppRow: Identifiable { let id: String; let label: String; let kind: AppKind; let tools: Int; let appId: String?; let lastSeen: Double }

func classify(_ origin: String) -> (AppKind, String) {
    if origin.hasPrefix("native@") { return (.native, String(origin.dropFirst("native@".count))) }
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
        let label = kind == .native ? (names[ident] ?? ident) : ident
        let tools = (g["tools"] as? [[String: Any]])?.count ?? 0
        return AppRow(id: origin, label: label, kind: kind, tools: tools, appId: kind == .native ? ident : nil, lastSeen: seen[origin] ?? 0)
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

// ---------- loaded local models (Ollama — a SEPARATE process the daemon can't see) ----------
// The panel talks to Ollama directly: GET /api/ps for what's resident, POST /api/generate with
// keep_alive:0 to unload one now. This is the RAM-safety valve — see what's loaded, kill it.
struct LoadedModel: Identifiable { let id: String; let name: String; let vramGB: Double; let expiresIn: String }
func ollamaExpiry(_ iso: String?) -> String {
    guard let iso = iso else { return "" }
    let withFrac = ISO8601DateFormatter(); withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = withFrac.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
    let s = max(0, Int(d.timeIntervalSinceNow))
    return String(format: "%d:%02d", s / 60, s % 60)
}
@MainActor
final class OllamaMonitor: ObservableObject {
    @Published var models: [LoadedModel] = []
    @Published var up = false
    private let base = "http://127.0.0.1:11434"
    var totalVramGB: Double { (models.reduce(0) { $0 + $1.vramGB } * 10).rounded() / 10 }

    func refresh() {
        guard let url = URL(string: base + "/api/ps") else { return }
        var req = URLRequest(url: url); req.timeoutInterval = 1.2
        URLSession.shared.dataTask(with: req) { data, _, _ in
            var up = false; var list: [LoadedModel] = []
            if let d = data, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                up = true
                for m in (j["models"] as? [[String: Any]] ?? []) {
                    let name = (m["name"] as? String) ?? (m["model"] as? String) ?? "?"
                    let bytes = (m["size_vram"] as? Double) ?? (m["size"] as? Double) ?? 0
                    let gb = (bytes / 1_073_741_824.0 * 10).rounded() / 10
                    list.append(LoadedModel(id: name, name: name, vramGB: gb, expiresIn: ollamaExpiry(m["expires_at"] as? String)))
                }
            }
            Task { @MainActor in self.up = up; self.models = list }
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
struct Panel: View {
    @ObservedObject var model: Model
    @ObservedObject var ollama: OllamaMonitor
    let onToken: () -> Void
    let onLogs: () -> Void
    let onRestart: () -> Void
    let onStop: () -> Void
    let onTakeOver: () -> Void
    let onRepair: () -> Void
    let onQuit: () -> Void
    let onDisconnect: (String) -> Void   // disconnect a native app by appId
    @State private var breathe = false

    // The hero's one supporting line: who it's working for, or what's on the bench.
    private var momentMeta: String {
        if model.working, let a = model.last { return "for \(hostOf(a.origin))" }
        if model.working { return "on your Claude" }
        if model.running { return "\(model.contexts.count) context\(model.contexts.count == 1 ? "" : "s") banked · \(model.apps) app\(model.apps == 1 ? "" : "s") connected" }
        if model.bundled && model.translocated { return "move Switchboard to /Applications, then reopen it" }
        return "start the sidekick below"
    }

    // A connected principal's mark: a web origin, a native app, or a TabSidekick helper.
    @ViewBuilder private func appGlyph(_ kind: AppKind) -> some View {
        let spec: (String, Color) = {
            switch kind {
            case .web:    return ("globe", .inkDim)
            case .native: return ("desktopcomputer", .lime)
            case .tab:    return ("square.on.square.dashed", .inkFaint)
            }
        }()
        Image(systemName: spec.0).font(.system(size: 12, weight: .medium)).foregroundColor(spec.1).frame(width: 16)
    }

    // ---- backends: what's actually powering completions (Claude Code + any local runner) ----
    @ViewBuilder private var backendsStrip: some View {
        HStack(spacing: 7) {
            backendPill("Claude Code", model.signedIn ? "signed in" : "signed out", model.signedIn ? Color.ok : Color.danger)
            if ollama.up { backendPill("Ollama", "local", Color.lime) }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
    }
    @ViewBuilder private func backendPill(_ name: String, _ detail: String, _ dot: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(dot).frame(width: 6, height: 6)
            Text(name).font(.system(size: 11, weight: .medium)).foregroundColor(.ink)
            Text(detail).font(.system(size: 10)).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 7).fill(Color.panel).overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.edge, lineWidth: 1)))
    }

    // ---- connected apps: a horizontal card row so it never crowds, however many connect ----
    @ViewBuilder private var appsSection: some View {
        if model.running && !model.appList.isEmpty {
            Rectangle().fill(Color.edge).frame(height: 1)
            VStack(alignment: .leading, spacing: 9) {
                Text("CONNECTED APPS").kicker()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(model.appList) { appCard($0) } }.padding(.trailing, 16)
                }
            }
            .padding(.leading, 16).padding(.vertical, 12)
        }
    }
    @ViewBuilder private func appCard(_ app: AppRow) -> some View {
        let sym = app.kind == .native ? "desktopcomputer" : (app.kind == .tab ? "square.on.square.dashed" : "globe")
        let col: Color = app.kind == .native ? .lime : (app.kind == .tab ? .inkFaint : .inkDim)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: sym).font(.system(size: 15, weight: .medium)).foregroundColor(col)
                Spacer(minLength: 0)
                if app.kind == .native, let appId = app.appId {
                    Button(action: { onDisconnect(appId) }) {
                        Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundColor(.inkFaint)
                    }.buttonStyle(.plain).help("Disconnect this app")
                }
            }
            Text(app.label).font(.system(size: 11, weight: .medium)).foregroundColor(app.kind == .tab ? .inkDim : .ink).lineLimit(1)
            if app.kind == .native {
                Text("native").font(.system(size: 9, weight: .semibold)).foregroundColor(.page)
                    .padding(.horizontal, 5).padding(.vertical, 1).background(Color.lime).cornerRadius(4)
            } else {
                Text(app.kind == .tab ? "tab" : "\(app.tools) tool\(app.tools == 1 ? "" : "s")")
                    .font(.system(size: 9, design: .monospaced)).foregroundColor(.inkFaint)
            }
        }
        .frame(width: 88, alignment: .leading).padding(9)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.panel).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.edge, lineWidth: 1)))
    }

    // ---- tools: the connectors the daemon can grant (horizontal chips; hidden until status.json) ----
    @ViewBuilder private var toolsSection: some View {
        if model.running && !model.connectors.isEmpty {
            Rectangle().fill(Color.edge).frame(height: 1)
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Text("TOOLS").kicker()
                    Spacer()
                    Text("\(model.toolCount) across \(model.connectors.count) connector\(model.connectors.count == 1 ? "" : "s")")
                        .font(.system(size: 9.5)).foregroundColor(.inkFaint).padding(.trailing, 16)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(model.connectors) { c in
                            HStack(spacing: 6) {
                                Circle().fill(c.ok ? Color.ok : Color.inkFaint).frame(width: 6, height: 6)
                                Text(c.name).font(.system(size: 11)).foregroundColor(c.ok ? .ink : .inkDim)
                            }
                            .padding(.horizontal, 9).padding(.vertical, 5)
                            .background(RoundedRectangle(cornerRadius: 7).fill(Color.panel).overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.edge, lineWidth: 1)))
                        }
                    }.padding(.trailing, 16)
                }
            }
            .padding(.leading, 16).padding(.vertical, 12)
        }
    }

    // ---- loaded models: what Ollama has resident right now, with unload (the RAM valve) ----
    @ViewBuilder private var loadedModelsSection: some View {
        if ollama.up {
            Rectangle().fill(Color.edge).frame(height: 1)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("LOADED MODELS").kicker()
                    Spacer()
                    Text(String(format: "%.1f GB", ollama.totalVramGB)).font(.system(size: 10, design: .monospaced)).foregroundColor(.inkDim)
                }
                if ollama.models.isEmpty {
                    Text("nothing loaded").font(.system(size: 11)).foregroundColor(.inkFaint)
                } else {
                    ForEach(ollama.models) { m in
                        HStack(spacing: 9) {
                            Image(systemName: "cpu").font(.system(size: 13)).foregroundColor(.lime)
                            Text(m.name).font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundColor(.ink).lineLimit(1)
                            Spacer()
                            Text(String(format: "%.1f GB", m.vramGB)).font(.system(size: 10, design: .monospaced)).foregroundColor(.inkDim)
                            if !m.expiresIn.isEmpty { Text(m.expiresIn).font(.system(size: 9, design: .monospaced)).foregroundColor(.inkFaint) }
                            Button(action: { ollama.unload(m.name) }) {
                                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundColor(.danger)
                            }.buttonStyle(.plain).help("Unload now, free the memory")
                        }
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel).overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1)))
                    }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // ---- top bar: glyph + wordmark + status, exactly the panel's header ----
            HStack(spacing: 9) {
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color.lime)
                    .frame(width: 17, height: 17)
                    .overlay(Circle().fill(Color.page).frame(width: 5, height: 5).offset(x: 4.5, y: -4.5))
                    .shadow(color: Color.lime.opacity(0.4), radius: 7)
                Text("Switchboard").font(.system(size: 15, weight: .bold)).foregroundColor(.ink)
                Spacer()
                HStack(spacing: 6) {
                    // Running-but-signed-out reads RED here too — never a green "on" over a daemon that
                    // can't run a call (rung 4). Green when truly on, faint when the daemon is down.
                    let signedOut = model.running && !model.signedIn
                    let onColor = Color(red: 0x3D/255.0, green: 0xD6/255.0, blue: 0x8C/255.0)
                    Circle()
                        .fill(signedOut ? Color.danger : (model.running ? onColor : Color.inkFaint))
                        .frame(width: 7, height: 7)
                        .shadow(color: signedOut ? Color.danger.opacity(0.6) : (model.running ? onColor.opacity(0.6) : .clear), radius: 4)
                    Text(signedOut ? "signed out" : (model.running ? "on" : "off")).font(.system(size: 12, weight: .semibold)).foregroundColor(signedOut ? .danger : .inkDim)
                }
            }
            .padding(.horizontal, 16).padding(.top, 13).padding(.bottom, 11)
            backendsStrip
            Rectangle().fill(Color.edge).frame(height: 1)

            // ---- THE MOMENT — the only hero a menubar deserves: what is my AI doing right now? ----
            //   …and when the daemon is up but signed out (rung 4), the hero IS that: one red line and
            //   the single fix, so the user never discovers it as a failed first action instead.
            let signedOut = model.running && !model.signedIn
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Circle()
                        .fill(signedOut ? Color.danger : (model.working ? Color.lime : (model.running ? Color.inkFaint : Color.inkFaint.opacity(0.4))))
                        .frame(width: 10, height: 10)
                        .opacity(model.working ? (breathe ? 1.0 : 0.25) : 1.0)
                        .shadow(color: signedOut ? Color.danger.opacity(0.7) : (model.working ? Color.lime.opacity(0.7) : .clear), radius: 6)
                        .animation(model.working ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : .default, value: breathe)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(signedOut ? "Sign in to Claude" : (model.working ? "Working" : (model.running ? "Idle" : "Offline")))
                            .font(.system(size: 19, weight: .bold))
                            .foregroundColor(signedOut ? .danger : (model.working ? .lime : (model.running ? .ink : .inkDim)))
                        Text(signedOut ? SIGN_IN_HINT : momentMeta)
                            .font(.system(size: 11))
                            .foregroundColor(.inkDim)
                            .lineLimit(signedOut ? 3 : 1)
                    }
                    Spacer()
                }
                // supporting detail: the last thing that happened — one line, never a feed
                if model.running, let a = model.last {
                    HStack(spacing: 8) {
                        Rectangle().fill(Color.edge).frame(width: 2, height: 14)
                        (Text(hostOf(a.origin).prefix(26)).foregroundColor(.inkDim).fontWeight(.semibold)
                            + Text("  \(a.verb)\(a.note.isEmpty ? "" : " \u{201C}\(a.note.prefix(22))\u{201D}")").foregroundColor(.inkFaint))
                            .font(.system(size: 11)).lineLimit(1)
                        Spacer()
                        Text(agoText(a.ts)).font(.system(size: 10, design: .monospaced)).foregroundColor(.inkFaint)
                    }
                }
            }
            .padding(16)

            // ---- the daemon, surfaced: apps that use it · tools it can grant · models it has loaded ----
            appsSection
            toolsSection
            loadedModelsSection

            // ---- daemon custody notice (packaged app only) — never acts silently, always says why ----
            if model.bundled && !model.translocated && (model.plist == .foreign || model.plist == .staleOurs) {
                Rectangle().fill(Color.edge).frame(height: 1)
                HStack(spacing: 8) {
                    if model.plist == .foreign {
                        Text("daemon managed by a dev install")
                            .font(.system(size: 11)).foregroundColor(.inkDim).lineLimit(1)
                        Spacer()
                        GhostButton(icon: "arrow.triangle.2.circlepath", label: "take over", action: onTakeOver)
                    } else {
                        Text("daemon points at a missing install")
                            .font(.system(size: 11)).foregroundColor(.inkDim).lineLimit(1)
                        Spacer()
                        GhostButton(icon: "wrench.adjustable", label: "repair", action: onRepair)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
            }

            Rectangle().fill(Color.edge).frame(height: 1)

            // ---- quiet controls ----
            HStack(spacing: 8) {
                GhostButton(icon: "doc.on.doc", label: "token", action: onToken)
                GhostButton(icon: "text.alignleft", label: "logs", action: onLogs)
                GhostButton(icon: "arrow.clockwise", label: model.running ? "restart" : "start", action: onRestart)
                if model.running {
                    // The audit's "leaving" journey: the power glyph read as "turn Switchboard
                    // off" but only quit this app — the daemon kept serving every wrapp with the
                    // user's only handle on it gone. Stop is now its own explicit control.
                    GhostButton(icon: "stop.circle", label: "stop", action: onStop)
                }
                Spacer()
                if let t = model.toast {
                    Text(t).font(.system(size: 10)).foregroundColor(.lime).lineLimit(1)
                }
                GhostButton(icon: "power", label: nil, action: onQuit)
                    .help("Quit this app. The sidekick daemon keeps running — use stop to end it.")
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
        .frame(width: 340)
        .background(Color.page)
        .clipShape(RoundedRectangle(cornerRadius: 13))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.edge, lineWidth: 1))
        .onAppear { breathe = true }
    }
}

extension Text {
    func kicker() -> some View {
        self.font(.system(size: 9.5, weight: .semibold)).kerning(1.4).foregroundColor(.inkFaint)
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
                if let l = label { Text(l).font(.system(size: 10.5, weight: .medium)).lineLimit(1).fixedSize() }
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

        hosting = NSHostingView(rootView: Panel(
            model: model,
            ollama: ollama,
            onToken: { [weak self] in self?.copyToken() },
            onLogs: { NSWorkspace.shared.open(URL(fileURLWithPath: LOG_FILE)) },
            onRestart: { [weak self] in self?.startOrRestart() },
            onStop: { [weak self] in self?.stopDaemon() },
            onTakeOver: { [weak self] in self?.takeOverDaemon() },
            onRepair: { [weak self] in self?.repairDaemon() },
            onQuit: { NSApp.terminate(nil) },
            onDisconnect: { [weak self] appId in self?.disconnectNativeApp(appId) }
        ))
        // A borderless, non-activating panel pinned under the icon — NSPopover kept anchoring into
        // mid-air, and the arrow is noise anyway. The SwiftUI view brings its own rounded corners.
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .statusBar
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
        let x = min(max(icon.maxX - size.width, screen.visibleFrame.minX + 8), screen.visibleFrame.maxX - size.width - 8)
        panel.setFrameTopLeftPoint(NSPoint(x: x, y: icon.minY - 6))
        panel.orderFrontRegardless()
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
                Task { @MainActor in
                    // Rung 4: only meaningful once the daemon is up. When up-but-signed-out, the glyph
                    // goes RED and the tooltip names the one fix — the cliff caught before the first call.
                    let signedIn = ok ? readSignedIn() : true
                    self.model.running = ok
                    self.model.working = ok && busy && signedIn
                    self.model.signedIn = signedIn
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
