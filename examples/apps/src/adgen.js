// Adwall (adgen) — the volume-first, image-led counterpart to AdForge. Where AdForge takes one
// brand deep into ONE polished Meta feed ad, Adwall goes wide: one drafting pass fills a wall of
// six distinct visual ad directions (angle + headline + art direction + format), one marked
// recommended, each renderable into a real creative via the visitor's own Higgsfield connector
// with a single click. CONTEXT-FIRST: the moment Switchboard is connected — fresh chip click OR
// page-load with an existing grant — the last wall restores from relay.storage instantly, the
// lent brand is pulled (context.active(), else the first kind:"brand" via context.use()), and if
// the wall is empty or the brand changed, six directions draft themselves in one pure-text stream
// with zero clicks. Renders stay one-click-per-tile: each spends Higgsfield credits, and the
// per-action consent gate is the user's brake pedal. The app holds no key and no brand data.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import {
  mountBankIt, mountBorrowOffer, clearBorrowOffer, findBankedForUrl, useContext, listContexts,
  hostOf, slugId,
} from "./store/bankit.js";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const STORE_KEY = "adgen:state";
const SAMPLE_URL = "https://www.allbirds.com";
const FORMATS = ["1:1", "9:16", "16:9"];
// Same harvest regex family as adforge/cast — image URLs come back either as bare links or JSON fields.
const URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;

let relay = null;
let notInstalled = false;
let booted = false;      // bootConnected ran for the current connection (chip + probe never race)
let drafting = false;
let castingIdx = -1;     // which tile's render is in flight, -1 when idle
let lastAction = null;   // what "Retry" re-runs
let lent = null;         // the normalized lent brand context, or null
let urlRevealed = false; // brand lent, but the user opened the URL path anyway
let libraryMetas = [];   // context.list() metadata — dedupes the bank chip, powers the borrow offer
let borrowSkipped = "";  // the URL the user chose to re-read anyway (the offer never nags twice)

let state = {
  brandName: null,   // the brand the current wall was drafted from — drives the brand-switch redraft
  source: "url",     // "brand" (lent context) | "url" — what the current wall came from
  brand: null,       // {name, product, tone, colors} the wall was drafted from (display strip + casts)
  directions: [],    // {name, angle, headline, imagePrompt, format, recommended, image}
  steer: "",         // the one optional free-text knob
  url: SAMPLE_URL,
  siteCache: null,   // WebFetch result text, so "Draft 6 more" skips the re-read
  siteCacheUrl: null,
};

// ---------- persistence: relay.storage when connected, localStorage so pre-connect state survives ----------
let saveTimer = 0;
function save() {
  const payload = JSON.stringify({
    brandName: state.brandName, source: state.source, brand: state.brand,
    directions: state.directions, steer: state.steer, url: state.url,
    siteCache: state.siteCache ? state.siteCache.slice(0, 12000) : null,
    siteCacheUrl: state.siteCacheUrl,
  });
  try { localStorage.setItem(STORE_KEY, payload); } catch { /* storage full or blocked — non-fatal */ }
  if (!relay) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (relay) relay.storage.set(STORE_KEY, payload).catch(() => {}); }, 300);
}
function applyRaw(raw) {
  try {
    const s = JSON.parse(raw);
    if (s && typeof s === "object") Object.assign(state, s);
  } catch { /* corrupt store — start clean */ }
  sanitize();
}
function sanitize() {
  if (typeof state.url !== "string" || !state.url) state.url = SAMPLE_URL;
  if (typeof state.steer !== "string") state.steer = "";
  if (state.source !== "brand") state.source = "url";
  if (typeof state.brandName !== "string") state.brandName = null;
  if (!state.brand || typeof state.brand !== "object") state.brand = null;
  if (!Array.isArray(state.directions)) state.directions = [];
  state.directions = state.directions
    .filter((d) => d && typeof d === "object")
    .map((d) => ({
      name: str(d.name, "Untitled direction"),
      angle: str(d.angle, "Direct response"),
      headline: str(d.headline, "—").slice(0, 48),
      imagePrompt: str(d.imagePrompt, ""),
      format: FORMATS.includes(d.format) ? d.format : "1:1",
      recommended: !!d.recommended,
      image: typeof d.image === "string" && d.image ? d.image : null,
    }));
}

