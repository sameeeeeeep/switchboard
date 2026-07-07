// Ad generator — the "full AI + connectors" example. URL in → the model reads the site (WebFetch,
// a read tool) → extracts the brand → calls Higgsfield generate_image (a write/money tool, gated by
// per-action consent) for a few ad concepts → renders the returned images. The app integrates
// nothing: it borrows the visitor's Claude AND their Higgsfield connector through window.claude.
import { whenRelayReady } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
let relay = null;

function event(text) { const d = document.createElement("div"); d.className = "event"; d.textContent = text; $("events").append(d); }

$("connect").addEventListener("click", async () => {
  const r = await whenRelayReady();
  if (!("connect" in r)) { $("status").textContent = `— sidekick not installed (${r.installUrl})`; return; }
  try {
    // Ask for exactly what this app needs: read the web + generate images. The consent window
    // shows WebFetch as read and generate_image as write.
    const grant = await r.connect({
      reason: "generate ads from a website's brand",
      tools: ["WebFetch", "mcp__higgsfield__generate_image"],
    });
    relay = r;
    $("go").disabled = false;
    $("connect").disabled = true;
    $("status").textContent = `— connected · ${grant.models.join(", ") || "default model"}`;
  } catch (err) {
    $("status").textContent = `— connect rejected (${err?.code ?? "?"})`;
  }
});

$("go").addEventListener("click", async () => {
  if (!relay) return;
  const url = $("url").value.trim();
  if (!url) return;
  $("events").textContent = "";
  $("brand").textContent = "";
  $("ads").textContent = "";

  const prompt = [
    `You are an ad creative director. Target website: ${url}`,
    `1) Use WebFetch to read that page.`,
    `2) In 3-4 lines, summarize the brand: name, what it sells, tone, and 2-3 signature colors.`,
    `3) Then generate exactly 3 ads by calling the generate_image tool 3 times, each with a vivid,`,
    `   on-brand prompt (mention the brand's colors/tone) and aspect_ratio "1:1".`,
    `Keep prose short; the images are the deliverable.`,
  ].join("\n");

  try {
    for await (const d of relay.stream({ prompt, agentic: true })) {
      if (d.type === "tool_proposed") {
        if (d.call.name === "WebFetch") event(`🌐 reading the site… (auto-approved read)`);
        else if (d.call.name.endsWith("generate_image")) event(`🎨 generating an ad… (awaiting your consent)`);
      } else if (d.type === "tool_result") {
        if (d.call.name.endsWith("generate_image")) renderAd(d.result);
        else if (!d.result.ok) event(`⛔ ${d.call.name} blocked: ${d.result.error?.message}`);
      } else if (d.type === "text") {
        $("brand").textContent += d.text;
      } else if (d.type === "error") {
        event(`[error: ${d.error.message}]`);
      }
    }
  } catch (err) {
    event(`[stream failed: ${err?.code ?? "?"}]`);
  }
});

// The generate_image result content carries JSON with a { url } — render it as an ad card.
function renderAd(result) {
  if (!result.ok) { event(`⛔ generation blocked: ${result.error?.message}`); return; }
  const text = (result.content ?? []).map((c) => c.text ?? "").join("");
  let data = {};
  try { data = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { /* ignore */ }
  if (!data.url) return;
  const card = document.createElement("div");
  card.className = "ad";
  const img = document.createElement("img");
  img.src = data.url;
  img.alt = data.prompt ?? "generated ad";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = data.prompt ? data.prompt.slice(0, 120) : "";
  card.append(img, cap);
  $("ads").append(card);
}
