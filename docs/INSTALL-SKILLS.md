# Unlock the operator loop

Switchboard's "operator loop" is the moment a plain Claude Code session — in **any** project
folder — can read your task board, pick up the next card, and work it with the same skills you use.
Two pieces make that happen:

1. **The five skills** — the operator playbook (`adhd-pm`, `spec`, `switchboard`, `wrapp`, `task`),
   installed under `~/.claude/skills/` so every Claude Code session can load them.
2. **The connector** — the `switchboard` MCP server (`packages/switchboard-mcp/switchboard-mcp.mjs`),
   which exposes the task board (default vault `~/SwitchboardBrain`) as tools like
   `switchboard_next_task` and `switchboard_add_task`.

There are two ways to install both. Use the **plugin** if you can; the **fallback script** does the
exact same thing without the plugin machinery.

---

## Primary: the plugin (two pastes)

In a Claude Code session, run:

```
/plugin marketplace add sameeeeeeep/switchboard
/plugin install switchboard@switchboard
```

The first line registers the marketplace; the second installs the `switchboard` plugin — which bundles
the skills **and** the connector (default vault `~/SwitchboardBrain`, no `--vault` flag needed). That's
the whole install. Skip to [Verify](#verify-the-loop-is-live).

---

## Fallback: the install script

If you'd rather not use the plugin (or you're working straight from a clone), run the zero-dependency
installer from the repo root:

```
node scripts/install-skills.mjs
```

It copies the five skills into `~/.claude/skills/<name>/` and **prints** the connector command. To also
register the connector in one shot, add `--connector`:

```
node scripts/install-skills.mjs --connector
```

The script is safe and idempotent — it never clobbers a skill directory that already exists (it skips
it and tells you), so re-running is harmless.

### Options

| flag | effect |
|---|---|
| _(none)_ | copy the five skills to `~/.claude/skills`, print the connector command |
| `--connector` | also run `claude mcp add switchboard -s user -- <node> <connector> mcp` |
| `--dry-run` | print what would be copied; write nothing |
| `--force` | overwrite skill dirs that already exist (default: skip them) |
| `--target <dir>` | install into `<dir>` instead of `~/.claude/skills` (for testing) |
| `--help` | usage |

### If you skip `--connector`

Run the command the script prints (it resolves absolute paths for you):

```
claude mcp add switchboard -s user -- <node-path> <repo>/packages/switchboard-mcp/switchboard-mcp.mjs mcp
```

No `--vault` is needed — the connector defaults to `~/SwitchboardBrain`. (An explicit `--vault <path>`,
`$SWITCHBOARD_VAULT`, or `$BANK_VAULT` still overrides it.)

---

## What the five skills do

| skill | one-liner |
|---|---|
| **adhd-pm** | Project-manager mode: turn a scattered brain-dump into a deduped, prioritized, decision-ready plan with a/b/c option tables and one ⭐recommended pick. |
| **spec** | Turn a rough one-line task into a real spec (all states, reversibility, edges) decomposed into ordered sub-tasks on the board, approved at the notch. |
| **switchboard** | The presence layer: raise a card at the Mac notch/cursor to ask, get an A/B/C pick, request approval, run a guided test, or notify — the answer comes back as JSON. |
| **wrapp** | Generate a new Switchboard wrapp from a one-line idea, carve a feature out of an existing app, or compose elements from several into one — off the house template. |
| **task** | Quick-capture: append one backlog card to the board and return immediately, without derailing the current work. |

> The plugin bundles the first four as the core operator set; the fallback script installs all five
> (it adds `task`, the quick-capture skill).

---

## Verify the loop is live

The operator loop is working when a fresh Claude Code session, in **any** folder, can see and pick up
your board.

1. **Skills present:** `ls ~/.claude/skills` — you should see `adhd-pm`, `spec`, `switchboard`,
   `wrapp`, and (via the script) `task`.
2. **Connector registered:** `claude mcp list` should list `switchboard`.
3. **Board reachable:** open a Claude Code session in any project and ask it to
   *"check my Switchboard board"* / *"what's my next task?"*. It should call `switchboard_next_task`
   and return a card from `~/SwitchboardBrain/tasks.md`. Drop a card first with
   *"capture this task: try the operator loop"* (the **task** skill / `switchboard_add_task`) if the
   board is empty.

When a session can read your board and pull the next card, the loop is unlocked.
