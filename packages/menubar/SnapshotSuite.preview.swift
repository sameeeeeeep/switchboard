// NOTE: standalone ImageRenderer SNAPSHOT SUITE — NOT in build.sh (has its own main). This is the agent's
// "see the frontend without the human" harness: it renders the KEY notch surfaces to PNGs deterministically,
// with no live app, no accessibility grant, no ⌃⌃ press. Run it with:
//
//   cd packages/menubar
//   swiftc -parse-as-library SnapshotSuite.preview.swift -o /tmp/snapsuite && /tmp/snapsuite
//
// It prints one `wrote <path>` line per PNG. The views below are verbatim ports of the structs in
// RelayMenuBar.swift (GodStatusDrop, RefChip, DotMatrix, NotchDropShape) and AmbientCanvas.preview.swift
// (AmbientCanvas + rows), so a snapshot is a faithful twin of what the notch actually draws. When the real
// structs change, re-sync the copies here (they are intentionally duplicated — same pattern as the other
// *.preview.swift files, which each carry their own copy of the palette/tokens/shape).
import AppKit
import SwiftUI

// ============================================================================
// SHARED DESIGN TOKENS — verbatim from RelayMenuBar.swift (~L171) / the other *.preview.swift.
// ============================================================================
extension Color {
    static let page    = Color(red: 0, green: 0, blue: 0)
    static let rail    = Color(red: 0x0A/255.0, green: 0x0A/255.0, blue: 0x0B/255.0)
    static let panel   = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)
    static let raised  = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge    = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink     = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim  = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime    = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
}
extension Font {
    static func brico(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .system(size: s, weight: w) }
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
extension View { func kicker() -> some View { self.font(.splMono(9.5)).kerning(1.4).foregroundColor(.inkFaint) } }

enum T {
    static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20
    static let rSm: CGFloat = 7, rMd: CGFloat = 12, rLg: CGFloat = 16
    static let ear: CGFloat = 14, hair: CGFloat = 1
    static let ambientWidth: CGFloat = 340
}

// ---- notch silhouette (verbatim from RelayMenuBar.swift ~L1665) ----
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

// ============================================================================
// DOT-MATRIX — verbatim from RelayMenuBar.swift ~L1845. Rendered at a FIXED frame `t`
// so snapshots are deterministic (no TimelineView animation dependency in a still).
// ============================================================================
struct DotMatrix: View {
    enum Pattern { case listening, thinking, speaking, working }
    let pattern: Pattern
    let accent: Color
    var cols: Int = 7
    var rows: Int = 5
    var dot: CGFloat = 3
    var gap: CGFloat = 3
    var frame: Double = 0.9   // the "t" we freeze at — a legible mid-animation frame

    private func brightness(_ c: Int, _ r: Int, _ t: Double) -> Double {
        let cx = Double(c), rx = Double(r), mid = Double(rows - 1) / 2
        switch pattern {
        case .listening:
            let h = 1.0 + 2.0 * (0.5 + 0.5 * sin(t * 3.0 + cx * 0.7))
            return abs(rx - mid) <= h ? 1.0 : 0.1
        case .speaking:
            let wave = mid + (mid - 0.15) * sin(t * 4.2 + cx * 0.95)
            return abs(rx - wave) < 0.85 ? 1.0 : 0.1
        case .thinking:
            let s = 0.5 + 0.5 * sin((cx + rx) * 0.6 - t * 3.0)
            return 0.14 + 0.86 * (s * s * s)
        case .working:
            return 0.16 + 0.84 * (0.5 + 0.5 * sin(cx * 0.55 - t * 2.6))
        }
    }
    var body: some View {
        VStack(spacing: gap) {
            ForEach(0..<rows, id: \.self) { r in
                HStack(spacing: gap) {
                    ForEach(0..<cols, id: \.self) { c in
                        Circle().fill(accent).frame(width: dot, height: dot).opacity(brightness(c, r, frame))
                    }
                }
            }
        }
    }
}

// ============================================================================
// REFERENCE CHIP — verbatim from RelayMenuBar.swift ~L1892 (GodRefChipVM + RefChip).
// ============================================================================
struct GodRefChipVM: Identifiable {
    let id: UUID
    let label: String
    let thumb: NSImage?
    let isScreenshot: Bool
}
struct RefChip: View {
    let vm: GodRefChipVM
    var onRemove: (UUID) -> Void = { _ in }
    var body: some View {
        HStack(spacing: 5) {
            if let t = vm.thumb {
                Image(nsImage: t).resizable().aspectRatio(contentMode: .fill)
                    .frame(width: 20, height: 14).clipShape(RoundedRectangle(cornerRadius: 3))
                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.lime.opacity(0.5), lineWidth: 1))
            } else {
                Image(systemName: vm.isScreenshot ? "camera.viewfinder" : "doc")
                    .font(.system(size: 9, weight: .semibold)).foregroundColor(.lime).frame(width: 14)
            }
            Text(vm.label).font(.hanken(10.5, .medium)).foregroundColor(.inkDim).lineLimit(1).truncationMode(.middle)
            Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).foregroundColor(.inkFaint)
        }
        .padding(.leading, 6).padding(.trailing, 5).padding(.vertical, 3)
        .background(Capsule().fill(Color.white.opacity(0.06)))
        .frame(maxWidth: 230, alignment: .leading)
    }
}

