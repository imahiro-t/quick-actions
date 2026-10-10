import type { UiFocusArgs } from 'claude-code'

// The ⋯ dialog's filter field, by the key it is drawn under. Its Clear button
// is drawn only while the field holds text, so a press on it removes the very
// element the focus ring was on; the ring is handed back to the field.
// register.tsx spells the call itself ($.ui.focus(...) at the call site, as
// the engine requires) and settles it with settleQuietly (./scroll): a refusal
// or a rejection leaves the ring where the engine put it, and the filter is
// emptied regardless.

/** The key the ⋯ dialog's filter field is drawn under. */
export const FILTER_KEY = '_filter'

/** What Clear asks of $.ui.focus: the filter field of the dialog `pane`. */
export const toFilterField = (pane: string): UiFocusArgs => ({ requestId: pane, key: FILTER_KEY })
