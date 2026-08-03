// CONVERT — a NON-AI widget. Paste data in one shape (CSV, JSON, or YAML) and get it converted to
// another shape — entirely IN THE TAB. No model, no cloud round-trip, no cost, no egress. The bytes
// never leave the browser process. Where `convert` once burned a cloud Claude call to reshape data
// (DESIGN-SYSTEM.md gap #3/#5), it is now pure client-side parsing: papaparse for CSV, js-yaml for
// YAML, JSON.parse/stringify for JSON. L0 engine tier, zero network.
//
// It still mounts the standard connect chip for IDENTITY consistency with the rest of the store — but
// the whole pipeline runs BEFORE and WITHOUT any connection. `scope.models` is empty and there is not
// a single relay.stream()/relay.complete() call in this file: that IS the proof it never touches an
// LLM. Same doctrine as resize.js — single input, one primary action, house design system, steerable.
import { mountConnect, whenRelayReady } from "@relay/sdk";
// God's hands: expose the convert action as a page-tool so the native God webview (or any WebMCP host)
// can DRIVE it headlessly — reusing the exact pipeline a click runs. Still zero model.
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
// Vendored, self-contained parsers (bundled at build time; run in-tab, no CDN, no network).
import Papa from "./vendor/papaparse.cjs";
import * as YAML from "./vendor/js-yaml.esm.mjs";

// ==== CONFIG ================================================================================
const APP = {
  id: "convert",
  name: "Convert",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Convert — converts data between CSV/JSON/YAML entirely on your device. No AI, no cost.",
    models: [],   // ← NON-AI: never requests a model. This emptiness is load-bearing.
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

// ==== settings (localStorage — works OFFLINE, no daemon needed) ==============================
const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { to: "json" };
let settings = loadSettings();
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ } }

// ==== APP LOGIC — the pure in-tab conversion pipeline ═══════════════════════════════════════
// Everything here is deterministic parse/serialize. No fetch, no stream, no model.

