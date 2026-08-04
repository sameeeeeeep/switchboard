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
    var retry: Bool = false
}

private enum DashSample {
    static let tiles: [DashTile] = [
        DashTile(kicker: "Projects",  big: "4", sub: "1 stalled", drill: .bank,      drillLabel: "Bank",
                 spark: DashSpark(bars: false, data: [3,3,4,4,4,4,4], color: .inkDim)),
        DashTile(kicker: "Routines",  big: "3", sub: "active · next 08:00", drill: .routines, drillLabel: "Routines",
                 spark: DashSpark(bars: false, data: [2,3,3,2,3,3,3], color: .inkDim)),
        DashTile(kicker: "Workflows", big: "12", ok: (10, 2), drill: .workflows, drillLabel: "Workflows",
                 spark: DashSpark(bars: true, data: [2,1,3,2,1,2,1], color: .inkDim)),
        DashTile(kicker: "Usage",     big: "4.2M", suffix: " /8M", sub: "tokens · 53% of budget", drill: .history, drillLabel: "History",
                 spark: DashSpark(bars: true, data: [3,5,4,6,5,7,6], color: .lime)),
        DashTile(kicker: "Needs attention", big: "5", sub: "2 blocking", drill: .needs, drillLabel: "Needs", alert: true,
                 spark: DashSpark(bars: false, data: [0,1,1,2,3,4,5], color: .danger)),
    ]

    static let routines: [DashLine] = [
        DashLine(ic: "⟳", icColor: .lime,   name: "Daily brief",         status: "next 08:00",  mark: "✓", markColor: .lime),
        DashLine(ic: "⟳", icColor: .indigo, name: "Email triage",        status: "running…", statusColor: .indigo, mark: "•", markColor: .indigo),
        DashLine(ic: "⟳", icColor: .lime,   name: "IndEur social recap", status: "next Fri",    mark: "✓", markColor: .lime),
        DashLine(ic: "⟳", icColor: .inkFaint, name: "Weekly deck", nameMuted: true, status: "paused"),
    ]

    static let runs: [DashLine] = [
        DashLine(ic: "✓", icColor: .lime,   name: "CopyFlow — launch emails", status: "14:02"),
        DashLine(ic: "✗", icColor: .danger, name: "Sheet sync",               status: "11:40", retry: true),
        DashLine(ic: "✓", icColor: .lime,   name: "Autopilot slate",          status: "09:15"),
        DashLine(ic: "✓", icColor: .lime,   name: "Prism — beam render",      status: "08:41"),
    ]

    static let health: [String] = ["daemon", "cloud model", "3 connectors"]
    static let healthAlert = "Granola connector needs reconnect"

    static let activity: [DashLine] = [
        DashLine(ic: "↻", icColor: .inkFaint, name: "14:22 · Prism image made"),
        DashLine(ic: "⟳", icColor: .inkFaint, name: "08:00 · Daily brief delivered"),
        DashLine(ic: "↻", icColor: .inkFaint, name: "Yesterday · 4 marks generated in Crest"),
    ]
}

struct DashboardSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var range = "7d"

    private let cols = Array(repeating: GridItem(.flexible(), spacing: 14), count: 5)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                SurfaceHead(kicker: "◦ DASHBOARD · ", strong: "EVERYTHING") {
                    SBSegment(items: ["Today", "7d", "30d"], selection: $range)
                }

                LazyVGrid(columns: cols, spacing: 14) {
                    ForEach(DashSample.tiles) { t in DashTileView(tile: t, onNavigate: onNavigate) }
                }
                .padding(.top, 20)

                HStack(alignment: .top, spacing: 14) {
                    DashPane(title: "Routines — running / next fire", moreLabel: "→ Routines",
                             moreSurface: .routines, onNavigate: onNavigate) {
                        DashLineList(rows: DashSample.routines, onNavigate: onNavigate)
                    }
                    DashPane(title: "Recent runs — pass / fail", moreLabel: "→ Workflows",
                             moreSurface: .workflows, onNavigate: onNavigate) {
                        DashLineList(rows: DashSample.runs, onNavigate: onNavigate)
                    }
                }
                .padding(.top, 14)

                HStack(alignment: .top, spacing: 14) {
                    DashPane(title: "Subsystem health", onNavigate: onNavigate) {
                        DashHealth(onNavigate: onNavigate)
                    }
                    DashPane(title: "Activity feed", moreLabel: "→ History",
                             moreSurface: .history, onNavigate: onNavigate) {
                        DashLineList(rows: DashSample.activity, onNavigate: onNavigate)
                    }
                }
                .padding(.top, 14)

                FootNote(text: "dashboard is the state of the machine, not your work · every tile is a door, not a dead number · a red tile always names the action")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
                DashSparkline(spark: tile.spark).frame(height: 30).padding(.top, 10)
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
            if row.retry { DashRetryPill() }
            if let m = row.mark { Text(m).font(.splMono(11)).foregroundColor(row.markColor) }
        }
        .padding(.vertical, 8)
        .overlay(alignment: .top) {
            if showTop { Rectangle().fill(Color.edgeSoft).frame(height: 1) }
        }
    }
}

