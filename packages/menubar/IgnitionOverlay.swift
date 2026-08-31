// IgnitionOverlay — the onboarding IGNITION (docs/ONBOARDING-SPEC.md §11 Frame 0). The very first thing a
// new user sees: the whole screen fills with a dot-matrix field of blinking lamps that migrate and form the
// SWITCHBOARD lamp-cluster + wordmark, then INHALE straight up into the notch (that's how the operator takes
// its home). A "Skip onboarding" control sits top-right once the dots form. When the inhale finishes it
// chains into the greeting/setup tour (writes ~/.relay/replay-tour).
//
// Self-contained: its own full-screen panel + a ~/.relay/ignite file trigger (touch it to preview). Wired at
// launch by one IgnitionController.shared.install() call. Registered in build.sh + package-dmg.sh swift lists.
import AppKit
import SwiftUI

// ── One target the dots resolve into: where a lamp lands (in the sampled shape's local space). ──
private struct IgniteDot {
    var start: CGPoint      // where it blinks in the chaos phase (random, screen space)
    var target: CGPoint     // where it lands to form the mark (screen space)
    var seed: Double        // per-dot blink phase + jitter
    var big: Bool           // the 2×2 lamp-cluster dots draw larger/brighter than the wordmark dots
}

@MainActor final class IgnitionController {
    static let shared = IgnitionController()
    private var panel: NSPanel?
    private var timer: Timer?
    private let trigger = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/ignite")

    // Arm the file trigger — `touch ~/.relay/ignite` previews the ignition without a fresh first-run.
    func install() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, FileManager.default.fileExists(atPath: self.trigger) else { return }
                try? FileManager.default.removeItem(atPath: self.trigger)
                self.present(chainTour: true)
            }
        }
        NSLog("[ignition] armed — touch ~/.relay/ignite to preview")
    }

    /// Show the full-screen ignition. `chainTour` writes ~/.relay/replay-tour when the inhale finishes, so the
    /// greeting/setup tour follows straight on.
    func present(chainTour: Bool) {
        guard panel == nil, let screen = NSScreen.main else { return }
        let p = NSPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.level = .screenSaver
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = false
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        p.ignoresMouseEvents = false
        let view = IgnitionView(
            screenSize: screen.frame.size,
            onDone: { [weak self] in self?.dismiss(chainTour: chainTour) },
            onSkip: { [weak self] in self?.dismiss(chainTour: false) }
        )
        p.contentView = NSHostingView(rootView: view)
        p.setFrame(screen.frame, display: true)
        p.orderFrontRegardless()
        panel = p
    }

    private func dismiss(chainTour: Bool) {
        guard let p = panel else { return }
        panel = nil
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.35
            p.animator().alphaValue = 0
        }, completionHandler: {
            p.orderOut(nil)
            if chainTour {
                // Chain into the greeting/setup tour (the app's poll picks this up).
                let t = (NSHomeDirectory() as NSString).appendingPathComponent(".relay/replay-tour")
                try? Data("1".utf8).write(to: URL(fileURLWithPath: t))
            }
        })
    }
}

private struct IgnitionView: View {
    let screenSize: CGSize
    let onDone: () -> Void
    let onSkip: () -> Void

    // Phase timeline (seconds): chaos → coalesce → hold → inhale → done.
    private let tChaos: Double = 1.3
    private let tCoalesce: Double = 1.5
    private let tHold: Double = 0.7
    private let tInhale: Double = 0.95
    private var tTotal: Double { tChaos + tCoalesce + tHold + tInhale }

    @State private var start = Date()
    @State private var dots: [IgniteDot] = []
    @State private var finished = false
    @State private var showSkip = false

    private let lime = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TimelineView(.animation) { tl in
                Canvas { ctx, size in
                    let t = tl.date.timeIntervalSince(start)
                    let notch = CGPoint(x: size.width / 2, y: 6)   // inhale toward the top-center (the notch)
                    for d in dots {
                        let (pos, alpha, scale) = resolve(d, t: t, notch: notch)
                        if alpha <= 0.01 { continue }
                        let r = (d.big ? 4.4 : 2.3) * scale
                        // glow
                        ctx.fill(Path(ellipseIn: CGRect(x: pos.x - r*2.4, y: pos.y - r*2.4, width: r*4.8, height: r*4.8)),
                                 with: .color(lime.opacity(alpha * 0.16)))
                        // core
                        ctx.fill(Path(ellipseIn: CGRect(x: pos.x - r, y: pos.y - r, width: r*2, height: r*2)),
                                 with: .color(lime.opacity(alpha)))
                    }
                }
                .onChange(of: tl.date) { _ in
                    let t = tl.date.timeIntervalSince(start)
                    if !showSkip && t > tChaos * 0.75 { showSkip = true }
                    if !finished && t >= tTotal + 0.2 { finished = true; onDone() }
                }
            }
            .ignoresSafeArea()

            // "Skip onboarding" — top-right, once the dots begin to form (founder: escape hatch).
            if showSkip {
                VStack {
                    HStack {
                        Spacer()
                        Button(action: onSkip) {
                            Text("Skip onboarding")
                                .font(.custom("Spline Sans Mono", size: 12))
                                .foregroundColor(.white.opacity(0.55))
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .overlay(RoundedRectangle(cornerRadius: 999).stroke(Color.white.opacity(0.18), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 34).padding(.trailing, 26)
                    }
                    Spacer()
                }
                .transition(.opacity)
            }
        }
        .onAppear { if dots.isEmpty { dots = Self.buildDots(screenSize: screenSize) } }
    }

