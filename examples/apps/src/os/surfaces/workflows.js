// Switchboard OS surface — Workflows.
// The pipeline layer: each workflow is a reusable recipe shown as an ①→②→③→④
// step chain, with its inputs, its actions, and a run history (✓ full / ◐ partial
// / ✗ failed-with-retry-from-step). A workflow + schedule + standing grant is
// what promotes it to a routine. Partial runs never masquerade as ✓.
// Empty state → a Create CTA.
//
// Self-contained ES module: exports render(DATA), css, wire(root).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

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
  // collapsed / compact — a healthy, dormant recipe
  { id: "content-batch", name: "Content batch", compact: true, dots: 5, last: { kind: "ok", label: "✓ full · yesterday 17:22" } },
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
  return '<div class="hist"><div class="hh">Run history</div>' + history.map((r) =>
    '<div class="run"><span class="st ' + r.st + '">' + ({ ok: "✓", bad: "✗", part: "◐" }[r.st] || "•") + "</span>"
    + '<span class="tm">' + esc(r.tm) + '</span><span class="desc">' + r.desc + "</span>"
    + '<span class="ra"><span class="lnk">' + esc(r.lnk) + "</span></span></div>"
  ).join("") + "</div>";
}

function workflowRow(w) {
  if (w.compact) {
    const dots = Array.from({ length: w.dots || 3 }, (_, i) => '<span class="d">' + (i + 1) + "</span>").join("");
    return '<div class="compact" data-workflow="' + esc(w.id) + '"><div class="ic">⇉</div><div class="nm">' + esc(w.name) + "</div>"
      + '<div class="mini">' + dots + "</div>"
      + '<div class="last ' + w.last.kind + '">' + esc(w.last.label) + "</div></div>";
  }
  const acts = w.acts.map(([label, k, act]) => '<button class="btn' + (k ? " " + k : "") + '" data-act="' + act + '">' + esc(label) + "</button>").join("");
  return '<div class="w" data-workflow="' + esc(w.id) + '">'
    + '<div class="hd"><div class="ic">⇉</div><div class="nm">' + esc(w.name) + "</div>"
    + '<div class="last ' + w.last.kind + '">' + esc(w.last.label) + "</div></div>"
    + stepChain(w.steps)
    + '<div class="inputs">' + w.inputs + "</div>"
    + '<div class="rowacts">' + acts + "</div>"
    + (w.history ? runHistory(w.history) : "")
    + (w.attn ? '<div class="attn">' + esc(w.attn) + "</div>" : "")
    + "</div>";
}

export function render(DATA) {
  const list = (DATA && DATA.workflows) || SAMPLE;

  const head = '<div class="shead"><span class="kick">Workflows</span><h1>Reusable pipelines</h1>'
    + '<span class="n">' + list.length + "</span>"
    + '<div class="filters"><div class="srch">⌕</div><button class="btn pri" data-act="new">+ New</button></div></div><div class="rule"></div>';

  let body;
  if (!list.length) {
    body = '<div class="empty"><div class="eyebrow">no pipelines yet</div>'
      + "<p>A workflow chains a few steps into one reusable recipe — run it on demand, then add a schedule to promote it to a routine.</p>"
      + '<button class="btn pri" data-act="new" style="padding:9px 18px">+ New workflow</button></div>';
  } else {
    body = '<div class="rows">' + list.map(workflowRow).join("") + "</div>";
  }

  return '<div class="srf-workflows">' + head + body + "</div>";
}

export function wire(root) {
  const el = root.querySelector(".srf-workflows");
  if (!el) return;
  el.addEventListener("click", (e) => {
    const lnk = e.target.closest(".lnk");
    if (lnk) { lnk.classList.add("clicked"); return; }
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    // optimistic: kicking a workflow flips its last-run chip to a running register
    const row = btn.closest(".w");
    if (btn.getAttribute("data-act") === "run" && row) {
      const last = row.querySelector(".last");
      if (last) { last.className = "last part"; last.textContent = "◐ running…"; }
    }
  });
}

