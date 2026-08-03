// NOTE: standalone ImageRenderer PREVIEW / basis for the in-app port — NOT in build.sh (has its own main).
// AMBIENT MODE UI. When Switchboard notices (strictly locally) you're on something a project/wrapp can help
// with, a small HELPER CANVAS grows from the notch offering 1–3 contextual actions — the SAME command-center
// grammar as God's notch pills/widgets (NotchDropShape silhouette, Color.page, single lime accent).
// The three views below port into RelayMenuBar.swift:
//   • AmbientCanvas      — the notch-drop suggestion card (onPick / onDismiss closures)
//   • AmbientDot         — the idle resting presence (ambient on, nothing surfaced)
//   • LocalCaptureBorder — the full-screen INDIGO honesty flash for a local-only screenshot
import AppKit
import SwiftUI

// ---- house palette (verbatim from RelayMenuBar.swift ~L171 / the other *.preview.swift) ----
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
    // The LOCAL-ONLY signal — a cool indigo, deliberately NOT lime, so a rare local screenshot reads
    // as "never left your Mac" and can never be confused with the normal lime capture flash. sRGB #5B8DEF.
    static let localInk = Color(red: 0x5B/255.0, green: 0x8D/255.0, blue: 0xEF/255.0)
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
    // Ambient stays NARROW so it keeps the notch silhouette as content grows — a tall drop, never a wide banner.
    static let width: CGFloat = 340
}

// ---- notch silhouette (verbatim from RelayMenuBar.swift ~L1667) ----
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
// INPUT CONTRACT — the exact shape the (separately-built) local sensor produces.
// ============================================================================
struct AmbientSuggestion: Identifiable {
    let id = UUID()
    let title: String        // "Draft a caption"
    let subtitle: String     // "You're on LinkedIn"
    let kind: String         // wrapp | skill | widget
    let targetId: String     // the wrapp/skill/widget id to launch on pick
    let sfSymbol: String     // e.g. "text.bubble"
}

// ============================================================================
// 1. AMBIENT CANVAS — the helper drop. Shared notch chrome × 1–3 suggestion rows.
// ============================================================================

/// A per-kind tag pill (wrapp / skill / widget) — the only place a hue other than lime appears in a row,
/// and even then muted, so the eye still lands on the lime action tile.
struct KindTag: View {
    let kind: String
    var body: some View {
        Text(kind).font(.splMono(8)).kerning(0.6).foregroundColor(.inkFaint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(Color.raised))
            .overlay(Capsule().stroke(Color.edge, lineWidth: T.hair))
    }
}

/// One tappable suggestion: lime-tinted SF-Symbol tile + title/subtitle + kind tag + chevron.
struct AmbientRow: View {
    let s: AmbientSuggestion
    var onPick: (String) -> Void
    var body: some View {
        Button(action: { onPick(s.targetId) }) {
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
        }.buttonStyle(.plain)
    }
}

struct AmbientCanvas: View {
    let context: String                        // "LinkedIn" / "Preview" / app name
    let suggestions: [AmbientSuggestion]        // sensor supplies 1–3 (we render at most 3)
    var onPick: (String) -> Void = { _ in }
    var onDismiss: () -> Void = {}
    private var shown: [AmbientSuggestion] { Array(suggestions.prefix(3)) }
    var body: some View {
        VStack(alignment: .leading, spacing: T.s3) {
            // Header: pulse dot + AMBIENT · <context> kicker, and a dismiss ✕.
            HStack(alignment: .center, spacing: T.s2) {
                Circle().fill(Color.lime).frame(width: 6, height: 6)
                    .shadow(color: Color.lime.opacity(0.6), radius: 3)
                Text("AMBIENT · \(context.uppercased())").kicker().lineLimit(1)
                Spacer(minLength: T.s2)
                Button(action: onDismiss) {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).foregroundColor(.inkDim)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(Color.panel)).overlay(Circle().stroke(Color.edge, lineWidth: T.hair))
                }.buttonStyle(.plain)
            }
            VStack(spacing: T.s2) {
                ForEach(shown) { AmbientRow(s: $0, onPick: onPick) }
            }
        }
        .padding(.top, T.s4).padding(.horizontal, T.ear + T.s3).padding(.bottom, T.s4 + 2)
        .frame(width: T.width, alignment: .leading)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: T.ear, botR: 22))
        .overlay(NotchDropShape(ear: T.ear, botR: 22).stroke(Color.edge.opacity(0.5), lineWidth: T.hair))
    }
}

