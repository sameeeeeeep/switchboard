// The six stage renderers. Each exports render(root, ctx) and is driven entirely by the spec + the
// Account model — they hold no flow rules of their own, they read status from state.js and ask gen.js
// to produce. ctx is the app contract the shell provides:
//   { account, relay, mock, brand, loading:Set, save(), rerender(), go(stageId) }
// The through-line every stage obeys: generate options → the human locks/approves → the lock becomes
// context for the next stage. That is the whole product.
import { FACETS, FACET_IDS, facetAt, ASSETS, assetAt, facetPrompt, facetValues, STAGES, brandStyle, brandLine } from "./spec.js";
import { lockFacet, facetStatus, facetUnlocked, newId, pillarList, personaName } from "./state.js";
import * as gen from "./gen.js";
import { $, el, clear, optionCard, optionGrid, steer, gateBar, stageHead, loadingCard } from "./ui.js";

// A single running reel-preview timer, cleared whenever a stage (re)renders so it never leaks.
let reelTimer = null;
export function stopReel() { if (reelTimer) { clearInterval(reelTimer); reelTimer = null; } }
// The live camera stream for the photo entry — stopped on every stage (re)render so it never lingers.
let camStream = null;
function stopCam() { if (camStream) { for (const t of camStream.getTracks()) t.stop(); camStream = null; } }

// ============================================================ 1 · START (the one-action entry)
// The entry is ONE action: a line, a reference account, or a photo. Whichever the founder gives locks
// the brief on the spot and drops them into Foundation, where the board starts proposing on its own —
// brandbrain's shape: one input, everything else made (and approved) inside. The grounding research
// (niche + mood) runs in the background so it never blocks the action.
let entryMode = "describe";
export function renderReference(root, ctx) {
  const a = ctx.account, r = a.reference;
  if (!r.locked) return renderEntry(root, ctx);
  // ---- already begun: the grounded brief lives INSIDE the app, editable, never a gate again ----
  root.append(stageHead("reference"));
  const card = el("div", "card");
  card.append(el("span", "eyebrow", "The brief"));
  if (r.fromPhoto && a.assets?.face?.url) {
    const ph = el("div", "briefphoto");
    ph.append(Object.assign(el("img"), { src: a.assets.face.url, alt: "The uploaded photo" }));
    ph.append(el("span", "empty-note", "Started from this photo — it's locked as the face."));
    card.append(ph);
  }
  // one-line brief
  const brief = steer({
    placeholder: "Describe the account in a line — 'a plain-spoken skincare creator in Lisbon'",
    value: r.brief,
    cta: "Ground it",
    chips: ["a Gen-Z skincare creator in Lisbon", "a streetwear sneakerhead in Seoul", "a cozy home-cook mum", "a no-BS fitness coach", "a minimalist interiors creator"],
    onSubmit: (v) => { r.brief = v; ground(v); },
    onChip: (v) => { r.brief = v; ctx.rerender(); },
  });
  card.append(brief);
  // niche + mood (research fills these; editable)
  const g2 = el("div", "grid2"); g2.style.marginTop = "14px";
  g2.append(field("Niche", r.niche, "sustainable skincare", (v) => (r.niche = v)));
  g2.append(field("Mood / direction", r.moodNotes, "warm, unhurried, label-reading", (v) => (r.moodNotes = v)));
  card.append(g2);
  root.append(card);

  // inspiration accounts — the references the research agent reads
  const insp = el("div", "card");
  insp.append(el("span", "eyebrow", "Reference accounts"));
  insp.append(el("p", "empty-note", "Add a few Instagram accounts whose feel you admire. A research agent reads the niche around them and grounds every option Cast proposes."));
  const list = el("div", "insplist");
  (r.inspirations || []).forEach((ins, i) => {
    const chip = el("span", "insp");
    chip.append(el("b", null, ins.handle));
    const x = el("button", "ix", "×"); x.onclick = () => { r.inspirations.splice(i, 1); ctx.rerender(); }; chip.append(x);
    list.append(chip);
  });
  const add = steer({ placeholder: "@handle or a note about an account you admire", cta: "Add", onSubmit: (v) => { if (!v) return; r.inspirations = r.inspirations || []; r.inspirations.push({ handle: v.startsWith("@") || v.length < 24 ? v : v, note: "" }); ctx.rerender(); } });
  insp.append(list, add);
  root.append(insp);

  root.append(gateBar(a, "reference", ctx.go));
  // the confirm gate lives in-card: lock the brief
  const confirm = el("div", "confirmrow");
  const btn = el("button", r.locked ? "ghost" : "primary", r.locked ? "Brief locked ✓ — edit above to re-ground" : "Confirm brief & begin →");
  btn.onclick = () => { if (!r.brief && !r.niche) { alert("Give Cast a brief or a niche to ground the account."); return; } r.locked = true; ctx.save(); ctx.go("foundation"); };
  confirm.append(btn);
  root.append(confirm);

  async function ground(v) {
    if (ctx.mock) { r.niche = r.niche || deriveNiche(v); r.moodNotes = r.moodNotes || "warm, plain-spoken, considered"; ctx.rerender(); return; }
    brief._btn.disabled = true; brief._btn.textContent = "Reading the niche…";
    try {
      const obj = await gen.streamJsonObject(ctx.relay,
        `A founder wants to build an Instagram account: "${v}".${r.inspirations?.length ? " Reference accounts they admire: " + r.inspirations.map((i) => i.handle).join(", ") + "." : ""} ` +
        `Use WebSearch to understand this corner of Instagram. Reply with ONLY JSON {"niche": "...", "mood": "one line on tone & aesthetic"}.`);
      if (obj) { r.niche = obj.niche || r.niche; r.moodNotes = obj.mood || r.moodNotes; }
    } catch {}
    ctx.rerender();
  }
}

