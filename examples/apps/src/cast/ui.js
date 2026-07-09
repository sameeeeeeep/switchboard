// The shared render kit — the small set of components every stage is built from, so the whole
// pipeline looks like one thing. The centrepiece is optionCard(): a single component that renders
// ANY generated choice (a person, a voice, an aesthetic, a pillar) by showing only the fields that
// are present — brandbrain's OptionCardView. The stepper and gate bar give the pipeline its spine:
// you always know which stage you're on, what unlocks the next, and you can't jump a gate.
import { STAGES, STAGE_IDS, stageIndex } from "./spec.js";
import { stageReady, reachableStage, progress } from "./state.js";

export const $ = (id) => document.getElementById(id);
export const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
export const clear = (node) => { if (node) node.textContent = ""; return node; };

// ---------- OptionCard: one component, every facet ----------
// opts: { selected, onPick, pickLabel, dim }. Renders title/subtitle/body/bullets/chips/palette/meta,
// each only if present. A recommended card gets the coral ring + badge; a selected card gets the
// locked treatment.
export function optionCard(card, opts = {}) {
  const c = el("button", "opt" + (card.recommended ? " rec" : "") + (opts.selected ? " sel" : ""));
  if (card.recommended && !opts.selected) c.append(el("span", "rb", "RECOMMENDED"));
  if (opts.selected) c.append(el("span", "rb sel", "LOCKED ✓"));
  c.append(el("div", "nm", card.title));
  if (card.subtitle) c.append(el("div", "ni", card.subtitle));
  if (card.body) c.append(el("div", "an", card.body));
  if (card.bullets?.length) { const ul = el("ul", "bul"); for (const b of card.bullets) ul.append(el("li", null, b)); c.append(ul); }
  if (card.palette?.length) { const p = el("div", "pal"); for (const s of card.palette) { const sw = el("span", "sw"); sw.style.background = s.hex; sw.title = s.name || s.hex; p.append(sw); } c.append(p); }
  if (card.chips?.length) { const row = el("div", "ochips"); for (const ch of card.chips) row.append(el("span", "oc", ch)); c.append(row); }
  if (card.meta?.length) { const m = el("div", "ometa"); for (const kv of card.meta) { const r = el("span"); r.append(el("b", null, kv.label + " "), document.createTextNode(kv.value)); m.append(r); } c.append(m); }
  c.append(el("div", "use", opts.selected ? "Locked" : (opts.pickLabel || "Lock this →")));
  if (opts.onPick) c.onclick = () => opts.onPick(card);
  return c;
}

// A grid of option cards for a facet, with a loading/empty state.
export function optionGrid(cards, opts = {}) {
  const box = el("div", "opts");
  if (!cards?.length) { box.append(el("div", "empty-note", opts.empty || "No options yet.")); return box; }
  for (const card of cards) box.append(optionCard(card, { ...opts, selected: opts.isSelected?.(card) }));
  return box;
}

// ---------- the steer input: brandbrain's "never a blank box" ----------
export function steer({ placeholder, value = "", cta = "Generate", onSubmit, chips = [], onChip }) {
  const wrap = el("div", "steerblock");
  const row = el("div", "steerrow");
  row.append(el("span", "spark", "✨"));
  const input = Object.assign(el("input"), { type: "text", placeholder, value });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") onSubmit(input.value.trim()); });
  const btn = el("button", "genbtn", cta);
  btn.onclick = () => onSubmit(input.value.trim());
  row.append(input, btn);
  wrap.append(row);
  if (chips.length) { const cr = el("div", "chips"); for (const ch of chips) { const b = el("button", "chip"); b.append(el("span", "s", "✨"), document.createTextNode(ch)); b.onclick = () => { input.value = ch; onChip ? onChip(ch) : onSubmit(ch); }; cr.append(b); } wrap.append(cr); }
  wrap._input = input; wrap._btn = btn;
  return wrap;
}

// ---------- the stepper: the pipeline's spine ----------
// Renders the six stages as a clickable rail with a progress line. A stage is reachable only if every
// earlier gate is met; unreachable stages are shown locked. onGo(stageId) navigates.
export function renderStepper(box, account, onGo) {
  clear(box);
  const reach = reachableStage(account);
  const reachIdx = stageIndex(reach);
  const line = el("div", "steps");
  STAGES.forEach((s, i) => {
    const done = stageReady(account, s.id);
    const reachable = i <= reachIdx;
    const on = account.stage === s.id;
    const step = el("button", "step" + (on ? " on" : "") + (done ? " done" : "") + (reachable ? "" : " lock"));
    const dot = el("span", "sdot", done ? "✓" : String(i + 1));
    const tx = el("span", "stx");
    tx.append(el("span", "sn", s.title), el("span", "sk", s.kicker));
    step.append(dot, tx);
    if (reachable) step.onclick = () => onGo(s.id);
    line.append(step);
    if (i < STAGES.length - 1) { const c = el("span", "sconn" + (done ? " done" : "")); line.append(c); }
  });
  box.append(line);
  const bar = el("div", "pbar"); const fill = el("i"); fill.style.width = Math.round(progress(account) * 100) + "%"; bar.append(fill); box.append(bar);
}

// ---------- the gate bar: what unlocks the next stage ----------
// Sits at the bottom of every stage. Shows the advance condition and a Continue button that is
// disabled until the gate is met; pressing it moves to the next stage.
export function gateBar(account, stageId, onContinue) {
  const stage = STAGES.find((s) => s.id === stageId);
  const idx = stageIndex(stageId);
  const next = STAGES[idx + 1];
  const ready = stageReady(account, stageId);
  const bar = el("div", "gate" + (ready ? " ready" : ""));
  const msg = el("div", "gmsg");
  msg.append(el("span", "gk", ready ? "Gate cleared" : "To continue"), document.createTextNode(ready ? (next ? `Ready for ${next.title}` : "Pipeline complete") : advanceHint(stage)));
  bar.append(msg);
  if (next) {
    const btn = el("button", "primary", `Continue to ${next.title} →`);
    btn.disabled = !ready;
    btn.onclick = () => onContinue(next.id);
    bar.append(btn);
  } else if (ready) {
    bar.append(el("span", "saved show", "Account live ✓"));
  }
  return bar;
}
function advanceHint(stage) {
  return { "brief locked": "Give Cast one thing — a line, an account, or a photo.", "all facets locked": "Lock a choice for every facet.", "face + setting approved": "Approve the face and the setting.", "≥1 slot approved": "Approve at least one calendar slot.", "≥1 script approved": "Approve at least one script.", "done": "" }[stage.advance] || stage.advance;
}

// A stage header: eyebrow kicker + title + blurb.
export function stageHead(stageId) {
  const stage = STAGES.find((s) => s.id === stageId);
  const head = el("div", "stagehead");
  head.append(el("span", "eyebrow", stage.kicker), el("h2", null, stage.title), el("p", "lead", stage.blurb));
  return head;
}

// A small spinner card used while a facet/asset generates.
export function loadingCard(label) {
  const c = el("div", "opt load"); c.append(el("div", "scan"), el("div", "an", label || "thinking…")); return c;
}
