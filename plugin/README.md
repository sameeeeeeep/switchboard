# Switchboard — Claude Code plugin

The max-value install: **app + connector + skills as one plugin**. Add it once and any project
folder gets the whole operator loop — the task-board MCP connector plus the four operator skills.

## What's bundled

```
plugin/
├── .claude-plugin/
│   ├── plugin.json        # the plugin manifest (name, version, author)
│   └── marketplace.json   # makes this repo installable via `claude plugin marketplace add`
├── .mcp.json              # the switchboard MCP connector (USER scope; no --vault — see below)
├── hooks/
│   └── hooks.json         # Notification → notch presence card (cc-notify.py; non-fatal, exits 0)
└── skills/
    ├── adhd-pm/           # PM mode: brain-dump → deduped, decision-ready plan
    ├── spec/              # rough task → SPEC + ordered sub-tasks on the board
    ├── switchboard/       # presence layer: ask/approve/guide/notify at the notch
    └── wrapp/             # generate / carve / compose a Switchboard wrapp
```

## Install

```
claude plugin marketplace add sameeeeeeep/switchboard   # or a local path to this repo
claude plugin install switchboard@switchboard
```

The connector is USER scope: it's available in every project. Scope is set by how you install
(user-level), not declared in `.mcp.json`.

## The default vault — "any folder will do"

`.mcp.json` invokes the connector with **no `--vault`**. The connector now defaults its task board
to `~/SwitchboardBrain` (the user's home vault) instead of the current working directory. That's the
whole point of shipping it as a plugin: you can add it once and the task tools always read/write the
one stable board, no matter which project folder the session sits in. (An explicit `--vault` or
`$SWITCHBOARD_VAULT` / `$BANK_VAULT` still overrides.) See
`packages/switchboard-mcp/switchboard-mcp.mjs`.

## OPEN STRUCTURAL QUESTION — dedicated `plugin/` dir vs repo-as-plugin

This scaffolding puts everything under a dedicated `plugin/` directory (reversible, low-blast-radius).
There is one unresolved wrinkle worth a founder decision:

- `.mcp.json` reaches the real connector via `${CLAUDE_PLUGIN_ROOT}/../packages/switchboard-mcp/…`.
  The connector is **not** self-contained — it imports `../bank-mcp/tasks.mjs` and needs the repo's
  `node_modules` — so it can't simply be copied into `plugin/`.
- That `../` reference resolves correctly when the plugin is loaded **in place from the cloned repo**
  (local dev, or a git/path marketplace where the whole repo — packages + `node_modules` — is present).
- A **fully-isolated marketplace cache** that copies only the `plugin/` subtree would strand that
  `../` path. The clean fix is **repo-as-plugin**: put `plugin.json` at the repo root so
  `${CLAUDE_PLUGIN_ROOT}` is the repo and `${CLAUDE_PLUGIN_ROOT}/packages/switchboard-mcp/…` needs no
  `..`. That's a bigger structural move (the repo root becomes the plugin root), hence deferred to a
  founder call rather than taken unilaterally here.
