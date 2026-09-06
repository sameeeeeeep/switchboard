> Updated provider behavior: [Codex integration](CODEX.md) adds runtime-discovered Codex models,
> an explicit default in connection consent, and model pinning for each conversation. Changing a
> default affects new conversations. Disabling a pinned model pauses its conversation. These rules
> supersede earlier Claude-only routing and silent-substitution descriptions below. Disabling every
> model leaves the allowed set empty; models are never silently re-enabled as a fallback.
> [App model discovery](MODEL-DISCOVERY.md) documents BYOP 1.3 feature metadata, effective defaults,
> and live change events. Native controls now permit turning off every model in a provider group.

# Model selection — a user preference layer for God and wrapps

**Status:** design (no code yet)
**One-line:** the user decides which models Switchboard is allowed to use; deselecting a model (e.g. Fable) removes it from God, from every wrapp, and from the advertised model set — everywhere, with graceful fallback instead of hard failure.

---

## 1. Why this doesn't exist yet

Model choice today is split three ways, and none of it is the user's:

- **Wrapps hard-code a model in their action core.** e.g. `examples/apps/src/core/ideabrain.core.js:74` → `sb.complete({ … model: "sonnet" … })`; `autopilot.core.js:103/145/172` all pin `"sonnet"`; `batch.core.js` pins `"sonnet"`. The scope they request is a fixed list — `ideabrain.core.js:90` → `scope: { models: ["sonnet", "claude-haiku-4-5"] }`. The *app* picks; the user never does.
- **God picks its own vision model** from whatever is online — `examples/god/god.mjs:302` `pickVisionModel(models)` walks `GOD_MODEL → sonnet → haiku → any non-local → models[0]`.
- **The daemon advertises the raw capability set** — `packages/sidekick/src/backends/registry.ts:66` `models()` returns *every* model every healthy backend serves, with no user filter. That set flows into the connect grant (`server.ts:377`, `server.ts:745`), into God's grant (`server.ts:359` `registerNativeApp` defaults `models` to `backends.models()`), and into `capabilities().models` (`server.ts:309`).

There are two adjacent primitives already built that this design extends rather than replaces:

- **Per-origin model override** — `packages/sidekick/src/security/grant-store.ts:92` `setModelOverride()`, protocol `OriginGrant.modelOverride` (`packages/protocol/src/permissions.ts:62-65`), applied at run time in `server.ts:998` `withModelOverride()`. This is *"for THIS wrapp, run the model I chose regardless of what the app asked."* It is per-site, it already survives re-consent only while still granted (`grant-store.ts:77`), and it is the natural home for the per-surface escape hatch (§7).
- **Economy mode** — a single global `~/.relay/economy` flag (`0`/`1`). Written by the menubar (`packages/menubar/RelayMenuBar.swift:2648` `setEconomy`), read by God (`god.mjs:316` `readEconomy`, consumed inside `pickVisionModel` at `god.mjs:305`). **Today economy only influences God** — grep confirms no reference in `claude-code.ts`, the gate, or the completion path, so wrapps ignore it entirely. Economy is a *downgrade preference* ("prefer the cheaper capable model"); model selection is an *allow/deny* ("this model may not be used at all"). They compose (§6).

Known constraints this must respect (from memory + code):
- **Exact-match model grants.** `grant-store.ts:128` `allowsModel()` compares via `canonicalModel()` (`grant-store.ts:19`), folding `claude-opus-4-8 ↔ opus`, `claude-sonnet-5 ↔ sonnet`, `claude-haiku-4-5 ↔ haiku`. Any deny-list must be stored and compared in the **same canonical space**, or a user disabling "opus" won't catch a wrapp asking for `claude-opus-4-8`.
- **Local models can't do tools.** `god.mjs:297` `isLocalModel` (id contains `:` or `/`); local runners are non-multimodal here and can't drive the agentic tool loop. Substitution must never route a *vision* glance or an *agentic* turn onto a local model.
- **Hosted models never become the silent default.** `registry.ts:57` `backendFor()` refuses to resolve an omitted/unknown model to a hosted backend. The preference layer must not accidentally re-open that door.

---

## 2. The shape of the feature

Introduce one concept: the **allowed set** = *capability set* − *user-disabled set*.

