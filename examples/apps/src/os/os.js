// Switchboard OS — the single-window shell.
// One window, one persistent rail, a hash router that swaps the #pane.
// Home is fully rendered; the other 12 surfaces are correct skeletons ("· building").
// All data is the inline DATA object below — later this is swapped for real Bank reads.

// ---- surface modules (each: render(DATA) -> pane HTML, css string, wire(root)) ----
import * as S_tasks from "./surfaces/tasks.js";
import * as S_calendar from "./surfaces/calendar.js";
import * as S_dashboard from "./surfaces/dashboard.js";
import * as S_attention from "./surfaces/attention.js";
import * as S_bank from "./surfaces/bank.js";
import * as S_history from "./surfaces/history.js";
import * as S_graph from "./surfaces/graph.js";
import * as S_dictionary from "./surfaces/dictionary.js";
import * as S_routines from "./surfaces/routines.js";
import * as S_workflows from "./surfaces/workflows.js";
import * as S_apps from "./surfaces/apps.js";
import * as S_store from "./surfaces/store.js";
import { appIcon, pageFor } from "./icons.js";
const SURFACES = { tasks: S_tasks, calendar: S_calendar, dashboard: S_dashboard, needs: S_attention, attention: S_attention, bank: S_bank, history: S_history, graph: S_graph, dictionary: S_dictionary, routines: S_routines, workflows: S_workflows, apps: S_apps, store: S_store };
const _cssDone = {};
function ensureSurfaceCss(id, mod) {
  if (_cssDone[id] || !mod || !mod.css) return;
  _cssDone[id] = 1;
  const st = document.createElement("style");
  st.textContent = String(mod.css).replace(/^\s*<style[^>]*>/i, "").replace(/<\/style>\s*$/i, "");
  document.head.appendChild(st);
}

// ---------------------------------------------------------------------------
// deterministic per-app color: hash an id -> a stable, distinct, vibrant hue.
// Same id always yields the same hue; different ids spread across the wheel.
// ---------------------------------------------------------------------------
function hueForId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360; // 0..359
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (n) => Math.round(255 * f(n)).toString(16).padStart(2, "0");
  return "#" + to(0) + to(8) + to(4);
}
// a wrapp's hex is a pure function of its id — vibrant, mid-light for the iso faces
function hexForId(id) { return hslToHex(hueForId(id), 68, 58); }

