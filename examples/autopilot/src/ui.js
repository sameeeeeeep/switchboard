/* ============================================================================
   AUTOPILOT — the cockpit UI. Everything here is DERIVED from the engine's
   decisions; nothing stores its own copy of a choice.
   ========================================================================= */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- top chrome ---------- */
function renderTop() {
  $("cosw").innerHTML = Object.values(ST.co).map((c) => `
    <button class="cotab ${c.id === ST.active ? "on" : ""}" data-co="${c.id}">
      <span class="cl" style="background:${c.color};color:${c.ink}">${c.glyph}</span>
      <span><span class="cn">${esc(c.name)}</span><br><span class="ck">${c.kindLabel}</span></span>
    </button>`).join("") +
    `<button class="cotab add" data-newco="1">+ New company</button>`;

  const c = CO(), pct = Math.min(100, (c.tokens.spent / c.tokens.budget) * 100);
  const areas = [["decide", "#C8F250"], ["found", "#5FD08A"], ["run", "#E9954A"], ["make", "#A78BFA"]];
  $("tokmeter").innerHTML = `
    <div class="tl"><span>TOKENS THIS WEEK</span><b>${fmtTok(c.tokens.spent)} / ${fmtTok(c.tokens.budget)}</b></div>
    <div class="tokbar">${areas.map(([k, col]) => {
      const w = ((c.tokens.by[k] || 0) / c.tokens.budget) * 100;
      return w > 0.2 ? `<i style="width:${w}%;background:${col}"></i>` : "";
    }).join("")}</div>`;
}

