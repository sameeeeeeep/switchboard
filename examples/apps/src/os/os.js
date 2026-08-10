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
import * as S_project from "./surfaces/project.js";
import { appIcon, pageFor } from "./icons.js";
import { buildBankData } from "./bank-read.js";
import { whenRelayReady } from "@relay/sdk";
const SURFACES = { tasks: S_tasks, calendar: S_calendar, dashboard: S_dashboard, needs: S_attention, attention: S_attention, bank: S_bank, history: S_history, graph: S_graph, dictionary: S_dictionary, routines: S_routines, workflows: S_workflows, apps: S_apps, store: S_store, project: S_project };
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
// BANK DATA MODEL — the project-dir / vault lens the `project` + `bank` surfaces read.
// TEMPORARY seed, shaped to bank-read.js's buildBankData() contract. `initBank()` (bottom)
// swaps in real relay.storage reads when a daemon is present; offline this seed renders so the
// design stays grounded. A couple projects are fully populated; the rest degrade to empty-state
// (which the project surface handles), so both the full and first-run states are verifiable.
// ---------------------------------------------------------------------------
const EMPTY_FACETS = { essence: "", audience: "", goals: "", brandSet: { text: "", swatches: [] }, roadmap: [], voice: { empty: true, val: "", cta: "" } };
const BANK_SEED = {
  "a-new": {
    facets: {
      // NOTE: facet values are PLAIN TEXT — the surface escapes them (vault content is untrusted).
      // bank-read.js's buildBankData() must likewise emit plain strings, not HTML.
      essence: "A gen-z incense brand — indian maximalism, hip, unbothered.",
      audience: "18–28, tier-1 metros, aesthetic-first, buys on vibe and story.",
      goals: "Launch 3 SKUs · a scroll-stopping IG grid · 1,000 first orders.",
      brandSet: { text: "Palette: Marigold & Ink. 3 logo marks in Crest.", swatches: ["#E8B04A", "#c4301c", "#1b1a2e"] },
      roadmap: [["Name", "done"], ["Brand", "now"], ["Packaging", ""], ["Launch grid", ""]],
      voice: { empty: false, val: "quirky, unbothered, a little cheeky", cta: "" },
    },
    counts: { tasks: 5, brain: 9, artifacts: 12 },
    files: [
      { key: "project-a-new.md", title: "project-a-new.md", kind: "project", src: "manual", note: "root essence + audience + goals", updated: "20m",
        body: "# a new\n\n> gen-z incense — indian maximalism, hip, unbothered.\n\n## Essence\nA gen-z incense brand that treats ritual as self-expression, not tradition.\n\n## Audience\n18–28, tier-1 metros, aesthetic-first — buys on vibe and story.\n\n## Goals\n- Launch **3 SKUs**\n- A scroll-stopping IG grid\n- 1,000 first orders\n\n## Voice\nquirky, unbothered, a little cheeky. See [[voice-scratch]].\n" },
      { key: "voice-scratch.md", title: "voice-scratch.md", kind: "note", src: "manual", note: "cheeky one-liners, draft phrases", updated: "1h" },
      { key: "packaging-notes.md", title: "packaging-notes.md", kind: "note", src: "Flow · transcript", note: "what the box should feel like", updated: "3h" },
      { key: "skus.csv", title: "skus.csv", kind: "csv", src: "import", note: "3 SKUs · price · scent", updated: "yst" },
    ],
    brain: [], artifacts: [], tasks: [],
  },
  "nailinit": {
    facets: {
      essence: "india's #1 press-ons — salon nails in minutes.",
      audience: "", goals: "",
      brandSet: { text: "Palette read off the live storefront by the Bank connector.", swatches: ["#c4301c", "#fc3f75", "#ffe093", "#072835"] },
      roadmap: [], voice: { empty: true, val: "", cta: "↻ Extract voice" },
    },
    counts: { tasks: 3, brain: 6, artifacts: 4 },
    files: [
      { key: "brand-nailinit.md", title: "brand-nailinit.md", kind: "brand", src: "Bank connector", note: "palette + products, read from nailin.it", updated: "4h" },
      { key: "gst-legal.md", title: "gst-legal.md", kind: "note", src: "manual", note: "GSTIN, entity name, registered address", updated: "2d",
        body: "# nailinit — legal\n\n- **GST:** 27ABCDE1234F1Z5\n- **Entity:** Nailinit Retail Pvt Ltd\n- **PAN:** ABCDE1234F\n- **Registered address:** 4th Floor, Linking Road, Bandra West, Mumbai 400050\n\n> This is exactly the kind of value `vault.find` pulls locally — say “gst number of nailinit” and it pastes `27ABCDE1234F1Z5` without a Claude call.\n" },
    ],
    brain: [], artifacts: [], tasks: [],
  },
};
const DATABANK = {
  activeProjectId: "a-new",
  projects: DATA.projects.map((p) => {
    const seed = BANK_SEED[p.id] || {};
    return {
      id: p.id, name: p.name, kind: p.kind, active: !!p.active, essence: p.essence,
      pending: p.pending, updated: p.updated,   // Home-card sugar (badge + relative time); absent on real vault → cards degrade
      folder: "~/Bank/projects/" + p.id + "/",
      path: "~/Bank/projects/" + p.id + "/project-" + p.id + ".md",
      facets: seed.facets || EMPTY_FACETS,
      counts: seed.counts || { tasks: 0, brain: 0, artifacts: 0 },
      files: seed.files || [],
      brain: seed.brain || [],
      artifacts: seed.artifacts || [],
      tasks: seed.tasks || [],
    };
  }),
};
DATA.bank = DATABANK;

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

