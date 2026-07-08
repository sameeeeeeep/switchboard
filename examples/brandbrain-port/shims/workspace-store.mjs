// SEAM SHIM · persistence. Replaces brandbrain's `@/lib/server/workspace-store` (node:fs → .data/
// workspace.json) with the adapter's claude_storage-backed store. Key "workspace" → workspace.json in
// the origin's folder — so a bound existing .data/ surfaces the founder's current brands verbatim.
export { readWorkspace, writeWorkspace } from "../../adapter/claude_storage.mjs";
