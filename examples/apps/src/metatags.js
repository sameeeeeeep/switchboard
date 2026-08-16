// META TAGS — a NON-AI widget. Fill a short form, get the <head> meta tags (SEO + Open Graph +
// Twitter Card), IN THE TAB. No model, no cloud, no upload, no cost. Same doctrine as qr.js /
// contrast.js. L0 engine tier. Builder in kit/metatags.js.
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { FIELDS, build, preview } from "./kit/metatags.js";

const APP = {
  id: "metatags", name: "Meta Tags", installUrl: "https://thelastprompt.ai/switchboard/",
  scope: { reason: "Meta Tags — generates HTML meta tags entirely on your device. No AI, no upload, no cost.", models: [], tools: [] },
  usesContext: null,
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
let toastT = null;
function toast(text, err) { clearTimeout(toastT); let t = document.querySelector(".toast"); if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text; toastT = setTimeout(() => t.remove(), 2200); }

let relay = null;
mountConnect($("chip-dock"), { scope: APP.scope, context: APP.usesContext, installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; }, onDisconnect: () => { relay = null; } });
(async () => { const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; } })();

// settings — the fields you typed (page metadata, not sensitive; convenient to keep)
const SETTINGS_KEY = APP.id + "-settings";
let fields = loadFields();
function loadFields() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } }
function saveFields() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(fields)); } catch { /* private */ } }

function render() {
  const view = $("view"); view.textContent = "";
  const wrap = el("div", "work");

  const form = el("div", "mform");
  for (const f of FIELDS) {
    const fld = el("div", "field" + (f.wide ? " wide" : ""));
    fld.append(el("label", "flabel", f.label));
    let input;
    if (f.options) {
      input = el("select", "in");
      for (const o of f.options) { const op = el("option", null, o); op.value = o; input.append(op); }
      input.value = fields[f.k] ?? f.options[0];
      input.onchange = () => { fields[f.k] = input.value; saveFields(); refreshOut(); };
    } else {
      input = el("input"); input.type = "text"; input.className = "in"; input.placeholder = f.ph || "";
      input.value = fields[f.k] ?? "";
      input.addEventListener("input", () => { fields[f.k] = input.value; saveFields(); refreshOut(); });
    }
    fld.append(input);
    form.append(fld);
  }
  wrap.append(form);

  const out = el("div"); out.id = "m-out"; fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

function refreshOut() { const o = $("m-out"); if (o) fillOut(o); }

function fillOut(out) {
  out.textContent = "";
  const p = preview(fields);
  const markup = build(fields);

  // the social-card preview
  const card = el("div", "mcard");
  if (p.hasImage) { const img = el("div", "mimg"); img.style.backgroundImage = `url("${p.image.replace(/"/g, "%22")}")`; card.append(img); }
  const body = el("div", "mbody");
  body.append(el("div", "mhost", p.host));
  body.append(el("div", "mtitle", p.title));
  body.append(el("div", "mdesc", p.description));
  card.append(body);
  const cwrap = el("div", "field"); cwrap.append(el("label", "flabel", "Preview")); cwrap.append(card);
  out.append(cwrap);

  // the markup + copy
  const mwrap = el("div", "field"); mwrap.style.marginTop = "16px";
  mwrap.append(el("label", "flabel", "Meta tags"));
  const code = el("pre", "mcode"); code.textContent = markup || "Fill in a title to generate the tags.";
  mwrap.append(code);
  if (markup) {
    const row = el("div"); row.style.marginTop = "10px";
    const cp = el("button", "copy", "Copy all");
    cp.onclick = async () => { try { await navigator.clipboard.writeText(markup); toast("Copied ✓"); } catch { toast("Copy not supported", true); } };
    row.append(cp);
    mwrap.append(row);
  }
  out.append(mwrap);
}

function badge() { const b = el("div", "nobadge"); b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost")); return b; }
render();

// ---- God's hand ------------------------------------------------------------------------------------
exposeToGod({
  name: "make_meta_tags",
  description: "Generate SEO + Open Graph + Twitter Card <head> meta tags on-device (no AI) from a few "
    + "fields. Blank fields are omitted; values are HTML-escaped. Returns the markup string.",
  inputSchema: {
    title: "string — the page title.",
    description: "string — the meta description (~155 chars).",
    url: "string — the canonical URL.",
    image: "string — the social preview image URL.",
    siteName: "string — the site name.",
    type: "string — the og:type (default 'website').",
    twitterCard: "string — 'summary_large_image' or 'summary'.",
    twitterSite: "string — the @handle.",
    themeColor: "string — the theme-color hex.",
  },
  execute: async (input = {}) => {
    const markup = build(input);
    if (!markup) throw new Error("give me at least a title to generate tags");
    fields = { ...input }; try { render(); } catch { /* headless */ }
    return { markup, preview: preview(input) };
  },
});

// ---- the glance ------------------------------------------------------------------------------------
exposeWidget((input) => {
  const f = input && Object.keys(input).length ? input : fields;
  const markup = build(f);
  if (!markup) return { kicker: "META · ON YOUR DEVICE", title: "Generate meta tags", openLabel: "Open Meta", shape: "text",
    result: { body: "Give me a title, description and image — I write the OG + Twitter tags on your device.", caption: "no AI · on your device" } };
  const n = markup.split("\n").filter((l) => l.trim()).length;
  const p = preview(f);
  return { kicker: "META · ON YOUR DEVICE", title: `${n} tags for ${p.host}`, openLabel: "Open Meta", shape: "text",
    result: { body: p.title, caption: "no AI · on your device" } };
});

try { (typeof window !== "undefined" ? window : globalThis).__metatagsTest = { build, preview }; } catch { /* ignore */ }
