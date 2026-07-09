// Cast's pipeline, as data — the equivalent of brandbrain's spec.ts. An Instagram account is not
// built in one shot; it's walked through GATED STAGES, and at every step the model proposes options
// and the human LOCKS one. A lock becomes context that conditions everything downstream. Nothing
// advances on its own. This file is the single source of truth for the whole flow: the stages, the
// facets inside Foundation, their dependencies, how many options to generate, and the exact brief
// each option card must satisfy. The renderers and the generator read from here; they hold no flow
// logic of their own.

// ---------- the option card (brandbrain's OptionCard, trimmed to what Cast renders) ----------
// A single generated choice. Renderers show only the fields that are present, so one component
// serves every facet — a persona card, a voice card, an aesthetic card all come out of this shape.
//   { id, title, subtitle?, body?, bullets?[], chips?[], palette?[{name,hex}], meta?[{label,value}],
//     recommended? }

// ---------- STAGES: the linear spine ----------
// Each stage is a gate. `advance` names the condition that unlocks the NEXT stage — the renderer
// asks stageReady(account, stageId) and refuses to move until it's true.
export const STAGES = [
  {
    id: "reference",
    title: "Start",
    kicker: "One thing to build from",
    blurb: "You gave Cast one thing — a line, a reference account, or a photo. This is the brief a research agent grounded from it; edit anything here and everything downstream is judged against it.",
    advance: "brief locked", // reference.locked === true
  },
  {
    id: "foundation",
    title: "Foundation",
    kicker: "Decide who this account is",
    blurb: "Every facet of the account — the person, their voice, the world they film in, who they're for, what they post — proposed as distinct directions. Cast locks the recommended one as options land; tap any other card to overrule it. Each lock sharpens the next. This is the persona's spec.",
    advance: "all facets locked",
  },
  {
    id: "assets",
    title: "Base assets",
    kicker: "Generate the persona's consistent world",
    blurb: "From the locked foundation, Cast generates the face, the setting, the wardrobe and the supporting cast — the reusable, on-model world every post is shot in. You approve each one; nothing is used until you say so.",
    advance: "face + setting approved",
  },
  {
    id: "calendar",
    title: "Calendar",
    kicker: "Plan what the account posts",
    blurb: "Research agents propose a dated content plan mapped to the account's pillars — what's trending, what fits the persona, spaced across weeks. You approve topics into the calendar; approved slots become the production queue.",
    advance: "≥1 slot approved",
  },
  {
    id: "scripts",
    title: "Scripts",
    kicker: "Write each post",
    blurb: "Every approved slot becomes a shot-list and voice lines, in the persona's voice, grounded in the topic. You approve or steer each script before a single frame is generated.",
    advance: "≥1 script approved",
  },
  {
    id: "produce",
    title: "Produce",
    kicker: "Shoot, stitch, approve",
    blurb: "Each approved script is generated shot by shot on the locked face and setting, then stitched into a reel with an on-device voice. You approve each shot, then the final cut — the last gate before it's a real post.",
    advance: "done",
  },
];
export const STAGE_IDS = STAGES.map((s) => s.id);
export const stageAt = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
export const stageIndex = (id) => Math.max(0, STAGE_IDS.indexOf(id));

