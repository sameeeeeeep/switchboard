// OSSurfaceAutomate.swift — the AUTOMATE group of the Switchboard OS, in real SwiftUI.
//
// Four surfaces ported from the web shell (examples/apps/src/os/surfaces/*.js), each faithful to its
// module's markup + SAMPLE arrays: Dashboard (dashboard.js), Needs attention (attention.js),
// Routines (routines.js), Workflows (workflows.js).
//
// Design law (OS.md §3.1 — "discipline in the frame, colour in the icons"): the chrome is monochrome
// graphite; the only accents are lime (active / actionable) + indigo (local / project / pipeline). Amber
// stands in for failure-adjacent states. Every control is LIVE — no dead ends: stat tiles drill via
// onNavigate; needs items resolve inline or open the tool; routines flip state on Pause/Resume/Run;
// workflows run, expand, and route. Shared theme API (Color tokens, .hanken/.splMono fonts, IsoTile,
// SectionHead, ProgressBar, the Surface enum, Sample data) lives in OSShellView.swift — used, not redefined.

import Foundation
import SwiftUI

// ---- local, non-token constants (amber + a light indigo + the "on-lime" dark ink) ----
private let sbAmber      = Color(red: 0.96, green: 0.62, blue: 0.04)   // failure-adjacent (no amber token)
private let sbIndigoLite = Color(red: 0.74, green: 0.71, blue: 1.00)   // text on indigo fills (#bcb4ff)
private let sbInkOnLime  = Color(red: 0.043, green: 0.047, blue: 0.063) // #0b0c10 — dark text on a lime button

// =====================================================================================================
// MARK: - Shared little controls (reused across the AUTOMATE surfaces)
// =====================================================================================================

private enum SBBtnKind { case pri, warn, plain }

/// The standard row-action button (Run / Pause / Edit / Revoke …) — lime "pri", danger "warn", or outline.
private struct SBActButton: View {
    let label: String
    var kind: SBBtnKind = .plain
    var disabled: Bool = false
    var onTap: () -> Void
    @State private var hover = false

    private var fill: Color {
        switch kind {
        case .pri:   return Color.lime.opacity(0.12)
        case .warn:  return Color.danger.opacity(0.12)
        case .plain: return Color.raised
        }
    }
    private var stroke: Color {
        switch kind {
        case .pri:   return Color.lime.opacity(hover ? 0.6 : 0.4)
        case .warn:  return Color.danger.opacity(hover ? 0.6 : 0.4)
        case .plain: return hover ? Color.inkFaint : Color.edge
        }
    }
    private var fg: Color {
        switch kind {
        case .pri:   return .lime
        case .warn:  return .danger
        case .plain: return hover ? .ink : .inkSec
        }
    }

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(.hanken(12, kind == .plain ? .regular : .medium))
                .foregroundColor(fg)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 8).fill(fill))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(stroke, lineWidth: 1))
                .opacity(disabled ? 0.6 : (hover ? 0.92 : 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .onHover { hover = $0 }
    }
}

/// A per-surface segmented control (Today/7d/30d, filter tabs) — one live @State selection upstream.
private struct SBSegment: View {
    let items: [String]
    @Binding var selection: String
    var body: some View {
        HStack(spacing: 2) {
            ForEach(items, id: \.self) { it in
                SBSegItem(label: it, on: selection == it) { selection = it }
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1))
    }
}

private struct SBSegItem: View {
    let label: String
    let on: Bool
    var onTap: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(.hanken(12))
                .foregroundColor(on ? .ink : (hover ? .inkSec : .inkDim))
                .padding(.horizontal, 11).padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 7).fill(on ? Color.raised : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// The shared surface header: mono kicker + a bold clause + a trailing accessory.
private struct SurfaceHead<Trailing: View>: View {
    let kicker: String
    let strong: String
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            (Text(kicker).foregroundColor(.inkDim) + Text(strong).foregroundColor(.ink))
                .font(.splMono(11)).tracking(1.4)
            Spacer(minLength: 8)
            trailing
        }
        .padding(.bottom, 14)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
    }
}

private struct FootNote: View {
    let text: String
    var body: some View {
        Text(text).font(.splMono(10.5)).foregroundColor(.inkFaint)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 34)
    }
}

// =====================================================================================================
// MARK: - 1. DashboardSurface (dashboard.js — "the state of the machine, not your work")
// =====================================================================================================

private struct DashSpark { let bars: Bool; let data: [Double]; let color: Color }

private struct DashTile: Identifiable {
    let id = UUID()
    let kicker: String
    let big: String
    var suffix: String? = nil
    var sub: String? = nil
    var ok: (Int, Int)? = nil        // ✓/✗ split (Workflows tile)
    let drill: Surface
    let drillLabel: String
    var alert: Bool = false
    let spark: DashSpark
}

private struct DashLine: Identifiable {
    let id = UUID()
    let ic: String
    let icColor: Color
    let name: String
    var nameMuted: Bool = false
    var status: String? = nil
    var statusColor: Color = .inkDim
    var mark: String? = nil
    var markColor: Color = .lime
}

// ═══ LIVE dashboard — every tile/pane derives from the same real readers the other surfaces use:
// contexts.json (projects), routines.json+control (routines), the audit log (runs + activity),
// status.json (connector/backends health), osPending (needs). No usage/token tile — there is no
// truthful per-day usage receipt yet, and a fake meter is worse than none.

private struct DashLive {
    var tiles: [DashTile] = []
    var routines: [DashLine] = []
    var runs: [DashLine] = []
    var healthOK: [String] = []
    var healthAlerts: [String] = []
    var activity: [DashLine] = []
}

