import AppKit
import SwiftUI

// The Switchboard store FRONT PAGE — App-Store-style featured page (the "one page before all apps").
// Dark, house tokens, real content. Snapshot preview to nail layout vs the Apple reference.

@MainActor func snap<V: View>(_ name: String, _ view: V, w: CGFloat) {
    let r = ImageRenderer(content: view.frame(width: w).fixedSize(horizontal: false, vertical: true)); r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    try? png.write(to: URL(fileURLWithPath: "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-settings-layout-overflow-2ee5dc/57a992f5-298f-4ee6-a2e0-04e931b231db/scratchpad/\(name).png"))
    print("wrote \(name)")
}

extension Color {
    static let page = Color(red: 0, green: 0, blue: 0)
    static let panel = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
}
extension Font {
    static func brico(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .system(size: s, weight: w) }
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
extension View { func kicker() -> some View { self.font(.splMono(9.5)).kerning(1.6).foregroundColor(.inkFaint) } }
enum T { static let pad: CGFloat = 28; static let gap: CGFloat = 20; static let rCard: CGFloat = 18; static let rIcon: CGFloat = 15; static let rSm: CGFloat = 9 }

// ---- top bar (sticky): wordmark · segmented tabs · search · close ----
struct StoreTopBar: View {
    let tab: String
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 6).fill(Color.lime).frame(width: 20, height: 20)
                        .overlay(Circle().fill(Color.page).frame(width: 6, height: 6).offset(x: 5.5, y: -5.5))
                    Text("Switchboard").font(.brico(17, .bold)).foregroundColor(.ink)
                }
                Spacer(minLength: 18)
                HStack(spacing: 4) {
                    ForEach(["Featured", "Apps", "Skills", "Categories"], id: \.self) { t in
                        Text(t).font(.hanken(12.5, t == tab ? .semibold : .medium)).foregroundColor(t == tab ? .page : .inkDim)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(Capsule().fill(t == tab ? Color.lime : Color.clear))
                    }
                }
                Spacer(minLength: 18)
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11, weight: .semibold)).foregroundColor(.inkFaint)
                    Text("Search").font(.hanken(12)).foregroundColor(.inkFaint)
                }.padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Capsule().fill(Color.panel)).overlay(Capsule().stroke(Color.edge, lineWidth: 1)).frame(width: 150, alignment: .leading)
                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundColor(.inkDim)
                    .frame(width: 30, height: 30).background(Circle().fill(Color.panel)).overlay(Circle().stroke(Color.edge, lineWidth: 1))
            }
            .padding(.horizontal, T.pad).padding(.vertical, 16)
            Rectangle().fill(Color.edge).frame(height: 1)
        }.background(Color.page)
    }
}

// ---- big featured hero card (2-up) ----
struct FeaturedCard: View {
    let eyebrow: String, title: String, sub: String, symbol: String, c1: Color, c2: Color
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text(eyebrow).kicker()
                Text(title).font(.brico(22, .bold)).foregroundColor(.ink).fixedSize(horizontal: false, vertical: true)
                Text(sub).font(.hanken(12.5)).foregroundColor(.inkDim).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Text("Get").font(.hanken(12, .semibold)).foregroundColor(.page)
                    .padding(.horizontal, 16).padding(.vertical, 6).background(Capsule().fill(Color.lime))
            }
            Spacer(minLength: 0)
            ZStack {
                Circle().fill(LinearGradient(colors: [c1, c2], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: symbol).font(.system(size: 34, weight: .semibold)).foregroundColor(.white.opacity(0.92))
            }.frame(width: 104, height: 104)
        }
        .padding(18).frame(height: 190, alignment: .top)
        .background(RoundedRectangle(cornerRadius: T.rCard).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: T.rCard).stroke(Color.edge, lineWidth: 1))
    }
}

struct SectionHeader: View {
    let title: String
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.brico(19, .bold)).foregroundColor(.ink)
            Spacer()
            Text("See All").font(.hanken(12.5, .semibold)).foregroundColor(.lime)
        }
    }
}

