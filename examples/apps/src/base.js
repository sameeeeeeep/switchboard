// BASE CONVERTER — a NON-AI widget. Type an integer, pick its base, see it in every base at once —
// entirely IN THE TAB. No model, no cloud round-trip, no upload, no cost. Same doctrine as qr.js /
// contrast.js: single input, one primary answer, house design system, instantly steerable (change the
// value or the base and it re-converts). L0 engine tier (pure BigInt arithmetic). The maths lives,
// tested, in kit/base.js — BigInt throughout so a 64-bit value converts EXACTLY, not rounded off.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { parseIn, toBase, convertAll, isValidBase, MIN_BASE, MAX_BASE } from "./kit/base.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "base",
  name: "Base Converter",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Base Converter — converts integers between number bases entirely on your device. No AI, no upload, no cost.",
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
// Persist WHAT you were converting (the value string) and FROM which base, so reopening resumes where
// you left off. Nothing here is sensitive — it's a number a user typed to convert, not a secret.
const DEFAULTS = { value: "255", from: "16", custom: 36 };   // 0xff on first run, so the results grid is populated
let state = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ value: state.value, from: state.from, custom: state.custom })); } catch { /* private mode */ } }

// ==== the "from base" choices ═══════════════════════════════════════════════════════════════
// The four common bases by name, plus a Custom escape hatch (2…36). `from` is stored as a STRING —
// "10"/"16"/"2"/"8" for the named ones, "custom" for the arbitrary-base mode — so a single select
// value carries both the choice and (via `state.custom`) the arbitrary radix.
const FROM_CHOICES = [
  { id: "10", label: "Decimal" },
  { id: "16", label: "Hex" },
  { id: "2", label: "Binary" },
  { id: "8", label: "Octal" },
  { id: "custom", label: "Custom base…" },
];
// The four bases we ALWAYS show in the results panel, with the prefix a programmer expects on a copy.
const OUT_BASES = [
  { key: "dec", base: 10, label: "Decimal", prefix: "" },
  { key: "hex", base: 16, label: "Hex", prefix: "0x" },
  { key: "bin", base: 2, label: "Binary", prefix: "0b" },
  { key: "oct", base: 8, label: "Octal", prefix: "0o" },
];

/** The active input base as a NUMBER (resolving "custom" to the chosen radix). */
function activeBase() {
  if (state.from === "custom") return clampBase(state.custom);
  return Number(state.from);
}
function clampBase(n) { n = Math.trunc(Number(n)); return Number.isFinite(n) ? Math.max(MIN_BASE, Math.min(MAX_BASE, n)) : 10; }

