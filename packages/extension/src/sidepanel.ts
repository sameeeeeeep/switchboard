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
  tools: { name: string; access: "read" | "write" }[];
  budgets: { maxTokensPerDay: number; maxCallsPerMin: number };
  usage: { tokensToday: number; callsThisMinute: number };
  storage?: { folder: string; autoAssigned: boolean; count: number } | null;
  pending?: { tool: string; args: Record<string, unknown> } | null;
}
interface AuditEntry { ts: number; origin: string; method?: string; toolName?: string; kind: string; decision?: string; outcome: string; }
interface ContextMeta { id: string; name: string; kind?: string; publishedBy?: string; updatedAt: number; swatches?: string[]; sourceKind?: "csv" | "gsheet"; rowCount?: number }
interface PanelData { paired: boolean; reachable: boolean; grants: Grant[]; audit: AuditEntry[]; contexts: ContextMeta[]; activeProject: string | null; }

import { renderConsent, type Prompt } from "./consent-view.js";

const inExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
let consentActive = false;
const openApps = new Set<string>(); // origins whose detail is expanded (preserved across refreshes)

// ---- friendly connector identities (framed as capabilities, not raw tool names) ----
const CONNECTORS: Record<string, { label: string; color: string; hint: string }> = {
  higgsfield: { label: "Higgsfield", color: "#EE46BC", hint: "images" },
  shopify: { label: "Shopify", color: "#95BF47", hint: "store" },
  gmail: { label: "Gmail", color: "#EA4335", hint: "email" },
  drive: { label: "Drive", color: "#1FA463", hint: "files" },
  sheets: { label: "Sheets", color: "#1FA463", hint: "data" },
  meta: { label: "Meta Ads", color: "#1264FF", hint: "ads" },
  web: { label: "Web", color: "#4F8CFF", hint: "search" },
};
function connectorOf(tool: string): { key: string; label: string; color: string; hint: string } | null {
  if (/^web(search|fetch)$/i.test(tool)) return { key: "web", ...CONNECTORS.web! };
  const m = tool.match(/mcp__claude_ai_([A-Za-z0-9]+)/i) || tool.match(/^([a-z]+)__/i);
  const raw = (m?.[1] || "").toLowerCase();
  if (!raw) return null;
  for (const key of Object.keys(CONNECTORS)) if (raw.includes(key)) return { key, ...CONNECTORS[key]! };
  return { key: raw, label: raw[0]!.toUpperCase() + raw.slice(1), color: "#C8F250", hint: "" };
}

// ---- wrapp store: a static registry of launchable apps (a real registry replaces this later) ----
// `alternativeTo` lists sites this wrapp can stand in for — so when you're on a site that hasn't
// opted into Switchboard (e.g. canva.com), the panel can offer a wrapp you CAN run on your own
// compute, context and data.
interface Wrapp { name: string; desc: string; url: string; color: string; alternativeTo?: string[] }
const WRAPPS: Wrapp[] = [
  { name: "brandbrain", desc: "Build & operate consumer brands", url: "https://brandbrain.thelastprompt.ai/build", color: "#C8F250" },
  { name: "AdPulse", desc: "Meta ads post-mortem in 30 seconds", url: "https://adpulse.thelastprompt.ai", color: "#FFB224", alternativeTo: ["adsmanager.facebook.com"] },
  { name: "AdForge", desc: "URL in, Meta ads out", url: "https://adforge.thelastprompt.ai", color: "#FF6A2B", alternativeTo: ["adcreative.ai"] },
  { name: "Shelf", desc: "Your inventory, triaged", url: "https://shelf.thelastprompt.ai", color: "#E8B34B" },
  { name: "Studio", desc: "Product shots without the studio", url: "https://studio.thelastprompt.ai", color: "#E4572E", alternativeTo: ["photoroom.com", "pebblely.com"] },
  { name: "A-Plus", desc: "Amazon A+ content in one pass", url: "https://aplus.thelastprompt.ai", color: "#F0B429" },
  { name: "NATAL", desc: "Your chart, read bluntly", url: "https://natal.thelastprompt.ai", color: "#EDEDF5", alternativeTo: ["costarastrology.com"] },
  { name: "Arcana", desc: "Three cards, no mercy", url: "https://arcana.thelastprompt.ai", color: "#C9A227" },
  { name: "Cartridge", desc: "Form → playable game", url: "https://cartridge.thelastprompt.ai", color: "#FF2E97" },
  { name: "Cast", desc: "AI personas that stay on-model", url: "http://localhost:5174/persona.html", color: "#FF5A3C", alternativeTo: ["spira.ai", "app.spira.ai", "arcads.ai", "captions.ai"] },
  { name: "Prism", desc: "Generate on-brand images", url: "http://localhost:5174/imagegen.html", color: "#4F46E5", alternativeTo: ["canva.com", "figma.com", "adobe.com", "leonardo.ai"] },
  { name: "Ad generator", desc: "Ads from your brand", url: "http://localhost:5174/adgen.html", color: "#EE46BC", alternativeTo: ["business.facebook.com", "ads.tiktok.com"] },
];
function openWrapp(url: string) {
  try { if (inExtension && chrome.tabs?.create) { chrome.tabs.create({ url }); return; } } catch { /* fall through */ }
  window.open(url, "_blank", "noopener");
}

