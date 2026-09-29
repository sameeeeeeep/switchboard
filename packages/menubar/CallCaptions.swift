// CallCaptions — named speakers for call transcripts, read from the meeting's own live captions.
//
// Meet / Zoom / Teams already know who is talking: with captions on, they draw "Name" + what that person said at
// the bottom of the call window. While CallAudio is transcribing a meeting (the user said yes at the notch), this
// reads ONLY the bottom third of that window every 3 s (screencapture -l works even when the call is behind other
// windows), runs fast on-device OCR, splits it into speaker blocks, and journals each COMPLETE sentence once as
// "Name: sentence" ("You" → "Me"). Captions scroll away within seconds, which is why it polls this often and
// this small. Nothing is stored except the text lines; the crop is deleted immediately.
import AppKit
import Vision

final class CallCaptions {
    static let shared = CallCaptions()

    private let q = DispatchQueue(label: "switchboard.call-captions", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var pid: pid_t = 0
    private var meetingKey = ""
    private var app = "", bundle = "", title = ""
    private var record: (([String: Any]) -> Void)?
    private var seen: [String: Date] = [:]              // "speaker|sentence" → when journaled
    private(set) var lastCaption = Date.distantPast    // CallAudio drops unnamed "Them" lines while captions flow
    private var known: Set<String> = []                // participant names, learned from the journal's tile captures
    private var knownAt = Date.distantPast

    func start(pid: pid_t, meetingKey: String, app: String, bundle: String, title: String, record: @escaping ([String: Any]) -> Void) {
        q.async {
            self.stopLocked()
            self.pid = pid; self.meetingKey = meetingKey; self.app = app; self.bundle = bundle; self.title = title
            self.record = record
            let t = DispatchSource.makeTimerSource(queue: self.q)
            t.schedule(deadline: .now() + 2, repeating: 3)
            t.setEventHandler { [weak self] in self?.tick() }
            t.resume()
            self.timer = t
        }
    }

    func stop() { q.async { self.stopLocked() } }
    private func stopLocked() { timer?.cancel(); timer = nil; seen.removeAll() }

    private func tick() {
        guard let wid = windowID(), let lines = ocrCaptionBand(wid), !lines.isEmpty else { return }
        if Date().timeIntervalSince(knownAt) > 60 { known = learnNames(); knownAt = Date() }
        let blocks = Self.parse(lines, known: known)
        var out: [String] = []
        let now = Date()
        for b in blocks {
            // only COMPLETE sentences; the last one in a live block may still be growing
            for s in Self.sentences(b.text) where s.complete {
                let key = b.speaker.lowercased() + "|" + s.text.lowercased()
                if seen[key] != nil { continue }
                seen[key] = now
                out.append("\(b.speaker): \(s.text)")
            }
        }
        if seen.count > 4000 { seen = seen.filter { now.timeIntervalSince($0.value) < 1800 } }
        guard !out.isEmpty else { return }
        lastCaption = now
        record?(["t": ISO8601DateFormatter().string(from: now), "app": app, "bundle": bundle, "window": title,
                 "url": NSNull(), "via": "captions", "source": "audio", "call": true, "lines": out])
    }

    /// The meeting's window (front or not): same pid, name containing the meeting code / title stem.
    private func windowID() -> Int? {
        guard let infos = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        let stem = meetingKey.split(separator: ":").last.map(String.init) ?? ""
        return infos.first { i in
            (i[kCGWindowOwnerPID as String] as? pid_t) == pid && (i[kCGWindowLayer as String] as? Int) == 0 &&
            ((i[kCGWindowName as String] as? String)?.lowercased().contains(stem) ?? false)
        }?[kCGWindowNumber as String] as? Int
    }

    /// Capture the window, keep the bottom third (where captions live), OCR it fast, top-to-bottom lines.
    private func ocrCaptionBand(_ wid: Int) -> [String]? {
        let tmp = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/tmp")
        try? FileManager.default.createDirectory(atPath: tmp, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let path = (tmp as NSString).appendingPathComponent("captions-\(UUID().uuidString).png")
        defer { try? FileManager.default.removeItem(atPath: path) }
        let cap = Process()
        cap.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        cap.arguments = ["-x", "-o", "-l", String(wid), "-t", "png", path]
        do { try cap.run(); cap.waitUntilExit() } catch { return nil }
        guard let full = NSImage(contentsOfFile: path)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let bandH = full.height / 3
        guard let band = full.cropping(to: CGRect(x: 0, y: full.height - bandH, width: full.width, height: bandH)) else { return nil }
        var out: [(y: CGFloat, text: String)] = []
        let req = VNRecognizeTextRequest { r, _ in
            for o in (r.results as? [VNRecognizedTextObservation]) ?? [] {
                if let t = o.topCandidates(1).first?.string.trimmingCharacters(in: .whitespaces), !t.isEmpty {
                    out.append((o.boundingBox.midY, t))
                }
            }
        }
        req.recognitionLevel = .fast
        req.usesLanguageCorrection = true
        try? VNImageRequestHandler(cgImage: band, options: [:]).perform([req])
        return out.sorted { $0.y > $1.y }.map(\.text)                 // Vision's y grows upward
    }

    /// Participant tiles repeat in every 20 s screen read of the call, so short name-shaped lines that recur ≥ 3
    /// times in today's journal entries for this meeting are its participants.
    private func learnNames() -> Set<String> {
        let day = String(ISO8601DateFormatter().string(from: Date()).prefix(10))
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/journal/\(day).jsonl")
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
        let stem = (meetingKey.split(separator: ":").last.map(String.init) ?? "").lowercased()
        var counts: [String: Int] = [:]
        for row in text.split(separator: "\n") {
            guard let j = try? JSONSerialization.jsonObject(with: Data(row.utf8)) as? [String: Any],
                  (j["window"] as? String)?.lowercased().contains(stem) == true, (j["via"] as? String) != "captions",
                  (j["source"] as? String) != "audio", let lines = j["lines"] as? [String] else { continue }
            for l in Set(lines) where Self.nameShaped(l) { counts[l.lowercased(), default: 0] += 1 }
        }
        return Set(counts.filter { $0.value >= 3 }.keys)
    }

    static func nameShaped(_ l: String) -> Bool {
        let words = l.split(separator: " ")
        return (1...4).contains(words.count) && l.count <= 32 && words.allSatisfy { $0.allSatisfy { $0.isLetter } }
    }

    // MARK: parsing (pure, testable)

    struct Block { var speaker: String; var text: String }

    /// A short line that looks like a name, followed by caption text, starts a speaker block. Call-control labels
    /// ("Turn off captions", "Present now", clock times) are dropped.
    static func parse(_ lines: [String], known: Set<String> = []) -> [Block] {
        let chrome = ["captions", "present", "raise hand", "leave call", "more options", "turn on", "turn off", "meeting details",
                      "chat", "activities", "host controls", "mic", "camera", "|"]
        var blocks: [Block] = []
        for raw in lines {
            let l = raw.trimmingCharacters(in: .whitespaces)
            let low = l.lowercased()
            if l.count < 2 || chrome.contains(where: { low.contains($0) }) || l.range(of: #"^\d{1,2}:\d{2}"#, options: .regularExpression) != nil { continue }
            if looksLikeName(l, known: known) {
                blocks.append(Block(speaker: l == "You" ? "Me" : l, text: ""))
            } else if !blocks.isEmpty {
                blocks[blocks.count - 1].text += (blocks[blocks.count - 1].text.isEmpty ? "" : " ") + l
            }
        }
        return blocks.filter { !$0.text.isEmpty }
    }

    /// "You", a known participant, or, before any are known, 2–4 words that all start with a capital.
    static func looksLikeName(_ l: String, known: Set<String> = []) -> Bool {
        if l == "You" { return true }
        guard nameShaped(l) else { return false }
        if !known.isEmpty { return known.contains(l.lowercased()) }
        let words = l.split(separator: " ")
        return (2...4).contains(words.count) && words.allSatisfy { $0.first?.isUppercase ?? false }
    }

    static func sentences(_ text: String) -> [(text: String, complete: Bool)] {
        var out: [(String, Bool)] = []
        var cur = ""
        for ch in text {
            cur.append(ch)
            if ".?!".contains(ch) {
                let s = cur.trimmingCharacters(in: .whitespaces)
                if s.count > 3 { out.append((s, true)) }
                cur = ""
            }
        }
        let rest = cur.trimmingCharacters(in: .whitespaces)
        if !rest.isEmpty { out.append((rest, false)) }
        return out
    }
}
