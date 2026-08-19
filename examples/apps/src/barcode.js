// BARCODE — a NON-AI widget. Pick a symbology, type your data, get a scannable 1D barcode — entirely
// IN THE TAB. Same doctrine as qr.js / resize.js / convert.js: single input, one primary action, house
// design system, instantly steerable (change the type / data / height and it re-renders). No model, no
// cloud round-trip, no upload, no cost — nothing leaves the browser process. L0 engine tier (the
// encoder is a few tables; the drawing is plain canvas/SVG).
//
// The CORRECTNESS half — Code 128 (auto A/B/C + Code-C pairs + mod-103) and EAN-13 (check digit +
// L/G/R parity) — lives in kit/barcode.js, pure and separately tested (kit/barcode.test.mjs). This
// file only turns the returned run-length modules into pixels and handles download/copy.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { encodeBarcode, BARCODE_TYPES } from "./kit/barcode.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "barcode",
  name: "Barcode",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Barcode — generates 1D barcodes entirely on your device. No AI, no upload, no cost.",
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
// `type` and `height` persist (which symbology, how tall) but the DATA never does — a stored product
// number or label text is a stale surprise nobody asked for; first run always shows a fresh sample.
const DEFAULTS = { type: "code128", height: 120, scale: 3 };
let settings = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } }

// ==== APP LOGIC — the pure in-tab barcode pipeline ═══════════════════════════════════════════
// Deterministic encode (kit) + draw. No fetch, no stream, no model.

const QUIET_FALLBACK = 10;
const BAR = "#0A0C10", BG = "#FFFFFF";        // classic black-on-white for reliable scanning
const TEXT_BAND = 22;                          // px reserved under the bars for the human-readable line

let type = BARCODE_TYPES.some((t) => t.id === settings.type) ? settings.type : "code128";
let data = "";
let enc = null;      // last encode result from kit ({ ok, modules, widthUnits, quiet, text } | { ok:false, error })

/** First-run sample per type, so the very first paint is a real, valid barcode. */
const sampleFor = (t) => (BARCODE_TYPES.find((x) => x.id === t) || BARCODE_TYPES[0]).placeholder;

/** Lay a kit result out as pixel geometry: integer module width, quiet zones, bar band + text band. */
function geometry(res, { scale = settings.scale, height = settings.height } = {}) {
  const s = Math.max(1, Math.floor(scale));
  const ql = res.quiet?.left ?? QUIET_FALLBACK, qr = res.quiet?.right ?? QUIET_FALLBACK;
  const totalUnits = ql + res.widthUnits + qr;
  const w = totalUnits * s;
  const barH = Math.max(40, Math.floor(height));
  const h = barH + TEXT_BAND;
  return { s, ql, qr, totalUnits, w, h, barH };
}

