import type { Budgets } from "@relay/protocol";

/**
 * Per-origin budget + rate accounting, enforced out of band. A request that would breach a
 * ceiling is denied regardless of scope — this caps the blast radius of a compromised or
 * runaway site (and, later, meters an app's usage of the user's compute for the app store).
 */
interface OriginMeter {
  /** Rolling day: token spend timestamps. */
  tokens: Array<{ ts: number; n: number }>;
  /** Rolling minute: call timestamps. */
  calls: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export class BudgetLedger {
  private meters = new Map<string, OriginMeter>();

  private meter(origin: string): OriginMeter {
    let m = this.meters.get(origin);
    if (!m) { m = { tokens: [], calls: [] }; this.meters.set(origin, m); }
    return m;
  }

  private prune(m: OriginMeter, now: number) {
    m.tokens = m.tokens.filter((t) => now - t.ts < DAY_MS);
    m.calls = m.calls.filter((t) => now - t < MIN_MS);
  }

  /** Would one more call breach the per-minute rate? */
  canCall(origin: string, budgets: Budgets, now = Date.now()): boolean {
    const m = this.meter(origin);
    this.prune(m, now);
    return m.calls.length < budgets.maxCallsPerMin;
  }

  /** Would `tokens` more breach the daily token ceiling? */
  canSpend(origin: string, budgets: Budgets, tokens: number, now = Date.now()): boolean {
    const m = this.meter(origin);
    this.prune(m, now);
    const spent = m.tokens.reduce((a, t) => a + t.n, 0);
    return spent + tokens <= budgets.maxTokensPerDay;
  }

  recordCall(origin: string, now = Date.now()) {
    this.meter(origin).calls.push(now);
  }

  recordTokens(origin: string, n: number, now = Date.now()) {
    this.meter(origin).tokens.push({ ts: now, n });
  }

  /** For the popup: current usage vs ceilings. */
  usage(origin: string, now = Date.now()): { tokensToday: number; callsThisMinute: number } {
    const m = this.meter(origin);
    this.prune(m, now);
    return { tokensToday: m.tokens.reduce((a, t) => a + t.n, 0), callsThisMinute: m.calls.length };
  }
}
