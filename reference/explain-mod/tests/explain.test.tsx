import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = {
  plugin: 'explain',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const
const PANE = {
  plugin: 'explain',
  component: 'Pane',
  requestId: 'explain',
  props: { title: 'Explain', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

type Stage = { selected: string | null; models: { model: string; system?: string; prompt: string }[]; spawned: string[]; forks: string[] }

const stage = (on: On): Stage => {
  const s: Stage = { selected: null, models: [], spawned: [], forks: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.selection', () => ({ value: s.selected === null ? undefined : { text: s.selected } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('agent.register', () => ({ value: { agent: 'explain:code-finder' } }))
  on('agent.spawn', (_$, e) => {
    s.spawned.push(JSON.stringify(e))
    return { model: 'sonnet', agentId: 'agent-1' }
  })
  on('model.complete', (_$, e) => {
    s.models.push({ model: e.model, system: e.system, prompt: e.prompt })
    return { value: { isAnswered: true, text: `answer from ${e.model}`, usage } }
  })
  on('model.fork', (_$, e) => {
    s.forks.push(e.prompt)
    return { value: { isAnswered: true, text: 'answer in context', usage } }
  })
  return s
}

const start = ($: Engine) =>
  $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

test('icons take the hint line only while text is selected', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)

  await clock.advance(400)
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  await band.unmount()

  s.selected = 'ECONNREFUSED 127.0.0.1:3306'
  await clock.advance(400)
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const icons = (await band.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(icons).toEqual(['💡', '🌐', '🔎', '💬', '✕'])
  expect(await band.find({ text: /ECONNREFUSED/ })).toBeUndefined()
  await band.unmount()
})

test('meaning and translation land in the pane, each on its model', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'Permission denied (publickey)'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'meaning' })
  await band.press({ key: 'translate' })

  expect(s.models.map(m => m.model)).toEqual(['sonnet', 'haiku'])
  expect(s.models[0]?.prompt).toContain('Permission denied (publickey)')

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
  expect(await pane.find({ text: 'answer from haiku' })).toBeDefined()
})

// The subagent's id is set by core alone, so a test cannot start one: this
// checks the request; its answer arrives through turn.complete in a session.
test('code evidence asks the read-only finder about the selection', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'graph-engine: node is not executable'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'code' })

  expect(s.spawned[0]).toContain('explain:code-finder')
  expect(s.spawned[0]).toContain('graph-engine: node is not executable')
})

test('ask forks the session; dismiss hides the icons for that selection', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  await clock.advance(400)

  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'ask' })
  expect(s.forks[0]).toContain('exit 137')

  await band.press({ key: 'close' })
  await band.unmount()
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Button' })).toBeUndefined()
})
