#!/usr/bin/env node
/**
 * run-store — proves the PRO-GATED, cost-bounded persistence layer of the relay at the protocol
 * level (raw ws clients, no daemon needed). This is the answer to "won't open cloud storage be
 * costly?": persistence is UNLOCKED only by a valid entitlement, is byte-capped per team, and
 * compacts via snapshots — so it can never be an open money pit. Asserts:
 *   • forwarding is free but STORAGE is gated — an unentitled client's put is denied, fetch empty;
 *   • an entitled client persists sealed blobs and can fetch them back;
 *   • a FRESH entitled client (new device / offline rejoin) replays the same log → catch-up/restore;
 *   • the entitlement is TEAM-SCOPED — a token for team A can't unlock team B (no cross-team leak);
 *   • the byte cap rejects oversize puts (bounded cost);
 *   • snapshot compaction collapses the log to one entry (bounded storage).
 *
 *   node examples/harness/run-store.mjs
 */
process.env.RELAY_STORE_SECRET = process.env.RELAY_STORE_SECRET || "test-store-secret";
process.env.RELAY_STORE_MAX_BYTES = process.env.RELAY_STORE_MAX_BYTES || String(4096);
const SECRET = process.env.RELAY_STORE_SECRET;
const MAX = Number(process.env.RELAY_STORE_MAX_BYTES);

const { startLocalRelay, mintEntitlement } = await import("./local-relay.mjs");
const { WebSocket } = await import("ws");

const hr = () => console.log("─".repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error("assert failed: " + m); console.log("  ✓ " + m); }

/** A raw relay client: opens ?role=member&ent=…, sends store frames, collects replies. */
function client(url, teamId, ent) {
  return new Promise((resolve) => {
    const q = ent ? `?role=member&ent=${encodeURIComponent(ent)}` : "?role=member";
    const ws = new WebSocket(`${url}/room/${teamId}${q}`);
    const replies = [];
    ws.on("message", (d) => { try { replies.push(JSON.parse(d.toString())); } catch {} });
    ws.on("open", () => resolve({
      ws, replies,
      send: (o) => ws.send(JSON.stringify(o)),
      close: () => ws.close(),
      last: () => replies[replies.length - 1],
      waitReplies: async (n, ms = 2000) => { const t0 = Date.now(); while (replies.length < n && Date.now() - t0 < ms) await sleep(20); return replies; },
    }));
    ws.on("error", () => {});
  });
}

async function main() {
  hr(); console.log("RELAY PERSISTENCE — pro-gated, byte-capped, zero-knowledge"); hr();
  const relay = startLocalRelay(8941);
  const TEAM_A = "teamAAAAAA", TEAM_B = "teamBBBBBB";
  const entA = mintEntitlement(TEAM_A, SECRET);

  console.log("\n[1] storage is gated — no entitlement, no disk");
  const u = await client(relay.url, TEAM_A, null);
  u.send({ put: Buffer.from("x".repeat(50)).toString("base64") });
  u.send({ fetch: 0 });
  await u.waitReplies(2);
  assert(u.replies.some((r) => r.denied === "put" && r.reason === "no-entitlement"), "unentitled put is DENIED (never touches our disk)");
  assert(u.replies.some((r) => Array.isArray(r.log) && r.log.length === 0), "unentitled fetch returns an empty log");
  u.close();

  console.log("\n[2] an entitled client persists sealed blobs");
  const a = await client(relay.url, TEAM_A, entA);
  const blobs = ["sealed-op-1", "sealed-op-2", "sealed-op-3"].map((s) => Buffer.from(s).toString("base64"));
  for (const b of blobs) a.send({ put: b });
  await a.waitReplies(3);
  const stored = a.replies.filter((r) => typeof r.stored === "number").map((r) => r.stored);
  assert(stored.length === 3 && stored[2] === 3, "3 sealed ops stored with monotonic seq");
  a.close();

  console.log("\n[3] a FRESH entitled client replays the log (rejoin / new device / restore)");
  const b = await client(relay.url, TEAM_A, entA);
  b.send({ fetch: 0 });
  await b.waitReplies(1);
  const log = b.replies.find((r) => Array.isArray(r.log))?.log ?? [];
  assert(log.length === 3, `fresh client fetched all 3 persisted ops (${log.length})`);
  assert(Buffer.from(log[0].blob, "base64").toString() === "sealed-op-1", "the ciphertext round-trips byte-for-byte");
  b.close();

  console.log("\n[4] the entitlement is team-scoped — no cross-team unlock");
  const x = await client(relay.url, TEAM_B, entA); // team A's token on team B's room
  x.send({ put: Buffer.from("intruder").toString("base64") });
  x.send({ fetch: 0 });
  await x.waitReplies(2);
  assert(x.replies.some((r) => r.denied === "put"), "a team-A token cannot persist into team B");
  x.close();

  console.log("\n[5] byte cap bounds cost");
  const c = await client(relay.url, TEAM_A, entA);
  c.send({ put: Buffer.from("y".repeat(MAX + 100)).toString("base64") });
  await c.waitReplies(1);
  assert(c.replies.some((r) => r.full === true), "an oversize put is rejected (cost stays bounded)");
  c.close();

  console.log("\n[6] snapshot compaction collapses the log");
  const s = await client(relay.url, TEAM_A, entA);
  s.send({ snapshot: Buffer.from("full-sealed-snapshot").toString("base64") });
  await s.waitReplies(1);
  assert(s.replies.some((r) => r.compacted === true), "snapshot compaction acked");
  s.send({ fetch: 0 });
  await s.waitReplies(2);
  const after = s.replies.find((r) => Array.isArray(r.log))?.log ?? [];
  assert(after.length === 1, "after compaction the whole log is a single snapshot entry (bounded storage)");
  s.close();

  hr(); console.log("RELAY PERSISTENCE: all green"); hr();
  relay.close();
  process.exit(0);
}

main().catch((err) => { console.error("harness error:", err); process.exit(1); });
