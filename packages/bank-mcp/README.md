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
| `bank_extract_project` | read ONE repo → a `project-<slug>.md` card + its open tasks onto the board |
| `bank_extract_projects` | scan a folder OF projects → a card per project (the cold-start seed) |
| `bank_extract_brand` | read a live website → a `brand-<slug>.md` card with its real palette + catalogue |

## The extractors

Both extractors are **deterministic** — they parse facts, they don't ask a model to recall them. That
is the whole design: a model handed a summarised page rendering cannot see CSS or a product catalogue,
so it invents hexes and drops the products. Parsing is also testable, which guessing is not.

**Cold start — seed the whole Bank from the folder your work already lives in:**

```
"seed my bank from ~/Documents/Projects"
```

`bank_extract_projects` walks that folder, treats any directory carrying a project marker (`.git`,
`README.md`, `package.json`, `CLAUDE.md`, `pyproject.toml`, `Cargo.toml`, `go.mod`, …) as one project,
and writes a card each. It **stops descending at the project boundary**, so a monorepo lands as one
project rather than one per package; point it at a single repo and you get just that repo. Task
syncing is off by default here — a bulk seed would otherwise add hundreds of to-dos at once.

**Brands — read one off its live site:**

```
"add nailin.it to my bank"
```

`bank_extract_brand` fetches the homepage, its same-origin stylesheets and `/products.json`, then
parses:

- **the palette**, from CSS custom properties (including Shopify Dawn's `--color-primary: 196,48,28`
  RGB-triplet form), `<meta name="theme-color">`, merchant-declared `*brand_color*` settings and inline
  SVG — ranked by how much each source implies "brand", with chrome (greys, near-white/black, `-text`
  roles, badge and shade-ramp variables) filtered out and near-duplicate shades collapsed. Every swatch
  records the variable it came from.
- **the catalogue**, from `/products.json?limit=250` (paginated — the bare endpoint returns only the
  first 30), with titles, prices, types and images.

Nothing is invented: a field the site doesn't serve is absent, not filled in. `brand.mjs` is the shared
"extraction brain" and holds the algorithm's unit tests; brandbrain carries a TypeScript port of it in
`lib/extract.ts` — keep the two in sync.

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
npm test              # all three suites
node tasks.test.mjs   # pure task-document transforms
node project.test.mjs # project structuring + the project-marker heuristic
node brand.test.mjs   # colour extraction, catalogue parsing, the published context shape
```
