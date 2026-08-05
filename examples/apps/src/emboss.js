// EMBOSS — a NON-AI wrapp. Save a brand identity ONCE (letterhead + signature + stamp/seal) and
// apply it to any document, exporting a real branded PDF entirely IN THE TAB via pdf-lib.
// No model, no cloud round-trip, no upload, no cost. Bytes never leave the browser process.
// Same doctrine as pdftools.js: deterministic in-tab work, house design system, single primary action.
// L1 engine tier (pdf-lib is ~0.5MB of bundled JS — loaded only when this page opens; zero network
// at runtime, zero idle CPU). The brand profiles live in localStorage as base64 — reused across docs.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { readOsContext } from "./os/os-context.js";
// Vendored pdf-lib (bundled at build time; runs in-tab, no CDN, no network).
import { PDFDocument, StandardFonts, rgb } from "./vendor/pdf-lib.esm.min.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "emboss",
  name: "Emboss",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Emboss — stamps your saved brand identity onto documents and exports a PDF, on your device. No AI, no upload.",
    models: [],   // ← NON-AI: never requests a model.
    tools: [],
  },
  usesContext: null,
};

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const msg = (e) => String(e?.message || e).slice(0, 200);
const uid = () => "p" + Math.random().toString(36).slice(2, 9);
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
})();

// ==== APP LOGIC — the pure in-tab brand-apply pipeline ═════════════════════════════════════════
// Everything below is deterministic pdf-lib work. No fetch(external), no stream, no model.

const A4 = [595.28, 841.89];       // points
const SLOTS = [
  { key: "letterhead", label: "Letterhead", hint: "sits across the top of the page" },
  { key: "signature", label: "Signature", hint: "placed bottom-left" },
  { key: "stamp", label: "Stamp / Seal", hint: "placed bottom-right" },
];
const MAX_ASSET_BYTES = 4 * 1024 * 1024;   // 4MB per asset — keeps localStorage sane

// ---- persistence: profiles are the reusable identity, stored as base64 in localStorage ----------
const PROFILES_KEY = "emboss.profiles";
const ACTIVE_KEY = "emboss.activeProfile";

/** A profile: { id, name, letterhead|signature|stamp: { dataUrl, mime, name } | null }. */
function loadProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILES_KEY) || "null");
    if (Array.isArray(raw) && raw.length) return raw;
  } catch { /* corrupt — fall through to a fresh default */ }
  return [{ id: uid(), name: "My brand", letterhead: null, signature: null, stamp: null }];
}
function saveProfiles() {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); localStorage.setItem(ACTIVE_KEY, activeId); }
  catch (e) { toast("Couldn't save — storage may be full (assets too large?)", true); }
}

let profiles = loadProfiles();
let activeId = (() => { const saved = localStorage.getItem(ACTIVE_KEY); return profiles.some((p) => p.id === saved) ? saved : profiles[0].id; })();
const activeProfile = () => profiles.find((p) => p.id === activeId) || profiles[0];

// ---- run state -----------------------------------------------------------------------------
let mode = "compose";               // "compose" | "stamp"
let docText = "";                   // compose body
let docTitle = "";                  // optional heading (also seedable from OS context)
let everyPage = false;              // stamp mode: letterhead on every page vs first only
let srcPdf = null;                  // { name, buffer } for stamp mode
let result = null;                  // { name, blob, url, bytes, pages }
let running = false;

// carried context: open at the right thing when launched from the Switchboard OS
const osCtx = readOsContext();
if (osCtx) {
  if (typeof osCtx.artifact === "string") docTitle = osCtx.artifact.slice(0, 120);
  else if (osCtx.artifact && typeof osCtx.artifact.title === "string") docTitle = osCtx.artifact.title.slice(0, 120);
  if (typeof osCtx.term === "string" && !docTitle) docTitle = osCtx.term.slice(0, 120);
}

