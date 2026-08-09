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

/// The AI spec-out toggle — a lime-tinted "✦ Spec a dump" pill that opens the dump panel.
private struct SpecButton: View {
    let active: Bool
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text("✦").font(.splMono(11)).foregroundColor(.lime)
                Text("Spec a dump").font(.hanken(12, .semibold)).foregroundColor(active ? .ink : .inkSec)
            }
            .padding(.horizontal, 11).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 8).fill(active || hover ? Color.lime.opacity(0.10) : Color.panel))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(active ? Color.lime.opacity(0.55) : (hover ? Color.lime.opacity(0.35) : Color.edge), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// The lime CTA ("+ Add", "Bank it", "Establish").
struct LimeButton: View {
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
private enum GroupMode: String { case status = "Status", project = "Project", epic = "Bundle", due = "Due" }

// The open kanban columns (Done is a separate collapsed tally). Order = flow left→right.
// Backlog = parked / not-yet-released; promoting a card to Todo is what releases it to agents.
private let KANBAN: [(id: String, name: String, dot: Color)] = [
    ("backlog", "Backlog", .inkFaint), ("todo", "Todo", .inkDim), ("doing", "Doing", .lime), ("blocked", "Blocked", .danger), ("review", "Review", .indigo),
]

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
    var checkedNow: Bool = false
    var refIdx: Int = -1                                       // index into the surface's live RealTask array
    // dialect extras for the kanban card
    var epic: String? = nil
    var prio: String? = nil
    var detail: [TaskDetail] = []

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

// ═══ LIVE tasks — every tasks.md across the real vaults (bound folders + context folders).
// A task IS a line in a file: "- [ ] text @wrapp #project due:YYYY-MM-DD". Toggling rewrites only
// that line's checkbox token; adds append a line. No invented statuses — the dialect has todo/done.

// One detail line under a task: a plain note, or a nested `- [ ]` subtask.
struct TaskDetail: Identifiable { let id = UUID(); let sub: Bool; let done: Bool; let text: String }

struct RealTask: Identifiable {
    let id = UUID()
    let raw: String            // the exact source line — the match key for a safe line rewrite
    let title: String
    let wrapp: String?         // @tag, without the @
    let projTag: String?       // #tag, without the #
    let due: String?
    let over: Bool
    let done: Bool
    let file: String
    let folder: String
    // dialect tokens (all optional): the kanban lives in these, still plain in the file.
    let tid: String?           // id: — a stable handle other cards reference
    let status: String?        // status:todo|doing|blocked|review (nil = todo)
    let epic: String?          // epic: — the bundle this card belongs to
    let prio: String?          // prio:high|med|low
    let blockedBy: [String]    // blocked:/needs: — the ids this card waits on
    var detail: [TaskDetail]   // indented lines under the task
    var col: String = "todo"           // resolved column (needs the whole set for blocker done-ness)
    var blockedTitles: [String] = []   // resolved titles of blockedBy ids
}

// A task body split into its clean title + the dialect tokens. An unknown `key:val` (a URL) stays in
// the title — we only ever consume the seven keys. Mirrors packages/bank-mcp/tasks.mjs `parseBody`.
struct ParsedBody {
    var title = ""; var tag: String?; var proj: String?
    var status: String?; var id: String?; var epic: String?; var prio: String?; var due: String?
    var blockedBy: [String] = []
}
func osParseBody(_ bodyRaw: String) -> ParsedBody {
    var body = bodyRaw.trimmingCharacters(in: .whitespaces)
    var out = ParsedBody()
    // legacy "— by <hint>" due (what bank-mcp addTask writes) — pull it before whitespace tokenizing.
    if let r = body.range(of: " — by ") { out.due = String(body[r.upperBound...]).trimmingCharacters(in: .whitespaces); body = String(body[..<r.lowerBound]) }
    var words: [String] = []
    for tok in body.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init) {
        if tok.hasPrefix("@"), tok.count > 1 { out.tag = String(tok.dropFirst()); continue }
        if tok.hasPrefix("#"), tok.count > 1 { out.proj = String(tok.dropFirst()); continue }
        if let ci = tok.firstIndex(of: ":"), ci > tok.startIndex, tok.index(after: ci) < tok.endIndex {
            let k = tok[tok.startIndex..<ci].lowercased(); let v = String(tok[tok.index(after: ci)...])
            switch k {
            case "status": out.status = v.lowercased()
            case "id": out.id = v
            case "epic": out.epic = v
            case "prio": out.prio = v.lowercased()
            case "due": out.due = v
            case "blocked", "needs": out.blockedBy.append(v)
            default: words.append(tok)   // unknown key:val (e.g. a URL) is title text
            }
            continue
        }
        words.append(tok)
    }
    out.title = words.joined(separator: " ")
    return out
}

// Resolve each task's kanban column across the whole set: `[x]` = done; an open card with an unresolved
// blocker (unknown or still-open) or status:blocked → blocked; else its status; else todo.
func osResolveColumns(_ tasks: inout [RealTask]) {
    var doneById: [String: Bool] = [:]; var titleById: [String: String] = [:]
    for t in tasks { if let id = t.tid?.lowercased() { doneById[id] = t.done; titleById[id] = t.title } }
    for i in tasks.indices {
        if tasks[i].done { tasks[i].col = "done" }
        else if tasks[i].status == "backlog" { tasks[i].col = "backlog" }   // parked: not released to agents
        else {
            let unresolved = tasks[i].blockedBy.contains { doneById[$0.lowercased()] != true }
            if unresolved || tasks[i].status == "blocked" { tasks[i].col = "blocked" }
            else if tasks[i].status == "doing" || tasks[i].status == "review" { tasks[i].col = tasks[i].status! }
            else { tasks[i].col = "todo" }
        }
        tasks[i].blockedTitles = tasks[i].blockedBy.map { titleById[$0.lowercased()] ?? $0 }
    }
}

func osTaskFolders() -> [String] {
    var set = Set(osVaultFolders())
    for c in bankContexts() { if let f = c.folder, FileManager.default.fileExists(atPath: f) { set.insert(f) } }
    return set.sorted()
}

// (tasks, unreadable-files) — a tasks.md that exists but won't read is surfaced, never silently dropped.
func osTasksAll() -> (tasks: [RealTask], broken: [String]) {
    var out: [RealTask] = []
    var broken: [String] = []
    for folder in osTaskFolders() {
        let path = folder + "/tasks.md"
        guard FileManager.default.fileExists(atPath: path) else { continue }
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { broken.append(path); continue }
        out.append(contentsOf: osParseTasks(text, file: path, folder: folder))
    }
    osResolveColumns(&out)   // resolve columns globally so a cross-file blocker still counts
    return (out, broken)
}

func osParseTasks(_ text: String, file: String, folder: String) -> [RealTask] {
    var out: [RealTask] = []
    var parentIndent = -1   // indent of the current top-level task; deeper lines belong to it
    func indentOf(_ s: String) -> Int { s.prefix(while: { $0 == " " || $0 == "\t" }).count }
    for raw in text.components(separatedBy: "\n") {
        let t = raw.trimmingCharacters(in: .whitespaces)
        let ind = indentOf(raw)
        let done = t.hasPrefix("- [x]") || t.hasPrefix("- [X]")
        let isTask = done || t.hasPrefix("- [ ]")
        if isTask {
            let p = osParseBody(String(t.dropFirst(5)))
            // deeper than the current top-level task → a subtask captured in the parent's detail
            if !out.isEmpty, parentIndent >= 0, ind > parentIndent {
                out[out.count - 1].detail.append(TaskDetail(sub: true, done: done, text: p.title))
                continue
            }
            guard !p.title.isEmpty || p.tag != nil else { continue }
            out.append(RealTask(raw: raw, title: p.title.isEmpty ? "@" + (p.tag ?? "") : p.title,
                                wrapp: p.tag, projTag: p.proj, due: p.due,
                                over: !done && osDueIsPast(p.due), done: done, file: file, folder: folder,
                                tid: p.id, status: p.status, epic: p.epic, prio: p.prio,
                                blockedBy: p.blockedBy, detail: []))
            parentIndent = ind
            continue
        }
        // a non-task line indented under the current task → its detail; blank/dedent ends the run
        if !out.isEmpty, parentIndent >= 0, !t.isEmpty, ind > parentIndent {
            var dt = t; if dt.hasPrefix("- ") || dt.hasPrefix("* ") { dt = String(dt.dropFirst(2)) }
            out[out.count - 1].detail.append(TaskDetail(sub: false, done: false, text: dt))
            continue
        }
        if t.isEmpty { continue }   // blanks tolerated inside a list
        parentIndent = -1
    }
    return out
}

private func osDueIsPast(_ due: String?) -> Bool {
    guard let due, due.count == 10 else { return false }
    let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.timeZone = .current
    guard let d = df.date(from: due) else { return false }
    return d < Calendar.current.startOfDay(for: Date())
}

// Line-oriented toggle: flip ONLY this line's checkbox token; the rest of the file is untouched.
@discardableResult
func osToggleTask(_ t: RealTask) -> Bool {
    guard let text = try? String(contentsOfFile: t.file, encoding: .utf8) else { return false }
    var lines = text.components(separatedBy: "\n")
    guard let i = lines.firstIndex(of: t.raw) else { return false }   // file changed under us → no blind write
    lines[i] = t.done
        ? t.raw.replacingOccurrences(of: "[x]", with: "[ ]").replacingOccurrences(of: "[X]", with: "[ ]")
        : t.raw.replacingOccurrences(of: "[ ]", with: "[x]")
    return (try? lines.joined(separator: "\n").write(toFile: t.file, atomically: true, encoding: .utf8)) != nil
}

// Move a task to a kanban column by rewriting ONLY its line: flip the checkbox for done/reopen, and
// set/replace/drop the `status:` token for the open columns (todo drops it to keep lines spare).
// Exact-line match on `raw` — if the file changed underneath, it refuses rather than blind-writes.
@discardableResult
func osSetStatus(_ t: RealTask, to status: String) -> Bool {
    guard let text = try? String(contentsOfFile: t.file, encoding: .utf8) else { return false }
    var lines = text.components(separatedBy: "\n")
    guard let i = lines.firstIndex(of: t.raw) else { return false }
    var line = lines[i].replacingOccurrences(of: #"\s+status:[^\s]+"#, with: "", options: .regularExpression)
    if status == "done" {
        line = line.replacingOccurrences(of: "[ ]", with: "[x]")
    } else {
        line = line.replacingOccurrences(of: "[x]", with: "[ ]").replacingOccurrences(of: "[X]", with: "[ ]")
        if status != "todo" { line += " status:\(status)" }
    }
    lines[i] = line
    return (try? lines.joined(separator: "\n").write(toFile: t.file, atomically: true, encoding: .utf8)) != nil
}

// Backfill an `id:` on any task line in a file that lacks one (base36, unique in the file), so spec-out
// output can carry blocker references even if the model omitted them. Mirrors tasks.mjs `assignIds`.
@discardableResult
func osEnsureIds(file: String) -> Bool {
    guard let text = try? String(contentsOfFile: file, encoding: .utf8) else { return false }
    var lines = text.components(separatedBy: "\n")
    var used = Set<String>()
    for l in lines { let t = l.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("- [") { if let id = osParseBody(String(t.dropFirst(min(5, t.count)))).id { used.insert(id.lowercased()) } } }
    func gen() -> String { var s: String; repeat { s = String(Int.random(in: 46656..<1679615), radix: 36) } while used.contains(s); used.insert(s); return s }
    var changed = false
    for i in lines.indices {
        let t = lines[i].trimmingCharacters(in: .whitespaces)
        guard t.hasPrefix("- [x]") || t.hasPrefix("- [X]") || t.hasPrefix("- [ ]") else { continue }
        if osParseBody(String(t.dropFirst(5))).id != nil { continue }
        lines[i] = lines[i] + " id:\(gen())"; changed = true
    }
    if !changed { return true }
    return (try? lines.joined(separator: "\n").write(toFile: file, atomically: true, encoding: .utf8)) != nil
}

// Append a spec-out block (markdown task lines, possibly with `## ` headings + indented detail) to a
// vault's tasks.md, verbatim, after a blank line. The dialect merges cleanly on the next read.
@discardableResult
func osAppendBlock(folder: String, markdown: String) -> Bool {
    let path = folder + "/tasks.md"
    let block = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !block.isEmpty else { return false }
    if let existing = try? String(contentsOfFile: path, encoding: .utf8) {
        let sep = existing.hasSuffix("\n") ? "\n" : "\n\n"
        return (try? (existing + sep + block + "\n").write(toFile: path, atomically: true, encoding: .utf8)) != nil
    }
    return (try? ("# Tasks\n\n" + block + "\n").write(toFile: path, atomically: true, encoding: .utf8)) != nil
}

@discardableResult
func osAppendTask(folder: String, text: String) -> Bool {
    let line = "- [ ] " + text.trimmingCharacters(in: .whitespaces)
    let path = folder + "/tasks.md"
    if let existing = try? String(contentsOfFile: path, encoding: .utf8) {
        let sep = existing.hasSuffix("\n") ? "" : "\n"
        return (try? (existing + sep + line + "\n").write(toFile: path, atomically: true, encoding: .utf8)) != nil
    }
    return (try? ("# Tasks\n\n" + line + "\n").write(toFile: path, atomically: true, encoding: .utf8)) != nil
}

struct TasksSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var view: TaskView = .board
    @State private var activeFilter: String? = nil            // column id, or nil = all
    @State private var groupMode: GroupMode = .status
    @State private var all: [RealTask] = []
    @State private var broken: [String] = []
    @State private var scopeAll = false
    @State private var showDone = false
    @State private var adding = ""
    // AI spec-out: paste a dump → your Claude turns it into detailed cards, bundles, and blockers.
    @State private var showSpec = false
    @State private var dump = ""
    @State private var specRunning = false
    @State private var specErr: String? = nil

    private var activeCtx: BankCtx? { bankContexts().first { $0.id == readDefaultId() } }
    private func load() { let r = osTasksAll(); all = r.tasks; broken = r.broken }

    // scope: the active project's vault folder + its #tag; "All projects" lifts it
    private var scoped: [RealTask] {
        guard !scopeAll, let c = activeCtx else { return all }
        let folder = bankVaultFolder(c)
        let slug = c.name.lowercased().replacingOccurrences(of: " ", with: "-")
        let hits = all.filter { t in
            (folder != nil && t.folder == folder) ||
            (t.projTag?.lowercased() == slug)
        }
        return hits.isEmpty ? all : hits    // a scope that matches nothing falls open honestly (chip says All)
    }
    private var scopeIsAll: Bool { scopeAll || activeCtx == nil || scoped.count == all.count }
    private var open: [RealTask] { scoped.filter { !$0.done } }
    private var doneTasks: [RealTask] { scoped.filter { $0.done } }
    // where quick-add writes: the scoped project's vault, else the first vault with (or for) a tasks.md
    private var addFolder: String? {
        if !scopeIsAll, let c = activeCtx, let f = bankVaultFolder(c) { return f }
        return osTaskFolders().first { FileManager.default.fileExists(atPath: $0 + "/tasks.md") } ?? osTaskFolders().first
    }

    private func item(_ t: RealTask, statusId: String, statusName: String, col: Int) -> TaskItem {
        TaskItem(title: t.title, tag: t.wrapp.map { "@" + $0 }, proj: t.projTag.map { "#" + $0 },
                 prog: t.col == "doing",
                 wait: t.blockedTitles.isEmpty ? nil : "waiting: " + t.blockedTitles.joined(separator: ", "),
                 due: t.due, over: t.over, statusId: statusId, statusName: statusName, colIndex: col,
                 checkedNow: t.done, refIdx: all.firstIndex { $0.id == t.id } ?? -1,
                 epic: t.epic, prio: t.prio, detail: t.detail)
    }

    private var columns: [TaskColumn] {
        switch groupMode {
        case .status:
            // Real kanban: one column per open status, always shown (drag into an empty one).
            return KANBAN.enumerated().map { i, d in
                TaskColumn(id: d.id, name: d.name, dot: d.dot,
                           tasks: open.filter { $0.col == d.id }.map { item($0, statusId: d.id, statusName: d.name, col: i) })
            }
        case .epic:
            let groups = Dictionary(grouping: open) { $0.epic ?? "~" }
            return groups.keys.sorted().enumerated().map { i, key in
                TaskColumn(id: key, name: key == "~" ? "No bundle" : key, dot: .indigo,
                           tasks: groups[key]!.map { item($0, statusId: key, statusName: key, col: i) })
            }
        case .project:
            let groups = Dictionary(grouping: open) { $0.projTag ?? ($0.folder as NSString).lastPathComponent }
            return groups.keys.sorted().enumerated().map { i, key in
                TaskColumn(id: key, name: key, dot: .indigo,
                           tasks: groups[key]!.map { item($0, statusId: key, statusName: key, col: i) })
            }
        case .due:
            let overdue = open.filter { $0.over }
            let dated = open.filter { $0.due != nil && !$0.over }
            let someday = open.filter { $0.due == nil }
            return [
                TaskColumn(id: "overdue", name: "Overdue", dot: .danger,
                           tasks: overdue.map { item($0, statusId: "overdue", statusName: "Overdue", col: 0) }),
                TaskColumn(id: "dated", name: "Due", dot: .lime,
                           tasks: dated.map { item($0, statusId: "dated", statusName: "Due", col: 1) }),
                TaskColumn(id: "someday", name: "No date", dot: .inkDim,
                           tasks: someday.map { item($0, statusId: "someday", statusName: "No date", col: 2) }),
            ].filter { !$0.tasks.isEmpty }
        }
    }

    private var listRows: [TaskItem] {
        let src = showDone ? scoped : open
        let items = src.map { t in item(t, statusId: t.done ? "done" : "todo",
                                        statusName: t.done ? "Done" : "Todo", col: t.done ? 1 : 0) }
        return items.sorted { a, b in
            switch groupMode {
            case .status:  return a.colIndex < b.colIndex
            case .due:     return a.dueWeight < b.dueWeight
            case .epic:    return (a.epic ?? "~") < (b.epic ?? "~")
            case .project: return a.groupKey.localizedCaseInsensitiveCompare(b.groupKey) == .orderedAscending
            }
        }
    }

    private func toggleFilter(_ id: String) { activeFilter = (activeFilter == id) ? nil : id }
    private func cycleGroup() {
        switch groupMode {
        case .status: groupMode = .project
        case .project: groupMode = .epic
        case .epic: groupMode = .due
        case .due: groupMode = .status
        }
        activeFilter = nil
    }
    private func toggleTask(_ it: TaskItem) {
        guard it.refIdx >= 0, it.refIdx < all.count else { return }
        if osToggleTask(all[it.refIdx]) { load() }
    }
    // Drag a card onto a column → set that status (only meaningful when columns ARE statuses).
    private func moveTask(refIdx: Int, to colId: String) {
        guard groupMode == .status, refIdx >= 0, refIdx < all.count,
              KANBAN.contains(where: { $0.id == colId }) else { return }
        if osSetStatus(all[refIdx], to: colId) { load() }
    }
    private func submitAdd(status: String = "todo") {
        guard let f = addFolder, !adding.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        // A typed task defaults to Todo (committed); adding under Backlog parks it with status:backlog.
        let text = status == "backlog" ? adding.trimmingCharacters(in: .whitespaces) + " status:backlog" : adding
        if osAppendTask(folder: f, text: text) { adding = ""; load() }
    }

    // The spec-out brain: turn a brain-dump into the kanban dialect. Output is appended verbatim.
    private func specSystem(project: String) -> String {
        return """
        You are a sharp project manager. Turn the user's brain-dump into a clean set of task cards written in a plain-markdown dialect that a kanban board reads. Output ONLY the markdown — no preamble, no fences, no explanation.

        Rules:
        - Group every task under a single heading: `## \(project)`.
        - One task per line: `- [ ] <short imperative title> <tokens>`.
        - Every task starts PARKED in the backlog — add `status:backlog` to each. (The user promotes the ones they want done to Todo, which is what releases them to an agent.)
        - Give EVERY task an id token `id:xxxx` (4 lowercase letters/digits, unique in your output) so tasks can reference each other.
        - Bundle related tasks with the SAME `epic:<slug>` token (a short kebab slug for the theme, e.g. epic:pricing-launch). Use 1–3 bundles; don't over-split.
        - If task B can't start until task A is done, add `blocked:<A-id>` to task B. Mark real dependencies only.
        - Priority: add `prio:high`, `prio:med`, or `prio:low` — be selective, most are med.
        - Only add `due:YYYY-MM-DD` when the dump names a real date. Never invent dates.
        - Under each task, add 1–3 indented (two-space) detail lines: what "done" means, the specifics, gotchas. For concrete steps use nested `  - [ ] subtask` lines.
        - Keep titles under ~8 words. Split a vague dump item into the few real tasks it implies.

        Example shape:
        ## \(project)
        - [ ] Ship the pricing page status:backlog id:pr01 epic:pricing-launch prio:high
          Three tiers, monthly/annual toggle, Paddle checkout wired.
          - [ ] Wire Paddle checkout id:pr0a
        - [ ] Get legal sign-off on pricing copy status:backlog id:leg2 epic:pricing-launch
        - [ ] Write the launch post status:backlog id:lp03 epic:pricing-launch prio:low blocked:pr01
          Announce the new tiers once the page is live.
        """
    }

    // The model may wrap output in prose or fences — keep only from the first heading/task line, drop fences.
    private func sanitizeSpec(_ raw: String) -> String {
        var s = raw
        for f in ["```markdown", "```md", "```"] { s = s.replacingOccurrences(of: f, with: "") }
        let lines = s.components(separatedBy: "\n")
        if let start = lines.firstIndex(where: { let t = $0.trimmingCharacters(in: .whitespaces); return t.hasPrefix("## ") || t.hasPrefix("- [") }) {
            s = lines[start...].joined(separator: "\n")
        }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func runSpec() {
        let text = dump.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let folder = addFolder else { return }
        specErr = nil; specRunning = true
        let projectName = scopeIsAll ? "Inbox" : (activeCtx?.name ?? "Inbox")
        SkillRunner.shared.run(skillPrompt: specSystem(project: projectName), input: text, maxTokens: 2400, inputLimit: 6000) { result in
            specRunning = false
            switch result {
            case .success(let md):
                let block = sanitizeSpec(md)
                if !block.isEmpty, osAppendBlock(folder: folder, markdown: block) {
                    osEnsureIds(file: folder + "/tasks.md")   // backfill ids if the model omitted any
                    dump = ""; showSpec = false; load()
                } else { specErr = "The spec came back empty — try rephrasing the dump." }
            case .failure(let e):
                specErr = "Couldn't spec that — \(e)"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if showSpec { specPanel }
                ForEach(broken, id: \.self) { path in TasksBrokenBanner(path: path).padding(.top, 14) }
                if scoped.isEmpty {
                    emptyState.padding(.top, 20)
                } else if view == .board {
                    board.padding(.top, 20)
                } else {
                    list.padding(.top, 20)
                }
                SurfaceFoot(text: "tasks is the one lens on tasks.md · a card is a line in a file · drag moves it (rewrites status:) · ✦ specs a dump into cards, bundles & blockers · still plain text, still yours")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear(perform: load)
    }

    private var header: some View {
        HStack(spacing: 12) {
            SurfaceKicker(title: "Tasks", project: scopeIsAll ? "All projects" : (activeCtx?.name ?? "All projects"))
            ScopePill(label: scopeIsAll ? "All projects ▾" : "\(activeCtx?.name ?? "") ▾") { scopeAll.toggle() }
            Spacer(minLength: 0)
            SegBar {
                SegButton(label: "Board", active: view == .board) { view = .board }
                SegButton(label: "List", active: view == .list) { view = .list }
            }
            OSWSGhostButton(label: "Group: \(groupMode.rawValue) ▾") { cycleGroup() }
            SpecButton(active: showSpec) { showSpec.toggle(); specErr = nil }
        }
        .padding(.bottom, 14)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
    }

    // The AI spec-out panel: paste a dump, your Claude returns detailed cards, bundles, blockers.
    private var specPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                (Text("✦ ").foregroundColor(.lime) + Text("Spec out a dump").foregroundColor(.ink)).font(.hanken(13, .semibold))
                Text("paste a brain-dump — your Claude drafts detailed cards, bundles them, and marks blockers")
                    .font(.hanken(11)).foregroundColor(.inkDim)
                Spacer(minLength: 0)
            }
            ZStack(alignment: .topLeading) {
                if dump.isEmpty {
                    Text("e.g. redo the pricing page but legal has to sign off first; write the launch post; ship the Paddle checkout…")
                        .font(.hanken(12.5)).foregroundColor(.inkFaint).padding(.horizontal, 8).padding(.vertical, 8)
                }
                TextEditor(text: $dump)
                    .font(.hanken(13)).foregroundColor(.ink)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 88).padding(4)
            }
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.page))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.edge, lineWidth: 1))
            if let e = specErr { Text(e).font(.hanken(12)).foregroundColor(.danger).fixedSize(horizontal: false, vertical: true) }
            HStack(spacing: 10) {
                if addFolder == nil {
                    Text("No vault bound yet — bind one in the panel first.").font(.hanken(12)).foregroundColor(.inkDim)
                } else {
                    Text("→ files under \(scopeIsAll ? "Inbox" : (activeCtx?.name ?? "Inbox"))").font(.splMono(10.5)).foregroundColor(.inkFaint)
                }
                Spacer(minLength: 0)
                OSWSGhostButton(label: "Cancel") { showSpec = false }
                if specRunning {
                    HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Speccing…").font(.hanken(12)).foregroundColor(.inkDim) }
                } else if addFolder != nil {
                    LimeButton(label: "Spec it") { runSpec() }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.lime.opacity(0.25), lineWidth: 1))
        .padding(.top, 16)
    }

    // First-run: no tasks anywhere. One verb (the quick-add works right here), never a dead grid.
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Nothing here yet.").font(.brico(20, .bold)).foregroundColor(.ink)
            Text("A task is a line in your vault's tasks.md — add one below, tag it @wrapp or #project, or let God capture them.")
                .font(.hanken(13)).foregroundColor(.inkSec)
                .fixedSize(horizontal: false, vertical: true)
            if addFolder != nil {
                TaskAddInline(text: $adding, placeholder: "Add the first task…", onSubmit: { submitAdd() })
            } else {
                Text("No vault folder is bound yet — bind one in the panel, then tasks.md lives there.")
                    .font(.hanken(12.5)).foregroundColor(.inkDim)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
    }

    // Fixed-width columns that scroll horizontally (Trello/Linear grammar) — stays readable no matter how
    // many columns the grouping produces (5 statuses, or N projects/bundles).
    private var board: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(columns) { col in
                    TaskColumnView(
                        column: col,
                        dimmed: activeFilter != nil && activeFilter != col.id,
                        selected: activeFilter == col.id,
                        canAdd: groupMode == .status && (col.id == "backlog" || col.id == "todo") && addFolder != nil,
                        canDrop: groupMode == .status,
                        addText: $adding,
                        onHeader: { toggleFilter(col.id) },
                        onToggle: toggleTask,
                        onSubmitAdd: { submitAdd(status: col.id) },
                        onDropTask: { refIdx in moveTask(refIdx: refIdx, to: col.id) },
                        onNavigate: onNavigate)
                    .frame(width: 216, alignment: .top)
                }
                DoneColumn(count: doneTasks.count) { showDone = true; view = .list }
                    .frame(width: 132)
            }
            .padding(.bottom, 6)
        }
    }

    private var list: some View {
        VStack(spacing: 0) {
            if showDone {
                HStack {
                    Spacer()
                    OSWSGhostButton(label: "Hide done") { showDone = false }
                }.padding(.bottom, 8)
            }
            ForEach(listRows.filter { activeFilter == nil || $0.statusId == activeFilter }) { it in
                TaskListRow(item: it, dot: it.checkedNow ? .lime : .inkDim,
                            checked: it.checkedNow,
                            onToggle: { toggleTask(it) },
                            onNavigate: onNavigate)
            }
            if addFolder != nil {
                TaskAddInline(text: $adding, placeholder: "Add a task — appends to tasks.md", onSubmit: { submitAdd() })
                    .padding(.top, 10)
            }
        }
    }
}

