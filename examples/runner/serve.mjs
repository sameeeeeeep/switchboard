/**
 * The Switchboard RUNNER server — the airgapped-app runtime, prototype.
 *
 * It serves an untrusted app inside a hard sandbox:
 *   • a strict Content-Security-Policy on the app response — `connect-src 'none'` kills fetch/XHR/
 *     WebSocket/sendBeacon, `form-action 'none'` kills form POSTs, `img-src data:` kills GET-exfil
 *     via images. The app has NO network egress. (Enforced as a header so the app can't relax it.)
 *   • a provider BRIDGE injected into the app: `window.claude` that postMessages to the runner
 *     shell (NOT a network call, so it survives connect-src 'none'). The runner forwards it to the
 *     real Switchboard provider — the app's ONE capability, fully consented + audited.
 *
 * Net effect: the app runs on the visitor's model + tools, and structurally cannot send their data
 * anywhere. The runner shell itself (index.html) is trusted Switchboard code and is NOT airgapped.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT ?? 5177);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

// The airgap. default-src none = deny everything; then re-allow only what a confined app needs to
// RENDER and RUN — never to reach the network. connect-src 'none' is the load-bearing line.
const APP_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",   // run the app's (untrusted) scripts — execution is fine; egress is what we block
  "style-src 'unsafe-inline'",
  "img-src data: blob:",          // no external image loads → no GET exfiltration
  "font-src data:",
  "connect-src 'none'",           // ← no fetch / XHR / WebSocket / sendBeacon, anywhere
  "form-action 'none'",           // ← no form POST exfiltration
  "base-uri 'none'",
  "frame-src 'none'",
].join("; ");

// Injected into every app document: a window.claude that bridges to the runner shell over
// postMessage. This is the app's only line out — and it goes to the consented broker, not the net.
const BRIDGE = /* js */ `<script>
(() => {
  const pending = new Map(); const listeners = new Map();
  const uid = () => Math.random().toString(36).slice(2);
  addEventListener("message", (ev) => {
    const d = ev.data; if (!d || d.__sb !== 1 || d.dir !== "runner->app") return;
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id);
      d.error ? p.rej(Object.assign(new Error(d.error.message), d.error)) : p.res(d.result); }
    else if (d.event) { (listeners.get(d.event) || []).forEach((fn) => { try { fn(d.payload); } catch {} }); }
  });
  window.claude = Object.freeze({
    version: "1.0.0", isRelay: true, airgapped: true,
    request: (args) => new Promise((res, rej) => { const id = uid(); pending.set(id, { res, rej });
      parent.postMessage({ __sb: 1, dir: "app->runner", kind: "request", id, method: args.method, params: args.params }, "*"); }),
    on: (e, h) => { (listeners.get(e) || listeners.set(e, []).get(e)).push(h); },
    removeListener: (e, h) => { const a = listeners.get(e); if (a) a.splice(a.indexOf(h) >>> 0, 1); },
  });
  // Report every blocked egress attempt up to the runner's airgap monitor — proof the wall holds.
  addEventListener("securitypolicyviolation", (e) => {
    parent.postMessage({ __sb: 1, dir: "app->runner", kind: "blocked", directive: e.effectiveDirective, uri: e.blockedURI || "(inline)" }, "*");
  });
  dispatchEvent(new Event("claude#initialized"));
})();
</script>`;

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    // App route: inject the bridge + enforce the airgap CSP.
    const appMatch = path.match(/^\/app\/([a-z0-9._-]+)$/i);
    if (appMatch) {
      const html = await readFile(join(root, "apps", `${appMatch[1]}.html`), "utf8");
      const injected = html.includes("</head>") ? html.replace("</head>", `${BRIDGE}</head>`) : BRIDGE + html;
      res.writeHead(200, { "content-type": "text/html", "content-security-policy": APP_CSP });
      res.end(injected);
      return;
    }
    // Runner shell + assets (trusted, not airgapped).
    let p = path === "/" ? "/index.html" : path;
    const body = await readFile(join(root, normalize(p).replace(/^(\.\.[/\\])+/, "")));
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.error(`[runner] http://127.0.0.1:${PORT}`));
