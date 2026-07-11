/* LIFE IS A GAME — engine skeleton (step 1).
 *
 * The ONE architectural law (this is the perf fix, learned the hard way):
 *   - The map is small and FULLY RESIDENT. Every tile is baked ONCE into a single
 *     background canvas at load. Nothing streams. No chunk cache, no LRU eviction.
 *   - The render loop NEVER creates/resizes/draws-TO a canvas. It only drawImage()s
 *     FROM pre-baked canvases.
 *   - Plain top-down FOLLOW camera — translate only. No rotation, zoom, or skew.
 *   - Zero per-frame allocation. No console.log in the loop.
 * If you ever feel the need to profile to save the frame budget, the architecture is
 * wrong — the world should be obviously fast with no tricks.
 */

// ---------- fixed internal resolution (scaled up, pixelated) ----------
const VW = 480, VH = 270, TILE = 16;

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// deterministic RNG so the "fixed" map is identical every load
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- palette (neon night) ----------
const C = {
  asphalt: "#14092a", asphalt2: "#1b0d37", lane: "#3a2a63",
  walk: "#241241", walkEdge: "#3a1f5e",
  grass: "#15321f", grass2: "#1c3f28",
  water: "#0e2b46", water2: "#123a5e",
  bldg: "#241040", bldgFace: "#2f1652", bldgTop: "#3a1f66",
  win: "#ffcf6b", winCool: "#2de1c2", winPink: "#ff5fa2",
  neon: "#ff5fa2", trunk: "#2b1a12", leaf: "#1f6f4a",
};

// ---------- the map (small, fixed, generated once from a constant seed) ----------
const MW = 48, MH = 32;               // tiles — a few screens, still tiny
const ground = new Uint8Array(MW * MH);
const solid = new Uint8Array(MW * MH);
const idx = (x, y) => y * MW + x;

// ground codes
const G_ASPHALT = 0, G_WALK = 1, G_GRASS = 2, G_WATER = 3, G_BLDG = 4;

function buildMap() {
  const rng = mulberry32(20260711);
  // base everything to grass, then lay a road grid, sidewalks, building blocks, a river.
  ground.fill(G_GRASS);
  // river along the top three rows
  for (let y = 0; y < 3; y++) for (let x = 0; x < MW; x++) { ground[idx(x, y)] = G_WATER; solid[idx(x, y)] = 1; }
  // road grid: vertical roads every 12 tiles, horizontal every 9 (2 tiles wide)
  const isRoad = (x, y) => (x % 12 === 0 || x % 12 === 1 || y % 9 === 4 || y % 9 === 5);
  for (let y = 3; y < MH; y++) for (let x = 0; x < MW; x++) if (isRoad(x, y)) ground[idx(x, y)] = G_ASPHALT;
  // sidewalks: any grass tile orthogonally adjacent to a road becomes walk
  for (let y = 3; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (ground[idx(x, y)] !== G_GRASS) continue;
    if ((x > 0 && ground[idx(x - 1, y)] === G_ASPHALT) || (x < MW - 1 && ground[idx(x + 1, y)] === G_ASPHALT) ||
        (y > 3 && ground[idx(x, y - 1)] === G_ASPHALT) || (y < MH - 1 && ground[idx(x, y + 1)] === G_ASPHALT))
      ground[idx(x, y)] = G_WALK;
  }
  // building blocks: fill interior grass patches (not walk, not road) with buildings, leaving a 1-tile plaza sometimes
  for (let y = 4; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    if (ground[idx(x, y)] !== G_GRASS) continue;
    if (rng() < 0.82) { ground[idx(x, y)] = G_BLDG; solid[idx(x, y)] = 1; }
  }
  // scatter a few trees on remaining grass (walkable-around: mark solid)
  for (let y = 4; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (ground[idx(x, y)] === G_GRASS && rng() < 0.12) solid[idx(x, y)] = 2; // 2 = tree
  }
}

