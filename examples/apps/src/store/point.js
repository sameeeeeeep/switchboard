// POINT AT IT AND IT'S YOURS — the store home's first-project setup flow.
//
// Every wrapp in the catalog is proactive now: connect it and it generates options FROM the user's
// project. A brand-new user's library is EMPTY, so proactive wrapps have nothing to work from.
// This module is the gate: three pointers (a site, a GitHub repo, a folder on this Mac) that each
// end in ONE banked context every other wrapp can borrow.
//
// DOCTRINE — never forms-first. After the single pointer the flow shows WHAT IT FOUND as three
// whole readings (one ★ recommended) and the user confirms or tweaks. They never author a blank
// field. The three readings share BYTE-IDENTICAL facts (palette hexes, product titles, stack,
// package names, price band): only the interpretation differs. Three different sets of "facts"
// would mean the extractor was guessing, and the user would be picking which guess to believe.
//
// PRIVACY — everything runs on the user's own Claude through the broker. The site is read by their
// model (WebFetch), the folder is read on this machine (storage.bind + storage.get, no network at
// all), and the operator never sees any of it.
//
// PALETTE HONESTY — a model handed a summarised WebFetch rendering CANNOT see CSS, so it invents
// hexes (docs/CONTEXT-KINDS.md names this as the canonical failure). Mitigation is three-layered:
// the prompt forbids approximation, every returned hex is string-matched against the raw read
// before it can reach a card, and zero survivors renders an honest "no colours read" note with a
// pointer to Bank's extractor. An empty palette is correct; three plausible invented hexes are a
// lie that propagates into every ad prompt downstream.
import { APP_BY_ID } from "./catalog.js";
import { famOf, glyphSvg } from "./glyphs.js";

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const msg = (e) => String(e?.message || e).slice(0, 200);
const now = () => new Date().getTime();
const str = (v) => (typeof v === "string" ? v.trim() : "");
const arr = (v, cap = 12) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, cap) : []);
const resultText = (d) => (d?.result?.content ?? []).map((c) => c?.text ?? "").join("");
const kb = (n) => (n < 1024 ? `${n} b` : `${Math.round(n / 1024)} kb`);

