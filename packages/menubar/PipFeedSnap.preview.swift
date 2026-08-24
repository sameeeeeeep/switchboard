// Standalone SNAPSHOT harness for the /pip FEED card (CursorGuide.pipFeedCard) — renders the persistent
// multi-thread stream + the two new controls the founder asked for (2026-08-24): a DISMISS ✕ and a
// per-thread FILTER (tap a colour dot to show only that thread). NOT in build.sh (own @main). Same
// convention as the other *.preview.swift: it carries its own copy of the tokens + a faithful port of the
// card body. When CursorGuide's pipFeedCard changes, re-sync this copy.
//
//   cd packages/menubar
//   swiftc -parse-as-library PipFeedSnap.preview.swift -o /tmp/pipsnap && SNAP_DIR=/tmp/pip /tmp/pipsnap
//
// Prints one `wrote <path>` per PNG. Covers every state: no-events · one-thread · many-threads ·
// filtered · filtered-to-a-now-silent-thread.
import AppKit
import SwiftUI

// ---- tokens (verbatim from RelayMenuBar.swift / the other *.preview.swift) ----
extension Color {
    static let page     = Color(red: 0x0A/255.0, green: 0x0C/255.0, blue: 0x10/255.0)
    static let panel    = Color(red: 0x14/255.0, green: 0x15/255.0, blue: 0x1B/255.0)
    static let raised   = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge     = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink      = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim   = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime     = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let indigo   = Color(red: 0x5B/255.0, green: 0x4F/255.0, blue: 0xE8/255.0)
    static let blue     = Color(red: 0x4A/255.0, green: 0x9E/255.0, blue: 0xFF/255.0)
}
extension Font {
    // doto/splMono stand-ins for the snapshot (the real app uses the bundled Doto + a mono face).
    static func doto(_ s: CGFloat, _ w: Font.Weight = .bold) -> Font { .system(size: s, weight: w, design: .rounded) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}

// deterministic per-thread colour — verbatim from OSShellView.colorForId / hueForId (FNV-1a).
func hueForId(_ id: String) -> Double {
    var h: UInt64 = 1469598103934665603
    for b in id.lowercased().utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
    return Double(h % 360) / 360.0
}
func colorForId(_ id: String) -> Color { Color(hue: hueForId(id), saturation: 0.60, brightness: 0.82) }

// ---- a static dot-matrix stand-in for the animated DotMatrix beacon (a lit 6×6 "working" field) ----
struct DMStub: View {
    var accent: Color = .lime
    var body: some View {
        VStack(spacing: 2.4) { ForEach(0..<6, id: \.self) { r in
            HStack(spacing: 2.4) { ForEach(0..<6, id: \.self) { c in
                let lit = (r + c) % 2 == 0
                RoundedRectangle(cornerRadius: 1).fill(lit ? accent : Color(red:0x2b/255,green:0x33/255,blue:0x40/255))
                    .frame(width: 2, height: 2)
            } }
        } }.frame(width: 42, height: 42)
    }
}

// ---- a row in the stream (mirrors CursorGuide.PipRow) ----
struct Row: Identifiable {
    let id = UUID(); let kicker: String; let text: String; let accent: Color; let source: String; let agoS: Int
}

// ---- faithful port of CursorGuide.pipFeedCard (+ pipDot), floating (detached) styling ----
struct PipCard: View {
    var rows: [Row]
    var filter: String?

    private var sources: [String] {
        var seen = Set<String>(); var out: [String] = []
        for row in rows where !row.source.isEmpty && row.source != "•" {
            if seen.insert(row.source).inserted { out.append(row.source) }
        }
        if let f = filter, !f.isEmpty, !seen.contains(f) { out.append(f) }
        return out
    }
    private var visible: [Row] { filter == nil ? rows : rows.filter { $0.source == filter } }

    private func ago(_ s: Int) -> String {
        if s < 5 { return "now" }; if s < 60 { return "\(s)s" }
        let m = s / 60; if m < 60 { return "\(m)m" }; return "\(m/60)h"
    }

    private func dot(source: String?, on: Bool) -> some View {
        let fill: Color = source == nil ? .inkDim : colorForId(source!)
        return Circle().fill(fill)
            .frame(width: on ? 9 : 7, height: on ? 9 : 7)
            .opacity(on ? 1 : 0.5)
            .overlay(Circle().stroke(Color.lime, lineWidth: on ? 1.5 : 0).padding(-3))
            .frame(width: 20, height: 20)
    }

