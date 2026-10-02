import { expect, test } from 'claude-code/testing'

const ask = {
  tool: 'AskUserQuestion',
  questions: [{
    question: 'Which layout?', header: 'Layout', multiSelect: false,
    options: [{ label: 'Spacious (Recommended)', description: 'More room' }, { label: 'Compact', description: 'Denser' }],
  }],
}

function base(on: any) {
  on('store.get', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
}

test('a picked card answers the question without Claude Code\'s dialog', async ($, on) => {
  base(on)
  let argv: string[] = []
  on('process.run', (_$, e) => { argv = e.argv; return { value: { exitCode: 0, stdout: '{"answer":"Compact","index":1}\n', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  const r = await $.tool.call(ask as any)
  expect((r.result as any).answers).toEqual({ 'Which layout?': 'Compact' })
  const spec = JSON.parse(argv[1])
  expect(spec.options[0]).toEqual({ label: 'Spacious', detail: 'More room', recommended: true })
})

test('esc at the card falls back to Claude Code\'s dialog', async ($, on) => {
  base(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"cancelled":true,"reason":"esc"}\n', stderr: '' } }))
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
