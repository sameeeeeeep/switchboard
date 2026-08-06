// OSSurfaceKnowledge.swift — the three KNOWLEDGE surfaces of Switchboard OS, ported to real SwiftUI.
//
// Ported from the web shell modules (examples/apps/src/os/surfaces/{history,graph,dictionary}.js):
//   • HistorySurface    — a receipt for every God / wrapp run, grouped by day (history.js)
//   • GraphSurface      — how the vault connects: fixed-layout nodes + an inspector (graph.js)
//   • DictionarySurface — the project vocabulary, grouped + bucket-filtered (dictionary.js)
//
// Design law (OSShellView.swift / OS.md §3.1): "discipline in the frame, color in the icons." Chrome is
// monochrome graphite; lime = active/actionable, indigo = local/project pull. All shared tokens
// (Color.page/panel/…, Font.hanken/splMono, IsoTile, colorForId, hueForId, Surface, SectionHead) come
// from OSShellView.swift / RelayMenuBar.swift — this file only ADDS the three views + their sample data.
//
// Every interaction is real (no dead ends): rows expand via @State, filters/toggles filter via @State,
// and every "open / reopen / scope / used-in" affordance routes through `onNavigate(Surface)`.

import SwiftUI

// The one warm accent these surfaces need that isn't a shared token (per the theme brief).
private let amber = Color(red: 0.96, green: 0.62, blue: 0.04)

// =====================================================================================================
// MARK: - Small shared bits (a hover chip + a receipt cell — kept private to this file)
// =====================================================================================================

