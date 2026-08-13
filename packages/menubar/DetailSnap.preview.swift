// Standalone ImageRenderer snapshot of the TASK DETAIL panel (OSSurfaceWorkspace.TaskDetailView) — NOT in
// build.sh. A faithful twin of the `panel` var so the agent can eyeball it without a live app. Run:
//   swiftc -parse-as-library DetailSnap.preview.swift -o /tmp/detailsnap && /tmp/detailsnap
import AppKit
import SwiftUI

extension Color {
    static let page   = Color(red: 0, green: 0, blue: 0)
    static let panel  = Color(red: 0x14/255.0, green: 0x14/255.0, blue: 0x16/255.0)
    static let raised = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge   = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink    = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkSec = Color(red: 0xB4/255.0, green: 0xBE/255.0, blue: 0xCE/255.0)
    static let inkDim = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime   = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let danger = Color(red: 0xFF/255.0, green: 0x2D/255.0, blue: 0x6E/255.0)
}
extension Font {
    static func brico(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .system(size: s, weight: w) }
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
let sbAmber = Color(red: 0.96, green: 0.62, blue: 0.04)
let KANBAN: [(id: String, name: String, dot: Color)] = [
    ("backlog", "Backlog", .inkFaint), ("todo", "Todo", .inkDim), ("doing", "Doing", .lime), ("blocked", "Blocked", .danger), ("review", "Review", .indigo),
]
struct TaskDetail: Identifiable { let id = UUID(); let sub: Bool; let done: Bool; let text: String }
struct T { var title: String; var proj: String?; var epic: String?; var due: String?; var over = false; var prio: String?; var wait: String?; var kanban: String; var checkedNow = false; var opensApp = false; var appName = ""; var detail: [TaskDetail] = [] }

struct DetailPanel: View {
    let task: T
    private var status: (id: String, name: String, dot: Color)? { KANBAN.first { $0.id == task.kanban } }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if let s = status { Circle().fill(s.dot).frame(width: 8, height: 8)
                    Text(s.name.uppercased()).font(.splMono(10)).tracking(1.2).foregroundColor(.inkDim) }
                Spacer(minLength: 0)
                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundColor(.inkDim)
                    .frame(width: 26, height: 26).background(Circle().fill(Color.raised)).overlay(Circle().stroke(Color.edge, lineWidth: 1))
            }
            Text(task.title).font(.brico(19, .bold)).foregroundColor(.ink).fixedSize(horizontal: false, vertical: true).padding(.top, 12)
            HStack(spacing: 7) {
                if let p = task.proj { chip(p, .inkDim, .edge) }
                if let e = task.epic { chip("◇ " + e, .indigo, Color.indigo.opacity(0.4)) }
                if let d = task.due { chip((task.over ? "overdue · " : "due ") + d, task.over ? sbAmber : .inkDim, task.over ? sbAmber.opacity(0.5) : .edge) }
                if let pr = task.prio, pr != "low" { chip((pr == "high" ? "● " : "○ ") + pr, pr == "high" ? .danger : sbAmber, .edge) }
                Spacer(minLength: 0)
            }.padding(.top, 12)
            if let w = task.wait {
                HStack(alignment: .top, spacing: 7) { Text("⊘").font(.splMono(11)).foregroundColor(.danger)
                    Text(w).font(.hanken(12)).foregroundColor(sbAmber).fixedSize(horizontal: false, vertical: true); Spacer(minLength: 0) }
                .padding(.horizontal, 10).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.danger.opacity(0.08)))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color.danger.opacity(0.3), lineWidth: 1)).padding(.top, 12)
            }
            Group {
                if task.detail.isEmpty { Text("No details on this task yet.").font(.hanken(12.5)).foregroundColor(.inkFaint) }
                else { VStack(alignment: .leading, spacing: 8) { ForEach(task.detail) { d in
                    HStack(alignment: .top, spacing: 8) {
                        Text(d.sub ? (d.done ? "☑" : "☐") : "·").font(.splMono(11)).foregroundColor(d.sub && d.done ? .lime : .inkFaint)
                        Text(d.text).font(.hanken(12.5)).foregroundColor(.inkSec).fixedSize(horizontal: false, vertical: true); Spacer(minLength: 0) } } } }
            }.padding(.top, 14)
            Rectangle().fill(Color.edge).frame(height: 1).padding(.vertical, 14)
            Text("MOVE TO").font(.splMono(9)).tracking(1.2).foregroundColor(.inkFaint)
            HStack(spacing: 6) { ForEach(KANBAN, id: \.id) { s in
                let on = s.id == task.kanban
                HStack(spacing: 5) { Circle().fill(s.dot).frame(width: 6, height: 6)
                    Text(s.name).font(.hanken(11, on ? .semibold : .medium)).foregroundColor(on ? .ink : .inkDim) }
                .padding(.horizontal, 9).padding(.vertical, 5).background(Capsule().fill(on ? Color.raised : Color.clear))
                .overlay(Capsule().stroke(on ? Color.lime.opacity(0.5) : Color.edge, lineWidth: 1)) } }.padding(.top, 8)
            HStack(spacing: 10) {
                HStack(spacing: 6) { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)); Text("Mark done").font(.hanken(12.5, .semibold)) }
                    .foregroundColor(.page).padding(.horizontal, 12).padding(.vertical, 8).background(Capsule().fill(Color.lime))
                Spacer(minLength: 0)
                if task.opensApp {
                    HStack(spacing: 6) { Text("Open in \(task.appName)").font(.hanken(12.5, .semibold)); Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)) }
                        .foregroundColor(.lime).padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Capsule().fill(Color.lime.opacity(0.12))).overlay(Capsule().stroke(Color.lime.opacity(0.4), lineWidth: 1))
                }
            }.padding(.top, 16)
        }
        .padding(22).frame(width: 460)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
    }
    private func chip(_ t: String, _ fg: Color, _ stroke: Color) -> some View {
        Text(t).font(.splMono(10)).foregroundColor(fg).padding(.horizontal, 8).padding(.vertical, 3).overlay(Capsule().stroke(stroke, lineWidth: 1))
    }
}

