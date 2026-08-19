// FAVICON — a NON-AI widget. Drop an image, get the full set of site/app icons (16·32·48·64·180·192·512)
// as PNGs, plus a multi-size favicon.ico (16+32+48 packed in one file) — entirely IN THE TAB. No model,
// no cloud round-trip, no upload, no cost. The bytes never leave the browser process. Same doctrine as
// resize.js / qr.js: single input, one primary action, house design system, instantly re-derivable.
//
// The resizing is the same step-halving high-quality downscale resize.js uses (inlined — L0 tier, zero
// libraries). The one genuinely-new piece — packing the PNGs into a valid .ico container — lives factored
// out in kit/favicon.js and is tested headlessly against the format spec.
//
// It still mounts the connect chip for IDENTITY consistency — but the whole pipeline runs BEFORE and
// WITHOUT any connection. `scope.models` is empty and there is not a single relay.stream()/complete()
// call in this file: that IS the proof it never touches an LLM.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
// The pure ICO packer + default size set (headless-tested in kit/favicon.test.mjs).
import { buildIco, faviconSizes } from "./kit/favicon.js";

// ==== CONFIG ================================================================================
const APP = {
  id: "favicon",
  name: "Favicon",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Favicon — generates site/app icons + a multi-size .ico entirely on your device. No AI, no cost.",
    models: [],   // ← NON-AI: never requests a model. This emptiness is load-bearing.
    tools: [],
  },
  usesContext: null,
};

// The sizes we render as individual PNGs, and the subset packed into the .ico (the three classic
// favicon dimensions Windows/browsers expect in one file).
const SIZES = faviconSizes();          // [16,32,48,64,180,192,512]
const ICO_SIZES = [16, 32, 48];
// A friendly note per size — what each icon is actually FOR, so the grid reads as a checklist not a
// pile of squares.
const SIZE_HINT = {
  16: "browser tab", 32: "taskbar / retina tab", 48: "Windows", 64: "high-DPI",
  180: "apple-touch-icon", 192: "Android / PWA", 512: "PWA splash",
};

// ==== dom + helpers =========================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const msg = (e) => String(e?.message || e).slice(0, 160);
function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3200);
}

// ==== connect (identity only — the tool works with NO connection) ===========================
let relay = null;
let notInstalled = false;
mountConnect($("chip-dock"), {
  scope: APP.scope,
  context: APP.usesContext,
  installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; },
  onDisconnect: () => { relay = null; },
});
(async () => {
  const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; }
  else if (r && r.installed === false) notInstalled = true;
})();

// ==== APP LOGIC — the pure in-tab favicon pipeline ═══════════════════════════════════════════
// Everything here is deterministic <canvas> work. No fetch (except decoding a data: URL, which is a
// pure in-memory decode), no stream, no model.

// Loaded source image, kept as an ImageBitmap (decoded once, reused across every target size).
let source = null;   // { bitmap, name, bytes, w, h }
let icons = null;    // [{ size, canvas, blob, url, bytes }]  — one per SIZES entry
let building = false;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}
function canvasToBlob(canvas, mime, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: mime, quality });  // OffscreenCanvas
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), mime, quality));
}

/** High-quality downscale WITHOUT pica: step-halve until within 2× of target, then a gentle final
 *  shrink — the same trick resize.js uses, inlined here. A favicon is a SQUARE, so we cover-crop the
 *  source to its centre square first (no squashed logos), then draw into an exactly size×size canvas.
 *  L0 tier: zero external libraries. */
function drawIcon(bitmap, size) {
  // centre-square crop of the source
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  // work on a square canvas we can step-halve
  let cur = makeCanvas(side, side);
  { const c = cur.getContext("2d"); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.drawImage(bitmap, sx, sy, side, side, 0, 0, side, side); }
  let curSide = side;
  while (curSide > size * 2) {
    const nSide = Math.max(size, Math.floor(curSide / 2));
    const tmp = makeCanvas(nSide, nSide);
    const c = tmp.getContext("2d");
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
    c.drawImage(cur, 0, 0, nSide, nSide);
    cur = tmp; curSide = nSide;
  }
  const out = makeCanvas(size, size);
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "high";
  octx.drawImage(cur, 0, 0, size, size);   // PNG keeps alpha — no white flatten
  return out;
}

/** Render one PNG per SIZES entry from the source bitmap. Pure, awaitable, model-free. */
async function buildIcons(bitmap) {
  const out = [];
  for (const size of SIZES) {
    const canvas = drawIcon(bitmap, size);
    const blob = await canvasToBlob(canvas, "image/png");
    out.push({ size, canvas, blob, bytes: blob.size });
  }
  return out;
}

