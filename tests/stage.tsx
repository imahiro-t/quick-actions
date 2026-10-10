import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ActionDef, ActionSpec } from '../hooks/actions'

// Stands for the engine beneath the plugin in every test: records what the
// plugin asks of the models and the agents and answers it.
//
// It also answers $.store from memory, empty unless the test hands stage()
// what it holds at the start: the hint line and every run read and write the
// usage scores there, so no test may leave $.store unanswered. The store is
// stage's own (`stored`) rather than mock.store's: a test's $ carries no
// $.store to read back what the plugin wrote, and the kit takes one hook per
// event, so mock.store's could not be watched. Values go in and out as JSON
// text, as the engine keeps them.

export const PLUGIN = 'quick-actions'

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
    title: 'Quick Actions',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** The ⋯ dialog's pane, as the plugin opens it. */
export const PICKER = `${PLUGIN}-picker`

/** The keys of the dialog's list and its close button: never an action's ID. */
export const PICKER_SELECT = '_picker'
export const PICKER_CLOSE = '_picker-close'

export const PICKER_PANE = {
  ...PANE,
  requestId: PICKER,
  props: { ...PANE.props, title: PICKER, isFocused: true },
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
  // Set to hold every model call (complete and fork) and every subagent
  // registration until it settles: the pane shows it running meanwhile.
  hold: Promise<void> | null
  // Every pane the plugin opened (as $.ui.open was asked) and closed (by id), in order.
  opened: { id: string; title?: string; focus?: true; closeOnEscape?: true; columns?: number }[]
  closed: string[]
  // What $.store holds, by key: the test's entries, then what the plugin wrote.
  stored: Record<string, unknown>
}

const reply = (s: Stage, text: string) => {
  return s.answer === 'empty'
    ? ({ isAnswered: false, reason: 'empty-reply', usage } as const)
    : ({ isAnswered: true, text, usage } as const)
}

/** What stage() starts the mocked $.store with: its entries, as `{ usage: { … } }`. */
export type StageOptions = { store?: Readonly<Record<string, unknown>> }

export const stage = (on: On, options: StageOptions = {}): Stage => {
  const s: Stage = { selected: null, models: [], registered: [], commands: [], spawned: [], forks: [], toasts: [], answer: 'text', spawnDeny: null, refuse: null, settings: {}, settingsReads: 0, settingsDeny: null, hold: null, opened: [], closed: [], stored: { ...options.store } }
  const json = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
  on('store.get', (_$, e) => ({ value: json(s.stored[e.key]) }))
  on('store.set', (_$, e) => {
    s.stored[e.key] = json(e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete s.stored[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(s.stored) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.selection', () => ({ value: s.selected === null ? undefined : { text: s.selected } }))
  on('ui.open', (_$, e) => {
    s.opened.push({ id: e.id, title: e.title, focus: e.focus, closeOnEscape: e.closeOnEscape, columns: e.columns })
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    s.closed.push(e.id)
    return { value: undefined }
  })
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
  on('agent.register', async (_$, e) => {
    if (s.hold !== null) await s.hold
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
  on('model.fork', async (_$, e) => {
    s.forks.push(e.prompt)
    if (s.hold !== null) await s.hold
    if (s.refuse !== null) return { deny: s.refuse }
    return { value: reply(s, 'answer in context') }
  })
  return s
}

/** The usage scores $.store holds now. */
export const storedUsage = (s: Stage) => s.stored['usage'] as Record<string, { score: number; at: number }> | undefined

export const start = ($: Engine) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

// `/quick-actions <args>` typed at the prompt of a fullscreen terminal.
export const runCommand = ($: Engine, args: string) =>
  $.command.run({
    command: PLUGIN,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

/** The mocked clock a test advances (mock.clock), as far as reselect needs it. */
export type Clock = { advance: (ms: number) => Promise<unknown> }

// A press puts the icons away for that selection, so a test that presses
// again first clears the selection and makes it anew, as the person would.
export async function reselect(s: Stage, clock: Clock) {
  const text = s.selected
  s.selected = null
  await clock.advance(400)
  s.selected = text
  await clock.advance(400)
}

/** A definition's prompt; undefined for a local action, which has none, or for no definition. */
export const promptOf = (def: ActionDef | ActionSpec | undefined): string | undefined =>
  def === undefined || def.kind === 'local' ? undefined : def.prompt
