// AmbientSensor — the LOCAL sensing core of Switchboard's "ambient mode".
//
// PRIVACY CONTRACT (this is the whole point):
//   • STRICTLY LOCAL. Zero network. Zero cloud. Zero model. Zero screenshots.
//   • The sensor observes only what macOS already tells the OS: the frontmost app,
//     its bundle id, its focused window title, whether a text field is focused, and a
//     best-effort URL — all via on-device AppKit + Accessibility APIs.
//   • Nothing is persisted, transmitted, or logged off-box. The signal is produced,
//     matched against LOCAL rules, and handed to the app in-process.
//   • The relevance matcher is rules-based (case-insensitive contains / token overlap).
//     No inference, no embeddings, no LLM. It only ever suggests catalog ids that were
//     actually passed in — it cannot invent a destination.
//
// Integrated into the menubar app (build.sh compiles it in). The standalone demo `main` that
// proved this spike lives in git history; the types + sensor + matcher below are the shipped code.
//
import AppKit
import ApplicationServices

// MARK: - Contract types (exact shapes the rest of the app integrates against)

enum AmbientAppKind { case browser, editor, finder, mail, terminal, document, other }

struct AmbientSignal: Equatable {
    let bundleId: String
    let appName: String
    var windowTitle: String?     // from AX AXFocusedWindow → AXTitle
    var url: String?             // browsers: best-effort from the AX tree (AXWebArea/AXDocument); nil if unavailable
    var focusedFormField: Bool   // AX: is a text field / text area / editable web control focused right now?
    var kind: AmbientAppKind
}

struct AmbientSuggestion: Equatable, Identifiable {
    let title: String            // e.g. "Draft a caption"
    let subtitle: String         // e.g. "You're on LinkedIn"
    let kind: String             // "wrapp" | "skill" | "widget"
    let targetId: String         // catalog id to open/drive, or a widget id
    let sfSymbol: String         // SF Symbol name for the card icon
    var id: String { targetId }  // stable id (targetIds are de-duped per suggestion list) — for SwiftUI ForEach
}

// MARK: - Classification (LOCAL, bundle-id → kind)

func classify(bundleId: String) -> AmbientAppKind {
    let b = bundleId.lowercased()
    // Browsers
    let browsers = [
        "com.google.chrome", "com.google.chrome.canary", "com.apple.safari",
        "com.apple.safaritechnologypreview", "company.thebrowser.browser", // Arc
        "org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition",
        "com.microsoft.edgemac", "com.brave.browser", "com.operasoftware.opera",
        "com.vivaldi.vivaldi", "ai.perplexity.comet", "company.thebrowser.dia"
    ]
    if browsers.contains(b) { return .browser }
    // Editors / IDEs
    if b == "com.microsoft.vscode" || b == "com.microsoft.vscodeinsiders"
        || b == "com.vscodium" || b == "com.apple.dt.xcode"
        || b.hasPrefix("com.jetbrains.") || b.hasPrefix("com.google.android.studio")
        || b == "com.sublimetext.4" || b == "com.sublimetext.3"
        || b == "dev.zed.zed" || b == "com.todesktop.230313mzl4w4u92" /* Cursor */ {
        return .editor
    }
    // Finder
    if b == "com.apple.finder" { return .finder }
    // Mail
    if b == "com.apple.mail" || b == "com.microsoft.outlook"
        || b == "com.readdle.smartemail-mac" /* Spark */ || b == "com.airmailapp.airmail" {
        return .mail
    }
    // Terminals
    if b == "com.apple.terminal" || b == "com.googlecode.iterm2"
        || b == "dev.warp.warp-stable" || b == "net.kovidgoyal.kitty"
        || b == "com.github.wez.wezterm" || b == "io.alacritty" {
        return .terminal
    }
    // Documents / viewers
    if b == "com.apple.preview" || b.hasPrefix("com.adobe.acrobat")
        || b == "com.adobe.reader" || b == "net.sourceforge.skim-app.skim" {
        return .document
    }
    return .other
}

// MARK: - Accessibility helpers (LOCAL — read-only AX tree walk)

// Read a string AX attribute off an element.
private func axString(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard err == .success, let v = value else { return nil }
    if CFGetTypeID(v) == CFStringGetTypeID() { return (v as! String) }
    // Some URL attributes come back as CFURL.
    if CFGetTypeID(v) == CFURLGetTypeID() { return (v as! URL).absoluteString }
    return nil
}

// Read a child AXUIElement attribute (e.g. AXFocusedWindow, AXFocusedUIElement).
private func axElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard err == .success, let v = value, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return (v as! AXUIElement)
}

