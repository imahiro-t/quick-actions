import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor, argSpecOf, isStandalone, takesArg } from '../hooks/actions'
import { parseCustomActions } from '../hooks/custom'
import { ARG_KEY, FILTER_KEY, toArgField, toFilterField } from '../hooks/focus'
import { MESSAGES } from '../hooks/i18n'
import type { Lang } from '../hooks/i18n'
import { paneStyle } from '../hooks/palette'
import { closeGoesBack } from '../hooks/register'
import {
  BAND,
  EN,
  JA,
  PANE,
  PICKER,
  PICKER_ARG,
  PICKER_ARG_BACK,
  PICKER_CLOSE,
  PICKER_FILTER,
  PICKER_PANE,
  listBox,
  listedActions,
  pickAction,
  pickerKindButtons,
  SURFACES,
  runCommand,
  showKind,
  showPickerKind,
  stage,
  start,
  storedUsage,
  submitArg,
} from './stage'
import type { Clock, Stage } from './stage'

// The argument a standalone action takes, given without typing the command:
// the ⋯ dialog turns to an argument screen when such an action is picked (or
// pressed on the hint line), and a timer's entry in the result pane offers to
// run it again, or to open that screen, once it no longer runs. Where no
// Input can be drawn (the mobile app), such an action runs at once with its
// default, as before.

const STOP = (id: number) => `_stop-${id}`
const AGAIN = (id: number) => `_again-${id}`
const SET_ARG = (id: number) => `_set-arg-${id}`
const SECRET = 'SECRET selected text'
const LANGS = [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const

/** The hint of a built-in's argument, in the language. */
const hintOf = (id: string, lang: Lang) => {
  const def = actionsFor(lang).find(a => a.id === id)
  const spec = def === undefined ? undefined : argSpecOf(def)
  if (spec === undefined) throw new Error(`${id} takes no argument`)
  return spec.hint
}

const labelOf = (id: string, lang: Lang) => actionsFor(lang).find(a => a.id === id)?.label ?? id

/** The texts the result pane draws now. */
async function paneTexts($: Engine, surface: (typeof SURFACES)[number] | 'mobile' = 'terminal'): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 80 } } })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  await pane.unmount()
  return texts
}

/** The keys of the result pane's buttons now. */
async function paneButtons($: Engine, surface: (typeof SURFACES)[number] | 'mobile' = 'terminal'): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, surface })
  const keys = (await pane.findAll({ type: 'Button' })).map(b => String(b.key))
  await pane.unmount()
  return keys
}

/** Presses a button of the result pane. */
async function pressInPane($: Engine, key: string, surface: (typeof SURFACES)[number] | 'mobile' = 'terminal') {
  const pane = await $.ui.mount({ ...PANE, surface })
  await pane.press({ key })
  await pane.unmount()
}

/** What the ⋯ dialog draws now: its texts, its field (value, placeholder, submit label) and its button keys. */
async function pickerNow($: Engine, surface: (typeof SURFACES)[number] = 'terminal') {
  const picker = await $.ui.mount({ ...PICKER_PANE, surface })
  const texts = (await picker.findAll({ type: 'Text' })).map(t => t.text)
  const field = await picker.find({ key: PICKER_ARG })
  const filter = await picker.find({ key: PICKER_FILTER })
  const list = await listBox(picker)
  const buttons = (await picker.findAll({ type: 'Button' })).map(b => ({ key: String(b.key), label: b.props.label }))
  await picker.unmount()
  return { texts, field, filter, list, buttons }
}

/**
 * Nothing ran: no model, no fork, no subagent, the results' tab not brought to
 * the front (it opens behind the ⋯ dialog's whenever that opens), no use counted.
 */
const ranNothing = (s: Stage) => {
  expect(s.models).toEqual([])
  expect(s.forks).toEqual([])
  expect(s.spawned).toEqual([])
  expect(s.shown).not.toBe(PANE.requestId)
  expect(storedUsage(s)).toBeUndefined()
}

async function select(s: Stage, clock: Clock, text: string | null) {
  s.selected = text
  await clock.advance(400)
}

// ---------------------------------------------------------------------------
// Which actions take an argument

