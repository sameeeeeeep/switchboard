---
name: whiteboard
description: Open a floating whiteboard the user draws on and sends STRAIGHT to Claude — no /screen. Use when the user types "/whiteboard", or says "let me sketch it", "I'll draw the layout", "open a whiteboard", "wireframe this", "let me show you the layout" — anything where a quick drawing/annotated screenshot would beat describing it in words. Claude triggers it, the user sketches (draw tools + paste screenshots + move/edit objects + keyboard shortcuts), hits Send, and this skill polls and fetches the PNG itself.
---

# /whiteboard — sketch it, don't describe it

A quick drawing surface the user opens to **show** Claude a layout instead of typing paragraphs about it.
Claude triggers `/whiteboard`; the user draws a wireframe and/or **pastes screenshots** to annotate, moves
and edits objects, then hits **Send** — and this skill **polls + fetches the image itself** (no `/screen`).

The text after `/whiteboard` (if any) is what it's for — hold it and apply it once the sketch lands.

## Do this

1. **Pick a runId and clear any stale result:**
   ```bash
   RUN=$(date +%s); rm -f ~/.relay/whiteboard-result.json
   ```
2. **Start the server** (serves the board + receives the Send; idempotent — exits quietly if already up):
   ```bash
   node examples/whiteboard/server.mjs 8902 "$RUN" >/tmp/whiteboard-$RUN.log 2>&1 &
   sleep 1
   ```
   (Path is relative to the relay repo root. In this worktree:
   `/Users/sameeprehlan/Documents/Projects/relay/.claude/worktrees/pip-dismiss-thread-filter-a1dd79/examples/whiteboard/server.mjs`.)
3. **Open the board** so the user can draw — open it in the browser pane AND give them the URL so they can
   pop it into its own window and float it wherever, next to their reference:
   `http://localhost:8902/?run=$RUN`
   Tell them: **draw the layout · click an object to move/resize · ⌘V pastes a screenshot · Send when ready**
   (tools: V select · P pen · R box · L line · A arrow · T text; ⌘Z undo, Delete, ⌘↵ send, ⌘S save PNG).
4. **Poll for the sketch** — patiently (they're drawing); stop as soon as the result lands. Multiple sends
   are fine — each overwrites `whiteboard-result.json` with the newest and appends to the history log:
   ```bash
   for i in $(seq 1 120); do [ -f ~/.relay/whiteboard-result.json ] && break; sleep 3; done
   cat ~/.relay/whiteboard-result.json 2>/dev/null || echo "no sketch yet"
   ```
5. **Read the PNG and act.** The `shot` field is an absolute path — **Read that image** so you actually see
   it, then build/answer using the `/whiteboard` args + what's drawn. Never describe a sketch you didn't Read.
   ```bash
   python3 -c 'import json;print(json.load(open("'$HOME'/.relay/whiteboard-result.json"))["shot"])'
   ```

## Claude draws the base (seed a starting board)

You can **pre-draw** a board the user then edits — the bidirectional half. On the **native** floating board,
add a `seed` array to `~/.relay/whiteboard-run.json`: board objects that load as fully **editable** items
(fresh ids, arrow bindings remapped), fit into view, undoable to blank (⌘Z). The user tweaks and Sends it back.

```jsonc
{ "active": true, "runId": "1699…", "source": "Claude Code · /whiteboard",
  "seed": [
    { "id": 1, "t": "box",   "x": -260, "y": -50, "w": 180, "h": 90 },
    { "id": 2, "t": "box",   "x":  180, "y":  70, "w": 180, "h": 90 },
    { "id": 3, "t": "text",  "x": -245, "y": -15, "txt": "idea",    "size": 22 },
    { "id": 4, "t": "text",  "x":  200, "y": 105, "txt": "shipped", "size": 22 },
    { "id": 5, "t": "arrow", "x": 0, "y": 0, "x2": 1, "y2": 1, "fromId": 1, "toId": 2 }
  ] }
```

Object dialect (world coords; `color` optional, defaults to lime): `box`/`ellipse` = `{x,y,w,h}`;
`text` = `{x,y,txt,size}`; `line`/`arrow` = `{x,y,x2,y2}` **or** bind endpoints to nodes with
`fromId`/`toId` (referencing other seed `id`s — the arrow then sticks to those shapes' borders and follows
when the user moves them); `pen` = `{pts:[{x,y},…]}`. Give nodes stable `id`s so `fromId`/`toId` resolve.
Skip `img` (needs local pixels). Compose a diagram, write it as `seed`, then poll for the Send as usual.

## Recover a missed send

Every send also appends to **`~/.relay/whiteboard-history.jsonl`** (never deleted). If `whiteboard-result.json`
got clobbered by another session, recover the latest shot from the log:
```bash
tail -1 ~/.relay/whiteboard-history.jsonl | python3 -c 'import sys,json;print(json.load(sys.stdin)["shot"])'
```

## Rules

- **The shot path is the payload — Read it before acting.** Never claim to see a sketch you didn't Read.
- **Send is non-destructive** — the user keeps editing and can send again; re-poll for the newer shot.
- **Don't spin a tight poll loop** — 3s+ between checks; the user is drawing.
- If the server never starts or nothing ever lands, say so honestly and fall back to **Save PNG** (the board's
  ▤ button downloads a `whiteboard.png` the user can attach) — don't pretend a sketch arrived.
- This is the fast, HTML-served V1. The **native floating overlay** (PIP-style, draggable above all Spaces,
  triggered by `~/.relay/whiteboard-run.json`) is the fast-follow — board epic `whiteboard`.
