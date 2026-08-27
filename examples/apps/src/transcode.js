// Convert Media — drop an audio/video file, pick a target format, transcode it right here on the
// user's Mac. Like Clone, this talks STRAIGHT to the on-device media server (localhost:7897) — its
// /convert endpoint shells out to the ffmpeg that's already installed (the same binary the voice
// engine uses). Nothing is uploaded, no key, no credits, no "online converter website". A Switchboard
// grant isn't required; the chip mounts for identity/house-header only.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// God's hands: expose Convert as a page-tool so the native God webview (or any WebMCP host) can
// transcode a file hands-free — reusing the SAME function a click runs.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "transcode",
  name: "Convert Media",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Convert Media transcodes an audio/video file on your machine — nothing leaves it",
    models: [],
    tools: [],
  },
  usesContext: "none",
};
const GOD = "http://127.0.0.1:7897";   // on-device media engine (examples/god/tts/god-tts-server.py)

// What we recognise and what we offer to convert INTO, by source kind.
const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "aiff", "aif", "wma", "alac"];
const VIDEO_EXT = ["mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "wmv", "mpg", "mpeg", "3gp"];
const AUDIO_TARGETS = ["mp3", "m4a", "wav", "flac", "ogg", "opus"];
const VIDEO_TARGETS = ["mp4", "mov", "webm", "gif"];

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const msg = (e) => String(e?.message || e).slice(0, 240);
const extOf = (n) => String(n || "").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
const stemOf = (n) => String(n || "file").replace(/\.[^.]+$/, "");
const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const fmtBytes = (b) => { b = b || 0; if (b < 1024) return b + " B"; if (b < 1048576) return (b / 1024).toFixed(1) + " KB"; return (b / 1048576).toFixed(1) + " MB"; };
const kindOf = (ext) => AUDIO_EXT.includes(ext) ? "audio" : VIDEO_EXT.includes(ext) ? "video" : "other";
const targetsFor = (ext) => {
  const k = kindOf(ext);
  if (k === "video") return [...VIDEO_TARGETS, "mp3"];        // + extract-audio
  if (k === "audio") return AUDIO_TARGETS.filter((t) => t !== ext);
  return [...AUDIO_TARGETS, ...VIDEO_TARGETS];                // unknown — offer everything
};

let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3600);
}

// read a File → base64 (no data: prefix), tolerant of large files
function fileToB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error("couldn't read that file"));
    r.onload = () => res(String(r.result).split(",").pop());
    r.readAsDataURL(file);
  });
}

// ==== connect (chip only — conversion does NOT require a grant) ==============================
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
  render();
})();

// ==== state (in memory — media is large, never persisted) ===================================
let file = null;          // the loaded File
let srcExt = "";          // its source extension
let target = "";          // chosen target format
let busy = false;         // converting
let err = "";             // last error
let out = null;           // { name, url, bytes } of the converted result

function reset() { file = null; srcExt = ""; target = ""; err = ""; if (out?.url) URL.revokeObjectURL(out.url); out = null; }

function loadFile(f) {
  if (!f) return;
  if (out?.url) URL.revokeObjectURL(out.url);
  file = f; srcExt = extOf(f.name); err = ""; out = null;
  const opts = targetsFor(srcExt);
  target = opts[0] || "mp3";
  render();
}

// ==== convert ===============================================================================
async function runConvert() {
  if (!file || !target || busy) return;
  busy = true; err = ""; if (out?.url) URL.revokeObjectURL(out.url); out = null; render();
  try {
    const file_b64 = await fileToB64(file);
    const body = { file_b64, ext: srcExt, to: target, name: stemOf(file.name) };
    const r = await fetch(`${GOD}/convert`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.detail || d.error || "conversion failed — is the media engine running?");
    // base64 → Blob → object URL for download
    const bin = atob(d.out_b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u8]));
    out = { name: d.filename, url, bytes: d.bytes };
    toast(`Converted → ${d.filename} (${fmtBytes(d.bytes)})`);
  } catch (e) {
    err = msg(e); toast("Convert failed", true);
  } finally {
    busy = false; render();
  }
}

