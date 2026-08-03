// RESIZE — a NON-AI widget (docs/STORE-TAXONOMY.md type 11). Drop an image, get it resized,
// re-formatted (PNG/JPEG/WebP) and recompressed — entirely IN THE TAB. No model, no cloud round-trip,
// no cost, no egress. The bytes never leave the browser process; re-encoding also strips EXIF/GPS as a
// free privacy win. This is the device-lightness poster child: L0 engine tier (browser <canvas> only,
// zero WASM, zero npm codecs).
//
// It still mounts the standard connect chip for IDENTITY consistency with the rest of the store — but
// the whole pipeline runs BEFORE and WITHOUT any connection. `scope.models` is empty and there is not a
// single relay.stream()/relay.complete() call in this file: that IS the proof it never touches an LLM.
//
// House doctrine kept: single input · one primary action · house design system · the result is steerable
// (change size/format/quality and it re-runs instantly).
import { mountConnect, whenRelayReady } from "@relay/sdk";
// God's hands: expose the resize action as a page-tool so the native God webview (or any WebMCP host)
// can DRIVE it headlessly — reusing the exact pipeline a click runs. Still zero model.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "resize",
  name: "Resize",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Resize — resizes/converts/compresses images entirely on your device. No AI, no cost.",
    models: [],   // ← NON-AI: never requests a model. This emptiness is load-bearing.
    tools: [],
  },
  usesContext: null,
};

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const msg = (e) => String(e?.message || e).slice(0, 160);
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
  toastT = setTimeout(() => t.remove(), 3200);
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

// ==== settings (localStorage — works OFFLINE, no daemon needed) ==============================
const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { mode: "long", value: 1600, percent: 50, format: "image/jpeg", quality: 0.82, keepAspect: true };
let settings = loadSettings();
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } }

// ==== APP LOGIC — the pure in-tab resize pipeline ═══════════════════════════════════════════
// Everything here is deterministic <canvas> work. No fetch, no stream, no model.

const FORMATS = [
  { mime: "image/jpeg", label: "JPEG", ext: "jpg", lossy: true },
  { mime: "image/png", label: "PNG", ext: "png", lossy: false },
  { mime: "image/webp", label: "WebP", ext: "webp", lossy: true },
];
const MODES = [
  { id: "long", label: "Longest side", unit: "px", hint: "cap the longer edge; keeps aspect" },
  { id: "width", label: "Exact width", unit: "px", hint: "set width; height follows aspect" },
  { id: "percent", label: "Percentage", unit: "%", hint: "scale by a percentage of the original" },
];

// Loaded source image, kept as an ImageBitmap (decoded once, reused across re-runs).
let source = null;          // { bitmap, name, type, bytes, w, h }
let result = null;          // { blob, url, w, h, bytes }

/** Compute the target dimensions from the current settings, preserving aspect where asked. */
function targetDims(srcW, srcH) {
  const { mode, value, percent } = settings;
  if (mode === "percent") {
    const p = Math.max(1, Math.min(400, percent)) / 100;
    return { w: Math.max(1, Math.round(srcW * p)), h: Math.max(1, Math.round(srcH * p)) };
  }
  if (mode === "width") {
    const w = Math.max(1, Math.min(20000, value));
    return { w, h: Math.max(1, Math.round(srcH * (w / srcW))) };
  }
  // "long" — cap the longer edge, never upscale past original.
  const cap = Math.max(1, Math.min(20000, value));
  const longer = Math.max(srcW, srcH);
  const scale = Math.min(1, cap / longer);
  return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
}

/** High-quality downscale WITHOUT pica: step-halve the canvas until within 2× of target, then the
 *  final draw is a gentle <2× shrink — the same trick pica uses, in ~12 lines of native canvas.
 *  Returns a canvas at exactly (targetW × targetH). L0 tier: zero external libraries. */
function drawResized(bitmap, targetW, targetH) {
  let cur = bitmap, curW = bitmap.width, curH = bitmap.height;
  while (curW > targetW * 2 && curH > targetH * 2) {
    const nW = Math.max(targetW, Math.floor(curW / 2));
    const nH = Math.max(targetH, Math.floor(curH / 2));
    const tmp = makeCanvas(nW, nH);
    const c = tmp.getContext("2d");
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
    c.drawImage(cur, 0, 0, nW, nH);
    cur = tmp; curW = nW; curH = nH;
  }
  const out = makeCanvas(targetW, targetH);
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "high";
  // JPEG has no alpha — flatten onto white so transparency doesn't render black.
  if (settings.format === "image/jpeg") { octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, targetW, targetH); }
  octx.drawImage(cur, 0, 0, targetW, targetH);
  return out;
}
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}
function canvasToBlob(canvas, mime, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: mime, quality });  // OffscreenCanvas
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), mime, quality));
}

