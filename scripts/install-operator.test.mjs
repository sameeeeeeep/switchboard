import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('shared installer preserves unrelated configuration and is idempotent', () => {
  const home = mkdtempSync(join(tmpdir(), 'switchboard-install-'));
  try {
    mkdirSync(join(home, '.claude/skills/task'), { recursive: true });
    writeFileSync(join(home, '.claude/skills/task/SKILL.md'), 'custom old task');
    writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ other: 42, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-unrelated-hook' }, { type: 'command', command: 'python3 ~/.relay/hooks/notch-decision-guard.py' }] }] } }));
    const run = () => execFileSync(process.execPath, ['scripts/install-operator.mjs', '--home', home, '--no-cli'], { encoding: 'utf8' });
    run(); run();
    const market = JSON.parse(readFileSync(join(home, '.agents/plugins/marketplace.json')));
    assert.equal(market.plugins.filter(p => p.name === 'switchboard').length, 1);
    const settings = JSON.parse(readFileSync(join(home, '.claude/settings.json')));
    assert.equal(settings.other, 42);
    const commands = settings.hooks.Stop.flatMap(g => g.hooks.map(h => h.command));
    assert.equal(commands.filter(c => c.includes('notch-decision-guard')).length, 1);
    assert(commands.includes('my-unrelated-hook'));
    assert.equal(realpathSync(join(home, '.claude/skills/task')), resolve('plugin/skills/task'));
    assert.equal(realpathSync(join(home, 'plugins/switchboard')), resolve('plugin'));
    assert.equal(readdirSync(join(home, '.relay/integration-backups')).length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('a conflicting Codex MCP is preserved instead of creating duplicate tools', () => {
  const home = mkdtempSync(join(tmpdir(), 'switchboard-conflict-'));
  try {
    mkdirSync(join(home, '.codex'));
    const original = '[mcp_servers.switchboard]\ncommand="custom"\n';
    writeFileSync(join(home, '.codex/config.toml'), original);
    assert.throws(() => execFileSync(process.execPath, ['scripts/install-operator.mjs', '--home', home, '--no-cli'], { stdio: 'pipe' }));
    assert.equal(readFileSync(join(home, '.codex/config.toml'), 'utf8'), original);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