private func dashLive(rangeDays: Double) -> DashLive {
    var out = DashLive()
    let now = Date().timeIntervalSince1970 * 1000

    // projects tile — spark = contexts touched per day over the window (from updatedAt)
    let ctxs = bankContexts()
    var perDay = [Double](repeating: 0, count: max(Int(rangeDays), 1))
    for c in ctxs {
        let age = now - c.updatedMs
        let day = Int(age / 86_400_000)
        if day >= 0 && day < perDay.count { perDay[perDay.count - 1 - day] += 1 }
    }
    let brands = ctxs.filter { $0.kind == "brand" }.count
    let ideas = ctxs.filter { $0.kind == "idea" }.count
    out.tiles.append(DashTile(kicker: "Projects", big: "\(ctxs.count)",
                              sub: "\(brands) brands · \(ideas) ideas", drill: .bank, drillLabel: "Bank",
                              spark: DashSpark(bars: false, data: perDay, color: .inkDim)))

    // routines tile
    let r = routinesLive()
    let activeR = r.list.filter { regGroup($0.register) == "active" }.count
    out.tiles.append(DashTile(kicker: "Routines", big: "\(activeR)",
                              sub: r.off ? "master switch off" : "\(r.list.count) registered",
                              drill: .routines, drillLabel: "Routines",
                              spark: DashSpark(bars: false, data: [], color: .inkDim)))
    out.routines = r.list.map { rt in
        DashLine(ic: "⟳", icColor: rt.register == .active ? .lime : .inkFaint,
                 name: rt.name, nameMuted: rt.register != .active, status: rt.pillLabel)
    }
    if out.routines.isEmpty { out.routines = [DashLine(ic: "⟳", icColor: .inkFaint, name: "No routines registered yet", nameMuted: true)] }

    // runs tile + recent-runs pane — from the real receipts (audit + guide), window-scoped
    let days = histReceipts(days: rangeDays)
    let allRuns = days.flatMap { $0.runs }
    let denied = allRuns.filter { $0.result == "denied" }.count
    var runsPerDay = [Double](repeating: 0, count: max(Int(rangeDays), 1))
    // day index from the receipt's day label is lossy; count via a fresh grouping over receipts/day list
    for (i, d) in days.enumerated() where i < runsPerDay.count { runsPerDay[runsPerDay.count - 1 - i] = Double(d.runs.count) }
    out.tiles.append(DashTile(kicker: "Acts", big: "\(allRuns.count)",
                              ok: (allRuns.count - denied, denied),
                              drill: .history, drillLabel: "History",
                              spark: DashSpark(bars: true, data: runsPerDay, color: .lime)))
    out.runs = allRuns.prefix(4).map { run in
        DashLine(ic: run.result == "denied" ? "✗" : "✓",
                 icColor: run.result == "denied" ? .danger : .lime,
                 name: "\(run.wrapp) — \(run.prompt)", status: run.tm)
    }
    if out.runs.isEmpty { out.runs = [DashLine(ic: "·", icColor: .inkFaint, name: "No acts in this window", nameMuted: true)] }

    // connectors tile + health pane — status.json
    let relay = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
    var up = 0, down: [String] = []
    var backends: [String] = []
    var statusFresh = false
    if let st = readJSON(relay + "/status.json") as? [String: Any] {
        for c in (st["connectors"] as? [[String: Any]]) ?? [] {
            if (c["ok"] as? Bool) == true { up += 1 } else { down.append((c["name"] as? String) ?? "?") }
        }
        backends = (st["backends"] as? [String]) ?? []
        if let u = (st["updatedAt"] as? NSNumber)?.doubleValue { statusFresh = now - u < 2 * 3_600_000 }
    }
    out.tiles.append(DashTile(kicker: "Connectors", big: "\(up)", suffix: " /\(up + down.count)",
                              sub: down.isEmpty ? "all up" : down.joined(separator: " · "),
                              drill: .needs, drillLabel: "Needs", alert: !down.isEmpty,
                              spark: DashSpark(bars: false, data: [], color: .inkDim)))
    out.healthOK = (statusFresh ? ["daemon"] : []) + backends
    if !statusFresh { out.healthAlerts.append("status.json is stale — daemon heartbeat missing") }
    for d in down { out.healthAlerts.append("\(d) connector needs reconnect") }

    // needs tile
    let pending = osPending()
    out.tiles.append(DashTile(kicker: "Needs attention", big: "\(pending.count)",
                              sub: pending.first?.title ?? "you're clear",
                              drill: .needs, drillLabel: "Needs", alert: !pending.isEmpty,
                              spark: DashSpark(bars: false, data: [], color: .danger)))

    // activity pane — latest sessions per app
    let plural = ["run": "runs", "save": "saves", "dictation": "dictations", "publish": "publishes", "reply": "replies"]
    out.activity = osSessions(windowDays: min(rangeDays, 7))
        .sorted { $0.endMs > $1.endMs }.prefix(4).map { s in
            DashLine(ic: "↻", icColor: .inkFaint,
                     name: "\(relAgo(now - s.endMs)) ago · \(s.app) — " +
                           s.counts.sorted { $0.value > $1.value }.prefix(2)
                               .map { "\($0.value) \($0.value == 1 ? $0.key : (plural[$0.key] ?? $0.key))" }
                               .joined(separator: " · "))
        }
    if out.activity.isEmpty { out.activity = [DashLine(ic: "·", icColor: .inkFaint, name: "Quiet — no sessions in this window", nameMuted: true)] }

    return out
}

struct DashboardSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var range = "7d"
    @State private var live = DashLive()

    private let cols = Array(repeating: GridItem(.flexible(), spacing: 14), count: 5)
    private var rangeDays: Double { range == "Today" ? 1 : (range == "30d" ? 30 : 7) }
    private func load() { live = dashLive(rangeDays: rangeDays) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                SurfaceHead(kicker: "◦ DASHBOARD · ", strong: "EVERYTHING") {
                    SBSegment(items: ["Today", "7d", "30d"], selection: $range)
                }

                LazyVGrid(columns: cols, spacing: 14) {
                    ForEach(live.tiles) { t in DashTileView(tile: t, onNavigate: onNavigate) }
                }
                .padding(.top, 20)

                HStack(alignment: .top, spacing: 14) {
                    DashPane(title: "Routines — state", moreLabel: "→ Routines",
                             moreSurface: .routines, onNavigate: onNavigate) {
                        DashLineList(rows: live.routines, onNavigate: onNavigate)
                    }
                    DashPane(title: "Recent acts — from the audit trail", moreLabel: "→ History",
                             moreSurface: .history, onNavigate: onNavigate) {
                        DashLineList(rows: live.runs, onNavigate: onNavigate)
                    }
                }
                .padding(.top, 14)

                HStack(alignment: .top, spacing: 14) {
                    DashPane(title: "Subsystem health", onNavigate: onNavigate) {
                        DashHealth(ok: live.healthOK, alerts: live.healthAlerts, onNavigate: onNavigate)
                    }
                    DashPane(title: "Activity — latest sessions", moreLabel: "→ History",
                             moreSurface: .history, onNavigate: onNavigate) {
                        DashLineList(rows: live.activity, onNavigate: onNavigate)
                    }
                }
                .padding(.top, 14)

                FootNote(text: "dashboard is the state of the machine, not your work · every tile is a door, not a dead number · no usage meter until there's a truthful usage receipt")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear(perform: load)
        .onChange(of: range) { _ in load() }
    }
}

private struct DashSparkline: View {
    let spark: DashSpark
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            let data = spark.data
            guard !data.isEmpty, let mx = data.max(), let mn = data.min() else { return }
            if spark.bars {
                let bw = w / CGFloat(data.count)
                let denom = mx == 0 ? 1 : mx
                for (i, v) in data.enumerated() {
                    let bh = CGFloat(v / denom) * (h - 3)
                    let rect = CGRect(x: CGFloat(i) * bw + 1, y: h - bh, width: max(bw - 2, 1), height: bh)
                    ctx.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(spark.color.opacity(0.8)))
                }
            } else {
                let span = (mx - mn) == 0 ? 1 : (mx - mn)
                var path = Path()
                for (i, v) in data.enumerated() {
                    let x = CGFloat(i) / CGFloat(max(data.count - 1, 1)) * w
                    let y = h - CGFloat((v - mn) / span) * (h - 4) - 2
                    if i == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
                ctx.stroke(path, with: .color(spark.color.opacity(0.85)),
                           style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            }
        }
    }
}

private struct DashTileView: View {
    let tile: DashTile
    var onNavigate: (Surface) -> Void
    @State private var hover = false

    private var bigText: Text {
        let head = Text(tile.big).foregroundColor(tile.alert ? .danger : .ink)
        let tail = tile.suffix != nil
            ? Text(tile.suffix!).font(.hanken(15)).foregroundColor(.inkDim)
            : Text("")
        return (head + tail).font(.hanken(32, .semibold))
    }

    var body: some View {
        Button { onNavigate(tile.drill) } label: {
            VStack(alignment: .leading, spacing: 0) {
                Text(tile.kicker.uppercased()).font(.splMono(9.5)).tracking(1.4).foregroundColor(.inkFaint)
                bigText.padding(.top, 6)
                subView.padding(.top, 2)
                Spacer(minLength: 8)
                if !tile.spark.data.isEmpty {
                    DashSparkline(spark: tile.spark).frame(height: 30).padding(.top, 10)
                }
                Text("→ " + tile.drillLabel).font(.splMono(9.5))
                    .foregroundColor(hover ? .inkSec : .inkFaint).padding(.top, 8)
            }
            .padding(.horizontal, 15).padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 128, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14)
                .fill(tile.alert ? Color(red: 0.102, green: 0.071, blue: 0.086) : Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 14)
                .stroke(hover ? (tile.alert ? Color.danger : Color.indigo) : Color.edge, lineWidth: 1))
            .offset(y: hover ? -2 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(.easeOut(duration: 0.12)) { hover = h } }
    }

    @ViewBuilder private var subView: some View {
        if let ok = tile.ok {
            HStack(spacing: 8) {
                Text("✓\(ok.0)").font(.hanken(11.5)).foregroundColor(.lime)
                Text("✗\(ok.1)").font(.hanken(11.5)).foregroundColor(.danger)
            }
        } else if let s = tile.sub {
            Text(s).font(.hanken(11.5)).foregroundColor(.inkDim)
        }
    }
}

