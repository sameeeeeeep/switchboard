// Standalone snapshot twin for the NOTCH CARD fixes — NOT in build.sh. Verifies (a) bigger, readable option
// fonts and (b) the step-media zone now FITS a full diagram at dynamic height instead of cropping a 96px box.
// Faithful ports of CursorGuide.swift optionsRow/optionCard + GuideMediaView (post-fix). Run:
//   cd packages/menubar
//   swiftc -parse-as-library NotchCardSnap.preview.swift -o /tmp/notchcardsnap && /tmp/notchcardsnap
import AppKit
import SwiftUI

extension Color {
    static let page     = Color(red: 0, green: 0, blue: 0)
    static let rail     = Color(red: 0x0A/255.0, green: 0x0A/255.0, blue: 0x0B/255.0)
    static let panel    = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)
    static let raised   = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge     = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink      = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkSec   = Color(red: 0xB4/255.0, green: 0xBE/255.0, blue: 0xCE/255.0)
    static let inkDim   = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime     = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
}
extension Font {
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
enum SBr { static let xs: CGFloat = 7 }

struct GuideMedia { let src: String; var caption: String? = nil; var tall: Bool = false }

// ── GuideMediaView — post-fix (fit + dynamic height for step media) ──
struct GuideMediaView: View {
    let media: GuideMedia
    var compact = false
    private let stepCapH: CGFloat = 460
    private var fillMode: ContentMode { compact ? .fill : .fit }
    var body: some View {
        Group {
            if compact { content.frame(maxWidth: .infinity).frame(height: media.tall ? 420 : 40) }
            else { content.frame(maxWidth: .infinity).frame(maxHeight: stepCapH) }
        }
        .clipShape(RoundedRectangle(cornerRadius: SBr.xs))
        .overlay(RoundedRectangle(cornerRadius: SBr.xs).stroke(Color.edge, lineWidth: 1))
    }
    @ViewBuilder private var content: some View {
        if let img = NSImage(contentsOfFile: media.src) {
            Image(nsImage: img).resizable().aspectRatio(contentMode: fillMode)
        } else {
            Text("preview unavailable").font(.hanken(10)).foregroundColor(.inkFaint)
                .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.raised)
        }
    }
}

struct GuideOption: Identifiable { let id = UUID(); let label: String; let detail: String?; var recommended = false }

// ── optionsRow / optionCard — post-fix fonts ──
struct OptionsTwin: View {
    let options: [GuideOption]
    let selected: Int
    let media: GuideMedia?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let md = media {
                Text("YOUR ⌥⌥ LAUNCHER NOW LEADS WITH YOUR TASKS").font(.splMono(9.5)).tracking(0.6).foregroundColor(.inkFaint)
                GuideMediaView(media: md, compact: false)
            }
            HStack(spacing: 5) {
                Text("PICK ONE — UPDATES LIVE").font(.splMono(9.5)).tracking(0.6).foregroundColor(.indigo)
                Text("★ recommended").font(.splMono(9)).foregroundColor(.lime.opacity(0.9))
            }
            HStack(alignment: .top, spacing: 7) {
                ForEach(Array(options.enumerated()), id: \.element.id) { (i, opt) in optionCard(i, opt) }
            }
        }
        .padding(20)
        .frame(width: 600, alignment: .leading)
        .background(Color.page)
    }
    private func optionCard(_ i: Int, _ opt: GuideOption) -> some View {
        let sel = i == selected
        let letter = i < 3 ? ["A","B","C"][i] : "\(i+1)"
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(sel ? "\(letter)✓" : letter).font(.splMono(10.5)).foregroundColor(sel ? .lime : .inkFaint)
                Text(opt.label).font(.hanken(13.5, .semibold)).foregroundColor(sel ? .ink : .inkSec)
                    .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let d = opt.detail, !d.isEmpty {
                Text(d).font(.hanken(11.5)).foregroundColor(.inkDim)
                    .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(7).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBr.xs).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: SBr.xs)
            .stroke(sel ? Color.lime : (opt.recommended ? Color.lime.opacity(0.4) : Color.edge), lineWidth: sel ? 1.5 : 1))
        .overlay(alignment: .topTrailing) {
            if opt.recommended {
                Text("★").font(.system(size: 9)).foregroundColor(.lime)
                    .padding(3).background(Circle().fill(Color.page.opacity(0.85))).padding(4)
            }
        }
    }
}

@MainActor func snap<V: View>(_ name: String, _ view: V) {
    let framed = view.padding(24).background(Color.rail).fixedSize(horizontal: false, vertical: true)
    let r = ImageRenderer(content: framed); r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    let dir = "/tmp/notch-card-snaps"; try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let p = "\(dir)/\(name).png"; try? png.write(to: URL(fileURLWithPath: p)); print("wrote \(p)")
}

@main struct NotchCardSnap {
    static func main() {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        DispatchQueue.main.async {
            let sp = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay/cafbf521-ac4b-4ce4-8129-4c75f979ee44/scratchpad"
            let opts = [
                GuideOption(label: "Phone page → inbox", detail: "works today, any phone, offline-ok", recommended: true),
                GuideOption(label: "iPhone bridge", detail: "most private, iOS app unshipped"),
                GuideOption(label: "Manual sync at laptop", detail: "zero infra, defeats the point"),
            ]
            // transport diagram as the STEP media (the one that was cropping) — proves dynamic full-fit height
            snap("notch-card-fixed", OptionsTwin(options: opts, selected: 0, media: GuideMedia(src: sp + "/transport.png")))
            exit(0)
        }
        app.run()
    }
}
