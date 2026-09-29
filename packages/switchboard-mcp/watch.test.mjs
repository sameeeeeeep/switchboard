import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluate, createWatcher, questionsFor, questionsV2 } from './watch.mjs';

const ans = (kind, conf, line = 'L0', urgency = { 0: 0.1, 1: 0.2, 2: 0.7 }) =>
  ({ kind: { choice: kind, confidence: conf }, line: { choice: line }, urgency: { probabilities: urgency } });
const ctx = (o = {}) => ({ lines: ['Mike: can you send the deck by Friday?', 'ok'], app: 'Slack', now: 1e12,
  recentCards: [], seenKeys: new Set(), muted: new Set(), ...o });

test('nothing and low confidence never raise', () => {
  assert.equal(evaluate(ans('nothing', 0.99), ctx()).kind, 'nothing');
  assert.equal(evaluate(ans('task', 0.4), ctx()).kind, 'nothing');
});

test('urgent task raises a card on the chosen line', () => {
  const out = evaluate(ans('task', 0.8), ctx());
  assert.equal(out.kind, 'card'); assert.equal(out.sub, 'task'); assert.match(out.line, /deck/);
});

test('non-urgent task is only noticed; decisions raise regardless of urgency', () => {
  const calm = { 0: 0.9, 1: 0.05, 2: 0.05 };
  assert.equal(evaluate(ans('task', 0.8, 'L0', calm), ctx()).kind, 'noticed');
  assert.equal(evaluate(ans('decision', 0.8, 'L0', calm), ctx()).kind, 'card');
});

test('memory goes to memory, not a card', () => assert.equal(evaluate(ans('memory', 0.9), ctx()).kind, 'memory'));

test('rate cap, per-app cooldown, mute and dedupe', () => {
  const now = 1e12;
  const four = Array.from({ length: 4 }, (_, i) => ({ t: now - (i + 1) * 60e3, app: `A${i}` }));
  assert.equal(evaluate(ans('task', 0.8), ctx({ recentCards: four })).kind, 'capped');
  assert.equal(evaluate(ans('task', 0.8), ctx({ recentCards: [{ t: now - 60e3, app: 'Slack' }] })).kind, 'cooldown');
  assert.equal(evaluate(ans('task', 0.8), ctx({ muted: new Set(['Slack']) })).kind, 'muted');
  const first = evaluate(ans('task', 0.8), ctx());
  assert.equal(evaluate(ans('task', 0.8), ctx({ seenKeys: new Set([first.key]) })).kind, 'seen');
});

test('questions number the lines for the key-line choice', () => {
  const q = questionsFor(['a line', 'b line']);
  assert.deepEqual(Object.keys(q.line.criteria), ['L0', 'L1']);
});

test('end to end: memory lands in vault memory.md, card adds a board task, state is redacted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-')), vault = mkdtempSync(join(tmpdir(), 'vault-'));
  const sent = [];
  const system1 = { engine: () => 'hosted', up: async () => true,
    decide: async ({ state }) => { sent.push(state.text);
      const person = { fromPerson: { noul: 0.9 }, systemUI: { noul: 0.05 }, userOwn: { noul: 0.05 } };
      return { answers: { ...(state.text.includes('prefers') ? ans('memory', 0.9) : ans('task', 0.9)), ...person } }; } };
  let presented;
  const presence = { present: p => { presented = p; return { runId: 'r1' }; },
    result: () => ({ ok: true, state: 'answered', result: { results: [{ chosenOption: 'add' }] } }) };
  const w = createWatcher({ dir, vault, system1, presence, log: () => {} });
  await w.evaluateEntry({ t: '2026-09-29T10:00:00Z', app: 'Mail', window: 'Inbox', lines: ['Priya prefers calls after 4pm, priya@x.com'] });
  assert.match(readFileSync(join(vault, 'memory.md'), 'utf8'), /Priya prefers calls/);
  assert.ok(!sent[0].includes('priya@x.com'), 'email redacted before leaving the Mac');
  await w.evaluateEntry({ t: '2026-09-29T10:05:00Z', app: 'Slack', window: '#launch', lines: ['Mike: can you send the deck by Friday?'] });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(presented.title, 'Task spotted · Slack');
  assert.ok(existsSync(join(vault, 'tasks.md')));
  assert.match(readFileSync(join(vault, 'tasks.md'), 'utf8'), /send the deck by Friday/);
  assert.match(readFileSync(join(dir, 'screen-watch-labels.jsonl'), 'utf8'), /"choice":"add"/);
});

const who = (person, ui, own) => ({ fromPerson: { noul: person }, systemUI: { noul: ui }, userOwn: { noul: own } });
test('strict: UI dialogs, the user\'s own words, and non-person text never raise', () => {
  assert.equal(evaluate({ ...ans('decision', 0.99), ...who(0.1, 0.95, 0.04) }, ctx({ strict: true })).kind, 'nothing');
  assert.equal(evaluate({ ...ans('decision', 0.97), ...who(0.4, 0.6, 0.6) }, ctx({ strict: true })).kind, 'nothing');
  assert.equal(evaluate({ ...ans('task', 0.9), ...who(0.5, 0.1, 0.1) }, ctx({ strict: true })).kind, 'nothing');
});
test('strict: a clear person ask raises even when "can wait"; actions stay quiet', () => {
  const calm = { 0: 0.9, 1: 0.05, 2: 0.05 };
  assert.equal(evaluate({ ...ans('task', 0.99, 'L0', calm), ...who(0.91, 0.08, 0.2) }, ctx({ strict: true })).kind, 'card');
  assert.equal(evaluate({ ...ans('opportunity', 0.69), ...who(0.94, 0.06, 0.08) }, ctx({ strict: true })).kind, 'card');
  assert.equal(evaluate({ ...ans('action', 0.9), ...who(0.9, 0.1, 0.1) }, ctx({ strict: true })).kind, 'noticed');
});
test('v2 adds the three who-wrote-it questions', () => assert.deepEqual(
  Object.keys(questionsV2(['x'])).slice(-3), ['fromPerson', 'systemUI', 'userOwn']));
