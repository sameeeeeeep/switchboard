// WhiteboardPanel — the NATIVE floating whiteboard overlay (board epic `whiteboard`, cv5).
//
// The PIP-style, always-on-top window version of `/whiteboard`. The V1 (examples/whiteboard/) serves
// whiteboard.html over HTTP on :8902 and opens it in a browser tab; the "Send to Claude" POSTs the PNG
// to that server, which writes ~/.relay/whiteboard-result.json + a shot PNG + a history line the
// /whiteboard skill polls. This file is the SAME loop with NO server: it hosts the identical
// whiteboard.html (bundled into the app) in a floating WKWebView, and the Send reaches native through a
// WKScriptMessageHandler that writes the EXACT same output files — so the skill's polling is unchanged.
//
// Architecture mirrors the presence overlays (CursorGuide's NotchPanel + GodWebWindow's WKWebView host):
//   • a floating, non-activating NSPanel that joins ALL Spaces and stays above other apps (like the PIP
//     feed / notch), draggable by its header, resizable, remembering its frame across opens (UserDefaults,
//     the same idea as CursorGuide's relay.guide.free.* free-anchor).
//   • a cheap always-on trigger watcher (the sibling of CursorGuide's pollTrigger / the pip.json read):
//     ~/.relay/whiteboard-run.json {active:true, runId, prompt, source, project} OPENS the panel;
//     active:false / the file removed CLOSES it. This is the native equivalent of the skill's
//     "start the server" step.
//
// Dormant until the trigger appears, so it never disturbs the running app.
import AppKit
import WebKit

// MARK: - Controller (the always-on trigger watcher)

@MainActor
final class WhiteboardController: NSObject {
    static let shared = WhiteboardController()
    private override init() { super.init() }

    private var watchTimer: Timer?
    private var panel: WhiteboardPanel?
    private var currentRun: String?        // the runId the open panel is bound to
    private var lastActive = false         // edge-detect so we open once, not every tick

    private var relayDir: String { RELAY_DIR }
    private func rel(_ f: String) -> String { (relayDir as NSString).appendingPathComponent(f) }

    /// Arm the trigger watcher. Call once from applicationDidFinishLaunching (next to CursorGuide.install()).
    /// Polling a file that isn't there is a no-op, so this is genuinely dormant until a run is written.
    func install() {
        watchTimer?.invalidate()
        watchTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.pollTrigger() }
        }
        NSLog("[whiteboard] watcher armed — write ~/.relay/whiteboard-run.json {active:true} to float the board")
    }

    private func pollTrigger() {
        // ~/.relay/whiteboard-run.json is STATE, not a one-shot (unlike guide-run.json): active:true keeps
        // the board floating; active:false / a missing file closes it. So we DON'T consume it — we read its
        // `active` each tick and drive open/close off the edge.
        let obj = (readJSON(rel("whiteboard-run.json")) as? [String: Any]) ?? [:]
        let active = (obj["active"] as? Bool) ?? false
        if active {
            let run = (obj["runId"] as? String) ?? (obj["run"] as? String) ?? String(Int(Date().timeIntervalSince1970))
            if panel == nil {
                openPanel(run: run, obj: obj)
            } else if run != currentRun {
                // A new run reused the open board — rebind it (fresh runId → fresh shot filenames) without
                // tearing the window down, and bring it forward.
                currentRun = run
                panel?.setRun(run, seed: obj["seed"])
                panel?.front()
            } else {
                panel?.front()
            }
        } else if panel != nil {
            closePanel()
        }
        lastActive = active
    }

    private func openPanel(run: String, obj: [String: Any]) {
        currentRun = run
        let p = WhiteboardPanel(run: run,
                                htmlOverride: obj["html"] as? String,
                                source: obj["source"] as? String,
                                project: obj["project"] as? String,
                                seed: obj["seed"])
        p.onUserClosed = { [weak self] in
            // The user hit ✕ — retract the trigger so we don't immediately reopen on the next tick, and
            // drop our reference. Reversible: the skill re-writes whiteboard-run.json to bring it back.
            guard let self else { return }
            self.retractTrigger()
            self.panel = nil
            self.currentRun = nil
            self.lastActive = false
        }
        panel = p
        p.show()
    }

    private func closePanel() {
        panel?.close()
        panel = nil
        currentRun = nil
        lastActive = false
    }

    /// Persist active:false so a user-close (or a programmatic close) isn't undone by the next poll tick.
    private func retractTrigger() {
        let path = rel("whiteboard-run.json")
        var obj = (readJSON(path) as? [String: Any]) ?? [:]
        obj["active"] = false
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
        }
    }
}

