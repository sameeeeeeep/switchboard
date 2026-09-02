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
  /** Spec a one-line `/hijack` task into concrete guided steps + a rough time estimate (an LLM draft).
   *  Optional — when absent or it throws, hijack falls back to a single-step "just do it" run, no estimate. */
  specTask?: (task: string) => Promise<{ steps: string[]; minutes?: number }>;
  log?: (m: string) => void;
}

const RECONNECT_MIN_MS = 2500;
const RECONNECT_MAX_MS = 30_000;
const LOCAL_POLL_MS = 1000;

// /hijack pester lifecycle (docs/SLACK-CONNECTOR.md) — how long the "good time?" heads-up waits before
// re-nudging, how long the guided run may sit open while they work, the snooze, the breather between
// re-nudges, and a cap so we pester ~6 rounds then give up (task stays on the board either way).
const HIJACK_NUDGE_TIMEOUT_MS = 90_000;
const HIJACK_GUIDE_TIMEOUT_MS = 30 * 60_000;
const HIJACK_SNOOZE_MS = 15 * 60_000;
const HIJACK_REMIND_MS = 5 * 60_000;    // "remind me when I'm free" — a lighter-touch re-nudge than a full snooze
const HIJACK_RENUDGE_MS = 60_000;
const HIJACK_MAX_NUDGES = 6;

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
  private activeHijacks = new Set<string>();   // one live hijack lifecycle per (sender, task)

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
    try {
      if (mode === "hijack") {
        // /hijack — the PESTER (docs/SLACK-CONNECTOR.md): NOT screen control. A "good time?" heads-up +
        // a sprite trailing the cursor until they BEGIN; begin opens the specced guided run (sprite off);
        // abandon brings it back; complete ends it; "I'm busy" snoozes. Fire-and-forget — the lifecycle
        // loops with awaits and must NOT block the inbox socket.
        void this.runHijack(from, text);
        this.log(`hijack from ${from}: "${text.slice(0, 60)}" (nudging)`);
      } else {
        this.addToBoard(from, text);
        this.raiseNotch(from, text);
        this.log(`notch task from ${from}: "${text.slice(0, 60)}"`);
      }
    } catch (err) { this.log("inbox delivery failed: " + String(err).slice(0, 160)); }
  }

  /** Append the task to the active project's tasks.md (todo column), noting who sent it. */
  private addToBoard(from: string, text: string, via: "notch" | "hijack" = "notch"): void {
    const folder = this.deps.activeFolder() || defaultVault();
    try { mkdirSync(folder, { recursive: true }); } catch { /* best effort */ }
    const tasksPath = join(folder, "tasks.md");
    const existing = existsSync(tasksPath) ? readFileSync(tasksPath, "utf8") : "";
    const note = via === "hijack" ? `from ${from} via Slack /hijack` : `from ${from} via Slack`;
    const { doc, added } = addTask(text, { detail: [note] }, existing);
    if (added) writeFileSync(tasksPath, doc);
  }

  /** /hijack lifecycle (docs/SLACK-CONNECTOR.md). Spec the one-liner into steps ONCE, then drive the
   *  NUDGING → GUIDED → done/abandon state machine. Daemon-owned so the pest can genuinely re-nudge
   *  after an abandon or a snooze. Fire-and-forget (never awaited by the socket). */
  private async runHijack(from: string, text: string): Promise<void> {
    const key = `${from}\n${text}`;
    if (this.activeHijacks.has(key)) return;   // ignore a duplicate while one is already live
    this.activeHijacks.add(key);
    try {
      this.addToBoard(from, text, "hijack");
      let steps: string[] = [];
      let minutes: number | undefined;
      if (this.deps.specTask) {
        try {
          const specced = await this.deps.specTask(text);
          steps = (specced?.steps || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
          minutes = specced?.minutes;
        } catch (err) { this.log("hijack spec failed, using fallback: " + String(err).slice(0, 120)); }
      }
      const specced = steps.length > 0;   // false ⇒ we couldn't auto-break it down ("yet to spec")
      if (!specced) steps = [text];       // fallback: the raw task as one actionable step
      await this.hijackLoop(from, text, steps, specced, minutes);
    } catch (err) {
      this.log("hijack lifecycle error: " + String(err).slice(0, 160));
    } finally {
      this.clearPester();
      this.activeHijacks.delete(key);
    }
  }

  /** The state machine. NUDGING (heads-up + sprite) → on Start, GUIDED (specced run, sprite off) →
   *  complete ends it, abandon loops back to NUDGING (sprite returns). "I'm busy" snoozes; being ignored
   *  re-nudges up to a cap, then gives up (the task is already on the board). */
  private async hijackLoop(from: string, text: string, steps: string[], specced: boolean, minutes?: number): Promise<void> {
    let nudges = 0;
    while (!this.closed) {
      if (nudges >= HIJACK_MAX_NUDGES) { this.log(`hijack from ${from}: gave up after ${nudges} nudges`); return; }
      nudges++;
      // ── NUDGING: the "good time?" warning card + the pester sprite ──
      const huId = this.rid("hu");
      this.writePester(from, text);
      this.raiseHeadsUp(from, text, huId, steps.length, specced, minutes);
      this.log(`hijack from ${from}: nudging (heads-up ${huId})`);
      const hu = await this.awaitResult(huId, HIJACK_NUDGE_TIMEOUT_MS);
      if (this.closed) return;
      if (!hu || hu.outcome === "aborted") {
        // dismissed / ignored → the whole point is to persist: breather, then nudge again.
        this.clearPester();
        await this.delay(HIJACK_RENUDGE_MS);
        continue;
      }
      const note = (hu.note || "").toLowerCase();
      if (hu.chosenOption === "later" || hu.chosenOption === "busy" || /busy|later|not now|snooze|remind/.test(note)) {
        this.clearPester();
        this.log(`hijack from ${from}: snoozed ${HIJACK_SNOOZE_MS / 60000}m`);
        await this.delay(HIJACK_SNOOZE_MS);
        continue;
      }
      if (hu.chosenOption === "plan" || /plan|watch|supervise|see/.test(note)) {
        // SUPERVISE the prep — show how the task broke down, then let them do it or defer. Engaging with
        // the plan counts as attention, so the sprite stands down while they review.
        this.clearPester();
        const go = await this.showPlan(from, text, steps, minutes);
        if (this.closed) return;
        if (!go) { this.log(`hijack from ${from}: reviewed the plan, deferred`); await this.delay(HIJACK_REMIND_MS); continue; }
        // they hit "Do it" after reviewing → fall through into the guided run
      }
      // ── START (they've begun): sprite off, open the specced guided run ──
      this.clearPester();
      const grId = this.rid("gr");
      this.raiseGuided(from, text, steps, grId);
      this.log(`hijack from ${from}: begun (guided ${grId})`);
      const gr = await this.awaitResult(grId, HIJACK_GUIDE_TIMEOUT_MS);
      if (this.closed) return;
      if (gr && gr.outcome === "completed") {
        this.log(`hijack from ${from}: completed ✓`);
        return;   // success → never comes back
      }
      // abandoned (esc) or timed out → the pest comes back (loop → NUDGING), after a breather.
      this.log(`hijack from ${from}: abandoned — re-nudging`);
      await this.delay(HIJACK_RENUDGE_MS);
    }
  }

  /** The NUDGING card: a heads-up "good time?" that shows STATUS (specced & loaded vs yet to spec) + a
   *  TIME ESTIMATE, and lets a mid-something user bail cleanly (Remind me / I'm busy) instead of being
   *  dragged into the walkthrough. */
  private raiseHeadsUp(from: string, text: string, runId: string, stepCount: number, specced: boolean, minutes?: number): void {
    const est = typeof minutes === "number" && minutes > 0 ? `~${minutes} min` : "quick";
    const status = specced ? `✓ Specced & loaded · ${stepCount} step${stepCount === 1 ? "" : "s"} · ${est}` : `⏳ Yet to spec · ${est}`;
    this.writeRun({
      mode: "teach",
      title: `🎯 ${from} hijacked you`,
      runId,
      source: `Slack · @${from} · /hijack`,
      steps: [{
        id: "headsup",
        text: `${from} wants you to: ${text}\n${status}\nGood time? (⌥↓ if you're mid-something)`,
        say: `${from} hijacked you — ${text}. ${specced ? `About ${est}.` : ""} Is now a good time?`,
        placement: "notch",
        options: [
          { id: "start", label: "Do it now", detail: `${est} · ${stepCount} step${stepCount === 1 ? "" : "s"}`, recommended: true },
          { id: "plan", label: "See the plan first", detail: "watch how it broke down, then decide" },
          { id: "later", label: "Not now", detail: `re-nudge later (snooze ${HIJACK_SNOOZE_MS / 60000} min)` },
        ],
      }],
    });
  }

  /** SUPERVISE: a transparency view of the prep — show exactly how the task broke down (the specced
   *  steps + estimate) so they can watch what they're in for, then choose to do it or defer. No agent
   *  execution; just visibility. Returns true if they hit "Do it now". */
  private async showPlan(from: string, text: string, steps: string[], minutes?: number): Promise<boolean> {
    const est = typeof minutes === "number" && minutes > 0 ? `~${minutes} min` : "quick";
    const list = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const planId = this.rid("plan");
    this.writeRun({
      mode: "teach",
      title: `🎯 ${from}: the plan`,
      runId: planId,
      source: `Slack · @${from} · /hijack`,
      steps: [{
        id: "plan",
        text: `Here's how "${text}" broke down:\n${list}\n\n✓ ${steps.length} step${steps.length === 1 ? "" : "s"} · ${est}. Go?`,
        say: `Here's the plan for ${text}. ${steps.length} steps, about ${est}. Want to do it?`,
        placement: "notch",
        options: [
          { id: "do", label: "Do it now", detail: est, recommended: true },
          { id: "later", label: "Not now", detail: "I'll re-nudge later" },
        ],
      }],
    });
    this.log(`hijack from ${from}: showing plan (${planId})`);
    const r = await this.awaitResult(planId, HIJACK_NUDGE_TIMEOUT_MS);
    if (!r || r.outcome === "aborted") return false;
    return r.chosenOption === "do" || /\b(do|yes|go|start)\b/.test((r.note || "").toLowerCase());
  }

  /** The GUIDED run: the specced steps the target performs themselves + a final confirm so "completed"
   *  genuinely means done. Raised only after they hit Start (the sprite is already off). */
  private raiseGuided(from: string, text: string, steps: string[], runId: string): void {
    const guideSteps = steps.map((s, i) => ({ id: `h${i}`, text: s, placement: "notch" }));
    guideSteps.push({ id: "done", text: "Done — you actually did it? ✓ (⌥→ to finish)", placement: "notch" });
    this.writeRun({
      mode: "teach",
      title: `🎯 ${from}: ${text.slice(0, 40)}`,
      runId,
      source: `Slack · @${from} · /hijack`,
      steps: guideSteps,
    });
  }

  /** Atomic write of the single-slot guide-run.json (the native app's trigger). */
  private writeRun(card: unknown): void {
    const runFile = join(this.deps.stateDir, "guide-run.json");
    const tmp = runFile + ".inbox.tmp";
    writeFileSync(tmp, JSON.stringify(card));
    renameSync(tmp, runFile);
  }

  /** Drop the pester flag the native app watches (~/.relay/pester.json): the sender's sprite trails the
   *  target's OWN cursor. Never controls the pointer — pure nudge. */
  private writePester(from: string, text: string): void {
    const pesterFile = join(this.deps.stateDir, "pester.json");
    const tmp = pesterFile + ".tmp";
    writeFileSync(tmp, JSON.stringify({ active: true, from, task: text, at: Date.now() }));
    renameSync(tmp, pesterFile);
  }

  /** Remove the pester flag (the app stops the sprite within a poll tick). */
  private clearPester(): void {
    try { rmSync(join(this.deps.stateDir, "pester.json"), { force: true }); } catch { /* already gone */ }
  }

  /** Unique run id for the collision-proof per-run result file. */
  private rid(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  /** A cancel-aware delay (unref'd so it never keeps the process alive). */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });
  }

  /** Poll the collision-proof per-run result (guide-results/<runId>.json) until it appears or times out.
   *  Returns { outcome, chosenOption, note } or null on timeout / shutdown. */
  private async awaitResult(runId: string, timeoutMs: number): Promise<{ outcome?: string; chosenOption?: string; note?: string } | null> {
    const file = join(this.deps.stateDir, "guide-results", `${runId}.json`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.closed) {
      if (existsSync(file)) {
        try {
          const d = JSON.parse(readFileSync(file, "utf8")) as { outcome?: string; results?: Array<{ chosenOption?: string; feedback?: { note?: string } }> };
          const r = (d.results && d.results[0]) || {};
          return { outcome: d.outcome, chosenOption: r.chosenOption, note: r.feedback?.note };
        } catch { /* mid-write — retry next tick */ }
      }
      await this.delay(1500);
    }
    return null;
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
