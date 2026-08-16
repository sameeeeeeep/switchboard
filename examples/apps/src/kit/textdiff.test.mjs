// Headless assertions for the text-diff logic. No browser, no bundler:
//   node examples/apps/src/kit/textdiff.test.mjs
// The load-bearing check is the ROUND-TRIP: whatever ops we emit, the non-removed pieces must
// reconstruct text B exactly — a diff that can't rebuild the target is silently wrong.
import { diffLines, diffWords, stats, reconstructB, summarize } from "./textdiff.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

// property: for any A,B the line diff reconstructs B
function roundTrips(a, b) { return reconstructB(diffLines(a, b), "lines") === String(b).replace(/\r\n/g, "\n"); }
function roundTripsW(a, b) { return reconstructB(diffWords(a, b), "words") === String(b); }

console.log("\n── identical / empty ────────────────────────────────────");
{
  const ops = diffLines("a\nb\nc", "a\nb\nc");
  const s = stats(ops);
  expect(ops.every((o) => o.type === "equal"), "identical text → all 'equal' ops");
  expect(s.added === 0 && s.removed === 0 && s.unchanged === 3, "identical → +0 −0, 3 unchanged");
  expect(summarize(ops).startsWith("No differences"), "identical → 'No differences' summary");
}
expect(stats(diffLines("", "")).changed === 0, "empty vs empty → no changes");
expect(reconstructB(diffLines("", "hello"), "lines") === "hello", "empty vs filled reconstructs B");
{
  const ops = diffLines("old line", "");
  const s = stats(ops);
  expect(s.removed === 1 && s.added === 0, "filled vs empty → one removal");
}

console.log("\n── line diff ────────────────────────────────────────────");
{
  const a = "one\ntwo\nthree", b = "one\ntwo point five\nthree";
  const ops = diffLines(a, b);
  const s = stats(ops);
  expect(s.added === 1 && s.removed === 1 && s.unchanged === 2, "one changed line → +1 −1, 2 kept");
  expect(roundTrips(a, b), "changed-line diff reconstructs B");
}
{
  const a = "keep\nkeep", b = "keep\nnew\nkeep";   // pure insertion in the middle
  const s = stats(diffLines(a, b));
  expect(s.added === 1 && s.removed === 0, "pure insertion → +1 −0");
  expect(roundTrips(a, b), "insertion reconstructs B");
}
{
  const a = "a\nb\nc\nd", b = "a\nd";   // two removals
  const s = stats(diffLines(a, b));
  expect(s.removed === 2 && s.added === 0, "two removals → −2");
  expect(roundTrips(a, b), "removals reconstruct B");
}
expect(roundTrips("x\r\ny", "x\r\nz"), "CRLF is normalised and still round-trips");

console.log("\n── word diff ────────────────────────────────────────────");
{
  const a = "the quick brown fox", b = "the quick red fox";
  const ops = diffWords(a, b);
  // exactly the word 'brown' → 'red' should change; spaces + other words stay
  const changed = ops.filter((o) => o.type !== "equal").map((o) => o.value.trim()).filter(Boolean);
  expect(changed.includes("brown") && changed.includes("red") && changed.length === 2,
         "one-word change touches only that word");
  expect(roundTripsW(a, b), "word diff reconstructs B (whitespace preserved)");
}
expect(roundTripsW("hello world", "hello   world"), "whitespace-only change round-trips");

console.log("\n── a few random-ish round-trips (the real guarantee) ────");
const cases = [
  ["", "a b c"], ["a b c", ""], ["lorem ipsum dolor", "lorem dolor sit"],
  ["1\n2\n3\n4\n5", "1\n3\n5\n7"], ["same", "same"], ["a\n\nb", "a\nb\n"],
];
let allRT = true;
for (const [a, b] of cases) if (!roundTrips(a, b)) { allRT = false; console.log("      ✗ failed on", JSON.stringify([a, b])); }
expect(allRT, "every sample line-diff reconstructs B");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