/** The one pipeline: source bitmap + settings → an encoded Blob. Pure, awaitable, model-free.
 *  Exposed for both the UI and the God tool (and the in-tab verification harness). */
async function resizeBitmap(bitmap, opts) {
  const s = { ...settings, ...(opts || {}) };
  const prev = settings; settings = s;               // let targetDims/drawResized read the merged opts
  try {
    const { w, h } = targetDims(bitmap.width, bitmap.height);
    const canvas = drawResized(bitmap, w, h);
    const fmt = FORMATS.find((f) => f.mime === s.format) || FORMATS[0];
    const quality = fmt.lossy ? Math.max(0.1, Math.min(1, s.quality)) : undefined;
    const blob = await canvasToBlob(canvas, fmt.mime, quality);
    return { blob, w, h, bytes: blob.size, mime: fmt.mime, ext: fmt.ext };
  } finally { settings = prev; }
}

async function loadFile(file) {
  if (!file || !/^image\//.test(file.type || "")) { toast("Drop an image file (PNG, JPEG, WebP, GIF…).", true); return; }
  try {
    const bitmap = await createImageBitmap(file);
    source = { bitmap, name: file.name || "image", type: file.type, bytes: file.size, w: bitmap.width, h: bitmap.height };
    result = null;
    render();
    await run();
  } catch (e) { toast("Couldn't decode that image — " + msg(e), true); }
}

let running = false;
async function run() {
  if (!source || running) return;
  running = true; render();
  try {
    if (result?.url) URL.revokeObjectURL(result.url);
    const out = await resizeBitmap(source.bitmap);
    out.url = URL.createObjectURL(out.blob);
    result = out;
  } catch (e) { toast("Resize failed — " + msg(e), true); result = null; }
  finally { running = false; render(); }
}

function download() {
  if (!result) return;
  const base = (source?.name || "image").replace(/\.[^.]+$/, "");
  const a = el("a"); a.href = result.url; a.download = `${base}-${result.w}x${result.h}.${result.ext}`;
  document.body.append(a); a.click(); a.remove();
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = !!source;
  view.textContent = "";

  if (!source) { view.append(dropZone(), badge()); return; }

  const wrap = el("div", "work");

  // top bar — file + reset
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "image"), el("span", "run-input", `${source.name} · ${source.w}×${source.h} · ${fmtBytes(source.bytes)}`), el("span", "grow"));
  const swap = el("button", "act", "× new"); swap.onclick = () => { source = null; result = null; render(); };
  bar.append(swap);
  wrap.append(bar);

  wrap.append(controls());

  // preview + stats
  const out = el("div", "outcard");
  if (running) out.append(researching("resizing…"));
  else if (result) {
    const img = el("img", "preview"); img.src = result.url; img.alt = "resized preview";
    out.append(img);
    const stats = el("div", "stats");
    const saved = source.bytes > 0 ? Math.round((1 - result.bytes / source.bytes) * 100) : 0;
    stats.append(
      stat("dimensions", `${result.w}×${result.h}`),
      stat("output", fmtBytes(result.bytes)),
      stat(saved >= 0 ? "smaller by" : "larger by", `${Math.abs(saved)}%`, saved >= 0 ? "good" : "warn"),
    );
    out.append(stats);
    const dl = el("button", "primary", "Download ⬇"); dl.onclick = download;
    out.append(dl);
  }
  wrap.append(out);
  view.append(wrap);
}

