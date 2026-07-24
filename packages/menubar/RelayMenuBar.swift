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
extension Color {
    static let page = Color(red: 0x0A/255.0, green: 0x0C/255.0, blue: 0x10/255.0)
    static let panel = Color(red: 0x12/255.0, green: 0x15/255.0, blue: 0x1C/255.0)
    static let raised = Color(red: 0x1A/255.0, green: 0x1F/255.0, blue: 0x29/255.0)
    static let edge = Color(red: 0x26/255.0, green: 0x2C/255.0, blue: 0x38/255.0)
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim = Color(red: 0x99/255.0, green: 0xA3/255.0, blue: 0xB7/255.0)
    static let inkFaint = Color(red: 0x6E/255.0, green: 0x7C/255.0, blue: 0x90/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
}

// ---------- the status-bar glyph (matches the chip/panel mark) ----------
func glyphImage(running: Bool, working: Bool, phase: Int) -> NSImage {
    let size = NSSize(width: 18, height: 18)
    let img = NSImage(size: size, flipped: false) { rect in
        // Stopped: draw in black and let template rendering recolor it — slate #6E7C90 was
        // near-invisible against a dark menu bar, which is exactly the state a first-run user
        // must find. Running: keep the lime brand mark (template off, see below).
        let body = running ? LIME_NS : NSColor.black
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
    @Published var contexts: [Ctx] = []
    @Published var defaultId: String? = nil
    @Published var apps = 0
    @Published var last: LastAct? = nil
    @Published var plist: PlistState = plistState()
    let bundled = hasBundledDaemon()
    let translocated = isTranslocated()
    var toast: String? = nil { didSet { objectWillChange.send() } }

    func refreshFiles() {
        contexts = readContexts()
        defaultId = readDefaultId()
        apps = readGrantCount()
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
    let onToken: () -> Void
    let onLogs: () -> Void
    let onRestart: () -> Void
    let onStop: () -> Void
    let onTakeOver: () -> Void
    let onRepair: () -> Void
    let onQuit: () -> Void
    @State private var breathe = false

    // The hero's one supporting line: who it's working for, or what's on the bench.
    private var momentMeta: String {
        if model.working, let a = model.last { return "for \(hostOf(a.origin))" }
        if model.working { return "on your Claude" }
        if model.running { return "\(model.contexts.count) context\(model.contexts.count == 1 ? "" : "s") banked · \(model.apps) app\(model.apps == 1 ? "" : "s") connected" }
        if model.bundled && model.translocated { return "move Switchboard to /Applications, then reopen it" }
        return "start the sidekick below"
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
                    Circle()
                        .fill(model.running ? Color(red: 0x3D/255.0, green: 0xD6/255.0, blue: 0x8C/255.0) : Color.inkFaint)
                        .frame(width: 7, height: 7)
                        .shadow(color: model.running ? Color(red: 0x3D/255.0, green: 0xD6/255.0, blue: 0x8C/255.0).opacity(0.6) : .clear, radius: 4)
                    Text(model.running ? "on" : "off").font(.system(size: 12, weight: .semibold)).foregroundColor(.inkDim)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 13)
            Rectangle().fill(Color.edge).frame(height: 1)

            // ---- THE MOMENT — the only hero a menubar deserves: what is my AI doing right now? ----
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Circle()
                        .fill(model.working ? Color.lime : (model.running ? Color.inkFaint : Color.inkFaint.opacity(0.4)))
                        .frame(width: 10, height: 10)
                        .opacity(model.working ? (breathe ? 1.0 : 0.25) : 1.0)
                        .shadow(color: model.working ? Color.lime.opacity(0.7) : .clear, radius: 6)
                        .animation(model.working ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true) : .default, value: breathe)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.working ? "Working" : (model.running ? "Idle" : "Offline"))
                            .font(.system(size: 19, weight: .bold))
                            .foregroundColor(model.working ? .lime : (model.running ? .ink : .inkDim))
                        Text(momentMeta)
                            .font(.system(size: 11))
                            .foregroundColor(.inkDim)
                            .lineLimit(1)
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
        .frame(width: 324)
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
                if let l = label { Text(l).font(.system(size: 10.5, weight: .medium)) }
            }
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

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = glyphImage(running: false, working: false, phase: 0)
        statusItem.button?.action = #selector(togglePopover)
        statusItem.button?.target = self

        hosting = NSHostingView(rootView: Panel(
            model: model,
            onToken: { [weak self] in self?.copyToken() },
            onLogs: { NSWorkspace.shared.open(URL(fileURLWithPath: LOG_FILE)) },
            onRestart: { [weak self] in self?.startOrRestart() },
            onStop: { [weak self] in self?.stopDaemon() },
            onTakeOver: { [weak self] in self?.takeOverDaemon() },
            onRepair: { [weak self] in self?.repairDaemon() },
            onQuit: { NSApp.terminate(nil) }
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
                    self.model.running = ok
                    self.model.working = ok && busy
                    self.phase += 1
                    self.statusItem.button?.image = glyphImage(running: ok, working: ok && busy, phase: self.phase)
                    self.statusItem.button?.toolTip = !ok ? "Switchboard — sidekick offline"
                        : (ok && busy) ? "Switchboard — your model is working…" : "Switchboard — connected"
                    if self.panel.isVisible { self.model.refreshFiles() }
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