export function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function basename(p) {
  return String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "folder";
}
// The guarded parse from identity.js — a malformed reply is a retry line, never a blank screen.
function parseJson(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
// POINTERS
// ---------------------------------------------------------------------------------------------
const PT_GLYPH = {
  site: `<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5S14.4 18.4 12 20.5C9.6 18.4 8.4 15.1 8.4 12S9.6 6.1 12 3.5z"/>`,
  repo: `<path d="M5 4.5h11l3 3V19a.5.5 0 0 1-.5.5h-13A.5.5 0 0 1 5 19z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>`,
  folder: `<path d="M3.5 7.5a1 1 0 0 1 1-1H9l2 2.2h8.5a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>`,
};
const TILES = [
  {
    id: "site", kind: "brand", name: "Website", sub: "a live site → a brand",
    ph: "yourbrand.com",
    hint: "your Claude reads the page you name — and at most one more page on the same site. Nothing off that host.",
  },
  {
    id: "repo", kind: "project", name: "GitHub repo", sub: "a repo → a project",
    ph: "github.com/you/repo",
    hint: "your Claude reads the README and package.json as an anonymous visitor — so this works on public repos.",
  },
  {
    id: "folder", kind: "project", name: "Folder on this Mac", sub: "a directory → a project, and apps open the real files",
    ph: "~/Projects/yourthing",
    hint: "no fetch, no network — your files are read on this Mac and go straight into your own Claude.",
  },
];
const TILE_BY_ID = Object.fromEntries(TILES.map((t) => [t.id, t]));

const PRIVACY =
  "Runs on your Claude through Switchboard. The site is read by your model, the folder is read on this machine, " +
  "and nothing is uploaded — the operator never sees it. This page writes to your library; it never opens what's " +
  "inside your other contexts.";

// The interpreted fields — the ONLY thing that differs between the three readings.
const SITE_FIELDS = [
  { key: "oneLine", label: "In one line", multiline: false },
  { key: "positioning", label: "Positioning", multiline: true },
  { key: "voice", label: "Voice", multiline: true },
  { key: "audience", label: "Audience", multiline: true },
];
const PROJ_FIELDS = [
  { key: "summary", label: "What it is", multiline: true },
  { key: "state", label: "Where it is right now", multiline: true },
  { key: "nextSteps", label: "Next steps", multiline: true, list: true },
];
const fieldsFor = (kind) => (kind === "brand" ? SITE_FIELDS : PROJ_FIELDS);

const STEER_CHIPS = {
  site: ["more specific", "less marketing-speak", "name the buyer"],
  repo: ["more technical", "what's unfinished", "shorter"],
  folder: ["more technical", "what's unfinished", "shorter"],
};

// Which wrapps light up for a freshly banked context, and the honest one line of what each will
// now do with it. Names/links come from catalog.js so the store and this screen can't drift.
const READY = {
  brand: [
    ["adforge", "three Meta ad concepts in your voice, not a stranger's"],
    ["adgen", "six ad directions at once off your positioning"],
    ["aplus", "Amazon A+ content written from your own product list"],
    ["studio", "product shots that sit in your palette"],
    ["prism", "on-brand images, no prompt-engineering required"],
    ["shelf", "inventory triage against the products it just read"],
  ],
  project: [
    ["redline", "review your landing page knowing what this project actually is"],
    ["bank", "notes and tasks in plain .md beside the work"],
    ["huddle", "get on a call with your Claude about these exact files"],
    ["chat", "chat grounded in this project instead of from scratch"],
    ["cartridge", "spin the project into a playable artifact"],
    ["batch", "draft your YC application from what already exists"],
  ],
};

// ---------------------------------------------------------------------------------------------
// INPUT NORMALIZATION (client-side — a typo is a correction, never a dead end)
// ---------------------------------------------------------------------------------------------
export function siteUrl(raw) {
  let t = String(raw || "").trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = "https://" + t;
  try {
    const u = new URL(t);
    if (!u.hostname.includes(".")) return null;
    return u;
  } catch { return null; }
}
/** github.com/o/r · github.com/o/r/tree/main/x · git@github.com:o/r.git · bare o/r → {owner,repo} */
export function parseRepo(raw) {
  const t = String(raw || "").trim().replace(/\/+$/, "");
  if (!t) return null;
  const ssh = t.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2].split("/")[0] };
  // bare owner/repo — an owner never contains a dot, which keeps "nailin.it/x" out of this branch
  const bare = t.match(/^([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
  if (bare) return { owner: bare[1], repo: bare[2] };
  const u = siteUrl(t);
  if (!u) return null;
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return { bad: true };
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return { bad: true };
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}
/** A pasted value can pick its own tile — the user shouldn't have to have chosen the right one. */
export function detectPointer(v) {
  const t = String(v || "").trim();
  if (!t) return null;
  if (/^[~/]/.test(t) || /^[A-Za-z]:[\\/]/.test(t)) return "folder";
  if (/^git@github\.com:/i.test(t) || /(^|\/\/|\.)github\.com\//i.test(t)) return "repo";
  return null;
}

/** Only hexes that appear VERBATIM in the bytes we actually read survive. */
export function verifyHexes(list, corpus) {
  const hay = String(corpus || "").toLowerCase();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const v = str(raw).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(v)) continue;
    if (!hay.includes(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, 6);
}

// ---------------------------------------------------------------------------------------------
// PROMPTS
// ---------------------------------------------------------------------------------------------
const SHARED_RULES = [
  "RULES — all of them matter:",
  "· `facts` is extracted ONCE and is identical no matter which reading is picked. Never vary a fact between readings.",
  "· The three readings differ ONLY in interpretation — the lens they are read through. Same facts, three honest angles.",
  "· Exactly one reading has \"recommended\": true.",
  "· Absent is not invented: if the source does not say, return an empty string. Do not infer a founder story, a funding stage, a team size, or a price.",
  "· Respond with ONLY the JSON object. No prose before it, no fences around it.",
].join("\n");

const SITE_SHAPE = `{
  "facts": {
    "name": "<the brand name as the site writes it>",
    "domain": "<host, no protocol>",
    "category": "<the dominant product type, or \\"\\">",
    "products": ["<real product titles you saw, max 8>"],
    "priceBand": "<flat display string like \\"INR 449-INR 999\\", or \\"\\">",
    "paletteRaw": ["#rrggbb"]
  },
  "readings": [
    { "lens": "How they describe themselves", "oneLine": "", "positioning": "", "voice": "", "audience": "", "recommended": true },
    { "lens": "What the catalogue says", "oneLine": "", "positioning": "", "voice": "", "audience": "", "recommended": false },
    { "lens": "How a buyer would describe it", "oneLine": "", "positioning": "", "voice": "", "audience": "", "recommended": false }
  ]
}`;

function sitePrompt(url, cached, priorLenses) {
  return [
    "You are Switchboard's setup reader. Someone just pointed their own store home at their own website. You are running on THEIR Claude, on THEIR machine — nothing you read is uploaded anywhere.",
    cached
      ? `Here is the page content you already read — do NOT call WebFetch or any other tool:\n"""\n${cached}\n"""`
      : `Use WebFetch to read ${url}. If that page names an obvious about page or product index on the SAME host, you may WebFetch ONE more. Do not fetch anything off this host. Two fetches maximum.`,
    "Extract ONE set of facts, then read those same facts three ways.",
    "Respond with ONLY a JSON object in exactly this shape:",
    SITE_SHAPE,
    SHARED_RULES,
    "· `products` are REAL product titles you saw on the page — flat strings, max 8. If you saw no catalogue, return [].",
    "· `paletteRaw`: return ONLY colour values that appear VERBATIM in the page text you were given. If you cannot see any, return []. Never approximate a colour from a description of one — a guessed hex is worse than no hex, because it ends up in every ad this person generates.",
    "· Recommend reading A when the site has real written copy; recommend B when the copy is thin but the products are rich.",
    "· Every field must be traceable to something you actually read.",
    priorLenses ? `These lenses were already used: ${priorLenses}. Produce three fresh readings of the SAME facts.` : "",
  ].filter(Boolean).join("\n\n");
}

const PROJ_SHAPE = `{
  "facts": {
    "name": "<the project name — the README H1, before any em-dash tagline>",
    "stack": ["<real languages/tools you saw evidence of>"],
    "packages": ["<workspace or package names>"],
    "docs": ["<Title - path/to/doc.md>"],
    "links": [{ "label": "repo", "url": "" }],
    "notableFiles": ["<path/you/saw.ts - what it is>"],
    "status": "<version (omit when 0.0.0) · license, or \\"\\">"
  },
  "readings": [
    { "lens": "What the README claims", "summary": "", "state": "", "nextSteps": [""], "recommended": true },
    { "lens": "What the code actually is", "summary": "", "state": "", "nextSteps": [""], "recommended": false },
    { "lens": "Where it is right now", "summary": "", "state": "", "nextSteps": [""], "recommended": false }
  ]
}`;

function repoPrompt(owner, repo, cached, priorLenses) {
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
  return [
    "You are Switchboard's setup reader. Someone just pointed their own store home at a GitHub repository. You are running on THEIR Claude — nothing you read is uploaded anywhere.",
    cached
      ? `Here is the repository material you already read — do NOT call WebFetch or any other tool:\n"""\n${cached}\n"""`
      : [
          "Use WebFetch on these, in this order:",
          `1. ${base}/README.md`,
          `2. ${base}/package.json`,
          `3. ONLY if BOTH of the above failed: https://github.com/${owner}/${repo}`,
          "A 404 on any one of these is normal — continue with what you did get. Fetch nothing else.",
        ].join("\n"),
    "Extract ONE set of facts, then read those same facts three ways.",
    "Respond with ONLY a JSON object in exactly this shape:",
    PROJ_SHAPE,
    SHARED_RULES,
    "· Derive `stack` from real dependency names and file extensions you saw — not from how the project describes itself.",
    "· `notableFiles` must be paths you actually saw named. If you saw none, return [].",
    "· `nextSteps` are flat strings — real open work the source names (a roadmap, a TODO, an unchecked task). Return [] rather than inventing a plan.",
    priorLenses ? `These lenses were already used: ${priorLenses}. Produce three fresh readings of the SAME facts.` : "",
  ].filter(Boolean).join("\n\n");
}

function folderPrompt(path, corpus, priorLenses) {
  return [
    "You are Switchboard's setup reader. Someone pointed their own store home at a folder on their own machine. These files were read on that machine and handed straight to you — no network request was made and nothing left the disk.",
    `THE FOLDER: ${path}`,
    `Here is what was read — work only from this. Do NOT call any tool:\n"""\n${corpus}\n"""`,
    "Extract ONE set of facts, then read those same facts three ways.",
    "Respond with ONLY a JSON object in exactly this shape:",
    PROJ_SHAPE,
    SHARED_RULES,
    "· Derive `stack` from real dependency names and file extensions in the material above — not from how the project describes itself.",
    "· `notableFiles` must be paths that actually appear above. If none do, return [].",
    "· `nextSteps` are flat strings — real open work the material names. Return [] rather than inventing a plan.",
    priorLenses ? `These lenses were already used: ${priorLenses}. Produce three fresh readings of the SAME facts.` : "",
  ].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// THE FLOW
// ---------------------------------------------------------------------------------------------
export function createPoint(host) {
  const STATE_KEY = "point-state";

  let relay = null;
  let connected = false;
  let libraryEmpty = true;
  let collapsed = false;
  let grantOk = { models: false, webfetch: false };
  let liveIter = null;
  let cancelled = false;
  let busy = false;
  let bindStuck = false;      // the sandbox re-bind was declined — this page's own writes stay paused
  let resumed = false;        // "picked up where you left off"

  const blank = () => ({
    pointer: "site",
    input: "",
    phase: "pointer",
    siteRead: "",
    facts: null,
    readings: [],
    picked: 0,
    lenses: [],
    edits: {},
    name: "",
    dropped: {},              // fact key -> [removed values]
    folderPath: "",
    published: null,
    blocked: null,
    steps: [],
  });
  let pt = blank();

  const sec = () => $("point-sec");
  const stage = () => $("pt-stage");
  const kindOf = () => TILE_BY_ID[pt.pointer].kind;

  // ---- persistence — in memory only while the folder pointer has moved our own store ---------
  async function persist() {
    if (!relay || host.isFrozen()) return;
    try {
      await relay.storage.set(STATE_KEY, JSON.stringify({
        pointer: pt.pointer, input: pt.input, phase: pt.phase,
        siteRead: pt.siteRead.slice(0, 16000), facts: pt.facts, readings: pt.readings,
        picked: pt.picked, lenses: pt.lenses, edits: pt.edits, name: pt.name,
        dropped: pt.dropped, folderPath: pt.folderPath,
      }));
    } catch { /* the draft is a convenience — never block the flow on it */ }
  }
  async function clearPersisted() {
    if (!relay || host.isFrozen()) return;
    try { await relay.storage.delete(STATE_KEY); } catch { /* non-fatal */ }
  }
  async function restoreDraft() {
    if (!relay) return;
    let saved = null;
    try { saved = JSON.parse((await relay.storage.get(STATE_KEY)) || "null"); } catch { saved = null; }
    if (!saved || !TILE_BY_ID[saved.pointer]) return;
    if (saved.phase !== "found" && saved.phase !== "confirm") return;
    if (!saved.facts || !Array.isArray(saved.readings) || !saved.readings.length) return;
    pt = { ...blank(), ...saved, steps: [], published: null, blocked: null };
    resumed = true;
    collapsed = false;
  }

  function setPhase(p) {
    pt.phase = p;
    render();
    void persist();
  }
  function step(line, tone) {
    pt.steps.push({ line, tone });
    const box = $("pt-reading-steps");
    if (box) {
      const row = el("div", "pt-step" + (tone ? " " + tone : ""), line);
      box.append(row);
      box.scrollTop = box.scrollHeight;
    }
  }
  function setLive(text) {
    const l = $("pt-reading-line");
    if (l) l.textContent = text;
  }

  // ---- the one stream primitive --------------------------------------------------------------
  async function runStream({ prompt, agentic, onTool, onResult, onText }) {
    const it = relay.stream(agentic ? { prompt, agentic: true } : { prompt });
    liveIter = it;
    let acc = "";
    try {
      for await (const d of it) {
        if (cancelled) break;
        if (d.type === "text") { acc += d.text; onText && onText(acc); }
        else if (d.type === "tool_proposed") onTool && onTool(d.call?.name || "tool", d);
        else if (d.type === "tool_result") onResult && onResult(d);
        else if (d.type === "error") throw new Error(d.error?.message || "stream error");
      }
    } finally {
      liveIter = null;
    }
    return acc;
  }
  function abort() {
    cancelled = true;
    try { liveIter?.return?.(); } catch { /* already closed */ }
    liveIter = null;
  }

  // ---- blocked ------------------------------------------------------------------------------
  function blocked(why, opts = {}) {
    pt.blocked = { why, ...opts };
    busy = false;
    setPhase("blocked");
  }

  // ---- reading ------------------------------------------------------------------------------
  async function go() {
    if (!relay || busy) return;
    const input = str($("pt-input")?.value ?? pt.input);
    pt.input = input;
    if (!input) { flashHint("Give it something to point at first."); return; }
    if (!grantOk.models) { flashHint("Your Claude isn't lent to this page yet — re-approve above."); return; }
    if (pt.pointer !== "folder" && !grantOk.webfetch) { flashHint("This page can't read the web yet — re-approve above."); return; }

    cancelled = false;
    busy = true;
    pt.steps = [];
    pt.facts = null;
    pt.readings = [];
    pt.siteRead = "";
    pt.edits = {};
    pt.dropped = {};
    pt.lenses = [];
    pt.published = null;
    pt.blocked = null;
    resumed = false;
    setPhase("reading");
    try {
      if (pt.pointer === "site") await readSite();
      else if (pt.pointer === "repo") await readRepo();
      else await readFolder();
    } catch (e) {
      if (!cancelled) blocked(`Your Claude stopped partway through — ${msg(e)}`);
    } finally {
      busy = false;
    }
  }

  function landReadings(raw, corpus) {
    const parsed = parseJson(raw);
    if (!parsed || !parsed.facts || !Array.isArray(parsed.readings) || !parsed.readings.length) {
      blocked("Your Claude answered, but not with a card — the reply wasn't the shape this page expects.");
      return false;
    }
    const kind = kindOf();
    const f = parsed.facts || {};
    pt.facts = kind === "brand"
      ? {
          name: str(f.name),
          domain: str(f.domain),
          category: str(f.category),
          products: arr(f.products, 8),
          priceBand: str(f.priceBand),
          // Only hexes that appear verbatim in the bytes we read survive. `paletteClaimed` keeps
          // the count the model offered, so the empty state can say WHY it's empty.
          palette: verifyHexes(f.paletteRaw, corpus),
          paletteClaimed: arr(f.paletteRaw, 8).length,
        }
      : {
          name: str(f.name),
          stack: arr(f.stack, 10),
          packages: arr(f.packages, 10),
          docs: arr(f.docs, 8),
          links: (Array.isArray(f.links) ? f.links : [])
            .map((l) => ({ label: str(l?.label) || "link", url: str(l?.url) }))
            .filter((l) => /^https?:\/\//i.test(l.url)).slice(0, 6),
          notableFiles: arr(f.notableFiles, 8),
          status: str(f.status),
        };
    const fields = fieldsFor(kind);
    pt.readings = parsed.readings.slice(0, 3).map((r, i) => {
      const out = { lens: str(r?.lens) || `Reading ${i + 1}`, recommended: !!r?.recommended };
      for (const fd of fields) out[fd.key] = fd.list ? arr(r?.[fd.key], 6) : str(r?.[fd.key]);
      return out;
    });
    if (!pt.readings.some((r) => r.recommended)) pt.readings[0].recommended = true;
    // exactly one ★
    let seen = false;
    for (const r of pt.readings) { if (r.recommended && seen) r.recommended = false; else if (r.recommended) seen = true; }
    pt.picked = pt.readings.findIndex((r) => r.recommended);
    if (pt.picked < 0) pt.picked = 0;
    pt.lenses = pt.readings.map((r) => r.lens);
    pt.name = pt.facts.name || defaultName();
    setPhase("found");
    return true;
  }

  function defaultName() {
    if (pt.pointer === "site") return siteUrl(pt.input)?.hostname.replace(/^www\./, "") || "Brand";
    if (pt.pointer === "repo") { const r = parseRepo(pt.input); return r && !r.bad ? r.repo : "Project"; }
    return basename(pt.folderPath || pt.input);
  }

  async function readSite() {
    const u = siteUrl(pt.input);
    if (!u) { blocked("That doesn't look like a web address — try something like yourbrand.com."); return; }
    const hostName = u.hostname.replace(/^www\./, "");
    setLive(`reading ${hostName} on your Claude…`);
    step(`reading ${hostName} on your Claude…`);
    let fetches = 0, okFetches = 0;
    const raw = await runStream({
      prompt: sitePrompt(u.href, null, null),
      agentic: true,
      onTool: (name) => { if (name === "WebFetch") { fetches++; step(fetches === 1 ? `fetching ${hostName}…` : "one more page on the same site…"); } else step("tool → " + name); },
      onResult: (d) => {
        const t = resultText(d);
        if (d.result?.ok && t && t.length > 40) {
          okFetches++;
          if (!pt.siteRead) pt.siteRead = t.slice(0, 16000);
          else if (pt.siteRead.length < 16000) pt.siteRead = (pt.siteRead + "\n\n" + t).slice(0, 16000);
          step(`page read · ${kb(t.length)}`, "good");
        } else {
          step("blocked: " + (d.result?.error?.message || "that page wouldn't open"), "bad");
        }
      },
      onText: (acc) => setLive(`drafting three readings… ${(acc.length / 1024).toFixed(1)} kb`),
    });
    if (cancelled) return;
    if (!okFetches) {
      blocked(`${hostName} wouldn't let your Claude read it — some sites block automated readers.`, { transfer: "folder" });
      return;
    }
    landReadings(raw, pt.siteRead);
  }

  async function readRepo() {
    const r = parseRepo(pt.input);
    if (!r || r.bad) { blocked("That isn't a GitHub repo URL — try github.com/you/repo.", { keepInput: true }); return; }
    setLive(`reading ${r.owner}/${r.repo} on your Claude…`);
    step(`reading ${r.owner}/${r.repo} as an anonymous visitor…`);
    let okFetches = 0, attempts = 0;
    const raw = await runStream({
      prompt: repoPrompt(r.owner, r.repo, null, null),
      agentic: true,
      onTool: (name, d) => {
        if (name !== "WebFetch") { step("tool → " + name); return; }
        attempts++;
        const url = str(d.call?.arguments?.url || d.call?.input?.url);
        step(url ? `fetching ${url.replace(/^https?:\/\//, "")}…` : "fetching…");
      },
      onResult: (d) => {
        const t = resultText(d);
        const notFound = /^\s*404: Not Found/i.test(t) || /\b404\b/.test(str(d.result?.error?.message));
        if (d.result?.ok && t && t.length > 40 && !notFound) {
          okFetches++;
          if (pt.siteRead.length < 16000) pt.siteRead = (pt.siteRead + "\n\n" + t).slice(0, 16000);
          step(`read · ${kb(t.length)}`, "good");
        } else {
          step("not there — that's fine, continuing", "dim");
        }
      },
      onText: (acc) => setLive(`drafting three readings… ${(acc.length / 1024).toFixed(1)} kb`),
    });
    if (cancelled) return;
    if (!okFetches && attempts) {
      blocked(
        "GitHub returned 404 — that repo is private or doesn't exist. Your Claude reads GitHub as an anonymous visitor, so private repos aren't reachable.",
        { transfer: "folder", prefill: `~/Projects/${r.repo}` },
      );
      return;
    }
    landReadings(raw, pt.siteRead);
  }

  // The strongest privacy story in the product: no web tools at all, and the bytes never leave.
  // The cost is TWO bind consents — out to the folder, then back to this page's sandbox.
  const FOLDER_PRIORITY = ["README.md", "readme.md", "Readme.md", "package.json", "ROADMAP.md", "CLAUDE.md"];
  async function readFolder() {
    const path = pt.input;
    let before = null;
    try { before = await relay.storage.info(); } catch { before = null; }
    host.freeze(true);
    step(`asking to bind ${path} — approve the path in Switchboard`);
    setLive("waiting for you to approve the folder…");
    let info = null;
    try { info = await relay.storage.bind(path); } catch (e) { info = null; }
    if (!info || cancelled) {
      await restoreBind(before);
      if (!cancelled) blocked("You didn't approve that folder, so nothing was read.");
      return;
    }
    pt.folderPath = info.folder || path;
    step(`bound · ${pt.folderPath}`, "good");

    let keys = [];
    try { keys = await relay.storage.list(); } catch { keys = []; }
    const picked = pickFiles(keys);
    if (!picked.length) {
      await restoreBind(before);
      blocked(`${basename(pt.folderPath)} has no README, package.json or docs — there's nothing here to read yet.`, { transfer: "site" });
      return;
    }
    step(`${keys.length} file${keys.length === 1 ? "" : "s"} · reading ${picked.length} of them`);
    let corpus = "";
    for (const k of picked) {
      if (corpus.length > 24000) { corpus += "\n[…truncated]"; break; }
      let body = null;
      try { body = await relay.storage.get(k); } catch { body = null; }
      if (!body) continue;
      corpus += `\n--- ${k} ---\n${body}\n`;
    }
    corpus = corpus.slice(0, 24000);
    if (!corpus.trim()) {
      await restoreBind(before);
      blocked(`${basename(pt.folderPath)} has no README, package.json or docs — there's nothing here to read yet.`, { transfer: "site" });
      return;
    }
    pt.siteRead = corpus;

    // Restore the sandbox HERE, the instant the bytes are in memory — not after publish. Nothing
    // downstream (drafting, steering, editing, publishing) touches storage again, and every later
    // exit is a branch: publish, discard, blocked, a transfer to another pointer, a reload. Unwinding
    // at each of those is a bug farm; unwinding at the one point where the folder stops being needed
    // is a single line that cannot be skipped. It also shrinks the window in which this page's own
    // store points at someone's source tree from "however long they spend editing" to milliseconds.
    await restoreBind(before);

    step("drafting… (nothing left this machine)");
    setLive("drafting three readings… 0.0 kb");
    let raw = "";
    try {
      raw = await runStream({
        prompt: folderPrompt(pt.folderPath, corpus, null),
        onText: (acc) => setLive(`drafting three readings… ${(acc.length / 1024).toFixed(1)} kb`),
      });
    } catch (e) {
      if (!cancelled) blocked(`Your Claude stopped partway through — ${msg(e)}`);
      return;
    }
    if (cancelled) return;
    landReadings(raw, corpus);
  }
  function pickFiles(keys) {
    const seen = new Set();
    const out = [];
    const take = (k) => { if (k && !seen.has(k)) { seen.add(k); out.push(k); } };
    for (const p of FOLDER_PRIORITY) { const hit = keys.find((k) => k === p); if (hit) take(hit); }
    for (const k of keys.filter((x) => /^docs\/.+\.md$/i.test(x)).slice(0, 6)) take(k);
    for (const k of keys.filter((x) => /^[^/]+\.md$/i.test(x)).slice(0, 6)) take(k);
    return out.slice(0, 14);
  }
  async function restoreBind(before) {
    if (!before || !before.folder) { host.freeze(false); return; }
    try {
      await relay.storage.bind(before.folder);
      host.freeze(false);
      bindStuck = false;
    } catch {
      // The user declined the way back. Do NOT silently resume writing — this page's own store is
      // still their folder. Stay frozen for the session and say so in one quiet line.
      bindStuck = true;
    }
  }

  // ---- regenerate / steer / per-field redraft (never re-fetch, never re-bind) ----------------
  function cachedPrompt(priorLenses, steer) {
    const kind = kindOf();
    const base = pt.pointer === "site"
      ? sitePrompt(pt.input, pt.siteRead, priorLenses)
      : pt.pointer === "repo"
        ? (() => { const r = parseRepo(pt.input) || {}; return repoPrompt(r.owner, r.repo, pt.siteRead, priorLenses); })()
        : folderPrompt(pt.folderPath, pt.siteRead, priorLenses);
    void kind;
    return steer ? base + `\n\nThe person asked for this specifically: "${steer}". Apply it to all three readings.` : base;
  }
  async function regenerate(steer) {
    if (!relay || busy || !pt.siteRead) return;
    busy = true; cancelled = false;
    pt.steps = [];
    resumed = false;
    setPhase("reading");
    setLive(steer ? `re-reading through: “${steer}”…` : "three fresh readings…");
    step("using the read it already has — nothing is fetched again", "good");
    try {
      const raw = await runStream({
        prompt: cachedPrompt(pt.lenses.join(", "), steer),
        onText: (acc) => setLive(`drafting three readings… ${(acc.length / 1024).toFixed(1)} kb`),
      });
      if (cancelled) return;
      pt.edits = {};
      landReadings(raw, pt.siteRead);
    } catch (e) {
      if (!cancelled) blocked(`Your Claude stopped partway through — ${msg(e)}`);
    } finally { busy = false; }
  }
  async function refield(key) {
    if (!relay || busy || !pt.siteRead) return;
    const fd = fieldsFor(kindOf()).find((f) => f.key === key);
    if (!fd) return;
    const btn = $("pt-refield-" + key);
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    busy = true;
    try {
      const shape = fd.list ? `{"${key}": ["…"]}` : `{"${key}": "…"}`;
      const raw = await runStream({
        prompt: [
          "You already read this source. Re-draft ONE field of the reading, nothing else.",
          `Here is the source you read — do NOT call any tool:\n"""\n${pt.siteRead}\n"""`,
          `The reading as it stands (lens: ${current().lens}):\n${JSON.stringify(viewReading())}`,
          `Re-draft ONLY "${key}" — ${fd.label}. A genuinely different phrasing, same facts, same lens. If the source doesn't say, return an empty string.`,
          `Respond with ONLY a JSON object: ${shape}`,
        ].join("\n\n"),
      });
      const v = parseJson(raw);
      if (v && v[key] !== undefined) {
        pt.edits[key] = fd.list ? arr(v[key], 6) : str(v[key]);
        void persist();
      }
    } catch { /* the old value stands */ }
    finally { busy = false; render(); }
  }

  const current = () => pt.readings[pt.picked] || pt.readings[0] || {};
  /** the picked reading with the user's inline edits applied */
  function viewReading() {
    const out = { lens: current().lens };
    for (const fd of fieldsFor(kindOf())) {
      out[fd.key] = pt.edits[fd.key] !== undefined ? pt.edits[fd.key] : current()[fd.key];
    }
    return out;
  }
  function factList(key) {
    const all = (pt.facts && pt.facts[key]) || [];
    const gone = pt.dropped[key] || [];
    return all.filter((x) => !gone.includes(typeof x === "string" ? x : x.url));
  }
  function dropFact(key, value) {
    pt.dropped[key] = [...(pt.dropped[key] || []), value];
    void persist();
    render();
  }

  // ---- publish ------------------------------------------------------------------------------
  async function publish() {
    if (!relay || busy || !pt.facts) return;
    busy = true; render();
    const kind = kindOf();
    const r = viewReading();
    const name = str(pt.name) || defaultName();
    try {
      // Stable ids are what make re-pointing the same thing UPDATE in place instead of filling the
      // library with duplicates of one site. `undefined` (never "") is the documented "you pick one"
      // signal, for the pathological case where nothing sluggable survives.
      let id, data;
      if (kind === "brand") {
        const u = siteUrl(pt.input);
        id = slug(pt.facts.domain || u?.hostname || name) || slug(name) || undefined;
        data = {
          oneLine: r.oneLine, positioning: r.positioning, voice: r.voice, audience: r.audience,
          products: factList("products"),
          palette: factList("palette"),
          category: pt.facts.category,
          priceRange: pt.facts.priceBand,
          domain: pt.facts.domain || u?.hostname.replace(/^www\./, "") || "",
          source: { kind: "site", url: u ? u.href : pt.input, readAt: now(), by: "switchboard-home" },
        };
      } else {
        id = slug(pt.facts.name || name) || slug(name) || undefined;
        const isRepo = pt.pointer === "repo";
        data = {
          summary: r.summary,
          status: pt.facts.status,
          stack: factList("stack"),
          links: factList("links"),
          packages: factList("packages"),
          docs: factList("docs"),
          roadmap: Array.isArray(r.nextSteps) ? r.nextSteps : [],
          state: r.state,
          files: factList("notableFiles"),
          source: isRepo
            ? { kind: "github", url: repoUrl(), readAt: now(), by: "switchboard-home" }
            : { kind: "folder", path: pt.folderPath, readAt: now(), by: "switchboard-home" },
        };
        // data.folder is what makes the folder pointer the best of the three: folderOf() in
        // packages/sidekick/src/context/library.ts reads it, so LENDING this project to a wrapp
        // auto-binds that wrapp's storage to the real directory — the app opens the real files.
        if (!isRepo && pt.folderPath) data.folder = pt.folderPath;
      }
      await relay.context.publish({ id, name, kind, data });
      pt.published = { id, name, kind, folder: data.folder || "" };
      await clearPersisted();
      busy = false;
      setPhase("ready");
      await host.onPublished();
      render();  // repaint the ready screen once buildActions() sees the new context
    } catch (e) {
      busy = false;
      blocked(`Your library didn't take it — ${msg(e)}`);
    }
  }
  function repoUrl() {
    const r = parseRepo(pt.input);
    return r && !r.bad ? `https://github.com/${r.owner}/${r.repo}` : pt.input;
  }

  async function discard() {
    abort();
    await clearPersisted();
    const keepPointer = pt.pointer;
    pt = blank();
    pt.pointer = keepPointer;
    resumed = false;
    setPhase("pointer");
  }

  // =============================================================================================
  // RENDER
  // =============================================================================================
  function flashHint(text) {
    const h = $("pt-hint");
    if (!h) return;
    h.textContent = text;
    h.classList.add("warn");
    setTimeout(() => { h.classList.remove("warn"); paintHint(); }, 2600);
  }
  function paintHint() {
    const h = $("pt-hint");
    if (h) h.textContent = TILE_BY_ID[pt.pointer].hint;
  }

  function render() {
    const s = sec();
    if (!s) return;
    s.hidden = false;
    s.classList.toggle("pt-connected", connected);

    // the re-approve wall — existing grants are exact-match and silently ignore newly requested
    // scope, so everyone who connected this home before the pointers shipped lands here once.
    const wall = $("pt-reconnect");
    const needs = connected && (!grantOk.models || !grantOk.webfetch);
    if (wall) wall.hidden = !needs;

    const bar = $("pt-bar");
    const body = $("pt-body");
    const showCollapsed = connected && collapsed && pt.phase === "pointer";
    if (bar) bar.hidden = !showCollapsed;
    if (body) body.hidden = showCollapsed;
    const zone = $("pt-zone");
    if (zone) zone.hidden = showCollapsed;
    // "hide" only means something when there's a collapsed bar to fall back to — i.e. connected.
    const hide = $("pt-collapse");
    if (hide) hide.hidden = !connected || pt.phase !== "pointer";

    const st = stage();
    if (!st || showCollapsed) return;
    st.textContent = "";
    if (pt.phase === "pointer") st.append(screenPointer());
    else if (pt.phase === "reading") st.append(screenReading());
    else if (pt.phase === "found") st.append(screenFound());
    else if (pt.phase === "confirm") st.append(screenConfirm());
    else if (pt.phase === "ready") st.append(screenReady());
    else if (pt.phase === "blocked") st.append(screenBlocked());
  }

  // ---- SCREEN 0 · POINTER --------------------------------------------------------------------
  /** The folder pointer needs ONLY a model — it issues no fetch at all — so it stays usable even
   *  when WebFetch was never granted. That asymmetry is real, so the UI reflects it. */
  function pointerReady(id) {
    if (!connected || !grantOk.models) return false;
    return id === "folder" ? true : grantOk.webfetch;
  }
  function screenPointer() {
    const wrap = el("div", "pt-screen");
    const tiles = el("div", "pt-pointers");
    tiles.id = "pt-pointers";
    for (const t of TILES) {
      const b = el("button", "pt-tile" + (t.id === pt.pointer ? " on" : ""));
      b.type = "button";
      b.id = "pt-tile-" + t.id;
      const f = famOf(t.id === "site" ? "adforge" : t.id === "repo" ? "redline" : "bank");
      const ic = el("span", "pt-ic");
      ic.style.background = f.soft; ic.style.color = f.ink;
      ic.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PT_GLYPH[t.id]}</svg>`;
      const tx = el("span", "pt-tt");
      tx.append(el("span", "pt-tn", t.name), el("span", "pt-ts", t.sub));
      b.append(ic, tx);
      b.onclick = () => {
        if (!connected) { host.clickConnect(); pt.pointer = t.id; render(); return; }
        pt.pointer = t.id;
        render();
        setTimeout(() => $("pt-input")?.focus(), 20);
      };
      tiles.append(b);
    }
    wrap.append(tiles);

    const row = el("div", "pt-inrow");
    const input = el("input", "pt-input");
    input.id = "pt-input";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = TILE_BY_ID[pt.pointer].ph;
    input.value = pt.input;
    input.disabled = !pointerReady(pt.pointer);
    input.addEventListener("input", () => {
      pt.input = input.value;
      const guess = detectPointer(input.value);
      if (guess && guess !== pt.pointer) {
        pt.pointer = guess;
        const caret = input.selectionStart;
        render();
        const next = $("pt-input");
        if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch { /* ignore */ } }
      }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void go(); } });
    const btn = el("button", "pt-go", "Read it ▸");
    btn.id = "pt-go";
    btn.type = "button";
    btn.disabled = !pointerReady(pt.pointer);
    btn.onclick = () => void go();
    row.append(input, btn);
    wrap.append(row);

    const hint = el("div", "pt-hint");
    hint.id = "pt-hint";
    hint.textContent = !connected
      ? "connect Switchboard and your own Claude reads it"
      : !grantOk.models
        ? "your Claude isn't lent to this page yet — re-approve above and all three work"
        : (pt.pointer !== "folder" && !grantOk.webfetch)
          ? "this page can't read the web yet — re-approve above, or point at a folder instead (that needs no web access at all)"
          : TILE_BY_ID[pt.pointer].hint;
    wrap.append(hint);

    const priv = el("div", "pt-privacy");
    priv.id = "pt-privacy";
    priv.textContent = PRIVACY;
    wrap.append(priv);

    if (bindStuck) wrap.append(el("div", "pt-quiet", "this page's own scratch state is paused until you reload"));
    return wrap;
  }

  // ---- SCREEN 1 · READING --------------------------------------------------------------------
  function screenReading() {
    const wrap = el("div", "pt-screen");
    const box = el("div", "pt-reading");
    box.id = "pt-reading";
    const head = el("div", "pt-scanrow");
    head.append(el("span", "pt-scan"));
    const line = el("span", "pt-live", "reading…");
    line.id = "pt-reading-line";
    head.append(line);
    box.append(head);
    const steps = el("div", "pt-steps");
    steps.id = "pt-reading-steps";
    for (const s of pt.steps) steps.append(el("div", "pt-step" + (s.tone ? " " + s.tone : ""), s.line));
    box.append(steps);
    // Cancelling a REGENERATE must not throw away the reading you already have — that read cost a
    // fetch. Only a first read has nothing to fall back to, and that's the one that discards.
    const hasDraft = !!(pt.facts && pt.readings.length);
    const cancel = el("button", "pt-ghost", hasDraft ? "cancel — keep what I had" : "cancel");
    cancel.id = "pt-cancel";
    cancel.type = "button";
    cancel.onclick = () => {
      abort();
      busy = false;
      if (hasDraft) setPhase("found");
      else void discard();
    };
    box.append(cancel);
    wrap.append(box);
    return wrap;
  }

  // ---- SCREEN 2 · FOUND ----------------------------------------------------------------------
  function screenFound() {
    const kind = kindOf();
    const wrap = el("div", "pt-screen");
    const h = el("div", "pt-h");
    h.append(el("h3", null, "Here's what it found — pick the one that reads truest."));
    h.append(el("span", "pt-hs", kind === "brand"
      ? "Same facts in all three. Only the reading differs."
      : "Same facts in all three. Only the reading of them differs."));
    wrap.append(h);
    if (resumed) wrap.append(el("div", "pt-quiet", "picked up where you left off — this draft was already read, nothing was fetched again"));

    const cards = el("div", "pt-cards");
    pt.readings.forEach((r, i) => {
      const c = el("div", "pt-card" + (i === pt.picked ? " sel" : ""));
      c.id = "pt-card-" + i;
      c.onclick = () => { pt.picked = i; pt.edits = {}; void persist(); render(); };
      if (r.recommended) c.append(el("span", "pt-rec", "★ recommended"));
      c.append(el("span", "pt-lens", r.lens));
      for (const fd of fieldsFor(kind)) {
        const v = r[fd.key];
        const has = fd.list ? (Array.isArray(v) && v.length) : str(v);
        const row = el("div", "pt-frow");
        row.append(el("span", "pt-fk", fd.label));
        if (!has) row.append(el("span", "pt-fv muted", pt.pointer === "site" ? "the site doesn't say" : "the source doesn't say"));
        else if (fd.list) {
          const ul = el("div", "pt-flist");
          for (const x of v) ul.append(el("div", null, "· " + x));
          row.append(ul);
        } else row.append(el("span", "pt-fv", v));
        c.append(row);
      }
      cards.append(c);
    });
    wrap.append(cards);

    wrap.append(factsStrip(false));

    // steer + regenerate — both re-run off the CACHED read; neither fetches or binds again
    const steer = el("div", "pt-steer");
    steer.id = "pt-steer";
    const chips = el("div", "pt-chips");
    for (const s of STEER_CHIPS[pt.pointer]) {
      const c = el("button", "pt-chip", s);
      c.type = "button";
      c.onclick = () => void regenerate(s);
      chips.append(c);
    }
    steer.append(chips);
    const srow = el("div", "pt-inrow small");
    const si = el("input", "pt-input");
    si.type = "text";
    si.placeholder = "tell it what to change…";
    si.addEventListener("keydown", (e) => { if (e.key === "Enter" && si.value.trim()) { const v = si.value.trim(); si.value = ""; void regenerate(v); } });
    const sb = el("button", "pt-ghost", "send");
    sb.type = "button";
    sb.onclick = () => { const v = si.value.trim(); if (v) { si.value = ""; void regenerate(v); } };
    srow.append(si, sb);
    steer.append(srow);
    wrap.append(steer);

    const acts = el("div", "pt-acts");
    const use = el("button", "pt-go", "Use this reading ▸");
    use.type = "button";
    use.onclick = () => setPhase("confirm");
    const regen = el("button", "pt-ghost", "↻ three fresh readings");
    regen.id = "pt-regen";
    regen.type = "button";
    regen.onclick = () => void regenerate(null);
    const cancel = el("button", "pt-ghost", "discard");
    cancel.type = "button";
    cancel.onclick = () => void discard();
    acts.append(use, regen, cancel);
    wrap.append(acts);
    return wrap;
  }

  /** The shared facts — rendered ONCE, visibly not part of the choice. */
  function factsStrip(removable) {
    const kind = kindOf();
    const box = el("div", "pt-facts");
    box.id = "pt-facts";
    box.append(el("span", "pt-fk pt-fk-top", "what it read — the same in all three"));
    const body = el("div", "pt-fbody");

    // `dropKey` null = a single observed value with no list to remove from (price band, status).
    const chipRow = (label, values, dropKey) => {
      if (!values.length) return;
      const r = el("div", "pt-fline");
      r.append(el("span", "pt-flk", label));
      const c = el("div", "pt-fchips");
      for (const v of values) {
        const chip = el("span", "pt-fchip", v);
        if (removable && dropKey) {
          const x = el("button", "pt-x", "×");
          x.type = "button";
          x.title = "remove — it doesn't belong to this";
          x.onclick = (e) => { e.stopPropagation(); dropFact(dropKey, v); };
          chip.append(x);
        }
        c.append(chip);
      }
      r.append(c);
      body.append(r);
    };

    if (kind === "brand") {
      const pal = factList("palette");
      const palRow = el("div", "pt-fline");
      palRow.append(el("span", "pt-flk", "palette"));
      if (pal.length) {
        const c = el("div", "pt-fchips");
        for (const hex of pal) {
          const chip = el("span", "pt-swatch");
          const dot = el("i");
          dot.style.background = hex;
          chip.append(dot, el("span", null, hex));
          if (removable) {
            const x = el("button", "pt-x", "×");
            x.type = "button";
            x.onclick = (e) => { e.stopPropagation(); dropFact("palette", hex); };
            chip.append(x);
          }
          c.append(chip);
        }
        palRow.append(c);
        const note = el("span", "pt-fnote", "read from the page");
        palRow.append(note);
      } else {
        // An empty palette is CORRECT. Three plausible invented hexes are a lie that then
        // propagates into every ad prompt this person ever generates.
        const n = el("div", "pt-fnote wide");
        n.append(document.createTextNode(
          pt.facts.paletteClaimed
            ? "no colours read — your Claude offered some, but none of them appear in the page text it was given, so they were dropped. This page can only see the text of the site. "
            : "no colours read — this page can only see the text of the site, not the CSS it serves. ",
        ));
        const a = el("a", null, "Bank's extractor reads the real CSS your site serves →");
        a.href = APP_BY_ID.bank?.href || "https://bank.thelastprompt.ai";
        a.target = "_blank"; a.rel = "noreferrer";
        n.append(a);
        palRow.append(n);
      }
      body.append(palRow);
      chipRow("products", factList("products"), "products");
      if (pt.facts.priceBand) chipRow("prices", [pt.facts.priceBand], null);
      if (pt.facts.category) chipRow("category", [pt.facts.category], null);
      if (pt.facts.domain) {
        const r = el("div", "pt-fline");
        r.append(el("span", "pt-flk", "domain"));
        const a = el("a", "pt-flink", pt.facts.domain);
        a.href = "https://" + pt.facts.domain.replace(/^https?:\/\//, "");
        a.target = "_blank"; a.rel = "noreferrer";
        r.append(a);
        body.append(r);
      }
    } else {
      chipRow("stack", factList("stack"), "stack");
      chipRow("packages", factList("packages"), "packages");
      chipRow("docs", factList("docs"), "docs");
      chipRow("files", factList("notableFiles"), "notableFiles");
      const links = factList("links");
      if (links.length) {
        const r = el("div", "pt-fline");
        r.append(el("span", "pt-flk", "links"));
        const c = el("div", "pt-fchips");
        for (const l of links) {
          const chip = el("span", "pt-fchip");
          const a = el("a", "pt-flink", l.label);
          a.href = l.url; a.target = "_blank"; a.rel = "noreferrer";
          chip.append(a);
          if (removable) {
            const x = el("button", "pt-x", "×");
            x.type = "button";
            x.onclick = (e) => { e.stopPropagation(); dropFact("links", l.url); };
            chip.append(x);
          }
          c.append(chip);
        }
        r.append(c);
        body.append(r);
      }
      if (pt.facts.status) chipRow("status", [pt.facts.status], null);
      if (pt.pointer === "folder" && pt.folderPath) {
        const r = el("div", "pt-fline");
        r.append(el("span", "pt-flk", "folder"), el("span", "pt-fmono", pt.folderPath));
        body.append(r);
      }
    }
    box.append(body);
    if (removable) box.append(el("div", "pt-fnote wide", "facts can be removed, never typed in — that's what keeps them traceable to what was actually read."));
    return box;
  }

  // ---- SCREEN 3 · CONFIRM --------------------------------------------------------------------
  function screenConfirm() {
    const kind = kindOf();
    const wrap = el("div", "pt-screen");
    const h = el("div", "pt-h");
    h.append(el("h3", null, "Confirm what it found."));
    h.append(el("span", "pt-hs", "Click any line to edit it. ↻ re-drafts just that line from the read it already has."));
    wrap.append(h);

    const card = el("div", "pt-confirm");
    const top = el("div", "pt-crow");
    const nameIn = el("input", "pt-name");
    nameIn.id = "pt-name";
    nameIn.type = "text";
    nameIn.value = pt.name;
    nameIn.placeholder = "name";
    nameIn.addEventListener("input", () => { pt.name = nameIn.value; void persist(); });
    const pill = el("span", "pt-kind", kind);
    pill.id = "pt-kind";
    pill.title = pt.pointer === "site"
      ? "A live site describes a brand — so this banks as kind \"brand\", which every ad, image and listing wrapp already knows how to read."
      : "A repo or a folder describes a unit of work — so this banks as kind \"project\", which Bank, Redline and Huddle already know how to read.";
    top.append(nameIn, pill);
    card.append(top);

    for (const fd of fieldsFor(kind)) {
      const v = pt.edits[fd.key] !== undefined ? pt.edits[fd.key] : current()[fd.key];
      const row = el("div", "pt-erow");
      row.id = "pt-field-" + fd.key;
      const k = el("div", "pt-ek");
      k.append(el("span", null, fd.label));
      const re = el("button", "pt-re", "↻");
      re.id = "pt-refield-" + fd.key;
      re.type = "button";
      re.title = "re-draft just this line";
      re.onclick = () => void refield(fd.key);
      k.append(re);
      row.append(k);
      row.append(editable(fd, v));
      card.append(row);
    }
    wrap.append(card);
    wrap.append(factsStrip(true));

    const acts = el("div", "pt-acts");
    const pub = el("button", "pt-go", busy ? "banking…" : "Bank it — every app can borrow it");
    pub.id = "pt-publish";
    pub.type = "button";
    pub.disabled = busy;
    pub.onclick = () => void publish();
    const back = el("button", "pt-ghost", "← other readings");
    back.type = "button";
    back.onclick = () => setPhase("found");
    const cancel = el("button", "pt-ghost", "discard");
    cancel.id = "pt-cancel";
    cancel.type = "button";
    cancel.onclick = () => void discard();
    acts.append(pub, back, cancel);
    wrap.append(acts);
    const note = el("div", "pt-privacy", "Publishing puts this in your own library on your machine. It stays yours; each app still asks you before it can borrow it. " + PRIVACY);
    note.id = "pt-publish-note";
    wrap.append(note);
    return wrap;
  }

  function editable(fd, value) {
    const holder = el("div", "pt-ev");
    const text = fd.list ? (Array.isArray(value) ? value.join("\n") : "") : str(value);
    const show = () => {
      holder.textContent = "";
      if (!text) {
        const em = el("span", "pt-fv muted", pt.pointer === "site" ? "the site doesn't say — click to add it yourself" : "the source doesn't say — click to add it yourself");
        holder.append(em);
      } else if (fd.list) {
        const l = el("div", "pt-flist");
        for (const line of text.split("\n").filter(Boolean)) l.append(el("div", null, "· " + line));
        holder.append(l);
      } else {
        holder.append(el("span", "pt-fv", text));
      }
    };
    holder.onclick = () => {
      holder.textContent = "";
      const input = fd.multiline ? el("textarea", "pt-edit") : el("input", "pt-edit");
      input.value = text;
      if (fd.multiline) input.rows = fd.list ? 4 : 3;
      const commit = () => {
        const v = input.value;
        pt.edits[fd.key] = fd.list ? v.split("\n").map((x) => x.replace(/^[-·*]\s*/, "").trim()).filter(Boolean).slice(0, 6) : v.trim();
        void persist();
        render();
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { render(); }
        if (e.key === "Enter" && !fd.multiline) { e.preventDefault(); commit(); }
      });
      holder.append(input);
      input.focus();
    };
    show();
    return holder;
  }

  // ---- SCREEN 4 · READY ----------------------------------------------------------------------
  function screenReady() {
    const p = pt.published || {};
    const kind = p.kind || kindOf();
    const wrap = el("div", "pt-screen");
    const h = el("div", "pt-h");
    const t = el("h3", null, `${p.name || "It"} is banked.`);
    t.id = "pt-ready-name";
    h.append(t);
    h.append(el("span", "pt-hs", "It's in your library on this machine. Every app below can borrow it — you approve each lend once."));
    wrap.append(h);

    const chips = el("div", "pt-ready-apps");
    chips.id = "pt-ready-apps";
    for (const [id, line] of (READY[kind] || READY.project)) {
      const app = APP_BY_ID[id];
      if (!app) continue;
      const a = el("a", "pt-app");
      a.href = app.href;
      a.dataset.app = app.id;
      if (/^https:/.test(app.href)) { a.target = "_blank"; a.rel = "noreferrer"; }
      const f = famOf(app.id);
      const ic = el("span", "pt-ic sm");
      ic.style.background = f.soft; ic.style.color = f.ink;
      ic.innerHTML = glyphSvg(app.id);
      const tx = el("span", "pt-tt");
      tx.append(el("span", "pt-tn", app.name), el("span", "pt-ts", line));
      a.append(ic, tx);
      chips.append(a);
    }
    wrap.append(chips);

    // the primary pill comes from buildActions() — the same builder the hero CTA uses, so the two
    // surfaces can never disagree about what the top move is. Passing the freshly banked context as
    // the focus is what makes the pill name IT rather than whichever context sorts first.
    const top = host.buildActions({ name: p.name, kind })[0];
    if (top && APP_BY_ID[top.app]) {
      const app = APP_BY_ID[top.app];
      const a = el("a", "pt-go pt-primary");
      a.id = "pt-ready-open";
      a.href = app.href;
      a.dataset.app = app.id;
      if (/^https:/.test(app.href)) { a.target = "_blank"; a.rel = "noreferrer"; }
      a.textContent = `${top.label} → in ${app.name}`;
      wrap.append(a);
    }

    if (p.folder) {
      const f = el("div", "pt-folder-note",
        `Because you pointed at a folder, lending this project to an app opens the real files in ${basename(p.folder)} — not a copy.`);
      f.id = "pt-ready-folder";
      wrap.append(f);
    }
    if (bindStuck) wrap.append(el("div", "pt-quiet", "this page's own scratch state is paused until you reload"));

    const acts = el("div", "pt-acts");
    const again = el("button", "pt-ghost", "point at something else");
    again.id = "pt-ready-another";
    again.type = "button";
    again.onclick = () => { pt = blank(); collapsed = false; setPhase("pointer"); };
    acts.append(again);
    wrap.append(acts);
    return wrap;
  }

  // ---- SCREEN X · BLOCKED --------------------------------------------------------------------
  function screenBlocked() {
    const b = pt.blocked || {};
    const wrap = el("div", "pt-screen");
    const box = el("div", "pt-blocked");
    box.append(el("span", "pt-blk", "didn't land"));
    const why = el("div", "pt-blocked-why", b.why || "That didn't work.");
    why.id = "pt-blocked-why";
    box.append(why);

    const next = el("div", "pt-acts");
    next.id = "pt-blocked-next";
    const retry = el("button", "pt-go", "↻ try that again");
    retry.id = "pt-retry";
    retry.type = "button";
    retry.onclick = () => { pt.blocked = null; void go(); };
    next.append(retry);
    // the transfer that matters most in the whole flow: private repo → the folder on this Mac
    const others = TILES.filter((t) => t.id !== pt.pointer)
      .sort((x, y) => (y.id === b.transfer ? 1 : 0) - (x.id === b.transfer ? 1 : 0));
    for (const t of others) {
      const btn = el("button", "pt-ghost", t.id === "folder" ? "point at the folder instead →"
        : t.id === "site" ? "point at the site instead →" : "point at the repo instead →");
      btn.type = "button";
      btn.onclick = () => {
        pt.pointer = t.id;
        pt.input = t.id === b.transfer && b.prefill ? b.prefill : "";
        pt.blocked = null;
        setPhase("pointer");
        setTimeout(() => $("pt-input")?.focus(), 20);
      };
      next.append(btn);
    }
    box.append(next);
    if (b.transfer === "folder") {
      box.append(el("div", "pt-quiet", "If it's yours and it's cloned locally, the folder pointer reads it without any network at all — and apps then open the real files."));
    }
    wrap.append(box);
    return wrap;
  }

  // =============================================================================================
  // PUBLIC SURFACE
  // =============================================================================================
  async function probeGrant() {
    if (!relay) { grantOk = { models: false, webfetch: false }; return; }
    const g = await relay.permissions().catch(() => null);
    grantOk = {
      models: !!(g && Array.isArray(g.models) && g.models.length),
      webfetch: !!(g && Array.isArray(g.tools) && g.tools.some((t) => (typeof t === "string" ? t : t?.name) === "WebFetch")),
    };
  }

  return {
    /** Called once at first paint — wires the static controls that live in index.html. */
    mount() {
      const bar = $("pt-bar");
      if (bar) bar.onclick = () => { collapsed = false; render(); setTimeout(() => $("pt-input")?.focus(), 20); };
      const hide = $("pt-collapse");
      if (hide) hide.onclick = () => { collapsed = true; render(); };
      const re = $("pt-reconnect-go");
      if (re) {
        re.onclick = async () => {
          if (!relay) return;
          re.disabled = true;
          try { await relay.connect(host.scope); } catch { /* the wall stays up */ }
          await probeGrant();
          re.disabled = false;
          render();
        };
      }
      render();
    },

    async onConnect(r) {
      relay = r;
      connected = true;
      await probeGrant();
      await restoreDraft();
      render();
    },

    onDisconnect() {
      abort();
      relay = null;
      connected = false;
      grantOk = { models: false, webfetch: false };
      pt = blank();
      collapsed = false;
      // the section goes home to #hero — home.js does the move, we just repaint
      render();
    },

    /** The library decides whether this opens wide or sits as a one-line bar. */
    setLibrary(metas) {
      libraryEmpty = !metas || metas.length === 0;
      if (pt.phase === "pointer" && !resumed) collapsed = !libraryEmpty;
      render();
    },

    /** Entry points elsewhere in the page (+ New project, the empty card, the way-stepper). */
    open(pointer) {
      collapsed = false;
      if (pointer && TILE_BY_ID[pointer]) pt.pointer = pointer;
      if (pt.phase === "ready" || pt.phase === "blocked") pt = { ...blank(), pointer: pt.pointer };
      render();
      sec()?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $("pt-input")?.focus(), 260);
    },

    isEmptyLibrary: () => libraryEmpty,
    render,
  };
}
