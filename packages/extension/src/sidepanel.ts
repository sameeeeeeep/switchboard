/**
 * Switchboard side panel. A calm home for the things you own — your active PROJECT, your CONNECTORS,
 * and the APPS using them — not a wall of logs. It pulls live data from the daemon via the background
 * control channel; outside the extension it renders representative mock data so the design is viewable
 * without the daemon. The technical detail (token meters, tool names, trust mode, the audit feed) is
 * tucked inside per-app expanders and a collapsed Activity section — surfaced only when you go looking.
 */

type Mode = "ask" | "trust" | "readonly";
interface Grant {
  origin: string;
  mode: Mode;
  models: string[];
  /** USER's model choice — the daemon runs this instead of whatever model the app asks for. */
  modelOverride?: string;
  tools: { name: string; access: "read" | "write" }[];
  budgets: { maxTokensPerDay: number; maxCallsPerMin: number };
  usage: { tokensToday: number; callsThisMinute: number };
  storage?: { folder: string; autoAssigned: boolean; count: number } | null;
  pending?: { tool: string; args: Record<string, unknown> } | null;
}
interface AuditEntry { ts: number; origin: string; method?: string; toolName?: string; kind: string; decision?: string; outcome: string; }
interface ContextMeta { id: string; name: string; kind?: string; publishedBy?: string; updatedAt: number; swatches?: string[]; sourceKind?: "csv" | "gsheet"; rowCount?: number; folder?: string }
interface TeamMember { deviceId: string; name: string; online: boolean; lastSeen: number; you?: boolean }
interface TeamGit { remote: string; branch: string; enabled: boolean; lastPushAt?: number; lastPullAt?: number; error?: string }
interface TeamStatus { enabled: boolean; role: "off" | "host" | "member"; teamName?: string; folder?: string; invite?: string; connected?: boolean; members: TeamMember[]; error?: string; git?: TeamGit; relay?: string }
interface PanelData { paired: boolean; reachable: boolean; tokenRejected?: boolean; grants: Grant[]; audit: AuditEntry[]; contexts: ContextMeta[]; activeProject: string | null; selections: { origin: string; contextId: string | null }[]; team: TeamStatus | null; }

import { renderConsent, type Prompt } from "./consent-view.js";
import { WRAPPS, host, hostMatch } from "./wrapps.js";
import { connectorOf, connectorGlyph, brandIcon, KIND_MARKS, type ConnectorInfo } from "./icons.js";

const inExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
let consentActive = false;
const openApps = new Set<string>(); // origins whose detail is expanded (preserved across refreshes)

// Which lists the user opened up ("see all"). Module scope IS session memory — the panel document
// survives tab switches and daemon-push refreshes, exactly like `openApps` above.
// Keys: 'connectors' | 'apps' | 'wrapps' | 'feed' | 'pickerAdd' | 'pgroup:<name>'.
const expandedSections = new Set<string>();

// The wrapp registry + host helpers live in ./wrapps (shared with the in-page widget).
function openWrapp(url: string) {
  try { if (inExtension && chrome.tabs?.create) { chrome.tabs.create({ url }); return; } } catch { /* fall through */ }
  window.open(url, "_blank", "noopener");
}

const MOCK: PanelData = {
  paired: true, reachable: true,
  // Team Mode preview: hosting a small team, one teammate offline — every state the section draws.
  team: {
    enabled: true, role: "host", teamName: "Aamras studio", folder: "/Users/you/Projects/aamras/.data", connected: true,
    invite: "swb1.eyJob3N0IjoiMTkyLjE2OC4xLjIxIiwicG9ydCI6ODc5MH0",
    git: { remote: "git@github.com:aamras/studio-vault.git", branch: "main", enabled: true, lastPushAt: Date.now() - 180_000 },
    members: [
      { deviceId: "you", name: "Sameep", online: true, lastSeen: Date.now(), you: true },
      { deviceId: "m2", name: "Ira", online: true, lastSeen: Date.now() - 20_000 },
      { deviceId: "m3", name: "Dev", online: false, lastSeen: Date.now() - 3_600_000 },
    ],
  },
  contexts: [
    { id: "aamras", name: "Aamras", kind: "brand", updatedAt: Date.now() - 3_600_000, swatches: ["#8B1A1A", "#F4A000", "#0D0D0D", "#D4C89A"] },
    { id: "haazma", name: "Haazma", kind: "brand", updatedAt: Date.now() - 86_400_000, swatches: ["#F5A623", "#6B2737", "#3D7D4E", "#F5F0E8"] },
    { id: "piqual", name: "Piqual", kind: "brand", updatedAt: Date.now() - 200_000_000, swatches: ["#7AB648", "#F4F1E8", "#1C1C1A", "#C8A84B"] },
    { id: "sheet1", name: "Vendor book (Sheet)", kind: "csv", updatedAt: Date.now() - 600_000, sourceKind: "gsheet", rowCount: 42 },
    { id: "redline", name: "Redline", kind: "project", updatedAt: Date.now() - 120_000, folder: "~/Projects/redline" },
  ],
  activeProject: "aamras",
  selections: [{ origin: "https://prism.app", contextId: "haazma" }],
  // (a Sheet-backed project shows up alongside brand projects — same picker, marked "live")
  grants: [
    { origin: "https://brandbrain.app", mode: "trust", models: ["sonnet", "llama3.2:latest"], modelOverride: "llama3.2:latest", tools: [{ name: "WebSearch", access: "read" }, { name: "WebFetch", access: "read" }, { name: "mcp__claude_ai_Higgsfield__*", access: "write" }, { name: "mcp__claude_ai_Shopify__*", access: "write" }, { name: "mcp__claude_ai_Gmail__*", access: "read" }, { name: "mcp__claude_ai_Meta__*", access: "write" }],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 148_200, callsThisMinute: 4 }, storage: { folder: "/Users/you/Projects/brandbrain/.data", autoAssigned: false, count: 6 }, pending: null },
    { origin: "https://prism.app", mode: "ask", models: ["sonnet"], tools: [{ name: "mcp__claude_ai_Higgsfield__*", access: "write" }],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 12_400, callsThisMinute: 1 }, storage: { folder: "~/.relay/storage/prism", autoAssigned: true, count: 0 },
      pending: { tool: "mcp__claude_ai_Higgsfield__generate_image", args: {} } },
    { origin: "https://bank.thelastprompt.ai", mode: "ask", models: ["sonnet"], tools: [{ name: "mcp__claude_ai_ClickUp__create_task", access: "write" }, { name: "mcp__claude_ai_Notion__search", access: "read" }, { name: "WebSearch", access: "read" }],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 4_100, callsThisMinute: 0 }, storage: null, pending: null },
    { origin: "https://redline.thelastprompt.ai", mode: "ask", models: ["sonnet"], tools: [{ name: "mcp__claude_ai_GitHub__get_file_contents", access: "read" }, { name: "mcp__claude_ai_Slack__post_message", access: "write" }, { name: "mcp__claude_ai_Figma__get_design_context", access: "read" }],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 900, callsThisMinute: 0 }, storage: null, pending: null },
  ],
  audit: [
    { ts: Date.now() - 9_000, origin: "https://brandbrain.app", toolName: "claude_session", kind: "request", outcome: "ok" },
    { ts: Date.now() - 44_000, origin: "https://prism.app", toolName: "mcp__claude_ai_Higgsfield__generate_image", kind: "consent", decision: "user-approved", outcome: "ok" },
    { ts: Date.now() - 240_000, origin: "https://brandbrain.app", toolName: "claude_context__publish", kind: "tool_call", decision: "auto-approved", outcome: "ok" },
    { ts: Date.now() - 400_000, origin: "https://brandbrain.app", toolName: "mcp__claude_ai_Shopify__update_product", kind: "tool_call", decision: "auto-approved", outcome: "ok" },
    { ts: Date.now() - 520_000, origin: "https://prism.app", toolName: "mcp__claude_ai_Higgsfield__remove_background", kind: "consent", outcome: "denied" },
    { ts: Date.now() - 700_000, origin: "https://bank.thelastprompt.ai", toolName: "claude_session", kind: "request", outcome: "ok" },
    { ts: Date.now() - 1_000_000, origin: "https://brandbrain.app", toolName: "mcp__claude_ai_Gmail__create_draft", kind: "tool_call", decision: "auto-approved", outcome: "ok" },
    { ts: Date.now() - 1_400_000, origin: "https://redline.thelastprompt.ai", toolName: "claude_session", kind: "request", outcome: "ok" },
    { ts: Date.now() - 1_900_000, origin: "https://brandbrain.app", toolName: "WebSearch", kind: "tool_call", decision: "auto-approved", outcome: "ok" },
    { ts: Date.now() - 2_400_000, origin: "https://prism.app", toolName: "mcp__claude_ai_Higgsfield__generate_video", kind: "consent", decision: "user-approved", outcome: "ok" },
    { ts: Date.now() - 3_000_000, origin: "https://bank.thelastprompt.ai", toolName: "mcp__claude_ai_ClickUp__create_task", kind: "tool_call", decision: "auto-approved", outcome: "ok" },
    { ts: Date.now() - 3_600_000, origin: "https://brandbrain.app", toolName: "claude_session", kind: "request", outcome: "ok" },
  ],
};