// MARK: - Panel window subclass (borderless, floating, joins all Spaces, can become key for drawing)

/// A borderless, resizable, non-activating panel — the same family as CursorGuide's NotchPanel and the PIP
/// feed. It floats above other apps and rides every Space, but (unlike the click-through overlays) it is a
/// real interactive surface: it CAN become key so the whiteboard's keyboard shortcuts + text tool work.
final class WhiteboardWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    // Borderless windows don't accept a raw frame from the server without this (matches NotchPanel).
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }

    /// Invoked when the user presses ⌘W (or esc) while the board is key — the keyboard twin of the ✕ button,
    /// so a floating board that stole focus for drawing can still be dismissed without hunting for the button.
    var onCloseShortcut: (() -> Void)?
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers?.lowercased() == "w" {
            onCloseShortcut?(); return true
        }
        return super.performKeyEquivalent(with: event)
    }
    // Borderless panels don't get a default esc handler; wire it to close too (the canvas uses esc to
    // deselect, but that's handled inside the web view — a bare esc on the window chrome means "close").
    override func cancelOperation(_ sender: Any?) { onCloseShortcut?() }
}

// MARK: - First-mouse button

/// A button that fires on the FIRST click even when its window isn't key. The whiteboard floats as a
/// non-activating panel, so a plain NSButton would swallow the first ✕ click just to focus the window
/// (acceptsFirstMouse defaults false) — the exact "can't close it" bug. This makes ✕ a one-click hit.
final class FirstMouseButton: NSButton {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// MARK: - Draggable header

/// The top strip: grabs the whole window (performDrag) so the board moves by its header — NOT by its body,
/// so a drag on the canvas draws instead of moving the window (the isMovableByWindowBackground trap).
final class WhiteboardHeaderView: NSView {
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
    override var mouseDownCanMoveWindow: Bool { false }   // we drive the drag ourselves via performDrag
}

// MARK: - The panel

@MainActor
final class WhiteboardPanel: NSObject, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private let window: WhiteboardWindow
    private let web: WKWebView
    private var run: String
    private let htmlOverride: String?
    private var sendN = 0                     // per-run shot counter → "<run>-<n>.png" (mirrors server.mjs `n`)

    /// Fires when the USER closes the window (the ✕ header button), so the controller can retract the trigger.
    var onUserClosed: (() -> Void)?

    private static let frameKey = "relay.whiteboard.frame"      // remembered position + size across opens
    private static let defaultSize = NSSize(width: 900, height: 620)

    private var relayDir: String { RELAY_DIR }
    private func rel(_ f: String) -> String { (relayDir as NSString).appendingPathComponent(f) }
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()

