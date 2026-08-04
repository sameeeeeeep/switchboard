// Tasks surface — the one lens on tasks.md. A card is a line in a file;
// status is a token you can drag. Ported from wf-tasks.html (pane right of the rail).
// SAMPLE is shaped so it can later come from a Bank read of tasks.md.

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// each column = a status token; each task = a line. `sw` is the wrapp's swatch.
const SAMPLE = {
  columns: [
    {
      id: "todo", name: "Todo", dot: "var(--ink-dim)",
      tasks: [
        { t: "Finalize IndEur wordmark", tag: "@crest", sw: "#E0764A", due: "Fri" },
        { t: "Write the launch announcement", tag: "@brandbrain", sw: "#E8B04A" },
        { t: "Reply to the venue email", proj: "#indeur", due: "2d overdue", over: 1 },
        { t: "Pick the meetup date", tag: "@flow", sw: "#A8D84A" },
      ],
    },
    {
      id: "doing", name: "Doing", dot: "var(--lime)",
      tasks: [
        { t: "Render the terracotta beam", tag: "@prism", sw: "#9B5DE5", prog: 1, due: "today" },
        { t: 'Launch ad variations — "Find your people"', tag: "@adforge", sw: "#F2994A", prog: 1 },
      ],
    },
    {
      id: "blocked", name: "Blocked", dot: "var(--danger)",
      tasks: [
        { t: "Legal OK on the club name", proj: "#indeur", wait: "waiting: counsel" },
      ],
    },
  ],
  doneCount: 12,
};

function taskCard(t) {
  const rowbits = [];
  if (t.tag) rowbits.push('<span class="tag"><span class="sw" style="background:' + esc(t.sw || "#3a3f4b") + '"></span>' + esc(t.tag) + "</span>");
  if (t.proj) rowbits.push('<span class="proj">' + esc(t.proj) + "</span>");
  if (t.prog) rowbits.push('<span class="prog" title="in progress"></span>');
  if (t.wait) rowbits.push('<span class="tag wait">' + esc(t.wait) + "</span>");
  if (t.due) rowbits.push('<span class="due' + (t.over ? " over" : "") + '">' + esc(t.due) + "</span>");
  return '<div class="tk' + (t.wait ? " blk" : "") + '">'
    + '<div class="top2"><span class="cb"></span><span class="tt">' + esc(t.t) + "</span></div>"
    + '<div class="row">' + rowbits.join("") + "</div></div>";
}

function column(c) {
  return '<div class="col">'
    + '<div class="ch"><span class="dot" style="background:' + c.dot + '"></span><span class="nm">' + esc(c.name) + '</span><span class="n">' + c.tasks.length + "</span></div>"
    + c.tasks.map(taskCard).join("")
    + '<div class="addcard">+ add a task…</div></div>';
}

export function render(DATA) {
  const proj = (DATA && DATA.project && DATA.project.name) || "everything";
  const board = '<div class="board" data-view="board">'
    + SAMPLE.columns.map(column).join("")
    + '<div class="done-col"><span class="big">' + SAMPLE.doneCount + "</span>Done ▾<br><span class=\"wk\">this week</span></div>"
    + "</div>";
  // list view (built once, toggled via wire) — every task as a flat line
  const rows = SAMPLE.columns.flatMap((c) => c.tasks.map((t) => ({ c, t })));
  const list = '<div class="list" data-view="list" hidden>'
    + rows.map(({ c, t }) => '<div class="lrow"><span class="cb"></span><span class="dot" style="background:' + c.dot + '"></span>'
      + '<span class="tt">' + esc(t.t) + '</span><span class="stat">' + esc(c.name) + "</span>"
      + (t.due ? '<span class="due' + (t.over ? " over" : "") + '">' + esc(t.due) + "</span>" : "") + "</div>").join("")
    + "</div>";

  return '<div class="srf-tasks"><main>'
    + '<div class="shd">'
    + '<span class="kk">◦ Tasks · <b>' + esc(proj) + "</b></span>"
    + '<span class="scope">All projects ▾</span>'
    + '<div class="seg"><span class="on" data-view="board">Board</span><span data-view="list">List</span></div>'
    + '<span class="grpsel">Group: Status ▾</span>'
    + '<span class="add">+ Add</span>'
    + "</div>"
    + board + list
    + '<div class="foot">tasks is the one lens on tasks.md · a card is a line in a file · status = a token you can drag · nothing here is invented</div>'
    + "</main></div>";
}

