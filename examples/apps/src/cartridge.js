// Cartridge — form → playable game, generated on the visitor's OWN Claude through Switchboard.
// The meta-wrapp: an app that manufactures apps. The generated game is a single self-contained
// .html artifact the user keeps. Generated code runs in a sandboxed iframe (opaque origin,
// allow-scripts only) — it can NEVER touch window.claude; the airgap holds even for code the
// user's own model just wrote.
import { whenRelayReady, mountConnect, BYOPErrorCode } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const SHELF_KEY = "cartridge:shelf";
const INSTALL_URL = "https://sameeeeeeep.github.io/switchboard/";

let relay = null;
let cart = null;          // { id, title, html, version, meta:{genre,vibe,diff,idea,twist} }
let generating = false;
let cancelled = false;

// ---------- form ----------
const GENRES = ["platformer", "shooter", "puzzle", "arcade", "racer", "snake-like", "breakout", "dodge-em-up"];
const VIBES = ["neon", "retro pixel", "mono CRT", "pastel", "vaporwave"];
const DIFFS = ["chill", "normal", "brutal"];
const picked = { genre: "arcade", vibe: "neon", diff: "normal" };

function seg(mountId, options, key) {
  const mount = $(mountId);
  options.forEach((opt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = opt;
    if (opt === picked[key]) b.classList.add("on");
    b.addEventListener("click", () => {
      picked[key] = opt;
      mount.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
    mount.append(b);
  });
}
seg("f-genre", GENRES, "genre");
seg("f-vibe", VIBES, "vibe");
seg("f-diff", DIFFS, "diff");

const DICE = [
  { idea: "a tiny ninja dodges shuriken storms and steals lanterns", genre: "dodge-em-up", vibe: "neon", twist: "each lantern makes the night darker" },
  { idea: "a grumpy cloud rains on parades to score points", genre: "arcade", vibe: "pastel", twist: "umbrellas fight back" },
  { idea: "a moth racing toward streetlights without burning up", genre: "racer", vibe: "mono CRT", twist: "light heals AND hurts" },
  { idea: "stack runaway sushi into the tallest tower", genre: "arcade", vibe: "retro pixel", twist: "wasabi blocks are bouncy" },
  { idea: "a ghost vacuuming souls in a haunted office", genre: "snake-like", vibe: "vaporwave", twist: "grow too long and doors close" },
  { idea: "defend the last coffee machine from monday meetings", genre: "shooter", vibe: "neon", twist: "bosses send calendar invites" },
  { idea: "a penguin breaks icebergs to surf the fastest melt", genre: "breakout", vibe: "pastel", twist: "the paddle is a narwhal" },
  { idea: "escape a collapsing synthwave grid on a light-cycle", genre: "racer", vibe: "vaporwave", twist: "your own trail is lava" },
];
$("dice").addEventListener("click", () => {
  const d = DICE[Math.floor(Math.random() * DICE.length)];
  $("f-idea").value = d.idea;
  $("f-twist").value = d.twist;
  picked.genre = d.genre; picked.vibe = d.vibe;
  $("f-genre").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === d.genre));
  $("f-vibe").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === d.vibe));
});

// ---------- the standard connect chip ----------
mountConnect($("chip-dock"), {
  scope: { models: ["sonnet"], reason: "Cartridge — generate playable mini-games on your own Claude." },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; reflectConn(); },
  onDisconnect: () => { relay = null; reflectConn(); },
});
// Fast probe so a returning user's grant enables the button without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) relay = r;
  }
  reflectConn();
})();

function reflectConn() {
  const on = !!relay;
  $("go").disabled = !on || generating;
  $("remix").disabled = !on || generating;
  $("conn-hint").innerHTML = on
    ? "runs on <b>your</b> Claude — the operator pays nothing"
    : "connect Switchboard (top right) to power the forge with your own Claude";
}
reflectConn();

