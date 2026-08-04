// Switchboard OS surface — Apps.
// The installed-tools dock: vibrant isometric tiles grouped Pinned / Studios /
// Tools & Agents / Fun. One deterministic hue per app id (color-in-the-icons),
// a live dot for a running app, and a "God can drive" badge for a granted hand.
// A Store door sits at the foot — the one path to discovery.
//
// Self-contained ES module: exports render(DATA), css, wire(root).
// The iso-tile + hue helpers mirror os.js (isoTile / hueForId) so the dock reads
// identical to the Home dock; inlined here to keep the module standalone.

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ---- deterministic per-app hue (ported from os.js hueForId/hexForId) ----
function hueForId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
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

// ---- vibrant isometric app tile (ported from os.js isoTile) ----
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
function tileSvg(hue, px) { const s = px || 48; return '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" xmlns="http://www.w3.org/2000/svg">' + isoTile(hue, 32, 40) + "</svg>"; }

// ---------------------------------------------------------------------------
// SAMPLE catalog — the fallback when DATA.apps is thin. Each app: id, cat, and
// flags. live = running now; god = a granted hand God can drive; pinned = dock.
// ---------------------------------------------------------------------------
const SAMPLE = [
  { id: "brandbrain", cat: "studio", live: 1, god: 1, pinned: 1 },
  { id: "Crest", cat: "studio", live: 1, god: 1, pinned: 1 },
  { id: "ideabrain", cat: "studio", god: 1 },
  { id: "Prism", cat: "tool", god: 1 },
  { id: "Bank", cat: "tool", god: 1, pinned: 1 },
  { id: "Redline", cat: "tool", god: 1, pinned: 1 },
  { id: "AdPulse", cat: "tool" },
  { id: "God", cat: "agent", live: 1, pinned: 1 },
  { id: "Autopilot", cat: "agent", god: 1 },
  { id: "Sidequest", cat: "fun" },
];

// os.js DATA.apps is a thin list ({id, live}); enrich it against SAMPLE so the
// grouped dock still reads right when driven by real workspace data.
function resolveApps(DATA) {
  const raw = (DATA && DATA.apps) || [];
  if (!raw.length) return SAMPLE;
  const byId = Object.fromEntries(SAMPLE.map((a) => [a.id.toLowerCase(), a]));
  return raw.map((a) => {
    const seed = byId[String(a.id).toLowerCase()] || {};
    return { id: a.id, cat: a.cat || seed.cat || "tool", live: a.live || seed.live, god: a.god != null ? a.god : seed.god, pinned: a.pinned != null ? a.pinned : seed.pinned };
  });
}

function tile(a) {
  return '<div class="app" data-app="' + esc(a.id) + '"><div class="tile">' + tileSvg(hexForId(a.id))
    + (a.live ? '<span class="live"></span>' : "")
    + (a.god ? '<span class="god"><span class="gd"></span>God</span>' : "")
    + '</div><div class="nm">' + esc(a.id) + '</div><div class="cat">' + esc(a.cat) + "</div></div>";
}

function group(title, apps, note) {
  if (!apps.length) return "";
  return '<div class="grouphd"><span class="kick">' + esc(title) + '</span><span class="c">' + esc(note != null ? note : String(apps.length)) + "</span></div>"
    + '<div class="apps">' + apps.map(tile).join("") + "</div>";
}

export function render(DATA) {
  const apps = resolveApps(DATA);
  const pinned = apps.filter((a) => a.pinned);
  const studios = apps.filter((a) => a.cat === "studio");
  const tools = apps.filter((a) => a.cat === "tool" || a.cat === "agent");
  const fun = apps.filter((a) => a.cat === "fun");

  const head = '<div class="shead"><span class="kick">Apps</span><h1>Your installed tools</h1>'
    + '<span class="n">' + apps.length + " installed</span>"
    + '<div class="filters"><div class="seg"><span class="on">All</span><span>Studios</span><span>Tools</span><span>Fun</span><span>Agents</span></div>'
    + '<div class="srch">⌕</div></div></div>';

  const legend = '<div class="legend">'
    + '<span class="l"><span class="dl lime"></span>live now</span>'
    + '<span class="l"><span class="dl ind"></span>God can drive (a granted hand)</span>'
    + '<span class="l" style="color:var(--ink-faint)">click a tile to launch · drag to reorder pinned</span></div>';

  let body;
  if (!apps.length) {
    body = '<div class="empty"><div class="eyebrow">no tools installed yet</div>'
      + "<p>Your dock is empty. The Store is the one door to discovery — every tool shows its resource profile before you Get it.</p></div>";
  } else {
    body = group("Pinned", pinned, "drives the Home dock order")
      + group("Studios", studios)
      + group("Tools & Agents", tools)
      + group("Fun", fun);
  }

  const door = '<div class="footdoor" data-store="1"><div class="p">+</div>'
    + '<div class="tx"><b>Get more apps in the Store</b>'
    + "<div>the one door to discovery — featured, shelves, and the resource profile before you Get</div></div>"
    + '<div class="go">▸</div></div>';

  return '<div class="srf-apps">' + head + legend + body + door + "</div>";
}

