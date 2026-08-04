// OSSurfaceWorkspace.swift — three native Switchboard OS surfaces ported from the web shell.
//
// TasksSurface, CalendarSurface, BankSurface. Each mirrors the markup + SAMPLE data of its web module
// (examples/apps/src/os/surfaces/{tasks,calendar,bank}.js) and matches the idioms of OSShellView.swift
// (IsoTile, SectionHead, the Color/Font tokens, ScrollView shape). No dead ends: cross-surface controls
// call onNavigate(...); "open a tool / artifact" routes to .apps (native wrapp-launch isn't wired yet);
// local controls (Board/List, column filter, calendar tabs, Bank facets) drive real @State that swaps
// the visible content.
//
// Only shared theme API is USED, never redefined: Color tokens (.page/.rail/.panel/.raised/.edge/
// .edgeSoft/.ink/.inkSec/.inkDim/.inkFaint/.lime/.indigo/.ok/.danger), Font.hanken/.splMono, IsoTile,
// hueForId/colorForId, SectionHead/ProgressBar, the Surface enum and Sample data.

import SwiftUI

// =====================================================================================================
// MARK: - Small shared local helpers (private to this file)
// =====================================================================================================

/// A content-color from a hex string (swatches / artifact thumbs). Chrome stays token-colored; this is
/// only ever used for "content color" the way the web modules use literal hexes.
private func hexColor(_ hex: String) -> Color {
    let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    let v = UInt64(s, radix: 16) ?? 0
    return Color(red: Double((v >> 16) & 0xFF) / 255.0,
                 green: Double((v >> 8) & 0xFF) / 255.0,
                 blue: Double(v & 0xFF) / 255.0)
}

/// Amber (there is no .amber token) — used for the "in progress" hint dot.
private let sbAmber = Color(red: 0.96, green: 0.62, blue: 0.04)

/// A surface header kicker: "◦ TASKS · IndEur Club".
private struct SurfaceKicker: View {
    let title: String
    let project: String
    var body: some View {
        (Text("◦ " + title.uppercased() + " · ").foregroundColor(.inkDim)
            + Text(project).foregroundColor(.ink))
            .font(.splMono(11)).tracking(0.6)
    }
}

/// An indigo "All projects ▾" style scope pill (cross-surface link).
private struct ScopePill: View {
    let label: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(label).font(.hanken(11.5))
                .foregroundColor(.indigo)
                .padding(.horizontal, 10).padding(.vertical, 3)
                .background(Capsule().fill(Color.indigo.opacity(0.14)))
                .overlay(Capsule().stroke(Color.indigo.opacity(hover ? 0.6 : 0.35), lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// One segment in a Board/List or Month/Week/Agenda control.
private struct SegButton: View {
    let label: String
    let active: Bool
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.hanken(12, active ? .semibold : .regular))
                .foregroundColor(active ? .ink : (hover ? .inkSec : .inkDim))
                .padding(.horizontal, 11).padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 7).fill(active ? Color.raised : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// A segmented control frame (panel + edge) hosting SegButtons.
private struct SegBar<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        HStack(spacing: 2) { content }
            .padding(2)
            .background(RoundedRectangle(cornerRadius: 9).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.edge, lineWidth: 1))
    }
}

