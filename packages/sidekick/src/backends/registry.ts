import type { ModelBackend } from "./types.js";
import { BYOPErrorCode, ProviderError, type ModelInfo } from "@relay/protocol";
import { ClaudeCodeBackend } from "./claude-code.js";
import { CodexBackend } from "./codex.js";
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
    if (process.env.RELAY_CODEX !== "0") reg.register(new CodexBackend());
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
    if (process.env.RELAY_BACKEND === "codex") return this.backends.find((b) => b.id === "codex" && this.lastHealthy.get(b.id)) ?? null;
    // Default: first HEALTHY backend — but NEVER a hosted one. An omitted or unknown model id means
    // "the user's own default", and resolving that to a hosted backend would send prompts off the
    // machine without anyone opting in — the one thing this product must never do. Hosted backends
    // are reachable ONLY by exact model match above.
    return this.backends.find((b) => !b.hosted && this.lastHealthy.get(b.id) === true) ?? null;
  }

  async models(): Promise<string[]> {
    return [...this.modelToBackend.keys()];
  }

  modelInfo(): ModelInfo[] {
    return this.allowedModels().map((id) => {
      const backend = this.modelToBackend.get(id)!;
      return {
        id, backend: backend.id, hosted: backend.hosted === true,
        capabilities: {
          vision: backend.capabilities?.vision === true,
          agentic: backend.capabilities?.agentic === true,
          warmSessions: backend.capabilities?.warmSessions === true,
        },
        toolSource: backend.id === "claude-code" ? "claude-code" : backend.capabilities?.agentic ? "broker-mcp" : "none",
      };
    });
  }

  /** Explicit operator choice maps legacy Claude aliases BEFORE consent and grant validation.
   * Never silently expands an existing origin grant. */
  preferredModel(model: string | undefined): string | undefined {
    if (model && !["opus", "sonnet", "haiku"].includes(canonicalModel(model))) return model;
    const preference = loadModelPrefs().defaultModel;
    if (preference && this.isAllowed(preference)) return preference;
    if (process.env.RELAY_BACKEND !== "codex") return model;
    const backend = this.backends.find((b) => b.id === "codex");
    const selected = backend?.defaultModel?.();
    if (!selected) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, "Codex is selected but unavailable. Install Codex, sign in with codex login, then retry.");
    return selected;
  }

  supports(model: string, need: { vision: boolean; agentic: boolean }): boolean {
    const capabilities = this.modelToBackend.get(model)?.capabilities;
    return (!need.vision || capabilities?.vision === true) && (!need.agentic || capabilities?.agentic === true);
  }

  async endSession(origin: string, sessionId: string) {
    await Promise.all(this.backends.map((b) => b.endSession?.(origin, sessionId)));
  }

  close() { for (const backend of this.backends) backend.close?.(); }

  async inventory() {
    return Promise.all(this.backends.map(async (backend) => ({
      id: backend.id, online: this.lastHealthy.get(backend.id) === true,
      signedIn: this.lastHealthy.get(backend.id) ? (backend.signedIn ? await backend.signedIn() : true) : false,
      models: [...this.modelToBackend].filter(([, b]) => b === backend).map(([model]) => model),
    })));
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

  /** Capability set minus the deny-list. An empty selection stays empty so controls and routing
   * agree; the user must enable a model before starting another conversation. */
  allowedModels(): string[] {
    const all = this.capabilityModels();
    const disabled = this.disabledSet();
    const allowed = all.filter((m) => !disabled.has(canonicalModel(m)));
    return allowed;
  }

  /** First candidate that isn't disabled (canonical compare), or undefined. */
  firstAllowed(candidates: string[]): string | undefined {
    const disabled = this.disabledSet();
    return candidates.find((m) => !disabled.has(canonicalModel(m)));
  }

  /** Which CLASS of backend serves a model — so substitution can preserve the class of work:
   *  "claude" (vision + agentic), "hosted" (third-party, never a SILENT substitute), "local" (an
   *  Ollama-style runner: non-multimodal, can't drive the tool loop). null = not currently served. */
  backendKindOf(model: string): "claude" | "codex" | "hosted" | "local" | null {
    const b = this.modelToBackend.get(model);
    if (!b) return null;
    if (b.hosted) return "hosted";
    if (b.id === "codex") return "codex";
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
    let unknown = false;
    for (const b of this.backends) {
      if (!this.lastHealthy.get(b.id)) continue;
      if (process.env.RELAY_BACKEND === "codex" && b.id !== "codex") continue;
      const signedIn = b.signedIn ? await b.signedIn() : true;
      if (signedIn === true) return true;
      if (signedIn === undefined) unknown = true;
    }
    return unknown ? undefined : false;
  }

  async onlineIds(): Promise<string[]> {
    const ids: string[] = [];
    let changed = false;
    for (const b of this.backends) {
      const ok = await b.healthy();
      if (this.lastHealthy.get(b.id) !== ok) changed = true;
      this.lastHealthy.set(b.id, ok);
      if (ok) ids.push(b.id);
    }
    // A backend that was down at boot (e.g. Claude installed AFTER Relay) has no models in the
    // map; rebuild once on the transition so recovery doesn't require a daemon restart.
    if (changed) await this.refreshModels();
    return ids;
  }
}
