// ════════════════════════ the ⌥⌥ notch LAUNCHER ════════════════════════
// The app-FIRST notch drop — the mouse/keyboard twin of the ⌃⌃ voice flow. Double-tapping Option drops
// this from the notch: a project chip, a search field, a FILE-INTAKE bar, and a grid of wrapp app tiles.
// Drop a file, then click an app → the file is handed to that app's widget; click with no file staged and
// the app just opens. File-capable wrapps get a lime ring + "↦ file" badge when a file is staged; the rest
// dim. Presentation (the notch panel + the ⌥⌥ gesture) lives in RelayMenuBar — this file is view-only.
//
// Same module as RelayMenuBar.swift, so it reuses the house types directly: SBListing / Ctx, the Color and
// Font tokens, SB/SBr spacing+radius, NotchDropShape, ProjectChip, storeIcon()/catTint()/catGlyph(), and
// the .sbCard()/.kicker() view chrome. Nothing here is re-declared.

import AppKit
import SwiftUI
import UniformTypeIdentifiers   // UTType.fileURL for the file-intake drop target

// A native file-drop catcher for the launcher intake bar — the SAME proven notch-drop plumbing the talking
// pill uses (FileDropView): register BOTH `.fileURL` AND the legacy NSFilenamesPboardType (Finder / Dock
// stacks hand files over as one or the other — registering only `.fileURL`, as the old SwiftUI `.onDrop`
// did, silently missed the filenames case), an OPAQUE full-bounds hit area (a clear view only takes a drop
// where it has drawn pixels), and NO NSApp.activate (that would silence the global ⌥⌥ monitor). SwiftUI
// lays this out to the intake bar's bounds, so there's no manual notch-frame math. The LauncherPanel is
// already key-capable (canBecomeKey = true), which is the other half of why the drop now lands.
struct FileDropCatcher: NSViewRepresentable {
    var onDrop: (URL) -> Void
    var onTargeted: (Bool) -> Void
    func makeNSView(context: Context) -> DropCatchNSView {
        let v = DropCatchNSView(); v.onDropURL = onDrop; v.onTargeted = onTargeted; return v
    }
    func updateNSView(_ v: DropCatchNSView, context: Context) { v.onDropURL = onDrop; v.onTargeted = onTargeted }
}

final class DropCatchNSView: NSView {
    var onDropURL: ((URL) -> Void)?
    var onTargeted: ((Bool) -> Void)?
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 0, alpha: 0.02).cgColor   // opaque hit area — a clear view only accepts drops on drawn pixels
        registerForDraggedTypes([.fileURL, NSPasteboard.PasteboardType("NSFilenamesPboardType")])
    }
    required init?(coder: NSCoder) { fatalError() }
    private func fileURLs(_ s: NSDraggingInfo) -> [URL] {
        let pb = s.draggingPasteboard
        if let u = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !u.isEmpty { return u }
        if let names = pb.propertyList(forType: NSPasteboard.PasteboardType("NSFilenamesPboardType")) as? [String], !names.isEmpty { return names.map { URL(fileURLWithPath: $0) } }
        return []
    }
    override func draggingEntered(_ s: NSDraggingInfo) -> NSDragOperation {
        let ok = !fileURLs(s).isEmpty; onTargeted?(ok); return ok ? .copy : []   // NO NSApp.activate — keeps the ⌥⌥ monitor alive
    }
    override func draggingUpdated(_ s: NSDraggingInfo) -> NSDragOperation { fileURLs(s).isEmpty ? [] : .copy }
    override func draggingExited(_ s: NSDraggingInfo?) { onTargeted?(false) }
    override func draggingEnded(_ s: NSDraggingInfo) { onTargeted?(false) }
    override func prepareForDragOperation(_ s: NSDraggingInfo) -> Bool { !fileURLs(s).isEmpty }
    override func performDragOperation(_ s: NSDraggingInfo) -> Bool {
        onTargeted?(false)
        guard let u = fileURLs(s).first else { return false }
        onDropURL?(u); return true
    }
}

// One open task, flattened for the launcher's TASKS section. The host maps the live board
// (osTasksAll()) into these — a lean value so previews/snapshots build one without the full RealTask.
struct LaunchTask: Identifiable {
    let id = UUID()
    let title: String       // clean task title (dialect tokens already stripped)
    let meta: String        // one-line context: due / epic / @wrapp — already composed by the host
    let col: String         // resolved kanban column: doing | todo | review | blocked
    let over: Bool          // past its due date
    let prio: String?       // high | med | low
}

struct NotchLauncherView: View {
    // ---- inputs (see the init doc for the exact contract the host wires up) ----
    let listings: [SBListing]                     // the live catalog, already filtered to what should appear
    let projects: [Ctx]                           // the project/context list for the chip
    let recent: [SBArtifact]                       // recent artifacts across wrapps (spotlight "Recent" + home rows)
    let tasks: [LaunchTask]                        // the live board's open tasks (doing/todo/…), host-ordered — the HOME hero
    let vaultFolders: [String]                     // bound vault folders → Spotlight file search scope (spotlight "Files")
    let homeProjects: [SBProject]                  // recency-sorted projects (the notch HOME rows)
    let activeProjectId: String?                  // the currently-grounded project (nil → "no project")
    let onPickProject: (String?) -> Void          // chip → set the global context (nil = unconnected)
    let onLaunch: (SBListing, URL?) -> Void        // tile → launch this wrapp's widget, with the staged file if it takes one
    let onRunTool: (SBListing, String) -> Void     // spotlight → RUN a third-party tool (no UI) with the typed query as input
    let onOpenSurface: (String) -> Void            // spotlight "go to" → open the OS window at a surface (rawValue)
    let onAsk: (String) -> Void                    // spotlight "ask" / mic → hand the query to God (empty = voice)
    let onClose: () -> Void                        // ⌥⌥ again / Esc — the host dismisses the drop

