import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { RELAY_DIR } from "../config.js";
import type { Routine } from "./registry.js";

/**
 * AUTOPILOT — routine #1 (daemon tier).
 *
 * On each fire it DRAFTS the active company's next moves and files them where the autopilot cockpit
 * (and the OS Home/Needs surfaces) can show them. It never sends, publishes, or charges — the finite
 * doctrine holds: the runner drafts, a human gates every irreversible move. This is the "wake up to a
 * decided slate" half made real; the acting half stays behind the cockpit's per-move consent.
 *
 * Everything it needs is real ~/.relay state — the active context (contexts.json + the *global*
 * selection) — and one first-party model draft via the daemon (deps.draft). No fake tokens: the
 * spend it reports is the real completion usage, so the menubar's background-spend meter is honest.
 */

interface AutopilotDeps {
  /** First-party model completion (non-agentic, audited as routine@autopilot). Returns real usage. */
  draft: (prompt: string) => Promise<{ text: string; tokens: number }>;
  log?: (m: string) => void;
}

const CONTEXTS_FILE = join(RELAY_DIR, "contexts.json");
const SELECTION_FILE = join(RELAY_DIR, "context-selection.json");
// The autopilot company lives under sameep.ai's storage origin (dir form = origin with :/ → _).
const PLAN_DIR = join(RELAY_DIR, "storage", "https_sameep.ai");
const PLAN_FILE = join(PLAN_DIR, "autopilot-plan.json");

function readJson<T>(path: string): T | null {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null; } catch { return null; }
}

/** The active company = the OS-wide selected context, else the most-recently-updated one. */
function activeCompany(): { id: string; name: string; essence: string } | null {
  const arr = readJson<any[]>(CONTEXTS_FILE);
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sel = readJson<Record<string, string>>(SELECTION_FILE)?.["*global*"];
  const sorted = [...arr].sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
  const c = arr.find((x) => x?.id === sel) ?? sorted[0];
  if (!c?.id || !c?.name) return null;
  const d = c.data ?? {};
  const essence = d.oneLine || d.positioning || d.idea || d.summary || (Array.isArray(d.products) ? d.products[0] : "") || "";
  return { id: c.id, name: c.name, essence: String(essence).slice(0, 400) };
}

export function makeAutopilotRoutine(deps: AutopilotDeps): Routine {
  return {
    id: "autopilot",
    title: "Autopilot — advance companies",
    tier: "daemon",
    intervalMs: 30 * 60_000,     // every 30 min while switched on — a daily plan doesn't need a tight loop
    async tick(): Promise<number> {
      const co = activeCompany();
      if (!co) { deps.log?.("autopilot: no active company — nothing to draft"); return 0; }
      const prompt =
        `You are the operator drafting the next moves for "${co.name}"` +
        (co.essence ? ` (${co.essence})` : "") + `.\n` +
        `Draft the 3 highest-leverage moves to make today. Each move: one line, imperative, concrete. ` +
        `These are DRAFTS a human will approve before anything is sent, published, or charged — never assume they are executed.\n` +
        `Return only the 3 lines, no preamble.`;
      const { text, tokens } = await deps.draft(prompt);
      try {
        if (!existsSync(PLAN_DIR)) mkdirSync(PLAN_DIR, { recursive: true, mode: 0o700 });
        writeFileSync(PLAN_FILE, JSON.stringify({
          at: Date.now(), companyId: co.id, company: co.name,
          plan: text.trim(), status: "drafted", note: "drafted by autopilot routine — approve moves in the cockpit before any act",
        }, null, 2));
      } catch (e) { deps.log?.("autopilot: could not write plan — " + String(e)); }
      deps.log?.(`autopilot: drafted today's moves for ${co.name} (${tokens} tok)`);
      return tokens;
    },
  };
}
