import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, needsSelection } from '../hooks/actions'
import { FIXED_ROWS, MIN_SHOWN, buttonLines, linesOf } from '../hooks/picker-rows'
import { MESSAGES } from '../hooks/i18n'
import { closesWhole } from '../hooks/register'
import { BAND, EN, JA, PANE, PICKER, PICKER_ARG, PICKER_CLOSE, PICKER_FILTER, PICKER_PANE, listedActions, listedCount, listedOptions, pickAction, PLUGIN, SURFACES, runCommand, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// The right pane (SELM-00050): always two tabs, "Quick Actions" (the
// results) and "Select an action" (the ⋯ dialog), opened together with the
// same options; closed together by any one close of the person's; the
// dialog's list as tall as the pane; and usable while an AskUserQuestion
// dialog is up.

const SELECTED = 'ECONNREFUSED 127.0.0.1:3306'
const ROWS = Math.min(ACTIONS.length + 6, 30)

async function select(s: Stage, clock: Clock, text: string | null) {
  s.selected = text
  await clock.advance(400)
}

/** Runs `id` from the hint line, on the text selected now. */
async function pressOnLine($: Engine, id: string) {
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: id })
  await band.unmount()
}


// ---------------------------------------------------------------------------
// Two tabs, opened alike

test('a run opens both tabs, the results shown; every open asks the same of each', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  await pressOnLine($, 'explain')

  expect(s.opened.map(o => o.id)).toEqual([PICKER, PANE.requestId])
  expect(s.panes).toEqual([PICKER, PANE.requestId])
  expect(s.shown).toBe(PANE.requestId)
  expect(s.opened.find(o => o.id === PICKER)?.title).toBe('アクションを選択')
  expect(s.opened.find(o => o.id === PANE.requestId)?.title).toBe('Quick Actions')
  // No keyboard asked for by a run; both close on Escape, at one width and one inline height.
  for (const o of s.opened) expect(o).toEqual({ id: o.id, title: o.title, closeOnEscape: true, columns: 56 })
  expect(s.rows).toEqual({ [PICKER]: ROWS, [PANE.requestId]: ROWS })

  // A second run opens them again with the same options: none lost on the way.
  await select(s, clock, null)
  await select(s, clock, 'exit 137')
  await pressOnLine($, 'summarize')
  expect(s.opened).toHaveLength(4)
  for (const o of s.opened) {
    expect(o.closeOnEscape).toBe(true)
    expect(o.columns).toBe(56)
    expect(o.focus).toBeUndefined()
  }
  expect(s.rows).toEqual({ [PICKER]: ROWS, [PANE.requestId]: ROWS })
  expect(s.shown).toBe(PANE.requestId)
})

for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
  test(`[${options.language}] /quick-actions opens both tabs on "${t.pickerTitle}", which alone asks for the keys`, { options }, async ($, on) => {
    const s = stage(on)
    await start($)
    await runCommand($, '')
    expect(s.opened.map(o => [o.id, o.title, o.focus])).toEqual([
      [PANE.requestId, 'Quick Actions', undefined],
      [PICKER, t.pickerTitle, true],
    ])
    expect(s.shown).toBe(PICKER)
    expect(s.rows).toEqual({ [PICKER]: ROWS, [PANE.requestId]: ROWS })
  })
}

test('a pick in the dialog keeps its tab, its text and an empty filter, and shows the results', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  await runCommand($, '')

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.input({ key: PICKER_FILTER, text: 'explain', kind: 'change' })
  await pickAction(picker, 'explain')
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
  expect(s.models.at(-1)?.prompt).toContain(SELECTED)
  // Still the dialog, its filter emptied, on the same text: a second pick runs on it too.
  expect((await picker.find({ key: PICKER_FILTER }))?.props.value).toBe('')
  await pickAction(picker, 'tldr')
  expect(s.models.at(-1)?.prompt).toContain(SELECTED)
  await picker.unmount()
})

