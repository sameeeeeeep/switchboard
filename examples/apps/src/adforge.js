// AdForge — "URL in, Meta ads out". The visitor's OWN Claude reads the founder's site (WebFetch),
// drafts 3 ad concepts as strict JSON, then casts the chosen one into a pixel-faithful Meta feed
// ad with a Higgsfield-generated hero image. The app integrates nothing — it borrows the visitor's
// model and connectors through Switchboard.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const STORE_KEY = "adforge:state";

const ANGLES = ["UGC hook", "Problem → agitate → solve", "Founder story", "Offer-led urgency"];
const CTAS = ["Shop Now", "Learn More", "Get Offer", "Sign Up"];
const SITES = [
  { label: "Allbirds", url: "https://www.allbirds.com" },
  { label: "Liquid Death", url: "https://liquiddeath.com" },
  { label: "Notion", url: "https://www.notion.com" },
  { label: "Ritual", url: "https://ritual.com" },
  { label: "Warby Parker", url: "https://www.warbyparker.com" },
];
// Same harvest regex family as cast/gen.js — image URLs come back either as bare links or JSON fields.
const URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;

let relay = null;
let notInstalled = false;
let forging = false;
let casting = false;
let lastAction = null; // what "Retry" re-runs

let state = {
  url: "https://www.allbirds.com",
  angles: ["UGC hook"],
  brand: null,
  concepts: [],
  picked: -1,
  aspect: "1:1",
  images: {},          // real generated URLs, keyed "1:1" / "4:5" — reset on new pick
  sample: false,
  siteCache: null,     // WebFetch result text, so "Regenerate copy" skips the re-read
  siteCacheUrl: null,
};

// ---------- embedded sample (explorable before connecting; zero tokens burned) ----------
const SAMPLE = {
  url: "https://www.allbirds.com",
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
      url: state.url, angles: state.angles, brand: state.brand, concepts: state.concepts,
      picked: state.picked, aspect: state.aspect, images: state.images, sample: state.sample,
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
  if (typeof state.url !== "string" || !state.url) state.url = "https://www.allbirds.com";
  if (!Array.isArray(state.angles)) state.angles = [];
  state.angles = state.angles.filter((a) => ANGLES.includes(a));
  if (!Array.isArray(state.concepts)) state.concepts = [];
  if (!state.images || typeof state.images !== "object") state.images = {};
  if (state.aspect !== "4:5") state.aspect = "1:1";
  if (!(Number.isInteger(state.picked) && state.picked >= 0 && state.picked < state.concepts.length)) state.picked = -1;
}
load();

// ---------- small utils ----------
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

// ---------- forge log / errors (every failure is a visible line, never console-only) ----------
function logLine(text, cls) {
  $("forgelog").hidden = false;
  const d = document.createElement("div");
  d.className = "logline" + (cls ? " " + cls : "");
  d.textContent = text;
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
    reason: "read your site and forge Meta ads",
    tools: ["WebFetch", "mcp__claude_ai_Higgsfield__*"],
    models: ["sonnet"],
  },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; reflect(); },
  onDisconnect: () => { relay = null; reflect(); },
});
// Fast probe so a returning user's grant enables the buttons without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) relay = r;
  } else {
    notInstalled = true;
  }
  reflect();
})();

function reflect() {
  const busy = forging || casting;
  const on = !!relay;
  $("forge").disabled = !on || busy;
  $("forge").textContent = forging ? "FORGING…" : "FORGE CONCEPTS";
  $("regen-copy").disabled = !on || busy;
  $("cast").disabled = !on || busy || state.picked < 0;
  $("recast").disabled = !on || busy || state.picked < 0;
  // Aspect flip auto-recasts, and a flip mid-run would land the in-flight cast on a hidden
  // aspect — so the toggle locks while the forge or kiln is running, like the other buttons.
  $("asp-11").disabled = busy;
  $("asp-45").disabled = busy;
  $("cast").hidden = !!state.images[state.aspect];
  const hint = $("conn-hint");
  hint.textContent = "";
  if (on) {
    hint.textContent = "runs on your Claude — the site read and every render are yours";
  } else if (notInstalled) {
    hint.append("Switchboard isn't installed — ");
    const a = document.createElement("a");
    a.href = INSTALL_URL; a.target = "_blank"; a.rel = "noreferrer"; a.textContent = "get it here";
    hint.append(a, " to fire the forge.");
  } else {
    hint.textContent = "connect Switchboard (top right) to fire the forge — the form and sample work now";
  }
}