// The one-action entry screen. Three ways in, one action each: type a line, name a reference
// account, or upload a photo (choosing the file IS the action). No secondary fields, no confirm.
function renderEntry(root, ctx) {
  const r = ctx.account.reference;
  const card = el("div", "card entry");
  card.append(el("span", "eyebrow", "Start"));
  card.append(el("h2", "et", "Give Cast one thing."));
  card.append(el("p", "ed", "A line, an account you admire, or a photo. Cast makes everything else inside — the person, the voice, the world, the plan — and you approve every step."));

  const seg = el("div", "modes");
  for (const [id, label] of [["describe", "✏️ A line"], ["reference", "＠ An account"], ["photo", "📷 A photo"]]) {
    const b = el("button", "mode" + (entryMode === id ? " on" : ""), label);
    b.onclick = () => { entryMode = id; ctx.rerender(); };
    seg.append(b);
  }
  card.append(seg);

  if (entryMode === "describe") {
    card.append(steer({
      placeholder: "Describe the account in a line — 'a plain-spoken skincare creator in Lisbon'",
      value: r.brief,
      cta: "✨ Make it →",
      chips: ["a Gen-Z skincare creator in Lisbon", "a streetwear sneakerhead in Seoul", "a cozy home-cook mum", "a no-BS fitness coach", "a minimalist interiors creator"],
      onSubmit: (v) => { if (v) begin(ctx, { brief: v }); },
    }));
  } else if (entryMode === "reference") {
    card.append(steer({
      placeholder: "@handle of an account whose feel you admire",
      cta: "✨ Make it →",
      chips: ["@dailyoriginalvids", "@softlife.journal", "@minimal.kitchen"],
      onSubmit: (v) => { if (v) begin(ctx, { handle: v }); },
    }));
  } else {
    // Photo entry: name yourself in a line (optional), then CLICK the photo — the shutter is the
    // action. The frame is square-cropped from the camera; the preview is mirrored, the capture isn't.
    const line = Object.assign(el("input"), { type: "text", placeholder: "Who is this? — 'Sameep — I talk about AI apps and how to use them'", value: r.brief || "" });
    const lrow = el("div", "steerrow entryline"); lrow.append(el("span", "spark", "✨"), line); card.append(lrow);

    const well = el("div", "camwell");
    const idle = el("div", "camidle");
    const openBtn = el("button", "genbtn", "📷 Open the camera");
    idle.append(openBtn, el("span", "dd", "Click a photo of the person — their face becomes the locked identity, and every post is shot on it."));
    const video = Object.assign(el("video"), { autoplay: true, playsInline: true, muted: true });
    const shutter = el("button", "shutter"); shutter.title = "Click the photo";
    well.append(idle, video, shutter);

    const start = (photo) => begin(ctx, { photo, brief: line.value.trim() });
    openBtn.onclick = async () => {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } }, audio: false });
        video.srcObject = camStream; well.classList.add("live");
      } catch { openBtn.textContent = "Camera unavailable — upload below"; openBtn.disabled = true; }
    };
    shutter.onclick = () => {
      const s = Math.min(video.videoWidth, video.videoHeight); if (!s) return;
      const c = document.createElement("canvas"); c.width = c.height = Math.min(720, s);
      c.getContext("2d").drawImage(video, (video.videoWidth - s) / 2, (video.videoHeight - s) / 2, s, s, 0, 0, c.width, c.height);
      const shot = c.toDataURL("image/png");
      stopCam();
      start(shot);
    };

    const file = Object.assign(el("input"), { type: "file", accept: "image/*", hidden: true });
    const take = async (f) => {
      if (!f) return;
      const raw = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
      start(await gen.downscale(raw));
    };
    file.addEventListener("change", () => take(file.files?.[0]));
    well.addEventListener("dragover", (e) => e.preventDefault());
    well.addEventListener("drop", (e) => { e.preventDefault(); take(e.dataTransfer?.files?.[0]); });
    const up = el("div", "uploadrow");
    const ub = el("button", null, "upload a photo instead"); ub.onclick = () => file.click();
    up.append(document.createTextNode("or "), ub, document.createTextNode(" · or drag one onto the frame"));
    card.append(well, up, file);
  }
  root.append(card);
}

// The single entry action: whatever the founder gave locks the brief and drops them into Foundation,
// where the assembly board starts generating on its own. Grounding fills niche/mood in the background.
function begin(ctx, { brief, handle, photo }) {
  const a = ctx.account, r = a.reference;
  if (brief) r.brief = brief;
  if (handle) { r.inspirations = [{ handle, note: "" }]; r.brief = r.brief || `an account with the feel of ${handle}`; }
  if (photo) { a.assets.face = { url: photo, status: "done", approved: true, source: "upload" }; r.fromPhoto = true; } // brief stays the founder's line (or grounding fills it)
  r.locked = true;
  ctx.save(); ctx.go("foundation");
  groundInBackground(ctx);
}

async function groundInBackground(ctx) {
  const a = ctx.account, r = a.reference;
  if (r.niche && r.moodNotes) return;
  if (ctx.mock) { r.niche = r.niche || deriveNiche(r.brief); r.moodNotes = r.moodNotes || "warm, plain-spoken, considered"; ctx.save(); ctx.rerender(); return; }
  try {
    const attachments = r.fromPhoto && a.assets.face?.url ? [{ handle: "face", filename: "face.png", contentType: "image/png", dataUrl: a.assets.face.url }] : undefined;
    const ask = attachments
      ? `A founder photographed the person their new Instagram account is built around (attached as "face").${r.brief ? ` The founder says: "${r.brief}".` : ""} Study the photo. `
      : `A founder wants to build an Instagram account: "${r.brief}".${r.inspirations?.length ? " Reference accounts they admire: " + r.inspirations.map((i) => i.handle).join(", ") + "." : ""} Use WebSearch to understand this corner of Instagram. `;
    const obj = await gen.streamJsonObject(ctx.relay, ask + `Reply with ONLY JSON {"brief": "one line for the account", "niche": "...", "mood": "one line on tone & aesthetic"}.`, { attachments });
    if (obj) {
      if (!r.brief) r.brief = obj.brief || ""; // never overwrite the founder's own line
      r.niche = obj.niche || r.niche; r.moodNotes = obj.mood || r.moodNotes;
      ctx.save(); ctx.rerender();
    }
  } catch { /* grounding is best-effort; the fields stay editable inside */ }
}

