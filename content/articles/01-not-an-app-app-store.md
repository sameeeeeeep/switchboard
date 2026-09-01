# it's not an app. it's an app store.

*how a PM who couldn't code ended up building the thing the apps run on.*

---

i've been a PM who couldn't code.

so you're probably expecting the part where i tell you about the first app i shipped. you're not
wrong — except it isn't an app. it's an app store.

let me explain how i got here, because the how is the whole point.

## the thing i couldn't get past

every AI tool on the market wants the same three things from you: a new account, a new
subscription, and a copy of your data.

think about how strange that is. you already pay for Claude. then you pay a second app to call
Claude *for* you — and to do that, you hand it your context, your files, your history. you're
paying twice and giving your data away in the middle. do that across a dozen tools and your work
is scattered over a dozen accounts, none of which talk to each other, all of which have a copy of
something that should have stayed on your machine.

i kept waiting for someone to fix it. nobody did. so, as a PM who couldn't code — until Claude
meant i could — i built the fix myself.

## what switchboard actually is

Switchboard is a Mac app that sits in your menu bar and brokers every call.

the apps — i call them **wrapps** — bring a user interface and nothing else. no API key of their
own, no backend, no login. when a wrapp needs intelligence, it doesn't call a model. it asks
Switchboard, and Switchboard *lends* it the Claude you already pay for, your connected tools, and
your project context — through one consent gate that you own.

that's the first direction: **wrapps use your Claude.**

but it runs both ways, and the second direction is the half most people miss: **Claude uses
Switchboard.** connect a Claude Code session to the same gate and it can pick work off your board,
run your wrapps, and drive your apps for you. your AI stops being a chat window and gets hands.

same broker. one consent gate. all on your machine.

## the five noes

because everything routes through a gate you own, Switchboard can promise things most AI apps
can't:

- **no account** to create.
- **no data** leaves your Mac without a row you approve.
- **no key** resold — you bring your own Claude.
- **no lock-in** — your work is plain files you own.
- **no training** on your data.

privacy shouldn't be the premium tier. here it's the floor.

## the honest part

there are 94 wrapps in the store today. i'll be straight with you: most of them aren't finished.

that's not a roadmap slip — it's ADHD. i get an idea, build the exciting 80%, and the moment the
hard part is solved my brain has already left for the next one. for years i treated that as a
flaw to hide. i'm done hiding it — and soon i'm going to let you decide which of those half-baked
apps actually gets finished. but that's another article.

the point for now is this: a store isn't strong because every shelf is full. it's strong because
of the *model* underneath — your AI, your tools, your data, patched through one board you own —
and because the range is real. a brand studio and a dictation engine and a live guide, all
running on the same Claude, sharing the same context, none of them asking you to sign up.

a PM who couldn't code didn't build an app.

he built the thing the apps run on.

---

*Switchboard is free, runs on your own Claude, and never asks for an account. more soon.*
