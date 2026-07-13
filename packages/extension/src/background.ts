import type { RequestEnvelope } from "@relay/protocol";

/**
 * The MV3 service worker — the trusted core of the extension.
 *   • Holds the pairing token (chrome.storage.local). The PAGE never sees it.
 *   • Is the ORIGIN ORACLE: derives each request's origin from the connecting port's sender,
 *     NOT from anything the page said, and stamps it on the envelope.
 *   • Owns the single WS to the daemon; multiplexes all tabs + the popup + consent windows.
 *   • Renders consent prompts the daemon pushes (opens a focused window, awaits the human click).
 *     The model can never satisfy these — only a click can.
 *
 * MV3 caveat: if the worker is evicted while a consent prompt is open, the pending resolver is
 * lost and the daemon's prompt times out fail-closed (a denial). Prompts are short-lived and the
 * open window keeps the worker warm, so this is acceptable for v1; a durable queue is future work.
 */

const DAEMON_URL = "ws://127.0.0.1:8787";
let socket: WebSocket | null = null;
let authed = false;

const inflight = new Map<string, chrome.runtime.Port>();     // page request id → page port
const pagePorts = new Set<chrome.runtime.Port>();            // all page ports (for events)
const pendingConsent = new Map<string, { resolve: (r: unknown) => void }>(); // daemon prompt id → resolver
const pendingControl = new Map<string, { resolve: (r: unknown) => void }>(); // control call id → resolver
const consentBodies = new Map<string, { kind: string; body: unknown }>();    // prompt id → data for the window

async function getToken(): Promise<string | null> {
  const { pairingToken } = await chrome.storage.local.get("pairingToken");
  return pairingToken ?? null;
}

/** Resolves TRUE only once the socket is open AND authenticated (auth_ok received). A single
 *  in-flight connect is shared; MV3 can evict the worker between calls, so this reconnects on
 *  demand and every caller awaits real readiness — the fix for spurious 4900s. */
let ready: Promise<boolean> | null = null;

function ensureSocket(): Promise<boolean> {
  if (socket && socket.readyState === WebSocket.OPEN && authed) return Promise.resolve(true);
  if (ready) return ready;
  ready = (async () => {
    const token = await getToken();
    if (!token) return false;
    return await new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
      try { socket = new WebSocket(DAEMON_URL); } catch { finish(false); return; }
      authed = false;
      const timer = setTimeout(() => finish(false), 6000); // daemon down / never auths
      socket.onopen = () => socket!.send(JSON.stringify({ type: "auth", token }));
      socket.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case "auth_ok": authed = true; clearTimeout(timer); finish(true); break;
          case "response": {
            const port = inflight.get(msg.id); inflight.delete(msg.id);
            port?.postMessage({ id: msg.id, result: msg.result, error: msg.error });
            break;
          }
          case "event":
            for (const p of pagePorts) { try { p.postMessage({ event: msg.event, payload: msg.payload }); } catch { /* gone */ } }
            // TabSidekick streams its task output into the panel, so the panel DOES need `delta` here
            // (unlike page streams, which flow to the page ports above). Route it to the panel port.
            if (msg.event === "delta") { try { panelPort?.postMessage({ type: "delta", payload: msg.payload }); } catch { /* panel gone */ } }
            // Also nudge the side panel: a grant/pick/permission change means its view is stale, so
            // it re-pulls fresh state instead of needing a reopen. Skip `delta` — it fires per stream
            // token and changes nothing the panel's home shows (that would be a refresh on every token).
            else { try { panelPort?.postMessage({ type: "state:changed", event: msg.event }); } catch { /* panel gone */ } }
            break;
          case "prompt":
            void openConsent(msg.id, msg.kind, msg.body);
            break;
          case "control_result": {
            const c = pendingControl.get(msg.id); pendingControl.delete(msg.id);
            c?.resolve(msg.result);
            break;
          }
        }
      };
      socket.onclose = () => { authed = false; socket = null; ready = null; clearTimeout(timer); finish(false); };
      socket.onerror = () => { /* onclose follows */ };
    });
  })();
  const p = ready;
  // Allow a fresh attempt next time if this one failed.
  p.then((ok) => { if (!ok) ready = null; });
  return p;
}

/** Push a control call to the daemon and await its result (popup grant list / audit / revoke). */
function control(action: string, args?: unknown): Promise<unknown> {
  return new Promise(async (resolve) => {
    const ok = await ensureSocket();
    if (!ok || !socket) { resolve({ ok: false, error: "sidekick not reachable" }); return; }
    const id = crypto.randomUUID();
    pendingControl.set(id, { resolve });
    setTimeout(() => { if (pendingControl.delete(id)) resolve({ ok: false, error: "timeout" }); }, 15_000);
    socket.send(JSON.stringify({ type: "control", id, action, args }));
  });
}

