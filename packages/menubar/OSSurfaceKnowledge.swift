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

private struct HistRun: Identifiable {
    let id = UUID()
    let tm: String; let wrapp: String; let prompt: String
    let kind: String; let result: String
    let params: [String]; let out: String; let prov: String
}
private struct HistDay: Identifiable {
    let id = UUID(); let day: String; let runs: [HistRun]
}

private enum HistorySample {
    static let days: [HistDay] = [
        HistDay(day: "Today", runs: [
            HistRun(tm: "14:22", wrapp: "Prism", prompt: "make a launch hero — terracotta beam",
                    kind: "image", result: "image",
                    params: ["ref: brand-set", "ar 3:2", "model: nano_banana"],
                    out: "artifact-0447.png · 1536×1024",
                    prov: "IndEur Club · lent: brand-set, palette · 8.4k tokens"),
            HistRun(tm: "13:58", wrapp: "Crest", prompt: "tighten the switch-ligature monogram",
                    kind: "mark", result: "mark",
                    params: ["ref: mark-v3", "vector", "model: nano_banana"],
                    out: "monogram-v4.svg · 512×512",
                    prov: "IndEur Club · lent: brand-set · 3.1k tokens"),
            HistRun(tm: "11:05", wrapp: "Redline", prompt: "audit the founding-members deck",
                    kind: "notes", result: "notes",
                    params: ["scope: deck", "12 slides"],
                    out: "9 notes · 2 blockers",
                    prov: "IndEur Club · lent: pricing-thesis · 6.0k tokens"),
            HistRun(tm: "09:40", wrapp: "God", prompt: "what did we decide about the Q4 event cities?",
                    kind: "text", result: "text",
                    params: ["recall", "scope: project"],
                    out: "3 cities: Berlin, Amsterdam, Lisbon",
                    prov: "IndEur Club · lent: meetup-notes · 2.2k tokens"),
        ]),
        HistDay(day: "Yesterday", runs: [
            HistRun(tm: "18:40", wrapp: "God", prompt: "summarize the week for IndEur",
                    kind: "text", result: "text",
                    params: ["recall", "range: 7d"],
                    out: "weekly-digest.md",
                    prov: "IndEur Club · lent: brain × 14 · 5.8k tokens"),
            HistRun(tm: "16:12", wrapp: "AdForge", prompt: "\"Find your people\" — 3 ad variants",
                    kind: "doc", result: "ad set",
                    params: ["variants: 3", "tone: warm"],
                    out: "ad-set-0331 · 3 variants",
                    prov: "IndEur Club · lent: voice-scratch · 4.4k tokens"),
            HistRun(tm: "10:03", wrapp: "ideabrain", prompt: "validate the membership pricing thesis",
                    kind: "doc", result: "doc",
                    params: ["research", "cohort: EU"],
                    out: "pricing-thesis.md",
                    prov: "IndEur Club · lent: audience · 9.1k tokens"),
        ]),
        HistDay(day: "Mon · Aug 1", runs: [
            HistRun(tm: "21:15", wrapp: "brandbrain", prompt: "draft the launch announcement post",
                    kind: "text", result: "text",
                    params: ["channel: IG", "tone: warm"],
                    out: "launch-post.md",
                    prov: "IndEur Club · lent: voice-scratch · 3.3k tokens"),
            HistRun(tm: "15:47", wrapp: "Crest", prompt: "generate 4 logo directions",
                    kind: "gallery", result: "4 marks",
                    params: ["variants: 4", "vector"],
                    out: "marks-0208 · 4 marks",
                    prov: "IndEur Club · lent: brand-set · 5.0k tokens"),
            HistRun(tm: "12:30", wrapp: "Flow", prompt: "transcribe the community meetup notes",
                    kind: "notes", result: "notes",
                    params: ["source: audio", "18m"],
                    out: "meetup-notes.md",
                    prov: "IndEur Club · lent: — · 1.7k tokens"),
        ]),
    ]

