import type { RequestEnvelope, HealthStatus, HealthReason } from "@relay/protocol";

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

/** Classification of the most recent FAILED dial: did the daemon accept the socket open and then
 *  close it before auth_ok (its 1008 "unauthorized" — the token was rejected → "unpaired"), or did
 *  the dial never open at all ("unreachable")? Worker-memory only — never persisted; MV3 eviction
 *  just recomputes on the next dial. Reset on auth_ok so a long-ago rejection can't go stale. */
let lastDial = { openedButUnauthed: false, at: 0 };

const inflight = new Map<string, chrome.runtime.Port>();     // page request id → page port
const pagePorts = new Set<chrome.runtime.Port>();            // all page ports (for events)
const pendingConsent = new Map<string, { resolve: (r: unknown) => void }>(); // daemon prompt id → resolver
const pendingControl = new Map<string, { resolve: (r: unknown) => void }>(); // control call id → resolver
const consentBodies = new Map<string, { kind: string; body: unknown }>();    // prompt id → data for the window

/** Notification id = this prefix + the consent id, so a toast button click maps back to its prompt. */
const NOTIF_PREFIX = "relay-consent:";

/** Resolve an open consent (from the panel OR a toast button) with the daemon's expected result.
 *  Returns whether a pending prompt was actually waiting. `openConsent`'s `await` does the rest
 *  (drops the body, clears the badge/toast, replies to the daemon). */
function resolveConsent(id: string, result: unknown): boolean {
  const p = pendingConsent.get(id);
  if (!p) return false;
  pendingConsent.delete(id);
  p.resolve(result);
  return true;
}

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
      let sawOpen = false; // per-attempt: the daemon accepted the socket (reachable), even if auth then failed
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        // Every failed attempt records WHY for the health ladder: opened-then-closed-pre-auth means
        // the daemon is up but the token was rejected ("unpaired"); never-opened means "unreachable".
        if (!ok) lastDial = { openedButUnauthed: sawOpen && !authed, at: Date.now() };
        resolve(ok);
      };
      try { socket = new WebSocket(DAEMON_URL); } catch { finish(false); return; }
      authed = false;
      const timer = setTimeout(() => finish(false), 6000); // daemon down / never auths
      socket.onopen = () => { sawOpen = true; socket!.send(JSON.stringify({ type: "auth", token })); };
      socket.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case "auth_ok":
            authed = true;
            lastDial = { openedButUnauthed: false, at: Date.now() }; // accepted pairing — clear any stale rejection
            clearTimeout(timer); finish(true);
            void broadcastHealth(); // the ladder moved up — pages/panel upgrade live
            break;
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
      socket.onclose = () => {
        authed = false; socket = null; ready = null; clearTimeout(timer); finish(false);
        // The ladder moved down (daemon stopped, or an auth-rejected close). Deduped inside, so the
        // ~1s reconnect loop below never spams identical pushes.
        void broadcastHealth();
        // Auto-reconnect while any page is attached (daemon restart, transient drop) so events
        // (deltas, permissionsChanged) resume without waiting for the next page request.
        if (pagePorts.size > 0) setTimeout(() => { void ensureSocket(); }, 1000);
      };
      socket.onerror = () => { /* onclose follows */ };
    });
  })();
  const p = ready;
  // Allow a fresh attempt next time if this one failed.
  p.then((ok) => { if (!ok) ready = null; });
  return p;
}

/** A bounded, daemon-free reachability probe: bare-dial the daemon and see whether ANYTHING answers
 *  the socket open. Connection-refused on 127.0.0.1 returns in milliseconds; the timer only bites
 *  when the port is filtered/hung. Used when NO token is stored (ensureSocket won't even dial then),
 *  so the ladder can still tell "unpaired" from "unreachable". Single shared in-flight dial + a 5s
 *  result cache keep the request path <1s; worker memory only — MV3 eviction just recomputes. */
let probeInflight: Promise<boolean> | null = null;
let probeCache: { ok: boolean; at: number } | null = null;
function probeReachable(timeoutMs = 800): Promise<boolean> {
  if (probeCache && Date.now() - probeCache.at < 5000) return Promise.resolve(probeCache.ok);
  if (probeInflight) return probeInflight;
  probeInflight = new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      probeCache = { ok, at: Date.now() };
      probeInflight = null;
      resolve(ok);
    };
    let ws: WebSocket | null = null;
    try { ws = new WebSocket(DAEMON_URL); } catch { settle(false); return; }
    const timer = setTimeout(() => { try { ws!.close(); } catch { /* ignore */ } settle(false); }, timeoutMs);
    ws.onopen = () => { clearTimeout(timer); try { ws!.close(); } catch { /* ignore */ } settle(true); };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => { clearTimeout(timer); settle(false); };
  });
  return probeInflight;
}

