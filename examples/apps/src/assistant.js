// Agentic tool assistant. On connect it asks for whatever tools the sidekick exposes, lists them,
// then runs an agentic completion where the model may call them — reads auto-approve within scope,
// writes trigger a per-action consent window. The app integrates nothing itself.
import { whenRelayReady } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
let relay = null;

$("connect").addEventListener("click", async () => {
  const r = await whenRelayReady();
  if (!("connect" in r)) { $("status").textContent = `— sidekick not installed (${r.installUrl})`; return; }
  try {
    // Discover-then-request: connect read-only first so we can see what's available, then the
    // consent window lets the user grant exactly which tools this app may use.
    const probe = await r.connect({ reason: "tool assistant", tools: [] });
    relay = r;
    $("connect").disabled = true;
    $("run").disabled = false;
    $("status").textContent = `— connected · ${probe.models.join(", ") || "default model"}`;

    const tools = await r.listTools();
    const box = $("tools");
    box.textContent = "";
    if (!tools.length) box.append(Object.assign(document.createElement("span"), { className: "status", textContent: "No tools granted. Re-connect and approve some in the consent window, or add servers to ~/.relay/mcp.json." }));
    for (const t of tools) {
      const chip = document.createElement("span");
      chip.className = `tool ${t.access}`;
      chip.textContent = `${t.name} · ${t.access}`;
      box.append(chip);
    }
  } catch (err) {
    $("status").textContent = `— connect rejected (${err?.code ?? "?"})`;
  }
});

$("run").addEventListener("click", async () => {
  if (!relay) return;
  const out = $("out");
  out.textContent = "";
  const line = (cls, text) => { const d = document.createElement("div"); d.className = cls; d.textContent = text; out.append(d); };
  try {
    for await (const d of relay.stream({ prompt: $("prompt").value, agentic: true })) {
      if (d.type === "tool_proposed") line("event", `🛠 proposes ${d.call.name}(${JSON.stringify(d.call.arguments)})`);
      else if (d.type === "tool_result") line("event", d.result.ok ? `✅ ${d.call.name} ran` : `⛔ ${d.call.name} blocked: ${d.result.error?.message}`);
      else if (d.type === "text") { out.lastChild && out.lastChild.classList?.contains("answer") ? (out.lastChild.textContent += d.text) : line("answer", d.text); }
      else if (d.type === "error") line("event", `[error: ${d.error.message}]`);
    }
  } catch (err) {
    line("event", `[stream failed: ${err?.code ?? "?"}]`);
  }
});
