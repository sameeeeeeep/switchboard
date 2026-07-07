// Relay — macOS menu-bar app. The visible face of the sidekick: shows connected/offline, copies
// the pairing token, opens logs, and starts/restarts/stops the background daemon (the LaunchAgent
// installed by `npm run daemon:install`). This is the shell that becomes the eventual .dmg — a
// regular user double-clicks it and never sees a terminal.
import AppKit
import Darwin

let LABEL = "com.relay.sidekick"
let PORT: UInt16 = 8787
let RELAY_DIR = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
let TOKEN_FILE = (RELAY_DIR as NSString).appendingPathComponent("pairing-token")
let LOG_FILE = (RELAY_DIR as NSString).appendingPathComponent("sidekick.log")
let PLIST = (NSHomeDirectory() as NSString).appendingPathComponent("Library/LaunchAgents/\(LABEL).plist")

// Lime #C8F250 — brandbrain's accent — signals connected.
let LIME = NSColor(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0, alpha: 1)

@MainActor
final class RelayController: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private var running = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // menu-bar only, no Dock icon
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            if let img = NSImage(systemSymbolName: "bolt.horizontal.circle.fill", accessibilityDescription: "Relay") {
                img.isTemplate = true
                button.image = img
            } else {
                button.title = "Relay"
            }
            button.contentTintColor = .secondaryLabelColor
        }
        rebuildMenu()
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 4.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    private func setRunning(_ r: Bool) {
        let changed = r != running
        running = r
        statusItem.button?.contentTintColor = r ? LIME : .secondaryLabelColor
        if changed { rebuildMenu() }
    }

    private func poll() {
        checkReachable { ok in
            Task { @MainActor in self.setRunning(ok) }
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

    private func rebuildMenu() {
        let menu = NSMenu()
        let header = NSMenuItem(title: running ? "● Sidekick running" : "○ Sidekick offline", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        add(menu, "Copy pairing token", #selector(copyToken))
        add(menu, "Open logs", #selector(openLogs))
        menu.addItem(.separator())
        add(menu, running ? "Restart sidekick" : "Start sidekick", #selector(startOrRestart))
        if running { add(menu, "Stop sidekick", #selector(stopDaemon)) }
        menu.addItem(.separator())
        add(menu, "Quit Relay", #selector(quit), key: "q")
        statusItem.menu = menu
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
        flash("✓ Token copied — paste into the Relay side panel")
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
