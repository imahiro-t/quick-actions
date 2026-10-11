import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Result } from '../types'
import { clearHighlight, highlightsFor, nextEntryId } from '../hooks/highlight'
import { MESSAGES } from '../hooks/i18n'
import { HIGHLIGHT, paneStyle } from '../hooks/palette'
import { settleQuietly, toRow } from '../hooks/scroll'
import {
  ASSISTANT_ROW,
  BAND,
  EN,
  JA,
  JAPANESE,
  OTHER_ASSISTANT_ROW,
  PANE,
  PICKER_PANE,
  PICKER_SELECT,
  SURFACES,
  TOOL_RESULT_ROW,
  TOOL_USE_ROW,
  USER_ROW,
  reselect,
  runCommand,
  stage,
  start,
} from './stage'
import type { Clock, Stage } from './stage'

// A selection within one transcript row ($.ui.selection() naming its
// requestId) that an action on the selection ran on: the row is drawn
// highlighted (the engine's own drawing inside a Box of the highlight colour,
// the whole row), and the result in the pane carries two buttons, "Go to
// selection" and "Clear highlight", until that result's highlight is cleared.

const GOTO = (id: number) => `_goto-${id}`
const UNMARK = (id: number) => `_unmark-${id}`

type Row = typeof USER_ROW | typeof ASSISTANT_ROW | typeof OTHER_ASSISTANT_ROW | typeof TOOL_USE_ROW | typeof TOOL_RESULT_ROW

/** Whether `row`, drawn now, is highlighted: its drawing is the engine's, inside the highlight Box. */
async function isHighlighted($: Engine, row: Row, surface: (typeof SURFACES)[number] = 'terminal'): Promise<boolean> {
  const mounted = await $.ui.mount({ ...row, surface } as Parameters<Engine['ui']['mount']>[0])
  const drawn = (await mounted.drawn()) as unknown as { type: string; props: Record<string, unknown> }
  // The engine's drawing is there either way, untouched.
  expect(await mounted.find({ key: 'engine' })).toBeDefined()
  await mounted.unmount()
  return drawn.type === 'Box' && drawn.props['backgroundColor'] === HIGHLIGHT
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

test('highlightsFor: the entries on that row whose highlight is on, newest first', () => {
  const list = [
    entry(4, { requestId: 'a', text: 'two', highlighted: true }),
    entry(3, { requestId: 'b', text: 'other row', highlighted: true }),
    entry(2, { requestId: 'a', text: 'cleared', highlighted: false }),
    entry(1),
    entry(0, { requestId: 'a', text: 'one', highlighted: true }),
  ]
  expect(highlightsFor(list, 'a').map(o => o.text)).toEqual(['two', 'one'])
  expect(highlightsFor(list, 'b').map(o => o.text)).toEqual(['other row'])
  expect(highlightsFor(list, 'none')).toEqual([])
  expect(highlightsFor([], 'a')).toEqual([])
})

test('clearHighlight: that entry alone loses it; the others, on the same row or not, keep theirs', () => {
  const list = [
    entry(3, { requestId: 'a', text: 'x', highlighted: true }),
    entry(2, { requestId: 'a', text: 'x', highlighted: true }),
    entry(1),
  ]
  const cleared = clearHighlight(list, 3)
  expect(cleared.map(r => r.origin?.highlighted)).toEqual([false, true, undefined])
  expect(highlightsFor(cleared, 'a')).toHaveLength(1)
  // An entry with no origin is left as it was, as is an unknown ID.
  expect(clearHighlight(list, 1)).toEqual(list)
  expect(clearHighlight(list, 99)).toEqual(list)
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
// The highlight and the buttons, every way an action on the selection runs

for (const surface of SURFACES) {
  test(`[${surface}] an icon on a selection in one row highlights that row alone, and the result gets both buttons`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, 'exit 137 is SIGKILL', ASSISTANT_ROW.requestId)

    // Before: nothing highlighted.
    expect(await isHighlighted($, ASSISTANT_ROW, surface)).toBe(false)
    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'explain' })
    await band.unmount()

    expect(await isHighlighted($, ASSISTANT_ROW, surface)).toBe(true)
    // Every other row is the engine's drawing as it was.
    expect(await isHighlighted($, OTHER_ASSISTANT_ROW, surface)).toBe(false)
    expect(await isHighlighted($, USER_ROW, surface)).toBe(false)

    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ key: GOTO(1) }))?.props.label).toBe(MESSAGES.en.gotoSelection)
    expect((await pane.find({ key: UNMARK(1) }))?.props.label).toBe(MESSAGES.en.clearHighlight)
    // The result itself as ever.
    expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
    await pane.unmount()
  })
}

