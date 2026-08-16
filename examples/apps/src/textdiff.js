// TEXT DIFF — a NON-AI widget. Two blocks of text, the difference highlighted, IN THE TAB. No model,
// no cloud, no upload, no cost. Same doctrine as qr.js / contrast.js. L0 engine tier (an LCS diff).
// Diff logic in kit/textdiff.js, with the round-trip invariant pinned in its test.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { diffLines, diffWords, stats, summarize } from "./kit/textdiff.js";

const APP = {
  id: "textdiff", name: "Text Diff", installUrl: "https://thelastprompt.ai/switchboard/",
  scope: { reason: "Text Diff — compares two texts entirely on your device. No AI, no upload, no cost.", models: [], tools: [] },
  usesContext: null,
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

let relay = null;
mountConnect($("chip-dock"), { scope: APP.scope, context: APP.usesContext, installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; }, onDisconnect: () => { relay = null; } });
(async () => { const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; } })();

// ==== settings — only the MODE persists; the two texts are in-memory (could be sensitive) ==========
const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { mode: "lines" };
let state = loadSettings();
let a = "", b = "";
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state)); } catch { /* private mode */ } }

// ==== render ================================================================================
function render() {
  const view = $("view"); view.textContent = "";
  const wrap = el("div", "work");

  const tabs = el("div", "kindrow");
  for (const [id, lab] of [["lines", "Line diff"], ["words", "Word diff"]]) {
    const btn = el("button", "kindbtn" + (state.mode === id ? " on" : ""), lab);
    btn.onclick = () => { state.mode = id; saveSettings(); render(); }; tabs.append(btn);
  }
  wrap.append(tabs);

  const twin = el("div", "twin");
  twin.append(textField("Original", "d-a", a));
  twin.append(textField("Changed", "d-b", b));
  wrap.append(twin);

  const out = el("div", "outcard"); out.id = "d-out"; fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

function textField(label, id, val) {
  const f = el("div", "field"); f.append(el("label", "flabel", label));
  const ta = el("textarea"); ta.className = "in"; ta.id = id; ta.value = val; ta.placeholder = "Paste text…";
  ta.addEventListener("input", () => { if (id === "d-a") a = ta.value; else b = ta.value; refreshOut(); });
  f.append(ta); return f;
}
function refreshOut() { const o = $("d-out"); if (o) fillOut(o); }

function fillOut(out) {
  out.textContent = "";
  if (!a && !b) { out.append(el("div", "placeholder", "Paste text into both boxes to see what changed.")); return; }
  const ops = state.mode === "words" ? diffWords(a, b) : diffLines(a, b);
  // Word mode tokenises whitespace too (so the diff can reconstruct B exactly), but counting those
  // runs would report "+9" for adding one line — misleading. Count only the tokens that carry
  // content; the visual highlight still shows every change.
  const meaningful = state.mode === "words" ? ops.filter((o) => o.value.trim() !== "") : ops;
  const s = stats(meaningful);

  const st = el("div", "diffstat");
  st.append(el("span", "a", `+${s.added}`));
  st.append(el("span", "r", `−${s.removed}`));
  st.append(el("span", null, `${s.unchanged} unchanged`));
  out.append(st);

  const view = el("div", "diffview"); view.style.marginTop = "12px";
  const sep = state.mode === "words" ? "" : "\n";
  ops.forEach((op, i) => {
    const cls = op.type === "add" ? "add" : op.type === "remove" ? "rem" : null;
    const piece = op.value + (state.mode === "lines" && i < ops.length - 1 ? sep : (state.mode === "words" ? "" : ""));
    if (cls) { const span = el("span", cls, piece); view.append(span); }
    else view.append(document.createTextNode(piece));
  });
  if (s.added === 0 && s.removed === 0) { view.textContent = ""; view.append(el("span", null, "The two texts are identical.")); }
  out.append(view);
}

function badge() { const b = el("div", "nobadge"); b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost")); return b; }
render();

// ---- God's hand ------------------------------------------------------------------------------------
exposeToGod({
  name: "diff_text",
  description: "Compare two texts on-device (no AI) and return the differences. mode 'lines' (default) "
    + "or 'words'. Returns the op list, an added/removed count, and a one-line summary.",
  inputSchema: {
    a: "string — the original text. Required.",
    b: "string — the changed text. Required.",
    mode: "string — 'lines' or 'words'.",
  },
  execute: async (input = {}) => {
    const mode = input.mode === "words" ? "words" : "lines";
    const ops = mode === "words" ? diffWords(input.a ?? "", input.b ?? "") : diffLines(input.a ?? "", input.b ?? "");
    a = String(input.a ?? ""); b = String(input.b ?? ""); state.mode = mode; try { render(); } catch { /* headless */ }
    return { mode, stats: stats(ops), summary: summarize(ops), ops };
  },
});

// ---- the glance ------------------------------------------------------------------------------------
exposeWidget((input) => {
  const ta = input && input.a != null ? String(input.a) : a;
  const tb = input && input.b != null ? String(input.b) : b;
  if (!ta && !tb) return { kicker: "DIFF · ON YOUR DEVICE", title: "Compare two texts", openLabel: "Open Diff", shape: "text",
    result: { body: "Paste two versions — I show exactly what changed, on your device.", caption: "no AI · on your device" } };
  const mode = input && input.mode === "words" ? "words" : state.mode;
  const ops = mode === "words" ? diffWords(ta, tb) : diffLines(ta, tb);
  const s = stats(ops);
  return { kicker: "DIFF · ON YOUR DEVICE", title: summarize(ops), openLabel: "Open Diff", shape: "text",
    result: { body: `${s.added} added · ${s.removed} removed · ${s.unchanged} unchanged (${mode})`, caption: "no AI · on your device" } };
});

try { (typeof window !== "undefined" ? window : globalThis).__textdiffTest = { diffLines, diffWords, stats }; } catch { /* ignore */ }