/// A neutral bordered text button (e.g. "Group: Status ▾").
private struct OSWSGhostButton: View {
    let label: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(label).font(.hanken(12)).foregroundColor(.inkSec)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(hover ? Color.inkFaint : Color.edge, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// The lime CTA ("+ Add", "Bank it", "Establish").
private struct LimeButton: View {
    let label: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(label).font(.hanken(12.5, .semibold))
                .foregroundColor(Color(red: 0x0b / 255, green: 0x0c / 255, blue: 0x10 / 255))
                .padding(.horizontal, 13).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.lime.opacity(hover ? 0.92 : 1.0)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// A footer note in the spare mono voice the surfaces share.
private struct SurfaceFoot: View {
    let text: String
    var body: some View {
        Text(text).font(.splMono(10.5)).foregroundColor(.inkFaint)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 34)
    }
}

// =====================================================================================================
// MARK: - TasksSurface — the one lens on tasks.md (board / list, column filter, grouping, done toggle)
// =====================================================================================================

private enum TaskView { case board, list }
private enum GroupMode: String { case status = "Status", project = "Project", due = "Due" }

private struct TaskItem: Identifiable {
    let id = UUID()
    let title: String
    var tag: String? = nil
    var swHex: String? = nil
    var proj: String? = nil
    var prog: Bool = false
    var wait: String? = nil
    var due: String? = nil
    var over: Bool = false
    // status context (so a flat list row still knows its column)
    let statusId: String
    let statusName: String
    let colIndex: Int

    var dueWeight: Int { over ? 0 : (due != nil ? 1 : 2) }
    var groupKey: String { tag ?? proj ?? "~" }
    var opensApp: Bool { tag != nil }                          // @wrapp → launch that wrapp; else → Bank
    var appName: String { (tag ?? "").replacingOccurrences(of: "@", with: "") }
}

private struct TaskColumn: Identifiable {
    let id: String
    let name: String
    let dot: Color
    let tasks: [TaskItem]
}

private let TASK_COLUMNS: [TaskColumn] = [
    TaskColumn(id: "todo", name: "Todo", dot: .inkDim, tasks: [
        TaskItem(title: "Finalize IndEur wordmark", tag: "@crest", swHex: "E0764A", due: "Fri",
                 statusId: "todo", statusName: "Todo", colIndex: 0),
        TaskItem(title: "Write the launch announcement", tag: "@brandbrain", swHex: "E8B04A",
                 statusId: "todo", statusName: "Todo", colIndex: 0),
        TaskItem(title: "Reply to the venue email", proj: "#indeur", due: "2d overdue", over: true,
                 statusId: "todo", statusName: "Todo", colIndex: 0),
        TaskItem(title: "Pick the meetup date", tag: "@flow", swHex: "A8D84A",
                 statusId: "todo", statusName: "Todo", colIndex: 0),
    ]),
    TaskColumn(id: "doing", name: "Doing", dot: .lime, tasks: [
        TaskItem(title: "Render the terracotta beam", tag: "@prism", swHex: "9B5DE5", prog: true, due: "today",
                 statusId: "doing", statusName: "Doing", colIndex: 1),
        TaskItem(title: "Launch ad variations — \"Find your people\"", tag: "@adforge", swHex: "F2994A", prog: true,
                 statusId: "doing", statusName: "Doing", colIndex: 1),
    ]),
    TaskColumn(id: "blocked", name: "Blocked", dot: .danger, tasks: [
        TaskItem(title: "Legal OK on the club name", proj: "#indeur", wait: "waiting: counsel",
                 statusId: "blocked", statusName: "Blocked", colIndex: 2),
    ]),
]

private let TASK_FLAT: [TaskItem] = TASK_COLUMNS.flatMap { $0.tasks }
private let TASK_DONE_COUNT = 12

struct TasksSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var view: TaskView = .board
    @State private var activeFilter: String? = nil            // status id, or nil = all
    @State private var groupMode: GroupMode = .status
    @State private var doneIDs: Set<UUID> = []

    private var sortedRows: [TaskItem] {
        TASK_FLAT.sorted { a, b in
            switch groupMode {
            case .status:  return a.colIndex < b.colIndex
            case .due:     return a.dueWeight < b.dueWeight
            case .project: return a.groupKey.localizedCaseInsensitiveCompare(b.groupKey) == .orderedAscending
            }
        }
    }

    private func toggleFilter(_ id: String) { activeFilter = (activeFilter == id) ? nil : id }
    private func cycleGroup() {
        groupMode = groupMode == .status ? .project : (groupMode == .project ? .due : .status)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if view == .board { board.padding(.top, 20) }
                else { list.padding(.top, 20) }
                SurfaceFoot(text: "tasks is the one lens on tasks.md · a card is a line in a file · status = a token you can drag · nothing here is invented")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            SurfaceKicker(title: "Tasks", project: Sample.project.name)
            ScopePill(label: "All projects ▾") { onNavigate(.dashboard) }   // view across all projects
            Spacer(minLength: 0)
            SegBar {
                SegButton(label: "Board", active: view == .board) { view = .board }
                SegButton(label: "List", active: view == .list) { view = .list }
            }
            OSWSGhostButton(label: "Group: \(groupMode.rawValue) ▾") { cycleGroup() }
            LimeButton(label: "+ Add") { onNavigate(.bank) }               // add a line to tasks.md in Bank
        }
        .padding(.bottom, 14)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
    }

    private var board: some View {
        HStack(alignment: .top, spacing: 14) {
            ForEach(TASK_COLUMNS) { col in
                TaskColumnView(
                    column: col,
                    dimmed: activeFilter != nil && activeFilter != col.id,
                    selected: activeFilter == col.id,
                    doneIDs: $doneIDs,
                    onHeader: { toggleFilter(col.id) },
                    onNavigate: onNavigate)
                .frame(maxWidth: .infinity, alignment: .top)
            }
            DoneColumn(count: TASK_DONE_COUNT) { onNavigate(.history) }     // completed tasks live in History
                .frame(width: 132)
        }
    }

    private var list: some View {
        VStack(spacing: 0) {
            ForEach(sortedRows.filter { activeFilter == nil || $0.statusId == activeFilter }) { item in
                TaskListRow(item: item, dot: dotFor(item.statusId),
                            checked: doneIDs.contains(item.id),
                            onToggle: { toggle(item.id) },
                            onNavigate: onNavigate)
            }
        }
    }

    private func dotFor(_ id: String) -> Color {
        TASK_COLUMNS.first { $0.id == id }?.dot ?? .inkFaint
    }
    private func toggle(_ id: UUID) {
        if doneIDs.contains(id) { doneIDs.remove(id) } else { doneIDs.insert(id) }
    }
}

private struct TaskColumnView: View {
    let column: TaskColumn
    let dimmed: Bool
    let selected: Bool
    @Binding var doneIDs: Set<UUID>
    let onHeader: () -> Void
    let onNavigate: (Surface) -> Void
    @State private var headHover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onHeader) {
                HStack(spacing: 8) {
                    Circle().fill(column.dot).frame(width: 7, height: 7)
                    Text(column.name).font(.hanken(12, .semibold))
                        .foregroundColor(selected ? .ink : .inkSec)
                    Text("\(column.tasks.count)").font(.splMono(10)).foregroundColor(.inkFaint)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 6).padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 8).fill(headHover ? Color.panel : .clear))
                .overlay(RoundedRectangle(cornerRadius: 8)
                    .stroke(selected ? Color.lime : (headHover ? Color.edge : .clear), lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { headHover = $0 }

            ForEach(column.tasks) { t in
                TaskCardView(task: t, checked: doneIDs.contains(t.id),
                             onToggle: { toggle(t.id) }, onNavigate: onNavigate)
            }

            AddCardRow { onNavigate(.bank) }                                // add a line to tasks.md in Bank
        }
        .opacity(dimmed ? 0.4 : 1.0)
    }

    private func toggle(_ id: UUID) {
        if doneIDs.contains(id) { doneIDs.remove(id) } else { doneIDs.insert(id) }
    }
}

