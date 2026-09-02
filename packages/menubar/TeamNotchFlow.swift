// TeamNotchFlow.swift — Team Mode (multiplayer) setup entirely at the NOTCH, not the panel.
// Founder direction ([[relay-notch-consent-surface]]): everything → the notch. This drives the whole
// enable → host/join → invite/paste-code → manage flow as a sequence of notch cards, using the same
// guide protocol every other card uses (write ~/.relay/guide-run.json, read the collision-proof
// ~/.relay/guide-results/<runId>.json). The heavy daemon calls (setEnabled/host/join/leave) are the
// controller's existing methods, injected as closures. The only non-notch step is the OS folder picker
// the host needs (team.pickFolder raises the native dialog) — a real system pick, not config.
import AppKit

@MainActor
final class TeamNotchFlow {
    static let shared = TeamNotchFlow()

    // ── injected by the controller (reuses its existing team methods) ──
    var setEnabled: ((Bool) -> Void)?              // team.setEnabled { on }
    var host: ((String) -> Void)?                  // team name → native folder pick → team.host
    var join: ((String) -> Void)?                  // invite code → team.join { code }
    var leave: (() -> Void)?                        // team.leave
    var currentTeam: (() -> TeamState?)?           // read the live team state (nil ⇒ off / no team)
    var copyToPasteboard: ((String) -> Void)?      // put the invite code on the clipboard

    private var pollTimer: Timer?
    private var awaitingRunId: String?
    private var onResult: ((_ pick: String?, _ note: String?, _ aborted: Bool) -> Void)?

    private func rel(_ n: String) -> String { (NSHomeDirectory() as NSString).appendingPathComponent(".relay/" + n) }

    // ── entry point: called from the panel/menu "Team Mode" affordance ──
    func start() {
        if let t = currentTeam?(), t.role == "host" || t.role == "member" {
            showManage(t)
        } else {
            showEntry()
        }
    }

    // ── 1 · entry: host or join (enabling happens implicitly on the chosen path) ──
    private func showEntry() {
        ask(title: "🛰 Team Mode",
            text: "Work a shared folder with teammates — each on their own Claude. Host a team or join one?",
            say: "Team Mode. Do you want to host a team, or join one with a code?",
            options: [
                ["id": "host", "label": "Host a team", "detail": "share a folder, get an invite code", "recommended": true],
                ["id": "join", "label": "Join a team", "detail": "paste a teammate's code"],
                ["id": "cancel", "label": "Not now"],
            ]) { [weak self] pick, note, aborted in
            guard let self, !aborted else { return }
            let n = (note ?? "").lowercased()
            if pick == "host" || n.contains("host") { self.hostName() }
            else if pick == "join" || n.contains("join") { self.joinCode() }
        }
    }

