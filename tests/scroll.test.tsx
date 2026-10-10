import { expect, mock, test } from 'claude-code/testing'

import { settleQuietly, toLatest } from '../hooks/scroll'
import { BAND, EN, JA, PANE, PICKER_PANE, PLUGIN, SURFACES, reselect, runCommand, stage, start } from './stage'

// Every way an action runs (an icon, the ⋯ dialog, the command) goes through
// run() in register.tsx, which opens the pane and then awaits
// settleQuietly($.ui.scroll(toLatest(PANE))): the pane is brought back to its
// top, where the newest result is drawn.
//
// The test kit has no implementation of a plugin's own $.ui.scroll (it
// rejects with "no implementation for ui.scroll", and a test's ui.scroll hook
// is not reached by it). So what the scroll asks for and how it settles are
// checked on toLatest and settleQuietly, and the runs below check through the
// kit that every way still runs the action, with the newest result first.

test('the scroll asks for the start (top) of the pane', () => {
  expect(toLatest(PLUGIN)).toEqual({ in: PLUGIN, to: 'start' })
})

test('a refused scroll settles quietly', async () => {
  await expect(settleQuietly(Promise.resolve({ deny: 'no such site' }))).resolves.toBeUndefined()
})

test('a rejected scroll settles quietly', async () => {
  await expect(settleQuietly(Promise.reject(new Error('no implementation for ui.scroll')))).resolves.toBeUndefined()
})

// The pane as the person left it: scrolled down to older results.
const scrolledDown = { ...PANE.props, scroll: { offset: 12, bodyRows: 4 } }

// The running text is checked gone in both languages: with the language left
// to `auto` the test would see English, and the Japanese check would pass on
// nothing.
for (const [surface, options, thinking] of SURFACES.flatMap(
  sf => [[sf, JA, '考え中…'], [sf, EN, 'Thinking…']] as const,
)) {
  test(`[${surface}] [${options.language}] an icon press runs on and the newest result is drawn first`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const pane = await $.ui.mount({ ...PANE, surface, props: scrolledDown })
    const band = await $.ui.mount({ ...BAND, surface })
    await reselect(s, clock)
    await band.press({ key: 'explain' })
    await reselect(s, clock)
    await band.press({ key: 'translate' })

    const texts = (await pane.findAll({ text: /answer from/ })).filter(f => f.type === 'Text')
    expect(texts.map(t => t.text)).toEqual(['answer from haiku', 'answer from sonnet'])
    expect(await pane.find({ text: thinking })).toBeUndefined()
    await band.unmount()
    await pane.unmount()
  })
}

// The hint line's order moves with use, so its buttons carry no number keys:
// a key that ran another action after a reorder would surprise the person.
test('the hint line buttons carry no hotkey', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const buttons = await band.findAll({ type: 'Button' })
  expect(buttons.length).toBeGreaterThan(0)
  for (const b of buttons) expect(b.props.hotkey).toBeUndefined()
  await band.unmount()
})

test('a pick in the ⋯ dialog runs on and the newest result is drawn first', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  await clock.advance(400)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: scrolledDown })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'explain' })
  await reselect(s, clock)
  await band.press({ key: '_more' })
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.select({ key: 'picker', value: 'translate' })
  const texts = (await pane.findAll({ text: /answer from/ })).filter(f => f.type === 'Text')
  expect(texts.map(t => t.text)).toEqual(['answer from haiku', 'answer from sonnet'])
  await picker.unmount()
  await band.unmount()
  await pane.unmount()
})

test('the command runs on and the newest result is drawn first', async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'Bonjour'

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: scrolledDown })
  await runCommand($, 'explain')
  await runCommand($, 'translate')
  const texts = (await pane.findAll({ text: /answer from/ })).filter(f => f.type === 'Text')
  expect(texts.map(t => t.text)).toEqual(['answer from haiku', 'answer from sonnet'])
  await pane.unmount()
})
