import { WebSocket } from "ws";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addTask } from "@relay/bank-mcp/tasks.mjs";

/**
 * The Slack INBOX client — the daemon half of the Slack `/notch` ingress (docs/SLACK-CONNECTOR.md).
 *
 * When the user has LINKED a Slack handle (`~/.relay/slack.json = { handle, relay }`), this dials the
 * team relay's `wss://<relay>/inbox/<handle>` and listens for tasks that Slack routed there. Absent
 * that file it stays INERT (no network) — the founder opts in by writing slack.json.
 *
 * On an incoming `{ from, text, mode:"notch" }` it runs the SAME delivery as the local test path:
 *   1. append the task to the ACTIVE project's board (tasks.md), noting who sent it, and
 *   2. raise a NOTCH card (~/.relay/guide-run.json — the switchboard skill's protocol) so the user
 *      sees "<from> sent you: <text>" with an "On my board ✓" / "Open board" choice.
 *
 * LOCAL TEST PATH (no Slack/Cloudflare needed): it also polls `~/.relay/inbox-task.json`; drop a
 * `{ from, text, mode }` there and it consumes the file and delivers exactly as a relay task would:
 *   echo '{"from":"Sam","text":"send the new logo","mode":"notch"}' > ~/.relay/inbox-task.json
 *
 * The relay dial reuses relay-transport's shape (a `ws` socket + reconnect-with-backoff); it never
 * touches the team engine's transport/crypto — this is an additive, separate socket.
 */

export interface InboxTask {
  from: string;
  text: string;
  mode?: string;
  team?: string;
  at?: number;
}

export interface InboxClientDeps {
  /** ~/.relay (config.stateDir) — where slack.json, inbox-task.json and guide-run.json live. */
  stateDir: string;
  /** The active project's bound folder (tasks.md lives here); null ⇒ fall back to ~/SwitchboardBrain. */
  activeFolder: () => string | null;
  log?: (m: string) => void;
}

const RECONNECT_MIN_MS = 2500;
const RECONNECT_MAX_MS = 30_000;
const LOCAL_POLL_MS = 1000;

/** The board used when no project is active — mirrors the switchboard connector's DEFAULT_VAULT. */
function defaultVault(): string {
  return join(homedir(), "SwitchboardBrain");
}