private struct TaskCheckbox: View {
    let checked: Bool
    let onToggle: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: onToggle) {
            RoundedRectangle(cornerRadius: 4)
                .fill(checked ? Color.lime : .clear)
                .frame(width: 15, height: 15)
                .overlay(RoundedRectangle(cornerRadius: 4)
                    .stroke(checked ? Color.lime : (hover ? Color.lime : Color.inkFaint), lineWidth: 1.5))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct TaskCardView: View {
    let task: TaskItem
    let checked: Bool
    let onToggle: () -> Void
    let onNavigate: (Surface) -> Void
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 9) {
                TaskCheckbox(checked: checked, onToggle: onToggle)         // checking does NOT launch the wrapp
                Text(task.title)
                    .font(.hanken(13))
                    .foregroundColor(checked ? .inkFaint : .ink)
                    .strikethrough(checked, color: .inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            TaskRowBits(task: task)
        }
        .padding(.horizontal, 12).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(hover ? Color.raised : Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(hover ? Color.inkFaint : Color.edge, lineWidth: 1))
        .overlay(alignment: .leading) {
            if task.wait != nil { Rectangle().fill(Color.danger).frame(width: 2).clipShape(RoundedRectangle(cornerRadius: 12)) }
        }
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .onTapGesture { open() }                                            // opens wrapp, or Bank
    }

    private func open() {
        // TODO real launch — route to Apps so a tagged task isn't a dead end (Bank if untagged).
        onNavigate(task.opensApp ? .apps : .bank)
    }
}

private struct TaskRowBits: View {
    let task: TaskItem
    var body: some View {
        HStack(spacing: 7) {
            if let tag = task.tag {
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(hexColor(task.swHex ?? "3a3f4b")).frame(width: 8, height: 8)
                    Text(tag).font(.splMono(10)).foregroundColor(.inkDim)
                }
                .padding(.horizontal, 7).padding(.vertical, 1)
                .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
            }
            if let proj = task.proj {
                Text(proj).font(.splMono(10)).foregroundColor(.inkFaint)
            }
            if task.prog {
                Circle().fill(sbAmber).frame(width: 8, height: 8)          // in progress
            }
            if let wait = task.wait {
                Text(wait).font(.splMono(10)).foregroundColor(.danger)
                    .padding(.horizontal, 7).padding(.vertical, 1)
                    .overlay(Capsule().stroke(Color.danger.opacity(0.5), lineWidth: 1))
            }
            Spacer(minLength: 0)
            if let due = task.due { DueChip(text: due, over: task.over) }
        }
    }
}

private struct DueChip: View {
    let text: String
    let over: Bool
    var body: some View {
        Text(text).font(.splMono(10))
            .foregroundColor(over ? Color(red: 0x0b / 255, green: 0x0c / 255, blue: 0x10 / 255) : .inkDim)
            .padding(.horizontal, 7).padding(.vertical, 1)
            .background(Capsule().fill(over ? Color.lime : .clear))
            .overlay(Capsule().stroke(over ? Color.lime : Color.edge, lineWidth: 1))
    }
}

private struct AddCardRow: View {
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text("+ add a task…").font(.hanken(12))
                .foregroundColor(hover ? .inkDim : .inkFaint)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12)
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .foregroundColor(hover ? .inkFaint : .edge))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct DoneColumn: View {
    let count: Int
    let onOpen: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: onOpen) {
            VStack(spacing: 4) {
                Text("\(count)").font(.splMono(22)).foregroundColor(.inkDim)
                Text("Done ▾").font(.hanken(12)).foregroundColor(hover ? .inkDim : .inkFaint)
                Text("this week").font(.hanken(11)).foregroundColor(.inkFaint)
            }
            .padding(.horizontal, 12).padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 12)
                .fill(LinearGradient(colors: [Color(red: 0x10 / 255, green: 0x12 / 255, blue: 0x18 / 255),
                                              Color(red: 0x0d / 255, green: 0x0e / 255, blue: 0x13 / 255)],
                                     startPoint: .top, endPoint: .bottom)))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .foregroundColor(hover ? .inkFaint : .edge))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .padding(.top, 30)   // aligns under the column bodies, past their headers
    }
}

private struct TaskListRow: View {
    let item: TaskItem
    let dot: Color
    let checked: Bool
    let onToggle: () -> Void
    let onNavigate: (Surface) -> Void
    @State private var hover = false

    var body: some View {
        HStack(spacing: 11) {
            TaskCheckbox(checked: checked, onToggle: onToggle)
            Circle().fill(dot).frame(width: 7, height: 7)
            Text(item.title).font(.hanken(13))
                .foregroundColor(checked ? .inkFaint : .ink)
                .strikethrough(checked, color: .inkFaint)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(item.statusName).font(.splMono(10)).foregroundColor(.inkFaint)
            if let due = item.due { DueChip(text: due, over: item.over) }
        }
        .padding(.horizontal, 4).padding(.vertical, 9)
        .background(hover ? Color.panel : .clear)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .onTapGesture { onNavigate(item.opensApp ? .apps : .bank) }         // TODO real launch
    }
}

