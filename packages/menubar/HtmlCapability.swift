// HtmlCapability — the keystone "create-HTML" capability, live in the app (docs/STORE.md §The HTML
// capability): Claude writes HTML/SVG instantly, so diagrams / thumbnails / quick illustrative images
// don't need a slow image model. text → claude_complete (via GodDaemonBridge, the same daemon wire
// the drive surface uses) → a self-contained HTML doc → offscreen WKWebView snapshot → a crisp PNG
// on disk that the notch widget can show and the user can drag out.
//
// Two entry points:
//   • makeDiagram(from:)  — the full capability: prompt Claude for a 1000x640 dark diagram, render it.
//   • render(html:width:height:) — the reusable half: ANY html → PNG path (thumbnails, charts, slides).
//
// Same module as RelayMenuBar.swift (TOKEN_FILE) and GodWebWindow.swift (GodDaemonBridge) — no imports.
import AppKit
import WebKit

/// A readable error for the notch's text widget ("no token", "timed out", "snapshot failed"…).
struct HtmlCapabilityError: LocalizedError {
    let message: String
    init(_ m: String) { message = m }
    var errorDescription: String? { message }
}

@MainActor final class HtmlCapability: NSObject, WKNavigationDelegate {
    static let shared = HtmlCapability()
    private override init() { super.init() }

    /// The wire identity for the completion: a granted origin (the dev-wrapp origin the drive
    /// surface already uses), so the daemon routes it through an existing grant.
    private let origin = "http://localhost:5188"
    private let diagramSize = CGSize(width: 1000, height: 640)
    private let bridgeTimeout: TimeInterval = 60

    // ── in-flight state (strong refs, released on completion) ───────────────────────────────────
    private struct DiagramCall {
        let bridge: GodDaemonBridge
        let completion: (Result<String, Error>) -> Void
    }
    private struct RenderJob {
        let window: NSWindow          // keeps the offscreen window alive until the snapshot lands
        let web: WKWebView
        let width: CGFloat
        let height: CGFloat
        let completion: (Result<String, Error>) -> Void
    }
    private var diagramCalls: [UUID: DiagramCall] = [:]
    private var renderJobs: [ObjectIdentifier: RenderJob] = [:]

