import type { Result, ResultOrigin } from '../types'

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

/** The transcript rows a selection can lie in and that are drawn highlighted (UiSelection.requestId names one). */
export const HIGHLIGHT_ROWS = ['UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'CommandOutput'] as const

/**
 * The origins of the entries whose highlight is on row `requestId`, newest
 * first: those not cleared. A row with one or more is drawn highlighted.
 */
export function highlightsFor(results: readonly Result[], requestId: string): ResultOrigin[] {
  return results.flatMap(r => (r.origin !== undefined && r.origin.highlighted && r.origin.requestId === requestId ? [r.origin] : []))
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
