import { expect, test } from 'claude-code/testing'

import { BASE_COLUMNS, BUTTON_GAP, buttonWidth, dockWidth, hintCountFor, hintLineColumns, hintTarget, textWidth } from '../hooks/hint-width'
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
  expect(buttonWidth('[💡]')).toBe(4 + BUTTON_GAP)
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
