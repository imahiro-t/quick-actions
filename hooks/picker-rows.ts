// How many actions the ⋯ dialog lists, from the pane's height: pure functions
// over plain numbers and strings, nothing here reaches `$`.
//
// The list is a column of buttons, one per action, drawn `[ <icon> label ]`.
// A pane is about 34 columns wide when docked, so a long label (an English
// name, a Japanese one in full-width characters) wraps onto a second row:
// each button's rows are estimated from its label's width, and so are those of
// the lines around the list (the notice, the legend, the "n more" line). The
// estimates round up, so that the list comes out a row short rather than a row
// over and the pane never scrolls for it.
//
// The rest of the dialog is the filter row and the close button, a row each,
// and the lines handed in as `chrome`. Every action fits: all of them, no
// "n more" line. Otherwise as many as fit above that line, and never fewer
// than MIN_SHOWN (when the pane is that short, it scrolls).

import { textWidth } from './hint-width'

/**
 * The cells a button takes beyond its label: `[ ` and ` ]`, and one more,
 * since a terminal may draw an emoji a cell wider than counted.
 */
export const BUTTON_CHROME = 5

/** The rows of the dialog that are neither the list nor `chrome`: the filter row and the close button. */
export const FIXED_ROWS = 2

/** The fewest actions listed, however short the pane. */
export const MIN_SHOWN = 3

/** The rows `text` takes wrapped at `columns` (one at least; columns below 1 taken as 1). */
export function linesOf(text: string, columns: number): number {
  return Math.max(1, Math.ceil(textWidth(text) / Math.max(1, columns)))
}

/** The rows the button labelled `label` takes at `columns`. */
export function buttonLines(label: string, columns: number): number {
  return Math.max(1, Math.ceil((textWidth(label) + BUTTON_CHROME) / Math.max(1, columns)))
}

export type ShownCountInput = {
  /** The pane body's rows (scroll.bodyRows). */
  bodyRows: number
  /** The pane body's columns. */
  bodyColumns: number
  /** The lines drawn besides the list, the filter row and the close button: each wraps on its own. */
  chrome: readonly string[]
  /** Each action's button label, in the order listed. */
  labels: readonly string[]
  /** The line under a list cut short, for that many left out. */
  more: (count: number) => string
}

/** How many of `labels`, from the first, the list shows. */
export function pickerShownCount({ bodyRows, bodyColumns, chrome, labels, more }: ShownCountInput): number {
  const columns = Math.max(1, bodyColumns)
  const budget = bodyRows - FIXED_ROWS - chrome.reduce((sum, line) => sum + linesOf(line, columns), 0)
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
