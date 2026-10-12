import { expect, test } from './kit'

import * as hintWidth from '../hooks/hint-width'
import {
  BUTTON_FRAME,
  BUTTON_GAP,
  DOCK_GUTTER,
  EMOJI_EXTRA,
  LEAD_RESERVE,
  MIN_LABELED_ACTIONS,
  TIP_RESERVE,
  buttonWidth,
  dockGivenBack,
  dockReturn,
  isStaleDock,
  LEAD_SURFACES,
  hasEmoji,
  hintLayout,
  hintLineColumns,
  hintMost,
  leadFor,
  textWidth,
  UNMEASURED_COUNT,
} from '../hooks/hint-width'
import { BUTTON_FRAME as PICKER_BUTTON_FRAME } from '../hooks/picker-rows'
import { HINT_KINDS, hintKindFor, isOfKind, ofKind } from '../hooks/order'
import { ACTIONS, emojiIcon, markedIcon, TEXT_MARKS } from '../hooks/actions'
import { filterActions } from '../hooks/filter'

// How many icons the hint line shows for its width (SELM-00050): as many as
// fit, UNMEASURED_COUNT when the width is not known.

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

test('the line is the viewport\'s columns with this plugin\'s dock given back: no dock comes off them again (SELM-00066, SELM-00068)', () => {
  expect(hintLineColumns(160)).toBe(160)
  // 180 columns with this plugin's pane docked, as seen in a pseudo-terminal:
  // the engine hands PromptHint a viewport of 123, the dock (a body of 56 and
  // its rule) already off; the line runs under the dock, so it is given back.
  expect(DOCK_GUTTER).toBe(1)
  expect(dockReturn(56)).toBe(57)
  expect(dockReturn(0)).toBe(1)
  expect(dockReturn(-5)).toBe(1)
  expect(hintLineColumns(123, 0, dockReturn(56))).toBe(180)
  for (const [terminal, viewport] of [[160, 103], [180, 123], [200, 143]] as const) {
    expect(hintLineColumns(viewport, 0, dockReturn(56))).toBe(terminal)
    expect(hintLineColumns(viewport, LEAD_RESERVE, dockReturn(56))).toBe(terminal - LEAD_RESERVE)
    // As the same terminal undocked: the same line.
    expect(hintLineColumns(viewport, LEAD_RESERVE, dockReturn(56))).toBe(hintLineColumns(terminal, LEAD_RESERVE))
  }
  // No dock given: the viewport's columns alone.
  expect(hintLineColumns(123)).toBe(123)
  expect(hintLineColumns(123, 0, 0)).toBe(123)
  expect(hintLineColumns(123, 0, -10)).toBe(123)
  expect(hintLineColumns(0)).toBe(0)
  // The dock is never taken off: the old measure of what comes off is gone.
  expect('dockWidth' in hintWidth).toBe(false)
  expect('DOCK_FRAME' in hintWidth).toBe(false)
})

test('a dock measured is given back only beside the viewport it was measured beside; another plugin\'s only with that key, this plugin\'s only while open (SELM-00067)', () => {
  const other = { dock: dockReturn(40), viewport: 139, own: false }
  // Beside the viewport it was drawn beside: the whole terminal again (180).
  expect(dockGivenBack(other, 139, false)).toBe(41)
  expect(hintLineColumns(139, LEAD_RESERVE, dockGivenBack(other, 139, false))).toBe(hintLineColumns(180, LEAD_RESERVE))
  // Beside other columns (closed, opened again, resized): stale, nothing.
  expect(isStaleDock(other, 180)).toBe(true)
  expect(isStaleDock(other, 109)).toBe(true)
  expect(dockGivenBack(other, 180, true)).toBe(0)
  expect(dockGivenBack(other, 103, true)).toBe(0)
  expect(isStaleDock(other, 139)).toBe(false)
  // No line viewport, or no measure, or no key: nothing says it is stale.
  expect(isStaleDock(other, undefined)).toBe(false)
  expect(isStaleDock(undefined, 139)).toBe(false)
  expect(isStaleDock({ dock: 41, own: true }, 139)).toBe(false)
  // Another plugin's without the key is never given back.
  expect(dockGivenBack({ dock: 41, own: false }, 139, true)).toBe(0)
  expect(dockGivenBack(undefined, 139, true)).toBe(0)
  // This plugin's: while its tabs are open, keyed or not (a surface keying nothing).
  expect(dockGivenBack({ dock: 57, own: true }, 103, true)).toBe(57)
  expect(dockGivenBack({ dock: 57, own: true }, 103, false)).toBe(0)
  expect(dockGivenBack({ dock: 57, viewport: 103, own: true }, 103, true)).toBe(57)
  expect(dockGivenBack({ dock: 57, viewport: 103, own: true }, 129, true)).toBe(0)
  // Inline: none.
  expect(dockGivenBack({ dock: 0, viewport: 139, own: false }, 139, false)).toBe(0)
  expect(dockGivenBack({ dock: -3, viewport: 139, own: false }, 139, false)).toBe(0)
})

