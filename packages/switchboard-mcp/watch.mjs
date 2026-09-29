#!/usr/bin/env node
// Screen watch — the LIVE layer over the screen journal (packages/menubar/ScreenJournal.swift → ~/.relay/journal).
// For each settled window change, one System 1 call classifies it: task / decision / action / opportunity /
// memory / nothing, how urgent, and which line is the point. That single call is both the live trigger
// (notch cards) and "jevtag" (memory.md in the vault). Everything else stays in the journal for recall.
//
// Guard rails: follows ~/.relay/journal-on (no journal → nothing to watch); never cold-starts a local engine;
// state is redacted before it leaves the Mac; at most MAX_PER_HOUR cards, one per app per APP_COOLDOWN,
// never the same line twice; muted apps skipped; engine errors back off. Every card outcome is logged as a
// label (screen-watch-labels.jsonl) so thresholds can be tuned on real answers.
//   node packages/switchboard-mcp/watch.mjs           # long-running (installed as a LaunchAgent)
import { existsSync, readFileSync, appendFileSync, writeFileSync, statSync, openSync, readSync, closeSync, watch, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { relayDir, createPresence } from './presence.mjs';
import { createSystem1 } from './system1.mjs';
import { redact } from './journal.mjs';
import { addTask } from '../bank-mcp/tasks.mjs';

const MAX_PER_HOUR = 4;

// Poll one card's result until answered or `waitSeconds` pass (own copy: keeps the watcher independent of
// presence.mjs's newer helpers).
async function waitForResult(presence, { surface, runId, waitSeconds, intervalMs = 1500 }) {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const r = presence.result({ surface, runId });
    if (r?.state !== 'pending' || Date.now() >= deadline) return r;
    await new Promise(res => setTimeout(res, intervalMs));
  }
}
const APP_COOLDOWN_MS = 15 * 60e3;
const SETTLE_MS = 8e3;
const MIN_CONF = 0.6;

export const KINDS = {
  task: 'something the user needs to do later (a request, follow-up, deadline)',
  decision: 'someone is waiting for the user to decide, approve or answer',
  action: 'something an AI assistant could do for the user right now',
  opportunity: 'a chance worth acting on: a lead, intro, offer, invite, opening',
  memory: 'a fact worth remembering: a commitment, preference, person detail or project decision',
  nothing: 'routine content: nothing to act on or remember',
};

export function questionsFor(lines) {
  const numbered = Object.fromEntries(lines.map((l, i) => [`L${i}`, l.slice(0, 200)]));
  return {
    kind: { type: 'choice', instructions: 'What, if anything, on this screen matters to the user?', criteria: KINDS },
    urgency: { type: 'score', instructions: 'How soon does the user need to know?', criteria: ['can wait', 'today', 'right now'] },
    line: { type: 'choice', instructions: 'Which line is the key item?', criteria: numbered },
  };
}

// v2 (2026-09-29, after the first real cards were all noise: a macOS permission dialog, a masked key on a
// settings page, and the user's own messages to Claude): three extra yes/no reads decide WHO the text is
// from. A card needs a real person asking something of the user, not UI and not the user's own words.
export function questionsV2(lines) {
  return {
    ...questionsFor(lines),
    fromPerson: { type: 'noul', instructions: 'A real person other than the user wrote this (a chat message, email, comment or invite) and it is addressed to the user or needs something from them.' },
    systemUI: { type: 'noul', instructions: 'The important text is software interface: a permission prompt, dialog, settings or account page, menu, or app navigation.' },
    userOwn: { type: 'noul', instructions: 'The important text was written by the user themselves: their own message, note, or instruction to an AI assistant.' },
  };
}
const V2_CONF = 0.75;

