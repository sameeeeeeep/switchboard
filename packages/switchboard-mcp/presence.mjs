// Shared Claude/Codex adapter for the native app's existing file protocol.
// Keep native UI behavior in Switchboard; the connector only submits and reads runs.
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';

export const relayDir = () => process.env.RELAY_DIR || join(homedir(), '.relay');
export function appRunning() {
  try { execFileSync('pgrep', ['-f', 'MacOS/Relay'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export function atomicJSON(path, value, exclusive = false) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    // link publishes a complete file without replacing another session's pending trigger.
    if (exclusive) linkSync(tmp, path); else renameSync(tmp, path);
  } finally { try { unlinkSync(tmp); } catch {} }
}
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);

export function createPresence({ dir = relayDir(), isRunning = appRunning } = {}) {
  const path = (name) => join(dir, name);
  return {
    status() {
      return { running: isRunning(), relayDir: dir, pip: !!readJSON(path('pip.json'))?.active,
        pendingGuide: !!readJSON(path('guide-run.json')),
        whiteboard: readJSON(path('whiteboard-run.json')) };
    },
    present({ surface, title, source, sourceId, project, steps, seed, mode = 'teach', autoClipboard, shot }) {
      if (!isRunning()) throw new Error('Switchboard is not running. Open the installed Switchboard app, then retry.');
      if (!['guide', 'whiteboard'].includes(surface)) throw new Error('Unknown surface');
      if (surface === 'guide' && (!steps?.length || steps.some(s => !(s.text || s.instruction)?.trim()))) {
        throw new Error('Each guide step needs text.');
      }
      if (surface === 'whiteboard' && readJSON(path('whiteboard-run.json'))?.active) {
        throw new Error('A whiteboard is already open. Finish or close it before starting another run.');
      }
      const runId = randomUUID();
      const run = { runId, title, source, sourceId, project };
      if (surface === 'guide') Object.assign(run, { mode, steps, autoClipboard, shot });
      else Object.assign(run, { active: true, seed });
      mkdirSync(dir, { recursive: true });
      try { atomicJSON(path(`${surface}-run.json`), run, surface === 'guide'); }
      catch (e) {
        if (e.code === 'EEXIST') throw new Error('Another guide is waiting for Switchboard to consume it. Retry shortly; its card was preserved.');
        throw e;
      }
      return { ok: true, surface, runId, state: 'submitted' };
    },
    result({ surface, runId }) {
      if (!validId(runId)) throw new Error('Invalid runId');
      if (!['guide', 'whiteboard'].includes(surface)) throw new Error('Unknown surface');
      let result;
      if (surface === 'guide') result = readJSON(path(`guide-results/${runId}.json`));
      else {
        const latest = readJSON(path('whiteboard-result.json'));
        if (latest?.runId === runId) result = latest;
        else {
          let lines = [];
          try { lines = readFileSync(path('whiteboard-history.jsonl'), 'utf8').trim().split('\n'); }
          catch (e) { if (e.code !== 'ENOENT') throw e; }
          for (const line of lines.reverse()) {
            try { const item = JSON.parse(line); if (item.runId === runId) { result = item; break; } } catch {}
          }
        }
      }
      return result ? { ok: true, state: 'answered', surface, runId, result }
        : { ok: true, state: 'pending', surface, runId };
    },
    pip(active) {
      if (active && !isRunning()) throw new Error('Open Switchboard before enabling its PIP feed.');
      mkdirSync(dir, { recursive: true });
      atomicJSON(path('pip.json'), { active });
      return { ok: true, active };
    },
  };
}

export function registerPresenceTools(server) {
  const presence = createPresence();
  const wrap = fn => async args => {
    try { return { content: [{ type: 'text', text: JSON.stringify(fn(args)) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }] }; }
  };
  server.registerTool('switchboard_status', {
    description: 'Check the native Switchboard app, PIP feed, and pending surfaces. Read-only; no AI call.',
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, wrap(() => presence.status()));
  server.registerTool('switchboard_present', {
    description: 'Present a native notch question/guide or an editable whiteboard using the same protocol for every agent. Returns a runId immediately. Poll switchboard_result with that id. A submitted card is not an answer or approval. Pass honest source and sourceId for the calling agent/thread. Requires the native app. Never put credentials in cards or clipboard fields.',
    inputSchema: {
      surface: z.enum(['guide', 'whiteboard']), title: z.string().min(1),
      source: z.string().min(1).describe('Agent and task label, e.g. Codex · landing'),
      sourceId: z.string().min(1).describe('Stable calling task/session id'),
      project: z.string().optional(), mode: z.enum(['teach', 'tour', 'test']).optional(),
      steps: z.array(z.object({ text: z.string().min(1) }).passthrough()).optional()
        .describe('Native guide steps. Supports id, hint, say, placement, options, media, point, copy, doneWhen. See the shared switchboard skill.'),
      seed: z.array(z.object({ t: z.string() }).passthrough()).optional()
        .describe('Editable native whiteboard objects: box, text, arrow, note, pen, img, etc.'),
      autoClipboard: z.boolean().optional(), shot: z.object({ w: z.number(), h: z.number() }).passthrough().optional(),
    },
  }, wrap(args => presence.present(args)));
  server.registerTool('switchboard_result', {
    description: 'Read the result for exactly one Switchboard run. Returns pending until the human answers. For guides inspect outcome, chosenOption AND feedback.note; typed input overrides a selection. For whiteboards inspect the returned shot image with the host image reader. Never treat a different run, timeout, or default selection as consent.',
    inputSchema: { surface: z.enum(['guide', 'whiteboard']), runId: z.string().min(1) },
    annotations: { readOnlyHint: true },
  }, wrap(args => presence.result(args)));
  server.registerTool('switchboard_pip', {
    description: 'Enable or disable the native Switchboard PIP progress feed. Changes only the feed; does not start work or schedule background runs.',
    inputSchema: { active: z.boolean() },
  }, wrap(({ active }) => presence.pip(active)));
}
