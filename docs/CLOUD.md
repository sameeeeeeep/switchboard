# Cloud — the two paid lanes, and why they don't break the promise

Switchboard's pitch is that your computer is the backend: your Claude, your tools, your data, and
**nothing leaves your machine**. Two optional capabilities knowingly cross that line, so both are
**off by default**, both are labelled in the UI in the user's own words, and neither changes anything
for someone who never turns them on.

The rule that keeps this coherent:

> **Your infra is free. Our cloud is Pro. We charge for infrastructure we run — never for AI access.**

AI stays bring-your-own forever. If a price ever attaches to the model itself, the pitch is dead.

## The free / Pro line

| | Runs on | Price |
|---|---|---|
| Solo Switchboard — BYO Claude, local models, wrapps, the five noes | your machine | **Free forever** |
| Team Mode on one network (LAN, peer-to-peer) | your machines, direct | **Free** — costs us nothing |
| Team Mode via a **self-hosted** relay | your Cloudflare | **Free** — your infra, your bill |
| Team Mode via **our** hosted relay (paste-a-code, works anywhere) | our cloud | Free live sync today; Pro when `TRIAL_MS>0` |
| **Cloud backup** — always-on encrypted storage, offline catch-up, new-device restore | our cloud | **Pro** |
| **Hosted models** — inference without a Claude subscription | a provider | **Separate, as used** |

Three independently-priced things (seats · storage · tokens), never one bundle. Sync and storage are
near-zero fixed cost; **inference is real variable cost**, so it must never ride inside a cheap flat
tier — one heavy user would make that tier unprofitable. That's why the entitlement carries
capabilities rather than a plan name.

## Lane 1 — hosted models (OpenRouter)

`packages/sidekick/src/backends/openrouter.ts`, registered only when a key exists.

- OpenRouter is OpenAI-compatible, so it drops into the same backend seam as the local runners. The
  provider surface a wrapp sees (`window.claude`) is identical either way.
- The user supplies **their own key**; it lives in `~/.relay/cloud.json` (0600), is never echoed back
  over the control channel, and never reaches a page — the daemon calls the provider.
- `hosted: true` on the backend is the honest flag. `hostedModels()` feeds the panel badge:
  **"routed through a provider"** vs **"nothing leaves your machine"**. It is never the default —
  with no key the backend isn't even registered.
- Metered through the existing budget ledger, so a hosted run obeys the same per-origin budgets.
- The agentic tool loop isn't wired here yet, so a tool-bearing run **fails closed** with a clear
  error rather than running ungated.

Off switch: `cloud.clear` removes the backend at runtime. Config: `RELAY_OPENROUTER_KEY` /
`RELAY_OPENROUTER_URL` for headless setups.

## Lane 2 — cloud backup (zero-knowledge)

`packages/relay` (the Cloudflare Worker + Durable Object) and `packages/sidekick/src/team/`.

**What it fixes.** Peer-to-peer Team Mode syncs only while somebody is online. Cloud backup makes the
folder survive *everyone* being offline, and lets a brand-new machine rebuild it from the invite code
alone (`team.restore`).

**Why it's still zero-knowledge.** The daemon uploads the *same AES-256-GCM-sealed payloads the wire
already carries*. The relay holds no team key (that's HKDF'd from the invite secret, which never
leaves the daemons), so it stores ciphertext it cannot open. We are a mailman, not a landlord — and
this is a *stronger* posture than every other collaboration product, which reads everything.

**The honest phrasing.** With backup on, "nothing leaves your machine" becomes **"nothing *readable*
leaves your machine."** Say it that way. A critic who checks will find it's true.

**Key loss is unrecoverable.** If the invite secret is gone, the backup is undecryptable — by us too.
That's the 1Password trade, and the UI must say so before anyone relies on it.

## Cost control — the thing that makes hosting survivable

Durable Objects bill for **awake wall-clock time**, so the naive relay (rooms resident while sockets
idle) would bill 24/7 for teams that aren't editing. Mandatory, not future work:

1. **Hibernation** — `state.acceptWebSocket()` + `webSocketMessage`/`webSocketClose` handlers, so the
   DO is evicted from memory while sockets stay open and wakes only for real frames. No room state in
   instance fields: roles/ids live in socket tags + `serializeAttachment`, the log in DO storage,
   trial expiry in an **alarm**.
2. **`setWebSocketAutoResponse`** — keepalive pings are answered *without waking* the DO.
3. **Entitlement gate** — persistence happens only for a connection presenting a valid token, so
   nobody who merely knows the URL can write to our disk.
4. **Seat cap by live-socket count** — counting sockets never reads sealed content, so seats are
   enforceable *without accounts*. Only the host subscribes; members paste a code as always.
5. **Byte cap + snapshot compaction** — the daemon periodically uploads one sealed full-folder
   snapshot and the DO drops the prior log, so storage tracks the folder, not its edit history.

Net: cost scales with actual editing, not with open tabs.

## Membership, not knowledge of an id (what the adversarial review forced)

A 27-finding review of both lanes found two holes worth naming, because the fixes are now load-bearing:

**A `teamId` is a routing id, not a secret.** It rides in the URL path, so it lands in Cloudflare
logs and any intermediary's. Originally that was enough to (a) claim `role=host` — evicting the real
team and tapping every sealed frame — or (b) `fetch` the entire sealed backup. Both are closed by a
**room authenticator**: every connection presents `ra`, HKDF'd from the invite secret under a label
*unrelated to the content key*, so the relay can compare it and can never derive the encryption key.
Trust-on-first-use per room; afterwards every socket must match (`4004 not-a-member`), and a socket
without proof may **never** take the host role.

**Reads are gated exactly like writes.** An unentitled socket now gets `{denied}` for `fetch` too —
otherwise the ciphertext corpus, op counts, batch byte-sizes and write timeline (plus our egress)
were free for anyone in the room.

The rest of the hardening, in one list:

- **Compaction is non-destructive** — the superseded generation is retained and rotated at most once
  per `STORE_RETAIN_MS` (24h), so a run of snapshot frames can't destroy the only recoverable copy.
- **Entitlement expiry is re-checked on every write**, not just at connect, so a long-lived socket
  can't keep writing on a lapsed plan.
- **Seats cap on the room's plan**, not on whoever connected last, so an unentitled joiner can't
  shrink a paid team; and a reconnecting host is replaced *before* counting, so it is never refused
  by the seat its own half-open socket still holds.
- **Refusals are WebSocket closes, not HTTP statuses** — a client cannot read a code or reason out of
  a rejected handshake, so the documented `4002`/`4003`/`4004` contract is honored by accepting the
  upgrade and then closing.
- **The daemon never trusts the relay.** The restore cursor advances only over blobs that actually
  *opened* (the relay's `head` claim rides outside the seal, so trusting it would let a hostile relay
  skip a team past real data), and a `{full}` reply triggers at most one compaction per minute so a
  folder over the cap can't cause an upload storm.
- **`backendFor()` never falls back to a hosted backend** — an omitted or unknown model id means "the
  user's own default", and resolving that to hosted would send prompts off-machine with nobody
  opting in. Hosted models are reachable only by exact id.
- **An opt-out persists** (`off: true`), beating an env key, so turning the hosted lane off stays off
  across restarts; credential files are `chmod`'d to 0600 on **every** write (the `mode` argument
  only applies at creation).

## The entitlement

`<teamId>.<expMs>.<maxSeats>.<HMAC-SHA256-base64url("teamId.exp.maxSeats")>`, signed with a secret
that exists **only on the relay** (a Wrangler secret) and at the future billing service.

- **Team-scoped and expiring** — it can't be lifted to another team or replayed forever.
- **Service-only** — it unlocks storage and seats. It can never decrypt a frame.
- It rides in the **invite**, so a Pro team's members inherit the Pro session and count against its
  seats while still creating no account of their own.
- Attached with `team.setEntitlement` (teams exist before a subscription is applied to one).
- **Self-host escape:** no `STORE_SECRET` (or `STORE_OPEN=1`) ⇒ ungated, unlimited, on their infra.

Billing (Stripe → mint a token for a teamId) is the one piece not yet built; everything above is
already enforced behind the same HMAC gate.

## Trial and the upgrade prompt

`TRIAL_MS = 0` today: hosted **live sync is free and unlimited**, storage is already Pro-gated. When
billing goes live, setting `TRIAL_MS=600000` turns hosted sync into 10-minute free sessions with
**unlimited restarts** — the paste-a-code wow stays shareable forever, sustained work needs Pro, and
there's no trial state to track (which we couldn't do without accounts anyway).

Gate refusals are surfaced, never silent: close code **4002** (`trial-over`) and **4003**
(`seat-limit:<n>`) become human prompts in `TeamStatus.error` instead of an endless reconnect.

## Proofs

| Harness | What it proves |
|---|---|
| `npm run try-cloud` | hosted inference: off by default → opt-in → complete → real SSE stream → metered → key never leaves the daemon → agentic fails closed → opt-out |
| `npm run try-store` | the gate at protocol level: unentitled **put and fetch** denied, trial expiry + restart, seat cap, team-scoping, byte cap, compaction, fresh-client replay, **host-seizure and wrong-proof both refused**, self-host ungated |
| `npm run try-team-cloud` | end-to-end with real daemons: free tier stores nothing → Pro → sealed backup → **kill the only daemon** → a fresh daemon restores the folder byte-for-byte |

## Not yet

- **Billing** — Stripe → entitlement minting (the gate is ready for it).
- **Member-side store catch-up** — today the host does the fetch/put; members catch up through the
  host or by restoring. Enough for backup/restore; the symmetric case is next.
- **Enterprise flow** — a different shape entirely (SSO-ish hosts, admin-managed seats, audit
  export). Deliberately unbuilt until the self-serve flow is smooth.
- **R2 for large snapshots** — DO storage is fine at current folder sizes.
- **Proof-of-key on read** — `ra` + entitlement is the authorization boundary today. A challenge-
  response (HMAC over a relay nonce) would be stronger still; a separate, larger change.

## Compatibility note

The room-proof requirement means a **pre-0.2.1 daemon cannot *host* a relay-backed team** against a
gated relay (it doesn't send `ra`, and an unproven host is exactly the hijack). Members are
unaffected. Ship the daemon and the relay together.
