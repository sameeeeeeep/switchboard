import { WRAPPS, hostMatch, type Wrapp } from "./wrapps.js";

/**
 * The in-page WIDGET — Switchboard's floating surface, injected into the page so it can't be buried
 * (like a detached window) and never shrinks layout (position:fixed). It is the "float instead of the
 * sidebar" the user wanted. Two faces:
 *   • On a WRAPP site (where you actually work): a live status card — connected? what's lent? today's
 *     compute — plus "Manage" which opens the panel for the sensitive controls.
 *   • On a COMPETITOR site (one a wrapp stands in for): "do this on your own Claude" with wrapp links.
 * Both are the same shell (minimise → pill; × → hide here), rendered in a CLOSED shadow root.
 *
 * SECURITY: this surface is DISPLAY + navigation only. No consent, trust-mode, lend, or disconnect
 * control ever lives here — those stay in trusted extension chrome (the side panel / the toast), so a
 * hostile page overlaying or spoofing this card can never escalate an app's access. The widget only
 * ever RECEIVES this origin's own connection info (which the page already earned by connecting).
 */

const HOST_ID = "relay-switchboard-widget";
const HIDE_KEY = (h: string) => `relayWidgetHidden:${h}`;
const COLLAPSED_KEY = "relayWidgetCollapsed";

interface WidgetState { paired: boolean; reachable: boolean; connected?: boolean; mode?: string | null; lentName?: string | null; tokensToday?: number }

const GLYPH = `<span style="width:16px;height:16px;border-radius:5px;background:#C8F250;box-shadow:0 0 12px rgba(200,242,80,.45);display:inline-block;position:relative;flex:none">
  <span style="position:absolute;inset:5px 5px auto auto;width:4px;height:4px;border-radius:50%;background:#0A0C10"></span></span>`;

function css(): string {
  return `
    :host { all: initial; }
    .card, .pill { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      font: 13px/1.45 -apple-system, "Segoe UI", Roboto, system-ui, sans-serif; color: #E8EDF4; }
    .card { width: 296px; background: #12151B; border: 1px solid #262C38; border-radius: 16px;
      box-shadow: 0 20px 48px -18px rgba(0,0,0,.72); overflow: hidden; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 12px 13px; border-bottom: 1px solid #1c2028; }
    .hd .nm { font-weight: 700; font-size: 13px; letter-spacing: -.01em; }
    .hd .sp { margin-left: auto; display: flex; gap: 2px; }
    .hd button { width: 24px; height: 24px; border: 0; background: transparent; color: #99A3B7; border-radius: 7px;
      cursor: pointer; font-size: 15px; line-height: 1; display: grid; place-items: center; }
    .hd button:hover { background: #1c2028; color: #E8EDF4; }
    .bd { padding: 12px 13px 13px; }
    .bd .lead { color: #99A3B7; font-size: 12px; margin: 0 0 10px; }
    .bd .lead b { color: #E8EDF4; font-weight: 600; }
    .alt { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; cursor: pointer;
      background: #171b22; border: 1px solid #262C38; border-radius: 11px; padding: 9px 10px; margin-top: 8px; color: inherit; }
    .alt:hover { border-color: #3a4250; }
    .alt .ic { width: 26px; height: 26px; border-radius: 7px; flex: none; display: grid; place-items: center;
      font: 700 13px/1 system-ui, sans-serif; color: #0A0C10; }
    .alt .t { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .alt .t .n { font-weight: 600; font-size: 13px; }
    .alt .t .d { color: #99A3B7; font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .alt .go { color: #C8F250; font-weight: 600; font-size: 11.5px; white-space: nowrap; }
    .foot { color: #6E7C90; font-size: 10.5px; margin-top: 10px; text-align: center; }
    /* status face */
    .stat { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
    .stat .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .rows { margin-top: 11px; display: flex; flex-direction: column; gap: 8px; }
    .kv { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; }
    .kv .k { color: #99A3B7; }
    .kv .v { color: #E8EDF4; font-weight: 600; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .manage { width: 100%; margin-top: 13px; background: #C8F250; color: #0A0C10; border: 0; border-radius: 10px;
      padding: 10px; font: 700 12.5px/1 -apple-system, system-ui, sans-serif; cursor: pointer; }
    .manage.ghost { background: transparent; color: #C8F250; border: 1px solid #2b3342; }
    /* pill */
    .pill { display: flex; align-items: center; gap: 8px; background: #12151B; border: 1px solid #262C38;
      border-radius: 999px; padding: 9px 13px 9px 11px; box-shadow: 0 12px 30px -14px rgba(0,0,0,.7); cursor: pointer; }
    .pill .nm { font-weight: 600; font-size: 12.5px; }
    .pill .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .pill .ct { font-size: 10px; color: #0A0C10; background: #C8F250; border-radius: 999px; padding: 1px 6px; font-weight: 700; }
  `;
}

const send = (m: unknown) => { try { return chrome.runtime.sendMessage(m); } catch { return Promise.resolve(undefined); } };
function openWrapp(url: string) { void send({ type: "openUrl", url }); }
function setCollapsed(v: boolean) { void chrome.storage.local.set({ [COLLAPSED_KEY]: v }); }

type View = { kind: "alts"; alts: Wrapp[] } | { kind: "status"; state: WidgetState };

function headerEl(): HTMLElement {
  const hd = document.createElement("div");
  hd.className = "hd";
  hd.innerHTML = `${GLYPH}<span class="nm">Switchboard</span>
    <span class="sp"><button title="Minimise" data-a="min">–</button><button title="Hide on this site" data-a="hide">×</button></span>`;
  return hd;
}

