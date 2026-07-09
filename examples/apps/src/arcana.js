// Arcana — three cards, no mercy. A tarot table: the visitor asks, draws past/present/future
// from a real 22-card major arcana (drawn CLIENT-SIDE — the spread is theirs), and their OWN
// Claude reads the spread through Switchboard. The app ships only the table; no keys, no backend.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const KEY = "arcana:reading:v1";
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const DEFAULT_Q = "What am I not seeing?";
const POSITIONS = ["past", "present", "future"];

let relay = null;
let installed = null; // null = unknown, false = no extension, true = extension present
let spread = null;    // [{ i: deck index, rev: boolean }] × 3
let reading = null;   // parsed reading JSON
let busy = false;

// ---------------- the deck: all 22 major arcana ----------------
// g = the card's sigil, built from a small set of parameterized gold-line primitives so all
// 22 faces read as one engraved deck. Coordinates live in a 200×340 viewBox, center ~(100,165).
const DECK = [
  { n: "The Fool", num: "0",
    up: "beginnings, a leap of faith, the open road",
    rev: "recklessness, cold feet, a false start",
    g: [["ring", { r: 44, dash: 1 }], ["dot", { x: 134, y: 122, r: 5 }], ["stroke", { pts: [[70, 224], [130, 224]] }]] },
  { n: "The Magician", num: "I",
    up: "will, focus, making it real",
    rev: "scattered aim, sleight of hand, untapped skill",
    g: [["ring", { cx: 83, r: 17 }], ["ring", { cx: 117, r: 17 }], ["rays", { n: 4, r1: 34, r2: 46, rot: 45 }]] },
  { n: "The High Priestess", num: "II",
    up: "intuition, the unspoken, the inner voice",
    rev: "ignored instincts, secrets kept from yourself",
    g: [["pillar", { cx: 62 }], ["pillar", { cx: 138 }], ["crescent", { r: 22 }]] },
  { n: "The Empress", num: "III",
    up: "abundance, nurture, creation",
    rev: "creative block, smothering, self-neglect",
    g: [["ring", { cy: 146, r: 24 }], ["stroke", { pts: [[100, 170], [100, 208]] }], ["stroke", { pts: [[84, 190], [116, 190]] }]] },
  { n: "The Emperor", num: "IV",
    up: "structure, authority, holding the line",
    rev: "rigidity, control for its own sake, abdicated power",
    g: [["poly", { n: 4, r: 48, rot: 45 }], ["poly", { n: 4, r: 32 }], ["dot", { r: 4 }]] },
  { n: "The Hierophant", num: "V",
    up: "tradition, counsel, the known way",
    rev: "dead ritual, rebellion, thinking for yourself",
    g: [["pillar", { cx: 62 }], ["pillar", { cx: 138 }], ["ring", { cy: 134, r: 13 }],
      ["stroke", { pts: [[84, 166], [116, 166]] }], ["stroke", { pts: [[84, 182], [116, 182]] }], ["stroke", { pts: [[84, 198], [116, 198]] }]] },
  { n: "The Lovers", num: "VI",
    up: "union, alignment, a real choice",
    rev: "misalignment, avoidance, a choice unmade",
    g: [["poly", { n: 4, r: 12, ri: 4, cy: 116 }], ["ring", { cx: 85, cy: 180, r: 26 }], ["ring", { cx: 115, cy: 180, r: 26 }]] },
  { n: "The Chariot", num: "VII",
    up: "drive, momentum, victory through will",
    rev: "spinning wheels, lost direction, forced control",
    g: [["poly", { n: 3, r: 34, cy: 138 }], ["ring", { cx: 72, cy: 204, r: 18 }], ["rays", { n: 6, r1: 4, r2: 18, cx: 72, cy: 204 }],
      ["ring", { cx: 128, cy: 204, r: 18 }], ["rays", { n: 6, r1: 4, r2: 18, cx: 128, cy: 204 }]] },
  { n: "Strength", num: "VIII",
    up: "quiet courage, mastery of instinct",
    rev: "self-doubt, raw nerves, force over grace",
    g: [["ring", { cx: 89, cy: 122, r: 11 }], ["ring", { cx: 111, cy: 122, r: 11 }], ["ring", { cy: 184, r: 34 }], ["poly", { n: 3, r: 20, cy: 184 }]] },
  { n: "The Hermit", num: "IX",
    up: "withdrawal, the search, inner counsel",
    rev: "isolation, refusing help, exile overstayed",
    g: [["poly", { n: 3, r: 52, cy: 180 }], ["dot", { y: 174, r: 4 }], ["rays", { n: 8, r1: 9, r2: 20, cy: 174 }]] },
  { n: "Wheel of Fortune", num: "X",
    up: "the turn, timing, cycles in motion",
    rev: "resistance to change, a stalled cycle",
    g: [["ring", { r: 48 }], ["ring", { r: 30 }], ["rays", { n: 8, r1: 30, r2: 48 }], ["dot", { r: 4 }]] },
  { n: "Justice", num: "XI",
    up: "truth, accountability, cause and effect",
    rev: "denial, imbalance, an unfair verdict",
    g: [["stroke", { pts: [[100, 114], [100, 212]] }], ["stroke", { pts: [[58, 128], [142, 128]] }],
      ["stroke", { pts: [[58, 128], [58, 156]] }], ["stroke", { pts: [[142, 128], [142, 156]] }],
      ["pan", { cx: 58, cy: 156, r: 15 }], ["pan", { cx: 142, cy: 156, r: 15 }], ["poly", { n: 3, r: 12, cy: 220, rot: 180 }]] },
  { n: "The Hanged Man", num: "XII",
    up: "the sacred pause, a new angle, surrender",
    rev: "stalling, martyrdom, the wasted delay",
    g: [["poly", { n: 3, r: 44, rot: 180, cy: 156 }], ["ring", { cy: 214, r: 10 }]] },
  { n: "Death", num: "XIII",
    up: "the ending that frees, transformation",
    rev: "clinging, decay prolonged, fear of release",
    g: [["pillar", { cx: 56, cy: 158, w: 12, h: 60 }], ["pillar", { cx: 144, cy: 158, w: 12, h: 60 }],
      ["stroke", { pts: [[44, 196], [156, 196]] }], ["pan", { cy: 196, r: 24, flip: 1 }],
      ["rays", { n: 5, r1: 30, r2: 40, cy: 196, span: [-140, -40] }]] },
  { n: "Temperance", num: "XIV",
    up: "balance, patience, the right mix",
    rev: "excess, impatience, mismatched forces",
    g: [["poly", { n: 3, r: 36, cy: 152 }], ["poly", { n: 3, r: 36, cy: 178, rot: 180 }]] },
  { n: "The Devil", num: "XV",
    up: "the deal you made, appetite, bondage",
    rev: "chains loosening, the shadow faced, power reclaimed",
    g: [["ring", { r: 50 }], ["poly", { n: 5, r: 44, ri: 17, rot: 180 }]] },
  { n: "The Tower", num: "XVI",
    up: "collapse, revelation, the necessary ruin",
    rev: "the slow-motion collapse, dread of the fall",
    g: [["pillar", { w: 30, h: 98, cy: 178 }],
      ["stroke", { pts: [[83, 129], [83, 116], [93, 116], [93, 124], [107, 124], [107, 116], [117, 116], [117, 129]] }],
      ["stroke", { pts: [[148, 94], [114, 138], [128, 144], [97, 190]], w: 2, hi: 1 }],
      ["dot", { x: 74, y: 150, r: 2.5 }], ["dot", { x: 138, y: 200, r: 2.5 }], ["dot", { x: 66, y: 208, r: 2 }]] },
  { n: "The Star", num: "XVII",
    up: "hope, healing, quiet guidance",
    rev: "dimmed faith, doubt, disconnection",
    g: [["poly", { n: 8, r: 48, ri: 16 }], ["dot", { r: 3.5 }], ["dot", { x: 54, y: 118, r: 2.5 }], ["dot", { x: 148, y: 212, r: 2.5 }]] },
  { n: "The Moon", num: "XVIII",
    up: "the unlit road, dream-logic, illusion",
    rev: "fog lifting, a fear named, clarity returning",
    g: [["ring", { r: 50, dash: 1 }], ["crescent", { r: 32 }],
      ["dot", { x: 76, y: 242, r: 2.5 }], ["dot", { x: 100, y: 250, r: 2.5 }], ["dot", { x: 124, y: 242, r: 2.5 }]] },
  { n: "The Sun", num: "XIX",
    up: "vitality, unclouded joy, the win",
    rev: "dimmed light, forced cheer, the delayed win",
    g: [["ring", { r: 24 }], ["rays", { n: 8, r1: 30, r2: 50 }], ["rays", { n: 8, r1: 30, r2: 40, rot: -67.5 }], ["dot", { r: 3.5 }]] },
  { n: "Judgement", num: "XX",
    up: "the call, the reckoning, waking up",
    rev: "the call ignored, old verdicts, self-judgment",
    g: [["ring", { cy: 120, r: 13 }], ["rays", { n: 7, r1: 20, r2: 52, cy: 120, span: [20, 160] }], ["stroke", { pts: [[64, 214], [136, 214]] }]] },
  { n: "The World", num: "XXI",
    up: "completion, integration, arrival",
    rev: "loose ends, the last mile, almost there",
    g: [["ring", { rx: 36, ry: 54 }], ["poly", { n: 4, r: 14, ri: 5 }],
      ["dot", { x: 56, y: 120, r: 2.5 }], ["dot", { x: 144, y: 120, r: 2.5 }], ["dot", { x: 56, y: 220, r: 2.5 }], ["dot", { x: 144, y: 220, r: 2.5 }]] },
];

