#!/usr/bin/env node
/**
 * run-parity — THE INTERCHANGEABILITY GATE (codex-parity slice 4, 2026-09-07).
 *
 * Why this exists: the Codex integration was validated with ONLY Codex registered. The first time both
 * providers were signed in it broke on the first mixed case (a Claude-only app routed to the global Codex
 * default and denied). "Interchangeable" is the MIXED matrix, so this runs the same REAL flows once per
 * signed-in provider — through an isolated daemon (own RELAY_DIR/port), real gate, real consent, real
 * broker MCP, real models — and then the two mixed cases that bit us. Routing is asserted from the
 * daemon's own `done` result (`result.model` is the RESOLVED model), not inferred.
 *
 *   node examples/harness/run-parity.mjs                  # every signed-in provider in PARITY_PROVIDERS
 *   PARITY_PROVIDERS=codex node examples/harness/run-parity.mjs
 *
 * A provider that isn't online is reported as SKIP for every cell — never a silent pass. Exit 1 on any FAIL.
 * Needs the providers signed in on THIS Mac (it makes real calls); hosted CI runs the fixture tests instead.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

const PORT = Number(process.env.PARITY_PORT ?? 8794);
const WANT = (process.env.PARITY_PROVIDERS ?? "claude-code,codex").split(",").map((s) => s.trim()).filter(Boolean);
const TURN_MS = Number(process.env.PARITY_TURN_MS ?? 150_000);

const dir = mkdtempSync(join(tmpdir(), "relay-parity-"));
const testServer = resolve("packages/sidekick/spike/test-mcp-server.mjs");
writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: { test: { command: process.execPath, args: [testServer] } } }));
const setModelsJson = (obj) => writeFileSync(join(dir, "models.json"), JSON.stringify(obj));
setModelsJson({ disabled: [] });

const daemon = spawn(process.execPath, [resolve("packages/sidekick/dist/index.js")], {
  env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(PORT) },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => daemon.kill("SIGKILL"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function token() {
  const f = join(dir, "pairing-token");
  for (let i = 0; i < 80; i++) { if (existsSync(f)) return readFileSync(f, "utf8").trim(); await sleep(150); }
  throw new Error("no pairing token — daemon did not start");
}
const withTimeout = (p, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: no result within ${TURN_MS / 1000}s`)), TURN_MS))]);

// Per-origin consent PLAN: which models the harness approves for that app (this is how a cell is pinned to
// ONE provider), and whether write consents are denied. The daemon classifies tools; we approve what it asks.
const plan = new Map();
function onConsent(kind, body) {
  const p = plan.get(body.origin) ?? {};
  if (kind === "consent:connect") {
    const models = p.models ?? (body.models?.requested?.length ? body.models.requested : (body.models?.available ?? []).slice(0, 1));
    const tools = (body.tools ?? []).map((t) => ({ name: t.name, access: t.access }));
    return { models, tools, budgets: { maxTokensPerDay: 500_000, maxCallsPerMin: 60 } };
  }
  return !p.denyWrites;
}

const rows = [];
const mark = (provider, check, status, detail = "") => { rows.push({ provider, check, status, detail }); console.log(`  ${status === "PASS" ? "✅" : status === "SKIP" ? "⏭ " : "❌"} [${provider}] ${check}${detail ? " — " + detail : ""}`); };
async function cell(provider, check, fn) {
  try { const detail = await fn(); mark(provider, check, "PASS", detail ?? ""); }
  catch (err) { mark(provider, check, "FAIL", String(err?.message ?? err).slice(0, 160)); }
}

async function connect(tok, origin, models, extra = {}) {
  plan.set(origin, { models, ...extra });
  const t0 = Date.now();
  for (;;) {
    try { return await connectAsExtension({ port: PORT, token: tok, origin, onConsent }); }
    catch (err) { if (Date.now() - t0 > 20_000) throw err; await sleep(250); }
  }
}

async function main() {
  const tok = await token();
  console.log(`\nparity gate · daemon on :${PORT} · state ${dir}\n`);

  // ── discovery: which providers are actually online here, and which models are whose ──
  const probe = await connect(tok, "https://probe.parity", []);
  const caps = await probe.request("claude_capabilities", {});
  probe.close();
  const byBackend = {};
  for (const m of caps.modelInfo ?? []) (byBackend[m.backend] ??= []).push(m.id);
  const online = new Set(caps.backends ?? []);
  const providers = WANT.filter((p) => online.has(p) && byBackend[p]?.length);
  for (const p of WANT.filter((p) => !providers.includes(p))) mark(p, "provider online", "SKIP", online.has(p) ? "no models advertised" : "not signed in / offline on this Mac");
  console.log(`providers under test: ${providers.join(", ") || "(none)"}\n`);

  // ── per-provider matrix: the same three real flows, app granted THIS provider only ──
  for (const p of providers) {
    const models = byBackend[p];
    console.log(`── ${p} · models ${models.join(", ")}`);
    await cell(p, "plain completion (implicit model stays in grant)", async () => {
      const app = await connect(tok, `https://chat.${p}.parity`, models);
      await app.request("claude_connect", { reason: "parity chat", tools: [] });
      const res = await withTimeout(app.stream({ prompt: "In one sentence, what does a 'bring your own model' broker do?" }), "plain");
      app.close();
      if (!models.includes(res.model)) throw new Error(`routed to ${res.model}, expected one of ${models.join("/")}`);
      if (!res.text?.trim()) throw new Error("empty reply");
      return `${res.model} · ${res.text.length}ch`;
    });
    await cell(p, "agentic read via broker MCP tool (tools portable through the broker)", async () => {
      const app = await connect(tok, `https://notes.${p}.parity`, models);
      await app.request("claude_connect", { reason: "parity notes", tools: ["mcp__test__read_note"] });
      let proposed = false;
      const res = await withTimeout(app.stream({ prompt: "Use the read_note tool to read the note with id 'groceries', then say in one sentence what it says.", agentic: true },
        (d) => { if (d.type === "tool_proposed") proposed = true; }), "agentic read");
      app.close();
      if (!models.includes(res.model)) throw new Error(`routed to ${res.model}`);
      if (!proposed) throw new Error("model never proposed the tool");
      return `${res.model} · tool proposed`;
    });
    await cell(p, "write consent: approve then deny (per-action gate)", async () => {
      const app = await connect(tok, `https://outbox.${p}.parity`, models, { denyWrites: false });
      await app.request("claude_connect", { reason: "parity outbox", tools: ["mcp__test__read_note", "mcp__test__send_note"] });
      const results = [];
      await withTimeout(app.stream({ prompt: "Use the send_note tool to send a note to 'bob' with body 'ship it'. Then confirm in one short sentence.", agentic: true },
        (d) => { if (d.type === "tool_result") results.push(d.result.ok); }), "approve send");
      plan.get(`https://outbox.${p}.parity`).denyWrites = true;
      await withTimeout(app.stream({ prompt: "Use the send_note tool to send a note to 'alice' with body 'lunch at noon?'. Then say in one short sentence whether it was sent.", agentic: true },
        (d) => { if (d.type === "tool_result") results.push(d.result.ok); }), "deny send");
      app.close();
      if (!results.includes(true)) throw new Error("approved send never ran");
      if (!results.includes(false)) throw new Error("denied send was not blocked");
      return `ran=${results.filter(Boolean).length} blocked=${results.filter((r) => r === false).length}`;
    });
  }

  // ── the MIXED cases — the ones a single-provider validation can never see ──
  const claude = byBackend["claude-code"] ?? [], codex = byBackend["codex"] ?? [];
  const mixed = providers.includes("claude-code") && providers.includes("codex");
  if (!mixed) { mark("mixed", "global Codex default vs Claude-only grant", "SKIP", "needs both providers online"); mark("mixed", "tool pre-flight (Claude-only tool routes to Claude)", "SKIP", "needs both providers online"); }
  else {
    setModelsJson({ disabled: [], defaultModel: codex[0] });   // the user's global default is Codex
    await cell("mixed", `global Codex default (${codex[0]}) vs a Claude-only app`, async () => {
      const app = await connect(tok, "https://claudeonly.parity", claude);
      await app.request("claude_connect", { reason: "parity claude-only", tools: [] });
      const res = await withTimeout(app.stream({ prompt: "Say OK." }), "claude-only implicit");
      app.close();
      if (!claude.includes(res.model)) throw new Error(`routed OUTSIDE the grant to ${res.model} (the 2026-09-07 Brandbrain bug)`);
      return `stayed in grant: ${res.model}`;
    });
    await cell("mixed", "tool pre-flight: dual-granted app, Claude-only tool (WebSearch)", async () => {
      const app = await connect(tok, "https://dual.parity", [...claude, ...codex]);
      await app.request("claude_connect", { reason: "parity dual", tools: ["WebSearch"] });
      const plain = await withTimeout(app.stream({ prompt: "Say OK." }), "dual plain");
      if (!codex.includes(plain.model)) throw new Error(`plain turn should honour the Codex default, got ${plain.model}`);
      const research = await withTimeout(app.stream({ prompt: "Search the web for today's date and reply with just the year.", agentic: true }), "dual agentic");
      if (!claude.includes(research.model)) throw new Error(`agentic turn should route to Claude (WebSearch), got ${research.model}`);
      let refused = "";
      try { await withTimeout(app.stream({ prompt: "Search the web for anything.", agentic: true, model: codex[0] }), "explicit codex agentic"); }
      catch (err) { refused = String(err?.message ?? err); }
      app.close();
      if (!/can't run WebSearch/.test(refused)) throw new Error(`explicit Codex + WebSearch should be refused by name, got: ${refused || "(no error)"}`);
      return `plain→${plain.model} · agentic→${research.model} · explicit Codex refused by name`;
    });
    setModelsJson({ disabled: [] });
  }

  // ── report ──
  const fails = rows.filter((r) => r.status === "FAIL").length, skips = rows.filter((r) => r.status === "SKIP").length;
  console.log(`\n${"provider".padEnd(12)} ${"check".padEnd(64)} status`);
  for (const r of rows) console.log(`${r.provider.padEnd(12)} ${r.check.slice(0, 64).padEnd(64)} ${r.status}`);
  console.log(`\n${rows.length - fails - skips} PASS · ${fails} FAIL · ${skips} SKIP`);
  daemon.kill("SIGKILL");
  process.exit(fails ? 1 : 0);
}

main().catch((err) => { console.error("parity harness error:", err); daemon.kill("SIGKILL"); process.exit(1); });
