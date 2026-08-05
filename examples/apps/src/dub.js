// DUB — drop an audio clip, get it split into a per-speaker script, pick a TTS voice for each
// speaker, and regenerate the whole track in those voices — all on the visitor's OWN Claude + the
// daemon's LOCAL speech models. The operator holds no key, pays for no inference, and never hears the
// user's audio: Switchboard brokers everything and the bytes stay on the machine.
//
// This is the first of a family of TTS workflows. It leans on REAL daemon capabilities only:
//   • transcription — window.claude `claude_transcribe` (local whisper/STT server; MediaRegistry)
//   • voice list    — capabilities().local.voices (cloned voices in ~/.relay/voices + macOS `say`)
//   • synthesis     — relay.speak(text, { voice }) → `claude_speak` (local TTS, data: URL out)
// Speaker DIARIZATION is NOT a daemon capability, so Claude infers turn-taking from the transcript
// text (labelled, ordered). Stitching is pure Web Audio in-tab. See AGENT-DUB-integration notes.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line is
// proven idiom (distilled from recap.js/regex.js) — keep it byte-identical. Edit the CONFIG block and
// everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// Option cards come from the shared kit (src/kit/ui.js): DRAFTED stays visually distinct from CHOSEN
// so the accent never paints a machine decision (doctrine 5), and any slate gets an escape hatch.
import { optionCards } from "./kit/ui.js";
// God's hands + the notch glance: expose Dub's action as a page-tool AND publish a purpose-built
// widget, both driving the same pipeline (kit/webmcp.js).
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
// Carried context: when the Switchboard OS launches Dub AT an item, note it (Dub still needs a clip).
import { readOsContext } from "./os/os-context.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "dub",                                  // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Dub",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Dub — splits an audio clip into a per-speaker script and revoices each speaker with a local TTS voice, on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // transcription + TTS are LOCAL daemon verbs (claude_transcribe / claude_speak), not gated connector tools
  },
  usesContext: null,                            // a studio utility — no lent brand context needed
};

// ==== dom + string helpers ==================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);
const msg = (e) => String(e?.message || e).slice(0, 160);
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
function mdLite(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ");
}
function sanitizeSvg(svg) {
  return String(svg || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
}
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3200);
}

// carried context — the OS may launch Dub AT an item. Dub's primary input is an audio clip (nothing
// text to prefill), so we surface WHERE we came from as a chip on the drop screen. Safe no-op when
// absent (bad hash → null → "").
const OS_CTX = readOsContext();
function osCtxTitle() {
  const c = OS_CTX; if (!c) return "";
  if (typeof c.artifact === "string") return c.artifact.slice(0, 160);
  if (c.artifact && typeof c.artifact.title === "string") return c.artifact.title.slice(0, 160);
  if (typeof c.term === "string") return c.term.slice(0, 160);
  return "";
}

// ==== connect (standard chip + returning-user probe) ========================================
let relay = null;
let notInstalled = false;
let brand = null;         // the ONE lent context, when APP.usesContext === "single"
let wired = false;

mountConnect($("chip-dock"), {
  scope: APP.scope,
  context: APP.usesContext,
  installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; wire(r); void onReady(); },
  onDisconnect: () => { relay = null; render(); },
  onProjectChange: () => { void syncContext(); },
});
(async () => {
  const r = await whenRelayReady(2000, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) { relay = r; wire(r); void onReady(); return; } }
  else if (r && r.installed === false) notInstalled = true;
  render();
})();
function wire(r) { if (wired) return; wired = true; r.on("permissionsChanged", () => void syncContext()); }
// onReady fires TWICE by design — mountConnect's onConnect AND the returning-user probe,
// whichever wins the race. Hydrating from storage on BOTH passes is a real (timing-dependent) bug:
// the second pass re-reads the run the first pass just saved, REPLACING the in-memory object the
// running pipeline still holds a reference to. The pipeline then finishes into a detached orphan and
// the UI sits forever on a run that never completes. Hydrate once.
let hydrated = false;
async function onReady() {
  await syncContext();
  if (!hydrated) { hydrated = true; await loadState(); }
  render(); autostart();
}

// CONTEXT-FIRST: the moment a context is lent, everything derives from it — options from
// data.products, tone from data.voice, colors from data.palette (FLAT hex strings — see
// docs/CONTEXT-KINDS.md). Hardcoded samples are allowed ONLY pre-connect, visibly labeled.
async function syncContext() {
  if (!relay) return;
  if (APP.usesContext === "single") brand = await relay.context.active().catch(() => null);
  render();
}

