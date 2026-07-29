// Flow.app — Wispr-style dictation as a NATIVE Switchboard client.
//
//   double-tap ⌃Control (anywhere) → 🎙 record → tap ⌃ once → ✨ transcribe + clean → paste at cursor
//
// Flow ships no AI. It borrows the user's own Claude + a local whisper through the Switchboard
// daemon's NATIVE socket, authenticating as its own least-privilege principal. This file is the
// whole app: a menu-bar item, a global Control-tap detector, mic capture, the daemon client, a
// sparkle indicator near the cursor, and paste-at-cursor.
//
// Permissions it will ask for on first run: Microphone (capture) and Accessibility (global hotkey
// + synthetic paste). Both are standard for a dictation app.
//
// Build: examples/flow/mac/build.sh   ·   Run: open examples/flow/mac/Flow.app

import AppKit
import SwiftUI
import AVFoundation
import Darwin

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Config — written by build.sh into ~/.flow/config.json (absolute paths for this checkout).
// ─────────────────────────────────────────────────────────────────────────────────────────────
let FLOW_HOME = (NSHomeDirectory() as NSString).appendingPathComponent(".flow")
let CONFIG_FILE = (FLOW_HOME as NSString).appendingPathComponent("config.json")
let TOKEN_FILE = (FLOW_HOME as NSString).appendingPathComponent("token.json")
let SETTINGS_FILE = (FLOW_HOME as NSString).appendingPathComponent("settings.json")  // user prefs (cleanup mode)
// Flow connects to the user's MAIN Switchboard daemon (the one the menu-bar app runs + the panel
// pairs with) — that's where the "Allow Flow?" consent can show. Native port default = 8788.
let NATIVE_PORT: UInt16 = UInt16(ProcessInfo.processInfo.environment["RELAY_NATIVE_PORT"].flatMap { UInt16($0) } ?? 8788)
let APP_ID = "ai.thelastprompt.flow"

struct FlowConfig {
    var node: String
    var daemon: String
    var sttCmd: String
    // Cleanup on a LOCAL model when one is available — Ollama/LM Studio at this OpenAI-compatible
    // URL. Then dictation is 100% on-device (local whisper + local cleanup); Claude is only the
    // fallback. Empty cleanupModel = auto-pick any local model, else fall back to Claude, else raw.
    var localOpenAIUrl: String
    var cleanupModel: String
    var cleanupMode: String   // auto | ondevice | claude | off — a user pref (settings.json)

    // User pref, stored separately from the runtime paths so it survives both dev + bundled config.
    static func readMode() -> String {
        if let d = FileManager.default.contents(atPath: SETTINGS_FILE),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let m = j["cleanupMode"] as? String { return m }
        return "auto"
    }

    static func load() -> FlowConfig? {
        // 1. Dev build: build.sh wrote ~/.flow/config.json pointing at this checkout.
        if let d = FileManager.default.contents(atPath: CONFIG_FILE),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let node = j["node"] as? String, let daemon = j["daemon"] as? String, let stt = j["sttCmd"] as? String {
            return FlowConfig(node: node, daemon: daemon, sttCmd: stt,
                              localOpenAIUrl: (j["localOpenAIUrl"] as? String) ?? "http://127.0.0.1:11434/v1",
                              cleanupModel: (j["cleanupModel"] as? String) ?? "", cleanupMode: readMode())
        }
        // 2. Distributed Flow.app: the whole runtime is bundled in Resources (see package-dmg.sh).
        if let res = Bundle.main.resourcePath {
            let node = (res as NSString).appendingPathComponent("node")
            let daemon = (res as NSString).appendingPathComponent("daemon/sidekick.mjs")
            let whisper = (res as NSString).appendingPathComponent("whisper-stt.mjs")
            if FileManager.default.fileExists(atPath: daemon) {
                return FlowConfig(node: node, daemon: daemon, sttCmd: "\(node) \(whisper)",
                                  localOpenAIUrl: "http://127.0.0.1:11434/v1", cleanupModel: "", cleanupMode: readMode())
            }
        }
        return nil
    }
}

