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

/** Browser only: route the app's own /api/* calls to local handlers.
 *
 *  Preferred path: the build-injected HEAD preamble (see the port's overlays/layout.tsx) already
 *  owns window.fetch from the first parsed byte and has been QUEUEING /api/* calls — async Next
 *  chunks can hydrate and fetch before any deferred script runs, so patching fetch here was too
 *  late on real CDNs (the app's workspace read escaped to the static host and 404'd). Hand the
 *  preamble the dispatcher and drain its backlog; handlers that need the provider await the
 *  whenProvider hold, so early-queued reads still land on real data.
 *
 *  Fallback (headless tests / preamble absent): patch fetch directly, as before. */
export function installFetchShim(app) {
  const dispatch = (input, init) => {
    const raw = typeof input === "string" ? input : input.url;
    return app.handle(new Request(raw, init));
  };
  if (typeof window !== "undefined" && Array.isArray(window.__sbQ)) {
    window.__sbRoute = dispatch;
    for (const [input, init, res, rej] of window.__sbQ.splice(0)) dispatch(input, init).then(res, rej);
    return;
  }
  const orig = globalThis.fetch?.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const raw = typeof input === "string" ? input : input.url;
    let path;
    try { path = new URL(raw, location.href).pathname; } catch { path = raw; }
    if (path.startsWith(app.prefix)) return app.handle(new Request(raw, init));
    return orig ? orig(input, init) : Promise.reject(new Error("no network in sandbox"));
  };
}
