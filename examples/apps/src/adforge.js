// AdForge — Meta ads, forged on the visitor's own Claude. CONTEXT-FIRST: when the user has lent
// a brand through Switchboard, AdForge already knows everything — one button forges 3 ad concepts
// straight from the lent voice/positioning/audience/products/palette, no URL and no WebFetch.
// Given a URL instead, their Claude reads the site (WebFetch) and extracts the brand. Either way:
// three concept options (one recommended), pick one, cast it into a pixel-faithful Meta feed ad
// with a Higgsfield-rendered hero. The app holds no key, no model, and no brand data of its own.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const STORE_KEY = "adforge:state";
const SAMPLE_URL = "https://www.allbirds.com";

const ANGLE_IDEAS = ["UGC hook", "Problem → agitate → solve", "Founder story", "Offer-led urgency"];
const CTAS = ["Shop Now", "Learn More", "Get Offer", "Sign Up"];
// Same harvest regex family as cast/gen.js — image URLs come back either as bare links or JSON fields.
const URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;

let relay = null;
let notInstalled = false;
let forging = false;
let casting = false;
let lastAction = null;   // what "Retry" re-runs
let lent = null;         // the normalized lent brand context, or null
let urlRevealed = false; // brand lent, but the user opened the URL path anyway

let state = {
  url: SAMPLE_URL,
  steer: "",           // the one optional knob — a free-text angle steer
  source: "url",       // "brand" (lent context) | "url" — what the current concepts came from
  brand: null,         // {name, product, tone, audience, colors} the concepts were forged from
  concepts: [],
  picked: -1,
  aspect: "1:1",
  images: {},          // real generated URLs, keyed "1:1" / "4:5" — reset on new pick
  sample: false,
  siteCache: null,     // WebFetch result text, so "Regenerate" skips the re-read
  siteCacheUrl: null,
};

// ---------- embedded sample (explorable ONLY before connecting; zero tokens burned) ----------
const SAMPLE = {
  url: SAMPLE_URL,
  brand: {
    name: "Allbirds",
    product: "Merino wool and tree-fiber sneakers with the carbon footprint printed on them",
    tone: "warm, low-key, planet-first confidence",
    colors: ["#212A2F", "#9BC0B2", "#F4F1EA"],
  },
  concepts: [
    {
      name: "The Barefoot Commute",
      angle: "UGC hook",
      hook: "I forgot I was wearing shoes on my 6am flight.",
      primaryText: "I forgot I was wearing shoes on my 6am flight.\n\nNot an exaggeration. I put my Wool Runners on at 4am, hit two airports and a full day of meetings, and never once thought about my feet.\n\nThey're merino wool, so they breathe when it's hot and hold heat when it's cold. No socks needed. And when they finally look like they've been through a war? Straight into the washing machine.\n\nComfiest shoes I've ever owned — and the carbon footprint is printed right on the sole.",
      headline: "The World's Most Comfortable Shoe",
      description: "Machine washable. 30-day trial",
      cta: "Shop Now",
      imagePrompt: "Candid smartphone photo of light grey merino wool sneakers propped on an airport window ledge at sunrise, boarding pass tucked into one shoe, warm golden light, slightly imperfect framing, authentic UGC feel",
      recommended: true,
    },
    {
      name: "The Hot Feet Fix",
      angle: "Problem → agitate → solve",
      hook: "Your feet aren't tired. They're overheating.",
      primaryText: "Your feet aren't tired. They're overheating.\n\nSynthetic sneakers trap heat and sweat all day, and by 3pm you can feel it — that swampy, restless, get-me-out-of-these-shoes feeling.\n\nWool Runners are knit from superfine merino. It wicks moisture, breathes with every step, and regulates temperature the way plastic never will.\n\nCool when it's warm. Warm when it's cool. Comfortable always.\n\nYour afternoon feet will notice before you do.",
      headline: "Wool That Breathes All Day",
      description: "Cool in heat. Warm in cold.",
      cta: "Learn More",
      imagePrompt: "Clean studio photograph of a single light wool sneaker floating above a cool sage-green surface with soft wisps of vapor rising around it, diffuse minimalist product lighting",
      recommended: false,
    },
    {
      name: "Carbon Math",
      angle: "Offer-led urgency",
      hook: "Most brands hide their footprint. Ours is printed on the shoe.",
      primaryText: "Most brands hide their footprint. Ours is printed on the shoe.\n\nEvery pair of Allbirds carries a carbon number the way food carries calories. We measure it, we cut it, and we offset the rest to zero.\n\nThe shoes also happen to be ridiculously comfortable — soft merino wool, machine washable, no-sock friendly.\n\nFree shipping on orders over $75 and free returns for 30 days, no questions. If they're not the comfiest shoes you own, send them back.",
      headline: "Sneakers That Show Their Math",
      description: "Free shipping over $75.",
      cta: "Get Offer",
      imagePrompt: "Overhead flat-lay of natural white wool sneakers on raw kraft paper beside hand-drawn carbon footprint sketches and a single green leaf, warm natural window light, sustainable-brand editorial style",
      recommended: false,
    },
  ],
};

