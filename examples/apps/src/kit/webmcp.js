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

// ─────────────────────────── exposeWidget — the GLANCE (docs/WIDGETS.md, Option B) ───────────────────────────
//
// A widget is NOT a shrunk page — it is the wrapp's ONE answer, declared as DATA in one of the finite
// `WidgetResult` shapes, which the NATIVE GodWidgetKit renders (no webview, nothing idle in the notch).
// This is the wrapp side of the contract (P1): the wrapp publishes a purpose-built glance; the daemon
// fetches it once and hands the payload to `NotchWidget`, which reuses `widgetResult(from:)` wholesale.
//
// A wrapp declares its glance as EITHER a static spec OR a producer function. The producer takes an
// OPTIONAL input — a dropped file / data: URL / text the notch launcher hands over — and returns the
// glance for THAT input; with no input it returns a minimal "drop something" prompt state. Same design
// as exposeToGod: the producer reuses the wrapp's own pipeline, so there is one source of truth.
//
//   exposeWidget((input) => ({
//     kicker: "CONVERT · CSV → JSON",         // WidgetHeader eyebrow (rendered uppercase/mono)
//     title:  "2 rows converted",             // WidgetHeader title
//     openLabel: "Open Convert",              // the "Open in…" ActionRow button
//     shape: "text",                          // one of: working · text · image · cards · gallery
//     result: { body: "…", caption: "no AI · on your device" },
//     copyText: "…",                          // optional — what the Copy action puts on the clipboard
//     file: { name, dataUrl, bytes },         // optional — a drag-out/download artifact (any shape)
//   }));
//
// The five shapes' `result` fields (mirror GodWidgetKit.swift:299 / WIDGETS.md §5):
//   working  { line }
//   text     { body, caption? }
//   image    { caption, steer?[], file }                       file = { name, dataUrl, bytes }
//   gallery  { caption, items:[{ label?, dataUrl, … }] }
//   cards    { caption, items:[{ label, text, recommended?, swatch? }] }
//
/**
 * @typedef {{ kicker?:string, title?:string, openLabel?:string, shape:string, result:object,
 *             copyText?:string, file?:object }} WidgetSpec
 * @param {WidgetSpec | ((input:any)=>WidgetSpec|Promise<WidgetSpec>)} specOrFn
 * @returns {{ get:(input:any)=>Promise<WidgetSpec> }|undefined}
 */
export function exposeWidget(specOrFn) {
  if (!specOrFn) return;
  const produce = typeof specOrFn === "function" ? specOrFn : () => specOrFn;
  const SHAPES = ["working", "text", "image", "cards", "gallery"];

  // Normalize + validate a produced payload so the native renderer always gets a well-formed shape.
  const normalize = (spec) => {
    const s = spec && typeof spec === "object" ? spec : {};
    const shape = SHAPES.includes(s.shape) ? s.shape : "text";
    const result = s.result && typeof s.result === "object" ? s.result : { body: "" };
    return {
      kicker: s.kicker || "",
      title: s.title || "",
      openLabel: s.openLabel || "Open",
      shape,
      result,
      ...(s.copyText != null ? { copyText: String(s.copyText) } : {}),
      ...(s.file ? { file: s.file } : {}),
    };
  };

  const g = typeof window !== "undefined" ? window : globalThis;
  // The native bridge: a host calls __godWidget.get(input) to fetch this wrapp's glance. `input` is
  // optional — { file, dataUrl, text, … } handed over by the notch launcher (e.g. a dropped PDF).
  g.__godWidget = {
    get: async (input) => normalize(await produce(input || {})),
  };
  // Let a host that attached before load know the widget is declared now.
  try { g.dispatchEvent(new Event("god:widget")); } catch (_) {}
  return g.__godWidget;
}