// ---- image bytes helpers -------------------------------------------------------------------
function dataUrlToBytes(dataUrl) {
  const comma = String(dataUrl).indexOf(",");
  const b64 = String(dataUrl).slice(comma + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function mimeOf(dataUrl) {
  const m = /^data:([^;,]+)[;,]/.exec(String(dataUrl));
  return m ? m[1].toLowerCase() : "";
}
async function embedAsset(doc, asset) {
  if (!asset || !asset.dataUrl) return null;
  const bytes = dataUrlToBytes(asset.dataUrl);
  const mime = asset.mime || mimeOf(asset.dataUrl);
  return /jpe?g/.test(mime) ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}
/** Scale (w,h) to fit inside (maxW,maxH) preserving aspect — allows upscaling small marks. */
function fitInto(w, h, maxW, maxH) { const r = Math.min(maxW / w, maxH / h); return { w: w * r, h: h * r }; }

// ---- text wrapping (Helvetica, deterministic) ----------------------------------------------
function wrapParagraph(text, font, size, maxW) {
  const words = String(text).replace(/\s+$/g, "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const trial = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(trial, size) > maxW && line) { lines.push(line); line = word; }
    else if (font.widthOfTextAtSize(trial, size) > maxW && !line) {
      // a single word longer than the line — hard-break it by character
      let chunk = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxW && chunk) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    } else line = trial;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// ---- the letterhead / marks placement (shared by both modes) -------------------------------
const INK = () => rgb(0.09, 0.10, 0.12);
const DIM = () => rgb(0.45, 0.47, 0.52);

function drawLetterhead(page, lh, margin) {
  const { width, height } = page.getSize();
  const maxW = width - margin * 2;
  const { w, h } = fitInto(lh.width, lh.height, maxW, 120);
  const x = margin + (maxW - w) / 2;
  const y = height - margin - h;
  page.drawImage(lh, { x, y, width: w, height: h });
  return y;   // bottom edge of the letterhead
}
function drawMarks(page, sig, stamp, margin, font) {
  const { width } = page.getSize();
  if (sig) {
    const { w, h } = fitInto(sig.width, sig.height, 190, 74);
    const y = margin + 14;
    page.drawImage(sig, { x: margin, y, width: w, height: h });
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: margin + Math.max(w, 150), y: y - 4 }, thickness: 0.75, color: DIM() });
    if (font) page.drawText("Signature", { x: margin, y: y - 16, size: 8, font, color: DIM() });
  }
  if (stamp) {
    const { w, h } = fitInto(stamp.width, stamp.height, 120, 120);
    const x = width - margin - w;
    const y = margin + 6;
    page.drawImage(stamp, { x, y, width: w, height: h });
  }
}

// ---- MODE 1: Compose — text → a new branded PDF --------------------------------------------
async function composePdf(profile, text, title) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lh = await embedAsset(doc, profile.letterhead);
  const sig = await embedAsset(doc, profile.signature);
  const stamp = await embedAsset(doc, profile.stamp);

  const M = 56;
  const size = 11, lineH = 16, gap = 8;
  const contentW = A4[0] - M * 2;
  const bottom = M;   // text never goes below this
  const pages = [];

  let page = doc.addPage(A4); pages.push(page);
  let y = A4[1] - M;
  if (lh) y = drawLetterhead(page, lh, M) - 26;

  if (title && title.trim()) {
    for (const ln of wrapParagraph(title.trim(), bold, 18, contentW)) {
      if (y < bottom + lineH) { page = doc.addPage(A4); pages.push(page); y = A4[1] - M; }
      page.drawText(ln, { x: M, y: y - 18, size: 18, font: bold, color: INK() });
      y -= 24;
    }
    y -= 10;
  }

  const paras = String(text || "").split(/\n\s*\n/);
  for (const para of paras) {
    const block = para.split(/\n/);
    for (const rawLine of block) {
      const lines = wrapParagraph(rawLine, font, size, contentW);
      for (const ln of lines) {
        if (y < bottom + lineH) { page = doc.addPage(A4); pages.push(page); y = A4[1] - M; }
        if (ln) page.drawText(ln, { x: M, y: y - size, size, font, color: INK() });
        y -= lineH;
      }
    }
    y -= gap;   // paragraph spacing
  }

  // marks on the LAST page — if the text ran into the mark zone, give them a clean page
  let last = pages[pages.length - 1];
  const markZone = (sig || stamp) ? 120 : 0;
  if (markZone && y < M + markZone) { last = doc.addPage(A4); pages.push(last); }
  drawMarks(last, sig, stamp, M, font);

  const bytes = await doc.save({ useObjectStreams: true });
  return { name: `emboss-${Date.now()}.pdf`, bytes, pages: doc.getPageCount() };
}