/* ---------- the deck ---------- */
function renderDeck() {
  const c = CO(), D = c.decisions;
  const voice = shownOf(D.voice), ad = shownOf(D.ad), next = shownOf(D.next);
  const pend = c.tasks.filter((t) => t.s === "pend").length;

  $("grid").innerHTML = `
  <div class="col"><div class="chead">COMPANY</div>
    <div class="card">
      <div class="idrow"><div class="idlogo" style="background:${c.color};color:${c.ink}">${c.glyph}</div>
        <div><h3>${esc(c.name)}</h3>
          <div class="status" style="margin-top:2px"><span class="pulse"></span>${esc(c.doing)}</div></div></div>
      <p class="blurb">${esc(c.blurb)}</p>
      <a class="sitelink" data-open="storefront">${c.site} ↗</a>
      <div style="margin-top:11px">
        ${c.stat.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join("")}
        <div class="kv"><span>Revenue</span><b class="na">— not connected</b></div>
      </div>
      <button class="fundbtn" data-open="tokens">Feed it tokens</button>
      <div class="fundnote">tokens are work — not a subscription</div>
    </div>
    <div class="card"><div class="ct">Decisions<span class="more">${Object.values(D).filter((d) => d.chosenId).length} of ${Object.keys(D).length} yours</span></div>
      ${Object.values(D).map((d) => decRow(d)).join("")}
    </div></div>

  <div class="col"><div class="chead">OPERATIONS</div>
    <div class="card"><div class="ct">Live operating log<span class="more">autonomous</span></div>
      <div class="log">${c.log.slice(0, 7).map((l) => `
        <div class="l ${l.s === "run" ? "run" : ""}" ${l.target ? `data-open="${l.target}"` : ""}>
          <span class="g">${l.s === "run" ? "⟳" : "✓"}</span>
          <span>${esc(l.t)}${l.s === "run" ? ' <span class="caret"></span>' : ""}</span></div>`).join("")}</div></div>
    <div class="card"><div class="ct">Tasks<span class="more">${pend} need you</span></div>
      ${c.tasks.map((t) => `<button class="row" data-task="${t.id}">
        <div class="rname">${esc(t.n)}</div><div class="rsub">${esc(t.d)}</div>
        <div class="rmeta"><span class="tag ${t.s === "run" ? "t-run" : "t-pend"}">${t.s === "run" ? "Running" : "Needs you"}</span>${esc(t.m)}</div>
      </button>`).join("")}</div>
    <div class="card"><div class="ct">Documents<span class="more">${c.docs.length}</span></div>
      ${c.docs.map(([id, n, t]) => `<button class="row" data-doc="${id}">
        <div class="rname">${esc(n)}<span class="tag t-art" style="margin-left:auto">${t}</span></div></button>`).join("")}</div></div>

  <div class="col"><div class="chead">GROWTH</div>
    <div class="card"><div class="ct">Ads<span class="more">${D.ad.chosenId ? "angle chosen" : "3 drafted"}</span></div>
      <button class="adcard" data-open="ad">
        <div class="adtop"><div class="adav">${c.glyph}</div>
          <div><div class="nm">${esc(c.name)}</div><div class="sp mono">Sponsored</div></div></div>
        ${adVisual(c, ad, 14)}
        <div class="adfoot"><div class="h">${esc(ad.ad.head)}</div><div class="b">${esc(ad.ad.cta)}</div></div></button>
      <div class="rmeta" style="margin:9px 2px 0">
        <span class="tag ${D.ad.chosenId ? "t-done" : "t-pend"}">${D.ad.chosenId ? "Chosen" : "Drafted"}</span>
        ${D.ad.chosenId ? "locked by you at " + D.ad.chosenAt : "nothing sends until you pick"}</div>
      <button class="ghostbtn" data-open="ad">${D.ad.chosenId ? "Change the angle →" : "Pick an angle →"}</button></div>
    <div class="card"><div class="ct">Voice<span class="more">${D.voice.chosenId ? "yours" : "drafted"}</span></div>
      <button class="row" data-open="voice">
        <div class="rname">${esc(voice.label)}</div>
        <div class="rsub">“${esc(voice.lines[0])}”</div>
        <div class="rmeta">${stateTag(D.voice)}${D.voice.chosenId ? "chosen " + D.voice.chosenAt : "tap to choose"}</div>
      </button></div></div>

  <div class="col"><div class="chead">STRATEGY</div>
    <div class="card"><div class="ct">What it decided<span class="more">today</span></div>
      <div class="fitem"><div class="fmeta"><span class="pulse" style="animation:none"></span><b>${esc(c.name)}</b><time>${now().slice(0,5)}</time></div>
        <div class="fbody">Voice is <span class="flink" data-open="voice">${esc(voice.label)}</span>${D.voice.chosenId ? " — your pick" : ", my draft"}. Every ad, page and outreach line below inherits it.</div></div>
      <div class="fitem"><div class="fmeta"><span class="pulse" style="animation:none"></span><b>${esc(c.name)}</b><time>${now().slice(0,5)}</time></div>
        <div class="fbody">${D.ad.chosenId ? "Running the " : "I'd run the "}<span class="flink" data-open="ad">${esc(ad.label.replace(" angle",""))}</span> angle — it answers the objection people actually have.</div></div>
      <div class="fitem"><div class="fmeta"><span class="pulse" style="animation:none"></span><b>${esc(c.name)}</b><time>${now().slice(0,5)}</time></div>
        <div class="fbody">${pend} thing${pend === 1 ? "" : "s"} staged and waiting on you. Nothing irreversible has happened.</div></div>
    </div>
    <div class="card"><div class="ct">Next move<span class="more">${D.next.options.length} approaches</span></div>
      <button class="row" data-open="next">
        <div class="rname">${esc(next.text)}</div>
        <div class="rsub">${esc(next.body || "")}</div>
        <div class="rmeta">${stateTag(D.next)}${D.next.chosenId ? "chosen " + D.next.chosenAt : "choose one, or write your own"}</div>
      </button></div></div>`;
}

const stateTag = (d) => d.chosenId
  ? `<span class="tag t-done">Yours</span>`
  : d.stale ? `<span class="tag t-run">Restreamed</span>` : `<span class="tag t-pend">Drafted</span>`;

function decRow(d) {
  const o = shownOf(d);
  return `<button class="row" data-open="${d.id}">
    <div class="rname">${esc(d.label)} · ${esc(o.label)}</div>
    <div class="rmeta">${stateTag(d)}${d.chosenId ? "locked " + d.chosenAt : d.options.length + " options"}</div>
  </button>`;
}

