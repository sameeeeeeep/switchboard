// Headless assertions for the encoders. No browser, no bundler (node ≥18 has crypto.subtle):
//   node examples/apps/src/kit/encoder.test.mjs
// Hashes are checked against the published FIPS/NIST test vectors, and Base64 against a UTF-8
// round-trip that the naïve btoa() would corrupt — the two things people actually get wrong.
import { toBase64, fromBase64, urlEncode, urlDecode, htmlEscape, htmlUnescape, hash, convert } from "./encoder.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

const run = async () => {
  console.log("\n── Base64 (UTF-8 + url-safe) ────────────────────────────");
  expect(toBase64("hello") === "aGVsbG8=", "'hello' → aGVsbG8=");
  const tricky = "Héllo 👋 wörld";
  expect(fromBase64(toBase64(tricky)) === tricky, "emoji + accents round-trip exactly (naïve btoa can't)");
  expect(toBase64("man") === "bWFu", "known vector 'man' → bWFu");
  const us = toBase64("<<<???>>>", { urlSafe: true });
  expect(!/[+/=]/.test(us), "url-safe output has no + / or =");
  expect(fromBase64(us) === "<<<???>>>", "url-safe form still decodes");
  let threw = false; try { fromBase64("not base64!!!"); } catch { threw = true; }
  expect(threw, "invalid Base64 throws (not silent mojibake)");

  console.log("\n── URL ──────────────────────────────────────────────────");
  expect(urlEncode("a b&c=d") === "a%20b%26c%3Dd", "encodes space, &, =");
  expect(urlDecode("a%20b%26c") === "a b&c", "decodes back");
  let uThrew = false; try { urlDecode("%zz"); } catch { uThrew = true; }
  expect(uThrew, "malformed percent-encoding throws a clear error");

  console.log("\n── HTML entities ────────────────────────────────────────");
  expect(htmlEscape('<a href="x">&</a>') === "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;", "escapes the five");
  expect(htmlUnescape("&lt;b&gt;&amp;&#169;&#xA9;") === "<b>&©©", "unescapes named + numeric refs");
  expect(htmlUnescape(htmlEscape("a<b>&\"'c")) === "a<b>&\"'c", "escape∘unescape round-trips (& order matters)");

  console.log("\n── hashes (NIST test vectors) ───────────────────────────");
  expect(await hash("abc", "SHA-256") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256('abc')");
  expect(await hash("abc", "SHA-1") === "a9993e364706816aba3e25717850c26c9cd0d89d", "SHA-1('abc')");
  expect((await hash("", "SHA-256")) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "SHA-256('') empty-string vector");
  expect(await hash("abc", "sha256") === await hash("abc", "SHA-256"), "algo alias 'sha256' works");
  let hThrew = false; try { await hash("x", "md5"); } catch { hThrew = true; }
  expect(hThrew, "unsupported algo (md5) throws");

  console.log("\n── the convert() orchestrator (never throws) ────────────");
  expect((await convert("base64", "hi")).output === "aGk=", "convert base64 encode");
  expect((await convert("base64", "aGk=", { decode: true })).output === "hi", "convert base64 decode");
  expect((await convert("hash", "abc", { algo: "SHA-1" })).output === "a9993e364706816aba3e25717850c26c9cd0d89d", "convert hash");
  const bad = await convert("base64", "!!!", { decode: true });
  expect(bad.ok === false && typeof bad.error === "string", "bad decode → {ok:false,error}, never throws");
  expect((await convert("nope", "x")).ok === false, "unknown mode → ok:false");

  console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
  process.exit(fails ? 1 : 0);
};
run();
