// PDFTOOLS — a NON-AI widget. Merge, split, or compress PDFs entirely IN THE TAB via pdf-lib.
// No model, no cloud round-trip, no upload, no cost. The PDF bytes never leave the browser process.
// Same doctrine as resize.js / convert.js: single surface, one primary action, house design system.
// L1 engine tier (pdf-lib is ~0.5MB of bundled JS — loaded only when this page opens; still zero
// network at runtime and zero idle CPU).
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
// Vendored pdf-lib (bundled at build time; runs in-tab, no CDN, no network).
import { PDFDocument, StandardFonts } from "./vendor/pdf-lib.esm.min.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "pdftools",
  name: "PDF Tools",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "PDF Tools — merges/splits/compresses PDFs entirely on your device. No AI, no upload.",
    models: [],   // ← NON-AI: never requests a model.
    tools: [],
  },
  usesContext: null,
};

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const msg = (e) => String(e?.message || e).slice(0, 200);
function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3600);
}

// ==== connect (identity only — the tool works with NO connection) ===========================
let relay = null;
let notInstalled = false;
mountConnect($("chip-dock"), {
  scope: APP.scope,
  context: APP.usesContext,
  installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; },
  onDisconnect: () => { relay = null; },
});
(async () => {
  const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; }
  else if (r && r.installed === false) notInstalled = true;
})();

// ==== APP LOGIC — the pure in-tab PDF pipeline ═══════════════════════════════════════════════
// Everything here is deterministic pdf-lib work. No fetch, no stream, no model.

const MODES = [
  { id: "merge", label: "Merge", hint: "combine 2+ PDFs into one, in order" },
  { id: "split", label: "Split", hint: "break one PDF into single-page PDFs (optionally a page range)" },
  { id: "compress", label: "Compress", hint: "re-save with object streams + stripped metadata" },
];

let mode = "merge";
let files = [];        // [{ name, bytes, buffer(ArrayBuffer), pages }]
let results = [];      // [{ name, blob, url, bytes, pages }]
let range = "";        // split page-range spec, e.g. "1-3,5"
let running = false;

