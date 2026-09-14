import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

for (const host of ['codex', 'claude-code']) {
  test(`isolated plugin bundle: ${host} uses the same tools and starter`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'switchboard-bundle-'));
    mkdirSync(join(dir, 'connector'));
    for (const file of ['switchboard-mcp.mjs', 'launch.sh']) copyFileSync(new URL('../../plugin/connector/' + file, import.meta.url), join(dir, 'connector', file));
    const manifest = JSON.parse(readFileSync(new URL('../../plugin/' + (host === 'codex' ? 'mcp.json' : '.mcp.json'), import.meta.url)));
    const config = manifest.mcpServers.switchboard;
    const args = config.args.map(a => a.replaceAll('${PLUGIN_ROOT}', dir).replaceAll('${CLAUDE_PLUGIN_ROOT}', dir));
    const client = new Client({ name: host, version: 'test' });
    const transport = new StdioClientTransport({ command: config.command, args, cwd: dir,
      env: { ...process.env, ...config.env, PATH: '/usr/bin:/bin', SWITCHBOARD_NODE: process.execPath, SWITCHBOARD_SB: 'mock', SWITCHBOARD_VAULT: join(dir, 'vault'), RELAY_DIR: join(dir, 'state') }, stderr: 'pipe' });
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert(!result.isError, JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
    try {
      await client.connect(transport);
      const names = (await client.listTools()).tools.map(t => t.name);
      for (const name of ['switchboard_status', 'switchboard_present', 'switchboard_result', 'switchboard_pip', 'switchboard_notch', 'switchboard_arrange_board', 'guide_run']) assert(names.includes(name));
      assert.equal(names.length, new Set(names).size);
      await call('switchboard_add_task', { text: 'Isolated capture #demo', status: 'backlog', list: 'Demo' });
      const duplicate = await call('switchboard_add_task', { text: 'Isolated capture #demo', status: 'backlog', list: 'Demo' });
      assert.equal(duplicate.added, false);
      const board = await call('switchboard_list_tasks', { project: 'demo' });
      assert.equal(board.count, 1); assert.equal(board.tasks[0].column, 'backlog');
      const scaffold = await call('switchboard_scaffold_wrapp', { idea: 'Summarize my notes', name: 'Notes', dir });
      assert(scaffold.files.includes('app.js'));
      assert(readFileSync(join(scaffold.dir, 'app.js'), 'utf8').includes('Summarize my notes'));
      assert.equal((await call('switchboard_result', { surface: 'guide', runId: 'never-created' })).state, 'pending');
    } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}
