// Dictionary surface — the project vocabulary. Terms grouped A–Z, an A–Z jump
// rail, and click-to-expand a term. Ported from wf-dictionary.html.
// Self-contained ES module: render(DATA) -> HTML string, css, wire(root).

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const GLYPH_SRC = "↻";

// Local sample: glossary terms (real Bank dictionary reads later)
const SAMPLE = {
  terms: [
    { t: "ARPU", d: "average revenue per user", scope: "global", src: "ideabrain run" },
    { t: "Bank", d: "the .md vault the user owns — the substrate every lens reads", scope: "global", src: "manual" },
    { t: "Diaspora", d: "in IndEur, specifically the first- & second-gen Indian community living in Europe — our whole audience", scope: "project", src: "God · meetup notes", usages: ["project-indeur.md", "Launch ad copy", "note: audience"] },
    { t: "Facet", d: "one lens on a project's .md — Overview / Tasks / Brain / Artifacts", scope: "global", src: "manual" },
    { t: "Founding member", d: "one of the first 500 who join before public launch — gets a lifetime badge & founder pricing", scope: "project", src: "pricing note", usages: ["pricing-thesis.md", "Launch ad copy"] },
    { t: "Flagship event", d: "the monthly in-person meetup that anchors a city's chapter", scope: "project", src: "God run", usages: ["meetup-notes.md"] },
    { t: "Terracotta", d: "the warm clay-orange primary in the IndEur palette (#E0764A)", scope: "project", src: "Crest run", usages: ["project-indeur.md", "brand-set"] },
    { t: "Wrapp", d: "an app in Switchboard — prompts + skills + UI over Claude, no middleman", scope: "global", src: "manual" },
  ],
};

function termRow(x, i) {
  const scls = x.scope === "project" ? "sc proj" : "sc glob";
  const hasExp = !!(x.usages && x.usages.length);
  const exp = hasExp
    ? '<div class="expand">Learned from <b>' + esc(x.src) + '</b> · used in the vault:'
      + '<div class="u">' + x.usages.map((u) => '<a>' + esc(u) + '</a>').join("") + '</div></div>'
    : "";
  return '<div class="term' + (hasExp ? " has-exp" : "") + '" data-term="' + i + '">'
    + '<div class="tw">' + esc(x.t) + '</div>'
    + '<div class="df">"' + esc(x.d) + '"</div>'
    + '<div class="meta"><span class="' + scls + '">' + esc(x.scope) + '</span><span class="src">' + GLYPH_SRC + ' ' + esc(x.src) + '</span></div>'
    + exp + '</div>';
}

export function render(DATA) {
  // group by first letter
  const byL = {};
  SAMPLE.terms.forEach((x, i) => { const L = x.t[0].toUpperCase(); (byL[L] = byL[L] || []).push({ x, i }); });
  const letters = Object.keys(byL).sort();
  const empty = !SAMPLE.terms.length;

  let h = '<div class="srf-dictionary">';
  h += '<div class="dhead"><span class="kick">Dictionary</span><h1>What your words mean</h1>'
    + '<span class="scope">◐ IndEur Club</span>'
    + '<div class="search"><div class="fbox">⌕ find a term</div><div class="add">+ Add term</div></div></div>';

  h += '<div class="dbody"><div class="list" data-list>';
  h += '<div class="newrow"><span class="plus">＋</span><span class="ph"><b>term</b> : definition — press ⏎ to teach Switchboard</span></div>';
  if (empty) {
    h += '<div class="dempty">No terms yet — teach Switchboard your first word above and every surface will speak it.</div>';
  } else {
    letters.forEach((L) => {
      h += '<div class="sect" data-sect="' + L + '">' + L + '</div>';
      byL[L].forEach((e) => { h += termRow(e.x, e.i); });
    });
  }
  h += '</div>';

  // A–Z jump rail
  h += '<div class="az" data-az>';
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((L) => {
    const has = !!byL[L];
    h += '<span class="' + (has ? "has" : "") + '" data-jump="' + L + '">' + L + '</span>';
  });
  h += '</div></div>';

  h += '</div>';
  return h;
}

