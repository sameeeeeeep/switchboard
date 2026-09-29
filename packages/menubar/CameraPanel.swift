// CameraPanel — see what the camera sees and tag people. A small window with the live camera image, a box on every
// face, a coral name tag on enrolled people and a "Tag" button on everyone else. Tagging asks for the person's name
// and their consent, then captures six samples of THAT face (CameraPresence.enrol(face:)). Opening the panel keeps
// the camera on while it's open, even if camera presence is off; closing it hands the camera back.
import AppKit
import AVFoundation
import SwiftUI

final class CameraPanelController: NSObject, NSWindowDelegate {
    static let shared = CameraPanelController()
    private var window: NSWindow?

    func show() {
        if let w = window { w.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 520),
                         styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.title = "Camera · people"
        w.titlebarAppearsTransparent = true
        w.backgroundColor = .black
        w.isReleasedWhenClosed = false
        w.minSize = NSSize(width: 480, height: 420)
        w.contentView = NSHostingView(rootView: CameraPanelView())
        w.center()
        w.delegate = self
        window = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func windowWillClose(_ notification: Notification) {
        CameraPresence.shared.viewerClosed()
        CameraPresence.shared.onFaces = nil
        window = nil
    }
}

/// Hosts the live preview. The camera session arrives AFTER the window opens (it starts on the camera queue), so the
/// preview layer is attached whenever a session shows up, and resized with the view on every layout.
private final class PreviewNSView: NSView {
    private var preview: AVCaptureVideoPreviewLayer?
    override init(frame: NSRect) { super.init(frame: frame); wantsLayer = true; layer?.backgroundColor = NSColor.black.cgColor }
    required init?(coder: NSCoder) { fatalError() }
    func attach(_ session: AVCaptureSession?) {
        guard let session, preview?.session !== session else { return }
        preview?.removeFromSuperlayer()
        let l = AVCaptureVideoPreviewLayer(session: session)
        l.videoGravity = .resizeAspect
        l.frame = bounds
        layer?.addSublayer(l)
        preview = l
    }
    override func layout() { super.layout(); preview?.frame = bounds }
}

private struct PreviewView: NSViewRepresentable {
    let session: AVCaptureSession?
    func makeNSView(context: Context) -> PreviewNSView { let v = PreviewNSView(); v.attach(session); return v }
    func updateNSView(_ v: PreviewNSView, context: Context) { v.attach(session) }
}

struct CameraPanelView: View {
    @State private var session: AVCaptureSession? = nil
    @State private var faces: [(box: CGRect, name: String?)] = []
    @State private var tagging: CGRect? = nil
    @State private var name = ""
    @State private var consent = false
    @State private var progress: Int? = nil
    @State private var message: String? = nil
    @State private var aspect: CGFloat = 4.0 / 3.0
    @State private var fixing: (box: CGRect, wrong: String)? = nil      // "Not Arsheen? This is…"
    @State private var people: [(id: String, name: String, consentedAt: String)] = []
    @State private var fixTo: String = ""
    @State private var prompt: String? = nil          // the current enrolment step, shown over the camera

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("CAMERA").font(.splMono(10.5)).tracking(1.8).foregroundColor(.inkFaint)
                    Text("Who's in view").font(.hanken(20, .semibold)).foregroundColor(.ink)
                }
                Spacer()
                SensesPill(compact: false)
            }
            GeometryReader { geo in
                // the preview is aspect-fit inside the box; map Vision's normalized, bottom-left boxes into it
                let fit = fitRect(container: geo.size, aspect: aspect)
                ZStack(alignment: .topLeading) {
                    PreviewView(session: session).frame(width: geo.size.width, height: geo.size.height)
                    if let p = prompt, progress != nil {
                        VStack(spacing: 6) {
                            Text(p).font(.hanken(20, .semibold)).foregroundColor(.white)
                            HStack(spacing: 4) {
                                ForEach(0..<CameraPresence.planTotal, id: \.self) { i in
                                    Circle().fill(i < (progress ?? 0) ? Color.senseCamera : Color.white.opacity(0.3)).frame(width: 7, height: 7)
                                }
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.6)))
                        .frame(width: geo.size.width).padding(.top, 14)
                    }
                    ForEach(Array(faces.enumerated()), id: \.offset) { _, f in
                        let r = viewRect(f.box, in: fit)
                        ZStack(alignment: .bottomLeading) {
                            RoundedRectangle(cornerRadius: 6).stroke(f.name != nil ? Color.senseCamera : Color.white.opacity(0.7), lineWidth: 2)
                            if let n = f.name {
                                Button { fixing = (f.box, n); tagging = nil; fixTo = ""; message = nil
                                         CameraPresence.shared.listPeople { people = $0 } } label: {
                                    Text("\(n)  ✎").font(.hanken(12, .semibold)).foregroundColor(.page)
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Capsule().fill(Color.senseCamera))
                                }
                                .buttonStyle(.plain).help("Wrong person? Click to change the tag.").offset(y: 22)
                            } else if tagging == nil && progress == nil {
                                Button("Tag") { tagging = f.box; message = nil }
                                    .buttonStyle(.plain).font(.hanken(12, .semibold)).foregroundColor(.page)
                                    .padding(.horizontal, 8).padding(.vertical, 2)
                                    .background(Capsule().fill(Color.white)).offset(y: 22)
                            }
                        }
                        .frame(width: r.width, height: r.height)
                        .offset(x: r.minX, y: r.minY)
                    }
                }
            }
            .background(Color.black)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            if let fx = fixing {
                HStack(spacing: 10) {
                    Text("Not \(fx.wrong)? This is").font(.hanken(12.5)).foregroundColor(.inkSec)
                    Picker("", selection: $fixTo) {
                        Text("choose…").tag("")
                        ForEach(people.filter { $0.name != fx.wrong }, id: \.id) { p in Text(p.name).tag(p.id) }
                        Text("someone new…").tag("new")
                    }
                    .frame(width: 170)
                    Button(progress.map { "Following prompts… \($0)/\(CameraPresence.planTotal)" } ?? "Fix") { fix(fx) }
                        .disabled(fixTo.isEmpty || progress != nil)
                    Button("Cancel") { fixing = nil }.disabled(progress != nil)
                }
            }
            if tagging != nil {
                HStack(spacing: 10) {
                    TextField("their name", text: $name)
                        .textFieldStyle(.plain).font(.hanken(13)).foregroundColor(.ink)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color(red: 0.06, green: 0.07, blue: 0.09)))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.edge, lineWidth: 1))
                        .frame(width: 180)
                    Toggle(isOn: $consent) { Text("They're here and agree to be recognised on this Mac").font(.hanken(12)).foregroundColor(.inkSec) }
                        .toggleStyle(.checkbox)
                    Button(progress.map { "Following prompts… \($0)/\(CameraPresence.planTotal)" } ?? "Save") { save() }
                        .disabled(!consent || name.trimmingCharacters(in: .whitespaces).isEmpty || progress != nil)
                    Button("Cancel") { tagging = nil; name = ""; consent = false }.disabled(progress != nil)
                }
            }
            Text(message ?? "Tag someone only with their permission. Face data stays in ~/.relay/faces on this Mac; remove a person from the Journal tab.")
                .font(.hanken(11.5)).foregroundColor(.inkDim)
        }
        .padding(16)
        .background(Color.page)
        .preferredColorScheme(.dark)
        .onAppear {
            CameraPresence.shared.onFaces = { faces = $0 }
            CameraPresence.shared.viewerOpened { s in
                session = s
                if s == nil { message = "The camera isn't available. Allow Switchboard in System Settings → Privacy & Security → Camera." }
                if let dev = (s?.inputs.first as? AVCaptureDeviceInput)?.device {
                    let d = CMVideoFormatDescriptionGetDimensions(dev.activeFormat.formatDescription)
                    if d.height > 0 { aspect = CGFloat(d.width) / CGFloat(d.height) }
                }
            }
        }
    }

    private func fix(_ fx: (box: CGRect, wrong: String)) {
        if fixTo == "new" { tagging = fx.box; fixing = nil; return }          // becomes a normal tag with consent
        guard let p = people.first(where: { $0.id == fixTo }) else { return }
        progress = 0
        CameraPresence.shared.correct(face: fx.box, personId: p.id, name: p.name, progress: { progress = $0 }, prompt: { prompt = $0 }) { r in
            progress = nil; prompt = nil
            switch r {
            case .success(let who): message = "Fixed: that's \(who). Their profile learned from this face."; fixing = nil
            case .failure(let e): message = e.localizedDescription
            }
        }
    }

    private func save() {
        guard let box = tagging else { return }
        let n = name.trimmingCharacters(in: .whitespaces)
        progress = 0
        CameraPresence.shared.enrol(name: n, face: box, progress: { progress = $0 }, prompt: { prompt = $0 }) { r in
            progress = nil; prompt = nil
            switch r {
            case .success(let who): message = "Tagged \(who). They'll be recognised from now on."; tagging = nil; name = ""; consent = false
            case .failure(let e): message = e.localizedDescription
            }
        }
    }

    private func fitRect(container: CGSize, aspect: CGFloat) -> CGRect {
        let w = min(container.width, container.height * aspect), h = w / aspect
        return CGRect(x: (container.width - w) / 2, y: (container.height - h) / 2, width: w, height: h)
    }
    /// Vision boxes are normalized with a bottom-left origin (the preview layer shows the frame unmirrored).
    private func viewRect(_ b: CGRect, in fit: CGRect) -> CGRect {
        let x = b.minX, y = 1 - b.maxY
        return CGRect(x: fit.minX + x * fit.width, y: fit.minY + y * fit.height, width: b.width * fit.width, height: b.height * fit.height)
    }
}
