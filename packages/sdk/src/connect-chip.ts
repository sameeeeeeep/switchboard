import type { Context, ScopeRequest, UserIdentity } from "@relay/protocol";
import { Relay, whenRelayReady } from "./index.js";

/**
 * mountConnect — the ONE standard header affordance every wrapp drops in, so connecting feels the
 * same everywhere and the app becomes "yours" the moment you connect. It is the MetaMask account
 * button for Switchboard:
 *
 *   • not installed        → "Get Switchboard"     (opens the install page)
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
  | { kind: "disconnected"; relay: Relay }
  | { kind: "connected"; relay: Relay; user: UserIdentity | null; project: Context | null };

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
  // "Disconnect this app" is a SOFT, per-session disconnect (like MetaMask disconnecting a site): the
  // grant persists (full revoke is panel-only), so we forget locally and reconnect silently on demand.
  let sessionDisconnected = false;

  const onDocClick = (e: Event) => { if (menuOpen && !host.contains(e.target as Node)) { menuOpen = false; render(); } };
  document.addEventListener("click", onDocClick);

  function el(tag: string, cls?: string, text?: string) {
    const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n;
  }

  async function refresh() {
    const my = ++seq;
    const r = await whenRelayReady(2500, { installUrl });
    if (destroyed || my !== seq) return;
    if (!(r instanceof Relay)) { state = { kind: "not-installed", installUrl }; return render(); }
    relay = r;
    subscribe(r);
    const grant = sessionDisconnected ? null : await r.permissions().catch(() => null);
    if (destroyed || my !== seq) return;
    if (!grant) { state = { kind: "disconnected", relay: r }; emitTransition(false); return render(); }
    const [user, project] = await Promise.all([r.identity(), r.context.active().catch(() => null)]);
    if (destroyed || my !== seq) return;
    state = { kind: "connected", relay: r, user, project };
    emitTransition(true);
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
  }

  async function doConnect() {
    if (!relay) return;
    try {
      sessionDisconnected = false; // clear a prior soft disconnect so the grant is honored again
      await relay.connect(opts.scope);
      await refresh(); // emitTransition() fires onConnect once we confirm the grant
    } catch { /* user rejected or unreachable — leave the Connect button in place */ }
  }

  async function doPick() {
    if (!relay) return;
    menuOpen = false; render();
    const project = await relay.context.pick().catch(() => null);
    opts.onProjectChange?.(project);
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
      const b = el("button", "btn get");
      b.append(el("span", "glyph"), el("span", undefined, "Get Switchboard"), el("span", "arr", "↗"));
      b.onclick = () => window.open(state.kind === "not-installed" ? state.installUrl : installUrl, "_blank", "noopener");
      mount.append(b);
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
    const who = el("div", "who");
    who.append(el("div", "hi", `Hi ${name}`));
    // The lent context by name only — no brand colours in Switchboard's chrome; a context's palette
    // is meaningful inside the app that uses it, not as decoration on the chip.
    who.append(el("div", "proj", project ? project.name : "No context lent"));
    chip.append(av, who, el("span", "caret", "▾"));
    chip.onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; render(); };
    wrap.append(chip);

    if (menuOpen) {
      const menu = el("div", "menu");
      menu.append(el("div", "lbl", "Working on"));
      const row = el("button", "proj-row");
      row.append(el("span", undefined, project ? project.name : "Choose a context"));
      row.append(el("span", "go", project ? "Switch ▸" : "Choose ▸"));
      row.onclick = doPick;
      menu.append(row, el("div", "sep"));
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
      host.remove();
    },
  };
}
