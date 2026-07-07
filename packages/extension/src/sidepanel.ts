/**
 * Relay side panel. Inside the extension it pulls live data from the daemon via the background
 * control channel (grants + budget usage + audit). Outside (a plain browser preview) it renders
 * representative mock data so the design is viewable without the daemon. Same file, both worlds.
 *
 * The signature is the budget meter: its fill color encodes how much of your daily compute a site
 * has drained — mint (healthy) → amber (heavy) → coral (near the ceiling). Numbers are mono/tabular.
 */

type Mode = "ask" | "trust" | "readonly";
interface Grant {
  origin: string;
  mode: Mode;
  models: string[];
  tools: { name: string; access: "read" | "write" }[];
  budgets: { maxTokensPerDay: number; maxCallsPerMin: number };
  usage: { tokensToday: number; callsThisMinute: number };
  pending?: { tool: string; args: Record<string, unknown> } | null;
}
interface AuditEntry { ts: number; origin: string; method?: string; toolName?: string; kind: string; decision?: string; outcome: string; }
interface PanelData { paired: boolean; reachable: boolean; grants: Grant[]; audit: AuditEntry[]; }

import { renderConsent, type Prompt } from "./consent-view.js";

const inExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
let consentActive = false; // when true, the consent overlay owns the panel; render() won't override

const MOCK: PanelData = {
  paired: true,
  reachable: true,
  grants: [
    { origin: "adgen.example", mode: "ask", models: ["sonnet"], tools: [{ name: "WebFetch", access: "read" }, { name: "higgsfield__generate_image", access: "write" }],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 148_200, callsThisMinute: 4 }, pending: null },
    { origin: "shop-copilot.example", mode: "trust", models: ["sonnet"], tools: [{ name: "shopify__search_products", access: "read" }, { name: "shopify__create-discount", access: "write" }],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 61_400, callsThisMinute: 2 },
      pending: { tool: "shopify__create-discount", args: { code: "SUMMER20", value: 20 } } },
    { origin: "chat.example", mode: "ask", models: ["sonnet"], tools: [],
      budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 }, usage: { tokensToday: 12_050, callsThisMinute: 1 }, pending: null },
  ],
  audit: [
    { ts: Date.now() - 8_000, origin: "shop-copilot.example", toolName: "shopify__create-discount", kind: "consent", decision: "pending", outcome: "ok" },
    { ts: Date.now() - 41_000, origin: "adgen.example", toolName: "higgsfield__generate_image", kind: "consent", decision: "user-approved", outcome: "ok" },
    { ts: Date.now() - 52_000, origin: "adgen.example", toolName: "WebFetch", kind: "tool_call", decision: "auto-approved", outcome: "ok" },
    { ts: Date.now() - 180_000, origin: "shop-copilot.example", toolName: "shopify__create-discount", kind: "consent", decision: "user-denied", outcome: "denied" },
    { ts: Date.now() - 240_000, origin: "chat.example", method: "claude_stream", kind: "request", outcome: "ok" },
    { ts: Date.now() - 900_000, origin: "adgen.example", kind: "connect", outcome: "ok" },
  ],
};

const $ = (id: string) => document.getElementById(id)!;
const el = (tag: string, cls?: string, text?: string) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));
const host = (o: string) => { try { return new URL(o.includes("://") ? o : `https://${o}`).host; } catch { return o; } };
const meterColor = (pct: number) => (pct < 0.5 ? "var(--lime)" : pct < 0.8 ? "var(--warn)" : "var(--danger)");
const ago = (ts: number) => { const s = Math.round((Date.now() - ts) / 1000); if (s < 60) return `${s}s`; const m = Math.round(s / 60); if (m < 60) return `${m}m`; return `${Math.round(m / 60)}h`; };

function control(action: string, args?: unknown): Promise<any> {
  return new Promise((res) => chrome.runtime.sendMessage({ type: "control", action, args }, res));
}

