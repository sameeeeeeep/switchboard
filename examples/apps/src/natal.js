// NATAL — your birth chart, read bluntly, on the visitor's OWN Claude through Switchboard.
// No tools, no server, no ephemeris: the model estimates positions from the birth data and
// delivers verdicts. Context-first and proactive: the moment Switchboard connects (fresh chip
// click OR page-load with an existing grant) NATAL pulls the personal context + identity,
// prefills the intake, and — when a complete birth profile exists — reads the sky with zero
// clicks. A returning soul whose calendar day changed gets today's brief automatically.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const PROFILE_KEY = "natal:profile";
const READING_KEY = "natal:reading";

let relay = null;
let notInstalled = false;
let busy = false;
let booted = false;     // onConnected runs once — chip onConnect and the probe can both land
let autoRan = false;    // maybeAutoRead fires one auto action per connect/context change
let reading = null;     // { profile, data, at }
let lastAction = null;  // what RETRY re-runs
let personal = null;    // derived from the lent personal context: { name, date, time, place }
let identityName = null;
let intakeHint = "";    // "add your birth date — everything else is filled."

// ---------- persistence ----------
// localStorage is the instant boot cache; relay.storage (the consented per-origin store) is the
// source of truth once connected. Values in relay.storage are strings — JSON round-trip.
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  if (relay) relay.storage.set(k, JSON.stringify(v)).catch(() => {});
};

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
// U+FE0E forces text presentation — sign/planet glyphs must print as ink, never as color emoji
// (macOS renders ♏♋♐ etc. as purple emoji badges otherwise, breaking the monochrome ephemeris).
const signGlyph = (s) => {
  const g = SIGN_GLYPHS[String(s || "").trim().toLowerCase()];
  return g ? g + "\ufe0e" : "";
};
const planetGlyph = (planet, offered) => {
  const g = PLANET_GLYPHS[String(planet || "").trim().toLowerCase()];
  return g ? g + "\ufe0e" : String(offered || "·").slice(0, 2);
};

const dateLine = (ts) =>
  new Date(ts).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).toUpperCase();

const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

// ---------- form ----------
// Dirty tracking: a field the user typed into this session is never overwritten by context prefill.
const dirty = { name: false, place: false, date: false, time: false };
[["f-name", "name"], ["f-place", "place"], ["f-date", "date"], ["f-time", "time"]].forEach(([id, k]) => {
  $(id).addEventListener("input", () => { dirty[k] = true; });
});
const anyDirty = () => dirty.name || dirty.place || dirty.date || dirty.time;

// No silent fallbacks: a missing date or place blocks with a visible sysline — nobody gets a
// stranger's chart. An empty name falls back to the connected identity, then "You".
function readForm() {
  const date = $("f-date").value;
  const time = $("f-time").value;
  const unknown = $("f-unknown").checked || !time;
  const place = $("f-place").value.trim();
  if (!date) {
    sys("a chart needs a date of birth.");
    show("intake");
    $("f-date").focus();
    return null;
  }
  if (!place) {
    sys("a chart needs a birthplace — the rising depends on it.");
    show("intake");
    $("f-place").focus();
    return null;
  }
  return {
    name: $("f-name").value.trim() || firstName(identityName) || "You",
    date,
    time: unknown ? "" : time,
    unknown,
    place,
  };
}
function fillForm(p, markDirty = false) {
  $("f-name").value = p.name || "";
  $("f-date").value = p.date || "";
  $("f-time").value = p.time || "";
  $("f-unknown").checked = !!p.unknown;
  $("f-place").value = p.place || "";
  if (markDirty) { dirty.name = dirty.place = dirty.date = dirty.time = true; }
  syncTime();
}
function syncTime() {
  const off = $("f-unknown").checked;
  $("f-time").disabled = off;
  $("time-note").hidden = !off;
}
$("f-unknown").addEventListener("change", () => { dirty.time = true; syncTime(); });