// =====================================================================================================
// MARK: - CalendarSurface — a temporal projection of the vault (Month / Week / Agenda; prev/today/next)
// =====================================================================================================

private struct CalEvent: Identifiable {
    let id = UUID()
    let cls: String        // task | over | mil | run | rou
    let glyph: String
    let title: String
    var app: String? = nil // wrapp-referencing chip → launch it; else → Tasks
}

private let CAL_ITEMS: [Int: [CalEvent]] = [
    3: [CalEvent(cls: "rou", glyph: "⟳", title: "Daily brief", app: "Autopilot")],
    4: [CalEvent(cls: "over", glyph: "●", title: "Reply venue email"),
        CalEvent(cls: "run", glyph: "↻", title: "Prism render", app: "Prism")],
    5: [CalEvent(cls: "task", glyph: "●", title: "Render beam @prism", app: "Prism"),
        CalEvent(cls: "rou", glyph: "⟳", title: "Daily brief", app: "Autopilot")],
    7: [CalEvent(cls: "over", glyph: "●", title: "Finalize wordmark", app: "brandbrain"),
        CalEvent(cls: "task", glyph: "●", title: "Ad variations", app: "AdForge")],
    11: [CalEvent(cls: "mil", glyph: "■", title: "Brand pack v1")],
    12: [CalEvent(cls: "task", glyph: "●", title: "Pick meetup date")],
    14: [CalEvent(cls: "run", glyph: "↻", title: "CopyFlow run"),
         CalEvent(cls: "task", glyph: "●", title: "Launch post")],
    18: [CalEvent(cls: "task", glyph: "●", title: "Legal sign-off"),
         CalEvent(cls: "task", glyph: "●", title: "Venue deposit"),
         CalEvent(cls: "task", glyph: "●", title: "Guest list"),
         CalEvent(cls: "run", glyph: "↻", title: "sync")],
    21: [CalEvent(cls: "mil", glyph: "■", title: "Launch — IndEur Club")],
    26: [CalEvent(cls: "task", glyph: "●", title: "Post-launch recap")],
]

private let CAL_LEAD = [27, 28, 29, 30, 31]
private let CAL_DAYS = 31
private let CAL_TODAY = 4
private let CAL_MONTHS = ["April 2026", "May 2026", "June 2026", "July 2026", "August 2026",
                         "September 2026", "October 2026", "November 2026"]
private let CAL_HOME_MONTH = 4   // "August 2026"
private let DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
private func dowFor(_ d: Int) -> String { DOW[((5 + (d - 1)) % 7 + 7) % 7] }   // Aug 1 2026 = Saturday

private enum CalView { case month, week, agenda }

private struct CalCellModel: Identifiable {
    let id = UUID()
    let day: Int
    let dim: Bool
}

struct CalendarSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var view: CalView = .month
    @State private var monthIdx = CAL_HOME_MONTH

    private var cells: [CalCellModel] {
        var out: [CalCellModel] = CAL_LEAD.map { CalCellModel(day: $0, dim: true) }
        for d in 1...CAL_DAYS { out.append(CalCellModel(day: d, dim: false)) }
        var tail = 1
        while out.count % 7 != 0 { out.append(CalCellModel(day: tail, dim: true)); tail += 1 }
        return out
    }

    private let grid = Array(repeating: GridItem(.flexible(), spacing: 8), count: 7)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                legend.padding(.top, 16)
                Group {
                    switch view {
                    case .month:  monthView
                    case .week:   weekView
                    case .agenda: agendaView
                    }
                }
                .padding(.top, 12)
                SurfaceFoot(text: "calendar is a temporal projection of the vault · it invents no events · the past is dim, not gone")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            (Text("◦ ").foregroundColor(.inkDim)
                + Text(CAL_MONTHS[monthIdx]).foregroundColor(.inkDim)
                + Text(" · ").foregroundColor(.inkDim)
                + Text(Sample.project.name).foregroundColor(.ink))
                .font(.splMono(11)).tracking(0.6)
            ScopePill(label: "All projects ▾") { onNavigate(.bank) }         // switch project (Bank)
            Spacer(minLength: 0)
            SegBar {
                SegButton(label: "Month", active: view == .month) { view = .month }
                SegButton(label: "Week", active: view == .week) { view = .week }
                SegButton(label: "Agenda", active: view == .agenda) { view = .agenda }
            }
            SegBar {
                SegButton(label: "‹", active: false) { monthIdx = max(0, monthIdx - 1) }
                SegButton(label: "Today", active: true) { monthIdx = CAL_HOME_MONTH }
                SegButton(label: "›", active: false) { monthIdx = min(CAL_MONTHS.count - 1, monthIdx + 1) }
            }
        }
        .padding(.bottom, 14)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
    }

    private var legend: some View {
        HStack(spacing: 16) {
            LegendItem(glyph: "●", color: .lime, label: "due task", strong: true)
            LegendItem(glyph: "■", color: .indigo, label: "milestone", strong: true)
            LegendItem(glyph: "↻", color: .inkFaint, label: "past run", strong: false)
            LegendItem(glyph: "⟳", color: .inkFaint, label: "routine", strong: false)
        }
    }

    private var monthView: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: grid, spacing: 8) {
                ForEach(DOW, id: \.self) { d in
                    Text(d.uppercased()).font(.splMono(9.5)).tracking(1.2).foregroundColor(.inkFaint)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            LazyVGrid(columns: grid, spacing: 8) {
                ForEach(cells) { cell in
                    CalCell(cell: cell, events: cell.dim ? [] : (CAL_ITEMS[cell.day] ?? []),
                            isToday: !cell.dim && cell.day == CAL_TODAY, onNavigate: onNavigate)
                }
            }
        }
    }

    private var weekView: some View {
        LazyVGrid(columns: grid, spacing: 8) {
            ForEach([3, 4, 5, 6, 7, 8, 9], id: \.self) { d in
                WeekCol(day: d, events: CAL_ITEMS[d] ?? [], isToday: d == CAL_TODAY, onNavigate: onNavigate)
            }
        }
    }

    private var agendaView: some View {
        VStack(spacing: 0) {
            ForEach(CAL_ITEMS.keys.sorted(), id: \.self) { d in
                AgendaRow(day: d, events: CAL_ITEMS[d] ?? [], isToday: d == CAL_TODAY, onNavigate: onNavigate)
            }
        }
        .frame(maxWidth: 640, alignment: .leading)
    }
}