async function loadFile(file) {
  if (!file || !/^image\//.test(file.type || "")) { toast("Drop an image file (PNG, JPEG, WebP, SVG…).", true); return; }
  try {
    const bitmap = await createImageBitmap(file);
    source = { bitmap, name: file.name || "image", bytes: file.size, w: bitmap.width, h: bitmap.height };
    icons = null;
    render();
    await run();
  } catch (e) { toast("Couldn't decode that image — " + msg(e), true); }
}

async function run() {
  if (!source || building) return;
  building = true; render();
  try {
    if (icons) for (const it of icons) if (it.url) URL.revokeObjectURL(it.url);
    const built = await buildIcons(source.bitmap);
    for (const it of built) it.url = URL.createObjectURL(it.blob);
    icons = built;
  } catch (e) { toast("Couldn't build icons — " + msg(e), true); icons = null; }
  finally { building = false; render(); }
}

// ── downloads ────────────────────────────────────────────────────────────────────────────
function baseName() { return (source?.name || "icon").replace(/\.[^.]+$/, ""); }
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadPng(icon) {
  if (!icon?.blob) return;
  saveBlob(icon.blob, `${baseName()}-${icon.size}x${icon.size}.png`);
}

/** Get the raw PNG bytes for one canvas: toBlob → arrayBuffer → Uint8Array (no re-encode). */
async function pngBytes(canvas) {
  const blob = await canvasToBlob(canvas, "image/png");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Assemble the 16/32/48 PNGs into a single multi-size favicon.ico and download it. */
async function downloadIco() {
  if (!icons) return;
  try {
    const picks = ICO_SIZES.map((s) => icons.find((it) => it.size === s)).filter(Boolean);
    const packed = [];
    for (const it of picks) packed.push({ size: it.size, png: await pngBytes(it.canvas) });
    const bytes = buildIco(packed);
    saveBlob(new Blob([bytes], { type: "image/x-icon" }), "favicon.ico");
    toast(`favicon.ico · ${ICO_SIZES.join(" + ")}px packed ✓`);
  } catch (e) { toast("Couldn't build .ico — " + msg(e), true); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = !!source;
  view.textContent = "";

  if (!source) { view.append(dropZone(), badge()); return; }

  const wrap = el("div", "work");

  // top bar — file + reset
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "image"), el("span", "run-input", `${source.name} · ${source.w}×${source.h} · ${fmtBytes(source.bytes)}`), el("span", "grow"));
  const swap = el("button", "act", "× new"); swap.onclick = () => { source = null; icons = null; render(); };
  bar.append(swap);
  wrap.append(bar);

  if (source.w < 64 || source.h < 64) {
    wrap.append(el("div", "hintbar", `Heads up — a ${source.w}×${source.h} source will look soft at the larger sizes. 512×512 or bigger gives the crispest icons.`));
  }

  const out = el("div", "outcard");
  if (building && !icons) out.append(researching("rendering icons…"));
  else if (icons) {
    // preview grid — every size, largest visual first so the eye lands on the crisp one
    const grid = el("div", "grid");
    for (const it of icons) {
      const cell = el("div", "cell");
      const frame = el("div", "frame");
      const img = el("img", "ic"); img.src = it.url; img.alt = `${it.size}px icon`;
      // clamp the on-screen size so 512 doesn't dwarf 16 — but never upscale past its real px
      const shown = Math.min(it.size, 72);
      img.style.width = shown + "px"; img.style.height = shown + "px";
      frame.append(img);
      const meta = el("div", "cmeta");
      meta.append(el("div", "csize", `${it.size}×${it.size}`), el("div", "cwhat", SIZE_HINT[it.size] || ""));
      const dl = el("button", "act cdl", "PNG ⬇"); dl.onclick = () => downloadPng(it);
      cell.append(frame, meta, dl);
      grid.append(cell);
    }
    out.append(grid);

    // primary: the one .ico that bundles 16/32/48
    const actions = el("div", "actions");
    const ico = el("button", "primary", "Download favicon.ico ⬇"); ico.onclick = () => downloadIco();
    const note = el("span", "anote", `one file · ${ICO_SIZES.join(" + ")}px inside`);
    actions.append(ico, note);
    out.append(actions);
  }
  wrap.append(out);
  view.append(wrap);
}

function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }

function dropZone() {
  const dz = el("div", "drop");
  dz.append(el("div", "drop-ic", "🎯"), el("div", "drop-t", "Drop an image here"), el("div", "drop-s", "or click to choose · PNG · JPEG · WebP · SVG · a square source works best"));
  const input = el("input"); input.type = "file"; input.accept = "image/*"; input.className = "file-in";
  input.onchange = () => { if (input.files?.[0]) void loadFile(input.files[0]); };
  dz.append(input);
  dz.onclick = () => input.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) void loadFile(f); };
  return dz;
}
function badge() {
  const b = el("div", "nobadge");
  b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost"));
  return b;
}
render();

// ---- God's hand: one page-tool, driving the real pipeline, still ZERO model ------------------------
// `make_favicons` takes a data: URL (like resize's God tool), runs the SAME canvas pipeline a click
// runs, and returns every PNG as a data: URL plus the packed favicon.ico as a data: URL. No inference.
exposeToGod({
  name: "make_favicons",
  description: "Turn one image into a full set of site/app icons (16·32·48·64·180·192·512 PNGs) plus a "
    + "multi-size favicon.ico (16+32+48), entirely on-device (no AI). Give a data: URL; returns each "
    + "size as a data: URL and the .ico as a data: URL.",
  inputSchema: {
    dataUrl: "string — the source image as a data: URL (or bare base64). Required. A square image works best.",
  },
  execute: async (input = {}) => {
    const raw = String(input.dataUrl || "").trim();
    if (!raw) throw new Error("nothing to convert — pass { dataUrl }");
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/*;base64,${raw}`;
    const resp = await fetch(dataUrl);   // fetch of a data: URL is a pure in-memory decode, no network
    const bitmap = await createImageBitmap(await resp.blob());
    const built = await buildIcons(bitmap);
    // drive the visible UI so a watching God webview sees it
    source = { bitmap, name: "icon", bytes: 0, w: bitmap.width, h: bitmap.height };
    if (icons) for (const it of icons) if (it.url) URL.revokeObjectURL(it.url);
    for (const it of built) it.url = URL.createObjectURL(it.blob);
    icons = built;
    try { render(); } catch { /* headless */ }

    const toDataUrl = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    const sizes = [];
    for (const it of built) sizes.push({ size: it.size, dataUrl: await toDataUrl(it.blob), bytes: it.bytes });
    const packed = [];
    for (const s of ICO_SIZES) { const it = built.find((x) => x.size === s); if (it) packed.push({ size: s, png: await pngBytes(it.canvas) }); }
    const icoBytes = buildIco(packed);
    const icoUrl = await toDataUrl(new Blob([icoBytes], { type: "image/x-icon" }));
    return { sizes, ico: icoUrl, icoBytes: icoBytes.length };
  },
});

// ---- The GLANCE: an `image` widget (docs/WIDGETS.md §5) — the 32px icon, drag-out ready -------------
// Accepts what the notch launcher hands over (a dropped file / data: URL), builds the icon set on-device
// and returns the 32px favicon as a drag-out PNG. With nothing to convert it shows a prompt state.
exposeWidget(async (input) => {
  const raw = String((input && (input.dataUrl || input.text || input.url)) || "").trim();
  if (!raw) {
    return {
      kicker: "FAVICON · ON YOUR DEVICE", title: "Drop an image",
      openLabel: "Open Favicon", shape: "text",
      result: { body: "Give me an image and I'll cut a full set of site/app icons — plus a favicon.ico — on your device.", caption: "no AI · on your device" },
    };
  }
  try {
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/*;base64,${raw}`;
    const resp = await fetch(dataUrl);
    const bitmap = await createImageBitmap(await resp.blob());
    const canvas = drawIcon(bitmap, 32);
    const blob = await canvasToBlob(canvas, "image/png");
    const outUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    return {
      kicker: "FAVICON · ON YOUR DEVICE", title: "Icons ready", openLabel: "Open Favicon", shape: "image",
      result: {
        caption: `${SIZES.length} sizes + favicon.ico · no AI`,
        file: { name: "favicon-32x32.png", dataUrl: outUrl, bytes: blob.size },
      },
      file: { name: "favicon-32x32.png", dataUrl: outUrl, bytes: blob.size },
    };
  } catch (e) {
    return {
      kicker: "FAVICON", title: "Couldn't read that image", openLabel: "Open Favicon", shape: "text",
      result: { body: msg(e) + " — try a PNG, JPEG, WebP or SVG.", caption: "no AI · on your device" },
    };
  }
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
try { (typeof window !== "undefined" ? window : globalThis).__faviconTest = { buildIcons, drawIcon, buildIco, SIZES, ICO_SIZES }; } catch { /* ignore */ }
