# Team Mode — N people, N Claudes, one shared folder

Multiplayer for Switchboard, built so that **nothing existing changes**. Everywhere else,
"multiplayer AI" means N people sharing one backend model on someone else's server. Here it means
the opposite: each member keeps their own Claude, their own grants, their own machine — and the
thing that's shared is a **folder** (the same unit `claude_storage` already binds, the same `.md`
vault dialect Bank/Obsidian already speak). Your teammate's Claude never becomes yours; the
inference side never changes hands. What syncs is files.

## Off by default, additive by construction

- **The mode switch** is a marker file (`<stateDir>/team/enabled`, or `RELAY_TEAM=1` for
  harnesses). Until it's flipped, the `TeamEngine` is an inert object: no listener, no timers, no
  network, no behavior change anywhere.
- **Zero protocol / SDK surface.** Every team verb (`team.status/setEnabled/pickFolder/host/join/
  leave`) is a **control-channel action** — the untyped, panel-only channel `revoke` and
  `selectContext` already use. Pages cannot reach it; `window.claude`, `BYOPMethods`,
  `capabilities().methods` and `BYOP_VERSION` are untouched. An older daemon answers the panel's
  `team.status` with "unknown control action" and the panel simply hides the section.
- **Wrapps go live for free — and only the RIGHT wrapps.** When a teammate's change lands, the
  daemon emits the existing `permissionsChanged` event with a bare `{reason:"storage-changed"}`
  payload — the same event Bank-style wrapps already re-read storage on. The frame is
  **origin-scoped**: it carries the origins whose storage resolves into (or under) the team
  folder — canonicalized paths, live grants only — and the extension routes it exclusively to
  those origins' pages (the same privacy rule that moved streaming deltas off the fan-out).
  Unrelated wrapps neither re-read nor learn that a team even exists; an older extension
  ignores the extra field and degrades to the legacy fan-out. This routing seam is the gate
  every future live-presence surface (cursors, co-streaming) rides through.

## Topology and trust