/// A pill button with a hover/active edge — used for filter chips, scope chips, toggles.
private struct KChip: View {
    let text: String
    var active: Bool = false
    var accent: Color = .inkSec
    var solid: Bool = false                 // lime CTA style (e.g. "Add term")
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.hanken(12, solid ? .semibold : .regular))
                .foregroundColor(solid ? Color(red: 0.05, green: 0.05, blue: 0.06)
                                       : (active ? .ink : accent))
                .padding(.horizontal, 11).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8)
                    .fill(solid ? Color.lime : Color.panel))
                .overlay(RoundedRectangle(cornerRadius: 8)
                    .stroke(solid ? .clear
                            : ((hover || active) ? Color.indigo.opacity(0.55) : Color.edge),
                            lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// =====================================================================================================
// MARK: - HistorySurface
// =====================================================================================================

struct HistRun: Identifiable {
    let id = UUID()
    let tm: String; let wrapp: String; let prompt: String
    let kind: String; let result: String
    let params: [String]; let out: String; let prov: String
}
struct HistDay: Identifiable {
    let id = UUID(); let day: String; let runs: [HistRun]
}

// ═══ LIVE receipts — History is the lens on the REAL activity trail: ~/.relay/audit.log (every
// broker request/tool_call: ts · origin · method · outcome — no prompt text is logged, so rows show
// the ACT, honestly) + guide-history.jsonl (guided-cursor runs with title + pass/fail). Consecutive
// same-act events merge into one receipt ("Saved ×12") so a busy wrapp reads as work, not spam.

func histReceipts(days windowDays: Double = 14) -> [HistDay] {
    struct Ev { let ts: Double; let app: String; let verb: String; let method: String; let outcome: String; let note: String }
    var evs: [Ev] = []

    // audit.log tail (append-only; ~2MB covers weeks)
    let auditPath = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/audit.log")
    if let fh = FileHandle(forReadingAtPath: auditPath) {
        let size = (try? fh.seekToEnd()) ?? 0
        let cap: UInt64 = 2_000_000
        let tailed = size > cap
        try? fh.seek(toOffset: tailed ? size - cap : 0)
        let data = fh.readDataToEndOfFile(); try? fh.close()
        let minTs = Date().timeIntervalSince1970 * 1000 - windowDays * 86_400_000
        var lines = (String(data: data, encoding: .utf8) ?? "").split(separator: "\n")
        if tailed, !lines.isEmpty { lines.removeFirst() }
        for line in lines {
            guard let d = line.data(using: .utf8),
                  let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                  let ts = (o["ts"] as? NSNumber)?.doubleValue, ts >= minTs,
                  let origin = o["origin"] as? String else { continue }
            let name = (o["toolName"] as? String) ?? (o["method"] as? String) ?? ""
            let outcome = (o["outcome"] as? String) ?? ""
            // denied acts are receipts too — the consent story, visible
            guard let verb = histVerb(kind: o["kind"] as? String ?? "", name: name) else { continue }
            let app = wrappFromOrigin(origin)
            guard !app.isEmpty else { continue }
            evs.append(Ev(ts: ts, app: app, verb: verb, method: name, outcome: outcome,
                          note: (o["note"] as? String) ?? ""))
        }
    }

    // merge consecutive identical (app, verb, outcome) events within 10 min → one receipt ×N
    evs.sort { $0.ts < $1.ts }
    struct Merged { var first: Ev; var last: Double; var n: Int }
    var merged: [Merged] = []
    for e in evs {
        if var m = merged.last, m.first.app == e.app, m.first.verb == e.verb,
           m.first.outcome == e.outcome, e.ts - m.last <= 10 * 60_000 {
            m.n += 1; m.last = e.ts; merged[merged.count - 1] = m
        } else {
            merged.append(Merged(first: e, last: e.ts, n: 1))
        }
    }

    let tf = DateFormatter(); tf.dateFormat = "HH:mm"
    var runs: [(Double, HistRun)] = merged.map { m in
        let label = m.n == 1 ? histLabel(m.first.verb) : "\(histLabel(m.first.verb)) ×\(m.n)"
        let denied = m.first.outcome == "denied"
        return (m.last, HistRun(
            tm: tf.string(from: Date(timeIntervalSince1970: m.last / 1000)),
            wrapp: m.first.app,
            prompt: label,
            kind: histKind(m.first.verb),
            result: denied ? "denied" : m.first.outcome,
            params: [m.first.method],
            out: m.first.note.isEmpty ? (m.n > 1 ? "\(m.n) events" : "1 event") : m.first.note,
            prov: "origin-verified · audit.log"))
    }

    // guided-cursor runs — titled receipts with pass/fail
    let guidePath = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/guide-history.jsonl")
    if let text = try? String(contentsOfFile: guidePath, encoding: .utf8) {
        let minTs = Date().timeIntervalSince1970 * 1000 - windowDays * 86_400_000
        for line in text.split(separator: "\n") {
            guard let d = line.data(using: .utf8),
                  let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
            let ts = (o["finishedAt"] as? NSNumber)?.doubleValue ?? (o["startedAt"] as? NSNumber)?.doubleValue ?? 0
            guard ts >= minTs else { continue }
            let passed = (o["passed"] as? NSNumber)?.intValue ?? 0
            let total = (o["total"] as? NSNumber)?.intValue ?? 0
            runs.append((ts, HistRun(
                tm: tf.string(from: Date(timeIntervalSince1970: ts / 1000)),
                wrapp: "guide",
                prompt: (o["title"] as? String) ?? "Guided run",
                kind: "notes",
                result: (o["outcome"] as? String) ?? "done",
                params: [(o["mode"] as? String) ?? "guide"],
                out: total > 0 ? "\(passed)/\(total) steps passed" : "",
                prov: "guide-history.jsonl")))
        }
    }

    // day-group, newest first
    runs.sort { $0.0 > $1.0 }
    let df = DateFormatter(); df.dateFormat = "EEE · MMM d"
    let cal = Calendar.current
    var out: [HistDay] = []
    var curKey = ""
    var bucket: [HistRun] = []
    func dayLabel(_ ts: Double) -> String {
        let d = Date(timeIntervalSince1970: ts / 1000)
        if cal.isDateInToday(d) { return "Today" }
        if cal.isDateInYesterday(d) { return "Yesterday" }
        return df.string(from: d)
    }
    for (ts, r) in runs {
        let key = dayLabel(ts)
        if key != curKey {
            if !bucket.isEmpty { out.append(HistDay(day: curKey, runs: bucket)) }
            curKey = key; bucket = []
        }
        bucket.append(r)
    }
    if !bucket.isEmpty { out.append(HistDay(day: curKey, runs: bucket)) }
    return out
}

// what counts as an act worth a receipt (reads/plumbing don't)
private func histVerb(kind: String, name: String) -> String? {
    if kind == "tool_call" {
        if name.contains("transcribe") { return "dictation" }
        if name.contains("storage__set") { return "save" }
        if name.contains("context__publish") { return "publish" }
        if name.contains("__get") || name.contains("__list") { return nil }
        return "run"
    }
    if kind == "request" {
        switch name {
        case "claude_complete", "claude_stream": return "run"
        case "claude_transcribe": return "dictation"
        case "claude_speak": return "reply"
        default: return nil
        }
    }
    return nil
}
private func histLabel(_ verb: String) -> String {
    switch verb {
    case "dictation": return "Dictated"
    case "save": return "Saved work"
    case "publish": return "Published context"
    case "reply": return "Spoke a reply"
    default: return "Ran the model"
    }
}
private func histKind(_ verb: String) -> String {
    switch verb {
    case "save", "publish": return "doc"
    case "dictation": return "notes"
    default: return "text"
    }
}

private func histGlyph(_ kind: String) -> String {
    switch kind {
    case "mark": return "◈"
    case "doc": return "▦"
    case "image": return "▭"
    default: return "▤"                      // text / notes / gallery
    }
}

struct HistorySurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var days: [HistDay] = []
    @State private var collapsedDays: Set<String> = []
    @State private var openRuns: Set<UUID> = []
    @State private var searchOn = false
    @State private var q = ""
    @State private var wrappIx = 0
    @State private var dateIx = 0

    private var allWrapps: [String] {
        var seen: [String] = []
        for d in days { for r in d.runs where !seen.contains(r.wrapp) { seen.append(r.wrapp) } }
        return seen
    }
    private var wrappOpts: [String] { ["all"] + allWrapps }
    private var dateOpts: [String] { ["14d"] + days.map { $0.day } }
    private var curWrapp: String { wrappOpts[min(wrappIx, wrappOpts.count - 1)] }
    private var curDate: String { dateOpts[min(dateIx, dateOpts.count - 1)] }

    private func runsFor(_ d: HistDay) -> [HistRun] {
        let ql = q.trimmingCharacters(in: .whitespaces).lowercased()
        return d.runs.filter { r in
            let wOk = curWrapp == "all" || r.wrapp == curWrapp
            let hay = (r.prompt + " " + r.wrapp + " " + r.result + " " + r.out + " " + r.params.joined(separator: " ")).lowercased()
            let sOk = ql.isEmpty || hay.contains(ql)
            return wOk && sOk
        }
    }
    private var visibleDays: [HistDay] {
        days.filter { d in
            (curDate == "14d" || curDate == d.day) && !runsFor(d).isEmpty
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if days.isEmpty {
                    // first-run: nothing in the trail yet — a verb, not a dead pane
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Your runs will show up here.").font(.brico(20, .bold)).foregroundColor(.ink)
                        Text("Every act through the broker — runs, dictations, saves, guided fills — lands in the audit trail as a receipt. Run an app to start.")
                            .font(.hanken(13)).foregroundColor(.inkSec)
                            .fixedSize(horizontal: false, vertical: true)
                        LimeButton(label: "Open your apps") { onNavigate(.apps) }
                    }
                    .padding(22)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
                    .padding(.top, 20)
                } else if visibleDays.isEmpty {
                    Text("No runs match these filters.")
                        .font(.hanken(12.5)).foregroundColor(.inkDim)
                        .frame(maxWidth: .infinity)
                        .padding(24)
                        .background(RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(Color.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
                        .padding(.top, 20)
                } else {
                    ForEach(visibleDays) { d in daySection(d) }
                    Text("last 14 days of the audit trail · older receipts stay in ~/.relay/audit.log — nothing is deleted")
                        .font(.splMono(10.5)).foregroundColor(.inkFaint)
                        .padding(.top, 28)
                }
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { days = histReceipts() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("HISTORY").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                    Text("Everything you've run").font(.hanken(24, .semibold)).foregroundColor(.ink)
                }
                Spacer(minLength: 0)
            }
            // filters (acts carry no project tag in the log — no fake project scope, just real filters)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                KChip(text: "wrapp \(curWrapp) ▾") { wrappIx = (wrappIx + 1) % wrappOpts.count }
                KChip(text: "date \(curDate) ▾") { dateIx = (dateIx + 1) % dateOpts.count }
                KChip(text: "⌕", active: searchOn) {
                    searchOn.toggle(); if !searchOn { q = "" }
                }
            }
            if searchOn {
                TextField("search runs…", text: $q)
                    .textFieldStyle(.plain)
                    .font(.splMono(12)).foregroundColor(.ink)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color(red: 0.06, green: 0.07, blue: 0.09)))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                    .frame(maxWidth: 260, alignment: .leading)
            }
        }
    }

    private func daySection(_ d: HistDay) -> some View {
        let collapsed = collapsedDays.contains(d.day)
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                if collapsed { collapsedDays.remove(d.day) } else { collapsedDays.insert(d.day) }
            } label: {
                HStack(spacing: 12) {
                    Text("▾").font(.splMono(9)).foregroundColor(.inkFaint)
                        .rotationEffect(.degrees(collapsed ? -90 : 0))
                    Text(d.day.uppercased()).font(.splMono(10)).tracking(1.6).foregroundColor(.inkFaint)
                    Rectangle().fill(Color.edgeSoft).frame(height: 1)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 24).padding(.bottom, 2)

            if !collapsed {
                ForEach(runsFor(d)) { run in
                    HistoryRunRow(run: run,
                                  open: openRuns.contains(run.id),
                                  onToggle: {
                                      if openRuns.contains(run.id) { openRuns.remove(run.id) }
                                      else { openRuns.insert(run.id) }
                                  },
                                  onReopen: {
                                      OSLaunch.launchOr(run.wrapp, .init(artifact: run.prompt, kind: run.kind)) { onNavigate(.apps) }
                                  })
                }
            }
        }
    }
}

