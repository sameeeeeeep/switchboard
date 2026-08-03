// QR — a NON-AI widget. Type text or a URL, get a QR code — entirely IN THE TAB via a tiny QR lib.
// No model, no cloud round-trip, no upload, no cost. Nothing leaves the browser process. Same doctrine
// as resize.js / convert.js: single input, one primary action, house design system, instantly steerable
// (change the text / error-correction / size and it re-renders). L0 engine tier (a ~50KB QR encoder).
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
// Vendored qrcode-generator (bundled at build time; runs in-tab, no CDN, no network).
import qrcode from "./vendor/qrcode.mjs";

// ==== CONFIG ================================================================================
const APP = {
  id: "qr",
  name: "QR",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "QR — generates QR codes entirely on your device. No AI, no upload, no cost.",
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
const DEFAULTS = { level: "M", size: 320 };
let settings = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } }

// ==== APP LOGIC — the pure in-tab QR pipeline ═══════════════════════════════════════════════
// Deterministic encoding + drawing. No fetch, no stream, no model.

const LEVELS = [
  { id: "L", label: "L", hint: "~7% recovery" },
  { id: "M", label: "M", hint: "~15% recovery" },
  { id: "Q", label: "Q", hint: "~25% recovery" },
  { id: "H", label: "H", hint: "~30% recovery" },
];
const FG = "#0A0C10", BG = "#FFFFFF", MARGIN = 4;   // classic black-on-white for reliable scanning

let text = "";
let qr = null;      // the encoded QR object (has getModuleCount / isDark)

/** Encode text into a QR model. typeNumber 0 = auto-fit the smallest version. Throws if too long. */
function encode(str, level) {
  const q = qrcode(0, LEVELS.some((l) => l.id === level) ? level : "M");
  q.addData(String(str));
  q.make();
  return q;
}

/** Build a crisp, self-contained SVG string from a QR model. */
function toSvg(q, { size = 320 } = {}) {
  const n = q.getModuleCount();
  const total = n + MARGIN * 2;
  let rects = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (q.isDark(r, c)) rects += `<rect x="${c + MARGIN}" y="${r + MARGIN}" width="1" height="1"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${BG}"/><g fill="${FG}">${rects}</g></svg>`;
}

/** Draw a QR model onto a canvas at the requested pixel size (integer-scaled for crisp modules). */
function toCanvas(q, { size = 320 } = {}) {
  const n = q.getModuleCount();
  const total = n + MARGIN * 2;
  const scale = Math.max(1, Math.floor(size / total));
  const px = total * scale;
  const canvas = document.createElement("canvas");
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = FG;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (q.isDark(r, c)) ctx.fillRect((c + MARGIN) * scale, (r + MARGIN) * scale, scale, scale);
  }
  return canvas;
}

/** The one pipeline: text + level → { qr, svg }. Pure + model-free. */
function generate(str, level) {
  const q = encode(str, level);
  return { qr: q, svg: toSvg(q, { size: settings.size }), modules: q.getModuleCount() };
}