const $ = (id: string) => document.getElementById(id)!;
const el = (tag: string, cls?: string, text?: string) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));
const meterColor = (pct: number) => (pct < 0.5 ? "var(--lime)" : pct < 0.8 ? "var(--warn)" : "var(--danger)");
const ago = (ts: number) => { const s = Math.round((Date.now() - ts) / 1000); if (s < 60) return `${s}s ago`; const m = Math.round(s / 60); if (m < 60) return `${m}m ago`; return `${Math.round(m / 60)}h ago`; };
const short = (name: string) => name.includes("__") ? name.split("__").pop()!.replace(/[-_*]/g, " ").trim() : name;

/** The shared "See all N ▾ / Show fewer ▴" row. Toggles a key in `expandedSections` and re-renders
 *  from the data already in hand — expansion survives daemon-push refreshes because the key does. */
function moreBtn(key: string, more: string, fewer = "Show fewer ▴"): HTMLElement {
  const open = expandedSections.has(key);
  const b = el("button", "morebtn", open ? fewer : more);
  b.onclick = () => {
    if (open) expandedSections.delete(key); else expandedSections.add(key);
    if (lastData) render(lastData);
  };
  return b;
}

/** A human name for an app from its origin. Wrapp-store entries → their real names; other real
 *  domains → the subdomain (each wrapp lives on its own), falling back to the site name; local
 *  dev → "Local wrapps" (one origin hosts several, so no single name is honest). */
const KNOWN: Record<string, string> = { "127.0.0.1:5178": "brandbrain", "localhost:5178": "brandbrain", "localhost:5174": "Local wrapps", "127.0.0.1:5174": "Local wrapps" };
function appName(origin: string): string {
  const h = host(origin);
  if (KNOWN[h]) return KNOWN[h]!;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(h)) return "Local app";
  const w = WRAPPS.find((w) => { try { return new URL(w.url).host === h; } catch { return false; } });
  if (w) return w.name;
  const parts = h.replace(/^www\./, "").split(".");
  return parts[0] || h;
}

function control(action: string, args?: unknown): Promise<any> {
  return new Promise((res) => chrome.runtime.sendMessage({ type: "control", action, args }, res));
}

/** The empty shell every degraded state shares — only the ladder flags differ. */
const EMPTY = { grants: [], audit: [], contexts: [], activeProject: null, selections: [], team: null };

async function load(): Promise<PanelData> {
  if (!inExtension) {
    // Design preview: ?state=unreachable | unpaired | asleep | rejected mocks each setup state
    // (serve.mjs, outside the extension); default renders the connected home with MOCK data.
    const s = new URLSearchParams(location.search).get("state");
    if (s === "unreachable") return { paired: false, reachable: false, ...EMPTY };
    if (s === "unpaired") return { paired: false, reachable: true, ...EMPTY };
    if (s === "asleep") return { paired: true, reachable: false, ...EMPTY };
    if (s === "rejected") return { paired: true, reachable: false, tokenRejected: true, ...EMPTY };
    // `cold` = set up and online, but an EMPTY library — the first-run state the three pointers
    // exist for, and the one MOCK (a full library) can never show.
    if (s === "cold") return { paired: true, reachable: true, ...EMPTY };
    return MOCK;
  }
  const status = await new Promise<any>((r) => chrome.runtime.sendMessage({ type: "getStatus" }, r));
  if (!status?.paired || !status?.reachable)
    return { paired: !!status?.paired, reachable: !!status?.reachable, tokenRejected: !!status?.tokenRejected, ...EMPTY };
  const g = await control("listGrants");
  const a = await control("audit", { limit: 40 });
  const c = await control("listContexts");
  // An older daemon answers team.status with {ok:false, error:"unknown control action…"} —
  // null hides the section entirely, so the panel stays compatible in both directions.
  const t = await control("team.status");
  return {
    paired: true, reachable: true,
    grants: (g?.grants ?? []).map((x: any) => ({ ...x, pending: x.pending ?? null })),
    audit: a?.entries ?? [],
    contexts: c?.contexts ?? [],
    activeProject: c?.activeProject ?? null,
    selections: c?.selections ?? [],
    team: t?.ok ? (t.status as TeamStatus) : null,
  };
}

function lastSeen(origin: string, audit: AuditEntry[]): number { for (const e of audit) if (e.origin === origin) return e.ts; return 0; }

let lastData: PanelData | null = null; // so tab-change events can re-render the "This tab" card

function render(data: PanelData) {
  if (consentActive) return;
  lastData = data;
  const online = data.paired && data.reachable;
  const rejected = !!data.tokenRejected;
  const st = $("status"); st.className = "status" + (online ? " on" : "");
  // Status strip: calm, each string names where you are on the ladder — never "offline"/"error".
  $("statusText").textContent = online ? "on"
    : rejected || (!data.paired && data.reachable) ? "pair to finish setup"
    : data.paired ? "sidekick asleep"
    : "not set up";
  ($("home") as HTMLElement).hidden = !online;

  // Three setup states, never shown together:
  //   • fresh install (nothing answers the daemon port, nothing paired) → the get-the-sidekick
  //     card. No token input — pairing against a dead daemon is a dead end.
  //   • daemon up, no accepted pairing (none stored, or the stored one was rejected) → the
  //     pairing card (token input + Pair).
  //   • paired but the sidekick isn't running → the pairing card as a calm amber "asleep" note
  //     with Retry; the auth_ok health push flips the panel home on its own once it wakes.
  const freshInstall = !online && !data.paired && !data.reachable;
  ($("setup") as HTMLElement).hidden = online || !freshInstall;
  ($("pairing") as HTMLElement).hidden = online || freshInstall;
  if (!online && !freshInstall) {
    const tokenEl = $("token") as HTMLInputElement;
    const err = $("pairErr");
    if (!data.paired) {           // reachable + unpaired: the normal first pairing
      $("pairH2").textContent = "Connect this browser to your Claude";
      tokenEl.hidden = false; ($("pairHint") as HTMLElement).hidden = false;
      err.className = "err"; err.textContent = "";
      $("pairBtn").textContent = "Pair";
    } else if (rejected) {        // daemon up but it refused our token — never say "isn't running"
      $("pairH2").textContent = "Connect this browser to your Claude";
      tokenEl.hidden = false; ($("pairHint") as HTMLElement).hidden = false;
      err.className = "err"; err.textContent = "That pairing token didn’t match. Copy a fresh one from the Relay app and pair again.";
      $("pairBtn").textContent = "Pair";
    } else {                      // paired, sidekick asleep — retry is a courtesy; health auto-recovers
      $("pairH2").textContent = "Your sidekick is asleep";
      tokenEl.hidden = true; ($("pairHint") as HTMLElement).hidden = true;
      err.className = "err calm"; err.textContent = "Your sidekick isn’t running. Open Relay from Applications — it lives in your menu bar — and it will wake up.";
      $("pairBtn").textContent = "Retry";
    }
  }
  if (!online) return;

  void renderCurrentSite(data);
  void renderProject(data);
  renderTeam(data);
  renderConnectors(data);
  renderApps(data);
  renderWrapps(data);
  renderActivity(data);
}

// ---- This tab: the active site, and whether Switchboard can help here ----
// The panel is your window's control surface; it should react to WHERE you are. If the site you're
// on runs on Switchboard you see it's connected; if it hasn't opted in (e.g. Canva), we suggest a
// wrapp that does the same job on YOUR compute, context and data — for free.
async function activeTabHost(): Promise<string | null> {
  if (!inExtension) return "instagram.com"; // design preview: show the site-aware Cast pack case
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return null;
    const u = new URL(tab.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null; // ignore chrome://, about:, file:, the panel itself
    return u.host;
  } catch { return null; }
}

async function renderCurrentSite(data: PanelData) {
  const sec = $("siteSec") as HTMLElement; const box = $("site"); box.textContent = "";
  const h = await activeTabHost();
  if (!h) { sec.hidden = true; return; }

  const connected = data.grants.find((g) => hostMatch(h, host(g.origin)));
  const ownWrapp = WRAPPS.find((w) => hostMatch(h, host(w.url)));
  const alts = connected || ownWrapp ? [] : WRAPPS.filter((w) => (w.alternativeTo ?? []).some((d) => hostMatch(h, d)));

  const card = el("div", "site");
  const row = el("div", "row");
  const txt = el("div"); txt.style.minWidth = "0";
  txt.append(el("div", "h", h.replace(/^www\./, "")));
  const stt = el("div", "st"); const dot = el("span", "dot");
  if (connected) { dot.style.background = "var(--ok)"; stt.style.color = "var(--ok)"; stt.append(dot, document.createTextNode("Connected — running on your Claude")); }
  else if (ownWrapp) { dot.style.background = "var(--lime)"; stt.style.color = "var(--ink-dim)"; stt.append(dot, document.createTextNode("Works with Switchboard — connect it on the page")); }
  else { dot.style.background = "var(--ink-faint)"; stt.style.color = "var(--ink-faint)"; stt.append(dot, document.createTextNode("Hasn’t opted into Switchboard")); }
  txt.append(stt);
  // the row users glance at most: the real tab favicon (from Chrome's local cache), glyph fallback
  row.append(brandIcon({ className: "fav", pageUrl: `https://${h}`, letter: h.replace(/^www\./, "")[0] ?? "•" }), txt);
  card.append(row);

  if (alts.length) {
    card.append(el("div", "free", "Use one of these instead — free, on your own compute, context & data:"));
    const list = el("div", "alts");
    for (const w of alts.slice(0, 3)) {
      const a = el("button", "alt");
      const ic = brandIcon({ className: "ic", pageUrl: w.url, letter: w.name[0]!, color: w.color });
      const t = el("div"); t.style.minWidth = "0"; t.append(el("div", "nm", w.name), el("div", "ds", w.desc));
      a.append(ic, t, el("div", "go", "Open →"));
      a.onclick = () => openWrapp(w.url);
      list.append(a);
    }
    card.append(list);
  }

  box.append(card);
  sec.hidden = false;
}