// ==== per-origin state (values are opaque STRINGS — store JSON) =============================
let state = { run: null };
async function loadState() { try { const raw = await relay.storage.get(APP.id + "-state"); if (raw) state = JSON.parse(raw); } catch { state = { run: null }; } }
async function saveState() { try { await relay.storage.set(APP.id + "-state", JSON.stringify(state)); } catch { /* non-fatal */ } }

// ==== llm helpers — the EXACT stream contract; never guess these shapes =====================
// relay.stream(params) is an async iterator of deltas:
//   { type:"text", text }  { type:"tool_proposed", call }  { type:"tool_result", result }
//   { type:"error", error:{ message } }  { type:"done", result }
// relay.complete(params) resolves { text, usage, stopReason }.
const STREAM_TIMEOUT_MS = 180000;
async function streamText(params, onProgress) {
  const it = relay.stream(params);
  let text = "", settled = false, timer = null;
  try {
    return await Promise.race([
      (async () => {
        for await (const d of it) {
          if (d.type === "text") { text += d.text; onProgress && onProgress({ text }); }
          else if (d.type === "tool_proposed") { onProgress && onProgress({ tool: d.call?.name }); }
          else if (d.type === "error") throw new Error(d.error?.message || "stream error");
        }
        settled = true;
        return text;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          try { it.return?.(); } catch { /* already closed */ }
          reject(new Error("Switchboard didn't respond — is the sidekick running? Reload this tab and try again."));
        }, STREAM_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
async function askJson(parts) { return parseJson(await streamText({ prompt: parts.filter(Boolean).join("\n\n") })); }
async function askJsonArray(parts) { return parseJsonArray(await streamText({ prompt: parts.filter(Boolean).join("\n\n") })); }
function parseJson(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}
function parseJsonArray(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  try { const a = JSON.parse(t.slice(s, e + 1)); return Array.isArray(a) ? a : null; } catch { return null; }
}
// Image generation on the USER'S Higgsfield (agentic; needs HIGGSFIELD in the granted tools).
const IMG_URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
async function genImage(promptText) {
  const instruction = `Use the Higgsfield generate_image tool to generate an image of: "${promptText}", aspect_ratio "16:9". Wait for it to finish (poll job status if needed), then reply with ONLY the final image URL on its own line.`;
  let url = null, acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) { const t = (d.result.content ?? []).map((x) => x.text ?? "").join(""); const m = t.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  if (!url) { const m = acc.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
  return url;
}

// ==== house UI atoms ========================================================================
// Option cards: 2–4 options, exactly ONE recommended — now imported from ./kit/ui.js (same class
// names, plus the drafted-vs-chosen distinction and the escape hatch).
function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }
function steerRow(onSteer, chips) {
  const wrap = el("div", "steer");
  wrap.append(el("span", "kicker", "not quite? steer it"));
  const row1 = el("div", "chips");
  for (const s of (chips || STEER_CHIPS)) { const c = el("button", "chip", s); c.onclick = () => onSteer(s); row1.append(c); }
  wrap.append(row1);
  const row = el("div", "row");
  const box = el("div", "box");
  const input = el("input"); input.placeholder = "tell it what to change…";
  const send = () => { const t = input.value.trim(); if (!t) return; input.value = ""; onSteer(t); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  box.append(input);
  const btn = el("button", "send", "send"); btn.onclick = send;
  row.append(box, btn); wrap.append(row);
  return wrap;
}
function connectSteps() {
  const card = el("div", "steps-card");
  const steps = el("div", "steps");
  const s1 = el("div"); s1.innerHTML = notInstalled
    ? "<b>1</b> · Install Switchboard (button, top-right)"
    : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude";
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · One line in — the pipeline runs itself";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Pick a card, steer anywhere, keep what you like";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// DUB — audio in → per-speaker script → a voice per speaker → the track regenerated in those voices.
// The pipeline auto-advances: transcribe (local STT) → split into a labelled, ordered script (Claude
// infers speakers from the transcript — the daemon does NOT diarize) → the user picks one local TTS
// voice per speaker → Regenerate synthesizes each turn (claude_speak) and Web Audio stitches the
// clips into one track with a small gap between turns → player + download.

// ---- the raw provider (window.claude). The SDK wraps speak() but NOT transcribe(), so we reach the
// local `claude_transcribe` verb through the provider directly — the same object @relay/sdk wraps. ----
function rawProvider() { const c = (typeof window !== "undefined" ? window : globalThis).claude; return (c && c.isRelay && typeof c.request === "function") ? c : null; }

// ---- data-URL <-> bytes plumbing (audio never leaves the tab except to the LOCAL daemon) ----
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("couldn't read that file"));
    fr.readAsDataURL(file);
  });
}
function dataUrlToArrayBuffer(dataUrl) {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
  if (!m) throw new Error("not a data: URL");
  const body = m[2] || "";
  if (m[1]) { const bin = atob(body); const len = bin.length; const bytes = new Uint8Array(len); for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i); return bytes.buffer; }
  const dec = decodeURIComponent(body); const bytes = new Uint8Array(dec.length); for (let i = 0; i < dec.length; i++) bytes[i] = dec.charCodeAt(i); return bytes.buffer;
}
function arrayBufferToB64(ab) {
  const bytes = new Uint8Array(ab); let bin = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DIARIZATION — the explicit "who spoke when" step, as a SWAPPABLE SEAM.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE FUNCTION TO SWAP:  diarize(audioDataUrl) -> { source, language, segments }
//   segments: [{ speaker:"s1", start:<sec|null>, end:<sec|null>, text:"…" }]  (in spoken order)
//   source:   "daemon:<backend>"  (a REAL audio diarizer)  |  "inferred"  (Claude guessed from text)
//
// STATE OF THE DAEMON (verified 2026-08-03 against packages/sidekick/src + packages/protocol/src):
//   There is NO real diarization capability. `claude_transcribe` returns ONLY { text, backend } —
//   no timestamps, no speaker labels (whisper.cpp runs with `-nt`; the OpenAI-shaped local server is
//   not asked for `verbose_json`). `capabilities().local` is just { tts, voices }. So today Dub CAN'T
//   know who-spoke-when from audio; it INFERS speakers from conversational cues in the transcript.
//
// THE UPGRADE (documented in the hand-back): add a real audio diarizer to the daemon's media layer
//   (pyannote.audio, or whisperX / whisper-diarize which give word-level segments + speaker turns),
//   exposed as EITHER (a) a new `claude_diarize` verb returning { segments:[{speaker,start,end,text}] },
//   OR (b) a `claude_transcribe` that returns a `segments` array (timestamped, optionally speaker-tagged).
//   `tryRealDiarizer()` below feature-detects BOTH; when one lands, NOTHING ELSE in Dub changes.
const DIARIZE_METHOD = "claude_diarize"; // the future daemon verb this seam will prefer, once it exists
const fmtTs = (sec) => (sec == null || !isFinite(sec)) ? "" : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// ---- transcription (LOCAL, via the daemon's claude_transcribe). Also surfaces `segments` if a
// future timestamped/diarizing transcribe returns them — so the seam upgrades transparently. ----
async function transcribeAudio(dataUrl) {
  const p = rawProvider();
  if (!p) throw new Error("Switchboard isn't connected — connect it (top-right) first.");
  const out = await p.request({ method: "claude_transcribe", params: { audio: dataUrl } });
  const text = String(out?.text || "").trim();
  const segments = Array.isArray(out?.segments) ? out.segments : null; // present only on a future verbose transcribe
  if (!text && !segments) throw new Error("No speech was recognized. Local transcription needs a whisper/STT backend on the daemon (RELAY_LOCAL_STT_URL, RELAY_WHISPER_BIN, or RELAY_STT_CMD).");
  return { text, backend: out?.backend || "", segments };
}

// ---- (1) REAL diarizer, feature-detected. This is the swap-in point: the day the daemon grows a
// diarizer, this returns non-null and Claude-inference is skipped entirely. ----
async function tryRealDiarizer(dataUrl) {
  const p = rawProvider();
  if (!p) return null;
  // (a) a dedicated claude_diarize verb, advertised in capabilities().methods
  let hasVerb = false;
  try { const caps = await relay.capabilities(); hasVerb = Array.isArray(caps?.methods) && caps.methods.includes(DIARIZE_METHOD); } catch { /* older daemon */ }
  if (hasVerb) {
    try {
      const out = await p.request({ method: DIARIZE_METHOD, params: { audio: dataUrl } });
      const segs = normalizeSegments(out?.segments);
      if (segs.length) return { source: `daemon:${out?.backend || "diarizer"}`, language: out?.language || "", segments: segs };
    } catch { /* fall through to inference */ }
  }
  // (b) a transcribe that already returns speaker-tagged, timestamped segments
  const tr = await transcribeAudio(dataUrl);
  if (tr.segments && tr.segments.some((s) => s && (s.speaker != null))) {
    const segs = normalizeSegments(tr.segments);
    if (segs.length) return { source: `daemon:${tr.backend || "transcribe"}`, language: "", segments: segs, _transcript: tr.text };
  }
  return { _fallbackTranscript: tr }; // no real diarizer — hand the transcript to the inference path
}

// ---- (2) INFERRED fallback — Claude segments a flat (or timestamped-but-unlabelled) transcript into
// speakers from conversational cues. HONESTLY marked source:"inferred": this is a guess, not audio
// diarization. If the transcribe gave timestamped segments, we feed them so Claude keeps real times. ----
async function inferSpeakers(tr, steers) {
  const hasSegs = tr.segments && tr.segments.length;
  const body = hasSegs
    ? `TIMESTAMPED SEGMENTS (start–end seconds · text), assign a speaker to each:\n${tr.segments.map((s, i) => `#${i} [${s.start ?? "?"}–${s.end ?? "?"}] ${String(s.text || "").trim()}`).join("\n").slice(0, 12000)}`
    : `TRANSCRIPT (no timestamps available):\n"""${String(tr.text).slice(0, 12000)}"""`;
  const raw = await streamText({
    prompt: [
      `You are ${APP.name}. You are given a transcript that is NOT diarized (no ground-truth speaker labels). Infer who spoke each part from conversational cues (turn-taking, questions/answers, named mentions, style). If it is clearly one person, return a single speaker.`,
      steers && steers.length ? `Apply the latest steer: ${steers.map((s) => `"${s}"`).join(" → ")}` : "",
      body,
      "Reply with ONE JSON object ONLY — no prose, no fences:",
      hasSegs
        ? '{ "language":"<ISO-639-1 or empty>", "speakers":[{"id":"s1","name":"Speaker 1"}], "segments":[{"speaker":"s1","from":<segment #index it starts at>,"text":"<contiguous turn text>"}] }'
        : '{ "language":"<ISO-639-1 or empty>", "speakers":[{"id":"s1","name":"Speaker 1"}], "segments":[{"speaker":"s1","text":"<one contiguous turn>","ts":"<mm:ss or empty>"}] }',
      "Rules: every segment.speaker MUST be an id present in speakers. Keep segments in spoken order. Never invent content not in the transcript.",
    ].filter(Boolean).join("\n\n"),
    maxTokens: 2400,
  });
  const obj = parseJson(raw);
  const speakers = (obj && Array.isArray(obj.speakers) && obj.speakers.length) ? obj.speakers : [{ id: "s1", name: "Speaker 1" }];
  const ids = new Set(speakers.map((s) => s.id));
  const first = speakers[0].id;
  let segments = [];
  if (obj && Array.isArray(obj.segments) && obj.segments.length) {
    segments = obj.segments.map((sg) => {
      const speaker = ids.has(sg.speaker) ? sg.speaker : first;
      // carry real times when we fed timestamped segments through
      let start = null, end = null, text = String(sg.text || "").trim();
      if (hasSegs && Number.isInteger(sg.from) && tr.segments[sg.from]) { start = numOrNull(tr.segments[sg.from].start); }
      else if (sg.ts) { start = parseTs(sg.ts); }
      return { speaker, start, end, text };
    }).filter((s) => s.text);
  }
  if (!segments.length) segments = [{ speaker: first, start: null, end: null, text: String(tr.text || (tr.segments || []).map((s) => s.text).join(" ")).trim() }];
  return { source: "inferred", language: (obj && obj.language) || "", speakers, segments };
}

// THE SEAM. Everything downstream (script build → voice pick → regen → stitch) consumes this shape,
// so swapping in a real diarizer is a one-function change.
async function diarize(audioDataUrl, steers) {
  const real = await tryRealDiarizer(audioDataUrl);
  if (real && real.segments) return withSpeakerNames(real);      // a real diarizer answered
  const tr = real?._fallbackTranscript || await transcribeAudio(audioDataUrl);
  return await inferSpeakers(tr, steers);                         // first cut: inferred
}

// ---- canonical helpers over the seam's output ----
function numOrNull(x) { const n = Number(x); return isFinite(n) ? n : null; }
function parseTs(s) { const m = /^(\d+):(\d{1,2})$/.exec(String(s || "").trim()); return m ? (+m[1] * 60 + +m[2]) : null; }
function normalizeSegments(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => ({ speaker: s?.speaker != null ? String(s.speaker) : "s1", start: numOrNull(s?.start), end: numOrNull(s?.end), text: String(s?.text || "").trim() })).filter((s) => s.text);
}
// A real diarizer labels speakers "s1"/"SPEAKER_00"/… but rarely names them — give each a display name.
function withSpeakerNames(diar) {
  const order = []; const seen = new Set();
  for (const s of diar.segments) { if (!seen.has(s.speaker)) { seen.add(s.speaker); order.push(s.speaker); } }
  const speakers = order.map((id, i) => ({ id, name: `Speaker ${i + 1}` }));
  return { source: diar.source, language: diar.language || "", speakers, segments: diar.segments };
}

// ---- build the render/regen script FROM a diarization result (the seam's consumer) ----
// script = { source, language, speakers:[{id,name}], turns:[{speaker,text,start,end,ts}] }
function scriptFromDiar(diar) {
  const speakers = (diar.speakers && diar.speakers.length) ? diar.speakers : withSpeakerNames(diar).speakers;
  const ids = new Set(speakers.map((s) => s.id));
  const first = speakers[0]?.id || "s1";
  const turns = diar.segments.map((s) => ({ speaker: ids.has(s.speaker) ? s.speaker : first, text: s.text, start: s.start, end: s.end, ts: fmtTs(s.start) }));
  return { source: diar.source, language: diar.language || "", speakers, turns };
}

// ---- available LOCAL TTS voices (cloned voices in ~/.relay/voices + the OS engine) ----
let VOICES = [];
async function loadVoices() {
  try { const caps = await relay.capabilities(); VOICES = Array.isArray(caps?.local?.voices) ? caps.local.voices.slice() : []; }
  catch { VOICES = []; }
  return VOICES;
}
// One distinct recommended voice per speaker, round-robin over what's installed. This is a DRAFT the
// user can override in the dropdown — never a locked decision (doctrine 5).
function recommendVoice(speakerIndex) {
  if (!VOICES.length) return "";
  return VOICES[speakerIndex % VOICES.length];
}

// ---- step 3: synthesize each turn on the chosen voice + stitch (Web Audio, in-tab) ----
async function synthTurn(text, voice) {
  const clip = await relay.speak(String(text).slice(0, 4000), voice ? { voice } : undefined);
  if (!clip || !clip.audio) throw new Error("Local TTS returned nothing — is a voice engine available on the daemon?");
  return clip.audio; // data:audio/wav;base64,…
}
// Concatenate decoded clips into one AudioBuffer (a short gap between turns), then encode 16-bit WAV.
async function stitchClips(dataUrls, gapSec = 0.28) {
  const AC = (typeof window !== "undefined" ? window : globalThis).AudioContext || (typeof window !== "undefined" ? window : globalThis).webkitAudioContext;
  if (!AC) throw new Error("this browser has no Web Audio — can't stitch the clips");
  const ctx = new AC();
  try {
    const buffers = [];
    for (const du of dataUrls) buffers.push(await ctx.decodeAudioData(dataUrlToArrayBuffer(du)));
    const rate = ctx.sampleRate;                                  // decodeAudioData resamples every clip to this
    const channels = Math.max(1, ...buffers.map((b) => b.numberOfChannels));
    const gap = Math.max(0, Math.round(rate * gapSec));
    const totalFrames = buffers.reduce((n, b) => n + b.length, 0) + gap * Math.max(0, buffers.length - 1);
    const out = ctx.createBuffer(channels, totalFrames || 1, rate);
    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
      const b = buffers[i];
      for (let ch = 0; ch < channels; ch++) {
        const src = b.getChannelData(Math.min(ch, b.numberOfChannels - 1));
        out.getChannelData(ch).set(src, offset);
      }
      offset += b.length + (i < buffers.length - 1 ? gap : 0);
    }
    return encodeWav(out);
  } finally { try { ctx.close?.(); } catch { /* ignore */ } }
}
function encodeWav(buf) {
  const numCh = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const blockAlign = numCh * 2, dataLen = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataLen), view = new DataView(ab);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); view.setUint32(4, 36 + dataLen, true); wr(8, "WAVE"); wr(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numCh, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  wr(36, "data"); view.setUint32(40, dataLen, true);
  const chans = []; for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < numCh; c++) { let s = Math.max(-1, Math.min(1, chans[c][i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2; }
  return "data:audio/wav;base64," + arrayBufferToB64(ab);
}

// ==== the run (auto-advancing pipeline) =====================================================
let running = false;

function autostart() {
  // No cold open — Dub needs an audio clip in hand. Left in place for house-consistency.
  if (state.run) return;
}

// source: a File, or { audioDataUrl, fileName, mime } (God tool / widget path)
async function start(source) {
  if (!relay || running) return;
  let audioDataUrl = "", fileName = "clip", mime = "";
  if (source && typeof source.arrayBuffer === "function") {            // a File
    fileName = source.name || "clip"; mime = source.type || "";
    audioDataUrl = await fileToDataUrl(source);
  } else if (source && source.audioDataUrl) {
    audioDataUrl = source.audioDataUrl; fileName = source.fileName || "clip"; mime = source.mime || "";
  }
  if (!audioDataUrl) { toast("Drop an audio file first.", true); return; }
  state.run = { id: uid(), fileName, mime, audioDataUrl, diarSource: "", backend: "", script: null, picks: {}, output: null, steers: [], status: "", stage: "diarizing", error: null };
  await saveState(); render();
  await runPipeline();
}

async function runPipeline() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null;
  try {
    // 1) DIARIZE (the seam): transcribe → who-spoke-when. Uses a real daemon diarizer if one exists,
    //    else infers speakers from the transcript. Returns canonical { source, speakers, segments }.
    r.stage = "diarizing"; r.status = "finding the speakers…"; render();
    const diar = await diarize(r.audioDataUrl, r.steers);
    r.diarSource = diar.source;                    // "daemon:…" (real) | "inferred" (Claude guessed)
    // 2) build the render/regen script from the diarization
    r.script = scriptFromDiar(diar);
    // 3) voices + default (recommended) picks — one distinct voice per speaker
    await loadVoices();
    r.picks = r.picks || {};
    r.script.speakers.forEach((sp, i) => { if (!r.picks[sp.id]) r.picks[sp.id] = recommendVoice(i); });
    r.stage = "ready"; r.status = "";
  } catch (e) { r.error = msg(e); r.stage = "diarizing"; }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

async function regenerate() {
  const r = state.run; if (!r || !r.script || running) return;
  running = true; r.error = null; r.stage = "regenerating"; r.output = null;
  try {
    if (!VOICES.length) await loadVoices();
    const clips = [];
    const turns = r.script.turns;
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      r.status = `voicing turn ${i + 1} of ${turns.length}…`; render();
      clips.push(await synthTurn(t.text, r.picks[t.speaker]));
    }
    r.status = "stitching the track…"; render();
    r.output = await stitchClips(clips);
    r.stage = "done"; r.status = "";
  } catch (e) { r.error = msg(e); r.stage = "ready"; }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

function downloadOutput() {
  const r = state.run; if (!r || !r.output) return;
  const a = el("a"); a.href = r.output; a.download = (r.fileName.replace(/\.[^.]+$/, "") || "dub") + "-dubbed.wav"; a.click();
}

// ==== render ================================================================================
const STEER_CHIPS = ["merge speakers", "split more finely", "name the speakers", "fewer turns"];

function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    const s = el("div", "sample");
    s.append(el("div", "kicker", "how it works (connect to run your own)"));
    s.append(el("div", "sample-text", "Drop a two-person voice note → Dub transcribes it locally, splits it into Speaker 1 / Speaker 2, you pick a voice for each, and it regenerates one clean track. Audio never leaves your machine."));
    view.append(s);
    return;
  }

  if (!r) { view.append(dropView()); return; }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "dubbing"), el("span", "run-input", r.fileName), el("span", "grow"));
  const redo = el("button", "act", "× new"); redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  // an inline player for the SOURCE clip
  if (r.audioDataUrl) {
    const srcWrap = el("div", "player");
    srcWrap.append(el("div", "kicker", "source"));
    const au = el("audio"); au.controls = true; au.src = r.audioDataUrl; srcWrap.append(au);
    col.append(srcWrap);
  }

  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void (r.script ? regenerate() : runPipeline());
    col.append(t);
  }

  if (r.script && (r.stage === "ready" || r.stage === "regenerating" || r.stage === "done")) {
    col.append(scriptView(r));
  }

  view.append(col);
}

