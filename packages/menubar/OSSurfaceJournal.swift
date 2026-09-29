// OSSurfaceJournal.swift — the JOURNAL surface of Switchboard OS (Knowledge group, next to History).
//
// Reads the local screen journal (~/.relay/journal/YYYY-MM-DD.jsonl, written by ScreenJournal.swift and
// CallAudio.swift) and shows one day as:
//   • a DAY STRIP: the hours of the day with a coloured segment per app session (calls outlined amber); click jumps
//   • a SESSION TIMELINE: consecutive snapshots of the same window merged into sessions; each opens to its text,
//     and a call opens as a conversation (Me / Them bubbles)
//   • SEARCH across the day (local, instant; nothing leaves the Mac), app filter chips
//   • CONTROLS: recording on/off, forget a session, forget the last hour
// Same design law as the other surfaces: graphite chrome, lime = actionable, colour only in the app marks.

import SwiftUI

struct JEntry {
    let t: Date
    let app: String
    let bundle: String
    let window: String
    let via: String
    let call: Bool
    let audio: Bool
    let lines: [String]
}

struct JSession: Identifiable {
    let id: String
    let app: String
    let bundle: String
    let window: String
    let start: Date
    var end: Date
    var call: Bool
    var audio: Bool
    var lines: [String]
    var talk: [(who: String, text: String, t: Date)]
}

private let journalDir = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/journal")
private let journalFlag = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/journal-on")
private let dayFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC"); return f }()
private let clockFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f }()
private let iso = ISO8601DateFormatter()

/// Window titles drift within one meeting ("Meet – abc-defg-hij – Microphone…" vs "Meet – abc-defg-hij 🔊"):
/// group by the Meet code when there is one.
private func sessionKey(_ e: JEntry) -> String {
    let w = e.window.lowercased()
    if let r = w.range(of: #"[a-z]{3}-[a-z]{4}-[a-z]{3}"#, options: .regularExpression) { return e.bundle + "|meet:" + w[r] }
    return e.bundle + "|" + e.window
}

func journalDays() -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: journalDir)) ?? [])
        .filter { $0.hasSuffix(".jsonl") }.map { String($0.prefix(10)) }.sorted(by: >)
}

func loadJournal(day: String) -> [JEntry] {
    let path = (journalDir as NSString).appendingPathComponent("\(day).jsonl")
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
    return text.split(separator: "\n").compactMap { row in
        guard let j = try? JSONSerialization.jsonObject(with: Data(row.utf8)) as? [String: Any],
              let ts = j["t"] as? String, let t = iso.date(from: ts) else { return nil }
        return JEntry(t: t, app: j["app"] as? String ?? "", bundle: j["bundle"] as? String ?? "",
                      window: j["window"] as? String ?? "", via: j["via"] as? String ?? "",
                      call: j["call"] as? Bool ?? false, audio: (j["source"] as? String) == "audio",
                      lines: j["lines"] as? [String] ?? [])
    }.sorted { $0.t < $1.t }
}

private func isCallKey(_ key: String) -> Bool { key.contains("|meet:") }
private func isCallEntry(_ e: JEntry) -> Bool { e.call || e.audio || isCallKey(sessionKey(e)) }

/// Sessions for one day. A CALL is one session per meeting (grouped by its Meet code / meeting window across the
/// whole day, split only by a gap over 30 min), however often you switched away during it. Everything else merges
/// consecutive snapshots of the same window (≤ 10 min apart).
func journalSessions(_ entries: [JEntry]) -> [JSession] {
    var out: [JSession] = []
    func add(_ e: JEntry, into s: inout JSession) {
        s.end = max(s.end, e.t); s.call = s.call || isCallEntry(e); s.audio = s.audio || e.audio
        if e.audio { s.talk += e.lines.map { talkLine($0, e.t) } } else { s.lines += e.lines }
    }
    func new(_ e: JEntry, _ key: String) -> JSession {
        var s = JSession(id: "\(key)@\(iso.string(from: e.t))", app: e.app, bundle: e.bundle, window: e.window,
                         start: e.t, end: e.t, call: isCallEntry(e), audio: false, lines: [], talk: [])
        add(e, into: &s); return s
    }
    // calls: by meeting, across the day
    var openCall: [String: Int] = [:]
    for e in entries where isCallEntry(e) {
        let key = sessionKey(e)
        if let i = openCall[key], e.t.timeIntervalSince(out[i].end) < 1800 { add(e, into: &out[i]) }
        else { out.append(new(e, key)); openCall[key] = out.count - 1 }
    }
    // everything else: consecutive snapshots of the same window
    var lastKey = "", lastIdx = -1
    for e in entries where !isCallEntry(e) {
        let key = sessionKey(e)
        if key == lastKey, lastIdx >= 0, e.t.timeIntervalSince(out[lastIdx].end) < 600 { add(e, into: &out[lastIdx]) }
        else { out.append(new(e, key)); lastIdx = out.count - 1 }
        lastKey = key
    }
    return out.sorted { $0.start < $1.start }
}

