import type { Result } from '../types'

// The entries of the result pane, worked out from the results alone. Pure, so
// the tests check it directly.
//
// An entry run on a selection within one transcript row keeps that row
// (Result.origin) for its "Go to selection", and nothing more: the row is not
// drawn marked. The engine tells a selection's row but not where in it the
// selection lies (UiSelection has its text and row alone), and a row drawn by
// the engine (a reply's markdown, a tool's own renderer, a prompt with its
// mark and background) cannot be drawn over with a span of colour without the
// plugin drawing the row itself, and so losing that drawing. A whole row
// drawn highlighted told nothing of which words were picked, so it is gone.

/**
 * The ID a new entry takes: past every entry kept (the results outlive a
 * reload of the module, whose own count starts again from 1) and past `next`,
 * the module's count, so an ID is never handed out twice.
 */
export function nextEntryId(results: readonly Result[], next: number): number {
  return results.reduce((max, r) => Math.max(max, r.id + 1), next)
}
