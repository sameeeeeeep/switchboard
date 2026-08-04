// Switchboard OS surface — Store (door only).
// Locked decision: the OS does NOT rebuild the store. The real store lives at
// ./index.html; this surface is a short pane that hands off to it. Keeping it a
// door (not a copy) means there is exactly one store to maintain, and the rail's
// "Store" item and this pane both point at the same place.
//
// Self-contained ES module: exports render(DATA), css, wire(root).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const STORE_URL = "./index.html";

// Category chips across the top of the shelves. Every one is a real door into
// the store (the store owns its own filtering); nothing here is inert.
const CATS = [
  { t: "Browse all", open: STORE_URL },
  { t: "Studios", open: STORE_URL },
  { t: "Skills", open: STORE_URL },
  { t: "Fun & personal", open: STORE_URL },
];

// Teasers so the door hints at what's behind it — but each app name is a live
// launch/landing chip, so a click always does something real.
const TEASERS = [
  {
    k: "Featured",
    d: "Your brand, extracted — voice, palette, positioning.",
    items: [{ t: "Brandbrain", app: "brandbrain" }],
  },
  {
    k: "Apps we love",
    d: "Studios and tools — resource profile shown before Get.",
    items: [
      { t: "Prism", app: "Prism" },
      { t: "Redline", app: "Redline" },
      { t: "ideabrain", app: "ideabrain" },
    ],
  },
  {
    k: "New skills",
    d: "Small hands you can give God to drive.",
    items: [
      { t: "Cast", open: "./cast-landing.html" },
      { t: "Flow", app: "Flow" },
      { t: "Batch", open: "./batch-landing.html" },
    ],
  },
];

const chipAttr = (x) =>
  x.app ? ' data-app="' + esc(x.app) + '"' : ' data-open="' + esc(x.open) + '"';

export function render(DATA) {
  const cats = CATS.map((c) =>
    '<button class="cat" type="button"' + chipAttr(c) + ">" + esc(c.t) + "</button>"
  ).join("");

  const teasers = TEASERS.map((x) => {
    const chips = x.items.map((it) =>
      '<button class="chip" type="button"' + chipAttr(it) + ">" + esc(it.t) + "</button>"
    ).join("");
    return '<div class="teaser">'
      + '<div class="tk">' + esc(x.k) + "</div>"
      + '<div class="chips">' + chips + "</div>"
      + '<div class="td">' + esc(x.d) + "</div></div>";
  }).join("");

  return '<div class="srf-store">'
    + '<div class="shead"><span class="kick">Store</span><h1>Get more capability</h1></div><div class="rule"></div>'
    + '<div class="door" role="button" tabindex="0" data-open="' + STORE_URL + '">'
    + '<div class="p">+</div>'
    + '<div class="tx"><b>Open the Store</b>'
    + "<div>the one door to discovery — featured, shelves, and each app's resource profile (weight, egress, model need) shown before you Get.</div></div>"
    + '<div class="go">Open ▸</div></div>'
    + '<div class="cats">' + cats + "</div>"
    + '<div class="teasers">' + teasers + "</div>"
    + '<div class="note">you\'re shopping, not working — the store opens in its own view · nothing installs without resolving its requirements first</div>'
    + "</div>";
}

export function wire(root) {
  const el = root.querySelector(".srf-store");
  if (!el) return;
  // Every click target carries data-open / data-app / data-route and is handled
  // by the shell's global delegated handler. The only thing to add here is
  // keyboard parity for the div-based door (Enter/Space), so it isn't a
  // mouse-only control.
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const door = e.target.closest(".door[data-open]");
    if (!door) return;
    e.preventDefault();
    door.click(); // re-dispatch as a click so the global handler picks it up
  });
}

export const css = `
.srf-store{
  --panel:#12151C; --raised:#1A1F29; --edge:#262C38; --edge-soft:#1C212B;
  --ink:#E8EDF4; --ink-sec:#B4BECE; --ink-dim:#99A3B7; --ink-faint:#6E7C90;
  --lime:#C8F250; --indigo:#5B4FE8;
  --mono:"Spline Sans Mono",ui-monospace,Menlo,monospace;
}
.srf-store .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-store .shead{display:flex;align-items:center;gap:14px;margin:10px 0 6px}
.srf-store .shead h1{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0}
.srf-store .rule{height:1px;background:var(--edge-soft);margin:14px 0 20px}
.srf-store .door{display:flex;align-items:center;gap:14px;text-decoration:none;border:1px solid var(--edge);border-radius:16px;padding:20px 22px;background:linear-gradient(120deg,#191512,#0f0e12);cursor:pointer;transition:border-color .12s ease,transform .12s ease}
.srf-store .door:hover{border-color:var(--lime);transform:translateY(-1px)}
.srf-store .door:focus-visible{outline:none;border-color:var(--lime)}
.srf-store .door .p{width:40px;height:40px;border-radius:11px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--lime);font-size:20px;flex:0 0 auto}
.srf-store .door .tx b{color:var(--ink);font-weight:600;font-size:15px}
.srf-store .door .tx div{color:var(--ink-dim);font-size:12.5px;max-width:460px;margin-top:2px}
.srf-store .door .go{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--lime);border:1px solid #33461a;background:#1b2410;border-radius:9px;padding:7px 14px;white-space:nowrap}
.srf-store .door:hover .go{background:#22300f;border-color:var(--lime)}
.srf-store .cats{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.srf-store .cat{font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--ink-sec);background:var(--raised);border:1px solid var(--edge);border-radius:999px;padding:6px 13px;cursor:pointer;transition:color .12s ease,border-color .12s ease,background .12s ease}
.srf-store .cat:hover{color:var(--ink);border-color:var(--indigo);background:var(--panel)}
.srf-store .cat:focus-visible{outline:none;border-color:var(--indigo);color:var(--ink)}
.srf-store .teasers{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}
.srf-store .teaser{background:var(--panel);border:1px solid var(--edge);border-radius:13px;padding:14px 15px}
.srf-store .teaser .tk{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.srf-store .teaser .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.srf-store .teaser .chip{font-size:13px;font-weight:600;color:var(--ink);background:var(--raised);border:1px solid var(--edge);border-radius:8px;padding:5px 11px;cursor:pointer;transition:color .12s ease,border-color .12s ease,background .12s ease}
.srf-store .teaser .chip:hover{color:var(--lime);border-color:var(--lime);background:var(--panel)}
.srf-store .teaser .chip:focus-visible{outline:none;border-color:var(--lime);color:var(--lime)}
.srf-store .teaser .td{font-size:12px;color:var(--ink-dim);margin-top:8px;line-height:1.4}
.srf-store .note{margin-top:20px;font-family:var(--mono);font-size:11px;color:var(--ink-faint);line-height:1.5}
`;