// ---------------------------------------------------------------------------
// vibrant isometric app tile (ported from os-home.html isoTile)
// ---------------------------------------------------------------------------
const S = 6.2, K = 0.866 * S, HH = 0.5 * S;
function isoTile(hue, cx, cy) {
  function P(x, y, z) { return (cx + (x - y) * K).toFixed(1) + "," + (cy + (x + y) * HH - z * S).toFixed(1); }
  function poly(pts, f) { return '<polygon points="' + pts.map((p) => P(p[0], p[1], p[2])).join(" ") + '" fill="' + f + '"/>'; }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return "#" + ((1 << 24) + ((Math.round(r * amt)) << 16) + ((Math.round(g * amt)) << 8) + Math.round(b * amt)).toString(16).slice(1);
  }
  const T = hue, L = shade(hue, 0.66), R = shade(hue, 0.5);
  function box(ox, oy, oz, s, h) {
    const x0 = ox, x1 = ox + s, y0 = oy, y1 = oy + s, z0 = oz, z1 = oz + h;
    return poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], R)
      + poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], L)
      + poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], T);
  }
  return box(-2.2, -2.2, 0, 4.4, 1.4) + box(-1.2, -1.2, 1.4, 2.4, 2.4);
}
function tileSvg(hue, px) { const s = px || 46; return '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" xmlns="http://www.w3.org/2000/svg">' + isoTile(hue, 32, 40) + "</svg>"; }
function chip(hue, size) { return '<span style="display:inline-block;width:' + size + "px;height:" + size + "px;border-radius:5px;background:" + hue + '"></span>'; }
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ---------------------------------------------------------------------------
// SAMPLE DATA — read by the surfaces. Swap for real Bank reads later.
// (matches os-home.html: IndEur Club + the cross-app artifacts.)
// ---------------------------------------------------------------------------
const DATA = {
  // Many projects — the home is a command centre across all of them (real names from ~/.relay/contexts.json;
  // the native OS reads these live, this web mirror carries them so the design is grounded, not fictional).
  projects: [
    { id: "a-new",       name: "a new",        kind: "brand",   essence: "gen-z incense · indian maximalism, hip", pending: 2, active: 1, updated: "20m" },
    { id: "sela",        name: "Sela",         kind: "brand",   essence: "premium men's skincare · tier-2 south india", pending: 1, updated: "1h" },
    { id: "ramyunion",   name: "Ramyunion",    kind: "brand",   essence: "instant ramen · 3 products", pending: 0, updated: "3h" },
    { id: "piqual",      name: "Piqual",       kind: "brand",   essence: "3 products in flight", pending: 1, updated: "yst" },
    { id: "aamras",      name: "Aamras",       kind: "brand",   essence: "3 products in flight", pending: 0, updated: "yst" },
    { id: "haazma",      name: "Haazma",       kind: "brand",   essence: "3 products in flight", pending: 0, updated: "2d" },
    { id: "clawd",       name: "Clawd",        kind: "brand",   essence: "3 products in flight", pending: 0, updated: "2d" },
    { id: "nailinit",    name: "Nailinit",     kind: "brand",   essence: "brand system", pending: 3, updated: "4h" },
    { id: "switchboard", name: "Switchboard",  kind: "project", essence: "the AI you come back to", pending: 1, updated: "12m" },
    { id: "relay",       name: "Relay",        kind: "project", essence: "broker + daemon", pending: 0, updated: "1d" },
    { id: "sb-lp",       name: "switchboard-lp",kind: "project",essence: "landing", pending: 0, updated: "3d" },
    { id: "catsdogs",    name: "Cats & dogs of Mumbai", kind: "idea", essence: "a map · geodata", pending: 0, updated: "5d" },
  ],
  project: {
    id: "a-new", name: "a new", kind: "brand", essence: "gen-z incense · indian maximalism, hip",
    facets: ["brand", "incense sticks", "voice: quirky, unbothered", "updated 20m ago"],
  },
  apps: [
    { id: "brandbrain", live: 1 }, { id: "Crest", live: 1 }, { id: "Flow", live: 1 },
    { id: "God", live: 1 }, { id: "AdForge" }, { id: "ideabrain" },
    { id: "Prism" }, { id: "Bank" }, { id: "Redline" }, { id: "AdPulse" },
  ],
  work: [
    { t: "Switch Ligature monogram", src: "Crest", time: "20m", kind: "mark" },
    { t: "IndEur — 4 marks", src: "Crest", time: "22m", kind: "gallery" },
    { t: 'Launch ad — "Find your people"', src: "AdForge", time: "1h", kind: "ad" },
    { t: "Community meetup — notes", src: "Flow", time: "3h", kind: "text" },
    { t: "Terracotta beam render", src: "Prism", time: "yesterday", kind: "image" },
    { t: "IndEur thesis + reach-outs", src: "ideabrain", time: "yesterday", kind: "doc" },
  ],
  next: [
    { kind: "suggest", title: "Render your IndEur mark", body: "you kept 2 wireframes in Crest. Turn one into an image.", app: "Prism" },
    { kind: "suggest", title: "Draft the launch post", body: "brandbrain has your voice; write the IndEur announce.", app: "brandbrain" },
    { kind: "task", title: "Finalize Q4 palette", body: "@brandbrain · due Fri", route: "tasks" },
  ],
  needs: [
    { title: "Approve AdForge send to 3 launch emails", act: "Review" },
    { title: "Grant sb_http for Establish IndEur site", act: "Grant" },
  ],
};

