/** An action's ID as written in the `actions` setting (see hooks/actions.ts). */
export type ActionId = string

export type Result = {
  id: number
  action: ActionId
  /** The selected text it ran on, shortened; empty for a context action, which runs on the conversation. */
  quote: string
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