/* ---------- ad visual: D2C gets the photographic scene, SaaS a product shot ---------- */
function adVisual(c, adOpt, fs) {
  if (c.kind === "d2c") return `<div class="adscene">${sceneSVG()}${STEAM}${FINISH}
    <div class="adcopy"><h3${fs ? ` style="font-size:${fs}px"` : ""}>${esc(adOpt.ad.head)}</h3></div></div>`;
  return `<div class="adscene" style="background:linear-gradient(160deg,#101826,#1b2740 60%,#243352)">
    ${uiMock()}
    <div class="adcopy"><h3${fs ? ` style="font-size:${fs}px"` : ""}>${esc(adOpt.ad.head)}</h3></div></div>`;
}
/* a believable product screenshot, composed — no external image */
function uiMock() {
  return `<div style="position:absolute;inset:14% 10% 32% 10%;background:#0d1117;border:1px solid #2a3442;
      border-radius:9px;overflow:hidden;box-shadow:0 20px 50px -20px #000">
    <div style="display:flex;gap:5px;padding:8px 10px;border-bottom:1px solid #1e2836;align-items:center">
      <i style="width:7px;height:7px;border-radius:50%;background:#2a3442"></i>
      <i style="width:7px;height:7px;border-radius:50%;background:#2a3442"></i>
      <span style="margin-left:6px;font-family:var(--mono);font-size:7px;color:#5b6a7d">replydex — 41 new reviews</span></div>
    ${[["★★★★★","Answered in your voice.",1],["★★★★☆","Draft ready — 2 lines.",0],["★★★★★","Approved · pasted.",0]]
      .map(([st,tx,hot],i)=>`<div style="display:flex;gap:8px;padding:7px 10px;border-bottom:1px solid #161f2b;align-items:center">
        <span style="font-size:7px;color:#e9b34a">${st}</span>
        <span style="flex:1;font-size:8px;color:${hot?"#dbe8ff":"#7d8b9e"}">${tx}</span>
        <span style="font-size:6.5px;font-family:var(--mono);padding:2px 5px;border-radius:3px;
          background:${hot?"#C8F250":"#1e2836"};color:${hot?"#0b0d0a":"#5b6a7d"}">${hot?"DRAFT":"DONE"}</span></div>`).join("")}
  </div>`;
}

/* ---------- the preview pane ---------- */
const PANE_META = {
  voice: ["VOICE", "how it talks"], ad: ["AD CREATIVE", "the angle"],
  next: ["NEXT MOVE", "what widens"], tokens: ["TOKENS", "what work costs"],
  storefront: ["STOREFRONT", ""], task: ["TASK", ""], doc: ["DOCUMENT", ""],
};

function openPane(kind, arg) {
  const c = CO();
  const [k, t] = PANE_META[kind] || ["PREVIEW", ""];
  $("pkind").textContent = k;
  $("ptitle").textContent = kind === "task" ? (c.tasks.find((x) => x.id === arg) || {}).n || t
    : kind === "doc" ? ((c.docs.find((d) => d[0] === arg) || [])[1] || t)
    : kind === "storefront" ? c.site : t;
  $("pmeta").textContent = "";
  const b = $("pbody");
  b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
  b.innerHTML = paneBody(kind, arg);
  $("body").classList.add("open");
  ST.pane = { kind, arg };
}

function paneBody(kind, arg) {
  const c = CO(), D = c.decisions;
  if (D[kind]) return slate(c, D[kind]);
  if (kind === "tokens") return tokensPane(c);
  if (kind === "task") return taskPane(c, arg);
  if (kind === "doc") return docPane(c, arg);
  if (kind === "storefront") return storefrontPane(c);
  return "";
}

/* THE SLATE — this is the thing that was missing. Options you can actually
   choose, a lock that records who chose it, alternatives that survive, and a
   working escape hatch. */
function slate(c, d) {
  const chosen = optOf(d);
  return `
    <div class="mono" style="font-size:9px;color:var(--faint);letter-spacing:.1em">AXIS: ${d.axis}</div>
    ${d.stale ? `<div class="mono" style="font-size:9.5px;color:var(--run);margin-top:8px">
       ● restreamed — an upstream decision changed, so these were rewritten</div>` : ""}
    <div style="margin-top:12px">
      ${d.options.map((o) => optionCard(d, o)).join("")}
      <div class="optrow own" id="hatch">
        <div class="on2">none of these — say what you'd do instead</div>
        <div class="op">it becomes a real option, indistinguishable from the drafted ones.</div>
        <div class="hatchrow" id="hatchrow" style="display:none">
          <input id="hatchin" placeholder="describe what you'd do…" />
          <button class="hatchgo" id="hatchgo">use this</button>
        </div>
      </div>
    </div>
    ${chosen ? `<div class="sec">YOUR PICK</div>
      <div class="mono" style="font-size:9.5px;color:var(--faint);line-height:1.7">
        locked at ${d.chosenAt} · by you<br>
        ${d.id === "voice" ? "every ad, page and outreach line below is written in this voice." : ""}
        ${d.id === "ad" ? "this creative is staged as a draft. nothing sends until you fund it." : ""}
      </div>
      <button class="unbtn" data-unchoose="${d.id}">unlock — go back to drafted</button>` : ""}`;
}

function optionCard(d, o) {
  const chosen = isChosen(d, o), drafted = isDrafted(d, o);
  const lines = o.lines ? `<div class="olines">${o.lines.map((l) => `<div class="oline">“${esc(l)}”</div>`).join("")}</div>` : "";
  const adprev = o.ad ? `<div class="oad"><b>${esc(o.ad.head)}</b><span>${esc(o.ad.body)}</span></div>` : "";
  return `<button class="optrow ${chosen ? "chosen" : ""} ${drafted ? "drafted" : ""}" data-pick="${d.id}|${o.id}">
    ${o.rec && !chosen ? '<span class="rec draft">RECOMMENDED</span>' : ""}
    ${chosen ? '<span class="rec live">✓ CHOSEN BY YOU</span>' : ""}
    <div class="ol">${esc(o.label)}</div>
    <div class="on2">${esc(o.text || o.label)}</div>
    ${o.body ? `<div class="op">${esc(o.body)}</div>` : ""}
    ${o.text && !o.body && !o.lines && !o.ad ? "" : ""}
    ${lines}${adprev}
    ${drafted ? '<div class="draftnote">drafted by autopilot · tap to make it yours</div>' : ""}
  </button>`;
}

function tokensPane(c) {
  const T = [["Trickle", 500_000, "keeps one thing moving at a time"],
             ["Steady", 2_000_000, "a full week of drafting, staging and revising"],
             ["Push", 5_000_000, "it works ahead of you — expect more staged than you can read"]];
  const areas = [["found", "Founding decisions", "#5FD08A"], ["decide", "Your choices", "#C8F250"],
                 ["run", "Running work", "#E9954A"], ["make", "Making things", "#A78BFA"]];
  return `
  <div class="tokbig">
    <div class="tokn">${fmtTok(c.tokens.spent)}</div>
    <div class="toklab">tokens spent · ${fmtTok(c.tokens.budget)} budgeted this week</div>
  </div>
  <div class="sec">WHERE THEY WENT</div>
  ${areas.map(([k, n, col]) => {
    const v = c.tokens.by[k] || 0;
    return `<div class="tokrow"><span class="tk" style="background:${col}"></span>
      <span class="tn">${n}</span><span class="tv mono">${fmtTok(v)}</span></div>`;
  }).join("")}
  <div class="sec">FEED IT MORE</div>
  <div class="tiers">${T.map(([n, v, note]) => `
    <div class="tier ${v === c.tokens.budget ? "on" : ""}" data-budget="${v}">
      <span class="tl">${n}</span><span class="ta">${fmtTok(v)}/wk</span>
      <span class="tp">${note}</span></div>`).join("")}</div>
  <div class="mono" style="font-size:9px;color:var(--faint);margin-top:14px;line-height:1.8">
    you are not buying a subscription. you are giving the company capacity to work.<br>
    it runs as fast as you feed it, and stops when you stop.
  </div>
  <div class="mono" style="font-size:9px;color:var(--ember);margin-top:10px;line-height:1.7">
    ● tokens are the only number here that is real. revenue needs a connected store,<br>
    so it says “not connected” instead of drawing a chart of numbers that don't exist.
  </div>`;
}

function taskPane(c, id) {
  const t = c.tasks.find((x) => x.id === id) || c.tasks[0];
  return `<div style="font-size:19px;font-weight:750;letter-spacing:-.02em">${esc(t.n)}</div>
    <div style="font-size:12.5px;color:var(--dim);margin-top:8px;line-height:1.55">${esc(t.d)}</div>
    <div class="sec">STATUS</div>
    <div class="rmeta"><span class="tag ${t.s === "run" ? "t-run" : "t-pend"}">${t.s === "run" ? "Running" : "Needs you"}</span>${esc(t.m)}</div>
    <div class="sec">WHAT IT PRODUCED</div>
    <button class="row" data-doc="${t.doc}"><div class="rname">${esc((c.docs.find((d) => d[0] === t.doc) || [])[1] || "artifact")}</div>
      <div class="rsub">open the artifact →</div></button>
    <div class="sec">CONTROL</div>
    <div class="mono" style="font-size:9.5px;color:var(--faint);line-height:1.75">
      ${t.s === "pend" ? "staged and waiting on you — nothing has been sent." : "running on its own — pause it any time."}</div>`;
}

function docPane(c, id) {
  const V = shownOf(c.decisions.voice);
  const doc = c.docs.find((d) => d[0] === id) || c.docs[0];
  const body = c.kind === "d2c" ? {
    d1: `<p><b>Positioning.</b> Specialty-grade coffee that holds up where a kettle can't go.</p>
         <p><b>Voice — ${esc(V.label)}.</b> ${esc(V.text)}</p>
         <div class="quote">“${esc(V.lines[0])}”</div>
         <p><b>Never.</b> No kettle-shaming. No fake testimonials. No discounting below $18.</p>`,
    d2: `<p>Three angles on the locked palette, each answering a different objection.</p>
         <ul>${VOICE_SETS.d2c.map((v) => `<li><b>${esc(v.label)}</b> — “${esc(v.ad.head)}”</li>`).join("")}</ul>
         <p>Nothing publishes until the ad set is funded.</p>`,
    d3: `<p><b>Spec.</b> Freeze-dried single origin, 3.5g sachet, cold-soluble under 90 seconds.</p>
         <ul><li>MOQ 5,000 units</li><li>Lead time 21 days</li><li>Unit cost $1.14</li></ul>`,
    d4: `<p>Organised by <b>format</b>: the tin is the hero, the sachet is the trail unit.</p>
         <ul><li><b>Trail Tin</b> — $28 · live</li><li><b>Sachet 6-pack</b> — $16 · live</li></ul>`,
  } : {
    d1: `<p><b>Who it's for.</b> Single- and multi-location med-spas drowning in Google reviews.</p>
         <p><b>Voice — ${esc(V.label)}.</b> ${esc(V.text)}</p>
         <div class="quote">“${esc(V.lines[0])}”</div>
         <p><b>Never.</b> Never confirm a patient relationship. Never auto-send.</p>`,
    d2: `<p>How a reply gets written, in ${esc(V.label)}:</p>
         <ul>${V.lines.map((l) => `<li>“${esc(l)}”</li>`).join("")}</ul>
         <p>Every draft is held for the owner to read. Nothing posts on its own.</p>`,
    d3: `<p>40 med-spa decision-makers, from published addresses only.</p>
         <ul><li>No scraped contact forms</li><li>Personalised from the practice's own reviews</li>
         <li>Held as drafts — nothing sent</li></ul>`,
    d4: `<p><b>$39 reply pack.</b> Priced against the hour an owner spends replying, not against software.</p>`,
  };
  return `<div class="docpage"><h4>${esc(doc[1])}</h4>
    <div class="meta">ARTIFACT · WRITTEN IN ${esc(V.label).toUpperCase()}</div>
    ${body[doc[0]] || "<p>—</p>"}</div>`;
}

function storefrontPane(c) {
  const V = shownOf(c.decisions.voice);
  if (c.kind === "d2c") return `<div class="browser"><div class="bchrome">
    <div class="bdots"><i></i><i></i><i></i></div><div class="burl">${c.site}</div></div>
    <div class="site"><div class="sitehero"><div class="sitewm">FIRSTLIGHT</div>
      <h1 class="siteh1">${esc(shownOf(c.decisions.ad).ad.head)}</h1>
      <div class="sitesub">${esc(V.lines[0])}</div>
      <div class="sitebuy"><span class="sitebtn">Add to bag</span><span class="siteprice">${c.price}</span></div>
      <div class="sitetin">${tinHTML(84)}</div></div>
    <div class="sitebenefits">
      <div class="ben"><div class="bn">90 seconds</div><div class="bd">Cold or hot water.</div></div>
      <div class="ben"><div class="bn">42 grams</div><div class="bd">Lighter than your mug.</div></div>
      <div class="ben"><div class="bn">One farm</div><div class="bd">Traceable to the lot.</div></div></div></div></div>
    <div class="mono" style="font-size:9px;color:var(--faint);margin-top:10px">● live · restyles when the voice changes</div>`;
  return `<div class="browser"><div class="bchrome">
    <div class="bdots"><i></i><i></i><i></i></div><div class="burl">${c.site}</div></div>
    <div class="site"><div class="sitehero"><div class="sitewm">REPLYDEX</div>
      <h1 class="siteh1">${esc(shownOf(c.decisions.ad).ad.head)}</h1>
      <div class="sitesub">${esc(V.lines[0])}</div>
      <div class="sitebuy"><span class="sitebtn">Draft my replies</span><span class="siteprice">${c.price}</span></div></div>
    <div class="sitebenefits">
      <div class="ben"><div class="bn">In your voice</div><div class="bd">Learned from how you already write.</div></div>
      <div class="ben"><div class="bn">Nothing auto-sends</div><div class="bd">You approve every reply.</div></div>
      <div class="ben"><div class="bn">Paste-ready</div><div class="bd">One doc, done before coffee.</div></div></div></div></div>
    <div class="mono" style="font-size:9px;color:var(--faint);margin-top:10px">● live · restyles when the voice changes</div>`;
}

/* ---------- render + events ---------- */
function render() {
  renderTop(); renderDeck();
  if (ST.pane) { const b = $("pbody"); b.innerHTML = paneBody(ST.pane.kind, ST.pane.arg); }
}

document.addEventListener("click", (e) => {
  const co = e.target.closest("[data-co]");
  if (co) { ST.active = co.dataset.co; ST.pane = null; $("body").classList.remove("open"); save(); render(); return; }
  if (e.target.closest("[data-newco]")) { openPane("tokens"); return; }

  const pick = e.target.closest("[data-pick]");
  if (pick) {
    const [did, oid] = pick.dataset.pick.split("|");
    const c = CO(), d = c.decisions[did];
    if (d.chosenId === oid) return;           // already yours
    choose(c, d, oid);
    logLine(c, "you chose " + shownOf(d).label + " for " + d.label.toLowerCase(), "done", did);
    render(); return;
  }
  const un = e.target.closest("[data-unchoose]");
  if (un) { const c = CO(); unchoose(c, c.decisions[un.dataset.unchoose]); render(); return; }

  if (e.target.closest("#hatch") && !e.target.closest("#hatchrow")) {
    const r = $("hatchrow"); if (r) { r.style.display = "flex"; $("hatchin").focus(); } return;
  }
  if (e.target.closest("#hatchgo")) {
    const v = $("hatchin").value.trim(); if (!v) return;
    const c = CO(), d = c.decisions[ST.pane.kind];
    ownOption(c, d, v); render(); return;
  }
  const bud = e.target.closest("[data-budget]");
  if (bud) { CO().tokens.budget = +bud.dataset.budget; save(); render(); return; }

  const task = e.target.closest("[data-task]");
  if (task) { openPane("task", task.dataset.task); return; }
  const doc = e.target.closest("[data-doc]");
  if (doc) { openPane("doc", doc.dataset.doc); return; }
  const op = e.target.closest("[data-open]");
  if (op) { openPane(op.dataset.open); return; }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "hatchin") { $("hatchgo").click(); }
  if (e.key === "Escape") { ST.pane = null; $("body").classList.remove("open"); }
});

/* pane resize */
(function () {
  const body = $("body"), sp = $("split");
  const setW = (px) => body.style.setProperty("--pw",
    Math.round(Math.min(Math.max(px, 380), window.innerWidth - 420)) + "px");
  let on = false;
  sp.addEventListener("pointerdown", (e) => { if (!body.classList.contains("open")) return;
    on = true; sp.setPointerCapture(e.pointerId); sp.classList.add("drag"); body.classList.add("dragging"); });
  sp.addEventListener("pointermove", (e) => { if (on) setW(window.innerWidth - e.clientX); });
  const end = (e) => { if (!on) return; on = false; try { sp.releasePointerCapture(e.pointerId); } catch (_) {}
    sp.classList.remove("drag"); body.classList.remove("dragging"); };
  sp.addEventListener("pointerup", end); sp.addEventListener("pointercancel", end);
  sp.addEventListener("dblclick", () => setW(520));
  $("pclose").onclick = () => { ST.pane = null; body.classList.remove("open"); };
  $("pwide").onclick = () => { const cur = parseInt(getComputedStyle(body).getPropertyValue("--pw")) || 520;
    setW(cur > window.innerWidth * .5 ? 520 : window.innerWidth - 460); };
})();

boot();
render();
openPane("voice");
