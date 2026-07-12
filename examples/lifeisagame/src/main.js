// Citygame — a small, from-scratch Three.js city sandbox built around a THEME (skin) system.
// Everything visual reads from the active theme object, so swapping the theme reskins the whole
// world (sky, fog, lights, ground/roads, buildings, props). Small hand-made grid for now; the real
// Mumbai map + road network drop in later on the same engine. Scale is locked from the Higgs mockup:
// a person is ~half a car's length and clearly narrower than the road.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { initMissions } from "./missions.js";

// ---------------------------------------------------------------- themes (the skins)
// per-building-style arrays are indexed by style 0/1/2 (glass tower / mid-rise / low block)
const THEMES = {
  day: {
    label: "DAY", sky: 0x9fd6ef, fog: { c: 0xc4e3f4, n: 80, f: 280 }, sea: 0x3f83b0,
    ground: 0x9c968a, road: 0x74767c, line: 0xf4f1e6, curb: 0xb8ae98,
    wall: [0xafcdda, 0xd9b892, 0xcf9268], roof: [0x8ba6b6, 0x9a7a56, 0x8a5f44],
    glow: [0, 0, 0], glowI: 0, bloom: 0.0,
    amb: { c: 0xffffff, i: 0.82 }, key: { c: 0xfff0d2, i: 1.75 }, hemi: { sky: 0xbfe6ff, gnd: 0x7a6a52, i: 0.55 },
    trees: true, carBody: 0xff5fa2,
  },
  night: {
    label: "NIGHT", sky: 0x0b0920, fog: { c: 0x150b28, n: 45, f: 175 }, sea: 0x081029,
    ground: 0x181432, road: 0x3a3557, line: 0x9a97c8, curb: 0x363150,
    wall: [0x152136, 0x241026, 0x13273a], roof: [0x0b1626, 0x170a1c, 0x0b1b2c],
    glow: [0x4defd8, 0xff74b0, 0xffd27a], glowI: 1.0, bloom: 0.95,
    amb: { c: 0x483c66, i: 0.7 }, key: { c: 0x7a5cb0, i: 0.5 }, hemi: { sky: 0x2c2156, gnd: 0x0d0820, i: 0.3 },
    trees: false, carBody: 0xff5fa2,
  },
};
let themeName = "night", T = THEMES[themeName];  // default to Night for the facade-tile test

// ---------------------------------------------------------------- Marine Drive district: the iconic curved coast boulevard
const SIZE = 600;                                // scene span (world units) — big enough that inland districts stream in as you move
const MD = { z0: 14, z1: 206, midX: 140, bow: 52, roadW: 13, promW: 6 };
const INLAND0 = 150;                             // x where the inland block districts begin (east of the drive)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const centerX = (z) => MD.midX - MD.bow * Math.sin(Math.PI * (clamp(z, MD.z0, MD.z1) - MD.z0) / (MD.z1 - MD.z0)); // the C-curve
const coastX = (z) => centerX(z) - MD.roadW / 2 - MD.promW;   // shoreline (outer edge of the promenade)

// ---------------------------------------------------------------- renderer / scene / iso camera
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio)); // cap resolution — fill-rate win (bloom + transparent facades) while staying crisp
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById("stage").appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fog = new THREE.Fog(T.fog.c, T.fog.n, T.fog.f); scene.fog = fog;

const VIEW = 24, VIEW_FLY = 150;                 // third-person street zoom → wide aerial when the car climbs
// third-person follow: ortho + a FIXED offset behind-and-above the player. The camera only translates
// to keep the player centred (the world scrolls under it). ~40° elevation + ~30° yaw = a proper
// angled 3rd-person view (not top-down), while keeping the player clear of most street-level occluders.
const CAM = new THREE.Vector3(24, 38, 40);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
let viewCur = VIEW;
function applyView(v) { const a = innerWidth / innerHeight; camera.left = -v * a / 2; camera.right = v * a / 2; camera.top = v / 2; camera.bottom = -v / 2; camera.updateProjectionMatrix(); }
let composer = null, bloom = null;
function resize() { applyView(viewCur); renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight); }
addEventListener("resize", resize); resize();

// bloom — only bright emissive (lit windows, neon) blooms; strength comes from the theme (0 in day)
composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), T.bloom, 0.7, 0.82);
composer.addPass(bloom);
composer.setSize(innerWidth, innerHeight);

// ---------------------------------------------------------------- lights (themeable)
const amb = new THREE.AmbientLight(T.amb.c, T.amb.i); scene.add(amb);
const key = new THREE.DirectionalLight(T.key.c, T.key.i); key.position.set(-0.5, 1, 0.35).multiplyScalar(60); scene.add(key);
const hemi = new THREE.HemisphereLight(T.hemi.sky, T.hemi.gnd, T.hemi.i); scene.add(hemi);

