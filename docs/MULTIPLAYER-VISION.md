# Multiplayer + Slack — founder vision (2026-09-01)

Captured live from the founder. This is a connected vision, not four separate asks — the **sprite/presence
layer** is the thread that runs through all of it. Nothing built yet; this is the record to plan against.

## 1 · Remove the Chrome-extension dependency COMPLETELY
The app must not need the Chrome extension. Everything the extension does (window.claude injection, connect,
side panel) moves to the native app / native gateway. A user never installs an extension.
(founder: "need to remove dependency from the chrome extension completely")

## 2 · Move Team Mode into the app
Team Mode (today: packages/sidekick/src/team/* + TeamSection.swift + a relay worker) becomes fully native /
in-app — not dependent on the extension or an external surface.
(founder: "move the team mode to the app as well")

## 3 · Multiplayer — join "as the other person," their SPRITE on your screen
The option to be multiplayer: another person joins, and you SEE them — **their sprite shows up on your
screen** (live presence — a cursor/avatar/sprite), "and more". Real co-presence, not just shared files.
(founder: "give the option for multiplayer as the other person … person's sprite showing up on your screen
and more")

## 4 · Slack integration — tasks INTO your notch, from Slack
Link Slack so someone can hand you a task from Slack that lands on YOUR board / notch:
- **`/notch @sameep please send the new logo`** — sends the task to that person; it gets **added to their own
  board** (the notch task board). Gentle: it queues on their board.
- **`/hijack sameep please send the new logo`** — same delivery, but AGGRESSIVE: **the sender's sprite
  follows the recipient's cursor/arrow and locks them out of doing anything else** until they handle it. A
  presence-driven takeover — the other person's sprite literally drives/blocks your pointer until the task
  is done.
(founder: "if someone has a task for me they could send it through slack like /notch @sameep … added to
their own board, or /hijack sameep … which would do the same but have their sprite follow my arrow to not
let me do anything else")

## How the pieces connect (the thread)
- The **sprite/presence layer** is shared by #3 (a teammate's sprite on your screen) and #4 (the sender's
  sprite in `/hijack`). Build it once: a native overlay that renders a remote person's sprite/cursor, fed by
  a presence channel over Team Mode's existing transport.
- `/notch` and `/hijack` are Slack INGRESS onto the **notch task board** (the existing Tasks kanban / tasks.md)
  + the presence layer (`/hijack` = a remote-driven cursor lock, a sibling of the guide/CursorGuide overlay
  that already points + can drive).
- Removing the extension (#1) + native Team Mode (#2) are the FOUNDATION the multiplayer + Slack ride on.

## Open (being mapped by investigation before a plan)
- Exactly what the extension is load-bearing for, and what's lost by dropping it (third-party-site injection).
- Team Mode's current transport/sync + how a presence/cursor channel rides it.
- The Slack surface: a Slack app with slash commands → the daemon → the recipient's board/overlay.

## 5 · Switchboard as an INTEGRATION for others' internal apps
Someone with their own internal app can integrate Switchboard to get this use case — the presence /
notch-task / hijack / multiplayer capability — inside their own product. So this is a platform/SDK surface,
not just our own app. (founder: "if someone has their own internal app they could also integrate switchboard
for this use case")

## 6 · Many sprites in a wrapp — screenshare + multiplayer, sprites not cursors
The classic "many cursors in a doc" (Figma/Google-Docs style) but FOR A WRAPP — and richer: like a
SCREENSHARE **and** multiplayer for that wrapp at once, with **sprites instead of cursors**. Multiple people
in the same live wrapp session, each shown as a sprite, seeing + acting together.
(founder: "the typical many cursors in a wrapp, but this would have to be like screenshare but also
multiplayer for that wrapp and instead of cursors we'll have sprites")

## The unifying primitive
One thing underneath all of it: a **sprite-based presence + shared-wrapp session** layer.
- teammate on your screen (#3), the `/hijack` takeover (#4), many-in-a-wrapp (#6) are all the SAME primitive
  — remote people rendered as sprites, riding a presence channel over Team Mode's transport, on a native
  overlay — at different intensities (passive presence → co-editing → cursor-locking takeover).
- Slack (#4) is one INGRESS; the integration SDK (#5) exposes the primitive to others' apps.
- All native (#1) on native Team Mode (#2) — no Chrome extension.
Build the sprite-presence + shared-session primitive once; everything else is a mode/ingress on top.

---

# The plan (after mapping the codebase, 2026-09-01)

## What the maps found — the foundation is ~90% built
- **Extension removal is mostly DONE in code.** The native wrapp window already injects the same
  `window.claude` (GodWebWindow GOD_SHIM_JS + GodDaemonBridge, same pairing token, shared
  grants/consent/audit). The extension only bridges on first-party origins; third-party sites (Canva/Figma/
  Notion) get a DISPLAY-ONLY nudge, no data. → "Remove the dependency" is not a rebuild; the real cost is
  ROLLOUT: ~97 deployed wrapps each bundle their own connect chip, so they must be rebuilt/redeployed to drop
  the "install the extension" path. Plus a parity audit of the side-panel controls (Team/Cloud densest) and
  flipping consent:write / context-pick to menubar-default.
- **Team Mode's ENGINE is fully built + proven headless** (packages/sidekick/src/team/*): sealed AES-256-GCM
  star transport, invite-code host/join, per-file LWW sync, Cloudflare zero-knowledge relay for cross-network,
  git backing, cloud backup. **Presence data already exists** (members[] online/lastSeen, heartbeats,
  broadcastPresence). It is NOT usable via the app only because TeamSection.swift is a draft NOT in the build
  and there is NO ~/.relay/team.json mirror for the app to read. "Move to the app" = ~4 small wiring pieces,
  ZERO engine/protocol changes.
- **The sprite channel is a few lines.** The sealed transport carries arbitrary JSON; adding a
  `kind:"cursor"` fan-out frame needs no crypto/protocol/relay change (fire-and-forget, un-persisted, ~20-30Hz).
  The render host already exists: the `glow` "second cursor" overlay (GlowModel, RelayMenuBar.swift ~2287-2361)
  is full-screen, click-through, rides fullscreen, and already tracks a moving point — swap its sparkle for a
  sprite driven by a remote peer. Sprite art: emote.js generates die-cut pixel-art character stickers (one per
  teammate); life-is-a-game has rigged avatars.

## Build order
- **Phase 0 — Foundation (small, days).** Surface Team Mode natively: daemon writes ~/.relay/team.json on
  change; Model.team + readTeam(); add TeamSection.swift to build.sh + a disclosure row; wire 6 closures to the
  existing team.* control verbs. (Extension: flip consent defaults + parity audit in parallel.)
- **Phase 1 — The sprite-presence PRIMITIVE (the keystone).** Add `kind:"cursor"` fan-out to the team
  transport; a fast daemon→app presence push; a native sprite overlay reusing the glow/NotchTray recipe;
  emote-generated sprites, coords normalized per display. Result: a teammate joins → their sprite on your
  screen.
- **Phase 2 — The modes on the primitive.** passive presence → many-sprites-in-a-wrapp (anchored inside the
  wrapp — needs a shared coordinate model per wrapp) → /hijack (remote-driven cursor lock; the CursorGuide
  overlay already points AND can drive).
- **Phase 3 — Ingresses.** Slack /notch (task → the existing Tasks kanban board) + /hijack (Slack → takeover);
  the SDK surface for others' internal apps.
- The 97-wrapp extension-chip redeploy runs as a parallel cleanup track.

## The real decisions (founder's)
1. **The semantic question:** sprite on the raw SCREEN (ambient co-presence — ships fast, the glow overlay is
   ready) vs. sprite anchored INSIDE a shared wrapp (the "many cursors in a wrapp" — richer, but needs a shared
   per-wrapp coordinate/document model that doesn't exist yet). Recommendation: ship screen-ambient FIRST, then
   in-wrapp.
2. **First slice:** recommend Phase 0 + Phase 1 together — surface Team Mode + get a real teammate's sprite on
   your screen. It's the wow, and it rides an already-built, already-proven secure transport.
3. **Extension rollout timing:** the ~97-wrapp redeploy to fully drop "install the extension" — now, or later
   as a cleanup track while the multiplayer work goes first?

---

# The core model (founder, 2026-09-01): REALTIME OVERLAY SHARING over a FIXED wrapp

The keystone reframe — supersedes the "screenshare vs shared-session" fork:

- The **wrapp is a FIXED, deterministic surface** both people load LOCALLY. Same wrapp → identical layout on
  both screens → a **shared coordinate space for free**. It is NOT streamed.
- What is shared LIVE is the **OVERLAY on top of it** — every person's sprite/cursor, and their actions —
  broadcast in realtime over the (already-built, sealed) team transport. No video, no pixels on the wire.
- Result: crisp, low-latency, fully INTERACTIVE co-presence on a surface you both actually run — "what native
  screenshare could never be" (screenshare is a one-way pixel video of one machine; this is a shared live
  layer over a shared fixed surface).
- **The overlay is the product; the wrapp is the fixed common ground.** This unifies #3 (sprite on screen),
  #6 (many sprites in a wrapp) and `/hijack` (drive the overlay): all are the realtime overlay at different
  intensities, over the same fixed wrapp.
- Confirms the build: the sprite/cursor `kind:"cursor"` (+ action) channel over the transport, rendered by a
  native overlay, positioned in the fixed wrapp's coordinate space. No per-wrapp shared-coordinate model to
  invent — the wrapp's fixedness IS it.

(founder verbatim: "think of it as realtime overlay sharing, wrapp then becomes a fixed thing to share …
it's what native screenshare could never be")

## Extends the model: REMOTE SURFACE CONTROL (founder, 2026-09-01)
Beyond sharing an overlay over a wrapp both already opened — one Switchboard can DRIVE the other's:
- "I tell the other person's Switchboard what wrapp to open, and it copies how it's PLACED and NAVIGATED"
  → the other Switchboard replicates: same wrapp, same window placement, same navigation/view state →
  **duplicate surfaces on both screens**.
- "since the wrapp has multiplayer it can be changed" → the wrapp's own state syncs both ways (the existing
  LWW state sync).
- "imagine being able to change someone else's screen's app when they screenshare" → you **reach in and change
  what app is on their screen** — driving their REAL surface, not a pixel video. Screenshare you can reach into.

**Three layers, all over the one built (sealed) transport:**
1. **Surface control** — open / place / navigate a wrapp on the other's Switchboard (new: a surface-command
   channel + native "open+place+navigate" executor; the ~/.relay/open-wrapp.json + preferredSurface + window
   placement machinery is the local half to drive).
2. **Wrapp state** — the wrapp's multiplayer state, synced both ways (EXISTS: LWW folder/state sync).
3. **Overlay** — live sprites/cursors/actions (the `kind:"cursor"` channel + native overlay); `/hijack` = the
   overlay driving the local pointer.
(founder verbatim: "it's like im telling the other person's switchboard what wrapp to open and it copies how
it's placed and navigated … since wrapp has multiplayer it can be changed — imagine being able to change
someone else's screen's app when they screenshare")