private struct LegendItem: View {
    let glyph: String; let color: Color; let label: String; let strong: Bool
    var body: some View {
        HStack(spacing: 6) {
            Text(glyph).font(.splMono(10)).foregroundColor(color)
            Text(label).font(.splMono(10.5)).foregroundColor(strong ? .inkSec : .inkDim)
        }
    }
}

/// Chip colors by class (task/over/mil/run/rou), from the web module's rules.
private func chipTextColor(_ cls: String) -> Color {
    switch cls {
    case "over": return .ink
    case "mil":  return .indigo
    case "run", "rou": return .inkFaint
    default:     return .inkSec         // task
    }
}
private func chipGlyphColor(_ cls: String) -> Color {
    switch cls {
    case "over": return .lime
    case "mil":  return .indigo
    case "run", "rou": return .inkFaint
    default:     return .inkDim         // task
    }
}

private struct CalChip: View {
    let event: CalEvent
    let onNavigate: (Surface) -> Void
    @State private var hover = false
    var body: some View {
        Button(action: { onNavigate(event.app != nil ? .apps : .tasks) }) {   // TODO real launch when app-tagged
            HStack(spacing: 6) {
                Text(event.glyph).font(.splMono(9)).foregroundColor(chipGlyphColor(event.cls))
                    .frame(width: 11)
                Text(event.title).font(.hanken(11)).foregroundColor(chipTextColor(event.cls))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 3).padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 5).fill(hover ? Color.raised : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct CalCell: View {
    let cell: CalCellModel
    let events: [CalEvent]
    let isToday: Bool
    let onNavigate: (Surface) -> Void
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(cell.day)").font(.splMono(11))
                .foregroundColor(cell.dim ? .inkFaint : (isToday ? .lime : .inkDim))
            ForEach(events.prefix(3)) { CalChip(event: $0, onNavigate: onNavigate) }
            if events.count > 3 {
                Button(action: { onNavigate(.tasks) }) {
                    Text("+\(events.count - 3) more").font(.splMono(10)).foregroundColor(.inkFaint)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 9).padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 11)
            .fill(cell.dim ? Color(red: 0x0d / 255, green: 0x0e / 255, blue: 0x13 / 255)
                           : (hover ? Color.raised : Color.panel)))
        .overlay(RoundedRectangle(cornerRadius: 11)
            .stroke(isToday ? Color.lime : Color.edgeSoft, lineWidth: 1))
        .contentShape(Rectangle())
        .onHover { if !cell.dim { hover = $0 } }
        .onTapGesture { if !cell.dim { onNavigate(.tasks) } }               // open that day's tasks
    }
}

private struct WeekCol: View {
    let day: Int
    let events: [CalEvent]
    let isToday: Bool
    let onNavigate: (Surface) -> Void
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(dowFor(day).uppercased()).font(.splMono(9.5)).tracking(1.0).foregroundColor(.inkFaint)
                Spacer()
                Text("\(day)").font(.splMono(13)).foregroundColor(isToday ? .lime : .inkDim)
            }
            .padding(.bottom, 6)
            .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
            if events.isEmpty {
                Text("—").font(.splMono(11)).foregroundColor(.inkFaint).padding(.top, 6)
            } else {
                ForEach(events) { CalChip(event: $0, onNavigate: onNavigate) }
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 240, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 11).fill(hover ? Color.raised : Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(isToday ? Color.lime : Color.edgeSoft, lineWidth: 1))
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .onTapGesture { onNavigate(.tasks) }
    }
}

private struct AgendaRow: View {
    let day: Int
    let events: [CalEvent]
    let isToday: Bool
    let onNavigate: (Surface) -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                Text(dowFor(day).uppercased()).font(.splMono(9.5)).tracking(1.0).foregroundColor(.inkFaint)
                Text("\(day)").font(.splMono(18)).foregroundColor(isToday ? .lime : .inkSec)
            }
            .frame(width: 62, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                ForEach(events) { CalChip(event: $0, onNavigate: onNavigate) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6).padding(.vertical, 12)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
    }
}

// =====================================================================================================
// MARK: - BankSurface — the .md vault (projects strip · active-project hero · facet tabs · capture)
// =====================================================================================================

private enum BankFacet: String { case overview = "Overview", tasks = "Tasks", brain = "Brain", artifacts = "Artifacts" }

private struct BankProject: Identifiable { let id: String; let name: String; let active: Bool }

private struct RoadStage: Identifiable { let id = UUID(); let name: String; let state: String }

