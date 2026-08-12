# Switchboard — Claude Code plugin

The max-value install: **app + connector + skills as one plugin**. Add it once and any project
folder gets the whole operator loop — a self-contained task-board MCP connector plus the five
operator skills.

## What's bundled

```
plugin/
├── .claude-plugin/
│   ├── plugin.json        # the plugin manifest (name, version, author)
│   └── marketplace.json   # local-path marketplace (source "."); add <path>/plugin
├── .mcp.json              # the switchboard MCP connector (self-contained bundle; USER scope)
├── connector/
│   ├── switchboard-mcp.mjs  # ONE self-contained bundle — no node_modules, no ../ needed
│   └── build.mjs            # regenerates the bundle from packages/ via esbuild
├── hooks/
│   └── hooks.json         # Notification → notch presence card (cc-notify.py; non-fatal, exits 0)
└── skills/
    ├── adhd-pm/           # PM mode: brain-dump → deduped, decision-ready plan
    ├── spec/              # rough task → SPEC + ordered sub-tasks on the board
    ├── switchboard/       # presence layer: ask/approve/guide/notify at the notch
    ├── wrapp/             # generate / carve / compose a Switchboard wrapp
    └── task/              # /task — instant board capture without derailing the thread
```

The repo **root** also carries `.claude-plugin/marketplace.json` (source `./plugin`) so the plugin
is installable straight from GitHub — see below.

## Install

```
/plugin marketplace add sameeeeeeep/switchboard
/plugin install switchboard@switchboard
```

`marketplace add sameeeeeeep/switchboard` reads `.claude-plugin/marketplace.json` at the **repo
root**, which points `source` at `./plugin`. `install switchboard@switchboard` is
`<plugin-name>@<marketplace-name>` (both are `switchboard`).

Local path instead of GitHub? Two equivalent options:

```
/plugin marketplace add /absolute/path/to/switchboard          # repo root (source ./plugin)
/plugin marketplace add /absolute/path/to/switchboard/plugin   # the plugin's own marketplace (source .)
/plugin install switchboard@switchboard
```

The connector installs at **USER scope**: enabled once, it's available in every project folder.
Scope comes from the plugin mechanism, not from anything declared in `.mcp.json`.

## Why the connector is a bundle (the dependency story — SOLVED)

The real connector lives at `packages/switchboard-mcp/switchboard-mcp.mjs` and is **not**
self-contained in source: it imports `../bank-mcp/tasks.mjs`, six
`../../examples/apps/src/core/*.core.js` files, and three npm deps
(`@modelcontextprotocol/sdk`, `ws`, `zod`).

When Claude Code installs a plugin from a marketplace it copies **only the `plugin/` folder** into
its cache and **blocks `../` path traversal** (confirmed against the plugins reference). It also does
**not** run `npm install` for an MCP server's own dependencies. So the earlier
`${CLAUDE_PLUGIN_ROOT}/../packages/switchboard-mcp/…` reference would have been dead on any real
install — the sibling `packages/`, `examples/`, and `node_modules` are simply not in the cache.

The fix: **`connector/switchboard-mcp.mjs` is a single esbuild bundle** that inlines the entire
source closure *and* those three npm deps into one file with zero external imports. `.mcp.json`
runs it directly:

```json
{ "args": ["${CLAUDE_PLUGIN_ROOT}/connector/switchboard-mcp.mjs", "mcp"] }
```

No `node_modules` at runtime, no `../`, no lockfile, nothing to install. Verified: with the repo's
`node_modules` deleted, the bundle still boots the MCP server and the task-board tools
(add/list/complete/move/next) read and write the vault correctly.

### Regenerating the bundle

`connector/switchboard-mcp.mjs` is a **committed build artifact**. Rebuild it whenever the connector
source changes (`packages/switchboard-mcp/*.mjs`, `packages/bank-mcp/tasks.mjs`, or the
`examples/apps/src/core/*.core.js` files the registry imports):

```
npm install            # once, at repo root — provides esbuild (a devDependency)
node plugin/connector/build.mjs
```

## The default vault — "any folder will do"

`.mcp.json` invokes the connector with **no `--vault`**. It defaults its task board to
`~/SwitchboardBrain` (the user's home vault) instead of the current working directory — so the task
tools always read/write the one stable board no matter which project folder the session sits in.
An explicit `--vault`, or `$SWITCHBOARD_VAULT` / `$BANK_VAULT`, still overrides. See
`packages/switchboard-mcp/switchboard-mcp.mjs`.

## Known caveat

- **`switchboard_scaffold_wrapp` degrades outside a repo checkout.** That one tool copies an on-disk
  house template (`skills/build-a-wrapp/assets/starter`) that is *not* part of the plugin cache, so
  after a marketplace install it throws its own readable error ("house template missing … is this
  running inside the switchboard repo?"). The MCP server still boots and every other tool — the
  task-board tools and all wrapp action tools — works. Scaffolding a new wrapp is better done through
  the `wrapp` skill anyway. Making the tool work in-plugin would require vendoring the starter and a
  small change to `scaffold.mjs` (out of scope for this packaging pass).
