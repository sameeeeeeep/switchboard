// ENCODING TOOLS — a NON-AI widget. Base64 / URL / HTML entities / SHA hashes, encode or decode, IN
// THE TAB using the browser's own crypto. No model, no cloud, no upload, no cost. Same doctrine as
// qr.js / contrast.js. L0 engine tier. Transforms in kit/encoder.js (tested against known vectors).
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { MODES, HASH_ALGOS, convert } from "./kit/encoder.js";

const APP = {
  id: "encoder", name: "Encoding Tools", installUrl: "https://thelastprompt.ai/switchboard/",
  scope: { reason: "Encoding Tools — base64/url/html/hash entirely on your device. No AI, no upload, no cost.", models: [], tools: [] },
  usesContext: null,
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
let toastT = null;
function toast(text, err) { clearTimeout(toastT); let t = document.querySelector(".toast"); if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text; toastT = setTimeout(() => t.remove(), 2400); }

let relay = null;
mountConnect($("chip-dock"), { scope: APP.scope, context: APP.usesContext, installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; }, onDisconnect: () => { relay = null; } });
(async () => { const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; } })();

// ==== settings — the mode + direction + algo. The TEXT is never persisted (could be a secret). =====
const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { mode: "base64", decode: false, urlSafe: false, algo: "SHA-256" };
let state = loadSettings();
let text = "";   // in-memory only
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state)); } catch { /* private mode */ } }

const modeDef = () => MODES.find((m) => m.id === state.mode) || MODES[0];

// ==== render ================================================================================
function render() {
  const view = $("view"); view.textContent = "";
  const wrap = el("div", "work");
  const tabs = el("div", "kindrow");
  for (const m of MODES) { const b = el("button", "kindbtn" + (m.id === state.mode ? " on" : ""), m.label);
    b.onclick = () => { state.mode = m.id; saveSettings(); render(); }; tabs.append(b); }
  wrap.append(tabs);

  const md = modeDef();
  // controls row: encode/decode toggle (hidden for one-way hashes), + algo select for hash
  const ctl = el("div", "erow");
  if (!md.oneWay) {
    const seg = el("div", "kindrow");
    for (const [lab, dec] of [["Encode", false], ["Decode", true]]) {
      const b = el("button", "kindbtn" + (state.decode === dec ? " on" : ""), lab);
      b.onclick = () => { state.decode = dec; saveSettings(); render(); }; seg.append(b);
    }
    ctl.append(seg);
    if (md.urlSafe && !state.decode) {
      const b = el("button", "kindbtn" + (state.urlSafe ? " on" : ""), "URL-safe");
      b.onclick = () => { state.urlSafe = !state.urlSafe; saveSettings(); refreshOut(); }; ctl.append(b);
    }
  } else {
    const s = el("select", "in"); s.style.maxWidth = "180px";
    for (const a of HASH_ALGOS) { const o = el("option", null, a); o.value = a; s.append(o); }
    s.value = state.algo; s.onchange = () => { state.algo = s.value; saveSettings(); refreshOut(); };
    ctl.append(s);
  }
  wrap.append(ctl);

  const inField = el("div", "field");
  inField.append(el("label", "flabel", md.oneWay ? "Text to hash" : (state.decode ? "Text to decode" : "Text to encode")));
  const ta = el("textarea"); ta.className = "in"; ta.id = "e-in"; ta.value = text; ta.placeholder = "Paste or type here…";
  ta.addEventListener("input", () => { text = ta.value; refreshOut(); });
  inField.append(ta);
  wrap.append(inField);

  const out = el("div", "outcard"); out.id = "e-out"; fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

function refreshOut() { const o = $("e-out"); if (o) fillOut(o); }

async function fillOut(out) {
  out.textContent = "";
  if (!text) { out.append(el("div", "placeholder", modeDef().oneWay ? "Enter text to hash." : "Enter text to " + (state.decode ? "decode" : "encode") + ".")); return; }
  const r = await convert(state.mode, text, { decode: state.decode, urlSafe: state.urlSafe, algo: state.algo });
  if (!r.ok) { out.append(el("div", "err", r.error)); return; }
  const pre = el("div", "eout"); pre.textContent = r.output; pre.id = "e-output";
  out.append(pre);
  const row = el("div", "erow"); row.style.marginTop = "10px";
  const cp = el("button", "copy", "Copy");
  cp.onclick = async () => { try { await navigator.clipboard.writeText(r.output); toast("Copied ✓"); } catch { toast("Copy not supported", true); } };
  row.append(cp);
  const meta = el("span", "flabel", `${r.output.length} chars`); meta.style.opacity = ".7";
  row.append(meta);
  out.append(row);
}

function badge() { const b = el("div", "nobadge"); b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost")); return b; }
render();

// ---- God's hand ------------------------------------------------------------------------------------
exposeToGod({
  name: "encode_text",
  description: "Encode or decode text on-device (no AI). mode 'base64' (with optional urlSafe), 'url', "
    + "'html' (entities), or 'hash' (SHA-1/256/384/512, encode-only). Set decode:true to reverse "
    + "base64/url/html.",
  inputSchema: {
    text: "string — the text to transform. Required.",
    mode: "string — base64 | url | html | hash.",
    decode: "boolean — reverse the transform (base64/url/html only).",
    urlSafe: "boolean — base64 only: url-safe alphabet, no padding.",
    algo: "string — hash only: SHA-1 | SHA-256 | SHA-384 | SHA-512 (default SHA-256).",
  },
  execute: async (input = {}) => {
    const mode = MODES.some((m) => m.id === input.mode) ? input.mode : "base64";
    const r = await convert(mode, String(input.text ?? ""), { decode: !!input.decode, urlSafe: !!input.urlSafe, algo: input.algo || "SHA-256" });
    if (!r.ok) throw new Error(r.error);
    state.mode = mode; state.decode = !!input.decode; text = String(input.text ?? ""); try { render(); } catch { /* headless */ }
    return { mode, output: r.output };
  },
});

// ---- the glance ------------------------------------------------------------------------------------
exposeWidget(async (input) => {
  const t = input && input.text != null ? String(input.text) : text;
  if (!t) return { kicker: "ENCODE · ON YOUR DEVICE", title: "Encode / decode text", openLabel: "Open Encode", shape: "text",
    result: { body: "Base64, URL, HTML entities or a SHA hash — on your device.", caption: "no AI · on your device" } };
  const mode = input && MODES.some((m) => m.id === input.mode) ? input.mode : state.mode;
  const r = await convert(mode, t, { decode: input?.decode ?? state.decode, urlSafe: state.urlSafe, algo: state.algo });
  const body = r.ok ? (r.output.length > 120 ? r.output.slice(0, 119) + "…" : r.output) : r.error;
  return { kicker: "ENCODE · ON YOUR DEVICE", title: `${mode}${modeDef().oneWay ? "" : (state.decode ? " · decode" : " · encode")}`,
    openLabel: "Open Encode", shape: "text", result: { body, caption: "no AI · on your device" } };
});

try { (typeof window !== "undefined" ? window : globalThis).__encoderTest = { convert }; } catch { /* ignore */ }
