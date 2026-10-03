# Ask Notch: directory listing (new submission, 0.2.0)

Ask Notch replaces the **switchboard-notch** submission (portal id `ce733ea6-f8b8-4e94-bcbf-836559d96e85`,
v0.1.3, in human review). It is a new plugin name, so it is a **new submission**, not a version of the old one.

Portal: https://claude.ai/directory/manage. For plugins, the portal reads the listing from
`.claude-plugin/plugin.json` and `README.md`. To change a field, edit the file, run `./build.sh && ./publish.sh`,
and **Re-validate**. Everything below is either already in those files or is an answer you give in the form.

## What changed vs switchboard-notch

| | switchboard-notch 0.1.x | Ask Notch 0.2.0 |
| --- | --- | --- |
| Name | `switchboard-notch` / Switchboard Notch | `ask-notch` / Ask Notch |
| The card | `helper/sb-card`, a compiled Swift binary (signed + notarized) | `helper/card.js`, plain JavaScript run by macOS's own `/usr/bin/osascript -l JavaScript` |
| Directory scan | "ships code the scan can't read" (the binary) | no compiled code; every file is readable text or a PNG |
| Look and behaviour | Claude design language card | the same card, pixel-matched (see `compare-0.2.0.jpg`) |
| Keyboard on appear | could be handed activation when the app that started it was frontmost | appears as a background-only app, refuses to become key until clicked, hands activation back if macOS gives it anyway |
| Settings | `/notch on\|off\|notch\|cursor\|test` | the same, plus `/notch companion cat\|off` (off by default) |
| Repo / install | `sameeeeeeep/switchboard-notch` | `sameeeeeeep/ask-notch` |

## Source step (typed in the portal)

| Field | Value |
| --- | --- |
| Repository | `sameeeeeeep/ask-notch` |
| Plugin path | leave empty (the plugin is at the repository root) |
| Branch or tag | leave empty (follows `main`) |

Submit the small mirror repo, not `sameeeeeeep/switchboard` with path `packages/notch-mod`.

## Listing details (read from plugin.json and README.md)

| Field | Value | Source |
| --- | --- | --- |
| Name (permanent) | `ask-notch` | plugin.json `name` |
| Display name | Ask Notch | plugin.json `displayName` |
| Short description | Claude's questions drop from your Mac's notch as a card. Click an option, pick with 1-4, type your own answer, or press esc to answer in Claude Code as usual. | plugin.json `description` |
| Long description | The README | `README.md` |
| Icon | `./assets/icon.png` (512×512; still the Switchboard dot mark, replace if Ask Notch gets its own) | plugin.json `icon` |
| Version | 0.2.0 | plugin.json `version` |
| Author / publisher | sameeeeeeep | plugin.json `author.name` |
| License | MIT | plugin.json `license` + `LICENSE` (copied by publish.sh) |
| Homepage | https://github.com/sameeeeeeep/ask-notch | plugin.json `homepage` (live once the repo exists) |
| Repository | https://github.com/sameeeeeeep/ask-notch | plugin.json `repository` |
| Documentation URL | https://github.com/sameeeeeeep/ask-notch#readme | plugin.json `documentationUrl` |
| Support URL | https://github.com/sameeeeeeep/ask-notch/issues | plugin.json `supportUrl` (enable issues on the new repo) |
| Privacy policy URL | https://github.com/sameeeeeeep/ask-notch#privacy | plugin.json `privacyPolicyUrl` |
| Keywords | notch, macos, mod, questions, AskUserQuestion | plugin.json `keywords` |
| Category | if asked: **Developer tools**, then **Productivity** | portal |
| Supported surfaces | Claude Code only (macOS). Hooks are "Ignored" in Chat. | derived |

## Three working examples (Directory Policy 3.E, also in the README)

1. "Add a settings page to this app. Ask me which layout to use before you build it." → the card shows the
   layouts, with Claude's pick highlighted; click one, or click the card and press 1–4 or ↵.
2. "Clean up the old migration files, but ask me before deleting anything." → the confirmation question
   appears at the notch while you're in another app; answer it there and Claude carries on.
3. "Help me name this CLI tool and ask me to choose." → click the card's text box, type your own name and
   press ↵; Claude receives exactly what you typed.

## Data handling step (answer in the form)

