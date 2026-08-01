// GodWebWindow — the native surface for God to DRIVE a wrapp and let the user WATCH.
//
// A wrapp is a browser app. Rather than factor its orchestration into a headless core (heavy, lossy,
// invisible), God hosts the wrapp in a floating WKWebView it controls and drives the REAL UI:
//   • an injected window.claude shim (SHIM_JS) is BRIDGED to the daemon — the page can't open that
//     socket itself (the daemon rejects browser-Origin WS), so native owns the wire: shim → this
//     process (WKScriptMessageHandler) → daemon WS (as the wrapp's origin) → responses + stream
//     deltas back into the page. Faithful to packages/switchboard-mcp/daemon-client.mjs.
//   • the wrapp declares its God-callable actions via kit/webmcp.js (window.__god); God enumerates
//     them (`listTools`) and calls one (`drive`) via callAsyncJavaScript. The wrapp's own pipeline
//     runs and paints live — so the user sees it happen.
//
// PROVEN end-to-end (2026-07-31): Roast driven on the user's real Claude through this exact bridge —
// a 2318-char roast rendered live in the floating window. This file is the demo (scratchpad
// godweb-b.swift) refactored into a reusable component; NOT yet compiled into the app (build.sh
// still lists only RelayMenuBar.swift). Integration TODO at the bottom.
//
// Consent: God's per-action notch drop (ActionConsentDrop in RelayMenuBar.swift) still gates
// write-class actions BEFORE `drive` is called. This window is a rendering surface, not a new trust
// surface — same daemon, same grants, same audit.
import AppKit
import WebKit

// The window.claude shim, injected at documentStart (before the wrapp's module). Matches the provider
// shape the SDK wraps (examples/apps/harness/provider.js): request({method,params})→Promise,
// on/removeListener, isRelay, and the claude#initialized event. Every request tunnels to native.
let GOD_SHIM_JS = """
(function () {
  if (window.claude && window.claude.isRelay) return;
  var pending = {}, listeners = {}, seq = 0;
  function emit(ev, payload) { (listeners[ev] || []).forEach(function (h) { try { h(payload); } catch (e) {} }); }
  window.__relayResolve = function (env) {
    var p = pending[env.id]; if (!p) return; delete pending[env.id];
    if (env.error && env.error !== null) { var e = new Error((env.error && env.error.message) || "relay error"); if (env.error.code) e.code = env.error.code; p.reject(e); }
    else p.resolve(env.result);
  };
  window.__relayEmit = function (ev, payload) { emit(ev, payload); };
  var provider = {
    version: "0.1-godweb", isRelay: true,
    request: function (args) {
      return new Promise(function (resolve, reject) {
        var id = "gw" + (++seq);
        pending[id] = { resolve: resolve, reject: reject };
        try { window.webkit.messageHandlers.relay.postMessage({ id: id, method: args.method, params: args.params || {} }); }
        catch (e) { delete pending[id]; reject(e); }
      });
    },
    on: function (ev, h) { (listeners[ev] = listeners[ev] || []).push(h); },
    removeListener: function (ev, h) { listeners[ev] = (listeners[ev] || []).filter(function (x) { return x !== h; }); },
  };
  window.claude = provider;
  try { window.dispatchEvent(new Event("claude#initialized")); } catch (e) {}
})();
"""

/// A second client of the daemon over its loopback WS. Auth with the pairing token (no Origin header
/// ⇒ passes the daemon's extension-only Rule 1), then request/response + `delta`/other events —
/// faithful to server.ts's wire and daemon-client.mjs.
final class GodDaemonBridge: NSObject {
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private let port: UInt16
    private let token: String
    private var authed = false
    private var queue: [[String: Any]] = []
    private var pending: [String: (Any?, [String: Any]?) -> Void] = [:]
    /// (eventName, payload) for every daemon event (stream deltas, health, permissionsChanged, …).
    var onEvent: ((String, [String: Any]) -> Void)?
    var onReady: (() -> Void)?

