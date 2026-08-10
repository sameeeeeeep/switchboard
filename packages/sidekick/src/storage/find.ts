import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expandTilde, type StorageStore } from "./store.js";

/**
 * LOCAL, DETERMINISTIC vault lookup — the "find" path (docs/FIND.md).
 *
 * Goal (founder's words): "If I want the GST number of nailinit I shouldn't have to search it every
 * time — I could just use dictation and through a modifier key make it FIND info, WITHOUT it getting
 * passed through the Claude call."
 *
 * So this resolver turns a natural-ish query like "GST number of nailinit" or "nailinit gst" into the
 * matched value, pulled STRAIGHT from the user's local `.md` vault via the StorageStore. There is NO
 * model call, NO network, and NO shelling out — it is pure string work over bytes already on disk.
 * That privacy guarantee is the whole point: the returned value never enters an LLM prompt and never
 * leaves the machine.
 *
 * It reads THROUGH the StorageStore (never arbitrary disk paths), so per-origin isolation is unchanged
 * — a find only ever sees the origin's OWN bound vault (or its private sandbox). A find is a READ, so
 * the Broker gates it exactly like `storage.get`: a standing grant, no new consent prompt.
 */

export interface FindHit {
  /** The matched value, ready to paste at the cursor. */
  value: string;
  /** The note field label the value came from (e.g. "GST"). */
  field: string;
  /** The note's display name / entity (e.g. "nailinit"). */
  entity: string;
  /** The vault key the value was read from (e.g. "nailinit.md"). */
  source: string;
  /** 0..1 — how confident the match is. Below threshold we return null instead of guessing. */
  confidence: number;
}

/** Below this, we return null rather than hand back a shaky guess. */
const CONFIDENCE_THRESHOLD = 0.5;
/** A field must match at least this well to be considered at all. */
const FIELD_THRESHOLD = 0.5;
/** A query token must match a note name this well to be treated as naming that entity. */
const ENTITY_THRESHOLD = 0.8;

/** Words that carry no lookup signal — dropped from the query before entity/field extraction. */
const STOPWORDS = new Set([
  "of", "the", "for", "my", "a", "an", "is", "are", "was", "what", "whats", "what's",
  "in", "on", "to", "get", "find", "give", "show", "tell", "me", "please", "s", "the",
  "value", "info", "detail", "details", "and", "with",
]);

/** Field-name noise: "gst" ≈ "gst number" ≈ "gst no." ≈ "gst#". Stripped from BOTH sides before
 *  comparing, so the founder's shorthand matches the note's fuller label. */
const FIELD_NOISE = new Set(["number", "no", "num", "nbr", "#"]);

// ── small, dependency-free string primitives ──────────────────────────────────────────────────

/** Lowercase, fold every non-alphanumeric run to a single space, trim. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(s: string): string[] {
  const n = normalize(s);
  return n.length ? n.split(" ") : [];
}

/** Tokens with a stopword filter, for the query. */
function queryTokens(s: string): string[] {
  return tokenize(s).filter((t) => !STOPWORDS.has(t));
}

/** Drop field-noise tokens ("number"/"no"/…), then join with no separator — the "compact" form used
 *  for containment + edit-distance comparison. Also returns the surviving token set for overlap. */
function fieldForm(label: string): { compact: string; tokens: string[] } {
  const toks = tokenize(label).filter((t) => !FIELD_NOISE.has(t));
  return { compact: toks.join(""), tokens: toks };
}

/** Classic Levenshtein edit distance (iterative, O(a*b) space-light). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** Normalized edit-distance similarity in [0,1]. */
function editSim(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 0 : 1 - editDistance(a, b) / max;
}

/** Jaccard token overlap in [0,1]. */
function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

/** How well a query field ("gst", "insta") matches a note's field label ("GST", "Instagram"). */
function fieldMatchScore(queryField: string, noteLabel: string): number {
  const q = fieldForm(queryField);
  const n = fieldForm(noteLabel);
  if (!q.compact || !n.compact) return 0;
  if (q.compact === n.compact) return 1;
  let score = Math.max(jaccard(q.tokens, n.tokens), editSim(q.compact, n.compact));
  // Prefix / substring (e.g. "insta" ⊂ "instagram", "gst" ⊂ "gstin") is a strong signal.
  if (n.compact.includes(q.compact) || q.compact.includes(n.compact)) score = Math.max(score, 0.9);
  return score;
}

