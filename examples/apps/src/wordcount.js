// WORD COUNTER — a NON-AI widget. Paste text, get a live breakdown — entirely IN THE TAB.
// No model, no cloud round-trip, no upload, no cost. Same doctrine as contrast.js / qr.js: single
// focus, one primary answer, house design system, instantly steerable (type and it re-counts).
// L0 engine tier (pure string work). The analysis lives, tested, in kit/wordcount.js.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { analyze } from "./kit/wordcount.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "wordcount",
  name: "Word Counter",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Word Counter — analyses text entirely on your device. No AI, no upload, no cost.",
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
// Format a whole-minute count the way a reading-time badge reads: "<1 min" when there's text but it
// rounds to under a minute is already handled by the ceil in the kit, so this just adds the unit.
const mins = (n) => `${n} min`;

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
// The pasted text persists so a reload doesn't lose your draft — it's your own text on your own
// device, never sensitive-by-default the way a Wi-Fi password would be. Cleared with the Clear button.
const SETTINGS_KEY = APP.id + "-settings";
const SAMPLE = "The art of writing is the art of discovering what you believe. Good prose is like a "
  + "windowpane: it lets the reader see straight through to the thought. Cut every word that does not "
  + "earn its place, and the ones that remain will carry more weight.\n\nRead it aloud. If you stumble, "
  + "so will your reader.";
const DEFAULTS = { text: SAMPLE };   // a real paragraph on first run, so the stats grid shows something live
let state = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ text: state.text })); } catch { /* private mode */ } }

// ==== the stats grid, in display order ======================================================
// key → how to read it out of the analyze() result. One place, so the grid and the copy-out agree.
const STATS = [
  { label: "Words", get: (a) => a.words, big: true },
  { label: "Characters", get: (a) => a.chars, big: true },
  { label: "Sentences", get: (a) => a.sentences, big: true },
  { label: "Paragraphs", get: (a) => a.paragraphs, big: true },
  { label: "Chars · no spaces", get: (a) => a.charsNoSpaces },
  { label: "Avg word length", get: (a) => a.avgWordLen },
  { label: "Reading time", get: (a) => mins(a.readingMins) },
  { label: "Speaking time", get: (a) => mins(a.speakingMins) },
  { label: "Longest word", get: (a) => a.longestWord || "—" },
];

// ==== render ================================================================================
function render() {
  const view = $("view");
  view.textContent = "";
  const wrap = el("div", "work");

  // the input — one big textarea, the whole point of the tool
  const field = el("div", "field");
  const labelRow = el("div", "labelrow");
  labelRow.append(el("label", "flabel", "Your text"));
  const clear = el("button", "clearbtn", "Clear"); clear.title = "Empty the text";
  clear.onclick = () => { state.text = ""; saveSettings(); render(); $("wc-input").focus(); };
  labelRow.append(clear);
  field.append(labelRow);
  const ta = el("textarea", "wc-ta"); ta.id = "wc-input"; ta.spellcheck = true;
  ta.placeholder = "Type or paste your text here — the stats update as you go.";
  ta.value = state.text;
  ta.setAttribute("aria-label", "Text to analyse");
  // Debounced: recount without rebuilding the textarea (which would steal the caret mid-type).
  ta.addEventListener("input", () => { state.text = ta.value; saveSettings(); debouncedRefresh(); });
  field.append(ta);
  wrap.append(field);

  // the output card: the live stats grid + the top-words list
  const out = el("div", "outcard"); out.id = "wc-out";
  fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

/** Repaint only the results — keystrokes in the textarea must not rebuild (and blur) the input.
 *  Same discipline the contrast + QR wrapps needed. */
function refreshOut() { const o = $("wc-out"); if (o) fillOut(o); }

let debT = null;
function debouncedRefresh() { clearTimeout(debT); debT = setTimeout(refreshOut, 140); }

function fillOut(out) {
  out.textContent = "";
  const a = analyze(state.text);

  // Empty state — name it, don't show a wall of zeros with no explanation.
  if (a.words === 0) {
    out.append(el("div", "placeholder", "Nothing to count yet — start typing above and the words, "
      + "characters, reading time and most-used words will fill in here."));
    return;
  }

  // the stats grid (same .checks-style flush grid as contrast)
  const grid = el("div", "grid");
  for (const s of STATS) {
    const cell = el("div", "cell" + (s.big ? " big" : ""));
    cell.append(el("div", "val", String(s.get(a))));
    cell.append(el("div", "lbl", s.label));
    grid.append(cell);
  }
  out.append(grid);

  // the top-words list — the "what is this text mostly about" answer (stopwords already stripped)
  if (a.topWords.length) {
    const top = el("div", "topwords");
    top.append(el("div", "topcap", "Most-used words · common words excluded"));
    const list = el("div", "toplist");
    const max = a.topWords[0].count;   // scale the bars to the leader
    for (const w of a.topWords) {
      const row = el("div", "toprow");
      row.append(el("span", "tword", w.word));
      const bar = el("span", "tbar");
      const fill = el("span", "tfill"); fill.style.width = Math.round((w.count / max) * 100) + "%";
      bar.append(fill);
      row.append(bar);
      row.append(el("span", "tcount", String(w.count)));
      list.append(row);
    }
    top.append(list);
    out.append(top);
  }
}

function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}
render();

// ---- God's hand: analyse text headlessly, still ZERO model -----------------------------------------
exposeToGod({
  name: "count_words",
  description: "Analyse a block of text entirely on-device (no AI). Returns the word count, character "
    + "counts (with and without spaces), sentence and paragraph counts, estimated reading time (~200 wpm) "
    + "and speaking time (~130 wpm), the longest word, the average word length, and a top-N list of the "
    + "most-used words with common stopwords removed.",
  inputSchema: {
    text: "string — the text to analyse. Required.",
    topN: "number — how many most-used words to return. Optional, default 5.",
  },
  execute: async (input = {}) => {
    const text = String(input.text ?? "");
    const topN = Number(input.topN) > 0 ? Math.floor(Number(input.topN)) : 5;
    const a = analyze(text, { topN });
    // drive the visible UI so a watching God webview sees it
    state.text = text; saveSettings(); try { render(); } catch { /* headless */ }
    return a;
  },
});

// ---- The GLANCE: a `text` widget (docs/WIDGETS.md) — the size at a glance ---------------------------
// Accepts { text } the notch launcher hands over (falls back to the current UI text); counts on-device.
exposeWidget((input) => {
  const text = input && (input.text != null || input.input != null)
    ? String(input.text ?? input.input) : state.text;
  const a = analyze(text);
  if (a.words === 0) {
    return { kicker: "WORD COUNTER · ON YOUR DEVICE", title: "Count a block of text",
             openLabel: "Open Word Counter", shape: "text",
             result: { body: "Paste any text — I count words, characters, sentences and reading time on your device.", caption: "no AI · on your device" } };
  }
  const top = a.topWords[0] ? ` · top word "${a.topWords[0].word}"` : "";
  return {
    kicker: "WORD COUNTER · ON YOUR DEVICE",
    title: `${a.words} words · ${a.readingMins} min read`,
    openLabel: "Open Word Counter", shape: "text",
    result: {
      body: `${a.chars} characters · ${a.sentences} sentence${a.sentences === 1 ? "" : "s"} · ${a.paragraphs} paragraph${a.paragraphs === 1 ? "" : "s"}${top}`,
      caption: `${a.speakingMins} min to read aloud · no AI`,
    },
  };
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__wordcountTest = { analyze }; } catch { /* ignore */ }
