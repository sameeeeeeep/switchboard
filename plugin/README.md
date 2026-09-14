# Switchboard operator integration

One connector and one set of nine skills serve **Claude Code and Codex**. Both operate the same
Switchboard app, native notch/whiteboard protocol, and `~/SwitchboardBrain` vault.

From a checkout:

```sh
npm run operator:install
```

The installer links Claude's operator skills and legacy hook paths to this source, preserves its
existing Switchboard MCP registration, and installs this directory as one Codex plugin from the
personal marketplace. Old Switchboard skill/hook files are backed up under
`~/.relay/integration-backups/`. Unrelated configuration is preserved. Re-running is idempotent.
Use `-- --client codex` or `-- --client claude` to select a host, or `-- --dry-run` to review changes.

Codex uses `~/plugins/switchboard` as a link to this directory and an entry in
`~/.agents/plugins/marketplace.json`. It gets skills through the plugin only: do not additionally
copy them into `.agents/skills` or register a second standalone `switchboard` MCP. Codex maintains
its own installation cache; that cache is a generated copy, not a separate source to edit.
Start a new Codex task after installation. Review/trust the plugin's hooks in Codex's `/hooks` UI;
installation does not automatically trust lifecycle hooks. Tools and skills work independently.

Claude's marketplace installation is also supported:

```text
/plugin marketplace add sameeeeeeep/switchboard
/plugin install switchboard@switchboard
```

Use one installation route per host. The checkout installer detects an enabled Claude plugin and
avoids adding a standalone duplicate. Repo `.claude/skills/*` entries are discovery symlinks to the
canonical skills here, not separately maintained copies.

## Shared source

- `skills/`: adhd-pm, guru, handoff, pip, spec, switchboard, task, whiteboard, wrapp.
- `.mcp.json`: canonical stdio configuration, with real-daemon mode. The build generates portable
  `mcp.json` with OpenAI path variables; both start the same `connector/launch.sh`. The launcher
  finds Node on PATH or in the installed Switchboard app.
- `connector/switchboard-mcp.mjs`: self-contained build of `packages/switchboard-mcp/`, including the
  canonical wrapp starter. No runtime dependency on the checkout or node_modules.
- `hooks/hooks.json`: shared PermissionRequest and Stop hooks; one implementation per handler.
- `.claude-plugin/plugin.json`: Claude metadata and its idle Notification event mapping.
- `.codex-plugin/plugin.json`: authored Codex metadata; the build generates portable root
  `plugin.json` from it. Codex discovers the shared skills and portable MCP config from that root.

The connector exposes 23 tools: ten actions from six wrapps, scaffolding, daemon-guided runs,
seven task/progress tools, and four native presence tools. `switchboard_present` submits a guide or
whiteboard, `switchboard_result` reads exactly that run, `switchboard_status` inspects readiness,
and `switchboard_pip` toggles the native feed. No provider-specific duplicate implementations.

Wrapp calls still use Switchboard's existing grants and selected provider. Connecting an agent
never grants a wrapp new capabilities. The native app must be running for visible surfaces.
The `guru` skill runs the existing PM/notch loop on demand. In Codex, select `switchboard:guru`
from the skill picker (CLI: `$switchboard:guru`); Claude's linked skill remains `/guru`.
Plain-text `guru:` or `/guru` also triggers the workflow when passed to the agent. There is no
separate custom-command copy. The screen-aware God/Guru helper and in-repo wrapp authoring require their existing repo
helpers; the plugin does not bundle a second daemon or computer-control implementation.

## Build, test, update

```sh
npm run operator:test
node packages/switchboard-mcp/switchboard-mcp.test.mjs
npm run operator:check
node scripts/check-operator-live.mjs  # installed launcher + real board, read-only
```

`operator:test` rebuilds the committed bundle and tests it from an isolated folder as both MCP
clients, including task deduplication, native result correlation, and scaffold assets. Edit skills
only in this directory. Change connector behavior only in `packages/switchboard-mcp/`, then rebuild.
After changing an installed Codex package, refresh its version/cachebuster, run
`node plugin/connector/build.mjs` to regenerate the portable envelope and bundle, then reinstall with
`codex plugin add switchboard@personal` (use the actual personal-marketplace name if different).
The Codex plugin-creator update helper can generate the cachebuster. Use a new task to pick it up.

References: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp),
[local skills](https://learn.chatgpt.com/docs/build-skills),
[hook trust and lifecycle](https://learn.chatgpt.com/docs/hooks).
