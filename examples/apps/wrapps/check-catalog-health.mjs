#!/usr/bin/env node
// The go-live GUARDRAIL for discovery. build-catalog.mjs guarantees every listing is a VALID manifest;
// this checks something build-catalog can't: are the listings actually REACHABLE and go-live-shaped?
//
// It classifies each listing's launch URL into one of:
//   native  — no web url (Flow/Autopilot); launched by the app, nothing to host. Fine.
//   hosted  — a real public host (e.g. *.thelastprompt.ai). Previewable + shareable pre-install. Ideal.
//   local   — http://localhost:5188/... . Only resolves via the app's BUNDLED web server after install.
//             Works for installed users, but NOT publicly previewable/shareable. Flagged, not fatal.
//   none    — a web-surface listing with an empty/malformed url. Always a defect.
//
// With --live it also HEAD-pings every `hosted` url and fails if any is down (the "no single check that
// the catalog's links are all live" gap). Without --live it stays offline/deterministic for CI-by-default.
//
// Exit codes: 0 = healthy for the chosen strictness; 1 = a fatal problem (see --strict).
//   default     : fatal only on `none` (a broken web listing).
//   --strict     : ALSO fatal on any `local` listing (use when cutting a public/go-live catalog).
//   --launch     : only consider listings marked for the go-live lineup (launch:true); ignore the rest.
//   --live       : additionally HEAD-ping hosted urls; a non-2xx/3xx or timeout is fatal.
//
// Read-only. Never writes. Import-free beyond node builtins.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const STRICT = args.has("--strict");
const LAUNCH_ONLY = args.has("--launch");
const LIVE = args.has("--live");

const catPath = join(HERE, "catalog.json");
if (!existsSync(catPath)) {
  console.error(`✗ no catalog.json at ${catPath} — run build-catalog.mjs first`);
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(catPath, "utf8"));
let listings = catalog.listings || [];
if (LAUNCH_ONLY) listings = listings.filter((l) => l.launch === true);

const urlOf = (l) => (l.components && l.components.ui && l.components.ui.url) || "";
const classify = (l) => {
  const kind = l.components && l.components.ui && l.components.ui.kind;
  const url = urlOf(l);
  if (kind === "native" || (!url && kind !== "web")) return "native";
  if (!url) return "none";
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)) return "local";
  try { new URL(url); } catch { return "none"; }
  return "hosted";
};

const buckets = { native: [], hosted: [], local: [], none: [] };
for (const l of listings) buckets[classify(l)].push(l);

const pad = (s, n) => String(s).padEnd(n);
console.log(`Catalog health — ${listings.length} listing(s)${LAUNCH_ONLY ? " (launch lineup only)" : ""}\n`);
for (const k of ["hosted", "local", "native", "none"]) {
  const rows = buckets[k];
  if (!rows.length) continue;
  console.log(`### ${k.toUpperCase()} (${rows.length})`);
  for (const l of rows) console.log(`  ${pad(l.id, 14)} ${pad(l.name || "", 16)} ${urlOf(l) || "—"}`);
  console.log("");
}

// Optional liveness probe of hosted urls. Concurrent + hard-capped: a CI guardrail must never hang,
// so every ping resolves within TIMEOUT_MS whether the socket answers or not (some hosts accept the
// TCP connection then never respond to HEAD — a bare AbortController on fetch isn't always enough, so
// we also race a hard timer). A HEAD that 405s is treated as up (many static hosts reject HEAD).
const dead = [];
if (LIVE && buckets.hosted.length) {
  const TIMEOUT_MS = 8000;
  console.log(`Pinging ${buckets.hosted.length} hosted url(s)…`);
  const ping = async (l) => {
    const url = urlOf(l);
    const ctrl = new AbortController();
    const timer = new Promise((r) => setTimeout(() => { ctrl.abort(); r({ id: l.id, why: "timeout" }); }, TIMEOUT_MS));
    const attempt = (async () => {
      // HEAD first; if the host rejects the method (405/501) retry once with GET before calling it dead.
      let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal }).catch(() => null);
      if (res && (res.status === 405 || res.status === 501))
        res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal }).catch(() => res);
      if (!res) return { id: l.id, why: "unreachable" };
      if (res.status >= 200 && res.status < 400) return null;
      return { id: l.id, why: res.status };
    })();
    return Promise.race([attempt, timer]);
  };
  const results = await Promise.all(buckets.hosted.map(ping));
  for (const r of results) if (r) dead.push([r.id, r.why]);
  if (dead.length) { console.log(""); for (const [id, why] of dead) console.log(`  ✗ ${pad(id, 14)} ${why}`); }
  console.log("");
}

// Verdict.
const problems = [];
if (buckets.none.length) problems.push(`${buckets.none.length} web listing(s) with no/broken url: ${buckets.none.map((l) => l.id).join(", ")}`);
if (STRICT && buckets.local.length) problems.push(`${buckets.local.length} localhost-only listing(s) (not publicly previewable): ${buckets.local.map((l) => l.id).join(", ")}`);
if (LIVE && dead.length) problems.push(`${dead.length} hosted url(s) down: ${dead.map((d) => d[0]).join(", ")}`);

if (problems.length) {
  console.error("✗ NOT go-live-clean:");
  for (const p of problems) console.error("   " + p);
  process.exit(1);
}
console.log(`✓ healthy — hosted ${buckets.hosted.length}, local ${buckets.local.length}, native ${buckets.native.length}, none ${buckets.none.length}`
  + (STRICT ? " (strict)" : "") + (LIVE ? ", all hosted urls live" : ""));
