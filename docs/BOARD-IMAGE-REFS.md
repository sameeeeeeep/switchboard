# Board reference images — Gate-A SPEC

**Status:** Gate A (spec only — NOT built). Card: `~/SwitchboardBrain/tasks.md` → "board should save REFERENCE IMAGES…" (epic:capture).

## Primary outcome (one sentence)

When a board card is captured with an attached image, the actual pixels are persisted to
`~/SwitchboardBrain/refs/<id>.<ext>` and linked from the card, so the reference image survives — viewable —
to the moment a later session picks the task up, instead of decaying to a text description.

## The hard question first: can a `/task` (Claude Code) session save the pasted image bytes?

**No — the `/task` slash-command path fundamentally cannot persist a pasted image, and the spec must not pretend it can.**

Grounded in this repo:

- When a user pastes/attaches an image into the Claude Code CLI, it reaches the model as an **image content
  block (base64 in the message transport)**. The session *sees* it (vision-in), but no tool returns those raw
  bytes as a file path or a writable value. `Write` takes text; `Bash` has no handle to the paste buffer. There
  is no `save_pasted_image(path)` primitive. The model can only *describe* what it sees or, at best, re-encode a
  lossy re-render — never the original bytes. So the CLI capture leg is a **vision-only, byte-less** leg.
- Contrast the surfaces that DO hold the pixels:
  - **Native notch capture** (`packages/menubar/RelayMenuBar.swift`): `GodRef { kind: file | screenshot | clipboard }`
    already carries a real on-disk `path` — a dropped file's URL (`.onDrop(of:[.fileURL])`, "Drop a file on the
    notch"), a `screencapture` jpg (region or full), or a clipboard image (`NSPasteboard`) written to disk. The
    native app has bytes today.
  - **Daemon attachment path** (`packages/sidekick/src/backends/claude-code.ts`, `server.ts`): attachments arrive
    as `{ handle, filename, contentType, dataUrl }`; `imageSourceFromDataUrl` decodes the base64, and
    `relay__put_blob` already persists attachment bytes. Anything routed through the daemon (extension, bridge,
    native God capture) has decodable bytes.
  - **Phone companion** (`epic:capture`, TeamRoom Durable Object, `packages/sidekick/src/team/*`): the phone can
    `{put:<encrypted blob>}`; the Mac host drains via `{fetch:since}`. The blob can be the image itself.

**Conclusion / ownership:** persistence is owned by the surfaces that hold the pixels — **native notch capture
(primary), the daemon attachment/`put_blob` path, and the phone companion**. The `/task` skill's role shrinks to
**writing the link when a surface hands it an already-saved file path** (e.g. `refs/ax12.png`). When a `/task`
CLI session has only a pasted visual and no path, it must NOT claim to have saved it: it captures the card, records
`ref:pending` + a one-line visual description, and instructs the user how to attach the real file (drop on notch /
`refs/` drop / phone). Honesty over a silent lossy save.

## Storage & link format

- **Files:** `~/SwitchboardBrain/refs/<id>.<ext>` where `<id>` is a short slug (e.g. `<yyyymmdd>-<6char>`),
  `<ext>` ∈ {png, jpg, jpeg, gif, webp} (the vision-decodable set). `refs/` is created on first use.
- **Card link (dialect-native):** reuse the existing embed the board already uses for spec images —
  `![[refs/<id>.png]]` (Obsidian wikilink embed; cf. `![[specs/launcher-home.png]]` on the launcher card). It
  renders inline in Bank/Obsidian and resolves to the file. A `ref:<id>.<ext>` token MAY also sit inline on the
  card body for machine lookup, but the embed is the human-facing survivor.
- **Pending marker:** `ref:pending` (no bytes yet) so a later surface / session can fill it in.

## All states

- **No image** — unchanged; plain text card. No `refs/` write, no link.
- **One image** — save to `refs/<id>.<ext>`; append `![[refs/<id>.<ext>]]` as a detail line.
- **Multiple images** — one file each (`<id>-1`, `<id>-2`, …); one embed line per image, in attach order.
- **Huge image** — cap the stored file (downscale longest edge to a sane bound, keep aspect); keep the original
  only if under a size ceiling. Never block capture on a large image; degrade to a downscaled copy.
- **Unsupported format** (HEIC/HEIF/PDF/etc.) — the vision API decodes only jpeg/png/gif/webp
  (`claude-code.ts` explicitly drops HEIC/HEIF). Transcode to PNG/JPEG on save when the surface can; if it can't,
  store the original bytes verbatim under its real extension and mark `ref:<id> (unrendered)` so nothing is lost
  even if it won't preview.
- **Image but no bytes-access** (the `/task` CLI hard case) — DO NOT fabricate a save. Capture the card, write
  `ref:pending` + a one-line description, and tell the user how to attach the real file. Reconcilable later.
- **Card deleted (cleanup)** — deleting/completing a card does NOT eagerly delete its `refs/` files (a sibling
  card or a spec may reference them). Reversibility first. Reclamation is a separate, opt-in GC pass: sweep
  `refs/` for files no card links and older than a grace window; that GC is its own future card, not this one.
- **Duplicate image** — content-hash the bytes; if an identical file already exists in `refs/`, link the existing
  `<id>` instead of writing a second copy (idempotent).

## Reversibility

- Capture is additive: a card + copied file(s). Removing the embed line and/or the `refs/` file returns to the
  prior text-only state.
- Deletion of a card never destroys pixels (see cleanup). Nothing here hard-deletes.

## Order / idempotency

- Same image captured twice → one file (hash-dedup), stable `<id>`.
- Re-running the link write is idempotent: the embed line is keyed by `<id>`; don't append a duplicate embed for
  an id already present on the card.
- Multi-image order is the user's attach order and is preserved in the embed lines.

## Edges

- `refs/` missing → create it (mirrors `mkdir -p` of the vault in the `/task` skill).
- Filename collision on `<id>` → the id is unique (date+random); on the rare clash, suffix `-2`.
- Vault is not `~/SwitchboardBrain` (`$SWITCHBOARD_VAULT` set) → `refs/` lives under the resolved vault, alongside `tasks.md`.
- Image arrives *after* the card was captured (pending → filled) → find the `ref:pending` card, replace with the
  embed; no new card.
- Corrupt/zero-byte image → skip the file, keep `ref:pending`, note it; never write a broken embed.

## Ownership summary (given the bytes reality)

| Surface | Has bytes? | Role |
|---|---|---|
| Native notch capture (drop / screencapture / clipboard) | Yes | **Primary owner** — saves to `refs/`, writes the embed |
| Daemon attachment path (`put_blob`, dataUrl) | Yes | Persists bytes for extension/bridge/God captures |
| Phone companion (TeamRoom DO blob) | Yes | Carries the image blob; Mac host drains it into `refs/` |
| `/task` slash (Claude Code CLI) | **No** | Writes the LINK when handed a path; else `ref:pending` + description. Never a lossy save. |
