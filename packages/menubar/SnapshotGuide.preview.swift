// Standalone SNAPSHOT harness for the guided cursor (CursorGuide) — renders the pointer RING + the
// instruction chip over a mock desktop, so the founder can SEE how the guide looks WITHOUT a live run.
// NOT in build.sh (own @main). Same convention as the other *.preview.swift: it carries its own copy of
// the tokens + a faithful port of GuideCaptionView's body (incl. the "text never gets cut" fix — no
// lineLimit on the instruction/hint). When CursorGuide's chip changes, re-sync this copy.
//
//   cd packages/menubar
//   swiftc -parse-as-library SnapshotGuide.preview.swift -o /tmp/snapguide && SNAP_DIR=/tmp/guide /tmp/snapguide
//
// Prints one `wrote <path>` per PNG.
import AppKit
import SwiftUI

// ---- tokens (verbatim from RelayMenuBar.swift / the other *.preview.swift) ----
extension Color {
    static let page    = Color(red: 0x0A/255.0, green: 0x0C/255.0, blue: 0x10/255.0)
    static let panel   = Color(red: 0x14/255.0, green: 0x15/255.0, blue: 0x1B/255.0)
    static let raised  = Color(red: 0x1E/255.0, green: 0x1E/255.0, blue: 0x21/255.0)
    static let edge    = Color(red: 0x28/255.0, green: 0x28/255.0, blue: 0x29/255.0)
    static let ink     = Color(red: 0xE8/255.0, green: 0xED/255.0, blue: 0xF4/255.0)
    static let inkDim  = Color(red: 0x9A/255.0, green: 0x9A/255.0, blue: 0xA2/255.0)
    static let inkFaint = Color(red: 0x6C/255.0, green: 0x6C/255.0, blue: 0x74/255.0)
    static let lime    = Color(red: 0xC8/255.0, green: 0xF2/255.0, blue: 0x50/255.0)
    static let indigo  = Color(red: 0x5B/255.0, green: 0x4F/255.0, blue: 0xE8/255.0)
    static let danger  = Color(red: 0xFF/255.0, green: 0x2D/255.0, blue: 0x6E/255.0)
}
extension Font {
    static func brico(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .system(size: s, weight: w) }
    static func hanken(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
    static func splMono(_ s: CGFloat) -> Font { .system(size: s, weight: .medium, design: .monospaced) }
}
private enum SBs { static let s3: CGFloat = 12 }
private enum SBrad { static let xs: CGFloat = 4, sm: CGFloat = 10 }

// ---- keycap action chip (verbatim from CursorGuide.GuideActionChip) ----
struct GuideActionChip: View {
    let combo: String; let label: String; let primary: Bool
    var body: some View {
        HStack(spacing: 4) {
            Text(combo).font(.splMono(9.5)).foregroundColor(primary ? .page : .ink)
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 4).fill(primary ? Color.lime : Color.raised)
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(primary ? Color.clear : Color.edge, lineWidth: 1)))
            Text(label).font(.hanken(10, .medium)).foregroundColor(primary ? .lime : .inkDim)
                .lineLimit(1).fixedSize()
        }
    }
}

// ---- the instruction chip (faithful port of GuideCaptionView.stepCard, with the text-not-cut fix) ----
struct GuideChip: View {
    var progress: String
    var title: String?
    var text: String
    var hint: String?
    var teach: Bool         // teach/test → shows Fail; here toggles Next vs Pass/Fail
    var test: Bool = false
    var muted: Bool = false

    var stepIndex: Int = 2
    var stepTotal: Int = 6
    var auto: Bool = true

    private var primaryActions: [(String, String, Bool)] {
        var a: [(String, String, Bool)] = []
        if test { a.append(("⌥→", "Pass", true)); a.append(("⌥←", "Fail", false)) }
        else    { a.append(("⌥→", "Next", true)) }
        a.append(("⌥↑", "Back", false))
        return a
    }
    private var metaActions: [(String, String, Bool)] {
        [("⌥↓", "Feedback", false), ("⌥M", muted ? "Unmute" : "Mute", false), ("esc", "Close", false)]
    }

