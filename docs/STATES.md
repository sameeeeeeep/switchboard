# States and guidance — the readiness ladder

_Status: **design**, written 2026-07-26. The audit findings in §8 are verified against the tree.
**Steps 1–2 of §10 have shipped** (the 404, the `Relay`→`Switchboard` copy drift, and `installedHere`
plumbed to the panel + widget); everything else is unbuilt._

Switchboard asks a stranger to install two halves, sign into a third thing, pair a fourth, and then
approve a scope — before anything happens. Every one of those is a place to lose them, and today each
surface re-derives "where am I?" independently and gets a different answer. This doc replaces that with
**one ladder, one resolver, and a set of rules about when to speak**.

The standing principle, inherited from `docs/DESIGN.md`: honesty is a design constraint. A guidance
state must never claim something it hasn't checked, and must never dead-end.

---

## 1. The ladder

Every readiness question the product can ask is one rung. They are **strictly ordered**: rung N is
meaningless until N−1 holds.

| # | Rung | Holds when | Fails as |
|---|---|---|---|
| 0 | `no-extension` | `window.claude` absent | page-only; the SDK's `RelayNotInstalled` sentinel |
| 1 | `no-app` | extension present, `installedHere === false` | never downloaded the Mac app |
| 2 | `app-asleep` | `installedHere === true`, `reachable === false` | app exists here, daemon not running |
| 3 | `unpaired` | `reachable === true`, `paired === false` | daemon up, this browser not paired |
| 4 | `signed-out` | paired, but no backend has models | **new rung — see §4** |
| 5 | `disconnected` | signed in, this origin has no grant | site hasn't been connected |
| 6 | `unmet` | connected, but the grant lacks something the app needs | **new rung — see §5** |
| 7 | `no-connector` | met, but Claude Code has no `switchboard` MCP | **new rung — the operator loop can't start; see §6** |
| 8 | `no-skills` | connector present, but the 5 operator skills are absent | **new rung — Claude Code can run a wrapp but not *operate*; see §6** |
| 9 | `ready` | — | — |

Rungs 0–6 make a wrapp _run in the browser_. The summit is not there — it is the **operator loop**: a
Claude Code session that reads the user's board, picks up a task, and runs the wrapps to clear it. That
loop needs three things present at once — the **app**, the **connector**, and the **skills** — so the
last two readiness questions live on the ladder as rungs 7 and 8. A fresh install reaches rung 6 with a
half-wired connector and zero skills, which is why "connected" today is a false summit; §6 makes the
real one reachable.

Two lanes hang off the side of the ladder rather than on it, because they are opt-in and their absence
is not a failure: **team** (off / off-ladder / hosting / joined) and **cloud** (off / keyed / entitled).
They must never block or decorate rungs 0–7.

### 1.1 One type, one derivation, three consumers

`HealthStatus` (`packages/protocol/src/health.ts`) already carries `installed / reachable / paired /
connected / reason / installedHere`. The bones are right. Three changes:

```ts
export type Stage =
  | "no-extension" | "no-app" | "app-asleep" | "unpaired"
  | "signed-out" | "disconnected" | "unmet"
  | "no-connector" | "no-skills" | "ready";

export interface HealthStatus {
  // …existing booleans stay, unchanged, for back-compat…
  /** The FIRST unmet rung. Surfaces render this and never re-derive. */
  stage: Stage;
  /** Rung 4: the daemon has at least one healthy backend with models. */
  signedIn?: boolean;
  /** Rung 6: what this origin's grant is missing. Empty when ready. */
  unmet?: UnmetNeed[];
  /** Rung 7: the `switchboard` MCP is registered in the user's Claude Code. */
  connectorPresent?: boolean;
  /** Rung 8: which of the 5 operator skills are installed under ~/.claude/skills. */
  skills?: { present: string[]; missing: string[] };
}
```

The ordinal is the whole point. It makes "show only the first unmet thing" structural rather than a
convention every surface has to remember, and it makes the three consumers incapable of disagreeing.

