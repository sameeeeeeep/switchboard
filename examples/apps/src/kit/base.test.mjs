// Headless assertions for the base-conversion maths. No browser, no bundler:
//   node examples/apps/src/kit/base.test.mjs
// The whole point of this tool is EXACTNESS past 2^53, so every big value is checked against a
// hand-known reference — "looks about right" is exactly how a float-rounding bug ships a wrong address.
import { parseIn, toBase, convertAll, isValidBase } from "./base.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

console.log("\n── parseIn: the happy path (spec's worked example) ──────");
expect(parseIn("ff", 16) === 255n, "'ff' base16 = 255");
expect(parseIn("11111111", 2) === 255n, "'11111111' base2 = 255");
expect(parseIn("377", 8) === 255n, "'377' base8 = 255");
expect(parseIn("255", 10) === 255n, "'255' base10 = 255");
expect(parseIn("z", 36) === 35n, "'z' base36 = 35 (top of the alphabet)");
expect(parseIn("0", 10) === 0n, "'0' = 0n");

console.log("\n── tolerant input (prefixes, separators, sign, case) ────");
expect(parseIn("0xFF", 16) === 255n, "0x prefix stripped (and uppercase)");
expect(parseIn("0b1111_1111", 2) === 255n, "0b prefix + underscore separators");
expect(parseIn("0o377", 8) === 255n, "0o prefix stripped");
expect(parseIn("ff 00", 16) === 65280n, "spaces as separators → 0xff00");
expect(parseIn("  10  ", 10) === 10n, "surrounding whitespace trimmed");
expect(parseIn("-ff", 16) === -255n, "leading '-' → negative");
expect(parseIn("+42", 10) === 42n, "leading '+' tolerated");
// A hex "0b…" must stay hex, not be mistaken for a binary prefix.
expect(parseIn("0b", 16) === 11n, "'0b' in base16 is the hex number 11, not an empty binary");

console.log("\n── exactness past 2^53 (the reason this uses BigInt) ────");
// 2^64 - 1, the classic 64-bit unsigned max. parseInt() would round this off.
expect(parseIn("18446744073709551615", 10) === 18446744073709551615n, "2^64-1 parses exactly");
expect(toBase(18446744073709551615n, 16) === "ffffffffffffffff", "2^64-1 → 16×f in hex");
expect(parseIn("ffffffffffffffff", 16) === 18446744073709551615n, "…and round-trips back from hex");
const big = convertAll("18446744073709551615", 10);
expect(big.hex === "ffffffffffffffff" && big.oct === "1777777777777777777777" && big.bin.length === 64,
       "2^64-1 convertAll: 16 f's hex, 22-digit octal, 64-bit binary");

console.log("\n── toBase: formatting ───────────────────────────────────");
expect(toBase(255n, 16) === "ff", "255 → 'ff' (lowercase)");
expect(toBase(255n, 2) === "11111111", "255 → binary");
expect(toBase(255n, 8) === "377", "255 → octal");
expect(toBase(0n, 2) === "0", "0 → '0' in any base (not empty)");
expect(toBase(-255n, 16) === "-ff", "negative keeps its sign");
expect(toBase(35n, 36) === "z", "35 → 'z' base36");
expect(toBase(123n, 5) !== null, "arbitrary base 5 works");
expect(toBase("255", 16) === null, "non-bigint value → null (guards misuse)");

console.log("\n── invalid / empty / edge input → null (never a wrong number) ──");
expect(parseIn("g", 16) === null, "'g' is not a hex digit → null");
expect(parseIn("2", 2) === null, "'2' is not a binary digit → null");
expect(parseIn("8", 8) === null, "'8' is not an octal digit → null");
expect(parseIn("", 10) === null, "empty string → null");
expect(parseIn("   ", 10) === null, "all-whitespace → null");
expect(parseIn("-", 10) === null, "a lone sign → null");
expect(parseIn("0x", 16) === null, "a bare prefix with no digits → null");
expect(parseIn("ff", 37) === null, "base out of range (37) → null");
expect(parseIn("ff", 1) === null, "base out of range (1) → null");
expect(parseIn("1.5", 10) === null, "a decimal point is not an integer digit → null");
expect(convertAll("nope", 16) === null, "convertAll bad input → null");
expect(convertAll("", 10) === null, "convertAll empty → null");

console.log("\n── base validation ──────────────────────────────────────");
expect(isValidBase(2) && isValidBase(36), "2 and 36 are valid bases");
expect(!isValidBase(1) && !isValidBase(37) && !isValidBase(2.5), "1, 37, 2.5 are not");

console.log("\n── round-trip fuzz across every base 2…36 ───────────────");
let rtOk = true;
for (let b = 2; b <= 36; b++) {
  for (const v of [0n, 1n, 255n, 4095n, 123456789012345678901234567890n]) {
    if (parseIn(toBase(v, b), b) !== v) { rtOk = false; break; }
  }
}
expect(rtOk, "toBase → parseIn is identity for many values across all 35 bases");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
