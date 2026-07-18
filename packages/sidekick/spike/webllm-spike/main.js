/**
 * webllm-spike — Phase 0 of docs/BROWSER-MODELS.md.
 *
 * Proves the WebLLM runtime on real hardware behind the relay contract shape:
 *   completeLocal(params) mirrors CompletionParams (packages/protocol/src/completion.ts)
 *   and yields StreamDelta objects {type:'text'|'done'|'error'} — the exact contract
 *   wrapps consume from relay.stream().
 *
 * NO relay code involved. Standalone page, CDN runtime, new files only.
 * Serve:  cd packages/sidekick/spike/webllm-spike && python3 -m http.server 8917
 * Open:   http://localhost:8917
 */

const WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm@0.2.84";
const WEBLLM_CDN_FALLBACK = "https://esm.run/@mlc-ai/web-llm";

const MODELS = [
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2-360M (spike model, ~0.27 GB)" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama-3.2-1B (realistic floor, ~0.6 GB)" },
];

// ---------------------------------------------------------------- state + instrumentation
const S = {
  webllm: null,
  engine: null,
  currentModelId: null,
  generating: false,
  // programmatically readable by the verifier (browser pane javascript_tool)
  spike: {
    webgpu: null,
    adapter: null,
    storageBefore: null,
    storageAfter: null,
    loads: [], // {modelId, ms, progressSamples: n, monotonic, reachedOne, cacheHit(guess)}
    runs: [],  // {modelId, ttfbMs, decodeMs, completionTokens, promptTokens, tokPerSec, engineDecodeTps, stopReason, interrupted, error}
    logs: [],
  },
};
window.__spike = S.spike;

const $ = (id) => document.getElementById(id);
function log(msg, cls = "") {
  const t = new Date().toISOString().slice(11, 23);
  S.spike.logs.push(`${t} ${msg}`);
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = `${t}  ${msg}`;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}
const fmtGB = (b) => (b / 1e9).toFixed(2) + " GB";
/** set an element to a single colored span with SAFE text (no HTML interpolation) */
function setMsg(el, cls, text) {
  el.innerHTML = "";
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  el.appendChild(s);
}

async function storageEstimate(slot) {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  S.spike[slot] = { usage: e.usage, quota: e.quota };
  $("storage-est").textContent = `${fmtGB(e.usage)} used of ${fmtGB(e.quota)} quota`;
  return e;
}

// ---------------------------------------------------------------- the contract under test
/**
 * completeLocal(params) — mirrors CompletionParams → async iterator of StreamDelta.
 * This is the function shape BrowserModelBackend will drive over the extension pipe;
 * here it runs in-page so the spike can measure the raw runtime.
 *
 * params: { prompt?, messages?, system?, model?, maxTokens? }  (agentic unsupported: fail closed)
 * yields: { type:'text', text }
 *         { type:'done', result:{ text, model, usage:{inputTokens,outputTokens}, stopReason } }
 *         { type:'error', error:{ code, message } }
 */
async function* completeLocal(params) {
  try {
    if (!S.engine) throw new Error("no engine loaded");
    if (params.agentic) throw new Error("browser backend does not yet support the agentic tool loop");
    if (params.model && params.model !== S.currentModelId)
      throw new Error(`model ${params.model} not loaded (engine has ${S.currentModelId})`);

    const messages = [];
    if (params.system) messages.push({ role: "system", content: params.system });
    if (Array.isArray(params.messages) && params.messages.length) messages.push(...params.messages);
    else if (params.prompt) messages.push({ role: "user", content: params.prompt });
    if (!messages.some((m) => m.role === "user")) throw new Error("no prompt/messages given");

    const chunks = await S.engine.chat.completions.create({
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    });

    let text = "";
    let usage = null;
    let finish = null;
    for await (const c of chunks) {
      const piece = c.choices?.[0]?.delta?.content ?? "";
      if (piece) {
        text += piece;
        yield { type: "text", text: piece };
      }
      if (c.choices?.[0]?.finish_reason) finish = c.choices[0].finish_reason;
      if (c.usage) usage = c.usage;
    }

    yield {
      type: "done",
      result: {
        text,
        model: S.currentModelId,
        usage: usage
          ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
          : undefined,
        stopReason: finish === "length" ? "max_tokens" : "end",
        // spike-only extras (not part of the relay contract): engine-reported speeds
        _engineExtra: usage?.extra ?? null,
        _finishRaw: finish,
      },
    };
  } catch (err) {
    yield { type: "error", error: { code: "browser_model_error", message: String(err?.message ?? err) } };
  }
}
window.completeLocal = completeLocal; // callable from devtools / verifier

