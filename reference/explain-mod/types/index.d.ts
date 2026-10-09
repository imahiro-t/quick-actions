export type ActionId = 'meaning' | 'translate' | 'code' | 'ask'

export type Result = {
  id: number
  action: ActionId
  quote: string
  status: 'running' | 'done' | 'failed'
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    explain: {
      selection: string | null
      dismissed: string | null
      results: Result[]
    }
  }
}
