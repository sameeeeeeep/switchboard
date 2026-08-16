// TYPE UNITS — a NON-AI widget. px↔rem, typographic units, and line-height, IN THE TAB. No model, no
// cloud, no upload, no cost. Same doctrine as qr.js / contrast.js. L0 engine tier. Maths in
// kit/typeunits.js.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { pxrem, pxToBoth, typo, typoAll, TYPO_UNITS, lineHeight, suggestLineHeight } from "./kit/typeunits.js";

const APP = {
  id: "typeunits", name: "Type Units", installUrl: "https://thelastprompt.ai/switchboard/",
  scope: { reason: "Type Units — px/rem and typographic conversions entirely on your device. No AI, no upload, no cost.", models: [], tools: [] },
  usesContext: null,
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
let toastT = null;
function toast(text, err) { clearTimeout(toastT); let t = document.querySelector(".toast"); if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text; toastT = setTimeout(() => t.remove(), 2000); }

let relay = null;
mountConnect($("chip-dock"), { scope: APP.scope, context: APP.usesContext, installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; }, onDisconnect: () => { relay = null; } });
(async () => { const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; } })();

const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { mode: "pxrem", base: "16", px: "24", tv: "12", tfrom: "pt", lhSize: "16", lhRatio: "1.5" };
let state = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state)); } catch { /* private */ } }

const MODES = [["pxrem", "px ↔ rem"], ["typo", "Typographic"], ["lh", "Line height"]];

