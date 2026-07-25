# Switchboard — three YC angles, evidence-graded

**Written 2026-07-25.** Every number below was re-measured on this tree today, not copied forward.
Where a claim from an earlier research pass has since gone stale, the stale version is named and
corrected rather than quietly replaced.

Companion documents: `docs/YC-APPLICATION-v3-private.md` (the current privacy-led draft),
`docs/YC-APPLICATION-v2.md` (the economics draft and its ten-item honesty appendix),
`examples/autopilot/AUDIT.md` (the UX audit that produced the copy-paste finding).

**Ordering rule:** these are ranked by how much of the claim is running code, not by how big the
market is. Angle 1 has the most executable evidence and the least traction. Angle 3 has the best
story and the weakest floor. Lead with 1.

**Register:** plain declarative sentences. Concrete nouns. Real numbers with their source file.
Banned from every line: revolutionary, seamless, game-changing, cutting-edge, leverage as a verb,
empower.

---

## The one-paragraph version

Switchboard is a program that runs on your machine and stands between a web page and your Claude
subscription, your files, and your tools. The page gets a `window.claude`; it never gets a key. Every
tool call passes one function in one file, and anything that writes needs a human click. That much is
built, committed, and re-provable in about four minutes of commands. On top of it sits a shared
folder for teams that syncs through a relay which holds only AES-256-GCM frames and no key — live in
production today. Above that sits a catalog of 41 apps, a token economy, and a payout split. Those
three are a catalog, a design document, and arithmetic, in that order of maturity. Nothing has ever
been charged.

---

# Angle 1 — The enforcement layer (LEAD)

**One line:** Switchboard is a local consent broker where every tool call, from the page or from the
model, passes one function in one file — and a team can share a folder over a relay that provably
cannot read it.

## The claim

Privacy in AI tooling is a policy page today. Here it is a chokepoint. The app is a static file with
no server. The model is the user's own. A daemon on the machine is the only thing that can execute
anything, and it checks a per-origin grant, a read/write class, a budget, and a human click before it
does. When two people share a folder, the bytes on the wire are sealed with a key the transport never
holds. None of that is a promise about our conduct. It is a property of where the code sits.

## Provably true today

**The gate is one function, and both entry paths call it.**
`packages/sidekick/src/security/gate.ts` — `authorize()` at line 64 runs grant → allowlist → budget →
read/write class → per-action consent. `gateToolCall()` at line 108 calls the same `authorize()`
before executing. The Agent SDK's `canUseTool` routes into that same function at
`packages/sidekick/src/backends/claude-code.ts:91`, commented in-file as "THE GATE, as the SDK sees
it." A model that has been hijacked cannot widen its own scope, because widening happens in a
different process than the one the model is in.

**The daemon refuses web pages and requires a token.**
`packages/sidekick/src/server.ts:121-124` — "Rule 1: reject connections that look like a web page
reaching localhost directly." A non-extension `Origin` gets `close(1008, "forbidden origin")`. Then
token auth at line 131: `msg?.type === "auth" && msg.token === pairingToken`, else
`close(1008, "unauthorized")`. The token is 32 random bytes at `~/.relay/pairing-token`, mode 0600
(`packages/sidekick/src/config.ts`, `loadPairingToken`). An open port on 8787 is not a reachable one.

**App-to-app isolation is derived from the browser-attested origin, not from page input.**
`packages/sidekick/src/storage/` header: "ISOLATION IS STRUCTURAL: a record's path is
`folderFor(origin) + <key>.json`, and origin is the daemon's authoritative value (never page input)."
`fileFor()` re-resolves the path and asserts containment on top of the key regex.

**A team peer is architecturally not an extension.**
Team peers live in `TeamEngine`'s own map at `packages/sidekick/src/team/engine.ts:140`
(`private peers = new Map<string, Peer>()`). Consent and control replies are only accepted from the
Broker's `extensions` set, which is populated exclusively after pairing-token auth. A teammate cannot
resolve your consent prompt. This is a collection boundary, not a policy check.