// tasks.md exists but couldn't be read — surface it, never silently drop lines.
private struct TasksBrokenBanner: View {
    let path: String
    var body: some View {
        HStack(spacing: 12) {
            Text("!").font(.splMono(13)).foregroundColor(.amber)
            Text("Couldn't read \((path as NSString).abbreviatingWithTildeInPath)")
                .font(.hanken(13)).foregroundColor(.inkSec)
            Spacer(minLength: 0)
            OSWSGhostButton(label: "Open tasks.md") { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.amber.opacity(0.4), lineWidth: 1))
    }
}

// The inline quick-add — typing "@wrapp #project due:2026-08-20" goes into the line verbatim (the dialect).
private struct TaskAddInline: View {
    @Binding var text: String
    let placeholder: String
    let onSubmit: () -> Void
    var body: some View {
        HStack(spacing: 10) {
            Text("+").font(.splMono(12)).foregroundColor(.inkFaint)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain).font(.hanken(13)).foregroundColor(.ink)
                .onSubmit(onSubmit)
            if !text.trimmingCharacters(in: .whitespaces).isEmpty {
                Button(action: onSubmit) {
                    Text("Add").font(.hanken(12, .semibold)).foregroundColor(.lime)
                }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12)
            .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundColor(.edge))
    }
}

