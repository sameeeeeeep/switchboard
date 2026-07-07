/**
 * The JSON-RPC-ish method map for window.claude.request({ method, params }). EIP-1193 style:
 * one request entrypoint, a typed method → (params, result) map, plus events. Keeping the map
 * in one typed table lets the SDK, extension bridge, and daemon share exact signatures.
 */
import type { BYOP_VERSION } from "./version.js";
import type {
  OriginGrant,
  ScopeRequest,
} from "./permissions.js";
import type { ToolCallRequest, ToolCallResult, ToolDescriptor } from "./tools.js";
import type { CompletionParams, CompletionResult } from "./completion.js";

/** Provider capabilities, returned by claude_capabilities for feature detection. */
export interface Capabilities {
  version: typeof BYOP_VERSION;
  methods: BYOPMethod[];
  /** Model ids the daemon can route to right now (across all backends). */
  models: string[];
  /** Backends currently online, e.g. ["claude-code", "ollama"]. */
  backends: string[];
  /** Whether the gated agentic loop is available. */
  agentic: boolean;
}

/** The typed method table: each method's params and result. */
export interface BYOPMethods {
  /** Feature-detect. No permission required. */
  claude_capabilities: { params: void; result: Capabilities };
  /** Request permission for this origin (≈ eth_requestAccounts). Triggers the consent popup
   *  on first call; returns the granted (possibly narrowed) scope. */
  claude_connect: { params: ScopeRequest | void; result: OriginGrant };
  /** Drop this origin's connection for the current page session (does not revoke the grant). */
  claude_disconnect: { params: void; result: { ok: true } };
  /** One-shot completion. */
  claude_complete: { params: CompletionParams; result: CompletionResult };
  /** Start a streamed completion; returns a streamId whose deltas arrive as `delta` events. */
  claude_stream: { params: CompletionParams; result: { streamId: string } };
  /** Cancel an in-flight stream. */
  claude_cancel: { params: { streamId: string }; result: { ok: true } };
  /** Tools this origin is allowed to see. */
  claude_listTools: { params: void; result: { tools: ToolDescriptor[] } };
  /** Invoke one tool explicitly. Reads run within scope; writes trigger per-action consent. */
  claude_callTool: { params: ToolCallRequest; result: ToolCallResult };
  /** Read this origin's current grant, or request a scope change (change → consent popup). */
  claude_permissions: {
    params: { request?: ScopeRequest } | void;
    result: OriginGrant | null;
  };
}

export type BYOPMethod = keyof BYOPMethods;
export type ParamsOf<M extends BYOPMethod> = BYOPMethods[M]["params"];
export type ResultOf<M extends BYOPMethod> = BYOPMethods[M]["result"];

// NOTE: individual domain types (OriginGrant, CompletionParams, ToolDescriptor, …) are exported
// from their own modules via index.ts's `export *`; do not re-export them here to avoid ambiguous
// duplicate star-exports.

/** The shape a page sends into window.claude.request. */
export interface RequestArgs<M extends BYOPMethod = BYOPMethod> {
  method: M;
  params?: ParamsOf<M>;
}

/**
 * The envelope the EXTENSION forwards to the daemon. `origin` is added by the extension from
 * the browser-verified sender and is authoritative — the daemon ignores any origin the page
 * tries to supply. This is the linchpin of per-origin enforcement.
 */
export interface RequestEnvelope<M extends BYOPMethod = BYOPMethod> {
  id: string;
  origin: string;
  method: M;
  params?: ParamsOf<M>;
  /** Monotonic ms from the extension; used for rate-window bookkeeping, not for auth. */
  sentAt: number;
}

export type { OriginGrant, ScopeRequest, ToolCallRequest, ToolCallResult, ToolDescriptor, CompletionParams, CompletionResult };
