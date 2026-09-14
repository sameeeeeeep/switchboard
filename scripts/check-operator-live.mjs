#!/usr/bin/env node
// Exercise the installed Codex plugin's real launcher with read-only MCP calls.
// --notify additionally sends one test toast; --launch may open the native app.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
const homeDir = homedir();
const market = JSON.parse(readFileSync(join(homeDir, '.agents/plugins/marketplace.json')));
const listing = JSON.parse(execFileSync('codex', ['plugin', 'list', '--marketplace', market.name, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const installed = listing.installed.find(p => p.name === 'switchboard' && p.enabled);
if (!installed) throw new Error('Switchboard plugin is not installed/enabled');
const root = join(homeDir, '.codex/plugins/cache', market.name, 'switchboard', installed.version);
const config = JSON.parse(readFileSync(join(root, 'mcp.json'))).mcpServers.switchboard;
const expand = value => value.replaceAll('${PLUGIN_ROOT}', root);
const client = new Client({ name: 'codex-switchboard-verification', version: '1.0' });
const transport = new StdioClientTransport({ command: config.command, args: config.args.map(expand), cwd: expand(config.cwd), env: { ...process.env, ...config.env }, stderr: 'pipe' });
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result));
  return JSON.parse(result.content[0].text);
};
try {
  await client.connect(transport);
  let status = await call('switchboard_status');
  if (!status.running && process.argv.includes('--launch')) {
    execFileSync('open', ['-a', 'Switchboard']);
    for (let n = 0; n < 10 && !status.running; n++) {
      await new Promise(resolve => setTimeout(resolve, 500)); status = await call('switchboard_status');
    }
  }
  const board = await call('switchboard_list_tasks', { project: 'switchboard' });
  const tools = (await client.listTools()).tools.map(t => t.name);
  const report = { installed: installed.pluginId, tools: tools.length, uniqueTools: new Set(tools).size,
    nativeAppRunning: status.running, pendingGuidePreserved: status.pendingGuide, switchboardTaskCount: board.count };
  if (process.argv.includes('--notify') && status.running) {
    const note = await call('switchboard_notch', { kind: 'info', text: 'Codex is connected to Switchboard', source: 'Codex · integration check', project: 'Switchboard' });
    report.testNotificationWritten = note.fired;
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
