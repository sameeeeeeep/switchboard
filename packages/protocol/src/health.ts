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

/** THE READINESS LADDER, as one strictly-ordered ordinal (docs/STATES.md §1). Rung N is meaningless
 *  until N−1 holds, so every surface renders the FIRST unmet rung and never re-derives its own answer.
 *  This is what stops the three health shapes (getStatus / widgetState / claude_health) from drifting
 *  apart — the drift that told owners of the app to "Get the sidekick" and read green while signed out.
 *
 *    no-extension  window.claude absent (SDK sentinel; HealthStatus is always `installed: true`)
 *    no-app        extension present, the Mac app has never been seen here
 *    app-asleep    app seen here, but the daemon isn't answering
 *    unpaired      daemon up, this browser holds no accepted pairing (incl. a rejected token)
 *    signed-out    paired, but Claude Code isn't signed in on this Mac (§4 — the invisible cliff)
 *    disconnected  signed in, but THIS origin holds no grant (per-origin; N/A to the panel)
 *    unmet         connected, but the grant lacks a connector the app needs (§5)
 *    ready         every rung holds */
export type Stage =
  | "no-extension" | "no-app" | "app-asleep" | "unpaired"
  | "signed-out" | "disconnected" | "unmet" | "ready";

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
  /** The FIRST unmet rung (see Stage). Every surface renders THIS and never re-derives — the
   *  ordinal makes "show only the first unmet thing" structural, so the surfaces cannot disagree.
   *  Optional only for wire back-compat with older extensions; always set on a real response. */
  stage?: Stage;
  /** Present iff degraded — the single reason to surface (see HealthReason precedence). */
  reason?: HealthReason;
  /** Whether the Relay app has EVER been seen from this browser (a token was stored, or a dial
   *  reached a daemon at some point). Distinguishes "never installed the app" from "app asleep" —
   *  the two states the ladder previously collapsed into one "unreachable", telling users who had
   *  never downloaded anything to "wake" a sidekick they didn't have. Optional: absent on older
   *  extensions; consumers treat absence as unknown, never as false. */
  installedHere?: boolean;
  /** The daemon is reachable but REFUSED our stored token — pairing is what's missing, not the app.
   *  A sub-detail of the `unpaired` rung: it lets a surface say "that token didn't match" instead of
   *  "not running". Distinct from a never-paired browser (no token at all). */
  tokenRejected?: boolean;
  /** Rung 4: Claude Code is signed in on this Mac. `false` shows the signed-out rung (framed per §3
   *  rule 4 as "we haven't seen a sign-in", reversible, never a dead end); `undefined` = not yet
   *  known (below rung 3, or a daemon too old to report it) → the rung is skipped, never asserted. */
  signedIn?: boolean;
}

/** The minimal boolean set `deriveStage` reasons over. A superset of what any one surface carries, so
 *  every surface can compute the same `stage` from whatever bits it holds. */
export interface StageInput {
  /** The extension is present. Only the SDK sets this false (the no-extension sentinel); within a
   *  HealthStatus it is always true, so callers may omit it. */
  installed?: boolean;
  /** The Mac app has been seen on this machine. Absent = unknown; treated as "not seen" only to pick
   *  no-app vs app-asleep, and only when the daemon is unreachable. */
  installedHere?: boolean;
  reachable: boolean;
  paired: boolean;
  /** Rung 4 (see HealthStatus.signedIn). `false` → signed-out; `true`/`undefined` → pass. */
  signedIn?: boolean;
  /** Rung 5. `false` → disconnected. `undefined` = not applicable (the panel is not an origin) → the
   *  ladder does not descend past sign-in, so an origin-less consumer tops out at `ready`. */
  connected?: boolean;
  /** Rung 6: what the connected origin's grant is missing (§5). Non-empty → unmet. */
  unmet?: readonly unknown[];
}

/** THE ONE DERIVATION. Given whatever ladder bits a surface holds, return the first unmet rung. Pure,
 *  shared, and total — the three consumers call this instead of each re-deriving "where am I?" (and
 *  getting different answers). Order mirrors the Stage doc exactly; each `return` is the first rung
 *  that fails, so nothing below it is even consulted. */
export function deriveStage(h: StageInput): Stage {
  if (h.installed === false) return "no-extension";
  // Below reachability the only question is whether the app is here at all. `installedHere || paired`
  // (you can't have paired without having had the app) separates "never downloaded" from "asleep".
  if (!h.reachable) return h.installedHere || h.paired ? "app-asleep" : "no-app";
  if (!h.paired) return "unpaired";
  if (h.signedIn === false) return "signed-out"; // undefined = unknown; never assert signed-out
  if (h.connected === false) return "disconnected"; // undefined = no origin in play → skip to ready
  if (h.unmet && h.unmet.length > 0) return "unmet";
  return "ready";
}

/** The provider event name for live ladder transitions (window.claude.on(HEALTH_EVENT, …)). */
export const HEALTH_EVENT = "health" as const;