// ---------- bake the whole map into ONE canvas (called exactly once) ----------
let mapCv = null;
function bakeMap() {
  const cv = document.createElement("canvas");
  cv.width = MW * TILE; cv.height = MH * TILE;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  const rng = mulberry32(999);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const px = x * TILE, py = y * TILE, code = ground[idx(x, y)];
    if (code === G_WATER) {
      g.fillStyle = C.water; g.fillRect(px, py, TILE, TILE);
      g.fillStyle = C.water2; if ((x + y) % 2 === 0) g.fillRect(px + 3, py + 6, 6, 2);
    } else if (code === G_ASPHALT) {
      g.fillStyle = ((x + y) & 1) ? C.asphalt : C.asphalt2; g.fillRect(px, py, TILE, TILE);
      // faint lane dashes down the middle of vertical roads
      if (x % 12 === 0) { g.fillStyle = C.lane; g.fillRect(px + TILE - 1, py + 4, 1, 6); }
    } else if (code === G_WALK) {
      g.fillStyle = C.walk; g.fillRect(px, py, TILE, TILE);
      g.fillStyle = C.walkEdge; g.fillRect(px, py, TILE, 1);
    } else if (code === G_GRASS) {
      g.fillStyle = ((x * 3 + y) % 3 === 0) ? C.grass2 : C.grass; g.fillRect(px, py, TILE, TILE);
    } else if (code === G_BLDG) {
      // flat top-down block with a south-facing lit face + a neon-window grid.
      g.fillStyle = C.bldgTop; g.fillRect(px, py, TILE, TILE);
      g.fillStyle = C.bldg; g.fillRect(px + 1, py + 1, TILE - 2, TILE - 3);
      // the "face" hint: a brighter strip along the bottom (south) edge
      g.fillStyle = C.bldgFace; g.fillRect(px + 1, py + TILE - 3, TILE - 2, 2);
      // windows: a few lit cells, colour picked deterministically
      for (let wy = 0; wy < 3; wy++) for (let wx = 0; wx < 3; wx++) {
        const r = rng();
        if (r < 0.45) continue;
        g.fillStyle = r < 0.7 ? C.win : r < 0.88 ? C.winCool : C.winPink;
        g.fillRect(px + 3 + wx * 4, py + 3 + wy * 4, 2, 2);
      }
    }
    // trees (solid code 2) on grass
    if (solid[idx(x, y)] === 2) {
      g.fillStyle = C.trunk; g.fillRect(px + TILE / 2 - 1, py + TILE - 6, 2, 5);
      g.fillStyle = C.leaf; g.fillRect(px + 3, py + 2, TILE - 6, 8);
      g.fillStyle = "#2b8a5e"; g.fillRect(px + 5, py + 3, 3, 3);
    }
  }
  return cv;
}

// ---------- bake the player: 4 dirs × 3 walk frames, once ----------
const DIR_DOWN = 0, DIR_UP = 1, DIR_LEFT = 2, DIR_RIGHT = 3;
const SPR_W = 12, SPR_H = 16;
let playerFrames = null; // [dir][frame] -> canvas

function bakeChar(colors) {
  const c = colors || {};
  const skin = c.skin || "#e6b48c", hair = c.hair || "#2b2026", shirt = c.shirt || "#ff5fa2",
    pants = c.pants || "#2de1c2", shoe = c.shoe || "#141018";
  const dirs = [];
  for (let d = 0; d < 4; d++) {
    const frames = [];
    for (let f = 0; f < 3; f++) {
      const cv = document.createElement("canvas");
      cv.width = SPR_W; cv.height = SPR_H;
      const g = cv.getContext("2d");
      const legOff = f === 1 ? -1 : f === 2 ? 1 : 0; // walk swing
      // head
      g.fillStyle = hair; g.fillRect(3, 0, 6, 4);
      g.fillStyle = skin; g.fillRect(4, 2, 4, 3);
      if (d === DIR_DOWN) { g.fillStyle = "#141018"; g.fillRect(4, 3, 1, 1); g.fillRect(7, 3, 1, 1); }
      if (d === DIR_UP) { g.fillStyle = hair; g.fillRect(3, 1, 6, 4); }
      // torso
      g.fillStyle = shirt; g.fillRect(3, 5, 6, 6);
      // arms
      g.fillStyle = skin;
      if (d === DIR_LEFT) g.fillRect(2, 6, 2, 4);
      else if (d === DIR_RIGHT) g.fillRect(8, 6, 2, 4);
      else { g.fillRect(2, 6, 2, 4); g.fillRect(8, 6, 2, 4); }
      // legs (swing)
      g.fillStyle = pants;
      g.fillRect(3 + legOff, 11, 2, 4);
      g.fillRect(7 - legOff, 11, 2, 4);
      g.fillStyle = shoe;
      g.fillRect(3 + legOff, 15, 2, 1);
      g.fillRect(7 - legOff, 15, 2, 1);
      frames.push(cv);
    }
    dirs.push(frames);
  }
  return dirs;
}

