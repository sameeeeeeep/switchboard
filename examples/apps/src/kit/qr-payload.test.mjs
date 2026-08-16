// Headless assertions for the QR payload builders. No browser, no bundler:
//   node examples/apps/src/kit/qr-payload.test.mjs
// These formats are the part that silently breaks — an unescaped `;` in an SSID or a `,` in a surname
// produces a QR that scans cleanly into the wrong thing — so every escape rule gets a case.
import { buildPayload, describePayload, missingHint, KINDS } from "./qr-payload.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };
const eq = (got, want, what) => expect(got === want, `${what}${got === want ? "" : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`);

console.log("\n── Wi-Fi ────────────────────────────────────────────────");
eq(buildPayload("wifi", { ssid: "MyNet", password: "hunter2", security: "WPA" }),
   "WIFI:T:WPA;S:MyNet;P:hunter2;;", "plain WPA network");
eq(buildPayload("wifi", { ssid: "MyNet", password: "hunter2", security: "WPA", hidden: true }),
   "WIFI:T:WPA;S:MyNet;P:hunter2;H:true;;", "hidden network adds H:true");
eq(buildPayload("wifi", { ssid: "Cafe Guest", security: "nopass" }),
   "WIFI:T:nopass;S:Cafe Guest;;", "open network omits P: entirely");
// An empty password means open, whatever the dropdown says — writing T:WPA;P:; makes Android refuse.
eq(buildPayload("wifi", { ssid: "Cafe", password: "", security: "WPA" }),
   "WIFI:T:nopass;S:Cafe;;", "empty password downgrades to nopass");
eq(buildPayload("wifi", { ssid: "Bob's; Wi-Fi", password: 'p:a,s"s\\1', security: "WPA" }),
   'WIFI:T:WPA;S:Bob\'s\\; Wi-Fi;P:p\\:a\\,s\\"s\\\\1;;', "escapes \\ ; , : and \" in SSID and password");
eq(buildPayload("wifi", { ssid: "   " }), "", "blank SSID → nothing to encode");
eq(buildPayload("wifi", { ssid: "Net", password: "pw", security: "WEP" }),
   "WIFI:T:WEP;S:Net;P:pw;;", "WEP passes through");

console.log("\n── vCard ────────────────────────────────────────────────");
eq(buildPayload("contact", { first: "Ada", last: "Lovelace", phone: "+44 20 7946 0000", email: "ada@example.com" }),
   ["BEGIN:VCARD", "VERSION:3.0", "N:Lovelace;Ada;;;", "FN:Ada Lovelace",
    "TEL;TYPE=CELL:+442079460000", "EMAIL;TYPE=INTERNET:ada@example.com", "END:VCARD"].join("\n"),
   "name + phone + email, phone stripped to digits and +");
eq(buildPayload("contact", { first: "Ada", last: "Smith, Jr.", note: "line1\nline2" }),
   ["BEGIN:VCARD", "VERSION:3.0", "N:Smith\\, Jr.;Ada;;;", "FN:Ada Smith\\, Jr.",
    "NOTE:line1\\nline2", "END:VCARD"].join("\n"),
   "escapes , in names and folds real newlines to \\n");
expect(buildPayload("contact", { org: "Acme" }) === "", "org alone isn't a contact → nothing to encode");
expect(buildPayload("contact", { email: "a@b.co" }).includes("EMAIL"), "email alone IS enough");
expect(!buildPayload("contact", { first: "Ada" }).includes("ORG:"), "absent fields emit no empty lines");

console.log("\n── email · sms · phone · geo ────────────────────────────");
eq(buildPayload("email", { to: "a@b.co" }), "mailto:a@b.co", "bare mailto");
eq(buildPayload("email", { to: "a@b.co", subject: "hi there", body: "a&b" }),
   "mailto:a@b.co?subject=hi%20there&body=a%26b", "subject/body are URL-encoded");
eq(buildPayload("email", { subject: "no recipient" }), "", "no address → nothing to encode");
eq(buildPayload("sms", { phone: "+44 7700 900000", message: "hello" }), "SMSTO:+447700900000:hello", "SMSTO with body");
eq(buildPayload("sms", { phone: "07700 900000" }), "SMSTO:07700900000", "SMSTO without body");
eq(buildPayload("phone", { phone: "(020) 7946-0000" }), "tel:02079460000", "tel strips punctuation");
eq(buildPayload("geo", { lat: "51.5072", lon: "-0.1276" }), "geo:51.5072,-0.1276", "geo pair");
eq(buildPayload("geo", { lat: "51.5072", lon: "" }), "", "half a coordinate → nothing to encode");
eq(buildPayload("geo", { lat: "999", lon: "0" }), "", "out-of-range latitude rejected");
eq(buildPayload("geo", { lat: "abc", lon: "1" }), "", "non-numeric coordinate rejected");

console.log("\n── text (the default) + shared behaviour ────────────────");
eq(buildPayload("text", { text: "  https://example.com  " }), "https://example.com", "text is trimmed");
eq(buildPayload("text", {}), "", "empty text → nothing to encode");
eq(buildPayload("nonsense-kind", { text: "hi" }), "hi", "an unknown kind falls back to text, never throws");
expect(KINDS.every((k) => k.fields?.length), "every kind declares its fields (the form is data-driven)");
expect(KINDS.every((k) => typeof missingHint(k.id) === "string" && missingHint(k.id).length > 10),
       "every kind has a real empty-state sentence");
expect(describePayload("wifi", { ssid: "Cafe" }).includes("open"), "caption says when a network is open");
expect(describePayload("text", { text: "x".repeat(80) }).length <= 42, "long text captions are truncated");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
