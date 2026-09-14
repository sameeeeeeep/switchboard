# Host bindings — one implementation

`plugin/skills/` is the canonical skill source. Claude's local skill folders may symlink to it.
Codex installs the same directory as one plugin; do not also install copies in `.agents/skills`.
`packages/switchboard-mcp/` is the connector source, compiled into `plugin/connector/` for either host.
Both use the existing `~/SwitchboardBrain` vault and `~/.relay` native protocol.

| Operation | Claude Code | Codex |
|---|---|---|
| Switchboard tools | Discover `mcp__switchboard__*` or plugin namespace | Discover the loaded plugin's `switchboard_*` tools |
| Read files/images | Read or available image tool | Shell/file tools and `view_image` for local images |
| Browser/UI | Available browser/computer tools | Available browser/computer tools |
| Visual explanations | Available visualization skill | `visualize` skill when available |
| Task creation/handoff | Available session tools, if installed | Codex task tools; create a new task only when the user requested one |
| Subagents | Host agent tool when authorized | Collaboration tools when authorized; do not infer authorization from a tool name in an example |
| Background follow-up | Host scheduler when available and requested | Codex automation tools when the user requested continued work/monitoring |
| Lifecycle hooks | PermissionRequest + Stop; Notification for idle prompts | PermissionRequest + Stop; requires user review/trust in `/hooks` |

Use actual available tools, not hardcoded `ccd_session`, `ScheduleWakeup`, `TodoWrite`, or visualization
names from older examples. If a needed host feature is unavailable, complete the supported work and
state the missing capability. Do not create another agent, task, or scheduler to imitate an unavailable
feature without the user's requested scope.

Skills may refer to sibling skills by name; resolve them relative to this shared `skills/` directory.
The PM skill's references to wrapp builds, God/Guru, and repo scripts apply only to work in a Switchboard
checkout. Resolve that checkout from the current project or `SWITCHBOARD_REPO`; do not assume a personal
absolute path or a stale worktree. Prefer MCP tools for board/presence operations from other projects.

The optional native protocol reference describes legacy file handshakes. The connector now exposes
those same payloads without requiring every host's shell to write into `~/.relay`. Keep host file
permissions intact. Keep real approvals in the host/native consent UI; a notch card only records the
human's answer to that card.

Plugin installation does not grant any wrapp additional model or tool permissions. Headless wrapp
calls reuse their existing Switchboard grants. Providers and models stay governed by Switchboard.
