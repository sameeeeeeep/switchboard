---
name: guided-cursor
description: >-
  Hand a step to the human on their Mac and get a machine-readable result back. Use whenever a task
  needs something only a person at the keyboard can do — grant an OS permission, click inside a native
  app Claude can't drive, plug in a cable, sign in, or eyeball whether something looks right — OR to run
  a guided pass/fail TEST of a GUI flow. Switchboard floats a cursor-anchored instruction chip by the
  pointer for each step; the person acts and marks pass/fail (and can attach a screenshot/note), and the
  outcome comes back as JSON. Trigger for: "walk me through…", "test this on the real app", "have the
  human grant X", "guided test", "check the notch renders", or any step that requires a human hand.
---

# Guided cursor — drive the human through steps, get a verdict back

Switchboard's menubar app runs a **CursorGuide**: a small instruction chip that floats next to the
mouse pointer, one step at a time. Any Claude session drives it through a plain file handshake — no
grants, no code, no MCP. Use it to (a) **help** a human do something Claude can't do itself, or (b)
**test** a GUI flow where a human confirms each step passed. The result comes back as machine-readable
JSON you read and act on.

This closes the GUI self-test gap: Claude scripts the steps, the app floats them by the cursor, the
human passes/fails each (⌃⌥ or the on-chip controls; **esc** aborts), and a summary returns to you.

## When to use it

- A step **requires a human hand**: granting Accessibility / Screen-Recording / mic permission,
  clicking a control in a native app Claude can't drive, entering a credential (the human enters it,
  never you), plugging something in, signing in.
- You need a human to **judge** something on screen ("does the notch widget render?", "is this the
  right colour?") and report back structured pass/fail.
- You're running a **guided test pass** of a flow and want a per-step verdict + optional
  screenshot/note feedback captured at the moment of failure.

Do **not** use it for anything Claude can already do headlessly (files, builds, harness, HTTP). It is
specifically for the human-in-the-loop boundary.

## Prerequisite

The **Switchboard menubar app must be running** — it owns the on-screen chip and watches the trigger
file. Check quickly:

```bash
pgrep -f "Switchboard|RelayMenuBar" >/dev/null && echo "app up" || echo "app NOT running — ask the user to launch Switchboard first"
```

If it isn't running, don't write the trigger — tell the user to launch Switchboard, then retry.

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

You don't guess coordinates. Capture **one** screenshot of the target screen, hand it to Claude, and
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

## Rules

- **One human action per step**, phrased as an imperative the person can follow without you.
- **Never put a secret in a step and never read one back** — if a step involves a password/key, the
  human enters it into the real app; the step just says "enter your … in the field", and you never ask
  for or log the value.
- **Honor the verdict.** `aborted` or a `fail` means it did **not** pass — say so, don't paper over it.
- **Don't spin a tight poll loop.** Wait patiently (5s+ between checks); the human is doing real work.
- If the app isn't running or no result ever lands, say so honestly and fall back to plain written
  instructions — don't pretend the guided run happened.
