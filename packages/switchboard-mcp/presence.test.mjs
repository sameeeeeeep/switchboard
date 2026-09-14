import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPresence } from './presence.mjs';

test('native bridge preserves queued cards and reads only the requested run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-presence-'));
  try {
    const api = createPresence({ dir, isRunning: () => true });
    const first = api.present({ surface: 'guide', title: 'Pick', source: 'Codex', sourceId: 'thread-a', steps: [{ text: 'Which?', options: [{ id: 'a', label: 'A' }] }] });
    assert.equal(JSON.parse(readFileSync(join(dir, 'guide-run.json'))).runId, first.runId);
    assert.throws(() => api.present({ surface: 'guide', steps: [{ text: 'Other session' }] }), /Another guide/);
    assert.equal(api.result({ surface: 'guide', runId: first.runId }).state, 'pending');
    writeFileSync(join(dir, 'guide-result.json'), JSON.stringify({ chosenOption: 'wrong-session' }));
    assert.equal(api.result({ surface: 'guide', runId: first.runId }).state, 'pending');
    mkdirSync(join(dir, 'guide-results'));
    writeFileSync(join(dir, 'guide-results', `${first.runId}.json`), JSON.stringify({ outcome: 'completed', results: [{ chosenOption: 'a', feedback: { note: 'My own answer' } }] }));
    assert.equal(api.result({ surface: 'guide', runId: first.runId }).result.results[0].feedback.note, 'My own answer');
    assert.throws(() => api.result({ surface: 'guide', runId: '../private' }), /Invalid/);
    unlinkSync(join(dir, 'guide-run.json'));
    assert.notEqual(api.present({ surface: 'guide', steps: [{ text: 'Next' }] }).runId, first.runId);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('whiteboard history recovers the correct drawing; PIP and app checks are explicit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-whiteboard-'));
  try {
    const api = createPresence({ dir, isRunning: () => true });
    const board = api.present({ surface: 'whiteboard', source: 'Claude Code', sourceId: 'thread-b', seed: [{ t: 'text', txt: 'Edit this' }] });
    assert.throws(() => api.present({ surface: 'whiteboard' }), /already open/);
    writeFileSync(join(dir, 'whiteboard-result.json'), JSON.stringify({ runId: 'other', shot: '/wrong.png' }));
    writeFileSync(join(dir, 'whiteboard-history.jsonl'), JSON.stringify({ runId: board.runId, shot: '/right.png' }) + '\n{partial');
    assert.equal(api.result({ surface: 'whiteboard', runId: board.runId }).result.shot, '/right.png');
    api.pip(true); assert.equal(api.status().pip, true);
    api.pip(false); assert.equal(api.status().pip, false);
    const offline = createPresence({ dir, isRunning: () => false });
    assert.throws(() => offline.present({ surface: 'guide' }), /not running/);
    assert.throws(() => offline.pip(true), /Open Switchboard/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
