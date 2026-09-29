// System 1: fast typed decisions from a local System One model (OneJev via packages/system1/serve.py).
// State + typed questions in, calibrated probabilities out, no generated text. The engine speaks TypeSafe's
// /v1/systemone contract, so SYSTEM1_URL can point at any compatible server (Kev, Von, hosted Jev).
// Device-lightness: the engine is opt-in (packages/system1/install.sh), starts on first use, unloads when idle.
import { existsSync, readFileSync, openSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { relayDir } from './presence.mjs';
import { createJournal } from './journal.mjs';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Hosted lane: TypeSafe's Jev through OpenRouter's Decisions API (same {model, state, questions} → {answers} shape).
// BYO key, never stored by us: OPENROUTER_API_KEY in the env, or ~/.relay/tool-secrets.json {"system1": {"OPENROUTER_API_KEY": …}} (0600).
const HOSTED_URL = 'https://openrouter.ai/api/alpha/decisions';
const HOSTED_MODEL = process.env.SYSTEM1_HOSTED_MODEL || 'typesafe/jev-1.13';

function hostedKey(dir) {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try { return JSON.parse(readFileSync(join(dir, 'tool-secrets.json'), 'utf8'))?.system1?.OPENROUTER_API_KEY || null; }
  catch { return null; }
}

export function createSystem1({ dir = relayDir(), url = process.env.SYSTEM1_URL } = {}) {
  const base = () => url || `http://127.0.0.1:${process.env.SYSTEM1_PORT || 8017}`;
  const python = join(dir, 'system1-venv/bin/python');
  const serve = join(dir, 'system1/serve.py');
  // Engine order: explicit SYSTEM1_URL → hosted Jev when a key is present → the opt-in local engine.
  const engine = () => (url ? 'custom' : hostedKey(dir) ? 'hosted' : 'local');

  async function up() {
    try { return (await fetch(`${base()}/health`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }
  async function ensure(waitMs = 120_000) {
    if (await up()) return;
    if (url) throw new Error(`System 1 server at ${url} is not answering.`);
    if (!existsSync(python) || !existsSync(serve)) {
      throw new Error('System 1 has no engine. Hosted (recommended): the user adds an OpenRouter key as OPENROUTER_API_KEY or in ~/.relay/tool-secrets.json under system1. Local (opt-in, needs a fast GPU): bash packages/system1/install.sh in the relay repo.');
    }
    const log = openSync(join(dir, 'system1.log'), 'a');
    spawn(python, [serve], { detached: true, stdio: ['ignore', log, log] }).unref();
    for (const end = Date.now() + waitMs; Date.now() < end; await sleep(1000)) if (await up()) return;
    throw new Error(`System 1 did not come up within ${waitMs / 1000}s; see ${join(dir, 'system1.log')}.`);
  }
  // Local image paths are inlined as data URIs so any file the agent can read works, not just a media root.
  function inlineMedia(media) {
    return media?.map(m => {
      if (!m.path) return m;
      const mime = MIME[extname(m.path).toLowerCase()];
      if (!mime) throw new Error(`Unsupported image type: ${m.path}`);
      const { path, ...rest } = m;
      return { ...rest, data: `data:${mime};base64,${readFileSync(path).toString('base64')}` };
    });
  }
  async function decide({ state, questions, media, timeoutSeconds = 60 }) {
    const which = engine();
    let target, headers = { 'content-type': 'application/json' }, model = 'jev-latest';
    if (which === 'hosted') {
      if (media?.length) throw new Error('Hosted Jev takes text and structured state only (no images yet). Describe the image in the state instead.');
      target = HOSTED_URL; model = HOSTED_MODEL;
      headers.authorization = `Bearer ${hostedKey(dir)}`;
    } else {
      await ensure();
      target = `${base()}/v1/systemone`;
    }
    const res = await fetch(target, {
      method: 'POST', headers,
      body: JSON.stringify({ model, state, questions, media: which === 'hosted' ? undefined : inlineMedia(media) }),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { detail: text.slice(0, 300) }; }
    if (!res.ok) throw new Error(`System 1 (${which}) rejected the request (${res.status}): ${JSON.stringify(body.error ?? body.detail ?? body)}`);
    const { qev, ...answer } = body;
    return { engine: which, ...answer };
  }
  // Hosted: confirm the key with OpenRouter (no user data sent) before anything else goes out. Cached 1h.
  let verified = { at: 0, ok: false };
  async function keyOk() {
    if (engine() !== 'hosted') return true;
    if (Date.now() - verified.at < 3600e3) return verified.ok;
    let ok = false;
    try { ok = (await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${hostedKey(dir)}` },
      signal: AbortSignal.timeout(10000) })).ok; } catch {}
    verified = { at: Date.now(), ok };
    return ok;
  }
  return { up, ensure, decide, engine, keyOk };
}

const question = z.object({
  type: z.enum(['noul', 'choice', 'score']),
  instructions: z.string().min(1),
  criteria: z.union([z.record(z.string().nullable()), z.array(z.string())]).optional(),
}).passthrough();

export function registerSystem1Tools(server) {
  const s1 = createSystem1();
  server.registerTool('switchboard_decide', {
    description: 'System 1: fast, local, typed judgment with calibrated probabilities and no generated text. Give a state (text or object; images via media + <image:N> placeholders) and named questions: noul (yes/no → probability), choice (criteria map → one option), score (ordered criteria list → level). Use it for VOLUME (triage hundreds of grep hits, files, log lines, screenshots before reading them) or cheap gating; for a handful of items just read them yourself. Treat confidence < 0.7 as "unsure" and check with your own reasoning. The result names its engine: "hosted" = TypeSafe Jev via OpenRouter (the state LEAVES this Mac, so never send secrets, keys or private user data), "local"/"custom" = on-device.',
    inputSchema: {
      state: z.union([z.string(), z.record(z.any())]).describe('What to judge. Reference media as <image:1>, <image:2>… in order.'),
      questions: z.record(question).describe('Name → question. Questions share the state but cannot see each other.'),
      media: z.array(z.object({ type: z.enum(['image', 'video']) }).passthrough()).optional()
        .describe('[{type:"image", path|url|data}] — local paths are inlined automatically.'),
      timeoutSeconds: z.number().int().min(1).max(600).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async args => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await s1.decide(args)) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }] }; }
  });

  const journal = createJournal({ system1: s1 });
  server.registerTool('switchboard_recall', {
    description: 'Recall what the user saw on screen (the local screen journal, ~/.relay/journal) by meaning — jevgrep over their own history. A local keyword prefilter picks candidate lines, then System 1 scores each for relevance; returns matching lines with time, app and window so you can answer and cite. Phrase the query with the words likely to appear on screen (names, project, topic). Candidates (redacted) leave the Mac only when the engine is hosted. With no engine it returns local keyword hits for you to judge.',
    inputSchema: {
      query: z.string().min(2), sinceDays: z.number().int().min(1).max(90).optional(),
      app: z.string().optional().describe('Only lines from this app (name or bundle id substring).'),
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, ...opts }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await journal.recall(query, opts)) }] }; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }] }; }
  });
  server.registerTool('switchboard_journal', {
    description: 'Control the local screen journal: status (recording? size, last entry), on, off, or forget (delete everything from the last N minutes). Recording is opt-in; only turn it on or off when the user asks.',
    inputSchema: { action: z.enum(['status', 'on', 'off', 'forget']), minutes: z.number().int().min(1).optional() },
  }, async ({ action, minutes }) => {
    try {
      const out = action === 'status' ? journal.status() : action === 'on' ? journal.setRecording(true)
        : action === 'off' ? journal.setRecording(false) : journal.forget(minutes ?? 60);
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }] }; }
  });
}
