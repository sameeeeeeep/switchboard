// Screen journal: read side + controls for ~/.relay/journal (written by packages/menubar/ScreenJournal.swift).
// Recall = jevgrep over the journal: a LOCAL keyword prefilter narrows days of screen text to a few hundred
// candidate lines, then System 1 (switchboard_decide's engine) asks "does this line help answer the query?"
// per line. Only those candidates leave the Mac, redacted (emails, phone numbers) first. With no System 1
// engine, recall returns the local prefilter hits for the agent to read itself.
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { relayDir } from './presence.mjs';
import { createSystem1 } from './system1.mjs';

const STOP = new Set('a an the and or but of to in on at for with from by about what which who whom when where why how did do does was were is are be been it this that these those i me my we our you your he she they them his her their any some there here said say says tell told'.split(' '));
const tokens = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t));

export function redact(s) {
  return s.replace(/\b(sk|pk|rk|ghp|gho|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{2,}[•*…]*/g, '[key]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d ()-]{8,}\d/g, '[number]');
}

export function createJournal({ dir = relayDir(), system1 = createSystem1() } = {}) {
  const jdir = join(dir, 'journal');
  const flag = join(dir, 'journal-on');
  const days = () => (existsSync(jdir) ? readdirSync(jdir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort() : []);

  function* entries({ sinceDays = 7 } = {}) {
    const cutoff = new Date(Date.now() - sinceDays * 86400e3).toISOString().slice(0, 10);
    for (const f of days().filter(f => f.slice(0, 10) >= cutoff).reverse()) {
      const rows = readFileSync(join(jdir, f), 'utf8').split('\n').filter(Boolean);
      for (let i = rows.length - 1; i >= 0; i--) { try { yield JSON.parse(rows[i]); } catch {} }
    }
  }

  function status() {
    const files = days();
    const bytes = files.reduce((n, f) => n + statSync(join(jdir, f)).size, 0);
    let last = null; for (const e of entries({ sinceDays: 2 })) { last = { t: e.t, app: e.app }; break; }
    return { recording: existsSync(flag), days: files.length, oldest: files[0]?.slice(0, 10) ?? null,
      megabytes: +(bytes / 1e6).toFixed(2), lastEntry: last, dir: jdir };
  }

  function setRecording(on) {
    if (on) writeFileSync(flag, ''); else rmSync(flag, { force: true });
    return status();
  }

  /** Drop every entry newer than `minutes` ago (the "forget the last hour" button). */
  function forget(minutes) {
    const cutoff = new Date(Date.now() - minutes * 60e3).toISOString();
    let removed = 0;
    for (const f of days()) {
      const p = join(jdir, f);
      const rows = readFileSync(p, 'utf8').split('\n').filter(Boolean);
      const keep = rows.filter(r => { try { return JSON.parse(r).t < cutoff; } catch { return true; } });
      removed += rows.length - keep.length;
      if (keep.length !== rows.length) {
        if (keep.length) writeFileSync(p, keep.join('\n') + '\n', { mode: 0o600 }); else rmSync(p);
      }
    }
    return { removed, ...status() };
  }

  /** Local keyword prefilter → candidate lines with their context, best first. */
  function prefilter(query, { sinceDays = 7, app, max = 200 } = {}) {
    const q = tokens(query);
    const hits = [];
    for (const e of entries({ sinceDays })) {
      if (app && !`${e.app} ${e.bundle}`.toLowerCase().includes(app.toLowerCase())) continue;
      const ctx = `${e.app} ${e.window ?? ''}`.toLowerCase();
      for (const line of e.lines ?? []) {
        const lt = line.toLowerCase();
        let score = 0;
        for (const t of q) if (lt.includes(t)) score += 2; else if (ctx.includes(t)) score += 1;
        if (score > 0) hits.push({ score, line, t: e.t, app: e.app, window: e.window ?? '' });
      }
    }
    hits.sort((a, b) => b.score - a.score || (a.t < b.t ? 1 : -1));
    const seen = new Set();
    return hits.filter(h => !seen.has(h.line) && seen.add(h.line)).slice(0, max);
  }

  async function recall(query, { sinceDays = 7, app, limit = 20, batch = 40 } = {}) {
    const candidates = prefilter(query, { sinceDays, app });
    if (!candidates.length) return { query, engine: null, matches: [], note: 'No journal lines share words with the query.' };
    // Recall never cold-starts a local engine (a slow one would stall the answer and load the Mac):
    // hosted when keyed, a local/custom server only if it is already up, else the local-hits fallback.
    let engine = system1.engine();
    if (engine !== 'hosted' && !(await system1.up())) engine = null;
    if (engine === 'hosted' && system1.keyOk && !(await system1.keyOk())) engine = null;   // bad key: send nothing
    if (!engine) {
      return { query, engine: null, note: 'No System 1 engine; these are local keyword matches. Read them and judge relevance yourself.',
        matches: candidates.slice(0, limit) };
    }
    const scored = [];
    try {
    for (let i = 0; i < candidates.length; i += batch) {
      const chunk = candidates.slice(i, i + batch);
      const state = chunk.map((c, j) => `[${j}] (${c.app} · ${c.window.slice(0, 60)}) ${redact(c.line)}`).join('\n');
      const questions = Object.fromEntries(chunk.map((_, j) => [`l${j}`, {
        type: 'noul', instructions: `Line [${j}] contains information that helps answer: "${query}"` }]));
      const r = await system1.decide({ state, questions });
      chunk.forEach((c, j) => scored.push({ ...c, p: r.answers?.[`l${j}`]?.noul ?? 0 }));
      engine = r.engine;
    }
    } catch (e) {
      return { query, engine: null, note: `System 1 failed (${e.message.slice(0, 160)}); these are local keyword matches. Read them and judge relevance yourself.`,
        matches: candidates.slice(0, limit) };
    }
    scored.sort((a, b) => b.p - a.p);
    return { query, engine, matches: scored.filter(s => s.p >= 0.5).slice(0, limit),
      considered: candidates.length };
  }

  return { status, setRecording, forget, prefilter, recall };
}
