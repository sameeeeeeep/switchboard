# Daemon distribution — the Relay DMG

How Switchboard's daemon ships to people who don't have a dev checkout: one DMG, one drag,
one click. Built by `packages/menubar/package-dmg.sh` (run it from anywhere; it resolves the
repo root itself). The dev flow is untouched — `build.sh` + `npm run daemon:install` still
work exactly as before.

## 1. What ships in the DMG

`Relay-0.1.3.dmg` (~111 MB) contains `Relay.app` and an `/Applications` symlink. The app
carries its whole runtime — a fresh Mac needs no Node, no npm, no checkout:

```
Relay.app/Contents/
  MacOS/Relay                      the menubar app (swiftc, single file)
  Info.plist                       version 0.1.3
  Resources/
    Relay.icns                     app icon (reused from the extension's mark)
    node                           Node v20.19.0, arm64, copied verbatim (Node.js signature intact)
    daemon/
      sidekick.mjs                 the ENTIRE daemon as one 2.2 MB esbuild ESM bundle
                                   (sidekick + agent-sdk js + MCP sdk + ws + zod + protocol)
      RUNTIME                      provenance: node version, sdk version, build date
      node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/
        claude                     the agent SDK's own native CLI (2.1.202), Anthropic-signed
                                   (com.anthropic.claude-code, hardened runtime) — never re-signed
```

Why the sibling `node_modules` copy: the bundled `sdk.mjs` resolves its CLI with
`createRequire(import.meta.url)` relative to the bundle file, so the platform package must sit
beside `sidekick.mjs`. Verified empirically — the daemon boots and resolves the bundled CLI
from any path, including a read-only DMG mount.

