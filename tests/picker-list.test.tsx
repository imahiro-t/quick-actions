import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { FIXED_ROWS, buttonLines, linesOf } from '../hooks/picker-rows'
import { BAND, EN, JA, PANE, PICKER_CLOSE, PICKER_FILTER, PICKER_FILTER_CLEAR, PICKER_LIST, PICKER_PANE, SURFACES, listBox, listedActions, listedCount, listedOptions, pickAction, promptOf, stage, start, storedUsage } from './stage'
import type { Clock, Stage } from './stage'

// The ⋯ dialog's list as buttons (SELM-00059): there as the dialog opens, as
// many as the pane's height holds (each button's rows from its label's
// width), a line under it saying how many more the filter reaches, and none
// of a drop-down's own text (a heading, "none", "… n more").

const SELECTED = 'ECONNREFUSED 127.0.0.1:3306'
const MORE = '_more'

async function openByMore($: Engine, s: Stage, clock: Clock, surface: (typeof SURFACES)[number] | 'mobile' = 'terminal') {
  s.selected = SELECTED
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface })
  await band.press({ key: MORE })
  await band.unmount()
}

const at = (bodyRows: number, bodyColumns = 60, isFocused = true) => ({ ...PICKER_PANE.props, bodyColumns, isFocused, scroll: { offset: 0, bodyRows } })

type Node = { type?: string; props?: { key?: unknown }; children?: unknown[] }

/** The texts of the Text elements drawn outside the list's Box, in document order. */
function textsOutsideList(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return []
  const n = node as Node
  if (n.type === 'Box' && String(n.props?.key ?? '').startsWith(PICKER_LIST)) return []
  if (n.type === 'Text') return [(n.children ?? []).filter(c => typeof c === 'string').join('')]
  return (n.children ?? []).flatMap(textsOutsideList)
}

/** Every string drawn outside the list's Box: texts, and the labels and placeholders of the rest. */
function stringsOutsideList(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return typeof node === 'string' ? [node] : []
  const n = node as Node & { props?: Record<string, unknown> }
  if (n.type === 'Box' && String(n.props?.key ?? '').startsWith(PICKER_LIST)) return []
  const own = ['label', 'placeholder', 'submitLabel', 'value'].flatMap(k => (typeof n.props?.[k] === 'string' ? [String(n.props[k])] : []))
  return [...own, ...(n.children ?? []).flatMap(stringsOutsideList)]
}

