#!/usr/bin/env node
// A ZERO-DEPENDENCY web-search MCP server (stdio) — NO auth, NO npm install (plain `node this.mjs`).
// God's "ask across work" has no live web; this is the no-LLM, keys-local web-search shape the founder
// wants: type an intent, get real results in the notch, instantly (no model in the loop). It reads two
// PUBLIC, no-key JSON APIs and merges them: DuckDuckGo Instant Answer (entities/definitions/quick facts)
// + Wikipedia search (reliable breadth). Honest about scope: this is "the open web's public answers,"
// not a full crawler — but it needs no key and never leaves the doctrine (keys-local, public API).
//
// It speaks the Switchboard RESULTS ENVELOPE (see examples/tools/README-envelope.md): the tool's text
// content is a JSON object { _switchboard:"results", summary, text, items:[{title,url,source,snippet,meta}] }
// so the notch renders result CARDS (not a raw text dump); `text` is the readable fallback that "Drop
// into chat" copies and that a model reads. A tool that omits the envelope still renders as plain text.
import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "web_search",
    description:
      "Search the open web for a topic and get titles, sources, and snippets — the public web's answers, " +
      "no key. Great for 'what is <x>', 'latest on <topic>', 'find <thing>', 'search the web for …'. " +
      "Merges Wikipedia + DuckDuckGo instant answers. Returns ranked results with links.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "what to search for, e.g. 'apple vision pro' or 'RAG vs fine-tuning'." },
        limit: { type: "number", description: "how many results (default 8, max 20)." },
      },
      required: ["query"],
    },
  },
];

const UA = { "user-agent": "switchboard-websearch-tool" };

// DuckDuckGo Instant Answer — best for a single entity/definition + a cluster of related links.
async function ddg(q) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&no_redirect=1&t=switchboard`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return [];
  const d = await res.json();
  const out = [];
  if (d.AbstractText) {
    out.push({
      title: d.Heading || q,
      url: d.AbstractURL || "",
      source: hostOf(d.AbstractURL) || d.AbstractSource || "duckduckgo.com",
      snippet: d.AbstractText,
      meta: "instant answer",
    });
  }
  const flatten = (arr) => {
    for (const t of arr || []) {
      if (t.Topics) { flatten(t.Topics); continue; }   // nested category
      if (!t.Text || !t.FirstURL) continue;
      out.push({ title: firstSentence(t.Text), url: t.FirstURL, source: hostOf(t.FirstURL) || "duckduckgo.com", snippet: t.Text, meta: "related" });
    }
  };
  flatten(d.RelatedTopics);
  return out;
}

// Wikipedia full-text search — reliable breadth for most queries; always returns something on-topic.
async function wikipedia(q, n) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}` +
              `&srlimit=${n}&format=json&origin=*`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return [];
  const d = await res.json();
  const hits = d?.query?.search || [];
  return hits.map((h) => ({
    title: h.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
    source: "en.wikipedia.org",
    snippet: stripTags(h.snippet),
    meta: "Wikipedia",
  }));
}

function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } }
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim(); }
function firstSentence(s) { const t = String(s || "").trim(); const i = t.indexOf(" - "); return i > 0 ? t.slice(0, i) : (t.length > 80 ? t.slice(0, 80) + "…" : t); }
function dedupe(items) {
  const seen = new Set(), out = [];
  for (const it of items) { const k = it.url || it.title; if (!k || seen.has(k)) continue; seen.add(k); out.push(it); }
  return out;
}

async function webSearch({ query, limit }) {
  const q = String(query || "").trim();
  const n = Math.min(Math.max(Number(limit) || 8, 1), 20);
  if (!q) return envelope("Search the web", "Type what you want to find.", []);
  // Run both in parallel; DDG's instant answer floats to the top, Wikipedia fills the breadth.
  const [d, w] = await Promise.all([ddg(q).catch(() => []), wikipedia(q, n).catch(() => [])]);
  const items = dedupe([...d, ...w]).slice(0, n);
  if (!items.length) return envelope(`Web · “${q}”`, `No results found for “${q}”.`, []);
  const text = items.map((it, i) => `${i + 1}. ${it.title}  —  ${it.source}\n   ${it.snippet}\n   ${it.url}`).join("\n\n");
  return envelope(`Web · “${q}”`, `Results for “${q}”:\n\n${text}`, items);
}

// The Switchboard results envelope — one JSON object as the tool's text content.
function envelope(summary, text, items) {
  return JSON.stringify({ _switchboard: "results", summary, text, items });
}

// ── minimal MCP stdio protocol (newline-delimited JSON-RPC 2.0) ──────────────────────────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function fail(id, message) { send({ jsonrpc: "2.0", id, error: { code: -32000, message } }); }

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try { msg = JSON.parse(s); } catch { return; }
  const { id, method, params } = msg;
  try {
    switch (method) {
      case "initialize":
        reply(id, { protocolVersion: params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "websearch", version: "0.1.0" } });
        break;
      case "notifications/initialized":
      case "notifications/cancelled":
        break; // notifications get no response
      case "tools/list":
        reply(id, { tools: TOOLS });
        break;
      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments || {};
        if (name !== "web_search") { fail(id, `unknown tool: ${name}`); break; }
        const text = await webSearch(args);
        reply(id, { content: [{ type: "text", text }] });
        break;
      }
      case "ping":
        reply(id, {});
        break;
      default:
        if (id != null) fail(id, `unknown method: ${method}`);
    }
  } catch (e) {
    if (id != null) fail(id, String(e?.message || e));
  }
});
