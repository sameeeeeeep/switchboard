# God — the full spec

God is Switchboard's ambient, screen-aware assistant — the same *experience* as the closed native "AI cursor" apps,
on the opposite *spine*: your own Claude (no resold keys), every action through the consent gate, open
source, and the **notch is the product**, not a bolted-on menu. God ships **inside** the menu-bar app
(pre-installed, first-party) and is also the mold third-party native apps copy.

---

## 1. Capability map (reference apps vs what we have, with status)

| # | Capability | Reference apps | God | Status |
|---|------------|--------|-----|--------|
| 1 | **Onboarding / permissions** | native cards, drag app into Accessibility list | native notch cards; AX drag-to-grant + Open | AX card ✅ · **mic + screen cards ✳️** · drag-position ✳️ |
| 2 | **Summon (hotkey)** | ⌃⌥+click | ⌃⌥+click, captures click point, arms the glow | ✅ wired (needs AX grant + relaunch) |
| 3 | **See the screen (vision in)** | screenshot → vision | ScreenCaptureKit/`screencapture` → `claude_complete(+image)` | ✅ proven pixel-accurate |
| 4 | **Think (the loop)** | model + skill + child agents | daemon: vision + persona + skill, gated agentic | ✅ single-shot · agentic ✳️ |
| 5 | **Listen (voice in)** | push-to-talk | `claude_transcribe` (Flow's spine) | ✅ in CLI · not in ⌃⌥ yet |
| 6 | **Speak (voice out)** | TTS | `say -v <persona voice>` / `claude_speak` | ✅ |
| 7 | **Second cursor** | replacement pointer | **glow behind your cursor** (presence, not hijack), state-reactive | ✅ built (visual tune pending) |
| 8 | **Mark on screen** | `[POINT]`/`[TYPE]` boxes | `[POINT:x,y:label]` → glow **halo** at the target | ✅ parse+halo · live-map ✳️ |
| 9 | **Give me text** | inserts at cursor | paste at cursor (Flow path) / clipboard | ✅ (CLI) |
| 10 | **Do anything (act)** | `[TYPE]`, clicks, computer-use fallback | gated AXPress/CGEvent/type **through the consent gate** | ❌ **the hands — not built** |
| 11 | **Open things** | opens apps/urls | semantic routes (`open` URL, Apple Events) — prefer over GUI | ❌ not built |
| 12 | **Run things** | child workers / Codex | the **wrapp connector** (NL → run a wrapp) + agentic | ✳️ connector exists, not wired to God |
| 13 | **Persona / skin** | one fixed assistant + a pet | swappable persona files (voice + characteristic + cursor) | ✅ |
| 14 | **Dictation** | — | **fold Flow in** as a God mode (⌃⌥-hold = dictate) | ✳️ Flow standalone; fold planned |
| 15 | **Dynamic canvas** | — (our idea) | notch shows generated media; **drag-and-drop out** | ❌ new — spec'd below |

✅ done · ✳️ partial/next · ❌ not started

---

## 2. The loop (one pass, end to end)

```
⌃⌥ (+click / hold-to-talk)
  → CAPTURE   screen (JPEG) + optional voice (transcribe) + clipboard + click point
  → THINK     daemon claude_complete(image, system = persona + protocol, skill), gated
  → RESPOND   text + optional [POINT:x,y:label] + optional media/action proposals
  → DELIVER   speak (persona voice) · glow halo at [POINT] · paste text / show in canvas
  → ACT       proposed writes (type/click/run) each hit the CONSENT GATE before executing
```

Everything past CAPTURE runs on the user's own Claude through the broker; every write in ACT is gated.
Screen text is treated as **untrusted data** (the model already refuses instructions embedded in a
screenshot — verified).

---

## 3. Notch states (completeness pass — every state designed)

The notch is one morphing surface, not a menu:

| State | Trigger | Looks like | Reversibility |
|-------|---------|-----------|---------------|
| **dot** | idle | small dot centered in the menu bar (lime/red/slate by health) | — |
| **working / thinking** | model running | breathing pill | ends → dot |
| **listening** | ⌃⌥ held / dictation | pulsing pill + live transcript | release → thinking |
| **canvas (result)** | God produced media/text | inline preview (image/text), **draggable out**, Save/Copy/Dismiss | Dismiss → dot; drag = copy, non-destructive |
| **full panel** | hover / click | the detailed panel (apps, models, tools, context) | hover-out / click-out closes |
| **onboarding** | a permission missing | permission card (AX drag / Screen / Mic) | × dismiss for session |
| **consent** | a native app / a God write | "Allow this app?" / "Allow this action?" drop | Deny is default-safe |

Edges: notch vs non-notch display · multi-monitor (anchor to active screen) · reduce-motion (cross-fade,
no grow) · daemon offline (dot slate, panel offers `start`) · signed-out (dot **red**, one-line fix).

---

## 4. The second cursor (glow) states

`idle` (off) · `armed` (⌃⌥ held — soft ring) · `listening` (pulse) · `thinking` (shimmer) ·
`pointing` (halo travels to the `[POINT]` target). Full-screen, **click-through**, never intercepts.
Differentiator: the reference apps hijack the pointer; God adds an **aura + a light halo** — presence, not takeover.

---

## 5. Onboarding (permissions God needs)

Three OS grants, three native notch cards, in order:

1. **Accessibility** (keys + clicks + AX actions) — no programmatic grant exists, so: **Open** the pane +
   a **draggable app chip** you drop straight into the list (the drag-in trick). Card should sit **near the
   Settings list**, not the notch, so the drag is short. `AXIsProcessTrusted()`.
2. **Screen Recording** (see the screen) — has a request API: a **Grant** button → `CGRequestScreenCaptureAccess()`.
3. **Microphone** (hear you) — request API: **Grant** → `AVCaptureDevice.requestAccess(.audio)`.

Dev caveat (loud): ad-hoc builds churn TCC identity every rebuild → the grant goes stale, **remove +
re-add + relaunch**. A signed DMG is stable. This is exactly what the concierge smooths over.

---

## 6. The hands — "do anything" (the biggest gap)

The reference apps type/clicks via a one-time Accessibility firehose. God's version:

- **Semantic routes first** (`open` a URL, an Apple Event, an MCP/connector call) — faster, reliable.
- **Pixel/AX actions last** (`AXPress`, set `AXValue`, CGEvent click/type) — and **each write hits the
  consent gate**, not Apple's blanket grant. "It can touch anything on your Mac — and it asks first,
  with an audit trail." That gate is the moat, sitting exactly where those apps cut the corner.
- **Run things** = the wrapp connector: "make me a set of ads" → God invokes the wrapp.

---

## 7. Fold Flow in

Flow (dictation) is God's sibling — same native spine, same `claude_transcribe`. Fold it in as a **mode**:
⌃⌥-hold = dictate (clean transcript pasted at cursor), ⌃⌥+click = look/help. One assistant, two gestures;
Flow stays runnable standalone.

---

## 8. Differentiators (why ours is the better shape, not a clone)

- **Your own Claude**, no resold keys.
- **Consent gate on every action** — their silent firehose is our explicit, audited prompt.
- **Open source**, one-click deploy.
- **The ecosystem** — God is the concierge to a whole wrapp store (find/run/OSS-alternatives), not a lone app.
- **The notch is the product** (dot→work→listen→canvas→panel), not a menu.

---

## 9. Status, plainly

- **Shell (notch, orb, glow, consent, onboarding card):** built; pending screenshot tuning.
- **The magic on ⌃⌥ (see → speak → point):** **wired** — spawns the proven loop attached to the daemon.
- **Listening in ⌃⌥, mic/screen onboarding cards, drag-near-Settings, glow-follows-[POINT]:** next.
- **The hands (act / open / run), agentic, the dynamic canvas, Flow fold-in:** not started — the real road ahead.
