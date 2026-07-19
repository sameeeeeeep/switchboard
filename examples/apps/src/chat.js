// betterchat — the general-purpose chat wrapp, ChatGPT-class chat running entirely on the
// visitor's own Claude via Switchboard. Zero operator key, zero backend. Doctrine: the moment a
// grant exists (fresh chip connect OR page load with a persisted grant) the app greets you by
// name, restores your threads from relay.storage instantly, pulls the lent context (or
// auto-selects the best one from your library), and generates a batch of context-grounded
// starter prompts — one ★ recommended, with a "more like these" regenerate chip. The composer is
// the single free-text input; every turn streams with a stop button and persists.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const STORE_KEY = "betterchat:v1";
const STREAM_TIMEOUT_MS = 180000; // a wedged daemon surfaces as an error, never an eternal cursor
// Kind priority when auto-selecting from the library: the person first, then what they're building.
const KIND_PRIORITY = ["personal", "project", "brand", "note", "csv", "gsheet"];

let relay = null;
let booted = false;       // onConnect (chip) + the load probe can both land — initialize once
let notInstalled = false;
let userName = null;
let ctx = null;           // the lent context (full object) or null → generic mode
let busy = false;         // one chat stream at a time
let cancelled = false;    // stop button breaks the for-await loop, keeps partial text
let lastError = null;     // { threadId, message } — transient, renders an inline retry row
let sugSeq = 0;           // stale-suggestion guard (context can switch mid-generation)
let sugRunning = false;

// Workspace persisted in relay.storage (values are strings — always JSON in/out).
let ws = { threads: [], activeThreadId: null, suggestions: null };

// ---------- tiny helpers ----------
function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const msg = (e) => String(e?.message || e).slice(0, 160);
function ago(ts) {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 60) return "now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

// ---------- markdown-lite (redline idiom: escape FIRST, then decorate — never raw innerHTML) ----------
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdInline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^\s*#{1,4}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ");
}
function mdLite(src) {
  const chunks = String(src ?? "").split("```");
  let html = "";
  for (let i = 0; i < chunks.length; i++) {
    if (i % 2 === 1) {
      // fenced code — strip the optional language line, keep everything verbatim (escaped)
      const code = chunks[i].replace(/^[a-zA-Z0-9_+-]*\n/, "");
      html += '<pre class="code"><code>' + esc(code.replace(/\n$/, "")) + "</code></pre>";
    } else {
      let t = chunks[i];
      if (i > 0) t = t.replace(/^\n/, "");
      if (i < chunks.length - 1) t = t.replace(/\n$/, "");
      html += mdInline(t);
    }
  }
  return html;
}

// ---------- stream with a hard timeout (redline streamText idiom) ----------
async function streamText(params, onProgress) {
  let text = "", settled = false;
  return await Promise.race([
    (async () => {
      for await (const d of relay.stream(params)) {
        if (cancelled && onProgress) break; // stop button — chat streams only; keeps partial text
        if (d.type === "text") { text += d.text; onProgress && onProgress(text); }
        else if (d.type === "error") throw new Error(d.error?.message || "stream error");
      }
      settled = true;
      return text;
    })(),
    new Promise((_, reject) => setTimeout(() => {
      if (!settled) reject(new Error("Switchboard didn't respond — is the sidekick running? Reload this tab and try again."));
    }, STREAM_TIMEOUT_MS)),
  ]);
}
function parseJsonArray(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  try { const a = JSON.parse(t.slice(s, e + 1)); return Array.isArray(a) ? a : null; } catch { return null; }
}

