#!/usr/bin/env node
// switchboard — the reverse arrow (docs/WRAPPS-FOR-AGENTS.md). An MCP server that lets Claude Code
// (or any MCP client) RUN Switchboard wrapps headless and SET THEM UP in a project, on the user's
// own Claude, under the same per-origin consent as the browser. Add it once:
//
//   claude mcp add switchboard -- node /abs/path/packages/switchboard-mcp/switchboard-mcp.mjs mcp
//
// It advertises one tool per installed wrapp action — wrapp__adpulse__analyze, … — plus
// switchboard_scaffold_wrapp to generate a new wrapp from the house template. Calling an action:
//   1. resolves it to its wrapp ORIGIN (the authoritative isolation key — the agent's claim is not
//      trusted; same origin oracle as the browser path);
//   2. PRE-FLIGHTS the origin's grant (fail-closed: an unauthorized wrapp is refused, not run);
//   3. runs the wrapp's pure orchestration run(input, sb) with an `sb` bound to that origin, on the
//      user's Claude through the existing gated loop — budgets, audit, isolation all inherited.
//
// The credential/model never leaves the daemon. Consent stays a human click (browser today; the
// menubar tray for this path per §3). No new trust surface — the broker with an MCP transport.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { actionTable, toolName, MANIFESTS } from "./registry.mjs";
import { withDaemon, daemonSbForOrigin, daemonAvailable, readPairingToken, WS_URL } from "./daemon-client.mjs";
import { mockSb } from "./mock-sb.mjs";
import { scaffoldWrapp } from "./scaffold.mjs";
// The task board is the one thing the connector touches by FILE, not daemon: tasks live as plain
// `tasks.md` lines in the project's vault (the same dialect the OS board + Obsidian read). The pure
// transforms are shared with the Bank connector so the board can never disagree with itself.
import { addTask, completeTask, parseTasks, setStatus } from "../bank-mcp/tasks.mjs";

// The origin the daemon attributes a connector-driven guide to (shown on the "Allow?" card). A guide
// is gated by its per-run human consent, not a standing grant, so this is an honest audit label —
// "a Claude, via the Switchboard connector" — not a claim to be some deployed wrapp.
const GUIDE_ORIGIN = "switchboard-connector";

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const fail = (message, extra) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, ...extra }) }] });

// Best-effort NOTCH ACK (docs/GUIDE-QUEUE-RESUME.md §notch feedback): drop a ~/.relay/guide-notify.json
// the Switchboard app shows as a brief toast at the notch — so an action taken in a Claude thread
// ("task captured", "spec added") is FELT on-screen, not silently buried in chat. Never throws: no
// ~/.relay dir (not a Switchboard user) → silent no-op; the app also suppresses it during an active run.
function notchNotify(text, { kind = "captured", source = "Claude Code", project } = {}) {
  try {
    const dir = join(homedir(), ".relay");
    if (!existsSync(dir)) return;
    writeFileSync(join(dir, "guide-notify.json"), JSON.stringify({ text, kind, source, project, ttl: 2.6 }));
  } catch { /* non-fatal — a toast is never worth failing the tool over */ }
}

// ---- the task board (file-based, not daemon) ----------------------------------------------------
// The vault resolves in order: --vault <path> | $SWITCHBOARD_VAULT | $BANK_VAULT | ~/SwitchboardBrain.
// The default is the user's home vault (~/SwitchboardBrain), NOT cwd: when installed as a plugin the
// connector is invoked with no --vault, and a Claude Code session's cwd is whatever project folder it
// happens to sit in — running the task tools against that folder is the wrong board (this is the exact
// bug that broke the dev connector; it had to be hand-fixed with `--vault ~/SwitchboardBrain`). An
// explicit --vault or $*_VAULT still overrides, so "any folder will do" for install without a flag.
const DEFAULT_VAULT = join(homedir(), "SwitchboardBrain");
function argVal(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; }
function expand(p) { return p && p.startsWith("~") ? join(homedir(), p.slice(1)) : p; }
const VAULT = resolve(expand(argVal("--vault") || process.env.SWITCHBOARD_VAULT || process.env.BANK_VAULT || DEFAULT_VAULT));
const TASKS_FILE = "tasks.md";
function ensureVault() { if (!existsSync(VAULT)) mkdirSync(VAULT, { recursive: true }); }
function readDoc(name) { const p = join(VAULT, name); return existsSync(p) ? readFileSync(p, "utf8") : ""; }
function writeDoc(name, text) { ensureVault(); writeFileSync(join(VAULT, name), text); }
function mdFiles() { try { return readdirSync(VAULT).filter((f) => f.toLowerCase().endsWith(".md")); } catch { return []; } }

