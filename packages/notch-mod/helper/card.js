// Ask Notch card: one question as a native card at the Mac notch (or beside the pointer).
//
// Plain JavaScript for macOS's built-in script runner (JavaScript for Automation, with its bridge to
// AppKit). Nothing is compiled; this file is the whole program:
//
//   /usr/bin/osascript -l JavaScript helper/card.js '<json>'
//   json:   { title?, question, options:[{label, detail?, recommended?}], at?: "notch"|"cursor",
//             source?, timeout?: seconds, appearance?: "light"|"dark", companion?: {name, dir},
//             debug?: true }        (tests also use at: "offscreen", a window on no display)
//   stdout: {"answer":"<label>","index":n} | {"answer":"<typed>","typed":true}
//           | {"cancelled":true,"reason":"esc"|"timeout"}
//
// It draws one window, reads the pointer position and (with a companion) a few pictures from the
// plugin's assets folder, prints the answer and exits. It makes no network requests, writes no
// files, reads no environment, and needs no permissions.
//
// The card never takes the keyboard when it appears, so typing in another app can't answer it: the
// window refuses to become the key window until you click it. Clicking an option answers. Clicking
// the card enables its keys: 1-4 pick · ↑↓ move · ⏎ confirm · esc cancels. Clicking the text box
// lets you type your own answer (digits are text there).

ObjC.import('AppKit')
ObjC.import('QuartzCore')
ObjC.import('stdlib')

// Claude's design language: warm ivory / warm charcoal surfaces, terracotta accent, serif voice.
var PALETTES = {
  light: { bg: 0xFAF9F5, raised: 0xF0EEE6, border: 0xE3E0D5, text: 0x141413, muted: 0x6B6A65, accent: 0xD97757 },
  dark: { bg: 0x262624, raised: 0x30302E, border: 0x3E3E3A, text: 0xFAF9F5, muted: 0xA3A29C, accent: 0xD97757 },
}
var CARD_W = 440
var PAD_X = 18, PAD_Y = 14, GAP = 12
var DEFAULT_TIMEOUT_S = 540

function color(hex, alpha) {
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255,
    (hex & 255) / 255, alpha === undefined ? 1 : alpha)
}

function sysFont(size, weight) { return $.NSFont.systemFontOfSizeWeight(size, weight || 0) }
function serifFont(size) {
  var d = $.NSFont.systemFontOfSize(size).fontDescriptor.fontDescriptorWithDesign('NSCTFontUIFontDesignSerif')
  return d.isNil() ? $.NSFont.systemFontOfSize(size) : $.NSFont.fontWithDescriptorSize(d, size)
}
var W_MEDIUM = 0.23, W_SEMIBOLD = 0.3, W_BOLD = 0.4

function attrs(font, col, lineSpacing) {
  var d = $.NSMutableDictionary.dictionary
  d.setObjectForKey(font, $.NSFontAttributeName)
  if (col) d.setObjectForKey(col, $.NSForegroundColorAttributeName)
  if (lineSpacing) {
    var p = $.NSMutableParagraphStyle.alloc.init
    p.lineSpacing = lineSpacing
    d.setObjectForKey(p, $.NSParagraphStyleAttributeName)
  }
  return d
}
var LM = null
// One line of text, as SwiftUI sizes it: ascent + descent + leading, rounded up to a whole point
// (the serif face is rounded to the nearest point, which is what SwiftUI's layout came to).
function lineHeight(font) {
  var h = font.ascender - font.descender + font.leading
  return font.fontName.js.indexOf('NewYork') >= 0 ? Math.round(h) : Math.ceil(h - 0.001)
}
function textWidth(s, a) { return $(s).sizeWithAttributes(a).width }
// Rounded up to the pixel grid (half points), as SwiftUI sizes text.
function px(v) { return Math.ceil(v * 2 - 0.001) / 2 }
// Height of text wrapped to `width`: whole lines of lineHeight, plus the paragraph's line spacing.
function textHeight(s, a, width, font, spacing) {
  if (!LM) LM = $.NSLayoutManager.alloc.init
  spacing = spacing || 0
  var raw = $(s).boundingRectWithSizeOptionsAttributes($.NSMakeSize(width, 100000), 3, a).size.height
  var lines = Math.max(1, Math.round((raw + spacing) / (LM.defaultLineHeightForFont(font) + spacing)))
  return lines * lineHeight(font) + (lines - 1) * spacing
}