// ---------- workspace (relay.storage; strings only) ----------
function normalizeSuggestions(arr) {
  const out = [];
  for (const it of Array.isArray(arr) ? arr : []) {
    if (typeof it === "string" && it.trim()) out.push({ text: it.trim().slice(0, 120), recommended: false });
    else if (it && typeof it.text === "string" && it.text.trim()) out.push({ text: it.text.trim().slice(0, 120), recommended: !!it.recommended });
    if (out.length >= 5) break;
  }
  let seen = false; // exactly one ★
  for (const i of out) { if (i.recommended) { if (seen) i.recommended = false; seen = true; } }
  if (out.length && !seen) out[0].recommended = true;
  return out;
}
function normalizeWs(raw) {
  const clean = { threads: [], activeThreadId: null, suggestions: null };
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.threads)) {
      for (const t of raw.threads) {
        if (!t || typeof t.id !== "string" || !Array.isArray(t.messages)) continue;
        clean.threads.push({
          id: t.id,
          title: typeof t.title === "string" && t.title ? t.title : "chat",
          contextId: typeof t.contextId === "string" ? t.contextId : null,
          contextName: typeof t.contextName === "string" ? t.contextName : null,
          messages: t.messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"),
          updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
        });
      }
    }
    if (typeof raw.activeThreadId === "string") clean.activeThreadId = raw.activeThreadId;
    if (raw.suggestions && typeof raw.suggestions.ctxId === "string") {
      const items = normalizeSuggestions(raw.suggestions.items);
      if (items.length) clean.suggestions = { ctxId: raw.suggestions.ctxId, items, at: Number(raw.suggestions.at) || 0 };
    }
  }
  if (clean.activeThreadId && !clean.threads.some((t) => t.id === clean.activeThreadId)) clean.activeThreadId = null;
  return clean;
}
let saveT = null;
function save() { // debounced ~300ms; every mutation funnels through here
  if (!relay) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const r = relay;
    if (!r) return;
    r.storage.set(STORE_KEY, JSON.stringify(ws)).catch(() => { /* storage is a convenience — never block chat */ });
  }, 300);
}

// ---------- threads ----------
const activeThread = () => ws.threads.find((t) => t.id === ws.activeThreadId) || null;
function newThread() {
  const t = { id: uid(), title: "new chat", contextId: ctx?.id || null, contextName: ctx?.name || null, messages: [], updatedAt: Date.now() };
  ws.threads.unshift(t);
  ws.activeThreadId = t.id;
  return t;
}
function deleteThread(id) {
  ws.threads = ws.threads.filter((t) => t.id !== id);
  if (ws.activeThreadId === id) {
    ws.activeThreadId = ws.threads.length ? [...ws.threads].sort((a, b) => b.updatedAt - a.updatedAt)[0].id : null;
    lastError = null;
  }
  renderRail(); renderLog(); save();
}
function switchThread(id) {
  if (ws.activeThreadId === id) return;
  ws.activeThreadId = id;
  lastError = null;
  renderRail(); renderLog(); save();
  $("prompt").focus();
}

// ---------- rendering ----------
function renderRail() {
  const box = $("rail");
  box.textContent = "";
  const sorted = [...ws.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!sorted.length) {
    box.append(mk("div", "rail-empty", relay ? "no chats yet — every conversation lands here, and survives a refresh" : "your chats will live here"));
    return;
  }
  for (const t of sorted) {
    const row = mk("div", "t-row" + (t.id === ws.activeThreadId ? " on" : ""));
    const main = mk("div", "t-main");
    main.append(mk("div", "t-title", t.title));
    const meta = mk("div", "t-meta");
    if (t.contextName) meta.append(mk("span", "t-ctx", t.contextName));
    meta.append(mk("span", null, ago(t.updatedAt)));
    main.append(meta);
    row.append(main);
    const del = mk("button", "t-del", "×");
    del.type = "button";
    del.title = "delete this chat";
    del.onclick = (e) => { e.stopPropagation(); deleteThread(t.id); };
    row.append(del);
    row.onclick = () => switchThread(t.id);
    box.append(row);
  }
}

function renderMsg(m) {
  const el = mk("div", `msg ${m.role}`);
  el.append(mk("div", "m-meta", m.role === "user" ? "you" : "your claude"));
  const body = mk("div", "m-body");
  if (m.role === "assistant") body.innerHTML = mdLite(m.content);
  else body.textContent = m.content;
  el.append(body);
  return el;
}
function renderLog() {
  const box = $("log");
  box.textContent = "";
  const th = activeThread();
  if (!th || !th.messages.length) {
    box.append(mk("div", "log-empty",
      relay ? "no messages yet — pick a starter above, or just ask"
            : notInstalled ? "install Switchboard, connect once, and this becomes your chat"
            : "connect Switchboard (top right) to start chatting"));
  } else {
    for (const m of th.messages) box.append(renderMsg(m));
  }
  if (lastError && th && lastError.threadId === th.id) {
    const row = mk("div", "err-row");
    row.append(mk("span", null, "stream failed — " + lastError.message));
    const rb = mk("button", null, "↻ retry");
    rb.type = "button";
    rb.onclick = retryTurn;
    row.append(rb);
    box.append(row);
  }
  box.scrollTop = box.scrollHeight;
}