// ---------- persistence ----------
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      url: state.url, steer: state.steer, source: state.source, brand: state.brand,
      concepts: state.concepts, picked: state.picked, aspect: state.aspect, images: state.images,
      sample: state.sample,
      siteCache: state.siteCache ? state.siteCache.slice(0, 12000) : null,
      siteCacheUrl: state.siteCacheUrl,
    }));
  } catch { /* storage full or blocked — non-fatal */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === "object") Object.assign(state, s);
  } catch { /* corrupt store — start clean */ }
  if (typeof state.url !== "string" || !state.url) state.url = SAMPLE_URL;
  if (typeof state.steer !== "string") state.steer = "";
  if (state.source !== "brand") state.source = "url";
  if (!Array.isArray(state.concepts)) state.concepts = [];
  if (!state.images || typeof state.images !== "object") state.images = {};
  if (state.aspect !== "4:5") state.aspect = "1:1";
  if (!(Number.isInteger(state.picked) && state.picked >= 0 && state.picked < state.concepts.length)) state.picked = -1;
}
load();

// ---------- small utils ----------
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const str = (v, fb) => (typeof v === "string" && v.trim() ? v.trim() : fb);
const cur = () => (state.picked >= 0 ? state.concepts[state.picked] : null);
const resultText = (d) => (d.result?.content ?? []).map((c) => c.text ?? "").join("");
const extractUrl = (t) => { const m = (t || "").match(URL_RE); return m ? (m[1] || m[2] || m[0]) : null; };
function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, "").toUpperCase(); }
  catch { return (u || "").replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").toUpperCase() || "EXAMPLE.COM"; }
}
// Normalize any CSS hex color to "#rrggbb": expands #abc/#abcd shorthand, strips alpha
// from 4/8-digit forms, rejects invalid lengths (5/7 digits). Returns null if not hex.
function normHex(v) {
  let x = String(v || "").trim();
  if (x && x[0] !== "#") x = "#" + x;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(x);
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = h.split("").map((ch) => ch + ch).join("");
  return "#" + h.slice(0, 6).toLowerCase();
}
function lum(hex) {
  const h = normHex(hex);
  if (!h) return 0;
  const n = parseInt(h.slice(1), 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
}
const escXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// ---------- brand context: normalize defensively — no locked schema ----------
// docs/CONTEXT-KINDS.md kind "brand": { voice, positioning, audience, palette (flat hex strings),
// paletteRich?, products?, styles? } — but ports vary, so every field is optional and coerced.
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

// Concepts forged from a previous brand belong to that brand — clear them and hide the
// downstream sections so the next forge re-derives from whichever brand is now lent.
function clearBrandConcepts() {
  state.brand = null; state.concepts = []; state.picked = -1; state.images = {}; save();
  $("concepts-sec").hidden = true;
  $("studio-sec").hidden = true;
}

function wipeSample() {
  if (!state.sample) return;
  state.brand = null; state.concepts = []; state.picked = -1; state.images = {}; state.sample = false;
  save();
  $("concepts-sec").hidden = true;
  $("studio-sec").hidden = true;
}

// Read whatever brand the user has already lent AdForge — on connect AND on load with a grant.
async function loadBrandCtx() {
  if (!relay || !relay.context || typeof relay.context.active !== "function") { lent = null; return; }
  try {
    const ctx = await relay.context.active();
    lent = ctx ? normalizeBrand(ctx) : null;
  } catch { lent = null; }
  if (lent && state.sample) wipeSample(); // real context exists — the sample dies on the spot
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
      const next = normalizeBrand(ctx);
      if (state.source === "brand" && (!lent || next.name !== lent.name)) clearBrandConcepts();
      lent = next;
      urlRevealed = false;
      if (state.sample) wipeSample();
    }
  } catch (err) {
    showError("Brand pick failed: " + (err?.message || err), null);
  } finally {
    btn.textContent = was;
    btn.disabled = false;
    renderEntry();
    reflect();
  }
}