**Team Mode works end-to-end, headless, on two isolated daemons over one folder. I ran it today.**
`npm run try-team` → exit 0, 23 `✓` assertions, ending "TEAM MODE: all green." Covered: bidirectional
initial sync byte-for-byte, join-time last-writer-wins contests, concurrent-write convergence,
tombstoned deletes, presence, rejoin with a fresh folder without a wipe, and "capabilities unchanged
(no `claude_team` method)" while the mode is off.

**The wire is sealed with a key the transport never holds.**
`packages/sidekick/src/team/crypto.ts` — `deriveTeamKey()` at lines 67-70 is
HKDF-SHA256(secret, salt `"switchboard-team-v1"`, info `teamId`); `seal()`/`open()` at 81-114 are
AES-256-GCM. `open()` returns `null` on any failure and the caller closes the socket, so an
unopenable frame is a disconnect rather than an error path to probe.

**The cross-network path is a mailman, not a landlord.**
`npm run try-team-relay` → 12 `✓`, ending "TEAM MODE × RELAY: all green," including "relay transport
is a plain pipe carrying only AES-256-GCM frames." Worker source:
`packages/relay/src/worker.ts`.

**Git backing means the company's data is in the company's repo, and we never touch a credential.**
`packages/sidekick/src/team/git.ts:12-13` — shells out to system `git`, "so auth is the user's own SSH
key / credential helper — Switchboard never sees or stores a git credential." Line 47 forces
`GIT_TERMINAL_PROMPT=0` and `ssh -oBatchMode=yes`, so missing auth is a clean error rather than a
hang. Proven by `npm run try-team-git`.

**Hosted inference is off unless a key is pasted, and it fails closed on tools.**
`packages/sidekick/src/backends/registry.ts:25-29` only registers the OpenRouter backend when a key
is present; `loadCloudConfig()` in `config.ts` returns `{}` with no key. `openrouter.ts` `run()`
throws `UNSUPPORTED_METHOD` if `params.agentic` or `ctx.allowedTools.length > 0` — an agentic run on
the hosted lane is refused, not silently run ungated. `npm run try-cloud` → 11/11 green.

**There is an append-only local audit log, and it has real volume.**
`packages/sidekick/src/security/audit-log.ts` writes JSONL to `<stateDir>/audit.log` at mode 0600.
Measured on this machine today: **6,064 entries across 38 distinct origins**, with 1,445
`claude_permissions`, 1,338 `tool_call`, 1,127 `claude_storage`, 871 `claude_context`.

**We publish the limit that cuts against us.**
`docs/SECURITY-AND-BINDINGS.md`, Risk E: "Data locality protects secrets, not content… Read access =
the app can take the data with it." Part 4 lists read-side exfiltration under injection as an open
problem. The doc bounds its own summary to "a hijacked app or model cannot take an irreversible or
money-moving action without a human click."

## Not true yet

- **No identity layer.** Team membership is a bearer secret in the invite code
  (`packages/sidekick/src/team/crypto.ts:20`). Possession is membership. There is no per-person
  revocation; the only rotation is regenerating the whole team. A company cannot offboard one person.
- **No roles.** `docs/TEAMMODE.md`: "Every P2P member is a writer today." No read-only members, no
  per-folder permissions. Git repo permissions are the only approximation.
- **No SSO, SAML, SCIM, or directory integration.** Grepped `packages/{sdk,protocol,sidekick,extension,relay}/src`
  for `sso|saml|scim|okta|mdm` — zero hits.
- **No admin plane.** There is no org policy object anywhere in the daemon. Nothing lets IT say "this
  fleet may only use the local backend," "these origins are blocked," or "trust mode is forbidden."
  Every one of those is a per-user toggle in a per-user panel.
- **No central audit.** The log is a local file per machine. No forwarding, no aggregation, no SIEM
  export, no tamper-evidence. A compliance team cannot answer "what did the fleet do last quarter."
- **No fleet deployment.** Install is a per-user launchd job (`npm run daemon:install`) plus a menubar
  app. No MDM package, no managed config, no version pinning.
- **The airgapped runner is a prototype.** `examples/runner/serve.mjs` is 85 lines — a CSP
  `connect-src 'none'` plus a `postMessage` `window.claude` bridge. It is not the shipped path.
  Shipped wrapps are ordinary pages on their own origin and can POST what they were granted. This is
  the gap our own security doc names.
