#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, hasAppTokens } from "./config.js";
import { GrantStore } from "./security/grant-store.js";
import { BudgetLedger } from "./security/budgets.js";
import { AuditLog } from "./security/audit-log.js";
import { Gate } from "./security/gate.js";
import { McpRegistry } from "./mcp/registry.js";
import { loadMcpConfig } from "./mcp/config.js";
import { BackendRegistry } from "./backends/registry.js";
import { StorageStore } from "./storage/store.js";
import { ContextLibrary } from "./context/library.js";
import { SessionManager } from "./session/manager.js";
import { TeamEngine } from "./team/engine.js";
import { Broker } from "./server.js";
import { NativeListener } from "./native/listener.js";

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
  const storage = new StorageStore(config.stateDir);
  const contexts = new ContextLibrary(config.stateDir);
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
  });
  broker = new Broker({ config, gate, grants, budgets, audit, mcp, backends, storage, contexts, sessions, team });
  broker.start();
  team.resume(); // no-op unless the user already enabled Team Mode and has a team

  // The native (direct-principal) listener — a SECOND loopback socket for local apps that talk to
  // the daemon without a browser. INERT by default: it only starts if a native app has been
  // registered (~/.relay/app-tokens.json exists) or RELAY_NATIVE=1 is set. The extension socket,
  // its pairing token, and every existing verb are untouched whether or not this runs.
  if (process.env.RELAY_NATIVE === "1" || hasAppTokens()) {
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
        updatedAt: Date.now(),
      };
      writeFileSync(join(config.stateDir, "status.json"), JSON.stringify(status, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error("[relay] status write failed:", String(err).slice(0, 120));
    }
  }
  await writeStatus();
  setInterval(() => { void writeStatus(); }, 30_000).unref?.();

  console.error(`[relay] pairing token (paste into the extension): ${config.pairingToken}`);
  console.error(`[relay] paired as: ${config.profile.name} (set ~/.relay/profile.json or RELAY_USER to change)`);
  console.error(`[relay] backends online: ${(await backends.onlineIds()).join(", ") || "(none)"}`);
}

main().catch((err) => {
  console.error("[relay] fatal:", err);
  process.exit(1);
});
