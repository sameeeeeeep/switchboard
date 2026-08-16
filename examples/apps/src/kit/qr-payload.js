// QR PAYLOAD BUILDERS — the *content* half of a QR code, kept pure and separate from the encoder.
//
// A QR code is just a string; what makes "share my wifi" or "scan my contact card" work is encoding
// that string in the exact format phone cameras recognise. Those formats are unforgiving about
// escaping — an SSID containing a `;` or a name containing a `,` silently produces a QR that scans
// into garbage — which is precisely why this lives in one tested module instead of inline template
// strings.
//
// Pure: no DOM, no imports, no side effects. Headless-testable (see qr-payload.test.mjs).

/** WIFI: and vCard both use backslash escaping, but over different character sets. */
const esc = (s, chars) => {
  let out = "";
  for (const ch of String(s ?? "")) out += chars.includes(ch) ? "\\" + ch : ch;
  return out;
};
/** WIFI: T:…;S:…;P:…;; — `\ ; , : "` are the reserved characters. */
const escWifi = (s) => esc(s, '\\;,:"');
/** vCard 3.0 text values — `\ ; ,` escaped, real newlines become the literal \n sequence. */
const escVCard = (s) => esc(String(s ?? "").replace(/\r\n|\r|\n/g, "\n"), "\\;,").replace(/\n/g, "\\n");

const clean = (s) => String(s ?? "").trim();
/** Phone numbers keep a leading + and digits; everything else (spaces, dashes, brackets) is noise
 *  that some scanners choke on. */
const escTel = (s) => clean(s).replace(/[^\d+]/g, "");

/** The kinds the UI offers. `fields` drives the form, so adding a kind never touches the renderer. */
export const KINDS = [
  { id: "text",    label: "Text / URL", hint: "any link or plain text",
    fields: [{ k: "text", label: "Text or URL", placeholder: "https://example.com or any text…", wide: true }] },
  { id: "wifi",    label: "Wi-Fi", hint: "guests join without typing a password",
    fields: [{ k: "ssid", label: "Network name (SSID)", placeholder: "MyNetwork" },
             { k: "password", label: "Password", placeholder: "leave empty for an open network", secret: true },
             { k: "security", label: "Security", options: ["WPA", "WEP", "nopass"] },
             { k: "hidden", label: "Hidden network", toggle: true }] },
  { id: "contact", label: "Contact", hint: "a vCard — scans straight into Contacts",
    fields: [{ k: "first", label: "First name", placeholder: "Ada" },
             { k: "last", label: "Last name", placeholder: "Lovelace" },
             { k: "org", label: "Organisation", placeholder: "Analytical Engines" },
             { k: "title", label: "Job title", placeholder: "Mathematician" },
             { k: "phone", label: "Phone", placeholder: "+44 20 7946 0000" },
             { k: "email", label: "Email", placeholder: "ada@example.com" },
             { k: "url", label: "Website", placeholder: "https://example.com" },
             { k: "note", label: "Note", placeholder: "met at the launch" }] },
  { id: "email",   label: "Email", hint: "opens a pre-filled draft",
    fields: [{ k: "to", label: "To", placeholder: "hello@example.com" },
             { k: "subject", label: "Subject", placeholder: "optional" },
             { k: "body", label: "Message", placeholder: "optional", wide: true }] },
  { id: "sms",     label: "SMS", hint: "opens Messages, pre-filled",
    fields: [{ k: "phone", label: "Number", placeholder: "+44 7700 900000" },
             { k: "message", label: "Message", placeholder: "optional", wide: true }] },
  { id: "phone",   label: "Phone", hint: "tap to call",
    fields: [{ k: "phone", label: "Number", placeholder: "+44 20 7946 0000" }] },
  { id: "geo",     label: "Location", hint: "opens in Maps",
    fields: [{ k: "lat", label: "Latitude", placeholder: "51.5072" },
             { k: "lon", label: "Longitude", placeholder: "-0.1276" }] },
];

/** Build the encodable string for a kind. Returns "" when there isn't enough to encode yet — the
 *  caller shows its empty state rather than encoding a half-formed payload. */
