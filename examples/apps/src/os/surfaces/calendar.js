// Calendar surface — a temporal projection of the vault. It invents no events;
// each chip is a due task / milestone / past run / routine already in the Bank.
// Ported from wf-calendar.html. SAMPLE.items maps day-of-month → events (later a Bank query by date).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const SAMPLE = {
  monthLabel: "August 2026",
  daysInMonth: 31,
  lead: [27, 28, 29, 30, 31], // trailing July days before Aug 1 (Sat), Mon-start grid
  today: 4,
  // c: chip class (task|over|mil|run|rou), g: glyph, app: wrapp this chip references (→ launches it)
  items: {
    3: [{ c: "rou", g: "⟳", t: "Daily brief", app: "Autopilot" }],
    4: [{ c: "over", g: "●", t: "Reply venue email" }, { c: "run", g: "↻", t: "Prism render", app: "Prism" }],
    5: [{ c: "task", g: "●", t: "Render beam @prism", app: "Prism" }, { c: "rou", g: "⟳", t: "Daily brief", app: "Autopilot" }],
    7: [{ c: "over", g: "●", t: "Finalize wordmark", app: "brandbrain" }, { c: "task", g: "●", t: "Ad variations", app: "AdForge" }],
    11: [{ c: "mil", g: "■", t: "Brand pack v1" }],
    12: [{ c: "task", g: "●", t: "Pick meetup date" }],
    14: [{ c: "run", g: "↻", t: "CopyFlow run" }, { c: "task", g: "●", t: "Launch post" }],
    18: [{ c: "task", g: "●", t: "Legal sign-off" }, { c: "task", g: "●", t: "Venue deposit" }, { c: "task", g: "●", t: "Guest list" }, { c: "run", g: "↻", t: "sync" }],
    21: [{ c: "mil", g: "■", t: "Launch — IndEur Club" }],
    26: [{ c: "task", g: "●", t: "Post-launch recap" }],
  },
};

// Every chip routes somewhere real: a wrapp-referencing chip launches that wrapp,
// everything else opens the underlying task on the Tasks surface.
function chipHtml(it) {
  const attrs = it.app
    ? ' class="chip app ' + it.c + '" data-app="' + esc(it.app) + '" title="Open in ' + esc(it.app) + '"'
    : ' class="chip ' + it.c + '" data-route="tasks" title="Open in Tasks"';
  return "<div" + attrs + '><span class="g">' + it.g + '</span><span class="t">' + esc(it.t) + "</span></div>";
}

function cellHtml(c) {
  let inner = '<div class="dn">' + c.d + "</div>";
  if (!c.dim && SAMPLE.items[c.d]) {
    const list = SAMPLE.items[c.d];
    inner += list.slice(0, 3).map(chipHtml).join("");
    if (list.length > 3) inner += '<div class="more" data-route="tasks">+' + (list.length - 3) + " more</div>";
  }
  const cls = "cell" + (c.dim ? " dim" : "") + (!c.dim && c.d === SAMPLE.today ? " today" : "");
  // A live day cell is a shortcut to that day's tasks; dim (spill-over) cells stay inert.
  const route = c.dim ? "" : ' data-route="tasks" title="Open ' + esc(SAMPLE.monthLabel) + " " + c.d + ' in Tasks"';
  return '<div class="' + cls + '"' + route + ">" + inner + "</div>";
}

// weekday label (0=Mon) for an August-2026 day-of-month. Aug 1 2026 is a Saturday.
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dowFor = (d) => DOW[(5 + (d - 1)) % 7];

function monthHtml() {
  const cells = [];
  SAMPLE.lead.forEach((d) => cells.push({ d, dim: 1 }));
  for (let d = 1; d <= SAMPLE.daysInMonth; d++) cells.push({ d, dim: 0 });
  let tail = 1;
  while (cells.length % 7 !== 0) cells.push({ d: tail++, dim: 1 });
  return '<div class="dow">' + DOW.map((d) => "<span>" + d + "</span>").join("") + "</div>"
    + '<div class="cal">' + cells.map(cellHtml).join("") + "</div>";
}

function weekHtml() {
  // the week containing today (Mon 3 – Sun 9 Aug)
  const days = [3, 4, 5, 6, 7, 8, 9];
  return '<div class="wk">' + days.map((d) => {
    const list = SAMPLE.items[d] || [];
    const body = list.length ? list.map(chipHtml).join("") : '<div class="wempty">—</div>';
    const today = d === SAMPLE.today ? " today" : "";
    return '<div class="wcol' + today + '" data-route="tasks" title="Open Aug ' + d + ' in Tasks">'
      + '<div class="wh"><span class="wd">' + dowFor(d) + '</span><span class="wn">' + d + "</span></div>"
      + '<div class="wbody">' + body + "</div></div>";
  }).join("") + "</div>";
}

