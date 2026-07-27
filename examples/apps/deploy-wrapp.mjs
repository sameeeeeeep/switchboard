#!/usr/bin/env node
/**
 * deploy-wrapp — ship one venture's static wrapp to its own GitHub Pages repo at
 * `<slug>.sameep.ai`. Automates the recipe in docs/PORTING-AND-DEPLOY.md (repo-per-idea → Pages →
 * custom subdomain), so "an idea becomes a live subdomain product" is one command.
 *
 *   node deploy-wrapp.mjs <slug> <src>            # DRY RUN — prints the exact plan, touches nothing
 *   node deploy-wrapp.mjs <slug> <src> --go       # actually create the repo, push, enable Pages
 *
 * <src> is either a built dir (must contain index.html) or a single .html file (the generated wrapp).
 * Options: --owner <gh-user-or-org> (else read from `gh api user`), --domain <root> (default sameep.ai).
 *
 * SAFE BY DEFAULT: dry-run unless --go. Creating a public repo on your GitHub and publishing is an
 * outward, account-touching action — it only happens when YOU pass --go, after `gh auth login`. This
 * script never sends anything and never touches DNS (it prints the one CNAME record for you to add).
 * All shell-outs use execFileSync with argument arrays — no shell string interpolation.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, cpSync, writeFileSync, statSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--go") flags.go = true;
  else if (args[i] === "--owner") flags.owner = args[++i];
  else if (args[i] === "--domain") flags.domain = args[++i];
  else pos.push(args[i]);
}
const [slug, src] = pos;
const DOMAIN = flags.domain || "sameep.ai";
const DRY = !flags.go;

if (!slug || !src) { console.error("usage: node deploy-wrapp.mjs <slug|@> <src-dir-or-html> [--go] [--owner X] [--domain sameep.ai]\n  (`@` deploys to the apex domain itself, e.g. sameep.ai — the OS at the root)"); process.exit(1); }
// APEX: `@`, `.`, or the domain itself → serve at the root (sameep.ai), which needs A/AAAA records,
// not a CNAME. Otherwise it's a subdomain (<slug>.sameep.ai) reachable via a CNAME.
const APEX = slug === "@" || slug === "." || slug === DOMAIN;
// slug and owner are validated because they land in repo paths + a public hostname — reject anything
// that isn't a plain name, so nothing odd can reach the git/gh calls.
if (!APEX && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug)) { console.error(`bad slug "${slug}" — lowercase letters, digits, hyphens only (it becomes ${slug}.${DOMAIN}), or "@" for the apex.`); process.exit(1); }
if (flags.owner && !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(flags.owner)) { console.error(`bad --owner "${flags.owner}" — a GitHub user/org name.`); process.exit(1); }
if (!existsSync(src)) { console.error(`source not found: ${src}`); process.exit(1); }

const host = APEX ? DOMAIN : `${slug}.${DOMAIN}`;
const repo = APEX ? DOMAIN : slug; // repo name; a project repo may claim the apex custom domain
/** run a binary with an ARG ARRAY (no shell). Dry-run prints a readable line; --go executes. */
function run(bin, argv, opts = {}) {
  if (DRY) { console.log("  $ " + bin + " " + argv.map((a) => (/[^\w@./:=-]/.test(a) ? JSON.stringify(a) : a)).join(" ")); return ""; }
  try { return execFileSync(bin, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim(); }
  catch (e) { if (opts.allowFail) { console.log("  (skipped: " + String(e.message || "").split("\n")[0] + ")"); return ""; } throw e; }
}

// resolve owner (only hits your account when running for real; in dry-run it's a placeholder)
let owner = flags.owner;
if (!owner && !DRY) {
  try { owner = execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" }).trim(); }
  catch { console.error("couldn't read your GitHub login — run `gh auth login` or pass --owner."); process.exit(1); }
}
owner = owner || "<your-gh-user>";

// stage a deploy dir: the static files + CNAME (custom domain) + .nojekyll (so Pages keeps _next/ etc.)
const work = mkdtempSync(join(tmpdir(), `deploy-${slug}-`));
if (!DRY) {
  if (statSync(src).isDirectory()) cpSync(src, work, { recursive: true });
  else copyFileSync(src, join(work, "index.html")); // a single generated wrapp html
  writeFileSync(join(work, "CNAME"), host + "\n");
  writeFileSync(join(work, ".nojekyll"), "");
  if (!existsSync(join(work, "index.html"))) { console.error(`no index.html in ${src} — a wrapp needs an entry page.`); process.exit(1); }
}

console.log(`\n${DRY ? "DRY RUN — plan for" : "Deploying"} ${host}${APEX ? " (apex)" : ""}  (owner: ${owner}, repo: ${owner}/${repo})\n`);
console.log("1. stage the build + CNAME(" + host + ") + .nojekyll" + (DRY ? "  (skipped in dry run)" : `  → ${work}`));
console.log("2. create the repo, commit, push:");
run("git", ["-C", work, "init", "-b", "main"]);
run("git", ["-C", work, "add", "-A"]);
// set the commit identity inline so this never depends on a global git config being present
run("git", ["-C", work, "-c", `user.name=${owner}`, "-c", `user.email=${owner}@users.noreply.github.com`, "commit", "-m", `deploy ${repo} → ${host}`]);
run("gh", ["repo", "create", `${owner}/${repo}`, "--public", "--source", work, "--remote", "origin", "--push"]);
console.log("3. enable GitHub Pages from main / root, set the custom domain:");
run("gh", ["api", "-X", "POST", `/repos/${owner}/${repo}/pages`, "-f", "source[branch]=main", "-f", "source[path]=/"], { allowFail: true });
run("gh", ["api", "-X", "PUT", `/repos/${owner}/${repo}/pages`, "-f", `cname=${host}`], { allowFail: true });

console.log(`\nDNS — add these at your ${DOMAIN} registrar (I don't touch DNS):`);
if (APEX) {
  console.log(`   the apex ${DOMAIN} needs A + AAAA records (Pages can't CNAME a root domain):`);
  for (const ip of ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"]) console.log(`   A      @   →   ${ip}`);
  for (const ip of ["2606:50c0:8000::153", "2606:50c0:8001::153", "2606:50c0:8002::153", "2606:50c0:8003::153"]) console.log(`   AAAA   @   →   ${ip}`);
} else {
  console.log(`   CNAME   ${slug}   →   ${owner}.github.io.`);
}
console.log(`\n${DRY ? "Dry run only — nothing was created. Re-run with --go once `gh auth login` is done." : "Done."}  Live shortly at:  https://${host}\n`);
