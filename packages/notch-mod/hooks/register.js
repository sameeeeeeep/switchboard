// switchboard-notch — Claude's questions as a native card at the notch.
//
// Claude's AskUserQuestion is answered from bin/sb-card, a one-shot native window that drops from
// the notch (or opens beside the cursor). Esc at the card, a timeout, or a missing helper falls back
// to Claude Code's own dialog, so a question is never lost.

const CARD_TIMEOUT_S = 540

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'notch',
        description: 'Claude questions at the notch: on · off · notch · cursor · test',
        argumentHint: '[on|off|notch|cursor|test]',
        immediate: true,
      })
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'notch' }, async ($, e) => {
    const cfg = await loadCfg($)
    const arg = (e.args || '').trim()
    if (arg === 'on' || arg === 'off') cfg.on = arg === 'on'
    else if (arg === 'notch' || arg === 'cursor') cfg.at = arg
    else if (arg === 'test') {
      const r = await showCard($, {
        question: 'Notch cards are working. Keep Claude\'s questions here?',
        options: [
          { label: 'Keep them here', detail: 'Questions drop from the notch', recommended: true },
          { label: 'Beside the cursor', detail: 'Card opens where you are pointing' },
        ],
      }, cfg.at)
      return { text: 'test card → ' + JSON.stringify(r) }
    }
    await $.store.set('cfg', cfg)
    return { text: 'Notch cards ' + (cfg.on ? 'on' : 'off') + ' · at ' + cfg.at }
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
      }, cfg.at)
      // Dismissed, timed out, or helper failed: hand the whole question set to Claude Code's dialog.
      if (!r || r.cancelled || !r.answer) return next(e)
      answers[q.question] = r.answer
    }
    return { result: { questions: qs, answers } }
  })
}

async function loadCfg($) {
  const saved = await $.store.get('cfg')
  return { on: true, at: 'notch', ...(saved || {}) }
}

async function showCard($, spec, at) {
  $.ui.status('question waiting at the ' + at)
  try {
    const r = await $.process.run(
      [$.plugin.root + '/bin/sb-card', JSON.stringify({ ...spec, at, source: 'Claude Code', timeout: CARD_TIMEOUT_S })],
      { timeoutMs: (CARD_TIMEOUT_S + 15) * 1000 },
    )
    const line = r.stdout.trim().split('\n').pop()
    return line ? JSON.parse(line) : null
  } catch {
    return null
  } finally {
    $.ui.status(undefined)
  }
}