    init(port: UInt16 = 8787, token: String) { self.port = port; self.token = token; super.init(); connect() }

    private func connect() {
        task = session.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task?.resume(); receive()
        send(["type": "auth", "token": token])
    }
    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            if case let .success(m) = result, case let .string(s) = m, let d = s.data(using: .utf8),
               let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { self.handle(o) }
            if case .success = result { self.receive() }
        }
    }
    private func handle(_ o: [String: Any]) {
        switch o["type"] as? String {
        case "auth_ok": authed = true; flush(); onReady?()
        case "response":
            if let id = o["id"] as? String, let cb = pending.removeValue(forKey: id) { cb(o["result"], o["error"] as? [String: Any]) }
        case "event":
            if let ev = o["event"] as? String { onEvent?(ev, (o["payload"] as? [String: Any]) ?? [:]) }
        default: break   // "prompt": consent is a human click at the notch, never ours to answer.
        }
    }
    func request(origin: String, method: String, params: [String: Any], _ cb: @escaping (Any?, [String: Any]?) -> Void) {
        let id = UUID().uuidString
        pending[id] = cb
        let msg: [String: Any] = ["type": "request", "id": id, "origin": origin, "method": method, "params": params, "sentAt": Int(Date().timeIntervalSince1970 * 1000)]
        if authed { send(msg) } else { queue.append(msg) }
    }
    func close() { task?.cancel(with: .goingAway, reason: nil) }
    private func flush() { for m in queue { send(m) }; queue.removeAll() }
    private func send(_ o: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }
}

