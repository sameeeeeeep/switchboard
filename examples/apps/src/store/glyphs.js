// Wrapp glyphs & thumbnails — a curated, consistent icon system for the warm store.
//
// This is CATALOG-ADJACENT design data (a fixed asset keyed by catalog id), never user data. Each
// wrapp gets a category family (soft tint bg + saturated ink, from DESIGN.md's category tints), a
// small inline-SVG glyph, and a thumbnail "motif" so the store band reads as one system. The
// pixel-icon set is a later refinement; a tasteful colored glyph tile is the interim per the plan.

/** Category families — DESIGN.md category tints + the play (violet) family from home-unified. */
export const FAM = {
  gold:   { ink: "#B4802A", soft: "#F2E8D2", light: "#E9C56B" }, // ads / founder / commerce
  green:  { ink: "#5E8B23", soft: "#E9F0DB", light: "#9FCB6E" }, // build / brand
  pink:   { ink: "#B54A78", soft: "#F0E7F1", light: "#E08CB0" }, // studio / photo / persona
  blue:   { ink: "#3A6EA5", soft: "#E7F0F6", light: "#7FB0E0" }, // review / doc / validate
  teal:   { ink: "#2E8B6A", soft: "#E7F1EC", light: "#7FC3AB" }, // chat / make
  violet: { ink: "#7B5EA8", soft: "#EDE8F3", light: "#B49BD8" }, // play / after-hours
};

// Reusable glyph markup (inner SVG for a 24×24, fill:none, stroke:currentColor tile).
// Exported so the taxonomy module can reuse the same shapes for category chrome icons.
export const G = {
  spark:  `<path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9Z"/>`,
  layers: `<path d="M12 3l8 4-8 4-8-4Z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/>`,
  bulb:   `<path d="M9 18h6"/><path d="M10 21h4"/><path d="M8 14a6 6 0 1 1 8 0c-.8.8-1 1.4-1 2H9c0-.6-.2-1.2-1-2Z"/>`,
  doc:    `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>`,
  chart:  `<path d="M4 20V5M4 20h16"/><path d="M7 16l3.5-4 3 2.2L20 8"/>`,
  camera: `<path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"/><circle cx="12" cy="13" r="3.2"/>`,
  person: `<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>`,
  play:   `<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5Z"/>`,
  box:    `<path d="M4 8l8-4 8 4v8l-8 4-8-4Z"/><path d="M4 8l8 4 8-4M12 12v8"/>`,
  grid:   `<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>`,
  chat:   `<path d="M4 5h16v11H9l-4 4V16H4Z"/>`,
  moon:   `<path d="M20 13.5A8 8 0 1 1 10.5 4a6.2 6.2 0 0 0 9.5 9.5Z"/>`,
  cards:  `<rect x="4" y="5" width="10" height="14" rx="2"/><path d="M9 5.4l6 1.6a2 2 0 0 1 1.4 2.5L14 19"/>`,
  tag:    `<path d="M4 11V5a1 1 0 0 1 1-1h6l9 9-7 7Z"/><circle cx="8" cy="8" r="1.4"/>`,
  pen:    `<path d="M4 20l4-1L19 8a2 2 0 0 0-3-3L5 16Z"/><path d="M14 6l3 3"/>`,
  landing:`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M8 13h8M8 16h5"/>`,
  huddle: `<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3Z"/>`,
  // ---- viral-wrapp factory glyphs (2026-07) ----
  pad:    `<rect x="2.5" y="8" width="19" height="9" rx="4.5"/><path d="M7 12.5h3M8.5 11v3"/><circle cx="15.5" cy="11.5" r="1.1"/><circle cx="17.5" cy="13.5" r="1.1"/>`,
  panel:  `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M13 4v8M11 12v8"/>`,
  book:   `<path d="M12 6.5C10 4.8 7.2 4.6 4 5.5v13c3.2-.9 6-.7 8 1 2-1.7 4.8-1.9 8-1v-13c-3.2-.9-6-.7-8 1Z"/><path d="M12 7.5v11"/>`,
  note:   `<circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="15" r="2.5"/><path d="M9.5 17V6l10-2v11"/>`,
  flame:  `<path d="M12 3c1 3.2 4 4.2 4 8a4 4 0 0 1-8 0c0-1.2.6-2.2 1.2-2.8C10 9.8 12 8.6 12 3Z"/>`,
  smile:  `<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4.2 4.2 0 0 0 7 0"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>`,
  paw:    `<circle cx="7" cy="9" r="1.7"/><circle cx="12" cy="7" r="1.7"/><circle cx="17" cy="9" r="1.7"/><path d="M12 12c-3 0-5 1.9-5 4.3S9 20 12 20s5-1 5-3.7S15 12 12 12Z"/>`,
  sofa:   `<rect x="3" y="11" width="18" height="6.5" rx="2"/><path d="M5 11V8.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V11M6 17.5v2M18 17.5v2"/>`,
  thumb:  `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5l5 2.5-5 2.5Z"/>`,
  meme:   `<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M7 8.5h10M8 16h8"/><circle cx="12" cy="12" r="2.1"/>`,
};