/** Parse a 1-based range spec ("1-3,5,8-") against a page total → sorted unique 0-based indices. */
function parseRange(spec, total) {
  const s = String(spec || "").trim();
  if (!s) return Array.from({ length: total }, (_, i) => i);
  const out = new Set();
  for (const part of s.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)?\s*-\s*(\d+)?$/.exec(part);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : total;
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const i = parseInt(part, 10); if (i >= 1 && i <= total) out.add(i - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

async function mergePdfs(bufs) {
  if (bufs.length < 2) throw new Error("Merge needs at least 2 PDFs.");
  const out = await PDFDocument.create();
  for (const buf of bufs) {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  const bytes = await out.save({ useObjectStreams: true });
  return [{ name: "merged.pdf", bytes, pages: out.getPageCount() }];
}

async function splitPdf(buf, rangeSpec) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const total = doc.getPageCount();
  const idxs = parseRange(rangeSpec, total);
  if (!idxs.length) throw new Error("That range selects no pages (this PDF has " + total + ").");
  const out = [];
  for (const i of idxs) {
    const one = await PDFDocument.create();
    const [pg] = await one.copyPages(doc, [i]);
    one.addPage(pg);
    const bytes = await one.save({ useObjectStreams: true });
    out.push({ name: `page-${i + 1}.pdf`, bytes, pages: 1 });
  }
  return out;
}

async function compressPdf(buf) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  // strip metadata (a real, honest size win on files that carry a lot of it)
  try { doc.setTitle(""); doc.setAuthor(""); doc.setSubject(""); doc.setKeywords([]); doc.setProducer(""); doc.setCreator(""); } catch { /* older pdfs */ }
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  return [{ name: "compressed.pdf", bytes, pages: doc.getPageCount() }];
}

/** The one pipeline: current mode + loaded buffers → an array of result PDFs. Pure, awaitable. */
async function runPipeline(m, bufs, rangeSpec) {
  if (m === "merge") return mergePdfs(bufs);
  if (m === "split") return splitPdf(bufs[0], rangeSpec);
  if (m === "compress") return compressPdf(bufs[0]);
  throw new Error("unknown mode: " + m);
}

async function run() {
  if (running) return;
  if (!files.length) { toast("Add a PDF first.", true); return; }
  if (mode === "merge" && files.length < 2) { toast("Merge needs at least 2 PDFs.", true); return; }
  running = true; render();
  try {
    for (const r of results) if (r.url) URL.revokeObjectURL(r.url);
    const bufs = files.map((f) => f.buffer.slice(0));   // slice: pdf-lib may detach the buffer
    const out = await runPipeline(mode, bufs, range);
    results = out.map((r) => { const blob = new Blob([r.bytes], { type: "application/pdf" }); return { ...r, blob, url: URL.createObjectURL(blob), bytes: r.bytes.length }; });
  } catch (e) { toast(msg(e), true); results = []; }
  finally { running = false; render(); }
}

async function loadFiles(fileList) {
  const incoming = [...fileList].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name || ""));
  if (!incoming.length) { toast("Drop PDF files (.pdf).", true); return; }
  for (const f of incoming) {
    try {
      const buffer = await f.arrayBuffer();
      const doc = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: true });
      files.push({ name: f.name || "document.pdf", bytes: f.size || buffer.byteLength, buffer, pages: doc.getPageCount() });
    } catch (e) { toast(`Couldn't read ${f.name || "a PDF"} — ${msg(e)}`, true); }
  }
  results = [];
  render();
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = files.length > 0;
  view.textContent = "";

  if (!files.length) { view.append(modeTabs(), dropZone(), badge()); return; }

  const wrap = el("div", "work");
  wrap.append(modeTabs());

  // file list
  const list = el("div", "filelist");
  files.forEach((f, i) => {
    const row = el("div", "filerow");
    row.append(el("span", "fic", "📄"), el("span", "fname", f.name), el("span", "fmeta", `${f.pages}p · ${fmtBytes(f.bytes)}`), el("span", "grow"));
    const rm = el("button", "act", "remove"); rm.onclick = () => { files.splice(i, 1); results = []; render(); };
    row.append(rm);
    list.append(row);
  });
  wrap.append(list);

  // add-more + range (split only)
  const ctl = el("div", "ctlrow");
  const add = el("button", "act", "+ add PDF");
  const input = fileInput(); add.onclick = () => input.click();
  ctl.append(add, input);
  if (mode === "split") {
    const rw = el("div", "rangewrap");
    const ri = el("input"); ri.type = "text"; ri.placeholder = "pages e.g. 1-3,5 (blank = all)"; ri.value = range;
    ri.oninput = () => { range = ri.value; };
    rw.append(ri); ctl.append(rw);
  }
  ctl.append(el("span", "grow"));
  const clear = el("button", "act", "× clear"); clear.onclick = () => { for (const r of results) if (r.url) URL.revokeObjectURL(r.url); files = []; results = []; render(); };
  ctl.append(clear);
  wrap.append(ctl);

  // run
  const runBtn = el("button", "primary", running ? "Working…" : runLabel());
  runBtn.disabled = running || (mode === "merge" && files.length < 2);
  runBtn.onclick = () => void run();
  wrap.append(runBtn);

  // results
  if (results.length) {
    const out = el("div", "outcard"); out.id = "pdf-out";
    out.append(el("div", "kicker", results.length === 1 ? "result" : `${results.length} results`));
    const totalIn = files.reduce((s, f) => s + f.bytes, 0);
    results.forEach((r) => {
      const row = el("div", "pdf-result");
      row.append(el("span", "fic", "📄"), el("span", "fname", r.name), el("span", "fmeta", `${r.pages}p · ${fmtBytes(r.bytes)}`), el("span", "grow"));
      if (mode === "compress" && totalIn > 0) {
        const saved = Math.round((1 - r.bytes / totalIn) * 100);
        row.append(el("span", saved >= 0 ? "delta good" : "delta warn", `${saved >= 0 ? "−" : "+"}${Math.abs(saved)}%`));
      }
      const a = el("a", "act dl", "download ⬇"); a.href = r.url; a.download = r.name; a.setAttribute("download", r.name);
      row.append(a);
      out.append(row);
    });
    if (results.length > 1) {
      const all = el("button", "act", "download all"); all.onclick = () => results.forEach((r, i) => setTimeout(() => { const a = el("a"); a.href = r.url; a.download = r.name; document.body.append(a); a.click(); a.remove(); }, i * 250));
      out.append(all);
    }
    wrap.append(out);
  }

  wrap.append(badge());
  view.append(wrap);
}