// ---------------------------------------------------------------- inland block grid (deterministic + global, so streamed chunks always agree)
// Blocks of VARYING size: column/row edges come from a hash sequence, streets between them. Each block later
// gets a CLUSTER of buildings. This same data drives the ground paint, collision, and the streamed meshes.
const bhash = (i, s = 0) => { let h = Math.imul(((i | 0) ^ Math.imul(s | 0, 2654435761)) >>> 0, 2246822519); h = Math.imul(h ^ (h >>> 15), 3266489917); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const ROADW = 7;
function blockAxis(start, end, minB, varB, salt) { const a = []; let p = start, i = 0; while (p + minB < end) { const w = Math.min(minB + bhash(i, salt) * varB, end - p); a.push({ p, w }); p += w + ROADW; i++; } return a; }
const COLS = blockAxis(INLAND0, SIZE - 3, 18, 30, 11);   // block columns (x), varying widths
const ROWS = blockAxis(3, SIZE - 3, 20, 34, 23);         // block rows (z), varying heights
function eachBlock(fn) { for (let i = 0; i < COLS.length; i++) for (let j = 0; j < ROWS.length; j++) fn(COLS[i].p, ROWS[j].p, COLS[i].w, ROWS[j].w, i, j); }
// a block's cluster of buildings — count/height/style vary per block: some a single tower, some a dense low huddle
function clusterOf(bx, bz, bw, bh, i, j) {
  const out = [], seed = i * 131 + j * 977, r = (k) => bhash(seed, k * 7 + 3);
  const kind = r(0);                                      // 0..1 → tower / mid cluster / dense low
  let lc = kind < 0.16 ? 1 : Math.max(1, Math.round(bw / (kind < 0.5 ? 16 : 11)));
  let lr = kind < 0.16 ? 1 : Math.max(1, Math.round(bh / (kind < 0.5 ? 16 : 11)));
  const lw = bw / lc, lh = bh / lr;
  const dom = r(1) < 0.5 ? 1 : r(1) < 0.74 ? 2 : r(1) < 0.9 ? 0 : 3;   // block-dominant facade style
  for (let a = 0; a < lc; a++) for (let b = 0; b < lr; b++) {
    const rr = (k) => bhash(seed + a * 17 + b * 61, k * 13 + 5);
    if (lc * lr > 1 && rr(0) < 0.14) continue;            // courtyard gap inside the cluster
    const pad = 0.7 + rr(1) * 1.3, w = lw - pad * 2, d = lh - pad * 2;
    if (w < 3 || d < 3) continue;
    const style = rr(2) < 0.72 ? dom : (rr(3) * 4) | 0;   // mostly the block style, a little variety
    const h = kind < 0.16 ? 22 + rr(3) * 18 : kind < 0.5 ? 12 + rr(2) * 12 : 7 + rr(1) * 7;
    out.push({ x: bx + a * lw + lw / 2, z: bz + b * lh + lh / 2, w, d, h, style });
  }
  return out;
}

// ---------------------------------------------------------------- ground (one canvas texture, repainted per theme)
const GPX = 4, GW = SIZE * GPX;
const gcv = document.createElement("canvas"); gcv.width = gcv.height = GW;
const gctx = gcv.getContext("2d");
const gtex = new THREE.CanvasTexture(gcv);
gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = 4; gtex.magFilter = THREE.LinearFilter;
function paintGround() {
  const c = gctx, hex = (n) => "#" + n.toString(16).padStart(6, "0");
  const sea = hex(T.sea), land = hex(T.ground), road = hex(T.road), prom = hex(T.curb), line = hex(T.line);
  // paint row by row so the coastline + boulevard follow the curve
  for (let pz = 0; pz < GW; pz++) {
    const z = pz / GPX, cx = centerX(z), rW0 = (cx - MD.roadW / 2) * GPX, rW1 = (cx + MD.roadW / 2) * GPX, cX = coastX(z) * GPX;
    c.fillStyle = sea; c.fillRect(0, pz, cX, 1);                       // sea (west of the shore)
    c.fillStyle = prom; c.fillRect(cX, pz, rW0 - cX, 1);              // promenade
    c.fillStyle = road; c.fillRect(rW0, pz, rW1 - rW0, 1);           // boulevard
    c.fillStyle = land; c.fillRect(rW1, pz, GW - rW1, 1);            // land / blocks (east)
    if ((pz % (GPX * 2)) < GPX) {                                     // dashed lane dividers, one per carriageway
      c.fillStyle = line;
      c.fillRect((cx - MD.roadW / 3.2) * GPX - 1, pz, 2, 1);
      c.fillRect((cx + MD.roadW / 3.2) * GPX - 1, pz, 2, 1);
    }
    c.fillStyle = "#33422f"; c.fillRect(cx * GPX - GPX * 0.75, pz, GPX * 1.5, 1);            // planted central median
    c.fillStyle = "#c9c4b0"; c.fillRect(cx * GPX - GPX * 0.85, pz, GPX * 0.12, 1); c.fillRect(cx * GPX + GPX * 0.73, pz, GPX * 0.12, 1); // pale kerbs
    c.fillStyle = prom; c.fillRect(cX - 2, pz, 3, 1);                 // shoreline lip
  }
  // inland districts: an asphalt carpet east of INLAND0, then each block stamped back as land + sidewalk (gaps = streets)
  const gx0 = INLAND0 * GPX; c.fillStyle = road; c.fillRect(gx0, 0, GW - gx0, GW);
  const sw = Math.max(1, Math.round(GPX * 0.6));
  eachBlock((bx, bz, bw, bh) => {
    c.fillStyle = prom; c.fillRect(bx * GPX - sw, bz * GPX - sw, bw * GPX + sw * 2, bh * GPX + sw * 2);
    c.fillStyle = land; c.fillRect(bx * GPX, bz * GPX, bw * GPX, bh * GPX);
  });
  c.fillStyle = line;                                                 // dashed centre-lines down the avenues
  for (const C of COLS) { const lx = Math.round((C.p + C.w + ROADW / 2) * GPX); for (let py = 0; py < GW; py += GPX * 2) c.fillRect(lx, py, 1, GPX); }
  gtex.needsUpdate = true;
}
paintGround();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshBasicMaterial({ map: gtex })); // unlit so roads read at full brightness
ground.rotation.x = -Math.PI / 2; ground.position.set(SIZE / 2, 0, SIZE / 2); scene.add(ground);
// open sea to the horizon, west of the painted shoreline
const seaMat = new THREE.MeshBasicMaterial({ color: T.sea });
const seaPlane = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), seaMat);
seaPlane.rotation.x = -Math.PI / 2; seaPlane.position.set(-350, -0.2, SIZE / 2); scene.add(seaPlane);
// subtle sea shimmer — a slow-scrolling field of faint glints over the water
const shimCv = document.createElement("canvas"); shimCv.width = shimCv.height = 128;
{ const c = shimCv.getContext("2d"); for (let i = 0; i < 46; i++) { const gx = Math.random() * 128, gy = Math.random() * 128, r = 2 + Math.random() * 3, g = c.createRadialGradient(gx, gy, 0, gx, gy, r); g.addColorStop(0, "rgba(190,215,255,0.85)"); g.addColorStop(1, "rgba(190,215,255,0)"); c.fillStyle = g; c.beginPath(); c.arc(gx, gy, r, 0, 7); c.fill(); } }
const shimTex = new THREE.CanvasTexture(shimCv); shimTex.wrapS = shimTex.wrapT = THREE.RepeatWrapping; shimTex.repeat.set(28, 28);
const shimmer = new THREE.Mesh(new THREE.PlaneGeometry(680, 900), new THREE.MeshBasicMaterial({ map: shimTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
shimmer.rotation.x = -Math.PI / 2; shimmer.position.set(-250, 0.03, SIZE / 2); scene.add(shimmer);

// ---------------------------------------------------------------- buildings (block-clusters — collision resident, meshes streamed)
// A building spec is { x, z, w, d, h, style } (w=x-size, d=z-size). Collision is a cheap grid marked for the
// WHOLE world at load; the actual meshes stream in per chunk (below), so the world can be big without cost.
const SOLID = new Uint8Array(SIZE * SIZE);
const markSolid = (cx, cz, sx, sz) => { for (let z = Math.max(0, (cz - sz / 2) | 0); z <= Math.min(SIZE - 1, (cz + sz / 2) | 0); z++) for (let x = Math.max(0, (cx - sx / 2) | 0); x <= Math.min(SIZE - 1, (cx + sx / 2) | 0); x++) SOLID[z * SIZE + x] = 1; };
const blocked = (x, z) => x < 1 || z < 1 || x >= SIZE - 1 || z >= SIZE - 1 || x < coastX(z) + 1.5 || SOLID[(z | 0) * SIZE + (x | 0)] === 1;
// Art-Deco frontage lining the drive (resident — the hero row, always visible along the curve)
const frontageSpecs = [];
for (let z = MD.z0 + 3; z < MD.z1 - 3; z += 7) {
  const east = centerX(z) + MD.roadW / 2 + 2.5, i = (z / 7) | 0;
  const w = 6 + bhash(i, 41) * 3, d = 6 + bhash(i, 42) * 4, h = 9 + bhash(i, 43) * 7, x = east + w / 2;
  if (x < INLAND0 - 3) frontageSpecs.push({ x, z, w, d, h, style: 3 });
}
// resident collision for EVERYTHING (marking a grid is cheap): frontage + every inland block's cluster
frontageSpecs.forEach((s) => markSolid(s.x, s.z, s.w, s.d));
eachBlock((bx, bz, bw, bh, i, j) => clusterOf(bx, bz, bw, bh, i, j).forEach((s) => markSolid(s.x, s.z, s.w, s.d)));
const dummy = new THREE.Object3D();
// GTA2/gbhx model: buildings are textured blocks. Detail lives in the tile art — real Mumbai
// facade textures (image-generated) mapped onto the block sides; per-building UVs tile them so
// windows stay the right size on any building, while all buildings of a style SHARE one texture.
const texLoader = new THREE.TextureLoader();
function facadeTex(url) { const t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; return t; }
const FACADES = [facadeTex("./assets/facade_glass.png"), facadeTex("./assets/facade_apartment.png"), facadeTex("./assets/facade_colonial.png"), facadeTex("./assets/facade_artdeco.png")]; // 0 glass · 1 apt · 2 colonial · 3 art-deco
const TEXW = 9, TEXH = 15;                                            // world units one facade tile spans
const facMats = FACADES.map((tex) => new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: T.glowI, roughness: 0.9, metalness: 0.0 }));
const ROOFSIZE = 15;                                                 // world units one roof tile spans
const roofTex = facadeTex("./assets/roof_night.png");
const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, emissive: 0xffffff, emissiveMap: roofTex, emissiveIntensity: T.glowI * 0.7, roughness: 0.95, metalness: 0.0 });
// scale side-face UVs (facade) and top-face UVs (roof) so tiles stay the right size on any building
function tileBoxUV(geo, rW, rD, rH, rTW, rTD) {
  const uv = geo.attributes.uv, mul = (i, ru, rv) => uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
  for (let i = 0; i < 4; i++) mul(i, rD, rH);        // +x face (spans depth)
  for (let i = 4; i < 8; i++) mul(i, rD, rH);        // -x face
  for (let i = 8; i < 12; i++) mul(i, rTW, rTD);     // +y face (roof)
  for (let i = 16; i < 20; i++) mul(i, rW, rH);      // +z face (spans width)
  for (let i = 20; i < 24; i++) mul(i, rW, rH);      // -z face
  uv.needsUpdate = true;
}
const CULL_BUFFER = 14;                                               // render this far past the frame edge, so frustum-culled buildings never pop
// build one building mesh from a spec into `group`
function buildOne(s, group) {
  const geo = new THREE.BoxGeometry(s.w, s.h, s.d);
  tileBoxUV(geo, Math.max(1, Math.round(s.w / TEXW)), Math.max(1, Math.round(s.d / TEXW)), Math.max(1, Math.round(s.h / TEXH)), Math.max(1, Math.round(s.w / ROOFSIZE)), Math.max(1, Math.round(s.d / ROOFSIZE)));
  geo.computeBoundingSphere(); geo.boundingSphere.radius += CULL_BUFFER;
  const m = new THREE.Mesh(geo, [facMats[s.style], facMats[s.style], roofMat, roofMat, facMats[s.style], facMats[s.style]]);
  m.position.set(s.x, s.h / 2, s.z); group.add(m);
}
// frontage is resident (the hero drive); inland streams
const frontageGroup = new THREE.Group(); scene.add(frontageGroup);
frontageSpecs.forEach((s) => buildOne(s, frontageGroup));