// ---------------------------------------------------------------------------
// RAIL model — 4 groups. Store is a rail item that opens the existing store.
// ---------------------------------------------------------------------------
const RAIL = [
  { group: "Workspace", items: [
    { id: "home", label: "Home", icon: "⌂" },
    { id: "tasks", label: "Tasks", icon: "✓", badge: "6" },
    { id: "calendar", label: "Calendar", icon: "▦" },
    { id: "bank", label: "Bank", icon: "▤", badge: "brain" },
  ] },
  { group: "Knowledge", items: [
    { id: "history", label: "History", icon: "⟲" },
    { id: "graph", label: "Graph", icon: "⊹" },
    { id: "dictionary", label: "Dictionary", icon: "Aa" },
  ] },
  { group: "Automate", items: [
    { id: "dashboard", label: "Dashboard", icon: "▚" },
    { id: "needs", label: "Needs attention", icon: "!", badge: "attn" }, // live count
    { id: "routines", label: "Routines", icon: "⟳" },
    { id: "workflows", label: "Workflows", icon: "⇉" },
  ] },
  { group: "Do", items: [
    { id: "apps", label: "Apps", icon: "▥" },
    { id: "store", label: "Store", icon: "+", external: "./index.html" },
  ] },
];

// ---------------------------------------------------------------------------
// STUB surfaces — title + correct section kickers (from OS.md §3) + "· building".
// mode drives the skeleton shape so each surface reads as its real self.
// ---------------------------------------------------------------------------
const STUBS = {
  tasks:      { title: "Tasks",      lede: "See and move everything you've committed to, across every project and wrapp, in one board.", mode: "columns", kickers: ["Todo · 4", "Doing · 2", "Blocked · 1", "Done · 12"] },
  calendar:   { title: "Calendar",   lede: "Your tasks, milestones, and history on one timeline — the shape of your week.", mode: "chips", kickers: ["Month", "Week", "Agenda"] },
  bank:       { title: "Bank",       lede: "Where a project is established, shown, browsed and edited — the model behind every other lens.", mode: "chips", kickers: ["Projects", "Overview", "Tasks", "Brain", "Artifacts"] },
  history:    { title: "History",    lede: "Find and reopen anything you did — every God / wrapp run as a receipt.", mode: "rows", kickers: ["Today", "Yesterday", "Earlier"] },
  graph:      { title: "Graph",      lede: "How everything connects — projects, notes, artifacts, terms, runs — navigate by relationship.", mode: "columns", kickers: ["Projects", "Notes", "Artifacts", "Terms"] },
  dictionary: { title: "Dictionary", lede: "What your words mean — the project vocabulary every surface and wrapp speaks.", mode: "rows", kickers: ["A – F", "G – M", "N – Z"] },
  dashboard:  { title: "Dashboard",  lede: "The status and health of everything, at a glance — is it all okay?", mode: "tiles", kickers: ["Projects", "Routines", "Workflows", "Usage", "Needs attention"] },
  needs:      { title: "Needs attention", lede: "Everything waiting on you, with the one action for each.", mode: "needs", kickers: ["Approvals", "Failed", "Waiting"] },
  routines:   { title: "Routines",   lede: "Manage and monitor the things that run without you.", mode: "rows", kickers: ["Active", "Paused", "Next fire"] },
  workflows:  { title: "Workflows",  lede: "Run and manage your multi-step pipelines — the reusable batch recipes.", mode: "rows", kickers: ["Recipes", "Recent runs"] },
  apps:       { title: "Apps",       lede: "Launch, manage and understand the tools you have.", mode: "dock", kickers: ["Pinned", "All apps"] },
};

