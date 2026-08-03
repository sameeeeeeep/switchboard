# Non-AI widgets — the library slate & modularity model

**Status:** research + one shipped proof. Companion to [STORE-TAXONOMY.md](./STORE-TAXONOMY.md) (the item
taxonomy + device-lightness doctrine). This doc answers the founder's question directly — *"which open-source
libraries? what size? what license? why are they light?"* — for the slate of **non-AI utility widgets**
(taxonomy type 11): pure in-tab tools that run with **no model, no cost, no cloud round-trip, no egress**.

The hard constraint (STORE-TAXONOMY.md Part 3): **nothing may slow the user's machine.** So every library
here is judged on the one axis that matters — *weight on the device* — and slotted onto the engine-weight
ladder: **L0** (browser built-ins, zero deps) › **L1** (small JS/WASM bundled in the tab, < ~1 MB) › **L2**
(heavy WASM, opt-in, downloaded on first use, cached once at the shared origin).

> **Rule 0 (the routing ladder, STORE-TAXONOMY.md R5):** a widget that can run at L0 must not reach for L1;
> one that runs at L1 must never call a model. We spend weight only when the lighter tier genuinely can't do
> the job. Sizes below are approximate min+gzip and should be re-checked at bundle time (`esbuild --analyze`).

---

## Part 1 — The library slate

