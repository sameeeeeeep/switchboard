#!/usr/bin/env node
/**
 * run-compat — the DAEMON↔RELAY COMPATIBILITY GUARD.
 *
 * Why this exists: the hosted relay requires a proof of team membership (`ra`, HKDF'd from the
 * invite secret) before it will hand out the host role or the sealed backup. That fix shipped to the
 * relay immediately — but a daemon that doesn't SEND the proof can no longer host a relay-backed
 * team. The two therefore have to ship together, and "they drifted apart" is exactly the kind of
 * break that is invisible until a user's team silently stops working.
 *
 * So this asserts BOTH halves of the contract at once:
 *   1. the gate is LIVE          — a raw socket with no/wrong proof is refused the host role;
 *   2. the shipped daemon SATISFIES it — the real daemon still hosts and syncs through that same
 *      gated relay, which is only possible if it sends a valid proof.
 * Assertion 2 alone could pass against an ungated relay; assertion 1 alone could pass with a daemon
 * that can't connect. Together they can only both pass when relay and daemon agree.
 *
 *   node examples/harness/run-compat.mjs   (after building @relay/protocol + @relay/sidekick)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

// A store secret makes the relay GATED — the posture our hosted relay actually runs in.
process.env.RELAY_STORE_SECRET = "compat-store-secret";
const { startLocalRelay } = await import("./local-relay.mjs");
const { WebSocket } = await import("ws");

const DAEMON = new URL("../../packages/sidekick/dist/index.js", import.meta.url).pathname;
const hr = () => console.log("─".repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kids = [];
let relay = null;
process.on("exit", () => { kids.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }); try { relay?.close(); } catch {} });
function assert(c, m) { if (!c) throw new Error("assert failed: " + m); console.log("  ✓ " + m); }
async function waitFor(what, fn, ms = 25_000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await sleep(250); } }

/**
 * Open a raw relay socket and report whether the relay REFUSED it. Refusal is a WebSocket close with
 * a 4xxx code (deliberately, so a client can read the reason) — the handshake itself completes first,
 * so "did it open" says nothing. What matters is: did a refusal close arrive within the window?
 */
