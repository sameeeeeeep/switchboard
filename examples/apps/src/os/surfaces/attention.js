// Needs-attention surface — the action inbox. What · why · one action.
// Blocking first, then failures, then your call; dismiss is undoable.
// Ported from wf-attention.html. SAMPLE.bands is shaped to later come from a Bank query of open asks.
// Empty state is the state the OS wants you in: "You're clear — nothing needs you."

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// each item: mk glyph, ttHtml (label + text), why/src meta, detail (revealed by the why link), acts (buttons).
// each act: t (label), tone/pri (accent), done (past-tense confirmation shown briefly), app/route (launch/navigate).
// Approve/Deny/etc. resolve inline; Grant/Decide/Review name a wrapp and launch it via data-app; Edit/Open navigate via data-route.
const SAMPLE = {
  bands: [
    {
      id: "blocking", mk: "▲", mkColor: "var(--danger)", lb: "Blocking", hint: "act to continue",
      items: [
        { mk: "⚠", mkColor: "var(--danger)", ttHtml: "<b>Approve:</b> CopyFlow wants to send 3 launch emails", why: "why…", detail: "3 emails were drafted for the IndEur launch and queued by a routine. Approve to send them now, or Deny to hold.", src: "◦ from Routine · IndEur launch", acts: [{ t: "Approve", tone: "lime", pri: 1, done: "Approved" }, { t: "Deny", done: "Dismissed" }] },
        { mk: "⚠", mkColor: "var(--danger)", ttHtml: "<b>Regrant:</b> Prism lost its model access", why: "why…", detail: "Prism's model grant was revoked, so image generation is paused. Regrant opens Prism to restore access.", src: "◦ from Apps · Prism", acts: [{ t: "Grant", tone: "indigo", pri: 1, app: "Prism", done: "Opening Prism…" }, { t: "Later", done: "Snoozed" }] },
      ],
    },
    {
      id: "failed", mk: "●", mkColor: "var(--amber)", lb: "Failed", hint: "retry or investigate",
      items: [
        { mk: "✗", mkColor: "var(--amber)", ttHtml: 'Routine <b>"Sheet sync"</b> failed 11:40', why: "log…", detail: "11:40 — the auth token expired mid-run. Retry re-runs the routine now; Pause stops the schedule.", src: "◦ from Routines", acts: [{ t: "Retry", tone: "lime", pri: 1, done: "Retrying…" }, { t: "Pause", done: "Paused" }] },
        { mk: "✗", mkColor: "var(--amber)", ttHtml: 'Workflow <b>"Launch deck"</b> failed at step 3', why: "log…", detail: "Step 3 (export slides) threw a timeout. Retry the step, or Edit opens the workflow to fix it.", src: "◦ from Workflows", acts: [{ t: "Retry", tone: "lime", pri: 1, done: "Retrying…" }, { t: "Edit", route: "workflows", done: "Opening Workflows…" }] },
      ],
    },
    {
      id: "waiting", mk: "○", mkColor: "var(--ink-dim)", lb: "Waiting", hint: "your call, not blocking",
      items: [
        { mk: "◆", mkColor: "var(--ink-dim)", ttHtml: '<b>Decide:</b> pick a launch date for IndEur Club <span class="mut">(a / b / c)</span>', why: "options…", detail: "a) Sep 12 · b) Sep 19 · c) Sep 26 — ideabrain has the reasoning for each. Decide opens it.", src: "◦ from ideabrain", acts: [{ t: "Decide", tone: "indigo", pri: 1, app: "ideabrain", done: "Opening ideabrain…" }] },
        { mk: "☐", mkColor: "var(--ink-dim)", ttHtml: '<b>Overdue:</b> Reply to the venue email <span class="mut">(2 days)</span>', src: "◦ from Tasks · #indeur", acts: [{ t: "Open", route: "tasks", done: "Opening Tasks…" }, { t: "Snooze", done: "Snoozed" }] },
        { mk: "▭", mkColor: "var(--ink-dim)", ttHtml: "<b>Review:</b> 4 marks from the Crest batch", why: "preview…", detail: "4 new marks are awaiting review in the Crest batch. Review opens Crest to approve or send back.", src: "◦ from Crest", acts: [{ t: "Review", tone: "lime", pri: 1, app: "Crest", done: "Opening Crest…" }] },
      ],
    },
  ],
};

function actBtn(a) {
  const cls = "btn" + (a.pri ? " pri " + (a.tone || "") : "");
  let attrs = "";
  if (a.app) attrs += ' data-app="' + esc(a.app) + '"';
  if (a.route) attrs += ' data-route="' + esc(a.route) + '"';
  attrs += ' data-done="' + esc(a.done || a.t) + '"';
  return '<span class="' + cls + '" data-act="' + esc(a.t) + '"' + attrs + ">" + esc(a.t) + "</span>";
}

