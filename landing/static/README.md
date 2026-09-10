# Static export → thelastprompt.ai/switchboard

Plain Vite (client) + SSR prerender of `/v2` and `/developers`, with root-relative asset and
route paths rewritten to `/switchboard/...`. No Sites / Cloudflare / vinext runtime.

```bash
PATH=/usr/local/bin:$PATH node static/prerender.mjs      # needs Node ≥ 22 → static/out/site
```

Then copy `static/out/site/` over `the-last-prompt/switchboard/` (index.html, developers/, assets/*,
wrapps/, brands/, connectors/, product-captures/, fonts/, favicon.svg) and `git add` ONLY those paths —
the deploy repo carries unrelated uncommitted work. `prerender.mjs <dir>` wipes `<dir>` first, so never
point it at the deploy repo directly.