/** Pure gate: System 1 answers + context → what to do. Exported for tests. `strict` = the v2 who-wrote-it gate. */
export function evaluate(answers, { lines, app, now, recentCards, seenKeys, muted, strict = false }) {
  const kind = answers?.kind?.choice, conf = answers?.kind?.confidence ?? 0;
  if (!kind || kind === 'nothing' || conf < MIN_CONF) return { kind: 'nothing' };
  if (strict) {
    const p = q => answers?.[q]?.noul ?? 0;
    const person = p('fromPerson') >= 0.85;               // clearly a real person asking → easier bar, no urgency gate
    if (conf < (person ? 0.65 : V2_CONF) || p('systemUI') >= 0.5 || p('userOwn') >= 0.5) return { kind: 'nothing', why: 'ui/own/low' };
    if (kind !== 'memory' && p('fromPerson') < 0.7) return { kind: 'nothing', why: 'not from a person' };
  }
  const idx = Number(String(answers?.line?.choice ?? 'L0').slice(1));
  const line = lines[idx] ?? lines[0];
  const key = createHash('sha256').update(line).digest('hex').slice(0, 16);
  if (seenKeys.has(key)) return { kind: 'seen' };
  if (kind === 'memory') return { kind, line, key, conf };
  if (strict && kind === 'action') return { kind: 'noticed', sub: kind, line, key, conf };   // actions: quiet until proven
  const urgency = answers?.urgency?.probabilities ? Object.entries(answers.urgency.probabilities).sort((a, b) => b[1] - a[1])[0][0] : '0';
  const personAsk = strict && (answers?.fromPerson?.noul ?? 0) >= 0.85;
  if (kind !== 'decision' && !personAsk && Number(urgency) < 1) return { kind: 'noticed', sub: kind, line, key, conf };
  if (muted.has(app)) return { kind: 'muted', sub: kind, line, key };
  const hourAgo = now - 3600e3;
  if (recentCards.filter(c => c.t > hourAgo).length >= MAX_PER_HOUR) return { kind: 'capped', sub: kind, line, key, conf };
  if (recentCards.some(c => c.app === app && c.t > now - APP_COOLDOWN_MS)) return { kind: 'cooldown', sub: kind, line, key, conf };
  return { kind: 'card', sub: kind, line, key, conf };
}

const OPTIONS = {
  task: [{ id: 'add', label: 'Add to board', recommended: true }, { id: 'dismiss', label: 'Not a task' }, { id: 'mute', label: 'Mute this app today' }],
  opportunity: [{ id: 'add', label: 'Add to board', recommended: true }, { id: 'dismiss', label: 'Skip' }, { id: 'mute', label: 'Mute this app today' }],
  decision: [{ id: 'add', label: 'Remind me (board)', recommended: true }, { id: 'dismiss', label: 'Handled' }, { id: 'mute', label: 'Mute this app today' }],
  action: [{ id: 'claude', label: 'Hand to Claude', detail: 'Adds a card for Claude on the board', recommended: true }, { id: 'dismiss', label: 'No' }, { id: 'mute', label: 'Mute this app today' }],
};
const TITLES = { task: 'Task spotted', opportunity: 'Opportunity', decision: 'Waiting on you', action: 'Claude could do this' };

