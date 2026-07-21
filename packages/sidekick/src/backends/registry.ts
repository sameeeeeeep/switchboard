import type { ModelBackend } from "./types.js";
import { ClaudeCodeBackend } from "./claude-code.js";
import { LocalOpenAIBackend } from "./local-openai.js";

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
    // Default: first backend whose LAST OBSERVED health was good. The old `backends[0] ?? null`
    // made PROVIDER_UNAVAILABLE dead code — an offline Claude was still handed every request.
    return this.backends.find((b) => this.lastHealthy.get(b.id) === true) ?? null;
  }

  async models(): Promise<string[]> {
    return [...this.modelToBackend.keys()];
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
