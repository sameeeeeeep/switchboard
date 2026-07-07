/**
 * @switchboard/adapter — the fetch-router that runs an app's API routes LOCALLY (in the sandbox),
 * so `fetch("/api/…")` never touches the network. Route handlers are Web-standard
 * (req: Request) => Response — exactly what Next.js App Router already produces — so they run
 * unchanged, client-side.
 *
 *   const app = createApp({ "/api/studio/gaps": gapsRoute, ... });
 *   installFetchShim(app);        // in the browser: intercept /api/* → dispatch locally
 *   // or, headless: await app.handle(new Request("/api/studio/gaps", { method:"POST", body }))
 */
export function createApp(routes, { prefix = "/api" } = {}) {
  return {
    prefix,
    async handle(req) {
      const url = new URL(req.url, "http://switchboard.local");
      const mod = routes[url.pathname];
      if (!mod) return new Response("not found", { status: 404 });
      const handler = mod[req.method] || mod[req.method?.toUpperCase?.()];
      if (typeof handler !== "function") return new Response("method not allowed", { status: 405 });
      try {
        return await handler(req);
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { "content-type": "application/json" } });
      }
    },
  };
}

/** Browser only: patch fetch so the app's own /api/* calls dispatch to local handlers. Any other
 *  fetch is left alone (and, in the airgapped sandbox, blocked by CSP anyway). */
export function installFetchShim(app) {
  const orig = globalThis.fetch?.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const raw = typeof input === "string" ? input : input.url;
    let path;
    try { path = new URL(raw, location.href).pathname; } catch { path = raw; }
    if (path.startsWith(app.prefix)) return app.handle(new Request(raw, init));
    return orig ? orig(input, init) : Promise.reject(new Error("no network in sandbox"));
  };
}
