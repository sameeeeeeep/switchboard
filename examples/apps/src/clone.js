// Clone — make a voice from a clip (drop · record · YouTube), pick the segment, then speak any text in
// it. The cloning runs on the visitor's OWN machine: the on-device god-tts engine (MLX) clones the
// selected audio into ~/.relay/voices/<name>.wav in ~0.02s and speaks from it. Nothing leaves the box,
// no key, no credits — and the moment a voice is cloned, EVERY wrapp (Echo, God) can speak in it too.
//
// Unlike the LLM wrapps, Clone talks straight to the local voice server (localhost:7897) for ALL three
// verbs — fetch a link, save+clone a clip, synth text — because those are on-device media ops, not
// brokered inference. The Switchboard chip still mounts (same house header); a grant isn't required.
// We deliberately do NOT route generation through relay.speak: the daemon's localTTS silently falls
// back to macOS `say` when the clone engine is cold/slow (its timeout is short), which comes out as the
// DEFAULT Mac voice — the opposite of what a clone wrapp wants. Hitting :7897 directly returns THIS
// clone or a clear error, and a generous timeout covers the ~20s first-call cold compile.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// God's hands: expose Clone's verbs as page-tools so the native God webview (or any WebMCP host) can
// clone + speak hands-free — reusing the SAME functions a click runs, so the user watching sees it.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "clone",
  name: "Clone",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Clone makes a voice from a clip on your machine and speaks text in it — nothing leaves it",
    models: [],
    tools: [],
  },
  usesContext: "none",
};
const GOD = "http://127.0.0.1:7897";   // on-device voice engine (examples/god/tts/god-tts-server.py)
const CLONE_MIN = 6, CLONE_MAX = 20;   // sweet-spot segment length (s) we nudge toward — a longer, clean,
                                       // single-speaker reference gives the cloner more timbre to work with

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const msg = (e) => String(e?.message || e).slice(0, 200);
const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const fmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, "0")}`; };
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3600);
}

// ==== connect (chip only — cloning does NOT require a grant) =================================
let relay = null, notInstalled = false;
mountConnect($("chip-dock"), {
  scope: APP.scope, context: APP.usesContext, installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; render(); },
  onDisconnect: () => { relay = null; render(); },
});
(async () => {
  const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; }
  else if (r && r.installed === false) notInstalled = true;
  void refreshVoices(); render();
})();

// ==== state (in memory — audio is large, never persisted) ===================================
let audioBuf = null;       // decoded AudioBuffer of the loaded source clip
let srcLabel = "";         // where it came from ("dropped file" / "recording" / a URL)
let sel = { start: 0, end: 0 };   // selection window, seconds
let voiceName = "";        // what the user names the clone
let voices = [];           // names known to the engine
let savedVoice = "";       // the name we just cloned (drives the Generate panel)
let genText = "", genUrl = null, genBackend = "";
let busy = { fetch: false, clone: false, gen: false };
let err = "";

async function refreshVoices() {
  try { const r = await fetch(`${GOD}/voices`, { signal: AbortSignal.timeout(3000) }); const d = await r.json(); voices = d.voices || []; }
  catch { voices = []; }
}

// ==== audio in: shared decode → waveform ====================================================
const AC = () => new (window.AudioContext || window.webkitAudioContext)();
async function loadFromArrayBuffer(ab, label) {
  err = "";
  try {
    const ctx = AC();
    audioBuf = await ctx.decodeAudioData(ab.slice(0));
    ctx.close();
  } catch (e) { err = "Couldn't read that audio (" + msg(e) + ")"; audioBuf = null; render(); return; }
  srcLabel = label;
  // default selection: the first CLONE_MAX seconds (or the whole clip if shorter)
  sel = { start: 0, end: Math.min(audioBuf.duration, CLONE_MAX) };
  savedVoice = ""; genUrl = null;
  render();
}
async function onFile(file) {
  if (!file) return;
  await loadFromArrayBuffer(await file.arrayBuffer(), file.name || "dropped file");
}
async function onFetch(url) {
  url = String(url || "").trim();
  if (!/^https?:\/\//.test(url)) { toast("Paste a full http(s) link.", true); return; }
  busy.fetch = true; err = ""; render();
  try {
    const r = await fetch(`${GOD}/fetch`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, max_seconds: 180 }), signal: AbortSignal.timeout(150000) });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || "fetch failed");
    const bytes = Uint8Array.from(atob(d.audio_b64), (c) => c.charCodeAt(0));
    await loadFromArrayBuffer(bytes.buffer, url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40));
    if (d.capped) toast("Grabbed the first 3 min — trim to the part you want.");
  } catch (e) { err = "Fetch failed: " + msg(e); }
  finally { busy.fetch = false; render(); }
}

// ---- recording (bonus path) --------------------------------------------------------------
let rec = null, recChunks = [], recording = false;
async function toggleRecord() {
  if (recording) { rec && rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec = new MediaRecorder(stream); recChunks = [];
    rec.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    rec.onstop = async () => {
      recording = false; stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recChunks, { type: rec.mimeType || "audio/webm" });
      await loadFromArrayBuffer(await blob.arrayBuffer(), "your recording");
    };
    rec.start(); recording = true; render();
  } catch (e) { toast("Mic unavailable: " + msg(e), true); }
}

// ==== waveform canvas + draggable handles ===================================================
function drawWave(cv) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  if (!audioBuf) return;
  const data = audioBuf.getChannelData(0), n = data.length, mid = H / 2;
  const cs = getComputedStyle(document.documentElement);
  const dim = cs.getPropertyValue("--edge").trim() || "#262C38";
  const accent = cs.getPropertyValue("--accent").trim() || "#C8F250";
  // full waveform (dim), then the selected span redrawn (accent)
  const paint = (color, from, to) => {
    g.fillStyle = color;
    for (let x = 0; x < W; x++) {
      const t = x / W; if (t < from || t > to) continue;
      const i0 = Math.floor(t * n), i1 = Math.floor(((x + 1) / W) * n);
      let mn = 1, mx = -1;
      for (let i = i0; i < i1; i++) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const y0 = mid + mn * mid * 0.92, y1 = mid + mx * mid * 0.92;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  };
  paint(dim, 0, 1);
  const s = sel.start / audioBuf.duration, e = sel.end / audioBuf.duration;
  // shade outside selection
  g.fillStyle = "rgba(7,8,9,0.62)";
  g.fillRect(0, 0, s * W, H); g.fillRect(e * W, 0, W - e * W, H);
  paint(accent, s, e);
  // handles
  g.fillStyle = accent;
  g.fillRect(s * W - 1, 0, 2, H); g.fillRect(e * W - 1, 0, 2, H);
  g.beginPath(); g.arc(s * W, mid, 6, 0, 7); g.arc(e * W, mid, 6, 0, 7); g.fill();
}
function wireWave(cv) {
  let drag = null;   // "start" | "end" | null
  const xToT = (clientX) => { const b = cv.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - b.left) / b.width)) * audioBuf.duration; };
  const pick = (t) => (Math.abs(t - sel.start) <= Math.abs(t - sel.end) ? "start" : "end");
  cv.onpointerdown = (ev) => { if (!audioBuf) return; cv.setPointerCapture(ev.pointerId); drag = pick(xToT(ev.clientX)); onMove(ev); };
  const onMove = (ev) => {
    if (!drag || !audioBuf) return;
    const t = xToT(ev.clientX);
    if (drag === "start") sel.start = Math.min(t, sel.end - 0.2);
    else sel.end = Math.max(t, sel.start + 0.2);
    sel.start = Math.max(0, sel.start); sel.end = Math.min(audioBuf.duration, sel.end);
    drawWave(cv); updateSelLabel();
  };
  cv.onpointermove = onMove;
  cv.onpointerup = () => { drag = null; };
}
let selLabelEl = null;
function updateSelLabel() {
  if (!selLabelEl) return;
  const len = sel.end - sel.start;
  const good = len >= CLONE_MIN && len <= CLONE_MAX + 4;
  selLabelEl.textContent = `${fmt(sel.start)} – ${fmt(sel.end)}  ·  ${len.toFixed(1)}s`;
  selLabelEl.className = "sellen" + (good ? " ok" : "");
}

// play just the selection
let previewSrc = null;
function playSelection() {
  if (!audioBuf) return;
  if (previewSrc) { try { previewSrc.stop(); } catch {} previewSrc = null; return; }
  const ctx = AC(); const src = ctx.createBufferSource(); src.buffer = audioBuf; src.connect(ctx.destination);
  src.start(0, sel.start, Math.max(0.05, sel.end - sel.start));
  previewSrc = src; src.onended = () => { previewSrc = null; ctx.close(); };
}

// ==== segment → WAV (16-bit mono at buffer rate; the server re-normalizes to 24k) ===========
function selectionToWavBase64() {
  const sr = audioBuf.sampleRate, ch = audioBuf.getChannelData(0);
  const i0 = Math.floor(sel.start * sr), i1 = Math.min(ch.length, Math.floor(sel.end * sr));
  const N = Math.max(0, i1 - i0);
  const buf = new ArrayBuffer(44 + N * 2), view = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); view.setUint32(4, 36 + N * 2, true); wr(8, "WAVE"); wr(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); wr(36, "data"); view.setUint32(40, N * 2, true);
  let o = 44; for (let i = i0; i < i1; i++) { let s = Math.max(-1, Math.min(1, ch[i])); view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  // base64 the bytes
  const u8 = new Uint8Array(buf); let bin = ""; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

async function cloneVoice() {
  const name = slug(voiceName);
  if (!name) { toast("Give the voice a name.", true); return; }
  if (!audioBuf) { toast("Load a clip first.", true); return; }
  if (sel.end - sel.start < 1) { toast("Select at least a second of speech.", true); return; }
  busy.clone = true; err = ""; render();
  try {
    const audio_b64 = selectionToWavBase64();
    const r = await fetch(`${GOD}/save`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, audio_b64 }), signal: AbortSignal.timeout(60000) });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || "clone failed — is the voice engine running?");
    savedVoice = d.voice; genText = genText || ""; genUrl = null;
    await refreshVoices();
    toast(`Cloned "${d.voice}" (${d.seconds}s). Now type something below.`);
  } catch (e) { err = "Clone failed: " + msg(e); }
  finally { busy.clone = false; render(); }
}

// ==== generate: speak text in the cloned voice ==============================================
async function generate() {
  const text = String(genText || "").trim();
  if (!text) { toast("Paste some text to speak.", true); return; }
  if (!savedVoice) { toast("Clone a voice first.", true); return; }
  busy.gen = true; err = ""; genUrl = null; render();
  try {
    // ALWAYS synth on the on-device clone engine directly — it speaks THIS clone or returns a clear
    // error. Never relay.speak (see the header note): that path degrades to the default Mac voice.
    const r = await fetch(`${GOD}/speak`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: savedVoice }), signal: AbortSignal.timeout(120000) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `voice engine returned ${r.status}`);
    }
    const blob = await r.blob();
    if (!blob || blob.size < 128) throw new Error("empty audio from the voice engine");
    genUrl = URL.createObjectURL(blob); genBackend = "on-device clone";
  } catch (e) {
    err = "Generate failed: " + msg(e) + " — is the on-device voice engine (god-tts) running?";
  }
  finally { busy.gen = false; render(); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = !!audioBuf;
  view.textContent = "";
  const col = el("div", "clone");

  // 1 — SOURCE
  const src = el("div", "panel");
  src.append(stepHead("1", "Give it a voice", "Drop a clip, record, or paste a link — ~10s of clean speech is plenty."));
  const inrow = el("div", "inrow");
  // youtube / link
  const urlBox = el("div", "urlbox");
  const urlIn = el("input"); urlIn.placeholder = "Paste a YouTube (or any audio) link…"; urlIn.value = "";
  urlIn.addEventListener("keydown", (e) => { if (e.key === "Enter") onFetch(urlIn.value); });
  const fetchBtn = el("button", "primary sm", busy.fetch ? "Fetching…" : "Fetch");
  fetchBtn.disabled = busy.fetch; fetchBtn.onclick = () => onFetch(urlIn.value);
  urlBox.append(urlIn, fetchBtn);
  inrow.append(urlBox);
  src.append(inrow);
  // drop + record
  const drop = el("label", "drop");
  drop.append(el("div", "dropicon", "⤓"), el("div", "droptxt", "Drop an audio file, or click to choose"));
  const fileIn = el("input"); fileIn.type = "file"; fileIn.accept = "audio/*"; fileIn.hidden = true;
  fileIn.onchange = () => onFile(fileIn.files[0]);
  drop.append(fileIn);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); onFile(e.dataTransfer.files[0]); };
  const recBtn = el("button", "act rec" + (recording ? " on" : ""), recording ? "■ Stop recording" : "● Record from mic");
  recBtn.onclick = () => toggleRecord();
  const srcTools = el("div", "srctools"); srcTools.append(drop, recBtn);
  src.append(srcTools);
  if (busy.fetch) src.append(working("Pulling audio from the link…"));
  col.append(src);

  // 2 — SELECT + CLONE
  if (audioBuf) {
    const pane = el("div", "panel");
    pane.append(stepHead("2", "Pick the part to clone", `From ${srcLabel} · ${fmt(audioBuf.duration)} total`));
    const cv = el("canvas", "wave");
    pane.append(cv);
    const meta = el("div", "wavemeta");
    selLabelEl = el("div", "sellen"); updateSelLabel();
    const play = el("button", "act", "▶ Play selection"); play.onclick = () => playSelection();
    meta.append(selLabelEl, play);
    pane.append(meta);
    // name + clone
    const namerow = el("div", "namerow");
    const nameIn = el("input", "nameinput"); nameIn.placeholder = "name this voice (e.g. morgan)"; nameIn.value = voiceName;
    nameIn.oninput = () => { voiceName = nameIn.value; };
    nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") cloneVoice(); });
    const cloneBtn = el("button", "primary", busy.clone ? "Cloning…" : "Clone this voice");
    cloneBtn.disabled = busy.clone; cloneBtn.onclick = () => cloneVoice();
    namerow.append(nameIn, cloneBtn);
    pane.append(namerow);
    if (busy.clone) pane.append(working("Cloning on your machine…"));
    col.append(pane);
    requestAnimationFrame(() => { drawWave(cv); wireWave(cv); });
  }

  // 3 — GENERATE
  if (savedVoice) {
    const gen = el("div", "panel");
    gen.append(stepHead("3", `Speak as “${savedVoice}”`, "Paste any text — it's synthesized on your machine, in the cloned voice."));
    const ta = el("textarea", "say"); ta.placeholder = "Type or paste what this voice should say…"; ta.value = genText;
    ta.oninput = () => { genText = ta.value; };
    ta.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate(); });
    gen.append(ta);
    const grow = el("div", "genrow");
    if (voices.length > 1) {
      const sel2 = el("select", "voice");
      for (const v of voices) { const o = el("option", null, v); o.value = v; if (v === savedVoice) o.selected = true; sel2.append(o); }
      sel2.onchange = () => { savedVoice = sel2.value; render(); };
      grow.append(sel2);
    }
    const go = el("button", "primary", busy.gen ? "Synthesizing…" : "Generate ⌘↵");
    go.disabled = busy.gen; go.onclick = () => generate();
    grow.append(go);
    gen.append(grow);
    if (busy.gen) gen.append(working("Speaking in the cloned voice…"));
    if (genUrl) {
      const clip = el("div", "clip");
      const audio = el("audio"); audio.controls = true; audio.autoplay = true; audio.src = genUrl; clip.append(audio);
      const cm = el("div", "clipmeta");
      cm.append(el("span", "kicker", genBackend || "on-device"));
      const dl = el("a", "act", "↓ Download"); dl.href = genUrl; dl.download = `${savedVoice}.wav`; cm.append(dl);
      clip.append(cm); gen.append(clip);
    }
    col.append(gen);
  }

  if (err) col.append(el("div", "err", err));
  view.append(col);
}

function stepHead(n, title, sub) {
  const h = el("div", "stephead");
  h.append(el("span", "stepn", n), el("span", "steptitle", title));
  if (sub) h.append(el("div", "stepsub", sub));
  return h;
}
function working(t) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, t)); return r; }

render();
window.addEventListener("resize", () => { const cv = document.querySelector(".wave"); if (cv) drawWave(cv); });

// ==== God's hands — page-tools driving the real UI ==========================================
// The waveform select is a human step God can't perform, so clone_voice takes url + start/seconds
// instead: it fetches (if a link is given), sets the selection window programmatically, then runs the
// SAME cloneVoice() a click runs. clone_speak reuses generate(); clone_list reads the engine. Every
// tool drives the on-page state so the user watching sees the fetch, the clone, and the audio happen.
const _waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };

exposeToGod([
  {
    name: "clone_voice",
    description: "Clone a voice on-device, hands-free. Fetches an audio/YouTube link (or uses the clip already loaded on the page), takes the segment [start, start+seconds], saves + clones it, and returns the voice name to speak with. Nothing leaves the machine.",
    inputSchema: {
      name: "string — what to name the cloned voice. Required.",
      url: "string — optional audio or YouTube link to clone from. If omitted, uses the clip already loaded on the page.",
      start: "number — optional segment start, in seconds (default 0).",
      seconds: "number — optional segment length, in seconds (default ~12).",
    },
    execute: async ({ name, url, start, seconds } = {}) => {
      const nm = slug(name);
      if (!nm) throw new Error("pass { name } to name the voice");
      if (url != null && String(url).trim()) {
        if (!/^https?:\/\//.test(String(url).trim())) throw new Error("url must be a full http(s) link");
        await onFetch(String(url));                         // loads audioBuf, or sets err on failure
        if (!await _waitFor(() => !!audioBuf || !!err, 160000)) throw new Error("timed out fetching the link");
        if (err) throw new Error(err);
      }
      if (!audioBuf) throw new Error("no audio to clone — pass { url } or load a clip on the page first");
      let s = Math.max(0, Number(start) || 0);
      const len = Math.max(1, Number(seconds) || CLONE_MAX);
      let end = Math.min(audioBuf.duration, s + len);
      if (end - s < 1) s = Math.max(0, end - 1);            // keep at least a second selected
      sel = { start: s, end };
      voiceName = nm;
      await cloneVoice();                                   // sets savedVoice, or err
      if (err) throw new Error(err);
      if (!savedVoice) throw new Error("clone failed");
      render();
      return { voice: savedVoice, seconds: +(sel.end - sel.start).toFixed(2) };
    },
  },
  {
    name: "clone_speak",
    description: "Speak text on-device in a cloned voice. Uses the voice just cloned unless you pass one. Plays on the page and returns which backend spoke it.",
    inputSchema: {
      text: "string — the text to speak. Required.",
      voice: "string — optional cloned voice name (default: the most recently cloned voice).",
    },
    execute: async ({ text, voice } = {}) => {
      const val = String(text || "").trim();
      if (!val) throw new Error("pass { text } with what to say");
      if (voice != null && String(voice).trim()) savedVoice = slug(voice);
      if (!savedVoice) { await refreshVoices(); savedVoice = voices[0] || ""; }
      if (!savedVoice) throw new Error("no cloned voice available — clone one first with clone_voice");
      genText = val;
      await generate();
      if (err) throw new Error(err);
      if (!genUrl) throw new Error("no audio produced — is the voice engine running?");
      render();
      return { spoken: true, voice: savedVoice, backend: genBackend || "on-device" };
    },
  },
  {
    name: "clone_list",
    description: "List the cloned / local voices available on this machine.",
    inputSchema: {},
    execute: async () => { await refreshVoices(); return { voices }; },
  },
]);
