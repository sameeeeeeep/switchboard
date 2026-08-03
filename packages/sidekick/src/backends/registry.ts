import type { ModelBackend } from "./types.js";
import { ClaudeCodeBackend } from "./claude-code.js";
import { LocalOpenAIBackend } from "./local-openai.js";
import { OpenRouterBackend } from "./openrouter.js";
import { loadCloudConfig, loadModelPrefs } from "../config.js";
import { canonicalModel } from "../security/grant-store.js";

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
    // Local runner (Ollama / LM Studio) — AUTO-DETECTED at Ollama's default port so every daemon
    // (incl. the always-on menu-bar one) can serve local models with zero config. healthy() gates
    // it: nothing listening ⇒ no models, inert. RELAY_LOCAL_OPENAI_URL overrides the URL;
    // RELAY_LOCAL_OPENAI=0 disables the probe entirely.
    if (process.env.RELAY_LOCAL_OPENAI !== "0") {
      const baseUrl = process.env.RELAY_LOCAL_OPENAI_URL || "http://127.0.0.1:11434/v1";
      reg.register(new LocalOpenAIBackend({ baseUrl, id: "ollama" }));
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

  // ── User model selection (docs/MODEL-SELECTION.md §3) ─────────────────────────────────────────
  // The CAPABILITY set is the raw truth of what backends serve (never filtered — used for gate
  // legality + as the pool of substitution targets). The ALLOWED set = capability set − the user's
  // deny-list (~/.relay/models.json). Every surface that CHOOSES a model reads the allowed set; the
  // run-time completion path SUBSTITUTES a disabled request down to an allowed one before the gate.
  // Prefs are read fresh each call (like economy) so a Settings toggle needs no restart.

  /** The raw capability set — every model a healthy backend serves right now. Sync (the data is the
   *  already-built model→backend map). */
  capabilityModels(): string[] {
    return [...this.modelToBackend.keys()];
  }

  private disabledSet(): Set<string> {
    return new Set(loadModelPrefs().disabled);
  }

  /** Is this model NOT on the user's deny-list? (Canonical compare, so disabling "opus" also catches
   *  "claude-opus-4-8".) A model the user never disabled is allowed even if offline — substitution
   *  only ever fires for a DISABLED request, never merely an offline one. */
  isAllowed(model: string): boolean {
    return !this.disabledSet().has(canonicalModel(model));
  }

  /** Capability set minus the deny-list, honoring the health map already baked into the model map.
   *  BELT-AND-SUSPENDERS (§5 "all models disabled"): if the deny-list would empty the allowed set,
   *  fall back to the full capability set — the daemon warns but NEVER bricks. */
  allowedModels(): string[] {
    const all = this.capabilityModels();
    const disabled = this.disabledSet();
    const allowed = all.filter((m) => !disabled.has(canonicalModel(m)));
    return allowed.length ? allowed : all;
  }

  /** First candidate that isn't disabled (canonical compare), or undefined. */
  firstAllowed(candidates: string[]): string | undefined {
    const disabled = this.disabledSet();
    return candidates.find((m) => !disabled.has(canonicalModel(m)));
  }

  /** Which CLASS of backend serves a model — so substitution can preserve the class of work:
   *  "claude" (vision + agentic), "hosted" (third-party, never a SILENT substitute), "local" (an
   *  Ollama-style runner: non-multimodal, can't drive the tool loop). null = not currently served. */
  backendKindOf(model: string): "claude" | "hosted" | "local" | null {
    const b = this.modelToBackend.get(model);
    if (!b) return null;
    if (b.hosted) return "hosted";
    return b.id === "claude-code" ? "claude" : "local";
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
