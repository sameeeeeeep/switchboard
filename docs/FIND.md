# FIND — the private, local vault lookup (`vault.find`)

> "If I want the GST number of nailinit I shouldn't have to search it every time — I could just use
> dictation and through a modifier key make it FIND info, WITHOUT it getting passed through the Claude
> call." — the founder

`vault.find` is a **local, deterministic** lookup over the user's markdown vault. You hand it a
natural-ish query — `"GST number of nailinit"`, `"nailinit gst"`, `"nailinit insta"` — and it returns
the matched value, pulled straight from the local `.md`, ready to paste at the cursor. **Zero tokens,
zero egress.**

## The privacy guarantee (the whole point)

`vault.find` reads **only the local vault**, runs **only in the daemon**, and returns a value that
**never enters any LLM prompt and never leaves the machine.**

- **No model call.** The resolver is pure string work over bytes already on disk (tokenize, parse
  markdown fields, score). It never invokes Claude or any local model.
- **No network.** It touches no socket, fetches no URL, resolves no source. Nothing egresses.
- **No shelling out.** It runs entirely in-process.
- **Reads through the StorageStore.** It calls `store.list(origin)` + `store.get(origin, key)` — the
  same per-origin path every read uses — so it can only ever see the origin's **own** bound vault (or
  its private sandbox). It never reads arbitrary disk paths, and per-origin isolation is unchanged.
- **No telemetry of the query or value.** The audit log records only that a lookup happened and
  whether it hit or missed (with the confidence number) — **never the query text and never the
  matched value.** Logging those would be telemetry of exactly the private thing we promised to keep
  local.

Because it is a **read** over the origin's own vault, it is gated exactly like `storage.get`: a
standing Connect grant is required, but there is **no new per-action consent prompt** (reads within an
origin's own vault are already permitted). Compare `set`/`bind`/`pick`, which are write-class and do
raise a consent card.

## Protocol

**Method:** `vault.find`

**Params:**

```ts
{ query: string, project?: string }
```

- `query` — the natural-ish lookup string. Required, non-empty.
- `project` — optional. Scopes the search to notes belonging to that project (matches
  `project-<slug>.md`, `<slug>.md`, or any key whose name contains the slug).

**Returns:**

```ts
{ value: string, field: string, entity: string, source: string, confidence: number } | null
```

- `value` — the matched value, ready to paste (e.g. `"27ABCDE1234F1Z5"`).
- `field` — the note field label it came from (e.g. `"GST"`).
- `entity` — the note's display name (e.g. `"nailinit"`).
- `source` — the vault key it was read from (e.g. `"nailinit.md"`).
- `confidence` — `0..1`. Below threshold the whole result is `null` — we return **null rather than
  guess**.

`null` means "no confident match" (unknown entity, unknown field, empty/garbage query, or an empty
vault). The handler **never throws for a malformed note** — one bad file degrades to `null`, it does
not break a lookup.

### How the native app calls it

The native app (dictation + a FIND modifier key) sends a request envelope over its listener, exactly
like any other daemon verb — the daemon stamps the authoritative `origin`:

```jsonc
// request
{ "type": "request", "id": "…", "origin": "https://nailinit.localhost:5174",
  "method": "vault.find", "params": { "query": "GST number of nailinit" } }

// response
{ "type": "response", "id": "…",
  "result": { "value": "27ABCDE1234F1Z5", "field": "GST", "entity": "nailinit",
              "source": "nailinit.md", "confidence": 1 } }
```

The app takes `result.value` and pastes it at the cursor. Nothing round-trips through a model.

## Resolution strategy (deterministic)

Implemented in `packages/sidekick/src/storage/find.ts` (`resolveFind`). No fuzzy-match dependency — a
small in-house scorer (token overlap + normalized edit distance) is plenty.

1. **Tokenize** the query and drop stopwords. Separate a likely **entity** (a token that matches a
   note's title / filename / `# H1` — e.g. `"nailinit"`) from the remaining **field** tokens (e.g.
   `"gst"`, `"gst number"`). Field-name noise (`number` / `no` / `#`) is stripped so `"gst"` ≈
   `"gst number"`.
2. **Load candidate notes** through the store. If `project` is given, scope to it; else prefer the
   matched entity's note; else (a bare field query like `"gst"`) fall back to the whole vault. Parse
   fields from each note's markdown, tolerating the common vault dialects:
   - `**Field:** value`
   - `- **Field:** value`
   - `Field: value` (plain / front-matter-ish `key: value`)
   - `| Field | value |` (two-column table rows)

   (The `**key:** value` parsing idea is borrowed from `examples/apps/src/bank.js` ~line 630 — read
   for reference, not imported.)
3. **Fuzzy-match the field name** — case / space / `number` / `no.` / `#` insensitive, so
   `"gst"` ≈ `"gst number"` ≈ `"gstin"` and `"insta"` ≈ `"instagram"` (prefix/substring containment
   scores high). The best value is returned with a **confidence** that blends the field match with
   how certain the entity is. Below the confidence threshold it returns **null** rather than guessing.

## Follow-on (not built here)

Sensitive fields — GST, bank details, API keys — should eventually live in an **encrypted,
consent-gated `sb_secrets` tier** rather than in plaintext `.md`. When that tier exists, `vault.find`
should become the **read path** that pulls from it (same protocol, same privacy guarantee), so the
FIND modifier key transparently resolves secrets without the value ever entering a prompt or leaving
the machine.