// ---------------------------------------------------------------- procedural streaming: inland block meshes load/unload around the player
// Chunks build/dispose as you move. LOAD radius < UNLOAD radius → a 1-chunk hysteresis buffer, so nothing
// pops in or out at the edge of view (holds on foot, driving, and flying). Collision + ground are already
// resident, so streaming only ever touches GPU meshes.
const CHUNK = 110, LOAD_R = 2, UNLOAD_R = 3;
const loaded = new Map();                                            // "i,j" -> THREE.Group
function buildChunk(ci, cj) {
  const g = new THREE.Group(), x0 = ci * CHUNK, z0 = cj * CHUNK, x1 = x0 + CHUNK, z1 = z0 + CHUNK;
  for (let i = 0; i < COLS.length; i++) { const C = COLS[i]; if (C.p + C.w < x0 || C.p > x1) continue;
    for (let j = 0; j < ROWS.length; j++) { const Rr = ROWS[j]; if (Rr.p + Rr.w < z0 || Rr.p > z1) continue;
      for (const s of clusterOf(C.p, Rr.p, C.w, Rr.w, i, j)) if (s.x >= x0 && s.x < x1 && s.z >= z0 && s.z < z1) buildOne(s, g);   // a building belongs to the chunk holding its centre
    } }
  scene.add(g); loaded.set(ci + "," + cj, g);
}
function disposeChunk(k) { const g = loaded.get(k); if (!g) return; g.traverse((o) => o.isMesh && o.geometry.dispose()); scene.remove(g); loaded.delete(k); }
let lastCI = null, lastCJ = null;
function streamUpdate(px, pz) {
  const ci = Math.floor(px / CHUNK), cj = Math.floor(pz / CHUNK);
  if (ci === lastCI && cj === lastCJ) return; lastCI = ci; lastCJ = cj;   // only re-evaluate when the player crosses into a new chunk
  for (let i = ci - LOAD_R; i <= ci + LOAD_R; i++) for (let j = cj - LOAD_R; j <= cj + LOAD_R; j++) { if (i < 0 || j < 0) continue; const k = i + "," + j; if (!loaded.has(k)) buildChunk(i, j); }
  for (const k of [...loaded.keys()]) { const [i, j] = k.split(",").map(Number); if (Math.abs(i - ci) > UNLOAD_R || Math.abs(j - cj) > UNLOAD_R) disposeChunk(k); }
}
window.__world = { COLS, ROWS, clusterOf, get loaded() { return [...loaded.keys()]; } };

