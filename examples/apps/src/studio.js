// Studio — product shots without the studio, context-first. Connect Switchboard and Studio reads
// the brand the user lent it: every product on that brand becomes a one-click shoot with NO photo
// and NO typing — the prompt carries the product name, the brand's palette as set accents, and
// voice-matched art direction. A photo is the demoted secondary path (it keeps the proven
// media_upload → put_blob → media_confirm reference dance). Zero keys, zero backend; 1 frame = 1 consent.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const SHEET_KEY = "studio:sheet";
const PRODUCT_KEY = "studio:product";
const SETUP_KEY = "studio:setup";

let relay = null;
let installed = null;    // null = probing, false = extension missing, true = present
let shooting = false;
let stopFlag = false;
let brand = null;        // the normalized lent brand context, or null
let product = null;      // { kind: "brand"|"text"|"photo", name, dataUrl?, sample? }
let lastShot = null;     // { scene, aspect } — powers the Retry button
let photoZoneOpen = false; // brand mode: the demoted "shoot from a photo" drop is behind a toggle
let sceneChosen = false;   // true once the user (now or in a past session) picked a scene themselves

// ---------- scenes: option chips; OUR PICK derives from the brand's voice/positioning ----------
const SCENES = [
  { prompt: "on a marble counter, soft morning window light",
    cues: ["minimal", "clean", "premium", "luxur", "calm", "quiet", "serene", "spa", "refined"] },
  { prompt: "held in hand on a city street, shallow depth of field",
    cues: ["street", "urban", "everyday", "candid", "real", "gen z", "genz", "youth", "movement"] },
  { prompt: "floating on a seamless pastel gradient, hard shadow",
    cues: ["bold", "playful", "maximal", "vibrant", "pop", "fun", "loud", "color", "unapologetic"] },
  { prompt: "on a picnic table, golden hour, linen + fruit",
    cues: ["warm", "cozy", "home", "natural", "organic", "earth", "craft", "comfort", "desi"] },
  { prompt: "editorial flat-lay, magazine style, top-down",
    cues: ["editorial", "magazine", "fashion", "curated", "design", "sophisticat", "studio"] },
];
const ASPECTS = ["1:1", "4:5", "9:16", "16:9"];
// scene: index into SCENES, -1 = free-text only. chosen persists whether the USER picked the
// scene — the brand auto-pick also saves the setup, so mere existence can't signal intent.
const setup = { scene: 0, steer: "", aspect: "1:1", chosen: false };
let recScene = 0; // brand-derived recommended index (0 until a brand says otherwise)

