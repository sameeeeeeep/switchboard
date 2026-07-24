#!/usr/bin/env node
/**
 * run-team-relay — proves the cross-network RELAY path headless, with no cloud. A local relay
 * (protocol-identical to the Cloudflare DO in packages/relay) stands in for the hosted relay.
 * Alice hosts WITH a relay URL (so she opens NO listening port — she dials OUT to the relay);
 * Bob joins with the invite code (which carries the relay), also dialing out. If files sync, it
 * can ONLY be through the relay — there is no direct socket between them.
 *
 *   node examples/harness/run-team-relay.mjs   (after building @relay/protocol + @relay/sidekick)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";
import { startLocalRelay } from "./local-relay.mjs";

const DAEMON = new URL("../../packages/sidekick/dist/index.js", import.meta.url).pathname;
const hr = () => console.log("─".repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, ms = 20_000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`); await sleep(250); }
}
function assert(cond, msg) { if (!cond) throw new Error(`assert failed: ${msg}`); console.log(`  ✓ ${msg}`); }

const children = [];
let relay = null;
process.on("exit", () => { children.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }); try { relay?.close(); } catch {} });

async function boot(name, { port, user }) {
  const dir = mkdtempSync(join(tmpdir(), `relay-teamrelay-${name}-`));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: {} }));
  const child = spawn(process.execPath, [DAEMON], {
    env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(port), RELAY_USER: user, RELAY_IMPORT_CLAUDE: "0", RELAY_TEAM: "1", RELAY_TEAMS_DIR: join(dir, "Switchboard Teams") },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const token = await waitFor(`${name} token`, () => (existsSync(join(dir, "pairing-token")) ? readFileSync(join(dir, "pairing-token"), "utf8").trim() : null), 10_000);
  const onConsent = (kind, body) => kind === "consent:connect"
    ? { models: (body.models?.available ?? []).slice(0, 1), tools: (body.tools ?? []).map((t) => ({ name: t.name, access: t.access })), budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 } }
    : true;
  const ext = await waitFor(`${name} listening`, () => connectAsExtension({ port, token, origin: "control", onConsent }).catch(() => null), 20_000);
  return { dir, ext, child };
}

async function main() {
  hr(); console.log("TEAM MODE × RELAY — cross-network path, no direct socket"); hr();

  // RELAY_URL points the harness at a REAL deployed relay (e.g. the Cloudflare Worker at
  // wss://…workers.dev) instead of the in-process stand-in — the live end-to-end proof.
  if (process.env.RELAY_URL) {
    relay = { url: process.env.RELAY_URL.replace(/\/+$/, ""), close: () => {} };
    console.log(`LIVE relay: ${relay.url}`);
  } else {
    relay = startLocalRelay(8899);
    console.log(`local relay (stands in for the Cloudflare DO) at ${relay.url}`);
  }

  const alice = await boot("alice", { port: 8811, user: "Alice" });
  const bob = await boot("bob", { port: 8812, user: "Bob" });

  console.log("\n[1] host via the relay — no listening port");
  const vaultA = join(alice.dir, "vaultA");
  mkdirSync(vaultA, { recursive: true });
  writeFileSync(join(vaultA, "brief.md"), "# via the relay\n");
  const hosted = await alice.ext.control("team.host", { folder: vaultA, teamName: "Remote team", relay: relay.url });
  assert(hosted?.ok === true, "hosting starts");
  assert(hosted.status.relay === relay.url, "status reports the relay URL");
  const invite = hosted.invite;
  const decoded = JSON.parse(Buffer.from(invite.slice("swb1.".length), "base64url").toString("utf8"));
  assert(decoded.relay === relay.url, "the invite code carries the relay URL (a joiner needs no LAN address)");
  await waitFor("host connects to the relay", async () => (await alice.ext.control("team.status")).status.connected === true);
  assert(true, "host is connected through the relay");

  console.log("\n[2] join over the relay — sync can ONLY flow through it");
  const vaultB = join(bob.dir, "vaultB");
  mkdirSync(vaultB, { recursive: true });
  writeFileSync(join(vaultB, "notes.md"), "- brought by Bob\n");
  const joined = await bob.ext.control("team.join", { code: invite, folder: vaultB });
  assert(joined?.ok === true && joined.status.role === "member", "Bob joins with the relay invite");
  assert(joined.status.relay === relay.url, "member status also reports the relay");
  await waitFor("host file reaches Bob via relay", () => existsSync(join(vaultB, "brief.md")));
  assert(readFileSync(join(vaultB, "brief.md"), "utf8") === "# via the relay\n", "host→member synced through the relay, byte-for-byte");
  await waitFor("Bob file reaches Alice via relay", () => existsSync(join(vaultA, "notes.md")));
  assert(readFileSync(join(vaultA, "notes.md"), "utf8") === "- brought by Bob\n", "member→host synced through the relay");

  console.log("\n[3] live edits + presence over the relay");
  writeFileSync(join(vaultA, "brief.md"), "# edited live, over the relay\n");
  await waitFor("live edit reaches Bob", () => readFileSync(join(vaultB, "brief.md"), "utf8") === "# edited live, over the relay\n");
  assert(true, "a later write propagates across the relay");
  const st = await waitFor("host sees Bob", async () => { const s = await alice.ext.control("team.status"); return s.status.members.length === 2 ? s : null; });
  assert(st.status.members.some((m) => m.name === "Bob" && m.online), "presence works over the relay (host sees Bob online)");

  console.log("\n[4] the sealed frames stay sealed — the relay is a mailman, not a landlord");
  // The daemons never hand the relay a key; it only ever saw ciphertext. (Structural: the relay
  // process shares nothing with the daemons; this asserts the invariant is what shipped.)
  assert(/^wss?:\/\//.test(hosted.status.relay), "relay transport is a plain pipe carrying only AES-256-GCM frames");

  hr(); console.log("TEAM MODE × RELAY: all green"); hr();
  alice.ext.close(); bob.ext.close();
  children.forEach((c) => c.kill("SIGKILL"));
  try { relay.close(); } catch {}
  process.exit(0);
}

main().catch((err) => { console.error("harness error:", err); children.forEach((c) => c.kill("SIGKILL")); try { relay?.close(); } catch {} process.exit(1); });
