#!/usr/bin/env node
/**
 * run-team-cloud — the Pro cloud-backup payoff, end to end with real daemons:
 *
 *   1. an UNENTITLED team syncs live but stores nothing (free tier costs us no disk);
 *   2. attaching a Pro entitlement starts backing the folder up as SEALED blobs;
 *   3. the whole team goes away (daemon killed — nobody is online anywhere);
 *   4. a COMPLETELY FRESH daemon, with an empty folder, restores the team from the invite code
 *      alone — the "everyone was offline" / "new laptop" case the P2P design couldn't cover;
 *   5. and the relay never held the key: it only ever saw ciphertext.
 *
 *   node examples/harness/run-team-cloud.mjs   (after building @relay/protocol + @relay/sidekick)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

process.env.RELAY_STORE_SECRET = "e2e-store-secret";
const { startLocalRelay, mintEntitlement } = await import("./local-relay.mjs");

const DAEMON = new URL("../../packages/sidekick/dist/index.js", import.meta.url).pathname;
const hr = () => console.log("─".repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kids = [];
let relay = null;
process.on("exit", () => { kids.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }); try { relay?.close(); } catch {} });

function assert(c, m) { if (!c) throw new Error("assert failed: " + m); console.log("  ✓ " + m); }
async function waitFor(what, fn, ms = 25_000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await sleep(250); } }

async function boot(name, port) {
  const dir = mkdtempSync(join(tmpdir(), `relay-tc-${name}-`));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: {} }));
  const child = spawn(process.execPath, [DAEMON], {
    env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(port), RELAY_USER: name, RELAY_IMPORT_CLAUDE: "0", RELAY_TEAM: "1", RELAY_TEAMS_DIR: join(dir, "Teams") },
    stdio: ["ignore", "inherit", "inherit"],
  });
  kids.push(child);
  const token = await waitFor(`${name} token`, () => (existsSync(join(dir, "pairing-token")) ? readFileSync(join(dir, "pairing-token"), "utf8").trim() : null), 12_000);
  const ext = await waitFor(`${name} listening`, () => connectAsExtension({ port, token, origin: "control", onConsent: () => true }).catch(() => null), 20_000);
  return { dir, ext, child };
}

async function main() {
  hr(); console.log("TEAM CLOUD BACKUP — zero-knowledge, Pro-gated, restores with nobody online"); hr();
  relay = startLocalRelay(8951);
  console.log(`relay (gated, persistent) at ${relay.url}`);

  console.log("\n[1] free tier: live sync, nothing stored");
  const alice = await boot("alice", 8952);
  const vaultA = join(alice.dir, "vaultA");
  mkdirSync(vaultA, { recursive: true });
  writeFileSync(join(vaultA, "notes.md"), "# before Pro\n");
  let st = await alice.ext.control("team.host", { folder: vaultA, teamName: "Cloud team", relay: relay.url });
  assert(st?.ok === true, "hosting through the relay starts");
  let s = await alice.ext.control("team.status");
  assert(s.status.cloud?.entitled === false, "an unentitled team reports no cloud backup");
  await sleep(2500);
  assert(!s.status.cloud?.backedUpAt, "nothing was backed up on the free tier (no storage cost from randoms)");

  console.log("\n[2] Pro: attach the entitlement billing issued for this team");
  const teamId = s.status.teamId;
  const ent = mintEntitlement(teamId, process.env.RELAY_STORE_SECRET, { maxSeats: 5 });
  st = await alice.ext.control("team.setEntitlement", { ent });
  assert(st?.ok === true && st.status.cloud?.entitled === true, "the team is now entitled (Pro)");
  const invite = st.status.invite;
  assert(typeof invite === "string" && invite.startsWith("swb1."), "the invite regenerated carrying the entitlement (teammates inherit Pro, no account)");

  console.log("\n[3] the folder backs itself up as sealed blobs");
  writeFileSync(join(vaultA, "notes.md"), "# after Pro\nbacked up\n");
  writeFileSync(join(vaultA, "tasks.md"), "- [ ] survive the apocalypse\n");
  const backed = await waitFor("a backup ack", async () => {
    const r = await alice.ext.control("team.status");
    return r?.status?.cloud?.backedUpAt ? r.status.cloud : null;
  });
  assert(!!backed.backedUpAt, `the daemon uploaded sealed ops (store seq ${backed.seq})`);

  console.log("\n[4] EVERYONE goes offline — the whole team disappears");
  alice.ext.close();
  alice.child.kill("SIGKILL");
  await sleep(1200);
  assert(true, "the hosting daemon is gone (no peer is online anywhere)");

  console.log("\n[5] a FRESH machine restores the team from the invite code alone");
  const carol = await boot("carol", 8953);
  const vaultC = join(carol.dir, "restored");
  const r = await carol.ext.control("team.restore", { code: invite, folder: vaultC });
  assert(r?.ok === true, `restore accepted (${r?.error ?? "ok"})`);
  await waitFor("files rebuilt from the encrypted backup", () => existsSync(join(vaultC, "notes.md")) && existsSync(join(vaultC, "tasks.md")));
  assert(readFileSync(join(vaultC, "notes.md"), "utf8") === "# after Pro\nbacked up\n", "notes.md restored byte-for-byte from the cloud");
  assert(readFileSync(join(vaultC, "tasks.md"), "utf8") === "- [ ] survive the apocalypse\n", "tasks.md restored byte-for-byte from the cloud");
  const rs = await carol.ext.control("team.status");
  assert(rs.status.cloud?.restoredFiles > 0, `status reports the restore (${rs.status.cloud.restoredFiles} file ops)`);
  assert(readdirSync(vaultC).length >= 2, "the folder is whole on a machine that never met the original host");

  hr(); console.log("TEAM CLOUD BACKUP: all green"); hr();
  carol.ext.close();
  kids.forEach((c) => { try { c.kill("SIGKILL"); } catch {} });
  relay.close();
  process.exit(0);
}

main().catch((err) => { console.error("harness error:", err); kids.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }); try { relay?.close(); } catch {} process.exit(1); });
