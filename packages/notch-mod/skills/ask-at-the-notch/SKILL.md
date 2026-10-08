---
name: ask-at-the-notch
description: Use whenever you are about to offer the person a choice, such as two or more approaches, designs, names, or next steps, or need a yes/no or pick-one decision before you continue. Ask it with the AskUserQuestion tool instead of listing the options in your reply, so Ask Notch shows it as a card at the Mac's notch and they answer with one click.
---

# Ask at the notch

Ask Notch shows every `AskUserQuestion` call as a card at the top of the screen. The person answers it with
one click, even when Claude Code isn't the app in front of them. A choice written out in your reply means they
have to come back to Claude Code, read it and type an answer. So when the next step is theirs to pick, ask
with the tool.

## When

- You would otherwise write "Option A … Option B … which do you prefer?"
- You need a go-ahead before something that is hard to undo.
- You are blocked on a preference you cannot work out from the request, the code or a sensible default.

Don't ask when you can decide for yourself. Pick the obvious option, say which one you picked, and keep going.

## How

- Ask one question per call where you can. The card shows one question at a time.
- Give 2 to 4 options. Keep each label to a few words and put the trade-off in its `description`.
- Put your pick first and end its label with ` (Recommended)`. The card highlights it.
- Keep `multiSelect: false`. The card answers single-choice questions only. A multi-select question still works,
  but it opens in Claude Code's own dialog instead.
- The person can type their own answer at the card. Treat a typed answer as the decision.
- If they press esc, the question goes to Claude Code's own dialog, so nothing is lost.