const MOCK: PanelData = {
  paired: true, reachable: true,
  contexts: [
    { id: "aamras", name: "Aamras", kind: "brand", updatedAt: Date.now() - 3_600_000, swatches: ["#8B1A1A", "#F4A000", "#0D0D0D", "#D4C89A"] },
    { id: "haazma", name: "Haazma", kind: "brand", updatedAt: Date.now() - 86_400_000, swatches: ["#F5A623", "#6B2737", "#3D7D4E", "#F5F0E8"] },
    { id: "piqual", name: "Piqual", kind: "brand", updatedAt: Date.now() - 200_000_000, swatches: ["#7AB648", "#F4F1E8", "#1C1C1A", "#C8A84B"] },
    { id: "sheet1", name: "Vendor book (Sheet)", kind: "csv", updatedAt: Date.now() - 600_000, sourceKind: "gsheet", rowCount: 42 },
  ],
  activeProject: "aamras",
  // (a Sheet-backed project shows up alongside brand projects — same picker, marked "live")
  grants: [
    { origin: "https://brandbrain.app", mode: "trust", models: ["sonnet"], tools: [{ name: "WebSearch", access: "read" }, { name: "WebFetch", access: "read" }, { name: "mcp__claude_ai_Higgsfield__*", access: "write" }, { name: "mcp__claude_ai_Shopify__*", access: "write" }],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 148_200, callsThisMinute: 4 }, storage: { folder: "/Users/you/Projects/brandbrain/.data", autoAssigned: false, count: 6 }, pending: null },
    { origin: "https://prism.app", mode: "ask", models: ["sonnet"], tools: [{ name: "mcp__claude_ai_Higgsfield__*", access: "write" }],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 12_400, callsThisMinute: 1 }, storage: { folder: "~/.relay/storage/prism", autoAssigned: true, count: 0 },
      pending: { tool: "mcp__claude_ai_Higgsfield__generate_image", args: {} } },
  ],
  audit: [
    { ts: Date.now() - 9_000, origin: "https://brandbrain.app", toolName: "claude_session", kind: "request", outcome: "ok" },
    { ts: Date.now() - 44_000, origin: "https://prism.app", toolName: "mcp__claude_ai_Higgsfield__generate_image", kind: "consent", decision: "user-approved", outcome: "ok" },
    { ts: Date.now() - 240_000, origin: "https://brandbrain.app", toolName: "claude_context__publish", kind: "tool_call", decision: "auto-approved", outcome: "ok" },
  ],
};

const $ = (id: string) => document.getElementById(id)!;
const el = (tag: string, cls?: string, text?: string) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));
const host = (o: string) => { try { return new URL(o.includes("://") ? o : `https://${o}`).host; } catch { return o; } };
const meterColor = (pct: number) => (pct < 0.5 ? "var(--lime)" : pct < 0.8 ? "var(--warn)" : "var(--danger)");
const ago = (ts: number) => { const s = Math.round((Date.now() - ts) / 1000); if (s < 60) return `${s}s ago`; const m = Math.round(s / 60); if (m < 60) return `${m}m ago`; return `${Math.round(m / 60)}h ago`; };
const short = (name: string) => name.includes("__") ? name.split("__").pop()!.replace(/[-_*]/g, " ").trim() : name;