/** Draw a kit result onto a fresh canvas (integer-scaled modules → crisp bars). */
function toCanvas(res, opts = {}) {
  const g = geometry(res, opts);
  const canvas = document.createElement("canvas");
  canvas.width = g.w; canvas.height = g.h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG; ctx.fillRect(0, 0, g.w, g.h);
  ctx.fillStyle = BAR;
  // modules[] is a run-length array starting with a bar; even index = bar, odd = space.
  let x = g.ql * g.s;
  res.modules.forEach((width, i) => {
    const px = width * g.s;
    if (i % 2 === 0) ctx.fillRect(x, 0, px, g.barH);   // bar
    x += px;
  });
  if (res.text) {
    ctx.fillStyle = BAR;
    ctx.font = `${Math.min(16, TEXT_BAND - 6)}px ui-monospace, "Spline Sans Mono", monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // EAN-13 draws with a little tracking so the 13 digits read cleanly.
    const label = res.type === "ean13" ? res.text.split("").join(" ") : res.text;
    ctx.fillText(label, g.w / 2, g.barH + TEXT_BAND / 2);
  }
  return canvas;
}

/** Build a crisp, self-contained SVG string from a kit result. */
function toSvg(res, opts = {}) {
  const g = geometry(res, opts);
  let rects = "";
  let x = g.ql * g.s;
  res.modules.forEach((width, i) => {
    const px = width * g.s;
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${px}" height="${g.barH}"/>`;
    x += px;
  });
  const label = res.text ? (res.type === "ean13" ? res.text.split("").join(" ") : res.text) : "";
  const text = label
    ? `<text x="${g.w / 2}" y="${g.barH + TEXT_BAND / 2}" fill="${BAR}" font-family="ui-monospace, monospace" ` +
      `font-size="${Math.min(16, TEXT_BAND - 6)}" text-anchor="middle" dominant-baseline="middle">${escXml(label)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}" shape-rendering="crispEdges">` +
    `<rect width="${g.w}" height="${g.h}" fill="${BG}"/><g fill="${BAR}">${rects}</g>${text}</svg>`;
}
const escXml = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = false;
  view.textContent = "";
  const wrap = el("div", "work");

  // TYPE tabs — which symbology to speak.
  const tabs = el("div", "kindrow"); tabs.id = "bc-types";
  for (const t of BARCODE_TYPES) {
    const b = el("button", "kindbtn" + (t.id === type ? " on" : ""), t.label);
    b.title = t.hint; b.dataset.type = t.id;
    b.onclick = () => { type = t.id; settings.type = t.id; saveSettings(); data = ""; run(); };
    tabs.append(b);
  }
  wrap.append(tabs);

  // DATA input
  const active = BARCODE_TYPES.find((t) => t.id === type) || BARCODE_TYPES[0];
  const form = el("div", "bcform");
  const fld = el("div", "field wide");
  fld.append(el("label", "flabel", active.label + " data"));
  const input = el("input"); input.type = "text"; input.className = "bc-in"; input.id = "bc-in";
  input.placeholder = active.placeholder;
  input.value = data;
  input.setAttribute("autocomplete", "off"); input.setAttribute("spellcheck", "false");
  input.addEventListener("input", () => { data = input.value; debouncedRun(); });
  fld.append(input);
  fld.append(el("div", "hint", active.hint + (type === "ean13" ? " — 12 digits and we add the check digit, or paste all 13." : "")));
  form.append(fld);
  wrap.append(form);

  // controls: module scale + bar height
  const ctl = el("div", "ctlrow");
  const scField = el("div", "field");
  scField.append(el("label", "flabel", `Bar width · ${settings.scale}px / module`));
  const sc = el("input"); sc.type = "range"; sc.min = "1"; sc.max = "6"; sc.step = "1"; sc.value = String(settings.scale);
  sc.oninput = () => { settings.scale = Number(sc.value); scField.firstChild.textContent = `Bar width · ${settings.scale}px / module`; saveSettings(); run(true); };
  scField.append(sc);
  ctl.append(scField);

  const htField = el("div", "field");
  htField.append(el("label", "flabel", `Height · ${settings.height}px`));
  const ht = el("input"); ht.type = "range"; ht.min = "60"; ht.max = "220"; ht.step = "10"; ht.value = String(settings.height);
  ht.oninput = () => { settings.height = Number(ht.value); htField.firstChild.textContent = `Height · ${settings.height}px`; saveSettings(); run(true); };
  htField.append(ht);
  ctl.append(htField);
  wrap.append(ctl);

  // output
  const out = el("div", "outcard"); out.id = "bc-out";
  fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

/** Encode + paint the output card. `outOnly` repaints just the card so typing keeps input focus. */
function run(outOnly) {
  if (!data.trim()) { enc = null; }
  else { enc = encodeBarcode(type, data.trim()); }
  if (outOnly && $("bc-out")) fillOut($("bc-out"));
  else render();
}

function fillOut(out) {
  out.textContent = "";
  if (!enc) {
    out.append(el("div", "placeholder",
      type === "ean13" ? "Enter a 12- or 13-digit product number to get an EAN-13 barcode."
                       : "Type any text or number to get a Code 128 barcode."));
    return;
  }
  if (!enc.ok) {
    out.append(el("div", "err", "Couldn't encode that — " + enc.error));
    return;
  }
  const canvas = toCanvas(enc);
  canvas.className = "bc-canvas"; canvas.id = "bc-canvas";
  canvas.style.maxWidth = "100%";
  const stage = el("div", "bcstage", ""); stage.append(canvas); out.append(stage);
  const label = enc.type === "ean13" ? "EAN-13" : "Code 128";
  out.append(el("div", "bc-meta", `${label} · ${enc.text} · ${enc.widthUnits} modules`));
  const row = el("div", "dlrow");
  const png = el("a", "act dl", "PNG ⬇"); png.href = "#"; png.setAttribute("download", "barcode.png");
  png.onclick = (e) => { e.preventDefault(); downloadPng(canvas); };
  const svg = el("a", "act dl", "SVG ⬇"); svg.href = "#"; svg.setAttribute("download", "barcode.svg");
  svg.onclick = (e) => { e.preventDefault(); downloadSvg(); };
  const cp = el("button", "act", "copy PNG"); cp.onclick = () => copyPng(canvas);
  row.append(png, svg, cp);
  out.append(row);
}