const treeGroup = new THREE.Group(); scene.add(treeGroup); // (promenade palms come later)
// the "Queen's Necklace" — the string of warm lamps that traces Marine Drive's curve
{
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0 }), poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2440 });
  const pts = [];
  for (let z = MD.z0; z <= MD.z1; z += 2.4) pts.push([coastX(z) + 1.4, z]);
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 8, 8), lampMat, pts.length);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 3, 5), poleMat, pts.length);
  pts.forEach(([x, z], i) => { dummy.scale.set(1, 1, 1); dummy.position.set(x, 3.2, z); dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix); dummy.position.set(x, 1.5, z); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix); });
  lamps.instanceMatrix.needsUpdate = poles.instanceMatrix.needsUpdate = true; lamps.frustumCulled = false; poles.frustumCulled = false;
  scene.add(lamps, poles);
}
// the promenade: a low sea wall along the shoreline + benches where people sit facing the sea
{
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x5a5570 }), benchMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });
  const wallPts = [], benchPts = [];
  for (let z = MD.z0; z <= MD.z1; z += 2.6) wallPts.push([coastX(z) + 0.5, z]);
  for (let z = MD.z0 + 4; z <= MD.z1 - 2; z += 7) benchPts.push([coastX(z) + 2.6, z]);
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1.0, 2.7), wallMat, wallPts.length);
  wallPts.forEach(([x, z], i) => { dummy.scale.set(1, 1, 1); dummy.position.set(x, 0.5, z); dummy.updateMatrix(); walls.setMatrixAt(i, dummy.matrix); });
  walls.instanceMatrix.needsUpdate = true; walls.frustumCulled = false; scene.add(walls);
  const benches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.5, 1.7), benchMat, benchPts.length);
  benchPts.forEach(([x, z], i) => { dummy.position.set(x, 0.28, z); dummy.updateMatrix(); benches.setMatrixAt(i, dummy.matrix); });
  benches.instanceMatrix.needsUpdate = true; scene.add(benches);
}
// trees — real Marine Drive is lined with big leafy trees (half-hiding the buildings) + drooping palms; planted median too
{
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3f28 }), leafMat = new THREE.MeshLambertMaterial({ color: 0x3f6f3a }), palmMat = new THREE.MeshLambertMaterial({ color: 0x4e8f45 });
  const leafy = [], palms = [], med = [];
  for (let z = MD.z0; z <= MD.z1; z += 5) leafy.push([centerX(z) + MD.roadW / 2 + 1.7, z]);   // sidewalk in front of the buildings
  for (let z = MD.z0 + 3; z <= MD.z1; z += 8) palms.push([coastX(z) + 3.4, z]);                // promenade palms
  for (let z = MD.z0 + 2; z <= MD.z1; z += 4) med.push([centerX(z), z]);                        // median shrubs
  const reset = () => dummy.rotation.set(0, 0, 0);
  const lt = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.42, 3.4, 6), trunkMat, leafy.length);
  const lc = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 0), leafMat, leafy.length);
  leafy.forEach(([x, z], i) => { reset(); dummy.scale.set(1, 1, 1); dummy.position.set(x, 1.7, z); dummy.updateMatrix(); lt.setMatrixAt(i, dummy.matrix); dummy.position.set(x, 4.7, z); dummy.scale.set(1, 0.9, 1); dummy.updateMatrix(); lc.setMatrixAt(i, dummy.matrix); });
  // palms: thin trunk + a crown of drooping fronds (cones splayed out and down)
  const pt = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.3, 6.6, 6), trunkMat, palms.length);
  const frondGeo = new THREE.ConeGeometry(0.42, 3.4, 4); frondGeo.translate(0, 1.7, 0); frondGeo.rotateX(Math.PI / 2); // base at crown, tip splays outward
  const pf = new THREE.InstancedMesh(frondGeo, palmMat, palms.length * 7);
  let fk = 0;
  palms.forEach(([x, z], i) => {
    reset(); dummy.scale.set(1, 1, 1); dummy.position.set(x, 3.3, z); dummy.updateMatrix(); pt.setMatrixAt(i, dummy.matrix);
    for (let f = 0; f < 7; f++) { dummy.position.set(x, 6.5, z); dummy.rotation.set(0.55, (f / 7) * Math.PI * 2 + i, 0); dummy.updateMatrix(); pf.setMatrixAt(fk++, dummy.matrix); }
  });
  const mb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 0), leafMat, med.length);
  med.forEach(([x, z], i) => { reset(); dummy.scale.set(1, 0.7, 1); dummy.position.set(x, 0.5, z); dummy.updateMatrix(); mb.setMatrixAt(i, dummy.matrix); });
  [lt, lc, pt, pf, mb].forEach((m) => { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; scene.add(m); });
}