export function createWatcher({ dir = relayDir(), vault = process.env.SWITCHBOARD_VAULT || join(homedir(), 'SwitchboardBrain'),
  system1 = createSystem1(), presence = createPresence(), log = (...a) => console.log(new Date().toISOString(), ...a) } = {}) {
  const jdir = join(dir, 'journal'), flag = join(dir, 'journal-on');
  const offsets = new Map(), pending = new Map();
  const recentCards = [], seenKeys = new Set(), muted = new Set();
  let backoffUntil = 0;

  const labels = rec => appendFileSync(join(dir, 'screen-watch-labels.jsonl'), JSON.stringify(rec) + '\n', { mode: 0o600 });
  const noticed = rec => appendFileSync(join(dir, 'screen-noticed.jsonl'), JSON.stringify(rec) + '\n', { mode: 0o600 });

  function remember(entry, line, conf) {
    if (!existsSync(vault)) mkdirSync(vault, { recursive: true });
    const p = join(vault, 'memory.md');
    if (!existsSync(p)) writeFileSync(p, '# Memory\n\nNoticed on screen by Switchboard (System 1). Edit or delete freely.\n\n');
    appendFileSync(p, `- ${entry.t.slice(0, 16).replace('T', ' ')} · ${entry.app}${entry.window ? ` · ${entry.window.slice(0, 50)}` : ''} — ${line} <!-- p=${conf.toFixed(2)} -->\n`);
  }

  function fileTask(text, detail) {
    const p = join(vault, 'tasks.md');
    const doc = existsSync(p) ? readFileSync(p, 'utf8') : '';
    const r = addTask(text, { detail }, doc);
    if (r.added) writeFileSync(p, r.doc);
    return r.added;
  }

  async function handleCard(entry, out) {
    const t = Date.now();
    recentCards.push({ t, app: entry.app });
    const submitted = presence.present({
      surface: 'guide', title: `${TITLES[out.sub]} · ${entry.app}`, source: 'Switchboard · screen watch', sourceId: 'screen-watch',
      steps: [{ id: 'card', text: out.line.slice(0, 140), placement: 'notch', options: OPTIONS[out.sub],
        ...(out.sub === 'decision' ? { say: `Someone's waiting on you in ${entry.app}.` } : {}) }],
    });
    const r = await waitForResult(presence, { surface: 'guide', runId: submitted.runId, waitSeconds: 600 });
    const step = r.result?.results?.[0] ?? {};
    const choice = step.feedback?.note ? 'note' : step.chosenOption ?? 'none';
    const where = `${entry.app}${entry.window ? ' · ' + entry.window.slice(0, 50) : ''}`;
    if (choice === 'add') fileTask(out.line.slice(0, 120), `From screen watch (${where}, ${entry.t.slice(0, 16)})`);
    if (choice === 'claude') fileTask(`Claude: ${out.line.slice(0, 110)}`, `Spotted on screen (${where}). Hand to Claude.`);
    if (choice === 'mute') muted.add(entry.app);
    labels({ t: entry.t, app: entry.app, kind: out.sub, conf: out.conf, line: out.line, choice, note: step.feedback?.note ?? null });
  }

  async function evaluateEntry(entry) {
    if (Date.now() < backoffUntil) return;
    const engine = system1.engine();
    if (engine !== 'hosted' && !(await system1.up())) return;   // never cold-start a local engine
    if (system1.keyOk && !(await system1.keyOk())) { log('hosted key not valid; nothing sent'); backoffUntil = Date.now() + 3600e3; return; }
    const lines = entry.lines.slice(-60);
    if (lines.join(' ').length < 20) return;
    const state = { app: entry.app, window: entry.window ?? '', text: lines.map(l => redact(l)).join('\n') };
    let r;
    try { r = await system1.decide({ state, questions: questionsV2(lines.map(redact)) }); }
    catch (e) {
      const rejected = /\((401|403)\)/.test(e.message);   // bad key: don't keep sending screen text to it
      backoffUntil = Date.now() + (rejected ? 6 * 3600e3 : 10 * 60e3);
      log(`System 1 ${rejected ? 'rejected the key' : 'error'}, backing off ${rejected ? '6h' : '10 min'}:`, e.message.slice(0, 160));
      return;
    }
    const out = evaluate(r.answers, { lines, app: entry.app, now: Date.now(), recentCards, seenKeys, muted, strict: true });
    if (out.key) seenKeys.add(out.key);
    log(entry.app, '→', out.kind, out.sub ?? '', out.conf?.toFixed?.(2) ?? '', (out.line ?? '').slice(0, 60));
    if (out.kind === 'memory') remember(entry, out.line, out.conf);
    else if (out.kind === 'card') handleCard(entry, out).catch(e => log('card error:', e.message));
    else if (['noticed', 'capped', 'cooldown', 'muted'].includes(out.kind)) noticed({ t: entry.t, app: entry.app, ...out });
  }

  // Settle: merge new lines per window for SETTLE_MS, then evaluate once.
  function queue(entry) {
    const k = `${entry.bundle}|${entry.window ?? ''}`;
    const cur = pending.get(k);
    if (cur) { clearTimeout(cur.timer); cur.entry.lines.push(...entry.lines); cur.entry.t = entry.t; }
    const e = cur?.entry ?? { ...entry, lines: [...entry.lines] };
    pending.set(k, { entry: e, timer: setTimeout(() => { pending.delete(k); evaluateEntry(e).catch(err => log('eval error:', err.message)); }, SETTLE_MS) });
  }

  function readNew(file) {
    const p = join(jdir, file);
    let size; try { size = statSync(p).size; } catch { return; }
    const from = offsets.get(file) ?? size;               // start at the end: only react to what's new
    if (size <= from) { offsets.set(file, size); return; }
    const buf = Buffer.alloc(size - from), fd = openSync(p, 'r');
    readSync(fd, buf, 0, buf.length, from); closeSync(fd);
    offsets.set(file, size);
    for (const row of buf.toString('utf8').split('\n').filter(Boolean)) {
      try { const e = JSON.parse(row); if (e.lines?.length) queue(e); } catch {}
    }
  }

  function start() {
    if (!existsSync(jdir)) mkdirSync(jdir, { recursive: true, mode: 0o700 });
    const today = () => `${new Date().toISOString().slice(0, 10)}.jsonl`;
    readNew(today());
    watch(jdir, (_, f) => { if (f?.endsWith('.jsonl') && existsSync(flag)) readNew(f); });
    log('screen watch started; engine:', system1.engine());
  }

  return { start, evaluateEntry, queue };
}

if (import.meta.url === `file://${process.argv[1]}`) createWatcher().start();
