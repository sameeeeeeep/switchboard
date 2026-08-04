// Bank surface — the .md vault: projects strip + active-project hero with
// facet tabs (Overview / Tasks / Brain / Artifacts). Ported from wf-bank.html.
// Self-contained ES module: render(DATA) -> HTML string, css, wire(root).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// isometric mark (same math as os.js isoTile) — a fixed hero glyph
const S = 6.2, K = 0.866 * S, HH = 0.5 * S;
function isoTile(hue, cx, cy) {
  const P = (x, y, z) => (cx + (x - y) * K).toFixed(1) + "," + (cy + (x + y) * HH - z * S).toFixed(1);
  const poly = (pts, f) => '<polygon points="' + pts.map((p) => P(p[0], p[1], p[2])).join(" ") + '" fill="' + f + '"/>';
  const shade = (hex, amt) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return "#" + ((1 << 24) + ((Math.round(r * amt)) << 16) + ((Math.round(g * amt)) << 8) + Math.round(b * amt)).toString(16).slice(1); };
  const T = hue, L = shade(hue, 0.66), R = shade(hue, 0.5);
  const box = (ox, oy, oz, s, h) => { const x1 = ox + s, y1 = oy + s, z1 = oz + h; return poly([[x1, oy, oz], [x1, y1, oz], [x1, y1, z1], [x1, oy, z1]], R) + poly([[ox, y1, oz], [x1, y1, oz], [x1, y1, z1], [ox, y1, z1]], L) + poly([[ox, oy, z1], [x1, oy, z1], [x1, y1, z1], [ox, y1, z1]], T); };
  return box(-2.2, -2.2, 0, 4.4, 1.4) + box(-1.2, -1.2, 1.4, 2.4, 2.4);
}
const markSvg = (hex, px) => '<svg viewBox="0 0 64 64" width="' + px + '" height="' + px + '" xmlns="http://www.w3.org/2000/svg">' + isoTile(hex, 32, 40) + "</svg>";

// Local sample: projects + per-facet vault content (real Bank reads later)
const SAMPLE = {
  projects: [
    { id: "indeur", name: "IndEur Club", active: true },
    { id: "nailinit", name: "Nailinit" },
    { id: "pockettts", name: "Idea: pocket-tts" },
    { id: "switchboard", name: "Switchboard" },
  ],
  facetCounts: { tasks: 6, brain: 14, artifacts: 23 },
  path: "~/Bank/projects/indeur-club/project-indeur.md",
  overview: [
    { lbl: "Essence", val: 'A <b>membership community</b> for the Indian-European diaspora — cultural events, professional network, a sense of home away from home.' },
    { lbl: "Audience", val: "First &amp; second-gen Indians in the EU, 24–40, city-based, seeking belonging + opportunity." },
    { lbl: "Goals", val: '<b>500 founding members</b> before launch · a monthly flagship event in 3 cities · a warm, ownable brand.' },
    { lbl: "Brand set", val: 'Palette: <b>Terracotta &amp; Indigo</b>. 4 logo marks in Crest.', swatches: ["#E0764A", "#5b4fe8", "#E8B04A", "#1b1a2e"] },
    { lbl: "Roadmap", roadmap: [["Name", "done"], ["Brand", "done"], ["Launch page", "now"], ["First event", ""], ["500 members", ""]] },
    { lbl: "Voice & tone", empty: true, val: "No voice profile yet — brandbrain can extract one from your notes.", cta: "↻ Extract voice" },
  ],
  tasks: [
    { t: "Finalize Q4 palette", meta: "@brandbrain · due Fri", state: "now" },
    { t: "Ship the launch page", meta: "@Crest · in progress", state: "now" },
    { t: "Book 3 event venues", meta: "due next week", state: "" },
    { t: "Draft founding-member email", meta: "@AdForge", state: "" },
    { t: "Extract brand voice", meta: "@brandbrain", state: "" },
    { t: "Confirm pricing tiers", meta: "blocked · needs decision", state: "blocked" },
  ],
  brain: [
    { t: "project-indeur.md", note: "the root essence + audience + goals", src: "manual" },
    { t: "meetup-notes.md", note: "what the first 30 members want from a chapter", src: "Flow · transcript" },
    { t: "pricing-thesis.md", note: "founding vs monthly tiers; €9 anchor", src: "ideabrain run" },
    { t: "voice-scratch.md", note: "warm, plural, never corporate — draft phrases", src: "manual" },
  ],
  artifacts: [
    { t: "Switch-ligature monogram", kind: "mark", src: "Crest", time: "20m" },
    { t: "IndEur — 4 marks", kind: "gallery", src: "Crest", time: "22m" },
    { t: "Terracotta beam render", kind: "image", src: "Prism", time: "1h" },
    { t: '"Find your people" ad', kind: "ad", src: "AdForge", time: "1h" },
  ],
};

