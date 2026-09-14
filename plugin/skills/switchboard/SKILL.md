---
name: switchboard
description: Use the local Switchboard Mac app for notch questions, decisions, approvals, guided human steps, progress notifications, and drawing feedback. Use when the user requests Switchboard, notch interaction, a guided walkthrough, or an established Switchboard PM/PIP workflow needs their input.
---

# Switchboard presence

Claude Code and Codex use the same connector, native surfaces, and vault. Discover the
`switchboard_*` MCP tools by their suffix; the host adds its own namespace.
See [host bindings](references/hosts.md) for host-specific tools and installation boundaries.

## Questions and guided steps

1. Call `switchboard_status`. If the app is down, open the installed Switchboard app and re-check.
   Use `open -a Switchboard` or the verified app path. If launch fails, explain the failure and use chat.
2. Call `switchboard_present` with `surface:"guide"`, a short `title`, honest `source`
   (such as `Codex · landing`), stable task/session `sourceId`, `project`, and `steps`.
   For a question use `mode:"teach"` and a step like:

   ```json
   {
     "id": "layout",
     "text": "Which layout? Or ⌥↓ to answer in your own words.",
     "placement": "notch",
     "options": [
       {"id":"a","label":"Spacious","detail":"More room to read","recommended":true},
       {"id":"b","label":"Compact","detail":"More items visible"}
     ]
   }
   ```

3. Keep the returned `runId`. Poll `switchboard_result({surface:"guide",runId})` with short,
   interruptible waits while doing independent work. The native app stores each guide's result separately.
   Do not clear global result files or infer an answer from another task's card.
4. Read the outcome and each step's `chosenOption` **and** `feedback.note`. A typed note overrides
   a selected option. Submitted, pending, aborted, timed-out, or preselected means no approval.
   Inspect attached images with the host image reader before using them.

Do the work you can perform yourself. Use guided steps for actions that need the human:
credentials in the real app, OS permissions, physical actions, or visual judgment. A notch choice
cannot satisfy a host security approval that must be completed in the host's own interface.
Never place credentials in cards or clipboard fields. Use a step's `copy` and run-level
`autoClipboard:true` for non-secret text the user actually needs to paste.

For speech, images, native `doneWhen` predicates, point coordinates, diagrams, and detailed
step schemas, read the relevant section of [native protocol](references/native-protocol.md).
Those are the same existing Switchboard payloads passed through `switchboard_present`.
The protocol reference includes legacy file examples; prefer MCP submission and per-run results.
For daemon-driven cursor guidance use the existing `guide_run` tool and its native consent flow.
Dynamic God/Guru guidance additionally needs the repo helper documented in the reference.

## Notifications, PIP, and drawings

- Use `switchboard_notch({kind,text,source,project})` for a short progress event. Check `fired`;
  a failed delivery is not a displayed notification.
- Use `switchboard_pip({active:true|false})` when the user enables/disables the persistent feed.
  Follow the sibling `pip` skill for the ongoing workflow.
- Use the sibling `whiteboard` skill for editable drawings and annotated screenshots.
- Use sibling `guru`, `task`, `spec`, `adhd-pm`, `handoff`, and `wrapp` skills for their named workflows.

Do not schedule background polls just because a result is pending. If the user asked for continued
monitoring or PIP follow-up, use the host scheduler, retain the runId, and stop it after the answer
or the agreed limit. Otherwise preserve the pending run for the next interaction.
