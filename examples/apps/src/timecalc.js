// TIME CALCULATOR — a NON-AI widget. Timestamps, date math and durations, IN THE TAB. No model, no
// cloud, no upload, no cost. Same doctrine as qr.js / contrast.js. L0 engine tier. Maths in
// kit/timecalc.js (deterministic — any "now" is passed in; the UI supplies the clock via a button).
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
import { fromUnix, toUnix, addToDate, diff, convertDuration, relative, humanDuration, normUnit } from "./kit/timecalc.js";

const APP = {
  id: "timecalc", name: "Time Calculator", installUrl: "https://thelastprompt.ai/switchboard/",
  scope: { reason: "Time Calculator — timestamp & date maths entirely on your device. No AI, no upload, no cost.", models: [], tools: [] },
  usesContext: null,
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const nowMs = () => Date.now();   // UI-only clock (never used inside the tested kit)

let relay = null;
mountConnect($("chip-dock"), { scope: APP.scope, context: APP.usesContext, installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; }, onDisconnect: () => { relay = null; } });
(async () => { const r = await whenRelayReady(1500, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) relay = r; } })();

// ==== settings — the active mode + the last inputs (nothing sensitive) =======================
const SETTINGS_KEY = APP.id + "-settings";
const DEFAULTS = { mode: "unix", ts: "1700000000", date: "2024-06-01T12:00:00Z",
  addAmt: "30", addUnit: "day", diffA: "2024-01-01", diffB: "2024-06-01",
  durVal: "90", durFrom: "minute", durTo: "hour" };
let state = loadSettings();
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state)); } catch { /* private mode */ } }

const MODES = [
  { id: "unix", label: "Timestamp" },
  { id: "add", label: "Date math" },
  { id: "between", label: "Between dates" },
  { id: "dur", label: "Duration" },
];
const DUR_UNITS = ["ms", "second", "minute", "hour", "day", "week"];

// ==== render ================================================================================
function render() {
  const view = $("view"); view.textContent = "";
  const wrap = el("div", "work");
  const tabs = el("div", "kindrow");
  for (const m of MODES) { const b = el("button", "kindbtn" + (m.id === state.mode ? " on" : ""), m.label);
    b.onclick = () => { state.mode = m.id; saveSettings(); render(); }; tabs.append(b); }
  wrap.append(tabs);
  wrap.append(modeForm());
  const out = el("div", "outcard"); out.id = "t-out"; fillOut(out);
  wrap.append(out);
  wrap.append(badge());
  view.append(wrap);
}

function field(label, id, val, ph) {
  const f = el("div", "field"); f.append(el("label", "flabel", label));
  const i = el("input"); i.className = "in"; i.id = id; i.value = val ?? ""; if (ph) i.placeholder = ph;
  i.addEventListener("input", () => { setFromInput(id, i.value); refreshOut(); });
  f.append(i); return f;
}
function unitSel(label, id, val) {
  const f = el("div", "field"); f.append(el("label", "flabel", label));
  const s = el("select", "in"); s.id = id;
  for (const u of DUR_UNITS) { const o = el("option", null, u); o.value = u; s.append(o); }
  s.value = val; s.onchange = () => { setFromInput(id, s.value); refreshOut(); };
  f.append(s); return f;
}

