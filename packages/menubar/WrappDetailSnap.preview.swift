// Standalone ImageRenderer snapshot of the WRAPP DETAIL VIEW (RelayMenuBar.WrappDetailDrop) — NOT in build.sh.
// A faithful twin so the agent can eyeball it without a live app. Run:
//   swiftc -parse-as-library WrappDetailSnap.preview.swift -o /tmp/wdsnap && /tmp/wdsnap
import AppKit
import SwiftUI

extension Color {
    static let page   = Color(red: 0, green: 0, blue: 0)
    static let panel  = Color(red: 0x12/255.0, green: 0x13/255.0, blue: 0x11/255.0)
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge   = Color(red: 0x2A/255.0, green: 0x2C/255.0, blue: 0x28/255.0)
    static let ink    = Color(red: 0xEA/255.0, green: 0xF0/255.0, blue: 0xDC/255.0)
    static let inkSec = Color(red: 0xB6/255.0, green: 0xBE/255.0, blue: 0xAA/255.0)
    static let inkDim = Color(red: 0x8A/255.0, green: 0x90/255.0, blue: 0x78/255.0)
    static let inkFaint = Color(red: 0x62/255.0, green: 0x66/255.0, blue: 0x54/255.0)
    static let lime   = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let danger = Color(red: 0xFF/255.0, green: 0x4B/255.0, blue: 0x6E/255.0)
}
extension Font {
    static func doto(_ s: CGFloat, _ w: Font.Weight = .bold) -> Font { .system(size: s, weight: w, design: .monospaced) }
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}

struct WrappDetail {
    let name: String; let origin: String; let kind: String; let online: Bool
    let currentModel: String; let providers: [(provider: String, models: [String])]
    let tools: [(name: String, access: String)]; let mode: String
    let contextKinds: [String]; let project: String?
    let maxTokensPerDay: Int; let maxCallsPerMin: Int; let lastActive: String; let hasGrant: Bool
}

