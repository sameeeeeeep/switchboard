// ideafetch — the existing-brand INGEST front door (docs/IDEAFETCH.md). Point at a website / repo /
// folder / URL / paste → build understanding → the "define your project" multi-select (you assert
// what your project IS) → publish ONE kind:"project"/"brand" context every wrapp grounds on.
//
// The mirror of ideabrain: ideabrain REASONS about a new idea (suggest-options, single-select);
// ideafetch GATHERS an existing one (readers + a multi-select where the user selects/asserts, and the
// model only STRUCTURES). The website reader is the daemon `sb_brand` capability — coded here against
// its documented interface (see core.js SB_BRAND_METHOD) and DEGRADING GRACEFULLY to an "extractor not
// available yet" state if the daemon hasn't wired it.
//
// PRIVACY — everything runs on the user's own Claude through the broker. The folder reader never
// touches the network (storage.bind + storage.get). The operator never sees any of it.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import {
  SB_BRAND_METHOD, emptyPool, poolFromBrand, poolFromProject, seedChips, collectSelections,
  selectionCount, structure, slug, str, arr,
} from "../wrapps/ideafetch/core.js";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const KINDS = ["project", "brand", "idea", "note"];
const msg = (e) => String(e?.message || e).slice(0, 200);
const kb = (n) => (n < 1024 ? `${n} b` : `${Math.round(n / 1024)} kb`);
const resultText = (d) => (d?.result?.content ?? []).map((c) => c?.text ?? "").join("");
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

let relay = null;
let notInstalled = false;
let cancelled = false;
let busy = false;
let liveIter = null;

// ---------------------------------------------------------------------------------------------
// STATE (docs/IDEAFETCH.md §6 — every state has an honest rendering; none fabricate)
// ---------------------------------------------------------------------------------------------
const POINTERS = [
  { id: "site", kind: "brand", name: "A website", sub: "a live site → a brand", ph: "yourbrand.com",
    ic: `<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5S14.4 18.4 12 20.5C9.6 18.4 8.4 15.1 8.4 12S9.6 6.1 12 3.5z"/>` },
  { id: "repo", kind: "project", name: "A GitHub repo", sub: "a repo → a project", ph: "github.com/you/repo",
    ic: `<path d="M5 4.5h11l3 3V19a.5.5 0 0 1-.5.5h-13A.5.5 0 0 1 5 19z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>` },
  { id: "folder", kind: "project", name: "A folder on this Mac", sub: "a directory → a project, apps open the real files", ph: "~/Projects/yourthing",
    ic: `<path d="M3.5 7.5a1 1 0 0 1 1-1H9l2 2.2h8.5a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>` },
  { id: "url", kind: "project", name: "A URL", sub: "docs / a competitor page → prose + links", ph: "https://docs.yourthing.com",
    ic: `<path d="M9.5 14.5l5-5M8 12l-2 2a3.2 3.2 0 0 0 4.5 4.5l2-2M16 12l2-2a3.2 3.2 0 0 0-4.5-4.5l-2 2"/>` },
  { id: "paste", kind: "project", name: "Paste text", sub: "about copy / a deck → positioning cues", ph: "",
    ic: `<path d="M9 5h6M8.5 5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v1h-7zM6 6.5h12v13H6z"/>` },
  { id: "idea", kind: "project", name: "Just an idea", sub: "no reader — define it from scratch", ph: "",
    ic: `<path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.7.7-1 1.3-1 2.5H9c0-1.2-.3-1.8-1-2.5A6 6 0 0 1 12 3z"/>` },
];
const P_BY_ID = Object.fromEntries(POINTERS.map((p) => [p.id, p]));

const blank = () => ({
  phase: "empty",          // empty · ingesting · found · selecting · structuring · confirm · defined · blocked
  pointer: "site",
  input: "",
  steps: [],
  live: "",
  pool: null,              // the fact pool (core.emptyPool shape)
  facts: null,             // display facts (for the confirm strip)
  dropped: {},             // fact key -> removed values (facts are removable, never typed)
  readings: [],            // model-interpreted readings (repo/folder/url/paste)
  picked: 0,
  cachedRead: "",          // the raw bytes read — so redraft never re-fetches
  kind: "project",
  name: "",
  chips: null,             // seeded define chips { category[], audience[], essence[], goals[] }
  added: { category: [], audience: [], essence: [], goals: [] },
  structured: null,        // the structured/composed context awaiting publish
  published: null,
  blocked: null,
  candidates: [],          // ~/.claude/projects discovery
});
let st = blank();

// ---------------------------------------------------------------------------------------------
// the connect chip
// ---------------------------------------------------------------------------------------------
mountConnect($("chip-dock"), {
  scope: { reason: "ideafetch — read what you already built and turn it into your project", models: ["sonnet"], contextKinds: KINDS },
  context: "none",
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; onReady(); },
  onDisconnect: () => { relay = null; render(); },
});

async function onReady() {
  if (st.phase === "empty") { void discoverProjects(); }
  render();
}

