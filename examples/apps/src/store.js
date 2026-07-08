// Wrapp Store home — a clean landing (featured OS → popular apps → context bar), matching the
// reference. Low-text, iconful, violet→magenta on dark. The full searchable directory lives behind
// "Browse all". Data-driven so it stays easy to extend.

const $ = (id) => document.getElementById(id);
const el = (t, c) => { const n = document.createElement(t); if (c) n.className = c; return n; };
const svg = (path, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

// ---- icons (line glyphs, no emojis) ----
const I = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  store: '<path d="M4 9h16l-1 11H5z"/><path d="M4 9l1.5-5h13L20 9"/><path d="M9 13h6"/>',
  connectors: '<path d="M7 3v5a5 5 0 0010 0V3"/><path d="M12 18v3"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  billing: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1L14.5 2h-4l-.4 2.6a7 7 0 00-1.7 1l-2.3-1-2 3.4L4.1 11a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.4 2.6h4l.4-2.6a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5a7 7 0 00.1-1z"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  megaphone: '<path d="M3 11v2a1 1 0 001 1h2l4 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M15 8a5 5 0 010 8"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wand: '<path d="M15 4V2M15 10V8M12 6h2M18 6h2"/><path d="M4 20l10-10 2 2L6 22z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h1a4 4 0 004-4c0-4.4-4-8-8-8z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="11" r="1"/>',
  bag: '<path d="M6 8h12l-1 12H7z" fill="#fff" stroke="none"/><path d="M9 8a3 3 0 016 0" stroke="#0A0A12" stroke-width="2"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>',
  box: '<path d="M12 3l8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

const NAV = [["Home", I.home, false], ["App Store", I.store, true], ["Connectors", I.connectors, false], ["Permissions", I.lock, false], ["Usage & Billing", I.billing, false], ["Settings", I.settings, false]];

const CTXS = [
  { name: "Personal", grad: ["#8B5CF6", "#6D28D9"] },
  { name: "nailin.it", grad: ["#EC4899", "#BE185D"], active: true, badge: "21%" },
  { name: "Secret Slumber Party", grad: ["#F59E0B", "#B45309"] },
  { name: "Client: Acme Labs", grad: ["#22D3EE", "#0E7490"] },
  { name: "Client: Horizon", grad: ["#34D399", "#059669"] },
];

const INSTALLED = ["Landing Studio", "Campaign Studio", "Brand Builder", "Store Auditor"];

const FEATURED = {
  name: "Commerce OS",
  tagline: "The complete AI operating system for modern commerce teams.",
  facts: [[I.box, "12", "Apps"], [I.connectors, "", "Shared Context"], [I.shield, "", "Best for D2C brands"]],
  apps: [["Landing Studio", I.layout, ["#EC4899", "#BE185D"]], ["Campaign Studio", I.megaphone, ["#F59E0B", "#B45309"]], ["Store Auditor", I.chart, ["#3B82F6", "#1D4ED8"]], ["Email Studio", I.mail, ["#A78BFA", "#6D28D9"]], ["Creative Studio", I.wand, ["#8B5CF6", "#D946EF"]], ["Brand Builder", I.palette, ["#A855F7", "#7E22CE"]]],
};

const POPULAR = [
  { name: "Landing Studio", icon: I.layout, grad: ["#EC4899", "#BE185D"], desc: "Generate high-converting landing pages with your brand context.", rating: 4.9, installs: "1.2K", url: "#" },
  { name: "Brand Builder", icon: I.palette, grad: ["#A855F7", "#7E22CE"], desc: "Build a rich brand context from your website, socials and more.", rating: 4.8, installs: "980", url: "brandbrain.html", installed: true },
  { name: "Campaign Studio", icon: I.megaphone, grad: ["#F59E0B", "#B45309"], desc: "Create multi-channel campaigns that convert.", rating: 4.9, installs: "1.1K", url: "adgen.html" },
  { name: "Video Studio", icon: I.video, grad: ["#22C55E", "#15803D"], desc: "Generate scroll-stopping video ads in minutes.", rating: 4.7, installs: "810", url: "persona.html" },
  { name: "Store Auditor", icon: I.chart, grad: ["#3B82F6", "#1D4ED8"], desc: "AI audits your store and gives actionable growth insights.", rating: 4.8, installs: "730", url: "#" },
  { name: "UGC Studio", icon: I.wand, grad: ["#EC4899", "#DB2777"], desc: "Create UGC concepts, scripts and briefs that work.", rating: 4.8, installs: "650", url: "persona.html" },
];

const STATS = [[I.shield, "92%", "Brand Health"], [I.box, "1,248", "Assets"], [I.store, "42", "Products"], [I.megaphone, "18", "Campaigns"], [I.users, "D2C · Gen Z", "Audience"], [I.clock, "2h ago", "Last Updated"]];

// ---- render ----
function renderNav() {
  const nav = $("nav"); nav.innerHTML = "";
  for (const [label, icon, on] of NAV) { const a = document.createElement("a"); if (on) a.className = "on"; a.href = "#"; a.innerHTML = svg(icon) + `<span>${label}</span>`; nav.append(a); }
}
function mk(grad, letter) { const m = el("div", "mk"); m.style.background = `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`; m.textContent = letter; return m; }
function renderCtxs() {
  const box = $("ctxs"); box.innerHTML = "";
  for (const c of CTXS) {
    const row = el("div", "item" + (c.active ? " active" : ""));
    row.append(mk(c.grad, c.name[0].toUpperCase()));
    const t = el("div"); t.style.minWidth = "0"; const nm = el("div", "nm"); nm.textContent = c.name; t.append(nm); if (c.active) { const st = el("div", "st"); st.textContent = "Active"; t.append(st); }
    row.append(t);
    if (c.badge) { const b = el("span", "badge"); b.textContent = c.badge; row.append(b); }
    box.append(row);
  }
  const all = el("div", "item link"); all.textContent = "View all contexts"; box.append(all);
}
function renderInstalled() {
  const box = $("installed"); box.innerHTML = "";
  const grads = { "Landing Studio": ["#EC4899", "#BE185D"], "Campaign Studio": ["#F59E0B", "#B45309"], "Brand Builder": ["#A855F7", "#7E22CE"], "Store Auditor": ["#3B82F6", "#1D4ED8"] };
  for (const name of INSTALLED) { const row = el("div", "item app"); const m = mk(grads[name] || ["#333", "#222"], name[0]); row.append(m); const nm = el("div", "nm"); nm.textContent = name; row.append(nm); box.append(row); }
  const all = el("div", "item link"); all.textContent = "View all installed"; box.append(all);
}
function renderFeature() {
  const box = $("feature"); box.innerHTML = "";
  const fe = el("div", "fe");
  fe.innerHTML = `<div class="eyebrow">Featured OS</div><h2>${FEATURED.name}</h2><p>${FEATURED.tagline}</p>`;
  const facts = el("div", "facts");
  for (const [icon, val, label] of FEATURED.facts) { const f = el("div", "fact"); f.innerHTML = svg(icon) + (val ? `<b>${val}</b> ${label}` : `<b>${label}</b>`); facts.append(f); }
  fe.append(facts);
  const btn = el("button", "explore"); btn.textContent = `Explore ${FEATURED.name}`; fe.append(btn);
  box.append(fe);

  const con = el("div", "constellation");
  for (const r of [300, 214, 128]) { const o = el("div", "orbit"); o.style.width = o.style.height = r + "px"; con.append(o); }
  const hub = el("div", "hub"); hub.innerHTML = svg(I.bag, 0); con.append(hub);
  FEATURED.apps.forEach(([name, icon, grad], i) => {
    const ang = (-90 + i * (360 / FEATURED.apps.length)) * Math.PI / 180;
    const node = el("div", "node");
    node.style.left = `${50 + Math.cos(ang) * 42}%`;
    node.style.top = `${50 + Math.sin(ang) * 42}%`;
    const t = el("div", "t"); t.style.background = `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`; t.innerHTML = svg(icon); t.querySelector("svg").style.width = "22px"; t.querySelector("svg").style.height = "22px"; t.querySelector("svg").style.color = "#fff";
    const l = el("div", "l"); l.textContent = name;
    node.append(t, l); con.append(node);
  });
  box.append(con);
}
function renderApps() {
  const box = $("apps"); box.innerHTML = "";
  for (const a of POPULAR) {
    const card = el("div", "card" + (a.installed ? " installed" : ""));
    const ic = el("div", "ic"); ic.style.background = `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`; ic.innerHTML = svg(a.icon);
    const nm = el("div", "nm"); nm.textContent = a.name;
    const ds = el("div", "ds"); ds.textContent = a.desc;
    const meta = el("div", "meta"); meta.innerHTML = `<span class="star">★</span> ${a.rating} &nbsp; <span style="color:var(--faint)">${a.installs} installs</span>`;
    const btn = el("button", "install"); btn.textContent = a.installed ? "Open" : "Install"; btn.onclick = () => { if (a.url && a.url !== "#") window.open(a.url, "_blank", "noopener"); };
    card.append(ic, nm, ds, meta, btn); box.append(card);
  }
}
function renderCtxBar() {
  const box = $("ctxbar"); box.innerHTML = "";
  const who = el("div", "who2");
  who.innerHTML = `<div class="mk">N</div><div><div class="t">Your Context</div><div class="n">nailin.it <span class="live">Active</span></div></div>`;
  const stats = el("div", "stats");
  for (const [icon, val, label] of STATS) { const s = el("div", "stat"); s.innerHTML = svg(icon) + `<div><div class="v">${val}</div><div class="k">${label}</div></div>`; stats.append(s); }
  const acts = el("div", "acts");
  acts.innerHTML = `<button class="ghost">Open Context</button><button class="prim">Switch Context</button>`;
  box.append(who, stats, acts);
}

renderNav(); renderCtxs(); renderInstalled(); renderFeature(); renderApps(); renderCtxBar();
$("q").addEventListener("keydown", () => {}); // search wired on the Browse-all directory page
