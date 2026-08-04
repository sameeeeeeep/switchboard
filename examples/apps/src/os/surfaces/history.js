// History surface — a receipt for every God / wrapp run, grouped by day.
// Click a row to expand its full receipt. Ported from wf-history.html.
// Self-contained ES module: render(DATA) -> HTML string, css, wire(root).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

const HUE = { brandbrain: "#E8B04A", Crest: "#E0764A", Flow: "#A8D84A", God: "#6C5CE7", AdForge: "#F2994A", ideabrain: "#4A90E0", Prism: "#9B5DE5", Redline: "#FF5A6E" };
const GLYPH = { image: "▭", text: "▤", notes: "▤", mark: "◈", doc: "▦", gallery: "▤" };

// Local sample: run receipts by day (real Bank history reads later)
const SAMPLE = {
  days: [
    { day: "Today", runs: [
      { tm: "14:22", wrapp: "Prism", prompt: "make a launch hero — terracotta beam", kind: "image", result: "image", receipt: { params: ["ref: brand-set", "ar 3:2", "model: nano_banana"], out: "artifact-0447.png · 1536×1024", prov: "IndEur Club · lent: brand-set, palette · 8.4k tokens" } },
      { tm: "13:58", wrapp: "Crest", prompt: "tighten the switch-ligature monogram", kind: "mark", result: "mark", receipt: { params: ["ref: mark-v3", "vector", "model: nano_banana"], out: "monogram-v4.svg · 512×512", prov: "IndEur Club · lent: brand-set · 3.1k tokens" } },
      { tm: "11:05", wrapp: "Redline", prompt: "audit the founding-members deck", kind: "notes", result: "notes", receipt: { params: ["scope: deck", "12 slides"], out: "9 notes · 2 blockers", prov: "IndEur Club · lent: pricing-thesis · 6.0k tokens" } },
      { tm: "09:40", wrapp: "God", prompt: "what did we decide about the Q4 event cities?", kind: "text", result: "text", receipt: { params: ["recall", "scope: project"], out: "3 cities: Berlin, Amsterdam, Lisbon", prov: "IndEur Club · lent: meetup-notes · 2.2k tokens" } },
    ] },
    { day: "Yesterday", runs: [
      { tm: "18:40", wrapp: "God", prompt: "summarize the week for IndEur", kind: "text", result: "text", receipt: { params: ["recall", "range: 7d"], out: "weekly-digest.md", prov: "IndEur Club · lent: brain × 14 · 5.8k tokens" } },
      { tm: "16:12", wrapp: "AdForge", prompt: '"Find your people" — 3 ad variants', kind: "doc", result: "ad set", receipt: { params: ["variants: 3", "tone: warm"], out: "ad-set-0331 · 3 variants", prov: "IndEur Club · lent: voice-scratch · 4.4k tokens" } },
      { tm: "10:03", wrapp: "ideabrain", prompt: "validate the membership pricing thesis", kind: "doc", result: "doc", receipt: { params: ["research", "cohort: EU"], out: "pricing-thesis.md", prov: "IndEur Club · lent: audience · 9.1k tokens" } },
    ] },
    { day: "Mon · Aug 1", runs: [
      { tm: "21:15", wrapp: "brandbrain", prompt: "draft the launch announcement post", kind: "text", result: "text", receipt: { params: ["channel: IG", "tone: warm"], out: "launch-post.md", prov: "IndEur Club · lent: voice-scratch · 3.3k tokens" } },
      { tm: "15:47", wrapp: "Crest", prompt: "generate 4 logo directions", kind: "gallery", result: "4 marks", receipt: { params: ["variants: 4", "vector"], out: "marks-0208 · 4 marks", prov: "IndEur Club · lent: brand-set · 5.0k tokens" } },
      { tm: "12:30", wrapp: "Flow", prompt: "transcribe the community meetup notes", kind: "notes", result: "notes", receipt: { params: ["source: audio", "18m"], out: "meetup-notes.md", prov: "IndEur Club · lent: — · 1.7k tokens" } },
    ] },
  ],
};

function runRow(r, i) {
  const h = HUE[r.wrapp] || "#8a93a6";
  const rc = r.receipt;
  const receipt = '<div class="receipt">'
    + '<div><div class="rlbl">Input</div><div class="rval">"' + esc(r.prompt) + '"</div></div>'
    + '<div><div class="rlbl">Params</div><div class="rval">' + rc.params.map((p) => '<code>' + esc(p) + '</code>').join(" ") + '</div></div>'
    + '<div><div class="rlbl">Result</div><div class="rval">' + esc(r.result) + ' → ' + esc(rc.out) + '</div></div>'
    + '<div><div class="rlbl">Provenance</div><div class="rval">' + esc(rc.prov) + '</div></div>'
    + '</div>';
  const search = escAttr((r.prompt + " " + r.wrapp + " " + r.result + " " + rc.out).toLowerCase());
  return '<div class="run" data-run="' + i + '" data-wrapp="' + escAttr(r.wrapp) + '" data-search="' + search + '">'
    + '<div class="tm">' + esc(r.tm) + '</div>'
    + '<div class="chip"><span class="dot" style="background:' + h + '"></span><span class="nm">' + esc(r.wrapp) + '</span></div>'
    + '<div class="prompt">"' + esc(r.prompt) + '"</div>'
    + '<div class="arrow">→</div>'
    + '<div class="result"><span class="g" style="background:' + h + '">' + (GLYPH[r.kind] || "▭") + '</span>' + esc(r.result) + '</div>'
    + '<div class="reopen" data-app="' + escAttr(r.wrapp) + '" title="Reopen ' + escAttr(r.wrapp) + '">Reopen ▸</div>'
    + receipt
    + '</div>';
}

