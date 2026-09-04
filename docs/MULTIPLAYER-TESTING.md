# Multiplayer / Team Mode — test coverage & how to reproduce

What's been verified for Team Mode (N people, N Claudes, one shared folder), and how to re-run each
check. Everything below is **machine-verifiable and self-contained** — no production secrets, no second
Mac. The only thing that still needs two physical Macs is the human invite-paste UX + on-screen
rendering (see [TEAM-TWO-MAC-SETUP.md](TEAM-TWO-MAC-SETUP.md)).

## Scorecard (all green)

| Area | What's proven |
|---|---|
| Connection stability | No flap; the duplicate-host bug is fixed (one host transport per team) |
| Member↔member cursors | The host fans each member's cursor to the others |
| Wrapp surface control | A member opens a wrapp on teammates' screens; reaches members + the host executes |
| Folder sync (the core) | host→member, member→host, and LWW edit convergence |
| 3-way roster / presence | Members list + online/leave updates |
| Host resume under churn | Host drops + resumes → members auto-reconnect **and sync resumes** |
| Security | A tampered-secret invite cannot connect |
| Seat cap | Relay gates past the plan → **free tier = host + 3 teammates** |
| **Pro: git backing** | Host auto-commits/pushes to the team remote; clone works; ongoing commits |
| **Pro: cloud backup/restore** | Sealed upload; a fresh device rebuilds from the invite with everyone offline |

## Harness shape

All tests drive **real `TeamEngine` instances** (host + "ghost" members) from `packages/sidekick/dist`,
over the real relay. The daemon can be the host, driven via its loopback control channel:

```js
// connect: ws://127.0.0.1:8787, then {type:"auth",token:<~/.relay/pairing-token>}
// call:    {type:"control", id, action:"team.host", args:{folder, relay, teamName}}
//          → {type:"control_result", id, result:{ok, invite, status}}
```

Ghost members import `TeamEngine` and provide stub deps (`audit`, `onCursor`, `onSurface`, …). Note:
import `ws` by **absolute path** — ESM ignores `NODE_PATH`. `teamCursor`/`teamSurface` events are pushed
only to menubar clients, so a control-channel probe for them reads 0 (not a failure).

## Pro path 1 — git backing (local bare repo, no creds)

`setGit(remote)` names the repo (branch defaults to `main`), does `ensureRepo` (init + `remote add
origin` + checkout), and auto-commits/pushes on a quiet-window cycle.

```bash
git init --bare -b main /tmp/team-remote.git          # a local "remote"
# TeamEngine: setEnabled(true) → host({folder}) → write files → await setGit("/tmp/team-remote.git")
# shrink the cadence so it commits fast:
RELAY_TEAM_GIT_MS=2000 RELAY_TEAM_GIT_QUIET_MS=800 node <harness>
# verify: git -C /tmp/team-remote.git rev-list --count HEAD   (commits landed)
#         git clone /tmp/team-remote.git /tmp/clone           (remote is a real, usable repo)
```

Result: push ✅, clone ✅, edit→new-commit ✅.

## Pro path 2 — zero-knowledge cloud backup/restore (local relay)

The store is gated by an **entitlement** = `<teamId>.<exp>.<maxSeats>.<HMAC-SHA256(STORE_SECRET,
"teamId.exp.maxSeats") base64url>`. Stand up the relay locally with a secret you control, then mint a
matching ent:

```bash
cd packages/relay
printf 'STORE_SECRET = "test-store-secret-local-only-abc123"\n' > .dev.vars   # LOCAL only — never commit
npx wrangler dev --port 8799 --local        # relay on ws://127.0.0.1:8799
```

```js
// host({folder, relay:"ws://127.0.0.1:8799"}) → read teamId from status
// ent = `${teamId}.${Date.now()+3600e3}.10.` + createHmac("sha256",SECRET).update(`${teamId}.${exp}.10`).digest("base64url")
// setEntitlement(ent)  → re-hosts with the store unlocked; storeBackup fires every SCAN_MS (1.5s)
// write files → poll status().cloud.backedUpAt
// STOP the host, then on a FRESH engine: await restore(invite, {folder:<empty>}) → files rebuild
```

Result: backup ✅, restore-with-everyone-offline ✅ (`N file(s) from the encrypted cloud backup`),
ent-is-secret-bound ✅. The relay only ever holds AES-256-GCM ciphertext — the content key is derived
from the team secret and never sent to the relay (zero-knowledge by construction).

**Teardown (important):** `pkill -f "wrangler dev"`, then `rm -f packages/relay/.dev.vars` and
`rm -rf packages/relay/.wrangler`. The test secret must never be committed.

## Still needs a real second Mac

The human flow — create on Mac A → copy the `swb1…` invite → paste on Mac B → pick a folder — and the
on-screen rendering (remote MacCats, the wrapp window opening, the members list, the base-notch team
pulse). Walkthrough: [TEAM-TWO-MAC-SETUP.md](TEAM-TWO-MAC-SETUP.md).
