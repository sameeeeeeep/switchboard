// A LIVE harness relay — the missing leg made runnable. The real extension path is
// browser → daemon → Higgsfield connector, which can't run headless in a preview. This relay stands
// in for that transport while driving Cast's REAL generation code (mock=false): gen.js still builds
// its agentic instructions and parses tool results exactly as it would live; the harness's stream()
// just resolves each request to a genuine Higgsfield asset (pre-generated via the same connector) and
// yields its URL as text, which gen.js's extractUrl/extractVideoUrl pick up unchanged. So this
// exercises the production render path end to end — the only thing swapped is who answers the call.
// Boot it with ?harness on persona.html. Every URL below is real Higgsfield output.
import { blankAccount, newId } from "./state.js";

// ---- the real asset pool (Higgsfield, kling3_0_turbo + soul_2, cooking-creator "Nadia") ----
const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3C7vRtLEK6Ytdo6wiVn6PQba1if/";
const FACE = CDN + "hf_20260708_165159_040b3e48-62f1-4481-8e94-ee91ed743221.png";
const SETTING = CDN + "hf_20260708_173637_363a131c-daa2-4039-8fd6-80dd16714e45.png";
const SHOTS = {
  hook: CDN + "hf_20260708_174101_5e63667b-e4a2-473b-95f6-988d7a1475f0.png",   // to camera
  chop: CDN + "hf_20260708_173653_ca278869-041c-4783-ad1c-5ea4b1c74251.png",   // chopping herbs
  pour: CDN + "hf_20260708_174104_0f849645-1a83-4183-97ea-1338846cb690.png",   // at the pan
  plate: CDN + "hf_20260708_174106_1c940c09-2a20-4fe8-842f-b5dccaca15da.png",  // finished dish
};
const REEL = "https://d8j0ntlcm91z4.cloudfront.net/user_3C7vRtLEK6Ytdo6wiVn6PQba1if/hf_20260708_165300_9c0cfd3d-1e57-4d03-832e-5ef03f716a1f.mp4";
// A real video→video output from Seedance 2.0 (image_references=face + video_references=reference
// reel) — exactly what the "drive from a reference reel" default (refDrive) returns live.
const REF_REEL = "https://d8j0ntlcm91z4.cloudfront.net/user_3C7vRtLEK6Ytdo6wiVn6PQba1if/hf_20260708_180511_8958cf14-c503-4e90-9a67-bd1b136b7cb4.mp4";

// Resolve one generation request to the right real asset by reading the instruction gen.js sent.
function resolve(prompt) {
  const p = (prompt || "").toLowerCase();
  // video → video: drive-from-reference (checked FIRST — its instruction also names generate_video)
  if (/reference-driven|video_references|reference reel|follows the energy|motion_control/.test(p)) return REF_REEL;
  // video / stitch → the animated reel
  if (/generate_video|animate this keyframe|stitch|concatenat/.test(p)) return REEL;
  // base assets
  if (/no people|establishing shot|empty/.test(p)) return SETTING;
  if (/front-facing|portrait of nadia|identity reference/.test(p) && !/chop|pour|plated/.test(p)) return FACE;
  // produce shots — match the beat description gen.js embeds in the prompt
  if (/chop|herbs/.test(p)) return SHOTS.chop;
  if (/pour|oil|pan|stove|sizzl/.test(p)) return SHOTS.pour;
  if (/plated|finished dish|holds up|holding up|proud|plate/.test(p)) return SHOTS.plate;
  if (/spoon|smil|gestur|hook|to camera/.test(p)) return SHOTS.hook;
  return SHOTS.hook;
}

// Canned JSON for the rare case the user walks BACK into an option-generating stage under the harness
// (facets / calendar / scripts). Keeps those stages functional without a live model.
function cannedArray(prompt) {
  const p = (prompt || "").toLowerCase();
  if (/pillar/.test(p)) return [{ title: "Genius kitchen tips", body: "A fast, surprising cooking hack per post.", chips: ["knife skills", "pantry swaps"] }, { title: "5-minute meals", body: "One quick recipe, start to plate.", chips: ["weeknight", "one-pan"] }, { title: "Myth vs. method", body: "Debunk a cooking myth on camera.", chips: ["salting pasta water", "resting meat"] }];
  if (/content plan|posts|calendar|trending/.test(p)) return [{ title: "3 genius cooking tips", body: "Rapid-fire kitchen hacks.", chips: ["Genius kitchen tips"], subtitle: "Trend", date: "2026-07-11" }, { title: "The pan-heat rule", body: "Why oil goes in AFTER the pan is hot.", chips: ["Myth vs. method"], subtitle: "Evergreen", date: "2026-07-15" }];
  if (/script|beats|shot.*line/.test(p)) return SEED_BEATS.map((b) => ({ title: b.shot, body: b.line }));
  // facet fallback (person/voice/etc)
  return [{ title: "Nadia Rossi", subtitle: "home cooking & kitchen tips", body: "Warm, practical home cook who makes weeknight food feel easy.", chips: ["warm", "practical", "quick"], recommended: true }];
}

