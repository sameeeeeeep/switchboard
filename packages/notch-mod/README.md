# Switchboard Notch

When Claude asks you something, the question drops from your Mac's notch as a native card, so you
can answer without switching back to the terminal.

![A question from Claude shown as a card at the Mac notch, with three numbered options and a text box](assets/card-light.png)

- **Click an option** to answer. The card never takes your keyboard when it appears, so typing in
  another app can't answer it by accident.
- **Click the card** to use keys: **1–4** picks an option, **↵** confirms the highlighted one
  (Claude's recommendation starts highlighted), **esc** dismisses it and the question appears in
  Claude Code as usual, so it is never lost
- **Click the text box** to answer in your own words

Needs macOS 13+ and Claude Code **v2.1.287** or later (`claude --version`). It is a Claude Code
[mod](https://code.claude.com/docs/en/plugins/mods/overview): it hooks Claude's `AskUserQuestion`
tool and nothing else.

## Try it for one session

Nothing is installed and nothing is written to your settings:

```sh
claude --plugin-url https://github.com/sameeeeeeep/switchboard-notch/releases/latest/download/switchboard-notch.zip
```

Ask Claude something that makes it ask you back, or run `/notch test`.

## Keep it

In Claude Code (v2.1.275+ adds the marketplace and installs in one step):

```text
/plugin install switchboard-notch --marketplace sameeeeeeep/switchboard-notch
```

Updates: `claude plugin update switchboard-notch@switchboard-notch`.

## Settings

| Command | Effect |
| --- | --- |
| `/notch cursor` | Open cards beside the pointer instead of at the notch |
| `/notch notch` | Back to the notch |
| `/notch off` / `/notch on` | Use Claude Code's own dialog / the card |
| `/notch test` | Show a test card |

Multi-select, free-text and number questions always use Claude Code's own form.

## Examples

Any request where Claude stops to ask you a question shows the card. Three to try:

1. **A design choice.** "Add a settings page to this app. Ask me which layout to use before you
   build it." The card shows the layouts Claude proposes, with its pick highlighted. Press **1–4** or **↵**.
2. **A risky step.** "Clean up the old migration files, but ask me before deleting anything." Claude's
   question lands at the notch while you work in another app; answer it there and Claude carries on.
3. **Your own answer.** "Help me name this CLI tool and ask me to choose." Ignore the options, type
   a name in the card's text box, and press **↵**. Claude receives exactly what you typed.

`/notch test` shows a sample card without asking Claude anything.

## Where it works

Cards appear when Claude Code runs on your Mac: the `claude` CLI in any terminal, and the Desktop
app's Code tab once it ships Claude Code v2.1.287. In other places, such as cloud sessions, the mod
steps aside and Claude Code asks as usual. Chat on claude.ai and Cowork don't run Claude Code mods,
so the plugin does nothing there. On Windows and Linux the card can't open, and Claude Code asks
as usual.

## Troubleshooting

- **No card appears.** Run `claude --version` (needs v2.1.287+), then `/plugin` and look for
  `switchboard-notch` in the `mods active` line under the tabs. Run `/notch test`. If `/notch` is off, run `/notch on`.
- **The card opens on the wrong screen.** Run `/notch cursor` to open it beside the pointer.
- **You'd rather answer in the terminal.** Press **esc** on any card, or run `/notch off`.

## What it does on your machine

Everything the mod does is in [`hooks/register.js`](hooks/register.js) (about 90 lines):

- **Which tool it answers, and when.** It handles only Claude Code's `AskUserQuestion` tool, and
  only single-choice questions. When you pick or type an answer in the card, the mod returns that
  answer in place of Claude Code's own question dialog, in the same shape the dialog returns. If you
  press esc, the card times out (9 minutes), the question is multi-select, text or number, or the
  card can't start, it hands the question back to Claude Code's dialog unchanged.
- **The one program it starts, and why.** It runs `helper/sb-card` (in this plugin) to draw the card,
  with one argument: a JSON object holding the question, its options, and where to show the card.
  It starts nothing else and runs no shell.
- **What it reads, and where that goes.** It reads the question Claude is asking (part of your
  conversation) and passes it to `helper/sb-card` as that argument. `helper/sb-card` prints your
  answer and exits, and the mod gives the answer back to Claude. Nothing is sent anywhere else: the
  mod makes no network requests, and neither does `helper/sb-card`.
- **What it stores.** Only your `/notch` setting (on or off, notch or cursor), in Claude Code's
  local storage for this plugin.

`helper/sb-card` is a small native macOS program built from
[`helper/sb-card.swift`](helper/sb-card.swift) (about 230 lines of AppKit and SwiftUI). It needs no
permissions and writes no files. It is signed with Developer ID (STAYOFT VENTURES PRIVATE LIMITED,
55354KFTHU) and notarized by Apple. To list the mod's hooks and calls yourself, run
`claude plugin validate` on this directory.

## Privacy

Switchboard Notch collects nothing. The question, its options and your answer pass only between
Claude Code and `helper/sb-card` on your Mac. There is no network access, no analytics and no
account. The only thing saved is your `/notch` setting (on or off, notch or cursor), in Claude
Code's local storage for this plugin; uninstalling the plugin removes it.

## Support

Report problems or ask questions at
[github.com/sameeeeeeep/switchboard-notch/issues](https://github.com/sameeeeeeep/switchboard-notch/issues).
For security issues, email [sameeeeeeep@gmail.com](mailto:sameeeeeeep@gmail.com) instead of opening a public issue.

## Develop

The source lives in [`packages/notch-mod`](https://github.com/sameeeeeeep/switchboard/tree/main/packages/notch-mod)
in the Switchboard repo, which also holds the build and release scripts; this repo is a mirror.

```sh
claude --plugin-dir "$PWD"          # load a checkout for one session; edits hot-reload
claude plugin test                   # unit tests (no session needed)
```
