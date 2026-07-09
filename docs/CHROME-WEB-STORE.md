# Chrome Web Store — submission package

Everything paste-ready for publishing the Switchboard extension. The only things Claude can't do:
create the developer account and click Submit. Total human time: ~15 minutes.

## 0. One-time setup (you)

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the Google account that should own the listing.
2. Pay the **$5 one-time** developer registration fee.
3. (Recommended) Set the publisher name to **The Last Prompt**.

## 1. The package to upload

Use the release zip (already structured correctly — manifest at the folder root):
`https://github.com/sameeeeeeep/switchboard/releases/latest/download/switchboard-extension.zip`

⚠️ CWS wants the zip to contain the manifest at the **zip root**, not inside a folder. Re-zip before upload:

```bash
cd $(mktemp -d) && curl -sL https://github.com/sameeeeeeep/switchboard/releases/latest/download/switchboard-extension.zip -o s.zip
unzip -q s.zip && cd switchboard-extension && zip -qr ../switchboard-cws.zip . && echo "upload: $(pwd)/../switchboard-cws.zip"
```

## 2. Store listing (paste-ready)

**Name:** `Switchboard`

**Summary** (≤132 chars):
`Bring your own AI. Lend any website your Claude, tools, context and data — under per-site consent. No API keys, no signups.`

**Category:** Productivity · **Language:** English

**Description:**
```
Switchboard turns your computer into the backend. Apps become pure frontends —
you stop signing up.

A tiny daemon on your machine (the "sidekick") holds the AI you already have —
your Claude subscription or a local model — plus your tools and your data.
This extension injects one provider, window.claude, into pages you visit.
When a compatible app ("wrapp") wants to use your AI, it must ask, and you
approve exactly what it gets, per site:

• Your AI — apps run on the model you already pay for. No per-app pricing.
• Your tools — Gmail, Shopify, web search (via MCP) work instantly, everywhere.
• Your context — teach an app your brand or project once, use it in every app.
• Your data — apps see one folder you hand them, nothing else.

Security model:
• Per-site permission, scoped and revocable. Choosing is the permission.
• Reads run within what you granted. Every change-making action asks first.
• Keys and credentials never leave your machine. The extension talks only to
  127.0.0.1 — there is no Switchboard cloud, no analytics, no telemetry.
• A kill switch cuts off an app, a tool, or everything, in one tap.

Requires the free, open-source Switchboard sidekick running on your computer:
https://thelastprompt.ai/switchboard/

Source: https://github.com/sameeeeeeep/switchboard (MIT)
```

**Single-purpose statement:**
`Switchboard exposes a single provider (window.claude) that lets websites use the AI models, tools, and data on the user's own computer, gated by per-site user consent enforced by a local daemon.`

## 3. Privacy tab

- **Privacy policy URL:** `https://thelastprompt.ai/switchboard/privacy.html`
- **Data collection:** declare **no data collected** in every category (true: no analytics, no telemetry, no remote servers; the only stored item is a local pairing token in `chrome.storage.local`).
- Certify: no sale of data, no transfer for unrelated purposes, no creditworthiness use.

## 4. Permission justifications (paste into the fields)

| Permission | Justification |
|---|---|
| `storage` | Stores a single random pairing token that links this extension to the user's local daemon. Never transmitted anywhere except 127.0.0.1. |
| `tabs` | Shows the user, in the side panel, which site the active tab is and whether it is connected to Switchboard. No browsing history is stored or transmitted. |
| `downloads` | Lets the user export their own local activity log as a JSON file. |
| `sidePanel` | The side panel is the product's control surface: per-site grants, consent prompts, and the kill switch. |
| Host permissions `http://127.0.0.1/*`, `http://localhost/*` | A WebSocket to the user's own local daemon. The extension communicates with no external host. |
| Content script on `thelastprompt.ai`, `*.thelastprompt.ai`, `sameeeeeeep.github.io`, localhost | Injects the `window.claude` provider **only on the Switchboard wrapp store's own domains** (each wrapp is a `*.thelastprompt.ai` subdomain) and localhost for development. The script only installs the provider and relays request/response messages; it reads no page content, and pages get nothing until the user approves a per-site consent prompt rendered by the extension. No broad host access is requested. |
| **Remote code** | None. All JavaScript is bundled in the package. |

> Deliberately **not** `<all_urls>`: the store's domains are the trust boundary for v0.1. Arbitrary
> third-party wrapp domains are future work via `activeTab` (inject on explicit icon click) +
> `optional_host_permissions` — never a blanket grant.

## 5. Assets

- **Store icon 128×128:** `packages/extension/icons/icon128.png`
- **Screenshots (1280×800)**, in `docs/webstore/`:
  1. `1-side-panel.png` — the control center (grants, connectors, wrapp store)
  2. `2-landing.png` — the concept ("Bring your own <AI>")
  3. `3-cartridge.png` — a wrapp using the provider (game generator)

## 6. Reviewer notes (paste into "Notes for reviewer")

```
Switchboard is an open-source (MIT) consent broker: it lets websites use the AI
model and tools on the USER'S OWN computer instead of the site operator's API
keys. The extension pairs with a local daemon (ws://127.0.0.1:8787) and makes
no other network connections. Without the daemon the extension idles ("not
paired") — to test end-to-end: git clone
https://github.com/sameeeeeeep/switchboard && npm install && npm run build &&
npm run sidekick, then paste the printed token into the extension.
The content script runs ONLY on the product's own domains (thelastprompt.ai
and its wrapp subdomains, sameeeeeeep.github.io, and localhost for
development) and only injects a provider object (window.claude); pages
receive no capability until the user approves a per-site consent prompt
rendered inside the extension's side panel. Docs:
https://thelastprompt.ai/switchboard/
```

## 7. Submit

Upload → fill the above → **Submit for review**. Typical review: 1–7 days (broad host
permissions can extend it). The listing goes live automatically on approval unless you
choose staged publish.

## Post-approval follow-ups

- Update the landing's install section: "Add to Chrome" button replaces the zip/Developer-mode
  instructions (which also clears the Safe-Browsing "unwanted software" heuristic pattern).
- Keep the zip release for power users; the store becomes the default path.
- Inline the Google Fonts CSS in `sidepanel.html` at some point (not remote *code*, but removing
  the CDN dependency is cleaner for review).
