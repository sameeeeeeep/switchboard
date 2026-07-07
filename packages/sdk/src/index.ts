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
  type ToolCallRequest,
  type ToolCallResult,
  type ToolDescriptor,
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

  permissions(): Promise<OriginGrant | null> {
    return this.provider.request({ method: "claude_permissions" });
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

  on(event: "connect" | "disconnect" | "permissionsChanged", handler: (payload: unknown) => void) {
    this.provider.on(event, handler);
  }
}

const DEFAULT_INSTALL_URL = "https://relay.dev/install";

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
export type { CompletionParams, CompletionResult, OriginGrant, ScopeRequest, StreamDelta, ToolDescriptor, ToolCallResult };
