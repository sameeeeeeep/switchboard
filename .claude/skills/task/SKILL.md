---
name: task
description: Quick-capture a task to the Switchboard board. Use when the user types "/task <text>" or says "capture this", "add a task", "note this for later", "park this", "record that" — anything they want written to the board WITHOUT derailing the current work. Appends ONE backlog card to the vault tasks.md and returns immediately; it does NOT start doing the task.
---

# /task — instant board capture

The user is **tossing an idea to record**, not asking you to do it now. Your ONLY job: append it to the board and confirm in one line. Do NOT investigate, plan, spec, or start the work — that happens later, when adhd-pm pulls the card during a triage pass. This exists precisely so an ADHD tangent gets *recorded and queued* instead of hijacking the current thread.

## Do exactly this

1. **The task text** = everything the user passed after `/task` (the arguments). If it's empty, ask for one line, then stop.
2. **Resolve the vault**: `$SWITCHBOARD_VAULT` if set, else `~/SwitchboardBrain`. The board is `<vault>/tasks.md`.
3. **Append one line** in the board dialect (create the file with a header if it's missing). Run this, substituting the user's text for the `TASK=` value (keep their words verbatim):
   ```bash
   VAULT="${SWITCHBOARD_VAULT:-$HOME/SwitchboardBrain}"; F="$VAULT/tasks.md"
   TASK='<the user's text, verbatim>'
   mkdir -p "$VAULT"; [ -f "$F" ] || printf '# Switchboard — tasks\n' > "$F"
   printf -- '- [ ] %s #switchboard status:backlog captured:%s\n' "$TASK" "$(date +%Y-%m-%d)" >> "$F"
   ```
4. **Confirm in ONE line**, then STOP and return to whatever was happening:
   `Captured → board (backlog): "<text>"`

## Rules

- **Always tag `#switchboard`** (the project) — it's in the append line above. The OS board view filters by project, so an untagged card is SAVED but INVISIBLE there. (If a different vault/project is in play, tag that project instead.)
- **One line in, one line out.** No wall, no questions (beyond a missing text), no starting the work.
- If the text obviously belongs to an epic (the user said "under X" or it clearly matches one), append ` epic:<name>`. Otherwise leave it plain — triage assigns the lane/epic later.
- Never mark it done, never begin it. Capture is durable *recording*, not execution.
- This is the local half of the "capture on the move" loop (see the `capture` epic on the board). The phone/notch capture paths land in the same `tasks.md`.
