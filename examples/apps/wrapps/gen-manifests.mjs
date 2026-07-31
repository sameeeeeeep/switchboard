#!/usr/bin/env node
// Scaffold a switchboard.json per wrapp — the SOURCE OF TRUTH for a listing, owned by the wrapp
// (docs/WRAPP-STORE-MODAL.md §9: manifest-in-repo, ingested). This is a ONE-TIME seed, not a
// build-time regenerator: once `wrapps/<id>/switchboard.json` exists it is hand-editable and this
// script leaves it alone (`--force` overwrites). The aggregator (build-catalog.mjs) globs these.
//
// Honesty (DESIGN.md): a wrapp gets a surface ONLY if the material exists. Every entry here is
// `browser` because the wrapp is a deployed Pages UI; `batch` is added ONLY to the wrapps that
// already expose an MCP tool (mcp__switchboard__wrapp__<id>__*), and `god` only where a real skill
// ships. We do not promise `window`/`notch` yet — those hosts aren't built (Phases 3–4).

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPS } from "../src/store/catalog.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes("--force");

// The web store's eight job-categories → the store-modal's five (studio|tool|fun|agent|skill).
const CAT = {
  brandbrain: "studio", ideabrain: "studio", bank: "studio",
  mkt: "tool", capp: "tool", saas: "tool", retail: "tool", hardware: "tool", feature: "tool",
  adpulse: "agent", adforge: "tool", shelf: "tool", studio: "tool", aplus: "tool",
  batch: "agent", take: "tool", identity: "tool", reel: "tool", marquee: "tool", huddle: "tool",
  natal: "fun", arcana: "fun",
  redline: "agent", cartridge: "tool", cast: "tool", prism: "tool", adgen: "tool",
};

// One truthful one-liner each (the shop-window tagline). Describes what the tool does — not a
// quality claim, no ratings/installs (there are none, by design).
const TAGLINE = {
  brandbrain: "Your whole brand, one place.",
  ideabrain: "Pressure-test an idea before you build it.",
  bank: "A second brain your wrapps can borrow from.",
  mkt: "Is this marketplace worth building? Find out.",
  capp: "Plan a consumer app end to end.",
  saas: "Turn a SaaS hunch into a thesis.",
  retail: "Reality-check a retail concept.",
  hardware: "The hard questions before you tool up.",
  feature: "Make the case for one feature.",
  adpulse: "Find the ad spend that's being wasted.",
  adforge: "Draft this week's ads from your brand.",
  shelf: "Keep inventory honest.",
  studio: "Product photography on your own models.",
  aplus: "Amazon A+ content, in bulk.",
  batch: "Run one prompt across a whole list.",
  take: "One take, many cuts.",
  identity: "A visual identity from a few words.",
  reel: "Short-form video from a brand kit.",
  marquee: "A landing page that ships to a domain.",
  huddle: "Get everyone on the same call, fast.",
  natal: "Your chart, read plainly.",
  arcana: "A tarot pull with a real read.",
  redline: "Mark up a landing page like a doc.",
  cartridge: "Build a little browser game.",
  cast: "A cast of personas you can direct.",
  prism: "Make an image pop on any background.",
  adgen: "A wall of ad variations at once.",
};

// The wrapps that already expose an MCP tool → a REAL `batch` surface (a workflow you can kick
// headless). Verified against the connected mcp__switchboard__wrapp__<id>__* tool surface.
const HAS_BATCH = new Set(["adpulse", "batch", "ideabrain", "redline"]);

// A local model can't do tool-calls, so a batch wrapp needs a cloud model; a pure browser wrapp
// runs on whatever the user has. (docs/economy-mode boundary.)
const modelReq = (cloud) => ({ kind: "model", class: cloud ? "cloud" : "local" });

function manifestFor(app) {
  const surfaces = ["browser"];
  if (HAS_BATCH.has(app.id)) surfaces.push("batch");
  const requires = [{ kind: "daemon" }, modelReq(HAS_BATCH.has(app.id))];
  // brandbrain/bank keep a local vault → they'll want sb_db (shown as a resolvable need).
  if (app.id === "brandbrain" || app.id === "bank") requires.push({ kind: "capability", name: "sb_db" });

  const components = { ui: { kind: "web", url: app.href } };
  if (HAS_BATCH.has(app.id)) components.workflows = [`${app.id}/run`];

  return {
    id: app.id,
    name: app.name,
    tagline: TAGLINE[app.id] || `${app.name}.`,
    category: CAT[app.id] || "tool",
    components,
    surfaces,
    requires,
  };
}

let wrote = 0, skipped = 0;
for (const app of APPS) {
  const dir = join(HERE, app.id);
  const file = join(dir, "switchboard.json");
  if (existsSync(file) && !FORCE) { skipped++; continue; }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(manifestFor(app), null, 2) + "\n");
  wrote++;
}
console.log(`seeded ${wrote} manifest(s), left ${skipped} existing untouched${FORCE ? " (force off would skip these)" : ""}`);
