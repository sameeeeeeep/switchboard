// missions.js — the GAME layer on top of the Marine Drive world: colleagues/vendors stand at marked
// buildings, give you a task ("go there, do that"), and your agent does the work while you steer it
// (brief → decide → draft → approve → reward). Self-contained: it injects its own HUD + scene UI and
// owns the NPC markers in the 3D scene. main.js wires it in with a few hooks.
//
// Switchboard: when connected, this is where the user's REAL tasks get fetched and baked into missions.
// For now `connected` is a dummy toggle and the missions are canned — but the shape is the real one.

// ---------------------------------------------------------------- content (dummy — the real ones arrive via Switchboard)
const NPCS = {
  ravi:  { name: "Ravi",   role: "packaging vendor",  channel: "whatsapp", color: "#ffb56b", accent: "#3a2410" },
  meera: { name: "Meera",  role: "ops lead · colleague", channel: "slack",  color: "#7fd4ff", accent: "#10283a" },
};
const MISSIONS = [
  {
    id: "vendor-quote", npc: "ravi", title: "Counter the vendor quote", reward: { cash: 420, rep: 18 },
    hook: "Boss! Final numbers: 18% off locks at 5k MOQ. You keep saying 4k — send me something in writing today and I'll push my guy before he flies to Guangzhou.",
    options: [
      { rec: true, label: "Counter firm at 4k MOQ — same 18%, cite the Piqual reorder", title: "WhatsApp → Ravi", drafts: [
        "Ravi — let's close this today. 4k MOQ at the same 18%: the Piqual reorder landed 3 weeks early, so volume risk on our side is basically zero. Lock 4k now and I'll commit the festive run to you exclusively. Deal memo tonight?",
        "Ravi bhai — 4k at 18% and we sign today. Piqual reorders came early, festive run is confirmed — you'll clear 5k across the quarter anyway, just not in one PO. Exclusive festive commitment if your guy says yes before his flight." ] },
      { label: "Accept 5k MOQ — take the discount, split delivery", title: "WhatsApp → Ravi", drafts: [
        "Ravi — okay, 5k at 18% works IF we split delivery: 3k now, 2k post-Diwali, payment on each drop. Send the revised PI today and it's done.",
        "Done at 5k/18% on one condition — staggered delivery, 3k + 2k, invoice per drop. Confirm and I'll send the PO tonight." ] },
      { label: "Stall a week — waiting on the festive volumes", title: "WhatsApp → Ravi", drafts: [
        "Ravi — don't let him board that flight angry 😄 I need 5 working days: festive volumes confirm Friday and that decides 4k vs 6k. Hold the 18% till then and I'll make it worth the wait.",
        "One week, Ravi. Festive numbers land Friday — could push me PAST 5k. Hold the price till the 18th and you get the bigger order." ] },
    ],
    doneToast: "✉ <b>Reply drafted</b> — vendor task closed. With Switchboard connected this lands in WhatsApp as a draft you already approved.",
  },
  {
    id: "ops-standup", npc: "meera", title: "Unblock the ops standup", reward: { cash: 260, rep: 12 },
    hook: "Standup in 20 and the festive packaging ETA is the one red item. Can you give me a line I can paste in the channel so we're not stuck on it again?",
    options: [
      { rec: true, label: "Commit a date + the fallback, keep it short", title: "Slack → #ops", drafts: [
        "Festive packaging: locking 4k MOQ with Ravi at 18% today, goods in by the 21st. Fallback if his guy stalls: bridge with the Piqual stock (covers week 1). Not a blocker — I'll post the signed PO here by EOD.",
        "Packaging ETA: 21st, 4k @ 18% (Ravi). Risk covered — Piqual bridge stock handles any slip. Marking this green; PO in-thread by EOD." ] },
      { label: "Flag the risk, ask for one more day", title: "Slack → #ops", drafts: [
        "Packaging still amber: 4k-vs-5k MOQ with the vendor decides the date. Give me till tomorrow AM — festive volumes land Friday and I don't want to over-commit the PO.",
        "Need 24h on packaging — MOQ call hinges on Friday's festive numbers. Will post a firm date tomorrow; holding the vendor's 18% in the meantime." ] },
    ],
    doneToast: "✉ <b>Standup line drafted</b> — Meera's unblocked. Connected, this posts to #ops as your approved message.",
  },
];
const byId = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

