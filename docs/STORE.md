# The Switchboard store — consumer-first, App-Store-grade

Status: design. References: Apple App Store (layout language) + Wispr Flow (consumer-polish bar). See [[GOD-HANDS]] for the notch/widget side.

## The thesis (why this exists)
OSS and AI tools are built **dev-first**. Even when a consumer manages to install one, they can't actually *use* it — it's a repo, not a product. Switchboard closes that gap: every wrapp is **one-click, private, runs on your own AI (zero extra cost)** — and it *feels* like a polished consumer app (Wispr Flow), not a developer tool. That feel is the moat as much as the broker is.

## The store is two-level (like the App Store)
1. **Featured page (the front door)** — a curated page BEFORE the full catalog:
   - Big 2-up **hero cards** (eyebrow + title + subtitle + art): "APPS WE LOVE", "GET STARTED / your first wrapp", spotlights.
   - Rows like **"Apps we love right now"** / **"New skills"** — each row: real app **icon** · name · one-line tagline · **Get** button · "See All".
   - Sections: Featured · Founder · Creator · Personal · Dev · Fun · **Skills** (populated from public registries).
2. **All apps** — "See All" → the full grid/list, searchable, by category.

Craft laws (from the Wispr reference): **sticky footer** so primary actions never scroll away · honest, consistent margins/padding · **real designed icons** per wrapp (not glyph fallbacks) · hero banners with a clear CTA · cards with one recommended.

## What a wrapp is made of: capability + skill + UI
A wrapp = **a capability + a skill + a UI**, and installing it wires all three:
- **Capability** — a small reusable primitive you give a face to (create-HTML, transcribe, image-gen, web-fetch, screen-vision…). Composable; many wrapps share the same few capabilities.
- **Skill** — the prompt/know-how on top (a `SKILL.md`) that aims the capability at a job. **Embedded in the wrapp** — installing the wrapp adds its skill (and you can also add standalone skills).
- **UI** — the widget/window face.

So: install "LinkedIn Writer" → the create-HTML + vision capabilities get wired AND the "write a LinkedIn post" skill is added. You can add skills à la carte or as part of a wrapp. (Scoping the added skill to the right session/thread is the open plumbing question — the skill rides with the wrapp's grant.)

### The HTML capability (fast, free, own-Claude)
Claude can write **HTML/SVG instantly** — so diagrams, thumbnails, quick illustrative images don't need a slow image model: generate HTML → render to PNG (the exact WKWebView/`ImageRenderer` snapshot path we already use for widgets) → show in the notch → **drag it out**. A "Diagram/Sketch/Thumbnail" capability that's sub-second and costs nothing. This is a keystone capability many wrapps compose (a LinkedIn post's header image, a doc's chart, a slide).

### Place-aware invocation
God knows **where you are** (active app / screen). On LinkedIn, "write about this" → it understands the surface, drafts the post, and can make a thumbnail diagram via the HTML capability — no app-switching. The notch is the command center; context comes from what's in front of you.

## A flagship wrapp = Wispr-grade
Dictation (Flow) is the proof: not a hardcoded native feature but an **installed store wrapp** with the full experience — sidebar nav (Dictation · Insights · Dictionary · Snippets · Style · Transforms · Scratchpad), shortcuts config (push-to-talk, hands-free, command mode), an Insights dashboard (WPM, fixes, streak heatmap). Other wrapps aspire to this bar; the widget is the glanceable slice, the full app is this.

## Interaction laws (the notch is the command center) — see [[GOD-HANDS]]
- **Install** = one click; the wrapp appears and God can now use it.
- **On open** the notch lights up and God **concierges** the wrapp ("here's what this does, try…") — never a silent launch.
- **Uninstalled command** → God offers to **install first**, then runs it. No dead ends.
- **Skills** are one-click too — the click must actually run the skill (today it hangs at "thinking" → bug to fix).

## Build order
1. Featured page layout (this doc's #1) — snapshot-previewed to the Apple reference, then ported.
2. Real per-wrapp icons across the catalog.
3. Populate Skills from registries (one-click, private).
4. Fix the skill-launch hang.
5. Dictation as a full Wispr-grade wrapp listing.
6. The interaction laws (install → concierge → widget; uninstalled → offer install).
