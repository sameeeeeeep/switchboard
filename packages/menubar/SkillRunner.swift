// SkillRunner — the HEADLESS half of "wrapp = skill + workflow + UI" (docs/GOD-HANDS.md).
//
// A *basic skill* (Gist, Unjargon, Rephrase, Polish, Extract…) is just a prompt: text in, text out,
// nothing to step through and nothing to steer beyond a nudge. It doesn't need a page or a hosted
// webview — it just needs one model call on the user's own Claude. This runs that call natively and
// hands the text back so the caller can drop it straight into a notch widget (drag-out).
//
// The plumbing is the same daemon wire HtmlCapability + the drive surface use: GodDaemonBridge →
// claude_complete, tagged with a granted origin, gated + audited by the daemon like any other run.
// A *wrapp* with a real workflow/UI still drives its page (GodWebWindow); this is only for the
// prompt-shaped skills the user shouldn't have to open a page for.
import AppKit

@MainActor final class SkillRunner: NSObject {
    static let shared = SkillRunner()
    private override init() { super.init() }

    private let origin = "http://localhost:5188"   // a granted origin, so the daemon routes via an existing grant
    private let timeout: TimeInterval = 90

    private struct Call {
        let bridge: GodDaemonBridge
        let completion: (Result<String, Error>) -> Void
    }
    private var calls: [UUID: Call] = [:]

    /// Run a skill headlessly: `skillPrompt` is the skill body (its know-how), `input` is what to apply
    /// it to. Returns the model's text. No page, no webview — one gated call on the user's Claude.
    func run(skillPrompt: String, input: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard let raw = try? String(contentsOfFile: TOKEN_FILE, encoding: .utf8),
              case let token = raw.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            completion(.failure(HtmlCapabilityError("~/.relay/pairing-token is missing — is the daemon set up?")))
            return
        }
        // The skill body is the SYSTEM (its standing know-how); the user's text is the turn's prompt.
        let system = skillPrompt + "\n\nApply the skill above to the user's text. Reply with only the result — "
            + "no preamble, no restating the task."
        let id = UUID()
        let bridge = GodDaemonBridge(token: token)
        calls[id] = Call(bridge: bridge, completion: completion)
        bridge.request(origin: origin, method: "claude_complete",
                       params: ["system": system, "prompt": String(input.prefix(8000)), "maxTokens": 1200]) { [weak self] result, err in
            Task { @MainActor in self?.responded(id, result: result, err: err) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.timedOut(id) }
    }

    private func responded(_ id: UUID, result: Any?, err: [String: Any]?) {
        guard let call = calls.removeValue(forKey: id) else { return }   // already timed out
        call.bridge.close()
        if let err {
            call.completion(.failure(HtmlCapabilityError((err["message"] as? String) ?? "daemon error")))
            return
        }
        guard let dict = result as? [String: Any], let text = (dict["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            call.completion(.failure(HtmlCapabilityError("Your Claude returned no text.")))
            return
        }
        call.completion(.success(text))
    }

    private func timedOut(_ id: UUID) {
        guard let call = calls.removeValue(forKey: id) else { return }
        call.bridge.close()
        call.completion(.failure(HtmlCapabilityError("Timed out after \(Int(timeout))s — is the daemon running and signed in?")))
    }
}
