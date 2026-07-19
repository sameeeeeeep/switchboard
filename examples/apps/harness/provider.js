/* eslint-disable */
// Mock window.claude for the wrapp TEST HARNESS. A classic (non-module) script so it runs
// synchronously during <head> parse — BEFORE the wrapp's deferred module — which means getRelay()
// finds a provider immediately and every wrapp boots the RETURNING-USER path (permissions() returns
// a grant → no chip click needed). It implements the full window.claude EIP-1193 surface the SDK
// wraps: capabilities / connect / permissions / health / context / storage / stream / complete /
// listTools / callTool / speak, plus the `delta`/`connect`/`health` events.
//
// The interesting method is claude_stream: instead of a real model it runs a keyword-routed
// RESPONDER that returns the EXACT shape each wrapp parses (a JSON object {concepts:[…]}, a JSON
// array of option cards, a full HTML document, an image URL, …), grounded in the lent brand — so
// switchboard vs nailinit produce visibly different output, which is the whole point of the run.
// The routing table (ROUTES) was built from a per-wrapp source analysis (harness/wrapp-specs.json).
(function () {
  "use strict";
  var H = window.__HARNESS__ || { projectId: "switchboard", projects: {} };
  var PROJECT = H.projects[H.projectId] || Object.values(H.projects)[0] || null;
  var IMG_BASE = location.origin + "/img";

  // ---- error capture (read back by the driver into the report) --------------------------------
  window.__HARNESS_ERRORS__ = [];
  function note(kind, text) { window.__HARNESS_ERRORS__.push({ kind: kind, text: String(text).slice(0, 400), t: Date.now() }); }
  window.addEventListener("error", function (e) { if (e && e.message) note("error", e.message + (e.filename ? " @ " + String(e.filename).split("/").pop() + ":" + e.lineno : "")); });
  window.addEventListener("unhandledrejection", function (e) { var r = e && e.reason; note("rejection", (r && (r.message || r)) || "unhandled rejection"); });
  var _cerr = console.error.bind(console);
  console.error = function () { try { note("console.error", Array.prototype.join.call(arguments, " ")); } catch (_) {} return _cerr.apply(null, arguments); };

  // ---- brand-grounded content -----------------------------------------------------------------
  var brand = PROJECT ? (PROJECT.brand && PROJECT.brand.data) || {} : {};
  var bname = PROJECT ? (PROJECT.brand && PROJECT.brand.name) || "Brand" : "Brand";
  function arr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
  var products = arr(brand.products);
  var keywords = arr(brand.keywords);
  var styles = arr(brand.styles);
  var palette = arr(brand.palette);
  var audience = brand.audience || "your buyers";
  var voice = brand.voice || "clear and direct";
  var positioning = brand.positioning || bname;
  var inventory = arr(brand.inventory);
  var CTAS = ["Shop Now", "Learn More", "Get Offer", "Sign Up"];
  var ANGLES = ["Lead with the outcome", "Name the pain", "Proof & specifics", "The fast path", "Founder story", "Objection-crusher"];
  function P(i, fb) { return products[i % (products.length || 1)] || fb || (bname + " offering " + (i + 1)); }
  function KW(i) { return keywords[i % (keywords.length || 1)] || positioning; }
  function futureDate(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function markRec(list) { if (list.length) { list.forEach(function (o) { o.recommended = false; }); list[0].recommended = true; } return list; }

  // Superset "viral" vocab so the generic array satisfies the viral drop too (arcade/yearbook/toon/
  // storybook/petrait/emote/inkling/roomify/thumbs/meme/roast/rizz/anthem/dreamlog). Each viral
  // wrapp reads a few of these off each card; extras are ignored.
  var GENRES = ["endless runner", "brick-breaker", "dodge"];
  var VSTYLES = ["american-traditional", "fine-line", "blackwork"];
  var ERAS = ["Class of '77", "Class of '88", "Class of '99"];
  var MEMEFMTS = ["Drake", "Distracted Boyfriend", "Two Buttons"];
  var LENSES = ["Jungian symbols", "Emotional undercurrent", "Playful omens"];
  var MOODS = ["anthemic", "wistful", "defiant"];
  // Generic option card (superset of keys the whole catalog reads)
  function optionCard(i, seed) {
    var title = seed === "product" ? P(i) : ANGLES[i % ANGLES.length];
    var body = seed === "product"
      ? P(i) + " — " + positioning + ". In " + bname + "'s voice: " + voice
      : ANGLES[i % ANGLES.length] + ". Grounded in " + bname + " (" + KW(i) + "), for " + audience + ".";
    var iprompt = "On-brand " + (styles[i % (styles.length || 1)] || "editorial") + " image for " + bname + ": " + P(i) + ", palette " + palette.slice(0, 3).join(", ") + ", no text.";
    return {
      id: "opt-" + i, label: title, title: title, name: title, headline: title, angle: (ANGLES[i % ANGLES.length]).toLowerCase(),
      subtitle: String(audience).slice(0, 60), body: body, text: body, description: body, copy: body, caption: body.slice(0, 140),
      hook: "One line that makes " + audience + " stop scrolling — for " + P(i) + ".",
      chips: [KW(i)].concat(styles.slice(0, 2)), tags: styles.slice(0, 3),
      date: futureDate(3 + i * 4), palette: palette.slice(0, 3),
      // ---- viral superset ----
      imagePrompt: iprompt, vibe: KW(i) + " · " + (styles[i % (styles.length || 1)] || "clean"),
      genre: GENRES[i % GENRES.length], twist: "collect " + KW(i) + " to score",
      style: VSTYLES[i % VSTYLES.length], mood: MOODS[i % MOODS.length] + " · " + KW(i),
      format: MEMEFMTS[i % MEMEFMTS.length], captions: ["When " + bname + " ships", "the " + audience + " reaction", "worth it"],
      emotes: ["hype", "yay", "oops", "love", "wow", "gg"], overlay: bname.toUpperCase() + "!?", emotion: ["shock", "joy", "smug"][i % 3], composition: "close-up, bold text left",
      hook: title, characterName: bname + "-bot", character: "a plucky " + (keywords[0] || "mascot"), age: "5-8",
      panels: [1, 2, 3, 4].map(function (k) { return { caption: "Panel " + k + ": " + P((i + k) % (products.length || 1)), art: iprompt }; }),
      recommended: false,
    };
  }
  function optionArray(n, seed) { var out = []; for (var i = 0; i < (n || 3); i++) out.push(optionCard(i, seed)); return markRec(out); }
  function labelTextArray(n, kind) {
    var out = [];
    for (var i = 0; i < (n || 3); i++) out.push({ label: (kind || ANGLES[i % ANGLES.length]) + " " + (i + 1) === "" ? "Angle" : ANGLES[i % ANGLES.length], text: optionCard(i).body, recommended: false });
    // simpler: rebuild cleanly
    out = [];
    for (var j = 0; j < (n || 3); j++) out.push({ label: ANGLES[j % ANGLES.length], text: ANGLES[j % ANGLES.length] + " — " + optionCard(j).body, recommended: false });
    return markRec(out);
  }

  // ---- per-wrapp shape builders ---------------------------------------------------------------
  function adConcepts(n) { // AdForge {concepts:[…]}
    var c = [];
    for (var i = 0; i < (n || 3); i++) c.push({
      name: ANGLES[i % ANGLES.length], angle: ANGLES[i % ANGLES.length].toLowerCase(),
      hook: "Stop overpaying for " + (products.length ? "this" : "that") + " — " + P(i) + ".",
      primaryText: positioning + " " + P(i) + " for " + audience + ". Said the way " + bname + " talks: " + voice + ".",
      headline: bname + ": " + P(i), description: "Made for " + audience + ".",
      cta: CTAS[i % CTAS.length], imagePrompt: "Premium ad photo of " + P(i) + ", palette " + palette.slice(0, 3).join(", ") + ", " + (styles[0] || "studio") + " style, no text.",
      recommended: false,
    });
    return { concepts: markRec(c) };
  }
  function adDirections(n) { // Adwall {directions:[6]}
    var fmts = ["1:1", "4:5", "9:16"]; var d = [];
    for (var i = 0; i < (n || 6); i++) d.push({
      name: ANGLES[i % ANGLES.length], angle: ANGLES[i % ANGLES.length].toLowerCase(),
      headline: bname + ": " + P(i), format: fmts[i % fmts.length],
      imagePrompt: "Feed ad for " + P(i) + ", " + bname + " palette " + palette.slice(0, 3).join(", ") + ", " + (styles[0] || "lifestyle") + ", no text overlays.",
      recommended: false,
    });
    return { directions: markRec(d) };
  }
  function aplusDirections() { // A-Plus {directions:[3]}
    var d = [];
    for (var i = 0; i < 3; i++) d.push({
      name: ANGLES[i % ANGLES.length], heroHeadline: P(i) + ", made for " + audience,
      angle: ANGLES[i % ANGLES.length].toLowerCase(),
      chartArgues: "why " + bname + " beats the cheap alternative on the thing " + audience + " cares about",
      recommended: false,
    });
    return { directions: markRec(d) };
  }
  function aplusStack() { // A-Plus module stack
    return {
      heroHeadline: P(0) + ", made for " + audience, heroSub: positioning,
      features: [0, 1, 2, 3].map(function (i) { return { emoji: ["✨", "⚡", "🌿", "🔁"][i], title: (styles[i % styles.length] || "quality"), body: P(i) + " — " + voice }; }),
      comparison: { ourName: bname, otherName: "Generic brand", rows: [{ feature: "made for " + audience, ours: "yes", other: "no" }, { feature: "voice", ours: voice, other: "flat" }] },
      brandStory: { headline: "Why we built " + bname, body: positioning + " " + voice },
      faqs: [{ q: "Is it worth it?", a: "For " + audience + ", yes." }, { q: "How fast?", a: "Fast." }],
      searchTerms: keywords.concat(products.map(function (p) { return String(p).toLowerCase(); })).slice(0, 10),
    };
  }
  function prismConcepts() { // Prism {concepts:[6]}
    var asp = ["1:1", "4:5", "16:9"]; var c = [];
    for (var i = 0; i < 6; i++) c.push({
      title: (styles[i % (styles.length || 1)] || "Shot") + " " + (i + 1), product: P(i), style: styles[i % (styles.length || 1)] || "packshot",
      imagePrompt: "Art-directed " + (styles[i % (styles.length || 1)] || "product") + " shot of " + P(i) + ", " + bname + " palette " + palette.slice(0, 3).join(", ") + ".",
      aspect: asp[i % asp.length], recommended: false,
    });
    return { concepts: markRec(c) };
  }
  function studioShoot() { // Studio jsonArray of 6 {product, scene, direction, aspect}
    var asp = ["1:1", "4:5", "16:9"]; var out = [];
    for (var i = 0; i < 6; i++) out.push({ product: P(i), scene: (styles[i % (styles.length || 1)] || "studio") + " scene for " + P(i), direction: "Recolor to " + (palette[i % (palette.length || 1)] || "#ccc") + "; " + voice, aspect: asp[i % asp.length] });
    return out;
  }
  function reelScenes() { // Reel jsonArray {title, subtitle, imageBrief, seconds}
    var out = []; var n = 5;
    for (var i = 0; i < n; i++) out.push({
      title: i === 0 ? bname : (i === n - 1 ? "Shop " + bname : P(i)),
      subtitle: i === n - 1 ? (brand.tagline || "Get yours") : (ANGLES[i % ANGLES.length]),
      imageBrief: "Cinematic on-brand shot: " + P(i) + ", palette " + palette.slice(0, 3).join(", ") + ", 9:16, no text.",
      seconds: 3,
    });
    return out;
  }
  function arcanaReading() {
    var pos = ["Past", "Present", "Future"]; var cardNames = ["The Tower", "The Star", "The Wheel"];
    return {
      opening: "The cards are cut. " + bname + "'s question sits heavy on the table.",
      cards: pos.map(function (p, i) { return { position: p, card: cardNames[i], take: cardNames[i] + " in the " + p.toLowerCase() + ": what looked like " + KW(i) + " was really a beginning." }; }),
      synthesis: "The spread says: stop hedging on " + (products[0] || "the work") + ".",
      advice: "Commit to the one thing that scares you this week.", omen: "A message arrives on a " + ["Monday", "Tuesday", "Friday"][0] + ".",
    };
  }
  function natalRead() {
    // EXACT shape natal.js validReading() requires: sun/moon/rising as {sign,gloss}, placements[]
    // with {planet,glyph,sign,oneLiner}, today{title,body}, TOP-LEVEL power{do[],dont[]} and pin.
    var placements = [["Mercury", "☿", "Sagittarius"], ["Venus", "♀", "Libra"], ["Mars", "♂", "Aries"], ["Jupiter", "♃", "Leo"], ["Saturn", "♄", "Aquarius"]];
    return {
      sun: { sign: "Scorpio", glyph: "♏", gloss: "intense, all-in — no half measures" },
      moon: { sign: "Pisces", glyph: "♓", gloss: "dreamy, absorbent, feels everything twice" },
      rising: { sign: "Leo", glyph: "♌", gloss: "walks in like it owns the room" },
      placements: placements.map(function (p) { return { planet: p[0], glyph: p[1], sign: p[2], oneLiner: p[0] + " in " + p[2] + " — runs quietly but runs the show." }; }),
      today: { title: "Hold the line", body: "Today rewards patience over a bold move. The urge to force it is the trap — let it come to you, then move once, hard." },
      power: { do: ["Finish the thing you started", "Say the hard sentence first", "Protect one deep-work block"], dont: ["Pick a fight over nothing", "Refresh the numbers again", "Say yes to a fourth thing"] },
      pin: "You mistake intensity for progress — and it's costing you the quiet wins.",
      cuts: [{ title: "Love", recommended: true }, { title: "Work", recommended: false }, { title: "The year ahead", recommended: false }],
    };
  }
  function bankBrief() {
    var b = ["Reorder is due — a fast-mover is under its threshold.", "Two open tasks are blocking a launch; clear them first.", "A note from last week has an unanswered follow-up.", "Momentum item: ship the one thing you keep deferring."];
    return { brief: b.slice(0, 4), recommended: b[0] };
  }
  function bankTodos() {
    var t = [{ text: "Reply to the pending vendor thread", source: "gmail", due: futureDate(1) }, { text: "Finish the launch checklist", source: "tasks", due: futureDate(2) }, { text: "Draft the weekly update", source: "notes", due: futureDate(3) }];
    return t;
  }
  function shelfTriage() {
    var items = inventory.length ? inventory : products.map(function (p, i) { return { sku: "SKU-" + (i + 1), name: String(p), stock: [3, 40, 120][i % 3], reorderAt: 20, orderQty: 500, cost: 2, price: 12 }; });
    var reorder = [], watch = [], dead = [], a = [], b = [], c = [];
    items.forEach(function (it, i) {
      var line = { sku: it.sku, product: it.name, orderQty: it.moq || 500, why: "stock " + it.stock + " under threshold " + (it.reorderAt || 20), action: "reorder", recoverable: true };
      if (it.stock <= (it.reorderAt || 20)) reorder.push(line);
      else if (it.stock > 100) { dead.push({ sku: it.sku, product: it.name, orderQty: 0, why: "slow mover, cash sitting", action: "discount", recoverable: true }); }
      else watch.push({ sku: it.sku, product: it.name, orderQty: 0, why: "steady", action: "hold", recoverable: true });
      (i % 3 === 0 ? a : i % 3 === 1 ? b : c).push(it.sku);
    });
    return {
      summary: bname + ": " + reorder.length + " SKUs need reordering now; cash is locked in " + dead.length + " slow movers.",
      cashLockedInDead: dead.reduce(function (s, d) { return s + 1200; }, 0),
      reorderNow: reorder, watch: watch, deadWeight: dead, abc: { a: a, b: b, c: c },
      plans: reorder.slice(0, 2).map(function (r) { return { sku: r.sku, title: "Reorder " + r.product, action: "Place a PO for " + r.orderQty, impact: "avoid stockout", detail: r.why }; }),
    };
  }
  function shelfRefine() { return { title: "Week-one plan", steps: ["Count real stock", "Place the PO", "Set a reorder alert", "Discount the dead SKU"], outcome: "No stockouts, less cash on the shelf", move: "reorder", detail: "for " + bname, impact: "high" }; }
  function adpulseDiagnosis() {
    var camps = [["Prospecting — Broad", "kill", "ROAS 0.8, burning cash"], ["Retargeting — 7d", "scale", "ROAS 4.2, room to grow"], ["Lookalike 1%", "keep", "ROAS 2.1, stable"]];
    return {
      score: 54, headline: bname + ": you're losing money on prospecting and underfunding your best retargeting.",
      // shapes follow AdPulse's normalize(): wins/leaks {title,detail}, actions {title,impact,effort,detail}
      wins: [
        { title: "Retargeting carries the account", detail: "ROAS 4.2 on the 7d window — the only line reliably returning cash." },
        { title: "Creative CTR beats benchmark", detail: "1.81% CTR on warm audiences vs the ~1% category norm." },
      ],
      leaks: [{ title: "Broad prospecting is bleeding", detail: "ROAS 0.8 over 30 days on the largest single line item.", monthlyBurn: 42000 }],
      actions: [
        { title: "Kill Prospecting — Broad", impact: "high", effort: "low", detail: "ROAS 0.8 for 30 days. Turn it off today and the loss stops today." },
        { title: "Shift that budget to Retargeting — 7d", impact: "high", effort: "low", detail: "Same spend at ROAS 4.2 is roughly 5× the return." },
        { title: "Cap frequency on the fatigued video", impact: "medium", effort: "low", detail: "Frequency past 6 with falling CTR — refresh the hook or cap it." },
        { title: "Rebuild the Lookalike 1% creative", impact: "medium", effort: "medium", detail: "ROAS 2.1 is stable but flat; the creative is the constraint, not the audience." },
      ],
      campaigns: camps.map(function (c) { return { name: c[0], verdict: c[1], note: c[2] }; }),
    };
  }
  function redlineAudit() {
    var slop = ["seamless", "unleash", "empower", "elevate", "game-changing"];
    var out = [];
    for (var i = 0; i < 5; i++) out.push({
      tag: ["headline", "cta", "body", "subhead", "footer"][i], label: "AI-slop: " + slop[i],
      snippet: "We " + slop[i] + " your workflow with next-gen synergy.", issue: "Empty hype word '" + slop[i] + "' — say the concrete thing instead.",
      find: "We " + slop[i] + " your workflow with next-gen synergy.", replace: bname + " " + (products[0] || "does the job") + " — " + voice + ".", preview: "Concrete, on-brand rewrite.",
    });
    return out;
  }
  function cartridgePitches() {
    var g = ["Runner", "Shooter", "Puzzle", "Dodge"]; var out = [];
    for (var i = 0; i < 4; i++) out.push({ title: [bname + " Run", "Chrome Rush", "Stack It", "Glue Dash"][i] || "Arcade " + i, idea: "A single-screen " + g[i].toLowerCase() + " themed on " + P(i) + ".", twist: "Collect " + KW(i) + " to score.", genre: g[i], vibe: (palette[0] || "#5B8CFF") + " neon", starring: bname, recommended: false });
    return markRec(out);
  }
  function htmlLanding() {
    var c = palette.length ? palette : ["#5B8CFF", "#0B0B0F", "#E8E8F0"];
    return "<!doctype html><html><head><meta charset=utf-8><title>" + bname + "</title><style>" +
      "*{margin:0;box-sizing:border-box;font-family:system-ui,sans-serif}body{background:" + (c[2] || "#fff") + ";color:" + (c[1] || "#111") + "}" +
      ".hero{min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:8vw;background:linear-gradient(135deg," + c[0] + "," + (c[1] || c[0]) + ");color:#fff}" +
      ".hero h1{font-size:6vw;max-width:14ch}.hero p{font-size:2vw;margin-top:1rem;opacity:.9}section{padding:8vw;min-height:60vh}img.hero-img{max-width:100%}" +
      "</style></head><body><div class=hero><h1>" + positioning + "</h1><p>" + (brand.tagline || voice) + "</p></div>" +
      "<section><h2>For " + audience + "</h2><p>" + voice + "</p></section>" +
      products.map(function (p) { return "<section><h2>" + p + "</h2><p>" + positioning + "</p></section>"; }).join("") +
      "<section><h2>" + (brand.tagline || "Get started") + "</h2><p>" + bname + "</p></section></body></html>";
  }
  function htmlGame() {
    return "<!doctype html><html><head><meta charset=utf-8><title>" + bname + " Arcade</title><style>html,body{margin:0;background:" + (palette[1] || "#0B0B0F") + ";overflow:hidden}canvas{display:block;margin:0 auto}</style></head>" +
      "<body><canvas id=c width=360 height=560></canvas><script>var x=document.getElementById('c').getContext('2d');var t=0;function f(){t++;x.fillStyle='" + (palette[1] || "#0B0B0F") + "';x.fillRect(0,0,360,560);x.fillStyle='" + (palette[0] || "#5B8CFF") + "';x.fillRect(160,280+Math.sin(t/20)*80,40,40);x.fillStyle='#fff';x.font='20px system-ui';x.fillText('" + bname + "',20,40);requestAnimationFrame(f)}f();<\/script></body></html>";
  }

  // ---- routing table (first match wins) -------------------------------------------------------
  // Each route: [test(lc,prompt), producer] where producer returns a VALUE (stringified if object/
  // array) or a special {image:true}/{video:true} marker handled below.
  var ROUTES = [
    // image / video generation (agentic) — check before text routes
    [function (lc, p, params) { return params.agentic && /generate_image|higgsfield|generate an image|image url|aspect_ratio|final image url|poll (the )?job|nano_banana/i.test(p); }, function (lc, p) { return { image: true, video: /video|reel|animate|motion|generate_video/i.test(lc) }; }],
    // redline audit — ORDER MATTERS: the audit asks for {find,replace} pairs and says "EXACT unique
    // substring", so the generic find/replace route two lines below shadows it and answers a JSON
    // OBJECT where the audit parses a JSON ARRAY (→ "audit came back empty", zero pinned cards).
    // The specific route has to win. Same shadowing hazard as the natal pair below.
    [function (lc, p) { return /worst offenders|ai-slop copy|unleash\/seamless|walls of meta-text|most damaging first/i.test(p); }, function () { return redlineAudit(); }],
    // redline / marquee find-replace edits and placements
    [function (lc, p) { return /place an image into the raw html|img src=|woven in appropriately/i.test(p); }, function () { return { find: "</body>", replace: '<img src="' + IMG_BASE + "/" + PROJECT.id + '/960x540/hero.png" style="max-width:100%"></body>' }; }],
    [function (lc, p) { return /find\/replace|exact unique substring|"find"[\s\S]*"replace"|the change the founder wants/i.test(p); }, function () { return { find: bname, replace: bname + " — " + (brand.tagline || "") }; }],
    [function (lc, p) { return /git_commit_push/i.test(p); }, function () { return { ok: true, sha: "abc1234", changes: 1 }; }],
    [function (lc, p) { return /design researcher|concrete, real references/i.test(p); }, function () { return "text:Real references for " + bname + ":\n- Linear.app — crisp product marketing\n- Stripe docs — calm density\n- Arc browser — playful but focused"; }],
    // arcana
    [function (lc, p) { return /three-card spread|reader at arcana|querent|\bomen\b|midnight card table/i.test(p); }, function () { return arcanaReading(); }],
    // natal — ORDER MATTERS: the full-read prompt also mentions "deeper-cut subjects", so match the
    // full read (natal-chart reader / approximation) BEFORE the deeper-cut (which is uniquely "deliver
    // the verdict"). Today-brief is distinct ("write today's brief for this chart").
    [function (lc, p) { return /write today's brief for this chart/i.test(p); }, function () { var n = natalRead(); return { today: n.today, power: n.power, pin: n.pin }; }],
    [function (lc, p) { return /natal-chart reader|approximation is expected|estimate the approximate/i.test(p); }, function () { return natalRead(); }],
    [function (lc, p) { return /deliver the verdict/i.test(p); }, function () { return { title: "The cut", body: "Blunt truth for " + bname + ": stop hedging. Two moves, this week — pick the one that scares you." }; }],
    // shelf
    [function (lc, p) { return /weeks_of_cover|cashlockedindead|deadweight|reordernow|classify every sku/i.test(p); }, function () { return shelfTriage(); }],
    [function (lc, p) { return /week-one worksheet|the owner picked this one-week plan|turn the picked plan/i.test(p); }, function () { return shelfRefine(); }],
    // a-plus
    [function (lc, p) { return /enhanced brand content|comparison chart argues|planning an a\+|the comparison chart argues/i.test(p); }, function () { return aplusDirections(); }],
    [function (lc, p) { return /writing a complete a\+|renders as a green check|ban the words/i.test(p); }, function () { return aplusStack(); }],
    [function (lc, p) { return /you already wrote this a\+|rewrite only the/i.test(p); }, function () { return aplusStack(); }],
    // adwall (adgen)
    [function (lc, p) { return /adwall|exactly 6 items[\s\S]*direction|directions[\s\S]*format/i.test(p); }, function () { return adDirections(6); }],
    // prism (imagegen)
    [function (lc, p) { return /senior art director|shot concepts|house design styles|image library/i.test(p); }, function () { return prismConcepts(); }],
    // studio
    [function (lc, p) { return /\bshoot list\b|recolor the product|art director[\s\S]*shoot|order matters/i.test(p); }, function () { return studioShoot(); }],
    // adforge concepts + regen
    [function (lc, p) { return /rewrite the copy for one existing ad concept|current hook:|keep its angle/i.test(p); }, function () { var o = adConcepts(1).concepts[0]; return { concept: o.name, name: o.name, hook: o.hook, primaryText: o.primaryText, headline: o.headline, description: o.description, cta: o.cta }; }],
    [function (lc, p) { return /concepts?[\s\S]*(primarytext|primary text)|forge (ads|concepts)|premium meta feed/i.test(p) || (/\bconcepts?\b/i.test(p) && /imageprompt/i.test(p)); }, function () { return adConcepts(3); }],
    // marquee landing / cartridge game HTML
    [function (lc, p) { return /remix it[\s\S]*full updated html|here is the current complete game/i.test(p); }, function () { return "html:" + htmlGame(); }],
    [function (lc, p) { return /expert arcade game developer|self-contained html5|make this game|canvas-based/i.test(p); }, function () { return "html:" + htmlGame(); }],
    [function (lc, p) { return /invent 4 wildly different pitches|attract-mode|arcade title|single-screen arcade/i.test(p); }, function () { return cartridgePitches(); }],
    [function (lc, p) { return /scroll-driven landing page|full-viewport|intersectionobserver|sticky mini-nav|landing page's html|reveal on scroll/i.test(p); }, function () { return "html:" + htmlLanding(); }],
    // bank
    [function (lc, p) { return /chief of staff|today's brief/i.test(p); }, function () { return bankBrief(); }],
    [function (lc, p) { return /assembling their personal to-do list|open action items|at most 40 items/i.test(p); }, function () { return bankTodos(); }],
    [function (lc, p) { return /answer from their notes|cite note titles|the brain[\s\S]*question:/i.test(p); }, function () { return "text:From your notes: the shortest path is to ship " + (products[0] || "the core") + " to a few users this week. (cite: 'Launch plan', 'Weekly notes')"; }],
    // connector discovery (bank/adpulse): reply exactly "none" (no live connectors in harness)
    [function (lc, p) { return /common tool-name prefix|trailing double underscore|mcp tool names available|connector that serves it/i.test(p); }, function () { return "text:none"; }],
    // adpulse CSV pull + diagnosis
    // ORDER MATTERS: the DIAGNOSIS prompt embeds the CSV export itself (header "Amount spent (INR)"),
    // so it must be matched BEFORE the live-pull route or the analyst gets handed a CSV back and the
    // readout never renders. The pull route is also tightened to the pull prompt's own language.
    [function (lc, p) { return /you are adpulse|blunt, numbers-first|pre-computed aggregates|monthlyburn/i.test(p); }, function () { return adpulseDiagnosis(); }],
    [function (lc, p) { return /reply with only a csv|campaign-level performance for the last 30 days/i.test(p); }, function () { return "text:Campaign name,Amount spent (INR),Impressions,Clicks,CTR,CPC,Purchases,Purchase value,ROAS\nProspecting — Broad,42000,900000,4200,0.47,10,30,33600,0.8\nRetargeting — 7d,18000,210000,3800,1.81,4.7,180,75600,4.2\nLookalike 1%,26000,540000,3100,0.57,8.4,90,54600,2.1"; }],
    // batch (YC answers / video scripts)
    [function (lc, p) { return /y combinator application|founder video|prepping the videos|complete answer options/i.test(p); }, function () { return labelTextArray(3); }],
    // identity (5 sequential label/text stages)
    [function (lc, p) { return /real human creator|how this exact person talks|visual world they film|recurring content pillars|who this creator is for/i.test(p); }, function () { return labelTextArray(3); }],
    // reel
    [function (lc, p) { return /vertical-friendly promo|image brief|4[–-]6 scenes|on-screen title/i.test(p); }, function () { return reelScenes(); }],
    // take
    [function (lc, p) { return /scripting a|what they're recording|beats, one per line/i.test(p); }, function () { return labelTextArray(3); }],
    // chat starters vs turn
    [function (lc, p) { return /chat-starter prompts|single best starter|at most 90 characters/i.test(p); }, function () { var a = [{ text: "Draft a launch post for " + (products[0] || bname), recommended: true }, { text: "What should I ship this week?", recommended: false }, { text: "Rewrite my homepage hero", recommended: false }]; return a; }],
    // huddle / chat turns / generic prose
    [function (lc, p) { return /live working call|move their project forward|you are betterchat|no-frills chat/i.test(p); }, function () { return "text:Here's the move for " + bname + ": pick the one lever that matters this week — " + (products[0] || "your core offer") + " — and cut everything else. What's blocking it right now?"; }],
    // redline respond-router (the audit route itself lives up top — see the ORDER MATTERS note there)
    [function (lc, p) { return /choose a mode|left a comment on one element|the comment wants to change/i.test(p); }, function () { return { mode: "edit", summary: "Tighten the copy", find: bname, replace: bname + " — " + voice, recommended: true, options: [], label: "Tighten", preview: "clearer" }; }],
  ];

  function imageUrlFor(prompt, vertical) {
    var seed = encodeURIComponent(String(prompt || "img").slice(0, 20).replace(/[^a-z0-9]+/gi, "-")) || "img";
    var ar = vertical || /9:16|portrait|vertical|story|reel/i.test(prompt) ? "540x960" : /1:1|square/i.test(prompt) ? "720x720" : "960x540";
    return IMG_BASE + "/" + PROJECT.id + "/" + ar + "/" + seed + ".png";
  }

  // Turn a producer's return VALUE into stream deltas.
  function toDeltas(val, params) {
    var prompt = params.prompt || (params.messages ? params.messages.map(function (m) { return m.content; }).join("\n") : "") || "";
    if (val && val.image) {
      var url = imageUrlFor(prompt, val.video ? "540x960" : "");
      var call = { name: val.video ? "generate_video" : "generate_image", arguments: {} };
      return [
        { type: "tool_proposed", call: call },
        { type: "tool_result", call: call, result: { ok: true, content: [{ type: "text", text: JSON.stringify({ url: url, rawUrl: url, minUrl: url, status: "completed" }) }] } },
        { type: "text", text: url + "\n" },
      ];
    }
    if (typeof val === "string") {
      if (val.indexOf("text:") === 0) return [{ type: "text", text: val.slice(5) }];
      if (val.indexOf("html:") === 0) return [{ type: "text", text: val.slice(5) }];
      return [{ type: "text", text: val }];
    }
    return [{ type: "text", text: JSON.stringify(val) }];
  }

  function respond(params) {
    var prompt = params.prompt || (params.messages ? params.messages.map(function (m) { return m.content; }).join("\n") : "") || "";
    var lc = prompt.toLowerCase();
    for (var i = 0; i < ROUTES.length; i++) {
      try { if (ROUTES[i][0](lc, prompt, params)) return toDeltas(ROUTES[i][1](lc, prompt, params), params); } catch (e) { note("responder", (e && e.message) || e); }
    }
    // generic fallbacks
    if (/json array|array of|a list of|return only a json array/i.test(lc)) return [{ type: "text", text: JSON.stringify(optionArray(3, /product|listing|packshot|sku/i.test(lc) ? "product" : "angle")) }];
    if (/\bjson\b/i.test(lc)) {
      if (/options|angles|variants|ideas|cards|pillars|posts|scripts|beats|drafts|concepts|hooks/i.test(lc)) return [{ type: "text", text: JSON.stringify(optionArray(3)) }];
      return [{ type: "text", text: JSON.stringify(objectFallback()) }];
    }
    return [{ type: "text", text: "Grounded in " + bname + ": " + positioning + " In their voice — " + voice + "." }];
  }
  function objectFallback() { return { title: bname, summary: positioning, body: positioning, voice: voice, audience: audience, palette: palette.slice(0, 4), products: products.slice(0, 6), chips: keywords.slice(0, 4), recommended: true, score: 78, steps: ["Nail the core loop", "Ship to 10 users", "Measure retention"], sections: [{ title: "What", body: positioning }, { title: "Who", body: audience }] }; }

  // ---- streaming plumbing ---------------------------------------------------------------------
  var listeners = {};
  function emit(event, payload) { (listeners[event] || []).forEach(function (h) { try { h(payload); } catch (_) {} }); }
  var streamSeq = 0;
  window.__HARNESS_CALLS__ = [];
  function logCall(kind, params, deltas) {
    var prompt = params.prompt || (params.messages ? params.messages.map(function (m) { return m.content; }).join(" ") : "") || "";
    var reply = deltas.map(function (d) { return d.type === "text" ? d.text : ("<" + d.type + ">"); }).join("").slice(0, 100);
    window.__HARNESS_CALLS__.push({ kind: kind, agentic: !!params.agentic, prompt: prompt.slice(0, 140), reply: reply });
  }
  function runStream(streamId, params) {
    var deltas = respond(params), i = 0, accText = "";
    logCall("stream", params, deltas);
    function step() {
      if (i < deltas.length) {
        var d = deltas[i++];
        if (d.type === "text") accText += d.text;
        emit("delta", Object.assign({ streamId: streamId }, d));
        setTimeout(step, 200);
      } else emit("delta", { streamId: streamId, type: "done", result: { text: accText, model: "harness-sonnet", usage: { inputTokens: 400, outputTokens: 220 } } });
    }
    setTimeout(step, 400);
  }

  // ---- grant / capabilities / context / storage ----------------------------------------------
  function grant(scope) {
    scope = scope || {};
    var models = (scope.models && scope.models.length) ? scope.models : ["sonnet", "haiku", "opus"];
    var tools = (scope.tools || []).map(function (t) { return { name: t, access: /write|create|send|post|generate|put|delete|update|upload|commit|push/i.test(t) ? "write" : "read" }; });
    var t = Date.now();
    return { origin: location.origin, mode: "trust", models: models, tools: tools, budgets: { maxTokensPerDay: 5000000, maxCallsPerMin: 240 }, contextKinds: scope.contextKinds || ["brand", "persona", "personal", "project", "idea", "note", "csv", "gsheet"], createdAt: t, updatedAt: t };
  }
  var GRANT = grant({});
  function capabilities() { return { version: "0.1", methods: [], models: ["sonnet", "haiku", "opus"], backends: ["claude-code (harness)"], agentic: true, user: { name: "Sameep" }, local: { tts: false } }; }
  function facets() { return PROJECT ? [PROJECT.brand, PROJECT.persona, PROJECT.personal, PROJECT.project].filter(Boolean) : []; }
  var BOUND_FOLDER = "~/Projects/" + (PROJECT ? PROJECT.id : "x");
  function metaOf(c) {
    var m = { id: c.id, name: c.name, kind: c.kind, publishedBy: c.publishedBy || "harness", updatedAt: c.updatedAt || Date.now(), swatches: (c.data && Array.isArray(c.data.palette)) ? c.data.palette.slice(0, 3) : undefined };
    if (c.kind === "project") m.folder = BOUND_FOLDER; // Redline binds storage to a project's folder
    return m;
  }
  var selectedId = PROJECT && PROJECT.brand ? PROJECT.brand.id : null;
  function contextOp(p) {
    p = p || {};
    if (p.op === "publish") return { ok: true, id: (p.context && p.context.id) || "ctx-" + (++streamSeq) };
    if (p.op === "list") return { ok: true, contexts: facets().map(metaOf) };
    if (p.op === "active") { var f = facets().find(function (c) { return c.id === selectedId; }) || (PROJECT && PROJECT.brand) || null; return { ok: true, context: f || null }; }
    if (p.op === "pick") { selectedId = PROJECT && PROJECT.brand ? PROJECT.brand.id : selectedId; return { ok: true, context: (PROJECT && PROJECT.brand) || null }; }
    if (p.op === "use") { var g = facets().find(function (c) { return c.id === p.id; }); if (g) { selectedId = g.id; return { ok: true, context: g }; } return { ok: true, context: null }; }
    return { ok: false, error: "unknown context op" };
  }
  // FRESH-USER storage: get() always resolves null and set/delete are no-op sinks. Every wrapp's
  // harness contract wants the "fresh user" path (Arcana/Bank/Cartridge/Shelf notes all require
  // storage.get → null so stage-1 auto-runs), and a write-only sink also avoids a real race: the
  // returning-user probe AND the connect chip both fire onReady, and if the 2nd boot's loadState
  // read back what stage-1 just wrote, it would replace `state` mid-stream and orphan the results.
  var store = {};
  function storageOp(p) {
    p = p || {};
    switch (p.op) {
      case "get": return { ok: true, value: null };
      case "set": return { ok: true };
      case "delete": return { ok: true };
      case "list": return { ok: true, keys: [] };
      // autoAssigned:false + a real folder so folder-bound wrapps (Redline) reach their model call.
      case "info": return { ok: true, info: { folder: BOUND_FOLDER, autoAssigned: false, count: Object.keys(store).length } };
      case "bind": return { ok: true, info: { folder: p.path || BOUND_FOLDER, autoAssigned: false, count: Object.keys(store).length } };
      default: return { ok: false, error: "unknown storage op" };
    }
  }

  var provider = {
    version: "0.1-harness", isRelay: true,
    request: function (args) {
      var method = args.method, params = args.params;
      return new Promise(function (resolve, reject) {
        try {
          switch (method) {
            case "claude_capabilities": return resolve(capabilities());
            case "claude_connect": { var g = grant(params); GRANT = g; setTimeout(function () { emit("connect", g); }, 0); return resolve(g); }
            case "claude_disconnect": return resolve({ ok: true });
            case "claude_permissions": return resolve(GRANT);
            case "claude_health": return resolve({ installed: true, reachable: true, paired: true, connected: true });
            case "claude_context": return resolve(contextOp(params));
            case "claude_storage": return resolve(storageOp(params));
            case "claude_listTools": return resolve({ tools: (GRANT.tools || []).map(function (t) { return { name: t.name, description: t.name, access: t.access }; }) });
            case "claude_callTool": return resolve({ ok: true, content: [{ type: "text", text: JSON.stringify({ url: imageUrlFor(JSON.stringify(params)) }) }] });
            case "claude_complete": { var ds = respond(params); logCall("complete", params, ds); var text = ds.filter(function (d) { return d.type === "text"; }).map(function (d) { return d.text; }).join(""); return resolve({ text: text, model: "harness-sonnet", usage: { inputTokens: 400, outputTokens: 220 } }); }
            case "claude_stream": { var id = "s" + (++streamSeq); runStream(id, params || {}); return resolve({ streamId: id }); }
            case "claude_cancel": return resolve({ ok: true });
            case "claude_speak": return reject(new Error("no local tts in harness"));
            case "claude_session": return resolve({ ok: true, text: "" });
            default: return reject(new Error("harness: unknown method " + method));
          }
        } catch (e) { note("provider", (e && e.message) || e); reject(e); }
      });
    },
    on: function (event, handler) { (listeners[event] = listeners[event] || []).push(handler); },
    removeListener: function (event, handler) { listeners[event] = (listeners[event] || []).filter(function (h) { return h !== handler; }); },
  };

  window.claude = provider;
  try { window.dispatchEvent(new Event("claude#initialized")); } catch (_) {}
  setTimeout(function () { emit("health", { installed: true, reachable: true, paired: true, connected: true }); }, 10);
  window.__HARNESS_READY__ = true;
})();
