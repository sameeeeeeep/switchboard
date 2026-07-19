// Bank it — the shared "↑ Bank this" chip and its mirror, "you've already banked this".
//
// THE HOARDING PROBLEM: six wrapps read a website through the visitor's own Claude (adforge, adgen,
// aplus, redline, huddle, persona/Cast) and each used to keep what it learned inside its own
// per-origin cache. The same site got read six times, six private and slightly different ideas of
// one brand existed, and the user — who pointed at their site six times — owned nothing at the end.
//
// The fix has two halves, and shipping one without the other is half a feature. Both live here, once,
// so all six read as ONE product instead of six copy-pasted affordances:
//   • mountBankIt()  — bank on the way OUT. One quiet, opt-in chip, offered at the moment the
//     extraction is already on screen. Never auto-publishes, never fires on a timer, and is absent
//     entirely when the wrapp is working from a context the library already lent it (nothing to bank
//     — it came FROM the library).
//   • findBankedForUrl() + mountBorrowOffer() — borrow on the way IN. Before a wrapp re-fetches a
//     host, it asks the library whether that brand is already banked, and offers to use it instead
//     of re-reading the site. The fetch path always stays as the fallback.
//
// CONSENT SHAPE: publishing is a write the user explicitly asks for; it does not imply permission to
// read their library. Nothing here enumerates payloads — list() returns metadata only (id/name/kind/
// swatches/folder), and use() runs ONLY after an explicit click on the offer. Every call tolerates a
// throw or an empty result, because reused grants are exact-match and ignore newly requested
// contextKinds — a wrapp must degrade to its old behaviour, never to a dead end.

const CSS = `
.bankit{font:inherit;font-size:11px;line-height:1;letter-spacing:.01em;display:inline-flex;align-items:center;
  gap:.42em;padding:.45em .68em;margin-left:.2em;border:1px solid currentColor;border-radius:999px;
  background:transparent;color:inherit;opacity:.55;cursor:pointer;vertical-align:middle;
  transition:opacity .14s ease;white-space:nowrap;font-weight:500;}
.bankit:hover:not(:disabled){opacity:1;}
.bankit:disabled{cursor:default;}
.bankit.is-done{opacity:.78;}
.bankit.is-bad{opacity:.9;}
.bankit-offer{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-top:12px;padding:12px 14px;
  border:1px dashed currentColor;border-radius:10px;opacity:.92;font-size:12.5px;line-height:1.5;}
.bankit-offer .bo-main{flex:1 1 240px;min-width:0;}
.bankit-offer .bo-line{font-weight:600;}
.bankit-offer .bo-sub{opacity:.62;font-size:11.5px;margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.bankit-offer .bo-sw{width:11px;height:11px;border-radius:3px;display:inline-block;}
.bankit-offer .bo-acts{display:flex;align-items:center;gap:8px;flex:0 0 auto;}
.bankit-offer button{font:inherit;font-size:11.5px;padding:.5em .8em;border-radius:7px;cursor:pointer;
  border:1px solid currentColor;background:transparent;color:inherit;}
.bankit-offer button.bo-use{background:currentColor;}
.bankit-offer button.bo-use span{filter:invert(1) grayscale(1) contrast(3);}
.bankit-offer button.bo-skip{opacity:.62;}
.bankit-offer button.bo-skip:hover{opacity:1;}
`;

function injectCss() {
  if (typeof document === "undefined" || document.getElementById("bankit-css")) return;
  const s = document.createElement("style");
  s.id = "bankit-css";
  s.textContent = CSS;
  (document.head || document.documentElement).append(s);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Stable, derived-from-the-object id (docs/CONTEXT-KINDS.md: never Date.now() — a fresh id per
 *  publish duplicates the library instead of updating it in place). */
export const slugId = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** "https://www.Allbirds.com/mens" → "allbirds.com". Tolerates a bare host with no scheme. */
export function hostOf(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw)
      .hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0].replace(/^www\./i, "").toLowerCase();
  }
}

// Public-suffix-ish labels we never treat as the brand's name. Not a full PSL — this only has to be
// good enough to turn a host into a comparison key, and a miss just means the offer doesn't fire.
const GENERIC = new Set([
  "com", "co", "net", "org", "io", "ai", "app", "dev", "shop", "store", "xyz", "me", "us", "uk",
  "in", "eu", "de", "fr", "es", "it", "nl", "au", "ca", "jp", "example", "test", "local",
  "myshopify", "webflow", "squarespace", "wixsite", "github", "vercel", "netlify", "pages",
]);

/** "shop.allbirds.co.uk" → "allbirds"; "nailinit.example" → "nailinit". */
export function siteKey(host) {
  const parts = String(host || "").toLowerCase().split(".").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (!GENERIC.has(parts[i])) return parts[i];
  return parts[0] || "";
}

/** Pure: does the library already hold a context for the host the user just typed? Metadata only —
 *  `data.domain` lives in the payload, which list() deliberately does not return, so the match runs
 *  on the context's NAME against the site key. Deliberately an OFFER, never an automatic swap: the
 *  banked card is shown and the user decides, so a loose match costs a glance, not a wrong brand. */
export function matchBankedByUrl(metas, url, kind = "brand") {
  const key = siteKey(hostOf(url));
  if (!key || key.length < 3) return null;
  const pool = (metas || []).filter((m) => m && (m.kind || "").toLowerCase() === String(kind).toLowerCase());
  return (
    pool.find((m) => nameKey(m.name) === key) ||
    pool.find((m) => {
      const n = nameKey(m.name);
      return n.length >= 4 && (n.includes(key) || key.includes(n));
    }) ||
    null
  );
}