// ---------- small utils ----------
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const str = (v, fb) => (typeof v === "string" && v.trim() ? v.trim() : fb);
const resultText = (d) => (d.result?.content ?? []).map((c) => c.text ?? "").join("");
const extractUrl = (t) => { const m = (t || "").match(URL_RE); return m ? (m[1] || m[2] || m[0]) : null; };
function normHex(v) {
  let x = String(v || "").trim();
  if (x && x[0] !== "#") x = "#" + x;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(x);
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = h.split("").map((ch) => ch + ch).join("");
  return "#" + h.slice(0, 6).toLowerCase();
}

// ---------- brand context: normalize defensively — no locked schema (adforge idiom) ----------
function normalizeBrand(ctx) {
  const d = (ctx && ctx.data) || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  const rich = Array.isArray(d.paletteRich)
    ? d.paletteRich.map((p) => p && (p.hex || p.color || p.value)).filter(Boolean).map(String)
    : [];
  const flat = arr(d.palette).length ? arr(d.palette) : rich;
  return {
    name: str(ctx && ctx.name, str(d.name, "Brand")),
    voice: String(d.voice || d.vibe || "").trim(),
    positioning: String(d.positioning || "").trim(),
    audience: String(d.audience || "").trim(),
    palette: flat.map(normHex).filter(Boolean).slice(0, 6),
    products: arr(d.products).length ? arr(d.products) : arr(d.range),
  };
}

// Resolve the lent brand: the active context first; else auto-select the first kind:"brand"
// meta via context.use() so a user who lent a brand never faces an empty form.
async function loadBrandCtx() {
  if (!relay || !relay.context || typeof relay.context.active !== "function") { lent = null; return; }
  let ctx = null;
  try { ctx = await relay.context.active(); } catch { ctx = null; }
  // One list() serves two jobs: the auto-select fallback, and the library metadata the bank chip
  // dedupes against / the borrow offer matches on. Metadata only — never payloads.
  libraryMetas = await listContexts(relay);
  if (!ctx) {
    const bm = libraryMetas.find((m) => (m.kind || "").toLowerCase() === "brand");
    if (bm) ctx = await useContext(relay, bm.id);
  }
  lent = ctx ? normalizeBrand(ctx) : null;
}

function clearWall() {
  state.brandName = null; state.brand = null; state.directions = [];
  save();
  $("wall-sec").hidden = true;
}

// PROACTIVE RULE: connected + brand known + (wall empty OR wall belongs to another brand) → draft
// with zero user input. Text drafting costs no write-tool consent, so auto-firing it is polite;
// image renders never auto-fire — they spend credits.
function maybeAutoDraft() {
  if (!relay || !lent || drafting || castingIdx >= 0) return;
  const changed = !!state.brandName && state.brandName !== lent.name;
  if (state.directions.length && !changed) return;
  if (changed) clearWall();
  void draftRun({ mode: "brand" });
}

// The "switch"/"use a brand" affordance: open the Switchboard picker, then re-derive.
async function pickBrand(btn) {
  if (!relay || !relay.context || typeof relay.context.pick !== "function") {
    showError("This Switchboard build has no context picker — update the extension.", null);
    return;
  }
  const was = btn.textContent;
  btn.textContent = "choosing in Switchboard…";
  btn.disabled = true;
  try {
    const ctx = await relay.context.pick();
    if (ctx) {
      lent = normalizeBrand(ctx);
      urlRevealed = false;
    }
  } catch (err) {
    showError("Brand pick failed: " + (err?.message || err), null);
  } finally {
    btn.textContent = was;
    btn.disabled = false;
    renderEntry();
    reflect();
    maybeAutoDraft();
  }
}

// ---------- wall log / errors (every failure is a visible line, never console-only) ----------
function logLine(text, cls) {
  $("walllog").hidden = false;
  const d = el("div", "logline" + (cls ? " " + cls : ""), text);
  $("log").append(d);
  $("log").scrollTop = $("log").scrollHeight;
  return d;
}
function clearLog() { $("log").textContent = ""; }
function showError(msg, retryFn) {
  lastAction = retryFn || null;
  $("errbox").hidden = false;
  $("err-msg").textContent = msg;
  $("err-retry").hidden = !retryFn;
}
function hideError() { $("errbox").hidden = true; }
$("err-retry").addEventListener("click", () => { hideError(); if (lastAction) lastAction(); });

