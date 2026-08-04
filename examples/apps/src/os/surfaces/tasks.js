// Tasks surface — the one lens on tasks.md. A card is a line in a file;
// status is a token you can drag. Ported from wf-tasks.html (pane right of the rail).
// SAMPLE is shaped so it can later come from a Bank read of tasks.md.

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// A task tagged @wrapp opens that wrapp; an untagged task opens Bank (where tasks.md lives).
const APP_BY_TAG = {
  crest: "Crest", brandbrain: "brandbrain", flow: "Flow", prism: "Prism",
  adforge: "AdForge", bank: "Bank", redline: "Redline", adpulse: "AdPulse",
  ideabrain: "ideabrain", god: "God", autopilot: "Autopilot",
};
function ownerAttr(t) {
  const raw = (t.tag || "").replace(/^@/, "").toLowerCase();
  const app = APP_BY_TAG[raw];
  return app ? ' data-app="' + app + '"' : ' data-route="bank"';
}
// due floats to the top; overdue floats highest. Lower = earlier.
const dueWeight = (t) => (t.over ? 0 : t.due ? 1 : 2);

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
  const owner = ownerAttr(t);
  const dest = owner.indexOf("data-app") >= 0 ? "opens " + esc((t.tag || "").replace(/^@/, "")) : "opens Bank";
  return '<div class="tk' + (t.wait ? " blk" : "") + '"' + owner + ' title="' + dest + '">'
    + '<div class="top2"><span class="cb"></span><span class="tt">' + esc(t.t) + "</span></div>"
    + '<div class="row">' + rowbits.join("") + "</div></div>";
}

function column(c) {
  return '<div class="col" data-col="' + c.id + '">'
    + '<div class="ch" data-col="' + c.id + '" title="filter to ' + esc(c.name) + '"><span class="dot" style="background:' + c.dot + '"></span><span class="nm">' + esc(c.name) + '</span><span class="n">' + c.tasks.length + "</span></div>"
    + c.tasks.map(taskCard).join("")
    + '<div class="addcard" data-route="bank" title="add a line to tasks.md in Bank">+ add a task…</div></div>';
}

export function render(DATA) {
  const proj = (DATA && DATA.project && DATA.project.name) || "everything";
  const board = '<div class="board" data-view="board">'
    + SAMPLE.columns.map(column).join("")
    + '<div class="done-col" data-route="history" title="see completed tasks in History"><span class="big">' + SAMPLE.doneCount + "</span>Done ▾<br><span class=\"wk\">this week</span></div>"
    + "</div>";
  // list view (built once, toggled via wire) — every task as a flat line
  const rows = SAMPLE.columns.flatMap((c, ci) => c.tasks.map((t) => ({ c, t, ci })));
  const list = '<div class="list" data-view="list" hidden>'
    + rows.map(({ c, t, ci }) => '<div class="lrow"' + ownerAttr(t)
      + ' data-status="' + c.id + '" data-ord="' + ci + '" data-due="' + dueWeight(t) + '" data-group="' + esc((t.tag || t.proj || "~")) + '" title="' + (ownerAttr(t).indexOf("data-app") >= 0 ? "opens " + esc((t.tag || "").replace(/^@/, "")) : "opens Bank") + '">'
      + '<span class="cb"></span><span class="dot" style="background:' + c.dot + '"></span>'
      + '<span class="tt">' + esc(t.t) + '</span><span class="stat">' + esc(c.name) + "</span>"
      + (t.due ? '<span class="due' + (t.over ? " over" : "") + '">' + esc(t.due) + "</span>" : "") + "</div>").join("")
    + "</div>";

  return '<div class="srf-tasks"><main>'
    + '<div class="shd">'
    + '<span class="kk">◦ Tasks · <b>' + esc(proj) + "</b></span>"
    + '<span class="scope" data-route="dashboard" title="view across all projects">All projects ▾</span>'
    + '<div class="seg"><span class="on" data-view="board">Board</span><span data-view="list">List</span></div>'
    + '<span class="grpsel" title="change grouping">Group: Status ▾</span>'
    + '<span class="add" data-route="bank" title="add a line to tasks.md in Bank">+ Add</span>'
    + "</div>"
    + board + list
    + '<div class="foot">tasks is the one lens on tasks.md · a card is a line in a file · status = a token you can drag · nothing here is invented</div>'
    + "</main></div>";
}

