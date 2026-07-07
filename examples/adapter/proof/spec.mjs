// brandbrain's lib/studio/spec.ts — the one runtime value the gaps route needs (types erase).
export function gapScore(c) {
  const s = 0.3 * c.demand + 0.25 * c.sparsity + 0.25 * c.vulnerability + 0.2 * c.feasibility - 0.2 * c.risk;
  return Math.max(0, Math.min(1, s));
}
