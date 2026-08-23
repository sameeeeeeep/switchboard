// SVGMIN — a NON-AI wrapp. Paste or drop an SVG, get a smaller SVG out — entirely IN THE TAB.
// No model, no cloud round-trip, no upload, no cost. Same doctrine as contrast.js / qr.js / resize.js:
// single input, one primary action, house design system, instantly steerable (change precision and it
// re-minifies). L0 engine tier (pure string surgery). The safe-only transforms live, tested, in
// kit/svgmin.js.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { optimizeSvg } from "./kit/svgmin.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "svgmin",
  name: "SVG Optimiser",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "SVG Optimiser — shrinks SVGs entirely on your device. No AI, no upload, no cost.",
    models: [],   // ← NON-AI: never requests a model.
    tools: [],
  },
  usesContext: null,
};

const SAMPLE = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<!-- Exported by an editor -->\n'
  + '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="120" height="120" viewBox="0 0 120 120">\n'
  + '  <metadata><rdf>author, license, editor cruft…</rdf></metadata>\n'
  + '  <sodipodi:namedview inkscape:zoom="1.5" inkscape:current-layer="layer1"/>\n'
  + '  <circle inkscape:label="dot" cx="60.000000" cy="60.000000" r="48.123456" fill="#C8F250"/>\n'
  + '  <path d="M 30.500000   60.000000   L 90.000000   60.000000" stroke="#0A0C10" stroke-width="6.000000"/>\n'
  + '</svg>\n';

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
  toastT = setTimeout(() => t.remove(), 2800);
}
const fmtBytes = (n) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

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

// ==== settings (localStorage — works OFFLINE) ===============================================
// `precision` and the opt-out toggles persist; the SVG TEXT never does — a pasted graphic sitting in
// localStorage is data nobody asked us to keep.
const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { precision: 2, removeDeclarations: true, removeTitleDesc: false };
let settings = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } }

// ==== state ================================================================================
let input = "";     // the SVG source the user pasted / dropped
let result = null;  // last optimizeSvg() result, or null

function optsFromSettings() {
  return {
    precision: settings.precision,
    removeDeclarations: settings.removeDeclarations,
    removeTitleDesc: settings.removeTitleDesc,
  };
}

/** Re-run the pure minifier over the current input and repaint just the output card. */
function run(outOnly) {
  if (!input.trim()) { result = null; }
  else result = optimizeSvg(input, optsFromSettings());
  if (outOnly && $("s-out")) fillOut($("s-out"));
  else render();
}