private struct HistoryRunRow: View {
    let run: HistRun
    let open: Bool
    let onToggle: () -> Void
    let onReopen: () -> Void
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                Text(run.tm).font(.splMono(11)).foregroundColor(.inkFaint).frame(width: 42, alignment: .leading)
                HStack(spacing: 7) {
                    RoundedRectangle(cornerRadius: 3).fill(colorForId(run.wrapp)).frame(width: 9, height: 9)
                    Text(run.wrapp).font(.hanken(12.5, .medium)).foregroundColor(.inkSec)
                }
                .frame(width: 118, alignment: .leading)
                Text(run.prompt).font(.hanken(13)).foregroundColor(.ink).lineLimit(1)
                Spacer(minLength: 8)
                Text("→").font(.splMono(12)).foregroundColor(.inkFaint)
                HStack(spacing: 7) {
                    Text(histGlyph(run.kind)).font(.splMono(11))
                        .foregroundColor(Color(red: 0.05, green: 0.05, blue: 0.06))
                        .frame(width: 22, height: 22)
                        .background(RoundedRectangle(cornerRadius: 6).fill(colorForId(run.wrapp)))
                    Text(run.result).font(.hanken(12)).foregroundColor(.inkDim)
                }
                .frame(width: 120, alignment: .leading)
                ReopenButton(wrapp: run.wrapp, action: onReopen)
            }
            if open {
                receipt
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 12)
            .stroke((hover || open) ? Color(red: 0.20, green: 0.22, blue: 0.29) : Color.edge, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { onToggle() }
        .onHover { hover = $0 }
    }

    private var receipt: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 24) {
                ReceiptCell(label: "Act", value: run.prompt)
                ReceiptCell(label: "Method", value: run.params.joined(separator: "   "), mono: true)
            }
            HStack(alignment: .top, spacing: 24) {
                ReceiptCell(label: "Result", value: "\(run.result) → \(run.out)")
                ReceiptCell(label: "Provenance", value: run.prov)
            }
        }
        .padding(.top, 14).padding(.leading, 56)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .top)
    }
}