// a branded per-project MONOGRAM — the initial in Bricolage on a two-stop tint of the project's own hue.
// Reads as a crafted mark, not a generic 3D cube.
function shade(hex, f) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return "rgb(" + r + "," + g + "," + b + ")";
}
function monogram(p, px) {
  const h = hexForId(p.id);
  const ch = (p.name || "?").trim().charAt(0).toUpperCase();
  return '<div class="mono" style="width:' + px + "px;height:" + px + "px;background:linear-gradient(150deg," + h + " 0%," + shade(h, 0.42) + ' 100%)">'
    + '<span style="font-size:' + Math.round(px * 0.46) + 'px">' + esc(ch) + "</span></div>";
}
const KIND_TINT = { brand: "var(--lime)", project: "var(--indigo)", idea: "var(--warn)" };
function projectCard(p, big) {
  const cls = big ? "pcard big" : "pcard";
  const pend = p.pending ? '<span class="pend">' + p.pending + " pending</span>" : "";
  const tint = KIND_TINT[p.kind] || "var(--ink-faint)";
  return '<div class="' + cls + '" data-project="' + esc(p.id) + '" title="Open ' + esc(p.name) + '">'
    + '<div class="pmark">' + monogram(p, big ? 52 : 40) + "</div>"
    + '<div class="pbody"><div class="pnm">' + esc(p.name) + (p.active ? '<span class="cur">active</span>' : "") + "</div>"
    + '<div class="pess">' + esc(p.essence || p.kind) + "</div>"
    + '<div class="pmeta"><span class="kd" style="color:' + tint + '"><span class="kdot" style="background:' + tint + '"></span>' + esc(p.kind) + "</span>" + pend
    + (p.updated ? '<span class="upd">' + esc(p.updated) + "</span>" : "")
    + (big ? '<span class="resume">Resume →</span>' : "") + "</div></div></div>";
}

// hr01/hr02 — Home's projects come from the Bank vault model (DATA.bank), the SAME source the project
// + Bank surfaces read, so native shows real projects while the web preview shows the seed. Falls back
// to the legacy DATA.projects only if the bank model is somehow absent (defensive). Recent work / needs
// stay on the seed (DATA.work/needs) — bank-read doesn't produce those yet (spec's out-of-scope).
function homeProjects() {
  const b = DATA.bank && DATA.bank.projects;
  return (b && b.length ? b : DATA.projects) || [];
}