// ---------- prompt ----------
const SYSTEM = `You are Cartridge, an expert arcade game developer. You produce COMPLETE, self-contained HTML5 games in a SINGLE file.

Hard requirements — every one matters:
- ONE complete html document: inline <style> and <script>, canvas-based (2D context), no external URLs of any kind (no CDNs, fonts, images, audio files — draw everything with canvas, synthesize any sound with WebAudio).
- Playable immediately: game starts on first key/tap after a brief title screen showing the controls.
- Controls: keyboard (arrows/WASD + space) AND touch (tap/drag) — both must work.
- Core loop: requestAnimationFrame, delta-time based movement, score displayed, lose/win state with a "play again" that fully resets.
- Juice: particles, hit flashes, subtle screen shake, a little WebAudio blip on events. Small file, big feel.
- The page must never scroll; the canvas scales to fit the window (letterboxed) and stays crisp.
- No console errors. No TODOs. No placeholder art comments — finished code only.
- Keep it TIGHT: one perfect mechanic beats three rough ones. Target under ~350 lines / ~12kb — ship the smallest game that feels great.

Respond with ONLY the html document. No prose, no markdown fences.`;

function buildPrompt() {
  const idea = $("f-idea").value.trim() || "an original tiny arcade game";
  const twist = $("f-twist").value.trim();
  return [
    `Make this game: ${idea}`,
    `Genre: ${picked.genre}. Difficulty: ${picked.diff}.`,
    `Art direction: ${picked.vibe} — commit to it fully in the palette, glow, and typography.`,
    twist ? `Signature twist (make it central to the design): ${twist}` : "",
    `Also choose a punchy 1-3 word arcade TITLE for it and put it in the <title> tag and on the title screen.`,
  ].filter(Boolean).join("\n");
}

// ---------- generation ----------
const GEN_LINES = ["WIRING THE PHYSICS…", "PAINTING THE SPRITES…", "TUNING THE DIFFICULTY…", "SYNTHESIZING BLIPS…", "ADDING THE JUICE…", "PRESSING THE CARTRIDGE…"];
let genLineTimer = null;

function setGenerating(on) {
  generating = on;
  $("genbox").hidden = !on;
  $("go").disabled = on || !relay;
  $("remix").disabled = on || !relay;
  if (on) {
    let i = 0;
    $("gen-line").textContent = GEN_LINES[0];
    genLineTimer = setInterval(() => { i = (i + 1) % GEN_LINES.length; $("gen-line").textContent = GEN_LINES[i]; }, 2600);
  } else {
    clearInterval(genLineTimer);
  }
}

