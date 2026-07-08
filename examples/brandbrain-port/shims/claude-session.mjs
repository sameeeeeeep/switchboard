// SEAM SHIM · warm session. brandbrain's Studio generates a long run of cards in one conversation.
// The daemon now provides a real WARM session (claude_session): one long-lived process per sessionId,
// turns queued sequentially — no cold start per card, no thundering herd of concurrent processes. This
// restores brandbrain's original speed/behaviour (its transcript-in-process warm thread), instead of
// the stateless one-shot-per-card the first port used.
import { getProvider } from "../../adapter/claude.mjs";

const STUDIO_SYSTEM = `You are brandbrain, a launch & growth strategist for consumer (D2C) brands, running a guided brand build for a founder in one continuous conversation.

Across this conversation you expand their idea into a brief, then generate OPTIONS for each piece of the brand — name, positioning, audience, voice, visual identity, competitors, pricing, product range, suppliers — as structured cards they pick from. Each turn tells you exactly what to produce and the JSON shape to return.

Rules:
- Remember the brief and the decisions locked earlier in this conversation; build on them, never contradict them.
- Be sharp and specific — concrete names, numbers and a real point of view, never generic filler. Each option is a genuinely different direction.
- When you cite a reference brand, use a REAL brand and its real domain; never invent a brand, a domain, or a URL. Cite a source url only if you actually found it via web search; otherwise omit it.
- Sentence case. No emoji, no hashtags. Keep text tight — these render as compact cards, not essays.
- Output ONLY the JSON the turn asks for. No prose, no markdown code fences.`;

export async function sessionSend(sessionId, prompt) {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const r = await provider.request({
      method: "claude_session",
      params: { op: "send", sessionId, prompt, system: STUDIO_SYSTEM, effort: "low" },
    });
    return typeof r?.text === "string" ? r.text : null;
  } catch {
    return null;
  }
}

export function endSession(sessionId) {
  const provider = getProvider();
  if (!provider) return;
  provider.request({ method: "claude_session", params: { op: "end", sessionId } }).catch(() => {});
}
