// Real test for the north-star meter core. Run: node weekly-counter.test.mjs
import assert from "node:assert/strict";
import { isoWeek, anonId, emptyState, ingest, weekly, EMIT_KEYS } from "./weekly-counter.mjs";

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ok -", name); };

// two known dates in different ISO weeks
const wkA = Date.UTC(2026, 6, 27); // Mon 2026-07-27  -> W31
const wkB = Date.UTC(2026, 7, 4);  // Tue 2026-08-04  -> W32

t("isoWeek buckets by ISO week", () => {
  assert.equal(isoWeek(wkA), "2026-W31");
  assert.equal(isoWeek(wkB), "2026-W32");
});

t("ingest counts runs + distinct wrapps per week", () => {
  const s = emptyState();
  ingest(s, { ts: wkA, wrappId: "bank" });
  ingest(s, { ts: wkA, wrappId: "bank" });   // same wrapp -> runs 2, wrapps 1
  ingest(s, { ts: wkA, wrappId: "crest" });  // -> runs 3, wrapps 2
  ingest(s, { ts: wkB, wrappId: "bank" });   // next week
  assert.equal(s.weeks["2026-W31"].runs, 3);
  assert.equal(s.weeks["2026-W31"].wrapps.size, 2);
  assert.equal(s.weeks["2026-W32"].runs, 1);
});

t("runsAtLeast is a FLOOR (honest lower bound), never the exact count", () => {
  const s = emptyState();
  for (let i = 0; i < 47; i++) ingest(s, { ts: wkA, wrappId: "bank" });
  const [rec] = weekly(s, "secret", { floorTo: 10 });
  assert.equal(rec.runsAtLeast, 40);         // 47 floored to 40 — we never over-report
  assert.ok(rec.runsAtLeast <= 47);
});

t("anonId rotates per week, is stable within a week, and leaks no identity", () => {
  const a = anonId("install-secret-xyz", "2026-W31");
  const b = anonId("install-secret-xyz", "2026-W31");
  const c = anonId("install-secret-xyz", "2026-W32");
  assert.equal(a, b);                        // stable within a week (retention derivable)
  assert.notEqual(a, c);                     // rotates across weeks
  assert.ok(!a.includes("install-secret"));  // never contains the secret
  assert.equal(a.length, 16);
});

t("PRIVACY INVARIANT: emitted record has ONLY the 4 allowed keys", () => {
  const s = emptyState();
  ingest(s, { ts: wkA, wrappId: "bank" });
  const [rec] = weekly(s, "secret");
  assert.deepEqual(Object.keys(rec).sort(), [...EMIT_KEYS].sort());
  // no prompt / content / url / user-id fields snuck in
  for (const k of Object.keys(rec)) assert.ok(EMIT_KEYS.includes(k), `leaked field: ${k}`);
});

console.log(`\n${pass}/${pass} passed`);