// ---------------------------------------------------------------- landmarks: real 3D monuments (image→GLB, loaded at runtime)
const gltf = new GLTFLoader();
function loadLandmark(url, x, z, targetH, headingDeg = 0) {
  gltf.load(url, (g) => {
    const obj = g.scene;
    let box = new THREE.Box3().setFromObject(obj); const size = new THREE.Vector3(); box.getSize(size);
    obj.scale.setScalar(targetH / size.y);                       // normalise to a target height
    box = new THREE.Box3().setFromObject(obj); const c = new THREE.Vector3(); box.getCenter(c);
    obj.position.set(x - c.x, -box.min.y, z - c.z);              // centre on (x,z), sit on the ground
    obj.rotation.y = headingDeg * Math.PI / 180;
    obj.traverse((o) => { if (o.isMesh && o.material) { o.material.roughness = 0.85; o.material.metalness = 0.0; } });
    scene.add(obj);
  }, undefined, (e) => console.warn("[landmark] load failed:", url, e?.message || e));
}
// (district landmarks placed per-district; Marine Drive's hero is the necklace + the drive itself)

// ---------------------------------------------------------------- sprites: character + car (locked scale)
function spriteFrom(draw, w, h, wU, hU) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"));
  const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true })); s.scale.set(wU, hU, 1); s.center.set(0.5, 0);
  return s;
}
// player character — a rigged, walk-animated 3D model (image→3D→rig→animation)
const PLAYER_H = 2.2;                                                 // world-unit height
let playerModel = null, mixer = null, walkAction = null, runAction = null, runW = 0, charFootY = 0;
gltf.load("./assets/character.glb", (g) => {
  playerModel = g.scene;
  let box = new THREE.Box3().setFromObject(playerModel); const sz = new THREE.Vector3(); box.getSize(sz);
  playerModel.scale.setScalar(PLAYER_H / (sz.y || 1));
  box = new THREE.Box3().setFromObject(playerModel); charFootY = -box.min.y;   // drop feet to ground
  playerModel.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; if (o.material) o.material.roughness = 0.8; } });
  scene.add(playerModel);
  if (g.animations && g.animations.length) {
    const clip = g.animations[0];
    clip.tracks = clip.tracks.filter((t) => !t.name.endsWith(".position")); // strip root motion → walk plays in place; our code drives world position
    mixer = new THREE.AnimationMixer(playerModel); walkAction = mixer.clipAction(clip); walkAction.play();
    // separate RUN clip (generated via the rig-animation pipeline), bound to the same skeleton by bone name
    gltf.load("./assets/character_run.glb", (rg) => {
      const rc = rg.animations && rg.animations[0]; if (!rc || !mixer) return;
      rc.tracks = rc.tracks.filter((t) => !t.name.endsWith(".position"));
      runAction = mixer.clipAction(rc); runAction.play(); runAction.setEffectiveWeight(0);
    }, undefined, (e) => console.warn("[run] load failed", e?.message || e));
  }
  window.__cg && (window.__cg.model = playerModel);
  window.__anim = { count: g.animations.length, names: g.animations.map((a) => a.name), tracks: (g.animations[0]?.tracks || []).map((t) => t.name) };
}, undefined, (e) => console.warn("[character] load failed", e?.message || e));