// ── layout: every rect in card points, origin top-left ──
function layoutCard(spec, dark) {
  var p = PALETTES[dark ? 'dark' : 'light']
  var L = { p: p, w: CARD_W, rows: [], hints: [] }
  var innerW = CARD_W - PAD_X * 2
  var y = PAD_Y

  L.fonts = {
    star: sysFont(13, W_BOLD), title: sysFont(11.5, W_MEDIUM), source: sysFont(10.5),
    question: serifFont(16), label: sysFont(13, W_MEDIUM), badge: sysFont(11, W_SEMIBOLD),
    rec: sysFont(9.5, W_MEDIUM), detail: sysFont(11.5), field: sysFont(12.5),
    hintKey: sysFont(9.5, W_MEDIUM), hint: sysFont(10),
  }
  var F = L.fonts

  // Header: ✻ · title ……… source
  var headH = Math.max(lineHeight(F.star), lineHeight(F.title), lineHeight(F.source))
  L.header = { y: y, h: headH, title: spec.title || 'Claude has a question', source: spec.source || '' }
  y += headH + GAP

  // Question (serif), wrapped to the card's inner width.
  var qa = attrs(F.question, color(p.text), 2)
  var qh = textHeight(spec.question, qa, innerW, F.question, 2)
  L.question = { x: PAD_X, y: y, w: innerW, h: Math.max(qh, lineHeight(F.question)) }
  y += L.question.h + GAP

  // Options: badge 20×20, then label (+ Recommended) over the detail; padding 10×8.
  var opts = spec.options || []
  var textW = innerW - 20 - 20 - 10
  for (var i = 0; i < opts.length; i++) {
    var o = opts[i]
    var recW = o.recommended ? Math.ceil(textWidth('Recommended', attrs(F.rec))) + 10 : 0
    var labelW = textW - (recW ? recW + 6 : 0)
    var lh = Math.max(lineHeight(F.label), textHeight(String(o.label), attrs(F.label), labelW, F.label))
    var dh = o.detail ? textHeight(String(o.detail), attrs(F.detail), textW, F.detail) : 0
    var contentH = lh + (o.detail ? 2 + dh : 0)
    var h = 8 + Math.max(20, contentH) + 8
    L.rows.push({ x: PAD_X, y: y, w: innerW, h: h, labelH: lh, labelW: labelW, detailH: dh, recW: recW })
    y += h + 6
  }
  if (opts.length) y += -6 + GAP

  // Text box.
  var fh = lineHeight(F.field)
  L.field = { x: PAD_X, y: y, w: innerW, h: fh + 16, lineH: fh }
  y += L.field.h + GAP

  // Key hints.
  var keyH = lineHeight(F.hintKey) + 2
  var hintH = Math.max(keyH, lineHeight(F.hint))
  var hx = PAD_X
  var defs = [['click', 'for keys'], ['1–' + Math.max(1, opts.length), 'choose'], ['↵', 'confirm'], ['esc', 'dismiss']]
  for (var k = 0; k < defs.length; k++) {
    var kw = px(textWidth(defs[k][0], attrs(F.hintKey))) + 8
    var tw = px(textWidth(defs[k][1], attrs(F.hint)))
    L.hints.push({ key: defs[k][0], what: defs[k][1], x: hx, kw: kw, tw: tw })
    hx += kw + 4 + tw + 10
  }
  L.hintY = y; L.hintH = hintH; L.keyH = keyH
  y += hintH + PAD_Y

  L.h = Math.round(y)
  return L
}

