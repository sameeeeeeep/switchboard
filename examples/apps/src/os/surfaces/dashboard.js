// Dashboard surface — the state of the machine, not your work.
// Every tile is a door, not a dead number; a red tile always names the action.
// Ported from wf-dashboard.html. SAMPLE holds stats + sparkline arrays (later a Bank/daemon read).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const SAMPLE = {
  tiles: [
    { k: "Projects", big: "4", sub: "1 stalled", drill: "bank", spark: { kind: "line", data: [3, 3, 4, 4, 4, 4, 4], color: "#8a93a6" } },
    { k: "Routines", big: "3", sub: "active · next 08:00", drill: "routines", spark: { kind: "line", data: [2, 3, 3, 2, 3, 3, 3], color: "#8a93a6" } },
    { k: "Workflows", big: "12", subHtml: '<span class="ok">✓10</span> &nbsp;<span class="bad">✗2</span>', drill: "workflows", spark: { kind: "bars", data: [2, 1, 3, 2, 1, 2, 1], color: "#8a93a6" } },
    { k: "Usage", bigHtml: '4.2M<span class="of"> /8M</span>', sub: "tokens · 53% of budget", drill: "settings", spark: { kind: "bars", data: [3, 5, 4, 6, 5, 7, 6], color: "#c8f250" } },
    { k: "Needs attention", big: "5", sub: "2 blocking", drill: "needs", alert: 1, spark: { kind: "line", data: [0, 1, 1, 2, 3, 4, 5], color: "#ff5a6e" } },
  ],
  routines: [
    { ic: "⟳", cls: "ok", nm: "Daily brief", st: "next 08:00", mark: '<span class="ok">✓</span>' },
    { ic: "⟳", cls: "runn", nm: "Email triage", st: "running…", stCls: "runn", mark: '<span class="dotg" style="background:var(--indigo)"></span>' },
    { ic: "⟳", cls: "ok", nm: "IndEur social recap", st: "next Fri", mark: '<span class="ok">✓</span>' },
    { ic: "⟳", cls: "muted", nm: "Weekly deck", nmMuted: 1, st: "paused" },
  ],
  runs: [
    { ic: "✓", cls: "ok", nm: "CopyFlow — launch emails", st: "14:02" },
    { ic: "✗", cls: "bad", nm: "Sheet sync", st: "11:40", pill: "Retry" },
    { ic: "✓", cls: "ok", nm: "Autopilot slate", st: "09:15" },
    { ic: "✓", cls: "ok", nm: "Prism — beam render", st: "08:41" },
  ],
  health: [
    { dot: "var(--lime)", label: "daemon" },
    { dot: "var(--lime)", label: "cloud model" },
    { dot: "var(--lime)", label: "3 connectors" },
  ],
  healthAlert: { nm: "Granola connector needs reconnect" },
  activity: [
    { ic: "↻", nm: "14:22 · Prism image made" },
    { ic: "⟳", nm: "08:00 · Daily brief delivered" },
    { ic: "↻", nm: "Yesterday · 4 marks generated in Crest" },
  ],
};

// inline SVG sparkline / bars — no runtime script needed
function sparkSvg(sp) {
  const w = 118, h = 30, data = sp.data;
  if (sp.kind === "bars") {
    const bw = w / data.length, max = Math.max(...data);
    const rects = data.map((v, i) => {
      const bh = (v / max) * (h - 3);
      return '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1" fill="' + sp.color + '" opacity=".8"/>';
    }).join("");
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' + rects + "</svg>";
  }
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / ((max - min) || 1)) * (h - 4) - 2;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '"><polyline points="' + pts + '" fill="none" stroke="' + sp.color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>';
}