private struct OverviewField: Identifiable {
    let id = UUID()
    let lbl: String
    var val: String? = nil
    var swatches: [String]? = nil
    var roadmap: [RoadStage]? = nil
    var empty: Bool = false
    var cta: String? = nil
}

private struct BankTask: Identifiable { let id = UUID(); let t: String; let meta: String; let state: String }
private struct BrainNote: Identifiable { let id = UUID(); let t: String; let note: String; let src: String }
private struct BankArtifactItem: Identifiable { let id = UUID(); let t: String; let kind: String; let src: String; let time: String }

private let BANK_PROJECTS: [BankProject] = [
    BankProject(id: "indeur", name: "IndEur Club", active: true),
    BankProject(id: "nailinit", name: "Nailinit", active: false),
    BankProject(id: "pockettts", name: "Idea: pocket-tts", active: false),
    BankProject(id: "switchboard", name: "Switchboard", active: false),
]
private let BANK_PATH = "~/Bank/projects/indeur-club/project-indeur.md"
private let BANK_COUNTS = (tasks: 6, brain: 14, artifacts: 23)

private let BANK_OVERVIEW: [OverviewField] = [
    OverviewField(lbl: "Essence", val: "A membership community for the Indian-European diaspora — cultural events, professional network, a sense of home away from home."),
    OverviewField(lbl: "Audience", val: "First & second-gen Indians in the EU, 24–40, city-based, seeking belonging + opportunity."),
    OverviewField(lbl: "Goals", val: "500 founding members before launch · a monthly flagship event in 3 cities · a warm, ownable brand."),
    OverviewField(lbl: "Brand set", val: "Palette: Terracotta & Indigo. 4 logo marks in Crest.",
                  swatches: ["E0764A", "5b4fe8", "E8B04A", "1b1a2e"]),
    OverviewField(lbl: "Roadmap", roadmap: [
        RoadStage(name: "Name", state: "done"), RoadStage(name: "Brand", state: "done"),
        RoadStage(name: "Launch page", state: "now"), RoadStage(name: "First event", state: ""),
        RoadStage(name: "500 members", state: "")]),
    OverviewField(lbl: "Voice & tone", val: "No voice profile yet — brandbrain can extract one from your notes.",
                  empty: true, cta: "↻ Extract voice"),
]
private let BANK_TASKS: [BankTask] = [
    BankTask(t: "Finalize Q4 palette", meta: "@brandbrain · due Fri", state: "now"),
    BankTask(t: "Ship the launch page", meta: "@Crest · in progress", state: "now"),
    BankTask(t: "Book 3 event venues", meta: "due next week", state: ""),
    BankTask(t: "Draft founding-member email", meta: "@AdForge", state: ""),
    BankTask(t: "Extract brand voice", meta: "@brandbrain", state: ""),
    BankTask(t: "Confirm pricing tiers", meta: "blocked · needs decision", state: "blocked"),
]
private let BANK_BRAIN: [BrainNote] = [
    BrainNote(t: "project-indeur.md", note: "the root essence + audience + goals", src: "manual"),
    BrainNote(t: "meetup-notes.md", note: "what the first 30 members want from a chapter", src: "Flow · transcript"),
    BrainNote(t: "pricing-thesis.md", note: "founding vs monthly tiers; €9 anchor", src: "ideabrain run"),
    BrainNote(t: "voice-scratch.md", note: "warm, plural, never corporate — draft phrases", src: "manual"),
]
private let BANK_ARTIFACTS: [BankArtifactItem] = [
    BankArtifactItem(t: "Switch-ligature monogram", kind: "mark", src: "Crest", time: "20m"),
    BankArtifactItem(t: "IndEur — 4 marks", kind: "gallery", src: "Crest", time: "22m"),
    BankArtifactItem(t: "Terracotta beam render", kind: "image", src: "Prism", time: "1h"),
    BankArtifactItem(t: "\"Find your people\" ad", kind: "ad", src: "AdForge", time: "1h"),
]