private struct DashPane<Content: View>: View {
    let title: String
    var moreLabel: String? = nil
    var moreSurface: Surface? = nil
    var onNavigate: (Surface) -> Void
    @ViewBuilder var content: Content
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title).font(.hanken(12.5, .semibold)).foregroundColor(.ink)
                Spacer(minLength: 8)
                if let m = moreLabel, let s = moreSurface {
                    Button { onNavigate(s) } label: {
                        Text(m).font(.splMono(10)).foregroundColor(hover ? .indigo : .inkFaint)
                    }
                    .buttonStyle(.plain)
                    .onHover { hover = $0 }
                }
            }
            .padding(.bottom, 4)
            content
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.edge, lineWidth: 1))
    }
}

private struct DashLineList: View {
    let rows: [DashLine]
    var onNavigate: (Surface) -> Void
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { idx, r in
                DashLineRow(row: r, showTop: idx > 0)
            }
        }
    }
}

private struct DashLineRow: View {
    let row: DashLine
    let showTop: Bool
    var body: some View {
        HStack(spacing: 10) {
            Text(row.ic).font(.splMono(12)).foregroundColor(row.icColor).frame(width: 16)
            Text(row.name).font(.hanken(13)).foregroundColor(row.nameMuted ? .inkDim : .inkSec).lineLimit(1)
            Spacer(minLength: 8)
            if let s = row.status { Text(s).font(.splMono(11)).foregroundColor(row.statusColor) }
            if let m = row.mark { Text(m).font(.splMono(11)).foregroundColor(row.markColor) }
        }
        .padding(.vertical, 8)
        .overlay(alignment: .top) {
            if showTop { Rectangle().fill(Color.edgeSoft).frame(height: 1) }
        }
    }
}

private struct DashHealth: View {
    let ok: [String]
    let alerts: [String]
    var onNavigate: (Surface) -> Void
    @State private var fixHover = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 16) {
                ForEach(ok, id: \.self) { label in
                    HStack(spacing: 7) {
                        Circle().fill(Color.lime).frame(width: 7, height: 7)
                        Text(label).font(.hanken(12.5)).foregroundColor(.inkSec)
                    }
                }
                if ok.isEmpty { Text("no green subsystems right now").font(.hanken(12)).foregroundColor(.inkDim) }
                Spacer(minLength: 0)
            }
            .padding(.top, 4).padding(.bottom, 8)
            ForEach(alerts, id: \.self) { alert in
                HStack(spacing: 10) {
                    Text("◐").font(.splMono(12)).foregroundColor(.danger).frame(width: 16)
                    Text(alert).font(.hanken(13)).foregroundColor(.inkSec).lineLimit(1)
                    Spacer(minLength: 8)
                    Button { onNavigate(.needs) } label: {
                        Text("→ fix").font(.splMono(10)).foregroundColor(.lime)
                            .padding(.horizontal, 8).padding(.vertical, 1)
                            .background(Capsule().fill(Color.lime.opacity(0.12)))
                            .overlay(Capsule().stroke(Color.lime.opacity(fixHover ? 0.6 : 0.4), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .onHover { fixHover = $0 }
                }
                .padding(.vertical, 8)
                .overlay(alignment: .top) { Rectangle().fill(Color.edgeSoft).frame(height: 1) }
            }
            if alerts.isEmpty {
                HStack(spacing: 10) {
                    Text("✓").font(.splMono(12)).foregroundColor(.lime).frame(width: 16)
                    Text("all subsystems healthy").font(.hanken(13)).foregroundColor(.inkSec)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 8)
                .overlay(alignment: .top) { Rectangle().fill(Color.edgeSoft).frame(height: 1) }
            }
        }
    }
}

// =====================================================================================================
// MARK: - 2. NeedsSurface (attention.js — the action inbox · what · why · one action)
// =====================================================================================================

private enum TPKind { case normal, bold, muted }
private struct TP { let t: String; let kind: TPKind }

private func titleText(_ parts: [TP]) -> Text {
    parts.reduce(Text("")) { acc, p in
        let seg: Text
        switch p.kind {
        case .normal: seg = Text(p.t).foregroundColor(.ink)
        case .bold:   seg = Text(p.t).font(.hanken(13.5, .semibold)).foregroundColor(.ink)
        case .muted:  seg = Text(p.t).foregroundColor(.inkDim)
        }
        return acc + seg
    }
    .font(.hanken(13.5))
}

private enum NeedTone { case lime, indigo, danger, plain }
private enum NeedBehavior { case resolve(String); case launch(String); case route(Surface) }  // launch carries the app id to open

private struct NeedAct: Identifiable {
    let id = UUID()
    let label: String
    var tone: NeedTone = .plain
    var primary: Bool = false
    let behavior: NeedBehavior
}

private struct NeedItem: Identifiable {
    let id: String
    let mk: String
    let mkColor: Color
    let title: [TP]
    var why: String? = nil
    var detail: String? = nil
    let src: String
    let acts: [NeedAct]
}

private struct NeedBand: Identifiable {
    let id: String
    let mk: String
    let mkColor: Color
    let lb: String
    let hint: String
    let barColor: Color
    let items: [NeedItem]
}

private enum NeedSample {
    static let filterOrder = ["all", "blocking", "failed", "waiting"]
    static let filterLabel: [String: String] = ["all": "All", "blocking": "Blocking", "failed": "Failed", "waiting": "Waiting"]
}

// ═══ LIVE bands — every item derives from a real ~/.relay state, and every action is real:
//   ▲ Blocking — down connectors (status.json ok:false) + a stale daemon status file
//   ● Failed   — routines whose last run failed (routines.json, when the fields exist)
//   ○ Waiting  — a suspended guide (resume really resumes), routines switched off, overdue tasks
// Nothing invented: a source with no real evidence contributes no items, and an empty inbox is the
// calm "you're clear" state.

private enum NeedTrigger {
    // `touch ~/.relay/open-panel` — RelayMenuBar's trigger loop fronts the real menu-bar panel.
    static func openPanel() {
        let p = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/open-panel")
        FileManager.default.createFile(atPath: p, contents: Data())
    }
    // Resume a suspended guide exactly like the menu item: move suspended → run; the watcher resumes it.
    static func resumeGuide() {
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
        let src = (dir as NSString).appendingPathComponent("guide-suspended.json")
        let dst = (dir as NSString).appendingPathComponent("guide-run.json")
        try? FileManager.default.removeItem(atPath: dst)
        try? FileManager.default.moveItem(atPath: src, toPath: dst)
    }
}