// ---------------- the generative card faces ----------------
const GOLD = "#c9a227", GOLD_HI = "#e8c34f";
const f = (v) => Math.round(v * 10) / 10;
const pt = (cx, cy, r, ang) => [cx + r * Math.cos((ang * Math.PI) / 180), cy + r * Math.sin((ang * Math.PI) / 180)];

// Sigil primitives — every card face is composed from these, gold strokes on deep violet.
const SIGIL = {
  ring: (a) => {
    const rx = a.rx ?? a.r, ry = a.ry ?? a.r ?? a.rx;
    return `<ellipse cx="${a.cx ?? 100}" cy="${a.cy ?? 165}" rx="${rx}" ry="${ry}"${a.dash ? ' stroke-dasharray="4 7"' : ""}/>`;
  },
  dot: (a) => `<circle cx="${a.x ?? 100}" cy="${a.y ?? 165}" r="${a.r ?? 3}" fill="${GOLD}" stroke="none"/>`,
  rays: (a) => {
    const cx = a.cx ?? 100, cy = a.cy ?? 165;
    let s = "";
    for (let k = 0; k < a.n; k++) {
      const ang = a.span ? a.span[0] + (k * (a.span[1] - a.span[0])) / (a.n - 1) : (a.rot ?? -90) + (k * 360) / a.n;
      const [x1, y1] = pt(cx, cy, a.r1, ang), [x2, y2] = pt(cx, cy, a.r2, ang);
      s += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
    }
    return s;
  },
  poly: (a) => {
    const cx = a.cx ?? 100, cy = a.cy ?? 165, step = 360 / a.n;
    let d = "";
    for (let k = 0; k < a.n; k++) {
      const ang = (a.rot ?? 0) + k * step - 90;
      const [x, y] = pt(cx, cy, a.r, ang);
      d += (k ? "L" : "M") + f(x) + " " + f(y) + " ";
      if (a.ri != null) { const [xi, yi] = pt(cx, cy, a.ri, ang + step / 2); d += "L" + f(xi) + " " + f(yi) + " "; }
    }
    return `<path d="${d}Z"/>`;
  },
  crescent: (a) => {
    const cx = a.cx ?? 100, cy = a.cy ?? 165, r = a.r, r2 = f(r * 1.4);
    const d = `M ${cx} ${f(cy - r)} A ${r} ${r} 0 1 0 ${cx} ${f(cy + r)} A ${r2} ${r2} 0 0 1 ${cx} ${f(cy - r)}`;
    return `<path d="${d}"${a.rot ? ` transform="rotate(${a.rot} ${cx} ${cy})"` : ""}/>`;
  },
  pillar: (a) => {
    const cx = a.cx ?? 100, cy = a.cy ?? 170, w = a.w ?? 14, h = a.h ?? 96;
    const x = f(cx - w / 2), y = f(cy - h / 2), y2 = f(cy + h / 2);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>` +
      `<line x1="${f(x - 5)}" y1="${y}" x2="${f(x + w + 5)}" y2="${y}"/>` +
      `<line x1="${f(x - 5)}" y1="${y2}" x2="${f(x + w + 5)}" y2="${y2}"/>`;
  },
  stroke: (a) => `<polyline points="${a.pts.map((p) => p.join(",")).join(" ")}"${a.w ? ` stroke-width="${a.w}"` : ""}${a.hi ? ` stroke="${GOLD_HI}"` : ""}/>`,
  pan: (a) => {
    const cx = a.cx ?? 100, cy = a.cy ?? 165, r = a.r;
    return `<path d="M ${f(cx - r)} ${cy} A ${r} ${r} 0 0 ${a.flip ? 1 : 0} ${f(cx + r)} ${cy}"/>`;
  },
};

const cstar = (x, y, s = 5) =>
  `<path d="M ${x} ${y - s} L ${f(x + s * 0.32)} ${f(y - s * 0.32)} L ${x + s} ${y} L ${f(x + s * 0.32)} ${f(y + s * 0.32)} ` +
  `L ${x} ${y + s} L ${f(x - s * 0.32)} ${f(y + s * 0.32)} L ${x - s} ${y} L ${f(x - s * 0.32)} ${f(y - s * 0.32)} Z" fill="${GOLD}" stroke="none" opacity=".85"/>`;

// Shared fine double border + corner stars on the deep-violet ground.
function frame() {
  return `<rect x="1" y="1" width="198" height="338" rx="12" fill="#170c2a" stroke="#392a55" stroke-width="1"/>` +
    `<rect x="8" y="8" width="184" height="324" rx="8" fill="none" stroke="${GOLD}" stroke-width="1.1" opacity=".9"/>` +
    `<rect x="13" y="13" width="174" height="314" rx="5" fill="none" stroke="${GOLD}" stroke-width=".5" opacity=".5"/>` +
    cstar(24, 24) + cstar(176, 24) + cstar(24, 316) + cstar(176, 316);
}

function frontSvg(c, rev) {
  const sig = c.g.map(([k, a]) => SIGIL[k](a || {})).join("");
  const nameSize = c.n.length > 14 ? 10 : 11.5;
  return `<svg viewBox="0 0 200 340" xmlns="http://www.w3.org/2000/svg" class="face-svg${rev ? " rev" : ""}" role="img" aria-label="${c.n}${rev ? ", reversed" : ""}">` +
    frame() +
    `<text x="100" y="48" text-anchor="middle" fill="${GOLD_HI}" font-family="Cinzel, serif" font-size="21" letter-spacing="3">${c.num}</text>` +
    `<line x1="76" y1="60" x2="124" y2="60" stroke="${GOLD}" stroke-width=".6" opacity=".6"/>` +
    `<g fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${sig}</g>` +
    `<line x1="70" y1="286" x2="130" y2="286" stroke="${GOLD}" stroke-width=".6" opacity=".6"/>` +
    `<text x="100" y="308" text-anchor="middle" fill="${GOLD}" font-family="Cinzel, serif" font-size="${nameSize}" letter-spacing="1.5">${c.n.toUpperCase()}</text>` +
    `</svg>`;
}

// Card back: gold diamond lattice around a moon-in-ring emblem. Used face-up pre-flip.
function backSvg() {
  let lat = "";
  for (let row = 0, y = 40; y <= 300; y += 25, row++) {
    for (let x = row % 2 ? 42.5 : 30; x <= 170; x += 25) {
      if (Math.hypot(x - 100, y - 170) < 60) continue;
      lat += `<path d="M ${x} ${y - 7} L ${f(x + 7)} ${y} L ${x} ${y + 7} L ${f(x - 7)} ${y} Z" fill="none" stroke="${GOLD}" stroke-width=".7" opacity=".5"/>`;
    }
  }
  return `<svg viewBox="0 0 200 340" xmlns="http://www.w3.org/2000/svg" class="face-svg" aria-label="card back">` +
    frame() + lat +
    `<circle cx="100" cy="170" r="46" fill="#170c2a" stroke="${GOLD}" stroke-width="1.1"/>` +
    `<circle cx="100" cy="170" r="52" fill="none" stroke="${GOLD}" stroke-width=".5" stroke-dasharray="2 5" opacity=".8"/>` +
    `<g fill="none" stroke="${GOLD}" stroke-width="1.5" stroke-linecap="round">${SIGIL.crescent({ r: 22, cy: 170 })}</g>` +
    `<circle cx="112" cy="170" r="2.5" fill="${GOLD}" stroke="none"/>` +
    `</svg>`;
}

// Empty slot before the first draw — a dashed gilded ghost, never a blank box.
function ghostSvg() {
  return `<svg viewBox="0 0 200 340" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<rect x="6" y="6" width="188" height="328" rx="12" fill="rgba(23,12,42,.5)" stroke="${GOLD}" stroke-opacity=".28" stroke-dasharray="3 9"/>` +
    `<g fill="none" stroke="${GOLD}" stroke-opacity=".22" stroke-width="1.4">${SIGIL.crescent({ r: 20, cy: 170 })}</g>` +
    `</svg>`;
}

// ---------------- the draw (client-side, real randomness) ----------------
function rand(n) { const u = new Uint32Array(1); crypto.getRandomValues(u); return u[0] % n; }
function chance(p) { const u = new Uint32Array(1); crypto.getRandomValues(u); return u[0] / 0xffffffff < p; }

function drawSpread() {
  const picks = [];
  while (picks.length < 3) { const i = rand(DECK.length); if (!picks.includes(i)) picks.push(i); }
  return picks.map((i) => ({ i, rev: chance(0.3) })); // each card independently reversed ~30%
}

function ghosts() {
  for (let k = 0; k < 3; k++) $("slot-" + k).querySelector(".cardbox").innerHTML = `<div class="ghost">${ghostSvg()}</div>`;
}

// Deal three face-down backs onto the table, then flip one by one (staggered).
function deal(sp, { instant = false } = {}) {
  spread = sp;
  clearReadingUI();
  sp.forEach((s, k) => {
    const slot = $("slot-" + k);
    const c = DECK[s.i];
    const box = slot.querySelector(".cardbox");
    box.classList.remove("dealing");
    void box.offsetWidth; // restart the deal animation on redraws
    box.innerHTML = "";
    const card = document.createElement("div");
    card.className = "card3d" + (instant ? " instant" : "");
    card.innerHTML = `<div class="b">${backSvg()}</div><div class="f">${frontSvg(c, s.rev)}</div>`;
    box.append(card);
    const nameEl = slot.querySelector(".cardname");
    nameEl.textContent = c.n + (s.rev ? " · reversed" : "");
    const take = slot.querySelector(".take");
    take.textContent = "";
    take.hidden = true;
    if (instant) {
      card.classList.add("flip");
      nameEl.classList.remove("veil");
    } else {
      nameEl.classList.add("veil");
      box.classList.add("dealing");
      box.style.animationDelay = k * 180 + "ms";
      setTimeout(() => card.classList.add("flip"), 950 + k * 600);
      setTimeout(() => nameEl.classList.remove("veil"), 1400 + k * 600);
    }
  });
  $("readrow").hidden = false;
  $("draw").textContent = "Draw again";
  reflect();
  persist();
}

// ---------------- the standard connect chip ----------------
mountConnect($("chip-dock"), {
  scope: { reason: "read your cards", models: ["sonnet"] },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; installed = true; reflect(); },
  onDisconnect: () => { relay = null; reflect(); },
});
// Fast probe so a returning user's grant enables the reading without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    installed = true;
    const grant = await r.permissions().catch(() => null);
    if (grant) relay = r;
  } else {
    installed = false;
  }
  reflect();
})();