function renderGreet() {
  const hi = $("greet-hi"), sub = $("greet-sub");
  sub.textContent = "";
  if (relay) {
    hi.textContent = `Hi ${userName || "there"}`;
    if (ctx) sub.textContent = `grounded in “${ctx.name}” (${ctx.kind || "context"}) — the starters below come from it, and every answer can lean on it`;
    else sub.textContent = "generic mode — no context lent. Reconnect from the Switchboard panel to lend your library and make this chat yours.";
  } else if (notInstalled) {
    hi.textContent = "Chat on your own Claude";
    sub.append("No operator key, no backend, no bill. ");
    const a = mk("a", null, "Get Switchboard →");
    a.href = INSTALL_URL; a.target = "_blank"; a.rel = "noreferrer";
    sub.append(a);
    sub.append(" — then this page greets you by name and writes starters from your library.");
  } else {
    hi.textContent = "Chat on your own Claude";
    sub.textContent = "Connect Switchboard (top right): one consent, then your name, your library, and your history — no key, no bill.";
  }
}

// ---------- suggestions (context-first, proactive — the panel is never empty) ----------
const SAMPLES = [
  { text: "Draft a crisp weekly update from three messy bullet points", recommended: true },
  { text: "Poke holes in my launch plan like a skeptical friend", recommended: false },
  { text: "Rewrite this paragraph so a busy person actually reads it", recommended: false },
  { text: "Turn my notes into a decision with real tradeoffs", recommended: false },
  { text: "Explain what my numbers actually say, no fluff", recommended: false },
];
function setSugNote(t) { $("suggest-note").textContent = t || ""; }
function renderChips(items, opts = {}) {
  const box = $("chips");
  box.textContent = "";
  for (const it of items) {
    const b = mk("button", "chip" + (it.recommended ? " rec" : "") + (opts.sample ? " sample" : ""),
      (it.recommended ? "★ " : "") + it.text);
    b.type = "button";
    if (opts.sample) { b.disabled = false; b.onclick = () => {}; b.tabIndex = -1; }
    else b.onclick = () => { if (!busy) { $("prompt").value = it.text; void send(it.text); } };
    box.append(b);
  }
  if (!opts.sample && relay) {
    const more = mk("button", "chip more", "↻ more like these");
    more.type = "button";
    more.disabled = sugRunning;
    more.onclick = () => { if (!sugRunning) void refreshSuggestions("from a different angle"); };
    box.append(more);
  }
}
function renderSugLoading() {
  const box = $("chips");
  box.textContent = "";
  box.append(mk("div", "sug-loading", "asking your Claude for starters…"));
}
function fallbackSuggestions() {
  const n = ctx?.name;
  const items = n ? [
    { text: `Draft this week's update for ${n}`, recommended: true },
    { text: `What should I focus on next for ${n}?`, recommended: false },
    { text: `Write a one-liner that actually explains ${n}`, recommended: false },
    { text: `List the 3 riskiest assumptions behind ${n}`, recommended: false },
  ] : [
    { text: "Help me plan today in five sharp bullets", recommended: true },
    { text: "Rewrite my last email so it lands better", recommended: false },
    { text: "Give me 3 ways to unblock what I'm stuck on", recommended: false },
    { text: "Explain something to me like I'm smart but busy", recommended: false },
  ];
  return normalizeSuggestions(items);
}
function ctxJson(cap) {
  if (!ctx) return "";
  try {
    const s = JSON.stringify(ctx.data);
    return s.length > cap ? s.slice(0, cap) + "…" : s;
  } catch { return ""; }
}
function buildSuggestPrompt(steer) {
  return [
    'Return ONLY a JSON array (no prose, no code fences) of exactly 5 chat-starter prompts this user would plausibly ask right now. Each element: {"text":"...","recommended":false}. Exactly ONE element has "recommended":true — the single best starter. Each "text" is first person, concrete, and at most 90 characters.',
    userName ? `The user's name is ${userName}.` : "",
    ctx ? `They lent this chat their ${ctx.kind || "context"} "${ctx.name}". Ground every starter in what is actually in it:\n${ctxJson(4000)}`
        : "No context was lent — make the starters broadly useful for a hands-on builder.",
    steer ? `A previous batch exists — make this one ${steer}.` : "",
  ].filter(Boolean).join("\n\n");
}
async function refreshSuggestions(steer) {
  if (!relay) return;
  const my = ++sugSeq;
  sugRunning = true;
  const key = ctx?.id || "generic";
  const cached = ws.suggestions;
  const usable = cached && cached.ctxId === key && cached.items?.length;
  if (usable) { // render instantly (<24h or not — stale beats blank), then regenerate behind it
    renderChips(cached.items);
    setSugNote(steer ? "regenerating…" : "refreshing…");
  } else {
    renderSugLoading();
    setSugNote("");
  }
  let items = null;
  try {
    const text = await streamText({ prompt: buildSuggestPrompt(steer), maxTokens: 600 });
    items = normalizeSuggestions(parseJsonArray(text));
  } catch { /* fall through to templates */ }
  if (my !== sugSeq) return; // superseded by a context switch — that run owns the panel now
  sugRunning = false;
  if (!relay) return;
  if (!items || !items.length) items = fallbackSuggestions();
  ws.suggestions = { ctxId: key, items, at: Date.now() };
  save();
  renderChips(items);
  setSugNote(ctx ? `from “${ctx.name}”` : "generic — lend a context for sharper starters");
}

