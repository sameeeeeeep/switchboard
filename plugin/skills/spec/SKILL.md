---
name: spec
description: Turn a rough task into a real SPEC and a checklist of sub-tasks on the board — then get it approved at the notch. Use when a founder drops a one-line task/idea that needs to become "the whole thing" (all states, reversibility, edges) decomposed into ordered sub-tasks a session can pick up. Triggers - "spec this", "spec it out", "turn this into a spec", "break this down", "make this a proper plan", a rough task on the board that isn't decomposed, or the task→spec→sub-tasks loop routed from the notch. Composes the switchboard connector task tools + the switchboard presence skill + adhd-pm Gate A.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Skill, mcp__ccd_session__mark_chapter, mcp__switchboard__switchboard_add_task, mcp__switchboard__switchboard_list_tasks, mcp__switchboard__switchboard_move_task, mcp__switchboard__switchboard_complete_task, mcp__switchboard__switchboard_next_task
---

# spec — a rough task becomes a spec becomes a checklist, approved at the notch

There's a gap between "add a thing" on the board and work a session can actually pick up and finish.
This skill closes it: **task → spec → sub-tasks → approve at the notch → ready to run.** It doesn't
invent new machinery — it composes what's already here (the connector's kanban task tools, the
`switchboard` presence layer, and adhd-pm's Definition-of-Done Gate A).

The whole loop, in one breath:
> Take the rough task. Think the WHOLE thing (Gate A). Split it into ordered sub-tasks in the board's
> dialect, parked in `backlog`. Raise the spec at the notch — spoken, ELI5, one-tap, ⌥↓-to-refine.
> On approve, release the sub-tasks to `todo` so any session can pick them up. Never hand back a fragment.

---

## 1 · INTAKE — what am I specc'ing?

The input is a rough task: a one-liner ("add file open/preview"), a card already on the board (grab it
with `switchboard_list_tasks`, or the top released one with `switchboard_next_task`), or a dump the
founder just spoke. Restate it as **one primary outcome in a sentence** — if you can't, that's the first
thing to resolve (raise it at the notch, §4).

## 2 · DRAFT THE SPEC — think the whole thing (Gate A)

A spec is not the task reworded. It's the **whole shape**, using adhd-pm Gate A. Keep it tight — this is
a working spec, not a document:

- **Outcome** — the one primary result, one sentence.
- **All states** — empty / first-run / loading / partial / success / error / offline /
  permission-denied / too-much-data. Name the ones that actually apply; **empty and error are where
  things rot** — never skip them.
- **Reversibility** — can the user undo it? Is there a destructive step, and is it guarded?
- **Order & edges** — what happens first, what races, what's idempotent on re-run, the weird inputs.
- **Out of scope** — one line on what this deliberately does NOT do (stops scope creep).

## 3 · DECOMPOSE — sub-tasks in the board's dialect

Turn the spec into **ordered sub-tasks**, each one concrete action a session can do and verify. Write
them in the connector's kanban dialect (the same `tasks.md` the OS board + `switchboard_next_task` read):

- **One `epic`** groups every sub-task of this spec (e.g. `epic:file-preview`) so they stay a bundle.
- **`status:backlog`** on every sub-task at first — parked, NOT yet released to agents. The founder's
  approve (§5) is what promotes them to `todo` (the deliberate "agent, go" signal).
- Order via **`blocked:<id>`** where a step genuinely depends on a prior one — don't over-serialize.
- The **spec itself** goes in the parent card's `detail` (indented lines under the card) so the "whole
  thing" travels with the work; sub-tasks are nested `- [ ]` lines / their own cards under the epic.
- Each sub-task must map to a **state or edge** from §2 — if a state has no sub-task covering it, the
  decomposition is incomplete (that's how empty/error states get silently dropped).

Write them with `switchboard_add_task` (parent card carries the spec in `detail` + `epic`; each sub-task
its own `add_task` under the same epic with `status:backlog`), or edit `tasks.md` directly in the same
dialect. Then `switchboard_list_tasks` to confirm they landed as one epic.

## 4 · RAISE THE SPEC AT THE NOTCH — approve / refine (Skill: switchboard)

Don't bury the spec in chat. Raise it as a **presence card at the notch** (`Skill: switchboard`) — the
founder's default decision channel:

- **ELI5 + spoken.** `say` the gist in plain words: *"Here's the plan for <task> — N steps. Approve to
  release it, or tell me what to change."* No jargon, no internal names.
- **Options:** `approve` (⭐recommended, pre-selected) · `revise` · optionally `drop`. Put the sub-task
  count + the one-line outcome in the card text so it's glanceable.
- **Freeform escape hatch:** the founder can **⌥↓ and type changes in their own words** — it comes back
  as `feedback.note`. If they typed something, THAT is the instruction: fold it into the spec (§2) and
  re-decompose (§3) before releasing. Read BOTH `chosenOption` and `feedback.note`.
- **A picture when it helps:** if the shape is a pipeline / before-after / dependency graph, generate a
  small diagram — and make it **part of the durable spec, not an ephemeral notch attachment**. Save the
  PNG into the vault at **`<vault>/specs/<slug>.png`** (default `~/SwitchboardBrain/specs/`), **embed it
  in the parent card's `detail`** with an Obsidian embed line `![[specs/<slug>.png]]` (renders in
  Obsidian, stays a plain pointer on the board), AND pass that **same file path as the notch card's
  `media`** so the founder sees the shape. One image, three homes: the spec, the vault, the notch.
  Author SVG → rasterize (qlmanage) → crop the padding (PIL/sips) → verify the PNG before embedding.

## 5 · RELEASE — hand it to the runners

On `approve`: promote every sub-task `backlog → todo` (`switchboard_move_task`) so it's released for
pickup. From here any Claude session — including a fresh one — calls `switchboard_next_task` to claim the
top unblocked sub-task (it moves to `doing`), does it to Definition-of-Done, and
`switchboard_move_task(column:"done")` on finish. On `revise` / a typed note: apply the change and
re-raise (§4). On `drop`: leave it parked in `backlog`, don't delete.

---

## The dialect, at a glance (so sub-tasks parse on the board)

```
- [ ] <parent task title> epic:<slug> id:<pid> status:backlog prio:<high|med|low>
      Detail: <the spec — outcome; states: empty/error/…; reversibility; order; out-of-scope>
      - [ ] <sub-task 1> id:<s1> status:backlog
      - [ ] <sub-task 2> id:<s2> status:backlog blocked:<s1>
```
`status:backlog` = parked; approve promotes to `todo`. `[x]` is Done. Keep titles token-clean (the
`status:/epic:/id:/blocked:` tokens are stripped from the displayed title).

## Self-test before handing back

- Every §2 state/edge has a sub-task covering it (no orphaned empty/error state).
- The sub-tasks actually parse in the board dialect — sanity-check with the parser
  (`node -e` against `packages/bank-mcp/tasks.mjs`) or `switchboard_list_tasks` showing them as one epic.
- The notch card round-tripped a real `chosenOption` (or a typed `feedback.note`) — never claim approval
  without it (honor the verdict, like the `switchboard` skill's rule).

This is the composed loop the founder asked for — the temporal companion to adhd-pm: PM mode absorbs the
scatter and decides; `spec` turns any one of those decisions into a runnable, approved plan. See
`relay-bank-into-os` and `relay-pm-presence-doctrine`.
