// Graph surface — how the vault connects. Inline SVG with FIXED, precomputed
// node positions (no live force sim). Click a node to focus it in the inspector.
// Ported from wf-graph.html. Self-contained ES module: render/css/wire.

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Local sample: fixed-layout nodes + edges (real Bank graph reads later).
const SAMPLE = {
  center: { x: 300, y: 255 },
  nodes: [
    { id: "proj", x: 300, y: 255, r: 24, c: "#5b4fe8", label: "IndEur Club", kind: "project", hub: true, links: 12, artifacts: 23, notes: 14,
      neighbors: [["Switch-ligature mark", "#E0764A", "produced-by"], ["Meetup notes", "#A8D84A", "member"], ["Terracotta beam", "#9B5DE5", "produced-by"], ['"diaspora"', "#5b4fe8", "mentions"]] },
    { id: "mark", x: 150, y: 130, r: 15, c: "#E0764A", label: "Switch mark", kind: "artifact · mark",
      neighbors: [["IndEur Club", "#5b4fe8", "produced-for"], ["4 marks", "#E0764A", "sibling"]] },
    { id: "gallery", x: 110, y: 250, r: 13, c: "#E0764A", label: "4 marks", kind: "artifact · gallery",
      neighbors: [["Switch mark", "#E0764A", "sibling"], ["IndEur Club", "#5b4fe8", "produced-for"]] },
    { id: "beam", x: 170, y: 380, r: 14, c: "#9B5DE5", label: "Terracotta beam", kind: "artifact · image",
      neighbors: [["IndEur Club", "#5b4fe8", "produced-for"]] },
    { id: "note1", x: 330, y: 95, r: 12, c: "#A8D84A", label: "Meetup notes", kind: "note",
      neighbors: [["IndEur Club", "#5b4fe8", "member"], ['"diaspora"', "#5b4fe8", "defines"]] },
    { id: "note2", x: 470, y: 140, r: 11, c: "#A8D84A", label: "Pricing note", kind: "note",
      neighbors: [["IndEur Club", "#5b4fe8", "member"], ["8 more", "#8a93a6", "cluster"]] },
    { id: "ad", x: 490, y: 270, r: 14, c: "#F2994A", label: "Launch ad", kind: "run · AdForge",
      neighbors: [["IndEur Club", "#5b4fe8", "produced-for"]] },
    { id: "thesis", x: 470, y: 400, r: 13, c: "#4A90E0", label: "Thesis", kind: "doc · ideabrain",
      neighbors: [["IndEur Club", "#5b4fe8", "member"]] },
    { id: "term", x: 300, y: 430, r: 10, c: "#5b4fe8", label: '"diaspora"', kind: "term", dim: true,
      neighbors: [["IndEur Club", "#5b4fe8", "mentioned-in"], ["Meetup notes", "#A8D84A", "defined-in"]] },
    { id: "run", x: 250, y: 395, r: 9, c: "#F2994A", label: "God run", kind: "run · God",
      neighbors: [["IndEur Club", "#5b4fe8", "ran-on"]] },
    { id: "more", x: 560, y: 200, r: 16, c: "#2b2f3a", label: "8 more", kind: "cluster", cluster: true, neighbors: [] },
  ],
  edges: [["proj", "mark"], ["proj", "gallery"], ["proj", "beam"], ["proj", "note1"], ["proj", "note2"], ["proj", "ad"], ["proj", "thesis"], ["proj", "term"], ["proj", "run"], ["note2", "more"], ["ad", "more"], ["gallery", "mark"]],
};

