import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Result } from '../types'
import { nextEntryId } from '../hooks/entries'
import { MESSAGES } from '../hooks/i18n'
import { paneStyle } from '../hooks/palette'
import { settleQuietly, toRow } from '../hooks/scroll'
import {
  ASSISTANT_ROW,
  BAND,
  INFO_NOTICE_ROW,
  EN,
  JA,
  JAPANESE,
  OTHER_ASSISTANT_ROW,
  PANE,
  PICKER_PANE,
  pickAction,
  SURFACES,
  TOOL_GROUP_ROW,
  TOOL_PROGRESS_ROW,
  TOOL_RESULT_ROW,
  TOOL_USE_ROW,
  TURN_DURATION_ROW,
  USER_ROW,
  reselect,
  runCommand,
  showKind,
  stage,
  start,
} from './stage'
import type { Clock, Stage } from './stage'

// A selection within one transcript row ($.ui.selection() naming its
// requestId) that an action on the selection ran on: the result in the pane
// carries a "Go to selection" button, which scrolls the transcript back to
// that row. The row itself is left as the engine draws it: nothing marks the
// selection in it (the engine does not tell where in the row the selection
// lies, and a whole row drawn highlighted told nothing of which words were
// picked; see hooks/entries.ts).

const GOTO = (id: number) => `_goto-${id}`

type Row =
  | typeof USER_ROW
  | typeof ASSISTANT_ROW
  | typeof OTHER_ASSISTANT_ROW
  | typeof TOOL_USE_ROW
  | typeof TOOL_RESULT_ROW
  | typeof TOOL_GROUP_ROW
  | typeof TOOL_PROGRESS_ROW
  | typeof INFO_NOTICE_ROW
  | typeof TURN_DURATION_ROW

/** Whether `row`, drawn now, is the engine's drawing alone: nothing around it, no background. */
async function drawnAsEngine($: Engine, row: Row, surface: (typeof SURFACES)[number] = 'terminal'): Promise<boolean> {
  const mounted = await $.ui.mount({ ...row, surface } as Parameters<Engine['ui']['mount']>[0])
  const drawn = (await mounted.drawn()) as unknown as { type: string; props: Record<string, unknown> }
  const engine = await mounted.find({ key: 'engine' })
  await mounted.unmount()
  return engine !== undefined && drawn.type === 'Box' && drawn.props['backgroundColor'] === undefined
}

/** Selects `text` in transcript row `row` (null: no row named) and lets the poll see it. */
async function select(s: Stage, clock: Clock, text: string, row: string | null) {
  s.selected = null
  s.selectedRow = null
  await clock.advance(400)
  s.selected = text
  s.selectedRow = row
  await clock.advance(400)
}

/** Presses icon `key` on the hint line. */
async function pressIcon($: Engine, key: string) {
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key })
  await band.unmount()
}

const paneKeys = async ($: Engine) => {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = (await pane.findAll({ type: 'Button' })).map(b => b.key)
  await pane.unmount()
  return keys
}

/** The go-to buttons among the pane's buttons, in order. */
const gotoKeys = async ($: Engine) => (await paneKeys($)).filter(k => k?.startsWith('_goto') || k?.startsWith('_unmark'))

/**
 * The results as the plugin last wrote them, seen beneath it: `rowOf(id)` is
 * the row entry `id` keeps as its origin (where its Go to selection scrolls).
 */
function watchResults(on: Parameters<typeof stage>[0]) {
  let last: Result[] = []
  on('state.set', (_$, e, next) => {
    if (e.key === 'results') last = e.value as Result[]
    return next(e)
  })
  return (id: number) => last.find(r => r.id === id)?.origin?.requestId
}

// ---------------------------------------------------------------------------
// The pure parts

const entry = (id: number, origin?: Result['origin']): Result => ({
  id,
  action: 'explain',
  target: 'selection',
  quote: 'x',
  status: 'done',
  text: 'answer',
  ...(origin === undefined ? {} : { origin }),
})