/// "Me: …", "Them: …", or a caption speaker "Bhoomi Jain: …".
private func talkLine(_ l: String, _ t: Date) -> (who: String, text: String, t: Date) {
    if let r = l.range(of: ": "), l.distance(from: l.startIndex, to: r.lowerBound) <= 32 {
        let who = String(l[l.startIndex..<r.lowerBound])
        if who.split(separator: " ").count <= 4 { return (who, String(l[r.upperBound...]), t) }
    }
    return ("", l, t)
}

/// Rewrite a day's file without the entries `drop` selects (forget a session / the last hour).
func forgetJournal(day: String, where drop: (JEntry, [String: Any]) -> Bool) {
    let path = (journalDir as NSString).appendingPathComponent("\(day).jsonl")
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return }
    let keep = text.split(separator: "\n").filter { row in
        guard let j = try? JSONSerialization.jsonObject(with: Data(row.utf8)) as? [String: Any],
              let ts = j["t"] as? String, let t = iso.date(from: ts) else { return true }
        let e = JEntry(t: t, app: j["app"] as? String ?? "", bundle: j["bundle"] as? String ?? "",
                       window: j["window"] as? String ?? "", via: "", call: false, audio: false, lines: [])
        return !drop(e, j)
    }
    let body = keep.isEmpty ? "" : keep.joined(separator: "\n") + "\n"
    FileManager.default.createFile(atPath: path, contents: Data(body.utf8), attributes: [.posixPermissions: 0o600])
}

// =====================================================================================================

struct JournalSurface: View {
    var onNavigate: (Surface) -> Void = { _ in }

    @State private var days: [String] = []
    @State private var day = dayFmt.string(from: Date())
    @State private var sessions: [JSession] = []
    @State private var open: Set<String> = []
    @State private var q = ""
    @State private var appFilter: String? = nil
    @State private var recording = FileManager.default.fileExists(atPath: journalFlag)
    @State private var confirmForget: String? = nil       // session id, or "hour"
    @State private var loadedStamp: Date = .distantPast
    @State private var lastLoad: Date = .distantPast

