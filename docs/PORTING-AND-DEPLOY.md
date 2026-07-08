# Porting & deploying apps on Switchboard

How to take a conventional web app (or a fresh one you build), run it as a **Switchboard app**,
and deploy it to a plain static host — plus the constraints to design around **for every app**.

The reference implementation is [`examples/brandbrain-port/`](../examples/brandbrain-port); the
adapter it targets is [`examples/adapter/`](../examples/adapter). Read this before porting or
deploying anything new.

---

## 1. The mental model: there is no backend

A Switchboard app has **no server**. What a normal app splits into "frontend" and "backend
routes," a Switchboard app collapses into a **single static bundle that runs entirely in the
visitor's browser tab**. The two things a static file genuinely can't do — call a model and
persist durable data — are proxied to the **visitor's own machine** through `window.claude`.

```
app UI  →  fetch("/api/whatever")            ← runs in the tab (patched fetch, never networked)
   →  bundled route handler                  ← sb/routes.js, a static asset
       →  runClaude / storage / tools        ← seam shims call window.claude
           →  extension  →  local daemon  →  the visitor's Claude CLI + MCP tools
```

So the deployed website (GitHub Pages, S3, any static host) ships **only HTML/JS/CSS**. Every AI
call and every write loops back to a daemon on the *viewer's* computer (`ws://127.0.0.1:8787`).
This is the whole BYO-Claude point: the site borrows the visitor's model, tools, and data; the
operator pays for and holds nothing.

### What this means in practice
- **The frontend always renders standalone.** Pages, styling, navigation, seeded data work with
  no daemon at all.
- **Live features need the visitor's local stack** (see §2). With no daemon, model/storage calls
  fail gracefully — the app must show an honest error, never fabricate a fallback.
- **There is no hosted backend to point anyone at.** "Deploy so anyone can use it" is false by
  design — it works for people running the local stack. The deploy proves the build/frontend/
  routing; the round-trips need a broker.

---

## 2. What a visitor needs (the two pieces)

Put this in every app's README. To use the live features of *any* Switchboard app, a visitor needs:

1. **The Switchboard extension** (Chrome/Chromium), loaded unpacked from `packages/extension`
   (it is not on the Web Store yet). Its content script matches `<all_urls>`, so it injects
   `window.claude` on any origin — localhost, github.io, anywhere.
2. **The Switchboard app / sidekick daemon**, running locally and **paired** to the extension
   (a pairing token). This is what fulfills `claude_complete` (model) and `claude_storage`
   (persistence) by shelling out to the visitor's signed-in Claude Code CLI.

Then, on the site: click **Connect Switchboard** → approve the scoped consent → (optionally) bind
a data folder. After that the app's routes round-trip through their own Claude.

**Tool-backed features need more.** Anything that declares `mcp: true` / agentic tools (web search,
Shopify, Higgsfield, Gmail, …) only works if the visitor has *those* MCP servers configured in their
CLI. The bare model round-trip is universal; tool features are gated on the visitor's setup. Say so
in the app's README so a missing tool reads as "not set up," not "broken."

### The HTTPS ↔ `ws://` non-issue
The page is HTTPS but the daemon hop is insecure `ws://127.0.0.1`. There is **no** mixed-content
error, because the *page never touches `ws://`* — only the extension's background worker does, and
extension→localhost sockets are exempt from the page's mixed-content policy. Design around this
seam; don't try to "fix" it by making the page connect to the daemon directly (it can't, and
shouldn't).

---

## 3. Porting an app: the seam substitutions

Porting **substitutes seams, never rewrites**. The real source is copied into a throwaway build
dir; a small overlay + alias map swaps the runtime seams to adapter shims; the frontend static-
exports unchanged and the route handlers bundle separately for the client fetch-router. The real
source repo is never touched. See [`build.mjs`](../examples/brandbrain-port/build.mjs).

The seams you swap (everything else resolves normally):