// ---------------------------------------------------------------------------
// RENDERERS
// ---------------------------------------------------------------------------
function renderRail(active) {
  const rail = document.getElementById("rail");
  let html = '<div class="logo"><span class="dot"></span>Switchboard</div>';
  for (const g of RAIL) {
    html += '<div class="grp">' + g.group + "</div>";
    for (const it of g.items) {
      let ct = "";
      if (it.badge === "attn") { const n = DATA.needs.length; if (n) ct = '<span class="ct hot">' + n + "</span>"; }
      else if (it.badge) ct = '<span class="ct">' + esc(it.badge) + "</span>";
      const href = it.external ? it.external : "#/" + it.id;
      html += '<a href="' + href + '"' + (it.external ? "" : ' data-route="' + it.id + '"')
        + (active === it.id ? ' class="on"' : "") + '><span class="i">' + it.icon + "</span>" + it.label + ct + "</a>";
    }
  }
  rail.innerHTML = html;
}

function thumb(w) {
  const h = hexForId(w.src);
  if (w.kind === "mark") return '<div style="width:56px;height:56px;border-radius:12px;background:linear-gradient(150deg,' + h + ',#0d0e13);display:grid;place-items:center"><div style="width:24px;height:24px;border-radius:7px;background:rgba(255,255,255,.92);display:grid;place-items:center"><div style="width:10px;height:10px;border-radius:3px;background:' + h + '"></div></div></div>';
  if (w.kind === "image") return '<div style="width:78px;height:56px;border-radius:10px;background:linear-gradient(180deg,' + h + ',#151720 60%,#0d0e13);position:relative;overflow:hidden"><span style="position:absolute;top:8px;right:14px;width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,.85)"></span></div>';
  if (w.kind === "gallery") return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">' + [0, 1, 2, 3].map(() => '<span style="width:22px;height:22px;border-radius:5px;background:' + h + ';opacity:.85"></span>').join("") + "</div>";
  if (w.kind === "ad") return '<div style="width:78px;height:56px;border-radius:8px;background:' + h + ';opacity:.9;display:flex;flex-direction:column;justify-content:flex-end;padding:6px"><span style="height:5px;width:70%;background:#fff;opacity:.85;border-radius:3px"></span><span style="height:4px;width:45%;background:#fff;opacity:.6;border-radius:3px;margin-top:4px"></span></div>';
  return '<div style="width:56px;height:60px;border-radius:6px;background:#0f1116;border:1px solid #23262f;padding:9px 8px">' + [80, 60, 90, 50, 70].map((w2) => '<div style="height:3px;width:' + w2 + "%;background:" + (w2 === 90 ? h : "#3a3f4b") + ';border-radius:2px;margin-bottom:5px"></div>').join("") + "</div>";
}

function projectCard(p, big) {
  const cls = big ? "pcard big" : "pcard";
  const pend = p.pending ? '<span class="pend">' + p.pending + " pending</span>" : "";
  return '<div class="' + cls + '" data-project="' + esc(p.id) + '" title="Open ' + esc(p.name) + '">'
    + '<div class="pmark">' + tileSvg(hexForId(p.id), big ? 44 : 34) + "</div>"
    + '<div class="pbody"><div class="pnm">' + esc(p.name) + (p.active ? '<span class="cur">active</span>' : "") + "</div>"
    + '<div class="pess">' + esc(p.essence || p.kind) + "</div>"
    + '<div class="pmeta"><span class="kd">' + esc(p.kind) + "</span>" + pend
    + (p.updated ? '<span class="upd">· ' + esc(p.updated) + "</span>" : "") + "</div></div></div>";
}