test('a row already drawn is redrawn highlighted, and drawn again as the engine draws it once cleared', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const row = await $.ui.mount({ ...USER_ROW, surface: 'terminal' })
  expect(((await row.drawn()) as unknown as { props: Record<string, unknown> }).props['backgroundColor']).toBeUndefined()
  await select(s, clock, 'exit 137', USER_ROW.requestId)
  await pressIcon($, 'explain')
  const drawn = (await row.drawn()) as unknown as { props: Record<string, unknown> }
  expect(drawn.props['backgroundColor']).toBe(HIGHLIGHT)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: UNMARK(1) })
  await pane.unmount()
  const after = (await row.drawn()) as unknown as { key?: string; props: Record<string, unknown> }
  expect(after.props['backgroundColor']).toBeUndefined()
  expect(await row.find({ key: 'engine' })).toBeDefined()
  await row.unmount()
})

test('a selection in a tool row highlights both the call and its result block, which share its id', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'Killed process 4242', TOOL_RESULT_ROW.requestId)
  await pressIcon($, 'explain')
  expect(await isHighlighted($, TOOL_USE_ROW)).toBe(true)
  expect(await isHighlighted($, TOOL_RESULT_ROW)).toBe(true)
})

test('two actions on one selection: two results, two pairs of buttons; clearing one leaves the other, the row still highlighted', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  await reselect(s, clock)
  await pressIcon($, 'translate-ja')

  expect(await paneKeys($)).toEqual([GOTO(2), UNMARK(2), GOTO(1), UNMARK(1)])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: UNMARK(2) })
  // Its clear button goes; its go-to stays; the other result keeps both.
  expect(await pane.find({ key: UNMARK(2) })).toBeUndefined()
  expect(await pane.find({ key: GOTO(2) })).toBeDefined()
  expect(await pane.find({ key: UNMARK(1) })).toBeDefined()
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(true)

  await pane.press({ key: UNMARK(1) })
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(false)
  expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).toEqual([GOTO(2), GOTO(1)])
  await pane.unmount()
})

test('clearing one row leaves another row highlighted', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  await select(s, clock, 'memory limit', OTHER_ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: UNMARK(1) })
  await pane.unmount()
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(false)
  expect(await isHighlighted($, OTHER_ASSISTANT_ROW)).toBe(true)
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
  expect(await pane.find({ key: UNMARK(1) })).toBeDefined()
  expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
  await pane.unmount()
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(true)
  expect(s.models).toHaveLength(1)
})

// The kit cannot raise the person's close of the pane (its $ has no ui.close;
// see tests/standalone.test.tsx), whose hook only stops runs over time and
// leaves the results as they are. The pane drawn and let go leaves the
// highlight, as does a later run of another kind.
test('the highlight stays with the pane gone and after other runs, until cleared', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.unmount()
  await clock.advance(10_000)
  await runCommand($, 'recap')
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(true)
})

test('a selection with no row named, a context action and a standalone action: no highlight, no buttons, results as ever', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  // Over several rows (or in a pane): the engine names none.
  await select(s, clock, 'exit 137', null)
  await pressIcon($, 'explain')
  await runCommand($, 'recap')
  await runCommand($, 'timer 10s')

  for (const row of [USER_ROW, ASSISTANT_ROW, TOOL_USE_ROW, TOOL_RESULT_ROW]) expect(await isHighlighted($, row)).toBe(false)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = (await pane.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys.filter(k => k?.startsWith('_goto') || k?.startsWith('_unmark'))).toEqual([])
  expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
  expect(await pane.find({ text: 'answer in context' })).toBeDefined()
  await pane.unmount()
})

test('a context or standalone action run while a selection in a row is there highlights nothing', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  // From the hint line (a context action), and by the command (a standalone one).
  await pressIcon($, 'recap')
  await reselect(s, clock)
  await runCommand($, 'timer 10s')
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(false)
  expect((await paneKeys($)).filter(k => k?.startsWith('_goto') || k?.startsWith('_unmark'))).toEqual([])
})

