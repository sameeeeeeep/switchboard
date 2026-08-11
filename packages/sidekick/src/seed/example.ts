import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ContextLibrary } from "../context/library.js";
import type { StorageStore } from "../storage/store.js";

/**
 * FIRST-RUN SEED — so a brand-new machine isn't a wall of empty panes.
 *
 * The single most common "is this thing even working?" moment is opening the OS or brandbrain and seeing
 * nothing. This seeds ONE example project (a brand context) and makes it the active "working on" project,
 * so Bank, OS Home, the Graph, and any wrapp that reads the active context (brandbrain) all render real
 * content on first launch. The user can delete it any time; it teaches the shape of a real project.
 *
 * Safety: seeds ONLY on a genuinely fresh machine — never if the user already has ANY context, and never
 * twice (a marker file guards re-seeding even if the user later empties their library). This makes it safe
 * to call unconditionally at every boot.
 */

const SEED_MARKER = ".seeded-example";
const SEED_ID = "example-northwind";
const SEED_PUBLISHER = "seed"; // publishedBy marker — not a real origin

export function seedExampleIfEmpty(stateDir: string, contexts: ContextLibrary, storage: StorageStore, log?: (m: string) => void): void {
  const marker = join(stateDir, SEED_MARKER);
  if (existsSync(marker)) return; // already decided once — never seed twice

  // A real user (any existing context) is left untouched; we still drop the marker so we never reconsider.
  const contextsFile = join(stateDir, "contexts.json");
  let existing: unknown = null;
  try { if (existsSync(contextsFile)) existing = JSON.parse(readFileSync(contextsFile, "utf8")); } catch { /* unreadable ⇒ treat as fresh */ }
  if (Array.isArray(existing) && existing.length > 0) { writeMarker(marker); return; }

  const ctx = contexts.publish(SEED_PUBLISHER, {
    id: SEED_ID,
    name: "Northwind Coffee",
    kind: "brand",
    data: {
      voice: "Warm, unfussy, a little witty — talks like your favorite barista, not a brand deck.",
      positioning: "Small-batch coffee for people who care how it's made but don't want a lecture about it.",
      audience: "Home brewers, 25–45, who buy beans monthly and actually read the roast date.",
      palette: ["#0A0C10", "#C8F250", "#F4EFE7", "#8A5A3B"],
      products: ["Single-origin monthly subscription", "Cold-brew starter kit", "Roaster's-choice sampler"],
      oneLine: "Small-batch coffee, honestly made.",
    },
  });
  contexts.setActiveProject(ctx.id); // lend it to every app as the global "working on" project

  // A bound project folder + a starter tasks.md so the OS Tasks board AND the Calendar populate (the
  // Calendar reads `due:` off these same lines — so this one file demonstrates the task→calendar wiring
  // live). bind() creates the folder + persists the binding in the shape osVaultFolders() reads.
  try {
    const folder = join(stateDir, "projects", "northwind");
    storage.bind(SEED_PUBLISHER, folder); // origin "seed" ⇒ also links to the seeded Bank context
    writeFileSync(join(folder, "tasks.md"), starterTasks(), { mode: 0o600 });
  } catch (err) { log?.("seed: tasks.md/folder skipped — " + String(err)); }

  writeMarker(marker);
  log?.(`seeded example project "${ctx.name}" (${ctx.id}) + tasks and set it active — first-run isn't empty`);
}

/** A short, believable task list with a few upcoming due dates (computed at seed time so they're never
 *  born overdue) + one done item — enough to fill the Tasks board and put dots on the Calendar. */
function starterTasks(): string {
  const day = 86_400_000;
  const due = (n: number) => new Date(Date.now() + n * day).toISOString().slice(0, 10);
  return [
    "# Northwind Coffee — tasks",
    "",
    `- [ ] Reply to the wholesale inquiry @reply #northwind due:${due(1)}`,
    `- [ ] Draft the August subscription email @batch #northwind due:${due(2)}`,
    `- [ ] Finalize the roaster's-choice sampler lineup #northwind due:${due(4)}`,
    `- [ ] Shoot cold-brew kit product photos #northwind due:${due(7)}`,
    "- [x] Pick the fall palette #northwind",
    "",
  ].join("\n");
}

function writeMarker(marker: string): void {
  try { mkdirSync(join(marker, ".."), { recursive: true }); writeFileSync(marker, new Date().toISOString(), { mode: 0o600 }); }
  catch { /* best-effort; worst case we reconsider next boot, still guarded by the existing-context check */ }
}