function deriveRecScene() {
  if (!brand) return 0;
  const hay = `${brand.voice} ${brand.positioning} ${brand.audience}`.toLowerCase();
  let best = 0, bestScore = 0;
  SCENES.forEach((s, i) => {
    const score = s.cues.reduce((n, c) => n + (hay.includes(c) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

// ---------- persistence ----------
const loadJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const saveJson = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota — skip */ } };
const loadSheet = () => loadJson(SHEET_KEY, []);
const saveSheet = (s) => saveJson(SHEET_KEY, s.slice(0, 48));
const saveSetup = () => saveJson(SETUP_KEY, setup);

// ---------- the embedded SAMPLE product (amber dropper bottle, "GLOW") ----------
// Pre-context only, always labeled sample; real lent context replaces it the moment it exists.
const SAMPLE_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='800' viewBox='0 0 640 800'>` +
  `<defs>` +
  `<linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#F6F1E7'/><stop offset='1' stop-color='#E9E0CE'/></linearGradient>` +
  `<linearGradient id='glass' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#8A4A10'/><stop offset='.2' stop-color='#C97F2C'/><stop offset='.46' stop-color='#EBAC50'/><stop offset='.64' stop-color='#C47A28'/><stop offset='1' stop-color='#7C3F0C'/></linearGradient>` +
  `<linearGradient id='cap' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#14100D'/><stop offset='.5' stop-color='#3D342C'/><stop offset='1' stop-color='#0D0A08'/></linearGradient>` +
  `</defs>` +
  `<rect width='640' height='800' fill='url(#bg)'/>` +
  `<ellipse cx='320' cy='722' rx='152' ry='24' fill='#D8CBB2'/>` +
  `<rect x='297' y='112' width='46' height='58' rx='22' fill='#1D1814'/>` +
  `<rect x='283' y='164' width='74' height='56' rx='7' fill='url(#cap)'/>` +
  `<rect x='299' y='220' width='42' height='20' fill='#9C5A18'/>` +
  `<rect x='230' y='238' width='180' height='472' rx='34' fill='url(#glass)'/>` +
  `<rect x='314' y='240' width='12' height='372' rx='6' fill='rgba(255,244,224,.28)'/>` +
  `<path d='M314 612 L326 612 L320 646 Z' fill='rgba(255,244,224,.3)'/>` +
  `<rect x='250' y='262' width='18' height='420' rx='9' fill='rgba(255,255,255,.32)'/>` +
  `<rect x='252' y='382' width='136' height='192' rx='10' fill='#FBF7EE' stroke='#E2D6BD' stroke-width='2'/>` +
  `<text x='320' y='424' font-family='Georgia, serif' font-size='16' letter-spacing='4' fill='#8A7F6C' text-anchor='middle'>No. 04</text>` +
  `<rect x='296' y='438' width='48' height='3' fill='#DE3D0A'/>` +
  `<text x='320' y='494' font-family='Georgia, serif' font-size='44' font-weight='bold' letter-spacing='7' fill='#26221B' text-anchor='middle'>GLOW</text>` +
  `<text x='320' y='530' font-family='Georgia, serif' font-style='italic' font-size='15' fill='#6F675A' text-anchor='middle'>facial oil</text>` +
  `<text x='320' y='556' font-family='Georgia, serif' font-size='13' letter-spacing='2' fill='#8A7F6C' text-anchor='middle'>30 ml</text>` +
  `</svg>`;
const SAMPLE_DATA_URL = "data:image/svg+xml;utf8," + encodeURIComponent(SAMPLE_SVG);

// ---------- utils ----------
const resultText = (d) => (d.result?.content ?? []).map((c) => c.text ?? "").join("");
const URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
function extractUrl(t) { const m = (t || "").match(URL_RE); return m ? (m[1] || m[2] || m[0]) : null; }
async function downscale(dataUrl, max = 1024) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/png");
  } catch { return dataUrl; }
}

// ---------- the standard connect chip ----------
mountConnect($("chip-dock"), {
  scope: {
    reason: "shoot product photos on your Higgsfield",
    // Whole-connector wildcard (the gate supports trailing-*): the shoot is a multi-tool dance —
    // media_upload → media_confirm → generate_image → poll — so a single-tool grant would deny
    // step 1 every time. Matches imagegen.js/persona.js. (relay put_blob is auto-approved daemon-side.)
    tools: ["mcp__claude_ai_Higgsfield__*"],
    models: ["sonnet"],
  },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; reflect(); loadBrand(); },
  // The chip's own "Switch ▸" menu lends a different brand — re-derive everything from it,
  // or the chip and the app silently desync (chip shows the new brand, brief keeps the old one).
  onProjectChange: (p) => { if (p) applyBrand(p); },
  onDisconnect: () => {
    relay = null;
    // The lent context left with the grant — a brand-kind product survives as a plain typed line.
    brand = null; recScene = 0; photoZoneOpen = false;
    if (product?.kind === "brand") { product = { kind: "text", name: product.name }; saveJson(PRODUCT_KEY, product); $("line").value = product.name; }
    renderProductViews(); renderChips(); updateBrief(); reflect();
  },
});
// Fast probe so a returning user's grant enables Shoot — and re-reads the lent brand — without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  installed = !!(r && "connect" in r);
  if (installed) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { relay = r; await loadBrand(); }
  }
  reflect();
})();

// ---------- the lent brand (LAW 1: read it, derive everything from it) ----------
// Defensive normalization — the context contract is convention, not schema (docs/CONTEXT-KINDS.md).
function normalizeBrand(ctx) {
  const d = (ctx && ctx.data) || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  const products = arr(d.products).length ? arr(d.products) : arr(d.range);
  return {
    name: String(ctx.name || d.name || "Brand"),
    voice: String(d.voice || d.vibe || d.positioning || "").trim(),
    positioning: String(d.positioning || "").trim(),
    audience: String(d.audience || "").trim(),
    palette: arr(d.palette), // FLAT color strings by contract
    products,
  };
}

