import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Git backing for a team folder — "the folder when live, the repo when apart."
 *
 * The live P2P channel gives the 2–3s feel while teammates are online together; this layer
 * makes the SAME folder durable and reachable when they're not: a debounced auto-commit
 * (attributed to the member) plus a pull/merge/push cycle against a remote the USER already
 * has (their GitHub, a bare repo on a NAS — any git URL). The daemon shells out to the
 * system `git`, so auth is the user's own SSH key / credential helper — Switchboard never
 * sees or stores a git credential. GIT_TERMINAL_PROMPT=0 and BatchMode keep a missing
 * credential a clean error, never a hung dialog.
 *
 * Merge policy: `-X theirs` (and `--allow-unrelated-histories` for first contact). While the
 * live channel runs, members' trees are already converged, so merges are trivial; real
 * conflicts only arise from truly-offline divergence, where "the repo's earlier pusher wins
 * the conflicting hunks" is the honest, deterministic analog of the LWW rule. Pulled changes
 * land in the working tree, where the normal scan stamps and fans them out to live peers —
 * the two layers compose through the folder itself, no coupling.
 *
 * SAFETY: we never adopt someone's unrelated repo. A folder INSIDE an existing repo (not its
 * root) is refused; a folder that already IS a repo root is used only when its origin matches
 * the team remote — never re-pointed. The explicit consent moment ("everything in this folder
 * will be committed to <remote>") is the panel's job before this is ever enabled.
 */

export interface GitConfig {
  remote: string;
  branch: string;
}

export interface GitCycleState {
  lastPushAt?: number;
  lastPullAt?: number;
  error?: string;
}

const CMD_TIMEOUT_MS = 60_000;

function git(folder: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((res) => {
    execFile("git", args, {
      cwd: folder,
      timeout: CMD_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -oBatchMode=yes" },
    }, (error, stdout, stderr) => {
      res({ ok: !error, out: String(stdout).trim(), err: String(stderr || error?.message || "").trim() });
    });
  });
}

const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 140);

export class GitBacking {
  private busy = false;
  state: GitCycleState = {};

  constructor(
    private folder: string,
    private config: GitConfig,
    /** The member's display name — commits are attributed to them, config untouched. */
    private authorName: () => string,
  ) {}

  /** One-time (idempotent) repo setup. Throws a user-readable error when the folder can't
   *  safely become the team repo — the caller surfaces it and does NOT enable the cycle. */
  async ensureRepo(): Promise<void> {
    const { remote, branch } = this.config;
    const hasOwnGit = existsSync(join(this.folder, ".git"));
    if (!hasOwnGit) {
      // Refuse a folder nested inside someone's existing repo: auto-committing into an
      // unrelated project's history is exactly the surprise we must never cause.
      const top = await git(this.folder, ["rev-parse", "--show-toplevel"]);
      if (top.ok && resolve(top.out) !== resolve(this.folder)) {
        throw new Error(`this folder is inside an existing git repo (${top.out}) — pick a standalone folder`);
      }
      const init = await git(this.folder, ["init", "-b", branch]);
      if (!init.ok) throw new Error(`git init failed: ${short(init.err)}`);
    }
    const origin = await git(this.folder, ["remote", "get-url", "origin"]);
    if (!origin.ok) {
      const add = await git(this.folder, ["remote", "add", "origin", remote]);
      if (!add.ok) throw new Error(`git remote add failed: ${short(add.err)}`);
    } else if (origin.out !== remote) {
      // An existing repo pointing elsewhere is the user's repo, not ours to re-point.
      throw new Error(`this folder is already a git repo with a different origin (${origin.out})`);
    }
    // Make sure we're on the team branch (create it if the repo is fresh).
    await git(this.folder, ["checkout", "-B", branch]);
  }

  /**
   * One backing cycle: commit local changes (when the folder is quiet), pull the remote's,
   * push ours. Never throws — failures land in state.error for the panel and the next cycle
   * retries. Returns true when the PULL changed the working tree (caller nudges apps/peers).
   */
  async cycle(opts: { quiet: boolean }): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const { remote, branch } = this.config;
      let pulled = false;
      // 1. Commit — only when the folder has settled ("pushed when done", not per keystroke).
      if (opts.quiet) {
        await git(this.folder, ["add", "-A", "."]);
        const status = await git(this.folder, ["status", "--porcelain"]);
        if (status.ok && status.out) {
          const who = this.authorName();
          const commit = await git(this.folder, [
            "-c", `user.name=${who} (Switchboard)`,
            "-c", "user.email=team@switchboard.local",
            "commit", "-m", "team sync via Switchboard",
          ]);
          if (!commit.ok) { this.state.error = `commit: ${short(commit.err)}`; return false; }
        }
      }
      // 2. Pull (fetch + merge, remote wins conflicting hunks — see header).
      const fetch = await git(this.folder, ["fetch", "origin", branch]);
      if (!fetch.ok && !/couldn't find remote ref/i.test(fetch.err)) {
        this.state.error = `fetch: ${short(fetch.err)}`;
        return false; // unreachable remote / no auth — clean error, retry next cycle
      }
      if (fetch.ok) {
        const head = await git(this.folder, ["rev-parse", "HEAD"]);
        if (!head.ok) {
          // Unborn branch (nothing committed here yet — e.g. an empty member vault): merge has
          // nothing to stand on, so adopt the remote history outright.
          const adopt = await git(this.folder, ["checkout", "-B", branch, "FETCH_HEAD"]);
          if (!adopt.ok) { this.state.error = `checkout: ${short(adopt.err)}`; return false; }
          pulled = true;
          this.state.lastPullAt = Date.now();
        } else {
          const merge = await git(this.folder, ["merge", "-X", "theirs", "--allow-unrelated-histories", "--no-edit", "FETCH_HEAD"]);
          if (!merge.ok) {
            await git(this.folder, ["merge", "--abort"]);
            this.state.error = `merge: ${short(merge.err)}`;
            return false;
          }
          const after = (await git(this.folder, ["rev-parse", "HEAD"])).out;
          pulled = head.out !== after;
          this.state.lastPullAt = Date.now();
        }
      }
      // 3. Push — with one pull+retry for the "someone pushed in between" race. Nothing to
      // push while the branch is unborn (an empty vault that hasn't committed yet).
      if (!(await git(this.folder, ["rev-parse", "HEAD"])).ok) { this.state.error = undefined; return pulled; }
      for (let attempt = 0; attempt < 2; attempt++) {
        const push = await git(this.folder, ["push", "-u", "origin", branch]);
        if (push.ok) { this.state.lastPushAt = Date.now(); this.state.error = undefined; break; }
        if (attempt === 0 && /rejected|fetch first|non-fast-forward/i.test(push.err)) {
          const refetch = await git(this.folder, ["fetch", "origin", branch]);
          if (refetch.ok) {
            const merge2 = await git(this.folder, ["merge", "-X", "theirs", "--allow-unrelated-histories", "--no-edit", "FETCH_HEAD"]);
            if (merge2.ok) { pulled = true; continue; }
            await git(this.folder, ["merge", "--abort"]);
          }
        }
        this.state.error = `push: ${short(push.err)}`;
        break;
      }
      return pulled;
    } finally {
      this.busy = false;
    }
  }
}
