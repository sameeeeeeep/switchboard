// Headless assertions for the consent pre-selection. No app, no daemon.
import Foundation
private var failures = 0, checks = 0
private func expect(_ ok: Bool, _ what: String) { checks += 1; if ok { print("  ✓ \(what)") } else { failures += 1; print("  ✗ \(what)") } }
@main struct ConsentTests {
    static func main() {
        typealias P = SBConsent.Provider
        let claude = P(id: "claude-code", label: "Claude Code", signedIn: true, online: true, models: ["sonnet", "opus", "haiku"])
        let codex  = P(id: "codex", label: "Codex", signedIn: true, online: true, models: ["gpt-5.5", "gpt-5.4"])
        let ollama = P(id: "ollama", label: "ollama", signedIn: true, online: true, models: ["llama3.2:1b"])
        let avail = ["sonnet", "opus", "haiku", "gpt-5.5", "gpt-5.4", "llama3.2:1b"]
        print("\n── dual-grant pre-selection ─────────────────────────────")
        expect(SBConsent.preselect(requested: ["sonnet"], available: avail, providers: [claude, codex, ollama]) == ["sonnet", "gpt-5.5"],
               "\"sonnet\" + Codex signed in → sonnet AND Codex's default pre-selected (never ollama)")
        expect(SBConsent.preselect(requested: ["sonnet"], available: avail, providers: [claude, P(id: "codex", label: "Codex", signedIn: false, online: true, models: ["gpt-5.5"])]) == ["sonnet"],
               "Codex signed OUT → nothing added")
        expect(SBConsent.preselect(requested: ["sonnet"], available: avail, providers: [claude, P(id: "codex", label: "Codex", signedIn: true, online: false, models: ["gpt-5.5"])]) == ["sonnet"],
               "Codex offline → nothing added")
        expect(SBConsent.preselect(requested: ["sonnet", "gpt-5.4"], available: avail, providers: [claude, codex]) == ["sonnet", "gpt-5.4"],
               "app already asked for a Codex model → not duplicated")
        expect(SBConsent.preselect(requested: [], available: avail, providers: [claude, codex]) == ["sonnet", "gpt-5.5"],
               "no request → each signed-in provider's default")
        expect(SBConsent.preselect(requested: ["sonnet"], available: ["sonnet", "opus"], providers: [claude, codex]) == ["sonnet"],
               "Codex models disabled in Settings (not available) → never pre-selected")
        expect(SBConsent.preselect(requested: ["nope"], available: ["opus"], providers: []) == ["opus"],
               "unavailable request + no providers → first available (old behaviour kept)")
        print("\n── provider grouping ────────────────────────────────────")
        let g = SBConsent.groups(available: avail + ["mystery"], providers: [claude, codex, ollama])
        expect(g.map { $0.label } == ["Claude Code", "Codex", "ollama", "OTHER"], "groups in provider order + OTHER")
        expect(g[0].models == ["sonnet", "opus", "haiku"] && g[1].models == ["gpt-5.5", "gpt-5.4"] && g[3].models == ["mystery"], "models ∩ available per group")
        print("\n\(checks - failures)/\(checks) passed" + (failures == 0 ? " ✓\n" : "  — \(failures) FAILED\n"))
        exit(failures == 0 ? 0 : 1)
    }
}