// id → { fam, glyph, motif }. motif keys the thumbnail composition (see MOTIF below).
export const GLYPHS = {
  brandbrain: { fam: "green",  glyph: G.layers, motif: "build" },
  ideabrain:  { fam: "blue",   glyph: G.bulb,   motif: "chart" },
  bank:       { fam: "teal",   glyph: G.doc,    motif: "doc" },

  mkt:        { fam: "blue",   glyph: G.chart,  motif: "chart" },
  capp:       { fam: "blue",   glyph: G.play,   motif: "chart" },
  saas:       { fam: "blue",   glyph: G.layers, motif: "chart" },
  retail:     { fam: "blue",   glyph: G.tag,    motif: "chart" },
  hardware:   { fam: "blue",   glyph: G.box,    motif: "chart" },
  feature:    { fam: "blue",   glyph: G.spark,  motif: "chart" },

  adpulse:    { fam: "gold",   glyph: G.chart,  motif: "chart" },
  adforge:    { fam: "gold",   glyph: G.spark,  motif: "spark" },
  shelf:      { fam: "gold",   glyph: G.box,    motif: "build" },
  studio:     { fam: "pink",   glyph: G.camera, motif: "shot" },
  aplus:      { fam: "gold",   glyph: G.tag,    motif: "spark" },
  batch:      { fam: "gold",   glyph: G.doc,    motif: "doc" },
  take:       { fam: "teal",   glyph: G.play,   motif: "shot" },
  identity:   { fam: "violet", glyph: G.person, motif: "shot" },
  reel:       { fam: "pink",   glyph: G.play,   motif: "shot" },
  marquee:    { fam: "blue",   glyph: G.landing,motif: "doc" },
  huddle:     { fam: "teal",   glyph: G.huddle, motif: "chat" },

  natal:      { fam: "violet", glyph: G.moon,   motif: "grid" },
  arcana:     { fam: "violet", glyph: G.cards,  motif: "grid" },

  redline:    { fam: "blue",   glyph: G.pen,    motif: "doc" },
  cartridge:  { fam: "violet", glyph: G.grid,   motif: "grid" },
  cast:       { fam: "pink",   glyph: G.person, motif: "shot" },
  prism:      { fam: "pink",   glyph: G.camera, motif: "shot" },
  adgen:      { fam: "pink",   glyph: G.grid,   motif: "grid" },
  chat:       { fam: "teal",   glyph: G.chat,   motif: "chat" },

  // viral-wrapp factory (2026-07)
  arcade:     { fam: "violet", glyph: G.pad,    motif: "grid" },
  yearbook:   { fam: "pink",   glyph: G.grid,   motif: "grid" },
  toon:       { fam: "violet", glyph: G.panel,  motif: "grid" },
  storybook:  { fam: "teal",   glyph: G.book,   motif: "doc" },
  anthem:     { fam: "violet", glyph: G.note,   motif: "spark" },
  roast:      { fam: "gold",   glyph: G.flame,  motif: "spark" },
  emote:      { fam: "pink",   glyph: G.smile,  motif: "grid" },
  inkling:    { fam: "violet", glyph: G.pen,    motif: "grid" },
  petrait:    { fam: "pink",   glyph: G.paw,    motif: "shot" },
  rizz:       { fam: "pink",   glyph: G.chat,   motif: "chat" },
  dreamlog:   { fam: "violet", glyph: G.moon,   motif: "grid" },
  roomify:    { fam: "teal",   glyph: G.sofa,   motif: "shot" },
  thumbs:     { fam: "gold",   glyph: G.thumb,  motif: "shot" },
  meme:       { fam: "gold",   glyph: G.meme,   motif: "grid" },

  _default:   { fam: "teal",   glyph: G.doc,    motif: "doc" },
};