// ---------- forge log / errors (every failure is a visible line, never console-only) ----------
function logLine(text, cls) {
  $("forgelog").hidden = false;
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

// ---------- the standard connect chip (cartridge idiom, verbatim) ----------
mountConnect($("chip-dock"), {
  scope: {
    reason: "forge Meta ads from your lent brand or a site you name",
    tools: ["WebFetch", "mcp__claude_ai_Higgsfield__*"],
    models: ["sonnet"],
  },
  installUrl: INSTALL_URL,
  onConnect: async (r) => {
    relay = r;
    wipeSample();          // connected — hardcoded sample data has no business here anymore
    await loadBrandCtx();  // context-first: read the lent brand the moment we're in
    renderEntry();
    reflect();
  },
  onDisconnect: () => { relay = null; lent = null; renderEntry(); reflect(); },
  // The chip's own "Switch" menu runs context.pick() itself — without this hook the chip would
  // show the new brand while the entry card, forge button, and concepts still carried the old
  // one. Re-read the lent brand and apply the same stale-concept clearing pickBrand does
  // (persona.js idiom: onProjectChange re-runs the brand load).
  onProjectChange: async () => {
    const prev = lent;
    await loadBrandCtx();
    if (state.source === "brand" && (prev && prev.name) !== (lent && lent.name)) clearBrandConcepts();
    renderEntry();
    reflect();
  },
});
// Fast probe so a returning user's grant enables everything without a click — and re-reads context.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) {
      relay = r;
      wipeSample();
      await loadBrandCtx();
    }
  } else {
    notInstalled = true;
  }
  renderEntry();
  reflect();
})();

// ---------- 01 · source: which entry the user sees ----------
function renderEntry() {
  const hasBrand = !!(relay && lent);
  $("brand-entry").hidden = !hasBrand;
  $("url-entry").hidden = hasBrand && !urlRevealed;
  $("use-brand").hidden = hasBrand;          // "switch brand" covers it up top
  $("sample").hidden = !!relay;              // samples live ONLY in the not-connected state
  $("url-toggle").textContent = urlRevealed ? "hide the URL path" : "or forge from a site URL instead";
  $("url-sample-note").hidden = $("f-url").value.trim() !== SAMPLE_URL;
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
  const busy = forging || casting;
  const on = !!relay;
  $("forge").disabled = !on || busy;
  $("forge").textContent = forging ? "Forging…" : "Forge concepts";
  $("forge-brand").disabled = !on || busy;
  $("forge-brand").textContent = forging ? "Forging…" : `Forge ads for ${lent ? lent.name : "your brand"}`;
  $("use-brand").disabled = !on || busy;
  $("switch-brand").disabled = busy;
  $("regen-concepts").disabled = !on || busy;
  $("regen-copy").disabled = !on || busy || state.picked < 0;
  $("cast").disabled = !on || busy || state.picked < 0;
  $("recast").disabled = !on || busy || state.picked < 0;
  // Aspect flip auto-recasts, and a flip mid-run would land the in-flight cast on a hidden
  // aspect — so the toggle locks while a forge or cast is running, like the other buttons.
  $("asp-11").disabled = busy;
  $("asp-45").disabled = busy;
  $("cast").hidden = !!state.images[state.aspect];
  const hint = $("conn-hint");
  hint.textContent = "";
  if (on) {
    hint.textContent = "runs on your Claude — the site read and every render are yours";
  } else if (notInstalled) {
    hint.append("Switchboard isn't installed — ");
    const a = el("a", null, "get it here");
    a.href = INSTALL_URL; a.target = "_blank"; a.rel = "noreferrer";
    hint.append(a, " to fire the forge.");
  } else {
    hint.textContent = "connect Switchboard (top right) to forge — the sample works now";
  }
}

$("f-url").value = state.url;
$("f-url").addEventListener("input", () => {
  state.url = $("f-url").value.trim();
  save();
  $("url-sample-note").hidden = state.url !== SAMPLE_URL;
});
$("f-url").addEventListener("keydown", (e) => { if (e.key === "Enter") $("forge").click(); });
$("steer").value = state.steer;
$("steer").addEventListener("input", () => { state.steer = $("steer").value; save(); });
$("url-toggle").addEventListener("click", () => { urlRevealed = !urlRevealed; renderEntry(); });
$("switch-brand").addEventListener("click", () => pickBrand($("switch-brand")));
$("use-brand").addEventListener("click", () => pickBrand($("use-brand")));

