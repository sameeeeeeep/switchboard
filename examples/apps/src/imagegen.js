// Prism — an independent image studio, now BRAND-CONTEXT aware. It runs on the visitor's own
// Higgsfield connector through window.claude, AND it can load a brand the user built elsewhere
// (e.g. brandbrain) via claude_context: the user picks which brand to lend Prism in the side panel,
// then chooses a product + a design style FROM that brand, and Prism generates on-brand — on their
// own compute, holding no key and no brand data of its own. BYO inference + context.
import { whenRelayReady } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const CONNECTOR = "mcp__claude_ai_Higgsfield__*";        // the user's inherited claude.ai connector
const GEN = "generate_image";
// Fallback styles when a brand context doesn't carry its own.
const DEFAULT_STYLES = ["editorial minimal", "vibrant maximal", "matte product studio", "lifestyle candid", "bold graphic", "soft pastel"];
let relay = null;
let referenceDataUrl = null;
let brand = null; // the loaded brand context (normalized), or null

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// ---- Switchboard connect (the "wallet" affordance) ----
async function onConnected(r, models) {
  relay = r;
  $("go").disabled = false;
  $("connect").hidden = true;
  setStatus(`Connected · ${models?.join(", ") || "your Claude"}`, true);
  $("note").textContent = "Load a brand to generate on-brand, or just describe an image. Each generation is a per-action consent.";
  await loadBrandContext(); // surface whatever brand the user has already lent Prism
}
// Not installed: repurpose the connect button as the install door instead of a dead status line.
function becomeInstallButton(installUrl) {
  setStatus("Switchboard not installed");
  const b = $("connect");
  b.textContent = "Get Switchboard ↗";
  b.onclick = () => window.open(installUrl, "_blank", "noreferrer");
}

$("connect").addEventListener("click", async () => {
  const r = await whenRelayReady();
  if (!("connect" in r)) { becomeInstallButton(r.installUrl); return; }
  try {
    const grant = await r.connect({ reason: "Prism — generate on-brand images with Higgsfield", tools: [CONNECTOR] });
    await onConnected(r, grant.models);
  } catch (err) {
    setStatus(`Connect rejected (${err?.code ?? "?"})`);
  }
});

// Returning-user probe: a persisted grant connects on load, no click needed.
(async () => {
  const r = await whenRelayReady(2000);
  if (!("connect" in r)) { becomeInstallButton(r.installUrl); return; }
  const grant = await r.permissions().catch(() => null);
  if (grant) await onConnected(r, grant.models);
})();
function setStatus(text, connected) {
  const s = $("status"); s.hidden = false;
  $("statusText").textContent = text;
  s.querySelector(".glyph").style.background = connected ? "#3DD68C" : "#9C9AA3";
}

// ---- brand context: read the one the user lent Prism, or open the panel picker ----
async function loadBrandContext() {
  try {
    const ctx = await relay.context.active();
    if (ctx) applyBrand(ctx);
    else revealLoadButton("Load brand");
  } catch { revealLoadButton("Load brand"); }
}
function revealLoadButton(label) {
  const b = $("loadBrand"); b.hidden = false; b.textContent = label; $("brandbar").hidden = false;
  $("brandFields").hidden = true; $("bchip").hidden = true;
}
$("loadBrand").addEventListener("click", async () => {
  if (!relay) return;
  const prev = $("loadBrand").textContent; $("loadBrand").textContent = "Choose in Switchboard…"; $("loadBrand").disabled = true;
  try {
    const ctx = await relay.context.pick(); // opens the side-panel picker; selecting one lends it to Prism
    if (ctx) applyBrand(ctx);
    else { $("loadBrand").textContent = prev; }
  } finally { $("loadBrand").disabled = false; }
});

// Normalize an opaque brand context into what Prism uses (defensive — no locked schema).
function normalizeBrand(ctx) {
  const d = (ctx && ctx.data) || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  const products = arr(d.products).length ? arr(d.products) : arr(d.range);
  const styles = arr(d.styles).length ? arr(d.styles) : DEFAULT_STYLES;
  return {
    name: ctx.name || d.name || "Brand",
    voice: String(d.voice || d.vibe || d.positioning || "").trim(),
    palette: arr(d.palette),
    products,
    styles,
  };
}

function applyBrand(ctx) {
  brand = normalizeBrand(ctx);
  $("brandbar").hidden = false;
  $("brandFields").hidden = false;
  const chip = $("bchip"); chip.hidden = false; chip.textContent = "";
  chip.append(el("span", "dot"), el("span", null, brand.name));
  if (brand.palette.length) for (const c of brand.palette.slice(0, 4)) { const sw = el("span", "sw"); sw.style.background = c; chip.append(sw); }
  fillSelect($("product"), brand.products, brand.products.length ? null : "— brand has no products —");
  fillSelect($("style"), brand.styles);
  $("loadBrand").textContent = "Change brand"; $("loadBrand").hidden = false;
  $("prompt").placeholder = "Add art direction (optional) — e.g. on a marble surface, morning light";
  $("note").textContent = `Generating on-brand for ${brand.name}. Pick a product + style; Prism folds in the brand's voice and palette.`;
}
function fillSelect(sel, items, emptyLabel) {
  sel.textContent = "";
  if (!items.length && emptyLabel) { sel.append(new Option(emptyLabel, "")); sel.disabled = true; return; }
  sel.disabled = false;
  for (const it of items) sel.append(new Option(it, it));
}

