/* ============================================================================
   AUTOPILOT — the decision engine.

   This is the part the mock was missing. Every visible thing on the cockpit is
   derived from DECISIONS. A decision holds its options, which one the machine
   drafted, and which one a HUMAN chose. Nothing else may write the chosen id.

   Doctrine, enforced structurally:
     - draft(d)   sets draftedId. It can never set chosenId.
     - choose(d)  is the ONLY path to chosenId, and only a click calls it.
     - changing an upstream decision marks dependents STALE and re-drafts them,
       so a voice change visibly rewrites the ad copy downstream.
     - every option a human passed on stays on the board, re-choosable forever.
   ========================================================================= */

const LS = "autopilot:v1";

/* ---------- helpers ---------- */
const uid = (p) => p + "_" + Math.abs(hash(p + Object.keys(ST.co || {}).length + Date.now() % 1e6)).toString(36);
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
const fmtTok = (n) => n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
const now = () => new Date().toTimeString().slice(0, 8);

/* ---------- the decision primitive ---------- */
function decision(id, label, axis, options, deps) {
  return { id, label, axis, options: options.slice(), deps: deps || [],
           draftedId: null, chosenId: null, chosenAt: null, stale: false };
}
/** machine drafts — NEVER touches chosenId. */
function draft(d) {
  const rec = d.options.find((o) => o.rec) || d.options[0];
  d.draftedId = rec ? rec.id : null;
  d.stale = false;
  return d;
}
/** the ONLY route to the accent state. Wired to a click and nothing else. */
function choose(co, d, optId) {
  d.chosenId = optId;
  d.chosenAt = now();
  d.stale = false;
  spend(co, 1200 + Math.floor(Math.abs(hash(optId)) % 900), "decide");
  rippleFrom(co, d.id);
  save();
}
function unchoose(co, d) { d.chosenId = null; d.chosenAt = null; rippleFrom(co, d.id); save(); }
/** the escape hatch creates a REAL option, indistinguishable downstream. */
function ownOption(co, d, text) {
  const o = { id: uid("own"), label: text.slice(0, 60), text: "", own: true };
  d.options.push(o);
  choose(co, d, o.id);
  logLine(co, "you wrote your own " + d.label.toLowerCase(), "done", d.id);
  return o;
}
const optOf = (d) => d.options.find((o) => o.id === d.chosenId) || null;
const shownOf = (d) => optOf(d) || d.options.find((o) => o.id === d.draftedId) || d.options[0];
const isChosen = (d, o) => d.chosenId === o.id;
const isDrafted = (d, o) => !d.chosenId && d.draftedId === o.id;

/** upstream changed → dependents go stale and re-draft. This is what makes it
    feel connected rather than a set of unrelated cards. */
function rippleFrom(co, changedId) {
  let touched = 0;
  for (const d of Object.values(co.decisions)) {
    if (!d.deps.includes(changedId)) continue;
    d.options = buildOptions(co, d.id);
    draft(d);
    d.stale = true;   // AFTER draft() — draft clears the flag, so order matters
    if (d.chosenId && !d.options.some((o) => o.id === d.chosenId)) d.chosenId = null;
    touched++;
    touched += rippleFrom(co, d.id);
  }
  if (touched) logLine(co, "restreamed " + touched + " downstream of " + changedId, "run", changedId);
  return touched;
}

/* ---------- tokens: the one number we can show honestly ---------- */
function spend(co, n, area) {
  co.tokens.spent += n;
  co.tokens.by[area] = (co.tokens.by[area] || 0) + n;
}
function logLine(co, text, state, target) {
  co.log.unshift({ t: text, s: state, target, at: now() });
  co.log = co.log.slice(0, 14);
}

/* ============================================================================
   CONTENT — two companies of DIFFERENT kinds, to prove the shape generalises.
   The company layer (name/voice/identity) is shared machinery; only the
   operations and growth artifacts differ by kind.
   ========================================================================= */

