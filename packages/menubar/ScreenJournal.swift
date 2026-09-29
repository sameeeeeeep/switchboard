// ScreenJournal — the LOCAL "soak" layer: a private, append-only text journal of what's on screen, so
// Switchboard can recall it later (jevgrep-style) and turn it into memory.
//
// PRIVACY CONTRACT:
//   • OPT-IN. Off unless ~/.relay/journal-on exists. Separate from AmbientSensor, whose zero-model contract
//     is untouched.
//   • LOCAL WRITE ONLY. This file makes no network call. It reads the focused window's text via Accessibility
//     (no screenshots) and appends it to ~/.relay/journal/YYYY-MM-DD.jsonl (dir 0700, files 0600).
//     Anything that later leaves the Mac (recall, live cards) goes through a separate, redacting step.
//   • BLOCK LIST. Password managers, private messengers, system security UI, private/incognito windows and
//     banking-looking pages are never read. Secure (password) fields are never read anywhere.
//     ~/.relay/journal.json {"block": [bundleIds], "blockWords": [...], "retentionDays": 30} extends it.
//   • DIFF, NOT DUMP. Only lines not seen recently are written; secret-looking tokens are masked on write.
//   • RETENTION. Days older than retentionDays (default 30) are deleted on start and daily.
//
// Toggle live: `touch ~/.relay/journal-on` starts recording, `rm` stops it. Triggers are cheap: app activation, a 3s poll of the focused window TITLE only, and a 30s re-read of the
// same window (to catch scrolling / new messages). All AX work runs off the main thread, bounded in nodes.
import AppKit
import ApplicationServices
import CryptoKit
import Vision

final class ScreenJournal {
    static let shared = ScreenJournal()

    private let queue = DispatchQueue(label: "switchboard.screen-journal", qos: .utility)
    private var titleTimer: DispatchSourceTimer?
    private var lastKey = ""                 // bundle|title of the last read window
    private var lastRead = Date.distantPast
    private var seen: [String: Date] = [:]   // line hash → last written (drops re-renders of the same text)
    private var lastPrune = Date.distantPast
    private var electronAsked = Set<pid_t>()
    private var lastOn: Bool?
    private var lastOCRKey = ""
    private var lastOCR = Date.distantPast
    private var askedScreenPermission = false
    /// Called on the main thread whenever recording turns on/off (the flag file appears/disappears).
    var onRecordingChange: ((Bool) -> Void)?
    private(set) var running = false

    private var relay: String { (NSHomeDirectory() as NSString).appendingPathComponent(".relay") }
    var flagPath: String { (relay as NSString).appendingPathComponent("journal-on") }
    private var dir: String { (relay as NSString).appendingPathComponent("journal") }

    static let defaultBlock: Set<String> = [
        // password managers + keychain
        "com.1password.1password", "com.agilebits.onepassword7", "com.bitwarden.desktop", "com.apple.keychainaccess",
        "com.apple.passwords", "com.dashlane.dashlanephonefinal", "com.lastpass.lastpassmacdesktop",
        // private messaging
        "com.apple.mobilesms", "net.whatsapp.whatsapp", "desktop.whatsapp", "org.whispersystems.signal-desktop",
        "ru.keepcoder.telegram", "com.tdesktop.telegram",
        // system security / login UI, and ourselves (our own UI is noise)
        "com.apple.systempreferences", "com.apple.securityagent", "com.apple.loginwindow", "com.apple.systemsettings",
        "com.relay.menubar",
    ]
    static let defaultBlockWords = ["private browsing", "incognito", "inprivate", "bank", "netbanking", "paypal",
                                    "password", "sign in", "log in", "otp", "one-time",
                                    "api key", "secret", "credential", "token"]

    // MARK: lifecycle