test('takesArg: the standalone actions with an argument, and every custom one with target none', () => {
  for (const a of ACTIONS) {
    expect(takesArg(a)).toBe(isStandalone(a) && a.kind !== 'fork' && 'arg' in a && a.arg !== undefined)
    if (!isStandalone(a)) expect(takesArg(a)).toBe(false)
  }
  const byId = (id: string) => ACTIONS.find(a => a.id === id)!
  for (const id of ['timer', 'pomodoro', 'countdown-to', 'breathing', 'calendar']) expect(takesArg(byId(id))).toBe(true)
  for (const id of ['stopwatch', 'eye-rest', 'clock', 'explain', 'recap']) expect(takesArg(byId(id))).toBe(false)
  const custom = parseCustomActions(
    JSON.stringify([
      { id: 'ideas', icon: '💭', label: 'Ideas', kind: 'complete', model: 'haiku', target: 'none', prompt: 'Ideas.' },
      { id: 'mine', icon: '🪄', label: 'Mine', kind: 'complete', model: 'haiku', prompt: 'Mine.' },
    ]),
    ACTIONS.map(a => a.id),
  )
  expect(custom.specs.map(a => [a.id, takesArg(a)])).toEqual([['ideas', true], ['mine', false]])
})

test('the argument field and the focus requests: the field picked into, the filter field gone back to', () => {
  expect(ARG_KEY).toBe(PICKER_ARG)
  expect(toArgField(PICKER)).toEqual({ requestId: PICKER, key: PICKER_ARG })
  expect(toFilterField(PICKER)).toEqual({ requestId: PICKER, key: FILTER_KEY })
})

// Escape (closeOnEscape) and the close mark reach the plugin as `ui.close`
// with origin person, which the test kit cannot raise: the decision its hook
// makes is checked here, and the way back it then takes (backToList) is the
// one the Back button takes, checked below. That after Escape the filter field
// takes the keys again and a second Escape closes the dialog is checked in a
// real session.
test('closeGoesBack: the person\'s close goes back to the list from the argument screen alone', () => {
  const onArg = { text: null, filter: '', arg: { action: 'timer', value: '5' } }
  const onList = { text: null, filter: '' }
  expect(closeGoesBack(onArg, { kind: 'person' })).toBe(true)
  expect(closeGoesBack(onList, { kind: 'person' })).toBe(false)
  expect(closeGoesBack(null, { kind: 'person' })).toBe(false)
  expect(closeGoesBack(onArg, { kind: 'plugin' })).toBe(false)
  expect(closeGoesBack(onArg, { kind: 'unload' })).toBe(false)
})

// ---------------------------------------------------------------------------
// The ⋯ dialog: picked, the argument screen; Enter runs; Back goes back

for (const surface of SURFACES) {
  for (const [options, t] of LANGS) {
    const l = options.language
    test(`[${surface}] [${l}] ⋯ then timer: the argument screen, and nothing runs yet`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      await select(s, clock, SECRET)
      const band = await $.ui.mount({ ...BAND, surface })
      await band.press({ key: '_more' })
      await band.unmount()
      const picker = await $.ui.mount({ ...PICKER_PANE, surface })
      await pickAction(picker, 'timer')
      await picker.unmount()

      const now = await pickerNow($, surface)
      expect(now.texts).toContain(`⏳ ${labelOf('timer', l)}`)
      expect(now.texts).toContain(hintOf('timer', l))
      expect(now.texts).toContain(t.argDefault('25m'))
      expect(now.field?.type).toBe('Input')
      expect(now.field?.props.value).toBe('')
      expect(now.field?.props.placeholder).toBe('25m')
      expect(now.field?.props.submitLabel).toBe(t.argSubmit)
      expect(now.field?.props.autoFocus).toBe(true)
      // The list and its filter are not drawn meanwhile.
      expect(now.list).toBeUndefined()
      expect(now.filter).toBeUndefined()
      expect(now.buttons).toEqual([
        { key: PICKER_ARG_BACK, label: t.argBack },
        { key: PICKER_CLOSE, label: t.pickerClose },
      ])
      expect(s.closed).toEqual([])
      ranNothing(s)
    })
  }

  test(`[${surface}] Enter with the field empty: the default, headed "standalone"; the held text unsent, its icons put away`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SECRET)
    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: '_more' })
    await band.unmount()
    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await pickAction(picker, 'timer')
    await picker.input({ key: PICKER_ARG, text: '' })
    await picker.unmount()

    // A run keeps the dialog's tab and shows the results' (SELM-00050).
    expect(s.closed).toEqual([])
    expect(s.shown).toBe(PANE.requestId)
    const texts = await paneTexts($, surface)
    expect(texts).toContain('⏳ 25:00 left')
    expect(texts.join('\n')).toContain(MESSAGES.en.standalone)
    expect(texts.join('\n')).not.toContain('SECRET')
    await clock.advance(400)
    const after = await $.ui.mount({ ...BAND, surface })
    expect(await after.findAll({ type: 'Button' })).toEqual([])
    await after.unmount()
  })
}