// Sample souls — the form is never blank and never needs your own data to explore.
const SOULS = [
  { label: "R. — Reykjavík, 04:44", name: "R.", date: "1988-03-21", time: "04:44", unknown: false, place: "Reykjavík, Iceland" },
  { label: "J. — New Orleans, 23:15", name: "J.", date: "2001-07-30", time: "23:15", unknown: false, place: "New Orleans, USA" },
  { label: "M. — Kyoto, time lost", name: "M.", date: "1972-12-09", time: "", unknown: true, place: "Kyoto, Japan" },
];
// The ★ recommended entry: once a name is known (personal context or identity), "your chart"
// leads the row; sample souls are the alternatives. Picking a sample marks the form dirty so a
// later context prefill can't clobber a deliberate choice.
function renderSouls() {
  const row = $("souls");
  row.textContent = "";
  const name = firstName(personal?.name || identityName);
  if (name) {
    $("souls-label").textContent = "Your chart, or a sample soul";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "soul star";
    b.textContent = `★ ${name} — your chart`;
    b.addEventListener("click", () => {
      fillForm({ name, date: personal?.date || "", time: personal?.time || "", unknown: !personal?.time, place: personal?.place || "" });
      // A complete profile has everything the sky needs, so picking it reads — one click, a chart.
      // Incomplete, it fills what's known and points at the one field still missing.
      if ($("f-date").value && $("f-place").value.trim()) { void doFullRead(); return; }
      ($("f-date").value ? $("f-place") : $("f-date")).focus();
    });
    row.append(b);
  } else {
    $("souls-label").textContent = "Or try a sample soul";
  }
  SOULS.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "soul";
    b.textContent = s.label;
    // Every sample soul is complete by construction — the whole point is exploring without your own
    // data, so the pick IS the request. Filling four fields and then hunting for "Read the sky" was
    // a two-step where one does.
    b.addEventListener("click", () => { fillForm(s, true); void doFullRead(); });
    row.append(b);
  });
}

// ---------- personal context ----------
// Only a personal-shaped context feeds the birth profile — deriving a person from a lent brand
// would prefill "Aamras" as a name. Identity remains the name fallback either way.
const isPersonalCtx = (c) =>
  !!c && (String(c.kind || "").toLowerCase() === "personal" ||
          (c.data && typeof c.data === "object" && typeof c.data.fullName === "string"));

function normTime(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  return String(Math.min(23, parseInt(m[1], 10))).padStart(2, "0") + ":" + m[2];
}

