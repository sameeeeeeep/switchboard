/**
 * Try Relay with a few example "apps" — WITHOUT loading the browser extension. Each app is a
 * distinct origin that connects to the real daemon (real gate, real model, real MCP tools, real
 * consent) through the dev-extension stand-in. This is the runnable version of the browser walk
 * in TESTING.md; the apps themselves also exist as real pages under examples/apps/.
 *
 *   App 1  chat.example       — pure completion on your own Claude (like MetaMask "connect + read")
 *   App 2  notes.example      — agentic: reads a note via an MCP tool (auto-approved read)
 *   App 3  outbox.example     — agentic write: one send APPROVED at consent, one DENIED
 *
 * Run: node examples/harness/run-apps.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

const PORT = 8793;
const dir = mkdtempSync(join(tmpdir(), "relay-apps-"));
const testServer = resolve("packages/sidekick/spike/test-mcp-server.mjs");
writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: { test: { command: process.execPath, args: [testServer] } } }));

const daemon = spawn(process.execPath, [resolve("packages/sidekick/dist/index.js")], {
  env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(PORT) },
  stdio: ["ignore", "inherit", "inherit"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("exit", () => daemon.kill("SIGKILL"));

async function token() {
  const f = join(dir, "pairing-token");
  for (let i = 0; i < 50; i++) { if (existsSync(f)) return readFileSync(f, "utf8").trim(); await sleep(150); }
  throw new Error("no token");
}
const hr = (s) => console.log(`\n${"─".repeat(64)}\n${s}\n${"─".repeat(64)}`);

// The consent policy for this run. In a real browser these are human clicks in the consent window.
let denyWrites = false;
function onConsent(kind, body) {
  if (kind === "consent:connect") {
    const { requested, available } = body.requested;
    const want = new Set(requested.tools ?? []);
    const tools = available.tools.filter((t) => want.has(t.name)).map((t) => ({ name: t.name, access: t.access }));
    console.log(`   🔐 CONNECT consent from ${body.origin} — approving ${tools.length} tool(s): ${tools.map((t) => `${t.name}[${t.access}]`).join(", ") || "(none)"}`);
    return { models: requested.models ?? available.models.slice(0, 1), tools, budgets: { maxTokensPerDay: 500000, maxCallsPerMin: 60 } };
  }
  // per-action write
  const decision = denyWrites ? false : true;
  console.log(`   🔐 WRITE consent from ${body.origin} — ${body.tool.name}(${JSON.stringify(body.tool.arguments)}) → ${decision ? "APPROVE" : "DENY"}`);
  return decision;
}

async function main() {
  const tok = await token();
  await sleep(500); // let the daemon's MCP client connect

  // ---- App 1: chat.example — pure completion ----
  hr("App 1 · chat.example — a chat app running on YOUR Claude (no tools)");
  const chat = await connectAsExtension({ port: PORT, token: tok, origin: "https://chat.example", onConsent });
  await chat.request("claude_connect", { reason: "demo chat", tools: [] });
  process.stdout.write("   💬 Q: In one sentence, what problem does a 'bring your own model' broker solve?\n   💬 A: ");
  await chat.stream({ prompt: "In one sentence, what problem does a 'bring your own model' broker for websites solve?", model: "sonnet" },
    (d) => { if (d.type === "text") process.stdout.write(d.text); });
  console.log("\n   ✓ answered by your local model — the site never held an API key.");
  chat.close();

  // ---- App 2: notes.example — agentic read ----
  hr("App 2 · notes.example — an assistant that READS your notes (auto-approved read tool)");
  const notes = await connectAsExtension({ port: PORT, token: tok, origin: "https://notes.example", onConsent });
  await notes.request("claude_connect", { reason: "notes assistant", tools: ["mcp__test__read_note"] });
  console.log("   💬 Task: read note id='groceries' and tell me what's on it.");
  await notes.stream({ prompt: "Use the read_note tool to read the note with id 'groceries', then tell me in one sentence what it says.", agentic: true, model: "sonnet" },
    (d) => {
      if (d.type === "tool_proposed") console.log(`   🛠  model proposes ${d.call.name}(${JSON.stringify(d.call.arguments)}) → gate: read, auto-approved`);
      if (d.type === "text") process.stdout.write(d.text);
    });
  console.log("\n   ✓ the site used a tool it never integrated — it inherited YOUR connected MCP server.");
  notes.close();

  // ---- App 3: outbox.example — agentic write, consent APPROVE then DENY ----
  hr("App 3 · outbox.example — an app that SENDS (write tool → per-action consent EVERY time)");
  const outbox = await connectAsExtension({ port: PORT, token: tok, origin: "https://outbox.example", onConsent });
  await outbox.request("claude_connect", { reason: "outbox", tools: ["mcp__test__read_note", "mcp__test__send_note"] });

  console.log("\n   ▶ 3a. You approve the send:");
  denyWrites = false;
  await outbox.stream({ prompt: "Use the send_note tool to send a note to 'bob' with body 'ship it'. Then confirm in one short sentence.", agentic: true, model: "sonnet" },
    (d) => {
      if (d.type === "tool_proposed") console.log(`   🛠  model proposes ${d.call.name}(${JSON.stringify(d.call.arguments)})`);
      if (d.type === "tool_result") console.log(`   ${d.result.ok ? "✅ tool ran" : "⛔ tool blocked"}: ${d.result.error?.message ?? "ok"}`);
      if (d.type === "text") process.stdout.write(d.text);
    });

  console.log("\n\n   ▶ 3b. You DENY the send (same app, next action — consent is per-action):");
  denyWrites = true;
  await outbox.stream({ prompt: "Use the send_note tool to send a note to 'alice' with body 'lunch at noon?'. Then tell me in one short sentence whether it was sent.", agentic: true, model: "sonnet" },
    (d) => {
      if (d.type === "tool_proposed") console.log(`   🛠  model proposes ${d.call.name}(${JSON.stringify(d.call.arguments)})`);
      if (d.type === "tool_result") console.log(`   ${d.result.ok ? "✅ tool ran" : "⛔ tool blocked"}: ${d.result.error?.message ?? "ok"}`);
      if (d.type === "text") process.stdout.write(d.text);
    });
  console.log("\n   ✓ a hostile prompt can't self-approve — only your click can. The model proposes; you sign.");
  outbox.close();

  // ---- audit: what each origin did ----
  hr("Audit — per-origin, exactly what the popup shows");
  const ext = await connectAsExtension({ port: PORT, token: tok, origin: "control", onConsent });
  const grants = await ext.control("listGrants");
  for (const grant of grants.grants) console.log(`   ${grant.origin} — ${grant.tools.length} tools (${grant.tools.filter((t)=>t.access==="write").length} write), ${grant.usage.tokensToday} tok today`);
  ext.close();

  console.log("\n✅ Three apps connected to the SAME sidekick, each with its own scoped grant. Done.");
  daemon.kill("SIGKILL");
  process.exit(0);
}

main().catch((err) => { console.error("harness error:", err); daemon.kill("SIGKILL"); process.exit(1); });
