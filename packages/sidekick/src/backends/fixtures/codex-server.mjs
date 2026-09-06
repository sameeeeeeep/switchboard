import readline from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
const file = 'mock-threads.json';
let threads = {};
try { threads = JSON.parse(readFileSync(file, 'utf8')); } catch {}
let sequence = 0;
const requests = new Map();
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const event = (method, params) => send({ method, params });
function complete(threadId, turnId, text, status = 'completed') {
  event('item/agentMessage/delta', { threadId, turnId, delta: text });
  event('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 5 } } });
  event('turn/completed', { threadId, turn: { id: turnId, status } });
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.method) {
    const run = requests.get(m.id);
    if (run) complete(run.threadId, run.turnId, m.result.success ? 'tool allowed' : 'tool denied');
    return;
  }
  const p = m.params;
  let result = {};
  if (m.method === 'config/read') result = { config: { mcp_servers: { dangerous: { command: 'never-run' } } } };
  if (m.method === 'model/list') result = { data: [{ model: 'codex-test', isDefault: true }], nextCursor: null };
  if (m.method === 'account/read') result = { account: { type: 'chatgpt' } };
  if (m.method === 'thread/start') {
    if (p.config['mcp_servers.dangerous.enabled'] !== false || p.environments.length || p.sandbox !== 'read-only') throw Error('missing isolation');
    const id = `thread-${Object.keys(threads).length + 1}`;
    threads[id] = { history: [], tools: p.dynamicTools };
    result = { thread: { id } };
  }
  if (m.method === 'thread/resume') {
    if (!threads[p.threadId]) throw Error('unknown thread');
    result = { thread: { id: p.threadId } };
  }
  if (m.method === 'turn/start') {
    const turnId = `turn-${++sequence}`;
    const threadId = p.threadId;
    const text = p.input[0].text;
    threads[threadId].history.push(text);
    writeFileSync(file, JSON.stringify(threads));
    send({ id: m.id, result: { turn: { id: turnId } } });
    event('turn/started', { threadId, turn: { id: turnId } });
    if (text === 'wait') { event('item/agentMessage/delta', { threadId, turnId, delta: 'waiting' }); return; }
    if (text === 'crash') { process.exit(1); return; }
    if (text === 'tool' || text === 'unknown-tool' || text === 'tool-crash') {
      const id = `call-${sequence}`;
      requests.set(id, { threadId, turnId });
      send({ id, method: 'item/tool/call', params: { threadId, turnId, tool: text === 'unknown-tool' ? 'sb_tool_999' : 'sb_tool_0', arguments: {} } });
      if (text === 'tool-crash') setTimeout(() => process.exit(1), 30);
    } else setTimeout(() => complete(threadId, turnId, JSON.stringify(threads[threadId].history)), 10);
    return;
  }
  if (m.method === 'turn/interrupt') complete(p.threadId, p.turnId, '', 'interrupted');
  if (m.id !== undefined) send({ id: m.id, result });
});
