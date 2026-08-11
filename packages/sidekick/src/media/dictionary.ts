import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The dictation DICTIONARY — the user's vocabulary, fed to whisper.cpp as its `--prompt` (the
 * "initial prompt": text treated as if spoken just before the audio) so recognition biases toward
 * THEIR names and jargon instead of mangling them ("wrapp"→"wrap", "Redline"→"red line", "Sameep"→
 * "Sameeb"). This is Whisper's ONLY vocabulary lever — a soft bias, not a hard lexicon — and it's
 * capped at n_text_ctx/2 (~224 tokens), so the glossary is composed, deduped, and length-capped.
 *
 * Source of truth is a plain, user-editable file at ~/.relay/dictionary.txt. It's SEEDED once from
 * every on-device source (the user's name, the wrapp catalog, the vault's brand/project names) and
 * then owned by the user — we never overwrite it. Both STT paths read it: the daemon (media/stt.ts)
 * and the menu-bar ⌃⌥ gesture (RelayMenuBar.swift reads the same file).
 */

const RELAY = process.env.RELAY_HOME || join(homedir(), ".relay");
const DICT_PATH = join(RELAY, "dictionary.txt");

// whisper's initial prompt is capped at n_text_ctx/2 (~224 tokens). ~800 chars ≈ ~200 tokens keeps
// the WHOLE glossary inside the budget instead of letting whisper silently truncate the tail.
const MAX_CHARS = 800;

// Product/domain terms Whisper's small models reliably get wrong. Seeded first so they always survive
// the length cap even if the catalog/vault is large.
const CORE_TERMS = [
  "Switchboard", "Relay", "wrapp", "wrapps", "brandbrain", "ideabrain",
  "Redline", "Bank", "Autopilot", "notch", "God", "Guru", "Flow",
];

function readJson(name: string): any {
  try { return JSON.parse(readFileSync(join(RELAY, name), "utf8")); } catch { return null; }
}

// Keep short proper-noun-ish names; drop sentence-y idea descriptions and truncated "…" blobs that
// would waste the token budget and bias toward filler rather than vocabulary.
function looksLikeName(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t || t.length > 28 || t.includes("…") || t.includes("...")) return false;
  return t.split(/\s+/).length <= 3;
}

function dedupe(terms: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of terms) { const k = t.toLowerCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

/** Compose the glossary from every on-device source. Core terms first (so they win the cap). */
export function buildDictionaryTerms(): string[] {
  const terms: string[] = [...CORE_TERMS];
  const identity = readJson("identity.json") || {};
  const profile = readJson("profile.json") || {};
  for (const n of [identity.name, profile.name, identity.company]) if (looksLikeName(n)) terms.push(n);
  const catalog = readJson("catalog.json");
  const listings = catalog?.listings || catalog?.wrapps || [];
  for (const w of Array.isArray(listings) ? listings : []) if (looksLikeName(w?.name)) terms.push(w.name);
  const contexts = readJson("contexts.json");
  for (const c of Array.isArray(contexts) ? contexts : []) {
    if ((c?.kind === "brand" || c?.kind === "project") && looksLikeName(c?.name)) terms.push(c.name);
  }
  return dedupe(terms);
}

/** Seed ~/.relay/dictionary.txt once if absent. Never overwrites — the file is the user's to edit. */
export function seedDictionaryIfMissing(): void {
  try {
    if (existsSync(DICT_PATH)) return;
    const body = [
      "# Switchboard dictation dictionary — words Whisper should recognise verbatim (your name, brand",
      "# and product terms, jargon). One per line or comma-separated; lines starting with '#' are",
      "# ignored. This is fed to whisper.cpp as its --prompt so dictation biases toward YOUR vocabulary.",
      "# Edit freely. Delete this file to regenerate it from your name, wrapps, and vault.",
      "",
      buildDictionaryTerms().join(", "),
      "",
    ].join("\n");
    writeFileSync(DICT_PATH, body);
  } catch { /* best-effort: dictation still works without a dictionary */ }
}

/** The whisper `--prompt` string: the file's non-comment terms, deduped and capped. "" if none. */
export function readDictionaryPrompt(): string {
  try {
    seedDictionaryIfMissing();
    const raw = readFileSync(DICT_PATH, "utf8");
    const terms = raw
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("#"))
      .join(",")
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    let s = dedupe(terms).join(", ");
    if (s.length > MAX_CHARS) s = s.slice(0, MAX_CHARS).replace(/,[^,]*$/, ""); // trim to a whole term
    return s;
  } catch { return ""; }
}