async function loadBrand() {
  if (!relay?.context?.active) { renderBrand(); return; }
  try {
    const ctx = await relay.context.active();
    if (ctx) applyBrand(ctx);
    else renderBrand();
  } catch { renderBrand(); }
}

async function pickBrand() {
  if (!relay?.context?.pick) { logLine("this Switchboard build has no context picker.", "bad"); return; }
  try {
    const ctx = await relay.context.pick(); // opens the side-panel picker; selecting one lends it here
    if (ctx) { applyBrand(ctx); logLine(`brand lent — shooting for ${brand.name} now.`, "good"); }
  } catch { logLine("brand pick didn't complete.", "bad"); }
}
$("brand-switch").addEventListener("click", pickBrand);
$("brand-pick").addEventListener("click", pickBrand);

function applyBrand(ctx) {
  brand = normalizeBrand(ctx);
  recScene = deriveRecScene();
  // Sample data dies the moment real context exists — in memory AND in localStorage,
  // or the labeled sample resurrects on the next load before the context re-read kills it.
  if (product?.sample) setProduct(null);
  // If the user never chose a scene themselves, follow the brand's pick.
  if (!sceneChosen) { setup.scene = recScene; saveSetup(); }
  // Context-first: a lent brand makes the app instantly shootable — select one of its products
  // (a real uploaded photo stays; a typed line or a stale brand pick is superseded by the context).
  if (brand.products.length && (!product || product.kind !== "photo")) {
    const saved = loadJson(PRODUCT_KEY, null);
    const want = (product?.kind === "brand" && product.name) || (saved?.kind === "brand" && saved.name) || null;
    const name = want && brand.products.includes(want) ? want : brand.products[0];
    product = { kind: "brand", name };
    saveJson(PRODUCT_KEY, product);
  }
  photoZoneOpen = false;
  renderBrand(); renderProductViews(); renderChips(); updateBrief(); reflect();
}

function renderBrand() {
  const bar = $("brandbar");
  if (!relay) { bar.hidden = true; return; }
  bar.hidden = false;
  $("brand-on").hidden = !brand;
  $("brand-off").hidden = !!brand;
  if (!brand) return;
  $("brand-name").textContent = brand.name;
  const sw = $("brand-swatches"); sw.textContent = "";
  for (const c of brand.palette.slice(0, 5)) { const s = document.createElement("span"); s.className = "sw"; s.style.background = c; sw.append(s); }
  $("brand-voice").textContent = brand.voice ? `“${brand.voice}”` : "";
}

// ---------- 01 · the product ----------
function setProduct(p, { persist = true } = {}) {
  product = p;
  if (persist) {
    if (p) saveJson(PRODUCT_KEY, p); // best-effort; big photos may not fit — saveJson swallows quota errors
    else { try { localStorage.removeItem(PRODUCT_KEY); } catch { /* ignore */ } }
  }
  if (p?.kind === "photo") photoZoneOpen = false;
  renderProductViews(); updateBrief(); reflect();
}

const PROD_NOTE = "every chip shoots straight from the brand — no photo, no typing. voice + palette ride along in the prompt.";

function renderProductViews() {
  const isPhoto = product?.kind === "photo";
  const brandHasProducts = !!(brand && brand.products.length);
  $("brand-products").hidden = !brandHasProducts;
  // The single free input owns the panel when no brand products exist (and no photo is set).
  $("free-product").hidden = brandHasProducts || isPhoto;
  $("photo-toggle").hidden = !brandHasProducts || isPhoto;
  $("photo-toggle").textContent = photoZoneOpen ? "never mind — shoot from the brand" : "shoot from a photo instead";
  $("drop").hidden = isPhoto || (brandHasProducts && !photoZoneOpen) || (!brandHasProducts); // free mode: the whole card is the drop target
  $("prod-preview").hidden = !isPhoto;
  if (isPhoto) {
    $("prod-img").src = product.dataUrl;
    $("prod-name").textContent = product.name;
    $("sample-tag").hidden = !product.sample;
  }
  // Set in BOTH directions — a one-way wipe would leave the note blank after switching from a
  // product-less brand to one with products.
  $("prod-note").textContent = brand && !brand.products.length ? "" : PROD_NOTE;
  renderProducts();
}

