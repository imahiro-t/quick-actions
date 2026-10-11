import type { RenderPropsOf } from 'claude-code'

import type { Result } from '../types'

// Which transcript rows are drawn highlighted, worked out from the results
// alone: a highlight lives on the entry it belongs to (Result.origin), so it
// goes when that entry is pushed out of the pane, and clearing one entry's
// leaves every other entry's as it is. Pure, so the tests check it directly.
//
// The whole row is highlighted, never the selected words alone: the engine
// tells a selection's row but not where in it the selection lies, and a row
// drawn by the engine (a reply's markdown, a tool's own renderer, a prompt
// with its mark and background) cannot be drawn over with a span of colour
// without the plugin drawing the row itself, and so losing that drawing.

/**
 * The transcript rows a selection can lie in (UiSelection.requestId names
 * one) and that are drawn highlighted: every component the transcript draws
 * as a row of its own. Left out are the components drawn outside the
 * transcript (SessionMode, PromptHint, AbovePrompt, Pane) and the Spinner,
 * the live line that goes as the turn ends: a selection there names no row,
 * so its entry gets no origin, and so no buttons.
 */
export const HIGHLIGHT_ROWS = [
  'UserMessage',
  'AssistantMessage',
  'ToolUse',
  'ToolResult',
  'ToolGroup',
  'ToolProgress',
  'CommandOutput',
  'InfoNotice',
  'TurnDuration',
  'AskUserQuestion',
] as const

type HighlightRow = (typeof HIGHLIGHT_ROWS)[number]

/** A drawing of one of HIGHLIGHT_ROWS, as its `ui.render` hook sees it (the part read here). */
export type RowDrawing = { [C in HighlightRow]: { component: C; requestId: string; props: RenderPropsOf[C] } }[HighlightRow]

/**
 * The ids a selection's row may be named by that this drawing shows: its own,
 * and for a folded group of tool calls, each call's (the engine may name the
 * call a selection lies in); for a progress row, the call it is under (drawn
 * with that call, as a call's result block is).
 */
export function rowIdsOf(e: RowDrawing): string[] {
  if (e.component === 'ToolGroup') {
    return [e.requestId, ...e.props.calls.flatMap(c => (typeof c.tool_use_id === 'string' && c.tool_use_id !== '' ? [c.tool_use_id] : []))]
  }
  if (e.component === 'ToolProgress') return [e.requestId, e.props.tool_use_id]
  return [e.requestId]
}

/** Whether a drawing is of a row in `rows` (highlightedRowsOf's): drawn highlighted. */
export function isHighlighted(rows: readonly string[], e: RowDrawing): boolean {
  return rowIdsOf(e).some(id => rows.includes(id))
}

/**
 * The rows drawn highlighted, as `results` says: the row of every entry whose
 * highlight is on, each once, sorted (so two lists of the same rows are equal,
 * whatever order the entries came in).
 */
export function highlightedRowsOf(results: readonly Result[]): string[] {
  const rows = new Set<string>()
  for (const r of results) if (r.origin !== undefined && r.origin.highlighted) rows.add(r.origin.requestId)
  return [...rows].sort()
}

/** Whether two lists of rows (highlightedRowsOf's) are the same. */
export function sameRows(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** `results` with the highlight of entry `id` off; every other entry as it was. */
export function clearHighlight(results: readonly Result[], id: number): Result[] {
  return results.map(r => (r.id === id && r.origin !== undefined ? { ...r, origin: { ...r.origin, highlighted: false } } : r))
}

/**
 * The ID a new entry takes: past every entry kept (the results outlive a
 * reload of the module, whose own count starts again from 1) and past `next`,
 * the module's count, so an ID is never handed out twice.
 */
export function nextEntryId(results: readonly Result[], next: number): number {
  return results.reduce((max, r) => Math.max(max, r.id + 1), next)
}