async function load(): Promise<PanelData> {
  if (!inExtension) return MOCK;
  const status = await new Promise<any>((r) => chrome.runtime.sendMessage({ type: "getStatus" }, r));
  if (!status?.paired) return { paired: false, reachable: false, grants: [], audit: [] };
  if (!status?.reachable) return { paired: true, reachable: false, grants: [], audit: [] };
  const g = await control("listGrants");
  const a = await control("audit", { limit: 40 });
  return { paired: true, reachable: true, grants: (g?.grants ?? []).map((x: any) => ({ ...x, pending: null })), audit: a?.entries ?? [] };
}

function render(data: PanelData) {
  if (consentActive) return; // a consent is showing; don't flip the dashboard/pairing underneath it
  const online = data.paired && data.reachable;
  const st = $("statusText"); st.textContent = "";
  const dot = el("b", undefined, "●");
  dot.style.color = online ? "var(--ok)" : data.paired ? "var(--danger)" : "var(--ink-faint)";
  st.append(dot, document.createTextNode(` ${online ? "connected" : data.paired ? "sidekick offline" : "not paired"}`));

  // Show the dashboard only when actually connected. Not paired OR paired-but-daemon-down → the
  // pairing card, with an offline hint in the latter case so the fix is obvious.
  ($("dashboard") as HTMLElement).hidden = !online;
  ($("pairing") as HTMLElement).hidden = online;
  ($("pairErr") as HTMLElement).textContent =
    data.paired && !data.reachable ? "Paired, but the sidekick isn’t running. Start it: npm run sidekick (port 8787)." : "";
  ($("pairBtn") as HTMLElement).textContent = data.paired && !data.reachable ? "Retry" : "Pair";
  if (!online) return;

  // aggregate
  const usedTotal = data.grants.reduce((s, g) => s + g.usage.tokensToday, 0);
  const capTotal = data.grants.reduce((s, g) => s + g.budgets.maxTokensPerDay, 0);
  const totalPct = capTotal ? Math.min(1, usedTotal / capTotal) : 0;
  $("totalNum").textContent = "";
  // No sites yet → just "0 tokens" (no cap to show). Otherwise "used / cap tokens".
  $("totalNum").append(document.createTextNode(kfmt(usedTotal)), Object.assign(el("small"), { textContent: capTotal ? ` / ${kfmt(capTotal)} tokens` : " tokens" }));
  Object.assign(($("totalBar") as HTMLElement).style, { width: `${Math.max(2, totalPct * 100)}%`, background: meterColor(totalPct) });

  $("siteCount").textContent = `${data.grants.length}`;
  const sites = $("sites"); sites.textContent = "";
  if (!data.grants.length) sites.append(el("div", "empty", "No sites connected. When one asks, you'll approve it here."));

  for (const g of data.grants) {
    const pct = Math.min(1, g.usage.tokensToday / (g.budgets.maxTokensPerDay || 1));
    const card = el("div", "site" + (g.pending ? " pending" : ""));

    const head = el("div", "head");
    head.append(el("div", "fav", host(g.origin)[0]?.toUpperCase() ?? "•"), el("div", "origin", host(g.origin)));
    const rev = el("button", "revoke", "Revoke") as HTMLButtonElement;
    rev.onclick = () => { if (inExtension) control("revoke", { origin: g.origin }).then(refresh); };
    head.append(rev);
    card.append(head);

    const metrics = el("div", "metrics");
    metrics.append(el("span", "num", kfmt(g.usage.tokensToday)), el("span", "of", `/ ${kfmt(g.budgets.maxTokensPerDay)} tok`),
      el("span", "rate", `${g.usage.callsThisMinute}/${g.budgets.maxCallsPerMin} per min`));
    card.append(metrics);

    const meter = el("div", "meter"); const fill = el("i");
    Object.assign(fill.style, { width: `${Math.max(2, pct * 100)}%`, background: meterColor(pct) });
    meter.append(fill); card.append(meter);

    if (g.tools.length) {
      const chips = el("div", "chips");
      for (const t of g.tools) chips.append(el("span", `chip ${t.access}`, `${host2(t.name)} · ${t.access}`));
      card.append(chips);
    }

    // Per-site trust mode — how writes are handled for this site.
    const mode = el("div", "mode");
    const modes: Array<[Mode, string, boolean]> = [["ask", "Ask", false], ["trust", "Trust", false], ["readonly", "Read-only", true]];
    for (const [m, label, warn] of modes) {
      const active = (g.mode ?? "ask") === m;
      const b = el("button", (active ? "on" : "") + (warn && active ? " warn" : ""), label) as HTMLButtonElement;
      b.title = m === "ask" ? "Ask before every write action" : m === "trust" ? "Auto-approve writes for this site (still budget-capped)" : "Block all write actions";
      b.onclick = () => { if (inExtension) control("setMode", { origin: g.origin, mode: m }).then(refresh); };
      mode.append(b);
    }
    card.append(mode);

    if (g.pending) {
      const bar = el("div", "pend");
      const txt = el("div", "txt"); txt.append(document.createTextNode("Wants to "), Object.assign(el("b"), { textContent: host2(g.pending.tool) }));
      const btns = el("div", "btns");
      btns.append(el("button", "approve", "Approve"), el("button", "deny", "Deny"));
      bar.append(txt, btns); card.append(bar);
    }
    sites.append(card);
  }

  // activity
  const feed = $("feed"); feed.textContent = "";
  if (!data.audit.length) feed.append(el("div", "empty", "Nothing yet."));
  for (const e of data.audit.slice(0, 30)) {
    const cls = e.outcome === "denied" ? "deny" : e.decision === "user-approved" || e.toolName?.length ? (e.decision === "auto-approved" ? "ok" : "write") : "ok";
    const row = el("div", `ev ${cls}`);
    const what = e.toolName ? host2(e.toolName) : (e.method ?? e.kind);
    const verb = e.decision ? e.decision.replace("user-", "") : e.outcome;
    row.append(el("span", "t", ago(e.ts)));
    const d = el("div", "d"); d.append(Object.assign(el("b"), { textContent: host(e.origin) }), document.createTextNode(` ${what} · ${verb}`));
    row.append(d); feed.append(row);
  }
}