// ============================================================ 2 · FOUNDATION (the assembly board)
export function renderFoundation(root, ctx) {
  const a = ctx.account;
  root.append(stageHead("foundation"));
  // The entry was ONE action, so the board makes the rest itself: any facet whose deps are locked
  // and that has nothing yet starts generating on its own; a lock then wakes its dependents.
  // Deferred to a microtask so runFacet's rerender never re-enters this render mid-append; a facet
  // that failed leaves cards=[] (not undefined), so a failure never re-kicks in a loop.
  queueMicrotask(() => {
    for (const facet of FACETS) {
      if (!a.foundation.locks[facet.id] && !a.foundation.cards[facet.id] && !ctx.loading.has(facet.id) && facetUnlocked(a, facet.id)) runFacet(facet, ctx);
    }
  });
  for (const facet of FACETS) root.append(facetCard(facet, ctx));
  root.append(gateBar(a, "foundation", ctx.go));
}
function facetCard(facet, ctx) {
  const a = ctx.account, fnd = a.foundation;
  const status = facetStatus(a, facet.id, ctx.loading);
  const card = el("div", "card facet " + status);
  const head = el("div", "fhead");
  const title = el("div", "ft");
  title.append(el("span", "fname", facet.title), el("span", "fstatus " + status, status));
  head.append(title);
  const lock = fnd.locks[facet.id];
  // regenerate control (only when its deps are ready)
  if (facetUnlocked(a, facet.id)) {
    const gen2 = el("button", "mini", fnd.cards[facet.id]?.length || lock ? "✨ Regenerate" : "✨ Generate options");
    gen2.disabled = status === "researching";
    gen2.onclick = () => runFacet(facet, ctx);
    head.append(gen2);
  }
  card.append(head);
  card.append(el("div", "fblurb", facet.blurb));

  if (status === "blocked") { card.append(el("div", "empty-note", `Locks first: ${facet.deps.map((d) => facetAt(d).title).join(", ")}.`)); return card; }
  if (status === "researching") { const g = el("div", "opts"); for (let i = 0; i < facet.count; i++) g.append(loadingCard(facet.web ? "researching…" : "thinking…")); card.append(g); return card; }

  // The grid always includes what's chosen, even when it isn't one of the generated cards — a custom
  // "Lock mine" answer must show up selected, not vanish.
  const genCards = fnd.cards[facet.id];
  let cards = genCards || [];
  for (const c of [lock, ...(fnd.more[facet.id] || [])].filter(Boolean)) if (!cards.some((x) => x.id === c.id)) cards = [c, ...cards];
  if (!cards.length) {
    card.append(el("div", "empty-note", genCards ? "Nothing came back — steer below and regenerate, or write your own." : "Generate options to choose a direction."));
    card.append(steerRow(facet, ctx, status));
    return card;
  }
  const picked = new Set([lock?.id, ...(fnd.more[facet.id] || []).map((c) => c.id)].filter(Boolean));
  const grid = optionGrid(cards, {
    isSelected: (c) => picked.has(c.id),
    pickLabel: facet.select === "many" ? "Add pillar +" : "Lock this →",
    onPick: (c) => { relock(a, facet.id, c); ctx.save(); ctx.rerender(); },
  });
  card.append(grid);
  card.append(steerRow(facet, ctx, status));
  if (lock && fnd.auto[facet.id]) card.append(el("div", "note", "✨ Cast locked the recommended direction — tap another card, steer, or write your own to overrule it."));
  if (facet.select === "many" && picked.size) card.append(el("div", "note", `${picked.size} pillar${picked.size === 1 ? "" : "s"} picked — lock 3-4 for a strong calendar.`));
  return card;
}
// brandbrain's "never a blank box", per facet: steer the regeneration with a note, or lock your own
// words as the answer outright. The note persists on the account and threads into every regeneration
// (spec.facetPrompt), so a steer isn't a one-off — it becomes part of the facet's brief.
function steerRow(facet, ctx, status) {
  const a = ctx.account, fnd = a.foundation;
  const steers = fnd.steers || (fnd.steers = {});
  const row = el("div", "steerrow fsteer");
  row.append(el("span", "spark", "✎"));
  const inp = Object.assign(el("input"), { type: "text", placeholder: facet.steer || "Steer the options, or write your own…", value: steers[facet.id] || "" });
  inp.addEventListener("input", () => { steers[facet.id] = inp.value; });
  const reg = el("button", "mini", "↻ Steer options");
  reg.disabled = status === "researching";
  reg.onclick = () => { steers[facet.id] = inp.value.trim(); ctx.save(); runFacet(facet, ctx); };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !reg.disabled) reg.onclick(); });
  const mine = el("button", "genbtn", facet.select === "many" ? "Add mine +" : "Lock mine →");
  mine.onclick = () => {
    const v = inp.value.trim(); if (!v) { inp.focus(); return; }
    relock(a, facet.id, ownCard(v));
    steers[facet.id] = ""; ctx.save(); ctx.rerender();
  };
  row.append(inp, reg, mine);
  return row;
}
function ownCard(v) {
  const short = v.length <= 60;
  return { id: newId(), title: short ? v : v.slice(0, 57) + "…", body: short ? undefined : v, chips: ["yours"], custom: true };
}
// A human (re)lock: lock the card, then clear any AUTO-locked dependents whose options the change
// invalidated — autopilot regenerates and re-locks them against the new truth. A dependent the human
// locked themselves is kept and simply goes stale, exactly as before.
function relock(a, facetId, card) {
  const fnd = a.foundation;
  for (const d of lockFacet(a, facetId, card)) {
    if (fnd.auto[d] && !fnd.cards[d]) { delete fnd.locks[d]; delete fnd.more[d]; delete fnd.auto[d]; }
  }
}
async function runFacet(facet, ctx) {
  const a = ctx.account;
  ctx.loading.add(facet.id); ctx.rerender();
  try {
    const cards = ctx.mock ? mockFacet(facet, a) : await gen.generateCards(ctx.relay, facetPrompt(a, facet), { web: facet.web });
    if (facet.select === "one" && cards.length && !cards.some((c) => c.recommended)) cards[0].recommended = true;
    a.foundation.cards[facet.id] = cards;
    autoLock(facet, ctx);
  } catch (e) { console.warn("[cast] facet generation failed:", facet.id, e); a.foundation.cards[facet.id] = a.foundation.cards[facet.id] || []; }
  ctx.loading.delete(facet.id); ctx.save(); ctx.rerender();
}
// Autopilot: the entry was ONE action, so Cast locks the recommended direction itself the moment the
// options land (top 3 for select:many) and marks it auto. The human overrules by tapping another
// card, steering, or writing their own — any manual lock clears the auto flag, and autopilot never
// touches a facet the human locked. A steer on an auto-locked facet replaces the auto pick with the
// new recommendation, cascading so downstream auto decisions re-run against it.
function autoLock(facet, ctx) {
  const a = ctx.account, fnd = a.foundation;
  const cards = fnd.cards[facet.id] || [];
  const humanLocked = fnd.locks[facet.id] && !fnd.auto[facet.id];
  if (humanLocked || !cards.length) return;
  if (fnd.auto[facet.id]) { delete fnd.locks[facet.id]; delete fnd.more[facet.id]; } // replace the previous auto pick
  if (facet.select === "many") for (const c of cards.slice(0, 3)) relock(a, facet.id, c);
  else relock(a, facet.id, cards.find((c) => c.recommended) || cards[0]);
  fnd.auto[facet.id] = true;
}