func log(_ s: String) { FileHandle.standardError.write("[flow] \(s)\n".data(using: .utf8)!) }

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tiny POSIX port check (is the daemon already listening?)
// ─────────────────────────────────────────────────────────────────────────────────────────────
func portOpen(_ port: UInt16) -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    if fd < 0 { return false }
    defer { close(fd) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr)
    let r = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    return r == 0
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Daemon client over the native WebSocket (per-app token) and the control socket (pairing token).
// ─────────────────────────────────────────────────────────────────────────────────────────────
final class DaemonClient: NSObject {
    private var task: URLSessionWebSocketTask?
    private var session: URLSession!
    private var pending: [String: (Result<[String: Any], Error>) -> Void] = [:]
    private let onAuth: () -> Void
    private let onRegistered: ((String, [String]) -> Void)?
    private let hello: [String: Any]

    // Two ways to open: AUTH with a saved per-app token, or ask for interactive consent (appId only).
    // On `registered` the daemon has already authed this same socket, so it's usable immediately.
    init(port: UInt16, token: String? = nil, appId: String? = nil, reason: String? = nil,
         onAuth: @escaping () -> Void = {}, onRegistered: ((String, [String]) -> Void)? = nil) {
        self.onAuth = onAuth
        self.onRegistered = onRegistered
        self.hello = token != nil ? ["type": "auth", "token": token!]
                                   : ["type": "requestConnect", "appId": appId ?? "", "reason": reason ?? ""]
        super.init()
        session = URLSession(configuration: .default)
        task = session.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task?.resume()
        receive()
        send(hello)
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let e): log("ws recv error: \(e.localizedDescription)")
            case .success(let msg):
                if case let .string(text) = msg, let d = text.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                    self.handle(obj)
                }
                self.receive()
            }
        }
    }

    private func handle(_ m: [String: Any]) {
        switch m["type"] as? String {
        case "auth_ok": onAuth()
        case "registered": onRegistered?((m["token"] as? String) ?? "", (m["models"] as? [String]) ?? [])
        case "response":
            if let id = m["id"] as? String, let cb = pending.removeValue(forKey: id) {
                if let err = m["error"] as? [String: Any] {
                    cb(.failure(NSError(domain: "flow", code: (err["code"] as? Int) ?? -1, userInfo: [NSLocalizedDescriptionKey: (err["message"] as? String) ?? "error"])))
                } else { cb(.success((m["result"] as? [String: Any]) ?? [:])) }
            }
        default: break
        }
    }

    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
        task?.send(.string(s)) { e in if let e { log("ws send error: \(e.localizedDescription)") } }
    }

    func request(_ method: String, _ params: [String: Any], _ cb: @escaping (Result<[String: Any], Error>) -> Void) {
        let id = UUID().uuidString
        pending[id] = cb
        send(["type": "request", "id": id, "method": method, "params": params])
    }

    func close() { task?.cancel(with: .goingAway, reason: nil) }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The sparkle indicator — a floating, non-activating panel shown near the cursor.
// ─────────────────────────────────────────────────────────────────────────────────────────────
enum FlowPhase { case listening, thinking, done, error }

final class PillModel: ObservableObject {
    @Published var phase: FlowPhase = .listening
    @Published var caption: String = "Listening…"
}

// A tiny bottom-of-screen pill: one small pulsing dot (color = phase) + one short word. That's it.
struct SparkleView: View {
    @ObservedObject var model: PillModel
    @State private var pulse = false

