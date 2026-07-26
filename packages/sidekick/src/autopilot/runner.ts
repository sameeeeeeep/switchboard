import type { StorageStore } from "../storage/store.js";

/**
 * AUTOPILOT RUNNER — the "while you sleep" half of the autopilot wrapp.
 *
 * The wrapp (examples/apps/src/autopilot.js) advances a company only while its tab is open, because
 * its loop is browser `setInterval`. This daemon runner does the same advance with the tab CLOSED:
 * on a timer it sweeps the autopilot app's per-origin storage, and for every company whose owner
 * turned autopilot ON, it takes ONE reversible step and writes the result straight back to the same
 * store. When the user reopens the wrapp, `mountLive` re-reads storage and the board has moved.
 *
 * WHY THIS IS SAFE — the autonomy boundary is the same as the wrapp's, enforced here structurally:
 *   - REVERSIBLE ONLY. The runner decides open decisions (choosing the drafted-recommended option)
 *     and drafts artifacts (product, site copy). It NEVER sends: no post, no email, no ad, no
 *     payment, no publish. Every one of those is an `approve`-class move that, by design, needs the
 *     daemon's per-action human consent — a click no headless loop (and no model) can produce.
 *   - GATED COMPLETIONS. It doesn't own a backend; it's handed the server's OWN gate-and-budget
 *     completion path (`CompleteFn`), so every call it makes is scope-checked, budget-counted, and
 *     attributed exactly like a call the page made. Out of runway ⇒ it stops and says so.
 *   - INERT BY DEFAULT. Constructed only when `RELAY_AUTOPILOT=1`; unset, the daemon behaves exactly
 *     as before. Additive, flag-gated — the Team Mode pattern.
 *
 * STATUS: compiles against the real StorageStore + an injected server completion; the decision-
 * advance path is pure logic and fully exercised by the wrapp's own model. The model-backed drafting
 * beats mirror the wrapp's prompts. Not yet run against a live funded company end-to-end — that needs
 * a running daemon with a real backend, which is the remaining verification step before enabling the
 * flag by default.
 */

/** The server's own gated completion, injected so the runner reuses consent + budget + attribution. */
export type CompleteFn = (
  origin: string,
  prompt: string,
  maxTokens?: number,
) => Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>;

export interface AutopilotDeps {
  storage: StorageStore;
  /** Which origins to sweep — the autopilot app's origin(s). The daemon supplies the ones that have
   *  ever connected the autopilot scope, so we never scan unrelated apps' storage. */
  origins: () => string[];
  complete: CompleteFn;
  log?: (msg: string) => void;
}

/** The wrapp persists companies as one file per company under keys `autopilot-co-<id>`. */
const CO_PREFIX = "autopilot-co-";
const TICK_MS = 60_000; // one reversible step per company per minute — slow on purpose, like the wrapp

const clock = () => new Date().toTimeString().slice(0, 5);

/** The shape the wrapp writes. Loose on purpose — this is another process's JSON; read defensively. */
interface Decision { id: string; label: string; options: Array<{ id: string; label: string; rec?: boolean }>; chosenId: string | null; chosenAt?: string | null; inherited?: unknown; stale?: boolean; }
interface Company {
  id: string; name: string; oneLine?: string;
  kind?: string;   // "wrapp" earns by usage and has no separate product offer; else it's a sales venture
  auto?: { on?: boolean; cursor?: number; at?: number };
  tokens?: { spent?: number; budget?: number };
  decisions?: Record<string, Decision>;
  product?: { drafted?: boolean } & Record<string, unknown>;
  site?: { drafted?: boolean } & Record<string, unknown>;
  log?: Array<{ t: string; s: string; at: string; target: string | null }>;
}