// ============================================================ 3 · BASE ASSETS
export function renderAssets(root, ctx) {
  const a = ctx.account;
  root.append(stageHead("assets"));
  const vals = facetValues(a);
  // Autopilot: the gate assets start generating on arrival (a photo-entry face is already approved);
  // the human still approves each one. genAsset sets the record synchronously, so re-renders can't
  // double-kick, and a failed record ("fail") never re-kicks.
  queueMicrotask(() => { for (const spec of ASSETS) if (spec.gate && spec.one && !a.assets[spec.id]) genAsset(spec, spec.seed(vals), ctx); });
  for (const spec of ASSETS) root.append(assetCard(spec, vals, ctx));
  root.append(gateBar(a, "assets", ctx.go));
}
function assetCard(spec, vals, ctx) {
  const a = ctx.account;
  const card = el("div", "card");
  const head = el("div", "ah");
  head.append(el("span", "eyebrow", spec.title + (spec.gate ? "" : " · optional")));
  card.append(head);
  const seed = spec.seed(vals);

  if (spec.one) {
    const cur = a.assets[spec.id];
    const box = el("div", "assetone");
    const well = el("div", "assetwell" + (cur?.status === "gen" ? " load" : ""));
    if (cur?.status === "gen") well.append(el("div", "scan"));
    else if (cur?.url) well.append(Object.assign(el("img"), { src: cur.url }));
    else well.append(el("span", "ph", "✨"));
    box.append(well);
    const side = el("div", "assetside");
    side.append(el("div", "d", cur?.url ? (cur.approved ? "Approved — used in every shot." : "Approve to lock it into the persona's world, or regenerate.") : "Generate from your locked foundation."));
    const btns = el("div", "facebtns");
    const g = el("button", "genbtn", cur?.url ? "↻ Regenerate" : "✨ Generate"); g.disabled = cur?.status === "gen"; g.onclick = () => genAsset(spec, seed, ctx); btns.append(g);
    if (cur?.url && !cur.approved) { const ok = el("button", "okbtn", "Approve ✓"); ok.onclick = () => { cur.approved = true; ctx.save(); ctx.rerender(); }; btns.append(ok); }
    if (cur?.approved) btns.append(el("span", "saved show", "Approved ✓"));
    side.append(btns);
    box.append(side);
    card.append(box);
  } else {
    const list = a.assets[spec.id] || (a.assets[spec.id] = []);
    const tiles = el("div", "tiles");
    list.forEach((asset, i) => {
      const tile = el("div", "tile" + (asset.status === "gen" ? " load" : "") + (asset.approved ? " ok" : ""));
      if (asset.status === "gen") tile.append(el("div", "scan"));
      else { tile.append(Object.assign(el("img", "img"), { src: asset.url })); tile.append(el("div", "lb", asset.name || spec.title)); }
      if (asset.url && !asset.approved) { const ok = el("button", "tok", "✓"); ok.title = "Approve"; ok.onclick = () => { asset.approved = true; ctx.save(); ctx.rerender(); }; tile.append(ok); }
      const x = el("button", "x", "×"); x.onclick = () => { list.splice(i, 1); ctx.save(); ctx.rerender(); }; tile.append(x);
      tiles.append(tile);
    });
    const add = el("div", "tile empty", "✨ Generate"); add.onclick = () => genAsset(spec, seed, ctx); tiles.append(add);
    card.append(tiles);
  }
  return card;
}
async function genAsset(spec, seed, ctx) {
  const a = ctx.account;
  const rec = { id: newId(), status: "gen", approved: false, prompt: seed, name: spec.title };
  if (spec.one) a.assets[spec.id] = rec; else (a.assets[spec.id] = a.assets[spec.id] || []).push(rec);
  ctx.rerender();
  // fold the lent brand's style into the asset prompt (palette accents, brand look)
  const bseed = brandStyle(a) ? `${seed}, ${brandStyle(a)}` : seed;
  try {
    let url;
    if (ctx.mock) { await gen.wait(800); url = gen.svgTile(spec.title, ...gen.COLORS[Math.floor(Math.random() * gen.COLORS.length)]); }
    else if (spec.id === "face") url = await gen.generateImage(ctx.relay, bseed, "1:1", gen.MODELS.face);
    else if (spec.id === "setting") url = await gen.generateImage(ctx.relay, bseed, "9:16", gen.MODELS.setting);
    else {
      // on-model: keep the locked face, nano_banana_pro for identity + distinct actions
      const refs = a.assets.face?.url ? [{ handle: "face", filename: "face.png", url: a.assets.face.url }] : [];
      url = refs.length ? await gen.generateOnModel(ctx.relay, bseed, "1:1", refs, null, gen.MODELS.shot) : await gen.generateImage(ctx.relay, bseed, "1:1", gen.MODELS.shot);
    }
    rec.url = url; rec.status = url ? "done" : "fail";
  } catch { rec.status = "fail"; }
  ctx.save(); ctx.rerender();
}

// ============================================================ 4 · CALENDAR
export function renderCalendar(root, ctx) {
  const a = ctx.account;
  root.append(stageHead("calendar"));
  const pillars = pillarList(a);
  // Autopilot: the first plan proposes itself on arrival; the human approves slots into the calendar.
  // `_proposed` stays undefined until a run finishes (a failed run leaves []), so this fires once.
  if (a.calendar._proposed === undefined && !(a.calendar.slots || []).length && !ctx.loading.has("plan")) queueMicrotask(() => proposePlan(ctx));
  const research = el("div", "card");
  research.append(el("span", "eyebrow", "Research → plan"));
  research.append(el("p", "empty-note", `A research agent proposes dated posts across your ${pillars.length} pillar${pillars.length === 1 ? "" : "s"}, using what's trending now. Approve the ones you want.`));
  const btn = el("button", "primary", a.calendar._proposed?.length ? "✨ Propose more" : "✨ Propose a content plan");
  btn.disabled = ctx.loading.has("plan");
  btn.onclick = () => proposePlan(ctx);
  research.append(btn);
  const props = el("div", "topics"); props.id = "planProps";
  if (ctx.loading.has("plan")) for (let i = 0; i < 3; i++) props.append(loadingCard("researching the niche…"));
  (a.calendar._proposed || []).forEach((tp) => props.append(topicRow(tp, ctx)));
  research.append(props);
  root.append(research);

  // the approved calendar
  const cal = el("div", "card");
  cal.append(el("span", "eyebrow", "Content calendar"));
  const slots = (a.calendar.slots || []).filter((s) => s.approved).sort((x, y) => (x.date || "").localeCompare(y.date || ""));
  if (!slots.length) cal.append(el("div", "empty-note", "Nothing approved yet. Propose a plan and approve slots into the calendar."));
  else for (const s of slots) cal.append(slotRow(s, ctx));
  root.append(cal);
  root.append(gateBar(a, "calendar", ctx.go));
}
function topicRow(tp, ctx) {
  const a = ctx.account;
  const row = el("div", "topic");
  const body = el("div", "body");
  body.append(el("div", "tt", tp.title));
  if (tp.angle) body.append(el("div", "td", tp.angle));
  const tags = el("div", null); if (tp.pillar) tags.append(el("span", "tag", tp.pillar)); if (tp.source) tags.append(el("span", "tag alt", tp.source)); body.append(tags);
  const add = el("button", "plus", "＋ Approve");
  add.onclick = () => { a.calendar.slots.push({ id: newId(), date: tp.date || nextDate(a), pillar: tp.pillar, title: tp.title, angle: tp.angle, source: tp.source, approved: true, status: "planned" }); a.calendar._proposed = (a.calendar._proposed || []).filter((x) => x !== tp); ctx.save(); ctx.rerender(); };
  row.append(body, add);
  return row;
}
function slotRow(s, ctx) {
  const a = ctx.account;
  const slot = el("div", "slot");
  const when = el("div", "when"); const d = (s.date || "").split("-"); when.append(el("div", null, monthShort(d[1])), el("div", "d", d[2] || "1")); slot.append(when);
  const what = el("div", "what"); what.append(el("div", "tt", s.title)); what.append(el("div", "meta", `${s.pillar || "post"}${s.angle ? " · " + s.angle.slice(0, 54) : ""}`)); slot.append(what);
  const x = el("button", "x", "×"); x.onclick = () => { a.calendar.slots = a.calendar.slots.filter((y) => y.id !== s.id); ctx.save(); ctx.rerender(); }; slot.append(x);
  return slot;
}
async function proposePlan(ctx) {
  const a = ctx.account;
  ctx.loading.add("plan"); ctx.rerender();
  try {
    const pillars = pillarList(a).map((p) => p.title);
    const props = ctx.mock ? mockPlan(a) : await gen.generateCards(ctx.relay,
      `You are a social strategist for ${personaName(a)}, an account in ${a.reference.niche || "its niche"} (voice: ${a.foundation.locks.voice?.title || "n/a"}). ` +
      (brandLine(a) ? brandLine(a) + " Weave the brand in naturally where it fits, never forced. " : "") +
      `Pillars: ${pillars.join(", ") || "general"}. Use WebSearch for what's trending right now. Propose 6 specific posts spread over the next few weeks. ` +
      `Reply with ONLY a JSON array of {"title","angle","pillar","source","date":"2026-07-DD"}.`, { web: true });
    a.calendar._proposed = [...(a.calendar._proposed || []), ...props.map((c) => ({ title: c.title, angle: c.body || c.angle, pillar: c.chips?.[0] || c.pillar, source: c.subtitle || c.source, date: c.date }))];
  } catch { a.calendar._proposed = a.calendar._proposed || []; }
  ctx.loading.delete("plan"); ctx.save(); ctx.rerender();
}

