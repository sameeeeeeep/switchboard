# Switchboard 0.2.1 — the daemon that matches the hardened relay

**Why this release exists:** 0.2.0 shipped Team Mode's cloud path, and the adversarial review then
found that knowing a `teamId` — a routing identifier that travels in URLs and server logs — was
enough to seize a team's `host` role or download its sealed backup. The relay fix went live
immediately, and it requires every socket to present a **proof of team membership** (HKDF'd from the
invite secret under a label unrelated to the content key, so the relay can compare membership but
can never decrypt).

That fix is why the daemon must follow: **a 0.2.0 daemon cannot _host_ a relay-backed team any more**
— it sends no proof, and an unproven host is exactly the hijack that was closed. Members and
same-network (LAN) teams are unaffected, as is every non-team feature.

## What's in it

- **Membership proof on the relay path** — the daemon now proves team membership on both the host and
  member connections. This is what restores hosting through the hosted relay.
- **Pro cloud backup** — a team's folder is backed up as sealed blobs the relay cannot read, so it
  survives *everyone* going offline, and `team.restore(<invite code>)` rebuilds it on a brand-new
  machine. Off unless a team is entitled.
- **Opt-in hosted models (OpenRouter)** — a second, clearly-badged lane for people without a Claude
  subscription. Off by default; `backendFor()` never falls back to it, so prompts can't leave the
  machine implicitly.
- 27 hardening fixes from the review (non-destructive compaction, per-write entitlement expiry, seat
  cap on the room's plan, refusals as readable close codes, daemon no longer trusts a relay's `head`).

## Ships as a pair

The relay is **already deployed** with the fix. A new compatibility guard makes this class of drift
impossible to ship silently again:

```bash
npm run try-compat
```

It asserts *both* halves at once — the gate is live (an unproven or mismatched host is refused
`4004`) **and** the shipped daemon satisfies it (it still hosts, a second daemon joins, and the folder
syncs). Either assertion alone could pass on a broken pair; together they can't.

## Verification

```bash
npm run try-compat       # daemon↔relay contract 7/7
npm run try-cloud        # hosted inference 11/11
npm run try-store        # relay gate 22/22
npm run try-team-cloud   # back up → kill the only daemon → fresh daemon restores 12/12
npm run try-team         # regression 23/23
npm run try-team-git     # regression green
npm run try-team-relay   # regression green
```

## Versions

| Component | Version | Note |
|---|---|---|
| Daemon / menubar app | **0.2.1** (build 6) | this release — pairs with the live relay |
| npm `@thelastprompt/switchboard` | **0.2.1** | tracks the release train |
| Extension | **0.2.0** (unchanged) | 0.2.0 is in Chrome Web Store review; bumping would restart the clock |

**On the extension:** a 0.2.0 extension against a 0.2.1 daemon is fine — it simply doesn't render the
new Cloud section (it never calls `cloud.status`), and everything else is unchanged. The extension
carrying the Cloud panel should be submitted **after** 0.2.0 clears review, as 0.2.1.

## The one step that needs a human

The DMG is signed and notarized with Apple credentials, which live only on the maintainer's machine:

```bash
bash packages/menubar/package-dmg.sh
```

Output: `packages/menubar/build/Switchboard-0.2.1.dmg`. Attach it to the GitHub release as
**`Switchboard.dmg`** (the stable name the landing page's "Download for Mac" link resolves to via
`releases/latest/download/Switchboard.dmg`).
