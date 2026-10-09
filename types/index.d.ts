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
      results: Result[]
    }
  }
}