// ---- Wrapp store: launch an app in a new tab (a green dot marks ones already connected) ----
// Density rule: connected wrapps first, 4 visible (two rows of 2), the rest behind "See all".
function renderWrapps(data: PanelData) {
  const box = $("wrapps"); box.textContent = "";
  const connected = new Set(data.grants.map((g) => host(g.origin)));
  const sorted = [...WRAPPS].sort((a, b) => Number(connected.has(host(b.url))) - Number(connected.has(host(a.url))));
  const expanded = expandedSections.has("wrapps");
  const shown = expanded ? sorted : sorted.slice(0, 4);
  for (const w of shown) {
    const card = el("button", "wrapp");
    const t2 = el("div", "t2");
    const ic = brandIcon({ className: "ic", pageUrl: w.url, letter: w.name[0]!, color: w.color });
    t2.append(ic, el("div", "nm", w.name));
    if (connected.has(host(w.url))) { const d = el("div", "live"); d.title = "connected"; t2.append(d); }
    card.append(t2, el("div", "ds", w.desc), el("div", "go", "Open →"));
    card.onclick = () => openWrapp(w.url);
    box.append(card);
  }
  const after = $("wrappsMore"); after.textContent = "";
  if (sorted.length > 4) after.append(moreBtn("wrapps", `See all ${sorted.length} ▾`));
}

// ---- Working on: per-app first. When the current tab IS a connected app, this card shows and
// edits what THAT app is lent (its own pick, else your default); anywhere else it edits the
// default — the context new apps inherit until they pick their own. Selection was always
// per-origin in the daemon; this gives the per-origin layer its missing UI.
async function renderProject(data: PanelData) {
  const box = $("project"); box.textContent = "";
  const h = await activeTabHost();
  const tabGrant = h ? data.grants.find((g) => hostMatch(h, host(g.origin))) : null;
  const origin = tabGrant?.origin ?? null;
  const explicit = origin ? (data.selections.find((s) => s.origin === origin)?.contextId ?? null) : null;
  const shownId = origin ? (explicit ?? data.activeProject) : data.activeProject;
  const active = data.contexts.find((c) => c.id === shownId) || null;
  const card = el("div", "project" + (active ? "" : " empty"));
  card.append(el("i", "stripe"));
  const row = el("div", "row");
  row.append(el("div", "mark", (active?.name || "—")[0]?.toUpperCase() ?? "—"));
  const txt = el("div"); txt.style.minWidth = "0";
  txt.append(el("div", "name", active ? active.name : (origin ? "Nothing lent to this app" : "No default yet")));
  const meta = origin
    ? (active ? `lent to ${host(origin)}${explicit ? "" : " · your default"}` : `pick one to lend ${host(origin)}`)
    : (active ? `${active.kind ?? "project"} · your default — apps that ask inherit it` : "Point at your site, a repo or a folder — every app borrows it");
  txt.append(el("div", "meta", meta));
  row.append(txt);
  // Cold start is the whole product's gate: an empty library means every proactive app has nothing
  // to work from. So the button is NEVER dead — with nothing banked it opens straight into the
  // pointer chooser instead of reading "None yet" and doing nothing.
  const cold = !data.contexts.length;
  const sw = el("button", "switch", cold ? "Set up" : active ? "Switch" : "Choose");
  sw.onclick = () => {
    if (cold) { expandedSections.add("pickerAdd"); addPointer = addPointer ?? "site"; }
    openPicker(data, origin);
  };
  row.append(sw);
  card.append(row);
  // No brand swatches here: a context's colours belong INSIDE the app that uses them, in its own
  // field — showing them in Switchboard's chrome just decorates and dilutes the meaning.
  box.append(card);
}

// ---- Team: one shared folder, everyone's own Claude ----
// Entirely additive: the section hides itself when the daemon doesn't speak team.* (older daemon)
// and shows a single quiet "turn on" row until the user flips the mode. All actions are control
// ops (panel-only, out of band); presence refreshes through the normal state:changed re-pull.
let teamErr = ""; // last action error, shown inline until the next successful action

/** Every member gets a stable colour derived from their deviceId — the same member is the same
 *  colour on every machine and every visit, with no coordination. Greyed out while offline. */
const TEAM_COLORS = ["#C8F250", "#6FB5FF", "#FF8AC2", "#FFC24B", "#6FE3D2", "#C9A6FF"];
function memberColor(deviceId: string): string {
  let h = 0;
  for (const ch of deviceId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length]!;
}

async function teamAct(action: string, args?: unknown): Promise<boolean> {
  if (!inExtension) return false; // design preview: buttons are inert
  const r = await control(action, args);
  teamErr = r?.ok ? "" : (r?.error || "something went wrong");
  render(await load());
  return !!r?.ok;
}

function renderTeam(data: PanelData) {
  const sec = $("teamSec") as HTMLElement; const box = $("team"); box.textContent = "";
  const t = data.team;
  if (!t) { sec.hidden = true; return; } // daemon doesn't speak Team Mode — no dead UI
  sec.hidden = false;
  const card = el("div", "team");

  if (!t.enabled) {
    // The mode switch, off: one calm row, no ceremony.
    const row = el("div", "trow");
    const txt = el("div"); txt.style.minWidth = "0";
    txt.append(el("div", "toff", "Team Mode is off. Share one folder with people you trust — every member works on it with their own Claude."));
    row.append(txt);
    const on = el("button", "tbtn", "Turn on");
    on.onclick = () => void teamAct("team.setEnabled", { on: true });
    row.append(on);
    card.append(row);
  } else if (t.role === "off") {
    // Enabled, no team yet: host or join.
    const showHost = expandedSections.has("team:host");
    const showJoin = expandedSections.has("team:join");
    if (!showHost && !showJoin) {
      const split = el("div", "split");
      const mk = (label: string, key: string) => {
        const b = el("button", "tbtn", label); b.style.marginLeft = "0"; b.style.textAlign = "center";
        b.onclick = () => { expandedSections.add(key); if (lastData) render(lastData); };
        return b;
      };
      split.append(mk("Host a team", "team:host"), mk("Join with a code", "team:join"));
      card.append(split);
      const off = el("button", "disconnect", "Turn Team Mode off");
      off.onclick = () => void teamAct("team.setEnabled", { on: false });
      card.append(off);
    } else if (showHost) {
      const form = el("div", "tform");
      const name = el("input") as HTMLInputElement; name.placeholder = "team name";
      const folder = el("input") as HTMLInputElement; folder.placeholder = "folder to share (absolute path)";
      const pick = el("button", "tbtn", "Choose folder…"); pick.style.marginLeft = "0";
      pick.onclick = async () => {
        if (!inExtension) return;
        const r = await control("team.pickFolder");
        if (r?.ok && r.path) folder.value = r.path;
        else if (r && !r.ok) { teamErr = r.error || "no picker here — type the path"; if (lastData) render(lastData); }
      };
      const relayInput = el("input") as HTMLInputElement; relayInput.placeholder = "relay URL (optional — for teammates on other networks)";
      const go = el("button", "go", "Host — start sharing this folder");
      go.onclick = async () => {
        if (!folder.value.trim()) { teamErr = "pick or type the folder to share"; if (lastData) render(lastData); return; }
        const rl = relayInput.value.trim();
        if (await teamAct("team.host", { folder: folder.value.trim(), teamName: name.value.trim() || undefined, lan: true, ...(rl ? { relay: rl } : {}) }))
          expandedSections.delete("team:host");
      };
      form.append(name, folder, pick, relayInput, go, el("div", "hint", "Everything in this folder syncs to every member. Their Claude never becomes yours — each runs their own. Leave the relay blank for same-network teams; set it (e.g. wss://…) so people on other networks can join."));
      card.append(form);
    } else {
      const form = el("div", "tform");
      const code = el("input") as HTMLInputElement; code.placeholder = "paste the invite code";
      const folder = el("input") as HTMLInputElement; folder.placeholder = "folder (optional — defaults to ~/Switchboard Teams/<team>)";
      const go = el("button", "go", "Join team");
      go.onclick = async () => {
        if (await teamAct("team.join", { code: code.value, ...(folder.value.trim() ? { folder: folder.value.trim() } : {}) })) expandedSections.delete("team:join");
      };
      form.append(code, folder, go, el("div", "hint", "The team's folder appears under Switchboard Teams with the team's name — lend it to apps like any project."));
      card.append(form);
    }
    if (showHost || showJoin) {
      const back = el("button", "disconnect", "← Back");
      back.onclick = () => { expandedSections.delete("team:host"); expandedSections.delete("team:join"); if (lastData) render(lastData); };
      card.append(back);
    }
  } else {
    // In a team: name, presence, invite (host), folder, leave.
    const row = el("div", "trow");
    const txt = el("div"); txt.style.minWidth = "0";
    txt.append(el("div", "tname", t.teamName || "Team"));
    const via = t.relay ? " · via relay" : "";
    txt.append(el("div", "tmeta", (t.role === "host" ? (t.connected ? "you're hosting" : t.error ? `hosting failed — ${t.error}` : "starting…") : t.connected ? "connected" : "reconnecting…") + via));
    row.append(txt);
    const leave = el("button", "tbtn", t.role === "host" ? "Stop hosting" : "Leave");
    leave.onclick = () => void teamAct("team.leave");
    row.append(leave);
    card.append(row);
    const members = el("div", "members");
    for (const m of t.members) {
      const mr = el("div", "member");
      const dot = el("i", "pd");
      if (m.online) {
        const c = memberColor(m.deviceId);
        dot.style.background = c;
        dot.style.boxShadow = `0 0 6px ${c}66`;
      } // offline keeps the grey default — colour IS the presence signal
      mr.append(dot);
      mr.append(el("span", undefined, m.name));
      if (m.you) mr.append(el("span", "yy", "you"));
      members.append(mr);
    }
    card.append(members);
    if (t.invite) {
      const inv = el("div", "invite");
      const c = el("code", undefined, t.invite);
      const copy = el("button", "tbtn", "Copy invite"); copy.style.marginLeft = "0";
      copy.onclick = () => { void navigator.clipboard?.writeText(t.invite!); copy.textContent = "Copied ✓"; setTimeout(() => { copy.textContent = "Copy invite"; }, 1200); };
      inv.append(c, copy);
      card.append(inv);
      card.append(el("div", "hint", "The code is the key to the team — share it like a password."));
    }
    if (t.folder) card.append(el("div", "path", t.folder));

    // Git backing — "the folder when live, the repo when apart".
    if (t.git) {
      const g = t.git;
      const state = g.error ? `⚠ ${g.error}` : g.lastPushAt ? `pushed ${ago(g.lastPushAt)}` : g.enabled ? "syncing…" : "not active on this machine";
      card.append(el("div", "hint", `repo: ${g.remote} · ${state}`));
      if (!g.enabled) {
        const en = el("button", "tbtn", "Back up to this repo from this machine");
        en.style.marginLeft = "0";
        en.onclick = () => void teamAct("team.setGitEnabled", { on: true });
        card.append(en);
        card.append(el("div", "hint", "Uses your own git sign-in. Everything in the team folder is committed and pushed."));
      } else if (t.role === "host") {
        const off = el("button", "disconnect", "Stop git backup");
        off.onclick = () => void teamAct("team.setGit", {});
        card.append(off);
      } else {
        const off = el("button", "disconnect", "Stop pushing from this machine");
        off.onclick = () => void teamAct("team.setGitEnabled", { on: false });
        card.append(off);
      }
    } else if (t.role === "host") {
      if (!expandedSections.has("team:git")) {
        const add = el("button", "tbtn", "Back up to a git repo…");
        add.style.marginLeft = "0";
        add.onclick = () => { expandedSections.add("team:git"); if (lastData) render(lastData); };
        card.append(add);
      } else {
        const form = el("div", "tform");
        const remote = el("input") as HTMLInputElement; remote.placeholder = "git@github.com:you/team-vault.git";
        const go = el("button", "go", "Commit & push this folder to the repo");
        go.onclick = async () => {
          if (await teamAct("team.setGit", { remote: remote.value.trim() })) expandedSections.delete("team:git");
        };
        const back = el("button", "disconnect", "← Back");
        back.onclick = () => { expandedSections.delete("team:git"); if (lastData) render(lastData); };
        form.append(remote, go, el("div", "hint", "Everything in the team folder becomes commits in this repo — teammates sync through it when you're apart, and repo access doubles as membership."), back);
        card.append(form);
      }
    }
  }

  if (teamErr) card.append(el("div", "terr", teamErr));
  box.append(card);
}