function controls() {
  const box = el("div", "controls");

  // mode
  const modeRow = el("div", "field");
  modeRow.append(el("label", "flabel", "Resize by"));
  const seg = el("div", "seg");
  for (const m of MODES) {
    const b = el("button", "segbtn" + (settings.mode === m.id ? " on" : ""), m.label);
    b.onclick = () => { settings.mode = m.id; saveSettings(); render(); void run(); };
    seg.append(b);
  }
  modeRow.append(seg);
  box.append(modeRow);

  // value
  const mode = MODES.find((m) => m.id === settings.mode);
  const valRow = el("div", "field");
  valRow.append(el("label", "flabel", settings.mode === "percent" ? "Scale" : mode.label));
  const vwrap = el("div", "numwrap");
  const num = el("input"); num.type = "number";
  num.value = settings.mode === "percent" ? settings.percent : settings.value;
  num.oninput = () => {
    const v = Math.max(1, Number(num.value) || 1);
    if (settings.mode === "percent") settings.percent = v; else settings.value = v;
    saveSettings(); debouncedRun();
  };
  vwrap.append(num, el("span", "unit", mode.unit));
  valRow.append(vwrap);
  valRow.append(el("div", "fhint", mode.hint));
  box.append(valRow);

  // format
  const fmtRow = el("div", "field");
  fmtRow.append(el("label", "flabel", "Format"));
  const fseg = el("div", "seg");
  for (const f of FORMATS) {
    const b = el("button", "segbtn" + (settings.format === f.mime ? " on" : ""), f.label);
    b.onclick = () => { settings.format = f.mime; saveSettings(); render(); void run(); };
    fseg.append(b);
  }
  fmtRow.append(fseg);
  box.append(fmtRow);

  // quality (lossy only)
  const fmt = FORMATS.find((f) => f.mime === settings.format);
  if (fmt?.lossy) {
    const qRow = el("div", "field");
    qRow.append(el("label", "flabel", `Quality · ${Math.round(settings.quality * 100)}`));
    const rng = el("input"); rng.type = "range"; rng.min = "10"; rng.max = "100"; rng.value = String(Math.round(settings.quality * 100));
    rng.oninput = () => { settings.quality = Number(rng.value) / 100; qRow.firstChild.textContent = `Quality · ${rng.value}`; saveSettings(); debouncedRun(); };
    qRow.append(rng);
    box.append(qRow);
  }
  return box;
}

let debT = null;
function debouncedRun() { clearTimeout(debT); debT = setTimeout(() => void run(), 220); }

function stat(label, value, tone) {
  const s = el("div", "st" + (tone ? " " + tone : ""));
  s.append(el("div", "st-k", label), el("div", "st-v", value));
  return s;
}
function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }

function dropZone() {
  const dz = el("div", "drop");
  dz.append(el("div", "drop-ic", "🖼"), el("div", "drop-t", "Drop an image here"), el("div", "drop-s", "or click to choose · PNG · JPEG · WebP · GIF"));
  const input = el("input"); input.type = "file"; input.accept = "image/*"; input.className = "file-in";
  input.onchange = () => { if (input.files?.[0]) void loadFile(input.files[0]); };
  dz.append(input);
  dz.onclick = () => input.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) void loadFile(f); };
  return dz;
}
function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}
render();

// ---- God's hand: one page-tool, driving the real pipeline, still ZERO model ------------------------
// `resize_image` takes a data: URL (or plain base64) + optional settings, runs the SAME canvas pipeline
// a click runs, and returns the resized image as a data: URL. No inference anywhere.
exposeToGod({
  name: "resize_image",
  description: "Resize/convert/compress an image entirely on-device (no AI). Give a data: URL and target size/format; returns the resized image as a data: URL. mode: 'long'|'width'|'percent'.",
  inputSchema: {
    dataUrl: "string — the source image as a data: URL (or bare base64). Required.",
    mode: "string — 'long' (cap longest side), 'width' (exact width), or 'percent'. Default 'long'.",
    value: "number — px for long/width. Default 1600.",
    percent: "number — scale % when mode='percent'. Default 50.",
    format: "string — 'image/jpeg' | 'image/png' | 'image/webp'. Default 'image/jpeg'.",
    quality: "number — 0.1–1 for lossy formats. Default 0.82.",
  },
  execute: async (input = {}) => {
    const raw = String(input.dataUrl || "").trim();
    if (!raw) throw new Error("nothing to resize — pass { dataUrl }");
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/*;base64,${raw}`;
    const resp = await fetch(dataUrl);          // fetch of a data: URL is a pure in-memory decode, no network
    const bitmap = await createImageBitmap(await resp.blob());
    const opts = {};
    if (input.mode) opts.mode = String(input.mode);
    if (input.value != null) opts.value = Number(input.value);
    if (input.percent != null) opts.percent = Number(input.percent);
    if (input.format) opts.format = String(input.format);
    if (input.quality != null) opts.quality = Number(input.quality);
    const out = await resizeBitmap(bitmap, opts);
    const outUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(out.blob); });
    return { dataUrl: outUrl, width: out.w, height: out.h, bytes: out.bytes, mime: out.mime };
  },
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
// Exposes the pure pipeline so a test can synthesize an image and resize it with NO server and NO model.
try { (typeof window !== "undefined" ? window : globalThis).__resizeTest = { resizeBitmap, targetDims, FORMATS, MODES }; } catch { /* ignore */ }
