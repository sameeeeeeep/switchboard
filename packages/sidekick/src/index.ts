#!/usr/bin/env node
import { writeFileSync, watchFile } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { GrantStore } from "./security/grant-store.js";
import { BudgetLedger } from "./security/budgets.js";
import { AuditLog } from "./security/audit-log.js";
import { Gate } from "./security/gate.js";
import { McpRegistry } from "./mcp/registry.js";
import { loadMcpConfig } from "./mcp/config.js";
import { BackendRegistry } from "./backends/registry.js";
import { StorageStore } from "./storage/store.js";
import { ContextLibrary, folderOf } from "./context/library.js";
import { seedExampleIfEmpty } from "./seed/example.js";
import { seedDictionaryIfMissing } from "./media/dictionary.js";
import { SessionManager } from "./session/manager.js";
import { TeamEngine } from "./team/engine.js";
import { Broker } from "./server.js";
import { NativeListener } from "./native/listener.js";
import { RoutineRegistry } from "./routines/registry.js";
import { makeAutopilotRoutine } from "./routines/autopilot.js";
import { InboxClient } from "./inbox/client.js";

// Safety net: a long-lived daemon must NEVER die on a stray socket error or an unhandled
// rejection (e.g. a dropped extension connection resetting mid-request). Log and keep running —
// staying up degraded beats crashing the user's whole broker mid-session.
process.on("uncaughtException", (err) => console.error("[relay] uncaughtException (kept alive):", (err as any)?.stack || err));
process.on("unhandledRejection", (reason) => console.error("[relay] unhandledRejection (kept alive):", (reason as any)?.stack || reason));

/**
 * Sidekick entrypoint. Wires the pieces and starts the loopback broker. Order matters only in
 * that the Broker is constructed last (it implements ConsentPrompter, which the Gate needs) —
 * so we build the Gate with a late-bound prompter reference.
 */
