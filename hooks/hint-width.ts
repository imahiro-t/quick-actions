// How many actions the hint line under the prompt shows, from the width it
// has: pure functions over plain numbers and strings, nothing here reaches `$`.
//
// The `hintCount` setting is the count on an 80-column line. A wider line
// shows more in proportion (hintCount × columns / 80) and a narrower one fewer,
// never more than fit beside the kind buttons, ✕ and ⋯, nor more than there
// are. A person who set a small count keeps that proportion: 3 on 80 columns
// is 6 on 160, not as many as fit.
//
// The line sits under the prompt, which shares the transcript's column: while
// one of this plugin's panes is docked beside it (the terminal in fullscreen
// from 110 columns), the line is the terminal's width less the dock's. The
// dock is measured where it is drawn (the pane's bodyColumns plus its frame);
// another plugin's dock cannot be seen from here and is not taken off.
//
// The row also holds, at its left, the session's mode as the engine draws it
// (`▸▸ auto mode on ·`): its cells come off what the buttons may take
// (leadWidth), though not off the width the count is in proportion to.
//
// A button is drawn `[ label ]` on the terminal: its label and a frame of four
// cells (SELM-00058: counted as its label and two before, every button came
// out four cells short of what is drawn, the line was given more than it holds,
// and the row squeezed each button until its closing `]` fell onto a second row).

/** The width the `hintCount` setting is the count for. */
export const BASE_COLUMNS = 80

/** What a dock takes beyond its body: the frame's two sides and the rule beside the transcript (an estimate on the safe side). */
export const DOCK_FRAME = 3

/** The cells a button's frame takes beyond its label: `[ ` and ` ]`. */
export const BUTTON_FRAME = 4

/** The cells counted between one button and the next (an estimate on the safe side: the engine may draw them flush). */
export const BUTTON_GAP = 1

/** The cell more a label with an emoji is counted, since a terminal may draw an emoji a cell wider than counted. */
export const EMOJI_EXTRA = 1

/** The fewest actions the kind buttons drawn with their names leave room for; fewer, and they are drawn as their marks alone. */
export const MIN_LABELED_ACTIONS = 2

/** The cells the mode drawn at the row's left is taken to take before it is known: `⏵⏵ accept edits on · ` (21) and one to spare. */
export const LEAD_RESERVE = 22

/** What the mode at the row's left takes beyond its labels: the mark before them (`▸▸ `). */
export const LEAD_MARK = 3

/** What each mode label takes beyond itself: the separator after it (` · `, or ` & ` between two). */
export const LEAD_SEPARATOR = 3

/** The surfaces the engine raises SessionMode on, where the mode is drawn beside the hint line. */
export const SESSION_MODE_SURFACES: readonly string[] = ['terminal', 'desktop']

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

/** What a docked pane takes off the line: its body's columns and its frame. */
export const dockWidth = (bodyColumns: number) => bodyColumns + DOCK_FRAME

/**
 * The cells the mode drawn at the row's left takes, from the labels the
 * session shows (SessionMode's `modes`): none with none, else the mark before
 * them and a separator after each.
 */
export function leadWidth(modes: readonly string[]): number {
  if (modes.length === 0) return 0
  return LEAD_MARK + modes.reduce((sum, mode) => sum + textWidth(mode) + LEAD_SEPARATOR, 0)
}

/**
 * The cells taken off the hint line on `surface` for the mode at its left:
 * the width of the modes last drawn there; LEAD_RESERVE on a surface that
 * draws them (SESSION_MODE_SURFACES) before any are known there; none on
 * one that never does.
 */
export function leadFor(surface: string, modes: readonly string[] | undefined): number {
  if (modes !== undefined) return leadWidth(modes)
  return SESSION_MODE_SURFACES.includes(surface) ? LEAD_RESERVE : 0
}

/**
 * The columns the hint line has for its buttons: the terminal's, less the
 * dock of this plugin's pane while one is docked beside the transcript (0:
 * none) and the mode drawn at the row's left (0: none).
 */
export function hintLineColumns(viewportColumns: number, dock: number, lead = 0): number {
  return Math.max(0, viewportColumns - Math.max(0, dock) - Math.max(0, lead))
}

/**
 * How many the `hintCount` setting asks for on a line `columns` wide: in
 * proportion to BASE_COLUMNS, one at least.
 */
export function hintTarget(columns: number, hintCount: number): number {
  return Math.max(1, Math.floor((hintCount * columns) / BASE_COLUMNS))
}

/** How many of `widths`, in order, fit in `room`, at most `target`: the first that does not fit ends it. */
function fitting(room: number, target: number, widths: readonly number[]): number {
  let left = room
  let count = 0
  for (const width of widths) {
    if (count >= target || width > left) break
    left -= width
    count++
  }
  return count
}

/**
 * How many of the actions the hint line shows. `widths` are their buttons'
 * cells (buttonWidth), in the line's order; `reserved` the cells of the rest
 * of the line (the kind buttons, ✕ and ⋯). With no width measured, the
 * setting's count as it always was. Otherwise as many as hintTarget asks for,
 * in order, while they fit: none when not even the first does, so the line
 * never runs past its width.
 */
export function hintCountFor(columns: number | undefined, hintCount: number, reserved: number, widths: readonly number[]): number {
  if (columns === undefined) return Math.min(hintCount, widths.length)
  return fitting(columns - reserved, hintTarget(columns, hintCount), widths)
}

/** How the kind buttons are drawn: with their names, as their marks alone, or not at all. */
export type KindsDrawn = 'labeled' | 'marks' | 'none'

export type HintLayoutInput = {
  /** The cells the buttons have (hintLineColumns); undefined when not measured. */
  line: number | undefined
  /** How many actions at most (hintTarget, of the line before the mode comes off; the setting when not measured). */
  target: number
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
 * MIN_LABELED_ACTIONS actions (or as many as `target` asks for or there are,
 * when fewer) still fit beside them; else as their marks alone; else, too
 * narrow even for those beside ✕ and ⋯, left out. Then as many actions as fit
 * and `target` asks for, none when not even one does: the buttons are never
 * more than the line holds, so none is squeezed onto a second row, and ⋯
 * always stays to reach the rest.
 */
export function hintLayout({ line, target, kindsLabeled, kindsMarks, ends, widths }: HintLayoutInput): { kinds: KindsDrawn; count: number } {
  if (line === undefined) return { kinds: 'labeled', count: Math.min(target, widths.length) }
  const wanted = Math.min(MIN_LABELED_ACTIONS, target, widths.length)
  if (ends + kindsLabeled <= line) {
    const count = fitting(line - ends - kindsLabeled, target, widths)
    if (count >= wanted) return { kinds: 'labeled', count }
  }
  if (ends + kindsMarks <= line) return { kinds: 'marks', count: fitting(line - ends - kindsMarks, target, widths) }
  return { kinds: 'none', count: fitting(line - ends, target, widths) }
}
