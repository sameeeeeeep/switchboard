import { RELAY_NS, isPageRequest, type PageResponse, type PageEvent } from "./messaging.js";

/**
 * ISOLATED-world content script. It is the seam between the untrusted page and the trusted
 * extension. It forwards page requests to the background worker via chrome.runtime and relays
 * responses/events back. It deliberately adds NO origin claim — the BACKGROUND worker derives
 * the authoritative origin from the message sender (see background.ts). The page cannot forge
 * its origin because it never supplies one that the daemon trusts.
 */
// Inject the MAIN-world provider (window.claude) by adding a page <script> that points at the
// web-accessible inject.js. This is the reliable, cross-version wallet pattern — more robust than
// a manifest `world: "MAIN"` content script, which some Chrome versions inject inconsistently.
try {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("dist/inject.js");
  s.async = false; // preserve execution order (run before the page's own scripts where possible)
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
} catch (err) {
  console.error("[relay] failed to inject provider:", err);
}

/**
 * SELF-HEALING PORT. MV3 evicts the service worker after ~30s idle; that disconnects this port.
 * The old code created the port ONCE, so after any eviction the page looked "attached but not
 * flowing": window.claude present, chip connected, but every request fell into a dead port and
 * every stream went silent. Reconnect on disconnect (connecting wakes the worker), and re-send
 * requests that were in flight when the port died so callers get an answer instead of a hang.
 */
let port: chrome.runtime.Port | null = null;
const pending = new Map<string, { method: string; params: unknown }>(); // id → request awaiting a response

function wirePort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: "relay-page" });
  p.onMessage.addListener((msg: { id?: string; result?: unknown; error?: any; event?: string; payload?: unknown }) => {
    if (msg.event) {
      const ev: PageEvent = { ns: RELAY_NS, dir: "cs->page", event: msg.event, payload: msg.payload };
      window.postMessage(ev, window.location.origin);
    } else if (msg.id) {
      pending.delete(msg.id);
      const res: PageResponse = { ns: RELAY_NS, dir: "cs->page", id: msg.id, result: msg.result, error: msg.error };
      window.postMessage(res, window.location.origin);
    }
  });
  p.onDisconnect.addListener(() => {
    if (port === p) port = null;
    // Reconnect on a short delay (wakes the evicted worker) and replay unanswered requests.
    setTimeout(() => {
      try {
        const np = ensurePort();
        for (const [id, req] of pending) { try { np.postMessage({ id, method: req.method, params: req.params }); } catch { /* next cycle */ } }
      } catch { /* extension unloading / tab closing */ }
    }, 250);
  });
  return p;
}

function ensurePort(): chrome.runtime.Port {
  if (!port) port = wirePort();
  return port;
}
ensurePort();

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.source !== window) return;
  if (!isPageRequest(ev.data)) return;
  // Forward the bare request. The background worker stamps the verified origin.
  const req = { id: ev.data.id, method: ev.data.method, params: ev.data.params };
  pending.set(req.id, { method: req.method, params: req.params });
  try { ensurePort().postMessage(req); }
  catch { port = null; try { ensurePort().postMessage(req); } catch { /* dead — replay on reconnect */ } }
});
