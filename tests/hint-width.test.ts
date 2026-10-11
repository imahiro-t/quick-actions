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
  LEAD_SURFACES,
  hasEmoji,
  hintLayout,
  hintLineColumns,
  hintTarget,
  leadFor,
  textWidth,
} from '../hooks/hint-width'
import { BUTTON_FRAME as PICKER_BUTTON_FRAME } from '../hooks/picker-rows'
import { HINT_KINDS, hintKindFor, isOfKind, ofKind } from '../hooks/order'
import { ACTIONS, emojiIcon, markedIcon, TEXT_MARKS } from '../hooks/actions'
import { filterActions } from '../hooks/filter'

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

test('the line is the viewport\'s columns: no dock comes off them again (SELM-00066)', () => {
  expect(hintLineColumns(160)).toBe(160)
  // 180 columns with this plugin's pane docked, as seen in a pseudo-terminal:
  // the engine hands PromptHint a viewport of 123, the dock already off.
  expect(hintLineColumns(123)).toBe(123)
  expect(hintLineColumns(0)).toBe(0)
  // The dock is neither measured nor taken off here any more.
  expect('dockWidth' in hintWidth).toBe(false)
  expect('DOCK_FRAME' in hintWidth).toBe(false)
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

// How many actions fit, the rest of the line (`reserved`: the kind buttons, ✕
// and ⋯) taken off first: hintLayout with the reserved cells as its ends.
const countFor = (columns: number | undefined, hintCount: number, reserved: number, widths: readonly number[]) =>
  hintLayout({
    line: columns,
    target: columns === undefined ? hintCount : hintTarget(columns, hintCount),
    kindsLabeled: 0,
    kindsMarks: 0,
    ends: reserved,
    widths,
  }).count

test('as many as the target asks for while they fit, none when not even one does', () => {
  // Room for all: the target.
  expect(countFor(80, 6, 20, many(100))).toBe(6)
  expect(countFor(160, 6, 20, many(100))).toBe(12)
  expect(countFor(200, 6, 20, many(100))).toBe(15)
  expect(countFor(160, 3, 20, many(100))).toBe(6)
  // The room caps it: 40 - 25 = 15 cells, two of six.
  expect(countFor(40, 6, 25, many(100))).toBe(2)
  // Not even one fits: none, so the line never runs past its width.
  expect(countFor(30, 6, 28, many(100))).toBe(0)
  // Never more than there are.
  expect(countFor(200, 6, 20, many(4))).toBe(4)
  // Widths of their own, in order: the first that does not fit ends it.
  expect(countFor(80, 6, 60, [6, 6, 10, 2])).toBe(2)
})

test('with no width measured, the setting as it always was', () => {
  expect(countFor(undefined, 6, 20, many(100))).toBe(6)
  expect(countFor(undefined, 30, 20, many(10))).toBe(10)
})

test('hintCountFor is gone: the hint line lays itself out with hintLayout alone', () => {
  expect('hintCountFor' in hintWidth).toBe(false)
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
// SELM-00058: a button is drawn `[ label ]`, flush against the next
// (`[ a ][ b ]`, seen in a pseudo-terminal). Counted as its label and two
// cells, every button came out two cells short of what the terminal draws: the
// line was given more buttons than it holds, and the row squeezed each one
// until its closing `]` fell onto a second row.

test('the frame `[ ` ` ]` is four cells, one constant shared with the ⋯ dialog', () => {
  expect(BUTTON_FRAME).toBe(4)
  expect(PICKER_BUTTON_FRAME).toBe(BUTTON_FRAME)
  // Drawn flush: no cell between two buttons.
  expect(BUTTON_GAP).toBe(0)
  expect(EMOJI_EXTRA).toBe(1)
})

test('a button is its label and the frame; a cell more with an emoji', () => {
  for (const [label, width] of [
    ['[選択]', 10],
    ['[🔤]', 9],
    ['✕', 5],
    ['⋯', 5],
    ['[ ]', 7],
    ['[selection]', 15],
    ['<context>', 13],
    ['{standalone}', 16],
    // A pictograph drawn with VS16 (emojiIcon): two cells and the emoji's one.
    ['<🗂\uFE0F>', 9],
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

test('the rest of the row: LEAD_RESERVE where the mode is drawn at its left, whichever mode is up', () => {
  // The footer's two columns each side and `⏵⏵ bypass permissions on ·`, the widest mode.
  expect(LEAD_RESERVE).toBe(2 + textWidth('⏵⏵ bypass permissions on ·') + 2)
  expect(LEAD_RESERVE).toBe(30)
  // Every mode shift+tab cycles through takes no more (seen in a pseudo-terminal).
  for (const mode of ['⏵⏵ auto mode on ·', '⏵⏵ accept edits on ·', '⏸ manual mode on ·', '⏸ plan mode on ·']) {
    expect(2 + textWidth(mode) + 2).toBeLessThanOrEqual(LEAD_RESERVE)
  }
  // Always, not only before something is known: no hook says which mode is up.
  expect(LEAD_SURFACES).toEqual(['terminal', 'desktop'])
  expect(leadFor('terminal')).toBe(LEAD_RESERVE)
  expect(leadFor('desktop')).toBe(LEAD_RESERVE)
  // PromptHint is not raised on mobile; nothing is drawn beside a line there.
  expect(leadFor('mobile')).toBe(0)
  // SessionMode (the footer's `focus`, `memory paused`) is drawn on the row above: nothing here watches it.
  expect('leadWidth' in hintWidth).toBe(false)
  expect('SESSION_MODE_SURFACES' in hintWidth).toBe(false)
})

test('the line less the rest of the row, never below 0', () => {
  expect(hintLineColumns(120, LEAD_RESERVE)).toBe(90)
  expect(hintLineColumns(120)).toBe(120)
  expect(hintLineColumns(20, 30)).toBe(0)
})

test('hintCount is in proportion to the line before the rest of the row comes off; the fit, after', () => {
  expect(hintTarget(hintLineColumns(160), 6)).toBe(12)
  expect(hintLineColumns(160, LEAD_RESERVE)).toBe(130)
})

test('COMPACT_BELOW is gone: hintLayout alone decides how the kind buttons are drawn', () => {
  expect('COMPACT_BELOW' in hintWidth).toBe(false)
  expect(MIN_LABELED_ACTIONS).toBe(2)
})

// The layout for the lines of the plan (step 5), counted again with the
// widths seen in a pseudo-terminal: twelve candidates and more, each a single
// emoji in its mark (9 cells).
const KINDS = {
  ja: { labeled: ['[選択]', '<会話>', '{単独}'], },
  en: { labeled: ['[selection]', '<context>', '{standalone}'] },
} as const
const MARKS = ['[ ]', '< >', '{ }']
const ENDS = buttonWidth('✕') + buttonWidth('⋯')
const sum = (labels: readonly string[]) => labels.reduce((n, l) => n + buttonWidth(l), 0)
const CANDIDATES = Array.from({ length: 20 }, () => buttonWidth('[🔤]'))

function layoutAt(columns: number, lang: 'ja' | 'en', lead: number, hintCount = 6) {
  const target = hintTarget(hintLineColumns(columns), hintCount)
  return hintLayout({
    line: hintLineColumns(columns, lead),
    target,
    kindsLabeled: sum(KINDS[lang].labeled),
    kindsMarks: sum(MARKS),
    ends: ENDS,
    widths: CANDIDATES.slice(0, target),
  })
}

test('the widths the table is counted from', () => {
  expect(sum(KINDS.ja.labeled)).toBe(30)
  expect(sum(KINDS.en.labeled)).toBe(44)
  expect(sum(MARKS)).toBe(21)
  expect(ENDS).toBe(10)
  expect(buttonWidth('[🔤]')).toBe(9)
})

test('the layout for each width, language and mode: named kinds while two actions fit beside them, else marks', () => {
  const table: [number, 'ja' | 'en', number, 'labeled' | 'marks' | 'none', number][] = [
    // The terminal and desktop: LEAD_RESERVE off the row.
    [60, 'ja', LEAD_RESERVE, 'none', 2],
    [60, 'en', LEAD_RESERVE, 'none', 2],
    [80, 'ja', LEAD_RESERVE, 'marks', 2],
    [80, 'en', LEAD_RESERVE, 'marks', 2],
    [100, 'ja', LEAD_RESERVE, 'labeled', 3],
    [100, 'en', LEAD_RESERVE, 'marks', 4],
    [160, 'ja', LEAD_RESERVE, 'labeled', 10],
    [160, 'en', LEAD_RESERVE, 'labeled', 8],
    // Nothing off the row.
    [80, 'ja', 0, 'labeled', 4],
    [80, 'en', 0, 'labeled', 2],
    [100, 'ja', 0, 'labeled', 6],
    [100, 'en', 0, 'labeled', 5],
    [160, 'ja', 0, 'labeled', 12],
    [160, 'en', 0, 'labeled', 11],
  ]
  for (const [columns, lang, lead, kinds, count] of table) {
    expect({ columns, lang, lead, ...layoutAt(columns, lang, lead) }).toEqual({ columns, lang, lead, kinds, count })
  }
})

test('a hintTarget under MIN_LABELED_ACTIONS is the bar: hintCount 1 on 100 columns, named kinds and one action', () => {
  expect(hintTarget(100, 1)).toBe(1)
  // 100 - 30 - 10 = 60 cells: room for the one action asked for.
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

// SELM-00066: with this plugin's pane docked, the line is what the engine hands
// PromptHint, the terminal's columns less the dock (seen in a pseudo-terminal:
// 160, 180 and 200 columns with a body of 56 give 103, 123 and 143). Taking the
// dock off again (56 + 3) left 14, 34 and 54 cells for the buttons: at 160 and
// 180 columns no action, ✕ and ⋯ alone, as the person saw.
const DOCKED = [[160, 103], [180, 123], [200, 143]] as const

test('docked: the line the engine hands over holds at least one action, never more than it holds (SELM-00066)', () => {
  for (const lang of ['ja', 'en'] as const) {
    for (const [, viewport] of DOCKED) {
      const { kinds, count } = layoutAt(viewport, lang, LEAD_RESERVE)
      expect({ lang, viewport, atLeastOne: count >= 1 }).toEqual({ lang, viewport, atLeastOne: true })
      const kindCells = kinds === 'labeled' ? sum(KINDS[lang].labeled) : kinds === 'marks' ? sum(MARKS) : 0
      expect(ENDS + kindCells + count * buttonWidth('[🔤]')).toBeLessThanOrEqual(hintLineColumns(viewport, LEAD_RESERVE))
    }
  }
  // As the table: 103 columns as 100's, 123 and 143 between it and 160's.
  expect(layoutAt(103, 'ja', LEAD_RESERVE)).toEqual({ kinds: 'labeled', count: 3 })
  expect(layoutAt(123, 'ja', LEAD_RESERVE)).toEqual({ kinds: 'labeled', count: 5 })
  expect(layoutAt(143, 'ja', LEAD_RESERVE)).toEqual({ kinds: 'labeled', count: 8 })
  // The dock taken off twice, as before the fix: none at 160 and 180 columns.
  for (const [, viewport] of DOCKED.slice(0, 2)) expect(layoutAt(viewport - (56 + 3), 'ja', LEAD_RESERVE).count).toBe(0)
})

test('the buttons laid out never take more than the line, whatever its width', () => {
  for (const lang of ['ja', 'en'] as const) {
    for (const lead of [0, 19, LEAD_RESERVE]) {
      for (let columns = 0; columns <= 200; columns++) {
        const { kinds, count } = layoutAt(columns, lang, lead)
        const kindCells = kinds === 'labeled' ? sum(KINDS[lang].labeled) : kinds === 'marks' ? sum(MARKS) : 0
        const line = hintLineColumns(columns, lead)
        // ✕ and ⋯ stay however narrow: what is laid out beside them fits whenever they do.
        if (ENDS <= line) expect(ENDS + kindCells + count * buttonWidth('[🔤]')).toBeLessThanOrEqual(line)
        else expect({ kinds, count }).toEqual({ kinds: 'none', count: 0 })
      }
    }
  }
})

// ---------------------------------------------------------------------------
// SELM-00058: the ⋯ dialog drew `<🗂>`'s `>` under the emoji. 🗂 (U+1F5C2) is
// text by default: the engine counted it one cell and wrote `>` in the next,
// while a terminal draws its emoji glyph two cells wide (in a pseudo-terminal
// the row came out a cell longer than the others). With VS16 the engine counts
// it two and moves past it before `>`, as it does for ⚠️.

const TEXT_PICTOGRAPH = /^(?=\p{Extended_Pictographic})\P{Emoji_Presentation}$/u

test('emojiIcon: a pictograph that is text by default takes VS16; emoji, ones with a selector and plain text are left', () => {
  expect(emojiIcon('🗂')).toBe('🗂\uFE0F')
  expect(emojiIcon('☀')).toBe('☀\uFE0F')
  expect(emojiIcon('⚠️')).toBe('⚠️')
  expect(emojiIcon('🔤')).toBe('🔤')
  expect(emojiIcon('🀄')).toBe('🀄')
  expect(emojiIcon('☀\uFE0E')).toBe('☀\uFE0E')
  expect(emojiIcon('A')).toBe('A')
  // A ZWJ sequence's text-default part gets its VS16 (❤ in ❤‍🔥), the rest as it is.
  expect(emojiIcon('❤\u200D🔥')).toBe('❤\uFE0F\u200D🔥')
  // The marks are drawn round the icon as drawn.
  expect(markedIcon({ icon: '🗂', target: 'context' })).toBe('<🗂\uFE0F>')
})

test('emojiIcon: ©, ® and ™ stay text marks, one cell each, without VS16; other text-default pictographs still take it', () => {
  for (const mark of ['\u00A9', '\u00AE', '\u2122']) {
    // Text-default pictographs, so only TEXT_MARKS keeps them from VS16.
    expect(TEXT_PICTOGRAPH.test(mark)).toBe(true)
    expect(TEXT_MARKS.has(mark)).toBe(true)
    expect(emojiIcon(mark)).toBe(mark)
    expect(textWidth(emojiIcon(mark))).toBe(1)
    // Within an icon, beside a pictograph that does take VS16; one with a selector given keeps it.
    expect(emojiIcon(`${mark}✂`)).toBe(`${mark}✂\uFE0F`)
    expect(emojiIcon(`${mark}\uFE0F`)).toBe(`${mark}\uFE0F`)
    expect(markedIcon({ icon: mark, target: 'none' })).toBe(`{${mark}}`)
  }
  expect(TEXT_MARKS.size).toBe(3)
  expect(emojiIcon('✂')).toBe('✂\uFE0F')
  expect(emojiIcon('‼')).toBe('‼\uFE0F')
})

test('every built-in icon is drawn as the emoji the terminal draws: none is a text-default pictograph without VS16', () => {
  for (const a of ACTIONS) {
    const chars = [...markedIcon(a)]
    chars.forEach((ch, i) => {
      if (TEXT_PICTOGRAPH.test(ch)) expect({ id: a.id, next: chars[i + 1] }).toEqual({ id: a.id, next: '\uFE0F' })
    })
  }
  expect(ACTIONS.find(a => a.id === 'changed-files')?.icon).toBe('🗂\uFE0F')
})

test('an icon with VS16 is two cells, as the engine counts it, and the filter finds the same actions', () => {
  expect(textWidth('🗂\uFE0F')).toBe(2)
  expect(textWidth(markedIcon({ icon: '🗂', target: 'context' }))).toBe(4)
  for (const query of ['<', '< ファイル', 'changed-files', '変更したファイル']) {
    expect(filterActions(ACTIONS, query).map(a => a.id)).toContain('changed-files')
  }
})