// ---------- connected boot: storage first (instant paint), then context, then proactive draft ----------
// Used by BOTH the chip's onConnect and the fast probe; `booted` keeps them from racing.
async function bootConnected(r) {
  relay = r;
  if (booted) { renderEntry(); renderWall(); reflect(); return; }
  booted = true;
  const remote = await r.storage.get(STORE_KEY).catch(() => null);
  if (remote != null) applyRaw(remote);
  else save(); // seed relay.storage with whatever localStorage carried across
  renderEntry();
  renderWall();
  reflect();
  await loadBrandCtx();
  renderEntry();
  reflect();
  maybeAutoDraft();
}

// ---------- the standard connect chip (cartridge idiom) — no models in scope: grants are exact-match ----------
mountConnect($("chip-dock"), {
  scope: {
    reason: "draft a wall of ad directions from your lent brand, render picks on your Higgsfield, and offer to bank what it reads off a site as a brand in your library",
    tools: ["WebFetch", "mcp__claude_ai_Higgsfield__*"],
    contextKinds: ["brand"],
  },
  installUrl: INSTALL_URL,
  onConnect: (r) => { void bootConnected(r); },
  onDisconnect: () => {
    relay = null; lent = null; booted = false;
    renderEntry(); renderWall(); reflect();
  },
  // The chip's own "Switch" menu runs context.pick() itself — re-read the lent brand and let the
  // proactive rule clear + redraft if the wall belongs to the previous brand.
  onProjectChange: async () => {
    await loadBrandCtx();
    renderEntry();
    reflect();
    maybeAutoDraft();
  },
});
// Fast probe so a returning user's grant boots everything without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { await bootConnected(r); return; }
  } else {
    notInstalled = true;
  }
  renderEntry();
  reflect();
})();

// ---------- 01 · source ----------
function renderEntry() {
  const hasBrand = !!(relay && lent);
  $("brand-entry").hidden = !hasBrand;
  $("url-entry").hidden = hasBrand && !urlRevealed;
  $("url-toggle").textContent = urlRevealed ? "hide the URL path" : "or draft from a site URL instead";
  if (hasBrand) {
    $("b-name").textContent = lent.name;
    const line = $("b-line");
    line.textContent = "";
    const bits = [lent.positioning || lent.voice, lent.audience ? "for " + lent.audience : ""]
      .filter(Boolean).join(" · ");
    if (bits) line.append(document.createTextNode(bits + " "));
    for (const c of lent.palette.slice(0, 4)) {
      const sw = el("span", "sw");
      sw.style.background = c;
      sw.title = c;
      line.append(sw);
    }
  }
}

function reflect() {
  const busy = drafting || castingIdx >= 0;
  const on = !!relay;
  $("draft-brand").disabled = !on || busy;
  $("draft-brand").textContent = drafting ? "Drafting…" : `Draft the wall for ${lent ? lent.name : "your brand"}`;
  $("draft-url").disabled = !on || busy;
  $("draft-url").textContent = drafting ? "Drafting…" : "Draft the wall";
  $("use-brand").disabled = !on || busy;
  $("switch-brand").disabled = busy;
  $("more").disabled = !on || busy;
  $("more-bottom").disabled = !on || busy;
  $("steer").disabled = busy;
  $("f-url").disabled = busy;
  const hint = $("conn-hint");
  hint.textContent = "";
  if (on) {
    hint.textContent = lent
      ? "runs on your Claude — the wall drafts itself from your lent brand"
      : "no brand lent — paste a site and Adwall extracts the brand on your Claude";
  } else if (notInstalled) {
    hint.append("Switchboard isn't installed — ");
    const a = el("a", null, "get it here");
    a.href = INSTALL_URL; a.target = "_blank"; a.rel = "noreferrer";
    hint.append(a, " to draft the wall.");
  } else {
    hint.textContent = "connect Switchboard (top right) — with a lent brand the wall drafts itself";
  }
}

$("f-url").value = state.url;
$("f-url").addEventListener("input", () => { state.url = $("f-url").value.trim(); save(); });
$("f-url").addEventListener("keydown", (e) => { if (e.key === "Enter") $("draft-url").click(); });
$("steer").value = state.steer;
$("steer").addEventListener("input", () => { state.steer = $("steer").value; save(); });
$("url-toggle").addEventListener("click", () => { urlRevealed = !urlRevealed; renderEntry(); });
$("switch-brand").addEventListener("click", () => pickBrand($("switch-brand")));
$("use-brand").addEventListener("click", () => pickBrand($("use-brand")));

