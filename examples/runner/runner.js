/**
 * Runner shell logic (TRUSTED Switchboard code — this page is not airgapped).
 *   • Loads the untrusted app into the sandboxed iframe.
 *   • Bridges the app's window.claude calls (postMessage) → the real Switchboard provider → daemon.
 *     In a plain browser (no extension) it falls back to a mock model so the airgap is demoable.
 *   • Renders the airgap monitor: brokered calls (allowed) vs blocked egress (the wall holding).
 */
const iframe = document.getElementById("app");
const logEl = document.getElementById("log");
let okCount = 0, blockCount = 0;

const now = () => new Date().toLocaleTimeString([], { hour12: false }).slice(0, 8);
function addLog(cls, msg) {
  const ev = document.createElement("div");
  ev.className = `ev ${cls}`;
  const t = document.createElement("span"); t.className = "t"; t.textContent = now();
  const m = document.createElement("span"); m.className = "m"; m.textContent = msg;
  ev.append(t, m);
  logEl.prepend(ev);
}
function tally() {
  document.getElementById("tallyOk").textContent = `${okCount} brokered`;
  document.getElementById("tallyBlock").textContent = `${blockCount} blocked`;
}

// Real provider when the Switchboard extension injected window.claude here; else a mock model.
const real = typeof window.claude !== "undefined" && window.claude && window.claude.isRelay;
const provider = real ? window.claude : mockProvider();

// Forward streaming deltas from the provider down into the app.
provider.on("delta", (payload) => iframe.contentWindow?.postMessage({ __sb: 1, dir: "runner->app", event: "delta", payload }, "*"));

window.addEventListener("message", async (ev) => {
  if (ev.source !== iframe.contentWindow) return; // only messages from OUR sandboxed app
  const d = ev.data;
  if (!d || d.__sb !== 1 || d.dir !== "app->runner") return;

  if (d.kind === "blocked") {
    blockCount++; tally();
    addLog("block", `egress blocked · ${d.directive} → ${short(d.uri)}`);
    return;
  }
  if (d.kind === "request") {
    okCount++; tally();
    addLog("ok", `brokered · ${d.method}${d.params?.prompt ? ` "${d.params.prompt.slice(0, 40)}…"` : ""}`);
    try {
      const result = await provider.request({ method: d.method, params: d.params });
      iframe.contentWindow.postMessage({ __sb: 1, dir: "runner->app", id: d.id, result }, "*");
    } catch (err) {
      iframe.contentWindow.postMessage({ __sb: 1, dir: "runner->app", id: d.id, error: { code: err?.code, message: String(err?.message || err) } }, "*");
    }
  }
});

function short(u) { return (u || "").replace(/^https?:\/\//, "").slice(0, 46); }

// Boot: point the sandbox at the app (the server injects the bridge + airgap CSP on this route).
addLog("info", real ? "connected to your Switchboard — the app runs on your model + tools" : "demo mode: no extension, using a mock model. The airgap is real either way.");
iframe.src = "/app/d2cos";

// ---- mock provider (preview only) — a canned streamed reply so the airgap is demoable offline ----
function mockProvider() {
  const listeners = {};
  const emit = (e, p) => (listeners[e] || []).forEach((f) => { try { f(p); } catch {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    isRelay: true,
    on: (e, h) => (listeners[e] = listeners[e] || []).push(h),
    removeListener: () => {},
    request: async ({ method, params }) => {
      if (method === "claude_connect") return { origin: "switchboard.ai", mode: "ask", models: ["sonnet"], tools: [], budgets: {} };
      if (method === "claude_stream") {
        const streamId = Math.random().toString(36).slice(2);
        const reply = `You asked: “${params?.prompt ?? ""}”. I'm running on your own model, sealed inside Switchboard's airgap — I can use what you granted, but I have no way to send your data anywhere.`;
        (async () => { for (const w of reply.split(" ")) { await sleep(40); emit("delta", { streamId, type: "text", text: w + " " }); } emit("delta", { streamId, type: "done", result: { text: reply } }); })();
        return { streamId };
      }
      if (method === "claude_complete") return { text: "(mock) ok", model: "sonnet" };
      return {};
    },
  };
}
