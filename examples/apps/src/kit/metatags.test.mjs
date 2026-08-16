// Headless assertions for the meta-tag builder. node examples/apps/src/kit/metatags.test.mjs
// The thing that breaks in real use is escaping and blank-field leakage, so both are pinned.
import { build, preview, FIELDS } from "./metatags.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

const full = build({ title: "My Page", description: "A demo.", url: "https://example.com/p", image: "https://example.com/c.png", siteName: "Example" });
console.log("\n── full build ───────────────────────────────────────────");
expect(full.includes("<title>My Page</title>"), "emits <title>");
expect(full.includes('<meta name="description" content="A demo.">'), "description meta");
expect(full.includes('<link rel="canonical" href="https://example.com/p">'), "canonical link");
expect(full.includes('<meta property="og:title" content="My Page">'), "og:title");
expect(full.includes('<meta property="og:image" content="https://example.com/c.png">'), "og:image");
expect(full.includes('<meta name="twitter:card" content="summary_large_image">'), "twitter card defaults to large when an image is set");

console.log("\n── omit blanks + defaults ───────────────────────────────");
const min = build({ title: "Just a title" });
expect(min.includes("<title>Just a title</title>"), "title present");
expect(!min.includes("og:image"), "no og:image when none given");
expect(!min.includes("twitter:image"), "no twitter:image when none given");
expect(build({ description: "d", image: "" }).includes('twitter:card" content="summary"'), "no image → summary card");
expect(build({}) === "", "all-empty → empty string (not a block of blank tags)");

console.log("\n── escaping (the load-bearing bit) ──────────────────────");
const esc = build({ title: 'Ben & Jerry\'s "Best" <ever>', description: "a & b" });
expect(esc.includes("Ben &amp; Jerry's &quot;Best&quot; &lt;ever&gt;"), "title escapes & \" < >");
expect(esc.includes('content="a &amp; b"'), "description escapes &");
expect(!/<title>.*<ever>.*<\/title>/.test(esc), "no raw < leaks into markup");

console.log("\n── preview model ────────────────────────────────────────");
const p = preview({ title: "Hi", url: "https://sub.example.com/x?y=1", image: "https://x/i.png" });
expect(p.host === "sub.example.com", "preview extracts host from URL");
expect(p.hasImage === true, "preview flags image present");
expect(preview({}).title === "Untitled page", "empty preview has a sensible placeholder");
expect(FIELDS.length >= 8 && FIELDS.every((x) => x.k && x.label), "FIELDS is a well-formed form spec");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