function ovField(f) {
  if (f.empty) {
    return '<div class="field empty"><div class="lbl">' + esc(f.lbl) + '</div><div class="val">' + f.val + '</div><span class="cta">' + esc(f.cta) + '</span></div>';
  }
  let inner = '<div class="lbl">' + esc(f.lbl) + '</div>';
  if (f.val) inner += '<div class="val">' + f.val + '</div>';
  if (f.swatches) inner += '<div class="swatches">' + f.swatches.map((c) => '<span class="sw" style="background:' + c + '"></span>').join("") + '</div>';
  if (f.roadmap) inner += '<div class="roadmap">' + f.roadmap.map(([n, st]) => '<span class="stg ' + st + '">' + esc(n) + '</span>').join("") + '</div>';
  return '<div class="field">' + inner + '</div>';
}

function facetOverview() {
  return '<div class="ovgrid">' + SAMPLE.overview.map(ovField).join("") + '</div>';
}
function facetTasks() {
  return '<div class="rows">' + SAMPLE.tasks.map((t) =>
    '<div class="brow"><span class="bx ' + t.state + '"></span><div class="bt">' + esc(t.t) + '</div><div class="bm">' + esc(t.meta) + '</div></div>').join("") + '</div>';
}
function facetBrain() {
  return '<div class="rows">' + SAMPLE.brain.map((n) =>
    '<div class="brow"><span class="md">▤</span><div class="bt">' + esc(n.t) + ' <span class="dim">— ' + esc(n.note) + '</span></div><div class="bm">' + esc(n.src) + '</div></div>').join("") + '</div>';
}
function facetArtifacts() {
  return '<div class="artgrid">' + SAMPLE.artifacts.map((a) =>
    '<div class="art"><div class="athumb ' + a.kind + '"></div><div class="an">' + esc(a.t) + '</div><div class="as">' + esc(a.src) + ' · ' + esc(a.time) + '</div></div>').join("") + '</div>';
}

const FACETS = { overview: facetOverview, tasks: facetTasks, brain: facetBrain, artifacts: facetArtifacts };

