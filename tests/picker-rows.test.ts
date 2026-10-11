import { expect, test } from 'claude-code/testing'

import { MESSAGES } from '../hooks/i18n'
import { BUTTON_CHROME, FIXED_ROWS, MIN_SHOWN, buttonLines, linesOf, pickerShownCount } from '../hooks/picker-rows'

// How many actions the ⋯ dialog lists (SELM-00059): as many buttons as the
// pane's rows hold once the lines around the list are taken off, each button
// and each line wrapped at the pane's columns.

const more = MESSAGES.en.pickerMore
const short = (n: number) => Array.from({ length: n }, (_, i) => `[💡] Action ${i}`)

test('a line takes the rows its width wraps to at the columns, one at least', () => {
  expect(linesOf('', 34)).toBe(1)
  expect(linesOf('x'.repeat(34), 34)).toBe(1)
  expect(linesOf('x'.repeat(35), 34)).toBe(2)
  // Full-width characters take two cells each.
  expect(linesOf('あ'.repeat(17), 34)).toBe(1)
  expect(linesOf('あ'.repeat(18), 34)).toBe(2)
  // The notice wraps onto several rows in a docked pane's 34 columns.
  expect(linesOf(MESSAGES.en.pickerNoFocus, 34)).toBeGreaterThanOrEqual(3)
  expect(linesOf(MESSAGES.ja.pickerNoFocus, 34)).toBeGreaterThanOrEqual(3)
  // Columns below 1 do not divide by zero.
  expect(linesOf('abc', 0)).toBe(3)
})

test('a button takes its label and its frame, wrapped: a long English or full-width label two rows or more', () => {
  expect(BUTTON_CHROME).toBe(5)
  expect(buttonLines('[💡] Explain', 34)).toBe(1)
  // 29 cells of label and 5 of frame: one row exactly; one more cell wraps.
  expect(buttonLines('x'.repeat(29), 34)).toBe(1)
  expect(buttonLines('x'.repeat(30), 34)).toBe(2)
  expect(buttonLines('[🌐] Translate into Traditional Chinese (Taiwan)', 34)).toBe(2)
  expect(buttonLines('[📝] 選択したテキストをやさしい日本語に書き換える', 34)).toBe(2)
  expect(buttonLines('x'.repeat(80), 34)).toBe(3)
})

test('every action fits: all of them, with no "n more" line taken off', () => {
  // 20 rows: the legend, the filter row and the close button leave 17, for 17 one-row buttons.
  const chrome = ['< > context  { } standalone']
  expect(FIXED_ROWS).toBe(2)
  expect(pickerShownCount({ bodyRows: 20, bodyColumns: 60, chrome, labels: short(17), more })).toBe(17)
  expect(pickerShownCount({ bodyRows: 20, bodyColumns: 60, chrome, labels: short(5), more })).toBe(5)
})

test('cut short: the "n more" line is taken off too, then as many as fit', () => {
  const chrome = ['< > context  { } standalone']
  // 17 rows left; 18 do not fit, so one row goes to the line: 16.
  expect(pickerShownCount({ bodyRows: 20, bodyColumns: 60, chrome, labels: short(18), more })).toBe(16)
  // The English line wraps at 34 columns: two rows go to it.
  expect(linesOf(more(300), 34)).toBe(2)
  expect(pickerShownCount({ bodyRows: 20, bodyColumns: 34, chrome, labels: short(300), more })).toBe(15)
  // The Japanese one does not.
  expect(pickerShownCount({ bodyRows: 20, bodyColumns: 34, chrome, labels: short(300), more: MESSAGES.ja.pickerMore })).toBe(16)
})

test('the notice is taken off as the rows it wraps to', () => {
  const legend = MESSAGES.en.pickerLegend(true)
  const without = pickerShownCount({ bodyRows: 30, bodyColumns: 34, chrome: [legend], labels: short(300), more })
  const withNotice = pickerShownCount({ bodyRows: 30, bodyColumns: 34, chrome: [MESSAGES.en.pickerNoFocus, legend], labels: short(300), more })
  expect(without - withNotice).toBe(linesOf(MESSAGES.en.pickerNoFocus, 34))
})

test('long labels wrap, so fewer are listed, and the rows they take never pass the pane\'s', () => {
  const chrome = [MESSAGES.en.pickerLegend(true)]
  const long = Array.from({ length: 40 }, (_, i) => `[🌐] Translate this into language number ${i}`)
  const mixed = short(40).map((label, i) => (i % 2 === 0 ? label : long[i] ?? label))
  const shortCount = pickerShownCount({ bodyRows: 30, bodyColumns: 34, chrome, labels: short(40), more })
  for (const labels of [long, mixed]) {
    const n = pickerShownCount({ bodyRows: 30, bodyColumns: 34, chrome, labels, more })
    expect(n).toBeLessThan(shortCount)
    const used =
      FIXED_ROWS +
      chrome.reduce((sum, line) => sum + linesOf(line, 34), 0) +
      linesOf(more(labels.length), 34) +
      labels.slice(0, n).reduce((sum, label) => sum + buttonLines(label, 34), 0)
    expect(used).toBeLessThanOrEqual(30)
    // One more would not have fit.
    expect(used + buttonLines(labels[n] ?? '', 34)).toBeGreaterThan(30)
  }
})

test('never fewer than three, however short the pane; fewer only when there are fewer', () => {
  expect(MIN_SHOWN).toBe(3)
  const chrome = [MESSAGES.en.pickerNoFocus, MESSAGES.en.pickerLegend(true)]
  expect(pickerShownCount({ bodyRows: 4, bodyColumns: 34, chrome, labels: short(300), more })).toBe(3)
  expect(pickerShownCount({ bodyRows: 0, bodyColumns: 0, chrome, labels: short(300), more })).toBe(3)
  expect(pickerShownCount({ bodyRows: 4, bodyColumns: 34, chrome, labels: short(2), more })).toBe(2)
  expect(pickerShownCount({ bodyRows: 4, bodyColumns: 34, chrome, labels: [], more })).toBe(0)
})