// ---- app row (icon · name · tagline · Get) ----
struct AppRow: View {
    let symbol: String, tint: Color, name: String, tagline: String; var free = false
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: T.rIcon).fill(LinearGradient(colors: [tint.opacity(0.9), tint.opacity(0.55)], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: symbol).font(.system(size: 22, weight: .semibold)).foregroundColor(.white.opacity(0.95))
            }.frame(width: 54, height: 54)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.hanken(13.5, .semibold)).foregroundColor(.ink).lineLimit(1)
                Text(tagline).font(.hanken(11.5)).foregroundColor(.inkDim).lineLimit(1)
                if free { Text("Free · runs on your Claude").font(.splMono(8.5)).foregroundColor(.inkFaint) }
            }
            Spacer(minLength: 8)
            Text("Get").font(.hanken(11.5, .semibold)).foregroundColor(.ink)
                .padding(.horizontal, 15).padding(.vertical, 6)
                .background(Capsule().fill(Color.raised)).overlay(Capsule().stroke(Color.edge, lineWidth: 1))
        }.padding(.vertical, 6)
    }
}

// two-column grid of app rows
struct AppGrid: View {
    let rows: [(String, Color, String, String, Bool)]
    let cols = [GridItem(.flexible(), spacing: 28), GridItem(.flexible(), spacing: 28)]
    var body: some View {
        LazyVGrid(columns: cols, alignment: .leading, spacing: 4) {
            ForEach(0..<rows.count, id: \.self) { i in
                let r = rows[i]; AppRow(symbol: r.0, tint: r.1, name: r.2, tagline: r.3, free: r.4)
            }
        }
    }
}

struct StoreFront: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StoreTopBar(tab: "Featured")
            VStack(alignment: .leading, spacing: T.gap + 8) {
                HStack(spacing: 16) {
                    FeaturedCard(eyebrow: "APPS WE LOVE", title: "Roast, then\nrewrite", sub: "Paste your pitch. Get roasted — then polished, on your own Claude.", symbol: "flame.fill", c1: Color(red: 1, green: 0.45, blue: 0.3), c2: Color(red: 0.8, green: 0.2, blue: 0.5))
                    FeaturedCard(eyebrow: "GET STARTED", title: "Dictate\nanywhere", sub: "Flow turns your voice into text in any app. Private, instant.", symbol: "mic.fill", c1: Color(red: 0.3, green: 0.7, blue: 0.6), c2: Color(red: 0.2, green: 0.5, blue: 0.7))
                }
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Apps we love right now")
                    AppGrid(rows: [
                        ("photo.artframe", Color(red: 0.45, green: 0.5, blue: 0.95), "Prism", "On-brand images, any background", false),
                        ("pencil.and.outline", Color(red: 0.9, green: 0.35, blue: 0.45), "Redline", "Mark up a landing page like a doc", false),
                        ("megaphone.fill", Color(red: 0.95, green: 0.6, blue: 0.25), "AdForge", "This week's ads from your brand", false),
                        ("globe", Color(red: 0.35, green: 0.75, blue: 0.55), "Marquee", "A landing page that ships to a domain", false),
                    ])
                }
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "New skills")
                    AppGrid(rows: [
                        ("text.line.first.and.arrowtriangle.forward", Color(red: 0.55, green: 0.6, blue: 0.7), "Gist", "TL;DR anything on your screen", true),
                        ("arrow.triangle.2.circlepath", Color(red: 0.6, green: 0.55, blue: 0.85), "Rephrase", "Rewrite in any tone or length", true),
                        ("eye", Color(red: 0.4, green: 0.7, blue: 0.75), "Explain This", "Plain-English what you're looking at", true),
                        ("character.bubble", Color(red: 0.8, green: 0.5, blue: 0.6), "Translate", "To your language, tone kept", true),
                        ("checkmark.seal", Color(red: 0.5, green: 0.75, blue: 0.5), "Polish", "Proofread, keep your voice", true),
                        ("tablecells", Color(red: 0.7, green: 0.6, blue: 0.4), "Extract", "Pull fields from any blob", true),
                    ])
                }
            }
            .padding(.horizontal, T.pad).padding(.top, T.gap + 4).padding(.bottom, 34)
        }
        .frame(width: 880, alignment: .leading)
        .background(Color.page)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.edge, lineWidth: 1))
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
DispatchQueue.main.async { snap("store-front", StoreFront(), w: 880); exit(0) }
app.run()
