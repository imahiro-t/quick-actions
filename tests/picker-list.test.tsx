import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { MIN_SHOWN, buttonLines, fixedRows, linesOf } from '../hooks/picker-rows'
import { BAND, EN, JA, PANE, PICKER_CLOSE, PICKER_FILTER, PICKER_FILTER_CLEAR, PICKER_LIST, PICKER_PANE, PICKER_ROW, SURFACES, listBox, listRows, listedActions, listedCount, listedOptions, pickAction, pickerFixedRows, promptOf, stage, start, storedUsage } from './stage'
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
      pickerFixedRows(MESSAGES.en, columns) + linesOf(MESSAGES.en.pickerLegend(true), columns) + linesOf(MESSAGES.en.pickerMore(total - labels.length), columns) + labels.reduce((sum, l) => sum + buttonLines(l, columns), 0)

    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(30, 34) })
    const listed = await listedOptions(picker)
    // The long ones, pinned, lead; each wraps to two rows or more.
    expect(listed.slice(0, 3).map(o => o.value)).toEqual(['long-0', 'long-1', 'long-2'])
    for (const o of listed.filter(o => o.value.startsWith('long-'))) expect(buttonLines(o.label, 34)).toBeGreaterThanOrEqual(2)
    expect(rowsUsed(listed.map(o => o.label), ACTIONS.length + 12, 34)).toBeLessThanOrEqual(30)
    // Fewer than one-row labels would fill: 30 rows less the legend, the "n more" line, the filter row and Close.
    const oneRowEach = 30 - pickerFixedRows(MESSAGES.en, 34) - linesOf(MESSAGES.en.pickerLegend(true), 34) - linesOf(MESSAGES.en.pickerMore(1), 34)
    expect(listed.length).toBeLessThan(oneRowEach)
    await picker.unmount()
  })

  test(`[${surface}] [en] the notice without the keyboard is taken off as the rows its words wrap to: the list never spills (SELM-00059 QA)`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openByMore($, s, clock, surface)
    const t = MESSAGES.en
    const total = ACTIONS.length
    // The notice's rows, counted by hand from its words: at 54 to 56 columns (a docked
    // pane's body) "keyboard." does not fit on the second row, so three, not ceil(108 / n) = 2.
    const noticeRows: Record<number, number> = { 22: 6, 27: 5, 28: 5, 36: 4, 54: 3, 55: 3, 56: 3 }
    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(30, 54, false) })
    for (const [key, notice] of Object.entries(noticeRows)) {
      const columns = Number(key)
      await picker.redraw(at(30, columns, false))
      const labels = (await listedOptions(picker)).map(o => o.label)
      const n = labels.length
      expect(textsOutsideList(await picker.drawn())).toEqual([t.pickerNoFocus, t.pickerLegend(true), t.pickerMore(total - n)])
      const used = (count: number) =>
        pickerFixedRows(t, columns) +
        notice +
        linesOf(t.pickerLegend(true), columns) +
        linesOf(t.pickerMore(total - count), columns) +
        labels.slice(0, count).reduce((sum, l) => sum + buttonLines(l, columns), 0)
      // Within the pane's 30 rows, and filling them: one more button would not fit.
      expect([columns, used(n) <= 30]).toEqual([columns, true])
      await picker.redraw(at(10_000, columns, false))
      const next = (await listedOptions(picker)).at(n)?.label ?? ''
      await picker.redraw(at(30, columns, false))
      expect([columns, used(n) + buttonLines(next, columns) > 30]).toEqual([columns, true])
      // Where every listed button is one row, the count is exact: 30 less the notice's hand-counted rows and the rest.
      if (labels.every(l => buttonLines(l, columns) === 1)) {
        expect([columns, n]).toEqual([columns, 30 - pickerFixedRows(t, columns) - notice - linesOf(t.pickerLegend(true), columns) - linesOf(t.pickerMore(total - n), columns)])
      }
    }
    // At 54 the built-in labels are one row each, and so are the filter row and Close: 30 - 2 - 3 - 1 - 1 = 23.
    expect(pickerFixedRows(t, 54)).toBe(2)
    await picker.redraw(at(30, 54, false))
    expect((await listedActions(picker)).length).toBe(23)
    await picker.unmount()
  })

  // SELM-00070: in a narrow pane the filter row wraps onto two rows or more
  // (and Clear beside it may take another), so the list is cut to what is
  // left: the rows drawn, the filter row and Close counted as they wrap from
  // what the dialog drew, stay within the pane's.
  for (const [options, t] of [[EN, MESSAGES.en], [JA, MESSAGES.ja]] as const) {
    test(`[${surface}] [${options.language}] at 28 columns and fewer the filter row and Close are counted as they wrap: the dialog stays within the pane`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      await openByMore($, s, clock, surface)
      const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(30, 28) })
      for (const columns of [28, 22, 16]) {
        for (const value of ['', 'e']) {
          await picker.redraw(at(30, columns))
          await picker.input({ key: PICKER_FILTER, text: value, kind: 'change' })
          // The filter row and Close from what is drawn: the field's strings, Clear once it holds text.
          const field = (await picker.find({ key: PICKER_FILTER }))?.props as { placeholder: string; value: string; submitLabel: string }
          const clear = await picker.find({ key: PICKER_FILTER_CLEAR })
          const close = await picker.find({ key: PICKER_CLOSE })
          expect([field.placeholder, field.value, field.submitLabel]).toEqual([t.pickerFilterPlaceholder, value, t.pickerFilterSubmit])
          expect([value, clear === undefined]).toEqual([value, value === ''])
          expect(close?.props.label).toBe(t.pickerClose)
          const fixed = fixedRows(columns, {
            filterRow: { ...field, ...(clear !== undefined && { clear: String(clear.props.label) }) },
            close: String(close?.props.label),
          })
          // Wrapped: more than the row each they were counted as before.
          expect([columns, value, fixed > 2]).toEqual([columns, value, true])
          const labels = (await listedOptions(picker)).map(o => o.label)
          const texts = textsOutsideList(await picker.drawn())
          // Cut short (the legend, then the "n more" line), with more than MIN_SHOWN listed:
          // the count is the estimate's, not the floor's.
          expect(texts).toHaveLength(2)
          expect(texts[0]).toBe(t.pickerLegend(true))
          expect(labels.length).toBeGreaterThan(MIN_SHOWN)
          const used = fixed + texts.reduce((sum, line) => sum + linesOf(line, columns), 0) + labels.reduce((sum, l) => sum + buttonLines(l, columns), 0)
          expect([columns, value, used <= 30]).toEqual([columns, value, true])
        }
      }
      await picker.unmount()
    })
  }

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