/** This origin's grant, if any (the widgetState lookup, extracted so health shares it). */
async function grantFor(origin: string): Promise<{ origin: string; mode?: string; usage?: { tokensToday?: number } } | null> {
  const g = await control("listGrants") as { grants?: Array<{ origin: string; mode?: string; usage?: { tokensToday?: number } }> };
  return (g?.grants ?? []).find((x) => x.origin === origin) ?? null;
}

/** The setup ladder WITHOUT the per-origin bit: reachable/paired/reason from the worker's own state.
 *  Never redials when a token is stored — it classifies from the last dial (fresh at every
 *  transition call site), so a broadcast from socket.onclose can't recurse into a reconnect. */
async function baseHealth(): Promise<{ installed: true; reachable: boolean; paired: boolean; reason?: HealthReason }> {
  if (socket && socket.readyState === WebSocket.OPEN && authed) return { installed: true, reachable: true, paired: true };
  const token = await getToken();
  if (token) {
    if (lastDial.openedButUnauthed) return { installed: true, reachable: true, paired: false, reason: "unpaired" };
    return { installed: true, reachable: false, paired: false, reason: "unreachable" };
  }
  const reachable = await probeReachable();
  return { installed: true, reachable, paired: false, reason: reachable ? "unpaired" : "unreachable" };
}

/** claude_health's answer — the one method that never NEEDS the daemon. Degraded states resolve
 *  entirely from worker state (<1s via the probe cache); only the healthy state consults the daemon,
 *  and only for this origin's `connected` bit. */
async function healthSnapshot(origin: string): Promise<HealthStatus> {
  if (socket && socket.readyState === WebSocket.OPEN && authed) {
    return { installed: true, reachable: true, paired: true, connected: !!(await grantFor(origin)) };
  }
  const token = await getToken();
  if (token) {
    if (await ensureSocket()) return { installed: true, reachable: true, paired: true, connected: !!(await grantFor(origin)) };
    if (lastDial.openedButUnauthed) return { installed: true, reachable: true, paired: false, connected: false, reason: "unpaired" };
    return { installed: true, reachable: false, paired: false, connected: false, reason: "unreachable" };
  }
  const reachable = await probeReachable();
  return { installed: true, reachable, paired: false, connected: false, reason: reachable ? "unpaired" : "unreachable" };
}

/** Fan the `health` event out to every page (per-origin `connected`) and nudge the open panel to
 *  re-pull — mirroring the daemon-event fan-out in ensureSocket. DEDUPED on the base ladder state:
 *  the onclose reconnect loop and repeated failed dials produce ONE push per actual transition. */