private struct DashRetryPill: View {
    @State private var busy = false
    @State private var hover = false
    var body: some View {
        Button { busy = true } label: {
            Text(busy ? "Retrying…" : "Retry")
                .font(.splMono(10))
                .foregroundColor(busy ? .inkDim : .lime)
                .padding(.horizontal, 8).padding(.vertical, 1)
                .background(Capsule().fill(busy ? Color.raised : Color.lime.opacity(0.12)))
                .overlay(Capsule().stroke(busy ? Color.edge : Color.lime.opacity(0.4), lineWidth: 1))
                .opacity(busy ? 0.7 : (hover ? 0.85 : 1))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .onHover { hover = $0 }
    }
}

private struct DashHealth: View {
    var onNavigate: (Surface) -> Void
    @State private var fixHover = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 16) {
                ForEach(DashSample.health, id: \.self) { label in
                    HStack(spacing: 7) {
                        Circle().fill(Color.lime).frame(width: 7, height: 7)
                            .shadow(color: Color.lime.opacity(0.5), radius: 3)
                        Text(label).font(.hanken(12.5)).foregroundColor(.inkSec)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 4).padding(.bottom, 8)
            HStack(spacing: 10) {
                Text("◐").font(.splMono(12)).foregroundColor(.danger).frame(width: 16)
                Text(DashSample.healthAlert).font(.hanken(13)).foregroundColor(.inkSec).lineLimit(1)
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
private enum NeedBehavior { case resolve(String); case launch; case route(Surface) }

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
    static let bands: [NeedBand] = [
        NeedBand(id: "blocking", mk: "▲", mkColor: .danger, lb: "Blocking", hint: "act to continue", barColor: .danger, items: [
            NeedItem(id: "n-approve", mk: "⚠", mkColor: .danger,
                     title: [TP(t: "Approve: ", kind: .bold), TP(t: "CopyFlow wants to send 3 launch emails", kind: .normal)],
                     why: "why…",
                     detail: "3 emails were drafted for the IndEur launch and queued by a routine. Approve to send them now, or Deny to hold.",
                     src: "◦ from Routine · IndEur launch",
                     acts: [NeedAct(label: "Approve", tone: .lime, primary: true, behavior: .resolve("Approved")),
                            NeedAct(label: "Deny", behavior: .resolve("Dismissed"))]),
            NeedItem(id: "n-regrant", mk: "⚠", mkColor: .danger,
                     title: [TP(t: "Regrant: ", kind: .bold), TP(t: "Prism lost its model access", kind: .normal)],
                     why: "why…",
                     detail: "Prism's model grant was revoked, so image generation is paused. Regrant opens Prism to restore access.",
                     src: "◦ from Apps · Prism",
                     acts: [NeedAct(label: "Grant", tone: .indigo, primary: true, behavior: .launch),
                            NeedAct(label: "Later", behavior: .resolve("Snoozed"))]),
        ]),
        NeedBand(id: "failed", mk: "●", mkColor: sbAmber, lb: "Failed", hint: "retry or investigate", barColor: sbAmber, items: [
            NeedItem(id: "n-sheet", mk: "✗", mkColor: sbAmber,
                     title: [TP(t: "Routine ", kind: .normal), TP(t: "\"Sheet sync\"", kind: .bold), TP(t: " failed 11:40", kind: .normal)],
                     why: "log…",
                     detail: "11:40 — the auth token expired mid-run. Retry re-runs the routine now; Pause stops the schedule.",
                     src: "◦ from Routines",
                     acts: [NeedAct(label: "Retry", tone: .lime, primary: true, behavior: .resolve("Retrying…")),
                            NeedAct(label: "Pause", behavior: .resolve("Paused"))]),
            NeedItem(id: "n-deck", mk: "✗", mkColor: sbAmber,
                     title: [TP(t: "Workflow ", kind: .normal), TP(t: "\"Launch deck\"", kind: .bold), TP(t: " failed at step 3", kind: .normal)],
                     why: "log…",
                     detail: "Step 3 (export slides) threw a timeout. Retry the step, or Edit opens the workflow to fix it.",
                     src: "◦ from Workflows",
                     acts: [NeedAct(label: "Retry", tone: .lime, primary: true, behavior: .resolve("Retrying…")),
                            NeedAct(label: "Edit", behavior: .route(.workflows))]),
        ]),
        NeedBand(id: "waiting", mk: "○", mkColor: .inkDim, lb: "Waiting", hint: "your call, not blocking", barColor: .edge, items: [
            NeedItem(id: "n-decide", mk: "◆", mkColor: .inkDim,
                     title: [TP(t: "Decide: ", kind: .bold), TP(t: "pick a launch date for IndEur Club ", kind: .normal), TP(t: "(a / b / c)", kind: .muted)],
                     why: "options…",
                     detail: "a) Sep 12 · b) Sep 19 · c) Sep 26 — ideabrain has the reasoning for each. Decide opens it.",
                     src: "◦ from ideabrain",
                     acts: [NeedAct(label: "Decide", tone: .indigo, primary: true, behavior: .launch)]),
            NeedItem(id: "n-venue", mk: "☐", mkColor: .inkDim,
                     title: [TP(t: "Overdue: ", kind: .bold), TP(t: "Reply to the venue email ", kind: .normal), TP(t: "(2 days)", kind: .muted)],
                     src: "◦ from Tasks · #indeur",
                     acts: [NeedAct(label: "Open", behavior: .route(.tasks)),
                            NeedAct(label: "Snooze", behavior: .resolve("Snoozed"))]),
            NeedItem(id: "n-review", mk: "▭", mkColor: .inkDim,
                     title: [TP(t: "Review: ", kind: .bold), TP(t: "4 marks from the Crest batch", kind: .normal)],
                     why: "preview…",
                     detail: "4 new marks are awaiting review in the Crest batch. Review opens Crest to approve or send back.",
                     src: "◦ from Crest",
                     acts: [NeedAct(label: "Review", tone: .lime, primary: true, behavior: .launch)]),
        ]),
    ]

    static let filterOrder = ["all", "blocking", "failed", "waiting"]
    static let filterLabel: [String: String] = ["all": "All", "blocking": "Blocking", "failed": "Failed", "waiting": "Waiting"]
}

struct NeedsSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var resolved: Set<String> = []
    @State private var whyOpen: Set<String> = []
    @State private var filter = "all"

    private var total: Int {
        NeedSample.bands.reduce(0) { $0 + $1.items.filter { !resolved.contains($0.id) }.count }
    }
    private var shownBands: [NeedBand] {
        NeedSample.bands
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

                FootNote(text: "the action inbox · blocking first, then failures, then your call · every item is what · why · one action · dismiss is undoable")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
        case .resolve:
            withAnimation(.easeInOut(duration: 0.28)) { _ = resolved.insert(item.id) }
        case .launch:
            onNavigate(.apps)                    // TODO real launch — open the named tool
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

private enum RoutineSample {
    static let list: [Routine] = [
        Routine(id: "daily-brief", name: "Daily brief", register: .active, pillLabel: "active", dot: .lime,
                sched: [
                    [Seg(t: "⏱ ", kind: .dim), Seg(t: "every day 08:00", kind: .strong)],
                    [Seg(t: "last ", kind: .dim), Seg(t: "✓ today 08:00", kind: .ok)],
                    [Seg(t: "next ", kind: .dim), Seg(t: "tomorrow 08:00", kind: .strong), Seg(t: " · in 11h", kind: .dim)],
                ],
                outsPrefix: "outputs: ", outsLink: "5 briefs", outsSuffix: " · latest \"Tue market + inbox digest\"",
                grant: [GrantChip(glyph: "⛁", text: "sb_http", ungranted: false),
                        GrantChip(glyph: "✎", text: "Bank write", ungranted: false)],
                acts: [RAct(label: "Run now", kind: .pri, act: .run),
                       RAct(label: "Pause", kind: .plain, act: .pause),
                       RAct(label: "Edit", kind: .plain, act: .edit)]),
        Routine(id: "email-triage", name: "Email triage", register: .running, pillLabel: "running…", dot: .indigo,
                sched: [
                    [Seg(t: "⏱ ", kind: .dim), Seg(t: "on new mail", kind: .strong)],
                    [Seg(t: "running since ", kind: .dim), Seg(t: "14:20", kind: .strong), Seg(t: " · step 2 of 3", kind: .dim)],
                    [Seg(t: "last ", kind: .dim), Seg(t: "✓ 12:05", kind: .ok)],
                ],
                outsPlain: "grant holds ActionConsent per outbound send — each reply is gated",
                grant: [GrantChip(glyph: "✉", text: "email connector", ungranted: false),
                        GrantChip(glyph: "⛊", text: "ActionConsent / send", ungranted: false)],
                acts: [RAct(label: "Open log", kind: .plain, act: .log),
                       RAct(label: "Pause", kind: .plain, act: .pause)]),
        Routine(id: "invoice-filer", name: "Invoice filer", register: .waiting, pillLabel: "waiting for you", dot: sbAmber,
                sched: [
                    [Seg(t: "⏱ ", kind: .dim), Seg(t: "on receipt email", kind: .strong)],
                    [Seg(t: "held ", kind: .dim), Seg(t: "since 10:14", kind: .strong)],
                    [Seg(t: "needs a consent it can't get unattended", kind: .dim)],
                ],
                attn: "◐ waiting → grant needed: Drive write (folder /Receipts) · holds, does not proceed",
                grant: [GrantChip(glyph: "⛁", text: "email read", ungranted: false),
                        GrantChip(glyph: "?", text: "Drive write — ungranted", ungranted: true)],
                acts: [RAct(label: "Grant & continue", kind: .pri, act: .grant),
                       RAct(label: "Open log", kind: .plain, act: .log)]),
        Routine(id: "weekly-deck", name: "Weekly deck", register: .failed, pillLabel: "paused · 3 fails", dot: .danger,
                sched: [
                    [Seg(t: "⏱ ", kind: .dim), Seg(t: "Mondays 09:00", kind: .strong)],
                    [Seg(t: "last ", kind: .dim), Seg(t: "✗ step 2 (Prism: no model)", kind: .bad)],
                    [Seg(t: "auto-paused after 3 consecutive fails", kind: .dim)],
                ],
                attn: "✗ escalated to Needs attention · Retry / Edit / Resolve the model requirement",
                grant: [GrantChip(glyph: "▥", text: "Prism", ungranted: false),
                        GrantChip(glyph: "✎", text: "Bank write", ungranted: false)],
                acts: [RAct(label: "Resume", kind: .pri, act: .resume),
                       RAct(label: "Edit", kind: .plain, act: .edit),
                       RAct(label: "Revoke", kind: .warn, act: .revoke)]),
    ]
}

struct RoutinesSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var routines = RoutineSample.list
    @State private var filter = "All"

    private var activeCount: Int { routines.filter { regGroup($0.register) == "active" }.count }

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

                VStack(spacing: 12) {
                    ForEach($routines) { $r in
                        if shows(r) {
                            RoutineRowView(routine: $r, onNavigate: onNavigate)
                        }
                    }
                }
                .padding(.top, 18)

                RoutineCreateCTA(onNavigate: onNavigate).padding(.top, 16)

                FootNote(text: "the automation monitor · failures escalate to Needs attention · each row shows only the actions that make sense in its state")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
        Button { onNavigate(.workflows) } label: {
            HStack(spacing: 12) {
                Text("+").font(.hanken(15)).foregroundColor(.lime)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                (Text("Create a routine").font(.hanken(13, .medium)).foregroundColor(.inkSec)
                    + Text(" — record a flow (CopyFlow) or promote an autopilot. Start from a template: ").font(.hanken(13)).foregroundColor(.inkDim)
                    + Text("Daily brief · Email triage · Weekly report").font(.hanken(13)).foregroundColor(.inkSec))
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

private struct RecentRun: Identifiable {
    let id = UUID(); let wf: String; let st: String; let tm: String; let desc: String; let app: String
}

private enum WorkflowSample {
    static let list: [Workflow] = [
        Workflow(id: "launch-day", name: "Launch-day pipeline", lastKind: "bad", lastLabel: "✗ failed at ③",
                 steps: [WFStep(no: 1, t: "fetch signals", state: "done"),
                         WFStep(no: 2, t: "draft copy", state: "done"),
                         WFStep(no: 3, t: "Prism hero", state: "fail"),
                         WFStep(no: 4, t: "assemble deck", state: "skip")],
                 inputs: "inputs: project = Acme · tone = bold · channels = X, LinkedIn",
                 acts: [WFAct(label: "Run now", kind: .pri, act: .run),
                        WFAct(label: "Edit", kind: .plain, act: .edit),
                        WFAct(label: "Promote to routine", kind: .plain, act: .promote)],
                 history: [WFRun(st: "bad", tm: "11:40", desc: "failed at ③ — Prism: no model · steps ①② kept", link: "Retry from ③ ▸", retry: true),
                           WFRun(st: "ok", tm: "09:15", desc: "full · 4 artifacts written to Bank", link: "Open log", retry: false),
                           WFRun(st: "part", tm: "08:02", desc: "partial — ③④ skipped (no hero requested)", link: "Open log", retry: false)],
                 attn: "✗ posted to Needs attention · Retry-from-③ reuses ①② — never re-pays for completed steps"),
        Workflow(id: "weekly-report", name: "Weekly report", lastKind: "part", lastLabel: "◐ running · step 2 of 3",
                 steps: [WFStep(no: 1, t: "pull metrics", state: "done"),
                         WFStep(no: 2, t: "summarize", state: "run"),
                         WFStep(no: 3, t: "post to Bank", state: "")],
                 inputs: "inputs: window = last 7d · project = IndEur Club",
                 acts: [WFAct(label: "Open log", kind: .plain, act: .log),
                        WFAct(label: "Edit", kind: .plain, act: .edit)]),
        Workflow(id: "vendor-sync", name: "Vendor sync", lastKind: "neu", lastLabel: "not run yet",
                 steps: [WFStep(no: 1, t: "scrape quotes", state: ""),
                         WFStep(no: 2, t: "normalize", state: ""),
                         WFStep(no: 3, t: "update canvas", state: "")],
                 inputs: "inputs: source = Alibaba · list = nailinit vendors — composing is available before first run",
                 acts: [WFAct(label: "Run now", kind: .pri, act: .run),
                        WFAct(label: "Edit", kind: .plain, act: .edit)]),
        Workflow(id: "content-batch", name: "Content batch", lastKind: "ok", lastLabel: "✓ full · yesterday 17:22",
                 steps: [WFStep(no: 1, t: "gather sources", state: "done"),
                         WFStep(no: 2, t: "draft posts", state: "done"),
                         WFStep(no: 3, t: "queue schedule", state: "done")],
                 compact: true, dots: 5),
    ]

    static let recent: [RecentRun] = [
        RecentRun(wf: "Launch-day pipeline", st: "bad", tm: "today 11:40", desc: "failed at ③ — Prism: no model · steps ①② kept", app: "Prism"),
        RecentRun(wf: "Weekly report", st: "part", tm: "today 10:05", desc: "running · summarizing metrics (step 2 of 3)", app: "Bank"),
        RecentRun(wf: "Launch-day pipeline", st: "ok", tm: "today 09:15", desc: "full · 4 artifacts written to Bank", app: "Bank"),
        RecentRun(wf: "Content batch", st: "ok", tm: "yesterday 17:22", desc: "full · 5 posts drafted", app: "brandbrain"),
        RecentRun(wf: "Launch-day pipeline", st: "part", tm: "yesterday 08:02", desc: "partial · ③④ skipped (no hero requested)", app: "AdForge"),
    ]
}

struct WorkflowsSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }
    @State private var workflows = WorkflowSample.list
    @State private var tab = "recipes"

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

                HStack(spacing: 6) {
                    WFTab(label: "Recipes", count: workflows.count, active: tab == "recipes") { tab = "recipes" }
                    WFTab(label: "Recent runs", count: WorkflowSample.recent.count, active: tab == "runs") { tab = "runs" }
                }
                .padding(.top, 16).padding(.bottom, 16)

                if tab == "recipes" {
                    VStack(spacing: 12) {
                        ForEach($workflows) { $w in
                            if w.compact {
                                WFCompactRow(workflow: $w)
                            } else {
                                WorkflowRowView(workflow: $w, onNavigate: onNavigate)
                            }
                        }
                    }
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(WorkflowSample.recent.enumerated()), id: \.element.id) { idx, r in
                            RecentRunRow(run: r, showTop: idx > 0, onNavigate: onNavigate)
                        }
                    }
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.edgeSoft, lineWidth: 1))
                }