export function wire(root) {
  const srf = root.querySelector(".srf-tasks");
  if (!srf) return;

  // Board / List toggle
  const seg = srf.querySelector(".seg");
  if (seg) {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("span[data-view]");
      if (!b) return;
      const view = b.getAttribute("data-view");
      seg.querySelectorAll("span").forEach((s) => s.classList.toggle("on", s === b));
      srf.querySelectorAll("[data-view]").forEach((el) => {
        if (el.classList.contains("board") || el.classList.contains("list"))
          el.hidden = el.getAttribute("data-view") !== view;
      });
      console.log("[tasks] view →", view);
    });
  }

  // Column-header filter — clicking a status highlights that column and filters
  // the list view to only that status. Clicking the active one clears it.
  let active = null;
  const applyFilter = () => {
    srf.querySelectorAll(".col").forEach((col) => {
      const cid = col.getAttribute("data-col");
      col.classList.toggle("dim", !!active && cid !== active);
      col.classList.toggle("sel", !!active && cid === active);
    });
    srf.querySelectorAll(".lrow").forEach((r) => {
      r.hidden = active ? r.getAttribute("data-status") !== active : false;
    });
  };
  srf.querySelectorAll(".col .ch").forEach((ch) => {
    ch.addEventListener("click", (e) => {
      e.stopPropagation();
      const cid = ch.getAttribute("data-col");
      active = active === cid ? null : cid;
      applyFilter();
      console.log("[tasks] filter →", active || "all");
    });
  });

  // Group selector — cycles Status → Project → Due, reordering the list for real.
  const grpsel = srf.querySelector(".grpsel");
  if (grpsel) {
    const modes = ["Status", "Project", "Due"];
    let gi = 0;
    grpsel.addEventListener("click", () => {
      gi = (gi + 1) % modes.length;
      const mode = modes[gi];
      grpsel.textContent = "Group: " + mode + " ▾";
      const rows = Array.from(srf.querySelectorAll(".lrow"));
      const key = (r) => mode === "Status" ? Number(r.getAttribute("data-ord"))
        : mode === "Due" ? Number(r.getAttribute("data-due"))
        : r.getAttribute("data-group");
      rows.slice().sort((a, b) => {
        const ka = key(a), kb = key(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      }).forEach((r, i) => { r.style.order = i; });
      console.log("[tasks] group →", mode);
    });
  }

  // Checking a card box toggles it to Done — and does NOT launch the card's wrapp.
  srf.addEventListener("click", (e) => {
    const cb = e.target.closest(".cb");
    if (cb) {
      e.stopPropagation();
      cb.classList.toggle("checked");
      console.log("[tasks] toggle done", cb.classList.contains("checked"));
    }
  });
}