function renderHome() {
  const all = homeProjects();
  // hr03 — empty / first-run: a fresh vault with no projects. Show the door in, not a blank command centre.
  if (!all.length) {
    return '<div class="hero"><h1>Welcome, Sameep. <span class="sub">let\'s establish your first project.</span></h1></div>'
      + '<div class="attn" style="margin-top:22px"><div class="ah">＋ NO PROJECTS YET</div>'
      + '<div class="row">A project is a folder in your Bank — its essence, tasks, and artifacts in one place.'
      + '<span class="do" data-route="bank">Establish a project</span></div></div>';
  }
  const active = all.find((p) => p.active) || all[0] || DATA.project;
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
  const seg = path.split("/").filter(Boolean);   // "#/project/a-new" → ["project","a-new"]
  return { route: seg[0] || "home", sub: seg[1] || "", params };
}
function currentRoute() { return parseRoute().route; }
function render() {
  const { params, sub } = parseRoute();
  let route = currentRoute();
  // entering a project's dir ("#/project/<id>") focuses that project in the Bank model
  if (route === "project" && sub && DATA.bank) {
    DATA.bank.activeProjectId = sub;
    (DATA.bank.projects || []).forEach((x) => (x.active = x.id === sub));
  }
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
    (_vaultNote ? _vaultNote + " · " : "")
    + "the home you come back to · every surface in the rail is a lens on your Bank · single window, hash router · chrome stays lime + indigo, apps go vibrant";
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
  // select a project (Home cards / picker chips) → GO INTO its dir. Selecting makes it the active
  // project and opens its directory surface (files + vault + quick-view basics).
  const proj = e.target.closest("[data-project]");
  if (proj) { e.preventDefault(); enterProject(proj.getAttribute("data-project")); return; }
  // open a file from a project dir → preview its .md content in an overlay (the vault is markdown)
  const file = e.target.closest("[data-file]");
  if (file) { e.preventDefault(); openFilePreview(file.getAttribute("data-file")); return; }
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

// select a project → focus it in the Bank model AND open its directory surface (files + vault +
// quick-view basics). This is the "go into the project dir" gesture from Home / spotlight / chips.
function enterProject(id) {
  const all = homeProjects();
  const p = all.find((x) => x.id === id);
  if (!p) return;
  all.forEach((x) => (x.active = x.id === id ? 1 : 0));
  DATA.project = { id: p.id, name: p.name, kind: p.kind, essence: p.essence,
    facets: [p.kind, p.essence, p.updated ? "updated " + p.updated : ""].filter(Boolean) };
  if (DATA.bank) { DATA.bank.activeProjectId = id; (DATA.bank.projects || []).forEach((x) => (x.active = x.id === id)); }
  location.hash = "#/project/" + id;
}

// ---------------------------------------------------------------------------
// FILE PREVIEW — tap a file in a project dir to read its `.md`. Body comes from the cached vault
// handle (`relay.storage.get`) natively, or a seed `body` in the web preview. Rendered as light,
// escaped markdown in an overlay; esc / click-outside / × closes. States: content · empty · error.
// ---------------------------------------------------------------------------
const esc2 = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function mdToHtml(md) {
  const inline = (t) => esc2(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="wl">$1</span>');
  let out = "", inList = false, inCode = false;
  for (const line of String(md).replace(/\r/g, "").split("\n")) {
    if (/^```/.test(line)) { if (inCode) { out += "</pre>"; inCode = false; } else { if (inList) { out += "</ul>"; inList = false; } out += "<pre>"; inCode = true; } continue; }
    if (inCode) { out += esc2(line) + "\n"; continue; }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) { if (inList) { out += "</ul>"; inList = false; } out += "<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"; continue; }
    const li = /^\s*[-*]\s+(.+)$/.exec(line);
    if (li) { if (!inList) { out += "<ul>"; inList = true; } out += "<li>" + inline(li[1]) + "</li>"; continue; }
    const bq = /^\s*>\s?(.*)$/.exec(line);
    if (bq) { if (inList) { out += "</ul>"; inList = false; } out += "<blockquote>" + inline(bq[1]) + "</blockquote>"; continue; }
    if (!line.trim()) { if (inList) { out += "</ul>"; inList = false; } continue; }
    if (inList) { out += "</ul>"; inList = false; }
    out += "<p>" + inline(line) + "</p>";
  }
  if (inList) out += "</ul>";
  if (inCode) out += "</pre>";
  return out || '<p class="empty">This file is empty.</p>';
}
function findFileInBank(key) {
  for (const p of (DATA.bank && DATA.bank.projects) || []) {
    const f = (p.files || []).find((x) => x.key === key);
    if (f) return { file: f, project: p };
  }
  return { file: { key, title: key }, project: null };
}
let _pvEl = null;
async function openFilePreview(key) {
  const { file, project } = findFileInBank(key);
  let body = file.body != null ? file.body : null, err = false;
  if (body == null && _relay && _relay.storage) {
    try { body = await _relay.storage.get(key); } catch { body = null; err = true; }
  }
  renderFilePreview({ title: file.title || key, meta: [file.kind, file.src, file.updated].filter(Boolean).join(" · "), project, body, err });
}
function closeFilePreview() { if (_pvEl) _pvEl.hidden = true; }
function renderFilePreview(v) {
  if (!_pvEl) {
    const st = document.createElement("style");
    st.textContent = `
      #filepv { position: fixed; inset: 0; background: rgba(5,6,9,.66); backdrop-filter: blur(3px); display: grid; place-items: center; z-index: 9999; padding: 40px; }
      #filepv[hidden] { display: none; }
      #filepv .pvcard { width: min(760px,92vw); max-height: 84vh; display: flex; flex-direction: column; background: var(--panel,#12151C); border: 1px solid var(--edge,#262C38); border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.5); }
      #filepv .pvhead { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--edge-soft,#1C212B); }
      #filepv .pvt { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
      #filepv .pvfile { font: 600 14px/1.2 var(--mono,ui-monospace); color: var(--ink,#E8EDF4); }
      #filepv .pvproj { font: 500 10.5px/1 var(--mono,monospace); color: var(--lime,#C8F250); background: var(--lime-soft,#232B0D); border-radius: 6px; padding: 3px 7px; }
      #filepv .pvmeta { font: 400 11px/1 var(--mono,monospace); color: var(--ink-faint,#6E7C90); }
      #filepv .pvx { margin-left: auto; background: none; border: 0; color: var(--ink-dim,#99A3B7); font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px; }
      #filepv .pvx:hover { color: var(--ink,#E8EDF4); }
      #filepv .pvbody { padding: 18px 20px 26px; overflow-y: auto; color: var(--ink-sec,#B4BECE); font: 400 13.5px/1.65 var(--sans,system-ui); }
      #filepv .pvbody h1,#filepv .pvbody h2,#filepv .pvbody h3,#filepv .pvbody h4 { color: var(--ink,#E8EDF4); font-family: var(--display,sans-serif); margin: 18px 0 8px; line-height: 1.25; }
      #filepv .pvbody h1 { font-size: 20px; } #filepv .pvbody h2 { font-size: 16px; } #filepv .pvbody h3 { font-size: 14px; }
      #filepv .pvbody p { margin: 8px 0; }
      #filepv .pvbody ul { margin: 8px 0; padding-left: 20px; } #filepv .pvbody li { margin: 3px 0; }
      #filepv .pvbody code { font: 400 12px var(--mono,monospace); background: var(--inset,#070809); border: 1px solid var(--edge-soft,#1C212B); border-radius: 5px; padding: 1px 5px; }
      #filepv .pvbody pre { background: var(--inset,#070809); border: 1px solid var(--edge-soft,#1C212B); border-radius: 10px; padding: 12px 14px; overflow-x: auto; font: 400 12px/1.5 var(--mono,monospace); color: var(--ink-sec,#B4BECE); }
      #filepv .pvbody blockquote { border-left: 2px solid var(--lime,#C8F250); margin: 10px 0; padding: 2px 0 2px 12px; color: var(--ink-dim,#99A3B7); }
      #filepv .pvbody a, #filepv .pvbody .wl { color: var(--lime,#C8F250); }
      #filepv .pvbody strong { color: var(--ink,#E8EDF4); }
      #filepv .pvbody .empty { color: var(--ink-faint,#6E7C90); font-style: italic; }`;
    document.head.appendChild(st);
    _pvEl = document.createElement("div");
    _pvEl.id = "filepv"; _pvEl.hidden = true;
    document.body.appendChild(_pvEl);
    _pvEl.addEventListener("click", (e) => { if (e.target === _pvEl || e.target.closest("[data-pvclose]")) closeFilePreview(); });
  }
  const bodyHtml = v.err
    ? '<p class="empty">Couldn’t read this file from the vault.</p>'
    : (v.body != null ? mdToHtml(v.body) : '<p class="empty">No preview yet — this file has no content, or the vault isn’t connected in this view.</p>');
  const proj = v.project ? '<span class="pvproj">' + esc(v.project.name) + "</span>" : "";
  _pvEl.innerHTML =
    '<div class="pvcard" role="dialog" aria-label="' + esc(v.title) + '">'
    + '<header class="pvhead"><div class="pvt"><span class="pvfile">' + esc(v.title) + "</span>" + proj
    + (v.meta ? '<span class="pvmeta">' + esc(v.meta) + "</span>" : "")
    + '</div><button class="pvx" data-pvclose title="Close (esc)">×</button></header>'
    + '<div class="pvbody">' + bodyHtml + "</div></div>";
  _pvEl.hidden = false;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _pvEl && !_pvEl.hidden) { e.preventDefault(); closeFilePreview(); } });

// ---------------------------------------------------------------------------
// SPOTLIGHT — one bar to reach anywhere: projects · apps · surfaces · actions.
// (the ⌥⌥ launcher is this same index, as a popover — search / voice / file → lead anywhere)
// ---------------------------------------------------------------------------
function spotlightIndex() {
  const out = [];
  homeProjects().forEach((p) =>
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
  if (r.go === "switch") enterProject(r.id);
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

// ---------------------------------------------------------------------------
// REAL-VAULT BOOT — swap the grounded seed for live relay.storage reads when a daemon/provider is
// present (native OS webview, or an allowlisted extension origin). In the plain web preview there is
// no provider → whenRelayReady times out and we keep the seed, so the design always renders. Reads
// (list/get) aren't consent-gated, so this needs no grant; a failure never blanks the vault.
// ---------------------------------------------------------------------------
let _relay = null;   // cached connected handle → the file preview fetches real .md bodies on demand
let _vaultNote = null;   // hr04 — a quiet foot notice when a vault read fails (seed stays on screen)
async function initBank() {
  let relay = null;
  try { relay = await whenRelayReady(2500); } catch { return; }         // no provider → keep seed
  if (!relay || !relay.storage || typeof relay.storage.list !== "function") return;
  _relay = relay;
  try {
    const bank = await buildBankData(relay);
    if (bank && Array.isArray(bank.projects) && bank.projects.length) {
      // preserve the user's current project focus if the route is on a dir
      const { route, sub } = parseRoute();
      if (route === "project" && sub) bank.activeProjectId = sub;
      DATA.bank = bank;
      render();
    }
  } catch (e) {
    console.error("[os] vault read failed — keeping seed", e);
    _vaultNote = "⚠ couldn't read your vault — showing the last known view"; // hr04: keep seed, notice, no blank
    render();
  }
}
void initBank();