    private var segmentBar: some View {
        HStack(spacing: 3) {
            ForEach(0..<max(stepTotal, 1), id: \.self) { i in
                RoundedRectangle(cornerRadius: 2).fill(i <= stepIndex ? Color.lime : Color.raised).frame(height: 4)
            }
        }.frame(width: 92)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                segmentBar
                if let t = title, !t.isEmpty {
                    Text(t.uppercased()).font(.splMono(8.5)).tracking(0.7)
                        .foregroundColor(.inkFaint).lineLimit(1).truncationMode(.tail)
                }
                Spacer(minLength: 0)
                if auto {
                    HStack(spacing: 3) {
                        Circle().fill(Color.lime).frame(width: 4, height: 4)
                        Text("AUTO").font(.splMono(8)).tracking(0.5).foregroundColor(.lime)
                    }.padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().stroke(Color.lime.opacity(0.4), lineWidth: 1))
                }
                Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 9)).foregroundColor(muted ? .inkFaint : .lime)
                Text("⌥.").font(.splMono(8)).foregroundColor(.inkFaint)
            }
            Text(text).font(.brico(15, .semibold)).foregroundColor(.ink)   // Bricolage · NO lineLimit → never cut
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let h = hint, !h.isEmpty {
                Text(h).font(.hanken(11.5, .regular)).foregroundColor(.inkDim)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if auto {
                HStack(spacing: 6) {
                    Circle().fill(Color.lime).frame(width: 5, height: 5).shadow(color: Color.lime.opacity(0.7), radius: 3)
                    Text("watching — I'll advance on my own").font(.hanken(10.5, .medium)).foregroundColor(.lime.opacity(0.9))
                }
            }
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    ForEach(Array(primaryActions.enumerated()), id: \.offset) { _, act in
                        GuideActionChip(combo: act.0, label: act.1, primary: act.2)
                    }
                }
                HStack(spacing: 5) {
                    ForEach(Array(metaActions.enumerated()), id: \.offset) { _, act in
                        GuideActionChip(combo: act.0, label: act.1, primary: act.2)
                    }
                }
            }.padding(.top, 2)
        }
        .padding(.horizontal, SBs.s3).padding(.vertical, SBs.s3)
        .frame(width: 300, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: SBrad.sm).fill(Color.panel.opacity(0.98))
            .overlay(RoundedRectangle(cornerRadius: SBrad.sm).stroke(Color.lime.opacity(0.45), lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 12, x: 0, y: 6))
    }
}

// ---- static dot-matrix (snapshot stand-in for the animated DotMatrix; a lit 5×3 field) ----
struct DMStub: View {
    var accent: Color = .lime
    let lit: [Int] = [0,2,4,6,8,10,12,14]   // a "working" checker
    var body: some View {
        VStack(spacing: 2) { ForEach(0..<3, id: \.self) { r in
            HStack(spacing: 2) { ForEach(0..<5, id: \.self) { c in
                RoundedRectangle(cornerRadius: 1).fill(lit.contains(r*5+c) ? accent : Color(red:0x2b/255,green:0x33/255,blue:0x40/255)).frame(width: 3, height: 3)
            } }
        } }
    }
}