const FORMATS = [
  { id: "csv", label: "CSV" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
];
const SAMPLE = "name,role,city\nAda,Engineer,London\nGrace,Admiral,New York";

/** Sniff the source format from the raw text. Deterministic, order matters:
 *  JSON (starts with { or [ and parses) → CSV (delimiter-consistent rows) → YAML (key: value / - list).
 *  Returns 'csv' | 'json' | 'yaml' | null. */
function detectFormat(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  // JSON — the least ambiguous: a strict parse of a {…}/[…] body.
  if (t[0] === "{" || t[0] === "[") { try { JSON.parse(t); return "json"; } catch { /* not json */ } }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const looksCsv = lines.length >= 1 && /[,\t;]/.test(lines[0]);
  const looksYaml = /^\s*[\w"'.\- ]+\s*:\s/.test(t) || /^\s*-\s+/.test(t);
  // CSV wins when the header row and at least one more row share a delimiter and yield >1 column.
  if (looksCsv) {
    const res = Papa.parse(t, { skipEmptyLines: true });
    const cols = (res.data[0] || []).length;
    const consistent = res.data.length >= 1 && cols > 1;
    if (consistent && !looksYamlDominant(t)) return "csv";
  }
  if (looksYaml) { try { const v = YAML.load(t); if (v && typeof v === "object") return "yaml"; } catch { /* not yaml */ } }
  if (looksCsv) return "csv";
  // last resorts
  try { JSON.parse(t); return "json"; } catch { /* */ }
  try { const v = YAML.load(t); if (v !== undefined && v !== null) return "yaml"; } catch { /* */ }
  return null;
}
// A block that is mostly `key: value` lines and has no comma-shaped header is YAML, not CSV.
function looksYamlDominant(t) {
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const kv = lines.filter((l) => /^\s*[\w"'.\- ]+\s*:\s/.test(l) && !/,/.test(l)).length;
  return kv >= lines.length && lines.length > 0;
}

/** Parse raw text of a known format into a plain JS value. */
function parseInput(text, from) {
  const t = String(text || "").trim();
  if (from === "json") return JSON.parse(t);
  if (from === "yaml") { const v = YAML.load(t); if (v === undefined) throw new Error("empty YAML"); return v; }
  if (from === "csv") {
    const r = Papa.parse(t, { header: true, dynamicTyping: true, skipEmptyLines: true });
    if ((!r.data || !r.data.length) && r.errors && r.errors.length) throw new Error(r.errors[0].message);
    return r.data;
  }
  throw new Error("unknown source format: " + from);
}

/** Serialize a JS value into the target format. CSV flattens nested cells to JSON strings so a
 *  round-trip stays lossless-ish rather than rendering "[object Object]". */
function serialize(data, to) {
  if (to === "json") return JSON.stringify(data, null, 2);
  if (to === "yaml") return YAML.dump(data, { noRefs: true, lineWidth: 120 }).replace(/\n$/, "");
  if (to === "csv") return toCsv(data);
  throw new Error("unknown target format: " + to);
}
function toCsv(data) {
  let rows = Array.isArray(data) ? data : [data];
  if (!rows.length) return "";
  const allPrimitive = rows.every((r) => r === null || typeof r !== "object");
  if (allPrimitive) return Papa.unparse(rows.map((v) => ({ value: v })));
  const clean = rows.map((r) => {
    if (r === null || typeof r !== "object") return { value: r };
    const o = {};
    for (const k of Object.keys(r)) { const v = r[k]; o[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v; }
    return o;
  });
  return Papa.unparse(clean);
}

/** The one pipeline: raw text + optional source hint + target → converted text. Pure + model-free.
 *  Exposed for the UI, the God tool, and the in-tab verification harness. */
function convert(text, to, from) {
  const src = from && FORMATS.some((f) => f.id === from) ? from : detectFormat(text);
  if (!src) throw new Error("Couldn't detect the input format — paste CSV, JSON, or YAML.");
  const target = to || (src === "json" ? "yaml" : "json");
  const data = parseInput(text, src);
  const out = serialize(data, target);
  return { from: src, to: target, output: out };
}

// ==== render ================================================================================
let lastInput = "";
let result = null;   // { from, to, output }

function run() {
  const ta = $("conv-in");
  const text = (ta ? ta.value : lastInput) || "";
  lastInput = text;
  if (!text.trim()) { toast("Paste some CSV, JSON, or YAML first.", true); return; }
  try {
    result = convert(text, settings.to);
    render();
  } catch (e) { result = { error: msg(e) }; render(); }
}

function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = false;   // utility: hero stays; the work sits below
  view.textContent = "";

  const wrap = el("div", "work");

  // input
  const inField = el("div", "field");
  inField.append(el("label", "flabel", "Paste data"));
  const ta = el("textarea"); ta.id = "conv-in"; ta.rows = 7; ta.className = "conv-ta";
  ta.placeholder = "paste CSV, JSON, or YAML…";
  ta.value = lastInput || "";
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } });
  ta.addEventListener("input", () => { lastInput = ta.value; });
  inField.append(ta);
  inField.append(el("div", "fhint", "auto-detects the source · ⌘/Ctrl + Enter to convert"));
  wrap.append(inField);

  // target format + run
  const ctl = el("div", "ctlrow");
  const fmtField = el("div", "field");
  fmtField.append(el("label", "flabel", "Convert to"));
  const seg = el("div", "seg");
  for (const f of FORMATS) {
    const b = el("button", "segbtn" + (settings.to === f.id ? " on" : ""), f.label);
    b.onclick = () => { settings.to = f.id; saveSettings(); if (lastInput.trim()) run(); else render(); };
    seg.append(b);
  }
  fmtField.append(seg);
  ctl.append(fmtField);
  const runBtn = el("button", "primary", "Convert 🔄"); runBtn.onclick = run;
  ctl.append(runBtn);
  wrap.append(ctl);

  // sample loader when empty
  if (!lastInput.trim() && !result) {
    const s = el("button", "act", "load a sample");
    s.onclick = () => { lastInput = SAMPLE; render(); run(); };
    wrap.append(s);
  }

  // output
  if (result) {
    const out = el("div", "outcard");
    if (result.error) {
      out.append(el("div", "err", result.error));
    } else {
      const bar = el("div", "outbar");
      bar.append(el("span", "kicker", `${result.from} → ${result.to}`), el("span", "grow"));
      const cp = el("button", "act", "copy"); cp.onclick = () => copyOut();
      const dl = el("button", "act", "download"); dl.onclick = () => download();
      bar.append(cp, dl);
      out.append(bar);
      const pre = el("pre", "md out-md conv-out"); pre.id = "conv-out"; pre.textContent = result.output;
      out.append(pre);
    }
    wrap.append(out);
  }

  wrap.append(badge());
  view.append(wrap);
}

async function copyOut() {
  if (!result || !result.output) return;
  try { await navigator.clipboard.writeText(result.output); toast("Converted data copied ✓"); }
  catch { toast("Couldn't copy.", true); }
}
function download() {
  if (!result || !result.output) return;
  const ext = result.to === "yaml" ? "yaml" : result.to;
  const mime = result.to === "json" ? "application/json" : result.to === "csv" ? "text/csv" : "text/yaml";
  const blob = new Blob([result.output], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a"); a.href = url; a.download = `converted.${ext}`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}
render();

// ---- God's hand: one page-tool, driving the real pipeline, still ZERO model ------------------------
exposeToGod({
  name: "convert_run",
  description: "Convert data between CSV/JSON/YAML entirely on-device (no AI). Auto-detects the source; give a target format. Writes it on the page and returns the converted text.",
  inputSchema: {
    input: "string — the data to convert (CSV, JSON, or YAML). Required.",
    from: "string — source format hint 'csv'|'json'|'yaml'. Optional; auto-detected when omitted.",
    to: "string — target format 'csv'|'json'|'yaml'. Default: JSON (or YAML when the source is JSON).",
  },
  execute: async (input = {}) => {
    const text = String(input.input || "").trim();
    if (!text) throw new Error("nothing to convert — pass { input } with the data");
    const to = input.to && FORMATS.some((f) => f.id === input.to) ? input.to : settings.to;
    const from = input.from && FORMATS.some((f) => f.id === input.from) ? input.from : undefined;
    const r = convert(text, to, from);
    // drive the visible UI so a watching God webview sees it happen
    lastInput = text; settings.to = r.to; result = r; try { render(); } catch { /* headless */ }
    return { output: r.output, from: r.from, to: r.to };
  },
});

// ---- The GLANCE: a `text` widget (docs/WIDGETS.md §4.2) — the CONVERTED output + a "no AI" badge ----
// Accepts an optional file/text the notch launcher hands over; converts it with the SAME pipeline and
// returns just the result (never the picker UI). With nothing to convert it shows a prompt state.
function widgetTextFrom(input) {
  // Accept { text } | { input } | a dropped file's decoded text | { dataUrl } (data: URL → text).
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    if (typeof input.text === "string" && input.text.trim()) return input.text;
    if (typeof input.input === "string" && input.input.trim()) return input.input;
    if (typeof input.content === "string" && input.content.trim()) return input.content;
    const du = String(input.dataUrl || "");
    const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(du);
    if (m) { try { return m[1] ? decodeURIComponent(escape(atob(m[2]))) : decodeURIComponent(m[2]); } catch { return ""; } }
  }
  return "";
}
exposeWidget((input) => {
  const text = (widgetTextFrom(input) || lastInput || "").trim();
  if (!text) {
    return {
      kicker: "CONVERT · CSV · JSON · YAML", title: "Drop or paste data",
      openLabel: "Open Convert", shape: "text",
      result: { body: "Hand me CSV, JSON, or YAML — I convert it on your device.", caption: "no AI · on your device" },
    };
  }
  try {
    const r = convert(text, settings.to);
    const rows = Array.isArray(parseInput(text, r.from)) ? parseInput(text, r.from).length : 1;
    return {
      kicker: `CONVERT · ${r.from.toUpperCase()} → ${r.to.toUpperCase()}`,
      title: `${rows} row${rows === 1 ? "" : "s"} converted`,
      openLabel: "Open Convert", shape: "text", copyText: r.output,
      result: { body: r.output, caption: `${rows} row${rows === 1 ? "" : "s"} · no AI · on your device` },
    };
  } catch (e) {
    return {
      kicker: "CONVERT", title: "Couldn't read that", openLabel: "Open Convert", shape: "text",
      result: { body: msg(e), caption: "no AI · on your device" },
    };
  }
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__convertTest = { convert, detectFormat, parseInput, serialize, FORMATS }; } catch { /* ignore */ }