    private var apps: [String] {
        var seen: [String] = []; for s in sessions where !seen.contains(s.app) { seen.append(s.app) }; return seen
    }
    private var visible: [JSession] {
        let ql = q.trimmingCharacters(in: .whitespaces).lowercased()
        return sessions.filter { s in
            (appFilter == nil || s.app == appFilter) &&
            (ql.isEmpty || (s.app + " " + s.window + " " + s.lines.joined(separator: " ") + " " + s.talk.map(\.text).joined(separator: " ")).lowercased().contains(ql))
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    if Senses.cameraLab { PeoplePanel().padding(.top, 14) }
                    if sessions.isEmpty {
                        emptyState
                    } else {
                        DayStrip(sessions: sessions, highlight: Set(visible.map(\.id))) { id in
                            open.insert(id)
                            withAnimation { proxy.scrollTo(id, anchor: .top) }
                        }
                        .padding(.top, 18)
                        chips.padding(.top, 14)
                        if visible.isEmpty {
                            Text("Nothing on \(dayLabel) matches \"\(q)\".")
                                .font(.hanken(12.5)).foregroundColor(.inkDim)
                                .frame(maxWidth: .infinity).padding(24)
                                .background(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
                                .padding(.top, 18)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(visible) { s in
                                JournalSessionRow(session: s, open: open.contains(s.id), query: q,
                                                  confirming: confirmForget == s.id,
                                                  onToggle: { if open.contains(s.id) { open.remove(s.id) } else { open.insert(s.id) } },
                                                  onForget: { forgetSession(s) })
                                    .id(s.id)
                            }
                        }
                        .padding(.top, 16)
                        Text("kept on this Mac in ~/.relay/journal · days older than 30 are deleted · search here never leaves the Mac")
                            .font(.splMono(10.5)).foregroundColor(.inkFaint).padding(.top, 28)
                    }
                }
                .padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { reload(force: true) }
        .onReceive(OSPulse.shared.$tick) { _ in reload(force: false) }
    }

    private var dayLabel: String {
        day == dayFmt.string(from: Date()) ? "today" : day
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("JOURNAL").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                    Text(day == dayFmt.string(from: Date()) ? "What you saw today" : "What you saw on \(day)")
                        .font(.hanken(24, .semibold)).foregroundColor(.ink)
                }
                Spacer(minLength: 0)
                SensesPill(compact: false)
                JChip(text: confirmForget == "hour" ? "Confirm: forget last hour" : "Forget last hour",
                      active: confirmForget == "hour", tint: confirmForget == "hour" ? .danger : .inkSec) { forgetHour() }
            }
            HStack(spacing: 8) {
                TextField("search \(dayLabel)… (names, topics, what someone said)", text: $q)
                    .textFieldStyle(.plain)
                    .font(.splMono(12)).foregroundColor(.ink)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color(red: 0.06, green: 0.07, blue: 0.09)))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                    .frame(maxWidth: 380, alignment: .leading)
                Spacer(minLength: 0)
                ForEach(days.prefix(7), id: \.self) { d in
                    JChip(text: d == dayFmt.string(from: Date()) ? "Today" : String(d.dropFirst(5)), active: d == day) {
                        day = d; open = []; reload(force: true)
                    }
                }
            }
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                JChip(text: "All apps", active: appFilter == nil) { appFilter = nil }
                ForEach(apps, id: \.self) { a in
                    JChip(text: a, active: appFilter == a, tint: colorForId(a)) { appFilter = appFilter == a ? nil : a }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(recording ? "Nothing journaled on \(dayLabel) yet." : "The journal is paused.")
                .font(.brico(20, .bold)).foregroundColor(.ink)
            Text("While it records, Switchboard keeps a private text journal of what's on your screen (and, if you allow it, what's said in meetings). It stays on this Mac. Password managers, private messages, banking and key pages are never read.")
                .font(.hanken(13)).foregroundColor(.inkSec).fixedSize(horizontal: false, vertical: true)
            if !recording {
                LimeButton(label: "Start recording") { FileManager.default.createFile(atPath: journalFlag, contents: nil); recording = true }
            }
        }
        .padding(22).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.panel))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.edge, lineWidth: 1))
        .padding(.top, 20)
    }

    // The OS pulse fires on any ~/.relay change and the journal writes every few seconds: reload only when the
    // day's file changed, and at most every 5 s.
    private func reload(force: Bool) {
        recording = FileManager.default.fileExists(atPath: journalFlag)
        let path = (journalDir as NSString).appendingPathComponent("\(day).jsonl")
        let stamp = (try? FileManager.default.attributesOfItem(atPath: path)[.modificationDate] as? Date) ?? .distantPast
        guard force || (stamp != loadedStamp && Date().timeIntervalSince(lastLoad) > 5) else { return }
        loadedStamp = stamp; lastLoad = Date()
        days = journalDays()
        let d = day
        DispatchQueue.global(qos: .userInitiated).async {
            let s = journalSessions(loadJournal(day: d)).reversed()   // newest first
            DispatchQueue.main.async { if d == day { sessions = Array(s) } }
        }
    }

    private func forgetSession(_ s: JSession) {
        guard confirmForget == s.id else { confirmForget = s.id; return }
        confirmForget = nil
        let key = sessionKey(JEntry(t: s.start, app: s.app, bundle: s.bundle, window: s.window, via: "", call: false, audio: false, lines: []))
        forgetJournal(day: day) { e, _ in
            e.t >= s.start && e.t <= s.end && (sessionKey(e) == key || e.bundle == s.bundle)
        }
        reload(force: true)
    }

    private func forgetHour() {
        guard confirmForget == "hour" else { confirmForget = "hour"; return }
        confirmForget = nil
        let cutoff = Date().addingTimeInterval(-3600)
        forgetJournal(day: dayFmt.string(from: Date())) { e, _ in e.t >= cutoff }
        forgetJournal(day: dayFmt.string(from: cutoff)) { e, _ in e.t >= cutoff }
        reload(force: true)
    }
}

// ---- the day strip: hours across, one lane, a segment per session ----
private struct DayStrip: View {
    let sessions: [JSession]
    let highlight: Set<String>
    let onPick: (String) -> Void
    @State private var hover: String? = nil