private struct TaskColumnView: View {
    let column: TaskColumn
    let dimmed: Bool
    let selected: Bool
    let canAdd: Bool
    let canDrop: Bool
    @Binding var addText: String
    let onHeader: () -> Void
    let onToggle: (TaskItem) -> Void
    let onSubmitAdd: () -> Void
    let onDropTask: (Int) -> Void
    let onNavigate: (Surface) -> Void
    @State private var headHover = false
    @State private var dropTarget = false

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
                TaskCardView(task: t, checked: t.checkedNow,
                             onToggle: { onToggle(t) }, onNavigate: onNavigate)
                    .draggable(String(t.refIdx))
            }

            if column.tasks.isEmpty {
                Text(canDrop ? "drop here" : "—")
                    .font(.splMono(10.5)).foregroundColor(.inkFaint)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 10)
                        .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundColor(.edgeSoft))
            }

            if canAdd {
                TaskAddInline(text: $addText, placeholder: "+ add a task…", onSubmit: onSubmitAdd)
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 12).fill(dropTarget ? Color.lime.opacity(0.06) : .clear))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(dropTarget ? Color.lime.opacity(0.5) : Color.clear, lineWidth: 1))
        .opacity(dimmed ? 0.4 : 1.0)
        .dropDestination(for: String.self) { items, _ in
            guard canDrop, let s = items.first, let idx = Int(s) else { return false }
            onDropTask(idx); return true
        } isTargeted: { dropTarget = canDrop && $0 }
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

    @State private var expanded = false

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
                if let prio = task.prio, prio != "low" {
                    Text(prio == "high" ? "●" : "○").font(.splMono(9))
                        .foregroundColor(prio == "high" ? .danger : sbAmber)
                        .help("priority: \(prio)")
                }
            }
            TaskRowBits(task: task)
            if !task.detail.isEmpty {
                Button { expanded.toggle() } label: {
                    HStack(spacing: 5) {
                        Text(expanded ? "⌄" : "›").font(.splMono(10))
                        Text("\(task.detail.count) detail\(task.detail.count == 1 ? "" : "s")").font(.splMono(10))
                    }
                    .foregroundColor(.inkFaint).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if expanded {
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(task.detail) { d in
                            HStack(alignment: .top, spacing: 6) {
                                Text(d.sub ? (d.done ? "☑" : "☐") : "·").font(.splMono(10))
                                    .foregroundColor(d.sub && d.done ? .lime : .inkFaint)
                                Text(d.text).font(.hanken(12)).foregroundColor(.inkSec)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                        }
                    }
                    .padding(.leading, 2).padding(.top, 1)
                }
            }
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
        // @tagged task → open that wrapp AT this task; untagged → the vault. Falls back to in-OS
        // navigation under the snapshot harness (no live launcher).
        OSLaunch.launchOr(task.opensApp ? task.appName : nil,
                          .init(artifact: task.title, kind: "task", project: task.proj)) {
            onNavigate(task.opensApp ? .apps : .bank)
        }
    }
}