export function wire(root) {
  const el = root.querySelector(".srf-apps");
  if (!el) return;
  el.addEventListener("click", (e) => {
    const seg = e.target.closest(".seg span");
    if (seg) {
      seg.parentElement.querySelectorAll("span").forEach((s) => s.classList.remove("on"));
      seg.classList.add("on");
      const f = seg.textContent.trim().toLowerCase();
      el.querySelectorAll(".grouphd, .apps").forEach((n) => (n.style.display = ""));
      if (f !== "all") {
        // Studios/Tools/Fun/Agents filter — hide the groups that don't match.
        el.querySelectorAll(".app").forEach((app) => {
          const cat = (app.querySelector(".cat") || {}).textContent || "";
          const match = f === "tools" ? (cat === "tool" || cat === "agent")
            : f === "agents" ? cat === "agent"
            : cat === f.replace(/s$/, "");
          app.style.display = match ? "" : "none";
        });
      } else {
        el.querySelectorAll(".app").forEach((app) => (app.style.display = ""));
      }
      return;
    }
    // Store door → let os.js router/anchor handle real navigation; expose intent.
    const door = e.target.closest(".footdoor");
    if (door) { location.hash = "#/store"; }
  });
}

export const css = `
.srf-apps{
  --panel:#14161c; --raised:#1b1e26; --edge:#242833; --edge-soft:#1a1d25;
  --ink:#e8edf4; --ink-sec:#b4bece; --ink-dim:#8a93a6; --ink-faint:#5c6474;
  --lime:#c8f250; --indigo:#5b4fe8;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
}
.srf-apps .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-apps .shead{display:flex;align-items:center;gap:14px;margin:10px 0 6px}
.srf-apps .shead h1{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0}
.srf-apps .shead .n{font-family:var(--mono);font-size:11px;color:var(--ink-dim);border:1px solid var(--edge);border-radius:20px;padding:2px 10px}
.srf-apps .filters{margin-left:auto;display:flex;gap:6px;align-items:center}
.srf-apps .seg{display:flex;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-apps .seg span{font-size:12px;padding:4px 11px;border-radius:7px;color:var(--ink-dim);cursor:pointer}
.srf-apps .seg span.on{background:var(--raised);color:var(--ink)}
.srf-apps .srch{width:30px;height:30px;border-radius:8px;border:1px solid var(--edge);background:var(--panel);display:grid;place-items:center;color:var(--ink-dim);font-size:13px}
.srf-apps .legend{display:flex;gap:16px;margin:6px 0 0 0;font-size:11px;color:var(--ink-dim);align-items:center;flex-wrap:wrap}
.srf-apps .legend .l{display:flex;align-items:center;gap:6px}
.srf-apps .legend .dl{width:6px;height:6px;border-radius:50%}
.srf-apps .dl.lime{background:var(--lime)}
.srf-apps .dl.ind{background:var(--indigo)}
.srf-apps .grouphd{display:flex;align-items:baseline;gap:10px;margin:26px 0 14px}
.srf-apps .grouphd .c{font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-apps .apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:18px}
.srf-apps .app{text-align:center;cursor:pointer;position:relative}
.srf-apps .app .tile{width:76px;height:76px;margin:0 auto;border-radius:19px;display:grid;place-items:center;position:relative;background:linear-gradient(160deg,#15161d,#0d0e13);border:1px solid #1e222c}
.srf-apps .app .nm{font-size:12.5px;color:var(--ink-sec);margin-top:9px;font-weight:500}
.srf-apps .app .cat{font-size:10px;color:var(--ink-faint);font-family:var(--mono);margin-top:2px}
.srf-apps .app .live{position:absolute;top:9px;right:13px;width:6px;height:6px;border-radius:50%;background:var(--lime);box-shadow:0 0 6px 1px rgba(200,242,80,.6)}
.srf-apps .app .god{position:absolute;bottom:9px;left:13px;display:flex;align-items:center;gap:3px;font-size:8.5px;font-family:var(--mono);color:#bcb4ff;background:rgba(23,22,51,.85);border:1px solid #2c2a55;border-radius:5px;padding:1px 4px}
.srf-apps .app .god .gd{width:5px;height:5px;border-radius:50%;background:var(--indigo);box-shadow:0 0 5px 1px rgba(91,79,232,.7)}
.srf-apps .footdoor{margin-top:30px;border:1px solid var(--edge);border-radius:14px;padding:16px 18px;display:flex;align-items:center;gap:13px;background:linear-gradient(180deg,#101218,#0d0e13);cursor:pointer}
.srf-apps .footdoor .p{width:34px;height:34px;border-radius:10px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--lime);font-size:18px;flex:0 0 auto}
.srf-apps .footdoor .tx b{color:var(--ink);font-weight:600;font-size:13.5px}
.srf-apps .footdoor .tx div{color:var(--ink-dim);font-size:12px}
.srf-apps .footdoor .go{margin-left:auto;color:var(--ink-dim);font-size:16px}
.srf-apps .empty{border:1px solid var(--edge-soft);border-radius:16px;padding:34px;text-align:center;background:linear-gradient(180deg,#101218,#0d0e13);margin-top:18px}
.srf-apps .empty .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint)}
.srf-apps .empty p{color:var(--ink-dim);font-size:13px;max-width:440px;margin:10px auto 0}
`;