// ---------------------------------------------------------------- environment
async function checkWebGPU() {
  if (!navigator.gpu) {
    S.spike.webgpu = false;
    $("gpu-status").innerHTML = '<span class="err">ABSENT — WebLLM cannot run here</span>';
    log("navigator.gpu is undefined — no WebGPU in this browser context", "err");
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("requestAdapter() returned null");
    const info = adapter.info ?? {};
    S.spike.webgpu = true;
    S.spike.adapter = {
      vendor: info.vendor ?? "?",
      architecture: info.architecture ?? "?",
      device: info.device ?? "",
      description: info.description ?? "",
      f16: adapter.features?.has?.("shader-f16") ?? false,
    };
    $("gpu-status").innerHTML = '<span class="ok">available</span>';
    $("gpu-adapter").textContent =
      `adapter: ${S.spike.adapter.vendor} / ${S.spike.adapter.architecture}` +
      (S.spike.adapter.description ? ` (${S.spike.adapter.description})` : "") +
      ` · shader-f16: ${S.spike.adapter.f16}`;
    log(`WebGPU adapter: ${JSON.stringify(S.spike.adapter)}`, "ok");
    return true;
  } catch (err) {
    S.spike.webgpu = false;
    setMsg($("gpu-status"), "err", `adapter error: ${err.message}`);
    log(`WebGPU adapter error: ${err.message}`, "err");
    return false;
  }
}

async function importWebLLM() {
  try {
    S.webllm = await import(WEBLLM_CDN);
    log(`webllm loaded from ${WEBLLM_CDN}`, "ok");
  } catch (e) {
    log(`pinned CDN import failed (${e.message}); trying latest`, "err");
    S.webllm = await import(WEBLLM_CDN_FALLBACK);
    log(`webllm loaded from ${WEBLLM_CDN_FALLBACK}`, "ok");
  }
}

// ---------------------------------------------------------------- model load
function renderModels() {
  const host = $("models");
  host.innerHTML = "";
  for (const m of MODELS) {
    const row = document.createElement("div");
    row.className = "model-row";
    row.innerHTML = `
      <div class="row">
        <button data-load="${m.id}">load</button>
        <span class="status"><b>${m.label}</b></span>
        <span class="status" id="st-${m.id}">not loaded</span>
      </div>
      <div class="row">
        <div class="bar"><div id="bar-${m.id}"></div></div>
        <span class="status" id="pg-${m.id}"></span>
      </div>`;
    host.appendChild(row);
    row.querySelector("button").addEventListener("click", () => loadModel(m.id));
  }
}

async function loadModel(modelId) {
  if (S.generating) return log("busy generating; cancel first", "err");
  document.querySelectorAll("[data-load]").forEach((b) => (b.disabled = true));
  $("run").disabled = true;
  $("st-" + modelId).textContent = "loading…";
  $("engine-status").textContent = "loading " + modelId;

  const samples = [];
  let monotonic = true;
  const t0 = performance.now();
  try {
    // unload previous engine so VRAM + timing are clean per model
    if (S.engine) {
      await S.engine.unload();
      S.engine = null;
      log(`unloaded previous engine (${S.currentModelId})`);
      S.currentModelId = null;
    }
    const engine = await S.webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (p) => {
        if (samples.length && p.progress < samples[samples.length - 1]) monotonic = false;
        samples.push(p.progress);
        $("bar-" + modelId).style.width = Math.round(p.progress * 100) + "%";
        $("pg-" + modelId).textContent = `${Math.round(p.progress * 100)}% — ${p.text.slice(0, 90)}`;
      },
    });
    const ms = Math.round(performance.now() - t0);
    S.engine = engine;
    S.currentModelId = modelId;
    const reachedOne = samples.length > 0 && Math.max(...samples) >= 1;
    // heuristic: a cache-hit load never mentions "Fetching" with a cache-miss suffix; timing tells the story regardless
    S.spike.loads.push({ modelId, ms, progressSamples: samples.length, monotonic, reachedOne });
    $("st-" + modelId).innerHTML = `<span class="ok">ready in ${(ms / 1000).toFixed(1)}s</span>`;
    $("engine-status").textContent = modelId;
    $("run").disabled = false;
    $("unload").disabled = false;
    log(
      `engine ready: ${modelId} in ${(ms / 1000).toFixed(1)}s · ${samples.length} progress samples · monotonic=${monotonic} · reached 1.0=${reachedOne}`,
      "ok",
    );
    await storageEstimate("storageAfter");
  } catch (err) {
    $("st-" + modelId).innerHTML = `<span class="err">failed</span>`;
    $("engine-status").textContent = "load failed";
    log(`load failed: ${err.message ?? err}`, "err");
    S.spike.loads.push({ modelId, ms: Math.round(performance.now() - t0), error: String(err?.message ?? err) });
  } finally {
    document.querySelectorAll("[data-load]").forEach((b) => (b.disabled = false));
  }
}