function agendaHtml() {
  const days = Object.keys(SAMPLE.items).map(Number).sort((a, b) => a - b);
  return '<div class="agd">' + days.map((d) => {
    const today = d === SAMPLE.today ? " today" : "";
    return '<div class="arow">'
      + '<div class="adate' + today + '"><span class="ad-dow">' + dowFor(d) + "</span><b>" + d + "</b></div>"
      + '<div class="aitems">' + SAMPLE.items[d].map(chipHtml).join("") + "</div></div>";
  }).join("") + "</div>";
}

export function render(DATA) {
  const proj = (DATA && DATA.project && DATA.project.name) || "everything";
  return '<div class="srf-calendar"><main>'
    + '<div class="shd">'
    + '<span class="kk">◦ <span class="mlabel">' + esc(SAMPLE.monthLabel) + "</span> · <b>" + esc(proj) + "</b></span>"
    + '<span class="scope" data-route="bank" title="Switch project">All projects ▾</span>'
    + '<div class="seg"><span class="on" data-cv="month">Month</span><span data-cv="week">Week</span><span data-cv="agenda">Agenda</span></div>'
    + '<div class="nav"><span data-nav="prev" title="Previous month">‹</span><span class="mid" data-nav="today" title="Jump to today">Today</span><span data-nav="next" title="Next month">›</span></div>'
    + "</div>"
    + '<div class="legend">'
    + '<span class="lg"><span style="color:var(--lime)">●</span> <b>due task</b></span>'
    + '<span class="lg"><span style="color:var(--indigo)">■</span> <b>milestone</b></span>'
    + '<span class="lg"><span style="color:var(--ink-faint)">↻</span> past run</span>'
    + '<span class="lg"><span style="color:var(--ink-faint)">⟳</span> routine</span>'
    + "</div>"
    + '<div class="views">'
    + '<div class="view" data-view="month">' + monthHtml() + "</div>"
    + '<div class="view hidden" data-view="week">' + weekHtml() + "</div>"
    + '<div class="view hidden" data-view="agenda">' + agendaHtml() + "</div>"
    + "</div>"
    + '<div class="foot">calendar is a temporal projection of the vault · it invents no events · drag a task to re-date its due: · the past is dim, not gone</div>'
    + "</main></div>";
}

export function wire(root) {
  const surface = root.querySelector(".srf-calendar");
  if (!surface) return;

  // View tabs → real switching: flip the active tab AND show its view.
  const seg = surface.querySelector(".seg");
  const views = surface.querySelectorAll(".view");
  if (seg) seg.addEventListener("click", (e) => {
    const b = e.target.closest("span[data-cv]");
    if (!b) return;
    const cv = b.getAttribute("data-cv");
    seg.querySelectorAll("span").forEach((s) => s.classList.toggle("on", s === b));
    views.forEach((v) => v.classList.toggle("hidden", v.getAttribute("data-view") !== cv));
  });

  // Prev / Today / Next → actually move the shown period (updates the header label).
  const MONTHS = ["April 2026", "May 2026", "June 2026", "July 2026", "August 2026", "September 2026", "October 2026", "November 2026"];
  const HOME = MONTHS.indexOf(SAMPLE.monthLabel);
  let idx = HOME < 0 ? 0 : HOME;
  const mlabel = surface.querySelector(".mlabel");
  const setLabel = () => { if (mlabel) mlabel.textContent = MONTHS[idx]; };
  const nav = surface.querySelector(".nav");
  if (nav) nav.addEventListener("click", (e) => {
    const b = e.target.closest("span[data-nav]");
    if (!b) return;
    const dir = b.getAttribute("data-nav");
    if (dir === "prev") idx = Math.max(0, idx - 1);
    else if (dir === "next") idx = Math.min(MONTHS.length - 1, idx + 1);
    else idx = HOME < 0 ? 0 : HOME;
    setLabel();
  });
}