// top-down car, laid flat — 2.2 wide × 4.2 long. body colour comes from the theme.
// car — a real 3D model (image→3D). carGroup is the transform; the mesh lives inside, nose toward -Z at heading 0.
const carGroup = new THREE.Group(); scene.add(carGroup);
const CAR_LEN = 4.4, CAR_FACE = -Math.PI / 2;                        // face offset so the nose (not the rear) points -Z at heading 0
gltf.load("./assets/car.glb", (g) => {
  const m = g.scene;
  let box = new THREE.Box3().setFromObject(m); const sz = new THREE.Vector3(); box.getSize(sz);
  m.scale.setScalar(CAR_LEN / Math.max(sz.x, sz.z));
  box = new THREE.Box3().setFromObject(m); const c = new THREE.Vector3(); box.getCenter(c);
  const pivot = new THREE.Group(); pivot.rotation.y = CAR_FACE; pivot.add(m);
  m.position.set(-c.x, -box.min.y, -c.z);                            // centre footprint, wheels at y=0
  m.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; if (o.material) o.material.roughness = 0.5; } });
  carGroup.add(pivot);
}, undefined, (e) => console.warn("[car] load failed", e?.message || e));
const carShadow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
carShadow.rotation.x = -Math.PI / 2; scene.add(carShadow);

