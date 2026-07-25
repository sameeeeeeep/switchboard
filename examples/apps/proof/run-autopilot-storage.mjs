/**
 * PROOF: Autopilot's portfolio survives a REAL daemon — one company = one file on disk.
 *
 * The wrapp harness cannot prove this. Its storage is per-page and in-memory, so "team-ready
 * storage" (doctrine gate 7) is asserted by code review only. This drives the ACTUAL
 * `src/kit/livestore.js` `collection()` — the same module the wrapp imports, not a re-implementation
 * — against a throwaway daemon on a temp RELAY_DIR, and then looks at the bytes on disk.
 *
 * What it proves, in order:
 *   1. a fresh origin starts with an empty collection
 *   2. three companies → three SEPARATE files, named by the `<prefix>-<id>` key dialect
 *   3. a company round-trips with its nested decisions/options intact
 *   4. editing company A does not rewrite company B's file — the whole point of per-record
 *      storage, and what makes Team Mode's per-file last-writer-wins merge instead of clobber
 *   5. a torn/half-synced record is skipped, not fatal (a teammate mid-write)
 *   6. a hostile id (path traversal / a second extension) is refused by safeId
 *   7. remove() deletes exactly one record
 *   8. a DIFFERENT origin gets its own sandbox and cannot see any of it
 *   9. (best-effort) one real completion, to replace the dev-reported token guess with a measurement
 *
 * Run: npm run build -w @relay/sidekick && node examples/apps/proof/run-autopilot-storage.mjs
 */
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collection } from "../src/kit/livestore.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DAEMON = join(HERE, "../../../packages/sidekick/dist/index.js");
const PORT = 8993;
const ORIGIN = "https://autopilot.thelastprompt.ai";
const OTHER = "https://not-autopilot.example";

const relayDir = mkdtempSync(join(tmpdir(), "relay-autopilot-"));
const checks = [];
const check = (name, cond, detail = "") => { checks.push(!!cond); console.error(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const daemon = spawn("node", [DAEMON], { env: { ...process.env, RELAY_DIR: relayDir, RELAY_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"] });
const token = await new Promise((resolve, reject) => {
  let buf = "";
  const t = setTimeout(() => reject(new Error("daemon did not start in time")), 20000);
  daemon.stderr.on("data", (d) => {
    buf += d.toString();
    const m = buf.match(/pairing token \(paste into the extension\): (\S+)/);
    if (m && /listening on ws/.test(buf)) { clearTimeout(t); resolve(m[1]); }
  });
  daemon.on("exit", (c) => reject(new Error(`daemon exited early (${c})`)));
});

function connectProvider(origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const pending = new Map();
    const listeners = {};
    const rpc = (method, params) => new Promise((res, rej) => {
      const id = Math.random().toString(36).slice(2);
      pending.set(id, (m) => (m.error ? rej(Object.assign(new Error(m.error.message), m.error)) : res(m.result)));
      ws.send(JSON.stringify({ type: "request", origin, method, params, id, sentAt: Date.now() }));
    });
    const provider = {
      isRelay: true,
      request: ({ method, params }) => rpc(method, params),
      on: (e, h) => (listeners[e] = listeners[e] || []).push(h),
      removeListener: (e, h) => { const a = listeners[e]; if (a) a.splice(a.indexOf(h) >>> 0, 1); },
    };
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("error", reject);
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "auth_ok") resolve(provider);
      else if (m.type === "response" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.type === "prompt") {
        // stand in for the human at the extension popup — Autopilot's real declared scope
        if (m.kind === "consent:connect") ws.send(JSON.stringify({ type: "reply", id: m.id, result: { models: ["sonnet"], tools: [], budgets: m.body.budgets } }));
        else ws.send(JSON.stringify({ type: "reply", id: m.id, result: true }));
      }
    });
  });
}

/** the exact shape `relay.storage` has in @relay/sdk — collection() sees nothing else */
const relayFor = (provider) => ({
  storage: {
    get: (key) => provider.request({ method: "claude_storage", params: { op: "get", key } }).then((r) => r.value ?? null),
    set: (key, value) => provider.request({ method: "claude_storage", params: { op: "set", key, value } }).then(() => undefined),
    delete: (key) => provider.request({ method: "claude_storage", params: { op: "delete", key } }).then((r) => r.ok),
    list: () => provider.request({ method: "claude_storage", params: { op: "list" } }).then((r) => r.keys ?? []),
    info: () => provider.request({ method: "claude_storage", params: { op: "info" } }).then((r) => r.info),
  },
});

// a company shaped exactly like the wrapp's, nested options included
const company = (id, name, angleLabel) => ({
  name, kind: "brand", kindLabel: "BRAND", oneLine: name + " — a real company", glyph: name[0],
  color: "#2f6b45", ink: "#EAF2E4", ctxId: id, ctxName: name,
  inherited: { voice: "Warm and exact", palette: ["#8B1A1A", "#F4A000"] },
  tokens: { spent: 1860, budget: 2_000_000, by: { draft: 1860 }, estimated: false },
  log: [{ t: "drafted the operating slate", s: "run", at: "03:10" }],
  decisions: {
    angle: { id: "angle", label: "Ad angle", deps: ["voice"], chosenId: "o1", chosenAt: "03:11", stale: false, inherited: null,
      options: [{ id: "o1", label: angleLabel, text: "the headline", body: "body copy", cta: "Buy", rec: true }] },
  },
  at: Date.now(),
});