// ---- Connectors: friendly capability tiles derived from what apps are granted ----
// Density rule: two full rows (6 tiles) at panel width; beyond that the 6th cell is a ghost tile
// ("+N more" / "Show less") so the grid never pushes Apps below the fold.
function renderConnectors(data: PanelData) {
  const box = $("connectors"); box.textContent = "";
  const seen = new Map<string, ConnectorInfo & { apps: number }>();
  for (const g of data.grants) {
    const keys = new Map<string, ConnectorInfo>();
    for (const t of g.tools) { const c = connectorOf(t.name); if (c) keys.set(c.key, c); }
    for (const [k, c] of keys) { const e = seen.get(k) ?? { ...c, apps: 0 }; e.apps++; seen.set(k, e); }
  }
  if (!seen.size) { box.append(el("div", "empty-note", "No connectors in use yet. Apps you connect will ask for the ones they need.")); return; }
  const all = [...seen.values()].sort((a, b) => b.apps - a.apps || a.label.localeCompare(b.label));
  const expanded = expandedSections.has("connectors");
  const overflow = all.length > 6;
  const shown = overflow && !expanded ? all.slice(0, 5) : all;
  for (const c of shown) {
    const tile = el("div", "conn");
    tile.append(connectorGlyph(c, "ic"), el("div", "nm", c.label), el("div", "use", `${c.apps} app${c.apps === 1 ? "" : "s"}${c.hint ? " · " + c.hint : ""}`));
    box.append(tile);
  }
  if (overflow) {
    const ghost = el("button", "conn more", expanded ? "Show less" : `+${all.length - 5} more`);
    ghost.onclick = () => { if (expanded) expandedSections.delete("connectors"); else expandedSections.add("connectors"); if (lastData) render(lastData); };
    box.append(ghost);
  }
}

// ---- Apps: connected wrapps; the technical detail lives in the expander ----
// Density rule: 3 visible, pending-first (a waiting consent is never hidden behind the fold),
// then active-now, then most recently seen. The rest live behind "See all".
function renderApps(data: PanelData) {
  $("appCount").textContent = data.grants.length ? `${data.grants.length}` : "";
  const box = $("apps"); box.textContent = "";
  if (!data.grants.length) { box.append(el("div", "empty-note", "No apps connected yet. When one asks to use your Claude, you’ll approve it here.")); return; }

  const ranked = [...data.grants]
    .map((g) => { const seen = lastSeen(g.origin, data.audit); return { g, seen, active: seen ? Date.now() - seen < 120_000 : false }; })
    .sort((a, b) => Number(!!b.g.pending) - Number(!!a.g.pending) || Number(b.active) - Number(a.active) || b.seen - a.seen);
  const expanded = expandedSections.has("apps");
  const shown = !expanded && ranked.length > 3 ? ranked.slice(0, 3) : ranked;

  for (const { g, seen, active: activeNow } of shown) {
    const isOpen = openApps.has(g.origin);
    const card = el("div", "app" + (isOpen ? " open" : "") + (g.pending ? " pending" : ""));

    const row = el("div", "row");
    row.append(brandIcon({ className: "av", pageUrl: g.origin, letter: appName(g.origin)[0] ?? "•" }));
    const txt = el("div"); txt.style.minWidth = "0";
    txt.append(el("div", "nm", appName(g.origin)));
    const sub = el("div", "sub");
    sub.append(Object.assign(el("span", "dot" + (activeNow ? "" : " idle")), {}), document.createTextNode(g.pending ? "waiting for you" : activeNow ? "active now" : seen ? ago(seen) : "connected"));
    txt.append(sub); row.append(txt);
    row.append(el("div", "chev", "▾"));
    row.onclick = () => { if (isOpen) openApps.delete(g.origin); else openApps.add(g.origin); refresh(); };
    card.append(row);

    // ---- detail ----
    const detail = el("div", "detail");
    const conns = new Map<string, ConnectorInfo>();
    for (const t of g.tools) { const c = connectorOf(t.name); if (c) conns.set(c.key, c); }
    if (conns.size) {
      const d = el("div"); d.append(el("div", "k", "Can use"));
      const pills = el("div", "pills"); pills.style.marginTop = "7px";
      const entries = [...conns.values()];
      for (const c of entries.slice(0, 6)) {
        const p = el("span", "pill");
        p.append(connectorGlyph(c, "pili"), document.createTextNode(c.label));
        pills.append(p);
      }
      if (entries.length > 6) pills.append(el("span", "pill bare", `+${entries.length - 6}`));
      d.append(pills); detail.append(d);
    }
    if (g.storage) { const d = el("div", "drow"); d.append(el("span", "k", g.storage.autoAssigned ? "Private data" : "Project folder")); d.append(el("span", "pill", `${g.storage.count} record${g.storage.count === 1 ? "" : "s"}`)); detail.append(d); }

    // usage (moved out of the surface)
    const pct = Math.min(1, g.usage.tokensToday / (g.budgets.maxTokensPerDay || 1));
    const use = el("div"); use.append(el("div", "k", "Compute today"));
    const bar = el("div", "usebar"); bar.style.marginTop = "7px";
    bar.title = `${g.usage.tokensToday.toLocaleString("en-US")} of ${g.budgets.maxTokensPerDay.toLocaleString("en-US")} tokens`;
    const m = el("div", "m"); const fill = el("i"); Object.assign(fill.style, { width: `${Math.max(3, pct * 100)}%`, background: meterColor(pct) }); m.append(fill);
    bar.append(m, el("span", "v", `${kfmt(g.usage.tokensToday)} / ${kfmt(g.budgets.maxTokensPerDay)}`)); use.append(bar); detail.append(use);

    // model choice — the USER decides which granted model this app runs on, regardless of what it
    // asks for (BYO-compute). Only meaningful when there's a choice (2+ granted models).
    if (g.models.length > 1) {
      const mrow = el("div", "drow");
      mrow.append(el("span", "k", "Runs on"));
      const sel = el("select", "modelsel") as HTMLSelectElement;
      const appOpt = el("option") as HTMLOptionElement; appOpt.value = ""; appOpt.textContent = "App's choice";
      sel.append(appOpt);
      for (const m of g.models) { const o = el("option") as HTMLOptionElement; o.value = m; o.textContent = m; sel.append(o); }
      sel.value = g.modelOverride ?? "";
      sel.onclick = (e) => e.stopPropagation();
      sel.onchange = (e) => {
        e.stopPropagation();
        if (inExtension) control("setModelOverride", { origin: g.origin, model: sel.value || null }).then(refresh);
      };
      mrow.append(sel); detail.append(mrow);
    }

    // trust + disconnect
    const foot = el("div", "drow");
    const seg = el("div", "modeseg");
    for (const [mode, label, warn] of [["ask", "Ask", false], ["trust", "Trust", false], ["readonly", "Read-only", true]] as Array<[Mode, string, boolean]>) {
      const on = (g.mode ?? "ask") === mode;
      const b = el("button", (on ? "on" : "") + (warn && on ? " warn" : ""), label);
      b.onclick = (e) => { e.stopPropagation(); if (inExtension) control("setMode", { origin: g.origin, mode }).then(refresh); };
      seg.append(b);
    }
    const dc = el("button", "disconnect", "Disconnect");
    dc.onclick = (e) => { e.stopPropagation(); if (inExtension) control("revoke", { origin: g.origin }).then(() => { openApps.delete(g.origin); refresh(); }); };
    foot.append(seg, dc); detail.append(foot);

    // pending consent (rare on the surface — usually the inline consent view takes over). One
    // "Review request" that opens the real consent view: the decision stays in ONE place, and a
    // broker UI never shows an Approve that does nothing.
    if (g.pending) {
      const pend = el("div", "pend");
      const t = el("div", "txt"); t.append(document.createTextNode("Wants to "), Object.assign(el("b"), { textContent: short(g.pending.tool) }));
      const review = el("button", "approve", "Review request →");
      review.onclick = async (e) => {
        e.stopPropagation();
        if (!inExtension) return;
        const r = await new Promise<{ pending?: Array<{ id: string; origin: string | null }> } | null>(
          (res) => chrome.runtime.sendMessage({ type: "getPendingConsents" }, res));
        const match = r?.pending?.find((p) => p.origin === g.origin) ?? r?.pending?.[0];
        if (match) void showConsent(match.id);
      };
      const btns = el("div", "btns"); btns.append(review);
      pend.append(t, btns); detail.append(pend);
    }
    card.append(detail);
    box.append(card);
  }
  if (ranked.length > 3) box.append(moreBtn("apps", `See all ${ranked.length} ▾`));
}

