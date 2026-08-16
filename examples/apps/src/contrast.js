// CONTRAST — a NON-AI widget. Two colours in, a WCAG readability verdict out — entirely IN THE TAB.
// No model, no cloud round-trip, no upload, no cost. Same doctrine as qr.js / resize.js: single focus,
// one primary answer, house design system, instantly steerable (change a colour and it re-grades).
// L0 engine tier (pure arithmetic). The WCAG maths lives, tested, in kit/contrast.js.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { evaluate, suggestForeground, parseColor, toHex, THRESHOLDS } from "./kit/contrast.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "contrast",
  name: "Contrast",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Contrast — checks WCAG colour contrast entirely on your device. No AI, no upload, no cost.",
    models: [],   // ← NON-AI: never requests a model.
    tools: [],
  },
  usesContext: null,
};

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 2600);
}

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
const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { fg: "#6E7C90", bg: "#0A0C10" };   // a real failing pair on first run, so the verdict UI shows
let state = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ fg: state.fg, bg: state.bg })); } catch { /* private mode */ } }

// ==== the pass/fail grid, in display order ==================================================
const LEVELS = [
  { key: "aa", label: "AA · normal" },
  { key: "aaLarge", label: "AA · large" },
  { key: "aaa", label: "AAA · normal" },
  { key: "aaaLarge", label: "AAA · large" },
  { key: "ui", label: "UI · 3:1" },
];

// ==== render ================================================================================
function render() {
  const view = $("view");
  view.textContent = "";
  const wrap = el("div", "work");

  // the two colour inputs + a swap
  const pair = el("div", "pairrow");
  pair.append(colorField("Text colour", "fg"));
  const swap = el("button", "swapbtn", "⇄"); swap.title = "Swap text and background";
  swap.onclick = () => { const t = state.fg; state.fg = state.bg; state.bg = t; saveSettings(); render(); };
  pair.append(swap);
  pair.append(colorField("Background", "bg"));
  wrap.append(pair);

  // the verdict
  const out = el("div", "outcard"); out.id = "c-out";
  fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

/** A fused swatch-picker + hex field. The native <input type=color> IS the picker (no library);
 *  the text field takes hex / rgb() / a colour name. Either updates the same state key. */
function colorField(label, key) {
  const f = el("div", "field");
  f.append(el("label", "flabel", label));
  const box = el("div", "cin");
  const sw = el("input"); sw.type = "color"; sw.className = "sw";
  const parsed = parseColor(state[key]);
  sw.value = parsed ? toHex(parsed) : "#000000";
  const tx = el("input"); tx.type = "text"; tx.value = state[key]; tx.spellcheck = false;
  tx.setAttribute("aria-label", label);
  tx.id = "c-" + key;
  sw.oninput = () => { state[key] = sw.value; tx.value = sw.value; saveSettings(); refreshOut(); };
  tx.addEventListener("input", () => { state[key] = tx.value; const p = parseColor(tx.value); if (p) sw.value = toHex(p); saveSettings(); refreshOut(); });
  box.append(sw, tx);
  f.append(box);
  return f;
}

/** Repaint only the verdict card — keystrokes in a hex field must not rebuild (and refocus) the
 *  inputs. Same discipline the QR wrapp needed. */
function refreshOut() { const o = $("c-out"); if (o) fillOut(o); }

function fillOut(out) {
  out.textContent = "";
  const v = evaluate(state.fg, state.bg);
  if (!v.ok) { out.append(el("div", "err", v.error + " — try a hex like #1a2b3c, an rgb(…), or a name.")); return; }

  // live sample: real text at both sizes, on the real pair
  const sample = el("div", "sample");
  sample.style.background = v.bg; sample.style.color = v.fg;
  sample.append(el("div", "big", "Big heading — 24px bold"));
  sample.append(el("div", "small", "Body copy at a normal reading size, the way it would actually appear."));
  out.append(sample);

  // ratio + grade + one-line summary
  const verdict = el("div", "verdict");
  verdict.append(el("div", "ratio", v.ratioText));
  verdict.append(el("div", "grade " + v.grade, v.grade));
  verdict.append(el("div", "summary", v.summary));
  out.append(verdict);

  // the pass/fail grid
  const grid = el("div", "checks");
  for (const lv of LEVELS) {
    const c = el("div", "chk " + (v.pass[lv.key] ? "pass" : "fail"));
    c.append(el("div", "lv", lv.label));
    c.append(el("div", "st", v.pass[lv.key] ? "Pass" : "Fail"));
    grid.append(c);
  }
  out.append(grid);

  // a fix when it fails AA — the "how do I make it pass" answer, one tap to apply
  if (!v.pass.aa) {
    const fix = suggestForeground(state.fg, state.bg, THRESHOLDS.aa);
    const row = el("div", "suggest");
    if (fix) {
      const sw = el("span", "sw"); sw.style.background = fix;
      row.append(sw);
      row.append(document.createTextNode(`Nearest text colour that passes AA: ${fix}.`));
      const b = el("button", null, "Use it");
      b.onclick = () => { state.fg = fix; saveSettings(); render(); toast("Applied " + fix + " ✓"); };
      row.append(b);
    } else {
      row.append(document.createTextNode("No shade of this text colour passes AA on this background — the background is too mid-toned. Lighten or darken the background."));
    }
    out.append(row);
  }
}

function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}
render();

