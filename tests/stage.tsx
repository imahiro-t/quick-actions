import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// Stands for the engine beneath the plugin in every test: records what the
// plugin asks of the models and the agents and answers it.

export const PLUGIN = 'selection-actions'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const BAND = {
  plugin: PLUGIN,
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

export const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: PLUGIN,
  props: {
    title: 'Selection Actions',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

export const SURFACES = ['terminal', 'desktop'] as const

export type Stage = {
  selected: string | null
  models: { model: string; system?: string; prompt: string }[]
  registered: { name: string; model?: string; tools?: readonly string[]; description: string }[]
  spawned: { subagentType: string; prompt: string }[]
  forks: string[]
  toasts: string[]
}

export const stage = (on: On): Stage => {
  const s: Stage = { selected: null, models: [], registered: [], spawned: [], forks: [], toasts: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.selection', () => ({ value: s.selected === null ? undefined : { text: s.selected } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_$, e) => {
    s.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('agent.register', (_$, e) => {
    s.registered.push({ name: e.name, model: e.model, tools: e.tools, description: e.description })
    return { value: { agent: `${PLUGIN}:${e.name}` } }
  })
  // A fresh id per spawn, so several subagents in one test never share one.
  // Beneath every plugin the spawn arrives as the Agent tool's input
  // (`subagent_type`); the typed `subagentType` is read too, whichever is set.
  on('agent.spawn', (_$, e) => {
    const raw = e as unknown as { subagentType?: string; subagent_type?: string }
    s.spawned.push({ subagentType: raw.subagent_type ?? raw.subagentType ?? '', prompt: e.prompt })
    return { model: 'sonnet', agentId: `agent-${s.spawned.length}` }
  })
  on('model.complete', (_$, e) => {
    s.models.push({ model: e.model, system: e.system, prompt: e.prompt })
    return { value: { isAnswered: true, text: `answer from ${e.model}`, usage } }
  })
  on('model.fork', (_$, e) => {
    s.forks.push(e.prompt)
    return { value: { isAnswered: true, text: 'answer in context', usage } }
  })
  return s
}

export const start = ($: Engine) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

// `/selection-actions <args>` typed at the prompt of a fullscreen terminal.
export const runCommand = ($: Engine, args: string) =>
  $.command.run({
    command: PLUGIN,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