private struct ReopenButton: View {
    let wrapp: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text("Reopen ▸").font(.hanken(12)).foregroundColor(.indigo)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.indigo.opacity(hover ? 0.20 : 0.14)))
                .overlay(RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.indigo.opacity(hover ? 0.6 : 0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct ReceiptCell: View {
    let label: String; let value: String; var mono: Bool = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.splMono(9.5)).tracking(1.3).foregroundColor(.inkFaint)
            Text(value)
                .font(mono ? .splMono(11.5) : .hanken(12.5))
                .foregroundColor(mono ? .ink : .inkSec)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// =====================================================================================================
// MARK: - GraphSurface
// =====================================================================================================

private struct GNeighbor: Identifiable { let id = UUID(); let label: String; let rel: String }

private struct GNode: Identifiable {
    let id: String
    let x: CGFloat; let y: CGFloat; let r: CGFloat
    let label: String; let kind: String
    var hub: Bool = false
    var dim: Bool = false
    var cluster: Bool = false
    var links: Int = 0; var artifacts: Int = 0; var notes: Int = 0
    var neighbors: [GNeighbor] = []
}

// ═══ LIVE graph — how the vault actually connects. The active project (else the most recent) is the
// hub; its REAL artifacts (from ~/.relay/storage/<origin>) orbit it; the other real projects ring the
// outside as sibling hubs. Deterministic radial layout in the canvas' ~600×480 space. No invented
// nodes — a project with no artifacts is just a bare hub.
private struct GraphModel {
    let nodes: [GNode]
    let edges: [(String, String)]
    var byId: [String: GNode] { Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
    var byLabel: [String: GNode] { Dictionary(nodes.map { ($0.label, $0) }, uniquingKeysWith: { a, _ in a }) }
}

private func graphLive() -> GraphModel {
    let ctxs = bankContexts()
    guard !ctxs.isEmpty else { return GraphModel(nodes: [], edges: []) }
    let hubCtx = ctxs.first { $0.id == readDefaultId() } ?? ctxs[0]
    let cx: CGFloat = 300, cy: CGFloat = 250
    var nodes: [GNode] = []
    var edges: [(String, String)] = []

    // artifacts of the hub project — the real orbit
    let arts = bankArtifactsFor(hubCtx)
    let hub = GNode(id: "hub", x: cx, y: cy, r: 24, label: hubCtx.name, kind: "project",
                    hub: true, links: arts.count, artifacts: arts.count, notes: 0,
                    neighbors: arts.prefix(6).map { GNeighbor(label: $0.t, rel: "produced-by") }
                        + [GNeighbor(label: "\(max(ctxs.count - 1, 0)) other projects", rel: "sibling")])
    nodes.append(hub)

    let shown = Array(arts.prefix(9))
    for (i, a) in shown.enumerated() {
        let ang = CGFloat(i) / CGFloat(max(shown.count, 1)) * .pi * 2
        let rad: CGFloat = 150
        let id = "art\(i)"
        nodes.append(GNode(id: id, x: cx + cos(ang) * rad, y: cy + sin(ang) * rad,
                           r: 13, label: a.t, kind: "artifact · \(a.kind)",
                           neighbors: [GNeighbor(label: hubCtx.name, rel: "produced-for")]))
        edges.append(("hub", id))
    }

    // sibling projects — a faint outer ring, each a real hub you can jump to
    let others = ctxs.filter { $0.id != hubCtx.id }.prefix(6)
    for (i, c) in others.enumerated() {
        let ang = CGFloat(i) / CGFloat(max(others.count, 1)) * .pi * 2 + 0.4
        let id = "proj\(i)"
        nodes.append(GNode(id: id, x: cx + cos(ang) * 250, y: cy + sin(ang) * 210,
                           r: 15, label: c.name, kind: "project", dim: true,
                           neighbors: [GNeighbor(label: hubCtx.name, rel: "sibling")]))
        edges.append(("hub", id))
    }
    return GraphModel(nodes: nodes, edges: edges)
}

// artifacts for a context, reusing the same real sources Bank's Artifacts facet reads (storage + vault)
private func bankArtifactsFor(_ c: BankCtx) -> [(t: String, kind: String)] {
    let fm = FileManager.default
    let now = Date().timeIntervalSince1970 * 1000
    var out: [((t: String, kind: String), Double)] = []
    func scan(_ dir: String) {
        guard let files = try? fm.contentsOfDirectory(atPath: dir) else { return }
        for f in files where f.hasSuffix(".json") && !f.contains(".bak") && !f.hasPrefix(".") {
            let path = dir + "/" + f
            let m = (((try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000
            let (title, _, kind) = classifyArtifact(path, key: f)
            out.append(((title, kind), m))
        }
    }
    if let o = c.origin {
        let dirName = o.replacingOccurrences(of: "://", with: "_").replacingOccurrences(of: ":", with: "_").replacingOccurrences(of: "/", with: "_")
        scan((NSHomeDirectory() as NSString).appendingPathComponent(".relay/storage/" + dirName))
    }
    if let folder = bankVaultFolder(c) { scan(folder) }
    return out.sorted { $0.1 > $1.1 }.map { $0.0 }
}

/// The toggle-category a node belongs to (nil = always shown, e.g. runs / docs / clusters).
private func graphCatOf(_ n: GNode) -> String? {
    let k = n.kind
    if k.hasPrefix("project") { return "projects" }
    if k.hasPrefix("note") { return "notes" }
    if k.hasPrefix("term") { return "terms" }
    if k.hasPrefix("cluster") { return nil }
    if k.hasPrefix("artifact") { return "artifacts" }
    return nil
}
private func graphIsOff(_ n: GNode, _ enabled: Set<String>) -> Bool {
    if let cat = graphCatOf(n) { return !enabled.contains(cat) }
    return false
}
private func graphColor(_ n: GNode) -> Color {
    let k = n.kind
    if k.hasPrefix("project") || k.hasPrefix("term") { return .indigo }
    if k.hasPrefix("note") { return .lime }
    if k.hasPrefix("cluster") { return .raised }
    if k.hasPrefix("run") { return amber }
    return colorForId(n.id)                  // artifacts / docs get a deterministic hue
}
private func graphDest(_ n: GNode) -> (Surface, String) {
    let k = n.kind
    if k.hasPrefix("term") { return (.dictionary, "Open in Dictionary ▸") }
    if k.hasPrefix("project") || k.hasPrefix("note") || k.hasPrefix("cluster") {
        return (.bank, "Open in Bank ▸")
    }
    return (.apps, "Open in Apps ▸")         // artifact / run / doc
}

struct GraphSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var enabled: Set<String> = ["projects", "notes", "artifacts"]
    @State private var selectedId: String = "hub"
    @State private var asList = false
    @State private var model = GraphModel(nodes: [], edges: [])

    private var selectedNode: GNode { model.byId[selectedId] ?? model.nodes.first ?? GNode(id: "none", x: 0, y: 0, r: 0, label: "—", kind: "project") }

    private func focus(label: String) {
        if let n = model.byLabel[label], !n.cluster, !graphIsOff(n, enabled) {
            selectedId = n.id
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if model.nodes.isEmpty {
                    Text("Nothing to graph yet — establish a project and run an app, and the connections between projects, artifacts, and notes draw themselves here.")
                        .font(.hanken(13)).foregroundColor(.inkSec)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(22).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
                        .padding(.top, 12)
                } else {
                HStack(alignment: .top, spacing: 0) {
                    Group {
                        if asList {
                            GraphList(model: model, enabled: enabled, selectedId: selectedId,
                                      onSelect: { selectedId = $0.id })
                        } else {
                            GraphCanvas(model: model, enabled: enabled, selectedId: selectedId,
                                        onSelect: { selectedId = $0.id },
                                        onNavigate: onNavigate)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 480, alignment: .topLeading)
                    .overlay(Rectangle().fill(Color.edgeSoft).frame(width: 1), alignment: .trailing)

                    GraphInspector(node: selectedNode, onNavigate: onNavigate, onFocus: { focus(label: $0) })
                        .frame(width: 236, alignment: .topLeading)
                }
                .padding(.top, 16)
                .background(RoundedRectangle(cornerRadius: 16)
                    .fill(Color(red: 0.04, green: 0.05, blue: 0.06)))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                legend
                }
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model = graphLive(); if model.byId[selectedId] == nil { selectedId = model.nodes.first?.id ?? "hub" } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("GRAPH").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                Text("How it connects").font(.hanken(24, .semibold)).foregroundColor(.ink)
            }
            HStack(spacing: 7) {
                KChip(text: "◐ \(model.nodes.first(where: { $0.hub })?.label ?? "your vault")", accent: .indigo) { onNavigate(.bank) }
                Spacer(minLength: 0)
                GraphToggle(label: "projects", tint: .indigo, on: enabled.contains("projects")) { toggle("projects") }
                GraphToggle(label: "notes", tint: .lime, on: enabled.contains("notes")) { toggle("notes") }
                GraphToggle(label: "artifacts", tint: amber, on: enabled.contains("artifacts")) { toggle("artifacts") }
                GraphToggle(label: "terms", tint: .indigo, on: enabled.contains("terms")) { toggle("terms") }
                KChip(text: asList ? "◈ Graph view" : "☰ List view") { asList.toggle() }
            }
        }
    }

    private func toggle(_ cat: String) {
        if enabled.contains(cat) { enabled.remove(cat) } else { enabled.insert(cat) }
        if graphIsOff(selectedNode, enabled) { selectedId = "hub" }
    }

    private var legend: some View {
        HStack(spacing: 16) {
            legendItem(.indigo, "project")
            legendItem(.lime, "note")
            legendItem(colorForId("mark"), "artifact")
            legendItem(amber, "run")
            legendItem(Color.indigo.opacity(0.6), "term (off)")
        }
        .padding(.top, 14)
    }
    private func legendItem(_ c: Color, _ t: String) -> some View {
        HStack(spacing: 7) {
            RoundedRectangle(cornerRadius: 3).fill(c).frame(width: 10, height: 10)
            Text(t).font(.hanken(11.5)).foregroundColor(.inkDim)
        }
    }
}

private struct GraphToggle: View {
    let label: String; let tint: Color; let on: Bool; let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(on ? tint : .clear)
                    .frame(width: 12, height: 12)
                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(on ? tint : Color.edgeSoft, lineWidth: 1))
                Text(label).font(.hanken(12)).foregroundColor(on ? tint : .inkFaint)
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 8)
                .stroke(hover ? Color(red: 0.20, green: 0.22, blue: 0.29) : Color.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// Fixed-layout node canvas: edges drawn in a Canvas, nodes as positioned circle Buttons.
private struct GraphCanvas: View {
    let model: GraphModel
    let enabled: Set<String>
    let selectedId: String
    let onSelect: (GNode) -> Void
    let onNavigate: (Surface) -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Canvas { ctx, _ in
                let byId = model.byId
                for e in model.edges {
                    guard let a = byId[e.0], let b = byId[e.1] else { continue }
                    let faded = graphIsOff(a, enabled) || graphIsOff(b, enabled)
                    let hot = !faded && (e.0 == selectedId || e.1 == selectedId)
                    var p = Path()
                    p.move(to: CGPoint(x: a.x, y: a.y))
                    p.addLine(to: CGPoint(x: b.x, y: b.y))
                    ctx.stroke(p,
                               with: .color(hot ? Color.indigo
                                            : Color.edge.opacity(faded ? 0.3 : 1)),
                               lineWidth: hot ? 1.8 : 1.3)
                }
            }
            ForEach(model.nodes) { n in
                let off = graphIsOff(n, enabled)
                Button {
                    if n.cluster { onNavigate(.bank) } else if !off { onSelect(n) }
                } label: {
                    GraphNodeMark(node: n, off: off, selected: n.id == selectedId)
                }
                .buttonStyle(.plain)
                .disabled(off && !n.cluster)
                .position(x: n.x, y: n.y)

                Text(n.label)
                    .font(n.cluster ? .splMono(10) : .hanken(11))
                    .foregroundColor(n.hub || n.id == selectedId ? .ink : (n.cluster ? .inkFaint : .inkSec))
                    .opacity(off ? 0.22 : (n.dim ? 0.5 : 1))
                    .position(x: n.x, y: n.y + n.r + 13)
            }
        }
        .frame(width: 620, height: 480)
        .frame(maxWidth: .infinity, alignment: .center)
    }
}

private struct GraphNodeMark: View {
    let node: GNode; let off: Bool; let selected: Bool
    private var op: Double { off ? 0.22 : (node.dim ? 0.5 : 1) }
    var body: some View {
        ZStack {
            if node.hub {
                Circle().stroke(Color.indigo.opacity(off ? 0.15 : 0.35), lineWidth: 1)
                    .frame(width: (node.r + 7) * 2, height: (node.r + 7) * 2)
            }
            if node.cluster {
                Circle().fill(Color(red: 0.08, green: 0.09, blue: 0.11))
                    .frame(width: node.r * 2, height: node.r * 2)
                Circle().stroke(Color(red: 0.20, green: 0.22, blue: 0.29),
                                style: StrokeStyle(lineWidth: 1.3, dash: [3, 3]))
                    .frame(width: node.r * 2, height: node.r * 2)
                Text(node.label).font(.splMono(9)).foregroundColor(.inkFaint)
            } else {
                Circle().fill(graphColor(node)).opacity(op)
                    .frame(width: node.r * 2, height: node.r * 2)
                    .overlay(Circle().stroke(Color(red: 0.03, green: 0.03, blue: 0.05), lineWidth: 2))
                if !off && (node.hub || selected) {
                    Circle().stroke(Color.lime, lineWidth: 1.5)
                        .frame(width: node.r * 2, height: node.r * 2)
                }
            }
        }
        .frame(width: (node.r + 8) * 2, height: (node.r + 8) * 2)
        .contentShape(Circle())
    }
}

private struct GraphList: View {
    let model: GraphModel
    let enabled: Set<String>
    let selectedId: String
    let onSelect: (GNode) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(model.nodes) { n in
                GraphListRow(node: n, off: graphIsOff(n, enabled),
                             selected: n.id == selectedId, onSelect: onSelect)
            }
        }
        .padding(12)
    }
}

private struct GraphListRow: View {
    let node: GNode; let off: Bool; let selected: Bool; let onSelect: (GNode) -> Void
    @State private var hover = false
    var body: some View {
        Button { if !off { onSelect(node) } } label: {
            HStack(spacing: 9) {
                RoundedRectangle(cornerRadius: 3).fill(graphColor(node)).frame(width: 9, height: 9)
                Text(node.label).font(.hanken(12.5)).foregroundColor(.ink)
                Spacer(minLength: 8)
                Text(node.kind).font(.splMono(9.5)).foregroundColor(.inkFaint)
            }
            .padding(.horizontal, 11).padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 9)
                .fill(selected ? Color.indigo.opacity(0.12) : (hover ? Color.raised : .clear)))
            .contentShape(Rectangle())
            .opacity(off ? 0.35 : 1)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct GraphInspector: View {
    let node: GNode
    let onNavigate: (Surface) -> Void
    let onFocus: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("INSPECTOR").font(.splMono(9.5)).tracking(1.6).foregroundColor(.inkFaint)
            HStack(spacing: 11) {
                Text("◈").font(.system(size: 14)).foregroundColor(graphColor(node))
                    .frame(width: 30, height: 30)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color(red: 0.11, green: 0.10, blue: 0.18)))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.indigo.opacity(0.4), lineWidth: 1))
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.label).font(.hanken(15, .semibold)).foregroundColor(.ink).lineLimit(1)
                    Text(node.kind).font(.hanken(12)).foregroundColor(.inkDim)
                }
            }
            .padding(.top, 14)

            if node.hub {
                statRow("Links", node.links)
                statRow("Artifacts", node.artifacts)
                statRow("Notes", node.notes)
            } else {
                statRow("Neighbors", node.neighbors.count)
            }

            Text("NEIGHBORS").font(.splMono(9.5)).tracking(1.6).foregroundColor(.inkFaint)
                .padding(.top, 16).padding(.bottom, 4)
            if node.neighbors.isEmpty {
                Text("no neighbors yet").font(.hanken(12)).foregroundColor(.inkFaint)
            } else {
                ForEach(node.neighbors) { nb in
                    NeighborRow(nb: nb, onTap: { onFocus(nb.label) })
                }
            }

            OpenButton(dest: graphDest(node), onNavigate: onNavigate).padding(.top, 18)
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func statRow(_ label: String, _ value: Int) -> some View {
        HStack {
            Text(label).font(.hanken(12.5)).foregroundColor(.inkSec)
            Spacer()
            Text("\(value)").font(.hanken(12.5, .medium)).foregroundColor(.ink)
        }
        .padding(.vertical, 6)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
        .padding(.top, 4)
    }
}