// ============================================================ 5 · SCRIPTS
export function renderScripts(root, ctx) {
  const a = ctx.account;
  root.append(stageHead("scripts"));
  const slots = (a.calendar.slots || []).filter((s) => s.approved);
  // Autopilot: draft a script for every approved slot that has none; the human approves or steers.
  // A failed write leaves a null marker (see writeScript), so failures never re-kick in a loop.
  queueMicrotask(() => { for (const s of slots) if (!(s.id in a.scripts) && !ctx.loading.has("script:" + s.id)) writeScript(s, ctx); });
  if (!slots.length) root.append(el("div", "empty-note", "Approve calendar slots first — each becomes a script here."));
  for (const s of slots) root.append(scriptCard(s, ctx));
  root.append(gateBar(a, "scripts", ctx.go));
}
function scriptCard(slot, ctx) {
  const a = ctx.account;
  const sc = a.scripts[slot.id];
  const card = el("div", "card");
  const head = el("div", "ah");
  head.append(el("span", "eyebrow", slot.title));
  const g = el("button", "mini", sc ? "↻ Rewrite" : "✨ Write script"); g.disabled = ctx.loading.has("script:" + slot.id); g.onclick = () => writeScript(slot, ctx); head.append(g);
  card.append(head);
  if (slot.angle) card.append(el("div", "fblurb", slot.angle));
  if (ctx.loading.has("script:" + slot.id)) { card.append(loadingCard("writing…")); return card; }
  if (!sc) { card.append(el("div", "empty-note", "No script yet.")); return card; }
  const beats = el("div", null);
  sc.beats.forEach((b, i) => {
    const row = el("div", "beat");
    row.append(el("div", "n", String(i + 1)));
    const body = el("div", "b"); body.append(el("div", "shot", b.shot || "—")); if (b.line) body.append(el("div", "line", b.line)); row.append(body);
    beats.append(row);
  });
  card.append(beats);
  const foot = el("div", "confirmrow");
  const ok = el("button", sc.approved ? "ghost" : "primary", sc.approved ? "Script approved ✓" : "Approve script →");
  ok.onclick = () => { sc.approved = !sc.approved; ctx.save(); ctx.rerender(); };
  foot.append(ok);
  card.append(foot);
  return card;
}
async function writeScript(slot, ctx) {
  const a = ctx.account;
  ctx.loading.add("script:" + slot.id); ctx.rerender();
  try {
    const beats = ctx.mock ? mockScript(a, slot) : await gen.generateCards(ctx.relay,
      `Write a short-form vertical video script for ${personaName(a)} (voice: ${a.foundation.locks.voice?.title || "natural"}). ` +
      (brandLine(a) ? brandLine(a) + " If the brand fits the topic, feature it authentically; otherwise leave it out. " : "") +
      `Topic: ${slot.title}. ${slot.angle || ""}. 4 beats: hook, two middles, CTA. Each beat: {"shot": what we see on-location, "line": what they say in their voice}. ` +
      `Reply with ONLY a JSON array of {"shot","line"}.`).then((cards) => cards.map((c) => ({ shot: c.title, line: c.body || "" })));
    a.scripts[slot.id] = { beats, approved: false, status: "written" };
  } catch { if (!(slot.id in a.scripts)) a.scripts[slot.id] = null; } // marker: tried & failed, don't auto-retry
  ctx.loading.delete("script:" + slot.id); ctx.save(); ctx.rerender();
}

