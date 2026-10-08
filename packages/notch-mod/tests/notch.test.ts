import { expect, mock, test } from 'claude-code/testing'

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
  let stdin = ''
  on('process.run', (_$, e) => { argv = e.argv; stdin = e.init?.stdin ?? ''; return { value: { exitCode: 0, stdout: '{"answer":"Compact","index":1}\n', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  const r = await $.tool.call(ask as any)
  expect((r.result as any).answers).toEqual({ 'Which layout?': 'Compact' })
  // The card is a readable script run by macOS's own osascript, not a compiled helper.
  expect(argv.slice(0, 3)).toEqual(['/usr/bin/osascript', '-l', 'JavaScript'])
  expect(argv[3]).toBe('helper/card.js')
  const spec = JSON.parse(stdin)
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
  let stdin = ''
  on('process.run', (_$, e) => { argv = e.argv; stdin = e.init?.stdin ?? ''; return { value: { exitCode: 0, stdout: '{"answer":"Compact","index":1}\n', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  const { text } = await $.command.run({ command: 'notch', args: 'companion cat' })
  expect(text).toContain('companion cat')
  await $.tool.call(ask as any)
  const spec = JSON.parse(stdin)
  expect(spec.companion.name).toBe('cat')
  expect(spec.companion.dir).toBe('assets/companion/cat')
})

test('/notch companion off and unknown companions', async ($, on) => {
  base(on, { on: true, at: 'cursor', companion: 'cat' })
  let argv: string[] = []
  let stdin = ''
  on('process.run', (_$, e) => { argv = e.argv; stdin = e.init?.stdin ?? ''; return { value: { exitCode: 0, stdout: '{"answer":"Compact","index":1}\n', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))
  await $.command.run({ command: 'notch', args: 'companion off' })
  await $.tool.call(ask as any)
  const spec = JSON.parse(stdin)
  expect(spec.companion).toBeUndefined()
  expect(spec.at).toBe('cursor')
})

test('/notch in plain words is handed to Claude, who changes it through the settings tool', async ($, on) => {
  base(on)
  const clock = mock.clock(on)
  let asked = ''
  let stdin = ''
  on('prompt.submit', (_$: any, e: any) => { asked = e.text; return { drop: 'captured by the test' } })
  on('process.run', (_$, e) => { stdin = e.init?.stdin ?? ''; return { value: { exitCode: 0, stdout: '{"answer":"Compact","index":1}\n', stderr: '' } } })
  on('tool.call', () => ({ result: 'DIALOG' }))

  const { text } = await $.command.run({ command: 'notch', args: 'put it by my mouse and bring the kitty' })
  expect(text).toContain('asking Claude')
  await clock.advance(60)
  expect(asked).toContain('/notch put it by my mouse and bring the kitty')
  expect(asked).toContain('mcp__ask-notch__settings')

  // What Claude would then call: the change lands on the next card.
  const r = await $.tool.call({ tool: 'mcp__ask-notch__settings', at: 'cursor', companion: 'cat' } as any)
  expect(String(r.result)).toContain('at cursor · companion cat')
  await $.tool.call(ask as any)
  const spec = JSON.parse(stdin)
  expect(spec.at).toBe('cursor')
  expect(spec.companion.name).toBe('cat')
})

test('bare /notch reads the settings and the tool with no fields changes nothing', async ($, on) => {
  base(on, { on: false, at: 'notch', companion: 'off' })
  on('tool.call', () => ({ result: 'DIALOG' }))
  expect((await $.command.run({ command: 'notch', args: '' })).text).toContain('Notch cards off')
  expect(String((await $.tool.call({ tool: 'mcp__ask-notch__settings' } as any)).result)).toContain('Notch cards off · at notch')
})

test('while cards are on, Claude is told to ask its choices at the notch; off, it is not', async ($, on) => {
  base(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] }))
  const ids = async () => (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as any)).sections.map((x: any) => x.id)
  expect(await ids()).toEqual(['intro', 'ask-notch:choices'])
  await $.command.run({ command: 'notch', args: 'off' })
  expect(await ids()).toEqual(['intro'])
})
