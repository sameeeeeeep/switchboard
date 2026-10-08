// Drives helper/card.js with clicks and keys handed to the card's OWN process (never posted to the
// system, so nothing can reach the app you're using), on a window placed off every display.
//
//   osascript -l JavaScript tests/card-selftest.js <card.js> <scenario>
//   scenarios: click-row · click-card-then-digit · click-card-then-return · click-card-then-down-return
//              · click-card-then-esc · type-in-box · no-click-no-key · timeout
//
// Prints the card's answer line (stdout) like the real card. tests/run-card-selftest.sh checks them.

ObjC.import('AppKit')

function run(argv) {
  var src = $.NSString.stringWithContentsOfFileEncodingError(argv[0], 4, null).js
  // The card activates itself when clicked; a test must never take focus from the app you're using.
  src = src.replace('app.activateIgnoringOtherApps(true)', 'void 0 /* self-test: no activation */')
  // eval: loads this repo's own helper/card.js (a trusted local file) into a private scope.
  var card = (function () { eval(src); return { main: main, layoutCard: layoutCard } })()
  var scenario = argv[1]
  var spec = {
    title: 'Claude asks · Layout', question: 'Which layout?', at: 'offscreen', timeout: 3,
    appearance: 'light', source: 'Claude Code',
    options: [{ label: 'Sidebar', detail: 'Left rail', recommended: true }, { label: 'Tabs', detail: 'Top' }, { label: 'Single page' }],
  }
  if (scenario === 'timeout') spec.timeout = 0.5
  var L = card.layoutCard(spec, false)

  var steps = []
  function at(x, y) { return { x: x, y: L.h - y } }      // card points (y down) → window points (y up)
  function rowCenter(i) { var r = L.rows[i]; return at(r.x + r.w / 2, r.y + r.h / 2) }
  var header = at(200, L.header.y + 6)
  var box = at(L.field.x + 40, L.field.y + L.field.h / 2)
  function click(p) { steps.push(['mouse', 1, p], ['mouse', 2, p]) }
  function key(ch, code) { steps.push(['key', ch, code]) }

  if (scenario === 'click-row') click(rowCenter(1))
  if (scenario === 'click-card-then-digit') { click(header); key('3', 20) }
  if (scenario === 'click-card-then-return') { click(header); key('\r', 36) }
  if (scenario === 'click-card-then-down-return') { click(header); key('', 125); key('\r', 36) }
  if (scenario === 'click-card-then-esc') { click(header); key('\u001b', 53) }
  if (scenario === 'type-in-box') {
    click(box)
    var t = '2 apples'
    for (var i = 0; i < t.length; i++) key(t[i], t[i] === ' ' ? 49 : t[i] === '2' ? 19 : 0)
    key('\r', 36)
  }
  // 'no-click-no-key': nothing happens; the card must still not be key or active, then time out.

  $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(0.4, false, function () {
    var win = null, ws = $.NSApp.windows
    for (var i = 0; i < ws.count; i++) if (ws.objectAtIndex(i).className.js === 'AskNotchPanel') win = ws.objectAtIndex(i)
    var log = function (s) { $.NSFileHandle.fileHandleWithStandardError.writeData($(s + '\n').dataUsingEncoding(4)) }
    log('before: key=' + win.keyWindow + ' active=' + $.NSApp.active)
    // Clicks first; keys a moment later, as a person's would (the card becomes key asynchronously).
    var post = function (s) {
      var ev
      if (s[0] === 'mouse') {
        // A synthetic event sometimes resolves its window late and reads its point as a screen point;
        // make it again until it carries the window point it was given.
        for (var n = 0; n < 20; n++) {
          ev = $.NSEvent.mouseEventWithTypeLocationModifierFlagsTimestampWindowNumberContextEventNumberClickCountPressure(
            s[1], s[2], 0, 0, win.windowNumber, null, 0, 1, s[1] === 1 ? 1 : 0)
          var p = ev.locationInWindow
          if (Math.abs(p.x - s[2].x) < 1 && Math.abs(p.y - s[2].y) < 1) break
        }
      } else {
        ev = $.NSEvent.keyEventWithTypeLocationModifierFlagsTimestampWindowNumberContextCharactersCharactersIgnoringModifiersIsARepeatKeyCode(
          10, $.NSMakePoint(0, 0), 0, 0, win.windowNumber, null, s[1], s[1], false, s[2])
      }
      // Clicks go through the app's queue (and so through the card's own window routing); keys go
      // straight to the card's window, since an inactive test app has no key window to route them to.
      if (s[0] === 'mouse') $.NSApp.postEventAtStart(ev, false)
      else win.sendEvent(ev)
    }
    steps.filter(function (s) { return s[0] === 'mouse' }).forEach(post)
    $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(0.25, false, function () {
      steps.filter(function (s) { return s[0] === 'key' }).forEach(post)
    })
    if (scenario === 'no-click-no-key') {
      $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(1, false, function () {
        log('after 1.4s: key=' + win.keyWindow + ' active=' + $.NSApp.active)
      })
    }
  })
  card.main(spec)
}