test('the hintCount setting is gone: no count in proportion to 80 columns', () => {
  expect('hintTarget' in hintWidth).toBe(false)
  expect('BASE_COLUMNS' in hintWidth).toBe(false)
})

test('hintMost: the most a line could take, each button of a one-cell label; UNMEASURED_COUNT when not measured', () => {
  expect(UNMEASURED_COUNT).toBe(6)
  expect(hintMost(undefined)).toBe(6)
  expect(hintMost(130)).toBe(26)
  expect(hintMost(4)).toBe(0)
  expect(hintMost(0)).toBe(0)
})

const SIX = 6
const many = (n: number) => Array.from({ length: n }, () => SIX)

// How many actions fit, the rest of the line (`reserved`: the kind buttons, ✕
// and ⋯) taken off first: hintLayout with the reserved cells as its ends.
const countFor = (columns: number | undefined, reserved: number, widths: readonly number[]) =>
  hintLayout({
    line: columns,
    kindsLabeled: 0,
    kindsMarks: 0,
    ends: reserved,
    widths,
  }).count

test('as many as fit, none when not even one does', () => {
  // 80 - 20 = 60 cells: ten of six.
  expect(countFor(80, 20, many(100))).toBe(10)
  expect(countFor(160, 20, many(100))).toBe(23)
  // 40 - 25 = 15 cells, two of six.
  expect(countFor(40, 25, many(100))).toBe(2)
  // Not even one fits: none, so the line never runs past its width.
  expect(countFor(30, 28, many(100))).toBe(0)
  // Never more than there are.
  expect(countFor(200, 20, many(4))).toBe(4)
  // Widths of their own, in order: the first that does not fit ends it.
  expect(countFor(80, 60, [6, 6, 10, 2])).toBe(2)
})