function renderActivity(data: PanelData) {
  const feed = $("feed"); feed.textContent = "";
  if (!data.audit.length) { feed.append(el("div", "empty-note", "Nothing yet.")); return; }
  const entries = data.audit.slice(0, 24);
  const expanded = expandedSections.has("feed");
  const shown = expanded ? entries : entries.slice(0, 8);
  for (const e of shown) {
    // dot semantics, explicit: denied → danger; a consent the user approved → ok; an actual tool
    // call → amber write; plain requests/sessions → neutral (a session is NOT a write).
    const denied = e.outcome === "denied";
    const cls = denied ? " deny" : e.kind === "consent" && e.decision === "user-approved" ? " ok" : e.kind === "tool_call" ? " write" : "";
    const row = el("div", `ev${cls}`);
    // humanised: 'claude_session' → 'session'; tool names stay short()
    const what = (e.toolName ? short(e.toolName) : (e.method ?? e.kind)).replace(/^claude[_ ]/, "").replace(/_/g, " ");
    row.append(el("div", "t", ago(e.ts)));
    const d = el("div", "d");
    d.append(Object.assign(el("b"), { textContent: appName(e.origin) }));
    if (denied) d.append(document.createTextNode(" · "), el("span", "dn", "denied"));
    d.append(document.createTextNode(` · ${what}`));
    row.append(d); feed.append(row);
  }
  if (!expanded && entries.length > 8) {
    const b = el("button", "more", `Show ${entries.length - 8} more ▾`);
    b.onclick = () => { expandedSections.add("feed"); if (lastData) render(lastData); };
    feed.append(b);
  }
}

// ---- context switcher overlay ----
// Contexts aren't only brands: projects, brands, data sources — any directory of work you own and
// can lend to an app. The picker GROUPS by kind so the taxonomy is visible and extensible; a new
// `kind` just forms its own group.
function contextCategory(c: ContextMeta): string {
  if (c.sourceKind) return "Data sources";
  const k = (c.kind || "").toLowerCase();
  if (!k || k === "context") return "Other";
  return k.charAt(0).toUpperCase() + k.slice(1) + (k.endsWith("s") ? "" : "s");
}
const CATEGORY_ORDER = ["Personal", "Projects", "Brands", "Data sources"]; // the rest fall in alphabetically after

