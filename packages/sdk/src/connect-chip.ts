import { PROVIDER_GLOBAL, BYOPErrorCode } from "@relay/protocol";
import type { Context, ScopeRequest, UserIdentity } from "@relay/protocol";
import { Relay, whenRelayReady } from "./index.js";

/**
 * mountConnect — the ONE standard header affordance every wrapp drops in, so connecting feels the
 * same everywhere and the app becomes "yours" the moment you connect. It is the MetaMask account
 * button for Switchboard:
 *
 *   • not installed        → "Get Switchboard"     (menu: Add to Chrome / full setup guide)
 *   • sidekick asleep      → "Your sidekick is asleep" (amber, auto-recovers on the health push)
 *   • daemon unpaired      → "Almost there — pair in the side panel"
 *   • installed, no grant  → "Connect Switchboard" (runs the consent flow)
 *   • connected            → "Hi {name} · {project}" pill + a small menu
 *
 * The chip carries IDENTITY only — who you are and the one project lent to this app, switchable
 * inline via context.pick(). Everything else (connectors, budgets, trust mode, revoke, activity)
 * lives in the Switchboard side panel; the chip is a door to it, never a copy. Rendered in a shadow
 * root so its look is consistent regardless of the host page's CSS.
 */

export interface ConnectChipOptions {
  /** Scope requested when the user clicks "Connect" (tools/models/reason). */
  scope?: ScopeRequest;
  /** Where "Get Switchboard" points when the sidekick isn't installed. */
  installUrl?: string;
  /** Fired after a successful connect, with the live client (the app can start using it). */
  onConnect?: (relay: Relay) => void;
  /** Fired after the app disconnects from this tab. */
  onDisconnect?: () => void;
  /** Fired whenever the lent project changes (via the chip's switcher or the side panel). */
  onProjectChange?: (project: Context | null) => void;
  /** How this app relates to the shared context library. NOT every app has "a selected project":
   *  - "single" (default): the app CONSUMES one lent context — the chip names it and offers Switch.
   *  - "none": a lent context has no meaning here (the app is a producer managing its own projects,
   *    like brandbrain, or simply has no brand need, like a game or a toy) — the chip is identity
   *    only: no project line, no switcher, no context fetch. */
  context?: "single" | "none";
}

export interface ConnectChipHandle {
  /** Re-pull identity/grant/project and re-render. */
  refresh: () => void;
  /** Remove the chip and detach listeners. */
  destroy: () => void;
}

type State =
  | { kind: "booting" }
  | { kind: "not-installed"; installUrl: string }
  | { kind: "unreachable" }
  | { kind: "unpaired" }
  | { kind: "disconnected"; relay: Relay }
  | { kind: "connected"; relay: Relay; user: UserIdentity | null; project: Context | null };

/** One-click extension install (the landing page stays the "full setup" story: extension + sidekick). */
const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/injmjolmnekmahlnackakiamjepegagb";

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
.chip, .btn { display: inline-flex; align-items: center; gap: 9px; cursor: pointer; border: 0;
  font-size: 13px; font-weight: 600; line-height: 1; border-radius: 10px; }
/* The canonical connect lockup — the SAME mark + wordmark on every wrapp, so users recognize
   "Connect Switchboard" the way they knew the MetaMask button. Dark pill, lime glyph, locked in
   the shadow root so a host app can't restyle it away. */