private func needsLiveBands() -> [NeedBand] {
    let relay = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
    var blocking: [NeedItem] = []
    var failed: [NeedItem] = []
    var waiting: [NeedItem] = []

    // ▲ down connectors — the daemon reports them in status.json; the fix lives in the panel
    if let st = readJSON(relay + "/status.json") as? [String: Any] {
        for c in (st["connectors"] as? [[String: Any]]) ?? [] where (c["ok"] as? Bool) == false {
            let n = (c["name"] as? String) ?? "connector"
            blocking.append(NeedItem(
                id: "conn-\(n)", mk: "⚠", mkColor: .danger,
                title: [TP(t: "Reconnect: ", kind: .bold), TP(t: n, kind: .normal),
                        TP(t: " — connector is down, 0 tools", kind: .muted)],
                why: "why…",
                detail: "The daemon couldn't start \(n), so its tools are unavailable to every wrapp and to God. Open the panel → Connections to restart it; if it keeps failing, its command or keys need fixing.",
                src: "◦ from status.json",
                acts: [NeedAct(label: "Open panel", tone: .indigo, primary: true, behavior: .resolve("panel")),
                       NeedAct(label: "Later", behavior: .resolve("Snoozed"))]))
        }
        // ▲ stale status — the file stopped refreshing, so everything above it is guesswork
        if let up = (st["updatedAt"] as? NSNumber)?.doubleValue,
           Date().timeIntervalSince1970 * 1000 - up > 2 * 3_600_000 {
            blocking.append(NeedItem(
                id: "stale-status", mk: "⚠", mkColor: .danger,
                title: [TP(t: "Daemon status is stale ", kind: .bold),
                        TP(t: "— last heartbeat \(relAgo(Date().timeIntervalSince1970 * 1000 - up)) ago", kind: .muted)],
                why: "why…",
                detail: "status.json hasn't refreshed, so connector/tool health shown anywhere in the OS may be out of date. Open the panel to check the daemon.",
                src: "◦ from status.json",
                acts: [NeedAct(label: "Open panel", tone: .indigo, primary: true, behavior: .resolve("panel"))]))
        }
    }

    // ● routines whose last run failed (only when the control plane actually records it)
    if let r = readJSON(relay + "/routines.json") as? [String: Any] {
        for routine in (r["routines"] as? [[String: Any]]) ?? [] {
            let outcome = (routine["lastOutcome"] as? String) ?? (routine["lastError"] != nil ? "error" : "")
            guard outcome == "error" || outcome == "failed" else { continue }
            let t = (routine["title"] as? String) ?? (routine["id"] as? String) ?? "routine"
            failed.append(NeedItem(
                id: "routine-\((routine["id"] as? String) ?? t)", mk: "✗", mkColor: sbAmber,
                title: [TP(t: "Routine ", kind: .normal), TP(t: "\"\(t)\"", kind: .bold), TP(t: " failed its last run", kind: .normal)],
                why: (routine["lastError"] as? String).map { _ in "log…" },
                detail: routine["lastError"] as? String,
                src: "◦ from Routines",
                acts: [NeedAct(label: "Open Routines", tone: .lime, primary: true, behavior: .route(.routines))]))
        }
    }

    // ○ a guide you left partway — Resume genuinely resumes it (suspended → run, watcher picks it up)
    if let g = readJSON(relay + "/guide-suspended.json") as? [String: Any] {
        let n = ((g["steps"] as? [[String: Any]]) ?? []).count
        let at = (g["startIndex"] as? NSNumber)?.intValue ?? 0
        waiting.append(NeedItem(
            id: "guide-suspended", mk: "▸", mkColor: .inkDim,
            title: [TP(t: "Resume the tour ", kind: .bold),
                    TP(t: n > 0 ? "— you left it at step \(min(at + 1, n)) of \(n)" : "— left partway", kind: .muted)],
            why: "why…",
            detail: "A guided walkthrough was abandoned mid-way and saved. Resume picks it up exactly where you left it.",
            src: "◦ from guide-suspended.json",
            acts: [NeedAct(label: "Resume", tone: .lime, primary: true, behavior: .resolve("resume-guide")),
                   NeedAct(label: "Later", behavior: .resolve("Snoozed"))]))
    }

    // ○ routines switched off — nothing scheduled will run until flipped back
    let control = readJSON(relay + "/routines-control.json") as? [String: Any]
    let routinesObj = readJSON(relay + "/routines.json") as? [String: Any]
    if (control?["off"] as? Bool) == true || (routinesObj?["globalPaused"] as? Bool) == true {
        waiting.append(NeedItem(
            id: "routines-off", mk: "⏸", mkColor: .inkDim,
            title: [TP(t: "Routines are switched off ", kind: .bold),
                    TP(t: "— nothing will run on schedule", kind: .muted)],
            src: "◦ from routines-control.json",
            acts: [NeedAct(label: "Open Routines", tone: .indigo, primary: true, behavior: .route(.routines))]))
    }

    // ○ overdue tasks — real lines in tasks.md with a past due:
    for t in osTasksAll().tasks.filter({ $0.over }).prefix(5) {
        waiting.append(NeedItem(
            id: "task-\(t.raw.hashValue)", mk: "☐", mkColor: .inkDim,
            title: [TP(t: "Overdue: ", kind: .bold), TP(t: t.title, kind: .normal),
                    TP(t: t.due.map { " (due \($0))" } ?? "", kind: .muted)],
            src: "◦ from Tasks · \((t.folder as NSString).lastPathComponent)/tasks.md",
            acts: [NeedAct(label: "Open", tone: .lime, primary: true, behavior: .route(.tasks))]))
    }

    return [
        NeedBand(id: "blocking", mk: "▲", mkColor: .danger, lb: "Blocking", hint: "act to continue", barColor: .danger, items: blocking),
        NeedBand(id: "failed", mk: "●", mkColor: sbAmber, lb: "Failed", hint: "retry or investigate", barColor: sbAmber, items: failed),
        NeedBand(id: "waiting", mk: "○", mkColor: .inkDim, lb: "Waiting", hint: "your call, not blocking", barColor: .edge, items: waiting),
    ].filter { !$0.items.isEmpty }
}

struct NeedsSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var bands: [NeedBand] = []
    @State private var resolved: Set<String> = []
    @State private var whyOpen: Set<String> = []
    @State private var filter = "all"

    private var total: Int {
        bands.reduce(0) { $0 + $1.items.filter { !resolved.contains($0.id) }.count }
    }
    private var shownBands: [NeedBand] {
        bands
            .filter { filter == "all" || $0.id == filter }
            .filter { band in band.items.contains { !resolved.contains($0.id) } }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                SurfaceHead(kicker: "◦ NEEDS ATTENTION · ",
                            strong: "\(total) ITEM\(total == 1 ? "" : "S")") {
                    HStack(spacing: 8) {
                        SBActButton(label: "Show: \(NeedSample.filterLabel[filter] ?? "All") ▾") { cycleFilter() }
                        SBActButton(label: "Clear read") { clearRead() }
                    }
                }

                if total == 0 {
                    NeedsClearState().padding(.top, 40)
                } else {
                    ForEach(shownBands) { band in
                        NeedBandView(band: band,
                                     visible: band.items.filter { !resolved.contains($0.id) },
                                     whyOpen: whyOpen,
                                     onToggleWhy: toggleWhy,
                                     onAct: handle)
                    }
                }

                FootNote(text: "the action inbox · blocking first, then failures, then your call · every item derives from real ~/.relay state · an item leaves when its state clears")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { bands = needsLiveBands() }
    }

    private func cycleFilter() {
        let i = NeedSample.filterOrder.firstIndex(of: filter) ?? 0
        filter = NeedSample.filterOrder[(i + 1) % NeedSample.filterOrder.count]
    }
    private func toggleWhy(_ id: String) {
        if whyOpen.contains(id) { whyOpen.remove(id) } else { whyOpen.insert(id) }
    }
    private func handle(_ item: NeedItem, _ act: NeedAct) {
        switch act.behavior {
        case .resolve(let what):
            switch what {
            case "panel":                       // real: fronts the menu-bar panel via the trigger file
                NeedTrigger.openPanel()
            case "resume-guide":                // real: suspended → run; the guide watcher resumes it
                NeedTrigger.resumeGuide()
                bands = needsLiveBands()        // the suspended file is gone → the item leaves honestly
            default: break                      // Snooze/Later — hide for this visit only
            }
            withAnimation(.easeInOut(duration: 0.28)) { _ = resolved.insert(item.id) }
        case .launch(let app):
            OSLaunch.launchOr(app, .init(kind: "need")) { onNavigate(.apps) }   // open the tool this item is about
        case .route(let s):
            onNavigate(s)
        }
    }
    private func clearRead() {
        let ids = shownBands.flatMap { $0.items }.map { $0.id }.filter { !resolved.contains($0) }
        withAnimation(.easeInOut(duration: 0.28)) { resolved.formUnion(ids) }
    }
}

