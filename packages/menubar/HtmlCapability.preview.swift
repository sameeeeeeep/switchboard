// HTML capability proof: Claude writes HTML/SVG → we render it to a crisp PNG offscreen (WKWebView
// snapshot, the same path the widgets use) → that PNG becomes a draggable notch result. Instant, free,
// runs on the user's own Claude. Two samples: a diagram + a LinkedIn thumbnail (both hand-authored here
// as stand-ins for what Claude would emit).
import AppKit
import WebKit

let OUT = "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay--claude-worktrees-settings-layout-overflow-2ee5dc/57a992f5-298f-4ee6-a2e0-04e931b231db/scratchpad/"
func log(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

// A brand-dark flow diagram: wrapp = capability + skill + UI.
let DIAGRAM = """
<!doctype html><html><head><meta charset=utf-8><style>
*{margin:0;box-sizing:border-box;font-family:-apple-system,system-ui,sans-serif}
body{width:1000px;height:640px;background:#000;color:#E8EDF4;display:flex;flex-direction:column;justify-content:center;padding:64px;
 background-image:radial-gradient(circle at 1px 1px,#1a1a1e 1px,transparent 0);background-size:26px 26px}
.k{font:600 12px ui-monospace,monospace;letter-spacing:2px;color:#6C6C74;margin-bottom:8px}
h1{font-size:40px;font-weight:800;margin-bottom:40px;letter-spacing:-.5px}
h1 b{color:#C8F250}
.row{display:flex;align-items:center;gap:18px}
.box{flex:1;background:#141416;border:1px solid #282829;border-radius:16px;padding:22px}
.box .t{font-size:20px;font-weight:700;margin-bottom:6px}
.box .d{font-size:14px;color:#9A9AA2;line-height:1.4}
.dot{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:14px}
.plus{font-size:32px;color:#6C6C74;font-weight:300}
.eq{font-size:32px;color:#C8F250;font-weight:400}
.out{background:linear-gradient(135deg,#C8F250,#9fd420);color:#0a0a0b;border:none;flex:1.2}
.out .d{color:#0a3a10;opacity:.8}
</style></head><body>
<div class=k>THE COMPOSITION</div>
<h1>A wrapp = <b>capability + skill + UI</b></h1>
<div class=row>
 <div class=box><div class=dot style="background:#2a2f45">🧩</div><div class=t>Capability</div><div class=d>A reusable primitive — create-HTML, vision, transcribe.</div></div>
 <div class=plus>+</div>
 <div class=box><div class=dot style="background:#3a2a45">✦</div><div class=t>Skill</div><div class=d>The know-how that aims it at a job. Embedded in the wrapp.</div></div>
 <div class=plus>+</div>
 <div class=box><div class=dot style="background:#243a2f">▦</div><div class=t>UI</div><div class=d>The widget face in the notch.</div></div>
 <div class=eq>=</div>
 <div class="box out"><div class=dot style="background:rgba(10,10,11,.15)">⚡</div><div class=t>A wrapp</div><div class=d>One click. Private. Runs on your own Claude.</div></div>
</div>
</body></html>
"""

// A LinkedIn-post thumbnail (16:9), the kind God would make in-notch and you'd drag onto your post.
let THUMB = """
<!doctype html><html><head><meta charset=utf-8><style>
*{margin:0;box-sizing:border-box;font-family:-apple-system,system-ui,sans-serif}
body{width:1200px;height:675px;background:linear-gradient(135deg,#0b1020,#151a33 55%,#0a0a0b);color:#fff;
 display:flex;flex-direction:column;justify-content:center;padding:88px;position:relative;overflow:hidden}
.orb{position:absolute;border-radius:50%;filter:blur(2px)}
.o1{width:420px;height:420px;right:-80px;top:-120px;background:radial-gradient(circle,#C8F25055,transparent 70%)}
.o2{width:300px;height:300px;right:180px;bottom:-120px;background:radial-gradient(circle,#5B8CFF44,transparent 70%)}
.k{font:700 15px ui-monospace,monospace;letter-spacing:3px;color:#C8F250;margin-bottom:20px}
h1{font-size:66px;font-weight:800;line-height:1.05;letter-spacing:-1px;max-width:15ch}
p{font-size:24px;color:#c9cdd6;margin-top:24px;max-width:26ch;line-height:1.4}
.by{position:absolute;bottom:64px;left:88px;display:flex;align-items:center;gap:12px;color:#9A9AA2;font-size:18px}
.av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#C8F250,#7fae2a);color:#0a0a0b;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px}
</style></head><body>
<div class="orb o1"></div><div class="orb o2"></div>
<div class=k>BUILDING IN PUBLIC</div>
<h1>Your AI tools should feel like apps, not repos.</h1>
<p>Why we're building a one-click, private wrapp store on your own Claude.</p>
<div class=by><div class=av>S</div><div>Sameep · 2 min read</div></div>
</body></html>
"""

final class Shot: NSObject, WKNavigationDelegate {
    let web: WKWebView; let window: NSWindow
    var queue: [(String, String, CGFloat, CGFloat)]; var cur: (String, String, CGFloat, CGFloat)!
    init(_ q: [(String, String, CGFloat, CGFloat)]) {
        queue = q
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 675))
        window = NSWindow(contentRect: NSRect(x: -3000, y: 0, width: 1200, height: 675), styleMask: [.borderless], backing: .buffered, defer: false)
        super.init(); window.contentView = web; web.navigationDelegate = self; window.orderFrontRegardless(); next()
    }
    func next() {
        guard !queue.isEmpty else { log("done"); DispatchQueue.main.async { NSApp.terminate(nil); exit(0) }; return }
        cur = queue.removeFirst()
        web.setFrameSize(NSSize(width: cur.2, height: cur.3))
        window.setContentSize(NSSize(width: cur.2, height: cur.3))
        web.loadHTMLString(cur.1, baseURL: nil)
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            let cfg = WKSnapshotConfiguration(); cfg.rect = NSRect(x: 0, y: 0, width: self.cur.2, height: self.cur.3)
            self.web.takeSnapshot(with: cfg) { img, err in
                if let img = img, let t = img.tiffRepresentation, let r = NSBitmapImageRep(data: t), let p = r.representation(using: .png, properties: [:]) {
                    try? p.write(to: URL(fileURLWithPath: OUT + self.cur.0 + ".png")); log("wrote \(self.cur.0)")
                } else { log("FAIL \(self.cur.0): \(String(describing: err))") }
                self.next()
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let s = Shot([("htmlcap-diagram", DIAGRAM, 1000, 640), ("htmlcap-thumb", THUMB, 1200, 675)])
app.run()