// ---------- 02 · forge concepts (ONE streamed agentic turn, ONLY-JSON with guarded parse) ----------
const CONCEPT_SHAPE =
  '{"concepts":[exactly 3 items, each {"name":string (2-4 word concept name),"angle":string,"hook":string (the scroll-stopping first line),"primaryText":string (Meta primary text, at most 125 words, short paragraphs separated by \\n\\n, the hook as its first line),"headline":string (max 40 characters),"description":string (max 30 characters),"cta":"Shop Now"|"Learn More"|"Get Offer"|"Sign Up","imagePrompt":string (vivid art-direction prompt for the ad hero image — no text, no logos in the image),"recommended":boolean}]}';

function steerLine() {
  const steer = state.steer.trim();
  return steer
    ? `Steer all three concepts with this direction: "${steer}". Set each concept's "angle" to a 2-4 word label for the angle it takes.`
    : `Take 3 distinct angles (e.g. ${ANGLE_IDEAS.join("; ")}) — a different one per concept — and set each concept's "angle" accordingly.`;
}
function freshLine(priorNames) {
  return priorNames && priorNames.length
    ? `These concept names were already used — produce three NEW concepts with different hooks and names: ${priorNames.join(", ")}.`
    : "";
}

// Context-first path: everything derives from the lent brand. No WebFetch, no tools at all.
function buildBrandForgePrompt(b, priorNames) {
  return [
    "You are AdForge, a direct-response creative director who writes Meta (Facebook/Instagram) feed ads that stop thumbs.",
    "The brand is already known — do NOT call WebFetch or any other tool. Work only from this brand context:",
    `Brand: ${b.name}`,
    b.positioning ? `Positioning: ${b.positioning}` : "",
    b.voice ? `Voice — write ALL copy in this voice: ${b.voice}` : "",
    b.audience ? `Audience — speak straight to them: ${b.audience}` : "",
    b.products.length ? `Products: ${b.products.join("; ")}` : "",
    b.palette.length ? `Brand palette — fold these into each imagePrompt's art direction: ${b.palette.join(", ")}` : "",
    "Respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    CONCEPT_SHAPE,
    steerLine(),
    'Exactly ONE concept must have "recommended": true — the one you would run first.',
    freshLine(priorNames),
  ].filter(Boolean).join("\n");
}

// URL path: the visitor's Claude reads the site and extracts the brand too.
function buildUrlForgePrompt(url, cachedText, priorNames) {
  const read = cachedText
    ? `Here is the page content, already fetched — do NOT call WebFetch:\n"""\n${cachedText}\n"""`
    : `First use WebFetch to read ${url} — one fetch of that page is enough.`;
  return [
    "You are AdForge, a direct-response creative director who writes Meta (Facebook/Instagram) feed ads that stop thumbs.",
    `Target website: ${url}`,
    read,
    "Then respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    '{"brand":{"name":string,"product":string (one line, what they sell),"tone":string,"colors":[2-4 hex color strings pulled from the site]},' +
      CONCEPT_SHAPE.slice(1),
    steerLine(),
    'Exactly ONE concept must have "recommended": true — the one you would run first.',
    freshLine(priorNames),
  ].filter(Boolean).join("\n");
}

