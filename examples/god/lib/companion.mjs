// The COMPANION — the visible + audible body of a God. This is the seam people customise
// (persona.cursor, persona.voice) AND the seam a native overlay would replace: `point()` gets
// the same inputs whether it draws a terminal glyph now or moves a borderless always-on-top
// NSWindow later. Swapping the body never touches the pipeline.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const COLOR = { green: 32, cyan: 36, magenta: 35, yellow: 33, red: 31, blue: 34, white: 37 };
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// A CLONED voice (Pocket TTS): if the user picked one in Settings (~/.relay/voices/selected), render
// the text through the local voice service and play it. On-device, no cloud. Returns false on ANY
// hiccup (no selection, service down, error) so the caller falls back to `say` — a God never goes mute.
const TTS_PORT = process.env.GOD_TTS_PORT || "7897";
function selectedVoice() {
  try {
    const f = join(homedir(), ".relay", "voices", "selected");
    return existsSync(f) ? readFileSync(f, "utf8").trim() : "";
  } catch { return ""; }
}
// Split a reply into speakable chunks (roughly sentences) so we can synth + play them in a PIPELINE
// instead of waiting for the whole utterance. Whole-utterance synth means time-to-first-audio scales
// with reply length (a 2–3 sentence reply = ~7–8s of dead air before the first sound); per-sentence
// streaming makes it ~one sentence (~0.4–1s) no matter how long the reply. Tiny fragments are merged
// into their neighbour so we never synth a lone "OK." (choppy, and the per-call overhead dominates).
function splitSentences(text) {
  const raw = (text.match(/[^.!?\n]+[.!?]+|[^.!?\n]+$/g) || [text]).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of raw) {
    if (out.length && (out[out.length - 1].length < 24 || p.length < 24)) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out.length ? out : [text];
}

// Synthesise ONE chunk → a temp wav path (or null on any hiccup). 60s cap: the first synth after an
// idle period can still be a Metal-kernel cold-compile (~20–25s) if keep-warm has lapsed; a shorter
// cap would abort exactly those and drop God to the default `say` voice, so the clone worked "sometimes."
async function synthChunk(voice, text) {
  const res = await fetch(`http://127.0.0.1:${TTS_PORT}/speak`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  const wav = join(mkdtempSync(join(tmpdir(), "god-tts-")), "v.wav");
  writeFileSync(wav, buf);
  return wav;
}

async function speakCloned(text, onPlay) {
  const voice = selectedVoice();
  if (!voice) return false;
  try {
    const chunks = splitSentences(text);
    let started = false;
    // Pipeline: keep ONE synth in flight ahead of playback. While chunk i plays (audio-seconds of
    // wall time), chunk i+1 is already synthesising on the server's GPU thread — synth runs faster
    // than real-time, so the next wav is ready before the current one finishes sounding.
    let pending = synthChunk(voice, chunks[0]);
    for (let i = 0; i < chunks.length; i++) {
      const wav = await pending;
      pending = i + 1 < chunks.length ? synthChunk(voice, chunks[i + 1]) : null;
      if (!wav) {
        if (!started) return false;   // first chunk failed → let the caller fall back to `say` for the whole line
        continue;                     // a later chunk failed → we're already committed to the clone; skip the gap
      }
      if (!started) { onPlay?.(); started = true; }   // first real audio is about to sound → flip the notch
      await new Promise((r) => { const p = spawn("afplay", [wav]); p.on("close", r); p.on("error", r); });
    }
    return started;
  } catch { return false; }
}

// A god's voice: render the persona voice, drench it in cathedral reverb (ffmpeg multi-tap echo),
// play it back. Rate-agnostic (no pitch math). Returns false if ffmpeg/afplay aren't around → plain `say`.
async function speakDivine(voice, text, onPlay) {
  try {
    const dir = mkdtempSync(join(tmpdir(), "god-voice-"));
    const aiff = join(dir, "v.aiff"), wav = join(dir, "v.wav");
    if (spawnSync("say", ["-v", voice, "-o", aiff, text]).status !== 0) return false;
    // A SUBTLE room, not a canyon: one short quiet tap. Multi-tap long delays read as "two voices".
    const fx = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", aiff,
      "-af", "aecho=0.9:0.82:26:0.15", wav]);
    if (fx.status !== 0) return false;
    onPlay?.();   // rendered — about to sound
    await new Promise((res) => { const p = spawn("afplay", [wav]); p.on("close", res); p.on("error", res); });
    return true;
  } catch { return false; }
}

export function makeCompanion(persona) {
  const code = COLOR[persona.cursor.color] ?? 37;
  const tint = (s) => `\x1b[${code}m${s}\x1b[0m`;
  return {
    /** Where the hand points. Terminal proof: glyph + label + coord (image-space). Native slice:
     *  move the overlay window to the mapped screen point — identical inputs, pixels instead of text. */
    point({ x, y, label }, imgW, imgH) {
      console.log(
        `\n   ${tint(persona.cursor.glyph)}  ${tint(persona.name + " points")} → ` +
          `${tint(label || persona.cursor.label)}   ${dim(`@ (${x}, ${y}) in ${imgW}×${imgH}`)}`,
      );
    },

    /** The voice. Persona-scoped so a different God literally SOUNDS different. macOS `say -v`
     *  now; the daemon's `claude_speak` (cloned / connector voices) is the drop-in upgrade. Falls
     *  back to the default voice if the persona's voice isn't installed — a God never goes mute. */
    // `onPlay` fires the instant audio actually begins — AFTER synthesis (which can be 3–20s for a
    // cloned voice). The caller uses it to flip the notch from "Almost done…" to "Speaking" only when
    // there's real sound, so the pill never says "Speaking" over a silent synth wait.
    async speak(text, onPlay) {
      if (!text || process.env.GOD_MUTE) return; // GOD_MUTE: skip audio (tests, quiet rooms)
      if (await speakCloned(text, onPlay)) return;       // a Settings-selected CLONED voice wins if it's up
      const divine = persona.voiceFx === "divine" || process.env.GOD_DIVINE === "1";
      if (divine && (await speakDivine(persona.voice, text, onPlay))) return; // reverb-drenched god's voice
      const say = (voiceArgs) =>
        new Promise((res) => {
          onPlay?.();   // `say` streams as it speaks — synthesis + playback are one step
          const p = spawn("say", [...voiceArgs, text]);
          p.on("close", (c) => res(c === 0));
          p.on("error", () => res(false));
        });
      if (!(await say(["-v", persona.voice]))) await say([]);
    },
  };
}