// ---------- NPCs + missions (content ported from the stashed build; dummy for v1) ----------
const NPCS = {
  ravi: { name: "Ravi", role: "packaging vendor", skin: "#c68a5a", hair: "#2b2026", shirt: "#ffb56b", pants: "#3a2a4a", portraitBg: "#3a2410" },
};
const MISSIONS = [
  {
    id: "vendor-quote", title: "Counter the vendor quote", npc: "ravi", channel: "whatsapp", state: "available",
    hook: "Boss! Final numbers: 18% off locks at 5k MOQ. You keep saying 4k — send me something in writing today and I'll push my guy before he flies to Guangzhou.",
    reward: { cash: 420, rep: 18 },
    options: [
      { rec: true, label: "Counter firm at 4k MOQ — same 18%, cite the Piqual reorder", draftTitle: "WhatsApp → Ravi", drafts: [
        "Ravi — let's close this today. 4k MOQ at the same 18%: you know the Piqual reorder landed 3 weeks early, so volume risk on our side is basically zero. Lock 4k now and I'll commit the festive run to you exclusively. Deal memo tonight?",
        "Ravi bhai — 4k at 18% and we sign today. Piqual reorders came early, Haazma festive run is confirmed — you'll clear 5k across the quarter anyway, just not in one PO. Exclusive festive commitment from us if your guy says yes before his flight.",
      ] },
      { label: "Accept 5k MOQ — take the discount, split delivery", draftTitle: "WhatsApp → Ravi", drafts: [
        "Ravi — okay, 5k at 18% works IF we split delivery: 3k now, 2k post-Diwali, payment on each drop. Send the revised PI today and it's done.",
        "Done at 5k/18% on one condition — staggered delivery, 3k + 2k, invoice per drop. Confirm and I'll send the PO tonight.",
      ] },
      { label: "Stall a week — waiting on the Haazma volumes", draftTitle: "WhatsApp → Ravi", drafts: [
        "Ravi — don't let him board that flight angry 😄 I need 5 working days: Haazma confirms festive volumes Friday and that decides whether I'm at 4k or 6k. Hold the 18% till then and I'll make it worth the wait.",
        "One week, Ravi. Haazma's festive numbers land Friday — could push me PAST 5k. Hold the price till the 18th and you get the bigger order.",
      ] },
    ],
    doneToast: "✉ <b>Reply drafted</b> (dummy) — vendor task closed. In the real build this lands in WhatsApp as a draft you already approved.",
    doneLine: "Ravi: sorted, boss. My guy is happy. 🤝",
  },
];
const missionById = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

// game mode + progression
let mode = "walk";     // "walk" | "scene"
let tick = 0;          // frame counter for the cheap sprite bob
const save = { cash: 0, rep: 0, done: [] };
function updateStats() { $("cash").textContent = save.cash; $("rep").textContent = save.rep; }
function updateObjective() {
  const m = MISSIONS.find((x) => x.state === "available");
  $("objective").innerHTML = m ? `next: <b>${m.title}</b> · ${NPCS[m.npc].name}` : `Life is a Game · <b>all tasks closed</b>`;
}

// The world is a GRAPH of small baked maps. `maps` holds them all; the active map's
// art/collision/npcs/portals live in the globals below (swapped, not re-pointed, on transition).
const maps = {};             // id -> { id, name, cv, solidData, npcDefs, portals, spawn }
let activeMapId = null;
const npcs = [];             // active map's live npc entities
let portals = [];            // active map's portals (doors / exits)
let nearTarget = null;       // { type:"npc"|"portal", ... } the thing E acts on
// fade transition between maps (the ONE primitive doors + flight + interiors all reuse)
let fade = 0, fadeState = "none", pendingMapId = null, pendingSpawn = null;

// toast feedback
let toastTimer = 0;
function toast(html, ms = 4200) {
  const el = $("toast"); el.innerHTML = html; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// each frame (walk mode): pick the nearest thing to interact with — an NPC to talk to, or a
// portal to step through — and show the [E] prompt for it.
function updateInteractions() {
  nearTarget = null;
  const promptEl = $("prompt");
  if (mode !== "walk") { promptEl.hidden = true; return; }
  let best = Infinity, label = "";
  for (const n of npcs) {
    const m = missionById[n.missionId];
    if (!m || m.state !== "available") continue;
    const dx = n.x - player.x, dy = (n.y - 6) - player.y, d = dx * dx + dy * dy;
    if (d < 26 * 26 && d < best) { best = d; nearTarget = { type: "npc", npc: n }; label = ` talk to ${n.name}`; }
  }
  for (const p of portals) {
    const dx = p.x * TILE + TILE / 2 - player.x, dy = p.y * TILE + TILE / 2 - player.y, d = dx * dx + dy * dy;
    if (d < 22 * 22 && d < best) { best = d; nearTarget = { type: "portal", portal: p }; label = p.kind === "exit" ? " leave" : ` enter ${p.label || "building"}`; }
  }
  if (nearTarget) { $("prompt-text").textContent = label; promptEl.hidden = false; }
  else promptEl.hidden = true;
}

// ---------- canvas + camera ----------
const canvas = $("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

function resize() {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VW, window.innerHeight / VH)));
  canvas.width = VW; canvas.height = VH;
  canvas.style.width = VW * scale + "px";
  canvas.style.height = VH * scale + "px";
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);

