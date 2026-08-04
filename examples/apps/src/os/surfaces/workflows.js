// Switchboard OS surface — Workflows.
// The pipeline layer: each workflow is a reusable recipe shown as an ①→②→③→④
// step chain, with its inputs, its actions, and a run history (✓ full / ◐ partial
// / ✗ failed-with-retry-from-step). A workflow + schedule + standing grant is
// what promotes it to a routine. Partial runs never masquerade as ✓.
// Empty state → a Create CTA.
//
// Self-contained ES module: exports render(DATA), css, wire(root).
// Every control is live: Recipes/Recent-runs tabs filter; Run shows running→done;
// row headers collapse; compact recipes expand their steps; recent-run rows open
// the history receipt (data-route) or launch the tool they used (data-app).

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------------------
// SAMPLE workflows — local; swap for real reads later.
// step.state ∈ done | run | fail | "" (pending) | skip
// last.kind  ∈ ok | part | bad | neu
// ---------------------------------------------------------------------------
const SAMPLE = [
  {
    id: "launch-day", name: "Launch-day pipeline",
    last: { kind: "bad", label: "✗ failed at ③" },
    steps: [
      { no: 1, t: "fetch signals", state: "done" },
      { no: 2, t: "draft copy", state: "done" },
      { no: 3, t: "Prism hero", state: "fail" },
      { no: 4, t: "assemble deck", state: "skip" },
    ],
    inputs: "inputs: <b>project</b> = Acme · <b>tone</b> = bold · <b>channels</b> = X, LinkedIn",
    acts: [["Run now", "pri", "run"], ["Edit", "", "edit"], ["Promote to routine", "", "promote"]],
    history: [
      { st: "bad", tm: "11:40", desc: 'failed at ③ <span class="muted">— Prism: no model · steps ①② kept</span>', lnk: "Retry from ③ ▸" },
      { st: "ok", tm: "09:15", desc: 'full <span class="muted">· 4 artifacts written to Bank</span>', lnk: "Open log" },
      { st: "part", tm: "08:02", desc: 'partial <span class="muted">— ③④ skipped (no hero requested)</span>', lnk: "Open log" },
    ],
    attn: "✗ posted to Needs attention · Retry-from-③ reuses ①② — never re-pays for completed steps",
  },
  {
    id: "weekly-report", name: "Weekly report",
    last: { kind: "part", label: "◐ running · step 2 of 3" },
    steps: [
      { no: 1, t: "pull metrics", state: "done" },
      { no: 2, t: "summarize", state: "run" },
      { no: 3, t: "post to Bank", state: "" },
    ],
    inputs: "inputs: <b>window</b> = last 7d · <b>project</b> = IndEur Club",
    acts: [["Open log", "", "log"], ["Edit", "", "edit"]],
  },
  {
    id: "vendor-sync", name: "Vendor sync",
    last: { kind: "neu", label: "not run yet" },
    steps: [
      { no: 1, t: "scrape quotes", state: "" },
      { no: 2, t: "normalize", state: "" },
      { no: 3, t: "update canvas", state: "" },
    ],
    inputs: "inputs: <b>source</b> = Alibaba · <b>list</b> = nailinit vendors — composing is fully available before first run",
    acts: [["Run now", "pri", "run"], ["Edit", "", "edit"]],
  },
  // collapsed / compact — a healthy, dormant recipe (click to expand its steps)
  {
    id: "content-batch", name: "Content batch", compact: true, dots: 5,
    last: { kind: "ok", label: "✓ full · yesterday 17:22" },
    steps: [
      { no: 1, t: "gather sources", state: "done" },
      { no: 2, t: "draft posts", state: "done" },
      { no: 3, t: "queue schedule", state: "done" },
    ],
  },
];

// Recent runs across every recipe — flattened receipts. Each row opens the
// history receipt; its chip launches the tool that step used.
const RECENT = [
  { wf: "Launch-day pipeline", st: "bad", tm: "today 11:40", desc: "failed at ③ — Prism: no model · steps ①② kept", app: "Prism" },
  { wf: "Weekly report", st: "part", tm: "today 10:05", desc: "running · summarizing metrics (step 2 of 3)", app: "Bank" },
  { wf: "Launch-day pipeline", st: "ok", tm: "today 09:15", desc: "full · 4 artifacts written to Bank", app: "Bank" },
  { wf: "Content batch", st: "ok", tm: "yesterday 17:22", desc: "full · 5 posts drafted", app: "brandbrain" },
  { wf: "Launch-day pipeline", st: "part", tm: "yesterday 08:02", desc: "partial · ③④ skipped (no hero requested)", app: "AdForge" },
];

