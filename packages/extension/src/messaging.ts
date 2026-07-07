import type { BYOPMethod, ParamsOf } from "@relay/protocol";

/**
 * The page↔content-script message shapes. The page (MAIN world) and the content script
 * (ISOLATED world) share the DOM but not JS scope, so they talk via window.postMessage. These
 * messages carry NO token and NO origin claim — the content/background layer derives the true
 * origin from the browser and adds it. A page can only ever ask; it can never assert who it is.
 */
export const RELAY_NS = "relay:byop" as const;

export interface PageRequest<M extends BYOPMethod = BYOPMethod> {
  ns: typeof RELAY_NS;
  dir: "page->cs";
  id: string;
  method: M;
  params?: ParamsOf<M>;
}

export interface PageResponse {
  ns: typeof RELAY_NS;
  dir: "cs->page";
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface PageEvent {
  ns: typeof RELAY_NS;
  dir: "cs->page";
  event: string;
  payload: unknown;
}

export function isPageRequest(d: unknown): d is PageRequest {
  return !!d && typeof d === "object" && (d as any).ns === RELAY_NS && (d as any).dir === "page->cs";
}
