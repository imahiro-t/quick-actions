import { expect, test } from 'claude-code/testing'

import * as hintWidth from '../hooks/hint-width'
import {
  BASE_COLUMNS,
  BUTTON_FRAME,
  BUTTON_GAP,
  EMOJI_EXTRA,
  LEAD_RESERVE,
  MIN_LABELED_ACTIONS,
  buttonWidth,
  dockWidth,
  hasEmoji,
  hintCountFor,
  hintLayout,
  hintLineColumns,
  hintTarget,
  leadFor,
  leadWidth,
  textWidth,
} from '../hooks/hint-width'
import { BUTTON_FRAME as PICKER_BUTTON_FRAME } from '../hooks/picker-rows'
import { HINT_KINDS, hintKindFor, isOfKind, ofKind } from '../hooks/order'

// How many icons the hint line shows for its width (SELM-00050): the
// `hintCount` setting is the count on an 80-column line, more in proportion
// on a wider one, never more than fit.

test('the cells a label takes: wide characters and emoji count two, joiners and variation selectors none', () => {
  expect(textWidth('abc')).toBe(3)
  expect(textWidth('[💡]')).toBe(4)
  expect(textWidth('[選択]')).toBe(6)
  expect(textWidth('<⚠️>')).toBe(4)
  expect(textWidth('{⏳}')).toBe(4)
  expect(textWidth('')).toBe(0)
  // ✕ and ⋯ are one cell; ✅ and ⏳ draw as emoji.
  expect(textWidth('✕')).toBe(1)
  expect(textWidth('⋯')).toBe(1)
  expect(textWidth('<✅>')).toBe(4)
  expect(textWidth('[🀄]')).toBe(4)
  expect(buttonWidth('[💡]')).toBe(4 + BUTTON_FRAME + BUTTON_GAP + EMOJI_EXTRA)
})

test('the line is the terminal less the dock beside it, never below 0', () => {
  expect(hintLineColumns(160, 0)).toBe(160)
  expect(hintLineColumns(160, dockWidth(56))).toBe(160 - 56 - 3)
  expect(hintLineColumns(40, 80)).toBe(0)
})

test('hintCount is the count at 80 columns, in proportion beyond, one at least', () => {
  expect(BASE_COLUMNS).toBe(80)
  expect(hintTarget(80, 6)).toBe(6)
  expect(hintTarget(160, 6)).toBe(12)
  expect(hintTarget(200, 6)).toBe(15)
  expect(hintTarget(40, 6)).toBe(3)
  // A small count keeps its proportion: 3 on 160 columns is 6, not as many as fit.
  expect(hintTarget(160, 3)).toBe(6)
  expect(hintTarget(10, 1)).toBe(1)
})

const SIX = 6
const many = (n: number) => Array.from({ length: n }, () => SIX)

test('as many as the target asks for while they fit, none when not even one does', () => {
  // Room for all: the target.
  expect(hintCountFor(80, 6, 20, many(100))).toBe(6)
  expect(hintCountFor(160, 6, 20, many(100))).toBe(12)
  expect(hintCountFor(200, 6, 20, many(100))).toBe(15)
  expect(hintCountFor(160, 3, 20, many(100))).toBe(6)
  // The room caps it: 40 - 25 = 15 cells, two of six.
  expect(hintCountFor(40, 6, 25, many(100))).toBe(2)
  // Not even one fits: none, so the line never runs past its width.
  expect(hintCountFor(30, 6, 28, many(100))).toBe(0)
  // Never more than there are.
  expect(hintCountFor(200, 6, 20, many(4))).toBe(4)
  // Widths of their own, in order: the first that does not fit ends it.
  expect(hintCountFor(80, 6, 60, [6, 6, 10, 2])).toBe(2)
})

test('with no width measured, the setting as it always was', () => {
  expect(hintCountFor(undefined, 6, 20, many(100))).toBe(6)
  expect(hintCountFor(undefined, 30, 20, many(10))).toBe(10)
})

test('the kinds: the selection\'s, the conversation\'s, the standalone ones', () => {
  expect(HINT_KINDS).toEqual(['selection', 'context', 'standalone'])
  const defs = [{ id: 'a' }, { id: 'b', target: 'context' as const }, { id: 'c', target: 'none' as const }, { id: 'd', target: 'selection' as const }]
  expect(ofKind(defs, 'selection').map(d => d.id)).toEqual(['a', 'd'])
  expect(ofKind(defs, 'context').map(d => d.id)).toEqual(['b'])
  expect(ofKind(defs, 'standalone').map(d => d.id)).toEqual(['c'])
  expect(isOfKind({}, 'selection')).toBe(true)
})