export function render(DATA) {
  const c = SAMPLE.facetCounts;
  let h = '<div class="srf-bank">';
  h += '<div class="bankhead"><span class="kick">Bank · brain</span><h1>Your vault</h1>'
    + '<div class="estab"><div class="btn est">+ Establish a project</div><div class="btn vs">Open the folder</div></div></div>';

  // projects strip
  h += '<div class="strip">' + SAMPLE.projects.map((p) =>
    '<div class="pchip' + (p.active ? " on" : "") + '"><span class="d"></span>' + esc(p.name)
    + (p.active ? '<span class="act">active</span>' : "") + '</div>').join("")
    + '<div class="pchip new">+ New</div></div>';

  // active-project hero
  h += '<div class="hero"><div class="row">'
    + '<div class="mark">' + markSvg("#E0764A", 34) + '</div>'
    + '<div><div class="nm">IndEur Club</div><div class="desc">"a community for the Indian-European diaspora — events, belonging, launching Q4"</div></div>'
    + '<div class="path">' + esc(SAMPLE.path) + '</div></div>';

  // facet tabs
  h += '<div class="tabs">'
    + '<div class="tab on" data-facet="overview">Overview</div>'
    + '<div class="tab" data-facet="tasks">Tasks <span class="ct">' + c.tasks + '</span></div>'
    + '<div class="tab" data-facet="brain">Brain <span class="ct">' + c.brain + '</span></div>'
    + '<div class="tab" data-facet="artifacts">Artifacts <span class="ct">' + c.artifacts + '</span></div>'
    + '</div>';

  h += '<div class="facet" data-facetbody>' + facetOverview() + '</div>';
  h += '</div>'; // hero

  // capture box
  h += '<div class="capture"><div class="ic">＋</div>'
    + '<div class="tx"><b>Drop a file, paste a note, or "Bank it."</b> — files it as an artifact or note on IndEur Club, with its source.</div>'
    + '<div class="bank">Bank it</div></div>';

  h += '</div>';
  return h;
}

export function wire(root) {
  const tabs = root.querySelectorAll(".srf-bank .tab");
  const body = root.querySelector(".srf-bank [data-facetbody]");
  if (!tabs.length || !body) return;
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("on"));
      tab.classList.add("on");
      const f = tab.getAttribute("data-facet");
      body.innerHTML = (FACETS[f] || facetOverview)();
    });
  });
}

