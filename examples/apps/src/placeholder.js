// PLACEHOLDER — a NON-AI widget. Type a size ("800x600", "hd", "16:9@400"), get a filler image with a
// centred dimension label — entirely IN THE TAB via <canvas>. No model, no cloud round-trip, no upload,
// no cost. Nothing leaves the browser process. Same doctrine as qr.js / contrast.js: single input, one
// primary action, house design system, instantly steerable (change the size / colour / label and it
// re-renders). L0 engine tier — it's just canvas fills and a bit of text.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
// The pure PLAN half — loose size specs → { w, h, bg, fg, label, format }, with the colour/contrast
// maths. Pure + separately tested (kit/placeholder.test.mjs); the draw routine below stays here because
// it needs a real <canvas>.
import { planPlaceholder, PRESETS } from "./kit/placeholder.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "placeholder",
  name: "Placeholder",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Placeholder — generates filler images entirely on your device. No AI, no upload, no cost.",
    models: [],   // ← NON-AI: never requests a model.
    tools: [],
  },
  usesContext: null,
};

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const msg = (e) => String(e?.message || e).slice(0, 200);
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
// The size spec, bg and label PERSIST — unlike a QR password, a placeholder size is exactly the thing
// you want remembered between sessions. First run defaults to a rendered 800×600, never a blank canvas.
const DEFAULTS = { spec: "800x600", bg: "", label: "", format: "png" };
let settings = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } }

// ==== APP LOGIC — the pure in-tab placeholder pipeline ═══════════════════════════════════════
// planPlaceholder does the maths; drawPlaceholder paints it. No fetch, no stream, no model.

// One-tap presets — the sizes worth not typing. Order is deliberate (common → social → avatar).
const PRESET_CHIPS = [
  { spec: "hd", label: "HD 1280×720" },
  { spec: "fhd", label: "FHD 1920×1080" },
  { spec: "square", label: "Square 512" },
  { spec: "og", label: "OG 1200×630" },
  { spec: "avatar", label: "Avatar 256" },
  { spec: "16:9@400", label: "16:9 · 400w" },
];

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const EXT = { png: "png", jpeg: "jpg", webp: "webp" };

/** Pick the biggest font size (px) whose label fits within the box, with padding. Legible system font,
 *  sized to the smaller dimension and shrunk until it fits horizontally. */
function fitFontSize(ctx, label, w, h) {
  const maxTextW = w * 0.82;
  let size = Math.max(10, Math.round(Math.min(w, h) * 0.22));
  for (; size >= 8; size -= 1) {
    ctx.font = `600 ${size}px ${LABEL_FONT}`;
    if (ctx.measureText(label).width <= maxTextW) break;
  }
  return size;
}
const LABEL_FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Draw a plan onto a canvas at its real pixel size: fill bg, subtle diagonal guides, centred label. */
function drawPlaceholder(plan, canvas) {
  const { w, h, bg, fg, label } = plan;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  // solid background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // subtle corner-to-corner guides + a 1px inset frame, in the text colour at low alpha — the classic
  // "this is a placeholder" cross, kept faint so the label stays the hero.
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(1, Math.round(Math.min(w, h) / 400));
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(w, h);
  ctx.moveTo(w, 0); ctx.lineTo(0, h);
  ctx.stroke();
  ctx.globalAlpha = 0.25;
  const inset = ctx.lineWidth;
  ctx.strokeRect(inset / 2, inset / 2, w - inset, h - inset);
  ctx.restore();

  // centred label
  const size = fitFontSize(ctx, label, w, h);
  ctx.font = `600 ${size}px ${LABEL_FONT}`;
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, w / 2, h / 2);
  return canvas;
}

let plan = null;      // the current plan (or an { ok:false, error })
let planError = null;

/** Re-plan from settings. `outOnly` repaints just the output card and leaves the form's DOM alone —
 *  required, not an optimisation: a full re-render replaces the focused <input>, so typing would lose
 *  focus after every debounce tick (the same lesson as qr.js). */