const entry = (id) => GLYPHS[id] || GLYPHS._default;

/** The category family ({ ink, soft, light }) for a catalog id. */
export function famOf(id) { return FAM[entry(id).fam] || FAM.teal; }

/** Inline SVG markup for a wrapp's glyph (stroke uses currentColor — set color on the tile). */
export function glyphSvg(id) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${entry(id).glyph}</svg>`;
}

/** A rounded, category-tinted tile with the wrapp glyph — the icon used on store cards & the dock. */
export function glyphTile(id, size = 34) {
  const f = famOf(id);
  const s = document.createElement("span");
  s.className = "ic";
  s.style.background = f.soft;
  s.style.color = f.ink;
  s.style.width = s.style.height = size + "px";
  s.innerHTML = glyphSvg(id);
  return s;
}

// ---- thumbnail motifs — a consistent abstract "preview" per category, tinted from the family ----
const MOTIF = {
  doc: (ink) =>
    `<rect x="30" y="34" width="150" height="14" rx="5" fill="${ink}"/>` +
    `<rect x="30" y="60" width="220" height="9" rx="4" fill="${ink}" opacity=".38"/>` +
    `<rect x="30" y="80" width="180" height="9" rx="4" fill="${ink}" opacity=".38"/>` +
    `<rect x="30" y="118" width="150" height="9" rx="4" fill="${ink}" opacity=".55"/>` +
    `<path d="M252 120l7 7 13-13" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  chart: (ink) =>
    `<circle cx="258" cy="152" r="60" fill="${ink}" opacity=".12"/>` +
    `<polyline points="24,150 78,132 130,138 180,104 232,112 300,58" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="300" cy="58" r="7" fill="${ink}"/>`,
  shot: (ink, soft) =>
    `<rect x="118" y="48" width="84" height="128" rx="22" fill="${ink}" opacity=".9"/>` +
    `<circle cx="160" cy="102" r="24" fill="${soft}"/>` +
    `<rect x="128" y="140" width="64" height="12" rx="6" fill="${soft}" opacity=".8"/>`,
  grid: (ink) =>
    `<g fill="${ink}">` +
    `<rect x="86" y="52" width="26" height="26" rx="5"/><rect x="120" y="52" width="26" height="26" rx="5" opacity=".55"/>` +
    `<rect x="154" y="86" width="26" height="26" rx="5"/><rect x="120" y="86" width="26" height="26" rx="5"/>` +
    `<rect x="188" y="120" width="26" height="26" rx="5" opacity=".55"/><rect x="120" y="120" width="26" height="26" rx="5"/>` +
    `</g>`,
  spark: (ink) =>
    `<circle cx="236" cy="104" r="72" fill="${ink}" opacity=".9"/>` +
    `<path d="M64 56l6.5 19 19 6.5-19 6.5-6.5 19-6.5-19-19-6.5 19-6.5Z" fill="${ink}" opacity=".5"/>`,
  chat: (ink) =>
    `<rect x="34" y="44" width="150" height="56" rx="16" fill="${ink}" opacity=".85"/>` +
    `<path d="M60 100l0 22 22-22Z" fill="${ink}" opacity=".85"/>` +
    `<rect x="140" y="104" width="146" height="48" rx="16" fill="${ink}" opacity=".4"/>`,
  build: (ink) =>
    `<path d="M160 40l90 44-90 44-90-44Z" fill="${ink}" opacity=".85"/>` +
    `<path d="M70 108l90 44 90-44" fill="none" stroke="${ink}" stroke-width="6" opacity=".5"/>`,
};

/** A tinted, abstract thumbnail SVG string (320×200) for a wrapp — the card's preview strip. */
export function thumbArt(id) {
  const f = famOf(id);
  const motif = (MOTIF[entry(id).motif] || MOTIF.doc)(f.ink, f.soft);
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="none"><rect width="320" height="200" fill="${f.soft}"/>${motif}</svg>`;
}
