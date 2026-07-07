/**
 * Provider events, delivered via window.claude.on(event, handler). EIP-1193 style.
 */
import type { OriginGrant } from "./permissions.js";
import type { StreamDelta } from "./completion.js";

export interface BYOPEvents {
  /** Origin became connected (approved). Payload is the granted scope. */
  connect: OriginGrant;
  /** Origin was disconnected or revoked; the page should stop making requests. */
  disconnect: { reason: "user-revoked" | "kill-switch" | "expired" | "page-closed" };
  /** The origin's granted scope changed (narrowed, widened via re-consent, or budget reset). */
  permissionsChanged: OriginGrant;
  /** A streaming delta for an in-flight claude_stream, tagged with its streamId. */
  delta: { streamId: string } & StreamDelta;
}

export type BYOPEvent = keyof BYOPEvents;
export type PayloadOf<E extends BYOPEvent> = BYOPEvents[E];
