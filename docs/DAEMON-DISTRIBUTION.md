# Daemon distribution — the Relay DMG

How Switchboard's daemon ships to people who don't have a dev checkout: one DMG, one drag,
one click. Built by `packages/menubar/package-dmg.sh` (run it from anywhere; it resolves the
repo root itself). The dev flow is untouched — `build.sh` + `npm run daemon:install` still
work exactly as before.

## 1. What ships in the DMG

`Relay-0.1.2.dmg` (~111 MB) contains `Relay.app` and an `/Applications` symlink. The app
carries its whole runtime — a fresh Mac needs no Node, no npm, no checkout:

```
Relay.app/Contents/
  MacOS/Relay                      the menubar app (swiftc, single file)
  Info.plist                       version 0.1.2
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
- **Chrome + the Switchboard extension 0.1.2** (`switchboard-0.1.2.zip`).
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

## 4. Gatekeeper reality for the ad-hoc v1

The v1 DMG is **ad-hoc signed** (no Apple Developer identity yet), so first launch is blocked:

1. Double-click Relay → macOS says *"Apple could not verify 'Relay' is free of malware"*. Close it.
2. **System Settings → Privacy & Security**, scroll to the security section → **Open Anyway**.
3. Reopen Relay → confirm **Open** in the final dialog.

The old right-click → Open bypass **no longer works on macOS 15+**. Terminal alternative:

```sh
xattr -dr com.apple.quarantine /Applications/Relay.app
```

Even after "Open Anyway", an app still sitting in Downloads runs translocated — the popover
will keep saying "move Relay to /Applications, then reopen it" instead of starting. That
message is the guard from §3 doing its job.

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

## 6. The notarization path (before public distribution)

Ad-hoc friction (§4) is a funnel killer; before any real launch:

1. Join the **Apple Developer Program** ($99/yr) and create a **Developer ID Application**
   certificate in the keychain.
2. Re-run `package-dmg.sh` — it auto-detects the identity and signs the app *and*
   `Resources/node` with `--options runtime --timestamp` (hardened runtime is a notarization
   requirement for every executable; official node builds already carry it under the Node.js
   Developer ID, but re-signing keeps the whole bundle under one identity — defensive and
   cheap). Anthropic's `claude` already carries hardened runtime + timestamp and stays
   vendor-signed — which is also why the script never uses `codesign --deep`: a deep re-sign
   would destroy that signature.
3. Submit and staple:

   ```sh
   xcrun notarytool submit packages/menubar/build/Relay-0.1.2.dmg \
     --keychain-profile relay-notary --wait
   xcrun stapler staple packages/menubar/build/dmg-staging/Relay.app
   xcrun stapler staple packages/menubar/build/Relay-0.1.2.dmg
   ```

4. Result: no "Open Anyway", no translocation, first launch just works.

## 7. Hosting + landing page

Host the artifact on **GitHub Releases**, beside the extension zip (coordinate the tag with
whoever owns `packages/extension` — one release train, §8). Prepared command (do not run
until the release is cut):

```sh
gh release create v0.1.2 \
  packages/menubar/build/Relay-0.1.2.dmg \
  switchboard-0.1.2.zip \
  --title "Switchboard 0.1.2" \
  --notes "First packaged daemon: Relay.app now ships its own runtime (node + single-file sidekick + agent CLI). Drag to /Applications, click start, paste the token."
```

Ready-to-paste **step 02** replacement copy for the landing page (currently the npm/dev
instructions):

> **02 — Run the sidekick**
>
> Download **Relay.dmg** and drag Relay into **Applications** (it has to live there — macOS
> quarantines apps run from Downloads). First open: macOS will balk — go to **System
> Settings → Privacy & Security → Open Anyway**, then reopen.
>
> Click the Relay mark in your menu bar, hit **start**, then **token** — and paste it into
> the extension. That's it: your Claude, brokered on your machine.
>
> *Prefer the terminal? `npm i -g @thelastprompt/switchboard && switchboard start` still works.*

## 8. Versioning

One release train, three artifacts, one number — currently **0.1.2**:

| artifact | where the version lives |
|---|---|
| Relay.app | `packages/menubar/Info.plist` → `CFBundleShortVersionString` (bump `CFBundleVersion` too) |
| extension | `packages/extension/manifest.json` |
| npm | `@thelastprompt/switchboard` (`packages/sidekick/scripts/build-npm.mjs` dist) |

Bump all three together; tag `v<version>`; the DMG filename follows the Info.plist
automatically.

## 9. Future work

- **Sparkle auto-update** — needs Developer ID first (§6); appcast on GitHub Pages.
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
