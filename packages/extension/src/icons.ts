/**
 * Shared connector identity + brand-icon helpers, used by the side panel AND the consent view (one
 * table so the two can never disagree about what "Higgsfield" looks like).
 *
 * Icons follow a strict privacy rule: real favicons come ONLY from Chrome's local `_favicon` cache
 * (the MV3 "favicon" permission) — never from a third-party favicon service, so no domain you use
 * ever leaks off the machine. Outside the extension (the mock preview) or when Chrome has no cached
 * icon, the curated glyph/monogram renders instead — same look as before, zero flash.
 */

export interface ConnectorInfo { key: string; label: string; color: string; hint: string }

// ---- friendly connector identities (framed as capabilities, not raw tool names) ----
export const CONNECTORS: Record<string, { label: string; color: string; hint: string }> = {
  higgsfield: { label: "Higgsfield", color: "#EE46BC", hint: "images" },
  shopify: { label: "Shopify", color: "#95BF47", hint: "store" },
  gmail: { label: "Gmail", color: "#EA4335", hint: "email" },
  drive: { label: "Drive", color: "#1FA463", hint: "files" },
  sheets: { label: "Sheets", color: "#1FA463", hint: "data" },
  meta: { label: "Meta Ads", color: "#1264FF", hint: "ads" },
  web: { label: "Web", color: "#4F8CFF", hint: "search" },
  clickup: { label: "ClickUp", color: "#7B68EE", hint: "tasks" },
  notion: { label: "Notion", color: "#37352F", hint: "pages" },
  github: { label: "GitHub", color: "#3D444D", hint: "code" },
  figma: { label: "Figma", color: "#A259FF", hint: "design" },
  slack: { label: "Slack", color: "#611F69", hint: "chat" },
  claude: { label: "Claude", color: "#D97757", hint: "ai" },
  granola: { label: "Granola", color: "#F59E0B", hint: "meetings" },
  huggingface: { label: "Hugging Face", color: "#FFB300", hint: "models" },
  linear: { label: "Linear", color: "#5E6AD2", hint: "issues" },
  canva: { label: "Canva", color: "#8B3DFF", hint: "design" },
};

// Recognisable brand marks for the connector tiles — simple line/solid glyphs drawn in white so they
// read on each connector's colour. Keyed by connector key; unknown connectors fall back to a monogram.
export const LOGOS: Record<string, string> = {
  web: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.7 2.6 2.7 15.4 0 18M12 3c-2.7 2.6-2.7 15.4 0 18"/></svg>`,
  higgsfield: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 1.5c.7 5.6 3.2 8.3 9 9-5.8.7-8.3 3.4-9 9-.7-5.6-3.2-8.3-9-9 5.8-.7 8.3-3.4 9-9z"/></svg>`,
  gmail: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/></svg>`,
  shopify: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"><path d="M6 7.5h12L19 20H5L6 7.5z"/><path d="M9 7.5a3 3 0 0 1 6 0"/></svg>`,
  meta: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"><path d="M6.5 8C4.3 8 3 10 3 12s1.3 4 3.5 4c2.9 0 4.2-8 8-8C19.7 8 21 10 21 12s-1.3 4-3.5 4c-2.9 0-4.2-8-8-8"/></svg>`,
  drive: `<svg viewBox="0 0 24 24" fill="#fff"><path d="M8.5 3h7l6.5 11.5-3.5 6h-6.9l3.4-6H4.5L8.5 3z" opacity=".92"/></svg>`,
  sheets: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9.5h16M4 15h16M10 9.5V21"/></svg>`,
  clickup: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5L12 5l7 7.5"/><path d="M6.5 16.5c1.5 1.9 3.3 2.9 5.5 2.9s4-.9 5.5-2.9"/></svg>`,
  notion: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"><rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M9 16.5v-9l6 9v-9"/></svg>`,
  github: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="6" r="2.1"/><circle cx="7" cy="18" r="2.1"/><circle cx="17" cy="8" r="2.1"/><path d="M7 8.1v7.8M17 10.1c0 3.2-3.6 3.3-7 4.2"/></svg>`,
  figma: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"><circle cx="15" cy="12" r="3"/><path d="M12 3.5H9a3 3 0 0 0 0 6h3zM12 3.5h3a3 3 0 0 1 0 6h-3zM12 9.5H9a3 3 0 0 0 0 6h3zM12 15.5H9a3 3 0 1 0 3 3z"/></svg>`,
  slack: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"><path d="M9.5 4.5v15M14.5 4.5v15M4.5 9.5h15M4.5 14.5h15"/></svg>`,
  claude: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"><path d="M12 3.5v17M4.6 7.5l14.8 9M19.4 7.5l-14.8 9"/></svg>`,
};

/** Which connector a raw MCP tool name belongs to (WebSearch/WebFetch fold into "web"). */
export function connectorOf(tool: string): ConnectorInfo | null {
  if (/^web(search|fetch)$/i.test(tool)) return { key: "web", ...CONNECTORS.web! };
  const m = tool.match(/mcp__claude_ai_([A-Za-z0-9]+)/i) || tool.match(/^([a-z]+)__/i);
  const raw = (m?.[1] || "").toLowerCase();
  if (!raw) return null;
  for (const key of Object.keys(CONNECTORS)) if (raw.includes(key)) return { key, ...CONNECTORS[key]! };
  return { key: raw, label: raw[0]!.toUpperCase() + raw.slice(1), color: "#C8F250", hint: "" };
}

/** Normalise an MCP server name ("claude_ai_Higgsfield") or connector key to the curated-map key. */
export const normalize = (raw: string): string =>
  raw.toLowerCase().replace(/^mcp__/, "").replace(/^claude_ai_/, "").replace(/[^a-z0-9]/g, "");