    static var wrapps: [String] {
        var seen: [String] = []
        for d in days { for r in d.runs where !seen.contains(r.wrapp) { seen.append(r.wrapp) } }
        return seen
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

    @State private var collapsedDays: Set<String> = []
    @State private var openRuns: Set<UUID> = []
    @State private var searchOn = false
    @State private var q = ""
    @State private var wrappIx = 0
    @State private var dateIx = 0

    private var wrappOpts: [String] { ["all"] + HistorySample.wrapps }
    private var dateOpts: [String] { ["7d"] + HistorySample.days.map { $0.day } }
    private var curWrapp: String { wrappOpts[min(wrappIx, wrappOpts.count - 1)] }
    private var curDate: String { dateOpts[min(dateIx, dateOpts.count - 1)] }

    private func runsFor(_ d: HistDay) -> [HistRun] {
        let ql = q.trimmingCharacters(in: .whitespaces).lowercased()
        return d.runs.filter { r in
            let wOk = curWrapp == "all" || r.wrapp == curWrapp
            let hay = (r.prompt + " " + r.wrapp + " " + r.result + " " + r.out).lowercased()
            let sOk = ql.isEmpty || hay.contains(ql)
            return wOk && sOk
        }
    }
    private var visibleDays: [HistDay] {
        HistorySample.days.filter { d in
            (curDate == "7d" || curDate == d.day) && !runsFor(d).isEmpty
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if visibleDays.isEmpty {
                    Text("No runs match these filters.")
                        .font(.hanken(12.5)).foregroundColor(.inkDim)
                        .frame(maxWidth: .infinity)
                        .padding(24)
                        .background(RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(Color.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
                        .padding(.top, 20)
                } else {
                    ForEach(visibleDays) { d in daySection(d) }
                }
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
            // scope + filters
            HStack(spacing: 8) {
                KChip(text: "◐ IndEur Club", accent: .indigo) { onNavigate(.bank) }
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
                                  onReopen: { onNavigate(.apps) })   // TODO real launch
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
                Text("\"\(run.prompt)\"").font(.hanken(13)).foregroundColor(.ink).lineLimit(1)
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
                ReceiptCell(label: "Input", value: "\"\(run.prompt)\"")
                ReceiptCell(label: "Params", value: run.params.joined(separator: "   "), mono: true)
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

private enum GraphSample {
    static let nodes: [GNode] = [
        GNode(id: "proj", x: 300, y: 255, r: 24, label: "IndEur Club", kind: "project",
              hub: true, links: 12, artifacts: 23, notes: 14,
              neighbors: [GNeighbor(label: "Switch mark", rel: "produced-by"),
                          GNeighbor(label: "Meetup notes", rel: "member"),
                          GNeighbor(label: "Terracotta beam", rel: "produced-by"),
                          GNeighbor(label: "\"diaspora\"", rel: "mentions")]),
        GNode(id: "mark", x: 150, y: 130, r: 15, label: "Switch mark", kind: "artifact · mark",
              neighbors: [GNeighbor(label: "IndEur Club", rel: "produced-for"),
                          GNeighbor(label: "4 marks", rel: "sibling")]),
        GNode(id: "gallery", x: 110, y: 250, r: 13, label: "4 marks", kind: "artifact · gallery",
              neighbors: [GNeighbor(label: "Switch mark", rel: "sibling"),
                          GNeighbor(label: "IndEur Club", rel: "produced-for")]),
        GNode(id: "beam", x: 170, y: 380, r: 14, label: "Terracotta beam", kind: "artifact · image",
              neighbors: [GNeighbor(label: "IndEur Club", rel: "produced-for")]),
        GNode(id: "note1", x: 330, y: 95, r: 12, label: "Meetup notes", kind: "note",
              neighbors: [GNeighbor(label: "IndEur Club", rel: "member"),
                          GNeighbor(label: "\"diaspora\"", rel: "defines")]),
        GNode(id: "note2", x: 470, y: 140, r: 11, label: "Pricing note", kind: "note",
              neighbors: [GNeighbor(label: "IndEur Club", rel: "member"),
                          GNeighbor(label: "8 more", rel: "cluster")]),
        GNode(id: "ad", x: 490, y: 270, r: 14, label: "Launch ad", kind: "run · AdForge",
              neighbors: [GNeighbor(label: "IndEur Club", rel: "produced-for")]),
        GNode(id: "thesis", x: 470, y: 400, r: 13, label: "Thesis", kind: "doc · ideabrain",
              neighbors: [GNeighbor(label: "IndEur Club", rel: "member")]),
        GNode(id: "term", x: 300, y: 430, r: 10, label: "\"diaspora\"", kind: "term", dim: true,
              neighbors: [GNeighbor(label: "IndEur Club", rel: "mentioned-in"),
                          GNeighbor(label: "Meetup notes", rel: "defined-in")]),
        GNode(id: "run", x: 250, y: 395, r: 9, label: "God run", kind: "run · God",
              neighbors: [GNeighbor(label: "IndEur Club", rel: "ran-on")]),
        GNode(id: "more", x: 560, y: 200, r: 16, label: "8 more", kind: "cluster", cluster: true),
    ]
    static let edges: [(String, String)] = [
        ("proj", "mark"), ("proj", "gallery"), ("proj", "beam"), ("proj", "note1"),
        ("proj", "note2"), ("proj", "ad"), ("proj", "thesis"), ("proj", "term"),
        ("proj", "run"), ("note2", "more"), ("ad", "more"), ("gallery", "mark"),
    ]
    static var byId: [String: GNode] {
        Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }
    static var byLabel: [String: GNode] {
        Dictionary(nodes.map { ($0.label, $0) }, uniquingKeysWith: { a, _ in a })
    }
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
    @State private var selectedId: String = "proj"
    @State private var asList = false

    private var selectedNode: GNode { GraphSample.byId[selectedId] ?? GraphSample.nodes[0] }

    private func focus(label: String) {
        if let n = GraphSample.byLabel[label], !n.cluster, !graphIsOff(n, enabled) {
            selectedId = n.id
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                HStack(alignment: .top, spacing: 0) {
                    Group {
                        if asList {
                            GraphList(enabled: enabled, selectedId: selectedId,
                                      onSelect: { selectedId = $0.id })
                        } else {
                            GraphCanvas(enabled: enabled, selectedId: selectedId,
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
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("GRAPH").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                Text("How it connects").font(.hanken(24, .semibold)).foregroundColor(.ink)
            }
            HStack(spacing: 7) {
                KChip(text: "◐ IndEur Club", accent: .indigo) { onNavigate(.bank) }
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
        if graphIsOff(selectedNode, enabled) { selectedId = "proj" }
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
    let enabled: Set<String>
    let selectedId: String
    let onSelect: (GNode) -> Void
    let onNavigate: (Surface) -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Canvas { ctx, _ in
                for e in GraphSample.edges {
                    guard let a = GraphSample.byId[e.0], let b = GraphSample.byId[e.1] else { continue }
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
            ForEach(GraphSample.nodes) { n in
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
    let enabled: Set<String>
    let selectedId: String
    let onSelect: (GNode) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(GraphSample.nodes) { n in
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

private enum DictSample {
    static let terms: [DTerm] = [
        DTerm(id: 0, t: "ARPU", d: "average revenue per user", scope: "global", src: "ideabrain run"),
        DTerm(id: 1, t: "Bank", d: "the .md vault the user owns — the substrate every lens reads",
              scope: "global", src: "manual"),
        DTerm(id: 2, t: "Diaspora",
              d: "in IndEur, specifically the first- & second-gen Indian community living in Europe — our whole audience",
              scope: "project", src: "God · meetup notes",
              usages: ["project-indeur.md", "Launch ad copy", "note: audience"]),
        DTerm(id: 3, t: "Facet", d: "one lens on a project's .md — Overview / Tasks / Brain / Artifacts",
              scope: "global", src: "manual"),
        DTerm(id: 4, t: "Founding member",
              d: "one of the first 500 who join before public launch — gets a lifetime badge & founder pricing",
              scope: "project", src: "pricing note",
              usages: ["pricing-thesis.md", "Launch ad copy"]),
        DTerm(id: 5, t: "Flagship event", d: "the monthly in-person meetup that anchors a city's chapter",
              scope: "project", src: "God run", usages: ["meetup-notes.md"]),
        DTerm(id: 6, t: "Terracotta", d: "the warm clay-orange primary in the IndEur palette (#E0764A)",
              scope: "project", src: "Crest run", usages: ["project-indeur.md", "brand-set"]),
        DTerm(id: 7, t: "Wrapp", d: "an app in Switchboard — prompts + skills + UI over Claude, no middleman",
              scope: "global", src: "manual"),
    ]
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

    private var filtered: [DTerm] {
        let ql = q.trimmingCharacters(in: .whitespaces).lowercased()
        return DictSample.terms.filter { term in
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
                if sections.isEmpty {
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
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("DICTIONARY").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                Text("What your words mean").font(.hanken(24, .semibold)).foregroundColor(.ink)
            }
            HStack(spacing: 8) {
                Text("◐ IndEur Club").font(.hanken(12)).foregroundColor(.indigo)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.indigo.opacity(0.14)))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.indigo.opacity(0.35), lineWidth: 1))
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
