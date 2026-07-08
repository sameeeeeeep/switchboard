// SEAM SHIM · model transport. Replaces brandbrain's `@/lib/claude` (which spawned the `claude`
// CLI on a server) with the adapter's window.claude-backed transport. Same exported surface, so the
// 32 route handlers import it unchanged.
export { runClaude, runClaudeStream, extractJson, setProvider, getProvider } from "../../adapter/claude.mjs";

// The real lib exposed these transport helpers; a couple of modules reference them. Client-side there
// is no CLI and no relay HTTP — the provider IS window.claude — so these are inert stubs.
export function relayConfig() { return null; }
export function claudeBin() { return "claude"; }
export function claudeTransport() { return "relay"; }
