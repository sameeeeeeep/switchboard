/**
 * The consent UI, in brandbrain's design language. Rendered inline in the side panel (primary) and
 * in a fallback window when the panel is closed — one shared renderer so they can't drift.
 *
 * Two kinds: connect (approve/narrow a site's requested scope, with select-all) and write (approve
 * one per-action tool call). Tool access badges come from the daemon's out-of-band classification;
 * this view only displays them.
 *
 * Density doctrine: a 40-tool request must never render as a wall. Tools group by CONNECTOR — one
 * collapsed row each with an icon, counts and a tri-state checkbox — and a plain-language scope
 * digest ("can see / can do") carries the meaning, so the decision reads in one screen and the
 * Approve/Deny footer stays pinned regardless of length.
 */

import { connectorOf, connectorGlyph, brandIcon, VERBS, KIND_MARKS, normalize, type ConnectorInfo } from "./icons.js";

type Access = "read" | "write";
interface ConnectBody {
  origin: string;
  reason?: string;
  models: { available: string[]; requested: string[] };
  tools: Array<{ name: string; access: Access; label: string }>;
  budgets: { maxTokensPerDay: number; maxCallsPerMin: number };
  /** Library kinds the app asks to SEE (names only; data reads stay per-item + audited). */
  contextKinds?: string[];
}
interface WriteBody { origin: string; tool: { name: string; arguments: Record<string, unknown> }; }
interface StorageBindBody { origin: string; path: string; }
interface StoragePickBody { origin: string; reason?: string; }
interface ContextMetaRow { id: string; name: string; kind?: string; source?: string }
interface ContextPickBody { origin: string; contexts: ContextMetaRow[] }
export interface Prompt { kind: "consent:connect" | "consent:write" | "consent:storage-bind" | "consent:storage-pick" | "consent:context-pick"; body: unknown; }

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const host = (o: string) => { try { return new URL(o.includes("://") ? o : `https://${o}`).host; } catch { return o; } };
const shortTool = (name: string) => name.includes("__") ? name.split("__").pop()!.replace(/[-_*]/g, " ").trim() : name;
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