    /// Arms the (cheap) triggers once at launch. Recording itself follows the flag file live: create
    /// ~/.relay/journal-on to start, delete it to stop — no app restart.
    func start() {
        guard !running else { return }
        running = true
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(appActivated),
                                                          name: NSWorkspace.didActivateApplicationNotification, object: nil)
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 3, repeating: 3)
        t.setEventHandler { [weak self] in
            guard let self else { return }
            let on = FileManager.default.fileExists(atPath: self.flagPath)
            if on != self.lastOn { self.lastOn = on; DispatchQueue.main.async { self.onRecordingChange?(on) } }
            self.tick(force: false)
        }
        t.resume()
        titleTimer = t
        queue.async { self.prune() }
        godLog("screen journal armed (records while \(flagPath) exists)")
    }

    func stop() {
        guard running else { return }
        running = false
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        titleTimer?.cancel(); titleTimer = nil
        godLog("screen journal OFF")
    }

    @objc private func appActivated(_ note: Notification) { queue.asyncAfter(deadline: .now() + 1) { self.tick(force: true) } }

    // MARK: sampling

    private func tick(force: Bool) {
        guard running, FileManager.default.fileExists(atPath: flagPath), AXIsProcessTrusted(), let app = NSWorkspace.shared.frontmostApplication else { return }
        let bundle = (app.bundleIdentifier ?? "unknown").lowercased()
        let cfg = config()
        if cfg.block.contains(bundle) { return }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(axApp, 0.25)   // an unresponsive app must not stall the journal
        // Electron apps (Slack, Claude, Notion, VS Code…) hide their text from AX until asked. This flag is
        // Electron's own opt-in; we avoid AXEnhancedUserInterface, which breaks window animations.
        if electronAsked.insert(app.processIdentifier).inserted {
            AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        }
        guard let win = jElement(axApp, kAXFocusedWindowAttribute as String) else { note("skip \(bundle): no focused window"); return }
        let title = jString(win, kAXTitleAttribute as String) ?? ""
        let key = bundle + "|" + title
        let stale = Date().timeIntervalSince(lastRead) > 30
        guard force || key != lastKey || stale else { return }
        lastKey = key; lastRead = Date()

        let url = jURL(win)
        let haystack = (title + " " + (url ?? "")).lowercased()
        if let w = cfg.blockWords.first(where: { haystack.contains($0) }) { note("skip \(bundle): block word '\(w)'"); return }

        let started = Date()
        var lines = readText(win)
        var via = "ax"
        // Thin AX text (Chrome and other apps that hide page text from accessibility) → read the pixels:
        // on-device Vision OCR of just this window. On a window change, and at most once a minute otherwise.
        if lines.count < 8 || lines.reduce(0, { $0 + $1.count }) < 300,
           key != lastOCRKey || Date().timeIntervalSince(lastOCR) > 60 {
            lastOCRKey = key; lastOCR = Date()
            let ocr = ocrWindow(pid: app.processIdentifier)
            if !ocr.isEmpty { lines = Array(NSOrderedSet(array: lines + ocr)) as? [String] ?? lines; via = "ocr" }
        }
        let ms = Int(Date().timeIntervalSince(started) * 1000)
        let now = Date()
        var fresh: [String] = []
        for line in lines {
            let h = SHA256.hash(data: Data(line.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
            if let t = seen[h], now.timeIntervalSince(t) < 6 * 3600 { continue }
            seen[h] = now
            fresh.append(mask(line))
        }
        if seen.count > 20000 { seen = seen.filter { now.timeIntervalSince($0.value) < 3600 } }
        if !fresh.isEmpty || lines.isEmpty { note("\(bundle): \(lines.count) lines via \(via), \(fresh.count) new (\(ms)ms)") }
        guard !fresh.isEmpty else { return }
        append(["t": ISO8601DateFormatter().string(from: now), "app": app.localizedName ?? bundle, "bundle": bundle,
                "window": title, "url": url ?? NSNull(), "via": via, "lines": fresh])
        if now.timeIntervalSince(lastPrune) > 24 * 3600 { prune() }
    }

    /// Bounded BFS over the focused window collecting visible text. One batched AX round trip per node
    /// (role, subrole, value, title, description, children), capped in nodes and characters, so a huge
    /// tree (Electron, long web pages) costs a bounded few hundred ms, never seconds. Never reads secure fields.
    private func readText(_ root: AXUIElement) -> [String] {
        let attrs = [kAXRoleAttribute, kAXSubroleAttribute, kAXValueAttribute, kAXTitleAttribute,
                     kAXDescriptionAttribute, kAXChildrenAttribute] as CFArray
        let textRoles: Set<String> = ["AXStaticText", "AXTextArea", "AXTextField", "AXHeading", "AXLink", "AXCell"]
        var queue: [AXUIElement] = [root], out: [String] = [], seenLocal = Set<String>()
        var visited = 0, chars = 0
        while !queue.isEmpty && visited < 1500 && chars < 20000 {
            let el = queue.removeFirst(); visited += 1
            var raw: CFArray?
            guard AXUIElementCopyMultipleAttributeValues(el, attrs, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success,
                  let vals = raw as? [Any], vals.count == 6 else { continue }
            let role = vals[0] as? String ?? "", sub = vals[1] as? String ?? ""
            if role == "AXSecureTextField" || sub == "AXSecureTextField" { continue }   // never read passwords
            if textRoles.contains(role) {
                for v in vals[2...4] {
                    guard let str = v as? String, !str.isEmpty else { continue }
                    for piece in str.split(whereSeparator: \.isNewline) {
                        let line = piece.trimmingCharacters(in: .whitespaces)
                        guard line.count >= 3, line.count <= 2000, seenLocal.insert(line).inserted else { continue }
                        out.append(line); chars += line.count
                    }
                }
            }
            if let kids = vals[5] as? [AXUIElement] { queue.append(contentsOf: kids) }
        }
        return out
    }

    /// Capture ONLY the frontmost window of `pid` with the system screencapture tool (same path the app's
    /// OCR already uses), recognise text on-device, delete the image immediately. Needs Screen Recording
    /// permission; macOS shows its own prompt once, the user decides there.
    private func ocrWindow(pid: pid_t) -> [String] {
        guard CGPreflightScreenCaptureAccess() else {
            if !askedScreenPermission { askedScreenPermission = true; note("OCR needs Screen Recording permission")
                DispatchQueue.main.async { _ = CGRequestScreenCaptureAccess() } }
            return []
        }
        guard let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
              let info = infos.first(where: { ($0[kCGWindowOwnerPID as String] as? pid_t) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }),
              let wid = info[kCGWindowNumber as String] as? Int else { return [] }
        let tmpDir = (relay as NSString).appendingPathComponent("tmp")
        try? FileManager.default.createDirectory(atPath: tmpDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let path = (tmpDir as NSString).appendingPathComponent("journal-ocr-\(UUID().uuidString).png")
        defer { try? FileManager.default.removeItem(atPath: path) }
        let cap = Process()
        cap.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        cap.arguments = ["-x", "-o", "-l", String(wid), "-t", "png", path]
        do { try cap.run(); cap.waitUntilExit() } catch { return [] }
        guard var img = NSImage(contentsOfFile: path)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return [] }
        // Retina windows are ~3k px wide; text stays legible at 1600, and Vision's cost scales with pixels.
        if img.width > 1600 {
            let w = 1600, h = img.height * 1600 / img.width
            if let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                   space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) {
                ctx.interpolationQuality = .medium
                ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
                if let small = ctx.makeImage() { img = small }
            }
        }
        var out: [String] = []
        let req = VNRecognizeTextRequest { r, _ in
            for o in (r.results as? [VNRecognizedTextObservation]) ?? [] {
                if let t = o.topCandidates(1).first?.string.trimmingCharacters(in: .whitespaces), t.count >= 3 { out.append(t) }
            }
        }
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = true
        req.minimumTextHeight = 0.008   // skip hairline text (status bars, footers): fewer regions, faster
        try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
        return out
    }

    private var lastNote = ""
    private func note(_ s: String) { if s != lastNote { lastNote = s; godLog("journal: " + s) } }

    // MARK: storage

    private func append(_ entry: [String: Any]) {
        let fm = FileManager.default
        try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let day = String(ISO8601DateFormatter().string(from: Date()).prefix(10))
        let path = (dir as NSString).appendingPathComponent("\(day).jsonl")
        guard var data = try? JSONSerialization.data(withJSONObject: entry) else { return }
        data.append(0x0a)
        if !fm.fileExists(atPath: path) { fm.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        if let h = FileHandle(forWritingAtPath: path) { h.seekToEndOfFile(); h.write(data); try? h.close() }
    }

    private func prune() {
        lastPrune = Date()
        let keep = config().retentionDays
        let cutoff = Date().addingTimeInterval(-Double(keep) * 86400)
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"; fmt.timeZone = TimeZone(identifier: "UTC")
        for f in (try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? [] where f.hasSuffix(".jsonl") {
            if let d = fmt.date(from: String(f.prefix(10))), d < cutoff {
                try? FileManager.default.removeItem(atPath: (dir as NSString).appendingPathComponent(f))
            }
        }
    }

    private func config() -> (block: Set<String>, blockWords: [String], retentionDays: Int) {
        var block = Self.defaultBlock, words = Self.defaultBlockWords, days = 30
        let path = (relay as NSString).appendingPathComponent("journal.json")
        if let d = FileManager.default.contents(atPath: path),
           let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            (j["block"] as? [String])?.forEach { block.insert($0.lowercased()) }
            (j["blockWords"] as? [String])?.forEach { words.append($0.lowercased()) }
            if let r = j["retentionDays"] as? Int, r > 0 { days = r }
        }
        return (block, words, days)
    }

    /// Mask secret-looking tokens before they ever touch disk (API keys, long hex/base64 blobs, card numbers).
    private func mask(_ s: String) -> String {
        var out = s
        let patterns = [#"\b(sk|pk|rk|ghp|gho|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{2,}[•*…]*"#,
                        #"\b[A-Fa-f0-9]{32,}\b"#, #"\b[A-Za-z0-9+/]{40,}={0,2}"#, #"\b(?:\d[ -]?){13,19}\b"#]
        for p in patterns {
            out = out.replacingOccurrences(of: p, with: "[masked]", options: .regularExpression)
        }
        return out
    }

    // MARK: AX helpers (own copies — AmbientSensor's are file-private and its contract stays separate)

    private func jString(_ el: AXUIElement, _ attr: String) -> String? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success, let s = v as? String,
              !s.isEmpty else { return nil }
        return s
    }
    private func jElement(_ el: AXUIElement, _ attr: String) -> AXUIElement? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success, let r = v,
              CFGetTypeID(r) == AXUIElementGetTypeID() else { return nil }
        return (r as! AXUIElement)
    }
    private func jChildren(_ el: AXUIElement) -> [AXUIElement] {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &v) == .success,
              let arr = v as? [AXUIElement] else { return [] }
        return arr
    }
    private func jURL(_ win: AXUIElement) -> String? {
        var q: [AXUIElement] = [win], n = 0
        while !q.isEmpty && n < 300 {
            let el = q.removeFirst(); n += 1
            if jString(el, kAXRoleAttribute as String) == "AXWebArea" {
                var v: CFTypeRef?
                if AXUIElementCopyAttributeValue(el, "AXURL" as CFString, &v) == .success, let u = v as? URL { return u.absoluteString }
            }
            q.append(contentsOf: jChildren(el))
        }
        return nil
    }
}