for (const [options, t] of LANGS) {
  const l = options.language
  test(`[${l}] /quick-actions without an ID, then timer, then 5m: five minutes, headed by its argument`, { options }, async ($, on) => {
    mock.clock(on)
    const s = stage(on)
    await start($)
    await runCommand($, '')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    await pickAction(picker, 'timer')
    expect(s.closed).toEqual([])
    await picker.input({ key: PICKER_ARG, text: ' 5m ' })
    await picker.unmount()
    // A run keeps the dialog's tab and shows the results' (SELM-00050).
    expect(s.closed).toEqual([])
    expect(s.shown).toBe(PANE.requestId)
    const texts = await paneTexts($)
    expect(texts).toContain(t.timerLeft('05:00'))
    expect(texts.join('\n')).toContain(t.quote('5m'))
  })

  test(`[${l}] an argument that does not parse: nothing runs, the command's words shown, what was typed kept`, { options }, async ($, on) => {
    mock.clock(on)
    const s = stage(on)
    await start($)
    await runCommand($, '')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    await pickAction(picker, 'timer')
    await picker.input({ key: PICKER_ARG, text: '99h' })
    await picker.unmount()

    const error = t.invalidArg('timer', '99h', hintOf('timer', l))
    const now = await pickerNow($)
    expect(now.texts).toContain(error)
    expect(now.field?.props.value).toBe('99h')
    expect(s.closed).toEqual([])
    ranNothing(s)
    // The same words as the command's.
    const r = await runCommand($, 'timer 99h')
    expect(JSON.stringify(r)).toContain(JSON.stringify(error).slice(1, -1))

    // Its colour is the failure's.
    const again = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    const shown = (await again.findAll({ text: error })).filter(f => f.type === 'Text')
    expect(shown.map(f => f.props.color)).toEqual(['error'])
    // A valid one then runs.
    await again.input({ key: PICKER_ARG, text: '90s' })
    await again.unmount()
    expect(await paneTexts($)).toContain(t.timerLeft('01:30'))
  })

  test(`[${l}] the error is worded in the language of the moment: reloaded in another one, it follows at once`, { options }, async ($, on) => {
    // The screen as left with an error that showed in the other language: what
    // the state holds is what was typed, not the words, so nothing is stale.
    const other = l === 'ja' ? 'en' : 'ja'
    const PICKING = { text: null, filter: '', arg: { action: 'timer', value: '99h', invalid: '99h' } }
    on('state.get', (_$, e, next) => (e.key === 'picking' ? { value: { value: PICKING, version: 1 } } : next(e)))
    mock.clock(on)
    const s = stage(on)
    await start($)

    const now = await pickerNow($)
    expect(now.texts).toContain(t.invalidArg('timer', '99h', hintOf('timer', l)))
    expect(now.texts).not.toContain(MESSAGES[other].invalidArg('timer', '99h', hintOf('timer', other)))
    expect(now.texts.join('\n')).not.toContain(hintOf('timer', other))
    expect(now.field?.props.value).toBe('99h')
    expect(s.closed).toEqual([])
    ranNothing(s)
  })

  test(`[${l}] an argument that does not parse is kept as typed, not as words in a language`, { options }, async ($, on) => {
    const written: unknown[] = []
    on('state.set', (_$, e, next) => {
      if (e.key === 'picking') written.push(e.value)
      return next(e)
    })
    mock.clock(on)
    stage(on)
    await start($)
    await runCommand($, '')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    await pickAction(picker, 'timer')
    await picker.input({ key: PICKER_ARG, text: ' 99h ' })
    await picker.unmount()

    // Reached through the filter (pickAction types its ID: the list leads with the most used, the timer past it).
    expect(written.at(-1)).toEqual({ text: null, filter: 'timer', arg: { action: 'timer', value: ' 99h ', invalid: '99h' } })
    expect(JSON.stringify(written)).not.toContain(t.invalidArg('timer', '99h', hintOf('timer', l)))
  })

  test(`[${l}] Back: the list again, with its filter, and nothing ran`, { options }, async ($, on) => {
    mock.clock(on)
    const s = stage(on)
    await start($)
    await runCommand($, '')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    // Switched to the standalone actions first: the kind is kept through the argument screen.
    await showPickerKind(picker, 'standalone')
    await picker.input({ key: PICKER_FILTER, text: 'timer', kind: 'change' })
    await pickAction(picker, 'timer')
    expect(await picker.find({ key: PICKER_ARG })).toBeDefined()
    await picker.press({ key: PICKER_ARG_BACK })
    expect(await picker.find({ key: PICKER_ARG })).toBeUndefined()
    expect(await listedActions(picker)).toContain('timer')
    expect((await picker.find({ key: PICKER_FILTER }))?.props.value).toBe('timer')
    // The kind buttons, no selection's with no text, the standalone one still listed.
    const kinds = await pickerKindButtons(picker)
    expect(kinds.map(k => k.kind)).toEqual(['context', 'standalone'])
    expect(kinds.map(k => k.bold)).toEqual([false, true])
    expect(kinds[1]?.label).toBe(t.hintKindShown(t.hintKindTips.standalone))
    await picker.unmount()
    expect(s.closed).toEqual([])
    ranNothing(s)
  })
}

