import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Local text-to-speech — the daemon as ORCHESTRATOR of local models, not just Claude + connectors.
 * Two on-device paths, no cloud call, no credits:
 *
 *   1. A configured local TTS server (RELAY_LOCAL_TTS_URL) speaking the OpenAI /v1/audio/speech
 *      shape — e.g. openedai-speech, Kokoro, Piper behind an OpenAI-compatible gateway. This is the
 *      general "bring your own local model" path.
 *   2. The OS engine — macOS `say`, present on every Mac — as a zero-setup fallback.
 *
 * Returns audio as a data: URL the page can play directly. The bytes never leave the machine.
 */

const SERVER_URL = process.env.RELAY_LOCAL_TTS_URL || "";
const SERVER_MODEL = process.env.RELAY_LOCAL_TTS_MODEL || "tts-1";
const SERVER_VOICE = process.env.RELAY_LOCAL_TTS_VOICE || "alloy";
const isMac = process.platform === "darwin";

export function ttsAvailable(): boolean { return !!SERVER_URL || isMac; }

/** A short, non-authoritative list of local voices for the app to offer. macOS ships these. */
export function ttsVoices(): string[] {
  if (SERVER_URL) return [SERVER_VOICE];
  if (isMac) return ["Samantha", "Alex", "Daniel", "Karen", "Moira"];
  return [];
}

export interface SpokenAudio { audio: string; backend: string; voice?: string }

export async function localTTS(text: string, voice?: string): Promise<SpokenAudio> {
  const clean = (text || "").trim();
  if (!clean) throw new Error("nothing to speak");
  if (clean.length > 4000) throw new Error("text too long"); // keep synthesis bounded
  if (SERVER_URL) return viaServer(clean, voice);
  if (isMac) return viaSay(clean, voice);
  throw new Error("no local TTS available");
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
