// How many actions the hint line under the prompt shows, from the width it
// has: pure functions over plain numbers and strings, nothing here reaches `$`.
//
// As many as fit beside the kind buttons, ✕ and ⋯, never more than there
// are; UNMEASURED_COUNT where the width is not known.
//
// The line sits under the prompt, which shares the transcript's column: its
// width is the viewport's columns as the engine hands them to PromptHint. On
// the terminal those are the transcript's column, so while a pane is docked
// beside it (the terminal in fullscreen from 110 columns), any plugin's, they
// are already the terminal's width less the dock's, and nothing more comes off
// for it. (SELM-00066: seen in a pseudo-terminal, 180 columns with this
// plugin's pane docked give a viewport of 123, the dock's 57 already off. The
// dock was once taken off again, leaving 123 − 59 − 30 = 34 cells for the
// buttons: past ✕ and ⋯ and the kind buttons, room for one action at most, and
// at 160 columns none.)
//
// The row also holds, at its left, the permission mode the engine draws there
// (`⏵⏵ auto mode on ·`, shift+tab cycles it), and the footer keeps two
// columns clear at each side. No hook says which mode is up, so on the
// surfaces that draw it LEAD_RESERVE, the widest mode's cells, always comes
// off what the buttons may take. (SessionMode, the footer's dim mode labels such as `focus`,
// is drawn on the row above, not on this one: seen in a pseudo-terminal.)
//
// A button is drawn `[ label ]` on the terminal, flush against the next
// (`[ a ][ b ]`): its label and a frame of four cells (SELM-00058: counted as
// its label and two, every button came out two cells short of what is drawn,
// the line was given more than it holds, and the row squeezed each button until
// its closing `]` fell onto a second row, the mode at its left squeezed too).

/** How many actions the hint line shows where its width is not known. */
export const UNMEASURED_COUNT = 6

/** The cells a button's frame takes beyond its label: `[ ` and ` ]`. */
export const BUTTON_FRAME = 4

/** The cells between one button and the next: none, the terminal draws them flush (`[ a ][ b ]`). */
export const BUTTON_GAP = 0

/** The cell more a label with an emoji is counted, since a terminal may draw an emoji a cell wider than counted. */
export const EMOJI_EXTRA = 1

/** The fewest actions the kind buttons drawn with their names leave room for; fewer, and they are drawn as their marks alone. */
export const MIN_LABELED_ACTIONS = 2

/**
 * The cells of the hint line's row that are not the buttons': the footer's two
 * columns at each side and the widest permission mode at the left,
 * `⏵⏵ bypass permissions on ·` (26). The others take fewer (`⏵⏵ auto mode on ·`
 * 17, `⏵⏵ accept edits on ·` 20, `⏸ manual mode on ·` 18, `⏸ plan mode on ·` 16),
 * so the buttons never run into the mode, whichever is up.
 */
export const LEAD_RESERVE = 30

/** The surfaces that draw the permission mode at the left of the hint line's row (those PromptHint is raised on). */
export const LEAD_SURFACES: readonly string[] = ['terminal', 'desktop']

// The symbols of the Miscellaneous Technical, Miscellaneous Symbols and
// Dingbats blocks drawn as emoji (two cells) by default; the rest of those
// blocks (✕, ✓, ⚠ without its variation selector) take one.
const WIDE_SYMBOLS: readonly (readonly [number, number])[] = [
  [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693],
  [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
]

/** Whether `cp` is drawn two cells wide: East Asian wide and full-width forms, and emoji. */
function isWide(cp: number): boolean {
  if (WIDE_SYMBOLS.some(([from, to]) => cp >= from && cp <= to)) return true
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
}

/** Whether `cp` is an emoji drawn two cells wide (not an East Asian wide character, which the terminal draws as counted). */
function isWideEmoji(cp: number): boolean {
  return WIDE_SYMBOLS.some(([from, to]) => cp >= from && cp <= to) || (cp >= 0x1f000 && cp <= 0x1faff)
}

/** Whether `cp` takes no cell of its own: a joiner, a variation selector, a combining mark, a skin tone. */
function isZeroWidth(cp: number): boolean {
  return cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)
}

/**
 * The cells `text` takes on a terminal: wide characters and emoji count two,
 * as does a one-cell symbol that a variation selector-16 turns into an emoji (⚠️).
 */
