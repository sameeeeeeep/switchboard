#!/usr/bin/env node
// A tiny ZERO-DEPENDENCY MCP server (stdio) that reads Hacker News via its public Algolia API — NO auth,
// NO npm install (plain `node this.mjs`). It's a real, useful third-party tool for the launcher demo
// ("find me trending AI news") and a minimal template: implement initialize / tools/list / tools/call
// over newline-delimited JSON-RPC and you're a Switchboard third-party tool. Keys? None — public API.
import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "search_news",
    description:
      "Find trending / recent stories on Hacker News by topic — the front-page pulse for tech & AI news. " +
      "Great for 'what's trending in AI', 'latest on <topic>', 'top HN stories'. Returns titles, points, and links.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "the topic to search, e.g. 'AI' or 'LLM agents'. Optional — omit for the current front page." },
        limit: { type: "number", description: "how many stories (default 8, max 20)." },
      },
    },
  },
];

async function searchNews({ query, limit }) {
  const n = Math.min(Math.max(Number(limit) || 8, 1), 20);
  // `search` ranks by relevance+recency; no query → front-page (search_by_date on the story tag).
  const base = "https://hn.algolia.com/api/v1/search";
  const q = (query || "").trim();
  const url = `${base}?tags=story&hitsPerPage=${n}` + (q ? `&query=${encodeURIComponent(q)}` : "");
  const res = await fetch(url, { headers: { "user-agent": "switchboard-hn-tool" } });
  if (!res.ok) throw new Error(`Hacker News API ${res.status}`);
  const data = await res.json();
  const hits = Array.isArray(data.hits) ? data.hits : [];
  const summary = `Hacker News${q ? ` · “${q}”` : " · front page"}`;
  if (!hits.length) return envelope(summary, `No Hacker News stories found${q ? ` for “${q}”` : ""}.`, []);
  const items = hits.map((h) => {
    const title = h.title || h.story_title || "(untitled)";
    const pts = h.points ?? 0;
    const comments = h.num_comments ?? 0;
    const link = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`;
    const source = h.url ? hostOf(h.url) : "news.ycombinator.com";
    return { title, url: link, source, snippet: `${pts} points · ${comments} comments on Hacker News`, meta: `${pts} pts · ${comments} 💬` };
  });
  const text = `Trending on Hacker News${q ? ` · “${q}”` : ""}:\n\n` +
    items.map((it, i) => `${i + 1}. ${it.title}  —  ${it.meta}\n   ${it.url}`).join("\n\n");
  return envelope(summary, text, items);
}

function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ""); } catch { return "news.ycombinator.com"; } }
// The Switchboard results envelope — one JSON object as the tool's text content, so the notch renders
// result CARDS (title · source · snippet · link) instead of a raw text dump. `text` is the readable
// fallback that "Drop into chat" copies and a model reads. (See examples/tools/README-envelope.md.)
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
        reply(id, { protocolVersion: params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "hn", version: "0.1.0" } });
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
        if (name !== "search_news") { fail(id, `unknown tool: ${name}`); break; }
        const text = await searchNews(args);
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