function itemHtml(it) {
  const sub = [];
  if (it.why) sub.push('<span class="why">' + esc(it.why) + "</span>");
  sub.push('<span class="src">' + esc(it.src) + "</span>");
  const whybox = it.detail ? '<div class="whybox">' + esc(it.detail) + "</div>" : "";
  return '<div class="item">'
    + '<span class="mk" style="color:' + it.mkColor + '">' + esc(it.mk) + "</span>"
    + '<div class="body"><div class="tt">' + it.ttHtml + '</div><div class="sub">' + sub.join("") + "</div>" + whybox + "</div>"
    + '<div class="acts">' + it.acts.map(actBtn).join("") + "</div></div>";
}

function bandHtml(b) {
  return '<div class="band ' + b.id + '" data-band="' + b.id + '">'
    + '<div class="bh"><span class="mk" style="color:' + b.mkColor + '">' + esc(b.mk) + '</span>'
    + '<span class="lb">' + esc(b.lb) + '</span><span class="hint">' + esc(b.hint) + '</span>'
    + '<span class="n">' + b.items.length + "</span></div>"
    + b.items.map(itemHtml).join("") + "</div>";
}

const CLEAR = '<div class="clear"><div class="glyph">✓</div><div class="ct">You\'re clear — nothing needs you.</div>'
  + '<div class="cs">the rail badge disappears · the Home strip hides · this is the state the OS wants you in</div></div>';

export function render(DATA) {
  const total = SAMPLE.bands.reduce((n, b) => n + b.items.length, 0);
  const body = total
    ? SAMPLE.bands.filter((b) => b.items.length).map(bandHtml).join("")
    : CLEAR;
  return '<div class="srf-attention"><main>'
    + '<div class="shd">'
    + '<span class="kk">◦ Needs attention · <b>' + total + " item" + (total === 1 ? "" : "s") + "</b></span>"
    + '<span class="grpsel" data-filter="all">Show: All ▾</span>'
    + '<span class="clearread">Clear read</span>'
    + "</div>"
    + '<div class="stack">' + body + "</div>"
    + '<div class="foot">the action inbox · blocking first, then failures, then your call · every item is what · why · one action · dismiss is undoable</div>'
    + "</main></div>";
}

export function wire(root) {
  const surf = root.querySelector(".srf-attention");
  if (!surf) return;
  const stack = surf.querySelector(".stack");
  const header = surf.querySelector(".shd .kk b");
  const grpsel = surf.querySelector(".grpsel");
  const clearread = surf.querySelector(".clearread");

  function recount() {
    let total = 0;
    surf.querySelectorAll(".band").forEach((band) => {
      const n = band.querySelectorAll(".item").length;
      if (!n) { band.remove(); return; }
      total += n;
      const cnt = band.querySelector(".bh .n");
      if (cnt) cnt.textContent = String(n);
    });
    if (header) header.textContent = total + " item" + (total === 1 ? "" : "s");
    if (!total) stack.innerHTML = CLEAR;
  }

  // Collapse a row with a brief "done" state, then remove it and recount.
  function resolve(item, label) {
    if (!item || item.classList.contains("resolving")) return;
    item.classList.add("resolving");
    const acts = item.querySelector(".acts");
    if (acts) acts.innerHTML = '<span class="donetag">✓ ' + esc(label) + "</span>";
    setTimeout(() => { item.classList.add("gone"); }, 460);
    setTimeout(() => { item.remove(); recount(); }, 740);
  }

  surf.addEventListener("click", (e) => {
    // why/log/options/preview link → toggle the inline detail box.
    const why = e.target.closest(".why");
    if (why) {
      const body = why.closest(".body");
      const box = body && body.querySelector(".whybox");
      if (box) box.classList.toggle("open");
      return;
    }

    // action button → resolve the row (global handler launches any data-app / data-route).
    const btn = e.target.closest(".btn[data-act]");
    if (btn) {
      const item = btn.closest(".item");
      const done = btn.getAttribute("data-done") || btn.getAttribute("data-act") || "Done";
      console.log("[attention] " + btn.getAttribute("data-act") + " →", (item && item.querySelector(".tt")?.textContent || "").trim());
      resolve(item, done);
      return;
    }
  });

  // Filter control — cycles which band is shown (All → Blocking → Failed → Waiting).
  if (grpsel) {
    const order = ["all", "blocking", "failed", "waiting"];
    const label = { all: "All", blocking: "Blocking", failed: "Failed", waiting: "Waiting" };
    grpsel.addEventListener("click", () => {
      const cur = grpsel.getAttribute("data-filter") || "all";
      const next = order[(order.indexOf(cur) + 1) % order.length];
      grpsel.setAttribute("data-filter", next);
      grpsel.textContent = "Show: " + label[next] + " ▾";
      surf.querySelectorAll(".band").forEach((band) => {
        band.style.display = (next === "all" || band.dataset.band === next) ? "" : "none";
      });
    });
  }

  // Clear read — dismisses every visible item, landing on the empty state.
  if (clearread) {
    clearread.addEventListener("click", () => {
      const items = surf.querySelectorAll(".item:not(.resolving)");
      if (!items.length) return;
      items.forEach((it) => resolve(it, "Cleared"));
    });
  }
}