/** How well a single query token names a note entity ("nailinit" → the nailinit note). */
function entityMatchScore(token: string, noteNameCompact: string): number {
  const t = normalize(token).replace(/\s+/g, "");
  if (!t || !noteNameCompact) return 0;
  if (t === noteNameCompact) return 1;
  let score = editSim(t, noteNameCompact);
  if (noteNameCompact.includes(t) || t.includes(noteNameCompact)) score = Math.max(score, 0.85);
  return score;
}

// ── markdown field parsing (the reusable idea from examples/apps/src/bank.js ~line 630) ───────────

interface ParsedField { label: string; value: string; }

/** Pull `Field: value` pairs out of one note's markdown, tolerating the common vault dialects:
 *    - `**Field:** value`            (bold key)
 *    - `- **Field:** value`          (bold key in a bullet)
 *    - `Field: value`                (plain / front-matter-ish `key: value`)
 *    - `| Field | value |`           (two-column table row)
 *  Never throws — a malformed line is skipped, not fatal. Downstream fuzzy-matching filters out any
 *  junk label a loose pattern lets through (a garbage "see https" label just never matches a query). */
function parseFields(md: string): ParsedField[] {
  const out: ParsedField[] = [];
  const push = (label: string, value: string) => {
    const l = label.trim();
    const v = value.trim().replace(/\s*<!--.*?-->\s*$/, "").trim();
    if (l && v && l.length <= 60) out.push({ label: l, value: v });
  };
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\r$/, "");
    // bold key, optionally inside a bullet: `- **Field:** value` / `**Field:** value`
    let m = /^\s*(?:[-*]\s+)?\*\*([^:*][^:]*):\*\*\s*(.+)$/.exec(line);
    if (m) { push(m[1]!, m[2]!); continue; }
    // table row: `| Field | value |` (skip header separators like `| --- | --- |`)
    if (/^\s*\|/.test(line)) {
      const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length === 2 && !/^:?-{2,}:?$/.test(cells[0]!) && !/^:?-{2,}:?$/.test(cells[1]!)) {
        push(cells[0]!, cells[1]!);
      }
      continue;
    }
    // plain `Field: value` / front-matter `key: value`. Keep the label short + word-y so prose and
    // URLs ("see https://…") don't masquerade as fields; anything loose still gets fuzzy-filtered.
    m = /^\s*([A-Za-z][A-Za-z0-9 _\/-]{0,40}):\s+(\S.*)$/.exec(line);
    if (m && !/https?$/i.test(m[1]!.trim())) { push(m[1]!, m[2]!); continue; }
  }
  return out;
}

/** The note's human name: prefer a `# H1`, else the filename without extension, with a leading
 *  `project-` stripped (a `project-indeur.md` is the "indeur" entity). */
function entityNameOf(key: string, md: string): string {
  const h1 = /^\s*#\s+(.+)$/m.exec(md);
  if (h1 && h1[1]!.trim()) return h1[1]!.trim();
  let base = key.replace(/\.[a-z0-9]+$/i, "");
  base = base.replace(/^project-/i, "");
  return base;
}

/** Does a vault key belong to the named project? Matches `project-<slug>.md`, `<slug>.md`, or any
 *  key whose normalized form contains the project slug. */
function keyMatchesProject(key: string, project: string): boolean {
  const p = normalize(project).replace(/\s+/g, "");
  if (!p) return false;
  const k = normalize(key).replace(/\s+/g, "");
  return k.includes(p);
}

/** A markdown note as bytes-in-hand — the source-agnostic input to the resolver core. */
export interface RawNote { key: string; md: string; }

/**
 * The resolver CORE — matches a query over already-loaded notes. Source-agnostic so the same scoring
 * serves both the per-origin store path (`resolveFind`) and the trusted active-project folder path
 * (`findInFolder`). Pure/local/sync. Returns the best confident match, or null. NEVER throws — a
 * malformed note degrades to null so one bad file can't break a lookup.
 */
