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
import type { StorageRequest, StorageResult } from "./storage.js";
import type { ContextRequest, ContextResult } from "./context.js";
import type { SessionRequest, SessionResult } from "./session.js";
import type { HealthStatus } from "./health.js";

/** Who the paired human is — enough for a connected app to greet them ("Hi Sameep") and show whose
 *  Claude it's running on. Public, non-sensitive: a display name the user chose (or their OS name),
 *  never the pairing token. The app gets this the moment it connects, so any wrapp feels like "yours". */
export interface UserIdentity {
  /** Display name, e.g. "Sameep". */
  name: string;
  /** Optional avatar as a URL or data: URI. */
  avatar?: string;
}

/** On-device capabilities the daemon can serve WITHOUT a cloud call — this is the orchestrator
 *  story: an app can lean on local models/engines (TTS today; local image/transcription later)
 *  that already run on the user's machine, free and private. */
export interface LocalCapabilities {
  /** Text-to-speech is available locally (a local TTS server, or the OS engine e.g. macOS `say`). */
  tts: boolean;
  /** A few local voice ids the app can offer, if known. */
  voices?: string[];
}

/** Provider capabilities, returned by claude_capabilities for feature detection. */
export interface Capabilities {
  version: typeof BYOP_VERSION;
  methods: BYOPMethod[];
  /** Model ids the daemon can route to right now (across all backends). */
  models: string[];
  /** Backends currently online, e.g. ["claude-code", "ollama"]. */
  backends: string[];
  /** Rung 4 (STATES.md §4): whether the daemon can actually fulfil a completion right now — Claude
   *  Code signed in, or a local/hosted backend healthy. `false` = the invisible cliff (everything
   *  reads green but the first call would fail on sign-in); `undefined` = not determinable (older
   *  daemon, or the marker couldn't be read) → surfaces must not assert signed-out from it. */
  signedIn?: boolean;
  /** Whether the gated agentic loop is available. */
  agentic: boolean;
  /** The paired user's public identity, for greeting + attribution in the app's own UI. */
  user?: UserIdentity;
  /** On-device capabilities served without a cloud call (local TTS, etc.). */
  local?: LocalCapabilities;
}

/** claude_speak — synthesize speech LOCALLY (no cloud, no connector, no credits). Routes to a
 *  configured local TTS server, else the OS engine. The orchestrator using a local model. */
export interface SpeakParams {
  text: string;
  /** A local voice id (backend-specific); omit for the default. */
  voice?: string;
}
export interface SpeakResult {
  /** The synthesized audio as a data: URL (audio/wav) the page can play directly. */
  audio: string;
  /** Which local backend produced it, e.g. "macos-say" or "local-server". */
  backend: string;
  voice?: string;
}

/** claude_transcribe — speech-to-text LOCALLY (no cloud, no connector, no credits). The mirror of
 *  claude_speak: audio in, text out, on a local model (an OpenAI-compatible local server or a
 *  configured whisper binary). The daemon as orchestrator of local models. */
export interface TranscribeParams {
  /** Source audio as a data: URL (e.g. "data:audio/wav;base64,…"). Stays on the machine. */
  audio: string;
  /** Optional ISO-639-1 hint (e.g. "en"); omit to let the model auto-detect. */
  language?: string;
}
export interface TranscribeResult {
  /** The recognized text. */
  text: string;
  /** Which local backend produced it, e.g. "local-server" or "whisper-cli". */
  backend: string;
}

/** sb_brand — read a brand's public website into provenance-tagged facts, SERVER-SIDE in the daemon
 *  (no browser CORS, no forbidden-header stripping). Reuses the deterministic parser in
 *  packages/bank-mcp (brand.mjs): colours come from the site's own CSS custom properties, products
 *  from /products.json, each fact tagged with where it came from. This is the fix for the flaky in-tab
 *  "start from an existing brand" (a tab can't fetch cross-origin, so the model was left to GUESS
 *  hexes). See docs/BRAND-EXTRACTION.md §2.1 + docs/IDEAFETCH.md §2.1. */
export interface SbBrandParams {
  /** The brand's website, e.g. "nailin.it" or "https://nailin.it". */
  url: string;
  /** Override the brand name (else taken from og:site_name or the page title). */
  name?: string;
}
export interface SbBrandResult {
  domain: string;
  siteName?: string;
  description?: string;
  platform?: string;
  currency?: string;
  ogImage?: string;
  /** Provenance-tagged palette from the served CSS — each colour records the variable/source it
   *  came from ("--brand-primary", "theme-color", …). Empty ⇒ no colours read (honest, never guessed). */
  palette: { hex: string; from: string }[];
  products: { short: string; price: number | null; type: string; url?: string }[];
  category?: string;
  priceRange?: { min: number; max: number };
  socials: { label: string; url: string }[];
  /** false ⇒ the site couldn't be read (dead / JS-only / bot-block / non-public URL). A first-class
   *  HONEST state — the caller offers a repo/folder/paste reader instead of fabricating. */
  reachable: boolean;
}