// SELM-00058: each row of the list kept whole. A column short of height
// squeezes its children (flexShrink 1 by default): a label wrapped onto two
// rows would be drawn on one, its rows over one another.
for (const surface of SURFACES) {
  test(`[${surface}] each row of the list is a Box kept whole round its one Button`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openByMore($, s, clock, surface)
    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(12, 30) })
    const rows = await listRows(picker)
    expect(rows.length).toBe(await listedCount(picker))
    for (const row of rows) {
      expect(row.props.flexShrink).toBe(0)
      expect(row.children).toHaveLength(1)
      expect((row.children[0] as { type?: string }).type).toBe('Button')
    }
    expect(rows.map(r => String(r.key).slice(PICKER_ROW.length))).toEqual(await listedActions(picker))
    await picker.unmount()
  })
}

/** The ⋯ dialog's Button for translate-en ("[🔤] 英訳"), reached through the filter, and the row round it. */
async function translateEnRow($: Engine, s: Stage, clock: Clock) {
  await openByMore($, s, clock)
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.input({ key: PICKER_FILTER, text: 'translate-en', kind: 'change' })
  const button = await picker.find({ key: 'translate-en' })
  const row = (await listRows(picker)).find(r => r.key === `${PICKER_ROW}translate-en`)
  await picker.unmount()
  return { button, row }
}

test('with a palette and without, a row draws the same text: its label, "[🔤] 英訳", in a row kept whole', { options: { ...JA, paneTheme: 'dark' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const { button, row } = await translateEnRow($, s, clock)
  expect(button?.props.label).toBe('[🔤] 英訳')
  // The palette's colour on a child Text holding the label alone: nothing before or after it.
  expect(button?.children).toHaveLength(1)
  const child = button?.children[0] as { type?: string; children?: unknown[] }
  expect(child.type).toBe('Text')
  expect(child.children).toEqual(['[🔤] 英訳'])
  expect(row?.props.flexShrink).toBe(0)
})

test('without a palette, the row\'s Button is its label alone, in a row kept whole', { options: { ...JA, paneTheme: 'auto' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const { button, row } = await translateEnRow($, s, clock)
  expect(button?.props.label).toBe('[🔤] 英訳')
  expect(button?.children ?? []).toHaveLength(0)
  expect(row?.props.flexShrink).toBe(0)
})
