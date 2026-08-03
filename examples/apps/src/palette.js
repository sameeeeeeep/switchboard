// PALETTE — a NON-AI widget. Drop an image, get its dominant colors as a copyable swatch set —
// entirely IN THE TAB via a canvas median-cut quantizer. No model, no cloud round-trip, no upload,
// no cost. The pixels never leave the browser process. Same doctrine as resize.js / qr.js: single
// input, one primary result, house design system, instantly steerable (change the swatch count and it
// re-runs). L0 engine tier — pure <canvas> + a ~60-line median-cut, zero WASM, zero npm codecs.
//
// It still mounts the standard connect chip for IDENTITY consistency with the rest of the store — but
// the whole pipeline runs BEFORE and WITHOUT any connection. `scope.models` is empty and there is not a
// single relay.stream()/relay.complete() call in this file: that IS the proof it never touches an LLM.
import { mountConnect, whenRelayReady } from "@relay/sdk";
// God's hands: expose the extract action as a page-tool so the native God webview (or any WebMCP host)
// can DRIVE it headlessly — reusing the exact pipeline a click runs. Still zero model.
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "palette",
  name: "Palette",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Palette — extracts a color palette from an image entirely on your device. No AI, no cost.",
    models: [],   // ← NON-AI: never requests a model. This emptiness is load-bearing.
    tools: [],
  },
  usesContext: null,
};

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const msg = (e) => String(e?.message || e).slice(0, 160);
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

// ==== settings (localStorage — works OFFLINE) ===============================================
const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { count: 6 };
let settings = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } }

// ==== APP LOGIC — the pure in-tab palette pipeline ═══════════════════════════════════════════
// A median-cut color quantizer over a downsampled canvas. Deterministic; no fetch, no stream, no model.

const COUNTS = [4, 6, 8, 12];
const SAMPLE_EDGE = 160;   // downsample so quantization is fast and memory-light regardless of input size

const clamp8 = (n) => n < 0 ? 0 : n > 255 ? 255 : n | 0;
function toHex(r, g, b) { return "#" + [r, g, b].map((c) => clamp8(c).toString(16).padStart(2, "0")).join("").toUpperCase(); }
function toRgb(r, g, b) { return `rgb(${clamp8(r)}, ${clamp8(g)}, ${clamp8(b)})`; }
// Relative luminance (sRGB) → pick readable ink over a swatch.
function luminance(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function inkOn(r, g, b) { return luminance(r, g, b) > 0.56 ? "#0A0C10" : "#FFFFFF"; }

/** Pull RGB pixels from a bitmap, downsampled to <= SAMPLE_EDGE on the long side. Skips near-transparent
 *  pixels so a logo on transparency doesn't yield a phantom black. Returns a flat [r,g,b, r,g,b, …]. */
function samplePixels(bitmap) {
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) continue;   // skip transparent
    px.push(data[i], data[i + 1], data[i + 2]);
  }
  return px;   // flat RGB triples
}

/** Median-cut: recursively split the color box along its widest channel until we have `count` boxes,
 *  then average each box → the representative color. Sorted by population (most-used first). */