function probe(url, teamId, query, waitMs = 2000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${url}/room/${teamId}${query}`);
    const out = { closed: null, survived: false };
    let settled = false;
    const done = () => { if (settled) return; settled = true; try { ws.close(); } catch {} resolve(out); };
    ws.on("close", (code, reason) => { out.closed = { code, reason: String(reason || "") }; done(); });
    ws.on("unexpected-response", (_req, res) => { out.closed = { code: res.statusCode, reason: "http" }; done(); });
    ws.on("error", () => { /* a close or unexpected-response settles it */ });
    // No refusal within the window ⇒ the relay let this socket live (the gate is NOT enforcing).
    setTimeout(() => { out.survived = !out.closed; done(); }, waitMs);
  });
}
/** A relay refusal: any 4xxx application close code. */
const refused = (p) => !!p.closed && p.closed.code >= 4000 && p.closed.code < 5000;

async function main() {
  hr(); console.log("DAEMON ↔ RELAY COMPAT — the gate is live AND the daemon satisfies it"); hr();
  relay = startLocalRelay(8971);

  console.log("\n[1] the gate is LIVE (this relay demands proof of membership)");
  const noProof = await probe(relay.url, "compatTeam1", "?role=host");
  assert(refused(noProof), `a host with NO proof at all is refused (${noProof.closed?.code} ${noProof.closed?.reason || ""})`);

  // The relay holds no team key, so it can't check a proof against a secret — it enforces the
  // property it CAN: everyone in a room proves the SAME membership. The first prover establishes
  // the room; a DIFFERENT proof is then refused. So the meaningful test is a mismatch on an
  // already-established room, which is what a hijacker would actually hit.
  const established = new WebSocket(`${relay.url}/room/compatTeam2?role=host&ra=the-real-teams-proof`);
  await new Promise((r) => { established.on("open", r); established.on("error", r); setTimeout(r, 2000); });
  const badProof = await probe(relay.url, "compatTeam2", "?role=host&ra=a-different-proof");
  assert(refused(badProof), `a host whose proof MISMATCHES the room is refused (${badProof.closed?.code} ${badProof.closed?.reason || ""})`);
  try { established.close(); } catch { /* done */ }

  console.log("\n[2] the SHIPPED daemon satisfies that same gate");
  const dir = mkdtempSync(join(tmpdir(), "relay-compat-"));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: {} }));
  const child = spawn(process.execPath, [DAEMON], {
    env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: "8972", RELAY_USER: "Compat", RELAY_IMPORT_CLAUDE: "0", RELAY_TEAM: "1", RELAY_TEAMS_DIR: join(dir, "Teams") },
    stdio: ["ignore", "inherit", "inherit"],
  });
  kids.push(child);
  const token = await waitFor("token", () => (existsSync(join(dir, "pairing-token")) ? readFileSync(join(dir, "pairing-token"), "utf8").trim() : null), 12_000);
  const ext = await waitFor("listening", () => connectAsExtension({ port: 8972, token, origin: "control", onConsent: () => true }).catch(() => null), 20_000);

  const vault = join(dir, "vault");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "hello.md"), "# compat\n");
  const hosted = await ext.control("team.host", { folder: vault, teamName: "Compat team", relay: relay.url });
  assert(hosted?.ok === true, "the daemon accepted hosting a relay-backed team");
  // Connected THROUGH the gate is the proof: an unproven host is refused above, so reaching
  // connected:true means this daemon sent a valid membership proof.
  const st = await waitFor("the daemon to connect through the gated relay", async () => {
    const r = await ext.control("team.status");
    return r?.status?.connected === true ? r.status : null;
  }, 20_000);
  assert(st.connected === true, "the daemon CONNECTED through the gated relay — so it sent a valid proof");
  assert(!st.error, `no gate error reported (${st.error ?? "none"})`);

  console.log("\n[3] and a member can still join that team (the whole path works end to end)");
  const dir2 = mkdtempSync(join(tmpdir(), "relay-compat2-"));
  writeFileSync(join(dir2, "mcp.json"), JSON.stringify({ servers: {} }));
  const child2 = spawn(process.execPath, [DAEMON], {
    env: { ...process.env, RELAY_DIR: dir2, RELAY_PORT: "8973", RELAY_USER: "Joiner", RELAY_IMPORT_CLAUDE: "0", RELAY_TEAM: "1", RELAY_TEAMS_DIR: join(dir2, "Teams") },
    stdio: ["ignore", "inherit", "inherit"],
  });
  kids.push(child2);
  const token2 = await waitFor("token2", () => (existsSync(join(dir2, "pairing-token")) ? readFileSync(join(dir2, "pairing-token"), "utf8").trim() : null), 12_000);
  const ext2 = await waitFor("listening2", () => connectAsExtension({ port: 8973, token: token2, origin: "control", onConsent: () => true }).catch(() => null), 20_000);
  const vault2 = join(dir2, "joined");
  const joined = await ext2.control("team.join", { code: hosted.invite, folder: vault2 });
  assert(joined?.ok === true && joined.status.connected === true, "a second daemon joined through the gated relay");
  await waitFor("the host's file to reach the member", () => existsSync(join(vault2, "hello.md")));
  assert(readFileSync(join(vault2, "hello.md"), "utf8") === "# compat\n", "the folder synced through the gated relay, byte-for-byte");

  hr(); console.log("DAEMON ↔ RELAY COMPAT: all green — safe to ship this daemon with this relay"); hr();
  ext.close(); ext2.close();
  kids.forEach((c) => { try { c.kill("SIGKILL"); } catch {} });
  relay.close();
  process.exit(0);
}

main().catch((err) => { console.error("harness error:", err); kids.forEach((c) => { try { c.kill("SIGKILL"); } catch {} }); try { relay?.close(); } catch {} process.exit(1); });
