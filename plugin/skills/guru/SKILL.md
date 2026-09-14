---
name: guru
description: Run the Switchboard notch loop on demand for a question, decision, or test. Use when the user invokes /guru, $guru, $switchboard:guru, "guru:", "guru this", "guru reply", or "answer in guru mode". Do the work, then present the human decision or takeaway at the notch and read its answer. This is an explicit mode for the current request, independent of lifecycle hooks.
---

# Guru — the notch loop on demand

Use the existing [PM workflow](../adhd-pm/SKILL.md) and
[Switchboard presence](../switchboard/SKILL.md). This skill gives that workflow one shared name
in Claude Code and Codex; it does not implement a second connector or board.

The text after the invocation is the request. A bare invocation applies to the current request;
with no existing context, ask what to work on through the notch. Treat plain-text `/guru` and
`guru:` prefixes the same when they reach the agent, even if the host has no slash-command entry.
Use the host's skill selector for explicit discovery. Codex registers the plugin skill as
`switchboard:guru`; Claude's linked local skill is `guru`.

## Run the loop

1. **Do the work.** Understand the request, resolve what you can, and verify the result with
   appropriate evidence. Do not make the user run commands, open apps, or perform setup that
   available tools can handle. Guide only the remaining human steps.
2. **Reconcile the board.** Read the shared board before adding unfinished work. Reuse matching
   cards; record a concrete outcome, remaining scope, and any dependency. Use the shared task
   tools and the actual project/list. Do not create a task just to prove board access.
3. **Check and present.** Call `switchboard_status`; if necessary open Switchboard and re-check.
   Submit one relevant guide using `switchboard_present`, `surface:"guide"`, honest agent/task
   `source`, stable `sourceId`, and `project`. Follow the sibling skill's native step schema:
   - Decision: a notch step with 2–4 options, short details, exactly one recommendation, and `say`.
   - Approval: name the concrete action and scope; retain any separate host approval requirement.
   - Human test: a `teach` or `test` run with observable steps and honest pass/fail reporting.
   - Explanation: a short takeaway with one confirmation option, plus the freeform alternative.
   Include “or ⌥↓ to tell me in your own words.” Attach media when it clarifies the decision.
   In explicitly requested Guru mode, an explanation still gets a takeaway card.
4. **Read the answer.** Keep the returned `runId` and poll
   `switchboard_result({surface:"guide",runId})` with short, interruptible waits while doing
   independent work. Inspect both `chosenOption` and `feedback.note`; typed input overrides
   the selection. Act on the actual answer and inspect any attached image with the host tool.
   Pending, preselected, aborted, timed-out, or failed is not agreement or a passing test.
5. **Leave a short written record.** Summarize verified work and the verdict. If the user has not
   answered, say the card is pending and retain its runId. Do not claim completion of the human
   test or schedule a background poll without a request for continued monitoring.

Reuse an existing pending Guru run for this request; do not send a second card because a Stop
hook also fired. Never delete shared result files or read another run's answer. If Switchboard
cannot launch or a tool fails, report the concrete failure and continue supported work in chat.
Keep credentials out of cards and clipboard fields. A card cannot grant host/tool permissions.

The screen-aware `god.mjs guide-live` helper is a separate workflow described in the
[native protocol reference](../switchboard/references/native-protocol.md). A `/guru` request alone
does not launch another model or start screen capture.
