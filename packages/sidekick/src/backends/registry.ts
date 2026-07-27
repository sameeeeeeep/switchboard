import type { ModelBackend } from "./types.js";
import { ClaudeCodeBackend } from "./claude-code.js";
import { LocalOpenAIBackend } from "./local-openai.js";
import { OpenRouterBackend } from "./openrouter.js";
import { loadCloudConfig } from "../config.js";

/**
 * Routes a model id to the backend that serves it. Claude Code is always registered; local
 * runners register when their env is configured (RELAY_LOCAL_OPENAI_URL). One model id maps
 * to exactly one backend; capabilities lists the union across healthy backends.
 */
export class BackendRegistry {
  private backends: ModelBackend[] = [];
  private modelToBackend = new Map<string, ModelBackend>();
  /** Last observed health per backend id — refreshed by refreshModels()/onlineIds() (the panel's
   *  health poll drives the latter), so backendFor() can be sync and still honest. */
  private lastHealthy = new Map<string, boolean>();

  static async boot(): Promise<BackendRegistry> {
    const reg = new BackendRegistry();
    reg.register(new ClaudeCodeBackend());
    if (process.env.RELAY_LOCAL_OPENAI_URL) {
      reg.register(new LocalOpenAIBackend({ baseUrl: process.env.RELAY_LOCAL_OPENAI_URL, id: "ollama" }));
    }
    // OPT-IN hosted lane: only registered when the user has provided an OpenRouter key. Off by
    // default — the daemon stays pure BYO-Claude/local until someone explicitly opts in.
    const cloud = loadCloudConfig();
    if (cloud.openrouterKey) {
      reg.register(new OpenRouterBackend({ apiKey: cloud.openrouterKey, baseUrl: cloud.baseUrl, models: cloud.models }));
    }
    await reg.refreshModels();
    return reg;
  }

  register(b: ModelBackend) {
    this.backends.push(b);
  }

  /** Rebuild the model→backend map from the healthy backends. */
  async refreshModels(): Promise<void> {
    this.modelToBackend.clear();
    for (const b of this.backends) {
      const ok = await b.healthy();
      this.lastHealthy.set(b.id, ok);
      if (!ok) continue;
      for (const m of await b.listModels()) {
        if (!this.modelToBackend.has(m)) this.modelToBackend.set(m, b);
      }
    }
  }

  backendFor(model: string | undefined): ModelBackend | null {
    if (model && this.modelToBackend.has(model)) return this.modelToBackend.get(model)!;
    // Default: first HEALTHY backend — but NEVER a hosted one. An omitted or unknown model id means
    // "the user's own default", and resolving that to a hosted backend would send prompts off the
    // machine without anyone opting in — the one thing this product must never do. Hosted backends
    // are reachable ONLY by exact model match above.
    return this.backends.find((b) => !b.hosted && this.lastHealthy.get(b.id) === true) ?? null;
  }

  async models(): Promise<string[]> {
    return [...this.modelToBackend.keys()];
  }

  /** Models served by HOSTED backends (prompts leave the machine) — the panel badges these so the
   *  trust trade is never silent. Union across hosted backends, from the current model→backend map. */
  hostedModels(): string[] {
    const out: string[] = [];
    for (const [model, b] of this.modelToBackend) if (b.hosted) out.push(model);
    return out.sort();
  }

  /** Runtime opt-in/out of the hosted lane without a daemon restart (panel-driven). Removes any
   *  existing hosted backend, registers a fresh one if a key is given, and rebuilds routing. */
  async setCloudBackend(cfg: { openrouterKey?: string; baseUrl?: string; models?: string[] }): Promise<void> {
    this.backends = this.backends.filter((b) => !b.hosted);
    if (cfg.openrouterKey) {
      const { OpenRouterBackend } = await import("./openrouter.js");
      this.register(new OpenRouterBackend({ apiKey: cfg.openrouterKey, baseUrl: cfg.baseUrl, models: cfg.models }));
    }
    await this.refreshModels();
  }

  /** Whether a hosted backend is currently registered (has a key), for cloud.status. */
  hasHosted(): boolean {
    return this.backends.some((b) => b.hosted);
  }

  /** Rung 4 (STATES.md §4): can the daemon actually FULFIL a completion right now? A healthy backend
   *  that needs no sign-in (a local runner, a hosted key) means yes regardless of Claude Code's auth —
   *  those serve the default route. Otherwise the verdict is the BYO default's own (`signedIn()`).
   *  `undefined` = can't tell (never asserts signed-out). */
  async signedIn(): Promise<boolean | undefined> {
    for (const b of this.backends) {
      if (b.id === "claude-code") continue;
      if (this.lastHealthy.get(b.id) === true) return true; // a usable non-BYO backend is enough
    }
    const cc = this.backends.find((b) => b.id === "claude-code");
    return cc?.signedIn ? cc.signedIn() : undefined;
  }

  async onlineIds(): Promise<string[]> {
    const ids: string[] = [];
    let cameOnline = false;
    for (const b of this.backends) {
      const ok = await b.healthy();
      if (ok && this.lastHealthy.get(b.id) === false) cameOnline = true;
      this.lastHealthy.set(b.id, ok);
      if (ok) ids.push(b.id);
    }
    // A backend that was down at boot (e.g. Claude installed AFTER Relay) has no models in the
    // map; rebuild once on the transition so recovery doesn't require a daemon restart.
    if (cameOnline) await this.refreshModels();
    return ids;
  }
}
