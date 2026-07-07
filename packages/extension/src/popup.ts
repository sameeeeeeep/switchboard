/**
 * Popup: pairing, the per-origin grant list (with revoke), the audit view/export, and the kill
 * switch. This is the standing control surface; per-action write consent happens in its own
 * focused window (consent.ts). Everything here talks to the daemon via the background worker's
 * control channel — the popup never holds the pairing token or touches the socket directly.
 */

const $ = (id: string) => document.getElementById(id)!;
const send = (msg: unknown) => chrome.runtime.sendMessage(msg) as Promise<any>;

function fmt(ts: number) { return new Date(ts).toLocaleString(); }

/** Safe element builder — text goes in as textContent, never parsed as HTML. This popup runs in
 *  a privileged context and renders daemon/MCP-sourced strings (tool names, origins, notes), so
 *  we never use innerHTML with interpolated values. */
function el(tag: string, opts: { class?: string; text?: string } = {}, ...kids: (Node | string)[]) {
  const n = document.createElement(tag);
  if (opts.class) n.className = opts.class;
  if (opts.text != null) n.textContent = opts.text;
  for (const k of kids) n.append(k);
  return n;
}

async function refresh() {
  const { paired } = await send({ type: "getStatus" });
  ($("pairing") as HTMLElement).hidden = !!paired;
  $("status").textContent = paired ? "paired" : "not paired";
  if (!paired) { $("origins").textContent = ""; $("audit").textContent = "Pair to see activity."; return; }

  // Grants
  const g = await send({ type: "control", action: "listGrants" });
  const origins = $("origins");
  origins.textContent = "";
  const grants = g?.grants ?? [];
  if (!grants.length) origins.append(el("div", { class: "card muted", text: "No sites connected yet." }));
  for (const grant of grants) {
    const writes = grant.tools.filter((t: any) => t.access === "write").length;
    const revoke = el("button", { text: "Revoke" }) as HTMLButtonElement;
    revoke.addEventListener("click", async () => { await send({ type: "control", action: "revoke", args: { origin: grant.origin } }); refresh(); });
    origins.append(el("div", { class: "card" },
      el("div", { class: "row" }, el("strong", { text: grant.origin }), revoke),
      el("div", { class: "muted", text: `${grant.models.join(", ") || "no model"} · ${grant.tools.length} tools (${writes} write) · ${grant.usage?.tokensToday ?? 0}/${grant.budgets.maxTokensPerDay} tok today` })));
  }

  // Audit (most recent first)
  const a = await send({ type: "control", action: "audit", args: { limit: 40 } });
  const entries = a?.entries ?? [];
  const audit = $("audit");
  audit.textContent = "";
  if (!entries.length) audit.append(el("div", { text: "No activity yet." }));
  for (const e of entries) {
    audit.append(el("div", { text: `${fmt(e.ts)} · ${e.origin} · ${e.method ?? e.toolName ?? e.kind} · ${e.decision ?? e.outcome}` }));
  }
}

$("pair").addEventListener("click", async () => {
  const token = ($("token") as HTMLInputElement).value.trim();
  if (!token) return;
  await send({ type: "pair", token });
  refresh();
});

$("kill").addEventListener("click", async () => {
  await send({ type: "killSwitch" });
  refresh();
});

$("export").addEventListener("click", async () => {
  const a = await send({ type: "control", action: "audit", args: { limit: 5000 } });
  const blob = new Blob([JSON.stringify(a?.entries ?? [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: "relay-audit.json" });
});

refresh();
