// Turns a runner results JSON (window.__RESULTS__) + the per-wrapp specs into a standalone HTML
// report. Usage:  node report.mjs results.json > report.html
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROJECTS, PROJECT_IDS } from "./projects.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const resultsPath = process.argv[2] || join(HERE, "results.json");
const RESULTS = JSON.parse(await readFile(resultsPath, "utf8"));
const SPECS = JSON.parse(await readFile(join(HERE, "wrapp-specs.json"), "utf8")).result;
const SPEC_BY_ID = Object.fromEntries(SPECS.map((s) => [s.id, s]));

// display order + names (mirrors the runner)
const VIRAL = ["arcade", "yearbook", "toon", "storybook", "petrait", "emote", "inkling", "roomify", "thumbs", "meme", "roast", "rizz", "anthem", "dreamlog"];
const ORDER = ["adforge", "adgen", "aplus", "imagegen", "shelf", "studio", "reel", "marquee", "take", "identity", "batch", "bank", "redline", "adpulse", "huddle", "chat", "cartridge", "arcana", "natal", "cast", ...VIRAL].filter((id) => RESULTS[id + ":" + PROJECT_IDS[0]]);
const NAMES = { adgen: "Adwall", imagegen: "Prism", chat: "betterchat", natal: "NATAL", cast: "Cast", arcade: "Arcade", yearbook: "Yearbook", toon: "Toon", storybook: "Storybook", petrait: "Petrait", emote: "Emote", inkling: "Inkling", roomify: "Roomify", thumbs: "Thumbs", meme: "Meme", roast: "Roast", rizz: "Rizz", anthem: "Anthem", dreamlog: "Dreamlog" };
const CATS = {};
for (const s of SPECS) CATS[s.id] = s.category;
CATS.cast = "play-make";
for (const id of VIRAL) CATS[id] = CATS[id] || "viral";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function verdictOf(id, p) { const r = RESULTS[id + ":" + p]; return r ? r.verdict : "—"; }
function detailOf(id, p) { const r = RESULTS[id + ":" + p]; return r ? r.detail : ""; }
function errsOf(id, p) { const r = RESULTS[id + ":" + p]; return (r && r.errors) || []; }

// tallies
const counts = { pass: 0, warn: 0, fail: 0 };
for (const id of ORDER) for (const p of PROJECT_IDS) { const v = verdictOf(id, p); if (counts[v] != null) counts[v]++; }
const total = counts.pass + counts.warn + counts.fail;

function stageSummary(id) {
  const s = SPEC_BY_ID[id]; if (!s) return "";
  const first = (s.stages || [])[0];
  return first ? `${first.responseType} — ${first.name.replace(/\s*\(.*$/, "")}` : "";
}
function chip(v) { return `<span class="v ${v}">${v}</span>`; }

const rows = ORDER.map((id) => {
  const name = NAMES[id] || (SPEC_BY_ID[id] && SPEC_BY_ID[id].name) || id;
  const cells = PROJECT_IDS.map((p) => `<td>${chip(verdictOf(id, p))}<div class="d">${esc(detailOf(id, p))}</div></td>`).join("");
  return `<tr><td class="w"><b>${esc(name)}</b><span class="cat">${esc(CATS[id] || "")}</span><div class="sig">${esc(stageSummary(id))}</div></td>${cells}</tr>`;
}).join("");

function projectCard(pid) {
  const p = PROJECTS[pid]; const d = p.brand.data;
  const sw = (d.palette || []).slice(0, 5).map((c) => `<i style="background:${esc(c)}"></i>`).join("");
  return `<div class="pc">
    <div class="pc-h"><b>${esc(p.label)}</b><span>${esc(p.blurb)}</span></div>
    <div class="sw">${sw}</div>
    <div class="pc-b"><b>Positioning.</b> ${esc(d.positioning)}<br><b>Voice.</b> ${esc(d.voice)}<br><b>Audience.</b> ${esc(d.audience)}<br><b>Products.</b> ${esc((d.products || []).join(", "))}</div>
    <div class="pc-f">facets lent: brand · persona · personal · project</div>
  </div>`;
}

