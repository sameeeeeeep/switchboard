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
async function speakCloned(text, onPlay) {
  const voice = selectedVoice();
  if (!voice) return false;
  try {
    // The FIRST synth after an idle period is a Metal-kernel cold-compile (~20–25s); warm ones are ~3s.
    // A 20s cap aborted exactly those cold calls → God fell back to the default `say` voice, so the
    // clone worked "sometimes." 60s lets the cold one finish (slow but CONSISTENTLY the chosen voice).
    const res = await fetch(`http://127.0.0.1:${TTS_PORT}/speak`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return false;
    const wav = join(mkdtempSync(join(tmpdir(), "god-tts-")), "v.wav");
    writeFileSync(wav, buf);
    onPlay?.();   // synthesis is done — audio is about to sound, flip the notch to "Speaking" now
    await new Promise((r) => { const p = spawn("afplay", [wav]); p.on("close", r); p.on("error", r); });
    return true;
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
