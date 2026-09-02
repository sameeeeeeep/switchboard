# Slack connector — `/notch` + `/hijack` ingress

`/notch @sameep send the new logo` in Slack lands as a task on that person's Switchboard board
(tasks.md) **and** raises a notch card on their Mac. This is the ingress half of the multiplayer
vision (docs/MULTIPLAYER-VISION.md §4).

**Two modes, same route** — the Slack command name picks the mode:

- **`/notch @handle <task>`** — the passive drop. Task → their board + a "New task" notch card. They
  deal with it whenever (an agent can draft it for review).
- **`/hijack @handle <task>`** — the **pester** (NOT screen control). The task is **specced into
  concrete steps + a time estimate** (a headless Claude draft), and the recipient runs a small
  state machine at their notch, with the sender's **sprite trailing their own cursor**
  (`~/.relay/pester.json` → TeamCursorsOverlay) whenever the task is **not yet begun**. Nobody drives
  anyone's pointer — it's a nudge you can't ignore. Task is added to the board (tagged `via Slack
  /hijack`).

  The lifecycle (daemon-owned in `inbox/client.ts`, so it can genuinely re-nudge):

  ```
  NUDGING  — heads-up card ("🎯 Sam hijacked you: <task>", status "✓ specced & loaded · N steps · ~X min"),
             sprite chasing.  Options:
               • Do it now        → GUIDED
               • See the plan     → a transparency card showing the specced steps, then Do it / Not now
               • Not now          → snooze 15m, then re-nudge
             (ignored → re-nudge after a breather, capped ~6 rounds, then gives up)
  GUIDED   — the specced steps open; sprite OFF (they've BEGUN)
               • complete ✓       → DONE (never comes back)
               • abandon / esc    → back to NUDGING (sprite RETURNS)
  ```

  So the pest shakes off the moment they **begin**, comes **back** if they abandon, and is gone for
  good once they **finish** — and a mid-something user can bail cleanly via *Not now* (the "warning
  first" escape) instead of being dragged into the walkthrough.

```
Slack slash command ──POST──▶ Cloudflare Worker /slack/command
                                   │  verify signature, parse "@handle <task>"
                                   ▼
                              INBOX_ROOM DO  (one per handle, keyed by idFromName(handle))
                                   │  fan to the connected daemon socket (or queue ≤1h)
                                   ▼
   daemon  ◀──wss /inbox/<handle>──┘   (dialed only when ~/.relay/slack.json exists)
        │  addTask → <active project>/tasks.md   +   raise notch card (~/.relay/guide-run.json)
```

The Worker + Durable Object are the SAME ones the team relay already runs
(`packages/relay/src/worker.ts`). This adds a `POST /slack/command` route, a `GET /inbox/<handle>`
WebSocket route, and an `InboxRoom` DO alongside the existing `TeamRoom`.

---

## What the founder must do

### 1 · Create the Slack app + `/notch` slash command

Create an app at <https://api.slack.com/apps> → **From scratch** (or import the manifest below), then
add a slash command:

- **Command:** `/notch`
- **Request URL:** `https://<your-worker-domain>/slack/command`
- **Short description:** `Send a task to someone's Switchboard board`
- **Usage hint:** `@handle what to do`

Manifest (Features → App Manifest, YAML):

```yaml
display_information:
  name: Switchboard Notch
features:
  slash_commands:
    - command: /notch
      url: https://<your-worker-domain>/slack/command
      description: Send a task to someone's Switchboard board
      usage_hint: "@handle what to do"
      should_escape: false
    - command: /hijack
      url: https://<your-worker-domain>/slack/command   # SAME route — worker picks mode from the command name
      description: Pester someone to actually do a task
      usage_hint: "@handle what to do"
      should_escape: false
oauth_config:
  scopes:
    bot:
      - commands
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
```

Install the app to the workspace.

### 2 · Get the signing secret

Slack app → **Basic Information → App Credentials → Signing Secret**. This is the key the Worker
uses to verify every request came from Slack (HMAC-SHA256 over `v0:<timestamp>:<raw body>`). The
Worker **rejects every Slack request when this secret is unset** — it never trusts an unsigned body.

### 3 · Deploy the Worker (with the new DO binding + the secret)

The binding + migration are already in `packages/relay/wrangler.jsonc`:

```jsonc
"durable_objects": { "bindings": [
  { "name": "TEAM_ROOM",  "class_name": "TeamRoom"  },
  { "name": "INBOX_ROOM", "class_name": "InboxRoom" }   // ← new
]},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["TeamRoom"]  },
  { "tag": "v2", "new_sqlite_classes": ["InboxRoom"] }   // ← new
]
```

Set the signing secret, then deploy:

```bash
cd packages/relay
npx wrangler secret put SLACK_SIGNING_SECRET   # paste the secret from step 2
npx wrangler deploy
```

`SLACK_SIGNING_SECRET` is the only new secret. The team-relay secrets (`STORE_SECRET`, …) are
unchanged and unrelated.

### 4 · Link each person's Switchboard to their Slack handle

On the recipient's Mac, write `~/.relay/slack.json`:

```json
{ "handle": "sameep", "relay": "wss://<your-worker-domain>" }
```

- `handle` — the Slack handle used after `/notch @…` (case-insensitive). It must match the
  `@handle` senders type, **not** necessarily the person's Slack display name.
- `relay` — the Worker's origin. A bare host (`relay.example.com`) or a full `wss://…` both work;
  `ws://` is accepted for local testing.

The daemon dials `wss://<relay>/inbox/<handle>` on boot and reconnects with backoff on drop. **Absent
this file the daemon makes no inbox connection** — leave it out to keep the feature off. Restart the
daemon (or the app) after writing it.

> Handle→machine mapping is per-Mac and manual for now (this file). A hosted identity link
> (`@handle` → which daemon) is the natural next step but is out of scope here.

---

## Local test — no Slack, no Cloudflare

The daemon also watches `~/.relay/inbox-task.json`. Dropping a task file there runs the **exact same**
board + notch delivery a real Slack task would, so the whole path is testable offline:

```bash
echo '{"from":"Sam","text":"send the new logo","mode":"notch"}'  > ~/.relay/inbox-task.json   # passive drop
echo '{"from":"Sam","text":"reply to the CFO email","mode":"hijack"}' > ~/.relay/inbox-task.json   # pester
```

Within ~1s the daemon consumes the file, appends the task to the active project's `tasks.md`
(with a `from Sam via Slack` note), and — for `notch` — raises the "New task" card, or — for
`hijack` — specs the task into a guided run + drops `~/.relay/pester.json` so the sender's sprite
trails the cursor. If no project is active it falls back to `~/SwitchboardBrain/tasks.md`.

Both `mode:"notch"` and `mode:"hijack"` are handled; any other mode is ignored.

---

## Files

- `packages/relay/src/worker.ts` — `POST /slack/command` (signature verify + parse + route; the
  command name `/notch`|`/hijack` sets `mode`), `GET /inbox/<handle>` (WS), and the `InboxRoom`
  Durable Object (fan-out + offline queue).
- `packages/relay/wrangler.jsonc` — the `INBOX_ROOM` binding + `v2` SQLite migration.
- `packages/sidekick/src/inbox/client.ts` — the daemon inbox client (relay dial + local-file test
  path). `notch` → board + card; `hijack` → board + `specTask` (LLM) → guided run + `pester.json`.
  Wired in `packages/sidekick/src/index.ts` (the `specTask` hook = `broker.routineDraft`).
- `packages/menubar/TeamCursorsOverlay.swift` — the pester sprite (`startPester`/`stopPester`, a
  labelled avatar that lerp-chases your own cursor). `packages/menubar/CursorGuide.swift` polls
  `~/.relay/pester.json` and clears it when the hijacked run **completes** (an abort keeps chasing).
