import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { RELAY_DIR } from "../config.js";
import type { Routine } from "./registry.js";

/**
 * AUTOPILOT — routine #1 (daemon tier). See docs/COMPANY-OS.md.
 *
 * Each fire runs the daily loop for the active company:
 *   1. read Identity (the active context)
 *   2. draft the 3–5 highest-leverage moves
 *   3. CLASSIFY each by reversibility → autopilot | gate | founder
 *   4. EXECUTE the reversible ones (God's hands, daemon tier): draft the real deliverable and file it
 *   5. STAGE the gate/founder ones — never acted on unattended
 *
 * The send line never moves: a `gate` move (publish/send/charge/deploy) is only ever staged; a
 * `founder` move (hire/pick/strategy) is surfaced as a decision. Only reversible moves run themselves,
 * and even then the wrapp's own outward actions stay gate-class. All spend is real usage tokens.
 */

interface AutopilotDeps {
  /** First-party model completion (non-agentic, audited as routine@autopilot). Returns real usage. */
  draft: (prompt: string) => Promise<{ text: string; tokens: number }>;
  log?: (m: string) => void;
}

const CONTEXTS_FILE = join(RELAY_DIR, "contexts.json");
const SELECTION_FILE = join(RELAY_DIR, "context-selection.json");
const PLAN_DIR = join(RELAY_DIR, "storage", "https_sameep.ai");
const PLAN_FILE = join(PLAN_DIR, "autopilot-plan.json");

function readJson<T>(path: string): T | null {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null; } catch { return null; }
}

function activeCompany(): { id: string; name: string; sector: string; essence: string } | null {
  const arr = readJson<any[]>(CONTEXTS_FILE);
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sel = readJson<Record<string, string>>(SELECTION_FILE)?.["*global*"];
  const sorted = [...arr].sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
  const c = arr.find((x) => x?.id === sel) ?? sorted[0];
  if (!c?.id || !c?.name) return null;
  const d = c.data ?? {};
  const essence = d.oneLine || d.positioning || d.idea || d.summary || (Array.isArray(d.products) ? d.products[0] : "") || "";
  // sector: honest inference from kind — brand/idea → brand, project w/ repo → software, else agency.
  const sector = c.kind === "brand" ? "brand" : (d.repo || d.folder ? "software" : (c.kind === "idea" ? "brand" : "agency"));
  return { id: c.id, name: c.name, sector, essence: String(essence).slice(0, 400) };
}

/** Reversibility classifier — the autonomy gradient (docs/COMPANY-OS.md §2). Gate/founder win over
 *  reversible when a move contains their verbs, because the safe default is LESS autonomy, not more. */
type Lane = "autopilot" | "gate" | "founder";
function classify(move: string): Lane {
  const m = move.toLowerCase();
  const GATE = ["publish", "send", "post to", "deploy", "charge", "invoice", "launch the", "go live",
                "open the pre-order", "open pre-order", "run the ad", "run ads", "sign ", "email the", "dm "];
  const FOUNDER = ["hire", "pick ", "choose ", "decide", "strategy", "raise", "fundrais", "legal",
                   "pricing decision", "budget", "which ", "should we"];
  if (GATE.some((k) => m.includes(k))) return "gate";
  if (FOUNDER.some((k) => m.includes(k))) return "founder";
  return "autopilot";   // reversible by default — a draft/generate/write move
}

function parseMoves(text: string): string[] {
  return text.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 6).slice(0, 5);
}

export function makeAutopilotRoutine(deps: AutopilotDeps): Routine {
  return {
    id: "autopilot",
    title: "Autopilot — advance companies",
    tier: "daemon",
    intervalMs: 30 * 60_000,
    async tick(): Promise<number> {
      const co = activeCompany();
      if (!co) { deps.log?.("autopilot: no active company — nothing to draft"); return 0; }
      let spent = 0;

      // 2–3. draft + classify the day's moves
      const movesOut = await deps.draft(
        `You are the operator for "${co.name}" — a ${co.sector} company` +
        (co.essence ? ` (${co.essence})` : "") + `.\n` +
        `List the 3 highest-leverage moves to make today. Each: one imperative line, concrete. ` +
        `Mix reversible drafting work with the occasional publish/send that would follow.\n` +
        `Return only the lines, no preamble.`);
      spent += movesOut.tokens;
      const moves = parseMoves(movesOut.text).map((txt) => ({ txt, lane: classify(txt), artifact: null as string | null, status: "staged" as string }));

      // 4. EXECUTE the reversible ones — God's hands (daemon tier): produce the real deliverable.
      for (const mv of moves) {
        if (mv.lane !== "autopilot") continue;                       // gate/founder are never auto-run
        const art = await deps.draft(
          `For "${co.name}" (${co.sector}), produce the actual deliverable for this move — not a description, ` +
          `the real thing, ready for the founder to review:\n"${mv.txt}"\n` +
          `This is a DRAFT the founder approves before anything is sent/published. Keep it tight.`);
        spent += art.tokens;
        const idx = moves.indexOf(mv);
        const file = join(PLAN_DIR, `autopilot-artifact-${idx + 1}.md`);
        try {
          if (!existsSync(PLAN_DIR)) mkdirSync(PLAN_DIR, { recursive: true, mode: 0o700 });
          writeFileSync(file, `---\ncompany: ${co.name}\nmove: ${mv.txt}\nby: autopilot routine (reversible · God's hands)\nat: ${new Date().toISOString()}\n---\n\n${art.text.trim()}\n`);
          mv.artifact = `autopilot-artifact-${idx + 1}.md`; mv.status = "done";
          deps.log?.(`autopilot: executed reversible move → ${mv.artifact} (${art.tokens} tok)`);
        } catch (e) { deps.log?.("autopilot: could not file artifact — " + String(e)); mv.status = "error"; }
      }

      // 5. write the plan the cockpit reads — moves classified, reversible ones DONE, rest staged.
      const staged = moves.filter((m) => m.lane === "gate").length;
      const calls = moves.filter((m) => m.lane === "founder").length;
      const made = moves.filter((m) => m.status === "done").length;
      try {
        writeFileSync(PLAN_FILE, JSON.stringify({
          at: Date.now(), companyId: co.id, company: co.name, sector: co.sector,
          moves, summary: { made, staged, calls },
          note: "reversible moves executed by God's hands; gate/founder moves staged — nothing sent/charged unattended",
        }, null, 2));
      } catch (e) { deps.log?.("autopilot: could not write plan — " + String(e)); }
      deps.log?.(`autopilot: ${co.name} — made ${made}, staged ${staged}, ${calls} for you (${spent} tok)`);
      return spent;
    },
  };
}