// ---------- furnace form ----------
$("f-url").value = state.url;
$("f-url").addEventListener("input", () => { state.url = $("f-url").value.trim(); save(); markUrlChips(); });
$("f-url").addEventListener("keydown", (e) => { if (e.key === "Enter") $("forge").click(); });

SITES.forEach((s) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = s.label;
  b.dataset.url = s.url;
  b.addEventListener("click", () => {
    $("f-url").value = s.url;
    state.url = s.url; save(); markUrlChips();
  });
  $("url-chips").append(b);
});
function markUrlChips() {
  $("url-chips").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.url === state.url));
}
markUrlChips();

ANGLES.forEach((a) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = a;
  if (state.angles.includes(a)) b.classList.add("on");
  b.addEventListener("click", () => {
    const i = state.angles.indexOf(a);
    if (i === -1) state.angles.push(a); else state.angles.splice(i, 1);
    b.classList.toggle("on", i === -1);
    save();
  });
  $("angle-chips").append(b);
});

// ---------- step 2: forge concepts (ONE streamed agentic turn) ----------
function buildForgePrompt(url, cachedText, priorNames) {
  const steer = state.angles.length
    ? `Steer the concepts with these angle(s): ${state.angles.join("; ")}. Use every selected angle at least once across the 3 concepts (distinct executions if an angle repeats), and set each concept's "angle" to the steer it follows.`
    : `Pick the 3 strongest angles from: ${ANGLES.join("; ")} — a different one per concept, and set each concept's "angle" accordingly.`;
  const read = cachedText
    ? `Here is the page content, already fetched — do NOT call WebFetch:\n"""\n${cachedText}\n"""`
    : `First use WebFetch to read ${url} — one fetch of that page is enough.`;
  const fresh = priorNames && priorNames.length
    ? `These concept names were already used — produce three NEW concepts with different hooks and names: ${priorNames.join(", ")}.`
    : "";
  return [
    "You are AdForge, a direct-response creative director who writes Meta (Facebook/Instagram) feed ads that stop thumbs.",
    `Target website: ${url}`,
    read,
    "Then respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    '{"brand":{"name":string,"product":string (one line, what they sell),"tone":string,"colors":[2-4 hex color strings pulled from the site]},',
    '"concepts":[exactly 3 items, each {"name":string (2-4 word concept name),"angle":string,"hook":string (the scroll-stopping first line),"primaryText":string (Meta primary text, at most 125 words, short paragraphs separated by \\n\\n, the hook as its first line),"headline":string (max 40 characters),"description":string (max 30 characters),"cta":"Shop Now"|"Learn More"|"Get Offer"|"Sign Up","imagePrompt":string (vivid art-direction prompt for the ad hero image — no text, no logos in the image),"recommended":boolean}]}',
    steer,
    'Exactly ONE concept must have "recommended": true — the one you would run first.',
    fresh,
  ].filter(Boolean).join("\n");
}

