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
      if (!(await b.healthy())) continue;
      for (const m of await b.listModels()) {
        if (!this.modelToBackend.has(m)) this.modelToBackend.set(m, b);
      }
    }
  }

  backendFor(model: string | undefined): ModelBackend | null {
    if (model && this.modelToBackend.has(model)) return this.modelToBackend.get(model)!;
    // Default: first healthy backend (Claude Code).
    return this.backends[0] ?? null;
  }

  async models(): Promise<string[]> {
    return [...this.modelToBackend.keys()];
  }

  async onlineIds(): Promise<string[]> {
    const ids: string[] = [];
    for (const b of this.backends) if (await b.healthy()) ids.push(b.id);
    return ids;
  }
}
