// TeamSection.swift — DRAFT of the panel's Team Mode section (multiplayer: N people, N Claudes, one shared folder).
//
// This is a self-contained SwiftUI view drafted to match RelayMenuBar.swift's design language exactly
// (the same Color.* / Font.hanken / Font.splMono / Text.kicker() extensions, the same card/pill/hairline
// grammar as connectionsSection / regionSection). It is NOT wired into Panel yet — that's the founder's
// job (see AGENT-TEAM-integration.md). Drop this file into the packages/menubar target; it compiles
// alongside RelayMenuBar.swift and reuses its extensions (Color.ink/lime/edge/raised/panel/ok/danger/
// inkDim/inkFaint, Font.hanken/splMono/brico, Text.kicker()). No new dependencies.
//
// ───────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THE FOUNDER MUST THREAD (mirrors how Panel threads onFixSenses/onStore — see RelayMenuBar.swift):
//
//   1. STATE — read from a NEW ~/.relay/team.json mirror file (smallest daemon change; see brief).
//      Add to `Model`:   @Published var team: TeamState? = nil
//      Add to refreshFiles():  team = readTeam()          // returns nil when role == "off"
//      The 1.6s panel poll already calls refreshFiles() while visible, so presence/online-dots stay live.
//
//   2. HEADER — insert one disclosure row in settingsView (after the "connections" row, ~line 1196):
//        disclosure("team", "TEAM", summary: teamSummary) { TeamSection(
//            team: model.team, enabled: model.teamEnabled,
//            onSetEnabled: onSetTeamEnabled, onCreate: onCreateTeam,
//            onJoin: onJoinTeam, onLeave: onLeaveTeam,
//            onOpenFolder: onOpenTeamFolder, onCopyInvite: onCopyInvite) }
//
//   3. CLOSURES — add these six `let` properties to `struct Panel` and wire them at the Panel(...) call
//      site (~line 3304) to RelayController methods that call `consent?.control("team.…", …)`:
//        onSetTeamEnabled: (Bool) -> Void        // team.setEnabled  { on }
//        onCreateTeam:     (String) -> Void      // team.pickFolder → team.host { folder, teamName }
//        onJoinTeam:       (String) -> Void      // team.join        { code }
//        onLeaveTeam:      () -> Void            // team.leave
//        onOpenTeamFolder: (String) -> Void      // NSWorkspace open the shared folder path
//        onCopyInvite:     (String) -> Void      // copy the host invite code to the pasteboard
// ───────────────────────────────────────────────────────────────────────────────────────────────────

import SwiftUI
import AppKit

// MARK: - Model (mirrors packages/sidekick/src/team/engine.ts → TeamStatus / TeamMember)
// Decoded from ~/.relay/team.json. Keep field names in sync with TeamStatus so `readTeam()` is a plain
// JSONDecoder pass. `role == "off"` (or a missing file) ⇒ pass `team: nil` to this view.

struct TeamMember: Identifiable, Equatable {
    var deviceId: String          // stable identity → stable presence colour
    var name: String
    var online: Bool
    var you: Bool = false
    var id: String { deviceId }
}

struct TeamState: Equatable {
    var role: String              // "host" | "member"
    var teamName: String
    var folder: String
    var members: [TeamMember]
    var connected: Bool           // host: listener up · member: dialed in
    var invite: String? = nil     // host-only — what a teammate pastes to join
    var relay: String? = nil      // set ⇒ cross-network (cloud relay); nil ⇒ same-LAN
    var error: String? = nil      // e.g. "port in use", a relay refusal message

    var onlineCount: Int { members.filter { $0.online }.count }
    var isHost: Bool { role == "host" }
}

// MARK: - The section

struct TeamSection: View {
    let team: TeamState?
    let enabled: Bool                      // the mode switch (~/.relay/team/enabled marker, mirrored)

    let onSetEnabled: (Bool) -> Void
    let onCreate: (String) -> Void         // team name → daemon picks folder natively, then hosts
    let onJoin: (String) -> Void           // invite code
    let onLeave: () -> Void
    let onOpenFolder: (String) -> Void
    let onCopyInvite: (String) -> Void

    // Local-only form state (nothing here is persisted; the daemon owns the truth).
    @State private var mode: FormMode = .create
    @State private var nameDraft = ""
    @State private var codeDraft = ""
    @State private var justCopied = false

