import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, delimiter } from "node:path";

// Small transport boundary: the app-server schema is versioned by the installed CLI.
export type RpcMessage = { id?: number | string; method?: string; params?: any; result?: any; error?: { code?: number; message: string } };
export class CodexRpc {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private listeners = new Set<(message: RpcMessage) => void>();
  private closed = false;
  constructor(command: string, args: string[], cwd: string) {
    this.child = spawn(command, args, { cwd, stdio: "pipe", env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` } });
    // Never forward stderr: runtime diagnostics can contain prompts or account information.
    this.child.stderr.resume();
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      let message: RpcMessage;
      try { message = JSON.parse(line); } catch { this.close(new Error("Codex returned invalid JSON")); return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) { this.close(new Error("Codex returned an invalid message")); return; }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(Number(message.id));
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(Number(message.id));
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
    this.child.on("error", () => this.close(new Error("Could not start Codex App Server")));
    this.child.on("exit", () => this.close(new Error("Codex App Server exited")));
    this.child.stdin.on("error", () => this.close(new Error("Codex transport closed")));
  }
  get alive() { return !this.closed; }
  onMessage(listener: (message: RpcMessage) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  send(message: RpcMessage) {
    if (this.closed) throw new Error("Codex App Server is closed");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method: string, params: unknown, timeoutMs = 30_000): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Codex App Server is closed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  close(error = new Error("Codex App Server stopped")) {
    if (this.closed) return;
    this.closed = true;
    this.child.kill();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: "transport/closed", params: { error } });
    this.listeners.clear();
  }
}
