// Calendar surface — a temporal projection of the vault. It invents no events;
// each chip is a due task / milestone / past run / routine already in the Bank.
// Ported from wf-calendar.html. SAMPLE.items maps day-of-month → events (later a Bank query by date).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const SAMPLE = {
  monthLabel: "August 2026",
  daysInMonth: 31,
  lead: [27, 28, 29, 30, 31], // trailing July days before Aug 1 (Sat), Mon-start grid
  today: 4,
  // c: chip class (task|over|mil|run|rou), g: glyph
  items: {
    3: [{ c: "rou", g: "⟳", t: "Daily brief" }],
    4: [{ c: "over", g: "●", t: "Reply venue email" }, { c: "run", g: "↻", t: "Prism render" }],
    5: [{ c: "task", g: "●", t: "Render beam @prism" }, { c: "rou", g: "⟳", t: "Daily brief" }],
    7: [{ c: "over", g: "●", t: "Finalize wordmark" }, { c: "task", g: "●", t: "Ad variations" }],
    11: [{ c: "mil", g: "■", t: "Brand pack v1" }],
    12: [{ c: "task", g: "●", t: "Pick meetup date" }],
    14: [{ c: "run", g: "↻", t: "CopyFlow run" }, { c: "task", g: "●", t: "Launch post" }],
    18: [{ c: "task", g: "●", t: "Legal sign-off" }, { c: "task", g: "●", t: "Venue deposit" }, { c: "task", g: "●", t: "Guest list" }, { c: "run", g: "↻", t: "sync" }],
    21: [{ c: "mil", g: "■", t: "Launch — IndEur Club" }],
    26: [{ c: "task", g: "●", t: "Post-launch recap" }],
  },
};

function cellHtml(c) {
  let html = '<div class="dn">' + c.d + "</div>";
  if (!c.dim && SAMPLE.items[c.d]) {
    const list = SAMPLE.items[c.d];
    html += list.slice(0, 3).map((it) =>
      '<div class="chip ' + it.c + '"><span class="g">' + it.g + '</span><span class="t">' + esc(it.t) + "</span></div>").join("");
    if (list.length > 3) html += '<div class="more">+' + (list.length - 3) + " more</div>";
  }
  const cls = "cell" + (c.dim ? " dim" : "") + (!c.dim && c.d === SAMPLE.today ? " today" : "");
  return '<div class="' + cls + '">' + html + "</div>";
}

export function render(DATA) {
  const proj = (DATA && DATA.project && DATA.project.name) || "everything";
  const cells = [];
  SAMPLE.lead.forEach((d) => cells.push({ d, dim: 1 }));
  for (let d = 1; d <= SAMPLE.daysInMonth; d++) cells.push({ d, dim: 0 });
  let tail = 1;
  while (cells.length % 7 !== 0) cells.push({ d: tail++, dim: 1 });

  return '<div class="srf-calendar"><main>'
    + '<div class="shd">'
    + '<span class="kk">◦ ' + esc(SAMPLE.monthLabel) + " · <b>" + esc(proj) + "</b></span>"
    + '<span class="scope">All projects ▾</span>'
    + '<div class="seg"><span class="on" data-cv="month">Month</span><span data-cv="week">Week</span><span data-cv="agenda">Agenda</span></div>'
    + '<div class="nav"><span data-nav="prev">‹</span><span class="mid" data-nav="today">Today</span><span data-nav="next">›</span></div>'
    + "</div>"
    + '<div class="legend">'
    + '<span class="lg"><span style="color:var(--lime)">●</span> <b>due task</b></span>'
    + '<span class="lg"><span style="color:var(--indigo)">■</span> <b>milestone</b></span>'
    + '<span class="lg"><span style="color:var(--ink-faint)">↻</span> past run</span>'
    + '<span class="lg"><span style="color:var(--ink-faint)">⟳</span> routine</span>'
    + "</div>"
    + '<div class="dow">' + ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => "<span>" + d + "</span>").join("") + "</div>"
    + '<div class="cal">' + cells.map(cellHtml).join("") + "</div>"
    + '<div class="foot">calendar is a temporal projection of the vault · it invents no events · drag a task to re-date its due: · the past is dim, not gone</div>'
    + "</main></div>";
}