function reflect() {
  const on = !!relay;
  $("read").disabled = !on || busy || !spread;
  $("ask").disabled = !on || busy || !spread;
  $("draw").disabled = busy;
  $("again").disabled = busy;
  const hint = $("conn-hint");
  if (on) {
    hint.innerHTML = "read on <b>your</b> Claude — nothing leaves the table but the question";
  } else if (installed === false) {
    hint.innerHTML = `the reading runs on your own Claude — <a href="${INSTALL_URL}" target="_blank" rel="noreferrer">get Switchboard</a>, then connect (top right)`;
  } else {
    hint.innerHTML = "connect Switchboard (top right) to hear the reading";
  }
}

// ---------------- the reading ----------------
function cardLine(pos, s) {
  const c = DECK[s.i];
  return `${pos.toUpperCase()} — ${c.n} (${c.num}), ${s.rev ? "REVERSED" : "upright"}. Upright keywords: ${c.up}. Reversed keywords: ${c.rev}.`;
}

function buildPrompt(q) {
  return [
    'You are the reader at Arcana, a midnight card table. Your voice: sharp, intimate, direct, a little dangerous. Modern language — no "thee" or "thou", no cosmic hedging, no disclaimers, no hedging of any kind. You respect the querent\'s intelligence and you never flatter. Reversed cards read as blocked, delayed, or internalized energy — never doom.',
    "",
    `The querent asks: "${q}"`,
    "",
    "They drew this three-card spread (past / present / future):",
    cardLine("past", spread[0]),
    cardLine("present", spread[1]),
    cardLine("future", spread[2]),
    "",
    'Read THIS spread for THIS question. Speak to the querent as "you".',
    "Respond with ONLY a valid JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    '{"opening":"1-2 lines that meet the question head-on","cards":[{"position":"past","take":"3-4 sentences reading this exact card, in this position, for this question — honor its orientation"},{"position":"present","take":"3-4 sentences"},{"position":"future","take":"3-4 sentences"}],"synthesis":"the three cards as one arc — how past feeds present feeds future; 3-5 sentences","advice":"one concrete instruction the querent can act on this week — imperative and specific","omen":"a single closing line, ominous or hopeful, that they will remember"}',
  ].join("\n");
}

