# Onboarding = adding your first wrapps (and the cat is the first one)

The everything-is-a-wrapp direction ([[relay-everything-is-a-wrapp]]) made concrete for onboarding.
Switchboard stays the AI routing app; the whole experience is *assembled from wrapps you add*, and
**adding a wrapp accrues its capabilities**. Onboarding should therefore be the first ADD — not a lecture.
The cat retrofits from a hardcoded default into **the first wrapp you add**, proving the model end-to-end.

## The model

- A **wrapp** = a thing you add that brings a capability. Adding it is a first-class, visible act (with a
  little payoff — the cat mews and says hi).
- **Onboarding = your first adds.** After the ignition + senses/gestures, the tour's payoff becomes:
  "here's your first wrapp — add it." The cat is that first add (delightful, low-stakes, instantly felt).
- **Capabilities accrue.** Each added wrapp lights up what the system (and other wrapps) can do. The cat
  adds *ambient presence*; later, Flow adds *voice*, etc. The store shows this ("adding Flow gives voice
  to your board").

## The cat as the first wrapp (retrofit)

Today: `userCatOn` default TRUE, hardcoded in the controller. Target: the cat is an **addable wrapp**.
- A catalog entry **"God's cat"** (category: companion) — appears in the store like any wrapp.
- "Add" = enable it (`userCatOn = true`) + the welcome beat (mew + intro bubble). "Remove" = the Settings
  toggle / uninstall. So the Settings→Companion toggle and the store "Add/Remove" are the same state.
- **Migration (don't yank it):** existing installs keep the cat on (it's already there). NEW installs get
  it OFF until the onboarding "add your first wrapp" step adds it — so the *add* is a real, felt moment.

## Phased plan

- **Phase 1 — the cat becomes a wrapp you add.** Register "God's cat" as a catalog/store listing;
  route its installed-state to `userCatOn`; keep it on for existing users, off-by-default for fresh
  installs. (Low risk — no tour surgery yet.)
- **Phase 2 — the onboarding ADD step.** Add one tour beat after the gestures: "Meet God's cat — Add it,"
  which flips it on with the mew/intro as the payoff. (Touches `Onboard` — `tourCount`, the tour views —
  so it's the delicate part; build + show before shipping.)
- **Phase 3 — generalize.** The same add-a-wrapp beat offers the next wrapps (Flow, …); capability
  accrual surfaced in the store. Notch/Flow themselves become catalog wrapps.

## What NOT to do (lessons from the cat build)

- Don't regress existing users (keep their cat on). Don't do risky tour surgery without the founder
  seeing it (the tour is visual + hard to test headlessly). Ship Phase 1 first; it's safe and provable.
