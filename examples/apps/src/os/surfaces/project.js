// Project surface — one project's directory: its files, its vault location,
// and a quick-view of the basics. "select a project, go into project dir,
// the right files are shown there with vault etc, and a quick view of the basics."
// Self-contained ES module: render(DATA) -> HTML string, css, wire(root).
//
// DATA.bank = {
//   activeProjectId: string|null,
//   projects: [{ id, name, kind, active, essence, folder, path,
//                facets: { essence, audience, goals,
//                          brandSet:{text, swatches:[hex...]},
//                          roadmap:[[label,state]],           // state: "done"|"now"|""
//                          voice:{empty,val,cta} },
//                counts: { tasks, brain, artifacts },
//                files:   [{ key, title, kind, src, note, updated }],
//                brain:   [...], artifacts:[...], tasks:[...] }]
// }
// DATA.bank may be undefined/null (loading), projects may be [] (empty vault).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

// isometric mark (same math as bank.js / os.js isoTile) — a fixed hero glyph, per project hue
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

// deterministic per-id color — same math as os.js hueForId/hexForId, ported so this
// module stays self-contained (no cross-surface imports).
function hueForId(id) {
  let h = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (n) => Math.round(255 * f(n)).toString(16).padStart(2, "0");
  return "#" + to(0) + to(8) + to(4);
}
function hexForId(id) { return hslToHex(hueForId(id), 68, 58); }

// ---------------------------------------------------------------------------
// facet-field helper — same visual language as bank.js's ovField, but reads
// from a single project's `facets` object instead of a flat sample array, and
// degrades every kind of field (text / swatches / roadmap) to a labelled
// empty card with a CTA when the vault doesn't have that facet yet.
// ---------------------------------------------------------------------------
function fieldCard(lbl, opts) {
  const { val, swatches, roadmap, empty, cta, ctaAttr } = opts || {};
  const isEmpty = empty || (!val && !swatches && !(roadmap && roadmap.length));
  if (isEmpty) {
    const ctaTxt = cta || ("+ Add " + lbl.toLowerCase());
    const attr = ctaAttr || ' data-route="bank"';
    return '<div class="field empty"><div class="lbl">' + esc(lbl) + '</div>'
      + '<div class="val">' + esc(opts && opts.emptyMsg ? opts.emptyMsg : "Not set yet in the vault.") + '</div>'
      + '<span class="cta"' + attr + '>' + esc(ctaTxt) + '</span></div>';
  }
  let inner = '<div class="lbl">' + esc(lbl) + '</div>';
  if (val) inner += '<div class="val">' + esc(val) + '</div>';
  if (swatches && swatches.length) inner += '<div class="swatches">' + swatches.map((c) => '<span class="sw" style="background:' + escAttr(c) + '"></span>').join("") + '</div>';
  if (roadmap && roadmap.length) inner += '<div class="roadmap">' + roadmap.map(([n, st]) => '<span class="stg ' + esc(st || "") + '">' + esc(n) + '</span>').join("") + '</div>';
  return '<div class="field">' + inner + '</div>';
}

function quickView(facets) {
  const f = facets || {};
  const brand = f.brandSet || {};
  const voice = f.voice || {};
  const fields = [
    fieldCard("Essence", { val: f.essence, emptyMsg: "No essence written yet — what is this, in one line?" }),
    fieldCard("Audience", { val: f.audience, emptyMsg: "No audience defined yet." }),
    fieldCard("Goals", { val: f.goals, emptyMsg: "No goals set yet." }),
    fieldCard("Brand set", { val: brand.text, swatches: brand.swatches, emptyMsg: "No brand set yet — palette + marks land here." }),
    fieldCard("Roadmap", { roadmap: f.roadmap, emptyMsg: "No roadmap yet." }),
    fieldCard("Voice & tone", {
      empty: voice.empty !== false && (voice.empty || !voice.val),
      val: voice.val,
      emptyMsg: voice.val || "No voice profile yet — brandbrain can extract one from your notes.",
      cta: voice.cta || "↻ Extract voice",
      ctaAttr: ' data-app="brandbrain"',
    }),
  ];
  return '<div class="ovgrid">' + fields.join("") + '</div>';
}