    private var tint: Color {
        switch model.phase {
        case .listening: return Color(red: 0.62, green: 0.86, blue: 0.24)   // lime
        case .thinking:  return Color(red: 0.60, green: 0.55, blue: 1.0)     // violet
        case .done:      return Color(red: 0.24, green: 0.84, blue: 0.55)    // green
        case .error:     return Color(red: 0.94, green: 0.35, blue: 0.35)    // red
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(tint)
                .frame(width: 5, height: 5)
                .opacity(pulse ? 1.0 : 0.25)
                .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: pulse)
            Text(model.caption)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundColor(.white.opacity(0.9))
        }
        .padding(.horizontal, 8).padding(.vertical, 3.5)
        .background(Capsule().fill(Color.black.opacity(0.82)))
        .fixedSize()
        .onAppear { pulse = true }
    }
}

final class Pill {
    private var panel: NSPanel?
    private var host: NSHostingView<SparkleView>?
    let model = PillModel()

    func show() { DispatchQueue.main.async { self.showOnMain() } }
    private func showOnMain() {
        if panel == nil {
            let h = NSHostingView(rootView: SparkleView(model: model))
            // The window backing is opaque black by default — force the hosting view's layer clear so
            // ONLY the SwiftUI capsule shows (no black rectangle behind the rounded pill).
            h.wantsLayer = true
            h.layer?.backgroundColor = NSColor.clear.cgColor
            let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 110, height: 22),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            p.isFloatingPanel = true
            p.level = .statusBar
            p.backgroundColor = .clear
            p.isOpaque = false
            p.hasShadow = false
            p.ignoresMouseEvents = true
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            p.contentView = h
            panel = p; host = h
        }
        layout()
        panel?.orderFrontRegardless()
    }

    // Size to content and pin to the bottom-center of the active screen (just above the Dock).
    private func layout() {
        guard let panel, let host else { return }
        host.layoutSubtreeIfNeeded()
        let sz = host.fittingSize
        if sz.width > 1 && sz.height > 1 { panel.setContentSize(sz) }
        guard let screen = NSScreen.main else { return }
        let vf = screen.visibleFrame
        let f = panel.frame
        panel.setFrameOrigin(NSPoint(x: vf.midX - f.width / 2, y: vf.minY + 46))
    }

    func set(_ phase: FlowPhase, _ caption: String) {
        DispatchQueue.main.async { self.model.phase = phase; self.model.caption = caption; self.layout() }
    }
    func hide() { DispatchQueue.main.async { self.panel?.orderOut(nil) } }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Mic capture — AVAudioRecorder writes a 16kHz mono WAV directly (whisper-friendly).
// ─────────────────────────────────────────────────────────────────────────────────────────────
final class Recorder {
    private var recorder: AVAudioRecorder?
    private(set) var url: URL?

    func start() throws {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("flow-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("rec.wav")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false,
        ]
        let r = try AVAudioRecorder(url: out, settings: settings)
        r.record()
        recorder = r; url = out
    }

    func stop() -> URL? { recorder?.stop(); let u = url; recorder = nil; return u }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The app.
// ─────────────────────────────────────────────────────────────────────────────────────────────
final class AppState: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var config: FlowConfig!
    var appToken: String?
    var models: [String] = []
    var native: DaemonClient?

    let pill = Pill()
    let recorder = Recorder()
    var isRecording = false
    var isBusy = false

    // Control double-tap state
    var lastControlTap: TimeInterval = 0
    var controlWasDown = false
    var controlDownAt: TimeInterval = 0
    var globalMonitor: Any?

    func applicationDidFinishLaunching(_ n: Notification) {
        guard let cfg = FlowConfig.load() else {
            alert("Flow isn't set up", "Run examples/flow/mac/build.sh first — it writes ~/.flow/config.json with the daemon paths.")
            NSApp.terminate(nil); return
        }
        config = cfg
        setupStatusItem()
        requestPermissions()
        DispatchQueue.global().async { [weak self] in self?.connect() }
        installControlMonitor()
    }