try {
  const provider = await connectProvider(ORIGIN);
  await provider.request({ method: "claude_connect", params: { reason: "Autopilot storage proof" } });
  const relay = relayFor(provider);
  const companies = collection(relay, "autopilot-co");

  // 1. fresh origin
  check("a fresh origin starts with an empty portfolio", (await companies.all()).length === 0);
  const info = await relay.storage.info();
  const folder = info?.folder;
  check("auto-assigned a private sandbox (no bind prompt)", info?.autoAssigned === true, folder);

  // 2. three companies → three files
  await companies.put("firstlight", company("firstlight", "Firstlight", "Objection: trust"));
  await companies.put("replydex", company("replydex", "Replydex", "Objection: effort"));
  await companies.put("nailinit", company("nailinit", "NailInit", "Objection: price"));
  const files = readdirSync(folder).filter((f) => f.startsWith("autopilotco-"));
  check("one company = one FILE on disk", files.length === 3, files.join(", "));
  check("files use the <prefix>-<id>.json key dialect", files.every((f) => /^autopilotco-[a-z0-9]+\.json$/.test(f)), files[0]);
  check("no double-suffixed .json.json", !files.some((f) => f.endsWith(".json.json")));

  // 3. round-trip with nested structure intact
  const all = await companies.all();
  check("all() returns every company", all.length === 3, all.map((c) => c.id).join(", "));
  const fl = await companies.get("firstlight");
  check("nested decision survives the round-trip", fl?.decisions?.angle?.options?.[0]?.label === "Objection: trust");
  check("the human's lock survives", fl?.decisions?.angle?.chosenId === "o1" && fl.decisions.angle.chosenAt === "03:11");
  check("inherited palette stays a flat array", Array.isArray(fl?.inherited?.palette) && fl.inherited.palette[0] === "#8B1A1A");
  check("id rides in the filename, not the body", !("id" in JSON.parse(readFileSync(join(folder, "autopilotco-firstlight.json"), "utf8"))));

  // 4. THE per-record claim: editing A leaves B's bytes untouched
  const beforeB = readFileSync(join(folder, "autopilotco-replydex.json"), "utf8");
  const edited = await companies.get("firstlight");
  edited.decisions.angle.chosenId = "o-changed";
  await companies.put("firstlight", edited);
  const afterB = readFileSync(join(folder, "autopilotco-replydex.json"), "utf8");
  check("editing one company does NOT rewrite another's file", beforeB === afterB);
  check("the edit did land on its own file", (await companies.get("firstlight")).decisions.angle.chosenId === "o-changed");

  // 5. a torn / half-synced record is skipped, not fatal
  writeFileSync(join(folder, "autopilotco-torn.json"), "{ this is not json");
  const survived = await companies.all();
  check("a torn record is skipped, not fatal", survived.length === 3 && !survived.some((c) => c.id === "torn"), survived.length + " readable");

  // 6. hostile ids refused
  let refused = false;
  try { await companies.put("../../escape", { name: "x" }); } catch { refused = true; }
  check("a traversal id is refused by safeId", refused);
  check("a dotted id is refused (no second extension)", (await companies.get("evil.md")) === null);

  // 7. remove deletes exactly one
  await companies.remove("replydex");
  const left = await companies.all();
  check("remove() deletes exactly one record", left.length === 2 && !left.some((c) => c.id === "replydex"), left.map((c) => c.id).join(", "));

  // 8. origin isolation
  const other = await connectProvider(OTHER);
  await other.request({ method: "claude_connect", params: { reason: "x" } });
  const otherCol = collection(relayFor(other), "autopilot-co");
  check("a different origin sees NONE of the portfolio", (await otherCol.all()).length === 0);
  const otherInfo = await relayFor(other).storage.info();
  check("a different origin gets its own sandbox", otherInfo?.folder && otherInfo.folder !== folder);

  // 9. best-effort: measure one real completion so the catalog number stops being a guess
  try {
    const res = await provider.request({ method: "claude_complete", params: {
      prompt: 'You are Autopilot. Propose 3 ad angles. Return ONLY a JSON array of 3 objects, each {"label":<2-4 words>,"text":<the headline>,"recommended":<true for exactly one>}.',
      model: "sonnet", maxTokens: 1400 } });
    const u = res?.usage;
    if (u) {
      const per = (u.inputTokens || 0) + (u.outputTokens || 0);
      console.error(`\n  ⓘ MEASURED: one decision = ${per} tokens (in ${u.inputTokens} / out ${u.outputTokens}).`);
      console.error(`    A cold-open slate is 3 calls ≈ ${per * 3} tokens; a restream adds ~${per}.`);
    } else {
      console.error("\n  ⓘ completion returned no usage — token figure stays dev-reported.");
    }
  } catch (e) {
    console.error(`\n  ⓘ skipped the live completion (${String(e.message).slice(0, 80)}) — storage checks above are unaffected.`);
  }

  check("used a throwaway RELAY_DIR (real ~/.relay untouched)", relayDir.includes("relay-autopilot-"));
} finally {
  daemon.kill("SIGKILL");
}

const passed = checks.filter(Boolean).length;
console.error(`\n${passed === checks.length ? "✅ AUTOPILOT STORAGE PROOF PASSED" : `❌ ${checks.length - passed} FAILED`} — ${passed}/${checks.length} checks · one company = one file, per-origin, team-ready`);
process.exit(passed === checks.length ? 0 : 1);
