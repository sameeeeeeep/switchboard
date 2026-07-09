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

function onConnected(r, models) {
  relay = r;
  $("send").disabled = false;
  $("connect").disabled = true;
  $("status").textContent = `— connected · ${models?.join(", ") || "default model"}`;
}
function showInstallLink(installUrl) {
  $("status").textContent = "— sidekick not installed · ";
  const a = document.createElement("a");
  a.href = installUrl; a.target = "_blank"; a.rel = "noreferrer";
  a.textContent = "Get Switchboard →";
  $("status").append(a);
}

$("connect").addEventListener("click", async () => {
  const r = await whenRelayReady();
  if (!("connect" in r)) { showInstallLink(r.installUrl); return; }
  try {
    const grant = await r.connect({ reason: "chat demo", tools: [] });
    onConnected(r, grant.models);
  } catch (err) {
    $("status").textContent = `— connect rejected (${err?.code ?? "?"})`;
  }
});

// Returning-user probe: a persisted grant connects on load, no click needed.
(async () => {
  const r = await whenRelayReady(2000);
  if (!("connect" in r)) { showInstallLink(r.installUrl); return; }
  const grant = await r.permissions().catch(() => null);
  if (grant) onConnected(r, grant.models);
})();

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