function openPicker(data: PanelData, forOrigin: string | null = null) {
  const picker = $("picker") as HTMLElement; picker.hidden = false;
  const list = $("plist"); list.textContent = "";
  // Per-origin mode: ticks and clicks apply to ONE app's lend (the daemon's per-origin selection);
  // clearing it falls back to the default. Default mode edits the GLOBAL default, as before.
  const explicit = forOrigin ? (data.selections.find((s) => s.origin === forOrigin)?.contextId ?? null) : null;
  const tickedId = forOrigin ? (explicit ?? data.activeProject) : data.activeProject;
  if (forOrigin) list.append(el("div", "pgroup", `For this app · ${host(forOrigin)}`));

  const groups = new Map<string, ContextMeta[]>();
  for (const c of data.contexts) { const g = contextCategory(c); (groups.get(g) ?? groups.set(g, []).get(g)!).push(c); }
  const names = [...groups.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

  // Cold start: a fresh install has an empty library, so every proactive app opens with nothing to
  // work from. The way out is a POINTER, not a form — point at something you already have and it's
  // read for you. (The Bank connector still seeds a whole folder of projects in one shot; that's the
  // bulk path, mentioned second because it needs another Claude.)
  if (!data.contexts.length) {
    list.append(el("div", "empty-note", "Nothing to lend yet — point at your site, a repo or a folder below and it’s read for you. (Many at once? The Bank connector can seed the whole library from ~/Projects.)"));
  }

  for (const gname of names) {
    if (groups.size > 1) list.append(el("div", "pgroup", gname)); // header only when there's more than one kind
    const items = groups.get(gname)!;
    const gkey = `pgroup:${gname}`;
    const shownItems = items.length > 8 && !expandedSections.has(gkey) ? items.slice(0, 8) : items;
    for (const c of shownItems) {
      const item = el("button", "pitem" + (c.id === tickedId ? " on" : ""));
      // kind marks: brands keep the lime monogram; projects, data sources and the personal card get
      // quiet glyphs — the taxonomy reads without the group headers.
      const kindKey = c.sourceKind ? "data" : (c.kind || "").toLowerCase() === "project" ? "project" : (c.kind || "").toLowerCase() === "personal" ? "personal" : null;
      const mk = el("div", "mk" + (kindKey ? " kind" : ""));
      if (kindKey) mk.innerHTML = KIND_MARKS[kindKey]!;
      else mk.textContent = c.name[0]?.toUpperCase() ?? "•";
      item.append(mk);
      const txt = el("div"); txt.style.minWidth = "0"; txt.append(el("div", "nm", c.name));
      // No colour swatches in the picker — a context's palette is meaningful inside the app that
      // uses it, not as decoration here. A live data source keeps its row-count badge (that's status);
      // a project shows the folder it points at (lending it binds the app's storage there).
      if (c.sourceKind) txt.append(el("span", "badge", `live · ${c.rowCount ?? 0} rows`));
      else if (c.folder) txt.append(el("div", "path", c.folder));
      item.append(txt);
      if (c.id === tickedId) item.append(el("div", "tick", "✓"));
      item.onclick = () => {
        if (!inExtension) { picker.hidden = true; return; }
        const next = c.id === tickedId ? null : c.id;
        const done = forOrigin
          ? control("selectContext", { origin: forOrigin, contextId: next })
          : control("setActiveProject", { contextId: next });
        void done.then(() => { picker.hidden = true; refresh(); });
      };
      list.append(item);
    }
    if (items.length > 8 && !expandedSections.has(gkey)) {
      const b = el("button", "morebtn", `all ${items.length} ▾`);
      b.onclick = () => { expandedSections.add(gkey); openPicker(data, forOrigin); };
      list.append(b);
    }
  }
  renderAddProject(data, forOrigin);
  renderAddSheet();
  renderPersonalCard(data);
  renderAddRow(data, forOrigin);
}

// ---- the three pointers: point at a website, a repo, or a folder → one banked context ----
// Doctrine: ONE pointer, then WHAT WE FOUND, then confirm — never a blank form asking the user to
// describe their own brand. The panel owns the FOLDER pointer end to end (it needs no model and no
// network: the path is the whole input, and the daemon binds it to an app the moment you lend it).
// Reading a WEBSITE or a REPO needs the user's Claude plus its web tools — a capability only a
// connected page has; the panel has a control channel, not a session. So those two hand the pointer
// to Switchboard home with it prefilled, and the copy says exactly that rather than implying the
// panel can read the web. The published shape is identical either way (see docs/CONTEXT-KINDS.md),
// so a context is the same object whichever surface pointed at it.
type Pointer = "site" | "github" | "folder";
let addPointer: Pointer | null = null;
const pointerDraft: Record<Pointer, string> = { site: "", github: "", folder: "" }; // survives re-renders
let folderDraft: { path: string; name: string } | null = null;        // set once a folder is pointed at
let addedReady: { name: string; kind: "brand" | "project"; folder?: string } | null = null; // the ready card

/** Switchboard home — the surface that CAN read a site or a repo (it runs on the user's Claude). */
const HOME_URL = "https://thelastprompt.ai/apps/";
/** The handoff contract: home opens straight into the pointer flow with this already filled in. */
const handoff = (kind: Pointer, value: string) =>
  `${HOME_URL}?add=${kind}&${kind === "folder" ? "path" : "url"}=${encodeURIComponent(value)}`;

const PT_ICONS: Record<Pointer, string> = {
  site: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="5.5" r="2.5"/><circle cx="7" cy="18.5" r="2.5"/><circle cx="17" cy="8" r="2.5"/><path d="M7 8v8M17 10.5c0 3-3.4 3.2-6.4 4.2"/></svg>`,
  folder: KIND_MARKS.project!,
};

/** Which wrapps light up for a freshly banked context — each one really does request this kind at
 *  connect (`contextKinds` in its scope), so the promise is checkable, not marketing. */
const LIGHTS_UP: Record<"brand" | "project", Array<{ name: string; url: string }>> = {
  brand: [
    { name: "Prism", url: "https://prism.thelastprompt.ai" },
    { name: "Cast", url: "https://cast.thelastprompt.ai" },
    { name: "AdForge", url: "https://adforge.thelastprompt.ai" },
    { name: "Ad generator", url: "https://adgen.thelastprompt.ai" },
    { name: "A-Plus", url: "https://aplus.thelastprompt.ai" },
    { name: "Bank", url: "https://bank.thelastprompt.ai" },
  ],
  project: [
    { name: "Bank", url: "https://bank.thelastprompt.ai" },
    { name: "Redline", url: `${HOME_URL}redline.html` },
    { name: "Huddle", url: `${HOME_URL}huddle.html` },
    { name: "betterchat", url: `${HOME_URL}chat.html` },
    { name: "Cartridge", url: "https://cartridge.thelastprompt.ai" },
    { name: "Arcana", url: "https://arcana.thelastprompt.ai" },
  ],
};

/** Stable id from a pointer: the same site/repo/folder pointed at twice UPDATES in place, so the
 *  library never fills with duplicates of one thing (docs/CONTEXT-KINDS.md, "stable id"). */
const slugOf = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
/** A human name from a folder path: the basename, de-slugged. "~/Projects/redline" → "Redline". */
const folderBase = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "";
const folderName = (p: string) => folderBase(p).replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** A pasted website, normalized. Bare hosts get https://; anything without a dotted host is a typo. */
function normalizeSite(raw: string): { url: string; domain: string } | null {
  const v = raw.trim();
  if (!v) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".") || u.hostname.endsWith(".")) return null;
  return { url: u.toString(), domain: u.hostname.replace(/^www\./, "") };
}

/** A pasted GitHub repo, normalized: `github.com/o/r`, `.../tree/main/x`, `git@github.com:o/r.git`
 *  and bare `o/r` all collapse to one canonical repo URL. Anything off GitHub returns null — that's
 *  a typo to correct in place, never a dead end. */
function normalizeRepo(raw: string): { owner: string; repo: string; url: string } | null {
  let v = raw.trim().replace(/\.git$/i, "");
  if (!v) return null;
  const scp = /^git@([^:]+):(.+)$/.exec(v);                       // git@github.com:owner/repo
  if (scp) {
    if (!/^(www\.)?github\.com$/i.test(scp[1]!)) return null;
    v = `https://github.com/${scp[2]}`;
  } else if (!/^https?:\/\//i.test(v)) {
    // no scheme: a first segment without a dot is a bare owner/repo, otherwise it's a bare host
    v = (v.split("/")[0] ?? "").includes(".") ? `https://${v}` : `https://github.com/${v}`;
  }
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!, repo = parts[1]!.replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

// One quiet "Add" row that opens the pointer chooser. The three legacy forms (folder / sheet / your
// details) are still here — folder IS the third pointer, the other two moved behind "Other ways".
function renderAddRow(data: PanelData, forOrigin: string | null) {
  const row = $("addRow") as HTMLElement; row.className = "addsrc"; row.textContent = "";

  // Just banked something → the row becomes the READY card ("it's yours, here's what can use it").
  if (addedReady) { row.append(readyCard(data, forOrigin)); showAddForms(false, false); renderOtherWays(data, forOrigin, false); return; }

  const open = expandedSections.has("pickerAdd");
  const t = el("button", "toggle", open ? "− Hide" : "＋ Add — point at a website, a repo or a folder");
  t.onclick = () => {
    if (open) expandedSections.delete("pickerAdd"); else { expandedSections.add("pickerAdd"); addPointer = addPointer ?? "site"; }
    openPicker(data, forOrigin);
  };
  row.append(t);
  if (open) {
    row.append(el("div", "ptlead", "Point Switchboard at something you already have. It’s read on your own Claude, on this machine — nothing is uploaded and the operator never sees it."));
    const seg = el("div", "ptseg");
    for (const [key, label] of [["site", "Website"], ["github", "GitHub"], ["folder", "Folder"]] as Array<[Pointer, string]>) {
      const b = el("button", addPointer === key ? "on" : "");
      const ic = el("span"); ic.innerHTML = PT_ICONS[key];
      b.append(ic, el("span", "", label));
      b.onclick = () => {
        addPointer = key; folderDraft = null;
        openPicker(data, forOrigin);
        (document.getElementById("ptInput") as HTMLInputElement | null)?.focus();
      };
      seg.append(b);
    }
    row.append(seg);
    if (addPointer === "site" || addPointer === "github") row.append(webPointer(addPointer, data, forOrigin));
    // the folder pointer renders into #addProject below (keeping that id and its saveContext wiring)
  }
  showAddForms(open && addPointer === "folder", open && expandedSections.has("pickerOther"));
  renderOtherWays(data, forOrigin, open);
}

function showAddForms(folder: boolean, other: boolean) {
  ($("addProject") as HTMLElement).hidden = !folder;
  ($("addSheet") as HTMLElement).hidden = !other;
  ($("addPersonal") as HTMLElement).hidden = !other;
}

// The two web pointers. The panel validates and normalizes the URL here — a typo is corrected in
// place, never carried into a tab that then fails — and hands the clean pointer to home.
function webPointer(kind: "site" | "github", data: PanelData, forOrigin: string | null): HTMLElement {
  const box = el("div", "ptbody");
  const inp = el("input") as HTMLInputElement;
  inp.id = "ptInput"; inp.spellcheck = false; inp.value = pointerDraft[kind];
  inp.placeholder = kind === "site" ? "your-brand.com" : "github.com/owner/repo";
  const hint = el("div", "hint", kind === "site"
    ? "Your Claude reads the page and drafts the brand — name, one-liner, positioning, voice, audience, products, colours it can actually see. You pick a reading and tweak it; nothing is banked until you confirm."
    : "Your Claude reads the README and package.json and drafts the project — what it is, its stack, where it is now, what’s next. You pick a reading and tweak it; nothing is banked until you confirm.");
  const err = el("div", "err");
  const go = el("button", "go", "Read it →");
  const note = el("div", "ptnote", "Opens Switchboard home in a tab — reading the web needs your Claude and its web tools, which the panel can’t run on its own. The reading happens on your machine; the context lands back in this list.");
  const submit = () => {
    const v = inp.value.trim();
    if (!v) { err.textContent = kind === "site" ? "Paste your site’s address." : "Paste a GitHub repo URL."; inp.focus(); return; }
    const target = kind === "site" ? normalizeSite(v) : normalizeRepo(v);
    if (!target) {
      err.textContent = kind === "site"
        ? "That doesn’t look like a website — try nailin.it or https://nailin.it."
        : "That isn’t a GitHub repo URL — try github.com/owner/repo.";
      inp.focus(); inp.select(); return;
    }
    err.textContent = "";
    openWrapp(handoff(kind, target.url));
  };
  inp.oninput = () => { pointerDraft[kind] = inp.value; err.textContent = ""; };
  inp.onkeydown = (e) => { if ((e as KeyboardEvent).key === "Enter") submit(); };
  go.onclick = submit;
  box.append(inp, hint, err, go);
  // The one recovery worth designing for: a private repo is invisible to an anonymous reader, but
  // the clone on this machine isn't. Hand the user straight to the folder pointer.
  if (kind === "github") {
    const alt = el("button", "ghost", "Private repo? Point at the local clone →");
    alt.onclick = () => { addPointer = "folder"; openPicker(data, forOrigin); (document.getElementById("ptInput") as HTMLInputElement | null)?.focus(); };
    box.append(alt);
  }
  box.append(note);
  return box;
}

// The FOLDER pointer (still #addProject — same id, same saveContext wiring). Two beats: point at a
// path, then confirm what we made of it. The name is DERIVED from the folder and editable — the user
// confirms, they don't author. Panel-authored like the personal card: the user is the trusted author,
// so no per-action consent (pointing your own app at your own folder is your call), and the daemon's
// own bind consent still fires when the project is lent to an app.
function renderAddProject(data: PanelData, forOrigin: string | null) {
  const box = $("addProject"); box.className = "addsrc open"; box.textContent = "";
  const form = el("div", "form");

  if (!folderDraft) {
    const path = el("input") as HTMLInputElement;
    path.id = "ptInput"; path.spellcheck = false; path.value = pointerDraft.folder;
    path.placeholder = "~/Projects/redline";
    const hint = el("div", "hint", "Nothing is fetched and nothing leaves this machine — the path is the whole input. Lend the project to an app and the daemon points that app’s storage at this exact folder, so it reads and writes your real files.");
    const err = el("div", "err");
    const go = el("button", "go", "Point at it");
    const submit = () => {
      const p = path.value.trim().replace(/[\\/]+$/, "");
      if (!p) { err.textContent = "Paste the folder’s path."; path.focus(); return; }
      if (!folderBase(p)) { err.textContent = "That path has no folder name — point at a folder, not the root."; path.focus(); return; }
      pointerDraft.folder = p;
      folderDraft = { path: p, name: folderName(p) || folderBase(p) };
      openPicker(data, forOrigin);
    };
    path.oninput = () => { pointerDraft.folder = path.value; err.textContent = ""; };
    path.onkeydown = (e) => { if ((e as KeyboardEvent).key === "Enter") submit(); };
    go.onclick = submit;
    form.append(path, hint, err, go);
  } else {
    const draft = folderDraft;
    const card = el("div", "ptconfirm");
    card.append(el("div", "k", "Found"));
    const name = el("input") as HTMLInputElement; name.value = draft.name; name.placeholder = "Project name";
    card.append(name, el("div", "path", draft.path));
    const again = el("button", "ghost", "Point somewhere else");
    again.onclick = () => { folderDraft = null; openPicker(data, forOrigin); };
    card.append(again);
    const hint = el("div", "hint", forOrigin
      ? `Banked as a project. Added here it’s lent to ${host(forOrigin)} right away — that app reads & writes these files.`
      : "Banked as a project. Lend it to an app and that app reads & writes these files.");
    const err = el("div", "err");
    const go = el("button", "go", "Add project");
    go.onclick = async () => {
      const nm = name.value.trim();
      if (!nm) { err.textContent = "Give it a name."; return; }
      err.textContent = ""; go.setAttribute("disabled", "true");
      // Same published shape as home's folder pointer: `folder` is what makes lending bind storage,
      // `source` records what was pointed at and by whom.
      const payload = {
        id: slugOf(folderBase(draft.path)) || slugOf(nm),
        name: nm,
        kind: "project",
        data: { folder: draft.path, source: { kind: "folder", path: draft.path, readAt: Date.now(), by: "switchboard-panel" } },
      };
      const r = inExtension
        ? ((await control("saveContext", payload)) as { ok?: boolean; id?: string; error?: string })
        : { ok: true, id: payload.id };
      go.removeAttribute("disabled");
      if (!r?.ok) { err.textContent = r?.error || "Couldn’t add that project."; return; }
      // In per-app mode, lend the new project to that app immediately (this binds its folder).
      if (forOrigin && r.id && inExtension) await control("selectContext", { origin: forOrigin, contextId: r.id });
      addedReady = { name: nm, kind: "project", folder: draft.path };
      folderDraft = null; pointerDraft.folder = "";
      const fresh = inExtension ? await load() : data;
      render(fresh);
      // Stay in the sheet — the ready card is the payoff. Unless a consent landed mid-add: that view
      // owns the panel, so close the sheet and let the ready card wait for the next open.
      if (consentActive) (($("picker") as HTMLElement).hidden = true);
      else openPicker(fresh, forOrigin);
    };
    // The panel banks the pointer; reading what's INSIDE the folder is a Claude job, so offer it.
    const deep = el("button", "ghost", "Read what’s in it with your Claude →");
    deep.onclick = () => openWrapp(handoff("folder", draft.path));
    form.append(card, hint, err, go, deep);
  }
  box.append(form);
}

// "Banked — <name>", and the honest answer to "so what?": the wrapps that can use it right now.
function readyCard(data: PanelData, forOrigin: string | null): HTMLElement {
  const r = addedReady!;
  const card = el("div", "ptready");
  card.append(el("div", "h", `Banked — ${r.name}`));
  card.append(el("div", "ptlead", r.folder
    ? `It’s in your library as a project. Lend it to an app and that app’s storage points at ${r.folder} — it reads and writes those real files, not a sandbox copy.`
    : "It’s in your library. Lend it to an app and that app works from it."));
  card.append(el("div", "k", "Ready to use it"));
  const lights = el("div", "lights");
  for (const w of LIGHTS_UP[r.kind]) {
    const b = el("button", "", w.name);
    b.onclick = () => openWrapp(w.url);
    lights.append(b);
  }
  card.append(lights);
  const done = el("button", "go", "Done");
  done.onclick = () => { addedReady = null; (($("picker") as HTMLElement).hidden = true); refresh(); };
  const more = el("button", "ghost", "Point at something else");
  more.onclick = () => { addedReady = null; addPointer = "site"; expandedSections.add("pickerAdd"); openPicker(lastData ?? data, forOrigin); };
  card.append(done, more);
  return card;
}

// The two panel-authored forms that aren't pointers (a published Sheet, your own contact card) —
// still here, one level quieter, so the three pointers stay the headline.
function renderOtherWays(data: PanelData, forOrigin: string | null, addOpen: boolean) {
  const box = $("addOther") as HTMLElement; box.className = "addsrc"; box.textContent = "";
  box.hidden = !addOpen;
  if (!addOpen) return;
  const open = expandedSections.has("pickerOther");
  const t = el("button", "toggle", open ? "− Hide other ways" : "Other ways — a Google Sheet · your own details");
  t.onclick = () => { expandedSections[open ? "delete" : "add"]("pickerOther"); openPicker(data, forOrigin); };
  box.append(t);
}

// "Your details" — the personal context card (kind "personal"): name, phone, email, address,
// company. Panel-authored, stored in the same library as every other context, and an app only
// receives it when the user LENDS it — contact info never flows implicitly.
function renderPersonalCard(data: PanelData) {
  const box = $("addPersonal"); box.className = "addsrc"; box.textContent = "";
  const existing = data.contexts.find((c) => (c.kind || "").toLowerCase() === "personal") || null;
  const toggle = el("button", "toggle", existing ? "✎ Your details (personal card)" : "＋ Your details (name, phone, email…)");
  const form = el("div", "form");
  const f = (ph: string) => { const i = el("input") as HTMLInputElement; i.placeholder = ph; return i; };
  const nameI = f("Full name"), phoneI = f("Phone"), emailI = f("Email"), companyI = f("Company / brand"), addressI = f("Address"), notesI = f("Notes (GST, hours, anything an app may need)");
  const err = el("div", "err");
  const go = el("button", "go", existing ? "Save details" : "Add your details");
  toggle.onclick = async () => {
    box.className = "addsrc open";
    if (existing && inExtension) {
      const r = (await control("getContext", { contextId: existing.id })) as { ok?: boolean; context?: { data?: Record<string, unknown> } };
      const d = (r?.context?.data ?? {}) as Record<string, unknown>;
      nameI.value = String(d.fullName ?? existing.name ?? ""); phoneI.value = String(d.phone ?? "");
      emailI.value = String(d.email ?? ""); companyI.value = String(d.company ?? "");
      addressI.value = String(d.address ?? ""); notesI.value = String(d.notes ?? "");
    }
  };
  go.onclick = async () => {
    const nm = nameI.value.trim();
    if (!nm) { err.textContent = "At least your name."; return; }
    err.textContent = "";
    const payload = {
      id: existing?.id, name: nm, kind: "personal",
      data: { fullName: nm, phone: phoneI.value.trim(), email: emailI.value.trim(), company: companyI.value.trim(), address: addressI.value.trim(), notes: notesI.value.trim() },
    };
    const r = inExtension ? ((await control("saveContext", payload)) as { ok?: boolean; error?: string }) : { ok: true };
    if (!r?.ok) { err.textContent = r?.error || "Couldn't save."; return; }
    (($("picker") as HTMLElement).hidden = true); refresh();
  };
  form.append(nameI, phoneI, emailI, companyI, addressI, notesI, err, go);
  if (existing) {
    const del = el("button", "toggle", "Remove this card");
    del.onclick = async () => { if (inExtension) await control("deleteContext", { contextId: existing.id }); (($("picker") as HTMLElement).hidden = true); refresh(); };
    form.append(del);
  }
  box.append(toggle, form);
}

// "Connect a Google Sheet": paste a published CSV link → it becomes a live project other apps can read.
function renderAddSheet() {
  const box = $("addSheet"); box.className = "addsrc"; box.textContent = "";
  const toggle = el("button", "toggle", "＋ Connect a Google Sheet");
  toggle.onclick = () => (box.className = "addsrc open");
  const form = el("div", "form");
  const name = el("input") as HTMLInputElement; name.placeholder = "Name (e.g. Vendor book)";
  const url = el("input") as HTMLInputElement; url.placeholder = "Published CSV URL (File → Share → Publish to web → CSV)";
  const hint = el("div", "hint", "In Google Sheets: File → Share → Publish to web → choose the tab → Comma-separated values (.csv). Paste that link.");
  const err = el("div", "err");
  const go = el("button", "go", "Add data source");
  go.onclick = async () => {
    const n = name.value.trim(), u = url.value.trim();
    if (!n || !u) { err.textContent = "Add a name and a CSV URL."; return; }
    err.textContent = "Fetching…"; go.setAttribute("disabled", "true");
    const r = inExtension ? await control("addSourceContext", { name: n, url: u, kind: "gsheet" }) : { ok: true, rowCount: 0 };
    go.removeAttribute("disabled");
    if (!r?.ok) { err.textContent = r?.error || "Couldn’t read that sheet."; return; }
    (($("picker") as HTMLElement).hidden = true); refresh();
  };
  form.append(name, url, hint, err, go);
  box.append(toggle, form);
}
// Closing the sheet drops the in-flight pointer state (a half-typed folder, the ready card) so the
// next open starts clean — `expandedSections` and the chosen pointer persist, as everywhere else.
$("pickerClose").addEventListener("click", () => {
  folderDraft = null; addedReady = null;
  ($("picker") as HTMLElement).hidden = true;
});

// ---- open any URL ----
function openTyped() {
  const inp = $("openUrlInput") as HTMLInputElement;
  const v = inp.value.trim();
  if (!v) return;
  openWrapp(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  inp.value = "";
}
$("openUrlBtn").addEventListener("click", openTyped);
$("openUrlInput").addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") openTyped(); });
// The full Wrapp Store (use-case categories, stacks, search) opens as its own page.
$("browseStore").addEventListener("click", () => openWrapp("https://thelastprompt.ai/apps/"));

// ---- header menu ----
$("menuBtn").addEventListener("click", (e) => { e.stopPropagation(); const m = $("menu") as HTMLElement; m.hidden = !m.hidden; });
document.addEventListener("click", (e) => { const m = $("menu") as HTMLElement; if (!m.hidden && !m.contains(e.target as Node) && (e.target as HTMLElement).id !== "menuBtn") m.hidden = true; });
$("menuName").addEventListener("click", async () => {
  ($("menu") as HTMLElement).hidden = true;
  const cur = inExtension ? await control("getProfile") : { profile: { name: "" } };
  const name = window.prompt("What should apps call you? (used for the “Hi …” greeting)", cur?.profile?.name || "");
  if (name && name.trim() && inExtension) { await control("setProfile", { name: name.trim() }); refresh(); }
});
$("menuActivity").addEventListener("click", () => { ($("menu") as HTMLElement).hidden = true; const a = $("activity") as HTMLDetailsElement; a.open = true; a.scrollIntoView({ behavior: "smooth" }); });
$("menuKill").addEventListener("click", async () => { ($("menu") as HTMLElement).hidden = true; if (inExtension) { await new Promise((r) => chrome.runtime.sendMessage({ type: "killSwitch" }, r)); refresh(); } });

async function refresh() { if (!consentActive) render(await load()); }

// Coalesce bursts of daemon events (a connect fires several) into one re-pull. Never clobbers an
// open consent — refresh() guards on consentActive — and preserves expanded apps via `openApps`.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh() {
  if (refreshTimer != null) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(); }, 160);
}

