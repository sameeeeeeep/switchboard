# The cat — complete spec (companion presence, as a wrapp)

The MacCat, generalized from a Team-Mode teammate sprite / a /hijack pest into **ambient companion
presence**. Two cats, both eventually store wrapps you *add*: **your cat** (follows your cursor) and
**God's cat** (bundled with the notch, reacts when God needs you). This spec covers the WHOLE experience
— intro, right-click, removal, every state/edge — not just "a cat that follows the cursor."

Content angle (founder): it's a **focus companion** — "I have ADHD and this cat keeps me on my work."
Like MacCat's own block-distractions feature, the cat can later nudge/block social sites during focus.

## 1. What it is — the intro (legibility)

A cat appearing unannounced is confusing. On **first ever appearance**, introduce it, once:

- **Speech bubble from the cat itself** (recommended): a small tag above the cat — *"hi, I'm your cat. I
  hang out while you work. right-click me anytime."* — auto-dismisses after ~6s or on first right-click.
  Feels native to the cat; no modal.
- *(alt: a one-time notch card.)*
- Persist `userCatIntroShown=true` so it never repeats. "What's this?" in the right-click menu re-shows it.

## 2. Right-click — the menu (the control surface)

Right-clicking the cat opens a small menu:

- **What's this?** — re-show the intro bubble
- **Focus mode** — (phase 2) the cat keeps you on task; blocks distraction sites while on
- **Hide the cat** — turn it off now (reversible; see §3)
- **Cat settings…** — opens the panel's Companion section (your cat on/off · God's cat on/off · focus)

**Technical (the real gap):** the overlay is `ignoresMouseEvents = true`, so clicks pass through. To catch
a right-click ONLY on the cat while the rest of the screen stays click-through:
- Set the panel `ignoresMouseEvents = false`, but override hit-testing so only the **cat's sprite frame**
  is hit-testable (SwiftUI: `.contentShape(Rectangle())` on just the cat + `.allowsHitTesting(false)` on
  the empty background; at the panel level, return `nil` from `hitTest` unless the point is in a cat rect).
- Left-clicks on the cat still pass through (don't steal the user's click); only **right-click** is caught.
- Everything not-the-cat stays fully transparent to the mouse.

## 3. How to remove it (reversibility — the miss)

Three ways, all reversible:
- **Right-click → Hide the cat** — immediate.
- **Settings → Companion** — Your cat [toggle], God's cat [toggle], (phase 2) Focus mode.
- **(phase 2) the store** — it's a wrapp; remove = uninstall the wrapp, re-add = install it.

State persists (`userCatOn`, default ON for now — see the open question). Removing = `setUserCat(false)`
+ persist; the overlay tears down cleanly when nothing else needs it (teammates / pester still work).

## 4. States & edges (completeness)

- **Multi-monitor:** the cat should live on the screen the **cursor** is on and cross with it (today the
  overlay pins to `NSScreen.main` — needs to follow the active screen).
- **Fullscreen apps:** must render over them — the panel already uses `.fullScreenAuxiliary` +
  `.canJoinAllSpaces` (the notch-over-fullscreen fix); verify with a fullscreen app.
- **Idle:** sits / grooms / stretches when you stop moving (already in the brain).
- **Coexistence:** your cat + God's cat + teammate cats + a /hijack pest can all be on screen at once,
  each its own brain; the overlay is shared.
- **Persistence:** survives relaunch; intro shown once, ever.
- **Performance:** one shared 30fps overlay; the cat is a lightweight sprite loop — no idle CPU when
  hidden (panel torn down).

## 5. God's cat (next build, same spec shape)

- **Bundled with the notch** ("God comes with the notch"): appears wherever the notch is; sits near it.
- **Behavior:** idles by the notch; **moves toward you / waves when God needs your attention** (driven by
  God's glow-state ≠ idle); rides along if the notch moves.
- Same intro/right-click/removal grammar as your cat (right-click God's cat → "what's God doing?", hide).

## 6. Build order

1. ✅ Your cat follows your cursor (shipped, `5993f45`) — but **incomplete** per this spec.
2. **Complete your cat:** intro bubble · right-click menu (with the hit-testing fix) · Settings → Companion
   toggle (removal). ← *do this next; it's the missing half of what already shipped.*
3. God's cat (§5).
4. Phase 2: Focus mode (block distractions) + package both as real store wrapps.

## Open questions (need the founder)

- **Default ON or opt-in?** Shipped default-ON so it's visible; but "a wrapp you add" argues opt-in.
  Recommend: keep default-ON *for now* (so it's felt), with the intro bubble + easy removal making it
  non-annoying — flip to opt-in when the store packaging lands.
- **Intro: speech bubble (native to the cat) or a notch card?** Recommend the bubble.