// ============================================================================
// GOD STATUS DROP — verbatim from RelayMenuBar.swift ~L1930 (projects omitted → self-contained,
// since ProjectChip lives in the app; refs + phase are the parts we want to eyeball here).
// ============================================================================
struct GodStatusDrop: View {
    let label: String
    let accent: Color
    let pattern: DotMatrix.Pattern
    var refs: [GodRefChipVM] = []
    private var hasExtras: Bool { !refs.isEmpty }
    var body: some View {
        VStack(spacing: 7) {
            HStack(spacing: 12) {
                Text(label).font(.hanken(13, .semibold)).foregroundColor(.ink)
                DotMatrix(pattern: pattern, accent: accent)
            }
            if !refs.isEmpty {
                VStack(spacing: 4) { ForEach(refs) { RefChip(vm: $0) } }
            }
        }
        .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, hasExtras ? 12 : 15)
        .frame(minWidth: 130)
        .padding(.horizontal, 14)   // room for the notch "ears"
        .background(Color.page)
        .clipShape(NotchDropShape())
    }
}

// ============================================================================
// DASHED-BORDER TWIN — the notch drop-zone hint. In the app this is drawn by FileDropView (a plain
// NSView) as a dashed NSBezierPath sized to the pill; here we draw the SAME NotchDropShape silhouette
// with a dashed stroke so the agent can eyeball the "drop a file on the notch" affordance — the two
// states: faint idle hint, and the lime hot state when a file is dragged over.
// ============================================================================
struct DashedNotchTwin: View {
    var hot: Bool
    var body: some View {
        ZStack {
            NotchDropShape().fill(Color.page)
            NotchDropShape()
                .stroke(style: StrokeStyle(lineWidth: hot ? 2 : 1, dash: [5, 4]))
                .foregroundColor(hot ? .lime : Color.edge.opacity(0.9))
            VStack(spacing: 6) {
                Image(systemName: hot ? "arrow.down.doc.fill" : "square.and.arrow.down")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(hot ? .lime : .inkFaint)
                Text(hot ? "release to attach" : "drop a file")
                    .font(.splMono(9)).kerning(0.6).foregroundColor(hot ? .lime : .inkFaint)
            }
        }
        .frame(width: 220, height: 96)
    }
}

// ============================================================================
// AMBIENT CANVAS — verbatim from AmbientCanvas.preview.swift.
// ============================================================================
struct AmbientSuggestion: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let kind: String
    let targetId: String
    let sfSymbol: String
}
struct KindTag: View {
    let kind: String
    var body: some View {
        Text(kind).font(.splMono(8)).kerning(0.6).foregroundColor(.inkFaint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(Color.raised))
            .overlay(Capsule().stroke(Color.edge, lineWidth: T.hair))
    }
}
struct AmbientRow: View {
    let s: AmbientSuggestion
    var body: some View {
        HStack(spacing: T.s3) {
            ZStack {
                RoundedRectangle(cornerRadius: T.rSm).fill(Color.lime.opacity(0.14))
                Image(systemName: s.sfSymbol).font(.system(size: 15, weight: .semibold)).foregroundColor(.lime)
            }.frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(s.title).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
                    KindTag(kind: s.kind)
                }
                Text(s.subtitle).font(.hanken(11)).foregroundColor(.inkDim).lineLimit(1)
            }
            Spacer(minLength: T.s2)
            Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, T.s3).padding(.vertical, T.s2 + 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: T.rMd).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: T.rMd).stroke(Color.edge, lineWidth: T.hair))
    }
}
struct AmbientCanvas: View {
    let context: String
    let suggestions: [AmbientSuggestion]
    private var shown: [AmbientSuggestion] { Array(suggestions.prefix(3)) }
    var body: some View {
        VStack(alignment: .leading, spacing: T.s3) {
            HStack(alignment: .center, spacing: T.s2) {
                Circle().fill(Color.lime).frame(width: 6, height: 6).shadow(color: Color.lime.opacity(0.6), radius: 3)
                Text("AMBIENT · \(context.uppercased())").kicker().lineLimit(1)
                Spacer(minLength: T.s2)
                Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).foregroundColor(.inkDim)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(Color.panel)).overlay(Circle().stroke(Color.edge, lineWidth: T.hair))
            }
            VStack(spacing: T.s2) { ForEach(shown) { AmbientRow(s: $0) } }
        }
        .padding(.top, T.s4).padding(.horizontal, T.ear + T.s3).padding(.bottom, T.s4 + 2)
        .frame(width: T.ambientWidth, alignment: .leading)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: T.ear, botR: 22))
        .overlay(NotchDropShape(ear: T.ear, botR: 22).stroke(Color.edge.opacity(0.5), lineWidth: T.hair))
    }
}