// ---------- chat turns ----------
function buildSystem() {
  let sys = "You are betterchat — the user's own Claude in a fast, no-frills chat wrapp. Be direct, concrete, and genuinely useful. Use markdown sparingly: **bold**, bullets, and fenced code blocks when they help.";
  if (userName) sys += ` The user is ${userName}.`;
  if (ctx) sys += `\n\nThe user lent this app their ${ctx.kind || "context"} "${ctx.name}". Lean on it whenever relevant:\n${ctxJson(4000)}`;
  return sys;
}
function histFor(th) {
  const out = [];
  let total = 0;
  for (let i = th.messages.length - 1; i >= 0 && out.length < 20; i--) {
    const m = th.messages[i];
    let content = m.content;
    if (!out.length && content.length > 24000) content = content.slice(0, 24000); // never drop the live turn
    if (out.length && total + content.length > 24000) break; // cap: trim oldest first
    out.unshift({ role: m.role, content });
    total += content.length;
  }
  return out;
}
function setBusy(b) {
  busy = b;
  $("send").disabled = b || !relay;
  $("send").textContent = b ? "streaming…" : "Send";
  $("stop").hidden = !b;
}
async function runTurn(th) {
  if (!relay || busy) return;
  lastError = null;
  cancelled = false;
  setBusy(true);
  renderLog();
  // live bubble — appended after the history render, replaced by state on finish
  const live = mk("div", "msg assistant");
  live.append(mk("div", "m-meta", "your claude"));
  const body = mk("div", "m-body");
  body.innerHTML = '<span class="cur">▍</span>';
  live.append(body);
  $("log").append(live);
  $("log").scrollTop = $("log").scrollHeight;
  let acc = "";
  try {
    const out = await streamText(
      { messages: histFor(th), system: buildSystem(), maxTokens: 4000 },
      (t) => {
        acc = t;
        body.innerHTML = mdLite(t) + '<span class="cur">▍</span>';
        $("log").scrollTop = $("log").scrollHeight;
      },
    );
    acc = out || acc;
    if (acc.trim()) th.messages.push({ role: "assistant", content: acc });
  } catch (e) {
    // KEEP the partial text — it persists as a real message; the error row offers retry
    if (acc.trim()) th.messages.push({ role: "assistant", content: acc });
    lastError = { threadId: th.id, message: msg(e) };
  } finally {
    // a failed stream can never lock the composer
    th.updatedAt = Date.now();
    setBusy(false);
    save();
    renderLog();
    renderRail();
  }
}
async function send(text) {
  if (!relay || busy) return;
  const content = String(text ?? $("prompt").value).trim();
  if (!content) return;
  const th = activeThread() || newThread();
  th.messages.push({ role: "user", content });
  if (th.messages.filter((m) => m.role === "user").length === 1) th.title = content.slice(0, 48);
  th.updatedAt = Date.now();
  $("prompt").value = "";
  renderRail();
  save();
  await runTurn(th);
}
function retryTurn() {
  const th = activeThread();
  if (!th || busy || !relay) return;
  // pop the failed/partial assistant tail so the same user turn is re-answered
  while (th.messages.length && th.messages[th.messages.length - 1].role === "assistant") th.messages.pop();
  if (!th.messages.length || th.messages[th.messages.length - 1].role !== "user") { lastError = null; renderLog(); return; }
  void runTurn(th);
}

