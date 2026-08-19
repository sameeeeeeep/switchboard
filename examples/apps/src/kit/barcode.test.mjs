// Headless assertions for the barcode encoders. No browser, no bundler:
//   node examples/apps/src/kit/barcode.test.mjs
// Every check is pinned to a KNOWN published value — a real EAN check digit, a hand-computable mod-103
// checksum, a fixed spec pattern — because a barcode that "looks like stripes" but carries the wrong
// bits is worse than no barcode at all. If a vector below fails, the ENCODER is wrong; never weaken
// the vector to make it pass.
import { encodeBarcode, ean13CheckDigit, code128Checksum, BARCODE_TYPES } from "./barcode.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
// run-length array → flat "1010" bit string (starts with a bar), for exact-pattern cross-checks.
const runsToBits = (runs) => runs.map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(w)).join("");

console.log("\n── EAN-13 check digit (published vectors) ───────────────");
expect(ean13CheckDigit("400638133393") === 1, "400638133393 → check 1  (4006381333931)");
expect(ean13CheckDigit("978020137962") === 4, "978020137962 → check 4  (9780201379624)");
expect(ean13CheckDigit("001234567890") === 5, "001234567890 → check 5  (0012345678905)");
expect(ean13CheckDigit("590123412345") === 7, "590123412345 → check 7  (5901234123457, the classic)");

console.log("\n── EAN-13 encode: 12-digit input gets the check appended ─");
{
  const r = encodeBarcode("ean13", "400638133393");
  expect(r.ok === true, "12-digit input encodes ok");
  expect(r.text === "4006381333931", "human-readable text = full 13 digits incl. check 1");
}
{
  const r = encodeBarcode("ean13", "978020137962");
  expect(r.ok && r.text === "9780201379624", "978020137962 → 9780201379624");
}

console.log("\n── EAN-13 encode: full 13-digit input is validated ──────");
expect(encodeBarcode("ean13", "4006381333931").ok === true, "correct check digit validates OK");
{
  const bad = encodeBarcode("ean13", "4006381333930");   // last digit should be 1
  expect(bad.ok === false && /Check digit/.test(bad.error), "wrong final digit → ok:false with a check-digit error");
}

console.log("\n── EAN-13 structure (module widths + guards) ────────────");
{
  const r = encodeBarcode("ean13", "5901234123457");
  expect(r.ok, "5901234123457 encodes");
  expect(r.widthUnits === 95, "encoded region = 95 modules (3+42+5+42+3)");
  expect(sum(r.modules) === 95, "run-lengths sum to 95");
  const bits = runsToBits(r.modules);
  expect(bits.length === 95, "bit string is 95 wide");
  expect(bits.startsWith("101"), "start guard 101 at offset 0");
  expect(bits.slice(45, 50) === "01010", "centre guard 01010 at offset 45 (3+42)");
  expect(bits.slice(92, 95) === "101", "end guard 101 at offset 92");
  expect(r.modules[0] > 0 && bits[0] === "1", "modules[] starts with a bar");
  expect(r.quiet.left >= 9 && r.quiet.right >= 7, "quiet zones present on both sides");
}

console.log("\n── EAN-13 exact bit pattern (5901234123457, first digit 5)");
{
  // First digit 5 → left parity OEEOOE (L,G,G,L,L,G) over left digits 9,0,1,2,3,4.
  // Built here from the independent EAN L/G/R definitions, NOT from the encoder's internals.
  const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
  const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
  const left = [[9,"O"],[0,"E"],[1,"E"],[2,"O"],[3,"O"],[4,"E"]];
  const right = [1,2,3,4,5,7];
  let want = "101";
  for (const [d, p] of left) want += (p === "O" ? L[d] : G[d]);
  want += "01010";
  for (const d of right) want += R[d];
  want += "101";
  const got = runsToBits(encodeBarcode("ean13", "5901234123457").modules);
  expect(got === want, "full 95-bit pattern matches the L/G/R + parity construction");
}

console.log("\n── EAN-13 table integrity (R=~L, G=reverse(R), parity) ──");
{
  const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
  const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
  let okComp = true, okRev = true, okParity = true;
  const ones = (s) => [...s].filter((c) => c === "1").length;
  for (let d = 0; d < 10; d++) {
    const comp = [...L[d]].map((b) => (b === "1" ? "0" : "1")).join("");
    if (comp !== R[d]) okComp = false;
    if ([...R[d]].reverse().join("") !== G[d]) okRev = false;
    if (ones(L[d]) % 2 !== 1 || ones(G[d]) % 2 !== 0) okParity = false;  // L odd parity, G even parity
  }
  expect(okComp, "R(d) is the bitwise complement of L(d) for all 10 digits");
  expect(okRev, "G(d) is R(d) reversed for all 10 digits");
  expect(okParity, "L-codes have odd #bars, G-codes even (the parity that carries the 1st digit)");
}

