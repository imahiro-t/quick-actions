// How many actions the ⋯ dialog lists, from the pane's height: pure functions
// over plain numbers and strings, nothing here reaches `$`.
//
// The list is a column of buttons, one per action, drawn `[ <icon> label ]`.
// A pane's body is a few dozen columns wide (56 when docked, fewer inline on a
// narrow terminal), so a long label (an English name, a Japanese one in
// full-width characters) can wrap onto a second row:
// each button's rows are counted from its label, and so are those of the
// lines around the list (the "n more" line) and of the row of kind buttons
// above it, which wraps button by button (kindRowLines).
//
// The terminal wraps a line at its spaces, not at its last cell: a word that
// does not fit on the row goes whole onto the next, and only a word wider than
// the row is broken inside (Japanese with no spaces, one character at a time).
// So the rows are counted the same way, word by word (wrappedRows), never as
// the width over the columns, which comes out a row short when a word is sent
// on with cells to spare. A button is counted a cell narrower than the pane,
// in case a terminal draws an emoji a cell wider than counted: a row over
// rather than a row short, so that the pane never scrolls for the list.
//
// The rest of the dialog is the filter row and the close button, a row each,
// the lines handed in as `chrome` and the row of buttons handed in as
// `buttons`. Every action fits: all of them, no
// "n more" line. Otherwise as many as fit above that line, and never fewer
// than MIN_SHOWN (when the pane is that short, it scrolls).

import { BUTTON_FRAME, textWidth } from './hint-width'
import { HINT_KINDS } from './order'
import type { HintKind } from './order'

/** The cells a button's frame takes beyond its label: `[ ` and ` ]` (one constant with the hint line's). */
export { BUTTON_FRAME }

/** The cells a button is counted narrower than the pane, for an emoji drawn wider than counted. */
export const EMOJI_SLACK = 1

/** The rows of the dialog that are neither the list nor `chrome`: the filter row and the close button. */
export const FIXED_ROWS = 2

/** The fewest actions listed, however short the pane. */
export const MIN_SHOWN = 3

/**
 * The rows `text` takes wrapped at `columns` (columns below 1 taken as 1), as
 * the terminal wraps it: at the spaces, a word that does not fit going whole
 * onto the next row, a space kept at the end of the row it follows, and a
 * word wider than the row broken where the row ends (begun on a row of its
 * own when that saves a break), a wide character never split across rows.
 * Each line of a text of several lines counts on its own; one row at least.
 */
export function wrappedRows(text: string, columns: number): number {
  const cols = Math.max(1, Math.floor(columns))
  return text.split('\n').reduce((sum, line) => sum + lineRows(line, cols), 0)
}

function lineRows(line: string, columns: number): number {
  let rows = 1
  let used = 0
  line.split(' ').forEach((word, index) => {
    const width = textWidth(word)
    if (index > 0) {
      // A full row starts another, and the space goes on (it is kept, not trimmed).
      if (used >= columns) {
        rows++
        used = 0
      }
      used++
    }
    if (width > columns) {
      // Too wide for any row: begun on the next row when that takes fewer breaks.
      const thisRow = 1 + Math.floor((width - (columns - used) - 1) / columns)
      const nextRow = Math.floor((width - 1) / columns)
      if (nextRow < thisRow) {
        rows++
        used = 0
      }
      const chars = [...word]
      chars.forEach((ch, i) => {
        const w = textWidth(ch)
        if (used + w > columns) {
          rows++
          used = 0
        }
        used += w
        if (used === columns && i < chars.length - 1) {
          rows++
          used = 0
        }
      })
      return
    }
    if (used > 0 && width > 0 && used + width > columns) {
      rows++
      used = 0
    }
    used += width
  })
  return rows
}

/** The rows `text` takes at `columns` (see wrappedRows). */
export function linesOf(text: string, columns: number): number {
  return wrappedRows(text, columns)
}

/** The rows the button labelled `label` takes at `columns`: `[ label ]`, wrapped a cell narrower. */
export function buttonLines(label: string, columns: number): number {
  return wrappedRows(`[ ${label} ]`, Math.max(1, columns) - EMOJI_SLACK)
}

/**
 * The labels the ⋯ dialog's kind buttons draw, in their order: every kind's
 * with text to run on, else all but the selection's (it needs text).
 */
export function pickerKindLabels(t: { pickerKinds: Readonly<Record<HintKind, string>> }, hasSelection: boolean): string[] {
  return pickerKindsShown(hasSelection).map(k => t.pickerKinds[k])
}

/** The kinds the ⋯ dialog draws a button for: every kind with text to run on, else all but the selection's. */
export const pickerKindsShown = (hasSelection: boolean): HintKind[] => HINT_KINDS.filter(k => k !== 'selection' || hasSelection)

/** The row of kind buttons as the terminal draws it, each `[ label ]`, flush against the next. */
export function pickerKindRow(t: { pickerKinds: Readonly<Record<HintKind, string>> }, hasSelection: boolean): string {
  return pickerKindLabels(t, hasSelection)
    .map(label => `[ ${label} ]`)
    .join('')
}

/**
 * The rows a row of buttons labelled `labels` takes at `columns`, wrapped
 * button by button (a Box that wraps its children): as many whole buttons on
 * a row as fit, counted a cell narrower (EMOJI_SLACK); a button wider than
 * the row alone takes the rows of its own label wrapped (buttonLines). None: no row.
 */
export function kindRowLines(labels: readonly string[], columns: number): number {
  if (labels.length === 0) return 0
  const cols = Math.max(1, Math.max(1, columns) - EMOJI_SLACK)
  let rows = 0
  let used = 0
  for (const label of labels) {
    const width = textWidth(label) + BUTTON_FRAME
    if (width > cols) {
      rows += (used > 0 ? 1 : 0) + buttonLines(label, columns)
      used = 0
      continue
    }
    if (used > 0 && used + width > cols) {
      rows++
      used = 0
    }
    used += width
  }
  return rows + (used > 0 ? 1 : 0)
}

export type ShownCountInput = {
  /** The pane body's rows (scroll.bodyRows). */
  bodyRows: number
  /** The pane body's columns. */
  bodyColumns: number
  /** The lines drawn besides the list, the filter row and the close button: each wraps on its own. */
  chrome: readonly string[]
  /** The labels of a row of buttons drawn besides them (the kind buttons), wrapped button by button (kindRowLines); none, no row. */
  buttons?: readonly string[]
  /** Each action's button label, in the order listed. */
  labels: readonly string[]
  /** The line under a list cut short, for that many left out. */
  more: (count: number) => string
}

/** How many of `labels`, from the first, the list shows. */
export function pickerShownCount({ bodyRows, bodyColumns, chrome, buttons = [], labels, more }: ShownCountInput): number {
  const columns = Math.max(1, bodyColumns)
  const budget = bodyRows - FIXED_ROWS - chrome.reduce((sum, line) => sum + linesOf(line, columns), 0) - kindRowLines(buttons, columns)
  const rows = labels.map(label => buttonLines(label, columns))
  if (rows.reduce((sum, n) => sum + n, 0) <= budget) return labels.length
  // Cut short: the "n more" line goes under it, measured at its widest count.
  let left = budget - linesOf(more(labels.length), columns)
  let count = 0
  for (const n of rows) {
    if (n > left) break
    left -= n
    count++
  }
  return Math.max(count, Math.min(MIN_SHOWN, labels.length))
}