// ---------------------------------------------------------------- UI (injected — keeps index.html untouched)
const CSS = `
:root{ --lig-panel:rgba(16,7,38,.94); --lig-edge:rgba(255,122,189,.32); --lig-ink:#fff3e8; --lig-dim:#d9b8c9; --lig-faint:#a583a0; --lig-pink:#ff5fa2; --lig-teal:#2de1c2; --lig-lime:#c8f250; --lig-gold:#ffcf6b; }
.lig{ position:fixed; z-index:20; font-family:ui-monospace,"SF Mono",Menlo,monospace; color:var(--lig-ink); }
.lig[hidden]{ display:none!important; }
#lig-objective{ left:18px; top:64px; background:var(--lig-panel); border:1px solid var(--lig-edge); border-radius:10px; padding:9px 13px; font-size:11px; letter-spacing:.06em; max-width:320px; text-transform:uppercase; }
#lig-objective .lab{ color:var(--lig-faint); } #lig-objective b{ color:var(--lig-gold); }
#lig-stats{ left:18px; top:110px; display:flex; gap:14px; background:var(--lig-panel); border:1px solid var(--lig-edge); border-radius:10px; padding:8px 12px; font-weight:700; font-size:12px; }
#lig-stats .c{ color:var(--lig-lime); } #lig-stats .r{ color:var(--lig-teal); }
#lig-connect{ right:22px; top:70px; pointer-events:auto; cursor:pointer; background:var(--lig-panel); border:1px solid var(--lig-edge); border-radius:10px; padding:9px 13px; font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--lig-dim); }
#lig-connect:hover{ border-color:var(--lig-pink); } #lig-connect.on{ border-color:rgba(45,225,194,.6); color:var(--lig-teal); }
#lig-connect .dot{ display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--lig-faint); margin-right:7px; vertical-align:1px; } #lig-connect.on .dot{ background:var(--lig-teal); box-shadow:0 0 8px var(--lig-teal); }
#lig-waypoint{ transform:translate(-50%,-100%); pointer-events:none; font-size:11px; font-weight:700; letter-spacing:.08em; color:var(--lig-lime); text-shadow:0 2px 8px #000; white-space:nowrap; }
#lig-waypoint .pin{ display:block; text-align:center; font-size:16px; line-height:1; animation:ligbob 1s ease-in-out infinite; }
@keyframes ligbob{ 50%{ transform:translateY(-4px); } }
#lig-prompt{ left:50%; bottom:76px; transform:translateX(-50%); background:var(--lig-panel); border:1px solid var(--lig-edge); border-radius:10px; padding:9px 14px; font-size:11px; letter-spacing:.06em; text-transform:uppercase; }
#lig-prompt b{ color:var(--lig-lime); background:rgba(200,242,80,.12); border:1px solid rgba(200,242,80,.5); border-radius:5px; padding:2px 7px; margin-right:8px; }
#lig-toast{ left:50%; top:20px; transform:translateX(-50%); background:var(--lig-panel); border:1px solid var(--lig-edge); border-radius:10px; padding:11px 16px; font-size:12.5px; max-width:480px; text-align:center; opacity:0; transition:opacity .3s; } #lig-toast.show{ opacity:1; } #lig-toast b{ color:var(--lig-lime); }
#lig-scene{ inset:0; z-index:30; display:flex; flex-direction:column; justify-content:flex-end; background:linear-gradient(180deg,rgba(10,4,24,.55),rgba(10,4,24,0) 20%,rgba(10,4,24,0) 55%,rgba(10,4,24,.92)); }
#lig-panel{ margin:0 auto 26px; width:min(660px,calc(100% - 36px)); background:#140a24; border:1px solid var(--lig-edge); border-radius:16px; padding:16px; box-shadow:0 18px 60px rgba(0,0,0,.55); pointer-events:auto; }
#lig-head{ display:flex; gap:12px; align-items:center; }
#lig-av{ width:52px; height:52px; border-radius:10px; border:1px solid var(--lig-edge); display:grid; place-items:center; font-weight:700; font-size:20px; flex:none; }
#lig-name{ font-weight:700; font-size:14px; } #lig-role{ margin-top:3px; font-size:10px; color:var(--lig-faint); text-transform:uppercase; letter-spacing:.08em; }
#lig-chan{ margin-left:auto; font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--lig-teal); border:1px solid rgba(45,225,194,.5); border-radius:6px; padding:4px 8px; }
#lig-steps{ display:flex; gap:6px; margin-top:12px; }
#lig-steps span{ flex:1; text-align:center; font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--lig-faint); border:1px solid var(--lig-edge); border-radius:6px; padding:5px 0; }
#lig-steps span.on{ color:var(--lig-lime); border-color:rgba(200,242,80,.6); background:rgba(200,242,80,.08); }
#lig-steps span.done{ color:var(--lig-teal); } #lig-steps span.done::before{ content:"✓ "; }
#lig-text{ margin-top:12px; min-height:42px; font-size:14px; line-height:1.6; white-space:pre-wrap; }
#lig-text .cur,#lig-draftbody .cur{ display:inline-block; width:8px; height:14px; background:var(--lig-pink); vertical-align:-2px; animation:ligblink .9s steps(1) infinite; } @keyframes ligblink{ 50%{ opacity:0; } }
#lig-options{ margin-top:14px; display:grid; gap:8px; }
#lig-options button{ text-align:left; font-size:13px; line-height:1.45; color:var(--lig-ink); background:rgba(255,255,255,.04); border:1px solid var(--lig-edge); border-radius:10px; padding:10px 12px; cursor:pointer; }
#lig-options button:hover{ border-color:var(--lig-pink); background:rgba(255,95,162,.08); }
#lig-options button .pick{ font-size:11px; color:var(--lig-pink); margin-right:8px; font-weight:700; }
#lig-options button.rec{ border-color:rgba(200,242,80,.55); } #lig-options button.rec::after{ content:"RECOMMENDED"; float:right; font-size:8px; letter-spacing:.1em; color:var(--lig-lime); font-weight:700; margin-top:3px; }
#lig-draft{ margin-top:14px; }
#lig-agent{ display:flex; align-items:center; gap:8px; font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--lig-teal); }
#lig-agent .spin{ width:8px; height:8px; background:var(--lig-teal); transform:rotate(45deg); animation:ligspin 1.1s linear infinite; } @keyframes ligspin{ to{ transform:rotate(405deg); } }
#lig-paper{ margin-top:10px; background:#fdf6ec; color:#241626; border-radius:10px; padding:14px 16px; box-shadow:0 8px 26px rgba(0,0,0,.4); cursor:pointer; }
#lig-drafttitle{ font-size:12.5px; color:#6b4a63; border-bottom:1px solid #e8d9c8; padding-bottom:8px; margin-bottom:8px; }
#lig-draftbody{ font-size:13px; line-height:1.65; white-space:pre-wrap; min-height:56px; }
#lig-actions{ margin-top:12px; display:flex; gap:8px; }
#lig-actions button{ font-size:10px; letter-spacing:.08em; text-transform:uppercase; border-radius:10px; padding:11px 14px; cursor:pointer; border:1px solid var(--lig-edge); background:none; color:var(--lig-dim); font-weight:700; }
#lig-actions .go{ background:var(--lig-lime); border-color:var(--lig-lime); color:#1c2405; }
#lig-splash{ inset:0; z-index:31; display:grid; place-items:center; background:radial-gradient(ellipse at center,rgba(10,4,24,0) 30%,rgba(10,4,24,.6)); opacity:0; transition:opacity .25s; } #lig-splash.show{ opacity:1; }
#lig-splash .big{ font-size:30px; font-weight:700; letter-spacing:.04em; color:var(--lig-gold); text-align:center; text-shadow:0 4px 0 #000,0 0 42px rgba(255,207,107,.6); }
#lig-splash .sub{ margin-top:10px; font-size:12px; color:var(--lig-ink); text-align:center; } #lig-splash .sub em{ font-style:normal; color:var(--lig-teal); }
`;

