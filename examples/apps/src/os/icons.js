// Switchboard OS — shared icon + launch resolver.
// The real app icons (vibrant isometric renders) live in examples/apps/icons/<id>.png.
// appIcon(id) returns a real <img> when one exists, else falls back to the
// code-drawn iso tile (deterministic hue) so any id still reads as an app.
// pageFor(id) resolves an app id to the best existing wrapp page to launch.

// ---- the icon set we ship (basenames in examples/apps/icons/, lowercased) ----
const ICON_IDS = new Set(
  ("actions adforge adgen adpulse aplus arcana autopilot bank batch brandbrain canvas capp caption "
  + "cartridge cast clipfix coldemail commit compare convert crest cron cut deck docstring dub errslate "
  + "explainthis extract feature flow formula gist god hardware hooks huddle ideabrain identity marquee "
  + "meetnotes mkt nameit natal objection outline polish prism recap redline reel regex rephrase reply "
  + "repurpose retail saas shelf shell snap spellout standup steps studio take titles translate unjargon yc")
  .split(" ")
);

// ---- the wrapp pages that actually exist (examples/apps/<name>.html) ----
const PAGES = new Set(
  ("actions adforge-landing adforge-widget adforge adgen-landing adgen-widget adgen adpulse-landing "
  + "adpulse-widget adpulse anthem-landing anthem aplus-landing aplus-widget aplus arcade-landing arcade "
  + "arcana-landing arcana-widget arcana autopilot-widget bank-landing bank-widget bank batch-landing "
  + "batch-widget batch brandbrain-landing brandbrain-widget canvas-widget canvas capp-landing capp-widget "
  + "caption cartridge-landing cartridge-widget cartridge cast-landing cast-widget chat-landing chat clipfix "
  + "coldemail commit compare convert-widget convert copyflow-widget copyflow crest cron cut-widget cut "
  + "deck-widget deck docstring dreamlog-landing dreamlog dub-widget dub echo emote-landing emote errslate "
  + "explainthis extract feature-landing feature-widget flow-widget formula gist hardware-landing "
  + "hardware-widget hooks huddle-landing huddle-widget huddle ideabrain-landing ideabrain-widget ideabrain "
  + "ideafetch-widget ideafetch identity-landing identity-widget identity imagegen inkling-landing inkling "
  + "marquee-landing marquee-widget marquee meetnotes-widget meetnotes meme-landing meme mkt-landing "
  + "mkt-widget nameit natal-landing natal-widget natal objection outline palette-widget palette "
  + "pdftools-widget pdftools persona petrait-landing petrait polish prism-landing prism-widget qr-widget qr "
  + "reachout-widget reachout recap redline-landing redline-widget redline reel-landing reel-widget reel "
  + "regex rephrase reply repurpose resize-widget resize rizz-landing rizz roast-landing roast roomify-landing "
  + "roomify saas-landing saas-widget shelf-landing shelf-widget shelf shell snap spellout standup steps "
  + "storybook-landing storybook studio-landing studio-widget studio take-landing take-widget take "
  + "thumbs-landing thumbs titles toon-landing toon translate unjargon yc-application-composer yearbook-landing yearbook")
  .split(" ")
);

// ---- deterministic per-app hue (fallback iso tile) ----
function hueForId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (n) => Math.round(255 * f(n)).toString(16).padStart(2, "0");
  return "#" + to(0) + to(8) + to(4);
}
export function hexForId(id) { return hslToHex(hueForId(id), 68, 58); }

const SZ = 6.2, K = 0.866 * SZ, HH = 0.5 * SZ;
function isoTile(hue, cx, cy) {
  function P(x, y, z) { return (cx + (x - y) * K).toFixed(1) + "," + (cy + (x + y) * HH - z * SZ).toFixed(1); }
  function poly(pts, f) { return '<polygon points="' + pts.map((p) => P(p[0], p[1], p[2])).join(" ") + '" fill="' + f + '"/>'; }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return "#" + ((1 << 24) + ((Math.round(r * amt)) << 16) + ((Math.round(g * amt)) << 8) + Math.round(b * amt)).toString(16).slice(1);
  }
  const T = hue, L = shade(hue, 0.66), R = shade(hue, 0.5);
  function box(ox, oy, oz, s, h) {
    const x0 = ox, x1 = ox + s, y0 = oy, y1 = oy + s, z0 = oz, z1 = oz + h;
    return poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], R)
      + poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], L)
      + poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], T);
  }
  return box(-2.2, -2.2, 0, 4.4, 1.4) + box(-1.2, -1.2, 1.4, 2.4, 2.4);
}
export function tileSvg(hex, px) { const s = px || 48; return '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" xmlns="http://www.w3.org/2000/svg">' + isoTile(hex, 32, 40) + "</svg>"; }

// Icon direction. false = on-brand vibrant iso tiles (locked decision — instant,
// bright, deterministic per-app hue). true = the real photoreal PNG renders.
// Flip this one line to switch the whole OS.
export const USE_REAL_ICONS = true;

// The one call every surface uses for an app glyph. Real icon when we have it,
// deterministic iso tile otherwise. .os-ic fills its (.tile) frame via CSS.
export function appIcon(id, px) {
  const lc = String(id).toLowerCase();
  const s = px || 48;
  if (USE_REAL_ICONS && ICON_IDS.has(lc)) {
    return '<img class="os-ic" src="./icons/' + lc + '.png" width="' + s + '" height="' + s
      + '" alt="" loading="lazy" onerror="this.classList.add(\'os-ic-broken\');this.removeAttribute(\'src\')">';
  }
  return tileSvg(hexForId(id), s);
}

// Resolve an app id to the best existing page to launch (app > landing > widget).
export function pageFor(id) {
  const lc = String(id).toLowerCase();
  for (const cand of [lc, lc + "-landing", lc + "-widget"]) {
    if (PAGES.has(cand)) return "./" + cand + ".html";
  }
  return null;
}
export function hasIcon(id) { return ICON_IDS.has(String(id).toLowerCase()); }
