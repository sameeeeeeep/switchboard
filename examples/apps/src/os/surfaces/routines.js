// Switchboard OS surface — Routines.
// The automation monitor: rows for things that run without you, each showing
// its state (active / running / waiting-for-consent / paused-failed), its
// schedule + last/next fire, its grant bundle (the trust contract), and the
// one or two actions that make sense in that state. Failures escalate to Needs
// attention. Empty state → a Create CTA.
//
// Self-contained ES module: exports render(DATA), css, wire(root).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ---------------------------------------------------------------------------
// SAMPLE routines — local; swap for real daemon reads later.
// state ∈ active | running | waiting | paused (paused carries a fail count)
// ---------------------------------------------------------------------------
const SAMPLE = [
  {
    id: "daily-brief", name: "Daily brief", state: "active",
    sched: [
      "⏱ <b>every day 08:00</b>",
      'last <span class="ok">✓ today 08:00</span>',
      "next <b>tomorrow 08:00</b> · in 11h",
    ],
    outs: 'outputs: <a>5 briefs</a> · latest "Tue market + inbox digest"',
    grant: [["⛁", "sb_http"], ["✎", "Bank write"]],
    acts: [["Run now", "pri", "run"], ["Pause", "", "pause"], ["Edit", "", "edit"]],
  },
  {
    id: "email-triage", name: "Email triage", state: "running",
    sched: [
      "⏱ <b>on new mail</b>",
      "running since <b>14:20</b> · step 2 of 3",
      'last <span class="ok">✓ 12:05</span>',
    ],
    outs: "grant holds ActionConsent per outbound send — each reply is gated",
    grant: [["✉", "email connector"], ["⛊", "ActionConsent / send"]],
    acts: [["Open log", "", "log"], ["Pause", "", "pause"]],
  },
  {
    id: "invoice-filer", name: "Invoice filer", state: "waiting",
    sched: [
      "⏱ <b>on receipt email</b>",
      "held <b>since 10:14</b>",
      "needs a consent it can't get unattended",
    ],
    attn: "◐ waiting → grant needed: Drive write (folder /Receipts) · holds, does not proceed",
    grant: [["⛁", "email read"], ["?", "Drive write — ungranted"]],
    acts: [["Grant & continue", "pri", "grant"], ["Open log", "", "log"]],
  },
  {
    id: "weekly-deck", name: "Weekly deck", state: "paused", pill: "paused · 3 fails",
    sched: [
      "⏱ <b>Mondays 09:00</b>",
      'last <span class="bad">✗ step 2 (Prism: no model)</span>',
      "auto-paused after 3 consecutive fails",
    ],
    attn: "✗ escalated to Needs attention · Retry / Edit / Resolve the model requirement",
    grant: [["▥", "Prism"], ["✎", "Bank write"]],
    acts: [["Resume", "pri", "resume"], ["Edit", "", "edit"], ["Revoke", "warn", "revoke"]],
  },
];

const DOT = { active: "lime", running: "ind", waiting: "am", paused: "red" };
const PILL_LABEL = { active: "active", running: "running…", waiting: "waiting for you" };

// Nav-type actions carry a data-route so the OS shell's global handler navigates.
// State-type actions (run/pause/resume/grant/revoke) are flipped live in wire().
const ACT_ROUTE = { log: "history", edit: "workflows" };

function routineRow(r) {
  const cls = r.state === "paused" ? "failed" : r.state; // paused rows read as the failed register
  const pillLabel = r.pill || PILL_LABEL[r.state] || r.state;
  const pillCls = r.state === "paused" ? "failed" : r.state;
  const grant = r.grant.map(([lock, t]) => '<span class="g"><span class="lock">' + esc(lock) + "</span>" + esc(t) + "</span>").join("");
  const acts = r.acts.map(([label, k, act]) => {
    const route = ACT_ROUTE[act];
    return '<button class="btn' + (k ? " " + k : "") + '" data-act="' + act + '"'
      + (route ? ' data-route="' + route + '"' : "") + ">" + esc(label) + "</button>";
  }).join("");
  const outs = r.outs ? r.outs.replace(/<a>/g, '<a data-route="history">') : "";
  return '<div class="r ' + cls + '" data-routine="' + esc(r.id) + '" data-state="' + esc(r.state) + '">'
    + '<div class="hd" data-route="history" title="See this routine’s runs"><div class="ic">⟳</div><div class="nm">' + esc(r.name) + "</div>"
    + '<div class="pill ' + pillCls + '"><span class="dt ' + DOT[r.state] + '"></span>' + esc(pillLabel) + "</div></div>"
    + '<div class="sched">' + r.sched.map((s) => "<span>" + s + "</span>").join("") + "</div>"
    + (outs ? '<div class="outs">' + outs + "</div>" : "")
    + (r.attn ? '<div class="attn">' + esc(r.attn) + "</div>" : "")
    + '<div class="foot-r"><div class="grant">' + grant + '</div><div class="acts">' + acts + "</div></div>"
    + "</div>";
}