    var body: some View {
        let r = visible.first
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                Circle().fill(Color.lime).frame(width: 6, height: 6).shadow(color: Color.lime.opacity(0.7), radius: 3)
                Text("PIP").font(.splMono(9)).tracking(1.6).foregroundColor(.lime)
                Spacer(minLength: 0)
                if visible.count > 1 {
                    Text("+\(visible.count - 1)").font(.splMono(8.5)).foregroundColor(.inkFaint)
                }
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundColor(.inkDim)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(Color.white.opacity(0.06)))
            }
            if sources.count >= 2 || filter != nil {
                HStack(spacing: 6) {
                    Text(filter == nil ? "THREADS" : "ONLY").font(.splMono(7.5)).tracking(0.8)
                        .foregroundColor(filter == nil ? .inkFaint : .lime)
                    dot(source: nil, on: filter == nil)
                    ForEach(sources, id: \.self) { s in dot(source: s, on: filter == s) }
                    Spacer(minLength: 0)
                }
            }
            if let r {
                HStack(alignment: .center, spacing: 13) {
                    DMStub(accent: r.accent)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(r.kicker).font(.splMono(8.5)).tracking(0.9).foregroundColor(r.accent)
                            Spacer(minLength: 0)
                            Text(ago(r.agoS)).font(.splMono(8.5)).foregroundColor(.inkFaint)
                        }
                        Text(r.text).font(.doto(15, .bold)).foregroundColor(.ink)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: 5) {
                            Circle().fill(colorForId(r.source)).frame(width: 5, height: 5)
                            Text(r.source).font(.splMono(8)).foregroundColor(.inkFaint).lineLimit(1)
                        }
                    }
                }
            } else if let f = filter {
                HStack(alignment: .center, spacing: 13) {
                    Circle().fill(colorForId(f)).frame(width: 10, height: 10).opacity(0.6)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("THREAD QUIET").font(.doto(12, .bold)).tracking(1).foregroundColor(.inkFaint)
                        Text("waiting for \(f)").font(.splMono(8)).foregroundColor(.inkFaint).lineLimit(1)
                    }
                }
            } else {
                Text("WATCHING YOUR THREADS").font(.doto(12, .bold)).tracking(1).foregroundColor(.inkFaint)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .frame(width: 340, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.panel.opacity(0.98))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.lime.opacity(0.45), lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 12, x: 0, y: 6))
    }
}

@main
struct PipFeedSnap {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let dir = ProcessInfo.processInfo.environment["SNAP_DIR"] ?? (NSTemporaryDirectory() + "pip")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        // A many-thread buffer: three sources interleaved (newest first).
        let many: [Row] = [
            Row(kicker: "WORKING", text: "resize kit 73/73 green — wiring the widget", accent: .lime,   source: "Claude Code · pip-filter", agoS: 3),
            Row(kicker: "BOARD",   text: "merged #124 one-drag fix; board 3 done",      accent: .blue,   source: "Claude Code · handoff",    agoS: 40),
            Row(kicker: "DECIDED", text: "harvesting contrast first — we lack a11y",     accent: .lime,   source: "Claude Code · redline",    agoS: 90),
            Row(kicker: "THREAD",  text: "picking up store-skins polish",                accent: .indigo, source: "Claude Code · handoff",    agoS: 140),
            Row(kicker: "WORKING", text: "spec'd all five states for the filter",        accent: .lime,   source: "Claude Code · pip-filter", agoS: 200),
        ]
        let one: [Row] = [
            Row(kicker: "WORKING", text: "picking up PIP dismiss + thread-filter", accent: .lime, source: "Claude Code · pm", agoS: 4),
        ]

        func card(_ rows: [Row], _ filter: String?) -> some View {
            ZStack {
                LinearGradient(colors: [Color(red:0x11/255,green:0x14/255,blue:0x1c/255),
                                        Color(red:0x08/255,green:0x09/255,blue:0x0d/255)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                PipCard(rows: rows, filter: filter)
            }
            .frame(width: 460, height: 260)
        }

        func snap(_ name: String, _ v: some View) {
            let r = ImageRenderer(content: v)
            r.scale = 2
            guard let cg = r.cgImage else { print("FAIL \(name)"); return }
            let rep = NSBitmapImageRep(cgImage: cg)
            guard let png = rep.representation(using: .png, properties: [:]) else { print("FAIL png \(name)"); return }
            let path = dir + "/" + name + ".png"
            try? png.write(to: URL(fileURLWithPath: path))
            print("wrote \(path)")
        }

        snap("pip-empty",    card([],   nil))                                  // no events yet
        snap("pip-one",      card(one,  nil))                                  // one thread → no selector strip
        snap("pip-many",     card(many, nil))                                  // many threads → dots strip, unfiltered
        snap("pip-filtered", card(many, "Claude Code · pip-filter"))           // filtered to one thread
        snap("pip-quiet",    card(many, "Claude Code · deploy"))               // filtered to a thread with nothing in buffer
        exit(0)
    }
}