export function resolveFindOverNotes(rawNotes: RawNote[], query: string, project?: string): FindHit | null {
  try {
    const qToks = queryTokens(query);
    if (!qToks.length) return null;

    interface Note { key: string; entity: string; nameCompact: string; md: string; }
    const notes: Note[] = [];
    for (const r of rawNotes) {
      if (!r.key.toLowerCase().endsWith(".md") || !r.md) continue;
      const entity = entityNameOf(r.key, r.md);
      notes.push({ key: r.key, entity, nameCompact: normalize(entity).replace(/\s+/g, ""), md: r.md });
    }
    if (!notes.length) return null;

    // 1. Find the query token that best NAMES a note (the entity), and which note that is.
    let bestEntity: Note | null = null;
    let bestEntityScore = 0;
    let consumedToken: string | null = null;
    for (const note of notes) {
      for (const t of qToks) {
        const s = entityMatchScore(t, note.nameCompact);
        if (s > bestEntityScore) { bestEntityScore = s; bestEntity = note; consumedToken = t; }
      }
    }
    const entityMatched = bestEntityScore >= ENTITY_THRESHOLD && !!bestEntity;

    // 2. Whatever's left of the query (minus the entity token + field noise) is the FIELD query.
    const fieldToks = qToks.filter((t) => (entityMatched ? t !== consumedToken : true) && !FIELD_NOISE.has(t));
    const fieldQuery = fieldToks.join(" ");
    if (!fieldQuery) return null; // nothing left to look up (e.g. bare entity name)

    // 3. Decide which notes to search: an explicit project scopes it; else the matched entity; else
    //    (a field-only query like "gst" with no entity) fall back to the whole vault.
    let candidates: Note[];
    if (project) candidates = notes.filter((n) => keyMatchesProject(n.key, project));
    else if (entityMatched && bestEntity) candidates = [bestEntity];
    else candidates = notes;
    if (!candidates.length) return null;

    // 4. Best field match across the candidate notes.
    let best: { field: ParsedField; note: Note; score: number } | null = null;
    for (const note of candidates) {
      let fields: ParsedField[];
      try { fields = parseFields(note.md); } catch { continue; } // one bad note must not break the lookup
      for (const f of fields) {
        const score = fieldMatchScore(fieldQuery, f.label);
        if (!best || score > best.score) best = { field: f, note, score };
      }
    }
    if (!best || best.score < FIELD_THRESHOLD) return null;

    // 5. Confidence blends the field match with how sure we are of the entity. A field-only fallback
    //    (no entity pinned) is discounted so a stray whole-vault match can't read as certain.
    const entityFactor = entityMatched ? 0.6 + 0.4 * bestEntityScore : 0.6;
    const confidence = Math.min(1, best.score * entityFactor);
    if (confidence < CONFIDENCE_THRESHOLD) return null;

    return {
      value: best.field.value,
      field: best.field.label,
      entity: best.note.entity,
      source: best.note.key,
      confidence: Math.round(confidence * 1000) / 1000,
    };
  } catch {
    // Belt-and-braces: the resolver NEVER throws to the caller. Any surprise degrades to "no match".
    return null;
  }
}

/**
 * Per-origin path (web/extension apps). Reads THROUGH the store (list + get, never the disk directly),
 * so per-origin isolation is unchanged — a find only ever sees the origin's OWN bound vault. A find is
 * a READ, gated exactly like `storage.get` (standing grant, no new consent prompt).
 */
export function resolveFind(
  store: StorageStore,
  origin: string,
  query: string,
  project?: string,
): FindHit | null {
  try {
    let keys: string[];
    try { keys = store.list(origin); } catch { return null; }
    const raw: RawNote[] = [];
    for (const key of keys) {
      if (!key.toLowerCase().endsWith(".md")) continue;
      let md: string | null;
      try { md = store.get(origin, key); } catch { md = null; }
      if (md) raw.push({ key, md });
    }
    return resolveFindOverNotes(raw, query, project);
  } catch {
    return null;
  }
}

/**
 * TRUSTED path — the menu-bar control channel (dictation Fn→find). Reads the ACTIVE project's vault
 * FOLDER directly (the storage model is flat: top-level `.md` files, keys ARE filenames). This is the
 * user themselves on their own machine reading their own active project — the same trust level as God
 * reading the active project's vault — so a direct folder read is legitimate here where the per-origin
 * app path would not be. Still pure/local: no model, no network, and NEVER throws.
 */
export function findInFolder(folder: string, query: string, project?: string): FindHit | null {
  try {
    const dir = expandTilde(folder);
    let names: string[];
    try { names = readdirSync(dir); } catch { return null; }   // no folder / unreadable → no match
    const raw: RawNote[] = [];
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      try { raw.push({ key: name, md: readFileSync(join(dir, name), "utf8") }); } catch { /* skip one bad file */ }
    }
    return resolveFindOverNotes(raw, query, project);
  } catch {
    return null;
  }
}