    private enum FormMode { case create, join }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !enabled {
                offState
            } else if let t = team {
                inTeamState(t)
            } else {
                noTeamState
            }
        }
    }

    // ── OFF: the mode is a marker file; nothing runs until the user flips it. ──────────────────────
    private var offState: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Work in one shared folder with teammates — each of you keeps your own Claude and your own machine. What syncs is files, nothing else.")
                .font(.hanken(11)).foregroundColor(.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { onSetEnabled(true) }) {
                Text("Turn on Team Mode")
                    .font(.hanken(12, .semibold)).foregroundColor(.page)
                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.lime))
            }.buttonStyle(.plain)
        }
    }

    // ── ON, no team yet: create OR join. ──────────────────────────────────────────────────────────
    private var noTeamState: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Segmented create/join toggle — two pills, exactly one lit.
            HStack(spacing: 8) {
                segPill("Create", .create)
                segPill("Join", .join)
                Spacer(minLength: 0)
            }

            if mode == .create {
                VStack(alignment: .leading, spacing: 8) {
                    Text("NAME YOUR TEAM").kicker()
                    TextField("e.g. Design", text: $nameDraft)
                        .textFieldStyle(.plain).font(.hanken(12.5)).foregroundColor(.ink)
                        .padding(.horizontal, 11).padding(.vertical, 9)
                        .background(RoundedRectangle(cornerRadius: 9).fill(Color.raised)
                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1)))
                        .onSubmit(create)
                    Text("You'll pick the folder to share next — your machine hosts, teammates join with a code you send them.")
                        .font(.hanken(10.5)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
                    primaryButton("Pick a folder & host", enabled: !trimmedName.isEmpty, action: create)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("PASTE AN INVITE CODE").kicker()
                    TextField("paste the code a teammate sent you", text: $codeDraft, axis: .vertical)
                        .textFieldStyle(.plain).font(.splMono(10.5)).foregroundColor(.ink)
                        .lineLimit(1...3)
                        .padding(.horizontal, 11).padding(.vertical, 9)
                        .background(RoundedRectangle(cornerRadius: 9).fill(Color.raised)
                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1)))
                        .onSubmit(join)
                    Text("The team's files land in ~/Switchboard Teams/ unless you're asked to pick a spot.")
                        .font(.hanken(10.5)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
                    primaryButton("Join team", enabled: !trimmedCode.isEmpty, action: join)
                }
            }
        }
    }

    // ── ON, in a team: presence + folder + invite (host) + leave. ─────────────────────────────────
    private func inTeamState(_ t: TeamState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header: team name + live "N on the board".
            HStack(spacing: 8) {
                Circle().fill(t.connected ? Color.ok : Color.danger).frame(width: 7, height: 7)
                Text(t.teamName).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
                Spacer(minLength: 6)
                Text(t.isHost ? "you host" : "member")
                    .font(.splMono(9)).foregroundColor(.inkFaint)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(RoundedRectangle(cornerRadius: 6).stroke(Color.edge, lineWidth: 1))
            }

            if let err = t.error, !err.isEmpty {
                bannerRow("exclamationmark.triangle.fill", err, .danger)
            }

            // Members — online dot (stable per-member colour, grey when offline).
            VStack(alignment: .leading, spacing: 0) {
                Text("\(t.onlineCount) on the board").kicker().padding(.bottom, 6)
                ForEach(t.members) { m in memberRow(m) }
            }

            // The shared folder — click opens it in Finder.
            Button(action: { onOpenFolder(t.folder) }) {
                HStack(spacing: 9) {
                    Image(systemName: "folder.fill").font(.system(size: 12)).foregroundColor(.lime).frame(width: 16)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Shared folder").font(.hanken(11.5, .medium)).foregroundColor(.ink)
                        Text(prettyPath(t.folder)).font(.splMono(9)).foregroundColor(.inkFaint).lineLimit(1).truncationMode(.middle)
                    }
                    Spacer(minLength: 6)
                    Text(t.relay == nil ? "same network" : "cross-network")
                        .font(.splMono(8.5)).foregroundColor(.inkFaint)
                }
                .padding(.horizontal, 11).padding(.vertical, 9).contentShape(Rectangle())
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel)
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1)))
            }.buttonStyle(.plain).help("Open the shared folder in Finder")

            // Host: the invite to share. It carries the team secret — copy, don't display raw.
            if t.isHost, let invite = t.invite, !invite.isEmpty {
                Button(action: { onCopyInvite(invite); flashCopied() }) {
                    HStack(spacing: 9) {
                        Image(systemName: justCopied ? "checkmark" : "square.on.square")
                            .font(.system(size: 11, weight: .semibold)).foregroundColor(justCopied ? .ok : .lime)
                        Text(justCopied ? "Invite copied" : "Copy invite code")
                            .font(.hanken(11.5, .semibold)).foregroundColor(justCopied ? .ok : .ink)
                        Spacer(minLength: 6)
                        Text("share like a password").font(.splMono(8.5)).foregroundColor(.inkFaint)
                    }
                    .padding(.horizontal, 11).padding(.vertical, 9).contentShape(Rectangle())
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.lime.opacity(0.07))
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.lime.opacity(0.4), lineWidth: 1)))
                }.buttonStyle(.plain)
            }

            Rectangle().fill(Color.edge).frame(height: 1).opacity(0.6)

            HStack(spacing: 10) {
                Button(action: onLeave) {
                    Text(t.isHost ? "Disband" : "Leave team")
                        .font(.hanken(10.5, .semibold)).foregroundColor(.danger)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(RoundedRectangle(cornerRadius: 7).stroke(Color.danger.opacity(0.4), lineWidth: 1))
                }.buttonStyle(.plain).help(t.isHost ? "Stop hosting — teammates lose the connection" : "Leave and stop syncing")
                Spacer(minLength: 0)
                Button(action: { onSetEnabled(false) }) {
                    Text("Turn off").font(.hanken(10.5)).foregroundColor(.inkDim)
                }.buttonStyle(.plain).help("Pause Team Mode — your team is kept and resumes when you turn it back on")
            }
        }
    }

    // ── rows / bits ───────────────────────────────────────────────────────────────────────────────

    private func memberRow(_ m: TeamMember) -> some View {
        HStack(spacing: 10) {
            Circle().fill(m.online ? presenceColour(m.deviceId) : Color.inkFaint)
                .frame(width: 8, height: 8)
                .overlay(Circle().stroke(Color.page, lineWidth: 1))
            Text(m.name).font(.hanken(12, m.you ? .semibold : .regular)).foregroundColor(m.online ? .ink : .inkDim).lineLimit(1)
            if m.you { Text("you").font(.splMono(8.5)).foregroundColor(.inkFaint) }
            Spacer(minLength: 6)
            Text(m.online ? "online" : "offline").font(.splMono(9)).foregroundColor(m.online ? .ok : .inkFaint)
        }.padding(.vertical, 6)
    }

    private func segPill(_ label: String, _ m: FormMode) -> some View {
        let on = mode == m
        return Button(action: { withAnimation(.easeOut(duration: 0.14)) { mode = m } }) {
            Text(label).font(.hanken(11.5, .semibold)).foregroundColor(on ? .page : .inkDim)
                .padding(.horizontal, 14).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8).fill(on ? Color.lime : Color.raised)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? Color.clear : Color.edge, lineWidth: 1)))
        }.buttonStyle(.plain)
    }

    private func primaryButton(_ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: { if enabled { action() } }) {
            Text(label).font(.hanken(12, .semibold)).foregroundColor(enabled ? .page : .inkFaint)
                .frame(maxWidth: .infinity).padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 9).fill(enabled ? Color.lime : Color.raised)
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(enabled ? Color.clear : Color.edge, lineWidth: 1)))
        }.buttonStyle(.plain).disabled(!enabled)
    }

    private func bannerRow(_ icon: String, _ text: String, _ tint: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).font(.system(size: 11)).foregroundColor(tint).padding(.top, 1)
            Text(text).font(.hanken(10.5)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(tint.opacity(0.08))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint.opacity(0.35), lineWidth: 1)))
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────────────

    private var trimmedName: String { nameDraft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedCode: String { codeDraft.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func create() { guard !trimmedName.isEmpty else { return }; onCreate(trimmedName) }
    private func join()   { guard !trimmedCode.isEmpty else { return }; onJoin(trimmedCode); codeDraft = "" }

    private func flashCopied() {
        justCopied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { justCopied = false }
    }

    /// Collapse the home dir to `~` for a compact folder line.
    private func prettyPath(_ p: String) -> String {
        let home = NSHomeDirectory()
        return p.hasPrefix(home) ? "~" + p.dropFirst(home.count) : p
    }

    /// A stable colour per member (keyed on deviceId) — the same person is always the same dot, so you
    /// learn "green is Maya" at a glance. Palette stays inside the brand (lime + a few accents).
    private func presenceColour(_ key: String) -> Color {
        let palette: [Color] = [.lime, .ok, .localInk,
                                Color(red: 0xF2/255, green: 0xC5/255, blue: 0x50/255),  // amber
                                Color(red: 0xE0/255, green: 0x7A/255, blue: 0xF2/255)]  // orchid
        var h: UInt64 = 1469598103934665603
        for b in key.utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
        return palette[Int(h % UInt64(palette.count))]
    }
}