- **Local inference is thin.** `packages/sidekick/src/backends/local-openai.ts` does non-streaming,
  no-tools completions only; anything agentic on a local model fails closed. "No cloud at all" gets a
  real but narrow subset today.
- **Zero corporate evidence.** No design partner, no pilot, no deployment, no procurement artifact
  anywhere in the repo. Everything above is capability.

## The attack a sharp partner makes

"Companies don't buy 'everyone's laptop is the server.' You have no admin plane — no SSO, no
per-person revocation because your invite is a bearer secret, no roles, and your audit log is a text
file on each employee's machine with no way to collect it. So who signs, and what do they administer?
And your own security doc says an app you granted data to can POST it to its own server, which means
'data never leaves' describes your broker, not the app the employee actually opens. You have zero
corporate users. This is a privacy-flavored developer tool with an enterprise sentence attached."

The honest answer is to concede the framing and keep the artifact: what exists is the enforcement
layer, and it is the hard half. The administration layer is a known, additive build.

## What we would build next

Three additive changes, each converting a policy promise into an architectural one — the same
discipline that shipped Team Mode without touching the protocol.

1. **Kill the bearer invite.** Make the host a certificate issuer. Membership becomes a signed,
   per-person, expiring credential presented during the existing sealed knock → challenge → hello
   handshake at `packages/sidekick/src/team/engine.ts:517-547`. The crypto is already there and the
   frames already carry an authenticated `deviceId`. That one change buys per-person revocation,
   offboarding, and read-only roles — the latter as a scope claim the `applyOps` filter at
   `engine.ts:590` enforces.
2. **An org policy file the Gate reads.** Insert it before the grant check in `security/gate.ts`:
   allowed backends, origin allow/denylist, trust-mode forbidden, budget ceilings. Because the Gate is
   already the single chokepoint, this is a few lines in one function and it is unbypassable
   everywhere.
3. **Audit forwarding.** `audit-log.ts` is already append-only JSONL. Add a signed tail-shipper to an
   org endpoint so the compliance answer exists at all.

Sequence against one design partner and let their procurement checklist pick the order. Separately and
cheaply: finish `examples/runner/serve.mjs` into the default way wrapps are served. That is what
upgrades "data never leaves" from a claim about our broker to a claim about their app.

---

# Angle 2 — The relay: the one thing we can sell without touching the privacy claim

**One line:** We sell the part of the work we cannot read — a live, zero-knowledge team relay with a
working cryptographic gate — while inference stays on the user's own key, so we buy no compute.

## The claim

The revenue design is a $20/month Pro subscription unlocking the pro tier of every wrapp, with ~75%
paid to developers pro-rata by broker-metered usage, plus token packs. The honest version today: the
**meter** and the **gate** are built, and one of them is deployed. The **ledger**, the **rate card**,
the **payment rails**, and the **hosted compute pool** are not. Zero dollars have been charged.

## Provably true today

**The relay is live in production.**
Measured: `curl https://switchboard-team-relay.switchboard-team.workers.dev/health` → HTTP 200 in
0.84s. Source `packages/relay/src/worker.ts`, config `packages/relay/wrangler.jsonc`.

**The gate is a cryptographic primitive, not a flag.**
`packages/relay/src/worker.ts` — `verifyEntitlement()` parses
`<teamId>.<expMs>.<maxSeats>.<HMAC-SHA256>` and rejects a token whose `teamId` differs or whose `exp`
has passed. `private get open()` at line 91 returns
`this.env.STORE_OPEN === "1" || !this.env.STORE_SECRET` — self-hosters are ungated by construction,
not by permission.

**The whole gate is proven headless. I ran it today.**
`npm run try-store` → exit 0, all green, ending "HOSTED RELAY GATE: all green." Assertions include
"the ciphertext round-trips byte-for-byte (we never opened it)", "a team-A token cannot persist into
team B", "the 3rd join is refused with the seat-limit code 4003", "an oversize put is rejected
(bounded cost)", "after compaction the log is ONE snapshot entry (storage ≈ folder, not history)", and
"self-hosted: persistence works with no entitlement at all."