test('a tab an open leaves behind the other is closed and opened afresh, so it shows', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  // A host where an open of an open id only retitles it.
  s.reopenShows = false
  await start($)
  await select(s, clock, SELECTED)
  await pressOnLine($, 'explain')
  expect(s.shown).toBe(PANE.requestId)

  await runCommand($, '')
  expect(s.shown).toBe(PICKER)
  // The plugin's own close of the dialog's tab took nothing else with it.
  expect(s.closed).toEqual([PICKER])
  expect(s.panes.sort()).toEqual([PANE.requestId, PICKER].sort())

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'tldr')
  await picker.unmount()
  expect(s.shown).toBe(PANE.requestId)
  // The dialog's tab held the keys (/quick-actions asked for them), so the
  // results' tab opened afresh stayed behind it: both were closed and opened
  // afresh (SELM-00061).
  expect(s.closed).toEqual([PICKER, PANE.requestId, PANE.requestId, PICKER])
  expect(s.panes.sort()).toEqual([PANE.requestId, PICKER].sort())
})

// ---------------------------------------------------------------------------
// A run from the dialog shows the results (SELM-00061)
//
// The person picking in the dialog gives its tab the keys (/quick-actions
// asks for them), and the engine shows a tab opened anew only while no tab
// holds them: closing the results' tab and opening it afresh left it behind
// the dialog's. Both tabs are closed then, which hands the keys back to the
// prompt, and opened afresh, the results' last. The engine reopens an open id
// without showing it (reopenShows false); a host that shows it needs none of this.

const DIALOG_RUNS = [
  { id: 'explain', kind: 'selection', running: 'Thinking…' },
  { id: 'recap', kind: 'context', running: 'Thinking…' },
  { id: 'stopwatch', kind: 'standalone', running: /🏃/ },
] as const

for (const reopenShows of [false, true]) {
  for (const run of DIALOG_RUNS) {
    test(`[reopen ${reopenShows ? 'shows' : 'retitles'}] a ${run.kind} action picked in the dialog holding the keys: the results' tab shows, the run in it`, { options: EN }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      s.reopenShows = reopenShows
      await start($)
      await select(s, clock, SELECTED)
      await runCommand($, '')
      expect(s.shown).toBe(PICKER)
      expect(s.focused).toBe(PICKER)

      let release = () => {}
      s.hold = new Promise<void>(resolve => (release = resolve))
      const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
      await picker.input({ key: PICKER_FILTER, text: run.id, kind: 'change' })
      const picked = pickAction(picker, run.id)
      // A local action holds on no model: its run is under way once the pick is.
      if (run.kind === 'standalone') await picked
      const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
      expect(texts.some(t => (typeof run.running === 'string' ? t === run.running : run.running.test(t)))).toBe(true)
      expect(s.shown).toBe(PANE.requestId)
      expect(s.panes.sort()).toEqual([PANE.requestId, PICKER].sort())
      if (reopenShows) {
        // The reopen showed it: nothing closed, the keys left with the dialog.
        expect(s.closed).toEqual([])
        expect(s.focused).toBe(PICKER)
      } else {
        // Both closed and opened afresh, the results' last: the keys back at the prompt.
        expect(s.closed).toEqual([PANE.requestId, PANE.requestId, PICKER])
        expect(s.opened.slice(-2).map(o => [o.id, o.focus])).toEqual([[PICKER, undefined], [PANE.requestId, undefined]])
        expect(s.focused).toBeNull()
      }
      release()
      await picked
      await pane.unmount()
      await picker.unmount()
      expect(s.shown).toBe(PANE.requestId)
    })
  }
}

test('an action that takes an argument, picked in the dialog holding the keys: its argument screen stays shown, and Enter shows the results', { options: EN }, async ($, on) => {
  mock.clock(on)
  const s = stage(on)
  s.reopenShows = false
  await start($)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'timer')
  // The argument screen, on the dialog's tab, still shown and holding the keys; nothing ran.
  expect(await picker.find({ key: PICKER_ARG })).toBeDefined()
  expect(s.shown).toBe(PICKER)
  expect(s.focused).toBe(PICKER)
  expect(s.closed).toEqual([])
  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await before.find({ text: /left$/ })).toBeUndefined()
  await before.unmount()

  await picker.input({ key: PICKER_ARG, text: '5m' })
  await picker.unmount()
  expect(s.shown).toBe(PANE.requestId)
  expect(s.focused).toBeNull()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: MESSAGES.en.timerLeft('05:00') })).toBeDefined()
  await pane.unmount()
})