function runLabel() { return mode === "merge" ? "Merge PDFs ⬇" : mode === "split" ? "Split PDF ⬇" : "Compress PDF ⬇"; }
function modeTabs() {
  const seg = el("div", "seg modes");
  for (const m of MODES) {
    const b = el("button", "segbtn" + (mode === m.id ? " on" : ""), m.label);
    b.onclick = () => { mode = m.id; results = []; render(); };
    seg.append(b);
  }
  const hintRow = el("div", "modehint", MODES.find((m) => m.id === mode).hint);
  const box = el("div", "modebox"); box.append(seg, hintRow);
  return box;
}
function fileInput() {
  const input = el("input"); input.type = "file"; input.accept = "application/pdf,.pdf"; input.multiple = true; input.className = "file-in";
  input.onchange = () => { if (input.files?.length) void loadFiles(input.files); input.value = ""; };
  return input;
}
function dropZone() {
  const dz = el("div", "drop");
  dz.append(el("div", "drop-ic", "📄"), el("div", "drop-t", "Drop PDFs here"), el("div", "drop-s", "or click to choose · merge · split · compress"));
  const input = fileInput(); dz.append(input);
  dz.onclick = () => input.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer?.files?.length) void loadFiles(e.dataTransfer.files); };
  const sample = el("button", "act sample-btn", "load a sample");
  sample.onclick = (e) => { e.stopPropagation(); void loadSample(); };
  dz.append(sample);
  return dz;
}
function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}
render();

// ==== sample generator (also the harness driver) ============================================
async function makeSamplePdf(pages, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= (pages || 2); i++) {
    const p = doc.addPage([420, 595]);
    p.drawText(`${label || "Sample"} — page ${i}`, { x: 48, y: 520, size: 22, font });
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}
async function loadSample() {
  const blob = await makeSamplePdf(2, "Sample");
  const f = new File([blob], "sample.pdf", { type: "application/pdf" });
  const f2 = new File([await (await makeSamplePdf(1, "Second")).arrayBuffer()], "second.pdf", { type: "application/pdf" });
  files = [];
  await loadFiles([f, f2]);
}

