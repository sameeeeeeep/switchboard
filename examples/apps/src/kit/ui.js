// UI — the shared wrapp-kit decision atoms: option slates, the escape hatch, the steer row, and
// the one piece of state that keeps them honest (what the MACHINE drafted vs what the HUMAN chose).
//
// WHY THIS FILE EXISTS. The catalog did not fail thirty-four different ways; it failed four ways
// copy-pasted twenty-odd times. `optionCards()`/`steerRow()` are byte-identical across ~20 wrapps,
// the same `.opt.sel` accent CSS sits in ~22 shells, ~18 wrapps set `selectedId = recommended` at
// boot (so the brand accent lands on a card no human ever clicked), and the "none of these — say
// what you'd do instead" affordance exists in exactly one file (bank.js, as the vault bind-row's
// reveal → prefilled → act/escape grammar and the picker's "＋ new list…" tail). This module is the
// one copy, with the drafted-vs-chosen distinction made structural instead of aspirational.
//
// DEPENDENCY-FREE on purpose: no SDK, no build step, no framework. Import it from a wrapp
// (`import { optionCards, escapeHatch, steerRow, markDrafted, markChosen } from "./kit/ui.js";`)
// and it bundles with everything else; load it straight from a static server and it just runs.
//
// STYLING CONTRACT. It emits the class names the shells already style — `.opts .opt .opt.sel
// .check .rec .o-label .o-text .o-img .steer .chips .chip .box .send` — so adopting it changes no
// pixels a wrapp already gets right. It also injects one stylesheet, once, that does two things:
//   1. base styles wrapped in `:where(...)` — ZERO specificity, so a shell's own CSS always wins;
//      they only matter for shells (or a bare page) with no `.opt` rules at all.
//   2. the NEW modifier classes (`.k-draft`, `.k-esc`, …) at normal specificity, which is how a
//      drafted card gets a neutral badge even though the shell's `.opt .rec` paints it accent.
// Tokens are read as `var(--accent, var(--lime, #C8F250))` because the wrapp shells call the accent
// `--accent` and examples/apps/app.css calls it `--lime`.

// ---------- tiny local helpers (same el() every wrapp already defines) ----------
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const str = (s) => String(s ?? "").trim();

// Shared fallback for steerRow when a wrapp passes no chips of its own. Every wrapp SHOULD pass its
// own domain chips (see the STEER_CHIPS const each one already has); this is only a floor.
export const STEER_CHIPS = ["punchier", "simpler", "more specific", "different angle"];

