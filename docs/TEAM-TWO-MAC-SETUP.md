# Team Mode — two-Mac setup & acceptance test

The one thing ghosts can't cover: two real Macs, two people, one folder. This is the human flow.
Everything else (connection stability, member↔member cursors, wrapp surface control, folder sync,
roster, host-resume, security, seat cap) is already machine-verified.

**Prereq:** both Macs on **Switchboard 0.3.17+** (build 38+). Team Mode lives in the panel, not the notch.

## On Mac A (the host)

1. Click the **Switchboard menu-bar icon** → the **⚙️ gear** (Settings) → **TEAM**.
   *(There's now also a `team` button next to `pairing` in the DAEMON row — one tap jumps here.)*
2. **Create a team** and pick the folder you want to share.
3. **Copy the invite code** — the whole `swb1.…` string. It carries the sealed team key, so treat it
   like a password (anyone with it can join). It's shown once; copy it now.

## On Mac B (the teammate)

4. Open **Switchboard** (install the DMG first if needed), then ⚙️ **Settings → TEAM**.
5. **Join a team** → paste the `swb1.…` invite → pick a **local folder** for the shared vault
   (it can be empty; the folder converges on first sync).

## What you should see (the acceptance test)

6. **Team is live:** Mac B's **base notch starts breathing lime** (slow heartbeat), and Mac A's TEAM
   roster lists the new teammate. A **MacCat** appears on each screen for the other person's cursor.
7. **Folder sync:** create a file in the shared folder on Mac A → within ~2s it appears in Mac B's
   folder. Edit it on either side → the change converges (last-writer-wins).
8. **Surface control:** from Mac B, open a wrapp on the team → it opens on Mac A's screen.

## Notes / limits

- **Free tier = host + 3 teammates** (the relay gates the 5th connection; that becomes an upgrade
  prompt). Larger teams need Pro (a team-scoped entitlement).
- **No login.** Team Mode needs no account — membership is proven by the invite's sealed key alone.
- **Cross-network works out of the box:** host and members both dial *out* to the Cloudflare relay
  (`switchboard-team-relay…workers.dev`), so there's no port-forwarding and NAT is a non-issue.
- **If a member drops** (sleep, network blip), it auto-reconnects and resync is automatic. If the host
  quits and comes back, members reconnect to it and sync resumes — one host per team, always.
- **Not yet tested (needs real Pro creds):** cloud backup/restore (folder survives everyone offline)
  and team git backing (shared repo push/pull).
