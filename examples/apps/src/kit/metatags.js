// META TAGS — the pure builder behind "generate the <head> meta tags for this page".
//
// Harvested-idea sibling of kit/qr-payload.js: deterministic, in-tab, no-model string generation.
// A handful of fields → the SEO + Open Graph + Twitter Card block people copy into their <head>.
// The load-bearing detail is ESCAPING: a title with a quote or an & must not break out of the
// attribute, so every value goes through htmlAttr. Pure + tested (kit/metatags.test.mjs).

/** Escape a value for an HTML double-quoted attribute. `&` first so we don't double-escape. */
function attr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const has = (s) => String(s ?? "").trim() !== "";
const t = (s) => String(s ?? "").trim();

/** The field set the UI drives; declaring it here keeps the form and the builder in step. */
export const FIELDS = [
  { k: "title", label: "Title", ph: "My Page — a short, specific title", wide: true },
  { k: "description", label: "Description", ph: "One or two sentences, ~155 characters.", wide: true },
  { k: "url", label: "Canonical URL", ph: "https://example.com/page" },
  { k: "image", label: "Preview image URL", ph: "https://example.com/card.png" },
  { k: "siteName", label: "Site name", ph: "Example" },
  { k: "type", label: "OG type", ph: "website" },
  { k: "twitterCard", label: "Twitter card", options: ["summary_large_image", "summary"] },
  { k: "twitterSite", label: "Twitter @site", ph: "@example" },
  { k: "themeColor", label: "Theme colour", ph: "#0A0C10" },
];

/** Build the meta-tag block. Returns a string of `<meta …>` / `<title>` / `<link>` lines, omitting
 *  every field the caller left blank (a page with an empty og:image is worse than none). */
export function build(f = {}) {
  const lines = [];
  const meta = (attrName, attrVal, content) => { if (has(content)) lines.push(`<meta ${attrName}="${attr(attrVal)}" content="${attr(content)}">`); };

  if (has(f.title)) lines.push(`<title>${attr(t(f.title))}</title>`);
  meta("name", "description", f.description);
  if (has(f.url)) lines.push(`<link rel="canonical" href="${attr(t(f.url))}">`);
  meta("name", "theme-color", f.themeColor);

  // Open Graph
  if (hasAny(f, ["title", "description", "url", "image", "siteName", "type"])) lines.push("");
  meta("property", "og:title", f.title);
  meta("property", "og:description", f.description);
  meta("property", "og:type", has(f.type) ? f.type : (hasAny(f, ["title", "url", "image"]) ? "website" : ""));
  meta("property", "og:url", f.url);
  meta("property", "og:image", f.image);
  meta("property", "og:site_name", f.siteName);

  // Twitter — only when there's actually something to preview, so an empty form stays empty rather
  // than emitting a lone twitter:card (the card type has a non-empty default, which would leak).
  if (hasAny(f, ["title", "description", "image"])) {
    const card = has(f.twitterCard) ? f.twitterCard : (has(f.image) ? "summary_large_image" : "summary");
    lines.push("");
    meta("name", "twitter:card", card);
    meta("name", "twitter:site", f.twitterSite);
    meta("name", "twitter:title", f.title);
    meta("name", "twitter:description", f.description);
    meta("name", "twitter:image", f.image);
  }

  return lines.join("\n").replace(/\n\n+/g, "\n\n").replace(/^\n+|\n+$/g, "");
}
function hasAny(f, keys) { return keys.some((k) => has(f[k])); }

/** A tiny live-preview model of the social card, so the UI can show what it'll look like. */
export function preview(f = {}) {
  return {
    title: t(f.title) || "Untitled page",
    description: t(f.description) || "No description set.",
    host: (() => { try { return new URL(t(f.url)).host; } catch { return t(f.url) || "example.com"; } })(),
    image: t(f.image),
    hasImage: has(f.image),
  };
}