export const css = `
.srf-bank{padding-top:8px}
.srf-bank .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-bank .bankhead{display:flex;align-items:center;gap:14px;margin-top:8px}
.srf-bank .bankhead h1{font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-.02em;margin:0}
.srf-bank .estab{margin-left:auto;display:flex;gap:10px}
.srf-bank .estab .btn{font-size:12.5px;border-radius:9px;padding:8px 14px;white-space:nowrap;cursor:pointer}
.srf-bank .estab .est{color:#0c0d10;background:var(--lime);font-weight:600;border:1px solid var(--lime)}
.srf-bank .estab .vs{color:var(--ink-dim);background:var(--panel);border:1px solid var(--edge)}
.srf-bank .strip{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;align-items:center}
.srf-bank .pchip{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--edge);border-radius:11px;padding:7px 12px;font-size:13px;color:var(--ink-sec);cursor:pointer}
.srf-bank .pchip.on{border-left:2px solid var(--indigo);background:linear-gradient(180deg,#15131f,#121319);color:var(--ink)}
.srf-bank .pchip .d{width:8px;height:8px;border-radius:50%;background:var(--ink-faint)}
.srf-bank .pchip.on .d{background:var(--indigo);box-shadow:0 0 7px 1px rgba(91,79,232,.6)}
.srf-bank .pchip .act{font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-left:2px}
.srf-bank .pchip.new{color:var(--ink-dim);border-style:dashed}
.srf-bank .hero{background:linear-gradient(180deg,#15131f,#121319);border:1px solid var(--edge);border-left:2px solid var(--indigo);border-radius:16px;padding:18px 22px;margin-top:16px}
.srf-bank .hero .row{display:flex;align-items:center;gap:16px}
.srf-bank .hero .mark{width:46px;height:46px;border-radius:12px;background:#1b1a2e;border:1px solid #2c2a55;display:grid;place-items:center;flex:0 0 auto}
.srf-bank .hero .nm{font-size:17px;font-weight:600}
.srf-bank .hero .desc{font-size:12.5px;color:var(--ink-dim);margin-top:2px}
.srf-bank .hero .path{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink-faint)}
.srf-bank .tabs{display:flex;gap:6px;margin-top:16px;border-bottom:1px solid var(--edge-soft)}
.srf-bank .tab{font-size:13px;color:var(--ink-dim);padding:8px 14px;border-radius:9px 9px 0 0;cursor:pointer;position:relative;top:1px}
.srf-bank .tab .ct{color:var(--ink-faint)}
.srf-bank .tab.on{color:var(--ink);background:var(--panel);border:1px solid var(--edge-soft);border-bottom:1px solid var(--panel)}
.srf-bank .facet{padding:18px 2px 2px}
.srf-bank .ovgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.srf-bank .field{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:13px 15px}
.srf-bank .field .lbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.srf-bank .field .val{font-size:13px;color:var(--ink-sec);margin-top:7px;line-height:1.5}
.srf-bank .field .val b{color:var(--ink);font-weight:500}
.srf-bank .swatches{display:flex;gap:7px;margin-top:9px}
.srf-bank .sw{width:26px;height:26px;border-radius:7px;border:1px solid rgba(255,255,255,.08)}
.srf-bank .field.empty{border-style:dashed;background:transparent}
.srf-bank .field.empty .val{color:var(--ink-dim)}
.srf-bank .field.empty .cta{margin-top:9px;display:inline-block;font-size:12px;color:var(--lime);border:1px solid #3a4a12;background:#20260c;border-radius:8px;padding:6px 11px;cursor:pointer}
.srf-bank .roadmap{display:flex;gap:10px;margin-top:9px;flex-wrap:wrap}
.srf-bank .stg{font-size:11.5px;color:var(--ink-sec);background:#0f1116;border:1px solid var(--edge);border-radius:20px;padding:3px 11px}
.srf-bank .stg.done{color:var(--lime);border-color:#3a4a12}
.srf-bank .stg.now{color:var(--indigo);border-color:#2c2a55;background:#14122b}
.srf-bank .rows{display:flex;flex-direction:column;gap:8px}
.srf-bank .brow{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--edge);border-radius:11px;padding:11px 15px}
.srf-bank .brow .bx{width:13px;height:13px;border-radius:4px;border:1px solid var(--edge);flex:0 0 auto}
.srf-bank .brow .bx.now{border-color:var(--indigo);background:#14122b}
.srf-bank .brow .bx.blocked{border-color:#5a2c30;background:#241214}
.srf-bank .brow .md{color:var(--ink-faint);font-family:var(--mono);flex:0 0 auto}
.srf-bank .brow .bt{font-size:13px;color:var(--ink);flex:1;min-width:0}
.srf-bank .brow .bt .dim{color:var(--ink-dim);font-weight:400}
.srf-bank .brow .bm{font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);flex:0 0 auto}
.srf-bank .artgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.srf-bank .art{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:10px;cursor:pointer}
.srf-bank .athumb{height:84px;border-radius:8px;background:linear-gradient(150deg,#E0764A,#0d0e13)}
.srf-bank .athumb.image{background:linear-gradient(150deg,#9B5DE5,#0d0e13)}
.srf-bank .athumb.ad{background:linear-gradient(150deg,#F2994A,#0d0e13)}
.srf-bank .athumb.gallery{background:linear-gradient(150deg,#E0764A,#3a1f13)}
.srf-bank .art .an{font-size:12.5px;color:var(--ink);margin-top:9px;font-weight:500}
.srf-bank .art .as{font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:3px}
.srf-bank .capture{margin-top:22px;border:1px dashed var(--edge);border-radius:14px;padding:18px 20px;display:flex;align-items:center;gap:14px;background:linear-gradient(180deg,#0e0f14,#0b0c11)}
.srf-bank .capture .ic{width:38px;height:38px;border-radius:11px;background:#0f1116;border:1px solid var(--edge);display:grid;place-items:center;color:var(--ink-dim);font-size:17px;flex:0 0 auto}
.srf-bank .capture .tx{font-size:13px;color:var(--ink-sec)}
.srf-bank .capture .tx b{color:var(--ink);font-weight:500}
.srf-bank .capture .bank{margin-left:auto;font-size:12.5px;color:#0c0d10;background:var(--lime);font-weight:600;border-radius:9px;padding:8px 15px;cursor:pointer;white-space:nowrap}
`;
