// North-star meter — counting core (reference impl, to wire into the daemon later).
//
// The north star is "weekly active wrapp-runs on connected Switchboards." This module turns a stream
// of local run events into an HONEST, PRIVACY-FIRST weekly signal:
//   • counts happen ON-DEVICE; only an aggregate ever leaves.
//   • the emitted payload contains ONLY {anonId, week, runsAtLeast, wrappCount} — NEVER a prompt,
//     file, wrapp input/output, URL, or user identity.
//   • runsAtLeast is FLOORED (nearest `floorTo`) and expressed as a lower bound, because opt-out /
//     offline instances are never counted — the true total is always ≥ what we can see.
//   • anonId rotates per-week and is derived from a per-install random secret (NOT user identity),
//     so week-over-week retention can be derived without ever identifying a person.
//
// No dependencies beyond node:crypto. Pure + deterministic → testable.

import { createHash } from "node:crypto";

/** ISO-week key like "2026-W32" for a timestamp (ms). */
export function isoWeek(ms) {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;            // Mon=1..Sun=7
  day.setUTCDate(day.getUTCDate() + 4 - dow);  // nearest Thursday
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** A rotating, non-identifying instance id: hash(installSecret + week), truncated. */
export function anonId(installSecret, week) {
  return createHash("sha256").update(`${installSecret}:${week}`).digest("hex").slice(0, 16);
}

export function emptyState() {
  return { weeks: {} }; // week -> { runs: number, wrapps: Set<string> }
}

/** Ingest ONE run event {ts, wrappId}. Stores no content — only a count and the set of wrapp ids. */
export function ingest(state, { ts, wrappId }) {
  const wk = isoWeek(ts);
  const w = state.weeks[wk] || (state.weeks[wk] = { runs: 0, wrapps: new Set() });
  w.runs += 1;
  if (wrappId) w.wrapps.add(String(wrappId));
  return state;
}

/**
 * The honest weekly signal. Returns one emit-safe record per week:
 *   { anonId, week, runsAtLeast, wrappCount }
 * runsAtLeast is floored to `floorTo` (a lower bound, never the exact count).
 */
export function weekly(state, installSecret, { floorTo = 10 } = {}) {
  return Object.entries(state.weeks)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, w]) => ({
      anonId: anonId(installSecret, week),
      week,
      runsAtLeast: Math.floor(w.runs / floorTo) * floorTo,
      wrappCount: w.wrapps.size,
    }));
}

/** The ONLY keys allowed to leave the device. Used to assert the privacy invariant. */
export const EMIT_KEYS = ["anonId", "week", "runsAtLeast", "wrappCount"];