    var body: some View {
        let start = Calendar.current.dateInterval(of: .hour, for: sessions.map(\.start).min() ?? Date())?.start ?? Date()
        let endRaw = sessions.map(\.end).max() ?? Date()
        let end = Calendar.current.dateInterval(of: .hour, for: endRaw)?.end ?? endRaw
        let span = max(end.timeIntervalSince(start), 3600)
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 6).fill(Color.panel)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.edge, lineWidth: 1))
                    ForEach(sessions) { s in
                        let x = CGFloat(s.start.timeIntervalSince(start) / span) * w
                        let sw = max(3, CGFloat(max(s.end.timeIntervalSince(s.start), 30) / span) * w)
                        // top lane = apps, bottom lane = calls (a call spans its whole meeting)
                        RoundedRectangle(cornerRadius: 2)
                            .fill((s.call ? Color.senseAudio : colorForId(s.app)).opacity(highlight.contains(s.id) ? 0.9 : 0.25))
                            .frame(width: sw, height: hover == s.id ? 20 : 16)
                            .offset(x: x, y: s.call ? 30 : (hover == s.id ? 4 : 6))
                            .onHover { hover = $0 ? s.id : (hover == s.id ? nil : hover) }
                            .onTapGesture { onPick(s.id) }
                            .help("\(clockFmt.string(from: s.start))–\(clockFmt.string(from: s.end)) · \(s.app) · \(s.window)")
                    }
                }
            }
            .frame(height: 52)
            HStack {
                Text(clockFmt.string(from: start)).font(.splMono(10)).foregroundColor(.inkFaint)
                Spacer()
                if let h = hover, let s = sessions.first(where: { $0.id == h }) {
                    Text("\(clockFmt.string(from: s.start))–\(clockFmt.string(from: s.end)) · \(s.app) · \(String(s.window.prefix(50)))")
                        .font(.splMono(10)).foregroundColor(.inkSec)
                    Spacer()
                }
                Text(clockFmt.string(from: end)).font(.splMono(10)).foregroundColor(.inkFaint)
            }
        }
    }
}

// ---- one session: header row, opens to its text or its conversation ----
private struct JournalSessionRow: View {
    let session: JSession
    let open: Bool
    let query: String
    let confirming: Bool
    let onToggle: () -> Void
    let onForget: () -> Void
    @State private var hover = false
    @State private var showAll = false

    var body: some View {
        let s = session
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onToggle) {
                HStack(alignment: .center, spacing: 12) {
                    RoundedRectangle(cornerRadius: 3).fill(colorForId(s.app)).frame(width: 4, height: 30)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            Text(s.app).font(.hanken(13.5, .semibold)).foregroundColor(.ink)
                            if s.call { Tag(text: s.audio ? "call · transcript" : "call", color: .senseAudio) }
                        }
                        Text(s.window.isEmpty ? "—" : s.window).font(.hanken(12)).foregroundColor(.inkSec).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Text("\(s.lines.count + s.talk.count) lines").font(.splMono(10.5)).foregroundColor(.inkFaint)
                    Text(s.start == s.end ? clockFmt.string(from: s.start) : "\(clockFmt.string(from: s.start))–\(clockFmt.string(from: s.end))")
                        .font(.splMono(11)).foregroundColor(.inkSec).frame(width: 92, alignment: .trailing)
                    Text("▾").font(.splMono(9)).foregroundColor(.inkFaint).rotationEffect(.degrees(open ? 0 : -90))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if open {
                if !s.talk.isEmpty { conversation(s) }
                if !s.lines.isEmpty { screenText(s) }
                HStack {
                    Spacer()
                    JChip(text: confirming ? "Confirm: forget this session" : "Forget this session",
                          active: confirming, tint: confirming ? .danger : .inkDim, action: onForget)
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(RoundedRectangle(cornerRadius: 12).fill(hover || open ? Color.panel : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(open ? Color.edge : Color.edgeSoft, lineWidth: 1))
        .onHover { hover = $0 }
    }

    private func conversation(_ s: JSession) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("WHAT WAS SAID").font(.splMono(9.5)).tracking(1.4).foregroundColor(.inkFaint)
            ForEach(Array(s.talk.enumerated()), id: \.offset) { _, t in
                HStack(alignment: .top) {
                    if t.who == "Me" { Spacer(minLength: 60) }
                    VStack(alignment: t.who == "Me" ? .trailing : .leading, spacing: 3) {
                        Text("\(t.who.isEmpty ? "?" : t.who) · \(clockFmt.string(from: t.t))").font(.splMono(9.5)).foregroundColor(.inkFaint)
                        Text(t.text).font(.hanken(12.5)).foregroundColor(.ink)
                            .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 10).fill(t.who == "Me" ? Color.lime.opacity(0.10) : Color(red: 0.08, green: 0.09, blue: 0.11)))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(t.who == "Me" ? Color.lime.opacity(0.35) : Color.edge, lineWidth: 1))
                    if t.who != "Me" { Spacer(minLength: 60) }
                }
            }
        }
    }

    private func screenText(_ s: JSession) -> some View {
        let ql = query.trimmingCharacters(in: .whitespaces).lowercased()
        let lines = ql.isEmpty ? s.lines : s.lines.filter { $0.lowercased().contains(ql) }
        let shown = showAll ? lines : Array(lines.prefix(40))
        return VStack(alignment: .leading, spacing: 4) {
            Text(ql.isEmpty ? "ON SCREEN" : "ON SCREEN · MATCHES").font(.splMono(9.5)).tracking(1.4).foregroundColor(.inkFaint)
            ForEach(Array(shown.enumerated()), id: \.offset) { _, l in
                Text(l).font(.splMono(11.5)).foregroundColor(.inkSec).lineLimit(3).textSelection(.enabled)
            }
            if lines.count > shown.count {
                Button("Show all \(lines.count) lines") { showAll = true }
                    .buttonStyle(.plain).font(.hanken(12, .semibold)).foregroundColor(.lime)
            }
        }
    }
}