const STATUS_LINES = [
  "she turns your cards over in her mind…",
  "the candles lean toward the table…",
  "past and present are arguing…",
  "the future is clearing its throat…",
  "she reads what you pulled — not what you hoped…",
];
let statusTimer = null;

async function readSpread() {
  if (!relay || !spread || busy) return;
  busy = true;
  reflect();
  hideErr();
  $("read-status").hidden = false;
  let li = 0;
  $("status-line").textContent = STATUS_LINES[0];
  statusTimer = setInterval(() => { li = (li + 1) % STATUS_LINES.length; $("status-line").textContent = STATUS_LINES[li]; }, 2400);
  const q = $("q").value.trim() || DEFAULT_Q;
  let acc = "";
  try {
    for await (const d of relay.stream({ prompt: buildPrompt(q) })) {
      if (d.type === "text") acc += d.text;
      else if (d.type === "error") throw Object.assign(new Error(d.error?.message || "the stream broke"), { code: d.error?.code });
    }
    const m = acc.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no reading came back");
    const r = JSON.parse(m[0]); // throws on malformed JSON → visible error + retry below
    if (!r || !r.opening || !Array.isArray(r.cards) || r.cards.length < 3) throw new Error("the reading came back malformed");
    reading = r;
    renderReading(r, { scroll: true });
    persist();
  } catch (err) {
    showErr(err);
  } finally {
    busy = false;
    clearInterval(statusTimer);
    $("read-status").hidden = true;
    reflect();
  }
}