function extractHtml(text) {
  let t = String(text).replace(/```(?:html)?/gi, "").trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  const end = t.lastIndexOf("</html>");
  if (start === -1 || end === -1 || end <= start) return null;
  return t.slice(start, end + "</html>".length);
}

function titleOf(html, fallback) {
  const m = /<title>([^<]{1,60})<\/title>/i.exec(html);
  return (m && m[1].trim()) || fallback;
}

async function runStream(prompt, { fresh }) {
  if (!relay || generating) return;
  cancelled = false;
  setGenerating(true);
  $("errbox").hidden = true;
  const rain = $("code-rain");
  rain.textContent = "";
  let text = "";
  let usedModel = "sonnet";
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const params = { prompt, system: SYSTEM, maxTokens: 16000, effort: "low" };
        if (usedModel) params.model = usedModel;
        for await (const d of relay.stream(params)) {
          if (cancelled) break;
          if (d.type === "text") {
            text += d.text;
            const tail = text.split("\n").slice(-14).join("\n");
            rain.textContent = tail;
            $("gen-meta").textContent = (text.length / 1024).toFixed(1) + " kb";
          } else if (d.type === "error") {
            throw Object.assign(new Error(d.error?.message || "stream error"), { code: d.error?.code });
          }
        }
        break; // stream finished (or cancelled)
      } catch (err) {
        // Grant was narrowed past our requested model → fall back to the origin default once.
        if (err?.code === BYOPErrorCode.SCOPE_EXCEEDED && usedModel) { usedModel = null; text = ""; continue; }
        throw err;
      }
    }
    if (cancelled) return;
    const html = extractHtml(text);
    if (!html) throw new Error("the model didn't return a complete game — try GENERATE again (it usually lands on the second pull)");
    if (fresh) {
      cart = {
        id: "c_" + Date.now().toString(36),
        title: titleOf(html, ($("f-idea").value.trim() || "untitled").slice(0, 28)),
        html, version: 1,
        meta: { ...picked, idea: $("f-idea").value.trim(), twist: $("f-twist").value.trim() },
      };
    } else {
      cart.html = html;
      cart.version += 1;
      cart.title = titleOf(html, cart.title);
    }
    boot();
  } catch (err) {
    showError(err);
  } finally {
    setGenerating(false);
  }
}

function showError(err) {
  const box = $("errbox");
  box.hidden = false;
  const code = err?.code;
  // Error text can echo daemon/model output — never innerHTML it. Compose with textContent.
  let head, body;
  if (code === BYOPErrorCode.USER_REJECTED || code === 4001) { head = "Not connected."; body = "Connect Switchboard (top right) when you're ready — nothing runs without your say-so."; }
  else if (code === BYOPErrorCode.BUDGET_EXCEEDED || code === 4290) { head = "Budget cap reached."; body = "This app hit the daily token budget you granted it. Raise it in the Switchboard panel, or come back tomorrow."; }
  else if (code === BYOPErrorCode.PROVIDER_UNAVAILABLE || code === 4900) { head = "Your sidekick is unreachable."; body = "Start the Switchboard daemon and try again."; }
  else if (code === BYOPErrorCode.UNAUTHORIZED || code === 4100) { head = "Not connected yet."; body = "Click the chip (top right) and approve the connect."; }
  else { head = "Generation failed."; body = String(err?.message || err).slice(0, 240); }
  box.textContent = "";
  const b = document.createElement("b");
  b.textContent = head;
  box.append(b, " " + body);
}

$("go").addEventListener("click", () => runStream(buildPrompt(), { fresh: true }));
$("cancel").addEventListener("click", () => { cancelled = true; setGenerating(false); });

// ---------- the cabinet ----------
function boot() {
  $("cabinet").hidden = false;
  $("g-title").textContent = cart.title.toUpperCase();
  $("g-ver").textContent = "v" + cart.version + " · " + cart.meta.genre + " · " + cart.meta.vibe;
  $("stage").srcdoc = cart.html;
  $("cabinet").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("restart").addEventListener("click", () => { if (cart) $("stage").srcdoc = cart.html; });

$("remix").addEventListener("click", () => {
  const change = $("remix-in").value.trim();
  if (!change || !cart) return;
  $("remix-in").value = "";
  const prompt = [
    "Here is the current complete game:",
    "```html", cart.html, "```",
    `Remix it: ${change}`,
    "Keep everything that works; apply the change cleanly. Same hard requirements as before.",
    "Respond with ONLY the full updated html document.",
  ].join("\n");
  runStream(prompt, { fresh: false });
});
$("remix-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("remix").click(); });

// ---------- the artifact ----------
$("download").addEventListener("click", () => {
  if (!cart) return;
  const blob = new Blob([cart.html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = cart.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".html";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- the shelf ----------
const loadShelf = () => { try { return JSON.parse(localStorage.getItem(SHELF_KEY)) || []; } catch { return []; } };
const saveShelf = (s) => localStorage.setItem(SHELF_KEY, JSON.stringify(s));

$("save").addEventListener("click", () => {
  if (!cart) return;
  const shelf = loadShelf().filter((c) => c.id !== cart.id);
  shelf.unshift({ ...cart, at: Date.now() });
  saveShelf(shelf.slice(0, 24)); // localStorage is finite; keep the newest 24
  renderShelf();
});

function renderShelf() {
  const shelf = loadShelf();
  $("shelf-empty").hidden = shelf.length > 0;
  const mount = $("carts");
  mount.textContent = "";
  shelf.forEach((c) => {
    const el = document.createElement("div");
    el.className = "cart";
    const t = document.createElement("div"); t.className = "ct"; t.textContent = c.title;
    const m = document.createElement("div"); m.className = "cm";
    m.textContent = "v" + c.version + " · " + (c.meta?.genre || "?") + " · " + new Date(c.at).toLocaleDateString();
    const btns = document.createElement("div"); btns.className = "cbtns";
    const play = document.createElement("button"); play.textContent = "▶ play";
    play.addEventListener("click", () => { cart = { ...c }; boot(); });
    const del = document.createElement("button"); del.textContent = "✕"; del.className = "del";
    del.addEventListener("click", () => { saveShelf(loadShelf().filter((x) => x.id !== c.id)); renderShelf(); });
    btns.append(play, del);
    el.append(t, m, btns);
    mount.append(el);
  });
}
renderShelf();