// Build the generation prompt: brand context + chosen product + style + any extra art direction.
function buildPrompt() {
  const extra = $("prompt").value.trim();
  if (!brand) return extra; // no brand loaded → plain text-to-image, as before
  const product = $("product").value.trim();
  const style = $("style").value.trim();
  return [
    product ? `${product} for ${brand.name}` : `${brand.name} brand image`,
    style ? `${style} style` : "",
    brand.voice ? `brand voice: ${brand.voice}` : "",
    brand.palette.length ? `brand palette: ${brand.palette.join(", ")}` : "",
    extra,
  ].filter(Boolean).join(". ");
}

// ---- reference image (best-effort) ----
$("refBtn").addEventListener("click", () => $("refInput").click());
$("refInput").addEventListener("change", () => {
  const file = $("refInput").files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { referenceDataUrl = String(reader.result); showThumb(referenceDataUrl); };
  reader.readAsDataURL(file);
});
function showThumb(dataUrl) {
  const ref = $("ref"); ref.textContent = ""; ref.append($("refInput"));
  const thumb = el("div", "refthumb");
  const img = el("img"); img.src = dataUrl; img.alt = "reference";
  const x = el("button", "x", "×"); x.title = "Remove reference";
  x.onclick = () => { referenceDataUrl = null; ref.textContent = ""; ref.append($("refInput"), refButton()); };
  thumb.append(img, x); ref.append(thumb);
}
function refButton() { const b = el("button", "refbtn", "＋ Reference image"); b.id = "refBtn"; b.onclick = () => $("refInput").click(); return b; }

const URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
function extractUrl(text) { const m = text.match(URL_RE); return m ? (m[1] || m[2] || m[0]) : null; }

async function downscale(dataUrl, max = 1024) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/png");
}

// ---- generate (agentic: the model runs the connector's upload + generate flow, each step gated) ----
$("go").addEventListener("click", async () => {
  if (!relay) return;
  const prompt = buildPrompt();
  if (!prompt) return;

  const card = el("div", "shot load");
  card.append(el("div", "scan"), el("div", "cap", referenceDataUrl ? "uploading reference…" : "generating…"));
  $("grid").prepend(card);

  let attachments;
  let instruction;
  if (referenceDataUrl) {
    const small = await downscale(referenceDataUrl);
    attachments = [{ handle: "ref", filename: "ref.png", contentType: "image/png", dataUrl: small }];
    instruction =
      `Generate an image of: "${prompt}", aspect_ratio "${$("aspect").value}", guided by a reference image.\n` +
      `The reference is attached as relay handle "ref". To use it, do EXACTLY:\n` +
      `1) Call Higgsfield media_upload({ filename: "ref.png", content_type: "image/png" }) to get a presigned upload URL.\n` +
      `2) Call relay put_blob({ handle: "ref", url: <that upload URL> }) to upload the bytes (do NOT use bash/curl).\n` +
      `3) Call Higgsfield media_confirm as instructed by the upload result to get a media_id.\n` +
      `4) Call Higgsfield ${GEN} with the prompt and that media_id as a reference in medias.\n` +
      `5) Poll job status until done, then reply with ONLY the final image URL on its own line.`;
  } else {
    instruction =
      `Use the Higgsfield ${GEN} tool to generate an image of: "${prompt}", aspect_ratio "${$("aspect").value}". ` +
      `Wait for it to finish (poll the job status if needed), then reply with ONLY the final image URL on its own line.`;
  }

  let url = null, acc = "";
  try {
    for await (const d of relay.stream({ prompt: instruction, agentic: true, attachments })) {
      if (d.type === "tool_proposed") {
        const n = d.call.name;
        if (n.endsWith("media_upload") || n.endsWith("put_blob") || n.endsWith("media_confirm")) status(card, "uploading reference…");
        else if (n.endsWith(GEN)) status(card, "generating…");
        else if (/status|display|wait/.test(n)) status(card, "rendering…");
      } else if (d.type === "tool_result" && d.result?.ok) {
        const t = (d.result.content ?? []).map((c) => c.text ?? "").join("");
        url = extractUrl(t) || url;
      } else if (d.type === "text") {
        acc += d.text;
      } else if (d.type === "error") {
        return fail(card, `Blocked: ${d.error.message}`);
      }
    }
    url = url || extractUrl(acc);
    if (!url) return fail(card, "No image came back.");
    card.className = "shot"; card.textContent = "";
    const img = el("img"); img.src = url; img.alt = prompt; img.loading = "lazy";
    card.append(img, el("div", "cap", prompt));
  } catch (err) {
    fail(card, `Failed (${err?.code ?? "?"})`);
  }
});
function status(card, text) { const c = card.querySelector(".cap"); if (c) c.textContent = text; else card.append(el("div", "cap", text)); }
function fail(card, msg) { card.className = "shot"; card.textContent = ""; const c = el("div", "cap", msg); c.style.color = "#c0392b"; card.append(c); }