test('the command /quick-actions <id> carries the row', { options: EN }, async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  s.selectedRow = ASSISTANT_ROW.requestId
  await runCommand($, 'explain')
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(true)
  expect(await paneKeys($)).toEqual([GOTO(1), UNMARK(1)])
})

test('a pick in the ⋯ dialog carries the row it opened on, whatever is selected by then', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, '_more')
  s.selected = 'something else'
  s.selectedRow = USER_ROW.requestId
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.select({ key: PICKER_SELECT, value: 'explain' })
  await picker.unmount()
  expect(s.models[0]?.prompt).toContain('exit 137')
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(true)
  expect(await isHighlighted($, USER_ROW)).toBe(false)
})

test('/quick-actions with no ID opens the ⋯ dialog on the selection and its row', { options: EN }, async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  s.selectedRow = USER_ROW.requestId
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.select({ key: PICKER_SELECT, value: 'explain' })
  await picker.unmount()
  expect(await isHighlighted($, USER_ROW)).toBe(true)
})

test('/quick-actions hint holds the row with the text: a press there highlights it', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
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
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(true)
  expect(await paneKeys($)).toEqual([GOTO(1), UNMARK(1)])
})

test('the ⋯ dialog from the line /quick-actions hint holds carries its row too', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
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
  await picker.select({ key: PICKER_SELECT, value: 'explain' })
  await picker.unmount()
  expect(await isHighlighted($, TOOL_USE_ROW)).toBe(true)
})

test('an entry pushed out of the pane takes its highlight with it', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
  await pressIcon($, 'explain')
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(true)
  // KEEP (20) more runs on no row push it out.
  s.selectedRow = null
  for (let i = 0; i < 20; i++) await runCommand($, 'explain')
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(false)
})

// The results outlive a reload of the module, whose own count of entries
// starts again. Entries far past any count a test could reach (100, 101) are
// laid in the state as a reload leaves them: a new entry must take an ID past
// them, so that clearing its highlight clears its own and no other's.
test('after a reload, a new entry takes an ID past every entry kept, and clearing it leaves the kept ones', { options: EN }, async ($, on) => {
  const KEPT: Result[] = [
    entry(101, { requestId: OTHER_ASSISTANT_ROW.requestId, text: 'memory limit', highlighted: true }),
    entry(100, { requestId: ASSISTANT_ROW.requestId, text: 'exit 137', highlighted: true }),
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

  expect(await paneKeys($)).toEqual([GOTO(102), UNMARK(102), GOTO(101), UNMARK(101), GOTO(100), UNMARK(100)])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: UNMARK(102) })
  await pane.unmount()
  expect(await isHighlighted($, USER_ROW)).toBe(false)
  expect(await isHighlighted($, ASSISTANT_ROW)).toBe(true)
  expect(await isHighlighted($, OTHER_ASSISTANT_ROW)).toBe(true)
})

// ---------------------------------------------------------------------------
// The buttons' words and colours

for (const surface of SURFACES) {
  for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
    test(`[${surface}] [${options.language}] the buttons say so in the language`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
      await pressIcon($, 'explain')
      const pane = await $.ui.mount({ ...PANE, surface })
      const labels = (await pane.findAll({ type: 'Button' })).map(b => b.props.label)
      expect(labels).toEqual([t.gotoSelection, t.clearHighlight])
      if (options.language === 'en') for (const label of labels) expect(String(label)).not.toMatch(JAPANESE)
      await pane.unmount()
    })
  }
}

for (const paneTheme of ['light', 'dark'] as const) {
  test(`[${paneTheme}] the buttons are drawn in the palette's muted colour`, { options: { ...EN, paneTheme } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, 'exit 137', ASSISTANT_ROW.requestId)
    await pressIcon($, 'explain')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    for (const text of [MESSAGES.en.gotoSelection, MESSAGES.en.clearHighlight]) {
      const label = (await pane.findAll({ text })).filter(f => f.type === 'Text')
      expect(label.map(f => f.props.color)).toEqual([paneStyle(paneTheme, 'dock').muted])
    }
    await pane.unmount()
  })
}