// ── drawing ──
function roundedRect(x, y, w, h, r) {
  return $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(x, y, w, h), r, r)
}
// The card: square-ish top corners (it grows out of the notch), round bottom corners.
function cardPath(w, h, top, bottom) {
  var b = $.NSBezierPath.bezierPath
  b.moveToPoint($.NSMakePoint(top, 0))
  b.lineToPoint($.NSMakePoint(w - top, 0))
  b.appendBezierPathWithArcFromPointToPointRadius($.NSMakePoint(w, 0), $.NSMakePoint(w, top), top)
  b.lineToPoint($.NSMakePoint(w, h - bottom))
  b.appendBezierPathWithArcFromPointToPointRadius($.NSMakePoint(w, h), $.NSMakePoint(w - bottom, h), bottom)
  b.lineToPoint($.NSMakePoint(bottom, h))
  b.appendBezierPathWithArcFromPointToPointRadius($.NSMakePoint(0, h), $.NSMakePoint(0, h - bottom), bottom)
  b.lineToPoint($.NSMakePoint(0, top))
  b.appendBezierPathWithArcFromPointToPointRadius($.NSMakePoint(0, 0), $.NSMakePoint(top, 0), top)
  b.closePath
  return b
}
function fill(path, c) { c.setFill; path.fill }
function stroke(path, c) { c.setStroke; path.lineWidth = 1; path.stroke }
function drawText(s, x, y, w, h, a) {
  $(s).drawWithRectOptionsAttributes($.NSMakeRect(x, y, w, h), 3, a)
}

