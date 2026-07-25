#!/usr/bin/env node
/**
 * run-store — proves the hosted-relay GATE at the protocol level (raw ws clients, no daemon). This
 * is the "won't our cloud be costly?" answer, enforced in code:
 *   • FREE TRIAL: an unentitled connection gets live sync for TRIAL_MS then closes with an
 *     upgrade-prompt reason (unlimited restarts) — and never touches our disk;
 *   • PRO: a valid, TEAM-SCOPED entitlement unlocks a full session + persistence + its seat count;
 *   • SEATS are enforced by counting live connections (never by reading sealed content, so members
 *     still need no account) — over the plan's cap the join is refused with a clear reason;
 *   • persisted sealed blobs replay to a FRESH client (offline rejoin / new device / restore);
 *   • byte cap + snapshot compaction bound our storage cost;
 *   • a self-hoster (no secret / RELAY_STORE_OPEN=1) gets everything, ungated, on their own infra.
 *
 *   node examples/harness/run-store.mjs
 */
process.env.RELAY_STORE_SECRET = process.env.RELAY_STORE_SECRET || "test-store-secret";
process.env.RELAY_STORE_MAX_BYTES = process.env.RELAY_STORE_MAX_BYTES || String(4096);
process.env.RELAY_TRIAL_MS = process.env.RELAY_TRIAL_MS || String(1200); // 10 min in prod; short here
const SECRET = process.env.RELAY_STORE_SECRET;
const MAX = Number(process.env.RELAY_STORE_MAX_BYTES);
const TRIAL = Number(process.env.RELAY_TRIAL_MS);

const { startLocalRelay, mintEntitlement, CLOSE_TRIAL_OVER, CLOSE_SEAT_LIMIT } = await import("./local-relay.mjs");
const { WebSocket } = await import("ws");

const hr = () => console.log("─".repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error("assert failed: " + m); console.log("  ✓ " + m); }

/** A raw relay client. Records replies and the close code/reason (the upgrade signal). */
function client(url, teamId, ent, role = "member") {
  return new Promise((resolve) => {
    const q = `?role=${role}` + (ent ? `&ent=${encodeURIComponent(ent)}` : "");
    const ws = new WebSocket(`${url}/room/${teamId}${q}`);
    const replies = [];
    const api = {
      ws, replies, closed: null,
      send: (o) => { try { ws.send(JSON.stringify(o)); } catch {} },
      close: () => { try { ws.close(); } catch {} },
      waitReplies: async (n, ms = 2000) => { const t0 = Date.now(); while (replies.length < n && Date.now() - t0 < ms) await sleep(20); return replies; },
      waitClosed: async (ms = 4000) => { const t0 = Date.now(); while (!api.closed && Date.now() - t0 < ms) await sleep(20); return api.closed; },
    };
    ws.on("message", (d) => { try { replies.push(JSON.parse(d.toString())); } catch {} });
    ws.on("close", (code, reason) => { api.closed = { code, reason: String(reason || "") }; resolve(api); });
    ws.on("open", () => resolve(api));
    ws.on("error", () => {});
  });
}

