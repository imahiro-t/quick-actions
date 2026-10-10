/** An action's ID as written in the `actions` setting (see hooks/actions.ts). */
export type ActionId = string

export type Result = {
  id: number
  action: ActionId
  /** What it ran on: the selection, the conversation (context) or neither (none, a standalone action). */
  target: 'selection' | 'context' | 'none'
  /** The selected text it ran on, shortened; empty for a context or standalone action. */
  quote: string
  /** A standalone action's argument as given, shortened; left out when it ran with none. */
  arg?: string
  /** Set on a run over time (a timer): its text is the frame now, and it stops when the pane closes. */
  ticker?: true
  status: 'running' | 'done' | 'failed'
  text: string
}

/**
 * The hint line `/quick-actions hint` opened. `text` is what was selected as
 * the command ran (trimmed), or null with nothing selected; `armed` turns true
 * once a selection made after it opened is seen, whose going then closes it.
 */
export type HintState = { text: string | null; armed: boolean }

declare module 'claude-code' {
  interface PluginState {
    'quick-actions': {
      selection: string | null
      dismissed: string | null
      results: Result[]
      /** The ⋯ dialog: null while it is closed; open, the text it runs selection actions on (null: none, context actions only). */
      picking: { text: string | null } | null
      /** The hint line `/quick-actions hint` opened; null while it is not open that way. */
      hint: HintState | null
    }
  }
}
