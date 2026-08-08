# OS wiring — the broken flows (P1 work-list)

**Status:** findings · companion to [`OS-SPEC.md`](OS-SPEC.md) · grounded by walking three real user flows
end-to-end through the code (menubar + daemon + God + wrapps). This is the "looks fine, isn't wired" list.

Method: don't audit screens — walk journeys. We traced **add a task**, **have a project**, **open a recent
run**, each including the **AI-consumption leg**. Every break below has file:line evidence.

---

## The 5 root causes (why it's "not properly wired")

Every symptom rolls up to one of these. Fix the root, many symptoms close.

1. **No AI read-path into the vault.** The model sees a truncated `contexts.json.data` blob and **nothing**
   of `tasks.md` / `note-*.md` / `dictionary-*` / artifacts. God folds only `proj.data` sliced to **700 chars**
   (`god.mjs:882-885`); the daemon's wrapp context is pull-only `data`, no vault (`server.ts:1074`). The core
   promise — *your Claude, grounded in your work* — is broken at the root: **the AI can't see your work.**
2. **Nothing is addressable.** Tasks have no id; artifacts pass no storage key on open
   (`OSLaunchContext.artifact` is a *display title*, not a key — `OSShellView.swift:38-43`); vaults bind by
   **origin, not project id** (`bankVaultFolder:1099`). So nothing can be reopened, re-dated, or correctly scoped.
3. **Writer/reader contract drift.** Wrapps write shapes the readers don't expect: `decisions` as an object
   map but Bank casts `[String]` (`OSSurfaceWorkspace.swift:1128`) → silently dropped; `data.folder` written by
   only one flow; `data.repo` never written but read; ~11+ fields stored and never surfaced. No schema → silent loss.
4. **No liveness / eventing.** Every surface re-reads only in its own `onAppear`; there is **no** file watcher,
   timer, or notification anywhere in the OS surfaces. Cross-surface and cross-actor updates are invisible until
   a manual navigate-away-and-back. The rail badge loads **once** and never recomputes (`OSShellView.swift:586`).
5. **Affordances promise what the data can't keep.** Inert cards, a "Reopen ▸" that can't reopen a result,
   roadmap UI never populated, decisions advertised but dropped. The surface implies a flow the wiring doesn't back.

---

## Flow A — "a user adds a task"

Happy path works on the board: `TaskAddInline → submitAdd (OSSurfaceWorkspace.swift:355) → osAppendTask (:256)
→ tasks.md → load() → osTasksAll (:201)`. Then it falls apart:

| # | Break | Evidence | Min fix |
|---|---|---|---|
| A1 | **No-due-date task is invisible outside the Tasks board** — Calendar/Needs/Home/Dashboard/badge all key on `due:`/overdue | `OSSurfaceWorkspace.swift:774`, `OSSurfaceAutomate.swift:693`, `OSShellView.swift:481` | add an "Open tasks" Dashboard tile from `osTasksAll().filter{!done}`; Home/Needs show "N open", not only overdue |
| A2 | **AI never reads `tasks.md`** — God injects only `contexts.json` data | `god.mjs:883` | fold `<activeVault>/tasks.md` open items into God's prompt (root cause #1) |
| A3 | **Bank connector reads a different vault** (`~/SwitchboardBrain`) than the OS binds, and isn't wired into God/daemon | `bank-mcp.mjs:30`; `server.ts:38` imports only the brand extractor | default connector VAULT to the OS bound folder; wire task tools in |
| A4 | **No live refresh** — surfaces re-read only on `onAppear` | grep: no FSEvents/DispatchSource/Timer in surfaces | one `tasks.md`/`contexts.json` watcher → each surface `load()` (root cause #4) |
| A5 | **Rail "Needs" badge computed once, never refreshes** | `OSShellView.swift:586` | recompute on `selected` change or via the watcher |
| A6 | **All-projects quick-add lands in the alphabetically-first vault, not the active project** | `addFolder → osTaskFolders().first`, sorted `:197` | prefer active context's vault; show which file the line hit |

---

## Flow B — "a user has a project" (what the user *and* the AI can see)

Bank Overview/Hero read `data{}`; Tasks/Brain/Artifacts read the **filesystem** (vault + storage).

| # | Break | Evidence | Min fix |
|---|---|---|---|
| B1 | **`decisions` never renders** — writer object map vs reader `[String]` cast. The single most important "why" field of every AI-made project silently dropped | reader `OSSurfaceWorkspace.swift:1128`; writers `ideabrain.js:271`, `bootstrap.js:60` (live: 6/7 are dicts) | handle the `[String:[String:String]]` shape in `bankOverviewFields` |
| B2 | **Vault files never reach the AI** — tasks/notes/dictionary/artifacts invisible to the model | `god.mjs:882-885`, `server.ts:1074` | fold vault gists into God + `resolveContext` (root cause #1) |
| B3 | **God truncates project context to 700 chars** — rich projects mostly cut | `god.mjs:885` `JSON.stringify(data).slice(0,700)` | raise cap + send a curated subset, not a blind byte-slice |
| B4 | **`data.folder` set by only one writer** → Tasks & Brain permanently empty for ideabrain/brandbrain/bank/bank-mcp projects (a full Overview but "No vault folder bound") | only `point.js:771` writes it | those writers set `data.folder`; or `bankVaultFolder` falls back to `~/.relay/bank/<id>` |
| B5 | **OS-created project is blank on all four facets and stays blank** — `data:{}`, no folder; "Bank it" writes to `~/.relay/bank/<id>` which `bankNotes` can't see | `bankCreateProject:1229`; capture `:1206`; notes `:1157` | on create, bind `data.folder = ~/.relay/bank/<id>` so capture + Brain line up |
| B6 | **Vault bound by origin, not project** → all sibling projects (e.g. 8+ brandbrain) share one folder → identical Tasks/Brain/Artifacts | `bankVaultFolder:1099-1103` | per-project subfolder `<bound>/<project-id>/` or per-project `data.folder` |
| B7 | **`data.repo` dead read** (no writer) + ~11 orphaned fields (`verdict/whynow/status/roadmap/state/…`) + dead `RoadStagePill` UI never populated | reader `:1119`, `:1064`, `:1618-1657` | read `source.url` for repo; render a generic "More" from unknown scalars or stop writing dead fields |

---

## Flow C — "a user opens a recent run"

| # | Break | Evidence | Min fix |
|---|---|---|---|
| C1 | **Home "Recent work" cards are completely inert** — no Button/gesture; a click does nothing | `ArtifactCard OSShellView.swift:1056-1085` | wrap in a tap → `OSLaunch.launchOr(art.app, .init(artifactKey:…))` |
| C2 | **No artifact identity is ever passed** — `OSLaunchContext.artifact` is a title, not a key; open can only relaunch the wrapp **blank** | `OSShellView.swift:38-43`, `:665/:674`; `launchFromOS RelayMenuBar.swift:6377` | add `artifactKey`+`origin` to `SBArtifact`/`OSLaunchContext`/`#os=`; populate from the storage filename (root cause #2) |
| C3 | **No wrapp restores an artifact from launch context** — all 19 consumers use `ctx.artifact` as a text seed only | `reel.js:17`, `imagegen.js:108`, `crest.js:225`, `os-context.js:8` | `openArtifact(key)` helper + wrapps load the blob by key (blocked on wrapps storing >1 blob) |
| C4 | **History "Reopen" seeds the wrapp with a garbage label** ("Saved") | `OSSurfaceKnowledge.swift:117`, `:355` | don't pass `artifact: run.prompt`; open clean, or relabel "Reopen tool" |
| C5 | **Audit receipts can't show output — the data model has no payload** (`audit.log` = `{ts,origin,tool,outcome}`, no result) | `OSSurfaceKnowledge.swift:67-70` | wrapps write a per-run artifact record (id+payload) at completion; audit carries the id |

---

## The fix primitives (P1 — grouped so one primitive closes many breaks)

Ordered by leverage. Each is a *wiring primitive*, not a per-screen patch.

- **P1.1 — The AI read-path (highest).** God + daemon `resolveContext` fold the active project's **vault** into
  what the model sees: `tasks.md` open items + first-N `note-*` gists + a curated `data` subset (not a byte-slice).
  Closes A2, B2, B3. *This is the one that makes "your Claude sees your work" true.*
- **P1.2 — The addressing contract.** Storage keys for artifacts (`artifactKey`+`origin` through
  `SBArtifact`/`OSLaunchContext`/`#os=`), an `openArtifact(key)` reader in `os-context.js`, and per-project
  vault folders (not origin). Closes C1–C3, B6, and the A6 placement surprise.
- **P1.3 — The writer/reader schema.** Fix `decisions` shape, `folder`-on-create, `repo`←`source.url`, surface
  or stop-writing orphaned fields. Closes B1, B4, B5, B7.
- **P1.4 — Liveness.** One watcher on `tasks.md`/`contexts.json` (+ storage) → surfaces reload; badge recompute.
  Closes A4, A5 (and makes every cross-actor write visible).
- **P1.5 — Honest affordances now (cheap).** Make Home recent cards launch; relabel History to "Reopen tool"
  vs restore; stop the garbage seed; task-completion writes an `audit.log` receipt so RECALL reflects WORK.
  Closes C4, and the "finishing a task leaves no trace" gap from OS-SPEC §4.

**Recommended order:** P1.5 (cheap honesty, hours) → P1.3 (schema, contained) → P1.1 (AI read-path, the
unlock) → P1.2 (addressing, enables real reopen) → P1.4 (liveness, makes it feel alive). None is a rewrite;
each is a seam on the substrate that already exists.