console.log("\n── EAN-13 bad input ─────────────────────────────────────");
expect(encodeBarcode("ean13", "12345").ok === false, "5 digits → error (wrong length)");
expect(encodeBarcode("ean13", "abcabcabcabc").ok === false, "non-digits → error");
expect(encodeBarcode("ean13", "").ok === false, "empty → error");

console.log("\n── Code 128 checksum (hand-computed vector) ─────────────");
{
  // "CODE128": Start-B(104) + C(35) O(47) D(36) E(37) 1(17) 2(18) 8(24)   [only 3 digits → stays in B]
  //   104 + 1·35 + 2·47 + 3·36 + 4·37 + 5·17 + 6·18 + 7·24 = 850 ; 850 mod 103 = 26
  const r = encodeBarcode("code128", "CODE128");
  expect(r.ok, "CODE128 encodes");
  expect(r._symbols[0] === 104, "Start-B (value 104) chosen for a letters-first string");
  expect(r._check === 26, "mod-103 check symbol = 26 (hand-computed)");
  // re-derive the checksum independently from the value list minus check/stop.
  const dataVals = r._symbols.slice(0, r._symbols.length - 2);
  expect(code128Checksum(dataVals) === 26, "code128Checksum() reproduces 26 from the value list");
  expect(r._symbols[r._symbols.length - 1] === 106, "STOP (value 106) appended last");
}

console.log("\n── Code 128 Start-C for all-numeric even input ──────────");
{
  const r = encodeBarcode("code128", "12345678");
  expect(r._symbols[0] === 105, "Start-C (105) chosen for 8 even digits");
  // Start-C + 12,34,56,78 + check + stop = 6 symbols; check = (105 + 1·12+2·34+3·56+4·78) mod 103
  const expectCheck = (105 + 1 * 12 + 2 * 34 + 3 * 56 + 4 * 78) % 103;   // = (105+12+68+168+312)=665 %103 = 47
  expect(r._check === expectCheck && expectCheck === 47, "digit-pair Code-C checksum = 47");
  expect(r._symbols.slice(1, 5).join(",") === "12,34,56,78", "digits packed as pairs 12,34,56,78");
}

console.log("\n── Code 128 exact spec patterns (start + stop) ──────────");
{
  const r = encodeBarcode("code128", "CODE128");
  const bits = runsToBits(r.modules);
  // Start-B width pattern = 211214, Stop = 2331112 — fixed spec values, independent of the data.
  const startBits = [..."211214"].map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(+w)).join("");
  const stopBits = [..."2331112"].map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(+w)).join("");
  expect(bits.startsWith(startBits), "symbol begins with the Start-B pattern (211214)");
  expect(bits.endsWith(stopBits), "symbol ends with the Stop pattern (2331112, trailing 2-module bar)");
  expect(r.modules[0] > 0, "run-lengths start with a bar");
  // width sanity: 9 symbols (start + 7 data + 1 check) × 11 + 13 (stop) = 112 modules.
  expect(r.widthUnits === 9 * 11 + 13, "total width = 9×11 + 13 = 112 modules");
  expect(sum(r.modules) === r.widthUnits, "run-lengths sum to widthUnits");
}

console.log("\n── Code 128 round-trip module sanity + bad input ────────");
{
  const r = encodeBarcode("code128", "SWITCHBOARD");
  // 11 chars, all Code-B, no digit run → Start + 11 data + check + stop = 14 symbols → 13×11 + 13.
  expect(r.ok && r.widthUnits === 13 * 11 + 13, "SWITCHBOARD → 13×11 + 13 = 156 modules");
  expect(r.text === "SWITCHBOARD", "text preserved for the human-readable line");
}
expect(encodeBarcode("code128", "").ok === false, "empty Code 128 → error");
expect(encodeBarcode("nope", "x").ok === false, "unknown type → error");
expect(Array.isArray(BARCODE_TYPES) && BARCODE_TYPES.length === 2, "two types exported (code128, ean13)");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
