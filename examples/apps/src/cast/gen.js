// The generation layer — every call to the user's Claude + Higgsfield lives here, behind clean
// functions the stages call. It is the one place that knows how to: turn a prompt into option cards,
// generate an image (optionally on-model with reference uploads), animate a keyframe to video, stitch
// clips, run web research, and write a script. Cast holds no model of its own — all of this runs on
// the visitor's own compute via relay.stream({agentic:true}); when Switchboard isn't connected, the
// mock branch returns seeded placeholders so the whole pipeline is still explorable end to end.
import { newId } from "./state.js";

const IMG = "generate_image";
const VID = "generate_video";

// Best-fit Higgsfield model per pipeline stage — chosen from the catalog after testing, not left to
// chance. The lesson: pick per task. soul_2 makes gorgeous UGC portraits but auto-enhances every
// prompt and collapses distinct actions into one (everything became "chopping"); nano_banana_pro
// honours the prompt AND an identity reference, so it's the on-model workhorse. soul_location is
// purpose-built for environments. Video is Kling for speed / Seedance when we need reference-driven
// (video→video). These names are threaded into the instructions gen.js sends the user's Claude.
export const MODELS = {
  face: "soul_2",            // photoreal UGC portrait — the persona's identity anchor
  setting: "soul_location",  // purpose-built environments / locations
  shot: "nano_banana_pro",   // on-model action shots: best prompt adherence + identity ref, no forced enhance
  animate: "kling3_0_turbo", // fast single start-frame → vertical clip
  animateRich: "kling3_0",   // multi-shot + audio sync when a beat needs it
  motion: "seedance_2_0",    // reference-driven (image identity + video/audio refs) — true video→video
  talk: "wan2_7",            // audio-driven, character-consistent — persona SAYS the line, lip-synced
};
const TTS = "generate_audio"; // Higgsfield text-to-speech

