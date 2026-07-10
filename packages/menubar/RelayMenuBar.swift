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
        let body = running ? LIME_NS : SLATE_NS
        let alpha: CGFloat = working ? (phase % 2 == 0 ? 1.0 : 0.55) : 1.0
        body.withAlphaComponent(alpha).setFill()
        let r = rect.insetBy(dx: 1.5, dy: 1.5)
        NSBezierPath(roundedRect: r, xRadius: 4.5, yRadius: 4.5).fill()
        PAGE_NS.withAlphaComponent(alpha).setFill()
        let d: CGFloat = 3.6
        NSBezierPath(ovalIn: NSRect(x: r.maxX - d - 3.0, y: r.maxY - d - 3.0, width: d, height: d)).fill()
        return true
    }
    img.isTemplate = false
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
    var toast: String? = nil { didSet { objectWillChange.send() } }

    func refreshFiles() {
        contexts = readContexts()
        defaultId = readDefaultId()
        apps = readGrantCount()
        last = readLastAct()
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
    let onQuit: () -> Void
    @State private var breathe = false

    private var defaultCtx: Ctx? { model.contexts.first { $0.id == model.defaultId } }
    private var others: [Ctx] { model.contexts.filter { $0.id != model.defaultId } }

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

            VStack(alignment: .leading, spacing: 18) {
                // ---- the moment: only exists when something is happening ----
                if model.running && model.working {
                    HStack(spacing: 8) {
                        Circle().fill(Color.lime).frame(width: 6, height: 6)
                            .opacity(breathe ? 1.0 : 0.3)
                            .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: breathe)
                        Text("your model is working")
                            .font(.system(size: 10, weight: .semibold)).kerning(1.2)
                            .foregroundColor(.lime)
                        if let a = model.last {
                            Text("· for \(hostOf(a.origin).prefix(26))")
                                .font(.system(size: 10)).foregroundColor(.inkFaint)
                        }
                        Spacer()
                    }
                }

                // ---- working on: the hero card, straight from the panel ----
                VStack(alignment: .leading, spacing: 8) {
                    Text("WORKING ON").kicker()
                    HStack(spacing: 11) {
                        RoundedRectangle(cornerRadius: 2).fill(Color.lime).frame(width: 3, height: 34)
                        Text(String((defaultCtx?.name ?? "—").prefix(1)).uppercased())
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(defaultCtx != nil ? .page : .inkFaint)
                            .frame(width: 32, height: 32)
                            .background(RoundedRectangle(cornerRadius: 9).fill(defaultCtx != nil ? Color.lime : Color.raised))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(defaultCtx?.name ?? "No default yet")
                                .font(.system(size: 15, weight: .bold)).foregroundColor(defaultCtx != nil ? .ink : .inkDim)
                            Text(defaultCtx != nil ? "\(defaultCtx!.kind) · lent to apps that ask" : "pick one in the side panel")
                                .font(.system(size: 10.5)).foregroundColor(.inkFaint)
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 13).fill(LinearGradient(colors: [Color.raised, Color.panel], startPoint: .top, endPoint: .bottom)))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(Color.edge, lineWidth: 1))
                }

                // ---- the rest of the library: a marks strip, hover for names ----
                if !others.isEmpty || model.apps > 0 {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("LIBRARY").kicker()
                            Spacer()
                            Text("\(model.contexts.count) contexts · \(model.apps) apps")
                                .font(.system(size: 10, design: .monospaced)).foregroundColor(.inkFaint)
                        }
                        HStack(spacing: 6) {
                            ForEach(others.prefix(9)) { c in
                                Text(String(c.name.prefix(1)).uppercased())
                                    .font(.system(size: 11, weight: .bold)).foregroundColor(.inkDim)
                                    .frame(width: 24, height: 24)
                                    .background(RoundedRectangle(cornerRadius: 7).fill(Color.raised))
                                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.edge, lineWidth: 1))
                                    .help("\(c.name) · \(c.kind)")
                            }
                            if others.count > 9 {
                                Text("+\(others.count - 9)")
                                    .font(.system(size: 10, weight: .semibold)).foregroundColor(.inkFaint)
                                    .frame(width: 24, height: 24)
                                    .background(RoundedRectangle(cornerRadius: 7).fill(Color.panel))
                            }
                            Spacer()
                        }
                    }
                }

                // ---- one line of life ----
                if model.running, let a = model.last, !model.working {
                    HStack(spacing: 8) {
                        Circle().fill(Color.lime.opacity(0.7)).frame(width: 5, height: 5)
                        (Text(hostOf(a.origin).prefix(24)).foregroundColor(.ink).fontWeight(.semibold)
                            + Text("  \(a.verb)\(a.note.isEmpty ? "" : " \u{201C}\(a.note.prefix(20))\u{201D}")").foregroundColor(.inkDim))
                            .font(.system(size: 11)).lineLimit(1)
                        Spacer()
                        Text(agoText(a.ts)).font(.system(size: 10, design: .monospaced)).foregroundColor(.inkFaint)
                    }
                }
            }
            .padding(16)

            Rectangle().fill(Color.edge).frame(height: 1)

            // ---- quiet controls ----
            HStack(spacing: 8) {
                GhostButton(icon: "doc.on.doc", label: "token", action: onToken)
                GhostButton(icon: "text.alignleft", label: "logs", action: onLogs)
                GhostButton(icon: "arrow.clockwise", label: model.running ? "restart" : "start", action: onRestart)
                Spacer()
                if let t = model.toast {
                    Text(t).font(.system(size: 10)).foregroundColor(.lime).lineLimit(1)
                }
                GhostButton(icon: "power", label: nil, action: onQuit)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
        .frame(width: 324)
        .background(Color.page)
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
    private var popover: NSPopover!
    private var timer: Timer?
    private var phase = 0
    private let model = Model()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = glyphImage(running: false, working: false, phase: 0)
        statusItem.button?.action = #selector(togglePopover)
        statusItem.button?.target = self

        popover = NSPopover()
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: Panel(
            model: model,
            onToken: { [weak self] in self?.copyToken() },
            onLogs: { NSWorkspace.shared.open(URL(fileURLWithPath: LOG_FILE)) },
            onRestart: { [weak self] in self?.startOrRestart() },
            onQuit: { NSApp.terminate(nil) }
        ))

        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown { popover.performClose(nil); return }
        model.refreshFiles()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
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
                    if self.popover.isShown { self.model.refreshFiles() }
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
        } else if FileManager.default.fileExists(atPath: PLIST) {
            launchctl(["bootstrap", "gui/\(uid)", PLIST])
            toast("starting…")
        } else {
            toast("not installed — npm run daemon:install")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.poll() }
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
