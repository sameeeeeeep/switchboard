# Autopilot — the autonomous venture cockpit (overnight build)

Built while you slept, on branch **`claude/autopilot-autonomous`**. Goal you set:
*as close to a working Acoco as possible.* Every surface from your Acoco
screenshots is now in the cockpit — real structure, **no fabricated revenue/user
numbers** (the honest line we kept), glass-box where Acoco is black-box.

## Run it (30 seconds)

```bash
cd examples/apps
node build.mjs
node harness/serve.mjs        # then open the URL it prints
```

- **See a company boot itself:** `http://localhost:<port>/h/autopilot?project=nailinit` (a brand) or `?project=switchboard`.
- **Land on the OS in one tap:** `+ New company` → pick a kind (Brand / Product / Wrapp) → type one line → **⚡ Let AI run it**. It drafts the whole route, picks the recommended call at every fork, turns autopilot on, and drops you in a running cockpit. Steer by re-choosing anything.
- **Full run of every wrapp:** `http://localhost:<port>/harness/runner.html` — 40/40 pass.

## The cockpit — one object, both kinds

Four columns (Company · Operations · Growth · Strategy). The middle box swaps by kind:

| | Physical brand (`kind: brand/product`) | Software (`kind: wrapp`) |
|---|---|---|
| middle box | **Supply spine** — Sourced→Co-pack→Fulfil→Ship, pooled-MOQ ("your run rides the platform minimum → a real run's price") + **Merchant-of-Record** card | **Token game** — level (Seed→…→Live), a fuel gauge (your own tokens), milestone ladder |
| money | Product offer → **Set up payments** (gated) → Revenue MTD | **Rev-share** (Spotify model) → Uses / Est. rev-share |
| everything else | identical | identical |

## Acoco parity shipped tonight (7 iterations, each built + harness-green + committed)

1. `3e91874` **Land on the OS first** — "⚡ Let AI run it" fast-track
2. `871ee8b` **Supply spine + Merchant-of-Record** (physical)
3. `9c83f23` **Token game** (software — fund with your own tokens, level up)
4. `4d38b6d` **Tasks system** — Pending/Staged/Recurring/Done/Failed tabs + **Run now**
5. `e65642d` **Documents panel** — every artifact the clone made (briefing log, site, posts, outreach)
6. `521daff` **Fund-with-runway modal** — "works while you sleep", includes list, auto top-up
7. `2e1bb95` **Cockpit polish** — CANVAS "drop an intent → queued work" chips + **provable locks** ("locked · tap to see")

(On the shared base `0e6eb37` — the one venture engine where brand/product/wrapp are the same object.)

## What's real vs. what still needs you (the honest part)

**Real & verified:** the whole operating surface, the autonomous loop (CEO decides + drafts on its own), both kinds, all generation grounded in the lent context, every artifact derived from state.

**Not faked, therefore blank until wired:** every *send* is gated (`relay.callTool` + the daemon's per-action consent) and every *number* reads "not connected" until a real connector reports. To make it actually operate in the world — the gap between this and a live Acoco — needs, exactly as you said (funded + organic takes time), the real pieces: a deploy target per company, a coding/ops agent editing the real codebase (the relay daemon already runs one via the Agent SDK — that's the seed), Stripe, and real outreach accounts. None fakeable overnight; all reachable.

**Nothing pushed public, nothing sent** — that stays your call.