export function render(DATA) {
  const empty = SAMPLE.days.every((d) => !d.runs.length);
  let h = '<div class="srf-history">';
  h += '<div class="hhead"><span class="kick">History</span><h1>Everything you\'ve run</h1>'
    + '<span class="scope" data-route="bank" title="View in Bank">◐ IndEur Club</span>'
    + '<div class="filters">'
    + '<div class="fl" data-fl="wrapp">wrapp <span class="cv">all ▾</span></div>'
    + '<div class="fl" data-fl="date">date <span class="cv">7d ▾</span></div>'
    + '<div class="fl" data-fl="search" title="Search runs">⌕</div>'
    + '<input class="hsearch" type="text" placeholder="search runs…" hidden>'
    + '</div></div>';

  if (empty) {
    h += '<div class="empty">No runs yet — every God or wrapp run lands here as a receipt you can reopen.</div>';
  } else {
    let idx = 0;
    for (const d of SAMPLE.days) {
      if (!d.runs.length) continue;
      h += '<div class="day" data-day="' + escAttr(d.day) + '" title="Collapse / expand"><span class="dcar">▾</span>' + esc(d.day) + '</div><div class="feed">';
      h += d.runs.map((r) => runRow(r, idx++)).join("");
      h += '</div>';
    }
    h += '<div class="nores" hidden>No runs match these filters.</div>';
  }
  h += '</div>';
  return h;
}

export function wire(root) {
  const surf = root.querySelector(".srf-history");
  if (!surf) return;

  // Row click expands its full receipt (Reopen is handled by the global data-app launcher).
  surf.querySelectorAll(".run").forEach((run) => {
    run.addEventListener("click", (e) => {
      if (e.target.closest(".reopen")) return; // reopen launches the wrapp via data-app
      run.classList.toggle("open");
    });
  });

  // ---- Filter state ----
  const days = [...surf.querySelectorAll(".day")];
  const wrapps = [];
  surf.querySelectorAll(".run").forEach((r) => {
    const w = r.dataset.wrapp;
    if (w && !wrapps.includes(w)) wrapps.push(w);
  });
  const wrappOpts = ["all", ...wrapps];
  const dateOpts = ["7d", ...days.map((d) => d.dataset.day)];
  let wrappIx = 0;
  let dateIx = 0;
  let query = "";
  const nores = surf.querySelector(".nores");
  const searchInput = surf.querySelector(".hsearch");

  function applyFilters() {
    const curWrapp = wrappOpts[wrappIx];
    const curDate = dateOpts[dateIx];
    const q = query.trim().toLowerCase();
    let totalVisible = 0;
    days.forEach((dayEl) => {
      const feed = dayEl.nextElementSibling; // .feed
      const dateOk = curDate === "7d" || curDate === dayEl.dataset.day;
      let shownInGroup = 0;
      feed.querySelectorAll(".run").forEach((run) => {
        const wOk = curWrapp === "all" || run.dataset.wrapp === curWrapp;
        const sOk = !q || (run.dataset.search || "").includes(q);
        const show = dateOk && wOk && sOk;
        run.style.display = show ? "" : "none";
        if (show) shownInGroup++;
      });
      const groupHasRows = dateOk && shownInGroup > 0;
      dayEl.style.display = groupHasRows ? "" : "none";
      feed.style.display = groupHasRows && !dayEl.classList.contains("collapsed") ? "" : "none";
      totalVisible += shownInGroup;
    });
    if (nores) nores.hidden = totalVisible > 0;
  }

  // Day header collapse / expand
  days.forEach((dayEl) => {
    dayEl.addEventListener("click", () => {
      dayEl.classList.toggle("collapsed");
      applyFilters();
    });
  });

  // wrapp filter chip — cycle through all / each wrapp
  const wrappFl = surf.querySelector('.fl[data-fl="wrapp"] .cv');
  surf.querySelector('.fl[data-fl="wrapp"]').addEventListener("click", () => {
    wrappIx = (wrappIx + 1) % wrappOpts.length;
    if (wrappFl) wrappFl.textContent = wrappOpts[wrappIx] + " ▾";
    applyFilters();
  });

  // date filter chip — cycle through 7d (all) / each day
  const dateFl = surf.querySelector('.fl[data-fl="date"] .cv');
  surf.querySelector('.fl[data-fl="date"]').addEventListener("click", () => {
    dateIx = (dateIx + 1) % dateOpts.length;
    if (dateFl) dateFl.textContent = dateOpts[dateIx] + " ▾";
    applyFilters();
  });

  // search chip — toggle an input that filters by prompt / wrapp / result text
  const searchChip = surf.querySelector('.fl[data-fl="search"]');
  searchChip.addEventListener("click", () => {
    const showing = !searchInput.hidden;
    if (showing && !query) {
      searchInput.hidden = true;
      searchChip.classList.remove("on");
    } else {
      searchInput.hidden = false;
      searchChip.classList.add("on");
      searchInput.focus();
    }
  });
  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    applyFilters();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      query = "";
      searchInput.hidden = true;
      searchChip.classList.remove("on");
      applyFilters();
    }
  });
}