.btn { padding: 9px 15px 9px 11px; background: #12151C; color: #E8EDF4; border: 1px solid #2C3444; }
.btn.connect:hover { background: #161B24; border-color: #3A4A18; }
.btn.get { color: #C3CAD6; border-color: #262C38; }
.btn.get:hover { color: #E8EDF4; border-color: #3A4353; }
.btn .arr { color: #6E7C90; font-weight: 500; margin-left: -2px; }
/* The Switchboard mark: lime rounded square with the top-right notch (matches the side-panel brand).
   Muted to slate when the sidekick isn't installed yet — the mark "lights up" once you can connect. */
.glyph { position: relative; width: 16px; height: 16px; border-radius: 5px; background: #C8F250;
  box-shadow: 0 0 12px rgba(200,242,80,.45); flex: none; }
.glyph::after { content: ""; position: absolute; top: 4px; right: 4px; width: 4px; height: 4px;
  border-radius: 50%; background: #0A0C10; }
.btn.get .glyph { background: #6E7C90; box-shadow: none; }
.wrap { position: relative; display: inline-block; }
.chip { background: #1A1F29; border: 1px solid #262C38; padding: 6px 10px 6px 7px; color: #E8EDF4; }
.chip:hover { border-color: #3A4353; }
.av { width: 26px; height: 26px; border-radius: 7px; background: #C8F250; color: #0A0C10; display: grid;
  place-items: center; font-weight: 700; font-size: 12px; overflow: hidden; flex: none; }
.av img { width: 100%; height: 100%; object-fit: cover; }
.who { display: flex; flex-direction: column; gap: 3px; min-width: 0; text-align: left; }
.who .hi { font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.who .proj { font-size: 10.5px; font-weight: 500; color: #99A3B7; white-space: nowrap; }
.caret { color: #6E7C90; font-size: 9px; margin-left: 2px; }
.menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 2147483000; width: 232px;
  background: #1A1F29; border: 1px solid #262C38; border-radius: 12px; padding: 7px;
  box-shadow: 0 18px 40px -20px rgba(0,0,0,.7); }
.menu .lbl { padding: 8px 10px 6px; font-size: 10px; font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: #6E7C90; }
.menu .proj-row { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 8px;
  background: #20262F; cursor: pointer; border: 0; width: 100%; color: #E8EDF4; font-size: 13px; font-weight: 600; }
.menu .proj-row:hover { background: #262d38; }
.menu .proj-row .go { margin-left: auto; color: #C8F250; font-size: 11px; font-weight: 600; }
.menu .sep { height: 1px; background: #262C38; margin: 6px 4px; }
.menu .item { display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; color: #B4BECE; font-size: 13px; font-weight: 500; cursor: pointer; }
.menu .item:hover { background: #20262F; color: #E8EDF4; }
.menu .foot { padding: 8px 10px 4px; font-size: 11px; font-weight: 500; color: #6E7C90; line-height: 1.4; }
/* Setup-ladder pills (sidekick asleep / unpaired): quiet and informative, never red — nothing is
   broken. Amber only while the daemon is unreachable; the glyph stays muted until it's reachable. */
.dot { width: 7px; height: 7px; border-radius: 50%; background: #E8B84B; flex: none;
  box-shadow: 0 0 8px rgba(232,184,75,.45); }
.menu .body { padding: 8px 10px 2px; font-size: 12px; font-weight: 500; color: #B4BECE; line-height: 1.45; }
`;

export function mountConnect(target: HTMLElement, opts: ConnectChipOptions = {}): ConnectChipHandle {
  const installUrl = opts.installUrl ?? "https://thelastprompt.ai/switchboard/";
  const host = document.createElement("div");
  host.style.display = "inline-block";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style"); style.textContent = STYLE; root.append(style);
  const mount = document.createElement("div"); root.append(mount);
  target.append(host);

  let state: State = { kind: "booting" };
  let menuOpen = false;
  let destroyed = false;
  let relay: Relay | null = null;
  let seq = 0; // guards against out-of-order async renders
  let wasConnected = false; // so onConnect/onDisconnect fire on real transitions, incl. auto-reconnect on load
  let lastProjectKey: string | null | undefined; // undefined = never observed; detects panel-side switches
  // "Disconnect this app" is a SOFT, per-session disconnect (like MetaMask disconnecting a site): the
  // grant persists (full revoke is panel-only), so we forget locally and reconnect silently on demand.
  let sessionDisconnected = false;

  const onDocClick = (e: Event) => { if (menuOpen && !host.contains(e.target as Node)) { menuOpen = false; render(); } };
  document.addEventListener("click", onDocClick);

  // Late-binding provider watch. A cold extension service worker can re-auth its daemon socket and
  // inject window.claude several seconds AFTER our initial whenRelayReady() probe has already timed
  // out to "not-installed" (~6s cold vs a 2.5s probe). Without this, the chip stays on "Get
  // Switchboard" and — because the app wires its model transport off this chip's onConnect — the AI
  // silently doesn't work until the user manually refreshes (by which point the worker is warm). We
  // keep a one-shot listener for the provider's `initialized` event so a late arrival auto-upgrades
  // the chip (and fires onConnect → the app wires up) with no refresh. Genuinely-not-installed
  // visitors never fire it, so they still see "Get Switchboard" immediately — no spinner regression.
  const initEvent = `${PROVIDER_GLOBAL}#initialized`;
  let lateWatching = false;
  const onLateInit = () => { lateWatching = false; window.removeEventListener(initEvent, onLateInit); if (!destroyed) void refresh(); };
  function watchForLateProvider() {
    if (lateWatching || destroyed) return;
    lateWatching = true;
    window.addEventListener(initEvent, onLateInit);
  }

  function el(tag: string, cls?: string, text?: string) {
    const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n;
  }

  async function refresh() {
    const my = ++seq;
    const r = await whenRelayReady(2500, { installUrl });
    if (destroyed || my !== seq) return;
    if (!(r instanceof Relay)) { watchForLateProvider(); state = { kind: "not-installed", installUrl }; return render(); }
    relay = r;
    subscribe(r);
    // The setup ladder first — answered by the EXTENSION from its own state (<1s, daemon-free), so
    // a sleeping daemon renders as a calm pill instead of a hung permissions() probe. h === null
    // means the extension is too old to know claude_health (or its worker didn't answer): fall
    // through to the permissions() path exactly as today — that skew guard is load-bearing while
    // store users run an older extension against newer wrapp bundles.
    const h = await r.health();
    if (destroyed || my !== seq) return;
    if (h && !h.reachable) { state = { kind: "unreachable" }; emitTransition(false); return render(); }
    if (h && !h.paired) { state = { kind: "unpaired" }; emitTransition(false); return render(); }
    const grant = sessionDisconnected ? null : await r.permissions().catch(() => null);
    if (destroyed || my !== seq) return;
    if (!grant) { state = { kind: "disconnected", relay: r }; emitTransition(false); return render(); }
    const wantsContext = opts.context !== "none";
    const [user, project] = await Promise.all([
      r.identity(),
      wantsContext ? r.context.active().catch(() => null) : Promise.resolve(null),
    ]);
    if (destroyed || my !== seq) return;
    const wasAlreadyConnected = wasConnected;
    state = { kind: "connected", relay: r, user, project };
    emitTransition(true);
    // Honor the documented contract: onProjectChange fires however the lent project changed — the
    // chip's own switcher, the side panel, or another tab (all funnel through permissionsChanged →
    // refresh). Skipped on the connect transition itself: apps load their project in onConnect.
    const projKey = project ? (project.id ?? project.name) : null;
    if (wasAlreadyConnected && lastProjectKey !== undefined && projKey !== lastProjectKey) opts.onProjectChange?.(project);
    lastProjectKey = projKey;
    render();
  }

  /** Fire onConnect/onDisconnect only when connection state actually flips — so a returning user
   *  whose grant persists gets onConnect on load, and the app isn't re-initialized on every refresh. */
  function emitTransition(connected: boolean) {
    if (connected === wasConnected) return;
    wasConnected = connected;
    if (connected && relay) opts.onConnect?.(relay);
    else if (!connected) opts.onDisconnect?.();
  }

  let subscribed = false;
  function subscribe(r: Relay) {
    if (subscribed) return; subscribed = true;
    // The panel (or another tab) can change the lent project or revoke — reflect it live.
    r.on("permissionsChanged", () => { void refresh(); });
    r.on("disconnect", () => { void refresh(); });
    // The setup ladder moved (daemon woke or slept, pairing landed) — upgrade AND downgrade live,
    // the same late-binding pattern as the provider watch, now for the whole ladder. This is the
    // real recovery mechanism; the pills' Retry button is a courtesy.
    r.on("health", () => { void refresh(); });
  }

  async function doConnect() {
    if (!relay) return;
    try {
      sessionDisconnected = false; // clear a prior soft disconnect so the grant is honored again
      await relay.connect(opts.scope);
      await refresh(); // emitTransition() fires onConnect once we confirm the grant
    } catch (e) {
      // A fast 4900 means the ladder moved beneath us (sidekick asleep / unpaired): re-read it so
      // the chip lands on the right rung instead of a silently dead Connect click. A user
      // rejection (4001) leaves the Connect button in place, as today.
      if ((e as { code?: number } | null)?.code === BYOPErrorCode.PROVIDER_UNAVAILABLE) void refresh();
    }
  }

  async function doPick() {
    if (!relay) return;
    menuOpen = false; render();
    // No explicit onProjectChange here: refresh() observes the new active() selection and fires it
    // once — which also stops a cancelled picker from firing a spurious onProjectChange(null).
    await relay.context.pick().catch(() => null);
    await refresh();
  }

  async function doDisconnect() {
    if (!relay) return;
    menuOpen = false;
    sessionDisconnected = true;
    await relay.disconnect().catch(() => {});
    await refresh(); // refresh treats sessionDisconnected as no-grant → emitTransition fires onDisconnect
  }

  function render() {
    if (destroyed) return;
    mount.textContent = "";

    if (state.kind === "booting") return; // nothing until we know — avoids a flash of the wrong state

    if (state.kind === "not-installed") {
      const url = state.installUrl;
      const wrap = el("div", "wrap");
      const b = el("button", "btn get");
      b.append(el("span", "glyph"), el("span", undefined, "Get Switchboard"), el("span", "arr", "↗"));
      b.onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; render(); };
      wrap.append(b);
      if (menuOpen) {
        const menu = el("div", "menu");
        const store = el("button", "item", "Add to Chrome ↗");
        store.onclick = () => { menuOpen = false; render(); window.open(CHROME_STORE_URL, "_blank", "noopener"); };
        const guide = el("button", "item", "Full setup guide ↗");
        guide.onclick = () => { menuOpen = false; render(); window.open(url, "_blank", "noopener"); };
        menu.append(store, guide);
        wrap.append(menu);
      }
      mount.append(wrap);
      return;
    }

    // Sidekick asleep: the daemon's socket can't be opened (never installed, or not running — the
    // browser can't tell them apart). Amber, not red: nothing is broken, one action wakes it, and
    // the health push auto-upgrades the chip the moment the daemon answers.
    if (state.kind === "unreachable") {
      const wrap = el("div", "wrap");
      const b = el("button", "btn get");
      b.append(el("span", "glyph"), el("span", undefined, "Your sidekick is asleep"), el("span", "dot"), el("span", "caret", "▾"));
      b.onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; render(); };
      wrap.append(b);
      if (menuOpen) {
        const menu = el("div", "menu");
        menu.append(el("div", "body", "Open the Relay menubar app to wake it."));
        const retry = el("button", "item", "Retry");
        retry.onclick = () => { menuOpen = false; render(); void refresh(); };
        menu.append(retry, el("div", "sep"));
        const setup = el("button", "item", "New here? Full setup ↗");
        setup.onclick = () => { menuOpen = false; render(); window.open(installUrl, "_blank", "noopener"); };
        menu.append(setup);
        wrap.append(menu);
      }
      mount.append(wrap);
      return;
    }

    // Daemon reachable but no accepted pairing: the glyph lights up (something IS listening), and
    // the one next action is pairing in the toolbar panel. Auto-upgrades on the pair-success push.
    if (state.kind === "unpaired") {
      const wrap = el("div", "wrap");
      const b = el("button", "btn connect");
      b.append(el("span", "glyph"), el("span", undefined, "Almost there — pair in the side panel"), el("span", "caret", "▾"));
      b.onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; render(); };
      wrap.append(b);
      if (menuOpen) {
        const menu = el("div", "menu");
        menu.append(el("div", "body", "Click the Switchboard icon in your Chrome toolbar and paste your pairing token."));
        const retry = el("button", "item", "Retry");
        retry.onclick = () => { menuOpen = false; render(); void refresh(); };
        menu.append(retry);
        wrap.append(menu);
      }
      mount.append(wrap);
      return;
    }

    if (state.kind === "disconnected") {
      const b = el("button", "btn connect");
      b.append(el("span", "glyph"), el("span", undefined, "Connect Switchboard"));
      b.onclick = doConnect;
      mount.append(b);
      return;
    }

    // connected
    const { user, project } = state;
    // Defensive: the greeting is the PERSON, never a context. If identity is missing and would
    // collide with the lent context's name, fall back to a neutral greeting rather than greeting
    // the user by their project ("Hi Aamras").
    const rawName = user?.name?.trim();
    const collides = !!rawName && !!project?.name && rawName.toLowerCase() === project.name.toLowerCase();
    const name = (!rawName || collides) ? "there" : rawName;
    const wrap = el("div", "wrap");
    const chip = el("button", "chip");
    const av = el("div", "av");
    if (user?.avatar) { const img = el("img") as HTMLImageElement; img.src = user.avatar; img.alt = name; av.append(img); }
    else av.textContent = name.charAt(0).toUpperCase();
    const wantsContext = opts.context !== "none";
    const who = el("div", "who");
    who.append(el("div", "hi", `Hi ${name}`));
    // The lent context by name only — no brand colours in Switchboard's chrome; a context's palette
    // is meaningful inside the app that uses it, not as decoration on the chip. Apps with no use
    // for a lent context (context: "none") get an identity-only second line instead — a "selected
    // project" is not a universal concept, and pretending it is confuses producers and toys alike.
    who.append(el("div", "proj", wantsContext ? (project ? project.name : "No context lent") : "Connected"));
    chip.append(av, who, el("span", "caret", "▾"));
    chip.onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; render(); };
    wrap.append(chip);

    if (menuOpen) {
      const menu = el("div", "menu");
      if (wantsContext) {
        menu.append(el("div", "lbl", "Working on"));
        const row = el("button", "proj-row");
        row.append(el("span", undefined, project ? project.name : "Choose a context"));
        row.append(el("span", "go", project ? "Switch ▸" : "Choose ▸"));
        row.onclick = doPick;
        menu.append(row, el("div", "sep"));
      }
      const dc = el("button", "item", "Disconnect this app"); dc.onclick = doDisconnect;
      menu.append(dc);
      menu.append(el("div", "foot", "Connectors, budgets & activity live in the Switchboard toolbar panel."));
      wrap.append(menu);
    }
    mount.append(wrap);
  }

  render();
  void refresh();

  return {
    refresh: () => void refresh(),
    destroy: () => {
      destroyed = true;
      document.removeEventListener("click", onDocClick);
      window.removeEventListener(initEvent, onLateInit);
      host.remove();
    },
  };
}