// Brandbrain tokens + consent styles, injected once. The host page loads the fonts.
const STYLE_ID = "relay-consent-style";
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = el("style");
  s.id = STYLE_ID;
  s.textContent = `
    .rc { --lime:#C8F250; --lime-soft:#232B0D; --danger:#FF2D6E; --ok:#3DD68C;
      font: 13px/1.5 "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif; color: var(--ink,#E8EDF4); }
    .rc .kick { font: 500 10px/1 "Spline Sans Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: .16em; color: var(--ink-dim,#99A3B7); }
    .rc h2 { font: 600 17px/1.25 "Bricolage Grotesque", system-ui, sans-serif; letter-spacing: -0.02em; margin: 6px 0 2px; }
    .rc h2 .o { color: var(--lime); }
    .rc .reason { font-style: italic; color: var(--ink-dim,#99A3B7); margin: 2px 0 4px; }
    /* the app's stated reason — the single most load-bearing line before approving */
    .rc .reason.quote { font: italic 500 13px/1.5 "Hanken Grotesk", sans-serif; color: var(--ink-sec,#B4BECE);
      margin: 8px 0 2px; padding-left: 10px; border-left: 2px solid var(--lime-line,#3A4A18); }
    /* brand chips: curated glyph first, the locally-cached favicon fades in over it */
    .rc .favimg { position: absolute; inset: 0; margin: auto; width: 16px; height: 16px; border-radius: 4px; opacity: 0; transition: opacity .15s; }
    .rc .haslogo > .gl { visibility: hidden; }
    .rc .oicon { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--raised-2,#20262F);
      color: var(--ink-dim,#99A3B7); font: 700 11px/1 "Bricolage Grotesque", system-ui, sans-serif; vertical-align: -3px; margin-right: 7px; }
    .rc .oicon svg { width: 12px; height: 12px; display: block; }
    .rc .ichip { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 5px; vertical-align: -3px;
      font: 700 9px/1 "Bricolage Grotesque", system-ui, sans-serif; color: #0A0C10; margin: 0 1px; }
    .rc .ichip svg { width: 10px; height: 10px; display: block; }
    /* plain-language scope digest: what the app can SEE vs DO */
    .rc .scope { margin-top: 14px; background: var(--panel,#12151C); border: 1px solid var(--edge-soft,#1C212B); border-radius: 12px;
      padding: 11px 12px; display: flex; flex-direction: column; gap: 9px; }
    .rc .scope .srow { display: flex; gap: 10px; align-items: baseline; }
    .rc .scope .kick { flex: 0 0 58px; white-space: nowrap; }
    .rc .scope .s { font-size: 12.5px; color: var(--ink-sec,#B4BECE); line-height: 1.45; min-width: 0;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .rc .sec { margin-top: 13px; }
    .rc .sechead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
    /* THE selection primitive — a real filled box with a check, not a native tick. One control used
       everywhere (big on cards, .sm on tools, 15px in model pills), so "selected" reads identically.
       Native checkbox kept for semantics + :indeterminate (partial connector). */
    .rc input.box { appearance: none; -webkit-appearance: none; margin: 0; flex: none; cursor: pointer; position: relative;
      width: 22px; height: 22px; border-radius: 7px; border: 1.5px solid var(--edge,#2C3444); background: var(--inset,#070809); transition: background .12s, border-color .12s; }
    .rc input.box.sm { width: 19px; height: 19px; border-radius: 6px; }
    .rc input.box:checked { background: var(--lime); border-color: var(--lime); }
    .rc input.box:checked::after { content: ""; position: absolute; inset: 0; background-repeat: no-repeat; background-position: center; background-size: 12px;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230A0C10' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'><path d='M5 13l4 4L19 7'/></svg>"); }
    .rc input.box.sm:checked::after { background-size: 10px; }
    .rc input.box:indeterminate { border-color: var(--lime); background: color-mix(in srgb, var(--lime) 15%, transparent); }
    .rc input.box:indeterminate::after { content: ""; position: absolute; left: 5px; right: 5px; top: calc(50% - 1px); height: 2px; border-radius: 1px; background: var(--lime); }
    .rc label.item input:not(.box) { accent-color: var(--lime); width: 16px; height: 16px; flex: none; }
    .rc .summ { font: 500 10px/1 "Spline Sans Mono", ui-monospace, monospace; color: var(--ink-faint,#6E7C90); margin-left: auto; white-space: nowrap; }
    .rc .allnone { font: 500 11px/1 "Hanken Grotesk", sans-serif; color: var(--lime); background: none; border: 0; cursor: pointer; padding: 2px 4px; white-space: nowrap; }
    /* models — pill chips sharing the box primitive (15px), so a selected model reads like a selected tool */
    .rc .mchips { display: flex; flex-wrap: wrap; gap: 7px; }
    .rc .mchip { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px 7px 8px; border-radius: 10px; cursor: pointer; user-select: none;
      border: 1px solid var(--edge,#262C38); background: var(--panel,#12151C); color: var(--ink-dim,#99A3B7);
      font: 500 12.5px/1 "Hanken Grotesk", sans-serif; transition: border-color .12s, color .12s, background .12s; }
    .rc .mchip .box { width: 15px; height: 15px; border-radius: 5px; }
    .rc .mchip .box:checked::after { background-size: 9px; }
    .rc .mchip:has(:checked) { border-color: var(--lime); color: var(--ink,#E8EDF4); background: var(--lime-soft,#232B0D); }
    .rc label.item { display: flex; align-items: center; gap: 10px; padding: 5px 0; cursor: pointer; }
    .rc .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
    .rc .name.wrap { white-space: normal; overflow: visible; }
    .rc .badge { font: 500 10px/1 "Spline Sans Mono", monospace; padding: 3px 7px; border-radius: 999px; flex: none; }
    .rc .badge.read { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
    .rc .badge.write { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
    /* TOOLS — one bordered CARD per connector: the header grants/expands the whole connector, tapping
       opens its individual tools INSIDE the same box. 40 tools become a handful of tidy cards. */
    .rc .conncard { border: 1px solid var(--edge,#262C38); background: var(--panel,#12151C); border-radius: 12px; margin-bottom: 8px; overflow: hidden; }
    .rc .conncard.open { border-color: var(--edge-strong,#38414F); }
    .rc .cc-head { display: flex; align-items: center; gap: 11px; padding: 11px 12px; cursor: pointer; }
    .rc .cc-ic { width: 26px; height: 26px; border-radius: 8px; flex: none; display: grid; place-items: center;
      font: 700 12px/1 "Bricolage Grotesque", system-ui, sans-serif; color: #0A0C10; }
    .rc .cc-ic svg { width: 15px; height: 15px; display: block; }
    .rc .cc-meta { min-width: 0; margin-right: auto; }
    .rc .cc-name { font: 600 13.5px/1.2 "Hanken Grotesk", sans-serif; color: var(--ink,#E8EDF4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rc .cc-sub { font: 500 10px/1 "Spline Sans Mono", monospace; color: var(--ink-faint,#6E7C90); margin-top: 4px; }
    .rc .cc-sub .w { color: var(--danger); }
    .rc .cc-chev { color: var(--ink-faint,#6E7C90); font-size: 11px; transition: transform .15s; flex: none; }
    .rc .conncard.open .cc-chev { transform: rotate(90deg); }
    .rc .cc-kids { display: none; flex-direction: column; padding: 3px 12px 8px; border-top: 1px solid var(--edge-soft,#1C212B); }
    .rc .conncard.open .cc-kids { display: flex; }
    .rc .morelink { display: block; background: none; border: 0; padding: 7px 0 2px; font: 600 11.5px/1 "Hanken Grotesk", sans-serif; color: var(--ink-faint,#6E7C90); cursor: pointer; }
    .rc .morelink:hover { color: var(--ink,#E8EDF4); }
    .rc .cmark { width: 22px; height: 22px; border-radius: 7px; flex: none; display: grid; place-items: center; background: var(--raised-2,#20262F); color: var(--ink-dim,#99A3B7); }
    .rc .cmark svg { width: 13px; height: 13px; display: block; }
    .rc .cmark.brand { background: var(--lime); color: #0A0C10; font: 700 11px/1 "Bricolage Grotesque", system-ui, sans-serif; }
    .rc .budget { display: flex; gap: 8px; }
    .rc .budget label { flex: 1; font-size: 11px; color: var(--ink-dim,#99A3B7); }
    .rc .budget input { width: 100%; margin-top: 4px; font: 400 12px/1 "Spline Sans Mono", monospace; color: inherit; font-variant-numeric: tabular-nums;
      background: var(--inset,#070809); border: 1px solid var(--edge,#262C38); border-radius: 8px; padding: 8px; outline: none; }
    .rc .args { font-family: "Spline Sans Mono", monospace; font-size: 11.5px; white-space: pre-wrap; word-break: break-word;
      background: var(--raised,#1A1F29); border-radius: 10px; padding: 10px; max-height: 180px; overflow: auto; color: var(--ink-sec,#B4BECE); }
    .rc .warn { color: var(--danger); font-weight: 600; }
    /* the decision never scrolls away: pinned, hairline, softly frosted */
    .rc .actions { display: flex; gap: 8px; margin-top: 18px; position: sticky; bottom: 0; padding: 10px 0 12px;
      border-top: 1px solid var(--edge,#262C38); background: color-mix(in srgb, var(--page,#0A0C10) 92%, transparent); backdrop-filter: blur(8px); }
    .rc .actions button { font: 600 13px/1 "Hanken Grotesk", sans-serif; border-radius: 10px; padding: 11px; cursor: pointer; border: 1px solid transparent; }
    .rc .approve { flex: 1; background: var(--lime); color: #0A0C10; }
    .rc .approve:hover { opacity: .9; }
    .rc .deny { flex: 0 0 32%; background: transparent; color: var(--ink-dim,#99A3B7); border-color: var(--edge,#262C38); }
    .rc .empty { color: var(--ink-faint,#6E7C90); font-size: 12.5px; padding: 6px 0; }
  `;
  document.head.appendChild(s);
}