function stepChain(steps) {
  return '<div class="chain">' + steps.map((s, i) => {
    const cls = s.state ? " " + s.state : "";
    const step = '<div class="step' + cls + '"><span class="no">' + s.no + "</span>" + esc(s.t) + "</div>";
    const arrow = i < steps.length - 1 ? '<span class="arrow">→</span>' : "";
    return step + arrow;
  }).join("") + "</div>";
}

function runHistory(history) {
  return '<div class="hist"><div class="hh">Run history</div>' + history.map((r) => {
    const isRetry = /retry/i.test(r.lnk);
    const attr = isRetry ? ' data-act="retry"' : ' data-route="history"';
    return '<div class="run"><span class="st ' + r.st + '">' + ({ ok: "✓", bad: "✗", part: "◐" }[r.st] || "•") + "</span>"
      + '<span class="tm">' + esc(r.tm) + '</span><span class="desc">' + r.desc + "</span>"
      + '<span class="ra"><span class="lnk"' + attr + ">" + esc(r.lnk) + "</span></span></div>";
  }).join("") + "</div>";
}

function compactRow(w) {
  const dots = Array.from({ length: w.dots || 3 }, (_, i) => '<span class="d">' + (i + 1) + "</span>").join("");
  const steps = w.steps ? stepChain(w.steps)
    : '<div class="chain"><div class="step"><span class="no">+</span>compose steps</div></div>';
  return '<div class="compact" data-workflow="' + esc(w.id) + '" data-name="' + esc(w.name.toLowerCase()) + '">'
    + '<div class="ic">⇉</div><div class="nm">' + esc(w.name) + "</div>"
    + '<div class="mini">' + dots + "</div>"
    + '<div class="last ' + w.last.kind + '">' + esc(w.last.label) + "</div>"
    + '<div class="cbody">' + steps
    + '<div class="cacts"><button class="btn pri" data-act="run">Run recipe</button></div></div>'
    + "</div>";
}

function workflowRow(w) {
  if (w.compact) return compactRow(w);
  const acts = w.acts.map(([label, k, act]) => {
    const attr = act === "log" ? 'data-route="history"' : 'data-act="' + act + '"';
    return '<button class="btn' + (k ? " " + k : "") + '" ' + attr + ">" + esc(label) + "</button>";
  }).join("");
  return '<div class="w" data-workflow="' + esc(w.id) + '" data-name="' + esc(w.name.toLowerCase()) + '">'
    + '<div class="hd"><div class="ic">⇉</div><div class="nm">' + esc(w.name) + "</div>"
    + '<div class="last ' + w.last.kind + '">' + esc(w.last.label) + "</div>"
    + '<span class="caret">▾</span></div>'
    + stepChain(w.steps)
    + '<div class="inputs">' + w.inputs + "</div>"
    + '<div class="rowacts">' + acts + "</div>"
    + (w.history ? runHistory(w.history) : "")
    + (w.attn ? '<div class="attn">' + esc(w.attn) + "</div>" : "")
    + '<div class="editor"><div class="eh">Editing · ' + esc(w.name) + "</div>"
    + '<input class="efield" value="' + esc(w.name) + '" />'
    + '<div class="eacts"><button class="btn pri" data-act="edit">Done</button></div></div>'
    + "</div>";
}

function recentRow(r) {
  const glyph = { ok: "✓", bad: "✗", part: "◐" }[r.st] || "•";
  return '<div class="run rrun" data-route="history" data-name="' + esc(r.wf.toLowerCase()) + '">'
    + '<span class="st ' + r.st + '">' + glyph + "</span>"
    + '<span class="tm">' + esc(r.tm) + "</span>"
    + '<span class="wf">' + esc(r.wf) + "</span>"
    + '<span class="desc">' + esc(r.desc) + "</span>"
    + '<span class="ra"><button class="chip" data-app="' + esc(r.app) + '">' + esc(r.app) + " ▸</button></span>"
    + "</div>";
}