// ---------- 02 · draft the wall (ONE streamed turn, ONLY-JSON with guarded parse) ----------
const WALL_SHAPE =
  '{"directions":[exactly 6 items, each {"name":string (2-4 word direction name),"angle":string (2-4 word strategic angle label),"headline":string (max 40 characters of ad headline),"imagePrompt":string (vivid art-direction prompt for the creative — subject, setting, light, mood; no text, no lettering, no logos in the image),"format":"1:1"|"9:16"|"16:9" (pick what suits the direction — mix formats across the wall),"recommended":boolean}]}';

function steerLine() {
  const steer = state.steer.trim();
  return steer ? `Steer every direction with this note: "${steer}".` : "";
}
function freshLine(priorNames) {
  return priorNames && priorNames.length
    ? `These direction names were already used — produce six NEW directions with different angles and names: ${priorNames.join(", ")}.`
    : "";
}

// Context-first path: everything derives from the lent brand. Pure text — no tools at all.
function buildBrandDraftPrompt(b, priorNames) {
  return [
    "You are Adwall, a creative director who fills a wall with distinct, scroll-stopping ad directions.",
    "The brand is already known — do NOT call WebFetch or any other tool. Work only from this brand context:",
    `Brand: ${b.name}`,
    b.positioning ? `Positioning: ${b.positioning}` : "",
    b.voice ? `Voice — every headline in this voice: ${b.voice}` : "",
    b.audience ? `Audience — aim every direction at them: ${b.audience}` : "",
    b.products.length ? `Products: ${b.products.join("; ")}` : "",
    b.palette.length ? `Brand palette — fold these into each imagePrompt's art direction: ${b.palette.join(", ")}` : "",
    "Respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    WALL_SHAPE,
    "Every direction must take a clearly different visual and strategic angle — no two alike.",
    steerLine(),
    'Exactly ONE direction must have "recommended": true — the one you would render first.',
    freshLine(priorNames),
  ].filter(Boolean).join("\n");
}

// URL fallback: the visitor's Claude reads the site and extracts the brand too.
function buildUrlDraftPrompt(url, cachedText, priorNames) {
  const read = cachedText
    ? `Here is the page content, already fetched — do NOT call WebFetch:\n"""\n${cachedText}\n"""`
    : `First use WebFetch to read ${url} — one fetch of that page is enough.`;
  return [
    "You are Adwall, a creative director who fills a wall with distinct, scroll-stopping ad directions.",
    `Target website: ${url}`,
    read,
    "Then respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    '{"brand":{"name":string,"product":string (one line, what they sell),"tone":string,"colors":[2-4 hex color strings pulled from the site]},' +
      WALL_SHAPE.slice(1),
    "Every direction must take a clearly different visual and strategic angle — no two alike.",
    steerLine(),
    'Exactly ONE direction must have "recommended": true — the one you would render first.',
    freshLine(priorNames),
  ].filter(Boolean).join("\n");
}