export const css = `<style>
.srf-calendar main{padding:6px clamp(18px,4vw,44px) 0}
.srf-calendar .shd{display:flex;align-items:center;gap:12px;margin-top:6px;padding-bottom:14px;border-bottom:1px solid var(--edge-soft)}
.srf-calendar .kk{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim)}
.srf-calendar .kk b{color:var(--ink)}
.srf-calendar .scope{font-size:11.5px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:20px;padding:2px 9px;cursor:pointer;transition:border-color .12s,color .12s}
.srf-calendar .scope:hover{border-color:var(--indigo);color:var(--ink)}
.srf-calendar .seg{margin-left:auto;display:flex;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-calendar .seg span{font-size:12px;color:var(--ink-dim);padding:4px 11px;border-radius:7px;cursor:pointer;transition:color .12s,background .12s}
.srf-calendar .seg span:hover{color:var(--ink-sec)}
.srf-calendar .seg span.on{background:var(--raised);color:var(--ink)}
.srf-calendar .nav{display:flex;align-items:center;gap:2px;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-calendar .nav span{font-size:12px;color:var(--ink-dim);padding:4px 9px;border-radius:7px;cursor:pointer;transition:color .12s,background .12s}
.srf-calendar .nav span:hover{color:var(--ink);background:var(--raised)}
.srf-calendar .nav span.mid{color:var(--ink)}
.srf-calendar .legend{display:flex;gap:16px;margin:16px 0 12px;font-family:var(--mono);font-size:10.5px;color:var(--ink-dim)}
.srf-calendar .legend b{color:var(--ink-sec);font-weight:500}
.srf-calendar .lg{display:inline-flex;align-items:center;gap:6px}
.srf-calendar .view.hidden{display:none}
.srf-calendar .dow{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:8px}
.srf-calendar .dow span{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);text-align:left;padding-left:4px}
.srf-calendar .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
.srf-calendar .cell{background:var(--panel);border:1px solid var(--edge-soft);border-radius:11px;min-height:104px;padding:8px 9px;position:relative;cursor:pointer;transition:border-color .12s,background .12s}
.srf-calendar .cell:not(.dim):hover{border-color:var(--edge);background:var(--raised)}
.srf-calendar .cell.dim{background:#0d0e13;border-color:#15171d;cursor:default}
.srf-calendar .cell .dn{font-family:var(--mono);font-size:11px;color:var(--ink-dim)}
.srf-calendar .cell.dim .dn{color:var(--ink-faint)}
.srf-calendar .cell.today{border-color:var(--lime);box-shadow:inset 0 0 0 1px rgba(200,242,80,.25)}
.srf-calendar .cell.today .dn{color:var(--lime);font-weight:600}
.srf-calendar .chip{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:var(--ink-sec);line-height:1.25;cursor:pointer;border-radius:5px;padding:1px 3px;margin-left:-3px;transition:background .12s,color .12s}
.srf-calendar .chip:hover{background:var(--raised);color:var(--ink)}
.srf-calendar .chip .g{width:11px;text-align:center;flex:0 0 auto;font-size:10px}
.srf-calendar .chip.task .g{color:var(--ink-dim)}
.srf-calendar .chip.over{color:var(--ink)} .srf-calendar .chip.over .g{color:var(--lime)}
.srf-calendar .chip.mil{color:var(--indigo)} .srf-calendar .chip.mil .g{color:var(--indigo)}
.srf-calendar .chip.run{color:var(--ink-faint)}
.srf-calendar .chip.rou{color:var(--ink-faint)}
.srf-calendar .chip .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srf-calendar .more{margin-top:6px;font-family:var(--mono);font-size:10px;color:var(--ink-faint);cursor:pointer;transition:color .12s}
.srf-calendar .more:hover{color:var(--ink-sec)}
.srf-calendar .wk{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
.srf-calendar .wcol{background:var(--panel);border:1px solid var(--edge-soft);border-radius:11px;min-height:240px;padding:10px 10px;cursor:pointer;transition:border-color .12s,background .12s}
.srf-calendar .wcol:hover{border-color:var(--edge);background:var(--raised)}
.srf-calendar .wcol.today{border-color:var(--lime);box-shadow:inset 0 0 0 1px rgba(200,242,80,.25)}
.srf-calendar .wh{display:flex;align-items:baseline;justify-content:space-between;padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid var(--edge-soft)}
.srf-calendar .wh .wd{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint)}
.srf-calendar .wh .wn{font-family:var(--mono);font-size:13px;color:var(--ink-dim)}
.srf-calendar .wcol.today .wh .wn{color:var(--lime);font-weight:600}
.srf-calendar .wempty{font-family:var(--mono);font-size:11px;color:var(--ink-faint);margin-top:8px}
.srf-calendar .agd{display:flex;flex-direction:column;gap:2px;max-width:640px}
.srf-calendar .arow{display:flex;gap:16px;align-items:flex-start;padding:12px 6px;border-bottom:1px solid var(--edge-soft)}
.srf-calendar .adate{flex:0 0 62px;display:flex;flex-direction:column;font-family:var(--mono);color:var(--ink-dim)}
.srf-calendar .adate .ad-dow{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint)}
.srf-calendar .adate b{font-size:18px;color:var(--ink-sec);font-weight:500;line-height:1.1}
.srf-calendar .adate.today b{color:var(--lime)}
.srf-calendar .aitems{flex:1;display:flex;flex-direction:column;gap:4px;padding-top:2px}
.srf-calendar .aitems .chip{margin-top:0}
.srf-calendar .foot{margin-top:34px;color:var(--ink-faint);font-size:11.5px;font-family:var(--mono)}
</style>`;
