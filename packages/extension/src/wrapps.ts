/**
 * The wrapp registry + host helpers, shared by the side panel and the in-page widget (one source of
 * truth so the two never disagree about what a wrapp replaces). `alternativeTo` lists the sites a
 * wrapp can stand in for — the domains the in-page widget appears on to offer "run this on your own
 * Claude instead." Keep the widget's manifest `matches` in sync with these hosts.
 */
export interface Wrapp { name: string; desc: string; url: string; color: string; alternativeTo?: string[] }

export const WRAPPS: Wrapp[] = [
  { name: "brandbrain", desc: "Build & operate consumer brands", url: "https://brandbrain.thelastprompt.ai/build", color: "#C8F250" },
  { name: "ideabrain", desc: "Validate an idea — research, playbook, deck, reach-outs", url: "https://brandbrain.thelastprompt.ai/build?studio=idea", color: "#C8F250" },
  { name: "AdPulse", desc: "Meta ads post-mortem in 30 seconds", url: "https://adpulse.thelastprompt.ai", color: "#FFB224", alternativeTo: ["adsmanager.facebook.com"] },
  { name: "AdForge", desc: "URL in, Meta ads out", url: "https://adforge.thelastprompt.ai", color: "#FF6A2B", alternativeTo: ["adcreative.ai"] },
  { name: "Shelf", desc: "Your inventory, triaged", url: "https://shelf.thelastprompt.ai", color: "#E8B34B" },
  { name: "Studio", desc: "Product shots without the studio", url: "https://studio.thelastprompt.ai", color: "#E4572E", alternativeTo: ["photoroom.com", "pebblely.com"] },
  { name: "A-Plus", desc: "Amazon A+ content in one pass", url: "https://aplus.thelastprompt.ai", color: "#F0B429" },
  { name: "NATAL", desc: "Your chart, read bluntly", url: "https://natal.thelastprompt.ai", color: "#EDEDF5", alternativeTo: ["costarastrology.com"] },
  { name: "Arcana", desc: "Three cards, no mercy", url: "https://arcana.thelastprompt.ai", color: "#C9A227" },
  { name: "Cartridge", desc: "Form → playable game", url: "https://cartridge.thelastprompt.ai", color: "#FF2E97" },
  { name: "Bank", desc: "Notes, tasks & your library — one place that knows things", url: "https://bank.thelastprompt.ai", color: "#8FA3C8", alternativeTo: ["notion.so", "obsidian.md", "www.notion.so"] },
  { name: "Cast", desc: "AI personas that stay on-model", url: "https://cast.thelastprompt.ai", color: "#FF5A3C", alternativeTo: ["spira.ai", "app.spira.ai", "arcads.ai", "captions.ai"] },
  { name: "Prism", desc: "Generate on-brand images", url: "https://prism.thelastprompt.ai", color: "#4F46E5", alternativeTo: ["canva.com", "figma.com", "adobe.com", "leonardo.ai"] },
  { name: "Ad generator", desc: "Ads from your brand", url: "https://adgen.thelastprompt.ai", color: "#EE46BC", alternativeTo: ["business.facebook.com", "ads.tiktok.com"] },
];

/** The host of an origin/URL string (bare or with scheme), or the input back on failure. */
export const host = (o: string): string => { try { return new URL(o.includes("://") ? o : `https://${o}`).host; } catch { return o; } };

/** Do two hosts refer to the same site (either is a subdomain of the other)? */
export const hostMatch = (a: string, b: string): boolean => a === b || a.endsWith("." + b) || b.endsWith("." + a);

/** Every distinct host any wrapp is an alternative to — the domains the in-page widget runs on. */
export const alternativeHosts = (): string[] => [...new Set(WRAPPS.flatMap((w) => w.alternativeTo ?? []))];
