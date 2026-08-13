// NOTE: standalone ImageRenderer snapshot for the ⌥⌥ LAUNCHER's redesigned HOME — NOT in build.sh (own main).
// Same pattern as SnapshotSuite.preview.swift: a faithful twin of NotchLauncherView's HOME column (tasks-first,
// notch-panel section grammar) with the tokens copied verbatim, so the agent can eyeball every state without a
// live app. When the real homeContent/taskCard/homeKicker change, re-sync the copies here. Run:
//
//   cd packages/menubar
//   swiftc -parse-as-library LauncherSnap.preview.swift -o /tmp/launchersnap && /tmp/launchersnap
//
// Prints one `wrote <path>` per PNG: launcher-home-tasks / launcher-home-notasks / launcher-home-empty.
import AppKit
import SwiftUI

// ── tokens (verbatim from RelayMenuBar.swift ~L176 + OSShellView.swift ~L23) ──
extension Color {
    static let page     = Color(red: 0, green: 0, blue: 0)
    static let rail     = Color(red: 0x0A/255.0, green: 0x0A/255.0, blue: 0x0B/255.0)
    static let panel    = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)
    static let raised   = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge     = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let edgeSoft = Color(red: 0x1A/255.0, green: 0x1D/255.0, blue: 0x25/255.0)
    static let ink      = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkSec   = Color(red: 0xB4/255.0, green: 0xBE/255.0, blue: 0xCE/255.0)
    static let inkDim   = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime     = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let amber    = Color(red: 0xEF/255.0, green: 0x9F/255.0, blue: 0x27/255.0)
}
extension Font {
    static func brico(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .system(size: s, weight: w) }
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
enum SB { static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20 }
enum SBr { static let xs: CGFloat = 7, sm: CGFloat = 12 }
enum WK { static let width: CGFloat = 600, ear: CGFloat = 14 }

struct NotchDropShape: Shape {
    var ear: CGFloat = 14, botR: CGFloat = 20
    func path(in r: CGRect) -> Path {
        let w = r.width, h = r.height, e = min(ear, w/2), b = min(botR, (w - 2*e)/2)
        var p = Path()
        p.move(to: .init(x: 0, y: 0)); p.addLine(to: .init(x: w, y: 0))
        p.addQuadCurve(to: .init(x: w-e, y: e), control: .init(x: w-e, y: 0))
        p.addLine(to: .init(x: w-e, y: h-b))
        p.addQuadCurve(to: .init(x: w-e-b, y: h), control: .init(x: w-e, y: h))
        p.addLine(to: .init(x: e+b, y: h))
        p.addQuadCurve(to: .init(x: e, y: h-b), control: .init(x: e, y: h))
        p.addLine(to: .init(x: e, y: e))
        p.addQuadCurve(to: .init(x: 0, y: 0), control: .init(x: e, y: 0))
        p.closeSubpath(); return p
    }
}

// ── flattened models (twins of the real inputs) ──
struct LaunchTask: Identifiable {
    let id = UUID(); let title: String; let meta: String; let col: String; let over: Bool; let prio: String?
}
struct MiniProject: Identifiable { let id = UUID(); let name: String; let essence: String; let updated: String; let active: Bool; let hue: Double }
struct MiniWork: Identifiable { let id = UUID(); let title: String; let app: String; let time: String }
struct MiniApp: Identifiable { let id = UUID(); let name: String; let glyph: String; let hue: Double }

// ── the HOME drop — a faithful port of NotchLauncherView.body (HOME mode), REDESIGNED:
//    full-width ask hero + horizontal card RAILS (tasks · apps · projects) with big visual tiles,
//    replacing the vertical stack of thin rows. Matches the notch-panel menu's card/rail grammar.
struct LauncherHomeTwin: View {
    let tasks: [LaunchTask]
    let projects: [MiniProject]
    let work: [MiniWork]
    let apps: [MiniApp]

    var body: some View {
        VStack(alignment: .leading, spacing: SB.s3) {
            header
            askHero
            intakeBar
            homeContent
            hintLine
        }
        .padding(.horizontal, 22).padding(.top, SB.s5).padding(.bottom, 22)
        .frame(width: WK.width, alignment: .leading)
        .padding(.horizontal, WK.ear)
        .background(Color.page)
        .clipShape(NotchDropShape())
    }