// A task's project = its `#proj` tag if present, else the `## Heading` list it sits under. `project`
// filters loosely (slug-tolerant substring) so "switchboard" matches "#switchboard" and "## Switchboard launch".
const slugish = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const matchesProject = (t, want) => {
  if (!want) return true;
  const w = slugish(want), p = slugish(t.proj), l = slugish(t.list);
  return (p && (p.includes(w) || w.includes(p))) || (l && (l.includes(w) || w.includes(l)));
};
// The card as Claude should see it: clean title + every dialect field, detail flattened.
const taskView = (t) => ({
  title: t.title, column: t.col, done: t.done, list: t.list,
  ...(t.proj ? { project: t.proj } : {}), ...(t.tag ? { wrapp: t.tag } : {}),
  ...(t.id ? { id: t.id } : {}), ...(t.epic ? { epic: t.epic } : {}),
  ...(t.prio ? { priority: t.prio } : {}), ...(t.due ? { due: t.due } : {}),
  ...(t.blockedBy.length ? { blockedBy: t.blockedBy } : {}),
  ...(t.detail.length ? { detail: t.detail.map((d) => (d.sub ? `☐ ${d.text}` : d.text)) } : {}),
  file: t.file,
});

// Register the five task tools on the connector. Vault = this project (see VAULT above).
function registerTaskTools(server) {
  server.registerTool(
    "switchboard_add_task",
    {
      title: "Add a task to the project board",
      description:
        "Add a to-do to the project's board (tasks.md in the vault). Use whenever the user wants to remember, capture, or track something, or when you finish work and there are clear follow-ups worth saving. Optional dialect: `status` (backlog parks it; default todo), `epic` (bundle related cards), `priority`, and `detail` lines (plain notes and/or nested '- [ ] subtask'). `list` groups it under a `## Heading`.",
      inputSchema: {
        text: z.string().describe("the task, as a short imperative action, e.g. 'Reply to Acme about the renewal'"),
        list: z.string().optional().describe("which list/project to file it under (becomes a `## Heading`). Default 'Inbox'."),
        due: z.string().optional().describe("optional due — a full date 'YYYY-MM-DD' folds into due:, a soft hint ('Fri') into '— by'"),
        status: z.enum(["backlog", "todo", "doing", "blocked", "review"]).optional().describe("kanban column; default todo. backlog = parked (not released to agents)"),
        epic: z.string().optional().describe("group this into an epic/bundle of related cards (a slug, e.g. 'launch-week')"),
        priority: z.enum(["high", "med", "low"]).optional().describe("priority"),
        detail: z.array(z.string()).optional().describe("spec lines for the card — plain notes and/or nested '- [ ] subtask' lines; stored indented under the task"),
      },
    },
    async ({ text, list, due, status, epic, priority, detail }) => {
      const { doc, added, reason, list: filed } = addTask(text, { list, due, status, epic, prio: priority, detail }, readDoc(TASKS_FILE));
      if (added) {
        writeDoc(TASKS_FILE, doc);
        // Acknowledge at the notch so a captured task is FELT, not silently filed (founder ask).
        const short = text.length > 60 ? text.slice(0, 57) + "…" : text;
        notchNotify(`Task captured: ${short}`, { kind: "captured", project: filed });
      }
      return ok({ ok: added, added, list: filed, reason, file: join(VAULT, TASKS_FILE) });
    },
  );

  // Surface a PM EVENT on the notch — the deterministic stream layer (docs/PM-NOTCH-OPERATOR.md), callable
  // from ANY folder (unlike scripts/pm-notch.mjs, which needs the repo cwd). A file write, no model.
  server.registerTool(
    "switchboard_notch",
    {
      title: "Surface a PM event at the notch",
      description:
        "Fire a brief adhd-pm event on the user's Switchboard notch — a deterministic ack (no model, no cost). Use it to STREAM what you're doing, especially in /pip or adhd-pm mode, so the user watches progress at the notch instead of reading chat: `captured` (boarded a task), `picked` (started one), `decided` (a fork resolved), `spec` (tidied the board), `thread` (started a new work thread), `info` (a heads-up). One short line each; silent no-op if Switchboard isn't running.",
      inputSchema: {
        kind: z.enum(["captured", "picked", "decided", "spec", "thread", "info"]).describe("event kind — drives the notch kicker + colour"),
        text: z.string().describe("one short line: what just happened"),
        project: z.string().optional().describe("the project this is grounded in (shown on the card)"),
        source: z.string().optional().describe("who's acting — a thread label, e.g. 'Claude Code · brand'. Each source gets its own colour in the PIP feed."),
      },
    },
    async ({ kind, text, project, source }) => {
      const fired = notchNotify(text, { kind, project, source: source || "Claude Code · adhd-pm" });
      return ok({ ok: true, fired, kind, text });
    },
  );

  server.registerTool(
    "switchboard_list_tasks",
    {
      title: "List the project's tasks",
      description:
        "Read the project's board as kanban cards. Use before adding (to avoid duplicates), to answer 'what's on my list / for <project>', or to review the board. Each task carries its column (backlog · todo · doing · blocked · review · done) and — when present — its id, epic (bundle), priority, due date, blockers, and spec detail. Filter by `column`, `project`, or `epic`.",
      inputSchema: {
        status: z.enum(["open", "done", "all"]).optional().describe("coarse filter; default 'open' (everything not done). Use `column` for a specific kanban column."),
        column: z.enum(["backlog", "todo", "doing", "blocked", "review", "done"]).optional().describe("only tasks in this kanban column (overrides `status`). backlog = parked, not yet released to agents"),
        list: z.string().optional().describe("only tasks under this exact `## ` list heading (case-insensitive)"),
        project: z.string().optional().describe("only tasks for this project — matches a task's #proj tag or its list, loosely (slug-tolerant)"),
        epic: z.string().optional().describe("only tasks in this epic/bundle (case-insensitive)"),
      },
    },
    async ({ status = "open", column, list, project, epic }) => {
      const all = mdFiles().flatMap((f) => parseTasks(readDoc(f), f));
      const wantList = list ? String(list).toLowerCase() : null;
      const wantEpic = epic ? String(epic).toLowerCase() : null;
      const tasks = all
        .filter((t) => (column ? t.col === column : status === "all" ? true : status === "done" ? t.done : !t.done))
        .filter((t) => (wantList ? t.list.toLowerCase() === wantList : true))
        .filter((t) => matchesProject(t, project))
        .filter((t) => (wantEpic ? (t.epic || "").toLowerCase() === wantEpic : true))
        .map(taskView)
        .slice(0, 200);
      return ok({ ok: true, count: tasks.length, tasks });
    },
  );

  server.registerTool(
    "switchboard_move_task",
    {
      title: "Move a task to a column",
      description:
        "Move a task across the kanban by rewriting only its status — backlog · todo · doing · blocked · review · done. Use when you start work ('mark it doing'), hit a wall ('blocked'), finish ('done'), send something for review, or park it ('backlog'). Match by the task's `id:` (exact) or a distinctive fragment of its text.",
      inputSchema: {
        match: z.string().describe("the task's id: value (preferred, exact) or a distinctive fragment of its text"),
        column: z.enum(["backlog", "todo", "doing", "blocked", "review", "done"]).describe("the column to move it to (backlog = park it)"),
      },
    },
    async ({ match, column }) => {
      for (const f of mdFiles()) {
        const { doc, changed, title, col } = setStatus(match, column, readDoc(f));
        if (changed) { writeDoc(f, doc); return ok({ ok: true, moved: title, to: col, file: f }); }
      }
      return ok({ ok: false, reason: "no task matches that id/text" });
    },
  );

  server.registerTool(
    "switchboard_complete_task",
    {
      title: "Complete a task",
      description:
        "Mark a task done by matching its text (case-insensitive substring). Use when the user says something is finished/handled. Flips `- [ ]` to `- [x]` in place so it stays checked off.",
      inputSchema: { match: z.string().describe("text (or a distinctive fragment) of the task to complete") },
    },
    async ({ match }) => {
      for (const f of mdFiles()) {
        const { doc, completed } = completeTask(match, readDoc(f));
        if (completed) { writeDoc(f, doc); return ok({ ok: true, completed, file: f }); }
      }
      return ok({ ok: false, reason: "no open task matches that text" });
    },
  );

  server.registerTool(
    "switchboard_next_task",
    {
      title: "Pick up the next task to work on",
      description:
        "Claim the next actionable task the user has RELEASED for work — the top unblocked `todo` card, optionally scoped to a project or epic. This is how a Claude session PICKS UP work from the board: it returns the card's full spec (title, detail, subtasks) and — unless you pass claim:false — moves it to `doing` so it won't be picked up twice. When you finish, call switchboard_move_task(match:<id>, column:'done'). NEVER pulls from `backlog` (parked items the user hasn't promoted), and skips blocked / doing / review cards — so the user's Backlog→Todo drag is the deliberate 'agent, go' signal.",
      inputSchema: {
        project: z.string().optional().describe("only consider tasks for this project (matches #proj tag or list, slug-tolerant)"),
        epic: z.string().optional().describe("only consider tasks in this epic/bundle"),
        claim: z.boolean().optional().describe("move the returned task to 'doing' so it isn't picked up twice (default true)"),
      },
    },
    async ({ project, epic, claim = true }) => {
      const wantEpic = epic ? String(epic).toLowerCase() : null;
      const prioRank = { high: 0, med: 1, low: 2 };
      const candidates = mdFiles()
        .flatMap((f) => parseTasks(readDoc(f), f))
        .filter((t) => t.col === "todo")
        .filter((t) => matchesProject(t, project))
        .filter((t) => (wantEpic ? (t.epic || "").toLowerCase() === wantEpic : true));
      if (!candidates.length) return ok({ ok: false, reason: project || epic ? "no unblocked todo tasks in that scope" : "no unblocked todo tasks — promote something from Backlog to Todo first" });
      candidates.sort((a, b) => {
        const pr = (prioRank[a.prio] ?? 1) - (prioRank[b.prio] ?? 1); if (pr) return pr;
        const ad = a.due || "9999", bd = b.due || "9999"; if (ad !== bd) return ad < bd ? -1 : 1;
        return 0;
      });
      const t = candidates[0];
      const card = taskView(t);
      if (claim) {
        const { doc: moved, changed, id } = setStatus(t.id || t.title, "doing", readDoc(t.file));
        if (changed) { writeDoc(t.file, moved); card.column = "doing"; card.id = id || card.id; card.claimed = true; }
      }
      return ok({ ok: true, task: card, hint: claim ? "moved to 'doing' — call switchboard_move_task(match:id, column:'done') when finished" : "not claimed" });
    },
  );
}

