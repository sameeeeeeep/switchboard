// The store HOME — itself a wrapp. The catalog works for anyone; connect Switchboard and the page
// lights up with YOUR library: every brand, your personal card, your data sources — real names via
// the consented library-visibility primitive (contextKinds at connect → context.list() metas).
// Nothing here is decorative data: no context flows until the user approves the one consent row,
// and the page never sees context DATA at all — names and kinds only, which is all a home needs.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
// Every kind the library can hold today; new kinds simply don't show until added here.
const KINDS = ["brand", "personal", "project", "csv", "gsheet", "note"];

let relay = null;
const way = { installed: false, connected: false, brands: 0, checkedLibrary: false };

// ---------- the way: a stepper that reflects REALITY, and routes the click to the next move ----------
const STEPS = [
  {
    title: "Get Switchboard",
    sub: "the extension + sidekick that lend apps your Claude",
    done: () => way.installed,
    act: () => window.open("https://thelastprompt.ai/switchboard/", "_blank", "noreferrer"),
    doneSub: "installed — your AI has a body",
  },
  {
    title: "Connect this page",
    sub: "one consent — then this home shows what you own",
    done: () => way.connected,
    act: () => document.querySelector("#chip-dock button")?.click(),
    doneSub: "connected — the shelf below is live",
  },
  {
    title: "Put a brand in the bank",
    sub: "build one in brandbrain — or import your existing site",
    done: () => way.brands > 0,
    act: () => window.open("https://brandbrain.thelastprompt.ai/build", "_blank", "noreferrer"),
    doneSub: () => `${way.brands} brand${way.brands === 1 ? "" : "s"} banked — every app below can borrow them`,
  },
  {
    title: "Point an app at it",
    sub: "open any app — it asks for what it needs, you approve once",
    done: () => false, // always the standing invitation
    act: () => document.querySelector('a.card[href*="adpulse"]')?.scrollIntoView({ behavior: "smooth", block: "center" }),
    currentSub: "the founder stack below runs on the brand you just banked",
  },
];
function renderWay() {
  const box = $("way");
  box.textContent = "";
  let currentMarked = false;
  STEPS.forEach((s, i) => {
    const done = s.done();
    const isCurrent = !done && !currentMarked;
    if (isCurrent) currentMarked = true;
    const card = document.createElement("div");
    card.className = "step " + (done ? "done" : isCurrent ? "current" : "todo");
    const n = document.createElement("div"); n.className = "n"; n.textContent = `STEP ${i + 1}`;
    const h = document.createElement("h5"); h.textContent = s.title;
    const p = document.createElement("p");
    p.textContent = done ? (typeof s.doneSub === "function" ? s.doneSub() : s.doneSub || s.sub) : (isCurrent && s.currentSub) ? s.currentSub : s.sub;
    const st = document.createElement("div"); st.className = "state"; st.textContent = done ? "✓" : isCurrent ? "→" : "";
    card.append(n, h, p, st);
    card.onclick = () => s.act();
    box.append(card);
  });
}

// ---------- the standard chip (identity-only: home lists the library, it doesn't consume one context) ----------
mountConnect($("chip-dock"), {
  scope: { reason: "your Switchboard home — show your library on the shelf", contextKinds: KINDS },
  context: "none",
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; way.installed = true; way.connected = true; renderWay(); void renderLibrary(); },
  onDisconnect: () => { relay = null; way.connected = false; renderWay(); renderLibraryEmpty("Connect Switchboard (top right) and your brands appear here."); },
});
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    way.installed = true;
    const grant = await r.permissions().catch(() => null);
    if (grant) { relay = r; way.connected = true; renderWay(); void renderLibrary(); return; }
    renderLibraryEmpty("Connect Switchboard (top right) and your brands appear here.");
  } else {
    renderLibraryEmpty("Everything below works as a catalog. With Switchboard installed, this shelf shows your own brands.");
  }
  renderWay();
})();
renderWay(); // first paint — before the probe answers

// ---------- your library ----------
const KIND_LABEL = { brand: "Brands", personal: "You", project: "Projects", csv: "Data sources", gsheet: "Data sources", note: "Notes" };
const KIND_ORDER = ["Brands", "You", "Projects", "Data sources", "Notes"];

async function renderLibrary() {
  if (!relay) return;
  let metas = [];
  try { metas = await relay.context.list(); } catch { /* older daemon or grant without the row */ }
  way.brands = metas.filter((m) => (m.kind || "").toLowerCase() === "brand").length;
  way.checkedLibrary = true;
  renderWay();
  if (!metas.length) {
    renderLibraryEmpty("No contexts yet — build a brand in brandbrain, or add your details in the Switchboard panel.");
    return;
  }
  const box = $("library");
  box.textContent = "";
  const groups = new Map();
  for (const m of metas) {
    const label = KIND_LABEL[(m.kind || "").toLowerCase()] || "Other";
    (groups.get(label) ?? groups.set(label, []).get(label)).push(m);
  }
  const names = [...groups.keys()].sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a), ib = KIND_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  for (const g of names) {
    const kicker = document.createElement("div");
    kicker.className = "lib-kicker";
    kicker.textContent = g;
    box.append(kicker);
    const row = document.createElement("div");
    row.className = "lib-row";
    for (const m of groups.get(g)) {
      const card = document.createElement("div");
      card.className = "lib-card";
      const mk = document.createElement("span");
      mk.className = "lib-mk";
      mk.textContent = (m.name || "•")[0].toUpperCase();
      const nm = document.createElement("span");
      nm.className = "lib-nm";
      nm.textContent = m.name;
      card.append(mk, nm);
      if (m.sourceKind) {
        const b = document.createElement("span");
        b.className = "lib-badge";
        b.textContent = `live · ${m.rowCount ?? 0} rows`;
        card.append(b);
      }
      row.append(card);
    }
    box.append(row);
  }
  const foot = document.createElement("div");
  foot.className = "lib-foot";
  foot.textContent = "Lending happens per app — each app you connect asks for what it needs, and remembers its own pick.";
  box.append(foot);
  $("library-sec").hidden = false;
}

function renderLibraryEmpty(text) {
  const box = $("library");
  box.textContent = "";
  const d = document.createElement("div");
  d.className = "lib-empty";
  d.textContent = text;
  box.append(d);
  $("library-sec").hidden = false;
}

// ---------- catalog search (client-side, instant) ----------
const search = $("search");
search.addEventListener("input", () => {
  const q = search.value.trim().toLowerCase();
  let any = false;
  document.querySelectorAll("a.card, a.featured").forEach((card) => {
    const hit = !q || (card.textContent + " " + (card.dataset.tags || "")).toLowerCase().includes(q);
    card.style.display = hit ? "" : "none";
    if (hit) any = true;
  });
  document.querySelectorAll(".sec-h").forEach((h) => {
    // hide a section header when everything under it is filtered out
    let el = h.nextElementSibling;
    let visible = false;
    while (el && !el.classList.contains("sec-h")) {
      if ((el.matches("a.card, a.featured") && el.style.display !== "none") ||
          el.querySelector?.("a.card:not([style*='none'])")) visible = true;
      el = el.nextElementSibling;
    }
    h.style.display = visible ? "" : "none";
  });
  $("no-hits").hidden = any;
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); search.focus(); }
});