Star topology: one member **hosts** (their daemon opens a second WebSocket listener — the
extension's loopback socket with its pairing token is untouched), teammates **join** with an
invite code that encodes `{host, port, teamId, secret, name}`.

- **Possession of the invite secret IS membership** — the same trust model as the pairing token.
  The AES-256-GCM team key is HKDF-derived from `(secret, teamId)`; **every frame in both
  directions is sealed**, so the transport can be any dumb pipe and the listener drops anything
  it can't open.
- **The host is silent until you prove membership.** The joiner speaks first with a sealed
  *knock*; a port scanner that connects receives zero bytes and a timeout. Then a mutual
  challenge/response (sealed nonce, echoed sealed) proves both sides hold the key *now*, and
  every frame after the handshake carries an authenticated `nonce:direction:sequence` tag —
  session-bound, direction-bound, strictly ordered — so captured frames can't be replayed or
  reflected.
- **A member's word is bound to its identity.** The host accepts only ops stamped with the
  authenticated connection's own deviceId (no spoofed tiebreak identities), and version clocks
  are ceiling-capped far below float precision, so no single member can saturate the ordering
  and pin files forever. Handshakes-in-flight and member count are capped, so a keyless LAN
  flood costs the daemon nothing but refused sockets.
- **Team sockets are never extension sockets.** Peers land in the engine's own peer set, not the
  Broker's `extensions` — so a teammate can never resolve consent prompts, drive control
  actions, or receive consent traffic. The consent broker's invariants are untouched.
- **The invite is a bearer secret**: share it like a password; regenerate the team to rotate it.
  Leaving as host stops the listener, which orphans members (they retry, fail sealed, and the
  user leaves from the panel).

## Sync semantics (why file-level LWW, not a CRDT)

The unit of change in Switchboard storage **is a whole file** (`<key>.json`, or a literal
`.md`/`.html`/… file). So the honest merge is per-file **last-writer-wins on a Lamport clock**,
with deviceId as the deterministic tiebreak — two daemons that see the same ops converge
byte-for-byte, no CRDT dependency, no keystroke merging to get subtly wrong.

- **Detection is a scan** (mtime+size fast path, hash on suspicion, every 1.5s): catches writes
  from `claude_storage`, from Obsidian, from anything — zero hooks inside `StorageStore`.
- **Deletes are tombstones** in the per-team index (kept beside daemon state, never inside the
  shared folder), so a delete propagates instead of resurrecting on the next full exchange.
- **On (re)connect** the sides exchange index digests (versions only) and ship each other just
  the files that beat what the other holds. Offline edits reconcile the same way.
- **Applies are atomic** (tmp+rename), size-capped (2MB — the storage dialect is text), hash-
  verified (corrupt or forged content never lands), and constrained to the same conservative
  filename/containment rules as storage keys. Subfolders, dotfiles and binaries are left alone.

## Git backing — the folder when live, the repo when apart

The team folder is **optionally a git repo** (`team/git.ts`). The host names a remote the team
already has (a private GitHub repo, a bare repo on a NAS — any git URL); each member then
opts their OWN machine in, and pushes/pulls with their OWN git auth — the daemon shells out to
system `git`, so Switchboard never sees a credential. While teammates are online together, the
sealed P2P channel keeps its 2–3s live feel; the repo is the async layer for when they're
apart: a debounced auto-commit ("pushed when done", one commit per burst, attributed to the
member) plus a pull/merge (`-X theirs`)/push cycle. Pulled changes land in the working tree,
where the normal scan stamps them and fans them out to live peers — the two layers compose
through the folder itself. Repo access doubles as revocable, per-person membership (the thing
a bearer invite can't do), and BYO-storage keeps the positioning honest: the team's data lives
in *their* repo, never on our servers.

Safety rails: a folder inside someone's existing repo is refused; a folder that already is a
repo is used only when its origin matches the team remote (never re-pointed); the enable
buttons state the consequence in full ("everything in this folder is committed and pushed");
`GIT_TERMINAL_PROMPT=0` + SSH BatchMode make missing auth a clean panel error, never a hang.

## What shipped vs what's next

Shipped: the mode switch, host/join/leave/presence (with a stable per-member colour in the panel,
grey when offline), folder sync with the full grammar proven headless (`npm run try-team` — two
isolated daemons: bidirectional initial sync, join-time LWW contests, live edits, concurrent-write
convergence, tombstones, rejoin-without-wipe, presence, leave, off-by-default with `capabilities()`
unchanged, and origin-scoped nudges), the hardened wire protocol (silent knock-first handshake,
AAD-sequenced frames, authorship binding, connection caps), the git backing (`npm run try-team-git`),
the cross-network relay (`npm run try-team-relay`), a visible default join folder
(`~/Switchboard Teams/<team>`), the panel Team section, and native folder pick.

**Wrapps get multiplayer for free** via `examples/apps/src/kit/livestore.js` (shipped in the wrapp
template, doctrine gate 7): `collection()` gives per-record files (one item = one file, so per-file
LWW merges concurrent edits instead of clobbering) and `mountLive()` re-reads on the storage-changed
nudge. Redline (CUT) is migrated as the flagship — two reviewers redline the same cut and their
comments merge live. The 68-cell wrapp harness stays green.

## Cross-network — the relay (built), and the zero-infra bridges

**The relay** (`packages/relay`, a Cloudflare Worker + Durable Object; proven headless by
`npm run try-team-relay` against a protocol-identical local stand-in). When members are on
different networks they can't reach each other directly (NAT), so both host and members dial
*out* to the relay — outbound always traverses NAT, no port-forwarding, no LAN. The relay is a
**dumb store-and-forward for the already-sealed frames**: it never holds the team key, opens
nothing, stores nothing — a mailman, not a landlord, a strictly stronger posture than
Figma/Notion multiplayer where the server reads every document. It's wired transparently: the
member's normal dial just points at the relay, the host takes a virtual per-member socket, and
the sealed handshake/sync protocol is byte-for-byte unchanged (see `team/relay-transport.ts`).
The invite code carries the relay URL, so a joiner still just pastes one code; a deployment can
make every team relay-backed with `RELAY_TEAM_RELAY=wss://…`. MIT like everything else, so the
free version is guaranteed — **self-host it** or use a hosted default (a clean Pro perk).

**Zero-infra bridges** for teams that prefer tools they already run:
- **Git backing** (built): any free private repo is the async path across any network.
- **Syncthing**: open source, free, community-run encrypted relays — point it at the team folder
  and the scan loop treats its deliveries like any local change. Same trick as git.
- **Tailscale (free) / self-hosted Headscale**: stable addresses anywhere; the LIVE direct
  channel works over it unchanged — the invite just embeds the Tailscale address.

Deliberately not yet:
- **Relay hardening for a public hosted default** — hibernation to drop idle-room cost, per-IP
  room caps / abuse controls. The frames are unreadable regardless; self-hosting works today.
- **Per-member attribution surfaced in apps** ("done by Sameep's Claude, approved 14:02") —
  git commits already carry it; surfacing it in wrapps is UI.
- **Token-level co-streaming** (watching a teammate's Claude draft live). File-granularity
  updates are the honest v1; streaming into shared docs is a later, separate surface.
- **Read-only members / roles.** Every P2P member is a writer today; a repo-backed team can
  already approximate roles with git permissions.