function renderProducts() {
  const mount = $("products");
  mount.textContent = "";
  if (!brand) return;
  brand.products.forEach((name) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pchip" + (product?.kind === "brand" && product.name === name ? " on" : "");
    b.textContent = name;
    b.title = `shoot ${name} straight from ${brand.name} — no photo needed`;
    b.addEventListener("click", () => { photoZoneOpen = false; setProduct({ kind: "brand", name }); });
    mount.append(b);
  });
}

async function acceptFile(file) {
  if (!file || !/^image\//.test(file.type)) { logLine("that file isn't an image — PNG, JPG or WebP please.", "bad"); return; }
  const raw = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const dataUrl = await downscale(raw);
  setProduct({ kind: "photo", dataUrl, name: file.name.slice(0, 40) || "product.png", sample: false });
}

$("file").addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); e.target.value = ""; });
$("drop").addEventListener("click", () => $("file").click());
$("drop").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
$("browse-btn").addEventListener("click", () => $("file").click());
$("photo-toggle").addEventListener("click", () => { photoZoneOpen = !photoZoneOpen; renderProductViews(); });
// The whole product panel is a drop target in every mode — photos are always accepted, just demoted.
const panel = $("prod-panel");
panel.addEventListener("dragover", (e) => { e.preventDefault(); panel.classList.add("over"); $("drop").classList.add("over"); });
panel.addEventListener("dragleave", () => { panel.classList.remove("over"); $("drop").classList.remove("over"); });
panel.addEventListener("drop", (e) => {
  e.preventDefault(); panel.classList.remove("over"); $("drop").classList.remove("over");
  const f = e.dataTransfer?.files?.[0]; if (f) acceptFile(f);
});
$("prod-replace").addEventListener("click", () => $("file").click());
$("prod-remove").addEventListener("click", () => {
  // Back to the mode's primary input: brand chips when lent, the single line when not.
  if (brand?.products.length) setProduct({ kind: "brand", name: brand.products[0] });
  else { $("line").value = ""; setProduct(null); }
});
$("sample-btn").addEventListener("click", async () => {
  const dataUrl = await downscale(SAMPLE_DATA_URL); // rasterize the SVG to a real PNG dataURL
  setProduct({ kind: "photo", dataUrl, name: "glow — sample bottle", sample: true });
});
// The single line input (pre-context): one line IS the product, no upload required.
$("line").addEventListener("input", () => {
  const v = $("line").value.trim();
  setProduct(v ? { kind: "text", name: v.slice(0, 120) } : null);
});
$("line").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("shoot").disabled) $("shoot").click(); });

// ---------- 02 · the scene ----------
function renderChips() {
  const mount = $("chips");
  mount.textContent = "";
  SCENES.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "scn" + (i === setup.scene ? " on" : "");
    b.textContent = s.prompt;
    if (i === recScene) {
      const tag = document.createElement("span"); tag.className = "pick"; tag.textContent = "our pick"; b.append(tag);
      if (brand) b.title = `picked for ${brand.name}'s voice`;
    }
    b.addEventListener("click", () => {
      setup.scene = setup.scene === i ? -1 : i; // click again to deselect and go pure free-text
      sceneChosen = true; setup.chosen = true;  // the ONLY place user intent is recorded
      renderChips(); saveSetup(); updateBrief();
    });
    mount.append(b);
  });
  $("scene-note").textContent = brand
    ? `our pick reads ${brand.name}'s voice and positioning — the other scenes are one click away.`
    : "our pick is the safe default — lend a brand and it re-derives from the brand's voice.";
}
function renderAspects() {
  const mount = $("aspects");
  mount.textContent = "";
  ASPECTS.forEach((a) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a;
    if (a === setup.aspect) b.classList.add("on");
    b.addEventListener("click", () => {
      setup.aspect = a;
      mount.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      saveSetup(); updateBrief();
    });
    mount.append(b);
  });
}
function currentScene() {
  const parts = [];
  if (setup.scene >= 0 && SCENES[setup.scene]) parts.push(SCENES[setup.scene].prompt);
  const steer = $("steer").value.trim();
  if (steer) parts.push(steer);
  return parts.join(", ") || SCENES[recScene].prompt; // never a blank brief
}
function updateBrief() {
  const b = $("brief");
  b.textContent = "";
  const scene = document.createElement("b");
  scene.textContent = currentScene();
  if (!product) {
    b.append("the brief — pick a product above, then shoot it in: ", scene, ` · ${setup.aspect}`);
  } else if (product.kind === "photo") {
    b.append("the brief — keep this exact product, unchanged label and shape, place it in: ", scene, ` · ${setup.aspect}`);
  } else {
    const pn = document.createElement("b");
    pn.textContent = product.name;
    b.append("the brief — shoot ", pn, brand && product.kind === "brand" ? ` (${brand.name})` : "", " in: ", scene, ` · ${setup.aspect}`);
  }
  if (brand) b.append(` · ${brand.name}'s voice + palette ride along`);
}
$("steer").addEventListener("input", () => { setup.steer = $("steer").value; saveSetup(); updateBrief(); });
$("steer").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("shoot").disabled) $("shoot").click(); });