private struct TaskRowBits: View {
    let task: TaskItem
    // A flow layout so a narrow kanban column wraps the chips to the next line instead of char-wrapping.
    var body: some View {
        FlowLayout(spacing: 6) {
            if let tag = task.tag {
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(task.swHex.map { hexColor($0) }
                            ?? Color(hue: hueForId(task.appName), saturation: 0.6, brightness: 0.8))
                        .frame(width: 8, height: 8)
                    Text(tag).font(.splMono(10)).foregroundColor(.inkDim).lineLimit(1).fixedSize()
                }
                .padding(.horizontal, 7).padding(.vertical, 1)
                .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
            }
            if let proj = task.proj {
                Text(proj).font(.splMono(10)).foregroundColor(.inkFaint).lineLimit(1).fixedSize()
            }
            if let epic = task.epic {
                HStack(spacing: 4) {
                    Text("◇").font(.splMono(8.5)).foregroundColor(.indigo)
                    Text(epic).font(.splMono(10)).foregroundColor(.indigo).lineLimit(1).fixedSize()
                }
                .padding(.horizontal, 6).padding(.vertical, 1)
                .overlay(Capsule().stroke(Color.indigo.opacity(0.4), lineWidth: 1))
            }
            if task.prog {
                Circle().fill(sbAmber).frame(width: 8, height: 8)          // in progress
            }
            if let wait = task.wait {
                Text(wait).font(.splMono(10)).foregroundColor(.danger).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 7).padding(.vertical, 1)
                    .overlay(Capsule().stroke(Color.danger.opacity(0.5), lineWidth: 1))
            }
            if let due = task.due { DueChip(text: due, over: task.over) }
        }
    }
}