    init(listings: [SBListing],
         projects: [Ctx],
         recent: [SBArtifact] = [],
         tasks: [LaunchTask] = [],
         vaultFolders: [String] = [],
         homeProjects: [SBProject] = [],
         activeProjectId: String?,
         onPickProject: @escaping (String?) -> Void,
         onLaunch: @escaping (SBListing, URL?) -> Void,
         onRunTool: @escaping (SBListing, String) -> Void = { _, _ in },
         onOpenSurface: @escaping (String) -> Void = { _ in },
         onAsk: @escaping (String) -> Void = { _ in },
         onClose: @escaping () -> Void) {
        self.listings = listings
        self.projects = projects
        self.recent = recent
        self.tasks = tasks
        self.vaultFolders = vaultFolders
        self.homeProjects = homeProjects
        self.activeProjectId = activeProjectId
        self.onPickProject = onPickProject
        self.onLaunch = onLaunch
        self.onRunTool = onRunTool
        self.onOpenSurface = onOpenSurface
        self.onAsk = onAsk
        self.onClose = onClose
    }

    // ---- local state ----
    @State private var query: String = ""
    @State private var cat: String? = nil            // selected category tab (nil = All) — fewer apps per glance
    @State private var staged: StagedFile? = nil     // the file handed to the next app clicked
    @State private var dropTargeted: Bool = false
    @State private var hoveredId: String? = nil
    @State private var spotSel: Int = 0              // ↑↓ selection index into spotAll (spotlight rows)
    @State private var diskResults: [SpotFile] = []  // Spotlight file hits for the current query (async)
    @State private var findGen: Int = 0              // debounce/cancel token for the async file search
    @State private var clipOffer: String? = nil      // the clipboard string offered as an addable context object (opt-in; nil once added)
    @FocusState private var searchFocused: Bool      // keep the field focused across grid re-renders

    // A dropped file + its human-readable size, resolved once at drop time.
    private struct StagedFile { let url: URL; let sizeText: String; let isImage: Bool }

    // The one place the "which wrapps accept a dropped file" rule lives — now TYPE-AWARE (SBRoute).
    // It used to be a bare id allowlist, so a dropped .pdf lit up the image tools exactly as brightly as
    // the PDF one. A listing's manifest `accepts` is authoritative; SBRoute.defaultAccepts carries the
    // founder's original allowlist with the missing half (the file kind) finally attached.
    private var stagedKind: SBRoute.Kind? { staged.map { SBRoute.kind(forPath: $0.url.path) } }
    /// True when this listing can take the file that's staged RIGHT NOW (or, with nothing staged, when it
    /// takes files at all — that's the resting affordance).
    private func canTakeFile(_ l: SBListing) -> Bool {
        guard let k = stagedKind else { return SBRoute.takesAnyFile(id: l.id, declared: l.accepts) }
        return SBRoute.accepts(id: l.id, declared: l.accepts, kind: k)
    }

    // The searchable material of a listing, in the shape the router reads.
    private func routeFields(_ l: SBListing) -> SBRoute.Fields {
        SBRoute.Fields(id: l.id, name: l.name, keywords: l.keywords ?? [], tagline: l.tagline,
                       inside: l.inside ?? [],
                       commands: l.tools?.map { $0.name + " " + ($0.description ?? "") } ?? [])
    }
    /// Rank listings against the typed query. One scorer for first-party apps AND third-party tools —
    /// they used to have two (substring vs token-count), which is why "make this image smaller" found
    /// the Hacker News tool but not Resize.
    private func ranked(_ pool: [SBListing], _ q: String, limit: Int) -> [SBListing] {
        guard !q.isEmpty else { return [] }
        var scored: [(l: SBListing, s: Int)] = []
        for l in pool {
            let s = SBRoute.score(q, routeFields(l))
            if s > 0 { scored.append((l, s)) }
        }
        scored.sort { a, b in a.s == b.s ? a.l.name < b.l.name : a.s > b.s }
        return scored.prefix(limit).map { $0.l }
    }

    private var filtered: [SBListing] {
        var l = listings
        if let c = cat { l = l.filter { $0.category == c } }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty { l = ranked(l, q, limit: l.count) }
        return l
    }
    private var categories: [String] { Array(Set(listings.map { $0.category })).sorted() }
    private func catLabel(_ c: String) -> String {
        switch c { case "studio": return "Make"; case "tool": return "Tools"; case "fun": return "Fun"; case "agent": return "Agents"; default: return c.capitalized }
    }