    init(run: String, htmlOverride: String?, source: String?, project: String?, seed: Any? = nil) {
        self.run = run
        self.htmlOverride = htmlOverride

        // Inject the runId BEFORE the page's own script runs (window.__whiteboardRun) — loaded from a file
        // URL there's no ?run= query, so the page reads it from here. (Native still uses its OWN run for the
        // shot filenames; this just keeps the page's RUN field populated, matching the served path.)
        let ucc = WKUserContentController()
        let runJS = "window.__whiteboardRun = \(WhiteboardPanel.jsStr(run));"
        ucc.addUserScript(WKUserScript(source: runJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        // SEED — Claude can pre-draw a starting board via whiteboard-run.json `seed` (an array of board
        // objects). Inject it before the page script so the board loads it as editable objects on open.
        if let seedJS = WhiteboardPanel.seedJS(seed) {
            ucc.addUserScript(WKUserScript(source: "window.__whiteboardSeed = \(seedJS);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        let cfg = WKWebViewConfiguration()
        cfg.userContentController = ucc
        web = WKWebView(frame: .zero, configuration: cfg)
        web.setValue(false, forKey: "drawsBackground")   // let the board's own dark bg paint (no white flash)

        // Restore the remembered frame, else a sensible default centered on the main screen.
        let frame = WhiteboardPanel.restoredFrame()
        // ACTIVATING panel (no .nonactivatingPanel): still borderless + floating + all-Spaces (the PIP feel),
        // but interacting with it makes the app active — REQUIRED for trackpad pinch, since macOS delivers
        // .magnify gesture events only to the active app (a non-activating panel never receives them at all).
        window = WhiteboardWindow(contentRect: frame,
                                  styleMask: [.borderless, .resizable],
                                  backing: .buffered, defer: true)
        super.init()

        ucc.add(self, name: "whiteboard")

        window.isOpaque = false
        window.backgroundColor = NSColor(red: 0x0B/255.0, green: 0x0E/255.0, blue: 0x08/255.0, alpha: 1) // --bg
        window.hasShadow = true
        window.level = .floating                              // above normal app windows (the PIP/notch family)
        window.hidesOnDeactivate = false                      // must persist when you switch apps/Spaces to act on it
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = false            // ONLY the header drags — the body is the drawing canvas
        window.minSize = NSSize(width: 460, height: 340)
        window.delegate = self
        window.onCloseShortcut = { [weak self] in self?.closeTapped() }   // ⌘W / esc → same as the ✕ button

        buildContent(source: source, project: project)
        web.navigationDelegate = self

        // Trackpad PINCH → canvas zoom. macOS delivers .magnify gesture events only to the ACTIVE app, and a
        // local monitor is the one hook that beats WKWebView's inner content view (which eats a recognizer /
        // magnify override). Because the panel now activates on interaction (styleMask above), the pinch reaches
        // us; we forward each event's factor + center to the page's zoom and consume it.
        web.allowsMagnification = false
        pinchMonitor = NSEvent.addLocalMonitorForEvents(matching: .magnify) { [weak self] e in
            guard let self, e.window === self.window else { return e }
            let p = self.web.convert(e.locationInWindow, from: nil)
            self.web.evaluateJavaScript("window.__wbZoomBy && window.__wbZoomBy(\(1 + e.magnification),\(p.x),\(self.web.bounds.height - p.y));", completionHandler: nil)
            return nil
        }
    }

    private var pinchMonitor: Any?

    // Header (drag + title + close) stacked above the web view, filling the content.
    private func buildContent(source: String?, project: String?) {
        // Borderless → content fills the whole frame; derive the local rect straight from the frame size so
        // the initial layout is exact even before contentView is attached.
        let content = NSView(frame: NSRect(x: 0, y: 0, width: window.frame.width, height: window.frame.height))
        content.autoresizingMask = [.width, .height]

        let headerH: CGFloat = 30
        let header = WhiteboardHeaderView(frame: NSRect(x: 0, y: content.bounds.height - headerH, width: content.bounds.width, height: headerH))
        header.autoresizingMask = [.width, .minYMargin]
        header.wantsLayer = true
        header.layer?.backgroundColor = NSColor(red: 0x12/255.0, green: 0x16/255.0, blue: 0x0C/255.0, alpha: 1).cgColor // --panel

        // ✕ close (left, macOS-conventional side for a custom bar). FirstMouseButton so it fires on the
        // very first click even when the floating panel isn't key — otherwise the first ✕ click is eaten
        // just to focus the window (the "can't close the whiteboard" bug). Full-height, generous hit target.
        let close = FirstMouseButton(frame: NSRect(x: 4, y: 0, width: 24, height: headerH))
        close.bezelStyle = .regularSquare
        close.isBordered = false
        close.title = "✕"
        close.font = .systemFont(ofSize: 12, weight: .bold)
        close.contentTintColor = NSColor(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0, alpha: 1) // --lime
        close.toolTip = "Close whiteboard (⌘W)"
        close.target = self
        close.action = #selector(closeTapped)
        close.autoresizingMask = [.maxXMargin]
        header.addSubview(close)

        // Title — brand lime "WHITEBOARD" + optional provenance, so a floating board is never a mystery.
        let title = NSTextField(labelWithString: "◆ WHITEBOARD")
        title.font = .monospacedSystemFont(ofSize: 10, weight: .bold)
        title.textColor = NSColor(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0, alpha: 1) // --lime
        title.sizeToFit()
        title.frame.origin = NSPoint(x: 30, y: (headerH - title.frame.height) / 2)
        title.autoresizingMask = [.maxXMargin]
        header.addSubview(title)

        if let prov = [source, project].compactMap({ $0 }).filter({ !$0.isEmpty }).first {
            let sub = NSTextField(labelWithString: "· \(prov)")
            sub.font = .monospacedSystemFont(ofSize: 9, weight: .regular)
            sub.textColor = NSColor(red: 0x8b/255.0, green: 0x95/255.0, blue: 0x7a/255.0, alpha: 1)
            sub.sizeToFit()
            sub.frame.origin = NSPoint(x: title.frame.maxX + 8, y: (headerH - sub.frame.height) / 2)
            sub.autoresizingMask = [.maxXMargin]
            header.addSubview(sub)
        }

        // Hint on the right — you drag by the header, draw in the body.
        let drag = NSTextField(labelWithString: "drag to move · draw below · ⌘W closes")
        drag.font = .monospacedSystemFont(ofSize: 9, weight: .regular)
        drag.textColor = NSColor(red: 0x8b/255.0, green: 0x95/255.0, blue: 0x7a/255.0, alpha: 0.7)
        drag.sizeToFit()
        drag.frame.origin = NSPoint(x: content.bounds.width - drag.frame.width - 12, y: (headerH - drag.frame.height) / 2)
        drag.autoresizingMask = [.minXMargin]
        header.addSubview(drag)

        web.frame = NSRect(x: 0, y: 0, width: content.bounds.width, height: content.bounds.height - headerH)
        web.autoresizingMask = [.width, .height]

        content.addSubview(web)
        content.addSubview(header)
        window.contentView = content
    }

    @objc private func closeTapped() {
        persistFrame()              // remember where the user left it for next open
        if let m = pinchMonitor { NSEvent.removeMonitor(m); pinchMonitor = nil }
        window.orderOut(nil)        // take it off-screen NOW — the controller's callback only retracts the
        onUserClosed?()             // trigger + drops its ref, so the window must hide itself here
    }

    /// Float the board: load the bundled whiteboard.html and order it in WITHOUT stealing focus (the
    /// non-activating show — like the PIP feed appearing). The user clicks in to draw / type.
    func show() {
        guard let url = htmlURL() else {
            NSLog("[whiteboard] could not locate whiteboard.html (not bundled, no html override) — cannot float the board")
            return
        }
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        window.orderFrontRegardless()
    }

    /// Bring an already-open board forward (a re-trigger while it's up).
    func front() { window.orderFrontRegardless() }

    /// Rebind to a new run (fresh shot filenames) without reloading — a new /whiteboard on the same board.
    func setRun(_ newRun: String, seed: Any? = nil) {
        run = newRun
        sendN = 0
        web.evaluateJavaScript("window.__whiteboardRun = \(WhiteboardPanel.jsStr(newRun));", completionHandler: nil)
        // If the re-trigger carried a new seed, load it into the already-open board (adds to what's there).
        if let seedJS = WhiteboardPanel.seedJS(seed) {
            web.evaluateJavaScript("window.__wbLoadSeed && window.__wbLoadSeed(\(seedJS));", completionHandler: nil)
        }
    }

    func close() { if let m = pinchMonitor { NSEvent.removeMonitor(m); pinchMonitor = nil }; window.orderOut(nil) }

    // Locate the whiteboard HTML: an explicit override (dev/testing), else the bundled Resources copy.
    private func htmlURL() -> URL? {
        if let ov = htmlOverride, !ov.isEmpty, FileManager.default.fileExists(atPath: ov) {
            return URL(fileURLWithPath: ov)
        }
        return Bundle.main.url(forResource: "whiteboard", withExtension: "html")
    }

    // MARK: frame memory

    private static func restoredFrame() -> NSRect {
        if let s = UserDefaults.standard.string(forKey: frameKey) {
            let r = NSRectFromString(s)
            if r.width >= 200, r.height >= 200 { return r }
        }
        // First open — centered on the main screen at the default size.
        let size = defaultSize
        if let vis = NSScreen.main?.visibleFrame {
            return NSRect(x: vis.midX - size.width / 2, y: vis.midY - size.height / 2, width: size.width, height: size.height)
        }
        return NSRect(x: 200, y: 200, width: size.width, height: size.height)
    }
    private func persistFrame() {
        UserDefaults.standard.set(NSStringFromRect(window.frame), forKey: WhiteboardPanel.frameKey)
    }
    func windowDidMove(_ notification: Notification) { persistFrame() }
    func windowDidResize(_ notification: Notification) { persistFrame() }

    // MARK: Send handoff — page → native → the SAME files server.mjs writes (skill polling unchanged)

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "whiteboard", let body = message.body as? [String: Any],
              let png = body["png"] as? String else { return }
        do {
            let b64 = png.replacingOccurrences(of: "data:image/png;base64,", with: "")
            guard let data = Data(base64Encoded: b64) else { throw WhiteboardError("bad base64 PNG") }
            let shots = rel("whiteboard-shots")
            try FileManager.default.createDirectory(atPath: shots, withIntermediateDirectories: true)
            sendN += 1
            let file = (shots as NSString).appendingPathComponent("\(run)-\(sendN).png")
            try data.write(to: URL(fileURLWithPath: file))
            let rec: [String: Any] = ["runId": run, "n": sendN, "shot": file, "finishedAt": WhiteboardPanel.iso.string(from: Date())]
            // whiteboard-result.json — the latest send (pretty, like the server). Atomic so the polling
            // skill never reads a half-written file.
            if let rd = try? JSONSerialization.data(withJSONObject: rec, options: [.prettyPrinted]) {
                try? rd.write(to: URL(fileURLWithPath: rel("whiteboard-result.json")), options: .atomic)
            }
            // whiteboard-history.jsonl — append-only recovery log (one compact JSON per line).
            if let hd = try? JSONSerialization.data(withJSONObject: rec, options: []),
               var line = String(data: hd, encoding: .utf8) {
                line += "\n"
                appendLine(line, to: rel("whiteboard-history.jsonl"))
            }
            NSLog("[whiteboard] sent → \(file)")
            web.evaluateJavaScript("window.__whiteboardSent && window.__whiteboardSent(true)", completionHandler: nil)
        } catch {
            let msg = (error as? WhiteboardError)?.msg ?? error.localizedDescription
            NSLog("[whiteboard] send failed: \(msg)")
            web.evaluateJavaScript("window.__whiteboardSent && window.__whiteboardSent(false, \(WhiteboardPanel.jsStr(msg)))", completionHandler: nil)
        }
    }

    private func appendLine(_ line: String, to path: String) {
        let url = URL(fileURLWithPath: path)
        guard let data = line.data(using: .utf8) else { return }
        if let fh = try? FileHandle(forWritingTo: url) {
            defer { try? fh.close() }
            fh.seekToEndOfFile()
            fh.write(data)
        } else {
            try? data.write(to: url)   // file didn't exist yet — create it
        }
    }

    static func jsonStr(_ o: Any) -> String? {
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.fragmentsAllowed]) else { return nil }
        return String(data: d, encoding: .utf8)
    }
    static func jsStr(_ s: String) -> String { jsonStr(s) ?? "\"\"" }
    /// Serialize a `seed` (expected: an array of board-object dictionaries) to a JS array literal, or nil if
    /// it's absent / empty / not JSON-serializable — so a run with no seed opens a blank board as before.
    static func seedJS(_ seed: Any?) -> String? {
        guard let arr = seed as? [Any], !arr.isEmpty else { return nil }
        return jsonStr(arr)
    }
}

struct WhiteboardError: Error { let msg: String; init(_ m: String) { msg = m } }
