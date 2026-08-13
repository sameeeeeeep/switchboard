// The wrapp registry the connector advertises. Each entry is a wrapp's agent-facing manifest —
// { name, origin, scope, actions:[{ name, summary, input, output, run }] } — the SAME object the
// DOM wrapp exports from its core (docs/WRAPPS-FOR-AGENTS.md §1). One `actions` declaration renders
// three ways; this is the "headless MCP tools" rendering.
//
// Adding a wrapp to the agent tool store = importing its manifest here. The pilot ships ONE
// (AdPulse `analyze`); the rest follow mechanically as each wrapp splits its orchestration out of
// the DOM into a pure run(input, sb) — see examples/apps/src/core/adpulse.core.js for the pattern.
//
// DISCOVERY IS OPT-IN (the spec's default): only manifests listed here are exposed. A per-wrapp
// "allow headless" toggle in the panel is the eventual gate; for now the list itself is the gate.
import adpulse from "../../examples/apps/src/core/adpulse.core.js";
import batch from "../../examples/apps/src/core/batch.core.js";
import redline from "../../examples/apps/src/core/redline.core.js";
import autopilot from "../../examples/apps/src/core/autopilot.core.js";
import ideabrain from "../../examples/apps/src/core/ideabrain.core.js";
import reachout from "../../examples/apps/src/core/reachout.core.js";
import draft from "../../examples/apps/src/core/draft.core.js";

/** @typedef {{ name:string, summary:string, input:object, output:object, run:(input:any, sb:any)=>Promise<any> }} WrappAction */
/** @typedef {{ name:string, title?:string, origin:string, scope?:object, actions:WrappAction[] }} WrappManifest */

/** @type {WrappManifest[]} */
export const MANIFESTS = [adpulse, batch, redline, autopilot, ideabrain, reachout, draft];

/** MCP tool name for an action, namespaced so two wrapps can't collide: wrapp__<wrapp>__<action>. */
export const toolName = (wrapp, action) => `wrapp__${wrapp}__${action}`;

/** Flatten the registry to a callable table keyed by tool name. */
export function actionTable() {
  const table = new Map();
  for (const m of MANIFESTS) {
    for (const a of m.actions) {
      table.set(toolName(m.name, a.name), { manifest: m, action: a });
    }
  }
  return table;
}