export function render(DATA) {
  const list = (DATA && DATA.workflows) || SAMPLE;
  const runs = (DATA && DATA.runs) || RECENT;

  const head = '<div class="shead"><span class="kick">Workflows</span><h1>Reusable pipelines</h1>'
    + '<span class="n">' + list.length + "</span>"
    + '<div class="filters">'
    + '<input class="searchbox" placeholder="filter recipes…" />'
    + '<div class="srch" title="Search recipes">⌕</div>'
    + '<button class="btn pri" data-act="new">+ New</button></div></div><div class="rule"></div>';

  const tabs = '<div class="tabs">'
    + '<button class="tab active" data-tab="recipes">Recipes <span class="tn">' + list.length + "</span></button>"
    + '<button class="tab" data-tab="runs">Recent runs <span class="tn">' + runs.length + "</span></button>"
    + "</div>";

  const composer = '<div class="composer"><div class="ch">New recipe</div>'
    + '<input class="cfield" placeholder="Name this recipe…" />'
    + '<div class="cacts"><button class="btn pri" data-act="create">Create</button>'
    + '<button class="btn" data-act="composer-close">Cancel</button></div></div>';

  let recipesBody;
  if (!list.length) {
    recipesBody = '<div class="empty"><div class="eyebrow">no pipelines yet</div>'
      + "<p>A workflow chains a few steps into one reusable recipe — run it on demand, then add a schedule to promote it to a routine.</p>"
      + '<button class="btn pri" data-act="new" style="padding:9px 18px">+ New workflow</button></div>'
      + '<div class="rows"></div>';
  } else {
    recipesBody = '<div class="rows">' + list.map(workflowRow).join("") + "</div>";
  }

  const recipesView = '<div class="view v-recipes on" data-view="recipes">' + composer + recipesBody + "</div>";

  const runsView = '<div class="view v-runs" data-view="runs">'
    + (runs.length
      ? '<div class="runlist">' + runs.map(recentRow).join("") + "</div>"
      : '<div class="empty"><div class="eyebrow">no runs yet</div><p>Run a recipe and its receipt lands here.</p></div>')
    + "</div>";

  return '<div class="srf-workflows">' + head + tabs + recipesView + runsView + "</div>";
}

export function wire(root) {
  const el = root.querySelector(".srf-workflows");
  if (!el) return;

  const clearFilter = () => el.querySelectorAll(".v-recipes [data-name]").forEach((r) => { r.style.display = ""; });

  const showTab = (name) => {
    el.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === name));
    el.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.getAttribute("data-view") === name));
  };

  // live filter as the user types in the search box (Recipes tab only)
  el.addEventListener("input", (e) => {
    const box = e.target.closest(".searchbox");
    if (!box) return;
    const q = box.value.trim().toLowerCase();
    el.querySelectorAll(".v-recipes [data-name]").forEach((r) => {
      const hit = !q || r.getAttribute("data-name").indexOf(q) !== -1;
      r.style.display = hit ? "" : "none";
    });
  });

  el.addEventListener("click", (e) => {
    // Global delegated handlers own routing / launching / opening — let them bubble.
    if (e.target.closest("[data-route],[data-app],[data-open]")) return;

    // Tabs — real filtering between Recipes and Recent runs.
    const tab = e.target.closest(".tab[data-tab]");
    if (tab) { showTab(tab.getAttribute("data-tab")); return; }

    // Search toggle.
    const srch = e.target.closest(".srch");
    if (srch) {
      const on = el.classList.toggle("searching");
      const box = el.querySelector(".searchbox");
      if (box) { if (on) box.focus(); else { box.value = ""; clearFilter(); } }
      return;
    }

    const act = e.target.closest("[data-act]");
    if (!act) {
      // No explicit action — treat as an expand/collapse gesture.
      const compact = e.target.closest(".compact");
      if (compact) { compact.classList.toggle("open"); return; }
      const hd = e.target.closest(".w .hd");
      if (hd) { hd.parentElement.classList.toggle("collapsed"); return; }
      return;
    }

    const kind = act.getAttribute("data-act");
    const row = act.closest(".w") || act.closest(".compact");

    if (kind === "run" || kind === "retry") {
      const last = row && row.querySelector(".last");
      const label0 = act.textContent;
      const running = kind === "retry" ? "◐ retrying from ③…" : "◐ running…";
      if (last) { last.className = "last part"; last.textContent = running; }
      if (act.tagName === "BUTTON") { act.disabled = true; act.classList.add("busy"); act.textContent = "Running…"; }
      else act.classList.add("clicked");
      setTimeout(() => {
        if (last) { last.className = "last ok"; last.textContent = "✓ done · just now"; }
        if (act.tagName === "BUTTON") { act.disabled = false; act.classList.remove("busy"); act.textContent = label0; }
      }, 950);
      return;
    }

    if (kind === "edit") {
      if (row) row.classList.toggle("editing");
      return;
    }

    if (kind === "promote") {
      if (!row) return;
      const on = row.classList.toggle("promoted");
      act.textContent = on ? "✓ Promoted to routine" : "Promote to routine";
      const nm = row.querySelector(".nm");
      let badge = row.querySelector(".rbadge");
      if (on && !badge && nm) { badge = document.createElement("span"); badge.className = "rbadge"; badge.textContent = "routine"; nm.after(badge); }
      else if (!on && badge) badge.remove();
      return;
    }

    if (kind === "new") {
      const comp = el.querySelector(".composer");
      if (comp) {
        const open = comp.classList.toggle("open");
        const i = comp.querySelector("input");
        if (open && i) i.focus();
      }
      return;
    }

    if (kind === "composer-close") {
      const comp = el.querySelector(".composer");
      if (comp) comp.classList.remove("open");
      return;
    }

    if (kind === "create") {
      const comp = el.querySelector(".composer");
      const i = comp && comp.querySelector("input");
      const name = i && i.value.trim();
      if (!name) { if (i) i.focus(); return; }
      const rows = el.querySelector(".v-recipes .rows");
      if (rows) {
        const div = document.createElement("div");
        div.className = "compact new";
        div.setAttribute("data-workflow", name.toLowerCase().replace(/\s+/g, "-"));
        div.setAttribute("data-name", name.toLowerCase());
        div.innerHTML = '<div class="ic">⇉</div><div class="nm">' + esc(name) + "</div>"
          + '<div class="last neu">just created · not run yet</div>'
          + '<div class="cbody"><div class="chain"><div class="step"><span class="no">+</span>compose steps</div></div></div>';
        rows.prepend(div);
      }
      if (i) i.value = "";
      if (comp) comp.classList.remove("open");
      return;
    }
  });
}

