#!/usr/bin/env node
/**
 * Unit tests for God's HANDS — the pure parse/dispatch layer, no daemon, no model, no side effects.
 * Complements harness.mjs (which is model-driven and needs a screenshot): this pins the exact tag
 * grammar and the dry-run dispatch strings so a regression in the regexes or the verb table is caught
 * instantly. Run: node hands.test.mjs
 */
import { parseAction, parseToolArgs, describeAction, runAction, keyComboOsa } from "./god.mjs";

let pass = 0, fail = 0;
const shot = { w: 1600, h: 1000 };
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}`);
  if (!ok) { console.log(`        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`); fail++; } else pass++;
};
const ok = (name, cond) => { console.log(`  ${cond ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}`); cond ? pass++ : fail++; };

console.log("\n▶ parseAction — the tag grammar");
eq("OPEN", parseAction("do it\n[OPEN:Calendar]").kind, "open");
eq("TYPE", parseAction("[TYPE:hello world]").text, "hello world");
eq("KEY", parseAction("save it\n[KEY:cmd+s]"), { kind: "key", combo: "cmd+s" });
eq("CLICK", parseAction("[CLICK:120,340:Deploy]"), { kind: "click", x: 120, y: 340, label: "Deploy" });
eq("POINT", parseAction("look here [POINT:10,20:here]"), { kind: "point", x: 10, y: 20, label: "here" });
ok("RUN takes priority over a trailing POINT", parseAction("[RUN:mcp__switchboard__wrapp__redline__audit {\"input\":\"my.ts\"}]\n[POINT:1,2]").kind === "run");

console.log("\n▶ RUN — tool + args parsing");
const run = parseAction('[RUN:mcp__switchboard__wrapp__batch__draft {"input":"3 subject lines"}]');
eq("RUN kind", run.kind, "run");
eq("RUN tool", run.tool, "mcp__switchboard__wrapp__batch__draft");
eq("RUN json args", run.args, { input: "3 subject lines" });
eq("RUN bare-string args → {input}", parseAction("[RUN:mcp__x__y just do the thing]").args, { input: "just do the thing" });
eq("RUN no args → {}", parseAction("[RUN:mcp__x__y]").args, {});
eq("parseToolArgs empty", parseToolArgs(""), {});
eq("parseToolArgs invalid json → input", parseToolArgs("not json"), { input: "not json" });

console.log("\n▶ keyComboOsa — combos → System Events");
ok("cmd+s → keystroke + command down", /keystroke "s" using \{command down\}/.test(keyComboOsa("cmd+s")));
ok("return → key code 36", /key code 36/.test(keyComboOsa("return")));
ok("cmd+shift+4 → both modifiers", /command down/.test(keyComboOsa("cmd+shift+4")) && /shift down/.test(keyComboOsa("cmd+shift+4")));
ok("modifiers-only (no key) → null", keyComboOsa("cmd+control") === null);

console.log("\n▶ runAction — dry-run dispatch is side-effect-free + describes each hand");
process.env.GOD_DRYRUN = "1";
for (const [name, a, needle] of [
  ["open", { kind: "open", target: "Calendar" }, /would open Calendar/],
  ["type", { kind: "type", text: "hi there" }, /would type/],
  ["key",  { kind: "key", combo: "cmd+s" }, /would press cmd\+s/],
  ["run",  { kind: "run", tool: "mcp__switchboard__wrapp__redline__audit", args: { input: "x" } }, /would run redline · audit/],
]) {
  const out = await runAction(a, shot, null);
  ok(`${name}: "${out}"`, needle.test(out));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