function reflect() {
  renderBrand();
  $("shoot").disabled = !relay || !product || shooting;
  const hint = $("conn-hint");
  if (shooting) hint.textContent = "shooting…";
  else if (installed === false) hint.innerHTML = `needs the Switchboard extension — <a href="${INSTALL_URL}" target="_blank" rel="noopener">get it here</a>, it's your key that does the work`;
  else if (!relay) hint.innerHTML = "connect Switchboard (top right) — your lent brand sets up the shoot for you";
  else if (!product) hint.textContent = brand?.products.length ? "pick one of the brand's products above" : "type your product in one line, drop a photo, or load the sample";
  else hint.innerHTML = "ready — shoots on <b>your</b> Higgsfield, the operator pays nothing";
}

// ---------- the darkroom log ----------
let lastLogText = "";
function logLine(text, cls) {
  $("shootbox").hidden = false;
  if (text === lastLogText) return;
  lastLogText = text;
  const d = document.createElement("div");
  d.className = "event" + (cls ? " " + cls : "");
  d.textContent = text;
  const ev = $("events");
  ev.append(d);
  while (ev.children.length > 40) ev.firstChild.remove();
  ev.scrollTop = ev.scrollHeight;
}
function setStatus(text) { $("shoot-line").textContent = text; logLine(text); }

// ---------- 03 · the shoot ----------
// The lent brand is woven INTO the generation prompt: voice, audience and palette sharpen the set.
// Palette lands inside the frame (props/backdrop) — never on the product, never on the app chrome.
function brandDirection() {
  if (!brand) return "";
  const bits = [];
  if (brand.voice) bits.push(`brand voice: ${brand.voice}`);
  if (brand.audience) bits.push(`shot to appeal to: ${brand.audience}`);
  if (brand.palette.length) bits.push(`accent the set styling, props and backdrop with the brand palette (${brand.palette.join(", ")}) — never recolor the product itself`);
  return bits.join(". ");
}

// Secondary path — the proven reference dance: media_upload → put_blob(handle) → media_confirm ⇒
// media_id, then generate_image (nano_banana_pro) with the confirmed media as an identity reference.
function photoShootInstruction(scene, aspect) {
  const dir = brandDirection();
  return (
    `Shoot ONE professional product photograph using Higgsfield. ` +
    `A reference image of the product is attached with handle "product".\n` +
    `Steps, in order:\n` +
    `1) media_upload({filename:"product.png", content_type:"image/png"}) → relay put_blob({handle:"product", url:<uploadUrl>}) → media_confirm ⇒ media_id\n` +
    `2) Call the Higgsfield generate_image tool with model "nano_banana_pro", aspect_ratio "${aspect}", medias [{role:"image", value: media_id}], and this exact prompt:\n` +
    `"keep this exact product, unchanged label and shape, place it in: ${scene}${dir ? `. ${dir}` : ""}"\n` +
    `3) Poll until the generation is done, then reply with ONLY the final image URL on its own line.`
  );
}

// Primary path when a brand is lent (and for a typed line): text-driven, no upload at all — the
// brand product name + palette accents + voice-matched art direction carry the whole shoot.
function textShootInstruction(name, scene, aspect) {
  const dir = brandDirection();
  const subject = brand && product?.kind === "brand" ? `"${name}" by ${brand.name}` : `"${name}"`;
  return (
    `Shoot ONE professional product photograph using the Higgsfield generate_image tool.\n` +
    `The product: ${subject}. Place it in: ${scene}.\n` +
    (dir ? `Art direction: ${dir}.\n` : "") +
    `Use aspect_ratio "${aspect}". Poll until the generation is done, then reply with ONLY the final image URL on its own line.`
  );
}