export type Decision = null | false | { models: string[]; tools: Array<{ name: string; access: Access }>; budgets?: { maxTokensPerDay: number; maxCallsPerMin: number }; contextKinds?: string[] };

/** Render a consent prompt into `root`; call `onDecision` with the result. */
export function renderConsent(root: HTMLElement, prompt: Prompt, onDecision: (d: Decision) => void) {
  ensureStyles();
  root.textContent = "";
  const rc = el("div", "rc");
  root.appendChild(rc);
  if (prompt.kind === "consent:connect") renderConnect(rc, prompt.body as ConnectBody, onDecision);
  else if (prompt.kind === "consent:storage-bind") renderStorageBind(rc, prompt.body as StorageBindBody, onDecision);
  else if (prompt.kind === "consent:storage-pick") renderStoragePick(rc, prompt.body as StoragePickBody, onDecision);
  else if (prompt.kind === "consent:context-pick") renderContextPick(rc, prompt.body as ContextPickBody, onDecision);
  else renderWrite(rc, prompt.body as WriteBody, onDecision);
}

function section(rc: HTMLElement, title: string, allNone?: () => void, summary?: string): HTMLElement {
  const sec = el("div", "sec");
  const head = el("div", "sechead");
  head.append(el("span", "kick", title));
  if (summary) head.append(el("span", "summ", summary));
  if (allNone) { const b = el("button", "allnone", "All / none"); b.onclick = allNone; head.append(b); }
  sec.append(head);
  rc.append(sec);
  return sec;
}

