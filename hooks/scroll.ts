import type { UiScrollArgs, UiScrollResult } from 'claude-code'

// The newest result is drawn first in the pane, so bringing the pane back to
// its top shows it even when the person had scrolled down to older ones.
// register.tsx spells the call itself ($.ui.scroll(...) at the call site, as
// the engine requires); these two say what it asks for and how it settles.

/** What run() asks of $.ui.scroll: the start (top) of the pane `pane`. */
export const toLatest = (pane: string): UiScrollArgs => ({ in: pane, to: 'start' })

/**
 * Waits for the scroll and lets nothing out: a refusal ({ deny }) or a
 * rejection leaves the pane where it was, and the action that asked for the
 * scroll runs on regardless.
 */
export async function settleQuietly(scrolled: Promise<UiScrollResult>): Promise<void> {
  try {
    await scrolled
  } catch {
    // Left where it was; see above.
  }
}
