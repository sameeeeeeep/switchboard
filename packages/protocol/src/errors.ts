/**
 * Provider error codes, EIP-1193 / JSON-RPC style. The SDK surfaces these; sites branch on
 * `code`. Numeric codes stay stable across versions.
 */
export const BYOPErrorCode = {
  /** User rejected the connect/consent request. (≈ 4001) */
  USER_REJECTED: 4001,
  /** Origin is not connected / has no grant for this method. (≈ 4100) */
  UNAUTHORIZED: 4100,
  /** Method exists but the origin's scope doesn't cover it (model/tool not granted). */
  SCOPE_EXCEEDED: 4110,
  /** A per-action write consent was denied by the user. */
  CONSENT_DENIED: 4120,
  /** Budget or rate limit hit (tokens/day or calls/min). */
  BUDGET_EXCEEDED: 4290,
  /** Unknown method. (≈ 4200) */
  UNSUPPORTED_METHOD: 4200,
  /** Bad params. (≈ -32602) */
  INVALID_PARAMS: -32602,
  /** The sidekick daemon is not installed / not reachable. The SDK maps this to its
   *  "install the sidekick" fallback. */
  PROVIDER_UNAVAILABLE: 4900,
  /** Backend error (model/tool failed for a non-policy reason). */
  BACKEND_ERROR: 4500,
} as const;

export type BYOPErrorCode = (typeof BYOPErrorCode)[keyof typeof BYOPErrorCode];

export interface BYOPError {
  code: BYOPErrorCode;
  message: string;
  data?: unknown;
}

export class ProviderError extends Error implements BYOPError {
  code: BYOPErrorCode;
  data?: unknown;
  constructor(code: BYOPErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.data = data;
  }
}
