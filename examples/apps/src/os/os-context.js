// Carried context — the reader side.
// When the OS launches a wrapp it appends the item context to the URL:
//     window.open("./crest.html#os=" + encodeURIComponent(JSON.stringify(ctx)))
// A wrapp calls readOsContext() on load to open AT the right thing (e.g. select the
// artifact the user clicked) instead of a cold start. Safe no-op when absent.
//
// Shape passed by the OS today: { artifact?, kind?, project?, term?, run?, artifactKey? } — additive.
// `artifact` is a human TITLE (a display seed, not addressable). `artifactKey` (#3) is the STORAGE KEY —
// a wrapp that keeps addressable artifacts should `relay.storage.get(artifactKey)` to reopen the EXACT
// item the user clicked, instead of a cold start. (Requires launchFromOS to forward the key.)
export function readOsContext() {
  const m = (location.hash || "").match(/[#&]os=([^&]+)/);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
}

// Convenience: reopen the exact artifact the OS launched us with, if the wrapp stores addressable blobs.
// `getBlob(key)` is the wrapp's own loader (e.g. (k) => relay.storage.get(k)). Returns the loaded value or null.
export async function openOsArtifact(getBlob) {
  const c = readOsContext();
  if (!c || !c.artifactKey || typeof getBlob !== "function") return null;
  try { return await getBlob(c.artifactKey); } catch (e) { console.error("openOsArtifact", e); return null; }
}

// Convenience: run a callback once with the context if present.
export function withOsContext(fn) {
  const c = readOsContext();
  if (c) { try { fn(c); } catch (e) { console.error("os-context handler", e); } }
  return c;
}