// ---------- context load (kind priority personal > project > brand > note > live data) ----------
function bestMeta(metas) {
  let best = null, bestRank = KIND_PRIORITY.length;
  for (const m of metas || []) {
    const rank = KIND_PRIORITY.indexOf((m.kind || "").toLowerCase());
    const r = rank === -1 ? KIND_PRIORITY.length : rank;
    if (r < bestRank || (r === bestRank && (m.updatedAt || 0) > (best?.updatedAt || 0))) { best = m; bestRank = r; }
  }
  return best;
}
async function loadContext() {
  ctx = null;
  try {
    ctx = await relay.context.active();
    if (!ctx) {
      const metas = await relay.context.list();
      const pick = bestMeta(metas);
      if (pick) ctx = await relay.context.use(pick.id);
    }
  } catch { ctx = null; } // old narrow grant (no contextKinds) or any failure → generic mode
}

// ---------- connect wiring: the standard chip + the dual-order probe (home.js idiom) ----------
function enableComposer() {
  $("prompt").disabled = false;
  $("prompt").placeholder = "ask your Claude anything — or pick a starter above";
  $("send").disabled = busy;
  $("new-chat").disabled = false;
}
function disableComposer() {
  $("prompt").disabled = true;
  $("prompt").placeholder = "connect Switchboard to chat";
  $("send").disabled = true;
  $("new-chat").disabled = true;
}

async function onReady(r) {
  relay = r;
  notInstalled = false;
  if (booted) return; // chip onConnect + load probe can both land
  booted = true;
  // (a+b) stored workspace FIRST — a returning user sees their history before any network call
  try {
    const raw = await r.storage.get(STORE_KEY);
    ws = normalizeWs(safeParse(raw, null));
  } catch { /* storage unavailable — start fresh */ }
  if (!relay) return; // disconnected mid-flight
  if (!ws.activeThreadId && ws.threads.length) ws.activeThreadId = [...ws.threads].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  enableComposer();
  renderRail();
  renderLog();
  if (ws.suggestions?.items?.length) renderChips(ws.suggestions.items); // instant, pre-identity
  // (c) identity → the greeting
  const user = await r.identity().catch(() => null);
  if (!relay) return;
  userName = user?.name?.trim() || null;
  renderGreet();
  // (d) context — active first, else auto-select the best meta from the library
  await loadContext();
  if (!relay) return;
  renderGreet();
  // (e) proactive: a visible batch of context-grounded starters, zero user input
  void refreshSuggestions();
  $("prompt").focus();
}
function onDisconnected() {
  relay = null;
  booted = false;
  userName = null;
  ctx = null;
  cancelled = true; // ends any in-flight loop's appetite; finally-block unlocks
  setBusy(false);
  $("send").disabled = true;
  sugRunning = false;
  disableComposer();
  renderGreet();
  renderChips(SAMPLES, { sample: true });
  setSugNote("sample — connect to make these yours");
  renderRail();
  renderLog();
}
async function onProjectChange(project) {
  if (!relay || !booted) return;
  if (project) ctx = project;
  else await loadContext();
  renderGreet();
  void refreshSuggestions(); // existing threads keep their contextId tags — provenance preserved
}

mountConnect($("chip-dock"), {
  scope: {
    reason: "chat on your own Claude, grounded in your library",
    models: ["sonnet"],
    // Grants are exact-match: this must be right at FIRST connect. A reused older grant without
    // contextKinds degrades gracefully — loadContext() catches and we run in generic mode.
    contextKinds: ["personal", "project", "brand", "note", "csv", "gsheet"],
  },
  context: "single",
  installUrl: INSTALL_URL,
  onConnect: (r) => void onReady(r),
  onDisconnect: onDisconnected,
  onProjectChange: (p) => void onProjectChange(p),
});
// Load probe: a persisted grant lights everything up without a click. mountConnect's late-provider
// watch covers the cold-service-worker case; this probe just makes the warm path instant.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { void onReady(r); return; }
    renderGreet();
  } else {
    notInstalled = true;
    renderGreet();
    renderLog();
  }
})();

// ---------- composer ergonomics ----------
$("send").addEventListener("click", () => void send());
$("stop").addEventListener("click", () => { cancelled = true; }); // loop breaks; partial text persists
$("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
});
$("new-chat").addEventListener("click", () => {
  if (!relay) return;
  const th = activeThread();
  if (th && !th.messages.length) { $("prompt").focus(); return; } // don't stack empty threads
  newThread();
  lastError = null;
  renderRail(); renderLog(); save();
  $("prompt").focus();
});

// ---------- first paint (pre-probe): never blank, zero tokens burned ----------
renderGreet();
renderChips(SAMPLES, { sample: true });
setSugNote("sample — connect to make these yours");
renderRail();
renderLog();
