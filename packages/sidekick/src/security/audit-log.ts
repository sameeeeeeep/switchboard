import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AuditEntry } from "@relay/protocol";

/**
 * Append-only audit log, per daemon, one JSON line per entry (~/.relay/audit.log). Every
 * request, tool call, and consent decision is recorded per origin. Viewable + exportable in
 * the popup; underpins revoke + kill switch. NEVER write raw MCP credentials or full tool
 * payloads here — only non-sensitive metadata.
 */
export class AuditLog {
  private file: string;
  constructor(stateDir: string) {
    this.file = join(stateDir, "audit.log");
  }

  record(entry: Omit<AuditEntry, "id" | "ts">): AuditEntry {
    const full: AuditEntry = { id: randomUUID(), ts: Date.now(), ...entry };
    try {
      appendFileSync(this.file, JSON.stringify(full) + "\n", { mode: 0o600 });
    } catch (err) {
      console.error("[audit] append failed:", err);
    }
    return full;
  }

  /** Read back the log (optionally filtered by origin) for the popup / export. */
  read(origin?: string, limit = 500): AuditEntry[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
    const out: AuditEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const e = JSON.parse(lines[i]!) as AuditEntry;
        if (!origin || e.origin === origin) out.push(e);
      } catch { /* skip corrupt line */ }
    }
    return out;
  }
}
