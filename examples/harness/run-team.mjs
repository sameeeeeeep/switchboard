#!/usr/bin/env node
/**
 * run-team — the Team Mode proof, headless. Two REAL daemons on one machine, isolated the way
 * two teammates' machines are (separate RELAY_DIRs, separate ports): Alice hosts a team around
 * a folder, Bob joins with the invite code, and the harness asserts the whole grammar —
 * initial sync both ways, live edits, concurrent-write convergence (LWW), tombstone deletes,
 * presence, and that the mode is OFF by default with the daemon behaving exactly as before.
 *
 *   node examples/harness/run-team.mjs        (after building @relay/protocol + @relay/sidekick)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

const DAEMON = new URL("../../packages/sidekick/dist/index.js", import.meta.url).pathname;
const hr = () => console.log("─".repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn() is truthy (returns its value) or time runs out. */
async function waitFor(what, fn, ms = 15_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`);
    await sleep(250);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const children = [];
process.on("exit", () => children.forEach((c) => { try { c.kill("SIGKILL"); } catch { /* gone */ } }));

/** Boot one isolated daemon; returns {dir, ext} once paired. `team` sets RELAY_TEAM=1. */
async function boot(name, { port, team, user }) {
  const dir = mkdtempSync(join(tmpdir(), `relay-team-${name}-`));
  // No MCP servers at all: RELAY_IMPORT_CLAUDE=0 stops the ~/.claude.json auto-import (slow, and
  // it couples the test to this machine's setup); the empty mcp.json keeps relay's own list empty.
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: {} }));
  const child = spawn(process.execPath, [DAEMON], {
    // RELAY_TEAMS_DIR keeps the default join folder inside the sandbox — never the real ~/.
    env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(port), RELAY_USER: user, RELAY_IMPORT_CLAUDE: "0", RELAY_TEAMS_DIR: join(dir, "Switchboard Teams"), ...(team ? { RELAY_TEAM: "1" } : {}) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const token = await waitFor(`${name} pairing token`, () => (existsSync(join(dir, "pairing-token")) ? readFileSync(join(dir, "pairing-token"), "utf8").trim() : null), 10_000);
  // The token file lands before the WS listens (MCP boot sits between them) — retry the dial.
  // The consent policy must be KIND-aware: the daemon pushes prompts to the FIRST connected
  // extension socket, so this handler may field a connect consent on another principal's
  // behalf — and a connect consent must echo a scope object, never a bare `true`.
  const onConsent = (kind, body) =>
    kind === "consent:connect"
      ? { models: (body.models?.available ?? []).slice(0, 1), tools: (body.tools ?? []).map((t) => ({ name: t.name, access: t.access })), budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 } }
      : true;
  const ext = await waitFor(`${name} daemon listening`, () =>
    connectAsExtension({ port, token, origin: "control", onConsent }).catch(() => null), 20_000);
  return { dir, ext, child };
}

async function main() {
  hr();
  console.log("TEAM MODE HARNESS — two daemons, one shared folder");
  hr();

  // Alice boots WITHOUT the env flag: proves off-by-default + the panel's enable path.
  // Ports 8797/8798 — every harness claims its own (run-apps 8793, run-adgen 8794, run-imagegen 8795).
  const alice = await boot("alice", { port: 8797, team: false, user: "Alice" });
  const bob = await boot("bob", { port: 8798, team: true, user: "Bob" });

  console.log("\n[1] off by default");
  let st = await alice.ext.control("team.status");
  assert(st?.ok === true && st.status.enabled === false, "team.status answers, enabled=false with no flag");
  const refused = await alice.ext.control("team.host", { folder: join(alice.dir, "nope") });
  assert(refused?.ok === false && /off/i.test(refused.error || ""), "team.host refused while the mode is off");
  const caps = await alice.ext.request("claude_capabilities");
  assert(Array.isArray(caps.methods) && !caps.methods.includes("claude_team"), "capabilities unchanged (no claude_team method)");

  console.log("\n[2] enable + host");
  st = await alice.ext.control("team.setEnabled", { on: true });
  assert(st?.ok === true && st.status.enabled === true, "panel toggle enables the mode");
  const vaultA = join(alice.dir, "vaultA");
  mkdirSync(vaultA, { recursive: true });
  writeFileSync(join(vaultA, "notes.md"), "# seeded before hosting\n");
  const hosted = await alice.ext.control("team.host", { folder: vaultA, teamName: "Harness team", port: 8890 });
  assert(hosted?.ok === true && typeof hosted.invite === "string" && hosted.invite.startsWith("swb1."), "hosting returns an swb1. invite code");
  assert(hosted.status.role === "host" && hosted.status.members.length === 1, "host status: role=host, just you");

  console.log("\n[3] join + initial sync (both directions)");
  const vaultB = join(bob.dir, "vaultB");
  mkdirSync(vaultB, { recursive: true });
  writeFileSync(join(vaultB, "tasks.md"), "- [ ] brought by Bob\n");
  // Same-named file on BOTH sides before the join: it must get a real LWW contest (one side
  // wins deterministically on both machines), never a silent host-overwrites-joiner.
  writeFileSync(join(vaultA, "shared.md"), "Alice had this first\n");
  writeFileSync(join(vaultB, "shared.md"), "Bob had this first\n");
  const joined = await bob.ext.control("team.join", { code: hosted.invite, folder: vaultB });
  assert(joined?.ok === true && joined.status.role === "member" && joined.status.connected === true, "join succeeds with the invite code");
  await waitFor("host's seed file lands on Bob", () => existsSync(join(vaultB, "notes.md")));
  assert(readFileSync(join(vaultB, "notes.md"), "utf8") === "# seeded before hosting\n", "host→member: seeded notes.md synced byte-for-byte");
  await waitFor("Bob's file lands on Alice", () => existsSync(join(vaultA, "tasks.md")));
  assert(readFileSync(join(vaultA, "tasks.md"), "utf8") === "- [ ] brought by Bob\n", "member→host: tasks.md synced byte-for-byte");
  await waitFor("pre-existing shared.md converges", () => readFileSync(join(vaultA, "shared.md"), "utf8") === readFileSync(join(vaultB, "shared.md"), "utf8"));
  const sharedNow = readFileSync(join(vaultA, "shared.md"), "utf8");
  assert(sharedNow === "Alice had this first\n" || sharedNow === "Bob had this first\n", "join-time same-name files get a deterministic LWW contest");

  console.log("\n[4] live edit");
  writeFileSync(join(vaultA, "notes.md"), "# edited live by Alice\n");
  await waitFor("Alice's edit reaches Bob", () => readFileSync(join(vaultB, "notes.md"), "utf8") === "# edited live by Alice\n");
  assert(true, "a later write propagates and replaces the old content");

  console.log("\n[5] concurrent writes converge (LWW, deterministic)");
  writeFileSync(join(vaultA, "clash.md"), "Alice's version\n");
  writeFileSync(join(vaultB, "clash.md"), "Bob's version\n");
  await waitFor("clash.md exists on both", () => existsSync(join(vaultA, "clash.md")) && existsSync(join(vaultB, "clash.md")));
  await waitFor("clash.md converges", () => {
    const a = readFileSync(join(vaultA, "clash.md"), "utf8");
    const b = readFileSync(join(vaultB, "clash.md"), "utf8");
    return a === b;
  }, 20_000);
  const converged = readFileSync(join(vaultA, "clash.md"), "utf8");
  assert(converged === "Alice's version\n" || converged === "Bob's version\n", `both sides converge on one writer (${JSON.stringify(converged.trim())})`);

  console.log("\n[6] deletes propagate (tombstones)");
  rmSync(join(vaultA, "notes.md"));
  await waitFor("delete reaches Bob", () => !existsSync(join(vaultB, "notes.md")));
  assert(true, "a delete on the host removes the file on the member");

  console.log("\n[7] presence");
  st = await waitFor("2 members visible to Alice", async () => {
    const s = await alice.ext.control("team.status");
    return s?.status?.members?.length === 2 ? s : null;
  });
  const bobSeen = st.status.members.find((m) => !m.you);
  assert(bobSeen?.name === "Bob" && bobSeen.online === true, "host sees Bob online by name");
  st = await waitFor("2 members visible to Bob", async () => {
    const s = await bob.ext.control("team.status");
    return s?.status?.members?.length === 2 ? s : null;
  });
  assert(st.status.members.some((m) => m.name === "Alice"), "member sees Alice via host presence");

  console.log("\n[8] leave");
  st = await bob.ext.control("team.leave");
  assert(st?.ok === true && st.status.role === "off", "leave returns to role=off");
  await waitFor("Alice sees Bob gone", async () => {
    const s = await alice.ext.control("team.status");
    return s?.status?.members?.length === 1 ? s : null;
  });
  assert(true, "host presence drops the departed member");

  console.log("\n[9] rejoin with a FRESH empty folder must not wipe the team");
  const vaultB2 = join(bob.dir, "vaultB2");
  const rejoined = await bob.ext.control("team.join", { code: hosted.invite, folder: vaultB2 });
  assert(rejoined?.ok === true, "rejoin with a fresh folder succeeds");
  await waitFor("team files land in the fresh folder", () => existsSync(join(vaultB2, "clash.md")));
  await sleep(4000); // give any (buggy) stale tombstones time to do damage
  assert(existsSync(join(vaultA, "clash.md")), "host's files survive the rejoin (no stale-index wipe)");
  assert(existsSync(join(vaultA, "tasks.md")) && existsSync(join(vaultB2, "tasks.md")), "the whole vault is intact on both sides");

  console.log("\n[10] sync nudges are ORIGIN-SCOPED to apps bound to the team folder");
  // A wrapp-like principal on Alice's daemon: granted, storage bound to the team folder.
  const events = [];
  const tokA = readFileSync(join(alice.dir, "pairing-token"), "utf8").trim();
  const app = await connectAsExtension({
    port: 8797, token: tokA, origin: "https://tasks.example",
    onConsent: (kind, body) =>
      kind === "consent:connect"
        ? { models: (body.models?.available ?? []).slice(0, 1), tools: [], budgets: { maxTokensPerDay: 200_000, maxCallsPerMin: 30 } }
        : true, // storage-bind consent
    onEvent: (m) => events.push(m),
  });
  await app.request("claude_connect", { reason: "team routing test" });
  await app.request("claude_storage", { op: "bind", path: vaultA });
  writeFileSync(join(vaultB2, "nudge-test.md"), "does the right app hear about me?\n");
  const scoped = await waitFor("an origin-scoped storage-changed nudge", async () =>
    events.find((e) => e.event === "permissionsChanged" && e.payload?.reason === "storage-changed" && e.origin === "https://tasks.example") ?? null);
  assert(!!scoped, "the sync nudge carries the bound app's origin (extension routes it only there)");
  assert(!events.some((e) => e.payload?.reason === "storage-changed" && !e.origin), "no unscoped storage-changed fan-out once a bound app exists");
  app.close();

  console.log("\n[11] joining without a folder lands in a visible, team-named spot");
  await bob.ext.control("team.leave");
  st = await bob.ext.control("team.join", { code: hosted.invite }); // no folder given
  assert(st?.ok === true && /Switchboard Teams/.test(st.status.folder ?? "") && /Harness team/.test(st.status.folder ?? ""),
    `default join folder is ~/Switchboard Teams/<team name> (got ${st?.status?.folder})`);

  hr();
  console.log("TEAM MODE: all green");
  hr();
  alice.ext.close(); bob.ext.close();
  children.forEach((c) => c.kill("SIGKILL"));
  process.exit(0);
}

main().catch((err) => {
  console.error("harness error:", err);
  children.forEach((c) => c.kill("SIGKILL"));
  process.exit(1);
});
