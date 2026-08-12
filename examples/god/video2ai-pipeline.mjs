// video2ai-pipeline.mjs
//
// Standalone Node module that powers a video-extraction pipeline by REUSING the
// existing `capabilities.video2ai` product. It does NOT reimplement video
// understanding — it drives yt-dlp (download) + the video2ai CLI (extract) and
// maps the CLI's `metadata.json` into one structured object the menubar
// launcher can consume.
//
// DISCOVERED CONTRACT (do not guess — this is what the real product produces):
//
//   Download (matches capabilities/video2ai/web.py _run_url_pipeline):
//     yt-dlp --no-playlist \
//       -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best" \
//       --merge-output-format mp4 \
//       -o "<dir>/%(title).80s.%(ext)s" \
//       --print after_move:filepath <url>
//     yt-dlp handles BOTH YouTube and public Instagram posts/reels.
//
//   Extract (video2ai CLI — entry point `video2ai = capabilities.video2ai.cli:main`):
//     python3 -m capabilities.video2ai.cli <videoFile> -o <jobDir> --format json
//     (run with cwd = the capabilities project root so the `capabilities`
//      package imports; or the installed `video2ai` console script if on PATH)
//
//   Output: <jobDir>/metadata.json (from capabilities/video2ai/output.py write_json):
//     {
//       source, duration_seconds, duration_formatted, resolution, fps, codec,
//       file_size_mb, total_frames_extracted, key_frames_count,
//       contact_sheets_count,
//       transcript: [ { start, end, text } ],
//       frames: [ { index, timestamp, path, is_key_frame, ocr_text?, labels?, llm_reasoning? } ],
//       key_frame_indices: [ ... ],
//       contact_sheets: [ { index, time_range, path, frame_indices } ],
//       llm_analysis?: {
//         model, summary, key_frame_count,
//         sections: [ { title, start_time, end_time, topic, key_points } ]
//       }
//     }
//   The web-UI surface instead writes `state.json` (keys: total_frames, clusters,
//   no llm_analysis) into ~/.video2ai_jobs/<uuidhex12>/. This module drives the
//   deterministic CLI surface and lands its output in ~/.video2ai_jobs/<jobId>/
//   via `-o`, so the launcher always reads a stable `metadata.json`.
//
// Device-lightness: nothing here runs idle. Download + extract happen ON DEMAND
// only, when extractVideo() is called.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const JOBS_DIR = path.join(os.homedir(), '.video2ai_jobs');
// Where the `capabilities` python package lives (so `python3 -m capabilities…`
// resolves). Overridable for other machines.
const CAPABILITIES_HOME =
  process.env.VIDEO2AI_HOME ||
  path.join(os.homedir(), 'Documents', 'Projects', 'capabilities');
const PYTHON = process.env.VIDEO2AI_PYTHON || 'python3';

// ---------------------------------------------------------------------------
// 1. isVideoUrl
// ---------------------------------------------------------------------------

/**
 * True for a YouTube (youtube.com/watch, youtu.be) or Instagram (/p/, /reel/)
 * URL. Precise — does not match arbitrary URLs.
 * @param {string} text
 * @returns {boolean}
 */
export function isVideoUrl(text) {
  if (typeof text !== 'string') return false;
  const s = text.trim();
  if (!s) return false;

  let u;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const p = u.pathname;

  // YouTube: youtube.com/watch?v=…, m.youtube.com/watch, youtu.be/<id>
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (p === '/watch' && u.searchParams.get('v')) return true;
    if (/^\/shorts\/[\w-]+/.test(p)) return true;
    if (/^\/embed\/[\w-]+/.test(p)) return true;
    return false;
  }
  if (host === 'youtu.be') {
    return /^\/[\w-]{6,}/.test(p);
  }

  // Instagram: instagram.com/p/<id>/, /reel/<id>/, /reels/<id>/, /tv/<id>/
  if (host === 'instagram.com') {
    return /^\/(p|reel|reels|tv)\/[\w-]+/.test(p);
  }

  return false;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { ...opts });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err && err.message || err) });
      return;
    }
    child.stdout && child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr && child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + '\n' + String(err && err.message || err) });
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function newJobId() {
  return randomBytes(6).toString('hex'); // 12 hex chars, matches web.py convention
}