export const css = `
.srf-workflows{
  --panel:#12151C; --raised:#1A1F29; --edge:#262C38; --edge-soft:#1C212B;
  --ink:#E8EDF4; --ink-sec:#B4BECE; --ink-dim:#99A3B7; --ink-faint:#6E7C90;
  --lime:#C8F250; --indigo:#5B4FE8; --danger:#FF2D6E; --amber:#F59E0B;
  --mono:"Spline Sans Mono",ui-monospace,Menlo,monospace;
}
.srf-workflows .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-workflows .shead{display:flex;align-items:center;gap:14px;margin:10px 0 6px}
.srf-workflows .shead h1{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0}
.srf-workflows .shead .n{font-family:var(--mono);font-size:11px;color:var(--ink-dim);border:1px solid var(--edge);border-radius:20px;padding:2px 10px}
.srf-workflows .filters{margin-left:auto;display:flex;gap:6px;align-items:center}
.srf-workflows .searchbox{display:none;width:170px;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid var(--edge);background:var(--panel);color:var(--ink);outline:none}
.srf-workflows .searchbox:focus{border-color:var(--indigo)}
.srf-workflows.searching .searchbox{display:block}
.srf-workflows .srch{width:30px;height:30px;border-radius:8px;border:1px solid var(--edge);background:var(--panel);display:grid;place-items:center;color:var(--ink-dim);font-size:13px;cursor:pointer;transition:border-color .12s,color .12s}
.srf-workflows .srch:hover{border-color:var(--indigo);color:var(--ink-sec)}
.srf-workflows.searching .srch{border-color:var(--indigo);color:var(--ink)}
.srf-workflows .btn{font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--edge);background:var(--raised);color:var(--ink-sec);cursor:pointer;white-space:nowrap;transition:border-color .12s,background .12s,color .12s}
.srf-workflows .btn:hover{border-color:var(--indigo);color:var(--ink)}
.srf-workflows .btn.pri{background:#1b2410;border-color:#33461a;color:var(--lime)}
.srf-workflows .btn.pri:hover{border-color:#4a6626;background:#20300f}
.srf-workflows .btn.busy{opacity:.7;cursor:default}
.srf-workflows .btn[disabled]{cursor:default}
.srf-workflows .rule{height:1px;background:var(--edge-soft);margin:14px 0 14px}
.srf-workflows .tabs{display:flex;gap:6px;margin:0 0 16px}
.srf-workflows .tab{font-family:var(--mono);font-size:11px;letter-spacing:.04em;padding:6px 13px;border-radius:9px;border:1px solid var(--edge);background:var(--panel);color:var(--ink-dim);cursor:pointer;display:flex;align-items:center;gap:7px;transition:border-color .12s,color .12s,background .12s}
.srf-workflows .tab:hover{border-color:var(--indigo);color:var(--ink-sec)}
.srf-workflows .tab.active{color:var(--ink);border-color:var(--indigo);background:#171633}
.srf-workflows .tab .tn{font-size:10px;color:var(--ink-faint);border:1px solid var(--edge);border-radius:12px;padding:0 6px}
.srf-workflows .tab.active .tn{color:var(--ink-sec)}
.srf-workflows .view{display:none}
.srf-workflows .view.on{display:block}
.srf-workflows .composer{display:none;background:var(--panel);border:1px solid var(--indigo);border-radius:14px;padding:14px 16px;margin:0 0 12px}
.srf-workflows .composer.open{display:block}
.srf-workflows .composer .ch{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:9px}
.srf-workflows .composer .cfield{width:100%;box-sizing:border-box;font-size:13px;padding:8px 11px;border-radius:9px;border:1px solid var(--edge);background:var(--raised);color:var(--ink);outline:none}
.srf-workflows .composer .cfield:focus{border-color:var(--indigo)}
.srf-workflows .composer .cacts{display:flex;gap:7px;margin-top:10px}
.srf-workflows .rows{display:flex;flex-direction:column;gap:12px}
.srf-workflows .w{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:15px 17px;transition:border-color .12s}
.srf-workflows .w.promoted{border-color:#2c2a55}
.srf-workflows .w .hd{display:flex;align-items:center;gap:11px;cursor:pointer;border-radius:8px;transition:opacity .12s}
.srf-workflows .w .hd:hover{opacity:.85}
.srf-workflows .w .ic{width:30px;height:30px;border-radius:9px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--ink-sec);font-size:14px;flex:0 0 auto}
.srf-workflows .w .nm{font-size:14.5px;font-weight:600}
.srf-workflows .rbadge{margin-left:9px;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:#bcb4ff;border:1px solid #2c2a55;background:#171633;border-radius:11px;padding:2px 8px;vertical-align:middle}
.srf-workflows .w .last{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink-dim);display:flex;align-items:center;gap:6px}
.srf-workflows .w .last.ok{color:var(--lime)}
.srf-workflows .w .last.bad{color:var(--danger)}
.srf-workflows .w .last.part{color:var(--amber)}
.srf-workflows .w .last.neu{color:var(--ink-faint)}
.srf-workflows .w .caret{color:var(--ink-faint);font-size:11px;transition:transform .15s;flex:0 0 auto}
.srf-workflows .w.collapsed .caret{transform:rotate(-90deg)}
.srf-workflows .w.collapsed .chain,
.srf-workflows .w.collapsed .inputs,
.srf-workflows .w.collapsed .rowacts,
.srf-workflows .w.collapsed .hist,
.srf-workflows .w.collapsed .attn,
.srf-workflows .w.collapsed .editor{display:none}
.srf-workflows .chain{display:flex;align-items:center;gap:0;margin:14px 0 0 41px;flex-wrap:wrap}
.srf-workflows .step{display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:9px;background:var(--raised);border:1px solid var(--edge);font-size:12.5px;color:var(--ink-sec)}
.srf-workflows .step .no{width:17px;height:17px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-family:var(--mono);background:#0f1116;border:1px solid var(--edge);color:var(--ink-dim)}
.srf-workflows .step.done{border-color:#33461a}
.srf-workflows .step.done .no{background:#1b2410;border-color:#33461a;color:var(--lime)}
.srf-workflows .step.run{border-color:#2c2a55}
.srf-workflows .step.run .no{background:#171633;border-color:#2c2a55;color:#bcb4ff}
.srf-workflows .step.fail{border-color:#52222b}
.srf-workflows .step.fail .no{background:#2a1418;border-color:#52222b;color:var(--danger)}
.srf-workflows .step.skip{opacity:.55}
.srf-workflows .arrow{color:var(--ink-faint);padding:0 7px;font-size:12px}
.srf-workflows .inputs{margin:11px 0 0 41px;font-size:12px;color:var(--ink-dim)}
.srf-workflows .inputs b{color:var(--ink-sec);font-weight:500}
.srf-workflows .rowacts{margin:12px 0 0 41px;display:flex;gap:7px;flex-wrap:wrap}
.srf-workflows .editor{display:none;margin:12px 0 0 41px;border:1px solid var(--indigo);border-radius:11px;padding:12px 13px;background:#0f1116}
.srf-workflows .w.editing .editor{display:block}
.srf-workflows .editor .eh{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:8px}
.srf-workflows .editor .efield{width:100%;box-sizing:border-box;font-size:12.5px;padding:7px 10px;border-radius:8px;border:1px solid var(--edge);background:var(--raised);color:var(--ink);outline:none}
.srf-workflows .editor .efield:focus{border-color:var(--indigo)}
.srf-workflows .editor .eacts{display:flex;gap:7px;margin-top:9px}
.srf-workflows .hist{margin:13px 0 0 41px;border:1px solid var(--edge-soft);border-radius:11px;overflow:hidden}
.srf-workflows .hist .hh{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint);padding:8px 13px;background:#0f1116;border-bottom:1px solid var(--edge-soft)}
.srf-workflows .run{display:flex;align-items:center;gap:11px;padding:9px 13px;font-size:12.5px;border-bottom:1px solid var(--edge-soft)}
.srf-workflows .run:last-child{border-bottom:0}
.srf-workflows .run .st{width:18px;text-align:center;font-size:13px}
.srf-workflows .run .st.ok{color:var(--lime)}
.srf-workflows .run .st.bad{color:var(--danger)}
.srf-workflows .run .st.part{color:var(--amber)}
.srf-workflows .run .tm{font-family:var(--mono);font-size:11px;color:var(--ink-faint);width:52px}
.srf-workflows .run .desc{color:var(--ink-sec)}
.srf-workflows .run .desc .muted{color:var(--ink-dim)}
.srf-workflows .run .ra{margin-left:auto}
.srf-workflows .run .lnk{font-size:11.5px;color:var(--indigo);cursor:pointer;transition:opacity .12s}
.srf-workflows .run .lnk:hover{opacity:.75;text-decoration:underline}
.srf-workflows .run .lnk.clicked{opacity:.6}
.srf-workflows .attn{margin:9px 0 0 41px;font-size:11.5px;color:var(--danger);font-family:var(--mono)}
.srf-workflows .runlist{border:1px solid var(--edge-soft);border-radius:12px;overflow:hidden;background:var(--panel)}
.srf-workflows .runlist .rrun{cursor:pointer;transition:background .12s}
.srf-workflows .runlist .rrun:hover{background:var(--raised)}
.srf-workflows .runlist .rrun .tm{width:auto;min-width:96px}
.srf-workflows .runlist .rrun .wf{font-weight:600;color:var(--ink);white-space:nowrap}
.srf-workflows .chip{font-family:var(--mono);font-size:10.5px;padding:3px 9px;border-radius:8px;border:1px solid var(--edge);background:var(--raised);color:var(--indigo);cursor:pointer;transition:border-color .12s,color .12s}
.srf-workflows .chip:hover{border-color:var(--indigo);color:#bcb4ff}
.srf-workflows .compact{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:14px 17px;display:flex;align-items:center;gap:11px;flex-wrap:wrap;cursor:pointer;transition:border-color .12s}
.srf-workflows .compact:hover{border-color:var(--indigo)}
.srf-workflows .compact .ic{width:28px;height:28px;border-radius:8px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--ink-sec);font-size:13px}
.srf-workflows .compact .nm{font-size:13.5px;font-weight:600}
.srf-workflows .compact .mini{margin-left:12px;display:flex;gap:5px;align-items:center}
.srf-workflows .compact .d{width:15px;height:15px;border-radius:4px;background:var(--raised);border:1px solid var(--edge);font-size:8px;font-family:var(--mono);display:grid;place-items:center;color:var(--ink-faint)}
.srf-workflows .compact .last{margin-left:auto;font-family:var(--mono);font-size:11px}
.srf-workflows .compact .last.ok{color:var(--lime)}
.srf-workflows .compact .last.part{color:var(--amber)}
.srf-workflows .compact .last.neu{color:var(--ink-faint)}
.srf-workflows .compact .cbody{display:none;flex-basis:100%;width:100%;margin-top:12px}
.srf-workflows .compact.open .cbody{display:block}
.srf-workflows .compact .cbody .chain{margin-left:0}
.srf-workflows .compact .cbody .cacts{margin-top:12px;display:flex;gap:7px}
.srf-workflows .empty{border:1px solid var(--edge-soft);border-radius:16px;padding:34px;text-align:center;background:linear-gradient(180deg,#101218,#0d0e13)}
.srf-workflows .empty .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint)}
.srf-workflows .empty p{color:var(--ink-dim);font-size:13px;max-width:440px;margin:10px auto 20px}
`;