**The cloud cost is bounded in code, so the paid tier cannot run away on COGS.**
`worker.ts`: `state.acceptWebSocket()` (Durable Object hibernation, so idle rooms are evicted and stop
billing); `setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"))` so keepalives
never wake the DO; `MAX_STORE_BYTES` default 8 MiB per team (line 104); snapshot compaction that
deletes the entire prior log.

**Today's posture is deliberately the cheap one.**
`private get trialMs()` returns `Number(this.env.TRIAL_MS ?? 0)`, commented "0/absent ⇒ NO time
limit… only persistence costs real money." Live sync is free and unlimited; only persistence is gated.

**Persistence is now wired end-to-end in the daemon.**
`packages/sidekick/src/team/engine.ts` calls `sendStore()` at lines 816 (`{fetch}`), 823 (`{put}`) and
833 (`{snapshot}`), with `SNAPSHOT_EVERY = 20`. *Correction to an earlier pass, which reported that
`engine.ts` never called it: that is now stale. Caveat: as of this writing those four sidekick team
files are uncommitted working-tree changes (`git status` shows `M packages/sidekick/src/team/engine.ts`
and three siblings). The relay half is committed at `7faf2d0`.*

**Even the hosted inference lane costs us nothing.**
`packages/sidekick/src/config.ts` writes `~/.relay/cloud.json` with `{ mode: 0o600 }`; `openrouter.ts`
sends `authorization: Bearer ${this.apiKey}` from the daemon, never from the page. No backend in the
repo calls a model with a Switchboard-owned credential.

**Per-wrapp attribution is real, and I ran the settlement on it.**
6,064 audit entries on this machine; filtering to `claude_complete` / `claude_stream` /
`claude_session` gives **359 model-runs across 18 origins**. Pro-rata against a $240 pool at 75%:
top origin 59.1% → $106.30; 6th 1.9% → $3.51; 10th 0.6% → $1.00. That arithmetic runs today, on
telemetry a page cannot forge, with no ledger service in existence.

**The money surfaces are labeled as simulation.**
`examples/apps/src/home.js`: "No payment rails yet — this toggle is a labeled simulation of the
entitlement flag." `buyPack()` prints "SIMULATED checkout complete … was NOT charged; no card exists
here."

**The free version is contractually guaranteed.**
MIT `LICENSE` at repo root; `packages/relay/README.md`: "self-host it and point your team at your own
URL." That is what makes the paid gate defensible rather than extractive.

## Not true yet

- **No ledger.** No mint, burn, settle, wallet, or rate card. No Stripe anywhere in code — grepping
  for `stripe` hits `docs/TOKENS.md`, `docs/VISION.md`, and a CSS class named `.stripe` in the
  extension side panel. `docs/TOKENS.md` says it: "economics are decided, rails are not built."
- **Token spend is not persisted.** `packages/sidekick/src/security/budgets.ts:19` is
  `private meters = new Map<...>()` with a rolling 24-hour window and no disk write. It is wiped on
  every daemon restart. And of 6,064 real audit entries on this machine, **zero carry a token field**
  (measured). So "the broker is the meter and the meter is the books" is true for *plays* and false
  for *spend*.
- **Some metering is an estimate.** `server.ts:964` `estimateTokens(text) = ceil(text.length/4)`,
  used when a backend returns no usage, and it ignores input tokens entirely. Claude Code does report
  real usage (`claude-code.ts:162`), so this is a fallback — but a rate card needs the real number on
  every path.
- **No `plan: "free" | "pro"` field in the grant handshake.** No hit in `packages/protocol/src`. The
  store simulates it with a local flag.
- **No cloud UI in the extension.** Grepping `packages/extension/src` for `cloud.` or `openrouter`
  returns nothing. There is no key-entry field and, more importantly, no hosted badge — even though
  the daemon computes `hostedModels()` for exactly that purpose. The honest badge is an API, not a
  pixel.
- **No hosted inference pool.** The pack loop (buy tokens → we run the model) has nothing to burn
  against. It is the one loop in `TOKENS.md` that would give us real COGS, and it is unbuilt.
- **Whether the live relay is gated is unverified.** I did not write to production. If `STORE_SECRET`
  is unset on the deployed worker, `open` is true and the production relay is currently ungated and
  unlimited. Check this before saying the gate is enforcing.