// ---------- FOUNDATION FACETS: the task tree (brandbrain's TASKS) ----------
// Each facet generates `count` option cards; the founder locks one (or many). `deps` are the facet
// ids that must be locked first — the generator injects those locks into the prompt so every option
// is judged against what's already decided. `web` facets use a research/web pass; the rest generate
// from the locked context. `fields` is the exact brief for what each card must contain. Order here
// is the order they surface in the assembly board.
export const FACETS = [
  {
    id: "persona",
    title: "The person",
    blurb: "Who is behind the account — a real-feeling human, not a brand mascot.",
    icon: "user",
    select: "one",
    count: 3,
    web: false,
    deps: [],
    fields:
      "Propose distinct HUMAN creators who could credibly own this niche. Each card: title = a real first+last name; subtitle = their one-line identity (age-ish, where they are, what they did before); body = why this person is a sharp fit for the niche in one sentence; chips = 3 personality traits. Never name them after any brand. Make the three genuinely different people, not variations of one.",
    steer: "e.g. 'make them Mumbai-based, ex-engineer' — or write your exact person",
  },
  {
    id: "voice",
    title: "Voice",
    blurb: "How they talk on camera and in captions.",
    icon: "quote",
    select: "one",
    count: 3,
    web: false,
    deps: ["persona"],
    fields:
      "Propose distinct on-camera voices for this exact person. Each card: title = the voice in 2-3 words (e.g. 'Dry & deadpan'); body = one sentence on how they sound; bullets = 2 example caption openers written in that voice; chips = 3 tone words. The voices must plausibly belong to the locked person.",
    steer: "e.g. 'drier, faster, no emojis' — or describe your exact voice",
  },
  {
    id: "aesthetic",
    title: "Aesthetic",
    blurb: "The visual signature — grade, framing, palette.",
    icon: "image",
    select: "one",
    count: 3,
    web: false,
    deps: ["persona"],
    fields:
      "Propose distinct visual signatures the account is shot in. Each card: title = the look in 2-3 words; body = one sentence on grade + framing + light; palette = 3-4 named hex swatches that define the grade; chips = 2 texture/mood words. These are directable image-generation styles, so be concrete about colour and light.",
    steer: "e.g. 'shot on iPhone, warmer, no studio look'",
  },
  {
    id: "setting",
    title: "Setting",
    blurb: "The world the account lives in — where every shot is filmed.",
    icon: "map",
    select: "one",
    count: 3,
    web: false,
    deps: ["persona", "aesthetic"],
    fields:
      "Propose distinct home-base worlds this person films in, consistent with their identity and the locked aesthetic. Each card: title = the place in 2-3 words (e.g. 'Sunlit Lisbon flat'); body = one sentence describing the space and light; bullets = 3 recurring backdrops within it (kitchen counter, balcony, etc). Must be a plausible single lived-in world, not a mood board.",
    steer: "e.g. 'a small Bangalore flat, lots of plants' — or your real space",
  },
  {
    id: "audience",
    title: "Audience",
    blurb: "Who this is for — the follower it's built to win.",
    icon: "users",
    select: "one",
    count: 3,
    web: false,
    deps: ["persona", "voice"],
    fields:
      "Propose distinct core-follower profiles this account is built to win. Each card: title = the follower in a phrase; subtitle = a rough demographic; body = one sentence on what they come to the account FOR; chips = 2 things they'd double-tap. Pick the audience the locked person + voice would actually pull.",
    steer: "e.g. 'founders and PMs, not hobbyists'",
  },
  {
    id: "pillars",
    title: "Content pillars",
    blurb: "The 3-4 recurring themes the account posts against — the backbone of the calendar.",
    icon: "layers",
    select: "many",
    count: 5,
    web: true,
    deps: ["persona", "voice", "audience"],
    fields:
      "Propose recurring content pillars for this account — the repeatable themes it posts against. Use current web signal for what's landing in this niche. Each card: title = the pillar in 2-4 words; body = one sentence on what a post in this pillar looks like; chips = 2 example post ideas. Founder picks 3-4. These become the spine of the content calendar, so make them distinct and productive.",
    steer: "e.g. 'add a weekly myth-busting series' — or add your own pillar",
  },
];
export const FACET_IDS = FACETS.map((f) => f.id);
export const facetAt = (id) => FACETS.find((f) => f.id === id);

// ---------- BASE ASSETS: what Stage 3 generates from the locked foundation ----------
// Each asset is generated on the locked face/setting/aesthetic and then approved. `from` names the
// facet locks that condition its prompt; `gate` assets are required to advance out of the stage.
export const ASSETS = [
  { id: "face", title: "The face", one: true, gate: true, from: ["persona", "aesthetic"], seed: (f) => `photoreal front-facing portrait of ${f.persona}, ${f.aesthetic} look, natural light, consistent identity reference` },
  { id: "setting", title: "The setting", one: true, gate: true, from: ["setting", "aesthetic"], seed: (f) => `${f.setting}, ${f.aesthetic} grade, empty establishing shot, no people` },
  { id: "wardrobe", title: "Wardrobe", one: false, gate: false, from: ["persona", "aesthetic"], seed: (f) => `outfit for ${f.persona}, ${f.aesthetic} styling, flat-lay on-model reference` },
  { id: "cast", title: "Supporting cast", one: false, gate: false, from: ["persona", "setting"], seed: (f) => `portrait of a recurring supporting character in ${f.persona}'s world` },
];
export const assetAt = (id) => ASSETS.find((a) => a.id === id);

