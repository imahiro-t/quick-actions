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
  /**
   * The argument as typed (trimmed), in full, for "again" to run with once more;
   * left out when it ran with none. `arg` is its shortened quote, for the heading.
   */
  input?: string
  /** Set on a run over time (a timer): its text is the frame now, and it stops when the pane closes. */
  ticker?: true
  /**
   * Set as a run over time starts, before anything can refuse or end it: the
   * entry is of a timer (or the like), so once it is no longer running the pane
   * offers to run it again. Unlike `ticker`, it says nothing of a frame drawn.
   */
  timed?: true
  status: 'running' | 'done' | 'failed'
  text: string
}

/**
 * The hint line `/quick-actions hint` opened. `text` is what was selected as
 * the command ran (trimmed), or null with nothing selected; `armed` turns true
 * once a selection made after it opened is seen, whose going then closes it.
 */
/** The ⋯ dialog's argument screen: the action, what its field holds, the error of the last Enter. */
export type ArgInput = { action: ActionId; value: string; error?: string }

export type HintState = { text: string | null; armed: boolean }

declare module 'claude-code' {
  interface PluginState {
    'quick-actions': {
      selection: string | null
      dismissed: string | null
      results: Result[]
      /**
       * The ⋯ dialog: null while it is closed; open, the text it runs selection
       * actions on (null: none, context and standalone actions only) and what
       * its filter field holds (empty as it opens: every action listed).
       * With `arg`, it shows the argument screen of that standalone action
       * instead of the list: what its field holds, and why the last Enter did
       * not run it (an argument that does not parse); without, the list.
       */
      picking: { text: string | null; filter: string; arg?: ArgInput } | null
      /** The hint line `/quick-actions hint` opened; null while it is not open that way. */
      hint: HintState | null
    }
  }
}
