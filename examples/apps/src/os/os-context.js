// Carried context — the reader side.
// When the OS launches a wrapp it appends the item context to the URL:
//     window.open("./crest.html#os=" + encodeURIComponent(JSON.stringify(ctx)))
// A wrapp calls readOsContext() on load to open AT the right thing (e.g. select the
// artifact the user clicked) instead of a cold start. Safe no-op when absent.
//
// Shape passed by the OS today: { artifact?, kind?, project?, term?, run? } — additive.
export function readOsContext() {
  const m = (location.hash || "").match(/[#&]os=([^&]+)/);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
}

// Convenience: run a callback once with the context if present.
export function withOsContext(fn) {
  const c = readOsContext();
  if (c) { try { fn(c); } catch (e) { console.error("os-context handler", e); } }
  return c;
}