// Paints the card for `state` ({selected, typed}) into a bitmap at `scale` pixels per point.
function paintCard(spec, L, state, scale) {
  var p = L.p, F = L.fonts, W = L.w, H = L.h
  var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, Math.round(W * scale), Math.round(H * scale), 8, 4, true, false, 'NSCalibratedRGBColorSpace', 0, 0)
  rep = rep.bitmapImageRepByRetaggingWithColorSpace($.NSColorSpace.sRGBColorSpace)
  rep.size = $.NSMakeSize(W, H)
  var base = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep)
  $.NSGraphicsContext.saveGraphicsState
  $.NSGraphicsContext.setCurrentContext(base)
  // Flip so y runs down, as in the layout.
  var t = $.NSAffineTransform.transform
  t.translateXByYBy(0, H); t.scaleXByYBy(1, -1); t.concat
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithCGContextFlipped(base.CGContext, true))

  var card = cardPath(W, H, 12, 20)
  fill(card, color(p.bg)); stroke(card, color(p.border))

  // Header.
  var hy = L.header.y, hh = L.header.h
  var starA = attrs(F.star, color(p.accent))
  var starW = px(textWidth('✻', starA))
  drawText('✻', PAD_X, hy + (hh - lineHeight(F.star)) / 2, starW + 2, lineHeight(F.star), starA)
  var srcW = 0
  if (L.header.source) {
    var sa = attrs(F.source, color(p.muted, 0.8))
    srcW = Math.min(Math.ceil(textWidth(L.header.source, sa)), 160)
    drawText(L.header.source, W - PAD_X - srcW, hy + (hh - lineHeight(F.source)) / 2, srcW, lineHeight(F.source), sa)
  }
  var ta = attrs(F.title, color(p.muted))
  var tx = PAD_X + starW + 6
  drawText(L.header.title, tx, hy + (hh - lineHeight(F.title)) / 2, W - PAD_X - tx - srcW - 8, lineHeight(F.title), ta)

  // Question.
  var q = L.question
  drawText(spec.question, q.x, q.y, q.w, q.h + 4, attrs(F.question, color(p.text), 2))

  // Options.
  var opts = spec.options || []
  for (var i = 0; i < opts.length; i++) {
    var o = opts[i], r = L.rows[i], on = i === state.selected
    var box = roundedRect(r.x, r.y, r.w, r.h, 11)
    if (on) fill(box, color(p.raised))
    stroke(box, on ? color(p.accent, 0.55) : color(p.border))
    var bx = r.x + 10, by = r.y + 8
    var badge = roundedRect(bx, by, 20, 20, 6)
    fill(badge, on ? color(p.accent) : color(p.bg))
    if (!on) stroke(badge, color(p.border))
    var na = attrs(F.badge, on ? $.NSColor.whiteColor : color(p.muted))
    var nw = textWidth(String(i + 1), na), nh = lineHeight(F.badge)
    drawText(String(i + 1), bx + Math.ceil((20 - nw) - 0.5) / 2, by + Math.floor((20 - nh) / 2), nw + 2, nh, na)
    var cx = bx + 20 + 10
    drawText(String(o.label), cx, by, r.labelW, r.labelH, attrs(F.label, color(p.text)))
    if (o.recommended) {
      var la = attrs(F.label)
      var lw = Math.min(Math.ceil(textWidth(String(o.label), la)), r.labelW)
      var rh = lineHeight(F.rec) + 2
      var rx = cx + lw + 6, ry = by + (lineHeight(F.label) - rh) / 2
      fill(roundedRect(rx, ry, r.recW, rh, rh / 2), color(p.accent, 0.12))
      drawText('Recommended', rx + 5, ry + 1, r.recW, rh, attrs(F.rec, color(p.accent)))
    }
    if (o.detail) drawText(String(o.detail), cx, by + r.labelH + 2, r.w - 50, r.detailH + 2, attrs(F.detail, color(p.muted)))
  }

  // Text box, with its own placeholder (the system one is dimmed to near-invisible while the card
  // isn't key).
  var f = L.field
  var fb = roundedRect(f.x, f.y, f.w, f.h, 10)
  fill(fb, color(p.bg)); stroke(fb, color(p.border))
  if (!state.typed) {
    drawText('Something else? Type it here', f.x + 11, f.y + 8, f.w - 22, f.lineH, attrs(F.field, color(p.muted, 0.8)))
  }

  // Key hints.
  for (var k = 0; k < L.hints.length; k++) {
    var hn = L.hints[k]
    var ky = L.hintY + (L.hintH - L.keyH) / 2
    stroke(roundedRect(hn.x, ky, hn.kw, L.keyH, 4), color(p.border))
    drawText(hn.key, hn.x + 4, ky + 1, hn.kw, L.keyH, attrs(F.hintKey, color(p.muted)))
    drawText(hn.what, hn.x + hn.kw + 4, L.hintY + (L.hintH - lineHeight(F.hint)) / 2 - 0.5, hn.tw + 2, lineHeight(F.hint), attrs(F.hint, color(p.muted)))
  }

  $.NSGraphicsContext.restoreGraphicsState
  return rep
}

function imageOf(rep, w, h) {
  var img = $.NSImage.alloc.initWithSize($.NSMakeSize(w, h))
  img.addRepresentation(rep)
  return img
}

// Frame list for each companion (the PNGs live in assets/companion/<name>/). Painted by the plugin author.
var COMPANION_SEQUENCES = {"cat": {"canvas": [120, 60], "overlap": 48, "intro": {"delay_ms": 180, "frames": [["intro-01.png", 130], ["intro-02.png", 60], ["intro-03.png", 60], ["intro-04.png", 60], ["intro-05.png", 60], ["intro-06.png", 70], ["intro-07.png", 70], ["intro-08.png", 70], ["intro-09.png", 70]]}, "idle": "sit.png", "settle": {"after_s": 20, "frames": [["settle-1.png", 240], ["settle-2.png", 0]]}}}

