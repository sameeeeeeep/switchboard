/**
 * CONTEXT SOURCE SPIKE: a Google Sheet (published as CSV) becomes live shared context — zero infra.
 * Proves the resolver + the source-backed library flow, deterministically (no network):
 *   1. CSV parse handles quoted commas + embedded newlines → JSON rows keyed by the header
 *   2. SSRF guard: public https ok; localhost / private ranges rejected
 *   3. resolveCsv fetches (injected) + parses a realistic "agency brand sheet"
 *   4. library: a source-backed context caches its resolution; an app's active() reads the ROWS;
 *      the panel meta shows it's a live source with a row count
 *
 * Run: npm run build -w @relay/sidekick && node packages/sidekick/spike/context-source-spike.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv, assertPublicUrl, resolveCsv } from "../dist/context/resolver.js";
import { ContextLibrary } from "../dist/context/library.js";

const checks = [];
const check = (n, c, d = "") => { checks.push(!!c); console.error(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };

// A published-sheet CSV, with a quoted field containing commas AND an embedded newline.
const CSV = [
  "name,positioning,palette,voice",
  'Aamras,"cold-pressed Alphonso, premium","#8B1A1A,#F4A000","warm, unfussy"',
  'Haazma,"street snacks, bold, fun","#F5A623,#6B2737","playful',
  'and loud"',
].join("\n");

// 1. parse ------------------------------------------------------------------
const parsed = parseCsv(CSV);
check("header becomes keys", JSON.stringify(parsed.columns) === JSON.stringify(["name", "positioning", "palette", "voice"]));
check("two data rows", parsed.rows.length === 2);
check("quoted comma preserved in a field", parsed.rows[0].positioning === "cold-pressed Alphonso, premium");
check("embedded newline preserved in a quoted field", parsed.rows[1].voice === "playful\nand loud");

// 2. SSRF guard -------------------------------------------------------------
const rejects = (u) => { try { assertPublicUrl(u); return false; } catch { return true; } };
check("accepts a public https sheet URL", !rejects("https://docs.google.com/spreadsheets/d/abc/export?format=csv"));
check("rejects localhost", rejects("http://localhost:8080/x.csv"));
check("rejects 127.0.0.1", rejects("http://127.0.0.1/x.csv"));
check("rejects a private 192.168 host", rejects("http://192.168.1.10/x.csv"));
check("rejects a non-http scheme", rejects("file:///etc/passwd"));

// 3. resolveCsv with an injected fetch (no network) -------------------------
const fakeFetch = async () => ({ ok: true, status: 200, text: async () => CSV });
const resolved = await resolveCsv("https://docs.google.com/spreadsheets/d/abc/export?format=csv", { fetchImpl: fakeFetch });
check("resolveCsv returns rows + rowCount", resolved.rowCount === 2 && resolved.rows[0].name === "Aamras");

// 4. library flow: source-backed context an app reads -----------------------
const lib = new ContextLibrary(mkdtempSync(join(tmpdir(), "relay-src-")));
const ctx = lib.publish("panel", { name: "Agency brands (Sheet)", kind: "csv", source: { kind: "csv", url: "https://docs.google.com/spreadsheets/d/abc/export?format=csv" } });
check("a source-backed context is created (no data yet)", ctx.source?.url && ctx.data == null);
lib.setResolved(ctx.id, resolved, resolved.fetchedAt);            // Broker does this after resolveCsv
lib.setActiveProject(ctx.id);                                    // user picks it as the "working on" project
const AD = "https://adgen.app";
const seen = lib.active(AD);                                     // an app reads its active context
check("app reads the sheet's ROWS via active()", (seen?.data?.rows || []).length === 2 && seen.data.rows[0].name === "Aamras");
const m = lib.listAll().find((x) => x.id === ctx.id);
check("panel meta marks it a live source with a row count", m?.sourceKind === "csv" && m?.rowCount === 2);

const passed = checks.filter(Boolean).length;
console.error(`\n${passed === checks.length ? "✅ CONTEXT SOURCE SPIKE PASSED" : `❌ ${checks.length - passed} FAILED`} — ${passed}/${checks.length} · a Sheet becomes JSON context, zero infra`);
process.exit(passed === checks.length ? 0 : 1);