function modeForm() {
  const box = el("div", "trows");
  if (state.mode === "unix") {
    box.append(field("Unix timestamp (seconds or ms)", "t-ts", state.ts, "1700000000"));
    box.append(nowBtn("t-ts", "seconds"));
    box.append(field("…or a date to get its timestamp", "t-date", state.date, "2024-06-01 12:00"));
  } else if (state.mode === "add") {
    box.append(field("Start date", "t-adate", state.date, "2024-06-01"));
    const row = el("div", "uconv");
    row.append(field("Amount (− to subtract)", "t-amt", state.addAmt, "30"));
    const uf = el("div", "field"); uf.append(el("label", "flabel", "Unit"));
    const s = el("select", "in"); s.id = "t-aunit";
    for (const u of [...DUR_UNITS, "month", "year"]) { const o = el("option", null, u); o.value = u; s.append(o); }
    s.value = state.addUnit; s.onchange = () => { setFromInput("t-aunit", s.value); refreshOut(); };
    uf.append(s); row.append(el("span"), uf);
    box.append(row);
  } else if (state.mode === "between") {
    const row = el("div", "twin");
    row.append(field("From", "t-da", state.diffA, "2024-01-01"));
    row.append(field("To", "t-db", state.diffB, "2024-06-01"));
    box.append(row);
  } else {
    const row = el("div", "uconv");
    row.append(field("Value", "t-dv", state.durVal, "90"));
    row.append(unitSel("From", "t-df", state.durFrom));
    row.append(unitSel("To", "t-dt", state.durTo));
    box.append(row);
  }
  return box;
}
function nowBtn(targetId, unit) {
  const b = el("button", "copy", "Use now");
  b.onclick = () => { const v = unit === "seconds" ? Math.floor(nowMs() / 1000) : nowMs(); setFromInput(targetId, String(v)); render(); };
  const wrap = el("div"); wrap.style.marginTop = "-6px"; wrap.append(b); return wrap;
}

function setFromInput(id, val) {
  const map = { "t-ts": "ts", "t-date": "date", "t-adate": "date", "t-amt": "addAmt", "t-aunit": "addUnit",
    "t-da": "diffA", "t-db": "diffB", "t-dv": "durVal", "t-df": "durFrom", "t-dt": "durTo" };
  if (map[id]) { state[map[id]] = val; saveSettings(); }
}
function refreshOut() { const o = $("t-out"); if (o) fillOut(o); }

function line(k, v) { const d = el("div", "tres"); d.append(el("span", "k", k + "  ")); d.append(document.createTextNode(v)); return d; }

function fillOut(out) {
  out.textContent = "";
  try {
    if (state.mode === "unix") {
      const dateStr = $("t-date")?.value ?? state.date;
      const tsStr = $("t-ts")?.value ?? state.ts;
      if (tsStr.trim()) {
        const r = fromUnix(tsStr.trim());
        if (!r) return out.append(el("div", "err", "That isn't a valid timestamp."));
        const big = el("div", "tbig"); big.append(el("b", null, r.iso)); out.append(big);
        out.append(line("read as", r.detectedUnit));
        out.append(line("seconds", String(r.seconds)));
        out.append(line("milliseconds", String(r.ms)));
        out.append(line("relative", relative(r.ms, nowMs())));
      } else if (dateStr.trim()) {
        const r = toUnix(dateStr.trim());
        if (!r) return out.append(el("div", "err", "That isn't a date I can read."));
        const big = el("div", "tbig"); big.append(el("b", null, String(r.seconds))); out.append(big);
        out.append(line("seconds", String(r.seconds)));
        out.append(line("milliseconds", String(r.ms)));
      } else out.append(el("div", "placeholder", "Enter a timestamp, or a date to convert."));
    } else if (state.mode === "add") {
      const r = addToDate(state.date, state.addAmt, state.addUnit);
      if (!r) return out.append(el("div", "placeholder", "Enter a start date, an amount and a unit."));
      const big = el("div", "tbig"); big.append(el("b", null, r)); out.append(big);
      out.append(line("relative", relative(Date.parse(r), nowMs())));
    } else if (state.mode === "between") {
      const r = diff(state.diffA, state.diffB);
      if (!r) return out.append(el("div", "placeholder", "Enter two dates."));
      const big = el("div", "tbig"); big.append(el("b", null, r.human || "0s")); out.append(big);
      out.append(line("direction", r.future ? "second is later" : "first is later"));
      out.append(line("days", r.days.toFixed(4)));
      out.append(line("hours", r.hours.toFixed(2)));
      out.append(line("minutes", Math.round(r.minutes).toString()));
    } else {
      const r = convertDuration(state.durVal, state.durFrom, state.durTo);
      if (Number.isNaN(r)) return out.append(el("div", "placeholder", "Enter a value and two units."));
      const big = el("div", "tbig"); big.append(el("b", null, `${r} ${state.durTo}`)); out.append(big);
      out.append(line("from", `${state.durVal} ${state.durFrom}`));
    }
  } catch { out.append(el("div", "err", "Couldn't compute that.")); }
}