const VOICE_SETS = {
  d2c: [
    { id: "v-coach", rec: true, label: "Warm coach",
      text: "Trail-buddy warmth — earns the moment with you, never shames the shortcut.",
      lines: ["Tear it, pour it, look up. The view's better with real coffee in your hands.",
              "You carried it all the way up here — take the extra minute. This one's yours.",
              "A shortcut isn't a compromise. It's how you get another hour of trail."],
      ad: { head: "Real coffee. No kettle.", body: "You're 40 minutes past the trailhead. There's no cafe up here — there's this. Tear, pour, look up.", cta: "Shop Firstlight" } },
    { id: "v-clinical", label: "Dry & clinical",
      text: "Spec-sheet minimalism — precise, product-first, no adjective it can't measure.",
      lines: ["Single origin. Freeze-dried at altitude. Full cup in 90 seconds, no kettle in the equation.",
              "One sachet, 200ml, complete extraction — lighter than your spare socks.",
              "Cold-soluble to 4°C. Same extraction, no heat required."],
      ad: { head: "90 seconds. No kettle.", body: "Single origin, freeze-dried at altitude. 3.5g sachet, complete extraction in cold or hot water.", cta: "See the spec" } },
    { id: "v-deadpan", label: "Deadpan",
      text: "Flat, funny, anti-hype — undersells on purpose and trusts you to get the joke.",
      lines: ["It's instant coffee. It's also good. We were surprised too.",
              "No kettle, no grinder, no excuse for bad decisions before sunrise.",
              "Tastes like you tried. You didn't."],
      ad: { head: "It's instant. It's also good.", body: "We were as surprised as you'll be. Single origin, in a sachet that survives a backpack.", cta: "Try it anyway" } },
  ],
  saas: [
    { id: "v-peer", rec: true, label: "Straight-talking peer",
      text: "Talks to owners like an operator who's done the job — no vendor gloss.",
      lines: ["Your reviews don't answer themselves. Now they nearly do.",
              "Every reply sounds like you, because it's built from how you already write.",
              "Nothing sends without you reading it first."],
      ad: { head: "Reply to every review, faster.", body: "Turns a week of reviews into on-brand, ready-to-paste drafts. You approve; nothing auto-sends.", cta: "Draft my replies" } },
    { id: "v-clinic", label: "Compliance-first",
      text: "Careful and precise — leads with the risk it removes, never overpromises.",
      lines: ["Drafts written to avoid confirming any patient relationship.",
              "Every reply is reviewed by you before it leaves.",
              "Built for regulated categories, not general retail."],
      ad: { head: "HIPAA-careful review replies.", body: "Drafts that never confirm a patient relationship. You review every one before it posts.", cta: "See a sample reply" } },
    { id: "v-warm", label: "Warm concierge",
      text: "Friendly and reassuring — positions the tool as relief, not software.",
      lines: ["Reviews piling up? Take the evening off.",
              "We'll draft. You'll skim. Done before your coffee's cold.",
              "It sounds like you because it learned from you."],
      ad: { head: "Take the evening off.", body: "Your reviews get on-brand drafts while you're closed. Skim, approve, done.", cta: "Start free" } },
  ],
};