// ---------------------------------------------------------------- state + input
const startZ = 104, startX = centerX(startZ);                                        // on the boulevard, mid-curve
const player = { x: startX, y: startZ, moving: false, fx: 0, fz: -1 }; // fx,fz = facing/heading
const car = { x: startX + 3, z: startZ, heading: 0, speed: 0, alt: 0, flyTo: 0 };
let mode = "walk", camAlt = 0, camYaw = 0;                            // camera orbit (yaw); fixed elevation
// chase-camera angle presets (toggle with C). d = distance behind, h = height above → elevation = atan(h/d).
const CAM_PRESETS = [{ d: 26, h: 20, look: 2 }, { d: 18, h: 6.5, look: 3 }]; // ~38° high · ~20° low + closer to the player
let camPreset = 0, camD = 26, camH = 20, camLook = 2;                 // smoothed toward the active preset
let mX = 0.5;                                                         // normalised cursor X (for edge-continue turning)
const keys = {};
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase(); keys[k] = true;
  if (k === "t") toggleTheme();
  if (k === "e" && mode === "walk" && missions.tryInteract()) return; // talk to a nearby colleague/vendor (else E orbits)
  if (k === "f") interact();                                         // enter/exit car (Q/E now rotate the camera)
  if (k === " " && mode === "drive" && !car.flyTo) car.flyTo = 1;
  if (k === "x" && mode === "drive" && car.flyTo) car.flyTo = 0;
  if (k === "c") camPreset = (camPreset + 1) % CAM_PRESETS.length;   // cycle chase-camera angle
});
addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
// mouse aims the camera (modern-GTA): the cursor's position steers the camera — off-centre = keep
// turning (full 360°, no cap, works on a trackpad); vertical = look up/down. No pointer-lock needed.
addEventListener("mousemove", (e) => { if (mode !== "walk") return; mX = e.clientX / innerWidth; camYaw -= (e.movementX || 0) * 0.0045; });
function interact() {
  if (mode === "drive") { if (car.alt < 0.1) { mode = "walk"; player.x = car.x + 1.6; player.y = car.z; } return; }
  if (Math.hypot(player.x - car.x, player.y - car.z) < 4) mode = "drive";
}

// ---------------------------------------------------------------- theme switch
function toggleTheme() { themeName = themeName === "day" ? "night" : "day"; T = THEMES[themeName]; applyTheme(); }
function applyTheme() {
  scene.background = new THREE.Color(T.sky);
  fog.color.setHex(T.fog.c); fog.near = T.fog.n; fog.far = T.fog.f;
  amb.color.setHex(T.amb.c); amb.intensity = T.amb.i;
  key.color.setHex(T.key.c); key.intensity = T.key.i;
  hemi.color.setHex(T.hemi.sky); hemi.groundColor.setHex(T.hemi.gnd); hemi.intensity = T.hemi.i;
  paintGround();
  seaMat.color.setHex(T.sea);
  facMats.forEach((m) => { m.emissiveIntensity = T.glowI; });        // facade tiles glow at night, plain in day
  roofMat.emissiveIntensity = T.glowI * 0.7;
  if (bloom) bloom.strength = T.bloom;
  treeGroup.visible = T.trees;
  document.querySelector("#theme .name").textContent = T.label;
}
applyTheme();

