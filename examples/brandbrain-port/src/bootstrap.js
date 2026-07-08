// Switchboard bootstrap — the one injected client entry that turns the exported brandbrain into a
// broker app. It mounts the 32 route handlers into the fetch-router (so brandbrain's own
// fetch("/api/*") calls dispatch locally), connects window.claude, and offers a project-folder bind
// so the founder's existing .data flows straight through. brandbrain's own UI is otherwise untouched.
import { whenRelayReady } from "@relay/sdk";
import { setProvider, abandonProvider } from "../../adapter/claude.mjs";
import { bindFolder, storageInfo, storageGet } from "../../adapter/claude_storage.mjs";

// Map a rich brandbrain Brand → a slim, portable context other apps (e.g. Prism) can use. Opaque
// `data`, no locked schema — just the fields a downstream wrapper is likely to want.
function brandToContext(b) {
  const L = b.locks || {};
  const line = (c) => (c && (c.title || c.name)) || "";
  const palette = (L.identity && L.identity.palette) || b.palette || [];
  const products = [line(L.range), line(L.format), b.idea].filter(Boolean);
  return {
    id: b.id,                       // stable → re-publish updates in place, never duplicates
    name: b.name || "Brand",
    kind: "brand",
    data: {
      voice: line(L.voice) || (b.brief && b.brief.vibe) || "",
      positioning: line(L.positioning) || "",
      audience: line(L.audience) || (b.brief && b.brief.audience) || "",
      palette: Array.isArray(palette) ? palette : [],
      products,
    },
  };
}

// Publish every brand in the workspace to the shared context library, so the user can lend one to
// another app from the panel. Idempotent (stable ids). Returns how many were published.
async function publishBrands(r) {
  try {
    const raw = await storageGet("workspace");
    const ws = raw ? JSON.parse(raw) : null;
    const brands = Array.isArray(ws && ws.brands) ? ws.brands : [];
    let n = 0;
    for (const b of brands) if (b && b.name) { await r.context.publish(brandToContext(b)); n++; }
    return n;
  } catch { return 0; }
}

// Route the app's /api/* calls locally from the very first paint (handlers return graceful errors
// until a provider is connected; brandbrain already falls back to localStorage for those).
function mountRoutes() { try { window.__switchboardRoutes?.mount(null); } catch {} }

const bar = () => {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:99999;display:flex;gap:8px;align-items:center;font:600 12px/1 'Hanken Grotesk',system-ui,sans-serif";
  wrap.innerHTML = `
    <span id="sb-dot" style="width:8px;height:8px;border-radius:50%;background:#6E7C90"></span>
    <span id="sb-status" style="color:#99A3B7">Switchboard</span>
    <input id="sb-folder" placeholder="~/Documents/Projects/brandbrain/.data" value="~/Documents/Projects/brandbrain/.data"
      style="display:none;width:230px;background:#12151C;border:1px solid #262C38;border-radius:8px;color:#E8EDF4;padding:7px 9px;font:500 11px/1 'Spline Sans Mono',monospace" />
    <button id="sb-bind" style="display:none;background:#1A1F29;color:#E8EDF4;border:1px solid #262C38;border-radius:999px;padding:7px 11px;cursor:pointer">Bind</button>
    <button id="sb-connect" style="background:#C8F250;color:#0A0C10;border:0;border-radius:999px;padding:8px 13px;cursor:pointer">Connect Switchboard</button>`;
  document.body.appendChild(wrap);
  return wrap;
};

// The app's requested scope + default data folder come from switchboard.json (the capability
// manifest). This is what makes the connect consent ask for exactly what brandbrain uses — its
// tools (Higgsfield visuals, Shopify, Gmail, web search) and its models — instead of nothing.
const DEFAULTS = { reason: "brandbrain", models: ["sonnet"], tools: [], storage: {} };
async function loadManifest() {
  try { const r = await fetch("/switchboard.json"); if (r.ok) return { ...DEFAULTS, ...(await r.json()) }; } catch {}
  return DEFAULTS;
}
const grantCoversTools = (grant, tools) => {
  const have = new Set((grant?.tools || []).map((t) => t.name));
  return tools.every((t) => have.has(t));
};

