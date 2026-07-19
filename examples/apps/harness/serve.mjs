// Wrapp TEST-HARNESS server. Serves every wrapp with a mock window.claude injected BEFORE its
// module script, seeded with one of two "projects" (switchboard | nailinit). Routes:
//   /                      → harness index (all wrapps × both projects)
//   /h/<wrapp>?project=ID  → the wrapp, provider injected + project lent (headless auto-boot)
//   /harness/provider.js   → the mock provider (classic script)
//   /img/<proj>/<WxH>/*.png→ a real branded placeholder PNG (offline-safe, ends .png)
//   everything else        → static from the apps root (dist/, app.css, *.html raw, …)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { PROJECTS, PROJECT_IDS } from "./projects.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, ".."); // examples/apps
const PORT = Number(process.env.PORT ?? 5188);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

// The wrapps under test (id → html file). Cast/persona uses its OWN ?harness, handled separately.
const WRAPPS = [
  { id: "adforge", html: "adforge.html", cat: "founder-stack" },
  { id: "adgen", html: "adgen.html", cat: "founder-stack", name: "Adwall" },
  { id: "adpulse", html: "adpulse.html", cat: "founder-stack" },
  { id: "aplus", html: "aplus.html", cat: "founder-stack" },
  { id: "imagegen", html: "imagegen.html", cat: "founder-stack", name: "Prism" },
  { id: "shelf", html: "shelf.html", cat: "founder-stack" },
  { id: "studio", html: "studio.html", cat: "founder-stack" },
  { id: "reel", html: "reel.html", cat: "founder-stack" },
  { id: "marquee", html: "marquee.html", cat: "founder-stack" },
  { id: "take", html: "take.html", cat: "founder-stack" },
  { id: "identity", html: "identity.html", cat: "founder-stack" },
  { id: "batch", html: "batch.html", cat: "founder-stack" },
  { id: "bank", html: "bank.html", cat: "founder-stack" },
  { id: "redline", html: "redline.html", cat: "founder-stack" },
  { id: "huddle", html: "huddle.html", cat: "chat" },
  { id: "chat", html: "chat.html", cat: "chat", name: "betterchat" },
  { id: "cartridge", html: "cartridge.html", cat: "play-make" },
  { id: "arcana", html: "arcana.html", cat: "after-hours" },
  { id: "natal", html: "natal.html", cat: "after-hours" },
  // the viral drop (2026-07)
  { id: "arcade", html: "arcade.html", cat: "viral" },
  { id: "yearbook", html: "yearbook.html", cat: "viral" },
  { id: "toon", html: "toon.html", cat: "viral" },
  { id: "storybook", html: "storybook.html", cat: "viral" },
  { id: "petrait", html: "petrait.html", cat: "viral" },
  { id: "emote", html: "emote.html", cat: "viral" },
  { id: "inkling", html: "inkling.html", cat: "viral" },
  { id: "roomify", html: "roomify.html", cat: "viral" },
  { id: "thumbs", html: "thumbs.html", cat: "viral" },
  { id: "meme", html: "meme.html", cat: "viral" },
  { id: "roast", html: "roast.html", cat: "viral" },
  { id: "rizz", html: "rizz.html", cat: "viral" },
  { id: "anthem", html: "anthem.html", cat: "viral" },
  { id: "dreamlog", html: "dreamlog.html", cat: "viral" },
];

const HARNESS_JSON = JSON.stringify(PROJECTS);

// ---- injection ------------------------------------------------------------------------------
function injectHarness(html, projectId) {
  const head =
    `\n<base href="/">\n` +
    `<script>window.__HARNESS__=${JSON.stringify({ projectId, projects: PROJECTS, port: PORT })};</script>\n` +
    `<script src="/harness/provider.js"></script>\n`;
  // insert right after <head...> (before any other head content / module scripts)
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + head);
  return head + html; // no <head>? prepend
}

