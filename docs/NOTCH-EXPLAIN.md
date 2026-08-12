# Notch decision cards → "Explain" mode

**Vision (founder, 2026-08-12):** today a notch decision card raises options and speaks them in Moira's voice. Add a mode where the card becomes a full **explanation** — Moira narrates the trade-off while a **diagram** shows — so the user *understands* the choice before deciding, in the style of a tech-explainer reel. The founder works away from the terminal and wants to be **taught** the decision, not just asked it.

Design-first, opt-in per card: simple asks stay one-tap; only a non-trivial decision earns an Explain.

## The storyboard

```
① a decision card is up            ② user taps "Explain"           ③ explaining…
┌───────────────────────┐          ┌───────────────────────┐       ┌───────────────────────┐
│ Which auth approach?  │          │ Which auth approach?  │       │ Which auth approach?  │
│ PICK ONE   ✦ Explain  │  ─tap→   │ PICK ONE  ⟨explaining…⟩│  ──→  │ PICK ONE  ⟨explaining…⟩│
│ [A][B][C]             │          │ [A][B][C]             │       │ [A][B][C]             │
└───────────────────────┘          └───────────────────────┘       └───────────────────────┘
        │  generate, on the user's OWN Claude (daemon claude_complete):
        │    · a trade-off DIAGRAM  (HtmlCapability.makeDiagram → HTML → PNG)
        │    · a short MOIRA SCRIPT (HtmlCapability.makeText)
        ▼
④ explained — diagram shows + Moira speaks, options resurface
┌───────────────────────────────┐
│ Which auth approach?          │
│  ┌─────────────────────────┐  │   ← the trade-off diagram becomes the card's media (zone 4)
│  │   [ effort ↑            ]│  │
│  │   [   A•   B•     ★C•   ]│  │   Moira (voiceover): "You're weighing three ways to do auth…
│  │   [        reward →     ]│  │    A is fastest but locks you in; C costs a day now but stays
│  └─────────────────────────┘  │    reversible — I'd lean C."
│ PICK ONE — UPDATES LIVE       │
│ [A]   [B]   [★C ]             │   ← options stay put; one tap (or ⌥→) picks
└───────────────────────────────┘
```

## Flow

1. **Trigger.** A decision card (a guide step with `options`) shows an **"Explain"** chip in the option-row header — only when a live explainer is wired (`CursorGuide.onExplain != nil`) and it hasn't been explained yet. Tapping it calls `CursorGuide.requestExplain()`.
2. **Generate (on the user's own Claude, through the daemon — same gate/grants).** `RelayController.explainDecision(question:options:)` fires two calls, grounded in the card's question + options:
   - **Diagram:** `HtmlCapability.makeDiagram` → Claude writes a self-contained HTML trade-off graphic (dark #000 / ink / one lime accent) → rendered offscreen to a PNG.
   - **Script:** `HtmlCapability.makeText` → a 2–4 sentence Moira voiceover that walks the trade-off and names the lean.
   They **race** — each lands when ready; neither blocks the other.
3. **Show + speak.** The diagram lands → `CursorGuide.showExplanation(media:)` sets it as the step's `media` (zone 4). The script lands → `speakGuideLine` speaks it in Moira's voice (Pocket-TTS, macOS `say` fallback).
4. **Decide.** The options never leave — the pick is still one tap (or ⌥→ on the recommended). Explain is additive, not a gate.

## States (Gate A)

| State | Behaviour |
|-------|-----------|
| No explainer wired | Chip hidden — card is exactly as before. |
| No options on the step | No chip (nothing to explain). |
| Explaining | Chip → `⟨explaining…⟩`, disabled; options still pickable underneath. |
| Diagram fails / daemon down | `explainFailed()` clears the spinner; options untouched; (a spoken line may still land, or nothing). |
| Script fails but diagram ok | Diagram shows silently — still useful. |
| Already explained | Chip hidden; the diagram + options remain; re-picking is free. |
| Step advances | `explaining`/`explained` reset — each step earns its own Explain. |

## Building blocks reused

- **Card** — the guide/presence card (`CursorGuide` options + `media` zone + `onSpeak`), same surface as the switchboard-skill decision cards.
- **Diagram** — `HtmlCapability.makeDiagram` (already powers "Diagram from clipboard").
- **Script** — `HtmlCapability.makeText` (new sibling: prompt → text via `claude_complete`).
- **Voice** — `speakGuideLine` (Moira / god-tts).

## Not yet / follow-ups

- `⌥E` keyboard shortcut (chip is the v1 trigger).
- Diagram + script currently race independently; a future version could stream the script to start speaking the moment the diagram paints.
- Caching an explanation per decision so re-opening a card doesn't regenerate.
