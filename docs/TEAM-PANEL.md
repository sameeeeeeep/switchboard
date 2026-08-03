# TEAM-PANEL.md — bringing Team Mode into the Mac app

**Status:** design spec, decision-ready. Written 2026-08-03 as the Mac-app companion to
[`TEAMMODE.md`](./TEAMMODE.md) (the model — what syncs, sealed frames, LWW, the non-negotiables) and
grounded in `packages/sidekick/src/team/engine.ts` (the `TeamEngine` + `TeamStatus`/`TeamMember` types),
`packages/sidekick/src/server.ts` (`handleControl`, the `team.*` control cases), `packages/sidekick/src/index.ts`
(the `TeamEngine` wiring + the `status.json` mirror pattern), and `packages/menubar/RelayMenuBar.swift`
(the `Panel` view, `disclosure(...)`, `connectionsSection`, `ConsentClient.control`, the design tokens).
The draft view is `packages/menubar/TeamSection.swift`; the exact wiring is
`scratchpad/AGENT-TEAM-integration.md`. Diagrams and tables carry the spec; prose only names what a
picture can't.

> **The gap, in one line:** the daemon already *has* the whole team engine and every control verb the
> panel needs; the Mac app has **no team UI and no way to read team state back**. Everything below closes
> exactly that — nothing in the engine or protocol has to change to create/join/leave and see who's online,
> except one small mirror file so the app can *read* status the way it reads everything else.

---

## 1. What already exists (grounded)

### 1.1 The engine — complete

`TeamEngine` (`engine.ts`) is the full model from `TEAMMODE.md`: host/join/leave, presence, folder sync,
sealed wire, git backing, relay, cloud backup. The two types the panel renders are already defined:

| Type | File · lines | Fields the panel uses |
| --- | --- | --- |
| `TeamMember` | `engine.ts:54-60` | `deviceId`, `name`, `online`, `lastSeen`, `you?` |
| `TeamStatus` | `engine.ts:62-81` | `enabled`, `role` (`"off"\|"host"\|"member"`), `teamName`, `folder`, `invite?` (host-only), `connected?`, `members[]`, `error?`, `relay?`, `git?`, `cloud?` |

`status()` (`engine.ts:390-429`) assembles a live `TeamStatus` on demand — including the host's own
`you` member and each peer's `online` flag (`now - lastSeen < OFFLINE_AFTER_MS`, `engine.ts:397`).

### 1.2 The control surface — the menubar WS bridge, already wired for `team.*`

The menubar drives the daemon over the **same authenticated WebSocket** the extension uses, tagged
`surface:"menubar"` at auth (`server.ts:155`). Frames are `{type:"control", id, action, args}`
(`server.ts:175-178` → `handleControl(action, args)`). Every team verb is already a case in that switch:

| Control action | `server.ts` | Calls | Returns |
| --- | --- | --- | --- |
| `team.status` | 703 | `team.status()` | `{ok, status}` |
| `team.setEnabled` | 705 | `team.setEnabled(on)` | `{ok, status}` |
| `team.pickFolder` | 708 | native folder dialog | `{ok, path}` |
| `team.host` | 718 | `team.host({folder, teamName, lan, port, relay})` | `{ok, invite, status}` |
| `team.join` | 734 | `team.join(code, {folder})` | `{ok, status}` |
| `team.leave` | 743 | `team.leave()` | `{ok, status}` |
| `team.setEntitlement` / `team.restore` | 745 / 753 | Pro cloud paths | `{ok, status}` |

The app already has the transport: `ConsentClient.control(action, args)` (`RelayMenuBar.swift:2698`) sends
exactly this frame over the authed socket. **So create / join / leave are reachable from the app today** —
the actions exist, the pipe exists.

### 1.3 The Mac app — confirmed: zero team hooks

`grep -in team packages/menubar/RelayMenuBar.swift` returns only an unrelated string literal. There is no
team section, no `team.*` control call, no reader. This is a greenfield section.

---

## 2. The one real gap — the app can't *read* team status

Every panel surface reads daemon state from a `~/.relay/*.json` **mirror file**, not from WS replies:

- `status.json` — connectors + tool counts + backends, written on boot and every 30s (`index.ts:77-92`).
- `grants.json`, `contexts.json`, `app-tokens.json`, `profile.json`, `models.json` — each read by `Model.refreshFiles()` (`RelayMenuBar.swift:682-701`).