// Create a routine = record/edit a flow → the Workflows surface.
const CREATE = '<div class="create" data-act="create" data-route="workflows"><span class="p">+</span>'
  + "<div><b>Create a routine</b> — record a flow (CopyFlow) or promote an autopilot. "
  + 'Or start from a template: <span class="tpl">Daily brief · Email triage · Weekly report</span></div></div>';

export function render(DATA) {
  const list = (DATA && DATA.routines) || SAMPLE;
  const active = list.filter((r) => r.state === "active").length;

  let head = '<div class="shead"><span class="kick">Routines</span><h1>Runs without me</h1>'
    + '<span class="n">' + active + " active</span>"
    + '<div class="filters"><div class="seg"><span class="on">All</span><span>Active</span><span>Paused</span><span>Failed</span></div>'
    + '<div class="srch">⌕</div></div></div><div class="rule"></div>';

  let body;
  if (!list.length) {
    // graceful empty state — nothing runs yet, so the whole surface IS the Create door.
    body = '<div class="empty"><div class="eyebrow">nothing runs without you yet</div>'
      + "<p>A routine is a flow that fires on a schedule or a trigger and carries a standing grant — so it can act while you're away.</p>"
      + CREATE + "</div>";
  } else {
    body = '<div class="rows">' + list.map(routineRow).join("") + "</div>" + CREATE;
  }

  return '<div class="srf-routines">' + head + body + "</div>";
}

export function wire(root) {
  const el = root.querySelector(".srf-routines");
  if (!el) return;

  // Which filter bucket a row belongs to, read from its live register class.
  // active+running = "active"; failed (paused-with-fails) = "failed";
  // paused + waiting = "paused". Recomputed on every state flip so rows move.
  const group = (row) => {
    if (row.classList.contains("active") || row.classList.contains("running")) return "active";
    if (row.classList.contains("failed")) return "failed";
    return "paused"; // paused + waiting
  };

  // Apply the currently-selected segment: show/hide rows, refresh the count.
  const applyFilter = () => {
    const on = el.querySelector(".seg span.on");
    const seg = on ? on.textContent.trim() : "All";
    el.querySelectorAll(".rows .r").forEach((row) => {
      const g = group(row);
      const show = seg === "All"
        || (seg === "Active" && g === "active")
        || (seg === "Paused" && g === "paused")
        || (seg === "Failed" && g === "failed");
      row.classList.toggle("hide", !show);
    });
    const n = el.querySelector(".shead .n");
    if (n) {
      const c = [...el.querySelectorAll(".rows .r")].filter((r) => group(r) === "active").length;
      n.textContent = c + " active";
    }
  };

  const setPill = (row, cls, dot, label) => {
    const pill = row.querySelector(".pill");
    if (pill) { pill.className = "pill " + cls; pill.innerHTML = '<span class="dt ' + dot + '"></span>' + label; }
  };
  const dropAttn = (row) => { const a = row.querySelector(".attn"); if (a) a.remove(); };
  const setState = (row, register, state) => { row.className = "r " + register; row.setAttribute("data-state", state); };

  el.addEventListener("click", (e) => {
    // filter segments — real show/hide filtering
    const seg = e.target.closest(".seg span");
    if (seg) {
      seg.parentElement.querySelectorAll("span").forEach((s) => s.classList.remove("on"));
      seg.classList.add("on");
      applyFilter();
      return;
    }

    // search — pressed affordance (real toggle, not inert)
    const srch = e.target.closest(".srch");
    if (srch) { srch.classList.toggle("on"); return; }

    // row action buttons — optimistic local state flip so the monitor feels live.
    // (log / edit / create carry data-route; the OS shell handles their nav.)
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    const row = btn.closest(".r");
    if (!row) return;

    if (act === "pause") {
      setState(row, "paused", "paused");
      setPill(row, "paused", "gr", "paused");
      dropAttn(row);
      applyFilter();
    } else if (act === "resume") {
      setState(row, "active", "active");
      setPill(row, "active", "lime", "active");
      dropAttn(row);
      applyFilter();
    } else if (act === "run") {
      setState(row, "running", "running");
      setPill(row, "running", "ind", "running…");
      btn.disabled = true;
      applyFilter();
      setTimeout(() => {
        setState(row, "active", "active");
        setPill(row, "active", "lime", "ran ✓ just now");
        btn.disabled = false;
        applyFilter();
      }, 1200);
    } else if (act === "grant") {
      // consent obtained → the held routine proceeds
      setState(row, "running", "running");
      setPill(row, "running", "ind", "running…");
      const ung = [...row.querySelectorAll(".g")].find((g) => /ungranted/i.test(g.textContent));
      if (ung) ung.innerHTML = '<span class="lock">⛁</span>Drive write ✓';
      dropAttn(row);
      applyFilter();
    } else if (act === "revoke") {
      setState(row, "paused", "paused");
      setPill(row, "paused", "gr", "revoked");
      dropAttn(row);
      applyFilter();
    }
  });
}

