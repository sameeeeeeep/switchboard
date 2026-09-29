// CameraPresence — camera step 1: presence only, no identities.
//
// Opt-in: runs only with "camera": true in ~/.relay/journal.json AND the journal recording. Takes low-resolution
// frames, analyses about one per second with Apple's on-device face detection, and derives three facts:
// at desk / away, how many people are in view, and whether the nearest face is turned toward the screen. Only
// CHANGES are journaled ("Away", "At desk", "2 people in view"), so the day strip shows when you stepped away.
// While the camera is on, the notch eyes turn coral (and the Mac's own green camera light is on).
//
// STEP 2, ENROLMENT (opt-in per person): the user adds a person who is present and agrees to be recognised. Six face
// samples become Apple Vision feature prints (on-device, no model download, no licensing strings attached), saved
// with the consent time in ~/.relay/faces/<id>.json (0600). While presence runs, each face in view is compared ONLY
// against enrolled people; a match adds their name to the journal line. Faces of people not enrolled are counted,
// never stored. No images are ever saved.
import AVFoundation
import Vision

final class CameraPresence: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let shared = CameraPresence()

    var onCamera: ((Bool) -> Void)?                // main thread: coral eyes
    var record: (([String: Any]) -> Void)?

    private let q = DispatchQueue(label: "switchboard.camera-presence", qos: .utility)
    private var session: AVCaptureSession?
    private var watch: DispatchSourceTimer?
    private var lastFrame = Date.distantPast
    private var faces = 0, facing = false, lastFaceSeen = Date.distantPast
    private var reported: (present: Bool, people: Int, names: [String])? = nil
    private var pending: (present: Bool, people: Int, names: [String], since: Date)? = nil
    private var names: [String] = []

    struct Person { let id: String; let name: String; let consentedAt: String; let prints: [VNFeaturePrintObservation]; let threshold: Float }
    private var people: [Person] = []
    private var peopleLoaded = false
    /// Guided multi-angle enrolment (Face ID style): each step only accepts frames where the head is really in that pose.
    private struct Enrol {
        var name: String
        var samples: [VNFeaturePrintObservation] = []
        var poses: [String] = []
        var sideSign: Double = 0
        let temporary: Bool
        let done: (Result<String, Error>) -> Void
        let progress: (Int) -> Void
        let prompt: (String) -> Void
    }
    static let plan: [(pose: String, count: Int, say: String)] = [
        ("straight", 3, "Look straight at the camera"),
        ("side", 2, "Now turn your head slowly to one side"),
        ("other", 2, "Now the other side"),
        ("tilt", 1, "Tilt your chin up or down a little"),
    ]
    static var planTotal: Int { plan.reduce(0) { $0 + $1.count } }
    private var enrolling: Enrol?
    // The Camera panel (CameraPanel.swift): live boxes while it's open; it keeps the camera on even if presence is off.
    var onFaces: (([(box: CGRect, name: String?)]) -> Void)?       // main thread, normalized Vision boxes
    private var viewers = 0
    private var enrolTarget: CGRect? = nil
    private var enrolInto: String? = nil               // correcting a tag: add samples to this existing person
    private(set) var captureSession: AVCaptureSession? { get { session } set { session = newValue } }
    /// No profile may be looser than this (a shaky enrolment once produced 1.23 and matched everyone).
    static let maxThreshold: Float = 0.45
    private static let facesDir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/faces")

    /// Arm once at launch: a cheap 5 s check of the setting starts or stops the camera.
    func arm() {
        q.async {
            guard self.watch == nil else { return }
            let t = DispatchSource.makeTimerSource(queue: self.q)
            t.schedule(deadline: .now() + 3, repeating: 5)
            t.setEventHandler { [weak self] in self?.check() }
            t.resume()
            self.watch = t
        }
    }

    private func enabled() -> Bool {
        let relay = (NSHomeDirectory() as NSString).appendingPathComponent(".relay")
        // Independent of the screen journal (Senses.swift): the camera has its own switch.
        guard let d = FileManager.default.contents(atPath: (relay as NSString).appendingPathComponent("journal.json")),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return false }
        return j["camera"] as? Bool ?? false
    }

    private func check() {
        if !peopleLoaded { loadPeople() }
        if enrolling != nil { return }                                   // an enrolment owns the camera for a few seconds
        let want = enabled() || viewers > 0
        if want && session == nil { start() } else if !want && session != nil { stop() }
        if session != nil { settle() }
    }

    private func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { _ in }       // macOS shows its own prompt; retried next check
            return
        case .authorized: break
        default: godLog("camera presence: camera access denied in System Settings"); return
        }
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device) else { godLog("camera presence: no camera"); return }
        let s = AVCaptureSession()
        s.sessionPreset = .low
        guard s.canAddInput(input) else { return }
        s.addInput(input)
        let out = AVCaptureVideoDataOutput()
        out.alwaysDiscardsLateVideoFrames = true
        out.setSampleBufferDelegate(self, queue: q)
        guard s.canAddOutput(out) else { return }
        s.addOutput(out)
        // Ask the camera for as few frames as it supports; we only look at ~1 per second anyway.
        if (try? device.lockForConfiguration()) != nil {
            if let r = device.activeFormat.videoSupportedFrameRateRanges.min(by: { $0.minFrameRate < $1.minFrameRate }) {
                device.activeVideoMinFrameDuration = r.maxFrameDuration
                device.activeVideoMaxFrameDuration = r.maxFrameDuration
            }
            device.unlockForConfiguration()
        }
        s.startRunning()
        session = s
        DispatchQueue.main.async { self.onCamera?(true) }
        godLog("camera presence ON")
    }

    private func stop() {
        session?.stopRunning(); session = nil
        reported = nil; pending = nil
        DispatchQueue.main.async { self.onCamera?(false) }
        godLog("camera presence OFF")
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
        let every: TimeInterval = enrolling != nil ? 0.5 : (viewers > 0 ? 0.33 : 1)
        guard Date().timeIntervalSince(lastFrame) >= every, let px = CMSampleBufferGetImageBuffer(sb) else { return }
        lastFrame = Date()
        let handler = VNImageRequestHandler(cvPixelBuffer: px, options: [:])
        let req = VNDetectFaceRectanglesRequest()
        req.revision = VNDetectFaceRectanglesRequestRevision3          // continuous yaw / pitch / roll
        try? handler.perform([req])
        let obs = (req.results ?? []).filter { $0.confidence > 0.6 }
        faces = obs.count
        if let nearest = obs.max(by: { $0.boundingBox.width < $1.boundingBox.width }) {
            lastFaceSeen = Date()
            facing = abs(nearest.yaw?.doubleValue ?? 0) < 0.4
            if var e = enrolling {                                        // enrolment: the tagged face (else the nearest), one sample per 0.5 s
                let face = enrolTarget.flatMap { t in obs.min { hypot($0.boundingBox.midX - t.midX, $0.boundingBox.midY - t.midY) < hypot($1.boundingBox.midX - t.midX, $1.boundingBox.midY - t.midY) } } ?? nearest
                enrolTarget = enrolTarget == nil ? nil : face.boundingBox          // follow the face as it moves
                publish(obs.map { ($0.boundingBox, $0 === face ? e.name : nil) })
                // which step are we on, and is the head actually in that pose?
                var step = 0, before = 0
                while step < Self.plan.count, e.samples.count >= before + Self.plan[step].count { before += Self.plan[step].count; step += 1 }
                if step >= Self.plan.count { finishEnrolment(); return }
                let yaw = face.yaw?.doubleValue ?? 0, pitch = face.pitch?.doubleValue ?? 0
                let want = Self.plan[step].pose
                let ok: Bool = {
                    switch want {
                    case "straight": return abs(yaw) < 0.2 && abs(pitch) < 0.25
                    case "side": return abs(yaw) > 0.3
                    case "other": return abs(yaw) > 0.3 && (yaw > 0) != (e.sideSign > 0)
                    default: return abs(pitch) > 0.2
                    }
                }()
                if ok, let fp = Self.print(handler, face) {
                    if want == "side" && e.sideSign == 0 { e.sideSign = yaw }
                    e.samples.append(fp); e.poses.append(want)
                    let n = e.samples.count
                    DispatchQueue.main.async { e.progress(n) }
                }
                // tell them the NEXT thing to do (or the current one, if this frame didn't count)
                var s2 = 0, b2 = 0
                while s2 < Self.plan.count, e.samples.count >= b2 + Self.plan[s2].count { b2 += Self.plan[s2].count; s2 += 1 }
                let say = s2 < Self.plan.count ? Self.plan[s2].say : "Done"
                DispatchQueue.main.async { e.prompt(say) }
                enrolling = e
                if e.samples.count >= Self.planTotal { finishEnrolment() }
                return
            }
        }
        // recognition: compare each face only with enrolled people
        guard !people.isEmpty else { names = []; publish(obs.map { ($0.boundingBox, nil) }); return }
        var seenNames: [String] = []
        var labelled: [(CGRect, String?)] = []
        for f in obs {
            // Only faces turned toward the camera are compared: feature prints are unreliable on profiles.
            let frontal = abs(f.yaw?.doubleValue ?? 0) < 0.8 && abs(f.roll?.doubleValue ?? 0) < 0.6   // profiles include side samples
            guard frontal, let fp = Self.print(handler, f) else { labelled.append((f.boundingBox, nil)); continue }
            let scored = people.map { p -> (String, Float, Float) in
                let d = p.prints.compactMap { pp -> Float? in var x: Float = 0; return (try? fp.computeDistance(&x, to: pp)) != nil ? x : nil }.min() ?? .infinity
                return (p.name, d, min(p.threshold, Self.maxThreshold))
            }.sorted { $0.1 < $1.1 }
            var name: String? = nil
            if let b = scored.first, b.1 < b.2 {
                // with several people enrolled, the best match must be clearly closer than the runner-up
                if scored.count < 2 || scored[1].1 > b.1 * 1.2 { name = b.0 }
            }
            if let n = name, !seenNames.contains(n) { seenNames.append(n) }
            labelled.append((f.boundingBox, name))
        }
        names = seenNames
        publish(labelled)
    }

    /// Debounced state: "away" only after 60 s without a face; a people-count change must hold for 10 s.
    private func settle() {
        let present = Date().timeIntervalSince(lastFaceSeen) < 60
        let people = present ? max(faces, 1) : 0
        let known = present ? names.sorted() : []
        let now = Date()
        if let r = reported, r.present == present, r.people == people, r.names == known { pending = nil; return }
        if let p = pending, p.present == present, p.people == people, p.names == known {
            guard now.timeIntervalSince(p.since) >= 10 || reported == nil else { return }
            let others = max(0, people - known.count)
            let who = known.isEmpty ? "" : known.joined(separator: ", ") + (others > 0 ? ", \(others) other\(others == 1 ? "" : "s")" : "")
            let line = !present ? "Away from the desk"
                : (people > 1 ? (who.isEmpty ? "\(people) people in view" : "In view: \(who)")
                              : ((facing ? "At the desk" : "At the desk, turned away") + (known.isEmpty ? "" : " · \(known[0])")))
            record?(["t": ISO8601DateFormatter().string(from: now), "app": "Camera", "bundle": "switchboard.camera",
                     "window": "Presence", "url": NSNull(), "via": "camera", "lines": [line]])
            reported = (present, people, known); pending = nil
        } else {
            pending = (present, people, known, now)
        }
    }

    private func publish(_ faces: [(CGRect, String?)]) {
        guard viewers > 0, let cb = onFaces else { return }
        let f = faces.map { (box: $0.0, name: $0.1) }
        DispatchQueue.main.async { cb(f) }
    }

    /// The Camera panel opened / closed: keep the camera running while anyone is looking.
    func viewerOpened(_ ready: @escaping (AVCaptureSession?) -> Void) {
        q.async {
            self.viewers += 1
            if self.session == nil { self.start() }
            let s = self.session
            DispatchQueue.main.async { ready(s) }
        }
    }
    func viewerClosed() {
        q.async {
            self.viewers = max(0, self.viewers - 1)
            if self.viewers == 0 && !self.enabled() && self.enrolling == nil { self.stop() }
        }
    }

    /// Tag a specific face in the Camera panel (normalized Vision box).
    func enrol(name: String, face: CGRect, progress: @escaping (Int) -> Void, prompt: @escaping (String) -> Void = { _ in }, done: @escaping (Result<String, Error>) -> Void) {
        q.async { self.enrolTarget = face; self.enrolInto = nil }
        enrol(name: name, progress: progress, prompt: prompt, done: done)
    }

    /// Fix a wrong tag: this face is really `personId` (an enrolled person) — add fresh samples of it to their profile.
    func correct(face: CGRect, personId: String, name: String, progress: @escaping (Int) -> Void, prompt: @escaping (String) -> Void = { _ in }, done: @escaping (Result<String, Error>) -> Void) {
        q.async { self.enrolTarget = face; self.enrolInto = personId }
        enrol(name: name, progress: progress, prompt: prompt, done: done)
    }

    // MARK: enrolment

    private static func print(_ handler: VNImageRequestHandler, _ face: VNFaceObservation) -> VNFeaturePrintObservation? {
        let b = face.boundingBox.insetBy(dx: -face.boundingBox.width * 0.15, dy: -face.boundingBox.height * 0.15)
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        let fp = VNGenerateImageFeaturePrintRequest()
        fp.regionOfInterest = b
        try? handler.perform([fp])
        return fp.results?.first as? VNFeaturePrintObservation
    }

    /// Start enrolling someone who is present and has agreed. Uses the camera for a few seconds even if presence is off.
    func enrol(name: String, progress: @escaping (Int) -> Void, prompt: @escaping (String) -> Void = { _ in }, done: @escaping (Result<String, Error>) -> Void) {
        q.async {
            let temporary = self.session == nil
            if temporary { self.start() }
            guard self.session != nil else {
                DispatchQueue.main.async { done(.failure(NSError(domain: "camera", code: 1, userInfo: [NSLocalizedDescriptionKey: "The camera isn't available. Allow Switchboard in System Settings → Privacy → Camera."]))) }
                return
            }
            self.enrolling = Enrol(name: name, temporary: temporary, done: { r in DispatchQueue.main.async { done(r) } },
                                   progress: progress, prompt: prompt)
            DispatchQueue.main.async { prompt(Self.plan[0].say) }
            self.q.asyncAfter(deadline: .now() + 45) {                 // didn't get every angle in time: give up cleanly
                if let e = self.enrolling, e.samples.count < Self.planTotal {
                    self.enrolling = nil; self.enrolTarget = nil
                    if e.temporary && !self.enabled() && self.viewers == 0 { self.stop() }
                    e.done(.failure(NSError(domain: "camera", code: 2, userInfo: [NSLocalizedDescriptionKey: "Didn't get every angle in time (\(e.samples.count)/\(Self.planTotal)). Try again and follow the prompts slowly."])))
                }
            }
        }
    }

    private func finishEnrolment() {
        guard let e = enrolling else { return }
        enrolling = nil; enrolTarget = nil
        let into = enrolInto; enrolInto = nil
        // threshold from how much this person's own samples vary: mean + 3·sd of pairwise distances, bounded
        // consistency + threshold come from the straight-on samples only (different angles are SUPPOSED to differ)
        let straight = zip(e.samples, e.poses).filter { $0.1 == "straight" }.map(\.0)
        let group = straight.count >= 2 ? straight : e.samples
        var ds: [Float] = []
        for i in 0..<group.count { for j in (i + 1)..<group.count { var d: Float = 0; if (try? group[i].computeDistance(&d, to: group[j])) != nil { ds.append(d) } } }
        let mean = ds.isEmpty ? 0.5 : ds.reduce(0, +) / Float(ds.count)
        // samples that differ this much mean the person moved, turned, or it caught someone else: don't save it
        if mean > 0.35 {
            if e.temporary && !enabled() && viewers == 0 { stop() }
            godLog("camera presence: enrolment of \(e.name) rejected (samples too different, mean \(String(format: "%.2f", mean)))")
            e.done(.failure(NSError(domain: "camera", code: 3, userInfo: [NSLocalizedDescriptionKey:
                "\(e.name)'s samples were too different from each other. Ask them to hold still and face the camera, then tag again."])))
            return
        }
        let sd = ds.isEmpty ? 0.1 : sqrt(ds.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Float(ds.count))
        let threshold = min(min(max(mean + 3 * sd, mean * 1.3), mean * 2.2), Self.maxThreshold)
        var id = e.name.lowercased().replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression) + "-" + String(UUID().uuidString.prefix(6)).lowercased()
        var prints = e.samples.compactMap { try? NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true).base64EncodedString() }
        var consentedAt = ISO8601DateFormatter().string(from: Date())
        var finalThreshold = threshold
        // correcting a tag: merge into the existing person (keep their consent time; widen only as far as needed)
        if let into, let d = FileManager.default.contents(atPath: (Self.facesDir as NSString).appendingPathComponent("\(into).json")),
           let old = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            id = into
            prints = ((old["prints"] as? [String]) ?? []) + prints
            consentedAt = old["consentedAt"] as? String ?? consentedAt
            finalThreshold = min(max(Float(old["threshold"] as? Double ?? 0), threshold), Self.maxThreshold)
        }
        let rec: [String: Any] = ["id": id, "name": e.name, "consentedAt": consentedAt,
                                  "prints": prints, "threshold": finalThreshold]
        try? FileManager.default.createDirectory(atPath: Self.facesDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if let d = try? JSONSerialization.data(withJSONObject: rec) {
            FileManager.default.createFile(atPath: (Self.facesDir as NSString).appendingPathComponent("\(id).json"), contents: d, attributes: [.posixPermissions: 0o600])
        }
        loadPeople()
        if e.temporary && !enabled() && viewers == 0 { stop() }
        godLog("camera presence: enrolled \(e.name) (threshold \(String(format: "%.3f", threshold)))")
        e.done(.success(e.name))
    }

    private func loadPeople() {
        peopleLoaded = true
        let files = (try? FileManager.default.contentsOfDirectory(atPath: Self.facesDir)) ?? []
        people = files.filter { $0.hasSuffix(".json") }.compactMap { f in
            guard let d = FileManager.default.contents(atPath: (Self.facesDir as NSString).appendingPathComponent(f)),
                  let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let id = j["id"] as? String, let name = j["name"] as? String, let enc = j["prints"] as? [String] else { return nil }
            let prints = enc.compactMap { Data(base64Encoded: $0) }.compactMap {
                try? NSKeyedUnarchiver.unarchivedObject(ofClass: VNFeaturePrintObservation.self, from: $0) }
            return Person(id: id, name: name, consentedAt: j["consentedAt"] as? String ?? "", prints: prints,
                          threshold: Float(j["threshold"] as? Double ?? 0.6))
        }
    }

    /// For the Journal's People row (main thread).
    func listPeople(_ cb: @escaping ([(id: String, name: String, consentedAt: String)]) -> Void) {
        q.async { self.loadPeople(); let l = self.people.map { ($0.id, $0.name, $0.consentedAt) }; DispatchQueue.main.async { cb(l) } }
    }

    func forget(personId: String, done: @escaping () -> Void) {
        q.async {
            try? FileManager.default.removeItem(atPath: (Self.facesDir as NSString).appendingPathComponent("\(personId).json"))
            self.loadPeople()
            DispatchQueue.main.async(execute: done)
        }
    }
}
