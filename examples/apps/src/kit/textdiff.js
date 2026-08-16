// TEXT DIFF — the pure logic behind "what changed between these two blocks of text?".
//
// Harvested-idea sibling of kit/contrast.js / kit/qr-payload.js: a deterministic, in-tab, no-model
// function. Classic Myers-style LCS (longest common subsequence) over tokens — lines by default, or
// words — emitting a flat op list the UI, the God tool and the widget all render from. No diff library.
//
// Pure: no DOM, no imports, no side effects. Headless-testable (kit/textdiff.test.mjs). The load-bearing
// invariant the test pins: concatenating every non-'remove' op reconstructs text B exactly.

/** LCS table → a flat op list of {type:'equal'|'add'|'remove', value} over two token arrays.
 *  O(n·m) memory, which is fine for the text sizes a person pastes into a diff box. */
function diffTokens(aToks, bToks) {
  const n = aToks.length, m = bToks.length;
  // lcs[i][j] = length of the LCS of aToks[i:] and bToks[j:]
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = aToks[i] === bToks[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aToks[i] === bToks[j]) { ops.push({ type: "equal", value: aToks[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ type: "remove", value: aToks[i] }); i++; }
    else { ops.push({ type: "add", value: bToks[j] }); j++; }
  }
  while (i < n) ops.push({ type: "remove", value: aToks[i++] });
  while (j < m) ops.push({ type: "add", value: bToks[j++] });
  return ops;
}

/** Split into lines WITHOUT losing the trailing newline info — we compare line CONTENT, so normalise
 *  CRLF and split on \n. An empty string is zero lines (not one empty line), so a blank input diffs
 *  cleanly against a filled one. */
function toLines(text) {
  const s = String(text ?? "").replace(/\r\n/g, "\n");
  return s === "" ? [] : s.split("\n");
}

/** Split into words + the whitespace between them, keeping BOTH as tokens so the round-trip holds
 *  (a word diff that dropped spaces couldn't reconstruct B). */
function toWords(text) {
  const s = String(text ?? "");
  return s === "" ? [] : s.match(/\s+|\S+/g) || [];
}

/** Line-level diff. Each op's value is one line (no newline char). */
export function diffLines(a, b) { return diffTokens(toLines(a), toLines(b)); }

/** Word-level diff. Each op's value is a word or a run of whitespace. */
export function diffWords(a, b) { return diffTokens(toWords(a), toWords(b)); }

/** Tally an op list. `unchanged` counts equal tokens; add/remove count the changed ones. */
export function stats(ops) {
  let added = 0, removed = 0, unchanged = 0;
  for (const o of ops) {
    if (o.type === "add") added++;
    else if (o.type === "remove") removed++;
    else unchanged++;
  }
  return { added, removed, unchanged, changed: added + removed };
}

/** Reconstruct text B from an op list (everything that isn't a removal), joined the way it was split.
 *  Exposed because it IS the correctness contract — the UI never needs it, but the test asserts it. */
export function reconstructB(ops, mode = "lines") {
  const kept = ops.filter((o) => o.type !== "remove").map((o) => o.value);
  return mode === "words" ? kept.join("") : kept.join("\n");
}

/** One-line summary for the widget / God tool. */
export function summarize(ops) {
  const s = stats(ops);
  if (s.added === 0 && s.removed === 0) return "No differences — the two texts are identical.";
  return `+${s.added} −${s.removed}`;
}
