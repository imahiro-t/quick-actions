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

// The complete actions on the selection whose prompt carries no answer style
// (no STYLE): they return a translation or a converted text, not an
// explanation. Shared by the tests of the definitions and of the languages.
export const NO_STYLE: readonly string[] = [
  'translate-ja', 'translate-en',
  // The translation or the rewrite alone.
  'translate-zh', 'translate-zh-tw', 'translate-ko', 'translate-es', 'translate-fr', 'translate-de',
  'translate-pt', 'translate-vi', 'easy-japanese',
  // The converted text, with a short note in the answer language.
  'furigana', 'to-diagram',
  // The rewrite or the draft, in the language of the selection, with a short note in the answer language.
  'keigo', 'casual-tone', 'make-concise', 'rewrite-clear', 'paraphrase', 'draft-reply',
  // The converted code, with a short note in the answer language.
  'pseudocode', 'port-code', 'docstring',
  // The converted data (a table, YAML, JSON, types, a schema), with a short note in the answer language.
  'to-table', 'json-to-yaml', 'yaml-to-json', 'json-to-types', 'infer-schema',
]

// Those of NO_STYLE that name the answer language (ANSWER_LANGUAGE) for their short note.
export const ANSWER_LANGUAGE_ONLY: readonly string[] = [
  'furigana', 'to-diagram',
  'keigo', 'casual-tone', 'make-concise', 'rewrite-clear', 'paraphrase', 'draft-reply',
  'pseudocode', 'port-code', 'docstring',
  'to-table', 'json-to-yaml', 'yaml-to-json', 'json-to-types', 'infer-schema',
]

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
/** The dialog's filter field and the button that empties it. */
export const PICKER_FILTER = '_filter'
export const PICKER_FILTER_CLEAR = '_filter-clear'

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
  // The rows the last open of each pane asked for, by id (undefined: none asked).
  rows: Record<string, number | undefined>
  // The panes open now, in open order, and the one shown, as $.ui.panes() answers them.
  panes: string[]
  shown: string | null
  // Whether an open of a pane already open shows it (true), or only retitles
  // it, leaving it behind the shown one (false), the two ways a host may go.
  reopenShows: boolean
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
  const s: Stage = { selected: null, models: [], registered: [], commands: [], spawned: [], forks: [], toasts: [], answer: 'text', spawnDeny: null, refuse: null, settings: {}, settingsReads: 0, settingsDeny: null, hold: null, opened: [], closed: [], rows: {}, panes: [], shown: null, reopenShows: true, stored: { ...options.store } }
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
    // The question dialog is the engine's own drawing (one engine node, which
    // a plugin's tree must hold exactly once); the rest a Box standing for it.
    if (e.component === 'AskUserQuestion') return { type: 'engine', ref: 0 } as const
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.selection', () => ({ value: s.selected === null ? undefined : { text: s.selected } }))
  on('ui.open', (_$, e) => {
    s.opened.push({ id: e.id, title: e.title, focus: e.focus, closeOnEscape: e.closeOnEscape, columns: e.columns })
    s.rows[e.id] = e.rows
    const isNew = !s.panes.includes(e.id)
    if (isNew) s.panes.push(e.id)
    if (isNew || s.reopenShows) s.shown = e.id
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    s.closed.push(e.id)
    s.panes = s.panes.filter(id => id !== e.id)
    if (s.shown === e.id) s.shown = s.panes.at(-1) ?? null
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: s.panes.map(id => ({ id, title: id, isShown: id === s.shown, isFocused: false, isPlaced: true })),
  }))
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

/** The hint line's kind buttons are keyed by this and the kind: never an action's ID. */
export const KIND_KEY = '_kind-'

export type HintKindName = 'selection' | 'context' | 'standalone'

/** What the helpers below need of a mounted hint line. */
type Band = {
  findAll: (query: { type?: string }) => Promise<{ key: string | undefined; props: Record<string, unknown>; text: string }[]>
  press: (target: { key: string }) => Promise<unknown>
}

/** The labels of the hint line's buttons, the kind buttons left out: its icons, ✕ and ⋯. */
export const hintIcons = async (band: Band) =>
  (await band.findAll({ type: 'Button' })).filter(b => !String(b.key).startsWith(KIND_KEY)).map(b => b.props.label)

/** The hint line's kind buttons by their keys' kind, in the order drawn. */
export const hintKinds = async (band: Band) =>
  (await band.findAll({ type: 'Button' })).flatMap(b => (String(b.key).startsWith(KIND_KEY) ? [String(b.key).slice(KIND_KEY.length)] : []))

/** Switches the hint line to the actions of `kind`, as a press on its kind button does. */
export const showKind = (band: Band, kind: HintKindName) => band.press({ key: `${KIND_KEY}${kind}` })

/**
 * The hint line's kind buttons as drawn: each one's kind, its accessible name
 * (the label, which a desktop's native button and assistive tech read) and
 * what it draws (its mark, the name inside it unless the line is narrow).
 */
export const kindButtons = async (band: Band) =>
  (await band.findAll({ type: 'Button' })).flatMap(b =>
    String(b.key).startsWith(KIND_KEY) ? [{ kind: String(b.key).slice(KIND_KEY.length), label: String(b.props.label), drawn: b.text }] : [],
  )