// ---- inline consent + live state (the panel stays in sync without being reopened) ----
// The port is SELF-HEALING. MV3 evicts the service worker when idle; that kills this long-lived
// port, and a dead port silently drops the consent/state pushes the worker sends when it wakes on
// the next request (e.g. an app connecting) — which is exactly why the panel used to need a
// close/reopen. So on disconnect we reconnect and re-pull: the panel repairs itself in place.
if (inExtension) {
  const connectPort = () => {
    const port = chrome.runtime.connect({ name: "relay-panel" });
    port.onMessage.addListener((m: { type: string; id: string; payload?: any }) => {
      if (m.type === "consent:new") void showConsent(m.id);
      else if (m.type === "state:changed") scheduleRefresh(); // a grant/pick/permission change landed
    });
    port.onDisconnect.addListener(() => {
      // Worker went away. Reconnect (which wakes it), then refresh so we catch anything missed while
      // the port was down. A short delay avoids a tight loop if the worker is mid-restart.
      setTimeout(connectPort, 300);
      scheduleRefresh();
    });
    // On (re)connect, background re-pushes any queued consent; pull fresh state to match.
    scheduleRefresh();
  };
  connectPort();
  // The side panel document survives window/tab switches (it just hides). On re-show, pull fresh
  // state in case an event arrived while the worker couldn't reach us.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleRefresh(); });
  // Keep the "This tab" card in step with the active tab — switching or navigating re-evaluates it.
  const reSite = () => { if (lastData) void renderCurrentSite(lastData); };
  chrome.tabs?.onActivated.addListener(reSite);
  chrome.tabs?.onUpdated.addListener((_id, info) => { if (info.status === "complete" || info.url) reSite(); });
}
async function showConsent(id: string) {
  const prompt = await new Promise<Prompt | null>((r) => chrome.runtime.sendMessage({ type: "getConsentPrompt", id }, r));
  if (!prompt) return;
  consentActive = true;
  const box = $("consent");
  ($("home") as HTMLElement).hidden = true;
  ($("pairing") as HTMLElement).hidden = true;
  ($("setup") as HTMLElement).hidden = true;
  box.hidden = false;
  // A consent prompt only exists because the daemon reached us — so the status is "on", never the
  // stale "connecting…" (render() early-returns while consentActive, so set it here directly).
  $("status").className = "status on"; ($("statusText") as HTMLElement).textContent = "on";
  renderConsent(box, prompt, (result) => {
    chrome.runtime.sendMessage({ type: "consentDecision", id, result }, () => {
      box.hidden = true; box.textContent = ""; consentActive = false;
      refresh();
    });
  });
}