// The lent brand context the demo composes the persona onto — proving the Switchboard point.
const BRAND = { id: "olio", name: "Olio", kind: "brand", data: { positioning: "small-batch cold-pressed olive oil for everyday cooking", category: "premium pantry / cooking", palette: ["#4C6B2F", "#C7A34A", "#F3ECD9"] } };

const SEED_BEATS = [
  { shot: "Smiling to camera in the kitchen, holding a wooden spoon", line: "Okay — three kitchen tips that genuinely changed how I cook." },
  { shot: "Close-up chopping fresh herbs on the board", line: "One: stack, roll, then chop. Twice as fast, no bruising." },
  { shot: "Pouring oil into a sizzling hot pan on the stove", line: "Two: heat the pan first, THEN a good glug of Olio. Nothing sticks." },
  { shot: "Holding up the finished plated dish, proud smile", line: "Three: finish with fresh herbs. Tag me if you try it!" },
];

// The seeded account, parked at Produce with everything upstream locked & approved.
function seedAccount() {
  const a = blankAccount();
  a.id = "cook"; a.handle = "Nadia Rossi"; a.stage = "produce"; a.brand = BRAND;
  a.reference = { brief: "a warm, practical home cook sharing genius kitchen tips", niche: "home cooking & kitchen tips", inspirations: [{ handle: "@dailyoriginalvids", note: "fast-cut cooking hacks" }], moodNotes: "bright, sunlit, fast and friendly", locked: true };
  const lock = (title, extra = {}) => ({ id: newId(), title, ...extra });
  a.foundation.locks = {
    persona: lock("Nadia Rossi", { subtitle: "home cooking & kitchen tips", body: "Ex-restaurant line cook who makes weeknight food feel easy." }),
    voice: lock("Warm & practical", { body: "Talks like a friend walking you through it, no fuss.", chips: ["warm", "clear", "quick"] }),
    aesthetic: lock("Sunlit kitchen film", { body: "Warm natural light, wooden textures, shallow depth.", palette: [{ name: "cream", hex: "#F4E9D8" }, { name: "sage", hex: "#8FA97E" }, { name: "oak", hex: "#B07E4B" }] }),
    setting: lock("Bright home kitchen", { body: "Sunny counters, linen curtains, herbs on the sill." }),
    audience: lock("Busy home cooks", { subtitle: "25-45", body: "Wants dinner sorted without the fuss." }),
    pillars: lock("Genius kitchen tips", { body: "A fast, surprising cooking hack per post." }),
  };
  a.foundation.more = { pillars: [lock("5-minute meals"), lock("Myth vs. method")] };
  a.assets.face = { url: FACE, status: "done", approved: true, name: "Nadia" };
  a.assets.setting = { url: SETTING, status: "done", approved: true, name: "Bright home kitchen" };
  a.calendar.slots = [{ id: "s1", date: "2026-07-11", pillar: "Genius kitchen tips", title: "3 genius cooking tips", angle: "Rapid-fire kitchen hacks, part one.", source: "Trend", approved: true, status: "planned" }];
  a.scripts = { s1: { beats: SEED_BEATS, approved: true, status: "written" } };
  a.productions = {};
  return a;
}

export function harnessRelay() {
  const store = new Map();
  const a = seedAccount();
  store.set("account:" + a.id, JSON.stringify(a));
  return {
    __harness: true,
    identity: async () => ({ name: "Sameep" }),
    capabilities: async () => ({ version: "0.1", methods: [], models: [], backends: ["higgsfield"], agentic: true, local: { tts: false } }),
    storage: {
      list: async () => [...store.keys()],
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
    },
    context: { active: async () => BRAND, publish: async (c) => (c.id || newId()), list: async () => [BRAND], pick: async () => BRAND },
    speak: async () => null,
    // The heart of the harness: answer gen.js's agentic request with a real asset URL. A short delay
    // mimics render latency so the UI's loading states are visible, exactly as they'd be live.
    stream: async function* ({ prompt }) {
      await new Promise((r) => setTimeout(r, 900));
      const url = /json array/i.test(prompt || "") ? JSON.stringify(cannedArray(prompt)) : resolve(prompt);
      yield { type: "text", text: url };
    },
  };
}