private struct NeedBandView: View {
    let band: NeedBand
    let visible: [NeedItem]
    let whyOpen: Set<String>
    var onToggleWhy: (String) -> Void
    var onAct: (NeedItem, NeedAct) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 9) {
                Text(band.mk).font(.splMono(12)).foregroundColor(band.mkColor)
                Text(band.lb.uppercased()).font(.splMono(10.5)).tracking(1.4).foregroundColor(.inkSec)
                Text(band.hint).font(.hanken(11)).foregroundColor(.inkFaint)
                Text("\(visible.count)").font(.splMono(10)).foregroundColor(.inkFaint)
                    .padding(.horizontal, 7)
                    .background(Capsule().fill(Color.panel))
                    .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
                Spacer(minLength: 0)
            }
            .padding(.bottom, 2)
            ForEach(visible) { item in
                NeedItemView(item: item, barColor: band.barColor,
                             whyIsOpen: whyOpen.contains(item.id),
                             onToggleWhy: { onToggleWhy(item.id) },
                             onAct: { onAct(item, $0) })
            }
        }
        .padding(.top, 22)
    }
}

private struct NeedItemView: View {
    let item: NeedItem
    let barColor: Color
    let whyIsOpen: Bool
    var onToggleWhy: () -> Void
    var onAct: (NeedAct) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Text(item.mk).font(.splMono(13)).foregroundColor(item.mkColor).frame(width: 16)
            VStack(alignment: .leading, spacing: 4) {
                titleText(item.title).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 9) {
                    if let why = item.why {
                        Button(action: onToggleWhy) {
                            Text(why).font(.splMono(10)).foregroundColor(.inkDim).underline()
                        }
                        .buttonStyle(.plain)
                    }
                    Text(item.src).font(.splMono(10)).foregroundColor(.inkFaint)
                }
                if whyIsOpen, let d = item.detail {
                    Text(d).font(.hanken(12)).foregroundColor(.inkSec)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 11).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                        .overlay(alignment: .leading) { Rectangle().fill(Color.edge).frame(width: 2) }
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .padding(.top, 3)
                }
            }
            Spacer(minLength: 8)
            HStack(spacing: 8) {
                ForEach(item.acts) { a in
                    NeedActButton(act: a) { onAct(a) }
                }
            }
        }
        .padding(.horizontal, 15).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
        .overlay(alignment: .leading) { Rectangle().fill(barColor).frame(width: 2) }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.edge, lineWidth: 1))
    }
}

private struct NeedActButton: View {
    let act: NeedAct
    var onTap: () -> Void
    @State private var hover = false

    private var bg: Color {
        guard act.primary else { return .raised }
        switch act.tone {
        case .lime:   return .lime
        case .indigo: return .indigo
        case .danger: return .danger
        case .plain:  return .raised
        }
    }
    private var fg: Color {
        guard act.primary else { return hover ? .ink : .inkSec }
        switch act.tone {
        case .lime:  return sbInkOnLime
        default:     return .white
        }
    }

    var body: some View {
        Button(action: onTap) {
            Text(act.label)
                .font(.hanken(12, act.primary ? .semibold : .regular))
                .foregroundColor(fg)
                .padding(.horizontal, 13).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8).fill(bg))
                .overlay(RoundedRectangle(cornerRadius: 8)
                    .stroke(act.primary ? .clear : (hover ? Color.inkFaint : Color.edge), lineWidth: 1))
                .brightness(hover && act.primary ? 0.06 : 0)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct NeedsClearState: View {
    var body: some View {
        VStack(spacing: 10) {
            Text("✓").font(.system(size: 24)).foregroundColor(.lime)
                .frame(width: 52, height: 52)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color(red: 0.078, green: 0.102, blue: 0.063)))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.lime.opacity(0.3), lineWidth: 1))
            Text("You're clear — nothing needs you.").font(.hanken(15)).foregroundColor(.ink)
            Text("the rail badge disappears · the Home strip hides · this is the state the OS wants you in")
                .font(.splMono(10.5)).foregroundColor(.inkFaint).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 34).padding(.horizontal, 24)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.lime.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
    }
}

// =====================================================================================================
// MARK: - 3. RoutinesSurface (routines.js — the automation monitor · things that run without you)
// =====================================================================================================

private enum SegKind { case dim, strong, ok, bad }
private struct Seg { let t: String; let kind: SegKind }

private func segLine(_ segs: [Seg]) -> Text {
    segs.reduce(Text("")) { acc, s in
        let color: Color
        switch s.kind { case .dim: color = .inkDim; case .strong: color = .inkSec; case .ok: color = .lime; case .bad: color = .danger }
        let weight: Font.Weight = s.kind == .strong ? .medium : .regular
        return acc + Text(s.t).font(.hanken(12.5, weight)).foregroundColor(color)
    }
}

private enum RReg { case active, running, waiting, paused, failed }

private func regBorder(_ r: RReg) -> Color {
    switch r { case .active: return .lime; case .running: return .indigo; case .waiting: return sbAmber; case .paused: return .inkFaint; case .failed: return .danger }
}
private func regGroup(_ r: RReg) -> String {
    switch r { case .active, .running: return "active"; case .failed: return "failed"; case .paused, .waiting: return "paused" }
}

private struct GrantChip: Identifiable { let id = UUID(); let glyph: String; var text: String; var ungranted: Bool }

private enum RActType { case run, pause, resume, grant, revoke, log, edit }
private struct RAct: Identifiable { let id = UUID(); let label: String; let kind: SBBtnKind; let act: RActType }

private struct Routine: Identifiable {
    let id: String
    let name: String
    var register: RReg
    var pillLabel: String
    var dot: Color
    let sched: [[Seg]]
    var outsPrefix: String? = nil     // e.g. "outputs: "
    var outsLink: String? = nil       // e.g. "5 briefs"  → History
    var outsSuffix: String? = nil
    var outsPlain: String? = nil      // a link-less outs line
    var attn: String? = nil
    var grant: [GrantChip]
    let acts: [RAct]
    var runDisabled: Bool = false
}

// ═══ LIVE registry — routines.json is the daemon's record ({id,title,tier,active,lastRunAt,runs,
// tokens} + globalPaused); routines-control.json {off} is the user's master switch (the ~/.relay
// control plane — the daemon polls it). The OS reads both truthfully and writes ONLY the control file.

private func routinesLive() -> (list: [Routine], off: Bool, updatedMs: Double, hasFile: Bool) {
    let relay = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
    let obj = readJSON(relay + "/routines.json") as? [String: Any]
    let off = ((readJSON(relay + "/routines-control.json") as? [String: Any])?["off"] as? Bool == true)
        || (obj?["globalPaused"] as? Bool == true)
    let now = Date().timeIntervalSince1970 * 1000
    var list: [Routine] = []
    for r in (obj?["routines"] as? [[String: Any]]) ?? [] {
        let id = (r["id"] as? String) ?? UUID().uuidString
        let active = (r["active"] as? Bool) ?? false
        let lastMs = (r["lastRunAt"] as? NSNumber)?.doubleValue ?? 0
        let runs = (r["runs"] as? NSNumber)?.intValue ?? 0
        let tokens = (r["tokens"] as? NSNumber)?.intValue ?? 0
        let lastError = r["lastError"] as? String
        let failed = lastError != nil || (r["lastOutcome"] as? String) == "error"
        let reg: RReg = failed ? .failed : (active && !off ? .active : .paused)
        let pill = failed ? "failed" : (active && !off ? "active" : (active ? "held — routines off" : "off"))
        var sched: [[Seg]] = [[Seg(t: "⛭ tier ", kind: .dim), Seg(t: (r["tier"] as? String) ?? "daemon", kind: .strong)]]
        sched.append(lastMs > 0
            ? [Seg(t: "last ", kind: .dim), Seg(t: failed ? "✗ " : "✓ ", kind: failed ? .bad : .ok),
               Seg(t: relAgo(now - lastMs) + " ago", kind: .strong)]
            : [Seg(t: "never ran", kind: .dim)])
        list.append(Routine(
            id: id,
            name: (r["title"] as? String) ?? id,
            register: reg, pillLabel: pill,
            dot: reg == .active ? .lime : (reg == .failed ? .danger : .inkFaint),
            sched: sched,
            outsPlain: runs > 0 ? "\(runs) run\(runs == 1 ? "" : "s") · \(tokens) tokens spent" : "no runs recorded yet",
            attn: lastError.map { "✗ \($0)" },
            grant: [GrantChip(glyph: "⛭", text: "tier: \((r["tier"] as? String) ?? "daemon")", ungranted: false)],
            acts: [RAct(label: "Runs in History", kind: .plain, act: .log)]))
    }
    return (list, off, (obj?["updatedAt"] as? NSNumber)?.doubleValue ?? 0, obj != nil)
}