function medianCut(px, count) {
  const n = px.length / 3;
  if (!n) return [];
  let boxes = [makeBox(px, range(n))];
  while (boxes.length < count) {
    // split the box with the largest spread on its widest channel
    let bi = -1, bestSpread = -1;
    for (let i = 0; i < boxes.length; i++) { if (boxes[i].idx.length > 1 && boxes[i].spread > bestSpread) { bestSpread = boxes[i].spread; bi = i; } }
    if (bi < 0) break;
    const [a, b] = splitBox(px, boxes[bi]);
    boxes.splice(bi, 1, a, b);
  }
  return boxes
    .map((box) => ({ color: avg(px, box.idx), pop: box.idx.length }))
    .filter((c) => c.color)
    .sort((x, y) => y.pop - x.pop)
    .map((c) => c.color);
}
function range(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }
function makeBox(px, idx) {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const i of idx) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  const rS = rMax - rMin, gS = gMax - gMin, bS = bMax - bMin;
  const ch = rS >= gS && rS >= bS ? 0 : gS >= bS ? 1 : 2;
  return { idx, ch, spread: Math.max(rS, gS, bS) };
}
function splitBox(px, box) {
  const ch = box.ch;
  const sorted = box.idx.slice().sort((i, j) => px[i * 3 + ch] - px[j * 3 + ch]);
  const mid = sorted.length >> 1;
  return [makeBox(px, sorted.slice(0, mid)), makeBox(px, sorted.slice(mid))];
}
function avg(px, idx) {
  if (!idx.length) return null;
  let r = 0, g = 0, b = 0;
  for (const i of idx) { r += px[i * 3]; g += px[i * 3 + 1]; b += px[i * 3 + 2]; }
  const n = idx.length;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/** The one pipeline: bitmap + count → an array of swatch objects. Pure + model-free.
 *  Exposed for the UI, the God tool, the widget, and the in-tab verification harness. */
function extractPalette(bitmap, count) {
  const k = COUNTS.includes(count) ? count : settings.count;
  const px = samplePixels(bitmap);
  const colors = medianCut(px, k);
  return colors.map(({ r, g, b }) => ({ hex: toHex(r, g, b), rgb: toRgb(r, g, b), r, g, b, ink: inkOn(r, g, b) }));
}

// Loaded source image, kept as an ImageBitmap (decoded once, reused across re-runs).
let source = null;      // { bitmap, name, url }
let swatches = [];      // [{ hex, rgb, r, g, b, ink }]
let running = false;

async function loadFile(file) {
  if (!file || !/^image\//.test(file.type || "")) { toast("Drop an image file (PNG, JPEG, WebP, GIF…).", true); return; }
  try {
    const bitmap = await createImageBitmap(file);
    if (source?.url) URL.revokeObjectURL(source.url);
    source = { bitmap, name: file.name || "image", url: URL.createObjectURL(file) };
    swatches = [];
    render();
    await run();
  } catch (e) { toast("Couldn't decode that image — " + msg(e), true); }
}

async function run() {
  if (!source || running) return;
  running = true; render();
  try {
    // defer one frame so the "extracting…" state paints before the (synchronous) quantize
    await new Promise((r) => setTimeout(r, 0));
    swatches = extractPalette(source.bitmap, settings.count);
  } catch (e) { toast("Couldn't extract a palette — " + msg(e), true); swatches = []; }
  finally { running = false; render(); }
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
  bar.append(el("span", "kicker", "image"), el("span", "run-input", source.name), el("span", "grow"));
  const swap = el("button", "act", "× new"); swap.onclick = () => { if (source?.url) URL.revokeObjectURL(source.url); source = null; swatches = []; render(); };
  bar.append(swap);
  wrap.append(bar);

  // count control
  const ctl = el("div", "field");
  ctl.append(el("label", "flabel", "Colors"));
  const seg = el("div", "seg");
  for (const c of COUNTS) {
    const b = el("button", "segbtn" + (settings.count === c ? " on" : ""), String(c));
    b.onclick = () => { settings.count = c; saveSettings(); render(); void run(); };
    seg.append(b);
  }
  ctl.append(seg);
  wrap.append(ctl);

  // image preview
  const out = el("div", "outcard");
  const img = el("img", "preview"); img.src = source.url; img.alt = "source"; out.append(img);

  // swatches
  if (running) out.append(researching("extracting…"));
  else if (swatches.length) {
    const grid = el("div", "swatches"); grid.id = "swatch-grid";
    for (const s of swatches) {
      const sw = el("button", "swatch"); sw.style.background = s.hex; sw.style.color = s.ink;
      sw.title = "click to copy " + s.hex;
      sw.append(el("span", "sw-hex", s.hex), el("span", "sw-rgb", s.rgb));
      sw.onclick = () => copyOne(s.hex);
      grid.append(sw);
    }
    out.append(grid);
    const row = el("div", "dlrow");
    const cp = el("button", "act", "copy all HEX"); cp.onclick = () => copyAll("hex");
    const cpc = el("button", "act", "copy CSS vars"); cpc.onclick = () => copyAll("css");
    row.append(cp, cpc);
    out.append(row);
  }
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

async function copyOne(hex) {
  try { await navigator.clipboard.writeText(hex); toast(hex + " copied ✓"); }
  catch { toast("Couldn't copy.", true); }
}
async function copyAll(kind) {
  if (!swatches.length) return;
  const out = kind === "css"
    ? swatches.map((s, i) => `--color-${i + 1}: ${s.hex};`).join("\n")
    : swatches.map((s) => s.hex).join("\n");
  try { await navigator.clipboard.writeText(out); toast((kind === "css" ? "CSS vars" : "HEX list") + " copied ✓"); }
  catch { toast("Couldn't copy.", true); }
}

function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }
function dropZone() {
  const dz = el("div", "drop");
  dz.append(el("div", "drop-ic", "🎨"), el("div", "drop-t", "Drop an image here"), el("div", "drop-s", "or click to choose · PNG · JPEG · WebP · GIF"));
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
exposeToGod({
  name: "palette_extract",
  description: "Extract a color palette (dominant colors as HEX) from an image entirely on-device (no AI). Give a data: URL; returns the swatches as HEX + RGB.",
  inputSchema: {
    dataUrl: "string — the source image as a data: URL (or bare base64). Required.",
    count: "number — how many colors to extract (4, 6, 8, or 12). Default 6.",
  },
  execute: async (input = {}) => {
    const raw = String(input.dataUrl || "").trim();
    if (!raw) throw new Error("nothing to read — pass { dataUrl }");
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/*;base64,${raw}`;
    const resp = await fetch(dataUrl);          // fetch of a data: URL is a pure in-memory decode, no network
    const bitmap = await createImageBitmap(await resp.blob());
    const count = COUNTS.includes(Number(input.count)) ? Number(input.count) : settings.count;
    const cols = extractPalette(bitmap, count);
    // drive the visible UI so a watching God webview sees it happen
    try {
      if (source?.url) URL.revokeObjectURL(source.url);
      source = { bitmap, name: "image", url: dataUrl }; settings.count = count; swatches = cols; render();
    } catch { /* headless */ }
    return { swatches: cols.map((s) => ({ hex: s.hex, rgb: s.rgb })) };
  },
});

// ---- The GLANCE: a `cards` widget (docs/WIDGETS.md) — the extracted swatches, hex + color, copyable --
// The notch launcher hands over a dropped image as a data: URL; the widget quantizes it and returns
// the swatches (each card is tinted with its own color). With no image it shows a prompt state.
exposeWidget(async (input) => {
  const raw = String((input && (input.dataUrl || input.file?.dataUrl || input.url)) || "").trim();
  if (!raw) {
    return {
      kicker: "PALETTE · ON YOUR DEVICE", title: "Drop an image",
      openLabel: "Open Palette", shape: "text",
      result: { body: "Drop an image — I pull its colors on your device.", caption: "no AI · no upload" },
    };
  }
  try {
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/*;base64,${raw}`;
    const resp = await fetch(dataUrl);
    const bitmap = await createImageBitmap(await resp.blob());
    const cols = extractPalette(bitmap, settings.count);
    return {
      kicker: "PALETTE · COLORS", title: `${cols.length} colors extracted`,
      openLabel: "Open Palette", shape: "cards",
      copyText: cols.map((s) => s.hex).join("\n"),
      result: {
        caption: `${cols.length} swatches · no AI · on your device`,
        items: cols.map((s) => ({ label: s.hex, text: s.rgb, swatch: s.hex })),
      },
    };
  } catch (e) {
    return {
      kicker: "PALETTE", title: "Couldn't read that image", openLabel: "Open Palette", shape: "text",
      result: { body: msg(e), caption: "no AI · no upload" },
    };
  }
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
// harnessRun(): synthesize a 3-band image, extract its palette, render it — no network, no model.
async function harnessRun() {
  const c = document.createElement("canvas"); c.width = 90; c.height = 30;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#C8F250"; ctx.fillRect(0, 0, 30, 30);
  ctx.fillStyle = "#7DE0FF"; ctx.fillRect(30, 0, 30, 30);
  ctx.fillStyle = "#FF2D6E"; ctx.fillRect(60, 0, 30, 30);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  await loadFile(new File([blob], "bands.png", { type: "image/png" }));
  return swatches.length;
}
try { (typeof window !== "undefined" ? window : globalThis).__paletteTest = { extractPalette, medianCut, samplePixels, toHex, COUNTS, harnessRun }; } catch { /* ignore */ }