// Guarded parse: strip fences, grab the outer object, coerce every field, cap the batch at 6.
// Fresh walls always end up with exactly one recommended; append batches keep AT MOST one so an
// old star can survive a batch the model left unstarred.
function parseWall(raw, brandKnown, append) {
  try {
    const cleaned = String(raw).replace(/```(?:json)?/gi, "");
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    let list = Array.isArray(data.directions) ? data.directions : [];
    if (list.length < 3) return null;
    list = list.slice(0, 6).map((d) => ({
      name: str(d.name, "Untitled direction"),
      angle: str(d.angle, "Direct response"),
      headline: str(d.headline, "—").slice(0, 48),
      imagePrompt: str(d.imagePrompt, ""),
      format: FORMATS.includes(d.format) ? d.format : "1:1",
      recommended: !!d.recommended,
      image: null,
    }));
    const recAt = list.findIndex((d) => d.recommended);
    list.forEach((d, i) => { d.recommended = append ? i === recAt : i === (recAt === -1 ? 0 : recAt); });
    if (brandKnown) return { brand: null, directions: list };
    const b = data.brand || {};
    return {
      brand: {
        name: str(b.name, "The brand"),
        product: str(b.product, ""),
        tone: str(b.tone, ""),
        colors: (Array.isArray(b.colors) ? b.colors : []).map(normHex).filter(Boolean).slice(0, 4),
      },
      directions: list,
    };
  } catch { return null; }
}

async function draftRun(opts = {}) {
  if (!relay || drafting || castingIdx >= 0) return;
  state.steer = $("steer").value; // the steer USED is always the steer SHOWN, even after a boot-time restore
  const mode = opts.mode === "brand" || opts.mode === "url" ? opts.mode : (lent ? "brand" : "url");
  if (mode === "brand" && !lent) { showError("No brand is lent — pick one with “Use a lent brand”.", null); return; }
  if (mode === "url") {
    const url = $("f-url").value.trim();
    if (!url) { showError("Give Adwall a site URL first.", null); return; }
    state.url = url;
  }
  const append = !!opts.avoidRepeats && state.directions.length > 0;
  const cached = mode === "url" && !!(state.siteCache && state.siteCacheUrl === state.url);
  // BORROW BEFORE FETCHING: if this host is already banked, offer the banked brand instead of
  // burning another read on the same site. An offer, never a gate — dismissing re-runs the fetch.
  if (mode === "url" && !cached && await offerBorrow(state.url)) return;
  const priorNames = opts.avoidRepeats ? state.directions.map((d) => d.name) : null;
  drafting = true;
  hideError();
  clearBorrowOffer($("borrow"));
  clearLog();
  reflect();
  renderWall();
  let params;
  if (mode === "brand") {
    logLine(`drafting from your lent brand “${lent.name}” — no site fetch needed…`);
    params = { prompt: buildBrandDraftPrompt(lent, priorNames), agentic: false };
  } else {
    logLine(cached ? "using the banked site read — no re-fetch needed…" : "reading the site on your Claude…");
    params = { prompt: buildUrlDraftPrompt(state.url, cached ? state.siteCache : null, priorNames), agentic: true };
  }
  const liveLine = logLine("drafting the wall… 0.0 kb", "live");
  let acc = "";
  try {
    for await (const d of relay.stream(params)) {
      if (d.type === "tool_proposed") {
        if (d.call.name === "WebFetch") logLine("reading the site…");
        else logLine("tool → " + d.call.name);
      } else if (d.type === "tool_result") {
        if (d.call.name === "WebFetch" && d.result?.ok) {
          const t = resultText(d);
          if (t) {
            state.siteCache = t.slice(0, 12000);
            state.siteCacheUrl = state.url;
            logLine("site read banked for redrafts (" + Math.max(1, Math.round(t.length / 1024)) + " kb)");
          }
        } else if (d.result && !d.result.ok) {
          logLine("blocked: " + (d.result.error?.message || d.call.name), "bad");
        }
      } else if (d.type === "text") {
        acc += d.text;
        liveLine.textContent = "drafting the wall… " + (acc.length / 1024).toFixed(1) + " kb";
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
    const parsed = parseWall(acc, mode === "brand", append);
    if (!parsed) throw new Error("The draft came back malformed — hit Retry; it usually lands clean on the second pass.");
    if (mode === "brand") {
      state.brand = {
        name: lent.name,
        product: lent.products[0] || "",
        tone: lent.voice || lent.positioning || "",
        colors: lent.palette.slice(0, 4),
      };
      state.brandName = lent.name;
    } else if (parsed.brand) {
      state.brand = parsed.brand;
      state.brandName = parsed.brand.name;
    }
    state.source = mode;
    if (append) {
      // A starred new batch takes the star; a starless one leaves the old star standing.
      if (parsed.directions.some((d) => d.recommended)) {
        state.directions.forEach((d) => { d.recommended = false; });
      }
      state.directions = state.directions.concat(parsed.directions);
    } else {
      state.directions = parsed.directions;
    }
    save();
    liveLine.textContent = "drafting the wall… done";
    logLine(`${parsed.directions.length} directions on the wall — render the ones worth money.`, "good");
    renderWall();
    $("wall-sec").hidden = false;
    if (!append) $("wall-sec").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    const msg = String(err?.message || err);
    logLine("draft failed: " + msg, "bad");
    showError(msg, () => draftRun(opts));
  } finally {
    drafting = false;
    reflect();
    renderWall();
  }
}

$("draft-brand").addEventListener("click", () => draftRun({ mode: "brand" }));
$("draft-url").addEventListener("click", () => draftRun({ mode: "url" }));
function draftMore() {
  if (state.source === "brand") {
    // Never silently switch a brand wall to the URL path — that would append directions for a
    // DIFFERENT brand (the sample URL) and relabel the wall.
    if (lent) draftRun({ mode: "brand", avoidRepeats: true });
    else showError("The brand behind this wall isn't lent anymore — pick it again with “Use a lent brand”, or draft a fresh wall from a URL.", null);
  } else {
    draftRun({ mode: "url", avoidRepeats: true });
  }
}
$("more").addEventListener("click", draftMore);
$("more-bottom").addEventListener("click", draftMore);

// ---------- the wall ----------
function renderBrandline() {
  const b = state.brand;
  const mount = $("brandline");
  mount.textContent = "";
  if (!b) return;
  mount.append(el("b", null, b.name));
  const meta = [b.product, b.tone].filter(Boolean).join(" · ");
  if (meta) mount.append(document.createTextNode(" · " + meta + " "));
  (b.colors || []).forEach((c) => {
    const sw = el("span", "sw");
    sw.style.background = c;
    sw.title = c;
    mount.append(sw);
  });
  if (state.source === "brand") mount.append(el("span", "srcchip", "your lent brand"));
  mountBankOffer(mount);
}

// STOP THE HOARDING: the wall's brand strip is the moment the extraction is already on screen, so
// that is where the opt-in offer lives. Absent when the wall was drafted from a lent context (it
// came FROM the library — there is nothing to bank).
function bankDraft() {
  const b = state.brand;
  if (!relay || state.source !== "url" || !b || !b.name) return null;
  // parseWall's placeholder — the read produced no real identity, so there is nothing worth banking.
  if (b.name === "The brand") return null;
  const domain = hostOf(state.url);
  return {
    id: slugId(domain || b.name),
    name: b.name,
    data: {
      positioning: b.product || "",
      voice: b.tone || "",
      palette: Array.isArray(b.colors) ? b.colors : [],
      products: [],
      ...(domain ? { domain } : {}),
      source: { kind: "site", url: state.url },
    },
  };
}
function mountBankOffer(mount) {
  const draft = bankDraft();
  if (!draft) return;
  mountBankIt(mount, {
    relay,
    kind: "brand",
    draft,
    contexts: libraryMetas,
    onPublished: (meta) => {
      libraryMetas = libraryMetas.filter((m) => m.id !== meta.id).concat(meta);
      logLine(`“${meta.name}” banked — every wrapp can borrow it now instead of re-reading the site.`, "good");
    },
  });
}

// The mirror: before this host is read AGAIN, ask the library whether it is already banked. list()
// is metadata only; use() runs only if the user takes the offer. Returns true when the offer is on
// screen (the caller stands down and waits for the click).
async function offerBorrow(url) {
  const dock = $("borrow");
  if (!dock || !relay || !url || borrowSkipped === url) return false;
  if (lent && !urlRevealed) return false; // a brand is already lent — nothing to borrow
  const meta = await findBankedForUrl(relay, url, "brand");
  if (!meta) return false;
  mountBorrowOffer(dock, {
    name: meta.name,
    detail: `banked brand · ${hostOf(url) || "your library"} — read once, reusable everywhere`,
    swatches: meta.swatches || [],
    onUse: async () => {
      const ctx = await useContext(relay, meta.id);
      if (!ctx) { borrowSkipped = url; void draftRun({ mode: "url" }); return; }
      lent = normalizeBrand(ctx);
      urlRevealed = false;
      renderEntry();
      reflect();
      void draftRun({ mode: "brand" });
    },
    // Dismissal always re-runs the fetch path — the offer is never a dead end.
    onDismiss: () => { borrowSkipped = url; void draftRun({ mode: "url" }); },
  });
  return true;
}

function aspectOf(fmt) {
  if (fmt === "9:16") return "9 / 16";
  if (fmt === "16:9") return "16 / 9";
  return "1 / 1";
}

function renderWall() {
  renderBrandline();
  const mount = $("wall");
  mount.textContent = "";
  const busy = drafting || castingIdx >= 0;
  state.directions.forEach((dir, i) => {
    const tile = el("div", "tile" + (dir.recommended ? " rec" : ""));
    const top = el("div", "tiletop");
    top.append(el("span", "anglechip", dir.angle));
    if (dir.recommended) top.append(el("span", "recflag", "★ RECOMMENDED"));
    top.append(el("span", "fmt", dir.format));
    const prompt = el("div", "tprompt",
      dir.imagePrompt.length > 150 ? dir.imagePrompt.slice(0, 150) + "…" : dir.imagePrompt);
    const box = el("div", "timgbox");
    box.style.aspectRatio = aspectOf(dir.format);
    const hint = el("div", "timghint");
    box.append(hint);
    if (dir.image) {
      const img = document.createElement("img");
      img.alt = dir.headline || "rendered ad creative";
      img.src = dir.image;
      // Broken image URL (expired CDN link etc.) → visible hint, not a grey mystery box.
      img.addEventListener("error", () => {
        img.remove();
        hint.classList.add("bad");
        hint.textContent = "the creative failed to load — hit Recast";
      });
      hint.textContent = "";
      box.append(img);
    } else if (castingIdx === i) {
      const line = el("span", "castline");
      line.append(el("span", "dotlive"), document.createTextNode("rendering — approve if asked…"));
      hint.append(line);
    } else {
      hint.textContent = "not rendered yet — one click, one Higgsfield credit";
    }
    const foot = el("div", "tilefoot");
    const btn = el("button", dir.image ? "btn" : "btn btn-primary",
      castingIdx === i ? "Rendering…" : dir.image ? "Recast" : "Render");
    btn.type = "button";
    btn.disabled = !relay || busy;
    btn.addEventListener("click", () => {
      if (dir.image) { dir.image = null; save(); }
      void castRun(i);
    });
    foot.append(btn);
    tile.append(top, el("div", "theadline", dir.headline), prompt, box, foot);
    mount.append(tile);
  });
  $("wall-sec").hidden = state.directions.length === 0;
}

// ---------- per-tile render (agentic Higgsfield loop, adforge cast pattern — brand woven in) ----------
function castLineFor(name) {
  if (name.endsWith("generate_image")) return "rendering the creative (approve if asked)…";
  if (name.includes("media_")) return "handling media…";
  return "tool → " + name;
}

async function castRun(i) {
  if (!relay || drafting || castingIdx >= 0) return;
  const dir = state.directions[i];
  if (!dir) return;
  castingIdx = i;
  hideError();
  reflect();
  renderWall();
  logLine(`rendering “${dir.name}” at ${dir.format}…`);
  let url = null, acc = "";
  try {
    const b = state.brand || {};
    const brandBits = [
      `Brand palette: ${(b.colors || []).join(", ") || "natural, muted"}.`,
      `Brand tone: ${b.tone || "clean and confident"}.`,
    ].join(" ");
    const instruction =
      `Use the Higgsfield generate_image tool with model "nano_banana_pro" to generate ONE advertising image.\n` +
      `Prompt: "${dir.imagePrompt}. ${brandBits} Premium social feed ad photography — no text, no lettering, no logos, no watermarks."\n` +
      `aspect_ratio "${dir.format}". Poll until the generation is complete, then reply with ONLY the final image URL on its own line.`;
    for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
      if (d.type === "tool_proposed") {
        logLine(castLineFor(d.call.name));
      } else if (d.type === "tool_result") {
        if (d.result?.ok) { const u = extractUrl(resultText(d)); if (u) url = u; }
        else logLine("blocked: " + (d.result?.error?.message || d.call.name), "bad");
      } else if (d.type === "text") {
        acc += d.text;
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
    url = url || extractUrl(acc);
    if (!url) throw new Error("No image came back — hit Retry; the second pass usually lands.");
    dir.image = url;
    save();
    logLine(`“${dir.name}” rendered at ${dir.format}.`, "good");
  } catch (err) {
    const msg = String(err?.message || err);
    logLine("render failed: " + msg, "bad");
    showError(msg, () => castRun(i));
  } finally {
    castingIdx = -1;
    reflect();
    renderWall();
  }
}

// ---------- boot: restore whatever wall was up last time, instantly, before any probe answers ----------
try { applyRaw(localStorage.getItem(STORE_KEY) ?? "null"); } catch { /* start clean */ }
$("f-url").value = state.url;
$("steer").value = state.steer;
renderWall();
renderEntry();
reflect();
