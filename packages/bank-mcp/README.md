# @relay/bank-mcp — the Bank connector

An MCP server that lets **any Claude thread push to-dos into your Bank**.

Your Bank's vault is a folder of plain `.md` files you own. Three things write to it, and they all
read each other's work because it's just text:

1. the **Bank web app** (through the Switchboard consent daemon),
2. **Obsidian** (you, editing the files by hand),
3. **this connector** — a conversation in Claude Code or claude.ai.

So a coding session on a repo, a brandbrain thread, or a chat on your phone can all drop tasks
straight onto your list. No database, no API, no sync — one folder of markdown is the source of truth.

## The dialect

A task is a `- [ ] text` line. The nearest `## Heading` above it is its **list** (the Bank shows that
heading as the task's source). That's the whole contract — the same format the Bank app and Obsidian
already use. New tasks are written to `tasks.md` in the vault; listing scans every `.md` in the folder.

```markdown
# Tasks

## Relay
- [ ] Build the ClickUp-style board UI — by next week
- [ ] Wire the Bank connector into the daemon

## Errands
- [x] Buy oat milk
```

## Tools

| tool | what it does |
| --- | --- |
| `bank_add_task` | add a to-do (`text`, optional `list`, optional `due`); deduped by text |
| `bank_list_tasks` | read to-dos across the vault (`status`: open/done/all, optional `list`) |
| `bank_complete_task` | flip the first open task matching `match` to `- [x]` |

## Install

Point it at the same folder the Bank app is bound to (default `~/SwitchboardBrain`):

```sh
claude mcp add bank -- node /abs/path/to/packages/bank-mcp/bank-mcp.mjs --vault ~/SwitchboardBrain
```

Or per-project, so a repo's own to-dos live with the repo — add a `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "bank": {
      "command": "node",
      "args": ["/abs/path/to/packages/bank-mcp/bank-mcp.mjs", "--vault", "./.bank"]
    }
  }
}
```

Vault path resolution: `--vault <path>` → `$BANK_VAULT` → `~/SwitchboardBrain`. `~` is expanded.
The server only writes inside the vault folder and only ever reads/writes `.md` files.

## Test

```sh
node tasks.test.mjs   # pure task-document transforms
```
