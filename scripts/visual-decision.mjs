#!/usr/bin/env node
// visual-decision.mjs — vd1: the whiteboard as the notch DECISION surface.
//
// Decisions become VISUAL-IN / VISUAL-OUT. Instead of a wall of text options, each option is shown at
// the notch as a rendered MOCKUP (an image), and the user can answer by DRAWING on it — circle the bit
// they want, cross out the bit they don't, sketch the change — rather than only tapping a letter.
//
// It composes two primitives that already exist (no native change):
//   1. the switchboard ask-card  (~/.relay/guide-run.json → guide-result.json) with per-option `media`
//   2. the floating whiteboard   (~/.relay/whiteboard-run.json → whiteboard-result.json) with img seeds
// The net-new glue is the BRIDGE between them, orchestrated here: raise the card with mockups → read the
// pick → if the user wants to change it, open the whiteboard SEEDED with that option's mockup → read the
// drawn PNG back as the decision.
//
// Usage:
//   node scripts/visual-decision.mjs <spec.json>       # spec from a file
//   echo '<spec json>' | node scripts/visual-decision.mjs   # spec on stdin
//
// Spec shape:
//   {
//     "title":   "Landing hero",            // card title
//     "question":"Which hero reads best?",  // the fork, one line
//     "source":  "Claude Code · landing",   // provenance (who's asking)
//     "project": "Switchboard",
//     "drawInvite": "…",                    // optional override for the "⌥↓ to draw" line
//     "timeoutSec": 600,                     // optional; how long to wait for the human (default 600)
//     "options": [
//       { "id":"a", "label":"Bold",  "detail":"big word, lots of space", "recommended":true,
//         "svg":"<svg …>…</svg>" },          // inline SVG mockup — rasterized to the card thumbnail + seed
//       { "id":"b", "label":"Calm",  "detail":"quiet, editorial",
//         "mockup":"/abs/path/to/b.png" }    // OR a ready PNG/JPG path instead of svg
//     ]
//   }
//
// Result (printed to stdout as JSON):
//   { "mode":"picked"|"drawn"|"noted"|"aborted"|"timeout",
//     "chosenOption":"a", "note":"…", "annotatedShot":"/abs/….png" }
//   - picked : tapped an option, no changes wanted        → chosenOption
//   - drawn  : opened the whiteboard and Sent a marked-up board → chosenOption + note + annotatedShot
//   - noted  : typed a note but didn't draw (board closed/timed out) → chosenOption + note
//   - aborted: closed the card (esc)                       → nothing chosen
//   - timeout: never answered within timeoutSec

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
// RELAY_DIR lets tests point the whole handshake at a scratch dir (default ~/.relay in real use).
const RELAY = process.env.RELAY_DIR || path.join(HOME, '.relay');
const SHOTS = path.join(RELAY, 'vd-shots');
const GUIDE_RUN = path.join(RELAY, 'guide-run.json');
const GUIDE_RESULT = path.join(RELAY, 'guide-result.json');
const WB_RUN = path.join(RELAY, 'whiteboard-run.json');
const WB_RESULT = path.join(RELAY, 'whiteboard-result.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowId = () => `vd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function die(msg) { console.error(`[visual-decision] ${msg}`); process.exit(1); }

function appUp() {
  try { execFileSync('pgrep', ['-f', 'MacOS/Relay'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// qlmanage renders an SVG onto a SQUARE thumbnail canvas and fills the leftover with WHITE — ugly on a
// dark card. So first re-wrap the mockup onto a square canvas with a brand-dark background (no white),
// centering the original in its own coordinate space. Any aspect in, a clean square out.
function squareWrap(svg, bg = '#0e0e0e') {
  const wm = svg.match(/\bwidth="(\d+(?:\.\d+)?)"/);
  const hm = svg.match(/\bheight="(\d+(?:\.\d+)?)"/);
  const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  const W = parseFloat((wm && wm[1]) || (vb && vb[1]) || 400);
  const H = parseFloat((hm && hm[1]) || (vb && vb[2]) || 300);
  const inner = svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const side = Math.max(W, H);
  const ox = (side - W) / 2, oy = (side - H) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">`
    + `<rect width="${side}" height="${side}" fill="${bg}"/>`
    + `<svg x="${ox}" y="${oy}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg></svg>`;
}

// Rasterize an inline SVG string to a PNG file via macOS Quick Look (qlmanage — built in, no deps).
function rasterizeSvg(svg, outPng, size = 900, bg = '#0e0e0e') {
  const tmp = path.join(os.tmpdir(), `${path.basename(outPng, '.png')}.svg`);
  fs.writeFileSync(tmp, squareWrap(svg, bg));
  const outDir = path.dirname(outPng);
  // qlmanage writes <inputbasename>.png into -o dir; then we move it to the final name.
  execFileSync('qlmanage', ['-t', '-s', String(size), '-o', outDir, tmp], { stdio: 'ignore' });
  const produced = path.join(outDir, `${path.basename(tmp)}.png`); // e.g. vd-…-a.svg.png
  if (!fs.existsSync(produced)) throw new Error(`qlmanage produced no PNG for ${tmp}`);
  fs.renameSync(produced, outPng);
  try { fs.unlinkSync(tmp); } catch {}
  return outPng;
}

function pngToDataUrl(file) {
  const b64 = fs.readFileSync(file).toString('base64');
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${b64}`;
}

async function waitFor(file, timeoutMs, sinceMtime = 0) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const st = fs.statSync(file);
      if (st.mtimeMs > sinceMtime) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    await sleep(1500);
  }
  return null;
}

async function main() {
  const specArg = process.argv[2];
  let raw;
  if (specArg && fs.existsSync(specArg)) raw = fs.readFileSync(specArg, 'utf8');
  else raw = fs.readFileSync(0, 'utf8'); // stdin
  let spec;
  try { spec = JSON.parse(raw); } catch (e) { die(`bad spec JSON: ${e.message}`); }

  if (!appUp()) die('Switchboard app is not running — launch it, then retry (the notch card needs it).');
  if (!Array.isArray(spec.options) || spec.options.length < 1) die('spec.options must be a non-empty array');

  fs.mkdirSync(SHOTS, { recursive: true });
  const runId = nowId();
  const timeoutMs = (spec.timeoutSec ?? 600) * 1000;

  // 1. Render each option's mockup → a PNG file (card media), and remember its data-URL (whiteboard seed).
  const mediaById = {};
  for (const opt of spec.options) {
    if (!opt.id) die('every option needs an id');
    let png = null;
    if (opt.mockup && fs.existsSync(opt.mockup)) png = opt.mockup;
    else if (opt.svg) {
      png = path.join(SHOTS, `${runId}-${opt.id}.png`);
      try { rasterizeSvg(opt.svg, png, 900, opt.bg || '#0e0e0e'); }
      catch (e) { console.error(`[visual-decision] rasterize failed for ${opt.id}: ${e.message}`); png = null; }
    }
    if (png) mediaById[opt.id] = png;
  }

  // 2. Raise the ask card — options carry their mockup as `media`; ⌥↓ = "draw your answer".
  const drawInvite = spec.drawInvite || 'Tap the closest — or ⌥↓ to open it on the whiteboard and draw your answer.';
  const card = {
    mode: 'teach',
    title: spec.title || 'Decision',
    source: spec.source || 'Claude Code',
    project: spec.project || '',
    steps: [{
      id: 'decide',
      text: `${spec.question || 'Which one?'}\n\n${drawInvite}`,
      placement: 'notch',
      options: spec.options.map((o) => ({
        id: o.id,
        label: o.label || o.id,
        detail: o.detail || undefined,
        recommended: !!o.recommended,
        ...(mediaById[o.id] ? { media: mediaById[o.id] } : {}),
      })),
    }],
  };
  try { fs.unlinkSync(GUIDE_RESULT); } catch {}
  fs.writeFileSync(GUIDE_RUN, JSON.stringify(card, null, 2));

  // 3. Wait for the pick.
  const res = await waitFor(GUIDE_RESULT, timeoutMs);
  if (!res) { console.log(JSON.stringify({ mode: 'timeout', runId })); return; }
  if (res.outcome === 'aborted') { console.log(JSON.stringify({ mode: 'aborted', runId })); return; }

  const r0 = (res.results && res.results[0]) || {};
  const note = (r0.feedback && r0.feedback.note) ? String(r0.feedback.note).trim() : '';
  // chosen: what they tapped, else the recommended option (pre-selected), else the first.
  const rec = spec.options.find((o) => o.recommended);
  const chosenOption = r0.chosenOption || (rec && rec.id) || spec.options[0].id;

  // No typed note → they were happy with a tap. Decision is visual-IN only.
  if (!note) { console.log(JSON.stringify({ mode: 'picked', chosenOption, note: '', runId })); return; }

  // 4. They typed something (⌥↓) → open the whiteboard SEEDED with the chosen option's mockup so they can
  //    draw on it. The typed note rides along as their words; the drawn PNG comes back as the decision.
  const seedPng = mediaById[chosenOption];
  if (!seedPng) {
    // Nothing to seed (a text-only option) — return the typed note as the answer.
    console.log(JSON.stringify({ mode: 'noted', chosenOption, note, runId }));
    return;
  }
  const wbRunId = `${runId}-draw`;
  let wbSinceMtime = 0;
  try { wbSinceMtime = fs.statSync(WB_RESULT).mtimeMs; } catch {}
  const seed = [{ t: 'img', src: pngToDataUrl(seedPng), x: 0, y: 0 }];
  try { fs.unlinkSync(WB_RESULT); } catch {}
  wbSinceMtime = 0;
  fs.writeFileSync(WB_RUN, JSON.stringify({
    active: true, runId: wbRunId,
    prompt: `Draw your answer: ${spec.question || ''}`.trim(),
    source: spec.source || 'Claude Code', project: spec.project || '',
    seed,
  }, null, 2));

  // Wait for a Send from the board (or give up if they close it).
  const wb = await waitFor(WB_RESULT, timeoutMs, wbSinceMtime);
  // Close the board (state file → inactive) regardless of outcome.
  try { fs.writeFileSync(WB_RUN, JSON.stringify({ active: false }, null, 2)); } catch {}

  if (wb && wb.shot) {
    console.log(JSON.stringify({ mode: 'drawn', chosenOption, note, annotatedShot: wb.shot, runId }));
  } else {
    // Typed but never Sent a drawing — the note is still a real answer.
    console.log(JSON.stringify({ mode: 'noted', chosenOption, note, runId }));
  }
}

main().catch((e) => die(e.stack || e.message));