// ---------- player state ----------
const player = { x: 6 * TILE, y: 12 * TILE, vx: 0, vy: 0, dir: DIR_DOWN, anim: 0, moving: false };
const FEET_W = 8, FEET_H = 5; // collision box at the character's feet

function tileSolidAt(px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return true;
  return solid[idx(tx, ty)] !== 0;
}
function feetBlocked(nx, ny) {
  const left = nx - FEET_W / 2, right = nx + FEET_W / 2, top = ny - FEET_H, bot = ny;
  return tileSolidAt(left, top) || tileSolidAt(right, top) || tileSolidAt(left, bot) || tileSolidAt(right, bot);
}

// ---------- input (no allocation in loop; keys is a fixed object) ----------
const keys = { w: false, a: false, s: false, d: false, shift: false };
const keymap = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", ArrowUp: "w", ArrowLeft: "a", ArrowDown: "s", ArrowRight: "d", ShiftLeft: "shift", ShiftRight: "shift" };
addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) return; // typing ≠ playing
  const k = keymap[e.code]; if (k) { keys[k] = true; e.preventDefault(); }
  if (e.code === "KeyF") toggleFps();
  if (e.code === "KeyE" && mode === "walk" && nearTarget) {
    if (nearTarget.type === "npc") openMission(missionById[nearTarget.npc.missionId]);
    else goToMap(nearTarget.portal.to, nearTarget.portal.spawn);
  }
  if (e.code === "Escape" && mode === "scene") closeScene();
});
addEventListener("keyup", (e) => { const k = keymap[e.code]; if (k) keys[k] = false; });

// ---------- fps / worst-frame meter ----------
const fpsEl = $("fps");
let showFps = new URLSearchParams(location.search).has("fps");
let lastT = performance.now(), fpsAcc = 0, fpsFrames = 0, fpsVal = 0, worstMoving = 0, worstWindow = 0, worstT = 0;
function toggleFps() { showFps = !showFps; fpsEl.hidden = !showFps; }
function updateFps(now, dt) {
  fpsAcc += dt; fpsFrames++;
  if (player.moving) worstWindow = Math.max(worstWindow, dt);
  if (now - worstT > 1000) {
    worstT = now; worstMoving = worstWindow; worstWindow = 0;
    fpsVal = Math.round((fpsFrames * 1000) / fpsAcc); fpsAcc = 0; fpsFrames = 0;
  }
  if (!showFps) return;
  const bad = worstMoving > 16;
  fpsEl.innerHTML = `<b>${fpsVal}</b> fps\nworst(mv) <span class="${bad ? "bad" : ""}">${worstMoving.toFixed(1)}ms</span>`;
}

// ---------- update + render ----------
const ACCEL = 0.9, FRICTION = 0.78, MAXV = 1.7, RUN = 2.7;

function update(dt) {
  if (mode !== "walk") { player.moving = false; return; } // a mission panel is modal — freeze the world
  const max = keys.shift ? RUN : MAXV;
  let ax = 0, ay = 0;
  if (keys.a) ax -= 1; if (keys.d) ax += 1; if (keys.w) ay -= 1; if (keys.s) ay += 1;
  if (ax || ay) { const inv = 1 / Math.hypot(ax, ay); ax *= inv; ay *= inv; }
  player.vx = clamp(player.vx + ax * ACCEL, -max, max);
  player.vy = clamp(player.vy + ay * ACCEL, -max, max);
  if (!ax) player.vx *= FRICTION;
  if (!ay) player.vy *= FRICTION;
  if (Math.abs(player.vx) < 0.02) player.vx = 0;
  if (Math.abs(player.vy) < 0.02) player.vy = 0;

  // move with per-axis collision so we slide along walls
  let nx = player.x + player.vx;
  if (!feetBlocked(nx, player.y)) player.x = nx; else player.vx = 0;
  let ny = player.y + player.vy;
  if (!feetBlocked(player.x, ny)) player.y = ny; else player.vy = 0;

  const speed = Math.hypot(player.vx, player.vy);
  player.moving = speed > 0.15;
  if (player.moving) {
    if (Math.abs(player.vx) > Math.abs(player.vy)) player.dir = player.vx > 0 ? DIR_RIGHT : DIR_LEFT;
    else player.dir = player.vy > 0 ? DIR_DOWN : DIR_UP;
    player.anim += speed * 0.06;
  } else player.anim = 0;
}

// reusable scratch — never reallocated in the loop
let camX = 0, camY = 0;
const MAP_PX_W = MW * TILE, MAP_PX_H = MH * TILE;