test('Enter in the filter field with the timer first: the argument screen, not a run', { options: EN }, async ($, on) => {
  mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.input({ key: PICKER_FILTER, text: 'timer' })
  expect(await picker.find({ key: PICKER_ARG })).toBeDefined()
  await picker.unmount()
  ranNothing(s)
})

test('an action that takes no argument still runs as it is picked', { options: EN }, async ($, on) => {
  mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.input({ key: PICKER_FILTER, text: 'stopwatch', kind: 'change' })
  await pickAction(picker, 'stopwatch')
  await picker.unmount()
  // A run keeps the dialog's tab and shows the results' (SELM-00050).
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
  expect((await paneTexts($)).some(x => x.startsWith('🏃'))).toBe(true)
})

for (const paneTheme of ['light', 'dark'] as const) {
  test(`[${paneTheme}] a palette's argument screen: the field, and the buttons in its muted colour`, { options: { ...EN, paneTheme } }, async ($, on) => {
    mock.clock(on)
    stage(on)
    await start($)
    await runCommand($, '')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    // A palette lists buttons, not a Select (the timer reached through the filter).
    await pickAction(picker, 'timer')
    expect(await picker.find({ key: PICKER_ARG })).toBeDefined()
    const back = (await picker.findAll({ text: MESSAGES.en.argBack })).filter(f => f.type === 'Text')
    expect(back.map(f => f.props.color)).toEqual([paneStyle(paneTheme, 'dock').muted])
    await picker.unmount()
  })
}

// ---------------------------------------------------------------------------
// The hint line