private struct NeighborRow: View {
    let nb: GNeighbor; let onTap: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 3).fill(colorForId(nb.label)).frame(width: 8, height: 8)
                Text(nb.label).font(.hanken(12)).foregroundColor(.inkSec).lineLimit(1)
                Spacer(minLength: 6)
                Text(nb.rel).font(.splMono(9.5)).foregroundColor(.inkFaint)
            }
            .padding(.horizontal, 5).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 7).fill(hover ? Color.indigo.opacity(0.1) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct OpenButton: View {
    let dest: (Surface, String)
    let onNavigate: (Surface) -> Void
    @State private var hover = false
    var body: some View {
        Button { onNavigate(dest.0) } label: {
            Text(dest.1).font(.hanken(12.5, .semibold))
                .foregroundColor(Color(red: 0.05, green: 0.05, blue: 0.06))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.lime.opacity(hover ? 0.9 : 1)))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// =====================================================================================================
// MARK: - DictionarySurface
// =====================================================================================================

private struct DTerm: Identifiable {
    let id: Int; let t: String; let d: String
    let scope: String; let src: String
    var usages: [String] = []
    var isProject: Bool { scope == "project" }
    var letter: String { String(t.prefix(1)).uppercased() }
}

// ═══ LIVE dictionary — the project vocabulary as REAL dictionary-*.md files across the vault folders
// (the Bank dialect: front-matter term/definition/scope/source + body). Nothing invented: when the
// vault holds no terms yet the surface is an honest teach-state, never sample words.
private func dictTerms() -> [DTerm] {
    let fm = FileManager.default
    var out: [DTerm] = []
    var i = 0
    for folder in osVaultFolders() {
        guard let files = try? fm.contentsOfDirectory(atPath: folder) else { continue }
        for f in files where f.hasPrefix("dictionary-") && f.hasSuffix(".md") {
            let text = (try? String(contentsOfFile: folder + "/" + f, encoding: .utf8)) ?? ""
            var term = "", def = "", scope = "global", src = "manual"
            var inFM = false, body = ""
            for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
                let l = raw.trimmingCharacters(in: .whitespaces)
                if l == "---" { inFM.toggle(); continue }
                if inFM {
                    if let r = l.range(of: ":") {
                        let k = String(l[..<r.lowerBound]).trimmingCharacters(in: .whitespaces).lowercased()
                        let v = String(l[r.upperBound...]).trimmingCharacters(in: .whitespaces)
                        switch k { case "term", "name": term = v; case "definition", "def": def = v
                                   case "scope": scope = v; case "source", "src": src = v; default: break }
                    }
                } else if !l.isEmpty && !l.hasPrefix("#") && body.isEmpty { body = l }
            }
            if term.isEmpty { term = f.replacingOccurrences(of: "dictionary-", with: "").replacingOccurrences(of: ".md", with: "").replacingOccurrences(of: "-", with: " ") }
            if def.isEmpty { def = body }
            guard !term.isEmpty else { continue }
            out.append(DTerm(id: i, t: term, d: def, scope: scope, src: src)); i += 1
        }
    }
    return out.sorted { $0.t.localizedCaseInsensitiveCompare($1.t) == .orderedAscending }
}

private struct DictSection: Identifiable {
    let id: String; let terms: [DTerm]
    var letter: String { id }
}

private func dictBucketId(_ letter: String) -> String {
    let L = letter.uppercased()
    if L <= "F" { return "af" }
    if L <= "M" { return "gm" }
    return "nz"
}

struct DictionarySurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var q = ""
    @State private var bucket = "all"
    @State private var openTerms: Set<Int> = []
    @State private var terms: [DTerm] = []

    private var filtered: [DTerm] {
        let ql = q.trimmingCharacters(in: .whitespaces).lowercased()
        return terms.filter { term in
            let inBk = bucket == "all" || dictBucketId(term.letter) == bucket
            let hay = (term.t + " " + term.d).lowercased()
            let inQ = ql.isEmpty || hay.contains(ql)
            return inBk && inQ
        }
    }
    private var sections: [DictSection] {
        var byLetter: [String: [DTerm]] = [:]
        for t in filtered { byLetter[t.letter, default: []].append(t) }
        return byLetter.keys.sorted().map { DictSection(id: $0, terms: byLetter[$0] ?? []) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                bucketTabs
                newRow
                if terms.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Teach Switchboard your words.").font(.brico(18, .bold)).foregroundColor(.ink)
                        Text("No terms in your vault yet. Say \"remember that X means…\" to God, or add one above — each becomes a dictionary-*.md you own, and its gloss shows up as a tooltip everywhere in the OS.")
                            .font(.hanken(13)).foregroundColor(.inkSec)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(22).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
                    .padding(.top, 8)
                } else if sections.isEmpty {
                    Text("No term matches — try another spelling, or teach it above.")
                        .font(.hanken(12.5)).foregroundColor(.inkDim)
                        .frame(maxWidth: .infinity)
                        .padding(24)
                        .background(RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(Color.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
                        .padding(.top, 4)
                } else {
                    ForEach(sections) { section in
                        Text(section.letter).font(.splMono(13))
                            .foregroundColor(.lime)
                            .padding(.top, 20).padding(.bottom, 8)
                        ForEach(section.terms) { term in
                            DictTermRow(term: term,
                                        open: openTerms.contains(term.id),
                                        onToggle: {
                                            if term.usages.isEmpty { onNavigate(.graph); return }
                                            if openTerms.contains(term.id) { openTerms.remove(term.id) }
                                            else { openTerms.insert(term.id) }
                                        },
                                        onNavigate: onNavigate)
                        }
                    }
                }
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { terms = dictTerms() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("DICTIONARY").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                Text("What your words mean").font(.hanken(24, .semibold)).foregroundColor(.ink)
            }
            HStack(spacing: 8) {
                Text("\(terms.count) term\(terms.count == 1 ? "" : "s") in your vault").font(.splMono(11)).foregroundColor(.inkDim)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
                Spacer(minLength: 0)
                TextField("⌕ find a term", text: $q)
                    .textFieldStyle(.plain)
                    .font(.hanken(12.5)).foregroundColor(.ink)
                    .padding(.horizontal, 13).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1))
                    .frame(width: 190)
                KChip(text: "+ Add term", solid: true) { onNavigate(.bank) }
            }
        }
    }

    private var bucketTabs: some View {
        HStack(spacing: 6) {
            bucketTab("all", "All")
            bucketTab("af", "A–F")
            bucketTab("gm", "G–M")
            bucketTab("nz", "N–Z")
            Spacer(minLength: 0)
        }
        .padding(.top, 16)
    }
    private func bucketTab(_ id: String, _ label: String) -> some View {
        KChip(text: label, active: bucket == id,
              accent: bucket == id ? .lime : .inkFaint) { bucket = id }
    }

    private var newRow: some View {
        Button { onNavigate(.bank) } label: {
            HStack(spacing: 12) {
                Text("＋").font(.system(size: 15)).foregroundColor(.lime)
                (Text("term").font(.splMono(12)).foregroundColor(.inkDim)
                    + Text(" : definition — teach Switchboard in Bank").font(.splMono(12)).foregroundColor(.inkFaint))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 11)
                .fill(Color(red: 0.055, green: 0.06, blue: 0.08)))
            .overlay(RoundedRectangle(cornerRadius: 11)
                .strokeBorder(Color.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
        }
        .buttonStyle(.plain)
        .padding(.top, 16).padding(.bottom, 4)
    }
}