struct BankSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var facet: BankFacet = .overview
    @State private var activeProject = "indeur"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                bankHead
                projectStrip.padding(.top, 20)
                hero.padding(.top, 16)
                facetTabs.padding(.top, 16)
                facetBody.padding(.top, 18)
                capture.padding(.top, 22)
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var bankHead: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("BANK · BRAIN").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                Text("Your vault").font(.hanken(24, .semibold)).foregroundColor(.ink)
            }
            Spacer(minLength: 0)
            LimeButton(label: "+ Establish a project") { onNavigate(.apps) }   // TODO real launch (Bank)
            OSWSGhostButton(label: "Open the folder") { onNavigate(.apps) }         // TODO real launch (Bank)
        }
    }

    private var projectStrip: some View {
        // Wrap in a horizontally-scrollable row so the body never scrolls sideways.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(BANK_PROJECTS) { p in
                    OSWSProjectChip(project: p, active: activeProject == p.id) { activeProject = p.id }
                }
                NewOSWSProjectChip { onNavigate(.apps) }                            // TODO real launch (Bank)
            }
        }
    }

    private var hero: some View {
        HStack(spacing: 16) {
            IsoTile(hue: hueForId("indeur"))
                .frame(width: 34, height: 34)
                .frame(width: 46, height: 46)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color(red: 0x1b / 255, green: 0x1a / 255, blue: 0x2e / 255)))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.indigo.opacity(0.45), lineWidth: 1))
            VStack(alignment: .leading, spacing: 3) {
                Text("IndEur Club").font(.hanken(17, .semibold)).foregroundColor(.ink)
                Text("\"a community for the Indian-European diaspora — events, belonging, launching Q4\"")
                    .font(.hanken(12.5)).foregroundColor(.inkDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Text(BANK_PATH).font(.splMono(11)).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 22).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16)
            .fill(LinearGradient(colors: [Color(red: 0x15 / 255, green: 0x13 / 255, blue: 0x1f / 255),
                                          Color(red: 0x12 / 255, green: 0x13 / 255, blue: 0x19 / 255)],
                                 startPoint: .top, endPoint: .bottom)))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.indigo).frame(width: 2).clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    private var facetTabs: some View {
        HStack(spacing: 6) {
            BankTab(label: "Overview", count: nil, active: facet == .overview) { facet = .overview }
            BankTab(label: "Tasks", count: BANK_COUNTS.tasks, active: facet == .tasks) { facet = .tasks }
            BankTab(label: "Brain", count: BANK_COUNTS.brain, active: facet == .brain) { facet = .brain }
            BankTab(label: "Artifacts", count: BANK_COUNTS.artifacts, active: facet == .artifacts) { facet = .artifacts }
            Spacer(minLength: 0)
        }
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
    }

    @ViewBuilder private var facetBody: some View {
        switch facet {
        case .overview:  BankOverview()
        case .tasks:     BankTaskList(onNavigate: onNavigate)
        case .brain:     BankBrainList(onNavigate: onNavigate)
        case .artifacts: BankArtifactGrid(onNavigate: onNavigate)
        }
    }

    private var capture: some View {
        HStack(spacing: 14) {
            Text("＋").font(.system(size: 17)).foregroundColor(.inkDim)
                .frame(width: 38, height: 38)
                .background(RoundedRectangle(cornerRadius: 11).fill(Color(red: 0x0f / 255, green: 0x11 / 255, blue: 0x16 / 255)))
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.edge, lineWidth: 1))
            (Text("Drop a file, paste a note, or \"Bank it.\" ").font(.hanken(13, .medium)).foregroundColor(.ink)
                + Text("— files it as an artifact or note on IndEur Club, with its source.").font(.hanken(13)).foregroundColor(.inkSec))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            LimeButton(label: "Bank it") { onNavigate(.apps) }                  // TODO real launch (Bank)
        }
        .padding(.horizontal, 20).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14)
            .fill(LinearGradient(colors: [Color(red: 0x0e / 255, green: 0x0f / 255, blue: 0x14 / 255),
                                          Color(red: 0x0b / 255, green: 0x0c / 255, blue: 0x11 / 255)],
                                 startPoint: .top, endPoint: .bottom)))
        .overlay(RoundedRectangle(cornerRadius: 14)
            .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundColor(.edge))
    }
}

private struct OSWSProjectChip: View {
    let project: BankProject
    let active: Bool
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Circle().fill(active ? Color.indigo : Color.inkFaint).frame(width: 8, height: 8)
                    .shadow(color: active ? Color.indigo.opacity(0.6) : .clear, radius: 3)
                Text(project.name).font(.hanken(13)).foregroundColor(active ? .ink : .inkSec)
                if active {
                    Text("active").font(.splMono(10)).foregroundColor(.inkFaint)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 11)
                .fill(active ? LinearGradient(colors: [Color(red: 0x15 / 255, green: 0x13 / 255, blue: 0x1f / 255),
                                                       Color(red: 0x12 / 255, green: 0x13 / 255, blue: 0x19 / 255)],
                                              startPoint: .top, endPoint: .bottom)
                             : LinearGradient(colors: [Color.panel, Color.panel], startPoint: .top, endPoint: .bottom)))
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(hover ? Color.edgeSoft : Color.edge, lineWidth: 1))
            .overlay(alignment: .leading) {
                if active { Rectangle().fill(Color.indigo).frame(width: 2).clipShape(RoundedRectangle(cornerRadius: 11)) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct NewOSWSProjectChip: View {
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text("+ New").font(.hanken(13)).foregroundColor(hover ? .inkSec : .inkDim)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 11)
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundColor(hover ? .inkFaint : .edge))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct BankTab: View {
    let label: String
    let count: Int?
    let active: Bool
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(label).font(.hanken(13, active ? .semibold : .regular))
                    .foregroundColor(active ? .ink : (hover ? .inkSec : .inkDim))
                if let c = count { Text("\(c)").font(.splMono(10)).foregroundColor(.inkFaint) }
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 9).fill(active ? Color.panel : .clear))
            .overlay(alignment: .bottom) {
                if active { Rectangle().fill(Color.lime).frame(height: 2) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct BankOverview: View {
    let cols = [GridItem(.adaptive(minimum: 220), spacing: 12)]
    var body: some View {
        LazyVGrid(columns: cols, alignment: .leading, spacing: 12) {
            ForEach(BANK_OVERVIEW) { OverviewFieldView(field: $0) }
        }
    }
}

private struct OverviewFieldView: View {
    let field: OverviewField
    @State private var hover = false
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(field.lbl.uppercased()).font(.splMono(9.5)).tracking(1.4).foregroundColor(.inkFaint)
            if let v = field.val {
                Text(v).font(.hanken(13)).foregroundColor(field.empty ? .inkDim : .inkSec)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let sw = field.swatches {
                HStack(spacing: 7) {
                    ForEach(sw, id: \.self) { hex in
                        RoundedRectangle(cornerRadius: 7).fill(hexColor(hex)).frame(width: 26, height: 26)
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.white.opacity(0.08), lineWidth: 1))
                    }
                }
            }
            if let road = field.roadmap {
                HStack(spacing: 8) {
                    ForEach(road) { RoadStagePill(stage: $0) }
                }
            }
            if field.empty, let cta = field.cta {
                Button(action: {}) {
                    Text(cta).font(.hanken(12)).foregroundColor(.lime)
                        .padding(.horizontal, 11).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color(red: 0x20 / 255, green: 0x26 / 255, blue: 0x0c / 255)))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.lime.opacity(0.35), lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 15).padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(field.empty ? Color.clear : Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 12)
            .stroke(style: field.empty ? StrokeStyle(lineWidth: 1, dash: [4, 3]) : StrokeStyle(lineWidth: 1))
            .foregroundColor(.edge))
    }
}

