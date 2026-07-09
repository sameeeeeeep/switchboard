/**
 * Build the publishable npm package for the sidekick: `@thelastprompt/switchboard`.
 *
 * Strategy: bundle ONLY the workspace dep (@relay/protocol) into a single cli.js; keep the four
 * public deps (@anthropic-ai/claude-agent-sdk, @modelcontextprotocol/sdk, ws, zod) as real npm
 * dependencies — the agent SDK is too big/dynamic to inline safely. Output: npm-dist/ containing
 * cli.js + a generated publish manifest + README. Publish: cd npm-dist && npm publish --access public.
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const OUT = join(PKG, "npm-dist");
const VERSION = process.env.NPM_VERSION || "0.1.2"; // track the GitHub release train

const src = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
const EXTERNAL = ["@anthropic-ai/claude-agent-sdk", "@modelcontextprotocol/sdk", "ws", "zod"];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(PKG, "src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: EXTERNAL,
  outfile: join(OUT, "cli.js"),
  // no banner: src/index.ts carries its own shebang and esbuild preserves it on line 1
  logLevel: "info",
});
chmodSync(join(OUT, "cli.js"), 0o755);

const deps = Object.fromEntries(EXTERNAL.map((d) => [d, src.dependencies[d]]));
writeFileSync(join(OUT, "package.json"), JSON.stringify({
  name: "@thelastprompt/switchboard",
  version: VERSION,
  description: "Switchboard sidekick — the local daemon that lends your own Claude, tools, context and data to any wrapp, under per-site consent. MetaMask, but for AI.",
  bin: { switchboard: "./cli.js" },
  type: "module",
  engines: { node: ">=20" },
  dependencies: deps,
  license: "MIT",
  homepage: "https://thelastprompt.ai/switchboard/",
  repository: { type: "git", url: "git+https://github.com/sameeeeeeep/switchboard.git" },
  bugs: { url: "https://github.com/sameeeeeeep/switchboard/issues" },
  keywords: ["ai", "claude", "byoai", "consent", "broker", "mcp", "switchboard", "wrapp"],
  files: ["cli.js", "README.md"],
}, null, 2));

writeFileSync(join(OUT, "README.md"), `# @thelastprompt/switchboard

The **Switchboard sidekick** — a local daemon that lends your own Claude, tools, context and data
to any [wrapp](https://thelastprompt.ai/switchboard/), under per-site consent. Your machine is the
backend; apps are pure frontends.

## Run

\`\`\`bash
npx @thelastprompt/switchboard
\`\`\`

It prints a **pairing token** — paste it into the
[Switchboard browser extension](https://thelastprompt.ai/switchboard/#install), then open a wrapp
and click Connect.

**Requires:** Node ≥ 20 and a signed-in [Claude Code](https://claude.com/claude-code) CLI (the
daemon routes model calls through *your* Claude — no API key, no separate bill).

Everything stays local: grants, audit log, and app storage live in \`~/.relay\` on your machine.
No telemetry, no cloud. [Privacy](https://thelastprompt.ai/switchboard/privacy.html) ·
[Source (MIT)](https://github.com/sameeeeeeep/switchboard)
`);

console.error(`[npm] built ${OUT} → @thelastprompt/switchboard@${VERSION}`);
