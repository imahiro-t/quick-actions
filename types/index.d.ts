/** An action's ID as written in the `actions` setting (see hooks/actions.ts). */
export type ActionId = string

export type Result = {
  id: number
  action: ActionId
  quote: string
  status: 'running' | 'done' | 'failed'
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'selection-actions': {
      selection: string | null
      dismissed: string | null
      results: Result[]
      /** The text the ⋯ dialog runs on, read as it opened; null while it is closed. */
      picking: string | null
    }
  }
}