let lastHealthKey = "";
async function broadcastHealth(): Promise<void> {
  const base = await baseHealth();
  const key = `${base.reachable}|${base.paired}|${base.reason ?? ""}`;
  if (key === lastHealthKey) return;
  lastHealthKey = key;
  // One grant list when reachable+paired; per-origin `connected` derives from it. False otherwise.
  let grants: Array<{ origin: string }> = [];
  if (base.reachable && base.paired) {
    try { const g = await control("listGrants") as { grants?: Array<{ origin: string }> }; grants = g?.grants ?? []; } catch { /* stays [] */ }
  }
  for (const p of pagePorts) {
    const origin = p.sender?.origin ?? (p.sender?.url ? new URL(p.sender.url).origin : "null");
    const payload: HealthStatus = { ...base, connected: grants.some((x) => x.origin === origin) };
    try { p.postMessage({ event: "health", payload }); } catch { /* gone */ }
  }
  try { panelPort?.postMessage({ type: "state:changed", event: "health" }); } catch { /* panel gone */ }
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

/** A daemon consent prompt. If the side panel is open, it renders there (the richest surface). If
 *  closed, a simple yes/no prompt (a write, or a folder bind) becomes a desktop TOAST with
 *  Approve/Deny — so the user never has to keep the panel docked or even open it. Prompts that need
 *  choices (connect's tool checkboxes, context-pick's radios) can't collapse to two buttons, so they
 *  fall back to opening the panel. The lime badge is always set as a backstop. Awaits the user's
 *  decision and replies to the daemon (fail-closed on timeout). */
async function openConsent(id: string, kind: string, body: unknown): Promise<void> {
  consentBodies.set(id, { kind, body });
  updateBadge();
  const decision = new Promise<unknown>((resolve) => pendingConsent.set(id, { resolve }));
  if (panelPort) {
    try { panelPort.postMessage({ type: "consent:new", id }); } catch { /* panel gone; badge stands */ }
  } else {
    const toast = consentToast(kind, body);
    if (toast) showConsentToast(id, toast);   // yes/no prompt → decide right from the notification
    else void tryOpenPanel();                 // connect / context-pick need the full panel UI
  }
  const result = await decision;
  consentBodies.delete(id);
  updateBadge();
  try { chrome.notifications?.clear(NOTIF_PREFIX + id); } catch { /* no-op if it was never shown */ }
  if (socket && authed) socket.send(JSON.stringify({ type: "reply", id, result }));
}

/** The two consent kinds that reduce to a single Approve/Deny — safe to show as a toast. `connect`
 *  and `context-pick` carry choices (which tools, which brand) and are deliberately excluded. */
function consentToast(kind: string, body: any): { title: string; message: string } | null {
  const h = (o: string) => { try { return new URL(String(o).includes("://") ? o : `https://${o}`).host; } catch { return String(o); } };
  if (kind === "consent:write") {
    const name = String(body?.tool?.name ?? "an action");
    const short = name.includes("__") ? name.split("__").pop()! : name;
    return { title: "Switchboard — approve action", message: `${h(body?.origin ?? "")} wants to run ${short}` };
  }
  if (kind === "consent:storage-bind") {
    return { title: "Switchboard — folder access", message: `${h(body?.origin ?? "")} wants to read & write ${body?.path ?? "a folder"}` };
  }
  return null;
}

/** Show a consent as a desktop notification with Approve/Deny buttons. If notifications are
 *  unavailable (API absent, or the OS denied them), fall back to opening the panel — the badge
 *  already marks the pending prompt either way. */
function showConsentToast(id: string, toast: { title: string; message: string }): void {
  if (!chrome.notifications) { void tryOpenPanel(); return; }
  try {
    chrome.notifications.create(NOTIF_PREFIX + id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: toast.title,
      message: toast.message,
      buttons: [{ title: "Approve" }, { title: "Deny" }],
      requireInteraction: true, // a consent shouldn't auto-dismiss out from under the user
      priority: 2,
    }, () => { if (chrome.runtime.lastError) void tryOpenPanel(); });
  } catch { void tryOpenPanel(); }
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

/** The minimal, origin-scoped status the in-page widget shows on a wrapp site: is Switchboard set
 *  up, is THIS page connected, what's lent to it, and today's compute. Deliberately narrow — the
 *  widget never receives the whole grant list or library; only this origin's own connection info
 *  (which the page already earned by connecting). Sensitive controls stay in the panel/toast. */
async function widgetState(sender: chrome.runtime.MessageSender): Promise<Record<string, unknown>> {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  const token = await getToken();
  let paired = !!token;
  let reachable: boolean;
  if (token) {
    reachable = await ensureSocket();
    // Daemon up but it rejected the token → the daemon IS reachable and pairing is what's missing.
    if (!reachable && lastDial.openedButUnauthed) { reachable = true; paired = false; }
  } else {
    // No token: probe anyway, so the widget can tell "sidekick asleep" from "pair now".
    reachable = await probeReachable();
  }
  if (!reachable || !paired) return { paired, reachable, connected: false };
  const grant = await grantFor(origin);
  let lentName: string | null = null;
  if (grant) {
    const c = await control("listContexts") as { contexts?: Array<{ id: string; name: string }>; activeProject?: string | null; selections?: Array<{ origin: string; contextId: string | null }> };
    const sel = (c?.selections ?? []).find((s) => s.origin === origin)?.contextId ?? c?.activeProject ?? null;
    lentName = (c?.contexts ?? []).find((x) => x.id === sel)?.name ?? null;
  }
  return { paired: true, reachable: true, connected: !!grant, mode: grant?.mode ?? null, lentName, tokensToday: grant?.usage?.tokensToday ?? 0 };
}

/** The widget's "Manage" button → open the full control surface for the sensitive actions. Prefer the
 *  docked side panel on the sender's window; if Chrome refuses (gesture didn't cross the message
 *  boundary), fall back to the panel as its own tab so the button always does something. */
async function openPanelFor(sender: chrome.runtime.MessageSender): Promise<void> {
  const windowId = sender.tab?.windowId;
  try {
    if (windowId != null) { await chrome.sidePanel.open({ windowId }); return; }
  } catch { /* gesture required — fall through */ }
  try { await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") }); } catch { /* ignore */ }
}

// ---- messages from the popup + consent windows ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "getStatus": {
        const token = await getToken();
        // `reachable` = something answers the daemon port. With a token that means "up + authenticates";
        // without one we bare-probe, so the panel can tell "unpaired" (show pairing) from "unreachable"
        // (show the get-the-sidekick card). `tokenRejected` = the daemon answered but refused OUR token —
        // the panel must say "token didn't match", never "isn't running", when it is running.
        const reachable = token ? await ensureSocket() : await probeReachable();
        sendResponse({ paired: !!token, reachable, tokenRejected: !!token && !reachable && lastDial.openedButUnauthed });
        break;
      }
      case "widgetState": sendResponse(await widgetState(sender)); break;
      case "openPanel": await openPanelFor(sender); sendResponse({ ok: true }); break;
      case "pair": await chrome.storage.local.set({ pairingToken: msg.token }); await ensureSocket(); void broadcastHealth(); sendResponse({ ok: true }); break;
      case "openUrl": { const url = String(msg.url ?? ""); if (/^https?:\/\//i.test(url)) chrome.tabs.create({ url }); sendResponse({ ok: true }); break; }
      case "getConsentPrompt": sendResponse(consentBodies.get(msg.id) ?? null); break;
      // The panel's per-app "Review request" button: which consents are waiting, and for whom —
      // so the decision itself always happens in the one consent view.
      case "getPendingConsents":
        sendResponse({ pending: [...consentBodies.entries()].map(([id, v]) => ({ id, kind: v.kind, origin: (v.body as { origin?: string } | null)?.origin ?? null })) });
        break;
      case "consentDecision": {
        resolveConsent(msg.id, msg.result);
        sendResponse({ ok: true });
        break;
      }
      case "control": sendResponse(await control(msg.action, msg.args)); break;
      case "killSwitch":
        await control("killSwitch");
        await chrome.storage.local.remove("pairingToken");
        try { socket?.close(); } catch { /* ignore */ }
        socket = null; authed = false;
        lastDial = { openedButUnauthed: false, at: Date.now() };
        void broadcastHealth(); // pages downgrade live — the ladder just fell to unpaired/unreachable
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
    // claude_health — the one method the background answers from its OWN state, before any daemon
    // dial: it must resolve fast in exactly the states where everything else would fail.
    if (m.method === "claude_health") {
      try { port.postMessage({ id: m.id, result: await healthSnapshot(origin) }); } catch { /* port gone */ }
      return;
    }
    const ok = await ensureSocket();
    if (!ok || !socket) {
      // FAST-FAIL with the classified reason instead of letting the page hang into inject.ts's 130s
      // backstop. Only this initial request/ack path fails here — an already-open stream is never
      // touched (its deltas simply stop if the socket died; the `health` push tells the page why).
      const token = await getToken();
      const reason: HealthReason = token
        ? (lastDial.openedButUnauthed ? "unpaired" : "unreachable")
        : ((await probeReachable()) ? "unpaired" : "unreachable");
      port.postMessage({
        id: m.id,
        error: {
          code: 4900,
          message: reason === "unpaired"
            ? "Switchboard isn't paired yet — open the side panel to pair"
            : "your sidekick isn't reachable — open the Relay app",
          data: { reason },
        },
      });
      return;
    }
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

// ---- consent toasts: decide a write/bind straight from the notification, panel closed ----
// A button click IS the human gesture the consent model requires — the model can never reach here.
chrome.notifications?.onButtonClicked.addListener((notifId, btnIdx) => {
  if (!notifId.startsWith(NOTIF_PREFIX)) return;
  resolveConsent(notifId.slice(NOTIF_PREFIX.length), btnIdx === 0); // 0 = Approve → true, 1 = Deny → false
  try { chrome.notifications.clear(notifId); } catch { /* ignore */ }
});
// Clicking the toast body (not a button) opens the panel for the full detail, leaving it undecided.
chrome.notifications?.onClicked.addListener((notifId) => {
  if (notifId.startsWith(NOTIF_PREFIX)) void tryOpenPanel();
});

// The toolbar icon toggles the docked side panel. The glanceable surface is the in-page widget
// (content script) — it rides IN the page so it can't be buried the way a detached window is.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// Warm the socket on startup if already paired.
void ensureSocket();
