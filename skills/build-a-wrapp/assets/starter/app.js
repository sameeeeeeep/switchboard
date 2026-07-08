// A minimal wrapp: streams a completion on the visitor's OWN Claude via Switchboard.
// No API key, no backend, no inference bill. The whole integration is: mount the chip, connect
// once, stream. Swap the body of `boot`/`generate` for your app's logic.
import { mountConnect, BYOPErrorCode } from "@relay/sdk";

const $ = (id) => document.getElementById(id);

// The model this wrapp calls. It MUST match what we request in `scope` below — exact-match,
// default-deny. If you change one, change both, or the broker will deny the call (SCOPE_EXCEEDED).
const MODEL = "claude-haiku-4-5";

let relay = null;

// The standard connect chip renders the "Connect Switchboard" button, runs the consent flow, and
// becomes a "Hi {name}" pill once connected. `onConnect` fires on approve — and on load for a
// returning user whose grant persisted — so this is where the app wakes up.
mountConnect($("connect"), {
  scope: { models: [MODEL], reason: "Generate text on your own Claude" },
  onConnect: (r) => boot(r),
  onDisconnect: () => { relay = null; $("send").disabled = true; setStatus("Disconnected."); },
});

async function boot(r) {
  relay = r;
  // Feature-detect: fall back to whatever model the user actually granted.
  const caps = await r.capabilities();
  const model = caps.models.includes(MODEL) ? MODEL : caps.models[0];
  $("send").disabled = false;
  setStatus(`Connected · ${model || "default model"}`);
  $("send").onclick = () => generate(model);
}

async function generate(model) {
  if (!relay) return;
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  $("send").disabled = true;
  const out = $("out");
  out.textContent = "";
  try {
    for await (const d of relay.stream({ prompt, model })) {
      if (d.type === "text") out.textContent += d.text;
      else if (d.type === "error") out.textContent += `\n[error: ${d.error.message}]`;
    }
  } catch (err) {
    // Branch on the code, never the message. These are the ones worth handling explicitly.
    if (err.code === BYOPErrorCode.CONSENT_DENIED) setStatus("You declined — no problem.");
    else if (err.code === BYOPErrorCode.BUDGET_EXCEEDED) setStatus("Daily budget reached.");
    else if (err.code === BYOPErrorCode.SCOPE_EXCEEDED) setStatus("That model isn't in scope.");
    else setStatus(`Error (${err?.code ?? "?"})`);
  } finally {
    $("send").disabled = false;
  }
}

function setStatus(text) { $("status").textContent = text; }
