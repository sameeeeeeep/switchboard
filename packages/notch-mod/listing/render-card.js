// Maintainer tool (not part of the plugin): paint the card to a PNG without opening a window, so
// screenshots never touch the screen or the keyboard. Uses helper/card.js's own layout and painter.
//
//   osascript -l JavaScript listing/render-card.js <card.js> <out.png> '<spec json>' [companion frame]
//
// With a companion frame (a file name from assets/companion/<name>/), the frame is drawn where the card
// shows it, and the PNG grows to the card's window size.

ObjC.import('AppKit')

function run(argv) {
  var src = $.NSString.stringWithContentsOfFileEncodingError(argv[0], 4, null).js
  // eval: loads this repo's own helper/card.js (a trusted local file) into a private scope to reuse its painter.
  var api = (function () { eval(src); return { layoutCard: layoutCard, paintCard: paintCard, loadCompanion: loadCompanion } })()
  var spec = JSON.parse(argv[2])
  var scale = 2
  var L = api.layoutCard(spec, spec.appearance === 'dark')
  var state = { selected: 0, typed: '' }
  for (var i = 0; i < (spec.options || []).length; i++) if (spec.options[i].recommended) { state.selected = i; break }
  var card = api.paintCard(spec, L, state, scale)
  var out = card
  var comp = argv[3] ? api.loadCompanion(spec.companion) : null
  if (comp) {
    var winW = L.w + Math.max(0, comp.w - comp.overlap), winH = Math.max(L.h, comp.h)
    var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, winW * scale, winH * scale, 8, 4, true, false, 'NSCalibratedRGBColorSpace', 0, 0)
    rep = rep.bitmapImageRepByRetaggingWithColorSpace($.NSColorSpace.sRGBColorSpace)
    rep.size = $.NSMakeSize(winW, winH)
    $.NSGraphicsContext.saveGraphicsState
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
    var frame = $.NSImage.alloc.initWithContentsOfFile(spec.companion.dir + '/' + argv[3])
    // Window coordinates are y-up; the card hangs from the top, the companion sits on its bottom line.
    frame.drawInRectFromRectOperationFraction($.NSMakeRect(L.w - comp.overlap, winH - L.h, comp.w, comp.h), $.NSZeroRect, 2, 1)
    var img = $.NSImage.alloc.initWithSize($.NSMakeSize(L.w, L.h)); img.addRepresentation(card)
    img.drawInRectFromRectOperationFraction($.NSMakeRect(0, winH - L.h, L.w, L.h), $.NSZeroRect, 2, 1)
    $.NSGraphicsContext.restoreGraphicsState
    out = rep
  }
  out.representationUsingTypeProperties(4, $()).writeToFileAtomically(argv[1], true)
  return argv[1] + ' ' + L.w + 'x' + L.h
}
