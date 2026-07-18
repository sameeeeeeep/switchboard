# Browser-Local Models — running wrapps on a model that lives IN the browser

**Status: researched, not built.** This is the design for the third backend family:
models that run inside Chrome itself — no Ollama, no LM Studio, no install beyond the
Switchboard extension the user already has. It joins `claude-code` (subscription) and
`local-openai` (Ollama et al.) in the `BackendRegistry`, and it is the strongest privacy
tier we can offer: the prompt never leaves the browser process's machine, and the model
was never installed as a separate program.

Research current as of mid-2026. Relay surfaces referenced:
`packages/sidekick/src/backends/{types,registry,local-openai}.ts`,
`packages/sidekick/src/server.ts` (complete/startStream at ~L686/L721),
`packages/sidekick/spike/ollama-e2e-spike.mjs` (the proven local-model-through-broker path),
`packages/extension/src/{background,sidepanel}.ts` + `manifest.json`.

---

## 1. The runtimes, compared

| | **WebLLM (MLC)** | **transformers.js v3** | **Chrome Prompt API (Gemini Nano)** | **wllama** | **LiteRT.js / MediaPipe LLM / WebNN** |
|---|---|---|---|---|---|
| What it is | Purpose-built in-browser LLM engine (compiled MLC kernels → WebGPU) | HF pipeline API on ONNX Runtime Web (WebGPU/WASM/WebNN) | Chrome ships + manages Gemini Nano; you get a `LanguageModel` session API | llama.cpp compiled to WASM (CPU only) | Google's tflite-in-browser runtime (Jul 2026) / experimental LLM task / W3C NPU API |
| Acceleration | WebGPU (WASM fallback) | WebGPU or WASM (`device:'webgpu'`) | Chrome-internal (GPU or CPU path) | WASM SIMD + threads, **no GPU** | WASM now; WebNN/NPU on roadmap |
| Browser support | Chrome/Edge 113+, Safari 26, Firefox (recent) — WebGPU ships by default across the big four as of late 2025, ~83% of traffic | Same WebGPU story; WASM path works everywhere | **Chrome only.** Stable for **extensions** since Chrome 138; web pages still origin-trial/flag | Any modern browser (multithread needs COOP/COEP, which MV3 extensions can set via manifest) | Chrome-centric, experimental (WebNN behind a flag in Chromium 121+) |
| 1–4B chat menu | Llama 3.2 1B/3B, Qwen 3 0.6/1.7/4B, Qwen 2.5, Phi 3.5 mini, Gemma 2 2B, SmolLM2 — prebuilt, versioned (`v0_2_84`) | Qwen 2.5 0.5B–1.5B, Llama 1B, Phi — any of ~1,200 pre-converted ONNX models, but chat LLMs >2B get shaky | Exactly one model, Gemini Nano (Nano 4 / Gemma-4-based rolling out later 2026). You don't pick | Any GGUF ≤2GB per file (split beyond that) | Not a practical chat-LLM menu yet |
| Speed (consumer HW) | ~80% of native MLC. Measured: Llama 3.1 8B q4 ≈ 41 tok/s on M3 Max; Phi 3.5 mini ≈ 71 tok/s; 1–2B models typically 30–120 tok/s on ordinary dGPU/Apple Silicon | Good for ≤1.5B; ORT-Web kernels less tuned than MLC for decode-heavy chat | Snappy (Chrome's own scheduling), quality ≈ 3–4B class | A few tok/s for 1B on CPU — usable for embeddings/tiny models only | n/a |
| First-load download | Weights from HF/MLC CDN, cached in **Cache API/IndexedDB**; `initProgressCallback` gives real progress. ~270MB (SmolLM2-360M) → ~2.3GB (Qwen3-4B) | Same pattern (HF Hub → browser cache) | **Chrome downloads/updates the model itself** (once per Chrome profile, shared by every consumer; needs 22GB free disk, >4GB VRAM or 16GB RAM). `monitor → downloadprogress` events | You host/fetch the GGUF; 2GB ArrayBuffer ceiling per file | Model files you host |
| API shape | **OpenAI-compatible** `engine.chat.completions.create({stream})` — maps 1:1 onto our `local-openai` mental model | `pipeline('text-generation')` / generate with streamer callback | `session.prompt()` / `promptStreaming()`; context window small, session-based | completions + embeddings, low-level | task APIs |
| Tool calls | OpenAI-style function calling on supported models (Hermes/Qwen; experimental) | DIY prompt parsing | None (text only out) | DIY | n/a |
| MV3 hosting | Web Worker + Service Worker handlers built in (`ExtensionServiceWorkerMLCEngine`, `examples/chrome-extension-webgpu-service-worker`); WebGPU works in SWs since Chrome 124; offscreen document works | Runs in extension pages/workers; ORT WebGPU-in-SW was patchy (onnxruntime #20876), fine in a document | **Not available in Web Workers** — must call from an extension *document* (offscreen/side panel/popup) | Anywhere WASM runs | n/a |
| Maturity | The de-facto standard, most mature engine of its class, active | Mature for utility models (embeddings, whisper, rerankers); chat LLMs are its weak spot | GA for extensions, but Chrome-only + you don't control model or version | Solid niche | Too new (LiteRT.js released Jul 9 2026) |

### Verdict per runtime

- **WebLLM — the chat backend.** Only runtime that is simultaneously: OpenAI-shaped
  (drops into the same request format as `LocalOpenAIBackend`), WebGPU-fast, curated
  1–4B menu with published VRAM numbers, streaming + interrupt + unload built in, and
  proven inside MV3 extensions. **Recommended.**
- **Chrome Prompt API — the free bonus tier, not the foundation.** Zero download cost
  *to us* (Chrome manages weights), stable for extensions since 138 — but Chrome-only,
  one unversioned model, no tool-call path, unusable from workers, and hardware-gated
  (22GB free disk). Surface it as one more model id (`gemini-nano`) through the same
  backend in Phase 3; never build the architecture around it.
- **transformers.js — the utility sidecar, later.** Wrong tool for chat, right tool for
  fully-local embeddings (Bank vault search), whisper, rerankers. Keep on the shelf.
- **wllama — skip.** CPU-only tok/s doesn't meet wrapp UX; WebLLM's own WASM fallback
  covers the no-WebGPU case badly anyway — on such machines we should route to
  Ollama/Claude instead of pretending.
- **LiteRT.js / MediaPipe / WebNN — watch.** WebNN is the eventual NPU story; nothing
  shippable for chat today.

---

## 2. The realistic model menu (WebLLM prebuilt, `v0_2_84`)

VRAM numbers are from WebLLM's own `prebuiltAppConfig` (authoritative); disk ≈ the
q4f16 weight download, roughly 60–70% of the VRAM figure (rest is KV-cache/runtime).

| Model id (MLC) | VRAM req | ~Download | Class | Notes |
|---|---|---|---|---|
| `SmolLM2-360M-Instruct-q4f16_1-MLC` | 0.38 GB | ~0.27 GB | tiny | spike/dev model, weak quality |
| `Llama-3.2-1B-Instruct-q4f16_1-MLC` | 0.88 GB | ~0.6 GB | 1B | **low-resource default** — runs on almost anything with WebGPU |
| `Qwen3-1.7B-q4f16_1-MLC` | 2.04 GB | ~1.2 GB | 2B | **recommended default ★** — best quality/size in class, tool-call capable family |
| `gemma-2-2b-it-q4f16_1-MLC` | 1.90 GB | ~1.4 GB | 2B | flagged NOT low-resource by MLC |
| `Llama-3.2-3B-Instruct-q4f16_1-MLC` | 2.26 GB | ~1.8 GB | 3B | solid general 3B |
| `Qwen2.5-3B-Instruct-q4f16_1-MLC` | 2.50 GB | ~1.9 GB | 3B | JSON-mode reliable |
| `Qwen3-4B-q4f16_1-MLC` | 3.43 GB | ~2.3 GB | 4B | **quality pick** for ≥16GB machines |
| `Phi-3.5-mini-instruct-q4f16_1-MLC` | 3.67 GB | ~2.2 GB | 3.8B | NOT low-resource |

`-1k` context variants exist for the Llama/Phi/Gemma entries with materially lower VRAM
— useful on weak iGPUs, but 1k context is tight for context-first wrapps (brand context
alone can be >1k tokens), so prefer full-context variants and gate by device instead.

Throughput expectations to set in UX copy: 1B ≈ 60–120 tok/s, 2B ≈ 40–80, 4B ≈ 20–40 on
Apple Silicon / mid dGPU; first token after engine load is fast, but **cold engine load
(weights → VRAM) takes seconds-to-tens-of-seconds even when cached** — the panel must
show "loading model" distinctly from "downloading model".

### Storage reality (multi-GB weights in a browser)

- WebLLM caches weights in the **Cache API / IndexedDB of the host origin**. Hosted in
  the extension, that's the `chrome-extension://<id>` origin: **downloaded once, serves
  every wrapp** — the decisive argument against in-page hosting (per-wrapp-origin GB
  duplication).
- Chrome origin quota ≈ 60% of free disk — fine for a few models; add
  **`"unlimitedStorage"`** to `manifest.json` anyway (removes quota prompts) and call
  `navigator.storage.persist()` (eviction is LRU under disk pressure otherwise;
  extensions are already privileged here).
- Panel must show per-model on-disk size + a delete button (`engine.unload()` frees
  VRAM; deleting the cache entries frees disk), plus `navigator.storage.estimate()` as
  a storage meter.
- WebLLM's experimental cross-origin weight sharing (`cacheBackend:"cross-origin"`)
  exists but is unnecessary in this design — the extension origin already IS the shared
  cache.

---

## 3. Integration design — where the loop lives

### The constraint that decides everything

The doctrine (see `types.ts` header + the backend-expansion decisions): **backends never
make policy; the gate lives with the loop; the loop lives in the daemon.** A browser
model, however, physically runs in the extension. And an MV3 extension **cannot listen
on a TCP port**, so "expose it to the daemon as a local-openai-compatible endpoint" is
impossible in the literal sense — there is nothing for `LocalOpenAIBackend` to `fetch`.

But the daemon and extension already share a duplex WS pipe with request/reply
semantics (`prompt`/`reply` messages — the exact mechanism the ollama spike drives).
So the answer is:

> **A new backend type, `BrowserModelBackend`, that lives in the daemon and implements
> `ModelBackend` exactly like its siblings — but whose `run()` transports the request
> over the existing extension pipe to a WebLLM engine hosted in an extension offscreen
> document.** The completion *loop* (and with it the gate, budgets, model override,
> audit) stays in the daemon; the browser engine is a pure, stateless token generator.

```
 wrapp page (untrusted origin)
   │  window.claude.complete/stream        ← unchanged SDK surface
   ▼
 content script ──► extension background ──► WS ──► sidekick daemon
                                                      │ grants / gate / budgets /
                                                      │ modelOverride / audit
                                                      ▼
                                             BackendRegistry.backendFor(model)
                                   ┌──────────────┼─────────────────┐
                                   ▼              ▼                 ▼
                            ClaudeCodeBackend  LocalOpenAIBackend  BrowserModelBackend
                            (Agent SDK)        (fetch → Ollama)    (WS pipe → extension)
                                                                    │  browser_run {reqId, model,
                                                                    │   messages, maxTokens}
                                                                    ▼
                                              extension background (router, no inference)
                                                                    │ chrome.runtime message
                                                                    ▼
                                              OFFSCREEN DOCUMENT  (chrome.offscreen)
                                              WebLLM MLCEngine · WebGPU · weights in
                                              extension-origin Cache API
                                                                    │ browser_delta* / browser_done
                                                                    ▼
                                              … back up the same pipe → ctx.emit() → page
```

Yes, a token generated two inches from the page travels page → daemon → extension →
offscreen → daemon → page. That round trip is localhost-microseconds against
30–100 tok/s generation, and it buys the invariant that matters: **every completion,
regardless of backend, passes through the same consent/budget/override machinery in one
place.** Do not build a page↔extension shortcut; if latency ever matters, the daemon can
issue signed per-request leases later — an optimization, not a redesign.

### Why the offscreen document (not SW, not side panel, not in-page)

| Host | Verdict |
|---|---|
| **In the wrapp page** | Never. Untrusted origin holds the engine, weights re-downloaded per origin, page lifetime kills the model, no central consent. Breaks the broker model outright. |
| **Extension service worker** | Works (WebGPU in SWs since Chrome 124; WebLLM ships `ExtensionServiceWorkerMLCEngine`) but MV3 SWs are killed after ~30s idle → engine unload → seconds-long VRAM reload on next call. Fine as a fallback, bad as the primary host. |
| **Side panel** | Real document, WebGPU, but only alive while the user keeps the panel open. Panel is a *control* surface (per the panel-surfaces decision), not a runtime. |
| **Offscreen document** ✅ | Hidden extension document created on demand (`chrome.offscreen.createDocument`, reason `WORKERS`/`DOM_SCRAPING`, justification "local model inference"), full DOM + WebGPU + Cache API, lives until we close it, one per extension. Engine survives between calls; close it after N idle minutes to free VRAM. |

Manifest additions: `"permissions": ["offscreen", "unlimitedStorage"]`.
Prompt API caveat: `LanguageModel` is *not available in workers* — another reason the
offscreen *document* is the host: WebLLM and (later) Gemini Nano both work there.

### Pipe protocol (new message kinds on the existing WS + chrome.runtime channel)

Extension → daemon:
- `browser_models` — announced on connect and whenever state changes:
  `{ models: [{ id, state: 'ready'|'not_downloaded'|'downloading', sizeBytes, vramMB }], webgpu: boolean, promptApi: 'available'|'downloadable'|'unavailable' }`
- `browser_delta { reqId, type:'text', text }` / `browser_done { reqId, text, usage }` /
  `browser_error { reqId, message }` — streamed results
- `browser_download_progress { modelId, progress, text }` — forwarded from
  `initProgressCallback`, daemon re-broadcasts to the panel

Daemon → extension:
- `browser_run { reqId, model, messages, system, maxTokens, stream }` — **stateless,
  turn-based** (full message list every call, exactly like `/v1/chat/completions`).
  Statelessness is deliberate: it is what lets the daemon own the future tool loop
  (append `tool` results and re-issue) without the browser holding conversation state.
- `browser_cancel { reqId }` → `engine.interruptGenerate()`
- `browser_download { modelId }` / `browser_delete { modelId }` — only ever triggered
  from panel UI or an explicit consent card (GB downloads must never be a silent
  side effect of a wrapp call)

### `BrowserModelBackend` (daemon side)

```ts
class BrowserModelBackend implements ModelBackend {
  id = "browser";
  // fed by the latest `browser_models` announcement; empty when pipe detached
  async listModels() { return this.announced.filter(m => m.state === "ready").map(m => m.id); }
  async healthy()   { return this.pipeAttached && this.webgpu; }
  async run(params, ctx) {
    if (params.agentic || ctx.allowedTools.length > 0)
      throw new Error("browser backend does not yet support the agentic tool loop"); // fail closed, verbatim local-openai contract
    // send browser_run, pump browser_delta → ctx.emit, resolve on browser_done,
    // reject on browser_error, forward ctx.signal → browser_cancel
  }
}
```

Model ids: keep the raw MLC ids (`Qwen3-1.7B-q4f16_1-MLC`) — grants are **exact-match**
(known gotcha), so ids must be stable strings the user can grant once; don't invent a
prefix scheme that we'd then migrate.

Registry changes (small but real):
1. `BackendRegistry.boot()` registers `BrowserModelBackend` unconditionally (it's just
   unhealthy until a pipe attaches).
2. `refreshModels()` is currently boot-only — server must call it when the extension
   attaches/detaches and on every `browser_models` announcement, else browser models
   never enter `modelToBackend`. (This also fixes the same staleness for Ollama models
   pulled after boot — free win.)

### How it composes with what's already proven

- `server.ts::complete()/startStream()` need **zero changes** — `backendFor(model)`
  already routes, `ctx.emit` already streams, `AbortController` already cancels.
- **Model grants:** browser models appear in the connect consent's `available` list
  exactly as ollama models do in the spike. New grants can include them; existing
  grants can't (exact-match reconnect gotcha) — which is fine because of:
- **The user override is the primary routing path.** `setModelOverride` (proven
  end-to-end in `ollama-e2e-spike.mjs`: app asks for qwen, user forces llama, app never
  knows) means a user can route ANY already-connected wrapp onto a browser model from
  the panel with no wrapp changes and no reconnect. Browser models ride an existing,
  tested rail.
- **Tool use fails closed** (same sentence as `local-openai.ts`). Phase 4 tool loop:
  daemon sends OpenAI-style `tools` in `browser_run`, WebLLM returns `tool_calls`
  (supported on Qwen/Hermes-class models), daemon routes each through
  `ctx.gateToolCall`, appends results, re-issues the turn. The stateless turn protocol
  above was chosen precisely so this lands without touching the extension again.

---

## 4. Egress tiers — the privacy story this unlocks

Per the backend-expansion decision (models ≠ app-scope → `requirements` + `egressTier`):

| Tier | Backends | Panel badge | Claim |
|---|---|---|---|
| `cloud` | claude-code | CLOUD | prompts go to Anthropic under your subscription |
| `local-daemon` | local-openai/Ollama | LOCAL | prompts leave the browser but not the machine |
| `local-browser` | **browser (WebLLM / Gemini Nano)** | **AIRTIGHT · in-browser** | prompts never leave the browser+daemon boundary; no separately installed model runtime; works on a machine where the user *can't* install software |
| `none` | — | OFFLINE | wrapp runs with storage/context only |

`local-browser` is the tier that makes the airgapped-runner story complete for the
store: an untrusted wrapp in the sandbox, routed to a browser model, is end-to-end
incapable of exfiltration — the strongest "MetaMask for AI" demo we have. Panel shows
the tier badge on every origin row; the store (Phase 5) gets a "runs fully local"
filter driven by wrapp `requirements` metadata.

---

## 5. UX plan

**Panel → Models section (side panel, follows brandbrain tokens):**
- Group header `IN-BROWSER · WEBGPU` listing the curated menu (§2) with state chips:
  `GET (0.6 GB)` / `▓▓▓░ 42% · 31 MB/s` / `READY` / `LOADED · 2.0 GB VRAM`.
- Download only ever starts from an explicit click here or from a consent card
  ("This wrapp wants Qwen3-1.7B — download 1.2 GB and run fully local?"). Progress is
  `browser_download_progress` → live panel refresh (the connect-chip live-refresh rail
  already exists).
- Device gating at render time: hide/dim models whose `vramMB` exceeds what
  `navigator.gpu` + `navigator.deviceMemory` suggest; recommend **★ Qwen3-1.7B** on
  ≥16 GB machines, **Llama-3.2-1B** below, SmolLM2-360M as the "just try it" row.
  No WebGPU at all → section collapses to one line: "In-browser models need WebGPU —
  route local work through Ollama instead."
- Storage meter (`navigator.storage.estimate()`) + per-model DELETE.
- Gemini Nano row (Phase 3): `SYSTEM · GEMINI NANO` with `availability()` state; its
  download is Chrome-managed, so the row explains "managed by Chrome" instead of a size.

**Per-origin routing:** the existing model-override dropdown per connected origin gains
an "In-browser (fully local)" group. Override set → origin row shows the AIRTIGHT badge.

**First-completion latency honesty:** three distinct visible states — *downloading*
(once ever), *loading model into GPU* (each cold start, seconds), *thinking* (tokens
flowing). Collapsing them reads as "hung" and users will blame the wrapp.

**Failure recovery:** WebGPU device-lost / OOM → `browser_error` → daemon emits the
standard `error` delta (wrapp UIs already unlock in `finally` per doctrine) + panel
toast suggesting a smaller model. Never leave the offscreen engine in a wedged state:
on error, `engine.unload()` and recreate lazily.

---

## 6. Phased plan

**Phase 0 — spike (1 day).** Prove the runtime on real hardware, no relay changes.
Standalone page under `packages/sidekick/spike/webllm-spike/` (full spec in §7):
download → cache → stream → interrupt → reload-without-redownload → tok/s numbers.
Exit: measured tok/s table for SmolLM2-360M + Llama-3.2-1B on the founder's machine.

**Phase 1 — backend + pipe (2–3 days).** `BrowserModelBackend` + registry
refresh-on-attach in the daemon; `browser_*` messages; offscreen document host in the
extension (manifest: `offscreen`, `unlimitedStorage`); non-agentic complete + stream +
cancel end-to-end. Verify with a `webllm-e2e` variant of the ollama spike driving the
real daemon (with a real Chrome supplying the extension side).
Exit: a wrapp's `relay.stream()` renders tokens generated in the offscreen document,
and `setModelOverride` onto a browser model works with zero wrapp changes.

**Phase 2 — panel UX (2–3 days).** Models section, download consent + progress, storage
meter, device gating, override group, AIRTIGHT badges, error toasts.
Exit: a user with no Ollama routes an existing wrapp fully local in <3 clicks
(+ one download wait).

**Phase 3 — Gemini Nano + store surfacing.** `gemini-nano` model id via the same
offscreen host (`LanguageModel.availability()/create()`, extension-stable Chrome 138+);
wrapp `requirements`/`egressTier` metadata; "runs fully local" store filter.

**Phase 4 — gated tool loop.** OpenAI-style `tools` through `browser_run`, every
`tool_call` through `ctx.gateToolCall`; unlocks agentic wrapps fully local. Shared work
with the identical `local-openai` scaffold — build once, both backends benefit.

**Deliberate non-goals:** wllama/WASM-CPU fallback (route no-WebGPU users to
Ollama/Claude instead), in-page engines, WebNN/LiteRT.js (revisit when WebNN ships unflagged),
cross-origin weight sharing (extension origin already centralizes the cache).

---

## 7. Spike spec (Phase 0, verbatim for the spike builder)

- **Runtime:** WebLLM `@mlc-ai/web-llm@^0.2.84` — npm, or zero-build via ESM CDN
  `https://esm.run/@mlc-ai/web-llm`.
- **Where:** `packages/sidekick/spike/webllm-spike/index.html` (+ optional `main.js`),
  new files only. Serve with `python3 -m http.server 8917` from that directory —
  localhost is a secure context, WebGPU works. Do NOT touch examples/apps build/serve.
- **Models:** primary `SmolLM2-360M-Instruct-q4f16_1-MLC` (~270 MB, fast iteration);
  then repeat with `Llama-3.2-1B-Instruct-q4f16_1-MLC` (~0.6 GB, the realistic floor).
- **API calls:**
  1. `navigator.gpu` presence check → print adapter info.
  2. `CreateMLCEngine(modelId, { initProgressCallback: p => log(p.progress, p.text) })`
  3. `await engine.chat.completions.create({ messages:[{role:'system',content:'You are terse.'},{role:'user',content:'In one sentence, what is a consent broker?'}], stream:true, stream_options:{include_usage:true} })` — append each `chunk.choices[0]?.delta?.content` to the page as it arrives; capture `chunk.usage` on the final chunk.
  4. Mid-stream cancel button → `engine.interruptGenerate()`; then run step 3 again to prove the engine survives interruption.
  5. `engine.unload()` on a button to prove VRAM release.
- **Verify (all must pass):** (a) progress callbacks strictly increase to 1.0 during
  first load; (b) tokens render incrementally, not in one burst; (c) page reload →
  engine ready with **no network re-download** (DevTools Network quiet; init markedly
  faster) proving Cache API persistence; (d) interrupt leaves the engine reusable;
  (e) print tok/s = `usage.completion_tokens / decode-seconds` — expect ≥30 tok/s for
  the 1B on Apple Silicon; (f) record `navigator.storage.estimate()` before/after to
  document real disk cost. Report all numbers in the final message, not a file.

---

## Sources

- WebLLM: [github.com/mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) · [docs](https://webllm.mlc.ai/docs/) · [arXiv 2412.15803](https://arxiv.org/html/2412.15803v2) · prebuilt model config (`src/config.ts`, v0_2_84) · [extension examples](https://deepwiki.com/mlc-ai/web-llm/3.3-chrome-extension-integration)
- Perf/adoption: [localaimaster WebLLM guide](https://localaimaster.com/blog/webllm-browser-ai-guide) · [buildmvpfast WebGPU inference 2026](https://www.buildmvpfast.com/blog/webgpu-browser-ai-inference-cost-savings-2026) · [egnworks](https://www.egnworks.com/blog/running-llms-in-the-browser-with-webgpu)
- Prompt API: [developer.chrome.com/docs/ai/prompt-api](https://developer.chrome.com/docs/ai/prompt-api) · [extensions variant](https://developer.chrome.com/docs/extensions/ai/prompt-api) · [adsm.dev on-by-default note](https://adsm.dev/posts/prompt-api/)
- transformers.js v3: [HF blog](https://huggingface.co/blog/transformersjs-v3) · [docs](https://huggingface.co/docs/transformers.js/en/index) · [Intel in-browser LLM guide](https://www.intel.com/content/www/us/en/developer/articles/technical/web-developers-guide-to-in-browser-llms.html)
- wllama: [github.com/ngxson/wllama](https://github.com/ngxson/wllama) (2GB ArrayBuffer limit, COOP/COEP threads)
- MV3/WebGPU: [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen) · [WebGPU-in-SW discussion](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/ZEcSLsjCw84) · [onnxruntime #20876](https://github.com/microsoft/onnxruntime/issues/20876)
- Storage: [MDN quotas & eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) · [web.dev storage](https://web.dev/articles/storage-for-the-web)
- New entrants: [LiteRT.js announcement](https://developers.googleblog.com/litertjs-googles-high-performance-web-ai-inference/) · [awesome-webnn](https://github.com/webmachinelearning/awesome-webnn)