/** The origin's favicon chip for an identity line (glyph fallback outside the extension). */
function originIcon(origin: string): HTMLElement {
  return brandIcon({ className: "oicon", pageUrl: origin, letter: host(origin)[0] ?? "•" });
}

function renderConnect(rc: HTMLElement, body: ConnectBody, onDecision: (d: Decision) => void) {
  rc.append(el("div", "kick", "Connection request"));
  const h = el("h2");
  h.append(originIcon(body.origin), document.createTextNode("Connect to "), Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode("?"));
  rc.append(h);
  if (body.reason) rc.append(el("div", "reason quote", `“${body.reason}”`));

  // ---- group the requested tools by connector (unknown servers fold into "Other") ----
  const groups = new Map<string, { conn: ConnectorInfo; tools: ConnectBody["tools"] }>();
  for (const t of body.tools) {
    const c = connectorOf(t.name) ?? { key: "other", label: "Other", color: "#6E7C90", hint: "" };
    const g = groups.get(c.key) ?? { conn: c, tools: [] };
    g.tools.push(t);
    groups.set(c.key, g);
  }
  const kinds = (body.contextKinds ?? []).filter(Boolean);

  // ---- scope digest: the plain-language line a non-technical user actually reads ----
  const sees: string[] = [];
  const does: string[] = [];
  for (const g of groups.values()) {
    const v = VERBS[normalize(g.conn.key)];
    const gw = g.tools.filter((t) => t.access === "write").length;
    const gr = g.tools.length - gw;
    if (gr) sees.push(v?.see ?? `${g.conn.label} (${gr} read tool${gr === 1 ? "" : "s"})`);
    if (gw) does.push(v?.do ?? `${g.conn.label} (${gw} write tool${gw === 1 ? "" : "s"})`);
  }
  if (kinds.length) sees.push(`the names of your ${kinds.join(" & ")}`);
  if (sees.length || does.length) {
    const scope = el("div", "scope");
    const srow = (k: string, parts: string[]) => { const r = el("div", "srow"); r.append(el("span", "kick", k), el("span", "s", cap(parts.join(" · ")))); return r; };
    if (sees.length) scope.append(srow("Can see", sees));
    if (does.length) scope.append(srow("Can do", does));
    rc.append(scope);
  }

  // ---- Models — compact toggle chips (default = the requested set, else the first available).
  // Chips wrap, so even 6 models stay ~2 rows and need no fold; the daemon runs the user's pick. ----
  const wantModels = new Set(body.models.requested.length ? body.models.requested : body.models.available.slice(0, 1));
  const modelBoxes: Array<[string, HTMLInputElement]> = [];
  const mSec = section(rc, "Models", () => toggleAll(modelBoxes.map(([, c]) => c)));
  const mchips = el("div", "mchips");
  for (const m of body.models.available) {
    const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.className = "box"; cb.checked = wantModels.has(m);
    modelBoxes.push([m, cb]);
    const chip = el("label", "mchip"); chip.append(cb, el("span", undefined, m));
    mchips.append(chip);
  }
  mSec.append(mchips);

  // ---- Tools — grouped, collapsed by default; the live Approve label mirrors the selection ----
  const toolBoxes: Array<[{ name: string; access: Access }, HTMLInputElement]> = [];
  const groupSyncs: Array<() => void> = [];
  let approveBtn: HTMLElement | null = null;
  const updateApprove = () => {
    if (!approveBtn) return;
    const n = toolBoxes.filter(([, c]) => c.checked).length;
    approveBtn.textContent = n ? `Approve · ${n} tool${n === 1 ? "" : "s"}` : "Approve · completions only";
  };
  const writes = body.tools.filter((t) => t.access === "write").length;
  const tSec = section(
    rc, "Tools",
    () => { toggleAll(toolBoxes.map(([, c]) => c)); groupSyncs.forEach((f) => f()); },
    body.tools.length ? `${body.tools.length} requested · ${writes} write` : undefined,
  );
  if (!body.tools.length) tSec.append(el("div", "empty", "No tools requested — completions only."));
  for (const g of groups.values()) {
    const card = el("div", "conncard");
    const head = el("div", "cc-head");
    const kids = el("div", "cc-kids");
    const gw = g.tools.filter((t) => t.access === "write").length;
    const gr = g.tools.length - gw;
    const gcb = el("input") as HTMLInputElement; gcb.type = "checkbox"; gcb.className = "box";
    const meta = el("div", "cc-meta");
    const sub = el("div", "cc-sub");
    sub.append(document.createTextNode(`${g.tools.length} tool${g.tools.length === 1 ? "" : "s"}`));
    if (gr && gw) sub.append(document.createTextNode(` · ${gr} read · `), Object.assign(el("span", "w"), { textContent: `${gw} write` }));
    else if (gw) sub.append(document.createTextNode(" · "), Object.assign(el("span", "w"), { textContent: "write" }));
    else sub.append(document.createTextNode(" · read"));
    meta.append(el("div", "cc-name", g.conn.label), sub);
    head.append(connectorGlyph(g.conn, "cc-ic"), meta, gcb, el("span", "cc-chev", "▸"));
    const kidBoxes: HTMLInputElement[] = [];
    for (const t of g.tools) {
      const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.className = "box sm"; cb.checked = true;
      toolBoxes.push([{ name: t.name, access: t.access }, cb]);
      kidBoxes.push(cb);
      const label = el("label", "item");
      label.append(cb, el("span", "name", shortTool(t.label || t.name)), el("span", `badge ${t.access}`, t.access));
      kids.append(label);
      cb.onchange = sync;
    }
    function sync() {
      const on = kidBoxes.filter((c) => c.checked).length;
      gcb.checked = on === kidBoxes.length;
      gcb.indeterminate = on > 0 && on < kidBoxes.length;
      updateApprove();
    }
    groupSyncs.push(sync);
    gcb.onclick = (e) => e.stopPropagation(); // toggling the connector doesn't also expand the card
    gcb.onchange = () => { kidBoxes.forEach((c) => (c.checked = gcb.checked)); gcb.indeterminate = false; updateApprove(); };
    head.onclick = () => card.classList.toggle("open");
    sync();
    card.append(head, kids);
    tSec.append(card);
  }

  // Context library visibility — one row, uncheckable, read-tinted. Approving lets the app LIST
  // names of these kinds from your library; each actual read is one context at a time, audited.
  let kindsBox: HTMLInputElement | null = null;
  if (kinds.length) {
    const cSec = section(rc, "Your library");
    const box = el("div", "scope");
    const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.className = "box"; cb.checked = true;
    kindsBox = cb;
    const label = el("label", "item");
    label.append(cb, el("span", "name wrap", `See the names of your ${kinds.join(" & ")} (each read is one item, audited)`), el("span", "badge read", "read"));
    box.append(label);
    cSec.append(box);
  }

  // Budget
  const bSec = section(rc, "Budget");
  const tok = numInput(body.budgets.maxTokensPerDay);
  const calls = numInput(body.budgets.maxCallsPerMin);
  const grid = el("div", "budget");
  grid.append(wrapLabel("Max tokens / day", tok), wrapLabel("Max calls / min", calls));
  bSec.append(grid);

  const actions = el("div", "actions");
  const deny = el("button", "deny", "Deny"); deny.onclick = () => onDecision(null);
  const approve = el("button", "approve", "Approve"); approve.onclick = () => onDecision({
    models: modelBoxes.filter(([, c]) => c.checked).map(([m]) => m),
    tools: toolBoxes.filter(([, c]) => c.checked).map(([t]) => t),
    budgets: { maxTokensPerDay: numVal(tok), maxCallsPerMin: numVal(calls) },
    // Shape carries meaning downstream: kinds = approved; [] = the row was SHOWN and unchecked
    // (a decline — never re-ask); undefined = the app never asked (a scope upgrade may ask later).
    contextKinds: kindsBox ? (kindsBox.checked ? kinds : []) : undefined,
  });
  actions.append(deny, approve);
  rc.append(actions);
  approveBtn = approve;
  updateApprove();
}

