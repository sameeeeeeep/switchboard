/* eslint-disable */
// Drives every wrapp × project through a same-origin iframe, waits for its pipeline, asserts the
// success signal against the iframe's live DOM, and records a verdict. Results land on the page AND
// in window.__RESULTS__ (read back by the harness driver). Sequential so one shared <iframe> is
// reused and the machine isn't flooded with 40 concurrent app boots.

const PROJECTS = ["switchboard", "nailinit"];

// count() → number of "success" nodes; a positive count = the stage-1 pipeline rendered.
const CFG = {
  adforge:   { name: "AdForge",   cat: "founder-stack", count: (d) => d.querySelectorAll("#cards button.card, #cards .card").length },
  adgen:     { name: "Adwall",    cat: "founder-stack", count: (d) => d.querySelectorAll("#wall .tile").length },
  aplus:     { name: "A-Plus",    cat: "founder-stack", count: (d) => d.querySelectorAll("#dir-grid button.dir, #dir-grid .dir").length },
  imagegen:  { name: "Prism",     cat: "founder-stack", count: (d) => d.querySelectorAll("#concepts .concept").length },
  shelf:     { name: "Shelf",     cat: "founder-stack", count: (d) => d.querySelectorAll("#col-reorder .tagcard, #col-watch .tagcard, #col-dead .tagcard").length },
  studio:    { name: "Studio",    cat: "founder-stack", count: (d) => d.querySelectorAll("#look-cards .look:not(.skeleton)").length },
  reel:      { name: "Reel",      cat: "founder-stack", count: (d) => d.querySelectorAll(".q-card.scene").length || (/the scenes/i.test(txt(d)) ? 1 : 0) },
  marquee:   { name: "Marquee",   cat: "founder-stack", count: (d) => { const f = d.getElementById("mq-frame"); return f && ((f.srcdoc || f.getAttribute("srcdoc") || "").length > 60) ? 1 : 0; } },
  canvas:    { name: "Canvas",     cat: "tool", count: (d) => { const f = d.getElementById("cv-frame") || d.querySelector("iframe"); return f && ((f.srcdoc || f.getAttribute("srcdoc") || "").length > 60) ? 1 : 0; } },
  take:      { name: "Take",      cat: "founder-stack", count: (d) => /the script/i.test(txt(d)) ? d.querySelectorAll("#view .opt").length || 1 : 0 },
  identity:  { name: "Identity",  cat: "founder-stack", count: (d) => d.querySelectorAll("#view .q-card .opt, #view .opt").length },
  batch:     { name: "Batch",     cat: "founder-stack", count: (d) => d.querySelectorAll("#view .q-card").length },
  bank:      { name: "Bank",      cat: "founder-stack", count: (d) => d.querySelectorAll("#brief-out .briefline").length || (d.getElementById("brief-sec") && !d.getElementById("brief-sec").hidden ? 1 : 0) },
  redline:   { name: "Redline",   cat: "founder-stack", count: (d) => d.querySelectorAll("#side-body .dec").length },
  // no crutch: AdPulse diagnoses its own representative month on connect (live pull first when a
  // Meta connector exists), so the readout must appear with ZERO driving.
  adpulse:   { name: "AdPulse",   cat: "founder-stack", count: (d) => (d.getElementById("report") && !d.getElementById("report").hidden) ? 1 : (d.querySelectorAll("#stats .stat").length ? 0.5 : 0) },
  huddle:    { name: "Huddle",    cat: "chat", count: (d) => d.querySelectorAll(".turn.assistant .bubble").length },
  chat:      { name: "betterchat",cat: "chat", count: (d) => { const chips = d.querySelectorAll("#chips .chip").length; const rec = d.querySelector("#chips .chip.rec, #chips .rec"); const note = (d.getElementById("suggest-note") || {}).textContent || ""; const more = [...d.querySelectorAll("#chips *, button")].some((b) => /more like these/i.test(b.textContent || "")); return chips && (rec || more || /from |generic/i.test(note)) ? chips : 0; } },
  cartridge: { name: "Cartridge", cat: "play-make", count: (d) => d.querySelectorAll("#pitch-grid .pitch").length },
  arcana:    { name: "Arcana",    cat: "after-hours", count: (d) => (d.getElementById("reading") && !d.getElementById("reading").hidden) ? d.querySelectorAll("#reading .take").length || 1 : 0 },
  natal:     { name: "NATAL",     cat: "after-hours", form: true, count: (d) => (d.getElementById("chart") && !d.getElementById("chart").hidden) ? d.querySelectorAll("#trip .tcell").length || 1 : 0 },
  cast:      { name: "Cast",      cat: "play-make", route: () => "/persona.html?harness", count: (d) => txt(d).length > 300 ? 1 : 0, projectAgnostic: true },
  // the viral drop (2026-07) — all cold-open on the lent brand; count the stage-1 option cards
  arcade:    { name: "Arcade",    cat: "viral", count: (d) => d.querySelectorAll(".opt, .pitch").length },
  yearbook:  { name: "Yearbook",  cat: "viral", count: (d) => d.querySelectorAll(".yb-grid .yb-frame, .yb-label, .yb-card, .opt").length },
  toon:      { name: "Toon",      cat: "viral", count: (d) => d.querySelectorAll(".opt, .panel .draw").length },
  storybook: { name: "Storybook", cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  petrait:   { name: "Petrait",   cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  emote:     { name: "Emote",     cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  inkling:   { name: "Inkling",   cat: "viral", count: (d) => d.querySelectorAll(".flash .fcard, .fcard, .opt").length },
  roomify:   { name: "Roomify",   cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  thumbs:    { name: "Thumbs",    cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  meme:      { name: "Meme",      cat: "viral", count: (d) => d.querySelectorAll(".opt, .meme-card, .meme").length },
  roast:     { name: "Roast",     cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  rizz:      { name: "Rizz",      cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  anthem:    { name: "Anthem",    cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  dreamlog:  { name: "Dreamlog",  cat: "viral", count: (d) => d.querySelectorAll(".opt").length },
  // the daily-skills shelf: text skills stream into #out-live; reply/nameit render option cards.
  gist:        { name: "Gist",        cat: "skill", count: (d) => skillDone(d) },
  rephrase:    { name: "Rephrase",    cat: "skill", count: (d) => skillDone(d) },
  explainthis: { name: "Explain This",cat: "skill", count: (d) => skillDone(d) },
  translate:   { name: "Translate",   cat: "skill", count: (d) => skillDone(d) },
  polish:      { name: "Polish",      cat: "skill", count: (d) => skillDone(d) },
  extract:     { name: "Extract",     cat: "skill", count: (d) => skillDone(d) },
  reply:       { name: "Reply",       cat: "skill", count: (d) => d.querySelectorAll("#view .opt, .opt").length || skillDone(d) },
  unjargon:    { name: "Unjargon",    cat: "skill", count: (d) => skillDone(d) },
  nameit:      { name: "Name It",     cat: "skill", count: (d) => d.querySelectorAll("#view .opt, .opt").length || skillDone(d) },
  actions:     { name: "Action Items",cat: "skill", count: (d) => skillDone(d) },
  snap:        { name: "Snap Answer", cat: "skill", count: (d) => skillDone(d) },
  recap:       { name: "Recap",       cat: "skill", count: (d) => skillDone(d) },
  meetnotes:   { name: "Meeting Notes", cat: "tool", count: (d) => skillDone(d) },
  cut:         { name: "Cut", cat: "tool", count: (d) => skillDone(d) },
  regex: { name: "Regex", cat: "skill", count: (d) => skillDone(d) },
  errslate: { name: "Errslate", cat: "skill", count: (d) => skillDone(d) },
  commit: { name: "Commit", cat: "skill", count: (d) => skillDone(d) },
  docstring: { name: "Docstring", cat: "skill", count: (d) => skillDone(d) },
  shell: { name: "Shell", cat: "skill", count: (d) => skillDone(d) },
  cron: { name: "Cron", cat: "skill", count: (d) => skillDone(d) },
  steps: { name: "Steps", cat: "skill", count: (d) => d.querySelectorAll("#view .opt, .opt").length || skillDone(d) },
  compare: { name: "Compare", cat: "skill", count: (d) => d.querySelectorAll("#view .opt, .opt").length || skillDone(d) },
  formula: { name: "Formula", cat: "skill", count: (d) => skillDone(d) },
  spellout: { name: "Spellout", cat: "skill", count: (d) => skillDone(d) },
  clipfix: { name: "Clip Doctor", cat: "skill", count: (d) => skillDone(d) },
  // Convert is now NON-AI (pure in-tab CSV/JSON/YAML). No model call ever fires, so drive it here:
  // paste valid CSV, click Convert, then assert the converted text rendered into #conv-out.
  convert: { name: "Convert", cat: "tool", count: (d) => {
    if (!d.__conv_kick) {
      const ta = d.getElementById("conv-in");
      if (ta) {
        d.__conv_kick = true;
        ta.value = "name,role,city\nAda,Engineer,London\nGrace,Admiral,New York";
        const btn = [...d.querySelectorAll("button")].find((b) => /convert/i.test(b.textContent || ""));
        if (btn) try { btn.click(); } catch (_) {}
      }
    }
    const out = d.getElementById("conv-out");
    return out && (out.textContent || "").trim().length > 10 ? 1 : 0;
  } },
  // PDF Tools — NON-AI (pdf-lib). Drive via the wrapp's own test hook: generate two sample PDFs,
  // merge them, then assert a downloadable result row rendered into #pdf-out.
  pdftools: { name: "PDF Tools", cat: "tool", count: (d) => {
    const w = d.defaultView;
    if (!d.__pdf_kick && w && w.__pdfToolsTest) { d.__pdf_kick = true; try { w.__pdfToolsTest.harnessRun(); } catch (_) {} }
    const out = d.getElementById("pdf-out");
    return out && out.querySelectorAll(".pdf-result a[download]").length ? 1 : 0;
  } },
  // QR — NON-AI (tiny QR encoder). Type a URL, assert a rendered <canvas> + download links appear.
  qr: { name: "QR", cat: "tool", count: (d) => {
    if (!d.__qr_kick) {
      const inp = d.getElementById("qr-in");
      if (inp) { d.__qr_kick = true; inp.value = "https://thelastprompt.ai/switchboard/"; inp.dispatchEvent(new (d.defaultView.Event)("input", { bubbles: true })); }
    }
    const c = d.getElementById("qr-canvas");
    const dl = d.querySelectorAll("#qr-out a[download]").length;
    return c && c.width > 0 && dl >= 2 ? 1 : 0;
  } },
  // Palette — NON-AI (canvas median-cut). Drive via the wrapp's own test hook: synthesize a banded
  // image, extract its palette, then assert rendered swatch cards + copy actions appear.
  palette: { name: "Palette", cat: "tool", count: (d) => {
    const w = d.defaultView;
    if (!d.__pal_kick && w && w.__paletteTest) { d.__pal_kick = true; try { w.__paletteTest.harnessRun(); } catch (_) {} }
    const grid = d.getElementById("swatch-grid");
    return grid && grid.querySelectorAll(".swatch").length ? 1 : 0;
  } },
  hooks: { name: "Hooks", cat: "skill", count: (d) => skillDone(d) },
  repurpose: { name: "Repurpose", cat: "skill", count: (d) => skillDone(d) },
  caption: { name: "Caption", cat: "skill", count: (d) => skillDone(d) },
  titles: { name: "Titles", cat: "skill", count: (d) => skillDone(d) },
  outline: { name: "Outline", cat: "skill", count: (d) => skillDone(d) },
  standup: { name: "Standup", cat: "skill", count: (d) => skillDone(d) },
  objection: { name: "Objection", cat: "skill", count: (d) => skillDone(d) },
  coldemail: { name: "Cold Email", cat: "skill", count: (d) => skillDone(d) },
  // ideabrain widget — idea-first (no cold-open), so the runner types the idea line (cat "skill").
  // State 2 (the instant `brief` read) rendering .readhead IS stage-1 success; once it lands we kick
  // the Validate button once so the pulse → verdict (State 4) is exercised too.
  ideabrain: { name: "ideabrain", cat: "skill", count: (d) => {
    if (d.querySelector(".verdict")) return 2;
    const rh = d.querySelectorAll(".readhead, .oneliner").length;
    if (rh) { if (!d.__ib_kick) { d.__ib_kick = true; const b = [...d.querySelectorAll("button")].find((x) => /^validate$/i.test((x.textContent || "").trim())); if (b) try { b.click(); } catch (_) {} } return 1; }
    return 0;
  } },
};
const FULL_ORDER = ["adforge", "adgen", "aplus", "imagegen", "shelf", "studio", "reel", "marquee", "canvas", "take", "identity", "batch", "bank", "redline", "adpulse", "huddle", "chat", "cartridge", "arcana", "natal", "cast", "arcade", "yearbook", "toon", "storybook", "petrait", "emote", "inkling", "roomify", "thumbs", "meme", "roast", "rizz", "anthem", "dreamlog", "gist", "rephrase", "explainthis", "translate", "polish", "extract", "reply", "unjargon", "nameit", "actions", "snap", "recap", "meetnotes", "cut", "regex", "errslate", "commit", "docstring", "shell", "cron", "steps", "compare", "formula", "spellout", "clipfix", "convert", "pdftools", "qr", "palette", "hooks", "repurpose", "caption", "titles", "outline", "standup", "objection", "coldemail", "ideabrain"];
// ?only=take,huddle,shelf runs a subset — for verifying one wrapp's fix without a 68-run sweep.
// A full run (no ?only) is still the ground truth before anything is called done.
const ONLY = (new URLSearchParams(location.search).get("only") || "").split(",").map((s) => s.trim()).filter((s) => CFG[s]);
const ORDER = ONLY.length ? ONLY : FULL_ORDER;

function txt(d) { try { return (d.body && d.body.innerText) || ""; } catch (_) { return ""; } }
// A daily-skill "ran": its streamed result landed in #out-live (or a result panel) with real text.
function skillDone(d) {
  const o = d.querySelector("#out-live, #out, .roast-md, .md");
  if (o && o.innerText.trim().length > 20) return 1;
  return d.querySelectorAll(".opt").length;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stage = document.getElementById("stage");
const rowsEl = document.getElementById("rows");
const statusEl = document.getElementById("status");
const barEl = document.querySelector("#bar > i");
const RESULTS = {};
window.__RESULTS__ = RESULTS;
window.__DONE__ = false;

// build empty table
const rowEls = {};
for (const id of ORDER) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><span class="id">${CFG[id].name}</span><span class="cat">${CFG[id].cat}</span></td><td data-p="switchboard"><span class="v run">·</span></td><td data-p="nailinit"><span class="v run">·</span></td>`;
  rowsEl.append(tr); rowEls[id] = tr;
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function setCell(id, project, verdict, detail, errs) {
  const td = rowEls[id].querySelector(`td[data-p="${project}"]`);
  const cls = verdict === "pass" ? "pass" : verdict === "warn" ? "warn" : verdict === "fail" ? "fail" : "run";
  td.innerHTML = `<span class="v ${cls}">${esc(verdict)}</span> <span class="detail">${esc(detail)}</span>` + (errs && errs.length ? `<div class="err">${errs.length} err: ${esc(errs[0])}</div>` : "");
}

function waitReady(win, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() {
      let ready = false; try { ready = !!(win && win.__HARNESS_READY__); } catch (_) {}
      if (ready) return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(poll, 100);
    })();
  });
}
function loadFrame(url) {
  return new Promise((resolve) => {
    let done = false;
    const onload = () => { if (!done) { done = true; resolve(true); } };
    stage.onload = onload;
    stage.src = url;
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 8000);
  });
}

// (The type-into-the-box crutch for Take and Huddle lived here. Removed 2026-07: both now generate
// their options from the lent context on connect, and Huddle auto-answers the ★ opener.)
function fillForm(doc, win) {
  const set = (id, v) => { const el = doc.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new win.Event("input", { bubbles: true })); el.dispatchEvent(new win.Event("change", { bubbles: true })); } };
  // NATAL's intended path is a preset PERSON chip: a sample soul is complete by construction, so
  // picking one fills the birth data AND reads in that single click (2026-07 — it used to only fill,
  // which left the sky unread until you found "Read the sky" yourself).
  const preset = [...doc.querySelectorAll("button")].find((b) => /Reykjav|New Orleans|Kyoto/i.test(b.textContent || "")) || [...doc.querySelectorAll("button")].find((b) => /your chart|★/i.test(b.textContent || ""));
  if (preset) { try { preset.click(); return; } catch (_) {} }
  // fallback: fill the raw form and click read.
  if (doc.getElementById("f-date") || doc.getElementById("f-place")) {
    set("f-name", "Sameep"); set("f-place", "Mumbai, India"); set("f-date", "1994-11-08"); set("f-time", "14:30");
    const read = doc.getElementById("read");
    if (read && !read.disabled) { try { read.click(); } catch (_) {} return; }
  }
  // generic fallback: fill visible text inputs, click a plausible submit
  for (const i of [...doc.querySelectorAll("input, select")].filter((i) => i.offsetParent !== null || i.type === "date")) {
    const t = (i.type || "").toLowerCase(), ph = (i.placeholder || "").toLowerCase();
    i.value = t === "date" ? "1994-11-08" : /place|city|born|location/.test(ph) ? "Mumbai, India" : /time/.test(ph) ? "14:30" : "Sameep";
    i.dispatchEvent(new win.Event("input", { bubbles: true })); i.dispatchEvent(new win.Event("change", { bubbles: true }));
  }
  const btn = [...doc.querySelectorAll("button, .primary")].find((b) => /read|chart|reveal|cast|generate|go/i.test(b.textContent || "")) || doc.querySelector("button.primary, button");
  if (btn) try { btn.click(); } catch (_) {}
}
// (Shelf's paste-a-CSV crutch lived here. Removed 2026-07: Shelf now loads the lent project's
// inventory — or a representative sheet off its catalogue — and auto-triages with zero input.)

// Fallback for a wrapp that didn't cold-open: type a one-liner and submit. Viral wrapps take a
// brand line; skills (usesContext:null — no cold-open) take a plain task line. Same input/button
// selectors serve both: the start <textarea> and the button.primary ("Write it 🔤" etc.).
function typeViralLine(doc, win, project, line) {
  const brand = brandName(win, project);
  const input = doc.querySelector("#view input, .start input, .bindrow input, input[type=text], textarea");
  if (!input) return;
  input.focus(); input.value = line || `a fun one for ${brand}`;
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const btn = [...doc.querySelectorAll("#view button.primary, .start button, .bindrow button, button.primary, button")].find((b) => !b.disabled);
  if (btn) try { btn.click(); } catch (_) {}
}

async function runOne(id, project) {
  const cfg = CFG[id];
  const url = cfg.route ? cfg.route() : `/h/${id}?project=${project}`;
  setCell(id, project, "run", "loading…");
  const ok = await loadFrame(url);
  const win = stage.contentWindow; const doc = stage.contentDocument;
  if (!ok || !doc) { setCell(id, project, "fail", "iframe didn't load"); RESULTS[id + ":" + project] = { verdict: "fail", detail: "iframe load fail", errors: [] }; return; }
  const ready = await waitReady(win, 4000);
  await sleep(1200); // let boot + returning-user probe + context read settle
  try {
    if (cfg.form) { fillForm(doc, win); }
  } catch (e) { /* driving is best-effort */ }
  // poll the success count for up to ~7s (pipeline has staged setTimeouts)
  let n = 0, t0 = Date.now(), viralTyped = false;
  while (Date.now() - t0 < 8000) {
    try { n = cfg.count(stage.contentDocument) || 0; } catch (_) { n = 0; }
    if (n >= 1) break;
    // viral wrapps cold-open on the lent brand; skills with usesContext:null have no cold-open at all.
    // If nothing fired by 2.6s AND no call is in flight, type a line to kick it (skills get a task line).
    if ((cfg.cat === "viral" || cfg.cat === "skill") && !viralTyped && Date.now() - t0 > 2600) {
      let callsYet = 0; try { callsYet = (stage.contentWindow.__HARNESS_CALLS__ || []).length; } catch (_) {}
      if (callsYet === 0) {
        viralTyped = true;
        const line = cfg.cat === "skill" ? "match all http and https URLs in a block of text" : null;
        try { typeViralLine(stage.contentDocument, stage.contentWindow, project, line); } catch (_) {}
      }
    }
    await sleep(400);
  }
  let errs = [], calls = [], snap = "";
  try { errs = (stage.contentWindow.__HARNESS_ERRORS__ || []).map((e) => e.text); } catch (_) {}
  try { calls = (stage.contentWindow.__HARNESS_CALLS__ || []).map((c) => ({ p: (c.prompt || "").slice(0, 70), r: (c.reply || "").slice(0, 45), a: c.agentic })); } catch (_) {}
  const hardErr = errs.filter((e) => !/no local tts|speak/i.test(e));
  let verdict, detail;
  if (n >= 1) { verdict = hardErr.length ? "warn" : "pass"; detail = "rendered" + (n > 1 ? " ×" + n : "") + (hardErr.length ? " (with errors)" : ""); }
  else if (n === 0.5) { verdict = "warn"; detail = "partial (precursor only)"; }
  else { verdict = "fail"; detail = calls.length ? "made " + calls.length + " call(s) but no stage-1 output" : "no model call fired"; }
  if (verdict === "fail") { // snapshot key DOM for offline diagnosis
    try { const d = stage.contentDocument; const v = d.getElementById("view") || d.getElementById("app") || d.body; snap = (v ? v.innerText : "").replace(/\s+/g, " ").slice(0, 220); } catch (_) {}
  }
  setCell(id, project, verdict, detail, hardErr);
  RESULTS[id + ":" + project] = { verdict, detail, count: n, errors: hardErr, calls, snap, textLen: txt(stage.contentDocument).length };
}
function brandName(win, project) {
  try { return win.__HARNESS__.projects[project].brand.name; } catch (_) { return project; }
}

(async function main() {
  const jobs = [];
  for (const id of ORDER) for (const p of PROJECTS) { if (CFG[id].projectAgnostic && p !== PROJECTS[0]) continue; jobs.push([id, p]); }
  let done = 0;
  for (const [id, p] of jobs) {
    statusEl.textContent = `running ${CFG[id].name} · ${p}  (${done + 1}/${jobs.length})`;
    try { await runOne(id, p); } catch (e) { setCell(id, p, "fail", "runner error: " + (e && e.message)); RESULTS[id + ":" + p] = { verdict: "fail", detail: String(e && e.message), errors: [] }; }
    done++; barEl.style.width = (100 * done / jobs.length) + "%";
    // mirror project-agnostic (cast) verdict into the 2nd column for a full grid
    if (CFG[id].projectAgnostic) { const r = RESULTS[id + ":" + PROJECTS[0]]; if (r) { setCell(id, PROJECTS[1], r.verdict, r.detail + " (shared harness)", r.errors); RESULTS[id + ":" + PROJECTS[1]] = Object.assign({}, r, { detail: r.detail + " (shared harness)" }); done++; barEl.style.width = (100 * Math.min(done, jobs.length) / jobs.length) + "%"; } }
  }
  statusEl.textContent = `done — ${jobs.length} runs. Results in window.__RESULTS__`;
  window.__DONE__ = true;
})();