// ---------------------------------------------------------------------------
// files — the project's directory listing. Each row is the "right file
// shown there" the founder asked for: title, kind, source, a preview note,
// and when it last changed. Clickable via data-file so the host can open it.
// ---------------------------------------------------------------------------
function fileRow(f) {
  const key = f.key || f.title || "";
  return '<div class="frow" data-file="' + escAttr(key) + '" title="Open ' + escAttr(f.title || key) + '">'
    + '<span class="fic">▤</span>'
    + '<div class="fmain"><div class="ft">' + esc(f.title || key) + '</div>'
    + (f.note ? '<div class="fnote">' + esc(f.note) + '</div>' : "")
    + '</div>'
    + '<span class="fkind">' + esc(f.kind || "file") + '</span>'
    + '<span class="fsrc">' + esc(f.src || "") + '</span>'
    + '<span class="fupd">' + esc(f.updated || "") + '</span>'
    + '</div>';
}

function filesSection(files) {
  const list = Array.isArray(files) ? files : [];
  let h = '<div class="fileshead"><span class="kick">Files</span><span class="fcount">' + list.length + '</span>'
    + '<span class="fnew" data-app="Bank" title="File a new note or artifact on this project">+ File a note</span></div>';
  if (!list.length) {
    h += '<div class="fempty">This project\'s directory is empty — no files here yet.'
      + ' <span class="cta" data-app="Bank">Bank it</span> to add the first one.</div>';
  } else {
    h += '<div class="frows">' + list.map(fileRow).join("") + '</div>';
  }
  return h;
}

// ---------------------------------------------------------------------------
// counts strip — small tab-like affordances toward the fuller lenses.
// tasks/brain have real top-level surfaces (Tasks, Graph); artifacts doesn't
// yet, so it carries both a data-tab hint and a safe data-route fallback.
// ---------------------------------------------------------------------------
function countsStrip(counts) {
  const c = counts || {};
  const n = (v) => (typeof v === "number" ? v : 0);
  return '<div class="cstrip">'
    + '<div class="cpill" data-route="tasks" data-tab="tasks"><span class="cn">' + n(c.tasks) + '</span>Tasks</div>'
    + '<div class="cpill" data-route="graph" data-tab="brain"><span class="cn">' + n(c.brain) + '</span>Brain</div>'
    + '<div class="cpill" data-route="bank" data-tab="artifacts"><span class="cn">' + n(c.artifacts) + '</span>Artifacts</div>'
    + '</div>';
}

function header(p) {
  const hex = hexForId(p.id || p.name || "project");
  const path = p.path || p.folder || "";
  return '<div class="phead">'
    + '<div class="mark">' + markSvg(hex, 40) + '</div>'
    + '<div class="pmain"><div class="nmrow"><span class="nm">' + esc(p.name || "Untitled project") + '</span>'
    + '<span class="kindb">' + esc(p.kind || "project") + '</span></div>'
    + (p.essence ? '<div class="desc">' + esc(p.essence) + '</div>' : "")
    + '</div>'
    + '<div class="vault">'
    + (path ? '<div class="path" title="' + escAttr(path) + '">' + esc(path) + '</div>' : '<div class="path dim">no vault folder bound yet</div>')
    + '<div class="ofolder" data-open-folder="' + escAttr(path) + '" title="Open the folder">Open the folder ▸</div>'
    + '</div>'
    + '</div>';
}

function findActive(bank) {
  const projects = (bank && bank.projects) || [];
  if (!projects.length) return null;
  const byId = bank.activeProjectId && projects.find((p) => p.id === bank.activeProjectId);
  return byId || projects.find((p) => p.active) || projects[0];
}

function projectPicker(projects) {
  return '<div class="picker">' + projects.map((p) =>
    '<div class="pchip" data-project="' + escAttr(p.id) + '"><span class="d" style="background:' + hexForId(p.id) + '"></span>' + esc(p.name) + '</div>'
  ).join("") + '</div>';
}

function skeleton() {
  return '<div class="srf-project skel">'
    + '<div class="phead"><div class="ph markph"></div><div class="pmain"><div class="ph line w1"></div><div class="ph line w2"></div></div></div>'
    + '<div class="ovgrid">' + Array(6).fill('<div class="ph card"></div>').join("") + '</div>'
    + '<div class="fileshead"><div class="ph line w3"></div></div>'
    + '<div class="frows">' + Array(4).fill('<div class="ph row"></div>').join("") + '</div>'
    + '</div>';
}