export const css = `<style>
.srf-attention{--amber:#e8b04a}
.srf-attention main{padding:6px clamp(18px,4vw,44px) 0}
.srf-attention .shd{display:flex;align-items:center;gap:12px;margin-top:6px;padding-bottom:14px;border-bottom:1px solid var(--edge-soft)}
.srf-attention .kk{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim)}
.srf-attention .kk b{color:var(--ink)}
.srf-attention .grpsel{margin-left:auto;font-size:12px;color:var(--ink-sec);border:1px solid var(--edge);background:var(--panel);border-radius:8px;padding:5px 10px;cursor:pointer}
.srf-attention .grpsel:hover{border-color:var(--ink-faint);color:var(--ink)}
.srf-attention .clearread{font-size:12px;color:var(--ink-dim);border:1px solid var(--edge);background:var(--panel);border-radius:8px;padding:5px 10px;cursor:pointer}
.srf-attention .clearread:hover{border-color:var(--ink-faint);color:var(--ink)}
.srf-attention .band{margin-top:22px}
.srf-attention .bh{display:flex;align-items:center;gap:9px;margin-bottom:11px}
.srf-attention .bh .mk{font-size:12px}
.srf-attention .bh .lb{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-sec)}
.srf-attention .bh .hint{font-size:11px;color:var(--ink-faint)}
.srf-attention .bh .n{font-family:var(--mono);font-size:10px;color:var(--ink-faint);background:var(--panel);border:1px solid var(--edge);border-radius:20px;padding:0 7px}
.srf-attention .item{display:flex;align-items:center;gap:13px;background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:12px 15px;margin-bottom:9px;max-height:260px;overflow:hidden;transition:opacity .24s ease,max-height .28s ease,margin .28s ease,padding .28s ease,border-width .28s ease}
.srf-attention .item.resolving{opacity:.6}
.srf-attention .item.gone{max-height:0;opacity:0;margin-top:0;margin-bottom:0;padding-top:0;padding-bottom:0;border-width:0}
.srf-attention .item .mk{width:16px;text-align:center;flex:0 0 auto;font-family:var(--mono);font-size:13px}
.srf-attention .item .body{min-width:0;flex:1}
.srf-attention .item .tt{font-size:13.5px;color:var(--ink)}
.srf-attention .item .tt b{font-weight:600}
.srf-attention .item .tt .mut{color:var(--ink-dim)}
.srf-attention .item .sub{display:flex;align-items:center;gap:9px;margin-top:4px;font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-attention .item .why{color:var(--ink-dim);cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px}
.srf-attention .item .why:hover{color:var(--ink-sec)}
.srf-attention .item .src{color:var(--ink-faint)}
.srf-attention .item .whybox{display:none;margin-top:9px;padding:8px 11px;background:var(--raised);border-left:2px solid var(--edge);border-radius:8px;font-size:12px;color:var(--ink-sec);line-height:1.45}
.srf-attention .item .whybox.open{display:block}
.srf-attention .acts{display:flex;gap:8px;flex:0 0 auto}
.srf-attention .donetag{font-family:var(--mono);font-size:11px;color:var(--ok);white-space:nowrap}
.srf-attention .btn{font-size:12px;border-radius:8px;padding:6px 13px;cursor:pointer;white-space:nowrap;border:1px solid var(--edge);background:var(--raised);color:var(--ink-sec);transition:filter .15s ease,border-color .15s ease,color .15s ease}
.srf-attention .btn:hover{border-color:var(--ink-faint);color:var(--ink)}
.srf-attention .btn.pri{color:#0b0c10;font-weight:600;border:0}
.srf-attention .btn.pri:hover{filter:brightness(1.08)}
.srf-attention .btn.lime{background:var(--lime)}
.srf-attention .btn.indigo{background:var(--indigo);color:#fff}
.srf-attention .btn.danger{background:var(--danger);color:#fff}
.srf-attention .band.blocking .item{border-left:2px solid var(--danger)}
.srf-attention .band.failed .item{border-left:2px solid var(--amber)}
.srf-attention .band.waiting .item{border-left:2px solid var(--edge)}
.srf-attention .clear{margin-top:40px;border:1px dashed #2a3a15;border-radius:16px;padding:34px 24px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;background:linear-gradient(180deg,#0f1213,#0c0e0d)}
.srf-attention .clear .glyph{width:52px;height:52px;border-radius:14px;background:#141a10;border:1px solid #2a3a15;display:grid;place-items:center;color:var(--lime);font-size:24px}
.srf-attention .clear .ct{font-size:15px;color:var(--ink)}
.srf-attention .clear .cs{font-family:var(--mono);font-size:10.5px;color:var(--ink-faint)}
.srf-attention .foot{margin-top:34px;color:var(--ink-faint);font-size:11.5px;font-family:var(--mono)}
</style>`;