function render(root: ShadowRoot, view: View, host: string, collapsed: boolean) {
  root.innerHTML = `<style>${css()}</style>`;
  const rerender = (c: boolean) => { setCollapsed(c); render(root, view, host, c); };
  const connected = view.kind === "status" && !!view.state.connected;
  // Mini ladder colours: asleep is AMBER (nothing is broken), everything else keeps its meaning.
  const asleep = view.kind === "status" && view.state.paired && !view.state.reachable;
  const dotColor = view.kind === "alts" ? "#6E7C90" : asleep ? "#F2B450" : connected ? "#3DD68C" : "#C8F250";

  if (collapsed) {
    const pill = document.createElement("div");
    pill.className = "pill";
    const badge = view.kind === "alts" ? `<span class="ct">${view.alts.length}</span>` : `<span class="dot" style="background:${dotColor}"></span>`;
    pill.innerHTML = `${GLYPH}<span class="nm">Switchboard</span>${badge}`;
    pill.onclick = () => rerender(false);
    root.appendChild(pill);
    return;
  }

  const card = document.createElement("div");
  card.className = "card";
  const hd = headerEl();
  card.appendChild(hd);
  const bd = document.createElement("div");
  bd.className = "bd";

  if (view.kind === "alts") {
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.innerHTML = `You're on <b class="h"></b>. Do the same thing on <b>your own Claude</b>, free:`;
    (lead.querySelector(".h") as HTMLElement).textContent = host.replace(/^www\./, "");
    bd.appendChild(lead);
    for (const w of view.alts.slice(0, 3)) {
      const a = document.createElement("button");
      a.className = "alt";
      a.innerHTML = `<span class="ic" style="background:${w.color}">${w.name[0]!.toUpperCase()}</span>
        <span class="t"><span class="n"></span><span class="d"></span></span><span class="go">Open →</span>`;
      (a.querySelector(".n") as HTMLElement).textContent = w.name;
      (a.querySelector(".d") as HTMLElement).textContent = w.desc;
      a.onclick = () => openWrapp(w.url);
      bd.appendChild(a);
    }
    const foot = document.createElement("div");
    foot.className = "foot";
    foot.textContent = "Your compute · your context · your data";
    bd.appendChild(foot);
  } else {
    const s = view.state;
    // The status face's mini ladder. "Switchboard ready" is only ever said where it's TRUE
    // (paired + reachable); the degraded rungs each name their one next action, and every
    // button below is openPanel — no dead CTAs.
    const unpaired = s.reachable && !s.paired;
    const stat = document.createElement("div");
    stat.className = "stat";
    stat.innerHTML = `<span class="dot" style="background:${dotColor}"></span><span></span>`;
    (stat.querySelector("span:last-child") as HTMLElement).textContent =
      asleep ? "Sidekick asleep — open the Relay app"
      : unpaired ? "Almost there — pair Switchboard"
      : connected ? "Connected — running on your Claude" : "Switchboard ready — connect on this page";
    bd.appendChild(stat);

    if (connected) {
      const rows = document.createElement("div");
      rows.className = "rows";
      const kv = (k: string, v: string) => {
        const r = document.createElement("div"); r.className = "kv";
        const kk = document.createElement("span"); kk.className = "k"; kk.textContent = k;
        const vv = document.createElement("span"); vv.className = "v"; vv.textContent = v;
        r.append(kk, vv); return r;
      };
      rows.appendChild(kv("Working on", s.lentName || "—"));
      rows.appendChild(kv("Compute today", kfmt(s.tokensToday ?? 0)));
      if (s.mode) rows.appendChild(kv("Mode", s.mode));
      bd.appendChild(rows);
    }

    const manage = document.createElement("button");
    manage.className = "manage" + (connected ? "" : " ghost");
    manage.textContent = connected ? "Manage in Switchboard" : "Open Switchboard";
    manage.onclick = () => void send({ type: "openPanel" });
    bd.appendChild(manage);
  }

  card.appendChild(bd);
  root.appendChild(card);
  (hd.querySelector('[data-a="min"]') as HTMLButtonElement).onclick = () => rerender(true);
  (hd.querySelector('[data-a="hide"]') as HTMLButtonElement).onclick = () => {
    void chrome.storage.local.set({ [HIDE_KEY(host)]: true });
    document.getElementById(HOST_ID)?.remove();
  };
}

const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

async function main() {
  if (window.top !== window) return;              // top frame only — no widget inside embedded iframes
  if (document.getElementById(HOST_ID)) return;   // already mounted (SPA re-inject guard)
  const host = location.hostname;
  const alts = WRAPPS.filter((w) => (w.alternativeTo ?? []).some((d) => hostMatch(host, d)));

  let view: View;
  if (alts.length) {
    view = { kind: "alts", alts };              // a competitor site → the "use a wrapp instead" pitch
  } else {
    // A wrapp / work site → the live status card, but the widget never nags on a fresh install:
    // not paired AND not reachable (nothing set up at all) stays absent — the chip owns first-run.
    // Paired-but-asleep and reachable-but-unpaired DO show: the user has started setup, so the
    // widget's one next action helps rather than nags.
    const state = (await send({ type: "widgetState" })) as WidgetState | undefined;
    if (!state || (!state.paired && !state.reachable)) return;
    view = { kind: "status", state };
  }

  const store = await chrome.storage.local.get([HIDE_KEY(host), COLLAPSED_KEY]);
  if (store[HIDE_KEY(host)]) return;              // user hid it here

  const mountEl = document.createElement("div");
  mountEl.id = HOST_ID;
  const root = mountEl.attachShadow({ mode: "closed" });
  (document.documentElement || document.body).appendChild(mountEl);
  render(root, view, host, !!store[COLLAPSED_KEY]);
}

void main();
