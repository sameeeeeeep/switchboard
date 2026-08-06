import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { RELAY_DIR } from "../config.js";
import type { Routine } from "./registry.js";

/**
 * AUTOPILOT — routine #1 (daemon tier). See docs/COMPANY-OS.md.
 *
 * PORTFOLIO: each fire advances EVERY company you've turned Autopilot on for, not just the active one.
 * Per company, one loop step: draft the day's moves → classify by reversibility → execute the first
 * reversible move (God's hands — draft the real deliverable, file it) → stage the rest. So a tick nudges
 * the whole portfolio forward a little, rather than exhausting one company. The send line never moves.
 *
 *   ~/.relay/autopilot.json  — which companies are on: { companies: { <ctxId>: { on, sector? } } }.
 *                              Empty/absent ⇒ fall back to the single active company (the *global* selection).
 *   → per company:  autopilot-plan-<id>.json  +  autopilot-artifact-<id>-<n>.md
 *   → aggregate:    autopilot-portfolio.json   (what the cockpit's portfolio view reads)
 */

interface AutopilotDeps {
  draft: (prompt: string) => Promise<{ text: string; tokens: number }>;
  log?: (m: string) => void;
}

const CONTEXTS_FILE = join(RELAY_DIR, "contexts.json");
const SELECTION_FILE = join(RELAY_DIR, "context-selection.json");
const AUTOPILOT_FILE = join(RELAY_DIR, "autopilot.json");
const STORE_DIR = join(RELAY_DIR, "storage", "https_sameep.ai");
const PORTFOLIO_FILE = join(STORE_DIR, "autopilot-portfolio.json");

function readJson<T>(path: string): T | null {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null; } catch { return null; }
}

interface Company { id: string; name: string; sector: string; essence: string }

function inferSector(c: any): string {
  const d = c.data ?? {};
  if (c.kind === "brand") return "brand";
  if (d.repo || d.folder) return "software";
  if (c.kind === "idea") return "brand";
  return "agency";
}
function toCompany(c: any, sectorOverride?: string): Company | null {
  if (!c?.id || !c?.name) return null;
  const d = c.data ?? {};
  const essence = d.oneLine || d.positioning || d.idea || d.summary || (Array.isArray(d.products) ? d.products[0] : "") || "";
  return { id: c.id, name: c.name, sector: sectorOverride || inferSector(c), essence: String(essence).slice(0, 400) };
}

/** The portfolio: companies with Autopilot on, else the single active company (backward compatible). */
function portfolio(): Company[] {
  const arr = readJson<any[]>(CONTEXTS_FILE);
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const cfg = readJson<{ companies?: Record<string, { on?: boolean; sector?: string }> }>(AUTOPILOT_FILE);
  const on = cfg?.companies ? Object.entries(cfg.companies).filter(([, v]) => v?.on) : [];
  if (on.length) {
    return on.map(([id, v]) => toCompany(arr.find((c) => c.id === id), v.sector)).filter((c): c is Company => !!c);
  }
  const sel = readJson<Record<string, string>>(SELECTION_FILE)?.["*global*"];
  const sorted = [...arr].sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
  const c = toCompany(arr.find((x) => x.id === sel) ?? sorted[0]);
  return c ? [c] : [];
}

type Lane = "autopilot" | "gate" | "founder";
function classify(move: string): Lane {
  const m = move.toLowerCase();
  const GATE = ["publish", "send", "post to", "deploy", "charge", "invoice", "launch the", "go live",
                "open the pre-order", "open pre-order", "run the ad", "run ads", " sign ", "email the", " dm "];
  const FOUNDER = ["hire", "pick ", "choose ", "decide", "strategy", "raise", "fundrais", "legal",
                   "pricing decision", "budget", "which ", "should we"];
  if (GATE.some((k) => m.includes(k))) return "gate";
  if (FOUNDER.some((k) => m.includes(k))) return "founder";
  return "autopilot";
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
      const cos = portfolio();
      if (!cos.length) { deps.log?.("autopilot: no companies on — nothing to advance"); return 0; }
      let spent = 0;
      const rollup: any[] = [];

      for (const co of cos) {
        const movesOut = await deps.draft(
          `You are the operator for "${co.name}" — a ${co.sector} company` +
          (co.essence ? ` (${co.essence})` : "") + `.\n` +
          `List the 3 highest-leverage moves to make today. Each: one imperative line, concrete. ` +
          `Mix reversible drafting work with the occasional publish/send that would follow.\n` +
          `Return only the lines, no preamble.`);
        spent += movesOut.tokens;
        const moves = parseMoves(movesOut.text).map((txt) => ({ txt, lane: classify(txt), artifact: null as string | null, status: "staged" as string }));

        // execute the FIRST reversible move — one nudge per company per tick
        const first = moves.find((m) => m.lane === "autopilot");
        if (first) {
          const art = await deps.draft(
            `For "${co.name}" (${co.sector}), produce the actual deliverable for this move — the real thing, ` +
            `ready for the founder to review, not a description:\n"${first.txt}"\n` +
            `A DRAFT the founder approves before anything is sent/published. Keep it tight.`);
          spent += art.tokens;
          const n = moves.indexOf(first) + 1;
          const file = join(STORE_DIR, `autopilot-artifact-${co.id}-${n}.md`);
          try {
            if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
            writeFileSync(file, `---\ncompany: ${co.name}\nsector: ${co.sector}\nmove: ${first.txt}\nby: autopilot routine (reversible · God's hands)\nat: ${new Date().toISOString()}\n---\n\n${art.text.trim()}\n`);
            first.artifact = `autopilot-artifact-${co.id}-${n}.md`; first.status = "done";
            deps.log?.(`autopilot: ${co.name} → executed ${first.artifact} (${art.tokens} tok)`);
          } catch (e) { deps.log?.("autopilot: could not file — " + String(e)); first.status = "error"; }
        }

        const summary = {
          made: moves.filter((m) => m.status === "done").length,
          staged: moves.filter((m) => m.lane === "gate").length,
          calls: moves.filter((m) => m.lane === "founder").length,
        };
        const plan = { at: Date.now(), companyId: co.id, company: co.name, sector: co.sector, moves, summary };
        try { writeFileSync(join(STORE_DIR, `autopilot-plan-${co.id}.json`), JSON.stringify(plan, null, 2)); } catch { /* non-fatal */ }
        rollup.push({ id: co.id, name: co.name, sector: co.sector, essence: co.essence, summary, moves });
      }

      // the portfolio the cockpit reads — every company advancing, at a glance
      try {
        if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
        writeFileSync(PORTFOLIO_FILE, JSON.stringify({
          at: Date.now(), count: rollup.length, companies: rollup,
          totals: {
            made: rollup.reduce((s, c) => s + c.summary.made, 0),
            staged: rollup.reduce((s, c) => s + c.summary.staged, 0),
            calls: rollup.reduce((s, c) => s + c.summary.calls, 0),
          },
          note: "reversible moves executed by God's hands; gate/founder staged — nothing sent unattended",
        }, null, 2));
      } catch (e) { deps.log?.("autopilot: could not write portfolio — " + String(e)); }

      const t = rollup.reduce((s, c) => s + c.summary.made, 0);
      deps.log?.(`autopilot: advanced ${rollup.length} companies — ${t} artifacts made (${spent} tok)`);
      return spent;
    },
  };
}