/** guide_run — drive a GUIDED CURSOR-WALKTHROUGH on the user's machine: onboarding, setup, a
 *  how-to, or a guided test. The daemon validates + CONSENT-GATES (a guide takes over the cursor +
 *  keyboard, so it's write-class), then hands the steps to the on-machine runtime (the menubar app's
 *  CursorGuide, which floats each step's caption by the pointer). The human signals pass/next
 *  (⌃⌥) · fail (⌃⌥⇧) · abort (Esc); the daemon waits for the run to finish and returns per-step
 *  verdicts. Exposed through the switchboard connector too, so even a remote Claude (claude.ai) can
 *  walk the user through something on their own screen. See CursorGuide.swift + guide-run.json IPC. */
export interface GuideStep {
  /** Stable id for the step; synthesized ("step-1", …) if omitted. */
  id?: string;
  /** The caption shown by the cursor, e.g. "Click the Connect button top-right". */
  text: string;
  /** Optional secondary line (where to look / what "done" means). */
  hint?: string;
}
export interface GuideRunParams {
  /** What this walkthrough is, shown at consent and as the run's heading, e.g. "Connect your first wrapp". */
  title: string;
  /** "tour" = teach/guide (verdicts are just "done"); "test" = pass/fail each step (guided test). Default "tour". */
  mode?: "test" | "tour";
  /** Ordered steps. At least one required. */
  steps: GuideStep[];
}
/** One step's outcome. `verdict` is "done" in tour mode; "passed"/"failed"/"skipped" in test mode. */
export interface GuideStepResult {
  id: string;
  text: string;
  verdict: string;
  /** ISO timestamp the user acted on this step. */
  notedAt: string;
}
/** The unified result the runtime writes (guide-result.json) for BOTH modes. */
export interface GuideResult {
  title: string;
  mode: "test" | "tour";
  /** "completed" = the user reached the end; "aborted" = Esc / bailed early. */
  outcome: "completed" | "aborted";
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  results: GuideStepResult[];
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
  /** Per-origin local storage. get/list/info are reads; set/delete are writes (denied in
   *  readonly mode); bind (point the store at a real folder) always triggers a path-consent
   *  popup. The store is isolated per origin — an app can only ever touch its own records. */
  claude_storage: { params: StorageRequest; result: StorageResult };
  /** Shared, cross-app context. publish/list/read-own are the producer side; `active` returns the
   *  one context the user selected for this origin in the panel (selection = consent); `pick` opens
   *  that picker. Apps never enumerate the library — only the panel (control channel) can. */
  claude_context: { params: ContextRequest; result: ContextResult };
  /** Warm, stateful completion thread (read-only): one long-lived process per (origin, sessionId),
   *  turns queued sequentially. For apps that generate a long sequence of cards in one conversation. */
  claude_session: { params: SessionRequest; result: SessionResult };
  /** Local text-to-speech — synthesized on-device, no cloud/connector/credits. Requires a grant. */
  claude_speak: { params: SpeakParams; result: SpeakResult };
  /** Local speech-to-text — recognized on-device, no cloud/connector/credits. Requires a grant.
   *  The mirror of claude_speak; primarily used by direct-principal (native) apps. */
  claude_transcribe: { params: TranscribeParams; result: TranscribeResult };
  /** Read a brand's public website into provenance-tagged facts, server-side (no CORS). Requires a
   *  grant; GET-only on public pages (read posture) so no per-call consent. See docs/BRAND-EXTRACTION.md. */
  sb_brand: { params: SbBrandParams; result: SbBrandResult };
  /** Drive a guided cursor-walkthrough on the user's screen (onboarding/setup/how-to/guided-test).
   *  Requires a grant AND a per-run consent (write-class: it takes over the cursor + keyboard). */
  guide_run: { params: GuideRunParams; result: GuideResult };
  /** Read the user's past guided runs (append-only ~/.relay/guide-history.jsonl): per-step verdicts,
   *  the options/choices they picked, notes, and DURABLE screenshot paths. Read-only over the user's
   *  own local record → no per-call consent. Lets ANY later Claude thread see what the user did + saw. */
  guide_history: { params: { limit?: number }; result: { runs: unknown[] } };
  /** The setup ladder, answered by the EXTENSION locally — never forwarded to the daemon, no
   *  grant required, resolves fast (<1s) even when the daemon is unreachable or unpaired. The
   *  chip/widget render install → unreachable → unpaired → disconnected → connected from this;
   *  live transitions arrive as the `health` event. */
  claude_health: { params: void; result: HealthStatus };
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

export type { OriginGrant, ScopeRequest, ToolCallRequest, ToolCallResult, ToolDescriptor, CompletionParams, CompletionResult, StorageRequest, StorageResult, ContextRequest, ContextResult, SessionRequest, SessionResult };