// the real master switch — writes routines-control.json; the daemon picks it up on its next tick
private func routinesSetOff(_ off: Bool) {
    let p = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/routines-control.json")
    var obj = (readJSON(p) as? [String: Any]) ?? [:]
    obj["off"] = off
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) {
        try? data.write(to: URL(fileURLWithPath: p), options: .atomic)
    }
}

struct RoutinesSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var routines: [Routine] = []
    @State private var off = false
    @State private var hasFile = true
    @State private var filter = "All"

    private var activeCount: Int { routines.filter { regGroup($0.register) == "active" }.count }

    private func load() {
        let r = routinesLive()
        routines = r.list; off = r.off; hasFile = r.hasFile
    }

    private func shows(_ r: Routine) -> Bool {
        switch filter {
        case "Active": return regGroup(r.register) == "active"
        case "Paused": return regGroup(r.register) == "paused"
        case "Failed": return regGroup(r.register) == "failed"
        default:       return true
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 14) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("ROUTINES").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                        Text("Runs without me").font(.hanken(20, .semibold)).foregroundColor(.ink)
                    }
                    Text("\(activeCount) active").font(.splMono(11)).foregroundColor(.inkDim)
                        .padding(.horizontal, 10).padding(.vertical, 2)
                        .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
                    Spacer(minLength: 8)
                    SBSegment(items: ["All", "Active", "Paused", "Failed"], selection: $filter)
                }
                .padding(.bottom, 14)
                .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)

                // the master switch — the one real global control (routines-control.json)
                HStack(spacing: 12) {
                    Circle().fill(off ? Color.inkFaint : Color.lime).frame(width: 7, height: 7)
                    (Text(off ? "Routines are switched off " : "Routines are on ").font(.hanken(13, .medium)).foregroundColor(.ink)
                        + Text(off ? "— nothing runs on schedule until you flip this." : "— active routines run on their schedule.").font(.hanken(13)).foregroundColor(.inkSec))
                    Spacer(minLength: 0)
                    SBActButton(label: off ? "Turn on" : "Turn off", kind: off ? .pri : .plain) {
                        routinesSetOff(!off); load()
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 13)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(off ? Color.edge : Color.lime.opacity(0.3), lineWidth: 1))
                .padding(.top, 16)

                if !hasFile {
                    Text("No routines.json yet — the daemon writes it once a routine exists.")
                        .font(.hanken(12.5)).foregroundColor(.inkDim).padding(.top, 14)
                }

                VStack(spacing: 12) {
                    ForEach($routines) { $r in
                        if shows(r) {
                            RoutineRowView(routine: $r, onNavigate: onNavigate)
                        }
                    }
                }
                .padding(.top, 16)

                RoutineCreateCTA(onNavigate: onNavigate).padding(.top, 16)

                FootNote(text: "the automation monitor · reads the daemon's routines.json truthfully · the one write is the master switch (routines-control.json) · failures escalate to Needs attention")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear(perform: load)
    }
}

private struct RoutineRowView: View {
    @Binding var routine: Routine
    var onNavigate: (Surface) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // header — icon, name, live pill
            HStack(spacing: 11) {
                Text("⟳").font(.splMono(14)).foregroundColor(.inkSec)
                    .frame(width: 30, height: 30)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1))
                Text(routine.name).font(.hanken(14.5, .semibold)).foregroundColor(.ink)
                Spacer(minLength: 8)
                RoutinePill(register: routine.register, label: routine.pillLabel, dot: routine.dot)
            }

            // schedule spans
            HStack(spacing: 14) {
                ForEach(Array(routine.sched.enumerated()), id: \.offset) { _, line in
                    segLine(line)
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 11).padding(.leading, 41)

            // outputs
            if let plain = routine.outsPlain {
                Text(plain).font(.hanken(12)).foregroundColor(.inkFaint)
                    .padding(.top, 10).padding(.leading, 41)
            } else if let pre = routine.outsPrefix, let link = routine.outsLink {
                (Text(pre).font(.hanken(12)).foregroundColor(.inkFaint)
                    + Text(link).font(.hanken(12)).foregroundColor(.indigo)
                    + Text(routine.outsSuffix ?? "").font(.hanken(12)).foregroundColor(.inkFaint))
                    .padding(.top, 10).padding(.leading, 41)
            }

            // escalation note
            if let attn = routine.attn {
                Text(attn).font(.splMono(11.5)).foregroundColor(.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 9).padding(.leading, 41)
            }

            // grants + actions
            HStack(alignment: .center, spacing: 10) {
                HStack(spacing: 6) {
                    ForEach(routine.grant) { g in RoutineGrantView(chip: g) }
                }
                Spacer(minLength: 8)
                HStack(spacing: 7) {
                    ForEach(routine.acts) { a in
                        SBActButton(label: a.label, kind: a.kind,
                                    disabled: a.act == .run && routine.runDisabled) { perform(a.act) }
                    }
                }
            }
            .padding(.top, 12).padding(.leading, 41)
        }
        .padding(.horizontal, 17).padding(.vertical, 15)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.panel))
        .overlay(alignment: .leading) { Rectangle().fill(regBorder(routine.register)).frame(width: 2) }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.edge, lineWidth: 1))
    }

    private func perform(_ act: RActType) {
        switch act {
        case .log:   onNavigate(.history)
        case .edit:  onNavigate(.workflows)
        case .pause:
            withAnimation { set(.paused, "paused", .inkFaint); routine.attn = nil }
        case .resume:
            withAnimation { set(.active, "active", .lime); routine.attn = nil }
        case .revoke:
            withAnimation { set(.paused, "revoked", .inkFaint); routine.attn = nil }
        case .grant:
            withAnimation {
                set(.running, "running…", .indigo)
                routine.attn = nil
                if let i = routine.grant.firstIndex(where: { $0.ungranted }) {
                    routine.grant[i].ungranted = false
                    routine.grant[i].text = "Drive write ✓"
                }
            }
        case .run:
            withAnimation { set(.running, "running…", .indigo); routine.runDisabled = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                withAnimation { set(.active, "ran ✓ just now", .lime); routine.runDisabled = false }
            }
        }
    }
    private func set(_ reg: RReg, _ label: String, _ dot: Color) {
        routine.register = reg; routine.pillLabel = label; routine.dot = dot
    }
}

private struct RoutinePill: View {
    let register: RReg
    let label: String
    let dot: Color
    private var fill: Color {
        switch register {
        case .active:  return Color.lime.opacity(0.12)
        case .running: return Color.indigo.opacity(0.16)
        case .waiting: return sbAmber.opacity(0.14)
        case .failed:  return Color.danger.opacity(0.14)
        case .paused:  return Color.raised
        }
    }
    private var fg: Color {
        switch register {
        case .active:  return .lime
        case .running: return sbIndigoLite
        case .waiting: return sbAmber
        case .failed:  return .danger
        case .paused:  return .inkDim
        }
    }
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(dot).frame(width: 6, height: 6)
                .shadow(color: dot.opacity(0.6), radius: 3)
            Text(label).font(.splMono(10.5)).foregroundColor(fg)
        }
        .padding(.horizontal, 10).padding(.vertical, 3)
        .background(Capsule().fill(fill))
        .overlay(Capsule().stroke(fg.opacity(0.35), lineWidth: 1))
    }
}

private struct RoutineGrantView: View {
    let chip: GrantChip
    var body: some View {
        HStack(spacing: 5) {
            Text(chip.glyph).font(.splMono(10.5)).foregroundColor(chip.ungranted ? sbAmber : .inkFaint)
            Text(chip.text).font(.splMono(10.5)).foregroundColor(chip.ungranted ? sbAmber : .inkSec)
        }
        .padding(.horizontal, 8).padding(.vertical, 2)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.raised))
        .overlay(RoundedRectangle(cornerRadius: 6)
            .stroke(chip.ungranted ? sbAmber.opacity(0.4) : Color.edge, lineWidth: 1))
    }
}