function parseForge(raw, brandKnown) {
  try {
    const cleaned = String(raw).replace(/```(?:json)?/gi, "");
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    let list = Array.isArray(data.concepts) ? data.concepts : [];
    if (list.length < 3) return null;
    list = list.slice(0, 3).map((c) => ({
      name: str(c.name, "Untitled concept"),
      angle: str(c.angle, "Direct response"),
      hook: str(c.hook, str(c.headline, "—")),
      primaryText: str(c.primaryText, str(c.hook, "")),
      headline: str(c.headline, "").slice(0, 60),
      description: str(c.description, "").slice(0, 40),
      cta: CTAS.includes(c.cta) ? c.cta : "Learn More",
      imagePrompt: str(c.imagePrompt, ""),
      recommended: !!c.recommended,
    }));
    // Exactly one recommended, whatever the model did.
    const recAt = list.findIndex((c) => c.recommended);
    list.forEach((c, i) => { c.recommended = i === (recAt === -1 ? 0 : recAt); });
    if (brandKnown) return { brand: null, concepts: list };
    const b = data.brand || {};
    return {
      brand: {
        name: str(b.name, "The brand"),
        product: str(b.product, ""),
        tone: str(b.tone, ""),
        audience: "",
        colors: (Array.isArray(b.colors) ? b.colors : [])
          .map(normHex)
          .filter(Boolean)
          .slice(0, 4),
      },
      concepts: list,
    };
  } catch { return null; }
}

async function forgeRun(opts = {}) {
  if (!relay || forging || casting) return;
  const mode = opts.mode === "brand" || opts.mode === "url" ? opts.mode : (state.source === "brand" && lent ? "brand" : "url");
  if (mode === "brand" && !lent) { showError("No brand is lent — pick one with “use a brand”.", null); return; }
  if (mode === "url") {
    const url = $("f-url").value.trim();
    if (!url) { showError("Give the forge a site URL first.", null); return; }
    state.url = url;
  }
  const cached = mode === "url" && !!(opts.useCache && state.siteCache && state.siteCacheUrl === state.url);
  const priorNames = opts.avoidRepeats ? state.concepts.map((c) => c.name) : null;
  forging = true;
  reflect();
  hideError();
  clearLog();
  let prompt;
  if (mode === "brand") {
    logLine(`working from your lent brand “${lent.name}” — no site fetch needed…`);
    prompt = buildBrandForgePrompt(lent, priorNames);
  } else {
    logLine(cached ? "using the banked site read — no re-fetch needed…" : "reading the site on your Claude…");
    prompt = buildUrlForgePrompt(state.url, cached ? state.siteCache : null, priorNames);
  }
  const liveLine = logLine("drafting concepts… 0.0 kb", "live");
  let acc = "";
  try {
    for await (const d of relay.stream({ prompt, agentic: true })) {
      if (d.type === "tool_proposed") {
        if (d.call.name === "WebFetch") logLine("reading the site…");
        else logLine("tool → " + d.call.name);
      } else if (d.type === "tool_result") {
        if (d.call.name === "WebFetch" && d.result?.ok) {
          const t = resultText(d);
          if (t) {
            state.siteCache = t.slice(0, 12000);
            state.siteCacheUrl = state.url;
            logLine("site read banked for reworks (" + Math.max(1, Math.round(t.length / 1024)) + " kb)");
          }
        } else if (d.result && !d.result.ok) {
          logLine("blocked: " + (d.result.error?.message || d.call.name), "bad");
        }
      } else if (d.type === "text") {
        acc += d.text;
        liveLine.textContent = "drafting concepts… " + (acc.length / 1024).toFixed(1) + " kb";
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
    const parsed = parseForge(acc, mode === "brand");
    if (!parsed) throw new Error("The forge returned malformed concepts — hit Retry; it usually lands clean on the second pass.");
    state.brand = mode === "brand"
      ? {
          name: lent.name,
          product: lent.products[0] || "",
          tone: lent.voice || lent.positioning || "",
          audience: lent.audience || "",
          colors: lent.palette.slice(0, 4),
        }
      : parsed.brand;
    state.source = mode;
    state.concepts = parsed.concepts;
    state.picked = -1;
    state.images = {};
    state.sample = false;
    save();
    liveLine.textContent = "drafting concepts… done";
    logLine("three concepts out of the fire — pick one below.", "good");
    renderConcepts();
    $("concepts-sec").hidden = false;
    $("studio-sec").hidden = true;
    $("concepts-sec").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    const msg = String(err?.message || err);
    logLine("forge failed: " + msg, "bad");
    showError(msg, () => forgeRun(opts));
  } finally {
    forging = false;
    reflect();
  }
}

$("forge-brand").addEventListener("click", () => forgeRun({ mode: "brand" }));
$("forge").addEventListener("click", () => forgeRun({ mode: "url" }));
// Regenerate re-runs the SAME source the concepts came from, avoiding repeats.
function regenConcepts() {
  if (state.source === "brand" && lent) forgeRun({ mode: "brand", avoidRepeats: true });
  else forgeRun({ mode: "url", useCache: true, avoidRepeats: true });
}
$("regen-concepts").addEventListener("click", regenConcepts);

// ---------- rework: regenerate ONLY the picked concept's copy ----------
// "Regenerate copy" on the bench must not be regenConcepts in disguise — that would wipe the
// pick and the rendered creative. This path rewrites one concept's words in place: same angle,
// same imagePrompt, same recommended flag, picked and images untouched.
const COPY_SHAPE =
  '{"concept":{"name":string (2-4 word concept name),"hook":string (the scroll-stopping first line),"primaryText":string (Meta primary text, at most 125 words, short paragraphs separated by \\n\\n, the hook as its first line),"headline":string (max 40 characters),"description":string (max 30 characters),"cta":"Shop Now"|"Learn More"|"Get Offer"|"Sign Up"}}';

function buildCopyRegenPrompt(c, b) {
  const steer = state.steer.trim();
  return [
    "You are AdForge, a direct-response creative director who writes Meta (Facebook/Instagram) feed ads that stop thumbs.",
    "Rewrite the copy for ONE existing ad concept — same brand, same angle, fresh words. Do NOT call WebFetch or any other tool. Work only from this brand context:",
    `Brand: ${b.name || "The brand"}`,
    b.product ? `Product: ${b.product}` : "",
    b.tone ? `Tone — write ALL copy in this voice: ${b.tone}` : "",
    b.audience ? `Audience — speak straight to them: ${b.audience}` : "",
    `The concept to rework — keep its angle ("${c.angle}") and the spirit of its hook, but write a NEW hook, primary text, headline and description:`,
    `Concept name: ${c.name}`,
    `Current hook: ${c.hook}`,
    `Current primary text:\n"""\n${c.primaryText}\n"""`,
    steer ? `Steer the rewrite with this direction: "${steer}".` : "",
    "Respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    COPY_SHAPE,
  ].filter(Boolean).join("\n");
}

function parseCopyRegen(raw, old) {
  try {
    const cleaned = String(raw).replace(/```(?:json)?/gi, "");
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    const c = data.concept || (Array.isArray(data.concepts) ? data.concepts[0] : null);
    if (!c || typeof c !== "object") return null;
    return {
      name: str(c.name, old.name),
      angle: old.angle,                 // the angle is fixed for a copy rework
      hook: str(c.hook, old.hook),
      primaryText: str(c.primaryText, str(c.hook, old.primaryText)),
      headline: str(c.headline, old.headline).slice(0, 60),
      description: str(c.description, old.description).slice(0, 40),
      cta: CTAS.includes(c.cta) ? c.cta : old.cta,
      imagePrompt: old.imagePrompt,     // copy only — the creative brief stays put
      recommended: old.recommended,     // exactly-one-recommended isn't up for grabs here
    };
  } catch { return null; }
}