// ---- an options card (zone 5: A/B/C variants + approve, with the dot-matrix sensing line) ----
struct OptionsCard: View {
    var sel = 1
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                HStack(spacing:2){ ForEach(0..<4,id:\.self){ i in RoundedRectangle(cornerRadius:2).fill(i<=2 ? Color.lime : Color.raised).frame(height:4)} }.frame(width:78)
                Text("PICK A HEADLINE").font(.splMono(8.5)).tracking(0.7).foregroundColor(.inkFaint).lineLimit(1)
                Spacer(minLength:0)
                Text("◆").font(.system(size:8)).foregroundColor(.indigo)
                Text("⌥.").font(.splMono(8)).foregroundColor(.inkFaint)
            }
            Text("Pick a headline — updates the page live.").font(.brico(14, .semibold)).foregroundColor(.ink)
                .fixedSize(horizontal:false, vertical:true)
            HStack(spacing:5){ Text("PICK ONE — UPDATES LIVE").font(.splMono(8.5)).tracking(0.6).foregroundColor(.indigo); Text("★ recommended").font(.splMono(8)).foregroundColor(.lime.opacity(0.9)) }
            HStack(alignment:.top, spacing:7){
                ForEach(0..<3, id:\.self){ i in
                    let s = i==sel
                    let labels=["Bold","Calm","Punchy"]; let details=["punchy, high-energy","measured, trustworthy","loud, risky"]
                    VStack(alignment:.leading, spacing:5){
                        ZStack(alignment:.topTrailing){
                            RoundedRectangle(cornerRadius:5).fill(LinearGradient(colors:[[Color.lime,Color.indigo,Color(red:1,green:0.35,blue:0.52)][i],Color(red:0x12/255,green:0x14/255,blue:0x1a/255)],startPoint:.topLeading,endPoint:.bottomTrailing)).frame(maxWidth:.infinity).frame(height:40)
                            if i==1 { Text("★").font(.system(size:9)).foregroundColor(.lime).padding(3).background(Circle().fill(Color.page.opacity(0.75))).padding(4) }
                        }
                        HStack(spacing:4){ Text(s ? "\(["A","B","C"][i])✓" : ["A","B","C"][i]).font(.splMono(9)).foregroundColor(s ? .lime : .inkFaint); Text(labels[i]).font(.hanken(11,.semibold)).foregroundColor(s ? .ink : .inkDim) }
                        Text(details[i]).font(.hanken(9.5)).foregroundColor(.inkFaint).lineLimit(3).fixedSize(horizontal:false,vertical:true)
                    }.padding(7).frame(maxWidth:.infinity, alignment:.leading)
                    .background(RoundedRectangle(cornerRadius:SBrad.xs).fill(Color.panel))
                    .overlay(RoundedRectangle(cornerRadius:SBrad.xs).stroke(s ? Color.lime : (i==1 ? Color.lime.opacity(0.4) : Color.edge), lineWidth: s ? 1.5 : 1))
                }
            }
            HStack(spacing:6){ DMStub(accent:.indigo); Text("applying Calm…").font(.hanken(10.5,.medium)).foregroundColor(.indigo) }
            VStack(alignment:.leading, spacing:5){
                HStack(spacing:5){ GuideActionChip(combo:"⌥1·⌥2·⌥3",label:"try",primary:false); GuideActionChip(combo:"⌥→",label:"Approve",primary:true); GuideActionChip(combo:"⌥↑",label:"Back",primary:false) }
                HStack(spacing:5){ GuideActionChip(combo:"⌥↓",label:"Feedback",primary:false); GuideActionChip(combo:"esc",label:"Close",primary:false) }
            }.padding(.top,2)
        }
        .padding(12).frame(width:320,alignment:.leading)
        .background(RoundedRectangle(cornerRadius:SBrad.sm).fill(Color.panel.opacity(0.98))
            .overlay(RoundedRectangle(cornerRadius:SBrad.sm).stroke(Color.indigo.opacity(0.5),lineWidth:1))
            .shadow(color:.black.opacity(0.45),radius:12,x:0,y:6))
    }
}

// ---- collapsed pill (docked; ⌥. brings the card back) ----
struct GuidePill: View {
    var step: Int = 3; var total: Int = 6
    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(Color.lime).frame(width: 6, height: 6).shadow(color: Color.lime.opacity(0.7), radius: 3)
            Text("\(step)/\(total)").font(.splMono(10)).foregroundColor(.ink)
            Text("guide").font(.hanken(11, .semibold)).foregroundColor(.inkDim)
            Text("⌥. expand").font(.splMono(8.5)).foregroundColor(.inkFaint)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: SBrad.sm).fill(Color.panel.opacity(0.98))
            .overlay(RoundedRectangle(cornerRadius: SBrad.sm).stroke(Color.lime.opacity(0.45), lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 12, x: 0, y: 6))
    }
}