    // kicker row: ⌥⌥ · HOME  ················  project chip
    private var header: some View {
        HStack(spacing: SB.s2) {
            (Text("⌥⌥").foregroundColor(.lime) + Text(" · HOME").foregroundColor(.inkFaint))
                .font(.splMono(9.5)).kerning(1.4)
            Spacer(minLength: SB.s2)
            HStack(spacing: 6) {
                Circle().fill(Color.lime).frame(width: 5, height: 5)
                Text("Switchboard").font(.hanken(11, .medium)).foregroundColor(.inkSec)
                Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold)).foregroundColor(.inkFaint)
            }.padding(.horizontal, 9).padding(.vertical, 5)
             .background(Capsule().fill(Color.panel)).overlay(Capsule().stroke(Color.edge, lineWidth: 1))
        }
    }

    // FULL-WIDTH ask hero — the highlight of the surface (was a thin 250pt field).
    private var askHero: some View {
        HStack(spacing: 11) {
            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold)).foregroundColor(.inkDim)
            Text("Search projects, apps, files — or ask").font(.hanken(13.5)).foregroundColor(.inkFaint)
            Spacer(minLength: 0)
            ZStack {
                Circle().fill(Color.lime.opacity(0.14)).frame(width: 30, height: 30)
                Image(systemName: "mic.fill").font(.system(size: 12, weight: .medium)).foregroundColor(.lime)
            }
        }
        .padding(.leading, 16).padding(.trailing, 8).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.sm).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: SBr.sm).stroke(Color.lime.opacity(0.5), lineWidth: 1.5))
    }

    private var intakeBar: some View {
        HStack(spacing: SB.s3) {
            RoundedRectangle(cornerRadius: 8).fill(Color.raised).frame(width: 28, height: 28)
                .overlay(Image(systemName: "plus").font(.system(size: 12, weight: .medium)).foregroundColor(.inkDim))
            Text("Drop a file to run it through any app").font(.hanken(11.5, .medium)).foregroundColor(.inkDim)
            Spacer(minLength: SB.s2)
        }
        .padding(.horizontal, SB.s3).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.sm).fill(Color.white.opacity(0.012)))
        .overlay(RoundedRectangle(cornerRadius: SBr.sm)
            .strokeBorder(Color.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    // ── the rails: TASKS · APPS · PROJECTS · RECENT WORK ──
    private var homeContent: some View {
        let active = projects.first { $0.active } ?? projects.first
        let ordered = [active].compactMap { $0 } + projects.filter { $0.id != active?.id }
        let openTasks = Array(tasks.prefix(6))
        let empty = openTasks.isEmpty && ordered.isEmpty && work.isEmpty && apps.isEmpty
        return VStack(alignment: .leading, spacing: SB.s3) {
            if empty {
                homeEmptyState
            } else {
                if !openTasks.isEmpty {
                    homeKicker("TASKS", count: tasks.count, trailing: "board ↗")
                    rail { ForEach(openTasks) { taskCard($0) } }
                }
                if !apps.isEmpty {
                    homeKicker("APPS", count: apps.count, trailing: "all ↗")
                    rail { ForEach(apps) { appTile($0) } }
                }
                if !ordered.isEmpty {
                    homeKicker("PROJECTS", count: projects.count, trailing: "open home ↗")
                    rail { ForEach(ordered) { projectCard($0) } }
                }
                if !work.isEmpty {
                    homeKicker("RECENT WORK", count: nil, trailing: nil)
                    VStack(alignment: .leading, spacing: 2) { ForEach(work) { workRow($0) } }
                }
            }
        }
    }

    // A horizontal card rail. Cards wider than the drop scroll; the clipped peek signals "there's more →".
    // NOTE: the LIVE view wraps this HStack in ScrollView(.horizontal) for real scrolling — but ScrollView
    // content does not render in ImageRenderer, so this snapshot proxy uses a clipped HStack (identical look).
    @ViewBuilder private func rail<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: SB.s3) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
    }

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

    private func homeKicker(_ t: String, count: Int?, trailing: String?) -> some View {
        HStack(spacing: 6) {
            Text(t).font(.splMono(9)).tracking(1.4).foregroundColor(.inkFaint)
            if let c = count, c > 0 {
                Text("·").font(.splMono(9)).foregroundColor(.inkFaint)
                Text("\(c)").font(.splMono(9)).foregroundColor(.inkDim)
            }
            Spacer(minLength: 0)
            if let tr = trailing { Text(tr).font(.hanken(10.5, .medium)).foregroundColor(.lime) }
        }.padding(.top, 1)
    }

    // ── TASK card — status glyph + pill up top, title (2 lines), meta pinned to the base ──
    private func taskCard(_ t: LaunchTask) -> some View {
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
        .background(RoundedRectangle(cornerRadius: SBr.sm).fill(Color.white.opacity(0.02)))
        .overlay(RoundedRectangle(cornerRadius: SBr.sm)
            .stroke(t.col == "doing" ? Color.lime.opacity(0.35) : Color.edgeSoft, lineWidth: 1))
    }
    private func taskGlyph(_ t: LaunchTask) -> String {
        switch t.col { case "doing": return "◐"; case "review": return "◑"; case "blocked": return "⊘"; default: return "○" }
    }
    private func taskTint(_ t: LaunchTask) -> Color {
        if t.over { return .amber }
        switch t.col { case "doing", "review": return .lime; case "blocked": return .amber; default: return .inkDim }
    }

    // ── APP tile — the big, visual icon the founder asked for ──
    private func appTile(_ a: MiniApp) -> some View {
        VStack(spacing: 7) {
            RoundedRectangle(cornerRadius: 13).fill(Color(hue: a.hue, saturation: 0.55, brightness: 0.78))
                .frame(width: 54, height: 54)
                .overlay(Text(a.glyph).font(.hanken(23, .bold)).foregroundColor(.white))
            Text(a.name).font(.hanken(10)).foregroundColor(.inkDim).lineLimit(1)
        }
        .frame(width: 68)
    }

    // ── PROJECT card — big monogram tile, essence, updated time ──
    private func projectCard(_ p: MiniProject) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 10).fill(Color(hue: p.hue, saturation: 0.5, brightness: 0.62))
                    .frame(width: 38, height: 38)
                    .overlay(Text(String(p.name.prefix(1))).font(.hanken(17, .bold)).foregroundColor(.white))
                Spacer(minLength: 0)
                if p.active {
                    Text("ACTIVE").font(.splMono(7)).tracking(0.7).foregroundColor(.lime)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.lime.opacity(0.4), lineWidth: 1))
                }
            }
            Text(p.name).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
            Text(p.essence).font(.hanken(10.5)).foregroundColor(.inkFaint)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Text(p.updated).font(.splMono(9)).foregroundColor(.inkFaint)
        }
        .padding(11)
        .frame(width: 160, height: 140, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: SBr.sm).fill(Color.white.opacity(0.02)))
        .overlay(RoundedRectangle(cornerRadius: SBr.sm)
            .stroke(p.active ? Color.indigo.opacity(0.5) : Color.edgeSoft, lineWidth: 1))
    }

    private func workRow(_ w: MiniWork) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.text").font(.system(size: 10)).foregroundColor(.inkDim).frame(width: 22)
            Text(w.title).font(.hanken(12)).foregroundColor(.inkSec).lineLimit(1)
            Spacer(minLength: 6)
            Text("\(w.app) · \(w.time)").font(.splMono(9)).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 9).padding(.vertical, 5)
    }

    private var hintLine: some View {
        HStack(spacing: SB.s4) {
            hint("⌥⌥", "open / close"); hint("↵", "open task / project"); hint("drop", "file → file-first")
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

@MainActor func snap<V: View>(_ name: String, _ view: V, pad: CGFloat = 26) {
    let framed = view.padding(pad).background(Color.rail).fixedSize(horizontal: false, vertical: true)
    let r = ImageRenderer(content: framed); r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL render \(name)"); return }
    let dir = "/tmp/launcher-snaps"
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = "\(dir)/\(name).png"
    do { try png.write(to: URL(fileURLWithPath: path)); print("wrote \(path)") }
    catch { print("FAIL write \(name): \(error)") }
}

@main
struct LauncherSnap {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        DispatchQueue.main.async {
            let tasks = [
                LaunchTask(title: "Ship the pricing page", meta: "due Aug 15 · ◆ launch", col: "doing", over: false, prio: "high"),
                LaunchTask(title: "Legal OK on pricing copy", meta: "overdue · Aug 8", col: "todo", over: true, prio: "high"),
                LaunchTask(title: "Wire Paddle checkout", meta: "◆ launch · @crest", col: "todo", over: false, prio: "high"),
                LaunchTask(title: "Draft the launch email", meta: "waiting on pricing page", col: "blocked", over: false, prio: nil),
                LaunchTask(title: "Notch LED display pass", meta: "◆ third-party-tools", col: "doing", over: false, prio: "med"),
            ]
            let apps = [
                MiniApp(name: "God", glyph: "✦", hue: 0.22),
                MiniApp(name: "PDF Tools", glyph: "⎙", hue: 0.02),
                MiniApp(name: "Convert", glyph: "⇄", hue: 0.55),
                MiniApp(name: "Palette", glyph: "◐", hue: 0.74),
                MiniApp(name: "Prism", glyph: "P", hue: 0.09),
                MiniApp(name: "Redline", glyph: "R", hue: 0.98),
                MiniApp(name: "Bank", glyph: "B", hue: 0.62),
            ]
            let projects = [
                MiniProject(name: "Switchboard", essence: "BYO-AI wrapp store", updated: "12m", active: true, hue: 0.62),
                MiniProject(name: "Haazma", essence: "The post-meal trilogy", updated: "3d", active: false, hue: 0.02),
                MiniProject(name: "Aamras", essence: "One scent, three intensities", updated: "3d", active: false, hue: 0.05),
                MiniProject(name: "Piqual", essence: "Three oils, one job each", updated: "3d", active: false, hue: 0.33),
            ]
            let work = [
                MiniWork(title: "Q4 palette exploration", app: "brandbrain", time: "20m"),
                MiniWork(title: "Landing hero draft", app: "redline", time: "1h"),
            ]
            snap("launcher-home-tasks", LauncherHomeTwin(tasks: tasks, projects: projects, work: work, apps: apps))
            snap("launcher-home-notasks", LauncherHomeTwin(tasks: [], projects: projects, work: work, apps: apps))
            snap("launcher-home-empty", LauncherHomeTwin(tasks: [], projects: [], work: [], apps: []))
            exit(0)
        }
        app.run()
    }
}