// ---- placeholder PNG (two-band, brand-coloured) ---------------------------------------------
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function hexToRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return [90, 140, 255]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function makePng(w, h, top, bot) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 3 + 1); raw[rowStart] = 0; // filter none
    const c = y < h * 0.62 ? top : bot;
    for (let x = 0; x < w; x++) { const p = rowStart + 1 + x * 3; raw[p] = c[0]; raw[p + 1] = c[1]; raw[p + 2] = c[2]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit, RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const pngCache = new Map();
function placeholderPng(projectId, w, h) {
  const key = `${projectId}:${w}x${h}`;
  if (pngCache.has(key)) return pngCache.get(key);
  const pal = (PROJECTS[projectId]?.brand?.data?.palette) || ["#5B8CFF", "#0B0B0F"];
  const png = makePng(w, h, hexToRgb(pal[1] || pal[0]), hexToRgb(pal[0]));
  pngCache.set(key, png); return png;
}

// ---- index page -----------------------------------------------------------------------------
function indexPage() {
  const rows = WRAPPS.map((w) => {
    const cells = PROJECT_IDS.map((p) => `<a class="run" href="/h/${w.id}?project=${p}">▶ ${p}</a>`).join(" ");
    return `<tr><td><b>${w.name || w.id}</b><span class="cat">${w.cat}</span></td><td>${cells}</td><td><a class="src" href="/${w.html}" target="_blank">raw</a></td></tr>`;
  }).join("");
  const cast = PROJECT_IDS.map(() => `<a class="run" href="/persona.html?harness">▶ cast harness</a>`)[0];
  return `<!doctype html><meta charset=utf-8><title>Wrapp Test Harness</title><style>
  body{font:14px/1.5 system-ui;margin:0;background:#0b0b0f;color:#e8e8f0;padding:32px}
  h1{font-size:20px}.sub{color:#8a8aa0;margin-bottom:20px}
  table{border-collapse:collapse;width:100%;max-width:760px}td{padding:8px 10px;border-bottom:1px solid #23232e}
  .cat{color:#6a6a80;font-size:11px;margin-left:8px}
  a.run{display:inline-block;background:#1a1a24;border:1px solid #33334a;color:#8fb0ff;padding:3px 9px;border-radius:6px;text-decoration:none;margin-right:4px}
  a.run:hover{background:#252534}a.src{color:#6a6a80}
  </style><h1>Wrapp Test Harness</h1><div class=sub>${WRAPPS.length} wrapps × ${PROJECT_IDS.length} projects (${PROJECT_IDS.join(", ")}). Each link boots the wrapp headless with a mock window.claude and the project lent as context.</div>
  <table>${rows}</table><p style="margin-top:16px"><b>Cast</b> (persona.js) uses its own built-in harness: ${cast}</p>`;
}

// ---- server ---------------------------------------------------------------------------------
createServer(async (req, res) => {
  try {
    const u = new URL(req.url ?? "/", "http://x");
    const path = decodeURIComponent(u.pathname);
    // index
    if (path === "/" || path === "/index") { return send(res, 200, ".html", indexPage()); }
    // harness route: /h/<wrapp>
    if (path.startsWith("/h/")) {
      const id = path.slice(3).replace(/\/$/, "");
      const w = WRAPPS.find((x) => x.id === id);
      if (!w) return send(res, 404, ".txt", "unknown wrapp: " + id);
      let projectId = u.searchParams.get("project") || PROJECT_IDS[0];
      if (!PROJECTS[projectId]) projectId = PROJECT_IDS[0];
      const raw = await readFile(join(ROOT, w.html), "utf8");
      return send(res, 200, ".html", injectHarness(raw, projectId));
    }
    // provider + runner (served from the harness dir)
    if (path === "/harness/provider.js") { const b = await readFile(join(HERE, "provider.js")); return send(res, 200, ".js", b); }
    if (path === "/runner.html") { const b = await readFile(join(HERE, "runner.html")); return send(res, 200, ".html", b); }
    if (path === "/runner.js") { const b = await readFile(join(HERE, "runner.js")); return send(res, 200, ".js", b); }
    // placeholder images: /img/<proj>/<WxH>/<name>.png
    if (path.startsWith("/img/")) {
      const parts = path.split("/").filter(Boolean); // ["img", proj, WxH, name.png]
      const proj = parts[1] || PROJECT_IDS[0];
      const dim = (parts[2] || "960x540").split("x");
      const w = Math.min(1280, Math.max(16, parseInt(dim[0], 10) || 960));
      const h = Math.min(1280, Math.max(16, parseInt(dim[1], 10) || 540));
      return send(res, 200, ".png", placeholderPng(PROJECTS[proj] ? proj : PROJECT_IDS[0], w, h));
    }
    // static passthrough from apps root
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    const body = await readFile(file);
    return send(res, 200, extname(file), body);
  } catch (e) {
    res.writeHead(404, { "content-type": "text/plain" }); res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.error(`[harness] http://127.0.0.1:${PORT}  (projects: ${PROJECT_IDS.join(", ")})`));

function send(res, code, ext, body) {
  res.writeHead(code, { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
}