/** Curated connector → domain map for Chrome's LOCAL favicon cache. Never a remote favicon service. */
export const CONNECTOR_DOMAINS: Record<string, string> = {
  higgsfield: "higgsfield.ai",
  shopify: "shopify.com",
  gmail: "mail.google.com",
  google: "google.com",
  drive: "drive.google.com",
  sheets: "sheets.google.com",
  clickup: "clickup.com",
  granola: "granola.ai",
  notion: "notion.so",
  huggingface: "huggingface.co",
  facebook: "facebook.com",
  meta: "facebook.com",
  metaads: "facebook.com",
  claude: "claude.ai",
  claudeai: "claude.ai",
  anthropic: "claude.ai",
  github: "github.com",
  figma: "figma.com",
  canva: "canva.com",
  linear: "linear.app",
  slack: "slack.com",
};
export const connectorDomain = (key: string): string | undefined => CONNECTOR_DOMAINS[normalize(key)];

/** Plain-language scope verbs per connector — what an app can SEE vs DO, for the consent digest. */
export const VERBS: Record<string, { see?: string; do?: string }> = {
  higgsfield: { do: "generate images, video & audio" },
  shopify: { see: "your store, orders & customers", do: "edit products & inventory" },
  gmail: { see: "your email", do: "draft & label email" },
  web: { see: "the web (search & fetch)" },
  meta: { see: "your ad accounts & results", do: "create & edit ads" },
  drive: { see: "your Drive files" },
  sheets: { see: "your spreadsheets", do: "edit spreadsheets" },
  clickup: { see: "your tasks & docs", do: "create & edit tasks" },
  notion: { see: "your pages & databases", do: "edit pages" },
  github: { see: "your repos & issues", do: "write code & comments" },
  granola: { see: "your meeting notes" },
  slack: { see: "your channels & messages", do: "send messages" },
  figma: { see: "your design files" },
  linear: { see: "your issues", do: "create & edit issues" },
};

/** Kind marks for the context picker + consent context-pick — the taxonomy at a glance. */
export const KIND_MARKS: Record<string, string> = {
  project: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>`,
  data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 10v10"/></svg>`,
  personal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.2 3.7-4.8 7-4.8s5.8 1.6 7 4.8"/></svg>`,
};

// ---- Chrome's local favicon cache (feature-detected; the mock preview always takes the glyph path) ----
export const canFavicon =
  typeof chrome !== "undefined" && !!chrome.runtime?.id && typeof chrome.runtime.getURL === "function";

export const faviconUrl = (pageUrl: string, size = 32): string =>
  chrome.runtime.getURL("/_favicon/?pageUrl=" + encodeURIComponent(pageUrl) + "&size=" + size);

/** Draw an image 16×16 and return a comparable dataURL (same-origin, so the canvas stays clean). */
function iconHash(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = 16; c.height = 16;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 16, 16);
    return c.toDataURL();
  } catch { return null; }
}

// Chrome returns its generic globe for domains it has never seen; we detect that by comparing
// against a once-per-session probe of a domain that cannot exist, and keep the curated glyph.
let probe: Promise<string | null> | null = null;
function defaultFaviconHash(): Promise<string | null> {
  if (!canFavicon) return Promise.resolve(null);
  if (!probe) probe = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(iconHash(img));
    img.onerror = () => resolve(null);
    img.src = faviconUrl("https://sb-favicon-probe.invalid");
  });
  return probe;
}

/**
 * A brand chip: paints the curated glyph immediately (white SVG on the brand colour, else a letter
 * monogram), then — inside the extension, when a domain/pageUrl is known — overlays the REAL favicon
 * from Chrome's local cache once it loads and is distinct from the generic globe. Fallback chain:
 * glyph → cached favicon (fade in) → glyph again on error/unknown.
 */
export function brandIcon(o: {
  className?: string;
  pageUrl?: string;
  domain?: string;
  letter: string;
  color?: string;
  svg?: string;
}): HTMLElement {
  const box = document.createElement("div");
  if (o.className) box.className = o.className;
  if (o.color) box.style.background = o.color;
  box.style.position = "relative";
  box.style.overflow = "hidden";
  const gl = document.createElement("span");
  gl.className = "gl";
  if (o.svg) gl.innerHTML = o.svg;
  else gl.textContent = (o.letter || "•").slice(0, 1).toUpperCase();
  box.append(gl);

  let target = o.pageUrl ?? (o.domain ? `https://${o.domain}/` : undefined);
  if (target && !target.includes("://")) target = `https://${target}`;
  if (canFavicon && target) {
    const img = document.createElement("img");
    img.className = "favimg";
    img.alt = "";
    img.decoding = "async";
    img.onload = () => {
      void defaultFaviconHash().then((generic) => {
        if (!img.isConnected) return;
        const own = iconHash(img);
        if (!own || (generic && own === generic)) { img.remove(); return; } // unknown domain → keep the glyph
        box.classList.add("haslogo");
        box.style.background = "var(--raised-2, #20262F)";
        requestAnimationFrame(() => { img.style.opacity = "1"; });
      });
    };
    img.onerror = () => img.remove();
    img.src = faviconUrl(target);
    box.append(img);
  }
  return box;
}

/** Convenience: the standard chip for a known connector (curated glyph + cached favicon overlay). */
export function connectorGlyph(c: { key: string; label: string; color: string }, className: string): HTMLElement {
  return brandIcon({
    className,
    domain: connectorDomain(c.key),
    letter: c.label[0] ?? "•",
    color: c.color,
    svg: LOGOS[normalize(c.key)],
  });
}
