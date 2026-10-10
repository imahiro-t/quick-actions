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

/** The test options that pin the display and answer language. */
export const JA = { language: 'ja' } as const
export const EN = { language: 'en' } as const

/** Any Japanese character (kana, kanji, full-width punctuation and brackets): none may show in English. */
export const JAPANESE = /[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/

export type Stage = {
  selected: string | null
  models: { model: string; system?: string; prompt: string }[]
  registered: { name: string; model?: string; tools?: readonly string[]; description: string; prompt: string }[]
  commands: { name: string; description: string }[]
  spawned: { subagentType: string; prompt: string }[]
  forks: string[]
  toasts: string[]
  // How the models answer: with text, or with none.
  answer: 'text' | 'empty'
  // Set to have every spawn refused with this reason.
  spawnDeny: string | null
  // Set to have every model call, and every subagent registration, refused
  // beneath the plugin with this reason: the plugin's call then rejects.
  refuse: string | null
  // What $.settings.read() answers (Claude Code's merged settings), how many
  // times the plugin asked, and a reason to refuse it with instead.
  settings: Record<string, unknown>
  settingsReads: number
  settingsDeny: string | null
  // Set to hold every model call until it settles: the pane shows it running meanwhile.
  hold: Promise<void> | null
}

const reply = (s: Stage, text: string) => {
  return s.answer === 'empty'
    ? ({ isAnswered: false, reason: 'empty-reply', usage } as const)
    : ({ isAnswered: true, text, usage } as const)
}

export const stage = (on: On): Stage => {
  const s: Stage = { selected: null, models: [], registered: [], commands: [], spawned: [], forks: [], toasts: [], answer: 'text', spawnDeny: null, refuse: null, settings: {}, settingsReads: 0, settingsDeny: null, hold: null }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.selection', () => ({ value: s.selected === null ? undefined : { text: s.selected } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('settings.read', () => {
    s.settingsReads++
    if (s.settingsDeny !== null) return { deny: s.settingsDeny }
    return { value: s.settings }
  })
  on('ui.toast', (_$, e) => {
    s.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => {
    s.commands.push({ name: e.name, description: e.description })
    return { value: { command: e.name } }
  })
  on('agent.register', (_$, e) => {
    if (s.refuse !== null) return { deny: s.refuse }
    s.registered.push({ name: e.name, model: e.model, tools: e.tools, description: e.description, prompt: e.prompt })
    return { value: { agent: `${PLUGIN}:${e.name}` } }
  })
  // A fresh id per spawn, so several subagents in one test never share one.
  // Beneath every plugin the spawn arrives as the Agent tool's input
  // (`subagent_type`); the typed `subagentType` is read too, whichever is set.
  on('agent.spawn', (_$, e) => {
    const raw = e as unknown as { subagentType?: string; subagent_type?: string }
    s.spawned.push({ subagentType: raw.subagent_type ?? raw.subagentType ?? '', prompt: e.prompt })
    if (s.spawnDeny !== null) return { deny: s.spawnDeny }
    return { model: 'sonnet', agentId: `agent-${s.spawned.length}` }
  })
  on('model.complete', async (_$, e) => {
    s.models.push({ model: e.model, system: e.system, prompt: e.prompt })
    if (s.hold !== null) await s.hold
    if (s.refuse !== null) return { deny: s.refuse }
    return { value: reply(s, `answer from ${e.model}`) }
  })
  on('model.fork', (_$, e) => {
    s.forks.push(e.prompt)
    if (s.refuse !== null) return { deny: s.refuse }
    return { value: reply(s, 'answer in context') }
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