// ---------------------------------------------------------------------------------------------
// stream primitive + step log
// ---------------------------------------------------------------------------------------------
function sysline(t) { const e = $("sysline"); if (!e) return; e.hidden = !t; e.textContent = t || ""; }
function step(line, tone) {
  st.steps.push({ line, tone });
  const box = $("if-steps");
  if (box) { const row = el("div", "step" + (tone ? " " + tone : ""), line); box.append(row); box.scrollTop = box.scrollHeight; }
}
function setLive(text) { st.live = text; const l = $("if-live"); if (l) l.textContent = text; }
async function runStream({ prompt, agentic, onTool, onResult, onText }) {
  const it = relay.stream(agentic ? { prompt, agentic: true } : { prompt });
  liveIter = it; let acc = "";
  try {
    for await (const d of it) {
      if (cancelled) break;
      if (d.type === "text") { acc += d.text; onText && onText(acc); }
      else if (d.type === "tool_proposed") onTool && onTool(d.call?.name || "tool", d);
      else if (d.type === "tool_result") onResult && onResult(d);
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
  } finally { liveIter = null; }
  return acc;
}
function abort() { cancelled = true; try { liveIter?.return?.(); } catch { /* closed */ } liveIter = null; }
function blocked(why, opts = {}) { st.blocked = { why, ...opts }; busy = false; st.phase = "blocked"; render(); }

// ---------------------------------------------------------------------------------------------
// input normalization
// ---------------------------------------------------------------------------------------------
function siteUrl(raw) {
  let t = String(raw || "").trim(); if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = "https://" + t;
  try { const u = new URL(t); if (!u.hostname.includes(".")) return null; return u; } catch { return null; }
}
function parseRepo(raw) {
  const t = String(raw || "").trim().replace(/\/+$/, ""); if (!t) return null;
  const ssh = t.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2].split("/")[0] };
  const bare = t.match(/^([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
  if (bare) return { owner: bare[1], repo: bare[2] };
  const u = siteUrl(t); if (!u) return null;
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return { bad: true };
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return { bad: true };
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}
function parseJson(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}
function verifyHexes(list, corpus) {
  const hay = String(corpus || "").toLowerCase(); const out = [];
  for (const raw of Array.isArray(list) ? list : []) { const v = str(raw).toLowerCase(); if (/^#[0-9a-f]{6}$/.test(v) && hay.includes(v) && !out.includes(v)) out.push(v); }
  return out.slice(0, 6);
}

// ---------------------------------------------------------------------------------------------
// GO — dispatch to the right reader
// ---------------------------------------------------------------------------------------------
async function go(pointerOverride, inputOverride) {
  if (!relay || busy) return;
  const pointer = pointerOverride || st.pointer;
  const input = str(inputOverride != null ? inputOverride : ($("if-input")?.value ?? st.input));
  st.pointer = pointer; st.input = input; st.kind = P_BY_ID[pointer].kind;

  if (pointer === "idea") { startDefine({ cold: true }); return; }
  if (pointer === "paste") {
    const body = str($("if-paste")?.value ?? "");
    if (!body) { sysline("Paste your about copy, deck or positioning doc first."); return; }
    st.input = body;
  } else if (!input) { sysline("Give it something to point at first."); return; }
  sysline("");

  cancelled = false; busy = true;
  Object.assign(st, { steps: [], pool: emptyPool(), facts: null, readings: [], dropped: {}, cachedRead: "", blocked: null, published: null });
  st.pool.kind = st.kind;
  st.phase = "ingesting"; render();
  try {
    if (pointer === "site") await readSite();
    else if (pointer === "repo") await readRepo();
    else if (pointer === "folder") await readFolder();
    else if (pointer === "url") await readUrl();
    else if (pointer === "paste") await readPaste();
  } catch (e) {
    if (!cancelled) blocked(`Your Claude stopped partway through — ${msg(e)}`);
  } finally { busy = false; }
}

// ---- WEBSITE → sb_brand (the headline reader; degrades gracefully) --------------------------
async function callBrand(url, name) {
  const raw = window.claude;
  if (!raw || typeof raw.request !== "function") return { unavailable: true };
  try { return await raw.request({ method: SB_BRAND_METHOD, params: { url, name } }); }
  catch (e) {
    const m = String(e?.message || e);
    if (/unknown method|unsupported|not.*support|no such method|INVALID_PARAMS|not.*implemented|unavailable|method not found/i.test(m)) return { unavailable: true };
    throw e;
  }
}
async function readSite() {
  const u = siteUrl(st.input);
  if (!u) { blocked("That doesn't look like a web address — try something like yourbrand.com.", { keepInput: true }); return; }
  const host = u.hostname.replace(/^www\./, "");
  setLive(`reading ${host} on your Claude…`); step(`asking the extractor to read ${host}…`);
  const res = await callBrand(u.href, host);
  if (cancelled) return;
  if (res?.unavailable) {
    step("the website extractor (sb_brand) isn't wired on this daemon yet", "bad");
    blocked("The website extractor isn't available on this Switchboard yet. It reads a site's real served CSS and catalogue server-side — coming soon. In the meantime, point at the repo, the folder, or paste your about copy.",
      { transfer: ["repo", "folder", "paste"] });
    return;
  }
  if (res && res.reachable === false) {
    step("site couldn't be read — dead, JS-only, or bot-blocked", "bad");
    blocked(`${host} wouldn't let your Claude read it — some sites block automated readers, or render only in JavaScript.`, { transfer: ["repo", "folder", "paste"] });
    return;
  }
  step(`read ${host} · ${(res.products || []).length} products · ${(res.palette || []).length} colours`, "good");
  const brand = poolFromBrand(res, u.href);
  st.pool.brand = brand;
  st.pool.name = brand.name; st.pool.domain = brand.domain;
  st.pool.sources.push({ kind: "site", ref: u.href });
  st.name = brand.name;
  st.facts = brandFacts(brand);
  // low-confidence: thin read (no products AND no palette AND no description) → flag but keep it
  st.lowConfidence = !(brand.products.length || brand.palette.length || brand.description);
  st.phase = "found"; render();
}
function brandFacts(b) {
  return {
    chips: [
      b.domain && { k: "domain", v: b.domain },
      b.category && { k: "category", v: b.category },
      b.platform && { k: "platform", v: b.platform },
      b.priceRange && { k: "prices", v: `${b.currency || ""}${b.priceRange.min}–${b.priceRange.max}` },
      (b.products.length) && { k: "catalogue", v: `${b.products.length} products` },
    ].filter(Boolean),
    products: b.products.map((p) => p.short),
    palette: b.palette,
    description: b.description || b.oneLine || "",
  };
}

// ---- GITHUB REPO → agentic WebFetch (server-side reader is sb_http; here on the user's Claude) ---
const SHARED_RULES = [
  "RULES:",
  "· `facts` is extracted ONCE. Never invent a fact the source does not state — return \"\" or [].",
  "· The three readings differ ONLY in interpretation; the facts are identical across all three.",
  "· Exactly one reading has \"recommended\": true.",
  "· Respond with ONLY the JSON object. No prose, no fences.",
].join("\n");
const PROJ_SHAPE = `{
  "facts": { "name": "", "stack": [], "packages": [], "docs": ["Title - path"], "links": [{"label":"repo","url":""}], "notableFiles": [], "status": "", "roadmap": [], "tasks": [] },
  "readings": [
    { "lens": "What the README claims", "summary": "", "state": "", "nextSteps": [""], "recommended": true },
    { "lens": "What the code actually is", "summary": "", "state": "", "nextSteps": [""], "recommended": false },
    { "lens": "Where it is right now", "summary": "", "state": "", "nextSteps": [""], "recommended": false }
  ]
}`;
function repoPrompt(owner, repo, cached) {
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
  return [
    "You are ideafetch's reader. Someone pointed at a GitHub repository. You run on THEIR Claude — nothing you read is uploaded.",
    cached ? `Here is the repository material already read — do NOT call any tool:\n"""\n${cached}\n"""`
      : ["Use WebFetch on these in order:", `1. ${base}/README.md`, `2. ${base}/package.json`, `3. ONLY if both failed: https://github.com/${owner}/${repo}`, "A 404 on any is normal — continue with what you got. Fetch nothing else."].join("\n"),
    "Extract ONE set of facts, then read them three ways. Respond with ONLY this JSON:", PROJ_SHAPE, SHARED_RULES,
    "· Derive `stack` from real dependency names / file extensions. `roadmap`/`tasks` are real open work the source names — [] rather than an invented plan.",
  ].join("\n\n");
}
async function readRepo() {
  const r = parseRepo(st.input);
  if (!r || r.bad) { blocked("That isn't a GitHub repo URL — try github.com/you/repo.", { keepInput: true }); return; }
  setLive(`reading ${r.owner}/${r.repo} on your Claude…`); step(`reading ${r.owner}/${r.repo} as an anonymous visitor…`);
  let okFetches = 0, attempts = 0;
  const raw = await runStream({
    prompt: repoPrompt(r.owner, r.repo, null), agentic: true,
    onTool: (name, d) => { if (name !== "WebFetch") { step("tool → " + name); return; } attempts++; const url = str(d.call?.arguments?.url || d.call?.input?.url); step(url ? `fetching ${url.replace(/^https?:\/\//, "")}…` : "fetching…"); },
    onResult: (d) => { const t = resultText(d); const nf = /^\s*404: Not Found/i.test(t) || /\b404\b/.test(str(d.result?.error?.message)); if (d.result?.ok && t && t.length > 40 && !nf) { okFetches++; if (st.cachedRead.length < 16000) st.cachedRead = (st.cachedRead + "\n\n" + t).slice(0, 16000); step(`read · ${kb(t.length)}`, "good"); } else step("not there — that's fine, continuing", "dim"); },
    onText: (acc) => setLive(`drafting three readings… ${(acc.length / 1024).toFixed(1)} kb`),
  });
  if (cancelled) return;
  if (!okFetches && attempts) { blocked("GitHub returned 404 — that repo is private or doesn't exist. Your Claude reads GitHub anonymously, so private repos aren't reachable. If it's on disk, point at the folder.", { transfer: ["folder"], prefill: `~/Projects/${r.repo}` }); return; }
  landProject(raw, st.cachedRead, { kind: "github", url: `https://github.com/${r.owner}/${r.repo}` });
}

// ---- FOLDER → storage.bind (no network) -----------------------------------------------------
const FOLDER_PRIORITY = ["README.md", "readme.md", "package.json", "ROADMAP.md", "CLAUDE.md"];
const PROJECT_MARKERS = ["README.md", "readme.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "CLAUDE.md"];
function folderPrompt(path, corpus) {
  return [
    "You are ideafetch's reader. Someone pointed at a folder on their own machine. These files were read on that machine and handed straight to you — no network request, nothing left the disk.",
    `THE FOLDER: ${path}`, `Work only from this — do NOT call any tool:\n"""\n${corpus}\n"""`,
    "Extract ONE set of facts, then read them three ways. Respond with ONLY this JSON:", PROJ_SHAPE, SHARED_RULES,
    "· Derive `stack` from real dependency names / file extensions above. `notableFiles` must be paths that appear above.",
  ].join("\n\n");
}
async function readFolder() {
  const path = st.input;
  let before = null; try { before = await relay.storage.info(); } catch { before = null; }
  step(`asking to bind ${path} — approve the path in Switchboard`); setLive("waiting for you to approve the folder…");
  let info = null; try { info = await relay.storage.bind(path); } catch { info = null; }
  if (!info || cancelled) { await restoreBind(before); if (!cancelled) blocked("You didn't approve that folder, so nothing was read."); return; }
  const folder = info.folder || path;
  step(`bound · ${folder}`, "good");
  let keys = []; try { keys = await relay.storage.list(); } catch { keys = []; }
  const hasMarker = keys.some((k) => PROJECT_MARKERS.includes(k));
  const picked = pickFiles(keys);
  if (!hasMarker || !picked.length) { await restoreBind(before); blocked(`${basename(folder)} has no README, package.json or docs — a folder is a project only if it carries one. Nothing here to read yet.`, { transfer: ["site", "paste"] }); return; }
  step(`${keys.length} file${keys.length === 1 ? "" : "s"} · reading ${picked.length}`);
  let corpus = "";
  for (const k of picked) { if (corpus.length > 24000) { corpus += "\n[…truncated]"; break; } let body = null; try { body = await relay.storage.get(k); } catch { body = null; } if (body) corpus += `\n--- ${k} ---\n${body}\n`; }
  corpus = corpus.slice(0, 24000);
  // restore the sandbox the instant the bytes are in memory — the two-consent bracket (point.js §folder)
  await restoreBind(before);
  if (!corpus.trim()) { blocked(`${basename(folder)} has nothing readable in it yet.`, { transfer: ["site", "paste"] }); return; }
  st.cachedRead = corpus; st.folderPath = folder;
  step("drafting… (nothing left this machine)"); setLive("drafting three readings… 0.0 kb");
  const raw = await runStream({ prompt: folderPrompt(folder, corpus), onText: (acc) => setLive(`drafting three readings… ${(acc.length / 1024).toFixed(1)} kb`) });
  if (cancelled) return;
  landProject(raw, corpus, { kind: "folder", path: folder });
}
function pickFiles(keys) {
  const seen = new Set(), out = [];
  const take = (k) => { if (k && !seen.has(k)) { seen.add(k); out.push(k); } };
  for (const p of FOLDER_PRIORITY) { const hit = keys.find((k) => k === p); if (hit) take(hit); }
  for (const k of keys.filter((x) => /^docs\/.+\.md$/i.test(x)).slice(0, 6)) take(k);
  for (const k of keys.filter((x) => /^[^/]+\.md$/i.test(x)).slice(0, 6)) take(k);
  return out.slice(0, 14);
}
async function restoreBind(before) { if (!before || !before.folder) return; try { await relay.storage.bind(before.folder); } catch { /* stays frozen; nothing else touches storage here */ } }
function basename(p) { return String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "folder"; }

// ---- URL (docs / competitor) → agentic WebFetch --------------------------------------------
function urlPrompt(url, cached) {
  return [
    "You are ideafetch's reader. Someone pointed at a URL (docs, a wiki, or a competitor page). You run on THEIR Claude.",
    cached ? `Here is the page already read — do NOT call any tool:\n"""\n${cached}\n"""` : `Use WebFetch to read ${url}. Fetch only that one page.`,
    "Return ONLY this JSON:",
    `{"facts":{"name":"","summary":"","links":[{"label":"","url":""}],"stack":[],"roadmap":[]},"readings":[{"lens":"What this page is about","summary":"","state":"","nextSteps":[""],"recommended":true},{"lens":"What it implies for the project","summary":"","state":"","nextSteps":[""],"recommended":false},{"lens":"Where it fits","summary":"","state":"","nextSteps":[""],"recommended":false}]}`,
    SHARED_RULES,
  ].join("\n\n");
}
async function readUrl() {
  const u = siteUrl(st.input);
  if (!u) { blocked("That doesn't look like a URL.", { keepInput: true }); return; }
  const host = u.hostname.replace(/^www\./, "");
  setLive(`reading ${host}…`); step(`reading ${host} on your Claude…`);
  let ok = 0;
  const raw = await runStream({
    prompt: urlPrompt(u.href, null), agentic: true,
    onTool: (n) => step(n === "WebFetch" ? `fetching ${host}…` : "tool → " + n),
    onResult: (d) => { const t = resultText(d); if (d.result?.ok && t && t.length > 40) { ok++; if (st.cachedRead.length < 16000) st.cachedRead = (st.cachedRead + "\n\n" + t).slice(0, 16000); step(`page read · ${kb(t.length)}`, "good"); } else step("blocked: " + (d.result?.error?.message || "that page wouldn't open"), "bad"); },
    onText: (acc) => setLive(`reading… ${(acc.length / 1024).toFixed(1)} kb`),
  });
  if (cancelled) return;
  if (!ok) { blocked(`${host} wouldn't open for your Claude.`, { transfer: ["paste"] }); return; }
  landProject(raw, st.cachedRead, { kind: "url", url: u.href });
}

// ---- PASTE → one model pass, no fetch -------------------------------------------------------
function pastePrompt(body) {
  return [
    "You are ideafetch's reader. The user pasted their own material (about copy, a deck, a positioning doc). No fetch — read only this.",
    `PASTED:\n"""\n${body.slice(0, 16000)}\n"""`,
    "Structure it into positioning language, audience cues and goals in the USER'S OWN WORDS. Return ONLY this JSON:",
    `{"facts":{"name":"","summary":"","stack":[],"roadmap":[]},"readings":[{"lens":"In their own words","summary":"","state":"","nextSteps":[""],"recommended":true},{"lens":"The buyer's view","summary":"","state":"","nextSteps":[""],"recommended":false},{"lens":"The tight version","summary":"","state":"","nextSteps":[""],"recommended":false}]}`,
    SHARED_RULES,
  ].join("\n\n");
}
async function readPaste() {
  setLive("reading your text…"); step("structuring what you pasted (no fetch)…");
  const raw = await runStream({ prompt: pastePrompt(st.input), onText: (acc) => setLive(`structuring… ${(acc.length / 1024).toFixed(1)} kb`) });
  if (cancelled) return;
  landProject(raw, st.input, { kind: "paste" });
}

// ---- land a project reading (repo/folder/url/paste) -----------------------------------------
function landProject(raw, corpus, source) {
  const parsed = parseJson(raw);
  if (!parsed || !parsed.facts || !Array.isArray(parsed.readings) || !parsed.readings.length) {
    blocked("Your Claude answered, but not with a card — the reply wasn't the shape this page expects.", { transfer: ["paste"] });
    return;
  }
  const f = parsed.facts || {};
  const facts = {
    name: str(f.name), stack: arr(f.stack, 10), packages: arr(f.packages, 10), docs: arr(f.docs, 8),
    links: (Array.isArray(f.links) ? f.links : []).map((l) => ({ label: str(l?.label) || "link", url: str(l?.url) })).filter((l) => /^https?:\/\//i.test(l.url)).slice(0, 6),
    notableFiles: arr(f.notableFiles, 8), status: str(f.status), roadmap: arr(f.roadmap, 12), tasks: arr(f.tasks, 12), summary: str(f.summary),
  };
  const readings = parsed.readings.slice(0, 3).map((r, i) => ({
    lens: str(r?.lens) || `Reading ${i + 1}`, recommended: !!r?.recommended,
    summary: str(r?.summary), state: str(r?.state), nextSteps: arr(r?.nextSteps, 6),
  }));
  if (!readings.some((r) => r.recommended)) readings[0].recommended = true;
  let seen = false; for (const r of readings) { if (r.recommended && seen) r.recommended = false; else if (r.recommended) seen = true; }
  st.readings = readings; st.picked = Math.max(0, readings.findIndex((r) => r.recommended));
  const picked = readings[st.picked];
  st.pool.project = poolFromProject(facts, picked, source);
  st.pool.name = facts.name || basename(st.input); st.pool.sources.push(source);
  st.name = facts.name || basename(st.input);
  st.facts = projFacts(facts);
  st.lowConfidence = !(facts.stack.length || facts.summary || readings[0].summary);
  st.phase = "found"; render();
}
function projFacts(f) {
  return {
    chips: [f.status && { k: "status", v: f.status }, f.stack.length && { k: "stack", v: f.stack.join(", ") }, f.packages.length && { k: "packages", v: `${f.packages.length}` }, f.docs.length && { k: "docs", v: `${f.docs.length}` }].filter(Boolean),
    products: [], palette: [], description: f.summary,
  };
}

// ---------------------------------------------------------------------------------------------
// ~/.claude/projects discovery (folder reader, high-delight) — directory NAMES only
// ---------------------------------------------------------------------------------------------
async function discoverProjects() {
  const raw = window.claude;
  if (!raw || typeof raw.request !== "function") return;
  try {
    // best-effort: the daemon may expose a project enumerator; degrade silently if not.
    const res = await raw.request({ method: "sb_projects", params: {} }).catch(() => null);
    const list = Array.isArray(res?.projects) ? res.projects : [];
    st.candidates = list.map((p) => ({ path: str(p?.path), name: basename(p?.path) })).filter((p) => p.path).slice(0, 8);
    if (st.candidates.length && st.phase === "empty") render();
  } catch { /* no picker — the typed-path folder reader is the fallback */ }
}

// ---------------------------------------------------------------------------------------------
// DEFINE — the multi-select facet board (docs/IDEAFETCH.md §3)
// ---------------------------------------------------------------------------------------------
function startDefine({ cold } = {}) {
  st.kind = cold ? "project" : st.kind;
  if (cold) { st.pool = st.pool || emptyPool(); st.name = st.name || ""; }
  // seed chips from the pool; a picked model reading enriches essence/goals
  const chips = seedChips(st.pool || emptyPool());
  // fold the picked reading's summary/nextSteps into essence/goals seeds (as facts, pre-checked lightly)
  const picked = st.readings[st.picked];
  if (picked) {
    if (picked.summary && !chips.essence.some((c) => c.text === picked.summary)) chips.essence.unshift({ text: picked.summary, from: "the reading you picked", checked: true });
    for (const nx of (picked.nextSteps || [])) if (!chips.goals.some((c) => c.text === nx)) chips.goals.push({ text: nx, from: "the reading you picked", checked: false });
  }
  st.chips = chips;
  st.added = { category: [], audience: [], essence: [], goals: [] };
  st.phase = "selecting"; render();
}

async function doDefine() {
  if (!relay || busy) return;
  const selections = collectSelections(st.chips, st.added);
  if (selectionCount(selections) === 0) { sysline("Check at least one thing — or add your own — so there's something to define."); return; }
  sysline("");
  busy = true; cancelled = false; st.phase = "structuring"; render();
  const sb = { complete: (a) => relay.complete(a) };
  try {
    const { context } = await structure({ selections, kind: st.kind, name: st.name, pool: st.pool, priorFolder: st.folderPath }, sb);
    st.structured = context; st.name = context.name;
    st.phase = "confirm"; busy = false; render();
  } catch (e) {
    busy = false;
    blocked(`Structuring didn't land — ${msg(e)}`, { back: "selecting" });
  }
}

async function publish() {
  if (!relay || busy || !st.structured) return;
  busy = true; render();
  const c = st.structured;
  try {
    const id = await relay.context.publish({ id: c.id, name: c.name, kind: c.kind, data: c.data });
    st.published = { id: id || c.id, name: c.name, kind: c.kind, folder: c.data.folder || "" };
    // best-effort setActiveProject (control-plane op; degrade silently if the daemon lacks the BYOP op)
    void setActiveProject(id || c.id);
    busy = false; st.phase = "defined"; render();
  } catch (e) { busy = false; blocked(`Your library didn't take it — ${msg(e)}`, { back: "confirm" }); }
}
async function setActiveProject(id) {
  const raw = window.claude;
  if (!raw || typeof raw.request !== "function" || !id) return false;
  try { await raw.request({ method: "claude_context", params: { op: "setActive", id } }); return true; }
  catch { return false; } // panel selection is the fallback consent path today
}

// ---------------------------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------------------------
function render() {
  const stage = $("stage");
  if (!stage) return;
  stage.textContent = "";
  if (!relay) { stage.append(viewDisconnected()); return; }
  switch (st.phase) {
    case "empty": stage.append(viewEmpty()); break;
    case "ingesting": stage.append(viewIngesting()); break;
    case "found": stage.append(viewFound()); break;
    case "selecting": stage.append(viewSelecting()); break;
    case "structuring": stage.append(viewStructuring()); break;
    case "confirm": stage.append(viewConfirm()); break;
    case "defined": stage.append(viewDefined()); break;
    case "blocked": stage.append(viewBlocked()); break;
    default: stage.append(viewEmpty());
  }
}

function sec(kickA, kickB, kickI) {
  const s = el("section", "sec");
  const k = el("p", "kick");
  k.append(el("b", null, kickA)); if (kickB) k.append(document.createTextNode(kickB)); if (kickI) k.append(el("i", null, kickI));
  s.append(k);
  return s;
}

function viewDisconnected() {
  const s = el("div", "panel");
  s.append(el("div", "lead", notInstalled ? "Install Switchboard to point ideafetch at your site, repo or folder." : "Connect Switchboard (top right) to start — ideafetch reads on your own Claude, nothing is uploaded."));
  return s;
}

function viewEmpty() {
  const wrap = document.createDocumentFragment();
  const s = sec("point at it", null, "six ways in — pick what you already have");
  s.append(el("div", "lead", "ideabrain reasons about a new idea. ideafetch does the opposite: it reads what you already built and turns it into the one project context every wrapp opens pre-loaded."));
  const tiles = el("div", "tiles");
  for (const p of POINTERS) {
    const t = el("button", "tile" + (p.id === st.pointer ? " on" : "")); t.type = "button";
    const ic = el("span", "ic"); ic.innerHTML = `<svg viewBox="0 0 24 24">${p.ic}</svg>`;
    const body = el("div"); body.append(el("b", null, p.name), el("div", "tsub", p.sub));
    t.append(ic, body);
    t.onclick = () => { st.pointer = p.id; st.kind = p.kind; render(); };
    tiles.append(t);
  }
  s.append(tiles);

  const cur = P_BY_ID[st.pointer];
  if (st.pointer === "paste") {
    const ta = el("textarea"); ta.id = "if-paste"; ta.placeholder = "Paste your about copy, a deck, a positioning doc…"; ta.spellcheck = false;
    s.append(el("div", "microhint", "no fetch, no bind — a single pass structures your text in your own words"));
    s.append(ta);
    const row = el("div", "row"); const btn = el("button", "btn btn-primary", "Read it ▸"); btn.onclick = () => go(); row.append(btn); s.append(row);
  } else if (st.pointer === "idea") {
    s.append(el("div", "microhint", "no reader runs — every dimension starts blank and you assert from scratch"));
    const row = el("div", "row"); const btn = el("button", "btn btn-primary", "Define it →"); btn.onclick = () => go(); row.append(btn); s.append(row);
  } else {
    const row = el("div", "inputrow");
    const inp = el("input"); inp.type = "text"; inp.id = "if-input"; inp.placeholder = cur.ph; inp.value = st.input || "";
    inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
    const btn = el("button", "btn btn-primary", "Read it ▸"); btn.onclick = () => go();
    row.append(inp, btn); s.append(row);
    // ~/.claude/projects candidates for the folder reader
    if (st.pointer === "folder" && st.candidates.length) {
      const cands = el("div", "cands");
      cands.append(el("span", "microhint", "or pick one Claude Code already knows:"));
      for (const c of st.candidates) { const b = el("button", "cand", c.name); b.title = c.path; b.onclick = () => go("folder", c.path); cands.append(b); }
      s.append(cands);
    }
  }
  s.append(el("div", "privacy", "Runs on your Claude through Switchboard. The site is read by your model; the folder is read on this machine with no network at all; nothing is uploaded. This writes one context to your library — it never opens what's inside your other contexts."));
  wrap.append(s);
  return wrap;
}

function viewIngesting() {
  const s = sec("reading", null, P_BY_ID[st.pointer]?.name || "");
  const panel = el("div", "panel");
  panel.append(el("div", "live", st.live || "reading…"));
  const steps = el("div", "steps"); steps.id = "if-steps";
  for (const st2 of st.steps) steps.append(el("div", "step" + (st2.tone ? " " + st2.tone : ""), st2.line));
  panel.append(steps);
  const row = el("div", "row"); const cancel = el("button", "btn", "Cancel"); cancel.onclick = () => { abort(); st.phase = "empty"; render(); }; row.append(cancel); panel.append(row);
  s.append(panel);
  return s;
}

function factsStrip(container) {
  const f = st.facts; if (!f) return;
  const strip = el("div", "facts");
  for (const c of (f.chips || [])) {
    const dropped = (st.dropped.chips || []).includes(c.v);
    if (dropped) continue;
    const chip = el("span", "fact"); chip.append(document.createTextNode(`${c.k}: ${c.v}`));
    const x = el("span", "x", "×"); x.title = "remove this fact"; x.onclick = () => { (st.dropped.chips ||= []).push(c.v); render(); };
    chip.append(x); strip.append(chip);
  }
  container.append(strip);
  if (f.palette && f.palette.length) {
    const sw = el("div", "swatches"); sw.style.marginTop = "10px";
    for (const p of f.palette) { const b = el("span", "sw"); b.style.background = p.hex; b.title = p.from ? `${p.hex} — ${p.from}` : p.hex; sw.append(b); }
    sw.append(el("span", "factnote", "read from served CSS — provenance attached, not a guess"));
    container.append(sw);
  } else if (st.pointer === "site") {
    container.append(el("div", "factnote", "no colours read — this page could see text, not the CSS the site serves"));
  }
  if (f.products && f.products.length) {
    container.append(el("div", "factnote", `catalogue: ${f.products.slice(0, 6).join(" · ")}${f.products.length > 6 ? ` +${f.products.length - 6}` : ""}`));
  }
}

function viewFound() {
  const s = sec("what we read", null, st.lowConfidence ? "a thin read — honest about it" : "confirm what's here, then define what it is");
  const panel = el("div", "panel");
  // name
  const nameRow = el("div", "inputrow");
  const nm = el("input"); nm.type = "text"; nm.value = st.name || ""; nm.placeholder = "name";
  nm.oninput = () => { st.name = nm.value; };
  nameRow.append(nm); panel.append(nameRow);
  if (st.lowConfidence) panel.append(el("div", "factnote", "this read is thin (an SPA shell, a sparse page, or a non-standard store). Shown honestly — add a second reader or paste to enrich it."));
  factsStrip(panel);
  if (st.facts?.description) panel.append(el("div", "lead", st.facts.description));
  // model readings (repo/folder/url/paste) — three lenses over byte-identical facts
  if (st.readings.length) {
    const rs = el("div", "readings");
    st.readings.forEach((r, i) => {
      const card = el("div", "reading" + (i === st.picked ? " on" : "")); card.onclick = () => { st.picked = i; render(); };
      if (i === st.picked) card.append(el("span", "star", "★ picked"));
      card.append(el("div", "lens", r.lens));
      if (r.summary) card.append(el("div", "rl", r.summary));
      if (r.state) card.append(el("div", "rl", r.state));
      rs.append(card);
    });
    panel.append(rs);
  }
  const row = el("div", "row");
  const def = el("button", "btn btn-primary", "Define your project →"); def.onclick = () => startDefine({});
  const again = el("button", "btn", "Point at something else"); again.onclick = () => { st.phase = "empty"; render(); };
  row.append(def, again); panel.append(row);
  s.append(panel);
  return s;
}

function viewSelecting() {
  const s = sec("define your project", null, "check what fits — add anything missing. You assert; the tool only structures.");
  const panel = el("div", "panel");
  const chips = st.chips || seedChips(st.pool || emptyPool());
  const DIMS = [
    { key: "category", label: "Category", note: "pick 1–2 — what kind of thing this is", cap: 2 },
    { key: "audience", label: "Audience", note: "who it's for — all that apply", cap: 0 },
    { key: "essence", label: "Essence", note: "the non-negotiables that make it itself", cap: 0 },
    { key: "goals", label: "Goals", note: "what winning looks like right now", cap: 0 },
  ];
  for (const d of DIMS) {
    const dim = el("div", "dim");
    const head = el("div", "dimhead", d.label); head.append(el("i", null, d.note)); dim.append(head);
    const box = el("div", "facetchips");
    const list = chips[d.key] || [];
    const added = st.added[d.key] || [];
    if (!list.length && !added.length) dim.append(el("div", "dimempty", "nothing read for this — add your own below"));
    for (const c of list) {
      const chip = el("button", "facet" + (c.checked ? " on" : "") + (c.gap ? " gap" : "")); chip.type = "button";
      const bx = el("span", "box", c.checked ? "✓" : ""); chip.append(bx, document.createTextNode(c.text));
      if (c.from) chip.append(el("span", "prov", c.from));
      chip.onclick = () => {
        c.checked = !c.checked;
        if (d.cap && c.checked) { const on = list.filter((x) => x.checked); if (on.length > d.cap) { const first = on.find((x) => x !== c); if (first) first.checked = false; } }
        render();
      };
      box.append(chip);
    }
    for (const a of added) {
      const chip = el("button", "facet on"); chip.type = "button";
      chip.append(el("span", "box", "✓"), document.createTextNode(a), el("span", "prov", "you"));
      chip.onclick = () => { st.added[d.key] = added.filter((x) => x !== a); render(); };
      box.append(chip);
    }
    // + add your own
    const add = el("button", "addbtn", "+ add"); add.type = "button";
    add.onclick = () => {
      const row = el("span", "addrow"); const inp = el("input"); inp.type = "text"; inp.placeholder = `add ${d.label.toLowerCase()}…`;
      const commit = () => { const v = str(inp.value); if (v) { (st.added[d.key] ||= []).push(v); } render(); };
      inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") render(); };
      inp.onblur = () => { if (str(inp.value)) commit(); };
      add.replaceWith(row); row.append(inp); inp.focus();
    };
    box.append(add);
    dim.append(box); panel.append(dim);
  }
  const seededFrom = [st.pool?.name, st.pool?.brand ? "brand" : null, st.pool?.project ? "project" : null].filter(Boolean).join(" · ");
  panel.append(el("div", "seedline", seededFrom ? `seeded from: ${seededFrom} — unchecking is as meaningful as checking` : "nothing seeded — you're defining from scratch"));
  const row = el("div", "row");
  const define = el("button", "btn btn-primary", "Define →"); define.onclick = () => doDefine();
  row.append(define);
  if (st.readings.length || st.facts) { const back = el("button", "btn", "← back to the reading"); back.onclick = () => { st.phase = "found"; render(); }; row.append(back); }
  panel.append(row);
  s.append(panel);
  return s;
}

function viewStructuring() {
  const s = sec("structuring", null, "clustering your picks and naming the project — inventing nothing");
  const panel = el("div", "panel"); panel.append(el("div", "live", "structuring your selections…"));
  s.append(panel); return s;
}

function viewConfirm() {
  const c = st.structured || {}; const d = c.data || {};
  const s = sec("confirm", null, "this is what gets published — edit the name, or go back and re-select");
  const panel = el("div", "panel");
  const nameRow = el("div", "inputrow"); const nm = el("input"); nm.type = "text"; nm.value = c.name || ""; nm.oninput = () => { st.structured.name = nm.value; }; nameRow.append(nm);
  const pill = el("span", "fact", `kind: ${c.kind}`); nameRow.append(pill);
  panel.append(nameRow);
  if (d.oneLine) panel.append(el("div", "lead", d.oneLine));
  const facts = el("div", "facts");
  const show = (label, v) => { if (v && v.length) facts.append(el("span", "fact", `${label}: ${Array.isArray(v) ? v.join(", ") : v}`)); };
  show("category", d.category); show("audience", d.audience); show("essence", d.essence); show("goals", d.goals);
  if (d.palette) { const sw = el("div", "swatches"); for (const h of d.palette) { const b = el("span", "sw"); b.style.background = h; sw.append(b); } panel.append(sw); }
  panel.append(facts);
  if (d.folder) panel.append(el("div", "factnote", `folder: ${d.folder} — wrapps auto-bind to the real files`));
  const row = el("div", "row");
  const bank = el("button", "btn btn-primary", busy ? "publishing…" : "Establish it ✓"); bank.disabled = busy; bank.onclick = () => publish();
  const back = el("button", "btn", "← re-select"); back.onclick = () => { st.phase = "selecting"; render(); };
  row.append(bank, back); panel.append(row);
  s.append(panel);
  return s;
}

const READY = {
  brand: [["adforge", "ad concepts in your voice"], ["adgen", "six ad directions off your positioning"], ["aplus", "Amazon A+ from your product list"], ["prism", "on-brand images, no prompting"], ["bank", "your brand card in the vault"]],
  project: [["redline", "review your page knowing what this project is"], ["bank", "notes and tasks beside the work"], ["huddle", "get on a call with your Claude about these files"], ["batch", "draft your YC application from what exists"], ["ideabrain", "pressure-test a new direction in real context"]],
};
function viewDefined() {
  const p = st.published || {};
  const s = sec("established", null, "every wrapp now opens pre-loaded");
  const panel = el("div", "panel");
  panel.append(el("div", "lead", `“${p.name}” is now your ${p.kind}. Every connected wrapp reads it through your library — no blank fields, no re-typing.`));
  if (p.folder) panel.append(el("div", "factnote", `bound to ${p.folder} — file-aware wrapps open the real directory`));
  const list = el("div", "ready-list");
  for (const [id, line] of (READY[p.kind] || READY.project)) { const item = el("div", "ready-item"); item.append(el("b", null, id), el("span", null, line)); list.append(item); }
  panel.append(list);
  const row = el("div", "row");
  const edit = el("button", "btn", "Edit what it is"); edit.onclick = () => { st.phase = "selecting"; render(); };
  const more = el("button", "btn", "Establish another"); more.onclick = () => { st = blank(); void discoverProjects(); render(); };
  row.append(edit, more); panel.append(row);
  s.append(panel);
  return s;
}

function viewBlocked() {
  const b = st.blocked || {};
  const s = sec("couldn't read it", null, "honest about why — try another way in");
  const panel = el("div", "panel");
  panel.append(el("div", "lead", b.why || "That didn't work."));
  const row = el("div", "row");
  for (const t of (b.transfer || [])) {
    const tp = P_BY_ID[t]; if (!tp) continue;
    const btn = el("button", "btn", `try ${tp.name.toLowerCase()}`);
    btn.onclick = () => { st.pointer = t; st.kind = tp.kind; if (b.prefill) st.input = b.prefill; st.phase = "empty"; render(); };
    row.append(btn);
  }
  if (b.back) { const back = el("button", "btn", "← back"); back.onclick = () => { st.phase = b.back; render(); }; row.append(back); }
  const home = el("button", "btn", "start over"); home.onclick = () => { st.phase = "empty"; render(); };
  row.append(home); panel.append(row);
  s.append(panel);
  return s;
}

// ---------------------------------------------------------------------------------------------
// first paint
// ---------------------------------------------------------------------------------------------
render();
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { relay = r; onReady(); return; }
  } else if (r && r.installed === false) notInstalled = true;
  render();
})();