private struct RoutineCreateCTA: View {
    var onNavigate: (Surface) -> Void
    @State private var hover = false
    var body: some View {
        Button { OSLaunch.launchOr("autopilot", .init(kind: "routine")) { onNavigate(.apps) } } label: {
            HStack(spacing: 12) {
                Text("+").font(.hanken(15)).foregroundColor(.lime)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                (Text("Add a routine").font(.hanken(13, .medium)).foregroundColor(.inkSec)
                    + Text(" — a wrapp requests one and it appears here. ").font(.hanken(13)).foregroundColor(.inkDim)
                    + Text("Autopilot is routine #1 — open it to activate.").font(.hanken(13)).foregroundColor(.inkSec))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 17).padding(.vertical, 15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 13)
                .fill(hover ? Color.raised : .clear))
            .overlay(RoundedRectangle(cornerRadius: 13)
                .stroke(hover ? Color.inkFaint : Color.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// =====================================================================================================
// MARK: - 4. WorkflowsSurface (workflows.js — reusable ①→②→③ pipelines · partial ≠ ✓)
// =====================================================================================================

private struct WFStep: Identifiable { let id = UUID(); let no: Int; let t: String; let state: String } // done/run/fail/skip/""
private struct WFRun: Identifiable { let id = UUID(); let st: String; let tm: String; let desc: String; let link: String; let retry: Bool }

private enum WFActType { case run, edit, promote, log }
private struct WFAct: Identifiable { let id = UUID(); let label: String; let kind: SBBtnKind; let act: WFActType }

private struct Workflow: Identifiable {
    let id: String
    let name: String
    var lastKind: String     // ok/part/bad/neu
    var lastLabel: String
    let steps: [WFStep]
    var inputs: String? = nil
    var acts: [WFAct] = []
    var history: [WFRun]? = nil
    var attn: String? = nil
    var compact: Bool = false
    var dots: Int = 3
    // live state
    var collapsed: Bool = false
    var expanded: Bool = false     // compact open
    var editing: Bool = false
    var promoted: Bool = false
    var running: Bool = false
}

// ═══ LIVE workflows — there is no daemon workflow registry yet, so we don't invent one. The one REAL
// multi-step pipeline on this machine is the **batch** wrapp: each batch-state.json is a recipe of N
// answer-steps (brief + per-step open/selected/locked/error). We surface those truthfully; when none
// exist the surface is an honest "coming" state, never fabricated pipelines.

private func workflowsLive() -> [Workflow] {
    let base = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/storage")
    let fm = FileManager.default
    var out: [(Workflow, Double)] = []
    for origin in (try? fm.contentsOfDirectory(atPath: base)) ?? [] {
        let path = base + "/" + origin + "/batch-state.json"
        guard fm.fileExists(atPath: path),
              let obj = readJSON(path) as? [String: Any],
              let run = obj["run"] as? [String: Any],
              let answers = run["answers"] as? [[String: Any]], !answers.isEmpty else { continue }
        let brief = (run["brief"] as? String) ?? "Batch run"
        let mtime = (((try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)
        var steps: [WFStep] = []
        var done = 0, failed = 0
        for a in answers {
            let n = (a["n"] as? NSNumber)?.intValue ?? (steps.count + 1)
            let err = a["error"] != nil && !(a["error"] is NSNull)
            let locked = !(a["lockedId"] is NSNull) && a["lockedId"] != nil
            let selected = !(a["selectedId"] is NSNull) && a["selectedId"] != nil
            let state = err ? "fail" : (locked ? "done" : (selected ? "run" : ""))
            if state == "done" { done += 1 }; if state == "fail" { failed += 1 }
            steps.append(WFStep(no: n, t: "answer \(n)", state: state))
        }
        let total = steps.count
        let kind = failed > 0 ? "bad" : (done == total ? "ok" : (done > 0 ? "part" : "neu"))
        let label = failed > 0 ? "✗ error at a step"
            : (done == total ? "✓ locked · \(total) steps"
            : (done > 0 ? "◐ \(done)/\(total) locked" : "not started"))
        out.append((Workflow(
            id: (run["id"] as? String) ?? origin,
            name: "Batch · \(brief.count > 42 ? String(brief.prefix(40)) + "…" : brief)",
            lastKind: kind, lastLabel: label,
            steps: steps,
            inputs: "wrapp: batch · \(total) answer-steps · a slate you lock one at a time",
            acts: [WFAct(label: "Open in batch", kind: .pri, act: .run),
                   WFAct(label: "Runs in History", kind: .plain, act: .log)],
            compact: total > 5, dots: min(total, 8)), mtime))
    }
    return out.sorted { $0.1 > $1.1 }.map { $0.0 }
}

struct WorkflowsSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var workflows: [Workflow] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 14) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("WORKFLOWS").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                        Text("Reusable pipelines").font(.hanken(20, .semibold)).foregroundColor(.ink)
                    }
                    Text("\(workflows.count)").font(.splMono(11)).foregroundColor(.inkDim)
                        .padding(.horizontal, 10).padding(.vertical, 2)
                        .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
                    Spacer(minLength: 0)
                }
                .padding(.bottom, 14)
                .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)

                if workflows.isEmpty {
                    WorkflowsEmptyState(onNavigate: onNavigate).padding(.top, 20)
                } else {
                    VStack(spacing: 12) {
                        ForEach($workflows) { $w in
                            if w.compact {
                                WFCompactRow(workflow: $w)
                            } else {
                                WorkflowRowView(workflow: $w, onNavigate: onNavigate)
                            }
                        }
                    }
                    .padding(.top, 18)
                }

                FootNote(text: "a workflow chains steps into one recipe · today that's the batch wrapp (each run = a slate of answer-steps) · a partial run never masquerades as ✓ · a daemon workflow registry is the next layer")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { workflows = workflowsLive() }
    }
}

// Honest coming-state — no invented pipelines. Points at the real pipeline wrapp (batch).
private struct WorkflowsEmptyState: View {
    let onNavigate: (Surface) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("No pipelines yet.").font(.brico(20, .bold)).foregroundColor(.ink)
            Text("A workflow chains steps into one reusable recipe. Today the pipeline wrapp is batch — start a run and its answer-steps show up here. A first-class daemon workflow registry (schedule + grant + promote-to-routine) is the next layer.")
                .font(.hanken(13)).foregroundColor(.inkSec)
                .fixedSize(horizontal: false, vertical: true)
            LimeButton(label: "Open batch") { OSLaunch.launchOr("batch", .init(kind: "workflow")) { onNavigate(.apps) } }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
    }
}

private func wfLastColor(_ kind: String) -> Color {
    switch kind { case "ok": return .lime; case "bad": return .danger; case "part": return sbAmber; default: return .inkFaint }
}

private struct StepChip: View {
    let step: WFStep
    private var noColor: Color {
        switch step.state { case "done": return .lime; case "run": return sbIndigoLite; case "fail": return .danger; default: return .inkDim }
    }
    private var noBg: Color {
        switch step.state { case "done": return .lime.opacity(0.14); case "run": return .indigo.opacity(0.18); case "fail": return .danger.opacity(0.16); default: return Color(red: 0.059, green: 0.067, blue: 0.086) }
    }
    private var borderColor: Color {
        switch step.state { case "done": return .lime.opacity(0.4); case "run": return .indigo.opacity(0.5); case "fail": return .danger.opacity(0.4); default: return .edge }
    }
    var body: some View {
        HStack(spacing: 8) {
            Text("\(step.no)").font(.splMono(10)).foregroundColor(noColor)
                .frame(width: 17, height: 17)
                .background(Circle().fill(noBg))
                .overlay(Circle().stroke(noColor.opacity(0.6), lineWidth: 1))
            Text(step.t).font(.hanken(12.5)).foregroundColor(.inkSec)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color.raised))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(borderColor, lineWidth: 1))
        .opacity(step.state == "skip" ? 0.55 : 1)
    }
}