function render() {
  // follow camera: translate only, clamped so we never show past the map edge
  camX = clamp(Math.round(player.x - VW / 2), 0, MAP_PX_W - VW);
  camY = clamp(Math.round(player.y - VH / 2), 0, MAP_PX_H - VH);

  // 1) the whole pre-baked map, one drawImage
  ctx.drawImage(mapCv, camX, camY, VW, VH, 0, 0, VW, VH);

  // 1b) glowing entrance circles on the ground (drawn under sprites)
  const pulse = 0.35 + 0.2 * Math.sin(tick * 0.1);
  for (let i = 0; i < portals.length; i++) {
    const p = portals[i];
    const gx = Math.round(p.x * TILE + TILE / 2 - camX), gy = Math.round(p.y * TILE + TILE / 2 - camY);
    ctx.fillStyle = p.kind === "exit" ? "#2de1c2" : (portalHot(p) ? "#c8f250" : "#8a7bbf");
    ctx.globalAlpha = pulse;
    ctx.beginPath(); ctx.arc(gx, gy, 9 + Math.sin(tick * 0.1) * 1.6, 0, 6.29); ctx.fill();
    ctx.globalAlpha = Math.min(1, pulse + 0.45);
    ctx.beginPath(); ctx.arc(gx, gy, 2.4, 0, 6.29); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 2) NPCs (static; from their own pre-baked frames) + a bobbing "!" over open missions
  for (let i = 0; i < npcs.length; i++) {
    const n = npcs[i];
    const nsx = Math.round(n.x - SPR_W / 2 - camX), nsy = Math.round(n.y - SPR_H - camY);
    ctx.drawImage(n.frames[n.dir][0], nsx, nsy);
    const m = missionById[n.missionId];
    if (m && m.state === "available") {
      const bob = Math.round(Math.sin(tick * 0.12) * 1.5);
      ctx.fillStyle = "#c8f250";
      ctx.fillRect(nsx + SPR_W / 2 - 1, nsy - 7 + bob, 2, 4);
      ctx.fillRect(nsx + SPR_W / 2 - 1, nsy - 1 + bob, 2, 2);
    }
  }

  // 3) the player sprite from a pre-baked frame
  const frame = player.moving ? (Math.floor(player.anim) % 2 === 0 ? 1 : 2) : 0;
  const spr = playerFrames[player.dir][frame];
  ctx.drawImage(spr, Math.round(player.x - SPR_W / 2 - camX), Math.round(player.y - SPR_H - camY));

  // 4) the fade veil for map transitions (drawn over everything)
  if (fade > 0) { ctx.fillStyle = `rgba(6,3,16,${fade})`; ctx.fillRect(0, 0, VW, VH); }
}

function loop(now) {
  const dt = Math.min(50, now - lastT); lastT = now; // clamp: a backgrounded tab shouldn't teleport the player
  tick++;
  stepFade(dt);
  update(dt / 16.67); // normalize to ~60fps units
  updateInteractions();
  render();
  updateFps(now, dt);
  requestAnimationFrame(loop);
}

// ---------- mission scene: BRIEF → DECIDE → DRAFT → SEND (ported from the stashed build) ----------
const sceneEl = $("scene"), scText = $("sc-text"), scOptions = $("sc-options"), scDraft = $("sc-draft");
const draftTitle = $("draft-title"), draftBody = $("draft-body"), draftActions = $("draft-actions"), splashEl = $("splash");
let activeMission = null, activeOption = null, draftVariant = 0, typer = null, partIdx = 0;
const relay = null; // not connected yet → canned drafts (real streaming lands when Switchboard is wired)

