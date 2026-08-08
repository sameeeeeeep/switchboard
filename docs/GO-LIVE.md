# Switchboard — Go-Live Checklist

**Status:** working doc · **App version:** 0.3.2 (build 24) · **Branch:** `claude/switchboard-go-live`

The launch experience, walked in order: **discover → download → onboard → try (God/Flow/Guru) →
first wrapp → live in the OS → autonomous company.** Every item below is grounded in the actual code
(file refs), classified, prioritized, and sized. `[S/M/L]` = rough effort.

Legend — **P0** blocks launch · **P1** launch-quality · **P2** fast-follow ·
🔴 bug · 🟢 build · 🟠 decision · ⚙️ ops · 📄 docs.

---

## ★ The unlock: native-first launch (extension becomes optional)

The single highest-leverage decision. Today, store/OS launch a wrapp via `NSWorkspace.shared.open(url)`
(`RelayMenuBar.swift:6247,6286`) → it opens in **Chrome → which needs the extension** for `window.claude`.

But the app **already ships a complete, generic native `window.claude` bridge** — `GodWebWindow`
(`GodWebWindow.swift`), a WKWebView that injects the full provider (`request/on/isRelay/claude#initialized`,
every call tunneled to the daemon as the wrapp's origin), proven end-to-end, takes any URL, **needs no
extension**. It's only wired for God + notch widgets.

**Route the first-wave wrapps through this bridge instead of the browser** and the layering becomes:

- **Native window = the bundled first-run experience.** DMG alone = fully working Switchboard. No extension.
- **Chrome extension = the layer-2 superpower** ("run your Claude on *any* website" — the core thesis),
  introduced *after* first value, never a first-run gate.

This resolves the landing-page and onboarding concerns at the root. → **Decision D1** below. `[M]`

---

## P0 — blocks launch

- ✅ **Autopilot defaults to ON — FIXED.** Daemon now seeds `routines-control.json {off:true}` at first
  boot (`registry.ts seedControlIfAbsent`) and `control()` treats an absent/unreadable file as OFF, so
  autonomous routines never run without an explicit opt-in. Existing settings preserved. Verified with a
  sandbox test (seed off / never ticks / not-clobbered / opt-in still works). `[S — done]`
- 🔧 **Autopilot cockpit shows empty — HALF FIXED.** The routine wrote to a hardcoded origin
  (`https_sameep.ai`) while the cockpit reads its *own* serve origin → blank. Code now hardened:
  `AUTOPILOT_ORIGIN` is configurable (`RELAY_AUTOPILOT_ORIGIN`) and folder-named via the real
  `slugOrigin` (no hand-kept literal; default unchanged so no data is orphaned — verified). **Remaining
  half:** the autopilot listing has NO UI url, so the cockpit's actual serve origin is unresolved — pin
  it (bundled `:5188` or a native-window origin) and set `AUTOPILOT_ORIGIN` to match. Rides on **task 8**. `[S left]`
- 🟠 **First-wave ship list not locked.** We ship a curated lineup, not all 76. → **Decision D2**. `[S]`
- ⚙️ **Signed + notarized DMG.** `package-dmg.sh` falls back to ad-hoc signing without a Developer ID →
  Gatekeeper "damaged / Open Anyway" friction on first run. Confirm the Developer ID (`55354KFTHU`) path
  is used for the release build. `[S]`
- ⚙️ **`Switchboard.dmg` GitHub release asset exists** at `releases/latest/download/Switchboard.dmg`
  (`connect-chip.ts:78`) — the exact-name path 404'd once. Verify at cut time. `[S]`
- ⚙️ **Off-repo landing is live** at `thelastprompt.ai/switchboard` (in-repo is only a redirect stub,
  `docs/index.html:7`). Can't be built from this repo — confirm the deploy repo is current. `[S]`

## 1 — Discovery `[phase 1]`

- 🟢 **Catalog integrity guardrail — DONE.** `examples/apps/wrapps/check-catalog-health.mjs` classifies
  every listing (hosted/local/native/broken) + optional `--live` liveness ping. Baseline: 76 listings —
  27 hosted, 47 local (bundled, post-install only), 2 native, 0 broken. Wire into the build/CI. `[S]`
- 🟢 **Collapse the 3 divergent catalog sources** to one. Native store reads built `catalog.json` (76);
  web store hardcodes ~31 cards in `index.html` *and* keeps a separate `ALL_APPS` (42) in `catalog.js`.
  Make the web store read the built catalog. `[M]`
- 🟠 **Discovery shape = HYBRID** (public teaser previews the lineup; running happens post-install).
  Reuses the 42 existing per-wrapp landing pages. *(resolved)*
- 🟢 **"Get" → honest verb.** Native "Get" just opens a URL (`RelayMenuBar.swift:6107`), no install step.
  For v1 (web-app wrapps) that's fine — relabel to "Open/Launch". `[S]`

## 2 — Onboarding `[phase 2]`

- 🟢 **Smooth first-run walk: permissions → hotkeys → first wrapp.** The pointing engine (`CursorGuide.swift`,
  `.tour` mode) is real; the STATES ladder resolver is mostly spec (`docs/STATES.md`). Build the guided
  Act-I setup. `[L]`
- 🟢 **Extension no longer a hard gate** (follows D1). Onboarding gives full value on the DMG alone;
  extension is an optional "unlock the web" step. `[dep: D1]`
- ✅ **Pre-seed one example project/company on first run — DONE (data layer).** Daemon seeds one example
  brand ("Northwind Coffee") + sets it active + binds a project folder with a starter `tasks.md` (4 open +
  1 done, upcoming due dates) on a fresh machine (`seed/example.ts`, wired in `index.ts`). Lights up Bank /
  OS Home / Graph / brandbrain AND Tasks + Calendar (the `due:` lines demonstrate task→calendar wiring).
  Idempotent; real users untouched; tasks.md parses against the exact OS format; binding shape matches
  `osVaultFolders()`. All verified in sandbox. **Only the Swift render needs a build to eyeball.** `[done]`

## 3 — Trial: God + Flow + Guru `[phase 3]`

- 🟢 **God** — core loop works end-to-end (vision → point/speak → drive-a-wrapp). Agentic/multi-step is
  fast-follow. Make it the setup concierge. `[S review + polish]`
- 🟢 **Flow (voice)** — Stage 1 dictation ships in the menubar, proven end-to-end. `[S review]`
- 🟢 **Guru (Presence / guided cursor)** — CursorGuide + notch cards are real. This is the guidance layer,
  not a store wrapp. `[S review]`
- 🟢 All three are **built-ins that ship inside the notch bundle** — not store installs.
- 🔧 **Flow STT bundled — WIRED, pending a build.** The DMG now builds a self-contained `whisper-cli`
  (static, CPU-only) + fetches `ggml-tiny.en.bin` (~75 MB) into `Resources/stt` and code-signs the binary
  (`package-dmg.sh` step 6c + signing). The daemon env + native dictation now PREFER the bundled copy over
  Homebrew (`RelayMenuBar.swift` — `RELAY_WHISPER_BIN/MODEL` + `whisperCliPath/whisperModelPath`). Result:
  Flow dictation works with zero user setup. **Needs `./packages/menubar/package-dmg.sh` on the Mac to
  build/verify** (first run needs cmake+git+network; cached after). base.en is a one-line accuracy upgrade. `[verify on Mac]`
- ✅ **God's voice (TTS) is FINE out of the box** — `speech.ts` falls back to macOS `say` (present on every
  Mac; `ttsAvailable()` true whenever `isMac`). The Pocket-TTS *cloned* voice is an optional on-demand upgrade,
  not required for God to speak. (Earlier "God is mute" note was wrong.) `[no action]`

