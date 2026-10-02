# Switchboard Notch: directory listing draft

Portal: https://claude.ai/directory/manage → **Submit new** → **Plugin bundle**.
For plugins, the portal reads the listing from `.claude-plugin/plugin.json` and `README.md`. You don't
type most of it into a form: to change a field, edit the file, run `./publish.sh`, and **Re-validate**.
Everything below is either already in those files, or is an answer you give in the form.

## Source step (typed in the portal)

| Field | Value |
| --- | --- |
| Repository | `sameeeeeeep/switchboard-notch` |
| Plugin path | leave empty (the plugin is at the repository root) |
| Branch or tag | leave empty (follows `main`) |

Submit the small mirror repo, not `sameeeeeeep/switchboard` with path `packages/notch-mod`. In a subfolder,
the validator also holds `hooks/register.js` ("Scripts the validator couldn't follow"), and `packages/` holds
other plugins.

## Listing details (read from plugin.json and README.md)

| Field | Value | Source | Status |
| --- | --- | --- | --- |
| Name (permanent) | `switchboard-notch` | plugin.json `name` | set |
| Display name | Switchboard Notch | plugin.json `displayName` | set |
| Short description | Claude's questions drop from your Mac's notch as a native card. Pick with 1-4, type your own answer, or press esc to answer in Claude Code as usual. | plugin.json `description` | set |
| Long description | The README, shown as the listing description | `README.md` | set (about 690 words outside code blocks; 40 needed) |
| Icon | `./assets/icon.png` (512×512 PNG, the Switchboard lime dot mark) | plugin.json `icon` | set; reaches GitHub on the next `./publish.sh` |
| Version | 0.1.0 | plugin.json `version` | set |
| Author / publisher | sameeeeeeep | plugin.json `author.name` | set (consider `Sameep Rehlan` or `The Last Prompt` if you want a recognisable publisher) |
| License | MIT | plugin.json `license` + `LICENSE` file | set |
| Homepage | https://thelastprompt.ai/switchboard | plugin.json `homepage` | live (200) |
| Repository | https://github.com/sameeeeeeep/switchboard-notch | plugin.json `repository` | live |
| Documentation URL | https://github.com/sameeeeeeep/switchboard-notch#readme | plugin.json `documentationUrl` | live |
| Support URL | https://github.com/sameeeeeeep/switchboard-notch/issues | plugin.json `supportUrl` | live (issues enabled) |
| Privacy policy URL | https://github.com/sameeeeeeep/switchboard-notch#privacy | plugin.json `privacyPolicyUrl` | **NOT LIVE YET**: the `## Privacy` README section exists only locally until `./publish.sh` runs. The existing https://thelastprompt.ai/switchboard/privacy covers the browser extension and daemon only, not this plugin, so it isn't used. |
| Terms of service URL | not set | plugin.json `termsOfServiceUrl` | optional; there is no thelastprompt.ai terms page (404) |
| Keywords | notch, macos, mod, questions, AskUserQuestion | plugin.json `keywords` | set |
| Category | not asked for plugins in the current docs (only connectors have "one to five categories"). If the form asks, pick **Developer tools**, then **Productivity**. | portal | n/a |
| Supported surfaces | Claude Code only (macOS). The portal works this out from the components. Hooks are "Ignored" in Chat, so the listing will show it doing nothing in claude.ai chat. | derived | expected |

### Short description, alternatives if you want a different one (edit plugin.json `description`)

- Current: "Claude's questions drop from your Mac's notch as a native card. Pick with 1-4, type your own answer, or press esc to answer in Claude Code as usual."
- Shorter: "Answer Claude Code's questions from a native card at your Mac's notch."

### Long description

This is the README. Its sections: what it does (with screenshot) · Try it for one session · Keep it · Settings ·
Examples (3 use cases, which Directory Policy 3.E asks for) · Where it works · Troubleshooting · What it does on your
machine · Privacy · Support · Develop.

## Data handling step (answer in the form)

| Question | Answer |
| --- | --- |
| Does the plugin read or store personal data? | **No.** It reads the text of Claude's `AskUserQuestion` call to draw the card. It stores only the `/notch` setting (on/off, notch/cursor) in Claude Code's local mod storage. |
| Does it send data to services other than its declared connectors? | **No.** It has no connectors and makes no network requests. `helper/sb-card` is a local, one-shot window that prints the answer to stdout. |
| How long does it keep data? | It keeps no data. The setting stays until the plugin is uninstalled. |
| Is it intended for people under 18? | **No.** |

## Compliance step

1. Check that the prefilled contact email is one you read. Anthropic emails it about the submission.
   Security contact: sameeeeeeep@gmail.com (also in the README Support section).
2. Select all four acknowledgements (Directory Terms and Directory Policy).

## Review and submit step

- **How new versions reach the directory**: keep **GitHub push webhook**, then select **Set up push updates**
  (needs admin on the mirror repo). `./publish.sh` pushes to `main`, so each publish becomes a new directory version.
- **Auto-publish passing versions**: leave it off for the first submission. A reviewer publishes the first version anyway.
- Select **Submit for review**.

## Reviewer notes (paste if the form has a notes box, or keep for a reply to a hold)

> Switchboard Notch is a Claude Code mod (hooks/register.js, Claude Code v2.1.287+) that handles only the
> `AskUserQuestion` tool call. For single-choice questions it runs `helper/sb-card`, a native macOS window,
> and returns the picked label in the same shape as Claude Code's own dialog. Esc, a 9-minute timeout,
> multi-select, or any helper failure falls through to Claude Code's own dialog (`next(e)`), so a question is
> never lost. `helper/sb-card` is a universal Mach-O built from `helper/sb-card.swift` (in the repo, about 230
> lines, AppKit + SwiftUI). It is signed with Developer ID (STAYOFT VENTURES PRIVATE LIMITED, 55354KFTHU) and
> notarized. You can rebuild it with `./build.sh`. It makes no network requests and writes no files.
> `claude plugin validate` lists every hook and call. No test account is needed. To test: install,
> run `/notch test` on a Mac, or ask Claude "ask me which layout to use for a settings page".

## Three working examples (Directory Policy 3.E, also in the README)

1. "Add a settings page to this app. Ask me which layout to use before you build it." → the card shows the layouts, with Claude's pick highlighted.
2. "Clean up the old migration files, but ask me before deleting anything." → the confirmation question appears at the notch while you're in another app.
3. "Help me name this CLI tool and ask me to choose." → type your own name in the card's text box and press ↵.

## Assets in this folder

- `card-light.png`, `card-dark.png`: 880×624 captures of the real card (`SB_CARD_APPEARANCE=light|dark helper/sb-card ...`).
  Plugin listings don't take screenshots in the current docs; only MCP Apps have a carousel. The light one is
  embedded in the README from `assets/card-light.png`, which is the published copy.
- The icon is `../assets/icon.png`, rendered from `landing/public/favicon.svg`.
