/**
 * Install the sidekick as an always-on background service (macOS LaunchAgent). After this runs
 * once, the daemon starts on login, restarts if it crashes, and you never run `npm run sidekick`
 * again — the extension side panel is your only UI. This is the dev-stage stand-in for the eventual
 * double-click companion app; the LaunchAgent it installs is exactly the engine that app will wrap.
 *
 * Run:  node packages/sidekick/scripts/install-daemon.mjs
 * Undo: node packages/sidekick/scripts/install-daemon.mjs --uninstall
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

if (platform() !== "darwin") {
  console.error("This installer targets macOS (LaunchAgent). On Linux use a systemd --user unit; on Windows, a Startup task. Ask and I'll add those.");
  process.exit(1);
}

const LABEL = "com.relay.sidekick";
const LA_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST = join(LA_DIR, `${LABEL}.plist`);
const uninstall = process.argv.includes("--uninstall");

function launchctl(...args) {
  try { return execFileSync("launchctl", args, { stdio: "pipe" }).toString(); }
  catch (e) { return (e.stdout?.toString() || "") + (e.stderr?.toString() || ""); }
}

if (uninstall) {
  launchctl("unload", PLIST);
  if (existsSync(PLIST)) rmSync(PLIST);
  console.error("✓ Relay sidekick uninstalled (LaunchAgent removed). The daemon will not start on login.");
  process.exit(0);
}

// The entry point + node to run. Resolve absolute paths so the LaunchAgent works from any cwd.
const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "dist", "index.js");
if (!existsSync(entry)) {
  console.error(`Daemon not built (${entry} missing). Run:  npm run build -w @relay/sidekick`);
  process.exit(1);
}
const node = process.execPath;
const relayDir = join(homedir(), ".relay");
mkdirSync(relayDir, { recursive: true });
const log = join(relayDir, "sidekick.log");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${entry}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>${homedir()}</string>
  </dict>
</dict>
</plist>
`;

mkdirSync(LA_DIR, { recursive: true });
launchctl("unload", PLIST); // idempotent: replace any prior install
writeFileSync(PLIST, plist);
launchctl("load", PLIST);

// Give it a moment, then surface the pairing token so the user can pair the extension.
setTimeout(() => {
  const tokenFile = join(relayDir, "pairing-token");
  const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "(will appear at ~/.relay/pairing-token once the daemon boots)";
  console.error(`\n✓ Relay sidekick installed as a background service (${LABEL}).`);
  console.error(`  • Starts on login, restarts on crash. You never run 'npm run sidekick' again.`);
  console.error(`  • Logs: ${log}`);
  console.error(`  • Pairing token (paste into the Relay side panel once): ${token}`);
  console.error(`\n  Uninstall anytime:  node packages/sidekick/scripts/install-daemon.mjs --uninstall`);
}, 800);
