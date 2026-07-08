#!/usr/bin/env node
import { loadConfig } from "./config.js";
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
import { Broker } from "./server.js";

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
  broker = new Broker({ config, gate, grants, budgets, audit, mcp, backends, storage, contexts, sessions });
  broker.start();

  console.error(`[relay] pairing token (paste into the extension): ${config.pairingToken}`);
  console.error(`[relay] paired as: ${config.profile.name} (set ~/.relay/profile.json or RELAY_USER to change)`);
  console.error(`[relay] backends online: ${(await backends.onlineIds()).join(", ") || "(none)"}`);
}

main().catch((err) => {
  console.error("[relay] fatal:", err);
  process.exit(1);
});