// Defensive normalization per docs/CONTEXT-KINDS.md kind "personal": every field optional, flat
// strings. Birth date/time are scavenged from explicit fields first, then the notes overflow.
function deriveProfile(ctx) {
  if (!isPersonalCtx(ctx)) return null;
  const data = ctx.data && typeof ctx.data === "object" ? ctx.data : {};
  const str = (v) => (typeof v === "string" ? v : "");
  const name = (str(data.fullName) || String(ctx.name || "")).trim() || null;
  const hay = [str(data.birthdate), str(data.dob), str(data.birthday), str(data.born), str(data.notes)].filter(Boolean).join("\n");
  const date = (hay.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || null;
  const time = normTime((hay.match(/born[^.\n]*?\b(\d{1,2}:\d{2})\b/i) || [])[1] || str(data.birthtime)) || null;
  let place = str(data.birthplace).trim();
  if (!place && str(data.address)) {
    // city token of the address: strip pincodes, keep the last locality segments
    const segs = data.address.split(",").map((s) => s.replace(/\d{4,}/g, "").trim()).filter(Boolean);
    if (segs.length) place = segs.slice(-2).join(", ");
  }
  return { name, date, time, place: place || null };
}

// Context-first: active() is whatever the user lent this app; when nothing personal is lent,
// auto-select the personal entry via list()+use(). GOTCHA: grants are exact-match — a reused
// grant ignores newly requested contextKinds, so every call tolerates null/throw and identity
// remains the name-only fallback.
async function loadPersonal() {
  personal = null;
  identityName = null;
  if (!relay) return;
  try { identityName = (await relay.identity())?.name?.trim() || null; } catch { identityName = null; }
  if (!relay.context || typeof relay.context.active !== "function") return;
  let ctx = null;
  try { ctx = await relay.context.active(); } catch { ctx = null; }
  if (!isPersonalCtx(ctx) && typeof relay.context.list === "function" && typeof relay.context.use === "function") {
    try {
      const metas = await relay.context.list();
      const m = (metas || []).find((x) => String(x.kind || "").toLowerCase() === "personal");
      if (m) ctx = (await relay.context.use(m.id)) || ctx;
    } catch { /* grant without the kind, or an older daemon — identity fallback still applies */ }
  }
  personal = deriveProfile(ctx);
}

// Prefill overwrites anything the user did NOT type this session (dirty fields are sacred) —
// so a context Switch via the chip re-prefills instead of leaving the form stale.
function prefillFromPersonal() {
  const name = firstName(personal?.name || identityName);
  if (!dirty.name && name) $("f-name").value = name;
  if (!dirty.place && personal?.place) $("f-place").value = personal.place;
  if (!dirty.date && personal?.date) $("f-date").value = personal.date;
  if (!dirty.time && personal?.time) { $("f-time").value = personal.time; $("f-unknown").checked = false; }
  syncTime();
}

// A profile complete enough to read with zero input: the saved one, else the context-derived one.
function completeProfile() {
  const saved = load(PROFILE_KEY);
  if (saved?.date && saved?.place) return saved;
  if (personal?.date && personal?.place) {
    return {
      name: firstName(personal.name || identityName) || "You",
      date: personal.date,
      time: personal.time || "",
      unknown: !personal.time,
      place: personal.place,
    };
  }
  return null;
}

// ---------- the standard connect chip ----------
mountConnect($("chip-dock"), {
  scope: { reason: "read your birth chart", models: ["sonnet"], contextKinds: ["personal"] },
  installUrl: INSTALL_URL,
  onConnect: (r) => onConnected(r),
  onDisconnect: () => { relay = null; booted = false; autoRan = false; reflect(); },
  // The chip's Switch menu (or the side panel) changed the lent context — re-derive, re-prefill,
  // and let the auto path run again so the page never sits stale.
  onProjectChange: async () => {
    if (!relay) return;
    await loadPersonal();
    prefillFromPersonal();
    renderSouls();
    autoRan = false;
    await maybeAutoRead();
  },
});
// Fast probe so a returning user's grant boots the page without a click. Funnels into the same
// onConnected as the chip; the `booted` guard makes the double-land harmless.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { onConnected(r); return; }
  } else {
    notInstalled = true;
  }
  reflect();
})();

// Both connect orders land here exactly once: context first, then the origin store — sequenced,
// never raced — then the proactive read.
async function onConnected(r) {
  relay = r;
  notInstalled = false;
  if (booted) { reflect(); return; }
  booted = true;
  reflect();
  await loadPersonal();
  prefillFromPersonal();
  renderSouls();
  await hydrateFromRelayStorage();
  reflect();
  await maybeAutoRead();
}

