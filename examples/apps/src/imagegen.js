// Prism — an independent image studio. It runs on the visitor's own Higgsfield connector through
// window.claude. It requests the whole Higgsfield connector at connect (so the model can submit the
// generation AND poll it), then an agentic completion does: generate_image (per-action write
// consent) → poll job_status (auto-approved read) → return the URL. Prism holds no key, pays nothing.
import { whenRelayReady } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const CONNECTOR = "mcp__claude_ai_Higgsfield__*";        // the user's inherited claude.ai connector
const GEN = "generate_image";
let relay = null;
let referenceDataUrl = null;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// ---- Relay connect (the "wallet" affordance) ----
$("connect").addEventListener("click", async () => {
  const r = await whenRelayReady();
  if (!("connect" in r)) { setStatus("Relay not installed"); return; }
  try {
    const grant = await r.connect({ reason: "Prism — generate images with Higgsfield", tools: [CONNECTOR] });
    relay = r;
    $("go").disabled = false;
    $("connect").hidden = true;
    setStatus(`Connected via Relay · ${grant.models.join(", ") || "your Claude"}`, true);
  } catch (err) {
    setStatus(`Connect rejected (${err?.code ?? "?"})`);
  }
});
function setStatus(text, connected) {
  const s = $("status"); s.hidden = false;
  $("statusText").textContent = text;
  s.querySelector(".glyph").style.background = connected ? "#3DD68C" : "#9C9AA3";
}

// ---- reference image (best-effort; see note on generate) ----
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

// Downscale a data URL to keep the attachment small (max edge ~1024px) before sending to relay.
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
  const prompt = $("prompt").value.trim();
  if (!prompt) return;

  const card = el("div", "shot load");
  card.append(el("div", "scan"), el("div", "cap", referenceDataUrl ? "uploading reference…" : "generating…"));
  $("grid").prepend(card);

  // With a reference, attach the (downscaled) bytes and tell the model the exact upload flow.
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
