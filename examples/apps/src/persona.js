// Cast — an AI-persona studio (Spira-inspired). A persona is a small, CONSISTENT world: a locked
// face, a wardrobe, locations, and a supporting cast — reused across every piece of content. Cast
// holds no model and no data of its own: personas live in the user's own claude_storage (Cast's
// private DB) and each is published as a shareable CONTEXT; a brand is the ONE context the user
// lends via Switchboard; rendering + research run on the user's Claude + Higgsfield. BYO everything.
//
// Without Switchboard installed it boots a self-contained DEMO (seeded personas, canned renders) so
// the whole studio is explorable — then the exact same code runs for real once connected.
import { mountConnect, whenRelayReady } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const CONNECTOR = "mcp__claude_ai_Higgsfield__*";
const GEN = "generate_image";
const newId = () => "p_" + Math.random().toString(36).slice(2, 9);

const state = { relay: null, mock: false, caps: null, personas: [], current: null, brand: null, pick: { wardrobe: null, location: null, cast: new Set() }, tab: "build" };

// ---------- connect ----------
mountConnect($("sbchip"), {
  scope: { reason: "Cast — build AI personas and produce on-model content", tools: [CONNECTOR, "WebSearch", "WebFetch"] },
  onConnect: (r) => boot(r, false),
  onDisconnect: () => { /* keep the studio up; a reconnect re-boots */ },
  onProjectChange: () => loadBrand(),
});
// Fallback: if Switchboard isn't installed, boot the demo so the studio is still explorable.
whenRelayReady(1800).then((r) => { if (!("connect" in r) && !state.relay) boot(mockRelay(), true); });

async function boot(relay, mock) {
  state.relay = relay; state.mock = mock;
  state.caps = await (relay.capabilities ? relay.capabilities().catch(() => null) : null);
  ($("hero")).hidden = true; ($("app")).hidden = false;
  renderChips("ideaChips", IDEA_CHIPS, (v) => { $("ideaInput").value = v; suggestPersonas(v); });
  await loadBrand();
  await loadPersonas();
  if (!state.personas.length) newPersona();
  else selectPersona(state.personas[0].id);
}

