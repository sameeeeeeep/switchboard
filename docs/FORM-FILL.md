# Guided form fill

"Help me fill this form" from anywhere — the guide walks you field by field, each value pre-loaded on the
clipboard, so you just click the field and `⌘V`. Deterministic + local: **no tokens, nothing leaves the Mac.**

## Flow
1. Select the form and **⌘A ⌘C** (copy it).
2. Trigger: menu-bar dot → **"Fill a form from clipboard"** (or `touch ~/.relay/fill-form`, for scripts).
3. Switchboard reads the copied form + your **`~/.relay/identity.json`**, matches the fields it has data
   for *and* the form mentions, and raises a teach fill-guide — one step per field (`copy` = your value,
   `doneWhen: field-non-empty` so it auto-advances as you fill), with the "⌘V — ready" cursor hint.

## Your data — `~/.relay/identity.json`
Seeded on first use (name from your profile); fill the rest once:
```json
{ "name": "…", "email": "…", "phone": "…", "address": "…",
  "city": "…", "state": "…", "zip": "…", "company": "…", "website": "…" }
```
Only fields with a value are offered; a field you have no data for is skipped (never invented).

## Matching
Deterministic label/synonym match (Name, Email, Phone, Address, City, State, Zip, Company, Website — each
with common synonyms like e-mail / mobile / postal code / organization). Good for standard forms.

## Rules
- **Secrets never go on the clipboard** — no passwords/API keys in identity.json; those stay manual.
- Nothing is sent anywhere — it's a local match + the local guide runtime.

## Upgrade path (not built)
For exotic forms, a God pass (`⌃⌃` "fill this form") can map fields with the LLM (God reads the clipboard
+ your Bank/identity) and emit the same fill-guide — smarter matching at the cost of a completion. The
deterministic native path above is the zero-token default.