export const css = `
.srf-routines{
  --panel:#12151C; --raised:#1A1F29; --edge:#262C38; --edge-soft:#1C212B;
  --ink:#E8EDF4; --ink-sec:#B4BECE; --ink-dim:#99A3B7; --ink-faint:#6E7C90;
  --lime:#C8F250; --indigo:#5B4FE8; --danger:#FF2D6E; --amber:#F59E0B;
  --mono:"Spline Sans Mono",ui-monospace,Menlo,monospace;
}
.srf-routines .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-routines .shead{display:flex;align-items:center;gap:14px;margin:10px 0 6px}
.srf-routines .shead h1{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0}
.srf-routines .shead .n{font-family:var(--mono);font-size:11px;color:var(--ink-dim);border:1px solid var(--edge);border-radius:20px;padding:2px 10px}
.srf-routines .filters{margin-left:auto;display:flex;gap:6px;align-items:center}
.srf-routines .seg{display:flex;background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:2px}
.srf-routines .seg span{font-size:12px;padding:4px 11px;border-radius:7px;color:var(--ink-dim);cursor:pointer;transition:color .12s ease,background .12s ease}
.srf-routines .seg span:hover:not(.on){color:var(--ink-sec)}
.srf-routines .seg span.on{background:var(--raised);color:var(--ink)}
.srf-routines .srch{width:30px;height:30px;border-radius:8px;border:1px solid var(--edge);background:var(--panel);display:grid;place-items:center;color:var(--ink-dim);font-size:13px;cursor:pointer;transition:color .12s ease,border-color .12s ease,background .12s ease}
.srf-routines .srch:hover{color:var(--ink-sec);border-color:var(--ink-faint)}
.srf-routines .srch.on{color:var(--ink);border-color:var(--ink-faint);background:var(--raised)}
.srf-routines .rule{height:1px;background:var(--edge-soft);margin:14px 0 18px}
.srf-routines .rows{display:flex;flex-direction:column;gap:12px}
.srf-routines .r.hide{display:none}
.srf-routines .r{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:15px 17px;border-left:2px solid var(--edge)}
.srf-routines .r.active{border-left-color:var(--lime)}
.srf-routines .r.running{border-left-color:var(--indigo)}
.srf-routines .r.paused{border-left-color:var(--ink-faint)}
.srf-routines .r.failed{border-left-color:var(--danger)}
.srf-routines .r.waiting{border-left-color:var(--amber)}
.srf-routines .r .hd{display:flex;align-items:center;gap:11px;cursor:pointer}
.srf-routines .r .hd:hover .nm{color:var(--indigo)}
.srf-routines .r .hd:hover .ic{color:var(--ink);border-color:var(--ink-faint)}
.srf-routines .r .ic{width:30px;height:30px;border-radius:9px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--ink-sec);font-size:14px;flex:0 0 auto;transition:color .12s ease,border-color .12s ease}
.srf-routines .r.running .ic{color:var(--ink);animation:rt-spin 2.4s linear infinite}
@keyframes rt-spin{to{transform:rotate(360deg)}}
.srf-routines .r .nm{font-size:14.5px;font-weight:600}
.srf-routines .r .pill{margin-left:auto;font-family:var(--mono);font-size:10.5px;letter-spacing:.04em;padding:3px 10px;border-radius:20px;display:flex;align-items:center;gap:6px}
.srf-routines .pill.active{color:var(--lime);background:#1b2410;border:1px solid #33461a}
.srf-routines .pill.running{color:#bcb4ff;background:#171633;border:1px solid #2c2a55}
.srf-routines .pill.paused{color:var(--ink-dim);background:var(--raised);border:1px solid var(--edge)}
.srf-routines .pill.failed{color:var(--danger);background:#2a1418;border:1px solid #52222b}
.srf-routines .pill.waiting{color:var(--amber);background:#2a1f10;border:1px solid #4a3312}
.srf-routines .dt{width:6px;height:6px;border-radius:50%}
.srf-routines .dt.lime{background:var(--lime);box-shadow:0 0 6px 1px rgba(200,242,80,.6)}
.srf-routines .dt.ind{background:var(--indigo);box-shadow:0 0 6px 1px rgba(91,79,232,.7)}
.srf-routines .dt.red{background:var(--danger)}
.srf-routines .dt.am{background:var(--amber)}
.srf-routines .dt.gr{background:var(--ink-faint)}
.srf-routines .sched{display:flex;gap:14px;flex-wrap:wrap;margin:11px 0 0 41px;font-size:12.5px;color:var(--ink-dim)}
.srf-routines .sched b{color:var(--ink-sec);font-weight:500}
.srf-routines .sched .ok{color:var(--lime)}
.srf-routines .sched .bad{color:var(--danger)}
.srf-routines .foot-r{display:flex;align-items:center;gap:10px;margin:12px 0 0 41px;flex-wrap:wrap}
.srf-routines .grant{display:flex;gap:6px;flex-wrap:wrap}
.srf-routines .g{font-family:var(--mono);font-size:10.5px;color:var(--ink-sec);background:var(--raised);border:1px solid var(--edge);border-radius:6px;padding:2px 8px;display:flex;align-items:center;gap:5px}
.srf-routines .g .lock{color:var(--ink-faint)}
.srf-routines .acts{margin-left:auto;display:flex;gap:7px}
.srf-routines .btn{font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid var(--edge);background:var(--raised);color:var(--ink-sec);cursor:pointer;white-space:nowrap;transition:border-color .12s ease,color .12s ease,filter .12s ease}
.srf-routines .btn:hover:not(:disabled){border-color:var(--ink-faint);color:var(--ink);filter:brightness(1.12)}
.srf-routines .btn:disabled{opacity:.6;cursor:default}
.srf-routines .btn.pri{background:#1b2410;border-color:#33461a;color:var(--lime)}
.srf-routines .btn.warn{background:#2a1418;border-color:#52222b;color:var(--danger)}
.srf-routines .outs{margin:10px 0 0 41px;font-size:12px;color:var(--ink-faint)}
.srf-routines .outs a{color:var(--indigo);text-decoration:none;cursor:pointer}
.srf-routines .outs a:hover{text-decoration:underline}
.srf-routines .attn{margin:9px 0 0 41px;font-size:11.5px;color:var(--danger);font-family:var(--mono)}
.srf-routines .create{margin-top:16px;border:1px dashed var(--edge);border-radius:13px;padding:15px 17px;display:flex;align-items:center;gap:12px;color:var(--ink-dim);font-size:13px;cursor:pointer;transition:border-color .12s ease,background .12s ease}
.srf-routines .create:hover{border-color:var(--ink-faint);background:var(--raised)}
.srf-routines .create .p{width:26px;height:26px;border-radius:8px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--lime);font-size:15px;flex:0 0 auto}
.srf-routines .create b{color:var(--ink-sec);font-weight:500}
.srf-routines .create .tpl{color:var(--ink-sec)}
.srf-routines .empty{border:1px solid var(--edge-soft);border-radius:16px;padding:34px;text-align:center;background:linear-gradient(180deg,#101218,#0d0e13)}
.srf-routines .empty .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint)}
.srf-routines .empty p{color:var(--ink-dim);font-size:13px;max-width:440px;margin:10px auto 20px}
.srf-routines .empty .create{max-width:520px;margin:0 auto;text-align:left}
`;
