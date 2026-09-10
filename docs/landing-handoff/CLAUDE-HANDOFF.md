# Switchboard landing page — handoff to the publishing repository

## Task

Integrate the finished Switchboard landing page into the destination repository and publish using that repository’s existing deployment workflow. Preserve its branding, layout, copy, diagrams and interactions. Do not redesign it during the transfer.

## Source

Working source: `/Users/sameeprehlan/Documents/Projects/relay/landing`.
This is a separate local Git repository with no remote configured. The latest work includes uncommitted and untracked files. Use the supplied complete source snapshot, not just `git diff` or its last commit.

- **Current design:** `app/v2/page.tsx` and `app/v2/site.tsx` (previewed at `/v2`).
- **Developer page:** `app/developers/` (route `/developers`).
- `app/page.tsx` is the older V1. Do not accidentally publish it as the new homepage.
- The current hero reuses V1’s animated diagram through `app/route-scene.tsx`. Its sibling files and styles are required. Copying only `app/v2/` is insufficient.

## Integrate

1. Inspect the destination stack and any repository instructions. Retain its deployment configuration and domain.
2. Bring across the source under `app/`, `components/`, `hooks/`, `lib/` and `public/`, resolving existing-file conflicts deliberately. `app/layout.tsx` imports the global stylesheet, which also supplies the fonts and shared design tokens.
3. Make the current V2 the destination homepage (or the requested landing route). For an App Router homepage, `app/page.tsx` can re-export the current route:

   ```tsx
   export { default, metadata } from './v2/page';
   ```

   Keep `/v2` as an alias if desired. Update `/v2` backlinks in the developer page to the chosen canonical landing URL.
4. Preserve `/developers` and its links. If deploying below a prefix such as `/switchboard`, update root-relative routes and asset URLs to match the destination’s base-path strategy.
5. Merge the dependencies and `@/*` import alias into the target project; do not blindly overwrite its package or hosting configuration. The source uses React, TypeScript, Next-style App Router components and Vinext. `package.json` and `package-lock.json` record the exact source environment. The source’s `vite.config.ts` includes Sites/Cloudflare-specific integration; adapt it to the target host rather than copying deployment assumptions.
6. The exported `.openai/hosting.json` is a neutral placeholder with no source project ID. Never reuse the original Sites deployment identity. Use the destination’s configuration.
7. Install dependencies, build, and inspect desktop and mobile layouts. Verify the animated hero, app selection, playable examples, asset highlighting, FAQs, download links and developer submission flow before publishing.

## Important product behaviour

- Green dot matrix branding. Current hero diagram includes provider-attached connectors, context/data on the Mac, and local models.
- Web/native labels change automatically with the scenario.
- App previews and brand-asset transfer are **illustrated examples**, not live AI generation. Retain their honest labels.
- Brand-asset section: colours, logo and product image flow through Switchboard into an ad and a storefront. Selecting an asset highlights its reuse.
- Download links currently lead to the Switchboard GitHub release page.
- Repository form prepares a GitHub issue; the visitor reviews and submits it on GitHub. It does not deploy a repository automatically.
- Public hosting, update review and developer revenue programmes are labelled proposed. Do not change these to live claims without product confirmation.
- The “93 other Wrapps / 12 developers” figures were supplied by the owner, not sourced from a live directory API.

## Checks already performed on source

Recent build and TypeScript checks passed; app interactions and responsive layouts were inspected during implementation. Run destination checks again after adapting framework or paths.

## Not included

Git history, node_modules, build outputs, caches, credentials, environment files, and the original Sites project identity. This package contains the landing site, not the Switchboard backend or the separate LinkedIn launch kit.
