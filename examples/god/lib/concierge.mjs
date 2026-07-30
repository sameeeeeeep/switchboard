// The SETUP CONCIERGE — God's first job, and the one it can do BEFORE it has any AI. You can't use
// the assistant to set up the assistant, so this walk is MECHANICAL: check each readiness rung, open
// the exact setting/page, verify real state, move on. Order matters and is deliberate:
//
//   God's senses first (Screen Recording = eyes, Accessibility = hands) — so God can SEE and OPEN
//   things — THEN God drives Switchboard's own ladder (daemon → signed-in → extension). Only after
//   sign-in does the model exist; at that point God "wakes up" and the same companion becomes the
//   full assistant. Mirrors the ladder in docs/STATES.md; honest about observed vs inferred rungs.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { WebSocket } from "ws";

const CLAUDE_MARKER = join(homedir(), ".claude.json"); // oauthAccount.accountUuid ⇒ signed in (non-secret marker)
const CONTROL_PORT = Number(process.env.RELAY_PORT || 8787); // the REAL Switchboard daemon, not God's private one
const INSTALL_HUB = process.env.GOD_INSTALL_URL || "https://www.thelastprompt.ai/switchboard";

// System Settings deep links (Ventura+). Opening the exact pane is the whole "God opens things" move.
const PANE = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  a11y: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// ── observers: cheap, read-only, NON-prompting. Honest about what's truly observable. ─────────────
/** Signed in to Claude on this Mac? Reads the same non-secret marker the daemon's backend uses. */
export function signedIn() {
  try { return !!JSON.parse(readFileSync(CLAUDE_MARKER, "utf8"))?.oauthAccount?.accountUuid; }
  catch { return false; }
}
/** Does the process driving System Events (this terminal, or God's bundle) have Accessibility?
 *  A clean, non-prompting read — System Events reports it directly. */
export function accessibilityGranted() {
  const r = spawnSync("osascript", ["-e", 'tell application "System Events" to return UI elements enabled'], { encoding: "utf8" });
  return /true/i.test(r.stdout || "");
}
export function daemonUp() {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CONTROL_PORT}`);
    const done = (v) => { try { ws.terminate(); } catch { /* gone */ } res(v); };
    ws.on("open", () => done(true)); ws.on("error", () => done(false));
  });
}
/** A read-only snapshot of every observable rung (Screen Recording + extension aren't cleanly
 *  observable from a native process, so they're absent here — the concierge marks those inferred). */
export async function observe() {
  return { accessibility: accessibilityGranted(), daemon: await daemonUp(), signedIn: signedIn() };
}

const openThing = (target) => spawnSync("open", [target]);

export async function runOnboard(persona, companion) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));
  const say = (t) => companion.speak(t); // the step is scripted (no AI yet) but spoken in the persona VOICE
  const step = (n, title, tag) => console.log(`\n${bold(`${n}.`)} ${bold(title)}   ${dim(tag)}`);
  // Re-check an observable rung until it flips (or the user skips with 's').
  const until = async (check, prompt, offNote) => {
    for (let i = 0; i < 30; i++) {
      const a = await ask(`   ${y("→")} ${prompt} `);
      if (a.toLowerCase() === "s") return false;
      if (await check()) { console.log(`   ${g("✓ done")}`); return true; }
      console.log(`   ${y("• " + offNote)}`);
    }
    return false;
  };

  console.log(`\n${persona.cursor.glyph}  ${bold(persona.name)} ${dim("— setup concierge")}\n${dim(persona.greeting)}`);
  console.log(dim("I set up my own senses first (mechanical — no AI yet), then help you wake Switchboard.\n"));
  await say(`${persona.greeting} Let's get me set up first, then Switchboard.`);

  // ── God's senses ───────────────────────────────────────────────────────────────────────────────
  // 1. Eyes — Screen Recording. macOS gives no clean read of this, so it's user-confirmed (inferred).
  step(1, "My eyes — Screen Recording", "[you confirm]");
  console.log(`   ${dim("So I can see your screen. Opening the setting…")}`);
  await say("First, my eyes. I'm opening Screen Recording — switch me on there.");
  openThing(PANE.screen);
  await ask(`   ${y("→")} Enable your terminal (or God) under Screen Recording, then press ENTER`);

  // 2. Hands — Accessibility. This one IS observable via System Events.
  step(2, "My hands — Accessibility", "[observed]");
  if (accessibilityGranted()) {
    console.log(`   ${g("✓ already granted")} ${dim("— I can point and click.")}`);
  } else {
    console.log(`   ${dim("So I can point at and act on things for you. Opening the setting…")}`);
    await say("Now my hands — turn on Accessibility so I can point and click for you.");
    openThing(PANE.a11y);
    await until(async () => accessibilityGranted(), "Enable it, then ENTER (or 's' to skip)", "still off — flip the switch for your terminal");
  }

  // ── Switchboard's ladder (God now drives it) ─────────────────────────────────────────────────────
  // 3. Daemon reachable (observed).
  step(3, "Switchboard running", "[observed]");
  if (await daemonUp()) {
    console.log(`   ${g("✓ the daemon is up")} ${dim("on :" + CONTROL_PORT)}`);
  } else {
    console.log(`   ${dim("Switchboard's daemon is asleep. Open the Switchboard app from your notch.")}`);
    await say("Switchboard is asleep. Open it from the notch to wake the daemon.");
    await until(async () => daemonUp(), "Launch Switchboard, then ENTER (or 's' to skip)", "not reachable yet");
  }

  // 4. Signed in — the invisible cliff (STATES.md §4). Observed via the marker; remedied mechanically.
  step(4, "Signed in to Claude", "[observed]");
  if (signedIn()) {
    console.log(`   ${g("✓ signed in")} ${dim("— Switchboard runs on your own Claude.")}`);
  } else {
    console.log(`   ${dim("Not signed in on this Mac. I'll open Terminal and start the login…")}`);
    await say("You're not signed in to Claude. I'm opening a terminal — log in once, it's your own Claude.");
    spawnSync("osascript", ["-e", 'tell application "Terminal" to activate', "-e", 'tell application "Terminal" to do script "claude"']);
    await until(async () => signedIn(), "Finish the `claude` login, then ENTER (or 's' to skip)", "still signed out");
  }

  // 5. Browser half — the extension. A native process can't see Chrome, so this is inferred/confirmed.
  step(5, "Browser extension", "[you confirm]");
  console.log(`   ${dim("For web wrapps. Opening the install page…")}`);
  await say("Last thing — the browser extension, for web apps. I'm opening the install page.");
  openThing(INSTALL_HUB);
  await ask(`   ${y("→")} Add the extension if you want web wrapps, then ENTER`);

  // ── awake ────────────────────────────────────────────────────────────────────────────────────────
  const ready = signedIn() && (await daemonUp());
  console.log(`\n${ready ? g("✦ God is awake.") : y("• Almost — finish sign-in + daemon and the AI wakes up.")}`);
  await say(ready ? "I'm awake. Ask me anything about what's on your screen." : "Almost there. Finish signing in and I'll wake up.");
  if (ready) console.log(dim('   Try:  node god.mjs look "what should I do on this screen?"'));
  rl.close();
  return { ready, ...(await observe()) };
}