// ============================================================ 6 · PRODUCE (shoot → stitch → approve)
export function renderProduce(root, ctx) {
  const a = ctx.account;
  root.append(stageHead("produce"));
  const slots = (a.calendar.slots || []).filter((s) => s.approved && a.scripts[s.id]?.approved);
  if (!slots.length) root.append(el("div", "empty-note", "Approve a script first — approved scripts become productions here."));
  for (const s of slots) root.append(produceCard(s, ctx));
  root.append(gateBar(a, "produce", ctx.go));
}
function produceCard(slot, ctx) {
  const a = ctx.account;
  const sc = a.scripts[slot.id];
  const prod = a.productions[slot.id] || (a.productions[slot.id] = { shots: sc.beats.map((b, i) => ({ id: newId(), desc: b.shot, line: b.line, url: null, status: "idle", approved: false })), stitchedUrl: null, approved: false, status: "idle" });
  const card = el("div", "card");
  card.append(el("span", "eyebrow", slot.title));
  card.append(el("div", "fblurb", "Storyboard — one still per beat (nano-banana keyframes). Approve them, then render each into a real video clip on your locked face + voice."));
  // storyboard filmstrip (stills, one per beat)
  const strip = el("div", "filmstrip");
  prod.shots.forEach((shot, i) => {
    const frame = el("div", "frame" + (shot.status === "gen" ? " load" : "") + (shot.approved ? " ok" : ""));
    frame.append(el("div", "idx", String(i + 1)));
    if (shot.status === "gen") frame.append(el("div", "scan"));
    else if (shot.url) frame.append(Object.assign(el("img", "img"), { src: shot.url, alt: shot.desc }));
    else { const ph = el("div", "img"); frame.append(ph); }
    frame.append(el("div", "cap", (shot.desc || "").slice(0, 42)));
    const bar = el("div", "framebar");
    const g = el("button", "fmini", shot.url ? "↻" : "✨"); g.title = shot.url ? "Regenerate" : "Generate"; g.onclick = () => genShot(slot, i, ctx); bar.append(g);
    if (shot.url && !shot.approved) { const ok = el("button", "fmini ok", "✓"); ok.title = "Approve"; ok.onclick = () => { shot.approved = true; ctx.save(); ctx.rerender(); }; bar.append(ok); }
    frame.append(bar);
    strip.append(frame);
  });
  card.append(strip);

  // shoot-all + stitch controls
  const foot = el("div", "confirmrow");
  const shootAll = el("button", "ghost", "✨ Generate storyboard"); shootAll.onclick = () => shootAll_(slot, ctx); foot.append(shootAll);
  const approvedShots = prod.shots.filter((s) => s.approved && s.url).length;
  const stitch = el("button", "primary", prod.status === "stitch" ? "Rendering video…" : "🎬 Render reel (video) →");
  stitch.disabled = approvedShots < 1 || prod.status === "stitch";
  stitch.onclick = () => stitch_(slot, ctx);
  foot.append(stitch);
  card.append(foot);
  card.append(el("div", "note", `${approvedShots}/${prod.shots.length} beats approved · each renders into a real video clip (Seedance), then stitched.`));

  // Alternative path — video → video: drive the WHOLE reel from a reference clip, on our locked
  // persona, in one call (Seedance 2.0). "Make a video like this one, but it's my creator."
  const rd = el("div", "refdrive");
  rd.append(el("span", "eyebrow", "Or — drive from a reference reel"));
  rd.append(el("p", "empty-note", "Paste a reference reel whose energy you like. Cast makes a NEW clip that follows its pacing on your locked persona — video → video, one shot, no shot-by-shot."));
  const rrow = el("div", "confirmrow");
  const inp = Object.assign(el("input"), { type: "text", placeholder: "https://…/reference-reel.mp4", value: prod.refUrl || "" });
  inp.addEventListener("input", () => (prod.refUrl = inp.value));
  const rbtn = el("button", "ghost", prod.refStatus === "gen" ? "Driving…" : "🎬 Generate from reference");
  rbtn.disabled = prod.refStatus === "gen" || !a.assets.face?.url;
  rbtn.onclick = () => driveFromRef(slot, ctx, inp.value.trim());
  rrow.append(inp, rbtn);
  rd.append(rrow);
  card.append(rd);

  // The reel — a beat-synced preview that ACTUALLY follows the script: each beat's shot plays in
  // order with that beat's line captioned, and the lines are spoken in the persona's voice. This is
  // the fix for "she's not following the script" — the output is built FROM the beats, not a
  // disconnected clip. A real stitched/driven MP4 (if produced) shows below as the exportable cut.
  const shownShots = prod.shots.filter((s) => s.url);
  if (shownShots.length || prod.status === "stitch") renderReel(card, slot, ctx, prod, sc);
  return card;
}

// Build the reel: the rendered VIDEO is the hero. Until it's rendered, the phone shows the storyboard
// (the per-beat stills cycling with their lines) clearly labelled as a plan, not the finished reel.
function renderReel(card, slot, ctx, prod, sc) {
  const a = ctx.account, beats = sc.beats;
  const hasVideo = prod.stitchedUrl && !prod.stitchedUrl.startsWith("data:image");
  const out = el("div", "reelwrap"); out.style.marginTop = "16px";
  const phone = el("div", "phone");
  out.append(phone);

  stopReel();
  if (prod.status === "stitch") {
    phone.append(el("div", "cyc"), Object.assign(el("div", "cap"), { textContent: prod.refStatus === "gen" ? "driving from reference…" : "rendering video…" }), el("div", "scan"));
  } else if (hasVideo) {
    // the actual rendered reel — real video, the hero
    phone.append(Object.assign(el("video"), { src: prod.stitchedUrl, autoplay: true, loop: true, muted: true, playsInline: true, controls: true }));
    phone.append(el("div", "live", "REEL"));
  } else {
    // storyboard preview only — stills cycling, explicitly NOT the finished video
    const cyc = el("div", "cyc"); const cap = el("div", "cap"); phone.append(cyc, cap, el("div", "live storyboard", "STORYBOARD"));
    let i = 0;
    const paint = () => { const shot = prod.shots[i % prod.shots.length]; cyc.style.backgroundImage = shot?.url ? `url("${shot.url}")` : ""; cap.textContent = beats[i % beats.length]?.line || ""; };
    paint();
    reelTimer = setInterval(() => { i = (i + 1) % beats.length; paint(); }, 2400);
  }

  const meta = el("div", "reelmeta");
  const vo = el("div", "vo");
  vo.append(el("b", null, hasVideo ? `Reel · ${personaName(a)}'s voice` : `The script · storyboard`));
  if (!hasVideo && prod.status !== "stitch") vo.append(el("div", "empty-note", "This is the storyboard. Render each beat into real video with the button above."));
  const ol = el("ol", "beatlines");
  beats.forEach((b, i) => { const li = el("li"); li.append(el("span", "bn", String(i + 1)), document.createTextNode(b.line || b.shot || "")); ol.append(li); });
  vo.append(ol);

  const row = el("div", "confirmrow"); row.style.marginTop = "12px";
  const play = el("button", "ghost", "▶ Play with voice");
  play.onclick = async () => {
    play.disabled = true; play.textContent = "Speaking…";
    const v = await makeVoice(ctx, beats.map((b) => b.line).filter(Boolean).join("  "));
    v?.play(); play.disabled = false; play.textContent = v ? `↻ Replay · ${v.backend}` : "voice unavailable";
  };
  row.append(play);
  if (hasVideo) {
    const ok = el("button", prod.approved ? "ghost" : "primary", prod.approved ? "Post approved ✓ — published as context" : "Approve final cut ✓");
    ok.onclick = () => { prod.approved = !prod.approved; if (prod.approved) slot.status = "produced"; ctx.save(); ctx.rerender(); };
    row.append(ok);
  }
  vo.append(row); meta.append(vo); out.append(meta); card.append(out);
}