test('with no width measured, UNMEASURED_COUNT', () => {
  expect(countFor(undefined, 20, many(100))).toBe(6)
  expect(countFor(undefined, 20, many(4))).toBe(4)
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

function layoutAt(columns: number, lang: 'ja' | 'en', lead: number) {
  const line = hintLineColumns(columns, lead)
  return hintLayout({
    line,
    kindsLabeled: sum(KINDS[lang].labeled),
    kindsMarks: sum(MARKS),
    ends: ENDS,
    widths: CANDIDATES.slice(0, hintMost(line)),
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
    [160, 'ja', 0, 'labeled', 13],
    [160, 'en', 0, 'labeled', 11],
  ]
  for (const [columns, lang, lead, kinds, count] of table) {
    expect({ columns, lang, lead, ...layoutAt(columns, lang, lead) }).toMatchObject({ columns, lang, lead, kinds, count })
  }
})

test('too narrow for the marks beside ✕ and ⋯: no kind buttons, ✕ and ⋯ alone', () => {
  expect(hintLayout({ line: 30, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [10, 10, 10] })).toMatchObject({ kinds: 'none', count: 1 })
  expect(hintLayout({ line: 20, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [10, 10, 10] })).toMatchObject({ kinds: 'none', count: 0 })
})

test('fewer candidates than the bar: named kinds while those there are fit', () => {
  expect(hintLayout({ line: 60, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [10] })).toMatchObject({ kinds: 'labeled', count: 1 })
  expect(hintLayout({ line: 50, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [] })).toMatchObject({ kinds: 'labeled', count: 0 })
})

test('not measured: named kinds and UNMEASURED_COUNT', () => {
  expect(hintLayout({ line: undefined, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: CANDIDATES })).toMatchObject({ kinds: 'labeled', count: 6 })
  expect(hintLayout({ line: undefined, kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: CANDIDATES, tip: TIP_RESERVE })).toMatchObject({ kinds: 'labeled', count: 6 })
})

// The hover label was cut to a cell or none on a full line (`要…`): room is kept for it.
test('the hover label\'s room: TIP_RESERVE kept after ⋯, the kind buttons as they would be and two actions at least', () => {
  // Short labels whole (`日本語訳`, `To English`), with the space ahead of it; a long one is cut.
  expect(TIP_RESERVE).toBeGreaterThanOrEqual(textWidth(' To English'))
  expect(TIP_RESERVE).toBeLessThan(textWidth(' 選択範囲へのアクション'))
  const widths = Array.from({ length: 20 }, () => 9)
  const at = (line: number, tip?: number) => hintLayout({ line, kindsLabeled: 30, kindsMarks: 21, ends: 10, widths, ...(tip === undefined ? {} : { tip }) })
  // Wide: the whole reserve kept, the actions it costs left out (130 cells: 90 for actions, 78 with the reserve).
  expect(at(130)).toMatchObject({ kinds: 'labeled', count: 10 })
  expect(at(130, TIP_RESERVE)).toMatchObject({ kinds: 'labeled', count: 8 })
  // Narrower: as much of it as leaves two actions beside the named kinds (68 cells: 10 kept).
  expect(at(68)).toMatchObject({ kinds: 'labeled', count: 3 })
  expect(at(68, TIP_RESERVE)).toMatchObject({ kinds: 'labeled', count: MIN_LABELED_ACTIONS })
  // Never the kind buttons drawn otherwise for it, nor fewer than two actions (50 cells: marks and two, as without).
  expect(at(50, TIP_RESERVE)).toEqual(at(50))
  // No reserve asked for: as before.
  expect(at(130, 0)).toEqual(at(130))
  // Whatever the width, the buttons and the room kept never pass the line.
  for (let line = 0; line <= 200; line++) {
    const { kinds, count } = at(line, TIP_RESERVE)
    expect(kinds).toBe(at(line).kinds)
    expect(count).toBeLessThanOrEqual(at(line).count)
    expect(count).toBeGreaterThanOrEqual(Math.min(MIN_LABELED_ACTIONS, at(line).count))
  }
})

// SELM-00066: with this plugin's pane docked, the engine hands PromptHint the
// terminal's columns less the dock (seen in a pseudo-terminal: 160, 180 and 200
// columns with a body of 56 give 103, 123 and 143). Taking the dock off again
// (56 + 3) left 14, 34 and 54 cells for the buttons: at 160 and 180 columns no
// action, ✕ and ⋯ alone, as the person saw. Those viewports alone (another
// plugin's dock, or this one's before it is measured) still hold one action.
const DOCKED = [[160, 103], [180, 123], [200, 143]] as const

test('docked, this plugin\'s dock given back: the line as the whole terminal\'s (SELM-00068)', () => {
  for (const lang of ['ja', 'en'] as const) {
    for (const [terminal, viewport] of DOCKED) {
      const given = hintLineColumns(viewport, LEAD_RESERVE, dockReturn(56))
      expect(given).toBe(hintLineColumns(terminal, LEAD_RESERVE))
      expect(layoutAt(viewport + dockReturn(56), lang, LEAD_RESERVE)).toEqual(layoutAt(terminal, lang, LEAD_RESERVE))
    }
  }
})

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
  expect(layoutAt(103, 'ja', LEAD_RESERVE)).toMatchObject({ kinds: 'labeled', count: 3 })
  expect(layoutAt(123, 'ja', LEAD_RESERVE)).toMatchObject({ kinds: 'labeled', count: 5 })
  expect(layoutAt(143, 'ja', LEAD_RESERVE)).toMatchObject({ kinds: 'labeled', count: 8 })
  // The dock taken off twice, as before the fix: none at 160 and 180 columns.
  for (const [, viewport] of DOCKED.slice(0, 2)) expect(layoutAt(viewport - (56 + 3), 'ja', LEAD_RESERVE).count).toBe(0)
})

