import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, DEFAULT_ACTION_IDS, markedIcon } from '../hooks/actions'
import {
  DEFAULT_HINT_COUNT,
  HALF_LIFE_MS,
  arrange,
  decayed,
  defaultsLead,
  orderActions,
  parseHintCount,
  parsePins,
  parseUsage,
  recordUse,
  settleIn,
} from '../hooks/order'
import type { OrderSlot } from '../hooks/order'
import type { Usage } from '../hooks/order'
import { BAND, PICKER_PANE, PICKER_SELECT, reselect, runCommand, stage, start, storedUsage } from './stage'

// The hint line's order: pins, then the usage score (halving every 30 days),
// ties in the order of definition; with no pin and no usage, the default set
// leads. Pure functions first, then the plugin as the person meets it.

// Equal but for rounding, and for the decay over the few seconds a test moves the clock.
const expectNear = (received: number | undefined, expected: number) =>
  expect(Math.abs((received ?? Number.NaN) - expected) < 1e-4).toBe(true)

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_000 * DAY
const ids = (defs: readonly { id: string }[]) => defs.map(d => d.id)
const at = (score: number, when = NOW) => ({ score, at: when })

// ---------------------------------------------------------------------------
// The score

test('decayed: half after 30 days, a quarter after 60, nothing for none', () => {
  expect(HALF_LIFE_MS).toBe(30 * DAY)
  expect(decayed(at(8, NOW), NOW)).toBe(8)
  expectNear(decayed(at(8, NOW - 30 * DAY), NOW), 4)
  expectNear(decayed(at(8, NOW - 60 * DAY), NOW), 2)
  expect(decayed(undefined, NOW)).toBe(0)
})

test('decayed: a clock that went back decays nothing', () => {
  expect(decayed(at(3, NOW + DAY), NOW)).toBe(3)
})

test('recordUse: 1 for a first use, the decayed score plus 1 after; the others are kept', () => {
  const first = recordUse({}, 'explain', NOW)
  expect(first).toEqual({ explain: { score: 1, at: NOW } })

  const later = recordUse({ explain: at(4, NOW - 30 * DAY), gone: at(9, NOW) }, 'explain', NOW)
  expectNear(later['explain']?.score, 3)
  expect(later['explain']?.at).toBe(NOW)
  // An ID no action has any more stays, for when its definition comes back.
  expect(later['gone']).toEqual(at(9, NOW))
})

test('parseUsage: anything but an object is no usage; unusable entries are dropped', () => {
  for (const raw of [undefined, null, 42, 'usage', [1, 2], true]) expect(parseUsage(raw)).toEqual({})
  expect(
    parseUsage({
      ok: { score: 2, at: NOW },
      negative: { score: -1, at: NOW },
      nan: { score: Number.NaN, at: NOW },
      noTime: { score: 1 },
      text: { score: '3', at: NOW },
      notObject: 5,
      nothing: null,
    }),
  ).toEqual({ ok: { score: 2, at: NOW } })
})

// ---------------------------------------------------------------------------
// The order

test('orderActions: no pins and no usage: the default set leads, the rest in the order of definition', () => {
  const order = ids(orderActions(ACTIONS, [], {}, NOW))
  expect(order.slice(0, DEFAULT_ACTION_IDS.length)).toEqual([...DEFAULT_ACTION_IDS])
  const rest = ids(ACTIONS).filter(id => !DEFAULT_ACTION_IDS.includes(id))
  expect(order.slice(DEFAULT_ACTION_IDS.length)).toEqual(rest)
  expect(order).toHaveLength(ACTIONS.length)
})

test('orderActions: the pins lead in their order; with no usage the rest keep the order of definition', () => {
  const pins = parsePins(ACTIONS, 'summarize,explain')
  const order = ids(orderActions(ACTIONS, pins, {}, NOW))
  expect(order.slice(0, 2)).toEqual(['summarize', 'explain'])
  expect(order.slice(2)).toEqual(ids(ACTIONS).filter(id => id !== 'summarize' && id !== 'explain'))
})

