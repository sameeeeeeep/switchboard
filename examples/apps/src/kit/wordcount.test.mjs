// Headless assertions for the word-count analysis. No browser, no bundler:
//   node examples/apps/src/kit/wordcount.test.mjs
// The happy-path counts are hand-verified against a fixed paragraph, because "looks about right" is
// exactly how an off-by-one tokeniser ships a word count nobody trusts.
import { analyze, words, topWords, READING_WPM, SPEAKING_WPM } from "./wordcount.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };
const eq = (got, want, what) => expect(got === want, `${what} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

console.log("\n── a known paragraph (hand-counted) ─────────────────────");
// 18 words · 85 chars · 17 spaces · 3 sentences · 1 paragraph. "dog" is the only word said twice.
const P = "The quick brown fox jumps over the lazy dog. The dog was not amused! Why would it be?";
const a = analyze(P);
eq(a.words, 18, "words");
eq(a.chars, 85, "chars (spaces + punctuation included)");
eq(a.charsNoSpaces, 68, "charsNoSpaces (85 − 17 spaces)");
eq(a.sentences, 3, "sentences (split on . ! ?)");
eq(a.paragraphs, 1, "paragraphs (no blank line = one block)");
eq(a.longestWord, "amused", "longestWord");
eq(a.avgWordLen, 3.61, "avgWordLen = 65/18 → 3.61");
eq(a.readingMins, Math.ceil(18 / READING_WPM), "readingMins ceils 18/200 → 1");
eq(a.speakingMins, Math.ceil(18 / SPEAKING_WPM), "speakingMins ceils 18/130 → 1");
expect(a.topWords[0] && a.topWords[0].word === "dog" && a.topWords[0].count === 2, "topWords leads with dog×2");
expect(!a.topWords.some((w) => w.word === "the"), "topWords excludes the stopword 'the'");
expect(a.topWords.length <= 5, "topWords honours the default top-5 cap");

console.log("\n── empty / blank input → all zeros, no NaN ──────────────");
for (const empty of ["", "   \n\t  ", null, undefined]) {
  const z = analyze(empty);
  const allZero = z.words === 0 && z.chars === (empty ? String(empty).length : 0) && z.charsNoSpaces === 0 &&
    z.sentences === 0 && z.paragraphs === 0 && z.readingMins === 0 && z.speakingMins === 0 &&
    z.longestWord === "" && z.avgWordLen === 0 && z.topWords.length === 0;
  expect(allZero, `blank input ${JSON.stringify(empty)} → zeros, empty topWords`);
  expect(!Number.isNaN(z.avgWordLen), `avgWordLen is a number for ${JSON.stringify(empty)}, never NaN`);
}

console.log("\n── a single word ───────────────────────────────────────");
const one = analyze("Hello");
eq(one.words, 1, "one word");
eq(one.chars, 5, "5 chars");
eq(one.charsNoSpaces, 5, "5 chars no spaces");
eq(one.sentences, 1, "1 sentence (no terminator still counts)");
eq(one.paragraphs, 1, "1 paragraph");
eq(one.longestWord, "Hello", "longestWord is the word itself");
eq(one.avgWordLen, 5, "avgWordLen = 5");

console.log("\n── whitespace collapses ─────────────────────────────────");
const messy = analyze("  hello   world  \n\n  ");
eq(messy.words, 2, "runs of spaces/newlines don't create phantom words");
eq(messy.paragraphs, 1, "trailing blank line adds no empty paragraph");
eq(words("one\ttwo\nthree   four").length, 4, "tabs/newlines/multi-space all split");

console.log("\n── unicode-aware tokenising ─────────────────────────────");
eq(analyze("café déjà vu").words, 3, "accented letters stay inside words");
eq(analyze("don't well-being").words, 2, "internal ' and - keep a word whole");
eq(analyze("touché 42 π").words, 3, "digits and non-Latin letters count");

console.log("\n── frequency: stopwords out, sorted by count ────────────");
const freq = topWords("the cat the cat the dog runs");
expect(freq[0].word === "cat" && freq[0].count === 2, "cat×2 leads");
expect(freq.some((w) => w.word === "dog" && w.count === 1), "dog×1 present");
expect(!freq.some((w) => w.word === "the"), "'the' excluded as a stopword");
expect(freq.every((w, i) => i === 0 || freq[i - 1].count >= w.count), "sorted by count descending");
// case-insensitive folding: The/THE/the collapse to one bucket.
const folded = topWords("Apple apple APPLE banana");
expect(folded[0].word === "apple" && folded[0].count === 3, "case-insensitive: Apple/apple/APPLE = apple×3");
eq(topWords("alpha beta gamma delta epsilon zeta", 3).length, 3, "topN caps the list length");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