test('a run from the hint line, the keys at the prompt, reopens no more than the results\' tab', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  s.reopenShows = false
  await start($)
  await select(s, clock, SELECTED)
  await pressOnLine($, 'explain')
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)

  // /quick-actions: the dialog's tab, reopened once, shows and takes the keys.
  await runCommand($, '')
  expect(s.closed).toEqual([PICKER])
  expect(s.shown).toBe(PICKER)
  expect(s.focused).toBe(PICKER)

  // The person back at the prompt (ctrl+x tab): a run from the hint line
  // closes the results' tab alone and opens it afresh, the dialog's left open.
  s.focused = null
  await select(s, clock, null)
  await select(s, clock, 'exit 137')
  await pressOnLine($, 'summarize')
  expect(s.closed).toEqual([PICKER, PANE.requestId])
  expect(s.shown).toBe(PANE.requestId)
  expect(s.panes.sort()).toEqual([PANE.requestId, PICKER].sort())
})

// ---------------------------------------------------------------------------
// One close closes both
//
// The person's close (the close mark, ctrl+x x, Escape through closeOnEscape)
// reaches the plugin as `ui.close` with origin person, which the test kit
// cannot raise (its $ has no ui.close): what that hook decides is checked by
// closesWhole, and what it then does (closeAll) through the dialog's close
// button, which runs the same; Escape itself is checked in a real session.

test('the person\'s close closes the whole pane; the plugin\'s own and an unload close no more', () => {
  expect(closesWhole({ kind: 'person' })).toBe(true)
  expect(closesWhole({ kind: 'plugin' })).toBe(false)
  expect(closesWhole({ kind: 'unload' })).toBe(false)
})

test('the dialog\'s close button closes both tabs and stops a timer', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'timer 5m')
  await clock.advance(60_000)
  s.closed = []
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.press({ key: PICKER_CLOSE })
  await picker.unmount()
  expect(s.closed).toEqual([PICKER, PANE.requestId])
  await clock.advance(2_000)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /Stopped/ })).toBeDefined()
  await pane.unmount()
  // The text the dialog held went with it.
  const again = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  expect(await again.find({ text: MESSAGES.en.noSelection })).toBeDefined()
  await again.unmount()
  expect(s.toasts.filter(x => /is done/.test(x))).toEqual([])
})

// ---------------------------------------------------------------------------
// The dialog's list as tall as the pane

for (const surface of SURFACES) {
  test(`[${surface}] the list holds as many as the pane's rows, and is drawn anew when they change: shrunk and grown again, it fills the pane`, async ($, on) => {
    const s = stage(on)
    await start($)
    await runCommand($, '')
    void s

    const t = MESSAGES.en
    const total = ACTIONS.filter(a => !needsSelection(a)).length
    const props = (bodyRows: number) => ({ ...PICKER_PANE.props, scroll: { offset: 0, bodyRows } })
    // At 60 columns every label is one row: the pane's rows less the legend,
    // the filter row, the close button and the "n more" line.
    const fits = (bodyRows: number) => bodyRows - FIXED_ROWS - linesOf(t.pickerLegend(false), 60) - linesOf(t.pickerMore(total), 60)
    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: props(40) })
    for (const o of await listedOptions(picker)) expect(buttonLines(o.label, 60)).toBe(1)
    expect(await listedCount(picker)).toBe(fits(40))
    expect(await listedActions(picker)).toHaveLength(fits(40))
    expect(await picker.find({ text: t.pickerMore(total - fits(40)) })).toBeDefined()
    // Shrunk: as many as the rows left hold, never under three.
    await picker.redraw(props(8))
    expect(await listedCount(picker)).toBe(fits(8))
    expect(await listedActions(picker)).toHaveLength(fits(8))
    await picker.redraw(props(4))
    expect(await listedActions(picker)).toHaveLength(MIN_SHOWN)
    // Grown again: the list is drawn anew for the full height, not left at the small one.
    await picker.redraw(props(40))
    expect(await listedCount(picker)).toBe(fits(40))
    expect(await listedActions(picker)).toHaveLength(fits(40))
    // Its buttons keep their keys, so a pick still reaches them.
    await pickAction(picker, (await listedActions(picker))[0] ?? '')
    expect(s.shown).toBe(PANE.requestId)
    await picker.unmount()
  })
}

