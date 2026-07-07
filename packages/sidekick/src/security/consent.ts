import type { ToolCallRequest } from "@relay/protocol";

/**
 * The channel by which the gate asks the USER (via the extension popup) to approve a
 * per-action write. The server implements this by pushing a consent request over the paired
 * WS connection and awaiting the user's click. This is the human-in-the-loop that a hostile
 * prompt can never satisfy on its own — the model cannot click the button.
 */
export interface PerActionConsentRequest {
  id: string;
  origin: string;
  tool: ToolCallRequest;
  /** The daemon-assigned access class, always "write" when this path is hit. */
  reason: "write-action";
}

export interface ConsentPrompter {
  /** Show a per-action consent popup for a write tool and resolve to the user's decision.
   *  Resolves false on timeout / popup dismissed (fail-closed). */
  requestWriteConsent(req: PerActionConsentRequest): Promise<boolean>;
  /** Show the connect/scope consent popup; resolve to the (possibly narrowed) approved scope,
   *  or null if the user rejected. */
  requestConnectConsent(origin: string, requested: unknown): Promise<null | {
    models: string[];
    tools: Array<{ name: string; access: "read" | "write" }>;
    budgets?: { maxTokensPerDay?: number; maxCallsPerMin?: number };
    expiresAt?: number;
  }>;
}
