import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, cpus } from "node:os";
import { join } from "node:path";

/**
 * WARM SESSION MANAGER — one long-lived `claude` process per (origin, sessionId). Turns are fed to
 * its stdin as stream-json and QUEUE so they run sequentially on the same warm process: no cold start
 * per turn, and no thundering herd when an app fires many turns at once. This is a daemon-side port of
 * brandbrain's proven lib/claude-session.ts / scripts/sidekick.mjs.
 *
 * Read-only by construction: spawned with `--strict-mcp-config` and only the read web tools the origin
 * granted, so a session can never perform a gated write. Recycled every MAX_TURNS (context bloat cap)
 * and idle-swept. The Broker gates each `send` (grant + model scope + budget) before it reaches here.
 */

const TURN_TIMEOUT_MS = 150_000;
const MAX_TURNS = 6;
const IDLE_MS = 15 * 60 * 1000;

function claudeBin(): string {
  const candidates = [process.env.CLAUDE_CLI, join(homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(c)) return c;
  return "claude";
}

export interface SessionOpts {
  system?: string;
  model?: string;
  effort?: "low" | "medium" | "high";
  /** Read tools the origin granted, filtered to web reads (e.g. ["WebSearch","WebFetch"]). */
  allowedReadTools: string[];
}

class ClaudeSession {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private queue: { prompt: string; resolve: (t: string | null) => void }[] = [];
  private active: { resolve: (t: string | null) => void; timer: NodeJS.Timeout } | null = null;
  private buf = "";
  private dead = false;
  private turns = 0;
  lastUsed = Date.now();

  constructor(opts: SessionOpts) {
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--exclude-dynamic-system-prompt-sections",
      "--strict-mcp-config",        // no MCP connectors in a session — read web tools only
      "--no-session-persistence",
      "--model", opts.model || "sonnet",
      "--effort", opts.effort || "low",
    ];
    if (opts.system) args.push("--system-prompt", opts.system);
    // Grant only the web reads the origin already has; if none, the session is knowledge-only.
    if (opts.allowedReadTools.length) args.push("--allowed-tools", ...opts.allowedReadTools);
    else args.push("--disallowed-tools", "Bash", "Edit", "Write", "WebSearch", "WebFetch", "Task", "NotebookEdit");
    try {
      this.proc = spawn(claudeBin(), args, { cwd: process.cwd(), env: process.env });
    } catch (err) {
      console.error("[session] spawn failed:", err);
      this.dead = true;
      return;
    }
    this.proc.stdout.on("data", (d) => this.onData(d.toString()));
    this.proc.stderr.on("data", (d) => { const s = d.toString(); if (/error/i.test(s)) console.error("[session] stderr:", s.slice(0, 160)); });
    this.proc.on("exit", () => this.onExit());
    this.proc.on("error", (err) => { console.error("[session] process error:", err); this.onExit(); });
  }

  private onData(s: string) {
    this.buf += s;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let o: { type?: string; result?: unknown };
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === "result" && this.active) {
        const a = this.active;
        this.active = null;
        clearTimeout(a.timer);
        a.resolve(typeof o.result === "string" ? o.result : null);
        this.pump();
      }
    }
  }

  private onExit() {
    this.dead = true;
    if (this.active) { clearTimeout(this.active.timer); this.active.resolve(null); this.active = null; }
    this.queue.forEach((q) => q.resolve(null));
    this.queue = [];
  }

  private pump() {
    if (this.active || this.dead || !this.proc || !this.queue.length) return;
    const turn = this.queue.shift()!;
    const timer = setTimeout(() => { console.error("[session] turn timed out — killing session"); if (this.active) { this.active.resolve(null); this.active = null; } this.kill(); }, TURN_TIMEOUT_MS);
    this.active = { resolve: turn.resolve, timer };
    const msg = JSON.stringify({ type: "user", message: { role: "user", content: turn.prompt } }) + "\n";
    try { this.proc.stdin.write(msg); }
    catch (err) { console.error("[session] write failed:", err); clearTimeout(timer); this.active = null; turn.resolve(null); this.kill(); }
  }

  send(prompt: string): Promise<string | null> {
    if (this.dead) return Promise.resolve(null);
    this.lastUsed = Date.now();
    this.turns += 1;
    return new Promise((resolve) => { this.queue.push({ prompt, resolve }); this.pump(); });
  }

  get isDead() { return this.dead; }
  get isStale() { return this.turns >= MAX_TURNS; }
  get isBusy() { return this.active !== null || this.queue.length > 0; }
  kill() { this.dead = true; try { this.proc?.kill("SIGKILL"); } catch { /* ignore */ } }
}

export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();
  /** Global cap on LIVE warm processes across ALL apps + projects — the pool. Eviction is free because
   *  every turn re-sends context inline, so an evicted thread just re-spawns (one cold start) next turn.
   *  Bounds a whole ecosystem of apps to a handful of processes instead of one-per-(app×project). */
  private max = Number(process.env.RELAY_SESSION_MAX) || Math.max(2, Math.min(6, (cpus().length || 4) - 1));

  constructor() {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [id, s] of this.sessions) if (s.isDead || now - s.lastUsed > IDLE_MS) { s.kill(); this.sessions.delete(id); }
    }, 60_000);
    sweep.unref?.();
  }

  private key(origin: string, sessionId: string) { return `${origin}::${sessionId}`; }

  private liveCount() { let n = 0; for (const s of this.sessions.values()) if (!s.isDead) n++; return n; }

  /** Make room in the pool: evict the least-recently-used IDLE thread. Never kills a busy one (that
   *  would drop an in-flight turn) — if all are busy we allow brief overflow rather than lose work. */
  private evictIfFull() {
    if (this.liveCount() < this.max) return;
    let victimKey: string | null = null, oldest = Infinity;
    for (const [k, s] of this.sessions) if (!s.isDead && !s.isBusy && s.lastUsed < oldest) { oldest = s.lastUsed; victimKey = k; }
    if (victimKey) { this.sessions.get(victimKey)!.kill(); this.sessions.delete(victimKey); }
  }

  /** Run one turn on the (origin, sessionId) warm thread, spawning/recycling/pool-evicting as needed. */
  send(origin: string, sessionId: string, prompt: string, opts: SessionOpts): Promise<string | null> {
    const key = this.key(origin, sessionId);
    let s = this.sessions.get(key);
    // Recycle a dead session, or a stale-and-idle one (a fresh one loses nothing — context is inline).
    if (s && (s.isDead || (s.isStale && !s.isBusy))) { s.kill(); this.sessions.delete(key); s = undefined; }
    if (!s) { this.evictIfFull(); s = new ClaudeSession(opts); this.sessions.set(key, s); }
    return s.send(prompt);
  }

  /** Pool stats for the panel / metering: live warm threads vs the cap. */
  stats() { return { live: this.liveCount(), max: this.max }; }

  end(origin: string, sessionId: string) {
    const key = this.key(origin, sessionId);
    const s = this.sessions.get(key);
    if (s) { s.kill(); this.sessions.delete(key); }
  }
}
