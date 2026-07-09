// NATAL — your birth chart, read bluntly, on the visitor's OWN Claude through Switchboard.
// No tools, no server, no ephemeris: the model estimates positions from the birth data and
// delivers verdicts. The only Switchboard element on the page is the standard chip.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const PROFILE_KEY = "natal:profile";
const READING_KEY = "natal:reading";

let relay = null;
let notInstalled = false;
let busy = false;
let reading = null;     // { profile, data, at }
let lastAction = null;  // what RETRY re-runs

// ---------- persistence ----------
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---------- glyph tables ----------
const SIGN_GLYPHS = {
  aries: "♈", taurus: "♉", gemini: "♊", cancer: "♋", leo: "♌", virgo: "♍",
  libra: "♎", scorpio: "♏", sagittarius: "♐", capricorn: "♑", aquarius: "♒", pisces: "♓",
};
const PLANET_GLYPHS = {
  sun: "☉", moon: "☽", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃",
  saturn: "♄", uranus: "♅", neptune: "♆", pluto: "♇", chiron: "⚷",
  "north node": "☊", "south node": "☋",
};
const signGlyph = (s) => SIGN_GLYPHS[String(s || "").trim().toLowerCase()] || "";
const planetGlyph = (planet, offered) =>
  PLANET_GLYPHS[String(planet || "").trim().toLowerCase()] || String(offered || "·").slice(0, 2);

const dateLine = (ts) =>
  new Date(ts).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).toUpperCase();

// ---------- form ----------
function readForm() {
  const time = $("f-time").value;
  const unknown = $("f-unknown").checked || !time;
  return {
    name: $("f-name").value.trim() || "S.",
    date: $("f-date").value || "1994-11-02",
    time: unknown ? "" : time,
    unknown,
    place: $("f-place").value.trim() || "Bombay, India",
  };
}
function fillForm(p) {
  $("f-name").value = p.name || "S.";
  $("f-date").value = p.date || "1994-11-02";
  $("f-time").value = p.time || "";
  $("f-unknown").checked = !!p.unknown;
  $("f-place").value = p.place || "";
  syncTime();
}
function syncTime() {
  const off = $("f-unknown").checked;
  $("f-time").disabled = off;
  $("time-note").hidden = !off;
}
$("f-unknown").addEventListener("change", syncTime);

// Sample souls — the form is never blank and never needs your own data to explore.
const SOULS = [
  { label: "R. — Reykjavík, 04:44", name: "R.", date: "1988-03-21", time: "04:44", unknown: false, place: "Reykjavík, Iceland" },
  { label: "J. — New Orleans, 23:15", name: "J.", date: "2001-07-30", time: "23:15", unknown: false, place: "New Orleans, USA" },
  { label: "M. — Kyoto, time lost", name: "M.", date: "1972-12-09", time: "", unknown: true, place: "Kyoto, Japan" },
];
SOULS.forEach((s) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "soul";
  b.textContent = s.label;
  b.addEventListener("click", () => fillForm(s));
  $("souls").append(b);
});

// ---------- the standard connect chip ----------
mountConnect($("chip-dock"), {
  scope: { reason: "read your birth chart", models: ["sonnet"] },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; notInstalled = false; reflect(); },
  onDisconnect: () => { relay = null; reflect(); },
});
// Fast probe so a returning user's grant enables the buttons without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) relay = r;
  } else {
    notInstalled = true;
  }
  reflect();
})();

function reflect() {
  const on = !!relay && !busy;
  $("read").disabled = !on;
  $("rebrief").disabled = !on;
  $("reread").disabled = !on;
  for (const id of ["conn-hint", "chart-hint"]) {
    const el = $(id);
    el.textContent = "";
    if (busy) el.textContent = "reading…";
    else if (relay) el.textContent = "runs on your Claude. nothing is sent anywhere else.";
    else if (notInstalled) {
      const a = document.createElement("a");
      a.href = INSTALL_URL;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = "get Switchboard →";
      el.append("Switchboard not detected. ", a);
    } else el.textContent = "connect Switchboard (top right) to read the sky.";
  }
}

// ---------- voice + prompts ----------
const VOICE = [
  "VOICE — this is law:",
  "Co-Star register. Blunt. Spare. Oddly specific. Second person. Zero hedging. Zero mysticism-kitsch. No emoji. Short sentences that stop.",
  'Register examples (match the temperature, not the words): "Trust issues are compatibility issues." "You call it standards. It is fear with a skincare routine."',
  "Never explain astrology. Never define a term. No caveats, no comfort, no 'perhaps'. Deliver verdicts.",
].join("\n");