// ---------- one-time stylesheet ----------
const STYLE_ID = "relay-kit-ui";
const ACCENT = "var(--accent, var(--lime, #C8F250))";
const ACCENT_SOFT = "var(--accent-soft, var(--lime-soft, #232B0D))";
const CSS = `
/* zero-specificity base: only applies where the shell styles nothing */
:where(.opts) { display: flex; flex-direction: column; gap: 8px; }
:where(.opt) { position: relative; border: 1px solid var(--edge, #262C38); background: var(--inset, #070809); border-radius: 14px; padding: 13px 14px; cursor: pointer; transition: border-color .15s, background .15s; }
:where(.opt:hover) { border-color: var(--edge-soft, #1C212B); }
:where(.opt.sel) { border-color: ${ACCENT}; background: color-mix(in srgb, ${ACCENT_SOFT} 55%, var(--inset, #070809)); }
:where(.opt .check) { position: absolute; right: 11px; top: 11px; width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--edge, #262C38); display: grid; place-items: center; color: transparent; font: 700 11px/1 var(--sans, sans-serif); }
:where(.opt.sel .check) { border-color: ${ACCENT}; background: ${ACCENT}; color: var(--page, #0A0C10); }
:where(.opt .rec) { display: inline-block; font: 500 9px/1 var(--mono, monospace); letter-spacing: .1em; text-transform: uppercase; border-radius: 999px; padding: 3px 7px; margin-bottom: 7px; }
:where(.opt .o-label) { font: 600 13.5px/1.3 var(--display, sans-serif); color: var(--ink, #E8EDF4); padding-right: 22px; }
:where(.opt .o-text) { font: 400 13px/1.5 var(--sans, sans-serif); color: var(--ink-sec, #B4BECE); margin-top: 5px; white-space: pre-wrap; word-break: break-word; }
:where(.opt .o-img) { width: 100%; border-radius: 8px; border: 1px solid var(--edge, #262C38); display: block; margin-top: 8px; }
:where(.steer) { margin-top: 16px; display: flex; flex-direction: column; gap: 7px; }
:where(.steer .chips) { display: flex; flex-wrap: wrap; gap: 6px; }
:where(.steer .chip) { font: 500 11px/1 var(--sans, sans-serif); border: 1px solid var(--edge, #262C38); background: var(--panel, #12151C); color: var(--ink-sec, #B4BECE); border-radius: 999px; padding: 6px 10px; cursor: pointer; }
:where(.steer .row) { display: flex; gap: 8px; align-items: center; }
:where(.steer .box) { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; border: 1px solid var(--edge, #262C38); background: var(--panel, #12151C); border-radius: 10px; padding: 8px 11px; }
:where(.steer input) { flex: 1; min-width: 0; background: none; border: 0; outline: none; color: var(--ink, #E8EDF4); font: 400 12.5px/1.4 var(--sans, sans-serif); }
:where(.steer .send) { flex: none; font: 600 12px/1 var(--sans, sans-serif); background: ${ACCENT}; color: var(--page, #0A0C10); border: 0; border-radius: 9px; padding: 9px 12px; cursor: pointer; }

/* ---- kit modifiers: normal specificity, these MUST beat the shell ---- */
/* DRAFTED — a machine suggestion. Neutral ink on a hairline, never the brand accent (rule 5). */
.opt .rec.k-draft { color: var(--ink-dim, #99A3B7); background: transparent; border: 1px dashed var(--edge, #262C38); }
.opt.k-drafted { border-style: dashed; }
.opt.k-drafted:not(.sel) { background: var(--inset, #070809); }
/* CHOSEN — a human clicked. The shell's own .opt.sel accent rules do the painting; this only adds
   the receipt line, so "who decided this" is never a guess (rule 6). */
.opt .k-by { display: block; font: 500 9px/1 var(--mono, monospace); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-faint, #6E7C90); margin-top: 8px; }
.opt.sel .k-by { color: ${ACCENT}; }
/* ESCAPE HATCH — the human's own answer. Reads as an option, never as one of the generated ones. */
.opt.k-esc { border-style: dashed; cursor: pointer; }
.opt.k-esc .o-label { color: var(--ink-sec, #B4BECE); }
.opt.k-esc .k-escrow { display: flex; gap: 8px; align-items: center; margin-top: 9px; }
.opt.k-esc .k-escrow input { flex: 1; min-width: 0; background: var(--inset, #070809); border: 1px solid var(--edge, #262C38); border-radius: 9px; color: var(--ink, #E8EDF4); font: 400 12.5px/1.4 var(--sans, sans-serif); padding: 9px 11px; outline: none; }
.opt.k-esc .k-escrow input:focus { border-color: color-mix(in srgb, ${ACCENT} 55%, var(--edge, #262C38)); }
.opt.k-esc .k-escrow .send { flex: none; font: 600 12px/1 var(--sans, sans-serif); background: ${ACCENT}; color: var(--page, #0A0C10); border: 0; border-radius: 9px; padding: 9px 12px; cursor: pointer; }
.opt.k-esc .k-escrow .send:disabled { opacity: .5; cursor: default; }
.opt.k-esc .k-escrow .ghost { flex: none; font: 500 12px/1 var(--sans, sans-serif); background: none; border: 1px solid var(--edge, #262C38); color: var(--ink-dim, #99A3B7); border-radius: 9px; padding: 9px 12px; cursor: pointer; }
`;

/** Inject the kit stylesheet once. Idempotent, safe before/after DOM ready, safe to call from any
 *  export (each one calls it), so a wrapp never has to remember. */
function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  (document.head || document.documentElement).append(s);
}