async function main() {
  const config = loadConfig();
  const grants = new GrantStore(config.stateDir);
  const budgets = new BudgetLedger();
  const audit = new AuditLog(config.stateDir);
  const mcp = await McpRegistry.boot(loadMcpConfig(config.stateDir));
  const backends = await BackendRegistry.boot();
  process.once("exit", () => backends.close());
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { backends.close(); process.exit(0); });
  const storage = new StorageStore(config.stateDir);
  const contexts = new ContextLibrary(config.stateDir);
  seedExampleIfEmpty(config.stateDir, contexts, storage, (m) => console.error("[relay/seed]", m)); // fresh machine ⇒ one example project so nothing's empty
  seedDictionaryIfMissing(); // fresh machine ⇒ a dictation dictionary from the user's name/wrapps/vault (whisper --prompt bias)
  const sessions = new SessionManager();

  // The Gate needs a ConsentPrompter, and the Broker IS the prompter. Break the cycle with a
  // holder the Gate reads through.
  let broker: Broker;
  const prompter = {
    requestWriteConsent: (r: any) => broker.requestWriteConsent(r),
    requestConnectConsent: (o: string, req: unknown) => broker.requestConnectConsent(o, req),
  };
  const gate = new Gate(grants, budgets, audit, prompter, mcp);
  // Team Mode (OFF by default) — same late-bound trick: the engine notifies through the Broker
  // (panel refresh + the storage-changed nudge wrapps already re-read on), which exists later.
  const team = new TeamEngine({
    stateDir: config.stateDir,
    userName: () => config.profile.name,
    audit: (method, outcome, note) => audit.record({ origin: "team", kind: "request", method, outcome, note }),
    onFolderChanged: (folder) => broker?.notifyTeamSync(folder),
    onTeamChanged: () => broker?.notifyTeamChanged(),
    onCursor: (c) => broker?.pushTeamCursor(c),   // realtime: relay a teammate's live cursor to the native app
    onSurface: (cmd) => broker?.pushSurfaceCommand(cmd),   // remote surface control: open/place a wrapp on our screen
  });
  broker = new Broker({ config, gate, grants, budgets, audit, mcp, backends, storage, contexts, sessions, team });
  broker.start();
  team.resume(); // no-op unless the user already enabled Team Mode and has a team

  // Slack INBOX client (docs/SLACK-CONNECTOR.md) — the daemon half of the `/notch` ingress. Dials
  // the team relay's /inbox/<handle> ONLY when the user has linked a Slack handle
  // (~/.relay/slack.json); absent that file it makes no network connection. It ALSO watches
  // ~/.relay/inbox-task.json as a local test path, so the whole board+notch delivery is exercisable
  // with no Slack/Cloudflare:  echo '{"from":"Sam","text":"send the new logo","mode":"notch"}' > ~/.relay/inbox-task.json
  const inbox = new InboxClient({
    stateDir: config.stateDir,
    activeFolder: () => folderOf(contexts.get(contexts.activeProject() ?? "")?.data) ?? null,
    // /hijack: spec a one-line task into concrete guided steps + a rough time estimate via a headless
    // Claude draft. Returns { steps: string[], minutes: number }; on any failure the inbox client falls
    // back to a single step with no estimate.
    specTask: async (task: string) => {
      const prompt = `Break this task into 2 to 4 concrete, checkable steps a person can follow to actually do it, and estimate how many minutes it realistically takes. Each step is one short imperative line. Reply with ONLY a JSON object: {"steps":["…","…"],"minutes":<integer>}. Nothing else.\n\nTask: ${task}`;
      const { text } = await broker.routineDraft("hijack", prompt);
      const match = text.match(/\{[\s\S]*\}/); // tolerate prose around the object
      const obj = JSON.parse(match ? match[0] : text) as { steps?: unknown; minutes?: unknown };
      const steps = Array.isArray(obj.steps) ? obj.steps.map((s) => String(s)) : [];
      const minutes = Number.isFinite(Number(obj.minutes)) ? Math.round(Number(obj.minutes)) : undefined;
      return { steps, minutes };
    },
    log: (m) => console.error("[relay/inbox]", m),
  });
  inbox.start();

  // The Run layer (docs/ROUTINES.md) — the daemon's background scheduler. Autopilot is routine #1:
  // while the menubar master switch is on it DRAFTS the active company's next moves (never acts —
  // every irreversible move stays gated in the cockpit). Dormant when routines-control.json is
  // { off: true } (the shipped default), so nothing runs in the background until the user opts in.
  const routines = new RoutineRegistry((m) => console.error("[relay/routines]", m));
  routines.register(makeAutopilotRoutine({
    draft: (prompt) => broker.routineDraft("autopilot", prompt),
    invoke: (toolSuffix, args) => broker.routineInvoke("autopilot", toolSuffix, args),
    dispatch: (p) => broker.routineDispatch("autopilot", p),
    log: (m) => console.error("[relay/routines]", m),
  }));
  routines.start();

  // The native (direct-principal) listener — a SECOND loopback socket for local apps that talk to
  // the daemon without a browser. INERT by default: it only starts if a native app has been
  // registered (~/.relay/app-tokens.json exists) or RELAY_NATIVE=1 is set. The extension socket,
  // its pairing token, and every existing verb are untouched whether or not this runs.
  // Native listener ON by default now (loopback-only, per-app-token or interactive-consent gated),
  // so a native app like Flow can connect to the user's main daemon and get its "Allow this app"
  // prompt in the panel. RELAY_NATIVE=0 disables it.
  if (process.env.RELAY_NATIVE !== "0") {
    const nativePort = Number(process.env.RELAY_NATIVE_PORT ?? 8788);
    new NativeListener("127.0.0.1", nativePort, broker).start();
  }

  // status.json — the daemon's live inventory for the menu-bar panel to read (connectors it can
  // grant + tool counts + backends). The panel can't see this otherwise: connectors are inherited
  // via the claude.ai SDK, not a local config file. Written on boot + refreshed periodically.
  async function writeStatus() {
    try {
      const connectors = mcp.connectors().map((c) => ({ name: c.label, tools: c.tools.length, ok: c.tools.length > 0 }));
      const status = {
        connectors,
        toolCount: connectors.reduce((n, c) => n + c.tools, 0),
        backends: await backends.onlineIds(),
        modelProviders: await backends.inventory(),
        updatedAt: Date.now(),
      };
      writeFileSync(join(config.stateDir, "status.json"), JSON.stringify(status, null, 2), { mode: 0o600 });
      await broker.notifyModelsChanged();
    } catch (err) {
      console.error("[relay] status write failed:", String(err).slice(0, 120));
    }
  }
  await writeStatus();
  watchFile(join(config.stateDir, "models.json"), { persistent: false, interval: 1000 }, () => {
    void broker.notifyModelsChanged().catch((err) => console.error("[relay] model notification failed:", String(err).slice(0, 120)));
  });
  setInterval(() => { void writeStatus(); }, 30_000).unref?.();

  console.error(`[relay] pairing token (paste into the extension): ${config.pairingToken}`);
  console.error(`[relay] paired as: ${config.profile.name} (set ~/.relay/profile.json or RELAY_USER to change)`);
  console.error(`[relay] backends online: ${(await backends.onlineIds()).join(", ") || "(none)"}`);
}

main().catch((err) => {
  console.error("[relay] fatal:", err);
  process.exit(1);
});