function renderReading(r, { scroll = false } = {}) {
  $("reading").hidden = false;
  $("opening").textContent = r.opening || "";
  POSITIONS.forEach((p, k) => {
    const c = (r.cards || []).find((x) => String(x?.position || "").toLowerCase().includes(p)) || (r.cards || [])[k] || {};
    const take = $("slot-" + k).querySelector(".take");
    take.textContent = c.take || "";
    take.hidden = !c.take;
  });
  $("synthesis").textContent = r.synthesis || "";
  $("advice").textContent = r.advice || "";
  $("omen").textContent = r.omen || "";
  $("read").textContent = "Re-read the spread"; // the regenerate affordance
  if (scroll) $("table").scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearReadingUI() {
  reading = null;
  $("reading").hidden = true;
  hideErr();
  $("read").textContent = "Read the spread";
  ["opening", "synthesis", "advice", "omen"].forEach((id) => { $(id).textContent = ""; });
}

// ---------------- errors, in-voice and visible ----------------
function showErr(err) {
  const code = err?.code;
  let line;
  if (code === 4001) line = "you shut the door before she could speak. Connect when you're ready.";
  else if (code === 4290) line = "this table hit the budget you gave it. Raise it in the Switchboard panel, or return tomorrow.";
  else if (code === 4900) line = "your Claude is unreachable. Wake the Switchboard daemon and try again.";
  else if (code === 4100) line = "the connection lapsed. Click the chip (top right) and approve it again.";
  else line = "the cards resisted that one." + (err?.message ? " (" + String(err.message).slice(0, 140) + ")" : "") + " Try again.";
  $("err-text").textContent = "The table is silent — " + line;
  $("errline").hidden = false;
}
function hideErr() { $("errline").hidden = true; }

// ---------------- wiring ----------------
const CHIP_QUESTIONS = [
  "Should I take the job?",
  "What am I not seeing?",
  "This relationship — where is it going?",
  "What does this launch need from me?",
];
CHIP_QUESTIONS.forEach((t) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = t;
  b.addEventListener("click", () => { $("q").value = t; persist(); });
  $("chips").append(b);
});