struct WrappDetailDrop: View {
    let d: WrappDetail
    var onPick: (String) -> Void = { _ in }
    var onUseDefault: () -> Void = {}
    var onSetMode: (String) -> Void = { _ in }
    var onOpen: () -> Void = {}
    var onDisconnect: () -> Void = {}
    var onClose: () -> Void = {}
    private func kindLabel(_ k: String) -> String { ["web":"Web","native":"Native","iphone":"iPhone","tab":"Tab"][k] ?? k }
    private let modes: [(id: String, label: String)] = [("ask","Ask"),("trust","Trust"),("readonly","Read-only")]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 11) {
                RoundedRectangle(cornerRadius: 9).fill(Color.lime.opacity(0.15))
                    .overlay(Image(systemName: "square.grid.2x2").font(.system(size: 16)).foregroundColor(.lime))
                    .frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 3) {
                    Text(d.name).font(.doto(17, .bold)).foregroundColor(.ink).lineLimit(1)
                    Text(d.origin).font(.splMono(9)).foregroundColor(.inkFaint).lineLimit(1).truncationMode(.middle)
                }
                Spacer(minLength: 8)
                HStack(spacing: 5) {
                    Circle().fill(d.online ? Color.lime : Color.inkFaint).frame(width: 6, height: 6)
                    Text(d.online ? "READY" : "IDLE").font(.splMono(8.5)).tracking(1).foregroundColor(d.online ? .lime : .inkFaint)
                }
            }
            HStack(spacing: 6) { chip(kindLabel(d.kind)); Spacer(minLength: 0) }.padding(.top, 8)
            if !d.hasGrant {
                Text("Connected, but no stored permissions yet — open it and it'll ask for what it needs.")
                    .font(.hanken(12)).foregroundColor(.inkFaint).fixedSize(horizontal: false, vertical: true).padding(.top, 14)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                        section("MODEL & SUBSCRIPTION")
                        modelRow(label: "App default", sub: "the wrapp chooses", selected: d.currentModel.isEmpty, action: onUseDefault)
                        if d.providers.isEmpty { Text("No models available — enable one in Settings › Models.").font(.hanken(11.5)).foregroundColor(.inkFaint).padding(.top, 6) }
                        ForEach(Array(d.providers.enumerated()), id: \.offset) { _, p in
                            Text(p.provider.uppercased()).font(.splMono(8.5)).tracking(1).foregroundColor(.inkFaint).padding(.top, 9).padding(.bottom, 2)
                            ForEach(p.models, id: \.self) { m in modelRow(label: m, sub: p.provider, selected: d.currentModel == m, action: { onPick(m) }) }
                        }
                        section("TRUST")
                        HStack(spacing: 6) {
                            ForEach(modes, id: \.id) { m in
                                let on = d.mode == m.id
                                Button(action: { onSetMode(m.id) }) {
                                    Text(m.label).font(.hanken(11.5, on ? .semibold : .medium)).foregroundColor(on ? .page : .inkDim)
                                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                                        .background(RoundedRectangle(cornerRadius: 7).fill(on ? Color.lime : Color.raised))
                                }.buttonStyle(.plain)
                            }
                        }
                        Text(d.mode == "trust" ? "Runs allowed tools without asking." : d.mode == "readonly" ? "Read-only — never writes or acts." : "Asks before each write/action.")
                            .font(.hanken(10.5)).foregroundColor(.inkFaint).padding(.top, 5)
                        section("TOOLS & PERMISSIONS · \(d.tools.count)")
                        if d.tools.isEmpty { Text("None granted.").font(.hanken(11.5)).foregroundColor(.inkFaint) }
                        else {
                            VStack(spacing: 5) {
                                ForEach(Array(d.tools.prefix(8).enumerated()), id: \.offset) { _, t in
                                    HStack(spacing: 8) {
                                        Text(prettyTool(t.name)).font(.splMono(10)).foregroundColor(.inkSec).lineLimit(1).truncationMode(.middle)
                                        Spacer(minLength: 6)
                                        Text(t.access).font(.splMono(8.5)).foregroundColor(t.access == "write" ? .lime : .inkDim)
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(Capsule().stroke(t.access == "write" ? Color.lime.opacity(0.4) : Color.edge, lineWidth: 1))
                                    }
                                }
                                if d.tools.count > 8 { Text("+\(d.tools.count - 8) more").font(.splMono(9)).foregroundColor(.inkFaint).frame(maxWidth: .infinity, alignment: .leading) }
                            }
                        }
                        section("CONTEXT")
                        HStack(spacing: 6) {
                            Text(d.project ?? "Using none").font(.hanken(12, .medium)).foregroundColor(d.project == nil ? .inkFaint : .ink)
                            Spacer(minLength: 0)
                            ForEach(d.contextKinds.prefix(3), id: \.self) { k in chip(k) }
                        }
                        section("USAGE")
                        Text("\(fmtTokens(d.maxTokensPerDay)) tokens/day · \(d.maxCallsPerMin) calls/min" + (d.lastActive.isEmpty ? "" : " · active \(d.lastActive)"))
                            .font(.splMono(10)).foregroundColor(.inkDim).fixedSize(horizontal: false, vertical: true)
                }
            }
            Rectangle().fill(Color.edge).frame(height: 1).padding(.top, 14).padding(.bottom, 12)
            HStack(spacing: 8) {
                Button(action: onDisconnect) { Text("Disconnect").font(.hanken(11.5, .medium)).foregroundColor(.danger)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.danger.opacity(0.35), lineWidth: 1))) }.buttonStyle(.plain)
                Spacer(minLength: 0)
                Button(action: onClose) { Text("Done").font(.hanken(11.5, .medium)).foregroundColor(.inkDim)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))) }.buttonStyle(.plain)
                Button(action: onOpen) { HStack(spacing: 6) { Text("Open").font(.hanken(11.5, .semibold)); Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)) }
                    .foregroundColor(.page).padding(.horizontal, 14).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.lime)) }.buttonStyle(.plain)
            }
        }
        .padding(18).frame(width: 380)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel).overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1)))
    }
    @ViewBuilder private func section(_ t: String) -> some View { Text(t).font(.splMono(9)).tracking(1.2).foregroundColor(.inkFaint).padding(.top, 15).padding(.bottom, 7) }
    private func chip(_ t: String) -> some View { Text(t).font(.splMono(9)).foregroundColor(.inkDim).padding(.horizontal, 7).padding(.vertical, 3).overlay(Capsule().stroke(Color.edge, lineWidth: 1)) }
    private func prettyTool(_ n: String) -> String {
        if n.hasPrefix("mcp__") { let parts = n.dropFirst(5).split(separator: "__"); return parts.count >= 2 ? "\(parts[0]) · \(parts.dropFirst().joined(separator: "·"))" : n }
        return n
    }
    private func fmtTokens(_ n: Int) -> String { n >= 1_000_000 ? "\(n/1_000_000)M" : n >= 1000 ? "\(n/1000)k" : "\(n)" }
    @ViewBuilder private func modelRow(label: String, sub: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle").font(.system(size: 13)).foregroundColor(selected ? .lime : .inkFaint)
                Text(label).font(.hanken(12.5, selected ? .semibold : .regular)).foregroundColor(.ink)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Color.lime.opacity(0.10) : Color.clear)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? Color.lime.opacity(0.4) : Color.edge, lineWidth: 1)))
        }.buttonStyle(.plain)
    }
}