test('the kind a line opens on: the selection\'s with text, else the conversation\'s; a switch holds', () => {
  expect(hintKindFor(null, true)).toBe('selection')
  expect(hintKindFor(null, false)).toBe('context')
  expect(hintKindFor('standalone', true)).toBe('standalone')
  expect(hintKindFor('context', true)).toBe('context')
  // The selection's needs text to run on.
  expect(hintKindFor('selection', false)).toBe('context')
})

// ---------------------------------------------------------------------------
// SELM-00058: a button is drawn `[ label ]`. Counted as its label and two
// cells, every button came out four cells short of what the terminal draws:
// the line was given more buttons than it holds, and the row squeezed each one
// until its closing `]` fell onto a second row.

test('the frame `[ ` ` ]` is four cells, one constant shared with the ⋯ dialog', () => {
  expect(BUTTON_FRAME).toBe(4)
  expect(PICKER_BUTTON_FRAME).toBe(BUTTON_FRAME)
  expect(BUTTON_GAP).toBe(1)
  expect(EMOJI_EXTRA).toBe(1)
})

test('a button is its label, the frame and the gap; a cell more with an emoji', () => {
  for (const [label, width] of [
    ['[選択]', 11],
    ['[🔤]', 10],
    ['✕', 6],
    ['⋯', 6],
    ['[ ]', 8],
    ['[selection]', 16],
    ['<context>', 14],
    ['{standalone}', 17],
  ] as const) {
    expect(buttonWidth(label)).toBe(width)
  }
})

test('full-width characters alone take no cell more; an emoji does', () => {
  expect(hasEmoji('[選択]')).toBe(false)
  expect(hasEmoji('<会話>')).toBe(false)
  expect(hasEmoji('✕')).toBe(false)
  expect(hasEmoji('[🔤]')).toBe(true)
  expect(hasEmoji('[🀄]')).toBe(true)
  expect(hasEmoji('{⏰}')).toBe(true)
  expect(hasEmoji('<⚠️>')).toBe(true)
  expect(buttonWidth('[選択]')).toBe(textWidth('[選択]') + BUTTON_FRAME + BUTTON_GAP)
  expect(buttonWidth('[🔤]')).toBe(textWidth('[🔤]') + BUTTON_FRAME + BUTTON_GAP + 1)
  // An emoji with a variation selector-16 still counts two cells.
  expect(textWidth('🀄\u{FE0F}')).toBe(2)
})

test('the mode at the row\'s left: none with none, else its mark and a separator after each label', () => {
  expect(leadWidth([])).toBe(0)
  // "▸▸ " 3 + "auto mode on" 12 + " · " 3
  expect(leadWidth(['auto mode on'])).toBe(18)
  expect(leadWidth(['focus', 'memory paused'])).toBe(3 + 5 + 3 + 13 + 3)
})

test('the mode\'s cells by surface: as drawn there; LEAD_RESERVE before any is known where it is drawn; none where it never is', () => {
  expect(LEAD_RESERVE).toBe(22)
  expect(leadFor('terminal', undefined)).toBe(LEAD_RESERVE)
  expect(leadFor('desktop', undefined)).toBe(LEAD_RESERVE)
  expect(leadFor('terminal', [])).toBe(0)
  expect(leadFor('terminal', ['auto mode on'])).toBe(18)
  // SessionMode is raised on the terminal and desktop only: mobile draws no mode beside the line.
  expect(leadFor('mobile', undefined)).toBe(0)
})

test('the line less the dock and the mode', () => {
  expect(hintLineColumns(120, 40, 18)).toBe(62)
  expect(hintLineColumns(120, 40)).toBe(80)
  expect(hintLineColumns(20, 0, 30)).toBe(0)
})

test('hintCount is in proportion to the line before the mode comes off; the fit, after', () => {
  expect(hintTarget(hintLineColumns(160, 0), 6)).toBe(12)
  expect(hintLineColumns(160, 0, 18)).toBe(142)
})

test('COMPACT_BELOW is gone: hintLayout alone decides how the kind buttons are drawn', () => {
  expect('COMPACT_BELOW' in hintWidth).toBe(false)
  expect(MIN_LABELED_ACTIONS).toBe(2)
})