export class InboxClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff = RECONNECT_MIN_MS;
  private pollTimer: NodeJS.Timeout | null = null;
  private handle: string | null = null;
  private relayBase: string | null = null;
  private readonly localFile: string;

  constructor(private deps: InboxClientDeps) {
    this.localFile = join(deps.stateDir, "inbox-task.json");
  }

  /** Start the local file watcher (always) + the relay dial (only if slack.json links a handle). */
  start(): void {
    this.pollLocal();          // local test path runs regardless — needs no Slack/Cloudflare
    this.loadConfigAndDial();  // relay dial is inert until the founder writes ~/.relay/slack.json
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
  }

  private log(m: string): void { this.deps.log?.(m); }

  private loadConfigAndDial(): void {
    const cfgPath = join(this.deps.stateDir, "slack.json");
    if (!existsSync(cfgPath)) return; // not linked → stay inert (no relay connection)
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { handle?: string; relay?: string };
      if (!cfg.handle || !cfg.relay) { this.log("slack.json missing handle/relay — inbox inert"); return; }
      this.handle = String(cfg.handle).toLowerCase();
      this.relayBase = normalizeRelay(cfg.relay);
    } catch (err) { this.log("slack.json unreadable: " + String(err).slice(0, 120)); return; }
    this.dial();
  }

  // ── RELAY DIAL (reuses relay-transport's dial + reconnect-with-backoff shape) ─────────────────────
  private dial(): void {
    if (this.closed || !this.handle || !this.relayBase) return;
    const url = `${this.relayBase}/inbox/${encodeURIComponent(this.handle)}`;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.on("open", () => { this.backoff = RECONNECT_MIN_MS; this.log(`inbox connected as @${this.handle}`); });
    ws.on("error", () => { /* the close handler schedules the reconnect */ });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let task: unknown;
      try { task = JSON.parse(data.toString()); } catch { return; }
      void this.onTask(task as InboxTask);
    });
    ws.on("close", () => { if (this.ws === ws) this.ws = null; this.scheduleReconnect(); });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer || !this.handle) return;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS); // exponential backoff, capped
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.dial(); }, wait);
    this.reconnectTimer.unref?.();
  }

  // ── LOCAL TEST PATH (~/.relay/inbox-task.json) ───────────────────────────────────────────────────
  private pollLocal(): void {
    if (this.closed) return;
    try {
      if (existsSync(this.localFile)) {
        const raw = readFileSync(this.localFile, "utf8");
        rmSync(this.localFile, { force: true }); // consume-once, even on a bad parse
        let task: unknown = null;
        try { task = JSON.parse(raw); } catch { this.log("inbox-task.json not valid JSON"); }
        if (task) void this.onTask(task as InboxTask);
      }
    } catch (err) { this.log("local inbox poll failed: " + String(err).slice(0, 120)); }
    this.pollTimer = setTimeout(() => this.pollLocal(), LOCAL_POLL_MS);
    this.pollTimer.unref?.();
  }

  // ── DELIVERY (shared by the relay socket and the local file) ─────────────────────────────────────
  private async onTask(task: InboxTask): Promise<void> {
    if (!task || typeof task.text !== "string" || !task.text.trim()) return;
    const from = typeof task.from === "string" && task.from.trim() ? task.from.trim() : "Someone";
    const text = task.text.trim();
    const mode = task.mode || "notch";
    // /hijack (the takeover) is a later mode — only /notch is wired here.
    if (mode !== "notch") { this.log(`ignoring inbox task mode '${mode}' (only notch is wired)`); return; }
    try {
      this.addToBoard(from, text);
      this.raiseNotch(from, text);
      this.log(`notch task from ${from}: "${text.slice(0, 60)}"`);
    } catch (err) { this.log("inbox delivery failed: " + String(err).slice(0, 160)); }
  }

  /** Append the task to the active project's tasks.md (todo column), noting who sent it. */
  private addToBoard(from: string, text: string): void {
    const folder = this.deps.activeFolder() || defaultVault();
    try { mkdirSync(folder, { recursive: true }); } catch { /* best effort */ }
    const tasksPath = join(folder, "tasks.md");
    const existing = existsSync(tasksPath) ? readFileSync(tasksPath, "utf8") : "";
    const { doc, added } = addTask(text, { detail: [`from ${from} via Slack`] }, existing);
    if (added) writeFileSync(tasksPath, doc);
  }

  /** Raise a NOTCH card via ~/.relay/guide-run.json (the switchboard skill's protocol — the native
   *  app watches this path). Atomic temp+rename so the watcher never reads a half-written file. */
  private raiseNotch(from: string, text: string): void {
    const card = {
      mode: "teach",
      title: "New task",
      source: `Slack · @${from}`,
      steps: [
        {
          id: "t",
          text: `${from} sent you: ${text}`,
          placement: "notch",
          options: [
            { id: "added", label: "On my board ✓", recommended: true },
            { id: "open", label: "Open board" },
          ],
        },
      ],
    };
    const runFile = join(this.deps.stateDir, "guide-run.json");
    const tmp = runFile + ".inbox.tmp";
    writeFileSync(tmp, JSON.stringify(card));
    renameSync(tmp, runFile);
  }
}

/** Accept a bare host or a full ws(s):// base in slack.json; return a clean `wss://host` base. */
function normalizeRelay(relay: string): string {
  let base = String(relay).trim().replace(/\/+$/, "");
  if (!/^wss?:\/\//i.test(base)) base = "wss://" + base;
  return base;
}
