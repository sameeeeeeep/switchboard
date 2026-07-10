// Bank — the context bank. One place that KNOWS things: every context you own (brands, your
// personal card, data sources) on one shelf, plus an Obsidian-inspired notes brain — plain .md
// records with [[links]], backlinks, and - [ ] tasks aggregated across notes — living in a folder
// YOU own. Bind it to a real directory (an existing Obsidian vault works: its .md files appear
// here, and notes banked here open in Obsidian). Ask-the-brain runs on your Claude with your notes
// inlined — the operator stores nothing and knows nothing.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const KINDS = ["brand", "personal", "project", "csv", "gsheet", "note"];
const DEFAULT_FOLDER = "~/SwitchboardBrain";

let relay = null;
let notInstalled = false;
let notes = [];      // [{key, title, body, links[], tasks[{line, done, text}], backlinks[]}]
let contexts = [];   // library metas
let filterLink = null; // active [[link]] filter, or null
let asking = false;
let askSeq = 0;

// ---------- sample brain (pre-connect only — in-memory, never persisted, always labeled) ----------
const SAMPLE_NOTES = [
  { key: "n-launch-plan.md", body: "# Diwali launch plan\n\nGifting bundles for [[Haazma]] — 3 SKUs, kraft boxes.\n\n- [ ] finalize bundle pricing with [[Piqual]] learnings\n- [ ] brief [[Studio]] shots for the gift box\n- [x] lock the festive palette" },
  { key: "n-vendor-notes.md", body: "# Vendor notes\n\nCuticle oil vendor quotes 18% lower at 5k MOQ. Relevant to [[Haazma]] restock.\n\n- [ ] counter at 4k MOQ" },
  { key: "n-positioning-idea.md", body: "# Positioning idea\n\n\"Premium without the city tax\" also works for tier-2 men's skincare — see [[Sela]]." },
];

// ---------- md parsing ----------
function parseNote(key, body) {
  const lines = String(body || "").split("\n");
  const h = lines.find((l) => l.startsWith("# "));
  const title = (h ? h.slice(2) : (lines.find((l) => l.trim()) || key)).trim().slice(0, 120);
  const links = [...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean))];
  const tasks = [];
  lines.forEach((l, i) => {
    const m = /^\s*- \[( |x|X)\] (.+)$/.exec(l);
    if (m) tasks.push({ line: i, done: m[1] !== " ", text: m[2].trim() });
  });
  return { key, body, title, links, tasks, backlinks: [] };
}
function wireBacklinks(list) {
  for (const n of list) n.backlinks = [];
  for (const n of list) for (const l of n.links) {
    const target = list.find((t) => t.title.toLowerCase() === l.toLowerCase());
    if (target && target !== n) target.backlinks.push(n.title);
  }
}
const slug = (t) => (t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note");

// ---------- the standard chip ----------
mountConnect($("chip-dock"), {
  scope: { reason: "Bank — your context bank: notes, tasks and your library in one place", models: ["sonnet"], contextKinds: KINDS },
  context: "none", // the Bank shows the WHOLE library — pinning one "working on" here is the category error
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; void boot(); },
  onDisconnect: () => { relay = null; reflect(); },
});
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { relay = r; void boot(); return; }
  } else if (r && r.installed === false) notInstalled = true;
  renderSample();
  reflect();
})();

// ---------- self-updating: re-read whenever reality may have moved ----------
// Two signals cover the daily cases without a daemon file-watcher:
//   1. tab becomes visible again — you edited notes in Obsidian (same files!) or banked from
//      another window; a throttled re-read on focus picks it up.
//   2. the daemon broadcasts permissionsChanged (context published/edited, folder re-bound) —
//      brandbrain publishing a brand or the panel saving your personal card refreshes the shelf.
// External edits made WHILE the tab stays focused still need a manual reload — a real
// storage-changed push from the daemon (fs.watch on bound folders) is the future upgrade.
let lastBoot = 0;
async function bootThrottled() {
  if (!relay || Date.now() - lastBoot < 2500) return;
  await boot();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void bootThrottled(); });

let subscribed = false;
function subscribeLive() {
  if (subscribed || !relay) return; subscribed = true;
  try { relay.on("permissionsChanged", () => void bootThrottled()); } catch { /* older provider */ }
}

async function boot() {
  lastBoot = Date.now();
  subscribeLive();
  try {
    const [metas, keys, info] = await Promise.all([
      relay.context.list().catch(() => []),
      relay.storage.list().catch(() => []),
      relay.storage.info().catch(() => null),
    ]);
    contexts = metas || [];
    const mdKeys = (keys || []).filter((k) => k.endsWith(".md"));
    const bodies = await Promise.all(mdKeys.map((k) => relay.storage.get(k).catch(() => null)));
    notes = mdKeys.map((k, i) => parseNote(k, bodies[i] ?? "")).filter((n) => n.body.trim());
    wireBacklinks(notes);
    renderVault(info);
    renderAll();
  } catch (e) {
    sysline("couldn't open the bank — " + String(e?.message || e).slice(0, 120));
  }
  reflect();
}