private struct DictTermRow: View {
    let term: DTerm
    let open: Bool
    let onToggle: () -> Void
    let onNavigate: (Surface) -> Void
    @State private var hover = false

    private var hasExp: Bool { !term.usages.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                Text(term.t).font(.hanken(14, .semibold)).foregroundColor(.ink)
                    .frame(width: 118, alignment: .leading)
                Text("\"\(term.d)\"").font(.hanken(13)).foregroundColor(.inkSec)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 5) {
                    Text(term.scope).font(.splMono(10))
                        .foregroundColor(term.isProject ? .indigo : .inkFaint)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 6)
                            .fill(term.isProject ? Color.indigo.opacity(0.14) : .clear))
                        .overlay(RoundedRectangle(cornerRadius: 6)
                            .stroke(term.isProject ? Color.indigo.opacity(0.35) : Color.edge, lineWidth: 1))
                    Text("↻ \(term.src)").font(.splMono(10)).foregroundColor(.inkFaint)
                }
                Text(hasExp ? "▾" : "↗").font(.splMono(11))
                    .foregroundColor(hasExp ? .inkFaint : .indigo)
                    .rotationEffect(.degrees(hasExp && open ? 180 : 0))
                    .frame(width: 14)
            }
            if open && hasExp {
                VStack(alignment: .leading, spacing: 8) {
                    (Text("Learned from ").font(.hanken(12.5)).foregroundColor(.inkDim)
                        + Text(term.src).font(.hanken(12.5, .medium)).foregroundColor(.inkSec)
                        + Text(" · used in the vault:").font(.hanken(12.5)).foregroundColor(.inkDim))
                    HStack(spacing: 8) {
                        ForEach(term.usages, id: \.self) { u in
                            UsageChip(text: u) { onNavigate(.graph) }
                        }
                    }
                }
                .padding(.top, 12).padding(.leading, 132)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .top)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 11).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 11)
            .stroke((hover || open) ? Color(red: 0.20, green: 0.22, blue: 0.29) : Color.edge, lineWidth: 1))
        .padding(.bottom, 8)
        .contentShape(Rectangle())
        .onTapGesture { onToggle() }
        .onHover { hover = $0 }
    }
}

private struct UsageChip: View {
    let text: String; let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(text).font(.hanken(11)).foregroundColor(hover ? .ink : .inkSec)
                .padding(.horizontal, 9).padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(red: 0.06, green: 0.07, blue: 0.09)))
                .overlay(RoundedRectangle(cornerRadius: 6)
                    .stroke(hover ? Color.indigo.opacity(0.6) : Color.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