export function buildPayload(kind, f = {}) {
  switch (kind) {
    case "wifi": {
      const ssid = clean(f.ssid);
      if (!ssid) return "";
      // An open network is `nopass` with no P: field — writing P:; on an open network makes some
      // Android scanners refuse to join.
      const sec = f.security === "WEP" ? "WEP" : f.security === "nopass" ? "nopass" : "WPA";
      const pw = clean(f.password);
      const type = !pw ? "nopass" : sec;
      let s = `WIFI:T:${type};S:${escWifi(ssid)};`;
      if (type !== "nopass") s += `P:${escWifi(pw)};`;
      if (f.hidden) s += "H:true;";
      return s + ";";
    }
    case "contact": {
      const first = clean(f.first), last = clean(f.last);
      const fn = [first, last].filter(Boolean).join(" ");
      // A card with no name and no way to reach the person isn't a contact.
      if (!fn && !clean(f.phone) && !clean(f.email)) return "";
      const lines = ["BEGIN:VCARD", "VERSION:3.0",
                     `N:${escVCard(last)};${escVCard(first)};;;`,
                     `FN:${escVCard(fn)}`];
      if (clean(f.org)) lines.push(`ORG:${escVCard(f.org)}`);
      if (clean(f.title)) lines.push(`TITLE:${escVCard(f.title)}`);
      if (clean(f.phone)) lines.push(`TEL;TYPE=CELL:${escTel(f.phone)}`);
      if (clean(f.email)) lines.push(`EMAIL;TYPE=INTERNET:${escVCard(f.email)}`);
      if (clean(f.url)) lines.push(`URL:${clean(f.url)}`);
      if (clean(f.note)) lines.push(`NOTE:${escVCard(f.note)}`);
      lines.push("END:VCARD");
      return lines.join("\n");
    }
    case "email": {
      const to = clean(f.to);
      if (!to) return "";
      const q = [];
      if (clean(f.subject)) q.push("subject=" + encodeURIComponent(clean(f.subject)));
      if (clean(f.body)) q.push("body=" + encodeURIComponent(clean(f.body)));
      return `mailto:${to}` + (q.length ? "?" + q.join("&") : "");
    }
    case "sms": {
      const n = escTel(f.phone);
      if (!n) return "";
      // SMSTO: is the format iOS and Android camera apps both recognise; sms:?body= is patchier.
      return clean(f.message) ? `SMSTO:${n}:${clean(f.message)}` : `SMSTO:${n}`;
    }
    case "phone": {
      const n = escTel(f.phone);
      return n ? `tel:${n}` : "";
    }
    case "geo": {
      const rawLat = clean(f.lat), rawLon = clean(f.lon);
      // Number("") is 0, not NaN — without the empty check a blank longitude encodes a real
      // coordinate off the coast of Africa instead of nothing at all.
      if (!rawLat || !rawLon) return "";
      const lat = Number(rawLat), lon = Number(rawLon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return "";
      return `geo:${lat},${lon}`;
    }
    default:
      return clean(f.text);
  }
}

/** A short human label for what a payload IS, for the caption under the code. */
export function describePayload(kind, f = {}) {
  switch (kind) {
    case "wifi": return `Wi-Fi · ${clean(f.ssid) || "network"}${clean(f.password) ? "" : " · open"}`;
    case "contact": return `Contact · ${[clean(f.first), clean(f.last)].filter(Boolean).join(" ") || clean(f.email) || "card"}`;
    case "email": return `Email · ${clean(f.to)}`;
    case "sms": return `SMS · ${clean(f.phone)}`;
    case "phone": return `Call · ${clean(f.phone)}`;
    case "geo": return `Location · ${clean(f.lat)}, ${clean(f.lon)}`;
    default: {
      const t = clean(f.text);
      return t.length > 42 ? t.slice(0, 41) + "…" : t;
    }
  }
}

/** What the user still has to fill in before there's anything to encode. One sentence, never a list
 *  of validation errors — the form is short enough that naming the missing field is enough. */
export function missingHint(kind, f = {}) {
  switch (kind) {
    case "wifi": return "Enter the network name to get a code your guests can scan.";
    case "contact": return "Enter a name, phone or email to build the contact card.";
    case "email": return "Enter the address this should email.";
    case "sms": return "Enter the number this should text.";
    case "phone": return "Enter the number this should call.";
    case "geo": return "Enter a latitude and longitude (e.g. 51.5072, -0.1276).";
    default: return "Type something above to get a QR code.";
  }
}
