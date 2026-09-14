# Install the shared Switchboard operator integration

Claude Code and Codex now use the same connector and nine skills. The maintained package is
[`plugin/`](../plugin/README.md); do not maintain a second skill tree for either host.

```sh
npm run operator:install -- --dry-run
npm run operator:install
```

Select one host with `-- --client codex` or `-- --client claude`. Re-running preserves existing
registrations and links instead of creating duplicate tools or copied skill folders. Replaced
Switchboard-only files are backed up under `~/.relay/integration-backups/`; other settings remain.
A conflicting existing Codex standalone Switchboard MCP is reported before changes, so it can be
migrated deliberately instead of loading a second server.

The old `scripts/install-skills.mjs` delegates to the same installer for Claude. Its `--connector`
flag enables CLI registration; without it only links/settings are installed. Skill directories
are linked, not copied. For isolated tests use `install-operator.mjs --home <temp-home> --no-cli`.

## What was consolidated

| Capability | Shared implementation | Host binding |
|---|---|---|
| Tasks, triage, specs, handoff, Guru | Nine canonical skills + board MCP tools | Actual host tool namespace |
| Wrapp actions and scaffolding | One bundled MCP connector and embedded starter | Generated host envelopes, same launcher |
| Notch questions and guided steps | Native protocol through `switchboard_present` | Agent/task provenance |
| Human answers | Per-run guide files; matched whiteboard history | Same `switchboard_result` tool |
| Editable whiteboard | Existing native Switchboard board | Same seed/result payloads |
| PIP progress | Existing feed and notch notifications | Agent-specific source label |
| Needs attention | One notification script | PermissionRequest; Claude also has idle Notification |
| Decision handback / PIP completion | One Stop hook | Codex direct last message; Claude transcript fallback |

The previous Claude setup on this machine used a project MCP registration, eight repo/user skills plus a user-only `guru` skill,
and global Notification/Stop hooks. Some user skills were newer than the package, and the packaged
connector had fallen behind source. The legacy Claude path variable did not resolve for Codex MCP startup; the build now generates
a portable Codex envelope pointing at the same launcher. Those differences were reconciled; repo and user discovery
paths now reference the canonical package.

Codex loads the installed plugin in a new task. Its lifecycle hooks must be reviewed/trusted via
`/hooks`; this is enforced by Codex. A plugin installation does not grant hook trust or approve any
Switchboard wrapp capability. See [Codex hook behavior](https://learn.chatgpt.com/docs/hooks).

Read [the package README](../plugin/README.md) for build/update commands and remaining runtime
requirements. `docs/CODEX.md` describes the other direction—wrapps using Codex as their model runtime.

Guru uses the same shared skill in both hosts: select `switchboard:guru` in Codex's skill picker
(CLI: `$switchboard:guru`), or use Claude's `/guru`. The skill also recognizes a plain-text
`guru:` or `/guru` request. No duplicate custom prompt or command file is needed.

Verified on this setup: Codex discovered all nine skills and 23 unique MCP tools through its
App Server. The installed launcher read the existing Switchboard board and wrote a native notch
connection-test notification. Lifecycle hooks were discovered without errors and remain untrusted
until reviewed by the user. No real wrapp model call was needed for the installation check.

The Guru check also compared task results from Claude's actual project registration and Codex's
installed launcher: both returned the same 49 Switchboard tasks from `~/SwitchboardBrain/tasks.md`.
Codex submitted one native Guru card and read the user's `works` response from that run's result.
The former user-only Guru skill was backed up and replaced with a link to the shared source.