function renderWrite(rc: HTMLElement, body: WriteBody, onDecision: (d: Decision) => void) {
  rc.append(el("div", "kick", "Write action"));
  const h = el("h2");
  h.append(originIcon(body.origin), document.createTextNode("Approve this action?"));
  rc.append(h);
  const conn = connectorOf(body.tool.name);
  const p = el("div", "reason");
  p.append(Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode(" wants to run "), Object.assign(el("b"), { textContent: shortTool(body.tool.name) }));
  if (conn) p.append(document.createTextNode(" · "), connectorGlyph(conn, "ichip"), document.createTextNode(` ${conn.label}`));
  rc.append(p);
  const sec = section(rc, "Arguments");
  sec.append(el("div", "args", JSON.stringify(body.tool.arguments, null, 2)));
  rc.append(el("div", "reason warn", "This may send, change, delete, or spend. Approve only if you initiated it."));
  const actions = el("div", "actions");
  const deny = el("button", "deny", "Deny"); deny.onclick = () => onDecision(false);
  const approve = el("button", "approve", "Approve once"); approve.onclick = () => onDecision(true as unknown as Decision);
  actions.append(deny, approve);
  rc.append(actions);
}

function renderStorageBind(rc: HTMLElement, body: StorageBindBody, onDecision: (d: Decision) => void) {
  rc.append(el("div", "kick", "Folder access"));
  const h = el("h2");
  h.append(originIcon(body.origin), document.createTextNode("Let "), Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode(" use a folder?"));
  rc.append(h);
  const p = el("div", "reason"); p.append(document.createTextNode("This binds the app's local store to a real folder on your machine — it can read and write files there, and nowhere else.")); rc.append(p);
  const sec = section(rc, "Folder");
  sec.append(el("div", "args", body.path));
  rc.append(el("div", "reason warn", "Only approve a folder you want this app to read and write."));
  const actions = el("div", "actions");
  const deny = el("button", "deny", "Deny"); deny.onclick = () => onDecision(false);
  const approve = el("button", "approve", "Bind folder"); approve.onclick = () => onDecision(true as unknown as Decision);
  actions.append(deny, approve);
  rc.append(actions);
}