## 4 — First wrapp `[phase 4]`

- 🟢 **Native-window launch** so brandbrain & co. run without the extension (D1). Test each first-wave
  wrapp (esp. brandbrain + its bundled adapter) in the native window. `[M]`
- 🟢 **Pre-seed an example brand** so brandbrain isn't empty on first open. `[part of the seed task]`
- 🔴 **Redline** fails the harness ("folder-bound, no page on disk"); the *hosted* one may be fine —
  live-check before it headlines, or drop from wave 1. `[S check]`
- ⚠️ **AdPulse** warns — needs a live Meta connector. Wave-2. `[—]`

## 5 — Dashboard / OS `[phase 5]`

- 🟢 **OS is far more done than believed.** All 13 surfaces read real `~/.relay` data; the "12 stubs"
  header comment (`OSShellView.swift:6`) is STALE, `StubDetail` is dead code. **10 good-to-go**
  (Home/Tasks/Bank/Dashboard/Needs/Routines/History/Graph/Apps/Store); **3 real-but-sparse**
  (Calendar, Workflows, Dictionary — wired, but little data to show yet).
- 🟢 **Cross-surface wiring** (founder ask: "adding a task adds a calendar entry"). Partly there —
  Calendar already reads `due:` from `tasks.md`. Audit + close the rest (task↔calendar↔history↔graph). `[M]`