// =================================================================================================
// STATE — the drafted vs chosen distinction, made structural
// =================================================================================================
// DOCTRINE 5 (accent = a human chose) + DOCTRINE 6 (autonomous != opaque).
// The bug this replaces, present in ~18 wrapps:
//     r.selectedId = (r.options.find((o) => o.recommended) || r.options[0]).id;   // at boot
// which paints the brand accent on a card nobody clicked. Here a draft can only ever reach
// `draftedId`; `chosenId` is writable exclusively through markChosen(), which is only ever wired to
// a click handler. Nothing that isn't a human click can put a card into the accent state.

/** markDrafted — record what the model proposed. NEVER touches chosenId, so a redraft cannot
 *  silently steal a decision the human already made. `id` may be an id, an option object, or an
 *  option array (in which case the one with `recommended: true` wins, else the first).
 *  Rule 5: auto-generation may DRAFT but must never LOCK. */
export function markDrafted(sel, id) {
  const s = sel || {};
  s.draftedId = draftIdOf(id);
  s.draftedAt = Date.now();
  return s;
}

/** markChosen — the ONLY way a card becomes accent. Wire it to a click handler and nothing else;
 *  if you ever feel like calling it from a stream/boot/restore path, that is the bug.
 *  Stamps `chosenAt` so "who decided this, and when" is answerable (rule 6). */
export function markChosen(sel, id) {
  const s = sel || {};
  s.chosenId = idOf(id);
  s.chosenAt = Date.now();
  s.chosenBy = "human";
  return s;
}

/** clearChoice — a fresh generation invalidates the old pick; call this when the slate is replaced
 *  so a stale accent never survives onto a card that no longer means the same thing. */
export function clearChoice(sel) {
  const s = sel || {};
  s.chosenId = null; s.chosenAt = 0; s.chosenBy = null;
  return s;
}

/** isChosen / isDrafted — read-side predicates so call sites stop conflating the two. */
export const isChosen = (sel, o) => !!sel && sel.chosenId != null && sel.chosenId === idOf(o);
export const isDrafted = (sel, o) => !!sel && sel.draftedId != null && sel.draftedId === idOf(o);
/** chosenOption — the option the human actually locked, or null. Null is a real answer: it means
 *  "no decision yet", and downstream steps should stay disabled rather than guess (rule 7). */
export const chosenOption = (sel, options) =>
  (sel && sel.chosenId != null && (options || []).find((o) => idOf(o) === sel.chosenId)) || null;

const idOf = (o) => (o && typeof o === "object" ? o.id : o);
function draftIdOf(x) {
  if (Array.isArray(x)) { const r = x.find((o) => o && o.recommended); return idOf(r || x[0]); }
  return idOf(x);
}

// =================================================================================================
// OPTION CARDS
// =================================================================================================
/**
 * optionCards — a slate of 2–4 distinct options with exactly ONE drafted "recommended", plus an
 * optional escape hatch. Enforces DOCTRINE 4 (options + recommended + an escape hatch) and
 * DOCTRINE 5 (drafted is visually distinct from — and never wears the accent of — chosen).
 *
 * Two visual states, and they are not the same thing:
 *   DRAFTED  →  .opt.k-drafted + a neutral dashed "recommended" tag. The machine's suggestion.
 *   CHOSEN   →  .opt.sel (the shell's accent rules) + a "chosen by you" receipt. A human clicked.
 * A card only ever gets `.sel` from `chosenId`. There is no code path from `drafted` to `.sel`.
 *
 * Object form (preferred):
 *   optionCards({
 *     options,                       // [{ id, label, text?, imageUrl?, recommended? }]
 *     sel,                           // the markDrafted/markChosen state object
 *     onChoose(option),              // called on click — the caller does markChosen(sel, o)
 *     draftedId?, chosenId?,         // or pass the two ids directly instead of `sel`
 *     recommendedLabel = "recommended",
 *     chosenNote = "chosen by you",  // the receipt line on the locked card
 *     disabled?,                     // freeze the slate while a stream is in flight
 *     escape?,                       // {label?, placeholder?, hint?, onSubmit(text)} → appends escapeHatch()
 *     decorate?(card, option),       // per-card extras (a real artifact link, a preview, …) — rule 3
 *   }) → HTMLElement
 *
 * Legacy positional form, byte-compatible with the ~20 existing copies so adoption is mechanical:
 *   optionCards(options, selectedId, onPick, extraOptions?)
 * NOTE: the legacy `selectedId` maps to `chosenId` (accent). That is correct ONLY if the wrapp
 * stopped seeding it at boot — the second half of the fix, done per-wrapp at the call site.
 */
