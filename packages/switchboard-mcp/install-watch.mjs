#!/usr/bin/env node
// Install / remove the screen-watch LaunchAgent (com.relay.screenwatch). Opt-in; the watcher itself only
// acts while ~/.relay/journal-on exists and a System 1 engine is available.
//   node packages/switchboard-mcp/install-watch.mjs            # install + start
//   node packages/switchboard-mcp/install-watch.mjs --remove   # stop + uninstall
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.relay.screenwatch';
const plist = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const domain = `gui/${process.getuid()}`;
const quiet = args => { try { execFileSync('launchctl', args, { stdio: 'ignore' }); } catch {} };

quiet(['bootout', `${domain}/${LABEL}`]);
// bootout is asynchronous; bootstrapping before the old job is gone fails with "5: Input/output error".
for (let i = 0; i < 50; i++) {
  try { execFileSync('launchctl', ['print', `${domain}/${LABEL}`], { stdio: 'ignore' }); } catch { break; }
  execFileSync('sleep', ['0.2']);
}
if (process.argv.includes('--remove')) { rmSync(plist, { force: true }); console.log('screen watch removed'); process.exit(0); }

const script = join(dirname(fileURLToPath(import.meta.url)), 'watch.mjs');
const log = join(homedir(), '.relay/screen-watch.log');
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${script}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`);
execFileSync('launchctl', ['bootstrap', domain, plist]);
console.log(`screen watch installed → ${plist}\nlog: ${log}${existsSync(join(homedir(), '.relay/journal-on')) ? '' : '\n(journal is off: touch ~/.relay/journal-on to start recording)'}`);
