// Ask Notch: Claude's questions as a native card at the notch.
//
// Claude's AskUserQuestion is answered from helper/card.js, a one-shot window drawn by macOS's
// built-in script runner (osascript, JavaScript for Automation). Esc at the card, a timeout, or a
// card that can't start falls back to Claude Code's own dialog, so a question is never lost.

const CARD_TIMEOUT_S = 540
const COMPANIONS = ['cat', 'off']

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'notch',
        description: 'Claude questions at the notch: on · off · notch · cursor · companion · test',
        argumentHint: '[on|off|notch|cursor|companion cat|companion off|test]',
        immediate: true,
      })
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'notch' }, async ($, e) => {
    const cfg = await loadCfg($)
    const [arg = '', value = ''] = (e.args || '').trim().split(/\s+/)
    if (arg === 'on' || arg === 'off') cfg.on = arg === 'on'
    else if (arg === 'notch' || arg === 'cursor') cfg.at = arg
    else if (arg === 'companion') {
      if (!COMPANIONS.includes(value)) return { text: 'Companion is ' + cfg.companion + ' · /notch companion cat|off' }
      cfg.companion = value
    } else if (arg === 'test') {
      const r = await showCard($, {
        question: 'Notch cards are working. Keep Claude\'s questions here?',
        options: [
          { label: 'Keep them here', detail: 'Questions drop from the notch', recommended: true },
          { label: 'Beside the cursor', detail: 'Card opens where you are pointing' },
        ],
      }, cfg)
      return { text: 'test card → ' + JSON.stringify(r) }
    }
    await $.store.set('cfg', cfg)
    return { text: 'Notch cards ' + (cfg.on ? 'on' : 'off') + ' · at ' + cfg.at + ' · companion ' + cfg.companion }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const cfg = await loadCfg($)
    const qs = e.questions || []
    // The card answers single-choice questions; multi-select, text and number go to Claude Code's form.
    if (!cfg.on || !qs.length || qs.some((q) => q.multiSelect || (q.kind && q.kind !== 'choice'))) return next(e)

    // Same shape as Claude Code's own dialog result: question text -> chosen label (or typed text).
    const answers = {}
    for (const q of qs) {
      const r = await showCard($, {
        title: q.header ? 'Claude asks · ' + q.header : undefined,
        question: q.question,
        options: (q.options || []).map((o) => ({
          label: String(o.label).replace(/\s*\(recommended\)\s*$/i, ''),
          detail: o.description,
          recommended: /\(recommended\)\s*$/i.test(String(o.label)),
        })),
      }, cfg)
      // Dismissed, timed out, or the card failed: hand the whole question set to Claude Code's dialog.
      if (!r || r.cancelled || !r.answer) return next(e)
      answers[q.question] = r.answer
    }
    return { result: { questions: qs, answers } }
  })
}

async function loadCfg($) {
  const saved = await $.store.get('cfg')
  const cfg = { on: true, at: 'notch', companion: 'off', ...(saved || {}) }
  if (!COMPANIONS.includes(cfg.companion)) cfg.companion = 'off'
  return cfg
}

async function showCard($, spec, cfg) {
  const companion = cfg.companion === 'cat' ? { name: 'cat', dir: 'assets/companion/cat' } : undefined
  $.ui.status('question waiting at the ' + cfg.at)
  try {
    // Always the same command: macOS's own osascript running this plugin's helper/card.js. The question
    // goes to it on standard input; its answer comes back on standard output. Nothing leaves the Mac.
    const r = await $.process.run(['/usr/bin/osascript', '-l', 'JavaScript', 'helper/card.js'], {
      cwd: $.plugin.root,
      stdin: JSON.stringify({ ...spec, at: cfg.at, source: 'Claude Code', timeout: CARD_TIMEOUT_S, companion }),
      timeoutMs: (CARD_TIMEOUT_S + 15) * 1000,
    })
    const line = r.stdout.trim().split('\n').pop()
    return line ? JSON.parse(line) : null
  } catch {
    return null
  } finally {
    $.ui.status(undefined)
  }
}