// Build a zod input shape from an action's `input` doc: keys whose description carries "?" or
// "optional" are optional; a leading "string"/"object" sets the type. Loose on purpose — the
// action's own run() is the real validator (it throws readable errors the caller sees).
function shapeFor(inputDoc) {
  const shape = {};
  for (const [key, desc] of Object.entries(inputDoc || {})) {
    const optional = /\?|optional/i.test(desc);
    let t = /^\s*string/i.test(desc) ? z.string() : /^\s*object/i.test(desc) ? z.object({}).passthrough() : z.any();
    t = t.describe(String(desc));
    shape[key] = optional ? t.optional() : t;
  }
  return shape;
}

// ---- sb mode: mock | daemon | auto (default). NEVER silently fall back to mock once we've decided
// daemon — a mock result dressed as the user's Claude is exactly the dishonest failure the storage-
// key bug taught us to make loud. auto probes ONCE at startup and says which it chose. ----
async function resolveMode() {
  const want = (process.env.SWITCHBOARD_SB || "auto").toLowerCase();
  if (want === "mock") return "mock";
  if (want === "daemon") return "daemon";
  const live = await daemonAvailable();
  return live ? "daemon" : "mock";
}

// DEV origin override. A wrapp's manifest origin is its real deployed identity — the grant key. But
// before a wrapp is deployed (or connected in the browser), a developer runs it at localhost, and
// that localhost origin already carries a real, human-approved grant. SWITCHBOARD_ORIGIN_<WRAPP>
// lets the connector target that granted origin for local testing. It does NOT bypass consent — it
// reuses a grant a human already approved in the browser; an ungranted override still fails closed.
function effectiveOrigin(manifest) {
  const override = process.env[`SWITCHBOARD_ORIGIN_${manifest.name.toUpperCase()}`];
  if (override && override !== manifest.origin) {
    console.error(`[switchboard-mcp] dev origin override: ${manifest.name} → ${override} (reusing that origin's existing grant; real deploy uses ${manifest.origin})`);
    return { ...manifest, origin: override };
  }
  return manifest;
}

