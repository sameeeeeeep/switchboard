import {
  PROVIDER_GLOBAL,
  BYOPErrorCode,
  type BYOPMethod,
  type ParamsOf,
  type ResultOf,
  type Capabilities,
  type CompletionParams,
  type CompletionResult,
  type OriginGrant,
  type ScopeRequest,
  type StreamDelta,
  type StorageRequest,
  type StorageInfo,
  type ContextRequest,
  type Context,
  type ContextMeta,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolDescriptor,
  type UserIdentity,
  type SpeakResult,
  type HealthStatus,
  type HealthReason,
} from "@relay/protocol";

/**
 * @relay/sdk — the developer-facing wrapper over window.claude. Detects the provider, degrades
 * gracefully when the sidekick isn't installed, and turns the EIP-1193 request/event surface
 * into ergonomic methods incl. an async-iterator streaming API.
 *
 *   import { getRelay } from "@relay/sdk";
 *   const relay = getRelay();
 *   await relay.connect({ tools: ["shopify__search_products"], reason: "shop assistant" });
 *   for await (const d of relay.stream({ prompt })) if (d.type === "text") render(d.text);
 */

interface RawProvider {
  version: string;
  isRelay: boolean;
  request<M extends BYOPMethod>(args: { method: M; params?: ParamsOf<M> }): Promise<ResultOf<M>>;
  on(event: string, handler: (payload: unknown) => void): void;
  removeListener(event: string, handler: (payload: unknown) => void): void;
}

export interface RelayNotInstalled {
  installed: false;
  /** Where to send the user to install the sidekick + extension. */
  installUrl: string;
}

export class Relay {
  constructor(private provider: RawProvider) {}

  get version() { return this.provider.version; }

  capabilities(): Promise<Capabilities> {
    return this.provider.request({ method: "claude_capabilities" });
  }

  connect(scope?: ScopeRequest): Promise<OriginGrant> {
    return this.provider.request({ method: "claude_connect", params: scope });
  }

  /** Drop this app's connection for the current page session. The grant persists (a later connect()
   *  won't reprompt) — this is "disconnect from this tab", not "revoke". Full revoke lives in the panel. */
  disconnect(): Promise<{ ok: true }> {
    return this.provider.request({ method: "claude_disconnect" });
  }

  permissions(): Promise<OriginGrant | null> {
    return this.provider.request({ method: "claude_permissions" });
  }

  /** The setup-ladder snapshot (reachable/paired/connected), answered by the EXTENSION from its
   *  own state — never the daemon — so it resolves fast (<1s) in every degraded state, including
   *  the ones where every other method would hang. Resolves null when the extension is too old to
   *  know `claude_health` (or its worker is unreachable): callers MUST treat null as "unknown"
   *  and fall back to probing permissions() exactly as before — that skew guard is load-bearing
   *  while store users run an older extension against newer app bundles. */
  health(): Promise<HealthStatus | null> {
    const answer: Promise<HealthStatus | null> =
      this.provider.request({ method: "claude_health" }).catch(() => null);
    const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    return Promise.race([answer, timer]);
  }

  /** The paired user's public identity (name/avatar), or null if unavailable. Convenience over
   *  capabilities().user — what the connect chip greets with ("Hi Sameep"). */
  identity(): Promise<UserIdentity | null> {
    return this.capabilities().then((c) => c.user ?? null).catch(() => null);
  }

  /** Synthesize speech ON-DEVICE via a local model/engine (no cloud, no connector, no credits).
   *  Returns audio as a playable data: URL, or null if no local TTS is available.
   *
   *    const clip = await relay.speak("hey, it's Maya");
   *    if (clip) new Audio(clip.audio).play();
   */
  speak(text: string, opts?: { voice?: string }): Promise<SpeakResult | null> {
    return this.provider.request({ method: "claude_speak", params: { text, voice: opts?.voice } }).catch(() => null);
  }

