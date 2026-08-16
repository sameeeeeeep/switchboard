// WORD COUNT — the pure text-analysis behind "how big is this, and what's it made of?".
//
// Harvested-idea sibling of kit/contrast.js: a deterministic, in-tab, no-model function that any
// wrapp/God-tool/widget can call. Text in, a stats object out — words, characters, sentences,
// paragraphs, reading + speaking time, the longest word, the average word length, and a
// stopword-filtered top-word list. That shape fits a launcher command + a notch glance exactly, so
// it lives factored out and tested against hand-counted reference values, not eyeballed.
//
// Pure: no DOM, no imports, no side effects. Headless-testable (kit/wordcount.test.mjs).

// ── word tokenisation ───────────────────────────────────────────────────────────────────────
// A "word" is a run of Unicode letters/numbers (\p{L}\p{N}), so accents, non-Latin scripts and
// digits all count — and an internal apostrophe or hyphen keeps "don't" / "well-being" as ONE word
// instead of splitting them and inflating the count. Punctuation and whitespace are separators.
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** The raw word tokens of a string, in order. Empty array for empty/blank input (never null). */
export function words(text) {
  return (text == null ? "" : String(text)).match(WORD_RE) || [];
}

// ── reading / speaking pace ─────────────────────────────────────────────────────────────────
// The rates the reference tools use: ~200 wpm silent reading, ~130 wpm comfortable speaking.
export const READING_WPM = 200;
export const SPEAKING_WPM = 130;

// Whole-minute ceiling so a glance reads "1 min", "2 min" — never "0.09 min". Empty text is 0, not a
// rounded-up 1, so the empty state stays honestly empty.
const minutesFor = (wordCount, wpm) => (wordCount ? Math.ceil(wordCount / wpm) : 0);

// ── sentence / paragraph segmentation ───────────────────────────────────────────────────────
// Sentences: spans terminated by . ! ? … — a trailing span with no terminator still counts (a note
// with no full stop is one sentence, not zero). Blank input is zero.
function countSentences(s) {
  const t = s.trim();
  if (!t) return 0;
  return t.split(/[.!?…]+/).filter((x) => x.trim().length > 0).length;
}
// Paragraphs: blocks separated by a blank line (one-or-more newlines with only whitespace between).
// Single/soft newlines stay within a paragraph, matching how prose is actually laid out.
function countParagraphs(s) {
  const t = s.trim();
  if (!t) return 0;
  return t.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
}

// ── the main analysis ───────────────────────────────────────────────────────────────────────
/** Everything the UI, the God tool and the widget render is derived from this one object. `topN`
 *  caps the frequency list. Never throws, never returns NaN — empty input is all-zeros. */
export function analyze(text, { topN = 5 } = {}) {
  const s = text == null ? "" : String(text);
  const ws = s.match(WORD_RE) || [];
  const wordCount = ws.length;

  // longest word + running length total in one pass (avoids a second scan for the average).
  let longestWord = "";
  let totalLen = 0;
  for (const w of ws) {
    totalLen += w.length;
    if (w.length > longestWord.length) longestWord = w;
  }
  // Guard the division: no words → 0, not 0/0 = NaN. Two decimals is enough precision to show.
  const avgWordLen = wordCount ? Math.round((totalLen / wordCount) * 100) / 100 : 0;

  return {
    words: wordCount,
    chars: s.length,                         // every character, spaces and newlines included
    charsNoSpaces: s.replace(/\s/g, "").length,
    sentences: countSentences(s),
    paragraphs: countParagraphs(s),
    readingMins: minutesFor(wordCount, READING_WPM),
    speakingMins: minutesFor(wordCount, SPEAKING_WPM),
    longestWord,
    avgWordLen,
    topWords: topWords(ws, topN),
  };
}

// ── word frequency ──────────────────────────────────────────────────────────────────────────
/** Case-insensitive counts with the common function-words removed (they'd otherwise dominate every
 *  list). Sorted by count desc, then alphabetically so ties are stable and the output deterministic.
 *  Accepts either a string or a pre-tokenised array (the UI already has the tokens). */
export function topWords(input, topN = 5) {
  const ws = Array.isArray(input) ? input : (input == null ? "" : String(input)).match(WORD_RE) || [];
  const counts = new Map();
  for (const w of ws) {
    const k = w.toLowerCase();
    if (STOPWORDS.has(k)) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, Math.max(0, topN))
    .map(([word, count]) => ({ word, count }));
}

// The English function-words a frequency list should ignore — articles, pronouns, prepositions,
// conjunctions, auxiliaries. Not exhaustive; the set that would otherwise top every single list.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
  "did", "do", "does", "done", "for", "from", "had", "has", "have", "he",
  "her", "hers", "him", "his", "i", "if", "in", "into", "is", "it", "its",
  "me", "my", "no", "nor", "not", "of", "on", "or", "our", "ours", "over",
  "she", "so", "than", "that", "the", "their", "theirs", "them", "then",
  "there", "these", "they", "this", "to", "too", "up", "us", "very", "was",
  "we", "were", "what", "when", "where", "which", "who", "whom", "why",
  "will", "with", "would", "you", "your", "yours",
]);