export function textWidth(text: string): number {
  let width = 0
  let last = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f && last === 1) {
      width += 1
      last = 2
      continue
    }
    if (isZeroWidth(cp)) continue
    last = isWide(cp) ? 2 : 1
    width += last
  }
  return width
}

/** Whether `text` holds an emoji: one drawn wide, or a symbol a variation selector-16 turns into one (⚠️). */
export function hasEmoji(text: string): boolean {
  let last = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isWideEmoji(cp) || (cp === 0xfe0f && last !== 0)) return true
    last = isZeroWidth(cp) ? last : cp
  }
  return false
}

/**
 * The cells a button labelled `label` takes on the line: its label, the frame
 * the terminal draws round it (`[ label ]`) and the gap to the next; a cell
 * more when it holds an emoji (full-width characters alone take none more).
 */
export const buttonWidth = (label: string) => textWidth(label) + BUTTON_FRAME + BUTTON_GAP + (hasEmoji(label) ? EMOJI_EXTRA : 0)

/** The cells taken off the hint line's row on `surface` beside its buttons: LEAD_RESERVE where the mode is drawn at its left, else none. */
export function leadFor(surface: string): number {
  return LEAD_SURFACES.includes(surface) ? LEAD_RESERVE : 0
}

/**
 * The columns the hint line has for its buttons: the viewport's (on the
 * terminal the transcript's column, a docked pane's already off) less the rest
 * of the row (leadFor; 0: none).
 */
export function hintLineColumns(viewportColumns: number, lead = 0): number {
  return Math.max(0, viewportColumns - Math.max(0, lead))
}

/**
 * How many actions a line `columns` wide could take at most, each a button of
 * one cell's label (UNMEASURED_COUNT when not measured): the candidates to
 * measure, not every one of hundreds.
 */
export function hintMost(columns: number | undefined): number {
  return columns === undefined ? UNMEASURED_COUNT : Math.floor(columns / (BUTTON_FRAME + BUTTON_GAP + 1))
}

/** How many of `widths`, in order, fit in `room`: the first that does not fit ends it. */
function fitting(room: number, widths: readonly number[]): number {
  let left = room
  let count = 0
  for (const width of widths) {
    if (width > left) break
    left -= width
    count++
  }
  return count
}

/** How the kind buttons are drawn: with their names, as their marks alone, or not at all. */
export type KindsDrawn = 'labeled' | 'marks' | 'none'

export type HintLayoutInput = {
  /** The cells the buttons have (hintLineColumns); undefined when not measured. */
  line: number | undefined
  /** The kind buttons' cells drawn with their names. */
  kindsLabeled: number
  /** The kind buttons' cells drawn as their marks alone. */
  kindsMarks: number
  /** The cells of ✕ and ⋯, always drawn. */
  ends: number
  /** The candidate actions' cells (buttonWidth), in the line's order. */
  widths: readonly number[]
}

/**
 * How the hint line is laid out: the kind buttons with their names while
 * MIN_LABELED_ACTIONS actions (or as many as there are, when fewer) still fit
 * beside them; else as their marks alone; else, too narrow even for those
 * beside ✕ and ⋯, left out. Then as many actions as fit, none when not even
 * one does (UNMEASURED_COUNT when not measured): the buttons are never
 * more than the line holds, so none is squeezed onto a second row, and ⋯
 * always stays to reach the rest. Should the estimate still fall short of
 * what is drawn, the row cuts the actions alone (./register PromptHint).
 */
export function hintLayout({ line, kindsLabeled, kindsMarks, ends, widths }: HintLayoutInput): { kinds: KindsDrawn; count: number } {
  if (line === undefined) return { kinds: 'labeled', count: Math.min(UNMEASURED_COUNT, widths.length) }
  const wanted = Math.min(MIN_LABELED_ACTIONS, widths.length)
  if (ends + kindsLabeled <= line) {
    const count = fitting(line - ends - kindsLabeled, widths)
    if (count >= wanted) return { kinds: 'labeled', count }
  }
  if (ends + kindsMarks <= line) return { kinds: 'marks', count: fitting(line - ends - kindsMarks, widths) }
  return { kinds: 'none', count: fitting(line - ends, widths) }
}