**Today they do disagree.** `getStatus` hands the panel `{paired, reachable, tokenRejected}`;
`widgetState` hands the widget a different shape and re-derives `reachable` inline
(`background.ts:394`); only `claude_health` returns the full ladder. `installedHere` — the bit that
exists *specifically* to separate rung 1 from rung 2 — is **never sent to the panel or the widget**.
Collapse all three onto `HealthStatus`.

---

## 2. Who owns each rung

A rung has exactly **one primary owner** — the surface that can actually resolve it. Every other
surface either stays silent or shows a one-line pointer to the owner. This is what stops four
simultaneous nags.

| Rung | Primary owner | Everyone else |
|---|---|---|
| 0–1 install | **page chip** (you are where the intent is) | panel shows the same card (it's where the toolbar lands you); widget silent |
| 2 wake | **page chip** + menubar glyph | panel: calm "asleep" card |
| 3 pair | **side panel** (the input lives there) | chip points at the panel; menubar shows the token button |
| 4 sign in | **menubar** — and it currently cannot see this (§4) | panel + chip: one line, link to instructions |
| 5 connect | **page chip** (per-origin, on the page) — framed as _"unlock the operator loop"_, not the narrow "pick up tasks you move to Todo" | panel lists the site as not-connected |
| 6 requirements | **consent sheet** at connect, then the app's own surface | panel's connector tiles carry the warning |
| 7 connector | **side panel** (it owns the Claude Code relationship) — one-line `claude mcp add switchboard …` with copy button | menubar shows an "operator loop off" dot; chip silent |
| 8 skills | **side panel** — "Install operator skills" writes the 5 dirs into `~/.claude/skills` | menubar shares the rung-7 dot until both hold |
| team/cloud | **side panel** only | never surfaced on a page |

The widget already gets this right and the reasoning is worth preserving verbatim
(`widget.ts:189-192`): it suppresses itself entirely on a fresh install because *"the chip owns
first-run."* Generalize that instinct into the table above.

---

## 3. When to speak — the quieting rules

The failure mode is not "no guidance." It is guidance that fires on arrival, fires four times at once,
or nags about rung 6 while rung 1 is unmet.

1. **One rung at a time.** Render `stage`, never a checklist of everything not yet done. The ordinal
   guarantees this.
2. **At the moment of intent, not on arrival.** A first-time visitor to a wrapp gets the page, not a
   wall. The guidance appears when they press the thing that needs the missing piece. The chip's
   just-in-time menu is the correct pattern; a greeting interstitial is not.
3. **Never a dead end.** Every state has exactly one primary action, and it is never disabled. The
   panel already holds this line — *"the button is NEVER dead"* (`sidepanel.ts:355-357`). Make it
   universal.
4. **Sticky bits beat probes for negative claims.** `relaySeen` is the model: it can only ever go from
   false to true. Never render "you don't have X" — render "we haven't seen X on this machine." True,
   reversible, and it degrades correctly when a probe is merely slow.
5. **Degrade, don't block.** A missing optional need is a quieter app, not a refusal. Only a missing
   *required* need blocks, and it blocks with a remedy.
6. **Calm words for normal states.** The existing status strip is the standard to hold: `on` /
   `pair to finish setup` / `sidekick asleep` / `not set up` — *"each string names where you are on the
   ladder, never 'offline'/'error'"* (`sidepanel.ts:206`). Amber for asleep, red only for a genuine
   mismatch (a rejected token).
7. **Say what you checked.** When guidance is inferred rather than observed — which is most of rung 6
   until §5.3 lands — say so in the same breath.

---

## 4. Rung 4: signed in — the invisible cliff

**The sharpest hole in the product.** A user can install both halves, pair successfully, see a lime
menubar glyph, a green panel and a connected chip — and the first real action fails, because Claude
Code was never signed in on that Mac.

The daemon knows. `backends/claude-code.ts:167` throws the single best remediation string in the
codebase:

> `Claude Code isn't signed in on this Mac. Open Terminal, run \`claude\`, and log in once — Switchboard runs on your own Claude.`

But it only fires **on the first completion**, and nothing upstream asks. `claude_capabilities` already
returns `models: string[]` and `backends: string[]` — an empty `models` array *is* the signal. Three
changes:

- Extension derives `signedIn = capabilities.models.length > 0` and folds it into the ladder.
- Menubar polls it and renders a distinct glyph state. Today `running` is lime regardless, so the app
  looks healthy while being unable to do anything. This is the one place a **red** state is warranted.
- The remediation string moves into the shared copy table (§7) so all three surfaces say it identically.

This rung also owns the future "no local model either" case for the `local-openai` backend.

---

## 5. Rung 6: the needs resolver

This is the Higgsfield question: *"if I have a different image connector, can the app not make use of
that? It should be categorized that way."*

### 5.1 Why it dead-ends today

An app's requirement is a **concrete tool-name string**:

```ts
// packages/protocol/src/permissions.ts:77
export interface ScopeRequest {
  models?: string[];
  tools?: string[];       // e.g. "mcp__claude_ai_Higgsfield__*"
  budgets?: Partial<Budgets>;
  contextKinds?: string[];
  reason?: string;
}
```

The requirement and the remedy are the same opaque string, so nothing can reason about it. Three
consequences, all verified:

- **The consent sheet renders tools unconditionally**, with no check that the connector exists.
  `connectorLabel()` pretty-prints `mcp__claude_ai_Higgsfield__*` → `"Higgsfield connector (all tools)"`
  identically whether or not you have it. You approve, the grant persists, and you discover the truth at
  invoke time as `{code: "unknown_tool"}` — a bare string that isn't a `BYOPErrorCode`, so no app can
  branch on it.
- **The consent sheet silently drops unavailable models.** It renders only the intersection
  (`consent-view.ts:220` iterates `body.models.available`), so a requested model you don't have simply
  vanishes from the picker. You approve a narrowed grant you never saw narrowed, and get
  `SCOPE_EXCEEDED` at the first `stream()`. Exactly the brandbrain haiku bug `docs/CAPABILITIES.md:117`
  warns about, reproduced structurally.
- **Nothing can enumerate connectors.** There is no control action for it, and claude.ai connectors are
  not in `~/.relay/mcp.json` at all — they are inherited server-side by the Agent SDK. Two wrapps already
  work around this by **asking the model to name its own connector prefix** (`adpulse.js:566`,
  `bank.js:1024`) and then throwing a plain `Error` with hand-written advice. That workaround is
  evidence the enumeration is genuinely hard — and also a viable implementation path.

### 5.2 The class taxonomy

`CONNECTORS` in `packages/extension/src/icons.ts:14` already carries a one-word `hint` per connector —
`higgsfield: "images"`, `shopify: "store"`, `figma: "design"`, `canva: "design"`. It is rendered as tile
subtext and nothing else. **Promote it to a real field, and move the table into `packages/protocol`** so
the daemon, the extension and the store cannot drift:

```ts
export type ConnectorClass =
  | "image" | "video" | "audio" | "design"
  | "store" | "ads" | "email" | "chat" | "meetings"
  | "files" | "data" | "docs" | "tasks" | "issues" | "code" | "search";
```

One connector may carry several classes (Higgsfield is `image` + `video`). Unknown connectors get no
class rather than a guessed one — an unclassified connector is a fact, a wrong class is a lie.

### 5.3 `needs` — class-level declaration, alongside `tools`

`tools` stays exactly as it is. The gate stays exact-match and fail-closed; that is the moat and this
design does not touch it. What is added is a parallel, *declarative* statement of intent that the
consent UI can reason about:

```ts
needs?: Array<{
  class: ConnectorClass;
  prefer?: string[];      // ["higgsfield"] — the app's happy path
  why: string;            // shown verbatim in the consent row
  optional?: boolean;     // absent = the app is degraded but usable
}>;
```

### 5.4 `listConnectors` — the missing primitive

A new control action. Returns what is actually available, **with an explicit honesty boundary**:

```ts
{
  local: Array<{ id, label, classes, tools: string[] }>,   // from mcp.json — enumerable, exact
  inherited: Array<{ id, label, classes }> | "unknown",     // claude.ai connectors
  checkedAt: number
}
```

`inherited: "unknown"` is the honest default until the enumeration question is solved (§9). Every
surface must handle it, and when it is `"unknown"` the UI says *"we can't see your claude.ai connectors
from here"* rather than asserting absence.

### 5.5 The three outcomes

| You have | What happens |
|---|---|
| the preferred connector | nothing. Silence is the correct UI for a met need. |
| a different connector in the same class | **the substitution offer**: _"Emote asks for Higgsfield to generate images. You have Leonardo — use that instead?"_ One click. The grant records the substitution so it is not re-asked. |
| none in the class | _"This needs an image connector."_ Name the two or three known to work, link to claude.ai → Settings → Connectors, and offer the app's own fallback if it declared one. |
| nothing enumerable (`inherited: "unknown"`) | state the uncertainty, offer to try anyway, and catch `unknown_tool` at the far end. |

**The honesty constraint that makes this real.** Substitution only *works* if the app calls its image
tool generically. An app hard-coded to Higgsfield's `generate_image` will not work against Leonardo's
differently-named tool. So: **substitution is offered only for needs the app explicitly declared**, never
inferred from a `tools` entry. Declaring `needs` is the app's promise that it can take the substitute.
Anything else would be a lie dressed as a feature.

### 5.6 Typed failure

Promote the missing-connector case out of stringly-typed limbo:

- `mcp/registry.ts:87`'s `{code: "unknown_tool"}` becomes a real `BYOPErrorCode` so apps can branch.
- `gate.ts:113` currently recovers the error class by **substring-matching its own message**
  (`.includes("allowlist")`). Return typed decisions instead; the string-match is a latent bug the moment
  any copy changes.

---

## 6. Rungs 7–8: the operator loop

**The other invisible cliff.** Rung 4 is a user who looks connected but cannot run anything. Rungs 7–8
are a user who _can_ run a wrapp in the browser but can never reach the thing the product is actually
for: **a Claude Code session that reads their board, picks up a task, and drives the wrapps to clear
it.** Today a fresh install stops one rung short of that loop with a half-wired connector and no skills,
and — exactly as with rung 4 — every surface stays green while the payoff is unreachable.

Three parts make the loop, and only the first ships on a fresh install:

- **the app** (rungs 0–6) — the wrapps and the consent broker;
- **the connector** — the `switchboard` MCP, so a Claude Code session can list the board, move a task,
  and invoke a wrapp's actions;
- **the skills** — the five operator skills (`adhd-pm`, `spec`, `switchboard`, `wrapp`, `task`) that
  teach that session _how_ to operate the board rather than merely touch it.

### 6.1 Rung 7 — `no-connector`

The connector is the switchboard MCP, registered with:

```
claude mcp add switchboard -s user -- <node> <path-to>/switchboard-mcp.mjs mcp --vault <vault>
```

It is detectable without shelling out: read `~/.claude.json` and look for a `switchboard` entry under
`mcpServers` (user scope) **or** under any `projects[<dir>].mcpServers` (project scope — how the CLI
records a `-s project` add). `claude mcp list` is the interactive cross-check. The registration also
carries the vault: an explicit `--vault <path>` in its `args`, or, absent that, the `~/SwitchboardBrain`
default. Rung 7 holds when the entry exists; it is amber (a setup step remaining), never red — nothing
is broken, the loop simply has not been wired yet.

### 6.2 Rung 8 — `no-skills`

The five skills install as directories under `~/.claude/skills`, each with a `SKILL.md`:
`adhd-pm/`, `spec/`, `switchboard/`, `wrapp/`, `task/`. Rung 8 holds only when **all five** are
present; a partial set is reported honestly as "3 of 5" rather than a bare pass or fail, in keeping
with the sticky-bits rule (§3.4) — we name what we saw, never assert absence of what we didn't check.
Missing skills degrade rather than block (§3.5): the connector alone lets a session _touch_ the board,
and each skill added lets it operate more of it.

### 6.3 The honesty boundary

The check only ever **reads** `~/.claude.json` and `~/.claude/skills`; it never edits Claude Code's
config. Wiring the connector and writing the skill dirs is a distinct, user-approved action (the
side-panel owns it, §2) — the ladder's job is only to say, truthfully, which of the three parts it can
see. `scripts/check-operator-loop.mjs` is that read-only probe as a standalone script: it prints a
✓/✗ checklist for connector, skills, and vault, and a one-line verdict — the same derivation a surface
would render, runnable from a terminal.

---

## 7. One copy table

Today the same state is described in four places in four ways, and three of them are stale. All three
per-app error mappers (`aplus.js:905`, `cartridge.js:344`, `arcana.js:515`) say *"Start the Switchboard
daemon"* — a dev instruction — while the chip says *"Open the Relay menubar app"*, and the menubar can
toast *"not installed — npm run daemon:install"* at an end user who has never seen a terminal.

Every ladder string moves into one exported table in `packages/protocol`, keyed by `Stage`, with a
`{ headline, body, action, actionUrl }` shape. The chip, the panel, the widget, the menubar and the
wrapp error mappers all render from it. A wrapp that wants its own voice overrides the headline only —
never the remedy.

This also kills the naming split: the product is **Switchboard**, the Mac app is **Switchboard.app**,
and the user-facing copy should stop saying "Relay" (`sidepanel.html:328` and the chip's
`"Get Relay for Mac"` both still do).

---

## 8. Verified defects, ranked

Everything below is confirmed against the tree at `04f3469`.

### 8.1 The download button 404s — ✅ FIXED 2026-07-26

```
https://github.com/sameeeeeeep/switchboard/releases/latest/download/Relay.dmg        → 404
https://github.com/sameeeeeeep/switchboard/releases/latest/download/Switchboard.dmg  → 200
```

The release asset was renamed at v0.2.1 (`docs/RELEASE-0.2.1.md:73`) but `connect-chip.ts:75` still
points at `Relay.dmg`, and its menu item reads `"Download Relay.dmg ↗"`. `docs/DAEMON-DISTRIBUTION.md:134`
and `docs/PORTING-AND-DEPLOY.md:52` carried the same stale name.

Fixed in all three places, plus the user-facing copy: the Mac app's `CFBundleName` has been
**Switchboard** since `f75b776`, so every string telling someone to open "Relay" named an app that is
not in their Applications folder. The chip, panel, widget and badge now all say Switchboard.

### 8.2 The rest

| # | Defect | Where |
|---|---|---|
| 2 | ✅ **FIXED** — `installedHere` never reached the panel or widget, so the panel showed **"Get the sidekick"** to people who already had it and merely hadn't started it. `getStatus`/`widgetState` now return it; the panel's conflated `freshInstall` splits into four ordered branches (never-installed / app-here-but-asleep / rejected / unpaired) and the widget suppresses only on a *true* fresh install. New preview state: `?state=asleep-unpaired` | `background.ts`, `sidepanel.ts`, `widget.ts` |
| 3 | No signed-in rung — everything reads green until the first action fails | §4 |
| 4 | Consent silently drops unavailable models → `SCOPE_EXCEEDED` later | `consent-view.ts:220` |
| 5 | Consent shows tools for connectors you don't have → `unknown_tool` at invoke time | `server.ts:566`, `mcp/registry.ts:87` |
| 6 | No `listConnectors` primitive; two wrapps ask the *model* to name its connectors | §5.4 |
| 7 | **No OS/arch detection anywhere.** The DMG is arm64-only and macOS 13+; an Intel Mac or a Windows visitor is offered the same link and it will not run | zero hits for `navigator.platform`/`userAgentData` repo-wide |
| 8 | Three per-app error mappers, all stale, none handling `SCOPE_EXCEEDED` | `aplus.js:905`, `cartridge.js:344`, `arcana.js:515` |
| 9 | The store page probes with the old shape (`"connect" in relay`) and never calls `health()`, so it cannot tell asleep from unpaired from disconnected | `home.js:724` |
| 10 | `claude_health` is absent from `capabilities.methods`, so feature-detection concludes it is unsupported | `server.ts:275` |
| 11 | Menubar shows no pairing status, no version, and can toast a dev instruction at end users | `RelayMenuBar.swift:527` |
| 12 | Gate recovers error classes by substring-matching its own message strings | `gate.ts:113` |

### 8.3 Team mode has no login

The brief assumed one. There isn't — and that is deliberate, not a gap: membership is possession of an
invite code, and Pro is a signed entitlement string that rides *inside* the invite so members inherit it
**without creating an account** (`team/crypto.ts:27-33`, `docs/CLOUD.md`). Seats are enforced by counting
live sockets precisely so that no account is needed.

So there is no page to open and no login to help with. The honest states are:

- Team Mode off → _"Share one folder with people you trust"_ → **Turn on** (works today, free)
- On, not in a team → **Host** / **Join with a code** (works today, free)
- Cloud backup wanted → **Pro** — and billing is the one piece not built (`docs/CLOUD.md`: "Stripe →
  entitlement minting" is unbuilt). The gate exists and refuses correctly; there is nothing to send a
  user to.

Design for the first two now. The third gets an honest _"not yet"_, not a login button that goes
nowhere. When billing lands, that is the moment a hosted account may enter the product — and it should
be scoped to billing alone, never to using Switchboard.

---

## 9. Open questions — do not guess

1. **Can claude.ai connectors be enumerated at all?** They are inherited by the Agent SDK from the
   user's sign-in, not held in any local file. If there is no API, the options are (a) a one-shot
   model round-trip that asks the SDK to list its own tools, cached — what `adpulse`/`bank` already do
   by hand; (b) infer from observed successful calls and stay silent otherwise. Everything in §5
   degrades gracefully to `inherited: "unknown"`, so this does not block the rest.
2. **Where does the install page live?** `docs/index.html` is a nine-line redirect; the real landing page
   is in the separate `the-last-prompt` repo. Arch detection (defect 7) has to be built *there*, which
   means this design spans two repos.
3. **Does the menubar get a channel for daemon state?** Rung 4 needs the app to hear "not signed in."
   Today it only reads files and shells `launchctl`.
4. **Universal2 or an honest refusal?** Until the DMG is universal, an Intel Mac visitor should be told
   plainly rather than handed a download that cannot run.

---

## 10. Build order

Sequenced so each step is independently shippable and nothing waits on question 1.

1. ✅ **Fix the 404** (§8.1) and the `Relay` → `Switchboard` copy drift.
2. ◐ **Unify the ladder.** Done: `installedHere` plumbed to panel + widget, fixing defect 2 — the worst
   first-run lie in the product. Still to do: add the `stage` ordinal to `HealthStatus` and collapse
   `getStatus`/`widgetState` onto the one type, so the three surfaces stop carrying three shapes.
3. **Rung 4**: derive `signedIn` from capabilities; menubar state; shared remediation copy.
4. **One copy table** (§7), retiring the three stale per-app mappers.
5. **Arch detection + honest download** on the landing page (separate repo).
6. **Typed failures** (§5.6) — small, unblocks everything downstream.
7. **`ConnectorClass` + `listConnectors`** (§5.2, §5.4) with `inherited: "unknown"` from day one.
8. **`needs` + the substitution offer** (§5.3, §5.5).
9. **Store page onto `health()`** (defect 9) — it is the surface a stranger meets first.
10. ◐ **Operator-loop rungs** (§6): derive `connectorPresent` + `skills` from `~/.claude.json` and
    `~/.claude/skills`; fold `no-connector` / `no-skills` into the ladder; give the side panel the
    "wire the connector" and "install operator skills" actions. Done: `scripts/check-operator-loop.mjs`
    — a zero-dep read-only probe that reports all three parts (connector / skills / vault) from a
    terminal, so the derivation can be verified before any surface renders it.