// On-device voice for the script lines — prefers the daemon's local TTS (relay.speak), falls back to
// the browser's own speech engine. Cloud video + on-device voice = the orchestrator thesis, and it's
// what makes the reel audibly follow the script.
async function makeVoice(ctx, textLines) {
  if (!textLines) return null;
  const a = ctx.account;
  // 1) Higgsfield's own TTS — the persona's platform voice (consistent, cloud, no daemon). Uses the
  //    locked voice id when the persona has one (see Voice lock).
  if (!ctx.mock && ctx.relay?.stream) {
    try { const url = await gen.generateSpeech(ctx.relay, textLines, a.assets?.voice?.voiceId); if (url) return { backend: "Higgsfield TTS", play: () => { const au = new Audio(url); au.play().catch(() => {}); } }; } catch { /* fall through */ }
  }
  // 2) on-device daemon TTS (macOS say / local server)
  if (!ctx.mock && ctx.relay?.speak && ctx.caps?.local?.tts) {
    try {
      const voice = ctx.caps.local.voices?.[0];
      const r = await ctx.relay.speak(textLines, voice ? { voice } : undefined);
      if (r?.audio) return { backend: r.backend || "local TTS", play: () => { const au = new Audio(r.audio); au.play().catch(() => {}); } };
    } catch { /* fall through */ }
  }
  // 3) the browser's built-in speech engine (works everywhere, incl. the mock demo)
  if (typeof window !== "undefined" && window.speechSynthesis) {
    return { backend: "browser speech", play: () => { const u = new SpeechSynthesisUtterance(textLines); u.rate = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } };
  }
  return null;
}
async function genShot(slot, i, ctx) {
  const a = ctx.account, prod = a.productions[slot.id], shot = prod.shots[i];
  shot.status = "gen"; ctx.rerender();
  try {
    let url;
    if (ctx.mock) { await gen.wait(700); url = gen.svgTile(shot.desc || `Shot ${i + 1}`, ...gen.COLORS[i % gen.COLORS.length], 288, 512); }
    else {
      const refs = [];
      if (a.assets.face?.url) refs.push({ handle: "face", filename: "face.png", url: a.assets.face.url });
      if (a.assets.setting?.url) refs.push({ handle: "loc", filename: "loc.png", url: a.assets.setting.url });
      const prompt = `${personaName(a)}. ${shot.desc}. ${a.foundation.locks.aesthetic?.title || ""} look. ${brandStyle(a)} vertical 9:16, photoreal, consistent face`.replace(/\s+/g, " ");
      url = refs.length ? await gen.generateOnModel(ctx.relay, prompt, "9:16", refs, null, gen.MODELS.shot) : await gen.generateImage(ctx.relay, prompt, "9:16", gen.MODELS.shot);
    }
    shot.url = url; shot.status = url ? "done" : "fail";
  } catch { shot.status = "fail"; }
  ctx.save(); ctx.rerender();
}
async function shootAll_(slot, ctx) {
  const prod = ctx.account.productions[slot.id];
  for (let i = 0; i < prod.shots.length; i++) if (!prod.shots[i].url) await genShot(slot, i, ctx);
}
// Video → video: one call turns a reference reel + our locked face into a finished reel.
async function driveFromRef(slot, ctx, refUrl) {
  const a = ctx.account, prod = a.productions[slot.id];
  if (!refUrl) { alert("Paste a reference reel URL to drive from."); return; }
  if (!a.assets.face?.url) { alert("Approve a face first — it's the identity we keep."); return; }
  prod.refStatus = "gen"; prod.status = "stitch"; prod.refUrl = refUrl; ctx.rerender();
  try {
    const prompt = `${personaName(a)} — ${slot.title}. ${slot.angle || ""}`.trim();
    prod.stitchedUrl = ctx.mock
      ? (await gen.wait(1100), gen.svgTile("Ref-driven reel", "#C8F250", "#6B4CF0", 288, 512))
      : await gen.refDrive(ctx.relay, a.assets.face.url, refUrl, prompt);
  } catch { /* leave stitchedUrl null → phone shows the failure state */ }
  prod.refStatus = "done"; prod.status = prod.stitchedUrl ? "done" : "idle"; ctx.save(); ctx.rerender();
}
async function stitch_(slot, ctx) {
  const a = ctx.account, prod = a.productions[slot.id];
  prod.status = "stitch"; ctx.rerender();
  try {
    if (ctx.mock) { await gen.wait(1000); prod.stitchedUrl = prod.shots.find((s) => s.url)?.url || gen.svgTile("Reel", "#FF5A3C", "#6B4CF0", 288, 512); }
    else {
      // For each approved beat: speak its line in the persona's Higgsfield voice, then generate a REAL
      // VIDEO clip (Seedance) — identity from the face, seeded by the storyboard still, acting the
      // beat and lip-synced/paced to that voiceover. NOT a still being panned. Stitch in order → a
      // reel where the persona actually performs and says the script.
      const voiceId = a.assets?.voice?.voiceId;
      const face = a.assets?.face?.url;
      const clips = [];
      for (const s of prod.shots.filter((s) => s.approved && s.url)) {
        let audio = null;
        try { if (s.line) audio = await gen.generateSpeech(ctx.relay, s.line, voiceId); } catch {}
        let clip = null;
        try { clip = await gen.beatClip(ctx.relay, s.url, face || s.url, audio, s.desc); } catch {}
        if (!clip) { try { clip = await gen.generateVideo(ctx.relay, s.url, s.desc || "natural, candid"); } catch {} } // fallback: animate the still
        if (clip) clips.push(clip);
      }
      prod.stitchedUrl = clips.length ? await gen.stitchClips(ctx.relay, clips) : (prod.shots.find((s) => s.url)?.url || null);
    }
  } catch {}
  prod.status = prod.stitchedUrl ? "done" : "idle"; ctx.save(); ctx.rerender();
}

// ============================================================ helpers
function field(label, value, ph, onInput) {
  const l = el("label", "field"); l.append(el("span", null, label));
  const i = Object.assign(el("input"), { type: "text", value: value || "", placeholder: ph });
  i.addEventListener("input", () => onInput(i.value));
  l.append(i); return l;
}
function deriveNiche(idea) {
  const i = (idea || "").toLowerCase();
  return /\bai\b|artificial intel|prompt|chatgpt|claude/.test(i) ? "AI apps & how to use them" : /skin|serum|beauty/.test(i) ? "sustainable skincare" : /sneaker|street|hype/.test(i) ? "streetwear & sneakers" : /cook|food|recipe/.test(i) ? "home cooking" : /fit|gym|coach/.test(i) ? "fitness & mobility" : /home|interior|decor/.test(i) ? "home & interiors" : (idea || "lifestyle").split(/\s+/).slice(-2).join(" ");
}
function nextDate(a) { const n = (a.calendar.slots || []).length; const day = 3 + n * 3; return `2026-07-${String(Math.min(28, day)).padStart(2, "0")}`; }
function monthShort(m) { return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][(parseInt(m, 10) || 7) - 1] || "JUL"; }

