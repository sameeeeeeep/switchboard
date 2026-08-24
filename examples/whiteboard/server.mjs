#!/usr/bin/env node
// /whiteboard server — serves whiteboard.html and receives "Send to Claude": the browser POSTs the PNG,
// we save it to ~/.relay/whiteboard-shots/ and write ~/.relay/whiteboard-result.json (+ append history),
// which the /whiteboard skill polls and fetches. Self-contained loop — no /screen. Idempotent; safe to
// re-run (exits quietly if the port is taken). Usage: node server.mjs [port] [runId]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2] || '8902', 10);
const RUN = process.argv[3] || String(Date.now());
const RELAY = path.join(os.homedir(), '.relay');
const SHOTS = path.join(RELAY, 'whiteboard-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const HTML = fs.readFileSync(path.join(DIR, 'whiteboard.html'), 'utf8');
let n = 0;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 40e6) req.destroy(); });
    req.on('end', () => {
      try {
        const { png } = JSON.parse(body);
        const b64 = String(png).replace(/^data:image\/png;base64,/, '');
        n += 1;
        const file = path.join(SHOTS, `${RUN}-${n}.png`);
        fs.writeFileSync(file, Buffer.from(b64, 'base64'));
        const rec = { runId: RUN, n, shot: file, finishedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(RELAY, 'whiteboard-result.json'), JSON.stringify(rec, null, 2));
        fs.appendFileSync(path.join(RELAY, 'whiteboard-history.jsonl'), JSON.stringify(rec) + '\n');
        console.log(`[whiteboard] sent → ${file}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, shot: file }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`[whiteboard] port ${PORT} already serving — reusing`); process.exit(0); }
  else { console.error('[whiteboard]', e.message); process.exit(1); }
});
server.listen(PORT, () => console.log(`[whiteboard] http://localhost:${PORT}/?run=${RUN}  (run ${RUN})`));
