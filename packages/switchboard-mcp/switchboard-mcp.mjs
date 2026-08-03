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
import { actionTable, toolName, MANIFESTS } from "./registry.mjs";
import { withDaemon, daemonSbForOrigin, daemonAvailable, readPairingToken, WS_URL } from "./daemon-client.mjs";
import { mockSb } from "./mock-sb.mjs";
import { scaffoldWrapp } from "./scaffold.mjs";

// The origin the daemon attributes a connector-driven guide to (shown on the "Allow?" card). A guide
// is gated by its per-run human consent, not a standing grant, so this is an honest audit label —
// "a Claude, via the Switchboard connector" — not a claim to be some deployed wrapp.
const GUIDE_ORIGIN = "switchboard-connector";

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const fail = (message, extra) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, ...extra }) }] });

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

  // Startup banner (stderr — stdout is the MCP transport). Says exactly what's being served and in
  // which mode, so "why did it mock?" is answerable at a glance.
  const tools = [...table.keys(), "switchboard_scaffold_wrapp"];
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