function reflect() {
  const on = !!relay;
  $("bank-it").disabled = !on;
  $("ask-go").disabled = !on || asking;
  $("capture-hint").textContent = on ? "" : notInstalled ? "sample brain below — install Switchboard to start your own" : "sample brain below — connect (top right) to start your own";
}
function sysline(t) { const e = $("sysline"); e.hidden = !t; e.textContent = t || ""; }

// ---------- vault bar (where the brain LIVES — user-owned) ----------
function renderVault(info) {
  const bar = $("vault");
  bar.hidden = false;
  $("vault-path").textContent = info?.folder || "private sandbox";
  $("vault-state").textContent = info?.autoAssigned ? "sandbox — bind a real folder and it becomes a portable vault" : "bound — this folder IS your vault (Obsidian opens it as-is)";
  $("vault-bind").hidden = !info?.autoAssigned;
}
$("vault-bind").addEventListener("click", async () => {
  if (!relay) return;
  const path = prompt("Folder for your brain (an existing Obsidian vault works):", DEFAULT_FOLDER);
  if (!path) return;
  const info = await relay.storage.bind(path.trim()).catch(() => null);
  if (info) { sysline(""); await boot(); }
  else sysline("bind declined or failed — the sandbox keeps working meanwhile.");
});

// ---------- capture: ONE input, banked on enter ----------
const CAPTURE_CHIPS = [
  ["note", "# Idea\n\n"],
  ["task", "# Today\n\n- [ ] "],
  ["linked note", "# \n\nRe [[]]: "],
];
const chipBox = $("capture-chips");
for (const [label, tpl] of CAPTURE_CHIPS) {
  const b = document.createElement("button");
  b.className = "chip"; b.type = "button"; b.textContent = label;
  b.onclick = () => { const c = $("capture"); c.value = tpl; c.focus(); c.selectionStart = c.selectionEnd = tpl.indexOf("\n") === 1 ? 2 : tpl.length; };
  chipBox.append(b);
}
$("bank-it").addEventListener("click", bankIt);
$("capture").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") bankIt(); });
async function bankIt() {
  const body = $("capture").value.trim();
  if (!body || !relay) return;
  const n = parseNote("", body);
  let key = `n-${slug(n.title)}.md`;
  if (notes.some((x) => x.key === key)) key = `n-${slug(n.title)}-${Date.now().toString(36)}.md`;
  $("bank-it").disabled = true;
  try {
    await relay.storage.set(key, body);
    $("capture").value = "";
    await boot();
  } catch (e) {
    sysline("couldn't bank that — " + String(e?.message || e).slice(0, 120));
  } finally { $("bank-it").disabled = !relay; }
}

// ---------- render ----------
function renderSample() {
  notes = SAMPLE_NOTES.map((s) => parseNote(s.key, s.body));
  wireBacklinks(notes);
  contexts = [];
  renderAll(true);
}

function renderAll(sample = false) {
  renderShelf(sample);
  renderTasks(sample);
  renderNotes(sample);
}

function renderShelf(sample) {
  const box = $("shelf");
  box.textContent = "";
  if (sample || !contexts.length) {
    box.append(chipEl(sample ? "your brands + personal card appear here on connect" : "nothing in the library yet — build a brand in brandbrain, or add your details in the panel", "shelf-empty"));
    return;
  }
  const KIND_LABEL = { brand: "brand", personal: "you", csv: "live data", gsheet: "live data" };
  for (const c of contexts) {
    const chip = document.createElement("button");
    chip.className = "shelfchip" + (filterLink && c.name.toLowerCase() === filterLink.toLowerCase() ? " on" : "");
    const mk = document.createElement("b"); mk.textContent = c.name[0]?.toUpperCase() ?? "•";
    const nm = document.createElement("span"); nm.textContent = c.name;
    const kd = document.createElement("i"); kd.textContent = KIND_LABEL[(c.kind || "").toLowerCase()] || c.kind || "";
    chip.append(mk, nm, kd);
    chip.onclick = () => { filterLink = filterLink?.toLowerCase() === c.name.toLowerCase() ? null : c.name; renderAll(); };
    box.append(chip);
  }
}

function chipEl(text, cls) { const d = document.createElement("div"); d.className = cls || "chip"; d.textContent = text; return d; }

