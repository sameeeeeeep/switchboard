import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Local text-to-speech — the daemon as ORCHESTRATOR of local models, not just Claude + connectors.
 * On-device paths, no cloud call, no credits, tried in order of "most like the user":
 *
 *   0. God's CLONED voice — if the opt-in voice engine (com.relay.godtts, :7897) is installed and a
 *      voice is selected in ~/.relay/voices, speak that. Auto-DISCOVERED, no config — same shape as
 *      STT auto-detecting whisper. This is how `claude_speak` sounds like *you* for any wrapp.
 *   1. A configured local TTS server (RELAY_LOCAL_TTS_URL) speaking the OpenAI /v1/audio/speech
 *      shape — e.g. openedai-speech, Kokoro, Piper behind an OpenAI-compatible gateway. The general
 *      "bring your own local model" path.
 *   2. The OS engine — macOS `say`, present on every Mac — as a zero-setup fallback.
 *
 * Returns audio as a data: URL the page can play directly. The bytes never leave the machine.
 */

const SERVER_URL = process.env.RELAY_LOCAL_TTS_URL || "";
const SERVER_MODEL = process.env.RELAY_LOCAL_TTS_MODEL || "tts-1";
const SERVER_VOICE = process.env.RELAY_LOCAL_TTS_VOICE || "alloy";
const isMac = process.platform === "darwin";

// God's on-demand voice engine (see examples/god/tts). Availability is a filesystem fact (a cloned
// sample present); reachability is checked lazily at synth time (the LaunchAgent may be warming).
const GOD_TTS_URL = `http://127.0.0.1:${process.env.GOD_TTS_PORT || "7897"}`;
const VOICES_DIR = join(homedir(), ".relay", "voices");

function godVoices(): string[] {
  try {
    return readdirSync(VOICES_DIR)
      .filter((f) => f.endsWith(".wav") && !f.endsWith("-full.wav"))
      .map((f) => f.slice(0, -4));
  } catch { return []; }
}
function godSelected(): string {
  try { return readFileSync(join(VOICES_DIR, "selected"), "utf8").trim(); } catch { return ""; }
}
/** Which clone should this request speak? "" = none. An explicit clone name wins; otherwise the
 *  Settings-selected clone answers an unspecified voice. A non-clone `voice` (e.g. "Samantha") → say. */
function pickClone(voice?: string): string {
  const names = godVoices();
  if (!names.length) return "";
  if (voice) return names.includes(voice) ? voice : "";
  const sel = godSelected();
  return sel && names.includes(sel) ? sel : "";
}

export function ttsAvailable(): boolean { return godVoices().length > 0 || !!SERVER_URL || isMac; }

/** A short, non-authoritative list of local voices for the app to offer — cloned voices first. */
export function ttsVoices(): string[] {
  const base = SERVER_URL ? [SERVER_VOICE] : isMac ? ["Samantha", "Alex", "Daniel", "Karen", "Moira"] : [];
  return [...godVoices(), ...base];
}

export interface SpokenAudio { audio: string; backend: string; voice?: string }

export async function localTTS(text: string, voice?: string): Promise<SpokenAudio> {
  const clean = (text || "").trim();
  if (!clean) throw new Error("nothing to speak");
  if (clean.length > 4000) throw new Error("text too long"); // keep synthesis bounded
  const clone = pickClone(voice);
  if (clone) {
    try { return await viaGod(clone, clean); }
    catch { /* engine warming or down → fall through so a voice still comes out */ }
  }
  if (SERVER_URL) return viaServer(clean, voice);
  if (isMac) return viaSay(clean, voice);
  throw new Error("no local TTS available");
}

/** God's cloned-voice service (examples/god/tts/god-tts-server.py) → wav bytes. On-device, MLX. */
async function viaGod(voice: string, text: string): Promise<SpokenAudio> {
  const res = await fetch(`${GOD_TTS_URL}/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice }),
    signal: AbortSignal.timeout(30_000), // synth is ~1s warm but the first call after a restart can be ~10s
  });
  if (!res.ok) throw new Error(`god tts ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("god tts empty");
  return { audio: `data:audio/wav;base64,${buf.toString("base64")}`, backend: "god-clone", voice };
}

/** OpenAI-compatible local speech server → wav bytes. */
async function viaServer(text: string, voice?: string): Promise<SpokenAudio> {
  const url = SERVER_URL.replace(/\/$/, "") + "/v1/audio/speech";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: SERVER_MODEL, input: text, voice: voice || SERVER_VOICE, response_format: "wav" }),
  });
  if (!res.ok) throw new Error(`local tts server ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { audio: `data:audio/wav;base64,${buf.toString("base64")}`, backend: "local-server", voice: voice || SERVER_VOICE };
}

/** macOS `say` → a real WAVE file, read back as a data URL. Fully on-device. */
function viaSay(text: string, voice?: string): Promise<SpokenAudio> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "relay-tts-"));
    const out = join(dir, "voice.wav");
    const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };
    // WAVE / 16-bit LE / 22.05kHz — small and browser-playable. Text is passed as an arg (not shell).
    const args = ["-o", out, "--file-format=WAVE", "--data-format=LEI16@22050"];
    if (voice) args.push("-v", voice);
    args.push(text);
    const proc = spawn("say", args, { stdio: "ignore" });
    proc.on("error", (e) => { cleanup(); reject(e); });
    proc.on("close", (code) => {
      if (code !== 0) { cleanup(); reject(new Error(`say exited ${code}`)); return; }
      try {
        const buf = readFileSync(out);
        resolve({ audio: `data:audio/wav;base64,${buf.toString("base64")}`, backend: "macos-say", voice });
      } catch (e) { reject(e as Error); } finally { cleanup(); }
    });
  });
}
