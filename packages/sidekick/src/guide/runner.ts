/**
 * guide_run IPC — the daemon half of the guided-walkthrough capability.
 *
 * The RUNTIME is native and lives in the menubar app (packages/menubar/CursorGuide.swift). The two
 * processes talk purely through ~/.relay/*.json files — that's the whole IPC:
 *
 *   1. daemon writes ~/.relay/guide-run.json   (atomic temp+rename)   — "here are the steps"
 *   2. the app WATCHES that path, picks it up, and DELETES guide-run.json on pickup
 *   3. the app floats each step's caption by the cursor; the human signals pass/fail/abort
 *   4. on finish the app writes ~/.relay/guide-result.json (unified shape for BOTH modes)
 *   5. daemon reads the result, deletes both files, returns it
 *
 * This module owns steps 1, 5, and the waiting in between. It does NOT gate consent or validate the
 * caller — that's the server's job before it calls runGuide (a guide is write-class/intrusive).
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { BYOPErrorCode, ProviderError } from "@relay/protocol";
import type { GuideResult } from "@relay/protocol";
import { RELAY_DIR } from "../config.js";

const RUN_FILE = join(RELAY_DIR, "guide-run.json");
const RESULT_FILE = join(RELAY_DIR, "guide-result.json");
const TMP_FILE = join(RELAY_DIR, "guide-run.json.tmp");

/** What we hand the native runtime — exactly the guide-run.json schema it watches for. */
export interface GuideRunFile {
  title: string;
  mode: "test" | "tour";
  steps: { id: string; text: string; hint?: string }[];
}

export interface RunGuideOptions {
  /** How long to wait for the app to PICK UP (delete) guide-run.json before deciding it isn't
   *  running. Short — a running watcher consumes the file in well under a second. */
  pickupMs?: number;
  /** Overall ceiling waiting for the human to finish the walkthrough. Generous (a person runs it). */
  totalMs?: number;
  /** Poll interval for the file watch. */
  pollMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function fileExists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

/**
 * Write the run, wait for the native runtime to complete it, return the unified result. Throws
 * ProviderError(NO_GUIDE_RUNTIME) when the app never picks up the run (not running) or when the
 * human never finishes within `totalMs`. Always cleans up ~/.relay/guide-run.json on the way out.
 */
export async function runGuide(guide: GuideRunFile, opts: RunGuideOptions = {}): Promise<GuideResult> {
  const pickupMs = opts.pickupMs ?? 10_000;
  const totalMs = opts.totalMs ?? 10 * 60_000;
  const pollMs = opts.pollMs ?? 200;

  // Start clean: a stale result from a crashed prior run must never be mistaken for THIS run's
  // outcome (the make-it-loud lesson — never return the wrong data as if it were fresh).
  await fs.mkdir(RELAY_DIR, { recursive: true }).catch(() => {});
  await fs.rm(RESULT_FILE, { force: true }).catch(() => {});
  await fs.rm(RUN_FILE, { force: true }).catch(() => {});

  // Atomic publish: write the temp then rename, so the watcher never sees a half-written file.
  await fs.writeFile(TMP_FILE, JSON.stringify(guide), "utf8");
  await fs.rename(TMP_FILE, RUN_FILE);

  try {
    // Phase 1 — pickup detection. The app deletes guide-run.json when it consumes it; if it's still
    // there after pickupMs, no runtime is watching ⇒ the app isn't running.
    const pickupStart = Date.now();
    let pickedUp = false;
    while (Date.now() - pickupStart < pickupMs) {
      // A very fast app could finish before we next poll — a present result also proves pickup.
      if (!(await fileExists(RUN_FILE)) || (await fileExists(RESULT_FILE))) { pickedUp = true; break; }
      await sleep(pollMs);
    }
    if (!pickedUp) {
      throw new ProviderError(
        BYOPErrorCode.NO_GUIDE_RUNTIME,
        "the guide runtime didn't pick up the run — open the Switchboard app and try again",
      );
    }

    // Phase 2 — wait for the human to finish. The app writes guide-result.json at the end.
    const totalStart = Date.now();
    while (Date.now() - totalStart < totalMs) {
      if (await fileExists(RESULT_FILE)) {
        const raw = await fs.readFile(RESULT_FILE, "utf8");
        return JSON.parse(raw) as GuideResult;
      }
      await sleep(pollMs);
    }
    throw new ProviderError(
      BYOPErrorCode.NO_GUIDE_RUNTIME,
      "the guide timed out waiting for the walkthrough to finish",
    );
  } finally {
    // Whatever happened, don't leave IPC files lying around to poison the next run.
    await fs.rm(RESULT_FILE, { force: true }).catch(() => {});
    await fs.rm(RUN_FILE, { force: true }).catch(() => {});
    await fs.rm(TMP_FILE, { force: true }).catch(() => {});
  }
}