// ---------- demo (mock) fixtures ----------
const ROUTER = { reference: renderReference, foundation: renderFoundation, assets: renderAssets, calendar: renderCalendar, scripts: renderScripts, produce: renderProduce };
export function renderStage(stageId, root, ctx) { stopReel(); stopCam(); clear(root); (ROUTER[stageId] || renderReference)(root, ctx); }

function mockFacet(facet, a) {
  const niche = a.reference.niche || "the niche";
  const pools = {
    persona: [
      { title: "Maya Chen", subtitle: "28, Lisbon · ex-lab chemist", body: "Reads every label; the trusted explainer of the niche.", chips: ["warm", "precise", "witty"], recommended: true },
      { title: "Rae Okafor", subtitle: "31, London · former esthetician", body: "The bold myth-buster with receipts.", chips: ["sharp", "funny", "contrarian"] },
      { title: "Noa Sato", subtitle: "26, Kyoto · slow-living writer", body: "The soft-life aesthete; calm routines, mood-first.", chips: ["gentle", "unhurried", "poetic"] },
    ],
    voice: [
      { title: "Warm & plain", body: "Talks like a friend who happens to know the science.", bullets: ["okay let's actually test this —", "the step everyone skips:"], chips: ["kind", "clear", "dry-funny"], recommended: true },
      { title: "Dry & deadpan", body: "Deadpan, fast, allergic to hype.", bullets: ["no.", "here's why that's marketing:"], chips: ["deadpan", "quick", "skeptical"] },
      { title: "Soft & ASMR", body: "Low, unhurried, close-mic.", bullets: ["let's take a slow minute", "press, don't rub"], chips: ["soft", "calm", "intimate"] },
    ],
    aesthetic: [
      { title: "Sunlit film", body: "Warm 35mm grade, soft window light, shallow depth.", palette: [{ name: "cream", hex: "#F4E9D8" }, { name: "amber", hex: "#E8A85C" }, { name: "clay", hex: "#C6714B" }], chips: ["warm", "analog"], recommended: true },
      { title: "Cool clinical", body: "Crisp neutral white, even light, product-forward.", palette: [{ name: "paper", hex: "#F7F7F5" }, { name: "steel", hex: "#B9C2C7" }, { name: "ink", hex: "#2B2F33" }], chips: ["clean", "precise"] },
      { title: "Moody editorial", body: "Deep shadow, single hard light, matte finish.", palette: [{ name: "char", hex: "#22201E" }, { name: "rust", hex: "#8A4B32" }, { name: "bone", hex: "#D8CFC2" }], chips: ["dramatic", "matte"] },
    ],
    setting: [
      { title: "Sunlit Lisbon flat", body: "Tiled kitchen, big south window, plants everywhere.", bullets: ["marble counter", "sunny balcony", "bathroom shelf"], recommended: true },
      { title: "Concrete studio loft", body: "Grey micro-cement, north light, minimal props.", bullets: ["worktable", "window ledge", "bare wall"] },
      { title: "Cozy wood cabin", body: "Warm timber, low light, textiles.", bullets: ["reading nook", "kitchen table", "porch"] },
    ],
    audience: [
      { title: "The overwhelmed optimizer", subtitle: "F, 24-34, urban", body: "Comes for a routine they can actually keep.", chips: ["routines", "dupes"], recommended: true },
      { title: "The ingredient nerd", subtitle: "25-40, mixed", body: "Comes for the why behind the formula.", chips: ["breakdowns", "studies"] },
      { title: "The soft-life seeker", subtitle: "F, 20-30", body: "Comes for the calm as much as the tips.", chips: ["ASMR", "mood"] },
    ],
    pillars: [
      { title: "Myth vs. formulation", body: "Debunk a trend, show the simpler truth.", chips: ["dupe culture", "ingredient of the month"] },
      { title: "Calm routine", body: "A short on-location AM/PM routine.", chips: ["4-step AM", "wind-down PM"] },
      { title: "Label reads", body: "Read a real label on camera, plainly.", chips: ["decoding INCI", "spot the filler"] },
      { title: "Q&A from DMs", body: "Answer the most-asked question.", chips: ["SPF reapplication", "purging vs breakout"] },
      { title: "Behind the niche", body: "A person or brand doing it right.", chips: ["founder chat", "lab visit"] },
    ],
  };
  return (pools[facet.id] || []).map((c) => ({ ...c, id: newId() }));
}
function mockPlan(a) {
  const n = a.reference.niche || "your niche";
  return [
    { title: `The "skin cycling" backlash`, body: `React to the trend cooling; show your simpler routine.`, chips: ["Myth vs. formulation"], subtitle: "TikTok trends", date: "2026-07-05" },
    { title: `Ingredient of the month: PDRN`, body: `Explain salmon-DNA serums plainly — hype?`, chips: ["Label reads"], subtitle: "Google News", date: "2026-07-09" },
    { title: `A calm 4-step morning`, body: `On-location AM routine in the sunlit bathroom.`, chips: ["Calm routine"], subtitle: "Evergreen", date: "2026-07-12" },
    { title: `SPF under makeup — the 3 asks`, body: `Answer the most-DM'd reapplication questions.`, chips: ["Q&A from DMs"], subtitle: "Audience DMs", date: "2026-07-16" },
    { title: `€9 dupe vs. the €40`, body: `Break down why the formulation differs.`, chips: ["Myth vs. formulation"], subtitle: `Reddit`, date: "2026-07-20" },
    { title: `A day in the lab`, body: `Behind-the-niche: how a small batch is made.`, chips: ["Behind the niche"], subtitle: "Original", date: "2026-07-24" },
  ].map((c) => ({ ...c, id: newId() }));
}
function mockScript(a, slot) {
  const who = personaName(a);
  return [
    { shot: "Close-up, morning light, holding the bottle", line: `Okay, the ${slot.title.toLowerCase()} thing everyone's asking about — let's actually test it.` },
    { shot: "Over-the-shoulder at the bathroom shelf", line: `Two drops, press don't rub. That's the step people skip.` },
    { shot: "Mirror selfie, natural skin, mid-laugh", line: `A week in and my skin's just… calmer. No filter, promise.` },
    { shot: "Sitting on the counter, direct to camera", line: `If you try it, tag me — I read every one. ${who} out.` },
  ];
}