// ---------------------------------------------------------------------------
// 2. extractVideo
// ---------------------------------------------------------------------------

/**
 * Download a video URL and run it through the video2ai CLI, returning a
 * structured extraction.
 *
 * @param {string} url
 * @param {{ onProgress?: (p:{phase:string, pct?:number, note?:string}) => void }} [opts]
 * @returns {Promise<{
 *   ok: boolean, url: string, jobId: string|null,
 *   summary: string|null, transcript: string|null,
 *   onScreenText: string[], keyBeats: Array<object>,
 *   files: object, error: string|null,
 *   meta?: object, transcriptSegments?: Array<object>
 * }>}
 */
export async function extractVideo(url, { onProgress } = {}) {
  const emit = (phase, extra = {}) => {
    if (typeof onProgress === 'function') {
      try { onProgress({ phase, ...extra }); } catch { /* ignore */ }
    }
  };

  const fail = (error, jobId = null) => ({
    ok: false, url, jobId,
    summary: null, transcript: null, onScreenText: [], keyBeats: [],
    files: {}, error,
  });

  // --- detect ------------------------------------------------------------
  emit('detect', { pct: 0, note: 'validating url' });
  if (!isVideoUrl(url)) {
    return fail('not a supported video url (expected YouTube or Instagram post/reel)');
  }

  const jobId = newJobId();
  const jobDir = path.join(JOBS_DIR, jobId);
  const dlDir = path.join(jobDir, 'download');
  try {
    fs.mkdirSync(dlDir, { recursive: true });
  } catch (err) {
    return fail(`could not create job dir: ${err.message}`, jobId);
  }

  // --- download ----------------------------------------------------------
  emit('download', { pct: 5, note: 'yt-dlp fetching video' });
  const dl = await run('yt-dlp', [
    '--no-playlist',
    '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '-o', path.join(dlDir, '%(title).80s.%(ext)s'),
    '--print', 'after_move:filepath',
    url,
  ]);

  if (dl.code !== 0) {
    // Private / login-walled Instagram, offline, geo-block, rate-limit, etc.
    const detail = (dl.stderr || dl.stdout || '').trim().split('\n').slice(-3).join(' ');
    const hint = dl.code === -1
      ? 'yt-dlp not found on PATH'
      : `download failed: ${detail || 'unknown yt-dlp error'}`;
    return fail(hint, jobId);
  }

  const videoPath = (dl.stdout || '').trim().split('\n').filter(Boolean).pop();
  if (!videoPath || !fs.existsSync(videoPath)) {
    return fail('download completed but output file not found', jobId);
  }
  emit('download', { pct: 40, note: path.basename(videoPath) });

  // --- analyze -----------------------------------------------------------
  emit('analyze', { pct: 45, note: 'video2ai extracting frames + transcript' });

  // Prefer the installed `video2ai` console script; fall back to `python3 -m`.
  const analysis = await runVideo2ai(videoPath, jobDir);
  if (analysis.code !== 0) {
    const detail = (analysis.stderr || analysis.stdout || '').trim().split('\n').slice(-4).join(' ');
    return fail(`video2ai extraction failed: ${detail || 'unknown error'}`, jobId);
  }

  const metadataPath = path.join(jobDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    return fail('video2ai finished but metadata.json was not produced', jobId);
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (err) {
    return fail(`could not parse metadata.json: ${err.message}`, jobId);
  }

  emit('analyze', { pct: 90, note: 'mapping results' });

  const structured = mapMetadata(meta, { jobDir, videoPath, metadataPath });

  // --- done --------------------------------------------------------------
  emit('done', { pct: 100, note: 'extraction complete' });

  return {
    ok: true,
    url,
    jobId,
    ...structured,
    error: null,
  };
}

function runVideo2ai(videoPath, jobDir) {
  const args = [videoPath, '-o', jobDir, '--format', 'json'];
  // Try the console script first (works if `pip install`ed); otherwise use the
  // module form with cwd at the capabilities project root.
  const home = CAPABILITIES_HOME;
  return run(PYTHON, ['-m', 'capabilities.video2ai.cli', ...args], {
    cwd: fs.existsSync(home) ? home : process.cwd(),
    env: { ...process.env, PYTHONPATH: [home, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
  }).then((res) => {
    // If the module wasn't importable, retry the installed console script.
    if (res.code !== 0 && /No module named 'capabilities'/.test(res.stderr || '')) {
      return run('video2ai', args);
    }
    return res;
  });
}

/**
 * Map the video2ai metadata.json into the structured launcher object.
 * Fields are mapped from what video2ai ACTUALLY produces (see output.py).
 */
function mapMetadata(meta, { jobDir, videoPath, metadataPath }) {
  const llm = meta.llm_analysis || null;

  // transcript: join segment text into one readable block; keep raw segments.
  const segs = Array.isArray(meta.transcript) ? meta.transcript : [];
  const transcript = segs.length
    ? segs.map((s) => (s && s.text ? String(s.text).trim() : '')).filter(Boolean).join(' ')
    : null;

  // onScreenText: collect OCR text across frames (Apple Vision), de-duped.
  const seen = new Set();
  const onScreenText = [];
  for (const f of Array.isArray(meta.frames) ? meta.frames : []) {
    if (f && f.ocr_text) {
      const t = String(f.ocr_text).trim();
      if (t && !seen.has(t)) { seen.add(t); onScreenText.push(t); }
    }
  }

  // keyBeats: LLM section breakdown → timeline beats.
  const keyBeats = llm && Array.isArray(llm.sections)
    ? llm.sections.map((s) => ({
        title: s.title,
        start: s.start_time,
        end: s.end_time,
        topic: s.topic,
        points: Array.isArray(s.key_points) ? s.key_points : [],
      }))
    : [];

  // files: concrete artifacts on disk for the launcher to open/attach.
  const abs = (rel) => (rel ? path.resolve(jobDir, rel) : null);
  const files = {
    jobDir,
    video: videoPath,
    metadataJson: metadataPath,
    summaryMd: fs.existsSync(path.join(jobDir, 'summary.md')) ? path.join(jobDir, 'summary.md') : null,
    framesDir: fs.existsSync(path.join(jobDir, 'frames')) ? path.join(jobDir, 'frames') : null,
    contactSheets: (Array.isArray(meta.contact_sheets) ? meta.contact_sheets : [])
      .map((s) => abs(s.path))
      .filter(Boolean),
  };

  return {
    summary: llm && llm.summary ? llm.summary : null,
    transcript,
    onScreenText,
    keyBeats,
    files,
    meta: {
      source: meta.source,
      durationSeconds: meta.duration_seconds,
      durationFormatted: meta.duration_formatted,
      resolution: meta.resolution,
      fps: meta.fps,
      codec: meta.codec,
      fileSizeMb: meta.file_size_mb,
      totalFrames: meta.total_frames_extracted,
      keyFrameIndices: meta.key_frame_indices,
      model: llm ? llm.model : null,
    },
    transcriptSegments: segs,
  };
}

// ---------------------------------------------------------------------------
// 3. CLI shim — `node video2ai-pipeline.mjs <url>` prints structured JSON
// ---------------------------------------------------------------------------

const isMain = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (isMain) {
  const url = process.argv[2];
  if (!url) {
    process.stderr.write('usage: node video2ai-pipeline.mjs <youtube-or-instagram-url>\n');
    process.exit(2);
  }
  extractVideo(url, {
    onProgress: (p) => process.stderr.write(`[${p.phase}] ${p.pct ?? ''}% ${p.note ?? ''}\n`),
  }).then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.ok ? 0 : 1);
  });
}
