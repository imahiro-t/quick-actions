import { expect, test } from 'claude-code/testing'

import { textWidth } from '../hooks/hint-width'
import { MESSAGES } from '../hooks/i18n'
import { BUTTON_FRAME, EMOJI_SLACK, FIXED_ROWS, MIN_SHOWN, buttonLines, linesOf, pickerShownCount, wrappedRows } from '../hooks/picker-rows'

// How many actions the ⋯ dialog lists (SELM-00059): as many buttons as the
// pane's rows hold once the lines around the list are taken off, each button
// and each line wrapped at the pane's columns.

const more = MESSAGES.en.pickerMore
const short = (n: number) => Array.from({ length: n }, (_, i) => `[💡] Action ${i}`)

test('a line takes the rows its width wraps to at the columns, one at least', () => {
  expect(linesOf('', 34)).toBe(1)
  expect(linesOf('x'.repeat(34), 34)).toBe(1)
  expect(linesOf('x'.repeat(35), 34)).toBe(2)
  // Full-width characters take two cells each, and are never split across rows.
  expect(linesOf('あ'.repeat(17), 34)).toBe(1)
  expect(linesOf('あ'.repeat(18), 34)).toBe(2)
  expect(linesOf('x' + 'あ'.repeat(17), 34)).toBe(2)
  // The notice wraps onto several rows in a docked pane's 34 columns.
  expect(linesOf(MESSAGES.en.pickerNoFocus, 34)).toBeGreaterThanOrEqual(3)
  expect(linesOf(MESSAGES.ja.pickerNoFocus, 34)).toBeGreaterThanOrEqual(3)
  // Columns below 1 do not divide by zero.
  expect(linesOf('abc', 0)).toBe(3)
  // Each line of several counts on its own.
  expect(wrappedRows('ab\ncd', 34)).toBe(2)
})

test('lines wrap at their spaces: a word that does not fit goes whole onto the next row', () => {
  // 'aaa bbb' at 5 columns: "aaa " and "bbb", where the width over the columns gives 2 too;
  // 'aaaa bbbb' (9 cells) at 5: "aaaa " and "bbbb"; 'aaa bbb ccc' (11) at 6: three rows, not two.
  expect(wrappedRows('aaa bbb', 5)).toBe(2)
  expect(wrappedRows('aaaa bbbb', 5)).toBe(2)
  expect(wrappedRows('aaa bbb ccc', 6)).toBe(3)
  // A row filled to its last cell: the space starts the next row.
  expect(wrappedRows('aaaaa bbb', 5)).toBe(2)
  expect(wrappedRows('aaaaa bbbb', 5)).toBe(2)
  expect(wrappedRows('aaaaa bbbbb', 5)).toBe(3)
  // A word wider than any row is broken where the row ends, begun on a row of its own
  // when that saves a break: 'ab' then 12 x's at 5 columns: "ab xx", "xxxxx", "xxxxx".
  expect(wrappedRows('ab ' + 'x'.repeat(12), 5)).toBe(3)
  expect(wrappedRows('ab ' + 'x'.repeat(10), 5)).toBe(3)
  // Japanese with no spaces is one word, broken a character at a time.
  expect(wrappedRows('あ'.repeat(40), 34)).toBe(3)
})

test('the English notice is counted as the words wrap, where the width over the columns comes out a row short (SELM-00059 QA)', () => {
  const notice = MESSAGES.en.pickerNoFocus
  // 108 cells: ceil(108 / 54) is 2, but "keyboard." does not fit on the second row.
  expect(textWidth(notice)).toBe(108)
  expect(Math.ceil(textWidth(notice) / 54)).toBe(2)
  // Worked out by hand from the words, at each width QA found short.
  const expected: Record<number, number> = { 22: 6, 27: 5, 28: 5, 36: 4, 54: 3, 55: 3, 56: 3, 57: 2 }
  for (const [columns, rows] of Object.entries(expected)) expect([Number(columns), linesOf(notice, Number(columns))]).toEqual([Number(columns), rows])
  // Never fewer than the width over the columns, at any width.
  for (let columns = 10; columns <= 120; columns++) expect(linesOf(notice, columns)).toBeGreaterThanOrEqual(Math.ceil(textWidth(notice) / columns))
})

test('a button takes its label and its frame, wrapped a cell narrower: a long English or full-width label two rows or more', () => {
  expect(BUTTON_FRAME).toBe(4)
  expect(EMOJI_SLACK).toBe(1)
  expect(buttonLines('[💡] Explain', 34)).toBe(1)
  // "[ " + 29 cells + " ]" is 33, one row at 34 (a cell kept for an emoji); one more cell wraps.
  expect(buttonLines('x'.repeat(29), 34)).toBe(1)
  expect(buttonLines('x'.repeat(30), 34)).toBe(2)
  expect(buttonLines('[🌐] Translate into Traditional Chinese (Taiwan)', 34)).toBe(2)
  expect(buttonLines('[📝] 選択したテキストをやさしい日本語に書き換える', 34)).toBe(2)
  expect(buttonLines('x'.repeat(80), 34)).toBe(3)
  // A word sent on whole: "[ " and 25 x's, then 20 y's and 15 z's, 66 cells, would be two rows of 33
  // by width, but the y's and the z's each go onto a row of their own: three.
  const sentOn = `${'x'.repeat(25)} ${'y'.repeat(20)} ${'z'.repeat(15)}`
  expect(Math.ceil((textWidth(sentOn) + BUTTON_FRAME) / (34 - EMOJI_SLACK))).toBe(2)
  expect(buttonLines(sentOn, 34)).toBe(3)
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