function buildOptions(co, id) {
  if (id === "voice") return VOICE_SETS[co.kind];
  if (id === "ad") {
    // The visible ripple: the recommended AD follows the voice the human actually
    // chose. Keying `rec` off each voice's own flag (the first bug here) meant the
    // coach angle was always recommended no matter what you picked, so choosing a
    // voice changed nothing downstream and the graph looked fake.
    const v0 = optOf(co.decisions.voice) || shownOf(co.decisions.voice);
    return VOICE_SETS[co.kind].map((v) => ({
      id: "ad-" + v.id, rec: v.id === (v0 && v0.id), label: v.label + " angle",
      text: v.ad.head, ad: v.ad,
    }));
  }
  if (id === "next") return co.kind === "d2c" ? [
    { id: "n-lastlight", rec: true, label: "NEW DAYPART", text: "Firstlight Lastlight — $21 / 12 sachets",
      body: "The sun's going and nobody wants to move. Tear it, pour it, stay out a little longer." },
    { id: "n-coldsnap", label: "NEW FORMAT", text: "Firstlight Coldsnap — $22 / 12 sachets",
      body: "Cold water, cold hands, still real coffee — shake it in the bottle you're already carrying." },
    { id: "n-highcamp", label: "NEW ORIGIN", text: "Firstlight High Camp — $34, capped run",
      body: "One farm, one harvest, one run of tins. When it's gone, we go find the next ridge." },
  ] : [
    { id: "n-tiers", rec: true, label: "NEW PLAN", text: "Team tier — $79/mo, 5 seats",
      body: "Multi-location owners are the ones replying most. Give them seats and shared voice settings." },
    { id: "n-widget", label: "NEW SURFACE", text: "On-site review widget",
      body: "Collect reviews where the visit ends, not days later by email." },
    { id: "n-api", label: "NEW CHANNEL", text: "Booking-platform integration",
      body: "Meet reviews where they land instead of asking owners to paste them in." },
  ];
  return [];
}

function makeCompany(cfg) {
  const co = Object.assign({ tokens: { spent: 0, budget: 2_000_000, by: {} } }, cfg);
  co.log = [];   // MUST come after the assign — cfg.log is the seed array, and letting it
                 // through leaves raw arrays mixed with log objects (renders as blank rows)
  co.decisions = {
    voice: decision("voice", "Voice", "WHAT THE BRAND'S RELATIONSHIP TO YOU IS", VOICE_SETS[co.kind], []),
    ad:    decision("ad", "Ad angle", "WHAT THE AD IS ACTUALLY ABOUT", [], ["voice"]),
    next:  decision("next", "Next move", co.kind === "d2c" ? "WHAT WIDENS — OCCASION, FORMAT, OR ORIGIN" : "WHERE THE NEXT REVENUE COMES FROM", [], []),
  };
  co.decisions.ad.options = buildOptions(co, "ad");
  co.decisions.next.options = buildOptions(co, "next");
  Object.values(co.decisions).forEach(draft);
  spend(co, cfg.seedTokens || 240000, "found");
  cfg.log.forEach((l) => logLine(co, l[0], l[1], l[2]));
  return co;
}

