// Senses — one place for what Switchboard is allowed to sense, each switched on its own:
//   • screen  — the screen journal (ScreenJournal.swift)          ~/.relay/journal-on
//   • audio   — meeting transcripts (CallAudio.swift)              journal.json "audio": false | "ask" | "always"
//   • camera  — presence + enrolled people (CameraPresence.swift)  journal.json "camera": true | false
// The notch (on hover), the loose pill and the Journal tab all use SensesPill, so every place shows the same three
// switches. Changes take effect within seconds; each sense re-reads its setting on its own timer.
import SwiftUI

enum Senses {
    static let relay = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
    static var flag: String { (relay as NSString).appendingPathComponent("journal-on") }
    static var configPath: String { (relay as NSString).appendingPathComponent("journal.json") }

    static func config() -> [String: Any] {
        guard let d = FileManager.default.contents(atPath: configPath),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
        return j
    }
    static func set(_ key: String, _ value: Any) {
        var j = config(); j[key] = value
        if let d = try? JSONSerialization.data(withJSONObject: j, options: [.prettyPrinted]) {
            FileManager.default.createFile(atPath: configPath, contents: d, attributes: [.posixPermissions: 0o600])
        }
    }

    static var screen: Bool { FileManager.default.fileExists(atPath: flag) }
    static func setScreen(_ on: Bool) {
        if on { FileManager.default.createFile(atPath: flag, contents: nil) } else { try? FileManager.default.removeItem(atPath: flag) }
    }
    /// "off" | "ask" | "always"
    static var audio: String {
        let v = config()["audio"]
        if let b = v as? Bool { return b ? "ask" : "off" }
        if let s = v as? String, ["ask", "always"].contains(s) { return s }
        return "off"
    }
    static func setAudio(_ mode: String) { set("audio", mode == "off" ? false as Any : mode as Any) }
    static var camera: Bool { config()["camera"] as? Bool ?? false }
    /// Camera is parked (founder, 2026-09-29): its switch, the viewfinder and People stay hidden unless "cameraLab": true.
    static var cameraLab: Bool { config()["cameraLab"] as? Bool ?? false }
    static func setCamera(_ on: Bool) { set("camera", on) }
}

/// Three switches (+ the journal). `compact` = icon-only, for the notch and the loose pill.
struct SensesPill: View {
    var compact = true
    @State private var screen = Senses.screen
    @State private var audio = Senses.audio
    @State private var camera = Senses.camera

    var body: some View {
        HStack(spacing: compact ? 5 : 8) {
            SenseToggle(symbol: screen ? "eye" : "eye.slash", label: "Screen", on: screen, color: .lime, compact: compact,
                        help: screen ? "Screen journal is on. Click to stop reading the screen." : "Screen journal is off. Click to start.") {
                screen.toggle(); Senses.setScreen(screen)
            }
            SenseToggle(symbol: audio == "off" ? "mic.slash" : "waveform", label: audio == "always" ? "Meetings: always" : (audio == "ask" ? "Meetings: ask" : "Meetings: off"),
                        on: audio != "off", color: .senseAudio, compact: compact,
                        help: "Meeting audio: \(audio). Click to cycle off → ask first → always.") {
                audio = audio == "off" ? "ask" : (audio == "ask" ? "always" : "off"); Senses.setAudio(audio)
            }
            if Senses.cameraLab {
            SenseToggle(symbol: camera ? "camera" : "video.slash", label: "Camera", on: camera, color: .senseCamera, compact: compact,
                        help: camera ? "Camera presence is on. Click to turn the camera off." : "Camera is off. Click to turn on presence (at desk / away / people you enrolled).") {
                camera.toggle(); Senses.setCamera(camera)
            }
            // The viewfinder: see who's in view and tag people (CameraPanel.swift).
            SenseToggle(symbol: "person.crop.rectangle", label: "Tag people", on: true, color: .senseCamera, compact: compact,
                        help: "Open the camera viewfinder to see who's in view and tag people (with their OK).") {
                CameraPanelController.shared.show()
            }
            }
        }
        .onAppear { screen = Senses.screen; audio = Senses.audio; camera = Senses.camera }
    }
}

private struct SenseToggle: View {
    let symbol: String
    let label: String
    let on: Bool
    let color: Color
    let compact: Bool
    let help: String
    let action: () -> Void
    @State private var over = false
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: compact ? 9 : 11, weight: .bold))
            if !compact { Text(label).font(.hanken(12, on ? .semibold : .regular)) }
        }
        .foregroundColor(on ? (over ? Color.page : color) : Color.inkFaint)
        .frame(minWidth: compact ? 22 : nil, minHeight: compact ? 18 : nil)
        .padding(.horizontal, compact ? 0 : 10).padding(.vertical, compact ? 0 : 6)
        .background(Capsule().fill(on && over ? color : Color.page))
        .overlay(Capsule().stroke(on ? color.opacity(0.8) : Color.edge, lineWidth: 0.8))
        .contentShape(Capsule())
        .onHover { over = $0 }
        .onTapGesture(perform: action)
        .help(help)
    }
}