private struct Tag: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.splMono(9.5)).foregroundColor(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .overlay(Capsule().stroke(color.opacity(0.6), lineWidth: 1))
    }
}

/// Filter / action chip (same look as the Knowledge surfaces' chips).
private struct JChip: View {
    let text: String
    var active: Bool = false
    var tint: Color = .inkSec
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(text).font(.hanken(12, active ? .semibold : .regular))
                .foregroundColor(active ? (tint == .inkSec ? .ink : tint) : tint)
                .padding(.horizontal, 11).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.panel))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke((hover || active) ? tint.opacity(0.6) : Color.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}


// ---- People the camera may recognise: enrolled only with the person present and agreeing (CameraPresence) ----
private struct PeoplePanel: View {
    @State private var people: [(id: String, name: String, consentedAt: String)] = []
    @State private var adding = false
    @State private var name = ""
    @State private var consent = false
    @State private var progress: Int? = nil
    @State private var message: String? = nil
    @State private var confirmRemove: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("PEOPLE THE CAMERA KNOWS").font(.splMono(9.5)).tracking(1.4).foregroundColor(.inkFaint)
                if people.isEmpty { Text("· nobody yet; everyone else is only counted").font(.splMono(9.5)).foregroundColor(.inkFaint) }
                Spacer(minLength: 0)
            }
            HStack(spacing: 6) {
                ForEach(people, id: \.id) { p in
                    JChip(text: confirmRemove == p.id ? "Remove \(p.name)?" : p.name, active: confirmRemove == p.id,
                          tint: confirmRemove == p.id ? .danger : .senseCamera) {
                        if confirmRemove == p.id { CameraPresence.shared.forget(personId: p.id) { confirmRemove = nil; reload() } }
                        else { confirmRemove = p.id }
                    }
                    .help("Enrolled \(String(p.consentedAt.prefix(10))) with their consent. Click twice to remove their face data.")
                }
                if !adding { JChip(text: "+ Add a person", tint: .inkSec) { adding = true; message = nil } }
                JChip(text: "Open camera", tint: .senseCamera) { CameraPanelController.shared.show() }
            }
            if adding {
                HStack(spacing: 10) {
                    TextField("their name", text: $name)
                        .textFieldStyle(.plain).font(.hanken(12.5)).foregroundColor(.ink)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color(red: 0.06, green: 0.07, blue: 0.09)))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                        .frame(width: 170)
                    Toggle(isOn: $consent) {
                        Text("They're here and agree to be recognised on this Mac").font(.hanken(12)).foregroundColor(.inkSec)
                    }
                    .toggleStyle(.checkbox)
                    JChip(text: progress.map { "Follow the prompts… \($0)/\(CameraPresence.planTotal)" } ?? "Capture",
                          active: consent && !name.trimmingCharacters(in: .whitespaces).isEmpty,
                          tint: .senseCamera) { capture() }
                        .disabled(!consent || name.trimmingCharacters(in: .whitespaces).isEmpty || progress != nil)
                    JChip(text: "Cancel", tint: .inkDim) { adding = false; name = ""; consent = false }
                }
            }
            if let m = message { Text(m).font(.hanken(12)).foregroundColor(.inkSec) }
        }
        .onAppear(perform: reload)
    }

    private func reload() { CameraPresence.shared.listPeople { people = $0 } }

    private func capture() {
        let n = name.trimmingCharacters(in: .whitespaces)
        progress = 0
        CameraPresence.shared.enrol(name: n, progress: { progress = $0 }) { r in
            progress = nil
            switch r {
            case .success(let who): message = "Enrolled \(who). The camera will recognise them from now on."; adding = false; name = ""; consent = false
            case .failure(let e): message = e.localizedDescription
            }
            reload()
        }
    }
}
