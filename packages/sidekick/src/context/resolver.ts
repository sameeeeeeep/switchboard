/**
 * Source resolver — turns an external CSV (a published Google Sheet, or any CSV URL) into JSON rows.
 * The daemon fetches it directly (Node fetch), so a spreadsheet the user already keeps becomes live
 * shared context with zero new infra. Read-only, cached upstream by the library/Broker.
 *
 * SSRF guard: only public http(s) hosts — never localhost / private / link-local ranges — so a source
 * URL can't be used to probe the user's internal network.
 */

export interface ResolvedSheet {
  columns: string[];
  rows: Record<string, string>[];
  rowCount: number;
  fetchedAt: number;
}

const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|::1|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?f[cd][0-9a-f:]*|\[?fe80[0-9a-f:]*)$/i;

export function assertPublicUrl(url: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("invalid source URL"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("source URL must be http(s)");
  if (PRIVATE_HOST.test(u.hostname)) throw new Error("refusing to fetch a private/internal address");
  return u;
}

/** RFC4180-ish CSV parse: handles quoted fields with commas, quotes ("") and newlines. First
 *  non-empty row is the header; each subsequent row becomes an object keyed by the headers. */
export function parseCsv(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); records.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); records.push(row); }
  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!nonEmpty.length) return { columns: [], rows: [] };
  const columns = nonEmpty[0]!.map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    columns.forEach((k, i) => { if (k) o[k] = (r[i] ?? "").trim(); });
    return o;
  });
  return { columns, rows };
}

/** Fetch a CSV URL and parse it. `fetchImpl` is injectable for tests. */
export async function resolveCsv(url: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {}): Promise<ResolvedSheet> {
  assertPublicUrl(url);
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await f(url, { signal: ctrl.signal, redirect: "follow" } as RequestInit);
    if (!res.ok) throw new Error(`source fetch failed (${res.status})`);
    const text = await res.text();
    if (text.length > (opts.maxBytes ?? 5_000_000)) throw new Error("source is too large");
    const { columns, rows } = parseCsv(text);
    return { columns, rows, rowCount: rows.length, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}
