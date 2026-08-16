// COLOR CONVERTER — a NON-AI widget. One colour, every notation, IN THE TAB. No model, no cloud, no
// upload, no cost. Same doctrine as qr.js / contrast.js. L0 engine tier. Conversions in kit/color.js.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { parse, toHex, allNotations } from "./kit/color.js";

const APP = {
  id: "color", name: "Color Converter", installUrl: "https://thelastprompt.ai/switchboard/",
  scope: { reason: "Color Converter — converts colour notations entirely on your device. No AI, no upload, no cost.", models: [], tools: [] },
  usesContext: null,
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
let toastT = null;
function toast(text, err) { clearTimeout(toastT); let t = document.querySelector(".toast"); if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text; toastT = setTimeout(() => t.remove(), 2200); }

let relay = null;
mountConnect($("chip-dock"), { scope: APP.scope, context: APP.usesContext, installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; }, onDisconnect: () => { relay = null; } });
(async () => { const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; } })();

const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { value: "#3A7BD5" };
let state = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ value: state.value })); } catch { /* private */ } }

const ROWS = [["HEX", "hex"], ["HEX (alpha)", "hexa"], ["RGB", "rgb"], ["HSL", "hsl"], ["HSV", "hsv"], ["OKLCH", "oklch"]];

function render() {
  const view = $("view"); view.textContent = "";
  const wrap = el("div", "work");

  // input: native picker swatch + a free-text field (any notation)
  const box = el("div", "cin");
  const sw = el("input"); sw.type = "color"; sw.className = "sw";
  const parsed = parse(state.value);
  sw.value = parsed ? toHex(parsed) : "#000000";
  const tx = el("input"); tx.type = "text"; tx.value = state.value; tx.spellcheck = false; tx.id = "c-in";
  tx.placeholder = "#3a7bd5, rgb(58,123,213), hsl(…), oklch(…), or a name";
  sw.oninput = () => { state.value = sw.value; tx.value = sw.value; saveSettings(); refreshOut(); };
  tx.addEventListener("input", () => { state.value = tx.value; const p = parse(tx.value); if (p) sw.value = toHex(p); saveSettings(); refreshOut(); });
  box.append(sw, tx);
  const f = el("div", "field"); f.append(el("label", "flabel", "Colour")); f.append(box);
  wrap.append(f);

  const out = el("div", "outcard"); out.id = "c-out"; fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

function refreshOut() { const o = $("c-out"); if (o) fillOut(o); }

function fillOut(out) {
  out.textContent = "";
  const c = parse(state.value);
  if (!c) { out.append(el("div", "err", "That isn't a colour I can read — try #hex, rgb(…), hsl(…), oklch(…), or a name.")); return; }
  const n = allNotations(c);

  const preview = el("div", "cpreview"); preview.style.background = toHex(c);
  out.append(preview);

  const grid = el("div", "cgrid");
  for (const [label, key] of ROWS) {
    if (key === "hexa" && (c.a == null || c.a >= 1)) continue;   // only show alpha hex when there IS alpha
    const row = el("div", "crow");
    row.append(el("div", "ck", label));
    row.append(el("div", "cv", n[key]));
    const cp = el("button", "copy", "copy");
    cp.onclick = async () => { try { await navigator.clipboard.writeText(n[key]); toast(label + " copied ✓"); } catch { toast("Copy not supported", true); } };
    row.append(cp);
    grid.append(row);
  }
  out.append(grid);
}

function badge() { const b = el("div", "nobadge"); b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost")); return b; }
render();

// ---- God's hand ------------------------------------------------------------------------------------
exposeToGod({
  name: "convert_color",
  description: "Convert a colour into every notation on-device (no AI). Accepts hex, rgb()/rgba(), "
    + "hsl()/hsla(), hsv(), oklch(), or a CSS colour name. Returns hex, rgb, hsl, hsv and oklch strings.",
  inputSchema: { color: "string — the colour in any notation. Required." },
  execute: async (input = {}) => {
    const c = parse(input.color ?? input.text);
    if (!c) throw new Error(`can't read the colour "${input.color ?? input.text}"`);
    state.value = toHex(c); try { render(); } catch { /* headless */ }
    return allNotations(c);
  },
});

// ---- the glance ------------------------------------------------------------------------------------
exposeWidget((input) => {
  const val = input && (input.color || input.text) ? String(input.color || input.text) : state.value;
  const c = parse(val);
  if (!c) return { kicker: "COLOR · ON YOUR DEVICE", title: "Convert a colour", openLabel: "Open Color", shape: "text",
    result: { body: "Give me a colour in any notation — I convert it on your device.", caption: "no AI · on your device" } };
  const n = allNotations(c);
  return { kicker: "COLOR · ON YOUR DEVICE", title: n.hex.toUpperCase(), openLabel: "Open Color", shape: "text",
    result: { body: `${n.rgb} · ${n.hsl} · ${n.oklch}`, caption: "no AI · on your device" } };
});

try { (typeof window !== "undefined" ? window : globalThis).__colorTest = { parse, allNotations }; } catch { /* ignore */ }