- 📄 **Fix the stale header comment.** `[S]`
- 🟠 **3 sparse surfaces: ship with honest empty states, or hide until they have data?** Recommend ship
  (on-brand: "a fake meter is worse than none"). → **Decision D3**. `[S]`
- 🟢 **Pre-seed project** so the OS is alive on first run (contexts.json + a `tasks.md` with due dates). `[M]`

## 6 — Finalise the wrapps we ship `[phase 6]`

Ship a curated first wave, not the 76. Draft below (harness-grounded) — **confirm/cut → Decision D2**.

**Built-ins (native, in the bundle):** God · Flow (voice) · Guru (Presence).
**Non-AI capabilities (on-device, no model — device-lightness wins):** Convert · QR · Resize · PDF Tools · Palette.
**AI — image:** Prism (image gen). **AI — diagrams:** Canvas. **AI — brand:** brandbrain.
**AI — functional skills (curated top set):** Gist · Polish · Translate · Recap · Reply.
**Studios (candidates):** ideabrain · Deck · Huddle.

Everything else → **wave 2**. Redline, AdPulse gated on the fixes above.

- 🟢 **Curate + tag the launch set.** Add a `launch:true` flag per listing (or a launch manifest) so
  discovery renders the curated lineup while the full catalog stays intact. `[S]`
- 🟠 **Functional shelf:** ship a curated top-10, local-only OK at launch? Recommend yes. → part of D2.

## 7 — Autonomous company `[phase 7]`

- 🟢 **Run layer is REAL** (not the stale "unmerged" memory). Real scheduler (`registry.ts`, 15s heartbeat /
  30-min interval), real move-drafting, real reversible-move execution via wrapps, real file output;
  `cockpit.html` is live-wired to `autopilot-portfolio`. `index.html` + `src/*.js` are an orphaned mock.
- 🔴 Default-off + 🔴 origin-unify — see **P0**.
- 🟢 **Connect one real sender** so "Approve & send" actually sends (today every channel → `no-sender`,
  `server.ts:1305-1377`). Safe-but-inert until then. `[M]`
- 🟢 **Wire cockpit control toggles + "open artifact" link** (`cockpit.html:272-273,249`). `[S]`
- 📄 **Refresh `docs/ROUTINES.md`** — stale ("draft only / God's-hands not wired"); code already executes
  reversible moves. `[S]`
- 🟠 **"Build-while-you-sleep" (Claude-Code tier) is spec-only** — DEFER past launch. `[L, later]`

---

## Open decisions (need founder call)

- **D1 — Native-first launch?** Route first-wave wrapps through the native bridge → extension optional.
  *Recommend: yes.* `[M]`
- **D2 — First-wave ship list.** Confirm/cut the phase-6 draft above. *Recommend: ship the draft.* `[S]`
- **D3 — 3 sparse OS surfaces:** ship with honest empty states / hide / partial. *Recommend: ship all.* `[S]`

## Parked (revisit during the above)

- Bank (the hosted wrapp) — founder flagged "not ready"; fix-for-launch or defer? (brain bucket)
- "Get" → install/entitlement semantics (fine to defer for web-app wrapps).