test('orderActions: the rest by score, highest first, after the pins', () => {
  const usage: Usage = { why: at(5), tldr: at(2), summarize: at(9) }
  const pins = parsePins(ACTIONS, 'summarize')
  const order = ids(orderActions(ACTIONS, pins, usage, NOW))
  // summarize is pinned: its score does not move it.
  expect(order.slice(0, 3)).toEqual(['summarize', 'why', 'tldr'])
})

test('orderActions: ties and unused ones keep the order of definition', () => {
  const usage: Usage = { why: at(2), ask: at(2), code: at(2) }
  const order = ids(orderActions(ACTIONS, [], usage, NOW))
  // Equal scores: ask, code, why as defined; then the unused, as defined.
  expect(order.slice(0, 3)).toEqual(['ask', 'code', 'why'])
  expect(order.slice(3)).toEqual(ids(ACTIONS).filter(id => !['ask', 'code', 'why'].includes(id)))
})

test('orderActions: once anything is used, the default set no longer leads', () => {
  const order = ids(orderActions(ACTIONS, [], { tldr: at(1) }, NOW))
  expect(order[0]).toBe('tldr')
  expect(order.slice(1)).toEqual(ids(ACTIONS).filter(id => id !== 'tldr'))
})

test('orderActions: an old high score decays below a recent low one', () => {
  const usage: Usage = { why: at(6, NOW - 90 * DAY), tldr: at(1, NOW) }
  // why: 6 / 8 = 0.75 now, under tldr's 1.
  expect(ids(orderActions(ACTIONS, [], usage, NOW)).slice(0, 2)).toEqual(['tldr', 'why'])
  // A month earlier it was still ahead.
  expect(ids(orderActions(ACTIONS, [], { why: at(6, NOW - 90 * DAY), tldr: at(1, NOW - 60 * DAY) }, NOW - 60 * DAY)).slice(0, 2)).toEqual(['why', 'tldr'])
})

test('orderActions: the score of an action that does not exist is ignored', () => {
  // Only a removed action was used: as good as no usage, so the default set leads.
  expect(ids(orderActions(ACTIONS, [], { gone: at(50) }, NOW)).slice(0, DEFAULT_ACTION_IDS.length)).toEqual([...DEFAULT_ACTION_IDS])
  // Beside a real one, it changes nothing.
  const order = ids(orderActions(ACTIONS, [], { gone: at(50), why: at(1) }, NOW))
  expect(order[0]).toBe('why')
  expect(order).not.toContain('gone')
})

// ---------------------------------------------------------------------------
// Laid out for the moment: arrange

// Two of each kind, in a mixed order as orderActions might settle it.
const MIXED = [
  { id: 'ctx-a', target: 'context' as const },
  { id: 'sel-a' },
  { id: 'none-a', target: 'none' as const },
  { id: 'sel-b', target: 'selection' as const },
  { id: 'ctx-b', target: 'context' as const },
  { id: 'none-b', target: 'none' as const },
]

test('arrange: with a selection, the actions on it first, then the others mixed, each in the order given', () => {
  expect(ids(arrange(MIXED, [], true))).toEqual(['sel-a', 'sel-b', 'ctx-a', 'none-a', 'ctx-b', 'none-b'])
})

test('arrange: with none, the actions on the selection are left out', () => {
  expect(ids(arrange(MIXED, [], false))).toEqual(['ctx-a', 'none-a', 'ctx-b', 'none-b'])
})