const SEED = {
  firstlight: {
    id: "firstlight", name: "Firstlight", kind: "d2c", kindLabel: "D2C BRAND",
    glyph: "F", color: "#2f6b45", ink: "#d8f5e4",
    doing: "Sourcing the second run",
    blurb: "Specialty-grade single-origin instant coffee for people who camp, hike and live out of a van.",
    site: "firstlight.co", price: "$28 · 40g tin", seedTokens: 380000,
    stat: [["Products live", "2"], ["Range", "Trail"]],
    tasks: [
      { id: "t1", n: "Source the Lastlight run", s: "run", m: "84k tokens · 2m ago", d: "Comparing 3 co-packers for the cacao + decaf spec. Verdant quoted 21d lead.", doc: "d3" },
      { id: "t2", n: "Ad set 01 — staged", s: "pend", m: "needs you", d: "3 creatives built on the locked palette and voice. Waiting on your go.", doc: "d2" },
      { id: "t3", n: "Outreach to 32 outfitters", s: "pend", m: "needs you", d: "Drafted in your voice. Nothing has been sent.", doc: "d1" },
    ],
    docs: [["d1", "Brand Book", "ARTIFACT"], ["d2", "Ad Set 01", "ARTIFACT"], ["d3", "Supplier Brief", "ARTIFACT"], ["d4", "Range Plan", "ARTIFACT"]],
    log: [["Brand, name & voice drafted", "done", "voice"], ["Storefront built & published", "done", "storefront"],
          ["Payments connected", "done", "storefront"], ["Ad set rendered on the locked palette", "done", "ad"],
          ["Comparing co-packer quotes", "run", "next"]],
  },
  replydex: {
    id: "replydex", name: "Replydex", kind: "saas", kindLabel: "SOFTWARE",
    glyph: "R", color: "#2b4a7a", ink: "#dbe8ff",
    doing: "Writing this week's reply drafts",
    blurb: "Turns a med-spa's Google reviews into on-brand, HIPAA-careful reply drafts — ready to paste.",
    site: "replydex.app", price: "$39 · reply pack", seedTokens: 210000,
    stat: [["Accounts", "0"], ["Plan", "Reply pack"]],
    tasks: [
      { id: "t1", n: "Draft this week's 41 replies", s: "run", m: "126k tokens · running", d: "Reading new reviews and drafting each in the locked voice. Nothing posts.", doc: "d2" },
      { id: "t2", n: "Landing page tighten", s: "pend", m: "needs you", d: "Sharpened CTA and the $39 value at each decision point. Staged, not live.", doc: "d1" },
      { id: "t3", n: "Outreach to 40 med-spas", s: "pend", m: "needs you", d: "Personalised from real published addresses only — no scraped contact forms.", doc: "d3" },
    ],
    docs: [["d1", "Positioning Doc", "ARTIFACT"], ["d2", "Reply Style Guide", "ARTIFACT"], ["d3", "Outreach List", "ARTIFACT"], ["d4", "Pricing Rationale", "ARTIFACT"]],
    log: [["Product thesis & voice drafted", "done", "voice"], ["Landing page shipped", "done", "storefront"],
          ["Stripe connected", "done", "storefront"], ["Ad angles written", "done", "ad"],
          ["Drafting 41 replies", "run", "next"]],
  },
};

/* ---------- global state + persistence ---------- */
let ST = { active: "firstlight", co: {} };
function save() { try { localStorage.setItem(LS, JSON.stringify(serialise())); } catch (e) {} }
function serialise() {
  const out = { active: ST.active, co: {} };
  for (const [k, c] of Object.entries(ST.co)) {
    out.co[k] = { tokens: c.tokens, log: c.log, d: {} };
    for (const [id, d] of Object.entries(c.decisions))
      out.co[k].d[id] = { chosenId: d.chosenId, chosenAt: d.chosenAt,
                          own: d.options.filter((o) => o.own) };
  }
  return out;
}
function boot() {
  ST = { active: "firstlight", co: {} };
  for (const [k, cfg] of Object.entries(SEED)) ST.co[k] = makeCompany(cfg);
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || "null");
    if (raw && raw.co) {
      ST.active = raw.active || ST.active;
      for (const [k, saved] of Object.entries(raw.co)) {
        const c = ST.co[k]; if (!c) continue;
        if (saved.tokens) c.tokens = saved.tokens;
        if (saved.log && saved.log.length) c.log = saved.log;
        for (const [id, sd] of Object.entries(saved.d || {})) {
          const d = c.decisions[id]; if (!d) continue;
          (sd.own || []).forEach((o) => { if (!d.options.some((x) => x.id === o.id)) d.options.push(o); });
          if (sd.chosenId && d.options.some((o) => o.id === sd.chosenId)) {
            d.chosenId = sd.chosenId; d.chosenAt = sd.chosenAt;
          }
        }
      }
      // rebuild dependents so a restored voice choice still drives the ad
      for (const c of Object.values(ST.co)) rippleFrom(c, "voice");
      for (const c of Object.values(ST.co))
        for (const [id, sd] of Object.entries((raw.co[c.id] || {}).d || {}))
          if (sd.chosenId && c.decisions[id] && c.decisions[id].options.some((o) => o.id === sd.chosenId))
            { c.decisions[id].chosenId = sd.chosenId; c.decisions[id].chosenAt = sd.chosenAt; }
    }
  } catch (e) {}
}
const CO = () => ST.co[ST.active];
function resetAll() { try { localStorage.removeItem(LS); } catch (e) {} boot(); }
