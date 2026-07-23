/**
 * The daemon-side folder chooser: a NATIVE OS dialog, raised by the trusted process — never the
 * page. Browser pickers pick into the wrong trust domain: they hand the PAGE folder contents or
 * handles (bypassing the broker) and deliberately hide real absolute paths (which are what the
 * daemon needs). The daemon owns the filesystem, so the daemon asks. The dialog prompt names the
 * requesting origin, and the user's pick IS the path consent — a gesture no page and no model
 * output can forge or satisfy.
 */
import { execFile } from "node:child_process";

let inFlight = false; // one dialog at a time — a second request while one is open is refused

const clean = (s: string) => String(s || "").replace(/[\\"\n\r]/g, " ").slice(0, 120);

/** Returns the picked absolute path, or null when the user cancels. Throws when no native picker
 *  exists on this platform (callers fall back to the typed-path bind). */
export function pickFolderNative(origin: string, reason?: string): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.reject(new Error("no native folder picker on this platform — bind with a typed path instead"));
  if (inFlight) return Promise.reject(new Error("a folder picker is already open"));
  inFlight = true;
  const prompt = clean(origin) + " wants to open a folder" + (reason ? " — " + clean(reason) : "");
  const script = `POSIX path of (choose folder with prompt "${prompt}")`;
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", script], { timeout: 180_000 }, (err, stdout, stderr) => {
      inFlight = false;
      if (err) {
        // -128 is AppleScript's "User canceled" — a decline, not a failure
        if (/-128|cancell?ed/i.test(String(stderr) + String(err.message))) return resolve(null);
        return reject(new Error("folder picker failed: " + String(stderr || err.message).slice(0, 160)));
      }
      const path = String(stdout).trim().replace(/\/$/, "");
      resolve(path || null);
    });
  });
}