// ---------- persona DB (claude_storage) ----------
async function loadPersonas() {
  try {
    const keys = (await state.relay.storage.list()).filter((k) => k.startsWith("persona:"));
    const raw = await Promise.all(keys.map((k) => state.relay.storage.get(k)));
    state.personas = raw.map(safeParse).filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { state.personas = []; }
  renderRail();
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function blankPersona() {
  return { id: newId(), name: "", niche: "", vibe: "", story: "", look: { referenceImage: null }, wardrobe: [], locations: [], cast: [], updatedAt: Date.now() };
}
function newPersona() { state.current = blankPersona(); state.pick = { wardrobe: null, location: null, cast: new Set() }; renderRail(); renderBuild(); setTab("build"); $("pname").focus(); }

function selectPersona(id) {
  const p = state.personas.find((x) => x.id === id); if (!p) return;
  state.current = JSON.parse(JSON.stringify(p)); // work on a copy; Save writes it back
  state.pick = { wardrobe: null, location: null, cast: new Set() };
  resetReel();
  renderRail(); renderBuild(); renderStudio(); renderPlan();
}

async function duplicatePersona(id, ev) {
  ev?.stopPropagation();
  const p = state.personas.find((x) => x.id === id); if (!p) return;
  const copy = JSON.parse(JSON.stringify(p));
  copy.id = newId(); copy.name = (p.name || "Persona") + " copy"; copy.updatedAt = Date.now();
  await persist(copy);
  await loadPersonas(); selectPersona(copy.id);
}

async function persist(p) {
  p.updatedAt = Date.now();
  try {
    await state.relay.storage.set("persona:" + p.id, JSON.stringify(p));
    // Publish a shareable snapshot so OTHER wrapps (UGC, ads, shorts) can run on this persona.
    await state.relay.context.publish({ id: p.id, name: p.name || "Untitled persona", kind: "persona", data: p });
  } catch { /* offline/mock — storage mock still holds it */ }
}

// ---------- Build tab ----------
function renderRail() {
  const box = $("plist"); box.textContent = "";
  if (!state.personas.length && !state.current?.name) { box.append(el("div", "empty", "No personas yet. Create your first →")); return; }
  const rows = [...state.personas];
  if (state.current && !rows.find((p) => p.id === state.current.id)) rows.unshift(state.current); // unsaved current
  for (const p of rows) {
    const row = el("div", "prow" + (state.current && p.id === state.current.id ? " on" : ""));
    const face = p.look?.referenceImage ? Object.assign(el("img", "face"), { src: p.look.referenceImage }) : el("div", "face", (p.name || "?")[0].toUpperCase());
    const txt = el("div"); txt.style.minWidth = "0"; txt.append(el("div", "nm", p.name || "Untitled"), el("div", "ni", p.niche || "no niche yet"));
    row.append(face, txt);
    const dup = el("button", "dup", "⧉"); dup.title = "Duplicate"; dup.onclick = (e) => duplicatePersona(p.id, e); row.append(dup);
    row.onclick = () => selectPersona(p.id);
    box.append(row);
  }
}

function renderBuild() {
  const p = state.current; if (!p) return;
  $("pname").value = p.name || ""; $("pniche").value = p.niche || ""; $("pvibe").value = p.vibe || ""; $("pstory").value = p.story || "";
  paintFace();
  for (const kind of ["wardrobe", "locations", "cast"]) renderTiles(kind);
}
function paintFace() {
  const well = $("facewell"); well.textContent = "";
  const ref = state.current?.look?.referenceImage;
  if (ref) well.append(Object.assign(el("img"), { src: ref, alt: "face" }));
  else well.append(el("span", "ph", "＋"));
}
function openFacePicker() {
  const p = state.current;
  pickImage({
    title: "Persona face",
    promptSeed: `portrait of ${p.name || "a new persona"}, ${p.niche || "lifestyle"} creator${p.vibe ? ", " + p.vibe : ""}, front-facing, natural light, photoreal`,
    onResult: (url) => { state.current.look.referenceImage = url; paintFace(); renderRail(); },
  });
}
$("facewell").addEventListener("click", openFacePicker);
$("faceGen").addEventListener("click", openFacePicker);
$("faceUpload").addEventListener("click", () => $("faceInput").click());
$("faceInput").addEventListener("change", () => readImage($("faceInput"), (url) => { state.current.look.referenceImage = url; paintFace(); renderRail(); }));

// ---- Steer: the brandbrain "never a blank box" pattern, everywhere ----
// Every input is AI-first: describe intent (or click a ready-made chip) → Cast generates it from
// your brand + context. Text OR images. You steer and regenerate; you never face an empty form.
const IDEA_CHIPS = ["a Gen-Z skincare creator in Lisbon", "a streetwear sneakerhead in Seoul", "a cozy home-cook mum", "a no-BS fitness coach", "a minimalist home & interiors creator"];
function renderChips(id, items, onPick) {
  const box = $(id); if (!box) return; box.textContent = "";
  for (const label of items) { const c = el("button", "chip"); c.append(Object.assign(el("span", "s"), { textContent: "✨" }), document.createTextNode(label)); c.onclick = () => onPick(label); box.append(c); }
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

$("ideaGo").addEventListener("click", () => suggestPersonas($("ideaInput").value.trim()));
$("ideaInput").addEventListener("keydown", (e) => { if (e.key === "Enter") suggestPersonas($("ideaInput").value.trim()); });
$("regenIdentity").addEventListener("click", () => {
  const p = state.current; const seed = [p.name && p.name, p.niche, p.vibe].filter(Boolean).join(", ") || $("ideaInput").value.trim() || (state.brand ? `a creator for ${state.brand.name}` : "a creator");
  suggestPersonas(seed);
});

// Generate OPTIONS with a recommended path — brandbrain's model: you're never handed one answer,
// you're shown distinct directions (one recommended) and you choose. Not a blank form, not a
// take-it-or-leave-it single fill.
async function suggestPersonas(idea) {
  if (!idea) { $("ideaInput").focus(); return; }
  const go = $("ideaGo"); go.disabled = true; const t = go.textContent; go.textContent = "Thinking…";
  $("ideaOptions").textContent = "";
  try {
    const options = state.mock ? mockPersonaOptions(idea) : await livePersonaOptions(idea);
    renderPersonaOptions(options);
  } catch { $("ideaOptions").append(el("div", "empty-note", "Couldn't propose directions — try again.")); }
  go.disabled = false; go.textContent = t;
}
function renderPersonaOptions(options) {
  const box = $("ideaOptions"); box.textContent = "";
  if (!options.length) return;
  for (const o of options) {
    const card = el("button", "opt" + (o.recommended ? " rec" : ""));
    if (o.recommended) card.append(el("span", "rb", "RECOMMENDED"));
    card.append(el("div", "nm", o.name), el("div", "ni", o.niche));
    if (o.angle) card.append(el("div", "an", o.angle));
    card.append(el("div", "use", "Use this →"));
    card.onclick = () => usePersonaOption(o);
    box.append(card);
  }
}
function usePersonaOption(o) {
  const p = state.current || (state.current = blankPersona());
  Object.assign(p, { name: o.name, niche: o.niche, vibe: o.vibe, story: o.story });
  $("ideaOptions").textContent = "";
  renderBuild(); renderRail();
}
async function livePersonaOptions(idea) {
  // The persona is a SEPARATE human who creates FOR the brand — never named after it.
  const brand = state.brand ? ` The persona creates content for the brand "${state.brand.name}", but is a distinct, real-feeling human with their OWN name — do NOT name them after the brand, and do not reuse the brand name anywhere in "name".` : "";
  const prompt = `Propose 3 DISTINCT creator-persona directions for this idea: "${idea}".${brand} Mark exactly one as the recommended path. Reply with ONLY a JSON array of {"name","niche","vibe","story","angle","recommended"}: "name" is a human first+last name, "vibe" the voice in one line, "angle" the one-line creative direction, "recommended" a boolean.`;
  let acc = ""; for await (const d of state.relay.stream({ prompt, agentic: true })) { if (d.type === "text") acc += d.text; else if (d.type === "error") throw new Error(d.error.message); }
  const m = acc.match(/\[[\s\S]*\]/); const arr = m ? JSON.parse(m[0]) : [];
  const brandName = (state.brand?.name || "").toLowerCase();
  const clean = arr.filter((o) => o?.name).map((o) => ({ ...o, name: o.name })).filter((o) => !brandName || o.name.toLowerCase() !== brandName);
  if (clean.length && !clean.some((o) => o.recommended)) clean[0].recommended = true;
  return clean;
}
function deriveNiche(idea) {
  const i = idea.toLowerCase();
  return /skin|serum|beauty/.test(i) ? "sustainable skincare" : /sneaker|street|hype/.test(i) ? "streetwear & sneakers" : /cook|food|recipe|kitchen/.test(i) ? "home cooking" : /fit|gym|coach|mobility/.test(i) ? "fitness & mobility" : /home|interior|decor/.test(i) ? "home & interiors" : idea.split(/\s+/).slice(-2).join(" ");
}
// Names are always human and NEVER the brand — that was the leak.
function mockPersonaOptions(idea) {
  const niche = deriveNiche(idea);
  const brand = state.brand?.name;
  const forBrand = brand ? ` Creates for ${brand}.` : "";
  const pool = ["Maya Chen", "Rae Okafor", "Noa Sato", "Leo Park", "Sana Rao", "Theo Blum"].filter((n) => !brand || n.toLowerCase() !== brand.toLowerCase());
  const dirs = [
    { angle: "The trusted explainer — plain, label-reading, no hype.", vibe: "warm, plain-spoken, a little witty", recommended: true },
    { angle: "The bold contrarian — myth-busting, opinionated, fast cuts.", vibe: "sharp, confident, funny" },
    { angle: "The soft-life aesthete — calm routines, mood-first, ASMR.", vibe: "gentle, aspirational, unhurried" },
  ];
  return dirs.map((d, i) => ({ name: pool[i], niche, angle: d.angle, vibe: d.vibe, recommended: !!d.recommended, story: `${d.angle}${forBrand}` }));
}
function sceneSuggestions() { return ["morning shelfie, natural light", "unboxing on a marble counter", "get-ready-with-me mirror selfie", "close-up applying the product", "candid, mid-laugh, direct to camera"]; }
function reelSuggestions(p) { return ["a calm 4-step morning routine", "reacting to a trending ingredient", `3 myths about ${p?.niche || "this niche"}`, "a day-in-the-life", "answering the most-asked DM"]; }

function renderTiles(kind) {
  const box = $("tiles-" + kind); box.textContent = "";
  for (const a of state.current[kind]) {
    const tile = el("div", "tile");
    tile.append(Object.assign(el("img", "img"), { src: a.referenceImage, alt: a.name }));
    const lb = el("div", "lb", a.name); if (a.relationship) lb.append(el("span", "sub", " · " + a.relationship)); tile.append(lb);
    const x = el("button", "x", "×"); x.onclick = () => { state.current[kind] = state.current[kind].filter((y) => y.id !== a.id); renderTiles(kind); renderStudio(); }; tile.append(x);
    box.append(tile);
  }
  const add = el("div", "tile empty", "✨ Generate"); add.onclick = () => addAsset(kind); box.append(add);
}
// Add an asset the generate-first way: describe it → Cast generates the reference (or upload).
function addAsset(kind) {
  const p = state.current;
  const seed = { wardrobe: `outfit for ${p.name || "the persona"}: `, locations: `location / setting: `, cast: `portrait of a supporting character for ${p.name || "the persona"}: ` }[kind];
  const title = { wardrobe: "Add outfit", locations: "Add location", cast: "Add character" }[kind];
  pickImage({
    title, promptSeed: seed,
    onResult: (url, meta) => {
      const asset = { id: newId(), name: deriveName(kind, meta?.prompt, seed), referenceImage: url };
      if (kind === "cast") asset.relationship = "friend";
      state.current[kind].push(asset); renderTiles(kind); renderStudio();
    },
  });
}
function deriveName(kind, prompt, seed) {
  const rest = (prompt || "").replace(seed || "", "").trim();
  const words = rest.split(/[,.]/)[0].split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  const cap = words ? words[0].toUpperCase() + words.slice(1) : "";
  const n = state.current[kind].length + 1;
  return cap || (kind === "wardrobe" ? `Outfit ${n}` : kind === "locations" ? `Location ${n}` : `Cast ${n}`);
}
function readImage(input, cb) { const f = input.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => downscale(String(rd.result)).then(cb); rd.readAsDataURL(f); }

// ---- image source picker: Generate with AI (primary), From brand context, or Upload ----
let imgTarget = null, imgUrl = null;
function pickImage(opts) {
  imgTarget = opts; imgUrl = null;
  $("imgTitle").textContent = opts.title;
  $("imgPrompt").value = opts.promptSeed || "";
  const prev = $("imgPreview"); prev.hidden = true; prev.textContent = ""; prev.className = "mprev";
  $("imgGen").textContent = "✨ Generate with AI";
  renderFromSources();
  ($("imgModal")).hidden = false;
  const ta = $("imgPrompt"); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
function closeModal() { ($("imgModal")).hidden = true; imgTarget = null; imgUrl = null; }
$("imgClose").addEventListener("click", closeModal);
$("imgModal").addEventListener("click", (e) => { if (e.target.id === "imgModal") closeModal(); });
function renderFromSources() {
  const row = $("imgFrom"); row.textContent = "";
  const chips = [];
  if (state.brand) {
    chips.push({ label: `Match ${state.brand.name}`, apply: () => append(`, in ${state.brand.name} brand style`) });
    const pal = state.brand.data?.palette; if (Array.isArray(pal)) for (const c of pal.slice(0, 4)) chips.push({ sw: c, label: c, apply: () => append(`, palette accent ${c}`) });
  }
  if (!chips.length) { row.hidden = true; return; }
  row.hidden = false; row.append(el("span", null, "Derive from brand:"));
  for (const c of chips) { const b = el("button", "src"); if (c.sw) { const s = el("span", "sw"); s.style.background = c.sw; b.append(s); } b.append(document.createTextNode(c.label)); b.onclick = c.apply; row.append(b); }
  function append(s) { const ta = $("imgPrompt"); ta.value = ta.value.trim() + s; imgUrl = null; $("imgGen").textContent = "✨ Generate with AI"; $("imgPreview").hidden = true; }
}
async function genImage(prompt) {
  if (state.mock) { await wait(750); return svgTile(prompt, "#FF5A3C", "#6B4CF0", 320, 320); }
  const instruction = `Use the Higgsfield ${GEN} tool to generate an image of: "${prompt}", aspect_ratio "1:1". Wait for it (poll if needed), then reply with ONLY the final image URL on its own line.`;
  return agenticImage(instruction, []);
}
$("imgGen").addEventListener("click", async () => {
  const prompt = $("imgPrompt").value.trim(); if (!prompt) return;
  if (imgUrl) { imgTarget?.onResult(imgUrl, { prompt }); closeModal(); return; } // second click = Use this
  const prev = $("imgPreview"); prev.hidden = false; prev.className = "mprev load"; prev.textContent = ""; prev.append(el("div", "scan"));
  const btn = $("imgGen"); btn.disabled = true; btn.textContent = "Generating…";
  try {
    const url = await genImage(prompt); if (!url) throw new Error("no image");
    imgUrl = url; prev.className = "mprev"; prev.textContent = ""; prev.append(Object.assign(el("img"), { src: url }));
    btn.textContent = "Use this ✓";
  } catch (e) { prev.className = "mprev"; prev.textContent = ""; prev.append(el("div", "empty-note", `Couldn't generate (${e?.message ?? "?"}).`)); btn.textContent = "✨ Generate with AI"; }
  btn.disabled = false;
});
$("imgPrompt").addEventListener("input", () => { if (imgUrl) { imgUrl = null; $("imgGen").textContent = "✨ Generate with AI"; $("imgPreview").hidden = true; } });
$("imgUpload").addEventListener("click", () => $("imgFile").click());
$("imgFile").addEventListener("change", () => readImage($("imgFile"), (url) => { imgTarget?.onResult(url, { prompt: $("imgPrompt").value.trim() }); $("imgFile").value = ""; closeModal(); }));

$("save").addEventListener("click", async () => {
  const p = state.current; if (!p) return;
  p.name = $("pname").value.trim(); p.niche = $("pniche").value.trim(); p.vibe = $("pvibe").value.trim(); p.story = $("pstory").value.trim();
  if (!p.name) { $("pname").focus(); return; }
  if (!p.look.referenceImage) { alert("Add a face reference — the face lock is what keeps the persona consistent."); return; }
  const btn = $("save"); btn.disabled = true; const t = btn.textContent; btn.textContent = "Saving…";
  await persist(p);
  await loadPersonas(); selectPersona(p.id);
  btn.disabled = false; btn.textContent = t;
  const flag = $("savedFlag"); flag.classList.add("show"); setTimeout(() => flag.classList.remove("show"), 1600);
});

// ---------- tabs ----------
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  for (const t of ["build", "studio", "reel", "plan"]) ($("tab-" + t)).hidden = t !== tab;
  if (tab === "studio") renderStudio();
  if (tab === "reel") renderChips("reelChips", reelSuggestions(state.current), (v) => { $("reelTopic").value = v; });
  if (tab === "plan") renderPlan();
}

// ---------- brand (the lent context) ----------
async function loadBrand() {
  try { state.brand = state.relay ? await state.relay.context.active() : null; } catch { state.brand = null; }
  if (state.tab === "studio") renderStudio();
}

// ---------- Studio tab ----------
function renderStudio() {
  const p = state.current; if (!p) return;
  renderPicks("wardrobe", "pickWardrobe", "No outfit");
  renderPicks("locations", "pickLocations", "Any location");
  renderPicks("cast", "pickCast", "Solo", true);
  // brand row
  const br = $("brandRow"); br.textContent = "";
  if (state.brand) {
    const chip = el("span", "brandchip"); chip.append(el("span", "dot"), document.createTextNode(state.brand.name)); br.append(chip);
    const chg = el("button", "linkbtn", "Change"); chg.style.marginLeft = "10px"; chg.onclick = pickBrand; br.append(chg);
  } else {
    const b = el("button", "linkbtn", "＋ Lend a brand from Switchboard"); b.onclick = pickBrand; br.append(b);
  }
  renderChips("sceneChips", sceneSuggestions(), (v) => { $("scene").value = v; });
  $("go").disabled = !p.look?.referenceImage;
}
async function pickBrand() { if (!state.relay) return; try { const c = await state.relay.context.pick(); if (c) { state.brand = c; renderStudio(); } } catch {} }

function renderPicks(kind, boxId, noneLabel, multi) {
  const box = $(boxId); box.textContent = "";
  const none = el("div", "pick" + ((multi ? state.pick.cast.size === 0 : !state.pick[kind === "locations" ? "location" : kind]) ? " on" : ""));
  none.append(el("span", "none", "∅"), document.createTextNode(noneLabel));
  none.onclick = () => { if (multi) state.pick.cast.clear(); else state.pick[kind === "locations" ? "location" : kind] = null; renderPicks(kind, boxId, noneLabel, multi); };
  box.append(none);
  for (const a of state.current[kind]) {
    const key = kind === "locations" ? "location" : kind;
    const on = multi ? state.pick.cast.has(a.id) : state.pick[key] === a.id;
    const chip = el("div", "pick" + (on ? " on" : ""));
    chip.append(Object.assign(el("img"), { src: a.referenceImage }), document.createTextNode(a.name));
    chip.onclick = () => { if (multi) { on ? state.pick.cast.delete(a.id) : state.pick.cast.add(a.id); } else { state.pick[key] = on ? null : a.id; } renderPicks(kind, boxId, noneLabel, multi); };
    box.append(chip);
  }
  if (!state.current[kind].length) box.append(el("span", "empty-note", `Add ${kind} in Build to use them here.`));
}

$("go").addEventListener("click", generate);
async function generate() {
  const p = state.current; if (!p?.look?.referenceImage) return;
  const scene = $("scene").value.trim();
  const outfit = p.wardrobe.find((a) => a.id === state.pick.wardrobe);
  const location = p.locations.find((a) => a.id === state.pick.location);
  const withCast = p.cast.filter((a) => state.pick.cast.has(a.id));
  const prompt = buildPrompt(p, scene, outfit, location, withCast);

  const card = el("div", "shot load"); card.append(el("div", "scan"), el("div", "cap", "casting…")); $("grid").prepend(card);

  if (state.mock) { // demo: show a composed placeholder shot
    await wait(900);
    finishShot(card, mockShot(p, scene, outfit, location), scene || "on-model shot");
    return;
  }

  // Real: upload every reference (face + outfit + location + cast) and generate on-model.
  const refs = [{ handle: "face", url: p.look.referenceImage, filename: "face.png" }];
  if (outfit) refs.push({ handle: "outfit", url: outfit.referenceImage, filename: "outfit.png" });
  if (location) refs.push({ handle: "loc", url: location.referenceImage, filename: "loc.png" });
  withCast.forEach((c, i) => refs.push({ handle: "cast" + i, url: c.referenceImage, filename: "cast" + i + ".png" }));
  const attachments = await Promise.all(refs.map(async (r) => ({ handle: r.handle, filename: r.filename, contentType: "image/png", dataUrl: await downscale(r.url) })));

  const steps = refs.map((r, i) =>
    `${i + 1}) media_upload({filename:"${r.filename}",content_type:"image/png"}) → relay put_blob({handle:"${r.handle}",url:<uploadUrl>}) → media_confirm ⇒ media_id_${r.handle}`).join("\n");
  const instruction =
    `Generate an on-model image of: "${prompt}", aspect_ratio "${$("aspect").value}".\n` +
    `Keep the SAME face as reference "face". Reference handles are attached: ${refs.map((r) => r.handle).join(", ")}.\n` +
    `For EACH handle do, in order:\n${steps}\n` +
    `Then call Higgsfield ${GEN} with the prompt and ALL media_id_* as references in medias (face first), so face, wardrobe and location stay consistent.\n` +
    `Poll job status until done, then reply with ONLY the final image URL on its own line.`;

  try {
    const url = await agenticImage(instruction, attachments, (n) => {
      if (n.endsWith("media_upload") || n.endsWith("put_blob") || n.endsWith("media_confirm")) status(card, "locking references…");
      else if (n.endsWith(GEN)) status(card, "shooting…");
      else if (/status|display|wait/.test(n)) status(card, "developing…");
    });
    if (!url) return fail(card, "No shot came back.");
    finishShot(card, url, scene || "on-model shot");
  } catch (err) { fail(card, `Failed (${err?.message ?? err?.code ?? "?"})`); }
}

// Run the agentic image loop for a prepared instruction + attachments; returns the final image URL.
// Shared by Studio shots and Reel keyframes so the reference-upload flow lives in one place.
async function agenticImage(instruction, attachments, onTool) {
  let url = null, acc = "";
  for await (const d of state.relay.stream({ prompt: instruction, agentic: true, attachments })) {
    if (d.type === "tool_proposed") onTool?.(d.call.name);
    else if (d.type === "tool_result" && d.result?.ok) url = extractUrl((d.result.content ?? []).map((c) => c.text ?? "").join("")) || url;
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return url || extractUrl(acc);
}
// Build the reference-upload instruction for a set of {handle,filename} refs + a prompt.
function refInstruction(promptText, aspect, refs) {
  const steps = refs.map((r, i) => `${i + 1}) media_upload({filename:"${r.filename}",content_type:"image/png"}) → relay put_blob({handle:"${r.handle}",url:<uploadUrl>}) → media_confirm ⇒ media_id_${r.handle}`).join("\n");
  return `Generate an on-model image of: "${promptText}", aspect_ratio "${aspect}".\n` +
    `Keep the SAME face as reference "face". Reference handles attached: ${refs.map((r) => r.handle).join(", ")}.\n` +
    `For EACH handle in order:\n${steps}\n` +
    `Then call Higgsfield ${GEN} with the prompt and ALL media_id_* as references in medias (face first). Reply with ONLY the final image URL on its own line.`;
}
async function attachmentsFor(refs) { return Promise.all(refs.map(async (r) => ({ handle: r.handle, filename: r.filename, contentType: "image/png", dataUrl: await downscale(r.url) }))); }
function buildPrompt(p, scene, outfit, location, withCast) {
  return [
    `${p.name || "the persona"}, an influencer${p.niche ? ` in ${p.niche}` : ""}`,
    scene || "a candid lifestyle shot",
    outfit ? `wearing ${outfit.name}` : "",
    location ? `at ${location.name}` : "",
    withCast.length ? `with ${withCast.map((c) => c.name).join(" and ")}` : "",
    p.vibe ? `mood: ${p.vibe}` : "",
    state.brand ? `for the brand ${state.brand.name}` : "",
    "photoreal, consistent with the reference face",
  ].filter(Boolean).join(". ");
}
function finishShot(card, url, cap) { card.className = "shot"; card.textContent = ""; card.append(Object.assign(el("img"), { src: url, alt: cap, loading: "lazy" }), el("div", "cap", cap)); }
function status(card, t) { const c = card.querySelector(".cap"); if (c) c.textContent = t; }
function fail(card, msg) { card.className = "shot"; card.textContent = ""; const c = el("div", "cap", msg); c.style.color = "#c0392b"; card.append(c); }

// ---------- Plan tab (research → calendar) ----------
function renderPlan() { renderCal(); if (!$("topics").children.length) $("topics").textContent = ""; }
$("research").addEventListener("click", research);
async function research() {
  const p = state.current; if (!p) return;
  const btn = $("research"); btn.disabled = true; const t = btn.textContent; btn.textContent = "Researching…";
  try {
    const topics = state.mock ? mockTopics(p) : await liveResearch(p);
    renderTopics(topics);
  } catch { $("topics").textContent = ""; $("topics").append(el("div", "empty-note", "Couldn't fetch topics — try again.")); }
  btn.disabled = false; btn.textContent = t;
}
async function liveResearch(p) {
  const prompt = `You are a social strategist for "${p.name}", an influencer in ${p.niche || "their niche"} (voice: ${p.vibe || "n/a"}). ` +
    `Use WebSearch to find 5 timely, specific content angles trending in this niche right now. ` +
    `Reply with ONLY a JSON array of {"title","angle","source"} — no prose.`;
  let acc = "";
  for await (const d of state.relay.stream({ prompt, agentic: true })) { if (d.type === "text") acc += d.text; else if (d.type === "error") throw new Error(d.error.message); }
  const m = acc.match(/\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : [];
}
function renderTopics(topics) {
  const box = $("topics"); box.textContent = "";
  if (!topics.length) { box.append(el("div", "empty-note", "No topics came back.")); return; }
  for (const tp of topics) {
    const row = el("div", "topic");
    const body = el("div", "body"); body.append(el("div", "tt", tp.title || "Untitled"));
    if (tp.angle) body.append(el("div", "td", tp.angle));
    if (tp.source) body.append(el("span", "tag", tp.source));
    const add = el("button", "plus", "＋ Schedule"); add.onclick = () => addToCalendar(tp);
    row.append(body, add); box.append(row);
  }
}

async function addToCalendar(tp) {
  const cal = await getCal();
  const day = 1 + cal.length * 2; // space pieces a couple days apart
  cal.push({ id: newId(), title: tp.title, angle: tp.angle || "", platform: "TikTok", day });
  await setCal(cal); renderCal();
}
async function getCal() { try { return safeParse(await state.relay.storage.get("calendar:" + state.current.id)) || []; } catch { return []; } }
async function setCal(cal) { try { await state.relay.storage.set("calendar:" + state.current.id, JSON.stringify(cal)); } catch {} }
async function renderCal() {
  const box = $("cal"); box.textContent = "";
  const cal = await getCal();
  if (!cal.length) { box.append(el("div", "empty-note", "Nothing scheduled yet. Research a niche and add topics.")); return; }
  const MON = ["Jul", "Jul", "Jul", "Jul"]; // demo month
  for (const s of cal.sort((a, b) => a.day - b.day)) {
    const slot = el("div", "slot");
    const when = el("div", "when"); when.append(el("div", null, "JUL"), el("div", "d", String(s.day))); slot.append(when);
    const what = el("div", "what"); what.style.minWidth = "0"; what.append(el("div", "tt", s.title));
    what.append(el("div", "meta", `${s.platform}${s.angle ? " · " + s.angle.slice(0, 60) : ""}`)); slot.append(what);
    const make = el("button", "make", "Produce"); make.onclick = () => { $("scene").value = s.angle || s.title; setTab("studio"); }; slot.append(make);
    box.append(slot);
  }
}

// ---------- Reel tab (script → storyboard → video) ----------
let reel = { beats: [], frames: [], cyc: null };
function resetReel() {
  if (reel.cyc) { clearInterval(reel.cyc); reel.cyc = null; }
  reel = { beats: [], frames: [], cyc: null };
  ["beats", "filmstrip", "reelOut"].forEach((id) => { const n = $(id); if (n) n.textContent = ""; });
  ["storyCard", "reelCard"].forEach((id) => { const n = $(id); if (n) n.hidden = true; });
}

$("writeScript").addEventListener("click", async () => {
  const p = state.current; if (!p) return;
  resetReel();
  const topic = $("reelTopic").value.trim() || `a short, on-brand piece in ${p.niche || "the niche"}`;
  const btn = $("writeScript"); btn.disabled = true; const t = btn.textContent; btn.textContent = "Writing…";
  try {
    reel.beats = state.mock ? mockScript(p, topic) : await liveScript(p, topic);
    renderBeats(reel.beats);
    await buildStoryboard(reel.beats);
  } catch (e) { $("beats").textContent = ""; $("beats").append(el("div", "empty-note", `Couldn't write the script (${e?.message ?? "?"}).`)); }
  btn.disabled = false; btn.textContent = t;
});

async function liveScript(p, topic) {
  const prompt = `Write a short-form vertical video script for "${p.name}", an influencer in ${p.niche || "their niche"} (voice: ${p.vibe || "n/a"}). ` +
    `Topic: ${topic}. 4 beats: a hook, two middle beats, a CTA. Each beat has a "shot" (what we see, on-location) and a "line" (what they say, in their voice). ` +
    `Reply with ONLY a JSON array of {"shot","line"} — no prose.`;
  let acc = "";
  for await (const d of state.relay.stream({ prompt, agentic: true })) { if (d.type === "text") acc += d.text; else if (d.type === "error") throw new Error(d.error.message); }
  const m = acc.match(/\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : [];
}
function renderBeats(beats) {
  const box = $("beats"); box.textContent = "";
  beats.forEach((b, i) => {
    const row = el("div", "beat");
    row.append(el("div", "n", String(i + 1)));
    const body = el("div", "b"); body.append(el("div", "shot", b.shot || "—")); if (b.line) body.append(el("div", "line", b.line));
    row.append(body); box.append(row);
  });
}

// A keyframe per beat, on the persona's locked face (+ default outfit/location for continuity).
async function buildStoryboard(beats) {
  const p = state.current;
  ($("storyCard")).hidden = false;
  const strip = $("filmstrip"); strip.textContent = ""; reel.frames = [];
  const outfit = p.wardrobe[0], location = p.locations[0];
  for (let i = 0; i < beats.length; i++) {
    const frame = el("div", "frame load"); frame.append(el("div", "idx", String(i + 1)), el("div", "scan")); strip.append(frame);
    let url;
    if (state.mock) { await wait(500); url = svgTile(beats[i].shot || `Shot ${i + 1}`, i % 2 ? "#6B4CF0" : "#FF5A3C", "#FF8A3D", 288, 512); }
    else {
      const refs = [{ handle: "face", url: p.look.referenceImage, filename: "face.png" }];
      if (outfit) refs.push({ handle: "outfit", url: outfit.referenceImage, filename: "outfit.png" });
      if (location) refs.push({ handle: "loc", url: location.referenceImage, filename: "loc.png" });
      const promptText = `${p.name}${p.niche ? `, ${p.niche} creator` : ""}. ${beats[i].shot}. ${outfit ? "wearing " + outfit.name + ". " : ""}${location ? "at " + location.name + ". " : ""}${p.vibe ? "mood: " + p.vibe + ". " : ""}vertical 9:16, photoreal, consistent face`;
      try { url = await agenticImage(refInstruction(promptText, "9:16", refs), await attachmentsFor(refs)); } catch { url = null; }
    }
    reel.frames[i] = url;
    frame.className = "frame"; frame.textContent = "";
    frame.append(el("div", "idx", String(i + 1)));
    if (url) frame.append(Object.assign(el("img", "img"), { src: url, alt: beats[i].shot || "" }));
    else { const ph = el("div", "img"); frame.append(ph); }
    frame.append(el("div", "cap", beats[i].shot?.slice(0, 40) || `Shot ${i + 1}`));
  }
}

$("animate").addEventListener("click", animateReel);
async function animateReel() {
  const p = state.current;
  const frames = reel.frames.filter(Boolean);
  if (!frames.length) return;
  const voiceover = $("voiceover").checked;
  const lines = reel.beats.map((b) => b.line).filter(Boolean).join("  ");
  const btn = $("animate"); btn.disabled = true; const t = btn.textContent; btn.textContent = "Animating…";
  ($("reelCard")).hidden = false;
  const out = $("reelOut"); out.textContent = "";
  const wrap = el("div", "reelwrap"); const phone = el("div", "phone"); const meta = el("div", "reelmeta");
  wrap.append(phone, meta); out.append(wrap);

  // Orchestration: the VIDEO comes from Higgsfield (a cloud connector); the VOICE is synthesized
  // ON-DEVICE — the daemon's local TTS if available, else the browser's own speech engine. Two
  // backends, one reel.
  const voice = voiceover ? await prepareVoice(lines) : null;

  if (state.mock) {
    await wait(700);
    phone.append(el("div", "live", "PREVIEW"));
    const cyc = el("div", "cyc"); const cap = el("div", "cap"); phone.append(cyc, cap);
    let i = 0; const tick = () => { cyc.style.backgroundImage = `url("${frames[i % frames.length]}")`; cap.textContent = reel.beats[i % reel.beats.length]?.line || ""; i++; };
    tick(); reel.cyc = setInterval(tick, 1600);
    addPlay(phone, voice, () => { i = 0; tick(); });
  } else {
    phone.append(Object.assign(el("div", "cap"), { textContent: "rendering…" }));
    try {
      const url = await animateLive(frames[0], p);
      phone.textContent = "";
      if (url) { phone.append(Object.assign(el("video"), { src: url, autoplay: true, loop: true, muted: !!voice, playsInline: true, controls: true })); addPlay(phone, voice); }
      else phone.append(Object.assign(el("div", "cap"), { textContent: "no clip returned" }));
    } catch (e) { phone.textContent = ""; phone.append(Object.assign(el("div", "cap"), { textContent: `failed (${e?.message ?? "?"})` })); }
  }
  meta.append(voMeta(voice, lines));
  btn.disabled = false; btn.textContent = t;
}

// Prepare an on-device voice for the script lines. Prefers the daemon's local TTS (macOS say / a
// local TTS server); falls back to the browser's built-in speech engine (also on-device).
async function prepareVoice(lines) {
  if (!lines) return null;
  if (!state.mock && state.caps?.local?.tts && state.relay.speak) {
    try {
      const voice = state.caps.local.voices?.[0];
      const r = await state.relay.speak(lines, voice ? { voice } : undefined);
      if (r?.audio) return { kind: "local", backend: r.backend || "local", play: () => { const a = new Audio(r.audio); a.play().catch(() => {}); return a; } };
    } catch { /* fall through to browser speech */ }
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    return { kind: "browser", backend: "browser speech", play: () => { const u = new SpeechSynthesisUtterance(lines); u.rate = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); return u; } };
  }
  return null;
}
function addPlay(phone, voice, onPlay) {
  if (!voice) return;
  const b = el("button", "playbtn", "▶ Play with voice");
  b.onclick = () => { onPlay?.(); voice.play(); b.textContent = "↻ Replay"; };
  phone.append(b);
}
function voMeta(voice, lines) {
  const box = el("div", "vo");
  box.append(el("b", null, voice ? `On-device voice · ${voice.backend}` : "Script"));
  box.append(document.createTextNode(lines || "—"));
  box.append(el("div", "note", voice
    ? "Video from your Higgsfield connector; voice synthesized on-device — no cloud, no credits. That's the orchestrator: cloud + local, one reel."
    : "Connect Switchboard to render a real clip on your Higgsfield."));
  return box;
}
async function animateLive(keyframeUrl, p) {
  const instruction =
    `Animate this keyframe into a short vertical (9:16) social clip.\n` +
    `Keyframe image URL: ${keyframeUrl}\n` +
    `Use the Higgsfield generate_video tool with that keyframe as the start frame; motion: subtle, natural, ${p.vibe || "candid"}.\n` +
    `Poll job status until done, then reply with ONLY the final video URL on its own line.`;
  let acc = "";
  for await (const d of state.relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) { const u = extractVideoUrl((d.result.content ?? []).map((c) => c.text ?? "").join("")); if (u) acc = u; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  return extractVideoUrl(acc);
}
const VIDEO_RE = /(https?:\/\/[^\s"')]+\.(?:mp4|webm|mov|m3u8))|"(?:videoUrl|video_url|url)"\s*:\s*"([^"]+\.(?:mp4|webm|mov)[^"]*)"/i;
function extractVideoUrl(text) { const m = (text || "").match(VIDEO_RE); return m ? (m[1] || m[2] || m[0]) : null; }
function mockScript(p, topic) {
  const who = p.name || "the creator";
  return [
    { shot: "Close-up, morning light, holding the bottle", line: `Okay the ${topic.split(" ").slice(-2).join(" ") || "one thing"} everyone's asking about — let's actually test it.` },
    { shot: "Over-the-shoulder at the bathroom shelf", line: `Two drops, press don't rub. That's it, that's the step people skip.` },
    { shot: "Mirror selfie, natural skin, mid-laugh", line: `A week in and my skin's just… calmer. No filter, promise.` },
    { shot: "Sitting on the counter, direct to camera", line: `If you try it, tag me — I read every one. ${who} out.` },
  ];
}

// ---------- utils ----------
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
const URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
function extractUrl(text) { const m = text.match(URL_RE); return m ? (m[1] || m[2] || m[0]) : null; }
async function downscale(dataUrl, max = 1024) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/png");
  } catch { return dataUrl; }
}

// ---------- demo (mock) ----------
function svgTile(label, a, b, w = 240, h = 240) {
  const words = String(label).split(/\s+/); const lines = []; let cur = "";
  for (const wd of words) { if ((cur + " " + wd).trim().length > 16) { lines.push(cur.trim()); cur = wd; } else cur += " " + wd; }
  if (cur.trim()) lines.push(cur.trim());
  const cy = h / 2 - (lines.length - 1) * 11;
  const tspans = lines.slice(0, 4).map((ln, i) => `<text x='${w / 2}' y='${cy + i * 22}' font-family='Space Grotesk, sans-serif' font-size='16' font-weight='600' fill='rgba(255,255,255,.94)' text-anchor='middle'>${ln}</text>`).join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='${w}' height='${h}' fill='url(#g)'/>${tspans}</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
function mockShot(p, scene, outfit, location) {
  const parts = [outfit?.name, location?.name].filter(Boolean).join(" · ");
  return svgTile(`${p.name || "Persona"}${parts ? " — " + parts : ""}`, "#FF8A3D", "#6B4CF0");
}
function mockTopics(p) {
  const n = p.niche || "your niche";
  const sub = n.replace(/\s/g, "");
  return [
    { title: `The "skin cycling" backlash`, angle: `React to the trend cooling off in ${n}; show your simpler routine.`, source: "TikTok trends" },
    { title: `Ingredient of the month: PDRN`, angle: `Explain salmon-DNA serums plainly; is it hype?`, source: "Google News" },
    { title: `Dupe culture vs. formulation`, angle: `Why a €9 dupe isn't the same; break down one example.`, source: `Reddit r/${sub}` },
    { title: `Morning shelfie`, angle: `A calm 4-step AM routine, on-location in your bathroom.`, source: "Instagram" },
    { title: `Q&A: SPF under makeup`, angle: `Answer the 3 most-asked reapplication questions.`, source: "Audience DMs" },
  ];
}
function mockRelay() {
  const store = new Map();
  const brand = { id: "aamras", name: "Aamras", kind: "brand", data: { palette: ["#8B1A1A", "#F4A000"] } };
  const seed = [
    (() => { const p = blankPersona(); p.id = "maya"; p.name = "Maya Chen"; p.niche = "sustainable skincare"; p.vibe = "warm, plain-spoken, reads every label"; p.look.referenceImage = svgTile("Maya", "#FF5A3C", "#FFB05A");
      p.wardrobe = [{ id: "w1", name: "Linen blazer", referenceImage: svgTile("Linen blazer", "#E8DCC8", "#C9B89A") }, { id: "w2", name: "Studio tee", referenceImage: svgTile("Studio tee", "#2B2B2B", "#5A5A5A") }];
      p.locations = [{ id: "l1", name: "Sunlit bathroom", referenceImage: svgTile("Bathroom", "#BFE3E0", "#7FBFB8") }, { id: "l2", name: "Kitchen shelf", referenceImage: svgTile("Kitchen", "#E7C9A0", "#C99B63") }];
      p.cast = [{ id: "c1", name: "Rio", relationship: "flatmate", referenceImage: svgTile("Rio", "#6B4CF0", "#9B7BFF") }]; return p; })(),
    (() => { const p = blankPersona(); p.id = "leo"; p.name = "Leo Park"; p.niche = "streetwear & sneakers"; p.vibe = "dry, hype-skeptical, knows the archive"; p.look.referenceImage = svgTile("Leo", "#1B1712", "#4A4038");
      p.wardrobe = [{ id: "w1", name: "Grey hoodie", referenceImage: svgTile("Hoodie", "#8A8A8A", "#B5B5B5") }]; p.locations = [{ id: "l1", name: "Concrete rooftop", referenceImage: svgTile("Rooftop", "#9AA0A6", "#6B7178") }]; return p; })(),
  ];
  seed.forEach((p) => store.set("persona:" + p.id, JSON.stringify(p)));
  return {
    __mock: true,
    identity: async () => ({ name: "Sameep" }),
    capabilities: async () => ({ version: "0.1", methods: [], models: [], backends: [], agentic: true, local: { tts: false } }),
    storage: { list: async () => [...store.keys()], get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) },
    context: { active: async () => brand, publish: async (c) => { store.set("persona:" + (c.id || newId()), JSON.stringify(c.data)); return c.id; }, list: async () => [], pick: async () => brand },
    stream: async function* () { yield { type: "text", text: "" }; },
  };
}