private struct DueChip: View {
    let text: String
    let over: Bool
    var body: some View {
        Text(text).font(.splMono(10)).lineLimit(1).fixedSize()
            .foregroundColor(over ? Color(red: 0x0b / 255, green: 0x0c / 255, blue: 0x10 / 255) : .inkDim)
            .padding(.horizontal, 7).padding(.vertical, 1)
            .background(Capsule().fill(over ? Color.lime : .clear))
            .overlay(Capsule().stroke(over ? Color.lime : Color.edge, lineWidth: 1))
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
                Text("in tasks.md").font(.hanken(11)).foregroundColor(.inkFaint)
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
        .onTapGesture {
            OSLaunch.launchOr(item.opensApp ? item.appName : nil,
                              .init(artifact: item.title, kind: "task", project: item.proj)) {
                onNavigate(item.opensApp ? .apps : .bank)
            }
        }
    }
}

// =====================================================================================================
// MARK: - CalendarSurface — a temporal projection of the vault (Month / Week / Agenda; prev/today/next)
// =====================================================================================================

private struct CalEvent: Identifiable {
    let id = UUID()
    let cls: String        // task | over | run
    let glyph: String
    let title: String
    var app: String? = nil // wrapp-referencing chip → launch it; else → Tasks
}

private let DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
private enum CalView { case month, week, agenda }

private struct CalCellModel: Identifiable {
    let id = UUID()
    let day: Int          // day-of-month (0 = a blank lead/trail pad)
    let dim: Bool         // outside the current month
    let key: String       // "yyyy-MM-dd" for real cells, "" for pads
}

