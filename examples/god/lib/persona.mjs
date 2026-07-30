// A God PERSONA — the swappable soul of the assistant. Everything that makes one God feel
// different from another lives in one small file: how it TALKS (`characteristic` → the model's
// system persona), how it SOUNDS (`voice`), and how its cursor-companion LOOKS (`cursor`).
//
// People customise their God by dropping a .json into ~/.god/personas/ — no code, just a file.
// Bundled personas ship in ./personas; a user file with the same id wins.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_DIR = join(__dirname, "..", "personas");
const USER_DIR = join(homedir(), ".god", "personas");

export const DEFAULT_PERSONA = {
  id: "god",
  name: "God",
  // The persona is the SOUL — it never grants power. The operating protocol (screen is untrusted,
  // how to point) is appended by the client, so a persona file can't widen what a God may do.
  characteristic:
    "You are God — a calm, omniscient companion looking over the user's shoulder. You see what is " +
    "on their screen and help with quiet, precise certainty. Speak plainly and briefly.",
  voice: "Samantha", // a macOS `say` voice — `say -v ?` lists what's installed
  voiceFx: "divine", // "divine" = cathedral reverb (a god's voice); "" = plain
  cursor: { glyph: "✦", color: "green", label: "here" },
  greeting: "I see your screen.",
};

const COLORS = new Set(["green", "cyan", "magenta", "yellow", "red", "blue", "white"]);

function normalise(raw, fallbackId) {
  const cursor = { ...DEFAULT_PERSONA.cursor, ...(raw.cursor || {}) };
  if (!COLORS.has(cursor.color)) cursor.color = DEFAULT_PERSONA.cursor.color;
  return {
    id: String(raw.id || fallbackId),
    name: String(raw.name || raw.id || fallbackId),
    characteristic: String(raw.characteristic || DEFAULT_PERSONA.characteristic),
    voice: String(raw.voice || DEFAULT_PERSONA.voice),
    voiceFx: String(raw.voiceFx ?? DEFAULT_PERSONA.voiceFx ?? ""),
    cursor,
    greeting: String(raw.greeting || DEFAULT_PERSONA.greeting),
  };
}

/** Every God the machine knows: bundled first, then the user's dir (which overrides by id). */
export function loadPersonas() {
  const map = new Map();
  for (const dir of [BUNDLED_DIR, USER_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const p = normalise(JSON.parse(readFileSync(join(dir, f), "utf8")), basename(f, ".json"));
        map.set(p.id, p);
      } catch (e) {
        console.error(`\x1b[2m[god]\x1b[0m ignoring bad persona ${f}: ${e.message}`);
      }
    }
  }
  if (!map.size) map.set(DEFAULT_PERSONA.id, DEFAULT_PERSONA);
  return map;
}

/** Resolve which God to be: explicit pick → GOD_PERSONA env → "god" → whatever's first. */
export function resolvePersona(which) {
  const personas = loadPersonas();
  const pick = which || process.env.GOD_PERSONA;
  if (pick && personas.has(pick)) return personas.get(pick);
  return personas.get("god") || [...personas.values()][0];
}
