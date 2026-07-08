// SEAM SHIM · node:path for the browser (POSIX join/dirname/basename are all research.ts needs).
export function join(...parts) {
  return parts.filter((p) => p != null && p !== "").join("/").replace(/\/{2,}/g, "/");
}
export function dirname(p) { return p.replace(/\/[^/]*\/?$/, "") || "/"; }
export function basename(p, ext) { const b = p.replace(/\/+$/, "").split("/").pop() || ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; }
export default { join, dirname, basename };