// ═══ LIVE calendar — a temporal PROJECTION of real dated vault items, per docs/OS.md §3.3. Two real
// sources keyed by real dates: `due:` on tasks.md lines (● / overdue ●-lime) and audit-log acts by
// day (↻ past run, dim). No invented milestones — a project roadmap has no dates in the vault yet.
struct CalendarSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var view: CalView = .month
    @State private var monthOffset = 0     // 0 = current month; ‹ / › step it
    @State private var events: [String: [CalEvent]] = [:]

    private let cal = Calendar.current
    private let grid = Array(repeating: GridItem(.flexible(), spacing: 8), count: 7)

    private var shownMonth: Date {
        cal.date(byAdding: .month, value: monthOffset, to: cal.startOfDay(for: Date())) ?? Date()
    }
    private var monthTitle: String {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"; return f.string(from: shownMonth)
    }
    private var todayKey: String { dayKey(Date()) }
    private func dayKey(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: d)
    }

    // real month grid: lead pads to the Monday before the 1st, then each real day, then trailing pads
    private var cells: [CalCellModel] {
        guard let range = cal.range(of: .day, in: .month, for: shownMonth),
              let first = cal.date(from: cal.dateComponents([.year, .month], from: shownMonth)) else { return [] }
        var out: [CalCellModel] = []
        let weekdayOfFirst = cal.component(.weekday, from: first)      // 1=Sun … 7=Sat
        let lead = (weekdayOfFirst + 5) % 7                            // days since Monday
        for _ in 0..<lead { out.append(CalCellModel(day: 0, dim: true, key: "")) }
        for d in range {
            if let date = cal.date(byAdding: .day, value: d - 1, to: first) {
                out.append(CalCellModel(day: d, dim: false, key: dayKey(date)))
            }
        }
        while out.count % 7 != 0 { out.append(CalCellModel(day: 0, dim: true, key: "")) }
        return out
    }

    private func load() {
        var ev: [String: [CalEvent]] = [:]
        let today = cal.startOfDay(for: Date())
        // due tasks — real due: dates on open tasks
        for t in osTasksAll().tasks where !t.done {
            guard let due = t.due, due.count == 10 else { continue }
            ev[due, default: []].append(CalEvent(
                cls: t.over ? "over" : "task", glyph: "●",
                title: t.title, app: t.wrapp))
        }
        // past acts — one merged "N acts" chip per app per day, from the audit sessions
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        for s in osSessions(windowDays: 45) {
            let d = Date(timeIntervalSince1970: s.endMs / 1000)
            guard d <= today else { continue }
            let n = s.counts.values.reduce(0, +)
            ev[f.string(from: d), default: []].append(CalEvent(
                cls: "run", glyph: "↻", title: "\(s.app) · \(n) act\(n == 1 ? "" : "s")", app: s.app))
        }
        events = ev
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                legend.padding(.top, 16)
                if events.isEmpty {
                    Text("Nothing dated yet — give a task a due date (due:YYYY-MM-DD) and it lands here. Past acts fill in as you work.")
                        .font(.hanken(12.5)).foregroundColor(.inkDim)
                        .padding(.top, 14)
                }
                Group {
                    switch view {
                    case .month:  monthView
                    case .week:   weekView
                    case .agenda: agendaView
                    }
                }
                .padding(.top, 12)
                SurfaceFoot(text: "calendar is a temporal projection of the vault · it invents no events · due tasks + past acts, keyed by real dates · the past is dim, not gone")
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear(perform: load)
    }

    private var header: some View {
        HStack(spacing: 12) {
            (Text("◦ ").foregroundColor(.inkDim) + Text(monthTitle).foregroundColor(.ink))
                .font(.splMono(11)).tracking(0.6)
            Spacer(minLength: 0)
            SegBar {
                SegButton(label: "Month", active: view == .month) { view = .month }
                SegButton(label: "Week", active: view == .week) { view = .week }
                SegButton(label: "Agenda", active: view == .agenda) { view = .agenda }
            }
            SegBar {
                SegButton(label: "‹", active: false) { monthOffset -= 1 }
                SegButton(label: "Today", active: monthOffset == 0) { monthOffset = 0 }
                SegButton(label: "›", active: false) { monthOffset += 1 }
            }
        }
        .padding(.bottom, 14)
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
    }

    private var legend: some View {
        HStack(spacing: 16) {
            LegendItem(glyph: "●", color: .lime, label: "due / overdue task", strong: true)
            LegendItem(glyph: "●", color: .inkDim, label: "due later", strong: true)
            LegendItem(glyph: "↻", color: .inkFaint, label: "past act", strong: false)
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
                    CalCell(cell: cell, events: cell.dim ? [] : (events[cell.key] ?? []),
                            isToday: cell.key == todayKey, onNavigate: onNavigate)
                }
            }
        }
    }

    // Week = the seven real days of the shown month's week containing today (or its 1st week)
    private var weekCells: [CalCellModel] { cells.filter { !$0.dim } }
    private var weekView: some View {
        let real = weekCells
        let anchor = real.firstIndex { $0.key == todayKey } ?? 0
        let start = (anchor / 7) * 7
        let slice = Array(real[start..<min(start + 7, real.count)])
        return LazyVGrid(columns: grid, spacing: 8) {
            ForEach(slice) { c in
                WeekCol(dayNum: c.day, dow: dowFromKey(c.key), events: events[c.key] ?? [],
                        isToday: c.key == todayKey, onNavigate: onNavigate)
            }
        }
    }

    private var agendaView: some View {
        let dated = cells.filter { !$0.dim && !(events[$0.key] ?? []).isEmpty }
        return VStack(spacing: 0) {
            if dated.isEmpty {
                Text("No dated items this month.").font(.hanken(12.5)).foregroundColor(.inkDim).padding(.vertical, 16)
            }
            ForEach(dated) { c in
                AgendaRow(dayNum: c.day, dow: dowFromKey(c.key), events: events[c.key] ?? [],
                          isToday: c.key == todayKey, onNavigate: onNavigate)
            }
        }
        .frame(maxWidth: 640, alignment: .leading)
    }

    private func dowFromKey(_ key: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: key) else { return "" }
        return DOW[(cal.component(.weekday, from: d) + 5) % 7]
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
        Button(action: {
            OSLaunch.launchOr(event.app, .init(artifact: event.title, kind: "event")) {
                onNavigate(event.app != nil ? .apps : .tasks)
            }
        }) {
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
            if !cell.dim { Text("\(cell.day)").font(.splMono(11)).foregroundColor(isToday ? .lime : .inkDim) }
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
    let dayNum: Int
    let dow: String
    let events: [CalEvent]
    let isToday: Bool
    let onNavigate: (Surface) -> Void
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(dow.uppercased()).font(.splMono(9.5)).tracking(1.0).foregroundColor(.inkFaint)
                Spacer()
                Text("\(dayNum)").font(.splMono(13)).foregroundColor(isToday ? .lime : .inkDim)
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
    let dayNum: Int
    let dow: String
    let events: [CalEvent]
    let isToday: Bool
    let onNavigate: (Surface) -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                Text(dow.uppercased()).font(.splMono(9.5)).tracking(1.0).foregroundColor(.inkFaint)
                Text("\(dayNum)").font(.splMono(18)).foregroundColor(isToday ? .lime : .inkSec)
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
private struct BrainNote: Identifiable { let id = UUID(); let t: String; let note: String; let src: String; let path: String }
private struct BankArtifactItem: Identifiable { let id = UUID(); let t: String; let kind: String; let src: String; let time: String }

// ═══ LIVE readers — Bank renders the REAL model: ~/.relay/contexts.json (projects), the project's
// vault folder (data.folder, else the storage-binding of its source origin), tasks.md checkbox lines,
// note-*/dictionary-*/project-*.md files, and ~/.relay/storage/<origin> blobs. No fictional samples.

struct BankCtx: Identifiable {
    let id: String; let name: String; let kind: String
    let origin: String?                       // the wrapp/panel that published it
    let data: [String: Any]
    let updatedMs: Double
    var folder: String? { data["folder"] as? String }
}

func bankContexts() -> [BankCtx] {
    guard let arr = readJSON(CONTEXTS_FILE) as? [[String: Any]] else { return [] }
    return arr.compactMap { c in
        guard let id = c["id"] as? String, let name = c["name"] as? String else { return nil }
        return BankCtx(id: id, name: name, kind: (c["kind"] as? String) ?? "context",
                       origin: (c["source"] as? String) ?? (c["publishedBy"] as? String),
                       data: (c["data"] as? [String: Any]) ?? [:],
                       updatedMs: (c["updatedAt"] as? NSNumber)?.doubleValue ?? 0)
    }.sorted { $0.updatedMs > $1.updatedMs }
}

// The project's vault: its own folder if it has one, else the folder its source origin is bound to.
func bankVaultFolder(_ c: BankCtx) -> String? {
    if let f = c.folder, FileManager.default.fileExists(atPath: f) { return f }
    guard let o = c.origin,
          let bindings = readJSON((NSHomeDirectory() as NSString).appendingPathComponent(".relay/storage-bindings.json")) as? [String: Any],
          let m = bindings[o] as? [String: Any], let f = m["folder"] as? String,
          FileManager.default.fileExists(atPath: f) else { return nil }
    return f
}

// Overview = the context's real data fields, rendered in a stable order. Only non-empty fields show;
// a thin profile is handled by the surface (Establish leads), never padded with invented content.
private func bankOverviewFields(_ c: BankCtx) -> [OverviewField] {
    let d = c.data
    func str(_ k: String) -> String? { if let v = d[k] as? String, !v.isEmpty, v != "{}" { return v }; return nil }
    var out: [OverviewField] = []
    if let prods = d["products"] as? [String], !prods.isEmpty {
        out.append(OverviewField(lbl: "Products", val: prods.joined(separator: " · ")))
    }
    for (lbl, key) in [("One-liner", "oneLine"), ("Idea", "idea"), ("Summary", "summary"),
                       ("Positioning", "positioning"), ("Audience", "audience"), ("Voice & tone", "voice"),
                       ("Problem", "problem"), ("Market", "market"), ("Insight", "insight"),
                       ("Solution", "solution"), ("Model", "model"), ("Moat", "moat"),
                       ("Category", "category"), ("Repo", "repo")] {
        if let v = str(key) { out.append(OverviewField(lbl: lbl, val: v)) }
    }
    var hexes: [String] = []
    if let rich = d["paletteRich"] as? [[String: Any]] { hexes = rich.compactMap { $0["hex"] as? String } }
    if hexes.isEmpty, let p = d["palette"] as? [String] { hexes = p }
    if !hexes.isEmpty {
        out.append(OverviewField(lbl: "Palette", swatches: hexes.map { $0.replacingOccurrences(of: "#", with: "") }))
    }
    if let dec = d["decisions"] as? [String], !dec.isEmpty {
        out.append(OverviewField(lbl: "Decisions", val: dec.prefix(4).map { "· " + $0 }.joined(separator: "\n")))
    }
    return out
}

// tasks.md — the shared-list dialect: "- [ ] text @wrapp #project" lines. done = "- [x]".
private func bankTasks(folder: String?) -> [BankTask] {
    guard let folder, let text = try? String(contentsOfFile: folder + "/tasks.md", encoding: .utf8) else { return [] }
    var out: [BankTask] = []
    for raw in text.split(separator: "\n") {
        let t = raw.trimmingCharacters(in: .whitespaces)
        let done = t.hasPrefix("- [x]") || t.hasPrefix("- [X]")
        guard done || t.hasPrefix("- [ ]") else { continue }
        var body = String(t.dropFirst(5)).trimmingCharacters(in: .whitespaces)
        let tags = body.split(separator: " ").filter { $0.hasPrefix("@") || $0.hasPrefix("#") }.map(String.init)
        for tag in tags { body = body.replacingOccurrences(of: tag, with: "") }
        body = body.replacingOccurrences(of: "  ", with: " ").trimmingCharacters(in: .whitespaces)
        out.append(BankTask(t: body, meta: tags.joined(separator: " "), state: done ? "done" : ""))
    }
    return out
}

// Brain — the vault's own .md knowledge files (the Bank dialect), newest first, first body line as gist.
private func bankNotes(folder: String?) -> [BrainNote] {
    guard let folder, let files = try? FileManager.default.contentsOfDirectory(atPath: folder) else { return [] }
    let fm = FileManager.default
    let now = Date().timeIntervalSince1970 * 1000
    var out: [(BrainNote, Double)] = []
    for f in files where f.hasSuffix(".md") &&
        (f.hasPrefix("note-") || f.hasPrefix("dictionary-") || f.hasPrefix("project-") || f.hasPrefix("brand-")) {
        let path = folder + "/" + f
        let text = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
        var gist = ""; var inFM = false
        for raw in text.split(separator: "\n") {
            let l = raw.trimmingCharacters(in: .whitespaces)
            if l == "---" { inFM.toggle(); continue }
            if inFM || l.isEmpty || l.hasPrefix("#") { continue }
            gist = l; break
        }
        if gist.count > 80 { gist = String(gist.prefix(78)) + "…" }
        let m = (((try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000
        out.append((BrainNote(t: f, note: gist, src: relAgo(now - m), path: path), m))
    }
    return out.sorted { $0.1 > $1.1 }.map { $0.0 }
}

// Artifacts — the real blobs the project's wrapps saved. Two real locations: ~/.relay/storage/<origin>/
// (unbound origins) and the bound vault folder itself (a bound origin's storage IS its folder).
private func bankArtifacts(_ c: BankCtx) -> [BankArtifactItem] {
    let fm = FileManager.default
    let now = Date().timeIntervalSince1970 * 1000
    var out: [(BankArtifactItem, Double)] = []
    func scan(_ dir: String, src: String) {
        guard let files = try? fm.contentsOfDirectory(atPath: dir) else { return }
        for f in files where f.hasSuffix(".json") && !f.contains(".bak") && !f.hasPrefix(".") {
            let path = dir + "/" + f
            let m = (((try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000
            let (title, _, kind) = classifyArtifact(path, key: f)
            out.append((BankArtifactItem(t: title, kind: kind, src: src, time: relAgo(now - m)), m))
        }
    }
    if let o = c.origin {
        let dirName = o.replacingOccurrences(of: "://", with: "_")
            .replacingOccurrences(of: ":", with: "_").replacingOccurrences(of: "/", with: "_")
        let app = wrappFromOrigin(o)
        scan((NSHomeDirectory() as NSString).appendingPathComponent(".relay/storage/" + dirName),
             src: app.isEmpty ? "panel" : app)
    }
    if let folder = bankVaultFolder(c) {
        let app = c.origin.map(wrappFromOrigin) ?? ""
        scan(folder, src: app.isEmpty ? "vault" : app)
    }
    return out.sorted { $0.1 > $1.1 }.map { $0.0 }
}

// Capture — "Bank it": the clipboard becomes a note-*.md in the project's vault (or ~/.relay/bank/<id>
// when nothing is bound — additive, never destructive). Returns the written filename.
private func bankCapture(_ c: BankCtx) -> String? {
    guard let text = NSPasteboard.general.string(forType: .string)?
        .trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
    let folder = bankVaultFolder(c) ?? {
        let d = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/bank/" + c.id)
        try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
        return d
    }()
    let df = DateFormatter(); df.dateFormat = "yyyyMMdd-HHmmss"
    let name = "note-" + df.string(from: Date()) + ".md"
    let head = "---\nkind: note\nproject: \(c.name)\nsource: capture\n---\n\n"
    return (try? (head + text + "\n").write(toFile: folder + "/" + name, atomically: true, encoding: .utf8)) != nil ? name : nil
}

// Contexts mutations (New · Rename) — explicit user actions only; a one-shot .os-bak guards the file.
private func bankMutateContexts(_ mutate: (inout [[String: Any]]) -> Void) -> Bool {
    var arr = (readJSON(CONTEXTS_FILE) as? [[String: Any]]) ?? []
    let bak = CONTEXTS_FILE + ".os-bak"
    if !FileManager.default.fileExists(atPath: bak) { try? FileManager.default.copyItem(atPath: CONTEXTS_FILE, toPath: bak) }
    mutate(&arr)
    guard let data = try? JSONSerialization.data(withJSONObject: arr, options: [.prettyPrinted]) else { return false }
    return (try? data.write(to: URL(fileURLWithPath: CONTEXTS_FILE), options: .atomic)) != nil
}
func bankCreateProject(name: String) -> String? {
    let id = UUID().uuidString.lowercased()
    let ok = bankMutateContexts { arr in
        arr.append(["id": id, "name": name, "kind": "project", "data": [String: Any](),
                    "publishedBy": "os", "updatedAt": Date().timeIntervalSince1970 * 1000])
    }
    if ok { writeGlobalContext(id) }
    return ok ? id : nil
}
@discardableResult
func bankRename(id: String, to name: String) -> Bool {
    bankMutateContexts { arr in
        for i in arr.indices where (arr[i]["id"] as? String) == id {
            arr[i]["name"] = name
            arr[i]["updatedAt"] = Date().timeIntervalSince1970 * 1000
        }
    }
}

struct BankSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var facet: BankFacet = .overview
    @State private var ctxs: [BankCtx] = []
    @State private var viewingId: String? = nil
    @State private var contextsFileBroken = false          // file exists but won't parse → error banner
    // + New / Rename inline state
    @State private var newName = ""
    @State private var showNew = false
    @State private var renaming: BankCtx? = nil
    @State private var renameText = ""
    // capture feedback
    @State private var bankedNote: String? = nil

    private var viewing: BankCtx? { ctxs.first { $0.id == viewingId } ?? ctxs.first }

    private func load() {
        ctxs = bankContexts()
        let file = FileManager.default.fileExists(atPath: CONTEXTS_FILE)
        contextsFileBroken = ctxs.isEmpty && file && readJSON(CONTEXTS_FILE) == nil
        if viewingId == nil { viewingId = readDefaultId() ?? ctxs.first?.id }
    }
    private func activate(_ id: String) { writeGlobalContext(id); viewingId = id }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                bankHead
                if contextsFileBroken {
                    BankErrorBanner().padding(.top, 20)
                } else if ctxs.isEmpty {
                    BankEstablishState(onNavigate: onNavigate, onCreate: createProject).padding(.top, 20)
                } else {
                    projectStrip.padding(.top, 20)
                    if let c = viewing {
                        BankHero(c: c, folder: bankVaultFolder(c))
                            .padding(.top, 16)
                        facetTabs(c).padding(.top, 16)
                        facetBody(c).padding(.top, 18)
                        capture(c).padding(.top, 22)
                    }
                }
            }
            .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear(perform: load)
        .alert("Rename project", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Rename") {
                if let r = renaming, !renameText.trimmingCharacters(in: .whitespaces).isEmpty {
                    bankRename(id: r.id, to: renameText.trimmingCharacters(in: .whitespaces)); load()
                }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
    }

    private func createProject(_ name: String) {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        if let id = bankCreateProject(name: name.trimmingCharacters(in: .whitespaces)) { load(); viewingId = id }
        showNew = false; newName = ""
    }

    private var bankHead: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("BANK · BRAIN").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                Text("Your vault").font(.hanken(24, .semibold)).foregroundColor(.ink)
            }
            Spacer(minLength: 0)
            if !ctxs.isEmpty {   // when the vault is empty the Establish front door IS the surface
                LimeButton(label: "+ Establish a project") { OSLaunch.launchOr("bank", .init(kind: "project")) { onNavigate(.apps) } }
                if let f = viewing.flatMap(bankVaultFolder) {
                    OSWSGhostButton(label: "Open the folder") { NSWorkspace.shared.open(URL(fileURLWithPath: f)) }
                }
            }
        }
    }

    private var projectStrip: some View {
        // Wrap in a horizontally-scrollable row so the body never scrolls sideways.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(ctxs) { c in
                    OSWSProjectChip(name: c.name, kind: c.kind,
                                    active: viewing?.id == c.id,
                                    isGlobal: readDefaultId() == c.id) { activate(c.id) }
                        .contextMenu {
                            Button("Set active") { activate(c.id) }
                            Button("Rename…") { renaming = c; renameText = c.name }
                            if let f = bankVaultFolder(c) {
                                Button("Open folder") { NSWorkspace.shared.open(URL(fileURLWithPath: f)) }
                            }
                        }
                }
                if showNew {
                    HStack(spacing: 6) {
                        TextField("Project name", text: $newName)
                            .textFieldStyle(.plain).font(.hanken(13)).foregroundColor(.ink)
                            .frame(width: 150)
                            .onSubmit { createProject(newName) }
                        Button(action: { createProject(newName) }) {
                            Text("Add").font(.hanken(12, .semibold)).foregroundColor(.lime)
                        }.buttonStyle(.plain)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 11).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.lime.opacity(0.4), lineWidth: 1))
                } else {
                    NewOSWSProjectChip { showNew = true }
                }
            }
        }
    }

    private func facetTabs(_ c: BankCtx) -> some View {
        let folder = bankVaultFolder(c)
        let counts = (tasks: bankTasks(folder: folder).count,
                      brain: bankNotes(folder: folder).count,
                      artifacts: bankArtifacts(c).count)
        return HStack(spacing: 6) {
            BankTab(label: "Overview", count: nil, active: facet == .overview) { facet = .overview }
            BankTab(label: "Tasks", count: counts.tasks, active: facet == .tasks) { facet = .tasks }
            BankTab(label: "Brain", count: counts.brain, active: facet == .brain) { facet = .brain }
            BankTab(label: "Artifacts", count: counts.artifacts, active: facet == .artifacts) { facet = .artifacts }
            Spacer(minLength: 0)
        }
        .overlay(Rectangle().fill(Color.edgeSoft).frame(height: 1), alignment: .bottom)
    }

    @ViewBuilder private func facetBody(_ c: BankCtx) -> some View {
        let folder = bankVaultFolder(c)
        switch facet {
        case .overview:  BankOverview(fields: bankOverviewFields(c), onNavigate: onNavigate)
        case .tasks:     BankTaskList(folder: folder, onNavigate: onNavigate)
        case .brain:     BankBrainList(notes: bankNotes(folder: folder), onNavigate: onNavigate)
        case .artifacts: BankArtifactGrid(items: bankArtifacts(c), onNavigate: onNavigate)
        }
    }

    private func capture(_ c: BankCtx) -> some View {
        HStack(spacing: 14) {
            Text("＋").font(.system(size: 17)).foregroundColor(.inkDim)
                .frame(width: 38, height: 38)
                .background(RoundedRectangle(cornerRadius: 11).fill(Color(red: 0x0f / 255, green: 0x11 / 255, blue: 0x16 / 255)))
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.edge, lineWidth: 1))
            if let n = bankedNote {
                (Text("Banked ").font(.hanken(13, .medium)).foregroundColor(.lime)
                    + Text(n + " → Brain facet.").font(.hanken(13)).foregroundColor(.inkSec))
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                (Text("Copy anything, then \"Bank it.\" ").font(.hanken(13, .medium)).foregroundColor(.ink)
                    + Text("— the clipboard becomes a note on \(c.name), filed in \(bankVaultFolder(c) == nil ? "~/.relay/bank" : "its vault").").font(.hanken(13)).foregroundColor(.inkSec))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            LimeButton(label: "Bank it") {
                bankedNote = bankCapture(c)
                if bankedNote != nil { facet = .brain }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(red: 0x0e / 255, green: 0x0f / 255, blue: 0x14 / 255)))
        .overlay(RoundedRectangle(cornerRadius: 14)
            .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundColor(.edge))
    }
}