private func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
    guard err == .success, let v = value, CFGetTypeID(v) == CFArrayGetTypeID() else { return [] }
    return (v as! [AXUIElement])
}

// Is the currently focused element an editable text control?
private func isEditableRole(_ role: String?, _ element: AXUIElement) -> Bool {
    guard let role = role else { return false }
    switch role {
    case "AXTextField", "AXTextArea", "AXComboBox", "AXSearchField":
        return true
    case "AXWebArea":
        // A focused web area is only "form editable" if it advertises a settable value / AXEditableAncestor.
        var settable = DarwinBoolean(false)
        AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
        return settable.boolValue
    default:
        // Generic web/native fields sometimes report a subrole instead.
        if let sub = axString(element, kAXSubroleAttribute as String),
           sub == "AXContentEditable" || sub == "AXTextEntryArea" { return true }
        // Fall back to "value is settable" as a proxy for editability.
        var settable = DarwinBoolean(false)
        AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
        return settable.boolValue
    }
}

// Best-effort URL for a browser: try the focused window first, then a bounded BFS for an AXWebArea.
private func bestEffortURL(app: AXUIElement, focusedWindow: AXUIElement?) -> String? {
    // Common AX url attribute names across browsers.
    let urlAttrs = ["AXURL", kAXURLAttribute as String, "AXDocument"]
    func tryURL(_ el: AXUIElement) -> String? {
        for a in urlAttrs { if let s = axString(el, a), !s.isEmpty { return s } }
        return nil
    }
    // The window itself sometimes carries AXDocument (a file:// or http URL).
    if let w = focusedWindow, let u = tryURL(w) { return u }

    // Bounded breadth-first walk looking for the AXWebArea (the rendered page root).
    let root = focusedWindow ?? app
    var queue: [AXUIElement] = [root]
    var visited = 0
    let maxVisit = 400        // hard cap: keeps this cheap + bounded, never a full deep crawl
    while !queue.isEmpty && visited < maxVisit {
        let el = queue.removeFirst()
        visited += 1
        if let role = axString(el, kAXRoleAttribute as String), role == "AXWebArea" {
            if let u = tryURL(el) { return u }
        }
        for child in axChildren(el) { queue.append(child) }
    }
    return nil
}

// MARK: - Native exact-URL layer (OPT-IN AppleScript, browsers only)
//
// The AX walk above is best-effort and silent — no permission prompt, works today. But it can
// return nil (e.g. the AXWebArea isn't reachable within the bounded BFS, or the browser doesn't
// surface a URL attribute). This OPT-IN layer asks the browser directly for its active-tab URL
// via AppleScript — an EXACT answer — used ONLY as a fallback when the AX walk came back nil.
//
// Why opt-in: the FIRST AppleScript to each browser triggers a one-time macOS "Automation"
// permission prompt (Switchboard wants to control <Browser>). We never want to surprise the user
// with that, so we only attempt it when the flag file ~/.relay/ambient-applescript-urls exists.
// Absent the flag, behaviour is EXACTLY as before (AX-only, zero prompts).
//
// Privacy: AppleScript here reads ONLY the URL string of the front tab. It never types, clicks,
// navigates, or reads page content — and, like everything in this sensor, the string stays local.

/// True when the user has opted into the native exact-URL layer by creating the flag file.
/// Cheap `fileExists` check — safe to call on every sample.
func appleScriptURLsEnabled() -> Bool {
    let flag = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".relay/ambient-applescript-urls")
    return FileManager.default.fileExists(atPath: flag.path)
}

/// Run an AppleScript source string and return its string result, or nil on ANY error
/// (app not running, not scriptable, no front window, permission denied). Never throws.
private func runAppleScript(_ source: String) -> String? {
    guard let script = NSAppleScript(source: source) else { return nil }
    var errorInfo: NSDictionary?
    let descriptor = script.executeAndReturnError(&errorInfo)
    guard errorInfo == nil else { return nil }        // any error → give up quietly
    guard let s = descriptor.stringValue, !s.isEmpty else { return nil }
    return s
}

/// Bundle id → the browser's scripting application name. Safari uses "current tab"; the
/// Chromium family uses "active tab". Firefox (and anything unlisted) has no scriptable URL
/// → returns nil so we simply skip it.
func appleScriptURL(bundleId: String) -> String? {
    let b = bundleId.lowercased()
    // Safari family — AppleScript term is `current tab`.
    let safariApps: [String: String] = [
        "com.apple.safari": "Safari",
        "com.apple.safaritechnologypreview": "Safari Technology Preview",
    ]
    // Chromium family — AppleScript term is `active tab`.
    let chromiumApps: [String: String] = [
        "com.google.chrome": "Google Chrome",
        "com.google.chrome.canary": "Google Chrome Canary",
        "com.microsoft.edgemac": "Microsoft Edge",
        "com.brave.browser": "Brave Browser",
        "company.thebrowser.browser": "Arc",
        "com.vivaldi.vivaldi": "Vivaldi",
        "com.operasoftware.opera": "Opera",
    ]
    if let name = safariApps[b] {
        return runAppleScript("tell application \"\(name)\" to return URL of current tab of front window")
    }
    if let name = chromiumApps[b] {
        return runAppleScript("tell application \"\(name)\" to return URL of active tab of front window")
    }
    // Firefox has no AppleScript URL support; unknown browsers are skipped too.
    return nil
}