// ============================================================================
// 2. AMBIENT DOT — the idle resting presence: ambient mode on, nothing surfaced.
//    A tiny lime-cored ring in a minimal notch stub; hover → expands into the canvas.
// ============================================================================
struct AmbientDot: View {
    var body: some View {
        HStack(spacing: 6) {
            ZStack {
                Circle().stroke(Color.lime.opacity(0.4), lineWidth: 1.5).frame(width: 12, height: 12)
                Circle().fill(Color.lime).frame(width: 5, height: 5)
                    .shadow(color: Color.lime.opacity(0.55), radius: 3)
            }
            Text("watching").font(.splMono(8.5)).kerning(0.5).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 8)
        .frame(minWidth: 96)
        .background(Color.page)
        .clipShape(NotchDropShape(ear: 10, botR: 12))
        .overlay(NotchDropShape(ear: 10, botR: 12).stroke(Color.edge.opacity(0.5), lineWidth: T.hair))
    }
}

// ============================================================================
// 3. LOCAL-CAPTURE BORDER — full-screen honesty flash for a local-only screenshot.
//    Distinct INDIGO (#5B8DEF), NOT the normal lime capture flash → "never left your Mac".
//    Clean inset rounded border + a "local only" caption chip in the bottom-left corner.
// ============================================================================
struct LocalCaptureBorder: View {
    var body: some View {
        ZStack {
            // Inset rounded indigo border with a soft inward glow.
            RoundedRectangle(cornerRadius: 26)
                .strokeBorder(Color.localInk, lineWidth: 4)
                .shadow(color: Color.localInk.opacity(0.5), radius: 10)
                .padding(10)
            // Corner caption chip — the plain-language promise.
            VStack {
                Spacer()
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "lock.laptopcomputer").font(.system(size: 11, weight: .semibold))
                        Text("local only · never left your Mac").font(.splMono(10)).kerning(0.4)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Capsule().fill(Color.localInk.opacity(0.92)))
                    .overlay(Capsule().stroke(Color.white.opacity(0.25), lineWidth: T.hair))
                    .shadow(color: Color.localInk.opacity(0.45), radius: 8)
                    Spacer()
                }
                .padding(.leading, 34).padding(.bottom, 30)
            }
        }
    }
}

// ============================================================================
// RENDER — snapshot each state to PNG.
// ============================================================================
@MainActor func snap<V: View>(_ name: String, _ view: V) {
    let r = ImageRenderer(content: view.fixedSize(horizontal: false, vertical: true)); r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    let dir = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-settings-layout-overflow-2ee5dc/4e763fa1-f170-4521-9f21-8fcabe53b780/scratchpad"
    let base = FileManager.default.fileExists(atPath: dir) ? dir : "/tmp"
    let path = "\(base)/\(name).png"
    do { try png.write(to: URL(fileURLWithPath: path)); print("wrote \(path)") }
    catch { print("FAIL write \(name): \(error)") }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    let three = [
        AmbientSuggestion(title: "Draft a caption", subtitle: "You're on LinkedIn", kind: "skill",
                          targetId: "skill.caption", sfSymbol: "text.bubble"),
        AmbientSuggestion(title: "Summarize this PDF", subtitle: "Preview · quarterly-report.pdf", kind: "widget",
                          targetId: "widget.summarize", sfSymbol: "doc.text.magnifyingglass"),
        AmbientSuggestion(title: "Open Brand deck", subtitle: "Matches project Acme", kind: "wrapp",
                          targetId: "wrapp.branddeck", sfSymbol: "rectangle.on.rectangle.angled"),
    ]
    snap("ambient-canvas-three", AmbientCanvas(context: "LinkedIn", suggestions: three))

    let one = [
        AmbientSuggestion(title: "Draft a reply", subtitle: "You're in Mail · from Priya", kind: "widget",
                          targetId: "widget.reply", sfSymbol: "arrowshape.turn.up.left"),
    ]
    snap("ambient-canvas-one", AmbientCanvas(context: "Mail", suggestions: one))

    snap("ambient-dot", AmbientDot().padding(24).background(Color.page))

    // LocalCaptureBorder over a neutral mock desktop rect.
    let desktop = ZStack {
        LinearGradient(colors: [Color(red: 0x1B/255.0, green: 0x1D/255.0, blue: 0x22/255.0),
                                Color(red: 0x2A/255.0, green: 0x2C/255.0, blue: 0x33/255.0)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
        LocalCaptureBorder()
    }
    .frame(width: 900, height: 560)
    snap("local-capture-border", desktop)
    exit(0)
}
app.run()