function badge() { const b = el("div", "nobadge"); b.append(el("span", "dot"), el("span", null, "Runs fully on your device · no AI · no upload · no cost")); return b; }
render();

// ---- God's hand ------------------------------------------------------------------------------------
exposeToGod({
  name: "time_calc",
  description: "Timestamp / date maths on-device (no AI). mode 'unix' (timestamp↔date), 'add' (date + N units), "
    + "'between' (gap between two dates), 'duration' (convert a duration).",
  inputSchema: {
    mode: "string — unix | add | between | duration.",
    timestamp: "number/string — for 'unix': a unix timestamp (s or ms, auto-detected).",
    date: "string — for 'unix' reverse, or the start date for 'add'.",
    amount: "number — for 'add': how many units (negative subtracts).",
    unit: "string — for 'add'/'duration': ms|second|minute|hour|day|week|month|year.",
    a: "string — for 'between': the first date.",
    b: "string — for 'between': the second date.",
    value: "number — for 'duration': the amount.",
    from: "string — for 'duration': the unit to convert from.",
    to: "string — for 'duration': the unit to convert to.",
  },
  execute: async (input = {}) => {
    const now = nowMs();
    switch (input.mode) {
      case "add": { const r = addToDate(input.date, input.amount, input.unit); if (!r) throw new Error("bad date/amount/unit"); return { result: r, relative: relative(Date.parse(r), now) }; }
      case "between": { const r = diff(input.a, input.b); if (!r) throw new Error("bad dates"); return { human: r.human, days: r.days, hours: r.hours, seconds: r.seconds, future: r.future }; }
      case "duration": { const r = convertDuration(input.value, input.from, input.to); if (Number.isNaN(r)) throw new Error("unknown duration unit"); return { result: r, from: `${input.value} ${normUnit(input.from)}`, to: `${r} ${normUnit(input.to)}` }; }
      default: {
        if (input.date && input.timestamp == null) { const r = toUnix(input.date); if (!r) throw new Error("bad date"); return r; }
        const r = fromUnix(input.timestamp); if (!r) throw new Error("bad timestamp");
        return { iso: r.iso, seconds: r.seconds, ms: r.ms, detectedUnit: r.detectedUnit, relative: relative(r.ms, now) };
      }
    }
  },
});

// ---- the glance ------------------------------------------------------------------------------------
exposeWidget((input) => {
  const now = nowMs();
  if (input && input.timestamp != null) { const r = fromUnix(input.timestamp);
    if (r) return { kicker: "TIME · ON YOUR DEVICE", title: r.iso.slice(0, 19).replace("T", " "), openLabel: "Open Time", shape: "text",
      result: { body: relative(r.ms, now), caption: `unix ${r.seconds} · no AI` } }; }
  // default: reflect the active mode's current answer, else the epoch of `state.ts`
  const r = fromUnix(state.ts);
  return { kicker: "TIME · ON YOUR DEVICE", title: r ? r.iso.slice(0, 19).replace("T", " ") : "Time Calculator", openLabel: "Open Time", shape: "text",
    result: { body: r ? relative(r.ms, now) : "Timestamps, date math and durations — on your device.", caption: "no AI · on your device" } };
});

try { (typeof window !== "undefined" ? window : globalThis).__timecalcTest = { fromUnix, toUnix, addToDate, diff, convertDuration }; } catch { /* ignore */ }