    // Position/alpha/scale for a dot at time t across the phases.
    private func resolve(_ d: IgniteDot, t: Double, notch: CGPoint) -> (CGPoint, Double, CGFloat) {
        if t < tChaos {
            // Chaos: blink in place, scattered.
            let blink = 0.15 + 0.85 * abs(sin(t * 3.0 + d.seed * 6.28))
            return (d.start, blink, 1.0)
        } else if t < tChaos + tCoalesce {
            // Coalesce: fly start → target, ease-out, brighten to full.
            let p = easeOut((t - tChaos) / tCoalesce)
            let pos = lerp(d.start, d.target, p)
            return (pos, 0.35 + 0.65 * p, 1.0)
        } else if t < tChaos + tCoalesce + tHold {
            // Hold: the formed mark, fully lit, a subtle shimmer.
            let s = 0.92 + 0.08 * sin((t) * 4.0 + d.seed * 3.0)
            return (d.target, s, 1.0)
        } else {
            // Inhale: stream up into the notch, converge + fade + shrink.
            let p = easeIn(min(1, (t - tChaos - tCoalesce - tHold) / tInhale))
            let pos = lerp(d.target, notch, p)
            return (pos, 1.0 - p, 1.0 - 0.6 * CGFloat(p))
        }
    }

    private func lerp(_ a: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
        CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    }
    private func easeOut(_ t: Double) -> Double { 1 - pow(1 - min(max(t,0),1), 3) }
    private func easeIn(_ t: Double) -> Double { pow(min(max(t,0),1), 2.4) }

    // ── Build the dot targets: sample "SWITCHBOARD" (Doto) into points + prepend the 2×2 lamp cluster,
    //    centre it on screen, and give each dot a random off-screen-ish start + blink seed. ──
    private static func buildDots(screenSize: CGSize) -> [IgniteDot] {
        var wordPts = samplePoints(text: "SWITCHBOARD", fontSize: 128, spacing: 7)
        let wordSize = boundingSize(wordPts)
        // Lamp cluster (2×2), sized to the cap height, sitting to the LEFT of the wordmark with a gap.
        let cap = wordSize.height
        let lampR = cap * 0.16
        let gap = cap * 0.5
        var lampPts: [(CGPoint, Bool)] = []
        let centers = [CGPoint(x: 0, y: 0), CGPoint(x: lampR*2.2, y: 0),
                       CGPoint(x: 0, y: lampR*2.2), CGPoint(x: lampR*2.2, y: lampR*2.2)]
        for c in centers {
            // fill each lamp with a little disk of dots
            var yy = -lampR
            while yy <= lampR {
                var xx = -lampR
                while xx <= lampR {
                    if xx*xx + yy*yy <= lampR*lampR { lampPts.append((CGPoint(x: c.x + xx, y: c.y + yy), true)) }
                    xx += 4.5
                }
                yy += 4.5
            }
        }
        let lampW = lampR*2.2 + lampR*2
        // shift the wordmark right of the lamp cluster
        for i in wordPts.indices { wordPts[i].x += lampW + gap }
        let lampCapShift = (wordSize.height - lampW) / 2
        for i in lampPts.indices { lampPts[i].0.y += lampCapShift }

        var all: [(CGPoint, Bool)] = lampPts + wordPts.map { ($0, false) }
        // centre the whole mark on screen
        let total = boundingSize(all.map { $0.0 })
        let ox = (screenSize.width - total.width) / 2
        let oy = (screenSize.height - total.height) / 2 - screenSize.height * 0.02
        var rng = SeededRNG(seed: 0x5B0A2D)
        return all.enumerated().map { (i, e) in
            let target = CGPoint(x: e.0.x + ox, y: e.0.y + oy)
            // start scattered across the whole screen
            let sx = rng.next() * screenSize.width
            let sy = rng.next() * screenSize.height
            return IgniteDot(start: CGPoint(x: sx, y: sy), target: target, seed: rng.next(), big: e.1)
        }
    }

    private static func boundingSize(_ pts: [CGPoint]) -> CGSize {
        guard let minX = pts.map({ $0.x }).min(), let maxX = pts.map({ $0.x }).max(),
              let minY = pts.map({ $0.y }).min(), let maxY = pts.map({ $0.y }).max() else { return .zero }
        // normalise in place isn't possible here; caller uses width/height only
        return CGSize(width: maxX - minX, height: maxY - minY)
    }

    // Render text to a bitmap and sample lit pixels on a grid → shape points (origin at 0,0).
    private static func samplePoints(text: String, fontSize: CGFloat, spacing: CGFloat) -> [CGPoint] {
        let font = NSFont(name: "Doto", size: fontSize) ?? NSFont.boldSystemFont(ofSize: fontSize)
        let attr = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.white])
        let sz = attr.size()
        let w = Int(ceil(sz.width)) + 4, h = Int(ceil(sz.height)) + 4
        guard w > 0, h > 0,
              let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return [] }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        attr.draw(at: NSPoint(x: 2, y: 2))
        NSGraphicsContext.restoreGraphicsState()
        var pts: [CGPoint] = []
        var y = 0
        while y < h {
            var x = 0
            while x < w {
                if let c = rep.colorAt(x: x, y: y), c.alphaComponent > 0.5 {
                    // flip Y: bitmap origin is bottom-left for colorAt? colorAt uses top-left. Use as-is.
                    pts.append(CGPoint(x: CGFloat(x), y: CGFloat(y)))
                }
                x += Int(spacing)
            }
            y += Int(spacing)
        }
        return pts
    }
}

// Tiny deterministic RNG so the scatter is stable across redraws (Date.now not needed).
private struct SeededRNG {
    var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }
    mutating func next() -> Double {
        state ^= state >> 12; state ^= state << 25; state ^= state >> 27
        let v = (state &* 0x2545F4914F6CDD1D) >> 11
        return Double(v) / Double(UInt64(1) << 53)
    }
}