export const css = `
.srf-history{padding-top:10px}
.srf-history .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-history .hhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.srf-history .hhead h1{font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-.02em;margin:0}
.srf-history .scope{font-size:12px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:8px;padding:4px 10px;cursor:pointer}
.srf-history .scope:hover{border-color:var(--indigo)}
.srf-history .filters{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.srf-history .fl{font-size:12px;color:var(--ink-sec);background:var(--panel);border:1px solid var(--edge);border-radius:8px;padding:6px 11px;cursor:pointer;display:flex;align-items:center;gap:6px}
.srf-history .fl:hover{border-color:#33384a;color:var(--ink)}
.srf-history .fl.on{border-color:var(--indigo);color:var(--ink)}
.srf-history .fl .cv{color:var(--ink-faint);font-family:var(--mono);font-size:10px}
.srf-history .hsearch{font-family:var(--mono);font-size:12px;color:var(--ink);background:#0f1116;border:1px solid var(--edge);border-radius:8px;padding:6px 11px;outline:none;min-width:180px}
.srf-history .hsearch:focus{border-color:var(--indigo)}
.srf-history .hsearch::placeholder{color:var(--ink-faint)}
.srf-history .day{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);margin:26px 0 12px;display:flex;align-items:center;gap:12px;cursor:pointer}
.srf-history .day:hover{color:var(--ink-sec)}
.srf-history .day .dcar{transition:transform .15s ease;font-size:9px;display:inline-block}
.srf-history .day.collapsed .dcar{transform:rotate(-90deg)}
.srf-history .day::after{content:"";flex:1;height:1px;background:var(--edge-soft)}
.srf-history .feed{display:flex;flex-direction:column;gap:8px}
.srf-history .run{display:flex;align-items:center;gap:14px;background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:12px 16px;cursor:pointer}
.srf-history .run:hover{border-color:#33384a}
.srf-history .run .tm{font-family:var(--mono);font-size:11px;color:var(--ink-faint);width:42px;flex:0 0 auto}
.srf-history .run .chip{display:flex;align-items:center;gap:7px;flex:0 0 auto;width:118px}
.srf-history .run .chip .dot{width:9px;height:9px;border-radius:3px}
.srf-history .run .chip .nm{font-size:12.5px;color:var(--ink-sec);font-weight:500}
.srf-history .run .prompt{font-size:13px;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srf-history .run .arrow{color:var(--ink-faint);font-family:var(--mono);font-size:12px}
.srf-history .run .result{display:flex;align-items:center;gap:7px;flex:0 0 auto;width:110px;font-size:12px;color:var(--ink-dim)}
.srf-history .run .result .g{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;color:#0c0d10;font-family:var(--mono)}
.srf-history .run .reopen{margin-left:auto;flex:0 0 auto;font-size:12px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:8px;padding:6px 12px;white-space:nowrap;cursor:pointer}
.srf-history .run .reopen:hover{border-color:var(--indigo);background:#1a1740}
.srf-history .receipt{display:none}
.srf-history .run.open{flex-wrap:wrap;align-items:flex-start;border-color:#33384a}
.srf-history .run.open .receipt{display:grid;flex-basis:100%;margin-top:14px;padding-top:14px;border-top:1px solid var(--edge-soft);grid-template-columns:1fr 1fr;gap:10px 24px}
.srf-history .receipt .rlbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-faint)}
.srf-history .receipt .rval{font-size:12.5px;color:var(--ink-sec);margin-top:4px}
.srf-history .receipt .rval code{font-family:var(--mono);font-size:11.5px;color:var(--ink);background:#0f1116;border:1px solid var(--edge);border-radius:5px;padding:1px 6px}
.srf-history .empty{margin-top:40px;padding:34px;text-align:center;font-size:13px;color:var(--ink-dim);border:1px dashed var(--edge);border-radius:14px;background:linear-gradient(180deg,#0e0f14,#0b0c11)}
.srf-history .nores{margin-top:20px;padding:24px;text-align:center;font-size:12.5px;color:var(--ink-dim);border:1px dashed var(--edge);border-radius:12px}
`;