// The origin store outlives this browser profile; localStorage is just the boot cache. Hydrate
// whatever the cache is missing BEFORE maybeAutoRead decides between brief-refresh and full read.
async function hydrateFromRelayStorage() {
  if (!relay) return;
  if (!reading) {
    try {
      const raw = await relay.storage.get(READING_KEY);
      const r = raw ? JSON.parse(raw) : null;
      if (r?.data && r?.profile) {
        reading = r;
        try { localStorage.setItem(READING_KEY, JSON.stringify(r)); } catch {}
        renderReading(reading);
        show("chart");
      }
    } catch { /* unreadable store — the cache (or a fresh read) covers it */ }
  }
  if (!load(PROFILE_KEY)) {
    try {
      const raw = await relay.storage.get(PROFILE_KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (p?.date) {
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
        if (!reading && !anyDirty()) fillForm(p);
      }
    } catch { /* same */ }
  }
}

// THE proactive moment — fires from every connect path, guarded so chip + probe can't double-run:
//   (a) reading exists but the calendar day changed → refresh today's brief automatically;
//   (b) no reading but a complete profile is known  → read the sky, zero clicks;
//   (c) otherwise → intake stays, prefilled, pointing at the single missing field.
async function maybeAutoRead() {
  if (!relay || busy || autoRan) return;
  if (reading) {
    if (dateLine(reading.at) !== dateLine(Date.now())) {
      autoRan = true;
      await doBrief();
    }
    return;
  }
  const prof = completeProfile();
  if (prof) {
    autoRan = true;
    fillForm(prof);
    await doFullRead();
    return;
  }
  show("intake");
  const missDate = !$("f-date").value;
  const missPlace = !$("f-place").value.trim();
  if (missDate && missPlace) intakeHint = "add a birth date and place — the sky needs both.";
  else if (missDate) intakeHint = "add your birth date — everything else is filled.";
  else if (missPlace) intakeHint = "add your birthplace — everything else is filled.";
  if (missDate) $("f-date").focus();
  else if (missPlace) $("f-place").focus();
  reflect();
}

function reflect() {
  const on = !!relay && !busy;
  $("read").disabled = !on;
  $("rebrief").disabled = !on;
  $("reread").disabled = !on;
  $("sys-retry").disabled = busy;
  document.querySelectorAll("#cuts .cut").forEach((b) => { b.disabled = !on; });
  for (const id of ["conn-hint", "chart-hint"]) {
    const el = $(id);
    el.textContent = "";
    if (busy) el.textContent = "reading…";
    else if (relay) {
      el.textContent = id === "conn-hint" && intakeHint
        ? intakeHint
        : "runs on your Claude. nothing is sent anywhere else.";
    } else if (notInstalled) {
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
    p.unknown ? `The birth time is unknown, so the rising sign CANNOT be computed. Set "rising" to null. Do not guess it.` : `The birth time is known, so "rising" is REQUIRED — never null.`,
    `Today is ${dateLine(Date.now())}.`,
    VOICE,
    `Respond with ONLY one JSON object. No prose, no markdown fences, no backticks. Exactly this shape:`,
    `{"sun":{"sign":"Scorpio","gloss":"one blunt sentence"},"moon":{"sign":"...","gloss":"one blunt sentence"},"rising":${p.unknown ? "null" : `{"sign":"...","gloss":"one blunt sentence"}`},"placements":[{"planet":"Mercury","glyph":"☿","sign":"...","oneLiner":"one blunt sentence"}],"today":{"title":"three to six word headline","body":"2-4 sentences about today for this chart"},"power":{"do":["short imperative","short imperative","short imperative"],"dont":["short imperative","short imperative","short imperative"]},"pin":"one devastating one-liner about this person","cuts":[{"title":"Love","recommended":true},{"title":"Work","recommended":false},{"title":"The year ahead","recommended":false}]}`,
    `"placements" must contain 5 to 7 entries — Mercury, Venus, Mars, plus a few of Jupiter/Saturn/Uranus/Neptune/Pluto. Do not repeat sun, moon, or rising. "sign" values are capitalized sign names (Aries through Pisces). "glyph" is the planet's unicode glyph.`,
    `"cuts" names exactly 3 deeper-cut subjects tailored to this chart (choose from Love, Work, Money, The year ahead, The pattern you repeat) with exactly ONE "recommended": true — the one this chart most needs to hear.`,
  ].filter(Boolean).join("\n\n");
}

function chartLine(d) {
  return `Sun ${d.sun.sign}, Moon ${d.moon.sign}` +
    (d.rising ? `, Rising ${d.rising.sign}` : " (no rising — birth time unknown)");
}

function briefPrompt(p, d) {
  return [
    `You are NATAL, a natal-chart reader. Subject on file: ${p.name} — ${chartLine(d)}.`,
    `Today is ${dateLine(Date.now())}. Write today's brief for this chart.`,
    VOICE,
    `Respond with ONLY one JSON object. No prose, no markdown fences, no backticks. Exactly this shape:`,
    `{"today":{"title":"three to six word headline","body":"2-4 sentences about today"},"power":{"do":["short imperative","short imperative","short imperative"],"dont":["short imperative","short imperative","short imperative"]},"pin":"one devastating one-liner"}`,
  ].join("\n\n");
}

function cutPrompt(p, d, title, avoid) {
  return [
    `You are NATAL, a natal-chart reader. Subject on file: ${p.name} — ${chartLine(d)}.`,
    title
      ? `The cut: ${title}. Deliver the verdict on this subject's ${title.toLowerCase()} through this chart.`
      : `Choose ONE deeper-cut subject this chart most needs to hear${avoid?.length ? ` — anything but ${avoid.join(", ")}` : ""} — and deliver the verdict.`,
    VOICE,
    `Respond with ONLY one JSON object. No prose, no markdown fences, no backticks. Exactly this shape:`,
    `{"title":"${title || "the subject, two to four words"}","body":"2-3 blunt sentences"}`,
  ].join("\n\n");
}

// ---------- streaming ----------
// `line` keeps the caller's busy label on every delta; the 120s inactivity watchdog guarantees a
// hung stream surfaces as a visible error instead of a permanently locked page.
const STALL_MS = 120_000;
async function ask(prompt, line) {
  let acc = "";
  const iter = relay.stream({ prompt })[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer;
      const step = await Promise.race([
        iter.next(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("the sky went silent")), STALL_MS); }),
      ]).finally(() => clearTimeout(timer));
      if (step.done) break;
      const d = step.value;
      if (d.type === "text") {
        acc += d.text;
        $("prog-line").textContent = line + " · " + (acc.length / 1024).toFixed(1) + " KB";
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
  } catch (err) {
    try { void iter.return?.(); } catch { /* stream already dead */ }
    throw err;
  }
  const m = acc.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("the sky returned prose, not data");
  return JSON.parse(m[0]); // SyntaxError surfaces via the caller's catch → visible sysline + RETRY
}

