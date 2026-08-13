#!/usr/bin/env node
// A tiny ZERO-DEPENDENCY MCP server (stdio) that REQUIRES a credential — the seed tool for the
// third-party-tools CREDENTIAL lane (task 3). Unlike hn/websearch (no-key, public API), this one needs
// an API key in env `ECHOAUTH_KEY`. With no key it returns a structured "needs credential" error so the
// runner can raise the notch credential card; with a key set it "authenticates" and echoes a result in the
// same `_switchboard: results` envelope the widget renders. Keys never leave the machine — the daemon
// injects ECHOAUTH_KEY into this process's env at spawn (mcp.json / the secret store), we only READ it.
import { createInterface } from "node:readline";

// The secret this tool needs. The listing declares it (secrets:[{env:"ECHOAUTH_KEY",…}]) so the runner
// knows to prompt BEFORE calling; we ALSO guard here so a direct call without a key fails cleanly.
const KEY = (process.env.ECHOAUTH_KEY || "").trim();

const TOOLS = [
  {
    name: "whoami",
    description:
      "Echo who you are according to your API key — a demo of a keyed third-party tool. Needs an " +
      "ECHOAUTH_KEY credential (any non-empty string works for the demo). Use to test the credential flow.",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string", description: "an optional note to echo back." } },
    },
  },
];

// The structured "you need a credential" error. code 4200 = MISSING_CREDENTIAL — the runner branches on it
// to raise the credential card (distinct from a not-granted 4100 or a plain server error).
function missingCredential() {
  // The marker rides INSIDE the content text (JSON), like the results envelope, so it survives the MCP
  // result passthrough and the native runner can read `secret` to raise the credential card.
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        _switchboard: "needs_credential",
        secret: { env: "ECHOAUTH_KEY", label: "Echo-Auth API key", hint: "any non-empty string for the demo" },
        text: "This tool needs an Echo-Auth API key (ECHOAUTH_KEY) — it isn't set yet.",
      }),
    }],
  };
}

function whoami({ note }) {
  const who = `key-${KEY.slice(0, 6)}${KEY.length > 6 ? "…" : ""}`;
  const line = `Authenticated as ${who}${note ? ` · note: ${note}` : ""}`;
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        _switchboard: "results",
        summary: "Echo-Auth · whoami",
        text: line,
        items: [{ title: who, snippet: "authenticated via ECHOAUTH_KEY (kept local)", meta: `key length ${KEY.length}` }],
      }),
    }],
  };
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

const rl = createInterface({ input: process.stdin });
rl.on("line", (raw) => {
  let req;
  try { req = JSON.parse(raw); } catch { return; }
  const { id, method, params } = req || {};
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "echo-auth", version: "0.1.0" } } });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  } else if (method === "tools/call") {
    const name = params?.name;
    if (name !== "whoami") { send({ jsonrpc: "2.0", id, error: { code: -32601, message: `no such tool: ${name}` } }); return; }
    // The credential guard: no key → a structured MISSING_CREDENTIAL result (not a JSON-RPC error, so the
    // runner can read the `secret` descriptor and raise the card), else the real result.
    send({ jsonrpc: "2.0", id, result: KEY ? whoami(params?.arguments || {}) : missingCredential() });
  } else if (method && id != null) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
});