- **`packages/relay/README.md` is stale in the underclaiming direction** — it says hibernation is "not
  yet" and the relay "stores nothing," while `worker.ts` implements both hibernation and a persistent
  op-log.
- **`home.js:390`** (the featured card, the most-seen surface) prints "built with 4.8M tokens" without
  the `dev-reported` qualifier the detail card carries.
- **No revenue, no Pro subscribers, no payout has ever settled.**
  `docs/YC-APPLICATION-v3-private.md`: "Nothing is charged today."

## The attack a sharp partner makes

"You have built a meter for a business that does not exist." Three follow-ups land hard.

1. Zero revenue, no Pro tier. Every number in the model is arithmetic on assumed subscribers.
2. Your hosted lane runs on the user's own OpenRouter key. That is not a cloud business, it is a
   second BYO — so the only thing you can actually charge for today is a relay, not the catalog.
3. The meter does not record what you say you will settle on. Token spend lives in an in-memory `Map`
   that dies with the process, and 6,064 real audit lines contain zero token counts. The honest
   attribution unit is **plays**, and plays are the gameable one: many cheap calls beat one expensive
   call.

And the Spotify comparison cuts backwards at seed scale. At $20/month with a 75% pool, a mid-tail
wrapp on the real usage distribution above earns about **$0.09 per subscriber per month**. Spotify's
long tail works because there are 250 million subscribers. You cannot recruit developers with $0.09.

## What we would build next

**Sell the relay, not the tokens.** It is the only complete commercial primitive in the repo and it is
already deployed. The verifier is live in `worker.ts`; `try-store` proves seats, team-scoping, byte
caps, and the self-host bypass. The only missing piece is an **issuer**: a Stripe Checkout that on
success mints `<teamId>.<exp>.<maxSeats>.<HMAC>` with `STORE_SECRET` and hands it to the daemon. Then
set `STORE_SECRET` on the production worker — after first checking whether it is currently unset,
which would mean the live relay is ungated right now. That is days of work, it produces a real dollar
behind a real gate, and it never touches the privacy claim, because the thing being sold is storage of
bytes we cannot read.

Two small fixes make the token story defensible instead of rhetorical:

- Write token counts into the audit log — one extra field on the entry `gate.recordCompletion()`
  already fires — so per-wrapp spend becomes durable and auditable instead of dying with the process.
- Ship the hosted badge in the extension panel. The daemon already computes `hostedModels()` and
  nothing consumes it. That is the cheapest gap between what the code knows and what the user sees.

Then put a priced Pro waitlist on the store to replace the assumed conversion rate with a measured
one. (This is v2's honesty-appendix recommendation and v3's "weakest answer" fix. It has now been
recommended three times and not done.)

---

# Angle 3 — Wrapps as skins

**One line:** 41 catalog entries and 40 app modules whose only dependency is a 650-line SDK, with a
median of 446 lines each — but today they share the runtime by linkage and share the UI by
copy-paste, and one person wrote every one.

## The claim

A wrapp is a skin: prompts, a pipeline, and a UI over one shared local broker. No server, no key, no
middleman. So the marginal cost of the next app is a few hundred lines of prompt-and-render code, and
the whole store deploys as static files.

## Provably true today

**The entire app store has one runtime dependency and no backend.**
`examples/apps/package.json` — `"dependencies": { "@relay/sdk": "*" }`, esbuild as the only
devDependency. Build is `node build.mjs` into `dist/`. No server code, no per-app infrastructure.

**No wrapp holds a key.** Grepping every app source and shell for `sk-ant` or an assigned
`api_key` — zero matches. `docs/PORTING-AND-DEPLOY.md` §1: the deployed site ships only HTML/JS/CSS
and every AI call loops back to a daemon on the viewer's machine at `ws://127.0.0.1:8787`.

**The shared runtime is small.** Measured today, excluding `node_modules`/`dist`: `packages/sdk/src`
650, `packages/protocol/src` 780, `packages/sidekick/src` 5,100, `packages/extension/src` 2,890, plus
`packages/menubar/RelayMenuBar.swift` 608 and `packages/relay/src/worker.ts` 293 — about **10,300
lines**. The provider surface is 14 methods in `packages/protocol/src/rpc.ts`.

