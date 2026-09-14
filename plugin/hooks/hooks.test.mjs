import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('one hook implementation handles Claude/Codex events without approving or replacing cards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-hooks-'));
  try {
    const bin = join(dir, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELAY_DIR: dir, PYTHONDONTWRITEBYTECODE: '1' };
    const run = (script, data) => execFileSync('python3', [fileURLToPath(new URL(script, import.meta.url))], { env, input: JSON.stringify(data), encoding: 'utf8' }).trim();
    const question = 'Which option would you prefer?';
    const codex = { model: 'test-model', session_id: 'codex-task', last_assistant_message: question, cwd: '/tmp/demo' };
    assert.equal(JSON.parse(run('notch-decision-guard.py', codex)).decision, 'block');
    assert.equal(run('notch-decision-guard.py', { ...codex, stop_hook_active: true }), '');
    const transcript = join(dir, 'transcript.jsonl');
    writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: question }] } }));
    assert.equal(JSON.parse(run('notch-decision-guard.py', { session_id: 'claude-task', transcript_path: transcript })).decision, 'block');
    const pending = { sourceId: 'other-task', steps: [{ text: 'Keep my question' }] };
    writeFileSync(join(dir, 'guide-run.json'), JSON.stringify(pending));
    assert.equal(run('notify.py', { ...codex, hook_event_name: 'PermissionRequest' }), '');
    const note = JSON.parse(readFileSync(join(dir, 'guide-notify.json')));
    assert.match(note.source, /^Codex/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'guide-run.json'))), pending);
    assert.equal(run('notify.py', { session_id: 'claude-task', hook_event_name: 'Notification', message: 'Attention', cwd: '/tmp/demo' }), '');
    assert.match(JSON.parse(readFileSync(join(dir, 'guide-notify.json'))).source, /^Claude Code/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