let debT = null;
function debouncedRun() { clearTimeout(debT); debT = setTimeout(() => run(true), 160); }

function downloadPng(canvas) {
  canvas.toBlob((blob) => {
    if (!blob) { toast("Couldn't render PNG.", true); return; }
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = "barcode.png"; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
function downloadSvg() {
  if (!enc || !enc.ok) return;
  const blob = new Blob([toSvg(enc)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = el("a"); a.href = url; a.download = "barcode.svg"; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyPng(canvas) {
  try {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (blob && navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]); toast("Barcode copied ✓"); }
    else toast("Copy not supported here — use PNG download.", true);
  } catch { toast("Couldn't copy — use PNG download.", true); }
}
function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}

// first run — a real, valid sample so the page never opens empty.
data = sampleFor(type);
run();

// ---- God's hand: one page-tool, driving the real pipeline, still ZERO model ------------------------
exposeToGod({
  name: "make_barcode",
  description: "Generate a 1D barcode entirely on-device (no AI). type 'code128' encodes any ASCII text "
    + "or number; type 'ean13' encodes a 12- or 13-digit product number (the check digit is computed "
    + "for 12, validated for 13). Returns an SVG string, a PNG data: URL, and the human-readable text.",
  inputSchema: {
    type: "string — 'code128' (any text/number) or 'ean13' (12/13 digit product code). Default 'code128'.",
    data: "string — the text or number to encode.",
  },
  execute: async (input = {}) => {
    const t = BARCODE_TYPES.some((x) => x.id === input.type) ? input.type : "code128";
    const d = String(input.data ?? "").trim();
    const res = encodeBarcode(t, d);
    if (!res.ok) throw new Error(res.error);
    const svg = toSvg(res);
    const canvas = toCanvas(res);
    const dataUrl = canvas.toDataURL("image/png");
    // drive the visible UI so a watching God webview sees it happen
    type = t; data = d; enc = res; settings.type = t;
    try { render(); } catch { /* headless */ }
    return { svg, dataUrl, text: res.text, type: res.type, modules: res.widthUnits };
  },
});

// ---- The GLANCE: an `image` widget (docs/WIDGETS.md §5) — the rendered barcode, drag-out ready -------
// Understands the same input as the God tool: { type, data } or a bare text/number the notch launcher
// hands over. With nothing to encode it shows a prompt state; a bad number shows the encoder's reason.
exposeWidget((input) => {
  const t = input && BARCODE_TYPES.some((x) => x.id === input.type) ? input.type : type;
  const bare = String((input && (input.data || input.text || input.input)) || "").trim();
  const d = (bare || (data || "")).trim();
  if (!d) {
    return {
      kicker: "BARCODE · ON YOUR DEVICE", title: "Type text or a number",
      openLabel: "Open Barcode", shape: "text",
      result: { body: "Give me any text for Code 128, or a 12/13-digit product number for EAN-13 — I draw a scannable barcode on your device.", caption: "no AI · on your device" },
    };
  }
  const res = encodeBarcode(t, d);
  if (!res.ok) {
    return {
      kicker: "BARCODE · ON YOUR DEVICE", title: "Can't encode that", openLabel: "Open Barcode", shape: "text",
      result: { body: res.error, caption: "no AI · on your device" },
    };
  }
  try {
    const canvas = toCanvas(res, { scale: Math.max(3, settings.scale), height: settings.height });
    const dataUrl = canvas.toDataURL("image/png");
    const bytes = Math.round((dataUrl.length - (dataUrl.indexOf(",") + 1)) * 3 / 4);
    const label = res.type === "ean13" ? "EAN-13" : "Code 128";
    return {
      kicker: "BARCODE · ON YOUR DEVICE", title: "Your barcode", openLabel: "Open Barcode", shape: "image",
      result: {
        caption: `${label} · ${res.text} · no AI`,
        file: { name: "barcode.png", dataUrl, bytes },
      },
      file: { name: "barcode.png", dataUrl, bytes },
    };
  } catch (e) {
    return {
      kicker: "BARCODE", title: "Couldn't render", openLabel: "Open Barcode", shape: "text",
      result: { body: msg(e), caption: "no AI · on your device" },
    };
  }
});

// ---- In-tab verification hook (used by any headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__barcodeTest = { encodeBarcode, toSvg, toCanvas, geometry }; } catch { /* ignore */ }
