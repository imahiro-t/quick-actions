import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { MIN_SHOWN, buttonLines, fixedRows, kindRowLines, linesOf, pagerWidest, pickerKindLabels } from '../hooks/picker-rows'
import { BAND, EN, JA, PANE, PICKER_CLOSE, PICKER_FILTER, PICKER_FILTER_CLEAR, PICKER_KIND, PICKER_LIST, PICKER_NEXT, PICKER_PANE, PICKER_PREV, PICKER_ROW, SURFACES, listBox, listRows, listedActions, listedCount, listedOptions, pageShown, pickAction, pickerFixedRows, promptOf, stage, start, storedUsage } from './stage'
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

/** The texts of the Text elements drawn outside the list's Box and the buttons (a kind button's bold label), in document order. */
function textsOutsideList(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return []
  const n = node as Node
  if (n.type === 'Box' && String(n.props?.key ?? '').startsWith(PICKER_LIST)) return []
  if (n.type === 'Button') return []
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

      // Focused, cut short: the page buttons' text alone, on the first page (the kind buttons are buttons, no line).
      const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(30) })
      expect(pageShown(textsOutsideList(await picker.drawn()), t, total)?.[0]).toBe(1)
      // Without the keyboard: the same, no notice (SELM-00068).
      await picker.redraw(at(30, 60, false))
      expect(pageShown(textsOutsideList(await picker.drawn()), t, total)?.[0]).toBe(1)
      // Narrowed to a few, all listed: no page buttons.
      await picker.redraw(at(30))
      await picker.input({ key: PICKER_FILTER, text: 'translate-zh', kind: 'change' })
      expect((await listedActions(picker)).length).toBeGreaterThan(0)
      expect(textsOutsideList(await picker.drawn())).toEqual([])
      // Nothing left: the line that says so.
      await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
      expect(textsOutsideList(await picker.drawn())).toEqual([t.pickerNoMatch])

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
      // The buttons outside the list are the dialog's own (the kind buttons, Clear, the page buttons, Close).
      const inList = await listedActions(picker)
      const outside = (await picker.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => !inList.includes(k))
      expect(outside.every(k => [PICKER_CLOSE, PICKER_FILTER_CLEAR, PICKER_PREV, PICKER_NEXT].includes(k) || k.startsWith(PICKER_KIND))).toBe(true)
      expect(outside.filter(k => k.startsWith(PICKER_KIND))).toHaveLength(4)
      expect(outside.filter(k => k === PICKER_PREV || k === PICKER_NEXT)).toHaveLength(2)
      await picker.unmount()
    })
  }

  test(`[${surface}] long labels wrap: fewer are listed, and the rows they take stay within the pane's`, { options: { ...EN, ...longActions(12) } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openByMore($, s, clock, surface)
    const rowsUsed = (labels: string[], total: number, columns: number) =>
      pickerFixedRows(MESSAGES.en, columns) + kindRowLines(pickerKindLabels(MESSAGES.en, true), columns) + linesOf(pagerWidest(MESSAGES.en, total), columns) + labels.reduce((sum, l) => sum + buttonLines(l, columns), 0)

    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(30, 34) })
    const listed = await listedOptions(picker)
    // The long ones, pinned, lead; each wraps to two rows or more.
    expect(listed.slice(0, 3).map(o => o.value)).toEqual(['long-0', 'long-1', 'long-2'])
    for (const o of listed.filter(o => o.value.startsWith('long-'))) expect(buttonLines(o.label, 34)).toBeGreaterThanOrEqual(2)
    expect(rowsUsed(listed.map(o => o.label), ACTIONS.length + 12, 34)).toBeLessThanOrEqual(30)
    // Fewer than one-row labels would fill: 30 rows less the kind buttons, the page buttons, the filter row and Close.
    const oneRowEach = 30 - pickerFixedRows(MESSAGES.en, 34) - kindRowLines(pickerKindLabels(MESSAGES.en, true), 34) - linesOf(pagerWidest(MESSAGES.en, ACTIONS.length + 12), 34)
    expect(listed.length).toBeLessThan(oneRowEach)
    await picker.unmount()
  })

  // Focused and not, each a test of its own: every width redraws the list, and the two
  // together ran too close to the 5-second default on a loaded machine (SELM-00068).
  for (const focused of [true, false]) {
    test(`[${surface}] [en] ${focused ? 'focused' : 'not focused'}, the kind buttons' row is taken off as the rows it wraps to, and no notice: the list never spills (SELM-00059 QA, SELM-00068)`, { options: EN, timeoutMs: 30_000 }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      await openByMore($, s, clock, surface)
      const t = MESSAGES.en
      const total = ACTIONS.length
      const kinds = pickerKindLabels(t, true)
      // The kind buttons' row (7, 17, 15 and 18 cells), wrapped button by button, counted a cell
      // narrower: one row from 58 columns, two from 34, three from 25, else a button a row.
      const kindRows: Record<number, number> = { 22: 4, 27: 3, 28: 3, 36: 2, 54: 2, 55: 2, 56: 2, 60: 1 }
      // The whole list, in its order, drawn once with room for all: the order is the usage's
      // alone, the same at every width and focus, so each width's next button is read off it.
      const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(10_000, 54, focused) })
      const all = (await listedOptions(picker)).map(o => o.label)
      expect(all).toHaveLength(total)
      for (const [key, rows] of Object.entries(kindRows)) {
        const columns = Number(key)
        expect([columns, kindRowLines(kinds, columns)]).toEqual([columns, rows])
        await picker.redraw(at(30, columns, focused))
        const labels = (await listedOptions(picker)).map(o => o.label)
        const n = labels.length
        // The first n of the whole list, in its order.
        expect([columns, labels]).toEqual([columns, all.slice(0, n)])
        expect(pageShown(textsOutsideList(await picker.drawn()), t, total)?.[0]).toBe(1)
        const pager = linesOf(pagerWidest(t, total), columns)
        const used = (count: number) => pickerFixedRows(t, columns) + rows + pager + all.slice(0, count).reduce((sum, l) => sum + buttonLines(l, columns), 0)
        // Within the pane's 30 rows, and filling them: one more button would not fit.
        expect([columns, used(n) <= 30]).toEqual([columns, true])
        expect([columns, used(n) + buttonLines(all[n] ?? '', columns) > 30]).toEqual([columns, true])
        // Where every listed button is one row, the count is exact: 30 less the kind buttons' rows and the rest.
        if (labels.every(l => buttonLines(l, columns) === 1)) {
          expect([columns, n]).toEqual([columns, 30 - pickerFixedRows(t, columns) - rows - pager])
        }
      }
      // At 60 the built-in labels are one row each, and so are the filter row, Close, the kind
      // buttons and the page buttons: 30 - 2 - 1 - 1 = 26.
      expect(pickerFixedRows(t, 60)).toBe(2)
      await picker.redraw(at(30, 60, focused))
      expect((await listedActions(picker)).length).toBe(26)
      await picker.unmount()
    })
  }

  // SELM-00070: in a narrow pane the filter row wraps onto two rows or more
  // (and Clear beside it may take another), so the list is cut to what is
  // left: the rows drawn, the filter row and Close counted as they wrap from
  // what the dialog drew and the kind buttons' row, stay within the pane's.
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
          // Cut short (the page buttons), with more than MIN_SHOWN listed:
          // the count is the estimate's, not the floor's.
          expect(texts).toHaveLength(1)
          expect(labels.length).toBeGreaterThan(MIN_SHOWN)
          // The page buttons' row as counted: at its widest, wrapped as one line.
          const pager = linesOf(pagerWidest(t, ACTIONS.length), columns)
          const used = fixed + kindRowLines(pickerKindLabels(t, true), columns) + pager + labels.reduce((sum, l) => sum + buttonLines(l, columns), 0)
          expect([columns, value, used <= 30]).toEqual([columns, value, true])
        }
      }
      await picker.unmount()
    })
  }

  test(`[${surface}] pickAction: an action not listed is reached through the filter; one whose ID others share a start with is the one pressed`, { options: JA }, async ($, on) => {
    // Five others used, so translate-zh, early in the order of definition, is past the five listed.
    const now = 1_000 * 24 * 60 * 60 * 1000
    const clock = mock.clock(on, { now })
    // Tied, in the order of definition.
    const used = ['eli5', 'summarize', 'tldr', 'why', 'recap']
    const s = stage(on, { store: { usage: Object.fromEntries(used.map(id => [id, { score: 1, at: now }])) } })
    await start($)
    await openByMore($, s, clock, surface)

    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: at(9) })
    expect(await listedActions(picker)).toEqual(used)
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