function emptyState(projects) {
  const hasProjects = projects && projects.length;
  return '<div class="srf-project"><div class="pempty">'
    + '<div class="pe-ic">◐</div><h1>No project selected</h1>'
    + '<p>Select a project — from the strip below, Home, or Spotlight — to see its directory: files, vault, and the basics.</p>'
    + (hasProjects ? projectPicker(projects) : '<p class="pe-sub">You don\'t have any projects in the Bank yet.</p>')
    + '</div></div>';
}

export function render(DATA) {
  if (!DATA || !DATA.bank) return skeleton();
  const bank = DATA.bank;
  const projects = bank.projects || [];
  const p = findActive(bank);
  if (!p) return emptyState(projects);

  let h = '<div class="srf-project">';
  h += header(p);
  h += countsStrip(p.counts);
  h += '<div class="qvhead"><span class="kick">Quick view</span></div>';
  h += quickView(p.facets);
  h += filesSection(p.files);
  h += '</div>';
  return h;
}

export function wire(root) {
  const srf = root.querySelector(".srf-project");
  if (!srf) return;
  // File rows: mark the clicked row selected for visual feedback. The actual
  // open/preview is the host's job — it owns data-file navigation.
  const rows = srf.querySelectorAll(".frow[data-file]");
  rows.forEach((row) => {
    row.addEventListener("click", () => {
      rows.forEach((r) => r.classList.remove("sel"));
      row.classList.add("sel");
    });
  });
}