| App's server-only seam | Swap to | Effect |
|---|---|---|
| model transport (`claude -p` spawn, `lib/claude`) | [`adapter/claude.mjs`](../examples/adapter/claude.mjs) | `runClaude`/`runClaudeStream` → `window.claude` (`claude_complete`/`claude_stream`) |
| warm-session lib | `shims/claude-session.mjs` | per-thread `sessionSend` over the same provider |
| durable persistence (`.data/*.json`, a DB) | [`adapter/claude_storage.mjs`](../examples/adapter/claude_storage.mjs) | reads/writes → the daemon's per-origin store, or a **bound folder** |
| `node:fs` | `shims/node-fs.mjs` | in-memory Map (fine for optional caches; a miss just re-runs) |
| `node:path` | `shims/node-path.mjs` | browser polyfill |

Requirements for a clean port:
- **Route handlers must be Web-standard** `(req: Request) => Response` (Next.js App Router already
  is). They then run unchanged client-side via the fetch-router
  ([`adapter/router.mjs`](../examples/adapter/router.mjs)).
- **Keep the adapter's function signatures identical to the app's** so only the *import target*
  changes — the route files don't change a character. If you port an app whose model/storage lib
  has a different surface, extend the adapter to match it (don't edit the app).
- **`app/api` is removed from the frontend export** (routes are Node-only + dynamic; a static
  export can't include them) and bundled separately into `sb/routes.js`.
- **The bootstrap** ([`src/bootstrap.js`](../examples/brandbrain-port/src/bootstrap.js)) mounts the
  routes, connects `window.claude`, offers the folder bind, and publishes any shareable context.
- **Declare scope in `switchboard.json`** — the tools + models the app actually uses, and its
  default data folder. This is what the connect consent asks for. Ask for exactly what you use.
- **Storage keys map to files** deliberately: key `workspace` → `<folder>/workspace.json`. So
  binding an existing project folder surfaces the user's real data verbatim, no migration.

### Design constraints to hold for every app
- **No server-only capability beyond the shimmed set.** If a route needs a Node API the shims don't
  emulate (raw `child_process`, native addons, writing real files), it won't work in-tab. Either add
  a shim, make the feature browser-capable (e.g. `pptxgenjs` has a browser build + download), or gate
  it behind an honest "needs the desktop app" seam.
- **Provider-race safety.** The app may read storage the instant it mounts, before connect finishes.
  Use `whenProvider()` and the **read-before-write** guard (never write before a confirmed read) so a
  load-race can't clobber real data with an empty autosave. The adapter already does this — preserve
  it.
- **Graceful no-provider path.** With no daemon, `runClaude` returns `null` and storage throws. Every
  feature must degrade to an honest error or a local fallback, never a fabricated result.
- **Fetch-router owns `/api/*` only.** The shim intercepts by `pathname.startsWith("/api")` and
  leaves every other fetch alone. Keep app API calls under `/api`.

---

## 4. Deploying the static export to a host

The export in `dist/` is the deployable artifact. It is a **build artifact, not source** — commit it
to a separate deploy repo (or a `gh-pages` branch); regenerate it from the port pipeline, don't
hand-edit.

### GitHub Pages (what brandbrain-web uses) — the two gotchas that break it
1. **Project-site subpath → `basePath`.** A Pages *project* site serves at
   `https://<user>.github.io/<repo>/`. A default Next export uses **absolute** asset URLs
   (`/_next/...`) that resolve to the domain root and 404. Fix: build with a base path equal to the
   repo name so assets and links get the prefix.
   ```bash
   PORT_BASE_PATH=/<repo> node examples/brandbrain-port/build.mjs
   ```
   (The port's `overlays/next.config.mjs` reads `PORT_BASE_PATH` → `basePath` + `assetPrefix`.)
   Note: Next's `basePath` rewrites `<Link>`/router/assets but **not** `fetch()` calls — that's
   fine, because the app still fetches `/api/...` and the fetch-router matches `/api`.
   *User/org site (`<user>.github.io`) or a custom domain serves at root → no base path needed.*
2. **`_next/` gets stripped → `.nojekyll`.** Pages runs Jekyll, which ignores files/dirs starting
   with `_`. Add an empty **`.nojekyll`** at the repo root or the whole `_next` bundle 404s.
3. **Hand-written absolute paths in overlays/bootstrap → prefix them yourself.** `basePath` only
   rewrites *Next-managed* URLs (`<Link>`, router, `next/font`, `/_next` assets). Any absolute path
   **you** wrote in an overlay or the bootstrap stays at the domain root and 404s under a subpath.
   In this port that was three: the home-page redirect (`<meta http-equiv="refresh" url=/build>`),
   the injected `<script src="/sb/*.js">` tags, and the bootstrap's `fetch("/switchboard.json")` —
   symptom: **the page opens then flips to 404** (home renders, then meta-refreshes to a root path
   that doesn't exist). Fix: thread `PORT_BASE_PATH` through them — server-component overlays read
   `process.env.PORT_BASE_PATH` at build; the esbuild-bundled bootstrap gets it via a `define`
   (`"process.env.PORT_BASE_PATH": JSON.stringify(...)`) — **don't guard the read with
   `typeof process`**, which survives to the browser (where `process` is undefined) and defeats the
   `define`. Audit before deploying: `grep -rE '"/[a-z]' dist/*.html dist/sb/*.js` for stray
   root-absolute paths.

Then:
```bash
# assemble deploy repo
cp -R examples/brandbrain-port/dist/. /path/to/<repo>/
touch /path/to/<repo>/.nojekyll
cd /path/to/<repo> && git init && git add -A && git commit -m "static export" && git branch -M main
gh repo create <repo> --public --source . --push
# enable Pages from main root
gh api -X POST /repos/<user>/<repo>/pages -f "source[branch]=main" -f "source[path]=/"
```

- **Public repo** for free Pages (private needs a paid plan). The export has no secrets.
- **Clean URLs work**: Pages serves `/build` from `build.html` (Next export, `trailingSlash: false`).
- **First-build propagation window**: for a few minutes after the *first* build, the URL shows
  *"There isn't a GitHub Pages site here."* even though `gh api .../pages` reports `status: built`.
  This is CDN/DNS catch-up, not an error — wait and retry. Verify with
  `curl -s -o /dev/null -w '%{http_code}' https://<user>.github.io/<repo>/`.

### Other hosts (Vercel / Netlify / Cloudflare Pages)
They serve at root and handle Next exports natively, so **neither gotcha applies** — no `basePath`,
no `.nojekyll`. They need their own CLI/account auth (can't be done headlessly here). Prep the repo
+ a config file and hand off the one deploy command.

---

## 5. Verify a deploy (before claiming it works)

Static-level (always do this):
```bash
BASE=https://<user>.github.io/<repo>
curl -s -o /dev/null -w '%{http_code}\n' $BASE/            # root 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/<subroute>  # clean URL 200
CSS=$(curl -s $BASE/ | grep -oE '/[^"]*_next/static/css/[^"]+\.css' | head -1)
curl -s -o /dev/null -w '%{http_code}\n' https://<user>.github.io$CSS   # asset 200 (proves basePath+.nojekyll)
curl -s -o /dev/null -w '%{http_code}\n' $BASE/switchboard.json         # manifest 200
```

End-to-end (needs a browser + the local stack): load the site with the extension installed and the
daemon running → confirm `window.claude` is present → click **Connect** → approve consent → trigger
one real generation and watch it round-trip. Only after this should you call it "verified working"
rather than "confirmed from the code / static deploy."

---

## Checklist (copy per app)

**Port**
- [ ] Route handlers are Web-standard `(Request) => Response`.
- [ ] Model/session/storage/fs/path seams swapped to adapter shims (signatures matched, source untouched).
- [ ] `app/api` removed from the frontend export; routes bundled to `sb/routes.js`.
- [ ] `switchboard.json` declares exactly the tools + models used, and a default folder.
- [ ] Storage keys map to intended filenames; binding an existing folder surfaces real data.
- [ ] No-provider path degrades honestly; provider-race read-before-write preserved.

**Deploy (static host)**
- [ ] Built with `PORT_BASE_PATH=/<repo>` if it's a subpath (Pages project site).
- [ ] `.nojekyll` present at repo root (Pages).
- [ ] Deploy repo is the built `dist/` only, committed separately from source.
- [ ] Static checks pass (root, subroute, `_next` asset, `switchboard.json`).
- [ ] README states the two pieces a visitor needs + which features are tool-gated.

**Ship note for users**
- [ ] Extension (unpacked) + Switchboard app (paired) are required for live features.
- [ ] Tool-backed features need the matching MCP servers in the visitor's CLI.
