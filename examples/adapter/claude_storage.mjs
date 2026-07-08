/**
 * @switchboard/adapter — the drop-in replacement for an app's server persistence lib.
 *
 * brandbrain's routes read/write durable state through `lib/server/workspace-store.ts` and
 * `lib/server/vendor-store.ts`, which touch `.data/workspace.json` and `.data/vendors.json` on the
 * server. This shim exposes the SAME surface (readWorkspace / writeWorkspace / readVendors /
 * writeVendors) but resolves through `window.claude`'s per-origin `claude_storage` — so the app has
 * a local, user-owned store with no server, and the SWAP is once again just what `@/lib/server/*`
 * resolves to.
 *
 * KEY MAPPING is deliberate: key "workspace" → the record `workspace` → `<folder>/workspace.json`.
 * So when the user binds this origin to an EXISTING brandbrain `.data/` folder, its current
 * `workspace.json` / `vendors.json` appear verbatim — the same data, no migration.
 *
 * Shares the single provider set in claude.mjs, so one setProvider(window.claude) wires model +
 * storage together.
 */
import { getProvider, whenProvider } from "./claude.mjs";

const WORKSPACE_KEY = "workspace";
const VENDORS_KEY = "vendors";

async function req(params) {
  // The app may read storage the instant it mounts, before the bootstrap has connected. Briefly await
  // the provider so the first workspace load lands on real data instead of losing the race to empty.
  const provider = getProvider() || (await whenProvider());
  if (!provider) throw new Error("no provider — call setProvider(window.claude) after connect");
  return provider.request({ method: "claude_storage", params });
}

/** Generic key/value — the raw primitive, if an app wants more than workspace/vendors. */
export async function storageGet(key) {
  const r = await req({ op: "get", key });
  return r?.value ?? null;
}
export async function storageSet(key, value) { await req({ op: "set", key, value }); }
export async function storageDelete(key) { const r = await req({ op: "delete", key }); return !!r?.ok; }
export async function storageList() { const r = await req({ op: "list" }); return r?.keys ?? []; }
export async function storageInfo() { const r = await req({ op: "info" }); return r?.info ?? null; }

/**
 * Point this app's store at a real folder the user picks — e.g. their existing
 * `~/Documents/Projects/brandbrain/.data`. Triggers a one-time path-consent click in the broker.
 * Returns the resolved StorageInfo, or null if the user declined.
 */
export async function bindFolder(path) {
  try { const r = await req({ op: "bind", path }); return r?.info ?? null; }
  catch { return null; }
}

// ---- brandbrain-compatible stores (drop-in for lib/server/workspace-store + vendor-store) ----

/** @returns {Promise<{brands:unknown[],activeId:string|null,savedAt?:number}|null>} */
// DATA-LOSS GUARD (read-before-write): the app must successfully READ the durable store before we
// let it WRITE. If the read races (provider not ready) the app falls back to its localStorage and its
// autosave would clobber the real file — with FEWER brands, not just zero, which a count check alone
// wouldn't catch. Tying writes to a confirmed read closes that regardless of what the app holds.
let workspaceRead = false;
let vendorsRead = false;

export async function readWorkspace() {
  const raw = await storageGet(WORKSPACE_KEY); // throws if no provider → `workspaceRead` stays false
  workspaceRead = true;                         // storage was reachable — safe to persist from here on
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export async function writeWorkspace(data) {
  if (!workspaceRead) return; // never write before a successful read — the load-race that ate the data
  // Belt-and-suspenders: still refuse an empty write over a non-empty store.
  const brands = Array.isArray(data?.brands) ? data.brands : [];
  if (brands.length === 0) {
    const existing = await readWorkspace();
    if (existing && Array.isArray(existing.brands) && existing.brands.length > 0) return;
  }
  await storageSet(WORKSPACE_KEY, JSON.stringify({ ...data, savedAt: data?.savedAt ?? nowSafe() }));
}

/** @returns {Promise<{vendors:Record<string,unknown>,savedAt?:number}|null>} */
export async function readVendors() {
  const raw = await storageGet(VENDORS_KEY);
  vendorsRead = true;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export async function writeVendors(data) {
  if (!vendorsRead) return; // never write before a successful read
  const count = data?.vendors && typeof data.vendors === "object" ? Object.keys(data.vendors).length : 0;
  if (count === 0) {
    const existing = await readVendors();
    if (existing && existing.vendors && Object.keys(existing.vendors).length > 0) return;
  }
  await storageSet(VENDORS_KEY, JSON.stringify({ ...data, savedAt: data?.savedAt ?? nowSafe() }));
}

function nowSafe() { try { return Date.now(); } catch { return 0; } }