@MainActor func snap<V: View>(_ name: String, _ v: V) {
    let framed = v.padding(30).background(Color(white: 0.03)).fixedSize()
    let r = ImageRenderer(content: framed); r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    try? FileManager.default.createDirectory(atPath: "/tmp/wd-snaps", withIntermediateDirectories: true)
    try? png.write(to: URL(fileURLWithPath: "/tmp/wd-snaps/\(name).png")); print("wrote /tmp/wd-snaps/\(name).png")
}

@main struct WrappDetailSnap {
    static func main() {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let providers: [(provider: String, models: [String])] = [
            ("Claude Code", ["sonnet","opus","haiku"]),
            ("Codex", ["gpt-5.5","gpt-5.4","gpt-5.3-codex"]),
            ("Ollama", ["llama3.1:8b"]),
        ]
        let tools: [(name: String, access: String)] = [
            ("mcp__claude_ai_Higgsfield__generate_image","write"),
            ("mcp__websearch__search","read"),
            ("mcp__bank__next_task","write"),
        ]
        let full = WrappDetail(name: "brandbrain", origin: "https://brandbrain.thelastprompt.ai", kind: "web", online: true,
            currentModel: "gpt-5.5", providers: providers, tools: tools, mode: "trust",
            contextKinds: ["brand"], project: "StayOften", maxTokensPerDay: 20_000_000, maxCallsPerMin: 30,
            lastActive: "2m ago", hasGrant: true)
        let deflt = WrappDetail(name: "God", origin: "native@ai.thelastprompt.god", kind: "native", online: true,
            currentModel: "", providers: providers, tools: [], mode: "ask",
            contextKinds: [], project: nil, maxTokensPerDay: 20_000_000, maxCallsPerMin: 30, lastActive: "just now", hasGrant: true)
        let nogrant = WrappDetail(name: "localhost:5174", origin: "http://localhost:5174", kind: "web", online: false,
            currentModel: "", providers: providers, tools: [], mode: "ask", contextKinds: [], project: nil,
            maxTokensPerDay: 0, maxCallsPerMin: 0, lastActive: "", hasGrant: false)
        DispatchQueue.main.async {
            snap("detail-full", WrappDetailDrop(d: full))
            snap("detail-default", WrappDetailDrop(d: deflt))
            snap("detail-nogrant", WrappDetailDrop(d: nogrant))
            NSApp.terminate(nil)
        }
        app.run()
    }
}