test('the buttons laid out never take more than the line, whatever its width', () => {
  for (const lang of ['ja', 'en'] as const) {
    for (const lead of [0, 19, LEAD_RESERVE]) {
      for (let columns = 0; columns <= 200; columns++) {
        const { kinds, count, used } = layoutAt(columns, lang, lead)
        const kindCells = kinds === 'labeled' ? sum(KINDS[lang].labeled) : kinds === 'marks' ? sum(MARKS) : 0
        const line = hintLineColumns(columns, lead)
        // `used` is the cells of those very buttons (SELM-00081).
        expect(used).toBe(ENDS + kindCells + count * buttonWidth('[🔤]'))
        // ✕ and ⋯ stay however narrow: what is laid out beside them fits whenever they do.
        if (ENDS <= line) expect(ENDS + kindCells + count * buttonWidth('[🔤]')).toBeLessThanOrEqual(line)
        else expect({ kinds, count }).toEqual({ kinds: 'none', count: 0 })
      }
    }
  }
})

// SELM-00081: hintLayout says the cells its buttons take (`used`), so the
// hover label's width is the line less it, the buttons' widths not summed again.
test('used: ✕ and ⋯, the kind buttons as drawn and the first count actions', () => {
  const input = { kindsLabeled: 33, kindsMarks: 24, ends: 12, widths: [10, 10, 10] }
  // Named kinds: 12 + 33 + two actions.
  expect(hintLayout({ line: 70, ...input })).toEqual({ kinds: 'labeled', count: 2, used: 65 })
  // Marks: 12 + 24 + two actions.
  expect(hintLayout({ line: 60, ...input })).toEqual({ kinds: 'marks', count: 2, used: 56 })
  // No kind buttons: 12 + one action.
  expect(hintLayout({ line: 30, ...input })).toEqual({ kinds: 'none', count: 1, used: 22 })
  // Not measured: named kinds and the first UNMEASURED_COUNT (here all three).
  expect(hintLayout({ line: undefined, ...input })).toEqual({ kinds: 'labeled', count: 3, used: 12 + 33 + 30 })
  // ✕ and ⋯ wider than the line: they stay, and `used` says so, never cut to the line.
  expect(hintLayout({ line: 10, ...input })).toEqual({ kinds: 'none', count: 0, used: 12 })
})

test('used with the hover label\'s room: counted for the actions left after it, the room left clear', () => {
  const widths = Array.from({ length: 20 }, () => 9)
  const at = (line: number, tip?: number) => hintLayout({ line, kindsLabeled: 30, kindsMarks: 21, ends: 10, widths, ...(tip === undefined ? {} : { tip }) })
  // 130 cells: 10 + 30 + 8 actions, 18 left for the label.
  expect(at(130, TIP_RESERVE)).toEqual({ kinds: 'labeled', count: 8, used: 112 })
  expect(130 - at(130, TIP_RESERVE).used).toBeGreaterThanOrEqual(TIP_RESERVE)
  for (let line = 0; line <= 200; line++) {
    const { kinds, count, used } = at(line, TIP_RESERVE)
    const kindCells = kinds === 'labeled' ? 30 : kinds === 'marks' ? 21 : 0
    expect(used).toBe(10 + kindCells + count * 9)
    // Within the line whenever ✕ and ⋯ are; theirs alone where they are not.
    if (10 <= line) expect(used).toBeLessThanOrEqual(line)
    else expect(used).toBe(10)
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
