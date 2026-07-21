# Pairing v2 — per-client identity, no copy-paste

Status: **SPEC — not built.** Approved direction from the 2026-07-22 install audit; implement
after extension 0.1.4 ships. Nothing here changes the origin-keyed grant model.

## The defects this kills (all verified in the audit)

One token per machine (`~/.relay/pairing-token`), stored per Chrome profile, compared with
`msg.token === pairingToken` (`server.ts`), means the daemon cannot tell clients apart:

1. **Silent grant inheritance.** Pairing profile B (same token) inherits every consent profile A
   ever approved — models, tool allowlist, trust mode, bound folders — with zero prompts.
   Incognito and Guest inherit the same way.
2. **Consent misdirection.** `pushPrompt` sends to `[...extensions][0]`: an action taken in
   profile B pops its approve/deny card in profile A, where a different human can approve it.
   Reconnects get the whole `promptQueue` replayed regardless of who asked.
3. **No revocation.** `rotatePairingToken()` is dead code. The extension's kill switch drops one
   profile's copy of the token; the machine token stays valid forever. Pairing a work laptop's
   browser is irreversible from any UI.
4. **The token dance itself.** Copy from an unfindable popover, paste into a panel. The audit's
   first-time journeys stall here even when everything works.

## The design

**Invert the flow: the extension asks, the human approves in the menubar, the daemon mints.**

```
extension (no token)      daemon                    menubar app
     │  dial + hello ───────▶│
     │   {clientId, label}   │── prompt: "Chrome (Work)
     │                       │   wants to pair" ──────▶│  [Approve] [Deny]
     │                       │◀───────── approve ──────│
     │◀── {clientToken} ─────│
     │  (persist, re-auth)   │  paired-clients.json += {clientId, label, tokenHash, createdAt}
```

- **Client identity.** On install the extension mints a UUID and a human label
  (browser + profile name where obtainable, else "Chrome"). `{type:"hello", clientId, label,
  extVersion}` replaces the bare token auth for unpaired clients.
- **Approval is out-of-band** — a menubar prompt (the same surface as write-consent), never a
  browser surface. The card names the client label. Physical presence at the machine is the
  authenticating factor, exactly like today's token-copy but with zero user choreography.
- **Per-client tokens.** The daemon mints a fresh token per approved client and stores
  `paired-clients.json`: `[{ clientId, label, tokenHash, createdAt, lastSeen }]`. Tokens are
  hashed at rest (the daemon never needs the cleartext again); the cleartext goes to that client
  once, over the already-open local socket.
- **Prompt routing.** Every consent prompt carries the requesting socket; replies are accepted
  ONLY from the socket the prompt was pushed to. Queue re-push targets the originating client
  (re-binding to its NEW socket on reconnect, matched by clientId).
- **Revocation.** The popover gains a "Paired browsers" list with per-client unpair (delete the
  row; that client's next dial lands back at hello). `rotatePairingToken()` semantics become
  "unpair everything".

## Compatibility

- Legacy `{type:"auth", token}` with the machine token keeps working for ONE release (0.1.5
  extension + matching daemon), marked `label: "legacy"` in the client list. Removed after.
- Grants stay **origin-keyed and machine-wide** — deliberately. The site is the principal; a
  human who approved canva.com once should not re-approve it per profile. What becomes
  per-client is *identity, prompt routing, and revocation* — never the grant store. (Audit
  do-not-do list: sharding grants would multiply the revoke surface and break the model.)
- `HealthStatus.installedHere` (shipped 0.1.4) is unaffected.

## Non-goals

- No cross-machine sync of pairings (see the second-machine journey — separate problem).
- No page-visible identity: `clientId` never crosses the page boundary; the page still sees only
  `window.claude` and its origin-scoped capabilities.
- No cryptographic channel binding beyond localhost — the threat model is same-machine multi-
  profile confusion and lost revocation, not a network adversary (the socket never leaves
  127.0.0.1).

## Order of work

1. Daemon: `paired-clients.json` store + hello/approve/mint + per-socket prompt routing
   (prompt owner threading is ~30 lines in `ask()`/`pushPrompt`/reply handling).
2. Menubar: pairing-approval prompt card (reuse the consent card pattern) + paired-browsers list.
3. Extension: hello flow, clientId mint, token persistence per client (0.1.5).
4. Remove the token input from the side panel; keep it behind an "advanced" disclosure for one
   release as the legacy path.
