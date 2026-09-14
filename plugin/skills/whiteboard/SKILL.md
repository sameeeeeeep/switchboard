---
name: whiteboard
description: Open Switchboard's floating editable whiteboard, seed a diagram, or receive a user's sketch and annotated screenshots. Use for /whiteboard, "let me sketch it", "open a whiteboard", or a requested drawing exchange through Switchboard.
---

# Switchboard whiteboard

Use the same native board from Claude Code and Codex. See the sibling `switchboard` skill for
[host bindings](../switchboard/references/hosts.md).

1. Check `switchboard_status`; open the installed Switchboard app if needed.
2. Call `switchboard_present` with `surface:"whiteboard"`, a `title`, honest agent/task `source`,
   stable `sourceId`, and optional `project` and `seed`. Keep the returned `runId`.
   If another board is active, preserve it; finish or close that board before starting a new run.
3. Tell the user: draw or paste screenshots, edit objects, and press Send when ready.
4. Poll `switchboard_result({surface:"whiteboard",runId})`. It reads the matching result from the
   latest send or durable history, so another task's Send cannot become your answer.
5. Open the returned absolute `result.shot` path with the host image reader. Apply the user's
   drawing to their original request. Never describe an unseen sketch.

A seed contains editable objects in world coordinates:

```json
[
  {"id":1,"t":"box","x":0,"y":0,"w":180,"h":90},
  {"id":2,"t":"text","x":15,"y":25,"txt":"Idea","size":22},
  {"id":3,"t":"box","x":280,"y":0,"w":180,"h":90},
  {"id":4,"t":"arrow","fromId":1,"toId":3,"x":0,"y":0,"x2":1,"y2":1}
]
```

Supported objects: `box`/`ellipse` with x,y,w,h; `text` with x,y,txt,size; `line`/`arrow` with
endpoints or fromId/toId bindings; `pen` with pts; `note` with x,y,w,h,txt; `img` with x,y,w,h,src.
Use stable ids for arrow bindings and a common `group` string to move related objects together.
A self-contained SVG data URL can seed a rich mockup; overlay editable labels and shapes.
The user can move/resize objects, paste screenshots, undo, and send repeatedly.

For visual decisions, show option images on a guide card first, then seed the chosen design on the
board if the user wants to draw changes. Honor typed notes over a preselected option.