// The side panel, when open, holds a long-lived port so we can render consent INLINE there instead
// of a separate window. panelPort is null when the panel is closed → we fall back to the window.
let panelPort: chrome.runtime.Port | null = null;

function updateBadge() {
  const n = consentBodies.size;
  try {
    chrome.action.setBadgeText({ text: n ? String(n) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#C8F250" });
    chrome.action.setTitle({ title: n ? "Relay — approval waiting (click to open)" : "Relay" });
  } catch { /* ignore */ }
}

/** A daemon consent prompt. It ALWAYS shows in the side panel — never a separate window. If the
 *  panel is open, we push it there; if closed, we best-effort open the panel and badge the icon so
 *  the user clicks it. Awaits the user's decision and replies to the daemon (fail-closed on timeout). */
async function openConsent(id: string, kind: string, body: unknown): Promise<void> {
  consentBodies.set(id, { kind, body });
  updateBadge();
  const decision = new Promise<unknown>((resolve) => pendingConsent.set(id, { resolve }));
  if (panelPort) {
    try { panelPort.postMessage({ type: "consent:new", id }); } catch { /* panel gone; badge stands */ }
  } else {
    void tryOpenPanel(); // may need a user gesture; if blocked, the lime badge guides the click
  }
  const result = await decision;
  consentBodies.delete(id);
  updateBadge();
  if (socket && authed) socket.send(JSON.stringify({ type: "reply", id, result }));
}

/** Best-effort: open the side panel for the focused window. Chrome may require a user gesture; if
 *  so this throws and we rely on the badge — but once the user opens the panel once it stays open,
 *  and every later request just appears inline. */
async function tryOpenPanel() {
  try {
    const win = await chrome.windows.getLastFocused();
    if (win?.id != null) await chrome.sidePanel.open({ windowId: win.id });
  } catch { /* gesture required — the badge signals the pending request instead */ }
}

// ---- messages from the popup + consent windows ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "getStatus": {
        const token = await getToken();
        // `reachable` = the daemon is actually up + authenticates. Distinguishes "token stored"
        // from "sidekick running", so the panel can tell you to start it instead of a blind 4900.
        const reachable = token ? await ensureSocket() : false;
        sendResponse({ paired: !!token, reachable });
        break;
      }
      case "pair": await chrome.storage.local.set({ pairingToken: msg.token }); await ensureSocket(); sendResponse({ ok: true }); break;
      case "getConsentPrompt": sendResponse(consentBodies.get(msg.id) ?? null); break;
      case "consentDecision": {
        const p = pendingConsent.get(msg.id); pendingConsent.delete(msg.id);
        p?.resolve(msg.result);
        sendResponse({ ok: true });
        break;
      }
      case "control": sendResponse(await control(msg.action, msg.args)); break;
      case "killSwitch":
        await control("killSwitch");
        await chrome.storage.local.remove("pairingToken");
        try { socket?.close(); } catch { /* ignore */ }
        socket = null; authed = false;
        sendResponse({ ok: true });
        break;
      default: sendResponse({ ok: false });
    }
  })();
  return true; // async sendResponse
});

// ---- the side panel's port: lets us render consent inline instead of a window ----
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "relay-panel") {
    panelPort = port;
    // Opening the panel wakes the worker — reconnect the socket so the daemon can RE-PUSH any consent
    // that was queued while we were evicted (its `prompt` messages then flow through openConsent).
    void ensureSocket();
    // Surface any consent already in memory (panel reopened without a worker restart).
    for (const id of consentBodies.keys()) { try { port.postMessage({ type: "consent:new", id }); } catch { /* ignore */ } }
    port.onDisconnect.addListener(() => { if (panelPort === port) panelPort = null; });
    return;
  }
});

// ---- the page bridge (origin oracle) ----
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "relay-page") return;
  pagePorts.add(port);
  const origin = port.sender?.origin ?? (port.sender?.url ? new URL(port.sender.url).origin : "null");

  port.onMessage.addListener(async (m: { id: string; method: string; params?: unknown }) => {
    const ok = await ensureSocket();
    if (!ok || !socket) { port.postMessage({ id: m.id, error: { code: 4900, message: "sidekick not reachable" } }); return; }
    const envelope: RequestEnvelope = {
      id: m.id,
      origin, // <-- stamped here; the page's claim (if any) is ignored
      method: m.method as RequestEnvelope["method"],
      params: m.params as never,
      sentAt: Date.now(),
    };
    inflight.set(m.id, port);
    socket.send(JSON.stringify({ type: "request", ...envelope }));
  });

  port.onDisconnect.addListener(() => {
    pagePorts.delete(port);
    for (const [id, p] of inflight) if (p === port) inflight.delete(id);
  });
});

// Clicking the toolbar icon opens the side panel (the primary control surface).
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// Warm the socket on startup if already paired.
void ensureSocket();