test('nextEntryId: past every ID kept and past the module count', () => {
  expect(nextEntryId([], 1)).toBe(1)
  expect(nextEntryId([entry(101), entry(100)], 1)).toBe(102)
  expect(nextEntryId([entry(3)], 10)).toBe(10)
})

test('Go to selection asks for that row, in the middle of the window, with no site named', () => {
  expect(toRow('msg-1')).toEqual({ to: { requestId: 'msg-1' }, block: 'center' })
})

test('a refused or rejected scroll to a row settles quietly', async () => {
  await expect(settleQuietly(Promise.resolve({ deny: 'not person-initiated' }))).resolves.toBeUndefined()
  await expect(settleQuietly(Promise.reject(new Error('no implementation for ui.scroll')))).resolves.toBeUndefined()
})

// ---------------------------------------------------------------------------
// The button, every way an action on the selection runs; the row untouched

for (const surface of SURFACES) {
  test(`[${surface}] an icon on a selection in one row: the result gets Go to selection alone, and every row stays the engine's drawing`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, 'exit 137 is SIGKILL', ASSISTANT_ROW.requestId)
    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'explain' })
    await band.unmount()

    for (const row of [ASSISTANT_ROW, OTHER_ASSISTANT_ROW, USER_ROW]) expect(await drawnAsEngine($, row, surface)).toBe(true)

    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ key: GOTO(1) }))?.props.label).toBe(MESSAGES.en.gotoSelection)
    expect((await pane.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('_unmark'))).toEqual([])
    // The result itself as ever.
    expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
    await pane.unmount()
  })
}

// The other rows the transcript draws: a selection in one gives its result the
// button, as for a message, and the row is drawn by the engine as ever.
for (const [name, row, selected] of [
  ['a user message', USER_ROW, USER_ROW.requestId],
  ['a tool result block', TOOL_RESULT_ROW, TOOL_RESULT_ROW.requestId],
  ['a folded group of tool calls, by its own id', TOOL_GROUP_ROW, TOOL_GROUP_ROW.requestId],
  ['a folded group of tool calls, by the id of a call in it', TOOL_GROUP_ROW, 'toolu_g2'],
  ['a progress row', TOOL_PROGRESS_ROW, TOOL_PROGRESS_ROW.requestId],
  ['an info notice', INFO_NOTICE_ROW, INFO_NOTICE_ROW.requestId],
  ['the line that closes a turn', TURN_DURATION_ROW, TURN_DURATION_ROW.requestId],
] as const) {
  test(`a selection in ${name}: the result gets Go to selection, the row stays the engine's drawing`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, 'some words', selected)
    await pressIcon($, 'explain')
    expect(await drawnAsEngine($, row)).toBe(true)
    expect(await paneKeys($)).toEqual([GOTO(1)])
  })
}

// Nothing hooks the transcript rows any more: a run on a row draws none of
// them again, nor does a run over time ticking (which writes the results every
// tick). Counted as the engine's drawings beneath the plugin.
test('a run on a selection in a row, and a run over time ticking, draw no transcript row again', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const picked = await $.ui.mount({ ...ASSISTANT_ROW, surface: 'terminal' })
  const other = await $.ui.mount({ ...USER_ROW, surface: 'terminal' })
  await runCommand($, 'timer 10s')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The counts are taken once the pane is drawn (the redraw it asks for as it
  // first measures its dock, SELM-00068, is done by then; it asks no more).
  const PICKED = `AssistantMessage:${ASSISTANT_ROW.requestId}`
  const OTHER = `UserMessage:${USER_ROW.requestId}`
  const before = { picked: s.drawn[PICKED], other: s.drawn[OTHER] }
  expect(before.picked).toBeGreaterThan(0)
  expect(before.other).toBeGreaterThan(0)

  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  await reselect(s, clock)
  await pressIcon($, 'translate-ja')
  await clock.advance(5000)
  expect(s.drawn[PICKED]).toBe(before.picked)
  expect(s.drawn[OTHER]).toBe(before.other)
  const drawn = (await picked.drawn()) as unknown as { props: Record<string, unknown> }
  expect(drawn.props['backgroundColor']).toBeUndefined()
  expect(await picked.find({ key: 'engine' })).toBeDefined()
  await pane.unmount()
  await picked.unmount()
  await other.unmount()
})

