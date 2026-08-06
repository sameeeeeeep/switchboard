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
  /** Call a Switchboard-connector wrapp action on the user's own Claude (the God's-Hands-reuse
   *  path). `toolSuffix` is a `__wrapp__<id>__<action>` suffix; returns the wrapp's structured JSON.
   *  Absent (or a not-connected wrapp) ⇒ the routine falls back to a generic draft. */
  invoke?: (toolSuffix: string, args: Record<string, unknown>) => Promise<{ ok: boolean; json: unknown | null; text: string; error?: string }>;
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

interface Company { id: string; name: string; sector: string; essence: string; auto?: boolean }

function inferSector(c: any): string {
  const d = c.data ?? {};
  if (c.kind === "brand") return "brand";
  if (d.repo || d.folder) return "software";
  if (c.kind === "idea") return "brand";
  return "agency";
}
function toCompany(c: any, sectorOverride?: string, auto?: boolean): Company | null {
  if (!c?.id || !c?.name) return null;
  const d = c.data ?? {};
  const essence = d.oneLine || d.positioning || d.idea || d.summary || (Array.isArray(d.products) ? d.products[0] : "") || "";
  return { id: c.id, name: c.name, sector: sectorOverride || inferSector(c), essence: String(essence).slice(0, 400), auto: !!auto };
}