// ---------------------------------------------------------------- missions (the game layer: colleagues/vendors, GTA tasks, agent drafting)
const missions = initMissions({ THREE, scene, camera, getPlayer: () => player, getMode: () => mode, blocked });

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const busy = missions.isBusy(); missions.update();                  // update NPC markers / waypoint; freeze the world when a mission panel is open
  streamUpdate(mode === "drive" ? car.x : player.x, mode === "drive" ? car.z : player.y);   // load/unload inland districts around the player

  shimTex.offset.y += 0.02 * dt; shimTex.offset.x += 0.006 * dt;      // drift the sea shimmer
  const ax = (keys["d"] || keys["arrowright"] ? 1 : 0) - (keys["a"] || keys["arrowleft"] ? 1 : 0);
  const ay = (keys["s"] || keys["arrowdown"] ? 1 : 0) - (keys["w"] || keys["arrowup"] ? 1 : 0);

  if (mode === "walk" && !busy) {
    // move relative to the camera orbit (modern-GTA): W = away from camera, A/D = strafe
    const fX = -Math.sin(camYaw), fZ = -Math.cos(camYaw), rX = Math.cos(camYaw), rZ = -Math.sin(camYaw);
    const wv = (keys["w"] || keys["arrowup"] ? 1 : 0) - (keys["s"] || keys["arrowdown"] ? 1 : 0);
    const sv = (keys["d"] || keys["arrowright"] ? 1 : 0) - (keys["a"] || keys["arrowleft"] ? 1 : 0);
    let mx = fX * wv + rX * sv, mz = fZ * wv + rZ * sv; const ml = Math.hypot(mx, mz);
    player.moving = ml > 0;
    if (player.moving) {
      mx /= ml; mz /= ml; const sp = (keys["shift"] ? 9 : 4.5) * dt;
      const nx = player.x + mx * sp, nz = player.y + mz * sp;          // collide: slide along walls, no walking through
      if (!blocked(nx, player.y)) player.x = nx;
      if (!blocked(player.x, nz)) player.y = nz;
      player.fx = mx; player.fz = mz;
    }
    if (playerModel) {
      playerModel.visible = true; playerModel.position.set(player.x, charFootY, player.y);
      playerModel.rotation.y = Math.atan2(player.fx, player.fz);     // face heading (flip by PI if model faces away)
    }
    // blend walk ↔ run: crossfade to the real run clip when sprinting (fall back to a faster walk until it loads)
    if (walkAction) {
      const running = player.moving && keys["shift"];
      runW += ((running && runAction ? 1 : 0) - runW) * (1 - Math.exp(-12 * dt));
      walkAction.paused = !player.moving; walkAction.timeScale = runAction ? 1 : (keys["shift"] ? 1.7 : 1);
      walkAction.setEffectiveWeight(1 - runW);
      if (runAction) { runAction.paused = !player.moving; runAction.setEffectiveWeight(runW); }
    }
  } else {
    car.alt += (car.flyTo - car.alt) * (1 - Math.exp(-2.6 * dt));
    const flying = car.flyTo === 1 || car.alt > 0.1;
    if (ay < 0) car.speed += (car.speed < 0 ? 26 : 15) * dt; else if (ay > 0) car.speed -= (car.speed > 0 ? 24 : 10) * dt; else car.speed *= Math.exp(-(flying ? 0.5 : 1.4) * dt);
    car.speed = Math.max(-6, Math.min(flying ? 26 : 15, car.speed));
    if (Math.abs(car.speed) < 0.2 && ay === 0) car.speed = 0;
    const grip = Math.min(1, Math.abs(car.speed) / 6);
    car.heading += ax * (flying ? 1.7 : 2.4) * grip * dt * (car.speed < 0 ? -1 : 1);
    const cnx = car.x + Math.sin(car.heading) * car.speed * dt, cnz = car.z - Math.cos(car.heading) * car.speed * dt;
    if (flying) { car.x = clamp(cnx, 1, SIZE - 1); car.z = clamp(cnz, 1, SIZE - 1); }        // airborne: no collision
    else { if (!blocked(cnx, car.z)) car.x = cnx; else car.speed *= 0.25; if (!blocked(car.x, cnz)) car.z = cnz; else car.speed *= 0.25; }
    camYaw += (((-car.heading - camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (1 - Math.exp(-4 * dt)); // swing directly BEHIND the car
    if (playerModel) playerModel.visible = false;
  }
  if (mixer) mixer.update(dt);
  carGroup.position.set(car.x, 0.1 + car.alt * 14, car.z); carGroup.rotation.y = -car.heading;
  carShadow.position.set(car.x + car.alt * 4, 0.04, car.z); carShadow.scale.setScalar(1 - car.alt * 0.35); carShadow.material.opacity = 0.28 * (1 - car.alt * 0.5);

  if (mode === "walk" && !busy) {
    if (keys["q"]) camYaw += 2.0 * dt; if (keys["e"]) camYaw -= 2.0 * dt;   // keyboard orbit (full 360°)
    const edge = mX < 0.06 ? -(0.06 - mX) / 0.06 : mX > 0.94 ? (mX - 0.94) / 0.06 : 0; // keep turning at screen edges (no cap)
    camYaw -= edge * 3.5 * dt;
  }
  const tx = mode === "drive" ? car.x : player.x, tz = mode === "drive" ? car.z : player.y;
  camAlt += ((mode === "drive" ? car.alt : 0) - camAlt) * (1 - Math.exp(-3 * dt));
  // third-person orbit: camera sits behind the player at camYaw (mouse-aimed on foot, auto-behind when driving)
  const cp = CAM_PRESETS[camPreset], sm = 1 - Math.exp(-7 * dt);      // ease toward the chosen angle preset
  camD += (cp.d - camD) * sm; camH += (cp.h - camH) * sm; camLook += (cp.look - camLook) * sm;
  const D = camD * (1 + camAlt * 1.1), H = camH * (1 + camAlt * 1.4);
  camera.position.set(tx + Math.sin(camYaw) * D, H, tz + Math.cos(camYaw) * D); camera.lookAt(tx, camLook, tz);
  viewCur = VIEW + (VIEW_FLY - VIEW) * camAlt; applyView(viewCur);

  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug
window.__cg = { get theme() { return themeName; }, toggleTheme, player, car, THEMES, get mode() { return mode; }, get camYaw() { return camYaw; }, set camYaw(v) { camYaw = v; }, keys };
