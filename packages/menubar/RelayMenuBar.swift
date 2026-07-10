// Switchboard — macOS menu-bar app. The ambient face of the sidekick: the REAL Switchboard glyph
// (lime rounded square, dark top-right notch) that lights when the daemon runs and PULSES while
// your model is actually working; a menu that shows what you own (the context library), which apps
// are connected, and what just happened (the audit tail) — read straight from ~/.relay's files.
// Controls stay: pairing token, logs, start/restart/stop the LaunchAgent. No terminal required.
import AppKit
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

// Lime #C8F250 — the house accent — signals connected. Page #0A0C10 is the notch.
let LIME = NSColor(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0, alpha: 1)
let PAGE = NSColor(red: 0x0A/255.0, green: 0x0C/255.0, blue: 0x10/255.0, alpha: 1)
let SLATE = NSColor(red: 0x6E/255.0, green: 0x7C/255.0, blue: 0x90/255.0, alpha: 1)

// ---------- the glyph, drawn in code so it matches the chip/panel mark exactly ----------
// A rounded square with a small page-dark dot inset at the top-right. Lime when the sidekick runs,
// slate when offline; while the model is WORKING the whole mark breathes (alpha pulse per tick).
func glyphImage(running: Bool, working: Bool, phase: Int) -> NSImage {
    let size = NSSize(width: 18, height: 18)
    let img = NSImage(size: size, flipped: false) { rect in
        let body = running ? LIME : SLATE
        let alpha: CGFloat = working ? (phase % 2 == 0 ? 1.0 : 0.55) : 1.0
        body.withAlphaComponent(alpha).setFill()
        let r = rect.insetBy(dx: 1.5, dy: 1.5)
        NSBezierPath(roundedRect: r, xRadius: 4.5, yRadius: 4.5).fill()
        // the notch: a page-dark dot inset top-right (matches .glyph::after in the panel css)
        PAGE.withAlphaComponent(alpha).setFill()
        let d: CGFloat = 3.6
        let dot = NSRect(x: r.maxX - d - 3.0, y: r.maxY - d - 3.0, width: d, height: d)
        NSBezierPath(ovalIn: dot).fill()
        return true
    }
    img.isTemplate = false // it carries the brand colour on purpose
    return img
}

// ---------- tiny readers over ~/.relay (the daemon's world, as files) ----------
struct Ctx { let id: String; let name: String; let kind: String }
struct Grantee { let origin: String; let mode: String }
struct AuditRow { let ts: Double; let origin: String; let what: String; let note: String }

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
func readDefaultContext(_ contexts: [Ctx]) -> Ctx? {
    guard let sel = readJSON(SELECTION_FILE) as? [String: String], let id = sel["*global*"] else { return nil }
    return contexts.first { $0.id == id }
}
func readGrants() -> [Grantee] {
    // grants.json is either an array of grants or an {origin: grant} map — accept both.
    if let arr = readJSON(GRANTS_FILE) as? [[String: Any]] {
        return arr.compactMap { g in (g["origin"] as? String).map { Grantee(origin: $0, mode: (g["mode"] as? String) ?? "ask") } }
    }
    if let map = readJSON(GRANTS_FILE) as? [String: [String: Any]] {
        return map.map { Grantee(origin: $0.key, mode: ($0.value["mode"] as? String) ?? "ask") }.sorted { $0.origin < $1.origin }
    }
    return []
}
func readAuditTail(_ n: Int) -> [AuditRow] {
    guard let data = FileManager.default.contents(atPath: AUDIT_FILE),
          let text = String(data: data.suffix(16_384), encoding: .utf8) else { return [] }
    var rows: [AuditRow] = []
    for line in text.split(separator: "\n").reversed() {
        guard let d = line.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let ts = o["ts"] as? Double, let origin = o["origin"] as? String else { continue }
        let what = (o["toolName"] as? String) ?? (o["method"] as? String) ?? (o["kind"] as? String) ?? "event"
        let note = (o["note"] as? String) ?? ""
        // skip the chatter that means nothing to a human glancing at a menu
        if ["claude_permissions", "claude_capabilities", "claude_context", "claude_storage"].contains(what) { continue }
        rows.append(AuditRow(ts: ts, origin: origin, what: what, note: note))
        if rows.count == n { break }
    }
    return rows
}
func host(_ origin: String) -> String {
    origin.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
}
func ago(_ ts: Double) -> String {
    let s = max(0, Date().timeIntervalSince1970 - ts / 1000)
    if s < 60 { return "\(Int(s))s ago" }
    if s < 3600 { return "\(Int(s / 60))m ago" }
    if s < 86_400 { return "\(Int(s / 3600))h ago" }
    return "\(Int(s / 86_400))d ago"
}
func humanize(_ what: String) -> String {
    if what.contains("__publish") { return "published" }
    if what.contains("__get") { return "read storage" }
    if what.contains("__set") { return "saved" }
    if what.contains("__use") { return "borrowed context" }
    if what == "connect" { return "connected" }
    if what == "consent" { return "asked consent" }
    if what.hasPrefix("mcp__") { return what.components(separatedBy: "__").last ?? what }
    return what
}