function tile(t) {
  const big = t.bigHtml || esc(t.big);
  const sub = t.subHtml || (t.sub ? esc(t.sub) : "");
  return '<div class="tile' + (t.alert ? " alert" : "") + '" data-drill="' + esc(t.drill) + '">'
    + '<div class="k">' + esc(t.k) + "</div>"
    + '<div class="big">' + big + "</div>"
    + '<div class="sub">' + sub + "</div>"
    + '<div class="spark">' + sparkSvg(t.spark) + "</div>"
    + '<div class="drill">→ ' + esc(t.drill.charAt(0).toUpperCase() + t.drill.slice(1)) + "</div></div>";
}

function lrow(r) {
  return '<div class="lrow">'
    + '<span class="ic ' + (r.cls || "") + '">' + esc(r.ic) + "</span>"
    + '<span class="nm' + (r.nmMuted ? " muted" : "") + '">' + esc(r.nm) + "</span>"
    + (r.st ? '<span class="st ' + (r.stCls || "") + '">' + esc(r.st) + "</span>" : "")
    + (r.pill ? '<span class="pill retry" data-retry>' + esc(r.pill) + "</span>" : "")
    + (r.mark || "") + "</div>";
}

export function render(DATA) {
  const routines = SAMPLE.routines.map(lrow).join("");
  const runs = SAMPLE.runs.map(lrow).join("");
  const activity = SAMPLE.activity.map((a) => '<div class="lrow"><span class="ic faint">' + esc(a.ic) + '</span><span class="nm">' + esc(a.nm) + "</span></div>").join("");
  const health = SAMPLE.health.map((hh) => '<span class="hitem"><span class="dotg" style="background:' + hh.dot + '"></span> ' + esc(hh.label) + "</span>").join("");

  return '<div class="srf-dashboard"><main>'
    + '<div class="shd">'
    + '<span class="kk">◦ Dashboard · <b>everything</b></span>'
    + '<div class="seg"><span data-range="today">Today</span><span class="on" data-range="7d">7d</span><span data-range="30d">30d</span></div>'
    + "</div>"
    + '<div class="tiles">' + SAMPLE.tiles.map(tile).join("") + "</div>"
    + '<div class="cols">'
    + '<div class="pane"><div class="ph"><span class="t">Routines — running / next fire</span><span class="more" data-drill="routines">→ Routines</span></div>' + routines + "</div>"
    + '<div class="pane"><div class="ph"><span class="t">Recent runs — pass / fail</span><span class="more" data-drill="workflows">→ Workflows</span></div>' + runs + "</div>"
    + "</div>"
    + '<div class="cols">'
    + '<div class="pane"><div class="ph"><span class="t">Subsystem health</span></div><div class="health">' + health + "</div>"
    + '<div class="lrow ht"><span class="ic bad">◐</span><span class="nm">' + esc(SAMPLE.healthAlert.nm) + '</span><span class="fix" data-drill="needs">→ fix</span></div></div>'
    + '<div class="pane"><div class="ph"><span class="t">Activity feed</span><span class="more" data-drill="history">→ History</span></div>' + activity + "</div>"
    + "</div>"
    + '<div class="foot">dashboard is the state of the machine, not your work · every tile is a door, not a dead number · a red tile always names the action</div>'
    + "</main></div>";
}

export function wire(root) {
  const surf = root.querySelector(".srf-dashboard");
  if (!surf) return;
  surf.addEventListener("click", (e) => {
    const seg = e.target.closest(".seg span[data-range]");
    if (seg) {
      surf.querySelectorAll(".seg span").forEach((s) => s.classList.toggle("on", s === seg));
      console.log("[dashboard] range →", seg.getAttribute("data-range"));
      return;
    }
    const retry = e.target.closest("[data-retry]");
    if (retry) {
      retry.textContent = "Retrying…";
      retry.classList.add("busy");
      console.log("[dashboard] retry run");
      return;
    }
    const drill = e.target.closest("[data-drill]");
    if (drill) { const r = drill.getAttribute("data-drill"); console.log("[dashboard] drill →", r); location.hash = "#/" + r; }
  });
}

