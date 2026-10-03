import { expect, test } from 'claude-code/testing'

const ask = {
  tool: 'AskUserQuestion',
  questions: [{
    question: 'Which layout?', header: 'Layout', multiSelect: false,
    options: [{ label: 'Spacious (Recommended)', description: 'More room' }, { label: 'Compact', description: 'Denser' }],
  }],
}

// A store that keeps what the plugin saves, so a /notch setting reaches the next card.
function base(on: any, saved?: unknown) {
  let cfg = saved
  on('store.get', () => ({ value: cfg }))
  on('store.set', (_$: any, e: any) => { cfg = e.value; return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
}

test('a picked card answers the question without Claude Code\'s dialog', async ($, on) => {
  base(on)
  let argv: string[] = []
  on('process.run', (_$, e) => { argv = e.argv; return { value: { exitCode: 0, stdout: '{"answer":"Compact","index":1}\n', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  const r = await $.tool.call(ask as any)
  expect((r.result as any).answers).toEqual({ 'Which layout?': 'Compact' })
  // The card is a readable script run by macOS's own osascript, not a compiled helper.
  expect(argv.slice(0, 3)).toEqual(['/usr/bin/osascript', '-l', 'JavaScript'])
  expect(argv[3].endsWith('/helper/card.js')).toBe(true)
  const spec = JSON.parse(argv[4])
  expect(spec.options[0]).toEqual({ label: 'Spacious', detail: 'More room', recommended: true })
  expect(spec.title).toBe('Claude asks · Layout')
  expect(spec.at).toBe('notch')
  expect(spec.timeout).toBe(540)
  expect(spec.companion).toBeUndefined()
})

test('a typed answer is returned as typed', async ($, on) => {
  base(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"answer":"Roomy, but denser","typed":true}\n', stderr: '' } }))
  on('tool.call', () => ({ result: 'DIALOG' }))
  const r = await $.tool.call(ask as any)
  expect((r.result as any).answers).toEqual({ 'Which layout?': 'Roomy, but denser' })
})

test('esc at the card falls back to Claude Code\'s dialog', async ($, on) => {
  base(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"cancelled":true,"reason":"esc"}\n', stderr: '' } }))
  on('tool.call', () => ({ result: 'DIALOG' }))
  expect((await $.tool.call(ask as any)).result).toBe('DIALOG')
})

test('a card that cannot start falls back to Claude Code\'s dialog', async ($, on) => {
  base(on)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'execution error' } }))
  on('tool.call', () => ({ result: 'DIALOG' }))
  expect((await $.tool.call(ask as any)).result).toBe('DIALOG')
})

test('multi-select skips the card', async ($, on) => {
  base(on)
  let ran = false
  on('process.run', () => { ran = true; return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  const multi = { ...ask, questions: [{ ...ask.questions[0], multiSelect: true }] }
  expect((await $.tool.call(multi as any)).result).toBe('DIALOG')
  expect(ran).toBe(false)
})

test('/notch off hands questions to Claude Code', async ($, on) => {
  base(on)
  let ran = false
  on('process.run', () => { ran = true; return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  const { text } = await $.command.run({ command: 'notch', args: 'off' })
  expect(text).toContain('off')
  expect((await $.tool.call(ask as any)).result).toBe('DIALOG')
  expect(ran).toBe(false)
})

test('/notch companion cat puts the cat beside the card', async ($, on) => {
  base(on)
  let argv: string[] = []
  on('process.run', (_$, e) => { argv = e.argv; return { value: { exitCode: 0, stdout: '{"answer":"Compact","index":1}\n', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  const { text } = await $.command.run({ command: 'notch', args: 'companion cat' })
  expect(text).toContain('companion cat')
  await $.tool.call(ask as any)
  const spec = JSON.parse(argv[4])
  expect(spec.companion.name).toBe('cat')
  expect(spec.companion.dir.endsWith('/assets/companion/cat')).toBe(true)
})

test('/notch companion off and unknown companions', async ($, on) => {
  base(on, { on: true, at: 'cursor', companion: 'cat' })
  let argv: string[] = []
  on('process.run', (_$, e) => { argv = e.argv; return { value: { exitCode: 0, stdout: '{"answer":"Compact","index":1}\n', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  expect((await $.command.run({ command: 'notch', args: 'companion dragon' })).text).toContain('Companion is cat')
  await $.command.run({ command: 'notch', args: 'companion off' })
  await $.tool.call(ask as any)
  const spec = JSON.parse(argv[4])
  expect(spec.companion).toBeUndefined()
  expect(spec.at).toBe('cursor')
})