function render() {
  const view = $("view"); view.textContent = "";
  const wrap = el("div", "work");
  const tabs = el("div", "kindrow");
  for (const [id, lab] of MODES) { const b = el("button", "kindbtn" + (state.mode === id ? " on" : ""), lab);
    b.onclick = () => { state.mode = id; saveSettings(); render(); }; tabs.append(b); }
  wrap.append(tabs);
  wrap.append(form());
  const out = el("div", "outcard"); out.id = "ty-out"; fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

function fld(label, id, val, ph) {
  const f = el("div", "field"); f.append(el("label", "flabel", label));
  const i = el("input"); i.className = "in"; i.id = id; i.value = val; if (ph) i.placeholder = ph; i.inputMode = "decimal";
  i.addEventListener("input", () => { setv(id, i.value); refreshOut(); }); f.append(i); return f;
}
function unitSel(label, id, val) {
  const f = el("div", "field"); f.append(el("label", "flabel", label));
  const s = el("select", "in"); s.id = id;
  for (const u of TYPO_UNITS) { const o = el("option", null, u); o.value = u; s.append(o); }
  s.value = val; s.onchange = () => { setv(id, s.value); refreshOut(); }; f.append(s); return f;
}
function setv(id, v) { const m = { "ty-base": "base", "ty-px": "px", "ty-tv": "tv", "ty-tfrom": "tfrom", "ty-ls": "lhSize", "ty-lr": "lhRatio" }; if (m[id]) { state[m[id]] = v; saveSettings(); } }

function form() {
  const box = el("div", "uconv");
  if (state.mode === "pxrem") {
    box.append(fld("Pixels", "ty-px", state.px, "24"));
    box.append(el("span"));
    box.append(fld("Root font-size (px)", "ty-base", state.base, "16"));
  } else if (state.mode === "typo") {
    box.append(fld("Value", "ty-tv", state.tv, "12"));
    box.append(el("span"));
    box.append(unitSel("From unit", "ty-tfrom", state.tfrom));
  } else {
    box.append(fld("Font size (px)", "ty-ls", state.lhSize, "16"));
    box.append(el("span"));
    box.append(fld("Line-height ratio", "ty-lr", state.lhRatio, "1.5"));
  }
  return box;
}
function refreshOut() { const o = $("ty-out"); if (o) fillOut(o); }
function row(k, v) { const d = el("div", "crow"); d.append(el("div", "ck", k)); d.append(el("div", "cv", v)); return d; }

function fillOut(out) {
  out.textContent = ""; out.className = "outcard"; out.style.padding = "0";
  const grid = el("div", "cgrid");
  if (state.mode === "pxrem") {
    const both = pxToBoth(state.px, state.base);
    if (!both) { padErr(out, "Enter a pixel value."); return; }
    grid.append(row("REM", both.rem + "rem"));
    grid.append(row("EM", both.em + "em"));
    grid.append(row("PX", (Number(state.px) || 0) + "px"));
    grid.append(row("BASE", (Number(state.base) || 16) + "px"));
  } else if (state.mode === "typo") {
    const all = typoAll(state.tv, state.tfrom);
    if (!all) { padErr(out, "Enter a value."); return; }
    for (const u of TYPO_UNITS) grid.append(row(u.toUpperCase(), all[u] + (u === "px" || u === "pt" || u === "pc" ? "" : "") + " " + u));
  } else {
    const lh = lineHeight(state.lhSize, state.lhRatio);
    if (!lh) { padErr(out, "Enter a font size and a ratio."); return; }
    grid.append(row("LINE-HEIGHT", lh.px + "px"));
    grid.append(row("RATIO", String(lh.ratio)));
    grid.append(row("READ", lh.verdict));
    const s = suggestLineHeight(state.lhSize);
    if (s) grid.append(row("SUGGESTED", `${s.px}px (×1.5)`));
  }
  out.append(grid);
}
function padErr(out, msg) { out.style.padding = "20px"; out.append(el("div", "placeholder", msg)); }

function badge() { const b = el("div", "nobadge"); b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost")); return b; }
render();

// ---- God's hand ------------------------------------------------------------------------------------
exposeToGod({
  name: "type_units",
  description: "Type measurement conversions on-device (no AI). mode 'pxrem' (px↔rem/em at a base size), "
    + "'typo' (pt/pc/px/mm/cm/didot/cicero), or 'lineheight' (font px × ratio).",
  inputSchema: {
    mode: "string — pxrem | typo | lineheight.",
    value: "number — the value to convert.",
    from: "string — pxrem: 'px'|'rem'|'em'. typo: pt|pc|px|in|mm|cm|didot|cicero.",
    to: "string — the target unit (pxrem/typo).",
    base: "number — pxrem: root font-size in px (default 16).",
    ratio: "number — lineheight: the unitless ratio.",
  },
  execute: async (input = {}) => {
    if (input.mode === "typo") { const r = typo(input.value, input.from, input.to); if (r == null) throw new Error("bad typographic units"); return { result: r, all: typoAll(input.value, input.from) }; }
    if (input.mode === "lineheight") { const r = lineHeight(input.value, input.ratio); if (!r) throw new Error("bad font size / ratio"); return r; }
    const r = pxrem(input.value, input.from || "px", input.to || "rem", input.base); if (r == null) throw new Error("bad value"); return { result: r };
  },
});

// ---- the glance ------------------------------------------------------------------------------------
exposeWidget((input) => {
  if (input && input.value != null && input.mode === "typo") { const r = typo(input.value, input.from, input.to);
    if (r != null) return { kicker: "TYPE · ON YOUR DEVICE", title: `${r} ${input.to}`, openLabel: "Open Type", shape: "text",
      result: { body: `${input.value} ${input.from} = ${r} ${input.to}`, caption: "no AI · on your device" } }; }
  const both = pxToBoth(state.px, state.base);
  return { kicker: "TYPE · ON YOUR DEVICE", title: both ? `${state.px}px = ${both.rem}rem` : "Type Units", openLabel: "Open Type", shape: "text",
    result: { body: both ? `at a ${state.base}px root` : "px↔rem, typographic units and line-height — on your device.", caption: "no AI · on your device" } };
});

try { (typeof window !== "undefined" ? window : globalThis).__typeunitsTest = { pxrem, typo, lineHeight }; } catch { /* ignore */ }
