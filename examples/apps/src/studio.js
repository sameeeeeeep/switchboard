// Studio — product shots without the studio. Drop one product photo, pick a scene, and the
// visitor's OWN Claude drives the visitor's OWN Higgsfield to do the shoot. The product stays
// exactly itself (same label, same shape) — nano_banana_pro takes the photo as an identity
// reference. Studio ships zero keys and zero backend; one generation = one consent.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const SHEET_KEY = "studio:sheet";
const PRODUCT_KEY = "studio:product";
const SETUP_KEY = "studio:setup";

let relay = null;
let installed = null; // null = probing, false = extension missing, true = present
let shooting = false;
let stopFlag = false;
let product = null;   // { dataUrl, name, sample }
let lastShot = null;  // { scene, aspect } — powers the Retry button

// ---------- scenes ----------
const SCENES = [
  { prompt: "on a marble counter, soft morning window light", rec: true },
  { prompt: "held in hand on a city street, shallow depth of field" },
  { prompt: "floating on a seamless pastel gradient, hard shadow" },
  { prompt: "on a picnic table, golden hour, linen + fruit" },
  { prompt: "editorial flat-lay, magazine style, top-down" },
];
const ASPECTS = ["1:1", "4:5", "9:16", "16:9"];
const setup = { scene: 0, steer: "", aspect: "1:1" }; // scene: index into SCENES, -1 = free-text only

// ---------- persistence ----------
const loadJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const saveJson = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota — skip */ } };
const loadSheet = () => loadJson(SHEET_KEY, []);
const saveSheet = (s) => saveJson(SHEET_KEY, s.slice(0, 48));
const saveSetup = () => saveJson(SETUP_KEY, setup);

// ---------- the embedded sample product (amber glass dropper bottle, "GLOW") ----------
// An inline SVG data-URL so the whole flow is testable without uploading anything.
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

// ---------- utils (copied from the cast/gen.js idiom) ----------
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
  onConnect: (r) => { relay = r; reflect(); },
  onDisconnect: () => { relay = null; reflect(); },
});
// Fast probe so a returning user's grant enables Shoot without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  installed = !!(r && "connect" in r);
  if (installed) {
    const grant = await r.permissions().catch(() => null);
    if (grant) relay = r;
  }
  reflect();
})();

function reflect() {
  $("shoot").disabled = !relay || !product || shooting;
  const hint = $("conn-hint");
  if (shooting) hint.textContent = "shooting…";
  else if (installed === false) hint.innerHTML = `needs the Switchboard extension — <a href="${INSTALL_URL}" target="_blank" rel="noopener">get it here</a>, it's your key that does the work`;
  else if (!relay) hint.innerHTML = "connect Switchboard (top right) to run the shoot on <b>your</b> Higgsfield";
  else if (!product) hint.textContent = "add a product photo — or load the sample bottle";
  else hint.innerHTML = "ready — shoots on <b>your</b> Higgsfield, the operator pays nothing";
}

// ---------- 01 · the product ----------
function setProduct(p, { persist = true } = {}) {
  product = p;
  $("drop-empty").hidden = !!p;
  $("prod-preview").hidden = !p;
  if (p) { $("prod-img").src = p.dataUrl; $("prod-name").textContent = p.name; }
  if (persist) {
    if (p) saveJson(PRODUCT_KEY, p); // best-effort; big photos may not fit — saveJson swallows quota errors
    else { try { localStorage.removeItem(PRODUCT_KEY); } catch { /* ignore */ } }
  }
  reflect();
}

async function acceptFile(file) {
  if (!file || !/^image\//.test(file.type)) { logLine("that file isn't an image — PNG, JPG or WebP please.", "bad"); return; }
  const raw = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const dataUrl = await downscale(raw);
  setProduct({ dataUrl, name: file.name.slice(0, 40) || "product.png", sample: false });
}

$("file").addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); e.target.value = ""; });
$("drop").addEventListener("click", (e) => { if (e.target.closest("button")) return; $("file").click(); });
$("drop").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
$("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", (e) => {
  e.preventDefault(); $("drop").classList.remove("over");
  const f = e.dataTransfer?.files?.[0]; if (f) acceptFile(f);
});
$("prod-replace").addEventListener("click", () => $("file").click());
$("prod-remove").addEventListener("click", () => setProduct(null));
$("sample-btn").addEventListener("click", async (e) => {
  e.stopPropagation();
  const dataUrl = await downscale(SAMPLE_DATA_URL); // rasterize the SVG to a real PNG dataURL
  setProduct({ dataUrl, name: "glow-sample.png", sample: true });
});