// ---- MODE 2: Stamp existing — overlay the identity onto an uploaded PDF ---------------------
async function stampPdf(profile, buffer, onEveryPage) {
  let doc;
  try { doc = await PDFDocument.load(buffer, { ignoreEncryption: true }); }
  catch (e) { throw new Error("Couldn't open that PDF — " + msg(e)); }
  const pages = doc.getPages();
  if (!pages.length) throw new Error("That PDF has no pages.");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lh = await embedAsset(doc, profile.letterhead);
  const sig = await embedAsset(doc, profile.signature);
  const stamp = await embedAsset(doc, profile.stamp);

  const M = 48;
  if (lh) { const targets = onEveryPage ? pages : [pages[0]]; for (const p of targets) drawLetterhead(p, lh, M); }
  drawMarks(pages[pages.length - 1], sig, stamp, M, font);

  const bytes = await doc.save({ useObjectStreams: true });
  return { name: `emboss-${Date.now()}.pdf`, bytes, pages: doc.getPageCount() };
}

/** The one pipeline: current mode + active profile → a result PDF. Pure, awaitable. */
async function runPipeline(m, profile) {
  const hasAsset = profile.letterhead || profile.signature || profile.stamp;
  if (!hasAsset) throw new Error("Add at least one brand asset (letterhead, signature, or stamp) first.");
  if (m === "compose") {
    if (!docText.trim()) throw new Error("Type or paste the document text first.");
    return composePdf(profile, docText, docTitle);
  }
  if (m === "stamp") {
    if (!srcPdf) throw new Error("Upload a PDF to stamp first.");
    return stampPdf(profile, srcPdf.buffer.slice(0), everyPage);
  }
  throw new Error("unknown mode: " + m);
}

async function run() {
  if (running) return;
  running = true; render();
  try {
    if (result?.url) URL.revokeObjectURL(result.url);
    const out = await runPipeline(mode, activeProfile());
    const blob = new Blob([out.bytes], { type: "application/pdf" });
    result = { name: out.name, blob, url: URL.createObjectURL(blob), bytes: out.bytes.length, pages: out.pages };
  } catch (e) { toast(msg(e), true); result = null; }
  finally { running = false; render(); }
}

// ---- asset upload --------------------------------------------------------------------------
function readImageAsAsset(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g)$/i.test(file.type || "") && !/\.(png|jpe?g|jpg)$/i.test(file.name || ""))
      return reject(new Error("Use a PNG or JPG image."));
    if (file.size > MAX_ASSET_BYTES) return reject(new Error(`That image is ${fmtBytes(file.size)} — keep assets under 4 MB.`));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Couldn't read that file."));
    fr.onload = () => resolve({ dataUrl: String(fr.result), mime: file.type || mimeOf(String(fr.result)), name: file.name || "asset" });
    fr.readAsDataURL(file);
  });
}
async function setAsset(slotKey, file) {
  try {
    const asset = await readImageAsAsset(file);
    activeProfile()[slotKey] = asset;
    saveProfiles(); result = null; render();
  } catch (e) { toast(msg(e), true); }
}
function removeAsset(slotKey) { activeProfile()[slotKey] = null; saveProfiles(); result = null; render(); }

// ---- profile management --------------------------------------------------------------------
function addProfile() {
  const p = { id: uid(), name: "New brand", letterhead: null, signature: null, stamp: null };
  profiles.push(p); activeId = p.id; saveProfiles(); result = null; render();
}
function deleteProfile(id) {
  if (profiles.length <= 1) { profiles = [{ id: uid(), name: "My brand", letterhead: null, signature: null, stamp: null }]; activeId = profiles[0].id; }
  else { profiles = profiles.filter((p) => p.id !== id); if (!profiles.some((p) => p.id === activeId)) activeId = profiles[0].id; }
  saveProfiles(); result = null; render();
}
function renameProfile(id, name) { const p = profiles.find((x) => x.id === id); if (p) { p.name = name.slice(0, 60) || "Untitled"; saveProfiles(); } }