for (const surface of SURFACES) {
  test(`[${surface}] the hint line: timer opens the argument screen, stopwatch runs at once`, { options: { ...EN, pinActions: 'timer,stopwatch' } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SECRET)
    const band = await $.ui.mount({ ...BAND, surface })
    await showKind(band, 'standalone')
    await band.press({ key: 'timer' })
    // Both tabs open, the ⋯ dialog's in front, on the argument screen.
    expect(s.opened.at(-1)).toMatchObject({ id: PICKER, focus: true, closeOnEscape: true })
    expect(s.shown).toBe(PICKER)
    const now = await pickerNow($, surface)
    expect(now.field?.props.value).toBe('')
    expect(now.texts).toContain(MESSAGES.en.argDefault('25m'))
    ranNothing(s)

    await band.press({ key: 'stopwatch' })
    await band.unmount()
    expect(s.opened.map(o => o.id)).toContain(PANE.requestId)
    expect((await paneTexts($, surface)).some(x => x.startsWith('🏃'))).toBe(true)
  })
}

test('the hint line /quick-actions hint opened: Enter on the argument screen runs, and the line closes', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'hint')
  await select(s, clock, null)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await showKind(band, 'standalone')
  await band.press({ key: 'timer' })
  // Open still: only the run puts it away.
  expect((await band.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
  await band.unmount()
  await submitArg($, '3m')
  expect(await paneTexts($)).toContain(MESSAGES.ja.timerLeft('03:00'))
  await clock.advance(400)
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.findAll({ type: 'Button' })).toEqual([])
  await after.unmount()
})

// ---------------------------------------------------------------------------
// A custom standalone action: its free text

for (const [options, t] of LANGS) {
  const IDEAS = { id: 'ideas', icon: '💭', label: 'Ideas', kind: 'complete', model: 'haiku', target: 'none', prompt: 'Suggest five ideas.' }
  test(`[${options.language}] a custom standalone action: the argument screen, empty runs with none, a text in <input>`, { options: { ...options, customActions: JSON.stringify([IDEAS]), pinActions: 'ideas' } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SECRET)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await showKind(band, 'standalone')
    await band.press({ key: 'ideas' })
    await band.unmount()
    const now = await pickerNow($)
    expect(now.texts).toContain('💭 Ideas')
    expect(now.texts).toContain(t.customArgHint)
    expect(now.texts).toContain(t.argNoDefault)
    expect(now.field?.props.placeholder).toBe(t.argPlaceholder('text'))
    expect(s.models).toEqual([])
    await submitArg($)
    expect(s.models.at(-1)?.prompt).toBe('There is no input; follow the instructions alone.')

    await runCommand($, '')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    await pickAction(picker, 'ideas')
    await picker.input({ key: PICKER_ARG, text: ' Tea Ceremony ' })
    await picker.unmount()
    expect(s.models.at(-1)?.prompt).toBe('<input>\nTea Ceremony\n</input>')
    for (const m of s.models) expect(`${m.system}${m.prompt}`).not.toContain('SECRET')
  })
}

// ---------------------------------------------------------------------------
// The mobile app: no Input, so no argument screen

test('[mobile] the hint line, the ⋯ dialog and the result pane: the default at once, no "set" button', { options: { ...EN, pinActions: 'timer' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SECRET)
  const band = await $.ui.mount({ ...BAND, surface: 'mobile' })
  await showKind(band, 'standalone')
  await band.press({ key: 'timer' })
  await band.unmount()
  // Run at once: the results' tab shown, never the argument screen.
  expect(s.shown).toBe(PANE.requestId)
  expect(await paneTexts($, 'mobile')).toContain('⏳ 25:00 left')

  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
  await picker.press({ key: 'timer' })
  await picker.unmount()
  // A run keeps the dialog's tab and shows the results' (SELM-00050).
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
  expect(await paneButtons($, 'mobile')).toEqual([STOP(2), STOP(1)])

  await pressInPane($, STOP(2), 'mobile')
  // Again, but no argument screen to open.
  expect(await paneButtons($, 'mobile')).toEqual([AGAIN(2), STOP(1)])
})

// ---------------------------------------------------------------------------
// The result pane: again, and the argument screen

