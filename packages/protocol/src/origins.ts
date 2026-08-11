/**
 * VERIFIED (first-party) origins — the sites the Switchboard team publishes and ships.
 *
 * A "verified" badge tells the user this app is an official Switchboard property they can trust with
 * their Claude, versus any arbitrary page that could also request access. It is deliberately NARROW:
 * only our own domains, https only. It is NOT "is this in the extension's manifest allowlist" — that
 * list also carries third-party sites the "act on this tab" widget can drive (facebook, canva, …),
 * which are explicitly NOT first-party and must never read as verified.
 *
 * Keep this in lockstep with the first-party entries in packages/extension/manifest.json.
 */
const VERIFIED_DOMAINS = ["thelastprompt.ai", "sameep.ai"] as const;
const VERIFIED_EXACT = ["sameeeeeeep.github.io"] as const;

/** True iff `origin` is an official first-party Switchboard site (exact domain or a subdomain),
 *  over https. Bad/relative/non-https origins are never verified. */
export function isVerifiedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let host: string;
  let protocol: string;
  try {
    const u = new URL(origin);
    host = u.hostname.toLowerCase();
    protocol = u.protocol;
  } catch {
    return false;
  }
  if (protocol !== "https:") return false;
  if ((VERIFIED_EXACT as readonly string[]).includes(host)) return true;
  return VERIFIED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}