                FootNote(text: "a workflow chains steps into one reusable recipe · a partial run never masquerades as ✓ · add a schedule + grant to promote it to a routine")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct WFTab: View {
    let label: String
    let count: Int
    let active: Bool
    var onTap: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 7) {
                Text(label).font(.splMono(11)).tracking(0.5)
                    .foregroundColor(active ? .ink : (hover ? .inkSec : .inkDim))
                Text("\(count)").font(.splMono(10)).foregroundColor(active ? .inkSec : .inkFaint)
                    .padding(.horizontal, 6)
                    .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
            }
            .padding(.horizontal, 13).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 9)
                .fill(active ? Color.indigo.opacity(0.16) : Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 9)
                .stroke(active ? Color.indigo : (hover ? Color.indigo.opacity(0.5) : Color.edge), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
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
            guard !workflow.running else { return }
            withAnimation { workflow.running = true; workflow.lastKind = "part"; workflow.lastLabel = "◐ running…" }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.95) {
                withAnimation { workflow.running = false; workflow.lastKind = "ok"; workflow.lastLabel = "✓ done · just now" }
            }
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
        guard !workflow.running else { return }
        withAnimation { workflow.running = true; workflow.lastKind = "part"; workflow.lastLabel = "◐ running…" }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.95) {
            withAnimation { workflow.running = false; workflow.lastKind = "ok"; workflow.lastLabel = "✓ done · just now" }
        }
    }
}

private struct RecentRunRow: View {
    let run: RecentRun
    let showTop: Bool
    var onNavigate: (Surface) -> Void
    @State private var rowHover = false
    private var glyph: String { ["ok": "✓", "bad": "✗", "part": "◐"][run.st] ?? "•" }
    var body: some View {
        HStack(spacing: 11) {
            Button { onNavigate(.history) } label: {
                HStack(spacing: 11) {
                    Text(glyph).font(.splMono(13)).foregroundColor(wfLastColor(run.st)).frame(width: 18)
                    Text(run.tm).font(.splMono(11)).foregroundColor(.inkFaint).frame(minWidth: 96, alignment: .leading)
                    Text(run.wf).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
                    Text(run.desc).font(.hanken(12.5)).foregroundColor(.inkSec).lineLimit(1)
                    Spacer(minLength: 8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            WFChip(app: run.app) { onNavigate(.apps) }   // TODO real launch — open the tool the step used
        }
        .padding(.horizontal, 13).padding(.vertical, 10)
        .background(rowHover ? Color.raised : .clear)
        .overlay(alignment: .top) { if showTop { Rectangle().fill(Color.edgeSoft).frame(height: 1) } }
        .onHover { rowHover = $0 }
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