function svgMarkup(focusId) {
  const byId = {};
  SAMPLE.nodes.forEach((n) => (byId[n.id] = n));
  let svg = "";
  SAMPLE.edges.forEach((e) => {
    const a = byId[e[0]], b = byId[e[1]];
    const hot = e[0] === focusId || e[1] === focusId;
    svg += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + (hot ? "#5b4fe8" : "#242833") + '" stroke-width="' + (hot ? 1.8 : 1.3) + '"/>';
  });
  SAMPLE.nodes.forEach((n) => {
    const op = n.dim ? 0.5 : 1;
    const focused = n.id === focusId;
    if (n.cluster) {
      svg += '<g class="gnode" data-node="' + n.id + '" style="cursor:pointer">';
      svg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + n.r + '" fill="#14161c" stroke="#33384a" stroke-width="1.3" stroke-dasharray="3 3"/>';
      svg += '<text x="' + n.x + '" y="' + (n.y + 4) + '" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="10" fill="#8a93a6">' + esc(n.label) + '</text></g>';
      return;
    }
    svg += '<g class="gnode" data-node="' + n.id + '" style="cursor:pointer">';
    if (n.hub) svg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (n.r + 7) + '" fill="none" stroke="#5b4fe8" stroke-width="1" opacity="0.35"/>';
    svg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + n.r + '" fill="' + n.c + '" opacity="' + op + '" stroke="#08090c" stroke-width="2"/>';
    if (n.hub || focused) svg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + n.r + '" fill="none" stroke="#c8f250" stroke-width="1.5" opacity="0.9"/>';
    const ly = n.y + n.r + 14;
    svg += '<text x="' + n.x + '" y="' + ly + '" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="' + (n.hub || focused ? "#e8edf4" : "#b4bece") + '" opacity="' + op + '">' + esc(n.label) + '</text></g>';
  });
  return svg;
}

// mark for the inspector head (small iso hint)
function inspectorHTML(n) {
  let h = '<div class="ilbl">Inspector</div>';
  h += '<div class="imark"><div class="d" style="color:' + n.c + '">◈</div>'
    + '<div><div class="inm">' + esc(n.label) + '</div><div class="ikind">' + esc(n.kind) + '</div></div></div>';
  if (n.hub) {
    h += '<div class="stat"><span>Links</span><b>' + n.links + '</b></div>'
      + '<div class="stat"><span>Artifacts</span><b>' + n.artifacts + '</b></div>'
      + '<div class="stat"><span>Notes</span><b>' + n.notes + '</b></div>';
  } else {
    h += '<div class="stat"><span>Neighbors</span><b>' + n.neighbors.length + '</b></div>';
  }
  h += '<div class="ilbl" style="margin-top:16px">Neighbors</div><div class="links">';
  if (n.neighbors.length) {
    h += n.neighbors.map((nb) => '<div class="lk"><span class="dot" style="background:' + nb[1] + '"></span>' + esc(nb[0]) + '<span class="rel">' + esc(nb[2]) + '</span></div>').join("");
  } else {
    h += '<div class="lk" style="color:var(--ink-faint)">no neighbors yet</div>';
  }
  h += '</div><div class="open">Open in Bank ▸</div>';
  return h;
}

export function render(DATA) {
  const empty = !SAMPLE.nodes.length;
  let h = '<div class="srf-graph">';
  h += '<div class="ghead"><span class="kick">Graph</span><h1>How it connects</h1>'
    + '<span class="scope">◐ IndEur Club</span>'
    + '<div class="showbar">'
    + '<div class="tgl on" style="color:var(--indigo)"><span class="bx"></span>projects</div>'
    + '<div class="tgl on" style="color:#A8D84A"><span class="bx"></span>notes</div>'
    + '<div class="tgl on" style="color:#E0764A"><span class="bx"></span>artifacts</div>'
    + '<div class="tgl off"><span class="bx"></span>terms</div>'
    + '<div class="tgl list">☰ List view</div></div></div>';

  if (empty) {
    h += '<div class="gempty">Nothing to graph yet — establish a project and its notes, artifacts and terms will connect here.</div>';
  } else {
    h += '<div class="stage"><div class="canvas">'
      + '<svg viewBox="0 0 640 520" data-g xmlns="http://www.w3.org/2000/svg">' + svgMarkup("proj") + '</svg>'
      + '<div class="canvaschrome"><span>⊙ zoom</span><span>⊹ fit</span><span>◐ focus active</span></div></div>'
      + '<div class="insp" data-insp>' + inspectorHTML(SAMPLE.nodes[0]) + '</div></div>';

    h += '<div class="legend">'
      + '<span><span class="k" style="background:var(--indigo)"></span>project</span>'
      + '<span><span class="k" style="background:#A8D84A"></span>note</span>'
      + '<span><span class="k" style="background:#E0764A"></span>artifact · mark</span>'
      + '<span><span class="k" style="background:#9B5DE5"></span>artifact · image</span>'
      + '<span><span class="k" style="background:#F2994A"></span>run</span>'
      + '<span><span class="k" style="background:#5b4fe8;opacity:.6"></span>term (off)</span></div>';
  }
  h += '</div>';
  return h;
}

