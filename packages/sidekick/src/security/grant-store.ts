import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OriginGrant, ScopeRequest, ToolGrant } from "@relay/protocol";
import { DEFAULT_BUDGETS } from "@relay/protocol";

/**
 * Model ids come in two forms — short aliases ("haiku", "sonnet", "opus") and full ids
 * ("claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"). The CLI accepts both, and a consent
 * that granted "haiku" means the SAME model an app requests as "claude-haiku-4-5". Fold known
 * equivalents to one canonical key so the exact-match grant check treats them as one model. Unknown
 * ids pass through unchanged — this never widens a grant beyond known-equivalent aliases.
 */
const MODEL_ALIASES: Record<string, string> = {
  "claude-haiku-4-5": "haiku",
  "claude-haiku-4-5-20251001": "haiku",
  "claude-sonnet-5": "sonnet",
  "claude-opus-4-8": "opus",
};
export function canonicalModel(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}

/**
 * Authoritative per-origin grant store. The daemon is the source of truth (the extension only
 * mirrors it for display). Persisted to ~/.relay/grants.json (0600). A grant is created only
 * after the user approves a connect consent; the granted scope may be NARROWER than requested,
 * never wider.
 */
export class GrantStore {
  private grants = new Map<string, OriginGrant>();
  private file: string;

  constructor(stateDir: string) {
    this.file = join(stateDir, "grants.json");
    this.load();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const arr = JSON.parse(readFileSync(this.file, "utf8")) as OriginGrant[];
      for (const g of arr) this.grants.set(g.origin, { ...g, mode: g.mode ?? "ask" }); // migrate pre-mode grants
    } catch (err) {
      console.error("[grant-store] load failed:", err);
    }
  }

  private persist() {
    try {
      writeFileSync(this.file, JSON.stringify([...this.grants.values()], null, 2), { mode: 0o600 });
    } catch (err) {
      console.error("[grant-store] persist failed:", err);
    }
  }

  get(origin: string): OriginGrant | null {
    const g = this.grants.get(origin);
    if (!g) return null;
    if (g.expiresAt && Date.now() > g.expiresAt) {
      this.grants.delete(origin);
      this.persist();
      return null;
    }
    return g;
  }

  /** Create/replace a grant from the scope the USER approved (already narrowed by the consent
   *  UI). `approvedTools` carries each tool with its daemon-assigned access class. */
  upsert(origin: string, approved: { models: string[]; tools: ToolGrant[]; budgets: ScopeRequest["budgets"]; contextKinds?: string[]; expiresAt?: number }): OriginGrant {
    const now = Date.now();
    const prev = this.grants.get(origin);
    const grant: OriginGrant = {
      origin,
      mode: prev?.mode ?? "ask", // preserve the user's chosen trust mode across re-consents; default ask
      models: approved.models,
      tools: approved.tools,
      budgets: { ...DEFAULT_BUDGETS, ...(approved.budgets ?? {}) },
      contextKinds: approved.contextKinds?.length ? approved.contextKinds : undefined,
      expiresAt: approved.expiresAt,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    this.grants.set(origin, grant);
    this.persist();
    return grant;
  }

  /** Set an origin's trust mode (ask/trust/readonly). User-driven, out of band. */
  setMode(origin: string, mode: OriginGrant["mode"]): OriginGrant | null {
    const g = this.grants.get(origin);
    if (!g) return null;
    g.mode = mode;
    g.updatedAt = Date.now();
    this.persist();
    return g;
  }

  revoke(origin: string): void {
    this.grants.delete(origin);
    this.persist();
  }

  /** Kill switch: drop every grant. */
  revokeAll(): void {
    this.grants.clear();
    this.persist();
  }

  list(): OriginGrant[] {
    return [...this.grants.values()];
  }

  /** Scope checks used by the gate. */
  allowsModel(origin: string, model: string | undefined): boolean {
    const g = this.get(origin);
    if (!g) return false;
    if (!model) return g.models.length > 0;
    const want = canonicalModel(model);
    return g.models.some((m) => canonicalModel(m) === want);
  }

  toolGrant(origin: string, name: string): ToolGrant | null {
    const g = this.get(origin);
    return g?.tools.find((t) => t.name === name) ?? null;
  }
}