for (const [options, t] of LANGS) {
  const l = options.language
  test(`[${l}] a stopped timer: again runs it once more with its argument, at the top; "set duration" opens the screen with it`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await runCommand($, 'timer 5m')
    // Running: its stop button alone.
    expect(await paneButtons($)).toEqual([STOP(1)])
    await clock.advance(3000)
    await pressInPane($, STOP(1))
    expect(await paneButtons($)).toEqual([AGAIN(1), SET_ARG(1)])
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await pane.find({ key: AGAIN(1) }))?.props.label).toBe(t.again)
    expect((await pane.find({ key: SET_ARG(1) }))?.props.label).toBe(t.setArg('duration'))
    await pane.unmount()

    await pressInPane($, AGAIN(1))
    expect(await paneButtons($)).toEqual([STOP(2), AGAIN(1), SET_ARG(1)])
    const texts = await paneTexts($)
    expect(texts).toContain(t.timerLeft('05:00'))
    expect(texts.filter(x => x === t.quote('5m'))).toHaveLength(2)
    expect(storedUsage(s)).toBeDefined()

    await pressInPane($, SET_ARG(1))
    expect(s.opened.at(-1)?.id).toBe(PICKER)
    const now = await pickerNow($)
    expect(now.field?.props.value).toBe('5m')
    expect(now.texts).toContain(hintOf('timer', l))
    await submitArg($, '10s')
    expect(await paneButtons($)).toEqual([STOP(3), STOP(2), AGAIN(1), SET_ARG(1)])
    expect(await paneTexts($)).toContain(t.timerLeft('00:10'))
  })
}

test('a timer run with no argument: again runs it with none, "set duration" opens the screen empty', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  stage(on)
  await start($)
  await runCommand($, 'timer')
  await clock.advance(1000)
  await pressInPane($, STOP(1))
  expect(await paneButtons($)).toEqual([AGAIN(1), SET_ARG(1)])
  await pressInPane($, AGAIN(1))
  const texts = await paneTexts($)
  expect(texts).toContain('⏳ 25:00 left')
  expect(texts.filter(x => x === MESSAGES.en.standalone)).toHaveLength(2)
  await pressInPane($, SET_ARG(1))
  expect((await pickerNow($)).field?.props.value).toBe('')
})

// The six runs over time there are, each stopped: "again" on every one, and
// the argument screen's button, named by its kind, on those taking an argument.
const TIMED: readonly [string, string | null][] = [
  ['timer', 'duration'],
  ['stopwatch', null],
  ['pomodoro', 'int'],
  ['countdown-to', 'time'],
  ['breathing', 'choice'],
  ['eye-rest', null],
]
for (const [options, t] of LANGS) {
  for (const [id, type] of TIMED) {
    test(`[${options.language}] ${id}: stopped, its buttons are ${type === null ? 'again alone' : 'again and set'}`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      stage(on)
      await start($)
      await runCommand($, id)
      expect(await paneButtons($)).toEqual([STOP(1)])
      await clock.advance(1000)
      await pressInPane($, STOP(1))
      const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
      const buttons = (await pane.findAll({ type: 'Button' })).map(b => [String(b.key), b.props.label])
      await pane.unmount()
      expect(buttons).toEqual(type === null ? [[AGAIN(1), t.again]] : [[AGAIN(1), t.again], [SET_ARG(1), t.setArg(type as never)]])
    })
  }
}

test('an action that does not run over time gets no buttons', { options: EN }, async ($, on) => {
  mock.clock(on)
  stage(on)
  await start($)
  await runCommand($, 'clock')
  await runCommand($, 'recap')
  expect(await paneButtons($)).toEqual([])
})

for (const paneTheme of ['light', 'dark'] as const) {
  test(`[${paneTheme}] again and set are drawn in the palette's muted colour`, { options: { ...EN, paneTheme } }, async ($, on) => {
    const clock = mock.clock(on)
    stage(on)
    await start($)
    await runCommand($, 'timer 2s')
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ key: AGAIN(1) })).toBeDefined()
    for (const label of [MESSAGES.en.again, MESSAGES.en.setArg('duration')]) {
      const found = (await pane.findAll({ text: label })).filter(f => f.type === 'Text')
      expect(found.map(f => f.props.color)).toEqual([paneStyle(paneTheme, 'dock').muted])
    }
    await pane.unmount()
  })
}

// ---------------------------------------------------------------------------
// Marked as it starts: every way a run over time ends offers it again

