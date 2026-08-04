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
const SURFACES = { tasks: S_tasks, calendar: S_calendar, dashboard: S_dashboard, attention: S_attention, bank: S_bank, history: S_history, graph: S_graph, dictionary: S_dictionary, routines: S_routines, workflows: S_workflows, apps: S_apps, store: S_store };
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
  project: {
    id: "indeur", name: "IndEur Club", essence: "athleisure community brand · launching Q4",
    facets: ["brand", "4 logo marks", "palette: Terracotta & Indigo", "updated 20m ago"],
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
    { kind: "suggest", title: "Render your IndEur mark", body: "you kept 2 wireframes in Crest. Turn one into an image." },
    { kind: "suggest", title: "Draft the launch post", body: "brandbrain has your voice; write the IndEur announce." },
    { kind: "task", title: "Finalize Q4 palette", body: "@brandbrain · due Fri" },
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
  if (w.kind === "mark" || w.kind === "image") return '<div style="width:56px;height:56px;border-radius:12px;background:linear-gradient(150deg,' + h + ',#0d0e13);display:grid;place-items:center"><div style="width:26px;height:26px;border:2.5px solid #fff;border-radius:7px;opacity:.9"></div></div>';
  if (w.kind === "gallery") return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">' + [0, 1, 2, 3].map(() => '<span style="width:22px;height:22px;border-radius:5px;background:' + h + ';opacity:.85"></span>').join("") + "</div>";
  if (w.kind === "ad") return '<div style="width:78px;height:56px;border-radius:8px;background:' + h + ';opacity:.9;display:flex;flex-direction:column;justify-content:flex-end;padding:6px"><span style="height:5px;width:70%;background:#fff;opacity:.85;border-radius:3px"></span><span style="height:4px;width:45%;background:#fff;opacity:.6;border-radius:3px;margin-top:4px"></span></div>';
  return '<div style="width:56px;height:60px;border-radius:6px;background:#0f1116;border:1px solid #23262f;padding:9px 8px">' + [80, 60, 90, 50, 70].map((w2) => '<div style="height:3px;width:' + w2 + "%;background:" + (w2 === 90 ? h : "#3a3f4b") + ';border-radius:2px;margin-bottom:5px"></div>').join("") + "</div>";
}

function renderHome() {
  const p = DATA.project;
  let html = '<div class="hero"><h1>Evening, Sameep. <span class="sub">Here\'s where you left off.</span></h1>';
  html += '<div class="proj"><div class="mark">' + tileSvg(hexForId(p.id), 34) + "</div><div>"
    + '<div class="nm">' + esc(p.name) + "</div>"
    + '<div class="facets">' + p.facets.map((f) => '<span class="facet">' + esc(f) + "</span>").join("") + "</div>"
    + '</div><div class="switch">Switch project ▾</div></div></div>';

  // ① needs-attention strip (only when non-empty)
  if (DATA.needs.length) {
    html += '<div class="attn"><div class="ah">! NEEDS ATTENTION<span class="ct">' + DATA.needs.length + " waiting</span></div>"
      + DATA.needs.map((n) => '<div class="row">' + esc(n.title) + '<span class="do" data-route="needs">' + esc(n.act) + "</span></div>").join("")
      + "</div>";
  }

  // ② recent work
  html += '<div class="sh"><span class="kick">Recent work</span><span class="more" data-route="bank">everything you\'ve made →</span></div><div class="work">';
  html += DATA.work.map((w) => '<div class="card"><div class="thumb" style="background:linear-gradient(160deg,#101218,#0b0c11)">' + thumb(w) + "</div>"
    + '<div class="meta"><div class="t">' + esc(w.t) + '</div><div class="src">' + chip(hexForId(w.src), 13) + esc(w.src) + '<span class="time">' + esc(w.time) + "</span></div></div></div>").join("");
  html += "</div>";

  // ③ app dock — one deterministic hue per id
  html += '<div class="sh"><span class="kick">Your apps</span><span class="more" data-route="apps">all apps →</span></div><div class="apps">';
  html += DATA.apps.map((a) => '<div class="app"><div class="tile">' + tileSvg(hexForId(a.id)) + (a.live ? '<span class="live"></span>' : "") + '</div><div class="nm">' + esc(a.id) + "</div></div>").join("");
  html += "</div>";

  // ④ what's next
  html += '<div class="sh"><span class="kick">What\'s next</span></div><div class="next">';
  html += DATA.next.map((n) => '<div class="nx ' + (n.kind === "task" ? "task" : "") + '"><div class="g">' + (n.kind === "task" ? "☐" : "✦") + '</div><div class="tx"><b>' + esc(n.title) + "</b> — " + esc(n.body) + "</div></div>").join("");
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
function currentRoute() {
  const h = (location.hash || "").replace(/^#\/?/, "").trim();
  return h || "home";
}
function render() {
  let route = currentRoute();
  const pane = document.getElementById("pane");
  if (route === "home") { pane.innerHTML = renderHome(); }
  else if (SURFACES[route] && typeof SURFACES[route].render === "function") {
    const mod = SURFACES[route];
    ensureSurfaceCss(route, mod);
    try { pane.innerHTML = mod.render(DATA); }
    catch (e) { console.error("render " + route, e); pane.innerHTML = renderStub(route); }
    if (typeof mod.wire === "function") { try { mod.wire(pane); } catch (e) { console.error("wire " + route, e); } }
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
  const el = e.target.closest("[data-route]");
  if (el && el.tagName !== "A") { e.preventDefault(); location.hash = "#/" + el.getAttribute("data-route"); }
});
window.addEventListener("hashchange", render);
render();