/// A floating window hosting one wrapp, its window.claude bridged to the daemon, drivable by God.
@MainActor
final class GodWebWindow: NSObject, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    func windowWillClose(_ notification: Notification) { onUserClosed?() }
    private let window: NSWindow
    private let web: WKWebView
    private let bridge: GodDaemonBridge
    private let origin: String                 // authoritative isolation key; native asserts it
    private let pageURL: URL
    private var onReady: (() -> Void)?

    /// - Parameters:
    ///   - url: the wrapp page (its deployed URL, or a granted localhost origin for dev).
    ///   - token: the daemon pairing token (~/.relay/pairing-token).
    init(url: URL, token: String, port: UInt16 = 8787) {
        pageURL = url
        origin = GodWebWindow.originOf(url)
        bridge = GodDaemonBridge(port: port, token: token)
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: GOD_SHIM_JS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let cfg = WKWebViewConfiguration(); cfg.userContentController = ucc
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1040, height: 860), configuration: cfg)
        window = NSWindow(contentRect: NSRect(x: 140, y: 120, width: 1040, height: 860),
                          styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        super.init()
        ucc.add(self, name: "relay")
        bridge.onEvent = { [weak self] ev, payload in
            guard let self, let json = GodWebWindow.jsonStr(payload) else { return }
            DispatchQueue.main.async { self.web.evaluateJavaScript("window.__relayEmit(\(GodWebWindow.jsStr(ev)), \(json))", completionHandler: nil) }
        }
        window.title = "God"
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.contentView = web
        web.navigationDelegate = self
    }

    /// Fires when the USER closes the window (red button) — the drive falls back to the notch surface.
    var onUserClosed: (() -> Void)?

    /// Load the wrapp. `visible: false` loads it OFFSCREEN (the notch widget is the surface; the
    /// window can be fronted later without reloading). `ready` fires once window.__god is available.
    func open(visible: Bool = true, ready: (() -> Void)? = nil) {
        onReady = ready
        window.delegate = self
        if visible { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
        web.load(URLRequest(url: pageURL))
    }

    /// Bring the (possibly offscreen) window forward — the notch→window surface flip.
    func front() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }

    /// Is the user LOOKING at the wrapp right now? Decides result routing: window frontmost → the
    /// wrapp shows its own result; otherwise → drop it from the notch like a notification.
    var isFrontmost: Bool { window.isVisible && window.isKeyWindow }
    var isShown: Bool { window.isVisible }

    func close() { bridge.close(); window.orderOut(nil) }

    /// Enumerate the wrapp's God-callable tools (kit/webmcp → window.__god.list()).
    func listTools(_ completion: @escaping ([[String: Any]]) -> Void) {
        web.evaluateJavaScript("JSON.stringify((window.__god && window.__god.list && window.__god.list()) || [])") { res, _ in
            let arr = (res as? String).flatMap { $0.data(using: .utf8) }.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]]
            completion(arr ?? [])
        }
    }

    /// Drive one tool. The wrapp's real pipeline runs and paints live; `completion` gets its result.
    func drive(tool: String, input: [String: Any], _ completion: @escaping (Result<Any, Error>) -> Void) {
        guard let inputJSON = GodWebWindow.jsonStr(input) else { completion(.failure(GodWebError("bad input"))); return }
        let body = "return await window.__god.call(\(GodWebWindow.jsStr(tool)), \(inputJSON));"
        web.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let v): completion(.success(v))
            case .failure(let e):
                // WebKit collapses a thrown Error into a generic "A JavaScript exception occurred"; the
                // real message (e.g. "Prism couldn't render that", or a denied Higgsfield call) is in the
                // WKError userInfo. Surface it so the notch shows what actually went wrong.
                let ns = e as NSError
                let jsMsg = (ns.userInfo["WKJavaScriptExceptionMessage"] as? String)
                    ?? (ns.userInfo["NSLocalizedDescription"] as? String)
                completion(.failure(jsMsg.map { GodWebError($0) } ?? e))
            }
        }
    }

    // MARK: WKNavigationDelegate
    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) { pollReady(80) }
    private func pollReady(_ n: Int) {
        web.evaluateJavaScript("!!(window.__god && typeof window.__god.call === 'function')") { [weak self] res, _ in
            guard let self else { return }
            if (res as? Bool) == true { self.onReady?() }
            else if n > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.pollReady(n - 1) } }
        }
    }

    // MARK: WKScriptMessageHandler — page → native → daemon → page
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "relay", let body = message.body as? [String: Any],
              let id = body["id"] as? String, let method = body["method"] as? String else { return }
        let params = body["params"] as? [String: Any] ?? [:]
        bridge.request(origin: origin, method: method, params: params) { [weak self] result, err in
            guard let self else { return }
            let env: [String: Any] = ["id": id, "result": result ?? NSNull(), "error": err ?? NSNull()]
            guard let json = GodWebWindow.jsonStr(env) else { return }
            DispatchQueue.main.async { self.web.evaluateJavaScript("window.__relayResolve(\(json))", completionHandler: nil) }
        }
    }

    // MARK: helpers
    static func originOf(_ url: URL) -> String {
        guard let scheme = url.scheme, let host = url.host else { return url.absoluteString }
        if let port = url.port { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }
    static func jsonStr(_ o: Any) -> String? {
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.fragmentsAllowed]) else { return nil }
        return String(data: d, encoding: .utf8)
    }
    static func jsStr(_ s: String) -> String { jsonStr(s) ?? "\"\"" }
}

struct GodWebError: Error { let msg: String; init(_ m: String) { msg = m } }

// ── INTEGRATION TODO (next) ──────────────────────────────────────────────────────────────────────
// 1. Add this file to packages/menubar/build.sh's swiftc line (compile alongside RelayMenuBar.swift).
// 2. Wire a trigger: God's loop (or the store "give God this" toggle) opens a GodWebWindow for a
//    wrapp, calls listTools, and — after the notch ActionConsentDrop — drive(tool:input:), then
//    narrates the result via the companion (voice/point).
// 3. Point it at Prism for the images-appearing-live demo (same code, different wrapp + tool).