function renderHome() {
  const all = DATA.projects || [];
  const active = all.find((p) => p.active) || DATA.project;
  const totalPending = all.reduce((n, p) => n + (p.pending || 0), 0);
  let html = '<div class="hero"><h1>Evening, Sameep. <span class="sub">' + all.length + " projects · pick up anywhere.</span></h1></div>";

  // ① jump back in — the active/last project, prominent (resume)
  html += '<div class="sh"><span class="kick">Jump back in</span><span class="more" data-route="bank">all projects →</span></div>';
  html += '<div class="jump">' + projectCard(active, true) + "</div>";

  // ② every project — the command centre spans them all (click to switch)
  html += '<div class="sh"><span class="kick">Projects</span><span class="more" data-route="bank">manage →</span></div>';
  html += '<div class="pgrid">' + all.filter((p) => !p.active).map((p) => projectCard(p, false)).join("") + "</div>";

  // ③ needs-attention strip (across all projects)
  if (DATA.needs.length) {
    html += '<div class="attn"><div class="ah">! NEEDS ATTENTION<span class="ct">' + totalPending + " across your projects</span></div>"
      + DATA.needs.map((n) => '<div class="row">' + esc(n.title) + '<span class="do" data-route="needs">' + esc(n.act) + "</span></div>").join("")
      + "</div>";
  }

  // ④ recent work
  html += '<div class="sh"><span class="kick">Recent work</span><span class="more" data-route="bank">everything you\'ve made →</span></div><div class="work">';
  html += DATA.work.map((w) => '<div class="card" data-app="' + esc(w.src) + '" data-ctx="' + encodeURIComponent(JSON.stringify({ artifact: w.t, kind: w.kind, project: DATA.project.id })) + '" title="Open ' + esc(w.t) + ' in ' + esc(w.src) + '"><div class="thumb" style="background:linear-gradient(160deg,#101218,#0b0c11)">' + thumb(w) + "</div>"
    + '<div class="meta"><div class="t">' + esc(w.t) + '</div><div class="src">' + appIcon(w.src, 15) + esc(w.src) + '<span class="time">' + esc(w.time) + "</span></div></div></div>").join("");
  html += "</div>";

  // ③ app dock — one deterministic hue per id
  html += '<div class="sh"><span class="kick">Your apps</span><span class="more" data-route="apps">all apps →</span></div><div class="apps">';
  html += DATA.apps.map((a) => '<div class="app" data-app="' + esc(a.id) + '"><div class="tile">' + appIcon(a.id, 60) + (a.live ? '<span class="live"></span>' : "") + '</div><div class="nm">' + esc(a.id) + "</div></div>").join("");
  html += "</div>";

  // ④ what's next
  html += '<div class="sh"><span class="kick">What\'s next</span></div><div class="next">';
  html += DATA.next.map((n) => '<div class="nx ' + (n.kind === "task" ? "task" : "") + '"' + (n.app ? ' data-app="' + esc(n.app) + '"' : n.route ? ' data-route="' + esc(n.route) + '"' : "") + '><div class="g">' + (n.kind === "task" ? "☐" : "✦") + '</div><div class="tx"><b>' + esc(n.title) + "</b> — " + esc(n.body) + "</div></div>").join("");
  html += "</div>";
  return html;
}