  listTools(): Promise<ToolDescriptor[]> {
    return this.provider.request({ method: "claude_listTools" }).then((r) => r.tools);
  }

  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const call: ToolCallRequest = { name, arguments: args };
    return this.provider.request({ method: "claude_callTool", params: call });
  }

  complete(params: CompletionParams): Promise<CompletionResult> {
    return this.provider.request({ method: "claude_complete", params });
  }

  /** Streamed completion as an async iterator of deltas. Ends after a `done`/`error` delta. */
  async *stream(params: CompletionParams): AsyncGenerator<StreamDelta> {
    const { streamId } = await this.provider.request({ method: "claude_stream", params });
    const queue: StreamDelta[] = [];
    let notify: (() => void) | null = null;
    let ended = false;
    const handler = (payload: unknown) => {
      const p = payload as { streamId: string } & StreamDelta;
      if (p.streamId !== streamId) return;
      queue.push(p);
      if (p.type === "done" || p.type === "error") ended = true;
      notify?.();
    };
    this.provider.on("delta", handler);
    try {
      while (true) {
        if (queue.length === 0) {
          if (ended) break;
          await new Promise<void>((r) => (notify = r));
          notify = null;
          continue;
        }
        yield queue.shift()!;
      }
    } finally {
      this.provider.removeListener("delta", handler);
    }
  }

  on(event: "connect" | "disconnect" | "permissionsChanged" | "health", handler: (payload: unknown) => void) {
    this.provider.on(event, handler);
  }

  /**
   * Per-origin local storage — a private on-disk key/value store for this app, plus `bind` to point
   * it at a real folder the user picks. Values are opaque strings (store JSON). Isolated per origin;
   * reads are free, writes need the site not to be read-only, and `bind` prompts for the exact path.
   *
   *   await relay.storage.set("workspace", JSON.stringify(data));
   *   const raw = await relay.storage.get("workspace");
   *   await relay.storage.bind("~/Documents/Projects/brandbrain/.data"); // existing files appear as records
   */
  get storage() {
    const req = (params: StorageRequest) => this.provider.request({ method: "claude_storage", params });
    return {
      get: (key: string): Promise<string | null> => req({ op: "get", key }).then((r) => r.value ?? null),
      set: (key: string, value: string): Promise<void> => req({ op: "set", key, value }).then(() => undefined),
      delete: (key: string): Promise<boolean> => req({ op: "delete", key }).then((r) => r.ok),
      list: (): Promise<string[]> => req({ op: "list" }).then((r) => r.keys ?? []),
      info: (): Promise<StorageInfo | undefined> => req({ op: "info" }).then((r) => r.info),
      /** Point this app's store at a real folder (triggers a path-consent click). */
      bind: (path: string): Promise<StorageInfo | undefined> => req({ op: "bind", path }).then((r) => r.info),
      /** Open a NATIVE folder chooser on the daemon's machine (macOS today). The user picking a
       *  folder in an OS dialog that names this origin IS the path consent, so a successful pick
       *  comes back already bound. Resolves undefined on cancel or when no native picker exists —
       *  keep a typed-path `bind` as the fallback UI. */
      pick: (reason?: string): Promise<StorageInfo | undefined> => req({ op: "pick", reason }).then((r) => r.info).catch(() => undefined),
    };
  }

  /**
   * Shared, cross-app context — your portable brand knowledge. Publish a whole context; read the one
   * the user selected for this app; or open the picker. Selection happens in the side panel, so an
   * app only ever receives the context the user chose to lend it — never the whole library.
   *
   *   await relay.context.publish({ name: "Aamras", kind: "brand", data: brand });
   *   const active = await relay.context.active();   // the brand the user loaded for this app, or null
   */
  get context() {
    const req = (params: ContextRequest) => this.provider.request({ method: "claude_context", params });
    return {
      publish: (context: { id?: string; name: string; kind?: string; data: unknown }): Promise<string | undefined> => req({ op: "publish", context }).then((r) => r.id),
      list: (): Promise<ContextMeta[]> => req({ op: "list" }).then((r) => r.contexts ?? []),
      active: (): Promise<Context | null> => req({ op: "active" }).then((r) => r.context ?? null),
      pick: (): Promise<Context | null> => req({ op: "pick" }).then((r) => r.context ?? null),
      /** Read ONE context listed via `list()` in full, and make it this app's selection. Needs the
       *  kind granted at connect (ScopeRequest.contextKinds) — powers in-app brand dropdowns. */
      use: (id: string): Promise<Context | null> => req({ op: "use", id }).then((r) => r.context ?? null),
    };
  }
}

const DEFAULT_INSTALL_URL = "https://thelastprompt.ai/switchboard/";

/** Get the Relay client, or a `{ installed: false }` sentinel with an install link. Poll-free:
 *  the provider is injected at document_start, so it's present by the time app code runs. */
export function getRelay(opts?: { installUrl?: string }): Relay | RelayNotInstalled {
  const provider = (globalThis as any)[PROVIDER_GLOBAL] as RawProvider | undefined;
  if (provider?.isRelay) return new Relay(provider);
  return { installed: false, installUrl: opts?.installUrl ?? DEFAULT_INSTALL_URL };
}

/** Await the provider for up to `timeoutMs` (handles a slow extension inject). */
export function whenRelayReady(timeoutMs = 3000, opts?: { installUrl?: string }): Promise<Relay | RelayNotInstalled> {
  const now = getRelay(opts);
  if (now instanceof Relay) return Promise.resolve(now);
  return new Promise((resolve) => {
    const onInit = () => { cleanup(); resolve(getRelay(opts)); };
    const timer = setTimeout(() => { cleanup(); resolve({ installed: false, installUrl: opts?.installUrl ?? DEFAULT_INSTALL_URL }); }, timeoutMs);
    function cleanup() { clearTimeout(timer); window.removeEventListener(`${PROVIDER_GLOBAL}#initialized`, onInit); }
    window.addEventListener(`${PROVIDER_GLOBAL}#initialized`, onInit);
  });
}

export { BYOPErrorCode };
export type { CompletionParams, CompletionResult, OriginGrant, ScopeRequest, StreamDelta, ToolDescriptor, ToolCallResult, UserIdentity, SpeakResult, HealthStatus, HealthReason };
export { mountConnect, type ConnectChipOptions, type ConnectChipHandle } from "./connect-chip.js";
