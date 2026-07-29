#!/usr/bin/env node
/**
 * Flow's local STT adapter — the `RELAY_STT_CMD` the daemon runs. Takes ONE argument, an audio
 * file path, and prints the transcript to stdout. Nothing here is Flow-specific; it just bridges
 * the generic command contract to OpenAI's local `whisper` CLI (fully on-device, no cloud).
 *
 *   RELAY_STT_CMD="node examples/flow/whisper-stt.mjs"
 *
 * Env: FLOW_WHISPER_MODEL (default "tiny"), FLOW_WHISPER_LANG (default "en").
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const audio = process.argv[2];
if (!audio) { console.error("usage: whisper-stt.mjs <audiofile>"); process.exit(2); }

const model = process.env.FLOW_WHISPER_MODEL || "tiny";
const lang = process.env.FLOW_WHISPER_LANG || "en";
const outDir = mkdtempSync(join(tmpdir(), "flow-whisper-"));

// whisper writes <basename>.txt into --output_dir; --fp16 False keeps it CPU-friendly & silent-ish.
const res = spawnSync("whisper", [
  audio, "--model", model, "--language", lang,
  "--output_format", "txt", "--output_dir", outDir, "--fp16", "False", "--verbose", "False",
], { stdio: ["ignore", "ignore", "ignore"] });

try {
  if (res.status !== 0) throw new Error(`whisper exited ${res.status}`);
  const txt = readdirSync(outDir).find((f) => f.endsWith(".txt"));
  if (!txt) throw new Error("whisper produced no transcript");
  process.stdout.write(readFileSync(join(outDir, txt), "utf8").trim());
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(1);
} finally {
  try { rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