function fullPrompt(p) {
  const born = p.unknown
    ? `born ${p.date}, birth time unknown, in ${p.place}`
    : `born ${p.date} at ${p.time} local time in ${p.place}`;
  return [
    `You are NATAL, a natal-chart reader. Subject: ${p.name}, ${born}.`,
    `From your own knowledge, estimate the APPROXIMATE sun and moon${p.unknown ? "" : " and rising"} sign for this birth data. You have no ephemeris tools; approximation is expected. The sun sign is reliable, the moon is a best estimate${p.unknown ? "" : ", the rising follows from the time and place"}.`,
    p.unknown ? `The birth time is unknown, so the rising sign CANNOT be computed. Set "rising" to null. Do not guess it.` : "",
    `Today is ${dateLine(Date.now())}.`,
    VOICE,
    `Respond with ONLY one JSON object. No prose, no markdown fences, no backticks. Exactly this shape:`,
    `{"sun":{"sign":"Scorpio","gloss":"one blunt sentence"},"moon":{"sign":"...","gloss":"one blunt sentence"},"rising":${p.unknown ? "null" : `{"sign":"...","gloss":"one blunt sentence"}`},"placements":[{"planet":"Mercury","glyph":"☿","sign":"...","oneLiner":"one blunt sentence"}],"today":{"title":"three to six word headline","body":"2-4 sentences about today for this chart"},"power":{"do":["short imperative","short imperative","short imperative"],"dont":["short imperative","short imperative","short imperative"]},"pin":"one devastating one-liner about this person"}`,
    `"placements" must contain 5 to 7 entries — Mercury, Venus, Mars, plus a few of Jupiter/Saturn/Uranus/Neptune/Pluto. Do not repeat sun, moon, or rising. "sign" values are capitalized sign names (Aries through Pisces). "glyph" is the planet's unicode glyph.`,
  ].filter(Boolean).join("\n\n");
}

function briefPrompt(p, d) {
  const chart =
    `Sun ${d.sun.sign}, Moon ${d.moon.sign}` +
    (d.rising ? `, Rising ${d.rising.sign}` : " (no rising — birth time unknown)");
  return [
    `You are NATAL, a natal-chart reader. Subject on file: ${p.name} — ${chart}.`,
    `Today is ${dateLine(Date.now())}. Write today's brief for this chart.`,
    VOICE,
    `Respond with ONLY one JSON object. No prose, no markdown fences, no backticks. Exactly this shape:`,
    `{"today":{"title":"three to six word headline","body":"2-4 sentences about today"},"power":{"do":["short imperative","short imperative","short imperative"],"dont":["short imperative","short imperative","short imperative"]},"pin":"one devastating one-liner"}`,
  ].join("\n\n");
}

// ---------- streaming ----------
async function ask(prompt) {
  let acc = "";
  for await (const d of relay.stream({ prompt })) {
    if (d.type === "text") {
      acc += d.text;
      $("prog-line").textContent = "READING THE SKY · " + (acc.length / 1024).toFixed(1) + " KB";
    } else if (d.type === "error") {
      throw new Error(d.error?.message || "stream error");
    }
  }
  const m = acc.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("the sky returned prose, not data");
  return JSON.parse(m[0]); // SyntaxError surfaces via the caller's catch → visible sysline + RETRY
}

function vetFull(d) {
  if (!d?.sun?.sign || !d?.moon?.sign || !Array.isArray(d?.placements) || !d.placements.length ||
      !d?.today?.body || !Array.isArray(d?.power?.do) || !Array.isArray(d?.power?.dont) || !d?.pin) {
    throw new Error("incomplete reading");
  }
  return d;
}
function vetBrief(d) {
  if (!d?.today?.body || !Array.isArray(d?.power?.do) || !Array.isArray(d?.power?.dont) || !d?.pin) {
    throw new Error("incomplete brief");
  }
  return d;
}