function renderTasks(sample) {
  const box = $("tasks");
  box.textContent = "";
  const open = [];
  for (const n of notes) for (const t of n.tasks) if (!t.done) open.push({ n, t });
  $("tasks-count").textContent = open.length ? `${open.length} open` : "all clear";
  if (!open.length) { box.append(chipEl("no open tasks — bank one with “- [ ] …”", "shelf-empty")); return; }
  for (const { n, t } of open) {
    const row = document.createElement("label");
    row.className = "taskrow";
    const cb = document.createElement("input"); cb.type = "checkbox";
    cb.disabled = sample || !relay;
    cb.onchange = () => void toggleTask(n, t);
    const txt = document.createElement("span"); txt.textContent = t.text;
    const src = document.createElement("i"); src.textContent = n.title;
    row.append(cb, txt, src);
    box.append(row);
  }
}
async function toggleTask(note, task) {
  const lines = note.body.split("\n");
  lines[task.line] = lines[task.line].replace("- [ ]", "- [x]");
  try { await relay.storage.set(note.key, lines.join("\n")); await boot(); }
  catch (e) { sysline("couldn't check that off — " + String(e?.message || e).slice(0, 100)); }
}

function renderNotes(sample) {
  const box = $("notes");
  box.textContent = "";
  $("brain-note").textContent = sample ? "sample brain — connect to start yours" : filterLink ? `filtered by [[${filterLink}]] — click the chip again to clear` : `${notes.length} note${notes.length === 1 ? "" : "s"}, newest first`;
  const shown = notes
    .filter((n) => !filterLink || n.links.some((l) => l.toLowerCase() === filterLink.toLowerCase()) || n.title.toLowerCase() === filterLink.toLowerCase())
    .slice()
    .reverse();
  if (!shown.length) { box.append(chipEl(filterLink ? "nothing links here yet" : "empty brain — bank the first note above", "shelf-empty")); return; }
  for (const n of shown) {
    const card = document.createElement("div");
    card.className = "note";
    const h = document.createElement("div"); h.className = "nt"; h.textContent = n.title;
    card.append(h);
    const snippet = n.body.split("\n").filter((l) => l.trim() && !l.startsWith("# ")).slice(0, 3).join(" · ").slice(0, 220);
    if (snippet) card.append(Object.assign(document.createElement("div"), { className: "nb", textContent: snippet }));
    if (n.links.length || n.backlinks.length) {
      const lr = document.createElement("div"); lr.className = "nlinks";
      for (const l of n.links) {
        const b = document.createElement("button"); b.className = "wikilink"; b.textContent = `[[${l}]]`;
        b.onclick = () => { filterLink = filterLink?.toLowerCase() === l.toLowerCase() ? null : l; renderAll(sample); };
        lr.append(b);
      }
      if (n.backlinks.length) lr.append(Object.assign(document.createElement("span"), { className: "backl", textContent: `← ${n.backlinks.join(", ")}` }));
      card.append(lr);
    }
    if (!sample && relay) {
      const del = document.createElement("button"); del.className = "ndel"; del.textContent = "forget";
      del.onclick = async () => { if (confirm(`Forget “${n.title}”? The .md file is deleted.`)) { await relay.storage.delete(n.key).catch(() => {}); await boot(); } };
      card.append(del);
    }
    box.append(card);
  }
}

// ---------- ask the brain ----------
const ASK_CHIPS = ["what's on my plate this week?", "summarize everything about the launch", "which brand do my notes mention most?"];
const askChipBox = $("ask-chips");
for (const q of ASK_CHIPS) {
  const b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = q;
  b.onclick = () => { $("ask-in").value = q; };
  askChipBox.append(b);
}
$("ask-go").addEventListener("click", ask);
$("ask-in").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
async function ask() {
  const q = $("ask-in").value.trim();
  if (!q || !relay || asking) return;
  const my = ++askSeq;
  asking = true; reflect();
  const out = $("ask-out");
  out.hidden = false; out.textContent = "";
  let corpus = "";
  for (const n of notes) {
    if (corpus.length > 24000) { corpus += "\n[...more notes truncated]"; break; }
    corpus += `\n--- ${n.title} (${n.key}) ---\n${n.body}\n`;
  }
  const shelfNames = contexts.map((c) => `${c.name} (${c.kind || "context"})`).join(", ");
  const prompt = [
    "You are the user's context bank — answer from THEIR notes below, plus the names of what's in their library. Cite note titles when you draw on them. If the notes don't cover it, say so plainly. Be concise and direct; second person.",
    shelfNames ? `LIBRARY (names only): ${shelfNames}` : "",
    `NOTES:${corpus || "\n(none yet)"}`,
    `QUESTION: ${q}`,
  ].filter(Boolean).join("\n\n");
  try {
    for await (const d of relay.stream({ prompt })) {
      if (my !== askSeq) return;
      if (d.type === "text") out.textContent += d.text;
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
  } catch (e) {
    out.textContent += `\n[the brain went quiet — ${String(e?.message || e).slice(0, 100)}]`;
  } finally {
    if (my === askSeq) { asking = false; reflect(); }
  }
}
