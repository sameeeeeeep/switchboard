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

struct NotchLauncherView: View {
    // ---- inputs (see the init doc for the exact contract the host wires up) ----
    let listings: [SBListing]                     // the live catalog, already filtered to what should appear
    let projects: [Ctx]                           // the project/context list for the chip
    let activeProjectId: String?                  // the currently-grounded project (nil → "no project")
    let onPickProject: (String?) -> Void          // chip → set the global context (nil = unconnected)
    let onLaunch: (SBListing, URL?) -> Void        // tile → launch this wrapp's widget, with the staged file if it takes one
    let onOpenSurface: (String) -> Void            // spotlight "go to" → open the OS window at a surface (rawValue)
    let onAsk: (String) -> Void                    // spotlight "ask" / mic → hand the query to God (empty = voice)
    let onClose: () -> Void                        // ⌥⌥ again / Esc — the host dismisses the drop

    init(listings: [SBListing],
         projects: [Ctx],
         activeProjectId: String?,
         onPickProject: @escaping (String?) -> Void,
         onLaunch: @escaping (SBListing, URL?) -> Void,
         onOpenSurface: @escaping (String) -> Void = { _ in },
         onAsk: @escaping (String) -> Void = { _ in },
         onClose: @escaping () -> Void) {
        self.listings = listings
        self.projects = projects
        self.activeProjectId = activeProjectId
        self.onPickProject = onPickProject
        self.onLaunch = onLaunch
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
    @State private var clipOffer: String? = nil      // the clipboard string offered as an addable context object (opt-in; nil once added)
    @FocusState private var searchFocused: Bool      // keep the field focused across grid re-renders

    // A dropped file + its human-readable size, resolved once at drop time.
    private struct StagedFile { let url: URL; let sizeText: String; let isImage: Bool }

    // The one place the "which wrapps accept a dropped file" rule lives. An explicit id allowlist (the
    // founder's stated set) — the file-shaped, non-conversational tools plus God (which takes a screenshot
    // /file as its turn reference). A live alternative the host can switch to is `surfaces.contains("notch")`,
    // which today covers convert/pdftools/qr/palette (+flow); the allowlist is used because it also includes
    // prism/resize (browser-only, but genuinely file-first) and excludes flow (dictation, not a file sink).
    private static let fileTakerIds: Set<String> =
        ["god", "pdftools", "convert", "palette", "prism", "resize", "qr"]
    private func canTakeFile(_ l: SBListing) -> Bool { Self.fileTakerIds.contains(l.id) }

    private var filtered: [SBListing] {
        var l = listings
        if let c = cat { l = l.filter { $0.category == c } }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty { l = l.filter { $0.name.lowercased().contains(q) || $0.tagline.lowercased().contains(q) } }
        return l
    }
    private var categories: [String] { Array(Set(listings.map { $0.category })).sorted() }
    private func catLabel(_ c: String) -> String {
        switch c { case "studio": return "Make"; case "tool": return "Tools"; case "fun": return "Fun"; case "agent": return "Agents"; default: return c.capitalized }
    }

    // ── SPOTLIGHT — the ⌥⌥ bar reaches ANYWHERE: projects · apps · surfaces · actions. When the query is
    //    non-empty the app grid is replaced by grouped results, each leading somewhere. (docs: command centre)
    private enum SpotKind { case project, app, surface, action }
    private struct SpotRow: Identifiable { let id: String; let kind: SpotKind; let label: String; let sub: String; let payload: String }
    private var q: String { query.trimmingCharacters(in: .whitespaces).lowercased() }
    private var spotProjects: [SpotRow] {
        projects.filter { q.isEmpty || $0.name.lowercased().contains(q) }.prefix(6).map {
            SpotRow(id: "p-" + $0.id, kind: .project, label: $0.name, sub: $0.kind, payload: $0.id) }
    }
    private var spotApps: [SpotRow] {
        (q.isEmpty ? [] : listings.filter { $0.name.lowercased().contains(q) || $0.tagline.lowercased().contains(q) }).prefix(6).map {
            SpotRow(id: "a-" + $0.id, kind: .app, label: $0.name, sub: $0.tagline, payload: $0.id) }
    }
    private var spotSurfaces: [SpotRow] {
        (q.isEmpty ? [] : Surface.allCases.filter { $0.title.lowercased().contains(q) }).map {
            SpotRow(id: "s-" + $0.rawValue, kind: .surface, label: $0.title, sub: "surface", payload: $0.rawValue) }
    }
    private var spotActions: [SpotRow] {
        q.isEmpty ? [] : [SpotRow(id: "act-ask", kind: .action, label: "“\(query.trimmingCharacters(in: .whitespaces))”", sub: "ask across your work", payload: "ask")]
    }
    private var spotAll: [SpotRow] { spotProjects + spotApps + spotSurfaces + spotActions }

    private func choose(_ r: SpotRow) {
        switch r.kind {
        case .project: onPickProject(r.payload); onClose()
        case .app:     if let l = listings.first(where: { $0.id == r.payload }) { onLaunch(l, staged?.url) }
        case .surface: onOpenSurface(r.payload); onClose()
        case .action:  onAsk(query.trimmingCharacters(in: .whitespaces)); onClose()
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
                Text(r.kind == .project ? "switch" : r.kind == .app ? "open" : r.kind == .surface ? "go" : "↵")
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

    private var spotlightList: some View {
        let groups: [(String, [SpotRow])] = [("Projects", spotProjects), ("Apps", spotApps), ("Go to", spotSurfaces), ("Actions", spotActions)].filter { !$0.1.isEmpty }
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
            intakeBar
            if q.isEmpty {
                // browse mode — categories + the app grid (⌥⌥ as an app launcher)
                catTabs
                if staged == nil, let c = clipOffer { clipboardOfferRow(c) }   // opt-in: the clipboard as addable context
                grid
            } else {
                // spotlight mode — one query reaches projects · apps · surfaces · actions
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
        .onChange(of: query) { _, _ in spotSel = 0 }                  // new query → reset the ↑↓ cursor to the top
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
        HStack(spacing: 0) {
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
        }
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

    // ── header: ⌥⌥ · LAUNCH kicker · project chip · search ──────────────────────────────
    private var header: some View {
        HStack(spacing: SB.s2) {
            (Text("⌥⌥").foregroundColor(.lime) + Text(" · LAUNCH").foregroundColor(.inkFaint))
                .font(.splMono(9.5)).kerning(1.4)
            Spacer(minLength: SB.s2)
            if !projects.isEmpty {
                ProjectChip(projects: projects.map { (id: $0.id, name: $0.name) },
                            activeId: activeProjectId, onSelect: onPickProject)
            }
            searchField
        }
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 10, weight: .semibold)).foregroundColor(.inkFaint)
            TextField("Search projects, apps — or ask", text: $query)
                .textFieldStyle(.plain)
                .font(.hanken(11))
                .foregroundColor(.ink)
                .focused($searchFocused)
                .onSubmit { let rows = spotAll; if rows.indices.contains(spotSel) { choose(rows[spotSel]) } else if let f = rows.first { choose(f) } }
            Button(action: { onAsk(query.trimmingCharacters(in: .whitespaces)); onClose() }) {
                Image(systemName: "mic.fill").font(.system(size: 10, weight: .medium)).foregroundColor(.inkDim)
            }.buttonStyle(.plain).help("Ask by voice (⌃⌃)")
        }
        .padding(.horizontal, 11).padding(.vertical, 7)
        .frame(width: 250, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.xs).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: SBr.xs).stroke(searchFocused ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1))
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
    @ViewBuilder private func tileArt(_ l: SBListing) -> some View {
        let size: CGFloat = 40
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
