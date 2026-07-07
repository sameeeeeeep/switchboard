// ../../packages/protocol/dist/version.js
var PROVIDER_GLOBAL = "claude";

// ../../packages/sdk/dist/index.js
var Relay = class {
  provider;
  constructor(provider) {
    this.provider = provider;
  }
  get version() {
    return this.provider.version;
  }
  capabilities() {
    return this.provider.request({ method: "claude_capabilities" });
  }
  connect(scope) {
    return this.provider.request({ method: "claude_connect", params: scope });
  }
  permissions() {
    return this.provider.request({ method: "claude_permissions" });
  }
  listTools() {
    return this.provider.request({ method: "claude_listTools" }).then((r) => r.tools);
  }
  callTool(name, args) {
    const call = { name, arguments: args };
    return this.provider.request({ method: "claude_callTool", params: call });
  }
  complete(params) {
    return this.provider.request({ method: "claude_complete", params });
  }
  /** Streamed completion as an async iterator of deltas. Ends after a `done`/`error` delta. */
  async *stream(params) {
    const { streamId } = await this.provider.request({ method: "claude_stream", params });
    const queue = [];
    let notify = null;
    let ended = false;
    const handler = (payload) => {
      const p = payload;
      if (p.streamId !== streamId)
        return;
      queue.push(p);
      if (p.type === "done" || p.type === "error")
        ended = true;
      notify?.();
    };
    this.provider.on("delta", handler);
    try {
      while (true) {
        if (queue.length === 0) {
          if (ended)
            break;
          await new Promise((r) => notify = r);
          notify = null;
          continue;
        }
        yield queue.shift();
      }
    } finally {
      this.provider.removeListener("delta", handler);
    }
  }
  on(event, handler) {
    this.provider.on(event, handler);
  }
};
var DEFAULT_INSTALL_URL = "https://relay.dev/install";
function getRelay(opts) {
  const provider = globalThis[PROVIDER_GLOBAL];
  if (provider?.isRelay)
    return new Relay(provider);
  return { installed: false, installUrl: opts?.installUrl ?? DEFAULT_INSTALL_URL };
}
function whenRelayReady(timeoutMs = 3e3, opts) {
  const now = getRelay(opts);
  if (now instanceof Relay)
    return Promise.resolve(now);
  return new Promise((resolve) => {
    const onInit = () => {
      cleanup();
      resolve(getRelay(opts));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ installed: false, installUrl: opts?.installUrl ?? DEFAULT_INSTALL_URL });
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener(`${PROVIDER_GLOBAL}#initialized`, onInit);
    }
    window.addEventListener(`${PROVIDER_GLOBAL}#initialized`, onInit);
  });
}

// src/demo.js
var out = document.getElementById("out");
var promptEl = document.getElementById("prompt");
var connectBtn = document.getElementById("connect");
var askBtn = document.getElementById("ask");
var relay = null;
connectBtn.addEventListener("click", async () => {
  const r = await whenRelayReady();
  if (!("connect" in r)) {
    out.textContent = `Relay not installed. Load the extension + run the sidekick, then reload. (${r.installUrl})`;
    return;
  }
  try {
    const grant = await r.connect({ reason: "demo chat", tools: [] });
    relay = r;
    askBtn.disabled = false;
    connectBtn.textContent = `Connected (${grant.models.join(", ") || "default model"})`;
  } catch (err) {
    out.textContent = `Connect rejected (code ${err?.code ?? "?"}).`;
  }
});
askBtn.addEventListener("click", async () => {
  if (!relay) return;
  out.textContent = "";
  try {
    for await (const d of relay.stream({ prompt: promptEl.value })) {
      if (d.type === "text") out.textContent += d.text;
      else if (d.type === "error") out.textContent += `
[error: ${d.error.message}]`;
    }
  } catch (err) {
    out.textContent = `Stream failed (code ${err?.code ?? "?"}).`;
  }
});
//# sourceMappingURL=demo.js.map
