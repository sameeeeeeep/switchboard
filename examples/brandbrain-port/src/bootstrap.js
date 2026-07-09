// Switchboard bootstrap — the one injected client entry that turns the exported brandbrain into a
// broker app. It mounts the 32 route handlers into the fetch-router (so brandbrain's own
// fetch("/api/*") calls dispatch locally) and drops in the ONE standard connect affordance
// (`mountConnect` from the SDK) — the same chip every wrapp uses. brandbrain's own UI is untouched.
//
// Deliberately NOT here: any folder / storage / connectors UI. The chip carries identity only;
// data-folder and connector management live inside Switchboard (its side panel). The declared data
// folder (switchboard.json → storage.defaultFolder) is bound SILENTLY on connect — its one path-
// consent prompt surfaces in Switchboard, not as an input box on the page.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { setProvider, abandonProvider } from "../../adapter/claude.mjs";
import { bindFolder, storageInfo, storageGet, workspaceLoadLost } from "../../adapter/claude_storage.mjs";

// Map a rich brandbrain Brand → a slim, portable context other apps (e.g. Prism) can use. Opaque
// `data`, no locked schema — just the fields a downstream wrapper is likely to want.
//
// Consumers (Prism, persona, Cast) read `data.palette` as flat CSS color strings, but brandbrain's
// locked identity palette is [{ name, hex }] swatches — published raw, every swatch renders as
// "[object Object]". Flatten at this boundary; the named swatches survive as `paletteRich`.
// docs/CONTEXT-KINDS.md is the contract. Mirrored in proof/run-context-demo.mjs — keep in sync.
function flattenPalette(raw) {
  const flat = [], rich = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (typeof p === "string" && p.trim()) flat.push(p.trim());
    else if (p && typeof p.hex === "string" && p.hex.trim()) {
      flat.push(p.hex.trim());
      rich.push({ name: String(p.name || "").trim(), hex: p.hex.trim() });
    }
  }
  return { flat, rich };
}
function brandToContext(b) {
  const L = b.locks || {};
  const line = (c) => (c && (c.title || c.name)) || "";
  const { flat: palette, rich: paletteRich } = flattenPalette((L.identity && L.identity.palette) || b.palette || []);
  const products = [line(L.range), line(L.format), b.idea].filter(Boolean);
  return {
    id: b.id,                       // stable → re-publish updates in place, never duplicates
    name: b.name || "Brand",
    kind: "brand",
    data: {
      voice: line(L.voice) || (b.brief && b.brief.vibe) || "",
      positioning: line(L.positioning) || "",
      audience: line(L.audience) || (b.brief && b.brief.audience) || "",
      palette,
      ...(paletteRich.length ? { paletteRich } : {}),
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

// The app's requested scope + default data folder come from switchboard.json (the capability
// manifest). This is what makes the connect consent ask for exactly what brandbrain uses — its
// tools (Higgsfield visuals, Shopify, Gmail, web search) and its models — instead of nothing.
const DEFAULTS = { reason: "brandbrain", models: ["sonnet"], tools: [], storage: {} };
// PORT_BASE_PATH (esbuild-defined at build) prefixes the manifest fetch so it resolves under a
// subpath deploy; "" (root deploy) preserves the original absolute /switchboard.json.
const BASE = process.env.PORT_BASE_PATH || ""; // esbuild `define` inlines this to a string literal
async function loadManifest() {
  try { const r = await fetch(`${BASE}/switchboard.json`); if (r.ok) return { ...DEFAULTS, ...(await r.json()) }; } catch {}
  return DEFAULTS;
}
async function main() {
  const manifest = await loadManifest();
  const scope = { reason: manifest.reason, models: manifest.models, tools: manifest.tools };
  const defaultFolder = manifest.storage?.defaultFolder;

  mountRoutes();

  // Wire the provider into the model transport + the fetch-router. Idempotent — the fast probe (grant
  // on load) and the chip's onConnect (fresh click) can both call it; only the first does work.
  let wired = false;
  const wireProvider = () => {
    if (wired) return; wired = true;
    setProvider(window.claude);
    window.__switchboardRoutes?.mount(window.claude);
  };

  // One guarded reload per tab-session: re-runs brandbrain's one-shot workspace read now that the
  // provider is live. Both rehydration paths below share the guard, so it can never loop.
  function rehydrate() {
    if (sessionStorage.getItem("sb:rehydrated")) return;
    sessionStorage.setItem("sb:rehydrated", "1");
    location.reload();
  }

  // Once connected: wire the provider, bind the declared data folder if we're still on the empty
  // sandbox (the path-consent surfaces inside Switchboard — no folder UI here), and publish the
  // workspace's brands so they're lendable to other apps. Runs once.
  let connected = false;
  async function afterConnect(relay, fresh = false) {
    if (connected) return; connected = true;
    wireProvider();
    const info = await storageInfo().catch(() => null);
    if (defaultFolder && info && info.autoAssigned) {
      const bound = await bindFolder(defaultFolder).catch(() => null);
      // We just pointed storage at the real folder AFTER the app's one-shot workspace read — reload
      // once so those records surface.
      if (bound && bound.count > 0) { rehydrate(); return; }
    }
    await publishBrands(relay);
    // Two ways the grid can be showing empty over real data by the time we get here:
    //   1. fresh chip CLICK — the workspace read fired pre-consent and was denied (the already-bound
    //      twin of the bind case above);
    //   2. the PROBE path lost the race — the app's read timed out waiting for the provider (e.g. a
    //      cold extension worker re-authing its daemon socket answers the grant probe late) even
    //      though this very afterConnect then succeeded. The adapter records that as
    //      workspaceLoadLost().
    // Same cure for both: one guarded reload; on the reloaded page the provider wires BEFORE the read.
    if (fresh || workspaceLoadLost()) rehydrate();
  }

  // The ONE standard connect affordance — identity + connect + the lent-project switcher. Connectors,
  // budgets, data folders, trust mode and revoke all live in the Switchboard side panel; the chip is a
  // door to it, never a copy. Rendered in a shadow root so brandbrain's CSS can't restyle it away.
  const dock = document.createElement("div");
  dock.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483000";
  document.body.appendChild(dock);
  mountConnect(dock, { scope, onConnect: (relay) => { void afterConnect(relay, true); } });

  // Fast provider probe: set the provider the instant we confirm an existing grant — BEFORE brandbrain's
  // workspace load races in — so a returning user's brands appear on first paint without a reload. No
  // grant yet → release the storage await so the first read doesn't hang (the chip shows "Connect").
  (async () => {
    const r = await whenRelayReady(1500);
    if (!(r && "connect" in r)) { abandonProvider(); return; }
    const grant = await r.permissions().catch(() => null);
    if (grant) await afterConnect(r);
    else abandonProvider();
  })();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();
