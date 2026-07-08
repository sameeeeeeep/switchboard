// brandbrain, as a Switchboard app — running its REAL gaps route (examples/adapter/proof) client-
// side via the adapter, on the visitor's own Claude. This is the "adopt an existing app" thesis in
// a store listing: brandbrain's route logic is unchanged; only its model transport is window.claude.
import { mountConnect } from "@relay/sdk";
import { setProvider } from "../../adapter/claude.mjs";
import { createApp } from "../../adapter/router.mjs";
import { POST as gapsPOST } from "../../adapter/proof/gaps-route.mjs";
import { bindFolder, readWorkspace, storageInfo } from "../../adapter/claude_storage.mjs";

const $ = (id) => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const app = createApp({ "/api/studio/gaps": { POST: gapsPOST } });
let connected = false;

// The standard Switchboard header chip: it owns the whole connect lifecycle (connect / identity /
// project / disconnect). brandbrain just reacts to the transitions — no bespoke connect button.
mountConnect($("sbchip"), {
  scope: { reason: "brandbrain — find white space", models: ["sonnet"] },
  onConnect: async () => {
    setProvider(window.claude); // ← the entire migration: brandbrain's runClaude now uses your Claude
    connected = true;
    $("go").disabled = false;
    $("ws").hidden = false;
    await refreshWorkspace(); // surface brands wherever storage resolves (sandbox until a folder is bound)
  },
  onDisconnect: () => {
    connected = false;
    $("go").disabled = true;
    $("ws").hidden = true;
  },
  onProjectChange: () => { if (connected) refreshWorkspace(); },
});

$("bind").addEventListener("click", async () => {
  if (!connected) return;
  const path = $("folder").value.trim();
  if (!path) return;
  $("bind").disabled = true; const label = $("bind").textContent; $("bind").textContent = "Waiting for consent…";
  const info = await bindFolder(path); // one-time path-consent click in the broker
  $("bind").disabled = false; $("bind").textContent = label;
  if (!info) { $("storeInfo").textContent = "bind declined — your data stays where it is."; return; }
  await refreshWorkspace();
});

async function refreshWorkspace() {
  let info = null, ws = null;
  try { info = await storageInfo(); ws = await readWorkspace(); } catch {}
  const brands = Array.isArray(ws?.brands) ? ws.brands : [];
  const box = $("brands"); box.textContent = "";
  for (const b of brands) {
    const name = b?.name || b?.id || "untitled";
    const chip = el("span", "bchip" + (b?.id && b.id === ws.activeId ? " active" : ""), name);
    box.append(chip);
  }
  if (info) {
    const where = info.autoAssigned ? "auto-assigned sandbox" : "bound folder";
    $("folder").value = info.folder;
    $("storeInfo").textContent = `${brands.length} brand${brands.length === 1 ? "" : "s"} · ${where} · ${info.folder}`;
  } else {
    $("storeInfo").textContent = "";
  }
}

$("go").addEventListener("click", async () => {
  if (!connected) return;
  const category = $("cat").value.trim();
  const players = $("players").value.split(",").map((s) => s.trim()).filter(Boolean)
    .map((b) => ({ brand: b, kind: "incumbent", segment: "core", note: "" }));
  const canvas = { category: { name: category, scope: "consumer / D2C" }, segments: [{ name: "core", tag: "core", note: "" }], players };

  $("gaps").textContent = ""; $("events").textContent = "";
  $("events").append(el("div", "event", "Finding openings on your Claude…"));
  $("go").disabled = true; const label = $("go").textContent; $("go").textContent = "Thinking…";
  try {
    // brandbrain's frontend does exactly this fetch; the adapter dispatches it to the route locally.
    const res = await app.handle(new Request("/api/studio/gaps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvas }) }));
    const json = await res.json();
    renderGaps(json.gaps || []);
    $("events").textContent = "";
  } catch (err) { $("events").textContent = ""; $("events").append(el("div", "event", `[failed: ${err?.code ?? err?.message ?? "?"}]`)); }
  $("go").disabled = false; $("go").textContent = label;
});

function renderGaps(gaps) {
  const box = $("gaps");
  if (!gaps.length) { box.append(el("div", "event", "No openings came back — try a different category.")); return; }
  for (const g of gaps) {
    const card = el("div", "gap");
    card.append(el("h3", null, g.title));
    if (g.rationale) card.append(el("p", null, g.rationale));
    if (typeof g.score === "number") {
      const row = el("div", "scorerow");
      row.append(el("span", null, "opportunity score"), el("span", null, g.score.toFixed(2)));
      const bar = el("div", "scorebar"); const fill = el("i"); fill.style.width = `${Math.round(g.score * 100)}%`; bar.append(fill);
      card.append(row, bar);
    }
    if (g.components) {
      const comp = el("div", "comp");
      for (const [k, v] of Object.entries(g.components)) comp.append(el("span", null, `${k} ${Number(v).toFixed(2)}`));
      card.append(comp);
    }
    box.append(card);
  }
}