function parseForge(raw) {
  try {
    const cleaned = String(raw).replace(/```(?:json)?/gi, "");
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    const b = data.brand || {};
    let list = Array.isArray(data.concepts) ? data.concepts : [];
    if (list.length < 3) return null;
    list = list.slice(0, 3).map((c) => ({
      name: str(c.name, "Untitled casting"),
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
    return {
      brand: {
        name: str(b.name, "The brand"),
        product: str(b.product, ""),
        tone: str(b.tone, ""),
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
  const url = $("f-url").value.trim();
  if (!url) { showError("Give the forge a site URL first.", null); return; }
  state.url = url;
  const cached = !!(opts.useCache && state.siteCache && state.siteCacheUrl === url);
  const priorNames = opts.avoidRepeats ? state.concepts.map((c) => c.name) : null;
  forging = true;
  reflect();
  hideError();
  clearLog();
  logLine(cached ? "using the banked site read — no re-fetch needed…" : "opening the furnace door…");
  const liveLine = logLine("drafting concepts… 0.0 kb", "live");
  let acc = "";
  try {
    const prompt = buildForgePrompt(url, cached ? state.siteCache : null, priorNames);
    for await (const d of relay.stream({ prompt, agentic: true })) {
      if (d.type === "tool_proposed") {
        if (d.call.name === "WebFetch") logLine("reading the site…");
        else logLine("tool → " + d.call.name);
      } else if (d.type === "tool_result") {
        if (d.call.name === "WebFetch" && d.result?.ok) {
          const t = resultText(d);
          if (t) {
            state.siteCache = t.slice(0, 12000);
            state.siteCacheUrl = url;
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
    const parsed = parseForge(acc);
    if (!parsed) throw new Error("The forge returned malformed concepts — hit Retry; it usually casts clean on the second pour.");
    state.brand = parsed.brand;
    state.concepts = parsed.concepts;
    state.picked = -1;
    state.images = {};
    state.sample = false;
    save();
    liveLine.textContent = "drafting concepts… done";
    logLine("three castings pulled from the fire — pick one below.", "good");
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

$("forge").addEventListener("click", () => forgeRun({}));
$("regen-copy").addEventListener("click", () => forgeRun({ useCache: true, avoidRepeats: true }));

// ---------- sample forge (one click, zero tokens) ----------
$("sample").addEventListener("click", () => {
  const s = JSON.parse(JSON.stringify(SAMPLE));
  state.url = s.url;
  $("f-url").value = s.url;
  markUrlChips();
  state.brand = s.brand;
  state.concepts = s.concepts;
  state.picked = -1;
  state.images = {};
  state.sample = true;
  save();
  hideError();
  clearLog();
  logLine("sample forge loaded from the archive — no tokens burned.", "good");
  logLine("pick a casting below; connect Switchboard to cast a real creative.");
  renderConcepts();
  $("concepts-sec").hidden = false;
  $("studio-sec").hidden = true;
  $("concepts-sec").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- step 3: concept option cards ----------
function renderBrandline() {
  const b = state.brand;
  const mount = $("brandline");
  mount.textContent = "";
  if (!b) return;
  const name = document.createElement("b");
  name.textContent = b.name;
  mount.append(name, document.createTextNode(" · " + [b.product, b.tone].filter(Boolean).join(" · ") + " "));
  (b.colors || []).forEach((c) => {
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = c;
    sw.title = c;
    mount.append(sw);
  });
  if (state.sample) mount.append(document.createTextNode(" · SAMPLE"));
}

function renderConcepts() {
  renderBrandline();
  const mount = $("cards");
  mount.textContent = "";
  state.concepts.forEach((c, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card" + (i === state.picked ? " picked" : "");
    const top = document.createElement("div");
    top.className = "cardtop";
    const angle = document.createElement("span");
    angle.className = "anglechip";
    angle.textContent = c.angle;
    top.append(angle);
    if (c.recommended) {
      const rec = document.createElement("span");
      rec.className = "recflag";
      rec.textContent = "RECOMMENDED";
      top.append(rec);
    }
    const hook = document.createElement("div");
    hook.className = "hook";
    hook.textContent = c.hook;
    const prev = document.createElement("div");
    prev.className = "copyprev";
    const flat = c.primaryText.replace(/\s+/g, " ").trim();
    prev.textContent = flat.slice(0, 150) + (flat.length > 150 ? "…" : "");
    const foot = document.createElement("div");
    foot.className = "cardfoot";
    const fh = document.createElement("span");
    fh.className = "fh";
    fh.textContent = c.headline;
    const fc = document.createElement("span");
    fc.className = "fc";
    fc.textContent = c.cta + " →";
    foot.append(fh, fc);
    const tag = document.createElement("div");
    tag.className = "picktag";
    tag.textContent = i === state.picked ? "ON THE ANVIL" : "PICK THIS CASTING";
    card.append(top, hook, prev, foot, tag);
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
}

// ---------- step 4: the casting floor (Meta feed preview) ----------
function sampleCreative(aspect) {
  const b = state.brand || {};
  const cols = Array.isArray(b.colors) && b.colors.length >= 2 ? b.colors : ["#212A2F", "#9BC0B2"];
  const w = 800, h = aspect === "4:5" ? 1000 : 800;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${cols[0]}'/><stop offset='1' stop-color='${cols[1]}'/></linearGradient></defs>` +
    `<rect width='${w}' height='${h}' fill='url(#g)'/>` +
    `<text x='${w / 2}' y='${h / 2 - 14}' text-anchor='middle' font-family='Archivo, sans-serif' font-size='54' font-weight='700' fill='rgba(255,255,255,.95)'>${escXml(b.name || "Sample")}</text>` +
    `<text x='${w / 2}' y='${h / 2 + 36}' text-anchor='middle' font-family='monospace' font-size='22' letter-spacing='6' fill='rgba(255,255,255,.75)'>SAMPLE CREATIVE</text>` +
    `<text x='${w / 2}' y='${h - 46}' text-anchor='middle' font-family='monospace' font-size='18' fill='rgba(255,255,255,.6)'>connect Switchboard to cast the real one</text>` +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
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
  const c0 = (b.colors && b.colors[0]) || "#FF6A1A";
  av.style.background = c0;
  av.style.color = lum(c0) > 0.6 ? "#111" : "#fff";
  $("m-primary").textContent = c.primaryText;
  $("m-domain").textContent = domainOf(state.url);
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
    hint.textContent = relay ? "no creative cast yet — hit CAST THE CREATIVE" : "connect Switchboard to cast the creative";
  }
  $("bench-note").textContent = state.sample && !real
    ? "Sample mode: the tile below is a stand-in. Connect and cast to render the real creative on your Claude."
    : "Creatives are cast per aspect — flip the toggle and AdForge re-fires the kiln at the new ratio.";
  reflect();
}

// ---------- image casting (agentic Higgsfield loop, gen.js pattern) ----------
function setCastLine(t) { $("cast-line").textContent = t; }
function castLineFor(name) {
  if (name === "WebFetch") return "reading the site…";
  if (name.endsWith("generate_image")) return "pouring the cast — image generating (approve if asked)…";
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
  setCastLine("stoking the furnace…");
  logLine('kiln lit for "' + c.name + '" at ' + aspect + "…");
  try {
    const palette = (b.colors || []).join(", ");
    const instruction =
      `Use the Higgsfield generate_image tool with model "nano_banana_pro" to generate ONE advertising image.\n` +
      `Prompt: "${c.imagePrompt}. Brand palette: ${palette || "natural, muted"}. Brand tone: ${b.tone || "clean and confident"}. Premium Meta feed ad photography — no text, no lettering, no logos, no watermarks."\n` +
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
    if (!url) throw new Error("No image came back from the kiln — hit Retry or Recast; the second pour usually lands.");
    state.images[aspect] = url;
    save();
    logLine("creative cast at " + aspect + ".", "good");
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
  // Aspect flip regenerates when there's no cast for this ratio yet (spec) — real casts only.
  if (!state.images[a] && !state.sample && relay && state.picked >= 0) castRun(a);
}
$("asp-11").addEventListener("click", () => setAspect("1:1"));
$("asp-45").addEventListener("click", () => setAspect("4:5"));

// Broken image URL (expired CDN link etc.) → visible hint, not a grey mystery box.
$("m-img").addEventListener("error", () => {
  if ($("m-img").hidden || !$("m-img").getAttribute("src")) return;
  $("m-img").hidden = true;
  $("m-imghint").hidden = false;
  $("m-imghint").textContent = "the cast cracked (image failed to load) — hit Recast image";
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

// ---------- boot: restore whatever was on the anvil last time ----------
if (state.concepts.length) {
  renderConcepts();
  $("concepts-sec").hidden = false;
  renderStudio();
}
reflect();