function setStep(n) {
  document.querySelectorAll("#sc-steps span").forEach((el, i) => { el.className = i < n ? "done" : i === n ? "on" : ""; });
}
function currentParts() { return activeOption.parts || [{ title: activeOption.draftTitle, drafts: activeOption.drafts }]; }
function cancelType() { if (typer) { clearInterval(typer.id); typer = null; } }
function typeInto(el, text, cps, done) {
  cancelType();
  el.innerHTML = "";
  const cursor = document.createElement("span"); cursor.className = "cursor";
  const span = document.createElement("span");
  el.append(span, cursor);
  let i = 0; const step = Math.max(1, Math.round(cps / 30));
  const id = setInterval(() => {
    i = Math.min(text.length, i + step); span.textContent = text.slice(0, i);
    if (i >= text.length) { cancelType(); cursor.remove(); done && done(); }
  }, 33);
  typer = { id, finish: () => { span.textContent = text; cancelType(); cursor.remove(); done && done(); } };
}
function drawPortrait(npcKey) {
  const pc = $("sc-portrait").getContext("2d"); pc.imageSmoothingEnabled = false;
  pc.clearRect(0, 0, 16, 16);
  pc.fillStyle = NPCS[npcKey].portraitBg || "#241040"; pc.fillRect(0, 0, 16, 16);
  const n = npcs.find((x) => x.id === npcKey);
  if (n) pc.drawImage(n.frames[DIR_DOWN][0], 2, 0, SPR_W, SPR_H, 2, 1, SPR_W, SPR_H);
}
function openMission(m) {
  if (!m || m.state !== "available") return;
  activeMission = m; activeOption = null; draftVariant = 0; partIdx = 0;
  mode = "scene"; player.vx = player.vy = 0; player.moving = false;
  $("prompt").hidden = true;
  sceneEl.hidden = false;
  scOptions.innerHTML = ""; scDraft.hidden = true; draftActions.hidden = true; $("sc-hint").hidden = true;
  setStep(0); drawPortrait(m.npc);
  $("sc-name").textContent = NPCS[m.npc].name;
  $("sc-role").textContent = NPCS[m.npc].role;
  $("sc-channel").textContent = m.channel;
  typeInto(scText, m.hook, 46, () => { setStep(1); showOptions(m); });
  scText.onclick = () => typer && typer.finish();
}
function showOptions(m) {
  scOptions.innerHTML = "";
  m.options.forEach((opt, idx) => {
    const b = document.createElement("button");
    if (opt.rec) b.className = "rec";
    b.innerHTML = `<span class="pick">${idx + 1}</span>`;
    b.appendChild(document.createTextNode(opt.label));
    b.onclick = () => chooseOption(m, opt);
    scOptions.appendChild(b);
  });
  const own = document.createElement("button");
  own.className = "own";
  own.innerHTML = `<span class="pick">✎</span>type your own direction`;
  own.onclick = () => {
    scOptions.innerHTML = ""; scDraft.hidden = false; draftActions.hidden = true;
    $("notes-row").hidden = false; $("draft-agent-text").textContent = "tell me the angle — I'll draft to it";
    draftTitle.textContent = ""; draftBody.textContent = ""; $("notes-in").focus();
  };
  scOptions.appendChild(own);
}
function chooseOption(m, opt) {
  activeOption = opt; draftVariant = 0; partIdx = 0;
  setStep(2); scOptions.innerHTML = ""; scDraft.hidden = false; draftActions.hidden = true;
  $("notes-row").hidden = true; $("sc-hint").hidden = false;
  $("draft-agent-text").textContent = relay ? "your agent is drafting…" : "your agent is drafting… (canned — connect Switchboard for the real thing)";
  typeDraft();
}
function typeDraft(bodyOverride) {
  const parts = currentParts(), part = parts[partIdx];
  draftActions.hidden = true;
  draftTitle.textContent = part.title;
  const body = bodyOverride || part.drafts[draftVariant % part.drafts.length];
  typeInto(draftBody, body, 60, () => {
    draftActions.hidden = false; setStep(3);
    const more = partIdx < parts.length - 1;
    $("draft-approve").textContent = more ? `✓ approve · next (${partIdx + 1}/${parts.length})` : "✓ approve & send";
    $("draft-agent-text").textContent = more ? `part ${partIdx + 1} of ${parts.length} — your call` : "draft ready — your call";
  });
  $("draft-paper").onclick = () => typer && typer.finish();
}
function redraftWithNotes() {
  const notes = $("notes-in").value.trim(); if (!notes) return;
  $("notes-row").hidden = true; $("notes-in").value = "";
  if (!activeOption) chooseOption(activeMission, activeMission.options.find((o) => o.rec) || activeMission.options[0]);
  $("draft-agent-text").textContent = `noted — “${notes.slice(0, 60)}${notes.length > 60 ? "…" : ""}” · reworking`;
  draftVariant++; typeDraft(); // canned: cycle the other variant. real note-driven redraft comes with relay.
}
function closeScene() {
  cancelType(); sceneEl.hidden = true;
  $("notes-row").hidden = true; $("notes-in").value = "";
  mode = "walk"; activeMission = null; activeOption = null; partIdx = 0;
}
function completeMission(m) {
  if (!save.done.includes(m.id)) { save.done.push(m.id); save.cash += m.reward.cash; save.rep += m.reward.rep; }
  m.state = "done";
  updateStats(); updateObjective(); closeScene();
  $("splash-sub").innerHTML = `+$${m.reward.cash} · +${m.reward.rep} REP · <em>draft created — task closed</em>`;
  splashEl.hidden = false; requestAnimationFrame(() => splashEl.classList.add("show"));
  setTimeout(() => { splashEl.classList.remove("show"); setTimeout(() => (splashEl.hidden = true), 300); }, 2300);
  setTimeout(() => toast(m.doneToast, 5200), 2400);
}
$("draft-approve").onclick = () => {
  if (!activeMission || !activeOption) return;
  const parts = currentParts();
  if (partIdx < parts.length - 1) { partIdx++; draftVariant = 0; setStep(2); $("draft-agent-text").textContent = "on it — next part…"; typeDraft(); }
  else completeMission(activeMission);
};
$("draft-tweak").onclick = () => { draftVariant++; typeDraft(); };
$("draft-cancel").onclick = closeScene;
$("draft-notes").onclick = () => { $("notes-row").hidden = !$("notes-row").hidden; if (!$("notes-row").hidden) $("notes-in").focus(); };
$("notes-send").onclick = redraftWithNotes;

