import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { RELAY_DIR } from "../config.js";

/**
 * ROUTINE REGISTRY — the daemon's scheduler for background routines (docs/ROUTINES.md).
 *
 * A routine is a capability a wrapp requests: "keep doing this while I'm away, with consent." The
 * autopilot runner is routine #1 (daemon tier). This registry owns the clock, runs each active
 * routine on its interval, tracks background spend, and — crucially — makes background work VISIBLE
 * and STOPPABLE through the menubar, which reads ~/.relay directly:
 *
 *   ~/.relay/routines.json          — STATUS, written by the daemon; the menubar's Routines +
 *                                     Dashboard surfaces read it to show what's running, per tier,
 *                                     and the tokens spent while you were away.
 *   ~/.relay/routines-control.json  — CONTROL, written by the menubar; the daemon reads it each tick.
 *                                     { off?: bool (global kill switch), routines?: { <id>: { off?: bool } } }
 *
 * Two files so neither side clobbers the other. The menubar's master switch (`off`) is the pause;
 * default is dormant on a fresh machine only because the shipped control file is `{ off: true }`.
 * The doctrine boundary holds regardless: a routine tick may DRAFT (reversible), never ACT — every
 * irreversible move stays gated by a human. This is the "retire the RELAY_AUTOPILOT env flag" step:
 * a real, visible control replaces a hidden env var.
 */

export type RoutineTier = "daemon" | "claude-code";

export interface Routine {
  id: string;
  title: string;
  tier: RoutineTier;
  intervalMs: number;
  /** One scheduled invocation. Returns tokens spent this run, for background-spend visibility.
   *  MUST be safe to run unattended: draft/derive only, never send/publish/charge. */
  tick(): Promise<number>;
}

interface RoutineControl { off?: boolean; routines?: Record<string, { off?: boolean }>; }
interface RoutineRow { id: string; title: string; tier: RoutineTier; active: boolean; lastRunAt: number | null; runs: number; tokens: number; }

const CONTROL_FILE = join(RELAY_DIR, "routines-control.json");
const STATUS_FILE = join(RELAY_DIR, "routines.json");
const SWEEP_MS = 15_000; // the master heartbeat; each routine still fires only on its own interval

export class RoutineRegistry {
  private routines = new Map<string, Routine>();
  private st = new Map<string, { lastRunAt: number | null; runs: number; tokens: number; ticking: boolean }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private log?: (m: string) => void) {}

  register(r: Routine): void {
    this.routines.set(r.id, r);
    if (!this.st.has(r.id)) this.st.set(r.id, { lastRunAt: null, runs: 0, tokens: 0, ticking: false });
    this.log?.("routine registered — " + r.id + " (" + r.tier + ", every " + Math.round(r.intervalMs / 1000) + "s)");
  }

  start(): void {
    if (this.timer || this.routines.size === 0) return;
    this.writeStatus();                     // publish the registry the instant we boot, even before any tick
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();                   // never hold the process open just for routines
    this.log?.("routine registry started — " + this.routines.size + " routine(s)");
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  /** CONTROL: the menubar's pause. Global `off` stops everything; per-routine `off` stops one. */
  private control(): RoutineControl {
    try { if (existsSync(CONTROL_FILE)) return JSON.parse(readFileSync(CONTROL_FILE, "utf8")) as RoutineControl; } catch { /* bad json ⇒ treat as no control */ }
    return {};
  }
  private isActive(id: string, ctrl: RoutineControl): boolean {
    if (ctrl.off) return false;                          // global kill switch (the menubar master toggle)
    if (ctrl.routines?.[id]?.off) return false;          // this routine paused
    return true;
  }

  private async sweep(): Promise<void> {
    const ctrl = this.control();
    const now = Date.now();
    for (const [id, r] of this.routines) {
      const s = this.st.get(id)!;
      if (s.ticking) continue;
      if (!this.isActive(id, ctrl)) continue;
      if (s.lastRunAt != null && now - s.lastRunAt < r.intervalMs) continue;
      s.ticking = true;
      try {
        const spent = await r.tick();
        s.tokens += Math.max(0, spent | 0);
        s.runs += 1;
      } catch (e) { this.log?.("routine " + id + ": " + String(e)); }
      finally { s.lastRunAt = Date.now(); s.ticking = false; }
      this.writeStatus();
    }
    // Refresh once per sweep even when nothing ran, so a menubar pause (active → false) shows up
    // within one heartbeat instead of waiting for the next tick that will never come while paused.
    this.writeStatus();
  }

  /** STATUS: what the menubar renders — active routines, tier, background spend. Never throws. */
  private writeStatus(): void {
    const ctrl = this.control();
    const rows: RoutineRow[] = [...this.routines.values()].map((r) => {
      const s = this.st.get(r.id)!;
      return { id: r.id, title: r.title, tier: r.tier, active: this.isActive(r.id, ctrl), lastRunAt: s.lastRunAt, runs: s.runs, tokens: s.tokens };
    });
    try {
      if (!existsSync(RELAY_DIR)) mkdirSync(RELAY_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(STATUS_FILE, JSON.stringify({ updatedAt: Date.now(), globalPaused: !!ctrl.off, routines: rows }, null, 2));
    } catch (e) { this.log?.("routines: could not write status — " + String(e)); }
  }
}
