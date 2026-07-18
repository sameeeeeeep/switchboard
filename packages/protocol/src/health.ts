/**
 * Provider health — the setup ladder, answered by the EXTENSION from its own state.
 *
 * `claude_health` is the one method that must NEVER touch the daemon: the background worker
 * answers it locally (token stored? socket open+authed? did the last dial reach a listener?),
 * so it resolves fast (<1s) in every degraded state — including the ones where every other
 * method would fail. Surfaces (the connect chip, the in-page widget) render the ladder from
 * this snapshot instead of inferring it from request failures.
 *
 * The same shape is pushed as the `health` event whenever the ladder moves (socket open,
 * auth accepted/rejected, socket closed, pair/kill-switch), so surfaces upgrade AND downgrade
 * live without polling.
 */

/** Why a request would fail right now — carried as `data.reason` on a fast-failed
 *  PROVIDER_UNAVAILABLE (4900) error, and as `reason` on a degraded HealthStatus.
 *    • "unreachable" — the daemon's socket can't be opened (not installed, or not running).
 *      From the browser those are one state; the fix-it is "open the Relay app" with an
 *      install link as the fallback.
 *    • "unpaired"    — the daemon answered but there is no accepted pairing token (none
 *      stored, or the stored one was rejected). The fix-it is pairing in the side panel.
 *  Precedence: "unreachable" wins — pairing against a dead daemon is a dead end. */
export type HealthReason = "unreachable" | "unpaired";

/** The setup-ladder snapshot. `installed` is literally true: if a page can call
 *  claude_health at all, the extension exists — the SDK synthesizes `installed: false`
 *  itself when window.claude never appears (whenRelayReady's not-installed sentinel). */
export interface HealthStatus {
  /** The extension answered — always true on a real response. */
  installed: true;
  /** The daemon accepted a socket: an authed socket is open, or a probe dial reached it. */
  reachable: boolean;
  /** An accepted pairing exists: token stored AND not known-rejected by the daemon. */
  paired: boolean;
  /** THIS origin holds a grant. Daemon-derived, so only meaningful when `reachable`;
   *  reported false in every degraded state. */
  connected: boolean;
  /** Present iff degraded — the single reason to surface (see HealthReason precedence). */
  reason?: HealthReason;
}

/** The provider event name for live ladder transitions (window.claude.on(HEALTH_EVENT, …)). */
export const HEALTH_EVENT = "health" as const;
