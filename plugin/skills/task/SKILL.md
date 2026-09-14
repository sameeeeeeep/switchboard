---
name: task
description: Quickly capture a task on the Switchboard board without starting it. Use for /task, "capture this", "add a task", "park this", or "note this for later" when the user wants a backlog record.
---

# Capture a task

Use the same Switchboard connector in Claude Code and Codex. Preserve the user's task text.
If no text was supplied, ask for it. Otherwise call `switchboard_add_task` with:

- `text`: the user's text, with the current project's tag if known (e.g. `#switchboard`).
- `status:"backlog"`: capture does not release work to an agent.
- `list`: the actual project/list, so project-filtered boards display the card.
- `epic`: only when the user specified one or the matching epic is already known.

The connector uses the shared vault and deduplicates exact captures. Read its result and confirm
in one line whether the task was added or already existed. Then return to the ongoing work.
Do not investigate, spec, claim, execute, or complete the captured task.
