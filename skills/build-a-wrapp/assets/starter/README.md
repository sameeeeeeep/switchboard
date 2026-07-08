# my-wrapp

A starter [wrapp](../../SKILL.md) — a web app that runs on the user's own AI through Switchboard,
with no API key and no backend.

## Run

```bash
npm install
npm run build          # or: npm run dev  (rebuild on change)
# serve this folder statically, e.g.:
npx serve .
```

Open the page, click **Connect Switchboard** (approve the one-time consent), and generate.

## What's here

- `index.html` — the page; mounts the standard connect chip at `#connect`.
- `app.js` — the whole integration: mount chip → connect → stream. Swap this for your logic.
- `build.mjs` — esbuild bundling `app.js` + `@relay/sdk` → `dist/app.js`.

## Make it yours

Change the `MODEL` constant and the `scope` in `app.js` together (they must match — exact-match,
default-deny). Then reach for more capabilities from `@relay/sdk`:

- `relay.storage.*` — private on-device persistence.
- `relay.context.*` — the user's portable knowledge (a brand, a persona).
- `relay.speak(text)` — local text-to-speech, no credits.
- `relay.complete({ agentic: true })` — let the model call your granted tools.

See the capability surface in [`references/api.md`](../../references/api.md) and the rules in
[`SKILL.md`](../../SKILL.md).
