# Switchboard — talk to the user through the notch (ask · approve · guide · notify)

Switchboard's menubar app runs a **CursorGuide**: a **docked instruction card** (bottom-center — it no
longer chases the cursor) with a **pointing ring** that lands on the target element, one step at a time.
Any connected agent session drives it through a plain file handshake — no grants, no code, no MCP. Use it to
(a) **help** a human do something the agent can't do itself, or (b) **test** a GUI flow where a human
confirms each step. The result comes back as machine-readable JSON you read and act on.

**Default to this for ANY testing that needs the human's real screen/hands** — don't hand the user a
wall of manual steps; fire a guided run and read the structured result back.

This closes the GUI self-test gap: The agent scripts the steps, the app docks the card + points the ring,
the human advances each (**⌥→** next/pass · **⌥←** fail · **⌥↑** back · **⌥↓** feedback · **⌥.**
collapse · **esc** aborts), and a summary returns to you. Steps mostly **auto-advance** (see `doneWhen`).

## When to use it

- A step **requires a human hand**: granting Accessibility / Screen-Recording / mic permission,
  clicking a control in a native app the agent can't drive, entering a credential (the human enters it,
  never you), plugging something in, signing in.
- You need a human to **judge** something on screen ("does the notch widget render?", "is this the
  right colour?") and report back structured pass/fail.
- You're running a **guided test pass** of a flow and want a per-step verdict + optional
  screenshot/note feedback captured at the moment of failure.

Do **not** use it for anything the agent can already do headlessly (files, builds, harness, HTTP). It is
specifically for the human-in-the-loop boundary.

## Guru with eyes — dynamic mode (closed loop)

Everything below is the **static** guide: you pre-author the steps in `guide-run.json`. There's also a
**dynamic / live** mode — *"guru with eyes"* — where God screenshots the screen, plans, then **re-sees
after every step and re-points/edits the next one** on the live screen. Use it when the flow is
multi-screen, unknown, or must adapt to what the user actually does — a printed manual can't handle a
menu that only appears *after* a click; this can. Full spec: `docs/GURU-LIVE.md` in the switchboard repo.

Trigger it (needs the daemon running + the switchboard repo's God client):

```bash
GOD_ATTACH=1 node <switchboard-repo>/examples/god/god.mjs guide-live "help me <goal>"
# GOD_DRYRUN=1 → plan + walk WITHOUT taking over the screen (a safe smoke test)
```

- **Static vs dynamic:** static (write `guide-run.json`) when you already know the exact steps; dynamic
  (`guide-live`) when it must adapt to the live screen.
- **One warm thread:** the plan + every re-see share one cached session (goal + history resident), so
  each step only adds a screenshot; the per-step re-see runs on **haiku** for speed (`GOD_GUIDE_MODEL`
  overrides the model).
- **Guidance, not automation:** it POINTS; the human clicks. An **auto** rung (guru moves the hands,
  gating only irreversible steps — the ring becomes a dot) is the next layer — see `docs/GURU-LIVE.md`.

## Prerequisite

The **Switchboard menubar app must be running** — it owns the on-screen chip and watches the trigger
file. A card written with no watcher is **silently lost** (no error path), so check **immediately before
EVERY write** — never reuse a check from earlier in the session (a `build.sh` rebuild or a quit kills the
running app without you noticing; this cost a real 25-min "no answer" that was just the app being OFF).

**If it isn't running, OPEN IT YOURSELF, then fire** — never hand the user a "please launch Switchboard"
chore for something you can do:

```bash
APP=/Applications/Switchboard.app
pgrep -f "MacOS/Relay" >/dev/null || { open "$APP"; sleep 4; }
pgrep -f "MacOS/Relay" >/dev/null && echo "app up" || echo "app FAILED to launch — tell the user, fall back to written instructions"
```

Only if it genuinely fails to launch do you fall back to plain written instructions. Two more rules that
follow from this: (1) after any `build.sh`, assume the app is down and relaunch before the next card;
(2) a freshly-launched app consumes an already-present `guide-run.json` on startup — so if you relaunch
with a pending card on disk, it will show; don't double-write it.

## The protocol (two files, in `~/.relay/`)

**In — you write `~/.relay/guide-run.json`:**

```jsonc
{
  "mode": "test",                 // "test" = pass/fail per step · "tour" = a how-to walkthrough
  "title": "Grant Accessibility", // shown as the run's name
  "steps": [
    { "id": "open-settings", "text": "Open System Settings → Privacy & Security → Accessibility",
      "hint": "the toggle list of apps" },
    { "id": "enable", "text": "Turn ON the switch next to Switchboard", "expect": "the switch is blue/on" }
  ]
}
```

- Each step needs **`text`** (alias `instruction`). Optional **`hint`** (alias `expect`) — what "done"
  looks like — and a stable **`id`** you'll match in the result.
- `mode:"test"` shows pass/fail controls and arms feedback capture (on a fail, the human can drop a
  screenshot + note). `mode:"tour"` is a plain click-through walkthrough (completed/aborted only).
- Keep each step to **one concrete action**. Order matters — they run top to bottom.

**Out — the app writes `~/.relay/guide-result.json`** when the run ends:

```jsonc
{
  "title": "Grant Accessibility", "mode": "test",
  "outcome": "completed",         // "completed" (ran to the end) | "aborted" (human hit esc)
  "startedAt": "…", "finishedAt": "…",
  "passed": 2, "failed": 0, "skipped": 0, "total": 2,
  "results": [
    { "id": "enable", "text": "Turn ON…", "verdict": "pass",
      "notedAt": "…", "feedback": { "note": "…", "screenshot": "<path or data-url>" } }
  ]
}
```

`verdict` per step is `pass` | `fail` | `skipped`. `feedback` appears only when the human attached one.

## How to run it (recipe)

1. **Clear any stale result** so you don't read a previous run:
```bash
rm -f ~/.relay/guide-result.json
```
2. **Write the trigger** (build the JSON in the scratchpad, then move it in atomically):
```bash
cat > ~/.relay/guide-run.json <<'JSON'
{ "mode": "test", "title": "…", "steps": [ { "id": "…", "text": "…", "hint": "…" } ] }
JSON
```
3. **Wait for the result** — poll for the file (the human takes as long as they take; give them room).
   Prefer a background wait so you don't block: check every few seconds, up to a generous timeout
   (e.g. 10 min), and stop as soon as `guide-result.json` exists.
```bash
for i in $(seq 1 120); do [ -f ~/.relay/guide-result.json ] && break; sleep 5; done
[ -f ~/.relay/guide-result.json ] && cat ~/.relay/guide-result.json || echo "no result yet — the human may still be going, or aborted"
```
4. **Read the outcome and act.** Parse `outcome`, `passed/failed`, and each step's `verdict`. On a
   `fail`, surface the step `text` + any `feedback.note`; if `feedback.screenshot` is a file path, read
   it to see what the human saw. Report the verdict back plainly ("2/2 passed" / "step `enable`
   failed — human noted: …") — never claim a human-gated step succeeded without a `pass` in the result.

## Teach mode (point + speak + auto-fill + local auto-advance)

`mode:"teach"` is an **addition** to `tour`/`test` — everything above still holds. Teach mode turns a
walkthrough into a hands-on driver: the chip **points at a real UI element**, can **speak** the step,
can **pre-load the clipboard** so the human just pastes, and — the key part — the runtime decides when
a step is done **locally**, with zero cloud round-trip per step, and auto-advances.

### Extra fields

The run object (`~/.relay/guide-run.json`) gains two optional top-level fields, and each step gains
five. All are optional — omit them and it's an ordinary tour/test run.

```jsonc
{
  "mode": "teach",
  "title": "Fill the new-contact form",
  "shot": { "w": 1512, "h": 982, "screen": 0 },   // pixel space every step's `point` is in
  "autoClipboard": true,                            // each step's `copy` pre-loads the clipboard
  "steps": [
    {
      "id": "focus-name",
      "text": "Click the Name field",              // alias: `instruction`
      "hint": "top of the form",                   // alias: `expect`
      "say": "Let's start with the name.",         // spoken aloud (on-device TTS)
      "point": { "x": 742, "y": 318 },             // where to point the cursor chip (shot-space px)
      "doneWhen": { "kind": "field-focused" }      // auto-advance when the field has focus
    },
    {
      "id": "fill-name",
      "text": "Paste the name (⌘V)",
      "copy": "Ada Lovelace",                       // pre-loaded onto the clipboard for this step
      "point": { "x": 742, "y": 318 },
      "doneWhen": { "kind": "field-non-empty" }     // auto-advance once the field is no longer empty
    },
    {
      "id": "fill-email",
      "text": "Click the Email field and paste (⌘V)",
      "say": "Now the email.",
      "copy": "ada@analytical.engine",
      "point": { "x": 742, "y": 372 },
      "doneWhen": {
        "all": [
          { "kind": "field-focused" },
          { "kind": "field-contains", "regex": "@" }
        ]
      }
    }
  ]
}
```

**Step fields (all optional, additive):** `say` (spoken when shown) · `point:{x,y}` (UI-element anchor
in `shot` pixel space) · `copy` (non-secret clipboard payload) · `hold` (ms to dwell before
auto-advancing) · `doneWhen` (a predicate the runtime evaluates locally).

**`doneWhen` predicates** compose with `{any:[…]}` / `{all:[…]}`; leaves name a `kind`:
`app-frontmost{bundleId}` · `window-title-matches{pattern,mode:"contains"|"regex"|"equals"}` ·
`url-host-is{host,pathContains?}` · `field-focused{}` · `field-non-empty{}` ·
`field-contains{text?|regex?}` · `element-exists{role,titleContains?,enabled?}` ·
`checkbox-state{titleContains,checked}` · `on-screen-text-appeared{text?|regex?,region?}`.

### Plan-time recipe: one screenshot → `[POINT]` tags → steps

You don't guess coordinates. Capture **one** screenshot of the target screen, inspect it with the host image reader, and
ask for `[POINT:x,y]` tags on each element you want to point at (God's-eye [POINT] tagging is
pixel-accurate to ~1px). Then:

1. Note the captured image's **pixel size** and which display it came from → declare
   `shot:{ w, h, screen }`. **Every `point` is in that image's pixel space** — not screen points, not
   CSS px. Keep all points consistent with the one `shot` you declared.
2. Turn each `[POINT:x,y]` into a step's `point`, add the `text`/`say`, and give it a `doneWhen`
   describing what "done" looks like for that element.
3. For a form-fill, set `autoClipboard:true` and give each fill-step a `copy` value.

### Local-first advance model (zero cloud per step)

Advance is decided **on the machine**, cheapest signal first — no network per step:

- **AX first.** `field-focused`, `field-non-empty`, `field-contains`, `element-exists`,
  `checkbox-state`, `app-frontmost`, `window-title-matches`, `url-host-is` all read from the
  Accessibility tree — instant, free, private.
- **One Vision OCR only when needed.** `on-screen-text-appeared` falls back to a single on-device
  Vision OCR pass, and only for the step that needs it. Never a per-step cloud call.
- **Manual advance is always available.** The human can press **fn→** (or the on-chip control) to move
  on at any time, whether or not a `doneWhen` fired — teach mode never traps them.
- **`hold`** just dwells for N ms before auto-advancing (for a "look at this" step with no predicate).

The per-step `advancedBy` field in the result (`"manual"` | `"auto"` | `"timeout"`) is additive — read
it if present to see how each step advanced; older runtimes simply omit it.

### Auto-clipboard form-fill flow

With `autoClipboard:true`:

1. As each step is shown, its `copy` value is written to the clipboard.
2. The human pastes (⌘V) into the pointed-at field — no typing, no dictation of the value.
3. The step's `doneWhen` (e.g. `field-non-empty`) detects the fill and auto-advances.
4. The **next** step's `copy` loads, and so on.
5. At run end, **the user's original clipboard is restored** — teach mode borrows the clipboard, it
   doesn't clobber it.

**Secrets are never placed for the human.** `copy` is for **non-secret helper content only** (names,
notes, boilerplate, sample values). If a field needs a password / API key / token, do **not** put it in
`copy` and do **not** auto-fill it — write a plain step that says "enter your … in the field" and let
the human type it into the real app. We place non-secret helper content; the human supplies anything
secret. (This is the same secret rule as tour/test, made explicit for the clipboard path.)

## Presence — raise a card for ANY interaction (not just testing)

The same runtime is Switchboard's **presence layer** (docs/PRESENCE.md): whenever you need the user's
attention — **a decision, an approval, a "which of these?", a heads-up** — don't bury it in a wall of
chat. Raise a card **at the notch** and read the answer back. It renders as the real **notch canvas**
(the black `NotchDropShape` drop, like God's status), clickable + keyboard, with a **provenance header**
so the user sees who's asking.

**When to use presence (default for decisions going forward):** any time you'd otherwise ask the user to
pick between options, approve something, or you have a result they should act on. Especially for
`ask`/approve/notify moments.

**Raise an `ask` (one-shot, returns the pick):**
```jsonc
{ "mode": "teach", "title": "Migration strategy",
  "source": "Claude Code · migrate-db",   // WHO is asking (shown in the provenance header)
  "project": "StayOften",                  // the project it's grounded in
  "steps": [{
    "id": "strategy", "text": "Which migration should I run on prod?", "placement": "notch",
    "options": [
      { "id": "inplace", "label": "In-place", "detail": "fastest, brief lock" },
      { "id": "bluegreen", "label": "Blue-green", "detail": "zero downtime, safe rollback", "recommended": true },
      { "id": "manual", "label": "Manual", "detail": "you run each step" }
    ]
  }] }
```
The user presses `⌥1/2/3` (or clicks — the notch card is clickable) then `⌥→` to approve; the
**⭐recommended** option is pre-selected so a single `⌥→` takes it. Read the pick from
`results[0].chosenOption` in `~/.relay/guide-result.json`.

**Presence fields (additive):** `source` + `project` (provenance header) · per-step `placement`
(`notch` clickable · `dock` · `cursor`) · options gain `detail` (one-line why) + `recommended` (⭐,
pre-selected). `⌥/` moves notch↔dock, `⌥.` collapses. An option can carry `media` (an image thumbnail).

### Freeform answer — "none of these, here's what I actually want"

The options are never a cage. On **any** `ask` card the user can press **⌥↓** to open the notch's
focused text field and **type their own answer** (↵ saves, esc discards) — the same input surface the
feedback note uses. Their text comes back as **`results[i].feedback.note`** in `guide-result.json`. So
after any ask, read BOTH: `chosenOption` (the tapped option) AND `feedback.note` (their typed override) —
if they typed something, that IS the answer, honor it over the pre-selected pick. When a decision might
not fit your options, say so in the step text: *"…or ⌥↓ to tell me in your own words."* Same secret rule:
never ask them to type a password/key into it.

### Explain with a diagram / infographic when a picture lands better

A decision card isn't limited to words. Attach an explanatory image via step-level **`media`**
(`"media": "/abs/path.png"` — file path, http url, or `{src,caption}`; also GIF) or give each **option**
its own `media` thumbnail so the user compares *pictures*, not prose. Use it whenever a diagram, a
before/after, an architecture sketch, or a small infographic explains the trade-off faster than a
sentence — options with visual differences especially. Generate the image first (the `visualize` tool →
SVG, or an image tool → PNG; save it to a real path), then pass that path as `media`. Keep it glanceable:
one clear diagram, not a dense figure — the card is small.

## Recipe: help the user fill a form (guided fill)

Turn "help me fill this form" into a guided fill — no screen-reading needed:

1. **Get the form.** Easiest: the user selects the form and **⌘A ⌘C** (copies it); God reads the clipboard
   for the field labels. (A Claude Code thread can't read the Mac clipboard — have the user paste the form
   text into chat instead.)
2. **Get the data.** God pulls the user's values from their **identity / Bank** context. A CLI thread asks
   the user (or reads a file they point at). **Never invent values; skip a field you have no data for.**
3. **Raise a teach fill-guide** — one step per field, each pre-loading that field's value on the clipboard,
   so the user just clicks the field and pastes; `doneWhen: field-non-empty` auto-advances:
```jsonc
{ "mode": "teach", "title": "Fill: contact form", "source": "God", "project": "…",
  "autoClipboard": true,
  "steps": [
    { "id": "name",  "text": "Click the Name field, then ⌘V", "copy": "Ada Lovelace",
      "doneWhen": { "kind": "field-non-empty" } },
    { "id": "email", "text": "Click the Email field, then ⌘V", "copy": "ada@analytical.engine",
      "doneWhen": { "kind": "field-non-empty" } }
  ] }
```
The "⌘V — pasted for you" cursor hint shows on each step. Secrets rule still holds: never place a
password/API key on the clipboard — write a plain "type your … here" step instead.

## Agent lifecycle hooks

The plugin bundles shared PermissionRequest and Stop hooks in `hooks/hooks.json`. Claude also
uses its Notification event for idle prompts. Codex requires the user to trust installed hooks
in its `/hooks` screen. Do not copy handlers into user hook directories or register them twice.

## Current runtime — newer capabilities (all additive; old runs still work)

- **Keys are `⌥`-based** (not `fn`, which scrolled the app): `⌥→` next/pass · `⌥←` fail · `⌥↑` back ·
  `⌥↓` feedback · `⌥M` mute · `⌥.` collapse↔pill · `esc` close. Options steps add `⌥1/⌥2/⌥3`.
- **Feedback on ANY step, any mode** — the human presses `⌥↓` to grab a screen-region + a typed/spoken
  note (not just on a test-fail). It lands in that step's `feedback:{screenshot,note}`.
- **Paste auto-advance** — a step with `"doneWhen":{"kind":"pasted"}` advances the moment the human
  presses `⌘V` (great for "paste this in" testing steps).
- **Options (A/B/C, compare + approve)** — a step can carry `options` the human picks between; `⌥1/2/3`
  previews a variant, `⌥→` approves. An option can be **media** (an image thumbnail) or a labelled swatch:
  ```jsonc
  { "id": "headline", "text": "Pick a headline",
    "options": [
      { "id": "bold",   "label": "Bold",   "media": "/path/a.png" },   // media OR
      { "id": "calm",   "label": "Calm",   "accent": "indigo" },        // a coloured swatch
      { "id": "punchy", "label": "Punchy", "accent": "pink" } ] }
  ```
  The approved variant comes back as `results[i].chosenOption` (the option `id`). *(Applying the choice
  live to the underlying work is a wrapp-side hook; the choice itself is always recorded.)*
- **Media step** — `"media": "/abs/path.png"` (or an http url, or `{src,caption}`) shows an image/GIF.
- **Durable history — read the user's PAST runs.** Every run also APPENDS to
  **`~/.relay/guide-history.jsonl`** (never deleted, unlike guide-result.json), with per-step verdicts,
  **`chosenOption`**, notes, and **durable screenshot paths** (copied out of /tmp into
  `~/.relay/guide-shots/`). To see what the user chose/saw in an earlier test, read that file:
  ```bash
  tail -5 ~/.relay/guide-history.jsonl
  ```
  This is how any later agent task — including a fresh session — recovers the user's choices +
  screenshots to "finish it next pass."

## Visual decision — show mockups, let the user DRAW their answer (vd1)

Some decisions are about how a thing should *look*, and a row of text options can't carry that. For those,
make the decision **visual-in / visual-out**: render each option as a little **mockup** shown on the notch
card, and let the user answer by **drawing on it** — circle the bit they want, cross out the bit they
don't, sketch the change — instead of only tapping a letter. It composes the ask-card (per-option `media`)
with the floating **[[whiteboard]]** (img seed → drawn PNG); the bridge between them is orchestrated by
**`scripts/visual-decision.mjs`**, so you don't wire it by hand.

Run it with a spec on stdin (or a file path as argv):

```bash
node scripts/visual-decision.mjs <<'JSON'
{ "title": "Landing hero", "question": "Which hero reads best?",
  "source": "Claude Code · landing", "project": "Switchboard",
  "options": [
    { "id": "bold", "label": "Bold", "detail": "big word, lots of space", "recommended": true,
      "svg": "<svg xmlns='http://www.w3.org/2000/svg' width='560' height='420'>…</svg>" },
    { "id": "calm", "label": "Calm", "detail": "quiet, editorial",
      "mockup": "/abs/path/to/calm.png" }
  ] }
JSON
```

- **Each option** carries either an inline **`svg`** (rasterized to a PNG via `qlmanage` — no deps — and
  square-wrapped on a dark canvas so there's no white padding) or a ready **`mockup`** image path. Add
  `bg` to set the pad colour (default brand-dark `#0e0e0e`). Keep mockups brand-correct — lime `#C8F250`
  on dark (see `relay-brand-look-lime-doto`).
- **The card** shows the mockups with your `question` + the line *"tap the closest — or ⌥↓ to open it on
  the whiteboard and draw your answer."* One ⭐`recommended` option is pre-selected.
- **The result** (JSON on stdout) is one of:
  - `{"mode":"picked","chosenOption":"…"}` — they tapped an option, no changes wanted.
  - `{"mode":"drawn","chosenOption":"…","note":"…","annotatedShot":"/…png"}` — they pressed ⌥↓, the
    whiteboard opened **seeded with that option's mockup**, they drew, and Sent; read `annotatedShot` (the
    marked-up PNG) as the decision and act on it.
  - `{"mode":"noted","chosenOption":"…","note":"…"}` — they typed a change but didn't draw; honour the note.
  - `{"mode":"aborted"}` / `{"mode":"timeout"}` — closed / never answered.

Use this whenever you'd otherwise describe a visual fork in prose: landing/UI/layout choices, "which of
these designs", before/after tweaks. For non-visual forks, the plain `ask` card above is still right.

## Rules

- **DO the steps you can DO; only guide the ones you can't.** A guided flow is for the HUMAN-necessary
  actions — approvals, credentials, physical/GUI acts only they can perform. Everything the assistant can do
  itself, it DOES inline, not as a step telling the human to do it: **open an app** (`open -a Terminal`),
  **open a website** (open it in the browser for them), **run a command** (run it via the shell — e.g.
  `wrangler login` opens the browser itself; you don't tell them to paste it), navigate, fetch, build. Reserve
  guide steps for the irreducible human bits (click Allow on an OAuth page, type a password into the real app,
  grant an OS permission, plug something in) — and for those, pre-load the clipboard per the rule below. Never
  make the human open a Terminal, open a URL, or run a command you could have run for them.
- **One human action per step**, phrased as an imperative the person can follow without you.
- **DEFAULT: pre-load the clipboard with anything the human must paste, type, OR OPEN.** Every guided /
  notch / teach step that asks them to run a command, enter a value, or **go to a website** must ship that
  exact content on their clipboard via the step's `copy` (set `autoClipboard: true` on the run, or `copy`
  per step). This is not optional polish — it is the default of every guided flow: never make the human
  hand-type a command, a value, or a URL you could put on their clipboard. **URLs/websites count**: a step
  like "open api.slack.com/apps" pre-loads that URL in `copy` (they ⌘L then ⌘V into the address bar); a
  "run this" step pre-loads the command; a "paste this config" step pre-loads the config. Say the shortcut
  in the step text ("⌘V — it's on your clipboard" / "⌘L then ⌘V for the URL"). The ONLY exception is the
  secret rule below — never place a password/API key/token; those the human types into the real app.
- **Never put a secret in a step and never read one back** — if a step involves a password/key, the
  human enters it into the real app; the step just says "enter your … in the field", and you never ask
  for or log the value.
- **Honor the verdict.** `aborted` or a `fail` means it did **not** pass — say so, don't paper over it.
- **Don't spin a tight poll loop.** Wait patiently (5s+ between checks); the human is doing real work.
- If the app isn't running or no result ever lands, say so honestly and fall back to plain written
  instructions — don't pretend the guided run happened.