private struct StepChainView: View {
    let steps: [WFStep]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { idx, s in
                StepChip(step: s)
                if idx < steps.count - 1 {
                    Text("→").font(.splMono(12)).foregroundColor(.inkFaint).padding(.horizontal, 7)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct WorkflowRowView: View {
    @Binding var workflow: Workflow
    var onNavigate: (Surface) -> Void
    @State private var draftName = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // header (collapse toggle)
            Button { withAnimation { workflow.collapsed.toggle() } } label: {
                HStack(spacing: 11) {
                    Text("⇉").font(.splMono(14)).foregroundColor(.inkSec)
                        .frame(width: 30, height: 30)
                        .background(RoundedRectangle(cornerRadius: 9).fill(Color.raised))
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1))
                    Text(workflow.name).font(.hanken(14.5, .semibold)).foregroundColor(.ink)
                    if workflow.promoted {
                        Text("routine").font(.splMono(9.5)).tracking(1).foregroundColor(sbIndigoLite)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Capsule().fill(Color.indigo.opacity(0.16)))
                            .overlay(Capsule().stroke(Color.indigo.opacity(0.5), lineWidth: 1))
                    }
                    Spacer(minLength: 8)
                    Text(workflow.lastLabel).font(.splMono(11)).foregroundColor(wfLastColor(workflow.lastKind))
                    Text("▾").font(.splMono(11)).foregroundColor(.inkFaint)
                        .rotationEffect(.degrees(workflow.collapsed ? -90 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if !workflow.collapsed {
                StepChainView(steps: workflow.steps)
                    .padding(.top, 14).padding(.leading, 41)

                if let inputs = workflow.inputs {
                    Text(inputs).font(.hanken(12)).foregroundColor(.inkDim)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 11).padding(.leading, 41)
                }

                HStack(spacing: 7) {
                    ForEach(workflow.acts) { a in
                        SBActButton(label: promoteLabel(a), kind: a.kind, disabled: a.act == .run && workflow.running) { perform(a.act) }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, 12).padding(.leading, 41)

                if workflow.editing {
                    WorkflowEditor(name: workflow.name, draft: $draftName) { workflow.editing = false }
                        .padding(.top, 12).padding(.leading, 41)
                }

                if let hist = workflow.history {
                    WorkflowHistory(history: hist, onNavigate: onNavigate) { perform(.run) }
                        .padding(.top, 13).padding(.leading, 41)
                }

                if let attn = workflow.attn {
                    Text(attn).font(.splMono(11.5)).foregroundColor(.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 9).padding(.leading, 41)
                }
            }
        }
        .padding(.horizontal, 17).padding(.vertical, 15)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 14)
            .stroke(workflow.promoted ? Color.indigo.opacity(0.5) : Color.edge, lineWidth: 1))
    }

    private func promoteLabel(_ a: WFAct) -> String {
        a.act == .promote ? (workflow.promoted ? "✓ Promoted to routine" : "Promote to routine") : a.label
    }
    private func perform(_ act: WFActType) {
        switch act {
        case .log:  onNavigate(.history)
        case .edit: withAnimation { workflow.editing.toggle() }
        case .promote: withAnimation { workflow.promoted.toggle() }
        case .run:
            // Real run: open the batch wrapp (the actual pipeline engine) — same path the empty state uses.
            // The row's state refreshes honestly from batch-state.json on next load; no simulated "done".
            OSLaunch.launchOr("batch", .init(kind: "workflow")) { onNavigate(.apps) }
        }
    }
}

private struct WorkflowEditor: View {
    let name: String
    @Binding var draft: String
    var onDone: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("EDITING · \(name)").font(.splMono(9.5)).tracking(1.4).foregroundColor(.inkFaint)
            TextField(name, text: $draft)
                .textFieldStyle(.plain)
                .font(.hanken(12.5)).foregroundColor(.ink)
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
            HStack { SBActButton(label: "Done", kind: .pri) { onDone() }; Spacer(minLength: 0) }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 11).fill(Color(red: 0.059, green: 0.067, blue: 0.086)))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.indigo.opacity(0.5), lineWidth: 1))
    }
}

private struct WorkflowHistory: View {
    let history: [WFRun]
    var onNavigate: (Surface) -> Void
    var onRetry: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            Text("RUN HISTORY").font(.splMono(9.5)).tracking(1.4).foregroundColor(.inkFaint)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 13).padding(.vertical, 8)
                .background(Color(red: 0.059, green: 0.067, blue: 0.086))
                .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
            ForEach(Array(history.enumerated()), id: \.element.id) { idx, r in
                WFHistoryRow(run: r, showTop: idx > 0, onNavigate: onNavigate, onRetry: onRetry)
            }
        }
        .background(RoundedRectangle(cornerRadius: 11).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.edgeSoft, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 11))
    }
}

private struct WFHistoryRow: View {
    let run: WFRun
    let showTop: Bool
    var onNavigate: (Surface) -> Void
    var onRetry: () -> Void
    @State private var hover = false
    private var glyph: String { ["ok": "✓", "bad": "✗", "part": "◐"][run.st] ?? "•" }
    private var glyphColor: Color { wfLastColor(run.st) }
    var body: some View {
        HStack(spacing: 11) {
            Text(glyph).font(.splMono(13)).foregroundColor(glyphColor).frame(width: 18)
            Text(run.tm).font(.splMono(11)).foregroundColor(.inkFaint).frame(width: 52, alignment: .leading)
            Text(run.desc).font(.hanken(12.5)).foregroundColor(.inkSec).lineLimit(1)
            Spacer(minLength: 8)
            Button { run.retry ? onRetry() : onNavigate(.history) } label: {
                Text(run.link).font(.hanken(11.5)).foregroundColor(hover ? sbIndigoLite : .indigo)
            }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
        }
        .padding(.horizontal, 13).padding(.vertical, 9)
        .overlay(alignment: .top) { if showTop { Rectangle().fill(Color.edgeSoft).frame(height: 1) } }
    }
}

private struct WFCompactRow: View {
    @Binding var workflow: Workflow
    @State private var hover = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation { workflow.expanded.toggle() } } label: {
                HStack(spacing: 11) {
                    Text("⇉").font(.splMono(13)).foregroundColor(.inkSec)
                        .frame(width: 28, height: 28)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                    Text(workflow.name).font(.hanken(13.5, .semibold)).foregroundColor(.ink)
                    HStack(spacing: 5) {
                        ForEach(0..<workflow.dots, id: \.self) { i in
                            Text("\(i + 1)").font(.splMono(8)).foregroundColor(.inkFaint)
                                .frame(width: 15, height: 15)
                                .background(RoundedRectangle(cornerRadius: 4).fill(Color.raised))
                                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.edge, lineWidth: 1))
                        }
                    }
                    .padding(.leading, 6)
                    Spacer(minLength: 8)
                    Text(workflow.lastLabel).font(.splMono(11)).foregroundColor(wfLastColor(workflow.lastKind))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if workflow.expanded {
                StepChainView(steps: workflow.steps).padding(.top, 12)
                HStack {
                    SBActButton(label: workflow.running ? "Running…" : "Run recipe", kind: .pri, disabled: workflow.running) { run() }
                    Spacer(minLength: 0)
                }
                .padding(.top, 12)
            }
        }
        .padding(.horizontal, 17).padding(.vertical, 14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 14)
            .stroke(hover ? Color.indigo : Color.edge, lineWidth: 1))
        .onHover { hover = $0 }
    }
    private func run() {
        // Real run: open the batch wrapp (no simulated success). State refreshes from batch-state.json.
        OSLaunch.launch("batch", .init(kind: "workflow"))
    }
}

private struct WFChip: View {
    let app: String
    var onTap: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: onTap) {
            Text(app + " ▸").font(.splMono(10.5)).foregroundColor(hover ? sbIndigoLite : .indigo)
                .padding(.horizontal, 9).padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(hover ? Color.indigo : Color.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
