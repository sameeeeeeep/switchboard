# Switchboard team relay

A **dumb, encrypted-frame forwarder** — the cross-network path for [Team Mode](../../docs/TEAMMODE.md).
When a team's members are on different networks, they can't reach each other directly (NAT). This
relay is a rendezvous both sides dial *out* to; outbound connections always traverse NAT, so there's
no port-forwarding and no LAN requirement.

**It cannot read your data.** The relay never holds the team key (HKDF of the invite secret). Every
frame it moves is AES-256-GCM sealed by the daemons; the relay only sees opaque ciphertext, keyed by
team id into a per-team [Durable Object](https://developers.cloudflare.com/durable-objects/) room. It
stores nothing — rooms are in-memory socket bookkeeping. *A mailman, not a landlord.* This is a
strictly stronger privacy posture than Figma/Notion-style multiplayer, where the server reads every
document.

MIT-licensed like the rest of the repo, so the free version is guaranteed: **self-host it** and point
your team at your own URL, or run the hosted default.

## Wire contract

```
wss://<relay>/room/<teamId>?role=host      # the room host — dials out, takes a virtual socket per member
wss://<relay>/room/<teamId>?role=member    # a joiner — bare sealed frames in/out
```

The daemon's `RelayHostTransport` / `relayMemberUrl` (in `packages/sidekick/src/team/`) speak this
directly. `examples/harness/local-relay.mjs` is a protocol-identical Node stand-in used by
`npm run try-team-relay` to prove the path headless with no cloud.

## What it is now

Two jobs, one Worker + Durable Object (one DO per `teamId`):

1. **Forward** the already-sealed frames between a team's daemons (the free, cross-network path).
2. **Store** them, when a team presents a Pro entitlement — an append-only log of **ciphertext the
   relay cannot read**, so an offline/rejoining member or a fresh device can catch up. Frames:
   `{put:<b64>}` → `{stored:seq}` · `{snapshot:<b64>}` → compacts the log to one entry ·
   `{fetch:<sinceSeq>}` → `{log:[…],head}`.

**It hibernates.** The DO uses `state.acceptWebSocket()` + `webSocketMessage`/`webSocketClose` and
`setWebSocketAutoResponse` for keepalives, so it's evicted from memory while sockets stay open and
bills only for real frames — cost tracks editing, not open tabs. Consequently **no room state lives in
instance fields**: roles/ids are socket tags + `serializeAttachment`, the log is DO storage, and the
free-session deadline is an **alarm**.

**The gate.** `STORE_SECRET` (a Wrangler secret) signs entitlements
`<teamId>.<exp>.<maxSeats>.<HMAC>`; a valid one unlocks persistence and the plan's seats. Seats are
enforced by **counting live sockets** — never by reading content — so members need no account. Unset
`STORE_SECRET` (or `STORE_OPEN=1`) ⇒ **self-host mode: ungated and unlimited on your own account**.
`TRIAL_MS=0` (default) leaves free sync unlimited; set it (e.g. `600000`) to time-box free sessions,
which close with `4002 trial-over` (`4003 seat-limit:<n>` when over plan) for a real upgrade prompt.
`MAX_STORE_BYTES` caps per-team storage.

Design + pricing rationale: [`docs/CLOUD.md`](../../docs/CLOUD.md).

## What it is now

Two jobs, both zero-knowledge:

1. **Forwarding** (free) — moves already-sealed frames between a team's daemons across networks.
2. **Persistence** (Pro) — keeps a per-team append log of those same sealed blobs so a folder
   survives everyone going offline and a fresh device can restore it.

It holds no team key and cannot open a byte of either. **Hibernation is mandatory** (`acceptWebSocket`
+ `setWebSocketAutoResponse`), so idle connected teams cost ~nothing and billing tracks real editing.

**Access is by membership, not by knowing a `teamId`** (which travels in URLs and logs): every
connection presents `ra`, HKDF'd from the invite secret under a label unrelated to the content key.
Trust-on-first-use per room; afterwards every socket must match, and an unproven socket may never
take the `host` role. Reads (`fetch`) are gated exactly like writes. See
[docs/CLOUD.md](../../docs/CLOUD.md) for the full model and threat notes.

## Live

A hosted instance runs at **`wss://switchboard-team-relay.switchboard-team.workers.dev`** — it's
the panel's prefilled default when hosting, so teams are cross-network with one paste. Proven live
end-to-end by `RELAY_URL=wss://switchboard-team-relay.switchboard-team.workers.dev npm run try-team-relay`
(two isolated daemons syncing through the real Worker). Root path returns a plain liveness string;
all real traffic is sealed WebSocket frames it can't read.

## Deploy your own

```bash
cd packages/relay
npx wrangler deploy
```

Runs on the Workers **free** plan (the DO is SQLite-backed and stores nothing). Point a team at your
own instance via the panel's relay field or `RELAY_TEAM_RELAY=wss://…` on the daemon.

Then a team is made relay-backed either per-host (the panel's relay field / `team.host {relay}`) or
globally via `RELAY_TEAM_RELAY=wss://your-relay.workers.dev` on the daemon. The invite code embeds the
relay URL, so a joiner just pastes the code — the daemon tries a direct connection first and falls back
to the relay, and the user never learns the word "NAT".

## Not yet

- **Hibernation** (`state.acceptWebSocket`) to drop idle-room cost — a straightforward optimization;
  a room today stays in memory while its sockets are open, which is correct, just not the cheapest.
- **Abuse controls** (per-IP room caps, auth on room creation). The frames are unreadable regardless,
  but a public hosted relay wants rate limits before it's more than a demo.
