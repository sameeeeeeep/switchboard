// UNIT CONVERTER — a NON-AI widget. A value + a from/to unit, converted IN THE TAB. No model, no
// cloud, no upload, no cost. Same doctrine as qr.js / contrast.js: single focus, one primary answer,
// house design system, instantly steerable. L0 engine tier (a factor table). Maths in kit/unit.js.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { CATEGORIES, getCategory, convert, format, parseQuery, unitSymbol } from "./kit/unit.js";

const APP = {
  id: "unit", name: "Unit Converter", installUrl: "https://thelastprompt.ai/switchboard/",
  scope: { reason: "Unit Converter — converts units entirely on your device. No AI, no upload, no cost.", models: [], tools: [] },
  usesContext: null,
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

let relay = null;
mountConnect($("chip-dock"), { scope: APP.scope, context: APP.usesContext, installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; }, onDisconnect: () => { relay = null; } });
(async () => { const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; } })();

// ==== settings (localStorage — the value + the chosen units, nothing sensitive) ==============
const SETTINGS_KEY = APP.id + "-settings";
const firstCat = CATEGORIES[0];
const DEFAULTS = { cat: firstCat.id, from: firstCat.units[0].id, to: firstCat.units[1].id, value: "1" };
let state = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state)); } catch { /* private mode */ } }

// keep from/to valid whenever the category changes
function ensureUnits() {
  const cat = getCategory(state.cat) || firstCat;
  const ids = cat.units.map((u) => u.id);
  if (!ids.includes(state.from)) state.from = ids[0];
  if (!ids.includes(state.to)) state.to = ids[1] || ids[0];
}

// ==== render ================================================================================
function render() {
  ensureUnits();
  const view = $("view"); view.textContent = "";
  const wrap = el("div", "work");
  const cat = getCategory(state.cat) || firstCat;

  // category pills
  const cats = el("div", "kindrow");
  for (const c of CATEGORIES) {
    const b = el("button", "kindbtn" + (c.id === state.cat ? " on" : ""), c.label);
    b.onclick = () => { state.cat = c.id; ensureUnits(); saveSettings(); render(); };
    cats.append(b);
  }
  wrap.append(cats);

  // value + from/to + swap
  const conv = el("div", "uconv");
  const vField = el("div", "field");
  vField.append(el("label", "flabel", "Value"));
  const vin = el("input"); vin.className = "in"; vin.type = "text"; vin.inputMode = "decimal"; vin.id = "u-val";
  vin.value = state.value;
  vin.addEventListener("input", () => { state.value = vin.value; saveSettings(); refreshOut(); });
  vField.append(vin);
  const fromField = unitSelect("From", "from", cat);
  const swap = el("button", "uswap", "⇄"); swap.title = "Swap units";
  swap.onclick = () => { const t = state.from; state.from = state.to; state.to = t; saveSettings(); render(); };
  const toField = unitSelect("To", "to", cat);
  // layout: [value] then a row of [from ⇄ to]
  wrap.append(vField);
  conv.append(fromField, swap, toField);
  wrap.append(conv);

  const out = el("div", "outcard"); out.id = "u-out";
  fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

function unitSelect(label, key, cat) {
  const f = el("div", "field");
  f.append(el("label", "flabel", label));
  const s = el("select", "in");
  for (const u of cat.units) { const o = el("option", null, u.label); o.value = u.id; s.append(o); }
  s.value = state[key];
  s.onchange = () => { state[key] = s.value; saveSettings(); refreshOut(); };
  f.append(s);
  return f;
}

function refreshOut() { const o = $("u-out"); if (o) fillOut(o); }

function fillOut(out) {
  out.textContent = "";
  const raw = state.value.trim();
  if (raw === "" || isNaN(Number(raw))) { out.append(el("div", "placeholder", "Enter a number to convert.")); return; }
  const r = convert(state.cat, state.from, state.to, Number(raw));
  if (r == null) { out.append(el("div", "err", "Can't convert between those units.")); return; }
  const line = el("div", "uresult");
  line.append(document.createTextNode(`${format(Number(raw))} ${unitSymbol(state.cat, state.from)} = `));
  const b = el("b", null, `${format(r)} ${unitSymbol(state.cat, state.to)}`);
  line.append(b);
  out.append(line);
}

function badge() { const b = el("div", "nobadge"); b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost")); return b; }
render();

// ---- God's hand ------------------------------------------------------------------------------------
exposeToGod({
  name: "convert_units",
  description: "Convert a value between units on-device (no AI). Categories: length, mass, data, "
    + "temperature, time, speed, volume. Give category+from+to+value, OR a plain phrase like '5 miles to km'.",
  inputSchema: {
    value: "number — the amount to convert.",
    category: "string — length|mass|data|temperature|time|speed|volume.",
    from: "string — the unit id/symbol to convert from.",
    to: "string — the unit id/symbol to convert to.",
    text: "string — optional plain phrase, e.g. '100 c to f' or '5 miles to km' (used if the fields are absent).",
  },
  execute: async (input = {}) => {
    let { category, from, to, value } = input;
    if ((!category || !from || !to || value == null) && input.text) {
      const q = parseQuery(input.text);
      if (q.ok) { category = category || q.category; from = from || q.from; to = to || q.to; value = value ?? q.value; }
      else if (!category) throw new Error(q.error);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("give me a numeric value to convert");
    const r = convert(category, from, to, n);
    if (r == null) throw new Error(`can't convert ${from} → ${to} in ${category}`);
    state.cat = category; state.from = from; state.to = to; state.value = String(n); try { render(); } catch { /* headless */ }
    return { category, from, to, value: n, result: r, formatted: `${format(n)} ${unitSymbol(category, from)} = ${format(r)} ${unitSymbol(category, to)}` };
  },
});

// ---- the glance ------------------------------------------------------------------------------------
exposeWidget((input) => {
  let cat = state.cat, from = state.from, to = state.to, value = state.value;
  if (input && input.text) { const q = parseQuery(input.text); if (q.ok) { cat = q.category; from = q.from; to = q.to; value = q.value; } }
  else if (input && input.value != null) { cat = input.category || cat; from = input.from || from; to = input.to || to; value = input.value; }
  const n = Number(value);
  if (!Number.isFinite(n)) return { kicker: "UNITS · ON YOUR DEVICE", title: "Convert a unit", openLabel: "Open Units", shape: "text",
    result: { body: "Give me a value and two units — I convert on your device.", caption: "no AI · on your device" } };
  const r = convert(cat, from, to, n);
  if (r == null) return { kicker: "UNITS", title: "Can't convert those", openLabel: "Open Units", shape: "text",
    result: { body: `No conversion from ${from} to ${to}.`, caption: "no AI · on your device" } };
  return { kicker: "UNITS · ON YOUR DEVICE", title: `${format(r)} ${unitSymbol(cat, to)}`, openLabel: "Open Units", shape: "text",
    result: { body: `${format(n)} ${unitSymbol(cat, from)} = ${format(r)} ${unitSymbol(cat, to)}`, caption: `${cat} · no AI` } };
});

try { (typeof window !== "undefined" ? window : globalThis).__unitTest = { convert, format, parseQuery }; } catch { /* ignore */ }