@MainActor
final class RelayController: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private var running = false
    private var working = false
    private var phase = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // menu-bar only, no Dock icon
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = glyphImage(running: false, working: false, phase: 0)
        let menu = NSMenu()
        menu.delegate = self // rebuilt fresh on every open, so the data is never stale
        statusItem.menu = menu
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    private func setState(running r: Bool, working w: Bool) {
        running = r
        working = w
        phase += 1
        statusItem.button?.image = glyphImage(running: r, working: w, phase: phase)
        statusItem.button?.toolTip = !r ? "Switchboard — sidekick offline"
            : w ? "Switchboard — your model is working…" : "Switchboard — connected, idle"
    }

    private func poll() {
        checkReachable { ok in
            self.checkWorking { busy in
                Task { @MainActor in self.setState(running: ok, working: ok && busy) }
            }
        }
    }

    // Blocking connect to loopback is instant (connects or refuses immediately) — run off-main.
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

    // "Is the model working RIGHT NOW?" — a live `claude … stream-json` child means a stream is
    // executing (the audit log can't tell you this; the process table can).
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

    // ---------- the menu: rebuilt fresh each open ----------
    func menuWillOpen(_ menu: NSMenu) {
        menu.removeAllItems()
        header(menu, running ? (working ? "● Switchboard — model working…" : "● Switchboard — connected") : "○ Switchboard — sidekick offline")
        menu.addItem(.separator())

        if running {
            let contexts = readContexts()
            let def = readDefaultContext(contexts)

            section(menu, "YOUR LIBRARY — \(contexts.count) context\(contexts.count == 1 ? "" : "s")")
            if contexts.isEmpty {
                dim(menu, "Nothing yet — build a brand in brandbrain")
            } else {
                for c in contexts.prefix(7) {
                    let star = (def?.id == c.id) ? "  ★ default" : ""
                    dim(menu, "\(c.name)  ·  \(c.kind)\(star)")
                }
                if contexts.count > 7 { dim(menu, "… and \(contexts.count - 7) more") }
            }
            menu.addItem(.separator())

            let grants = readGrants()
            section(menu, "APPS CONNECTED — \(grants.count)")
            for g in grants.prefix(6) { dim(menu, "\(host(g.origin))  ·  \(g.mode)") }
            if grants.isEmpty { dim(menu, "None yet — open one from the Wrapp Store") }
            menu.addItem(.separator())

            let audit = readAuditTail(4)
            section(menu, "JUST HAPPENED")
            if audit.isEmpty { dim(menu, "Quiet so far") }
            for a in audit {
                let note = a.note.isEmpty ? "" : " “\(String(a.note.prefix(28)))”"
                dim(menu, "\(host(a.origin).prefix(28)) \(humanize(a.what))\(note)  ·  \(ago(a.ts))")
            }
            menu.addItem(.separator())
        }

        add(menu, "Copy pairing token", #selector(copyToken))
        add(menu, "Open logs", #selector(openLogs))
        menu.addItem(.separator())
        add(menu, running ? "Restart sidekick" : "Start sidekick", #selector(startOrRestart))
        if running { add(menu, "Stop sidekick", #selector(stopDaemon)) }
        menu.addItem(.separator())
        add(menu, "Quit Switchboard", #selector(quit), key: "q")
    }

    private func header(_ menu: NSMenu, _ title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        menu.addItem(item)
    }
    private func section(_ menu: NSMenu, _ title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.attributedTitle = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 10, weight: .semibold),
            .foregroundColor: NSColor.secondaryLabelColor,
            .kern: 0.8,
        ])
        menu.addItem(item)
    }
    private func dim(_ menu: NSMenu, _ title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.attributedTitle = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 12.5),
            .foregroundColor: NSColor.labelColor,
        ])
        menu.addItem(item)
    }
    private func add(_ menu: NSMenu, _ title: String, _ action: Selector, key: String = "") {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        menu.addItem(item)
    }

    @objc private func copyToken() {
        guard let token = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8) else {
            flash("No token yet — start the sidekick first")
            return
        }
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(token.trimmingCharacters(in: .whitespacesAndNewlines), forType: .string)
        flash("✓ Token copied — paste into the Switchboard side panel")
    }

    @objc private func openLogs() {
        NSWorkspace.shared.open(URL(fileURLWithPath: LOG_FILE))
    }

    @objc private func startOrRestart() {
        let uid = getuid()
        if running {
            launchctl(["kickstart", "-k", "gui/\(uid)/\(LABEL)"])
        } else if FileManager.default.fileExists(atPath: PLIST) {
            launchctl(["bootstrap", "gui/\(uid)", PLIST])
        } else {
            flash("Sidekick not installed — run: npm run daemon:install")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.poll() }
    }

    @objc private func stopDaemon() {
        launchctl(["bootout", "gui/\(getuid())/\(LABEL)"])
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.poll() }
    }

    @objc private func quit() { NSApp.terminate(nil) }

    private func launchctl(_ args: [String]) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = args
        try? p.run()
        p.waitUntilExit()
    }

    // Briefly show a message in the status header (menu is closed on click, so also set the tooltip).
    private func flash(_ message: String) {
        statusItem.button?.toolTip = message
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let controller = RelayController()
    app.delegate = controller
    app.run() // blocks for the program's lifetime, so `controller` stays retained
}
