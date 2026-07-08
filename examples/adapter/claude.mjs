/**
 * @switchboard/adapter — the drop-in replacement for an app's model-transport lib.
 *
 * It exposes the SAME surface brandbrain's `lib/claude.ts` already exposes (runClaude,
 * runClaudeStream, extractJson, RunOpts), but resolves through `window.claude` (the visitor's own
 * model, via the consented broker) instead of the app's server calling `claude -p`. Because the
 * signatures match, an app swaps ONLY what `@/lib/claude` resolves to — its route files, which
 * import { runClaude, extractJson }, don't change a character.
 *
 * The provider is window.claude in the browser sandbox; in a headless test you inject one.
 */
let provider = (typeof window !== "undefined" && window.claude && window.claude.isRelay) ? window.claude : null;
// A one-shot "provider is ready" gate. The app's own data load (e.g. brandbrain's /api/workspace GET
// on mount) can race the bootstrap's connect; `whenProvider` lets storage briefly await the provider
// instead of failing the race and showing an empty workspace.
let _resolveReady;
const _ready = new Promise((r) => { _resolveReady = r; });
export function setProvider(p) { provider = p; if (p && _resolveReady) { _resolveReady(p); _resolveReady = null; } }
export function getProvider() { return provider; }
/** Resolve with the provider once set, or with the current value after `timeoutMs` (default 3s). */
export function whenProvider(timeoutMs = 3000) {
  if (provider) return Promise.resolve(provider);
  return Promise.race([_ready, new Promise((r) => setTimeout(() => r(provider), timeoutMs))]);
}
/** Called by the bootstrap when it determines no provider will connect (first visit) — unblocks any
 *  storage await immediately instead of paying the full timeout. */
export function abandonProvider() { if (_resolveReady) { _resolveReady(null); _resolveReady = null; } }

/** @typedef {{ system?: string, allowedTools?: string[], model?: string, mcp?: boolean, effort?: "low"|"medium"|"high", timeoutMs?: number }} RunOpts */

/** One-shot generation → the assistant's text, or null (callers fall back), matching brandbrain. */
export async function runClaude(prompt, opts = {}) {
  if (!provider) return null;
  try {
    const r = await provider.request({
      method: "claude_complete",
      params: { prompt, system: opts.system, model: opts.model, effort: opts.effort, agentic: !!opts.mcp },
    });
    return typeof r?.text === "string" ? r.text : null;
  } catch {
    return null;
  }
}

/** Streamed generation as brandbrain expects it: a ReadableStream of newline-delimited
 *  {"type":"text","text":"…"} (and a final {"type":"sources",urls}) — reconstructed from the
 *  provider's `delta` events. */
export function runClaudeStream(prompt, opts = {}) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      if (!provider) { controller.close(); return; }
      const send = (o) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch {} };
      let streamId;
      const onDelta = (d) => {
        if (!streamId || d.streamId !== streamId) return;
        if (d.type === "text") send({ type: "text", text: d.text });
        else if (d.type === "sources") send({ type: "sources", urls: d.urls });
        else if (d.type === "done" || d.type === "error") { provider.removeListener?.("delta", onDelta); try { controller.close(); } catch {} }
      };
      provider.on("delta", onDelta);
      try {
        const res = await provider.request({ method: "claude_stream", params: { prompt, system: opts.system, model: opts.model, effort: opts.effort, agentic: !!opts.mcp } });
        streamId = res?.streamId;
      } catch { provider.removeListener?.("delta", onDelta); try { controller.close(); } catch {} }
    },
  });
}

/** Pull a JSON value out of model text, tolerating ```json fences and prose. (brandbrain's impl.) */
export function extractJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[{[]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}