let shootRun = 0; // run token — stop finalizes the UI instantly; a stale loop drains and discards

async function shoot(scene, aspect) {
  if (!relay || !product || shooting) return;
  const run = ++shootRun;
  lastShot = { scene, aspect };
  shooting = true; stopFlag = false;
  $("errbox").hidden = true;
  $("shootbox").hidden = false;
  $("shootbox").classList.remove("idle");
  lastLogText = "";
  setStatus(`shooting "${scene}" at ${aspect}…`);
  reflect();
  let url = null, acc = "";
  try {
    const isPhoto = product.kind === "photo";
    const attachments = isPhoto
      ? [{ handle: "product", filename: "product.png", contentType: "image/png", dataUrl: product.dataUrl }]
      : undefined;
    const prompt = isPhoto ? photoShootInstruction(scene, aspect) : textShootInstruction(product.name, scene, aspect);
    for await (const d of relay.stream({ prompt, agentic: true, attachments })) {
      if (stopFlag || run !== shootRun) break;
      if (d.type === "tool_proposed") {
        const n = d.call?.name || "";
        if (n.includes("media_upload") || n.includes("put_blob") || n.includes("media_confirm")) setStatus("uploading reference…");
        else if (n.includes("generate_image")) setStatus("generating… (your Switchboard asks consent now)");
        else setStatus(`running ${n}…`);
      } else if (d.type === "tool_result") {
        if (d.result?.ok) { const u = extractUrl(resultText(d)); if (u) { url = u; setStatus("developing the frame…"); } }
        else logLine(`blocked — ${d.result?.error?.message || d.call?.name || "tool failed"}`, "bad");
      } else if (d.type === "text") {
        acc += d.text;
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
    if (run !== shootRun) return; // superseded — a newer shoot owns the UI now
    if (stopFlag) return;         // the stop handler already finalized the UI
    url = url || extractUrl(acc);
    if (!url) throw new Error("the shoot finished without an image URL — Reshoot usually lands it on the second frame");
    addShot({ id: "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url, caption: scene, product: product.name, aspect, at: Date.now() });
    setStatus("frame developed ✓");
    logLine("added to the contact sheet.", "good");
  } catch (err) {
    if (run !== shootRun || stopFlag) return; // late failure from a stopped/superseded run — discard
    setStatus("the shoot failed.");
    showError(err);
  } finally {
    if (run === shootRun) {
      shooting = false;
      $("shootbox").classList.add("idle");
      reflect();
    }
  }
}

function showError(err) {
  const msg = String(err?.message || err).slice(0, 240);
  $("err-text").textContent = "The shoot didn't land: " + msg;
  $("errbox").hidden = false;
  logLine("error — " + msg, "bad");
}

$("shoot").addEventListener("click", () => shoot(currentScene(), setup.aspect));
// Stop unlocks the UI immediately (the cartridge cancel idiom) — the stream may be parked on an
// unanswered consent popup, so waiting for the next delta would leave the app stuck in "shooting…".
$("stop").addEventListener("click", () => {
  if (!shooting) return;
  stopFlag = true;
  shooting = false;
  $("shootbox").classList.add("idle");
  setStatus("shoot stopped.");
  reflect();
});
$("retry").addEventListener("click", () => {
  $("errbox").hidden = true;
  if (!lastShot) { logLine("nothing to retry yet — set up a shot and hit Shoot.", "bad"); return; }
  if (!relay) { logLine("connect Switchboard (top right) first.", "bad"); return; }
  if (!product) { logLine("pick a product (a brand chip, a line, or a photo) first.", "bad"); return; }
  shoot(lastShot.scene, lastShot.aspect);
});

// ---------- the contact sheet ----------
function addShot(shot) {
  const sheet = loadSheet();
  sheet.unshift(shot);
  saveSheet(sheet);
  renderSheet();
}

function renderSheet() {
  const sheet = loadSheet();
  $("sheet-empty").hidden = sheet.length > 0;
  $("clear-sheet").hidden = sheet.length === 0;
  $("sheet-count").textContent = sheet.length ? `${sheet.length} frame${sheet.length === 1 ? "" : "s"}` : "";
  const mount = $("sheet");
  mount.textContent = "";
  sheet.forEach((s) => {
    const card = document.createElement("div");
    card.className = "shot";
    const img = document.createElement("img");
    img.src = s.url; img.alt = s.caption; img.loading = "lazy";
    const cap = document.createElement("div"); cap.className = "cap";
    cap.textContent = s.product ? `${s.product} — ${s.caption}` : s.caption;
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = `${s.aspect} · ${new Date(s.at).toLocaleDateString()}`;
    const btns = document.createElement("div"); btns.className = "btns";
    const re = document.createElement("button");
    re.type = "button"; re.className = "sbtn re"; re.textContent = "↺ reshoot";
    re.addEventListener("click", () => {
      if (!relay) { logLine("connect Switchboard (top right) to reshoot.", "bad"); return; }
      if (!product) { logLine("pick a product (a brand chip, a line, or a photo) to reshoot.", "bad"); return; }
      if (shooting) { logLine("one frame at a time — the current shoot is still developing.", "bad"); return; }
      shoot(s.caption, s.aspect);
      $("shootbox").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    const dl = document.createElement("a");
    dl.className = "sbtn"; dl.textContent = "⬇ download";
    dl.href = s.url; dl.target = "_blank"; dl.rel = "noopener";
    // Browsers ignore the download attribute on cross-origin URLs, so fetch → Blob → objectURL.
    // If the CDN lacks CORS headers the fetch fails and we fall through to opening the tab.
    dl.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const resp = await fetch(s.url);
        if (!resp.ok) throw new Error("fetch failed");
        const blob = await resp.blob();
        const ext = (s.url.match(/\.(png|jpe?g|webp)(?:[?#]|$)/i)?.[1] || "png").toLowerCase();
        const obj = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = obj; a.download = "studio-" + s.id + "." + ext;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(obj), 4000);
      } catch {
        window.open(s.url, "_blank", "noopener"); // no CORS on the CDN — open the frame instead
      }
    });
    const kill = document.createElement("button");
    kill.type = "button"; kill.className = "kill"; kill.textContent = "✕"; kill.title = "remove this frame";
    kill.addEventListener("click", () => { saveSheet(loadSheet().filter((x) => x.id !== s.id)); renderSheet(); });
    btns.append(re, dl);
    card.append(kill, img, cap, meta, btns);
    mount.append(card);
  });
}

// Clear sheet: two-tap arm so a stray click can't wipe the sheet.
let clearArm = null;
$("clear-sheet").addEventListener("click", () => {
  const btn = $("clear-sheet");
  if (clearArm) {
    clearTimeout(clearArm); clearArm = null;
    btn.textContent = "clear sheet"; btn.classList.remove("armed");
    saveSheet([]); renderSheet();
  } else {
    btn.textContent = "really clear all frames?"; btn.classList.add("armed");
    clearArm = setTimeout(() => { clearArm = null; btn.textContent = "clear sheet"; btn.classList.remove("armed"); }, 2600);
  }
});

// ---------- boot: restore persisted state ----------
(function boot() {
  const savedSetup = loadJson(SETUP_KEY, null);
  if (savedSetup) {
    // Only the explicit flag means the user picked a scene themselves — the brand auto-pick
    // also persists the setup, so existence alone must not lock the scene forever.
    sceneChosen = setup.chosen = !!savedSetup.chosen;
    if (Number.isInteger(savedSetup.scene) && savedSetup.scene >= -1 && savedSetup.scene < SCENES.length) setup.scene = savedSetup.scene;
    if (typeof savedSetup.steer === "string") setup.steer = savedSetup.steer.slice(0, 200);
    if (ASPECTS.includes(savedSetup.aspect)) setup.aspect = savedSetup.aspect;
  }
  $("steer").value = setup.steer;
  renderChips();
  renderAspects();
  const saved = loadJson(PRODUCT_KEY, null);
  if (saved?.kind === "photo" && typeof saved.dataUrl === "string" && saved.dataUrl.startsWith("data:image/")) {
    setProduct({ kind: "photo", dataUrl: saved.dataUrl, name: saved.name || "product.png", sample: !!saved.sample }, { persist: false });
  } else if (saved?.kind === "text" && typeof saved.name === "string" && saved.name.trim()) {
    $("line").value = saved.name.slice(0, 120);
    setProduct({ kind: "text", name: saved.name.slice(0, 120) }, { persist: false });
  }
  // A saved kind:"brand" product is re-selected by applyBrand once the lent context re-reads on load.
  renderProductViews();
  updateBrief();
  renderSheet();
  reflect();
})();
