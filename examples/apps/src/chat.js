// Chat app — pure completion on the visitor's own Claude. The whole integration is: get the
// provider, connect once, stream. No API key, no backend, no inference bill for this site.
import { whenRelayReady } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
let relay = null;

function bubble(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  $("log").append(el);
  return el;
}

$("connect").addEventListener("click", async () => {
  const r = await whenRelayReady();
  if (!("connect" in r)) { $("status").textContent = `— sidekick not installed (${r.installUrl})`; return; }
  try {
    const grant = await r.connect({ reason: "chat demo", tools: [] });
    relay = r;
    $("send").disabled = false;
    $("status").textContent = `— connected · ${grant.models.join(", ") || "default model"}`;
    $("connect").disabled = true;
  } catch (err) {
    $("status").textContent = `— connect rejected (${err?.code ?? "?"})`;
  }
});

$("send").addEventListener("click", async () => {
  if (!relay) return;
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  bubble("user", prompt);
  $("prompt").value = "";
  const out = bubble("assistant", "");
  try {
    for await (const d of relay.stream({ prompt })) {
      if (d.type === "text") out.textContent += d.text;
      else if (d.type === "error") out.textContent += `\n[error: ${d.error.message}]`;
    }
  } catch (err) {
    out.textContent = `[stream failed: ${err?.code ?? "?"}]`;
  }
});