@MainActor func snap<V: View>(_ name: String, _ v: V) {
    let framed = v.padding(30).background(Color(white: 0.04)).fixedSize()
    let r = ImageRenderer(content: framed); r.scale = 2
    guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("FAIL \(name)"); return }
    try? FileManager.default.createDirectory(atPath: "/tmp/detail-snaps", withIntermediateDirectories: true)
    try? png.write(to: URL(fileURLWithPath: "/tmp/detail-snaps/\(name).png")); print("wrote /tmp/detail-snaps/\(name).png")
}

@main struct DetailSnap {
    static func main() {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        DispatchQueue.main.async {
            let tagged = T(title: "Dictation → screen-aware GENERATE mode (hold ⌘ at commit)",
                           proj: "#switchboard", epic: "dictation", due: "2026-08-15", over: false, prio: "high",
                           wait: nil, kanban: "doing", opensApp: true, appName: "god",
                           detail: [TaskDetail(sub: false, done: false, text: "⌃⌥ dictate, hold ⌘ at commit → app-aware output via a local model (Claude fallback)."),
                                    TaskDetail(sub: true, done: true, text: "Add dictateGenerateArmed flag + commit routing"),
                                    TaskDetail(sub: true, done: false, text: "Per-app system-prompt persona from AmbientSignal.kind")])
            let plain = T(title: "Legal OK on pricing copy", proj: "#switchboard", epic: "launch", due: "2026-08-08", over: true,
                          prio: nil, wait: "waiting: Ship the pricing page", kanban: "blocked", opensApp: false, detail: [])
            snap("detail-tagged", DetailPanel(task: tagged))
            snap("detail-plain", DetailPanel(task: plain))
            exit(0)
        }
        app.run()
    }
}
