// CONSENT ROUTING — pure helpers for the connect-grant card. No AppKit, no app types, so it compiles and
// tests headless exactly like LauncherRouting:
//     swiftc -parse-as-library ConsentRouting.swift ConsentRouting.test.swift -o /tmp/ct && /tmp/ct
import Foundation

enum SBConsent {
    struct Provider { let id: String; let label: String; let signedIn: Bool; let online: Bool; let models: [String] }

    /// DUAL-GRANT BY DEFAULT (codex-parity slice 3a, 2026-09-07). A wrapp asks for Claude names ("sonnet");
    /// when another provider is signed in, pre-select that provider's first (catalog-default) model too, so a
    /// new app can run on either provider from day one. This only changes what the card PRE-SELECTS — the
    /// user can untick any pill, nothing is granted silently, and only models in `available` (the user's
    /// enabled set) are ever chosen. Local runners (ollama) are never pre-selected: they can't run tools.
    static func preselect(requested: [String], available: [String], providers: [Provider]) -> [String] {
        var out = requested.filter { available.contains($0) }
        for p in providers where p.signedIn && p.online && p.id != "ollama" {
            if out.contains(where: { p.models.contains($0) }) { continue }          // provider already represented
            if let m = p.models.first(where: { available.contains($0) }) { out.append(m) }
        }
        if out.isEmpty, let first = available.first { out = [first] }
        return out
    }

    /// The card's pills grouped by provider (label → models ∩ available, in the provider's own order);
    /// anything no provider claims lands under "OTHER". Lets a founder read "Claude Code: …  Codex: …"
    /// instead of one flat list of ids.
    static func groups(available: [String], providers: [Provider]) -> [(label: String, models: [String])] {
        var seen = Set<String>(); var out: [(label: String, models: [String])] = []
        for p in providers {
            let ms = p.models.filter { available.contains($0) && !seen.contains($0) }
            if ms.isEmpty { continue }
            ms.forEach { seen.insert($0) }
            out.append((label: p.label, models: ms))
        }
        let rest = available.filter { !seen.contains($0) }
        if !rest.isEmpty { out.append((label: "OTHER", models: rest)) }
        return out
    }
}