const detailCards = ORDER.map((id) => {
  const s = SPEC_BY_ID[id]; const name = NAMES[id] || (s && s.name) || id;
  const per = PROJECT_IDS.map((p) => {
    const r = RESULTS[id + ":" + p] || {};
    const e = (r.errors || []).slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join("");
    const calls = (r.calls || []).length;
    const meta = calls ? `<span class="pp-c">${calls} model call${calls > 1 ? "s" : ""}</span>` : "";
    return `<div class="pp"><div class="pp-h">${esc(p)} ${chip(verdictOf(id, p))}</div><div class="pp-d">${esc(r.detail || "")} ${meta}</div>${e ? `<ul class="pp-e">${e}</ul>` : ""}</div>`;
  }).join("");
  const reads = s ? `reads <b>${esc((s.contextReads.kinds || []).join(", ") || "no")}</b> context (${esc(s.contextReads.usesContext)})` : "";
  const stages = s ? (s.stages || []).map((st) => `<span class="st">${esc(st.responseType)}</span>`).join(" ") : "";
  return `<div class="card">
    <div class="card-h"><b>${esc(name)}</b><span class="cat">${esc(CATS[id] || "")}</span></div>
    <div class="card-m">${reads} · pipeline: ${stages}</div>
    <div class="card-p">${per}</div>
  </div>`;
}).join("");

