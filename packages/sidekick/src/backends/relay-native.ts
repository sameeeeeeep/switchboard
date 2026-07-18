import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Attachment } from "@relay/protocol";

const run = promisify(execFile);

/**
 * Relay-native tools exposed to the agentic loop — relay's OWN controlled primitives, not model
 * capabilities the origin has to be granted. Today: `put_blob`, the general "local file → remote
 * connector" bridge, and `git_commit_push`, the publish verb for a BOUND project folder.
 *
 * SECURITY: put_blob is auto-approved in the backend's canUseTool (the blob is a file the USER
 * attached this turn, sent to an HTTPS URL the connector just handed the model). git_commit_push
 * carries its consent INSIDE the handler: writing the bound folder is already granted territory
 * (storage.set writes there un-prompted), but `git push` is EGRESS — it publishes — so the handler
 * always raises the standard write-consent card and fail-closes on timeout/decline. The model can
 * call the tool; only a human click makes it push.
 * [HARDEN LATER: restrict put_blob target URLs to known connector-storage hosts; cap size/count.]
 */

/** Everything git_commit_push needs from the Broker, per request. `folder` is the origin's
 *  EXPLICIT storage binding (never the auto sandbox); null disables the tool. */
export interface GitPublishContext {
  origin: string;
  folder: string | null;
  readonly: boolean;
  requestConsent: (args: Record<string, unknown>) => Promise<boolean>;
  audit: (outcome: "ok" | "denied", note?: string) => void;
}

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const git = (folder: string, args: string[]) => run("git", args, { cwd: folder, timeout: 60_000, maxBuffer: 1024 * 1024 });

/** The actual publish flow — exported for direct testing. Stages TRACKED changes only (`add -u`,
 *  so wrapp sidecars / .DS_Store never sneak into a commit), commits, pushes. ONE consent covers
 *  the whole verb, requested BEFORE any mutation, with a real diffstat on the card. */
export async function runGitPublish(ctx: GitPublishContext, message: string, branch?: string): Promise<Record<string, unknown>> {
  const fail = (error: string, note?: string) => { ctx.audit("denied", note ?? error); return { ok: false, error }; };
  if (!ctx.folder) return fail("no project folder is bound for this app — open a project first");
  if (ctx.readonly) return fail("this site is set to read-only");
  if (!message || message.trim().length < 3) return fail("a commit message is required");
  if (branch !== undefined && !BRANCH_RE.test(branch)) return fail("invalid branch name");
  const folder = ctx.folder;
  try {
    await git(folder, ["rev-parse", "--is-inside-work-tree"]);
  } catch { return fail("the bound folder is not a git repository"); }
  let remote = "";
  try { remote = (await git(folder, ["remote", "get-url", "origin"])).stdout.trim(); }
  catch { return fail("the repository has no 'origin' remote to push to"); }
  // Tracked changes only. -uno: untracked files are invisible to the publish verb.
  const status = (await git(folder, ["status", "--porcelain", "-uno"])).stdout.trim();
  if (!status) return fail("nothing to commit — no tracked files have changed");
  const summary = (await git(folder, ["diff", "--shortstat", "HEAD"])).stdout.trim() || status.split("\n").length + " file(s) changed";
  // THE click. Everything the user needs to judge is on the card; fail-closed on timeout.
  const approved = await ctx.requestConsent({ message: message.trim(), branch: branch ?? "(current branch)", folder, remote, changes: summary });
  if (!approved) return fail("user declined the publish", "user-declined");
  try {
    await git(folder, ["add", "-u"]);
    await git(folder, ["commit", "-m", message.trim()]);
    const pushArgs = branch ? ["push", "origin", `HEAD:refs/heads/${branch}`] : ["push", "origin", "HEAD"];
    await git(folder, pushArgs);
    const sha = (await git(folder, ["rev-parse", "--short", "HEAD"])).stdout.trim();
    ctx.audit("ok", `${sha} → ${branch ?? "current"} (${summary.slice(0, 80)})`);
    return { ok: true, sha, pushedTo: branch ?? "current branch", remote, changes: summary };
  } catch (err) {
    const msg = String((err as { stderr?: string })?.stderr || (err as Error)?.message || err).slice(0, 200);
    return fail("git failed: " + msg, msg.slice(0, 120));
  }
}

export function relayNativeServer(attachments: Map<string, Attachment>, gitCtx?: GitPublishContext) {
  return createSdkMcpServer({
    name: "relay",
    version: "0.0.1",
    tools: [
      tool(
        "put_blob",
        "Upload a page-attached blob (by its relay handle) to a presigned upload URL via HTTP PUT. Use this to upload a user-attached reference image to a connector's upload_url (from e.g. media_upload). Returns { ok, status }.",
        { handle: z.string().describe("the attachment handle, e.g. 'ref'"), url: z.string().describe("the presigned upload URL"), method: z.string().optional(), contentType: z.string().optional() },
        async ({ handle, url, method, contentType }) => {
          const att = attachments.get(handle);
          if (!att) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `no attachment '${handle}'` }) }] };
          try {
            const bytes = dataUrlToBytes(att.dataUrl);
            const res = await fetch(url, { method: method || "PUT", body: bytes, headers: { "content-type": contentType || att.contentType } });
            return { content: [{ type: "text", text: JSON.stringify({ ok: res.ok, status: res.status }) }] };
          } catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err).slice(0, 160) }) }] };
          }
        },
      ),
      tool(
        "git_commit_push",
        "Publish the bound project folder: stage TRACKED changes, commit with the given message, and push to origin (optionally to a new branch instead of the current one). Raises a user consent card before anything is committed — the result tells you whether the user approved. Returns { ok, sha, pushedTo } or { ok:false, error }.",
        { message: z.string().describe("the commit message"), branch: z.string().optional().describe("push to this new branch instead of the current one (for a review/PR flow)") },
        async ({ message, branch }) => {
          const result = gitCtx
            ? await runGitPublish(gitCtx, message, branch)
            : { ok: false, error: "publishing is unavailable for this call" };
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
      ),
    ],
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