/** The portfolio: companies with Autopilot on, else the single active company (backward compatible). */
function portfolio(): Company[] {
  const arr = readJson<any[]>(CONTEXTS_FILE);
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const cfg = readJson<{ companies?: Record<string, { on?: boolean; sector?: string; auto?: boolean }> }>(AUTOPILOT_FILE);
  const on = cfg?.companies ? Object.entries(cfg.companies).filter(([, v]) => v?.on) : [];
  if (on.length) {
    return on.map(([id, v]) => toCompany(arr.find((c) => c.id === id), v.sector, v.auto)).filter((c): c is Company => !!c);
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

/**
 * The per-sector MOVE → WRAPP catalog (docs/COMPANY-OS.md §3). A reversible move is produced by a
 * REAL wrapp action running on the user's own Claude — the same quality as opening that wrapp by
 * hand — not a generic completion. First binding whose `when` matches the move text wins; no match
 * (or an unconnected wrapp) falls back to a generic draft, so a tick never fails for lack of a
 * wrapp. Every bound tool is DRAFT-class (produces content, never sends) — the curated reversible
 * surface. Grows as more wrapp cores are exposed as connector tools (redline/adpulse want a page or
 * CSV the routine doesn't yet carry, so they're catalogued but not bound here).
 */
interface WrappBinding {
  wrapp: string;                                                  // "autopilot", "ideabrain"
  label: string;                                                  // shown in the artifact provenance
  tool: string;                                                   // `__wrapp__<id>__<action>` suffix
  when: RegExp;                                                   // tested against the lowercased move
  args: (co: Company, move: string) => Record<string, unknown>;
  render: (json: any, co: Company) => string | null;             // structured JSON → artifact body; null ⇒ unusable, fall back
}

function bulletList(items: string[]): string {
  return items.filter(Boolean).map((s) => `- ${s}`).join("\n");
}

const CATALOG: WrappBinding[] = [
  {
    // Foundational moves: define/validate the brand, audience, positioning.
    wrapp: "ideabrain", label: "ideabrain · brand brief", tool: "__wrapp__ideabrain__brief",
    when: /\b(brief|brand foundation|foundation|positioning|position(?:ing)? the|define (?:the )?(?:brand|product|audience|icp|offer)|validate|who (?:it'?s|its) for|ideal customer|target (?:audience|market)|value prop)\b/,
    args: (co) => ({ idea: co.essence || co.name }),
    render: (j) => {
      const b = j?.brief; if (!b || typeof b !== "object") return null;
      return `**Brand brief — ${b.category ?? ""}**\n\n` + bulletList([
        b.productIdea && `**Product:** ${b.productIdea}`,
        b.audience && `**Audience:** ${b.audience}`,
        b.demographics && `**Who:** ${b.demographics}`,
        b.priceTier && `**Price:** ${b.priceTier}`,
        b.market && `**Market:** ${b.market}`,
        b.vibe && `**Vibe:** ${b.vibe}`,
      ].filter(Boolean) as string[]) + (b.positioningHint ? `\n\n**Positioning angle:** ${b.positioningHint}` : "");
    },
  },
  {
    // Operational moves: voice, ad angle, channel, content, campaign, growth. The "operate this
    // company" wrapp — sector-agnostic, so it's the broad catch for reversible marketing work.
    wrapp: "autopilot", label: "autopilot · operating slate", tool: "__wrapp__autopilot__slate",
    when: /\b(voice|tone|ad(?:s| angle| creative)?|angle|creative|campaign|channel|go[- ]?to[- ]?market|gtm|market(?:ing)?|content|posts?|caption|copy|landing|hero|headline|tagline|page|story|drop|pre[- ]?order|offer|email|messaging|slate|operat|growth|next move|expand|new (?:format|segment|surface)|launch plan|distribution)\b/,
    args: (co) => ({ company: { name: co.name, oneLine: co.essence } }),
    render: (j) => {
      const decisions = j?.decisions; if (!Array.isArray(decisions) || !decisions.length) return null;
      return decisions.map((d: any) => {
        const opts: any[] = Array.isArray(d.options) ? d.options : [];
        const rec = opts.find((o) => o.recommended) ?? opts[0];
        const alts = opts.filter((o) => o !== rec).map((o) => o.label).filter(Boolean);
        const recLines = Array.isArray(rec?.lines) ? rec.lines.map((l: string) => `  - "${l}"`).join("\n") : "";
        const recExtra = [rec?.body, rec?.cta ? `CTA: ${rec.cta}` : ""].filter(Boolean).join(" · ");
        return `## ${d.label}${d.axis ? ` — ${d.axis}` : ""}\n` +
          `**★ ${rec?.label ?? ""}** — ${rec?.text ?? ""}` +
          (recExtra ? `\n  ${recExtra}` : "") + (recLines ? `\n${recLines}` : "") +
          (alts.length ? `\n_Alt: ${alts.join(" · ")}_` : "");
      }).join("\n\n");
    },
  },
];

function bindingFor(move: string): WrappBinding | null {
  const m = move.toLowerCase();
  return CATALOG.find((b) => b.when.test(m)) ?? null;
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
        const moves = parseMoves(movesOut.text).map((txt) => ({ txt, lane: classify(txt), artifact: null as string | null, preview: null as string | null, status: "staged" as string }));
        const ensureDir = () => { if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 }); };

        // God's hands PREPARE the content for BOTH lanes — the difference is only what happens next:
        // a reversible move's content IS the whole move (→ done); a gate move's content is the thing that
        // WOULD be sent, so it's staged with a preview for the founder to review (→ awaiting). Preparing
        // content is always reversible; the send line is the only thing gated.

        // 1) execute the first reversible move — one nudge per company per tick. God's hands run the
        //    matching REAL wrapp on the user's own Claude (docs/COMPANY-OS.md §3); if no wrapp fits
        //    the move, or the wrapp isn't connected, we draft it generically so the tick still lands.
        const first = moves.find((m) => m.lane === "autopilot");
        if (first) {
          let body = ""; let via = "God's hands"; let tokens = 0;
          const binding = bindingFor(first.txt);
          if (binding && deps.invoke) {
            const out = await deps.invoke(binding.tool, binding.args(co, first.txt));
            const rendered = out.ok ? binding.render(out.json, co) : null;
            if (out.ok && rendered) {
              body = rendered; via = `${binding.label} (God's hands)`;
              deps.log?.(`autopilot: ${co.name} → ran ${binding.wrapp} for "${first.txt.slice(0, 48)}"`);
            } else {
              deps.log?.(`autopilot: ${co.name} → ${binding.wrapp} unavailable (${out.error ?? "no result"}), drafting generically`);
            }
          }
          if (!body) {
            const art = await deps.draft(
              `For "${co.name}" (${co.sector}), produce the actual deliverable for this move — the real thing, ` +
              `ready for the founder to review, not a description:\n"${first.txt}"\nKeep it tight.`);
            body = art.text.trim(); tokens = art.tokens; spent += art.tokens;
          }
          const n = moves.indexOf(first) + 1;
          try {
            ensureDir();
            writeFileSync(join(STORE_DIR, `autopilot-artifact-${co.id}-${n}.md`),
              `---\ncompany: ${co.name}\nsector: ${co.sector}\nmove: ${first.txt}\nby: reversible move — ${via}\nat: ${new Date().toISOString()}\n---\n\n${body}\n`);
            first.artifact = `autopilot-artifact-${co.id}-${n}.md`; first.preview = body.slice(0, 1400); first.status = "done"; (first as any).via = via;
            deps.log?.(`autopilot: ${co.name} → made ${first.artifact} via ${via}${tokens ? ` (${tokens} tok)` : ""}`);
          } catch (e) { deps.log?.("autopilot: could not file — " + String(e)); first.status = "error"; }
        }

        // 2) PREPARE the first gate move's content so the founder can review exactly what would be sent.
        //    Prepared, never sent — the tap (or auto mode) is the only thing that sends.
        const gate = moves.find((m) => m.lane === "gate");
        if (gate) {
          const prep = await deps.draft(
            `For "${co.name}" (${co.sector}), produce the exact content this move would send/publish — the ` +
            `final copy, ready to go out:\n"${gate.txt}"\nThis is a PREVIEW the founder reviews before it's sent. Keep it tight.`);
          spent += prep.tokens;
          const n = moves.indexOf(gate) + 1;
          try {
            ensureDir();
            writeFileSync(join(STORE_DIR, `autopilot-gate-${co.id}-${n}.md`),
              `---\ncompany: ${co.name}\nsector: ${co.sector}\nmove: ${gate.txt}\nprepared_by: autopilot (staged — awaiting your approval to send)\nat: ${new Date().toISOString()}\n---\n\n${prep.text.trim()}\n`);
            gate.artifact = `autopilot-gate-${co.id}-${n}.md`; gate.preview = prep.text.trim().slice(0, 1400); gate.status = "prepared";
            deps.log?.(`autopilot: ${co.name} → prepared gate move for review (${prep.tokens} tok)`);
          } catch (e) { deps.log?.("autopilot: could not prepare gate — " + String(e)); }
        }

        // Auto mode is per-company (autopilot.json companies.<id>.auto). When on, the founder has PRE-
        // AUTHORIZED sends: the routine would dispatch gate moves through the daemon's connector+consent
        // path instead of staging them. Not fired here — it requires a connected publisher/sender AND the
        // founder's standing auto grant; absent either, moves stay staged. See docs/COMPANY-OS.md §2b.
        const summary = {
          made: moves.filter((m) => m.status === "done").length,
          staged: moves.filter((m) => m.lane === "gate").length,
          calls: moves.filter((m) => m.lane === "founder").length,
        };
        const plan = { at: Date.now(), companyId: co.id, company: co.name, sector: co.sector, auto: !!co.auto, moves, summary };
        try { writeFileSync(join(STORE_DIR, `autopilot-plan-${co.id}.json`), JSON.stringify(plan, null, 2)); } catch { /* non-fatal */ }
        rollup.push({ id: co.id, name: co.name, sector: co.sector, essence: co.essence, auto: !!co.auto, summary, moves });
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
