import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, DEFAULT_ACTION_IDS, isContext, isStandalone, markedIcon, needsSelection } from '../hooks/actions'
import {
  HALF_LIFE_MS,
  arrange,
  decayed,
  defaultsLead,
  orderActions,
  parsePins,
  parseUsage,
  pickerKindFor,
  pickerList,
  pickerOrder,
  recordUse,
  settleIn,
} from '../hooks/order'
import type { OrderSlot } from '../hooks/order'
import type { Usage } from '../hooks/order'
import { BAND, PICKER_PANE, pickAction, hintIcons, listedActions, reselect, runCommand, stage, start, storedUsage } from './stage'

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
  expect(withSelection.slice(7, 9)).toEqual(['translate-en', 'translate-zh'])
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

// ---------------------------------------------------------------------------
// On the hint line

const iconOf = (id: string) => markedIcon(ACTIONS.find(a => a.id === id)!)

const iconsOf = async ($: Engine) => {
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const icons = (await hintIcons(band))
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
  expect(icons).toEqual([...['tldr', 'why', 'translate-ja', 'translate-en', 'translate-zh', 'translate-zh-tw'].map(iconOf), '✕', '⋯'])
})

test('a broken store still shows the default order', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on, { store: { usage: 'not an object' } })
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  expect(await iconsOf($)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '[🔤]', '[🀄]', '✕', '⋯'])
})

test('pins beyond what fits wait under ⋯', { options: { pinActions: 'why,tldr,ask,code' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  // Two fit on an 80-column line beside the permission mode.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: { columns: 80, rows: 40, isFullscreen: false } })
  expect(await hintIcons(band)).toEqual([iconOf('why'), iconOf('tldr'), '✕', '⋯'])
  await band.unmount()
})

test('uses during the session are recorded and move the hint line from the next selection', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  const before = await iconsOf($)
  expect(before[0]).toBe(iconOf('explain'))

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'summarize' })
  await clock.settle()
  // The line the press put away comes back on the next selection, the one used first.
  await reselect(s, clock)
  const once = await iconsOf($)
  expect(once[0]).toBe(iconOf('summarize'))
  expect(once).not.toEqual(before)

  // One used more, later in the session, overtakes it.
  for (let i = 0; i < 2; i++) {
    await reselect(s, clock)
    await band.press({ key: 'translate-ja' })
    await clock.settle()
  }
  await band.unmount()

  const usage = await storedUsage(s)
  expectNear(usage?.['summarize']?.score, 1)
  expectNear(usage?.['translate-ja']?.score, 2)
  await reselect(s, clock)
  expect((await iconsOf($)).slice(0, 2)).toEqual([iconOf('translate-ja'), iconOf('summarize')])
})

test('the ⋯ dialog follows a use during the session too', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on)
  await start($)
  await runCommand($, 'uuid')
  await clock.settle()
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  expect((await listedActions(picker))[0]).toBe('uuid')
  await picker.unmount()
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
  await pickAction(picker, 'tldr')
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

// ---------------------------------------------------------------------------
// The ⋯ dialog's order (SELM-00068): the settled order as it is, the most used
// first whatever their kind (no arrange), the default set aside; one kind at a
// time when its kind buttons switch it.

test('pickerOrder: the settled order as it is; the order of definition while the default set leads it', () => {
  const usage: Usage = { 'recap': at(5), 'timer': at(3), 'explain': at(3), 'translate-en': at(1) }
  const ordered = orderActions(ACTIONS, [], usage, NOW)
  const order = pickerOrder(ordered, ACTIONS, defaultsLead(ACTIONS, [], usage, NOW))
  // Highest first, whatever the kind (a context, a standalone and a selection action mixed); ties in the order of definition.
  expect(ids(order.slice(0, 4))).toEqual(['recap', 'explain', 'timer', 'translate-en'])
  expect(ACTIONS.findIndex(a => a.id === 'explain')).toBeLessThan(ACTIONS.findIndex(a => a.id === 'timer'))
  // The unused after them, in the order of definition.
  const rest = order.slice(4)
  expect(ids(rest)).toEqual(ids(ACTIONS.filter(a => !(a.id in usage))))
  // Pins first, then the scores.
  const pins = parsePins(ACTIONS, 'why,timer')
  const pinned = pickerOrder(orderActions(ACTIONS, pins, usage, NOW), ACTIONS, defaultsLead(ACTIONS, pins, usage, NOW))
  expect(ids(pinned.slice(0, 5))).toEqual(['why', 'timer', 'recap', 'explain', 'translate-en'])
  // No pin and no usage: the order of definition, the default set not led.
  expect(defaultsLead(ACTIONS, [], {}, NOW)).toBe(true)
  const fresh = pickerOrder(orderActions(ACTIONS, [], {}, NOW), ACTIONS, true)
  expect(ids(fresh)).toEqual(ids(ACTIONS))
  expect(ids(fresh.slice(0, DEFAULT_ACTION_IDS.length))).not.toEqual([...DEFAULT_ACTION_IDS])
  // A copy, never the array handed in.
  expect(fresh).not.toBe(ACTIONS)
})

test('pickerKindFor: the kind switched to, every kind (undefined) as it opens; the selection\'s needs text', () => {
  expect(pickerKindFor(undefined, true)).toBeUndefined()
  expect(pickerKindFor(undefined, false)).toBeUndefined()
  expect(pickerKindFor('selection', true)).toBe('selection')
  expect(pickerKindFor('selection', false)).toBeUndefined()
  expect(pickerKindFor('context', false)).toBe('context')
  expect(pickerKindFor('standalone', true)).toBe('standalone')
})

test('pickerList: without text the selection\'s left out; a kind switched to, that kind alone; the order kept', () => {
  const usage: Usage = { 'recap': at(5), 'timer': at(3), 'explain': at(3) }
  const order = pickerOrder(orderActions(ACTIONS, [], usage, NOW), ACTIONS, false)
  expect(ids(pickerList(order, true, undefined))).toEqual(ids(order))
  expect(ids(pickerList(order, false, undefined))).toEqual(ids(order.filter(a => !needsSelection(a))))
  expect(ids(pickerList(order, true, 'selection'))).toEqual(ids(order.filter(a => needsSelection(a))))
  expect(ids(pickerList(order, true, 'context'))).toEqual(ids(order.filter(isContext)))
  expect(ids(pickerList(order, false, 'standalone'))).toEqual(ids(order.filter(isStandalone)))
  // Each kind keeps the one order: the most used of it first.
  expect(pickerList(order, true, 'selection')[0]?.id).toBe('explain')
  expect(pickerList(order, true, 'context')[0]?.id).toBe('recap')
  expect(pickerList(order, true, 'standalone')[0]?.id).toBe('timer')
  // The selection's without text: pickerKindFor makes it every kind there is (no selection action).
  expect(ids(pickerList(order, false, pickerKindFor('selection', false)))).toEqual(ids(order.filter(a => !needsSelection(a))))
  // Not arranged: a context action used most comes before the selection's.
  expect(pickerList(order, true, undefined)[0]?.id).toBe('recap')
  expect(ids(arrange(order, [], true)).indexOf('recap')).toBeGreaterThan(0)
})