// ==== render ================================================================================
function render() {
  const view = $("view");
  view.textContent = "";
  const wrap = el("div", "work");

  // the input row: the value field + the "from base" selector
  const inrow = el("div", "inrow");

  const vfield = el("div", "field");
  vfield.append(el("label", "flabel", "Value"));
  const vin = el("input"); vin.type = "text"; vin.className = "vin"; vin.id = "b-value";
  vin.value = state.value; vin.spellcheck = false; vin.autocapitalize = "off"; vin.autocomplete = "off";
  vin.setAttribute("aria-label", "Value to convert");
  vin.placeholder = "e.g. ff, 0xff, 1010, -42";
  // Typing must repaint ONLY the results — a full render() would replace this <input> and drop focus
  // mid-keystroke (a bug we hit twice on other wrapps). refreshOut() leaves the form's DOM alone.
  vin.addEventListener("input", () => { state.value = vin.value; saveSettings(); refreshOut(); });
  vfield.append(vin);
  inrow.append(vfield);

  const bfield = el("div", "field frombase");
  bfield.append(el("label", "flabel", "From base"));
  const sel = el("select", "bsel"); sel.id = "b-from";
  for (const c of FROM_CHOICES) { const o = el("option", null, c.label); o.value = c.id; sel.append(o); }
  sel.value = state.from;
  sel.onchange = () => { state.from = sel.value; saveSettings(); render(); };   // full render: shows/hides the custom-base field
  bfield.append(sel);
  inrow.append(bfield);

  // the arbitrary-base number, only when Custom is chosen
  if (state.from === "custom") {
    const cfield = el("div", "field custfield");
    cfield.append(el("label", "flabel", `Base (2–${MAX_BASE})`));
    const cin = el("input"); cin.type = "number"; cin.className = "cin"; cin.id = "b-custom";
    cin.min = String(MIN_BASE); cin.max = String(MAX_BASE); cin.step = "1";
    cin.value = String(clampBase(state.custom));
    cin.setAttribute("aria-label", "Custom base 2 to 36");
    cin.addEventListener("input", () => { state.custom = clampBase(cin.value); saveSettings(); refreshOut(); });
    // Snap the visible number to the clamped value only when the field loses focus, so mid-typing
    // (e.g. deleting to retype "20") isn't fought by the input.
    cin.addEventListener("blur", () => { cin.value = String(clampBase(cin.value)); });
    cfield.append(cin);
    inrow.append(cfield);
  }
  wrap.append(inrow);

  // the live results panel — the value in all four common bases at once
  const out = el("div", "outcard"); out.id = "b-out";
  fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

/** Repaint only the results card — keystrokes in the value/custom-base fields must not rebuild (and
 *  refocus) the inputs. Same discipline the QR + Contrast wrapps needed. */
function refreshOut() { const o = $("b-out"); if (o) fillOut(o); }

function fillOut(out) {
  out.textContent = "";
  const base = activeBase();
  const raw = state.value;

  // empty state — name it, don't leave a blank card looking broken.
  if (!raw || !raw.trim()) {
    out.append(el("div", "placeholder", `Type an integer in base ${base} above — I'll show it in decimal, hex, binary and octal at once.`));
    return;
  }

  const v = parseIn(raw, base);
  // invalid state — say WHICH digit range is legal for this base, the actual thing they got wrong.
  if (v == null) {
    out.append(el("div", "err", `"${raw.trim()}" isn't a valid base-${base} integer. ${legalDigitsHint(base)}`));
    return;
  }

  // the four rows — each: label, value (prefixed, monospace), copy button.
  const grid = el("div", "brows");
  for (const b of OUT_BASES) {
    const digits = toBase(v, b.base);
    const row = el("div", "brow" + (b.base === base ? " src" : ""));
    row.append(el("div", "blabel", b.label + (b.base === base ? " · input" : "")));
    const valwrap = el("div", "bval");
    if (b.prefix) valwrap.append(el("span", "bpfx", b.prefix));
    valwrap.append(el("span", "bdig", digits));
    row.append(valwrap);
    const cp = el("button", "bcopy", "copy"); cp.setAttribute("aria-label", `Copy ${b.label}`);
    const full = b.prefix + digits;
    cp.onclick = () => copy(full, b.label);
    row.append(cp);
    grid.append(row);
  }
  out.append(grid);

  // a one-line footer echoing what it read, incl. the arbitrary base when that's the input.
  const note = base === 10 || base === 16 || base === 2 || base === 8
    ? `${OUT_BASES.find((o) => o.base === base)?.label || ("base " + base)} in · exact BigInt (no rounding)`
    : `Base ${base} in · exact BigInt (no rounding)`;
  out.append(el("div", "bnote", note));
}

/** The plain-English "here's what's legal" line for an invalid value in `base`. */
function legalDigitsHint(base) {
  if (base <= 10) return `Digits 0–${base - 1} only.`;
  const last = String.fromCharCode(96 + (base - 10));   // base 16 → 'f', base 36 → 'z'
  return `Digits 0–9 and a–${last} only (a leading '-' is fine).`;
}

async function copy(textVal, label) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(textVal); toast(`${label} copied ✓`); }
    else throw new Error("no clipboard");
  } catch { toast("Couldn't copy here — select and copy manually.", true); }
}

function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}
render();