export function optionCards(a, b, c, d) {
  ensureStyle();
  const o = Array.isArray(a)
    ? { options: a, chosenId: b, onChoose: c, ...(d || {}) }
    : (a || {});
  const options = o.options || [];
  const sel = o.sel || null;
  const chosenId = o.chosenId !== undefined ? o.chosenId : (sel ? sel.chosenId : null);
  // Only auto-derive the drafted id from `recommended` when the caller gave us nothing — a wrapp
  // that tracks its own draft stays in charge.
  const draftedId = o.draftedId !== undefined ? o.draftedId
    : (sel && sel.draftedId !== undefined) ? sel.draftedId
    : draftIdOf(options);
  const onChoose = o.onChoose || o.onPick || (() => {});
  const recLabel = o.recommendedLabel || "recommended";
  const chosenNote = o.chosenNote === undefined ? "chosen by you" : o.chosenNote;

  const wrap = el("div", "opts");
  wrap.setAttribute("role", "radiogroup");
  for (const opt of options) {
    const locked = chosenId != null && opt.id === chosenId;
    const drafted = !locked && draftedId != null && opt.id === draftedId;
    const card = el("div", "opt" + (locked ? " sel" : "") + (drafted ? " k-drafted" : ""));
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", locked ? "true" : "false");
    card.tabIndex = o.disabled ? -1 : 0;
    const pick = () => { if (!o.disabled) onChoose(opt); };
    card.onclick = pick;                                   // the ONLY route to the accent state
    card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
    if (o.disabled) card.style.opacity = ".55";

    card.append(el("div", "check", "✓"));
    // The drafted tag says "the machine suggests"; it is deliberately NOT accent-coloured.
    if (drafted || (locked && draftedId === opt.id)) card.append(el("div", "rec k-draft", recLabel));
    else if (opt.recommended && draftedId == null) card.append(el("div", "rec k-draft", recLabel));
    card.append(el("div", "o-label", opt.label));
    if (opt.text) card.append(el("div", "o-text", opt.text));
    if (opt.imageUrl) { const img = el("img", "o-img"); img.src = opt.imageUrl; img.alt = opt.label || ""; card.append(img); }
    if (typeof o.decorate === "function") o.decorate(card, opt);
    if (locked && chosenNote) card.append(el("span", "k-by", chosenNote));
    wrap.append(card);
  }
  if (o.escape) wrap.append(escapeHatch(o.escape));
  return wrap;
}

// =================================================================================================
// ESCAPE HATCH
// =================================================================================================
/**
 * escapeHatch — "none of these — say what you'd do instead". DOCTRINE 4's other half: a slate of
 * generated options is a menu, and a menu without an exit is a cage. Generalised from bank.js,
 * which is the only place in the catalog that got this right: the vault bind-row's
 * reveal → prefilled → act/escape grammar (Enter commits, Escape collapses, an inline row rather
 * than a `prompt()`), plus the list picker's "＋ new list…" tail that keeps the human able to name
 * something the machine never offered.
 *
 *   escapeHatch({
 *     label       = "none of these — say what you'd do instead",
 *     placeholder = "describe what you'd do instead…",
 *     prefill?,                 // seed the box (bank.js prefills the default path)
 *     hint?,                    // one quiet line under the label
 *     sendLabel   = "use this",
 *     onSubmit(text, option),   // option = {id:"custom", label:text, text, custom:true} — hand it
 *                               // straight to your generation prompt, or into markChosen(sel, option)
 *   }) → HTMLElement            // also .open() / .close() / .value() for the caller
 *
 * onSubmit may return a promise; the row shows "…" and stays open until it settles, so a failed
 * round-trip never silently eats what the human typed (rule 6).
 */