test('arrange: pins of any kind lead in their order; with no selection, the pinned actions on it are left out', () => {
  const pins = [{ id: 'none-b' }, { id: 'sel-b' }, { id: 'ctx-b' }]
  expect(ids(arrange(MIXED, pins, true))).toEqual(['none-b', 'sel-b', 'ctx-b', 'sel-a', 'ctx-a', 'none-a'])
  expect(ids(arrange(MIXED, pins, false))).toEqual(['none-b', 'ctx-b', 'ctx-a', 'none-a'])
  // A pin no action has is skipped.
  expect(ids(arrange(MIXED, [{ id: 'gone' }], true))).toEqual(['sel-a', 'sel-b', 'ctx-a', 'none-a', 'ctx-b', 'none-b'])
})

test('arrange: the default set, when it leads, comes first, its actions on the selection before its others', () => {
  const ordered = orderActions(ACTIONS, [], {}, NOW)
  const defaults = DEFAULT_ACTION_IDS.map(id => ({ id }))
  const withSelection = ids(arrange(ordered, [], true, defaults))
  expect(withSelection.slice(0, 7)).toEqual(['explain', 'translate-ja', 'summarize', 'code', 'recap', 'decisions', 'timer'])
  // Then the rest, the actions on the selection first.
  expect(withSelection.slice(7, 9)).toEqual(['translate-en', 'eli5'])
  expect(withSelection).toHaveLength(ACTIONS.length)
  expect(ids(arrange(ordered, [], false, defaults)).slice(0, 4)).toEqual(['recap', 'decisions', 'timer', 'todo'])
  // As drawn on the hint line: [💡] [🌐] [📝] [🔎] <🧭> <✅>, and with no selection <🧭> <✅> {⏳}.
  expect(arrange(ordered, [], true, defaults).slice(0, 6).map(markedIcon)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '<🧭>', '<✅>'])
  expect(arrange(ordered, [], false, defaults).slice(0, 3).map(markedIcon)).toEqual(['<🧭>', '<✅>', '{⏳}'])
})

test('defaultsLead: only with no pins and no usage of an action that exists', () => {
  expect(defaultsLead(ACTIONS, [], {}, NOW)).toBe(true)
  expect(defaultsLead(ACTIONS, [], { gone: at(5) }, NOW)).toBe(true)
  expect(defaultsLead(ACTIONS, [], { why: at(1) }, NOW)).toBe(false)
  expect(defaultsLead(ACTIONS, parsePins(ACTIONS, 'why'), {}, NOW)).toBe(false)
})

test('parseHintCount: a whole number of 1 or more, else 6', () => {
  expect(DEFAULT_HINT_COUNT).toBe(6)
  expect(parseHintCount(undefined)).toBe(6)
  expect(parseHintCount('3')).toBe(3)
  expect(parseHintCount(' 3 ')).toBe(3)
  expect(parseHintCount(3)).toBe(3)
  expect(parseHintCount('12')).toBe(12)
  for (const bad of ['0', '-1', '2.5', 'abc', '', 0, -2, 2.5, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
    expect(parseHintCount(bad)).toBe(6)
  }
})

// ---------------------------------------------------------------------------
// On the hint line

const iconOf = (id: string) => markedIcon(ACTIONS.find(a => a.id === id)!)

const iconsOf = async ($: Engine) => {
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const icons = (await band.findAll({ type: 'Button' })).map(b => b.props.label)
  await band.unmount()
  return icons
}

test('the hint line follows the stored scores', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on, { store: { usage: { why: at(3), tldr: at(5), web: at(99) } } })
  await start($)
  s.selected = 'some text'
  await clock.advance(400)

  // tldr then why, then the unused in the order of definition; `web` is no action.
  const icons = await iconsOf($)
  expect(icons).toEqual([...['tldr', 'why', 'translate-ja', 'translate-en', 'explain', 'eli5'].map(iconOf), '✕', '⋯'])
})

test('a broken store still shows the default order', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on, { store: { usage: 'not an object' } })
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  expect(await iconsOf($)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '<🧭>', '<✅>', '✕', '⋯'])
})