// ==== render ================================================================================
function fileInput(accept, onpick, multiple) {
  const input = el("input"); input.type = "file"; input.accept = accept; if (multiple) input.multiple = true; input.className = "file-in";
  input.onchange = () => { if (input.files?.length) onpick(input.files); input.value = ""; };
  return input;
}

function assetSlot(slot) {
  const p = activeProfile();
  const asset = p[slot.key];
  const card = el("div", "slot" + (asset ? " filled" : ""));
  card.append(el("div", "slot-label", slot.label));

  const body = el("div", "slot-body");
  const input = fileInput("image/png,image/jpeg,.png,.jpg,.jpeg", (fl) => setAsset(slot.key, fl[0]));
  card.append(input);
  if (asset) {
    const thumb = el("div", "thumb");
    const img = el("img"); img.src = asset.dataUrl; img.alt = slot.label; thumb.append(img);
    body.append(thumb);
    const acts = el("div", "slot-acts");
    const rep = el("button", "act", "Replace"); rep.onclick = () => input.click();
    const rm = el("button", "act danger-act", "Remove"); rm.onclick = () => removeAsset(slot.key);
    acts.append(rep, rm);
    body.append(acts);
  } else {
    const dz = el("button", "slot-drop");
    dz.append(el("div", "slot-plus", "+"), el("div", "slot-hint", slot.hint));
    dz.onclick = () => input.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer?.files?.[0]) setAsset(slot.key, e.dataTransfer.files[0]); };
    body.append(dz);
  }
  card.append(body);
  return card;
}

function profileBar() {
  const bar = el("div", "profilebar");
  const pick = el("div", "pchips");
  for (const p of profiles) {
    const chip = el("button", "pchip" + (p.id === activeId ? " on" : ""), p.name || "Untitled");
    chip.onclick = () => { if (p.id !== activeId) { activeId = p.id; saveProfiles(); result = null; render(); } };
    pick.append(chip);
  }
  const add = el("button", "pchip add", "+ New"); add.onclick = addProfile;
  pick.append(add);
  bar.append(pick);

  // rename + delete for the active profile
  const p = activeProfile();
  const row = el("div", "prow");
  const name = el("input", "pname"); name.type = "text"; name.value = p.name; name.placeholder = "Profile name";
  name.oninput = () => renameProfile(p.id, name.value);
  const del = el("button", "act danger-act", "Delete profile"); del.onclick = () => { if (confirmDelete(p)) deleteProfile(p.id); };
  row.append(el("span", "flabel", "Name"), name, el("span", "grow"), del);
  bar.append(row);
  return bar;
}
function confirmDelete(p) {
  const anyAsset = p.letterhead || p.signature || p.stamp;
  return anyAsset ? window.confirm(`Delete “${p.name}” and its saved assets?`) : true;
}

function modeCards() {
  const opts = [
    { id: "compose", label: "Compose", desc: "Type or paste text → a new branded PDF", star: true },
    { id: "stamp", label: "Stamp existing", desc: "Upload a PDF → overlay your identity", star: false },
  ];
  const wrap = el("div", "modecards");
  for (const o of opts) {
    const c = el("button", "modecard" + (mode === o.id ? " on" : ""));
    const top = el("div", "mc-top");
    top.append(el("span", "mc-label", o.label));
    if (o.star) top.append(el("span", "mc-star", "★ recommended"));
    c.append(top, el("div", "mc-desc", o.desc));
    c.onclick = () => { mode = o.id; result = null; render(); };
    wrap.append(c);
  }
  return wrap;
}

