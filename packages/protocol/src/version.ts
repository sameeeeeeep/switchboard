/**
 * BYOP — the Bring-Your-Own-Provider protocol. Versioned like EIP-1193 so third
 * parties can build against a stable contract and feature-detect via capabilities.
 *
 * The wire protocol version is independent of any package's npm version. Bump the
 * MINOR when adding backward-compatible methods/events; bump MAJOR on a breaking
 * change to an existing method's params/results or an event's payload.
 */
export const BYOP_VERSION = "1.2.0" as const;

/** The property the extension injects the provider onto. Kept as `claude` for the
 *  adoption wedge even though the daemon can route to non-Claude backends; a neutral
 *  alias (e.g. `window.ai`) may be added later without breaking this one. */
export const PROVIDER_GLOBAL = "claude" as const;