function renderStub(id) {
  const s = STUBS[id];
  let body = "";
  if (s.mode === "columns" || s.mode === "graph") {
    body = '<div class="cols">' + s.kickers.map((k) => '<div class="col"><div class="ct">' + esc(k) + '</div><div class="ph"></div><div class="ph s"></div><div class="ph s"></div></div>').join("") + "</div>";
  } else if (s.mode === "chips") {
    body = '<div class="chips">' + s.kickers.map((k, i) => '<span class="chipk' + (i === 0 ? " on" : "") + '">' + esc(k) + "</span>").join("") + '</div><div class="cols" style="margin-top:18px"><div class="col"><div class="ph"></div><div class="ph s"></div><div class="ph s"></div></div></div>';
  } else if (s.mode === "tiles") {
    const nums = ["3", "2", "18", "1.2M", String(DATA.needs.length)];
    body = '<div class="tiles">' + s.kickers.map((k, i) => '<div class="tile2"><div class="k">' + esc(k) + '</div><div class="big">' + (nums[i] || "—") + '</div><div class="spark"></div></div>').join("") + "</div>";
  } else if (s.mode === "needs") {
    body = '<div class="rows">' + DATA.needs.map((n) => '<div class="rowk"><span class="dg"></span>' + esc(n.title) + '<span class="mono">' + esc(n.act) + "</span></div>").join("") + "</div>";
  } else if (s.mode === "dock") {
    body = '<div class="chips">' + s.kickers.map((k, i) => '<span class="chipk' + (i === 0 ? " on" : "") + '">' + esc(k) + "</span>").join("") + "</div>"
      + '<div class="apps" style="margin-top:20px">' + DATA.apps.map((a) => '<div class="app"><div class="tile">' + tileSvg(hexForId(a.id)) + '</div><div class="nm">' + esc(a.id) + "</div></div>").join("") + "</div>";
  } else { // rows
    body = '<div class="rows">' + s.kickers.map((k) => '<div class="rowk"><span class="dg"></span>' + esc(k) + '<span class="mono">building</span></div>').join("") + "</div>";
  }
  return '<div class="stub"><div class="head"><h1>' + esc(s.title) + '</h1><span class="bld"><span class="d"></span>building</span></div>'
    + '<div class="lede">' + esc(s.lede) + "</div>" + body + "</div>";
}

// ---------------------------------------------------------------------------
// SINGLE-WINDOW HASH ROUTER — swaps #pane, no reload; back/forward + deep-link.
// ---------------------------------------------------------------------------
// route + carried context: "#/dictionary?term=diaspora" → {route:"dictionary", params}
function parseRoute() {
  const h = (location.hash || "").replace(/^#\/?/, "");
  const qi = h.indexOf("?");
  const path = (qi >= 0 ? h.slice(0, qi) : h).trim();
  const params = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : "");
  return { route: path || "home", params };
}
function currentRoute() { return parseRoute().route; }
function render() {
  const { params } = parseRoute();
  let route = currentRoute();
  const pane = document.getElementById("pane");
  if (route === "home") { pane.innerHTML = renderHome(); }
  else if (SURFACES[route] && typeof SURFACES[route].render === "function") {
    const mod = SURFACES[route];
    ensureSurfaceCss(route, mod);
    try { pane.innerHTML = mod.render(DATA); }
    catch (e) { console.error("render " + route, e); pane.innerHTML = renderStub(route); }
    if (typeof mod.wire === "function") { try { mod.wire(pane); } catch (e) { console.error("wire " + route, e); } }
    // carried context: a surface can consume incoming params (highlight/scroll/filter to the item)
    if (typeof mod.applyContext === "function" && [...params.keys()].length) {
      try { mod.applyContext(pane, params); } catch (e) { console.error("applyContext " + route, e); }
    }
  }
  else if (STUBS[route]) { pane.innerHTML = renderStub(route); }
  else { route = "home"; pane.innerHTML = renderHome(); }
  renderRail(route);
  document.getElementById("foot").textContent =
    "the home you come back to · every surface in the rail is a lens on your Bank · single window, hash router · chrome stays lime + indigo, apps go vibrant";
  window.scrollTo(0, 0);
}

// clicks on data-route elements (cards / more-links / strip actions) navigate too
document.addEventListener("click", (e) => {
  // launch a wrapp (Home dock/cards, Apps surface, any [data-app]) → open its page,
  // carrying item context so the tool opens AT the right thing (data-ctx = encoded JSON).
  const app = e.target.closest("[data-app]");
  if (app) {
    const id = app.getAttribute("data-app");
    const url = pageFor(id);
    if (url) {
      e.preventDefault();
      const ctx = app.getAttribute("data-ctx"); // already URI-encoded JSON
      window.open(ctx ? url + "#os=" + ctx : url, "_blank", "noopener");
    }
    return;
  }
  // switch the active project (Home cards) → make it current + re-ground Home. In the native OS this
  // writes the global context; here it re-renders so the command centre re-centres on that project.
  const proj = e.target.closest("[data-project]");
  if (proj) { e.preventDefault(); switchProject(proj.getAttribute("data-project")); return; }
  // open a specific page / artifact in a new tab (surfaces use data-open="./x.html")
  const opener = e.target.closest("[data-open]");
  if (opener) { const u = opener.getAttribute("data-open"); if (u) { e.preventDefault(); window.open(u, "_blank", "noopener"); } return; }
  const el = e.target.closest("[data-route]");
  if (el && el.tagName !== "A") { e.preventDefault(); location.hash = "#/" + el.getAttribute("data-route"); }
});

