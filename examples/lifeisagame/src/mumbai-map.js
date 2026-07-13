// mumbai-map.js — the game map is the REAL shape of Mumbai: its coastline silhouette + the 24 municipal
// wards (our "districts"/areas), projected from lat/lng into a compact game world. This is the foundation —
// roads, density and buildings get layered on top of these areas later.
import GEO from "./mumbai-wards.json";
import LM from "./mumbai-landmarks.json";
import ROADDATA from "./mumbai-roads.json";

// the 24 BMC ward codes → neighbourhood names. Split wards (E/W, N/S) are the SAME place, so the game
// groups them into one named AREA — fewer, cleaner districts than 24 wards (e.g. M/E + M/W = Chembur).
export const WARD_NAME = {
  A: "Colaba–Fort", B: "Dongri", C: "Marine Lines", D: "Malabar Hill", E: "Byculla",
  "F/S": "Parel", "F/N": "Matunga", "G/S": "Worli", "G/N": "Dadar", "H/E": "Bandra East / BKC",
  "H/W": "Bandra West", "K/E": "Andheri East", "K/W": "Andheri West / Juhu", L: "Kurla",
  "M/E": "Govandi", "M/W": "Chembur", N: "Ghatkopar", "P/S": "Goregaon", "P/N": "Malad",
  "R/S": "Kandivali", "R/C": "Borivali", "R/N": "Dahisar", S: "Powai–Bhandup", T: "Mulund",
};
// wards merged into game AREAS (one district per row); first ward is the "anchor" for the name
export const AREA_OF = { A: "South Mumbai", B: "South Mumbai", C: "South Mumbai", D: "Marine Drive", E: "Byculla",
  "F/S": "Parel", "F/N": "Matunga", "G/S": "Worli", "G/N": "Dadar", "H/E": "Bandra", "H/W": "Bandra",
  "K/E": "Andheri", "K/W": "Andheri", L: "Kurla", "M/E": "Chembur", "M/W": "Chembur", N: "Ghatkopar",
  "P/S": "Goregaon", "P/N": "Malad", "R/S": "North Suburbs", "R/C": "North Suburbs", "R/N": "North Suburbs", S: "Powai", T: "Mulund" };

const [BW, BS, BE, BN] = GEO.bbox;                    // lng-min, lat-min, lng-max, lat-max
const LAT0 = (BS + BN) / 2, LNG0 = (BW + BE) / 2;
const M_LAT = 110900, M_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180); // metres per degree at Mumbai's latitude

// scale the whole city down to a playable map (keep aspect); north maps to -z so up-screen = north.
const TARGET_H = 1300, MARGIN = 40;                   // world units: map height + sea border (≈2.5× — rooms enough blocks per area for game-sized people/cars)
const hM = (BN - BS) * M_LAT, wM = (BE - BW) * M_LNG;
const SCALE = TARGET_H / hM;
const wMs = wM * SCALE, hMs = hM * SCALE;
const OX = wMs / 2 + MARGIN, OZ = hMs / 2 + MARGIN;
export const WORLD = { w: wMs + 2 * MARGIN, h: hMs + 2 * MARGIN };
export const project = (lng, lat) => [(lng - LNG0) * M_LNG * SCALE + OX, (LAT0 - lat) * M_LAT * SCALE + OZ];
const projRing = (ring) => ring.map(([lng, lat]) => project(lng, lat));

// projected geometry (world-space polygons)
export const COAST = GEO.coast.map(projRing);         // [0] = the main landmass outline
export const WARDS = GEO.wards.map((w) => {
  const parts = w.parts.map((p) => ({ shell: projRing(p.shell), holes: (p.holes || []).map(projRing) }));
  // area-weighted-ish centroid from the biggest part's shell (for labels / placing things in an area)
  const big = parts.reduce((a, b) => (b.shell.length > a.shell.length ? b : a), parts[0]).shell;
  let cx = 0, cz = 0; for (const [x, z] of big) { cx += x; cz += z; } cx /= big.length; cz /= big.length;
  return { name: w.name, parts, centroid: [cx, cz] };
});

// ---------------------------------------------------------------- hit tests
function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export const isLand = (x, z) => inRing(x, z, COAST[0]);
function partHas(x, z, part) { if (!inRing(x, z, part.shell)) return false; for (const h of part.holes) if (inRing(x, z, h)) return false; return true; }
export function wardAt(x, z) { for (const w of WARDS) for (const p of w.parts) if (partHas(x, z, p)) return w.name; return null; }
export const wardByName = Object.fromEntries(WARDS.map((w) => [w.name, w]));

// the game AREA (merged district) at a world point
export const areaAt = (x, z) => { const w = wardAt(x, z); return w ? AREA_OF[w] || WARD_NAME[w] || w : null; };

// landmarks → world points (the anchors for the iconic buildings we hand-place per area). Curated + geocoded,
// grouped by game area. Coastal ones (Marine Drive, beaches, Sea Link) may sit right at the water edge.
export const LANDMARKS = LM.features.map((f) => ({
  name: f.properties.name, area: f.properties.area, category: f.properties.category, type: f.properties.type,
  ward: f.properties.bmc_ward, pos: project(f.geometry.coordinates[0], f.geometry.coordinates[1]),
}));

// major road network (OSM motorway/trunk + key arterials) → world-space polylines. cls: expressway|highway|arterial.
export const ROADS = ROADDATA.roads.map((r) => ({ name: r.name, cls: r.cls, pts: r.pts.map(([lng, lat]) => project(lng, lat)) }));

// a guaranteed-on-land spawn near a given ward (falls back to a spiral search from its centroid)
export function spawnIn(name) {
  const w = wardByName[name] || WARDS[0];
  let [x, z] = w.centroid;
  if (isLand(x, z) && wardAt(x, z) === w.name) return [x, z];
  for (let r = 2; r < 200; r += 2) for (let a = 0; a < 8; a++) {
    const px = x + Math.cos((a / 8) * 6.283) * r, pz = z + Math.sin((a / 8) * 6.283) * r;
    if (isLand(px, pz)) return [px, pz];
  }
  return [x, z];
}
