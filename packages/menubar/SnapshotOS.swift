// Standalone ImageRenderer harness — renders the native OS surfaces to PNGs so the
// frontend can be verified WITHOUT launching the GUI. NOT in build.sh (own @main).
// Compile: swiftc -O -o build/SnapOS SnapshotOS.swift OSShellView.swift \
//   OSSurfaceWorkspace.swift OSSurfaceAutomate.swift OSSurfaceKnowledge.swift OSSurfaceDo.swift \
//   -framework AppKit -framework SwiftUI -framework ApplicationServices
// Provides ONLY the primitives OSShellView normally borrows from RelayMenuBar
// (the full Color token set, Font.hanken/splMono, and a DotMatrix stub). OSShellView
// itself still owns indigo / inkSec / edgeSoft / IsoTile / Surface / Sample / SectionHead.
import SwiftUI
import AppKit

extension Color {
    static let page = Color(red: 0x00/255.0, green: 0x00/255.0, blue: 0x00/255.0)
    static let rail = Color(red: 0x0A/255.0, green: 0x0A/255.0, blue: 0x0B/255.0)
    static let panel = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let danger = Color(red: 0xFF/255.0, green: 0x2D/255.0, blue: 0x6E/255.0)
    static let ok = Color(red: 0x3D/255.0, green: 0xD6/255.0, blue: 0x8C/255.0)
}

extension Font {
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}

// Minimal stand-in for RelayMenuBar's DotMatrix — only referenced by OSShellView.StubDetail,
// which this harness never renders, so an inert body is enough to satisfy the compiler.
struct DotMatrix: View {
    enum Pattern { case listening, thinking, speaking, working }
    var pattern: Pattern = .working
    var accent: Color = .lime
    var cols: Int = 5
    var rows: Int = 5
    var dot: CGFloat = 2
    var gap: CGFloat = 2
    var animated: Bool = true
    var body: some View { Color.clear }
}

// Shim for RelayMenuBar's storeIcon (not compiled into this harness) — loads the real
// icon PNGs straight from the source dir so snapshots show native icon parity.
func storeIcon(_ id: String) -> NSImage? {
    let path = "/Users/sameeprehlan/Documents/Projects/relay/.claude/worktrees/festive-lederberg-e8ad4a/packages/menubar/icons/\(id).png"
    return NSImage(contentsOfFile: path)
}

@main
struct SnapshotOS {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let dir = ProcessInfo.processInfo.environment["SNAP_DIR"] ?? NSTemporaryDirectory() + "os-native"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        // Render via a real offscreen NSWindow — forces full AppKit layout so ScrollView
        // content actually lays out (ImageRenderer leaves ScrollView panes blank).
        func snap<V: View>(_ name: String, _ view: V, w: CGFloat = 1180, h: CGFloat = 820) {
            let framed = view
                .frame(width: w, height: h, alignment: .topLeading)
                .background(Color.page)
                .environment(\.colorScheme, .dark)
            let host = NSHostingView(rootView: AnyView(framed))
            host.frame = NSRect(x: 0, y: 0, width: w, height: h)
            let win = NSWindow(contentRect: host.frame, styleMask: [.borderless],
                               backing: .buffered, defer: false)
            win.contentView = host
            win.orderFrontRegardless()
            host.layoutSubtreeIfNeeded()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { print("FAIL \(name)"); win.orderOut(nil); return }
            rep.size = host.bounds.size
            host.cacheDisplay(in: host.bounds, to: rep)
            win.orderOut(nil)
            guard let png = rep.representation(using: .png, properties: [:]) else { print("FAIL png \(name)"); return }
            let path = "\(dir)/\(name).png"
            do { try png.write(to: URL(fileURLWithPath: path)); print("ok \(name)") }
            catch { print("write-fail \(name): \(error)") }
        }

        // Render each surface inside the REAL shell (rail + surface in context) at window size.
        let surfaces: [(String, Surface)] = [
            ("00-home", .home), ("01-tasks", .tasks), ("02-calendar", .calendar), ("03-bank", .bank),
            ("04-dashboard", .dashboard), ("05-needs", .needs), ("06-routines", .routines),
            ("07-workflows", .workflows), ("08-history", .history), ("09-graph", .graph),
            ("10-dictionary", .dictionary), ("11-apps", .apps), ("12-store", .store),
        ]
        for (name, s) in surfaces { snap(name, OSShellView(initial: s), w: 1180, h: 820) }
        print("done → \(dir)")
    }
}