    // ── SPOTLIGHT — the ⌥⌥ bar reaches ANYWHERE: projects · apps · surfaces · actions. When the query is
    //    non-empty the app grid is replaced by grouped results, each leading somewhere. (docs: command centre)
    private enum SpotKind { case project, app, tool, file, diskfile, surface, action }
    private struct SpotRow: Identifiable { let id: String; let kind: SpotKind; let label: String; let sub: String; let payload: String }
    private var q: String { query.trimmingCharacters(in: .whitespaces).lowercased() }
    private var spotProjects: [SpotRow] {
        projects.filter { q.isEmpty || $0.name.lowercased().contains(q) }.prefix(6).map {
            SpotRow(id: "p-" + $0.id, kind: .project, label: $0.name, sub: $0.kind, payload: $0.id) }
    }
    // APPS surface by INTENT, not by containing the letters you typed. "make this image smaller" has to
    // reach Resize even though no listing anywhere contains the word "smaller" — that's what a manifest's
    // `keywords` is for, and SBRoute.score is what reads it. (Was: a raw substring test on name+tagline.)
    private var spotApps: [SpotRow] {
        ranked(listings.filter { !$0.isThirdParty }, q, limit: 6).map {
            SpotRow(id: "a-" + $0.id, kind: .app, label: $0.name, sub: $0.tagline, payload: $0.id) }
    }
    // THIRD-PARTY TOOLS ride the SAME scorer — name + tagline + what's-inside + their commands' descriptions
    // (the capability). So "find me trending AI news" still finds the Hacker News tool via its description,
    // and picking it RUNS it (onRunTool) with the query as input — no need to know the tool's name.
    private var spotTools: [SpotRow] {
        ranked(listings.filter { $0.isThirdParty }, q, limit: 5).map {
            SpotRow(id: "t-" + $0.id, kind: .tool, label: $0.name, sub: $0.tagline, payload: $0.id) }
    }
    // ── DROP A FILE, GET THE RIGHT TOOLS ── with a file staged and nothing typed, the launcher answers
    // "what can I do with this?" itself: every listing that accepts THIS KIND of file, named by kind so
    // the offer is legible ("PDF · 3 tools"). Before, a staged file only ringed a fixed id allowlist in
    // the app rail — a dropped .pdf lit the image tools too, and you still had to know which to click.
    private var spotForFile: [SpotRow] {
        guard let f = staged, let k = stagedKind else { return [] }
        let pool = listings.filter { SBRoute.accepts(id: $0.id, declared: $0.accepts, kind: k) }
        // With a query typed, rank by intent within the accepting set; with nothing typed, offer them all.
        let hits = q.isEmpty ? pool : ranked(pool, q, limit: pool.count)
        return hits.prefix(6).map {
            SpotRow(id: "f-" + $0.id, kind: .app, label: $0.name,
                    sub: "run on \(f.url.lastPathComponent)", payload: $0.id) }
    }
    private var spotRecent: [SpotRow] {
        (q.isEmpty ? [] : recent.filter { $0.title.lowercased().contains(q) || $0.app.lowercased().contains(q) }).prefix(5).enumerated().map { (i, a) in
            SpotRow(id: "r-\(i)-" + a.title, kind: .file, label: a.title, sub: "\(a.app) · \(a.time)", payload: a.app) }
    }
    private var spotDiskFiles: [SpotRow] {
        diskResults.prefix(7).map {
            SpotRow(id: "d-" + $0.path, kind: .diskfile, label: $0.name, sub: $0.folder, payload: $0.path) }
    }
    private var spotSurfaces: [SpotRow] {
        (q.isEmpty ? [] : Surface.allCases.filter { $0.title.lowercased().contains(q) }).map {
            SpotRow(id: "s-" + $0.rawValue, kind: .surface, label: $0.title, sub: "surface", payload: $0.rawValue) }
    }
    private var spotActions: [SpotRow] {
        q.isEmpty ? [] : [SpotRow(id: "act-ask", kind: .action, label: "“\(query.trimmingCharacters(in: .whitespaces))”", sub: "ask across your work", payload: "ask")]
    }
    // ONE ordered list of groups — both the rendering and the ↑↓ selection index derive from it. They used
    // to be written out separately and had drifted: `spotAll` counted spotTools but `spotlightList` never
    // rendered a Tools group, so arrowing down could select a row that wasn't on screen.
    private var spotGroups: [(String, [SpotRow])] {
        [("For this file", spotForFile), ("Projects", spotProjects), ("Apps", spotApps), ("Tools", spotTools),
         ("Files", spotDiskFiles), ("Recent", spotRecent), ("Go to", spotSurfaces), ("Actions", spotActions)]
            .filter { !$0.1.isEmpty }
    }
    private var spotAll: [SpotRow] { spotGroups.flatMap { $0.1 } }
    private func listing(forApp id: String) -> SBListing? {
        listings.first { $0.id.caseInsensitiveCompare(id) == .orderedSame || $0.name.caseInsensitiveCompare(id) == .orderedSame }
    }

