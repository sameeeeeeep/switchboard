#!/usr/bin/env node
// Rapid trigger testing for screen watch: replay journal windows (+ labelled probe cases) through System 1
// with both question sets and gates, and print what WOULD have fired. Rate caps/cooldowns are ignored so
// every trigger shows. Costs ~$0.00002 per window on hosted Jev; state is redacted like the live watcher.
//   node packages/switchboard-mcp/watch-replay.mjs [--last 40] [--probes-only]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { relayDir } from './presence.mjs';
import { createSystem1 } from './system1.mjs';
import { redact } from './journal.mjs';
import { questionsFor, questionsV2, evaluate } from './watch.mjs';

// Probes with the verdict we WANT (card / memory / quiet), to catch a gate that goes deaf.
const PROBES = [
  { want: 'card', app: 'Slack', window: '#launch', lines: ['Mike Chen  10:42 AM', 'hey, can you send me the pitch deck before Friday? investors asked', 'Reply in thread'] },
  { want: 'card', app: 'Mail', window: 'Inbox', lines: ['From: Priya Rao', 'Subject: Intro to Sequoia scout', 'Happy to intro you to Arjun at Sequoia, want me to set it up this week?'] },
  { want: 'card', app: 'Google Chrome', window: 'Calendar', lines: ['Invitation: Design review with Asha', 'Thu 3pm to 4pm', 'Going? Yes No Maybe'] },
  { want: 'memory', app: 'Slack', window: 'DM Rahul', lines: ['Rahul: fyi I only take calls after 4pm IST, mornings are school runs'] },
  { want: 'quiet', app: 'UserNotificationCenter', window: '', lines: ['Allow "Google Chrome" to find devices on local networks?', 'This will allow you to select from available devices'] },
  { want: 'quiet', app: 'Claude', window: 'Claude', lines: ['in jev running rn? I can see it watching. but havent seen any card'] },
  { want: 'quiet', app: 'Google Chrome', window: 'Settings', lines: ['API Keys', 'sk-or-v1-29b•', 'Create key', 'Usage this month $0.02'] },
  { want: 'quiet', app: 'Google Chrome', window: 'YouTube', lines: ['How to cook biryani in 10 minutes', '1.2M views', 'Subscribe'] },
];

function windows(dir, last) {
  const jdir = join(dir, 'journal');
  if (!existsSync(jdir)) return [];
  const rows = readdirSync(jdir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f =>
    readFileSync(join(jdir, f), 'utf8').split('\n').filter(Boolean).map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean));
  const groups = [];
  for (const e of rows) {                           // merge like the watcher's settle window
    const g = groups.at(-1);
    if (g && g.bundle === e.bundle && g.window === e.window && Date.parse(e.t) - Date.parse(g.t) < 15e3) { g.lines.push(...e.lines); g.t = e.t; }
    else groups.push({ ...e, lines: [...e.lines] });
  }
  return groups.filter(g => g.lines.join(' ').length >= 20).slice(-last);
}

const verdict = out => out.kind === 'card' ? `CARD ${out.sub}` : out.kind === 'memory' ? 'MEMORY' : out.kind === 'noticed' ? `noticed ${out.sub}` : '·';

async function main() {
  const args = process.argv.slice(2);
  const last = Number(args[args.indexOf('--last') + 1]) || 40;
  const s1 = createSystem1();
  if (!(await s1.keyOk?.())) { console.error('No valid System 1 engine (hosted key).'); process.exit(1); }
  const cases = [...PROBES.map(p => ({ ...p, probe: true })), ...(args.includes('--probes-only') ? [] : windows(relayDir(), last))];
  const tally = { v1: 0, v2: 0 }, misses = [];
  const ctx = { now: Date.now(), recentCards: [], seenKeys: new Set(), muted: new Set() };
  for (const c of cases) {
    const lines = c.lines.slice(-60).map(redact);
    const r = await s1.decide({ state: { app: c.app, window: c.window ?? '', text: lines.join('\n') }, questions: questionsV2(lines) });
    const a = r.answers;
    const v1 = evaluate(a, { ...ctx, lines, app: c.app }), v2 = evaluate(a, { ...ctx, lines, app: c.app, strict: true });
    if (v1.kind === 'card') tally.v1++; if (v2.kind === 'card') tally.v2++;
    const got2 = v2.kind === 'card' ? 'card' : v2.kind === 'memory' ? 'memory' : 'quiet';
    if (c.probe && got2 !== c.want) misses.push(`${c.app}: wanted ${c.want}, v2 gave ${got2}`);
    const n = q => (a?.[q]?.noul ?? 0).toFixed(2);
    console.log(`${c.probe ? `probe(${c.want})`.padEnd(14) : (c.t ?? '').slice(11, 16).padEnd(14)} ${String(c.app).slice(0, 14).padEnd(14)} ` +
      `${a.kind.choice.padEnd(11)} ${(a.kind.confidence ?? 0).toFixed(2)}  person ${n('fromPerson')} ui ${n('systemUI')} own ${n('userOwn')}  ` +
      `v1 ${verdict(v1).padEnd(16)} v2 ${verdict(v2).padEnd(16)} | ${(v2.line ?? v1.line ?? lines[0] ?? '').slice(0, 50)}`);
  }
  console.log(`\n${cases.length} windows · cards v1 ${tally.v1} → v2 ${tally.v2}${misses.length ? `\nprobe misses (v2):\n  ${misses.join('\n  ')}` : '\nall probes as wanted under v2'}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