// ---------------------------------------------------------------------------
// While AskUserQuestion is up

const QUESTIONS = [{ question: 'Which one?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }]
const QUESTION = { tool: 'AskUserQuestion', questions: QUESTIONS }
/** The model's AskUserQuestion call, as the engine runs it through the plugins. */
const ask = ($: Engine, id: string) => $.tool.call({ tool: 'AskUserQuestion' as const, questions: QUESTIONS, tool_use_id: id })

for (const surface of [...SURFACES, 'mobile'] as const) {
  test(`[${surface}] under the question dialog, a Quick Actions button opens the tabs on the dialog's`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)

    const dialog = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AskUserQuestion', props: QUESTION })
    // The engine's own dialog is still drawn (one engine node), the button under it.
    expect(JSON.stringify(await dialog.drawn())).toContain('"engine"')
    const button = await dialog.find({ key: '_ask-open' })
    expect(button?.props.label).toBe(MESSAGES.en.askOpen)
    await dialog.press({ key: '_ask-open' })
    await dialog.unmount()
    expect(s.shown).toBe(PICKER)
    expect(s.opened.at(-1)).toEqual({ id: PICKER, title: MESSAGES.en.pickerTitle, focus: true, closeOnEscape: true, columns: 56 })
    // On the text selected now.
    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    expect(await picker.find({ text: MESSAGES.en.pickerLegend(true) })).toBeDefined()
    await picker.unmount()
  })
}

test('while a question is up, the dialog lists its actions as buttons, and a click on one runs it', async ($, on) => {
  const clock = mock.clock(on)
  let answer: () => void = () => {}
  const answered = new Promise<void>(resolve => (answer = resolve))
  // Beneath the plugins, the dialog stays up until the test answers it.
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    await answered
    return { result: { answers: { 'Which one?': 'A' } } }
  })
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  await runCommand($, '')

  const asked = ask($, 'toolu_1')
  await clock.settle()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, isFocused: false } })
  // No field, which wants the keys the question holds; a line says to click.
  expect(await picker.find({ type: 'Select' })).toBeUndefined()
  expect(await picker.find({ key: PICKER_FILTER })).toBeUndefined()
  // Every action is listed (nothing else would reach the rest), with no "n more" line.
  expect((await listedActions(picker)).length).toBe(ACTIONS.length)
  expect(await picker.find({ text: /more: type in the filter/ })).toBeUndefined()
  expect(await picker.find({ text: MESSAGES.en.pickerAsking })).toBeDefined()
  expect(await picker.find({ text: MESSAGES.en.pickerNoFocus })).toBeUndefined()
  expect(await picker.find({ key: 'tldr' })).toBeDefined()
  // A click reaches the pane while the question is up: it runs, on the text the dialog holds.
  await picker.press({ key: 'tldr' })
  expect(s.models.at(-1)?.prompt).toContain(SELECTED)
  expect(s.shown).toBe(PANE.requestId)
  // The close button still answers too (checked below, after the question).

  answer()
  await asked
  await clock.settle()
  await picker.redraw()
  // The question answered: the field again, and the list as many as the pane holds.
  expect(await picker.find({ key: PICKER_FILTER })).toBeDefined()
  expect((await listedActions(picker)).length).toBeLessThan(ACTIONS.length)
  expect(await picker.find({ text: MESSAGES.en.pickerAsking })).toBeUndefined()
  await picker.unmount()
})

test('a question refused or failing still lets go of the buttons', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    throw new Error('dismissed')
  })
  const s = stage(on)
  await start($)
  await runCommand($, '')
  await ask($, 'toolu_2').catch(() => undefined)
  await clock.settle()
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  expect(await picker.find({ text: MESSAGES.en.pickerAsking })).toBeUndefined()
  await picker.unmount()
  void s
})