// MARK: - The sensor

final class AmbientSensor {
    /// Called with each fresh signal when the frontmost app changes.
    var onChange: ((AmbientSignal) -> Void)?

    private var observing = false

    /// Read the current frontmost app's signal on demand. Degrades gracefully when AX is untrusted.
    func sampleNow() -> AmbientSignal? {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        let bundleId = app.bundleIdentifier ?? "unknown"
        let name = app.localizedName ?? bundleId
        let kind = classify(bundleId: bundleId)

        var signal = AmbientSignal(
            bundleId: bundleId, appName: name,
            windowTitle: nil, url: nil, focusedFormField: false, kind: kind
        )

        // AX layer — only if THIS process is trusted. The real menubar app holds the grant;
        // a bare swiftc binary usually does not, so we degrade to NSWorkspace-only.
        guard AXIsProcessTrusted() else { return signal }

        let axApp = AXUIElementCreateApplication(app.processIdentifier)

        // Focused window → title.
        let focusedWindow = axElement(axApp, kAXFocusedWindowAttribute as String)
        if let w = focusedWindow {
            signal.windowTitle = axString(w, kAXTitleAttribute as String)
        }

        // Focused UI element → role → editable?
        if let focused = axElement(axApp, kAXFocusedUIElementAttribute as String) {
            let role = axString(focused, kAXRoleAttribute as String)
            signal.focusedFormField = isEditableRole(role, focused)
        }

        // Browser URL — AX best-effort FIRST (silent, always on).
        if kind == .browser {
            signal.url = bestEffortURL(app: axApp, focusedWindow: focusedWindow)
            // OPT-IN native exact-URL fallback: only when the AX walk found nothing AND the user
            // has enabled it (flag file present). Keeps the default AX-only, prompt-free behaviour.
            if signal.url == nil, appleScriptURLsEnabled() {
                signal.url = appleScriptURL(bundleId: bundleId)
            }
        }

        return signal
    }

    /// Start reacting to app-activation events (event-driven, no polling storm).
    func startObserving() {
        guard !observing else { return }
        observing = true
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(appDidActivate(_:)),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )
    }

    func stopObserving() {
        guard observing else { return }
        observing = false
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    @objc private func appDidActivate(_ note: Notification) {
        if let signal = sampleNow() { onChange?(signal) }
    }
}

// MARK: - Relevance matcher (LOCAL, rules-based — NO model)

private func tokenize(_ s: String) -> [String] {
    s.lowercased()
        .components(separatedBy: CharacterSet.alphanumerics.inverted)
        .filter { $0.count > 2 }
}

private func hostFrom(_ url: String?) -> String? {
    guard let url = url, let comps = URLComponents(string: url), let h = comps.host else { return nil }
    return h.lowercased()
}

/// Score how well a signal's text overlaps a bag of keywords (0…N token hits).
private func overlapScore(haystack: [String], keywords: [String]) -> Int {
    let set = Set(haystack)
    return keywords.reduce(0) { acc, kw in acc + (set.contains(kw.lowercased()) ? 1 : 0) }
}

