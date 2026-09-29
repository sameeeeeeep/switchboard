// CallAudio — Granola-style call transcripts into the screen journal, entirely on this Mac.
//
// Two streams give "Me" and "Them" without any speaker model: the MICROPHONE is the user (macOS voice
// processing on, so the other side's voices from the speakers are echo-cancelled out of it), and the CALL
// APP'S OWN AUDIO (ScreenCaptureKit, filtered to that one app) is everyone else. Every 20 s each stream that
// actually has speech is written to a temporary WAV, transcribed by whisper.cpp, and deleted; the text lands
// in the journal as "Me: …" / "Them: …" lines tagged call + source audio, so recall, memory and cards work on it.
//
// CONSENT: a background watch scans window names every 10 s for a meeting (Meet code, Zoom / Teams meeting,
// FaceTime), whether or not it is in front, and ASKS at the notch before transcribing it ("audio": "ask", or true).
// "audio": "always" skips the question; false turns it off. One answer per meeting. Audio is never kept, only
// text; it stops within ~20 s of the meeting window closing. While it listens, the notch eyes turn amber.
import AppKit
import AVFoundation
import ScreenCaptureKit

final class CallAudio: NSObject, SCStreamOutput, SCStreamDelegate {
    static let shared = CallAudio()

    /// Main-thread callback: true while listening (drives the amber eyes).
    var onListening: ((Bool) -> Void)?
    /// Writes one journal entry (ScreenJournal.record); set at wiring time.
    var record: (([String: Any]) -> Void)?