export function wire(root) {
  const seg = root.querySelector(".srf-calendar .seg");
  if (seg) seg.addEventListener("click", (e) => {
    const b = e.target.closest("span[data-cv]");
    if (!b) return;
    seg.querySelectorAll("span").forEach((s) => s.classList.toggle("on", s === b));
    console.log("[calendar] view →", b.getAttribute("data-cv"));
  });
  const nav = root.querySelector(".srf-calendar .nav");
  if (nav) nav.addEventListener("click", (e) => {
    const b = e.target.closest("span[data-nav]");
    if (b) console.log("[calendar] nav →", b.getAttribute("data-nav"));
  });
}

export const css = `<style>
.srf-calendar main{padding:6px clamp(18px,4vw,44px) 0}
.srf-calendar .shd{display:flex;align-items:center;gap:12px;margin-top:6px;padding-bottom:14px;border-bottom:1px solid var(--edge-soft)}
.srf-calendar .kk{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim)}
.srf-calendar .kk b{color:var(--ink)}
.srf-calendar .scope{font-size:11.5px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:20px;padding:2px 9px}
.srf-calendar .seg{margin-left:auto;display:flex;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-calendar .seg span{font-size:12px;color:var(--ink-dim);padding:4px 11px;border-radius:7px;cursor:pointer}
.srf-calendar .seg span.on{background:var(--raised);color:var(--ink)}
.srf-calendar .nav{display:flex;align-items:center;gap:2px;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-calendar .nav span{font-size:12px;color:var(--ink-dim);padding:4px 9px;border-radius:7px;cursor:pointer}
.srf-calendar .nav span.mid{color:var(--ink)}
.srf-calendar .legend{display:flex;gap:16px;margin:16px 0 12px;font-family:var(--mono);font-size:10.5px;color:var(--ink-dim)}
.srf-calendar .legend b{color:var(--ink-sec);font-weight:500}
.srf-calendar .lg{display:inline-flex;align-items:center;gap:6px}
.srf-calendar .dow{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:8px}
.srf-calendar .dow span{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);text-align:left;padding-left:4px}
.srf-calendar .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
.srf-calendar .cell{background:var(--panel);border:1px solid var(--edge-soft);border-radius:11px;min-height:104px;padding:8px 9px;position:relative}
.srf-calendar .cell.dim{background:#0d0e13;border-color:#15171d}
.srf-calendar .cell .dn{font-family:var(--mono);font-size:11px;color:var(--ink-dim)}
.srf-calendar .cell.dim .dn{color:var(--ink-faint)}
.srf-calendar .cell.today{border-color:var(--lime);box-shadow:inset 0 0 0 1px rgba(200,242,80,.25)}
.srf-calendar .cell.today .dn{color:var(--lime);font-weight:600}
.srf-calendar .chip{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:var(--ink-sec);line-height:1.25}
.srf-calendar .chip .g{width:11px;text-align:center;flex:0 0 auto;font-size:10px}
.srf-calendar .chip.task .g{color:var(--ink-dim)}
.srf-calendar .chip.over{color:var(--ink)} .srf-calendar .chip.over .g{color:var(--lime)}
.srf-calendar .chip.mil{color:var(--indigo)} .srf-calendar .chip.mil .g{color:var(--indigo)}
.srf-calendar .chip.run{color:var(--ink-faint)}
.srf-calendar .chip.rou{color:var(--ink-faint)}
.srf-calendar .chip .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srf-calendar .more{margin-top:6px;font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-calendar .foot{margin-top:34px;color:var(--ink-faint);font-size:11.5px;font-family:var(--mono)}
</style>`;
