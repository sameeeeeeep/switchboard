// Switchboard OS surface — Store (door only).
// Locked decision: the OS does NOT rebuild the store. The real store lives at
// ./index.html; this surface is a short pane that hands off to it. Keeping it a
// door (not a copy) means there is exactly one store to maintain, and the rail's
// "Store" item and this pane both point at the same place.
//
// Self-contained ES module: exports render(DATA), css, wire(root).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const STORE_URL = "./index.html";

// A few teasers so the door hints at what's behind it — purely decorative.
const TEASERS = [
  { k: "Featured", t: "Brandbrain", d: "Your brand, extracted — voice, palette, positioning." },
  { k: "Apps we love", t: "Prism · Redline · ideabrain", d: "Studios and tools, resource profile shown before Get." },
  { k: "New skills", t: "Cast · Flow · Batch", d: "Small hands you can give God to drive." },
];

export function render(DATA) {
  const teasers = TEASERS.map((x) =>
    '<div class="teaser"><div class="tk">' + esc(x.k) + '</div><div class="tt">' + esc(x.t) + '</div><div class="td">' + esc(x.d) + "</div></div>"
  ).join("");

  return '<div class="srf-store">'
    + '<div class="shead"><span class="kick">Store</span><h1>Get more capability</h1></div><div class="rule"></div>'
    + '<a class="door" href="' + STORE_URL + '" data-store-open="1">'
    + '<div class="p">+</div>'
    + '<div class="tx"><b>Open the Store</b>'
    + "<div>the one door to discovery — featured, shelves, and each app's resource profile (weight, egress, model need) shown before you Get.</div></div>"
    + '<div class="go">Open ▸</div></a>'
    + '<div class="teasers">' + teasers + "</div>"
    + '<div class="note">you\'re shopping, not working — the store opens in its own view · nothing installs without resolving its requirements first</div>'
    + "</div>";
}

export function wire(root) {
  const el = root.querySelector(".srf-store");
  if (!el) return;
  // The anchor navigates natively (href=./index.html). Nothing to intercept —
  // this is a deliberate hand-off, not an in-OS re-render. Left as a hook in
  // case the shell later wants to open the store in a managed tab.
  el.addEventListener("click", (e) => {
    const door = e.target.closest("[data-store-open]");
    if (door) { /* allow default navigation to STORE_URL */ }
  });
}

export const css = `
.srf-store{
  --panel:#14161c; --raised:#1b1e26; --edge:#242833; --edge-soft:#1a1d25;
  --ink:#e8edf4; --ink-sec:#b4bece; --ink-dim:#8a93a6; --ink-faint:#5c6474;
  --lime:#c8f250; --indigo:#5b4fe8;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
}
.srf-store .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-store .shead{display:flex;align-items:center;gap:14px;margin:10px 0 6px}
.srf-store .shead h1{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0}
.srf-store .rule{height:1px;background:var(--edge-soft);margin:14px 0 20px}
.srf-store .door{display:flex;align-items:center;gap:14px;text-decoration:none;border:1px solid var(--edge);border-radius:16px;padding:20px 22px;background:linear-gradient(120deg,#191512,#0f0e12);cursor:pointer}
.srf-store .door .p{width:40px;height:40px;border-radius:11px;background:var(--raised);border:1px solid var(--edge);display:grid;place-items:center;color:var(--lime);font-size:20px;flex:0 0 auto}
.srf-store .door .tx b{color:var(--ink);font-weight:600;font-size:15px}
.srf-store .door .tx div{color:var(--ink-dim);font-size:12.5px;max-width:460px;margin-top:2px}
.srf-store .door .go{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--lime);border:1px solid #33461a;background:#1b2410;border-radius:9px;padding:7px 14px;white-space:nowrap}
.srf-store .teasers{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}
.srf-store .teaser{background:var(--panel);border:1px solid var(--edge);border-radius:13px;padding:14px 15px}
.srf-store .teaser .tk{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.srf-store .teaser .tt{font-size:13.5px;font-weight:600;color:var(--ink);margin-top:6px}
.srf-store .teaser .td{font-size:12px;color:var(--ink-dim);margin-top:4px;line-height:1.4}
.srf-store .note{margin-top:20px;font-family:var(--mono);font-size:11px;color:var(--ink-faint);line-height:1.5}
`;