async function copyRegenRun() {
  if (!relay || forging || casting || state.picked < 0) return;
  const c = cur();
  const b = state.brand || {};
  forging = true;
  reflect();
  hideError();
  clearLog();
  logLine(`reworking the copy on “${c.name}” — your pick and creative stay put…`);
  const liveLine = logLine("redrafting copy… 0.0 kb", "live");
  let acc = "";
  try {
    for await (const d of relay.stream({ prompt: buildCopyRegenPrompt(c, b), agentic: true })) {
      if (d.type === "text") {
        acc += d.text;
        liveLine.textContent = "redrafting copy… " + (acc.length / 1024).toFixed(1) + " kb";
      } else if (d.type === "tool_proposed") {
        logLine("tool → " + d.call.name);
      } else if (d.type === "tool_result") {
        if (d.result && !d.result.ok) logLine("blocked: " + (d.result.error?.message || d.call.name), "bad");
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
    const next = parseCopyRegen(acc, c);
    if (!next) throw new Error("The forge returned malformed copy — hit Retry; it usually lands clean on the second pass.");
    state.concepts[state.picked] = next; // in place: picked index and rendered images survive
    save();
    liveLine.textContent = "redrafting copy… done";
    logLine("fresh copy on the bench — same concept, same creative.", "good");
    renderConcepts();
    renderStudio();
  } catch (err) {
    const msg = String(err?.message || err);
    logLine("copy rework failed: " + msg, "bad");
    showError(msg, copyRegenRun);
  } finally {
    forging = false;
    reflect();
  }
}
$("regen-copy").addEventListener("click", copyRegenRun);

// ---------- sample (one click, zero tokens, pre-connect only) ----------
$("sample").addEventListener("click", () => {
  const s = JSON.parse(JSON.stringify(SAMPLE));
  state.url = s.url;
  $("f-url").value = s.url;
  state.brand = s.brand;
  state.concepts = s.concepts;
  state.picked = -1;
  state.images = {};
  state.sample = true;
  state.source = "url";
  save();
  hideError();
  clearLog();
  logLine("sample loaded from the archive — no tokens burned.", "good");
  logLine("pick a concept below; connect Switchboard to forge for real.");
  renderEntry();
  renderConcepts();
  $("concepts-sec").hidden = false;
  $("studio-sec").hidden = true;
  $("concepts-sec").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- concept option cards (3 options, exactly one recommended) ----------
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
  if (state.sample) mount.append(el("span", "srcchip sample", "sample"));
  else if (state.source === "brand") mount.append(el("span", "srcchip", "your lent brand"));
}

function renderConcepts() {
  renderBrandline();
  const mount = $("cards");
  mount.textContent = "";
  state.concepts.forEach((c, i) => {
    const card = el("button", "card" + (i === state.picked ? " picked" : ""));
    card.type = "button";
    const top = el("div", "cardtop");
    top.append(el("span", "anglechip", c.angle));
    if (c.recommended) top.append(el("span", "recflag", "RECOMMENDED"));
    const prev = el("div", "copyprev");
    const flat = c.primaryText.replace(/\s+/g, " ").trim();
    prev.textContent = flat.slice(0, 150) + (flat.length > 150 ? "…" : "");
    const foot = el("div", "cardfoot");
    foot.append(el("span", "fh", c.headline), el("span", "fc", c.cta + " →"));
    card.append(
      top,
      el("div", "hook", c.hook),
      prev,
      foot,
      el("div", "picktag", i === state.picked ? "SELECTED" : "PICK THIS CONCEPT"),
    );
    card.addEventListener("click", () => pick(i));
    mount.append(card);
  });
}

function pick(i) {
  state.picked = i;
  state.images = {}; // new concept → new creative
  save();
  renderConcepts();
  renderStudio();
  $("studio-sec").scrollIntoView({ behavior: "smooth", block: "start" });
  // One-go: picking the concept IS the decision — casting the creative starts immediately
  // (the per-action Higgsfield consent is still the user's brake pedal). Not on sample browsing.
  if (relay && !state.sample && !casting) void castRun(state.aspect);
}

// ---------- 03 · the ad (pixel-faithful Meta feed preview — brand palette lives IN the canvas) ----------
function sampleCreative(aspect) {
  const b = state.brand || {};
  const cols = Array.isArray(b.colors) && b.colors.length >= 2 ? b.colors : ["#212A2F", "#9BC0B2"];
  const w = 800, h = aspect === "4:5" ? 1000 : 800;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${cols[0]}'/><stop offset='1' stop-color='${cols[1]}'/></linearGradient></defs>` +
    `<rect width='${w}' height='${h}' fill='url(#g)'/>` +
    `<text x='${w / 2}' y='${h / 2 - 14}' text-anchor='middle' font-family='sans-serif' font-size='54' font-weight='700' fill='rgba(255,255,255,.95)'>${escXml(b.name || "Sample")}</text>` +
    `<text x='${w / 2}' y='${h / 2 + 36}' text-anchor='middle' font-family='monospace' font-size='22' letter-spacing='6' fill='rgba(255,255,255,.75)'>SAMPLE CREATIVE</text>` +
    `<text x='${w / 2}' y='${h - 46}' text-anchor='middle' font-family='monospace' font-size='18' fill='rgba(255,255,255,.6)'>connect Switchboard to render the real one</text>` +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function adDomain() {
  if (state.source === "brand") {
    const slug = ((state.brand?.name || "brand").toLowerCase().replace(/[^a-z0-9]/g, "") || "brand");
    return (slug + ".com").toUpperCase();
  }
  return domainOf(state.url);
}

function renderStudio() {
  const c = cur();
  $("studio-sec").hidden = !c;
  if (!c) { reflect(); return; }
  const b = state.brand || {};
  $("picked-name").textContent = c.name + " · " + c.angle + (c.recommended ? " · recommended" : "");
  $("m-name").textContent = b.name || "Brand";
  const av = $("m-avatar");
  av.textContent = ((b.name || "B").trim()[0] || "B").toUpperCase();
  const c0 = (b.colors && b.colors[0]) || "#212A2F";
  av.style.background = c0;
  av.style.color = lum(c0) > 0.6 ? "#111" : "#fff";
  $("m-primary").textContent = c.primaryText;
  $("m-domain").textContent = adDomain();
  $("m-headline").textContent = c.headline;
  $("m-desc").textContent = c.description;
  $("m-cta").textContent = c.cta;
  $("asp-11").classList.toggle("on", state.aspect === "1:1");
  $("asp-45").classList.toggle("on", state.aspect === "4:5");
  $("m-imgbox").style.aspectRatio = state.aspect === "4:5" ? "4 / 5" : "1 / 1";
  const img = $("m-img"), hint = $("m-imghint");
  const real = state.images[state.aspect];
  if (real) {
    img.src = real; img.hidden = false; hint.hidden = true;
  } else if (state.sample) {
    img.src = sampleCreative(state.aspect); img.hidden = false; hint.hidden = true;
  } else {
    img.hidden = true; img.removeAttribute("src");
    hint.hidden = false;
    hint.textContent = relay ? "no creative yet — hit Cast the creative" : "connect Switchboard to cast the creative";
  }
  $("bench-note").textContent = state.sample && !real
    ? "Sample mode: the tile is a stand-in. Connect and cast to render the real creative on your Claude."
    : "Creatives render per aspect — flip the toggle and AdForge re-fires at the new ratio.";
  reflect();
}

// ---------- image casting (agentic Higgsfield loop, gen.js pattern — brand woven in) ----------
function setCastLine(t) { $("cast-line").textContent = t; }
function castLineFor(name) {
  if (name === "WebFetch") return "reading the site…";
  if (name.endsWith("generate_image")) return "rendering the creative (approve if asked)…";
  if (name.includes("media_")) return "handling media…";
  return "tool → " + name;
}

async function castRun(aspect) {
  if (!relay || casting || forging || state.picked < 0) return;
  const c = cur();
  const b = state.brand || {};
  casting = true;
  reflect();
  hideError();
  $("cast-status").hidden = false;
  setCastLine("warming up…");
  logLine('rendering "' + c.name + '" at ' + aspect + "…");
  try {
    const palette = (b.colors || []).join(", ");
    const brandBits = [
      `Brand palette: ${palette || "natural, muted"}.`,
      `Brand tone: ${b.tone || "clean and confident"}.`,
      b.audience ? `Shot to stop the scroll of: ${b.audience}.` : "",
    ].filter(Boolean).join(" ");
    const instruction =
      `Use the Higgsfield generate_image tool with model "nano_banana_pro" to generate ONE advertising image.\n` +
      `Prompt: "${c.imagePrompt}. ${brandBits} Premium Meta feed ad photography — no text, no lettering, no logos, no watermarks."\n` +
      `aspect_ratio "${aspect}". Poll until the generation is complete, then reply with ONLY the final image URL on its own line.`;
    let url = null, acc = "";
    for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
      if (d.type === "tool_proposed") {
        setCastLine(castLineFor(d.call.name));
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
    if (!url) throw new Error("No image came back — hit Retry or Recast; the second pass usually lands.");
    state.images[aspect] = url;
    save();
    logLine("creative rendered at " + aspect + ".", "good");
  } catch (err) {
    const msg = String(err?.message || err);
    logLine("cast failed: " + msg, "bad");
    showError(msg, () => castRun(aspect));
  } finally {
    casting = false;
    $("cast-status").hidden = true;
    renderStudio();
  }
}

$("cast").addEventListener("click", () => castRun(state.aspect));
$("recast").addEventListener("click", () => {
  delete state.images[state.aspect];
  save();
  renderStudio();
  castRun(state.aspect);
});

function setAspect(a) {
  if (state.aspect === a) return;
  state.aspect = a;
  save();
  renderStudio();
  // Aspect flip regenerates when there's no render for this ratio yet — real casts only.
  if (!state.images[a] && !state.sample && relay && state.picked >= 0) castRun(a);
}
$("asp-11").addEventListener("click", () => setAspect("1:1"));
$("asp-45").addEventListener("click", () => setAspect("4:5"));

// Broken image URL (expired CDN link etc.) → visible hint, not a grey mystery box.
$("m-img").addEventListener("error", () => {
  if ($("m-img").hidden || !$("m-img").getAttribute("src")) return;
  $("m-img").hidden = true;
  $("m-imghint").hidden = false;
  $("m-imghint").textContent = "the creative failed to load — hit Recast image";
});

// ---------- copy-to-clipboard per field ----------
async function copyText(btn, text) {
  const ok = () => {
    const was = btn.textContent;
    btn.textContent = "copied";
    btn.classList.add("did");
    setTimeout(() => { btn.textContent = was; btn.classList.remove("did"); }, 1200);
  };
  try { await navigator.clipboard.writeText(text); ok(); }
  catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      ok();
    } catch { showError("Clipboard is blocked here — select the text in the preview and copy manually.", null); }
  }
}
$("copy-primary").addEventListener("click", () => { const c = cur(); if (c) copyText($("copy-primary"), c.primaryText); });
$("copy-headline").addEventListener("click", () => { const c = cur(); if (c) copyText($("copy-headline"), c.headline); });
$("copy-desc").addEventListener("click", () => { const c = cur(); if (c) copyText($("copy-desc"), c.description); });

// ---------- boot: restore whatever was on the bench last time ----------
if (state.concepts.length) {
  renderConcepts();
  $("concepts-sec").hidden = false;
  renderStudio();
}
renderEntry();
reflect();
