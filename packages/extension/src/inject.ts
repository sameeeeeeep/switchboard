import { PROVIDER_GLOBAL, BYOP_VERSION, BYOPErrorCode } from "@relay/protocol";
import type { BYOPMethod, ParamsOf, ResultOf } from "@relay/protocol";
import { RELAY_NS, type PageResponse, type PageEvent } from "./messaging.js";

/**
 * Runs in the MAIN world at document_start and installs window.claude — the EIP-1193-style
 * provider. It holds NO secrets and makes NO network calls; it only postMessages requests to
 * the ISOLATED-world content script, which forwards to the background worker (the token holder)
 * and on to the daemon. The provider is the page's ONLY handle on relay.
 */
(function installProvider() {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

  window.addEventListener("message", (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const d = ev.data as PageResponse | PageEvent;
    if (!d || (d as any).ns !== RELAY_NS || (d as any).dir !== "cs->page") return;
    if ("id" in d && pending.has(d.id)) {
      const p = pending.get(d.id)!; pending.delete(d.id);
      if (d.error) p.reject(Object.assign(new Error(d.error.message), { code: d.error.code }));
      else p.resolve(d.result);
    } else if ("event" in d) {
      listeners.get(d.event)?.forEach((fn) => { try { fn(d.payload); } catch { /* listener threw */ } });
    }
  });

  const provider = {
    version: BYOP_VERSION,
    isRelay: true,

    request<M extends BYOPMethod>(args: { method: M; params?: ParamsOf<M> }): Promise<ResultOf<M>> {
      return new Promise((resolve, reject) => {
        const id = uid();
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        // Timeout so a missing daemon surfaces as PROVIDER_UNAVAILABLE, not a hang.
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(Object.assign(new Error("provider timeout"), { code: BYOPErrorCode.PROVIDER_UNAVAILABLE })); }
        }, 130_000);
        window.postMessage({ ns: RELAY_NS, dir: "page->cs", id, method: args.method, params: args.params }, window.location.origin);
      });
    },

    on(event: string, handler: (payload: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    removeListener(event: string, handler: (payload: unknown) => void) {
      listeners.get(event)?.delete(handler);
    },
  };

  Object.defineProperty(window, PROVIDER_GLOBAL, { value: Object.freeze(provider), configurable: false, writable: false });
  window.dispatchEvent(new Event(`${PROVIDER_GLOBAL}#initialized`));
  // A one-line signal so you can confirm injection in the page console (window.claude present).
  console.debug(`[relay] window.claude installed (BYOP ${BYOP_VERSION})`);
})();