// The kit has no implementation of $.ui.scroll (see tests/scroll.test.tsx):
// what the press asks for is toRow's, checked above; here the press settles
// quietly and changes nothing else.
test('Go to selection settles quietly and changes nothing else', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: GOTO(1) })
  expect(await pane.find({ key: GOTO(1) })).toBeDefined()
  expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
  await pane.unmount()
  expect(await drawnAsEngine($, ASSISTANT_ROW)).toBe(true)
  expect(s.models).toHaveLength(1)
})

// The kit cannot raise the person's close of the pane (its $ has no ui.close;
// see tests/standalone.test.tsx), whose hook only stops runs over time and
// leaves the results as they are. The pane drawn and let go leaves the
// button, as does a later run of another kind.
test('the button stays with the pane gone and after other runs', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.unmount()
  await clock.advance(10_000)
  await runCommand($, 'recap')
  expect(await gotoKeys($)).toEqual([GOTO(1)])
})

test('two actions on one selection: two results, one button each', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  await reselect(s, clock)
  await pressIcon($, 'translate-ja')
  expect(await paneKeys($)).toEqual([GOTO(2), GOTO(1)])
})

test('a selection with no row named, a context action and a standalone action: no button, results as ever', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  // Over several rows (or in a pane): the engine names none.
  await select(s, clock, 'exit 137', null)
  await pressIcon($, 'explain')
  await runCommand($, 'recap')
  await runCommand($, 'timer 10s')

  for (const row of [USER_ROW, ASSISTANT_ROW, TOOL_USE_ROW, TOOL_RESULT_ROW]) expect(await drawnAsEngine($, row)).toBe(true)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = (await pane.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys.filter(k => k?.startsWith('_goto') || k?.startsWith('_unmark'))).toEqual([])
  expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
  expect(await pane.find({ text: 'answer in context' })).toBeDefined()
  await pane.unmount()
})

test('a context or standalone action run while a selection in a row is there gets no button', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  // From the hint line (a context action), and by the command (a standalone one).
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await showKind(band, 'context')
  await band.press({ key: 'recap' })
  await band.unmount()
  await reselect(s, clock)
  await runCommand($, 'timer 10s')
  expect(await gotoKeys($)).toEqual([])
})

test('the command /quick-actions <id> carries the row', { options: EN }, async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  s.selectedRow = ASSISTANT_ROW.requestId
  await runCommand($, 'explain')
  expect(await paneKeys($)).toEqual([GOTO(1)])
  expect(await drawnAsEngine($, ASSISTANT_ROW)).toBe(true)
})


test('a pick in the ⋯ dialog carries the row it opened on, whatever is selected by then', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const rowOf = watchResults(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, '_more')
  s.selected = 'something else'
  s.selectedRow = USER_ROW.requestId
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'explain')
  await picker.unmount()
  expect(s.models[0]?.prompt).toContain('exit 137')
  expect(await paneKeys($)).toEqual([GOTO(1)])
  expect(rowOf(1)).toBe(ASSISTANT_ROW.requestId)
})

test('/quick-actions with no ID opens the ⋯ dialog on the selection and its row', { options: EN }, async ($, on) => {
  const rowOf = watchResults(on)
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  s.selectedRow = USER_ROW.requestId
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'explain')
  await picker.unmount()
  expect(await paneKeys($)).toEqual([GOTO(1)])
  expect(rowOf(1)).toBe(USER_ROW.requestId)
})

test('/quick-actions hint holds the row with the text: a press there gets the button', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const rowOf = watchResults(on)
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  s.selectedRow = ASSISTANT_ROW.requestId
  await runCommand($, 'hint')
  // Running the command ends the selection, as the engine does.
  s.selected = null
  s.selectedRow = null
  await clock.advance(400)
  await pressIcon($, 'explain')
  expect(s.models[0]?.prompt).toContain('exit 137')
  expect(await paneKeys($)).toEqual([GOTO(1)])
  expect(rowOf(1)).toBe(ASSISTANT_ROW.requestId)
})