async function runAction(entry, args, mode) {
  const { manifest, action } = entry;
  if (mode === "daemon") {
    const m = effectiveOrigin(manifest);
    const result = await withDaemon(async (conn) => {
      const sb = await daemonSbForOrigin(conn, m);
      return action.run(args, sb);
    });
    return { mode: "daemon", result };
  }
  const result = await action.run(args, mockSb());
  return { mode: "mock", result };
}

async function main() {
  const mode = await resolveMode();
  const server = new McpServer({ name: "switchboard", version: "0.1.0" });
  const table = actionTable();

  for (const [name, entry] of table) {
    const { manifest, action } = entry;
    server.registerTool(
      name,
      {
        title: `${manifest.title || manifest.name} — ${action.name}`,
        description:
          `${action.summary}\n\nRuns the “${manifest.name}” wrapp on the user's own Claude via Switchboard (origin ${manifest.origin}). ` +
          `Output: ${JSON.stringify(action.output)}. ` +
          (mode === "mock"
            ? "NOTE: the Switchboard daemon isn't reachable, so results are a structurally-valid MOCK, not the user's Claude."
            : "Requires the wrapp to be authorized in Switchboard first (a one-time human Connect); otherwise this returns a clear error."),
        inputSchema: shapeFor(action.input),
      },
      async (args) => {
        try {
          const { mode: usedMode, result } = await runAction(entry, args, mode);
          return ok({ ok: true, mode: usedMode, wrapp: manifest.name, action: action.name, ...result });
        } catch (e) {
          return fail(String(e?.message || e), { wrapp: manifest.name, action: action.name });
        }
      },
    );
  }

  server.registerTool(
    "switchboard_scaffold_wrapp",
    {
      title: "Scaffold a new Switchboard wrapp",
      description:
        "Create a new wrapp in the user's project from the Switchboard house template (plumbing, SDK contracts, and design system already correct). Use when the user wants to 'make a wrapp', 'set up a wrapp for this project', or 'start a Switchboard app'. Writes files only — no AI call, no network. Returns the folder and the next steps.",
      inputSchema: {
        idea: z.string().describe("one line describing what the wrapp does — becomes the connect reason + starter prompt. Required."),
        name: z.string().optional().describe("display name (default derived from the idea); the folder is its slug."),
        dir: z.string().optional().describe("parent folder to create the wrapp in. Default: the current working directory."),
      },
    },
    async ({ idea, name, dir }) => {
      try { return ok(scaffoldWrapp({ idea, name, dir })); }
      catch (e) { return fail(String(e?.message || e)); }
    },
  );

  // guide_run — the reverse arrow for HANDS-ON help: let a Claude (even a remote one on claude.ai)
  // walk the user through steps on their OWN screen. The daemon consent-gates each run (the human
  // clicks "Allow" once, seeing the title) and the native runtime floats each caption by the cursor;
  // the human signals pass/fail/next. Brokered end-to-end — the model never touches the machine
  // directly, only proposes steps the human physically confirms.
  server.registerTool(
    "guide_run",
    {
      title: "Guide the user through steps on their screen",
      description:
        "Walk the user through steps on their screen — onboarding, setup, a how-to, or a guided test. " +
        "The Switchboard app floats each step's caption by the user's cursor; the user signals pass/next, fail, or abort, " +
        "and this returns per-step results. Use for 'walk me through…', 'set this up for me', 'show me how to…', or 'test this flow'. " +
        "Every run asks the user to Allow it first (it briefly guides their cursor). Requires the Switchboard daemon + app to be running on their Mac.",
      inputSchema: {
        title: z.string().describe("What this walkthrough is — shown at the Allow prompt and as the heading, e.g. 'Connect your first wrapp'. Required."),
        mode: z.enum(["tour", "test"]).optional().describe("'tour' (default) = teach/guide; 'test' = pass/fail each step (a guided test)."),
        steps: z.array(z.object({
          id: z.string().optional().describe("stable step id (auto-generated if omitted)"),
          text: z.string().describe("the caption shown by the cursor, e.g. 'Click Connect, top-right'"),
          hint: z.string().optional().describe("optional secondary line: where to look / what 'done' means"),
        })).min(1).describe("ordered steps; at least one. Required."),
      },
    },
    async ({ title, mode: guideMode, steps }) => {
      // A guide drives the REAL cursor — there is no honest mock. If the daemon isn't reachable,
      // say so plainly rather than pretend (the make-it-loud rule).
      if (mode !== "daemon") {
        return fail("guide_run needs the live Switchboard daemon + app running on this Mac (it drives the real cursor). It has no mock.");
      }
      try {
        // Attribute the run to the connector origin; the daemon consent-gates each run by title, so
        // no standing per-origin grant is required (a guide touches no user data — see server.ts).
        const result = await withDaemon((conn) =>
          conn.request(GUIDE_ORIGIN, "guide_run", { title, mode: guideMode ?? "tour", steps }),
        );
        return ok({ ok: true, tool: "guide_run", ...result });
      } catch (e) {
        return fail(String(e?.message || e), { tool: "guide_run" });
      }
    },
  );

  // The project task board — add/list/move/complete/next, reading tasks.md in the vault (this project).
  registerTaskTools(server);

  // Startup banner (stderr — stdout is the MCP transport). Says exactly what's being served and in
  // which mode, so "why did it mock?" is answerable at a glance.
  const taskTools = ["switchboard_add_task", "switchboard_list_tasks", "switchboard_move_task", "switchboard_complete_task", "switchboard_next_task"];
  const tools = [...table.keys(), "switchboard_scaffold_wrapp", ...taskTools];
  console.error(`[switchboard-mcp] task board vault: ${VAULT}`);
  const want = (process.env.SWITCHBOARD_SB || "auto").toLowerCase();
  const why = mode === "daemon" ? `daemon ${WS_URL}`
    : want === "mock" ? "SWITCHBOARD_SB=mock"
    : readPairingToken() ? "daemon unreachable — using mock"
    : "no pairing token — using mock";
  console.error(
    `[switchboard-mcp] mode=${mode} (${why}) · wrapps: ${MANIFESTS.map((m) => m.name).join(", ")} · tools: ${tools.join(", ")}`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// `switchboard mcp` (default) starts the server. Anything else prints usage.
const sub = process.argv[2];
if (sub && sub !== "mcp") {
  console.error("usage: switchboard mcp    # run the MCP server over stdio");
  process.exit(sub === "--help" || sub === "-h" ? 0 : 1);
} else {
  main().catch((e) => { console.error("[switchboard-mcp] fatal:", String(e?.message || e)); process.exit(1); });
}