function renderStoragePick(rc: HTMLElement, body: StoragePickBody, onDecision: (d: Decision) => void) {
  rc.append(el("div", "kick", "Folder access"));
  const h = el("h2");
  h.append(originIcon(body.origin), document.createTextNode("Let "), Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode(" open a folder?"));
  rc.append(h);
  const p = el("div", "reason");
  p.append(document.createTextNode("Choosing continues in your Mac's own folder dialog. The app never sees your files — only the folder you pick becomes its store, readable and writable there and nowhere else."));
  rc.append(p);
  if (body.reason) { const sec = section(rc, "Why"); sec.append(el("div", "args", body.reason)); }
  rc.append(el("div", "reason warn", "Pick only a folder you want this app to read and write."));
  const actions = el("div", "actions");
  const deny = el("button", "deny", "Deny"); deny.onclick = () => onDecision(false);
  const approve = el("button", "approve", "Choose folder…"); approve.onclick = () => onDecision(true as unknown as Decision);
  actions.append(deny, approve);
  rc.append(actions);
}

function renderContextPick(rc: HTMLElement, body: ContextPickBody, onDecision: (d: Decision) => void) {
  rc.append(el("div", "kick", "Load context"));
  const h = el("h2");
  h.append(originIcon(body.origin), document.createTextNode("Lend a brand to "), Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode("?"));
  rc.append(h);
  rc.append(el("div", "reason", "The app receives ONLY the one you pick, for this session. It never sees the rest of your library."));
  const sec = section(rc, "Your brands");
  const contexts = body.contexts || [];
  if (!contexts.length) { sec.append(el("div", "empty", "No brands yet — build one in brandbrain first.")); }
  let picked: string | null = contexts.length ? contexts[0]!.id : null;
  const rows: HTMLElement[] = [];
  for (const c of contexts) {
    const cb = el("input") as HTMLInputElement; cb.type = "radio"; cb.name = "sb-ctx"; cb.checked = c.id === picked;
    cb.onchange = () => { picked = c.id; };
    const label = el("label", "item");
    // the picker's kind marks: brands keep the lime monogram, the rest get quiet glyphs
    const k = (c.kind || "").toLowerCase();
    const kk = k === "csv" || k === "gsheet" || c.source ? "data" : k;
    const mk = el("span", "cmark" + (KIND_MARKS[kk] ? "" : " brand"));
    if (KIND_MARKS[kk]) mk.innerHTML = KIND_MARKS[kk]!;
    else mk.textContent = c.name[0]?.toUpperCase() ?? "•";
    label.append(cb, mk, el("span", "name", c.name), el("span", "badge read", c.kind || "brand"));
    rows.push(label);
  }
  const fold = rows.length > 4;
  rows.slice(0, fold ? 4 : rows.length).forEach((r) => sec.append(r));
  if (fold) {
    const more = el("button", "morelink", `all ${rows.length} ▾`);
    more.onclick = () => { more.remove(); rows.slice(4).forEach((r) => sec.append(r)); };
    sec.append(more);
  }
  const actions = el("div", "actions");
  const deny = el("button", "deny", "Cancel"); deny.onclick = () => onDecision(null);
  const approve = el("button", "approve", "Lend brand"); approve.onclick = () => onDecision((picked ? { contextId: picked } : null) as unknown as Decision);
  if (!contexts.length) approve.setAttribute("disabled", "true");
  actions.append(deny, approve);
  rc.append(actions);
}

function toggleAll(boxes: HTMLInputElement[]) { const target = !boxes.every((b) => b.checked); boxes.forEach((b) => (b.checked = target)); }
/** Numeric input that shows thousands-grouped when at rest and the raw number while editing. */
function numInput(v: number): HTMLInputElement {
  const i = el("input") as HTMLInputElement;
  i.type = "text"; i.inputMode = "numeric"; i.autocomplete = "off"; i.spellcheck = false;
  i.value = v.toLocaleString("en-US");
  i.onfocus = () => { i.value = String(numVal(i) || ""); };
  i.onblur = () => { i.value = numVal(i).toLocaleString("en-US"); };
  return i;
}
function numVal(i: HTMLInputElement): number { return Number(i.value.replace(/[^0-9]/g, "")) || 0; }
function wrapLabel(text: string, input: HTMLElement): HTMLElement { const l = el("label"); l.append(document.createTextNode(text), input); return l; }