// ---- God's hand: one page-tool, driving the real pipeline, still ZERO model ------------------------
exposeToGod({
  name: "pdftools_run",
  description: "Merge, split, or compress PDFs entirely on-device (no AI). Pass PDFs as data: URLs; returns the resulting PDF(s) as data: URLs.",
  inputSchema: {
    mode: "string — 'merge' | 'split' | 'compress'. Required.",
    files: "string[] — the source PDFs as data: URLs. Merge needs 2+; split/compress use the first.",
    range: "string — split page range, e.g. '1-3,5' (blank = all pages). Optional.",
  },
  execute: async (input = {}) => {
    const m = String(input.mode || "").trim();
    if (!MODES.some((x) => x.id === m)) throw new Error("mode must be 'merge', 'split', or 'compress'");
    const urls = Array.isArray(input.files) ? input.files : (input.files ? [input.files] : []);
    if (!urls.length) throw new Error("pass { files: [dataUrl, …] }");
    const bufs = [];
    for (const u of urls) { const resp = await fetch(String(u)); bufs.push(await resp.arrayBuffer()); }   // data: URL = in-memory decode, no network
    const out = await runPipeline(m, bufs, input.range);
    const outFiles = [];
    for (const r of out) {
      const blob = new Blob([r.bytes], { type: "application/pdf" });
      const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      outFiles.push({ name: r.name, dataUrl, bytes: r.bytes.length, pages: r.pages });
    }
    return { files: outFiles };
  },
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
// harnessRun(): generate two sample PDFs, load them, run a merge, render the result — no network, no model.
async function harnessRun() {
  const a = await makeSamplePdf(2, "A");
  const b = await makeSamplePdf(1, "B");
  files = [];
  await loadFiles([new File([a], "a.pdf", { type: "application/pdf" }), new File([b], "b.pdf", { type: "application/pdf" })]);
  mode = "merge";
  await run();
  return results.length;
}
try { (typeof window !== "undefined" ? window : globalThis).__pdfToolsTest = { runPipeline, parseRange, makeSamplePdf, harnessRun }; } catch { /* ignore */ }

// ---- The GLANCE: a `cards` widget (docs/WIDGETS.md) — the RESULT SUMMARY + drag-out, not the picker --
// The notch launcher hands over dropped PDF(s) as data: URLs; the widget runs the sensible default
// (2+ files → merge, one file → compress) and returns a one-line summary + a drag-out file. With no
// file it shows a prompt state.
async function pdfBufsFromInput(input) {
  const urls = [];
  if (input) {
    const cand = input.files || input.file || input.dataUrl || input.dataUrls;
    for (const u of (Array.isArray(cand) ? cand : cand ? [cand] : [])) {
      const s = typeof u === "string" ? u : (u && (u.dataUrl || u.url));
      if (s) urls.push(String(s));
    }
  }
  const bufs = [];
  for (const u of urls) { const resp = await fetch(u); bufs.push(await resp.arrayBuffer()); }  // data: URL = in-memory, no network
  return bufs;
}
exposeWidget(async (input) => {
  const promptState = {
    kicker: "PDF TOOLS · ON YOUR DEVICE", title: "Drop a PDF", openLabel: "Open PDF Tools", shape: "text",
    result: { body: "Drop PDFs to merge, or one to compress — entirely on your device.", caption: "no AI · no upload" },
  };
  let bufs = [];
  try { bufs = await pdfBufsFromInput(input); } catch { /* fall through to prompt */ }
  if (!bufs.length) return promptState;
  try {
    const m = bufs.length >= 2 ? "merge" : "compress";
    const out = await runPipeline(m, bufs, "");
    const first = out[0];
    const blob = new Blob([first.bytes], { type: "application/pdf" });
    const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    const totalIn = bufs.reduce((s, b) => s + b.byteLength, 0);
    const summary = m === "merge"
      ? `Merged ${bufs.length} PDFs → 1 file · ${fmtBytes(first.bytes.length)}`
      : `Compressed · ${fmtBytes(totalIn)} → ${fmtBytes(first.bytes.length)}`;
    const items = out.map((r) => ({ label: r.name, text: `${r.pages} page${r.pages === 1 ? "" : "s"} · ${fmtBytes(r.bytes.length)}` }));
    return {
      kicker: `PDF TOOLS · ${m.toUpperCase()}`, title: summary, openLabel: "Open PDF Tools", shape: "cards",
      result: { caption: `${summary} · no AI · no upload`, items },
      file: { name: first.name, dataUrl, bytes: first.bytes.length },
    };
  } catch (e) {
    return {
      kicker: "PDF TOOLS", title: "Couldn't process that", openLabel: "Open PDF Tools", shape: "text",
      result: { body: msg(e), caption: "no AI · no upload" },
    };
  }
});