export const css = `<style>
.srf-dashboard main{padding:6px clamp(18px,4vw,44px) 0}
.srf-dashboard .shd{display:flex;align-items:center;gap:12px;margin-top:6px;padding-bottom:14px;border-bottom:1px solid var(--edge-soft)}
.srf-dashboard .kk{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim)}
.srf-dashboard .kk b{color:var(--ink)}
.srf-dashboard .seg{margin-left:auto;display:flex;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-dashboard .seg span{font-size:12px;color:var(--ink-dim);padding:4px 11px;border-radius:7px;cursor:pointer}
.srf-dashboard .seg span.on{background:var(--raised);color:var(--ink)}
.srf-dashboard .tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:20px}
.srf-dashboard .tile{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:14px 15px;cursor:pointer;display:flex;flex-direction:column;min-height:128px}
.srf-dashboard .tile .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.srf-dashboard .tile .big{font-size:32px;font-weight:600;letter-spacing:-.02em;line-height:1.1;margin-top:6px}
.srf-dashboard .tile .big .of{font-size:15px;color:var(--ink-dim)}
.srf-dashboard .tile .sub{font-size:11.5px;color:var(--ink-dim);margin-top:2px}
.srf-dashboard .tile .spark{margin-top:auto;padding-top:10px}
.srf-dashboard .tile .drill{font-family:var(--mono);font-size:9.5px;color:var(--ink-faint);margin-top:8px}
.srf-dashboard .tile.alert{border-color:#3a2230;background:linear-gradient(180deg,#1a1216,#141016)}
.srf-dashboard .tile.alert .big{color:var(--danger)}
.srf-dashboard .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.srf-dashboard .pane{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:14px 16px}
.srf-dashboard .pane .ph{display:flex;align-items:center;margin-bottom:10px}
.srf-dashboard .pane .ph .t{font-size:12.5px;font-weight:600}
.srf-dashboard .pane .ph .more{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--ink-faint);cursor:pointer}
.srf-dashboard .lrow{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--edge-soft);font-size:13px}
.srf-dashboard .lrow:first-of-type,.srf-dashboard .health+.lrow.ht{border-top:0}
.srf-dashboard .lrow .ic{width:16px;text-align:center;flex:0 0 auto;font-family:var(--mono);font-size:12px}
.srf-dashboard .lrow .ic.faint{color:var(--ink-faint)}
.srf-dashboard .lrow .nm{color:var(--ink-sec)}
.srf-dashboard .lrow .nm.muted{color:var(--ink-dim)}
.srf-dashboard .lrow .st{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink-dim)}
.srf-dashboard .lrow .st.runn{color:var(--indigo)}
.srf-dashboard .pill{font-family:var(--mono);font-size:10px;border-radius:20px;padding:1px 8px;border:1px solid var(--edge);color:var(--ink-dim);cursor:pointer}
.srf-dashboard .pill.retry{color:var(--lime);border-color:#3a4a12;background:#20260c}
.srf-dashboard .pill.busy{color:var(--ink-dim);opacity:.7}
.srf-dashboard .ok{color:var(--lime)} .srf-dashboard .bad{color:var(--danger)} .srf-dashboard .runn{color:var(--indigo)}
.srf-dashboard .ic.ok{color:var(--lime)} .srf-dashboard .ic.bad{color:var(--danger)} .srf-dashboard .ic.runn{color:var(--indigo)} .srf-dashboard .ic.muted{color:var(--ink-faint)}
.srf-dashboard .dotg{width:7px;height:7px;border-radius:50%;display:inline-block}
.srf-dashboard .health{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin-bottom:6px}
.srf-dashboard .hitem{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-sec)}
.srf-dashboard .fix{font-family:var(--mono);font-size:10px;color:var(--lime);border:1px solid #3a4a12;background:#20260c;border-radius:20px;padding:1px 8px;margin-left:auto;cursor:pointer}
.srf-dashboard .foot{margin-top:34px;color:var(--ink-faint);font-size:11.5px;font-family:var(--mono)}
</style>`;
