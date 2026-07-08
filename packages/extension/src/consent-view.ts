/**
 * The consent UI, in brandbrain's design language. Rendered inline in the side panel (primary) and
 * in a fallback window when the panel is closed — one shared renderer so they can't drift.
 *
 * Two kinds: connect (approve/narrow a site's requested scope, with select-all) and write (approve
 * one per-action tool call). Tool access badges come from the daemon's out-of-band classification;
 * this view only displays them.
 */

type Access = "read" | "write";
interface ConnectBody {
  origin: string;
  reason?: string;
  models: { available: string[]; requested: string[] };
  tools: Array<{ name: string; access: Access; label: string }>;
  budgets: { maxTokensPerDay: number; maxCallsPerMin: number };
}
interface WriteBody { origin: string; tool: { name: string; arguments: Record<string, unknown> }; }
interface StorageBindBody { origin: string; path: string; }
interface ContextMetaRow { id: string; name: string; kind?: string; source?: string }
interface ContextPickBody { origin: string; contexts: ContextMetaRow[] }
export interface Prompt { kind: "consent:connect" | "consent:write" | "consent:storage-bind" | "consent:context-pick"; body: unknown; }

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const host = (o: string) => { try { return new URL(o.includes("://") ? o : `https://${o}`).host; } catch { return o; } };

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
    .rc h2 { font: 600 17px/1.2 "Bricolage Grotesque", system-ui, sans-serif; letter-spacing: -0.02em; margin: 6px 0 2px; }
    .rc h2 .o { color: var(--lime); }
    .rc .reason { font-style: italic; color: var(--ink-dim,#99A3B7); margin: 2px 0 4px; }
    .rc .sec { margin-top: 16px; }
    .rc .sechead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
    .rc .allnone { font: 500 11px/1 "Hanken Grotesk", sans-serif; color: var(--lime); background: none; border: 0; cursor: pointer; padding: 2px 4px; }
    .rc label.item { display: flex; align-items: center; gap: 9px; padding: 6px 0; cursor: pointer; }
    .rc label.item input { accent-color: var(--lime); width: 15px; height: 15px; }
    .rc .name { flex: 1; }
    .rc .badge { font: 500 10px/1 "Spline Sans Mono", monospace; padding: 3px 7px; border-radius: 999px; }
    .rc .badge.read { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
    .rc .badge.write { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
    .rc .budget { display: flex; gap: 8px; }
    .rc .budget label { flex: 1; font-size: 11px; color: var(--ink-dim,#99A3B7); }
    .rc .budget input { width: 100%; margin-top: 4px; font: 400 12px/1 "Spline Sans Mono", monospace; color: inherit;
      background: var(--inset,#070809); border: 1px solid var(--edge,#262C38); border-radius: 8px; padding: 8px; outline: none; }
    .rc .args { font-family: "Spline Sans Mono", monospace; font-size: 11.5px; white-space: pre-wrap; word-break: break-word;
      background: var(--raised,#1A1F29); border-radius: 10px; padding: 10px; max-height: 180px; overflow: auto; color: var(--ink-sec,#B4BECE); }
    .rc .warn { color: var(--danger); font-weight: 600; }
    .rc .actions { display: flex; gap: 8px; margin-top: 18px; position: sticky; bottom: 0; padding-top: 10px; background: var(--page,#0A0C10); }
    .rc .actions button { flex: 1; font: 600 13px/1 "Hanken Grotesk", sans-serif; border-radius: 10px; padding: 11px; cursor: pointer; border: 1px solid transparent; }
    .rc .approve { background: var(--lime); color: #0A0C10; }
    .rc .approve:hover { opacity: .9; }
    .rc .deny { background: transparent; color: var(--ink-dim,#99A3B7); border-color: var(--edge,#262C38); }
    .rc .empty { color: var(--ink-faint,#6E7C90); font-size: 12.5px; padding: 6px 0; }
  `;
  document.head.appendChild(s);
}

export type Decision = null | false | { models: string[]; tools: Array<{ name: string; access: Access }>; budgets?: { maxTokensPerDay: number; maxCallsPerMin: number } };

/** Render a consent prompt into `root`; call `onDecision` with the result. */
export function renderConsent(root: HTMLElement, prompt: Prompt, onDecision: (d: Decision) => void) {
  ensureStyles();
  root.textContent = "";
  const rc = el("div", "rc");
  root.appendChild(rc);
  if (prompt.kind === "consent:connect") renderConnect(rc, prompt.body as ConnectBody, onDecision);
  else if (prompt.kind === "consent:storage-bind") renderStorageBind(rc, prompt.body as StorageBindBody, onDecision);
  else if (prompt.kind === "consent:context-pick") renderContextPick(rc, prompt.body as ContextPickBody, onDecision);
  else renderWrite(rc, prompt.body as WriteBody, onDecision);
}

function section(rc: HTMLElement, title: string, allNone?: () => void): HTMLElement {
  const sec = el("div", "sec");
  const head = el("div", "sechead");
  head.append(el("span", "kick", title));
  if (allNone) { const b = el("button", "allnone", "All / none"); b.onclick = allNone; head.append(b); }
  sec.append(head);
  rc.append(sec);
  return sec;
}

function renderConnect(rc: HTMLElement, body: ConnectBody, onDecision: (d: Decision) => void) {
  rc.append(el("div", "kick", "Connection request"));
  const h = el("h2"); h.append(document.createTextNode("Connect to "), Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode("?")); rc.append(h);
  if (body.reason) rc.append(el("div", "reason", `“${body.reason}”`));

  // Models — default to the requested set, else the first available.
  const wantModels = new Set(body.models.requested.length ? body.models.requested : body.models.available.slice(0, 1));
  const modelBoxes: Array<[string, HTMLInputElement]> = [];
  const mSec = section(rc, "Models", () => toggleAll(modelBoxes.map(([, c]) => c)));
  for (const m of body.models.available) {
    const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.checked = wantModels.has(m);
    modelBoxes.push([m, cb]);
    const label = el("label", "item"); label.append(cb, el("span", "name", m)); mSec.append(label);
  }

  // Tools — ONLY what the site requested, pre-checked, with read/write badges.
  const toolBoxes: Array<[{ name: string; access: Access }, HTMLInputElement]> = [];
  const tSec = section(rc, "Tools", () => toggleAll(toolBoxes.map(([, c]) => c)));
  if (!body.tools.length) tSec.append(el("div", "empty", "No tools requested — completions only."));
  for (const t of body.tools) {
    const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.checked = true;
    toolBoxes.push([{ name: t.name, access: t.access }, cb]);
    const label = el("label", "item");
    label.append(cb, el("span", "name", t.label || t.name), el("span", `badge ${t.access}`, t.access));
    tSec.append(label);
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
    budgets: { maxTokensPerDay: Number(tok.value) || 0, maxCallsPerMin: Number(calls.value) || 0 },
  });
  actions.append(deny, approve);
  rc.append(actions);
}

function renderWrite(rc: HTMLElement, body: WriteBody, onDecision: (d: Decision) => void) {
  rc.append(el("div", "kick", "Write action"));
  const h = el("h2", undefined, "Approve this action?"); rc.append(h);
  const short = body.tool.name.includes("__") ? body.tool.name.split("__").pop()! : body.tool.name;
  const p = el("div", "reason"); p.append(Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode(` wants to run `), Object.assign(el("b"), { textContent: short })); rc.append(p);
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
  const h = el("h2"); h.append(document.createTextNode("Let "), Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode(" use a folder?")); rc.append(h);
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

function renderContextPick(rc: HTMLElement, body: ContextPickBody, onDecision: (d: Decision) => void) {
  rc.append(el("div", "kick", "Load context"));
  const h = el("h2"); h.append(document.createTextNode("Lend a brand to "), Object.assign(el("span", "o"), { textContent: host(body.origin) }), document.createTextNode("?")); rc.append(h);
  rc.append(el("div", "reason", "The app receives ONLY the one you pick, for this session. It never sees the rest of your library."));
  const sec = section(rc, "Your brands");
  const contexts = body.contexts || [];
  if (!contexts.length) { sec.append(el("div", "empty", "No brands yet — build one in brandbrain first.")); }
  let picked: string | null = contexts.length ? contexts[0]!.id : null;
  const rows: Array<[string, HTMLInputElement]> = [];
  for (const c of contexts) {
    const cb = el("input") as HTMLInputElement; cb.type = "radio"; cb.name = "sb-ctx"; cb.checked = c.id === picked;
    cb.onchange = () => { picked = c.id; };
    rows.push([c.id, cb]);
    const label = el("label", "item");
    label.append(cb, el("span", "name", c.name), el("span", "badge read", c.kind || "brand"));
    sec.append(label);
  }
  const actions = el("div", "actions");
  const deny = el("button", "deny", "Cancel"); deny.onclick = () => onDecision(null);
  const approve = el("button", "approve", "Lend brand"); approve.onclick = () => onDecision((picked ? { contextId: picked } : null) as unknown as Decision);
  if (!contexts.length) approve.setAttribute("disabled", "true");
  actions.append(deny, approve);
  rc.append(actions);
}

function toggleAll(boxes: HTMLInputElement[]) { const target = !boxes.every((b) => b.checked); boxes.forEach((b) => (b.checked = target)); }
function numInput(v: number): HTMLInputElement { const i = el("input") as HTMLInputElement; i.type = "number"; i.min = "0"; i.value = String(v); return i; }
function wrapLabel(text: string, input: HTMLElement): HTMLElement { const l = el("label"); l.append(document.createTextNode(text), input); return l; }