// Dark-first tokens (the dev-console aesthetic that suits a test harness), with a fully-designed
// light theme for viewers who toggle. Accent is Switchboard blue; pass/warn/fail are semantic,
// separate from the accent. Mono carries the data (signatures, counts, code) — fitting the subject.
const DARK = `--bg:#0b0b0f;--pnl:#14141c;--pnl2:#0f0f16;--ln:#23232e;--fg:#e9e9f2;--mut:#8b8ba2;--accent:#7ea2ff;--chip:#1a1a24;--pass-bg:#12331f;--pass-fg:#5fd88f;--warn-bg:#332810;--warn-fg:#e4ad5f;--fail-bg:#3a1620;--fail-fg:#e97088;--shadow:0 1px 0 #ffffff08`;
const LIGHT = `--bg:#f5f7fc;--pnl:#ffffff;--pnl2:#f2f4fa;--ln:#e2e6f1;--fg:#171a24;--mut:#5b6379;--accent:#3f6fe0;--chip:#eef1f9;--pass-bg:#e3f6ec;--pass-fg:#127a41;--warn-bg:#fbf0d9;--warn-fg:#95610b;--fail-bg:#fce5ea;--fail-fg:#bc2a45;--shadow:0 1px 2px #1a234010`;
const html = `<style>
 :root{${LIGHT}}
 @media (prefers-color-scheme:dark){:root{${DARK}}}
 :root[data-theme="dark"]{${DARK}}
 :root[data-theme="light"]{${LIGHT}}
 *{box-sizing:border-box}
 .wrap{max-width:1020px;margin:0 auto;padding:44px 24px 96px;background:var(--bg);color:var(--fg);
   font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
   font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
 .wrap :is(h1,h2,h3){text-wrap:balance}
 .eyebrow{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 10px}
 h1{font-size:30px;letter-spacing:-.02em;margin:0 0 6px}
 .lede{color:var(--mut);margin:0 0 30px;max-width:66ch;font-size:15.5px}
 h2{font-size:15px;letter-spacing:.02em;margin:44px 0 16px;padding-top:20px;border-top:1px solid var(--ln);display:flex;align-items:baseline;gap:10px}
 h2 .n{font:600 11px/1 ui-monospace,monospace;color:var(--mut)}
 code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--chip);border:1px solid var(--ln);padding:.5px 5px;border-radius:5px;font-size:.86em}
 .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
 @media(max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}}
 .kpi{background:var(--pnl);border:1px solid var(--ln);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow)}
 .kpi b{font-size:32px;letter-spacing:-.02em;display:block;line-height:1.1}
 .kpi span{color:var(--mut);font-size:11.5px;display:block;margin-top:4px}
 .kpi.p{border-top:2px solid var(--pass-fg)}.kpi.p b{color:var(--pass-fg)}
 .kpi.w{border-top:2px solid var(--warn-fg)}.kpi.w b{color:var(--warn-fg)}
 .kpi.f{border-top:2px solid var(--fail-fg)}.kpi.f b{color:var(--fail-fg)}
 .kpi.t{border-top:2px solid var(--accent)}
 .projects{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 @media(max-width:720px){.projects{grid-template-columns:1fr}}
 .pc{background:var(--pnl);border:1px solid var(--ln);border-radius:14px;padding:18px;box-shadow:var(--shadow)}
 .pc-h b{font-size:17px}.pc-h span{color:var(--mut);font-size:12px;display:block;margin-top:3px}
 .sw{display:flex;gap:6px;margin:12px 0}.sw i{width:28px;height:28px;border-radius:7px;display:block;box-shadow:inset 0 0 0 1px #00000018}
 .pc-b{font-size:12.5px;color:var(--fg);opacity:.9;line-height:1.55}.pc-b b{color:var(--accent);font-weight:600}
 .pc-f{color:var(--mut);font-size:11px;margin-top:10px;font-family:ui-monospace,monospace}
 .tablewrap{overflow-x:auto;border:1px solid var(--ln);border-radius:14px;background:var(--pnl);box-shadow:var(--shadow)}
 table{border-collapse:collapse;width:100%;min-width:520px}
 th,td{padding:11px 14px;border-bottom:1px solid var(--ln);text-align:left;vertical-align:top}
 tbody tr:last-child td{border-bottom:none}
 tbody tr:hover{background:var(--pnl2)}
 th{color:var(--mut);font:600 10.5px/1 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
 td.w{width:38%}.cat{color:var(--mut);font-size:11px;margin-left:8px}
 .sig{color:var(--mut);font-size:11px;margin-top:3px;font-family:ui-monospace,monospace}
 td .d{color:var(--mut);font-size:11px;margin-top:3px}
 .v{display:inline-block;font:700 10.5px/1.5 ui-monospace,monospace;padding:2px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.03em}
 .v.pass{background:var(--pass-bg);color:var(--pass-fg)}.v.warn{background:var(--warn-bg);color:var(--warn-fg)}.v.fail{background:var(--fail-bg);color:var(--fail-fg)}
 .cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:720px){.cards{grid-template-columns:1fr}}
 .card{background:var(--pnl);border:1px solid var(--ln);border-radius:13px;padding:15px 16px;box-shadow:var(--shadow)}
 .card-h b{font-size:15px}.card-m{color:var(--mut);font-size:12px;margin:7px 0 11px}.card-m b{color:var(--fg);opacity:.85}
 .st{background:var(--chip);border:1px solid var(--ln);border-radius:6px;padding:1px 6px;font-size:10.5px;font-family:ui-monospace,monospace}
 .card-p{display:grid;grid-template-columns:1fr 1fr;gap:8px}
 .pp{background:var(--pnl2);border:1px solid var(--ln);border-radius:9px;padding:9px 11px}
 .pp-h{font-size:11.5px;font-weight:600;text-transform:capitalize;display:flex;align-items:center;gap:6px}
 .pp-d{color:var(--mut);font-size:11px;margin-top:4px}
 .pp-c{color:var(--mut);font-size:10px;background:var(--chip);border:1px solid var(--ln);border-radius:5px;padding:1px 5px;margin-left:2px;white-space:nowrap;font-family:ui-monospace,monospace}
 .pp-e{margin:5px 0 0;padding-left:16px;color:var(--fail-fg);font-size:10.5px}
 .method{background:var(--pnl);border:1px solid var(--ln);border-radius:14px;padding:18px 22px;font-size:13.5px;color:var(--fg);line-height:1.65;box-shadow:var(--shadow)}
 .method b{color:var(--accent)}
 .foot{color:var(--mut);font-size:11.5px;margin-top:34px;font-family:ui-monospace,monospace;line-height:1.7}
</style>
<div class="wrap">
<p class="eyebrow">Switchboard · wrapp test harness</p>
<h1>Every wrapp, driven headless against two projects</h1>
<p class="lede">All ${ORDER.length} wrapps booted on a mock <code>window.claude</code>, each lent one of two projects as context, then driven through its real stage-1 pipeline. ${total} runs — one per wrapp × project.</p>

<div class="kpis">
  <div class="kpi p"><b>${counts.pass}</b><span>PASS — stage-1 rendered clean</span></div>
  <div class="kpi w"><b>${counts.warn}</b><span>WARN — partial / needs a live backend</span></div>
  <div class="kpi f"><b>${counts.fail}</b><span>FAIL — no stage-1 output</span></div>
  <div class="kpi t"><b>${total}</b><span>total runs</span></div>
</div>

<h2><span class="n">01</span> The two projects</h2>
<div class="projects">${PROJECT_IDS.map(projectCard).join("")}</div>

<h2><span class="n">02</span> Results matrix</h2>
<div class="tablewrap"><table><thead><tr><th>wrapp</th>${PROJECT_IDS.map((p) => `<th>${esc(p)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>

<h2><span class="n">03</span> Per-wrapp detail</h2>
<div class="cards">${detailCards}</div>

<h2><span class="n">04</span> How the harness works</h2>
<div class="method">
 A single mock <code>window.claude</code> provider is injected into each wrapp's page <b>before</b> its module script, so every wrapp boots the returning-user path (a granted <code>permissions()</code>) with no click. The provider answers <code>context.active()/list()/use()</code> with the lent project (brand · persona · personal · project facets), serves per-origin <code>storage</code>, and — the interesting part — answers <code>stream()</code> with a keyword-routed responder that returns the <b>exact shape each wrapp parses</b> (e.g. AdForge's <code>{concepts:[…]}</code>, Adwall's <code>{directions:[6]}</code>, Shelf's triage object), grounded in the lent brand. Image stages resolve to a real branded placeholder PNG. Because the responses derive from the brand, Switchboard and NailInit produce visibly different output for the same wrapp — the point of running both.
 <br><br><b>Verdict key.</b> <span class="v pass">pass</span> stage-1 success signal rendered, no page errors · <span class="v warn">warn</span> rendered but with a captured console/runtime error, or a partial precursor · <span class="v fail">fail</span> no stage-1 output within timeout.
 <br><br><b>Known limitations.</b> <b>Cast</b> uses its own built-in <code>?harness</code> (a fixed cooking persona), so it's project-agnostic — the same verdict is shown for both columns. <b>Redline</b> and <b>AdPulse</b> are folder-/connector-bound in production; the harness stands in a bound folder / canned CSV, so their verdicts reflect the mock path, not a live audit/connector pull.
</div>

<p class="foot">Generated by examples/apps/harness/report.mjs from a live browser run of examples/apps/harness/runner.html.<br>Re-run: node examples/apps/harness/serve.mjs → open /runner.html → node report.mjs results.json &gt; report.html</p>
</div>`;

// Entity-encode non-ASCII punctuation so the report renders correctly no matter how the host
// declares (or omits) the charset — the Artifact wrapper and a bare static server both work.
const encoded = html
  .replace(/·/g, "&middot;").replace(/—/g, "&mdash;").replace(/–/g, "&ndash;").replace(/×/g, "&times;")
  .replace(/’/g, "&rsquo;").replace(/‘/g, "&lsquo;").replace(/“/g, "&ldquo;").replace(/”/g, "&rdquo;")
  .replace(/…/g, "&hellip;").replace(/★/g, "&#9733;").replace(/₹/g, "&#8377;").replace(/→/g, "&rarr;");
process.stdout.write(encoded);
