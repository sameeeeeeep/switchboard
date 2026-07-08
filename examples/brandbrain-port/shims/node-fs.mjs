// SEAM SHIM · node:fs / node:fs/promises for the browser. Only `@/lib/research` still reaches for the
// filesystem (an optional on-disk research cache). We back it with an in-memory map: a cache MISS just
// means the research re-runs on the model — correctness is unaffected. (The durable persistence seam
// is claude_storage; research caching could be pointed at it later.)
const mem = new Map();

export async function mkdir() { /* no dirs in memory */ }
export async function readFile(p) {
  if (mem.has(p)) return mem.get(p);
  const e = new Error(`ENOENT: ${p}`); e.code = "ENOENT"; throw e;
}
export async function writeFile(p, data) { mem.set(p, data); }
export async function rename(a, b) { if (mem.has(a)) { mem.set(b, mem.get(a)); mem.delete(a); } }
export async function rm(p) { mem.delete(p); }

export const promises = { mkdir, readFile, writeFile, rename, rm };
export default { promises, mkdir, readFile, writeFile, rename, rm };
