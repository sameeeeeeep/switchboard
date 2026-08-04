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

/** A pixel coordinate in the captured screenshot's space (see `GuideRunFile.shot`). */
export interface Point {
  x: number;
  y: number;
}

/**
 * A "done" condition the native runtime evaluates LOCALLY to auto-advance a teach step (AX first,
 * one Vision OCR only when a leaf needs on-screen text). Composable via `any`/`all`; leaves name a
 * `kind`. The daemon only serializes this — it never evaluates it — so the union stays open-ended:
 * an unknown `kind` is simply ignored by an older runtime (forward-compatible), and the human's
 * manual advance (fn→) is always available regardless.
 */
export type Predicate =
  | { any: Predicate[] }
  | { all: Predicate[] }
  | { kind: "app-frontmost"; bundleId: string }
  | { kind: "window-title-matches"; pattern: string; mode: "contains" | "regex" | "equals" }
  | { kind: "url-host-is"; host: string; pathContains?: string }
  | { kind: "field-focused" }
  | { kind: "field-non-empty" }
  | { kind: "field-contains"; text?: string; regex?: string }
  | { kind: "element-exists"; role: string; titleContains?: string; enabled?: boolean }
  | { kind: "checkbox-state"; titleContains: string; checked: boolean }
  | { kind: "on-screen-text-appeared"; text?: string; regex?: string; region?: unknown };
/** Alias kept readable at call sites — a step's `doneWhen` is a {@link Predicate}. */
export type DoneWhen = Predicate;

/**
 * One step handed to the native runtime. `id`/`text`/`hint` are the original tour/test fields; the
 * rest are the additive "teach" fields (all optional, so existing runs stay valid):
 *   - `say`   — spoken aloud when the step is shown (local TTS).
 *   - `point` — pixel coords (in `shot` space) to anchor/point the cursor chip at a UI element.
 *   - `copy`  — non-secret helper text pre-loaded onto the clipboard for the human to paste.
 *   - `hold`  — ms to keep the step visible before auto-advancing (a dwell, not a verdict).
 *   - `doneWhen` — a {@link Predicate} the runtime checks locally to auto-advance.
 */
export interface GuideStepFile {
  id: string;
  /** The caption shown by the cursor. Alias accepted on input: `instruction`. */
  text: string;
  /** Where to look / what "done" looks like. Alias accepted on input: `expect`. */
  hint?: string;
  /** Spoken aloud when this step is shown (on-device TTS). */
  say?: string;
  /** UI-element anchor in captured-screenshot pixel space (declare the space via `shot`). */
  point?: Point;
  /** Non-secret helper content pre-loaded onto the clipboard for this step (see `autoClipboard`). */
  copy?: string;
  /** Milliseconds to keep the step visible before auto-advancing. */
  hold?: number;
  /** Local auto-advance condition (AX first, Vision OCR only when needed). */
  doneWhen?: DoneWhen;
}

/**
 * What we hand the native runtime — exactly the guide-run.json schema it watches for.
 *
 * `shot`/`autoClipboard` and the `"teach"` mode are additive; a run that omits them is a plain
 * tour/test run exactly as before.
 */
export interface GuideRunFile {
  title: string;
  mode: "teach" | "test" | "tour";
  /**
   * The screenshot space every step's `point` is expressed in — capture ONE shot at plan time, ask
   * for [POINT:x,y] tags, and declare its pixel size + which screen it came from. Teach mode only.
   */
  shot?: { w: number; h: number; screen: number };
  /**
   * When true, each step's `copy` pre-loads the clipboard as the step is shown; the user's original
   * clipboard is preserved and restored when the run ends. Teach-mode form-fill.
   */
  autoClipboard?: boolean;
  steps: GuideStepFile[];
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