export function escapeHatch(opts) {
  ensureStyle();
  const o = opts || {};
  const label = o.label || "none of these — say what you'd do instead";
  const card = el("div", "opt k-esc");
  card.append(el("div", "o-label", label));
  if (o.hint) card.append(el("div", "o-text", o.hint));

  const row = el("div", "k-escrow");
  row.hidden = true;
  const input = el("input");
  input.type = "text";
  input.placeholder = o.placeholder || "describe what you'd do instead…";
  if (o.prefill) input.value = o.prefill;
  const send = el("button", "send", o.sendLabel || "use this");
  send.type = "button";
  const cancel = el("button", "ghost", "cancel");
  cancel.type = "button";
  row.append(input, send, cancel);
  card.append(row);

  const open = () => {
    if (!row.hidden) return;
    row.hidden = false;
    input.focus();
    input.select();
  };
  const close = () => { row.hidden = true; };

  // The card itself is the reveal; once open, clicks inside must not re-trigger or collapse it.
  card.onclick = (e) => { if (e.target.closest(".k-escrow")) return; open(); };
  card.onkeydown = (e) => {
    if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); }
  };
  card.tabIndex = 0;

  let busy = false;
  const submit = () => {
    const text = str(input.value);
    if (!text || busy) return;
    const option = { id: "custom", label: text, text: "", custom: true };
    const out = typeof o.onSubmit === "function" ? o.onSubmit(text, option) : null;
    if (out && typeof out.then === "function") {
      busy = true;
      const was = send.textContent;
      send.disabled = true; send.textContent = "…";
      out.finally(() => { busy = false; send.disabled = false; send.textContent = was; close(); });
    } else {
      close();
    }
  };
  send.onclick = submit;
  cancel.onclick = close;
  input.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  card.open = open;
  card.close = close;
  card.value = () => str(input.value);
  return card;
}

// =================================================================================================
// STEER ROW
// =================================================================================================
/**
 * steerRow — the shared "not quite? steer it" lever: a few one-tap chips plus a free-text box.
 * DOCTRINE 6 (autonomous != opaque) and DOCTRINE 1 (at-a-glance): the correction affordance sits
 * next to the result, not behind a settings pane, so nobody has to start over to nudge something.
 *
 * Legacy positional form, identical to the ~20 copies:  steerRow(onSteer, chips)
 * Object form:  steerRow({ onSteer, chips, kicker, placeholder, sendLabel, disabled })
 * `onSteer(text)` receives either the chip text or whatever was typed; the box clears on send.
 */
export function steerRow(a, b) {
  ensureStyle();
  const o = typeof a === "function" ? { onSteer: a, chips: b } : (a || {});
  const onSteer = o.onSteer || (() => {});
  const wrap = el("div", "steer");
  wrap.append(el("span", "kicker", o.kicker || "not quite? steer it"));

  const chipRow = el("div", "chips");
  for (const s of (o.chips || STEER_CHIPS)) {
    const c = el("button", "chip", s);
    c.type = "button";
    c.disabled = !!o.disabled;
    c.onclick = () => onSteer(s);
    chipRow.append(c);
  }
  wrap.append(chipRow);

  const row = el("div", "row");
  const box = el("div", "box");
  const input = el("input");
  input.type = "text";
  input.placeholder = o.placeholder || "tell it what to change…";
  input.disabled = !!o.disabled;
  const send = () => { const t = str(input.value); if (!t) return; input.value = ""; onSteer(t); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  box.append(input);
  const btn = el("button", "send", o.sendLabel || "send");
  btn.type = "button";
  btn.disabled = !!o.disabled;
  btn.onclick = send;
  row.append(box, btn);
  wrap.append(row);
  return wrap;
}

// =================================================================================================
/** researching — the shared "working…" status line. Rule 7 (honest empty states): a slate that is
 *  still being drafted says so, instead of rendering a fake or half-filled one. */
export function researching(status) {
  ensureStyle();
  const r = el("div", "researching");
  r.append(el("div", "scan"), el("span", null, status || "working…"));
  return r;
}