test('refused at the limit: again (and set) on the refused entry, its words unchanged; again runs once one is stopped', { options: JA }, async ($, on) => {
  mock.clock(on)
  stage(on)
  await start($)
  for (let i = 0; i < 5; i++) await runCommand($, 'timer 1h')
  await runCommand($, 'timer 7m')
  const texts = await paneTexts($)
  expect(texts).toContain(MESSAGES.ja.tickerLimit(5))
  expect(await paneButtons($)).toEqual([AGAIN(6), SET_ARG(6), ...[5, 4, 3, 2, 1].map(STOP)])
  await pressInPane($, STOP(5))
  await pressInPane($, AGAIN(6))
  expect(await paneTexts($)).toContain(MESSAGES.ja.timerLeft('07:00'))
  expect((await paneButtons($))[0]).toBe(STOP(7))
})

// The first frame drawn is not changed by the mark: the time left, a stop
// button, never "stopped" nor the buttons, from the first draw on.
test('the mark changes nothing while it runs: the first frame and the stop button, then the frames', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  stage(on)
  await start($)
  await runCommand($, 'timer 10s')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let texts = (await pane.findAll({ type: 'Text' })).map(x => x.text)
  expect(texts).toContain('⏳ 00:10 left')
  expect(texts).not.toContain(MESSAGES.en.tickerStopped())
  expect(texts).not.toContain(MESSAGES.en.thinking)
  expect((await pane.findAll({ type: 'Button' })).map(b => String(b.key))).toEqual([STOP(1)])
  await clock.advance(1000)
  texts = (await pane.findAll({ type: 'Text' })).map(x => x.text)
  expect(texts).toContain('⏳ 00:09 left')
  await pane.unmount()
})

// No built-in ends or fails on its first step, and the test kit cannot make
// $.clock.every throw, so the entries those ends leave are written here as
// they are left: marked at the start of the run (before any of those paths),
// settled done or failed with no frame drawn. A reload's entry, running with
// no run behind it, is drawn stopped with the buttons too; one marked but not
// yet drawn while it runs keeps "Thinking…" and gets none.
test('every end of a marked entry offers it again; one still running does not; one unmarked (older) neither', { options: EN }, async ($, on) => {
  const ENTRIES = [
    { id: 9, action: 'countdown-to', target: 'none', quote: '', arg: '9:00', input: '9:00', timed: true, status: 'done', text: '🔜 It is 09:00' },
    { id: 8, action: 'breathing', target: 'none', quote: '', timed: true, status: 'failed', text: MESSAGES.en.failed('boom') },
    { id: 7, action: 'timer', target: 'none', quote: '', arg: '5m', input: '5m', timed: true, ticker: true, status: 'running', text: '⏳ 01:00 left' },
    { id: 6, action: 'eye-rest', target: 'none', quote: '', timed: true, status: 'running', text: '' },
    { id: 5, action: 'timer', target: 'none', quote: '', ticker: true, status: 'done', text: '⏳ 25:00 Done' },
  ]
  on('state.get', (_$, e, next) => (e.key === 'results' ? { value: { value: ENTRIES, version: 1 } } : next(e)))
  mock.clock(on)
  stage(on)
  await start($)
  expect(await paneButtons($)).toEqual([AGAIN(9), SET_ARG(9), AGAIN(8), SET_ARG(8), AGAIN(7), SET_ARG(7)])
  const texts = await paneTexts($)
  expect(texts).toContain(MESSAGES.en.tickerStopped())
  expect(texts).toContain(MESSAGES.en.thinking)
})

test('again with an argument that no longer parses: a new entry, failed with the command\'s words', { options: EN }, async ($, on) => {
  const ENTRIES = [{ id: 3, action: 'timer', target: 'none', quote: '', arg: '99h', input: '99h', timed: true, status: 'done', text: 'x' }]
  let preloaded = true
  on('state.get', (_$, e, next) => (preloaded && e.key === 'results' ? { value: { value: ENTRIES, version: 1 } } : next(e)))
  mock.clock(on)
  stage(on)
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  preloaded = false
  await pane.press({ key: AGAIN(3) })
  await pane.unmount()
  expect(await paneTexts($)).toContain(MESSAGES.en.invalidArg('timer', '99h', hintOf('timer', 'en')))
})