**35 app modules import `@relay/sdk` and nothing else app-specific.** One seam.

**Median wrapp is 446 lines; 25 of 40 modules are under 500.** For the 20 modules carrying the
`// ==== APP LOGIC` marker, the split measured today is **median 197 lines of plumbing and 234 lines
of app-specific code**.

**The plumbing is a template, not re-derived.** `.claude/skills/wrapp/template.js` is 341 lines and
the marker sits at line 221. An earlier line-by-line comparison found a median 94% of a wrapp's
non-blank plumbing lines matching the template verbatim (range 86–97%).

**There is a real generator skill.** `.claude/skills/wrapp/SKILL.md` (158 lines) plus `template.html`
(119) and `template.js` (341). It names the failure mode it exists to prevent: "esbuild aborts the
whole multi-entry build on one missing source, so never pre-wire entries (this killed builds before)."

**14 wrapps shipped in one commit.** `git show --stat 1028499` → "43 files changed, 11514
insertions(+), 1 deletion(-)", message "wrapps: 14 after-hours wrapps + build entries", 2026-07-19.

**The catalog is regression-tested headlessly.** `examples/apps/harness/results.json` — 68 runs across
34 apps × 2 seed projects: **64 pass, 2 fail, 2 warn**. The four non-passes are two apps, each across
both projects: `redline` ("no model call fired — folder-bound, no page on disk") and `adpulse`
("partial — CSV precursor renders; full diagnosis needs a live Meta connector"). Both are stated scope
limits.

**The audit names the duplication rather than hiding it.** `examples/autopilot/AUDIT.md`: "The catalog
did not fail 34 different ways. It failed four ways, copy-pasted 20+ times… There is no shared UI
kit." It also self-corrects a first-pass overclaim.

## Not true yet — and this is the angle where the negatives are load-bearing

- **Sharing is by copy, not by import.** Measured today: **14 files still define their own
  `optionCards()`** (down from 18 at audit time — a migration is in flight). The shared kit,
  `examples/apps/src/kit/ui.js`, is imported by **9 of 40** app modules and **is still untracked in
  git** (`git ls-files` returns nothing for it). It was created today. A central doctrine fix
  propagates to 9 apps, not 41.
- **The CSS layer is not shared at all.** Across the 36 app shells in `examples/apps/*.html`: 6,550
  non-blank lines, 3,547 distinct — **46% line-level redundancy**. Only 25 lines appear in ≥80% of
  shells. The `.opt.sel` rule the audit flags appears in 22 of 36. The same measure on the JS: 44%.
- **The abstraction stops at the top of the catalog.** Only 20 of 40 modules carry the template
  marker. The largest are bespoke: `redline.js` 2,209 lines, `bank.js` 1,202, `adforge.js` 1,094,
  `aplus.js` 1,093, `adpulse.js` 1,005, `studio.js` 1,003, `shelf.js` 928. The serious apps are
  exactly where "thin skin" stops being true.
- **One author, every wrapp.** `git log --format='%an' -- examples/apps/src/` → 24 `sameeeeeeep`, 6
  `Sameep Rehlan`. Repo-wide: 97 / 15 / 3, all the same person. No third-party author has ever
  committed a wrapp.
- **Generation speed is unmeasured.** The 14-wrapp batch landed in one commit whose parent shares the
  same minute-level timestamp, so git gives no elapsed time. Any "20 minutes to a new app" number is
  currently unsourced. Do not say one.
- **No developer-side distribution.** No submission path, no review, no payout has been exercised.
- **Modular backend capabilities are a design.** `docs/CAPABILITIES.md` line 3, verbatim: "Status:
  draft / design — no implementation yet."
- **WebMCP is a design.** `docs/WEBMCP.md` line 3, same sentence. The spec itself is a W3C
  community-group draft in Chrome origin trial, not standards-track.
- **No usage, retention, or revenue data on any wrapp.**

## The attack a sharp partner makes