// ==== render ================================================================================
function render() {
  const view = $("view");
  view.textContent = "";
  const wrap = el("div", "work");

  // INPUT — paste an SVG, or drop / choose a .svg file
  const inField = el("div", "field");
  const lblRow = el("div", "labelrow");
  lblRow.append(el("label", "flabel", "SVG source"));
  const acts = el("div", "labelacts");
  const choose = el("button", "act", "Choose .svg");
  choose.onclick = () => pickFile();
  const sample = el("button", "act", "Try a sample");
  sample.onclick = () => { input = SAMPLE; run(); toast("Loaded a messy sample ✓"); };
  const clear = el("button", "act", "Clear");
  clear.onclick = () => { input = ""; run(); };
  acts.append(choose, sample, clear);
  lblRow.append(acts);
  inField.append(lblRow);

  const drop = el("div", "drop");
  const ta = el("textarea", "ta"); ta.id = "s-in"; ta.spellcheck = false;
  ta.placeholder = "Paste <svg>…</svg> here, or drop a .svg file anywhere in this box.";
  ta.value = input;
  ta.addEventListener("input", () => { input = ta.value; debouncedRun(); });
  wireDrop(drop, ta);
  drop.append(ta);
  inField.append(drop);
  wrap.append(inField);

  // CONTROLS — precision + the two opt-outs, and the primary action
  const ctl = el("div", "ctlrow");

  const pf = el("div", "field");
  pf.append(el("label", "flabel", `Round coordinates · ${settings.precision} dp`));
  const rng = el("input"); rng.type = "range"; rng.min = "0"; rng.max = "5"; rng.step = "1"; rng.value = String(settings.precision);
  rng.oninput = () => { settings.precision = Number(rng.value); pf.firstChild.textContent = `Round coordinates · ${settings.precision} dp`; saveSettings(); debouncedRun(); };
  pf.append(rng);
  ctl.append(pf);

  const tf = el("div", "field");
  tf.append(el("label", "flabel", "Also strip"));
  const toggles = el("div", "toggles");
  toggles.append(toggle("Prolog & DOCTYPE", "removeDeclarations"));
  toggles.append(toggle("<title>/<desc>", "removeTitleDesc"));
  tf.append(toggles);
  ctl.append(tf);
  wrap.append(ctl);

  // OUTPUT card
  const out = el("div", "outcard"); out.id = "s-out";
  fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

function toggle(label, key) {
  const t = el("button", "toggle" + (settings[key] ? " on" : ""), label);
  t.setAttribute("aria-pressed", String(!!settings[key]));
  t.onclick = () => { settings[key] = !settings[key]; saveSettings(); render(); };
  return t;
}

/** Paint the output card — empty hint, friendly error, or the stats + minified output + preview. */
function fillOut(out) {
  out.textContent = "";
  if (!input.trim()) {
    out.append(el("div", "placeholder", "Paste or drop an SVG above — you'll get a smaller one back, with a byte-by-byte breakdown of what was safe to remove."));
    return;
  }
  if (!result || !result.ok) {
    out.append(el("div", "err", (result?.error || "Couldn't read that SVG") + " — paste a full <svg>…</svg> or choose a .svg file."));
    return;
  }
  const r = result;

  // stat strip: before → after → % saved
  const stats = el("div", "stats");
  stats.append(stat("Before", fmtBytes(r.inBytes)));
  stats.append(el("div", "arrow", "→"));
  stats.append(stat("After", fmtBytes(r.outBytes)));
  const pct = el("div", "stat saved");
  pct.append(el("div", "sv", `${r.savedPct}%`));
  pct.append(el("div", "sk", r.savedBytes >= 0 ? `${fmtBytes(r.savedBytes)} smaller` : "already minimal"));
  stats.append(pct);
  out.append(stats);

  // what was removed
  const chips = el("div", "removed");
  const parts = [
    ["comments", "comment"], ["metadata", "metadata block"], ["editorNs", "editor tag/attr"],
    ["decls", "declaration"], ["whitespace", "whitespace run"],
  ];
  let any = false;
  for (const [k, name] of parts) {
    const n = r.removed[k]; if (!n) continue; any = true;
    chips.append(el("span", "rchip", `${n} ${name}${n === 1 ? "" : "s"}`));
  }
  if (!any) chips.append(el("span", "rchip none", "already clean — nothing safe to remove"));
  out.append(chips);

  // a small, INERT live preview (rendered via a data: URL into an <img> — no script executes)
  const prev = el("div", "preview");
  const img = el("img", "pimg");
  img.alt = "SVG preview";
  img.onerror = () => { prev.classList.add("broken"); img.replaceWith(el("div", "pnote", "preview unavailable")); };
  try { img.src = "data:image/svg+xml;utf8," + encodeURIComponent(r.out); } catch { /* ignore */ }
  prev.append(img);
  prev.append(el("div", "pnote", "preview · rendered inert, no scripts run"));
  out.append(prev);

  // the minified output + copy / download
  const code = el("textarea", "codearea"); code.id = "s-code"; code.readOnly = true; code.spellcheck = false; code.value = r.out;
  out.append(code);
  const row = el("div", "dlrow");
  const cp = el("button", "act", "Copy SVG"); cp.onclick = () => copyOut(r.out);
  const dl = el("a", "act dl", "Download .svg"); dl.href = "#"; dl.setAttribute("download", "optimised.svg");
  dl.onclick = (e) => { e.preventDefault(); downloadSvg(r.out); };
  row.append(cp, dl);
  out.append(row);
}

function stat(kicker, value) {
  const s = el("div", "stat");
  s.append(el("div", "sk", kicker));
  s.append(el("div", "sv", value));
  return s;
}

function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}

let debT = null;
function debouncedRun() { clearTimeout(debT); debT = setTimeout(() => run(true), 180); }

