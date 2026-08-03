# The Switchboard store taxonomy, modularity model & device-lightness doctrine

**Status:** design. Extends [STORE.md](./STORE.md) (the consumer store), [CAPABILITIES.md](./CAPABILITIES.md)
(the daemon capability layer), [GOD-HANDS.md](./GOD-HANDS.md) (notch/widget surfaces),
[BROWSER-MODELS.md](./BROWSER-MODELS.md) (in-browser inference + egress tiers),
[VOICE-CAPABILITY.md](./VOICE-CAPABILITY.md) (a capability as a fillable NEED), and
[TOKENS.md](./TOKENS.md) (the cost receipt). Grounded in the real listing model at
`packages/protocol/src/store.ts` and the catalog at `examples/apps/wrapps/catalog.json` (65 listings).

---

## 0. The one rule that shapes everything else

> **A wrapp = a capability + a skill + a UI** (STORE.md §"What a wrapp is made of"). The store already
> models a listing as a **bill of materials**, not "a web app" (`store.ts` header). We do **not** bolt on
> ten parallel schemas for ten item types. Every store item is the **same `WrappListing` object** playing
> a different **role**, determined by which of its three declared axes are populated:
>
> - **Axis A — components** (what it's made of): `skills`, `workflows`, `ui` (`WrappComponents`).
> - **Axis B — surfaces** (how you run it): `god · batch · browser · window · notch` (`Surface`).
> - **Axis C — requires** (what must hold first): `capability · connector · model · native · daemon`
>   (`Requirement`), diffed against `PresentState` by the pure `resolveRequirements` resolver.

This is the modularity thesis in one sentence: **an "item type" is not a new data model — it is a
recognizable shape of {components × surfaces × requires}.** A skill is a listing that is *only* a
`skills` component on the `god` surface. A widget is a listing whose surface is `notch` with a light
`ui` and few or no `requires`. Adding a type never touches the router — the same discipline
CAPABILITIES.md demands of the daemon ("adding a capability never touches the core").

The proposed extensions below are **additive fields on the existing types** (an additive protocol MINOR,
per CAPABILITIES.md §Rollout) — never a fork of the model.

---

## Part 1 — The unified item taxonomy

Eleven roles a listing can play. Each row: **what it is · what installing wires up · where it runs ·
its dependencies · how it maps onto the existing model.**

| # | Item type | What it is | Installing wires up | Runs in | Depends on | Maps to |
|---|---|---|---|---|---|---|
| 1 | **Capability** | A daemon-provided backend primitive (`sb_db`, `sb_http`, `sb_secrets`, `sb_exec`, `sb_speak`, `vision`, `screen-record`) — CAPABILITIES.md §Model | A per-origin **grant scope** + the capability's provider (e.g. the `voice-cloning` engine backs `sb_speak`, VOICE-CAPABILITY.md) | **Daemon** (the trusted core); `sb_exec` alone runs code, sandboxed | The daemon | A thin, browsable listing whose `requires` is empty and whose *effect* is that other listings' `requires:[{kind:"capability"}]` now resolve. No `ui`, no `surfaces` beyond none. |
| 2 | **Wrapp** | The composite consumer app — the default store citizen | Skill + workflow + UI + all grants at once (STORE.md §17) | Whatever `surfaces` declares | Its `requires` list | The full `WrappListing`: `components{skills,workflows,ui}` + `surfaces[]` + `requires[]`. |
| 3 | **Skill** | A `SKILL.md` — prompt/know-how that aims a capability at a job (`SkillRef`, a path like `yc/register`) | The skill activated into God; à la carte or bundled in a wrapp | **The model's context** (rides one completion). **Zero device weight** — it is text | A model (`requires:[{kind:"model"}]`) | `components.skills`, `surfaces:["god"]`. `primaryAction` → **"Activate into God"** (already in `store.ts`). |
| 4 | **Intelligence / local model** | An inference engine + weights: cloud (Claude), local-daemon (Ollama), or **local-browser** (WebLLM/Gemini Nano, BROWSER-MODELS.md) | Registers a model id; for browser/local it **downloads weights** — only on explicit click/consent | Anthropic cloud · Ollama daemon · **extension offscreen document** (WebGPU) | WebGPU + VRAM (browser); Ollama install (local); nothing to install (cloud) | `requires:[{kind:"model",class:"cloud"|"local"}]`. **The heaviest item class** — governed hardest by Part 3. |
| 5 | **Architecture** | A reusable **backend blueprint**: a named bundle of capabilities + wiring (e.g. *"SQLite-backed API"* = `sb_db` + `sb_http` + `storage`; CAPABILITIES.md §"in-tab logic + sb_db + sb_http + storage covers it") | The capability set + grant scopes a class of wrapps shares; the app's own route logic still ships **in the tab** | **Daemon** (primitives) + **in-tab** (the route handlers) | The capabilities it bundles | A listing that is a set of `requires:[{kind:"capability"}]` with no UI — installed *by* a wrapp or offered as a starter. |
| 6 | **Prompt** | A single reusable, parametrized message/template — lighter than a skill (no folder, no scripts) | Added to a prompt library wrapps/God can reference | The model's context | A model | A degenerate `skills` entry (one file) on `surfaces:["god"]`; **zero device weight**. |
| 7 | **Workflow** | Headless orchestration run in one go — `WorkflowRef` like `yc/batch-draft` | Registered as a runnable workflow (God or a routine kicks it) | **Daemon-orchestrated loop** calling model + tools | A model + any tools/capabilities it calls | `components.workflows`, `surfaces:["batch"]`. |
| 8 | **Routine** | A **scheduled workflow** = workflow + a cron schedule (`sb_jobs`, deferred in CAPABILITIES.md §Deferred; the `cron` wrapp is the input-parser sibling) | A daemon-side **timer**, not a busy loop | **Daemon**, firing on schedule then sleeping | Daemon + the workflow it runs | A workflow listing + a `schedule` field; **must sleep between fires** (Part 3 R4). |
| 9 | **Memory bank (Obsidian-style vault)** | A **Bank** vault — a bound folder of `.md` the daemon indexes; wrapps borrow context from it | A **folder bind** (path-consent, like `folderFor`) + an optional on-disk search index | **Daemon** (storage + index on disk); optional **on-demand** local embedder for search | A folder grant; optionally a tiny local embed model (transformers.js utility tier, BROWSER-MODELS.md §"utility sidecar") | A `studio` listing (`bank` in the catalog) whose context feeds others via `claude_context`; index is `requires:[{kind:"capability",name:"sb_db",lazy:true}]` — **note the `lazy` flag** (Part 3 R2). |
| 10 | **Widget** | A glanceable, interactive **subset** of a wrapp — the notch canvas face (GOD-HANDS.md §4); size classes = result-type taxonomy (`text·image·gallery·html-page·video`) | The notch face + its one primary action | **In-tab / notch webview** | Minimal by design; a **non-AI widget** requires nothing but the daemon | `surfaces:["notch"]` (or a light `browser` ui) + `components.ui`. The device-lightness poster child. |
| 11 | **Non-AI widget** | A widget whose `requires` contains **no model** — a pure in-tab tool (file-convert, image-resize, PDF-reduce). See Part 2 | Just the in-tab UI + WASM/JS libs it bundles | **The tab** (browser process), nothing else | The daemon only (to appear in the store/notch); optionally a declared **engine** (heavy WASM, opt-in) | `surfaces:["browser"|"notch"]`, `requires` with **no `{kind:"model"}`** — the store badges it **"runs on your device, no AI, no cost."** |

### How they compose

- A **wrapp** (2) is a facade over a **capability** (1) + **skill** (3) + **UI/widget** (10), possibly
  standing on an **architecture** (5), possibly driven by a **workflow** (7) on a **routine** (8),
  possibly reading a **memory bank** (9), possibly powered by an **intelligence** (4).
- The **same capability** is shared by many wrapps (STORE.md: "many wrapps share the same few
  capabilities") — the reuse that keeps the device light.
- Composition is enforced by the existing `validateListing`: a surface *implies* a component
  (`god⟹skills`, `batch⟹workflows`, any-UI⟹`ui`), so a listing can never promise a shape it has no
  material for. **Extend this rule**, not replace it.

---

## Part 2 — Non-AI widgets & the modularity model (lean on libraries, never reinvent)

The founder's examples — file-converter, image-resizer, PDF-reduce — must **run on the user's device
with no model, no cost, no cloud round-trip.** Grounding fact: today's `convert` wrapp
(`examples/apps/src/convert.js`) burns a **cloud sonnet call** to reshape JSON↔CSV↔YAML↔Markdown — a
job a 3 KB JS library does deterministically and instantly. **That is the anti-pattern this section
kills.** A data converter should be a **non-AI widget** (type 11), not a model call.

### The engine-weight ladder (pick the lightest tier that does the job)

Every non-AI widget declares which tier it lands on; the store shows the cost **before** install.

| Tier | What | Download | Example widgets | Libraries (existing, don't reinvent) |
|---|---|---|---|---|
| **L0 — native** | Browser built-in APIs, zero deps | 0 | Image resize/convert (PNG/JPEG/WebP), crop, EXIF strip | `<canvas>` `createImageBitmap` + `canvas.toBlob`; `OffscreenCanvas` |
| **L1 — light WASM/JS** | A small library bundled in the tab (< ~1 MB) | tens–hundreds of KB | Data converter, CSV/YAML/MD, zip/unzip, PDF page ops, hashing | `papaparse` (CSV), `js-yaml`, `pdf-lib` (merge/split/rotate/reduce-via-recompress), `fflate` (zip), `pica` (high-quality downscale) |
| **L2 — heavy WASM** | A large WASM engine — **opt-in, sized, downloaded on first use** | 5–35 MB | Audio/video transcode, HEIC→JPEG, Ghostscript-grade PDF compress | `ffmpeg.wasm` (~30 MB), `mupdf-wasm` / Ghostscript-WASM, `libheif` WASM |
| **Model tier** | Anything that needs inference (bg-removal via a seg model, OCR via a vision model) | model-sized | *not a non-AI widget* — declare a `model`/`engine` requirement and badge it | out of scope for "non-AI" |

**Rules of the modularity model:**

1. **Prefer L0 over L1 over L2 over a model.** A widget that could run at L0 must not reach for L2, and
   a widget that runs at L1 must not call a model. (Convert → L1, not sonnet.)
2. **Wrap a mature library; never hand-roll a codec/parser.** The value we add is the *face + the
   broker*, not a reimplementation. Bundle the smallest library that does the job.
3. **Heavy engines (L2) are a first-class, gated requirement — not a silent import.** Add
   `Requirement` kind `{ kind:"engine"; name:"ffmpeg-wasm"; sizeBytes:31457280; lazy?:true }` so an
   `ffmpeg.wasm` download is consented and sized exactly like a model download (BROWSER-MODELS.md:
   "GB downloads must never be a silent side effect"). `lazy:true` means it downloads on **first use of
   that feature**, not at install.
4. **One shared engine cache, never per-wrapp duplication.** A heavy WASM engine (like WebLLM weights,
   BROWSER-MODELS.md §"the extension origin already IS the shared cache") is cached **once** at the
   extension/daemon origin and served to every widget that declares it — never re-downloaded per wrapp.
5. **Data never leaves the tab.** L0–L2 widgets process bytes locally; there is no egress at all. The
   store badge is **`OFFLINE · on your device`** (the `none` egress tier, BROWSER-MODELS.md §4).

### Worked examples (what each declares)

- **File/data converter** → L1, libs `papaparse`+`js-yaml`; `requires:[{kind:"daemon"}]`; egress `none`.
  (Replaces convert's model call.)
- **Image resizer** → L0, no libs; `requires:[{kind:"daemon"}]`; egress `none`; a perfect **notch
  widget** (drop image → resized PNG drops back out via `NSItemProvider`, GOD-HANDS.md §4).
- **PDF-reduce** → L1 `pdf-lib` for image-recompression path (covers most reductions); escalates to L2
  `mupdf-wasm` only for Ghostscript-grade compression, declared as a `lazy` engine so the 20 MB engine
  downloads only if the user chooses "maximum compression."

---

## Part 3 — The device-lightness doctrine (the hard constraint)

> **Nothing is worse than the user's system going slow because of us.** The store's promise is that an
> item is *lighter* than the native app it replaces, not heavier. Weight is a **design constraint**, the
> same standing as "honesty is a design constraint" (DESIGN.md) — enforced in the manifest and the
> resolver, not left to goodwill.

### The eight enforceable rules

**R1 — In-tab is the default; heavier surfaces are opt-in and declared.**
Route logic runs **in the tab** unless the listing declares otherwise (CAPABILITIES.md §"Where does app
code run": keep it in-tab by default, keep the daemon's TCB small). A listing may only touch native or
daemon compute via a **declared, granted** `requires`/`capability`. No item silently spawns a process.

**R2 — No model is ever auto-loaded; the `lazy` flag is the mechanism.**
A model (cloud/local/browser) loads only when a **non-lazy** `{kind:"model"}` requirement is met **and**
the user runs, or **on first invocation** of a `lazy` feature. The resolver already implements this:
`resolveRequirements` reports `lazy` requirements as `⧗ "on use"` and **excludes them from the install
gate** (`store.ts`: "you only pay for what you actually invoke"). **Doctrine:** any capability/model/
engine a wrapp needs for only *one* feature must be declared `lazy`. Installing a wrapp must never load a
model just to sit there.

**R3 — No Python runtime, no native runtime, on the device by default.**
`sb_exec` — the only capability that runs arbitrary code — is **sandboxed, prompted, and shipped last**
(CAPABILITIES.md §Deferred + §Security invariants). Python/venv providers (the `voice-cloning` MLX
engine, VOICE-CAPABILITY.md) are **capability providers the user explicitly installs**, with visible
states (`not-installed → installing → needs-weights → ready → error`) — never a hidden prerequisite. A
wrapp cannot cause a Python install as a side effect; it can only declare a NEED the user chooses to fill.

**R4 — No idle background CPU.**
- Widgets do **zero work when not visible** — no polling, no timers, no rAF loops while backgrounded.
- The browser-model **offscreen engine unloads after N idle minutes** (`engine.unload()` frees VRAM;
  BROWSER-MODELS.md §3, §5). It is created on demand, never on boot.
- **Routines** (type 8) fire on a daemon timer and **sleep between fires** — a scheduled wake, never a
  busy loop. A routine that would poll continuously is rejected.
- The daemon at rest is a router + consent enforcer (a small TCB), not a compute host.

**R5 — Prefer the lightest tier that does the job (the routing ladder).**
`native browser API (L0) > light WASM (L1) > heavy WASM, opt-in (L2) > local-browser model >
local-daemon model > cloud model.` A listing that solves its job at a lighter tier **must not** declare
a heavier one. This is directly reviewable: `convert` declaring `models:["sonnet"]` for a pure-JS job is
a doctrine violation and should be reclassified as an L1 non-AI widget.

**R6 — Every listing publishes a resource profile the store shows BEFORE install.**
Nothing is a surprise (the same posture as `DownloadRef.size`: "shown at consent time so a download is
never a surprise"). Add to `WrappListing`:

```ts
interface ResourceProfile {
  egressTier: "cloud" | "local-daemon" | "local-browser" | "none"; // BROWSER-MODELS.md §4 badge
  downloadBytes?: number;   // heavy engines / native app / model weights, summed
  ramMB?: number;           // steady-state working set
  vramMB?: number;          // only if it loads a browser/local model
  background: boolean;       // does it EVER run when you're not looking? (routines/daemon widgets)
  needsModel: boolean;       // false ⇒ store badges "no AI · no cost · on your device"
}
```

The store card renders it as plain chips **before** the Get button — `OFFLINE · 0 MB · no AI` for a
non-AI widget, `LOCAL · 1.2 GB weights · 2 GB VRAM` for a browser-model wrapp (BROWSER-MODELS.md §5
state chips). "Runs fully local" and "no AI" become **store filters** driven by this metadata.

**R7 — Everything heavy is unloadable and user-visible.**
Models unload on idle (R4); heavy WASM engines are torn down after use; **every cached weight/engine has
a visible size + a DELETE button** and a storage meter (`navigator.storage.estimate()`,
BROWSER-MODELS.md §5). The user can always see and reclaim what an item costs on disk.

**R8 — One shared runtime; never per-wrapp duplication.**
Shared engines (WebLLM weights, heavy WASM, the local TTS engine) live at the **extension/daemon
origin, downloaded once, served to all** — the decisive argument against per-wrapp-origin hosting
(BROWSER-MODELS.md §"Storage reality"). Ten wrapps that use `ffmpeg.wasm` share one 30 MB engine, not
300 MB.

### Enforcement surface (where the doctrine actually bites)

- **Manifest (`switchboard.json`).** The `ResourceProfile` and the `engine`/`model` requirements are
  declared per listing; the ingestion step (`validateListing`, extended) **rejects** a listing whose
  declared components imply a model but whose profile says `needsModel:false`, and flags a UI-only
  utility that declares a model (the convert smell).
- **Resolver (`resolveRequirements`, pure, shared).** Already the single source of "what loads when";
  `lazy` is the load-deferral primitive. The native modal and any web renderer call the same function,
  so they can never disagree about what an item will cost to run.
- **Store card.** Renders the profile up front (R6) — the honesty rung the whole store rests on.
- **Panel.** Shows loaded models/engines with unload + delete + a storage meter (R7), and the egress
  badge per origin (BROWSER-MODELS.md §5).

### The one-line pledge for the store front door

> **Every Switchboard item tells you its weight before you install it, loads nothing until you use it,
> runs on the lightest tier that does the job, and can be fully unloaded — because your machine staying
> fast matters more than any feature.**

---

## Appendix — proposed additive schema deltas (all MINOR, non-breaking)

Grounded in `packages/protocol/src/store.ts`; each is a new optional field or enum member, in the
additive spirit of CAPABILITIES.md §Rollout. **None fork the model.**

1. `WrappListing.resource?: ResourceProfile` — R6.
2. `Requirement |= { kind:"engine"; name:string; sizeBytes:number; lazy?:boolean }` — Part 2 rule 3
   (heavy WASM gated + sized like a model download).
3. `Requirement`'s `{kind:"model"}` gains an optional `egressTier` echo so the gate and the badge share
   one source (BROWSER-MODELS.md §4).
4. `WrappCategory |= "widget" | "capability" | "memory" | "intelligence"` — so the taxonomy's roles are
   browsable as store sections (current values: `studio · tool · fun · agent · skill`).
5. `WrappListing.schedule?: string` (cron) — promotes a `batch` workflow to a **routine** (type 8),
   backed by the deferred `sb_jobs` capability, with R4's "sleep between fires" invariant.
6. Extend `validateListing` with the doctrine checks: profile↔components consistency, and the
   "lightest-tier" smell (a model declared by a job with no `god`/`skills`/agentic surface).
