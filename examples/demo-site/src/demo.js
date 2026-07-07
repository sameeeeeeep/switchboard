// The demo integration — this is what a real site writes. It imports @relay/sdk and is bundled
// (build.mjs) into ../demo.js so the page has a single self-contained module. The "5 lines" shown
// on the page are the essence of this file.
import { whenRelayReady } from "@relay/sdk";

const out = document.getElementById("out");
const promptEl = document.getElementById("prompt");
const connectBtn = document.getElementById("connect");
const askBtn = document.getElementById("ask");

let relay = null;

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
      else if (d.type === "error") out.textContent += `\n[error: ${d.error.message}]`;
    }
  } catch (err) {
    out.textContent = `Stream failed (code ${err?.code ?? "?"}).`;
  }
});
