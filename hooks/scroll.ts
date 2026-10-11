import type { UiScrollArgs } from 'claude-code'

// The newest result is drawn first in the pane, so bringing the pane back to
// its top shows it even when the person had scrolled down to older ones.
// register.tsx spells the call itself ($.ui.scroll(...) at the call site, as
// the engine requires); these two say what it asks for and how it settles.

/** What run() asks of $.ui.scroll: the start (top) of the pane `pane`. */
export const toLatest = (pane: string): UiScrollArgs => ({ in: pane, to: 'start' })

/**
 * Waits for the scroll (or a focus move) and lets nothing out: a refusal
 * ({ deny }) or a rejection leaves the pane where it was, and whatever asked
 * for it runs on regardless.
 */
export async function settleQuietly(scrolled: Promise<unknown>): Promise<void> {
  try {
    await scrolled
  } catch {
    // Left where it was; see above.
  }
}

/**
 * What a result's "Go to selection" asks of $.ui.scroll: the transcript row
 * `requestId` its selection lay in, brought to the middle of the window. No
 * `in`: the engine finds the transcript that draws the row. It moves only as
 * the answer to the person's press, so the call is made in the onPress itself.
 */
export const toRow = (requestId: string): UiScrollArgs => ({ to: { requestId }, block: 'center' })