    // ---- menu bar ----
    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Flow")
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Flow — double-tap ⌃ to dictate", action: nil, keyEquivalent: ""))
        menu.addItem(.separator())
        let status = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: ""); status.tag = 1; menu.addItem(status)
        menu.addItem(.separator())
        // Settings — where cleanup runs. The pill stays a pure status indicator; the choice lives here.
        let cleanup = NSMenuItem(title: "Cleanup", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (label, mode) in [("Auto — light local model, else Claude", "auto"),
                              ("On-device only", "ondevice"),
                              ("Claude only", "claude"),
                              ("Off — raw transcript", "off")] {
            let it = NSMenuItem(title: label, action: #selector(setCleanupMode(_:)), keyEquivalent: "")
            it.target = self; it.representedObject = mode
            it.state = (config.cleanupMode == mode) ? .on : .off
            sub.addItem(it)
        }
        cleanup.submenu = sub
        menu.addItem(cleanup)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Flow", action: #selector(quit), keyEquivalent: "q"))
        menu.items.last?.target = self
        statusItem.menu = menu
    }

    @objc func setCleanupMode(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        config.cleanupMode = mode
        sender.menu?.items.forEach { $0.state = (($0.representedObject as? String) == mode) ? .on : .off }
        var obj: [String: Any] = [:]
        if let d = FileManager.default.contents(atPath: SETTINGS_FILE),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { obj = j }
        obj["cleanupMode"] = mode
        try? FileManager.default.createDirectory(atPath: FLOW_HOME, withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted) {
            try? d.write(to: URL(fileURLWithPath: SETTINGS_FILE))
        }
    }
    func setStatus(_ s: String) {
        DispatchQueue.main.async { self.statusItem.menu?.item(withTag: 1)?.title = s }
    }
    @objc func quit() { NSApp.terminate(nil) }

    // ---- permissions ----
    func requestPermissions() {
        AVCaptureDevice.requestAccess(for: .audio) { ok in if !ok { log("microphone denied") } }
        // Accessibility (for the global Control monitor + synthetic paste). Prompts if not trusted.
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        if !AXIsProcessTrustedWithOptions(opts) { log("waiting for Accessibility permission") }
    }

    // ---- connect to the user's MAIN Switchboard daemon ----
    // No private daemon. STT runs LOCALLY in this app (see transcribeLocally) — only the cleanup
    // COMPLETION routes through the broker, which is the only part that needs the user's models +
    // consent. First run asks the panel for consent ("Allow Flow?"); after that the minted per-app
    // token is reused. Needs the Switchboard menu-bar app running (it hosts the daemon + the panel).
    func connect() {
        guard portOpen(NATIVE_PORT) else {
            setStatus("Open Switchboard to connect…")
            DispatchQueue.global().asyncAfter(deadline: .now() + 2.0) { [weak self] in self?.connect() }
            return
        }
        if let saved = loadToken() {
            appToken = saved.0; models = saved.1
            var ok = false
            native = DaemonClient(port: NATIVE_PORT, token: saved.0, onAuth: { [weak self] in ok = true; self?.onConnected() })
            // A stale token (e.g. minted by Flow's old private daemon) won't auth on the main daemon.
            // If we don't connect quickly, drop it and fall back to the interactive consent flow.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                guard let self, !ok else { return }
                self.clearToken(); self.native?.close(); self.native = nil; self.connect()
            }
        } else {
            setStatus("Allow Flow in Switchboard to connect…")
            native = DaemonClient(port: NATIVE_PORT, appId: APP_ID,
                reason: "Dictation — transcribe your speech, then clean it up",
                onRegistered: { [weak self] token, models in
                    guard let self else { return }
                    self.appToken = token; self.models = models; self.saveToken(token, models)
                    self.onConnected()
                })
        }
    }
    func onConnected() {
        setStatus("Ready — double-tap ⌃ to dictate")
        log("connected to Switchboard · models: \(models.joined(separator: ", "))")
    }
    func saveToken(_ token: String, _ models: [String]) {
        let obj: [String: Any] = ["token": token, "models": models]
        if let d = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted) {
            try? FileManager.default.createDirectory(atPath: FLOW_HOME, withIntermediateDirectories: true)
            try? d.write(to: URL(fileURLWithPath: TOKEN_FILE))
        }
    }
    func clearToken() { try? FileManager.default.removeItem(atPath: TOKEN_FILE); appToken = nil; models = [] }
    func loadToken() -> (String, [String])? {
        guard let d = FileManager.default.contents(atPath: TOKEN_FILE),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let t = j["token"] as? String else { return nil }
        return (t, (j["models"] as? [String]) ?? [])
    }

    // ---- global Control double-tap ----
    func installControlMonitor() {
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged]) { [weak self] e in
            self?.handleFlags(e)
        }
    }
    func handleFlags(_ e: NSEvent) {
        // keyCode 59 = left Control, 62 = right Control
        guard e.keyCode == 59 || e.keyCode == 62 else { return }
        let down = e.modifierFlags.contains(.control)
        let now = ProcessInfo.processInfo.systemUptime
        if down && !controlWasDown { controlWasDown = true; controlDownAt = now; return }
        if !down && controlWasDown {
            controlWasDown = false
            // a "tap" is a short press-release (ignore held-Control used in real shortcuts)
            guard now - controlDownAt < 0.35 else { lastControlTap = 0; return }
            DispatchQueue.main.async { self.onControlTap(now) }
        }
    }
    func onControlTap(_ now: TimeInterval) {
        if isRecording { stopAndTranscribe(); lastControlTap = 0; return }
        if now - lastControlTap < 0.45 { lastControlTap = 0; startRecording() }   // double-tap
        else { lastControlTap = now }
    }

    // ---- the dictation flow ----
    func startRecording() {
        guard native != nil, appToken != nil else { flash(.error, "Not connected yet"); return }
        guard !isBusy else { return }
        do { try recorder.start() } catch { flash(.error, "Mic error"); return }
        isRecording = true
        pill.set(.listening, "Listening"); pill.show()
        NSSound(named: "Tink")?.play()
    }

    func stopAndTranscribe() {
        guard isRecording, let wav = recorder.stop() else { return }
        isRecording = false; isBusy = true
        pill.set(.thinking, "Transcribing")
        transcribeLocally(wav) { [weak self] text in
            guard let self else { return }
            let raw = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if raw.isEmpty { self.finish(.error, "Nothing heard"); return }
            self.cleanup(raw)   // cleanup routes through the broker; transcription did not
        }
    }

    // STT runs HERE, in the app — NOT through the daemon. Transcription is a local, unprivileged op
    // (audio the app already holds → text); only cleanup, which uses the user's models, needs the
    // broker. This also fixes "local STT failed": the daemon (Finder-launched, minimal PATH) couldn't
    // find `whisper`; here we run the configured adapter with a fuller PATH.
    func transcribeLocally(_ wav: URL, _ done: @escaping (String?) -> Void) {
        DispatchQueue.global().async {
            let parts = self.config.sttCmd.split(separator: " ").map(String.init)  // e.g. [node, whisper-stt.mjs]
            guard let bin = parts.first else { DispatchQueue.main.async { done(nil) }; return }
            let p = Process()
            p.executableURL = URL(fileURLWithPath: bin)
            p.arguments = Array(parts.dropFirst()) + [wav.path]
            let out = Pipe(); p.standardOutput = out; p.standardError = FileHandle.nullDevice
            var env = ProcessInfo.processInfo.environment
            env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:" + (env["PATH"] ?? "")
            p.environment = env
            var text: String? = nil
            do {
                try p.run(); p.waitUntilExit()
                let data = out.fileHandleForReading.readDataToEndOfFile()
                if p.terminationStatus == 0 { text = String(data: data, encoding: .utf8) }
            } catch { text = nil }
            DispatchQueue.main.async { done(text) }
        }
    }

    // Cleanup model selection, honoring the user's Cleanup setting and a hard SIZE CAP so Flow never
    // auto-loads a heavy model (the thing that thrashed the machine). Sweet spot: 3–5B — big enough
    // to follow the rewrite instruction (a 1B hallucinates), small enough to stay light (~2GB).
    func isLocal(_ m: String) -> Bool { m.contains(":") || m.contains("/") }
    func sizeB(_ m: String) -> Double {
        guard let re = try? NSRegularExpression(pattern: #"(\d+(?:\.\d+)?)\s*b\b"#, options: [.caseInsensitive]) else { return .nan }
        let ns = m as NSString
        guard let hit = re.firstMatch(in: m, range: NSRange(location: 0, length: ns.length)), hit.numberOfRanges >= 2 else { return .nan }
        return Double(ns.substring(with: hit.range(at: 1))) ?? .nan
    }
    func capableLocals() -> [String] {                       // local models in the 3–5B safe band, smallest first
        models.filter { isLocal($0) && sizeB($0) >= 3 && sizeB($0) <= 5 }.sorted { sizeB($0) < sizeB($1) }
    }
    func firstClaude() -> String? { models.first { !isLocal($0) } }

    func pickCleanupModel() -> String? {
        if !config.cleanupModel.isEmpty, models.contains(config.cleanupModel) { return config.cleanupModel } // explicit pin
        switch config.cleanupMode {
        case "off":      return nil                                    // no cleanup — ship the raw transcript
        case "ondevice": return capableLocals().first                  // on-device only; nil → raw (never Claude)
        case "claude":   return firstClaude() ?? capableLocals().first // your Claude; local only if signed out
        default:         return capableLocals().first ?? firstClaude() // auto: light local model, else Claude
        }
    }

    func cleanup(_ raw: String) {
        guard let native, let model = pickCleanupModel() else { deliver(raw); return }
        pill.set(.thinking, "Cleaning")
        let sys = "You are a dictation cleanup engine. Rewrite the user's raw speech transcript into clean, well-punctuated prose. Remove filler words (um, uh, like, you know), fix obvious recognition errors and capitalization, keep the meaning and wording. Output ONLY the cleaned text — no preamble, no quotes."
        native.request("claude_complete", ["model": model, "system": sys, "prompt": raw, "maxTokens": 500]) { [weak self] res in
            guard let self else { return }
            if case .success(let r) = res, let text = r["text"] as? String, !text.isEmpty {
                self.deliver(text.trimmingCharacters(in: .whitespacesAndNewlines))
            } else { self.deliver(raw) }   // cleanup optional — never lose the words
        }
    }

    func deliver(_ text: String) {
        DispatchQueue.main.async {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            self.paste()
            self.finish(.done, "Pasted")
        }
    }

    func paste() {
        let src = CGEventSource(stateID: .combinedSessionState)
        let v: CGKeyCode = 9 // 'v'
        let down = CGEvent(keyboardEventSource: src, virtualKey: v, keyDown: true)
        down?.flags = .maskCommand
        let up = CGEvent(keyboardEventSource: src, virtualKey: v, keyDown: false)
        up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }

    func finish(_ phase: FlowPhase, _ caption: String) {
        DispatchQueue.main.async {
            self.isBusy = false
            self.pill.set(phase, caption)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { self.pill.hide() }
        }
    }
    func flash(_ phase: FlowPhase, _ caption: String) {
        pill.set(phase, caption); pill.show()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { self.pill.hide() }
    }

    // ---- utils ----
    func alert(_ title: String, _ msg: String) {
        let a = NSAlert(); a.messageText = title; a.informativeText = msg; a.runModal()
    }
}

let app = NSApplication.shared
let state = AppState()
app.delegate = state
app.setActivationPolicy(.accessory)
app.run()
