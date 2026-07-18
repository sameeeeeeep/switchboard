/**
 * @relay/protocol — BYOP-1, the wire contract shared by the daemon, extension, and SDK.
 * This package is types-only (plus a couple of const helpers); it has no runtime behavior
 * and no dependencies, so it can be imported from a Node daemon, an MV3 service worker, and
 * a browser SDK alike.
 */
export * from "./version.js";
export * from "./permissions.js";
export * from "./tabsidekick.js";
export * from "./tools.js";
export * from "./completion.js";
export * from "./storage.js";
export * from "./context.js";
export * from "./session.js";
export * from "./health.js";
export * from "./rpc.js";
export * from "./events.js";
export * from "./errors.js";
export * from "./audit.js";