    private let q = DispatchQueue(label: "switchboard.call-audio", qos: .utility)
    private var stream: SCStream?
    private var engine: AVAudioEngine?
    private var converter: AVAudioConverter?
    private var them: [Float] = [], me: [Float] = []
    private var timer: DispatchSourceTimer?
    private var callPid: pid_t = 0
    private var callBundle = "", callApp = "", callTitle = ""
    private(set) var active = false
    private var starting = false
    private let rate: Double = 16_000
    // meeting key → "transcribe" | "speakers" | "skip"; kept in ~/.relay/call-audio.json so a restart doesn't re-ask
    private lazy var decided: [String: String] = {
        guard let d = FileManager.default.contents(atPath: decisionsPath),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: String] else { return [:] }
        return j
    }() { didSet {
        if let d = try? JSONSerialization.data(withJSONObject: decided) {
            FileManager.default.createFile(atPath: decisionsPath, contents: d, attributes: [.posixPermissions: 0o600])
        }
    } }
    private var decisionsPath: String { (NSHomeDirectory() as NSString).appendingPathComponent(".relay/call-audio.json") }
    private var asking: (key: String, runId: String, pid: pid_t, app: String, bundle: String, title: String)?
    private var callKey = ""
    private var watchTimer: DispatchSourceTimer?
    private var voiceProcessing = true
    private var silentMicChunks = 0
    private var relay: String { (NSHomeDirectory() as NSString).appendingPathComponent(".relay") }

    // MARK: lifecycle

    /// Start the background meeting watch (once, at launch). Cheap: one window-list read every 10 s.
    func arm() {
        q.async {
            guard self.watchTimer == nil else { return }
            let t = DispatchSource.makeTimerSource(queue: self.q)
            t.schedule(deadline: .now() + 5, repeating: 10)
            t.setEventHandler { [weak self] in self?.watch() }
            t.resume()
            self.watchTimer = t
        }
    }

    /// "ask" (default when true), "always", or "off" — from ~/.relay/journal.json "audio".
    private func mode() -> String {
        // Independent of the screen journal: meetings can be transcribed with the screen sense off.
        guard let d = FileManager.default.contents(atPath: (relay as NSString).appendingPathComponent("journal.json")),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return "off" }
        if let b = j["audio"] as? Bool { return b ? "ask" : "off" }
        if let s = j["audio"] as? String, ["ask", "always"].contains(s) { return s }
        return "off"
    }

    private func watch() {
        let m = mode()
        if m == "off" { if active { stop(reason: "audio off") }; asking = nil; return }
        if let a = asking { readAnswer(a); return }
        guard !active, !starting, let meeting = findMeeting() else { return }
        switch decided[meeting.key] ?? (m == "always" ? "transcribe" : nil) {
        case "transcribe"?, "speakers"?: begin(meeting)
        case "skip"?: return
        default: ask(meeting)
        }
    }

    private typealias Meeting = (key: String, pid: pid_t, app: String, bundle: String, title: String)

    /// Any window (front or not) that is a meeting: a Meet code in the name, a Zoom / Teams meeting window, FaceTime.
    private func findMeeting() -> Meeting? {
        guard let infos = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        for info in infos {
            guard let name = info[kCGWindowName as String] as? String, !name.isEmpty,
                  let pid = info[kCGWindowOwnerPID as String] as? pid_t,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  let app = NSRunningApplication(processIdentifier: pid) else { continue }
            let bundle = (app.bundleIdentifier ?? "").lowercased(), n = name.lowercased()
            var key: String?
            if let r = n.range(of: #"[a-z]{3}-[a-z]{4}-[a-z]{3}"#, options: .regularExpression), n.contains("meet") { key = "meet:" + n[r] }
            else if bundle == "us.zoom.xos", n.contains("meeting") { key = "zoom:" + n }
            else if bundle.hasPrefix("com.microsoft.teams"), n.contains("meeting") || n.contains("call") { key = "teams:" + n }
            else if bundle == "com.apple.facetime", !n.isEmpty, n != "facetime" { key = "facetime:" + n }
            if let key { return (key, pid, app.localizedName ?? bundle, bundle, name) }
        }
        return nil
    }

    private func begin(_ m: Meeting) {
        starting = true
        callKey = m.key; callPid = m.pid; callBundle = m.bundle; callApp = m.app; callTitle = m.title
        Task { await self.start() }
    }

    /// One notch card per meeting. Uses the app's own guide-run.json protocol; skipped if another card is queued.
    private func ask(_ m: Meeting) {
        let runPath = (relay as NSString).appendingPathComponent("guide-run.json")
        guard !FileManager.default.fileExists(atPath: runPath) else { return }
        let runId = UUID().uuidString.lowercased()
        let label = m.key.hasPrefix("meet:") ? "Meet " + m.key.dropFirst(5) : m.title
        let run: [String: Any] = [
            "runId": runId, "title": "Meeting: \(label)", "source": "Switchboard · call audio", "sourceId": "call-audio",
            "mode": "teach",
            "steps": [[
                "id": "transcribe", "placement": "notch",
                "text": "Transcribe this meeting? Text only, on this Mac. Audio is never kept.",
                "say": "You're in a meeting. Want me to transcribe it?",
                "options": [
                    ["id": "transcribe", "label": "Transcribe", "detail": "Me and Them, into your journal", "recommended": true],
                    ["id": "speakers", "label": "Transcribe + identify speakers", "detail": "Names each person on the other side (coming soon: Me / Them for now)"],
                    ["id": "skip", "label": "Not this meeting", "detail": "Won't ask again for this one"],
                ],
            ]],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: run) else { return }
        let tmp = runPath + ".\(runId).tmp"
        FileManager.default.createFile(atPath: tmp, contents: data, attributes: [.posixPermissions: 0o600])
        do { try FileManager.default.linkItem(atPath: tmp, toPath: runPath) } catch { try? FileManager.default.removeItem(atPath: tmp); return }
        try? FileManager.default.removeItem(atPath: tmp)
        asking = (m.key, runId, m.pid, m.app, m.bundle, m.title)
        godLog("call audio: asked about \(m.key)")
    }

    private func readAnswer(_ a: (key: String, runId: String, pid: pid_t, app: String, bundle: String, title: String)) {
        let p = (relay as NSString).appendingPathComponent("guide-results/\(a.runId).json")
        guard let d = FileManager.default.contents(atPath: p),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
            if findMeeting()?.key != a.key { asking = nil }            // meeting gone before an answer: drop the question
            return
        }
        let step = (j["results"] as? [[String: Any]])?.first
        let note = (step?["feedback"] as? [String: Any])?["note"] as? String
        let pick = note == nil ? (step?["chosenOption"] as? String ?? "skip") : "skip"   // a typed note is not a yes
        decided[a.key] = pick
        asking = nil
        godLog("call audio: \(a.key) → \(pick)")
        if pick != "skip" { begin((a.key, a.pid, a.app, a.bundle, a.title)) }
    }

    func stopIfActive(reason: String) { q.async { if self.active { self.stop(reason: reason) } } }

    private func start() async {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first,
                  let scApp = content.applications.first(where: { $0.processID == callPid }) else {
                q.async { self.starting = false }; godLog("call audio: call app not shareable"); return
            }
            let cfg = SCStreamConfiguration()
            cfg.capturesAudio = true
            cfg.sampleRate = Int(rate)
            cfg.channelCount = 1
            cfg.excludesCurrentProcessAudio = true
            cfg.width = 2; cfg.height = 2                               // audio is the point; keep video negligible
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            let s = SCStream(filter: SCContentFilter(display: display, including: [scApp], exceptingWindows: []),
                             configuration: cfg, delegate: self)
            try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: q)
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: q)   // no-op sink so frames aren't logged as dropped
            try await s.startCapture()
            q.async {
                self.stream = s
                self.startMic()
                self.active = true; self.starting = false
                self.startTimer()
                DispatchQueue.main.async { self.onListening?(true) }
                // Named speakers from the meeting's own captions (CallCaptions.swift), alongside the audio.
                CallCaptions.shared.start(pid: self.callPid, meetingKey: self.callKey, app: self.callApp, bundle: self.callBundle,
                                          title: self.callTitle, record: { self.record?($0) })
                godLog("call audio ON: \(self.callApp) '\(self.callTitle.prefix(40))'")
            }
        } catch {
            q.async { self.starting = false }
            godLog("call audio: could not start (\(error.localizedDescription))")
        }
    }

    private func startMic() {
        let eng = AVAudioEngine()
        let input = eng.inputNode
        try? input.setVoiceProcessingEnabled(voiceProcessing)           // echo-cancel the far side out of "Me"
        if #available(macOS 14.0, *) {
            input.voiceProcessingOtherAudioDuckingConfiguration = .init(enableAdvancedDucking: false, duckingLevel: .min)
        }
        let inFmt = input.outputFormat(forBus: 0)
        guard let outFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false),
              let conv = AVAudioConverter(from: inFmt, to: outFmt) else { godLog("call audio: mic format unsupported"); return }
        converter = conv
        input.installTap(onBus: 0, bufferSize: 4096, format: inFmt) { [weak self] buf, _ in
            guard let self, let conv = self.converter else { return }
            let cap = AVAudioFrameCount(Double(buf.frameLength) * self.rate / inFmt.sampleRate) + 64
            guard let out = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: cap) else { return }
            var fed = false
            conv.convert(to: out, error: nil) { _, status in
                if fed { status.pointee = .noDataNow; return nil }
                fed = true; status.pointee = .haveData; return buf
            }
            guard let ch = out.floatChannelData?[0] else { return }
            let samples = Array(UnsafeBufferPointer(start: ch, count: Int(out.frameLength)))
            self.q.async { self.me.append(contentsOf: samples) }
        }
        do { try eng.start(); engine = eng } catch { godLog("call audio: mic unavailable (\(error.localizedDescription))") }
    }

    private func startTimer() {
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now() + 20, repeating: 20)
        t.setEventHandler { [weak self] in
            guard let self else { return }
            if !self.callWindowOpen() { self.stop(reason: "call ended"); return }
            self.flush()
        }
        t.resume()
        timer = t
    }

    private func stop(reason: String) {
        flush()
        timer?.cancel(); timer = nil
        if let s = stream { Task { try? await s.stopCapture() } }
        stream = nil
        engine?.inputNode.removeTap(onBus: 0); engine?.stop(); engine = nil; converter = nil
        them.removeAll(); me.removeAll()
        CallCaptions.shared.stop()
        active = false
        DispatchQueue.main.async { self.onListening?(false) }
        godLog("call audio OFF (\(reason))")
    }

    /// The call is still on while its app has an on-screen window whose title looks like the call's.
    private func callWindowOpen() -> Bool {
        guard let infos = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else { return false }
        // Window-server names differ from AX titles ("Meet – abc-defg-hij 🔊" vs "Meet – abc-defg-hij – Microphone…"),
        // so match on the Meet code when there is one, else on the title's first words.
        let t = callTitle.lowercased()
        let key = t.range(of: #"[a-z]{3}-[a-z]{4}-[a-z]{3}"#, options: .regularExpression).map { String(t[$0]) }
            ?? String(t.prefix(12))
        if findMeeting()?.key == callKey { return true }
        return infos.contains { info in
            (info[kCGWindowOwnerPID as String] as? pid_t) == callPid &&
            ((info[kCGWindowName as String] as? String)?.lowercased().contains(key) ?? false)
        }
    }

    // MARK: capture

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        try? sb.withAudioBufferList { abl, _ in
            guard let first = abl.first, let data = first.mData else { return }
            let n = Int(first.mDataByteSize) / MemoryLayout<Float>.size
            them.append(contentsOf: UnsafeBufferPointer(start: data.assumingMemoryBound(to: Float.self), count: n))
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        q.async { if self.active { self.stop(reason: "stream stopped: \(error.localizedDescription)") } }
    }

    // MARK: transcription

    private func flush() {
        let pairs = [("Them", them), ("Me", me)]
        them.removeAll(keepingCapacity: true); me.removeAll(keepingCapacity: true)
        var lines: [String] = []
        var heard: [String] = []
        // While captions are flowing they already name the other side; unnamed "Them" audio would duplicate them.
        let captionsLive = Date().timeIntervalSince(CallCaptions.shared.lastCaption) < 60
        for (who, samples) in pairs where !(who == "Them" && captionsLive) {
            let rms = samples.isEmpty ? 0 : sqrt(samples.reduce(0) { $0 + $1 * $1 } / Float(samples.count))
            // Voice processing can hand back pure zeros when the call app also holds the mic: fall back once.
            if who == "Me", samples.count > Int(rate), rms == 0, voiceProcessing {
                silentMicChunks += 1
                if silentMicChunks >= 1 {
                    voiceProcessing = false
                    engine?.inputNode.removeTap(onBus: 0); engine?.stop(); engine = nil; converter = nil
                    startMic()
                    godLog("call audio: mic was silent with echo cancellation; restarted without it")
                }
            }
            heard.append("\(who) \(String(format: "%.1f", Double(samples.count) / rate))s rms \(String(format: "%.4f", rms))")
            guard samples.count > Int(rate), rms > 0.004 else { continue }   // silence: don't spend CPU on it
            for s in transcribe(samples) { lines.append("\(who): \(s)") }
        }
        // Without echo cancellation the mic hears the speakers: drop "Me" lines that mostly repeat "Them".
        let words = { (l: String) in Set(l.lowercased().split(whereSeparator: { !$0.isLetter }).map(String.init)) }
        let themWords = lines.filter { $0.hasPrefix("Them:") }.reduce(into: Set<String>()) { $0.formUnion(words($1)) }
        lines.removeAll { l in
            guard l.hasPrefix("Me:") else { return false }
            let w = words(String(l.dropFirst(3)))
            return w.count >= 5 && Double(w.intersection(themWords).count) / Double(w.count) > 0.7
        }
        godLog("call audio chunk: \(heard.joined(separator: " · ")) → \(lines.count) lines")
        guard !lines.isEmpty else { return }
        record?(["t": ISO8601DateFormatter().string(from: Date()), "app": callApp, "bundle": callBundle,
                 "window": callTitle, "url": NSNull(), "via": "audio", "source": "audio", "call": true, "lines": lines])
    }

    private func transcribe(_ samples: [Float]) -> [String] {
        guard let bin = Self.whisperBin(), let model = Self.whisperModel() else { godLog("call audio: whisper not found"); return [] }
        let tmp = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/tmp")
        try? FileManager.default.createDirectory(atPath: tmp, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let wav = (tmp as NSString).appendingPathComponent("call-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(atPath: wav) }
        guard Self.writeWAV(samples, rate: Int(rate), to: wav) else { return [] }
        let p = Process(), out = Pipe()
        p.executableURL = URL(fileURLWithPath: bin)
        p.arguments = ["-m", model, "-f", wav, "-nt", "-np", "-l", "en"]
        p.standardOutput = out; p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return [] }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        let text = String(decoding: data, as: UTF8.self)
        return text.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.count >= 3 && !$0.hasPrefix("[") && !$0.hasPrefix("(") }   // drop [BLANK_AUDIO], (music)…
    }

    static func whisperBin() -> String? {
        let bundled = ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("stt/whisper-cli")
        return [bundled, "/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"].first { FileManager.default.fileExists(atPath: $0) }
    }
    /// Calls prefer the user's base.en model (clearer on real speech) over the bundled tiny one.
    static func whisperModel() -> String? {
        let dir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/models")
        if let f = (try? FileManager.default.contentsOfDirectory(atPath: dir))?.first(where: { $0.hasSuffix(".bin") && $0.contains("base.en") }) {
            return (dir as NSString).appendingPathComponent(f)
        }
        let bundled = ((Bundle.main.resourcePath ?? "") as NSString).appendingPathComponent("stt/ggml-tiny.en.bin")
        return FileManager.default.fileExists(atPath: bundled) ? bundled : nil
    }

    static func writeWAV(_ samples: [Float], rate: Int, to path: String) -> Bool {
        var pcm = Data(capacity: samples.count * 2)
        for s in samples { var v = Int16(max(-1, min(1, s)) * 32767).littleEndian; withUnsafeBytes(of: &v) { pcm.append(contentsOf: $0) } }
        var h = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { h.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { h.append(contentsOf: $0) } }
        h.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + pcm.count)); h.append(contentsOf: Array("WAVE".utf8))
        h.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        h.append(contentsOf: Array("data".utf8)); u32(UInt32(pcm.count))
        return FileManager.default.createFile(atPath: path, contents: h + pcm, attributes: [.posixPermissions: 0o600])
    }
}