Each row: **widget · the library to wrap (don't reinvent) · approx size · license · engine tier · why it's
device-light.** All are permissively licensed (MIT/BSD/Apache/ISC) unless flagged.

### Image — resize / convert / compress  ✅ **BUILT (see Part 3)**

| Job | Library | Size | License | Tier | Why light |
|---|---|---|---|---|---|
| Resize / format-convert / recompress | **native `<canvas>`** (`createImageBitmap` → stepped `drawImage` → `toBlob`) | **0** | — | **L0** | Ships in every browser. Decode + resize + JPEG/PNG/WebP encode are all native C++; JS just orchestrates. This is what the built wrapp uses. |
| Higher-quality downscale (Lanczos) | **pica** | ~35 KB | MIT | L1 | Optional upgrade over canvas' bilinear; runs the resample in a Web Worker + optional WASM, off the main thread. We ship L0 and name pica as the declared L1 escalation. |
| Turn-key compress-to-target-size | **browser-image-compression** | ~12 KB | MIT | L1 | Canvas + Web Worker; iterates quality to hit a byte budget. Thin wrapper — only reach for it if "compress to ≤ N KB" becomes a first-class feature. |
| HEIC → JPEG/PNG | **heic2any** (wraps `libheif-js` WASM) | ~1–3 MB WASM | MIT (libheif LGPL/MIT) | **L2** | Only path for iPhone HEIC in-browser. Declare as a `lazy` engine so the WASM downloads **only** when a HEIC is dropped, and cache once at the shared origin. |

### File / data conversion — CSV ↔ JSON ↔ YAML ↔ Markdown

| Job | Library | Size | License | Tier | Why light |
|---|---|---|---|---|---|
| CSV parse/serialize | **papaparse** | ~19 KB | MIT | L1 | The reference CSV lib; streaming parser, handles quoting/edge cases a hand-rolled split never will. Pure JS, no deps. |
| YAML parse/serialize | **js-yaml** | ~30 KB | MIT | L1 | Battle-tested YAML 1.1; deterministic, synchronous, no deps. |
| Markdown tables ↔ data | **native** (a ~30-line table (de)serializer) | 0 | — | L0 | Trivial to do without a lib once CSV/YAML/JSON are covered. |
| (HTML → Markdown, if needed) | **turndown** | ~12 KB | MIT | L1 | Only if the converter grows an HTML lane. |

> **This directly kills an anti-pattern.** Today's `convert` wrapp burns a **cloud Sonnet call** to reshape
> JSON↔CSV↔YAML (`examples/apps/src/convert.js`, `scope.models:["sonnet"]`). papaparse + js-yaml do it
> deterministically, instantly, offline, for $0. The converter should be reclassified as an L1 non-AI widget.

### PDF — compress / merge / split / rotate

| Job | Library | Size | License | Tier | Why light |
|---|---|---|---|---|---|
| Merge / split / rotate / delete pages / fill forms | **pdf-lib** | ~200–400 KB | MIT | L1 | Pure JS, **zero WASM, zero native**. Reads/writes PDF structure directly — merge/split/rotate is byte-surgery, not rendering, so it's fast and light. Covers the majority of "PDF tools". |
| Compress via image re-encode | **pdf-lib** (extract → recompress embedded images → re-embed) | (as above) | MIT | L1 | Handles the common "my PDF is huge because of scans" case without a heavy engine. |
| Ghostscript-grade recompression | **mupdf-wasm** / **Ghostscript-WASM** | ~15–30 MB WASM | AGPL ⚠️ / (MuPDF AGPL ⚠️) | **L2** | Only for "maximum compression." **License caution:** MuPDF/Ghostscript are AGPL — a licensing decision, not just a weight one. Declare `lazy`, cache once, and treat the AGPL question as a gate before shipping. Most users never need this tier. |

### QR code — generate

| Job | Library | Size | License | Tier | Why light |
|---|---|---|---|---|---|
| Generate QR (canvas/SVG) | **qrcode** (node-qrcode) | ~15 KB | MIT | L1 | Pure JS, renders to canvas or SVG string. No network, no deps. |
| Styled/branded QR | **qr-code-styling** | ~40 KB | MIT | L1 | Optional; dots/logos/gradients. Only if "pretty QR" is a feature. |

### Color palette — from an image

| Job | Library | Size | License | Tier | Why light |
|---|---|---|---|---|---|
| Dominant color + N-color palette | **color-thief** | ~5 KB | MIT | L0/L1 | Reads pixels off a `<canvas>` and runs median-cut quantization in JS — the same canvas we already decode into. Effectively L0 (native decode) + a few KB of JS. |
| Richer swatches (vibrant/muted) | **node-vibrant** (browser build) | ~30 KB | MIT | L1 | Heavier quantizer; only if the palette needs vibrant/muted/dark roles. |

### Archive — zip / unzip

| Job | Library | Size | License | Tier | Why light |
|---|---|---|---|---|---|
| Zip / unzip / gzip | **fflate** | ~8 KB | MIT | L1 | The smallest, fastest pure-JS (de)compressor; streaming + optional Web Worker. Prefer over JSZip (~100 KB, dual MIT/GPL). |

### Hashing / checksums

| Job | Library | Size | License | Tier | Why light |
|---|---|---|---|---|---|
| SHA-256 etc. | **native `crypto.subtle.digest`** | 0 | — | **L0** | SHA family is built into the browser. Zero deps. |
| MD5 / CRC / fast bulk | **hash-wasm** | ~small WASM | MIT | L1 | Only for algorithms `subtle` lacks (MD5) or very large files where its streaming WASM wins. |

### Audio — trim / clip

| Job | Library | Size | License | Tier | Why light |
|---|---|---|---|---|---|
| Waveform + region-select UI | **wavesurfer.js** (+ Regions plugin) | ~30 KB | BSD-3 | L1 | Renders the waveform via Web Audio; the trim UI is pure canvas. |
| Trim + export **WAV** | **native Web Audio** (`decodeAudioData` → slice `AudioBuffer` → encode WAV) | 0 | — | **L0** | Decoding is native; slicing a buffer + writing a WAV header is ~40 lines. Lossless, zero deps — the light default. |
| Trim + export **MP3** | **lamejs** | ~100 KB | LGPL | L1 | Pure-JS MP3 encoder. Reach for it only if MP3 output is required; WAV export stays L0. |
| Full transcode (any A/V codec) | **ffmpeg.wasm** | ~30 MB WASM | LGPL/GPL ⚠️ | **L2** | The universal fallback for formats the browser can't decode. Always `lazy` + shared-origin cache; never bundled. Out of scope for "light." |

**License note:** everything above is safe to bundle (MIT/BSD/ISC/Apache or LGPL-as-a-separate-module)
**except** the AGPL PDF engines (MuPDF/Ghostscript) and GPL builds of ffmpeg — those are deliberate,
reviewed decisions at L2, not casual imports.

---

## Part 2 — The modularity model (how a non-AI widget plugs in)

The whole point of STORE-TAXONOMY.md: **a non-AI widget is not a new data model — it's the same
`WrappListing` with model absent.** Concretely, in this repo a widget is exactly the same four files every
wrapp has, minus the LLM plumbing:

| Piece | File | What changes for a non-AI widget |
|---|---|---|
| **Manifest / listing** | `wrapps/<id>/switchboard.json` | `category:"tool"`, `surfaces:["browser"]`, `requires:[{kind:"daemon"}]` — **no `{kind:"model"}`**. Carries a `resource` profile with `needsModel:false`, `egressTier:"none"`, `engineTier`, `downloadBytes`. |
| **App logic** | `src/<id>.js` | `scope.models: []` and **zero `relay.stream()`/`relay.complete()` calls**. The connect chip mounts for identity, but the pipeline runs before/without any connection. All work is the chosen library + `<canvas>`/Web APIs. |
| **Shell** | `<id>.html` | House "Atlas cockpit" design tokens (identical to every wrapp), plus a **"no AI · on your device"** badge driven by the resource profile. |
| **Build wiring** | `build.mjs` entry + `build-catalog.mjs` | One line added to esbuild `entryPoints`; the catalog aggregator validates the manifest and folds in the God tool (see below). No router change — the taxonomy's thesis. |

**Three rules make this modular rather than ten bespoke apps:**

1. **The library is a bundled dependency (L1) or a declared engine (L2) — never a hidden import.** L0/L1
   libs are bundled by esbuild into `dist/<id>.js` and their weight is counted in `resource.downloadBytes`.
   L2 engines are a `{kind:"engine", name, sizeBytes, lazy:true}` requirement, consented + sized like a
   model download, **cached once at the shared origin** and served to every widget that declares it (one
   30 MB ffmpeg, not 30 MB × N).

2. **The resource profile is the honesty contract.** `needsModel:false` makes the store badge the card
   **"OFFLINE · 0 MB · no AI · no cost"** *before* Get. `validateListing` can be extended to reject a
   UI-only utility that declares a model (the `convert`-burns-Sonnet smell).

3. **The action is exposed to God for free.** Wrapping the pipeline in one `exposeToGod({...})` (harvested by
   `build-tools.mjs` into the catalog) means the same in-tab, no-model function God can drive headlessly —
   the widget becomes one of God's "hands" with zero extra code.

This is why the slate scales: each new widget is *"pick the lightest library on the ladder, wrap it in the
four-file house template, declare the resource profile."* The 80-line resize wrapp below is the mold.

---

## Part 3 — The shipped proof: the **Resize** wrapp

An **image resizer / converter / compressor** built end-to-end as the pattern proof. It resizes, converts
(PNG · JPEG · WebP) and recompresses any image **entirely in the tab** with **no model call** and **no
network egress**. Engine tier **L0** — pure `<canvas>`, zero external codec libraries (pica named as the
declared L1 upgrade path, deliberately *not* pulled in, per Rule 0).

**Files:**

- `examples/apps/src/resize.js` — the app logic. `scope.models:[]`, zero `relay.stream()/complete()`.
  Pipeline: `createImageBitmap(file)` → **stepped-halving high-quality downscale** (the pica trick in ~12
  lines of native canvas) → `canvas.toBlob(mime, quality)` → object-URL preview + download. Modes: longest-
  side cap · exact width · percent. Formats: JPEG/PNG/WebP with a quality slider. Exposes a
  `resize_image` God tool (data-URL in → data-URL out, still zero model). Re-encoding strips EXIF/GPS as a
  free privacy win.
- `examples/apps/resize.html` — house-styled shell; drop-zone + a green **"Runs fully on your device · no AI
  · no upload · no cost"** badge.
- `examples/apps/wrapps/resize/switchboard.json` — the listing: `category:"tool"`, `requires:[{daemon}]`,
  and a `resource` profile `{ egressTier:"none", engineTier:"L0", downloadBytes:0, background:false,
  needsModel:false }`.
- `examples/apps/build.mjs` — added `resize: "src/resize.js"` to the esbuild entry points.

### How it was verified to run in-tab with no model / no heavy runtime

1. **Bundled clean.** `node build.mjs` → `dist/resize.js` (38 KB). Source grep confirms **zero**
   `relay.stream()/relay.complete()`/`agentic` calls (the one match is a comment stating that fact).
2. **Catalog validated.** `node wrapps/build-catalog.mjs` → the `resize` listing passes `validateListing`,
   the `resource` profile passes through, and the `resize_image` God tool is harvested (catalog now 66
   listings, up from 65).
3. **Ran in a real Chromium tab.** Served `resize.html` and drove the live page via the browser:
   - Synthesized a **1200×800 PNG (964 KB)** in-tab, then ran the pipeline three ways —
     **longest-side 400 → JPEG** = 400×267, 3.8 KB · **percent 50 → WebP** = 600×400, 3.9 KB ·
     **exact-width 300 → PNG** = 300×200, 35.7 KB. Aspect preserved, all three formats encoded correctly,
     ~99.6% size reduction on the JPEG path.
   - Called the **`resize_image` God tool** end-to-end with a data-URL → returned a 200×133 JPEG data-URL.
   - **Network panel: zero requests** during the entire resize run — the load-bearing proof that no model,
     no server, and no upload are involved. Everything is native `<canvas>` on the main/worker thread.
   - Visually confirmed the rendered drop-zone UI + the "no AI" badge.

### Recommended next widgets (in device-lightness order)

1. **Data converter** (L1, papaparse + js-yaml) — reclassify `convert` off its Sonnet call. Highest-value,
   lightest, kills a live doctrine violation.
2. **PDF toolkit** (L1, pdf-lib) — merge/split/rotate/compress-via-image. Big perceived value, pure JS.
3. **QR generator** (L1, qrcode) and **color-palette-from-image** (L0/L1, color-thief) — trivial, delightful
   notch widgets.
4. **Audio trim** (L0 WAV export via Web Audio; lamejs only if MP3 is demanded).
5. **HEIC → JPEG** (L2, heic2any) — first `lazy` engine; proves the shared-origin cache path.