// ── companion: a small animated character beside the card ──
// COMPANION_SEQUENCES lists the frames; an unknown name means no companion.
function loadCompanion(c) {
  if (!c || typeof c.dir !== 'string') return null
  var seq = COMPANION_SEQUENCES[c.name]
  if (!seq) return null
  var images = {}
  function frame(name) {
    if (!/^[\w.-]+\.png$/.test(name)) return null
    if (!images[name]) {
      var img = $.NSImage.alloc.initWithContentsOfFile(c.dir + '/' + name)
      if (img.isNil()) return null
      img.size = $.NSMakeSize(seq.canvas[0], seq.canvas[1])
      images[name] = img
    }
    return images[name]
  }
  function frames(list) {
    var out = []
    for (var i = 0; i < (list || []).length; i++) {
      var img = frame(list[i][0])
      if (img) out.push({ img: img, ms: list[i][1] || 0 })
    }
    return out
  }
  var idle = frame(seq.idle)
  if (!idle || !seq.canvas) return null
  return {
    w: seq.canvas[0], h: seq.canvas[1], overlap: seq.overlap || 0, idle: idle,
    introDelay: (seq.intro && seq.intro.delay_ms) || 0, intro: frames(seq.intro && seq.intro.frames),
    settleAfter: (seq.settle && seq.settle.after_s) || 0, settle: frames(seq.settle && seq.settle.frames),
  }
}

// ── output ──
function emit(obj) {
  var s = $(JSON.stringify(obj) + '\n')
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(s.dataUsingEncoding(4))
  $.exit(0)
}
function log(line) {
  $.NSFileHandle.fileHandleWithStandardError.writeData($(line + '\n').dataUsingEncoding(4))
}