function switchProject(id) {
  const all = DATA.projects || [];
  const p = all.find((x) => x.id === id);
  if (!p) return;
  all.forEach((x) => (x.active = x.id === id ? 1 : 0));
  DATA.project = { id: p.id, name: p.name, kind: p.kind, essence: p.essence,
    facets: [p.kind, p.essence, p.updated ? "updated " + p.updated : ""].filter(Boolean) };
  if (currentRoute() !== "home") location.hash = "#/home"; else render();
}

// ---------------------------------------------------------------------------
// SPOTLIGHT — one bar to reach anywhere: projects · apps · surfaces · actions.
// (the ⌥⌥ launcher is this same index, as a popover — search / voice / file → lead anywhere)
// ---------------------------------------------------------------------------
function spotlightIndex() {
  const out = [];
  (DATA.projects || []).forEach((p) =>
    out.push({ group: "Projects", label: p.name, sub: (p.kind || "") + (p.pending ? " · " + p.pending + " pending" : ""),
               ico: tileSvg(hexForId(p.id), 26), go: "switch", kind: "project", id: p.id, terms: (p.name + " " + p.kind + " " + (p.essence || "")).toLowerCase() }));
  (DATA.apps || []).forEach((a) =>
    out.push({ group: "Apps", label: a.id, sub: a.live ? "live" : "app", ico: appIcon(a.id, 26), go: "open", kind: "app", id: a.id, terms: a.id.toLowerCase() }));
  RAIL.forEach((grp) => grp.items.forEach((it) => {
    if (it.external) return;
    out.push({ group: "Go to", label: it.label, sub: grp.group, ico: '<span style="font-size:14px;color:var(--ink-dim)">' + it.icon + "</span>", go: "route", kind: "route", id: it.id, terms: (it.label + " " + grp.group).toLowerCase() });
  }));
  return out;
}
const ACTIONS = [
  { label: "Ask across your work", sub: "God · ⌃⌃", ico: "✦", act: "ask" },
  { label: "New project", sub: "start something", ico: "＋", act: "newproj" },
  { label: "Capture a note", sub: "into your Bank", ico: "✎", act: "capture" },
];
let spotSel = 0, spotRows = [];
function renderSpot(q) {
  const spot = document.getElementById("spot");
  if (!spot) return;
  const query = (q || "").trim().toLowerCase();
  const idx = spotlightIndex();
  let items = query ? idx.filter((e) => e.terms.includes(query)) : idx.filter((e) => e.group === "Projects");
  // actions always available; when typing, offer "Ask '<q>'" first
  const actions = query
    ? [{ group: "Actions", label: '“' + q.trim() + '”', sub: "ask across your work", ico: "✦", go: "act", act: "ask" }].concat(ACTIONS.map((a) => ({ ...a, group: "Actions", go: "act" })))
    : ACTIONS.map((a) => ({ ...a, group: "Actions", go: "act" }));
  const all = items.concat(actions);
  spotRows = all;
  if (!all.length) { spot.innerHTML = '<div class="empty">Nothing matches “' + esc(q) + "” — try a project, an app, or ask.</div>"; spot.hidden = false; return; }
  const order = ["Projects", "Apps", "Go to", "Actions"];
  let html = "", gi = 0, ri = 0;
  order.forEach((g) => {
    const rows = all.filter((r) => r.group === g);
    if (!rows.length) return;
    html += '<div class="grp">' + g + "</div>";
    rows.forEach((r) => {
      const i = ri++;
      html += '<div class="opt' + (i === spotSel ? " sel" : "") + '" data-si="' + i + '"><div class="ico">' + (r.ico || "") + "</div>"
        + '<div class="lab"><b>' + esc(r.label) + "</b>" + (r.sub ? "<span>" + esc(r.sub) + "</span>" : "") + "</div>"
        + '<div class="go">' + (r.go === "switch" ? "switch" : r.go === "open" ? "open" : r.go === "route" ? "go" : "↵") + "</div></div>";
    });
    gi++;
  });
  spot.innerHTML = html;
  spot.hidden = false;
}
function chooseSpot(i) {
  const r = spotRows[i]; if (!r) return;
  closeSpot();
  if (r.go === "switch") switchProject(r.id);
  else if (r.go === "route") location.hash = "#/" + r.id;
  else if (r.go === "open") { const u = pageFor(r.id); if (u) window.open(u, "_blank", "noopener"); }
  else if (r.go === "act") {
    if (r.act === "ask") alert("Ask across your work — routes to God (⌃⌃) in the native app.");
    else if (r.act === "newproj") location.hash = "#/bank";
    else if (r.act === "capture") location.hash = "#/bank";
  }
}
function closeSpot() { const s = document.getElementById("spot"); if (s) s.hidden = true; const inp = document.getElementById("omniInput"); if (inp) inp.value = ""; spotSel = 0; }
function wireOmni() {
  const inp = document.getElementById("omniInput"); if (!inp) return;
  inp.addEventListener("focus", () => { spotSel = 0; renderSpot(inp.value); });
  inp.addEventListener("input", () => { spotSel = 0; renderSpot(inp.value); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); spotSel = Math.min(spotSel + 1, spotRows.length - 1); renderSpot(inp.value); }
    else if (e.key === "ArrowUp") { e.preventDefault(); spotSel = Math.max(spotSel - 1, 0); renderSpot(inp.value); }
    else if (e.key === "Enter") { e.preventDefault(); chooseSpot(spotSel); }
    else if (e.key === "Escape") { e.preventDefault(); closeSpot(); inp.blur(); }
  });
  document.getElementById("spot").addEventListener("mousedown", (e) => {
    const opt = e.target.closest("[data-si]"); if (opt) { e.preventDefault(); chooseSpot(+opt.getAttribute("data-si")); }
  });
  const mic = document.getElementById("omniMic");
  if (mic) mic.addEventListener("click", () => alert("Voice — hold ⌃⌃ in the native app to ask by voice. (Web preview stub.)"));
  // drop a file on the bar → in native it attaches as context / opens the right wrapp; here we echo it.
  const omni = document.getElementById("omni");
  if (omni) {
    ["dragover", "dragenter"].forEach((ev) => omni.addEventListener(ev, (e) => { e.preventDefault(); omni.style.borderColor = "var(--lime)"; }));
    ["dragleave", "drop"].forEach((ev) => omni.addEventListener(ev, () => { omni.style.borderColor = ""; }));
    omni.addEventListener("drop", (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) alert("“" + f.name + "” — in the native app this attaches as context, or opens the right wrapp for it.");
    });
  }
  document.addEventListener("click", (e) => { if (!e.target.closest("#omniwrap")) { const s = document.getElementById("spot"); if (s) s.hidden = true; } });
  // ⌥⌥ / "/" focuses the bar (spotlight from anywhere)
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== inp && !/input|textarea/i.test((document.activeElement || {}).tagName || "")) { e.preventDefault(); inp.focus(); }
  });
}

window.addEventListener("hashchange", render);
render();
wireOmni();