async function main() {
  const manifest = await loadManifest();
  const scope = { reason: manifest.reason, models: manifest.models, tools: manifest.tools };
  const defaultFolder = manifest.storage?.defaultFolder;

  mountRoutes();
  const wrap = bar();
  const $ = (id) => wrap.querySelector(id);
  const setStatus = (t, color) => { $("#sb-status").textContent = t; $("#sb-dot").style.background = color || "#6E7C90"; };
  const showFolderRow = () => { $("#sb-folder").style.display = ""; $("#sb-bind").style.display = ""; };
  const setButton = (label, show) => { $("#sb-connect").textContent = label; $("#sb-connect").style.display = show ? "" : "none"; };
  if (defaultFolder) $("#sb-folder").value = defaultFolder;

  // After a provider is live: bind the declared project folder if we're still on an empty sandbox, so
  // the founder's existing brands surface. The bind itself prompts consent (shows the exact path).
  async function ensureBound() {
    let info = await storageInfo().catch(() => null);
    showFolderRow();
    if (info && info.folder) $("#sb-folder").value = info.folder;
    if (info && !info.autoAssigned) return info;          // already bound to a real folder
    if (!defaultFolder) return info;                       // nothing to bind to
    setStatus("approve the folder in Switchboard…", "#F59E0B");
    const bound = await bindFolder(defaultFolder);
    if (!bound) { setStatus("connected · folder not bound", "#F59E0B"); setButton("Bind data folder", false); showFolderRow(); return info; }
    setStatus(`connected · ${bound.count} record${bound.count === 1 ? "" : "s"}`, "#3DD68C");
    if (bound.count > 0) setTimeout(() => location.reload(), 500); // re-read workspace from the bound folder
    return bound;
  }

  // Evaluate current grant + binding and reflect it in the bar (called on load + after actions).
  async function reflect(r, grant) {
    setProvider(window.claude);
    window.__switchboardRoutes?.mount(window.claude);
    const info = await storageInfo().catch(() => null);
    const hasTools = grantCoversTools(grant, scope.tools);
    const bound = !!info && !info.autoAssigned;
    if (info && info.folder) $("#sb-folder").value = info.folder;
    if (hasTools && bound) {
      showFolderRow(); setButton("", false);
      // Bound + set up → publish this workspace's brands so they can be lent to other apps (Prism etc.).
      const n = await publishBrands(r);
      setStatus(`connected · ${n} brand${n === 1 ? "" : "s"} shared`, "#3DD68C");
    } else { setStatus("connected · finish setup", "#F59E0B"); showFolderRow(); setButton(hasTools ? "Bind data folder" : "Grant tools & folder", true); }
  }

  // Silent auto-reconnect: set the provider NOW — before brandbrain's workspace load races in — so a
  // bound folder's brands appear on first paint. No grant → release the storage await (first visit).
  (async () => {
    const r = await whenRelayReady(1500);
    if (!("connect" in r)) { abandonProvider(); return; }
    const grant = await r.permissions().catch(() => null);
    if (grant) await reflect(r, grant);
    else { abandonProvider(); setButton("Connect Switchboard", true); }
  })();

  // Connect / finish-setup: request the FULL manifest scope (so Higgsfield/Shopify/etc. are consented),
  // then bind the data folder. Re-running is safe — it re-consents to the same scope.
  $("#sb-connect").addEventListener("click", async () => {
    const r = await whenRelayReady();
    if (!("connect" in r)) { setStatus("not installed", "#FF2D6E"); return; }
    try {
      const existing = await r.permissions().catch(() => null);
      const grant = grantCoversTools(existing, scope.tools) ? existing : await r.connect(scope);
      setProvider(window.claude);
      window.__switchboardRoutes?.mount(window.claude);
      setButton("", false);
      const bound = await ensureBound();
      // If we didn't reload (already bound), publish the brands now so they're lendable to other apps.
      if (bound && !bound.autoAssigned && !(bound.count > 0)) await publishBrands(r);
    } catch (e) { setStatus(`connect failed (${e?.code ?? e?.message ?? "?"})`, "#FF2D6E"); }
  });

  $("#sb-bind").addEventListener("click", async () => {
    const path = $("#sb-folder").value.trim();
    if (!path) return;
    setStatus("approve the folder in Switchboard…", "#F59E0B");
    const info = await bindFolder(path);
    if (!info) { setStatus("bind declined", "#FF2D6E"); return; }
    setStatus(`bound · ${info.count} record${info.count === 1 ? "" : "s"}`, "#3DD68C");
    if (info.count > 0) setTimeout(() => location.reload(), 500);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();