// ---------- text → option cards ----------
// Run a facet/prompt that must return a JSON array, parse it, and normalise into option cards with
// stable ids. Used by Foundation facets, calendar research and script writing.
export async function generateCards(relay, prompt, { web = false } = {}) {
  const arr = await streamJsonArray(relay, prompt, web);
  return arr.filter(Boolean).map((o) => normalizeCard(o));
}
function normalizeCard(o) {
  return {
    id: o.id || newId(),
    title: o.title || o.name || "Untitled",
    subtitle: o.subtitle || o.niche || undefined,
    body: o.body || o.angle || o.rationale || undefined,
    bullets: Array.isArray(o.bullets) ? o.bullets : undefined,
    chips: Array.isArray(o.chips) ? o.chips : (Array.isArray(o.tags) ? o.tags : undefined),
    palette: Array.isArray(o.palette) ? o.palette.map((p) => (typeof p === "string" ? { name: p, hex: p } : p)) : undefined,
    meta: Array.isArray(o.meta) ? o.meta : undefined,
    recommended: !!o.recommended,
  };
}
// Stream an agentic turn and pull the first JSON array out of the accumulated text.
async function streamJsonArray(relay, prompt, agentic) {
  let acc = "";
  for await (const d of relay.stream({ prompt, agentic: true })) {
    if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  const m = acc.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}
// Stream an agentic turn and return its raw JSON object (for scripts / structured single results).
export async function streamJsonObject(relay, prompt) {
  let acc = "";
  for await (const d of relay.stream({ prompt, agentic: true })) {
    if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  const m = acc.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// ---------- image generation ----------
// A plain text→image call (no reference), for base assets with nothing to stay on-model to. `model`
// defaults per caller — the face uses soul_2, the setting uses soul_location.
export async function generateImage(relay, prompt, aspect = "1:1", model = MODELS.shot) {
  const instruction = `Use the Higgsfield ${IMG} tool with model "${model}" to generate an image of: "${prompt}", aspect_ratio "${aspect}". Wait for it (poll if needed), then reply with ONLY the final image URL on its own line.`;
  return agenticImage(relay, instruction, []);
}

// The on-model call: upload each reference (face + outfit + location + cast), then generate so the
// face and world stay consistent. `refs` is [{handle,filename,url}]. Uses nano_banana_pro by default
// — it honours both the prompt (distinct actions) and the identity reference.
export async function generateOnModel(relay, prompt, aspect, refs, onTool, model = MODELS.shot) {
  const attachments = await attachmentsFor(refs);
  const instruction = refInstruction(prompt, aspect, refs, model);
  return agenticImage(relay, instruction, attachments, onTool);
}

// Animate a keyframe into a short vertical clip. Kling 3.0 Turbo for the fast single-start-frame path.
export async function generateVideo(relay, keyframeUrl, motion = "subtle, natural", model = MODELS.animate) {
  const instruction =
    `Animate this keyframe into a short vertical (9:16) social clip.\n` +
    `Keyframe image URL: ${keyframeUrl}\n` +
    `Use the Higgsfield ${VID} tool with model "${model}" and that keyframe as the start frame; motion: ${motion}.\n` +
    `Poll job status until done, then reply with ONLY the final video URL on its own line.`;
  let acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) { const u = extractVideoUrl(text(d)); if (u) acc = u; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return extractVideoUrl(acc);
}

// Stitch an ordered list of clip URLs into one reel. Higgsfield exposes concatenation; we ask the
// agent to use it and return the final URL. Falls back to the first clip if stitching is unavailable.
export async function stitchClips(relay, clipUrls) {
  if (!clipUrls.length) return null;
  if (clipUrls.length === 1) return clipUrls[0];
  const instruction =
    `Stitch these vertical clips into ONE continuous 9:16 reel, in this order:\n${clipUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}\n` +
    `Use a Higgsfield video concatenation/stitch tool. Poll until done, then reply with ONLY the final stitched video URL on its own line.`;
  let acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) { const u = extractVideoUrl(text(d)); if (u) acc = u; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return extractVideoUrl(acc) || clipUrls[0];
}

// ---------- audio / voice (Higgsfield TTS + audio-driven video) ----------
// Speak text in the persona's voice using Higgsfield's own TTS. `voice` is a voice id/name from
// list_voices (or a cloned voice from create_voice). Returns the audio URL — consistent across every
// post, no local daemon needed. This is the persona's LOCKED voice, the audio twin of the face lock.
export async function generateSpeech(relay, line, voice) {
  const instruction =
    `Use the Higgsfield ${TTS} tool to speak this line as natural, warm creator narration: "${line}".` +
    `${voice ? ` Use the voice "${voice}".` : ""} Poll until done, then reply with ONLY the final audio URL on its own line.`;
  let acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) { const u = extractAudioUrl(text(d)); if (u) acc = u; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return extractAudioUrl(acc);
}

// A voiced clip: the persona performs a beat AND says its line, lip-synced / paced to a Higgsfield
// TTS track fed in as audio_references. `shotUrl` is the beat's on-model still, `audioUrl` the spoken
// line. Uses wan2_7 (synchronized-audio, character-consistent) by default.
export async function voicedClip(relay, shotUrl, audioUrl, action, onTool, model = MODELS.talk) {
  const instruction =
    `Generate a short vertical (9:16) clip where the persona ${action ? `performs: "${action}" while ` : ""}speaking, LIP-SYNCED and paced to a provided voiceover, using Higgsfield ${VID} with model "${model}".\n` +
    `Persona start image URL: ${shotUrl}\nVoiceover audio URL: ${audioUrl}\n` +
    `Steps: media_upload+confirm the image ⇒ start_image; media_import_url the audio ⇒ audio_id. ` +
    `Then call ${VID} with model "${model}", medias [{role:"start_image",value:start_image},{role:"audio_references",value:audio_id}], aspect_ratio "9:16". Poll until done, reply with ONLY the final video URL on its own line.`;
  let acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_proposed") onTool?.(d.call.name);
    else if (d.type === "tool_result" && d.result?.ok) { const u = extractVideoUrl(text(d)); if (u) acc = u; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return extractVideoUrl(acc);
}

// A real per-beat VIDEO clip — NOT a still being animated. Seedance 2.0 generates fresh motion while
// keeping the persona's identity (image_references = face), seeded by the approved storyboard still
// (start_image) and lip-synced/paced to the beat's voiceover (audio_references). nano_banana only
// makes the storyboard frame; THIS makes the footage. Returns the clip URL.
export async function beatClip(relay, startImageUrl, faceUrl, audioUrl, action, onTool, model = MODELS.motion) {
  const steps = [
    `media_upload+confirm the storyboard still ⇒ start_image`,
    `media_upload+confirm the face ⇒ face_id (identity)`,
    audioUrl ? `media_import_url the voiceover ⇒ audio_id` : null,
  ].filter(Boolean).join("; ");
  const medias = [`{role:"start_image",value:start_image}`, `{role:"image_references",value:face_id}`, audioUrl ? `{role:"audio_references",value:audio_id}` : null].filter(Boolean).join(",");
  const instruction =
    `Generate a REAL short vertical (9:16) video clip of the persona performing: "${action}". Not a still pan — actual motion, cooking/action as described, ${audioUrl ? "lip-synced / paced to the voiceover, " : ""}keeping the SAME identity, using Higgsfield ${VID} with model "${model}".\n` +
    `Storyboard still URL: ${startImageUrl}\nFace identity URL: ${faceUrl}\n${audioUrl ? `Voiceover audio URL: ${audioUrl}\n` : ""}` +
    `Steps: ${steps}. Then call ${VID} with model "${model}", medias [${medias}], aspect_ratio "9:16". Poll until done, reply with ONLY the final video URL on its own line.`;
  let acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_proposed") onTool?.(d.call.name);
    else if (d.type === "tool_result" && d.result?.ok) { const u = extractVideoUrl(text(d)); if (u) acc = u; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return extractVideoUrl(acc);
}

// ---------- shared agentic image loop ----------
async function agenticImage(relay, instruction, attachments, onTool) {
  let url = null, acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true, attachments })) {
    if (d.type === "tool_proposed") onTool?.(d.call.name);
    else if (d.type === "tool_result" && d.result?.ok) url = extractUrl(text(d)) || url;
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return url || extractUrl(acc);
}
function refInstruction(promptText, aspect, refs, model = MODELS.shot) {
  const steps = refs.map((r, i) => `${i + 1}) media_upload({filename:"${r.filename}",content_type:"image/png"}) → relay put_blob({handle:"${r.handle}",url:<uploadUrl>}) → media_confirm ⇒ media_id_${r.handle}`).join("\n");
  return `Generate an on-model image of: "${promptText}", aspect_ratio "${aspect}".\n` +
    `Keep the SAME face as reference "face". Reference handles attached: ${refs.map((r) => r.handle).join(", ")}.\n` +
    `For EACH handle in order:\n${steps}\n` +
    `Then call Higgsfield ${IMG} with model "${model}" and ALL media_id_* in medias (role "image", face first) so face, wardrobe and setting stay consistent. Poll until done, then reply with ONLY the final image URL on its own line.`;
}

// ---------- video → video: the DEFAULT route (Seedance 2.0, reference-driven) ----------
// Make a NEW reel that follows a reference clip's pacing/energy while keeping OUR persona's identity.
// This is the "make a video like this one, but it's my creator" path — one call takes the persona
// face (image_references) + the reference reel (video_references) + a prompt, and returns a finished
// vertical clip. Chosen as the Produce default: identity + video + optional audio in a single model.
// (motion_control below is the pure motion-copy alternative; both stay available.)
export async function refDrive(relay, identityUrl, refVideoUrl, prompt, onTool, model = MODELS.motion) {
  const instruction =
    `Make a short vertical (9:16) social reel that follows the ENERGY and pacing of a reference clip while keeping OUR persona's identity, using Higgsfield ${VID} with model "${model}" (reference-driven).\n` +
    `Persona identity image URL: ${identityUrl}\nReference reel URL: ${refVideoUrl}\nWhat happens: ${prompt}\n` +
    `Steps: media_upload+confirm the identity image ⇒ id_a; media_import_url the reference reel ⇒ id_b. ` +
    `Then call ${VID} with model "${model}", the prompt, and medias [{role:"image_references",value:id_a},{role:"video_references",value:id_b}], aspect_ratio "9:16". Poll until done, then reply with ONLY the final video URL on its own line.`;
  let acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_proposed") onTool?.(d.call.name);
    else if (d.type === "tool_result" && d.result?.ok) { const u = extractVideoUrl(text(d)); if (u) acc = u; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return extractVideoUrl(acc);
}

// ---------- video → video: motion transfer (Kling 3.0 Motion Control) ----------
// Drive a character still with the motion + camera of a reference clip — our persona performs exactly
// what the reference reel does. This is the direct answer to "make a video like this one": point it
// at a reference reel, keep our locked identity. `characterUrl` is a persona shot; `motionVideoUrl`
// is the driving clip.
export async function motionTransfer(relay, characterUrl, motionVideoUrl, onTool) {
  const instruction =
    `Recreate a video by transferring the motion + camera of a reference clip onto our character still, using Higgsfield's motion_control (Kling 3.0 Motion Control).\n` +
    `Character image URL: ${characterUrl}\nReference motion video URL: ${motionVideoUrl}\n` +
    `Steps: 1) media_upload + confirm the character image ⇒ image_id. 2) media_import_url the motion video ⇒ motion_video_id. ` +
    `3) Call motion_control with { image_id, motion_video_id, scene_control:"image" }. Poll until done, then reply with ONLY the final video URL on its own line.`;
  let acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_proposed") onTool?.(d.call.name);
    else if (d.type === "tool_result" && d.result?.ok) { const u = extractVideoUrl(text(d)); if (u) acc = u; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return extractVideoUrl(acc);
}
async function attachmentsFor(refs) {
  return Promise.all(refs.map(async (r) => ({ handle: r.handle, filename: r.filename, contentType: "image/png", dataUrl: await downscale(r.url) })));
}

// ---------- utils ----------
const text = (d) => (d.result?.content ?? []).map((c) => c.text ?? "").join("");
const URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
const VIDEO_RE = /(https?:\/\/[^\s"')]+\.(?:mp4|webm|mov|m3u8))|"(?:videoUrl|video_url|url)"\s*:\s*"([^"]+\.(?:mp4|webm|mov)[^"]*)"/i;
const AUDIO_RE = /(https?:\/\/[^\s"')]+\.(?:mp3|wav|m4a|ogg|aac))|"(?:audioUrl|audio_url|url)"\s*:\s*"([^"]+\.(?:mp3|wav|m4a|ogg|aac)[^"]*)"/i;
export function extractUrl(t) { const m = (t || "").match(URL_RE); return m ? (m[1] || m[2] || m[0]) : null; }
export function extractVideoUrl(t) { const m = (t || "").match(VIDEO_RE); return m ? (m[1] || m[2] || m[0]) : null; }
export function extractAudioUrl(t) { const m = (t || "").match(AUDIO_RE); return m ? (m[1] || m[2] || m[0]) : null; }
export async function downscale(dataUrl, max = 1024) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/png");
  } catch { return dataUrl; }
}
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- demo placeholders (mock branch) ----------
// A gradient SVG tile so the pipeline renders without a connector. Deterministic on the label.
export function svgTile(label, a, b, w = 320, h = 320) {
  const words = String(label).split(/\s+/); const lines = []; let cur = "";
  for (const wd of words) { if ((cur + " " + wd).trim().length > 16) { lines.push(cur.trim()); cur = wd; } else cur += " " + wd; }
  if (cur.trim()) lines.push(cur.trim());
  const cy = h / 2 - (lines.length - 1) * 11;
  const tspans = lines.slice(0, 4).map((ln, i) => `<text x='${w / 2}' y='${cy + i * 22}' font-family='Space Grotesk, sans-serif' font-size='16' font-weight='600' fill='rgba(255,255,255,.94)' text-anchor='middle'>${ln}</text>`).join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='${w}' height='${h}' fill='url(#g)'/>${tspans}</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
export const COLORS = [["#FF5A3C", "#FFB05A"], ["#6B4CF0", "#9B7BFF"], ["#2FA96B", "#7FD8A8"], ["#FF8A3D", "#6B4CF0"]];
