// CAPTURE — shared wrapp-kit element that renders a SCENE LIST onto a canvas and records it to a
// .webm via canvas.captureStream() + MediaRecorder. Deterministic, prompt-free, no daemon, no deps,
// nothing uploads — the pure-browser "sections → video" primitive (the mp4-export half of the
// recorder family; shares its MediaRecorder core). A wrapp supplies the scenes (title + subtitle +
// optional image url + seconds); Claude/Higgsfield work belongs to the wrapp, not here.
//
//   const blob = await renderScenesToVideo(scenes, { width, height, fps, onProgress });
//   // scenes: [{ title, subtitle?, imageUrl?, bg?, seconds? }]
//   // returns a webm Blob (download it, or hand to the wrapp)

const HOUSE = { page: "#0A0C10", ink: "#E8EDF4", sub: "#B4BECE", accent: "#C8F250" };

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous"; // presigned Higgsfield URLs are CORS-open; taint-free canvas keeps captureStream legal
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a dead image just yields a text-only scene, never a crash
    img.src = url;
  });
}

// draw one frame: cover-fit image (dimmed) + title/subtitle, with a fade at scene edges
function drawFrame(ctx, W, H, scene, img, t, dur) {
  ctx.fillStyle = scene.bg || HOUSE.page;
  ctx.fillRect(0, 0, W, H);
  if (img) {
    const s = Math.max(W / img.width, H / img.height);
    const iw = img.width * s, ih = img.height * s;
    ctx.globalAlpha = 1;
    ctx.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "rgba(10,12,16,.35)"); grd.addColorStop(1, "rgba(10,12,16,.85)");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  }
  const fade = Math.min(1, t / 0.5, (dur - t) / 0.5); // 0.5s in/out
  ctx.globalAlpha = Math.max(0, fade);
  ctx.textAlign = "left";
  const pad = Math.round(W * 0.07);
  ctx.fillStyle = HOUSE.accent;
  ctx.font = `500 ${Math.round(H * 0.028)}px "Spline Sans Mono", monospace`;
  ctx.fillText("●", pad, H - Math.round(H * 0.30));
  ctx.fillStyle = HOUSE.ink;
  ctx.font = `700 ${Math.round(H * 0.075)}px "Bricolage Grotesque", system-ui, sans-serif`;
  wrapText(ctx, scene.title || "", pad, H - Math.round(H * 0.22), W - pad * 2, Math.round(H * 0.085));
  if (scene.subtitle) {
    ctx.fillStyle = HOUSE.sub;
    ctx.font = `400 ${Math.round(H * 0.033)}px "Hanken Grotesk", system-ui, sans-serif`;
    wrapText(ctx, scene.subtitle, pad, H - Math.round(H * 0.11), W - pad * 2, Math.round(H * 0.045));
  }
  ctx.globalAlpha = 1;
}
function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(/\s+/);
  let line = "", yy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lineH; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}

export async function renderScenesToVideo(scenes, opts = {}) {
  const W = opts.width || 1280, H = opts.height || 720, fps = opts.fps || 30;
  const list = (scenes || []).filter(Boolean);
  if (!list.length) throw new Error("no scenes to render");
  const imgs = await Promise.all(list.map((s) => loadImage(s.imageUrl)));

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  // captureStream(0) = MANUAL frames via track.requestFrame(); we drive the clock ourselves so the
  // render is deterministic (frame-count based, not wall-clock) and CANNOT hang when the tab is
  // backgrounded — requestAnimationFrame pauses in a hidden tab, setInterval does not.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const mime = window.MediaRecorder && MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" })); });
  rec.start();

  // flatten to a fixed frame plan: each scene contributes round(seconds*fps) frames
  const plan = [];
  list.forEach((sc, i) => { const n = Math.max(1, Math.round((sc.seconds || 3) * fps)); for (let f = 0; f < n; f++) plan.push({ i, t: (f / fps), dur: n / fps }); });
  const totalFrames = plan.length;

  await new Promise((resolve) => {
    let k = 0;
    const iv = setInterval(() => {
      if (k >= totalFrames) { clearInterval(iv); return resolve(); }
      const fr = plan[k];
      drawFrame(ctx, W, H, list[fr.i], imgs[fr.i], fr.t, fr.dur);
      try { track.requestFrame && track.requestFrame(); } catch { /* older API: captureStream samples on paint */ }
      if (opts.onProgress) opts.onProgress((k + 1) / totalFrames);
      k++;
    }, Math.max(8, Math.round(1000 / fps)));
  });

  rec.stop();
  for (const tr of stream.getTracks()) tr.stop();
  return await done;
}