export function wire(root) {
  const srf = root.querySelector(".srf-dictionary");
  if (!srf) return;
  const list = srf.querySelector("[data-list]");

  // expand a term (only those with usages)
  srf.querySelectorAll(".term.has-exp").forEach((t) => {
    t.addEventListener("click", () => t.classList.toggle("open"));
  });

  // A–Z jump: scroll the matching section into view + mark the letter active
  const jumps = srf.querySelectorAll("[data-az] span[data-jump]");
  jumps.forEach((sp) => {
    sp.addEventListener("click", () => {
      const L = sp.getAttribute("data-jump");
      const sect = list && list.querySelector('[data-sect="' + L + '"]');
      if (!sect) return; // no terms under this letter
      jumps.forEach((s) => s.classList.remove("on"));
      sp.classList.add("on");
      sect.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });
}

export const css = `
.srf-dictionary{padding-top:10px}
.srf-dictionary .kick{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint)}
.srf-dictionary .dhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.srf-dictionary .dhead h1{font-size:clamp(20px,2.6vw,26px);font-weight:600;letter-spacing:-.02em;margin:0}
.srf-dictionary .scope{font-size:12px;color:var(--indigo);border:1px solid #2c2a55;background:#14122b;border-radius:8px;padding:4px 10px}
.srf-dictionary .search{margin-left:auto;display:flex;gap:8px;align-items:center}
.srf-dictionary .fbox{font-size:12.5px;color:var(--ink-dim);background:var(--panel);border:1px solid var(--edge);border-radius:9px;padding:7px 13px;width:190px}
.srf-dictionary .add{font-size:12.5px;color:#0c0d10;background:var(--lime);font-weight:600;border-radius:9px;padding:8px 14px;cursor:pointer}
.srf-dictionary .dbody{display:grid;grid-template-columns:1fr 30px;gap:14px;margin-top:20px}
.srf-dictionary .list{min-width:0}
.srf-dictionary .sect{font-family:var(--mono);font-size:13px;color:var(--lime);font-weight:600;margin:20px 0 8px;padding-left:2px;scroll-margin-top:70px}
.srf-dictionary .sect:first-child{margin-top:0}
.srf-dictionary .term{display:flex;align-items:flex-start;gap:14px;background:var(--panel);border:1px solid var(--edge);border-radius:11px;padding:12px 16px;margin-bottom:8px}
.srf-dictionary .term.has-exp{cursor:pointer}
.srf-dictionary .term:hover{border-color:#33384a}
.srf-dictionary .term .tw{font-size:14px;font-weight:600;color:var(--ink);width:118px;flex:0 0 auto}
.srf-dictionary .term .df{font-size:13px;color:var(--ink-sec);flex:1;min-width:0}
.srf-dictionary .term .meta{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.srf-dictionary .term .sc{font-size:10.5px;font-family:var(--mono);color:var(--ink-dim);border:1px solid var(--edge);border-radius:6px;padding:2px 8px}
.srf-dictionary .term .sc.proj{color:var(--indigo);border-color:#2c2a55;background:#14122b}
.srf-dictionary .term .sc.glob{color:var(--ink-faint)}
.srf-dictionary .term .src{font-size:10px;font-family:var(--mono);color:var(--ink-faint);display:flex;align-items:center;gap:5px}
.srf-dictionary .expand{display:none}
.srf-dictionary .term.open{flex-wrap:wrap;border-color:#33384a}
.srf-dictionary .term.open .expand{display:block;flex-basis:100%;margin-top:12px;padding-top:12px;border-top:1px solid var(--edge-soft);font-size:12.5px;color:var(--ink-dim)}
.srf-dictionary .expand b{color:var(--ink-sec)}
.srf-dictionary .expand .u{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}
.srf-dictionary .expand .u a{font-size:11px;color:var(--ink-sec);background:#0f1116;border:1px solid var(--edge);border-radius:6px;padding:3px 9px;text-decoration:none;cursor:pointer}
.srf-dictionary .newrow{display:flex;align-items:center;gap:12px;border:1px dashed var(--edge);border-radius:11px;padding:11px 16px;margin-bottom:14px;background:linear-gradient(180deg,#0e0f14,#0b0c11)}
.srf-dictionary .newrow .plus{color:var(--lime);font-size:15px}
.srf-dictionary .newrow .ph{font-size:13px;color:var(--ink-faint);font-family:var(--mono)}
.srf-dictionary .newrow .ph b{color:var(--ink-dim);font-weight:400}
.srf-dictionary .az{position:sticky;top:70px;align-self:start;display:flex;flex-direction:column;align-items:center;gap:1px;font-family:var(--mono);font-size:10px;color:var(--ink-faint)}
.srf-dictionary .az span{padding:2px 0;width:22px;text-align:center;border-radius:4px;cursor:pointer}
.srf-dictionary .az span.has{color:var(--ink-sec)}
.srf-dictionary .az span.on{color:var(--lime);background:var(--panel)}
.srf-dictionary .dempty{margin-top:16px;padding:34px;text-align:center;font-size:13px;color:var(--ink-dim);border:1px dashed var(--edge);border-radius:14px;background:linear-gradient(180deg,#0e0f14,#0b0c11)}
`;
