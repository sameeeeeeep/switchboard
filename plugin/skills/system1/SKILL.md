---
name: system1
description: Fast, typed judgment ("System 1 thinking") via Switchboard's switchboard_decide tool — a System One model (hosted TypeSafe Jev via OpenRouter, or an opt-in local engine) that reads a state (text, objects, screenshots) and answers typed questions with calibrated probabilities instead of generated text. Use when a judgment must be made over MANY items (triage hundreds of grep hits, files, log lines, test failures, screenshots, candidate branches × scenarios) before spending your own context on them, or for a cheap yes/no gate. Triggers - "/system1", "system 1 this", "triage these fast", "score all of these", "classify these", "filter the grep results".
---

# System 1

You are System 2: slow, careful, expensive context. `switchboard_decide` is System 1: a
decision model that answers typed questions in one forward pass, with no generated text. Use it to **decide what deserves
your attention**, never as the final word on anything that matters.

## When it pays off

- **Volume.** 50+ items that each need the same judgment: grep hits ("does this line implement X?"),
  files ("is this relevant to the bug?"), log lines ("error that matters?"), screenshots
  ("does this screen show the bug?"), branch × scenario grids.
- **Out of the loop.** Hooks and routines where no LLM is running (e.g. a Stop hook asking "does this message need a decision?").

For a handful of items, just read them yourself. The tool call costs more than it saves.

## Calling it

```json
{
  "state": "src/auth/session.ts:88: if (token.exp < now) return refresh(token)",
  "questions": {
    "relevant": {"type": "noul", "instructions": "This line decides whether a session token has expired."},
    "kind": {"type": "choice", "instructions": "What does this line do?",
             "criteria": {"check": "checks a condition", "call": "calls another function", "data": "defines data"}},
    "risk": {"type": "score", "instructions": "How risky is changing this line?", "criteria": ["low", "medium", "high"]}
  }
}
```

- `noul` → `{"noul": p}` (probability of yes). `choice` → `{"choice", "confidence", "probabilities"}`.
  `score` → `{"score", "confidence", "probabilities"}` over the ordered levels.
- Images: put `<image:1>` in the state and pass `media: [{"type":"image","path":"/abs/shot.png"}]`.
- One call = one state. For many items, call once per item (the engine caches the questions), or pack a
  short list into one state and ask per-item `noul` questions.

## Recall: jevgrep over what the user saw

`switchboard_recall` searches the local screen journal (`~/.relay/journal`, written by the Switchboard app
while `~/.relay/journal-on` exists) by meaning: a local keyword prefilter, then System 1 scores each
candidate line. Use it for "what did X say about Y", "where did I see Z", "what was I doing Tuesday".
Phrase the query with words likely to be on screen (names, project, topic), answer from the matches, and
cite time + app. `switchboard_journal` reports status and turns recording on/off or forgets the last N
minutes — only when the user asks.

## Rules

1. **Filter, then read.** Use it to rank/cut a list, then read the survivors yourself before acting.
2. **Respect uncertainty.** `noul` between 0.3 and 0.7, or `confidence` < 0.7 → treat as unknown, not as an answer.
3. **Never gate anything irreversible on it** (deletes, sends, consent). The user decides those at the notch.
4. **Say when you used it**, e.g. "System 1 cut 412 hits to 23; I read those."
5. **Know where the state goes.** The result says which `engine` answered. `hosted` = TypeSafe Jev via
   OpenRouter: the state leaves this Mac, so never send secrets, keys, credentials or private user data,
   and send code only when the user is fine with that. Hosted takes text/objects only (no images yet).
6. **No engine?** Tell the user; don't set one up silently. Hosted: they add their own OpenRouter key as
   `OPENROUTER_API_KEY` or in `~/.relay/tool-secrets.json` under `"system1"`. Local (`packages/system1/install.sh`,
   OneJev) only makes sense on an NVIDIA box; on Apple Silicon it measured 30-45s per decision.

The engine speaks TypeSafe's `/v1/systemone` contract, so `SYSTEM1_URL` can point at any compatible
server (Kev, Von, a GPU box running OneJev) without changing callers.
