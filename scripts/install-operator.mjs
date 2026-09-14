#!/usr/bin/env node
// One source tree for both hosts. Codex gets one plugin; Claude's existing direct setup gets links.
// Back up replaced Switchboard-only files. Never rewrite unrelated skills, plugins, or MCP servers.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, readdirSync, readlinkSync, symlinkSync, renameSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(repo, 'plugin');
const argv = process.argv.slice(2);
const value = key => { const i = argv.indexOf(key); return i < 0 ? undefined : argv[i + 1]; };
const client = value('--client') || 'both';
const dry = argv.includes('--dry-run');
// --home is for isolated installation tests; it does not override the shell's HOME.
const targetHome = resolve(value('--home') || homedir());
const noCli = argv.includes('--no-cli');
if (argv.includes('--help')) {
  console.log('Usage: node scripts/install-operator.mjs [--client codex|claude|both] [--dry-run]\n  --home <dir> --no-cli  isolate registration files for tests (no live CLI changes)');
  process.exit(0);
}
if (!['codex', 'claude', 'both'].includes(client)) throw new Error('Unknown --client');
if (targetHome !== homedir() && !noCli) throw new Error('--home requires --no-cli; do not mix isolated files with live CLI registration.');
const backupRoot = join(targetHome, '.relay', 'integration-backups', new Date().toISOString().replace(/[:.]/g, '-'));
const skills = readdirSync(join(plugin, 'skills')).filter(n => existsSync(join(plugin, 'skills', n, 'SKILL.md'))).sort();
const read = p => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
const exists = p => { try { lstatSync(p); return true; } catch { return false; } };
function backup(p) {
  const target = join(backupRoot, p.slice(targetHome.length + 1));
  mkdirSync(dirname(target), { recursive: true });
  renameSync(p, target);
  console.log(`  backed up ${p} → ${target}`);
}
function link(source, target) {
  if (exists(target) && lstatSync(target).isSymbolicLink() && resolve(dirname(target), readlinkSync(target)) === source) return;
  console.log(`  ${dry ? 'would link' : 'link'} ${target} → ${source}`);
  if (dry) return;
  if (exists(target)) backup(target);
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target);
}
function save(p, data) {
  const body = JSON.stringify(data, null, 2) + '\n';
  if (existsSync(p) && readFileSync(p, 'utf8') === body) return;
  console.log(`  ${dry ? 'would update' : 'update'} ${p}`);
  if (dry) return;
  mkdirSync(dirname(p), { recursive: true });
  // Keep the old contents while replacing the file atomically.
  if (existsSync(p)) {
    const target = join(backupRoot, p.slice(targetHome.length + 1));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(p), { mode: 0o600 });
  }
  const tmp = p + '.switchboard.tmp';
  writeFileSync(tmp, body, { mode: 0o600 }); renameSync(tmp, p);
}
function run(command, args) {
  console.log(`  ${dry || noCli ? 'would run' : 'run'} ${command} ${args.join(' ')}`);
  if (!dry && !noCli) execFileSync(command, args, { stdio: 'inherit' });
}

// Preflight all conflicts before touching either host.
const marketplacePath = join(targetHome, '.agents/plugins/marketplace.json');
const marketplace = read(marketplacePath) || { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] };
if (!/^[A-Za-z0-9_-]+$/.test(marketplace.name)) throw new Error('Invalid personal marketplace name');
const entry = marketplace.plugins?.find(p => p.name === 'switchboard');
if (entry && (entry.source?.source !== 'local' || entry.source?.path !== './plugins/switchboard')) {
  throw new Error('The marketplace already has a different Switchboard source. Resolve it before installing another copy.');
}
const localPlugin = join(targetHome, 'plugins/switchboard');
if (exists(localPlugin) && (!lstatSync(localPlugin).isSymbolicLink() || realpathSync(localPlugin) !== realpathSync(plugin))) {
  throw new Error(`${localPlugin} already belongs to another source; it was preserved.`);
}
// A standalone Codex MCP registration would duplicate the plugin server. Fail visibly instead of
// deleting a potentially customized connection. The normal installer creates no standalone entry.
if (client !== 'claude') {
  const config = join(targetHome, '.codex/config.toml');
  if (existsSync(config) && /^\[mcp_servers\.(?:"switchboard"|switchboard)\]/m.test(readFileSync(config, 'utf8'))) {
    throw new Error('A standalone Codex switchboard MCP already exists. Migrate that entry before installing the plugin; no duplicate was added.');
  }
}
console.log(`Switchboard shared operator install: ${client}${dry ? ' (dry run)' : ''}`);
if (client !== 'claude') {
  link(plugin, localPlugin);
  if (!entry) marketplace.plugins.push({ name: 'switchboard', source: { source: 'local', path: './plugins/switchboard' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' });
  save(marketplacePath, marketplace);
  run('codex', ['plugin', 'add', `switchboard@${marketplace.name}`]);
}
if (client !== 'codex') {
  const settings = read(join(targetHome, '.claude/settings.json')) || {};
  const pluginEnabled = Object.entries(settings.enabledPlugins || {}).some(([name, enabled]) => name.startsWith('switchboard@') && enabled);
  if (pluginEnabled) {
    console.log('  Claude Switchboard plugin already enabled; not adding standalone skills, hooks, or MCP. Update that plugin from the shared source.');
  } else {
    for (const name of skills) link(join(plugin, 'skills', name), join(targetHome, '.claude/skills', name));
    // Existing legacy hook commands continue to work through these aliases.
    for (const [name, source] of [['cc-notify.py', 'notify.py'], ['notify.py', 'notify.py'], ['notch-decision-guard.py', 'notch-decision-guard.py']]) {
      link(join(plugin, 'hooks', source), join(targetHome, '.relay/hooks', name));
    }
    settings.hooks ||= {};
    const registrations = { Notification: { script: 'cc-notify.py', matcher: '' }, Stop: { script: 'notch-decision-guard.py', matcher: '' } };
    for (const [event, { script, matcher }] of Object.entries(registrations)) {
      const groups = settings.hooks[event] ||= [];
      // Collapse only Switchboard's handler, leaving other handlers/groups untouched.
      for (const group of groups) group.hooks = (group.hooks || []).filter(h => !String(h.command || '').includes(script));
      settings.hooks[event] = groups.filter(g => g.hooks?.length);
      settings.hooks[event].push({ matcher, hooks: [{ type: 'command', command: `python3 "${join(targetHome, '.relay/hooks', script)}"` }] });
    }
    save(join(targetHome, '.claude/settings.json'), settings);
    const claudeConfig = read(join(targetHome, '.claude.json')) || {};
    const registered = claudeConfig.mcpServers?.switchboard || Object.values(claudeConfig.projects || {}).some(p => p.mcpServers?.switchboard);
    if (registered) console.log('  Existing Claude Switchboard MCP retained (no duplicate registration).');
    else run('claude', ['mcp', 'add', 'switchboard', '-s', 'user', '--env', 'SWITCHBOARD_SB=daemon', '--', process.execPath, join(plugin, 'connector/switchboard-mcp.mjs'), 'mcp']);
  }
}
console.log('Done. Codex: use a new task to load the plugin; review its lifecycle hooks in /hooks.');
