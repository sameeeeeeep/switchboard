#!/usr/bin/env node
// Read-only diagnostics for the shared Claude/Codex operator integration.
import { readFileSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const homeDir = homedir();
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = join(repo, 'plugin/skills');
const skills = readdirSync(canonical).filter(n => existsSync(join(canonical, n, 'SKILL.md'))).sort();
const read = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const report = [];
const add = (name, ok, detail) => report.push({ name, ok, detail });
try { execFileSync('pgrep', ['-f', 'MacOS/Relay'], { stdio: 'ignore' }); add('Native app', true, 'running'); }
catch { add('Native app', false, 'not running or process inspection unavailable'); }
const cc = read(join(homeDir, '.claude.json')) || {};
const connections = [cc.mcpServers?.switchboard, ...Object.values(cc.projects || {}).map(p => p.mcpServers?.switchboard)].filter(Boolean);
add('Claude MCP', connections.length === 1, `${connections.length} standalone Switchboard registration(s)`);
const linked = skills.filter(name => {
  try { return realpathSync(join(homeDir, '.claude/skills', name)) === realpathSync(join(canonical, name)); } catch { return false; }
});
add('Claude skills', linked.length === skills.length, `${linked.length}/${skills.length} reference the shared source`);
try {
  const market = read(join(homeDir, '.agents/plugins/marketplace.json'));
  if (!market?.name) throw new Error('personal marketplace absent');
  const listing = JSON.parse(execFileSync('codex', ['plugin', 'list', '--marketplace', market.name, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const installed = listing.installed.filter(p => p.name === 'switchboard');
  add('Codex plugin', installed.length === 1 && installed[0].enabled, `${installed.length} installed; ${installed[0]?.version || 'missing'}`);
  if (installed.length === 1) {
    const cache = join(homeDir, '.codex/plugins/cache', market.name, 'switchboard', installed[0].version);
    const present = skills.filter(name => existsSync(join(cache, 'skills', name, 'SKILL.md')));
    const mcp = read(join(cache, '.mcp.json'));
    add('Codex components', present.length === skills.length && !!mcp?.mcpServers?.switchboard, `${present.length}/${skills.length} skills; one shared MCP config`);
    add('Codex hooks packaged', existsSync(join(cache, 'hooks/hooks.json')), 'Review/trust their current definitions in Codex /hooks');
  }
} catch (e) { add('Codex plugin', false, e.message); }
add('Shared vault', existsSync(join(homeDir, 'SwitchboardBrain')), join(homeDir, 'SwitchboardBrain'));
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else for (const row of report) console.log(`${row.ok ? '✓' : '✗'} ${row.name}: ${row.detail}`);
