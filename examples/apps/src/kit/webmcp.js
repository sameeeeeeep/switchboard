// kit/webmcp — expose a wrapp's actions as page-tools God can drive, WITHOUT factoring the
// orchestration out of the DOM. A wrapp declares its God-callable entries once; this renders them
// two ways from that single declaration:
//
//   1. navigator.modelContext.registerTool(…) — the WebMCP standard, so ANY page-tool host (a
//      WebMCP-aware browser, the extension's "act on this tab") can enumerate and call them.
//   2. window.__god — a tiny { list, call } bridge the NATIVE God webview drives via
//      evaluateJavaScript (no WebMCP polyfill needed in a WKWebView we own).
//
// Both call the SAME `execute` — which is just the wrapp's own click-handler logic, reused. Nothing
// is duplicated into a separate core; the wrapp stays the single source of truth. When neither host
// is present (a normal browser tab, no God), this is inert — the wrapp works exactly as before.
//
// An `execute` should DRIVE the real UI (call the same functions a click would) so the user watching
// God's webview sees it happen, then RETURN a JSON-safe result God can speak/act on. Throw a plain
// Error on failure — the bridge forwards `{ ok:false, error }` to the host.

/**
 * @typedef {{ name:string, description?:string, inputSchema?:object, execute:(input:any)=>any|Promise<any> }} GodTool
 * @param {GodTool|GodTool[]} tools
 * @returns {{ list:()=>object[], call:(name:string,input:any)=>Promise<any> }|undefined}
 */
export function exposeToGod(tools) {
  const list = (Array.isArray(tools) ? tools : [tools]).filter(
    (t) => t && typeof t.name === "string" && typeof t.execute === "function",
  );
  if (!list.length) return;

  // 1) WebMCP standard — best-effort; a page-tool host may or may not be present.
  const mc = typeof navigator !== "undefined" && navigator.modelContext;
  if (mc && typeof mc.registerTool === "function") {
    for (const t of list) {
      try {
        mc.registerTool({
          name: t.name,
          description: t.description || t.name,
          inputSchema: t.inputSchema || {},
          execute: (input) => Promise.resolve(t.execute(input || {})),
        });
      } catch (e) {
        // A non-conforming host must never break the wrapp's own UI.
        try { console.warn("[webmcp] registerTool failed for", t.name, e); } catch (_) {}
      }
    }
  }

  // 2) Native God webview bridge — list + call by name, both JSON-safe. The host reads __god.list()
  // to learn what this wrapp offers, then __god.call(name, input) to drive it and await the result.
  const byName = new Map(list.map((t) => [t.name, t]));
  const g = typeof window !== "undefined" ? window : globalThis;
  g.__god = {
    list: () => list.map((t) => ({ name: t.name, description: t.description || t.name, inputSchema: t.inputSchema || {} })),
    call: async (name, input) => {
      const t = byName.get(name);
      if (!t) throw new Error("no such God tool on this page: " + name);
      return await t.execute(input || {});
    },
  };
  // Let a host that attached before load know tools are ready now.
  try { g.dispatchEvent(new Event("god:tools")); } catch (_) {}
  return g.__god;
}