/** context.list() with every failure mode folded into an empty array (old grant, older daemon). */
export async function listContexts(relay) {
  if (!relay || !relay.context || typeof relay.context.list !== "function") return [];
  try {
    const metas = await relay.context.list();
    return Array.isArray(metas) ? metas : [];
  } catch {
    return []; // reused exact-match grant without contextKinds — the fetch path still works
  }
}

/** The borrow check: list (metadata) + match. No use(), so nothing is read and nothing is selected
 *  until the user clicks the offer. */
export async function findBankedForUrl(relay, url, kind = "brand") {
  if (!url) return null;
  return matchBankedByUrl(await listContexts(relay), url, kind);
}

/** Read one listed context in full — only ever called from an explicit click. */
export async function useContext(relay, id) {
  if (!relay || !relay.context || typeof relay.context.use !== "function") return null;
  try {
    return (await relay.context.use(id)) || null;
  } catch {
    return null;
  }
}

/**
 * HALF A — bank on the way out.
 *
 * mountBankIt(mount, { relay, kind, draft, contexts, onPublished })
 *   draft    — { id, name, data } already mapped to the docs/CONTEXT-KINDS.md shape for `kind`
 *   contexts — metas from context.list(), for the dedupe. Publishing with the same stable id
 *              UPDATES in place rather than duplicating, so the "already banked" state stays a
 *              one-click update instead of a dead end.
 *
 * Appends ONE chip to `mount` (never clears it — callers append it beside their own line) and
 * returns the button, or null when there is nothing to offer.
 */
export function mountBankIt(mount, opts = {}) {
  const { relay, kind, draft, contexts, onPublished } = opts;
  if (!mount || !relay || !relay.context || typeof relay.context.publish !== "function") return null;
  if (!draft || !String(draft.name || "").trim() || !kind) return null;

  injectCss();
  const name = String(draft.name).trim();
  const id = String(draft.id || slugId(name) || slugId(kind + "-" + name));
  if (!id) return null;

  const already = (contexts || []).some((c) => {
    if (!c || (c.kind || "").toLowerCase() !== String(kind).toLowerCase()) return false;
    return c.id === id || nameKey(c.name) === nameKey(name);
  });

  const btn = el("button", "bankit");
  btn.type = "button";
  const label = (t) => { btn.textContent = t; };

  if (already) {
    btn.classList.add("is-done");
    label("already in your library ✓ · update it");
    btn.title = `re-publishes ${name} over the copy already in your Switchboard library — same entry, refreshed`;
  } else {
    label(`↑ Bank ${name} — every app can borrow it`);
    btn.title = "puts it in your Switchboard library; each app still asks before it can use it.";
  }

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const prev = btn.textContent;
    btn.disabled = true;
    btn.classList.remove("is-bad");
    label("banking…");
    try {
      await relay.context.publish({ id, name, kind, data: draft.data || {} });
      btn.classList.add("is-done");
      label("in your library ✓");
      if (typeof onPublished === "function") {
        onPublished({ id, name, kind, updatedAt: Date.now() });
      }
    } catch (e) {
      btn.disabled = false;
      btn.classList.add("is-bad");
      label(prev);
      btn.title = "couldn't bank it — " + String(e?.message || e).slice(0, 140);
    }
  });

  mount.append(btn);
  return btn;
}

/**
 * HALF B — borrow on the way in.
 *
 * mountBorrowOffer(mount, { name, detail, swatches, onUse, onDismiss })
 * Clears `mount`, renders the offer, unhides it. onUse/onDismiss both clear it again first, so the
 * caller only decides what happens next. Dismissing must always leave the fetch path available —
 * this is an offer, never a gate.
 */
export function mountBorrowOffer(mount, opts = {}) {
  if (!mount) return null;
  injectCss();
  const { name, detail, swatches, onUse, onDismiss } = opts;
  const label = String(name || "that brand");

  mount.textContent = "";
  const box = el("div", "bankit-offer");
  const main = el("div", "bo-main");
  main.append(el("div", "bo-line", `you've already banked ${label} — use that instead of re-reading the site?`));
  const sub = el("div", "bo-sub");
  sub.append(el("span", null, detail || "from your Switchboard library"));
  for (const c of (swatches || []).slice(0, 4)) {
    const sw = el("span", "bo-sw");
    sw.style.background = c;
    sw.title = String(c);
    sub.append(sw);
  }
  main.append(sub);

  const acts = el("div", "bo-acts");
  const use = el("button", "bo-use");
  use.type = "button";
  use.append(el("span", null, `use ${label}`));
  const skip = el("button", "bo-skip", "read the site anyway");
  skip.type = "button";
  const close = () => { mount.textContent = ""; mount.hidden = true; };
  use.addEventListener("click", () => { close(); if (typeof onUse === "function") onUse(); });
  skip.addEventListener("click", () => { close(); if (typeof onDismiss === "function") onDismiss(); });
  acts.append(use, skip);

  box.append(main, acts);
  mount.append(box);
  mount.hidden = false;
  return box;
}

export function clearBorrowOffer(mount) {
  if (!mount) return;
  mount.textContent = "";
  mount.hidden = true;
}