function composePanel() {
  const panel = el("div", "panel");
  const ti = el("input", "titlein"); ti.type = "text"; ti.placeholder = "Document title (optional)"; ti.value = docTitle;
  ti.oninput = () => { docTitle = ti.value; };
  const ta = el("textarea", "bodytext"); ta.placeholder = "Paste or type the document text here…\n\nBlank lines separate paragraphs."; ta.value = docText;
  ta.oninput = () => { docText = ta.value; };
  panel.append(ti, ta);
  return panel;
}
function stampPanel() {
  const panel = el("div", "panel");
  const input = fileInput("application/pdf,.pdf", (fl) => loadSrcPdf(fl[0]));
  panel.append(input);
  if (srcPdf) {
    const row = el("div", "filerow");
    row.append(el("span", "fic", "📄"), el("span", "fname", srcPdf.name), el("span", "fmeta", `${srcPdf.pages}p · ${fmtBytes(srcPdf.bytes)}`), el("span", "grow"));
    const rep = el("button", "act", "Replace"); rep.onclick = () => input.click();
    const rm = el("button", "act danger-act", "Remove"); rm.onclick = () => { srcPdf = null; result = null; render(); };
    row.append(rep, rm);
    panel.append(row);
    // letterhead scope toggle (only meaningful if a letterhead exists)
    if (activeProfile().letterhead) {
      const tg = el("label", "toggle");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = everyPage; cb.onchange = () => { everyPage = cb.checked; result = null; };
      tg.append(cb, el("span", null, "Letterhead on every page (default: first page only)"));
      panel.append(tg);
    }
  } else {
    const dz = el("div", "drop");
    dz.append(el("div", "drop-ic", "📄"), el("div", "drop-t", "Drop a PDF to stamp"), el("div", "drop-s", "or click to choose · your letterhead, signature & seal go on top"));
    dz.onclick = () => input.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer?.files?.[0]) loadSrcPdf(e.dataTransfer.files[0]); };
    panel.append(dz);
  }
  return panel;
}
async function loadSrcPdf(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name || "")) { toast("Drop a PDF (.pdf).", true); return; }
  try {
    const buffer = await file.arrayBuffer();
    const doc = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: true });
    srcPdf = { name: file.name || "document.pdf", buffer, bytes: file.size || buffer.byteLength, pages: doc.getPageCount() };
    result = null; render();
  } catch (e) { toast("Couldn't read that PDF — " + msg(e), true); }
}

function resultCard() {
  const out = el("div", "outcard");
  out.append(el("div", "kicker", "embossed pdf"));
  const row = el("div", "pdf-result");
  row.append(el("span", "fic", "📄"), el("span", "fname", result.name), el("span", "fmeta", `${result.pages}p · ${fmtBytes(result.bytes)}`), el("span", "grow"));
  const a = el("a", "act dl", "download ⬇"); a.href = result.url; a.download = result.name; a.setAttribute("download", result.name);
  row.append(a);
  out.append(row);
  const prev = el("iframe", "pdfview"); prev.src = result.url; prev.title = "PDF preview";
  out.append(prev);
  return out;
}

function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}

function render() {
  const hero = $("hero"), view = $("view");
  const p = activeProfile();
  const hasAsset = !!(p.letterhead || p.signature || p.stamp);
  hero.hidden = hasAsset;
  view.textContent = "";

  const wrap = el("div", "work");
  wrap.append(profileBar());

  // asset slots
  const slots = el("div", "slots");
  for (const s of SLOTS) slots.append(assetSlot(s));
  wrap.append(slots);

  if (!hasAsset) {
    const nudge = el("div", "firstrun");
    nudge.append(el("div", "fr-t", "Add your brand once ↑"), el("div", "fr-s", "Drop a letterhead, signature, or seal above — then compose or stamp any document. It’s saved on your device for next time."));
    wrap.append(nudge, badge());
    view.append(wrap);
    return;
  }

  // mode + the matching panel
  wrap.append(modeCards());
  wrap.append(mode === "compose" ? composePanel() : stampPanel());

  // run
  const runBtn = el("button", "primary", running ? "Embossing…" : (mode === "compose" ? "Emboss → PDF ⬇" : "Stamp PDF ⬇"));
  runBtn.disabled = running;
  runBtn.onclick = () => void run();
  wrap.append(runBtn);

  if (result) wrap.append(resultCard());
  wrap.append(badge());
  view.append(wrap);
}
render();