"'Skins over one runtime' is true at the broker seam and false at the UI seam. I grepped your repo and
found the same 14-line function hand-copied 14 times, 46% redundancy across your HTML shells, and a
shared kit that is one day old, imported by nine of forty apps, and not committed. Paired with one
author on 100% of commits, the honest read is that you have a very productive personal template, not a
platform."

The follow-up is worse and the skin story does not answer it: **if a wrapp is this thin, what stops
Anthropic from shipping the same forty skins next month?** That question lands on the broker, not on
the skin — which is another reason this angle should not lead.

## What we would build next

Two things, in order.

1. **Convert the claim from convention to code.** Commit `kit/ui.js` and migrate all 40 modules to
   import it, then publish the delta: target 44% JS and 46% CSS redundancy dropping below 20%, and
   demonstrate one doctrine fix propagating to the whole catalog in one commit. That turns "thin skin"
   from a header comment into a measurable property.
2. **Kill the single-author risk.** Hand the `/wrapp` skill to three people who have never seen the
   repo, time them from a one-line idea to a wrapp that passes the harness, and report the median
   honestly whatever it is. That number — not the line count — is the platform claim, and it is the
   one number that currently cannot be said.

---

# Where these angles agree and conflict with v2 / v3

**Agree.**
- The no-COGS cost structure (v3 Q6, Angle 2). The visitor's own subscription pays for inference and
  no backend in the repo uses a Switchboard credential. This survives audit.
- The broker as the product (v3 Q5, Angle 1). The gate-as-chokepoint evidence is stronger than the
  draft currently uses. `gate.ts:64` / `gate.ts:108` / `claude-code.ts:91` deserve a sentence.
- The airgapped sandbox as designed-not-built (v3 honesty item 3, Angle 1). Confirmed: 85 lines at
  `examples/runner/serve.mjs`.
- Payout economy as direction, not code (v2 item 2, Angle 2). Confirmed and now sharper: the meter
  records plays, not spend.

**Conflict — resolve before sending.**