// ---- God's hand: convert a value between bases headlessly, still ZERO model ------------------------
exposeToGod({
  name: "convert_base",
  description: "Convert an integer from one number base to another (or to all four common bases) "
    + "entirely on-device (no AI). Uses exact BigInt maths, so 64-bit and larger values convert "
    + "without rounding. Accepts hex (0x…), binary (0b…), octal (0o…), decimal, or any base 2–36, "
    + "and tolerates spaces/underscores and a leading '-'. Returns the value in decimal, hex, binary, "
    + "octal, and — if a target base is given — that base too.",
  inputSchema: {
    value: "string — the integer to convert, in `from` base. Required. e.g. 'ff', '0xff', '1010', '-42'.",
    from: "number — the base the value is written in, 2–36. Default 10.",
    to: "number — optional single target base 2–36; its result is returned as `toResult`. Omit to just get all four common bases.",
    text: "string — optional convenience: 'ff base 16' or 'ff 16' as one string, used to fill value+from if those are absent.",
  },
  execute: async (input = {}) => {
    let value = input.value, from = input.from, to = input.to;
    // convenience parse of a single `text` like "ff base 16" / "ff 16" / "1010 in 2"
    if ((value == null || from == null) && input.text) {
      const m = String(input.text).trim().match(/^(\S+)(?:\s+(?:base|in|from)?\s*(\d+))?/i);
      if (m) { value = value ?? m[1]; if (from == null && m[2]) from = Number(m[2]); }
    }
    const fromBase = from == null ? 10 : Number(from);
    if (!isValidBase(fromBase)) throw new Error(`base ${from} is out of range — must be an integer 2–36`);
    const all = convertAll(value, fromBase);
    if (!all) throw new Error(`"${value}" isn't a valid base-${fromBase} integer`);
    const v = parseIn(value, fromBase);

    let toResult = null, toBaseNum = null;
    if (to != null) {
      toBaseNum = Number(to);
      if (!isValidBase(toBaseNum)) throw new Error(`target base ${to} is out of range — must be an integer 2–36`);
      toResult = toBase(v, toBaseNum);
    }

    // drive the visible UI so a watching God webview sees it (mirror into the form + repaint).
    state.value = String(value); state.from = String(fromBase); try { render(); } catch { /* headless */ }

    return {
      value: String(value), from: fromBase,
      dec: all.dec, hex: all.hex, bin: all.bin, oct: all.oct,
      decimal: all.dec,   // spelled-out alias, so a caller can read either key
      ...(toResult != null ? { to: toBaseNum, toResult } : {}),
    };
  },
});

// ---- The GLANCE: a `text` widget (docs/WIDGETS.md) — the value in the common bases at a glance -----
// Accepts { value, from } (or a "ff base 16" text) the notch launcher hands over; converts on-device.
exposeWidget((input) => {
  let value = state.value, from = activeBase();
  if (input && input.value != null) { value = input.value; if (input.from != null) from = Number(input.from); }
  else if (input && input.text) {
    const m = String(input.text).trim().match(/^(\S+)(?:\s+(?:base|in|from)?\s*(\d+))?/i);
    if (m) { value = m[1]; if (m[2]) from = Number(m[2]); }
  }
  const all = isValidBase(from) ? convertAll(value, from) : null;
  if (!all) {
    return {
      kicker: "BASE · ON YOUR DEVICE", title: "Convert a number's base",
      openLabel: "Open Base Converter", shape: "text",
      result: { body: "Give me an integer and its base — I show it in decimal, hex, binary and octal on your device.", caption: "no AI · on your device" },
    };
  }
  // the spec's showcase glance: "255 = 0xff = 0b11111111"
  return {
    kicker: "BASE · ON YOUR DEVICE",
    title: `${all.dec} = 0x${all.hex} = 0b${all.bin}`,
    openLabel: "Open Base Converter", shape: "text",
    result: {
      body: `dec ${all.dec} · hex 0x${all.hex} · oct 0o${all.oct} · bin 0b${all.bin}`,
      caption: `from base ${from} · exact BigInt · no AI`,
    },
  };
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__baseTest = { parseIn, toBase, convertAll }; } catch { /* ignore */ }