export const css = `<style>
.srf-tasks main{padding:6px clamp(18px,4vw,44px) 0}
.srf-tasks .shd{display:flex;align-items:center;gap:12px;margin-top:6px;padding-bottom:14px;border-bottom:1px solid var(--edge-soft)}
.srf-tasks .kk{font-family:var(--display);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim)}
.srf-tasks .kk b{color:var(--ink)}
.srf-tasks .scope{font-size:11.5px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:20px;padding:2px 9px;cursor:pointer;transition:border-color .12s,filter .12s}
.srf-tasks .scope:hover{border-color:var(--indigo);filter:brightness(1.25)}
.srf-tasks .seg{margin-left:auto;display:flex;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-tasks .seg span{font-size:12px;color:var(--ink-dim);padding:4px 11px;border-radius:7px;cursor:pointer}
.srf-tasks .seg span:hover{color:var(--ink)}
.srf-tasks .seg span.on{background:var(--raised);color:var(--ink)}
.srf-tasks .grpsel{font-size:12px;color:var(--ink-sec);border:1px solid var(--edge);background:var(--panel);border-radius:8px;padding:5px 10px;cursor:pointer;transition:border-color .12s}
.srf-tasks .grpsel:hover{border-color:var(--ink-faint)}
.srf-tasks .add{font-size:12.5px;color:#0b0c10;background:var(--lime);border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;transition:filter .12s}
.srf-tasks .add:hover{filter:brightness(1.08)}
.srf-tasks .board{display:grid;grid-template-columns:repeat(3,1fr) 132px;gap:14px;margin-top:20px;align-items:start}
.srf-tasks .col{transition:opacity .14s}
.srf-tasks .col.dim{opacity:.4}
.srf-tasks .col .ch{display:flex;align-items:center;gap:8px;margin-bottom:11px;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:3px 6px;margin-left:-6px;transition:border-color .12s,background .12s}
.srf-tasks .col .ch:hover{border-color:var(--edge);background:var(--panel)}
.srf-tasks .col.sel .ch{border-color:var(--lime)}
.srf-tasks .col .ch .dot{width:7px;height:7px;border-radius:50%}
.srf-tasks .col .ch .nm{font-family:var(--display);font-size:12px;font-weight:600;letter-spacing:.02em}
.srf-tasks .col .ch .n{font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-tasks .tk{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:11px 12px;margin-bottom:10px;cursor:pointer;transition:border-color .12s,background .12s}
.srf-tasks .tk:hover{border-color:var(--ink-faint);background:var(--raised)}
.srf-tasks .tk.blk{border-left:2px solid var(--danger)}
.srf-tasks .tk .top2{display:flex;align-items:flex-start;gap:9px}
.srf-tasks .cb{width:15px;height:15px;border:1.5px solid var(--ink-faint);border-radius:4px;flex:0 0 auto;margin-top:1px;cursor:pointer;transition:border-color .12s,background .12s}
.srf-tasks .cb:hover{border-color:var(--lime)}
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
.srf-tasks .done-col{background:linear-gradient(180deg,#101218,#0d0e13);border:1px dashed var(--edge);border-radius:12px;padding:14px 12px;text-align:center;color:var(--ink-faint);font-size:12px;cursor:pointer;transition:border-color .12s,color .12s}
.srf-tasks .done-col:hover{border-color:var(--ink-faint);color:var(--ink-dim)}
.srf-tasks .done-col .big{font-family:var(--mono);font-size:22px;color:var(--ink-dim);display:block;margin-bottom:4px}
.srf-tasks .done-col .wk{font-size:11px}
.srf-tasks .addcard{border:1px dashed var(--edge);border-radius:12px;padding:10px 12px;color:var(--ink-faint);font-size:12px;cursor:pointer;transition:border-color .12s,color .12s}
.srf-tasks .addcard:hover{border-color:var(--ink-faint);color:var(--ink-dim)}
.srf-tasks .list{margin-top:20px}
.srf-tasks .list .lrow{display:flex;align-items:center;gap:11px;padding:9px 4px;border-bottom:1px solid var(--edge-soft);font-size:13px;color:var(--ink);cursor:pointer;transition:background .12s}
.srf-tasks .list .lrow:hover{background:var(--panel)}
.srf-tasks .list .lrow .dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.srf-tasks .list .lrow .tt{flex:1;min-width:0}
.srf-tasks .list .lrow .stat{font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-tasks .foot{margin-top:34px;color:var(--ink-faint);font-size:11.5px;font-family:var(--mono)}
</style>`;