for (const surface of SURFACES) {
  test(`[${surface}] the list is there as the dialog opens: buttons, no drop-down to open`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openByMore($, s, clock, surface)

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    expect(await picker.find({ type: 'Select' })).toBeUndefined()
    const listed = await listedOptions(picker)
    expect(listed.length).toBeGreaterThan(0)
    // Each is a button of its own, its label the marked icon and the action's name.
    for (const o of listed) expect((await picker.find({ key: o.value }))?.type).toBe('Button')
    expect(await listedCount(picker)).toBe(listed.length)
    await picker.unmount()
  })

  for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
    test(`[${surface}] [${options.language}] outside the list, only the dialog's own lines: no heading, "none" or "… n more"`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      await openByMore($, s, clock, surface)
      const total = ACTIONS.length

      // Focused, cut short: the legend and the "n more" line.
      const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(30) })
      let n = (await listedActions(picker)).length
      expect(textsOutsideList(await picker.drawn())).toEqual([t.pickerLegend(true), t.pickerMore(total - n)])
      // Without the keyboard: the notice first.
      await picker.redraw(at(30, 60, false))
      n = (await listedActions(picker)).length
      expect(textsOutsideList(await picker.drawn())).toEqual([t.pickerNoFocus, t.pickerLegend(true), t.pickerMore(total - n)])
      // Narrowed to a few, all listed: no "n more" line.
      await picker.redraw(at(30))
      await picker.input({ key: PICKER_FILTER, text: 'translate-zh', kind: 'change' })
      expect((await listedActions(picker)).length).toBeGreaterThan(0)
      expect(textsOutsideList(await picker.drawn())).toEqual([t.pickerLegend(true)])
      // Nothing left: the line that says so.
      await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
      expect(textsOutsideList(await picker.drawn())).toEqual([t.pickerLegend(true), t.pickerNoMatch])

      // A drop-down's own wording, anywhere outside the list: its heading
      // (the old "Action: " / "アクション: ", or one with a colon doubled),
      // its "none" after a colon, its "… n more".
      await picker.input({ key: PICKER_FILTER, text: '', kind: 'change' })
      for (const line of stringsOutsideList(await picker.drawn())) {
        expect(line).not.toMatch(/…\s*\d+\s*more/)
        expect(line).not.toMatch(/[:：]\s*[:：]/)
        expect(line).not.toMatch(/[:：]\s*none\b/i)
        expect(line).not.toMatch(/^(Action|アクション)\s*[:：]/)
      }
      expect(await picker.find({ type: 'Select' })).toBeUndefined()
      // The buttons outside the list are the dialog's own (Clear, Close).
      const inList = await listedActions(picker)
      const outside = (await picker.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => !inList.includes(k))
      expect(outside.every(k => k === PICKER_CLOSE || k === PICKER_FILTER_CLEAR)).toBe(true)
      await picker.unmount()
    })
  }

  test(`[${surface}] long labels wrap: fewer are listed, and the rows they take stay within the pane's`, { options: { ...EN, ...longActions(12) } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openByMore($, s, clock, surface)
    const rowsUsed = (labels: string[], total: number, columns: number) =>
      FIXED_ROWS + linesOf(MESSAGES.en.pickerLegend(true), columns) + linesOf(MESSAGES.en.pickerMore(total - labels.length), columns) + labels.reduce((sum, l) => sum + buttonLines(l, columns), 0)

    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(30, 34) })
    const listed = await listedOptions(picker)
    // The long ones, pinned, lead; each wraps to two rows or more.
    expect(listed.slice(0, 3).map(o => o.value)).toEqual(['long-0', 'long-1', 'long-2'])
    for (const o of listed.filter(o => o.value.startsWith('long-'))) expect(buttonLines(o.label, 34)).toBeGreaterThanOrEqual(2)
    expect(rowsUsed(listed.map(o => o.label), ACTIONS.length + 12, 34)).toBeLessThanOrEqual(30)
    // Fewer than one-row labels would fill: 30 rows less the legend, the "n more" line, the filter row and Close.
    const oneRowEach = 30 - FIXED_ROWS - linesOf(MESSAGES.en.pickerLegend(true), 34) - linesOf(MESSAGES.en.pickerMore(1), 34)
    expect(listed.length).toBeLessThan(oneRowEach)
    await picker.unmount()
  })

  test(`[${surface}] pickAction: an action not listed is reached through the filter; one whose ID others share a start with is the one pressed`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openByMore($, s, clock, surface)

    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(9) })
    expect(await listedActions(picker)).not.toContain('translate-zh')
    // Typed in the filter, translate-zh leaves translate-zh-tw too; its own button is pressed, not the first.
    await picker.input({ key: PICKER_FILTER, text: 'translate-zh', kind: 'change' })
    const left = await listedActions(picker)
    expect(left).toContain('translate-zh')
    expect(left).toContain('translate-zh-tw')
    await picker.input({ key: PICKER_FILTER, text: '', kind: 'change' })
    await pickAction(picker, 'translate-zh')
    await picker.unmount()
    expect(Object.keys(storedUsage(s) ?? {})).toContain('translate-zh')
    expect(Object.keys(storedUsage(s) ?? {})).not.toContain('translate-zh-tw')
    expect(s.models).toHaveLength(1)
    expect(s.models[0]?.system).toBe(promptOf(actionsFor('ja').find(d => d.id === 'translate-zh')))
    expect(s.shown).toBe(PANE.requestId)
  })

  test(`[${surface}] pickAction fails the test, never silently, on an action that is not there`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openByMore($, s, clock, surface)
    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await expect(pickAction(picker, 'no-such-action')).rejects.toThrow(/no-such-action/)
    await picker.unmount()
    expect(s.models).toEqual([])
  })
}

test('[mobile] no filter field: every action is listed, with no "n more" line, however short the pane', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openByMore($, s, clock, 'mobile')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile', props: at(8) })
  expect(await listedActions(picker)).toHaveLength(ACTIONS.length)
  expect(textsOutsideList(await picker.drawn())).toEqual([MESSAGES.en.pickerLegend(true)])
  // A press on one far down the list runs it.
  await pickAction(picker, (await listedActions(picker)).at(-1) ?? '')
  await picker.unmount()
  expect(s.shown).toBe(PANE.requestId)
})

test('[mobile] pickAction fails the test on an action not listed, with no field to reach it', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openByMore($, s, clock, 'mobile')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
  await expect(pickAction(picker, 'no-such-action')).rejects.toThrow(/no filter field/)
  await picker.unmount()
})

test('the list Box is gone where none is listed', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openByMore($, s, clock)
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
  expect(await listBox(picker)).toBeUndefined()
  expect(await listedActions(picker)).toEqual([])
  await picker.unmount()
})

/** `count` custom actions with labels too long for one row of a docked pane, pinned first. */
function longActions(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `long-${i}`)
  return {
    customActions: JSON.stringify(
      ids.map((id, i) => ({ id, icon: '🧩', label: `A rather long custom action label, number ${i}`, kind: 'complete', model: 'haiku', prompt: 'Answer.' })),
    ),
    actions: ids.join(','),
  }
}