/** A human name for an app from its origin. Real domains → the memorable label; local dev → "Local app". */
const KNOWN: Record<string, string> = { "127.0.0.1:5178": "brandbrain", "localhost:5178": "brandbrain", "localhost:5174": "Prism", "127.0.0.1:5174": "Prism" };
function appName(origin: string): string {
  const h = host(origin);
  if (KNOWN[h]) return KNOWN[h]!;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(h)) return "Local app";
  const parts = h.replace(/^www\./, "").split(".");
  return parts.length >= 2 ? parts[parts.length - 2]! : h;
}

function control(action: string, args?: unknown): Promise<any> {
  return new Promise((res) => chrome.runtime.sendMessage({ type: "control", action, args }, res));
}

async function load(): Promise<PanelData> {
  if (!inExtension) return MOCK;
  const status = await new Promise<any>((r) => chrome.runtime.sendMessage({ type: "getStatus" }, r));
  if (!status?.paired) return { paired: false, reachable: false, grants: [], audit: [], contexts: [], activeProject: null };
  if (!status?.reachable) return { paired: true, reachable: false, grants: [], audit: [], contexts: [], activeProject: null };
  const g = await control("listGrants");
  const a = await control("audit", { limit: 40 });
  const c = await control("listContexts");
  return {
    paired: true, reachable: true,
    grants: (g?.grants ?? []).map((x: any) => ({ ...x, pending: x.pending ?? null })),
    audit: a?.entries ?? [],
    contexts: c?.contexts ?? [],
    activeProject: c?.activeProject ?? null,
  };
}

function lastSeen(origin: string, audit: AuditEntry[]): number { for (const e of audit) if (e.origin === origin) return e.ts; return 0; }

let lastData: PanelData | null = null; // so tab-change events can re-render the "This tab" card