// The Establish front door — the whole surface when the vault is empty (the OS's true onboarding root).
private struct BankEstablishState: View {
    let onNavigate: (Surface) -> Void
    let onCreate: (String) -> Void
    @State private var name = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Point Switchboard at what you're working on.")
                .font(.brico(22, .bold)).foregroundColor(.ink)
            Text("A project is a few .md files you own — essence, tasks, notes, artifacts. Establish one from a site or repo, or start blank.")
                .font(.hanken(13.5)).foregroundColor(.inkSec)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                LimeButton(label: "+ Establish a project") { OSLaunch.launchOr("bank", .init(kind: "project")) { onNavigate(.apps) } }
                TextField("…or name a blank one", text: $name)
                    .textFieldStyle(.plain).font(.hanken(13)).foregroundColor(.ink)
                    .frame(width: 190)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.edge, lineWidth: 1))
                    .onSubmit { onCreate(name) }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
    }
}

// contexts.json exists but won't parse — say exactly that, offer the folder. Never a silent blank.
private struct BankErrorBanner: View {
    var body: some View {
        HStack(spacing: 12) {
            Text("!").font(.splMono(13)).foregroundColor(.amber)
            (Text("Can't read your Bank ").font(.hanken(13, .medium)).foregroundColor(.ink)
                + Text("— ~/.relay/contexts.json exists but didn't parse as JSON.").font(.hanken(13)).foregroundColor(.inkSec))
            Spacer(minLength: 0)
            OSWSGhostButton(label: "Open ~/.relay") {
                NSWorkspace.shared.open(URL(fileURLWithPath: (NSHomeDirectory() as NSString).appendingPathComponent(".relay")))
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.amber.opacity(0.4), lineWidth: 1))
    }
}