export const css = `
.srf-workflows{
  --panel:#14161c; --raised:#1b1e26; --edge:#242833; --edge-soft:#1a1d25;
  --ink:#e8edf4; --ink-sec:#b4bece; --ink-dim:#8a93a6; --ink-faint:#5c6474;
  --lime:#c8f250; --indigo:#5b4fe8; --danger:#ff5a6e; --amber:#f2994a;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
}
.srf-workflows .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-workflows .shead{display:flex;align-items:center;gap:14px;margin:10px 0 6px}
.srf-workflows .shead h1{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0}
.srf-workflows .shead .n{font-family:var(--mono);font-size:11px;color:var(--ink-dim);border:1px solid var(--edge);border-radius:20px;padding:2px 10px}
.srf-workflows .filters{margin-left:auto;display:flex;gap:6px;align-items:center}
.srf-workflows .srch{width:30px;height:30px;border-radius:8px;border:1px solid var(--edge);background:var(--panel);display:grid;place-items:center;color:var(--ink-dim);font-size:13px}
.srf-workflows .btn{font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--edge);background:var(--raised);color:var(--ink-sec);cursor:pointer;white-space:nowrap}
.srf-workflows .btn.pri{background:#1b2410;border-color:#33461a;color:var(--lime)}
.srf-workflows .rule{height:1px;background:var(--edge-soft);margin:14px 0 18px}
.srf-workflows .rows{display:flex;flex-direction:column;gap:12px}
.srf-workflows .w{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:15px 17px}
.srf-workflows .w .hd{display:flex;align-items:center;gap:11px}
.srf-workflows .w .ic{width:30px;height:30px;border-radius:9px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--ink-sec);font-size:14px;flex:0 0 auto}
.srf-workflows .w .nm{font-size:14.5px;font-weight:600}
.srf-workflows .w .last{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink-dim);display:flex;align-items:center;gap:6px}
.srf-workflows .w .last.ok{color:var(--lime)}
.srf-workflows .w .last.bad{color:var(--danger)}
.srf-workflows .w .last.part{color:var(--amber)}
.srf-workflows .w .last.neu{color:var(--ink-faint)}
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
.srf-workflows .rowacts{margin:12px 0 0 41px;display:flex;gap:7px}
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
.srf-workflows .run .lnk{font-size:11.5px;color:var(--indigo);cursor:pointer}
.srf-workflows .run .lnk.clicked{opacity:.6}
.srf-workflows .attn{margin:9px 0 0 41px;font-size:11.5px;color:var(--danger);font-family:var(--mono)}
.srf-workflows .compact{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:14px 17px;display:flex;align-items:center;gap:11px}
.srf-workflows .compact .ic{width:28px;height:28px;border-radius:8px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--ink-sec);font-size:13px}
.srf-workflows .compact .nm{font-size:13.5px;font-weight:600}
.srf-workflows .compact .mini{margin-left:12px;display:flex;gap:5px;align-items:center}
.srf-workflows .compact .d{width:15px;height:15px;border-radius:4px;background:var(--raised);border:1px solid var(--edge);font-size:8px;font-family:var(--mono);display:grid;place-items:center;color:var(--ink-faint)}
.srf-workflows .compact .last{margin-left:auto;font-family:var(--mono);font-size:11px}
.srf-workflows .compact .last.ok{color:var(--lime)}
.srf-workflows .compact .last.neu{color:var(--ink-faint)}
.srf-workflows .empty{border:1px solid var(--edge-soft);border-radius:16px;padding:34px;text-align:center;background:linear-gradient(180deg,#101218,#0d0e13)}
.srf-workflows .empty .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint)}
.srf-workflows .empty p{color:var(--ink-dim);font-size:13px;max-width:440px;margin:10px auto 20px}
`;