    // ── the capability: text → diagram PNG on disk ──────────────────────────────────────────────
    /// Asks the user's own Claude (through the daemon — same gate, same grants) for a self-contained
    /// HTML diagram, then renders it offscreen. `completion` gets the PNG's absolute path.
    func makeDiagram(from text: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard let raw = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8),
              case let token = raw.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            completion(.failure(HtmlCapabilityError("~/.relay/pairing-token is missing — is the daemon set up?")))
            return
        }
        let snippet = String(text.prefix(2000))
        let prompt = "You are a diagram engine. Output ONLY a single self-contained HTML document "
            + "(no markdown fences), 1000x640px, dark background #000, ink #E8EDF4, ONE lime accent "
            + "#C8F250, system-ui font, that visualizes the following as a clean diagram/graphic: \(snippet)"

        let id = UUID()
        let bridge = GodDaemonBridge(token: token)   // short-lived; closed when the call settles
        diagramCalls[id] = DiagramCall(bridge: bridge, completion: completion)
        bridge.request(origin: origin, method: "claude_complete",
                       params: ["prompt": prompt, "maxTokens": 3000]) { [weak self] result, err in
            Task { @MainActor in self?.diagramResponded(id, result: result, err: err) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + bridgeTimeout) { [weak self] in
            self?.diagramTimedOut(id)
        }
    }

    private func diagramResponded(_ id: UUID, result: Any?, err: [String: Any]?) {
        guard let call = diagramCalls.removeValue(forKey: id) else { return }   // already timed out
        call.bridge.close()
        if let err {
            let msg = (err["message"] as? String) ?? "daemon error"
            call.completion(.failure(HtmlCapabilityError(msg)))
            return
        }
        guard let dict = result as? [String: Any], let text = dict["text"] as? String, !text.isEmpty else {
            call.completion(.failure(HtmlCapabilityError("Claude returned no text for the diagram.")))
            return
        }
        let html = HtmlCapability.extractHTML(text)
        render(html: html, width: diagramSize.width, height: diagramSize.height, completion: call.completion)
    }

    private func diagramTimedOut(_ id: UUID) {
        guard let call = diagramCalls.removeValue(forKey: id) else { return }   // already settled
        call.bridge.close()
        call.completion(.failure(HtmlCapabilityError("Timed out after \(Int(bridgeTimeout))s waiting for Claude — is the daemon running?")))
    }

    // ── the reusable primitive: prompt → plain text ─────────────────────────────────────────────
    /// A raw `claude_complete` through the daemon (same gate/grants) — used for the Explain-mode Moira
    /// voiceover script. Same short-lived-bridge + timeout machinery as makeDiagram; returns the text.
    private var textCalls: [UUID: DiagramCall] = [:]
    func makeText(prompt: String, maxTokens: Int = 900, completion: @escaping (Result<String, Error>) -> Void) {
        guard let raw = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8),
              case let token = raw.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            completion(.failure(HtmlCapabilityError("~/.relay/pairing-token is missing — is the daemon set up?")))
            return
        }
        let id = UUID()
        let bridge = GodDaemonBridge(token: token)
        textCalls[id] = DiagramCall(bridge: bridge, completion: completion)
        bridge.request(origin: origin, method: "claude_complete",
                       params: ["prompt": prompt, "maxTokens": maxTokens]) { [weak self] result, err in
            Task { @MainActor in self?.textResponded(id, result: result, err: err) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + bridgeTimeout) { [weak self] in
            guard let call = self?.textCalls.removeValue(forKey: id) else { return }
            call.bridge.close()
            call.completion(.failure(HtmlCapabilityError("Timed out after \(Int(self?.bridgeTimeout ?? 60))s waiting for Claude.")))
        }
    }
    private func textResponded(_ id: UUID, result: Any?, err: [String: Any]?) {
        guard let call = textCalls.removeValue(forKey: id) else { return }
        call.bridge.close()
        if let err { call.completion(.failure(HtmlCapabilityError((err["message"] as? String) ?? "daemon error"))); return }
        guard let dict = result as? [String: Any], let text = dict["text"] as? String, !text.isEmpty else {
            call.completion(.failure(HtmlCapabilityError("Claude returned no text."))); return
        }
        call.completion(.success(text))
    }

    // ── the reusable primitive: any HTML → PNG path ─────────────────────────────────────────────
    /// Renders `html` in a hidden offscreen window at the exact pixel size and snapshots it to
    /// NSTemporaryDirectory()/notch-canvas/<uuid>.png. Multiple renders may be in flight at once.
    func render(html: String, width: CGFloat, height: CGFloat, completion: @escaping (Result<String, Error>) -> Void) {
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        let window = NSWindow(contentRect: NSRect(x: -4000, y: 0, width: width, height: height),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = web
        web.navigationDelegate = self
        window.orderFrontRegardless()   // offscreen at x:-4000 — WebKit paints, the user never sees it
        renderJobs[ObjectIdentifier(web)] = RenderJob(window: window, web: web, width: width, height: height, completion: completion)
        web.loadHTMLString(html, baseURL: nil)
    }

    // MARK: WKNavigationDelegate (offscreen renders only)
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let job = renderJobs[ObjectIdentifier(webView)] else { return }
        // Give layout/fonts/gradients a beat to settle — the same 0.5s the widget snapshot path uses.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            let cfg = WKSnapshotConfiguration()
            cfg.rect = NSRect(x: 0, y: 0, width: job.width, height: job.height)
            job.web.takeSnapshot(with: cfg) { image, err in   // WebKit calls back on main
                self?.finishRender(webView, image: image, err: err)
            }
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failRender(webView, error)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failRender(webView, error)
    }

    private func failRender(_ web: WKWebView, _ error: Error) {
        guard let job = renderJobs.removeValue(forKey: ObjectIdentifier(web)) else { return }
        job.window.orderOut(nil)
        job.completion(.failure(error))
    }

    private func finishRender(_ web: WKWebView, image: NSImage?, err: Error?) {
        guard let job = renderJobs.removeValue(forKey: ObjectIdentifier(web)) else { return }
        job.window.orderOut(nil)
        guard let image, let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            let detail = err.map { ": \($0.localizedDescription)" } ?? ""
            job.completion(.failure(HtmlCapabilityError("Snapshot failed\(detail)")))
            return
        }
        let dir = (NSTemporaryDirectory() as NSString).appendingPathComponent("notch-canvas")
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            let path = (dir as NSString).appendingPathComponent(UUID().uuidString + ".png")
            try png.write(to: URL(fileURLWithPath: path))
            job.completion(.success(path))
        } catch {
            job.completion(.failure(error))
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────
    /// The prompt forbids fences, but models drift: strip a leading ```/```html fence + trailing ```,
    /// and if chatter precedes the document, slice from the first <!doctype / <html / <svg.
    static func extractHTML(_ raw: String) -> String {
        var t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("```") {
            if let nl = t.firstIndex(of: "\n") { t = String(t[t.index(after: nl)...]) }
            if let close = t.range(of: "```", options: .backwards) { t = String(t[..<close.lowerBound]) }
            t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if !t.lowercased().hasPrefix("<!doctype") && !t.lowercased().hasPrefix("<html") {
            for marker in ["<!doctype", "<html", "<svg"] {
                if let r = t.range(of: marker, options: .caseInsensitive) { return String(t[r.lowerBound...]) }
            }
        }
        return t
    }
}