for (const [hintCount, shown] of [['3', 3], ['1', 1], ['20', 20], ['30', ACTIONS.length], ['0', 6], ['many', 6]] as const) {
  test(`hintCount ${hintCount}: ${shown} actions on the hint line`, { options: { hintCount } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'some text'
    await clock.advance(400)
    const icons = await iconsOf($)
    expect(icons).toHaveLength(shown + 2)
    expect(icons.slice(-2)).toEqual(['✕', '⋯'])
  })
}

test('pins beyond hintCount wait under ⋯', { options: { actions: 'why,tldr,ask,code', hintCount: '2' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  expect(await iconsOf($)).toEqual([iconOf('why'), iconOf('tldr'), '✕', '⋯'])
})

test('uses during the session are recorded but do not move the hint line', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  const before = await iconsOf($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  for (let i = 0; i < 3; i++) {
    await reselect(s, clock)
    await band.press({ key: 'summarize' })
  }
  await band.unmount()
  await clock.settle()

  const usage = await storedUsage(s)
  expectNear(usage?.['summarize']?.score, 3)
  await reselect(s, clock)
  expect(await iconsOf($)).toEqual(before)
})

test('a new session settles the order from the usage so far', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on, { store: { usage: { eli5: at(3) } } })
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  expect((await iconsOf($))[0]).toBe(iconOf('eli5'))
})

test('every way of running records a use: the hint line, the ⋯ dialog and the command', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'explain' })
  await clock.settle()
  expect(Object.keys((await storedUsage(s)) ?? {})).toEqual(['explain'])

  await reselect(s, clock)
  await band.press({ key: '_more' })
  await band.unmount()
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.select({ key: PICKER_SELECT, value: 'tldr' })
  await picker.unmount()
  await clock.settle()

  await runCommand($, 'why')
  await clock.settle()

  const usage = (await storedUsage(s)) ?? {}
  expect(Object.keys(usage).sort()).toEqual(['explain', 'tldr', 'why'])
  for (const entry of Object.values(usage)) expect(entry).toEqual({ score: 1, at: expect.any(Number) })
})

test('a use adds to the decayed score kept from before', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on, { store: { usage: { why: at(4, NOW - 30 * DAY) } } })
  await start($)
  s.selected = 'some text'
  await runCommand($, 'why')
  await clock.settle()
  const usage = await storedUsage(s)
  expectNear(usage?.['why']?.score, 3)
  expect(usage?.['why']?.at).toBe(NOW)
})

// ---------------------------------------------------------------------------
// The settled order belongs to the load that settled it.

test('settleIn computes once per slot and shares it with every ask', async () => {
  const slot: OrderSlot = {}
  let calls = 0
  const compute = async () => {
    calls++
    return ['explain']
  }
  const [a, b] = await Promise.all([settleIn(slot, compute), settleIn(slot, compute)])
  expect(await settleIn(slot, compute)).toEqual(['explain'])
  expect(a).toEqual(['explain'])
  expect(b).toEqual(['explain'])
  expect(calls).toBe(1)
})

// A reload (a settings change) gives the new load a slot of its own: a
// settling the earlier load started, finishing after the reload, lands in the
// earlier slot and never becomes the new load's order.
test('a settling an earlier load started never becomes a later load\'s order', async () => {
  let finishOld: (ids: readonly string[]) => void = () => {}
  const oldSlot: OrderSlot = {}
  const oldOrder = settleIn(oldSlot, () => new Promise(resolve => (finishOld = resolve)))

  // The reload: a fresh slot, with the new custom action in it.
  const newSlot: OrderSlot = {}
  finishOld(['explain', 'translate-ja'])
  await oldOrder
  expect(await settleIn(newSlot, async () => ['explain', 'translate-ja', 'mine'])).toEqual(['explain', 'translate-ja', 'mine'])
  expect(await oldOrder).toEqual(['explain', 'translate-ja'])
})