1. **The wrapp count.** v3 Q7 says "about 30 wrapps live." `catalog.js` has **41 entries**, the
   harness drives **34 apps**, and `examples/apps/src/` holds **40 modules**. v2 honesty item 5
   already flags the inconsistency and it has not been fixed. Pick one number, define it once ("41
   catalog entries, 34 covered by the harness"), and use it in every answer.
2. **What the money answer leads with.** v3 Q6 leads with Pro and the 75/25 split — none of which is
   built. Angle 2 argues the relay should lead, because it is deployed, gated, cost-bounded, and
   sellable with an issuer that is days of work. Recommendation: keep Pro as the plan, but put the
   relay in front of it as the thing that already has a gate.
3. **"About thirty wrapps" as evidence of a platform.** v3 Q8 already concedes "I wrote all ~30 of
   the live wrapps." Angle 3's measurements make that concession heavier: the UI is shared by
   copy-paste, not by import. If a partner greps, they find it in ninety seconds. Say it first.
4. **v3 does not mention Team Mode at all.** It is the single strongest piece of running code in the
   repo — 23 green assertions, sealed transport, an MIT ungated self-host path — and it is absent from
   the draft. That is an underclaim, not an overclaim, and it is free to fix.

---

# HONESTY LEDGER

Everything below is **unbuilt, unwired, unmeasured, or unverified** as of 2026-07-25. Nobody pitches
any of it as done.

### Money
| Item | State |
|---|---|
| Revenue | Zero. Nothing has ever been charged. |
| Pro subscription | Designed. No `plan` field in the protocol; the store simulates it with a local flag. |
| Payment rails | None. No Stripe in code — only `docs/TOKENS.md`, `docs/VISION.md`, and a CSS class named `.stripe`. |
| Token ledger | None. No mint, burn, settle, wallet, or rate card. `docs/TOKENS.md`: "economics are decided, rails are not built." |
| 75/25 payout | Arithmetic. No payout has ever settled. |
| $240M / $60M sizing | Labeled arithmetic on two assumed inputs. Never detach the label. |
| Hosted inference pool | Unbuilt. The token-pack loop has nothing to burn against. |
| Live relay gating | **Unverified.** If `STORE_SECRET` is unset on the deployed worker, production is ungated and unlimited right now. Check before claiming enforcement. |

### The meter
| Item | State |
|---|---|
| Token spend persistence | None. `budgets.ts:19` is an in-memory `Map`, wiped on daemon restart. |
| Token counts in the audit log | Zero of 6,064 entries carry one. Attribution today is plays, not spend. |
| Token counting on every path | Partial. `server.ts:964` estimates `length/4` and ignores input tokens when a backend reports no usage. |
| Dev-reported build costs | Labeled in the detail card, **not** labeled on `home.js:390` (the featured card). |

### Enterprise
| Item | State |
|---|---|
| Per-person revocation | None. The invite is a bearer secret; possession is membership. |
| Roles / read-only members | None. "Every P2P member is a writer today." |
| SSO / SAML / SCIM / MDM | Zero hits across all five package sources. |
| Org policy plane | Does not exist. Every control is a per-user toggle. |
| Central / forwarded audit | None. Local JSONL per machine, no aggregation, no tamper-evidence. |
| Fleet deployment | None. Per-user launchd job plus a menubar app. |
| Corporate users, pilots, design partners | Zero. No procurement artifact anywhere in the repo. |

### Platform
| Item | State |
|---|---|
| Shared UI kit | `examples/apps/src/kit/ui.js` exists, is **untracked in git**, and is imported by 9 of 40 modules. 14 modules still carry their own `optionCards()`. |
| CSS sharing | None. 46% redundancy across 36 shells; 44% across the JS. |
| Third-party authors | Zero. One human on 100% of commits. |
| Developer submission / review / payout path | None exercised. |
| Wrapp generation time | Unmeasured. Git gives no elapsed time for the 14-wrapp batch. Do not state a number. |
| Modular capabilities (`sb_http`/`sb_db`/`sb_secrets`/`sb_exec`) | `docs/CAPABILITIES.md`: "draft / design — no implementation yet." |
| WebMCP | `docs/WEBMCP.md`: "draft / design — no implementation yet." |
| Usage / retention data | None on any wrapp. |

### Security scope
| Item | State |
|---|---|
| Airgapped runner | 85-line prototype at `examples/runner/serve.mjs`. Not the shipped path. Shipped wrapps can POST what they were granted — `docs/SECURITY-AND-BINDINGS.md` Risk E says so. |
| Read-side exfiltration under injection | Open problem, stated in our own doc, Part 4. |
| Third-party wrapps | Not shipped. The privacy claim currently rests on the catalog being first-party. |
| Local inference | Non-streaming, no-tools only. Anything agentic on a local model fails closed. |

### Working-tree caveats (as of this writing)
| Item | State |
|---|---|
| Zero-knowledge persistence wiring | `engine.ts:816/823/833` call `sendStore()`, but `packages/sidekick/src/{server.ts, team/crypto.ts, team/engine.ts, team/relay-transport.ts}` are **uncommitted**. The relay half is committed at `7faf2d0`. |
| `packages/relay/README.md` | Stale. Says hibernation is "not yet" and the relay "stores nothing"; `worker.ts` has both hibernation and a persistent op-log. |
| Harness route collision | `harness/provider.js:324` routes on `/enhanced brand content/i`, which shadows `aplus`'s stack prompt. `aplus` stage 2 is counted in the 68 without being exercised — a false green. |

### Language rules carried forward
- **"Private" is always scoped.** Never "none of your data gets shared" unqualified. The claim is:
  never shared with the app's developer or any operator; prompts go to the user's own model provider
  under their own account.
- **Never "doesn't cost extra AI tokens."** Wrapps spend the user's existing plan quota. The honest
  form is "no second bill, no API key, no markup."
- **Platform truth:** macOS plus Chrome today. Never imply Windows, Linux, or Firefox.
- **Never say a number for wrapp generation time.** It has not been measured.

---

## Four commands that reproduce the load-bearing claims

```
npm run try-team        # 23 green: sealed P2P folder sync on two isolated daemons
npm run try-team-relay  # 12 green: the relay is a plain pipe carrying only AES-256-GCM frames
npm run try-store       # the commercial gate: seats, team-scoping, byte cap, compaction, self-host bypass
npm run try-cloud       # 11 green: hosted lane off by default, fails closed on tools
```

All four exited 0 on this tree on 2026-07-25.
