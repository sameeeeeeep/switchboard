import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Model selection is sticky for a conversation; defaults apply to new conversations. */
export class SessionRoutes {
  private routes = new Map<string, string>();
  constructor(private directory: string) {
    try { this.routes = new Map(JSON.parse(readFileSync(join(directory, "session-models.json"), "utf8"))); } catch { /* first run */ }
  }
  private key(origin: string, session: string) { return JSON.stringify([origin, session]); }
  get(origin: string, session?: string) { return session ? this.routes.get(this.key(origin, session)) : undefined; }
  pin(origin: string, session: string | undefined, model: string) {
    if (!session || this.get(origin, session)) return;
    this.routes.set(this.key(origin, session), model);
    this.persist();
  }
  end(origin: string, session: string) { if (this.routes.delete(this.key(origin, session))) this.persist(); }
  private persist() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, "session-models.json");
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.routes]), { mode: 0o600 });
    renameSync(temporary, file);
  }
}