function render(data: PanelData) {
  if (consentActive) return;
  lastData = data;
  const online = data.paired && data.reachable;
  const st = $("status"); st.className = "status" + (online ? " on" : "");
  $("statusText").textContent = online ? "on" : data.paired ? "sidekick offline" : "not paired";
  ($("home") as HTMLElement).hidden = !online;
  ($("pairing") as HTMLElement).hidden = online;
  if (data.paired && !data.reachable) { $("pairErr").textContent = "Paired, but the sidekick isn’t running. Start it: npm run sidekick."; $("pairBtn").textContent = "Retry"; }
  if (!online) return;

  void renderCurrentSite(data);
  renderProject(data);
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
  if (!inExtension) return "canva.com"; // outside the extension (design preview): show the suggestion case
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return null;
    const u = new URL(tab.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null; // ignore chrome://, about:, file:, the panel itself
    return u.host;
  } catch { return null; }
}
const hostMatch = (a: string, b: string) => a === b || a.endsWith("." + b) || b.endsWith("." + a);

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
  row.append(el("div", "fav", h.replace(/^www\./, "")[0]?.toUpperCase() ?? "•"), txt);
  card.append(row);

  if (alts.length) {
    card.append(el("div", "free", "Use one of these instead — free, on your own compute, context & data:"));
    const list = el("div", "alts");
    for (const w of alts.slice(0, 3)) {
      const a = el("button", "alt");
      const ic = el("div", "ic", w.name[0]!.toUpperCase()); ic.style.background = w.color;
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
function renderWrapps(data: PanelData) {
  const box = $("wrapps"); box.textContent = "";
  const connected = new Set(data.grants.map((g) => host(g.origin)));
  for (const w of WRAPPS) {
    const card = el("button", "wrapp");
    const t2 = el("div", "t2");
    const ic = el("div", "ic", w.name[0]!.toUpperCase()); ic.style.background = w.color;
    t2.append(ic, el("div", "nm", w.name));
    if (connected.has(host(w.url))) { const d = el("div", "live"); d.title = "connected"; t2.append(d); }
    card.append(t2, el("div", "ds", w.desc), el("div", "go", "Open →"));
    card.onclick = () => openWrapp(w.url);
    box.append(card);
  }
}

// ---- Working on: the active project, in its own colours ----
function renderProject(data: PanelData) {
  const box = $("project"); box.textContent = "";
  const active = data.contexts.find((c) => c.id === data.activeProject) || null;
  const usedBy = active ? data.grants.filter((g) => g.tools.length || true).length : 0; // apps that could receive it
  const card = el("div", "project" + (active ? "" : " empty"));
  card.append(el("i", "stripe"));
  const row = el("div", "row");
  row.append(el("div", "mark", (active?.name || "—")[0]?.toUpperCase() ?? "—"));
  const txt = el("div"); txt.style.minWidth = "0";
  txt.append(el("div", "name", active ? active.name : "No project yet"));
  txt.append(el("div", "meta", active ? `${active.kind ?? "project"} · lent to apps that ask for a context` : "Pick one to lend to apps that ask"));
  row.append(txt);
  const sw = el("button", "switch", data.contexts.length ? (active ? "Switch" : "Choose") : "None yet");
  if (data.contexts.length) sw.onclick = () => openPicker(data);
  row.append(sw);
  card.append(row);
  // No brand swatches here: a context's colours belong INSIDE the app that uses them, in its own
  // field — showing them in Switchboard's chrome just decorates and dilutes the meaning.
  box.append(card);
}

// ---- Connectors: friendly capability tiles derived from what apps are granted ----
function renderConnectors(data: PanelData) {
  const box = $("connectors"); box.textContent = "";
  const seen = new Map<string, { label: string; color: string; hint: string; apps: number }>();
  for (const g of data.grants) {
    const keys = new Set<string>();
    for (const t of g.tools) { const c = connectorOf(t.name); if (c) keys.add(c.key); }
    for (const k of keys) { const c = connectorOf([...g.tools].find((t) => connectorOf(t.name)?.key === k)!.name)!; const e = seen.get(k) ?? { label: c.label, color: c.color, hint: c.hint, apps: 0 }; e.apps++; seen.set(k, e); }
  }
  if (!seen.size) { box.append(el("div", "empty-note", "No connectors in use yet. Apps you connect will ask for the ones they need.")); return; }
  for (const [, c] of seen) {
    const tile = el("div", "conn");
    const ic = el("div", "ic", c.label[0]!.toUpperCase()); ic.style.background = c.color;
    tile.append(ic, el("div", "nm", c.label), el("div", "use", `${c.apps} app${c.apps === 1 ? "" : "s"}${c.hint ? " · " + c.hint : ""}`));
    box.append(tile);
  }
}

// ---- Apps: connected wrapps; the technical detail lives in the expander ----
function renderApps(data: PanelData) {
  $("appCount").textContent = data.grants.length ? `${data.grants.length}` : "";
  const box = $("apps"); box.textContent = "";
  if (!data.grants.length) { box.append(el("div", "empty-note", "No apps connected yet. When one asks to use your Claude, you’ll approve it here.")); return; }

  for (const g of data.grants) {
    const isOpen = openApps.has(g.origin);
    const card = el("div", "app" + (isOpen ? " open" : "") + (g.pending ? " pending" : ""));
    const seen = lastSeen(g.origin, data.audit);
    const activeNow = seen && Date.now() - seen < 120_000;

    const row = el("div", "row");
    row.append(el("div", "av", appName(g.origin)[0]?.toUpperCase() ?? "•"));
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
    const conns = new Map<string, string>();
    for (const t of g.tools) { const c = connectorOf(t.name); if (c) conns.set(c.key, c.label); }
    if (conns.size) { const d = el("div"); d.append(el("div", "k", "Can use")); const pills = el("div", "pills"); pills.style.marginTop = "7px"; for (const [, label] of conns) pills.append(el("span", "pill", label)); d.append(pills); detail.append(d); }
    if (g.storage) { const d = el("div", "drow"); d.append(el("span", "k", g.storage.autoAssigned ? "Private data" : "Project folder")); d.append(el("span", "pill", `${g.storage.count} record${g.storage.count === 1 ? "" : "s"}`)); detail.append(d); }

    // usage (moved out of the surface)
    const pct = Math.min(1, g.usage.tokensToday / (g.budgets.maxTokensPerDay || 1));
    const use = el("div"); use.append(el("div", "k", "Compute today"));
    const bar = el("div", "usebar"); bar.style.marginTop = "7px"; const m = el("div", "m"); const fill = el("i"); Object.assign(fill.style, { width: `${Math.max(3, pct * 100)}%`, background: meterColor(pct) }); m.append(fill);
    bar.append(m, el("span", "v", `${kfmt(g.usage.tokensToday)} / ${kfmt(g.budgets.maxTokensPerDay)}`)); use.append(bar); detail.append(use);

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

    // pending consent (rare on the surface — usually the inline consent view takes over)
    if (g.pending) {
      const pend = el("div", "pend");
      const t = el("div", "txt"); t.append(document.createTextNode("Wants to "), Object.assign(el("b"), { textContent: short(g.pending.tool) }));
      const btns = el("div", "btns"); btns.append(el("button", "approve", "Approve"), el("button", "deny", "Deny"));
      pend.append(t, btns); detail.append(pend);
    }
    card.append(detail);
    box.append(card);
  }
}

function renderActivity(data: PanelData) {
  const feed = $("feed"); feed.textContent = "";
  if (!data.audit.length) { feed.append(el("div", "empty-note", "Nothing yet.")); return; }
  for (const e of data.audit.slice(0, 24)) {
    const cls = e.outcome === "denied" ? "deny" : e.decision === "auto-approved" ? "ok" : e.toolName ? "write" : "ok";
    const row = el("div", `ev ${cls}`);
    const what = e.toolName ? short(e.toolName) : (e.method ?? e.kind);
    row.append(el("div", "t", ago(e.ts)));
    const d = el("div", "d"); d.append(Object.assign(el("b"), { textContent: appName(e.origin) }), document.createTextNode(` · ${what}`));
    row.append(d); feed.append(row);
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
const CATEGORY_ORDER = ["Projects", "Brands", "Data sources"]; // the rest fall in alphabetically after

function openPicker(data: PanelData) {
  const picker = $("picker") as HTMLElement; picker.hidden = false;
  const list = $("plist"); list.textContent = "";

  const groups = new Map<string, ContextMeta[]>();
  for (const c of data.contexts) { const g = contextCategory(c); (groups.get(g) ?? groups.set(g, []).get(g)!).push(c); }
  const names = [...groups.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

  for (const gname of names) {
    if (groups.size > 1) list.append(el("div", "pgroup", gname)); // header only when there's more than one kind
    for (const c of groups.get(gname)!) {
      const item = el("button", "pitem" + (c.id === data.activeProject ? " on" : ""));
      item.append(el("div", "mk", c.name[0]?.toUpperCase() ?? "•"));
      const txt = el("div"); txt.style.minWidth = "0"; txt.append(el("div", "nm", c.name));
      // No colour swatches in the picker — a context's palette is meaningful inside the app that
      // uses it, not as decoration here. A live data source keeps its row-count badge (that's status).
      if (c.sourceKind) txt.append(el("span", "badge", `live · ${c.rowCount ?? 0} rows`));
      item.append(txt);
      if (c.id === data.activeProject) item.append(el("div", "tick", "✓"));
      item.onclick = () => { if (inExtension) control("setActiveProject", { contextId: c.id === data.activeProject ? null : c.id }).then(() => { picker.hidden = true; refresh(); }); else { picker.hidden = true; } };
      list.append(item);
    }
  }
  renderAddSheet();
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
$("pickerClose").addEventListener("click", () => (($("picker") as HTMLElement).hidden = true));

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
$("browseStore").addEventListener("click", () => openWrapp("http://localhost:5174/store.html"));

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
    port.onMessage.addListener((m: { type: string; id: string }) => {
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
  box.hidden = false;
  renderConsent(box, prompt, (result) => {
    chrome.runtime.sendMessage({ type: "consentDecision", id, result }, () => { box.hidden = true; box.textContent = ""; consentActive = false; refresh(); });
  });
}

// ---- pairing ----
async function pair() {
  if (!inExtension) return;
  const token = ($("token") as HTMLInputElement).value.trim();
  if (token) await new Promise((r) => chrome.runtime.sendMessage({ type: "pair", token }, r));
  $("pairErr").textContent = "Connecting…";
  setTimeout(refresh, 600);
}
$("pairBtn")?.addEventListener("click", pair);
$("token")?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") pair(); });

refresh();