$("draw").addEventListener("click", () => { if (!busy) deal(drawSpread()); });
$("again").addEventListener("click", () => {
  if (busy) return;
  deal(drawSpread());
  $("table").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("read").addEventListener("click", readSpread);
$("retry").addEventListener("click", () => {
  // readSpread() no-ops without a connection — keep the table talking instead of going silent
  if (!relay) { showErr(Object.assign(new Error("connect first"), { code: 4100 })); return; }
  hideErr();
  readSpread();
});
$("ask").addEventListener("click", () => {
  const fq = $("fq").value.trim();
  if (!fq || !spread || busy) return;
  $("q").value = fq; // the follow-up becomes the question; same cards, re-read
  $("fq").value = "";
  readSpread();
});
$("fq").addEventListener("keydown", (e) => { if (e.key === "Enter") $("ask").click(); });
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") $("draw").click(); });
$("q").addEventListener("change", persist);

// ---------------- persistence ----------------
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ q: $("q").value, spread, reading })); } catch { /* storage full/blocked — session-only */ }
}
function restore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* corrupt state — start fresh */ }
  if (!s) return;
  if (typeof s.q === "string" && s.q.trim()) $("q").value = s.q;
  if (Array.isArray(s.spread) && s.spread.length === 3 && s.spread.every((x) => DECK[x?.i])) {
    deal(s.spread, { instant: true });
    if (s.reading) {
      reading = s.reading;
      renderReading(s.reading);
      persist(); // deal() saved reading:null; re-save the full state
    }
  }
}

ghosts();
restore();
reflect();