function dropView() {
  const wrap = el("div", "start");
  const osTitle = osCtxTitle();
  if (osTitle) wrap.append(el("div", "ctx", "Opened from Switchboard OS · " + osTitle + " — drop its audio to revoice"));
  const zone = el("label", "drop");
  zone.append(el("div", "drop-icon", "▚"));
  zone.append(el("div", "drop-title", "Drop an audio clip"));
  zone.append(el("div", "drop-sub", "wav · mp3 · m4a · webm — or click to choose. Transcribed locally, never uploaded."));
  const input = el("input"); input.type = "file"; input.accept = "audio/*"; input.hidden = true;
  input.onchange = () => { const f = input.files && input.files[0]; if (f) void start(f); };
  zone.append(input);
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) void start(f); });
  wrap.append(zone);
  wrap.append(el("div", "hint", "one clip in · per-speaker script · a voice each · one track out"));
  return wrap;
}

function scriptView(r) {
  const wrap = el("div", "script");
  const speakers = r.script.speakers;
  const noVoices = !VOICES.length;

  // HONEST PROVENANCE: real audio diarizer vs Claude inferring speakers from the transcript. This is
  // the line that keeps Dub from pretending it knows who-spoke-when when it only guessed (doctrine 6).
  const inferred = !r.diarSource || r.diarSource === "inferred";
  const prov = el("div", "prov" + (inferred ? " inferred" : ""));
  prov.append(el("span", "prov-dot"));
  prov.append(el("span", "prov-text", inferred
    ? "Speakers inferred from the transcript — Claude's best guess, not audio diarization. Use the steer row to correct it."
    : `Diarized by ${r.diarSource.replace(/^daemon:/, "")} — real who-spoke-when.`));
  wrap.append(prov);

  // per-speaker voice picker + that speaker's lines
  for (let i = 0; i < speakers.length; i++) {
    const sp = speakers[i];
    const block = el("div", "spk");
    const head = el("div", "spk-head");
    head.append(el("span", "spk-name", sp.name || `Speaker ${i + 1}`));
    head.append(el("span", "grow"));

    if (noVoices) {
      head.append(el("span", "spk-novoice", "no local voices"));
    } else {
      const rec = recommendVoice(i);
      const sel = el("select", "voice-pick");
      for (const v of VOICES) { const o = el("option", null, v); o.value = v; if ((r.picks[sp.id] || rec) === v) o.selected = true; sel.append(o); }
      sel.onchange = () => { r.picks[sp.id] = sel.value; void saveState(); };
      head.append(el("span", "spk-vlabel", "voice"), sel);
      if (rec) head.append(el("span", "spk-rec", `rec · ${rec}`));
    }
    block.append(head);

    const lines = el("div", "spk-lines");
    for (const t of r.script.turns.filter((t) => t.speaker === sp.id)) {
      const line = el("div", "line");
      if (t.ts) line.append(el("span", "line-ts", t.ts));
      line.append(el("span", "line-text", t.text));
      lines.append(line);
    }
    block.append(lines);
    wrap.append(block);
  }

  // steer the split
  if (r.stage !== "regenerating") wrap.append(steerRow((s) => { r.steers.push(s); r.script = null; r.output = null; void runPipeline(); }, STEER_CHIPS));

  // regenerate + output
  const actions = el("div", "gen-actions");
  const gen = el("button", "primary", r.output ? "Regenerate ↻" : "Regenerate in these voices 🎙");
  gen.disabled = running || noVoices;
  gen.onclick = () => void regenerate();
  actions.append(gen);
  if (noVoices) actions.append(el("div", "hint", "No local TTS voices found. Install a cloned voice (~/.relay/voices) or run on a Mac (the `say` engine) to revoice."));
  wrap.append(actions);

  if (r.output) {
    const outWrap = el("div", "player out");
    outWrap.append(el("div", "kicker", "dubbed track"));
    const au = el("audio"); au.controls = true; au.src = r.output; outWrap.append(au);
    const dl = el("button", "act", "download .wav"); dl.onclick = downloadOutput;
    outWrap.append(dl);
    wrap.append(outWrap);
  }
  return wrap;
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `dub_run` accepts an audio clip as a data: URL, runs the SAME diarize→script the page runs (live
// on screen), and returns the speaker-labelled script for God to read or file. Picking a voice per
// speaker + regenerating stays a human decision on the page (it changes how people sound), so the
// tool stops at the script — honest about where the machine should not auto-decide. It also reports
// whether the speakers were REALLY diarized or INFERRED, so God never overstates who-spoke-when.
exposeToGod({
  name: "dub_run",
  description: "Transcribe an audio clip (locally) and split it into a speaker-labelled, ordered script (diarize). Pass the audio as a data: URL. Runs live on the page and returns the script plus whether speakers were diarized or inferred; choosing a voice per speaker and regenerating happens on the page.",
  inputSchema: { audio: "string — the audio clip as a data: URL (e.g. data:audio/wav;base64,…). Required." },
  execute: async ({ audio } = {}) => {
    const dataUrl = String(audio || "").trim();
    if (!/^data:audio\//.test(dataUrl)) throw new Error("pass { audio } as a data:audio/… URL");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Dub isn't connected to Switchboard yet");
    await waitFor(() => !running, 180000);
    await start({ audioDataUrl: dataUrl, fileName: "god-clip", mime: (dataUrl.match(/^data:([^;,]+)/) || [])[1] || "" });
    await waitFor(() => !running, 180000);
    const r = state.run || {};
    if (r.error) throw new Error(r.error);
    if (!r.script) throw new Error("Dub couldn't build a script — try again");
    const inferred = !r.diarSource || r.diarSource === "inferred";
    const text = r.script.speakers.map((sp) => {
      const lines = r.script.turns.filter((t) => t.speaker === sp.id).map((t) => `  ${t.ts ? `[${t.ts}] ` : ""}${t.text}`).join("\n");
      return `${sp.name}:\n${lines}`;
    }).join("\n\n");
    return { text, speakers: r.script.speakers.length, turns: r.script.turns.length, diarization: inferred ? "inferred" : r.diarSource, note: inferred ? "speakers inferred from the transcript, not audio-diarized" : "real diarization" };
  },
});

// ---- The notch glance: drop audio → the detected speakers as cards ----------------------------------
// The producer reuses the same diarize seam. With no input (or no connection) it returns an honest
// prompt state rather than a fake glance.
function widgetAudioFrom(input) {
  if (!input) return "";
  if (typeof input === "string" && /^data:audio\//.test(input)) return input;
  if (typeof input === "object") {
    if (/^data:audio\//.test(String(input.dataUrl || ""))) return input.dataUrl;
    if (/^data:audio\//.test(String(input.audio || ""))) return input.audio;
  }
  return "";
}
exposeWidget(async (input) => {
  const prompt = {
    kicker: "DUB · REVOICE", title: "Drop an audio clip", openLabel: "Open Dub", shape: "text",
    result: { body: "Hand me a voice note or recording — I split it into a per-speaker script you can revoice.", caption: "local transcription · audio stays on device" },
  };
  const audio = widgetAudioFrom(input);
  if (!audio || !relay) return prompt;
  try {
    const diar = await diarize(audio, []);
    const script = scriptFromDiar(diar);
    const inferred = !diar.source || diar.source === "inferred";
    const items = script.speakers.map((sp, i) => {
      const n = script.turns.filter((t) => t.speaker === sp.id).length;
      const sample = (script.turns.find((t) => t.speaker === sp.id)?.text || "").slice(0, 90);
      return { label: sp.name || `Speaker ${i + 1}`, text: `${n} turn${n === 1 ? "" : "s"} · "${sample}${sample.length >= 90 ? "…" : ""}"`, recommended: i === 0 };
    });
    return {
      kicker: "DUB · SPEAKERS", title: `${script.speakers.length} speaker${script.speakers.length === 1 ? "" : "s"} ${inferred ? "inferred" : "diarized"}`,
      openLabel: "Open Dub — pick voices", shape: "cards",
      result: { caption: `${script.turns.length} turns · ${inferred ? "inferred, not audio-diarized · " : ""}pick a voice each in Dub`, items },
    };
  } catch (e) {
    return { ...prompt, title: "Couldn't read that clip", result: { body: msg(e), caption: "local transcription · audio stays on device" } };
  }
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__dubTest = { diarize, inferSpeakers, scriptFromDiar, tryRealDiarizer, normalizeSegments, stitchClips, encodeWav, dataUrlToArrayBuffer, arrayBufferToB64, recommendVoice, fmtTs, get voices() { return VOICES; } }; } catch { /* ignore */ }