// ── the window ──
function main(spec) {
  var app = $.NSApplication.sharedApplication
  // Never take the keyboard on appear. When the app you're using started this program (your
  // terminal, through Claude Code), macOS hands it activation as its first window appears. So the
  // card appears as a background-only app, which can't be activated, and only then becomes an
  // accessory app (no Dock icon), which activates when you click it.
  var previous = $.NSWorkspace.sharedWorkspace.frontmostApplication
  app.setActivationPolicy(2)                    // prohibited (background-only)

  var dark = spec.appearance ? spec.appearance === 'dark'
    : app.effectiveAppearance.bestMatchFromAppearancesWithNames($(['NSAppearanceNameAqua', 'NSAppearanceNameDarkAqua'])).js === 'NSAppearanceNameDarkAqua'
  var opts = spec.options || []
  var L = layoutCard(spec, dark)
  var state = { selected: 0, typed: '', armed: false, pressed: -1, wantField: false }
  for (var i = 0; i < opts.length; i++) if (opts[i].recommended) { state.selected = i; break }

  function pick(i) { emit({ answer: String(opts[i].label), index: i }) }
  function submit() {
    var t = String(field.stringValue.js || '').trim()
    if (t) emit({ answer: t, typed: true })
    if (opts.length) pick(state.selected)
  }

  var comp = loadCompanion(spec.companion)
  var extraW = comp ? Math.max(0, comp.w - comp.overlap) : 0
  var winW = L.w + extraW, winH = Math.max(L.h, comp ? comp.h : 0)

  // Notch: the screen with a top safe-area inset (the notch), else the main screen; flush to its top
  // edge so the card reads as the notch growing down. Cursor: just below-right of the pointer.
  var mouse = $.NSEvent.mouseLocation
  var screens = $.NSScreen.screens, screen = null
  for (var s = 0; s < screens.count; s++) {
    var sc = screens.objectAtIndex(s), fr = sc.frame
    if (spec.at === 'cursor') {
      if (mouse.x >= fr.origin.x && mouse.x < fr.origin.x + fr.size.width &&
          mouse.y >= fr.origin.y && mouse.y < fr.origin.y + fr.size.height) { screen = sc; break }
    } else if (sc.safeAreaInsets.top > 0) { screen = sc; break }
  }
  if (!screen) screen = $.NSScreen.mainScreen
  var sf = screen.frame, ox, oy
  if (spec.at === 'cursor') {
    var vf = screen.visibleFrame
    ox = mouse.x + 14; oy = mouse.y - 18 - winH
    ox = Math.min(Math.max(ox, vf.origin.x + 8), vf.origin.x + vf.size.width - winW - 8)
    oy = Math.min(Math.max(oy, vf.origin.y + 8), vf.origin.y + vf.size.height - winH - 8)
  } else if (spec.at === 'offscreen') {   // tests: a real window that is never on any display
    ox = -20000; oy = -20000
  } else {
    ox = sf.origin.x + sf.size.width / 2 - L.w / 2; oy = sf.origin.y + sf.size.height - winH
  }
  var scale = screen.backingScaleFactor || 2

  // The panel refuses to become key until it is clicked: macOS can't hand it the keyboard on its own.
  ObjC.registerSubclass({
    name: 'AskNotchPanel', superclass: 'NSPanel',
    methods: {
      'canBecomeKeyWindow': { types: ['bool', []], implementation: function () { return state.armed } },
      'canBecomeMainWindow': { types: ['bool', []], implementation: function () { return false } },
      'becomeKeyWindow': {
        types: ['void', []],
        implementation: function () {
          ObjC.super(this).becomeKeyWindow
          // Becoming key focuses the text box, which would turn 1-4 into typed text: only a click on
          // the box itself should focus it.
          this.makeFirstResponder(state.wantField ? field : $())
          if (spec.debug) log('became-key')
        },
      },
      'sendEvent:': {
        types: ['void', ['id']],
        implementation: function (ev) {
          var handled = false
          try { handled = onEvent(ev) } catch (e) { log('card: ' + e) }
          if (!handled) ObjC.super(this).sendEvent(ev)
          if (Number(ev.type) === 10) syncPlaceholder()
        },
      },
    },
  })
  ObjC.registerSubclass({
    name: 'AskNotchHover', superclass: 'NSObject',
    methods: {
      'mouseMoved:': { types: ['void', ['id']], implementation: function (ev) { hover(ev) } },
      'mouseEntered:': { types: ['void', ['id']], implementation: function (ev) { hover(ev) } },
      'mouseExited:': { types: ['void', ['id']], implementation: function (ev) {} },
    },
  })

  var panel = $.AskNotchPanel.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(ox, oy, winW, winH), 1 << 7 /* borderless, non-activating panel */, 2 /* buffered */, false)
  panel.opaque = false
  panel.backgroundColor = $.NSColor.clearColor
  panel.hasShadow = true
  panel.level = 101                                   // pop-up menu level: above the menu bar, so it can sit in the notch
  panel.collectionBehavior = 1 | 256 | 8            // all Spaces · over full-screen apps · transient
  panel.movableByWindowBackground = false
  panel.becomesKeyOnlyIfNeeded = false
  panel.hidesOnDeactivate = false
  panel.releasedWhenClosed = false
  panel.appearance = $.NSAppearance.appearanceNamed(dark ? 'NSAppearanceNameDarkAqua' : 'NSAppearanceNameAqua')

  var content = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, winW, winH))
  content.wantsLayer = true
  panel.contentView = content

  // Layer-hosting view: the companion behind, the card in front.
  var stage = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, winW, winH))
  var root = $.CALayer.layer
  stage.layer = root
  stage.wantsLayer = true
  content.addSubview(stage)

  var compLayer = null
  if (comp) {
    compLayer = $.CALayer.layer
    compLayer.frame = $.NSMakeRect(L.w - comp.overlap, winH - L.h, comp.w, comp.h)
    compLayer.contentsGravity = 'resize'
    compLayer.actions = $({ contents: $.NSNull.null })
    root.addSublayer(compLayer)
  }

  var cardLayer = $.CALayer.layer
  cardLayer.anchorPoint = $.NSMakePoint(0.5, 1)
  cardLayer.bounds = $.NSMakeRect(0, 0, L.w, L.h)
  cardLayer.position = $.NSMakePoint(L.w / 2, winH)
  cardLayer.contentsScale = scale
  cardLayer.actions = $({ contents: $.NSNull.null })
  root.addSublayer(cardLayer)
  function repaint() { cardLayer.contents = imageOf(paintCard(spec, L, state, scale), L.w, L.h) }
  repaint()

  // The text box: an ordinary borderless field over the painted box. It draws only typed text.
  var f = L.field
  var fieldH = Math.ceil(L.field.lineH) + 2
  var field = $.NSTextField.alloc.initWithFrame($.NSMakeRect(f.x + 11 - 2, winH - (f.y + (f.h + fieldH) / 2), f.w - 22 + 4, fieldH))
  field.bordered = false
  field.bezeled = false
  field.drawsBackground = false
  field.focusRingType = 1                            // none
  field.font = L.fonts.field
  field.textColor = color(L.p.text)
  field.cell.usesSingleLineMode = true
  field.cell.scrollable = true
  content.addSubview(field)
  var fieldRect = { x: f.x, y: f.y, w: f.w, h: f.h }

  // Where an event lands, in card points (y down); null when outside the card.
  function at(ev) {
    var pt = ev.locationInWindow
    var x = pt.x, y = winH - pt.y
    return (x >= 0 && x < L.w && y >= 0 && y < L.h) ? { x: x, y: y } : null
  }
  function rowAt(pt) {
    if (!pt) return -1
    for (var i = 0; i < L.rows.length; i++) {
      var r = L.rows[i]
      if (pt.x >= r.x && pt.x < r.x + r.w && pt.y >= r.y && pt.y < r.y + r.h) return i
    }
    return -1
  }
  function inField(pt) {
    return pt && pt.x >= fieldRect.x && pt.x < fieldRect.x + fieldRect.w && pt.y >= fieldRect.y && pt.y < fieldRect.y + fieldRect.h
  }
  function select(i) { if (i >= 0 && i !== state.selected) { state.selected = i; repaint() } }
  function hover(ev) { select(rowAt(at(ev))) }
  function fieldFocused() { return !field.currentEditor.isNil() }
  function syncPlaceholder() {
    var t = field.stringValue.js || ''
    if ((t === '') !== (state.typed === '')) { state.typed = t; repaint() } else state.typed = t
  }
  // Clicking the card is the user choosing it, so only then does it take the keyboard. macOS
  // delivers keys to the active app, so activate as well as becoming key. When the card closes,
  // focus returns to the previous app.
  function takeKeys() {
    if (state.armed && panel.keyWindow && app.active) return
    state.armed = true
    app.setActivationPolicy(1)
    app.activateIgnoringOtherApps(true)
    panel.makeKeyWindow
  }

  var T = { down: 1, up: 2, key: 10 }
  function onEvent(ev) {
    var type = Number(ev.type)                       // the bridge hands enums over as strings
    if (type === T.down) {
      var pt = at(ev), row = rowAt(pt)
      if (row >= 0) { state.pressed = row; select(row); return true }   // one click answers (on release)
      if (!pt) return false
      state.wantField = inField(pt)
      takeKeys()
      if (!state.wantField) { panel.makeFirstResponder($()); return true }
      panel.makeFirstResponder(field)                   // a click on the box types there, even the first one
      return false
    }
    if (type === T.up && state.pressed >= 0) {
      var r = rowAt(at(ev)), was = state.pressed
      state.pressed = -1
      if (r === was) pick(r)
      return true
    }
    if (type === T.key) {
      var code = Number(ev.keyCode)
      if (code === 53) emit({ cancelled: true, reason: 'esc' })
      if (code === 125) { select(Math.min(state.selected + 1, Math.max(0, opts.length - 1))); return true }
      if (code === 126) { select(Math.max(state.selected - 1, 0)); return true }
      if (fieldFocused()) {
        if (code === 36 || code === 76) { submit(); return true }
        return false                                   // the text box types it
      }
      if ((code === 36 || code === 76) && opts.length) pick(state.selected)
      var c = ev.charactersIgnoringModifiers.js
      var n = parseInt(c, 10)
      if (/^[1-9]$/.test(c) && n >= 1 && n <= opts.length) pick(n - 1)
      return false
    }
    return false
  }

  var hoverOwner = $.AskNotchHover.alloc.init
  content.addTrackingArea($.NSTrackingArea.alloc.initWithRectOptionsOwnerUserInfo(
    $.NSMakeRect(0, 0, winW, winH),
    0x01 | 0x02 | 0x80 | 0x200,                        // entered/exited · moved · even when inactive · whole view
    hoverOwner, $()))

  // Show without taking focus or activating, then drop in: scale up from the top edge with a spring.
  panel.orderFrontRegardless
  panel.makeFirstResponder($())
  after(0.2, function () { if (!state.armed) app.setActivationPolicy(1) })   // accessory
  var spring = function (keyPath, from, to) {
    var a = $.CASpringAnimation.animationWithKeyPath(keyPath)
    a.mass = 1; a.stiffness = 385.6; a.damping = 32.2     // SwiftUI .spring(response: 0.32, dampingFraction: 0.82)
    a.fromValue = $(from); a.toValue = $(to)
    a.duration = a.settlingDuration
    return a
  }
  cardLayer.addAnimationForKey(spring('transform.scale', 0.92, 1), 'drop')
  cardLayer.addAnimationForKey(spring('opacity', 0, 1), 'fade')
  after(0.6, function () { panel.invalidateShadow })

  // Companion: hop in once the card has landed, sit while waiting, settle down after a while.
  if (comp) {
    function play(frames, done) {
      var i = 0
      ;(function next() {
        if (i >= frames.length) return done && done()
        var fr = frames[i++]
        compLayer.contents = fr.img
        after(fr.ms / 1000, next)
      })()
    }
    after(comp.introDelay / 1000, function () {
      play(comp.intro, function () {
        compLayer.contents = comp.idle
        if (comp.settle.length && comp.settleAfter > 0) after(comp.settleAfter, function () { play(comp.settle) })
      })
    })
  }

  // Safety net: if macOS activates the card anyway before it's clicked, hand activation straight
  // back to the app you were using.
  $.NSNotificationCenter.defaultCenter.addObserverForNameObjectQueueUsingBlock(
    'NSApplicationDidBecomeActiveNotification', app, $(), function () {
      if (spec.debug) log('became-active armed=' + state.armed)
      if (!state.armed && previous && !previous.isNil()) previous.activateWithOptions(0)
    })
  if (spec.debug) {
    after(0.05, function () { log('t=0.05 active=' + app.active + ' key=' + panel.keyWindow) })
    after(1, function () { log('t=1 active=' + app.active + ' key=' + panel.keyWindow) })
  }
  var timeout = typeof spec.timeout === 'number' && spec.timeout > 0 ? spec.timeout : DEFAULT_TIMEOUT_S
  after(timeout, function () { emit({ cancelled: true, reason: 'timeout' }) })

  app.run
}

function after(seconds, fn) {
  $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(Math.max(0, seconds), false, function () {
    try { fn() } catch (e) { log('card: ' + e) }
  })
}

// The question arrives as JSON on standard input (the mod writes it there); an argument works too.
function readStdin() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
  var str = $.NSString.alloc.initWithDataEncoding(data, 4)
  return str.isNil() ? '' : str.js
}

function run(argv) {
  var spec
  try { spec = JSON.parse(argv && argv[0] ? argv[0] : readStdin()) } catch (e) { spec = null }
  if (!spec || typeof spec.question !== 'string') {
    log("usage: echo '<json>' | osascript -l JavaScript card.js")
    $.exit(2)
  }
  main(spec)
}