// ==== file in / out =========================================================================
function pickFile() {
  const inp = el("input"); inp.type = "file"; inp.accept = ".svg,image/svg+xml";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) readFile(f); };
  inp.click();
}
function readFile(file) {
  const fr = new FileReader();
  fr.onload = () => { input = String(fr.result || ""); run(); toast(`Loaded ${file.name} ✓`); };
  fr.onerror = () => toast("Couldn't read that file.", true);
  fr.readAsText(file);
}
function wireDrop(zone, ta) {
  const over = (e) => { e.preventDefault(); zone.classList.add("over"); };
  const leave = () => zone.classList.remove("over");
  zone.addEventListener("dragover", over);
  zone.addEventListener("dragleave", leave);
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); leave();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
}
function downloadSvg(text) {
  const blob = new Blob([text], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = el("a"); a.href = url; a.download = "optimised.svg"; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyOut(text) {
  try {
    if (navigator.clipboard) { await navigator.clipboard.writeText(text); toast("Minified SVG copied ✓"); }
    else { const c = $("s-code"); if (c) { c.select(); document.execCommand("copy"); toast("Copied ✓"); } }
  } catch { toast("Couldn't copy — select the text and copy manually.", true); }
}

render();

// ---- God's hand: minify an SVG headlessly, still ZERO model -----------------------------------------
exposeToGod({
  name: "svg_optimize",
  description: "Minify / optimise an SVG entirely on-device (no AI). Applies only SAFE transforms that "
    + "cannot change how it renders: strips comments, editor metadata (Inkscape/Illustrator), the XML "
    + "prolog & DOCTYPE, collapses formatting whitespace, and rounds coordinates. Returns the smaller "
    + "SVG plus the bytes saved.",
  inputSchema: {
    svg: "string — the SVG source to optimise. Required.",
    precision: "number — decimal places to round coordinates to. Default 2.",
    removeTitleDesc: "boolean — also strip <title>/<desc> (default false — they carry accessibility text).",
    removeDeclarations: "boolean — strip the <?xml?> prolog and <!DOCTYPE> (default true).",
  },
  execute: async (i = {}) => {
    const r = optimizeSvg(i.svg, {
      precision: Number.isFinite(i.precision) ? i.precision : settings.precision,
      removeTitleDesc: i.removeTitleDesc === true,
      removeDeclarations: i.removeDeclarations !== false,
    });
    if (!r.ok) throw new Error(r.error);
    // drive the visible UI so a watching God webview sees it
    input = String(i.svg); result = r; try { render(); } catch { /* headless */ }
    return { out: r.out, savedBytes: r.savedBytes, savedPct: r.savedPct, inBytes: r.inBytes, outBytes: r.outBytes, removed: r.removed };
  },
});

// ---- The GLANCE: a `text` widget (docs/WIDGETS.md) — the savings at a glance -----------------------
// Accepts { svg } (or a dropped .svg's text) the notch launcher hands over; minifies on-device.
exposeWidget((inp) => {
  const svg = String((inp && (inp.svg || inp.text || inp.input)) || input || "").trim();
  if (!svg) {
    return { kicker: "SVG · ON YOUR DEVICE", title: "Shrink an SVG", openLabel: "Open SVG Optimiser", shape: "text",
             result: { body: "Give me an SVG — I strip the editor cruft and round coordinates on your device, no AI.", caption: "no AI · on your device" } };
  }
  const r = optimizeSvg(svg, optsFromSettings());
  if (!r.ok) {
    return { kicker: "SVG · ON YOUR DEVICE", title: "Not an SVG", openLabel: "Open SVG Optimiser", shape: "text",
             result: { body: r.error, caption: "no AI · on your device" } };
  }
  return {
    kicker: "SVG · ON YOUR DEVICE",
    title: `${r.savedPct}% smaller`,
    openLabel: "Open SVG Optimiser", shape: "text",
    result: {
      body: `${fmtBytes(r.inBytes)} → ${fmtBytes(r.outBytes)} — ${fmtBytes(Math.max(0, r.savedBytes))} saved, safely.`,
      caption: `${r.savedPct}% · no AI`,
    },
    copyText: r.out,
  };
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__svgminTest = { optimizeSvg }; } catch { /* ignore */ }
