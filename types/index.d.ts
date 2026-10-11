/** An action's ID as written in the `actions` setting (see hooks/actions.ts). */
export type ActionId = string

export type Result = {
  id: number
  action: ActionId
  /**
   * What it ran on: the selection, the conversation (context) or neither
   * (none, a standalone action). Every entry written now has it; one kept from
   * before it existed has none (an empty quote then means the conversation).
   */
  target?: 'selection' | 'context' | 'none'
  /** The selected text it ran on, shortened; empty for a context or standalone action. */
  quote: string
  /** A standalone action's argument as given, shortened; left out when it ran with none. */
  arg?: string
  /** Set on a run over time (a timer): its text is the frame now, and it stops when the pane closes. */
  ticker?: true
  status: 'running' | 'done' | 'failed'
  text: string
  /**
   * Where the selection it ran on lies: set on an action on the selection
   * alone, and only when the engine named the transcript row it lies in (a
   * selection within one row). Left out otherwise (several rows, a pane, the
   * prompt; a context or standalone action; an entry from before it existed).
   */
  origin?: ResultOrigin
}

/**
 * The transcript row a selection action's entry ran on, and whether that row
 * still shows it highlighted.
 */
export type ResultOrigin = {
  /** The row, by the id its `ui.render` hook reads as `e.requestId` and `$.ui.scroll` takes. */
  requestId: string
  /** True until the entry's "Clear highlight" is pressed. */
  highlighted: boolean
}

/**
 * The hint line `/quick-actions hint` opened. `text` is what was selected as
 * the command ran (trimmed), or null with nothing selected; `requestId`, the
 * transcript row it lies in, when the engine named one; `armed` turns true
 * once a selection made after it opened is seen, whose going then closes it.
 */
export type HintState = { text: string | null; requestId?: string; armed: boolean }

declare module 'claude-code' {
  interface PluginState {
    'quick-actions': {
      selection: string | null
      dismissed: string | null
      results: Result[]
      /**
       * The transcript rows drawn highlighted now (by requestId, sorted, each
       * once): what `results` says (an entry's origin, not cleared), kept
       * apart so that the transcript rows read this alone while they draw,
       * and are drawn again when it changes, not on every write of `results`
       * (a run over time writes it every tick). Written only when it changes.
       */
      highlightedRows: string[]
      /**
       * The ⋯ dialog: null while it is closed; open, the text it runs selection
       * actions on (null: none, context and standalone actions only) and what
       * its filter field holds (empty as it opens: every action listed);
       * `requestId`, the transcript row that text lies in, when there is one.
       */
      picking: { text: string | null; requestId?: string; filter: string } | null
      /** The hint line `/quick-actions hint` opened; null while it is not open that way. */
      hint: HintState | null
    }
  }
}
