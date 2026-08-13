// Standalone snapshot of ToolCredentialDrop (the task-3 credential card). NOT in build.sh.
//   swiftc -parse-as-library CredSnap.preview.swift -o /tmp/credsnap && /tmp/credsnap
import AppKit
import SwiftUI

extension Color {
    static let page = Color(red: 0, green: 0, blue: 0)
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let inkDim = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
}
extension Font {
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
struct NotchDropShape: Shape {
    var ear: CGFloat = 14, botR: CGFloat = 20
    func path(in r: CGRect) -> Path {
        let w = r.width, h = r.height, e = min(ear, w/2), b = min(botR, (w-2*e)/2)
        var p = Path(); p.move(to: .init(x: 0, y: 0)); p.addLine(to: .init(x: w, y: 0))
        p.addQuadCurve(to: .init(x: w-e, y: e), control: .init(x: w-e, y: 0)); p.addLine(to: .init(x: w-e, y: h-b))
        p.addQuadCurve(to: .init(x: w-e-b, y: h), control: .init(x: w-e, y: h)); p.addLine(to: .init(x: e+b, y: h))
        p.addQuadCurve(to: .init(x: e, y: h-b), control: .init(x: e, y: h)); p.addLine(to: .init(x: e, y: e))
        p.addQuadCurve(to: .init(x: 0, y: 0), control: .init(x: e, y: 0)); p.closeSubpath(); return p
    }
}
struct ToolCredentialDrop: View {
    let toolName: String; let label: String; let hint: String
    @Binding var value: String
    var onSave: () -> Void = {}; var onCancel: () -> Void = {}
    @FocusState private var focused: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 10) {
                ZStack { RoundedRectangle(cornerRadius: 8).fill(Color.lime.opacity(0.14)).frame(width: 30, height: 30)
                    Image(systemName: "key.fill").font(.system(size: 13)).foregroundColor(.lime) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(.hanken(13, .semibold)).foregroundColor(.ink).lineLimit(1)
                    Text("\(toolName) · kept local, never leaves your Mac").font(.hanken(10)).foregroundColor(.inkFaint).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            SecureField(hint.isEmpty ? "paste your key" : hint, text: $value)
                .textFieldStyle(.plain).font(.hanken(12)).foregroundColor(.ink)
                .focused($focused)
                .padding(.horizontal, 9).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.raised))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
            HStack(spacing: 10) {
                Image(systemName: "lock.fill").font(.system(size: 8)).foregroundColor(.inkFaint)
                Text("stored 0600 in the daemon").font(.splMono(9)).foregroundColor(.inkFaint)
                Spacer(minLength: 0)
                Text("esc cancel").font(.splMono(9)).foregroundColor(.inkDim)
                Text("↵ save").font(.splMono(9)).foregroundColor(.lime)
            }
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 12)
        .frame(width: 320).padding(.horizontal, 14)
        .background(Color.page).clipShape(NotchDropShape()).ignoresSafeArea()
    }
}
@MainActor func snap<V: View>(_ n: String, _ v: V) {
    let f = v.padding(30).background(Color(white: 0.05)).fixedSize()
    let r = ImageRenderer(content: f); r.scale = 2
    guard let img = r.nsImage, let t = img.tiffRepresentation, let rep = NSBitmapImageRep(data: t), let png = rep.representation(using: .png, properties: [:]) else { print("FAIL"); return }
    try? FileManager.default.createDirectory(atPath: "/tmp/cred-snaps", withIntermediateDirectories: true)
    try? png.write(to: URL(fileURLWithPath: "/tmp/cred-snaps/\(n).png")); print("wrote /tmp/cred-snaps/\(n).png")
}
struct Holder: View { @State var v = "sk-demo-1234567"; var body: some View { ToolCredentialDrop(toolName: "Echo-Auth", label: "Echo-Auth API key", hint: "any non-empty string for the demo", value: $v) } }
struct HolderEmpty: View { @State var v = ""; var body: some View { ToolCredentialDrop(toolName: "Echo-Auth", label: "Echo-Auth API key", hint: "any non-empty string for the demo", value: $v) } }
@main struct CredSnap {
    static func main() {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        DispatchQueue.main.async { snap("cred-empty", HolderEmpty()); snap("cred-filled", Holder()); exit(0) }
        app.run()
    }
}