const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

export function initMissions(hooks) {
  const { THREE, scene, camera, getPlayer, getMode, blocked } = hooks;

  // save/progression
  const save = { cash: 0, rep: 0, done: [] };
  let connected = false;
  // per-NPC mission state; NPCs (and Ravi's mission) exist from the start; Switchboard "adds" Meera's.
  MISSIONS.forEach((m) => (m.state = m.npc === "ravi" ? "available" : "locked"));

  // --- inject styles + HUD/scene DOM ---
  document.head.appendChild(el(`<style>${CSS}</style>`));
  const objEl = el(`<div class="lig" id="lig-objective"><span class="lab">objective</span> <b>—</b></div>`);
  const statsEl = el(`<div class="lig" id="lig-stats"><span class="c">$<span id="lig-cash">0</span></span><span class="r">REP <span id="lig-rep">0</span></span></div>`);
  const connEl = el(`<div class="lig" id="lig-connect"><span class="dot"></span>Connect Switchboard</div>`);
  const wpEl = el(`<div class="lig" id="lig-waypoint" hidden><span class="pin">▾</span><span class="lbl"></span></div>`);
  const promptEl = el(`<div class="lig" id="lig-prompt" hidden><b>E</b><span></span></div>`);
  const toastEl = el(`<div class="lig" id="lig-toast"></div>`);
  const splashEl = el(`<div class="lig" id="lig-splash" hidden><div><div class="big">TASK CLOSED</div><div class="sub"></div></div></div>`);
  const sceneEl = el(`<div class="lig" id="lig-scene" hidden><div id="lig-panel">
    <div id="lig-head"><div id="lig-av"></div><div><div id="lig-name"></div><div id="lig-role"></div></div><span id="lig-chan"></span></div>
    <div id="lig-steps"><span class="on">brief</span><span>decide</span><span>draft</span><span>send</span></div>
    <div id="lig-text"></div><div id="lig-options"></div>
    <div id="lig-draft" hidden><div id="lig-agent"><span class="spin"></span><span id="lig-agenttext">your agent is drafting…</span></div>
      <div id="lig-paper"><div id="lig-drafttitle"></div><div id="lig-draftbody"></div></div>
      <div id="lig-actions" hidden><button class="go" id="lig-approve">✓ approve &amp; send</button><button id="lig-tweak">↻ redraft</button><button id="lig-cancel">esc</button></div>
    </div></div></div>`);
  [objEl, statsEl, connEl, wpEl, promptEl, toastEl, splashEl, sceneEl].forEach((n) => document.body.appendChild(n));
  const $ = (id) => document.getElementById(id);

  let toastT = 0;
  const toast = (html, ms = 4200) => { toastEl.innerHTML = html; toastEl.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("show"), ms); };
  const updStats = () => { $("lig-cash").textContent = save.cash; $("lig-rep").textContent = save.rep; };

  // --- NPC markers in the 3D world: a glowing beacon + a floating pin billboard on the marked building ---
  const npcs = [];   // { id, x, z, def, beacon, pinTex }
  function placeNPC(id, x, z) {
    // nudge to a walkable spot so nobody spawns inside a wall
    let sx = x, sz = z;
    for (let r = 0; r < 8 && blocked(sx, sz); r++) { sx = x + (r % 2 ? r : -r); }
    const def = NPCS[id];
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.0, 28), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 22, 12, 1, true), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 11; g.add(beam);
    const cv = document.createElement("canvas"); cv.width = cv.height = 64;
    const c = cv.getContext("2d"); c.fillStyle = def.color; c.beginPath(); c.arc(32, 26, 22, 0, 7); c.fill();
    c.fillStyle = "#140a24"; c.font = "bold 26px monospace"; c.textAlign = "center"; c.fillText(def.name[0], 32, 35);
    c.fillStyle = def.color; c.beginPath(); c.moveTo(20, 44); c.lineTo(44, 44); c.lineTo(32, 58); c.fill();
    const pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false })); pin.scale.set(3, 3, 1); pin.position.y = 6; g.add(pin);
    g.position.set(sx, 0, sz); scene.add(g);
    npcs.push({ id, x: sx, z: sz, def, group: g, ring, beam, pin });
  }
  // Ravi at the player's start block; Meera a little further down the drive (revealed on connect)
  const p0 = getPlayer();
  placeNPC("ravi", p0.x + 9, p0.y - 4);
  placeNPC("meera", p0.x + 12, p0.y + 26);
  npcs.find((n) => n.id === "meera").group.visible = false;   // revealed when Switchboard syncs her task

  const activeMission = () => MISSIONS.find((m) => m.state === "available");
  function refreshObjective() {
    const m = activeMission();
    objEl.querySelector("b").textContent = m ? `GO TO ${NPCS[m.npc].name.toUpperCase()} · ${m.title}` : (MISSIONS.every((x) => x.state === "done") ? "ALL TASKS CLOSED" : "CONNECT SWITCHBOARD FOR TASKS");
  }
  refreshObjective(); updStats();

  // --- Switchboard connect (dummy fetch → bakes tasks into missions) ---
  connEl.addEventListener("click", () => {
    if (connected) return;
    connected = true; connEl.classList.add("on"); connEl.innerHTML = `<span class="dot"></span>Switchboard · synced`;
    MISSIONS.forEach((m) => { if (m.state === "locked") m.state = "available"; });   // unlock the "fetched" tasks
    const nMeera = npcs.find((n) => n.id === "meera"); if (nMeera) nMeera.group.visible = true;
    toast("⚡ <b>Switchboard connected</b> — 1 new task synced from your workspace. (dummy) Real tasks bake into missions here.", 5200);
    refreshObjective();
  });

  // ---------------------------------------------------------------- interaction + mission scene
  let near = null;                       // nearest actionable npc
  let mission = null, option = null, variant = 0, typer = null;

  function update() {
    const p = getPlayer(), walk = getMode() === "walk";
    for (const n of npcs) { n.ring.rotation.z += 0.02; n.pin.material.opacity = 0.85 + 0.15 * Math.sin(performance.now() / 300); }
    // nearest available NPC
    near = null; let best = 7 * 7;
    if (walk && !mission) for (const n of npcs) {
      const m = MISSIONS.find((x) => x.npc === n.id);
      if (!m || m.state !== "available") continue;
      const d = (n.x - p.x) ** 2 + (n.z - p.y) ** 2; if (d < best) { best = d; near = n; }
    }
    promptEl.hidden = !near;
    if (near) promptEl.querySelector("span").textContent = ` talk to ${near.def.name}`;
    // waypoint over the active mission's NPC (screen-projected) — the GTA "go there" marker
    const m = activeMission(); const wp = m && !mission ? npcs.find((n) => n.id === m.npc) : null;
    if (wp) {
      const v = new THREE.Vector3(wp.x, 7, wp.z).project(camera);
      if (v.z < 1) { wpEl.hidden = false; wpEl.style.left = (v.x * 0.5 + 0.5) * innerWidth + "px"; wpEl.style.top = (-v.y * 0.5 + 0.5) * innerHeight + "px"; wpEl.querySelector(".lbl").textContent = wp.def.name; }
      else wpEl.hidden = true;
    } else wpEl.hidden = true;
  }

  function tryInteract() {
    if (mission) return false;
    if (near) { const m = MISSIONS.find((x) => x.npc === near.id && x.state === "available"); if (m) { openMission(m); return true; } }
    return false;
  }

  const setStep = (n) => sceneEl.querySelectorAll("#lig-steps span").forEach((s, i) => (s.className = i < n ? "done" : i === n ? "on" : ""));
  function typeInto(node, text, done) {
    if (typer) clearInterval(typer);
    node.innerHTML = ""; const span = document.createElement("span"), cur = document.createElement("span"); cur.className = "cur"; node.append(span, cur);
    let i = 0; const step = Math.max(1, Math.round(text.length / 60));
    typer = setInterval(() => { i = Math.min(text.length, i + step); span.textContent = text.slice(0, i); if (i >= text.length) { clearInterval(typer); typer = null; cur.remove(); done && done(); } }, 24);
  }

  function openMission(m) {
    mission = m; option = null; variant = 0;
    const def = NPCS[m.npc];
    sceneEl.hidden = false; $("lig-options").innerHTML = ""; $("lig-draft").hidden = true; $("lig-actions").hidden = true;
    setStep(0);
    const av = $("lig-av"); av.style.background = def.accent; av.style.color = def.color; av.textContent = def.name[0];
    $("lig-name").textContent = def.name; $("lig-role").textContent = def.role; $("lig-chan").textContent = def.channel;
    typeInto($("lig-text"), m.hook, () => { setStep(1); showOptions(m); });
  }
  function showOptions(m) {
    const box = $("lig-options"); box.innerHTML = "";
    m.options.forEach((opt, i) => {
      const b = document.createElement("button"); if (opt.rec) b.className = "rec";
      b.innerHTML = `<span class="pick">${i + 1}</span>`; b.appendChild(document.createTextNode(opt.label));
      b.onclick = () => chooseOption(opt); box.appendChild(b);
    });
  }
  function chooseOption(opt) {
    option = opt; variant = 0; setStep(2); $("lig-options").innerHTML = ""; $("lig-draft").hidden = false; $("lig-actions").hidden = true;
    $("lig-agenttext").textContent = connected ? "your agent is drafting…" : "your agent is drafting… (canned — connect Switchboard for the real thing)";
    typeDraft();
  }
  function typeDraft() {
    $("lig-actions").hidden = true; $("lig-drafttitle").textContent = option.title;
    typeInto($("lig-draftbody"), option.drafts[variant % option.drafts.length], () => { $("lig-actions").hidden = false; setStep(3); });
  }
  function complete() {
    if (!save.done.includes(mission.id)) { save.done.push(mission.id); save.cash += mission.reward.cash; save.rep += mission.reward.rep; }
    mission.state = "done"; updStats(); refreshObjective();
    const n = npcs.find((x) => x.id === mission.npc); if (n) { n.beam.visible = false; n.ring.material.opacity = 0.15; n.pin.material.color.set("#2de1c2"); }
    const dt = mission.doneToast, rw = mission.reward;
    closeScene();
    splashEl.querySelector(".sub").innerHTML = `+$${rw.cash} · +${rw.rep} REP · <em>draft created — task closed</em>`;
    splashEl.hidden = false; requestAnimationFrame(() => splashEl.classList.add("show"));
    setTimeout(() => { splashEl.classList.remove("show"); setTimeout(() => (splashEl.hidden = true), 300); }, 2100);
    setTimeout(() => toast(dt, 5200), 2200);
  }
  function closeScene() { if (typer) { clearInterval(typer); typer = null; } sceneEl.hidden = true; mission = null; option = null; }

  $("lig-approve").onclick = () => mission && complete();
  $("lig-tweak").onclick = () => { variant++; typeDraft(); };
  $("lig-cancel").onclick = closeScene;
  $("lig-paper").onclick = () => { if (typer) { clearInterval(typer); typer = null; const b = $("lig-draftbody"); b.textContent = option.drafts[variant % option.drafts.length]; $("lig-actions").hidden = false; setStep(3); } };
  addEventListener("keydown", (e) => { if (e.key === "Escape" && mission) closeScene(); });

  window.__lig = { npcs, openById: (id) => openMission(byId[id]), get near() { return near && near.id; } };
  return { update, tryInteract, isBusy: () => !!mission };
}