// ---------------------------------------------------------------- run a completion
async function run() {
  if (!S.engine || S.generating) return;
  S.generating = true;
  $("run").disabled = true;
  $("cancel").disabled = false;
  $("run-status").textContent = "thinking…";
  const out = $("out");
  out.innerHTML = '<span class="cursor">▋</span>';
  let acc = "";
  let firstTokenAt = null;
  const rec = { modelId: S.currentModelId, interrupted: false };
  const t0 = performance.now();

  try {
    const params = {
      system: $("system").value || undefined,
      prompt: $("prompt").value,
      maxTokens: 512,
    };
    for await (const delta of completeLocal(params)) {
      if (delta.type === "text") {
        if (firstTokenAt === null) {
          firstTokenAt = performance.now();
          $("run-status").textContent = "streaming…";
        }
        acc += delta.text;
        out.innerHTML = "";
        out.append(document.createTextNode(acc));
        const cur = document.createElement("span");
        cur.className = "cursor";
        cur.textContent = "▋";
        out.appendChild(cur);
      } else if (delta.type === "done") {
        const tEnd = performance.now();
        out.textContent = acc || "(empty)";
        const u = delta.result.usage;
        rec.ttfbMs = firstTokenAt ? Math.round(firstTokenAt - t0) : null;
        rec.decodeMs = firstTokenAt ? Math.round(tEnd - firstTokenAt) : null;
        rec.completionTokens = u?.outputTokens ?? null;
        rec.promptTokens = u?.inputTokens ?? null;
        rec.tokPerSec =
          u?.outputTokens && rec.decodeMs ? +(u.outputTokens / (rec.decodeMs / 1000)).toFixed(1) : null;
        rec.engineDecodeTps = delta.result._engineExtra?.decode_tokens_per_s
          ? +delta.result._engineExtra.decode_tokens_per_s.toFixed(1)
          : null;
        rec.stopReason = delta.result.stopReason;
        rec.finishRaw = delta.result._finishRaw;
        rec.interrupted = delta.result._finishRaw === "abort";
        setMsg($("run-status"), "ok", `done (${rec.stopReason}${rec.interrupted ? ", interrupted" : ""})`);
        renderStats(rec);
        log(
          `run done: ${rec.completionTokens} tokens · ttfb ${rec.ttfbMs}ms · decode ${rec.decodeMs}ms · ` +
            `${rec.tokPerSec} tok/s measured · ${rec.engineDecodeTps ?? "?"} tok/s engine-reported · finish=${rec.finishRaw}`,
          "ok",
        );
      } else if (delta.type === "error") {
        out.textContent = acc;
        rec.error = delta.error.message;
        setMsg($("run-status"), "err", `error: ${delta.error.message}`);
        log(`stream error delta: ${delta.error.code} — ${delta.error.message}`, "err");
      }
    }
  } catch (err) {
    // contract says errors arrive as deltas; anything here is a spike bug — still never lock the UI
    rec.error = String(err?.message ?? err);
    setMsg($("run-status"), "err", `threw: ${rec.error}`);
    log(`run threw outside contract: ${rec.error}`, "err");
  } finally {
    S.spike.runs.push(rec);
    S.generating = false;
    $("run").disabled = !S.engine;
    $("cancel").disabled = true;
  }
}

function renderStats(r) {
  $("stats").innerHTML = "";
  const items = [
    [r.ttfbMs != null ? r.ttfbMs + "ms" : "—", "first token"],
    [r.decodeMs != null ? (r.decodeMs / 1000).toFixed(2) + "s" : "—", "decode time"],
    [r.completionTokens ?? "—", "output tokens"],
    [r.tokPerSec != null ? r.tokPerSec : "—", "tok/s measured"],
    [r.engineDecodeTps != null ? r.engineDecodeTps : "—", "tok/s engine"],
  ];
  for (const [v, k] of items) {
    const d = document.createElement("div");
    d.className = "stat";
    d.innerHTML = `<b>${v}</b><span>${k}</span>`;
    $("stats").appendChild(d);
  }
}

// ---------------------------------------------------------------- wire up
$("run").addEventListener("click", run);
$("cancel").addEventListener("click", () => {
  if (S.engine && S.generating) {
    S.engine.interruptGenerate();
    log("interruptGenerate() called mid-stream");
  }
});
$("unload").addEventListener("click", async () => {
  if (!S.engine) return;
  await S.engine.unload();
  log(`engine.unload() — VRAM released for ${S.currentModelId}`, "ok");
  S.engine = null;
  S.currentModelId = null;
  $("engine-status").textContent = "none (unloaded)";
  $("run").disabled = true;
  $("unload").disabled = true;
});

(async function main() {
  renderModels();
  await storageEstimate("storageBefore");
  log(`storage before: ${S.spike.storageBefore ? fmtGB(S.spike.storageBefore.usage) + " used" : "estimate unavailable"}`);
  const gpu = await checkWebGPU();
  if (!gpu) {
    $("engine-status").innerHTML = '<span class="err">blocked: no WebGPU</span>';
    return;
  }
  try {
    await importWebLLM();
  } catch (e) {
    log(`webllm import failed entirely: ${e.message}`, "err");
  }
})();
