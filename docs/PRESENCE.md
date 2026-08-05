# Presence — how Claude gets your attention on this Mac

The guided cursor, generalized. It was never really about testing — it's a **system-wide surface where any Claude can get your attention, present options + media, and get a real answer back**, placed at the **notch**, the **cursor**, or **docked**. Guided testing is one lens; approvals, questions, notifications, and ambient nudges are the rest.

Builds on [GUIDE-CARD-SPEC.md](GUIDE-CARD-SPEC.md) (same card, states, dot-matrix, tokens). Runtime: `packages/menubar/CursorGuide.swift`.

> **The one-line pitch vs. the alternatives:** `claude-sounds` hooks Claude Code's `Elicitation` / `PermissionRequest` / `Stop` events and plays a **beep**. Presence hooks the *same* events and shows the **actual question at your notch with clickable options, then carries your answer back**. Same trigger; a doorbell vs. a receptionist. (We can play the beep too — it's one optional line.)

---

## 1. Three shapes, one card

| Shape | What it is | Returns |
|---|---|---|
| **ask** | one-shot: a question + options (A/B/C) or approve/deny | the chosen option / verdict |
| **guide** | the multi-step walkthrough we already have (tour/teach/test) | per-step verdicts + choices |
| **notify** | fire-and-forget with optional action buttons ("Open / Save / Dismiss") | which action (or dismissed) |

All three are the **same card**; they differ only in step count + whether they block. `ask` = a 1-step `guide` with options + a synchronous return. `notify` = an `ask` the user can ignore (auto-dismiss).

## 2. Placement (the new axis)

A card can live in three places; the user configures a default, a step/ask can override, and it can be moved live.

| Placement | Where | Interaction | Best for |
|---|---|---|---|
| **notch** ⭐ | fixed, top-center under the notch | **CLICKABLE** (fixed position → real buttons) **and** keyboard | asks, approvals, notifications — anything you'll click |
| **dock** | fixed, bottom-center | keyboard (`⌥→` etc.) | reading-heavy walkthroughs |
| **cursor** | rides the pointer (opt-in only) | keyboard | rare free-roam "look here" steps |

- **Why notch is special:** it doesn't move, so its options/buttons can be **clicked** — the thing a cursor-following card never could. This is the resolution of the whole click-vs-key saga: at the notch you click; elsewhere you use keys.
- **`⌥/` toggles notch ↔ dock** live. **`⌥.`** collapses to a pill (either place). Keyboard (`⌥→/←/↑/↓`, `⌥1/2/3`) works in every placement, so a card is never *only* clickable.
- **Smart default:** a step that **points** at a target → sits near the ring; an **ask/approval/notify** → **notch** (clickable); a reading walkthrough → **dock**. Global pref in Settings: *Smart · Notch · Dock*.

## 3. Who can raise a card (triggers)

- **Claude Code** — hook its `Elicitation` (Claude is asking you), `PermissionRequest`, `Notification`, and `Stop` events → raise an `ask`/`notify` at the notch. This is where `claude-sounds` beeps; we ask instead.
- **A wrapp** — `window.claude` → `ask({title, options, placement?})`, awaits the choice.
- **God** — mid-conversation decisions, "which of these?", approvals.
- **A background task / routine** — "done — [Open]"; a fork that needs your call instead of stalling.

All route through one daemon verb + the same file handshake the guide already uses.

## 4. Return contract

Every raise returns a structured result to its caller (and appends to `~/.relay/guide-history.jsonl`):
`{ shape, answer: <optionId | "approve" | "deny" | "dismiss">, note?, screenshot?, dismissed?, at }`. Synchronous for the connector/`window.claude` caller; also readable later by any thread.

## 4b. Presentation (notch canvas · readability · provenance)

- **At the notch it IS the notch canvas.** Render with `NotchDropShape` — the same silhouette God's status drop + the panel use — so the surface **descends from the notch and blends in**, not a separate floating rounded card. (dock/cursor placements keep the rounded card; only `notch` uses the drop silhouette.)
- **Readability — the question is ink, never purple.** The question/instruction is plain `ink` at display weight. **Indigo is reserved for the local/project marker only** (the `◆` chip), never body text or the whole card border. Lime = action/selected; danger = failure. A dense question still uses the lead-line + dimmer-detail split.
- **Provenance header — who's asking (comprehensive).** Every presence card names its source so the user knows what they're answering:
  `⌘ Claude Code · migrate-db` · `◆ StayOften` — i.e. **the thread/agent** (Claude Code / a wrapp name / God) **and the project** it's grounded in. A wrapp shows its icon + name; a background task shows its label. Unknown source → shown as clearly-unknown, never guessed.
- Result: you can tell at a glance *who wants what, in which project*, and act — no mystery prompts.

## 5. Urgency + queue (presence-specific states)

- **ambient** — a soft nudge; auto-dismisses after N s if ignored; no sound. (Ambient-mode suggestions.)
- **normal** — waits for you; a single soft chime on appear (optional, off by default).
- **blocking** — the caller is genuinely stuck (a permission); stays until answered; can't be ambient-dismissed.
- **Queue:** if a second card is raised while one is up, it **queues** (one presence surface at a time); the pill shows "＋1". Never two cards at once.

## 6. Sound (the claude-sounds feature, subsumed)

Optional, per-urgency: a single soft chime (`NSSound`) when a `normal`/`blocking` card appears; silent for `ambient`. Off by default, toggle in Settings → Guided help. This makes Presence a strict superset of a sound-only notifier.

## 7. States & edges

Inherits everything in GUIDE-CARD-SPEC §6–7 (permission strip, dock-flip, collapse, reduce-motion, media/options loading+fail, multi-monitor). Presence adds:
- **No answer needed** (`notify`) → auto-dismiss after its timeout; records `dismissed:true`.
- **Queued** → next card appears when the current one resolves.
- **Clickable-notch hit-testing** — only the card's own rectangle is interactive; everywhere else stays click-through so the app underneath is never blocked. Keyboard remains a full fallback in case a click is ever swallowed.
- **Caller gone** — if the raising thread dies, the card still resolves locally and the result is written (a late reader can pick it up).

## 8. MVP scope (build now)

1. **Placement** — `notch | dock | cursor` on the run/ask + smart default + **`⌥/` toggle** notch↔dock. *(dock + cursor already exist; add notch + the toggle.)*
2. **Notch = clickable** — hit-testable card at the notch (bounded rect; rest stays click-through); buttons for the primary actions + options.
3. **`ask` shape** — a 1-step options/approve card that returns the choice (it's a 1-step guide today; add the `notify` auto-dismiss + `ask` framing).
4. **Optional chime** on appear.
5. **Claude Code hook** — a settings.json `Notification`/`Elicitation` hook → raise a notch card (the headline demo: this CLI starts asking through the notch).

Deferred: the full `window.claude.ask` connector verb + God integration + the queue UI polish.
