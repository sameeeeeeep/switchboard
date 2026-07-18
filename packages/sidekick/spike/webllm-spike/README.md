# webllm-spike — Phase 0 of docs/BROWSER-MODELS.md

Standalone proof that WebLLM (in-browser WebGPU inference) works behind the relay
contract shape. No relay code involved; runtime comes from the esm.run CDN.

`main.js` exposes `completeLocal(params)` — it mirrors `CompletionParams`
(`packages/protocol/src/completion.ts`) and yields `StreamDelta` objects
`{type:'text'|'done'|'error'}`, the exact contract wrapps consume from
`relay.stream()`. This is the function shape the future `BrowserModelBackend`
will drive over the extension WS pipe.

## Run

```sh
cd packages/sidekick/spike/webllm-spike
python3 -m http.server 8917
# open http://localhost:8917 in Chrome (localhost = secure context, WebGPU works)
```

## What to exercise

1. `load` a model (SmolLM2-360M for iteration, Llama-3.2-1B for the realistic floor).
   First load downloads weights into the origin's Cache API; reload the page and
   `load` again to see the cache-hit path (no network, much faster).
2. `run` streams a completion through `completeLocal`; the stat row shows first-token
   latency, decode time, and tok/s (measured + engine-reported).
3. `cancel` mid-stream calls `engine.interruptGenerate()` — the stream ends with a
   `done` delta (`finish=abort`) and the engine stays reusable.
4. `unload` releases VRAM.

All measurements are also collected programmatically on `window.__spike`
(loads, runs, logs, storage estimates), and `window.completeLocal` is callable
from DevTools.

## Gotchas observed on first run

- `initProgressCallback` progress is NOT strictly monotonic across a cold load:
  it restarts when transitioning from "fetching params" to "loading on GPU".
  Within each phase it increases; cache-hit loads are fully monotonic.
- Weight downloads from the HF CDN can stall or fail a shard mid-flight
  (`Cache.add() encountered a network error`). Already-fetched shards stay cached,
  so a retry resumes where it left off — the real backend should auto-retry.
- Cold "load from cache into VRAM" is seconds (~12s for the 1B here): show it as a
  distinct state from "downloading" and "thinking", per the doc's UX plan.