test('the ⋯ dialog from the line /quick-actions hint holds carries its row too', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const rowOf = watchResults(on)
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  s.selectedRow = TOOL_USE_ROW.requestId
  await runCommand($, 'hint')
  s.selected = null
  s.selectedRow = null
  await clock.advance(400)
  await pressIcon($, '_more')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'explain')
  await picker.unmount()
  expect(await paneKeys($)).toEqual([GOTO(1)])
  expect(rowOf(1)).toBe(TOOL_USE_ROW.requestId)
})

test('an entry pushed out of the pane takes its button with it', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  expect(await gotoKeys($)).toEqual([GOTO(1)])
  // KEEP (20) more runs on no row push it out.
  s.selectedRow = null
  for (let i = 0; i < 20; i++) await runCommand($, 'explain')
  expect(await gotoKeys($)).toEqual([])
})

// The results outlive a reload of the module, whose own count of entries
// starts again. Entries far past any count a test could reach (100, 101) are
// laid in the state as a reload leaves them (one with the `highlighted` an
// earlier version kept, which nothing reads now): a new entry must take an ID
// past them, so that its button is its own and no other's.
test('after a reload, a new entry takes an ID past every entry kept, each with its own button', { options: EN }, async ($, on) => {
  const KEPT = [
    entry(101, { requestId: OTHER_ASSISTANT_ROW.requestId, highlighted: true } as Result['origin']),
    entry(100, { requestId: ASSISTANT_ROW.requestId }),
  ]
  // Beneath the plugin, the pane's results as a reload leaves them, read and
  // written here (a write with a stale ifVersion refused, as the host does).
  let held: { value: unknown; version: number } = { value: KEPT, version: 1 }
  on('state.get', (_$, e, next) => (e.key === 'results' ? { value: held } : next(e)))
  on('state.set', (_$, e, next) => {
    if (e.key !== 'results') return next(e)
    if (e.ifVersion !== undefined && e.ifVersion !== held.version) return { value: { isSet: false as const, version: held.version } }
    held = { value: e.value, version: held.version + 1 }
    return { value: { isSet: true as const, version: held.version } }
  })
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'why does it', USER_ROW.requestId)
  await pressIcon($, 'explain')

  expect(await paneKeys($)).toEqual([GOTO(102), GOTO(101), GOTO(100)])
  const list = held.value as Result[]
  expect(list.map(r => [r.id, r.origin?.requestId])).toEqual([
    [102, USER_ROW.requestId],
    [101, OTHER_ASSISTANT_ROW.requestId],
    [100, ASSISTANT_ROW.requestId],
  ])
  // The new entry's origin is the row alone.
  expect(list[0]?.origin).toEqual({ requestId: USER_ROW.requestId })
  // A press on the kept entry's button, `highlighted` and all, settles quietly.
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: GOTO(101) })
  expect(await pane.find({ key: GOTO(101) })).toBeDefined()
  await pane.unmount()
})

// ---------------------------------------------------------------------------
// The button's words and colour

for (const surface of SURFACES) {
  for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
    test(`[${surface}] [${options.language}] the button says so in the language`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
      await pressIcon($, 'explain')
      const pane = await $.ui.mount({ ...PANE, surface })
      const labels = (await pane.findAll({ type: 'Button' })).map(b => b.props.label)
      expect(labels).toEqual([t.gotoSelection])
      if (options.language === 'en') for (const label of labels) expect(String(label)).not.toMatch(JAPANESE)
      await pane.unmount()
    })
  }
}

for (const paneTheme of ['light', 'dark'] as const) {
  test(`[${paneTheme}] the button is drawn in the palette's muted colour`, { options: { ...EN, paneTheme } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
    await pressIcon($, 'explain')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const label = (await pane.findAll({ text: MESSAGES.en.gotoSelection })).filter(f => f.type === 'Text')
    expect(label.map(f => f.props.color)).toEqual([paneStyle(paneTheme, 'dock').muted])
    await pane.unmount()
  })
}