export function wire(root) {
  const g = root.querySelector(".srf-graph [data-g]");
  const insp = root.querySelector(".srf-graph [data-insp]");
  if (!g || !insp) return;
  const byId = {};
  SAMPLE.nodes.forEach((n) => (byId[n.id] = n));
  g.addEventListener("click", (e) => {
    const node = e.target.closest(".gnode");
    if (!node) return;
    const id = node.getAttribute("data-node");
    const n = byId[id];
    if (!n || n.cluster) return;
    g.innerHTML = svgMarkup(id);
    insp.innerHTML = inspectorHTML(n);
  });
}

export const css = `
.srf-graph{padding-top:10px}
.srf-graph .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-graph .ghead{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.srf-graph .ghead h1{font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-.02em;margin:0}
.srf-graph .scope{font-size:12px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:8px;padding:4px 10px}
.srf-graph .showbar{margin-left:auto;display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.srf-graph .tgl{font-size:12px;color:var(--ink-sec);background:var(--panel);border:1px solid var(--edge);border-radius:8px;padding:5px 10px;cursor:pointer;display:flex;align-items:center;gap:7px}
.srf-graph .tgl .bx{width:12px;height:12px;border-radius:3px;border:1px solid var(--edge-soft)}
.srf-graph .tgl.on .bx{background:currentColor;border-color:currentColor}
.srf-graph .tgl.off{color:var(--ink-faint)}
.srf-graph .tgl.list{color:var(--ink-dim);border-style:dashed}
.srf-graph .stage{display:grid;grid-template-columns:1fr 236px;gap:0;margin-top:16px;border:1px solid var(--edge);border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#0b0c11,#090a0e)}
.srf-graph .canvas{position:relative;min-height:520px;border-right:1px solid var(--edge-soft)}
.srf-graph .canvas svg{display:block;width:100%;height:520px}
.srf-graph .canvaschrome{position:absolute;left:14px;bottom:12px;display:flex;gap:8px;font-family:var(--mono);font-size:11px;color:var(--ink-faint)}
.srf-graph .canvaschrome span{background:rgba(15,17,22,.8);border:1px solid var(--edge);border-radius:7px;padding:4px 9px;cursor:pointer}
.srf-graph .insp{padding:18px 18px}
.srf-graph .insp .ilbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint)}
.srf-graph .insp .imark{display:flex;align-items:center;gap:11px;margin-top:14px}
.srf-graph .insp .imark .d{width:30px;height:30px;border-radius:9px;background:#1b1a2e;border:1px solid #2c2a55;display:grid;place-items:center;font-size:14px}
.srf-graph .insp .inm{font-size:15px;font-weight:600}
.srf-graph .insp .ikind{font-size:12px;color:var(--ink-dim)}
.srf-graph .insp .stat{margin-top:16px;font-size:12.5px;color:var(--ink-sec);display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--edge-soft)}
.srf-graph .insp .stat b{color:var(--ink);font-weight:500}
.srf-graph .insp .links{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.srf-graph .insp .lk{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-sec)}
.srf-graph .insp .lk .dot{width:8px;height:8px;border-radius:3px}
.srf-graph .insp .lk .rel{margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--ink-faint)}
.srf-graph .insp .open{margin-top:18px;text-align:center;font-size:12.5px;color:#0c0d10;background:var(--lime);font-weight:600;border-radius:9px;padding:9px;cursor:pointer}
.srf-graph .legend{display:flex;gap:16px;margin-top:14px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-dim)}
.srf-graph .legend span{display:flex;align-items:center;gap:7px}
.srf-graph .legend .k{width:10px;height:10px;border-radius:3px}
.srf-graph .gempty{margin-top:40px;padding:34px;text-align:center;font-size:13px;color:var(--ink-dim);border:1px dashed var(--edge);border-radius:14px;background:linear-gradient(180deg,#0e0f14,#0b0c11)}
`;