// The layout for the lines of the plan (step 5): twelve candidates and more,
// each a single emoji in its mark (10 cells).
const KINDS = {
  ja: { labeled: ['[選択]', '<会話>', '{単独}'], },
  en: { labeled: ['[selection]', '<context>', '{standalone}'] },
} as const
const MARKS = ['[ ]', '< >', '{ }']
const ENDS = buttonWidth('✕') + buttonWidth('⋯')
const sum = (labels: readonly string[]) => labels.reduce((n, l) => n + buttonWidth(l), 0)
const CANDIDATES = Array.from({ length: 20 }, () => buttonWidth('[🔤]'))

function layoutAt(columns: number, lang: 'ja' | 'en', lead: number, hintCount = 6, dock = 0) {
  const target = hintTarget(hintLineColumns(columns, dock), hintCount)
  return hintLayout({
    line: hintLineColumns(columns, dock, lead),
    target,
    kindsLabeled: sum(KINDS[lang].labeled),
    kindsMarks: sum(MARKS),
    ends: ENDS,
    widths: CANDIDATES.slice(0, target),
  })
}

test('the widths the table is counted from', () => {
  expect(sum(KINDS.ja.labeled)).toBe(33)
  expect(sum(KINDS.en.labeled)).toBe(47)
  expect(sum(MARKS)).toBe(24)
  expect(ENDS).toBe(12)
})

test('the layout for each width, language and mode: named kinds while two actions fit beside them, else marks', () => {
  const table: [number, 'ja' | 'en', number, 'labeled' | 'marks', number][] = [
    // With the mode (auto mode on).
    [60, 'ja', 18, 'marks', 0],
    [60, 'en', 18, 'marks', 0],
    [80, 'ja', 18, 'marks', 2],
    [80, 'en', 18, 'marks', 2],
    [100, 'ja', 18, 'labeled', 3],
    [100, 'en', 18, 'labeled', 2],
    [160, 'ja', 18, 'labeled', 9],
    [160, 'en', 18, 'labeled', 8],
    // Without it.
    [80, 'ja', 0, 'labeled', 3],
    [80, 'en', 0, 'labeled', 2],
    [100, 'ja', 0, 'labeled', 5],
    [100, 'en', 0, 'labeled', 4],
    [160, 'ja', 0, 'labeled', 11],
    [160, 'en', 0, 'labeled', 10],
  ]
  for (const [columns, lang, lead, kinds, count] of table) {
    expect({ columns, lang, lead, ...layoutAt(columns, lang, lead) }).toEqual({ columns, lang, lead, kinds, count })
  }
})

test('a hintTarget under MIN_LABELED_ACTIONS is the bar: hintCount 1 on 100 columns, named kinds and one action', () => {
  expect(hintTarget(100, 1)).toBe(1)
  // 100 - 33 - 12 = 55 cells: room for the one action asked for.
  expect(layoutAt(100, 'ja', 0, 1)).toEqual({ kinds: 'labeled', count: 1 })
})

test('too narrow for the marks beside ✕ and ⋯: no kind buttons, ✕ and ⋯ alone', () => {
  expect(hintLayout({ line: 30, target: 3, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [10, 10, 10] })).toEqual({ kinds: 'none', count: 1 })
  expect(hintLayout({ line: 20, target: 3, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [10, 10, 10] })).toEqual({ kinds: 'none', count: 0 })
})

test('fewer candidates than the bar: named kinds while those there are fit', () => {
  expect(hintLayout({ line: 60, target: 6, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [10] })).toEqual({ kinds: 'labeled', count: 1 })
  expect(hintLayout({ line: 50, target: 6, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [] })).toEqual({ kinds: 'labeled', count: 0 })
})

test('not measured: named kinds and the setting\'s count as it always was', () => {
  expect(hintLayout({ line: undefined, target: 6, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: CANDIDATES })).toEqual({ kinds: 'labeled', count: 6 })
})

test('the buttons laid out never take more than the line, whatever its width', () => {
  for (const lang of ['ja', 'en'] as const) {
    for (const lead of [0, 18, LEAD_RESERVE]) {
      for (let columns = 0; columns <= 200; columns++) {
        const { kinds, count } = layoutAt(columns, lang, lead)
        const kindCells = kinds === 'labeled' ? sum(KINDS[lang].labeled) : kinds === 'marks' ? sum(MARKS) : 0
        const line = hintLineColumns(columns, 0, lead)
        // ✕ and ⋯ stay however narrow: what is laid out beside them fits whenever they do.
        if (ENDS <= line) expect(ENDS + kindCells + count * buttonWidth('[🔤]')).toBeLessThanOrEqual(line)
        else expect({ kinds, count }).toEqual({ kinds: 'none', count: 0 })
      }
    }
  }
})