// ---- pointer ring (verbatim look from GuideCaptionView, still frame at mid-pulse) ----
struct GuideRing: View {
    var body: some View {
        Circle().stroke(Color.lime.opacity(0.85), lineWidth: 2)
            .frame(width: 40, height: 40)
            .scaleEffect(1.06)
            .overlay(Circle().stroke(Color.lime.opacity(0.25), lineWidth: 1).frame(width: 58, height: 58))
    }
}

// ---- a mock desktop so the ring + chip have context (a fake app window + an Export button) ----
struct MockDesktop: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0x11/255, green: 0x14/255, blue: 0x1c/255),
                                    Color(red: 0x08/255, green: 0x09/255, blue: 0x0d/255)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            // a window
            RoundedRectangle(cornerRadius: 14).fill(Color(red: 0x16/255, green: 0x17/255, blue: 0x1e/255))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.edge, lineWidth: 1))
                .frame(width: 760, height: 460)
                .overlay(alignment: .topLeading) {
                    HStack(spacing: 7) {
                        Circle().fill(Color(red: 0xFF/255, green: 0x5F/255, blue: 0x57/255)).frame(width: 11, height: 11)
                        Circle().fill(Color(red: 0xFE/255, green: 0xBC/255, blue: 0x2E/255)).frame(width: 11, height: 11)
                        Circle().fill(Color(red: 0x28/255, green: 0xC8/255, blue: 0x40/255)).frame(width: 11, height: 11)
                    }.padding(16)
                }
        }
    }
}

@main
struct SnapshotGuide {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let dir = ProcessInfo.processInfo.environment["SNAP_DIR"] ?? (NSTemporaryDirectory() + "guide")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        let W: CGFloat = 1120, H: CGFloat = 700

        // The RING points at the Export button (top-right); the CARD is DOCKED bottom-center (it no longer
        // follows the cursor). `collapsed` shows the small pill the ⌥. hotkey toggles to.
        let ringPt = CGPoint(x: 760, y: 232)
        func scene(collapsed: Bool) -> some View {
            ZStack {
                MockDesktop().frame(width: W, height: H)
                Text("Export ▾").font(.hanken(12, .semibold)).foregroundColor(.ink)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.indigo.opacity(0.9)))
                    .position(ringPt)
                GuideRing().position(ringPt)
                // docked bottom-center
                VStack { Spacer()
                    if collapsed {
                        GuidePill(step: 3, total: 6)
                    } else {
                        GuideChip(
                            progress: "3 / 6", title: "Ship the launch ad",
                            text: "Click the Export button I've ringed, then choose PNG at 2× and pick the /Launch folder. I'll sense the file land and move us on automatically — you don't have to press anything.",
                            hint: "top-right of the window · the arrow means it opens a menu",
                            teach: true)
                    }
                }.padding(.bottom, 40).frame(width: W, height: H)
            }
            .frame(width: W, height: H)
            .background(Color.black)
        }

        func snap(_ name: String, _ v: some View) {
            let r = ImageRenderer(content: v.frame(width: W, height: H))
            r.scale = 2
            guard let cg = r.cgImage else { print("FAIL \(name)"); return }
            let rep = NSBitmapImageRep(cgImage: cg)
            guard let png = rep.representation(using: .png, properties: [:]) else { print("FAIL png \(name)"); return }
            let path = dir + "/" + name + ".png"
            try? png.write(to: URL(fileURLWithPath: path))
            print("wrote \(path)")
        }

        snap("guide-docked", scene(collapsed: false))
        snap("guide-collapsed", scene(collapsed: true))
        // options step — docked, ring pointing, A/B/C variants + dot-matrix "applying"
        snap("guide-options", ZStack {
            MockDesktop().frame(width: W, height: H)
            Text("Export ▾").font(.hanken(12, .semibold)).foregroundColor(.ink).padding(.horizontal,12).padding(.vertical,7).background(RoundedRectangle(cornerRadius:8).fill(Color.indigo.opacity(0.9))).position(ringPt)
            GuideRing().position(ringPt)
            VStack { Spacer(); OptionsCard(sel: 1) }.padding(.bottom, 40).frame(width: W, height: H)
        }.frame(width: W, height: H).background(Color.black))
        exit(0)
    }
}