    // ── HOST · 2a: name the team (⌥↓ to type, or take the default) ──
    private func hostName() {
        ask(title: "Name your team",
            text: "What's the team called? ⌥↓ to type a name, or use the default.",
            say: "Name your team, or just go with the default.",
            options: [
                ["id": "default", "label": "Use \u{201C}My team\u{201D}", "recommended": true],
                ["id": "cancel", "label": "Cancel"],
            ]) { [weak self] pick, note, aborted in
            guard let self, !aborted, pick != "cancel" else { return }
            let name = (note?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? "My team"
            // enable, then host (host() runs the native folder pick + team.host)
            self.setEnabled?(true)
            self.host?(name)
            // team.host is fire-and-forget → the invite lands in team.json; poll for it, then show it.
            self.showInviteWhenReady()
        }
    }

    // ── HOST · 2b: once the daemon has hosted, surface the invite (copied) ──
    private func showInviteWhenReady(_ tries: Int = 0) {
        if let t = currentTeam?(), t.role == "host", let invite = t.invite, !invite.isEmpty {
            copyToPasteboard?(invite)
            ask(title: "Team is live — invite sent to your clipboard",
                text: "\(t.teamName) is up. The invite code is copied — send it to whoever you want in. It carries the shared secret, so share it privately.",
                say: "Your team is live and the invite code is on your clipboard. Send it to your teammates.",
                options: [
                    ["id": "copy", "label": "Copy the invite again", "recommended": true],
                    ["id": "done", "label": "Done"],
                ]) { [weak self] pick, _, _ in
                if pick == "copy" { self?.copyToPasteboard?(invite) }
            }
            return
        }
        guard tries < 40 else {   // ~12s: the folder pick may still be open, or hosting failed
            ask(title: "Couldn't confirm the team", text: "Hosting didn't complete — the folder pick may have been cancelled. Try again from Team Mode.", say: "Hosting didn't finish. Try again when you're ready.",
                options: [["id": "ok", "label": "OK", "recommended": true]]) { _,_,_ in }
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.showInviteWhenReady(tries + 1) }
    }

    // ── JOIN · paste the code (⌥↓) ──
    private func joinCode() {
        ask(title: "Join a team",
            text: "Paste your teammate's invite code — press ⌥↓ and paste (⌘V), ↵ to confirm.",
            say: "Paste the invite code your teammate sent you.",
            options: [
                ["id": "cancel", "label": "Cancel"],
            ]) { [weak self] _, note, aborted in
            guard let self, !aborted else { return }
            let code = (note ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !code.isEmpty else { return }
            self.setEnabled?(true)
            self.join?(code)
            self.showJoinResultWhenReady()
        }
    }

    private func showJoinResultWhenReady(_ tries: Int = 0) {
        if let t = currentTeam?(), t.role == "member" {
            ask(title: "You're in — \(t.teamName)", text: "Joined \(t.teamName). You're sharing the folder now; teammates show up live over any shared wrapp.", say: "You're in. Welcome to the team.",
                options: [["id": "done", "label": "Nice", "recommended": true]]) { _,_,_ in }
            return
        }
        guard tries < 30 else {
            ask(title: "Couldn't join", text: "That code didn't connect — it may be wrong, or the host is offline. Double-check and try again.", say: "That code didn't work. Check it and try again.",
                options: [["id": "ok", "label": "OK", "recommended": true]]) { _,_,_ in }
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.showJoinResultWhenReady(tries + 1) }
    }

    // ── MANAGE · already in a team: who's in, copy invite (host), leave ──
    private func showManage(_ t: TeamState) {
        let names = t.members.map { $0.name + ($0.online ? "" : " (offline)") }.joined(separator: ", ")
        var opts: [[String: Any]] = []
        if t.role == "host", let invite = t.invite, !invite.isEmpty {
            opts.append(["id": "invite", "label": "Copy invite code", "detail": "add someone", "recommended": true])
        }
        opts.append(["id": "leave", "label": "Leave the team", "detail": "stops sharing"])
        opts.append(["id": "close", "label": "Close"])
        ask(title: "🛰 \(t.teamName)\(t.connected ? "" : " · connecting…")",
            text: "In the team: \(names.isEmpty ? "just you" : names).",
            say: "You're in \(t.teamName).",
            options: opts) { [weak self] pick, _, _ in
            guard let self else { return }
            if pick == "invite", let invite = t.invite { self.copyToPasteboard?(invite) }
            else if pick == "leave" { self.leave?() }
        }
    }

    // ── the notch card primitive: raise one ask, poll its collision-proof result, call back ──
    private func ask(title: String, text: String, say: String, options: [[String: Any]],
                     completion: @escaping (_ pick: String?, _ note: String?, _ aborted: Bool) -> Void) {
        let rid = "team-\(Int(Date().timeIntervalSince1970 * 1000))-\(Int.random(in: 0..<100000))"
        try? FileManager.default.removeItem(atPath: rel("guide-results/\(rid).json"))
        let card: [String: Any] = [
            "mode": "teach", "title": title, "runId": rid,
            "source": "Switchboard · Team", "project": "Team Mode",
            "steps": [["id": "s", "text": text, "say": say, "placement": "notch", "options": options]],
        ]
        writeJSONAtomic(card, to: rel("guide-run.json"))
        awaitingRunId = rid
        onResult = completion
        startPolling()
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.pollResult() }
        }
    }

    private func pollResult() {
        guard let rid = awaitingRunId else { pollTimer?.invalidate(); pollTimer = nil; return }
        let path = rel("guide-results/\(rid).json")
        guard FileManager.default.fileExists(atPath: path),
              let data = FileManager.default.contents(atPath: path),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        pollTimer?.invalidate(); pollTimer = nil
        awaitingRunId = nil
        let cb = onResult; onResult = nil
        let outcome = obj["outcome"] as? String ?? "completed"
        let results = obj["results"] as? [[String: Any]] ?? []
        let first = results.first
        let pick = first?["chosenOption"] as? String
        let note = (first?["feedback"] as? [String: Any])?["note"] as? String
        cb?(pick, note, outcome == "aborted")
    }

    private func writeJSONAtomic(_ obj: [String: Any], to path: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        let tmp = path + ".team.tmp"
        try? data.write(to: URL(fileURLWithPath: tmp))
        try? FileManager.default.removeItem(atPath: path)
        try? FileManager.default.moveItem(atPath: tmp, toPath: path)
    }
}