// ---- God's hand: one page-tool, driving the real compose pipeline, still ZERO model ----------------
exposeToGod({
  name: "emboss_apply",
  description: "Apply the user's saved brand profile (letterhead, signature, stamp) to a document and produce a branded PDF, entirely on-device (no AI). Composes the given text into a new PDF and surfaces the download.",
  inputSchema: {
    text: "string — the document body text to compose into a branded PDF. Required for compose.",
    title: "string — optional document heading.",
    mode: "string — 'compose' (default). Only compose is supported via this tool.",
    profile: "string — optional profile name to use; defaults to the active one.",
  },
  execute: async (input = {}) => {
    const wanted = String(input.profile || "").trim().toLowerCase();
    const prof = wanted ? (profiles.find((p) => (p.name || "").toLowerCase() === wanted) || activeProfile()) : activeProfile();
    if (!(prof.letterhead || prof.signature || prof.stamp)) throw new Error("No brand assets saved yet — add a letterhead, signature, or stamp in Emboss first.");
    const text = String(input.text || "").trim();
    if (!text) throw new Error("pass { text: '…' } — the document body to emboss");
    // drive the same on-screen path so the result is visible + downloadable
    activeId = prof.id; mode = "compose"; docText = text; if (input.title) docTitle = String(input.title).slice(0, 120);
    render();
    await run();
    if (!result) throw new Error("Emboss failed to produce a PDF.");
    const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(result.blob); });
    return { file: { name: result.name, dataUrl, bytes: result.bytes, pages: result.pages } };
  },
});

// ---- In-tab verification hook (harmless in production) ----------------------------------------------
async function harnessRun() {
  // build a tiny 1x1 PNG data URL for a fake letterhead so compose has an asset
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const p = activeProfile(); p.letterhead = { dataUrl: png, mime: "image/png", name: "lh.png" };
  mode = "compose"; docText = "Emboss harness — line one.\n\nSecond paragraph proves wrapping and pagination all work in-tab with no network and no model.";
  docTitle = "Test Letter";
  await run();
  return result ? result.pages : 0;
}
try { (typeof window !== "undefined" ? window : globalThis).__embossTest = { composePdf, stampPdf, wrapParagraph, harnessRun }; } catch { /* ignore */ }

// ---- The GLANCE: a widget (docs/WIDGETS.md) — compose injected text with the saved profile ----------
exposeWidget(async (input) => {
  const p = activeProfile();
  const hasAsset = !!(p.letterhead || p.signature || p.stamp);
  const promptState = {
    kicker: "EMBOSS · ON YOUR DEVICE", title: hasAsset ? "Emboss a document" : "Add your brand first",
    openLabel: "Open Emboss", shape: "text",
    result: { body: hasAsset ? "Send text to stamp your saved letterhead, signature & seal onto a PDF." : "Save a letterhead, signature, or seal in Emboss, then compose branded PDFs.", caption: "no AI · no upload" },
  };
  const text = input && (typeof input === "string" ? input : (input.text || input.body || ""));
  if (!hasAsset || !text || !String(text).trim()) return promptState;
  try {
    const out = await composePdf(p, String(text), input.title || "");
    const blob = new Blob([out.bytes], { type: "application/pdf" });
    const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    return {
      kicker: `EMBOSS · ${(p.name || "brand").toUpperCase()}`, title: `Embossed · ${out.pages} page${out.pages === 1 ? "" : "s"}`,
      openLabel: "Open Emboss", shape: "text",
      result: { body: `${fmtBytes(out.bytes.length)} · your brand applied`, caption: "no AI · no upload" },
      file: { name: out.name, dataUrl, bytes: out.bytes.length },
    };
  } catch (e) {
    return { kicker: "EMBOSS", title: "Couldn't emboss that", openLabel: "Open Emboss", shape: "text", result: { body: msg(e), caption: "no AI · no upload" } };
  }
});