// Rising honesty: a timed chart with no rising is an incomplete reading — retry, never lie.
function vetFull(d, profile) {
  if (!d?.sun?.sign || !d?.moon?.sign || !Array.isArray(d?.placements) || !d.placements.length ||
      !d?.today?.body || !Array.isArray(d?.power?.do) || !Array.isArray(d?.power?.dont) || !d?.pin) {
    throw new Error("incomplete reading");
  }
  if (!profile.unknown && !d?.rising?.sign) throw new Error("incomplete reading");
  if (profile.unknown) d.rising = null; // the prompt forbids it; enforce it anyway
  return d;
}
function vetBrief(d) {
  if (!d?.today?.body || !Array.isArray(d?.power?.do) || !Array.isArray(d?.power?.dont) || !d?.pin) {
    throw new Error("incomplete brief");
  }
  return d;
}
// Cuts tolerate absence entirely — the defaults keep the row alive, exactly one ★.
function normalizeCuts(raw) {
  let cuts = (Array.isArray(raw) ? raw : [])
    .filter((c) => c && typeof c.title === "string" && c.title.trim())
    .map((c) => ({ title: c.title.trim(), recommended: !!c.recommended, body: typeof c.body === "string" ? c.body : "" }));
  if (!cuts.length) {
    cuts = [
      { title: "Love", recommended: true, body: "" },
      { title: "Work", recommended: false, body: "" },
      { title: "The year ahead", recommended: false, body: "" },
    ];
  }
  const rec = cuts.findIndex((c) => c.recommended);
  cuts.forEach((c, i) => { c.recommended = i === (rec < 0 ? 0 : rec); });
  return cuts;
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
$("sys-retry").addEventListener("click", () => {
  if (!relay) { sys("connect Switchboard (top right) first."); return; }
  $("sysline").hidden = true;
  lastAction?.();
});

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
  if (!profile) return;
  setBusy(true, "READING THE SKY");
  try {
    const data = vetFull(await ask(fullPrompt(profile), "READING THE SKY"), profile);
    reading = { profile, data, at: Date.now() };
    intakeHint = "";
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
    const d = vetBrief(await ask(briefPrompt(reading.profile, reading.data), "NEW DAY, NEW BRIEF"));
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

// Deeper cuts — the "generate more" affordance: 3 subject chips (one ★) after the pin, each a
// short streamed verdict; "another cut" lets the chart choose an uncut subject itself.
async function doCut(title) {
  if (!relay) { sys("connect Switchboard (top right) first."); return; }
  if (busy || !reading) return;
  lastAction = () => doCut(title);
  const label = title ? "THE " + title.toUpperCase() + " CUT" : "ANOTHER CUT";
  setBusy(true, label);
  try {
    const delivered = normalizeCuts(reading.data.cuts).filter((c) => c.body).map((c) => c.title);
    const d = await ask(cutPrompt(reading.profile, reading.data, title, delivered), label);
    if (!d?.title || !d?.body) throw new Error("incomplete cut");
    const cuts = normalizeCuts(reading.data.cuts);
    const t = String(d.title).trim();
    const hit = cuts.find((c) => c.title.toLowerCase() === t.toLowerCase());
    if (hit) hit.body = String(d.body);
    else cuts.push({ title: t, recommended: false, body: String(d.body) });
    reading.data.cuts = cuts;
    save(READING_KEY, reading);
    renderCuts(reading);
    $("cut-secs").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      // The withheld gloss follows the PROFILE — "birth time unknown" can never render for a
      // timed chart (vetFull blocks new ones; old persisted data gets the honest line instead).
      el("div", "tgloss", c.body
        ? String(c.body.gloss || "")
        : (p.unknown
            ? "Birth time unknown. The rising sign is withheld, not guessed."
            : "The rising did not surface. Re-read the sky.")),
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

  // deeper cuts — options with one ★, delivered verdicts persisted and re-rendered
  renderCuts(r);
}
function fillList(id, items) {
  const ul = $(id);
  ul.textContent = "";
  (Array.isArray(items) ? items : []).slice(0, 4).forEach((t) => ul.append(el("li", "", String(t))));
}

function renderCuts(r) {
  const cuts = normalizeCuts(r.data.cuts);
  r.data.cuts = cuts;
  const row = $("cuts");
  row.textContent = "";
  const enabled = !!relay && !busy;
  cuts.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cut" + (c.recommended ? " rec" : "");
    b.textContent = (c.recommended ? "★ " : "") + c.title + (c.body ? " — again" : "");
    b.disabled = !enabled;
    b.addEventListener("click", () => doCut(c.title));
    row.append(b);
  });
  const more = document.createElement("button");
  more.type = "button";
  more.className = "cut more";
  more.textContent = "another cut ▸";
  more.disabled = !enabled;
  more.addEventListener("click", () => doCut(null));
  row.append(more);

  const secs = $("cut-secs");
  secs.textContent = "";
  cuts.filter((c) => c.body).forEach((c) => {
    const s = el("div", "cutsec");
    s.append(el("p", "ctitle", c.title), el("p", "cbody", c.body));
    secs.append(s);
  });
}

// ---------- boot ----------
renderSouls(); // first paint — samples only until a name is known
const savedProfile = load(PROFILE_KEY);
if (savedProfile) fillForm(savedProfile);
syncTime();
const savedReading = load(READING_KEY);
if (savedReading?.data && savedReading?.profile) {
  reading = savedReading;           // returning souls land on their chart instantly;
  renderReading(reading);           // maybeAutoRead() refreshes the brief if the day changed
  show("chart");
} else {
  show("intake");
}
reflect();