// ---------- boot ----------
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// find a walkable tile nearest a target — so a sloppy spawn never lands inside a wall
function findWalkable(tx, ty) {
  for (let r = 0; r < 24; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = tx + dx, y = ty + dy;
    if (x >= 0 && y >= 0 && x < MW && y < MH && solid[idx(x, y)] === 0) return [x, y];
  }
  return [tx, ty];
}

// ---------- map graph: swap the active map's art / collision / npcs / portals ----------
function applyMap(id) {
  const m = maps[id]; if (!m) return;
  activeMapId = id;
  mapCv = m.cv;
  solid.set(m.solidData);
  portals = m.portals;
  npcs.length = 0;
  for (const nd of m.npcDefs) {
    const def = NPCS[nd.id]; if (!def) continue;
    const [nx, ny] = findWalkable(nd.x, nd.y);
    const mission = MISSIONS.find((mm) => mm.npc === nd.id);
    nd._frames = nd._frames || bakeChar(def); // bake each NPC once, cache on its def
    npcs.push({ id: nd.id, name: def.name, role: def.role, x: nx * TILE + TILE / 2, y: ny * TILE + TILE, dir: nd.dir ?? DIR_DOWN, frames: nd._frames, missionId: mission ? mission.id : null });
  }
}
// a door glows "hot" (lime) when the map it leads to has an open mission
function portalHot(p) {
  const t = maps[p.to]; if (!t) return false;
  return t.npcDefs.some((nd) => { const m = MISSIONS.find((mm) => mm.npc === nd.id); return m && m.state === "available"; });
}
// the ONE transition primitive: fade out → swap map + reposition player → fade in
function goToMap(id, spawn) {
  if (fadeState !== "none" || !maps[id]) return;
  pendingMapId = id; pendingSpawn = spawn || maps[id].spawn;
  fadeState = "out"; mode = "transition"; $("prompt").hidden = true;
}
function stepFade(dt) {
  if (fadeState === "none") return;
  const sp = (dt / 16.67) * 0.09;
  if (fadeState === "out") {
    fade += sp;
    if (fade >= 1) {
      fade = 1; applyMap(pendingMapId);
      const [sx, sy] = findWalkable(pendingSpawn.x, pendingSpawn.y);
      player.x = sx * TILE + TILE / 2; player.y = sy * TILE + TILE; player.vx = player.vy = 0; player.moving = false;
      fadeState = "in";
    }
  } else {
    fade -= sp;
    if (fade <= 0) { fade = 0; fadeState = "none"; mode = "walk"; }
  }
}

// placeholder interior (programmer-art) — Ravi's shop, a small lit room in the dark
function makeInteriorMap() {
  const sd = new Uint8Array(MW * MH); sd.fill(1); // everything solid (the void) until we carve the room
  const cv = document.createElement("canvas"); cv.width = MW * TILE; cv.height = MH * TILE;
  const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
  g.fillStyle = "#0a0812"; g.fillRect(0, 0, cv.width, cv.height);
  const rng = mulberry32(7);
  const rx0 = 15, ry0 = 8, rx1 = 32, ry1 = 21, exx = 23;
  for (let y = ry0; y <= ry1; y++) for (let x = rx0; x <= rx1; x++) {
    const px = x * TILE, py = y * TILE, border = (x === rx0 || x === rx1 || y === ry0 || y === ry1);
    if (border) {
      g.fillStyle = "#4a3626"; g.fillRect(px, py, TILE, TILE);
      g.fillStyle = "#5e4632"; g.fillRect(px, py, TILE, 3);
      sd[y * MW + x] = 1;
    } else {
      g.fillStyle = ((x + y) & 1) ? "#6b5844" : "#5f4e3c"; g.fillRect(px, py, TILE, TILE);
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(px, py, TILE, 1);
      sd[y * MW + x] = 0;
    }
  }
  // shelves along the top interior wall (decor, solid)
  for (let x = rx0 + 1; x <= rx1 - 1; x++) {
    const px = x * TILE, py = (ry0 + 1) * TILE;
    g.fillStyle = "#3a2a1e"; g.fillRect(px, py, TILE, TILE - 2);
    g.fillStyle = ["#c85a3a", "#d9a441", "#3a8a5e", "#b0522f"][Math.floor(rng() * 4)];
    g.fillRect(px + 3, py + 4, TILE - 6, 5);
    sd[(ry0 + 1) * MW + x] = 1;
  }
  // a counter on the right (decor, solid)
  for (let y = ry0 + 4; y <= ry1 - 3; y++) for (let x = rx1 - 3; x <= rx1 - 1; x++) {
    const px = x * TILE, py = y * TILE;
    g.fillStyle = "#7a5a3a"; g.fillRect(px, py, TILE, TILE);
    g.fillStyle = "#9a7a4a"; g.fillRect(px, py, TILE, 3);
    sd[y * MW + x] = 1;
  }
  // exit doorway punched through the bottom wall (walkable opening + mat)
  for (const yy of [ry1, ry1 + 1]) { g.fillStyle = "#2a1e14"; g.fillRect(exx * TILE, yy * TILE, TILE, TILE); sd[yy * MW + exx] = 0; }
  g.fillStyle = "#c8a24a"; g.fillRect(exx * TILE + 3, ry1 * TILE + 6, TILE - 6, 6);
  return {
    id: "ravi_shop", name: "Ravi's shop", cv, solidData: sd,
    npcDefs: [{ id: "ravi", x: 23, y: 12, dir: DIR_DOWN }],
    portals: [{ x: exx, y: ry1 + 1, to: "street", kind: "exit", spawn: { x: 18, y: 17 } }],
    spawn: { x: 23, y: 20 },
  };
}