// ---------- busy / error surfaces ----------
const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
let glyphTimer = null;
function setBusy(on, line) {
  busy = on;
  $("progress").hidden = !on;
  clearInterval(glyphTimer);
  if (on) {
    $("sysline").hidden = true;
    $("prog-line").textContent = line;
    $("prog-glyph").textContent = ZODIAC[0];
    let i = 0;
    glyphTimer = setInterval(() => { i = (i + 1) % ZODIAC.length; $("prog-glyph").textContent = ZODIAC[i]; }, 240);
    $("progress").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  reflect();
}

function sys(msg) {
  // Terse, visible, black and white. Model/daemon text goes in via textContent only.
  $("sys-msg").textContent = "SYSTEM / " + msg;
  $("sysline").hidden = false;
}
function errText(err) {
  if (err instanceof SyntaxError) return "the reading did not parse. retry — the sky cooperates the second time.";
  return String(err?.message || err).slice(0, 180) + " — retry.";
}
$("sys-retry").addEventListener("click", () => { $("sysline").hidden = true; lastAction?.(); });

// ---------- views ----------
function show(view) {
  $("intake").hidden = view !== "intake";
  $("chart").hidden = view !== "chart";
}

// ---------- actions ----------
async function doFullRead() {
  if (!relay || busy) return;
  lastAction = doFullRead;
  const profile = readForm();
  setBusy(true, "READING THE SKY");
  try {
    const data = vetFull(await ask(fullPrompt(profile)));
    reading = { profile, data, at: Date.now() };
    save(PROFILE_KEY, profile);
    save(READING_KEY, reading);
    renderReading(reading);
    show("chart");
    $("chart").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    sys(errText(err));
  } finally {
    setBusy(false);
  }
}

// New day, new brief — re-asks ONLY today/power/pin; the chart itself doesn't move.
async function doBrief() {
  if (!relay || busy || !reading) return;
  lastAction = doBrief;
  setBusy(true, "NEW DAY, NEW BRIEF");
  try {
    const d = vetBrief(await ask(briefPrompt(reading.profile, reading.data)));
    reading.data.today = d.today;
    reading.data.power = d.power;
    reading.data.pin = d.pin;
    reading.at = Date.now();
    save(READING_KEY, reading);
    renderReading(reading);
  } catch (err) {
    sys(errText(err));
  } finally {
    setBusy(false);
  }
}

$("read").addEventListener("click", doFullRead);
$("rebrief").addEventListener("click", doBrief);
$("reread").addEventListener("click", () => {
  if (reading) fillForm(reading.profile); // re-read the same soul, fresh verdicts
  doFullRead();
});
$("edit").addEventListener("click", () => {
  if (reading) fillForm(reading.profile);
  show("intake");
});

// ---------- render ----------
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
};

function renderReading(r) {
  const p = r.profile, d = r.data;

  $("c-name-line").textContent = [
    p.name,
    "born " + p.date + (p.unknown ? " · time unknown" : " · " + p.time),
    p.place,
  ].join("  ·  ");

  // the triptych
  const trip = $("trip");
  trip.textContent = "";
  [
    { label: "Sun", glyph: "☉", body: d.sun },
    { label: "Moon", glyph: "☽", body: d.moon },
    { label: "Rising", glyph: "↑", body: d.rising },
  ].forEach((c) => {
    const cell = document.createElement("div");
    cell.className = "tcell" + (c.body ? "" : " withheld");
    cell.append(
      el("div", "tglyph", c.glyph),
      el("div", "tlabel", c.label),
      el("div", "tsign", c.body ? `${c.body.sign} ${signGlyph(c.body.sign)}`.trim() : "—"),
      el("div", "tgloss", c.body ? String(c.body.gloss || "") : "Birth time unknown. The rising sign is withheld, not guessed."),
    );
    trip.append(cell);
  });

  // the ephemeris table
  const eph = $("eph");
  eph.textContent = "";
  (d.placements || []).slice(0, 8).forEach((pl) => {
    const row = document.createElement("div");
    row.className = "erow";
    row.append(
      el("span", "eg", planetGlyph(pl.planet, pl.glyph)),
      el("span", "ep", String(pl.planet || "")),
      el("span", "es", [pl.sign, signGlyph(pl.sign)].filter(Boolean).join(" ")),
      el("span", "eo", String(pl.oneLiner || "")),
    );
    eph.append(row);
  });

  // today's brief — dated client-side
  $("today-date").textContent = dateLine(r.at);
  $("today-title").textContent = String(d.today?.title || "");
  $("today-body").textContent = String(d.today?.body || "");

  // do / don't
  fillList("do-list", d.power?.do);
  fillList("dont-list", d.power?.dont);

  // the pin
  $("pin-quote").textContent = String(d.pin || "");
}
function fillList(id, items) {
  const ul = $(id);
  ul.textContent = "";
  (Array.isArray(items) ? items : []).slice(0, 4).forEach((t) => ul.append(el("li", "", String(t))));
}

// ---------- boot ----------
const savedProfile = load(PROFILE_KEY);
if (savedProfile) fillForm(savedProfile);
syncTime();
const savedReading = load(READING_KEY);
if (savedReading?.data && savedReading?.profile) {
  reading = savedReading;           // returning souls land on their chart,
  renderReading(reading);           // one click from a new day's brief
  show("chart");
} else {
  show("intake");
}
reflect();