// ---- God's hand: check a pair headlessly, still ZERO model -----------------------------------------
exposeToGod({
  name: "check_contrast",
  description: "Check the WCAG colour-contrast ratio between a text colour and a background entirely "
    + "on-device (no AI). Accepts hex (#rrggbb / #rgb), rgb()/rgba(), or CSS colour names. Returns the "
    + "ratio, AA/AAA pass-fail for normal, large and UI text, a plain summary, and — when it fails AA — "
    + "the nearest text colour that would pass.",
  inputSchema: {
    fg: "string — the text / foreground colour. Required. e.g. '#777', 'rgb(120,120,120)', 'slategray'.",
    bg: "string — the background colour. Required.",
    text: "string — optional convenience: 'FG on BG' or 'FG,BG' as one string, used if fg/bg are absent.",
  },
  execute: async (input = {}) => {
    let fg = input.fg, bg = input.bg;
    if ((!fg || !bg) && input.text) {
      const parts = String(input.text).split(/\s+on\s+|,|\s+/).filter(Boolean);
      fg = fg || parts[0]; bg = bg || parts[1];
    }
    const v = evaluate(fg, bg);
    if (!v.ok) throw new Error(v.error);
    const suggestion = v.pass.aa ? null : suggestForeground(fg, bg, THRESHOLDS.aa);
    // drive the visible UI so a watching God webview sees it
    state.fg = v.fg; state.bg = v.bg; try { render(); } catch { /* headless */ }
    return { ratio: v.ratio, ratioText: v.ratioText, grade: v.grade, pass: v.pass, summary: v.summary,
             fg: v.fg, bg: v.bg, suggestion };
  },
});

// ---- The GLANCE: a `text` widget (docs/WIDGETS.md) — the verdict at a glance ------------------------
// Accepts { fg, bg } (or a "fg on bg" text) the notch launcher hands over; grades on-device.
exposeWidget((input) => {
  let fg = state.fg, bg = state.bg;
  if (input && (input.fg || input.bg)) { fg = input.fg || fg; bg = input.bg || bg; }
  else if (input && input.text) { const p = String(input.text).split(/\s+on\s+|,|\s+/).filter(Boolean); fg = p[0] || fg; bg = p[1] || bg; }
  const v = evaluate(fg, bg);
  if (!v.ok) {
    return { kicker: "CONTRAST · ON YOUR DEVICE", title: "Check a colour pair", openLabel: "Open Contrast", shape: "text",
             result: { body: "Give me a text colour and a background — I check WCAG contrast on your device.", caption: "no AI · on your device" } };
  }
  const emoji = v.pass.aa ? "✓" : v.pass.aaLarge ? "▲" : "✕";
  return {
    kicker: "CONTRAST · ON YOUR DEVICE",
    title: `${v.ratioText} · ${v.grade}`,
    openLabel: "Open Contrast", shape: "text",
    result: {
      body: `${emoji} ${v.summary}`,
      caption: `${v.fg} on ${v.bg} · no AI`,
    },
  };
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__contrastTest = { evaluate, suggestForeground }; } catch { /* ignore */ }