| Question | Answer |
| --- | --- |
| Does the plugin read or store personal data? | **No.** It reads the text of Claude's `AskUserQuestion` call to draw the card. It stores only the `/notch` settings (on/off, notch/cursor, companion) in Claude Code's local mod storage. |
| Does it send data to services other than its declared connectors? | **No.** It has no connectors and makes no network requests. The card is `osascript` running `helper/card.js`, a local one-shot window that prints the answer to stdout. |
| How long does it keep data? | It keeps no data. The settings stay until the plugin is uninstalled. |
| Is it intended for people under 18? | **No.** |

## Privacy (the README's Privacy section, for reference)

Ask Notch collects nothing. The question, its options and your answer pass only between Claude Code and
`osascript` running `helper/card.js` on your Mac. No network access, no analytics, no account. The only thing
saved is your `/notch` settings, in Claude Code's local storage for this plugin; uninstalling removes it.

## Compliance step

1. Check that the prefilled contact email is one you read. Security contact: sameeeeeeep@gmail.com.
2. Select all four acknowledgements (Directory Terms and Directory Policy).

## Review and submit step

- **How new versions reach the directory**: keep **GitHub push webhook**, then **Set up push updates**
  (needs admin on `sameeeeeeep/ask-notch`). `./publish.sh` pushes to `main`.
- **Auto-publish passing versions**: leave off for the first submission.
- Select **Submit for review**.

## Reviewer notes (paste if the form has a notes box)

> Ask Notch is a Claude Code mod (hooks/register.js, Claude Code v2.1.287+) that handles only the
> `AskUserQuestion` tool call. For single-choice questions it runs macOS's built-in
> `/usr/bin/osascript -l JavaScript helper/card.js '<json>'`, a readable script (JavaScript for Automation,
> AppKit bridge) that draws one window and prints the picked label, which the mod returns in the same shape as
> Claude Code's own dialog. Esc, a 9-minute timeout, multi-select, or any card failure falls through to Claude
> Code's own dialog (`next(e)`), so a question is never lost. The plugin ships no compiled code. The card makes
> no network requests, writes no files, reads no environment and needs no permissions; it appears without
> activating and refuses the keyboard until clicked. Optional `/notch companion cat` shows small PNGs from
> `assets/companion/cat/` (the author's own painted art). `claude plugin validate` lists every hook and call.
> No test account is needed. To test: install, run `/notch test` on a Mac, or ask Claude "ask me which layout
> to use for a settings page". This replaces our earlier submission switchboard-notch (withdrawn).

## Owner's portal checklist

Nothing below has been run. In order:

1. Review and merge branch `ask-notch-0.2.0` in `sameeeeeeep/switchboard` (relay repo).
2. Human test card on your Mac (the one thing not automated): `claude --plugin-dir "$PWD"` in
   `packages/notch-mod`, run `/notch test`; while typing in another app the card must not take keys; click
   an option (answers in one click); run it again, click the card, press `2`; again, click the text box and type
   `2 apples` ↵; again with `/notch cursor` and `/notch companion cat`. Optional: `sh tests/card-selftest.sh`.
3. Create the mirror: `gh repo create sameeeeeeep/ask-notch --public` (enable Issues).
4. `cd packages/notch-mod && ./build.sh && ./publish.sh` (pushes the mirror, creates release v0.2.0 with
   `ask-notch.zip`).
5. Portal → switchboard-notch submission `ce733ea6-f8b8-4e94-bcbf-836559d96e85` → **Withdraw**.
6. Portal → **Submit new** → **Plugin bundle** → repository `sameeeeeeep/ask-notch`, then the steps above
   (data handling, compliance, push webhook, reviewer notes) → **Submit for review**.
7. Optional: archive `sameeeeeeep/switchboard-notch` or point its README at ask-notch.

## Assets in this folder (not shipped in the plugin)

- `card-light.png`, `card-dark.png`: 880×624 renders of the card (also `../assets/card-*.png`, the README image).
- `card-cat-light.png`, `card-cat-dark.png`: the card with `/notch companion cat`.
- `compare-0.2.0.jpg`: old sb-card vs new card.js, light and dark, the pixel difference, the cat, and two real
  on-screen window captures (notch + cat, cursor mode).
- `render-card.js`: paints the card to a PNG with card.js's own painter, without opening a window.
- `make-companion.py`: builds `../assets/companion/cat/` from the painted orange cat.
