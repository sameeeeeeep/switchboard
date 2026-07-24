# Switchboard 0.2.0 — Team Mode

Paste-ready copy for the GitHub release, the Chrome Web Store "what's new", and the landing page.

## Headline

**Team Mode — N people, N Claudes, one shared folder.** Share a folder with people you trust and
everyone works on it live, each on *their own* Claude, their own grants, their own machine. No
accounts, no uploads, no middleman. Off by default — a user who never enables it runs an identical
daemon.

## GitHub release notes (v0.2.0)

```
## Team Mode 🎉

Multiplayer for Switchboard, built the only way that keeps the promise: the shared thing is a
**folder**, never the wrapp. Each member keeps their own Claude — inference never changes hands,
only files sync.

- **Sealed peer-to-peer sync** — invite-code membership, every daemon↔daemon frame AES-256-GCM
  encrypted end-to-end. Per-file last-writer-wins merges concurrent edits instead of clobbering.
- **Cross-network relay** — a hosted Cloudflare relay (MIT + self-hostable) forwards only sealed
  frames it can't read: a mailman, not a landlord. Teammates on other networks join with one code.
- **Git backing** — the team folder is optionally a repo: teammates sync through the GitHub they
  already have when they're apart, with per-member commits.
- **Team-ready wrapps for free** — the wrapp kit's new `liveStore` makes any wrapp collaborative
  (per-record storage + live re-read). Redline/CUT: two reviewers redline the same cut, live.
- Presence with per-member colours; a visible team folder under `~/Switchboard Teams/`.

Additive and **off by default**: no new extension permissions, `window.claude` unchanged, the
consent broker untouched.

**Install:** drag `Relay-0.2.0.dmg` to Applications (signed + notarized — first launch just works),
and get the extension from the Chrome Web Store. See docs/DAEMON-DISTRIBUTION.md.
```

## Chrome Web Store — "What's new" (≤ short)

```
Team Mode: share a folder with your team and collaborate live — each person on their own Claude,
no accounts, no uploads. Plus a one-paste cross-network relay that only ever moves encrypted data
it can't read. Off by default; no new permissions.
```

## Landing page — the Team Mode section (copy)

**Eyebrow:** New in 0.2.0
**Title:** Multiplayer, without the middleman.
**Body:** Share a folder with your team. Everyone edits it live — each on their *own* Claude, their
own subscription, their own machine. No shared account to log into, nothing uploaded to us. The
sync server (when teammates are on different networks) is a mailman: it moves sealed data it can't
read. This is collaboration that *keeps* the privacy, instead of trading it away.
**Proof line:** Two people. Two Claudes. One folder. Zero accounts.
