import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDictionaryPrompt } from "./dictionary.js";

/**
 * Local speech-to-text — the mirror of media/speech.ts. The daemon as ORCHESTRATOR of local
 * models, not just Claude + connectors. Audio in, text out, on-device, no cloud call, no credits:
 *
 *   1. A configured local STT server (RELAY_LOCAL_STT_URL) speaking the OpenAI
 *      /v1/audio/transcriptions shape — e.g. faster-whisper-server, whisper.cpp behind an
 *      OpenAI-compatible gateway. The general "bring your own local model" path.
 *   2. A configured whisper.cpp / whisper CLI binary (RELAY_WHISPER_BIN) as a no-gateway fallback.
 *
 * Unlike TTS there is no universal OS engine, so if neither is configured STT is simply
 * unavailable and the daemon fails closed with a clear error (exactly like TTS on a non-Mac).
 * The audio bytes never leave the machine.
 */

const SERVER_URL = process.env.RELAY_LOCAL_STT_URL || "";
const SERVER_MODEL = process.env.RELAY_LOCAL_STT_MODEL || "whisper-1";
const WHISPER_BIN = process.env.RELAY_WHISPER_BIN || "";
const WHISPER_MODEL = process.env.RELAY_WHISPER_MODEL || ""; // path to a ggml model for the CLI
/** Generic escape hatch: any command that takes an audio file path as its LAST arg and prints the
 *  transcript to stdout. Space-split into argv (no shell), the temp wav path appended. Lets the
 *  user plug in ANY local recognizer — Python whisper, Apple's Speech framework, etc. */
const STT_CMD = process.env.RELAY_STT_CMD || "";

export function sttAvailable(): boolean { return !!SERVER_URL || !!WHISPER_BIN || !!STT_CMD; }

export interface Transcript { text: string; backend: string }

/** Parse a "data:audio/…;base64,…" URL into (mime, bytes). Throws on anything else — we only ever
 *  accept inline data URLs so audio never travels by reference off the machine. */
function decodeDataUrl(dataUrl: string): { mime: string; buf: Buffer } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!m) throw new Error("audio must be a data: URL");
  const mime = m[1] || "audio/wav";
  const payload = m[3] ?? "";
  const buf = m[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
  if (!buf.length) throw new Error("empty audio");
  if (buf.length > 25 * 1024 * 1024) throw new Error("audio too large"); // keep recognition bounded
  return { mime, buf };
}

const EXT_OF: Record<string, string> = {
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/m4a": "m4a",
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/flac": "flac",
};

export async function localSTT(audioDataUrl: string, language?: string): Promise<Transcript> {
  const { mime, buf } = decodeDataUrl(audioDataUrl);
  if (SERVER_URL) return viaServer(buf, mime, language);
  if (WHISPER_BIN) return viaWhisperCli(buf, mime, language);
  if (STT_CMD) return viaCommand(buf, mime);
  throw new Error("no local STT available");
}

/** Generic command backend: write the audio to a temp file, run `<STT_CMD> <file>`, take stdout. */
function viaCommand(buf: Buffer, mime: string): Promise<Transcript> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "relay-stt-"));
    const inPath = join(dir, `audio.${EXT_OF[mime] || "wav"}`);
    const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };
    try { writeFileSync(inPath, buf); } catch (e) { cleanup(); reject(e as Error); return; }
    const parts = STT_CMD.split(/\s+/).filter(Boolean);
    const bin = parts[0];
    if (!bin) { cleanup(); reject(new Error("empty RELAY_STT_CMD")); return; }
    const args = [...parts.slice(1), inPath];
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", (e) => { cleanup(); reject(e); });
    proc.on("close", (code) => {
      cleanup();
      if (code !== 0) { reject(new Error(`stt command exited ${code}`)); return; }
      resolve({ text: out.trim(), backend: "local-command" });
    });
  });
}

/** OpenAI-compatible local transcription server → text. */
async function viaServer(buf: Buffer, mime: string, language?: string): Promise<Transcript> {
  const url = SERVER_URL.replace(/\/$/, "") + "/v1/audio/transcriptions";
  const form = new FormData();
  form.append("model", SERVER_MODEL);
  if (language) form.append("language", language);
  const prompt = readDictionaryPrompt();   // same dictionary; OpenAI transcription shape takes `prompt`
  if (prompt) form.append("prompt", prompt);
  form.append("file", new Blob([buf], { type: mime }), `audio.${EXT_OF[mime] || "wav"}`);
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error(`local stt server ${res.status}`);
  const data: any = await res.json().catch(() => ({}));
  const text = typeof data?.text === "string" ? data.text : "";
  return { text: text.trim(), backend: "local-server" };
}

/** whisper.cpp / whisper CLI → text. Writes the audio to a temp file (passed as an arg, never a
 *  shell), runs the binary, reads stdout. Fully on-device. */
function viaWhisperCli(buf: Buffer, mime: string, language?: string): Promise<Transcript> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "relay-stt-"));
    const inPath = join(dir, `audio.${EXT_OF[mime] || "wav"}`);
    const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };
    try { writeFileSync(inPath, buf); } catch (e) { cleanup(); reject(e as Error); return; }
    // whisper.cpp: `-f <file> -otxt -np` prints the transcript to stdout with no progress noise.
    const args: string[] = ["-f", inPath, "-np", "-nt"];
    if (WHISPER_MODEL) args.push("-m", WHISPER_MODEL);
    if (language) args.push("-l", language);
    // The DICTIONARY: bias recognition toward the user's names/jargon. --carry-initial-prompt keeps
    // the glossary in context on every chunk so it doesn't fade on longer audio.
    const prompt = readDictionaryPrompt();
    if (prompt) args.push("--prompt", prompt, "--carry-initial-prompt");
    const proc = spawn(WHISPER_BIN, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", (e) => { cleanup(); reject(e); });
    proc.on("close", (code) => {
      cleanup();
      if (code !== 0) { reject(new Error(`whisper exited ${code}`)); return; }
      resolve({ text: out.trim(), backend: "whisper-cli" });
    });
  });
}