Team status has **no such file**. It exists only as the *reply* to a `team.status` control call — and the
app's `control(...)` helper is deliberately fire-and-forget: it never parses `control_result`
(`RelayMenuBar.swift:2696-2698`, comment: *"The panel re-reads its files right after, so we don't need the
reply."*). So the app can *fire* team actions but cannot *see* the resulting team, its members, the online
dots, or the host invite code.

**Resolution (smallest, most consistent):** have the daemon write `~/.relay/team.json = team.status()` on
boot and on every membership/presence change, exactly like `status.json`. Then the app reads it with a
plain `readTeam()` in `refreshFiles()` — no new WS-reply plumbing, and it rides the existing 1.6s
panel-visible poll (`poll()` → `if panel.isVisible { model.refreshFiles() }`, `RelayMenuBar.swift:5539+`),
so **online dots update live while the panel is open**. The exact ~15-line daemon change is in §6 and the
brief.

```
 create/join/leave  ──control("team.host"/… )──►  daemon  ── team.status() ──►  ~/.relay/team.json
        (app, exists today)                     (engine, exists)          (NEW mirror — the only gap)
                                                                                    │
   Panel Team section  ◄── model.team (readTeam) ◄── refreshFiles() ◄── 1.6s poll ─┘  (live while open)
```

---

## 3. The Team section — states

The section lives in `settingsView` as one `disclosure("team", "TEAM", summary:)` row (same accordion as
`CONNECTIONS`). Its inner content is `TeamSection` (draft: `TeamSection.swift`). Three top-level states,
switched on `enabled` (the marker file) then `team == nil`:

| State | Condition | What the user sees |
| --- | --- | --- |
| **Off** | `enabled == false` | One-sentence pitch ("one shared folder, you keep your own Claude") + a lime **Turn on Team Mode** button (`team.setEnabled true`). |
| **On, no team** | `enabled`, `team == nil` | A Create/Join segmented toggle. Create: name field → **Pick a folder & host**. Join: paste-code field → **Join team**. |
| **In a team** | `team != nil` | Header (name + connected dot + host/member badge), **N on the board**, member list with online dots, the shared-folder card, host **Copy invite code**, and **Leave/Disband** + **Turn off**. |

### 3.1 In-team layout (the meat)

```
 ● Design                                    [you host]     ← connected dot (ok/danger) + role badge
 2 ON THE BOARD                                             ← kicker, = onlineCount
   ● Sameep   you                             online        ← stable per-member colour, ok text
   ● Maya                                     online
   ○ Dev                                      offline        ← grey dot, inkDim name

 ┌ 📁 Shared folder ─────────────── same network ┐          ← click → Finder; relay==nil ⇒ "same network"
 │    ~/Switchboard Teams/Design                 │
 └───────────────────────────────────────────────┘
 ┌ ⧉ Copy invite code ──────── share like a password ┐      ← HOST ONLY; carries the secret → copy, never shown
 └────────────────────────────────────────────────────┘
 ───────────────────────────────────────────────────
 [Disband]                                      Turn off    ← leave (danger) · setEnabled(false) (keeps config)
```

### 3.2 Design tokens (match `connectionsSection` / `regionSection` exactly)

All from the extensions already in `RelayMenuBar.swift`: `Color.ink/inkDim/inkFaint/lime/edge/raised/panel/ok/danger/localInk`, `Font.hanken(_, _)`, `Font.splMono(_)`, `Text.kicker()`. Cards are
`RoundedRectangle(cornerRadius: 9).fill(Color.panel/raised).overlay(stroke Color.edge)`; the primary CTA
is `fill(Color.lime)` with `.foregroundColor(.page)`; destructive is a `Color.danger.opacity(0.4)` hairline
button, verbatim from `connectionRow`'s "Remove" (`RelayMenuBar.swift:1536`).

---

## 4. Presence & the notch — "N on the board"

Two presence surfaces, both fed by the same `team.json`:

1. **In-panel (this section):** `onlineCount` as the "N on the board" kicker, and per-member online dots.
   A member gets a **stable colour keyed on `deviceId`** (so "green is Maya" is learnable — the panel
   equivalent of `TEAMMODE.md`'s "stable per-member colour, grey when offline"); offline ⇒ `Color.inkFaint`.

2. **Notch idea (future, cheap):** when `teamEnabled && team != nil && onlineCount > 1`, the idle notch pill
   can carry a tiny **`●● N`** cluster (the stable member dots), so you know teammates are live without
   opening the panel — the "N on the board" glance. This reads the same `model.team`; no new daemon data.
   Deliberately out of scope for the first slice (the panel section is the deliverable), noted so the data
   shape (`members[].online` + stable colour) is designed to support it now.

---

## 5. All states & edge cases

| # | Situation | Source (grounded) | Panel behaviour |
| --- | --- | --- | --- |
| E1 | Mode off | marker absent (`engine.ts:186-189`) | Off state; no network exists to show. |
| E2 | On, never hosted/joined | `state == null` ⇒ `role:"off"` (`engine.ts:392`) | No-team create/join form. |
| E3 | Host, alone | `members = [you]` (`engine.ts:395-397`) | "1 on the board", just you; invite ready to copy. |
| E4 | Host, listener failed (port in use) | `hostError` → `status.error` (`engine.ts:411`, set 589-596) | Red banner with the message; still shows the team + a way to leave/retry. |
| E5 | Member, connected | `hostPresence` mapped (`engine.ts:398-400`) | Full roster with live dots; connected dot = ok. |
| E6 | Member, host went offline | reconnect loop, `clientConnected=false` (`engine.ts:796-817`) | Connected dot = danger; members go grey as `lastSeen` ages out; roster persists. |
| E7 | Member, join failed | `join()` throws, team wiped (`engine.ts:302-312`) | Stays on the join form; surface the thrown reason as an inline error (from the control reply — see brief §note). |
| E8 | Relay-refused (Pro seats/expired) | `memberError` via `gateMessage` (`engine.ts:804`, 1061) | Red banner with the plan message; not a silent "reconnecting…". |
| E9 | Cross-network vs LAN | `relay` present/absent (`engine.ts:427`) | Folder card badge flips "cross-network" / "same network". |
| E10 | Invite is a bearer secret | `TEAMMODE.md` §Topology | **Never render the code inline** — copy-to-clipboard only, labelled "share like a password". The draft does this. |
| E11 | Leave as host | orphans members (`engine.ts:378-388`, `TEAMMODE.md`) | Button reads **Disband**; copy warns teammates lose the connection. |
| E12 | Turn off (not leave) | `setEnabled(false)` keeps config (`engine.ts:191-205`) | Separate **Turn off** affordance; distinct from Leave. Flipping back on resumes the same team. |
| E13 | Old daemon (no `team.*`) | `handleControl` default: `unknown control action` (`server.ts:810`); no `team.json` written | `model.team == nil` and status probe absent ⇒ hide the section (see brief for the version guard). |

---

## 6. Honest ledger — exists vs must-add

### Exists (no work)
- `TeamEngine` host/join/leave/status/presence/folder-sync — `engine.ts`.
- All `team.*` control cases — `server.ts:703-762`.
- The menubar→daemon control transport — `ConsentClient.control` (`RelayMenuBar.swift:2698`).
- The native folder picker behind `team.pickFolder` (`server.ts:708`).
- The live-refresh loop the section rides — `poll()` → `refreshFiles()` while visible.

### Must add — app (this initiative)
- `packages/menubar/TeamSection.swift` — the view (drafted).
- `struct Panel` closures: `onSetTeamEnabled`, `onCreateTeam`, `onJoinTeam`, `onLeaveTeam`, `onOpenTeamFolder`, `onCopyInvite`; wired at the `Panel(...)` site (`RelayMenuBar.swift:3304`).
- `RelayController` methods behind those closures, each a thin `consent?.control("team.…", …)` (patterns: `revokeOrigin` `RelayMenuBar.swift:3196`, `setUserName` `3210`).
- `Model.team: TeamState?` + `readTeam()` in `refreshFiles()` (mirrors `readApps()`).
- One `disclosure("team", "TEAM", …)` row in `settingsView` after `connections` (`RelayMenuBar.swift:1196`).

### Must add — daemon (the only engine-side change, ~15 lines, described not built)
- **`~/.relay/team.json` mirror.** In `index.ts`, add a `writeTeam()` that does
  `writeFileSync(join(config.stateDir, "team.json"), JSON.stringify(team.status()), {mode:0o600})`, call it
  on boot next to `writeStatus()` (`index.ts:91`), and fire it from the engine's `onTeamChanged` callback
  (`index.ts:56`) so presence/membership changes flush immediately. This is the exact `status.json` pattern
  and touches nothing in the engine's logic — purely a display mirror. 0600 like every other `~/.relay` file
  (the invite secret rides inside `status().invite`, so the file must stay owner-only, which it already is).
- Optional nicety: gate the invite in the mirror to host role only — `status()` already does this
  (`engine.ts:407`), so no extra work.

---

## 7. The smallest working slice

1. **Daemon:** add `writeTeam()` + hook it to `onTeamChanged` (§6, ~15 lines).
2. **App state:** `Model.team` + `readTeam()`; call in `refreshFiles()`.
3. **App view:** land `TeamSection.swift`; add the `disclosure("team", …)` row.
4. **App actions:** 6 closures → `RelayController` methods calling the existing `team.setEnabled/pickFolder+host/join/leave` control actions.

That yields the target end-to-end: **turn on Team Mode → create or join a team → see members and who's
online, the shared folder, and (host) the invite to copy.** Everything past that — git opt-in, relay/cloud
Pro, the notch presence cluster — is additive on the same `team.json` shape and the same control verbs.