    private func choose(_ r: SpotRow) {
        switch r.kind {
        case .project:  onPickProject(r.payload); onClose()
        case .app:      if let l = listings.first(where: { $0.id == r.payload }) { onLaunch(l, staged?.url) }
        case .tool:     if let l = listings.first(where: { $0.id == r.payload }) { onRunTool(l, query.trimmingCharacters(in: .whitespaces)); onClose() }
        case .file:     if let l = listing(forApp: r.payload) { onLaunch(l, staged?.url) } else { onClose() }   // artifact → open in its wrapp
        case .diskfile: NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: r.payload)]); onClose()  // real file → reveal in Finder
        case .surface:  onOpenSurface(r.payload); onClose()
        case .action:   onAsk(query.trimmingCharacters(in: .whitespaces)); onClose()
        }
    }

    @ViewBuilder private func spotIcon(_ r: SpotRow) -> some View {
        switch r.kind {
        case .project:
            IsoTile(hue: hueForId(r.payload)).frame(width: 24, height: 24)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.raised))
        case .app:
            if let img = storeIcon(r.payload) {
                Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fill)
                    .frame(width: 24, height: 24).clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                RoundedRectangle(cornerRadius: 6).fill(Color.raised).frame(width: 24, height: 24)
                    .overlay(Image(systemName: "square.grid.2x2").font(.system(size: 11)).foregroundColor(.inkDim))
            }
        case .tool:
            RoundedRectangle(cornerRadius: 6).fill(Color.lime.opacity(0.12)).frame(width: 24, height: 24)
                .overlay(Image(systemName: "wrench.and.screwdriver").font(.system(size: 11)).foregroundColor(.lime))
        case .file:
            RoundedRectangle(cornerRadius: 6).fill(Color.raised).frame(width: 24, height: 24)
                .overlay(Image(systemName: "doc.text").font(.system(size: 11)).foregroundColor(.inkDim))
        case .diskfile:
            RoundedRectangle(cornerRadius: 6).fill(Color.raised).frame(width: 24, height: 24)
                .overlay(Image(systemName: "folder").font(.system(size: 10)).foregroundColor(.inkDim))
        case .surface:
            RoundedRectangle(cornerRadius: 6).fill(Color.raised).frame(width: 24, height: 24)
                .overlay(Image(systemName: "rectangle.split.2x1").font(.system(size: 10)).foregroundColor(.inkDim))
        case .action:
            RoundedRectangle(cornerRadius: 6).fill(Color.lime.opacity(0.15)).frame(width: 24, height: 24)
                .overlay(Text("✦").font(.splMono(12)).foregroundColor(.lime))
        }
    }

    private func spotRowView(_ r: SpotRow) -> some View {
        let sel = spotAll.indices.contains(spotSel) && spotAll[spotSel].id == r.id
        let lit = sel || hoveredId == r.id
        return Button(action: { choose(r) }) {
            HStack(spacing: 10) {
                spotIcon(r)
                VStack(alignment: .leading, spacing: 1) {
                    Text(r.label).font(.hanken(12.5, .semibold)).foregroundColor(.ink).lineLimit(1)
                    Text(r.sub).font(.hanken(10.5)).foregroundColor(.inkDim).lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(r.kind == .project ? "switch" : (r.kind == .app || r.kind == .file) ? "open" : r.kind == .diskfile ? "reveal" : r.kind == .surface ? "go" : "↵")
                    .font(.splMono(9)).foregroundColor(sel ? .lime : .inkFaint)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(sel ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1))
            }
            .padding(.horizontal, 8).padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 8).fill(lit ? Color.raised : Color.clear))
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
         .onHover { hoveredId = $0 ? r.id : (hoveredId == r.id ? nil : hoveredId) }
    }

    // ── the notch HOME — a compact command centre in the drop, laid out with the notch panel's section
    //    grammar: each block leads with a `KICKER · count` header + hairline divider, so the launcher reads
    //    like the hover menu (docs: notch panel). TASKS leads — the launcher is a "what do I do next" surface,
    //    so the live queue is the hero — then JUMP BACK IN · RECENT PROJECTS · RECENT WORK. Acting opens the
    //    real thing (task → the Tasks board; project → the full Home grounded on it; artifact → its wrapp).
    private var homeContent: some View {
        let active = homeProjects.first { $0.id == activeProjectId } ?? homeProjects.first
        let ordered = [active].compactMap { $0 } + homeProjects.filter { $0.id != active?.id }
        let work = recent.prefix(3)
        let openTasks = Array(tasks.prefix(6))
        let apps = Array(listings.filter { !$0.isThirdParty }.prefix(10))
        let empty = openTasks.isEmpty && ordered.isEmpty && work.isEmpty && apps.isEmpty
        // Drop a file and the launcher answers "what can I do with this?" before you type anything —
        // every app that accepts THIS KIND of file, named by kind, leading the drop.
        let forFile = stagedKind.map { k in listings.filter { SBRoute.accepts(id: $0.id, declared: $0.accepts, kind: k) } } ?? []
        return VStack(alignment: .leading, spacing: SB.s3) {
            if let k = stagedKind {
                homeKicker("FOR THIS \(k.label.uppercased())", count: forFile.isEmpty ? nil : forFile.count,
                           trailing: nil, action: nil)
                if forFile.isEmpty {
                    // Honest empty state: say nothing takes it AND name the one thing that always can.
                    Text("No app here takes a \(k.label). Ask below and God will work on it directly.")
                        .font(.hanken(11)).foregroundColor(.inkFaint)
                        .padding(.horizontal, 9).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.02)))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.edgeSoft, lineWidth: 1))
                } else {
                    rail { ForEach(forFile) { l in homeAppTile(l) } }
                }
            }
            if empty {
                homeEmptyState
            } else {
                // Each section is a horizontal CARD RAIL (was a vertical stack of thin rows). Tasks lead — the
                // launcher is a "what next" surface — then the visual app tiles, then projects, then recent work.
                if !openTasks.isEmpty {
                    homeKicker("TASKS", count: tasks.count, trailing: "board ↗") { onOpenSurface("tasks") }
                    rail { ForEach(openTasks) { t in taskCard(t) } }
                }
                if !apps.isEmpty {
                    homeKicker("APPS", count: apps.count, trailing: "all ↗") { onOpenSurface("apps") }
                    rail { ForEach(apps) { l in homeAppTile(l) } }
                }
                if !ordered.isEmpty {
                    homeKicker("PROJECTS", count: homeProjects.count, trailing: "open home ↗") { onOpenSurface("home") }
                    rail { ForEach(ordered) { p in projectCard(p, isActive: p.id == active?.id) } }
                }
                if !work.isEmpty {
                    homeKicker("RECENT WORK", count: nil, trailing: nil, action: nil)
                    VStack(alignment: .leading, spacing: 2) { ForEach(Array(work)) { w in notchWorkRow(w) } }
                }
            }
        }
    }

    // A horizontal card rail — cards wider than the drop scroll; the clipped peek signals "there's more →".
    @ViewBuilder private func rail<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: SB.s3) { content() }.padding(.vertical, 1)
        }
    }

    // First run / nothing bound yet — never a blank drop. Point at the two doors that populate HOME.
    private var homeEmptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Nothing queued yet").font(.hanken(13, .semibold)).foregroundColor(.ink)
            Text("Type to search apps, projects and files — or drop a file above to run it. Tasks you add to your board show up here.")
                .font(.hanken(11)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 9).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.02)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.edgeSoft, lineWidth: 1))
    }

    private var homeDivider: some View {
        Rectangle().fill(Color.edge).frame(height: 1).padding(.vertical, 2)
    }

    // Section header in the notch-panel grammar: KICKER · count on the left, an optional lime action on the right.
    private func homeKicker(_ t: String, count: Int?, trailing: String?, action: (() -> Void)?) -> some View {
        HStack(spacing: 6) {
            Text(t).font(.splMono(9)).tracking(1.4).foregroundColor(.inkFaint)
            if let c = count, c > 0 {
                Text("·").font(.splMono(9)).foregroundColor(.inkFaint)
                Text("\(c)").font(.splMono(9)).foregroundColor(.inkDim)
            }
            Spacer(minLength: 0)
            if let tr = trailing {
                Text(tr).font(.hanken(10.5, .medium)).foregroundColor(.lime)
                    .contentShape(Rectangle()).onTapGesture { action?() }
            }
        }.padding(.top, 3)
    }

    // ── a live board task as a RAIL CARD: status glyph + pill up top, title (2 lines), meta pinned to base.
    //    Tapping opens the Tasks board (the launcher stays a jump-off, the board is where you work it).
    private func taskCard(_ t: LaunchTask) -> some View {
        let hovering = hoveredId == "tk-" + t.id.uuidString
        return Button(action: { onOpenSurface("tasks") }) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 0) {
                    Text(taskGlyph(t)).font(.splMono(13)).foregroundColor(taskTint(t))
                    Spacer(minLength: 0)
                    if t.col == "doing" {
                        Text("DOING").font(.splMono(7)).tracking(0.8).foregroundColor(.lime)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.lime.opacity(0.4), lineWidth: 1))
                    } else if t.col == "blocked" {
                        Text("BLOCKED").font(.splMono(7)).tracking(0.8).foregroundColor(.amber)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.amber.opacity(0.35), lineWidth: 1))
                    } else if let p = t.prio, p == "high" {
                        Circle().fill(Color.amber).frame(width: 5, height: 5)
                    }
                }
                Text(t.title).font(.hanken(12.5, .semibold)).foregroundColor(.ink)
                    .lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if !t.meta.isEmpty {
                    Text(t.meta).font(.hanken(9.5)).foregroundColor(t.over ? .amber : .inkFaint).lineLimit(1)
                }
            }
            .padding(11)
            .frame(width: 178, height: 112, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: SBr.sm).fill(hovering ? Color.raised : Color.white.opacity(0.02)))
            .overlay(RoundedRectangle(cornerRadius: SBr.sm).stroke(t.col == "doing" ? Color.lime.opacity(0.35) : Color.edgeSoft, lineWidth: 1))
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
         .onHover { hoveredId = $0 ? "tk-" + t.id.uuidString : (hoveredId == "tk-" + t.id.uuidString ? nil : hoveredId) }
    }
    private func taskGlyph(_ t: LaunchTask) -> String {
        switch t.col { case "doing": return "◐"; case "review": return "◑"; case "blocked": return "⊘"; default: return "○" }
    }
    private func taskTint(_ t: LaunchTask) -> Color {
        if t.over { return .amber }
        switch t.col { case "doing", "review": return .lime; case "blocked": return .amber; default: return .inkDim }
    }

    // ── an APP as a big visual tile in the home rail — real icon, staged-file ring/dim, one-tap launch. ──
    private func homeAppTile(_ l: SBListing) -> some View {
        let takes = canTakeFile(l)
        let hasFile = staged != nil
        let dimmed = hasFile && !takes
        let ringed = hasFile && takes
        let hovering = hoveredId == "ha-" + l.id
        return Button(action: { onLaunch(l, takes ? staged?.url : nil) }) {
            VStack(spacing: 7) {
                tileArt(l, size: 54)
                    .overlay(alignment: .topTrailing) {
                        if ringed {
                            Image(systemName: "arrow.down.circle.fill").font(.system(size: 13))
                                .foregroundColor(.lime).background(Circle().fill(Color.page)).offset(x: 4, y: -4)
                        }
                    }
                    .overlay(RoundedRectangle(cornerRadius: 54 * 0.24)
                        .stroke(ringed ? Color.lime.opacity(0.7) : Color.clear, lineWidth: 1.5))
                Text(l.name).font(.hanken(10)).foregroundColor(.inkDim).lineLimit(1)
            }
            .frame(width: 68)
            .opacity(dimmed ? 0.4 : 1)
            .offset(y: hovering && !dimmed ? -2 : 0)
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
         .animation(.spring(response: 0.22, dampingFraction: 0.8), value: hovering)
         .onHover { hoveredId = $0 ? "ha-" + l.id : (hoveredId == "ha-" + l.id ? nil : hoveredId) }
         .help(takes && hasFile ? "Run \(l.name) on \(staged?.url.lastPathComponent ?? "the file")" : "Open \(l.name)")
    }

    // ── a PROJECT as a rail card — big monogram tile, essence, updated time; active gets the indigo edge. ──
    private func projectCard(_ p: SBProject, isActive: Bool) -> some View {
        let hovering = hoveredId == "hp-" + p.id
        return Button(action: {
            if !isActive { onPickProject(p.id) }
            onOpenSurface("home")                       // acting on a project opens the full Home, grounded
        }) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 0) {
                    Monogram(name: p.name, hue: hueForId(p.id), size: 38)
                    Spacer(minLength: 0)
                    if isActive {
                        Text("ACTIVE").font(.splMono(7)).tracking(0.7).foregroundColor(.lime)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.lime.opacity(0.4), lineWidth: 1))
                    } else if p.pending > 0 {
                        Text("\(p.pending)").font(.splMono(9)).foregroundColor(.amber)
                    }
                }
                Text(p.name).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
                Text(p.essence.isEmpty ? p.kind : p.essence).font(.hanken(10.5)).foregroundColor(.inkFaint)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Text(p.updated.isEmpty ? p.kind : p.updated).font(.splMono(9)).foregroundColor(.inkFaint)
            }
            .padding(11)
            .frame(width: 160, height: 140, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: SBr.sm).fill(hovering ? Color.raised : Color.white.opacity(0.02)))
            .overlay(RoundedRectangle(cornerRadius: SBr.sm).stroke(isActive ? Color.indigo.opacity(0.5) : Color.edgeSoft, lineWidth: 1))
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
         .onHover { hoveredId = $0 ? "hp-" + p.id : (hoveredId == "hp-" + p.id ? nil : hoveredId) }
    }
    private func notchWorkRow(_ w: SBArtifact) -> some View {
        Button(action: { if let l = listing(forApp: w.app) { onLaunch(l, staged?.url) } }) {
            HStack(spacing: 10) {
                Image(systemName: "doc.text").font(.system(size: 10)).foregroundColor(.inkDim).frame(width: 26)
                Text(w.title).font(.hanken(12)).foregroundColor(.inkSec).lineLimit(1)
                Spacer(minLength: 6)
                Text("\(w.app) · \(w.time)").font(.splMono(9)).foregroundColor(.inkFaint)
            }
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 8).fill(hoveredId == "hw-" + w.title ? Color.raised : Color.clear))
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
         .onHover { hoveredId = $0 ? "hw-" + w.title : (hoveredId == "hw-" + w.title ? nil : hoveredId) }
    }

    private var spotlightList: some View {
        let groups = spotGroups
        return ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                if groups.isEmpty {
                    Text("Nothing matches “\(query)” — try a project, an app, or ask.")
                        .font(.hanken(11.5)).foregroundColor(.inkDim).padding(10)
                }
                ForEach(groups, id: \.0) { g in
                    Text(g.0.uppercased()).font(.splMono(9)).tracking(1.2).foregroundColor(.inkFaint)
                        .padding(.horizontal, 8).padding(.top, 8).padding(.bottom, 3)
                    ForEach(g.1) { r in spotRowView(r) }
                }
            }
        }.frame(maxHeight: 300)
    }

    private let cols = Array(repeating: GridItem(.flexible(), spacing: SB.s3), count: 5)

    var body: some View {
        VStack(alignment: .leading, spacing: SB.s3) {
            header
            askHero
            intakeBar
            if q.isEmpty {
                // HOME mode (founder: "the home should show up in the notch; a window only when you act") —
                // active project · recent projects · recent work, as compact rows. Any tap = the action.
                if staged == nil, let c = clipOffer { clipboardOfferRow(c) }   // opt-in: the clipboard as addable context
                homeContent
            } else {
                // spotlight mode — one query reaches projects · apps · files · surfaces · actions
                spotlightList
            }
            hintLine
        }
        .padding(.horizontal, 22).padding(.top, SB.s5).padding(.bottom, 22)
        .frame(width: WK.width, alignment: .leading)
        .padding(.horizontal, WK.ear)     // room for the notch "ears" (the shape flares to full width at top)
        .background(Color.page)
        .clipShape(NotchDropShape())
        .ignoresSafeArea()
        .onExitCommand(perform: onClose)                              // Esc closes the launcher
        .onChange(of: query) { _, newVal in
            spotSel = 0                                                // new query → reset the ↑↓ cursor to the top
            let qq = newVal.trimmingCharacters(in: .whitespaces)
            findGen += 1; let gen = findGen
            guard qq.count >= 2, !vaultFolders.isEmpty else { diskResults = []; return }
            // Spotlight file search off the main thread; drop the result if a newer keystroke superseded it.
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.12) {
                let res = vaultSearch(qq, folders: vaultFolders, limit: 8)
                DispatchQueue.main.async { if gen == findGen { diskResults = res } }
            }
        }
        .onKeyPress(.downArrow) { if !spotAll.isEmpty { spotSel = min(spotSel + 1, spotAll.count - 1) }; return .handled }
        .onKeyPress(.upArrow)   { if !spotAll.isEmpty { spotSel = max(spotSel - 1, 0) }; return .handled }
        .onAppear {
            DispatchQueue.main.async { searchFocused = true }
            // Peek the clipboard when ⌥⌥ opens — if it holds text, offer it (never auto-attached).
            if let s = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
                clipOffer = s
            }
        }
    }

    // ── clipboard offer: an addable chip that stages the clipboard as the context handed to the next app ──
    // Opt-in — the clipboard rides along ONLY if the user taps Add. Adding writes it to a temp clipboard.txt
    // and stages it exactly like a dropped file, so it flows through the SAME onLaunch(listing, url) path.
    private func clipboardOfferRow(_ s: String) -> some View {
        HStack(spacing: 6) {
            Spacer(minLength: 0)
            Button(action: { withAnimation(.easeOut(duration: 0.16)) { addClipboard(s) } }) {
                HStack(spacing: 6) {
                    Image(systemName: "doc.on.clipboard").font(.system(size: 10, weight: .medium)).foregroundColor(.lime)
                    Text(clipPeek(s)).font(.hanken(10.5, .medium)).foregroundColor(.inkDim).lineLimit(1).truncationMode(.tail)
                    HStack(spacing: 3) {
                        Image(systemName: "plus").font(.system(size: 7, weight: .bold))
                        Text("Add").font(.hanken(9.5, .semibold))
                    }.foregroundColor(.page).padding(.horizontal, 7).padding(.vertical, 3)
                     .background(Capsule().fill(Color.lime))
                }
                .padding(.leading, 9).padding(.trailing, 5).padding(.vertical, 4)
                .background(Capsule().fill(Color.white.opacity(0.05)))
                .overlay(Capsule().stroke(Color.edge, lineWidth: 1))
            }.buttonStyle(.plain).frame(maxWidth: 240)
             .help("Add your clipboard as context for the app you launch")
            // A copied VIDEO LINK gets "Extract video" instead — download + understand it, drop the
            // result into any chat (~/.relay/extract-video trigger; the app's poll runs the pipeline).
            // Otherwise the clipboard is treated as a FORM to fill (docs/FORM-FILL.md) via ~/.relay/fill-form.
            if isVideoURL(s) {
                Button(action: { triggerExtractVideo(s) }) {
                    HStack(spacing: 4) {
                        Image(systemName: "film").font(.system(size: 8, weight: .bold))
                        Text("Extract video").font(.hanken(9.5, .semibold))
                    }.foregroundColor(.lime).padding(.horizontal, 8).padding(.vertical, 4)
                     .background(Capsule().fill(Color.white.opacity(0.05)))
                     .overlay(Capsule().stroke(Color.lime.opacity(0.45), lineWidth: 1))
                }.buttonStyle(.plain)
                 .help("Download this video and understand it — drop the result into any chat")
            } else {
                Button(action: { triggerFormFill() }) {
                    HStack(spacing: 4) {
                        Image(systemName: "square.and.pencil").font(.system(size: 8, weight: .bold))
                        Text("Fill form").font(.hanken(9.5, .semibold))
                    }.foregroundColor(.lime).padding(.horizontal, 8).padding(.vertical, 4)
                     .background(Capsule().fill(Color.white.opacity(0.05)))
                     .overlay(Capsule().stroke(Color.lime.opacity(0.45), lineWidth: 1))
                }.buttonStyle(.plain)
                 .help("Guide me through filling this form (values from your saved details)")
            }
        }
    }
    // A copied YouTube/Instagram link → one-tap extraction. Mirrors video2ai-pipeline.mjs isVideoUrl so
    // the launcher only offers it for links the pipeline can actually download.
    private func isVideoURL(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard t.hasPrefix("http") else { return false }
        return t.contains("youtube.com/watch") || t.contains("youtu.be/") || t.contains("youtube.com/shorts/")
            || t.contains("instagram.com/p/") || t.contains("instagram.com/reel/")
    }
    // Fire the extraction on the copied URL and close the launcher (the notch widget takes the stage).
    private func triggerExtractVideo(_ url: String) {
        let p = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/extract-video")
        try? url.trimmingCharacters(in: .whitespacesAndNewlines).write(toFile: p, atomically: true, encoding: .utf8)
        onClose()
    }
    // Fire the guided form-fill on the copied form and close the launcher (the guide takes the stage).
    private func triggerFormFill() {
        let p = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/fill-form")
        FileManager.default.createFile(atPath: p, contents: Data())
        onClose()
    }
    private func clipPeek(_ s: String) -> String {
        let flat = s.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
            .trimmingCharacters(in: .whitespaces)
        return flat.count <= 24 ? flat : String(flat.prefix(24)) + "\u{2026}"
    }
    private func addClipboard(_ s: String) {
        let dir = NSTemporaryDirectory() + "sb-clip-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let file = dir + "/clipboard.txt"
        guard (try? s.write(toFile: file, atomically: true, encoding: .utf8)) != nil else { return }
        stage(URL(fileURLWithPath: file))   // becomes the staged context — the intake bar now shows the clipboard chip
        clipOffer = nil
    }

    // ── header: ⌥⌥ · HOME kicker · project chip ─────────────────────────────────────────
    private var header: some View {
        HStack(spacing: SB.s2) {
            (Text("⌥⌥").foregroundColor(.lime) + Text(" · HOME").foregroundColor(.inkFaint))
                .font(.splMono(9.5)).kerning(1.4)
            Spacer(minLength: SB.s2)
            if !projects.isEmpty {
                ProjectChip(projects: projects.map { (id: $0.id, name: $0.name) },
                            activeId: activeProjectId, onSelect: onPickProject)
            }
        }
    }

    // ── the FULL-WIDTH ask hero — the highlight of the drop (was a thin 250pt field in the header) ──
    private var askHero: some View {
        HStack(spacing: 11) {
            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold)).foregroundColor(.inkDim)
            TextField("Search projects, apps, files — or ask", text: $query)
                .textFieldStyle(.plain)
                .font(.hanken(13.5))
                .foregroundColor(.ink)
                .focused($searchFocused)
                .onSubmit { let rows = spotAll; if rows.indices.contains(spotSel) { choose(rows[spotSel]) } else if let f = rows.first { choose(f) } }
            Button(action: { onAsk(query.trimmingCharacters(in: .whitespaces)); onClose() }) {
                ZStack {
                    Circle().fill(Color.lime.opacity(0.14)).frame(width: 30, height: 30)
                    Image(systemName: "mic.fill").font(.system(size: 12, weight: .medium)).foregroundColor(.lime)
                }
            }.buttonStyle(.plain).help("Ask by voice (⌃⌃)")
        }
        .padding(.leading, 16).padding(.trailing, 8).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.sm).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: SBr.sm).stroke(searchFocused ? Color.lime.opacity(0.6) : Color.edge, lineWidth: 1.5))
    }

    // ── category tabs: All + one per catalog category, so fewer apps show at a glance ────
    private var catTabs: some View {
        HStack(spacing: 6) {
            catChip(nil, "All")
            ForEach(categories, id: \.self) { c in catChip(c, catLabel(c)) }
            Spacer(minLength: 0)
        }
    }
    private func catChip(_ c: String?, _ label: String) -> some View {
        let on = cat == c
        return Button(action: { withAnimation(.easeOut(duration: 0.12)) { cat = c } }) {
            Text(label).font(.hanken(11, on ? .semibold : .medium))
                .foregroundColor(on ? .page : .inkDim)
                .padding(.horizontal, 11).padding(.vertical, 5)
                .background(Capsule().fill(on ? Color.lime : Color.panel)
                    .overlay(Capsule().stroke(on ? Color.clear : Color.edge, lineWidth: 1)))
        }.buttonStyle(.plain)
    }

    // ── file-intake bar: dashed at rest, solid-lime when a file is staged ────────────────
    private var intakeBar: some View {
        HStack(spacing: SB.s3) {
            RoundedRectangle(cornerRadius: 8)
                .fill(staged == nil ? Color.raised : Color.lime.opacity(0.14))
                .frame(width: 30, height: 30)
                .overlay(Image(systemName: intakeIcon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(staged == nil ? .inkDim : .lime))
            if let f = staged {
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.url.lastPathComponent).font(.hanken(12, .semibold)).foregroundColor(.ink).lineLimit(1)
                    Text("\(f.sizeText) · tap an app to run it on this file")
                        .font(.hanken(10.5)).foregroundColor(.inkFaint).lineLimit(1)
                }
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Drop a file to start file-first").font(.hanken(12, .semibold)).foregroundColor(.ink)
                    Text("…or just pick an app. A dropped file is handed to whatever app you click.")
                        .font(.hanken(10.5)).foregroundColor(.inkFaint).lineLimit(1)
                }
            }
            Spacer(minLength: SB.s2)
            if staged != nil {
                Button(action: { withAnimation(.easeOut(duration: 0.16)) { staged = nil } }) {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundColor(.inkDim)
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(Color.raised))
                        .overlay(Circle().stroke(Color.edge, lineWidth: 1))
                }.buttonStyle(.plain).help("Clear the staged file")
            }
        }
        .padding(.horizontal, SB.s3).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.sm)
            .fill(staged == nil ? (dropTargeted ? Color.lime.opacity(0.06) : Color.white.opacity(0.012))
                                : Color.lime.opacity(0.07)))
        .overlay(RoundedRectangle(cornerRadius: SBr.sm)
            .strokeBorder(staged == nil ? Color.edge : Color.lime.opacity(0.45),
                          style: StrokeStyle(lineWidth: 1, dash: staged == nil ? [4, 3] : [])))
        // Native drop catcher (see FileDropCatcher) — replaces the SwiftUI `.onDrop`, which registered only
        // `.fileURL` and used flaky async NSItemProvider loading, so Finder drags never staged. Inset on the
        // trailing edge so the clear "✕" (visible when a file is staged) stays clickable.
        .overlay {
            FileDropCatcher(onDrop: { stage($0) }, onTargeted: { t in dropTargeted = t })
                .padding(.trailing, 44)
        }
    }

    private var intakeIcon: String {
        guard let f = staged else { return "plus" }
        return f.isImage ? "photo.fill" : "doc.fill"
    }

    private func stage(_ url: URL) {
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let size = ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
        let ext = url.pathExtension.lowercased()
        let isImage = ["png", "jpg", "jpeg", "gif", "heic", "webp", "tiff", "bmp"].contains(ext)
        withAnimation(.easeOut(duration: 0.16)) {
            staged = StagedFile(url: url, sizeText: size, isImage: isImage)
        }
    }

    // ── the app grid — 5-up tiles from the catalog ──────────────────────────────────────
    private var grid: some View {
        Group {
            if filtered.isEmpty {
                HStack {
                    Spacer()
                    Text(listings.isEmpty ? "No apps installed yet." : "No app matches “\(query)”.")
                        .font(.hanken(12)).foregroundColor(.inkFaint)
                    Spacer()
                }.frame(maxWidth: .infinity).padding(.vertical, 28)
            } else {
                LazyVGrid(columns: cols, alignment: .leading, spacing: SB.s3) {
                    ForEach(filtered) { appTile($0) }
                }
            }
        }
    }

    private func appTile(_ l: SBListing) -> some View {
        let takes = canTakeFile(l)
        let hasFile = staged != nil
        let dimmed = hasFile && !takes                     // a staged file it can't use → recede
        let ringed = hasFile && takes                      // …one it can → the lime "handles this" ring
        let hovering = hoveredId == l.id
        return Button(action: { onLaunch(l, takes ? staged?.url : nil) }) {
            VStack(spacing: 6) {
                tileArt(l)
                VStack(spacing: 1) {
                    Text(l.name).font(.hanken(10.5, .medium)).foregroundColor(.inkDim)
                        .lineLimit(1).truncationMode(.tail)
                    // The app's one-line tagline under the name — small, ink-dim, single line (the row was
                    // name-only before; the description is what tells apps apart at a glance).
                    if !l.tagline.isEmpty {
                        Text(l.tagline).font(.hanken(8.5)).foregroundColor(.inkFaint)
                            .lineLimit(1).truncationMode(.tail)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 11).padding(.bottom, 9).padding(.horizontal, 6)
            .sbCard(active: ringed, hover: hovering && !dimmed)
            .overlay(alignment: .topTrailing) {
                if ringed {
                    Text("↦ file").font(.splMono(7)).foregroundColor(.lime)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Capsule().fill(Color.lime.opacity(0.14)))
                        .padding(5)
                }
            }
            .opacity(dimmed ? 0.4 : 1)
            .offset(y: hovering && !dimmed ? -2 : 0)
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.22, dampingFraction: 0.8), value: hovering)
        .animation(.easeOut(duration: 0.16), value: hasFile)
        .onHover { hoveredId = $0 ? l.id : (hoveredId == l.id ? nil : hoveredId) }
        .help(takes && hasFile ? "Run \(l.name) on \(staged?.url.lastPathComponent ?? "the file")" : "Open \(l.name)")
    }

    // The app icon: the real "Instruments on the board" render (Resources/icons/<id>.png), else the
    // category glyph tile. A local twin of StoreView.glyphTile (that copy is private) so the launcher
    // draws icons identically without reaching across the type.
    @ViewBuilder private func tileArt(_ l: SBListing, size: CGFloat = 40) -> some View {
        if let img = storeIcon(l.id) {
            Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fill)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.22))
        } else {
            RoundedRectangle(cornerRadius: size * 0.22).fill(catTint(l.category).opacity(0.16))
                .overlay(Image(systemName: catGlyph(l.category))
                    .font(.system(size: size * 0.42)).foregroundColor(catTint(l.category)))
                .frame(width: size, height: size)
        }
    }

    // ── footer hint (mirrors the mockup) ────────────────────────────────────────────────
    private var hintLine: some View {
        HStack(spacing: SB.s4) {
            hint("⌥⌥", "open / close")
            hint("click", "run app widget")
            hint("drop", "file → file-first")
            hint("↩", "project switch")
            Spacer(minLength: 0)
        }.padding(.top, SB.s1)
    }

    private func hint(_ key: String, _ label: String) -> some View {
        HStack(spacing: 5) {
            Text(key).font(.splMono(9)).foregroundColor(.inkDim)
            Text(label).font(.splMono(9)).foregroundColor(.inkFaint)
        }
    }
}