private struct RoadStagePill: View {
    let stage: RoadStage
    private var fg: Color { stage.state == "done" ? .lime : (stage.state == "now" ? .indigo : .inkSec) }
    private var border: Color {
        stage.state == "done" ? Color.lime.opacity(0.4) : (stage.state == "now" ? Color.indigo.opacity(0.5) : Color.edge)
    }
    private var bg: Color {
        stage.state == "now" ? Color.indigo.opacity(0.14) : Color(red: 0x0f / 255, green: 0x11 / 255, blue: 0x16 / 255)
    }
    var body: some View {
        Text(stage.name).font(.hanken(11.5)).foregroundColor(fg)
            .padding(.horizontal, 11).padding(.vertical, 3)
            .background(Capsule().fill(bg))
            .overlay(Capsule().stroke(border, lineWidth: 1))
    }
}

private struct BankTaskList: View {
    let onNavigate: (Surface) -> Void
    var body: some View {
        VStack(spacing: 8) {
            ForEach(BANK_TASKS) { t in
                BankRow(box: stateColor(t.state), boxFill: stateFill(t.state), glyph: nil,
                        title: t.t, dim: nil, meta: t.meta) { onNavigate(.tasks) }
            }
            BankViewAllRow(label: "View all in Tasks") { onNavigate(.tasks) }
        }
    }
    private func stateColor(_ s: String) -> Color {
        s == "now" ? .indigo : (s == "blocked" ? .danger : .edge)
    }
    private func stateFill(_ s: String) -> Color {
        s == "now" ? Color.indigo.opacity(0.14) : (s == "blocked" ? Color.danger.opacity(0.14) : .clear)
    }
}

private struct BankBrainList: View {
    let onNavigate: (Surface) -> Void
    var body: some View {
        VStack(spacing: 8) {
            ForEach(BANK_BRAIN) { n in
                BankRow(box: nil, boxFill: nil, glyph: "▤",
                        title: n.t, dim: "— " + n.note, meta: n.src) { onNavigate(.graph) }
            }
            BankViewAllRow(label: "Open the knowledge graph") { onNavigate(.graph) }
        }
    }
}

private struct BankRow: View {
    let box: Color?          // task state box border (nil = brain glyph row)
    let boxFill: Color?
    let glyph: String?
    let title: String
    let dim: String?
    let meta: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if let b = box {
                    RoundedRectangle(cornerRadius: 4).fill(boxFill ?? .clear)
                        .frame(width: 13, height: 13)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(b, lineWidth: 1))
                } else if let g = glyph {
                    Text(g).font(.splMono(12)).foregroundColor(.inkFaint)
                }
                (Text(title).font(.hanken(13)).foregroundColor(.ink)
                    + Text(dim != nil ? " " + dim! : "").font(.hanken(13)).foregroundColor(.inkDim))
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text(meta).font(.splMono(10.5)).foregroundColor(.inkFaint)
            }
            .padding(.horizontal, 15).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 11)
                .fill(hover ? Color(red: 0x15 / 255, green: 0x13 / 255, blue: 0x1f / 255) : Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(hover ? Color.edgeSoft : Color.edge, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct BankViewAllRow: View {
    let label: String
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text("→").font(.splMono(12)).foregroundColor(.inkFaint)
                Text(label).font(.hanken(12.5)).foregroundColor(hover ? .inkSec : .inkDim)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 15).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 11)
                .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundColor(hover ? .inkFaint : .edge))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

private struct BankArtifactGrid: View {
    let onNavigate: (Surface) -> Void
    let cols = [GridItem(.adaptive(minimum: 150), spacing: 12)]
    var body: some View {
        LazyVGrid(columns: cols, spacing: 12) {
            ForEach(BANK_ARTIFACTS) { a in
                BankArtifactCard(art: a) { onNavigate(.apps) }               // TODO real launch (open in a.src)
            }
        }
    }
}

private struct BankArtifactCard: View {
    let art: BankArtifactItem
    let action: () -> Void
    @State private var hover = false

    private var thumbColor: Color {
        switch art.kind {
        case "image":   return hexColor("9B5DE5")
        case "ad":      return hexColor("F2994A")
        default:        return hexColor("E0764A")   // mark / gallery
        }
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(LinearGradient(colors: [thumbColor, Color(red: 0x0d / 255, green: 0x0e / 255, blue: 0x13 / 255)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(height: 84)
                Text(art.t).font(.hanken(12.5, .medium)).foregroundColor(.ink)
                    .lineLimit(1).padding(.top, 9)
                Text(art.src + " · " + art.time).font(.splMono(10)).foregroundColor(.inkFaint)
                    .padding(.top, 3)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(hover ? Color.edgeSoft : Color.edge, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