async function main() {
  hr(); console.log("HOSTED RELAY GATE — free trial · Pro seats · zero-knowledge storage"); hr();
  const relay = startLocalRelay(8941);
  const TEAM_A = "teamAAAAAA", TEAM_B = "teamBBBBBB", TEAM_C = "teamCCCCCC";
  const entA = mintEntitlement(TEAM_A, SECRET, { maxSeats: 5 });

  console.log("\n[1] free trial: live sync, but never our disk");
  const t = await client(relay.url, TEAM_C, null);
  t.send({ put: Buffer.from("x".repeat(50)).toString("base64") });
  t.send({ fetch: 0 });
  await t.waitReplies(2);
  assert(t.replies.some((r) => r.denied === "put" && r.reason === "no-entitlement"), "an unentitled put is DENIED (randoms never cost us storage)");
  assert(t.replies.some((r) => Array.isArray(r.log) && r.log.length === 0), "an unentitled fetch returns an empty log");

  console.log("\n[2] the trial session expires with an upgrade signal");
  const closed = await t.waitClosed(TRIAL + 2500);
  assert(closed?.code === CLOSE_TRIAL_OVER, `the trial socket closed with the upgrade code ${CLOSE_TRIAL_OVER} (got ${closed?.code})`);
  assert(/trial-over/.test(closed?.reason || ""), "the close reason tells the daemon to show an upgrade prompt");
  const again = await client(relay.url, TEAM_C, null);
  assert(!again.closed, "a NEW free session starts immediately (unlimited restarts — the wow stays shareable)");
  again.close();

  console.log("\n[3] Pro: an entitled client persists sealed blobs");
  const a = await client(relay.url, TEAM_A, entA);
  for (const s of ["sealed-op-1", "sealed-op-2", "sealed-op-3"]) a.send({ put: Buffer.from(s).toString("base64") });
  await a.waitReplies(3);
  const stored = a.replies.filter((r) => typeof r.stored === "number").map((r) => r.stored);
  assert(stored.length === 3 && stored[2] === 3, "3 sealed ops stored with monotonic seq");

  console.log("\n[4] a FRESH entitled client replays the log (rejoin / new device / restore)");
  const b = await client(relay.url, TEAM_A, entA);
  b.send({ fetch: 0 });
  await b.waitReplies(1);
  const log = b.replies.find((r) => Array.isArray(r.log))?.log ?? [];
  assert(log.length === 3, `the fresh client fetched all 3 persisted ops (${log.length})`);
  assert(Buffer.from(log[0].blob, "base64").toString() === "sealed-op-1", "the ciphertext round-trips byte-for-byte (we never opened it)");
  b.close(); a.close();
  await sleep(100);

  console.log("\n[5] seats are enforced by connection count — no accounts needed");
  const ent2 = mintEntitlement(TEAM_B, SECRET, { maxSeats: 2 });
  const s1 = await client(relay.url, TEAM_B, ent2, "host");
  const s2 = await client(relay.url, TEAM_B, ent2);
  assert(!s1.closed && !s2.closed, "a 2-seat plan admits 2 people");
  const s3 = await client(relay.url, TEAM_B, ent2);
  const over = s3.closed ?? (await s3.waitClosed(1500));
  assert(over?.code === CLOSE_SEAT_LIMIT, `the 3rd join is refused with the seat-limit code ${CLOSE_SEAT_LIMIT} (got ${over?.code})`);
  assert(/seat-limit:2/.test(over?.reason || ""), "the reason names the plan's seat count for a clear message");
  s1.close(); s2.close();
  await sleep(100);

  console.log("\n[6] the entitlement is team-scoped — no cross-team unlock");
  const x = await client(relay.url, TEAM_B, entA); // team A's token on team B's room
  x.send({ put: Buffer.from("intruder").toString("base64") });
  await x.waitReplies(1);
  assert(x.replies.some((r) => r.denied === "put"), "a team-A token cannot persist into team B");
  x.close();

  console.log("\n[7] cost bounds: byte cap + snapshot compaction");
  const c = await client(relay.url, TEAM_A, entA);
  c.send({ put: Buffer.from("y".repeat(MAX + 100)).toString("base64") });
  await c.waitReplies(1);
  assert(c.replies.some((r) => r.full === true), "an oversize put is rejected (bounded cost)");
  c.send({ snapshot: Buffer.from("full-sealed-snapshot").toString("base64") });
  await c.waitReplies(2);
  assert(c.replies.some((r) => r.compacted === true), "snapshot compaction acked");
  c.send({ fetch: 0 });
  await c.waitReplies(3);
  const after = c.replies.filter((r) => Array.isArray(r.log)).pop()?.log ?? [];
  assert(after.length === 1, "after compaction the log is ONE snapshot entry (storage ≈ folder, not history)");
  c.close();
  relay.close();

  console.log("\n[8] a self-hoster gets everything, ungated, on their own infra");
  // A relay with no store secret = someone running it themselves; the gate doesn't apply.
  delete process.env.RELAY_STORE_SECRET;
  const mod = await import("./local-relay.mjs?selfhost=1");
  const own = mod.startLocalRelay(8942);
  const f = await client(own.url, "myteam", null);
  f.send({ put: Buffer.from("mine").toString("base64") });
  await f.waitReplies(1);
  assert(f.replies.some((r) => typeof r.stored === "number"), "self-hosted: persistence works with no entitlement at all");
  await sleep(TRIAL + 400);
  assert(!f.closed, "self-hosted: the session is never trial-limited");
  f.close(); own.close();

  hr(); console.log("HOSTED RELAY GATE: all green"); hr();
  process.exit(0);
}

main().catch((err) => { console.error("harness error:", err); process.exit(1); });