// ---------- 02 · the scene ----------
function renderChips() {
  const mount = $("chips");
  mount.textContent = "";
  SCENES.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "scn" + (i === setup.scene ? " on" : "");
    b.textContent = s.prompt;
    if (s.rec) { const tag = document.createElement("span"); tag.className = "pick"; tag.textContent = "our pick"; b.append(tag); }
    b.addEventListener("click", () => {
      setup.scene = setup.scene === i ? -1 : i; // click again to deselect and go pure free-text
      renderChips(); saveSetup(); updateBrief();
    });
    mount.append(b);
  });
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
  return parts.join(", ") || SCENES[0].prompt; // never a blank brief
}
function updateBrief() {
  const b = $("brief");
  b.textContent = "";
  b.append("the brief — keep this exact product, unchanged label and shape, place it in: ");
  const strong = document.createElement("b");
  strong.textContent = currentScene();
  b.append(strong, ` · ${setup.aspect}`);
}
$("steer").addEventListener("input", () => { setup.steer = $("steer").value; saveSetup(); updateBrief(); });
$("steer").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("shoot").disabled) $("shoot").click(); });

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
// The proven refInstruction dance: media_upload → put_blob(handle) → media_confirm ⇒ media_id,
// then generate_image (nano_banana_pro) with the confirmed media as an "image" role reference.
function shootInstruction(scene, aspect) {
  return (
    `Shoot ONE professional product photograph using Higgsfield. ` +
    `A reference image of the product is attached with handle "product".\n` +
    `Steps, in order:\n` +
    `1) media_upload({filename:"product.png", content_type:"image/png"}) → relay put_blob({handle:"product", url:<uploadUrl>}) → media_confirm ⇒ media_id\n` +
    `2) Call the Higgsfield generate_image tool with model "nano_banana_pro", aspect_ratio "${aspect}", medias [{role:"image", value: media_id}], and this exact prompt:\n` +
    `"keep this exact product, unchanged label and shape, place it in: ${scene}"\n` +
    `3) Poll until the generation is done, then reply with ONLY the final image URL on its own line.`
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
    const attachments = [{ handle: "product", filename: "product.png", contentType: "image/png", dataUrl: product.dataUrl }];
    for await (const d of relay.stream({ prompt: shootInstruction(scene, aspect), agentic: true, attachments })) {
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
    if (!url) throw new Error("the shoot finished without an image URL — Retry usually lands it on the second frame");
    addShot({ id: "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url, caption: scene, aspect, at: Date.now() });
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
  if (!product) { logLine("add a product photo (or the sample bottle) first.", "bad"); return; }
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
    const cap = document.createElement("div"); cap.className = "cap"; cap.textContent = s.caption;
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = `${s.aspect} · ${new Date(s.at).toLocaleDateString()}`;
    const btns = document.createElement("div"); btns.className = "btns";
    const re = document.createElement("button");
    re.type = "button"; re.className = "sbtn re"; re.textContent = "↺ reshoot";
    re.addEventListener("click", () => {
      if (!relay) { logLine("connect Switchboard (top right) to reshoot.", "bad"); return; }
      if (!product) { logLine("add a product photo (or the sample bottle) to reshoot.", "bad"); return; }
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
    if (Number.isInteger(savedSetup.scene) && savedSetup.scene >= -1 && savedSetup.scene < SCENES.length) setup.scene = savedSetup.scene;
    if (typeof savedSetup.steer === "string") setup.steer = savedSetup.steer.slice(0, 200);
    if (ASPECTS.includes(savedSetup.aspect)) setup.aspect = savedSetup.aspect;
  }
  $("steer").value = setup.steer;
  renderChips();
  renderAspects();
  updateBrief();
  const savedProduct = loadJson(PRODUCT_KEY, null);
  if (savedProduct && typeof savedProduct.dataUrl === "string" && savedProduct.dataUrl.startsWith("data:image/")) {
    setProduct({ dataUrl: savedProduct.dataUrl, name: savedProduct.name || "product.png", sample: !!savedProduct.sample }, { persist: false });
  }
  renderSheet();
  reflect();
})();