// ==== render ================================================================================
function render() {
  const v = $("view"); if (!v) return;
  v.innerHTML = "";
  const work = el("div", "work");

  // engine badge (local, no cloud)
  const nob = el("div", "nobadge");
  nob.append(el("span", "dot"), el("span", null, "On-device · ffmpeg · nothing uploaded"));
  work.append(nob);

  if (!file) {
    // EMPTY — drop zone
    const drop = el("div", "drop");
    drop.append(el("div", "big", "Drop an audio or video file"));
    drop.append(el("div", "sub", "m4a · mp3 · wav · flac · mp4 · mov · webm — or click to choose"));
    const input = el("input"); input.type = "file"; input.hidden = true;
    input.accept = "audio/*,video/*," + [...AUDIO_EXT, ...VIDEO_EXT].map((e) => "." + e).join(",");
    input.addEventListener("change", () => loadFile(input.files?.[0]));
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); loadFile(e.dataTransfer?.files?.[0]); });
    work.append(drop, input);
    v.append(work);
    return;
  }

  // LOADED — file card
  const fc = el("div", "filecard");
  fc.append(el("div", "ic", srcExt || "?"));
  const meta = el("div", "meta");
  meta.append(el("div", "fn", file.name));
  meta.append(el("div", "fmeta", `${kindOf(srcExt)} · ${fmtBytes(file.size)}`));
  fc.append(meta);
  const change = el("button", "act", "Change"); change.addEventListener("click", () => { reset(); render(); });
  fc.append(change);
  work.append(fc);

  // target format chips
  const field = el("div", "field");
  field.append(el("div", "flabel", "Convert to"));
  const chips = el("div", "chips");
  for (const t of targetsFor(srcExt)) {
    const c = el("button", "fmtchip" + (t === target ? " on" : ""), t === "mp3" && kindOf(srcExt) === "video" ? "mp3 · audio" : t);
    c.addEventListener("click", () => { target = t; render(); });
    chips.append(c);
  }
  field.append(chips);
  work.append(field);

  // go row
  const go = el("div", "gorow");
  if (busy) {
    const r = el("div", "researching");
    r.append(el("span", "scan"));
    r.append(el("span", null, `Converting to ${target.toUpperCase()}… (on your machine)`));
    go.append(r);
  } else {
    const btn = el("button", "primary", `Convert to ${target.toUpperCase()}`);
    btn.addEventListener("click", runConvert);
    go.append(btn);
  }
  work.append(go);

  if (err) work.append(el("div", "err", err));

  // OUTPUT — download card
  if (out) {
    const oc = el("div", "outcard");
    const ic = el("div", "ic"); ic.textContent = "✓"; oc.append(ic);
    const om = el("div", "meta");
    om.append(el("div", "fn", out.name));
    om.append(el("div", "fmeta", `ready · ${fmtBytes(out.bytes)} · saved nothing to any server`));
    oc.append(om);
    const dl = el("a", "act", "Download"); dl.href = out.url; dl.download = out.name;
    oc.append(dl);
    work.append(oc);
    // auto-start the download so the moment of value is immediate
    try { const a = document.createElement("a"); a.href = out.url; a.download = out.name; a.click(); } catch (_) {}
  }

  v.append(work);
}

// ==== God's hands ===========================================================================
exposeToGod([
  {
    name: "convert_media",
    description: "Transcode an audio/video file to another format on-device with ffmpeg — no upload, no cloud. Give an absolute file `path` to convert a file on disk (writes the result next to it and returns out_path), or omit path to convert the file already loaded on the page. Nothing leaves the machine.",
    inputSchema: {
      to: "string — target format, e.g. 'mp3','wav','m4a','mp4','webm','gif'. Required.",
      path: "string — optional absolute path to a file on disk. If omitted, converts the file loaded on the page.",
    },
    execute: async ({ to, path } = {}) => {
      const tgt = String(to || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!tgt) throw new Error("pass { to } — the target format, e.g. 'mp3'");
      // on-disk path flow (God converting a named file)
      if (path && String(path).trim()) {
        const r = await fetch(`${GOD}/convert`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: String(path).trim(), to: tgt }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.detail || d.error || "conversion failed");
        return { ok: true, filename: d.filename, out_path: d.out_path, bytes: d.bytes };
      }
      // page-file flow (convert the loaded file, then offer the download)
      if (!file) throw new Error("no file loaded — pass { path } or drop a file on the page first");
      target = tgt;
      await runConvert();
      if (err) throw new Error(err);
      if (!out) throw new Error("conversion produced no output");
      return { ok: true, filename: out.name, bytes: out.bytes };
    },
  },
]);