let genError = null;
function run() {
  const inEl = $("qr-in");
  text = (inEl ? inEl.value : text) || "";
  if (!text.trim()) { qr = null; genError = null; render(); return; }
  try { const r = generate(text, settings.level); qr = r.qr; genError = null; }
  catch (e) { qr = null; genError = msg(e); }
  render();
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = false;
  view.textContent = "";

  const wrap = el("div", "work");

  // input
  const inField = el("div", "field");
  inField.append(el("label", "flabel", "Text or URL"));
  const inEl = el("input"); inEl.id = "qr-in"; inEl.type = "text"; inEl.className = "qr-in";
  inEl.placeholder = "https://example.com or any text…";
  inEl.value = text;
  inEl.addEventListener("input", () => { text = inEl.value; debouncedRun(); });
  inField.append(inEl);
  wrap.append(inField);

  // controls: level + size
  const ctl = el("div", "ctlrow");
  const lvlField = el("div", "field");
  lvlField.append(el("label", "flabel", "Error correction"));
  const seg = el("div", "seg");
  for (const l of LEVELS) {
    const b = el("button", "segbtn" + (settings.level === l.id ? " on" : ""), l.label);
    b.title = l.hint;
    b.onclick = () => { settings.level = l.id; saveSettings(); run(); };
    seg.append(b);
  }
  lvlField.append(seg);
  ctl.append(lvlField);

  const szField = el("div", "field");
  szField.append(el("label", "flabel", `Size · ${settings.size}px`));
  const rng = el("input"); rng.type = "range"; rng.min = "120"; rng.max = "640"; rng.step = "20"; rng.value = String(settings.size);
  rng.oninput = () => { settings.size = Number(rng.value); szField.firstChild.textContent = `Size · ${settings.size}px`; saveSettings(); debouncedRun(); };
  szField.append(rng);
  ctl.append(szField);
  wrap.append(ctl);

  // output
  const out = el("div", "outcard"); out.id = "qr-out";
  if (genError) {
    out.append(el("div", "err", "Couldn't encode that — " + genError + " (try a shorter string or a lower error-correction level)."));
  } else if (qr) {
    const canvas = toCanvas(qr, { size: settings.size });
    canvas.className = "qr-canvas"; canvas.id = "qr-canvas";
    canvas.style.width = settings.size + "px"; canvas.style.height = settings.size + "px";
    out.append(canvas);
    out.append(el("div", "qr-meta", `${qr.getModuleCount()}×${qr.getModuleCount()} modules · level ${settings.level}`));
    const row = el("div", "dlrow");
    const png = el("a", "act dl", "PNG ⬇"); png.href = "#"; png.setAttribute("download", "qr.png");
    png.onclick = (e) => { e.preventDefault(); downloadPng(canvas); };
    const svg = el("a", "act dl", "SVG ⬇"); svg.href = "#"; svg.setAttribute("download", "qr.svg");
    svg.onclick = (e) => { e.preventDefault(); downloadSvg(); };
    const cp = el("button", "act", "copy PNG"); cp.onclick = () => copyPng(canvas);
    row.append(png, svg, cp);
    out.append(row);
  } else {
    out.append(el("div", "placeholder", "Type something above to get a QR code."));
  }
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

let debT = null;
function debouncedRun() { clearTimeout(debT); debT = setTimeout(run, 160); }

function downloadPng(canvas) {
  canvas.toBlob((blob) => {
    if (!blob) { toast("Couldn't render PNG.", true); return; }
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = "qr.png"; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
function downloadSvg() {
  if (!qr) return;
  const blob = new Blob([toSvg(qr, { size: settings.size })], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = el("a"); a.href = url; a.download = "qr.svg"; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyPng(canvas) {
  try {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (blob && navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]); toast("QR copied ✓"); }
    else toast("Copy not supported here — use PNG download.", true);
  } catch { toast("Couldn't copy — use PNG download.", true); }
}
function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}
render();

// ---- God's hand: one page-tool, driving the real pipeline, still ZERO model ------------------------
exposeToGod({
  name: "qr_make",
  description: "Generate a QR code from text or a URL entirely on-device (no AI). Returns the QR as an SVG string and a PNG data: URL.",
  inputSchema: {
    text: "string — the text or URL to encode. Required.",
    level: "string — error correction 'L'|'M'|'Q'|'H'. Default 'M'.",
    size: "number — pixel size of the output. Default 320.",
  },
  execute: async (input = {}) => {
    const str = String(input.text || "").trim();
    if (!str) throw new Error("nothing to encode — pass { text }");
    const level = LEVELS.some((l) => l.id === input.level) ? input.level : settings.level;
    const size = Number(input.size) > 0 ? Number(input.size) : settings.size;
    const q = encode(str, level);
    const svg = toSvg(q, { size });
    const canvas = toCanvas(q, { size });
    const dataUrl = canvas.toDataURL("image/png");
    // drive the visible UI so a watching God webview sees it
    text = str; settings.level = level; settings.size = size; qr = q; genError = null; try { render(); } catch { /* headless */ }
    return { svg, dataUrl, modules: q.getModuleCount(), level, size };
  },
});

// ---- The GLANCE: an `image` widget (docs/WIDGETS.md §5) — the generated QR, drag-out ready ----------
// Accepts an optional text/URL the notch launcher hands over; encodes it on-device and returns the QR
// PNG as a drag-out file. With nothing to encode it shows a prompt state.
exposeWidget((input) => {
  const str = String((input && (input.text || input.input || input.url)) || text || "").trim();
  if (!str) {
    return {
      kicker: "QR · ON YOUR DEVICE", title: "Type text or a URL",
      openLabel: "Open QR", shape: "text",
      result: { body: "Give me any text or a link — I make a QR code on your device.", caption: "no AI · on your device" },
    };
  }
  try {
    const level = settings.level, size = Math.max(320, settings.size);
    const q = encode(str, level);
    const canvas = toCanvas(q, { size });
    const dataUrl = canvas.toDataURL("image/png");
    const bytes = Math.round((dataUrl.length - (dataUrl.indexOf(",") + 1)) * 3 / 4);
    const label = str.length > 42 ? str.slice(0, 41) + "…" : str;
    return {
      kicker: "QR · ON YOUR DEVICE", title: "Your QR code", openLabel: "Open QR", shape: "image",
      result: {
        caption: `${label} · ${q.getModuleCount()}×${q.getModuleCount()} · no AI`,
        file: { name: "qr.png", dataUrl, bytes },
      },
      file: { name: "qr.png", dataUrl, bytes },
    };
  } catch (e) {
    return {
      kicker: "QR", title: "Too long to encode", openLabel: "Open QR", shape: "text",
      result: { body: msg(e) + " — try a shorter string or a lower error-correction level.", caption: "no AI · on your device" },
    };
  }
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__qrTest = { generate, encode, toSvg, toCanvas, LEVELS }; } catch { /* ignore */ }