What does NOT ship: no API keys, no tokens, no state. Everything user-specific lives in
`~/.relay` (created on first run, 0700) and `~/.claude` (the user's own Claude sign-in).

## 2. Prerequisites

- **A signed-in Claude Code CLI.** The daemon's model calls run on the user's Claude
  subscription — the bundled CLI reads the login state in `~/.claude`. Warm sessions also
  spawn the *system* `claude` (found via `~/.local/bin`, `/opt/homebrew/bin`,
  `/usr/local/bin`, or `CLAUDE_CLI`), so `claude` should be installed and logged in.
  Note the two binaries can drift in version; the bundled one is pinned by the agent-sdk.
- **Chrome + the Switchboard extension 0.1.3** — from the Chrome Web Store, or
  `switchboard-extension.zip` loaded unpacked for development.
- **macOS 13+ on Apple Silicon.** The DMG is arm64-only for now (universal2 is future work).

## 3. Install

1. Open the DMG, drag **Relay** onto the **Applications** symlink. This is not cosmetic:
   Gatekeeper *translocates* quarantined apps run from Downloads to a randomized read-only
   path, and a LaunchAgent written from there would die on next login. The app detects
   translocation and refuses to install the daemon until it lives in `/Applications`.
2. Open Relay (see §4 for the Gatekeeper hoop), click the menubar mark, click **start**.
   The app writes `~/Library/LaunchAgents/com.relay.sidekick.plist` pointing into its own
   bundle (`RunAtLoad` + `KeepAlive`, logs to `~/.relay/sidekick.log`, PATH pre-set so the
   system `claude` and npx-based MCP servers work under launchd) and bootstraps it.
   This only ever happens on an explicit click, and never over someone else's plist (§5).
3. Click **token** in the popover and paste it into the extension's pairing field.
   State lives in `~/.relay`: pairing token (0600), contexts, grants, audit log.

## 4. Gatekeeper

**Signed and notarized since 0.1.3** — first launch just works. No "Open Anyway", no
`xattr -dr com.apple.quarantine`, no right-click → Open. Both the app and the DMG carry a
stapled notarization ticket, so this holds offline too.

Verify any build before shipping it:

```sh
spctl -a -t open --context context:primary-signature -vv packages/menubar/build/Relay-0.1.3.dmg
# → accepted / source=Notarized Developer ID
```

Translocation still applies, and is unrelated to signing: an app left in Downloads runs from
a randomized read-only path, so the popover keeps saying "move Relay to /Applications, then
reopen it" instead of starting. That is the §3 guard doing its job, not a Gatekeeper problem.

## 5. Taking over from a dev install

If `com.relay.sidekick.plist` already exists but points elsewhere (the dev checkout's
`npm run daemon:install` shape: nvm node + `packages/sidekick/dist/index.js`), the packaged
app treats it as **foreign** and leaves it alone — start just bootstraps the existing plist.
The popover shows *"daemon managed by a dev install"* with an explicit **take over** button:

- **What it does** (after a confirmation dialog): `launchctl bootout` the old plist, write a
  new one pointing into the bundle, `launchctl bootstrap` it.
- **What is preserved**: everything in `~/.relay` — pairing token, contexts, grants, audit
  log — byte-for-byte. The migration is plist-only.
- **Going back**: `npm run daemon:install` from the checkout rewrites the plist at the dev
  paths again.

A third state, **stale** (plist points into a bundle that no longer has the files — app was
moved or updated), gets a **repair** button: rewrite + bootout/bootstrap (launchd caches
`ProgramArguments`, so a plain kickstart would respawn the dead paths).

## 6. Signing + notarization (automatic)

`package-dmg.sh` does the whole thing when two prerequisites are present — a **Developer ID
Application** certificate in the keychain, and a notarytool credential profile:

```sh
# one-time; omit --password so it prompts and never lands in shell history
xcrun notarytool store-credentials relay-notary --apple-id <email> --team-id <TEAMID>
```

Then `./packages/menubar/package-dmg.sh` signs → smoke-tests → notarizes the app → staples it
→ builds the DMG → signs the DMG → notarizes → staples → asserts `spctl` accepts it. Two notary
round-trips, roughly ten minutes total.

Three things here are load-bearing and easy to get wrong:

- **`node.entitlements` is not optional.** `codesign` drops entitlements unless they are passed
  back in, and node without `com.apple.security.cs.allow-jit` cannot start V8 at all — it dies
  with *"Fatal process OOM in Failed to reserve virtual memory for CodeRange"*. The file mirrors
  Node.js's own signing set minus `get-task-allow`, which the notary service rejects.
- **The app is stapled before it enters the DMG.** Notarizing only the DMG registers the app's
  cdhash with Apple, but an un-stapled app must reach Apple's servers on first launch; offline
  users get *"Relay.app is damaged and can't be opened"*.
- **The DMG is signed after `hdiutil create`**, which emits an unsigned image. Skip this and the
  DMG fails Gatekeeper with *"no usable signature"* even with a perfectly notarized app inside.

Never `codesign --deep`: it would re-sign and destroy Anthropic's signature on the bundled
`claude` CLI. The script signs each executable explicitly instead, then verifies all three.

The smoke test (step 10) boots the *staged* daemon on an isolated port and state dir before any
DMG is cut. It is what catches a mis-signed node — keep it.

## 7. Hosting + landing page

**Live since 0.1.3.** The DMG is a **GitHub Release asset** — 111 MB is over GitHub's 100 MB
per-file repo limit, so it cannot be committed to a Pages repo.

The asset is named **`Relay.dmg`, unversioned on purpose**. The landing page links to
`releases/latest/download/Relay.dmg`, which keeps working across releases; a versioned filename
would 404 the moment the next tag ships. The version lives in the release tag and notes, so
rename the built DMG before uploading:

```sh
cp packages/menubar/build/Relay-<ver>.dmg /tmp/Relay.dmg
gh release create v<ver> /tmp/Relay.dmg switchboard-extension.zip --title "Switchboard v<ver>"
```

`switchboard-extension.zip` stays on the release for development installs, but the landing page
no longer offers it — the [Chrome Web Store listing][cws] is the single path for the extension.
Keep that asset name stable regardless: `docs/CHROME-WEB-STORE.md` links to it.

[cws]: https://chromewebstore.google.com/detail/injmjolmnekmahlnackakiamjepegagb

The landing page lives in a **separate repo**: `the-last-prompt`, at `switchboard/index.html`
(CNAME → `thelastprompt.ai`, GitHub Pages). The install steps are the `.install-grid` section.

## 8. Versioning

One release train, three artifacts, one number — currently **0.1.3**:

| artifact | where the version lives |
|---|---|
| Relay.app | `packages/menubar/Info.plist` → `CFBundleShortVersionString` (bump `CFBundleVersion` too) |
| extension | `packages/extension/manifest.json` |
| npm | `@thelastprompt/switchboard` (`packages/sidekick/scripts/build-npm.mjs` dist) |

Bump all three together; tag `v<version>`; the DMG filename follows the Info.plist
automatically.

## 9. Future work

- **Sparkle auto-update** — Developer ID is in place now (§6); appcast on GitHub Pages.
- **universal2** — `lipo` the node binary + ship both `claude-agent-sdk-darwin-*` platform
  packages; roughly doubles the DMG.
- **Windows/Linux** — the daemon is portable Node (the npm package already covers dev users
  cross-platform); the menubar app is not — a per-OS tray app comes later.
- **Smaller DMG** — `hdiutil -format ULMO` (lzma) shaves a meaningful chunk off the 111 MB;
  the payload is dominated by the 232 MB (uncompressed) claude CLI.
- **Pin warm sessions to the bundled CLI** — today `session/manager.ts` spawns the *system*
  `claude` while `query()` uses the bundled one; a small sidekick change could unify them.
- **Fallback bundle layout** — if a lazy agent-sdk codepath ever breaks the single-file
  bundle, switch to the pruned-prod-node_modules layout (what `build-npm.mjs` already does):
  same app anatomy, one esbuild flag.

## 10. Troubleshooting

- **Menubar mark stays slate** — daemon offline. **logs** button opens
  `~/.relay/sidekick.log`; `launchctl print gui/$(id -u)/com.relay.sidekick` shows launchd's
  view.
- **Restart loop** (log fills with immediate exits) — `KeepAlive` respawning a broken
  install. If the app was moved/renamed, open it and use **repair**. Check the plist's paths
  still exist.
- **Model calls fail / "no backend"** — the user isn't signed into Claude Code. Run
  `claude` once in a terminal and log in; the daemon picks it up on restart.
- **npx-based MCP servers don't start under launchd** — PATH. The plist bakes
  `~/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` at install time; exotic
  install locations need a hand-added `RELAY_CLAUDE_CLI`/`CLAUDE_CLI` or PATH entry in the
  plist (no UI for this yet).
- **Port 8787 taken** — set `RELAY_PORT` in the plist's `EnvironmentVariables` (the
  extension side must match).
- **Kill switch** — delete `~/.relay/pairing-token` and restart the daemon: a new token is
  minted and every previously paired extension is locked out until re-paired.