export function wire(root) {
  const seg = root.querySelector(".srf-tasks .seg");
  if (!seg) return;
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("span[data-view]");
    if (!b) return;
    const view = b.getAttribute("data-view");
    seg.querySelectorAll("span").forEach((s) => s.classList.toggle("on", s === b));
    root.querySelectorAll(".srf-tasks [data-view]").forEach((el) => {
      if (el.classList.contains("board") || el.classList.contains("list"))
        el.hidden = el.getAttribute("data-view") !== view;
    });
    console.log("[tasks] view →", view);
  });
  // checking a card box logs a would-be move to Done
  root.querySelector(".srf-tasks").addEventListener("click", (e) => {
    const cb = e.target.closest(".cb");
    if (cb) { cb.classList.toggle("checked"); console.log("[tasks] toggle done", cb.classList.contains("checked")); }
  });
}

export const css = `<style>
.srf-tasks main{padding:6px clamp(18px,4vw,44px) 0}
.srf-tasks .shd{display:flex;align-items:center;gap:12px;margin-top:6px;padding-bottom:14px;border-bottom:1px solid var(--edge-soft)}
.srf-tasks .kk{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim)}
.srf-tasks .kk b{color:var(--ink)}
.srf-tasks .scope{font-size:11.5px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:20px;padding:2px 9px}
.srf-tasks .seg{margin-left:auto;display:flex;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-tasks .seg span{font-size:12px;color:var(--ink-dim);padding:4px 11px;border-radius:7px;cursor:pointer}
.srf-tasks .seg span.on{background:var(--raised);color:var(--ink)}
.srf-tasks .grpsel{font-size:12px;color:var(--ink-sec);border:1px solid var(--edge);background:var(--panel);border-radius:8px;padding:5px 10px}
.srf-tasks .add{font-size:12.5px;color:#0b0c10;background:var(--lime);border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer}
.srf-tasks .board{display:grid;grid-template-columns:repeat(3,1fr) 132px;gap:14px;margin-top:20px;align-items:start}
.srf-tasks .col .ch{display:flex;align-items:center;gap:8px;margin-bottom:11px}
.srf-tasks .col .ch .dot{width:7px;height:7px;border-radius:50%}
.srf-tasks .col .ch .nm{font-size:12px;font-weight:600;letter-spacing:.02em}
.srf-tasks .col .ch .n{font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-tasks .tk{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:11px 12px;margin-bottom:10px;cursor:pointer}
.srf-tasks .tk.blk{border-left:2px solid var(--danger)}
.srf-tasks .tk .top2{display:flex;align-items:flex-start;gap:9px}
.srf-tasks .cb{width:15px;height:15px;border:1.5px solid var(--ink-faint);border-radius:4px;flex:0 0 auto;margin-top:1px;cursor:pointer}
.srf-tasks .cb.checked{background:var(--lime);border-color:var(--lime)}
.srf-tasks .tk .tt{font-size:13px;line-height:1.35;color:var(--ink)}
.srf-tasks .tk .row{display:flex;align-items:center;gap:7px;margin-top:9px;flex-wrap:wrap}
.srf-tasks .tag{font-family:var(--mono);font-size:10px;padding:1px 7px;border-radius:20px;border:1px solid var(--edge);color:var(--ink-dim);display:inline-flex;align-items:center;gap:5px}
.srf-tasks .tag.wait{color:var(--danger);border-color:#3a2230}
.srf-tasks .tag .sw{width:8px;height:8px;border-radius:3px;display:inline-block}
.srf-tasks .proj{font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-tasks .due{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--ink-dim);border:1px solid var(--edge);border-radius:20px;padding:1px 7px}
.srf-tasks .due.over{color:#0b0c10;background:var(--lime);border-color:var(--lime);font-weight:600}
.srf-tasks .prog{width:11px;height:11px;border-radius:50%;border:1.5px solid var(--ink-faint);background:conic-gradient(var(--ink-dim) 60%,transparent 0)}
.srf-tasks .done-col{background:linear-gradient(180deg,#101218,#0d0e13);border:1px dashed var(--edge);border-radius:12px;padding:14px 12px;text-align:center;color:var(--ink-faint);font-size:12px}
.srf-tasks .done-col .big{font-family:var(--mono);font-size:22px;color:var(--ink-dim);display:block;margin-bottom:4px}
.srf-tasks .done-col .wk{font-size:11px}
.srf-tasks .addcard{border:1px dashed var(--edge);border-radius:12px;padding:10px 12px;color:var(--ink-faint);font-size:12px;cursor:pointer}
.srf-tasks .list{margin-top:20px}
.srf-tasks .list .lrow{display:flex;align-items:center;gap:11px;padding:9px 4px;border-bottom:1px solid var(--edge-soft);font-size:13px;color:var(--ink)}
.srf-tasks .list .lrow .dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.srf-tasks .list .lrow .tt{flex:1;min-width:0}
.srf-tasks .list .lrow .stat{font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-tasks .foot{margin-top:34px;color:var(--ink-faint);font-size:11.5px;font-family:var(--mono)}
</style>`;