/** shorten server-qualified tool names for display: mcp__shopify__create-discount → create-discount */
function host2(name: string) { return name.includes("__") ? name.split("__").pop()! : name; }

async function refresh() { if (!consentActive) render(await load()); }

// ---- inline consent: the daemon pushes a prompt here (via the background port) when the panel is
// open, so approvals happen in the sidebar instead of a separate window. ----
if (inExtension) {
  const port = chrome.runtime.connect({ name: "relay-panel" });
  port.onMessage.addListener((m: { type: string; id: string }) => { if (m.type === "consent:new") void showConsent(m.id); });
}
async function showConsent(id: string) {
  const prompt = await new Promise<Prompt | null>((r) => chrome.runtime.sendMessage({ type: "getConsentPrompt", id }, r));
  if (!prompt) return;
  consentActive = true;
  const box = $("consent");
  ($("dashboard") as HTMLElement).hidden = true;
  ($("pairing") as HTMLElement).hidden = true;
  box.hidden = false;
  renderConsent(box, prompt, (result) => {
    chrome.runtime.sendMessage({ type: "consentDecision", id, result }, () => {
      box.hidden = true; box.textContent = "";
      consentActive = false;
      refresh();
    });
  });
}

$("kill").addEventListener("click", async () => {
  if (inExtension) { await new Promise((r) => chrome.runtime.sendMessage({ type: "killSwitch" }, r)); refresh(); }
});

// Pairing: store the token in the background worker, then re-check (the socket auths on the token).
async function pair() {
  if (!inExtension) return;
  const token = ($("token") as HTMLInputElement).value.trim();
  if (token) await new Promise((r) => chrome.runtime.sendMessage({ type: "pair", token }, r));
  // With a new token we store it; on Retry (no token) we just re-check the daemon. Either way,
  // refresh runs getStatus → ensureSocket, which reconnects and flips to "connected" if it's up.
  ($("pairErr") as HTMLElement).textContent = "Connecting…";
  setTimeout(refresh, 600);
}
$("pairBtn")?.addEventListener("click", pair);
$("token")?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") pair(); });

refresh();