// ---- pairing ----
async function pair() {
  if (!inExtension) return;
  const token = ($("token") as HTMLInputElement).value.trim();
  if (token) await new Promise((r) => chrome.runtime.sendMessage({ type: "pair", token }, r));
  const err = $("pairErr"); err.className = "err calm"; err.textContent = "Connecting…";
  setTimeout(refresh, 600); // the auth_ok health push also flips the panel live — this is a backstop
}
$("pairBtn")?.addEventListener("click", pair);
$("token")?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") pair(); });

// ---- first-run setup card (daemon unreachable, nothing paired) ----
// The landing page explains extension + sidekick together — it stays the one "full setup" link.
$("getSidekick")?.addEventListener("click", () => {
  if (inExtension) chrome.runtime.sendMessage({ type: "openUrl", url: "https://thelastprompt.ai/switchboard/" });
  else window.open("https://thelastprompt.ai/switchboard/", "_blank", "noopener");
});
// Retry is a courtesy — the auth_ok health push flips the panel on its own once the daemon wakes.
$("setupRetry")?.addEventListener("click", () => void refresh());

// Design preview (serve.mjs, outside the extension): ?state=consent | consent-fat renders a
// representative connect prompt in the real panel chrome, so the consent layout can be iterated
// at true side-panel width without a live daemon. No effect inside the extension.
function previewConsent(fat: boolean) {
  const base = ["WebSearch", "WebFetch"].map((n) => ({ name: n, access: "read" as const, label: n }));
  const w = (server: string, tool: string) => ({ name: `mcp__claude_ai_${server}__${tool}`, access: "write" as const, label: tool });
  const tools = fat
    ? [...base,
        w("Higgsfield", "generate_image"), w("Higgsfield", "generate_video"), w("Higgsfield", "generate_audio"),
        w("Shopify", "update_product"), w("Shopify", "create_discount"), w("Shopify", "set_inventory"),
        { name: "mcp__claude_ai_Gmail__search", access: "read" as const, label: "search" }, w("Gmail", "create_draft"),
        { name: "mcp__claude_ai_ClickUp__get_task", access: "read" as const, label: "get_task" }, w("ClickUp", "create_task"),
        w("Notion", "update_page"), { name: "mcp__claude_ai_Notion__search", access: "read" as const, label: "search" },
        w("Meta", "create_ad"), w("Meta", "update_campaign")]
    : [...base, w("Higgsfield", "generate_image"), w("Shopify", "update_product"), w("Gmail", "create_draft")];
  const mockPrompt: Prompt = { kind: "consent:connect", body: {
    origin: "https://brandbrain.thelastprompt.ai",
    reason: "brandbrain — launch & growth hub for consumer brands",
    models: { available: ["sonnet", "opus", "haiku", "gpt-4o", "llama3.2:latest", "qwen2.5"], requested: ["sonnet"] },
    tools,
    budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 },
    contextKinds: ["brands", "projects"],
  } };
  consentActive = true;
  const box = $("consent");
  ($("home") as HTMLElement).hidden = true;
  box.hidden = false;
  $("status").className = "status on"; ($("statusText") as HTMLElement).textContent = "on";
  renderConsent(box, mockPrompt, () => { box.hidden = true; box.textContent = ""; consentActive = false; void refresh(); });
}
const previewState = !inExtension ? new URLSearchParams(location.search).get("state") : null;
if (previewState === "consent" || previewState === "consent-fat") previewConsent(previewState === "consent-fat");
else refresh();