function run(outOnly) {
  const p = planPlaceholder({ spec: settings.spec, bg: settings.bg, label: settings.label, format: settings.format });
  if (p.ok) { plan = p; planError = null; }
  else { plan = null; planError = p.error; }
  if (outOnly && $("ph-out")) fillOut($("ph-out"));
  else render();
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = false;
  view.textContent = "";

  const wrap = el("div", "work");

  // size input
  const specField = el("div", "field wide");
  specField.append(el("label", "flabel", "Size"));
  const specIn = el("input"); specIn.type = "text"; specIn.className = "ph-in"; specIn.id = "ph-in";
  specIn.placeholder = '800x600  ·  640  ·  16:9@400  ·  hd';
  specIn.value = settings.spec;
  specIn.addEventListener("input", () => { settings.spec = specIn.value; saveSettings(); debouncedRun(); });
  specField.append(specIn);
  wrap.append(specField);

  // preset chips
  const chips = el("div", "chiprow");
  for (const c of PRESET_CHIPS) {
    const b = el("button", "chip" + (settings.spec.toLowerCase() === c.spec ? " on" : ""), c.label);
    b.onclick = () => { settings.spec = c.spec; saveSettings(); run(); };
    chips.append(b);
  }
  wrap.append(chips);

  // optional bg + label row
  const opt = el("div", "optrow");

  const bgField = el("div", "field");
  bgField.append(el("label", "flabel", "Background"));
  const bgWrap = el("div", "cin");
  const sw = el("input"); sw.type = "color"; sw.className = "sw";
  sw.value = (plan && plan.bg) || "#cccccc";
  sw.oninput = () => { settings.bg = sw.value; saveSettings(); debouncedRun(); };
  const bgTxt = el("input"); bgTxt.type = "text"; bgTxt.placeholder = "grey / #cccccc";
  bgTxt.value = settings.bg;
  bgTxt.addEventListener("input", () => { settings.bg = bgTxt.value; saveSettings(); debouncedRun(); });
  bgWrap.append(sw, bgTxt);
  bgField.append(bgWrap);
  opt.append(bgField);

  const lblField = el("div", "field");
  lblField.append(el("label", "flabel", "Label (optional)"));
  const lblIn = el("input"); lblIn.type = "text"; lblIn.className = "ph-in";
  lblIn.placeholder = plan ? `${plan.w}×${plan.h}` : "dimensions";
  lblIn.value = settings.label;
  lblIn.addEventListener("input", () => { settings.label = lblIn.value; saveSettings(); debouncedRun(); });
  lblField.append(lblIn);
  opt.append(lblField);
  wrap.append(opt);

  // format segmented control
  const fmtField = el("div", "field");
  fmtField.append(el("label", "flabel", "Format"));
  const seg = el("div", "seg");
  for (const f of ["png", "jpeg", "webp"]) {
    const b = el("button", "segbtn" + (settings.format === f ? " on" : ""), f.toUpperCase());
    b.onclick = () => { settings.format = f; saveSettings(); run(); };
    seg.append(b);
  }
  fmtField.append(seg);
  wrap.append(fmtField);

  // output
  const out = el("div", "outcard"); out.id = "ph-out";
  fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

/** Paint the output card's contents into `out`. Called from the full render and, on every keystroke,
 *  on its own — which is what keeps the form's focus intact. */
function fillOut(out) {
  out.textContent = "";
  if (planError) {
    out.append(el("div", "err", "Couldn't read that size — " + planError));
    return;
  }
  if (!plan) { out.append(el("div", "placeholder", "Type a size above to see your placeholder.")); return; }

  const canvas = el("canvas", "ph-canvas"); canvas.id = "ph-canvas";
  drawPlaceholder(plan, canvas);
  // Fit the preview inside the card without upscaling small ones past their real pixels.
  canvas.style.maxWidth = "100%";
  canvas.style.width = Math.min(plan.w, 560) + "px";
  canvas.style.aspectRatio = `${plan.w} / ${plan.h}`;
  const frame = el("div", "canvas-frame");
  frame.append(canvas);
  out.append(frame);

  out.append(el("div", "ph-meta", `${plan.w}×${plan.h} · ${plan.format.toUpperCase()} · ${plan.bg}`));

  const row = el("div", "dlrow");
  const dl = el("a", "act dl", `${EXT[plan.format].toUpperCase()} ⬇`);
  dl.href = "#"; dl.setAttribute("download", `placeholder-${plan.w}x${plan.h}.${EXT[plan.format]}`);
  dl.onclick = (e) => { e.preventDefault(); downloadImage(canvas, plan); };
  const cp = el("button", "act", "copy PNG"); cp.onclick = () => copyPng(canvas);
  row.append(dl, cp);
  out.append(row);
}

let debT = null;
function debouncedRun() { clearTimeout(debT); debT = setTimeout(() => run(true), 140); }

function downloadImage(canvas, p) {
  const type = MIME[p.format] || "image/png";
  canvas.toBlob((blob) => {
    if (!blob) { toast("Couldn't render image.", true); return; }
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = `placeholder-${p.w}x${p.h}.${EXT[p.format]}`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, type, 0.92);
}
async function copyPng(canvas) {
  try {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (blob && navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]); toast("Placeholder copied ✓"); }
    else toast("Copy not supported here — use download.", true);
  } catch { toast("Couldn't copy — use download.", true); }
}
function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}

