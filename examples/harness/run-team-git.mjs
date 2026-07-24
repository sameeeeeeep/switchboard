#!/usr/bin/env node
/**
 * run-team-git — the git backing proof, headless. A local BARE repo stands in for GitHub
 * (same protocol, zero network), so this asserts the real mechanics: the host's folder
 * debounce-commits and pushes with per-member attribution; an "away teammate" (a plain git
 * clone) pushes a change and it lands in the host's folder via the pull cycle — and then
 * flows onward to a LIVE P2P member; a member's own machine can opt in and push too.
 *
 *   node examples/harness/run-team-git.mjs    (after building @relay/protocol + @relay/sidekick)
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

const DAEMON = new URL("../../packages/sidekick/dist/index.js", import.meta.url).pathname;
const hr = () => console.log("─".repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cwd, args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).toString().trim();

async function waitFor(what, fn, ms = 30_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`);
    await sleep(400);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const children = [];
process.on("exit", () => children.forEach((c) => { try { c.kill("SIGKILL"); } catch { /* gone */ } }));

async function boot(name, { port, user }) {
  const dir = mkdtempSync(join(tmpdir(), `relay-teamgit-${name}-`));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: {} }));
  const child = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env, RELAY_DIR: dir, RELAY_PORT: String(port), RELAY_USER: user,
      RELAY_IMPORT_CLAUDE: "0", RELAY_TEAM: "1",
      RELAY_TEAM_GIT_MS: "2000", RELAY_TEAM_GIT_QUIET_MS: "500", // harness pace
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  const token = await waitFor(`${name} pairing token`, () => (existsSync(join(dir, "pairing-token")) ? readFileSync(join(dir, "pairing-token"), "utf8").trim() : null), 10_000);
  const ext = await waitFor(`${name} daemon listening`, () =>
    connectAsExtension({ port, token, origin: "control", onConsent: () => true }).catch(() => null), 20_000);
  return { dir, ext, child };
}

async function main() {
  hr();
  console.log("TEAM MODE × GIT HARNESS — the folder when live, the repo when apart");
  hr();

  const scratch = mkdtempSync(join(tmpdir(), "relay-teamgit-hub-"));
  const hub = join(scratch, "hub.git");
  mkdirSync(hub);
  execFileSync("git", ["init", "--bare", "-b", "main", hub], { stdio: "ignore" });

  const alice = await boot("alice", { port: 8801, user: "Alice" });
  const bob = await boot("bob", { port: 8802, user: "Bob" });

  console.log("\n[1] host + set the team repo");
  const vaultA = join(alice.dir, "vaultA");
  mkdirSync(vaultA, { recursive: true });
  writeFileSync(join(vaultA, "notes.md"), "# from Alice\n");
  const hosted = await alice.ext.control("team.host", { folder: vaultA, teamName: "Git team", port: 8892 });
  assert(hosted?.ok === true, "hosting starts");
  let st = await alice.ext.control("team.status");
  assert(st?.status?.git === undefined, "no git backing until the host sets one");
  st = await alice.ext.control("team.setGit", { remote: hub });
  assert(st?.ok === true && st.status.git?.enabled === true, "host sets the repo (setting = host's opt-in)");

  console.log("\n[2] the folder reaches the repo, attributed");
  await waitFor("alice's push lands in the hub", () => {
    try { return sh(hub, ["ls-tree", "--name-only", "main"]).includes("notes.md"); } catch { return false; }
  });
  const clone1 = join(scratch, "clone1");
  execFileSync("git", ["clone", "-q", hub, clone1], { stdio: "ignore" });
  assert(readFileSync(join(clone1, "notes.md"), "utf8") === "# from Alice\n", "repo holds the folder's content byte-for-byte");
  assert(sh(clone1, ["log", "--format=%an", "-1"]).includes("Alice"), "commits are attributed to the member");

  console.log("\n[3] an away teammate pushes; the host pulls it in");
  writeFileSync(join(clone1, "from-away.md"), "pushed while offline from the team\n");
  sh(clone1, ["add", "-A"]);
  sh(clone1, ["-c", "user.name=Away Ana", "-c", "user.email=ana@example.com", "commit", "-m", "away change"]);
  sh(clone1, ["push", "-q", "origin", "main"]);
  await waitFor("away change lands in Alice's folder", () => existsSync(join(vaultA, "from-away.md")));
  assert(readFileSync(join(vaultA, "from-away.md"), "utf8") === "pushed while offline from the team\n", "repo→folder: the pull cycle materializes an away teammate's push");

  console.log("\n[4] repo change flows onward to a LIVE P2P member");
  const vaultB = join(bob.dir, "vaultB");
  const joined = await bob.ext.control("team.join", { code: hosted.invite, folder: vaultB });
  assert(joined?.ok === true, "Bob joins over the live channel");
  assert(joined.status.git?.remote === hub && joined.status.git?.enabled === false, "Bob learns the team repo but is NOT auto-opted-in");
  await waitFor("away change reaches Bob via P2P", () => existsSync(join(vaultB, "from-away.md")));
  assert(true, "repo → host → live member: the two layers compose through the folder");

  console.log("\n[5] a member opts in and pushes with its own auth");
  st = await bob.ext.control("team.setGitEnabled", { on: true });
  assert(st?.ok === true && st.status.git?.enabled === true, "member opt-in enables the cycle on Bob's machine");
  writeFileSync(join(vaultB, "from-bob.md"), "Bob's contribution\n");
  await waitFor("Bob's file reaches the hub", () => {
    try { return sh(hub, ["ls-tree", "--name-only", "main"]).includes("from-bob.md"); } catch { return false; }
  });
  assert(true, "member→repo: Bob's machine pushes the shared folder");
  await waitFor("Bob's file also reaches Alice", () => existsSync(join(vaultA, "from-bob.md")));
  assert(true, "…and Alice has it too (live channel or pull — either path is correct)");

  console.log("\n[6] clearing the repo stops the backing everywhere");
  st = await alice.ext.control("team.setGit", {});
  assert(st?.ok === true && st.status.git === undefined, "host clears the repo");
  st = await waitFor("Bob learns the repo is gone", async () => {
    const s = await bob.ext.control("team.status");
    return s?.status && s.status.git === undefined ? s : null;
  });
  assert(true, "member's backing is switched off by the host's clear");

  hr();
  console.log("TEAM MODE × GIT: all green");
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