- **Capability set** — the raw truth of what backends can serve right now. Stays exactly `registry.models()`. Used for gate legality and as the pool of substitution targets. Never filtered.
- **Disabled set** — a user-managed deny-list, stored in `~/.relay/models.json`. Default empty ⇒ allowed set == capability set ⇒ everything on (the founder's "defaults: all on").
- **Allowed set** — what *should* be used. Every surface that *chooses* a model consumes the allowed set; the run-time path *substitutes* any disabled request down to an allowed model before the gate.

Deny-list, not allow-list, on purpose: a newly installed Claude model (or a freshly pulled Ollama model) appears **enabled by default** without the user having to re-approve it, and the file stays tiny (usually `{"disabled":[]}`).

### Storage: `~/.relay/models.json`

```json
{ "disabled": ["opus"] }
```

- Lives beside the other daemon state in `RELAY_DIR` (`packages/sidekick/src/config.ts:15`), same directory as `economy`, `profile.json`, `cloud.json`, `grants.json`.
- **Ids stored in canonical form** (`canonicalModel()` output). The Settings UI shows friendly names (Fable / Opus / Sonnet / Haiku / `llama3:8b`) but writes canonical ids. Disabling "Fable" writes the canonical id for `claude-opus-4-8` (whatever the alias table folds it to). Ollama ids (`llama3:8b`) have no alias and pass through unchanged.
- `0600`, written through the same `writeCredential`-style path as siblings (it isn't a secret, but consistency + atomicity are free).
- **Read fresh on each use** (like `readEconomy`) so a toggle takes effect on the very next glance/completion — no daemon restart, no reconnection.

---

## 3. Read path (who loads the file)

Three readers, all pointing at the same file, mirroring how `economy` is already shared between Swift and Node:

| Reader | Where | How |
|---|---|---|
| **Daemon (Node)** | `packages/sidekick/src/config.ts` — new `loadModelPrefs(): { disabled: string[] }` | Sibling to `loadCloudConfig`. Never throws; malformed ⇒ `{ disabled: [] }`. Canonicalizes on read so comparisons are exact. |
| **God (Node)** | `examples/god/god.mjs` — new `readModelPrefs()` | Direct file read exactly like `readEconomy()` at `god.mjs:316`. God runs in its own process and already reads `~/.relay/economy` and `~/.relay/profile.json` this way. |
| **Menubar (Swift)** | `packages/menubar/RelayMenuBar.swift` — new `readModelPrefs()` / `writeModelPrefs()` | The Settings UI is the writer. Mirrors `readEconomy()`/`setEconomy()` at `RelayMenuBar.swift:682`/`2648`. |

Helper on the daemon side, shared by every filter point:

```ts
// packages/sidekick/src/backends/registry.ts (or a small models-pref module)
allowedModels(): string[]              // capability set minus disabled (canonical compare)
isAllowed(model: string): boolean
firstAllowed(candidates: string[]): string | undefined
```

Keeping `allowedModels()` on the registry means it can honor the `!hosted` and health rules already there.

---

## 4. Exact filter points

### 4a. God — `examples/god/god.mjs:302` `pickVisionModel(models)`

Add a preference filter as the **first** narrowing, before the economy/acuity ordering:

```
const prefs = readModelPrefs();
const allowed = models.filter(m => !prefs.disabled.includes(canonical(m)));
// then run the EXISTING GOD_MODEL → economy(haiku) → sonnet → haiku → non-local → [0]
// ordering over `allowed` instead of `models`.
```

- The candidate list `models` here is God's granted set (`god.mjs:746`, from `reg.models`). Filtering it means a disabled model is simply never a candidate.
- **Graceful fallback:** if filtering empties the vision-capable pool, do **not** silently fall onto a local (non-vision) model. Fall back in this order: (1) best *allowed* Claude vision model; (2) if none, keep the raw ordering but **surface a one-line spoken/toast warning** — "You've turned off every model I can see with. Re-enable one in Settings → Models." — and either degrade to text-only or no-op the glance rather than send a screenshot to a model that can't read it. See §5.

### 4b. Wrapps — `packages/sidekick/src/server.ts` completion + stream paths

The wrapp never learns the substitution — same contract as `withModelOverride`. Add a sibling step and chain it **after** the per-origin override (per-site pin wins for the models it's still allowed to pin — see precedence in §7):

```ts
// server.ts, new private method
private withModelPreference(params: CompletionParams): CompletionParams {
  const requested = params.model;                        // e.g. "sonnet" hard-coded by the wrapp
  if (!requested || this.deps.backends.isAllowed(requested)) return params;
  const sub = this.chooseAllowedSubstitute(requested);   // capability-aware (§4d)
  if (!sub) throw new ProviderError(NO_ALLOWED_MODEL, …); // §5
  return { ...params, model: sub };
}
```

Wire it into both `complete()` (`server.ts:1003-1004`) and the stream path (`server.ts` ~1047), right where `withModelOverride` is applied:

```
params = this.withModelOverride(origin, params);   // existing — per-site pin
params = this.withModelPreference(params);         // NEW — global allow/deny + substitution
const backend = this.deps.backends.backendFor(params.model);
this.deps.gate.assertCompletionAllowed(origin, params.model, …);   // sees the SUBSTITUTED model
```

Order matters: substitution runs **before** `backendFor` and **before** `assertCompletionAllowed`, so the gate validates the model that will actually run. Because the substitute is drawn from the origin's granted set (see 4c), `allowsModel()` (`grant-store.ts:128`) still passes — no widening.

### 4c. What the grant contains (the legality subtlety)

`assertCompletionAllowed` (`gate.ts:132`) rejects any model not in `grant.models`. So a substitute must be a **granted** model. Two coherent options:

- **Recommended: grant the full capability set at connect, enforce preference by substitution at run time.** `server.ts:745/787/377` keep advertising `backends.models()` into the grant. Then a wrapp that hard-requests a *disabled* model gets substituted to an *allowed-and-granted* model before the gate — passes cleanly. This exactly mirrors how `modelOverride` was designed to be "always a granted model" (`server.ts:997`).
- Rejected alternative: filter the grant down to the allowed set. Then a wrapp hard-coding a now-disabled id would fail `allowsModel()` outright, giving an ugly `SCOPE_EXCEEDED` instead of graceful substitution — the opposite of the goal.

Consumers that merely **enumerate** models (God, the panel) should read the **allowed** set so a disabled model never even appears as a choice. So: `capabilities().models` (`server.ts:309`) returns `allowedModels()`, and God's `registerNativeApp` default (`server.ts:377`) grants `allowedModels()` — God enumerates, it doesn't hard-code, so the allowed set is exactly right for it. Wrapps get the full capability set in their grant (legality), preference enforced by substitution.

### 4d. `chooseAllowedSubstitute(requested)` — capability-aware, respects the constraints

The substitute must preserve the *class of work* the requested model was doing:

1. **Same family, allowed:** prefer an allowed Claude model near the requested tier (opus→sonnet→haiku ladder over the allowed set).
2. **Vision needed** (attachments present / God glance): restrict candidates to vision-capable Claude models (never a local runner — `god.mjs:297`).
3. **Agentic needed** (`params.agentic === true`): exclude local models (they can't drive the tool loop). If the only allowed models are local ⇒ no substitute ⇒ error (§5).
4. **Never a hosted model as an implicit substitute** unless the requested model was itself hosted — keep faith with `backendFor()`'s no-silent-hosted rule (`registry.ts:57`).
5. If nothing qualifies ⇒ return `undefined` ⇒ caller raises the "everything capable is turned off" error.

### 4e. Install-time capability flip — `packages/protocol/src/store.ts:119/152`

`PresentState.models.cloud` / `.local` drive whether a wrapp's `{ kind: "model", class: "cloud"|"local" }` requirement shows **met** vs greyed (`store.ts:152` `isMet`). The menubar derives this state today (from `model.signedIn` for cloud, `ollama.up` for local). It must derive from the **allowed** set:

- `models.cloud = allowed set contains ≥1 cloud model` (not merely "signed in").
- `models.local = allowed set contains ≥1 local model` (not merely "Ollama up").

So if the user disables every cloud model, a cloud-requiring wrapp (`adpulse`, `brandbrain`) honestly shows its model rung **unmet** in the store modal, with the existing rung label — no dead spinner.

---

## 5. Edge cases

| Case | Behavior |
|---|---|
| **Deselect the only capable model (God)** | `pickVisionModel` filter empties the vision pool → spoken/toast warning, glance degrades to text-only or no-ops. Never send a screenshot to a model that can't see. |
| **Deselect the only capable model (wrapp)** | `chooseAllowedSubstitute` returns `undefined` → daemon raises a typed error `NO_ALLOWED_MODEL` (new code in `packages/protocol/src/errors.ts`, sibling to `SCOPE_EXCEEDED`). The wrapp surfaces it; the panel shows a banner: "Every model *AdPulse* can run on is turned off — re-enable one in Settings → Models." Actionable, not a stack trace. |
| **Vision vs text** | Substitution is capability-tiered (§4d.2). A disabled vision model substitutes only to another *vision* model; it will not silently drop to a text-only or local model. |
| **Agentic + only-local-allowed** | Local can't do tools → no valid substitute → `NO_ALLOWED_MODEL` with a message naming the tool loop, so the user understands *why* local isn't enough. |
| **Disable a model that a per-site override pins** | Global disable wins ("doesn't get used anywhere"). The override is invalidated the same way re-consent already prunes it (`grant-store.ts:77`): on write of `models.json`, sweep grants and clear any `modelOverride` now disabled. |
| **Re-enable a model** | Deny-list shrinks; next glance/completion sees it again. No reconnection, no re-grant needed (grant already carries the full capability set). |
| **New model appears** (Claude ships one / `ollama pull`) | Not in `disabled` ⇒ enabled by default ⇒ immediately usable and shown checked in Settings. |
| **All models disabled** | Guard in the UI: refuse to write an empty allowed set — the last enabled model can't be toggled off (greyed with "at least one model must stay on"). Belt-and-suspenders: daemon treats empty-allowed as "no preference" and warns, never bricks. |

---

## 6. Interaction with economy mode

They stack cleanly, in this precedence, most-specific first:

1. **Per-site model override** (`grant.modelOverride`) — an explicit pin for one wrapp. Wins, *if* the pinned model is still allowed (else cleared, §5).
2. **Global allow/deny** (`models.json`) — a disabled model is never used; requests to it are substituted.
3. **Economy** (`~/.relay/economy`) — *within the allowed set*, prefer the cheaper capable model.

Concretely for God (`pickVisionModel`): filter to allowed **first**, then apply the existing economy branch (`god.mjs:305`, prefer haiku) **over the allowed pool**. If the user disabled Haiku *and* economy is on, economy's "reach for Haiku" simply finds no Haiku and falls to the next allowed cheap model — the two prefs don't fight.

For wrapps: economy is currently God-only. If economy is later extended to the wrapp completion path, it becomes a second substitution pass (downgrade to cheapest *allowed*), layered after `withModelPreference`. Out of scope for the first build, but the layering is compatible.

---

## 7. Global list vs per-surface — recommendation

**Recommend: one global allow/deny list, with the *existing* per-origin `modelOverride` as the per-surface escape hatch.** Do **not** build a per-wrapp allow-list matrix.

Why:

- **It matches the founder's sentence exactly.** "Deselect Fable and it doesn't get used anywhere" is a *global* statement. A per-surface matrix would let Fable stay on somewhere, which is the thing the feature exists to prevent.
- **God is just another consumer.** It enumerates the allowed set and picks; it needs no list of its own. One global set governs God and wrapps identically — which is the whole point.
- **The per-surface knob already exists and is the right shape for the rare case.** If the user wants "run *Redline* on Opus specifically," that's `setModelOverride(origin, "opus")` (`grant-store.ts:92`) — already built, already persisted, already survives re-consent. Precedence (§6) makes it a *pin within the allowed set*, not a way to resurrect a globally disabled model.
- **Less UI, clearer mental model.** One checklist in Settings + a per-wrapp "always use ___" dropdown (existing override) covers 100% of the intent with a fraction of the surface area of an N-wrapps × M-models grid.

So the layering is: **global allow/deny (new) → per-site pin (existing override) → economy (existing).**

---

## 8. Settings UI (menubar panel)

A new **MODELS** disclosure in the Settings pane, alongside NAME / VOICE / MODE / CONNECTIONS (`RelayMenuBar.swift:1101-1111`). It reuses the model-chip vocabulary already in `modelsColumn` (`RelayMenuBar.swift:1548`, `modelChip` at `:1584`) — but the chips become **toggles**, not read-outs.

- **Layout** mirrors the dashboard `modelsColumn`: a CLAUDE CODE group (Fable/Opus, Sonnet, Haiku) and an OLLAMA group (the live `ollama.models` list). Cloud vs local is already visually distinct there (the `cpu` glyph, the indigo local signal).
- **Interaction:** each chip is a checkbox. Checked = allowed; unchecked = in `disabled`. Toggling writes `~/.relay/models.json` immediately (like `setEconomy`) and fires a toast ("Fable off — nothing will use it").
- **"Why is this greyed out" clarity** — the core UX request:
  - A model **required by an installed wrapp's capability** and currently the *last* enabled one of its class gets a small lock/asterisk and a caption: "AdPulse needs a cloud model — turn another on first." It can't be unchecked until an alternative is enabled. This is the graceful-guard from §5 surfaced *before* the mistake.
  - A model that is **offline** (backend not healthy — Ollama down, signed out) is dimmed with its existing reason string (`OLLAMA · NOT RUNNING`, `CLAUDE CODE · SIGNED OUT` at `:1558/:1569`), visually separated from *disabled-by-choice* so the two "off"s never blur. Offline ≠ disabled: an offline model keeps its checkbox state, it just can't run right now.
  - Disabled-by-choice chips render like the existing `dim` state (`modelChip(dim:)`) but with an explicit unchecked box, so the panel screenshot reads unambiguously.
- **Summary line** on the collapsed disclosure: "3 of 4 on" (matching the `disclosure(summary:)` pattern at `:1105`).
- **Economy** stays its own MODE row (`:1105`); a small caption there can cross-reference ("picks the cheapest model you've left on").

---

## 9. Phased build order

**Phase 1 — storage + daemon truth (no behavior change yet).**
1. `config.ts`: `loadModelPrefs()` / `saveModelPrefs()` reading/writing `~/.relay/models.json`, canonicalizing ids.
2. `registry.ts`: `allowedModels()`, `isAllowed()`, `firstAllowed()` (capability set minus disabled, honoring `!hosted`/health).
3. Point `capabilities().models` (`server.ts:309`) and God's grant default (`server.ts:377`) at `allowedModels()`. Keep wrapp connect grants (`server.ts:745/787`) on the full capability set.
*Verify: with an empty file, everything behaves exactly as today.*

**Phase 2 — God respects it.**
4. `god.mjs`: `readModelPrefs()` + filter inside `pickVisionModel` (§4a), with the vision-empty warning.
*Verify: disable Sonnet+Haiku, confirm God picks the remaining allowed vision model; disable all, confirm the warning + no blind glance.*

**Phase 3 — wrapps respect it (substitution + gate).**
5. `errors.ts`: add `NO_ALLOWED_MODEL`.
6. `server.ts`: `withModelPreference()` + `chooseAllowedSubstitute()` (§4b/4d), wired into `complete()` and the stream path after `withModelOverride`.
7. On `saveModelPrefs`, sweep grants and clear any `modelOverride` now disabled (§5).
*Verify: a wrapp hard-coding `model:"sonnet"` runs on the substitute when Sonnet is disabled; the gate sees the substitute; disabling every capable model yields the typed error, not a crash.*

**Phase 4 — Settings UI + honest capability flip.**
8. `RelayMenuBar.swift`: MODELS disclosure with toggle chips, last-of-class lock, offline-vs-disabled distinction, write-through (§8).
9. Derive `PresentState.models.cloud/.local` (`store.ts:119`) from the allowed set so store rungs grey honestly (§4e).
*Verify: toggles round-trip through `models.json`; a cloud-requiring wrapp shows its rung unmet when all cloud models are off; the last enabled model can't be turned off.*

**Phase 5 — polish.**
10. Economy caption cross-reference; optional future: economy as a second downgrade pass over the allowed set for wrapps (§6).

---

## 10. Files touched (summary map)

| File | Change |
|---|---|
| `packages/sidekick/src/config.ts` | `loadModelPrefs`/`saveModelPrefs` (`~/.relay/models.json`) |
| `packages/sidekick/src/backends/registry.ts` | `allowedModels`/`isAllowed`/`firstAllowed` |
| `packages/sidekick/src/server.ts` | `withModelPreference` + `chooseAllowedSubstitute`, wired at `:1003-1007` (complete) and stream path; `capabilities().models`→allowed (`:309`); God grant default→allowed (`:377`); grant sweep on prefs change |
| `packages/sidekick/src/security/gate.ts` | unchanged — validates the substituted model as-is (`:132`) |
| `packages/sidekick/src/security/grant-store.ts` | reuse `canonicalModel` (`:19`); reuse override-prune logic (`:77`) for the disable sweep |
| `packages/protocol/src/errors.ts` | `NO_ALLOWED_MODEL` |
| `packages/protocol/src/store.ts` | `PresentState.models.cloud/.local` derived from allowed set (`:119/:152`) |
| `examples/god/god.mjs` | `readModelPrefs` + filter in `pickVisionModel` (`:302`) |
| `packages/menubar/RelayMenuBar.swift` | MODELS Settings disclosure + `read/writeModelPrefs` (mirror `:682/:2648`); toggle chips off `modelChip` (`:1584`) |
