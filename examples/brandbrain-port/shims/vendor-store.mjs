// SEAM SHIM · persistence. Replaces `@/lib/server/vendor-store` (node:fs → .data/vendors.json) with
// the adapter's claude_storage-backed store. Key "vendors" → vendors.json in the origin's folder.
export { readVendors, writeVendors } from "../../adapter/claude_storage.mjs";
