# Switchboard Notch

When Claude asks you something, the question drops from your Mac's notch as a native card, so you
can answer without switching back to the terminal.

- **1–4** picks an option, **↵** confirms the highlighted one (Claude's recommendation starts highlighted)
- **Type** in the box to answer in your own words
- **esc** dismisses the card and the question appears in Claude Code as usual, so it is never lost

Needs macOS 13+ and Claude Code **v2.1.287** or later (`claude --version`). It is a Claude Code
[mod](https://code.claude.com/docs/en/plugins/mods/overview): it hooks Claude's `AskUserQuestion`
tool and nothing else.

## Try it for one session

Nothing is installed and nothing is written to your settings:

```sh
claude --plugin-url https://github.com/sameeeeeeep/switchboard/releases/download/notch-v0.1.0/switchboard-notch.zip
```

Ask Claude something that makes it ask you back, or run `/notch test`.

## Keep it

In Claude Code (v2.1.275+ adds the marketplace and installs in one step):

```text
/plugin install switchboard-notch --marketplace sameeeeeeep/switchboard
```

Updates: `claude plugin update switchboard-notch@switchboard`.

## Settings

| Command | Effect |
| --- | --- |
| `/notch cursor` | Open cards beside the pointer instead of at the notch |
| `/notch notch` | Back to the notch |
| `/notch off` / `/notch on` | Use Claude Code's own dialog / the card |
| `/notch test` | Show a test card |

Multi-select, free-text and number questions always use Claude Code's own form.

## Where it works

Cards appear when Claude Code runs on your Mac: the `claude` CLI in any terminal, and the Desktop
app's Code tab once it ships Claude Code v2.1.287. In other places, such as cloud sessions, the mod
steps aside and Claude Code asks as usual.

## What it does on your machine

The mod's only action is to run `helper/sb-card`, a small native program that draws one card and
prints your answer. It needs no permissions, makes no network requests, and exits as soon as you
answer. The binary is signed with Developer ID (STAYOFT VENTURES PRIVATE LIMITED, 55354KFTHU) and
notarized by Apple. Its source is [`helper/sb-card.swift`](helper/sb-card.swift). To see what the mod
hooks before you load it, run `claude plugin validate` on this directory.

## Develop

```sh
claude --plugin-dir "$PWD"          # load this checkout; edits hot-reload
claude plugin test                   # unit tests (no session needed)
./build.sh                           # rebuild, sign and notarize helper/sb-card
```