// ============================================================================
// SNAP + RENDER
// ============================================================================
@MainActor func makeThumb(_ top: NSColor, _ bottom: NSColor) -> NSImage {
    let size = NSSize(width: 40, height: 28)
    let img = NSImage(size: size)
    img.lockFocus()
    let g = NSGradient(starting: top, ending: bottom)
    g?.draw(in: NSRect(origin: .zero, size: size), angle: -60)
    img.unlockFocus()
    return img
}

@MainActor func snap<V: View>(_ name: String, _ view: V, pad: CGFloat = 22) {
    let framed = view.padding(pad).background(Color.rail).fixedSize(horizontal: false, vertical: true)
    let r = ImageRenderer(content: framed); r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL render \(name)"); return }
    let scratch = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-settings-layout-overflow-2ee5dc/4e763fa1-f170-4521-9f21-8fcabe53b780/scratchpad/snapshots"
    let dir = FileManager.default.fileExists(atPath: scratch) ? scratch : "/tmp/snapshots"
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = "\(dir)/\(name).png"
    do { try png.write(to: URL(fileURLWithPath: path)); print("wrote \(path)") }
    catch { print("FAIL write \(name): \(error)") }
}

@main
struct SnapshotSuite {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        DispatchQueue.main.async {
            // --- GodStatusDrop: 0 / 1 / 3 reference chips, on the Thinking phase ---
            snap("god-thinking-0refs",
                 GodStatusDrop(label: "Thinking", accent: .lime, pattern: .thinking, refs: []))

            let oneRef = [
                GodRefChipVM(id: UUID(), label: "screenshot", thumb: makeThumb(.systemTeal, .black), isScreenshot: true),
            ]
            snap("god-thinking-1ref",
                 GodStatusDrop(label: "Thinking", accent: .lime, pattern: .thinking, refs: oneRef))

            let threeRefs = [
                GodRefChipVM(id: UUID(), label: "screenshot", thumb: makeThumb(.systemTeal, .black), isScreenshot: true),
                GodRefChipVM(id: UUID(), label: "quarterly-report.pdf", thumb: nil, isScreenshot: false),
                GodRefChipVM(id: UUID(), label: "brand-photo.png", thumb: makeThumb(.systemPink, .systemPurple), isScreenshot: false),
            ]
            snap("god-thinking-3refs",
                 GodStatusDrop(label: "Thinking", accent: .lime, pattern: .thinking, refs: threeRefs))

            // Phase coverage: the same drop across the other phases (so the agent can eyeball dot-matrix + accent).
            snap("god-listening", GodStatusDrop(label: "Listening", accent: .cyan, pattern: .listening))
            snap("god-speaking",
                 GodStatusDrop(label: "Speaking", accent: Color(red: 1, green: 0.72, blue: 0.3), pattern: .speaking))

            // --- The dashed-border twin: idle hint + hot (file over) ---
            snap("dropzone-idle", DashedNotchTwin(hot: false))
            snap("dropzone-hot",  DashedNotchTwin(hot: true))

            // --- AmbientCanvas: three suggestions + one ---
            let three = [
                AmbientSuggestion(title: "Draft a caption", subtitle: "You're on LinkedIn", kind: "skill",
                                  targetId: "skill.caption", sfSymbol: "text.bubble"),
                AmbientSuggestion(title: "Summarize this PDF", subtitle: "Preview · quarterly-report.pdf", kind: "widget",
                                  targetId: "widget.summarize", sfSymbol: "doc.text.magnifyingglass"),
                AmbientSuggestion(title: "Open Brand deck", subtitle: "Matches project Acme", kind: "wrapp",
                                  targetId: "wrapp.branddeck", sfSymbol: "rectangle.on.rectangle.angled"),
            ]
            snap("ambient-canvas-three", AmbientCanvas(context: "LinkedIn", suggestions: three))
            snap("ambient-canvas-one", AmbientCanvas(context: "Mail", suggestions: [
                AmbientSuggestion(title: "Draft a reply", subtitle: "You're in Mail · from Priya", kind: "widget",
                                  targetId: "widget.reply", sfSymbol: "arrowshape.turn.up.left"),
            ]))
            exit(0)
        }
        app.run()
    }
}
