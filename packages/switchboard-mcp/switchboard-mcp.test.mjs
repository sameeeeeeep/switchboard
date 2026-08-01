// End-to-end proof: spin up the connector as a subprocess and drive it with a REAL MCP client over
// stdio — exactly how Claude Code talks to it. We force mock sb (SWITCHBOARD_SB=mock) so the test is
// hermetic (no daemon, no network), but the code path — MCP initialize → tools/list → tools/call →
// action.run(input, sb) → parse → normalize — is the same one a live call exercises. The point:
// wrapp__adpulse__analyze returns a real, structurally-valid AdPulse diagnosis, and the scaffold
// tool writes a runnable wrapp. If this is green, an MCP client can run and set up wrapps.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "switchboard-mcp.mjs");

// A small but real Meta Ads Manager export (the shape adpulse.core.loadRows parses).
const SAMPLE_CSV = [
  "Campaign name,Ad set,Amount spent (INR),Impressions,Clicks,CTR,CPC,Purchases,Purchase value,ROAS,Frequency,Date range",
  "Retargeting | 7d,Warm,84500,412800,9630,2.33%,8.77,396,714900,8.46,3.8,1 Jun 2026 - 30 Jun 2026",
  "Prospecting | Broad,Broad F 24-40,142300,1852000,24870,1.34%,5.72,349,627400,0.8,1.9,1 Jun 2026 - 30 Jun 2026",
  "Lookalike 1%,LAL 1%,44700,391200,4030,1.03%,11.09,47,80700,2.1,2.4,1 Jun 2026 - 30 Jun 2026",
].join("\n");

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
};
const parse = (res) => JSON.parse(res.content[0].text);

const client = new Client({ name: "switchboard-mcp-test", version: "0.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER, "mcp"],
  env: { ...process.env, SWITCHBOARD_SB: "mock" },
  stderr: "inherit",
});

const scaffoldDir = mkdtempSync(join(tmpdir(), "switchboard-scaffold-"));

try {
  await client.connect(transport);
  console.log("connected to switchboard-mcp over stdio");

  // 1) tools/list — the wrapp action + the scaffold tool are advertised.
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  console.log("tools:", names.join(", "));
  check("wrapp__adpulse__analyze is advertised", names.includes("wrapp__adpulse__analyze"));
  check("switchboard_scaffold_wrapp is advertised", names.includes("switchboard_scaffold_wrapp"));

  // 2) tools/call wrapp__adpulse__analyze — a real diagnosis comes back.
  const aRes = await client.callTool({ name: "wrapp__adpulse__analyze", arguments: { csv: SAMPLE_CSV, focus: "find wasted spend", brand: { name: "Verra", positioning: "clean DTC skincare", audience: "millennials" } } });
  const a = parse(aRes);
  check("analyze ok", a.ok === true, JSON.stringify(a).slice(0, 160));
  check("analyze ran in mock mode", a.mode === "mock", a.mode);
  check("report has a 0-100 score", typeof a.report?.score === "number" && a.report.score >= 0 && a.report.score <= 100);
  check("report headline is brand-grounded", /Verra/.test(a.report?.headline || ""), a.report?.headline);
  check("report has actions", Array.isArray(a.report?.actions) && a.report.actions.length >= 1);
  check("report has one verdict per campaign (3)", (a.report?.campaigns || []).length === 3, String((a.report?.campaigns || []).length));
  check("tape pre-computed the totals headless", a.tape?.campaigns === 3 && a.tape.totalSpend > 0, JSON.stringify(a.tape));

  // 3) fail-closed: missing csv is rejected — either at the MCP schema layer (csv is required) or by
  // run()'s own guard. Both are a clean refusal, not a crash. Accept either.
  let refused = false, why = "";
  try {
    const res = await client.callTool({ name: "wrapp__adpulse__analyze", arguments: {} });
    const text = res?.content?.[0]?.text || JSON.stringify(res);
    refused = res?.isError === true || /csv|validation|required|invalid/i.test(text);
    why = String(text).slice(0, 80);
  } catch (e) { why = String(e?.message || e).slice(0, 80); refused = /csv|validation|required|invalid/i.test(why); }
  check("analyze without csv is refused cleanly", refused, why);

  // 4) scaffold — a runnable wrapp is written into a real folder.
  const sRes = parse(await client.callTool({ name: "switchboard_scaffold_wrapp", arguments: { idea: "Turn a product URL into three ad hooks", name: "Hookline", dir: scaffoldDir } }));
  check("scaffold ok", sRes.ok === true, JSON.stringify(sRes).slice(0, 160));
  check("scaffold wrote package.json + app.js + index.html", ["package.json", "app.js", "index.html"].every((f) => (sRes.files || []).includes(f)), (sRes.files || []).join(","));
  const appJs = existsSync(join(sRes.dir || "", "app.js")) ? readFileSync(join(sRes.dir, "app.js"), "utf8") : "";
  check("scaffold folded the idea into the connect reason", /Turn a product URL into three ad hooks/.test(appJs));
  const pkg = existsSync(join(sRes.dir || "", "package.json")) ? JSON.parse(readFileSync(join(sRes.dir, "package.json"), "utf8")) : {};
  check("scaffold named the package from the slug", pkg.name === "hookline", pkg.name);
} finally {
  try { await client.close(); } catch {}
  try { rmSync(scaffoldDir, { recursive: true, force: true }); } catch {}
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
