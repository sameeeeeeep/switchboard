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
import ApplicationServices   // AXIsProcessTrusted() — the honest Accessibility check
import AVFoundation          // microphone authorization
import Carbon.HIToolbox       // RegisterEventHotKey — the ⌥V voice-paste global hotkey (consumes the key)

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
// Append-only diagnostics I can read from ~/.relay/god-hotkey.log — ground truth for the hotkey path
// (AXIsProcessTrusted, tap creation, each ⌃⌥ edge), independent of the unified-log visibility quirks.
func godLog(_ s: String) {
    let line = "[\(Date())] \(s)\n"
    let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-hotkey.log")
    if let d = line.data(using: .utf8) {
        if let h = FileHandle(forWritingAtPath: path) { h.seekToEndOfFile(); h.write(d); try? h.close() }
        else { try? line.write(toFile: path, atomically: true, encoding: .utf8) }
    }
}

func writeDaemonPlist(to path: String = PLIST) throws {
    let home = NSHomeDirectory()
    var envVars: [String: String] = [
        "HOME": home,
        "PATH": "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        // Point warm sessions and claudeBin() checks at the CLI this bundle SHIPS. Without
        // this the daemon hunted the system PATH for a claude the user may not have, while
        // a perfectly good Anthropic-signed one sat beside sidekick.mjs unused.
        "RELAY_CLAUDE_CLI": ((Bundle.main.resourcePath ?? "") as NSString)
            .appendingPathComponent("daemon/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"),
        // God is first-party — keep the native listener up so ⌃⌥ can attach on the first press,
        // even before any native app has registered.
        "RELAY_NATIVE": "1",
        // STT for God's voice — the FALLBACK: Flow's whisper-stt.mjs adapter (OpenAI `whisper
        // --model tiny`, on-device, Homebrew PATH prepended). Used when whisper.cpp isn't present.
        "RELAY_STT_CMD": "\(BUNDLED_NODE) " + ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("god/whisper-stt.mjs"),
    ]
    // FAST STT: if whisper.cpp + a ggml model are installed, prefer them — localSTT checks WHISPER_BIN
    // before the STT_CMD fallback, and whisper.cpp is ~0.5s warm vs OpenAI whisper's ~4s. Detected at
    // plist-write time; the launcher's plistEnvOutdated refresh re-runs this after an install.
    // Prefer the whisper.cpp we SHIP (Resources/stt) so Flow's dictation works with ZERO user setup on a
    // fresh install; fall back to a user-installed whisper.cpp (Homebrew + a model in ~/.relay/models).
    let bundledSTT = ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("stt/whisper-cli")
    let bundledModel = ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("stt/ggml-tiny.en.bin")
    let wcpp = [bundledSTT, "/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli", "/opt/homebrew/bin/whisper-cpp", "/usr/local/bin/whisper-cpp"].first { FileManager.default.fileExists(atPath: $0) }
    let mdir = (home as NSString).appendingPathComponent(".relay/models")
    let userModel = (try? FileManager.default.contentsOfDirectory(atPath: mdir))?.first { $0.hasSuffix(".bin") && ($0.contains("base.en") || $0.contains("ggml")) }
    let modelPath: String? = FileManager.default.fileExists(atPath: bundledModel) ? bundledModel
        : userModel.map { (mdir as NSString).appendingPathComponent($0) }
    if let wcpp = wcpp, let modelPath = modelPath {
        envVars["RELAY_WHISPER_BIN"] = wcpp
        envVars["RELAY_WHISPER_MODEL"] = modelPath
    }
    let spec: [String: Any] = [
        "Label": LABEL,
        "ProgramArguments": [BUNDLED_NODE, BUNDLED_ENTRY],
        "RunAtLoad": true,
        "KeepAlive": true,
        "StandardOutPath": LOG_FILE,
        "StandardErrorPath": LOG_FILE,
        "WorkingDirectory": home,
        "EnvironmentVariables": envVars,
    ]
    // launchd opens the log path at spawn — make sure ~/.relay exists (0700, same as the daemon).
    try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true,
                                             attributes: [.posixPermissions: 0o700])
    try FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent,
                                            withIntermediateDirectories: true)
    let data = try PropertyListSerialization.data(fromPropertyList: spec, format: .xml, options: 0)
    try data.write(to: URL(fileURLWithPath: path))
}

/// Was this (ours) plist written by an OLDER build — i.e. is it missing a daemon env key this build
/// requires? A same-path app update does not rewrite the plist, so env additions (e.g. RELAY_STT_CMD,
/// which gives God its ear) silently never reach the running daemon. If any required key is absent,
/// the launcher refreshes the LaunchAgent. Add new required keys here as the daemon grows to need them.
func plistEnvOutdated(at path: String = PLIST) -> Bool {
    guard let dict = NSDictionary(contentsOfFile: path) as? [String: Any],
          let env = dict["EnvironmentVariables"] as? [String: Any] else { return false }
    let required = ["RELAY_STT_CMD", "RELAY_NATIVE", "RELAY_CLAUDE_CLI"]
    return required.contains { env[$0] == nil }
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
    static let amber = Color(red: 0xEF/255.0, green: 0x9F/255.0, blue: 0x27/255.0)  // pending / needs-attention
    // The LOCAL-ONLY signal — a cool indigo, deliberately NOT lime, so a rare ambient screenshot reads as
    // "never left your Mac" and can never be confused with the normal lime ⌃⌃ capture flash. sRGB #5B8DEF.
    static let localInk = Color(red: 0x5B/255.0, green: 0x8D/255.0, blue: 0xEF/255.0)
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
    // Doto — the dot-matrix display face; Switchboard's wordmark direction (LED/circuit feel).
    static func doto(_ size: CGFloat, _ w: Font.Weight = .bold) -> Font { .custom("Doto", size: size).weight(w) }
    // The discrete type scale (NOTCH-DESIGN §3) — a fixed 7-step ladder so notch UI can't reach for a
    // half-point (10.5/11.5/12.5). Prefer these on drops/widgets/store; the smear becomes unspellable.
    static let display = brico(24, .bold)      // the one hero title per surface
    static let title   = brico(18, .bold)      // section titles, widget titles
    static let heading = hanken(14, .semibold) // card/chip titles, consent headline
    static let bodyText = hanken(12, .regular) // descriptions, taglines, activity lines ("body" is taken by SwiftUI)
    static let label   = hanken(11, .medium)   // chip/button labels, captions
    static let monoSm  = splMono(9)            // counts, metadata, model names
}

// ---------- the ONE spacing grid + ONE radius scale (NOTCH-DESIGN §4/§5) ----------
// Module-level so the widget kit (WK) and ambient (AmbT) source their numbers from ONE place instead of
// re-declaring the same 4pt/radius ladder three times (itself a "generated, not made" tell). Same module,
// so every notch file sees these.
enum SB {  // spacing — the one 4pt grid
    static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20, s6: CGFloat = 24
}
enum SBr { // radius — the only radii on the notch surface
    static let xs: CGFloat = 7, sm: CGFloat = 12, md: CGFloat = 16, lg: CGFloat = 20, pill: CGFloat = 999
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
struct AppRow: Identifiable { let id: String; let label: String; let kind: AppKind; let tools: Int; let appId: String?; let lastSeen: Double; let icon: NSImage?; let listingId: String? }

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
// God runs as a node process (no installed .app, and it registers without a display name), so it would
// otherwise show as the raw principal "ai.thelastprompt.god". Force its friendly name.
let GOD_APP_ID = "ai.thelastprompt.god"
func godName(_ ident: String) -> String? { ident == GOD_APP_ID ? "God" : nil }
/** origin → the catalog listing it belongs to, matched by the listing's page host — so a connected web
    wrapp shows its real name ("Redline") + real store icon instead of a raw hostname + globe. */
func listingFor(_ origin: String, in catalog: [SBListing]) -> SBListing? {
    let host = hostOf(origin)
    return catalog.first { l in
        guard let u = l.components.ui?.url, let h = URLComponents(string: u)?.host else { return false }
        return h == host
    }
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
    let names = nativeNames(); let seen = lastSeenByOrigin(); let catalog = readCatalog()
    let rows: [AppRow] = arr.compactMap { g in
        guard let origin = g["origin"] as? String else { return nil }
        let (kind, ident) = classify(origin)
        let listing = listingFor(origin, in: catalog)   // web wrapps → their catalog listing (real name + icon)
        let label: String
        switch kind {
        case .native: label = godName(ident) ?? names[ident] ?? ident
        case .iphone:  label = hostOf(ident.contains("/") ? String(ident.split(separator: "/", maxSplits: 1)[1]) : ident)
        default:       label = listing?.name ?? ident      // "Redline", not "redline.thelastprompt.ai"
        }
        let tools = (g["tools"] as? [[String: Any]])?.count ?? 0
        let bundleId: String? = kind == .native ? ident : nil
        let art: NSImage? = listing.flatMap { storeIcon($0.id) } ?? bundleId.flatMap(nativeAppIcon)   // real store art first
        return AppRow(id: origin, label: label, kind: kind, tools: tools, appId: bundleId, lastSeen: seen[origin] ?? 0, icon: art, listingId: listing?.id)
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

// ---- Claude Code connector setup (onboarding "Connect Claude Code") ------------------------------
// The Switchboard MCP connector lets a Claude Code session read this project's board (pick up tasks the
// user moved to Todo) and run its wrapps. We give the user the exact `claude mcp add …` command; these
// helpers resolve the connector's path (the app's bundled single-file build, else the repo source in
// dev) and detect whether it's already registered in ~/.claude.json so the card can say "connected".
func switchboardConnectorPath() -> String {
    if let res = Bundle.main.resourcePath {
        let bundled = res + "/connector/switchboard.mjs"
        if FileManager.default.fileExists(atPath: bundled) { return bundled }
    }
    // dev: the app runs from <repo>/packages/menubar/Switchboard.app → the connector is a sibling package
    let dev = (Bundle.main.bundlePath as NSString).appendingPathComponent("../../switchboard-mcp/switchboard-mcp.mjs")
    return (dev as NSString).standardizingPath
}
func switchboardConnectorNode() -> String {
    if let res = Bundle.main.resourcePath { let n = res + "/node"; if FileManager.default.fileExists(atPath: n) { return n } }
    return "node"
}
func claudeMcpAddCommand() -> String {
    "claude mcp add switchboard -s user -- \"\(switchboardConnectorNode())\" \"\(switchboardConnectorPath())\" mcp"
}
// Run `claude mcp add …` in the user's LOGIN shell (so it finds `claude` on their PATH — a GUI app's
// own PATH is minimal). User-initiated only: fired by a Run button / notch action, which IS the consent
// for this one config change. Returns (ok, message) on the main thread; "already exists" counts as ok.
func runClaudeMcpAdd(_ completion: @escaping (Bool, String) -> Void) {
    let cmd = claudeMcpAddCommand()
    DispatchQueue.global(qos: .userInitiated).async {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", cmd]
        let pipe = Pipe(); p.standardOutput = pipe; p.standardError = pipe
        var ok = false, msg = ""
        do {
            try p.run(); p.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            msg = (String(data: data, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let already = msg.range(of: "already", options: .caseInsensitive) != nil
            ok = p.terminationStatus == 0 || already
            if !ok && msg.isEmpty { msg = (p.terminationStatus == 127 ? "Claude Code (`claude`) isn't on your PATH — install it, or run `claude` once to sign in." : "exit \(p.terminationStatus)") }
        } catch { ok = false; msg = "Couldn't launch a shell: \(error.localizedDescription)" }
        DispatchQueue.main.async { connectorInstalledCache = nil; completion(ok, msg) }
    }
}
// True if a server referencing the switchboard connector is registered anywhere in ~/.claude.json
// (top-level user scope, or under any projects.<path>.mcpServers). Cached 20s.
private var connectorInstalledCache: (at: Date, val: Bool)? = nil
func claudeCodeConnectorInstalled() -> Bool {
    if let c = connectorInstalledCache, Date().timeIntervalSince(c.at) < 20 { return c.val }
    var val = false
    let path = (NSHomeDirectory() as NSString).appendingPathComponent(".claude.json")
    if let obj = readJSON(path) as? [String: Any] {
        func scan(_ v: Any?) -> Bool {
            guard let m = v as? [String: Any] else { return false }
            for (name, cfg) in m {
                if name.lowercased().contains("switchboard") { return true }
                if let c = cfg as? [String: Any] {
                    let cmd = (c["command"] as? String) ?? ""
                    let args = ((c["args"] as? [String]) ?? []).joined(separator: " ")
                    if (cmd + " " + args).lowercased().contains("switchboard") { return true }
                }
            }
            return false
        }
        if scan(obj["mcpServers"]) { val = true }
        else if let projects = obj["projects"] as? [String: Any] {
            for (_, pv) in projects { if let pd = pv as? [String: Any], scan(pd["mcpServers"]) { val = true; break } }
        }
    }
    connectorInstalledCache = (Date(), val)
    return val
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
    @Published var voices: [String] = []          // cloned/dropped voices in ~/.relay/voices
    @Published var selectedVoice: String = ""     // the one God speaks in (empty = macOS `say`)
    @Published var userName: String = ""          // what God calls you (~/.relay/profile.json → name)
    @Published var economy = false                // prefer a cheaper/faster model to spend fewer tokens
    @Published var regionSelect = false           // ⌃⌃ lets you drag a screen region → only that is sent
    @Published var defaultShare = false           // ⌃⌃ auto-shares the whole screen (fn+click then TOGGLES it off)
    @Published var disabledModels: Set<String> = []  // models the user turned off (~/.relay/models.json, canonical ids)
    @Published var shortcuts = readShortcutCfg()   // the summon / talk gesture bindings (rebindable presets)
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
        voices = readVoices()
        selectedVoice = readSelectedVoice()
        userName = readUserName()
        economy = readEconomy()
        regionSelect = readRegionSelect()
        defaultShare = readDefaultShare()
        disabledModels = readModelPrefs()
        shortcuts = readShortcutCfg()
    }
}

// ⌃⌃ region select — a tiny ~/.relay/god-region flag. On → God captures an interactive drag-selected
// rectangle instead of the whole screen (only that part is sent to the model). Daemon-independent.
func readRegionSelect() -> Bool {
    let f = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-region")
    let v = ((try? String(contentsOfFile: f, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return v == "1" || v == "true"
}

// The name God greets you by — the daemon's real source of truth, ~/.relay/profile.json (written by
// setProfile). Empty when unset → the field shows its placeholder (the daemon falls back to the OS name).
func readUserName() -> String {
    let f = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/profile.json")
    guard let obj = readJSON(f) as? [String: Any] else { return "" }
    return ((obj["name"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}
// Economy mode — a tiny ~/.relay/economy flag God reads to prefer a cheaper/faster model. Local file,
// daemon-independent (works while it's stopped); "1"/"true" = on.
func readEconomy() -> Bool {
    let f = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/economy")
    let v = ((try? String(contentsOfFile: f, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return v == "1" || v == "true"
}

// Default screen-share — a tiny ~/.relay/god-default-share flag. Privacy-forward default is OFF (a plain
// ⌃⌃ is voice-only; you fn-grab to share). ON inverts the gesture grammar: a plain ⌃⌃ auto-stages the WHOLE
// screen as a removable chip the moment listening starts, and fn+click TOGGLES that share off/on. Local
// file, daemon-independent; "1"/"true" = on. Mirrors readEconomy.
func readDefaultShare() -> Bool {
    let f = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-default-share")
    let v = ((try? String(contentsOfFile: f, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return v == "1" || v == "true"
}

// Model selection (docs/MODEL-SELECTION.md) — the user's allow/deny list lives in ~/.relay/models.json as
// { "disabled": [<canonical id>…] }. Default empty ⇒ everything on. The daemon-side filter is a separate
// job; here we own the FILE (read for the Settings UI, write on toggle). Ids are stored CANONICAL so a
// user disabling "opus" also catches a wrapp asking for "claude-opus-4-8" (grant-store folds them together).
func canonicalModelId(_ name: String) -> String {
    let d = name.lowercased().trimmingCharacters(in: .whitespaces)
    // Ollama ids carry a ':' or '/' (llama3:8b, qwen2.5/…) — no alias, pass through unchanged.
    if d.contains(":") || d.contains("/") { return name }
    if d.hasPrefix("fable") || d.hasPrefix("opus") || d.contains("opus") { return "opus" }
    if d.hasPrefix("sonnet") || d.contains("sonnet") { return "sonnet" }
    if d.hasPrefix("haiku") || d.contains("haiku") { return "haiku" }
    return name
}
func readModelPrefs() -> Set<String> {
    let f = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/models.json")
    guard let obj = readJSON(f) as? [String: Any], let arr = obj["disabled"] as? [String] else { return [] }
    return Set(arr.map { canonicalModelId($0) })
}

// ---------- keyboard shortcuts (~/.relay/shortcuts.json) ----------
// A DELIBERATELY-NARROW, mac-safe vocabulary — not free-form hotkeys. Everything rides one passive
// `.flagsChanged` monitor (installHotKey), which only sees MODIFIERS, so the whole grammar is: summon =
// double-tap ONE modifier; talk = hold a TWO-modifier chord. A real key+modifier hotkey would need Input
// Monitoring / a CGEventTap; we intentionally don't go there. Rebinding therefore = pick from these presets.
// dictationMode picks HOW the talk chord drives dictation:
//   "latch" (default, the new grammar) — TAP the talk chord to BEGIN dictating; recording LATCHES and
//            keeps going after the keys are released. A tap of the SUMMON modifier (⌃) COMMITs (stop +
//            transcribe + act). Holding Fn at commit routes the transcript through the vault FIND lookup
//            instead of pasting it raw. Esc aborts from any state.
//   "hold"  (legacy fallback) — HOLD the talk chord to record; release to transcribe + paste. Kept fully
//            working so a bad edit / a machine where the latch grammar misbehaves always has dictation.
struct ShortcutCfg { var summon = "control"; var talk = "control+option"; var dictationMode = "latch" }   // defaults = ⌃⌃ / ⌃⌥, latched dictation
let SUMMON_OPTIONS = ["control", "option", "command", "shift"]
let TALK_OPTIONS = ["control+option", "control+command", "option+command", "control+shift", "option+shift", "command+shift"]
let DICTATION_MODES = ["latch", "hold"]
func modFlag(_ s: String) -> NSEvent.ModifierFlags {
    switch s { case "control": return .control; case "option": return .option; case "command": return .command; case "shift": return .shift; default: return [] }
}
func chordFlags(_ s: String) -> NSEvent.ModifierFlags {
    s.split(separator: "+").reduce(into: NSEvent.ModifierFlags()) { $0.insert(modFlag(String($1))) }
}
func modGlyph(_ s: String) -> String {
    switch s { case "control": return "⌃"; case "option": return "⌥"; case "command": return "⌘"; case "shift": return "⇧"; default: return "?" }
}
func talkGlyphs(_ s: String) -> String { s.split(separator: "+").map { modGlyph(String($0)) }.joined() }
// Validated read — an out-of-vocabulary value silently falls back to the default, so a hand-edited or
// stale file can never wedge the gesture monitor into an unmatchable state.
func readShortcutCfg() -> ShortcutCfg {
    let f = (RELAY_DIR as NSString).appendingPathComponent("shortcuts.json")
    var c = ShortcutCfg()
    if let obj = readJSON(f) as? [String: Any] {
        if let s = obj["summon"] as? String, SUMMON_OPTIONS.contains(s) { c.summon = s }
        if let t = obj["talk"] as? String, TALK_OPTIONS.contains(t) { c.talk = t }
        // Out-of-vocabulary (or absent) → the "latch" default. So a stale/hand-edited file can never
        // strand the user with an unrecognised dictation mode.
        if let d = obj["dictationMode"] as? String, DICTATION_MODES.contains(d) { c.dictationMode = d }
    }
    return c
}

// ---------- onboarding (docs/ONBOARDING.md) ----------
// Where new users land the switchboard install page / the store hero. One hub; both the extension
// rung and the first-app rung point here.
let ONBOARD_HUB = URL(string: "https://www.thelastprompt.ai/switchboard")!
// A DEDICATED marker (not TOKEN_FILE) so "Replay the tour" re-runs cleanly and a major bump can
// re-onboard. Its mere presence = onboarded; deleting it re-triggers the flow.
let ONBOARDED_FILE = (RELAY_DIR as NSString).appendingPathComponent("onboarded")
func readOnboarded() -> Bool { FileManager.default.fileExists(atPath: ONBOARDED_FILE) }

/// The onboarding state machine (docs/ONBOARDING.md §"Completeness pass"):
///   hidden → setup (Act I: mechanical rungs) → tour (Act II: teach-by-doing) → done → hidden
/// Setup rungs are DERIVED from live `Model` state in the view; this only holds the phase + tour step,
/// so both the panel (UI-driven steps: the gear) and the app delegate (OS gestures: ⌃⌃, ⌃⌥) can drive it.
@MainActor final class Onboard: ObservableObject {
    enum Phase { case hidden, setup, tour, done }
    enum Signal { case glance, settings, dictation }   // the real gestures the tour waits on
    @Published var phase: Phase = .hidden
    @Published var step = 0
    static let tourCount = 4                            // glance · intro · settings · dictation → done

    // Live gesture pulses for the Settings → Shortcuts tester. Stamped whenever the real gesture is
    // DETECTED (independent of the tour, and before any downstream guard), so the section can flash a
    // green "detected" the instant you press — and show "used Ns ago" as proof even if summoning God
    // reordered the panel away.
    @Published var lastSummon: Date? = nil              // ⌃⌃ double-tap
    @Published var lastDictate: Date? = nil             // ⌃⌥ hold

    func beginSetup() { phase = .setup; step = 0 }
    func startTour()  { phase = .tour;  step = 0 }
    func advance()    { if step + 1 >= Onboard.tourCount { finishTour() } else { step += 1 } }
    func finishTour() { mark(); phase = .done }         // → the "you're all set" card
    func finish()     { mark(); phase = .hidden }       // the card's Done, or any dismiss

    /// A real gesture happened — advance only if it's the one THIS step is waiting for.
    func note(_ s: Signal) {
        guard phase == .tour else { return }
        switch (step, s) {
        case (0, .glance), (2, .settings), (3, .dictation): advance()
        default: break
        }
    }
    private func mark() { try? Data("done".utf8).write(to: URL(fileURLWithPath: ONBOARDED_FILE)) }
}

// The cloned voices the user has dropped in (~/.relay/voices/<name>.wav → cloned to <name>.safetensors
// by the god-tts service). A voice "exists" once its .wav or .safetensors is there. `-full` copies hide.
func readVoices() -> [String] {
    let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/voices")
    guard let files = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
    var names = Set<String>()
    for f in files {
        if f.hasSuffix(".safetensors") { names.insert((f as NSString).deletingPathExtension) }
        else if f.hasSuffix(".wav") {
            let n = (f as NSString).deletingPathExtension
            if !n.hasSuffix("-full") { names.insert(n) }
        }
    }
    return names.sorted()
}
func readSelectedVoice() -> String {
    let f = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/voices/selected")
    return ((try? String(contentsOfFile: f, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
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

// "Connect Claude Code" — the onboarding + Settings card that guides the user to add the Switchboard
// MCP connector to their Claude Code, so Guru and the OS board get real hands: a Claude session can then
// read this project's board (pick up tasks moved to Todo) and run its wrapps. Shows the exact command
// with a copy button, and flips to a green "connected" state once it's registered in ~/.claude.json.
struct ConnectClaudeCodeCard: View {
    var compact = false
    @State private var installed = false
    @State private var copied = false
    @State private var running = false
    @State private var errMsg: String? = nil
    private var command: String { claudeMcpAddCommand() }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Image(systemName: "terminal.fill").font(.system(size: 12)).foregroundColor(installed ? .ok : .lime)
                Text("Connect Claude Code").font(.hanken(13, .semibold)).foregroundColor(.ink)
                Spacer(minLength: 0)
                if installed {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 11)).foregroundColor(.ok)
                        Text("connected").font(.splMono(9.5)).foregroundColor(.ok)
                    }
                }
            }
            Text("Let Guru and your OS board reach a Claude Code session — it can read this project's board, pick up tasks you move to Todo, and run your wrapps.")
                .font(.hanken(11.5)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)

            if installed {
                Text("Try it in a Claude Code session here: “what's on my Switchboard board?” or “pick up the next task.”")
                    .font(.hanken(11)).foregroundColor(.inkSec).fixedSize(horizontal: false, vertical: true)
            } else {
                // Primary: Run it (the app runs `claude mcp add` for you). Secondary: copy to run yourself.
                HStack(spacing: 8) {
                    if running {
                        HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Adding…").font(.hanken(11)).foregroundColor(.inkDim) }
                    } else {
                        Button(action: run) {
                            Text("Run it").font(.hanken(12, .semibold)).foregroundColor(Color(red: 0x0b/255, green: 0x0c/255, blue: 0x10/255))
                                .padding(.horizontal, 13).padding(.vertical, 6)
                                .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
                        }.buttonStyle(.plain).help("Run `claude mcp add` for you")
                    }
                    Button(action: copy) {
                        Text(copied ? "copied" : "copy command").font(.hanken(11, .semibold))
                            .foregroundColor(copied ? .ok : .inkSec)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke((copied ? Color.ok : Color.edge), lineWidth: 1))
                    }.buttonStyle(.plain)
                    Spacer(minLength: 0)
                }
                if let e = errMsg {
                    Text(e).font(.splMono(9)).foregroundColor(.danger).fixedSize(horizontal: false, vertical: true)
                    Text(command).font(.splMono(9)).foregroundColor(.inkFaint).textSelection(.enabled)
                        .lineLimit(2).truncationMode(.middle)
                } else {
                    Text("“Run it” adds it on your Claude Code. Needs `claude` installed — or copy and run it in a project folder yourself.")
                        .font(.splMono(9)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(compact ? 12 : 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke((installed ? Color.ok : Color.lime).opacity(installed ? 0.35 : 0.25), lineWidth: 1))
        .onAppear { installed = claudeCodeConnectorInstalled() }
    }

    private func copy() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(command, forType: .string)
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { copied = false }
    }
    private func run() {
        running = true; errMsg = nil
        runClaudeMcpAdd { ok, msg in
            running = false
            if ok { installed = true } else { errMsg = msg }
        }
    }
}

struct Panel: View {
    @ObservedObject var model: Model
    @ObservedObject var ollama: OllamaMonitor
    @ObservedObject var icons: IconStore
    @ObservedObject var onboard: Onboard
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
    let onSelectVoice: (String) -> Void  // pick God's voice (empty = macOS say)
    let onDropVoice: ([URL]) -> Void     // drop a .wav/.mp3 sample → clone it into a voice
    let onRevoke: (String) -> Void       // remove a connected app/site by origin
    let onOpen: (AppRow) -> Void         // click a connected app → open its page/wrapp
    let onSetName: (String) -> Void      // save the name God greets you by
    let onSetEconomy: (Bool) -> Void     // economy mode: prefer a cheaper/faster model
    let onSetRegion: (Bool) -> Void      // ⌃⌃ region select: drag to pick what God sees
    let onSetDefaultShare: (Bool) -> Void  // default screen-share: plain ⌃⌃ auto-shares the whole screen
    let onSetModelDisabled: (String, Bool) -> Void  // MODELS: allow/deny a model (writes ~/.relay/models.json)
    let onSetShortcut: (String, String) -> Void  // rebind a gesture ("summon"/"talk" → preset value)
    let onSignIn: () -> Void             // onboarding: open Terminal + start the `claude` login
    let onFixSenses: () -> Void          // onboarding: surface the mic/accessibility/screen gate
    let onStore: () -> Void              // open the wrapp store modal (drops from the notch)
    let onTour: () -> Void               // launch the floating-cursor onboarding concierge (CursorGuide .tour)
    var onConnectClaudeNotch: () -> Void = {}   // raise the "Connect Claude Code" notch card (onboarding finish)
    @State private var breathe = false
    @State private var pickerOpen = false
    @State private var dropTargeted = false
    @State private var showSettings = false      // the right pane flips to Settings (in-panel, one grammar)
    @State private var nameDraft = ""            // the name field's working copy, committed on save
    @State private var openSection: String? = nil  // Settings accordion: at most one section expanded, so the panel stays short
    @State private var guideVoiceover = CursorGuide.shared.voiceoverOn  // mirrors the fn-m guide preference in Settings

    private var signedOut: Bool { model.running && !model.signedIn }
    private var heroTitle: String { signedOut ? "Sign in" : (model.working ? "Working" : (model.running ? "Idle" : "Offline")) }
    private var heroColor: Color { signedOut ? .danger : (model.working ? .lime : (model.running ? .ink : .inkDim)) }
    private var heroDot: Color { signedOut ? .danger : (model.working ? .lime : .inkFaint) }
    // The beacon's phase pattern + accent (USE B). Pattern carries the state; accent is lime, danger (signed-out),
    // or faint (offline, rendered still via animated:false on the DotMatrix).
    private var heroPattern: DotMatrix.Pattern { signedOut ? .listening : (model.working ? .working : .thinking) }
    private var heroBeaconAccent: Color { signedOut ? .danger : (model.running ? .lime : .inkFaint) }
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
        let corner = size * 0.22   // one superellipse ratio for every app/wrapp icon tile (NOTCH-DESIGN §5/§7)
        switch app.kind {
        case .native:
            // God has no installed .app (nativeAppIcon → nil), but it ships a bundled store icon —
            // resolve icons/god.png the same way web wrapps resolve their art, before the dashed fallback.
            if let icon = app.icon ?? (app.appId == GOD_APP_ID ? storeIcon("god") : nil) {
                Image(nsImage: icon).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: corner))
            } else {
                ZStack { RoundedRectangle(cornerRadius: corner).fill(Color.panel)
                    Image(systemName: "app.dashed").font(.system(size: size * 0.5)).foregroundColor(.lime) }.frame(width: size, height: size)
            }
        case .web:
            if let icon = app.icon {   // the wrapp's real store art (icons/<id>.png) resolved via its catalog listing
                Image(nsImage: icon).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: corner))
            } else {
                IconView(store: icons, key: app.id, hosts: [hostOf(app.id)], symbol: "globe", tint: .inkDim, bg: Color.panel, size: size, corner: corner)
            }
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
                    .overlay(Circle().fill(Color.rail).frame(width: 5, height: 5).offset(x: 4.5, y: -4.5))   // no static halo (NOTCH-DESIGN §5)
                Text("SWITCHBOARD").font(.doto(11, .black)).kerning(0.5).lineLimit(1).fixedSize().foregroundColor(.ink)
                Spacer(minLength: 0)
                // Health lamp: lime = running+signed-in, danger = signed-out, faint = down (one health language, §2.2 — no green).
                Circle().fill(signedOut ? Color.danger : (model.running ? Color.lime : Color.inkFaint)).frame(width: 6, height: 6)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 11) {
                    // USE B: the hero liveness BEACON — a real 7×5 operator lamp field replacing the flat dot.
                    // The phase is carried by the PATTERN (thinking idle · working busy · listening signed-out),
                    // one accent only (lime, or the sanctioned danger when signed-out; faint + still when offline).
                    DotMatrix(pattern: heroPattern, accent: heroBeaconAccent, cols: 7, rows: 5, dot: 2.6, gap: 2.4,
                              animated: model.running)
                        .frame(width: 34, alignment: .leading)
                    Text(heroTitle).font(.display).foregroundColor(heroColor).lineLimit(1)
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
                    Spacer(minLength: 0)
                }
                HStack(spacing: 8) {
                    if model.running {
                        GhostButton(icon: "arrow.clockwise", label: nil, action: onRestart).help("Restart the daemon")
                        GhostButton(icon: "stop.fill", label: nil, action: onStop).help("Stop the daemon")
                    } else {
                        GhostButton(icon: "play.fill", label: "start", action: onRestart).help("Start the daemon")
                    }
                    Spacer(minLength: 0)
                    // Settings lives here as its own gear, out of the crowded top row.
                    GhostButton(icon: showSettings ? "xmark" : "gearshape.fill", label: nil,
                                action: { nameDraft = model.userName; withAnimation(.easeOut(duration: 0.14)) { showSettings.toggle() } })
                        .help(showSettings ? "Close settings" : "Settings")
                    SBButton(icon: "power", style: .danger, action: onQuit).help("Quit this app; the daemon keeps running")
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
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(currentContext == nil ? Color.edge : Color.lime.opacity(0.45), lineWidth: 1)))
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
                // Three horizontal card rails, one grammar (the dot-row divider is gone — plain hairlines now).
                appsRow
                Rectangle().fill(Color.edge).frame(height: 1).opacity(0.7)
                commandCentreSection
                Rectangle().fill(Color.edge).frame(height: 1).opacity(0.7)
                toolsSection
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

    // GOD'S VOICE — drop a sample to clone (Pocket TTS), pick which voice God speaks in. The drop
    // copies + clones into ~/.relay/voices; the radio writes ~/.relay/voices/selected that God reads.
    private var voiceSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 9)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .foregroundColor(dropTargeted ? .lime : .edge)
                .frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 9).fill(dropTargeted ? Color.lime.opacity(0.06) : Color.clear))
                .overlay(HStack(spacing: 7) {
                    Image(systemName: "waveform.badge.plus").font(.system(size: 13)).foregroundColor(dropTargeted ? .lime : .inkFaint)
                    Text("Drop a voice sample (.wav / .mp3, ~15–30s) to clone").font(.hanken(11)).foregroundColor(.inkDim)
                })
                .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
                    var urls: [URL] = []; let g = DispatchGroup()
                    for p in providers { g.enter(); _ = p.loadObject(ofClass: URL.self) { u, _ in if let u = u { urls.append(u) }; g.leave() } }
                    g.notify(queue: .main) { if !urls.isEmpty { onDropVoice(urls) } }
                    return true
                }
            VStack(spacing: 0) {
                voiceRow(name: "", label: "Default (macOS voice)")
                ForEach(model.voices, id: \.self) { v in voiceRow(name: v, label: v.replacingOccurrences(of: "-", with: " ").capitalized) }
            }
        }
    }
    private func voiceRow(name: String, label: String) -> some View {
        let selected = model.selectedVoice == name
        return Button(action: { onSelectVoice(name) }) {
            HStack(spacing: 9) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle").font(.system(size: 12)).foregroundColor(selected ? .lime : .inkFaint)
                Text(label).font(.hanken(12, selected ? .semibold : .regular)).foregroundColor(selected ? .ink : .inkDim)
                Spacer()
            }.padding(.vertical, 6).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    // ---------- SETTINGS — the same panel grammar, one screen back from the dashboard ----------
    // Reached from the gear in the rail; groups the personal controls (name · voice · mode · the apps
    // you can revoke). Not a separate window — the right pane flips, a back-chevron returns.
    private var settingsView: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Button(action: { withAnimation(.easeOut(duration: 0.14)) { showSettings = false } }) {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .bold)).foregroundColor(.inkDim)
                        .frame(width: 26, height: 26).background(Circle().fill(Color.panel).overlay(Circle().stroke(Color.edge, lineWidth: 1)))
                }.buttonStyle(.plain).help("Back")
                Text("Settings").font(.brico(18, .bold)).foregroundColor(.ink)
                Spacer()
            }.padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 14)
            Rectangle().fill(Color.edge).frame(height: 1)
            disclosure("name", "YOUR NAME", summary: model.userName.isEmpty ? "not set" : model.userName) { nameSection }
            Rectangle().fill(Color.edge).frame(height: 1)
            disclosure("voice", "GOD'S VOICE", summary: model.selectedVoice.isEmpty ? "Default" : model.selectedVoice) { voiceSection }
            Rectangle().fill(Color.edge).frame(height: 1)
            disclosure("mode", "MODE", summary: model.economy ? "Economy" : "Full quality") { economySection }
            Rectangle().fill(Color.edge).frame(height: 1)
            disclosure("models", "MODELS", summary: modelsSummary) { modelsSettingsSection }
            Rectangle().fill(Color.edge).frame(height: 1)
            disclosure("shortcuts", "KEYBOARD SHORTCUTS", summary: shortcutSummary, warn: !AXIsProcessTrusted()) { shortcutsSection }
            Rectangle().fill(Color.edge).frame(height: 1)
            disclosure("region", "WHAT GOD SEES", summary: model.defaultShare ? "Shared by default" : "Voice-first") { regionSection }
            Rectangle().fill(Color.edge).frame(height: 1)
            disclosure("guide", "GUIDED HELP", summary: guideVoiceover ? "Voiceover on" : "Voiceover off") { guideSection }
            Rectangle().fill(Color.edge).frame(height: 1)
            disclosure("connections", "CONNECTIONS", summary: "\(model.appList.count)") { connectionsSection }
            Rectangle().fill(Color.edge).frame(height: 1)
            Button(action: { showSettings = false; onTour() }) {
                HStack(spacing: 9) {
                    Image(systemName: "sparkles").font(.system(size: 12)).foregroundColor(.lime).frame(width: 18)
                    Text("Replay the welcome tour").font(.hanken(12.5, .medium)).foregroundColor(.ink)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundColor(.inkFaint)
                }.padding(.horizontal, 18).padding(.vertical, 15).contentShape(Rectangle())
            }.buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear { nameDraft = model.userName }
    }

    // A collapsible settings row: the kicker header stays visible with the section's current value on the
    // right (show, don't tell), a chevron rotates, and tapping reveals the controls. Accordion — opening one
    // closes the others — so the panel shows ~7 short rows by default instead of every control stacked tall.
    @ViewBuilder
    private func disclosure<Content: View>(_ id: String, _ title: String, summary: String,
                                           warn: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        let open = openSection == id
        Button(action: { withAnimation(.easeOut(duration: 0.16)) { openSection = open ? nil : id } }) {
            HStack(spacing: 8) {
                Text(title).kicker()
                Spacer(minLength: 8)
                if warn && !open {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundColor(.danger)
                }
                if !open && !summary.isEmpty {
                    Text(summary).font(.splMono(9.5)).foregroundColor(.inkFaint).lineLimit(1)
                }
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.inkFaint).rotationEffect(.degrees(open ? 0 : -90))
            }.padding(.horizontal, 18).padding(.vertical, 13).contentShape(Rectangle())
        }.buttonStyle(.plain)
        if open {
            content().padding(.horizontal, 18).padding(.bottom, 15)
        }
    }
    // Compact one-line recap of both gestures for the collapsed header.
    private var shortcutSummary: String {
        "\(modGlyph(model.shortcuts.summon))\(modGlyph(model.shortcuts.summon)) · \(talkGlyphs(model.shortcuts.talk))"
    }

    // YOUR NAME — the real greeting source (~/.relay/profile.json). Commit on Enter or the save button.
    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                TextField("What should I call you?", text: $nameDraft)
                    .textFieldStyle(.plain).font(.hanken(13)).foregroundColor(.ink)
                    .padding(.horizontal, 11).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel)
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1)))
                    .onSubmit(commitName)
                GhostButton(icon: "checkmark", label: "save", action: commitName)
                    .opacity(nameDirty ? 1 : 0.4).disabled(!nameDirty)
            }
            Text("God greets you by this name.").font(.hanken(10.5)).foregroundColor(.inkFaint)
        }
    }
    private var nameDirty: Bool {
        let n = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        return !n.isEmpty && n != model.userName
    }
    private func commitName() { if nameDirty { onSetName(nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)) } }

    // MODE — economy: one tap flips ~/.relay/economy, God then reaches for a cheaper/faster model.
    private var economySection: some View {
        VStack(alignment: .leading, spacing: 9) {
            Button(action: { onSetEconomy(!model.economy) }) {
                HStack(spacing: 11) {
                    Image(systemName: model.economy ? "leaf.fill" : "bolt.fill")
                        .font(.system(size: 13)).foregroundColor(model.economy ? .lime : .inkDim).frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.economy ? "Economy" : "Full quality").font(.hanken(13, .semibold)).foregroundColor(.ink)
                        Text(model.economy ? "Cheaper, faster model — spends fewer tokens." : "Best model for the job, more tokens.")
                            .font(.hanken(10.5)).foregroundColor(.inkFaint)
                    }
                    Spacer(minLength: 6)
                    RoundedRectangle(cornerRadius: 11).fill(model.economy ? Color.lime : Color.edge).frame(width: 38, height: 22)
                        .overlay(Circle().fill(Color.page).frame(width: 16, height: 16).offset(x: model.economy ? 8 : -8))
                        .animation(.easeOut(duration: 0.15), value: model.economy)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
        }
    }

    // GUIDED HELP — the two live-guide preferences, surfaced as Settings rows instead of shortcut-only:
    // spoken voiceover (fn m) as a toggle, and a reminder that screenshot+note feedback (fn ↓) works in
    // any guide. Reversible + legible: the toggle drives the SAME persisted key CursorGuide reads.
    private var guideSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: {
                guideVoiceover.toggle()
                CursorGuide.shared.setVoiceover(guideVoiceover)
            }) {
                HStack(spacing: 11) {
                    Image(systemName: guideVoiceover ? "speaker.wave.2.fill" : "speaker.slash.fill")
                        .font(.system(size: 13)).foregroundColor(guideVoiceover ? .lime : .inkDim).frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Voiceover").font(.hanken(13, .semibold)).foregroundColor(.ink)
                        Text(guideVoiceover ? "Each guide step is read aloud (⌥M to toggle live)."
                                            : "Guides stay silent (⌥M to toggle live).")
                            .font(.hanken(10.5)).foregroundColor(.inkFaint)
                    }
                    Spacer(minLength: 6)
                    RoundedRectangle(cornerRadius: 11).fill(guideVoiceover ? Color.lime : Color.edge).frame(width: 38, height: 22)
                        .overlay(Circle().fill(Color.page).frame(width: 16, height: 16).offset(x: guideVoiceover ? 8 : -8))
                        .animation(.easeOut(duration: 0.15), value: guideVoiceover)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            HStack(spacing: 11) {
                Image(systemName: "camera.viewfinder").font(.system(size: 13)).foregroundColor(.inkDim).frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Feedback on any step").font(.hanken(13, .semibold)).foregroundColor(.ink)
                    Text("In a guide, press ⌥↓ to grab a screenshot + leave a note.")
                        .font(.hanken(10.5)).foregroundColor(.inkFaint)
                }
                Spacer(minLength: 0)
            }
        }
    }

    // MODELS (docs/MODEL-SELECTION.md §8) — the user's allow/deny list. Each chip is a CHECKBOX: checked =
    // allowed, unchecked = in the ~/.relay/models.json deny-list (nothing, God or any wrapp, uses it). Two
    // "off"s never blur: disabled-by-choice = an unchecked box; OFFLINE (signed out / Ollama down) = dimmed
    // with its reason, checkbox state preserved. A last-of-class lock keeps at least one model of each class on.
    private let cloudModels: [(name: String, canon: String)] = [("Opus 4.8", "opus"), ("Sonnet", "sonnet"), ("Haiku", "haiku")]
    private var modelsSummary: String {
        let on = cloudModels.filter { !model.disabledModels.contains($0.canon) }.count
              + ollama.models.filter { !model.disabledModels.contains(canonicalModelId($0.name)) }.count
        let total = cloudModels.count + ollama.models.count
        return "\(on) of \(total) on"
    }
    private var modelsSettingsSection: some View {
        let cloudCanons = cloudModels.map { $0.canon }
        let localCanons = ollama.models.map { canonicalModelId($0.name) }
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                IconView(store: icons, key: "conn:claude", hosts: ["claude.ai"], symbol: "sparkle",
                         tint: model.signedIn ? .lime : .danger, bg: Color.panel, size: 15, corner: 4)
                Text(model.signedIn ? "CLAUDE CODE" : "CLAUDE CODE · SIGNED OUT").font(.splMono(9)).kerning(0.4)
                    .foregroundColor(model.signedIn ? .inkDim : .danger)
            }
            FlowLayout(spacing: 6) {
                ForEach(cloudModels, id: \.canon) { m in
                    modelToggle(name: m.name, canon: m.canon, offline: !model.signedIn, offlineReason: "signed out", classCanons: cloudCanons)
                }
            }
            HStack(spacing: 8) {
                ZStack { RoundedRectangle(cornerRadius: 4).fill(Color.raised)
                    Image(systemName: "cpu").font(.system(size: 9)).foregroundColor(.inkDim) }.frame(width: 15, height: 15)
                Text(ollama.up ? "OLLAMA" : "OLLAMA · NOT RUNNING").font(.splMono(9)).kerning(0.4).foregroundColor(.inkDim)
            }
            if !ollama.models.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(ollama.models) { m in
                        modelToggle(name: m.name, canon: canonicalModelId(m.name), offline: !ollama.up, offlineReason: "Ollama off", classCanons: localCanons)
                    }
                }
            } else if ollama.up {
                Text("No local models — pull one with `ollama pull`").font(.hanken(11)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
            }
            Text("Turn a model off and nothing — God or any wrapp — will use it. At least one per group stays on.")
                .font(.hanken(10.5)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
        }
    }
    // One toggle chip. `classCanons` = the canonical ids in this model's class (cloud or local); the LAST
    // enabled one of a class is locked (can't be unchecked) so an allowed set is never empty.
    private func modelToggle(name: String, canon: String, offline: Bool, offlineReason: String, classCanons: [String]) -> some View {
        let enabled = !model.disabledModels.contains(canon)
        let enabledInClass = classCanons.filter { !model.disabledModels.contains($0) }
        let locked = enabled && enabledInClass.count <= 1     // last one on in its class → can't turn it off
        return Button(action: { if !locked { onSetModelDisabled(name, enabled) } }) {
            HStack(spacing: 7) {
                Image(systemName: locked ? "lock.fill" : (enabled ? "checkmark.square.fill" : "square"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(locked ? .inkFaint : (enabled ? .lime : .inkFaint))
                Text(name).font(canon == name ? .splMono(11) : .hanken(11, .medium))
                    .foregroundColor(enabled ? .ink : .inkFaint).lineLimit(1)
                if offline {
                    Text(offlineReason).font(.splMono(9)).foregroundColor(.inkFaint)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 9).fill(enabled ? Color.lime.opacity(0.09) : Color.panel)
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(enabled ? Color.lime.opacity(0.45) : Color.edge, lineWidth: 1)))
            .opacity(offline ? 0.55 : 1)
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
         .help(locked ? "At least one model in this group must stay on"
                      : (offline ? "\(name) is \(offlineReason) right now — it stays \(enabled ? "allowed" : "off") once it's back"
                                 : (enabled ? "On — turn off so nothing uses it" : "Off — turn back on")))
    }

    // KEYBOARD SHORTCUTS — the two global gestures, listed in-place with a live tester and a rebind menu.
    // Both ride one passive modifier monitor (installHotKey) that needs Accessibility to observe keys from
    // other apps; if it isn't trusted the gestures silently no-op, so that's the first thing we surface.
    // Press a gesture and its row flashes "detected" (via the pulses onboard stamps on detection); once
    // used it shows "used Ns ago" — proof it fired even if summoning God pulled focus off this panel.
    // Rebinding is a CURATED pick, not free recording: the passive monitor only sees modifiers, so the
    // grammar is fixed (double-tap one modifier / hold a two-modifier chord) and you choose among presets.
    private var shortcutsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !AXIsProcessTrusted() {
                Button(action: onFixSenses) {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundColor(.danger)
                        Text("Shortcuts need Accessibility to work from other apps.").font(.hanken(10.5)).foregroundColor(.inkDim)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Text("Grant").font(.hanken(10.5, .semibold)).foregroundColor(.lime)
                    }.padding(.horizontal, 10).padding(.vertical, 8)
                     .background(RoundedRectangle(cornerRadius: 8).fill(Color.danger.opacity(0.06))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.danger.opacity(0.3), lineWidth: 1)))
                     .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
            VStack(spacing: 0) {
                shortcutRow(glyphs: [modGlyph(model.shortcuts.summon), modGlyph(model.shortcuts.summon)],
                            title: "Summon God", sub: "Double-tap to see, hear, help.", pulse: onboard.lastSummon) {
                    rebindMenu(options: SUMMON_OPTIONS, current: model.shortcuts.summon,
                               label: { "Double-tap \(modGlyph($0))" }) { onSetShortcut("summon", $0) }
                }
                shortcutRow(glyphs: model.shortcuts.talk.split(separator: "+").map { modGlyph(String($0)) },
                            title: "Hold to talk", sub: "Hold to dictate at your cursor.", pulse: onboard.lastDictate) {
                    rebindMenu(options: TALK_OPTIONS, current: model.shortcuts.talk,
                               label: { "Hold \(talkGlyphs($0))" }) { onSetShortcut("talk", $0) }
                }
            }
            Text("Global — works from any app. Press one now; it should light up here.")
                .font(.hanken(10.5)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
        }
    }
    // A keycap chip — the glyph in a bordered square, panel-grammar.
    private func keycap(_ s: String) -> some View {
        Text(s).font(.splMono(12)).foregroundColor(.ink)
            .frame(minWidth: 15).padding(.horizontal, 7).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.panel)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.edge, lineWidth: 1)))
    }
    private func shortcutRow<Trailing: View>(glyphs: [String], title: String, sub: String, pulse: Date?,
                                             @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 11) {
            HStack(spacing: 4) { ForEach(Array(glyphs.enumerated()), id: \.offset) { keycap($0.element) } }
                .frame(width: 62, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.hanken(13, .semibold)).foregroundColor(.ink)
                Text(sub).font(.hanken(10.5)).foregroundColor(.inkFaint)
            }
            Spacer(minLength: 6)
            // Refresh once a second so "detected" decays back to "used Ns ago" on its own.
            TimelineView(.periodic(from: Date(), by: 1)) { ctx in testPill(pulse: pulse, now: ctx.date) }
            trailing()
        }.padding(.vertical, 7)
    }
    // The rebind picker — a compact popup of the allowed presets, current one check-marked. Mac-idiomatic
    // Menu (not a custom recorder), which is the whole "limit what can be done" point.
    private func rebindMenu(options: [String], current: String, label: @escaping (String) -> String,
                            onPick: @escaping (String) -> Void) -> some View {
        Menu {
            ForEach(options, id: \.self) { opt in
                Button(action: { onPick(opt) }) {
                    if opt == current { Label(label(opt), systemImage: "checkmark") } else { Text(label(opt)) }
                }
            }
        } label: {
            Image(systemName: "slider.horizontal.3").font(.system(size: 11)).foregroundColor(.inkFaint)
                .frame(width: 24, height: 22)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.panel)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.edge, lineWidth: 1)))
        }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Change this shortcut")
    }
    @ViewBuilder private func testPill(pulse: Date?, now: Date) -> some View {
        if let p = pulse, now.timeIntervalSince(p) < 2.2 {
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 10))
                Text("detected").font(.hanken(10, .semibold))
            }.foregroundColor(.lime)
        } else if let p = pulse {
            Text("used \(agoLabel(now.timeIntervalSince(p)))").font(.splMono(9)).foregroundColor(.inkFaint)
        } else {
            Text("press to test").font(.splMono(9)).foregroundColor(.inkFaint)
        }
    }
    private func agoLabel(_ secs: TimeInterval) -> String {
        let s = Int(max(0, secs))
        if s < 60 { return "\(s)s ago" }
        if s < 3600 { return "\(s / 60)m ago" }
        return "\(s / 3600)h ago"
    }

    // ⌃⌃ CAPTURE — capture is explicit + fn-gated now, so the pointer stays free while you talk. This is
    // just the legend for what you can do during a ⌃⌃: nothing (whole screen), fn+click, fn+drag, or drop.
    private func captureRow(_ icon: String, _ title: String, _ sub: String) -> some View {
        HStack(spacing: 11) {
            Image(systemName: icon).font(.system(size: 13)).foregroundColor(.inkDim).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.hanken(13, .semibold)).foregroundColor(.ink)
                Text(sub).font(.hanken(10.5)).foregroundColor(.inkFaint)
            }
            Spacer(minLength: 6)
        }
    }
    private var regionSection: some View {
        let shared = model.defaultShare
        return VStack(alignment: .leading, spacing: 12) {
            // The one real setting — everything below it is a legend that INVERTS with this toggle.
            Button(action: { onSetDefaultShare(!shared) }) {
                HStack(spacing: 11) {
                    Image(systemName: shared ? "eye.fill" : "eye.slash.fill")
                        .font(.system(size: 13)).foregroundColor(shared ? .lime : .inkDim).frame(width: 18)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Share my screen with God by default").font(.hanken(13, .semibold)).foregroundColor(.ink)
                        Text(shared ? "A plain ⌃⌃ shares your whole screen while you talk."
                                    : "A plain ⌃⌃ is voice-only — you fn-grab to share.")
                            .font(.hanken(10.5)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 6)
                    RoundedRectangle(cornerRadius: 11).fill(shared ? Color.lime : Color.edge).frame(width: 38, height: 22)
                        .overlay(Circle().fill(Color.page).frame(width: 16, height: 16).offset(x: shared ? 8 : -8))
                        .animation(.easeOut(duration: 0.15), value: shared)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            Rectangle().fill(Color.edge).frame(height: 1).opacity(0.6)
            // The legend — honest for BOTH modes (the old "Just talk → whole screen" was stale when off).
            if shared {
                captureRow("rectangle.inset.filled", "Just talk", "God sees your whole screen — shared the moment you speak.")
                captureRow("cursorarrow.click", "fn + click", "Take the share back — voice-only for this turn.")
                captureRow("rectangle.dashed", "fn + drag", "Share just a region instead of the whole screen.")
            } else {
                captureRow("rectangle.inset.filled", "Just talk", "Voice only — nothing on your screen is shared.")
                captureRow("cursorarrow.click", "fn + click", "Deliberately share the whole screen.")
                captureRow("rectangle.dashed", "fn + drag", "Rubber-band a region to share just that.")
            }
            captureRow("doc.badge.plus", "Drop a file on the notch", "Give God a file as reference while you talk.")
        }
    }

    // CONNECTIONS — the apps + sites you've let in. Remove revokes access now; they re-ask next time.
    // (claude.ai connectors themselves are inherited by the SDK and managed in Claude, not here.)
    private var connectionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Wire a Claude Code session to this project's board (task pickup + wrapps) — persistent home
            // for the same card onboarding shows, so it's findable and shows "connected" once set up.
            ConnectClaudeCodeCard(compact: true)
            if model.appList.isEmpty {
                Text("Nothing connected yet — open a wrapp and it'll ask.").font(.hanken(11)).foregroundColor(.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                // Cap it so a long connection list scrolls INSIDE the panel instead of stretching the
                // whole notch taller than the screen.
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) { ForEach(model.appList) { connectionRow($0) } }
                }.frame(maxHeight: 236)
            }
        }
    }
    private func kindLabel(_ kind: AppKind) -> String {
        switch kind { case .web: return "website"; case .native: return "app"; case .iphone: return "iPhone"; case .tab: return "browser tab" }
    }
    private func connectionRow(_ app: AppRow) -> some View {
        HStack(spacing: 10) {
            Button(action: { onOpen(app) }) {
                HStack(spacing: 10) {
                    appIcon(app, size: 26)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(app.label).font(.hanken(12.5, .medium)).foregroundColor(.ink).lineLimit(1)
                        Text(app.tools > 0 ? "\(app.tools) tool\(app.tools == 1 ? "" : "s") · \(kindLabel(app.kind))" : kindLabel(app.kind))
                            .font(.splMono(9)).foregroundColor(.inkFaint)
                    }
                    Spacer(minLength: 6)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).help("Open \(app.label)")
            Button(action: {
                if app.kind == .native, let id = app.appId { onDisconnect(id) } else { onRevoke(app.id) }
            }) {
                Text("Remove").font(.hanken(10.5, .semibold)).foregroundColor(.danger)
                    .padding(.horizontal, 9).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 7).stroke(Color.danger.opacity(0.4), lineWidth: 1))
            }.buttonStyle(.plain).help("Revoke this connection")
        }.padding(.vertical, 7)
    }

    // ============================ ONBOARDING (docs/ONBOARDING.md) ============================
    // ---- Act I: the setup ladder — one rung at a time, honest observed-vs-inferred, always skippable.
    // Action fields are kept flat (icon/label/run), not a tuple-optional — an optional-of-tuple-with-a-
    // closure inside a ternary detonates Swift's type-checker.
    private struct Rung { let title: String; let sub: String; let done: Bool; let inferred: Bool
                          let icon: String?; let label: String?; let run: (() -> Void)? }
    private func openHub() { NSWorkspace.shared.open(ONBOARD_HUB) }
    private var rungs: [Rung] {
        let sensesOK: Bool = GodPerm.allCases.allSatisfy { $0.granted }
        let extOK: Bool = model.appList.contains { $0.kind == .web }   // a web app connecting proves the extension
        let signedIn: Bool = model.signedIn && model.running
        var out: [Rung] = []
        out.append(Rung(title: "Switchboard running", sub: "The daemon that holds your Claude and tools.",
                        done: model.running, inferred: false,
                        icon: "play.fill", label: "start", run: onRestart))
        out.append(Rung(title: "Signed in to Claude", sub: "Runs on your own Claude Code login — no key, no bill.",
                        done: signedIn, inferred: false,
                        icon: "arrow.right.square", label: "sign in", run: onSignIn))
        out.append(Rung(title: "God's senses", sub: "Mic, Accessibility and Screen Recording — so ⌃⌃ can see and act.",
                        done: sensesOK, inferred: false,
                        icon: "hand.raised", label: "grant", run: onFixSenses))
        out.append(Rung(title: "Browser extension", sub: "For web wrapps — injects window.claude into any page.",
                        done: extOK, inferred: true,
                        icon: "puzzlepiece.extension", label: "get it", run: { self.openHub() }))
        out.append(Rung(title: "Your first app", sub: "Open the store and connect one — that's the whole point.",
                        done: model.apps > 0, inferred: false,
                        icon: "bag", label: "store", run: { self.openHub() }))
        return out
    }
    private var firstUnmet: Int { rungs.firstIndex { !$0.done } ?? rungs.count }
    private var setupReady: Bool { model.running && model.signedIn }   // the two hard blockers for the tour

    private var setupView: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 6).fill(Color.lime).frame(width: 20, height: 20)
                    .overlay(Circle().fill(Color.rail).frame(width: 6, height: 6).offset(x: 5.5, y: -5.5))
                    .shadow(color: Color.lime.opacity(0.4), radius: 6)
                Text("Welcome to Switchboard").font(.brico(18, .bold)).foregroundColor(.ink)
                Spacer()
                Button(action: { onboard.finish() }) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundColor(.inkFaint)
                }.buttonStyle(.plain).help("Skip onboarding")
            }.padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 3)
            Text("\(rungs.filter { $0.done }.count) of \(rungs.count) set up · a few one-time steps, then a 30-second tour.")
                .font(.hanken(11.5)).foregroundColor(.inkDim).padding(.horizontal, 18).padding(.bottom, 13)
            Rectangle().fill(Color.edge).frame(height: 1)
            VStack(spacing: 0) {
                ForEach(Array(rungs.enumerated()), id: \.offset) { i, r in
                    rungRow(r, active: i == firstUnmet)
                    if i < rungs.count - 1 { Rectangle().fill(Color.edge).frame(height: 1) }
                }
            }
            Rectangle().fill(Color.edge).frame(height: 1)
            HStack(spacing: 12) {
                // Act I (mechanical ladder) → Act II is now the floating-cursor concierge (CursorGuide .tour).
                // finish() dismisses the native setup card + marks onboarded; onTour() floats the guide.
                Button(action: { onboard.finish(); onTour() }) {
                    HStack(spacing: 7) {
                        Text(setupReady ? "Take the tour" : "Skip to the tour").font(.hanken(12.5, .semibold))
                        Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold))
                    }
                    .foregroundColor(setupReady ? .page : .ink)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 9).fill(setupReady ? Color.lime : Color.clear)
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(setupReady ? Color.clear : Color.edge, lineWidth: 1)))
                }.buttonStyle(.plain)
                Spacer()
            }.padding(18)
            Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    private func rungRow(_ r: Rung, active: Bool) -> some View {
        HStack(spacing: 11) {
            ZStack {
                Circle().fill(r.done ? Color.lime.opacity(0.15) : Color.panel).frame(width: 24, height: 24)
                if r.done { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundColor(.lime) }
                else { Circle().stroke(active ? Color.lime : Color.edge, lineWidth: 1.5).frame(width: 12, height: 12) }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(r.title).font(.hanken(12.5, .semibold)).foregroundColor(r.done ? .inkDim : .ink)
                    if r.inferred && !r.done { Text("can't auto-check").font(.splMono(8.5)).foregroundColor(.inkFaint) }
                }
                if active && !r.done { Text(r.sub).font(.hanken(10.5)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 6)
            if active, !r.done, let icon = r.icon, let label = r.label, let run = r.run {
                GhostButton(icon: icon, label: label, action: run)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .opacity(r.done ? 0.7 : (active ? 1 : 0.45))
    }

    // ---- Act II: the practice run — teach-by-doing. Each step advances on the REAL gesture (or Skip).
    private struct TourStep { let title: String; let hint: String; let manual: Bool }
    private var tourSteps: [TourStep] { [
        TourStep(title: "Press ⌃⌃", hint: "Tap Control twice — I look at your screen and help.", manual: false),
        TourStep(title: "Ask me to make something", hint: "Press ⌃⌃ and say it — \"make me an image\", \"summarize this\", \"draft an ad\". I run the right app on your Claude; the result lands in your notch to copy or drag out.", manual: false),
        TourStep(title: "I remember", hint: "Keep going — answer my question, ask a follow-up. I stay in the conversation across ⌃⌃ presses.", manual: false),
        TourStep(title: "This is your Switchboard", hint: "Your apps, models and tools — all on your own Claude.", manual: true),
        TourStep(title: "Open Settings", hint: "The gear, bottom-left — your name, my voice, economy mode.", manual: false),
        TourStep(title: "Hold ⌃⌥ to talk", hint: "Hold Control-Option and speak — I type it where your cursor is.", manual: false),
    ] }
    private var tourStrip: some View {
        let s = tourSteps[min(onboard.step, tourSteps.count - 1)]
        return HStack(spacing: 12) {
            Text("\(onboard.step + 1)/\(tourSteps.count)").font(.splMono(9.5)).foregroundColor(.inkFaint)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.title).font(.hanken(12.5, .semibold)).foregroundColor(.ink)
                Text(s.hint).font(.hanken(10.5)).foregroundColor(.inkDim).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if s.manual {
                GhostButton(icon: "arrow.right", label: "got it", action: { onboard.advance() })
            } else {
                HStack(spacing: 5) {
                    Circle().fill(Color.lime).frame(width: 5, height: 5)
                        .opacity(breathe ? 1 : 0.3).animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: breathe)
                    Text("try it").font(.hanken(10, .semibold)).foregroundColor(.lime)
                }.padding(.horizontal, 9).padding(.vertical, 5).background(Capsule().stroke(Color.lime.opacity(0.4), lineWidth: 1))
            }
            Button(action: { onboard.advance() }) { Text("skip").font(.hanken(10)).foregroundColor(.inkFaint) }.buttonStyle(.plain)
        }.padding(.horizontal, 18).padding(.vertical, 11).background(Color.rail)
    }

    // ---- The finish line.
    private var doneView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Spacer(minLength: 24)
            HStack(spacing: 11) {
                Image(systemName: "checkmark.seal.fill").font(.system(size: 24)).foregroundColor(.lime)
                Text("You're all set").font(.brico(20, .bold)).foregroundColor(.ink)
            }
            Text("Press ⌃⌃ anytime to summon me. Everything else lives in this panel — replay the tour from Settings whenever.")
                .font(.hanken(12)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
            // One power-up worth doing now: a Claude Code session that reads your board (task pickup) +
            // runs wrapps. We raise it as a Run-it card in the NOTCH on finish; it also lives in Settings.
            Text("I've popped a “Connect Claude Code” card into your notch — one click wires a Claude Code session to your board so Guru and this OS can pick up tasks. It's also in Settings → Connections.")
                .font(.hanken(11.5)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
            GhostButton(icon: "checkmark", label: "done", action: { onboard.finish() })
            Spacer(minLength: 0)
        }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear { onConnectClaudeNotch() }
    }

    // apps — the real-icon row across the top
    private var storeCapsule: some View {
        Button(action: onStore) {
            HStack(spacing: 5) {
                Image(systemName: "square.grid.2x2.fill").font(.system(size: 9))
                Text("STORE").font(.splMono(9.5)).kerning(0.8)
                Image(systemName: "arrow.up.forward").font(.system(size: 8, weight: .bold))
            }
            .foregroundColor(.lime)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Capsule().fill(Color.lime.opacity(0.12)))
        }.buttonStyle(.plain).help("Browse every wrapp you can run")
    }
    // A connected app's status: active (behind the current activity) · ready (seen recently) · idle (quiet).
    private func appStatus(_ app: AppRow) -> AppStatus {
        if model.working, let l = model.last, l.origin == app.id { return .active }
        if Date().timeIntervalSince1970 - app.lastSeen < 120 { return .ready }
        return .idle
    }
    // Removing works for EVERY app kind now (native → disconnect, web/tab/iphone → revoke by origin) — the
    // web-app ✕ used to be reachable only from Settings.
    private func removeAction(_ app: AppRow) -> (() -> Void)? {
        if app.kind == .native, let id = app.appId { return { onDisconnect(id) } }
        return { onRevoke(app.id) }
    }
    private var appsRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Text("CONNECTED APPS").kicker(); Text("· \(model.apps)").font(.splMono(9.5)).foregroundColor(.inkFaint)
                Spacer(); storeCapsule
            }.padding(.trailing, 18)
            if model.appList.isEmpty {
                Text("No apps yet — open a wrapp and it'll ask to connect.").font(.label).foregroundColor(.inkFaint)
                    .fixedSize(horizontal: false, vertical: true).padding(.trailing, 18)
            } else {
                HDragScroll(height: 118) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(model.appList) { app in
                            AppCardView(
                                icon: AnyView(appIcon(app, size: 38)
                                    .overlay(alignment: .bottomTrailing) { platformBadge(app.kind).offset(x: 4, y: 4) }),
                                label: app.label, status: appStatus(app), dim: app.kind == .tab,
                                onRemove: removeAction(app))
                        }
                    }.padding(.trailing, 18).padding(.vertical, 2)
                }
            }
        }.padding(.leading, 18).padding(.vertical, 16)
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

    // ---------- COMMAND CENTRE — pick the model right here (task #5). Tapping a card allows/denies it in
    // ~/.relay/models.json (the SAME deny-list Settings writes; a denied model is used by nothing — God or any
    // wrapp); the last model of a class stays locked ON. Loaded local models keep an ⏏ to free memory. ----
    private var commandMeta: String {
        let cloud = model.signedIn ? "Claude Code" : "signed out"
        if ollama.up && ollama.loadedCount > 0 { return "\(cloud) · \(ollama.loadedCount) local loaded" }
        return cloud
    }
    private var commandCentreSection: some View {
        let cloudCanons = cloudModels.map { $0.canon }
        let localCanons = ollama.models.map { canonicalModelId($0.name) }
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Text("COMMAND CENTRE").kicker(); Text("· model").font(.splMono(9.5)).foregroundColor(.inkFaint)
                Spacer(); Text(commandMeta).font(.splMono(9.5)).foregroundColor(.inkDim)
            }.padding(.trailing, 18)
            HDragScroll(height: 68) {
                HStack(spacing: 10) {
                    ForEach(cloudModels, id: \.canon) { m in
                        modelCard(name: m.name, canon: m.canon, provider: "claude", detail: "cloud",
                                  offline: !model.signedIn, live: false, classCanons: cloudCanons, onUnload: nil)
                    }
                    if !ollama.models.isEmpty {
                        Rectangle().fill(Color.edge).frame(width: 1, height: 46).padding(.horizontal, 2)   // a hairline provider seam — never dots
                        ForEach(ollama.models) { m in
                            modelCard(name: m.name, canon: canonicalModelId(m.name), provider: "ollama",
                                      detail: m.loaded ? (m.expiresIn.isEmpty ? String(format: "%.1fGB", m.vramGB) : m.expiresIn) : (m.sizeGB > 0 ? String(format: "%.1fGB", m.sizeGB) : "local"),
                                      offline: !ollama.up, live: m.loaded, classCanons: localCanons,
                                      onUnload: m.loaded ? { ollama.unload(m.name) } : nil)
                        }
                    } else if ollama.up {
                        Text("No local models\n`ollama pull`").font(.monoSm).foregroundColor(.inkFaint)
                            .frame(width: 130, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 11).sbCard()
                    }
                }.padding(.trailing, 18).padding(.vertical, 2)
            }
        }.padding(.leading, 18).padding(.vertical, 14)
    }
    private func modelCard(name: String, canon: String, provider: String, detail: String,
                           offline: Bool, live: Bool, classCanons: [String], onUnload: (() -> Void)?) -> some View {
        let enabled = !model.disabledModels.contains(canon)
        let enabledInClass = classCanons.filter { !model.disabledModels.contains($0) }
        let locked = enabled && enabledInClass.count <= 1     // last one on in its class → can't turn it off
        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 7) {
                if live { Circle().fill(Color.lime).frame(width: 6, height: 6).shadow(color: Color.lime.opacity(0.5), radius: 3) }
                Image(systemName: provider == "claude" ? "sparkle" : "cpu").font(.system(size: 9)).foregroundColor(.inkDim)
                Text(name).font(provider == "ollama" ? .splMono(11) : .hanken(12, .semibold))
                    .foregroundColor(enabled ? .ink : .inkFaint).lineLimit(1)
            }
            HStack(spacing: 6) {
                Text(offline ? (provider == "claude" ? "signed out" : "offline") : detail).font(.monoSm).foregroundColor(.inkFaint)
                Spacer(minLength: 6)
                if let u = onUnload {
                    Button(action: u) { Image(systemName: "eject.fill").font(.system(size: 9)).foregroundColor(.inkFaint) }
                        .buttonStyle(.plain).help("Unload now, free the memory")
                }
                if locked {
                    HStack(spacing: 3) { Image(systemName: "lock.fill").font(.system(size: 8)); Text("ON").font(.splMono(9)).kerning(0.6) }.foregroundColor(.inkFaint)
                } else {
                    Text(enabled ? "ON" : "OFF").font(.splMono(9)).kerning(0.8).foregroundColor(enabled ? .lime : .inkFaint)
                }
            }
        }
        .frame(width: 130, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 11)
        .sbCard(active: enabled)
        .opacity(enabled ? (offline ? 0.6 : 1) : 0.5)
        .contentShape(Rectangle())
        .onTapGesture { if !locked { onSetModelDisabled(name, enabled) } }
        .help(locked ? "At least one \(provider == "claude" ? "cloud" : "local") model stays on"
                     : (enabled ? "Tap to turn off — nothing will use it" : "Tap to turn on"))
    }

    // tools — real brand logos, a horizontal card rail (matching apps + command centre, one grammar)
    private var toolsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Text("TOOLS").kicker(); Text("· \(model.connectors.count) connector\(model.connectors.count == 1 ? "" : "s")").font(.splMono(9.5)).foregroundColor(.inkFaint)
                Spacer(); Text("\(model.toolCount) tools").font(.splMono(9.5)).foregroundColor(.inkDim)
            }.padding(.trailing, 18)
            if model.connectors.isEmpty {
                Text("Warming up…").font(.label).foregroundColor(.inkFaint).padding(.trailing, 18)
            } else {
                HDragScroll(height: 88) {
                    HStack(spacing: 10) { ForEach(model.connectors) { toolCard($0) } }.padding(.trailing, 18).padding(.vertical, 2)
                }
            }
        }.padding(.leading, 18).padding(.vertical, 14)
    }
    private func toolCard(_ c: Connector) -> some View {
        VStack(spacing: 8) {
            IconView(store: icons, key: "conn:" + normalizeConnector(c.name),
                     hosts: connectorDomain(c.name).map { [$0] } ?? [], symbol: connectorSymbol(c.name),
                     tint: c.ok ? .inkDim : .inkFaint, bg: Color.panel, size: 26, corner: 6)
            Text(c.name).font(.label).foregroundColor(c.ok ? .ink : .inkDim).lineLimit(1)
            Text(c.ok ? "· \(c.tools) tools" : "offline").font(.monoSm).foregroundColor(c.ok ? .inkFaint : .danger)
        }
        .frame(width: 100)
        .padding(.horizontal, 10).padding(.vertical, 11)
        .sbCard()
        .opacity(c.ok ? 1 : 0.55)
    }

    @ViewBuilder private var rightPane: some View {
        switch onboard.phase {
        case .setup: setupView
        case .done:  doneView
        default:     if showSettings { settingsView } else { content }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                rail
                Rectangle().fill(Color.edge).frame(width: 1)
                rightPane
            }
            // Act II rides as a full-width strip UNDER the panel, so it survives a pane switch (it can
            // watch the gear step fire over the Settings pane) and never fights the dashboard layout.
            if onboard.phase == .tour {
                Rectangle().fill(Color.edge).frame(height: 1)
                tourStrip
            }
        }
        .frame(width: 620)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 14)   // room for the tab ears (the shape flares to full width at the top)
        .background(
            // USE A: the living background lamp-field — atmosphere in the true-black gutters + content plane.
            // Texture, not "live": ~5% opacity, speeds up while the daemon works, danger-tinted when signed-out.
            ZStack {
                Color.page
                PanelDotField(accent: signedOut ? .danger : .lime, speed: model.working ? 2.4 : 1.0)
            }
        )
        .clipShape(NotchDropShape())   // no stroke — the black shape blends into the notch, no grey line
        .ignoresSafeArea()
        .onAppear { breathe = true }
        .onChange(of: showSettings) { open in if open { onboard.note(.settings) } }   // tour step 2
    }
}

extension Text {
    func kicker() -> some View {
        self.font(.splMono(9.5)).kerning(1.4).foregroundColor(.inkFaint)
    }
}

/// The panel silhouette — a shape that DROPS from the notch. The top edge is inset by `topR` and
/// flares out to full width with CONCAVE corners (the notch "ears"), so the black body reads as one
/// piece with the notch / black menu bar instead of a hard-cornered rectangle. Convex `botR` rounds
/// the bottom. `UnevenRoundedRectangle` can't make concave corners — hence a hand-built path.
/// NOTE: `topR` is the notch-corner feel; pixel-tune it on a real run (0 ⇒ squared top for non-notch).
struct NotchDropShape: Shape {
    var ear: CGFloat = 14    // the CSS-tab "ear": top is FULL width, flares in via a concave fillet
    var botR: CGFloat = 20
    func path(in r: CGRect) -> Path {
        let w = r.width, h = r.height
        let e = min(ear, w / 2), b = min(botR, (w - 2 * e) / 2)
        var p = Path()
        p.move(to: CGPoint(x: 0, y: 0))                                                      // top-left outer (on the bar)
        p.addLine(to: CGPoint(x: w, y: 0))                                                   // flat top edge (against the bar — invisible)
        p.addQuadCurve(to: CGPoint(x: w - e, y: e), control: CGPoint(x: w - e, y: 0))        // right inverted corner: curves DOWN & in
        p.addLine(to: CGPoint(x: w - e, y: h - b))                                           // right body side (inset by the ear)
        p.addQuadCurve(to: CGPoint(x: w - e - b, y: h), control: CGPoint(x: w - e, y: h))    // convex bottom-right
        p.addLine(to: CGPoint(x: e + b, y: h))                                               // bottom edge
        p.addQuadCurve(to: CGPoint(x: e, y: h - b), control: CGPoint(x: e, y: h))            // convex bottom-left
        p.addLine(to: CGPoint(x: e, y: e))                                                   // left body side
        p.addQuadCurve(to: CGPoint(x: 0, y: 0), control: CGPoint(x: e, y: 0))                // left inverted corner: curves UP & out
        p.closeSubpath()
        return p
    }
}

/// The panel OUTLINE — sides + bottom only. The top edge sits flush against the black notch/menu bar,
/// so stroking it drew a wrong line across the top; this open path omits it. Matches NotchDropShape.
struct NotchDropOutline: Shape {
    var ear: CGFloat = 14
    var botR: CGFloat = 20
    func path(in r: CGRect) -> Path {
        let w = r.width, h = r.height
        let e = min(ear, w / 2), b = min(botR, (w - 2 * e) / 2)
        var p = Path()
        p.move(to: CGPoint(x: 0, y: 0))                                                      // left top-outer (on the bar)
        p.addQuadCurve(to: CGPoint(x: e, y: e), control: CGPoint(x: e, y: 0))                // left inverted corner: down & in
        p.addLine(to: CGPoint(x: e, y: h - b))                                               // left side
        p.addQuadCurve(to: CGPoint(x: e + b, y: h), control: CGPoint(x: e, y: h))
        p.addLine(to: CGPoint(x: w - e - b, y: h))                                           // bottom
        p.addQuadCurve(to: CGPoint(x: w - e, y: h - b), control: CGPoint(x: w - e, y: h))
        p.addLine(to: CGPoint(x: w - e, y: e))                                               // right side
        p.addQuadCurve(to: CGPoint(x: w, y: 0), control: CGPoint(x: w - e, y: 0))            // right inverted corner: up & out
        return p                                                                              // open — the flat top edge between the ears is unstroked
    }
}

/// Embeds an already-built WKWebView (the notch web-widget host's) into SwiftUI, so a live web widget can
/// sit inside the notch-drop silhouette with the rest of the command-centre grammar.
struct WKWebViewHolder: NSViewRepresentable {
    let web: NSView
    func makeNSView(context: Context) -> NSView { web }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

/// The notch drop that hosts a wrapp's LIVE web widget: shared notch chrome (silhouette · Color.page · one
/// lime accent) × the wrapp's WKWebView. A slim header carries the kicker + a close chip; the web content
/// fills a fixed glance-sized frame below it.
// The web widget's live content height (measured from the page's document.body.scrollHeight), so the notch
// sizes to the widget instead of a fixed 300px block of empty space — and grows as results render.
@MainActor final class NotchWebHeight: ObservableObject { @Published var content: CGFloat = 200 }
let notchWebMaxH: CGFloat = 620   // beyond this the widget scrolls internally (keeps the drop on-screen)

struct NotchWebDrop: View {
    let web: NSView
    let title: String
    @ObservedObject var height: NotchWebHeight
    var onClose: () -> Void = {}
    var body: some View {
        VStack(alignment: .leading, spacing: WK.s3) {
            HStack(alignment: .center, spacing: WK.s3) {
                Circle().fill(Color.lime).frame(width: 6, height: 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text("WIDGET").kicker()
                    Text(title).font(.brico(14, .semibold)).foregroundColor(.ink).lineLimit(1)
                }
                Spacer(minLength: WK.s3)
                WKIconChip(icon: "xmark", action: onClose)
            }
            WKHairline()
            WKWebViewHolder(web: web)
                .frame(width: WK.width - 2 * (WK.ear + WK.padH), height: max(90, min(height.content, notchWebMaxH)))
                .clipShape(RoundedRectangle(cornerRadius: SBr.md))
                .overlay(RoundedRectangle(cornerRadius: SBr.md).stroke(Color.edge, lineWidth: WK.hair))
        }
        .padding(.top, WK.s5).padding(.horizontal, WK.ear + WK.padH).padding(.bottom, WK.s6)
        .frame(width: WK.width, alignment: .leading)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: WK.ear, botR: 24))
        .overlay(NotchDropShape(ear: WK.ear, botR: 24).stroke(Color.edge.opacity(0.5), lineWidth: WK.hair))
    }
}

/// THE NOTCH FIELD — the dot-matrix rendered FULL-BLEED (Canvas, so it fills any size edge-to-edge
/// instead of a fixed cols×rows grid that floats centred). Same brightness math as `DotMatrix`: a calm
/// "thinking" sweep at rest, a travelling "working" wave while a model runs. Health-tinted by the caller
/// (lime ready · red signed-out · faint offline). This is what fills the real notch silhouette.
struct NotchField: View {
    var accent: Color
    var working: Bool
    var animated: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private func bright(_ c: Int, _ r: Int, _ t: Double) -> Double {
        let cx = Double(c), rx = Double(r)
        if working { return 0.16 + 0.84 * (0.5 + 0.5 * sin(cx * 0.55 - t * 2.6)) }   // travelling wave
        let s = 0.5 + 0.5 * sin((cx + rx) * 0.6 - t * 2.1)                            // diagonal sweep
        return 0.13 + 0.87 * (s * s * s)
    }
    private func draw(_ ctx: GraphicsContext, _ size: CGSize, _ t: Double) {
        // Lamp density matches the dictation DotMatrix (founder-approved 2026-08-13, "chunky lamps"):
        // pitch 6 / dot 3 — bolder + less dense than the old fine field (pitch 4 / dot 1.8).
        let gap: CGFloat = 6.0, d: CGFloat = 3.0
        let cols = max(1, Int(size.width / gap)), rows = max(1, Int(size.height / gap))
        let ox = (size.width - CGFloat(cols - 1) * gap) / 2, oy = (size.height - CGFloat(rows - 1) * gap) / 2
        for c in 0..<cols {
            for r in 0..<rows {
                let x = ox + CGFloat(c) * gap - d / 2, y = oy + CGFloat(r) * gap - d / 2
                ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: d, height: d)), with: .color(accent.opacity(bright(c, r, t))))
            }
        }
    }
    var body: some View {
        if reduceMotion || !animated { Canvas { ctx, size in draw(ctx, size, 0.6) } }   // a still, legible mid-frame
        else { TimelineView(.animation) { tl in Canvas { ctx, size in draw(ctx, size, tl.date.timeIntervalSinceReferenceDate) } } }
    }
}

/// The ambient NOTCH ORB — the resting state of Switchboard, always present at the top-centre
/// (Dynamic-Island-style progressive disclosure). Its DEFAULT is the REAL notch (founder-approved,
/// wireframe A "A is good"): the notch SHAPE ITSELF — flat top flush with the menu bar, rounded bottom,
/// concave ears — filled EDGE-TO-EDGE with the dot-matrix, health-tinted. Calm sweep at rest, a
/// travelling ripple while a model runs. Hover / click opens the full panel; cards grow FROM this same
/// silhouette; God's live phase still drops below as GodStatusDrop. A FIXED hit-area keeps the window
/// one constant size; only the content morphs.
struct OrbView: View {
    @ObservedObject var model: Model
    @ObservedObject var glow: GlowModel
    var onOpen: () -> Void
    @State private var hovering = false
    var body: some View {
        // Health tint: lime = running + signed-in · red = running, signed-out · faint = daemon down.
        let tint = model.running ? (model.signedIn ? Color.lime : Color.danger) : Color.inkFaint
        let shape = NotchDropShape(ear: 9, botR: 10)
        ZStack {
            shape.fill(Color.page)                                   // the black notch body — a notch on any Mac
            NotchField(accent: tint, working: model.working, animated: model.running)
                .padding(.horizontal, 6).padding(.top, 1).padding(.bottom, 4)
                .clipShape(shape)                                    // dots clipped to the silhouette (ears + rounded bottom)
            // Hover cue — the rim brightens and a small ⌄ appears, signalling "click to open". Hover NO LONGER
            // opens the panel (founder 2026-08-25: "hover shouldn't open the big panel — show an option I click").
            shape.stroke(tint.opacity(hovering ? 0.55 : (model.running ? 0.20 : 0.10)), lineWidth: hovering ? 1.1 : 0.75)
            if hovering {
                VStack(spacing: 0) { Spacer(minLength: 0)
                    Image(systemName: "chevron.compact.down").font(.system(size: 9, weight: .bold))
                        .foregroundColor(tint.opacity(0.9)).padding(.bottom, 2)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .shadow(color: (model.running && model.signedIn) ? Color.lime.opacity(hovering ? 0.28 : 0.18) : .clear, radius: 4, y: 1)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }        // hover only PREVIEWS the click target — it does not open
        .onTapGesture { onOpen() }        // a deliberate CLICK opens the panel
        .help("Click to open Switchboard")
    }
}

/// God's SECOND CURSOR — not a replacement pointer but a state-reactive GLOW behind
/// the real cursor, plus a light HALO to mark a target. Reads as presence, not a hijacked pointer.
enum GlowState { case idle, armed, listening, thinking, finishing, speaking, pointing }

final class GlowModel: ObservableObject {
    @Published var state: GlowState = .idle
    @Published var cursor: CGPoint = .zero   // overlay-view (top-left) coords, kept in sync with the mouse
    @Published var target: CGPoint? = nil    // a [POINT] marker, same coords (nil = no mark)
}

/// The overlay content: a soft aura tracking the cursor (colour/behaviour per state) and, when set,
/// a pulsing ring at the point God is marking. Full-screen + click-through; shown only when active.
struct GodGlowView: View {
    @ObservedObject var m: GlowModel
    @State private var pulse = false
    private struct Spark { let dx: CGFloat; let dy: CGFloat; let size: CGFloat; let speed: Double; let phase: Double }
    private let sparks: [Spark] = [
        .init(dx: -22, dy: -9, size: 7, speed: 2.1, phase: 0.0),
        .init(dx: 21, dy: -15, size: 6, speed: 2.7, phase: 1.3),
        .init(dx: 17, dy: 13, size: 8, speed: 1.8, phase: 2.4),
        .init(dx: -18, dy: 15, size: 6, speed: 2.4, phase: 3.1),
        .init(dx: 2, dy: -25, size: 6, speed: 3.0, phase: 0.7),
        .init(dx: -9, dy: 0, size: 5, speed: 3.3, phase: 4.2),
    ]
    private var tint: Color {
        switch m.state {
        case .idle: return .clear
        // One accent (NOTCH-DESIGN §2.2): every phase is lime — the phase reads from the dot-matrix
        // PATTERN (listening VU / speaking wave / thinking sweep), never from a second hue.
        default: return .lime
        }
    }
    private func captionFor(_ s: GlowState) -> String? {
        switch s {
        case .idle: return nil
        case .armed: return "God"
        case .listening: return "listening…"
        case .thinking: return "thinking…"
        case .finishing: return "almost done…"
        case .speaking: return "speaking…"
        case .pointing: return "here"
        }
    }
    var body: some View {
        ZStack {
            if m.state != .idle {
                // Just the sparkles — a light, unobtrusive shimmer trailing the cursor (no aura, no
                // core dot, no halo). Presence, not a spotlight.
                TimelineView(.animation) { tl in
                    let t = tl.date.timeIntervalSinceReferenceDate
                    ZStack {
                        ForEach(0..<sparks.count, id: \.self) { i in
                            let s = sparks[i]
                            let tw = 0.5 + 0.5 * sin(t * s.speed + s.phase)
                            Image(systemName: "sparkle")
                                .font(.system(size: s.size))
                                .foregroundColor(tint)
                                .opacity(tw)
                                .scaleEffect(0.5 + 0.7 * tw)
                                .position(x: m.cursor.x + s.dx, y: m.cursor.y + s.dy)
                        }
                    }
                }
            }
            if let t = m.target {
                Circle().stroke(Color.lime.opacity(0.85), lineWidth: 2)
                    .frame(width: 40, height: 40)
                    .scaleEffect(pulse ? 1.12 : 0.82)
                    .opacity(pulse ? 0.3 : 0.95)
                    .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: pulse)
                    .position(t)
            }
            // No caption pill by the cursor — the notch drop already names the phase; a second label
            // riding the cursor was noise.
        }
        .allowsHitTesting(false)
        .onAppear { pulse = true }
    }
}

/// DOT-MATRIX — Switchboard's signature motion primitive. A grid of dots whose per-dot brightness is
/// a pure function of (col, row, time), so each phase is one animated pattern with no assets, no GIFs,
/// no timers — apt for a *switchboard* (the operator's lamp field). Reusable anywhere a status,
/// loader, or accent belongs; the God notch is its first home. Honors reduce-motion (falls to a still
/// mid-frame). Patterns mirror the reference's Agent/Status families.
struct DotMatrix: View {
    enum Pattern { case listening, thinking, speaking, working }
    let pattern: Pattern
    let accent: Color
    var cols: Int = 7
    var rows: Int = 5
    var dot: CGFloat = 3
    var gap: CGFloat = 3
    var animated: Bool = true   // false → a still mid-frame (an OFFLINE beacon that shouldn't breathe)
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private func brightness(_ c: Int, _ r: Int, _ t: Double) -> Double {
        let cx = Double(c), rx = Double(r), mid = Double(rows - 1) / 2
        switch pattern {
        case .listening:
            // VU field: each column breathes a height around the mid row (a lamp meter).
            let h = 1.0 + 2.0 * (0.5 + 0.5 * sin(t * 3.0 + cx * 0.7))
            return abs(rx - mid) <= h ? 1.0 : 0.1
        case .speaking:
            // A sine wave scrolling left→right; dots near the wave line light up.
            let wave = mid + (mid - 0.15) * sin(t * 4.2 + cx * 0.95)
            return abs(rx - wave) < 0.85 ? 1.0 : 0.1
        case .thinking:
            // A diagonal band sweeping across — computation moving through the field.
            let s = 0.5 + 0.5 * sin((cx + rx) * 0.6 - t * 3.0)
            return 0.14 + 0.86 * (s * s * s)
        case .working:
            return 0.16 + 0.84 * (0.5 + 0.5 * sin(cx * 0.55 - t * 2.6))
        }
    }

    private func grid(_ t: Double) -> some View {
        VStack(spacing: gap) {
            ForEach(0..<rows, id: \.self) { r in
                HStack(spacing: gap) {
                    ForEach(0..<cols, id: \.self) { c in
                        Circle().fill(accent).frame(width: dot, height: dot).opacity(brightness(c, r, t))
                    }
                }
            }
        }
    }
    var body: some View {
        if reduceMotion || !animated { grid(0) }                      // a still, legible mid-frame
        else { TimelineView(.animation) { tl in grid(tl.date.timeIntervalSinceReferenceDate) } }
    }
}

/// A compact 5×7 uppercase dot font (bit 4 = leftmost column). Enough to spell the phase words as a
/// dot-matrix LED sign. Founder's notch vision (2026-08-13): the "talking" state becomes an LED display —
/// the word in lit lamps on the left, the live voice waveform on the right, all one continuous lamp field.
private let LEDFont7: [Character: [Int]] = [
    "A": [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
    "B": [0b11110,0b10001,0b10001,0b11110,0b10001,0b10001,0b11110],
    "C": [0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110],
    "D": [0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],
    "E": [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
    "F": [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
    "G": [0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01111],
    "H": [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
    "I": [0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
    "J": [0b00111,0b00010,0b00010,0b00010,0b00010,0b10010,0b01100],
    "K": [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
    "L": [0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
    "M": [0b10001,0b11011,0b10101,0b10101,0b10001,0b10001,0b10001],
    "N": [0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],
    "O": [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
    "P": [0b11110,0b10001,0b10001,0b11110,0b10000,0b10000,0b10000],
    "Q": [0b01110,0b10001,0b10001,0b10001,0b10101,0b10010,0b01101],
    "R": [0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
    "S": [0b01111,0b10000,0b10000,0b01110,0b00001,0b00001,0b11110],
    "T": [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
    "U": [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
    "V": [0b10001,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100],
    "W": [0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
    "X": [0b10001,0b10001,0b01010,0b00100,0b01010,0b10001,0b10001],
    "Y": [0b10001,0b10001,0b01010,0b00100,0b00100,0b00100,0b00100],
    "Z": [0b11111,0b00001,0b00010,0b00100,0b01000,0b10000,0b11111],
    " ": [0,0,0,0,0,0,0],
]
/// The 5×5 companion — a COMPACT phase word (founder 2026-08-13: "much smaller"). Shorter glyphs, so the
/// sign is a small strip while the lamps stay chunky.
private let LEDFont5: [Character: [Int]] = [
    "A": [0b01110,0b10001,0b11111,0b10001,0b10001], "B": [0b11110,0b10001,0b11110,0b10001,0b11110],
    "C": [0b01110,0b10001,0b10000,0b10001,0b01110], "D": [0b11110,0b10001,0b10001,0b10001,0b11110],
    "E": [0b11111,0b10000,0b11110,0b10000,0b11111], "F": [0b11111,0b10000,0b11110,0b10000,0b10000],
    "G": [0b01110,0b10000,0b10011,0b10001,0b01110], "H": [0b10001,0b10001,0b11111,0b10001,0b10001],
    "I": [0b01110,0b00100,0b00100,0b00100,0b01110], "J": [0b00111,0b00010,0b00010,0b10010,0b01100],
    "K": [0b10010,0b10100,0b11000,0b10100,0b10010], "L": [0b10000,0b10000,0b10000,0b10000,0b11111],
    "M": [0b10001,0b11011,0b10101,0b10001,0b10001], "N": [0b10001,0b11001,0b10101,0b10011,0b10001],
    "O": [0b01110,0b10001,0b10001,0b10001,0b01110], "P": [0b11110,0b10001,0b11110,0b10000,0b10000],
    "Q": [0b01110,0b10001,0b10101,0b10010,0b01101], "R": [0b11110,0b10001,0b11110,0b10100,0b10010],
    "S": [0b01111,0b10000,0b01110,0b00001,0b11110], "T": [0b11111,0b00100,0b00100,0b00100,0b00100],
    "U": [0b10001,0b10001,0b10001,0b10001,0b01110], "V": [0b10001,0b10001,0b10001,0b01010,0b00100],
    "W": [0b10001,0b10001,0b10101,0b11011,0b10001], "X": [0b10001,0b01010,0b00100,0b01010,0b10001],
    "Y": [0b10001,0b01010,0b00100,0b00100,0b00100], "Z": [0b11111,0b00010,0b00100,0b01000,0b11111],
    " ": [0,0,0,0,0],
]
/// The right-region animation family for the LED sign: a voice WAVE (mic in/out) or a compute SWEEP.
enum LEDMode { case wave, think }

/// The notch LED SIGN — a dot-matrix display: the phase word (LISTENING / DICTATING) rendered in lit
/// lamps on the LEFT, a mid-anchored voice WAVEFORM in lamps on the RIGHT, with the unlit lamps of BOTH
/// regions faintly on so the whole thing reads as one continuous LED panel (founder-designed 2026-08-13).
/// Pure function of (text, levels) — feed `levels` from live mic (MicLevelModel) or a synthetic wave.
// THE NOTCH LED SIGN (founder-designed 2026-08-13, final "A"): a STATIC phase word + an animated waveform,
// rendered in BIG bright lime lamps, TIGHT to the notch (little black), with NO greyed surround field (the
// founder found the dim dots didn't sit right). The notch WIDENS to fit longer words; only the wave/sweep
// animates. `dimAmt` > 0 re-enables a faint field if ever wanted; default 0 = clean.
struct NotchFieldLED: View {
    var text: String
    var mode: LEDMode = .wave
    var pitch: CGFloat = 2.7, dot: CGFloat = 2.5        // founder: narrower word, dots still chunky (near-touching)
    var dimAmt: Double = 0.0                             // 0 = no greyed surround
    var marginRows = 1, sideCols = 1                     // tight
    var gapCols = 2, waveCols = 8                        // shorter wave region → narrower overall
    var pad: CGFloat = 5                                 // small black border around the grid
    private let gw = 5, cgap = 1, glyphRows = 5
    private var chars: [Character] { Array(text.uppercased()) }
    private var wordCols: Int { chars.isEmpty ? 0 : chars.count * gw + (chars.count - 1) * cgap }
    private var cols: Int { sideCols + wordCols + gapCols + waveCols + sideCols }
    private var rows: Int { glyphRows + 2 * marginRows }
    var w: CGFloat { CGFloat(cols - 1) * pitch + dot + 2 * pad }
    var h: CGFloat { CGFloat(rows - 1) * pitch + dot + 2 * pad }
    private func waveAmp(_ i: Int, _ t: Double) -> Double {
        let x = Double(i)
        let carrier = 0.5 + 0.5 * sin(x * 0.7 - t * 4.0)
        let envelope = 0.4 + 0.6 * abs(sin(x * 0.5 + t * 1.2))
        return max(0.1, carrier * envelope)
    }
    private func draw(_ ctx: GraphicsContext, _ t: Double) {
        let ox = (w - CGFloat(cols - 1) * pitch) / 2, oy = (h - CGFloat(rows - 1) * pitch) / 2
        func lamp(_ c: Int, _ r: Int, _ color: Color) {
            ctx.fill(Path(ellipseIn: CGRect(x: ox + CGFloat(c) * pitch - dot / 2, y: oy + CGFloat(r) * pitch - dot / 2, width: dot, height: dot)), with: .color(color))
        }
        if dimAmt > 0 { let dim = Color.lime.opacity(dimAmt); for c in 0..<cols { for r in 0..<rows { lamp(c, r, dim) } } }
        let top = marginRows                                              // word band (centred vertically)
        var c0 = sideCols
        for (i, ch) in chars.enumerated() {                              // the STATIC word, bright
            let g = LEDFont5[ch] ?? LEDFont5[" "]!
            for gc in 0..<gw { for r in 0..<glyphRows where (g[r] >> (gw - 1 - gc)) & 1 == 1 { lamp(c0 + gc, top + r, .lime) } }
            c0 += gw; if i < chars.count - 1 { c0 += cgap }
        }
        let ws = sideCols + wordCols + gapCols, mid = Double(glyphRows - 1) / 2.0
        for j in 0..<waveCols {                                          // the waveform / sweep (animated), bright
            switch mode {
            case .wave:
                let reach = waveAmp(j, t) * mid
                for r in 0..<glyphRows where abs(Double(r) - mid) <= reach + 0.001 { lamp(ws + j, top + r, .lime) }
            case .think:
                for r in 0..<glyphRows { let sv = 0.5 + 0.5 * sin((Double(j) + Double(r)) * 0.7 - t * 3.0); if sv * sv * sv > 0.5 { lamp(ws + j, top + r, .lime) } }
            }
        }
    }
    var body: some View {
        TimelineView(.animation) { tl in
            Canvas { ctx, _ in draw(ctx, tl.date.timeIntervalSinceReferenceDate) }.frame(width: w, height: h)
        }
    }
}

/// LIVE MIC LEVEL — a rolling buffer of recent amplitudes (0…1, oldest→newest) so the notch LED can
/// render the user's VOICE as a waveform (founder ask 2026-08-13: "a waveform of the user's voice
/// signal"). Fed from an INDEPENDENT mic reader — NEVER the dictation recorder (founder: the dictation
/// pipeline works well, don't touch it). Pure data; the view (DotMatrixLED) reads `levels`.
final class MicLevelModel: ObservableObject {
    static let cols = 26
    @Published private(set) var levels: [Double] = Array(repeating: 0, count: MicLevelModel.cols)
    private var buf: [Double] = Array(repeating: 0, count: MicLevelModel.cols)
    func push(_ v: Double) { buf.removeFirst(); buf.append(max(0, min(1, v))); levels = buf }
    func reset() { buf = Array(repeating: 0, count: MicLevelModel.cols); levels = buf }
    /// AVAudioRecorder.averagePower is dBFS (−160…0). Map to 0…1 with a speech-friendly floor + curve so
    /// a normal voice fills the field and near-silence reads flat (not a dead line, not a screaming one).
    func pushDB(_ db: Float) {
        let floor: Float = -52
        let norm = max(0, min(1, (db - floor) / (0 - floor)))
        push(Double(pow(norm, 0.6)))
    }
}

/// USE A (living background) + C helpers: a big, FAINT lamp field drawn with Canvas (thousands of dots as
/// SwiftUI Circles would be janky). Same `working`-pattern math as DotMatrix, ported per PANEL-REDESIGN.md.
/// It's texture, never "live": capped at ~5% opacity so it's only atmosphere in the true-black gutters and
/// the content plane, never competing with a label. Speeds up when the daemon works; danger accent signed-out.
struct PanelDotField: View {
    var accent: Color = .lime
    var speed: Double = 1
    var fieldOpacity: Double = 0.05
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private func working(_ c: Int, _ t: Double) -> Double { 0.16 + 0.84 * (0.5 + 0.5 * sin(Double(c) * 0.55 - t * 2.6)) }
    private func draw(_ ctx: GraphicsContext, _ size: CGSize, _ t: Double) {
        let step: CGFloat = 13, d: CGFloat = 2.4
        let cols = Int(size.width / step) + 1, rows = Int(size.height / step) + 1
        for c in 0..<cols {
            let b = working(c, t)
            for r in 0..<rows {
                let rect = CGRect(x: CGFloat(c) * step, y: CGFloat(r) * step, width: d, height: d)
                ctx.fill(Path(ellipseIn: rect), with: .color(accent.opacity(b)))
            }
        }
    }
    var body: some View {
        GeometryReader { geo in
            if reduceMotion {
                Canvas { ctx, size in draw(ctx, size, 0) }
            } else {
                TimelineView(.animation) { tl in
                    Canvas { ctx, size in draw(ctx, size, tl.date.timeIntervalSinceReferenceDate * speed) }
                }
            }
        }
        .opacity(fieldOpacity)
        .allowsHitTesting(false)
    }
}

/// USE D (tile hover ripple): fades a small lamp field in behind an app icon on hover only. At rest the
/// field is fully transparent, so it's a pure affordance — no idle motion, honors reduce-motion via DotMatrix.
struct TileIconWithRipple: View {
    let icon: AnyView
    @State private var hovering = false
    var body: some View {
        icon
            .background(
                DotMatrix(pattern: .working, accent: .lime, cols: 9, rows: 9, dot: 2, gap: 4)
                    .frame(width: 54, height: 54)
                    .opacity(hovering ? 0.5 : 0)
                    .animation(.easeOut(duration: 0.18), value: hovering)
            )
            .onHover { hovering = $0 }
    }
}

/// USE C (structural divider): the ONE dotted divider (apps ↔ models/tools). A still row of faint lamps so
/// the seam reads as intentional switchboard hardware, not a busy line. Every OTHER divider stays a hairline.
struct DotRowDivider: View {
    var body: some View {
        GeometryReader { geo in
            let step: CGFloat = 11, n = max(1, Int(geo.size.width / step))
            HStack(spacing: 0) {
                ForEach(0..<n, id: \.self) { _ in
                    Circle().fill(Color.edge).frame(width: 2, height: 2).frame(width: step, alignment: .center)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(0.9)
        }
        .frame(height: 2)
    }
}

/// One staged reference as the pill sees it: a screenshot (thumbnail) or a file (thumbnail if it's an image,
/// else a doc glyph). `isScreenshot` picks the fallback icon; `id` routes the ✕ removal back to the app.
struct GodRefChipVM: Identifiable {
    let id: UUID
    let label: String
    let thumb: NSImage?
    let icon: String   // SF Symbol shown when there's no thumbnail (doc / camera / clipboard)
}

/// A compact removable reference chip inside the notch pill — thumbnail/icon + name + ✕. Kept slim and
/// width-capped so several stack cleanly and the pill stays notch-shaped rather than ballooning wide.
struct RefChip: View {
    let vm: GodRefChipVM
    var onRemove: (UUID) -> Void
    var body: some View {
        HStack(spacing: 5) {
            if let t = vm.thumb {
                Image(nsImage: t).resizable().aspectRatio(contentMode: .fill)
                    .frame(width: 20, height: 14).clipShape(RoundedRectangle(cornerRadius: 3))
                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.lime.opacity(0.5), lineWidth: 1))
            } else {
                Image(systemName: vm.icon)
                    .font(.system(size: 9, weight: .semibold)).foregroundColor(.lime).frame(width: 14)
            }
            Text(vm.label).font(.hanken(10.5, .medium)).foregroundColor(.inkDim).lineLimit(1).truncationMode(.middle)
            Button(action: { onRemove(vm.id) }) {
                Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).foregroundColor(.inkFaint)
            }.buttonStyle(.plain).help("Remove this reference")
        }
        .padding(.leading, 6).padding(.trailing, 5).padding(.vertical, 3)
        .background(Capsule().fill(Color.white.opacity(0.06)))
        .frame(maxWidth: 230, alignment: .leading)
    }
}

/// The clipboard offered as an ADDABLE context object — a clipboard glyph + a short text peek + an "Add"
/// affordance. Opt-in: nothing rides the turn until the user taps Add (then it becomes a normal ref chip).
struct ClipboardOfferChip: View {
    let peek: String
    var onAdd: () -> Void
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc.on.clipboard").font(.system(size: 9, weight: .semibold)).foregroundColor(.lime).frame(width: 14)
            Text(peek).font(.hanken(10.5, .medium)).foregroundColor(.inkDim).lineLimit(1).truncationMode(.tail)
            Button(action: onAdd) {
                HStack(spacing: 3) {
                    Image(systemName: "plus").font(.system(size: 7, weight: .bold))
                    Text("Add").font(.hanken(9.5, .semibold))
                }.foregroundColor(.page).padding(.horizontal, 7).padding(.vertical, 3)
                 .background(Capsule().fill(Color.lime))
            }.buttonStyle(.plain).help("Add your clipboard as context for God")
        }
        .padding(.leading, 7).padding(.trailing, 4).padding(.vertical, 3)
        .background(Capsule().fill(Color.white.opacity(0.06)))
        .frame(maxWidth: 250, alignment: .leading)
    }
}

/// God's live PHASE as a notch DROP — same silhouette (NotchDropShape) + tokens as the panel and the
/// consent drop, so listening/thinking/speaking read as the SAME extended notch, never a stray pill.
/// Label + the dot-matrix, coloured + patterned per phase.
struct GodStatusDrop: View {
    let label: String
    let accent: Color
    let pattern: DotMatrix.Pattern
    // The references staged for THIS turn — dropped files + grabbed screenshots — each a removable chip.
    // Only passed on God's own request phases (never ⌃⌥ dictation), so a grab can't leak into the dictation pill.
    var refs: [GodRefChipVM] = []
    var onRemoveRef: ((UUID) -> Void)? = nil
    // The user's clipboard, offered as an ADDABLE context object — a peek + an "add" affordance. Opt-in:
    // present only while listening and only until the user adds it (then it becomes a normal ref chip).
    var clipboardPeek: String? = nil
    var onAddClipboard: (() -> Void)? = nil
    // Context-first: the project this run is grounded in, switchable RIGHT as God works (the user's ask —
    // choose the project from a dropdown in the thinking pill). Empty projects → the chip is hidden.
    var projects: [(id: String, name: String)] = []
    var activeProjectId: String? = nil
    var onSelectProject: ((String?) -> Void)? = nil
    private var hasExtras: Bool { !refs.isEmpty || clipboardPeek != nil || (!projects.isEmpty && onSelectProject != nil) }
    // FULL PHASE SPEC (all states, founder-designed 2026-08-13). Single-word PHASES render as the full-notch
    // LED field (the word + a wave/think animation as bright lamps on a dim-green field). Multi-word STATUS
    // messages ("Redline · running", "Copied…") that can't be spelled keep the label text + DotMatrix.
    private static let wavePhases: Set<String> = ["DICTATING", "LISTENING", "SPEAKING"]           // voice in/out → waveform
    private static let thinkPhases: Set<String> = ["TRANSCRIBING", "FINDING", "THINKING", "WORKING", "GENERATING"]  // compute → sweep
    private var ledWord: String { String(label.split(separator: " ").first ?? "").uppercased() }
    private var ledMode: LEDMode? {
        if Self.wavePhases.contains(ledWord) { return .wave }
        if Self.thinkPhases.contains(ledWord) { return .think }
        return nil
    }
    var body: some View {
        let led = ledMode
        return VStack(spacing: 7) {
            // ONE row: the LED FIELD (phases) or label+matrix (status), and the project chip INLINE so the
            // "next step" (project selection during Thinking) WIDENS the strip rather than growing it taller.
            HStack(spacing: 8) {
                if let m = led {
                    NotchFieldLED(text: ledWord, mode: m)
                } else {
                    Text(label).font(.hanken(13, .semibold)).foregroundColor(.ink)
                    DotMatrix(pattern: pattern, accent: accent)
                }
                if !projects.isEmpty, let onSelect = onSelectProject {
                    ProjectChip(projects: projects, activeId: activeProjectId, onSelect: onSelect)
                }
            }
            if !refs.isEmpty, let onRemove = onRemoveRef {
                VStack(spacing: 4) {
                    ForEach(refs) { RefChip(vm: $0, onRemove: onRemove) }
                }
            }
            if let peek = clipboardPeek, let onAdd = onAddClipboard {
                ClipboardOfferChip(peek: peek, onAdd: onAdd)
            }
        }
        // LED phases: tight padding so the lamp field fills the notch; status: roomier for the text.
        .padding(.horizontal, led != nil ? 10 : 18)
        .padding(.top, led != nil ? 3 : 6)
        .padding(.bottom, hasExtras ? 10 : (led != nil ? 3 : 7))
        .frame(minWidth: 120)
        .padding(.horizontal, 14)   // room for the notch "ears" (the shape flares to full width at top)
        .background(Color.page)
        .clipShape(NotchDropShape())
        .ignoresSafeArea()
    }
}

/// The native "Allow this app?" consent — as a NOTCH DROP (notch-native), not a stray centered system
/// alert. Same trust copy, same shape/tokens as the panel; drops from the notch and yields Allow/Deny.
struct ConsentDrop: View {
    let name: String
    let appId: String
    let reason: String
    let canDo: String
    var onAllow: () -> Void
    var onDeny: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8).fill(Color.lime.opacity(0.16))
                    .overlay(Image(systemName: "laptopcomputer").font(.system(size: 15)).foregroundColor(.lime))
                    .frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Allow \u{201C}\(name)\u{201D} to connect?").font(.hanken(14, .semibold)).foregroundColor(.ink)
                    Text(appId).font(.splMono(9)).foregroundColor(.inkFaint)
                }
                Spacer(minLength: 0)
            }
            if !reason.isEmpty {
                Text("\u{201C}\(reason)\u{201D}").font(.hanken(11)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
            }
            Text("Can do: \(canDo)").font(.hanken(10.5)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
            Text("Only allow an app you installed yourself — identity isn\u{2019}t signature-verified yet.")
                .font(.splMono(8.5)).foregroundColor(.inkFaint).opacity(0.75).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(action: onDeny) {
                    HStack(spacing: 7) {
                        Text("Deny").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                        KeyCap(glyph: "Esc", recessed: true)
                    }
                    .padding(.leading, 13).padding(.trailing, 9).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                }.buttonStyle(.plain)
                Button(action: onAllow) {
                    HStack(spacing: 6) {
                        Text("Allow").font(.hanken(11.5, .semibold))
                        KeyCap(glyph: "↵", recessed: true)
                    }.foregroundColor(.page)
                        .padding(.leading, 14).padding(.trailing, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
                }.buttonStyle(.plain)
            }.padding(.top, 2)
        }
        .padding(18)
        .frame(width: 360, alignment: .leading)
        .padding(.horizontal, 14)   // room for the tab ears
        .background(Color.page)
        .clipShape(NotchDropShape())
    }
}

/// A native wrapp asks to open a FOLDER (consent:storage-bind) or raise the folder picker
/// (consent:storage-pick). The A1 consent (founder pick 2026-08-12): the ask + the exact path, with
/// Not now / Allow inline on the right — the same notch drop the connect card uses. Reply is a plain
/// bool → the daemon's ask<boolean> (server.ts requestStorageBindConsent).
struct StorageBindDrop: View {
    let app: String
    let path: String
    let isPick: Bool
    var onAllow: () -> Void
    var onDeny: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8).fill(Color.amber.opacity(0.16))
                    .overlay(Image(systemName: "folder").font(.system(size: 15)).foregroundColor(.amber))
                    .frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Open a folder for \u{201C}\(app)\u{201D}?").font(.hanken(14, .semibold)).foregroundColor(.ink)
                    Text(isPick ? "You\u{2019}ll choose the folder next"
                                : "read \u{0026} stage \u{00B7} nothing leaves your Mac")
                        .font(.hanken(10.5)).foregroundColor(.inkFaint)
                }
                Spacer(minLength: 0)
            }
            if !path.isEmpty && !isPick {
                Text(path).font(.splMono(10)).foregroundColor(.inkDim).lineLimit(1).truncationMode(.middle)
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.edge, lineWidth: 1))
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(action: onDeny) {
                    HStack(spacing: 7) {
                        Text("Not now").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                        KeyCap(glyph: "Esc", recessed: true)
                    }
                    .padding(.leading, 13).padding(.trailing, 9).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                }.buttonStyle(.plain)
                Button(action: onAllow) {
                    HStack(spacing: 6) {
                        Text(isPick ? "Choose\u{2026}" : "Allow").font(.hanken(11.5, .semibold))
                        KeyCap(glyph: "↵", recessed: true)
                    }.foregroundColor(.page)
                        .padding(.leading, 14).padding(.trailing, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
                }.buttonStyle(.plain)
            }.padding(.top, 2)
        }
        .padding(18)
        .frame(width: 360, alignment: .leading)
        .padding(.horizontal, 14)   // room for the tab ears
        .background(Color.page)
        .clipShape(NotchDropShape())
    }
}

/// The native CONNECT-GRANT scope card (founder direction 2026-08-12: move ALL consent to the notch).
/// Mirrors the extension consent-view: origin + reason, model checkboxes (requested pre-selected), tool
/// checkboxes with a read/write badge. Approve returns the grant OBJECT
/// {models, tools:[{name,access}], budgets, contextKinds}; Deny returns nil. Wired via ConsentClient.replyResult.
struct ConnectGrantDrop: View {
    let origin: String
    let reason: String
    let availableModels: [String]
    let tools: [(name: String, access: String, label: String)]
    let budgets: [String: Any]
    let contextKinds: [String]
    var onApprove: ([String: Any]) -> Void
    var onDeny: () -> Void

    @State private var selModels: Set<String>
    @State private var selTools: Set<String>

    init(origin: String, reason: String, availableModels: [String], requestedModels: [String],
         tools: [(name: String, access: String, label: String)], budgets: [String: Any], contextKinds: [String],
         onApprove: @escaping ([String: Any]) -> Void, onDeny: @escaping () -> Void) {
        self.origin = origin; self.reason = reason; self.availableModels = availableModels; self.tools = tools
        self.budgets = budgets; self.contextKinds = contextKinds; self.onApprove = onApprove; self.onDeny = onDeny
        _selModels = State(initialValue: Set(requestedModels.isEmpty ? Array(availableModels.prefix(1)) : requestedModels))
        _selTools = State(initialValue: Set(tools.map { $0.name }))
    }

    private func host(_ s: String) -> String { URL(string: s)?.host ?? s }
    private var writeCount: Int { tools.filter { $0.access == "write" }.count }
    private func chunked(_ a: [String], _ n: Int) -> [[String]] {
        stride(from: 0, to: a.count, by: n).map { Array(a[$0..<min($0 + n, a.count)]) }
    }
    // The wrapp's tile glyph — its name usually leads the reason ("Redline — …"); else the host initial.
    private var appInitial: String {
        let src = reason.isEmpty ? host(origin) : reason
        for ch in src where ch.isLetter || ch.isNumber { return String(ch).uppercased() }
        return "\u{2022}"
    }
    private func pill(_ m: String, _ on: Bool) -> some View {
        Text(m).font(.hanken(12, on ? .semibold : .regular)).foregroundColor(on ? .page : .inkDim).lineLimit(1)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 8).fill(on ? Color.lime : Color.raised.opacity(0.55)))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? Color.clear : Color.edge, lineWidth: 1))
    }
    // TOOLS as inline chips (not the old full-width rows) — a dot (lime read / red write), the name, and a
    // "write" marker; tap toggles. Keeps the whole scope compact — the card is now ~half the old height.
    private func toolChip(_ t: (name: String, access: String, label: String), _ on: Bool) -> some View {
        let write = t.access == "write"
        let red = Color(red: 1, green: 0.42, blue: 0.37)
        return HStack(spacing: 6) {
            Circle().fill(on ? (write ? red : Color.lime) : Color.inkFaint).frame(width: 6, height: 6)
            Text(t.label.isEmpty ? t.name : t.label).font(.hanken(11.5, on ? .medium : .regular)).foregroundColor(on ? .ink : .inkDim).lineLimit(1)
            if write { Text("write").font(.splMono(8)).foregroundColor(on ? red : .inkFaint) }
        }
        .padding(.horizontal, 9).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(on ? Color.lime.opacity(0.10) : Color.raised.opacity(0.5)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? Color.lime.opacity(0.45) : Color.edge, lineWidth: 1))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            // THE LINK — the hero. Two endpoints (the wrapp · your Claude sunburst) that glow-pulse as a
            // signal of dots travels left→right between them: a patch cable being made, at the notch.
            PairLink(appInitial: appInitial).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 3) {
                (Text("Connect to ").foregroundColor(.ink) + Text(host(origin)).foregroundColor(.lime) + Text("?").foregroundColor(.ink)).font(.hanken(14.5, .semibold))
                if !reason.isEmpty { Text("\u{201C}\(reason)\u{201D}").font(.hanken(10.5)).italic().foregroundColor(.inkFaint).lineLimit(2).fixedSize(horizontal: false, vertical: true) }
            }
            Rectangle().fill(Color.edge).frame(height: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 11) {
                    if !availableModels.isEmpty {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("MODELS").font(.splMono(9)).foregroundColor(.inkFaint).tracking(1.4)
                            ForEach(chunked(availableModels, 3), id: \.self) { row in
                                HStack(spacing: 7) {
                                    ForEach(row, id: \.self) { m in
                                        Button { if selModels.contains(m) { selModels.remove(m) } else { selModels.insert(m) } } label: { pill(m, selModels.contains(m)) }.buttonStyle(.plain)
                                    }
                                    Spacer(minLength: 0)
                                }
                            }
                        }
                    }
                    if !tools.isEmpty {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text("TOOLS").font(.splMono(9)).foregroundColor(.inkFaint).tracking(1.4)
                                Spacer(minLength: 0)
                                Text("\(tools.count) requested\(writeCount > 0 ? " \u{00B7} \(writeCount) write" : "")").font(.splMono(9)).foregroundColor(.inkFaint)
                            }
                            ForEach(chunked(tools.map { $0.name }, 2), id: \.self) { row in
                                HStack(spacing: 7) {
                                    ForEach(row, id: \.self) { name in
                                        if let t = tools.first(where: { $0.name == name }) {
                                            Button { if selTools.contains(name) { selTools.remove(name) } else { selTools.insert(name) } } label: { toolChip(t, selTools.contains(name)) }.buttonStyle(.plain)
                                        }
                                    }
                                    Spacer(minLength: 0)
                                }
                            }
                        }
                    }
                }
            }.frame(maxHeight: 168)
            HStack(spacing: 8) {
                Button(action: onDeny) {
                    HStack(spacing: 7) {
                        Text("Deny").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                        KeyCap(glyph: "Esc", recessed: true)
                    }
                    .padding(.leading, 13).padding(.trailing, 9).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                }.buttonStyle(.plain)
                Spacer(minLength: 0)
                Button {
                    let grant: [String: Any] = [
                        "models": Array(selModels),
                        "tools": tools.filter { selTools.contains($0.name) }.map { ["name": $0.name, "access": $0.access] },
                        "budgets": budgets,
                        "contextKinds": contextKinds,
                    ]
                    onApprove(grant)
                } label: {
                    HStack(spacing: 6) {
                        Text("Approve \u{00B7} \(selTools.count) tool\(selTools.count == 1 ? "" : "s")").font(.hanken(11.5, .semibold))
                        KeyCap(glyph: "↵", recessed: true)
                    }.foregroundColor(.page)
                        .padding(.leading, 14).padding(.trailing, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
                }.buttonStyle(.plain)
            }.padding(.top, 1)
        }
        .padding(16)
        .frame(width: 344, alignment: .leading)
        .padding(.horizontal, 14)
        .background(Color.page)
        .clipShape(NotchDropShape())
    }
}

// The Claude "sunburst" — spokes radiating from a centre, stroked in lime; reads as the AI endpoint.
struct Sunburst: Shape {
    var spokes: Int = 8
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let r = min(rect.width, rect.height) / 2
        let inner = r * 0.16
        for i in 0..<spokes {
            let a = Double(i) / Double(spokes) * 2 * .pi
            let ca = CGFloat(cos(a)), sa = CGFloat(sin(a))
            p.move(to: CGPoint(x: c.x + ca * inner, y: c.y + sa * inner))
            p.addLine(to: CGPoint(x: c.x + ca * r, y: c.y + sa * r))
        }
        return p
    }
}

// The "patch cable being made": wrapp tile ─ a row of dots that light up left→right ─ your Claude
// (sunburst). Both endpoints glow-pulse; the arriving signal brightens whichever end it reaches.
// Respects Reduce Motion — then it's a static "linked" state (all dots lit, both ends steady).
struct PairLink: View {
    let appInitial: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private func endpoint(app: Bool, glow: Double) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(app ? Color.lime : Color.raised)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(app ? Color.clear : Color.edge, lineWidth: 1))
                .frame(width: 36, height: 36)
                .shadow(color: Color.lime.opacity(glow * 0.7), radius: 9 * glow)
            if app {
                Text(appInitial).font(.hanken(15, .bold)).foregroundColor(.page)
            } else {
                Sunburst(spokes: 8).stroke(Color.lime, style: StrokeStyle(lineWidth: 1.7, lineCap: .round)).frame(width: 19, height: 19)
            }
        }
    }

    private func dots(_ ctx: GraphicsContext, _ size: CGSize, phase: Double, still: Bool) {
        let n = 9
        let baseR: CGFloat = 2.1
        for i in 0..<n {
            let p = Double(i) / Double(n - 1)
            let x = baseR + (size.width - 2 * baseR) * CGFloat(p)
            let y = size.height / 2
            var a = 0.16, rad = baseR
            if still { a = 0.5 }
            else { let d = abs(p - phase); let lit = max(0, 1 - d * 6); a = 0.16 + 0.82 * lit; rad = baseR + CGFloat(lit) * 1.5 }
            ctx.fill(Path(ellipseIn: CGRect(x: x - rad, y: y - rad, width: rad * 2, height: rad * 2)), with: .color(Color.lime.opacity(a)))
        }
    }

    var body: some View {
        if reduceMotion {
            HStack(spacing: 10) {
                endpoint(app: true, glow: 0.55)
                Canvas { ctx, size in dots(ctx, size, phase: 0, still: true) }.frame(height: 16)
                endpoint(app: false, glow: 0.55)
            }
        } else {
            TimelineView(.animation) { tl in
                let t = tl.date.timeIntervalSinceReferenceDate
                let travel = 1.4, pause = 1.0, cyc = travel + pause
                let u = t.truncatingRemainder(dividingBy: cyc)
                let phase = min(1.0, u / travel)                                   // 0→1 then hold
                let appG = 0.22 + 0.55 * max(0, 1 - phase * 5)                      // bright as it departs
                let claudeG = 0.22 + 0.6 * max(0, 1 - abs(phase - 1) * 5)           // bright as it arrives
                HStack(spacing: 10) {
                    endpoint(app: true, glow: appG)
                    Canvas { ctx, size in dots(ctx, size, phase: phase, still: false) }.frame(height: 16)
                    endpoint(app: false, glow: claudeG)
                }
            }
        }
    }
}

// ════════════════════ third-party TOOL grant card ════════════════════
// A dedicated consent card for a third-party TOOL (origin tool://<id>) — NOT the wrapp connect card
// (ConnectGrantDrop). A tool has no LLM in the loop, so no model pills; the card is provenance-forward:
// it names the tool + its source server, shows exactly what it runs (read/write actions), and carries the
// keys-local lane badge (the moat, made visible). The two-lane pick (pool · my key) is reserved as
// `ToolCredLane` for the ~2,000-tool registry follow-on; today's no-auth seeds render `.localNoKey`.
enum ToolCredLane { case localNoKey, pool, myKey }   // §task-10 groundwork; only .localNoKey ships today

// (Key-cap chips reuse the canonical `KeyCap(glyph:big:filled:)` from CursorGuide.swift — one shortcut-cap
// style across the guide cards AND the consent/grant buttons, per the founder's "our design style" ask.)
struct ToolGrantAction: Identifiable { let id = UUID(); let label: String; let desc: String; let write: Bool }
struct ToolGrantDrop: View {
    let toolName: String        // "Hacker News"
    let tagline: String         // one-liner from the listing
    let server: String          // ~/.relay/mcp.json key, e.g. "hn"
    let actions: [ToolGrantAction]
    let grantTools: [[String: Any]]   // the EXACT {name,access} to approve (qualified mcp__server__tool)
    let budgets: [String: Any]
    let contextKinds: [String]
    var lane: ToolCredLane = .localNoKey
    var onApprove: ([String: Any]) -> Void
    var onDeny: () -> Void

    private let red = Color(red: 1, green: 0.42, blue: 0.37)
    private var hasWrite: Bool { actions.contains { $0.write } }

    // The hero — a tool tile · a dot-run · a lock tile: "this tool runs on YOUR machine; keys stay put."
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
            if !a.desc.isEmpty {
                Text(a.desc).font(.hanken(10.5)).foregroundColor(.inkDim).lineLimit(1)
            }
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
                Button(action: onDeny) {
                    HStack(spacing: 7) {
                        Text("Deny").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                        KeyCap(glyph: "Esc", recessed: true)
                    }
                    .padding(.leading, 13).padding(.trailing, 9).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                }.buttonStyle(.plain)
                Spacer(minLength: 0)
                Button {
                    onApprove(["models": [String](), "tools": grantTools, "budgets": budgets, "contextKinds": contextKinds])
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "play.fill").font(.system(size: 9, weight: .bold))
                        Text("Approve").font(.hanken(11.5, .semibold))
                        KeyCap(glyph: "↵", recessed: true)
                    }.foregroundColor(.page)
                        .padding(.leading, 14).padding(.trailing, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
                }.buttonStyle(.plain)
            }.padding(.top, 1)
        }
        .padding(16)
        .frame(width: 344, alignment: .leading)
        .padding(.horizontal, 14)
        .background(Color.page)
        .clipShape(NotchDropShape())
    }
}

/// The native Accessibility onboarding — a notch DROP (notch-native), not a terminal walk. It states
/// the need, opens the exact pane, AND offers the real trick: a draggable app chip you drag straight
/// into the Accessibility list (`.onDrag` yields the .app bundle URL), instead of hunting via the + button.
// The permissions God needs, in concierge order: HEAR → ACT → SEE.
enum GodPerm: CaseIterable {
    case mic, accessibility, screen
    var granted: Bool {
        switch self {
        case .mic: return AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        case .accessibility: return AXIsProcessTrusted()
        case .screen: return CGPreflightScreenCaptureAccess()
        }
    }
    var title: String {
        switch self {
        case .mic: return "Let God hear you"
        case .accessibility: return "Let God act for you"
        case .screen: return "Let God see your screen"
        }
    }
    var sub: String {
        switch self {
        case .mic: return "Microphone — so ⌃⌃ can listen to your request."
        case .accessibility: return "Accessibility — to point, click and type. Drag me into the list, or hit Open."
        case .screen: return "Screen Recording — so God can read what's on your screen."
        }
    }
    var pane: String {
        switch self {
        case .mic: return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        case .accessibility: return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        case .screen: return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
    }
    var icon: String {
        switch self { case .mic: return "mic.fill"; case .accessibility: return "hand.point.up.left.fill"; case .screen: return "rectangle.inset.filled" }
    }
    var needsDrag: Bool { self == .accessibility }   // AX has no programmatic grant → the drag trick
}

// The permissions CONCIERGE — one notch card at a time, in order, with progress dots. Mic/Screen get a
// one-tap "Grant" (real system prompt); Accessibility gets Open + a draggable app chip (no grant API).
struct PermissionGateCard: View {
    let perm: GodPerm
    let done: Int          // how many are already granted
    let total: Int
    let appIcon: NSImage
    let appURL: URL
    var onGrant: () -> Void
    var onDismiss: () -> Void
    var body: some View {
        VStack(spacing: 10) {
            HStack {
                HStack(spacing: 4) {
                    ForEach(0..<total, id: \.self) { i in Circle().fill(i < done ? Color.lime : Color.edge).frame(width: 5, height: 5) }
                }
                Spacer()
                Button(action: onDismiss) { Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundColor(.inkFaint) }.buttonStyle(.plain)
            }
            HStack(spacing: 9) {
                Image(systemName: perm.icon).font(.system(size: 14)).foregroundColor(.lime)
                    .frame(width: 30, height: 30).background(RoundedRectangle(cornerRadius: 8).fill(Color.lime.opacity(0.14)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(perm.title).font(.hanken(13.5, .semibold)).foregroundColor(.ink)
                    Text("Step \(done + 1) of \(total)").font(.splMono(9)).foregroundColor(.inkFaint)
                }
                Spacer(minLength: 0)
            }
            Text(perm.sub).font(.hanken(11)).foregroundColor(.inkDim).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            if perm.needsDrag {
                HStack(spacing: 8) {
                    Image(nsImage: appIcon).resizable().frame(width: 18, height: 18)
                    Text("Switchboard").font(.hanken(11, .medium)).foregroundColor(.ink)
                    Image(systemName: "arrow.up.forward.app").font(.system(size: 9)).foregroundColor(.inkFaint)
                }
                .padding(.horizontal, 11).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.raised))
                .onDrag { NSItemProvider(contentsOf: appURL) ?? NSItemProvider() }
            }
            HStack(spacing: 8) {
                Button(action: onGrant) {
                    Text(perm.needsDrag ? "Open" : "Grant").font(.hanken(11.5, .semibold)).foregroundColor(.page)
                        .lineLimit(1).fixedSize()
                        .padding(.horizontal, 18).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
                }.buttonStyle(.plain)
                // AX trust can't be reliably re-detected on an ad-hoc-signed build (the grant binds to a
                // code signature that changes every rebuild), so relaunching just loops. Trust the user's
                // "Granted" and close the gate — real detection needs a signed build.
                if perm.needsDrag {
                    Button(action: onDismiss) {
                        Text("Granted").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                            .lineLimit(1).fixedSize()
                            .padding(.horizontal, 16).padding(.vertical, 7)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                    }.buttonStyle(.plain).help("Close this — you've added Switchboard to Accessibility")
                }
            }
        }
        .padding(16)
        .frame(width: 300)
        .padding(.horizontal, 14)   // room for the tab ears
        .background(Color.page)
        .clipShape(NotchDropShape())
    }
}

// ================= THE SHARED CONTROL KIT (NOTCH-DESIGN §9 / DESIGN-SYSTEM meta-fix) =================
// The structural cause of the "AI-sloppy" read was that every surface re-invented its controls (six
// buttons, four chips, N cards). These are the ONE of each — a panel COMPOSES from them instead of
// hand-rolling, so the drift becomes unspellable. All three panel rails (apps · command centre · tools)
// wear `sbCard`; every button routes through `SBButton`.

enum SBButtonStyle { case primary, ghost, danger }
struct SBButton: View {
    var icon: String? = nil
    var label: String? = nil
    var style: SBButtonStyle = .ghost
    var kbd: String? = nil          // optional shortcut caption (e.g. "⌥→") shown as a dim trailing chip
    var disabled: Bool = false
    var fullWidth: Bool = false     // expand to fill its row (action rows) instead of hugging its label
    let action: () -> Void
    @State private var hover = false
    private var fill: Color { switch style {
        case .primary: return .lime
        case .ghost:   return hover ? .raised : .panel
        case .danger:  return hover ? Color.danger.opacity(0.12) : .clear } }
    private var stroke: Color { switch style {
        case .primary: return .lime
        case .ghost:   return .edge
        case .danger:  return Color.danger.opacity(0.55) } }
    private var ink: Color { switch style {
        case .primary: return .page
        case .ghost:   return hover ? .ink : .inkDim
        case .danger:  return .danger } }
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let i = icon { Image(systemName: i).font(.system(size: 10, weight: .semibold)) }
                if let l = label { Text(l).font(.label).lineLimit(1).fixedSize() }
                if let k = kbd { Text(k).font(.splMono(8.5)).foregroundColor(ink.opacity(0.7)).lineLimit(1).fixedSize() }
            }
            .fixedSize(horizontal: !fullWidth, vertical: true) // hug the label — unless it's a full-width row control
            .foregroundColor(ink)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .padding(.horizontal, label == nil ? 7 : 10).padding(.vertical, 6).frame(minHeight: 28)
            .background(RoundedRectangle(cornerRadius: SBr.xs).fill(fill))
            .overlay(RoundedRectangle(cornerRadius: SBr.xs).stroke(stroke, lineWidth: 1))
            .opacity(disabled ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .focusable(false) // click-driven popover — the OS focus ring is noise here
        .onHover { hover = $0 }
    }
}
// Retained as a thin alias so existing call-sites need zero churn — there is now ONE button implementation.
struct GhostButton: View {
    let icon: String; let label: String?; let action: () -> Void
    var body: some View { SBButton(icon: icon, label: label, style: .ghost, action: action) }
}

struct SBChip: View {
    var label: String; var detail: String? = nil; var active: Bool = false; var mono: Bool = false
    var body: some View {
        HStack(spacing: 6) {
            Text(label).font(mono ? .splMono(11) : .label).foregroundColor(active ? .ink : .inkDim).lineLimit(1)
            if let d = detail { Text(d).font(.monoSm).foregroundColor(.inkFaint) }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: SBr.sm).fill(active ? Color.lime.opacity(0.09) : Color.panel)
            .overlay(RoundedRectangle(cornerRadius: SBr.sm).stroke(active ? Color.lime.opacity(0.45) : Color.edge, lineWidth: 1)))
    }
}

struct SBIconTile: View {
    var symbol: String; var tint: Color = .inkDim; var fill: Color = .panel; var size: CGFloat = 26
    var body: some View {
        ZStack { RoundedRectangle(cornerRadius: size * 0.22).fill(fill)
            Image(systemName: symbol).font(.system(size: size * 0.44)).foregroundColor(tint) }
            .frame(width: size, height: size)
    }
}

extension View {
    // The one small-card chrome: panel fill (raised on hover) + the single hairline, lime when active. Every
    // card in the panel's three horizontal rails wears this — no bespoke card backgrounds anywhere.
    func sbCard(active: Bool = false, hover: Bool = false) -> some View {
        background(RoundedRectangle(cornerRadius: SBr.sm).fill(active ? Color.lime.opacity(0.10) : (hover ? Color.raised : Color.panel))
            .overlay(RoundedRectangle(cornerRadius: SBr.sm).stroke(active ? Color.lime.opacity(0.45) : Color.edge, lineWidth: 1)))
    }
}

// A horizontal card rail that ALSO pans on left-click-drag (a "hand tool") — so mouse users without a
// trackpad can scroll the panel's rails, not just two-finger swipe. Wraps NSScrollView + a left-button
// pan recognizer; a plain click still reaches the hosted SwiftUI buttons because the recognizer only
// engages past a few px of movement. `height` pins the rail's row height (the cards define their width).
// An NSScrollView that REPORTS its height to SwiftUI (else the representable gets compressed and clips the
// cards — the "panel got short / rows cut off" bug). Width stays flexible so the rail fills the panel.
final class FixedHeightScrollView: NSScrollView {
    var pinnedHeight: CGFloat = 0
    override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: pinnedHeight) }
}
struct HDragScroll<Content: View>: NSViewRepresentable {
    let height: CGFloat
    @ViewBuilder var content: () -> Content
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = FixedHeightScrollView()
        scroll.pinnedHeight = height
        scroll.setContentHuggingPriority(.defaultHigh, for: .vertical)
        scroll.setContentCompressionResistancePriority(.required, for: .vertical)
        scroll.hasHorizontalScroller = false; scroll.hasVerticalScroller = false
        scroll.drawsBackground = false; scroll.backgroundColor = .clear
        scroll.horizontalScrollElasticity = .allowed; scroll.verticalScrollElasticity = .none
        scroll.automaticallyAdjustsContentInsets = false
        let host = NoInsetHostingView(rootView: AnyView(content()))
        host.translatesAutoresizingMaskIntoConstraints = true
        scroll.documentView = host
        let pan = NSPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.onPan(_:)))
        pan.buttonMask = 0x1
        scroll.contentView.addGestureRecognizer(pan)
        context.coordinator.scroll = scroll
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let host = scroll.documentView as? NoInsetHostingView<AnyView> else { return }
        host.rootView = AnyView(content())
        host.layoutSubtreeIfNeeded()
        let w = max(host.fittingSize.width, scroll.contentView.bounds.width)
        host.frame = NSRect(x: 0, y: 0, width: w, height: height)
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator {
        weak var scroll: NSScrollView?
        private var last: CGFloat = 0
        @objc func onPan(_ g: NSPanGestureRecognizer) {
            guard let scroll = scroll, let doc = scroll.documentView else { return }
            let t = g.translation(in: doc).x
            if g.state == .began { last = 0 }
            let dx = t - last; last = t
            let clip = scroll.contentView
            let maxX = max(0, doc.frame.width - clip.bounds.width)
            var o = clip.bounds.origin; o.x = min(maxX, max(0, o.x - dx))
            clip.scroll(to: o); scroll.reflectScrolledClipView(clip)
        }
    }
}

// A connected-app's per-app STATUS — the founder's ask: "connected / active / idle" must be legible at a glance.
enum AppStatus { case active, ready, idle }
struct StatusPill: View {
    let status: AppStatus
    var body: some View {
        let (c, t): (Color, String) = {
            switch status {
            case .active: return (.lime, "active")   // behind the current activity
            case .ready:  return (.lime, "ready")    // connected + seen recently
            case .idle:   return (.inkFaint, "idle") // connected, quiet
            }
        }()
        return HStack(spacing: 4) {
            Circle().fill(c).frame(width: 5, height: 5)
                .shadow(color: status == .active ? Color.lime.opacity(0.6) : .clear, radius: status == .active ? 3 : 0)
            Text(t).font(.splMono(9)).kerning(0.5).textCase(.uppercase).foregroundColor(status == .idle ? .inkFaint : c)
        }
    }
}

// A connected-app card. The ✕ lives as a top-trailing OVERLAY on the padded card, inset — so it can NEVER be
// clipped the way the old offset-outside-the-tile ✕ was. Reveals on hover; works for every app kind now.
struct AppCardView: View {
    let icon: AnyView
    let label: String
    let status: AppStatus
    let dim: Bool                    // a raw browser tab reads faint
    let onRemove: (() -> Void)?
    @State private var hover = false
    var body: some View {
        VStack(spacing: 8) {
            icon
            Text(label).font(.label).foregroundColor(dim ? .inkFaint : .ink).lineLimit(1)
            StatusPill(status: status)
        }
        .frame(width: 84)
        .padding(.horizontal, 8).padding(.top, 12).padding(.bottom, 9)
        .sbCard(hover: hover)
        .overlay(alignment: .topTrailing) {
            // Always visible (not hover-gated) — SwiftUI .onHover is unreliable inside the NSScrollView-backed
            // HDragScroll, and the founder's ask was for the ✕ to be VISIBLE, not clipped. Subtle at rest.
            if let r = onRemove {
                Button(action: r) {
                    Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).foregroundColor(.inkFaint)
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(Color.raised).overlay(Circle().stroke(Color.edge, lineWidth: 1)))
                }.buttonStyle(.plain).help("Disconnect this app").padding(4)
            }
        }
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
    private let onPrompt: (String, String, [String: Any]) -> Void   // (id, kind, body) for consent prompts
    // Correlated request/response over the SAME authed socket: id → completion. The daemon answers a
    // `{type:"control", id, action, args}` with `{type:"control_result", id, result}`. Used for
    // vault.find (dictation FIND mode). Guarded by a lock so the receive callback (URLSession's queue)
    // and the caller (main) can't race the map. Fires nil on timeout / socket loss — never wedges.
    private var pending: [String: (Any?) -> Void] = [:]
    private let pendingLock = NSLock()

    init(port: UInt16, tokenProvider: @escaping () -> String?, onPrompt: @escaping (String, String, [String: Any]) -> Void) {
        self.port = port; self.tokenProvider = tokenProvider; self.onPrompt = onPrompt
        super.init(); connect()
    }
    private func connect() {
        guard let token = tokenProvider() else { retry(); return } // daemon not paired yet
        task = session.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task?.resume(); receive()
        send(["type": "auth", "token": token, "surface": "menubar"])
    }
    private func retry() { failAllPending(); DispatchQueue.global().asyncAfter(deadline: .now() + 2) { [weak self] in self?.connect() } }
    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure: self.retry()
            case .success(let msg):
                if case let .string(s) = msg, let d = s.data(using: .utf8),
                   let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                    let type = o["type"] as? String
                    if type == "prompt", let kind = o["kind"] as? String,
                       ["consent:native-connect", "consent:connect", "consent:storage-bind", "consent:storage-pick"].contains(kind),
                       let id = o["id"] as? String {
                        // native-connect → "Allow this app?"; storage-bind/pick → "Open a folder?" (A1).
                        // The daemon routes these to the menubar surface (fallback) when no extension is
                        // connected — exactly the native-wrapp case that used to time out and auto-deny.
                        self.onPrompt(id, kind, (o["body"] as? [String: Any]) ?? [:])
                    } else if type == "control_result", let id = o["id"] as? String {
                        // `result` may legitimately be null (e.g. vault.find no-match) — deliver as nil.
                        self.fulfil(id, o.keys.contains("result") ? o["result"] : nil)
                    }
                }
                self.receive()
            }
        }
    }
    // Resolve/clear one pending request. NSNull → nil so callers see a clean "no result".
    private func fulfil(_ id: String, _ result: Any?) {
        pendingLock.lock(); let cb = pending.removeValue(forKey: id); pendingLock.unlock()
        let v = (result is NSNull) ? nil : result
        cb?(v)
    }
    private func failAllPending() {
        pendingLock.lock(); let cbs = Array(pending.values); pending.removeAll(); pendingLock.unlock()
        for cb in cbs { cb(nil) }
    }
    /// Fire a request over the authed socket and await the daemon's matching `control_result`. Calls
    /// `completion(nil)` on timeout or socket loss — a find that can't reach the daemon degrades to a
    /// no-match, never a hang. `completion` is invoked exactly once.
    func request(action: String, args: [String: Any], timeout: TimeInterval = 6.0, completion: @escaping (Any?) -> Void) {
        let id = UUID().uuidString
        var fired = false
        let once: (Any?) -> Void = { v in
            self.pendingLock.lock(); let already = fired; fired = true; self.pending.removeValue(forKey: id); self.pendingLock.unlock()
            if !already { completion(v) }
        }
        pendingLock.lock(); pending[id] = once; pendingLock.unlock()
        send(["type": "control", "id": id, "action": action, "args": args])
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { once(nil) }
    }
    func reply(_ id: String, _ result: Bool) { send(["type": "reply", "id": id, "result": result]) }
    /// Reply with an OBJECT result (or null) — for consent:connect, whose grant is
    /// {models, tools, budgets, contextKinds}, not a bool. null = denied.
    func replyResult(_ id: String, _ result: [String: Any]?) { send(["type": "reply", "id": id, "result": result ?? NSNull()]) }
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
// How far the flat (black, invisible) top edge of a notch drop bleeds UP behind the menu bar. A SwiftUI
// hosting view fits to a fractional height, so `setFrameTopLeftPoint(y: maxY)` derives a fractional
// origin that the window server snaps to the pixel grid — occasionally leaving a ~1pt sliver of desktop
// between the black menu bar and the black drop body. Bleeding the top edge 1pt above the seam tucks it
// behind the bar (the edge is meant to be invisible against it anyway), so no rounding direction shows a gap.
let notchTopBleed: CGFloat = 1
// How far BELOW the screen top the feedback note drops, so it clears the notch + the collapsed guide pill.
let feedbackNotchDrop: CGFloat = 54

// The notch turns into a note field during guide feedback. Modeled on GodStatusDrop's shape/tokens,
// but with a live TextField (needs a key window — hosted in a LauncherPanel, not a NotchPanel).
struct FeedbackNoteDrop: View {
    @Binding var note: String
    var title: String = "In your own words"   // neutral by default — ⌥↓ is a general note, not always an error
    var icon: String = "text.bubble.fill"
    var danger: Bool = false                   // true only when the current step actually failed
    var shotThumbs: [NSImage] = []   // the fn-drag grabs, in order — each new grab ACCUMULATES (a row of chips)
    var onCommit: () -> Void         // ↵ / Save
    var onCancel: () -> Void         // esc / Discard
    @FocusState private var focused: Bool
    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 13)).foregroundColor(danger ? .danger : .lime)
                Text(title).font(.hanken(13, .semibold)).foregroundColor(.ink)
                Spacer(minLength: 0)
                // Grab chips as a compact STACK (+ count) rather than a wide row — a FIXED footprint so the
                // title never gets crowded/wrapped no matter how many you grab.
                if !shotThumbs.isEmpty {
                    ZStack(alignment: .topTrailing) {
                        ZStack {
                            ForEach(Array(shotThumbs.suffix(3).enumerated()), id: \.offset) { i, t in
                                Image(nsImage: t).resizable().aspectRatio(contentMode: .fill)
                                    .frame(width: 34, height: 24).clipped().cornerRadius(4)
                                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.lime.opacity(0.5), lineWidth: 1))
                                    .rotationEffect(.degrees(Double(i - 1) * 3))
                                    .offset(x: CGFloat(i) * 5)
                            }
                        }
                        if shotThumbs.count > 1 {
                            Text("\(shotThumbs.count)").font(.splMono(9.5)).foregroundColor(.page)
                                .padding(.horizontal, 4).padding(.vertical, 1)
                                .background(Capsule().fill(Color.lime))
                                .offset(x: 9, y: -6)
                        }
                    }
                    .frame(width: 52, height: 28)
                }
            }
            TextField("type a note — or hold ⌃⌥ to dictate", text: $note, axis: .vertical)
                .textFieldStyle(.plain).font(.hanken(12)).foregroundColor(.ink)
                .lineLimit(1...4).focused($focused)
                .onSubmit { onCommit() }
                .padding(.horizontal, 9).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
            HStack(spacing: 10) {
                Text("fn-drag a screenshot").font(.splMono(9)).foregroundColor(.inkFaint)
                Spacer(minLength: 0)
                Text("↵ save").font(.splMono(9)).foregroundColor(.lime)
                Text("esc discard").font(.splMono(9)).foregroundColor(.inkDim)
            }
        }
        .padding(.horizontal, 20).padding(.top, 40).padding(.bottom, 12)   // top-pad clears the menu bar/notch (panel drops from the very top edge)
        .frame(width: 300)
        .padding(.horizontal, 14)   // notch ears
        .background(Color.page)
        .clipShape(NotchDropShape())
        .ignoresSafeArea()
        .onAppear { focused = true }
    }
}

// Like NotchPanel (which is final), but CAN become key — the ⌥⌥ launcher's search field needs to accept
// typing. Non-activating, so it never steals app focus; the notch shape comes from the SwiftUI content.
final class LauncherPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

// A notch CREDENTIAL card — a keyed third-party tool needs a secret it doesn't have yet (task 3). Mirrors
// FeedbackNoteDrop: a SecureField hosted in a key-capable LauncherPanel so it can accept typing. The value
// is sent straight to the daemon (claude_setToolSecret → stored 0600, injected into the tool's spawn env)
// and NEVER logged, echoed, or written to disk here — the field is secure and the daemon is the only sink.
struct ToolCredentialDrop: View {
    let toolName: String
    let label: String
    let hint: String
    @Binding var value: String
    var onSave: () -> Void
    var onCancel: () -> Void
    @FocusState private var focused: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8).fill(Color.lime.opacity(0.14)).frame(width: 30, height: 30)
                    Image(systemName: "key.fill").font(.system(size: 13)).foregroundColor(.lime)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
                    Text("\(toolName) · kept local, never leaves your Mac").font(.hanken(10)).foregroundColor(.inkFaint).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            SecureField(hint.isEmpty ? "paste your key" : hint, text: $value)
                .textFieldStyle(.plain).font(.hanken(12)).foregroundColor(.ink)
                .focused($focused).onSubmit { onSave() }
                .padding(.horizontal, 9).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(focused ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1))
            HStack(spacing: 10) {
                Image(systemName: "lock.fill").font(.system(size: 8)).foregroundColor(.inkFaint)
                Text("stored 0600 in the daemon").font(.splMono(9)).foregroundColor(.inkFaint)
                Spacer(minLength: 0)
                Text("esc cancel").font(.splMono(9)).foregroundColor(.inkDim)
                Text("↵ save").font(.splMono(9)).foregroundColor(.lime)
            }
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 12)
        .frame(width: 320)
        .padding(.horizontal, 14)   // notch ears
        .background(Color.page)
        .clipShape(NotchDropShape())
        .ignoresSafeArea()
        .onExitCommand(perform: onCancel)
        .onAppear { focused = true }
    }
}

// ── ⌃⌃ region select: draw WHILE you talk ────────────────────────────────────────────────────────
// When "What God sees → Drag to select" is on, a click-through overlay rides on top DURING listening:
// DRAG a box → that region · CLICK (no drag) → the whole screen · ESC → cancel. It's click-through
// (`ignoresMouseEvents`) so it never steals focus — the ⌃-to-send key monitor keeps working while you
// draw. Mouse is tracked via GLOBAL monitors (same approach the ⌃⌃ detector already uses), and the
// controller reads the committed pick when you tap ⌃. This view is a pure VISUAL: the controller sets `sel`.
enum RegionPick { case cancel; case full; case region(CGRect) }   // region: screencapture -R coords (top-left, points)

// A reference the user staged for God's next ⌃⌃: a dropped FILE or a grabbed SCREENSHOT. Several can ride
// one turn (multi-file + multi-screenshot). Each shows as a removable chip in the notch pill and rides to
// god.mjs via GOD_FILES / GOD_IMAGES. `path` is the file (or the captured jpg); `thumb` previews images.
enum GodRefKind { case file, screenshot, clipboard }
struct GodRef: Identifiable, Equatable {
    let id = UUID()
    let kind: GodRefKind
    let path: String
    var thumb: NSImage?
    let label: String
    var full = false     // a WHOLE-screen grab (the auto-share chip / fn+click full) — marks the take-it-back target
    // The chip glyph per kind — a clipboard-add reads as clipboard, not a generic doc.
    var sfSymbol: String {
        switch kind { case .screenshot: return "camera.viewfinder"; case .file: return "doc"; case .clipboard: return "doc.on.clipboard" }
    }
    static func == (a: GodRef, b: GodRef) -> Bool { a.id == b.id }
}

final class RegionSelectView: NSView {
    var sel: NSRect = .zero { didSet { needsDisplay = true } }
    func setSel(_ r: NSRect) { sel = r }
    // View (bottom-left origin) → screencapture -R (top-left origin), both in points on the main display.
    func captureRect() -> CGRect { CGRect(x: sel.minX, y: bounds.height - sel.maxY, width: sel.width, height: sel.height) }

    override func draw(_ dirtyRect: NSRect) {
        // Dim everything EXCEPT the selection (even-odd punches the box clear so you see through it).
        let dim = NSBezierPath(rect: bounds)
        let hasSel = sel.width > 1 && sel.height > 1
        if hasSel { dim.append(NSBezierPath(rect: sel)); dim.windingRule = .evenOdd }
        NSColor.black.withAlphaComponent(0.22).setFill(); dim.fill()
        if hasSel {
            let b = NSBezierPath(rect: sel); b.lineWidth = 2
            LIME_NS.setStroke(); b.stroke()
        }
        let hint = "Drag a box, or click for the whole screen  ·  keep talking, then tap ⌃ to send  ·  esc cancels"
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12.5, weight: .medium),
            .foregroundColor: NSColor.white.withAlphaComponent(0.9),
        ]
        let s = NSAttributedString(string: hint, attributes: attrs)
        s.draw(at: NSPoint(x: bounds.midX - s.size().width / 2, y: bounds.maxY - 64))
    }
}

// NSHostingView applies a top safe-area inset when the window sits at the screen top (near the menu
// bar), which pushes the SwiftUI content down and leaves a gap under the flush top edge. Zero it so
// the black panel reaches its own top edge.
final class NoInsetHostingView<V: View>: NSHostingView<V> {
    override var safeAreaInsets: NSEdgeInsets { NSEdgeInsets() }
}

// The FULL NOTCH as a DROP TARGET: while you talk to God, a drop-zone panel spans the notch so you can
// drag a file onto it (a normal, no-fn drag) — God's next ⌃⌃ gets it as reference (the GOD_FILE plumbing).
// A plain NSView (not a SwiftUI hosting view) for reliable drag hit-testing. Faint dashed hint; lights up
// lime when a file is over it. onDrop fires with the dropped path.
final class FileDropView: NSView {
    var onDrop: ((String) -> Void)?
    var visualWidth: CGFloat = 0   // draw the notch outline this wide, centered; the whole view is the (wider) drop target
    var attached = false { didSet { needsDisplay = true } }   // a file is in → hide the border but keep the hit area (drop another to replace)
    private var hot = false
    override init(frame: NSRect) {
        super.init(frame: frame)
        // Accept both modern file URLs AND the legacy filenames type — Dock stacks (Downloads) and some
        // sources hand files over as one or the other; registering only .fileURL missed them.
        registerForDraggedTypes([.fileURL, NSPasteboard.PasteboardType("NSFilenamesPboardType")])
    }
    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }   // y-DOWN like SwiftUI, so notchPath is a verbatim twin of NotchDropShape
    // Pass MOUSE clicks below the notch strip THROUGH to the pill underneath, so a reference chip's ✕ and the
    // project dropdown stay clickable even though this drop overlay sits on top of the full pill. Drag delivery
    // is NOT hit-test-gated (it routes to the registered view regardless), so drops still land anywhere; and
    // even if a drag were gated, it'd still land in this top strip — the natural "drop on the notch" spot.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let notchStrip: CGFloat = 48   // the phase-label row (no interactive controls) — capture clicks here only
        return point.y <= notchStrip ? super.hitTest(point) : nil
    }
    private func fileURLs(_ s: NSDraggingInfo) -> [URL] {
        let pb = s.draggingPasteboard
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty { return urls }
        if let names = pb.propertyList(forType: NSPasteboard.PasteboardType("NSFilenamesPboardType")) as? [String], !names.isEmpty { return names.map { URL(fileURLWithPath: $0) } }
        return []
    }
    override func draggingEntered(_ s: NSDraggingInfo) -> NSDragOperation {
        let ok = !fileURLs(s).isEmpty
        godLog("drop: draggingEntered files=\(fileURLs(s).count) accept=\(ok)")   // diagnostic: proves the overlay receives the drag
        hot = ok; needsDisplay = true; return ok ? .copy : []   // NO NSApp.activate — that silenced the global ⌃⌃ monitor
    }
    override func draggingUpdated(_ s: NSDraggingInfo) -> NSDragOperation { fileURLs(s).isEmpty ? [] : .copy }
    override func draggingExited(_ s: NSDraggingInfo?) { hot = false; needsDisplay = true }
    override func prepareForDragOperation(_ s: NSDraggingInfo) -> Bool { !fileURLs(s).isEmpty }
    override func performDragOperation(_ s: NSDraggingInfo) -> Bool {
        hot = false; needsDisplay = true
        guard let u = fileURLs(s).first else { return false }
        onDrop?(u.path); return true
    }
    // The EXACT twin of the pill's NotchDropShape. The view is `isFlipped` (y-DOWN, origin top-left), so this
    // mirrors NotchDropShape's SwiftUI path verbatim — same ear (14) + botR (20) AND the same QUADRATIC curves
    // (converted to the cubics NSBezierPath speaks, so the ears/corners are pixel-identical, not the tighter
    // both-controls-equal cubic the old code drew). `closed` includes the flat top (fill); open = sides+bottom
    // only, matching NotchDropOutline (the top sits against the bar — unstroked). Callers size the view's frame
    // to the pill's frame and set `visualWidth` to the pill's width, so the drawn outline lands ON the pill.
    private func notchPath(closed: Bool) -> NSBezierPath {
        let vw = visualWidth > 40 ? min(visualWidth, bounds.width) : bounds.width
        let ox = (bounds.width - vw) / 2   // centre the notch outline within the wider hit area
        let w = vw, h = bounds.height
        let e = min(CGFloat(14), w / 2), b = min(CGFloat(20), (w - 2 * e) / 2)
        func P(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: ox + x, y: y) }   // ox centres it in the hit area
        let p = NSBezierPath()
        // Quadratic (start→end, control c) → exact cubic: c1 = start + 2/3(c−start), c2 = end + 2/3(c−end).
        func q(_ end: NSPoint, _ c: NSPoint) {
            let s = p.currentPoint
            let c1 = NSPoint(x: s.x + 2.0/3.0 * (c.x - s.x), y: s.y + 2.0/3.0 * (c.y - s.y))
            let c2 = NSPoint(x: end.x + 2.0/3.0 * (c.x - end.x), y: end.y + 2.0/3.0 * (c.y - end.y))
            p.curve(to: end, controlPoint1: c1, controlPoint2: c2)
        }
        if closed {   // NotchDropShape — includes the flat top edge, for the hot fill
            p.move(to: P(0, 0)); p.line(to: P(w, 0))          // flat top (against the bar)
            q(P(w - e, e), P(w - e, 0))                        // right ear: down & in
            p.line(to: P(w - e, h - b))                        // right side
            q(P(w - e - b, h), P(w - e, h))                    // convex bottom-right
            p.line(to: P(e + b, h))                            // bottom edge
            q(P(e, h - b), P(e, h))                            // convex bottom-left
            p.line(to: P(e, e))                                // left side
            q(P(0, 0), P(e, 0))                                // left ear: up & out
            p.close()
        } else {      // NotchDropOutline — sides + bottom only (top is flush to the bar, unstroked)
            p.move(to: P(0, 0))
            q(P(e, e), P(e, 0))                                // left ear
            p.line(to: P(e, h - b))
            q(P(e + b, h), P(e, h))                            // convex bottom-left
            p.line(to: P(w - e - b, h))                        // bottom
            q(P(w - e, h - b), P(w - e, h))                    // convex bottom-right
            p.line(to: P(w - e, e))                            // right side
            q(P(w, 0), P(w - e, 0))                            // right ear
        }
        return p
    }
    override func draw(_ dirty: NSRect) {
        if attached && !hot { return }   // a file is in — no visible border, but the hit area stays live for a replacement
        if hot { NSColor(srgbRed: 0.78, green: 0.95, blue: 0.31, alpha: 0.18).setFill(); notchPath(closed: true).fill() }
        let outline = notchPath(closed: false)
        NSColor(srgbRed: 0.78, green: 0.95, blue: 0.31, alpha: hot ? 0.95 : 0.30).setStroke()
        outline.lineWidth = hot ? 2 : 1.2
        outline.setLineDash([5, 4], count: 2, phase: 0); outline.stroke()
    }
}

// A panel that can become key so it reliably receives a drag from another app (Finder). Non-activating
// still — normal clicks don't steal focus; only a file drag (which calls NSApp.activate above) does.
final class DropPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

// ---------- app shell ----------
@MainActor
// God wants to DO something irreversible — the notch consent drop (notch-native). Everything else
// auto-runs; only send/delete/pay/publish reach here. Names the action, Allow / Not now.
struct ActionConsentDrop: View {
    let describe: String
    var onAllow: () -> Void
    var onDeny: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8).fill(Color.lime.opacity(0.16))
                    .overlay(Image(systemName: "hand.raised.fill").font(.system(size: 14)).foregroundColor(.lime))
                    .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text("God wants to act").font(.hanken(13.5, .semibold)).foregroundColor(.ink)
                    Text("This one's hard to undo — needs your yes.").font(.splMono(9)).foregroundColor(.inkFaint)
                }
                Spacer(minLength: 0)
            }
            Text(describe.prefix(1).capitalized + describe.dropFirst()).font(.hanken(12)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(action: onDeny) {
                    Text("Not now").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                }.buttonStyle(.plain)
                Button(action: onAllow) {
                    Text("Allow").font(.hanken(11.5, .semibold)).foregroundColor(.page)
                        .padding(.horizontal, 18).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime))
                }.buttonStyle(.plain)
            }
        }
        .padding(16).frame(width: 320).padding(.horizontal, 14)
        .background(Color.page).clipShape(NotchDropShape())
    }
}

@MainActor final class RelayController: NSObject, NSApplicationDelegate {
    private var actionPanel: NSPanel!             // the "God wants to act?" consent drop
    private var storePanel: NSPanel!              // the wrapp store modal (drops from the notch)
    private var storeMonitor: Any?                // click-outside dismissal for the store modal
    private var notchWidgetPanel: NSPanel!        // the notch WIDGET — a wrapp's glanceable result under the notch
    private var notchWidgetMonitor: Any?          // click-outside dismissal for the widget
    private var notchWebPanel: NSPanel!           // the notch WEB widget host — a wrapp's live web widget under the notch
    private var notchWebHost: NotchWidgetWebHost?  // the WKWebView + window.claude→daemon bridge for the web widget
    private var notchWebMonitor: Any?             // click-outside dismissal for the web widget
    private var notchWebKeyMonitor: Any?          // Esc dismissal for the web widget
    private var regionOverlay: NSWindow?          // the ⌃⌃ drag-to-select capture overlay (live during listening)
    private var regionView: RegionSelectView?
    private var regionMonitors: [Any] = []
    private var regionStart: NSPoint?
    private var regionMoved = false
    // Guide feedback-capture state — a lean, God-independent sibling of the ⌃⌃ capture (see armFeedbackRegionCapture).
    private var feedbackCaptureTimer: Timer?
    private var feedbackRegionStart: NSPoint?
    private var feedbackRegionMoved = false
    private var feedbackPrevBtnDown = false
    private var onFeedbackShot: ((String) -> Void)?   // completion for a committed grab
    private var feedbackPanel: LauncherPanel?
    // Third-party tool CREDENTIAL card (task 3): the key-capable panel + the pending retry context.
    private var credentialPanel: LauncherPanel?
    private var credentialValue: String = ""
    private var pendingCredential: PendingCredential?
    private var lastToolInput: [String: String] = [:]     // the query per tool id, to re-run after a key is set
    private struct PendingCredential { let l: SBListing; let binding: SBMcpBinding; let tool: String; let input: String?; let env: String; let label: String; let hint: String }
    private var feedbackNote = ""
    private var feedbackShotThumbs: [NSImage] = []
    private var feedbackKeyMonitor: Any?
    private var fnCaptureActive = false               // an fn+click/fn+drag capture gesture is in progress
    private var lastGodCaptureIntentional = false     // the last ⌃⌃ did an explicit fn capture → usable as an image reference
    private var shareScreenThisTurn = false           // snapshot of readDefaultShare() at listening-start (a mid-turn toggle can't change the in-flight turn)
    private var regionCommitted: RegionPick = .full   // whole screen unless an fn gesture picks a region
    private var captureFnTimer: Timer?                // polls mouse-button + fn (free reads) to drive fn-capture WITHOUT the Input-Monitoring grant a global mouse monitor needs
    private var capturePrevBtnDown = false            // edge-detect the left button between poll ticks
    private var godRefs: [GodRef] = []                // the references staged for God's next ⌃⌃ — dropped files + grabbed screenshots (several allowed); each a removable chip
    private var clipboardOffer: String? = nil         // the clipboard string offered THIS turn (opt-in add); nil once added or the turn ends — never auto-attached
    private var notchDropPanel: NSPanel?              // the full-notch file drop zone, live during listening
    private var statusItem: NSStatusItem!
    private var panel: NSPanel!
    private var hosting: NSHostingView<Panel>!
    private var orb: NSPanel!                       // the ambient dot/working-pill at the notch
    private var orbHosting: NSHostingView<OrbView>!
    private var glow: NSPanel!                      // the second-cursor glow overlay (click-through)
    private var glowHosting: NSHostingView<GodGlowView>!
    private let glowModel = GlowModel()
    private var consentPanel: NSPanel!             // the notch-drop "Allow this app?" (replaces the NSAlert)
    private var gatePanel: NSPanel!                // the permissions concierge card (notch drop)
    private var gateDismissed = false             // user closed the card this session → don't nag again until relaunch
    private var gateShowingPerm: GodPerm?         // which permission step is currently on screen
    private var openedByHover = false             // panel opened via orb hover (auto-close on hover-out) vs glyph click
    private var godArmed = false                  // ⌃⌥ currently held (rising-edge detector for the trigger)
    private var godRunning = false                // a God loop is in flight — don't stack another
    private var lastCtrlTap: Date?                // summon double-tap detector (timing window)
    private var summonWasDown = false            // edge-detect the summon modifier so a hold ≠ repeated taps
    private var godStateTimer: Timer?             // polls ~/.relay/god-state → notch listening/thinking/speaking
    private var godListening = false              // mic is recording your request
    private var recorder: AVAudioRecorder?        // in-process mic capture — makes THIS app the TCC mic client
    private var recWav: String?                   // where the clip lands
    private var dictating = false                 // ⌃⌥ dictation in progress (raw STT → paste/find, no God). True in BOTH modes.
    private var dictateRecorder: AVAudioRecorder? // separate recorder for the dictation gesture
    private var dictateWav: String?
    private var voiceBuffer: String = ""           // the last dictation, for the on-demand ⌥V re-paste
    // ── Latched-dictation state machine (dictationMode == "latch") ────────────────────────────────
    // idle → (talk-chord tap) dictating → (⌃ tap) committing → idle · Esc aborts from any state.
    // `dictating` above is the single "recording is live" flag both modes share; these drive the LATCH
    // grammar only. A poll timer (free reads, no extra TCC) owns commit/cancel/find while latched, so it
    // never fights the flagsChanged summon/launcher edge logic in onFlags.
    private var dictateLatched = false            // true only in latch mode while recording is latched on
    private var dictateWatchTimer: Timer?         // ~60fps poll: ⌃-tap commit · Esc cancel · Fn→find indicator
    let micLevel = MicLevelModel()                // drives the notch voice-waveform dot-matrix (fed from an independent source — NEVER the dictation recorder)
    private var dictatePrevCtrlDown = false        // edge-detect the commit modifier across ticks
    private var dictateFindArmed = false           // Fn is currently held → commit routes to vault.find, not paste
    private var dictateCommitting = false          // guard: a commit/transcribe is already in flight (ignore repeats)
    private var godConsentPending = false         // a RUN action is awaiting the notch "Allow?" (one drop at a time)
    private var godStatusPanel: NSPanel!          // the notch-drop phase indicator (Listening/Thinking/Speaking)
    private var godStatusLabel: String?           // current phase label — guards against rebuilding (waveform reset) each poll
    private var godStatusRefsKey: String?         // signature of the staged references shown in the pill (re-render when a ref is added/removed)
    private var godStatusProject: String?         // active project id shown in the pill (re-render when the user switches it)
    private var lastGodAudio: String?             // the last voice turn's clip — so switching the project can RE-RUN it grounded anew
    private var glowCursorTimer: Timer?           // polls the mouse ~30fps so the glow follows the cursor (no AX grant needed)
    private var godProc: Process?                 // the running god.mjs (so a single Ctrl can cancel it)
    private var videoExtracting = false           // a video2ai extraction is in flight (one at a time)
    private var videoProc: Process?               // the running video2ai-pipeline.mjs
    private var pointMarkPinned = false           // explicit, time-limited latch to keep a model-chosen ring briefly AFTER a run ends — the sanctioned replacement for the old buggy `target != nil` gate
    private var pointMarkPinTimer: Timer?         // auto-expiry that forces a pinned mark back to idle so the ring can never be orphaned
    // ── Ambient mode (strictly-local awareness → contextual helper canvas) ────────────────────────
    private let ambientSensor = AmbientSensor()   // NSWorkspace + AX detection; no network/screenshot/model
    private var ambientPanel: NotchPanel?         // the helper canvas, a notch drop like God's pills
    private var ambientOn = false                 // master switch — flag-gated (~/.relay/ambient-on), default OFF
    private var ambientContextKey = ""            // signature of what's surfaced now → don't re-present the same card
    private var ambientSuppressUntil: Date?       // after a manual dismiss, hush ambient briefly
    private var clickMonitor: Any?
    private var hotKeyMonitor: Any?
    private var eventTap: CFMachPort?
    private var mouseMonitor: Any?
    private var flagsMonitor: Any?
    private var timer: Timer?
    private var phase = 0
    private let model = Model()
    private let ollama = OllamaMonitor()
    private let icons = IconStore()
    private let onboard = Onboard()
    private var consent: ConsentClient?
    // Keyboard on the consent cards (founder 2026-08-13): the cards show key-caps (Esc / ↵), so the keys
    // must actually fire — else a cap is a lie. A local keyDown monitor is armed while a consent card is up.
    private var pendingConsentApprove: (() -> Void)?
    private var pendingConsentDeny: (() -> Void)?
    private var consentKeyMonitor: Any?
    // Arm Esc→deny · ↵ / ⌥→ → approve while a consent card is up. The NotchPanel is nonactivating +
    // canBecomeKey, so makeKey lets the LOCAL monitor receive the keystroke without stealing app focus.
    @MainActor private func armConsentKeys(approve: @escaping () -> Void, deny: @escaping () -> Void) {
        disarmConsentKeys()
        pendingConsentApprove = approve; pendingConsentDeny = deny
        consentPanel?.makeKeyAndOrderFront(nil)
        consentKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] ev in
            guard let self, self.consentPanel?.isVisible == true else { return ev }
            if ev.keyCode == 53 { self.pendingConsentDeny?(); return nil }                                  // Esc → deny
            if ev.keyCode == 36 || (ev.keyCode == 124 && ev.modifierFlags.contains(.option)) {              // ↵ or ⌥→ → approve
                self.pendingConsentApprove?(); return nil
            }
            return ev
        }
    }
    @MainActor private func disarmConsentKeys() {
        if let m = consentKeyMonitor { NSEvent.removeMonitor(m); consentKeyMonitor = nil }
        pendingConsentApprove = nil; pendingConsentDeny = nil
    }

    // Native "Allow this app?" dialog — a real macOS alert, from the trusted Switchboard app itself.
    private func showNativeConsent(_ id: String, _ body: [String: Any]) {
        let appId = body["appId"] as? String ?? "an app"
        // The app's OWN display name if it gave one (legible); else, honestly, the last id segment.
        let name = (body["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? (appId.contains(".") ? String(appId.split(separator: ".").last!).capitalized : appId)
        let reason = body["reason"] as? String ?? ""
        let canDo = (body["canDo"] as? [String])?.joined(separator: " · ") ?? "Use your local models and your Claude, through the gate"

        // A notch DROP, not a centered system alert. Non-blocking: the reply fires on button tap.
        let reply: (Bool) -> Void = { [weak self] allow in
            self?.disarmConsentKeys()
            self?.consent?.reply(id, allow)
            self?.consentPanel?.orderOut(nil)
        }
        let view = ConsentDrop(name: name, appId: appId, reason: reason, canDo: canDo,
                               onAllow: { reply(true) }, onDeny: { reply(false) })
        if consentPanel == nil {
            consentPanel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            consentPanel.isOpaque = false
            consentPanel.backgroundColor = .clear
            consentPanel.hasShadow = false
            consentPanel.level = .popUpMenu
            consentPanel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        }
        consentPanel.contentView = NoInsetHostingView(rootView: view)
        let size = consentPanel.contentView!.fittingSize
        consentPanel.setContentSize(size)
        if let screen = statusItem?.button?.window?.screen ?? NSScreen.main {
            consentPanel.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        }
        presentFromNotch(consentPanel)
        armConsentKeys(approve: { reply(true) }, deny: { reply(false) })
    }

    // A native wrapp asks to open a folder (consent:storage-bind) or raise the picker
    // (consent:storage-pick). The A1 consent drop — folder + exact path, Not now / Allow. Reply is a
    // plain bool the daemon's ask<boolean> awaits; used to time out → auto-deny for native wrapps.
    private func showStorageBindConsent(_ id: String, _ kind: String, _ body: [String: Any]) {
        let origin = body["origin"] as? String ?? ""
        let path = body["path"] as? String ?? ""
        let app: String = {
            guard let host = URL(string: origin)?.host else { return "a wrapp" }
            if host.hasSuffix(".thelastprompt.ai") {
                let s = String(host.dropLast(".thelastprompt.ai".count))
                return s.isEmpty ? "a wrapp" : s.prefix(1).uppercased() + s.dropFirst()
            }
            if host.contains("localhost") || host.hasPrefix("127.") { return "this wrapp" }
            return host
        }()
        let reply: (Bool) -> Void = { [weak self] allow in
            self?.disarmConsentKeys()
            self?.consent?.reply(id, allow)
            self?.consentPanel?.orderOut(nil)
        }
        let view = StorageBindDrop(app: app, path: path, isPick: kind == "consent:storage-pick",
                                   onAllow: { reply(true) }, onDeny: { reply(false) })
        if consentPanel == nil {
            consentPanel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            consentPanel.isOpaque = false
            consentPanel.backgroundColor = .clear
            consentPanel.hasShadow = false
            consentPanel.level = .popUpMenu
            consentPanel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        }
        consentPanel.contentView = NoInsetHostingView(rootView: view)
        let size = consentPanel.contentView!.fittingSize
        consentPanel.setContentSize(size)
        if let screen = statusItem?.button?.window?.screen ?? NSScreen.main {
            consentPanel.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        }
        presentFromNotch(consentPanel)
        armConsentKeys(approve: { reply(true) }, deny: { reply(false) })
    }

    // consent:connect — the models+tools SCOPE grant, at the notch (was extension-only). Approve returns
    // the grant object {models, tools:[{name,access}], budgets, contextKinds}; Deny returns null.
    private func showConnectGrant(_ id: String, _ body: [String: Any]) {
        let origin = body["origin"] as? String ?? ""
        let reason = body["reason"] as? String ?? ""
        let modelsDict = body["models"] as? [String: Any] ?? [:]
        let available = (modelsDict["available"] as? [String]) ?? []
        let requested = (modelsDict["requested"] as? [String]) ?? []
        let tools: [(name: String, access: String, label: String)] = ((body["tools"] as? [[String: Any]]) ?? []).map {
            (name: $0["name"] as? String ?? "", access: $0["access"] as? String ?? "read", label: $0["label"] as? String ?? "")
        }.filter { !$0.name.isEmpty }
        let budgets = body["budgets"] as? [String: Any] ?? [:]
        let contextKinds = (body["contextKinds"] as? [String]) ?? []
        let finish: ([String: Any]?) -> Void = { [weak self] grant in
            self?.disarmConsentKeys()
            self?.consent?.replyResult(id, grant)
            self?.consentPanel?.orderOut(nil)
        }
        // A THIRD-PARTY tool (origin tool://<id>) gets the dedicated provenance-forward card — no model
        // pills (no LLM in the loop), keys-local lane badge, "you didn't build this" framing (§task 5).
        let content: AnyView
        if origin.hasPrefix("tool://") {
            content = AnyView(makeToolGrant(origin: origin, reason: reason, requestedTools: tools,
                                            budgets: budgets, contextKinds: contextKinds, finish: finish))
        } else {
            content = AnyView(ConnectGrantDrop(origin: origin, reason: reason, availableModels: available, requestedModels: requested,
                                    tools: tools, budgets: budgets, contextKinds: contextKinds,
                                    onApprove: { finish($0) }, onDeny: { finish(nil) }))
        }
        let view = content
        if consentPanel == nil {
            consentPanel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            consentPanel.isOpaque = false
            consentPanel.backgroundColor = .clear
            consentPanel.hasShadow = false
            consentPanel.level = .popUpMenu
            consentPanel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        }
        consentPanel.contentView = NoInsetHostingView(rootView: view)
        let size = consentPanel.contentView!.fittingSize
        consentPanel.setContentSize(size)
        if let screen = statusItem?.button?.window?.screen ?? NSScreen.main {
            consentPanel.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        }
        presentFromNotch(consentPanel)
        // Approve with the DEFAULT scope (requested models + all requested tools) on ↵/⌥→; deny on Esc.
        // Same object the card's Approve button builds from its default selection.
        let defaultGrant: [String: Any] = [
            "models": requested.isEmpty ? Array(available.prefix(1)) : requested,
            "tools": tools.map { ["name": $0.name, "access": $0.access] },
            "budgets": budgets, "contextKinds": contextKinds,
        ]
        armConsentKeys(approve: { finish(defaultGrant) }, deny: { finish(nil) })
    }

    // Build the third-party TOOL grant card from the daemon's consent:connect body. The requested tools
    // are QUALIFIED (mcp__<server>__<tool>) so the allowlist matches on approve; we keep those verbatim as
    // `grantTools` and derive pretty display (bare name + the listing's description) for the human.
    @MainActor private func makeToolGrant(origin: String, reason: String,
                                          requestedTools: [(name: String, access: String, label: String)],
                                          budgets: [String: Any], contextKinds: [String],
                                          finish: @escaping ([String: Any]?) -> Void) -> ToolGrantDrop {
        let id = String(origin.dropFirst("tool://".count))
        let listing = readCatalog().first { $0.id == id }
        // server: prefer the listing's mcp binding; else parse it out of the first qualified tool name.
        func splitQualified(_ q: String) -> (server: String, tool: String) {
            var s = q
            if s.hasPrefix("mcp__") { s = String(s.dropFirst("mcp__".count)) }
            if let r = s.range(of: "__") { return (String(s[s.startIndex..<r.lowerBound]), String(s[r.upperBound...])) }
            return ("", s)
        }
        let server = listing?.mcp?.server ?? requestedTools.first.map { splitQualified($0.name).server } ?? id
        let name = listing?.name ?? reason.components(separatedBy: " — ").first?.trimmingCharacters(in: .whitespaces) ?? id
        let tagline = listing?.tagline ?? (reason.isEmpty ? "A third-party tool, running on your machine." : reason)
        let actions: [ToolGrantAction] = requestedTools.map { t in
            let bare = splitQualified(t.name).tool
            let desc = listing?.tools?.first { $0.name == bare }?.description ?? ""
            let label = t.label.isEmpty ? bare.replacingOccurrences(of: "_", with: " ") : t.label
            return ToolGrantAction(label: label, desc: desc, write: t.access == "write")
        }
        let grantTools: [[String: Any]] = requestedTools.map { ["name": $0.name, "access": $0.access] }
        return ToolGrantDrop(toolName: name, tagline: tagline, server: server, actions: actions,
                             grantTools: grantTools, budgets: budgets, contextKinds: contextKinds,
                             lane: .localNoKey, onApprove: { finish($0) }, onDeny: { finish(nil) })
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

    // Pick God's voice: write ~/.relay/voices/selected (God's companion.mjs reads it). Empty = macOS say.
    @MainActor private func selectVoice(_ name: String) {
        let f = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/voices/selected")
        try? Data(name.utf8).write(to: URL(fileURLWithPath: f))
        model.refreshFiles()
        toast(name.isEmpty ? "Voice: macOS default" : "Voice: \(name)")
        previewVoice(name)   // speak a sample immediately, so picking a voice is audibly confirmed
    }

    // Speak a one-line sample in the just-picked voice — the SAME path God uses (the Pocket-TTS clone
    // server on :7897), so if you hear the clone here you'll hear it from God. Falls back to macOS
    // `say` when the clone server is down or the pick is the default. Off the main thread (net + audio).
    private func previewVoice(_ name: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            let sample = name.isEmpty ? "This is the default voice." : "Hi, this is your \(name) voice."
            func sayIt(_ args: [String]) {
                let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/say"); p.arguments = args + [sample]; try? p.run()
            }
            guard !name.isEmpty else { sayIt([]); return }
            // Try the clone server (what God actually uses).
            let wav = NSTemporaryDirectory() + "voice-preview.wav"
            try? FileManager.default.removeItem(atPath: wav)
            let esc = sample.replacingOccurrences(of: "\"", with: "")
            let body = "{\"text\":\"\(esc)\",\"voice\":\"\(name)\"}"
            let curl = Process(); curl.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
            curl.arguments = ["-s", "-m", "25", "-X", "POST", "http://127.0.0.1:7897/speak",
                              "-H", "content-type: application/json", "-d", body, "-o", wav]
            try? curl.run(); curl.waitUntilExit()
            let sz = (try? FileManager.default.attributesOfItem(atPath: wav)[.size] as? Int) ?? 0
            if curl.terminationStatus == 0, (sz ?? 0) > 1000 {
                let play = Process(); play.executableURL = URL(fileURLWithPath: "/usr/bin/afplay"); play.arguments = [wav]; try? play.run()
            } else {
                sayIt(["-v", name])   // not a clone (or server down) — try it as a macOS voice name
            }
        }
    }

    // Drop a sample → clone it into a voice: convert to a 24kHz mono WAV in ~/.relay/voices, ask the
    // god-tts service to clone it (caches a .safetensors), then select it. Off the main thread.
    @MainActor private func dropVoices(_ urls: [URL]) {
        let audio = urls.first { ["wav", "mp3", "m4a", "aiff", "aac", "flac", "ogg"].contains($0.pathExtension.lowercased()) }
        guard let src = audio ?? urls.first else { return }
        let raw = src.deletingPathExtension().lastPathComponent.lowercased()
        let cleaned = String(raw.map { ($0.isLetter || $0.isNumber) ? $0 : "-" })
        let voice = cleaned.split(separator: "-").prefix(3).joined(separator: "-").prefix(24).description
        let name = voice.isEmpty ? "voice" : voice
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/voices")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let dst = (dir as NSString).appendingPathComponent("\(name).wav")
        toast("Cloning \(name)…")
        DispatchQueue.global(qos: .userInitiated).async {
            let ff = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].first { FileManager.default.fileExists(atPath: $0) }
            if let ff = ff {
                let p = Process(); p.executableURL = URL(fileURLWithPath: ff)
                p.arguments = ["-y", "-i", src.path, "-ar", "24000", "-ac", "1", dst]
                p.standardOutput = Pipe(); p.standardError = Pipe()
                try? p.run(); p.waitUntilExit()
            } else {
                try? FileManager.default.removeItem(atPath: dst)
                try? FileManager.default.copyItem(atPath: src.path, toPath: dst)
            }
            Task { @MainActor in self.model.refreshFiles() }   // the file exists now → shows in the list
            // ask the service to clone (idempotent; caches a .safetensors), then select it.
            var req = URLRequest(url: URL(string: "http://127.0.0.1:7897/clone")!)
            req.httpMethod = "POST"; req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["name": name])
            req.timeoutInterval = 180
            URLSession.shared.dataTask(with: req) { _, resp, err in
                let ok = err == nil && ((resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false)
                Task { @MainActor in
                    if ok {
                        self.selectVoice(name); self.toast("Voice ready: \(name)")
                    } else {
                        // The clone engine (:7897) didn't take it — DON'T pretend it worked and leave the
                        // user silently on the macOS `say` voice (the old bug). Drop the phantom .wav so the
                        // voice list stays truthful, and say what's actually wrong.
                        try? FileManager.default.removeItem(atPath: dst)
                        self.model.refreshFiles()
                        self.toast(self.voiceEngineHint(err))
                    }
                }
            }.resume()
        }
    }

    // Honest failure copy when a /clone POST to :7897 fails — the old path hid every failure behind a
    // fake "Voice ready". Distinguish "engine not running" (the common new-user case — it's unwired) from
    // a genuine clone error so the toast points somewhere real.
    private func voiceEngineHint(_ err: Error?) -> String {
        if let u = err as? URLError,
           [.cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .timedOut].contains(u.code) {
            return "Voice cloning isn't set up — the voice engine (:7897) isn't running."
        }
        return "Couldn't clone that voice — check the voice engine and try again."
    }

    // Remove a connected app/site by origin (web / tab / iPhone). Native apps go through
    // disconnectNativeApp (revokes the per-app token too); everything else revokes the grant.
    @MainActor private func revokeOrigin(_ origin: String) {
        let name = model.appList.first { $0.id == origin }?.label ?? origin
        let a = NSAlert()
        a.messageText = "Remove \u{201C}\(name)\u{201D}?"
        a.informativeText = "It loses access now. It'll ask to connect again the next time you use it."
        a.addButton(withTitle: "Remove"); a.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard a.runModal() == .alertFirstButtonReturn else { return }
        consent?.control("revoke", ["origin": origin])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.model.refreshFiles() }
    }

    // Save the name God greets you by. Writes ~/.relay/profile.json (merge-preserving, so an avatar
    // survives) AND asks the daemon to setProfile so a running session picks it up live.
    @MainActor private func setUserName(_ name: String) {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true)
        let f = (RELAY_DIR as NSString).appendingPathComponent("profile.json")
        var obj = (readJSON(f) as? [String: Any]) ?? [:]
        obj["name"] = n
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: f))
        }
        consent?.control("setProfile", ["name": n])
        model.refreshFiles()
        toast("Name saved: \(n)")
    }

    // Economy mode → a tiny ~/.relay/economy flag God reads to prefer a cheaper/faster model.
    @MainActor private func setEconomy(_ on: Bool) {
        try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true)
        let f = (RELAY_DIR as NSString).appendingPathComponent("economy")
        try? Data((on ? "1" : "0").utf8).write(to: URL(fileURLWithPath: f))
        model.refreshFiles()
        toast(on ? "Economy mode on" : "Economy mode off")
    }

    // Default screen-share → ~/.relay/god-default-share. ON: a plain ⌃⌃ auto-shares the whole screen (and
    // fn+click toggles it back off); OFF: a plain ⌃⌃ is voice-only and you fn-grab to share. Snapshotted at
    // listening-start, so flipping this mid-turn never changes the in-flight turn.
    @MainActor private func setDefaultShare(_ on: Bool) {
        try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true)
        let f = (RELAY_DIR as NSString).appendingPathComponent("god-default-share")
        try? Data((on ? "1" : "0").utf8).write(to: URL(fileURLWithPath: f))
        model.refreshFiles()
        toast(on ? "God sees your screen by default" : "God is voice-only until you fn-grab")
    }

    // Model selection (docs/MODEL-SELECTION.md §8) — write the deny-list to ~/.relay/models.json. `name` is
    // any friendly/backend id; we store it CANONICAL so disabling "Opus 4.8" also catches "claude-opus-4-8".
    // The daemon-side substitution/filter is a separate job; this just owns the file. Guard: never write an
    // empty allowed set — the last-of-class lock lives in the UI, this is the belt-and-suspenders.
    @MainActor private func setModelDisabled(_ name: String, _ disabled: Bool) {
        let id = canonicalModelId(name)
        var set = readModelPrefs()
        if disabled { set.insert(id) } else { set.remove(id) }
        try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true)
        let f = (RELAY_DIR as NSString).appendingPathComponent("models.json")
        let obj: [String: Any] = ["disabled": Array(set).sorted()]
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: f))
        }
        model.refreshFiles()
        toast(disabled ? "\(name) off — nothing will use it" : "\(name) back on")
    }

    // ⌃⌃ region select → ~/.relay/god-region. On: the next summon drags a rectangle; only it is sent.
    @MainActor private func setRegion(_ on: Bool) {
        try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true)
        let f = (RELAY_DIR as NSString).appendingPathComponent("god-region")
        try? Data((on ? "1" : "0").utf8).write(to: URL(fileURLWithPath: f))
        model.refreshFiles()
        toast(on ? "God sees a region you drag" : "God sees the whole screen")
    }

    // Rebind a gesture → ~/.relay/shortcuts.json. `kind` is "summon" or "talk"; `value` is one of the
    // curated presets (validated on read). refreshFiles reloads model.shortcuts so both onFlags and the
    // Settings keycaps pick it up live — no relaunch.
    @MainActor private func setShortcut(_ kind: String, _ value: String) {
        try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true)
        let f = (RELAY_DIR as NSString).appendingPathComponent("shortcuts.json")
        var obj = (readJSON(f) as? [String: Any]) ?? [:]
        obj[kind] = value
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: f))
        }
        model.refreshFiles()
        toast(kind == "summon" ? "Summon: double-tap \(modGlyph(value))" : "Talk: hold \(talkGlyphs(value))")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        registerBundledFonts()
        NSApp.setActivationPolicy(.accessory)
        // Wire the OS's real wrapp-launch seam: a tile in the OS window resolves its app id here and
        // opens the real page, carrying item context as `#os=` (docs/OS.md — carried context).
        OSLaunch.handler = { [weak self] appId, ctx in Task { @MainActor in self?.launchFromOS(appId, ctx) } }
        // Wire the OS Home spotlight (OmniBar): app search over the live catalog, and "ask" → God.
        OSCatalog.search = { q in
            let ql = q.lowercased()
            return readCatalog()
                .filter { $0.name.lowercased().contains(ql) || $0.tagline.lowercased().contains(ql) }
                .prefix(6).map { OmniApp(id: $0.id, name: $0.name, sub: $0.tagline) }
        }
        OSAsk.handler = { [weak self] q in Task { @MainActor in if q.isEmpty { self?.triggerGod() } else { self?.triggerGod(instruction: q) } } }
        // The OS Store surface is a door, not a rebuild — it opens the real native store front.
        OSStoreDoor.handler = { [weak self] in Task { @MainActor in self?.showStore() } }
        // Become the daemon's native consent surface — native apps' "Allow?" prompts show HERE.
        consent = ConsentClient(port: PORT,
            tokenProvider: {
                guard let raw = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8) else { return nil }
                let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : t
            },
            onPrompt: { [weak self] id, kind, body in Task { @MainActor in
                switch kind {
                case "consent:native-connect": self?.showNativeConsent(id, body)
                case "consent:connect": self?.showConnectGrant(id, body)
                default: self?.showStorageBindConsent(id, kind, body)   // storage-bind / storage-pick
                }
            } })
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = glyphImage(running: false, working: false, signedIn: true, phase: 0)
        statusItem.button?.action = #selector(togglePopover)
        statusItem.button?.target = self
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])   // right-click → widget preview menu

        hosting = NoInsetHostingView(rootView: Panel(
            model: model,
            ollama: ollama,
            icons: icons,
            onboard: onboard,
            onToken: { [weak self] in self?.copyToken() },
            onLogs: { NSWorkspace.shared.open(URL(fileURLWithPath: LOG_FILE)) },
            onRestart: { [weak self] in self?.startOrRestart() },
            onStop: { [weak self] in self?.stopDaemon() },
            onTakeOver: { [weak self] in self?.takeOverDaemon() },
            onRepair: { [weak self] in self?.repairDaemon() },
            onQuit: { NSApp.terminate(nil) },
            onDisconnect: { [weak self] appId in self?.disconnectNativeApp(appId) },
            onUpdate: { [weak self] in self?.updateDaemon() },
            onPickContext: { [weak self] id in writeGlobalContext(id); self?.model.refreshFiles() },
            onSelectVoice: { [weak self] name in self?.selectVoice(name) },
            onDropVoice: { [weak self] urls in self?.dropVoices(urls) },
            onRevoke: { [weak self] origin in self?.revokeOrigin(origin) },
            onOpen: { [weak self] app in self?.openConnectedApp(app) },
            onSetName: { [weak self] name in self?.setUserName(name) },
            onSetEconomy: { [weak self] on in self?.setEconomy(on) },
            onSetRegion: { [weak self] on in self?.setRegion(on) },
            onSetDefaultShare: { [weak self] on in self?.setDefaultShare(on) },
            onSetModelDisabled: { [weak self] name, off in self?.setModelDisabled(name, off) },
            onSetShortcut: { [weak self] kind, value in self?.setShortcut(kind, value) },
            onSignIn: { [weak self] in self?.startClaudeLogin() },
            onFixSenses: { [weak self] in self?.refreshPermissionGate() },
            onStore: { [weak self] in self?.showStore() },
            onTour: { [weak self] in self?.startWelcomeTour() },
            onConnectClaudeNotch: { [weak self] in self?.promptConnectClaudeCodeNotch() }
        ))
        // A borderless, non-activating panel pinned under the icon — NSPopover kept anchoring into
        // mid-air, and the arrow is noise anyway. The SwiftUI view brings its own rounded corners.
        panel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .popUpMenu   // above the system menu bar, so the panel can overlap it
        panel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]   // open the panel over a fullscreen app too
        panel.contentView = hosting

        // The ambient orb — always at the notch, morphing dot ↔ working-pill, hover/click opens the panel.
        orbHosting = NoInsetHostingView(rootView: OrbView(model: model, glow: glowModel, onOpen: { [weak self] in self?.openFromOrb() }))
        orb = NotchPanel(contentRect: NSRect(x: 0, y: 0, width: 168, height: 26), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        orb.isOpaque = false
        orb.backgroundColor = .clear
        orb.hasShadow = false
        orb.level = .popUpMenu
        // The base notch must ride a native-fullscreen Space too. It previously had .stationary and NO
        // .fullScreenAuxiliary → the orb (and thus the whole "base notch") vanished whenever a fullscreen app
        // was frontmost. .fullScreenAuxiliary + no .stationary = it floats over fullscreen like the other panels.
        orb.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        orb.acceptsMouseMovedEvents = true          // so SwiftUI onHover fires on this non-key panel
        orb.contentView = orbHosting
        positionOrb()
        orb.orderFrontRegardless()

        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll(); self?.refreshPermissionGate(); self?.checkOpenOSTrigger() }
        }
        installHotKey()
        installVoicePasteHotKey()
        installGlow()
        CursorGuide.shared.install()   // arms the ~/.relay/guide-run.json watcher (dormant until a run is written): guided testing + how-to tours
        WhiteboardController.shared.install()   // arms the ~/.relay/whiteboard-run.json watcher: floats the native whiteboard board (PIP-style) on {active:true}
        installUpdateCheck()           // daily GitHub release check → ONE notch card when a newer build ships
        installOpenWrappTrigger()      // ~/.relay/open-wrapp.json → open that wrapp in the native bridged window (CLI threads can launch surfaces)
        // Feedback capture: a fail (or fn↓) during a guide raises the notch note field + arms the fn-drag grab.
        CursorGuide.shared.onFeedbackBegin = { [weak self] _ in Task { @MainActor in self?.showFeedbackNote() } }
        CursorGuide.shared.onFeedbackEnd   = { [weak self] in Task { @MainActor in self?.hideFeedbackNote() } }
        // Spoken concierge: the welcome tour AND teach mode read each step aloud in God's voice.
        CursorGuide.shared.onSpeak     = { [weak self] line in Task { @MainActor in self?.speakGuideLine(line) } }
        CursorGuide.shared.onStopSpeak = { [weak self] in Task { @MainActor in self?.stopGuideSpeech() } }
        // Options live-apply: when a guide step's variant is approved, apply it here. Onboarding is the
        // first consumer — the welcome tour's "setup-economy" step flips economy mode the moment you pick.
        CursorGuide.shared.onOptionApprove = { [weak self] stepId, optionId in
            Task { @MainActor in
                switch stepId {
                case "setup-economy": self?.setEconomy(optionId == "eco")
                default: break
                }
            }
        }
        // Explain mode: teach the decision before the pick (docs/NOTCH-EXPLAIN.md). Generate a trade-off
        // diagram + a short Moira voiceover on the user's own Claude, show the diagram as the card's media,
        // and speak it — then the options resurface.
        CursorGuide.shared.onExplain = { [weak self] _, question, options in
            Task { @MainActor in self?.explainDecision(question: question, options: options) }
        }
        // Teach mode senses locally: hand CursorGuide a fresh AmbientSignal on demand so its doneWhen
        // watcher can decide when a step is done. Reuses the same LOCAL sensor ambient mode uses (no
        // network/screenshot beyond the opt-in Vision OCR); wired unconditionally so teach works even
        // when ambient mode is off.
        CursorGuide.shared.sampleSignal = { [weak self] in self?.ambientSensor.sampleNow() }
        startBundledWebServer()        // packaged app: serve the bundled wrapps/widgets locally so ⌥⌥ works offline
        refreshPermissionGate()
        startAmbientIfEnabled()   // strictly-local awareness (flag-gated, default off)

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
        case .ours where hasBundledDaemon() && !isTranslocated() && plistEnvOutdated():
            // Our plist, SAME path, but written by an older build that lacks a daemon env key this
            // build needs (e.g. RELAY_STT_CMD for God's ear). A same-path app update doesn't otherwise
            // rewrite the plist, so the fix never reached the running daemon — refresh it now.
            godLog("plist missing required daemon env — refreshing LaunchAgent")
            repairDaemon()
        default:
            break
        }
        // …and SHOW the app once. An accessory app's launch is otherwise invisible: no Dock icon,
        // no window — just an 18px mark appearing in a crowded menu bar. Presenting the popover
        // one time teaches where Relay lives and puts the token button on screen. Never again
        // after that (the token file exists on every later launch).
        // Onboarding (docs/ONBOARDING.md): until they finish it, opening the panel lands on the setup
        // ladder. Only AUTO-open on the very first run (as today) — later launches wait to be asked.
        if !readOnboarded() { onboard.beginSetup() }
        if firstRun {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
                guard let self, self.panel?.isVisible != true else { return }
                NSApp.activate(ignoringOtherApps: true)
                self.togglePopover()
            }
        }
    }

    // Onboarding rung 2 — the sign-in cliff. Mirror concierge.mjs: open Terminal and start `claude`.
    @MainActor private func startClaudeLogin() {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", "tell application \"Terminal\" to activate",
                       "-e", "tell application \"Terminal\" to do script \"claude\""]
        try? p.run()
    }

    @objc private func togglePopover() {
        let t = NSApp.currentEvent?.type
        if t == .rightMouseUp || t == .rightMouseDown { showWidgetPreviewMenu(); return }
        if panel.isVisible { hidePanel() } else { openedByHover = false; showPanel() }
    }
    // Review affordance: right-click the menu-bar icon to see the notch widget across every result type.
    @objc private func showWidgetPreviewMenu() {
        let roast = "\"3x exited.\" Let's translate that from Founder-ese to English: three separate times, a company looked at your team, said \"we don't want the product, but fine, we'll take the people,\" and quietly absorbed you into middle management.\n\nThat's not an exit. That's being adopted. Three times. By strangers."
        let specs: [(String, WidgetSpec)] = [
            ("Widget — image (Prism)", WidgetSpec(kicker: "PRISM · IMAGE", title: "From your selection", openLabel: "Open in Prism",
                result: .image(caption: "A soft editorial illustration based on your selection.", steer: ["Warmer", "More detail", "Flat vector", "Photoreal"], file: nil))),
            ("Widget — text (Roast)", WidgetSpec(kicker: "ROAST · TEXT", title: "Acqui-Hire Alchemist", openLabel: "Open in Roast", result: .text(roast))),
            ("Widget — cards (AdForge)", WidgetSpec(kicker: "ADFORGE · CONCEPTS", title: "This week's ads", openLabel: "Open in AdForge",
                result: .cards(caption: "Three angles, grounded in your brand.", items: [
                    CardItem(label: "Lead with the outcome", text: "Ship AI apps without paying for inference.", rec: true),
                    CardItem(label: "Name the pain", text: "You already pay for Claude — why pay twice?"),
                    CardItem(label: "Proof & specifics", text: "75% of revenue to devs, by usage.")]))),
            ("Widget — gallery (Yearbook)", WidgetSpec(kicker: "YEARBOOK · GALLERY", title: "Through the decades", openLabel: "Open in Yearbook",
                result: .gallery(caption: "Four eras from your photo.", items: ["Class of '77", "Class of '88", "Class of '99", "Class of '09"]))),
            ("Widget — working", WidgetSpec(kicker: "PRISM · IMAGE", title: "Making an image…", openLabel: "Open in Prism", result: .working("Making an image from your selection…"))),
        ]
        let menu = NSMenu()
        // Resume an ABANDONED guide — shown only when one is suspended (esc'd part-way). Picks up right
        // where you left off (the run carries its startIndex).
        if let suspended = readSuspendedGuide() {
            let t = (suspended["suspendedTitle"] as? String) ?? "Resume guide"
            let resume = NSMenuItem(title: "▶ \(t)", action: #selector(resumeSuspendedGuide), keyEquivalent: "")
            resume.target = self
            menu.addItem(resume)
        } else {
            // Always visible (disabled) so it's discoverable — becomes "▶ Resume … step N/total" once you esc a guide part-way.
            let none = NSMenuItem(title: "Resume guide (none paused)", action: nil, keyEquivalent: "")
            none.isEnabled = false
            menu.addItem(none)
        }
        menu.addItem(.separator())
        // Guided form fill: copy a form (⌘A⌘C) then click this → a fill-guide with your data, field by field.
        let fill = NSMenuItem(title: "Fill a form from clipboard", action: #selector(fillFormFromClipboard), keyEquivalent: "")
        fill.target = self
        menu.addItem(fill)
        menu.addItem(.separator())
        // LIVE first — the real thing. Drive ANY installed wrapp on your own Claude: pick it, give it
        // input, its <id>_run tool runs in a hosted webview and the result lands as a notch widget.
        // (Not roast-only anymore — the whole catalog is drivable. docs/GOD-HANDS.md "God drives ALL wrapps".)
        let drive = NSMenuItem(title: "Drive a wrapp (LIVE — real Claude)", action: nil, keyEquivalent: "")
        drive.submenu = buildDrivePickerMenu()
        menu.addItem(drive)
        let diagram = NSMenuItem(title: "Diagram from clipboard (LIVE)", action: #selector(diagramFromClipboardItem), keyEquivalent: ""); diagram.target = self
        menu.addItem(diagram)
        menu.addItem(.separator())
        let previews = NSMenuItem(title: "Widget previews (samples)", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (label, spec) in specs {
            let it = NSMenuItem(title: label, action: #selector(previewWidgetItem(_:)), keyEquivalent: "")
            it.target = self; it.representedObject = spec; sub.addItem(it)
        }
        previews.submenu = sub
        menu.addItem(previews)
        // LIVE web widget — load a wrapp's WIDGET-surface page in the notch with window.claude bridged to the
        // daemon (native@widget principal). Testable now for any listing that ships a page (e.g. ideabrain, resize).
        let webPreview = NSMenuItem(title: "Preview widget (LIVE web)", action: nil, keyEquivalent: "")
        let wsub = NSMenu()
        let widgetListings = readCatalog().filter { $0.components.ui?.url != nil }.sorted { $0.name < $1.name }
        if widgetListings.isEmpty {
            let none = NSMenuItem(title: "No wrapps with a widget page in the catalog", action: nil, keyEquivalent: ""); none.isEnabled = false; wsub.addItem(none)
        } else {
            for l in widgetListings {
                let it = NSMenuItem(title: l.name, action: #selector(previewWebWidgetItem(_:)), keyEquivalent: "")
                it.target = self; it.representedObject = l as AnyObject; wsub.addItem(it)
            }
        }
        webPreview.submenu = wsub
        menu.addItem(webPreview)
        menu.addItem(.separator())
        // Capture is explicit + fn-gated now (pointer stays free to drop a file). This submenu is just a
        // legend for the gestures you can do during a ⌃⌃; annotate-the-grab is honestly marked soon.
        let capture = NSMenuItem(title: "What God sees", action: nil, keyEquivalent: "")
        let csub = NSMenu()
        // The legend INVERTS with the default-share toggle so it's never stale (a plain ⌃⌃ is voice-only unless
        // you've turned sharing on in Settings → What God sees).
        let lines = model.defaultShare
            ? ["Just talk → whole screen (shared now)", "fn + click → take the share back (voice-only)", "fn + drag → share just a region", "Drop a file on the notch → reference"]
            : ["Just talk → voice only (nothing shared)", "fn + click → share the whole screen", "fn + drag → share a region", "Drop a file on the notch → reference"]
        for line in lines {
            let it = NSMenuItem(title: line, action: nil, keyEquivalent: ""); it.isEnabled = false; csub.addItem(it)
        }
        csub.addItem(.separator())
        let draw = NSMenuItem(title: "Annotate the grab — coming soon", action: nil, keyEquivalent: ""); draw.isEnabled = false
        csub.addItem(draw)
        capture.submenu = csub
        menu.addItem(capture)
        // A FILE as context for God's next ⌃⌃ (the file analog of "make an image like THIS") is attached by
        // DRAGGING it onto the notch — not a picker. When one's staged, show it here with a way to clear.
        if !godRefs.isEmpty {
            let n = godRefs.count
            let cur = NSMenuItem(title: "\(n) reference\(n == 1 ? "" : "s") staged — click to clear all", action: #selector(clearAttachedFileForGod), keyEquivalent: ""); cur.target = self
            menu.addItem(cur)
        } else {
            let hint = NSMenuItem(title: "Drop files on the notch (or fn-grab the screen) to give God references", action: nil, keyEquivalent: ""); hint.isEnabled = false
            menu.addItem(hint)
        }
        menu.addItem(.separator())
        // Ambient mode — strictly-local awareness → contextual notch helper (docs/AMBIENT.md). Flag-gated.
        let amb = NSMenuItem(title: ambientOn ? "Ambient mode: On (local)" : "Ambient mode: Off", action: #selector(toggleAmbientMenu), keyEquivalent: ""); amb.target = self
        amb.state = ambientOn ? .on : .off
        menu.addItem(amb)
        menu.addItem(.separator())
        let tour = NSMenuItem(title: "Replay the welcome tour", action: #selector(replayWelcomeTour), keyEquivalent: ""); tour.target = self
        menu.addItem(tour)
        let open = NSMenuItem(title: "Open panel", action: #selector(openPanelFromMenu), keyEquivalent: ""); open.target = self
        menu.addItem(open)
        // The windowed OS — the "come back to" desk the notch points at (docs/OS.md). Single window, the
        // rail swaps the detail pane in place. ⌘O opens it; lazily created on first show.
        let openOS = NSMenuItem(title: "Open OS", action: #selector(openOSWindow), keyEquivalent: "o"); openOS.target = self
        menu.addItem(openOS)
        if let btn = statusItem.button { menu.popUp(positioning: nil, at: NSPoint(x: 0, y: btn.bounds.height + 5), in: btn) }
    }
    @objc private func openOSWindow() { OSShellWindowController.shared.show() }

    // ── Guided FORM FILL (docs/FORM-FILL.md) ───────────────────────────────────────────────────────
    // "Help me fill this form" from anywhere: the user selects the form + ⌘A⌘C, then triggers this. We
    // read the copied form + their ~/.relay/identity.json, match the fields we HAVE data for, and raise a
    // teach fill-guide — one step per field, that field's value pre-loaded on the clipboard, so they just
    // click the field and ⌘V (doneWhen:field-non-empty auto-advances). Deterministic + local: no tokens,
    // nothing leaves the Mac. (An LLM mapper for exotic forms is a future upgrade.)
    private struct FillField { let key: String; let label: String; let synonyms: [String] }
    private let fillFields: [FillField] = [
        .init(key: "name",    label: "Name",    synonyms: ["full name", "your name", "name"]),
        .init(key: "email",   label: "Email",   synonyms: ["e-mail", "email"]),
        .init(key: "phone",   label: "Phone",   synonyms: ["phone number", "mobile", "cell", "phone", "tel"]),
        .init(key: "address", label: "Address", synonyms: ["street address", "address", "street"]),
        .init(key: "city",    label: "City",    synonyms: ["city", "town"]),
        .init(key: "state",   label: "State",   synonyms: ["state", "province", "region"]),
        .init(key: "zip",     label: "Zip",     synonyms: ["postal code", "zip code", "postcode", "zip"]),
        .init(key: "company", label: "Company", synonyms: ["organization", "organisation", "employer", "company"]),
        .init(key: "website", label: "Website", synonyms: ["website", "url", "web site"]),
    ]
    // Read (seed on first use) ~/.relay/identity.json — the user's fill data, label→value. Name from profile.
    private func readIdentity() -> [String: String] {
        let p = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/identity.json")
        if let data = try? Data(contentsOf: URL(fileURLWithPath: p)),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String] { return obj }
        // seed: name from profile, the rest empty for the user to fill once
        var seed: [String: String] = ["name": model.userName, "email": "", "phone": "", "address": "",
                                      "city": "", "state": "", "zip": "", "company": "", "website": ""]
        if let d = try? JSONSerialization.data(withJSONObject: seed, options: [.prettyPrinted]) {
            try? d.write(to: URL(fileURLWithPath: p), options: .atomic)
        }
        return seed
    }
    @MainActor @objc private func fillFormFromClipboard() {
        let clip = (NSPasteboard.general.string(forType: .string) ?? "").lowercased()
        guard !clip.isEmpty else { raiseFillNote("Copy the form first (⌘A then ⌘C), then try again."); return }
        let id = readIdentity()
        var pairs: [(label: String, value: String)] = []
        for f in fillFields {
            guard let val = id[f.key], !val.isEmpty else { continue }          // only fields I actually have
            guard f.synonyms.contains(where: { clip.contains($0) }) else { continue }   // the form mentions it
            pairs.append((f.label, val))
        }
        guard !pairs.isEmpty else {
            raiseFillNote("No fields I have data for matched this form. Add values in ~/.relay/identity.json.")
            return
        }
        raiseFillGuide(pairs, source: "Form fill")
    }
    // The one raiser BOTH fill paths share — the deterministic identity match above and God's
    // [FILLGUIDE] hand (executeGodAction) — one teach step per (label, value), that value pre-loaded
    // on the clipboard. Advance on the PASTE keystroke (reliable, no AX) OR the field filling.
    @MainActor private func raiseFillGuide(_ pairs: [(label: String, value: String)], source: String) {
        guard !pairs.isEmpty else { return }
        let steps: [[String: Any]] = pairs.map { p in
            ["id": p.label.lowercased().replacingOccurrences(of: " ", with: "-"),
             "text": "Click the \(p.label) field, then ⌘V",
             "copy": p.value,
             "doneWhen": ["any": [["kind": "pasted"], ["kind": "field-non-empty"]]]]
        }
        writeGuideRunFile(["mode": "teach", "title": "Fill this form", "source": source,
                           "project": model.userName.isEmpty ? "" : "you", "autoClipboard": true, "steps": steps])
    }
    // A one-step notch note (used for "copy the form first" / "no matches").
    private func raiseFillNote(_ text: String) {
        writeGuideRunFile(["mode": "teach", "title": "Form fill", "source": "Form fill",
                           "steps": [["id": "note", "text": text, "placement": "notch"]]])
    }
    private func writeGuideRunFile(_ obj: [String: Any]) {
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        try? data.write(to: URL(fileURLWithPath: (dir as NSString).appendingPathComponent("guide-run.json")), options: .atomic)
    }

    // Resume-from-menu: a guide abandoned mid-way writes ~/.relay/guide-suspended.json (raw run + startIndex).
    private func readSuspendedGuide() -> [String: Any]? {
        let p = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/guide-suspended.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: p)),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj
    }
    @objc private func resumeSuspendedGuide() {
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
        let src = (dir as NSString).appendingPathComponent("guide-suspended.json")
        let dst = (dir as NSString).appendingPathComponent("guide-run.json")
        try? FileManager.default.removeItem(atPath: dst)
        // Move suspended → run; the CursorGuide watcher picks it up and resumes at its startIndex.
        try? FileManager.default.moveItem(atPath: src, toPath: dst)
    }

    // Programmatic open hook: `touch ~/.relay/open-os` opens the OS window (for scripted
    // launches / self-test, since this accessory app can't be driven via LaunchServices).
    private func checkOpenOSTrigger() {
        let p = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/open-os")
        if FileManager.default.fileExists(atPath: p) {
            // Optional file body = the surface to land on (e.g. `echo tasks > ~/.relay/open-os`); empty = Home.
            let want = (try? String(contentsOfFile: p, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            try? FileManager.default.removeItem(atPath: p)
            if !want.isEmpty, let s = Surface(rawValue: want) { OSShellWindowController.shared.show(s) }
            else { OSShellWindowController.shared.show() }
        }
        // `touch ~/.relay/fill-form` → guided form-fill from the clipboard (scriptable + self-test hook).
        let f = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/fill-form")
        if FileManager.default.fileExists(atPath: f) {
            try? FileManager.default.removeItem(atPath: f)
            fillFormFromClipboard()
        }
        // `~/.relay/extract-video` (body = a YouTube/Instagram URL) → the ⌥⌥ launcher's "Extract video"
        // action. Run the reuse pipeline (video2ai-pipeline.mjs), stream progress into a notch widget,
        // land the result with a one-tap "drop into chat". Scriptable, so it self-tests too.
        let ev = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/extract-video")
        if FileManager.default.fileExists(atPath: ev) {
            let vurl = (try? String(contentsOfFile: ev, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            try? FileManager.default.removeItem(atPath: ev)
            if !vurl.isEmpty { runVideoExtraction(url: vurl) }
        }
        // `touch ~/.relay/replay-tour` → run the real (adaptive) welcome tour. Same as the menu item;
        // scriptable so it can be fired for a walkthrough or self-test without clicking the dot.
        let t = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/replay-tour")
        if FileManager.default.fileExists(atPath: t) {
            try? FileManager.default.removeItem(atPath: t)
            startWelcomeTour()
        }
        // `touch ~/.relay/open-panel` → front the menu-bar panel (the OS window's Needs-attention items
        // use this so "fix it in the panel" is a real one-click action, not a dead hint).
        let pp = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/open-panel")
        if FileManager.default.fileExists(atPath: pp) {
            try? FileManager.default.removeItem(atPath: pp)
            openedByHover = false; showPanel()
        }
        // `touch ~/.relay/connect-claude` → raise the "Connect Claude Code" notch card (the onboarding
        // step, also scriptable / self-test). Its "Run it" adds the connector on the user's Claude Code.
        let cc = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/connect-claude")
        if FileManager.default.fileExists(atPath: cc) {
            try? FileManager.default.removeItem(atPath: cc)
            promptConnectClaudeCodeNotch()
        }
    }
    @objc private func previewWidgetItem(_ sender: NSMenuItem) {
        guard let spec = sender.representedObject as? WidgetSpec else { return }
        showNotchWidget(spec, onOpen: { [weak self] in self?.hideNotchWidget() })
    }
    @objc private func previewWebWidgetItem(_ sender: NSMenuItem) {
        guard let l = sender.representedObject as? SBListing, let s = l.components.ui?.url, let url = URL(string: s) else { return }
        showNotchWidgetWeb(url: url, widgetId: l.id, title: l.name)
    }
    @objc private func openPanelFromMenu() { openedByHover = false; showPanel() }

    // Give God a FILE as context for the next ⌃⌃ (the file analog of the reference-image drive). god.mjs
    // inlines text/PDF/doc/xlsx content as UNTRUSTED reference data, or SEES an image. Files ACCUMULATE —
    // drop several and they all ride the next ask (GOD_FILES); each shows as a removable chip in the notch.
    @MainActor private func acceptDroppedFile(_ path: String) {
        guard FileManager.default.fileExists(atPath: path) else { return }
        if godRefs.contains(where: { $0.path == path }) { return }   // same file dropped twice → keep one
        let name = (path as NSString).lastPathComponent
        let ext = (name as NSString).pathExtension.lowercased()
        let isImg = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"].contains(ext)
        let thumb = isImg ? thumbnail(ofImageAt: path) : nil          // preview images; other files show a doc icon
        godRefs.append(GodRef(kind: .file, path: path, thumb: thumb, label: name))
        godLog("acceptDroppedFile: \(path) (refs now \(godRefs.count))")
        NSSound(named: "Tink")?.play()
        (notchDropPanel?.contentView as? FileDropView)?.attached = true   // dashed border off; hit area stays for the next drop
        if godListening || godRunning {
            updateGodStatusDrop(glowModel.state)         // re-render the pill → the new file chip shows below the phase
        } else {
            toast("Attached \(name) — God will use it")
        }
    }
    // A small thumbnail of an image file for a reference chip (nil if it can't be read).
    private func thumbnail(ofImageAt path: String) -> NSImage? {
        guard let img = NSImage(contentsOfFile: path) else { return nil }
        let long: CGFloat = 44
        let ar = img.size.width > 0 ? img.size.height / max(img.size.width, 1) : 0.6
        let w = long, h = max(20, min(long, long * ar))
        let t = NSImage(size: NSSize(width: w, height: h))
        t.lockFocus(); img.draw(in: NSRect(x: 0, y: 0, width: w, height: h)); t.unlockFocus()
        return t
    }
    @MainActor @objc private func clearAttachedFileForGod() {
        godRefs.removeAll()
        clipboardOffer = nil
        (notchDropPanel?.contentView as? FileDropView)?.attached = false
        if godListening || godRunning { updateGodStatusDrop(glowModel.state) }
        toast("Cleared attached references")
    }
    // Remove ONE staged reference (the ✕ on its chip) — the way to undo a wrong file/screenshot before ⌃-send.
    @MainActor private func removeGodRef(_ id: UUID) {
        godRefs.removeAll { $0.id == id }
        if godRefs.isEmpty { (notchDropPanel?.contentView as? FileDropView)?.attached = false }
        updateGodStatusDrop(glowModel.state)
    }
    // Drop every staged reference — called when a turn ends/cancels so a screenshot or file can't leak into
    // the next gesture (the ⌃⌥ dictation pill was showing a stale grab because refs outlived their turn).
    @MainActor private func clearGodRefs() {
        clipboardOffer = nil                          // the offer never survives a turn
        guard !godRefs.isEmpty else { return }
        godRefs.removeAll()
        (notchDropPanel?.contentView as? FileDropView)?.attached = false
    }

    // ── Clipboard as an ADDABLE context object (opt-in) ──────────────────────────────────────────────
    // When a ⌃⌃ turn opens we peek the clipboard; if it holds text, the listening pill offers it as an
    // addable chip. NOTHING is attached until the user taps Add — this is the user's own clipboard, placed
    // only on their explicit consent (never auto-dumped into a prompt).
    @MainActor private func captureClipboardOffer() {
        if let s = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
            clipboardOffer = s
        } else { clipboardOffer = nil }
    }
    // A one-line, ~24-char peek for the chip (newlines flattened, ellipsized).
    private func clipPeek(_ s: String) -> String {
        let flat = s.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
            .trimmingCharacters(in: .whitespaces)
        return flat.count <= 24 ? flat : String(flat.prefix(24)) + "\u{2026}"
    }
    // Add tapped: persist the clipboard to a temp text file (basename clipboard.txt) and stage it as a
    // removable ref. It rides god.mjs exactly like a dropped file (GOD_FILES, folded in as UNTRUSTED
    // reference) AND is named via GOD_CLIPBOARD — the same temp-file+env mechanism GOD_FILE uses.
    @MainActor private func addClipboardRef() {
        guard let s = clipboardOffer, !s.isEmpty else { return }
        let dir = NSTemporaryDirectory() + "god-clip-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let file = dir + "/clipboard.txt"
        guard (try? s.write(toFile: file, atomically: true, encoding: .utf8)) != nil else { return }
        godRefs.append(GodRef(kind: .clipboard, path: file, thumb: nil, label: "Clipboard: \(clipPeek(s))"))
        godLog("addClipboardRef: staged clipboard (\(s.count) chars)")
        clipboardOffer = nil                          // consumed → the offer chip becomes a normal ref chip
        NSSound(named: "Tink")?.play()
        (notchDropPanel?.contentView as? FileDropView)?.attached = true
        updateGodStatusDrop(glowModel.state)
    }

    // A picker over the whole installed catalog — every wrapp with a page (and thus an <id>_run tool)
    // is drivable. Grouped by category so 60+ listings stay navigable; each item carries its listing.
    @MainActor private func buildDrivePickerMenu() -> NSMenu {
        let menu = NSMenu()
        // Drivable = has a page (webview drive) OR a bundled skill body (headless drive). A pure skill
        // needs no page, so it's listed on the strength of its skill body alone.
        let listings = readCatalog().filter { $0.components.ui?.url != nil || resolveSkillContent($0) != nil }.sorted { $0.name < $1.name }
        guard !listings.isEmpty else {
            let empty = NSMenuItem(title: "No wrapps installed — open the store", action: #selector(openPanelFromMenu), keyEquivalent: "")
            empty.target = self; menu.addItem(empty); return menu
        }
        // Nice category order first, then anything else alphabetically.
        let order = ["studio", "agent", "tool", "skill", "fun"]
        let cats = Array(Set(listings.map { $0.category })).sorted {
            let ai = order.firstIndex(of: $0) ?? order.count, bi = order.firstIndex(of: $1) ?? order.count
            return ai == bi ? $0 < $1 : ai < bi
        }
        for cat in cats {
            let inCat = listings.filter { $0.category == cat }
            let catItem = NSMenuItem(title: cat.capitalized, action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for l in inCat {
                let it = NSMenuItem(title: l.name, action: #selector(driveWrappPicked(_:)), keyEquivalent: "")
                it.target = self; it.representedObject = l; it.image = storeIcon(l.id).map { img in
                    let c = img.copy() as! NSImage; c.size = NSSize(width: 18, height: 18); return c
                }
                sub.addItem(it)
            }
            catItem.submenu = sub
            menu.addItem(catItem)
        }
        return menu
    }
    @objc private func driveWrappPicked(_ sender: NSMenuItem) {
        guard let l = sender.representedObject as? SBListing else { return }
        guard let input = promptDriveInput(for: l) else { return }   // cancelled
        // A skill (prompt body) runs HEADLESS → notch widget; a wrapp (page + workflow) drives its page.
        if resolveSkillContent(l) != nil {
            driveSkillHeadless(l, input: input.isEmpty ? nil : input)
        } else if let s = l.components.ui?.url, let base = URL(string: s) {
            let tool = l.tools?.first?.name ?? "\(l.id)_run"   // the wrapp's registered command, not a guess
            driveWrappLive(pageURL: resolveDriveURL(tool: tool, fallback: base), tool: tool, input: input.isEmpty ? nil : input, wrappName: l.name)
        }
    }
    // Ask what to run the wrapp on. Pre-fills the clipboard (usually what the user is looking at). Returns
    // nil on Cancel; "" means "just run it" (context-first skills that read the lent project need no text).
    @MainActor private func promptDriveInput(for l: SBListing) -> String? {
        let a = NSAlert()
        a.messageText = "Drive \(l.name)"
        a.informativeText = l.tagline.isEmpty ? "What should \(l.name) work on?" : l.tagline
        a.addButton(withTitle: "Run"); a.addButton(withTitle: "Cancel")
        let field = NSTextView(frame: NSRect(x: 0, y: 0, width: 320, height: 90))
        field.string = (NSPasteboard.general.string(forType: .string) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        field.font = .systemFont(ofSize: 12)
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 320, height: 90))
        scroll.documentView = field; scroll.hasVerticalScroller = true; scroll.borderType = .bezelBorder
        a.accessoryView = scroll
        NSApp.activate(ignoringOtherApps: true)
        return a.runModal() == .alertFirstButtonReturn ? field.string.trimmingCharacters(in: .whitespacesAndNewlines) : nil
    }
    @objc private func captureRegionItem() { setRegion(true) }
    @objc private func captureFullItem() { setRegion(false) }
    // The HTML capability, live: clipboard text → Claude writes HTML → offscreen render → the PNG
    // lands in the notch widget with drag-out. Sub-minute, free, on the user's own Claude.
    @objc private func diagramFromClipboardItem() {
        let clip = (NSPasteboard.general.string(forType: .string) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clip.isEmpty else {
            showNotchWidget(WidgetSpec(kicker: "CANVAS · DIAGRAM", title: "Clipboard is empty", openLabel: "Close",
                result: .text("Copy some text first — the diagram is drawn from your clipboard.")),
                onOpen: { [weak self] in self?.hideNotchWidget() })
            return
        }
        showNotchWidget(WidgetSpec(kicker: "CANVAS · DIAGRAM", title: "Drawing a diagram…", openLabel: "Close",
            result: .working("Claude is writing the HTML, then it renders in-notch…")),
            onOpen: { [weak self] in self?.hideNotchWidget() })
        HtmlCapability.shared.makeDiagram(from: clip) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let path):
                self.showNotchWidget(WidgetSpec(kicker: "CANVAS · DIAGRAM", title: "From your clipboard", openLabel: "Close",
                    result: .image(caption: "Rendered from Claude's HTML — drag it out.", steer: [], file: path)),
                    onOpen: { [weak self] in self?.hideNotchWidget() })
            case .failure(let e):
                self.showNotchWidget(WidgetSpec(kicker: "CANVAS · DIAGRAM", title: "Diagram failed", openLabel: "Open panel",
                    result: .text(e.localizedDescription)),
                    onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            }
        }
    }

    // ── EXPLAIN MODE (docs/NOTCH-EXPLAIN.md) ──────────────────────────────────────────────────────
    // Teach a decision card before the pick. Generate — on the user's OWN Claude — a trade-off DIAGRAM
    // (shown as the card's media) and a short MOIRA voiceover (spoken), both grounded in the question +
    // options; the options then resurface. Fire-and-forget: the diagram and the script race, each lands
    // when ready; a failure just clears the spinner so the options never block.
    @MainActor private func explainDecision(question: String, options: [GuideOption]) {
        let opts = options.enumerated().map { (i, o) -> String in
            let letter = i < 3 ? ["A", "B", "C"][i] : "\(i + 1)"
            let rec = o.recommended ? " (recommended)" : ""
            let detail = (o.detail?.isEmpty == false) ? " — \(o.detail!)" : ""
            return "\(letter). \(o.label)\(rec)\(detail)"
        }.joined(separator: "\n")
        let brief = "Decision: \(question)\n\nOptions:\n\(opts)"

        // DIAGRAM — a clean trade-off graphic in the notch palette (makeDiagram enforces the dark/lime look).
        let diagramPrompt = "A decision the user is weighing. Draw a clear, minimal TRADE-OFF diagram that "
            + "helps them SEE the choice at a glance — compare the options on the axes that matter (effort, "
            + "risk, reward, reversibility — pick what fits), and mark the recommended one. No prose.\n\n\(brief)"
        HtmlCapability.shared.makeDiagram(from: diagramPrompt) { result in
            Task { @MainActor in
                switch result {
                case .success(let path): CursorGuide.shared.showExplanation(media: GuideMedia(src: path))
                case .failure:           CursorGuide.shared.explainFailed()
                }
            }
        }
        // SCRIPT — a short spoken walk-through in Moira's tech-explainer voice (speakGuideLine → god voice).
        let scriptPrompt = "You are Moira, narrating a ~15-second voiceover that TEACHES this decision like a "
            + "sharp tech-explainer reel — warm, plain, concrete. Walk through the real trade-off between the "
            + "options and end by naming the one you'd lean toward and why, in one line. Speak directly to the "
            + "user (\"you\"). Return ONLY the spoken words — no stage directions, no markdown, 2–4 sentences.\n\n\(brief)"
        HtmlCapability.shared.makeText(prompt: scriptPrompt) { [weak self] result in
            Task { @MainActor in
                if case .success(let script) = result {
                    let line = script.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !line.isEmpty { self?.speakGuideLine(line) }
                }
            }
        }
    }
    // ── Motion: every drop GROWS OUT OF the notch and COLLAPSES BACK into it ─────────────────────
    // The drops are clipped to NotchDropShape and pinned to screen.frame.maxY (the notch seam), so
    // scaling the content layer about its TOP-CENTRE makes the silhouette unfold downward from the
    // notch (and fold back up on dismiss) — instead of fading in at a fixed rect. One shared pair so
    // the whole surface family moves the same way. We bake the anchor into the transform (translate→
    // scale→translate) rather than touching the layer's anchorPoint, which AppKit manages for a
    // layer-backed NSHostingView.
    private func notchScale(_ s: CGFloat, _ b: NSRect) -> CATransform3D {
        let ax = b.width / 2, ay = b.height   // top-centre in AppKit's non-flipped layer space
        var t = CATransform3DMakeTranslation(ax, ay, 0)
        t = CATransform3DScale(t, s, s, 1)
        return CATransform3DTranslate(t, -ax, -ay, 0)
    }
    private func presentFromNotch(_ panel: NSPanel) {
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        guard let host = panel.contentView else { return }
        host.wantsLayer = true
        guard let layer = host.layer else { return }
        let g = CAAnimationGroup()
        let t = CABasicAnimation(keyPath: "transform")
        t.fromValue = NSValue(caTransform3D: notchScale(0.04, host.bounds))
        t.toValue = NSValue(caTransform3D: CATransform3DIdentity)
        let o = CABasicAnimation(keyPath: "opacity"); o.fromValue = 0.0; o.toValue = 1.0
        g.animations = [t, o]; g.duration = 0.24
        g.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 0.9, 0.24, 1)  // ease-out, slight settle
        layer.add(g, forKey: "notchIn")
    }
    private func dismissToNotch(_ panel: NSPanel, then done: (() -> Void)? = nil) {
        guard let host = panel.contentView, let layer = host.layer else { panel.orderOut(nil); done?(); return }
        let g = CAAnimationGroup()
        let t = CABasicAnimation(keyPath: "transform")
        t.fromValue = NSValue(caTransform3D: CATransform3DIdentity)
        t.toValue = NSValue(caTransform3D: notchScale(0.04, host.bounds))
        let o = CABasicAnimation(keyPath: "opacity"); o.fromValue = 1.0; o.toValue = 0.0
        g.animations = [t, o]; g.duration = 0.15
        g.timingFunction = CAMediaTimingFunction(name: .easeIn)
        g.isRemovedOnCompletion = false; g.fillMode = .forwards
        CATransaction.begin()
        CATransaction.setCompletionBlock { panel.orderOut(nil); layer.removeAnimation(forKey: "notchOut"); done?() }
        layer.add(g, forKey: "notchOut")
        CATransaction.commit()
    }

    // The notch WIDGET — a wrapp's glanceable result dropped under the notch (grows from it, reusing
    // presentFromNotch). Lazily built like the store. Close/open/regenerate/steer are wired via the view.
    @MainActor func showNotchWidget(_ spec: WidgetSpec, onOpen: @escaping () -> Void = {},
                                    onRegen: @escaping () -> Void = {}, onSteer: @escaping (String) -> Void = { _ in },
                                    onOpenLink: @escaping (String) -> Void = { s in if let u = URL(string: s) { NSWorkspace.shared.open(u) } }) {
        guard let screen = statusItem?.button?.window?.screen ?? NSScreen.main else { return }
        // Context-first: every widget carries the PROJECT chip — the same global default the panel's
        // picker writes, switchable right where the command runs ("make me an ad" needs the right brand).
        model.refreshFiles()
        let view = NotchWidget(spec: spec,
                               projects: model.contexts.map { (id: $0.id, name: $0.name) },
                               activeProjectId: readDefaultId(),
                               // Switching the project must actually TAKE — write the new global context, then
                               // RE-RUN the drive so the wrapp reloads grounded in it (a context-first command
                               // like "make me an ad" is only right for the right brand). onRegen is the drive's
                               // own re-run; for a non-drive widget it's a no-op, so this is safe everywhere.
                               onSelectProject: { [weak self] id in writeGlobalContext(id); self?.model.refreshFiles(); onRegen() },
                               onClose: { [weak self] in self?.hideNotchWidget() },
                               onOpen: onOpen, onRegen: onRegen, onSteer: onSteer, onOpenLink: onOpenLink)
        let host = NoInsetHostingView(rootView: view)
        if notchWidgetPanel == nil {
            notchWidgetPanel = NotchPanel(contentRect: NSRect(x: 0, y: 0, width: 600, height: 200),
                                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            notchWidgetPanel.isOpaque = false; notchWidgetPanel.backgroundColor = .clear; notchWidgetPanel.hasShadow = false
            notchWidgetPanel.level = .popUpMenu
            notchWidgetPanel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        }
        notchWidgetPanel.contentView = host
        let size = host.fittingSize
        notchWidgetPanel.setContentSize(size)
        notchWidgetPanel.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        presentFromNotch(notchWidgetPanel)
        if let m = notchWidgetMonitor { NSEvent.removeMonitor(m) }
        // click OUTSIDE dismisses; clicks inside are ignored so dragging the result out doesn't close it.
        notchWidgetMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self, let p = self.notchWidgetPanel, p.isVisible else { return }
            if !p.frame.contains(NSEvent.mouseLocation) { Task { @MainActor in self.hideNotchWidget() } }
        }
    }
    @MainActor func hideNotchWidget() {
        if let m = notchWidgetMonitor { NSEvent.removeMonitor(m); notchWidgetMonitor = nil }
        if let p = notchWidgetPanel { dismissToNotch(p) }
    }

    // Onboarding "Connect Claude Code", in the NOTCH: an actionable card the user can Run right there,
    // so a Claude Code session can read their board (pick up tasks) + run wrapps. "Run it" (the openLabel)
    // fires runClaudeMcpAdd; the copy button (built into a .text widget) is the manual fallback.
    @MainActor func promptConnectClaudeCodeNotch() {
        if claudeCodeConnectorInstalled() {
            showNotchWidget(WidgetSpec(kicker: "CLAUDE CODE", title: "Already connected", openLabel: "Done",
                result: .text("A Claude Code session can read your board and pick up tasks. Try: “what's on my Switchboard board?” or “pick up the next task.”")),
                onOpen: { [weak self] in self?.hideNotchWidget() })
            return
        }
        let body = "Let Guru and your OS board reach a Claude Code session — it can read this project's board, pick up tasks you move to Todo, and run your wrapps.\n\n\(claudeMcpAddCommand())"
        showNotchWidget(WidgetSpec(kicker: "ONE MORE THING", title: "Connect Claude Code", openLabel: "Run it",
            result: .text(body)),
            onOpen: { [weak self] in self?.runConnectFromNotch() })
    }
    @MainActor private func runConnectFromNotch() {
        showNotchWidget(WidgetSpec(kicker: "CLAUDE CODE", title: "Connecting…", openLabel: "",
            result: .working("Adding the Switchboard connector to Claude Code")))
        runClaudeMcpAdd { [weak self] ok, msg in
            guard let self else { return }
            let body = ok
                ? "Connected ✓  A Claude Code session can now read your board. Try: “pick up the next task.”"
                : "Couldn't add it automatically — \(msg.isEmpty ? "is Claude Code installed?" : msg)\n\nRun this yourself in a project folder:\n\(claudeMcpAddCommand())"
            self.showNotchWidget(WidgetSpec(kicker: "CLAUDE CODE", title: ok ? "Connected" : "Copy & run", openLabel: "Done",
                result: .text(body)),
                onOpen: { [weak self] in self?.hideNotchWidget() })
        }
    }

    // ── NATIVE NOTCH WEB WIDGET — a wrapp's WIDGET-surface URL rendered LIVE in the notch ──────────────
    // Loads the page in a WKWebView with window.claude bridged to the daemon (NotchWidgetWebHost), clipped
    // to the notch silhouette. The new `ideabrain` / `resize` web widgets render here for real. Behind a
    // right-click "Preview widget" entry for now (testable without wiring every store listing).
    @MainActor func showNotchWidgetWeb(url: URL, widgetId: String, title: String, input: [String: Any]? = nil) {
        guard let screen = statusItem?.button?.window?.screen ?? NSScreen.main else { return }
        guard let token = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            // No pairing token → the bridge can't auth; fall back to the honest sample widget with the reason.
            showNotchWidget(WidgetSpec(kicker: "WIDGET", title: title, openLabel: "Open",
                result: .text("~/.relay/pairing-token is missing — is the daemon set up?")),
                onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            return
        }
        notchWebHost?.close()
        let host = NotchWidgetWebHost(url: url, widgetId: widgetId, token: token, port: PORT, input: input)
        notchWebHost = host
        let heightModel = NotchWebHeight()
        let drop = NotchWebDrop(web: host.webView, title: title, height: heightModel, onClose: { [weak self] in self?.hideNotchWidgetWeb() })
        let hosting = NoInsetHostingView(rootView: drop)
        if notchWebPanel == nil {
            // Key-capable (LauncherPanel) so the widget's text fields can hold first-responder — a plain
            // non-key NotchPanel is exactly why the QR field lost focus on every keystroke.
            notchWebPanel = LauncherPanel(contentRect: NSRect(x: 0, y: 0, width: 600, height: 380),
                                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            notchWebPanel.isOpaque = false; notchWebPanel.backgroundColor = .clear; notchWebPanel.hasShadow = false
            notchWebPanel.level = .popUpMenu
            notchWebPanel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        }
        notchWebPanel.contentView = hosting
        let size = hosting.fittingSize
        notchWebPanel.setContentSize(size)
        notchWebPanel.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        notchWebPanel.makeKeyAndOrderFront(nil)
        notchWebPanel.makeFirstResponder(host.webView)   // keyboard focus → the widget's webview, so its fields type
        presentFromNotch(notchWebPanel)
        host.load()
        // Size the notch to the widget's real content height (kills the dead space) and re-fit as it grows.
        host.onHeight = { [weak self, weak hosting] h in
            guard let self, let hosting, let p = self.notchWebPanel, p.isVisible else { return }
            let clamped = max(90, min(h, notchWebMaxH))
            guard abs(heightModel.content - clamped) > 2 else { return }
            heightModel.content = clamped
            DispatchQueue.main.async {
                let sz = hosting.fittingSize
                p.setContentSize(sz)
                if let screen = p.screen ?? NSScreen.main {
                    p.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - sz.width / 2, y: screen.frame.maxY + notchTopBleed))
                }
            }
        }
        // Drop-safe dismiss: close on a genuine outside click-UP (not mouse-DOWN, so a file drag onto the widget
        // survives) OR Esc. (A drag's terminal event is a drag session, not a plain mouseUp — so drops don't close it.)
        if let m = notchWebMonitor { NSEvent.removeMonitor(m) }
        if let k = notchWebKeyMonitor { NSEvent.removeMonitor(k) }
        notchWebMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp, .rightMouseUp]) { [weak self] _ in
            guard let self, let p = self.notchWebPanel, p.isVisible else { return }
            if !p.frame.contains(NSEvent.mouseLocation) { Task { @MainActor in self.hideNotchWidgetWeb() } }
        }
        notchWebKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] ev in
            if ev.keyCode == 53 { Task { @MainActor in self?.hideNotchWidgetWeb() }; return nil }   // Esc
            return ev
        }
    }
    @MainActor func hideNotchWidgetWeb() {
        if let m = notchWebMonitor { NSEvent.removeMonitor(m); notchWebMonitor = nil }
        if let k = notchWebKeyMonitor { NSEvent.removeMonitor(k); notchWebKeyMonitor = nil }
        notchWebHost?.close(); notchWebHost = nil
        if let p = notchWebPanel { dismissToNotch(p) }
    }

    // ── LIVE drive: God opens a wrapp in the bridged webview and drives its real pipeline ────────
    // End-to-end, no mocks: GodWebWindow loads the wrapp with window.claude bridged to the daemon,
    // waits for the kit/webmcp __god bridge, calls the tool (the wrapp's REAL UI paints live), and
    // the result lands in the notch widget. Dev default: roast on the granted localhost:5188 origin
    // (serve with: cd examples/apps && node serve.mjs). GOD_DRIVE_URL overrides the page.
    // ONE drive session, TWO surfaces (never both):
    //   notch — the widget shows working/result; the wrapp window exists but stays offscreen.
    //   window — the wrapp IS the surface; the notch collapses to the small running pill. When the
    //   run finishes, the result routes by where the user is: window frontmost → the wrapp already
    //   shows it (pill flashes done); user elsewhere/window closed → the result DROPS from the notch
    //   like a notification. "Show the wrapp" flips notch→window; closing the window flips back.
    private var godWeb: GodWebWindow?
    // App windows opened from the launcher/store ("window" surface): user-opened wrapps hosted in the
    // same bridged webview as drive — kept separate so closing an app never disturbs a drive session.
    private var appWindows: [GodWebWindow] = []
    @MainActor func openWrappWindow(url: URL, name: String) {
        guard let token = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            showNotchWidget(WidgetSpec(kicker: name.uppercased(), title: "No pairing token", openLabel: "Open panel",
                result: .text("~/.relay/pairing-token is missing — is the daemon set up?")), onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            return
        }
        // A real content window ⇒ stop being a menu-bar-only ACCESSORY (whose windows float as overlays:
        // no Cmd-Tab, no Mission Control, always-on-top) and behave like a NORMAL app while it's open.
        // Switch BEFORE creating the window so it's born a normal-level window, not an accessory one.
        // Revert to .accessory (menu-bar-only, no Dock icon) once the last window closes.
        if appWindows.isEmpty { NSApp.setActivationPolicy(.regular) }
        let web = GodWebWindow(url: url, token: token, title: name)
        appWindows.append(web)
        web.onUserClosed = { [weak self, weak web] in
            self?.appWindows.removeAll { $0 === web }
            if self?.appWindows.isEmpty == true { NSApp.setActivationPolicy(.accessory) }
        }
        web.open()
        NSLog("[open-wrapp] native window opened: %@ → %@", name, url.absoluteString)
    }

    // ── UPDATE CHECK ────────────────────────────────────────────────────────────────────────────────
    // Founder call 2026-08-26: there was NO way to tell users a new build shipped — someone on 0.3.4 would
    // never learn 0.3.5 existed. This is the light version: ask GitHub's PUBLIC releases API for the latest
    // tag, compare it to our own CFBundleShortVersionString, and raise ONE notch card when we're behind.
    //
    // Privacy: the product line is "nothing leaves your Mac", so this is deliberately the smallest possible
    // exception and is stated plainly — an unauthenticated GET to a public endpoint, no identifiers, no
    // telemetry, nothing about the user or their machine attached. It can be turned off with
    // `defaults write ai.thelastprompt.switchboard relay.update.optOut -bool YES`.
    //
    // It never nags: once a version has been surfaced it's remembered, so the same release is announced once.
    private var updateTimer: Timer?
    private static let updateSeenKey = "relay.update.lastSeenVersion"
    private static let updateOptOutKey = "relay.update.optOut"

    private func installUpdateCheck() {
        guard !UserDefaults.standard.bool(forKey: RelayController.updateOptOutKey) else {
            NSLog("[update] opted out — skipping check"); return
        }
        // Not at launch: let the app settle first, then once a day.
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in self?.checkForUpdate() }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 60 * 60 * 24, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkForUpdate() }
        }
    }

    /// "0.3.10" > "0.3.9" — compare dotted integers, not strings.
    private static func isNewer(_ remote: String, than local: String) -> Bool {
        let r = remote.split(separator: ".").map { Int($0.filter(\.isNumber)) ?? 0 }
        let l = local.split(separator: ".").map { Int($0.filter(\.isNumber)) ?? 0 }
        for i in 0..<max(r.count, l.count) {
            let a = i < r.count ? r[i] : 0, b = i < l.count ? l[i] : 0
            if a != b { return a > b }
        }
        return false
    }

    @MainActor private func checkForUpdate() {
        let here = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
        guard let api = URL(string: "https://api.github.com/repos/sameeeeeeep/switchboard/releases/latest") else { return }
        var req = URLRequest(url: api, timeoutInterval: 12)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { data, _, err in
            guard err == nil, let data,
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let tag = obj["tag_name"] as? String else { return }
            let latest = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
            guard RelayController.isNewer(latest, than: here) else { return }
            let title = (obj["name"] as? String) ?? "Switchboard \(latest)"
            Task { @MainActor in
                // Announce a given version ONCE — never nag.
                let seen = UserDefaults.standard.string(forKey: RelayController.updateSeenKey) ?? ""
                guard seen != latest else { return }
                UserDefaults.standard.set(latest, forKey: RelayController.updateSeenKey)
                NSLog("[update] %@ is out (running %@)", latest, here)
                self.showNotchWidget(
                    WidgetSpec(kicker: "UPDATE", title: "Switchboard \(latest) is out",
                               openLabel: "Download", result: .text(title)),
                    onOpen: { [weak self] in
                        self?.hideNotchWidget()
                        if let dmg = URL(string: "https://github.com/sameeeeeeep/switchboard/releases/latest/download/Switchboard.dmg") {
                            NSWorkspace.shared.open(dmg)
                        }
                    })
            }
        }.resume()
    }

    // Control-plane trigger: write {"id":"redline"} (or {"url":"…","name":"…"}) to ~/.relay/open-wrapp.json
    // and the app opens that wrapp in the native bridged window — the same file-handshake pattern as
    // guide-run.json, so any Claude thread can hand a surface to the human. Poll is fine at 2s.
    private var openWrappTimer: Timer?
    private func installOpenWrappTrigger() {
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/open-wrapp.json")
        openWrappTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            guard let self, FileManager.default.fileExists(atPath: path) else { return }
            defer { try? FileManager.default.removeItem(atPath: path) }
            guard let data = FileManager.default.contents(atPath: path),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
            DispatchQueue.main.async {
                if let id = obj["id"] as? String, let l = readCatalog().first(where: { $0.id == id }) {
                    NSLog("[open-wrapp] trigger: launching %@ via window surface", id)
                    self.launchWrapp(l, "window")
                } else if let s = obj["url"] as? String, let u = URL(string: s) {
                    NSLog("[open-wrapp] trigger: opening url %@", s)
                    self.openWrappWindow(url: u, name: (obj["name"] as? String) ?? "Wrapp")
                }
            }
        }
    }
    private var driveRunning = false
    private var driveName = "Roast"          // display name of the wrapp being driven
    private var lastDrive: (url: URL, tool: String, input: String?, name: String)?   // for Regenerate
    private var driveGeneration = 0          // bumps per drive; a superseded run's late result is dropped
    // DEV drive override: when ~/.relay/dev-drive exists, drive a wrapp's LOCAL page
    // (localhost:5188/<toolprefix>.html) instead of its deployed subdomain — so the drive origin is the
    // granted localhost:5188 (models + Higgsfield/WebFetch), which the remote origin isn't. Prefix = the
    // tool's source id (imagegen_generate → imagegen → imagegen.html). No flag file → the catalog URL.
    // The first staged screenshot grab as a data: URL — used as an image-to-image reference when the user
    // grabbed a region to say "make an image like THIS". nil when no screenshot is staged.
    private func lastCaptureAsDataURL() -> String? {
        guard let shot = godRefs.first(where: { $0.kind == .screenshot })?.path,
              let data = FileManager.default.contents(atPath: shot), !data.isEmpty else { return nil }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }

    private func resolveDriveURL(tool: String, fallback: URL) -> URL {
        let flag = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/dev-drive")
        guard FileManager.default.fileExists(atPath: flag) else { return fallback }
        let prefix = tool.split(separator: "_").first.map(String.init) ?? tool
        return URL(string: "http://localhost:5188/\(prefix).html") ?? fallback
    }

    @MainActor func driveWrappLive(pageURL: URL? = nil, tool: String = "roast_run", input: String? = nil, wrappName: String = "Roast", reference: String? = nil) {
        let envURL = ProcessInfo.processInfo.environment["GOD_DRIVE_URL"].flatMap(URL.init(string:))
        guard let url = pageURL ?? envURL ?? URL(string: "http://localhost:5188/roast.html") else { return }
        guard let token = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            showNotchWidget(WidgetSpec(kicker: "GOD · DRIVE", title: "No pairing token", openLabel: "Open panel",
                result: .text("~/.relay/pairing-token is missing — is the daemon set up?")), onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            return
        }
        // One drive at a time — a new ask SUPERSEDES the old run (its window closes; its late result
        // is dropped by the generation check below), never two widgets fighting over the notch.
        if driveRunning, let old = godWeb { old.onUserClosed = nil; old.close() }
        driveGeneration += 1
        lastDrive = (url, tool, input, wrappName)
        driveName = wrappName
        let web = GodWebWindow(url: url, token: token)
        godWeb = web
        driveRunning = true
        web.onUserClosed = { [weak self] in   // window closed mid-run → fall back to the notch surface
            guard let self, self.driveRunning else { return }
            self.hideGodStatus()
            self.showDriveWorking("Running \(tool) on your Claude…")
        }
        showDriveWorking("Opening the wrapp, waiting for its tools…")
        web.open(visible: false, ready: { [weak self] in    // notch is the surface; window loads offscreen
            guard let self else { return }
            if !(self.godWeb?.isShown ?? false) { self.showDriveWorking("Running \(tool) on your Claude (may take ~30–90s)…") }
            // Every skill/wrapp tool takes ONE primary string — send it under the common keys; each
            // tool reads the one it declared (extra keys are ignored by the execute destructuring).
            // With no explicit input: roast has a canned demo bio; any OTHER wrapp falls back to the
            // clipboard (the thing the user is most likely looking at), then a gentle nudge — never the
            // roast bio, which only makes sense for roast.
            let roastDemo = "Serial founder. 3x exited (all acqui-hires). Building the Uber for artisanal ice. Ex-Google (intern). We're not a company, we're a movement."
            let clip = (NSPasteboard.general.string(forType: .string) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let text = input ?? (tool == "roast_run" ? roastDemo
                : (!clip.isEmpty ? clip : "Help me with this — I'll tell you what I need."))
            // Every skill/wrapp tool takes ONE primary string under a key it chose — spray the common
            // keys (target/text/input/prompt/url/idea/…); the tool reads its one, ignores the rest.
            var args: [String: Any] = ["target": text, "text": text, "input": text, "prompt": text, "question": text, "idea": text, "message": text, "url": text, "content": text]
            if let reference = reference { args["reference"] = reference }   // image-to-image: a wrapp that declares `reference` uses it (Prism); others ignore it

            let gen = self.driveGeneration
            // DON'T assume the tool is "<id>_run" — names vary (imagegen_generate, adpulse_diagnose,
            // bank_ask, identity_compose…) and the prefix is the wrapp's SOURCE id, not its catalog id
            // (Prism's tool is imagegen_generate). Enumerate what the page actually exposes and prefer
            // the requested name, else its first (primary) tool. This is what makes drive work for ALL.
            web.listTools { tools in
                let names = tools.compactMap { $0["name"] as? String }
                guard !names.isEmpty else {
                    // The page exposes NO God tool (a remote studio not instrumented for God, etc.) —
                    // never a dead end: front the real wrapp UI so the user can drive it by hand.
                    godLog("drive: \(wrappName) exposes no God tools — showing the wrapp window instead")
                    self.driveRunning = false
                    self.hideNotchWidget()
                    self.godWeb?.front()
                    self.showGodStatus("\(wrappName) — drive it here", accent: .lime, pattern: .speaking)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.hideGodStatus() }
                    return
                }
                let chosen = names.contains(tool) ? tool : (names.first ?? tool)
                if chosen != tool { godLog("drive: '\(tool)' not exposed; using discovered tool '\(chosen)'") }
                web.drive(tool: chosen, input: args) { result in
                    Task { @MainActor in
                        guard gen == self.driveGeneration else { return }   // superseded — drop the late result
                        self.driveFinished(result)
                    }
                }
            }
        })
    }
    /// State 1 — the notch widget as the drive surface. Primary action flips to the window.
    @MainActor private func showDriveWorking(_ line: String) {
        showNotchWidget(WidgetSpec(kicker: "\(driveName.uppercased()) · LIVE", title: "God is driving \(driveName)…", openLabel: "Show the wrapp",
            result: .working(line)), onOpen: { [weak self] in self?.driveToWindow() },
            // Switching the project mid-drive re-runs from the new context (supersedes the in-flight run).
            onRegen: { [weak self] in
                guard let self, let ld = self.lastDrive else { return }
                self.godWeb?.close(); self.driveWrappLive(pageURL: ld.url, tool: ld.tool, input: ld.input, wrappName: ld.name)
            })
    }
    /// notch → window: the wrapp becomes the surface; the notch shrinks to the running pill.
    @MainActor private func driveToWindow() {
        hideNotchWidget()
        godWeb?.front()
        if driveRunning { showGodStatus("\(driveName) · running", accent: .lime, pattern: .working) }
    }

    // ══ VIDEO2AI EXTRACTION ═══════════════════════════════════════════════════════════════════════
    // The ⌥⌥ launcher's "Extract video" (a copied YouTube/Instagram link) writes ~/.relay/extract-video.
    // This runs the REUSE pipeline (examples/god/video2ai-pipeline.mjs → yt-dlp download → capabilities.
    // video2ai → structured JSON), streams its progress into a notch widget, and lands the result with a
    // one-tap "drop into chat" — the whole extraction copied to the clipboard for the next chat. Nothing
    // runs idle: the download + analyze happen on demand only ([[relay-device-lightness]]).
    @MainActor private func runVideoExtraction(url: String) {
        if videoExtracting { return }   // one at a time — a second copy just waits
        guard let node = nodePath(), let script = videoPipelinePath() else {
            showNotchWidget(WidgetSpec(kicker: "VIDEO2AI · EXTRACT", title: "Can't run the extractor",
                openLabel: "Open panel", result: .text("No Node runtime or the video2ai pipeline script was found.")),
                onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            return
        }
        videoExtracting = true
        let short = url.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "").replacingOccurrences(of: "www.", with: "")
        showNotchWidget(WidgetSpec(kicker: "VIDEO2AI · EXTRACT", title: "Extracting video…",
            openLabel: "", result: .working("Reading \(short.prefix(44))…")))

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: node)
        proc.arguments = [script, url]
        proc.currentDirectoryURL = URL(fileURLWithPath: (script as NSString).deletingLastPathComponent)
        let outPipe = Pipe(), errPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = errPipe
        videoProc = proc

        // The child streams `[phase] pct% note` on STDERR while it works, and prints the final structured
        // JSON on STDOUT at the end. Drain BOTH continuously (a long transcript can exceed the 64 KB pipe
        // buffer — reading stdout only at exit would deadlock the child). `out` is guarded by `lock`.
        let lock = NSLock()
        var out = Data()
        outPipe.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData; if d.isEmpty { return }
            lock.lock(); out.append(d); lock.unlock()
        }
        errPipe.fileHandleForReading.readabilityHandler = { [weak self] h in
            let s = String(data: h.availableData, encoding: .utf8) ?? ""
            for line in s.split(separator: "\n") {
                let (phase, note) = RelayController.parseProgress(String(line))
                guard let phase = phase else { continue }
                Task { @MainActor in
                    guard let self, self.videoExtracting else { return }
                    self.showNotchWidget(WidgetSpec(kicker: "VIDEO2AI · EXTRACT", title: self.videoPhaseTitle(phase),
                        openLabel: "", result: .working(note.isEmpty ? "working…" : note)))
                }
            }
        }
        proc.terminationHandler = { [weak self] p in
            outPipe.fileHandleForReading.readabilityHandler = nil
            errPipe.fileHandleForReading.readabilityHandler = nil
            let tail = outPipe.fileHandleForReading.readDataToEndOfFile()
            lock.lock(); if !tail.isEmpty { out.append(tail) }; let final = out; lock.unlock()
            let json = String(data: final, encoding: .utf8) ?? ""
            Task { @MainActor in self?.videoExtractionFinished(url: url, exit: p.terminationStatus, json: json) }
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do { try proc.run() } catch {
                Task { @MainActor in self?.videoExtractionFinished(url: url, exit: -1, json: "") }
            }
        }
    }

    @MainActor private func videoExtractionFinished(url: String, exit code: Int32, json: String) {
        videoExtracting = false
        videoProc = nil
        guard let data = json.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            showNotchWidget(WidgetSpec(kicker: "VIDEO2AI · EXTRACT", title: "Extraction failed",
                openLabel: "Open panel", result: .text(code == 0 ? "No result came back from the extractor." : "The extractor exited with an error (code \(code)).")),
                onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            return
        }
        if (obj["ok"] as? Bool) != true {
            let err = (obj["error"] as? String) ?? "unknown error"
            showNotchWidget(WidgetSpec(kicker: "VIDEO2AI · EXTRACT", title: "Couldn't extract that video",
                openLabel: "Close", result: .text(err)),
                onOpen: { [weak self] in self?.hideNotchWidget() })
            return
        }
        let dropText = RelayController.formatExtraction(url: url, obj: obj)
        let summary = (obj["summary"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? "Frames + transcript captured. Drop it into a chat to hand Claude the full reference."
        let beats = (obj["keyBeats"] as? [[String: Any]])?.count ?? 0
        let title = beats > 0 ? "Video understood · \(beats) beat\(beats == 1 ? "" : "s")" : "Video understood"
        showNotchWidget(WidgetSpec(kicker: "VIDEO2AI · EXTRACT", title: title,
            openLabel: "Drop into chat", result: .text(summary)),
            onOpen: { [weak self] in
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(dropText, forType: .string)
                self?.hideNotchWidget()
                self?.showGodStatus("Copied — paste it into any chat", accent: .lime, pattern: .speaking)
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { [weak self] in self?.hideGodStatus() }
            })
    }

    // stderr line `[phase] 40% note` → (phase, note). nonisolated + static: a pure function the background
    // readability handler can call without hopping to the main actor.
    private nonisolated static func parseProgress(_ line: String) -> (String?, String) {
        guard let lb = line.firstIndex(of: "["), let rb = line.firstIndex(of: "]"), lb < rb else { return (nil, "") }
        let phase = String(line[line.index(after: lb)..<rb]).trimmingCharacters(in: .whitespaces)
        let rest = String(line[line.index(after: rb)...]).trimmingCharacters(in: .whitespaces)
        return (phase.isEmpty ? nil : phase, rest)
    }
    private func videoPhaseTitle(_ phase: String) -> String {
        switch phase {
        case "detect": return "Checking the link…"
        case "download": return "Downloading the video…"
        case "analyze": return "Understanding the video…"
        case "done": return "Almost there…"
        default: return "Extracting video…"
        }
    }
    // Build the clipboard drop — a self-contained block the next chat reads as a video reference.
    private static func formatExtraction(url: String, obj: [String: Any]) -> String {
        var out = "Video reference — \(url)\n"
        if let s = obj["summary"] as? String, !s.isEmpty { out += "\nSummary:\n\(s)\n" }
        if let beats = obj["keyBeats"] as? [[String: Any]], !beats.isEmpty {
            out += "\nKey beats:\n"
            for b in beats {
                let t = (b["title"] as? String) ?? "beat"
                let start = b["start"].map { "\($0)" } ?? ""
                out += "- \(t)\(start.isEmpty ? "" : " (at \(start))")\n"
                if let pts = b["points"] as? [String] { for p in pts { out += "  · \(p)\n" } }
            }
        }
        if let ost = obj["onScreenText"] as? [String], !ost.isEmpty {
            out += "\nOn-screen text:\n" + ost.prefix(20).map { "- \($0)" }.joined(separator: "\n") + "\n"
        }
        if let tr = obj["transcript"] as? String, !tr.isEmpty { out += "\nTranscript:\n\(tr)\n" }
        return out
    }

    // ══ ⌥⌥ LAUNCHER — app-first (sibling to ⌃⌃ voice): double-tap Option → app grid + project + file intake.
    //    Click an app → run its WIDGET surface (window.__godWidget.get(input)) with a dropped file as input. ══
    private var launcherPanel: LauncherPanel?
    private var launcherMonitor: Any?
    private var launcherKeyMonitor: Any?
    private var optWasDown = false
    private var lastOptTap: Date?

    @MainActor private func onOptTap() {
        let now = Date()
        // ⌥⌥ drops the notch HOME (compact command centre); the full window opens only when you ACT on
        // something in it (a project row, "open home ↗") — founder's notch-first call.
        if let last = lastOptTap, now.timeIntervalSince(last) < 0.5 { lastOptTap = nil; toggleLauncher() }
        else { lastOptTap = now }
    }
    @MainActor private func toggleLauncher() {
        if launcherPanel?.isVisible == true { hideLauncher() } else { showLauncher() }
    }
    @MainActor func showLauncher() {
        guard model.running else { showPanel(); return }
        guard let screen = statusItem?.button?.window?.screen ?? NSScreen.main else { return }
        CursorGuide.shared.noteEvent("launcher")   // a guide's ⌥⌥ step advances the moment you open the launcher
        model.refreshFiles()
        // Include skills too — they get their own "Skill" tab (NotchLauncherView derives tabs from
        // categories) and each opens the shared skill-widget.html glance (paste → run → result).
        let listings = readCatalog()
        let view = NotchLauncherView(
            listings: listings,
            projects: readContexts(),
            recent: osRecentWork(),
            tasks: osLaunchTasks(),
            vaultFolders: osVaultFolders(),
            homeProjects: osProjects(),
            activeProjectId: readDefaultId(),
            onPickProject: { [weak self] id in writeGlobalContext(id); self?.model.refreshFiles() },
            onLaunch: { [weak self] listing, fileURL in self?.hideLauncher(); self?.showWrappWidget(listing, input: fileURL) },
            onRunTool: { [weak self] listing, query in
                self?.hideLauncher()
                // Two kinds of third-party listing land in the spotlight's Tools group, and they run
                // differently: an MCP binding is driven HEADLESS through the gate, while a borrowed WEB
                // tool (provenance third-party + components.ui — e.g. the delphitools shelf) just opens
                // its page. Without this fallback the ui-only ones were a DEAD CLICK: selectable in the
                // spotlight, then nothing but a closing launcher.
                if let binding = listing.mcp { self?.driveThirdPartyTool(listing, binding, command: nil, input: query.isEmpty ? nil : query) }
                else { self?.showWrappWidget(listing, input: nil) }
            },
            onOpenSurface: { [weak self] raw in self?.hideLauncher(); OSShellWindowController.shared.show(Surface(rawValue: raw) ?? .home) },
            onAsk: { [weak self] q in self?.hideLauncher(); if q.isEmpty { self?.triggerGod() } else { self?.triggerGod(instruction: q) } },
            onClose: { [weak self] in self?.hideLauncher() })
        let host = NoInsetHostingView(rootView: view)
        if launcherPanel == nil {
            let p = LauncherPanel(contentRect: NSRect(x: 0, y: 0, width: 600, height: 420),
                                  styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
            p.level = .popUpMenu
            p.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
            launcherPanel = p
        }
        launcherPanel!.contentView = host
        let size = host.fittingSize
        launcherPanel!.setContentSize(size)
        launcherPanel!.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        launcherPanel!.makeKeyAndOrderFront(nil)
        presentFromNotch(launcherPanel!)
        // Close on a genuine outside click-UP (a file drag's mouse-DOWN is outside but its drop is a drag
        // session, not a plain mouseUp — so drops survive) OR Esc. This is the drop-safe dismiss.
        if let m = launcherMonitor { NSEvent.removeMonitor(m) }
        if let k = launcherKeyMonitor { NSEvent.removeMonitor(k) }
        launcherMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp, .rightMouseUp]) { [weak self] _ in
            guard let self, let p = self.launcherPanel, p.isVisible else { return }
            if !p.frame.contains(NSEvent.mouseLocation) { Task { @MainActor in self.hideLauncher() } }
        }
        launcherKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged]) { [weak self] ev in
            guard let self else { return ev }
            return MainActor.assumeIsolated {   // event monitors fire on the main thread
                // Same key-window blind spot as the feedback field: while the launcher panel is KEY the
                // global flagsMonitor never sees ⌃⌥, so dictation can't start. Forward flagsChanged to the
                // talk-chord-ONLY handler (NOT full onFlags — its ⌃⌃-summon detector would misread the ⌃ in
                // ⌃⌥ and spawn God). finishDictation then pastes the transcript into the focused Ask field.
                if ev.type == .flagsChanged { self.startDictationOnTalkChord(ev.modifierFlags); return ev }
                // While a take is latched, its watch timer owns esc (cancel the dictation) — don't let esc
                // ALSO close the launcher out from under it.
                if self.dictating { return ev.keyCode == 53 ? nil : ev }
                if ev.keyCode == 53 { self.hideLauncher(); return nil }   // Esc
                return ev
            }
        }
    }
    @MainActor func hideLauncher() {
        if let m = launcherMonitor { NSEvent.removeMonitor(m); launcherMonitor = nil }
        if let k = launcherKeyMonitor { NSEvent.removeMonitor(k); launcherKeyMonitor = nil }
        if let p = launcherPanel { dismissToNotch(p) }
    }

    // ── Guide FEEDBACK note surface — the notch becomes an anchored input during a guide (docs/FEEDBACK-CAPTURE.md).
    // Raised from CursorGuide.onFeedbackBegin: shows a focused note field + arms the fn-drag screenshot grab.
    // ⌃⌥ dictation stays live during a guide, and finishDictation routes its transcript here (not the app).
    @MainActor private func showFeedbackNote() {
        feedbackNote = ""; feedbackShotThumbs = []
        guard let screen = statusItem?.button?.window?.screen ?? NSScreen.main else { return }
        rebuildFeedbackPanel(screen)
        // The panel is key → it owns ↵ / esc → CursorGuide commits/cancels. CursorGuide.onKey no-ops while
        // capturingFeedback, so there's no double-fire.
        if let m = feedbackKeyMonitor { NSEvent.removeMonitor(m) }
        feedbackKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged]) { [weak self] ev in
            guard let self else { return ev }
            return MainActor.assumeIsolated {   // event monitors fire on the main thread
                // The feedback panel is KEY, so the global flagsMonitor that normally drives ⌃⌥ dictation is
                // DEAD here — its flagsChanged events are delivered to our own key window instead of "another
                // app," so the global monitor never sees them. Forward them to the talk-chord-ONLY handler
                // (NOT full onFlags, whose ⌃⌃/⌥⌥ double-tap logic would misfire here) so the talk chord still
                // STARTS a dictation; finishDictation already routes the transcript into this note.
                if ev.type == .flagsChanged { self.startDictationOnTalkChord(ev.modifierFlags); return ev }
                // While a dictation is latched, its watch timer owns ⌃ (commit) and esc (cancel the take) via
                // key-state polling — don't let esc/↵ ALSO discard or save the whole note out from under it.
                if self.dictating { return (ev.keyCode == 53 || ev.keyCode == 36) ? nil : ev }
                if ev.keyCode == 53 { self.commitFeedbackFromField(cancel: true); return nil }   // esc → discard
                if ev.keyCode == 36 && !ev.modifierFlags.contains(.shift) { self.commitFeedbackFromField(cancel: false); return nil }  // ↵ → save
                return ev
            }
        }
        armFeedbackRegionCapture { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                CursorGuide.shared.attachFeedbackScreenshot(path)
                if let img = NSImage(contentsOfFile: path) { self.feedbackShotThumbs.append(img) }
                if let scr = self.statusItem?.button?.window?.screen ?? NSScreen.main { self.rebuildFeedbackPanel(scr) }  // show the chip
            }
        }
    }

    @MainActor private func rebuildFeedbackPanel(_ screen: NSScreen) {
        let fp = CursorGuide.shared.feedbackPrompt
        let view = FeedbackNoteDrop(
            note: Binding(get: { [weak self] in self?.feedbackNote ?? "" },
                          set: { [weak self] in self?.feedbackNote = $0 }),
            title: fp.title, icon: fp.icon, danger: fp.danger,
            shotThumbs: feedbackShotThumbs,
            onCommit: { [weak self] in Task { @MainActor in self?.commitFeedbackFromField(cancel: false) } },
            onCancel: { [weak self] in Task { @MainActor in self?.commitFeedbackFromField(cancel: true) } })
        let host = NoInsetHostingView(rootView: view)
        if feedbackPanel == nil {
            let p = LauncherPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 140),
                                  styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false
            p.level = .popUpMenu
            p.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
            feedbackPanel = p
        }
        feedbackPanel!.contentView = host
        let size = host.fittingSize
        feedbackPanel!.setContentSize(size)
        // Drop the note BELOW the notch (not pinned to the very top) so it never hides behind the guide card
        // or any notch content — the guide card collapses to its pill while capturing, and this sits under it.
        // Anchor right below the menu bar (top of the usable area) — as high as possible while the text field
        // stays CLICKABLE. Pinning at screen.frame.maxY tucked it under the menu bar/notch and made the field
        // untypeable; visibleFrame.maxY is the menu-bar bottom, so it's "at the top" but reachable.
        feedbackPanel!.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))   // notch-top aligned to the top edge of the menu bar (drops from the very top); content is top-padded to clear it
        feedbackPanel!.makeKeyAndOrderFront(nil)   // regain key focus so typing works after a rebuild/grab
        feedbackPanel!.makeKeyAndOrderFront(nil)
        orb?.orderOut(nil)
        presentFromNotch(feedbackPanel!)
    }

    // Push the typed note into CursorGuide, then commit or cancel. Called on ↵ / esc / Save / Discard.
    @MainActor private func commitFeedbackFromField(cancel: Bool) {
        guard CursorGuide.shared.capturingFeedback else { return }
        if cancel {
            CursorGuide.shared.cancelFeedback()
        } else {
            CursorGuide.shared.attachFeedbackNote(feedbackNote)   // typed note (replace)
            CursorGuide.shared.commitFeedback()
        }
        // teardown happens via onFeedbackEnd → hideFeedbackNote, which both paths trigger.
    }

    @MainActor private func hideFeedbackNote() {
        disarmFeedbackRegionCapture()
        if let m = feedbackKeyMonitor { NSEvent.removeMonitor(m); feedbackKeyMonitor = nil }
        if let p = feedbackPanel { dismissToNotch(p) }
        feedbackNote = ""; feedbackShotThumbs = []
    }

    // ── BUNDLED WEB SERVER — a packaged app ships examples/apps in Resources/webapps + the node binary, and
    //    serves them locally on :5188 so the ⌥⌥ launcher's widgets + wrapp pages work with NO dev server. In a
    //    dev build (no Resources/webapps) this is a no-op and the developer's external dev server is used. ──
    var webServerProc: Process?
    @MainActor private func startBundledWebServer() {
        guard webServerProc == nil,
              let serve = Bundle.main.url(forResource: "serve", withExtension: "mjs", subdirectory: "webapps"),
              let node = Bundle.main.url(forResource: "node", withExtension: nil) else { return }
        if isPortOpen(5188) { return }   // something's already serving :5188 (a dev server) — don't fight it
        let p = Process()
        p.executableURL = node
        p.arguments = [serve.path]
        var env = ProcessInfo.processInfo.environment; env["PORT"] = "5188"; p.environment = env
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do { try p.run(); webServerProc = p; godLog("bundled web server started on :5188 (\(serve.path))") }
        catch { godLog("bundled web server failed: \(error.localizedDescription)") }
    }
    private func isPortOpen(_ port: UInt16) -> Bool {
        let s = socket(AF_INET, SOCK_STREAM, 0); guard s >= 0 else { return false }
        defer { close(s) }
        var addr = sockaddr_in(); addr.sin_family = sa_family_t(AF_INET); addr.sin_port = port.bigEndian
        _ = "127.0.0.1".withCString { inet_pton(AF_INET, $0, &addr.sin_addr) }
        let r = withUnsafePointer(to: &addr) { p in p.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        return r == 0
    }

    // ── the native WIDGET HOST — load a wrapp offscreen, call __godWidget.get(input), render the notch widget ──
    private func mimeForExt(_ ext: String) -> String {
        switch ext {
        case "pdf": return "application/pdf"
        case "png": return "image/png"; case "jpg", "jpeg": return "image/jpeg"; case "gif": return "image/gif"; case "webp": return "image/webp"
        case "csv": return "text/csv"; case "tsv": return "text/tab-separated-values"
        case "json": return "application/json"; case "yaml", "yml": return "application/yaml"
        case "txt", "md": return "text/plain"
        default: return "application/octet-stream"
        }
    }
    private func widgetInput(from fileURL: URL?) -> [String: Any] {
        guard let f = fileURL else { return [:] }
        var input: [String: Any] = ["file": f.lastPathComponent, "filename": f.lastPathComponent]
        if let data = try? Data(contentsOf: f) {
            let ext = f.pathExtension.lowercased()
            input["dataUrl"] = "data:\(mimeForExt(ext));base64," + data.base64EncodedString()
            if ["csv", "tsv", "json", "yaml", "yml", "txt", "md"].contains(ext), let s = String(data: data, encoding: .utf8) { input["text"] = s }
        }
        return input
    }
    // Wrapps that ship a compact interactive <id>-widget.html (type in the notch → live result).
    private let interactiveWidgetIds: Set<String> = [
        // non-AI (client-side)
        "qr", "convert", "palette", "pdftools", "resize",
        // AI wrapps — compact interactive widget.html driven via the notch host's window.claude bridge
        "adforge", "adgen", "adpulse", "aplus", "arcana", "autopilot", "bank", "batch", "brandbrain",
        "canvas", "capp", "cartridge", "cast", "cut", "feature", "hardware", "ideabrain", "ideafetch",
        "meetnotes", "natal", "prism", "reachout", "redline", "reel", "retail", "shelf", "studio", "take",
        "saas", "flow", "huddle", "identity", "mkt", "marquee",
        // new: Deck (slides→pptx), Dub (audio→per-speaker TTS revoice)
        "deck", "dub",
    ]
    @MainActor func showWrappWidget(_ l: SBListing, input fileURL: URL?) {
        // A wrapp whose PRIMARY surface is "window" is a full app, not a glance widget — the launcher's
        // Enter honors the catalog and opens it in the native bridged window instead.
        if l.surfaces.first == "window" { launchWrapp(l, "window"); return }
        // Skills all share ONE generic widget (paste → run the skill → glance result), selected by
        // ?skill=<id>. skill-widget.html reads the id from the query string AND window.__widgetInput.skill.
        if l.category == "skill", let wurl = URL(string: "http://localhost:5188/skill-widget.html?skill=\(l.id)") {
            showNotchWidgetWeb(url: wurl, widgetId: l.id, title: l.name, input: widgetInput(from: fileURL))
            return
        }
        // Interactive path: render the wrapp's compact <id>-widget.html LIVE in the notch, with the launcher's
        // dropped file injected as window.__widgetInput. (Others fall through to the glance __godWidget path.)
        if interactiveWidgetIds.contains(l.id), let wurl = URL(string: "http://localhost:5188/\(l.id)-widget.html") {
            showNotchWidgetWeb(url: wurl, widgetId: l.id, title: l.name, input: widgetInput(from: fileURL))
            return
        }
        let fallback = URL(string: "http://localhost:5188/\(l.id).html")!
        let url = resolveDriveURL(tool: l.id, fallback: fallback)
        guard let token = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            showNotchWidget(WidgetSpec(kicker: l.name.uppercased(), title: "No pairing token", openLabel: "Open panel",
                result: .text("~/.relay/pairing-token is missing — is the daemon set up?")), onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            return
        }
        if driveRunning, let old = godWeb { old.onUserClosed = nil; old.close() }
        driveGeneration += 1
        driveName = l.name
        let web = GodWebWindow(url: url, token: token)
        godWeb = web
        driveRunning = true
        showDriveWorking("Opening \(l.name)…")
        let args = widgetInput(from: fileURL)
        let gen = driveGeneration
        web.open(visible: false, ready: { [weak self] in
            guard let self else { return }
            web.getWidget(input: args) { result in
                Task { @MainActor in
                    guard gen == self.driveGeneration else { return }
                    self.driveRunning = false
                    switch result {
                    case .success(let v): self.presentWrappWidget(v, listing: l, url: url)
                    case .failure(let e):
                        self.showNotchWidget(WidgetSpec(kicker: l.name.uppercased(), title: "Couldn't run \(l.name)", openLabel: "Open \(l.name)",
                            result: .text(String("\(e)".prefix(300)))), onOpen: { self.hideNotchWidget(); NSWorkspace.shared.open(url) })
                    }
                }
            }
        })
    }
    @MainActor private func presentWrappWidget(_ v: Any, listing l: SBListing, url: URL) {
        guard let d = v as? [String: Any] else {
            showNotchWidget(WidgetSpec(kicker: l.name.uppercased(), title: l.name, openLabel: "Open \(l.name)", result: widgetResult(from: v)),
                onOpen: { [weak self] in self?.hideNotchWidget(); NSWorkspace.shared.open(url) })
            return
        }
        let kicker = (d["kicker"] as? String) ?? l.name.uppercased()
        let title = (d["title"] as? String) ?? l.name
        let openLabel = (d["openLabel"] as? String) ?? "Open \(l.name)"
        let result = mapWidgetPayload(shape: (d["shape"] as? String) ?? "", result: d["result"], top: d)
        showNotchWidget(WidgetSpec(kicker: kicker, title: title, openLabel: openLabel, result: result),
            onOpen: { [weak self] in self?.hideNotchWidget(); NSWorkspace.shared.open(url) })
    }
    // decode a data: URL (a string, or a {dataUrl}/{name,dataUrl}) to a temp file → a local path (image / drag-out).
    private func dataURLToTemp(_ any: Any?, ext: String = "bin") -> String? {
        var dataUrl: String? = any as? String
        if dataUrl == nil, let o = any as? [String: Any] { dataUrl = o["dataUrl"] as? String }
        guard let s = dataUrl, s.hasPrefix("data:"), let comma = s.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(s[s.index(after: comma)...])) else { return nil }
        let realExt = s.contains("application/pdf") ? "pdf" : (s.contains("image/png") ? "png" : (s.contains("image/jpeg") ? "jpg" : ext))
        let dir = (NSTemporaryDirectory() as NSString).appendingPathComponent("notch-widget")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = (dir as NSString).appendingPathComponent("\(UUID().uuidString).\(realExt)")
        return (try? data.write(to: URL(fileURLWithPath: path))) != nil ? path : nil
    }
    @MainActor private func mapWidgetPayload(shape: String, result: Any?, top: [String: Any]) -> WidgetResult {
        let r = result as? [String: Any] ?? [:]
        switch shape {
        case "text":
            return .text(String(((r["body"] as? String) ?? (r["text"] as? String) ?? "").prefix(3000)))
        case "image":
            let caption = (r["caption"] as? String) ?? "On your device — drag it out."
            let steer = (r["steer"] as? [String]) ?? []
            let path = dataURLToTemp(r["file"], ext: "png") ?? dataURLToTemp(r["dataUrl"], ext: "png") ?? dataURLToTemp(top["file"], ext: "png")
            return .image(caption: caption, steer: steer, file: path)
        case "cards":
            let caption = (r["caption"] as? String) ?? ""
            let items = (r["items"] as? [[String: Any]] ?? []).prefix(8).map {
                CardItem(label: ($0["label"] as? String) ?? "", text: ($0["text"] as? String) ?? "", rec: ($0["recommended"] as? Bool) == true)
            }
            return .cards(caption: caption, items: Array(items))
        case "gallery":
            let caption = (r["caption"] as? String) ?? ""
            let items = (r["items"] as? [String]) ?? (r["items"] as? [[String: Any]])?.compactMap { self.dataURLToTemp($0, ext: "png") } ?? []
            return .gallery(caption: caption, items: items)
        case "working":
            return .working((r["line"] as? String) ?? "Working…")
        default:
            return widgetResult(from: top)
        }
    }
    // Map ANY wrapp tool's return object to the right widget renderer (states/edges completeness):
    // an array-of-options → cards (reply/nameit/adgen/adforge/toon/thumbs), an image URL → image
    // (downloaded so it's draggable), otherwise the best string → text. Never raw JSON in the notch.
    @MainActor private func widgetResult(from v: Any) -> WidgetResult {
        let d = v as? [String: Any]
        // 1) card-shaped: a known array key, or any value that's an array of dicts with label/text-ish fields.
        let arrayKeys = ["options", "replies", "concepts", "directions", "cards", "names", "angles", "ideas"]
        let arr: [[String: Any]]? = arrayKeys.compactMap { d?[$0] as? [[String: Any]] }.first
            ?? (d?.values.compactMap { $0 as? [[String: Any]] }.first { !$0.isEmpty })
        if let arr = arr, !arr.isEmpty {
            let items = arr.prefix(6).map { item -> CardItem in
                let label = (item["label"] ?? item["name"] ?? item["title"] ?? item["angle"]) as? String ?? "Option"
                let text = (item["text"] ?? item["preview"] ?? item["hook"] ?? item["body"] ?? item["headline"]) as? String ?? ""
                return CardItem(label: label, text: text, rec: (item["recommended"] as? Bool) == true)
            }
            return .cards(caption: "\(items.count) options — one recommended.", items: Array(items))
        }
        // strings-array (e.g. replies:[String]) → cards too
        if let strs = (["replies", "options", "lines"].compactMap { d?[$0] as? [String] }.first), !strs.isEmpty {
            let items = strs.prefix(6).enumerated().map { CardItem(label: "Option \($0.offset + 1)", text: $0.element) }
            return .cards(caption: "\(items.count) options.", items: Array(items))
        }
        // 2) image URL → download to a temp file so it renders + drags out
        if let u = (["imageUrl", "url", "image", "heroUrl"].compactMap { d?[$0] as? String }.first), let url = URL(string: u) {
            if let data = try? Data(contentsOf: url) {
                let dir = (NSTemporaryDirectory() as NSString).appendingPathComponent("notch-canvas")
                try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
                let path = (dir as NSString).appendingPathComponent("\(UUID().uuidString).png")
                if (try? data.write(to: URL(fileURLWithPath: path))) != nil {
                    return .image(caption: "Generated on your Claude — drag it out.", steer: [], file: path)
                }
            }
            return .text("Image ready: \(u)")   // download failed — at least surface the link
        }
        // 3) best string → text
        let body = ["roast", "reply", "answer", "gist", "text", "result", "summary", "explanation", "translation", "polished", "rewrite", "song", "notes", "html"]
            .compactMap { d?[$0] as? String }.first
            ?? (d?.values.compactMap { $0 as? String }.max(by: { $0.count < $1.count }))
            ?? String(describing: v)
        return .text(String(body.prefix(3000)))
    }

    @MainActor private func driveFinished(_ result: Result<Any, Error>) {
        driveRunning = false
        let userIsOnWindow = godWeb?.isFrontmost ?? false
        hideGodStatus()
        switch result {
        case .success(let v):
            let d = v as? [String: Any]
            let title = (d?["angle"] as? String) ?? (d?["title"] as? String) ?? driveName
            if userIsOnWindow {
                // The wrapp's own UI already shows the result — just flash "done" at the notch.
                showGodStatus("\(driveName) · done", accent: .lime, pattern: .speaking)
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { [weak self] in self?.hideGodStatus() }
            } else {
                // User went elsewhere → notification. Render by RESULT SHAPE (text · cards · image),
                // not just as a string, so reply/nameit/ads look right, not raw JSON.
                let regen: () -> Void = { [weak self] in
                    guard let self, let ld = self.lastDrive else { return }
                    self.godWeb?.close(); self.driveWrappLive(pageURL: ld.url, tool: ld.tool, input: ld.input, wrappName: ld.name)
                }
                showNotchWidget(WidgetSpec(kicker: "\(driveName.uppercased()) · LIVE", title: title, openLabel: "Show the wrapp",
                    result: widgetResult(from: v)),
                    onOpen: { [weak self] in self?.hideNotchWidget(); self?.godWeb?.front() },
                    onRegen: regen,
                    onSteer: { [weak self] chip in   // steer chips re-run the drive with the nudge folded into the input
                        guard let self, let ld = self.lastDrive else { return }
                        let steered = (ld.input ?? "") + "\n\n(Adjust: \(chip))"
                        self.godWeb?.close(); self.driveWrappLive(pageURL: ld.url, tool: ld.tool, input: steered, wrappName: ld.name)
                    })
            }
        case .failure(let e):
            showNotchWidget(WidgetSpec(kicker: "\(driveName.uppercased()) · LIVE", title: "Drive failed", openLabel: "Open panel",
                result: .text("\(e.localizedDescription)\n\nIs the dev server running? (cd examples/apps && node serve.mjs)")),
                onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
        }
    }

    // The HEADLESS skill path (docs/GOD-HANDS.md, the user's "basic skills don't need a page"): a skill
    // is a prompt, so run it with ONE gated model call on the user's own Claude and drop the result in
    // the notch — no webview, no iframe. Same notch grammar as the page drive (working → shape-aware
    // result, Copy/drag-out, steer chips re-run the skill), just without hosting a page. `input` nil →
    // the clipboard (what the user is most likely looking at).
    @MainActor func driveSkillHeadless(_ l: SBListing, input: String? = nil) {
        guard let body = resolveSkillContent(l) else {   // no skill body → fall back to the page drive
            if let s = l.components.ui?.url, let u = URL(string: s) { driveWrappLive(pageURL: u, tool: "\(l.id)_run", input: input, wrappName: l.name) }
            return
        }
        let clip = (NSPasteboard.general.string(forType: .string) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let text = (input?.isEmpty == false ? input! : clip)
        guard !text.isEmpty else {
            showNotchWidget(WidgetSpec(kicker: "\(l.name.uppercased()) · SKILL", title: "Nothing to work on", openLabel: "Close",
                result: .text("Copy some text first, or tell \(l.name) what to work on — it runs on your clipboard.")),
                onOpen: { [weak self] in self?.hideNotchWidget() })
            return
        }
        // One skill run at a time — a new ask supersedes the old (same generation guard as the page drive).
        if driveRunning, let old = godWeb { old.onUserClosed = nil; old.close(); driveRunning = false }
        driveGeneration += 1
        driveName = l.name
        let gen = driveGeneration
        showNotchWidget(WidgetSpec(kicker: "\(l.name.uppercased()) · SKILL", title: "\(l.name) is working…", openLabel: "Close",
            result: .working("Running \(l.name) on your Claude…")),
            onOpen: { [weak self] in self?.hideNotchWidget() })
        SkillRunner.shared.run(skillPrompt: body, input: text) { [weak self] result in
            Task { @MainActor in
                guard let self, gen == self.driveGeneration else { return }   // superseded — drop the late result
                switch result {
                case .success(let out):
                    let rerun: (String) -> Void = { [weak self] chip in
                        guard let self else { return }
                        self.driveSkillHeadless(l, input: text + "\n\n(Adjust: \(chip))")
                    }
                    self.showNotchWidget(WidgetSpec(kicker: "\(l.name.uppercased()) · SKILL", title: l.name, openLabel: "Copy",
                        result: self.widgetResult(from: ["text": out])),
                        onOpen: { [weak self] in
                            let pb = NSPasteboard.general; pb.clearContents(); pb.setString(out, forType: .string)
                            self?.showGodStatus("Copied \(l.name) result", accent: .lime, pattern: .speaking)
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in self?.hideGodStatus() }
                        },
                        onRegen: { [weak self] in self?.driveSkillHeadless(l, input: text) },
                        onSteer: rerun)
                case .failure(let e):
                    self.showNotchWidget(WidgetSpec(kicker: "\(l.name.uppercased()) · SKILL", title: "\(l.name) failed", openLabel: "Open panel",
                        result: .text(e.localizedDescription)),
                        onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
                }
            }
        }
    }

    // ── THIRD-PARTY MCP TOOL (epic: third-party-tools) ────────────────────────────────────────────
    // Drive a locally-configured MCP tool HEADLESS: call it through the daemon gate (claude_callTool →
    // allowlist + write-consent + audit), so credentials stay in the daemon and never leave. The result
    // grows from the notch. Origin is stable per tool ("tool://<id>") so its grant is its own; a
    // not-granted / SCOPE_EXCEEDED reply is surfaced as "grant it first", never a silent dead-end.
    @MainActor func driveThirdPartyTool(_ l: SBListing, _ binding: SBMcpBinding, command: String?, input: String?) {
        let toolName = command.flatMap { c in (binding.tools ?? []).first { $0 == c } }
            ?? binding.tools?.first ?? l.tools?.first?.name ?? l.id
        guard let token = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            showNotchWidget(WidgetSpec(kicker: "TOOL · \(l.name.uppercased())", title: "No pairing token",
                openLabel: "Open panel", result: .text("~/.relay/pairing-token is missing — is the daemon set up?")),
                onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            return
        }
        showNotchWidget(WidgetSpec(kicker: "TOOL · \(l.name.uppercased())", title: "Running \(toolName)…",
            openLabel: "", result: .working("\(l.name) — a third-party tool, running on your machine…")))
        // The one primary string, sprayed across the arg keys tools commonly use; each reads its own.
        let text = input ?? (NSPasteboard.general.string(forType: .string) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        lastToolInput[l.id] = text                      // remembered so a credential-set retry re-runs the same query
        let args: [String: Any] = ["input": text, "query": text, "q": text, "text": text, "prompt": text, "url": text]
        callThirdPartyTool(l, binding, tool: toolName, args: args, token: token, allowConnect: true)
    }
    // The gated call. On a not-granted reply (SCOPE_EXCEEDED / origin not connected) we GRANT once at the
    // notch (claude_connect → the pair-light card) and retry — so "God, run X" just works after one Approve,
    // and the grant persists for the session. allowConnect:false on the retry so we never loop.
    @MainActor private func callThirdPartyTool(_ l: SBListing, _ binding: SBMcpBinding, tool: String, args: [String: Any], token: String, allowConnect: Bool) {
        let bridge = GodDaemonBridge(token: token)
        // The daemon namespaces MCP tools `mcp__<server>__<tool>` (registry.ts) — call it by that name,
        // not the bare tool name (else "no such tool").
        let qualified = "mcp__\(binding.server)__\(tool)"
        bridge.request(origin: "tool://\(l.id)", method: "claude_callTool", params: ["name": qualified, "arguments": args]) { [weak self] result, err in
            Task { @MainActor in
                bridge.close()
                if allowConnect, RelayController.notGrantedSignal(result, err) {
                    self?.connectThirdPartyTool(l, binding, tool: tool, args: args, token: token)
                } else {
                    self?.thirdPartyToolFinished(l, binding, tool: tool, result: result, err: err)
                }
            }
        }
    }
    // Grant this tool's origin once (claude_connect → consent:connect → the pair-light ConnectGrantDrop at
    // the notch, routed to the menubar), then retry the call. Keys stay in the daemon; the grant IS the
    // user's explicit approval to run this third-party tool.
    @MainActor private func connectThirdPartyTool(_ l: SBListing, _ binding: SBMcpBinding, tool: String, args: [String: Any], token: String) {
        // Hide our own widget so it doesn't sit BEHIND the grant card — the daemon's consent:connect
        // raises the pair-light ConnectGrantDrop as its own notch card; that's the only card to show now.
        hideNotchWidget()
        let bridge = GodDaemonBridge(token: token)
        // Grant the daemon-qualified tool names (`mcp__<server>__<tool>`) so the allowlist matches the call.
        let scopeTools = (binding.tools ?? [tool]).map { "mcp__\(binding.server)__\($0)" }
        let scope: [String: Any] = ["tools": scopeTools,
                                     "reason": "\(l.name) — a third-party tool, running on your machine"]
        bridge.request(origin: "tool://\(l.id)", method: "claude_connect", params: scope) { [weak self] result, err in
            Task { @MainActor in
                bridge.close()
                if err != nil || result == nil || result is NSNull {
                    self?.showNotchWidget(WidgetSpec(kicker: "TOOL · \(l.name.uppercased())", title: "Not granted",
                        openLabel: "Close", result: .text("“\(l.name)” wasn’t granted — nothing ran.")),
                        onOpen: { [weak self] in self?.hideNotchWidget() })
                    return
                }
                self?.showNotchWidget(WidgetSpec(kicker: "TOOL · \(l.name.uppercased())", title: "Running \(tool)…",
                    openLabel: "", result: .working("\(l.name) — running on your machine…")))
                self?.callThirdPartyTool(l, binding, tool: tool, args: args, token: token, allowConnect: false)
            }
        }
    }
    private nonisolated static func isNotGranted(_ e: [String: Any]) -> Bool {
        let code = "\(e["code"] ?? "")"   // may be a number (4100) or a string
        let msg = (e["message"] as? String) ?? ""
        return code == "4100" || code == "SCOPE_EXCEEDED" || code == "UNAUTHORIZED"
            || msg.localizedCaseInsensitiveContains("not connected")
            || msg.localizedCaseInsensitiveContains("allowlist")
    }
    // The daemon returns a gate DENIAL as a RESULT ({ok:false, error:{message, code:4100}}), not a
    // JSON-RPC error — so a not-granted tool call arrives with err==nil and the denial buried in the
    // result. Detect the not-granted signal in EITHER place, so the connect-then-retry always fires.
    private nonisolated static func notGrantedSignal(_ result: Any?, _ err: [String: Any]?) -> Bool {
        if let err, isNotGranted(err) { return true }
        guard let d = result as? [String: Any], (d["ok"] as? Bool) == false else { return false }
        if let e = d["error"] as? [String: Any] { return isNotGranted(e) }
        if let s = d["error"] as? String {
            return s.localizedCaseInsensitiveContains("not connected") || s.localizedCaseInsensitiveContains("allowlist")
        }
        return false
    }
    @MainActor private func thirdPartyToolFinished(_ l: SBListing, _ binding: SBMcpBinding, tool: String, result: Any?, err: [String: Any]?) {
        if let err {
            let msg = (err["message"] as? String) ?? "the tool call failed"
            showNotchWidget(WidgetSpec(kicker: "TOOL · \(l.name.uppercased())", title: "“\(l.name)” couldn’t run",
                openLabel: "Open panel", result: .text(msg)),
                onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            return
        }
        let flat = RelayController.flattenToolResult(result)
        // A keyed tool with no key yet signals `needs_credential` (task 3) — raise the credential card
        // (secure field) instead of rendering a result; on save we store the key + retry this same call.
        if let need = RelayController.parseNeedsCredential(flat) {
            showToolCredential(l, binding, tool: tool, input: lastToolInput[l.id], env: need.env, label: need.label, hint: need.hint)
            return
        }
        // A tool that speaks the results ENVELOPE (examples/tools/README-envelope.md) renders as result
        // CARDS; `text` is the readable form "Drop into chat" copies. Anything else falls back to text.
        let env = RelayController.parseResultEnvelope(flat)
        let dropText = env?.text ?? flat
        let widgetResult: WidgetResult = {
            if let env, !env.items.isEmpty { return .results(summary: env.summary, items: env.items) }
            return .text(flat.isEmpty ? "\(tool) ran — no text result." : flat)
        }()
        showNotchWidget(WidgetSpec(kicker: "TOOL · \(l.name.uppercased())", title: env?.summary.isEmpty == false ? env!.summary : l.name,
            openLabel: "Drop into chat", result: widgetResult),
            onOpen: { [weak self] in
                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(dropText, forType: .string)
                self?.hideNotchWidget()
                self?.showGodStatus("Copied — paste it into any chat", accent: .lime, pattern: .speaking)
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { [weak self] in self?.hideGodStatus() }
            })
    }
    // Parse a `{ _switchboard:"needs_credential", secret:{env,label,hint} }` envelope — a keyed tool
    // signalling it has no key yet — and return the secret descriptor so the runner raises the card (task 3).
    private nonisolated static func parseNeedsCredential(_ s: String) -> (env: String, label: String, hint: String)? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.hasPrefix("{"), let data = t.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["_switchboard"] as? String) == "needs_credential",
              let sec = obj["secret"] as? [String: Any],
              let env = (sec["env"] as? String), !env.isEmpty else { return nil }
        return (env, (sec["label"] as? String) ?? env, (sec["hint"] as? String) ?? "")
    }

    // ── the credential card: raise it, store the key via the daemon, retry the call ──────────────────
    @MainActor private func showToolCredential(_ l: SBListing, _ binding: SBMcpBinding, tool: String, input: String?, env: String, label: String, hint: String) {
        hideNotchWidget()
        guard let screen = statusItem.button?.window?.screen ?? NSScreen.main else { return }
        pendingCredential = PendingCredential(l: l, binding: binding, tool: tool, input: input, env: env, label: label, hint: hint)
        credentialValue = ""
        let view = ToolCredentialDrop(
            toolName: l.name, label: label, hint: hint,
            value: Binding(get: { [weak self] in self?.credentialValue ?? "" },
                           set: { [weak self] in self?.credentialValue = $0 }),
            onSave: { [weak self] in Task { @MainActor in self?.saveToolCredential() } },
            onCancel: { [weak self] in Task { @MainActor in self?.hideToolCredential() } })
        let host = NoInsetHostingView(rootView: view)
        if credentialPanel == nil {
            let p = LauncherPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 150),
                                  styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false; p.level = .popUpMenu
            p.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
            credentialPanel = p
        }
        credentialPanel!.contentView = host
        let size = host.fittingSize
        credentialPanel!.setContentSize(size)
        credentialPanel!.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - 8))
        credentialPanel!.makeKeyAndOrderFront(nil)
        orb?.orderOut(nil)
        presentFromNotch(credentialPanel!)
    }

    @MainActor private func saveToolCredential() {
        guard let pc = pendingCredential else { return }
        let value = credentialValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        guard let token = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else { hideToolCredential(); return }
        let bridge = GodDaemonBridge(token: token)
        // The value goes STRAIGHT to the daemon (stored 0600, injected into the tool's spawn env) — never
        // logged or kept here. On ok the daemon has already reconnected the server WITH the key, so the
        // retry authenticates.
        bridge.request(origin: "tool://\(pc.l.id)", method: "claude_setToolSecret",
                       params: ["server": pc.binding.server, "env": pc.env, "value": value]) { [weak self] _, err in
            Task { @MainActor in
                bridge.close()
                self?.credentialValue = ""
                self?.hideToolCredential()
                if err == nil {
                    self?.driveThirdPartyTool(pc.l, pc.binding, command: pc.tool, input: pc.input)
                } else {
                    self?.showNotchWidget(WidgetSpec(kicker: "TOOL · \(pc.l.name.uppercased())", title: "Couldn’t save the key",
                        openLabel: "Close", result: .text("The credential wasn’t saved — nothing ran.")),
                        onOpen: { [weak self] in self?.hideNotchWidget() })
                }
            }
        }
    }

    @MainActor private func hideToolCredential() {
        credentialValue = ""
        pendingCredential = nil
        if let p = credentialPanel { dismissToNotch(p) }
    }

    // Parse the Switchboard results envelope out of a tool's flattened text content. Returns nil unless it's
    // a `{ _switchboard:"results", ... }` object — so plain-text tools keep their text rendering untouched.
    struct ResultEnvelope { let summary: String; let text: String; let items: [ResultItem] }
    private nonisolated static func parseResultEnvelope(_ s: String) -> ResultEnvelope? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.hasPrefix("{"), let data = t.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["_switchboard"] as? String) == "results" else { return nil }
        let items: [ResultItem] = ((obj["items"] as? [[String: Any]]) ?? []).compactMap { d in
            let title = (d["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !title.isEmpty else { return nil }
            return ResultItem(title: title,
                              url: (d["url"] as? String) ?? "",
                              source: (d["source"] as? String) ?? "",
                              snippet: (d["snippet"] as? String) ?? "",
                              meta: (d["meta"] as? String) ?? "")
        }
        return ResultEnvelope(summary: (obj["summary"] as? String) ?? "",
                              text: (obj["text"] as? String) ?? s, items: items)
    }
    // MCP callTool result → text. Handles {content:[{type:"text",text}]}, plain strings, and objects.
    private nonisolated static func flattenToolResult(_ result: Any?) -> String {
        if let s = result as? String { return s }
        if let d = result as? [String: Any] {
            if let content = d["content"] as? [[String: Any]] {
                let parts = content.compactMap { $0["text"] as? String }
                if !parts.isEmpty { return parts.joined(separator: "\n") }
            }
            if let t = d["text"] as? String { return t }
            if let data = try? JSONSerialization.data(withJSONObject: d, options: [.prettyPrinted]),
               let s = String(data: data, encoding: .utf8) { return s }
        }
        return ""
    }

    private func showPanel() {
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
        panel.setFrameTopLeftPoint(NSPoint(x: x, y: screen.frame.maxY + notchTopBleed))   // top of the menu bar = screen top
        presentFromNotch(panel)   // grow out of the notch
        // transient: any click outside puts it away
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor in self?.hidePanel() }
        }
    }

    private func hidePanel() {
        dismissToNotch(panel)   // collapse back into the notch
        openedByHover = false
        if let m = clickMonitor { NSEvent.removeMonitor(m); clickMonitor = nil }
    }

    // Park the orb centred at the top, just under the menu bar / notch. (menuH is a reasonable
    // constant — tune per display on a real run; some Macs report a lying menuBarHeight.)
    private func positionOrb() {
        guard let screen = statusItem?.button?.window?.screen ?? NSScreen.main else { return }
        let w: CGFloat = 184
        // The resting notch is exactly the MENU-BAR HEIGHT (founder 2026-08-13: "notch the size of the
        // menu bar") — it spans the bar, flush, rather than hanging below. Cards/God phases still DROP
        // below from this same silhouette; only the idle orb stays bar-height. `reveal` is a hair of
        // bottom bleed so the rounded bottom + a row of lamps read without changing the perceived height.
        let menuH = max(screen.frame.maxY - screen.visibleFrame.maxY, 22)
        let reveal: CGFloat = 1
        orb.setFrame(NSRect(x: screen.frame.midX - w / 2, y: screen.visibleFrame.maxY - reveal, width: w, height: menuH + reveal), display: true)
    }

    // Hover/click on the orb → open the full detailed panel (reuses the existing show/position path).
    @MainActor private func openFromOrb() {
        if !panel.isVisible { openedByHover = true; showPanel() }
    }

    // Hover-out closes a HOVER-opened panel: once the cursor leaves both the orb and the panel, put it
    // away. A glyph CLICK (openedByHover == false) stays open until you click away — so moving the mouse
    // off after clicking the menu-bar icon doesn't yank it shut.
    @MainActor private func maybeAutoClosePanel() {
        guard openedByHover, panel.isVisible else { return }
        if onboard.phase == .setup || onboard.phase == .tour { return }   // don't close mid-onboarding
        let m = NSEvent.mouseLocation
        if !panel.frame.insetBy(dx: -6, dy: -6).contains(m) && !orb.frame.insetBy(dx: -6, dy: -6).contains(m) {
            hidePanel()
        }
    }

    // The onboarding concierge, ported onto the CursorGuide floating-cursor tour (docs/ONBOARDING.md
    // Act II). Writes ~/.relay/guide-run.json {mode:"tour"}; the already-armed CursorGuide watcher
    // (installed in installGlow/CursorGuide.shared.install) picks it up within ~0.3s and floats each
    // step by the cursor. Steps 1-3 walk the real permission cards (surfaced via refreshPermissionGate);
    // steps 4-6 practice the three hotkeys ⌃⌃ / ⌃⌥ / ⌥⌥ — which stay LIVE during a guide (onFlags has
    // no isActive guard), so the practice actually works. Canonical copy: examples/apps/onboarding/
    // onboarding-tour.json (kept in sync; inlined here so the app has no runtime file dependency).
    @MainActor private func startWelcomeTour() {
        var steps: [[String: Any]] = []
        // Copy is deliberately TERSE — a short lead line + a one-line hint. The keys a step teaches render as
        // keycap BUTTONS (the `keys` field), not prose. Notch/orb steps sit at the CURSOR so the notch is free.
        // ── Welcome
        steps.append(["id": "welcome",
            "text": "Welcome. In ninety seconds you're running AI on your own Mac — nothing leaves it.",
            "say": "Welcome. In about ninety seconds you'll be running AI on your own Mac, and nothing leaves it.",
            "hint": "⌥→ next · ⌥. hide me · esc leave."])
        // ── Access — only the permissions not yet granted (a returning user skips these)
        for p in GodPerm.allCases where !p.granted {
            switch p {
            case .mic:
                steps.append(["id": "grant-mic",
                    "text": "Mic — the ear that hears you. Click Allow on the card.",
                    "say": "First the microphone — that's the ear that hears you. Click Allow on the card.",
                    "hint": "No window? The card opens System Settings — flip Switchboard on."])
            case .accessibility:
                steps.append(["id": "grant-accessibility",
                    "text": "Accessibility — the hand that points and types. Add Switchboard, switch it on.",
                    "say": "Accessibility is the hand that points and types. Add Switchboard to the list and switch it on.",
                    "hint": "macOS needs you to add it yourself. The card waits."])
            case .screen:
                steps.append(["id": "grant-screen",
                    "text": "Screen Recording — the eyes. Click Allow.",
                    "say": "Screen recording is the eyes. Click Allow — that's the last one.",
                    "hint": "Last one. ⌥→ to keep going."])
            }
        }
        // ── Your Claude — only if signed out
        if model.running && !model.signedIn {
            steps.append(["id": "sign-in",
                "text": "Switchboard runs on YOUR Claude — no API key, no extra bill.",
                "say": "Switchboard runs on your own Claude. No API key, no extra bill. Run claude in the terminal I opened, then carry on.",
                "hint": "Run `claude` in the Terminal I opened, then ⌥→. Dot turns lime when you're in."])
        }
        // ── The three keys (hotkeys stay live during a guide, so this is real practice). Each teaches its
        //    shortcut as a keycap button. Summon + launcher use the NOTCH, so the card rides the CURSOR to free it.
        steps.append(["id": "key-summon",
            "text": "Your summon — tap it and say what you need. The orb wakes and listens.",
            "say": "This is your summon. Tap it and say what you need — the orb wakes and listens.",
            "keys": [["caps": ["⌃", "⌃"], "name": "Ask"]],
            "placement": "cursor",
            "doneWhen": ["kind": "event", "name": "summon"],   // advances the instant you actually ⌃⌃
            "hint": "Just try it — I'll move on when you do."])
        steps.append(["id": "key-dictation",
            "text": "Hold in any text field and speak — your words land at the cursor.",
            "say": "Hold this in any text field and speak, and your words land at your cursor. If you want them again later, option V pastes your last dictation anywhere.",
            "keys": [["caps": ["⌃", "⌥"], "name": "Dictate"]],
            "doneWhen": ["kind": "event", "name": "dictation"],
            "hint": "Hold to talk, release to drop — I'll move on when you do."])
        steps.append(["id": "key-launcher",
            "text": "Your home — projects, files, apps, all searchable in one place.",
            "say": "Double-tap Option for your home — projects, files and apps, all searchable in one place.",
            "keys": [["caps": ["⌥", "⌥"], "name": "Home"]],
            "placement": "cursor",
            "doneWhen": ["kind": "event", "name": "launcher"],
            "hint": "Double-tap Option — I'll move on when you do."])
        // ── The whiteboard — when drawing beats describing (and Claude can draw back)
        steps.append(["id": "whiteboard",
            "text": "When it's easier to draw than describe — sketch it, and send the drawing to Claude.",
            "say": "One more. When it's easier to draw something than describe it, open a whiteboard and sketch it. Claude reads the drawing — and can draw back, so you can answer a question by marking up what it drew.",
            "hint": "Ask any thread for a whiteboard. Minimise it and it parks as a chip at the notch. ⌥→."])
        // ── First project (seeded demo so it's never a blank slate)
        steps.append(["id": "first-project",
            "text": "The project chip is the context every app borrows. I seeded a demo one.",
            "say": "The project chip is the context every app borrows. I've seeded a demo one for you.",
            "hint": "Click it to peek — make your own later. ⌥→."])
        // ── First wrapp (AI)
        steps.append(["id": "first-wrapp",
            "text": "Run something real: open ideabrain, give it a rough idea, watch it think.",
            "say": "Now run something real. Open ideabrain, give it a rough idea, and watch it think.",
            "hint": "A wrapp is a skin over your Claude — no setup. ⌥→ after a result."])
        // ── First non-AI tool (instant win, zero setup, private by construction)
        steps.append(["id": "first-tool",
            "text": "Not everything needs AI. Try QR — instant, on-device, nothing sent.",
            "say": "Not everything needs AI. Try Q R — it's instant, on-device, and nothing gets sent.",
            "hint": "The non-AI tools are free + private. ⌥→ when you've got one."])
        // ── Background tasks
        steps.append(["id": "background",
            "text": "Long jobs run in the background — you'll get a notch nudge when they finish.",
            "say": "Long jobs keep running in the background. You'll get a nudge at the notch when they're done.",
            "hint": "Click the dot to peek at the Running rail. ⌥→."])
        // ── Set up by choosing — an OPTIONS step. The pick is applied LIVE via onOptionApprove
        //    (onboarding is the first consumer of the guide's options hook), and recorded in the result.
        steps.append(["id": "setup-economy",
            "text": "Your call — full quality, or economy.",
            "say": "Your call — full quality, or economy to stretch your usage.",
            "hint": "⌥1 / ⌥2 to try · ⌥→ to lock in · change anytime in Settings.",
            "options": [
                ["id": "full", "label": "Full quality", "accent": "lime",   "detail": "Best answers",         "recommended": true],
                ["id": "eco",  "label": "Economy",      "accent": "indigo", "detail": "Faster, fewer tokens"],
            ]])
        // ── What's next (compact inline recap — three KeyChips would overflow the card)
        steps.append(["id": "done",
            "text": "That's it — ⌃⌃ ask · ⌃⌥ dictate · ⌥V re-paste · ⌥⌥ home · tap the notch to open the board.",
            "say": "That's it. Control-control to ask, control-option to dictate, option-option for home — and tap the notch any time to open the board.",
            "hint": "Browse the store for more. Replay anytime from the dot."])

        let payload: [String: Any] = ["mode": "tour", "title": "Welcome to Switchboard", "steps": steps]
        try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true)
        let f = (RELAY_DIR as NSString).appendingPathComponent("guide-run.json")
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: f), options: .atomic)
        }
        seedExampleProject()           // so the "first project / first wrapp" steps aren't a blank slate
        // Surface the REAL permission cards so the access steps have a live Grant button under the guide.
        gateDismissed = false          // clear any prior dismissal so the concierge cards can show
        refreshPermissionGate()
        // Presence == onboarded (matches Onboard.mark semantics), so first-run auto-open doesn't re-fire.
        try? Data("done".utf8).write(to: URL(fileURLWithPath: ONBOARDED_FILE))
    }
    @objc private func replayWelcomeTour() { startWelcomeTour() }

    // The spoken concierge — read a tour line aloud in God's SELECTED voice (Pocket-TTS clone server on
    // :7897, the exact path God uses), with macOS `say` as the fallback. Interrupts any in-flight line so
    // advancing a step cuts the previous one. Off the main thread (network + audio). Kept intentionally
    // small; it mirrors previewVoice's wire.
    private var guideVoiceProc: Process?
    @MainActor private func speakGuideLine(_ text: String) {
        stopGuideSpeech()
        let line = text.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "\n", with: " ")
        guard !line.isEmpty else { return }
        let name = (try? String(contentsOfFile: (NSHomeDirectory() as NSString).appendingPathComponent(".relay/voices/selected"), encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            func sayIt() {
                let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/say"); p.arguments = [line]
                Task { @MainActor in self?.guideVoiceProc = p }; try? p.run()
            }
            guard !name.isEmpty else { sayIt(); return }
            let wav = NSTemporaryDirectory() + "guide-vo.wav"
            try? FileManager.default.removeItem(atPath: wav)
            let body = "{\"text\":\"\(line)\",\"voice\":\"\(name)\"}"
            let curl = Process(); curl.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
            // 60s (not 25s): the clone-TTS model cold-loads slowly; a 25s timeout left a PARTIAL wav
            // that afplay then played truncated — the "TTS was brief / didn't finish" bug. Also require
            // curl to have SUCCEEDED (exit 0), so a timeout/failure falls back to the full macOS voice
            // instead of speaking a half-rendered clip.
            curl.arguments = ["-s", "-m", "60", "-X", "POST", "http://127.0.0.1:7897/speak", "-H", "content-type: application/json", "-d", body, "-o", wav]
            try? curl.run(); curl.waitUntilExit()
            let sz = (try? FileManager.default.attributesOfItem(atPath: wav)[.size] as? Int) ?? 0
            if curl.terminationStatus == 0, sz > 1000 {
                let play = Process(); play.executableURL = URL(fileURLWithPath: "/usr/bin/afplay"); play.arguments = [wav]
                Task { @MainActor in self?.guideVoiceProc = play }; try? play.run()
            } else { sayIt() }   // clone server down → macOS voice
        }
    }
    @MainActor private func stopGuideSpeech() {
        guideVoiceProc?.terminate(); guideVoiceProc = nil
    }

    // Give a brand-new user something to try instantly: a lightweight demo project so the first-project
    // and first-wrapp tour steps aren't a blank slate. Only seeds when the user has NO contexts of their
    // own, and only makes it the default if no default is set — never clobbers real work. Reversible:
    // the user can delete it from the project chip. (Rich pre-built example CONTENT is a Bank-redo item.)
    @MainActor private func seedExampleProject() {
        guard readContexts().isEmpty else { return }
        let demo: [[String: Any]] = [["id": "demo-project", "name": "Demo project", "kind": "project"]]
        if let data = try? JSONSerialization.data(withJSONObject: demo, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: CONTEXTS_FILE), options: .atomic)
        }
        if readDefaultId() == nil { writeGlobalContext("demo-project") }
    }

    // Show the Accessibility onboarding card while the app isn't trusted (unless dismissed this
    // session); auto-hide the instant it's granted. AXIsProcessTrusted() is the honest, non-prompting read.
    // The concierge: show the FIRST missing permission (mic → accessibility → screen); advance as each
    // is granted; hide when all three are in. Polled, so it steps forward on its own.
    @MainActor private func refreshPermissionGate() {
        let missing = GodPerm.allCases.filter { !$0.granted }
        guard let next = missing.first else { gateShowingPerm = nil; gatePanel?.orderOut(nil); return }
        guard !gateDismissed else { return }
        if next == gateShowingPerm && gatePanel?.isVisible == true { return }   // already on this step
        gateShowingPerm = next
        showPermissionGate(next, done: GodPerm.allCases.count - missing.count)
    }

    @MainActor private func showPermissionGate(_ perm: GodPerm, done: Int) {
        let url = Bundle.main.bundleURL
        let icon = NSWorkspace.shared.icon(forFile: url.path)
        let grant: () -> Void = { [weak self] in
            switch perm {
            case .mic:
                // requestAccess ONLY shows the OS prompt when the status is .notDetermined. After a
                // prior denial — which ad-hoc/dev builds cause constantly (TCC identity churns each
                // rebuild, see GOD.md §5) — it silently calls back false and NOTHING appears, so the
                // button looks dead. So: prompt only when it can, else send the user to the pane.
                if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                    AVCaptureDevice.requestAccess(for: .audio) { _ in Task { @MainActor in self?.refreshPermissionGate() } }
                } else {
                    NSWorkspace.shared.open(URL(string: perm.pane)!)
                    Task { @MainActor in self?.refreshPermissionGate() }
                }
            case .screen:
                // CGRequestScreenCaptureAccess prompts when undetermined and returns false when already
                // denied (no UI) — same trap as the mic. Open the pane on a false result.
                if !CGRequestScreenCaptureAccess() { NSWorkspace.shared.open(URL(string: perm.pane)!) }
                Task { @MainActor in self?.refreshPermissionGate() }
            case .accessibility: NSWorkspace.shared.open(URL(string: perm.pane)!)
            }
        }
        let view = PermissionGateCard(perm: perm, done: done, total: GodPerm.allCases.count, appIcon: icon, appURL: url,
            onGrant: grant,
            onDismiss: { [weak self] in self?.gateDismissed = true; self?.gatePanel?.orderOut(nil) })
        if gatePanel == nil {
            gatePanel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            gatePanel.isOpaque = false
            gatePanel.backgroundColor = .clear
            gatePanel.hasShadow = false
            gatePanel.level = .popUpMenu
            gatePanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]  // NOT transient — stays while you drag into Settings
        }
        gatePanel.contentView = NoInsetHostingView(rootView: view)
        let size = gatePanel.contentView!.fittingSize
        gatePanel.setContentSize(size)
        if let screen = statusItem?.button?.window?.screen ?? NSScreen.main {
            gatePanel.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        }
        presentFromNotch(gatePanel)
    }

    // ⌃⌥ + click anywhere → summon God at the click point the summon gesture. A global monitor needs
    // Accessibility / Input-Monitoring — exactly what God's setup concierge grants; without it this
    // silently no-ops, which is honest. Fires only when Switchboard isn't the key app — fine, it's a
    // menu-bar accessory that's never key.
    private func installHotKey() {
        // Double-tap CONTROL (⌃⌃) — Flow's gesture — via a PASSIVE global modifier monitor (NSEvent),
        // NOT a CGEventTap. A tap needs Input Monitoring; this passive modifier monitor is lighter, which
        // is exactly why Flow's ⌃⌃ "just works." Diagnostics land in ~/.relay/god-hotkey.log.
        godLog("installHotKey: AXIsProcessTrusted=\(AXIsProcessTrusted()) — passive ⌃⌃ monitor installed")
        flagsMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged]) { [weak self] e in
            Task { @MainActor in self?.onFlags(e.modifierFlags) }
        }
    }

    // Two gestures on one monitor, both bound from ~/.relay/shortcuts.json (defaults ⌃⌥ hold / ⌃⌃ tap):
    //   TALK chord HOLD → dictation (raw whisper transcript pasted at the cursor — no God, no cleanup)
    //   SUMMON modifier double-tap → summon God (see/hear/help)
    @MainActor private func onFlags(_ flags: NSEvent.ModifierFlags) {
        // NOTE: dictation (⌃⌥) stays LIVE during a guide on purpose — the guide's own signals are fn+arrow
        // keys (CursorGuide owns them), so they never collide, and the user can DICTATE feedback mid-guide.
        let cfg = model.shortcuts
        let talk = chordFlags(cfg.talk)
        let summonMod = modFlag(cfg.summon)
        let m = flags.intersection([.control, .option, .command, .shift])
        let talkHeld = !talk.isEmpty && m == talk
        let latch = cfg.dictationMode == "latch"
        // While a dictation is in progress the talk chord / summon logic is OWNED by the active mode:
        //   • latch — recording is latched ON; ignore ALL modifier changes here (release must NOT stop it,
        //     and a second talk-chord tap is a deliberate NO-OP so it can't clobber the in-progress take).
        //     The dictateWatchTimer owns commit (⌃ tap), cancel (Esc), and the Fn→find indicator.
        //   • hold  — legacy: the moment either chord key lifts we transcribe + paste.
        if dictating {
            if !latch && !talkHeld { finishDictation(find: false) }
            return
        }
        if talkHeld { onboard.lastDictate = Date(); startDictation(); return }
        // Summon = a double-tap of the single summon modifier — so it only arms when ONLY that key is
        // down (a chord that contains it, e.g. the talk chord, never reads as a summon tap).
        if m == summonMod && !summonWasDown {
            summonWasDown = true
            onCtrlTap()
        } else if m.isEmpty {
            summonWasDown = false
        } else {
            summonWasDown = flags.contains(summonMod)
        }
        // ⌥⌥ launcher — double-tap Option ALONE (so the ⌃⌥ dictation chord, which also holds Option, never counts).
        if m == [.option] && !optWasDown {
            optWasDown = true
            onOptTap()
        } else if m.isEmpty {
            optWasDown = false
        } else {
            optWasDown = m.contains(.option)
        }
    }

    // Talk-chord detection ONLY — no summon (⌃⌃) / launcher (⌥⌥) double-tap logic. Our own key panels
    // (⌥⌥ launcher, guide feedback field) forward flagsChanged HERE, not to the full onFlags: while such a
    // panel is key the app is often inactive, so routing the ⌃ inside ⌃⌥ through onFlags's summon detector
    // misreads it as a ⌃⌃ tap and spawns God instead of dictating. This starts a dictation on the exact talk
    // chord and does nothing else; if the global onFlags also fires the same chord, its top-of-func
    // `if dictating` guard short-circuits, so there's no double-start.
    @MainActor private func startDictationOnTalkChord(_ flags: NSEvent.ModifierFlags) {
        guard !dictating else { return }
        let talk = chordFlags(model.shortcuts.talk)
        let m = flags.intersection([.control, .option, .command, .shift])
        if !talk.isEmpty && m == talk { onboard.lastDictate = Date(); startDictation() }
    }

    // ── ⌃⌥ dictation: record → whisper.cpp (raw, on-device) → paste at cursor. No God, no LLM cleanup —
    //    a pure Wispr-Flow-style dictation gesture folded in as God's sibling. ─────────────────────────
    private func whisperCliPath() -> String? {
        // The whisper.cpp we ship (Resources/stt) wins so ⌃⌥ dictation works with zero user setup; then Homebrew.
        let bundled = ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("stt/whisper-cli")
        return [bundled, "/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli", "/opt/homebrew/bin/whisper-cpp", "/usr/local/bin/whisper-cpp"].first { FileManager.default.fileExists(atPath: $0) }
    }
    private func whisperModelPath() -> String? {
        // The bundled tiny model wins; else a user-installed model in ~/.relay/models.
        let bundled = ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("stt/ggml-tiny.en.bin")
        if FileManager.default.fileExists(atPath: bundled) { return bundled }
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/models")
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return nil }
        // Prefer an English base model, else any ggml .bin.
        let pick = files.first { $0.hasSuffix(".bin") && $0.contains("base.en") } ?? files.first { $0.hasSuffix(".bin") && $0.contains("ggml") }
        return pick.map { (dir as NSString).appendingPathComponent($0) }
    }
    // The dictation DICTIONARY: the user's vocabulary (names/jargon/product terms), fed to whisper.cpp
    // as its --prompt so it stops mangling them. Same file the daemon seeds + reads (~/.relay/dictionary.txt);
    // here we only READ it. Strip '#' comments, join terms, cap to ~800 chars (whisper's ~224-token budget).
    private func dictationPrompt() -> String? {
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/dictionary.txt")
        guard let raw = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        let terms = raw.split(separator: "\n", omittingEmptySubsequences: true)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("#") }
            .joined(separator: ",")
            .split(whereSeparator: { $0 == "," || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        var s = terms.joined(separator: ", ")
        if s.count > 800 { s = String(s.prefix(800)) }
        return s.isEmpty ? nil : s
    }

    @MainActor private func startDictation() {
        guard !godRunning, !godListening else { return }   // don't collide with a God summon
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { refreshPermissionGate(); return }
        guard whisperCliPath() != nil, whisperModelPath() != nil else { toast("Dictation needs whisper.cpp — brew install whisper-cpp + a ggml model in ~/.relay/models"); return }
        CursorGuide.shared.noteEvent("dictation")   // a guide's ⌃⌥ step advances the moment you dictate
        // Paint the pill FIRST. AVAudioRecorder init + record() synchronously blocks the main thread while
        // the mic hardware + TCC client cold-activate (~100–300ms), so if we set it up before showing the
        // status the "Dictating" pill can't paint until this func returns and feels laggy. Flip the state and
        // show the pill now, then defer the blocking recorder setup to the next runloop tick so the pill
        // actually paints in between.
        dictating = true
        dictateCommitting = false
        NSSound(named: "Tink")?.play()
        showGodStatus("Dictating", accent: .lime, pattern: .listening)
        onboard.note(.dictation)   // tour step 3: ⌃⌥ dictation fired
        // LATCH mode: the recording now stays on after the keys lift. Hand the commit/cancel/find lifecycle
        // to a poll timer (⌃ tap commits, Esc cancels, Fn arms find). Seed the ctrl edge-detector to the
        // CURRENT state — ctrl is DOWN right now because the talk chord holds it, and we must not read that
        // held-through ctrl as an instant commit; only a fresh ⌃ press AFTER release counts.
        if model.shortcuts.dictationMode == "latch" {
            dictateLatched = true
            dictateFindArmed = NSEvent.modifierFlags.contains(.function)
            dictatePrevCtrlDown = NSEvent.modifierFlags.contains(.control)
            startDictateWatch()
        }
        let wav = NSTemporaryDirectory() + "god-dictate.wav"
        try? FileManager.default.removeItem(atPath: wav)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM), AVSampleRateKey: 16000.0, AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
        ]
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            // The user may have released ⌃⌥ (hold mode) or aborted before this tick ran — finish/cancel
            // already flipped `dictating` false (and hid the pill). Don't spin up a recorder we'd abandon.
            guard self.dictating else { return }
            do {
                let rec = try AVAudioRecorder(url: URL(fileURLWithPath: wav), settings: settings)
                guard rec.record() else { self.dictating = false; self.dictateLatched = false; self.stopDictateWatch(); self.hideGodStatus(); godLog("dictation record() returned false"); return }
                self.dictateRecorder = rec; self.dictateWav = wav
            } catch { self.dictating = false; self.dictateLatched = false; self.stopDictateWatch(); self.hideGodStatus(); godLog("dictation record failed: \(error.localizedDescription)") }
        }
    }

    // ── Latched-dictation watch: a ~60fps poll (all FREE reads — no Input-Monitoring TCC) that owns the
    //    commit / cancel / find lifecycle once recording is latched on. Mirrors God's captureFnTimer Esc
    //    failsafe so a latched take can NEVER wedge the global shortcut: Esc always aborts. ──────────────
    @MainActor private func startDictateWatch() {
        stopDictateWatch()
        dictateWatchTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.dictateLatched, !self.dictateCommitting else { return }
                // Esc → abort cleanly (key 53). The manual failsafe always wins, from any state.
                if CGEventSource.keyState(.combinedSessionState, key: 53) { self.cancelDictation(); return }
                // Fn arms FIND for this take — reflect it live in the pill so the user sees the mode change.
                let fn = NSEvent.modifierFlags.contains(.function)
                if fn != self.dictateFindArmed {
                    self.dictateFindArmed = fn
                    self.showGodStatus(fn ? "Dictating · Find" : "Dictating", accent: .lime, pattern: .listening)
                }
                // ⌃ rising edge → COMMIT (stop + transcribe + act). The summon modifier IS the commit key,
                // per the founder's "transcribe when ctrl is pressed"; while latched it commits instead of
                // summoning God (onFlags is short-circuited by the `dictating` guard).
                let ctrlDown = NSEvent.modifierFlags.contains(.control)
                if ctrlDown && !self.dictatePrevCtrlDown {
                    self.dictatePrevCtrlDown = ctrlDown
                    self.finishDictation(find: self.dictateFindArmed)
                    return
                }
                self.dictatePrevCtrlDown = ctrlDown
            }
        }
    }
    @MainActor private func stopDictateWatch() { dictateWatchTimer?.invalidate(); dictateWatchTimer = nil }

    // Abort: stop recording, discard the clip, paint nothing. Reachable from any state (Esc / failsafe).
    @MainActor private func cancelDictation() {
        guard dictating || dictateLatched else { return }
        stopDictateWatch()
        dictating = false; dictateLatched = false; dictateCommitting = false
        dictateRecorder?.stop(); dictateRecorder = nil
        if let wav = dictateWav { try? FileManager.default.removeItem(atPath: wav) }
        dictateWav = nil
        NSSound(named: "Bottle")?.play()
        hideGodStatus()
    }

    // Commit: stop recording, transcribe (whisper.cpp, off-main), then ROUTE the transcript:
    //   • guide capturing feedback → attach as the step note (unchanged legacy behavior)
    //   • find == true            → daemon vault.find lookup, paste the returned VALUE (no LLM, ever)
    //   • otherwise               → paste the raw transcript at the cursor (today's behavior)
    // Used by BOTH modes: hold mode calls finishDictation(find:false) on key release; latch mode calls it
    // from the watch timer on a ⌃ commit (find = whether Fn was held).
    @MainActor private func finishDictation(find: Bool) {
        guard dictating, !dictateCommitting else { return }
        dictateCommitting = true
        stopDictateWatch()
        dictating = false; dictateLatched = false
        dictateRecorder?.stop(); dictateRecorder = nil
        NSSound(named: "Pop")?.play()
        showGodStatus(find ? "Finding" : "Transcribing", accent: .lime, pattern: .thinking)
        guard let wav = dictateWav, let wc = whisperCliPath(), let model = whisperModelPath() else { hideGodStatus(); dictateCommitting = false; return }
        // Transcribe off the main thread (whisper.cpp is ~0.5s warm), then act on the main actor.
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process(); p.executableURL = URL(fileURLWithPath: wc)
            var whisperArgs = ["-m", model, "-f", wav, "-nt", "-np"]
            if let dict = self.dictationPrompt() { whisperArgs += ["--prompt", dict, "--carry-initial-prompt"] }
            p.arguments = whisperArgs
            let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
            try? p.run(); p.waitUntilExit()
            let data = out.fileHandleForReading.readDataToEndOfFile()
            let text = (String(data: data, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            Task { @MainActor in
                if CursorGuide.shared.capturingFeedback {
                    // A guide is capturing feedback → the transcript is the step's NOTE, not a paste/find.
                    self.hideGodStatus()
                    CursorGuide.shared.attachFeedbackNote(text, append: true)
                    self.feedbackNote = (self.feedbackNote.isEmpty ? text : self.feedbackNote + " " + text)
                    if let scr = self.statusItem?.button?.window?.screen ?? NSScreen.main { self.rebuildFeedbackPanel(scr) }  // reflect it in the field
                    self.dictateCommitting = false
                } else if find {
                    self.vaultFindAndPaste(text)   // hides status + clears dictateCommitting when it returns
                } else {
                    self.hideGodStatus()
                    self.pasteText(text)
                    self.dictateCommitting = false
                }
            }
        }
    }

    // FIND mode: hand the transcript to the daemon's LOCAL vault lookup (vault.find) — never a model /
    // Claude call — and paste the returned VALUE at the cursor. `null` → a brief "no match", paste nothing.
    // Reuses the app's EXISTING daemon channel (the paired ConsentClient websocket on PORT); no new socket,
    // no network. Contract: request `{action:"vault.find", args:{query, project?}}` →
    // result `{value, field, entity, source, confidence} | null`.
    @MainActor private func vaultFindAndPaste(_ query: String) {
        guard !query.isEmpty else { hideGodStatus(); dictateCommitting = false; return }
        guard let consent else { toast("Dictation find needs the daemon — is Switchboard paired?"); hideGodStatus(); dictateCommitting = false; return }
        var args: [String: Any] = ["query": query]
        if let proj = readDefaultId(), !proj.isEmpty { args["project"] = proj }   // the panel's active project (SELECTION_FILE)
        consent.request(action: "vault.find", args: args, timeout: 6.0) { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                self.hideGodStatus()
                self.dictateCommitting = false
                // null (or a shape we can't read) → no match. Paste nothing; a brief, honest toast.
                guard let obj = result as? [String: Any], let value = obj["value"] as? String, !value.isEmpty else {
                    NSSound(named: "Bottle")?.play(); self.toast("No match for “\(query)”"); return
                }
                self.pasteText(value)
            }
        }
    }

    // Put text on the clipboard and paste it at the current focus (⌘V). Raw text — no model cleanup,
    // which is the point of the dictation gesture (and, in find mode, the exact stored value).
    @MainActor private func pasteText(_ text: String) {
        guard !text.isEmpty else { return }
        voiceBuffer = text   // remember the last dictation for the on-demand re-paste (⌥V, once bound)
        // Our own non-activating key panels (the ⌥⌥ launcher's Ask field, notch web widgets) can be TYPED
        // into — key events route to the key window's field editor — but they do NOT accept a synthetic ⌘V:
        // the app isn't active, so paste:/the Edit menu never reach that field (manual copy/paste is dead
        // there too). So DON'T paste — insert straight into the focused field editor, the same path typing
        // uses, which updates the SwiftUI binding. Guide feedback never reaches here (finishDictation writes
        // it directly into feedbackNote).
        if let w = NSApp.keyWindow as? LauncherPanel, let tv = w.firstResponder as? NSTextView {
            tv.insertText(text, replacementRange: tv.selectedRange())
            return
        }
        // Otherwise God is dictating at the cursor of ANOTHER app (we're not active) — deliver by a clipboard
        // paste, but do it WITHOUT clobbering the user's own clipboard (founder 2026-08-26).
        pasteAtCursorPreservingClipboard(text)
    }

    /// The reliable, non-clobbering paste: stash the user's clipboard, put `text` on it, synth ⌘V, then restore
    /// the clipboard on the next runloop beat (after the paste is consumed). So dictation auto-insert (and the
    /// on-demand ⌥V re-paste) drop text at the cursor WITHOUT touching the user's ⌘C/⌘V clipboard.
    @MainActor private func pasteAtCursorPreservingClipboard(_ text: String) {
        guard !text.isEmpty else { return }
        let pb = NSPasteboard.general
        let saved = pb.string(forType: .string)          // preserve the user's clipboard
        pb.clearContents(); pb.setString(text, forType: .string)
        synthCmdV()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            pb.clearContents(); if let s = saved { pb.setString(s, forType: .string) }
        }
    }

    /// Synthesize ⌘V via CGEvent — needs only Accessibility (already granted for the guide key tap), unlike the
    /// old osascript "System Events keystroke v", which needs a SEPARATE Automation grant that, when missing,
    /// silently no-ops → the transcript just sat on the clipboard and auto-insert appeared broken.
    @MainActor private func synthCmdV() {
        let src = CGEventSource(stateID: .combinedSessionState)
        let v: CGKeyCode = 9   // 'v'
        let down = CGEvent(keyboardEventSource: src, virtualKey: v, keyDown: true);  down?.flags = .maskCommand
        let up   = CGEvent(keyboardEventSource: src, virtualKey: v, keyDown: false); up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap); up?.post(tap: .cghidEventTap)
    }

    private var voicePasteHotKey: EventHotKeyRef?

    /// Register ⌥V as a GLOBAL hotkey that re-pastes the last dictation at the cursor. RegisterEventHotKey
    /// (Carbon) CONSUMES the key, so ⌥V doesn't type "√" while Switchboard runs. The C handler can't capture
    /// self → it reaches the controller via NSApp.delegate. Founder pick 2026-08-26 (⌥V — no ⌘B/bold clash).
    @MainActor private func installVoicePasteHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, _) -> OSStatus in
            DispatchQueue.main.async { MainActor.assumeIsolated { (NSApp.delegate as? RelayController)?.pasteVoiceBuffer() } }
            return noErr
        }, 1, &spec, nil, nil)
        let hkID = EventHotKeyID(signature: OSType(0x52565042), id: 1)   // 'RVPB'
        RegisterEventHotKey(UInt32(kVK_ANSI_V), UInt32(optionKey), hkID, GetApplicationEventTarget(), 0, &voicePasteHotKey)
    }

    /// ⌥V pressed → drop the last dictation at the cursor (clipboard-preserving). Empty buffer → a short blip.
    @MainActor func pasteVoiceBuffer() {
        guard !voiceBuffer.isEmpty else { NSSound(named: "Bottle")?.play(); return }
        pasteAtCursorPreservingClipboard(voiceBuffer)
    }

    // The gesture grammar: ⌃⌃ (idle) → start listening · single ⌃ (listening) → stop + act ·
    // single ⌃ (running) → cancel. One key drives the whole loop.
    @MainActor private func onCtrlTap() {
        if godListening { stopListeningAndAct() }
        else if godRunning { cancelGod() }
        else {
            let now = Date()
            if let last = lastCtrlTap, now.timeIntervalSince(last) < 0.5 { lastCtrlTap = nil; onboard.lastSummon = Date(); startListening() }
            else { lastCtrlTap = now }
        }
    }

    // ⌃⌃ → record the mic IN-PROCESS via AVAudioRecorder. This is the whole reason Switchboard can
    // appear in System Settings → Privacy → Microphone: TCC lists the process that actually opens the
    // device, and now that's THIS app — not an external ffmpeg it used to shell out to. If the mic
    // isn't authorized yet we surface the permission card and fall back to a silent look (never spin a
    // recorder we can't use, and never block the main actor). 16 kHz mono PCM WAV = what the daemon's
    // transcribe wants.
    @MainActor private func startListening() {
        godLog("⌃⌃ → listening")
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        if status == .notDetermined {
            // First ask: request now (needs NSMicrophoneUsageDescription); on grant, start listening.
            AVCaptureDevice.requestAccess(for: .audio) { granted in Task { @MainActor in
                self.refreshPermissionGate()
                if granted { self.startListening() } else { self.triggerGod(at: NSEvent.mouseLocation, forceFullScreen: true) }
            } }
            return
        }
        guard status == .authorized else {
            godLog("mic not authorized — looking without voice"); refreshPermissionGate(); triggerGod(at: NSEvent.mouseLocation, forceFullScreen: true); return
        }
        let wav = NSTemporaryDirectory() + "god-rec.wav"
        try? FileManager.default.removeItem(atPath: wav)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM), AVSampleRateKey: 16000.0, AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
        ]
        do {
            let rec = try AVAudioRecorder(url: URL(fileURLWithPath: wav), settings: settings)
            guard rec.record() else { throw NSError(domain: "god", code: 1, userInfo: [NSLocalizedDescriptionKey: "record() returned false"]) }
            NSSound(named: "Tink")?.play()
            recorder = rec; recWav = wav; godListening = true; setGlow(.listening)
            // Snapshot the share mode NOW so a mid-turn Settings toggle can't change what this in-flight turn sees.
            shareScreenThisTurn = readDefaultShare()
            installCaptureGestureMonitors()   // pointer stays free; fn+click = full/toggle, fn+drag = region, drag a file = reference
            showNotchDropZone()               // the full notch becomes a file-drop target while you talk
            captureClipboardOffer()           // if the clipboard holds text, offer it as an addable chip (opt-in)
            // Default-share ON → the whole screen is shared the moment you start talking (a "Whole screen" chip
            // is visible the entire time = the honest "my screen is shared now" signal). fn+click then TOGGLES it.
            if shareScreenThisTurn { stageAutoScreen() }
        } catch {
            godLog("mic capture failed: \(error.localizedDescription) — looking without voice")
            godListening = false; triggerGod(at: NSEvent.mouseLocation, forceFullScreen: true)
        }
    }

    // single ⌃ while listening → stop the mic, then run God on what you said. AVAudioRecorder.stop()
    // finalizes the file synchronously and does NOT block on any external process — the freeze that
    // came from waiting on ffmpeg is gone with ffmpeg itself.
    @MainActor private func stopListeningAndAct() {
        godListening = false
        NSSound(named: "Pop")?.play()
        recorder?.stop(); recorder = nil
        // What God sees is now EXPLICIT: only an fn grab shares the screen, and each grab is already a
        // staged screenshot ref (godRefs). A plain ⌃⌃ (no gesture, no drop) is voice-only — spawnGod reads
        // godRefs for screens+files, so nothing to pass here beyond the clip.
        hideRegionOverlay(); hideNotchDropZone()
        triggerGod(at: NSEvent.mouseLocation, audio: recWav)
    }

    // single ⌃ while God works → abort the loop. Must fully reset EVERY moving part (recorder, child
    // process, timers, glow, pending consent) so a cancel can never leave a stuck process or state.
    @MainActor private func cancelGod() {
        godLog("cancelled")
        NSSound(named: "Pop")?.play()
        hideRegionOverlay(); hideNotchDropZone()
        recorder?.stop(); recorder = nil; godListening = false
        godProc?.terminate(); godProc = nil
        godStateTimer?.invalidate()
        godConsentPending = false
        actionPanel?.orderOut(nil)
        clearGodRefs()   // a cancel drops the staged references too
        godRunning = false; glowModel.target = nil; setGlow(.idle)
    }

    // After a run, if God held back a risky action, ask for a yes in the notch (the consent drop).
    @MainActor private func checkPendingAction() {
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-action.json")
        guard let data = FileManager.default.contents(atPath: path),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        try? FileManager.default.removeItem(atPath: path)
        // Driving an installed wrapp needs NO per-action consent — installing it WAS the consent
        // (docs/GOD-HANDS.md #1); it runs straight into the notch. The wrapp's own write-class actions
        // still hit the daemon gate. Only local hands God held a key for / risky actions keep the drop.
        // A fill-guide rides the same lane: the user ASKED for it, and the guide itself is the consent
        // surface — every value is visible per step, pasted by the user's own hand, esc aborts.
        let kind = json["kind"] as? String
        if kind == "drive" || kind == "fillguide" { executeGodAction(json); return }
        showActionConsent(json["describe"] as? String ?? "do something", json)
    }

    // LOCAL hand (open/type/click/key): god.mjs handed off the action and EXITED — Swift executes it
    // here on Allow.
    @MainActor private func showActionConsent(_ describe: String, _ action: [String: Any]) {
        presentConsentDrop(ActionConsentDrop(describe: describe,
            onAllow: { [weak self] in self?.executeGodAction(action); self?.actionPanel?.orderOut(nil) },
            onDeny: { [weak self] in self?.actionPanel?.orderOut(nil) }))
    }

    // RUN hand: god.mjs is STILL ALIVE and will run the tool itself. It wrote the proposed call to
    // ~/.relay/god-run.json and flipped state → "consent"; we render the same drop and write the
    // decision to ~/.relay/god-consent.json, which god.mjs is polling for.
    @MainActor private func showRunConsent() {
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-run.json")
        guard let data = FileManager.default.contents(atPath: path),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { godConsentPending = false; return }
        let describe = json["describe"] as? String ?? "run a tool"
        presentConsentDrop(ActionConsentDrop(describe: describe,
            onAllow: { [weak self] in self?.writeGodConsent(true) },
            onDeny: { [weak self] in self?.writeGodConsent(false) }))
    }

    // Hand the RUN decision back to the waiting god.mjs. It executes (or not) and speaks the result.
    @MainActor private func writeGodConsent(_ allow: Bool) {
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-consent.json")
        try? Data("{\"allow\":\(allow)}".utf8).write(to: URL(fileURLWithPath: path))
        actionPanel?.orderOut(nil)
        godConsentPending = false
    }

    // Shared notch-drop presentation — one anchored surface for both hands, so consent always looks
    // like the rest of the notch UI (top-center, fade-in), never a stray pill.
    @MainActor private func presentConsentDrop(_ view: ActionConsentDrop) {
        if actionPanel == nil {
            actionPanel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            actionPanel.isOpaque = false; actionPanel.backgroundColor = .clear; actionPanel.hasShadow = false
            actionPanel.level = .popUpMenu; actionPanel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        }
        actionPanel.contentView = NoInsetHostingView(rootView: view)
        let size = actionPanel.contentView!.fittingSize
        actionPanel.setContentSize(size)
        if let screen = statusItem?.button?.window?.screen ?? NSScreen.main {
            actionPanel.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        }
        presentFromNotch(actionPanel)
    }

    // The gated execution — reached ONLY after the human tapped Allow.
    @MainActor private func executeGodAction(_ a: [String: Any]) {
        switch a["kind"] as? String {
        case "drive":
            // The VOICE wire: "make me a gist of this" → god.mjs emits [DRIVE:<wrapp> <input>] →
            // consent Allow lands here → the widget grows from the notch while the wrapp runs.
            let id = (a["wrapp"] as? String ?? "").lowercased()
            let input = a["input"] as? String
            if let l = readCatalog().first(where: { $0.id == id }) {
                // A THIRD-PARTY MCP tool runs headless straight through the daemon gate (no page, no skill);
                // a skill runs its SKILL.md headless; a wrapp drives its page. Same split as the picker.
                if let binding = l.mcp {
                    driveThirdPartyTool(l, binding, command: a["command"] as? String, input: input)
                } else if resolveSkillContent(l) != nil {
                    driveSkillHeadless(l, input: input)
                } else if let s = l.components.ui?.url, let base = URL(string: s) {
                    // The command God picked (registry), else the wrapp's single registered tool, else the
                    // <id>_run guess — listTools discovery corrects it either way, but this starts right.
                    let cmd = (a["command"] as? String) ?? l.tools?.first?.name ?? "\(id)_run"
                    // Image-to-image: if the wrapp's tool declares a `reference` param AND the user made an
                    // explicit fn capture this ⌃⌃ (a deliberate "make an image like THIS"), attach that grab.
                    let wantsRef = (l.tools?.first(where: { $0.name == cmd })?.inputSchema?["reference"]) != nil
                    let ref = (wantsRef && godRefs.contains { $0.kind == .screenshot }) ? lastCaptureAsDataURL() : nil
                    driveWrappLive(pageURL: resolveDriveURL(tool: cmd, fallback: base), tool: cmd, input: input, wrappName: l.name, reference: ref)
                } else {
                    showNotchWidget(WidgetSpec(kicker: "GOD · DRIVE", title: "Can't run “\(id)”", openLabel: "Open store",
                        result: .text("“\(l.name)” has neither a page nor a skill body to run.")),
                        onOpen: { [weak self] in self?.hideNotchWidget(); self?.showStore() })
                }
            } else {
                showNotchWidget(WidgetSpec(kicker: "GOD · DRIVE", title: "No wrapp “\(id)”", openLabel: "Open store",
                    result: .text("God asked to drive “\(id)” but it isn't in the catalog. Install it from the store first.")),
                    onOpen: { [weak self] in self?.hideNotchWidget(); self?.showStore() })
            }
        case "fillguide":
            // God mapped the form's fields to values ([FILLGUIDE] tag — docs/FORM-FILL.md upgrade path):
            // raise the native teach fill-guide. Values ride the clipboard one step at a time, the USER
            // pastes each; nothing is typed into the form by us. god.mjs normalizes fields to
            // [{label, value}] before the handoff, so that's the only shape read here.
            var pairs: [(label: String, value: String)] = []
            for o in (a["fields"] as? [[String: Any]] ?? []) {
                if let l = (o["label"] as? String)?.trimmingCharacters(in: .whitespaces),
                   let v = (o["value"] as? String)?.trimmingCharacters(in: .whitespaces),
                   !l.isEmpty, !v.isEmpty { pairs.append((l, v)) }
            }
            if pairs.isEmpty {
                godLog("executeGodAction: fillguide with no usable fields — \(a)")
                showNotchWidget(WidgetSpec(kicker: "GOD · FILL", title: "Nothing to fill", openLabel: "Open panel",
                    result: .text("God proposed a form-fill guide but no field→value pairs survived parsing — nothing was raised.")),
                    onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
            } else {
                raiseFillGuide(pairs, source: "God")
            }
        case "open":
            // DWIM like god.mjs's openArgs: URL/scheme → open it; path → open the file; else it's an
            // APP NAME and needs `-a` (bare `open Calendar` looks for a file, not the app, and no-ops).
            if let t = (a["target"] as? String)?.trimmingCharacters(in: .whitespaces) {
                let isURL = t.range(of: "^[a-z][a-z0-9+.-]*://", options: [.regularExpression, .caseInsensitive]) != nil
                    || t.range(of: "^(mailto|tel|facetime|sms):", options: [.regularExpression, .caseInsensitive]) != nil
                let isPath = t.hasPrefix("/") || t.hasPrefix("~") || t.hasPrefix(".")
                let args = (isURL || isPath) ? [t] : ["-a", t]
                let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/open"); p.arguments = args; try? p.run()
            }
        case "type":
            if let text = a["text"] as? String {
                let esc = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
                let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
                p.arguments = ["-e", "tell application \"System Events\" to keystroke \"\(esc)\""]; try? p.run()
            }
        case "click":
            if let x = (a["x"] as? NSNumber)?.doubleValue, let y = (a["y"] as? NSNumber)?.doubleValue,
               let w = (a["shotW"] as? NSNumber)?.doubleValue, let h = (a["shotH"] as? NSNumber)?.doubleValue,
               let screen = NSScreen.main,
               let cli = ["/opt/homebrew/bin/cliclick", "/usr/local/bin/cliclick"].first(where: { FileManager.default.fileExists(atPath: $0) }) {
                let sx = Int(x / w * screen.frame.width), sy = Int(y / h * screen.frame.height)
                let p = Process(); p.executableURL = URL(fileURLWithPath: cli); p.arguments = ["c:\(sx),\(sy)"]; try? p.run()
            }
        case "key":
            // A key combo ("cmd+s", "return") — only reaches Swift when a KEY was held for the gate
            // (a risky combo); the common case auto-runs inside god.mjs. Mirrors god.mjs keyComboOsa.
            if let combo = a["combo"] as? String, let osa = Self.keyComboOsa(combo) {
                let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript"); p.arguments = ["-e", osa]; try? p.run()
            }
        default:
            // NEVER silently swallow an Allow. A missing/unknown kind (a stale god-action.json, an action
            // shape this build doesn't handle) used to hit `break` and do nothing — the "clicked Allow,
            // nothing happened" bug. Surface it in the notch so the moment is always legible.
            let kind = (a["kind"] as? String) ?? "—"
            let what = (a["describe"] as? String) ?? "an action I don't recognize"
            godLog("executeGodAction: unhandled action kind '\(kind)' — \(a)")
            showNotchWidget(WidgetSpec(kicker: "GOD · ACTION", title: "Couldn't run that", openLabel: "Open panel",
                result: .text("God proposed “\(what)” (kind: \(kind)), but this build has no handler for it — nothing was done. If this keeps happening, the action God emitted and the app got out of sync.")),
                onOpen: { [weak self] in self?.hideNotchWidget(); self?.showPanel() })
        }
    }

    // Combo → System Events osascript. Modifiers map to `using {… down}`; named keys → `key code`,
    // single chars → `keystroke`. Kept in lockstep with god.mjs's keyComboOsa (same tables).
    static func keyComboOsa(_ combo: String) -> String? {
        let codes: [String: Int] = ["return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126]
        let mods: [String: String] = ["cmd": "command down", "command": "command down", "ctrl": "control down", "control": "control down", "opt": "option down", "option": "option down", "alt": "option down", "shift": "shift down"]
        let parts = combo.lowercased().split(whereSeparator: { $0 == "+" || $0 == " " }).map(String.init).filter { !$0.isEmpty }
        let usedMods = parts.compactMap { mods[$0] }
        guard let key = parts.first(where: { mods[$0] == nil }) else { return nil }
        let using = usedMods.isEmpty ? "" : " using {\(usedMods.joined(separator: ", "))}"
        let press = codes[key].map { "key code \($0)" } ?? "keystroke \"\(key)\""
        return "tell application \"System Events\" to \(press)\(using)"
    }

    // The GOD seam. This is where the native flow lands: ScreenCaptureKit screenshot → daemon
    // `claude_complete` (+vision, +persona) → parse `[POINT:x,y:label]` → overlay-cursor companion +
    // voice. `at` is where the user ⌃⌥-clicked — the focus point God reasons about. Until that native
    // slice ships, summon the panel so the gesture is live end-to-end and the wiring (permission →
    // global click → handler) is proven. Every write it eventually makes still goes through the gate.
    // `preselected` carries the region/full the drag overlay committed during listening (nil = whole
    // screen). The overlay itself lives in the listening flow now, so this just captures + spawns.
    @MainActor private func triggerGod(at point: CGPoint? = nil, audio: String? = nil, instruction: String? = nil, skill: String? = nil, sessionOverride: String? = nil, forceFullScreen: Bool = false) {
        guard !godRunning else { return }   // one loop at a time — a held ⌃⌥ doesn't stack
        CursorGuide.shared.noteEvent("summon")   // a guide's ⌃⌃ step advances the moment you actually summon
        lastGodAudio = audio   // remembered so a mid-run project switch can re-run this turn (staged refs persist)
        if let p = point, let screen = NSScreen.main {
            glowModel.target = CGPoint(x: p.x - screen.frame.minX, y: screen.frame.maxY - p.y)
        }
        guard let node = nodePath(), let god = godClientPath() else {
            godLog("triggerGod: node or god.mjs NOT FOUND — opening panel instead")
            glowModel.target = nil
            if !panel.isVisible { openedByHover = false; showPanel() }
            return
        }
        godRunning = true
        // Screenshots ride as STAGED refs (each fn-grab was already captured to disk); nothing to capture here.
        spawnGod(point: point, audio: audio, instruction: instruction, node: node, god: god, skill: skill, sessionOverride: sessionOverride, forceFullScreen: forceFullScreen)
    }

    // The screenshot God reasons over: whole screen (with cursor), or just the dragged region (-R x,y,w,h).
    @MainActor private func captureShot(_ pick: RegionPick, to shot: String) {
        let cap = Process(); cap.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        if case .region(let r) = pick {
            cap.arguments = ["-x", "-R", "\(Int(r.origin.x)),\(Int(r.origin.y)),\(Int(r.width)),\(Int(r.height))", "-t", "jpg", shot]
        } else {
            cap.arguments = ["-x", "-C", "-t", "jpg", shot]   // .full (cursor included)
        }
        try? cap.run(); cap.waitUntilExit()
    }

    // The proven pipeline: hand god.mjs the staged references (GOD_IMAGES screenshots + GOD_FILES) → vision+
    // persona → speak; poll god-state for the notch phase; gate every write. Screens+files come from godRefs.
    @MainActor private func spawnGod(point: CGPoint?, audio: String?, instruction: String?, node: String, god: String, skill: String? = nil, sessionOverride: String? = nil, forceFullScreen: Bool = false) {
        pointMarkPinned = false; pointMarkPinTimer?.invalidate(); pointMarkPinTimer = nil   // a new run supersedes any pinned afterglow from the last one
        setGlow(.thinking)
        godStateTimer?.invalidate()
        godStateTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.readGodState() }
        }
        // Screenshots = the staged fn-grabs (already on disk). None + a path that FORCES a screen (no-mic
        // fallback, skill launch) → one live full-screen shot now. Files = the staged drops.
        var shotPaths = godRefs.filter { $0.kind == .screenshot }.map { $0.path }.filter { FileManager.default.fileExists(atPath: $0) }
        if shotPaths.isEmpty && forceFullScreen {
            let shot = NSTemporaryDirectory() + "god-shot.jpg"
            try? FileManager.default.removeItem(atPath: shot)
            captureShot(.full, to: shot)
            if FileManager.default.fileExists(atPath: shot) { shotPaths = [shot] }
        }
        let filePaths = godRefs.filter { $0.kind == .file }.map { $0.path }.filter { FileManager.default.fileExists(atPath: $0) }
        godLog("spawnGod: \(shotPaths.count) screenshot(s), \(filePaths.count) file(s) spawning \(node) \(god)")
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: node)
        let ask = instruction ?? "If there's one obvious way you could help me right now, offer it in a short question (\"Want me to …?\"); otherwise stay quiet. Don't describe my screen back to me."
        proc.arguments = [god, "act", ask]
        proc.currentDirectoryURL = URL(fileURLWithPath: (god as NSString).deletingLastPathComponent)
        var env = ProcessInfo.processInfo.environment
        env["GOD_ATTACH"] = "1"
        env["GOD_AUTONOMY"] = "auto"
        // Warm-thread override: a normal ⌃⌃ rides the persistent "god-native" session (God remembers across
        // presses). But a project-switch RE-RUN of an in-flight turn must NOT continue that thread — if the
        // first attempt already reached the model, resuming would show it the same ask twice. So the re-run
        // passes a fresh GOD_SESSION → the daemon mints a clean SDK session for it (server.ts completionSessions).
        if let s = sessionOverride, !s.isEmpty { env["GOD_SESSION"] = s }
        // Screens: one OR MORE grabbed screenshots (GOD_IMAGES, newline-separated; GOD_IMAGE = first, for
        // back-compat). None → GOD_NO_SCREEN, a voice-only turn (a plain ⌃⌃ with no fn-grab).
        if let first = shotPaths.first {
            env["GOD_IMAGE"] = first
            env["GOD_IMAGES"] = shotPaths.joined(separator: "\n")
        } else {
            env["GOD_NO_SCREEN"] = "1"
        }
        if let audio = audio { env["GOD_AUDIO"] = audio }
        // A wrapp's skill worn inline: write the resolved skill body to a temp file and hand god.mjs the
        // path (GOD_SKILL). god.mjs folds it into the system prompt so God can actually DO the skill in
        // conversation — not just open the wrapp's page. (docs/GOD-HANDS.md, the "wrapp = skill" path.)
        if let skill = skill, !skill.isEmpty {
            let skillFile = NSTemporaryDirectory() + "god-skill.md"
            if (try? skill.write(toFile: skillFile, atomically: true, encoding: .utf8)) != nil {
                env["GOD_SKILL"] = skillFile
            }
        }
        // Files the user attached for God (the file analog of the screenshot): GOD_FILES (newline-separated;
        // GOD_FILE = first, back-compat). god.mjs inlines text/PDF/doc/xlsx as untrusted reference data, SEES
        // images. NOT cleared here — a project-switch re-run reuses them; they clear when the turn goes idle.
        // The opt-in clipboard the user ADDED rides the SAME path (a temp clipboard.txt) so god.mjs folds it
        // in as untrusted reference today; GOD_CLIPBOARD also names it — the same temp-file+env mechanism as
        // GOD_FILE, not a new IPC. Only present when the user tapped Add (never auto-attached).
        let clipPaths = godRefs.filter { $0.kind == .clipboard }.map { $0.path }.filter { FileManager.default.fileExists(atPath: $0) }
        let attachPaths = filePaths + clipPaths
        if let first = attachPaths.first {
            env["GOD_FILE"] = filePaths.first ?? first
            env["GOD_FILES"] = attachPaths.joined(separator: "\n")
            godLog("spawnGod: attaching \(filePaths.count) file(s)\(clipPaths.isEmpty ? "" : " + clipboard")")
        }
        if let clip = clipPaths.first { env["GOD_CLIPBOARD"] = clip }
        if let p = point, let screen = NSScreen.main, screen.frame.width > 0, screen.frame.height > 0 {
            let fx = (p.x - screen.frame.minX) / screen.frame.width
            let fy = (screen.frame.maxY - p.y) / screen.frame.height
            env["GOD_POINT"] = String(format: "%.4f,%.4f", fx, fy)
        }
        env["PATH"] = "\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        proc.environment = env
        let runLog = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-run.log")
        FileManager.default.createFile(atPath: runLog, contents: nil)
        if let fh = FileHandle(forWritingAtPath: runLog) { proc.standardOutput = fh; proc.standardError = fh }
        proc.terminationHandler = { [weak self] p in Task { @MainActor in
            // A newer run may have replaced us (e.g. a mid-run project switch cancelled this one and
            // re-triggered). If so, THIS stale process's exit must NOT reset the live run — otherwise it
            // shuts the notch out from under it. Only the current process's termination cleans up.
            guard let self, self.godProc === p else { return }
            self.godProc = nil; self.godStateTimer?.invalidate(); self.godRunning = false
            self.clearGodRefs()   // the turn consumed them — don't let a screenshot/file leak into the next ⌃⌥ dictation
            // Don't nil the target here: a just-read model point would be wiped before it's drawn. setGlow(.idle)
            // is authoritative — it keeps a PINNED mark up briefly, otherwise tears the ring down.
            self.setGlow(.idle); self.checkPendingAction()
        } }
        godProc = proc
        do { try proc.run() } catch { godLog("spawn failed: \(error)"); godProc = nil; godStateTimer?.invalidate(); godRunning = false; glowModel.target = nil; setGlow(.idle) }
    }

    // Ride a click-through selection overlay on top DURING listening, so you draw WHILE you talk. It
    // never takes focus (ignoresMouseEvents), so the ⌃-to-send monitor keeps firing; we watch the mouse
    // with GLOBAL monitors (same passive approach as ⌃⌃) and read `regionCommitted` when you tap ⌃.
    // Capture is EXPLICIT and fn-gated now, so ⌃⌃ leaves the pointer FREE — you can drag a file onto the
    // notch WHILE talking (a normal, no-fn drag is left completely alone so it can be a file-drop). During
    // listening we passively watch the mouse: fn+click grabs the WHOLE screen, fn+drag rubber-bands a
    // region. No fn gesture at all → God just sees the full screen. The draw overlay only appears DURING
    // an active fn+drag, so nothing sits over the notch to block a drop.
    @MainActor private func installCaptureGestureMonitors() {
        guard captureFnTimer == nil, let screen = NSScreen.main else { return }
        regionStart = nil; regionMoved = false; regionCommitted = .full; fnCaptureActive = false
        lastGodCaptureIntentional = false; capturePrevBtnDown = false
        // Do NOT wipe godRefs here — files dropped (or screens grabbed) BEFORE this ⌃⌃ must ride this turn.
        // They clear when the turn goes idle (terminationHandler) so nothing leaks into the next gesture.
        let toView: (NSPoint) -> NSPoint = { NSPoint(x: $0.x - screen.frame.minX, y: $0.y - screen.frame.minY) }
        // POLL, don't monitor. `NSEvent.addGlobalMonitorForEvents` for the mouse silently never fires without
        // the Input-Monitoring grant (the same reason the glow follows the cursor by polling, above) — so an
        // fn+click/fn+drag would do NOTHING and give no feedback on a machine that hasn't granted it. These
        // three are FREE reads (no TCC): pressedMouseButtons, modifierFlags, mouseLocation. Escape via
        // CGEventSource.keyState is free too. Edge-detect the button across ticks to synthesize down/drag/up.
        captureFnTimer?.invalidate()
        captureFnTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if CGEventSource.keyState(.combinedSessionState, key: 53) { self.cancelGod(); return }   // Esc → cancel
                let btnDown = (NSEvent.pressedMouseButtons & 0x1) != 0
                let fn = NSEvent.modifierFlags.contains(.function)
                let p = toView(NSEvent.mouseLocation)
                if btnDown && !self.capturePrevBtnDown {                 // ── button DOWN edge
                    if fn {                                             // fn held at press → begin a capture grab
                        self.fnCaptureActive = true
                        self.regionStart = p; self.regionMoved = false
                        self.ensureRegionOverlay(screen); self.regionView?.setSel(.zero)
                    }                                                    // no fn → leave the pointer free (file-drop / clicks pass through)
                } else if btnDown && self.fnCaptureActive, let s = self.regionStart {   // ── dragging
                    if hypot(p.x - s.x, p.y - s.y) > 6 { self.regionMoved = true }
                    self.regionView?.setSel(NSRect(x: min(s.x, p.x), y: min(s.y, p.y), width: abs(p.x - s.x), height: abs(p.y - s.y)))
                } else if !btnDown && self.capturePrevBtnDown && self.fnCaptureActive {  // ── button UP edge → commit
                    self.fnCaptureActive = false
                    self.lastGodCaptureIntentional = true                // an explicit grab → usable as an image reference
                    if self.regionMoved, let v = self.regionView, v.sel.width > 8, v.sel.height > 8 {
                        self.regionCommitted = .region(v.captureRect())  // fn+drag → that region
                    } else {
                        self.regionCommitted = .full                     // fn+click (no drag) → whole screen
                    }
                    self.regionOverlay?.orderOut(nil); self.regionOverlay = nil; self.regionView = nil
                    self.confirmCaptureInNotch()                         // ← the missing feedback: show what got grabbed, as a chip
                }
                self.capturePrevBtnDown = btnDown
            }
        }
    }

    // Arm a ONE-SHOT fn-drag region grab for GUIDE FEEDBACK. Independent of any God turn: it reuses the
    // region overlay + screencapture, but hands the jpg to `completion` instead of staging a God ref
    // (confirmCaptureInNotch mutates godRefs / paints the God pill — all wrong mid-guide). fn+drag → that
    // region · fn+click (no drag) → whole screen · disarmed after one commit.
    @MainActor func armFeedbackRegionCapture(completion: @escaping (String) -> Void) {
        guard feedbackCaptureTimer == nil, let screen = NSScreen.main else { return }
        onFeedbackShot = completion
        feedbackRegionStart = nil; feedbackRegionMoved = false; feedbackPrevBtnDown = false
        let toView: (NSPoint) -> NSPoint = { NSPoint(x: $0.x - screen.frame.minX, y: $0.y - screen.frame.minY) }
        feedbackCaptureTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let btnDown = (NSEvent.pressedMouseButtons & 0x1) != 0
                let fn = NSEvent.modifierFlags.contains(.function)
                let p = toView(NSEvent.mouseLocation)
                // The overlay must be present + OWNING the mouse the instant fn is held — BEFORE the mouse-down —
                // or that first down leaks to the app and starts a text selection. So arm on fn-hold, not on
                // mouse-down. While fn is held the overlay is opaque to the mouse (swallows the whole drag); when
                // fn is released and no drag is in flight it's click-through so normal clicking still works. This
                // is the fix for the "fn+drag selects text / blank grab" bug.
                if fn {
                    self.ensureRegionOverlay(screen)
                    self.regionOverlay?.ignoresMouseEvents = false
                } else if self.feedbackRegionStart == nil {
                    // fn released and not mid-drag → REMOVE the overlay entirely (don't just make it click-through)
                    // so it can never sit above the note panel and block clicks/typing into the field.
                    if self.regionOverlay != nil { self.regionOverlay?.orderOut(nil); self.regionOverlay = nil; self.regionView = nil }
                }
                if btnDown && !self.feedbackPrevBtnDown {                       // ── DOWN edge
                    if fn { self.feedbackRegionStart = p; self.feedbackRegionMoved = false; self.regionView?.setSel(.zero) }
                } else if btnDown, self.feedbackRegionStart != nil, let s = self.feedbackRegionStart {  // ── dragging
                    if hypot(p.x - s.x, p.y - s.y) > 6 { self.feedbackRegionMoved = true }
                    self.regionView?.setSel(NSRect(x: min(s.x, p.x), y: min(s.y, p.y), width: abs(p.x - s.x), height: abs(p.y - s.y)))
                } else if !btnDown && self.feedbackPrevBtnDown, self.feedbackRegionStart != nil {  // ── UP edge → commit
                    let pick: RegionPick
                    if self.feedbackRegionMoved, let v = self.regionView, v.sel.width > 8, v.sel.height > 8 {
                        pick = .region(v.captureRect())   // fn+drag → that region
                    } else {
                        pick = .full                      // fn+click (no drag) → whole screen
                    }
                    self.regionOverlay?.orderOut(nil); self.regionOverlay = nil; self.regionView = nil
                    let shot = NSTemporaryDirectory() + "guide-feedback-\(UUID().uuidString).jpg"
                    self.captureShot(pick, to: shot)
                    // STAY ARMED for the next grab (multiple screenshots per note, like God's chip-accumulating
                    // grab) — reset the per-grab state instead of disarming. The note panel accumulates thumbs.
                    self.feedbackRegionStart = nil; self.feedbackRegionMoved = false
                    if FileManager.default.fileExists(atPath: shot) {
                        NSSound(named: "Morse")?.play()
                        self.onFeedbackShot?(shot)        // → CursorGuide.attachFeedbackScreenshot (appends)
                    }
                    // if the file is missing (Screen-Recording ungranted) we simply don't attach a shot.
                }
                self.feedbackPrevBtnDown = btnDown
            }
        }
    }

    @MainActor func disarmFeedbackRegionCapture() {
        feedbackCaptureTimer?.invalidate(); feedbackCaptureTimer = nil
        regionOverlay?.orderOut(nil); regionOverlay = nil; regionView = nil
        feedbackRegionStart = nil
    }

    // An fn grab committed. What it MEANS depends on the share mode snapshotted for this turn:
    //  • OFF (privacy-forward default): a plain ⌃⌃ is voice-only, so every fn grab ACCUMULATES as a removable
    //    chip — fn+click = whole screen, fn+drag = a region.
    //  • ON: the whole screen is already auto-shared (a "Whole screen" chip is up). fn+click INVERTS it —
    //    toggling the share off (take it back → voice-only) or back on. fn+drag REPLACES the auto full-screen
    //    with just that region (a tighter, more private share).
    @MainActor private func confirmCaptureInNotch() {
        if shareScreenThisTurn {
            if case .region(let r) = regionCommitted {
                godRefs.removeAll { $0.kind == .screenshot && $0.full }   // region REPLACES the auto full-screen
                stageScreenGrab(.region(r), full: false)
            } else if godRefs.contains(where: { $0.kind == .screenshot && $0.full }) {
                godRefs.removeAll { $0.kind == .screenshot && $0.full }   // fn+click again → take the share BACK (voice-only)
                (notchDropPanel?.contentView as? FileDropView)?.attached = !godRefs.isEmpty
                NSSound(named: "Morse")?.play(); updateGodStatusDrop(glowModel.state)
            } else {
                stageScreenGrab(.full, full: true)                        // fn+click after taking it back → re-share
            }
            return
        }
        // OFF: this grab is the ONLY screen God sees (a plain ⌃⌃ shares nothing). A whole-screen fn+click is a
        // `full` grab; a region is not.
        let isFull: Bool = { if case .region = regionCommitted { return false }; return true }()
        stageScreenGrab(regionCommitted, full: isFull)
    }

    // Auto-share ON: stage the whole screen the instant listening starts, so a "Whole screen" chip is visible
    // the entire time you talk (the "my screen is shared now" signal). fn+click later toggles it off.
    @MainActor private func stageAutoScreen() { stageScreenGrab(.full, full: true) }

    // Screenshot exactly what was picked (to its OWN file so several grabs coexist), downscale a chip
    // thumbnail, and stage it as a removable screenshot ref → a chip in the notch pill. `full` marks a
    // whole-screen grab so fn+click can find-and-toggle it. Each staged ref rides the turn (GOD_IMAGES).
    @MainActor private func stageScreenGrab(_ pick: RegionPick, full: Bool) {
        let shotPath = NSTemporaryDirectory() + "god-capture-\(UUID().uuidString).jpg"
        captureShot(pick, to: shotPath)
        let label: String = { if case .region(let r) = pick { return "Region \(Int(r.width.rounded()))×\(Int(r.height.rounded()))" } else { return "Whole screen" } }()
        guard FileManager.default.fileExists(atPath: shotPath) else {
            // Screen Recording likely not granted — still acknowledge, with a caption but no thumbnail.
            godRefs.append(GodRef(kind: .screenshot, path: shotPath, thumb: nil, label: label, full: full))
            NSSound(named: "Morse")?.play(); updateGodStatusDrop(glowModel.state); return
        }
        var thumb: NSImage?
        if let img = NSImage(contentsOfFile: shotPath) {
            let long: CGFloat = 44                                       // chip-sized thumbnail (retina-crisp, tiny memory)
            let ar = img.size.width > 0 ? img.size.height / max(img.size.width, 1) : 0.6
            let w = long, h = max(20, min(long, long * ar))
            let t = NSImage(size: NSSize(width: w, height: h))
            t.lockFocus(); img.draw(in: NSRect(x: 0, y: 0, width: w, height: h)); t.unlockFocus()
            thumb = t
        }
        godRefs.append(GodRef(kind: .screenshot, path: shotPath, thumb: thumb, label: label, full: full))
        NSSound(named: "Morse")?.play()                                  // a soft audible tick — the grab registered even if you're mid-sentence
        updateGodStatusDrop(glowModel.state)                            // re-render the pill NOW so the chip appears while you keep talking
    }

    // The full-notch DROP ZONE — a panel spanning the notch, live only while listening, so you can drag a
    // file onto it as you talk. Faint dashed hint; lime when a file's over it. Drop → the one-shot GOD_FILE.
    @MainActor private func showNotchDropZone() {
        guard notchDropPanel == nil else { return }
        // A STANDALONE transparent overlay laid over the notch. Key lesson: the drop only takes when the
        // hit area is GENEROUS (wider than the pill) — exactly overlapping the pill's window lost the drag. So
        // the panel/hit-area is wider; the dashed outline is DRAWN at the pill's exact width/height (below).
        let panel = DropPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        // ABOVE the status pill (both were .popUpMenu and overlap in the centre, so a drop ON the visible
        // pill — the natural target — hit the pill, which doesn't accept drags, and only the invisible
        // padding worked). A strictly higher level keeps the drop overlay on top through every pill
        // re-render, so dropping right on the pill takes. (Still below the .screenSaver glow.)
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.popUpMenu.rawValue + 2)
        panel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]   // .transient not .stationary → drop target works over fullscreen
        let view = FileDropView(frame: .zero)
        // A near-invisible fill over the WHOLE hit area — a clear window only receives a drop where it has
        // opaque content, so without this the drop only lands on the drawn dashed lines (the bug you saw).
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(white: 0, alpha: 0.02).cgColor
        view.onDrop = { [weak self] path in Task { @MainActor in self?.acceptDroppedFile(path) } }
        panel.contentView = view
        panel.orderFrontRegardless()
        notchDropPanel = panel
        syncNotchDropZone()   // size it to the pill so the dashed outline is a pixel-exact twin
    }
    // Lock the drop zone to the pill: SAME width/height/top as the God status pill, so the dashed outline is a
    // perfect twin of the pill's NotchDropShape (the hit area stays wider via `pad`, but the DRAWN outline
    // equals the pill). Re-run whenever the pill resizes — e.g. a reference chip grows it — so they never drift.
    @MainActor private func syncNotchDropZone() {
        guard let panel = notchDropPanel, let view = panel.contentView as? FileDropView,
              let screen = statusItem?.button?.window?.screen ?? NSScreen.main else { return }
        let pf = (godStatusPanel?.isVisible == true && godStatusPanel.frame.width > 40) ? godStatusPanel.frame : nil
        let pillW = pf?.width ?? 190
        let pillH = pf?.height ?? 50
        let pad: CGFloat = 28                                  // generous invisible hit area on each side
        let hitW = pillW + pad * 2
        let top = screen.frame.maxY + notchTopBleed            // same top as the pill (bleed included)
        panel.setFrame(NSRect(x: screen.frame.midX - hitW / 2, y: top - pillH, width: hitW, height: pillH), display: true)
        view.frame = NSRect(x: 0, y: 0, width: hitW, height: pillH)
        view.visualWidth = pillW                              // outline drawn at the pill's exact width, centred
        view.needsDisplay = true
    }
    @MainActor private func hideNotchDropZone() { notchDropPanel?.orderOut(nil); notchDropPanel = nil }

    // The draw surface for an fn+drag — created lazily (ONLY while a region is being dragged) so nothing
    // sits over the notch during normal listening, which would block a file-drop. Click-through.
    @MainActor private func ensureRegionOverlay(_ screen: NSScreen) {
        guard regionOverlay == nil else { return }
        let view = RegionSelectView(frame: NSRect(origin: .zero, size: screen.frame.size))
        let win = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        win.isOpaque = false; win.backgroundColor = .clear; win.hasShadow = false
        win.level = .screenSaver; win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        win.ignoresMouseEvents = true
        win.contentView = view
        win.setFrame(screen.frame, display: true)
        win.orderFrontRegardless()
        regionOverlay = win; regionView = view
    }

    @MainActor private func hideRegionOverlay() {
        captureFnTimer?.invalidate(); captureFnTimer = nil
        for m in regionMonitors { NSEvent.removeMonitor(m) }
        regionMonitors = []
        regionOverlay?.orderOut(nil); regionOverlay = nil; regionView = nil; regionStart = nil
    }

    // Map God's published phase to the glow/notch state (drives the notch pill + cursor caption).
    @MainActor private func readGodState() {
        readGodPoint()   // model-chosen [POINT] → the shared pulsing ring (God + guide use one ring)
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-state")
        var s = ((try? String(contentsOfFile: path, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        // Staleness guard: God rewrites its phase every few seconds during a live run and writes "idle" when
        // it finishes. If a non-idle phase (other than user-gated "consent") has sat UNCHANGED for a long
        // time, God died/hung WITHOUT writing idle — so a stale "speaking"/"thinking" would otherwise keep
        // the glow (and its ring) alive forever. Treat an old non-idle state as idle. 45s is well beyond a
        // normal think+speak turn but bounds any orphan.
        if !s.isEmpty, s != "consent",
           let m = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date,
           Date().timeIntervalSince(m) > 45 {
            s = ""
        }
        switch s {
        case "listening": setGlow(.listening); onboard.note(.glance)   // tour step 0: ⌃⌃ fired
        case "thinking": setGlow(.thinking); onboard.note(.glance)
        case "finishing": setGlow(.finishing)   // model done, TTS synthesizing — "Almost done…", not a silent "Speaking"
        case "speaking": setGlow(.speaking)
        case "consent":
            // God (still running) proposed a RUN action and is WAITING on us. Raise the same notch
            // drop the local hands use, once, and write the decision back for god.mjs to execute.
            setGlow(.thinking)
            if !godConsentPending { godConsentPending = true; showRunConsent() }
        default:
            // idle / empty / absent god-state → God isn't in an active phase. Make the POLLER authoritative
            // about teardown: the process terminationHandler never fires for a God run this app didn't spawn
            // (or one that was killed), so relying on it alone orphaned the ring. Return to idle (a PINNED
            // model mark still gets its brief afterglow inside setGlow). Guarded so it's a no-op when nothing
            // is showing — never a per-tick thrash.
            if glowModel.state != .idle || glowModel.target != nil { setGlow(.idle) }
        }
        // setGlow() drives the cursor glow AND the notch phase drop; nothing more to do per tick.
    }

    // God's model-chosen [POINT] → the SAME pulsing ring the guide uses. companion.point() is a console
    // stub, so a point the MODEL chose reaches the ring only through this file. god.mjs writes
    // ~/.relay/god-point.json in SCREENSHOT-PIXEL coordinates (the frame the model actually reasoned over):
    //   { "x": <int px>, "y": <int px>, "w": <int screenshot width px>, "h": <int screenshot height px>,
    //     "label": "...", "ts": <epoch ms> }
    // We map px → the main screen by fraction (resolution-independent), then into the overlay's top-left
    // coordinate space — the SAME space the manual ⌃⌥ point and GodGlowView's ring use.
    @MainActor private func readGodPoint() {
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/god-point.json")
        guard FileManager.default.fileExists(atPath: path) else { return }   // absent → keep any current mark
        let obj = readJSON(path) as? [String: Any]
        // CONSUME-ONCE: delete on read (whatever it contained) so a stale file from a prior run can never
        // re-mark an old location on the next poll.
        try? FileManager.default.removeItem(atPath: path)
        // An explicit clear ({} / malformed / no numeric x,y) drops the mark and any pinned afterglow.
        guard let obj = obj,
              let xN = obj["x"] as? NSNumber, let yN = obj["y"] as? NSNumber,
              let wN = obj["w"] as? NSNumber, let hN = obj["h"] as? NSNumber,
              let screen = NSScreen.main else {
            glowModel.target = nil; pointMarkPinned = false
            pointMarkPinTimer?.invalidate(); pointMarkPinTimer = nil
            return
        }
        let w = wN.doubleValue, h = hN.doubleValue
        guard w > 0, h > 0 else {   // guard div-by-zero → treat a degenerate frame as a clear
            glowModel.target = nil; pointMarkPinned = false
            pointMarkPinTimer?.invalidate(); pointMarkPinTimer = nil
            return
        }
        // Screenshot-pixel → screen fraction (top-left origin) → overlay top-left points. This matches the
        // manual point at triggerGod (`x - minX`, `maxY - y`): for the main screen origin, x-from-left and
        // y-from-top are exactly `width*fracX` and `height*fracY`.
        let fracX = xN.doubleValue / w
        let fracY = yN.doubleValue / h
        let overlayX = screen.frame.width * fracX
        let overlayY = screen.frame.height * fracY
        glowModel.target = CGPoint(x: overlayX, y: overlayY)
        pointMarkPinned = true   // a fresh model-chosen mark survives briefly after the run ends (see setGlow/terminationHandler)
    }

    // Find a node to run the God client: bundled first, then Homebrew/local, then nvm (any version).
    private func nodePath() -> String? {
        let fm = FileManager.default
        if fm.fileExists(atPath: BUNDLED_NODE) { return BUNDLED_NODE }
        let home = NSHomeDirectory()
        var candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "\(home)/.local/bin/node", "/usr/bin/node"]
        let nvm = "\(home)/.nvm/versions/node"
        if let vers = try? fm.contentsOfDirectory(atPath: nvm) {
            for v in vers.sorted().reversed() { candidates.insert("\(nvm)/\(v)/bin/node", at: 0) }
        }
        return candidates.first { fm.fileExists(atPath: $0) }
    }

    // Locate the God client: bundled in the .app (DMG install) first, then dev in-tree, then an override.
    private func godClientPath() -> String? {
        let fm = FileManager.default
        if let res = Bundle.main.resourcePath {
            let bundled = (res as NSString).appendingPathComponent("god/god.mjs")
            if fm.fileExists(atPath: bundled) { return bundled }
        }
        // dev: the .app builds at <repo>/packages/menubar/…app, so the repo is three levels up.
        let dev = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("examples/god/god.mjs").path
        if fm.fileExists(atPath: dev) { return dev }
        if let override = ProcessInfo.processInfo.environment["GOD_CLIENT"], fm.fileExists(atPath: override) { return override }
        return nil
    }

    // Locate the video2ai pipeline (bundled in the .app first, then dev in-tree) — mirrors godClientPath.
    private func videoPipelinePath() -> String? {
        let fm = FileManager.default
        if let res = Bundle.main.resourcePath {
            let bundled = (res as NSString).appendingPathComponent("god/video2ai-pipeline.mjs")
            if fm.fileExists(atPath: bundled) { return bundled }
        }
        let dev = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("examples/god/video2ai-pipeline.mjs").path
        if fm.fileExists(atPath: dev) { return dev }
        return nil
    }

    private func installGlow() {
        guard let screen = NSScreen.main else { return }
        glowHosting = NoInsetHostingView(rootView: GodGlowView(m: glowModel))
        glow = NotchPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        glow.isOpaque = false
        glow.backgroundColor = .clear
        glow.hasShadow = false
        glow.level = .screenSaver
        glow.ignoresMouseEvents = true                  // pure decoration — never intercepts a click
        glow.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]   // .transient not .stationary → rides fullscreen with the notch
        glow.contentView = glowHosting
        glow.setFrame(screen.frame, display: false)
        glow.orderOut(nil)                              // shown only while a state is active
        mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged, .rightMouseDragged]) { [weak self] _ in
            Task { @MainActor in self?.updateGlowCursor(); self?.maybeAutoClosePanel() }
        }
    }

    @MainActor private func updateGlowCursor() {
        guard let screen = NSScreen.main else { return }
        let p = NSEvent.mouseLocation                    // global, bottom-left origin
        glowModel.cursor = CGPoint(x: p.x - screen.frame.minX, y: screen.frame.maxY - p.y)   // → overlay top-left coords
    }

    @MainActor private func setGlow(_ s: GlowState) {
        if s != .idle, ambientPanel?.isVisible == true { ambientPanel?.orderOut(nil); ambientContextKey = "" }   // God takes the notch
        // A model-chosen mark that was explicitly PINNED (readGodPoint) survives briefly after the run
        // ends — but only as a single, time-limited latch, NEVER the old `target != nil` gate that left the
        // ring pulsing forever. Sparkles stop (phase is idle) while the ring lingers; a timer then forces
        // authoritative idle, guaranteeing the ring can't be orphaned.
        if s == .idle && pointMarkPinned && glowModel.target != nil {
            glowModel.state = .idle
            stopGlowTracking()
            updateGodStatusDrop(.idle)
            if pointMarkPinTimer == nil {
                pointMarkPinTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        self.pointMarkPinned = false
                        self.pointMarkPinTimer = nil
                        self.setGlow(.idle)   // expiry → real teardown (pin now clear)
                    }
                }
            }
            return
        }
        glowModel.state = s
        if s == .idle {
            // idle is authoritative: clear the mark and tear the overlay down. The ring's lifetime follows
            // one source of truth — state → idle always removes it.
            glowModel.target = nil
            pointMarkPinned = false
            pointMarkPinTimer?.invalidate(); pointMarkPinTimer = nil
            glow.orderOut(nil); stopGlowTracking()
        } else {
            if let scr = NSScreen.main { glow.setFrame(scr.frame, display: false) }  // re-anchor (resolution/monitor may have changed)
            updateGlowCursor(); glow.orderFrontRegardless(); startGlowTracking()
        }
        updateGodStatusDrop(s)
    }

    // Follow the cursor by POLLING its position (~30fps) while the glow is up. NSEvent.mouseLocation
    // is a free read (no Accessibility/Input-Monitoring needed) — unlike the global mouse monitor,
    // which silently never fires without that grant. This is why the glow wasn't following.
    @MainActor private func startGlowTracking() {
        glowCursorTimer?.invalidate()
        glowCursorTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateGlowCursor() }
        }
    }
    @MainActor private func stopGlowTracking() { glowCursorTimer?.invalidate(); glowCursorTimer = nil }

    // Drive the notch-drop phase indicator from the one place glow state changes. Only the three
    // spoken phases get a label; armed/pointing are cursor-glow only (no notch label). idle hides it.
    @MainActor private func updateGodStatusDrop(_ s: GlowState) {
        switch s {
        case .listening: showGodStatus("Listening", accent: .lime, pattern: .listening)
        case .thinking:  showGodStatus("Thinking",  accent: .lime, pattern: .thinking)
        case .finishing: showGodStatus("Almost done…", accent: .lime, pattern: .thinking)   // TTS synthesizing — keep the thinking motion, honest label
        case .speaking:  showGodStatus("Speaking",  accent: .lime, pattern: .speaking)
        default: hideGodStatus()
        }
    }

    @MainActor private func showGodStatus(_ label: String, accent: Color, pattern: DotMatrix.Pattern) {
        // Re-render only when the phase, the staged references, OR the active project changes — so the 0.25s
        // poll doesn't restart the waveform each tick. The project chip rides the WORKING phases (not
        // listening — the drop zone + talking own that pill).
        // References ONLY on God's OWN request phases — never ⌃⌥ dictation (Dictating/Transcribing) or the
        // drive-status pills — so a grabbed screenshot / dropped file can't leak into the dictation pill.
        let showRefs = (label == "Listening" || label == "Thinking" || label == "Speaking")
        let refVMs: [GodRefChipVM] = showRefs ? godRefs.map {
            GodRefChipVM(id: $0.id, label: $0.label, thumb: $0.thumb, icon: $0.sfSymbol)
        } : []
        // The clipboard offer rides ONLY the listening pill — that's the window where an Add still makes the
        // turn (spawnGod reads godRefs at ⌃-send). Included in the dedup key so it doesn't restart the waveform.
        let clipPeekText: String? = (label == "Listening") ? clipboardOffer.map { clipPeek($0) } : nil
        let refsKey = refVMs.map { $0.id.uuidString }.joined(separator: ",") + (clipPeekText != nil ? "|clip" : "")
        let showProjects = (label == "Thinking" || label == "Speaking")
        let activeProj = showProjects ? readDefaultId() : nil
        if godStatusLabel == label, godStatusRefsKey == refsKey, godStatusProject == activeProj, godStatusPanel?.isVisible == true { return }
        godStatusLabel = label; godStatusRefsKey = refsKey; godStatusProject = activeProj
        if showProjects { model.refreshFiles() }   // freshen the project list only when we're (re)building the pill
        let projs: [(id: String, name: String)] = showProjects ? model.contexts.map { (id: $0.id, name: $0.name) } : []
        // Switch the project from the dropdown → set it globally AND re-run the in-flight turn grounded in
        // it (context-first: "make me an ad" is only right for the right brand). Voice turns re-run with the
        // same clip; other turns just reflect the new project.
        let onSel: ((String?) -> Void)? = projs.isEmpty ? nil : { [weak self] id in
            guard let self else { return }
            writeGlobalContext(id); self.model.refreshFiles()
            if self.godRunning, let audio = self.lastGodAudio {
                // Quiet re-run (no cancel sound / idle flicker): kill the in-flight process — its stale
                // exit is ignored by the identity-guarded terminationHandler — and re-trigger the SAME
                // clip; god.mjs picks up the new project from context-selection.json. Glow stays working.
                // FRESH session for the re-run so the model can't see the ask twice: the killed attempt may
                // already have hit the warm "god-native" thread, so continue on a clean id instead. The
                // staged references (godRefs) survive the re-run — they clear only when the turn goes idle.
                self.godProc?.terminate(); self.godProc = nil
                self.godStateTimer?.invalidate(); self.godRunning = false
                let fresh = "god-rerun-\(UUID().uuidString.prefix(8))"
                self.triggerGod(at: NSEvent.mouseLocation, audio: audio, sessionOverride: fresh)
            } else {
                self.updateGodStatusDrop(self.glowModel.state)   // no in-flight run — just reflect the new project
            }
        }
        // The ✕ on a chip removes that reference before ⌃-send.
        let onRemove: ((UUID) -> Void)? = refVMs.isEmpty ? nil : { [weak self] id in self?.removeGodRef(id) }
        if godStatusPanel == nil {
            godStatusPanel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            godStatusPanel.isOpaque = false; godStatusPanel.backgroundColor = .clear; godStatusPanel.hasShadow = false
            godStatusPanel.level = .popUpMenu; godStatusPanel.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        }
        let onAddClip: (() -> Void)? = clipPeekText == nil ? nil : { [weak self] in self?.addClipboardRef() }
        godStatusPanel.contentView = NoInsetHostingView(rootView: GodStatusDrop(label: label, accent: accent, pattern: pattern, refs: refVMs, onRemoveRef: onRemove, clipboardPeek: clipPeekText, onAddClipboard: onAddClip, projects: projs, activeProjectId: activeProj, onSelectProject: onSel))
        let size = godStatusPanel.contentView!.fittingSize
        godStatusPanel.setContentSize(size)
        if let screen = statusItem?.button?.window?.screen ?? NSScreen.main {
            godStatusPanel.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        }
        // SEAMLESS base→phase (founder 2026-08-13: "the notch shouldn't disappear and reappear"): present
        // the phase panel FIRST — its opaque notch shape covers the orb's spot as it grows — THEN hide the
        // orb behind it, so there's never a blank gap between the two windows.
        if !godStatusPanel.isVisible {
            presentFromNotch(godStatusPanel)
        }
        orb?.orderOut(nil)
        if notchDropPanel != nil { syncNotchDropZone() }   // the drop outline tracks the pill's new size (a chip just grew it)
    }

    @MainActor private func hideGodStatus() {
        godStatusLabel = nil
        // Reverse of the above: bring the orb up FIRST (behind the panel), then drop the panel — so the
        // ambient notch is already there the instant the phase drop clears (no flash of nothing).
        orb?.orderFrontRegardless()
        godStatusPanel?.orderOut(nil)
    }

    // ── Ambient mode ─────────────────────────────────────────────────────────────────────────────
    // Strictly-local awareness: the AmbientSensor (NSWorkspace + Accessibility, no network/screenshot/model)
    // reports the app/tab/form the user is on; a LOCAL rules matcher turns it into ≤3 contextual suggestions;
    // when something is relevant we grow a helper canvas from the notch. OFF unless the flag file exists.
    private var ambientFlagPath: String { (NSHomeDirectory() as NSString).appendingPathComponent(".relay/ambient-on") }
    private func ambientEnabledFlag() -> Bool { FileManager.default.fileExists(atPath: ambientFlagPath) }
    @MainActor private func startAmbientIfEnabled() {
        ambientOn = ambientEnabledFlag()
        guard ambientOn else { return }
        ambientSensor.onChange = { [weak self] sig in Task { @MainActor in self?.handleAmbientSignal(sig) } }
        ambientSensor.startObserving()
        godLog("ambient mode ON")
        if let s = ambientSensor.sampleNow() { handleAmbientSignal(s) }   // react to whatever's already frontmost
    }
    @MainActor func toggleAmbient() {
        if ambientOn {
            try? FileManager.default.removeItem(atPath: ambientFlagPath)
            ambientSensor.stopObserving(); hideAmbientCanvas(); ambientOn = false
            toast("Ambient mode off")
        } else {
            FileManager.default.createFile(atPath: ambientFlagPath, contents: nil)
            startAmbientIfEnabled()
            toast("Ambient mode on — watching locally")
        }
    }
    @objc private func toggleAmbientMenu() { toggleAmbient() }
    // Keywords for a project so the matcher can tie "this window is about X" → that project's wrapp.
    private func ambientKeywords(for c: Ctx) -> [String] {
        var kw = c.name.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init).filter { $0.count > 2 }
        kw.append(c.id.lowercased())
        return Array(Set(kw))
    }
    private func ambientContextLabel(_ s: AmbientSignal) -> String {
        if s.kind == .browser, let u = s.url, let h = URLComponents(string: u)?.host {
            return h.replacingOccurrences(of: "www.", with: "")
        }
        return s.appName
    }
    @MainActor private func handleAmbientSignal(_ sig: AmbientSignal) {
        guard ambientOn else { return }
        // Never fight God: while a God pill / turn / dictation owns the notch, defer.
        if godRunning || godListening || dictating || glowModel.state != .idle { ambientPanel?.orderOut(nil); return }
        if let until = ambientSuppressUntil, until > Date() { return }
        let cat = readCatalog().map { (id: $0.id, tagline: $0.tagline, category: $0.category) }
        let projs = model.contexts.map { (name: $0.name, keywords: ambientKeywords(for: $0)) }
        let sugg = suggestions(for: sig, catalog: cat, projects: projs)
        guard !sugg.isEmpty else { hideAmbientCanvas(); return }   // nothing relevant → show nothing (never noise)
        let key = sig.bundleId + "|" + sugg.map { $0.targetId }.joined(separator: ",")
        if key == ambientContextKey, ambientPanel?.isVisible == true { return }   // same card already up
        ambientContextKey = key
        showAmbientCanvas(context: ambientContextLabel(sig), suggestions: sugg)
    }
    @MainActor private func showAmbientCanvas(context: String, suggestions sugg: [AmbientSuggestion]) {
        if ambientPanel == nil {
            ambientPanel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            ambientPanel!.isOpaque = false; ambientPanel!.backgroundColor = .clear; ambientPanel!.hasShadow = false
            ambientPanel!.level = .popUpMenu; ambientPanel!.collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]
        }
        let view = AmbientCanvas(context: context, suggestions: sugg,
            onPick: { [weak self] targetId in Task { @MainActor in self?.pickAmbient(targetId) } },
            onDismiss: { [weak self] in Task { @MainActor in self?.dismissAmbient() } })
        ambientPanel!.contentView = NoInsetHostingView(rootView: view)
        let size = ambientPanel!.contentView!.fittingSize
        ambientPanel!.setContentSize(size)
        if let screen = statusItem?.button?.window?.screen ?? NSScreen.main {
            ambientPanel!.setFrameTopLeftPoint(NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY + notchTopBleed))
        }
        orb?.orderOut(nil)   // the extended notch replaces the orb
        if !ambientPanel!.isVisible { presentFromNotch(ambientPanel!) }
    }
    @MainActor private func hideAmbientCanvas() {
        ambientContextKey = ""
        guard ambientPanel?.isVisible == true else { return }
        ambientPanel?.orderOut(nil)
        if glowModel.state == .idle { orb?.orderFrontRegardless() }
    }
    @MainActor private func pickAmbient(_ targetId: String) {
        hideAmbientCanvas()
        guard let l = readCatalog().first(where: { $0.id == targetId }) else { return }
        launchWrapp(l, preferredSurface(l))
    }
    @MainActor private func dismissAmbient() {
        hideAmbientCanvas()
        ambientSuppressUntil = Date().addingTimeInterval(120)   // a manual dismiss hushes ambient for 2 min
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

    // ---------- the wrapp store modal ----------
    // What's present RIGHT NOW, from the state the menubar already derives — the read-only resolver
    // diffs each listing's `requires` against this (docs/WRAPP-STORE-MODAL.md §4). Per-origin
    // capability grants aren't tracked here yet (the fill drawer is Phase 2), so `caps` is empty and a
    // capability shows honestly as "not yet".
    @MainActor private func storePresent() -> Present {
        Present(daemon: model.running,
                signedIn: model.signedIn,
                cloud: model.running && model.signedIn,
                local: !ollama.models.isEmpty,
                caps: [])
    }

    // Open the store: read the aggregated catalog fresh, drop the modal from the notch, dismiss on a
    // click outside (mirrors the main panel's transient behaviour).
    @MainActor private func showStore() {
        model.refreshFiles(); ollama.refresh()
        hidePanel()
        // Drop UNLISTED wrapps (`hidden: true`) from every store surface here, at the single feed that
        // fills both the featured front page and the classic StoreView. Kept out of readCatalog() on
        // purpose: an already-installed hidden wrapp must still resolve for its connect chip / widgets.
        let listings = readCatalog().filter { !($0.hidden ?? false) }
        // Two-level store (docs/STORE.md): the FEATURED front page first; each tab / "See All" swaps the
        // classic full StoreView into the SAME panel PRE-FILTERED (Apps → non-skill, Skills → skill, else
        // All) so the three tabs land on distinct views instead of all showing every wrapp.
        let view = StoreFrontView(
            listings: listings,
            icon: { id in storeIcon(id) },
            onGet: { [weak self] l in guard let self else { return }; self.launchWrapp(l, self.preferredSurface(l)) },
            onSeeAll: { [weak self] cat in
                guard let self else { return }
                let classic = StoreView(listings: listings, present: self.storePresent(),
                                        onLaunch: { [weak self] l, s in self?.launchWrapp(l, s) },
                                        onClose: { [weak self] in self?.hideStore() },
                                        onAddLocal: { [weak self] in self?.addLocalWrapp() },
                                        initialCategory: cat)
                self.storePanel?.contentView = NoInsetHostingView(rootView: classic)
            },
            onClose: { [weak self] in self?.hideStore() })
        if storePanel == nil {
            // A free-floating modal (centred, its own shadow) — not a notch drop. The store is a
            // deliberate destination, so it earns a real window, not the ambient notch surface.
            storePanel = NotchPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            storePanel.isOpaque = false; storePanel.backgroundColor = .clear; storePanel.hasShadow = true
            storePanel.level = .popUpMenu; storePanel.collectionBehavior = [.canJoinAllSpaces, .transient]
        }
        storePanel.contentView = NoInsetHostingView(rootView: view)
        let size = storePanel.contentView!.fittingSize
        storePanel.setContentSize(size)
        if let screen = statusItem?.button?.window?.screen ?? NSScreen.main {
            // Centre it on the working area, biased a touch above centre so it reads as a modal.
            let vf = screen.visibleFrame
            let x = vf.midX - size.width / 2
            let y = vf.midY - size.height / 2 + 40
            storePanel.setFrameOrigin(NSPoint(x: x, y: y))
        }
        storePanel.alphaValue = 0; storePanel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in ctx.duration = 0.18; storePanel.animator().alphaValue = 1 }
        if storeMonitor == nil {
            storeMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
                Task { @MainActor in self?.hideStore() }
            }
        }
    }

    @MainActor private func hideStore() {
        storePanel?.orderOut(nil)
        if let m = storeMonitor { NSEvent.removeMonitor(m); storeMonitor = nil }
    }

    // D — add a local/dev wrapp without the CLI. Pick a wrapp folder (or its switchboard.json), validate
    // it the SAME way build-catalog.mjs does (must decode, declare ≥1 surface, and satisfy the surface's
    // component), then merge it into ~/.relay/catalog.json so it shows in the store immediately. We drop
    // the popUpMenu-level store panel first so the open dialog isn't fighting it in z-order, and always
    // re-present the store on the way out.
    @MainActor private func addLocalWrapp() {
        hideStore()
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = true; panel.allowsMultipleSelection = false
        panel.prompt = "Add"; panel.message = "Pick a wrapp folder (or its switchboard.json)."
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let picked = panel.url else { showStore(); return }
        // Resolve the chosen path to a manifest file.
        var manifest = picked, isDir: ObjCBool = false
        FileManager.default.fileExists(atPath: picked.path, isDirectory: &isDir)
        if isDir.boolValue { manifest = picked.appendingPathComponent("switchboard.json") }
        guard FileManager.default.fileExists(atPath: manifest.path) else {
            storeAlert("No switchboard.json", "“\(picked.lastPathComponent)” has no switchboard.json at its top level."); showStore(); return
        }
        // Strict decode = guaranteed round-trippable, so merging can never wedge the whole catalog.
        guard let data = FileManager.default.contents(atPath: manifest.path),
              let listing = try? JSONDecoder().decode(SBListing.self, from: data) else {
            storeAlert("Couldn't read the listing", "That switchboard.json isn't a complete wrapp listing (needs id, name, category, components, surfaces, requires)."); showStore(); return
        }
        if let bad = listingProblem(listing) { storeAlert("Not runnable yet", bad); showStore(); return }
        mergeCatalog(listing)
        toast("Added \(listing.name)")
        showStore()
    }

    // Mirror validateListing (store.ts): a surface needs its component. Returns a human reason or nil.
    private func listingProblem(_ l: SBListing) -> String? {
        if l.id.isEmpty || l.name.isEmpty { return "The listing is missing an id or name." }
        if l.surfaces.isEmpty { return "“\(l.name)” declares no surfaces — it's a runtime-only config, not a store listing." }
        for s in l.surfaces {
            switch s {
            case "god": if (l.components.skills?.isEmpty ?? true) { return "Surface 'god' needs components.skills." }
            case "batch": if (l.components.workflows?.isEmpty ?? true) { return "Surface 'batch' needs components.workflows." }
            case "browser", "window", "notch": if l.components.ui?.url == nil { return "Surface '\(s)' needs components.ui." }
            default: break
            }
        }
        return nil
    }

    // Merge one listing into the LIVE catalog (~/.relay/catalog.json), replacing any same-id entry.
    // Seeds from whatever the store currently shows (live-or-bundled) so adding a local wrapp preserves
    // the rest. Re-encoded through the same Codable types → the file stays decodable by readCatalog.
    @MainActor private func mergeCatalog(_ listing: SBListing) {
        var listings = readCatalog().filter { $0.id != listing.id }
        listings.append(listing)
        let cat = SBCatalog(version: 1, count: listings.count, listings: listings)
        try? FileManager.default.createDirectory(atPath: RELAY_DIR, withIntermediateDirectories: true)
        let live = (RELAY_DIR as NSString).appendingPathComponent("catalog.json")
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(cat) { try? data.write(to: URL(fileURLWithPath: live)) }
    }

    @MainActor private func storeAlert(_ title: String, _ body: String) {
        let a = NSAlert(); a.messageText = title; a.informativeText = body; a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true); a.runModal()
    }

    // Launch a listing on a surface (§3). `browser` opens the deployed UI; `god` wakes God wearing the
    // wrapp's purpose ("Activate into God"); `batch` asks God to call the wrapp's tool — which passes
    // through the SAME consent gate + audit as any RUN hand. The `window`/`notch` hosts are Phases 3–4.
    // Concierge on open (docs/STORE.md): the notch lights up and names what just opened + what it
    // does — a launch is a moment, not a silent NSWorkspace.open. Auto-hides; never blocks.
    @MainActor private func concierge(_ l: SBListing) {
        showGodStatus("\(l.name) — \(String(l.tagline.prefix(48)))", accent: .lime, pattern: .speaking)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { [weak self] in self?.hideGodStatus() }
    }

    // Resolve a listing's components.skills refs to their bundled skill bodies (Resources/skills/<ref>.md,
    // e.g. "yc/register" → skills/yc/register.md). Concatenated, with a header per skill so God can tell
    // them apart. nil when the listing declares no skills or none have bundled content — the caller then
    // falls back to the wrapp's page. This is the backing content the old god stub was missing.
    private func resolveSkillContent(_ l: SBListing) -> String? {
        guard let refs = l.components.skills, !refs.isEmpty, let res = Bundle.main.resourcePath else { return nil }
        var parts: [String] = []
        for ref in refs {
            let path = (res as NSString).appendingPathComponent("skills/\(ref).md")
            if let body = try? String(contentsOfFile: path, encoding: .utf8), !body.isEmpty {
                parts.append(body.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }
        return parts.isEmpty ? nil : parts.joined(separator: "\n\n───\n\n")
    }

    // Click a connected app in the panel → open it. A catalogued wrapp opens via the shared launcher; a bare
    // web origin opens its page directly; a native/bridge principal with no page (e.g. God) has nothing to open.
    @MainActor private func openConnectedApp(_ app: AppRow) {
        if let id = app.listingId, let l = readCatalog().first(where: { $0.id == id }) {
            launchWrapp(l, preferredSurface(l)); return
        }
        if app.kind == .web, let u = URL(string: app.id) { NSWorkspace.shared.open(u); return }
        // native/bridge with no page — nothing to open.
    }
    /// NATIVE-FIRST (founder call 2026-08-26): a web wrapp opens as a real Mac window, not a browser tab.
    /// The bridged window has always been better — `window.claude` tunnels straight to the daemon, so no
    /// browser and no extension are in the loop — but no catalog entry ever declared surfaces:["window"],
    /// so the path was shipped and unused. Rather than churn 88 switchboard.json files, the RULE lives
    /// here: a declared "browser" surface with a web UI resolves to "window". Every other surface
    /// (god / tool / notch / batch) is a deliberate choice and passes through untouched, and an EXPLICIT
    /// surface picked in the store still wins because this only resolves the DEFAULT.
    @MainActor private func preferredSurface(_ l: SBListing) -> String {
        let declared = l.surfaces.first ?? "browser"
        guard declared == "browser", let u = l.components.ui?.url, !u.isEmpty else { return declared }
        return "window"
    }

    @MainActor private func launchWrapp(_ l: SBListing, _ surface: String) {
        hideStore()
        switch surface {
        case "window":
            // NATIVE launch — the wrapp runs in the bridged webview (window.claude tunneled to the
            // daemon by this process), so no browser and no extension are in the loop. Same daemon,
            // same grants, same consent drops as every other surface.
            if let s = l.components.ui?.url, let u = URL(string: s) {
                openWrappWindow(url: u, name: l.name)
                concierge(l)
            }
        case "browser", "notch":
            if let s = l.components.ui?.url, let u = URL(string: s) {
                NSWorkspace.shared.open(u)
                concierge(l)   // the notch acknowledges the launch — never a silent open
            }
        case "god":
            // The god surface = God WEARS the wrapp's skill. Resolve components.skills → the real skill
            // body, hand it to god.mjs (GOD_SKILL) so God can actually DO the skill in conversation.
            // Escalation to the full page stays available (its browser surface / the widget's Open).
            // Falls back to the page-open, then a light roleplay, only when there's no skill body.
            if let skill = resolveSkillContent(l) {
                concierge(l)   // notch names what God just put on — never a silent activation
                let opener = l.components.ui?.url != nil
                    ? " If a full editor would help, tell me and I'll open the \(l.name) page."
                    : ""
                triggerGod(instruction: "You now have the \(l.name) skill loaded (below). Wear it: apply it to whatever I'm working on. Ask me one short question about what I'd like help with, then help in that register.\(opener)", skill: skill, forceFullScreen: true)
            } else if let s = l.components.ui?.url, let u = URL(string: s) {
                NSWorkspace.shared.open(u); concierge(l)
            } else {
                triggerGod(instruction: "You are now the \(l.name) assistant. \(l.tagline) Ask me what I'd like to do, then help. Keep it to one short question first.", forceFullScreen: true)
            }
        case "batch":
            let action = l.components.workflows?.first.map { String($0.split(separator: "/").last ?? Substring($0)) } ?? "run"
            triggerGod(instruction: "Run the \(l.name) wrapp's \(action) step — call its tool through the gate. If it needs input, ask me one short question first.", forceFullScreen: true)
        default:
            if let s = l.components.ui?.url, let u = URL(string: s) { NSWorkspace.shared.open(u) }
        }
    }

    // ── the OS window's real launch (OSLaunch.handler) ─────────────────────────────────────────────
    // A tile in the Switchboard OS window passes the app id it references (e.g. a task's @tag, an
    // artifact's src, a calendar event's app) + item context. We resolve the id (case-insensitively,
    // by catalog id OR display name — the OS data uses friendly names like "Crest") to a listing and
    // open its page, appending `#os=<encoded {artifact,kind,project}>` so the wrapp opens AT the item —
    // the native twin of the web OS's `url + "#os=" + ctx` (examples/apps/src/os/os.js). No page to
    // open → fall back to God with the app's name so a tap is never a dead end.
    @MainActor func launchFromOS(_ appId: String, _ ctx: OSLaunchContext) {
        let key = appId.lowercased()
        let listing = readCatalog().first { $0.id.lowercased() == key || $0.name.lowercased() == key }
        guard let l = listing else {
            // Unknown app id: don't leave the tap dead — hand the name to God.
            triggerGod(instruction: "Open \(appId) for me — help me with whatever it does. Ask one short question first if you need to.", forceFullScreen: true)
            return
        }
        guard let s = l.components.ui?.url, var comps = URLComponents(string: s) else {
            // Listing with no page (skill/god-only wrapp): launch it through the normal resolver.
            launchWrapp(l, l.surfaces.first ?? "god")
            return
        }
        // Carry item context (mirrors the web `data-ctx` JSON; only non-nil fields).
        if !ctx.isEmpty {
            var obj: [String: String] = [:]
            if let a = ctx.artifact { obj["artifact"] = a }
            if let k = ctx.kind     { obj["kind"] = k }
            if let p = ctx.project  { obj["project"] = p }
            if let data = try? JSONSerialization.data(withJSONObject: obj),
               let json = String(data: data, encoding: .utf8) {
                comps.fragment = "os=" + (json.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? json)
            }
        }
        if let u = comps.url { NSWorkspace.shared.open(u); concierge(l) }
    }
}

// ════════════════════════ the wrapp store ════════════════════════
// A listing is a BILL OF MATERIALS (docs/WRAPP-STORE-MODAL.md §2): components (Axis A) × surfaces
// (Axis B) × requires. These mirror packages/protocol/src/store.ts exactly — the Swift side re-derives
// the same read-only resolver so the modal and the shared type can never disagree (same posture as the
// health ladder). The catalog is INGESTED per-repo (build-catalog.mjs) and read from ~/.relay/catalog.json.

struct SBUi: Codable { let kind: String; let url: String? }
struct SBComponents: Codable { let skills: [String]?; let workflows: [String]?; let ui: SBUi? }
struct SBReq: Codable {
    let kind: String; let name: String?; let klass: String?; let id: String?; let appId: String?; let lazy: Bool?
    enum CodingKeys: String, CodingKey { case kind, name, klass = "class", id, appId, lazy }
}
// One God-callable command from the tool registry (build-tools.mjs → catalog `tools`): the command
// (name), WHEN to use it (description), HOW to call it (inputSchema, key → "type — desc"). The native
// drive uses this to pick the command + shape args without loading the page. Optional everywhere.
struct SBTool: Codable { let name: String; let description: String?; let inputSchema: [String: String]? }
// A THIRD-PARTY tool binding: the listing runs a locally-configured MCP server's tool(s), not a page or
// a skill. `server` = the ~/.relay/mcp.json key; `tools` = the callable tool names on it. God drives it
// headless via claude_callTool through the gate — credentials stay in the daemon, never leave. Optional
// everywhere (only third-party `tool` listings carry it), so the strict SBListing decode is unaffected.
struct SBMcpBinding: Codable { let server: String; let tools: [String]? }
struct SBListing: Codable, Identifiable {
    let id: String; let name: String; let tagline: String; let icon: String?
    let category: String; let author: String?
    let components: SBComponents; let surfaces: [String]; let requires: [SBReq]; let inside: [String]?
    let tools: [SBTool]?
    // ── launcher routing (docs: LAUNCHER-ROUTING) — both optional, so every existing catalog still decodes.
    let keywords: [String]?   // the synonyms a name can't carry ("smaller", "shrink") — how a TYPED
                              // sentence finds this listing without naming it. See SBRoute.score.
    let accepts: [String]?    // which dropped files this listing can take: "image" / "image/*" / ".pdf"
                              // / "*". Absent → SBRoute.defaultAccepts decides. See SBRoute.accepts.
    let hidden: Bool?   // true → UNLISTED: kept in the catalog (still resolvable/runnable if already
                        // installed) but dropped from every store grid. Flip false / remove to re-list.
    let provenance: String?   // "third-party" → a tool we didn't build; the store + consent card badge it.
    let mcp: SBMcpBinding?     // present → this is a third-party MCP tool (driveThirdPartyTool), not a wrapp.
    var isThirdParty: Bool { provenance == "third-party" || mcp != nil }
}
struct SBCatalog: Codable { let version: Int; let count: Int; let listings: [SBListing] }

// Live copy first (the aggregator refreshes it), then a bundled fallback so a packaged app is never empty.
// Per-wrapp icon art (the "Instruments on the board" renders, bundled at Resources/icons/<id>.png).
// Cached; nil → the caller falls back to the category glyph. NSCache keeps memory honest.
private let storeIconCache = NSCache<NSString, NSImage>()
func storeIcon(_ id: String) -> NSImage? {
    if let hit = storeIconCache.object(forKey: id as NSString) { return hit }
    guard let res = Bundle.main.resourcePath else { return nil }
    let path = (res as NSString).appendingPathComponent("icons/\(id).png")
    guard let img = NSImage(contentsOfFile: path) else { return nil }
    storeIconCache.setObject(img, forKey: id as NSString)
    return img
}

func readCatalog() -> [SBListing] {
    let live = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/catalog.json")
    let bundled = (Bundle.main.resourcePath as NSString?)?.appendingPathComponent("catalog.json")
    for path in [live, bundled].compactMap({ $0 }) {
        guard let data = FileManager.default.contents(atPath: path) else { continue }
        if let cat = try? JSONDecoder().decode(SBCatalog.self, from: data) { return cat.listings }
    }
    return []
}

// The resolver — a straight port of resolveRequirements/primaryAction from store.ts.
struct Present { let daemon: Bool; let signedIn: Bool; let cloud: Bool; let local: Bool; let caps: Set<String> }
enum ReqState { case met, unmet, lazy }
struct ResolvedReq: Identifiable { let id = UUID(); let req: SBReq; let state: ReqState; let label: String }

func reqLabel(_ r: SBReq) -> String {
    switch r.kind {
    case "daemon": return "Mac app awake"
    case "model": return r.klass == "cloud" ? "Signed in · a cloud model" : "A local model"
    case "capability": return r.name ?? "a capability"
    case "connector": return "connect \(r.id ?? "")"
    case "native": return "install \(r.appId ?? "")"
    default: return r.kind
    }
}
func reqMet(_ r: SBReq, _ p: Present) -> Bool {
    switch r.kind {
    case "daemon": return p.daemon
    case "model": return r.klass == "cloud" ? p.cloud : p.local
    case "capability": return p.caps.contains(r.name ?? "")
    default: return false   // connector / native: not observable from here yet (Phase 2 resolver)
    }
}
func resolveReqs(_ l: SBListing, _ p: Present) -> [ResolvedReq] {
    l.requires.map { r in
        let lazy = r.kind == "capability" && (r.lazy ?? false)
        let st: ReqState = lazy ? .lazy : (reqMet(r, p) ? .met : .unmet)
        return ResolvedReq(req: r, state: st, label: reqLabel(r))
    }
}
func unmetCount(_ rs: [ResolvedReq]) -> Int { rs.filter { $0.state == .unmet }.count }
// (label, surface) — the surface-aware button. Honest per surface:
//   • god                  → "Activate into God" (a skill is worn, not "run")
//   • browser/window/notch → "Open" — a page is opened; its OWN in-page consent handles capabilities,
//                            so the store never says "resolve" for something it doesn't gate.
//   • batch                → daemon-launched + headless, so it genuinely gates on unmet needs.
func primaryLabel(_ l: SBListing, _ rs: [ResolvedReq]) -> (String, String) {
    let surface = l.surfaces.first ?? "browser"
    switch surface {
    case "god": return ("Activate into God", surface)
    case "browser", "window", "notch": return ("Open", surface)
    default:
        let n = unmetCount(rs)
        return n > 0 ? ("Resolve \(n) thing\(n > 1 ? "s" : "") & Run", surface) : ("Run", surface)
    }
}

func catGlyph(_ c: String) -> String {
    switch c {
    case "studio": return "square.stack.3d.up.fill"
    case "agent": return "bolt.horizontal.circle.fill"
    case "skill": return "sparkles"
    case "fun": return "gamecontroller.fill"
    default: return "wrench.and.screwdriver.fill"
    }
}
func catTint(_ c: String) -> Color {
    switch c { case "studio": return .lime; case "agent": return .ok; case "skill": return .lime; case "fun": return .danger; default: return .inkDim }
}
func surfGlyph(_ s: String) -> String {
    switch s {
    case "god": return "sparkles"
    case "batch": return "bolt.fill"
    case "browser": return "globe"
    case "window": return "macwindow"
    case "notch": return "rectangle.topthird.inset.filled"
    default: return "app"
    }
}

// The store modal — the HeyClicky Skills-Library shape (rail + detail + one big activate button), but
// the detail is the bill of materials: MADE OF (components) · RUNS ON (surfaces) · NEEDS (requires,
// live-diffed). Read-only resolver (the fill drawer is Phase 2); the button never says Run then walls you.
struct StoreView: View {
    let listings: [SBListing]
    let present: Present
    let onLaunch: (SBListing, String) -> Void
    let onClose: () -> Void
    let onAddLocal: () -> Void   // D: pick a local wrapp folder → validate → merge into the catalog
    @State private var category: String
    @State private var selectedId: String? = nil

    // `initialCategory` lets the front-page tabs open the store PRE-FILTERED ("apps" = non-skill, "skill",
    // or "All"). SwiftUI needs the explicit init to seed a @State default.
    init(listings: [SBListing], present: Present,
         onLaunch: @escaping (SBListing, String) -> Void,
         onClose: @escaping () -> Void,
         onAddLocal: @escaping () -> Void,
         initialCategory: String = "All") {
        self.listings = listings; self.present = present
        self.onLaunch = onLaunch; self.onClose = onClose; self.onAddLocal = onAddLocal
        _category = State(initialValue: initialCategory)
    }

    private var categories: [String] {
        var seen: [String] = []
        for l in listings where !seen.contains(l.category) { seen.append(l.category) }
        return ["All"] + seen
    }
    // "apps" is a synthetic filter = everything that isn't a skill (the Apps tab); "All" = everything.
    private var filtered: [SBListing] {
        switch category {
        case "All":  return listings
        case "apps": return listings.filter { $0.category != "skill" }
        default:     return listings.filter { $0.category == category }
        }
    }
    private var selected: SBListing? { filtered.first { $0.id == selectedId } ?? filtered.first }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            chipsRow
            Rectangle().fill(Color.edge).frame(height: 1)
            if listings.isEmpty {
                emptyState
            } else {
                HStack(spacing: 0) {
                    railList.frame(width: 224)
                    Rectangle().fill(Color.edge).frame(width: 1)
                    detail.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
        }
        .frame(width: 724, height: 476)
        .background(RoundedRectangle(cornerRadius: 20).fill(Color.page))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Wrapp Store").font(.brico(21, .bold)).foregroundColor(.ink)
                Text("Everything Switchboard can run for you.").font(.hanken(12)).foregroundColor(.inkDim)
            }
            Spacer(minLength: 0)
            Button(action: onAddLocal) {
                HStack(spacing: 5) {
                    Image(systemName: "plus").font(.system(size: 10, weight: .bold))
                    Text("Add local").font(.hanken(11, .semibold))
                }.foregroundColor(.ink).padding(.horizontal, 11).padding(.vertical, 7)
                 .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
            }.buttonStyle(.plain).help("Add a local wrapp folder (its switchboard.json)")
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundColor(.inkDim)
                    .frame(width: 26, height: 26).background(Circle().fill(Color.raised))
            }.buttonStyle(.plain)
        }.padding(.horizontal, 22).padding(.top, 20).padding(.bottom, 14)
    }

    private var chipsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(categories, id: \.self) { c in
                    let on = category == c
                    Button(action: { category = c; selectedId = nil }) {
                        Text(c == "All" ? "All" : c.capitalized).font(.hanken(11.5, on ? .semibold : .medium))
                            .foregroundColor(on ? .rail : .ink)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(RoundedRectangle(cornerRadius: 8).fill(on ? Color.lime : Color.raised))
                    }.buttonStyle(.plain)
                }
            }.padding(.horizontal, 22)
        }.frame(height: 46)
    }

    private var railList: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 2) {
                ForEach(filtered) { l in
                    let on = (selected?.id == l.id)
                    Button(action: { selectedId = l.id }) {
                        HStack(spacing: 10) {
                            glyphTile(l, 34)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(l.name).font(.hanken(12.5, .semibold)).foregroundColor(.ink).lineLimit(1)
                                Text(l.category.capitalized).font(.splMono(9)).foregroundColor(.inkFaint)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 9).fill(on ? Color.raised : Color.clear))
                    }.buttonStyle(.plain)
                }
            }.padding(.horizontal, 10).padding(.vertical, 10)
        }
    }

    @ViewBuilder private func glyphTile(_ l: SBListing, _ size: CGFloat) -> some View {
        if let img = storeIcon(l.id) {
            // the real "Instruments on the board" hardware icon (Resources/icons/<id>.png)
            Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fill)
                .frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: size * 0.22))
        } else {
            RoundedRectangle(cornerRadius: size * 0.22).fill(catTint(l.category).opacity(0.16))
                .overlay(Image(systemName: catGlyph(l.category)).font(.system(size: size * 0.42)).foregroundColor(catTint(l.category)))
                .frame(width: size, height: size)
        }
    }

    @ViewBuilder private var detail: some View {
        if let l = selected {
            let resolved = resolveReqs(l, present)
            let (label, surface) = primaryLabel(l, resolved)
            // browser/window/notch open a page — never blocked by a capability the page resolves itself;
            // god/batch need the daemon + a model, so gate them on the resolver.
            let runnable = (surface == "browser" || surface == "window" || surface == "notch")
                ? (l.components.ui?.url != nil) : (unmetCount(resolved) == 0)
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 13) {
                        glyphTile(l, 52)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text(l.name).font(.brico(19, .bold)).foregroundColor(.ink)
                                Text(l.category.capitalized).font(.splMono(9)).foregroundColor(catTint(l.category))
                                    .padding(.horizontal, 7).padding(.vertical, 2)
                                    .background(RoundedRectangle(cornerRadius: 6).fill(catTint(l.category).opacity(0.14)))
                            }
                            Text(l.tagline).font(.hanken(12.5)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
                            if let a = l.author { Text("by \(a)").font(.splMono(9)).foregroundColor(.inkFaint) }
                        }
                        Spacer(minLength: 0)
                    }

                    section("MADE OF") {
                        FlowChips(items: madeOf(l))
                    }
                    section("RUNS ON") {
                        HStack(spacing: 7) {
                            ForEach(l.surfaces, id: \.self) { s in
                                HStack(spacing: 5) {
                                    Image(systemName: surfGlyph(s)).font(.system(size: 10))
                                    Text(s).font(.hanken(11, .medium))
                                }.foregroundColor(.ink)
                                    .padding(.horizontal, 9).padding(.vertical, 5)
                                    .background(RoundedRectangle(cornerRadius: 7).fill(Color.raised))
                            }
                        }
                    }
                    section("NEEDS") {
                        VStack(alignment: .leading, spacing: 7) {
                            ForEach(resolved) { r in
                                HStack(spacing: 8) {
                                    Image(systemName: r.state == .met ? "checkmark.circle.fill" : (r.state == .lazy ? "clock" : "circle"))
                                        .font(.system(size: 12))
                                        .foregroundColor(r.state == .met ? .lime : (r.state == .lazy ? .inkFaint : .inkDim))
                                    Text(r.label).font(.hanken(12)).foregroundColor(r.state == .met ? .inkDim : .ink)
                                    if r.state == .lazy { Text("on use").font(.splMono(9)).foregroundColor(.inkFaint) }
                                    Spacer(minLength: 0)
                                }
                            }
                        }
                    }
                    if let inside = l.inside, !inside.isEmpty {
                        section("INSIDE THIS WRAPP") {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(inside, id: \.self) { line in
                                    HStack(alignment: .top, spacing: 8) {
                                        Image(systemName: "plus").font(.system(size: 9, weight: .bold)).foregroundColor(.lime).padding(.top, 3)
                                        Text(line).font(.hanken(12)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                            }
                        }
                    }

                    Button(action: { if runnable { onLaunch(l, surface) } }) {
                        HStack(spacing: 7) {
                            Image(systemName: surface == "god" ? "sparkles" : (surface == "batch" ? "play.fill" : "arrow.up.forward")).font(.system(size: 12, weight: .bold))
                            Text(label).font(.hanken(13, .semibold))
                        }.foregroundColor(runnable ? .rail : .inkFaint)
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(RoundedRectangle(cornerRadius: 10).fill(runnable ? Color.lime : Color.raised))
                    }.buttonStyle(.plain).disabled(!runnable)
                }.padding(18)
            }
        } else {
            Color.clear
        }
    }

    private func madeOf(_ l: SBListing) -> [(String, String)] {
        var out: [(String, String)] = []
        if let s = l.components.skills, !s.isEmpty { out.append(("sparkles", "\(s.count) skill\(s.count == 1 ? "" : "s")")) }
        if let w = l.components.workflows, !w.isEmpty { out.append(("bolt.fill", "\(w.count) workflow\(w.count == 1 ? "" : "s")")) }
        if l.components.ui != nil { out.append(("rectangle.on.rectangle", "UI")) }
        return out
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).kicker()
            content()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.2x2").font(.system(size: 26)).foregroundColor(.inkFaint)
            Text("No catalog yet").font(.hanken(13, .semibold)).foregroundColor(.ink)
            Button(action: onAddLocal) {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                    Text("Add a local wrapp…").font(.hanken(12, .semibold))
                }.foregroundColor(.page).padding(.horizontal, 14).padding(.vertical, 8)
                 .background(RoundedRectangle(cornerRadius: 9).fill(Color.lime))
            }.buttonStyle(.plain)
            Text("or run the aggregator: node examples/apps/wrapps/build-catalog.mjs").font(.splMono(9.5)).foregroundColor(.inkFaint)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// A tiny wrapping row of labelled chips (MADE OF). Kept simple — a horizontal HStack; the set is small.
struct FlowChips: View {
    let items: [(String, String)]
    var body: some View {
        HStack(spacing: 7) {
            ForEach(items.indices, id: \.self) { i in
                HStack(spacing: 5) {
                    Image(systemName: items[i].0).font(.system(size: 10))
                    Text(items[i].1).font(.hanken(11, .medium))
                }.foregroundColor(.inkDim)
                    .padding(.horizontal, 9).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color.panel))
            }
        }
    }
}

// App bootstrap lives in main.swift (multi-file build requires top-level code there).
