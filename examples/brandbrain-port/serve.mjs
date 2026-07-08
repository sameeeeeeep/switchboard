// Static server for the ported brandbrain (Next `output: export`). Resolves clean URLs the way a
// static host would: exact file → `<path>.html` → `<path>/index.html` → 404.html. Loopback only.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "dist");
const PORT = Number(process.env.PORT || 5178);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain" };

async function tryFile(p) { try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; } }

async function resolve(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
  const base = join(ROOT, rel || "index.html");
  return (
    (extname(base) ? await tryFile(base) : null) ||
    (await tryFile(base)) ||
    (await tryFile(`${base}.html`)) ||
    (await tryFile(join(base, "index.html"))) ||
    (await tryFile(join(ROOT, "404.html")))
  );
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = await resolve(url.pathname === "/" ? "/index.html" : url.pathname);
  if (!file) { res.writeHead(404); res.end("not found"); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(500); res.end("error"); }
}).listen(PORT, "127.0.0.1", () => console.error(`[brandbrain-port] serving dist on http://127.0.0.1:${PORT}`));