async function boot() {
  playerFrames = bakeChar();
  maps.ravi_shop = makeInteriorMap();
  let street;
  try {
    const m = await (await fetch("assets/mumbai.json", { cache: "no-store" })).json();
    const img = await loadImg(m.bg);
    const cv = document.createElement("canvas"); cv.width = MW * TILE; cv.height = MH * TILE;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, cv.width, cv.height);
    const sd = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++) { const row = m.collision[y]; for (let x = 0; x < MW; x++) if (row[x] === "#") sd[y * MW + x] = 1; }
    const ps = (m.npcSpawns || []).find((s) => s.id === "player") || { x: MW >> 1, y: MH >> 1 };
    const door = (m.npcSpawns || []).find((s) => s.id === "ravi") || { x: 18, y: 16 };
    // the street has no people standing around — just a glowing door where Ravi's shop is
    street = { id: "street", name: m.name, cv, solidData: sd, npcDefs: [],
      portals: [{ x: door.x, y: door.y, to: "ravi_shop", kind: "door", label: "Ravi's shop", spawn: maps.ravi_shop.spawn }],
      spawn: { x: ps.x, y: ps.y } };
  } catch (e) {
    buildMap(); const cv = bakeMap();
    street = { id: "street", name: "Street", cv, solidData: Uint8Array.from(solid), npcDefs: [],
      portals: [{ x: 8, y: 12, to: "ravi_shop", kind: "door", label: "Ravi's shop", spawn: maps.ravi_shop.spawn }],
      spawn: { x: 6, y: 12 } };
  }
  maps.street = street;
  applyMap("street");
  // snap the door + player onto reachable tiles now that street collision is active
  const d = portals[0]; const [dx, dy] = findWalkable(d.x, d.y); d.x = dx; d.y = dy;
  const [sx, sy] = findWalkable(street.spawn.x, street.spawn.y);
  player.x = sx * TILE + TILE / 2; player.y = sy * TILE + TILE;
  updateStats(); updateObjective();
  resize();
  fpsEl.hidden = !showFps;
  requestAnimationFrame((t) => { lastT = t; worstT = t; requestAnimationFrame(loop); });
}
boot();

// dev hook — lets us measure per-frame cost synchronously even when the preview tab is
// hidden (rAF is suspended on hidden tabs). Not part of the game.
window.__lig = {
  player, keys, update, render, TILE,
  get npcs() { return npcs; }, get mode() { return mode; }, get activeMapId() { return activeMapId; },
  get portals() { return portals; }, get nearTarget() { return nearTarget; }, missionById, MISSIONS,
  openMission, closeScene, goToMap,
  get fade() { return fade; },
  pump(n = 30) { for (let i = 0; i < n; i++) { stepFade(16.67); update(1); updateInteractions(); } return { mode, activeMapId, fade: +fade.toFixed(2) }; },
  solidAt: (tx, ty) => solid[idx(tx, ty)],
  feetBlocked,
  bench(n = 600) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { player.x += i % 90 < 45 ? 0.4 : -0.4; player.y += 0.15; update(1); render(); }
    return { msPerFrame: +((performance.now() - t0) / n).toFixed(3), frames: n };
  },
  // drive the player with a held direction for N steps and report where they end up
  walk(dir, steps = 120) {
    keys.w = keys.a = keys.s = keys.d = false;
    keys[dir] = true;
    for (let i = 0; i < steps; i++) update(1);
    keys[dir] = false;
    return { tileX: Math.floor(player.x / TILE), tileY: Math.floor(player.y / TILE) };
  },
};