export class AutopilotRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  constructor(private deps: AutopilotDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();   // never hold the process open just for the sweep (matches the heartbeat)
    this.deps.log?.("autopilot runner started — sweeping every " + TICK_MS / 1000 + "s");
  }
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** One sweep across every watched origin. Guarded so a slow model call never overlaps a sweep. */
  private async tick(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const origin of this.deps.origins()) {
        let keys: string[];
        try { keys = this.deps.storage.list(origin); } catch { continue; }
        for (const key of keys) {
          if (!key.startsWith(CO_PREFIX)) continue;
          await this.advanceOne(origin, key).catch((e) => this.deps.log?.("autopilot: " + String(e)));
        }
      }
    } finally { this.sweeping = false; }
  }

  private async advanceOne(origin: string, key: string): Promise<void> {
    const raw = this.deps.storage.get(origin, key);
    if (!raw) return;
    let co: Company;
    try { co = JSON.parse(raw) as Company; } catch { return; }
    if (!co.auto?.on) return;

    const spent = co.tokens?.spent ?? 0, budget = co.tokens?.budget ?? 0;
    if (budget && spent >= budget) {
      co.auto.on = false;
      this.pushLog(co, "autopilot paused — out of runway this week. Fund more to keep it moving.", "run");
      this.save(origin, key, co);
      return;
    }

    const changed = await this.advance(origin, co);
    if (changed) { co.auto.at = Date.now(); this.save(origin, key, co); }
  }

  /** ONE reversible step, mirroring the wrapp's autoTick. Returns whether anything changed. */
  private async advance(origin: string, co: Company): Promise<boolean> {
    // 1) decide any open decision — choose the drafted-recommended option. Pure logic, no send.
    const decisions = co.decisions ? Object.values(co.decisions) : [];
    const open = decisions.find((d) => d && !d.chosenId && !d.inherited && d.options && d.options.length);
    if (open) {
      const rec = open.options.find((o) => o.rec) || open.options[0];
      if (!rec) return false;
      open.chosenId = rec.id; open.chosenAt = clock(); open.stale = false;
      this.pushLog(co, "CEO chose " + rec.label + " for " + open.label.toLowerCase(), "done", open.id);
      return true;
    }
    // 2) everything decided → draft the reversible artifacts. A wrapp earns by usage and has no
    //    separate priced offer (the wrapp itself is the product), so only sales ventures draft one.
    if (co.kind !== "wrapp" && !co.product?.drafted) { await this.draftProduct(origin, co); return true; }
    if (!co.site?.drafted) { await this.draftSite(origin, co); return true; }
    return false; // nothing left to do headless — the rest is gated sends, which wait for a human
  }

  private grounding(co: Company): string {
    return "The company:\n" + co.name + (co.oneLine ? " — " + co.oneLine : "");
  }

  private async draftProduct(origin: string, co: Company): Promise<void> {
    const prompt = [
      "You are defining the first paid offer for " + co.name + ".",
      this.grounding(co),
      "Return JSON: {\"name\":<offer, 2-5 words>, \"price\":<realistic USD number>, \"blurb\":<one sentence on what the buyer gets>}. Never invent a result, testimonial, or customer count.",
    ].join("\n\n");
    try {
      const { text } = await this.deps.complete(origin, prompt, 400);
      let p: Record<string, unknown> = { name: co.name + " — first offer", price: 0, blurb: "" };
      const j = text.indexOf("{");
      if (j !== -1) { try { p = { ...p, ...JSON.parse(text.slice(j, text.lastIndexOf("}") + 1)) }; } catch { /* keep default */ } }
      co.product = { ...p, drafted: true, live: false, at: clock() };
      this.pushLog(co, "drafted the product — " + String(p.name), "done");
    } catch (e) { this.pushLog(co, "couldn't shape the product — " + String(e), "run"); }
  }

  private async draftSite(origin: string, co: Company): Promise<void> {
    const prompt = [
      "You are writing the launch landing copy for " + co.name + ".",
      this.grounding(co),
      "Return a headline, a subhead, and 3 short value points as JSON {\"headline\":..., \"subhead\":..., \"points\":[...]}. Ground every word in the company; never invent a metric or testimonial.",
    ].join("\n\n");
    try {
      const { text } = await this.deps.complete(origin, prompt, 800);
      co.site = { ...(co.site || {}), drafted: true, live: false, copy: text.slice(0, 4000), at: clock() };
      this.pushLog(co, "drafted the site copy — preview and publish when ready", "done");
    } catch (e) { this.pushLog(co, "couldn't draft the site — " + String(e), "run"); }
  }

  private pushLog(co: Company, t: string, s: string, target: string | null = null): void {
    co.log = co.log || [];
    co.log.unshift({ t, s, at: clock(), target });
    co.log = co.log.slice(0, 14);
  }
  private save(origin: string, key: string, co: Company): void {
    try { this.deps.storage.set(origin, key, JSON.stringify(co)); }
    catch (e) { this.deps.log?.("autopilot: could not persist " + key + " — " + String(e)); }
  }
}
