// Headless assertions for the ICO container packer + default size set. No browser, no bundler:
//   node examples/apps/src/kit/favicon.test.mjs
// The .ico byte layout is checked field-by-field against the format spec (ICONDIR + ICONDIRENTRY +
// concatenated PNG blobs), because "the browser still shows an icon" hides an off-by-one offset that
// leaves other tools unable to read the file.
import { buildIco, faviconSizes, headerByteLength, pngByteOffset } from "./favicon.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

// Fake PNG blobs — the packer treats them as opaque bytes, so distinct lengths + marker bytes are all
// we need to prove the offsets/sizes land where the spec says.
const fake = (len, marker) => { const a = new Uint8Array(len); a.fill(marker); return a; };

console.log("\n── faviconSizes (default set) ───────────────────────────");
const sizes = faviconSizes();
expect(JSON.stringify(sizes) === JSON.stringify([16, 32, 48, 64, 180, 192, 512]), "default = [16,32,48,64,180,192,512]");
expect(JSON.stringify(faviconSizes({ only: [32, 16, 16] })) === JSON.stringify([16, 32]), "only:[] replaces, dedupes + sorts");
expect(faviconSizes({ extra: [24] }).includes(24), "extra:[] appends");
expect(!faviconSizes({ extra: [999] }).includes(999), "clamps out >256");

console.log("\n── buildIco header (ICONDIR) ────────────────────────────");
const imgs = [
  { size: 16, png: fake(40, 0xa1) },
  { size: 32, png: fake(90, 0xb2) },
  { size: 48, png: fake(150, 0xc3) },
];
const n = imgs.length;
const ico = buildIco(imgs);
const head = Array.from(ico.slice(0, 6));
expect(JSON.stringify(head) === JSON.stringify([0, 0, 1, 0, n, 0]), `header is [0,0,1,0,${n},0]`);

const dv = new DataView(ico.buffer);
expect(dv.getUint16(0, true) === 0, "reserved = 0");
expect(dv.getUint16(2, true) === 1, "type = 1 (icon)");
expect(dv.getUint16(4, true) === n, `count = ${n}`);

console.log("\n── ICONDIRENTRY size + offset fields ────────────────────");
const pngLengths = imgs.map((im) => im.png.length);
let expectedOffset = headerByteLength(n);           // first image sits right after the directory
expect(expectedOffset === 6 + 16 * n, `first offset = 6 + 16*n = ${6 + 16 * n}`);
let prevOffset = -1;
for (let i = 0; i < n; i++) {
  const base = 6 + 16 * i;
  const w = dv.getUint8(base + 0), h = dv.getUint8(base + 1);
  const byteSize = dv.getUint32(base + 8, true);
  const offset = dv.getUint32(base + 12, true);
  expect(byteSize === pngLengths[i], `entry ${i}: size field == PNG length (${pngLengths[i]})`);
  expect(offset === expectedOffset, `entry ${i}: offset == ${expectedOffset}`);
  expect(offset === pngByteOffset(pngLengths, i), `entry ${i}: offset matches pngByteOffset()`);
  expect(offset > prevOffset, `entry ${i}: offset strictly increases`);
  expect(w === imgs[i].size && h === imgs[i].size, `entry ${i}: width/height == ${imgs[i].size}`);
  prevOffset = offset;
  expectedOffset += pngLengths[i];
}

console.log("\n── total length + blob placement ────────────────────────");
const sum = pngLengths.reduce((a, b) => a + b, 0);
expect(ico.length === 6 + 16 * n + sum, `total length == 6 + 16*n + Σpng (${6 + 16 * n + sum})`);
// the actual PNG bytes are copied at their stated offsets (marker byte per blob)
expect(ico[6 + 16 * n] === 0xa1, "blob 0 bytes land at first offset");
expect(ico[6 + 16 * n + 40] === 0xb2, "blob 1 bytes follow blob 0");

console.log("\n── 256px entry writes width/height 0 ────────────────────");
const big = buildIco([{ size: 256, png: fake(20, 0xff) }]);
expect(big[6] === 0 && big[7] === 0, "256px ⇒ width byte 0, height byte 0");

console.log("\n── guards ───────────────────────────────────────────────");
let threw = false;
try { buildIco([]); } catch { threw = true; }
expect(threw, "empty images → throws");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