// ---------- prompt assembly: the coherence mechanism ----------
// Every generation re-sends the reference brief and all upstream locks, so an option can never drift
// from what's been decided — the same trick brandbrain uses in /api/studio. `decided` is the list of
// locked facets (id → chosen card summary) the generator threads in.
export function facetContext(account) {
  const ref = account.reference || {};
  const locks = account.foundation?.locks || {};
  const lines = [];
  const brand = brandLine(account);
  if (brand) lines.push(brand);
  if (ref.brief) lines.push(`The account's brief (the founder's starting intent): ${ref.brief}`);
  if (ref.fromPhoto && account.assets?.face?.url) lines.push("The founder supplied a real photo of the person — the face is already locked. Every persona option must plausibly BE the person in that photo; do not invent a different look.");
  if (ref.niche) lines.push(`Niche: ${ref.niche}.`);
  if (ref.inspirations?.length) lines.push(`Reference accounts the founder admires: ${ref.inspirations.map((i) => i.handle).filter(Boolean).join(", ")}.`);
  if (ref.moodNotes) lines.push(`Mood / direction notes: ${ref.moodNotes}`);
  const decided = FACET_IDS.map((id) => locks[id] && `- ${facetAt(id).title}: ${cardSummary(locks[id])}`).filter(Boolean);
  if (decided.length) {
    lines.push("", "Decisions locked so far — this is the source of truth; where the brief and a lock disagree, the LOCK wins:", ...decided);
  }
  return lines.join("\n");
}
// A one-line, prompt-friendly digest of a locked card.
export function cardSummary(card) {
  if (!card) return "";
  return [card.title, card.subtitle, card.body].filter(Boolean).join(" — ");
}
// The lent brand context, as a prompt line — THIS is what Switchboard is for: the persona is a
// creator who makes content FOR the founder's brand (a context they own), without being named after
// it. Every facet, asset, calendar topic and script is then judged against the brand.
export function brandLine(account) {
  const b = account.brand; if (!b) return "";
  const bits = [`The persona is an independent creator who makes content FOR the brand "${b.name}" (a context the founder lent from Switchboard) — a distinct real human, NEVER named after the brand.`];
  const d = b.data || {};
  if (d.positioning || d.tagline) bits.push(`Brand positioning: ${d.positioning || d.tagline}.`);
  if (d.niche || d.category) bits.push(`Brand category: ${d.niche || d.category}.`);
  if (Array.isArray(d.palette) && d.palette.length) bits.push(`Brand palette (use as accents): ${d.palette.join(", ")}.`);
  return bits.join(" ");
}
// Brand palette accents to fold into image prompts, if a brand is lent.
export function brandStyle(account) {
  const d = account.brand?.data || {};
  const pal = Array.isArray(d.palette) ? d.palette.slice(0, 3).join(", ") : "";
  return account.brand ? `in ${account.brand.name} brand style${pal ? `, palette accents ${pal}` : ""}` : "";
}
// Plain-language facet values used to seed asset prompts (face/setting/etc).
export function facetValues(account) {
  const locks = account.foundation?.locks || {};
  const v = {};
  for (const id of FACET_IDS) v[id] = cardSummary(locks[id]) || facetAt(id).title;
  return v;
}

// Build the instruction that asks the model for `count` option cards for one facet, grounded in all
// upstream locks. Returns a prompt whose ONLY output is a JSON array of option cards.
export function facetPrompt(account, facet) {
  const ctx = facetContext(account);
  const note = account.foundation?.steers?.[facet.id];
  const shape = `{"title","subtitle"?,"body"?,"bullets"?:[..],"chips"?:[..],"palette"?:[{"name","hex"}],"recommended"?:bool}`;
  return [
    ctx,
    "",
    `Now generate ${facet.count} DISTINCT options for the facet "${facet.title}". ${facet.fields}`,
    note ? `The founder's steering note for this facet — every option must honour it: "${note}"` : "",
    facet.web ? "Use WebSearch for current, real signal in this niche before answering." : "Answer from what's already decided — do not contradict a lock.",
    facet.select === "one" ? "Mark exactly one option as recommended." : "Do not mark any as recommended; the founder picks several.",
    `Reply with ONLY a JSON array of ${facet.count} objects shaped ${shape}. No prose.`,
  ].filter(Boolean).join("\n");
}
