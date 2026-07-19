// RECORDER — the first shared wrapp-kit element (see .claude/skills/wrapp/SKILL.md, Compose).
// Deterministic, prompt-free browser capture: screen or camera + mic → an in-page take with live
// preview, timer, auto-stop at maxSeconds, re-take, download. No model calls, no daemon, nothing
// leaves the machine — the AI work (scripts, edits) belongs to the wrapp composing this element.
// Styles itself once with house tokens so any wrapp page can mount it.
//
//   const rec = mountRecorder(hostEl, { mode: "screen"|"camera", maxSeconds, fileName, hint, onDone });
//   rec.destroy();   // stops tracks, removes UI
//
// IMPORTANT for composing wrapps: keep the host element STABLE across re-renders (cache it and
// re-append the same node) — a full re-create mid-recording would kill the stream.

const STYLE_ID = "__wrapp_kit_recorder";
const CSS = `
.rec { border: 1px solid var(--edge); background: var(--inset); border-radius: 14px; padding: 13px 14px; }
.rec video { width: 100%; max-height: 340px; border-radius: 10px; background: #000; display: block; }
.rec .rec-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.rec .rec-btn { display: inline-flex; align-items: center; gap: 7px; font: 600 12.5px/1 var(--sans); background: var(--accent); color: var(--page); border: 0; border-radius: 10px; padding: 10px 15px; cursor: pointer; }
.rec .rec-btn.stop { background: var(--danger); color: #fff; }
.rec .rec-ghost { font: 500 11.5px/1 var(--mono); background: none; border: 1px solid var(--edge); border-radius: 999px; color: var(--ink-sec); padding: 8px 12px; cursor: pointer; }
.rec .rec-ghost:hover { border-color: var(--accent); color: var(--ink); }
.rec .rec-time { font: 500 12px/1 var(--mono); color: var(--ink-sec); display: inline-flex; align-items: center; gap: 6px; }
.rec .rec-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); animation: recblink 1.1s steps(2) infinite; }
@keyframes recblink { 50% { opacity: .2; } }
.rec .rec-hint { font: 400 11.5px/1.6 var(--mono); color: var(--ink-faint); margin-top: 8px; }
.rec .rec-err { color: var(--danger); font: 400 12px/1.6 var(--mono); margin-top: 8px; }
`;

export function mountRecorder(host, opts = {}) {
  const mode = opts.mode === "camera" ? "camera" : "screen";
  const maxSeconds = Number(opts.maxSeconds) > 0 ? Number(opts.maxSeconds) : 180;
  const fileName = opts.fileName || "take.webm";

  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

  const root = el("div", "rec");
  host.append(root);

  let stream = null, recorder = null, chunks = [], url = null, timerI = null, startedAt = 0;

  function stopTracks() { if (stream) for (const t of stream.getTracks()) t.stop(); stream = null; }
  function cleanup() {
    if (timerI) clearInterval(timerI); timerI = null;
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch { /* already */ }
    recorder = null;
    stopTracks();
  }

  function renderIdle(err) {
    root.textContent = "";
    const row = el("div", "rec-row");
    const go = el("button", "rec-btn", mode === "camera" ? "● Record camera" : "● Record screen");
    go.onclick = begin;
    row.append(go, el("span", "rec-time", "up to " + fmt(maxSeconds)));
    root.append(row);
    if (opts.hint) root.append(el("div", "rec-hint", opts.hint));
    root.append(el("div", "rec-hint", "Recorded locally in your browser — nothing uploads anywhere."));
    if (err) root.append(el("div", "rec-err", err));
  }

  function renderLive() {
    root.textContent = "";
    const v = el("video");
    v.muted = true; v.autoplay = true; v.playsInline = true;
    v.srcObject = stream;
    if (mode === "camera") v.style.transform = "scaleX(-1)";
    root.append(v);
    const row = el("div", "rec-row");
    const stopB = el("button", "rec-btn stop", "■ Stop");
    stopB.onclick = stop;
    const time = el("span", "rec-time");
    time.append(el("span", "rec-dot"), el("span", null, "0:00 / " + fmt(maxSeconds)));
    row.append(stopB, time);
    root.append(row);
  }

  function renderDone() {
    root.textContent = "";
    const v = el("video");
    v.controls = true; v.src = url; v.playsInline = true;
    root.append(v);
    const row = el("div", "rec-row");
    const dl = el("button", "rec-btn", "⬇ Download");
    dl.onclick = () => { const a = document.createElement("a"); a.href = url; a.download = fileName; a.click(); };
    const again = el("button", "rec-ghost", "⟲ re-take");
    again.onclick = begin;
    row.append(dl, again);
    root.append(row);
  }

  async function begin() {
    cleanup();
    chunks = [];
    if (url) { URL.revokeObjectURL(url); url = null; }
    try {
      if (mode === "camera") {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: true });
      } else {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        let mic = null;
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /* silent take is fine */ }
        stream = new MediaStream([...display.getVideoTracks(), ...(mic ? mic.getAudioTracks() : [])]);
        // user can end the share from the browser's own chrome — treat it as Stop, not an error
        display.getVideoTracks()[0].addEventListener("ended", stop);
      }
    } catch (e) {
      renderIdle(e && e.name === "NotAllowedError" ? "capture permission declined — try again when ready" : String(e?.message || e).slice(0, 120));
      return;
    }
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      url = URL.createObjectURL(blob);
      stopTracks();
      renderDone();
      if (opts.onDone) opts.onDone(blob, url);
    };
    recorder.start(250);
    startedAt = Date.now();
    renderLive();
    timerI = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      const t = root.querySelector(".rec-time span:last-child");
      if (t) t.textContent = fmt(s) + " / " + fmt(maxSeconds);
      if (s >= maxSeconds) stop();
    }, 250);
  }

  function stop() {
    if (timerI) clearInterval(timerI); timerI = null;
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch { /* already stopped */ }
  }

  renderIdle();
  return {
    destroy() { cleanup(); if (url) URL.revokeObjectURL(url); root.remove(); },
  };
}