// The active-project hero — flat panel, indigo accent, real name/essence/vault path.
private struct BankHero: View {
    let c: BankCtx
    let folder: String?
    private var essence: String {
        for k in ["oneLine", "positioning", "idea", "summary", "audience"] {
            if let v = c.data[k] as? String, !v.isEmpty { return v.count > 110 ? String(v.prefix(108)) + "…" : v }
        }
        if let prods = c.data["products"] as? [String], let p = prods.first, !p.isEmpty {
            return p.count > 110 ? String(p.prefix(108)) + "…" : p
        }
        return c.kind
    }
    var body: some View {
        HStack(spacing: 16) {
            Monogram(name: c.name, hue: hueForId(c.id), size: 46)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(c.name).font(.hanken(17, .semibold)).foregroundColor(.ink)
                    Text(c.kind.uppercased()).font(.splMono(9.5)).tracking(1.2).foregroundColor(kindTint(c.kind))
                }
                Text(essence).font(.hanken(12.5)).foregroundColor(.inkDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Text(folder.map { ($0 as NSString).abbreviatingWithTildeInPath } ?? "no folder bound — capture goes to ~/.relay/bank")
                .font(.splMono(11)).foregroundColor(.inkFaint)
                .lineLimit(1).truncationMode(.head)
        }
        .padding(.horizontal, 22).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.indigo).frame(width: 2).clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
}

private struct OSWSProjectChip: View {
    let name: String
    let kind: String
    let active: Bool          // the chip being viewed here
    let isGlobal: Bool        // the OS-wide active project (context-selection.json)
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Circle().fill(active ? kindTint(kind) : Color.inkFaint).frame(width: 8, height: 8)
                Text(name).font(.hanken(13)).foregroundColor(active ? .ink : .inkSec)
                if isGlobal {
                    Text("active").font(.splMono(10)).foregroundColor(.lime)
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
    let fields: [OverviewField]
    let onNavigate: (Surface) -> Void
    let cols = [GridItem(.adaptive(minimum: 220), spacing: 12)]
    var body: some View {
        if fields.isEmpty {
            // a blank facet is always a verb — nothing invented
            BankViewAllRow(label: "Nothing established yet — extract this project's essence in Bank") {
                OSLaunch.launchOr("bank") { onNavigate(.apps) }
            }
        } else {
            LazyVGrid(columns: cols, alignment: .leading, spacing: 12) {
                ForEach(fields) { OverviewFieldView(field: $0) }
            }
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
    let folder: String?
    let onNavigate: (Surface) -> Void
    @State private var adding = ""
    @State private var version = 0     // bump to re-read after an add
    private var live: [BankTask] { _ = version; return bankTasks(folder: folder) }
    var body: some View {
        VStack(spacing: 8) {
            if folder == nil {
                BankViewAllRow(label: "No vault folder bound — bind one in the panel to keep a tasks.md") { onNavigate(.tasks) }
            } else {
                ForEach(live) { t in
                    BankRow(box: stateColor(t.state), boxFill: stateFill(t.state), glyph: nil,
                            title: t.t, dim: nil, meta: t.meta) { onNavigate(.tasks) }
                }
                HStack(spacing: 10) {
                    Text("+").font(.splMono(12)).foregroundColor(.inkFaint)
                    TextField(live.isEmpty ? "No tasks.md yet — add the first task" : "Add a task — appends to tasks.md",
                              text: $adding)
                        .textFieldStyle(.plain).font(.hanken(13)).foregroundColor(.ink)
                        .onSubmit { submit() }
                    if !adding.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button(action: submit) {
                            Text("Add").font(.hanken(12, .semibold)).foregroundColor(.lime)
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 15).padding(.vertical, 11)
                .background(RoundedRectangle(cornerRadius: 11)
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundColor(.edge))
                if !live.isEmpty { BankViewAllRow(label: "View all in Tasks") { onNavigate(.tasks) } }
            }
        }
    }
    private func submit() {
        guard let folder, !adding.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        if osAppendTask(folder: folder, text: adding) { adding = ""; version += 1 }
    }
    private func stateColor(_ s: String) -> Color {
        s == "done" ? .lime : (s == "now" ? .indigo : (s == "blocked" ? .danger : .edge))
    }
    private func stateFill(_ s: String) -> Color {
        s == "done" ? Color.lime.opacity(0.14) : (s == "now" ? Color.indigo.opacity(0.14) : (s == "blocked" ? Color.danger.opacity(0.14) : .clear))
    }
}

private struct BankBrainList: View {
    let notes: [BrainNote]
    let onNavigate: (Surface) -> Void
    var body: some View {
        VStack(spacing: 8) {
            if notes.isEmpty {
                BankViewAllRow(label: "Nothing banked yet — copy something and hit \"Bank it\"") { }
            } else {
                ForEach(notes) { n in
                    BankRow(box: nil, boxFill: nil, glyph: "▤",
                            title: n.t, dim: n.note.isEmpty ? nil : "— " + n.note, meta: n.src) {
                        NSWorkspace.shared.open(URL(fileURLWithPath: n.path))
                    }
                }
            }
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
    let items: [BankArtifactItem]
    let onNavigate: (Surface) -> Void
    let cols = [GridItem(.adaptive(minimum: 150), spacing: 12)]
    var body: some View {
        if items.isEmpty {
            BankViewAllRow(label: "No artifacts yet — run an app on this project") { onNavigate(.apps) }
        } else {
            LazyVGrid(columns: cols, spacing: 12) {
                ForEach(items) { a in
                    BankArtifactCard(art: a) {
                        OSLaunch.launchOr(a.src, .init(artifact: a.t, kind: a.kind)) { onNavigate(.apps) }
                    }
                }
            }
        }
    }
}

private struct BankArtifactCard: View {
    let art: BankArtifactItem
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                ZStack { ArtifactThumb(kind: art.kind, hue: hueForId(art.src)) }
                    .frame(maxWidth: .infinity).frame(height: 84)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color(red: 0x0d / 255, green: 0x0e / 255, blue: 0x13 / 255)))
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