run();

// ---- God's hand: one page-tool, driving the real pipeline, still ZERO model ------------------------
exposeToGod({
  name: "make_placeholder",
  description: "Generate a placeholder / filler image entirely on-device (no AI). Give a size spec — "
    + "\"800x600\", a single number for a square, an aspect ratio like \"16:9@400\", or a named preset "
    + "(hd, fhd, square, og, avatar) — plus an optional background colour and label text. Returns a PNG "
    + "data: URL and the final width/height.",
  inputSchema: {
    spec: "string — the size: \"800x600\" | \"640\" | \"16:9@400\" | preset 'hd'|'fhd'|'square'|'og'|'avatar'. Default \"800x600\".",
    bg: "string — optional background colour (hex like '#1a2b3c' or a name like 'navy'). Default light grey.",
    label: "string — optional centred label. Defaults to the '{w}×{h}' dimensions.",
    format: "string — 'png' | 'jpeg' | 'webp'. Default 'png'.",
  },
  execute: async (input = {}) => {
    const p = planPlaceholder({ spec: input.spec ?? "800x600", bg: input.bg, label: input.label, format: input.format });
    if (!p.ok) throw new Error(p.error);
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : { getContext: () => null, width: 0, height: 0 };
    drawPlaceholder(p, canvas);
    const dataUrl = canvas.toDataURL(MIME[p.format] || "image/png", 0.92);
    // drive the visible UI so a watching God webview sees it
    settings.spec = String(input.spec ?? "800x600"); if (input.bg != null) settings.bg = String(input.bg);
    if (input.label != null) settings.label = String(input.label); if (input.format != null) settings.format = p.format;
    plan = p; planError = null; saveSettings();
    try { render(); } catch { /* headless */ }
    return { dataUrl, w: p.w, h: p.h, format: p.format, bg: p.bg, label: p.label };
  },
});

// ---- The GLANCE: an `image` widget (docs/WIDGETS.md §5) — the rendered placeholder, drag-out ready ---
// Accepts what the notch launcher hands over (a bare size string, or { spec/size, bg, label }) and
// renders it on-device, returning the PNG as a drag-out file. With nothing usable it shows a prompt.
exposeWidget((input) => {
  const specIn = (input && (input.spec || input.size || input.text || input.input)) || "";
  const spec = String(specIn).trim() || settings.spec || "800x600";
  const p = planPlaceholder({ spec, bg: (input && input.bg) || settings.bg, label: (input && input.label) || settings.label });
  if (!p.ok) {
    return {
      kicker: "PLACEHOLDER · ON YOUR DEVICE", title: "Type a size",
      openLabel: "Open Placeholder", shape: "text",
      result: { body: 'Give me a size — "800x600", "640", "16:9@400", or a preset like "hd" — and I make a filler image on your device.', caption: "no AI · on your device" },
    };
  }
  try {
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    if (!canvas) throw new Error("no canvas");
    drawPlaceholder(p, canvas);
    const dataUrl = canvas.toDataURL("image/png");
    const bytes = Math.round((dataUrl.length - (dataUrl.indexOf(",") + 1)) * 3 / 4);
    return {
      kicker: "PLACEHOLDER · ON YOUR DEVICE", title: `${p.w}×${p.h}`, openLabel: "Open Placeholder", shape: "image",
      result: {
        caption: `${p.label} · ${p.w}×${p.h} · no AI`,
        file: { name: `placeholder-${p.w}x${p.h}.png`, dataUrl, bytes },
      },
      file: { name: `placeholder-${p.w}x${p.h}.png`, dataUrl, bytes },
    };
  } catch (e) {
    return {
      kicker: "PLACEHOLDER", title: "Couldn't render", openLabel: "Open Placeholder", shape: "text",
      result: { body: msg(e), caption: "no AI · on your device" },
    };
  }
});

// ---- In-tab verification hook (used by any headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__phTest = { planPlaceholder, drawPlaceholder, PRESETS }; } catch { /* ignore */ }