/// Produce up to 3 ranked, HONEST suggestions. Only ever references ids present in `catalog`.
/// Returns [] when nothing is relevant — the app then shows nothing (never a dead end, never noise).
func suggestions(
    for signal: AmbientSignal,
    catalog: [(id: String, tagline: String, category: String)],
    projects: [(name: String, keywords: [String])]
) -> [AmbientSuggestion] {

    // Only suggest ids that actually exist.
    let ids = Set(catalog.map { $0.id })
    func has(_ id: String) -> Bool { ids.contains(id) }

    // Pick the catalog entry that BEST matches a set of weighted intent keywords (id + tagline
    // are searched, case-insensitive contains). Earlier keywords are worth more, so a wrapp
    // whose tagline actually mentions "summarize"/"pdf" beats one that only says "document".
    // Returns nil when nothing scores — the caller then emits nothing (honest, no filler).
    func bestMatch(_ weighted: [(kw: String, weight: Int)]) -> (id: String, tagline: String, category: String)? {
        catalog
            .map { c -> (Int, (id: String, tagline: String, category: String)) in
                let t = (c.id + " " + c.tagline).lowercased()
                let score = weighted.reduce(0) { acc, w in acc + (t.contains(w.kw) ? w.weight : 0) }
                return (score, c)
            }
            .filter { $0.0 > 0 }
            .max { $0.0 < $1.0 }
            .map { $0.1 }
    }

    // The observable text of this moment.
    let host = hostFrom(signal.url)
    let title = signal.windowTitle ?? ""
    let contextTokens = tokenize([title, signal.appName, host ?? "", signal.url ?? ""].joined(separator: " "))

    // Ranked accumulator: (score, suggestion).
    var scored: [(Int, AmbientSuggestion)] = []
    var seenTargets = Set<String>()
    func add(_ score: Int, _ s: AmbientSuggestion) {
        guard !seenTargets.contains(s.targetId) else { return }
        seenTargets.insert(s.targetId)
        scored.append((score, s))
    }

    // ── Rule 1: social host in a browser → caption / repurpose skill ──────────────
    let socialHosts = ["linkedin.com", "x.com", "twitter.com", "instagram.com", "threads.net", "tiktok.com"]
    if signal.kind == .browser, let h = host, socialHosts.contains(where: { h == $0 || h.hasSuffix("." + $0) }) {
        let where_ = h.replacingOccurrences(of: "www.", with: "")
        // Prefer a real "caption/post/repurpose" wrapp if the catalog has one.
        if let m = bestMatch([("caption", 4), ("repurpose", 4), ("social", 3), ("post", 2)]) {
            add(6, AmbientSuggestion(
                title: "Draft a post",
                subtitle: "You're on \(where_)",
                kind: "wrapp", targetId: m.id, sfSymbol: "square.and.pencil"))
        }
    }

    // ── Rule 2: PDF / document viewer → summarize / convert ───────────────────────
    let titleLooksPdf = title.lowercased().hasSuffix(".pdf") || (signal.url?.lowercased().hasSuffix(".pdf") ?? false)
    if signal.kind == .document || titleLooksPdf {
        if let m = bestMatch([("summar", 4), ("pdf", 3), ("convert", 2), ("document", 1)]) {
            add(5, AmbientSuggestion(
                title: "Summarize this document",
                subtitle: title.isEmpty ? "PDF open" : title,
                kind: "wrapp", targetId: m.id, sfSymbol: "doc.text.magnifyingglass"))
        }
    }

    // ── Rule 3: focused compose/reply field in mail (or a browser mail/compose) → reply / polish ──
    let composey = ["compose", "reply", "re:", "fwd:", "message", "new message", "inbox"]
    let inComposeContext = signal.kind == .mail
        || (signal.kind == .browser && composey.contains { title.lowercased().contains($0) })
    if signal.focusedFormField && inComposeContext {
        if let m = bestMatch([("reply", 4), ("email", 3), ("polish", 2), ("draft", 1)]) {
            add(7, AmbientSuggestion(
                title: "Draft a reply",
                subtitle: "You're writing in \(signal.appName)",
                kind: "skill", targetId: m.id, sfSymbol: "arrowshape.turn.up.left"))
        }
    }

    // ── Rule 4: a project whose keyword appears in the window title / host → surface its wrapp ──
    for p in projects {
        let hits = overlapScore(haystack: contextTokens, keywords: p.keywords)
        // Also count substring matches in title/host for multi-word keywords.
        let substringHits = p.keywords.filter { kw in
            let k = kw.lowercased()
            return title.lowercased().contains(k) || (host?.contains(k) ?? false)
        }.count
        let projScore = hits + substringHits
        guard projScore > 0 else { continue }

        // Pick the catalog wrapp whose tagline best overlaps this project's keywords.
        let best = catalog
            .map { c -> (Int, (id: String, tagline: String, category: String)) in
                (overlapScore(haystack: tokenize(c.tagline + " " + c.category), keywords: p.keywords), c)
            }
            .filter { $0.0 > 0 }
            .max { $0.0 < $1.0 }
        if let (_, c) = best {
            add(3 + projScore, AmbientSuggestion(
                title: "Open \(c.id)",
                subtitle: "Relevant to “\(p.name)”",
                kind: "wrapp", targetId: c.id, sfSymbol: "sparkles"))
        }
    }

    // Rank by score desc, keep top 3.
    let out = scored
        .sorted { $0.0 > $1.0 }
        .prefix(3)
        .map { $0.1 }
    // Final honesty guard: never emit an id that isn't in the catalog.
    return out.filter { has($0.targetId) }
}