for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
  test(`[${options.language}] the page buttons reach every action without the filter: on, back, round from either end; a filter or kind lists from the first page`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openByMore($, s, clock)
    const total = ACTIONS.length
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: at(30) })
    const page = async () => pageShown(textsOutsideList(await picker.drawn()), t, total)
    const [first, pages] = (await page()) ?? [0, 0]
    expect(first).toBe(1)
    expect(pages).toBeGreaterThan(2)

    // On through every page: each lists the next actions, none twice, and together all of them.
    const seen: string[] = []
    for (let i = 1; i <= pages; i++) {
      expect(await page()).toEqual([i, pages])
      const listed = await listedActions(picker)
      expect(listed.length).toBeGreaterThanOrEqual(MIN_SHOWN)
      seen.push(...listed)
      await picker.press({ key: PICKER_NEXT })
    }
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total)
    expect(seen.slice().sort()).toEqual(ACTIONS.map(a => a.id).sort())
    // Past the last, round to the first; back from the first, the last.
    expect(await page()).toEqual([1, pages])
    expect(await listedActions(picker)).toEqual(seen.slice(0, (await listedActions(picker)).length))
    await picker.press({ key: PICKER_PREV })
    expect(await page()).toEqual([pages, pages])
    expect(await listedActions(picker)).toEqual(seen.slice(total - (await listedActions(picker)).length))

    // A filter lists from its first page; so does a kind.
    await picker.press({ key: PICKER_PREV })
    expect(await page()).toEqual([pages - 1, pages])
    await picker.input({ key: PICKER_FILTER, text: 'a', kind: 'change' })
    expect((await page())?.[0] ?? 1).toBe(1)
    await picker.input({ key: PICKER_FILTER, text: '', kind: 'change' })
    await picker.press({ key: PICKER_NEXT })
    expect(await page()).toEqual([2, pages])
    await picker.press({ key: `${PICKER_KIND}context` })
    const contextCount = ACTIONS.filter(a => a.target === 'context').length
    expect(pageShown(textsOutsideList(await picker.drawn()), t, contextCount)?.[0]).toBe(1)
    await picker.unmount()
    expect(s.models).toEqual([])
  })
}

test('[mobile] no filter field: every action is listed, with no page buttons, however short the pane', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openByMore($, s, clock, 'mobile')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile', props: at(8) })
  expect(await listedActions(picker)).toHaveLength(ACTIONS.length)
  expect(textsOutsideList(await picker.drawn())).toEqual([])
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

/** `count` custom actions with labels too long for one row of a narrow (34-column, inline) pane, pinned first: a docked body's 56 columns hold them on one. */
function longActions(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `long-${i}`)
  return {
    customActions: JSON.stringify(
      ids.map((id, i) => ({ id, icon: '🧩', label: `A rather long custom action label, number ${i}`, kind: 'complete', model: 'haiku', prompt: 'Answer.' })),
    ),
    pinActions: ids.join(','),
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