export const css = `
.srf-project{padding-top:8px}
.srf-project .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-project .phead{display:flex;align-items:center;gap:16px;background:linear-gradient(180deg,#15131f,#121319);border:1px solid var(--edge);border-left:2px solid var(--indigo);border-radius:16px;padding:18px 22px}
.srf-project .phead .mark{width:52px;height:52px;border-radius:13px;background:#1b1a2e;border:1px solid #2c2a55;display:grid;place-items:center;flex:0 0 auto}
.srf-project .pmain{min-width:0}
.srf-project .nmrow{display:flex;align-items:center;gap:9px}
.srf-project .nm{font-size:18px;font-weight:600;letter-spacing:-.01em}
.srf-project .kindb{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-dim);background:var(--panel);border:1px solid var(--edge);border-radius:20px;padding:2px 9px}
.srf-project .desc{font-size:12.5px;color:var(--ink-dim);margin-top:4px}
.srf-project .vault{margin-left:auto;text-align:right;flex:0 0 auto}
.srf-project .path{font-family:var(--mono);font-size:11px;color:var(--ink-faint);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srf-project .path.dim{color:var(--ink-faint);font-style:italic}
.srf-project .ofolder{margin-top:8px;display:inline-block;font-size:12px;color:var(--ink-dim);background:var(--panel);border:1px solid var(--edge);border-radius:8px;padding:6px 12px;cursor:pointer;white-space:nowrap;transition:border-color .12s,color .12s}
.srf-project .ofolder:hover{border-color:var(--edge-soft);color:var(--ink)}
.srf-project .cstrip{display:flex;gap:10px;margin-top:14px}
.srf-project .cpill{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-sec);background:var(--panel);border:1px solid var(--edge);border-radius:20px;padding:6px 13px;cursor:pointer;transition:border-color .12s,color .12s}
.srf-project .cpill:hover{border-color:var(--edge-soft);color:var(--ink)}
.srf-project .cpill .cn{font-family:var(--mono);font-size:12px;color:var(--ink);background:var(--raised,#1a1c22);border-radius:20px;padding:0 7px;min-width:18px;text-align:center}
.srf-project .qvhead{margin-top:22px;margin-bottom:10px}
.srf-project .ovgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.srf-project .field{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:13px 15px}
.srf-project .field .lbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.srf-project .field .val{font-size:13px;color:var(--ink-sec);margin-top:7px;line-height:1.5}
.srf-project .swatches{display:flex;gap:7px;margin-top:9px}
.srf-project .sw{width:26px;height:26px;border-radius:7px;border:1px solid rgba(255,255,255,.08)}
.srf-project .field.empty{border-style:dashed;background:transparent}
.srf-project .field.empty .val{color:var(--ink-dim)}
.srf-project .field.empty .cta{margin-top:9px;display:inline-block;font-size:12px;color:var(--lime);border:1px solid #3a4a12;background:#20260c;border-radius:8px;padding:6px 11px;cursor:pointer;transition:filter .12s}
.srf-project .field.empty .cta:hover{filter:brightness(1.25)}
.srf-project .roadmap{display:flex;gap:10px;margin-top:9px;flex-wrap:wrap}
.srf-project .stg{font-size:11.5px;color:var(--ink-sec);background:#0f1116;border:1px solid var(--edge);border-radius:20px;padding:3px 11px}
.srf-project .stg.done{color:var(--lime);border-color:#3a4a12}
.srf-project .stg.now{color:var(--indigo);border-color:#2c2a55;background:#14122b}
.srf-project .fileshead{display:flex;align-items:center;gap:10px;margin-top:26px;padding-bottom:10px;border-bottom:1px solid var(--edge-soft)}
.srf-project .fcount{font-family:var(--mono);font-size:11px;color:var(--ink-faint)}
.srf-project .fnew{margin-left:auto;font-size:12px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:8px;padding:5px 11px;cursor:pointer;white-space:nowrap;transition:border-color .12s}
.srf-project .fnew:hover{border-color:var(--indigo)}
.srf-project .frows{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.srf-project .frow{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--edge);border-radius:11px;padding:11px 15px;cursor:pointer;transition:border-color .12s,background .12s}
.srf-project .frow:hover{border-color:var(--edge-soft);background:linear-gradient(180deg,#15131f,#121319)}
.srf-project .frow.sel{border-color:var(--lime)}
.srf-project .frow .fic{color:var(--ink-faint);font-family:var(--mono);flex:0 0 auto}
.srf-project .frow .fmain{flex:1;min-width:0}
.srf-project .frow .ft{font-size:13px;color:var(--ink)}
.srf-project .frow .fnote{font-size:11.5px;color:var(--ink-dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srf-project .frow .fkind{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-dim);background:#0f1116;border:1px solid var(--edge);border-radius:20px;padding:2px 9px;flex:0 0 auto}
.srf-project .frow .fsrc{font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);flex:0 0 auto;width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srf-project .frow .fupd{font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);flex:0 0 auto;width:34px;text-align:right}
.srf-project .fempty{margin-top:14px;padding:26px;text-align:center;font-size:13px;color:var(--ink-dim);border:1px dashed var(--edge);border-radius:14px;background:linear-gradient(180deg,#0e0f14,#0b0c11)}
.srf-project .fempty .cta{color:var(--lime);cursor:pointer}
.srf-project .pempty{margin-top:60px;padding:40px;text-align:center;border:1px dashed var(--edge);border-radius:16px;background:linear-gradient(180deg,#0e0f14,#0b0c11)}
.srf-project .pe-ic{font-size:26px;color:var(--ink-faint)}
.srf-project .pempty h1{font-size:19px;font-weight:600;margin:10px 0 6px}
.srf-project .pempty p{font-size:13px;color:var(--ink-dim);max-width:440px;margin:0 auto}
.srf-project .pe-sub{margin-top:6px;color:var(--ink-faint)}
.srf-project .picker{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:20px}
.srf-project .pchip{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--edge);border-radius:11px;padding:7px 12px;font-size:13px;color:var(--ink-sec);cursor:pointer;transition:border-color .12s,color .12s}
.srf-project .pchip:hover{border-color:var(--edge-soft);color:var(--ink)}
.srf-project .pchip .d{width:8px;height:8px;border-radius:50%}
.srf-project.skel .ph{background:linear-gradient(90deg,var(--panel),var(--raised,#1a1c22),var(--panel));background-size:200% 100%;animation:srfProjectPulse 1.3s ease-in-out infinite;border-radius:8px}
.srf-project.skel .markph{width:52px;height:52px;border-radius:13px;flex:0 0 auto}
.srf-project.skel .line{height:13px;margin-top:6px}
.srf-project.skel .line.w1{width:160px}
.srf-project.skel .line.w2{width:260px}
.srf-project.skel .line.w3{width:90px}
.srf-project.skel .card{height:76px}
.srf-project.skel .row{height:44px;margin-bottom:8px;border-radius:11px}
@keyframes srfProjectPulse{0%{background-position:200% 0}100%{background-position:-200% 0}}
`;
