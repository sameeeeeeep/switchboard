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

const port = chrome.runtime.connect({ name: "relay-page" });

port.onMessage.addListener((msg: { id?: string; result?: unknown; error?: any; event?: string; payload?: unknown }) => {
  if (msg.event) {
    const ev: PageEvent = { ns: RELAY_NS, dir: "cs->page", event: msg.event, payload: msg.payload };
    window.postMessage(ev, window.location.origin);
  } else if (msg.id) {
    const res: PageResponse = { ns: RELAY_NS, dir: "cs->page", id: msg.id, result: msg.result, error: msg.error };
    window.postMessage(res, window.location.origin);
  }
});

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.source !== window) return;
  if (!isPageRequest(ev.data)) return;
  // Forward the bare request. The background worker stamps the verified origin.
  port.postMessage({ id: ev.data.id, method: ev.data.method, params: ev.data.params });
});
