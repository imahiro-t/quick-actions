import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ActionDef, ActionSpec } from '../hooks/actions'
import type { Messages } from '../hooks/i18n'
import { fixedRows } from '../hooks/picker-rows'
import type { FilterRow } from '../hooks/picker-rows'

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

/** A viewport wide enough for every action of a kind on the hint line. */
export const EVERY_ACTION_FITS = { columns: 10_000, rows: 40, isFullscreen: false } as const

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

// Transcript rows, by the requestId $.ui.selection() names (a tool call's
// row and its result block share the call's tool_use_id).
export const USER_ROW = {
  plugin: PLUGIN,
  component: 'UserMessage',
  requestId: 'msg-user-1',
  props: { text: 'why does it exit 137?', origin: { kind: 'composer' }, isExpanded: true },
} as const

export const ASSISTANT_ROW = {
  plugin: PLUGIN,
  component: 'AssistantMessage',
  requestId: 'msg-assistant-1',
  props: { text: 'The process was **killed**: exit 137 is SIGKILL, often the OOM killer.', isFirstOfReply: true },
} as const

export const OTHER_ASSISTANT_ROW = {
  ...ASSISTANT_ROW,
  requestId: 'msg-assistant-2',
  props: { text: 'Raise the memory limit, or find what grows.', isFirstOfReply: true },
} as const

export const TOOL_USE_ROW = {
  plugin: PLUGIN,
  component: 'ToolUse',
  requestId: 'toolu_1',
  props: { tool_use_id: 'toolu_1', tool: 'Bash', input: { command: 'dmesg | tail' }, isRunning: false, isErrored: false, isInterrupted: false },
} as const

export const TOOL_RESULT_ROW = {
  plugin: PLUGIN,
  component: 'ToolResult',
  requestId: 'toolu_1',
  props: { tool_use_id: 'toolu_1', tool: 'Bash', output: { stdout: 'Out of memory: Killed process 4242', stderr: '', interrupted: false }, isErrored: false },
} as const

// The other transcript rows a selection can lie in. A folded group of tool
// calls has an id of its own and names each call's; the progress row under a
// running call names that call.
export const TOOL_GROUP_ROW = {
  plugin: PLUGIN,
  component: 'ToolGroup',
  requestId: 'group-1',
  props: {
    calls: [
      { tool_use_id: 'toolu_g1', tool: 'Read', input: { file_path: '/repo/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false },
      { tool_use_id: 'toolu_g2', tool: 'Grep', input: { pattern: 'exit' }, isRunning: false, isErrored: false, isInterrupted: false },
    ],
    isActive: false,
    isExpanded: false,
  },
} as const

export const TOOL_PROGRESS_ROW = {
  plugin: PLUGIN,
  component: 'ToolProgress',
  requestId: 'progress-1',
  props: { tool_use_id: 'toolu_1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
} as const

export const INFO_NOTICE_ROW = {
  plugin: PLUGIN,
  component: 'InfoNotice',
  requestId: 'notice-1',
  props: { text: 'Using the model from your settings', command: '/model' },
} as const

export const TURN_DURATION_ROW = {
  plugin: PLUGIN,
  component: 'TurnDuration',
  requestId: 'turn-1',
  props: { word: 'Baked', durationMs: 3000 },
} as const

// The question dialog: only its props are used (rowIdsOf); the kit cannot
// draw it, which must hold the engine's own dialog, and nothing beneath the
// plugin here can be that.
export const ASK_ROW = {
  plugin: PLUGIN,
  component: 'AskUserQuestion',
  requestId: 'toolu_ask',
  props: { tool: 'AskUserQuestion', questions: [{ question: 'Which one?', header: 'Pick', options: [], multiSelect: false }] as unknown[] },
} as const

/** The ⋯ dialog's pane, as the plugin opens it. */
export const PICKER = `${PLUGIN}-picker`

/** The key of the dialog's close button: never an action's ID. */
export const PICKER_CLOSE = '_picker-close'
/** The Box the dialog's list is drawn in is keyed by this and how many it lists. */
export const PICKER_LIST = '_picker-list-'
/** Each row of the list is a Box (kept whole: flexShrink 0) keyed by this and its action's ID, its Button inside. */
export const PICKER_ROW = '_picker-row-'
/** The dialog's filter field and the button that empties it. */
export const PICKER_FILTER = '_filter'
export const PICKER_FILTER_CLEAR = '_filter-clear'
/** The dialog's kind buttons above its list are keyed by this and the kind. */
export const PICKER_KIND = '_picker-kind-'

/** What the helpers below need of a mounted ⋯ dialog. */
type PickerView = {
  findAll: (query: { type?: string; key?: string }) => Promise<{ key: string | undefined; props: Record<string, unknown>; children: unknown[] }[]>
  find: (query: { type?: string; key?: string }) => Promise<{ key: string | undefined } | undefined>
  press: (target: { key: string }) => Promise<unknown>
  // Absent where the surface draws no Input (mobile).
  input?: (target: { key: string; text: string; kind?: 'change' | 'submit' }) => Promise<unknown>
}

/** The key a child of a drawn element carries, as a description or as a tree node. */
const keyOf = (child: unknown): string | undefined => {
  if (typeof child !== 'object' || child === null) return undefined
  const c = child as { key?: unknown; props?: { key?: unknown } }
  const key = c.key ?? c.props?.key
  return typeof key === 'string' ? key : undefined
}

/** The Box the ⋯ dialog's list is drawn in, or undefined when it lists none. */
export const listBox = async (picker: PickerView) =>
  (await picker.findAll({ type: 'Box' })).find(b => String(b.key).startsWith(PICKER_LIST))

/** The ⋯ dialog's list rows (each a Box round its Button), in the order drawn; none when it lists none. */
export const listRows = async (picker: PickerView) =>
  (await listBox(picker)) === undefined ? [] : (await picker.findAll({ type: 'Box' })).filter(b => String(b.key).startsWith(PICKER_ROW))

/** The list's buttons as drawn: each row's one child. */
const listButtons = async (picker: PickerView) => (await listRows(picker)).flatMap(row => row.children)

/** The IDs of the actions the ⋯ dialog lists (its list's buttons' keys), in the order drawn. */
export const listedActions = async (picker: PickerView): Promise<string[]> => (await listButtons(picker)).flatMap(c => keyOf(c) ?? [])

/** The ⋯ dialog's list as `{ value: ID, label: what its button says }`, in the order drawn. */
export const listedOptions = async (picker: PickerView): Promise<{ value: string; label: string }[]> =>
  (await listButtons(picker)).flatMap(c => {
    const value = keyOf(c)
    const label = (c as { props?: { label?: unknown } }).props?.label
    return value === undefined ? [] : [{ value, label: String(label) }]
  })

/** How many actions the ⋯ dialog lists, as the key of the Box it lists them in says; undefined when it lists none. */
export const listedCount = async (picker: PickerView) => {
  const box = await listBox(picker)
  return box === undefined ? undefined : Number(String(box.key).slice(PICKER_LIST.length))
}

/**
 * Picks the action `id` in the ⋯ dialog, as a press on its button. Listed: its
 * button is pressed. Not listed and the filter field drawn: `id` is typed in
 * it (an edit, not Enter), then the button keyed `id` is pressed, whatever
 * else the filter leaves. The filter is left as typed. Not reached either way
 * (no field: every action is listed): the test fails here, never silently.
 */
export async function pickAction(picker: PickerView, id: string) {
  if ((await listedActions(picker)).includes(id)) return picker.press({ key: id })
  if (picker.input === undefined || (await picker.find({ key: PICKER_FILTER })) === undefined) {
    throw new Error(`pickAction: "${id}" is not listed and there is no filter field; listed: ${(await listedActions(picker)).join(', ')}`)
  }
  await picker.input({ key: PICKER_FILTER, text: id, kind: 'change' })
  const listed = await listedActions(picker)
  if (!listed.includes(id)) throw new Error(`pickAction: "${id}" is not listed after filtering by it; listed: ${listed.join(', ')}`)
  return picker.press({ key: id })
}

/**
 * The ⋯ dialog's kind buttons as drawn, in order: each one's kind, its
 * accessible name (the label), the text it draws, whether it stands out (its drawing a bold
 * Text), whether it is drawn dim (dimColor, or a Text in `muted` when a
 * palette is given) and the colour of the Text it draws, if any.
 */
export async function pickerKindButtons(picker: PickerView, muted?: string) {
  const buttons = (await picker.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith(PICKER_KIND))
  return buttons.map(b => {
    const text = b.children.find(c => typeof c === 'object' && c !== null && (c as { type?: unknown }).type === 'Text') as { props?: Record<string, unknown> } | undefined
    const color = text?.props?.['color']
    const drawnOf = (c: unknown): string =>
      typeof c === 'string' ? c : typeof c === 'object' && c !== null ? ((c as { children?: unknown[] }).children ?? []).map(drawnOf).join('') : ''
    return {
      kind: String(b.key).slice(PICKER_KIND.length) as HintKindName | 'all',
      label: String(b.props['label']),
      drawn: b.children.map(drawnOf).join(''),
      bold: text?.props?.['bold'] === true,
      dim: b.props['dimColor'] === true || (muted !== undefined && color === muted),
      color: typeof color === 'string' ? color : undefined,
      dimColor: b.props['dimColor'] === true,
    }
  })
}

/** Lists the actions of `kind` alone in the ⋯ dialog (or, pressed again, every kind), as a press on its kind button does. */
export const showPickerKind = (picker: PickerView, kind: HintKindName | 'all') => picker.press({ key: `${PICKER_KIND}${kind}` })

export const PICKER_PANE = {
  ...PANE,
  requestId: PICKER,
  props: { ...PANE.props, title: PICKER, isFocused: true },
} as const

/** The ⋯ dialog's argument screen: its field and the button back to the list. */
export const PICKER_ARG = '_arg'
export const PICKER_ARG_BACK = '_arg-back'

/**
 * Enter in the ⋯ dialog's argument screen with `text` (empty: the action's
 * default), as after a press on the hint line or a pick of an action that
 * takes an argument, where an Input is drawn.
 */
export async function submitArg($: Engine, text = '', surface: 'terminal' | 'desktop' = 'terminal') {
  const picker = await $.ui.mount({ ...PICKER_PANE, surface })
  await picker.input({ key: PICKER_ARG, text })
  await picker.unmount()
}

export const SURFACES = ['terminal', 'desktop'] as const

/** The test options that pin the display and answer language. */
export const JA = { language: 'ja' } as const
export const EN = { language: 'en' } as const

/** Any Japanese character (kana, kanji, full-width punctuation and brackets): none may show in English. */
export const JAPANESE = /[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/

export type Stage = {
  selected: string | null
  // The transcript row the selection lies in, as $.ui.selection() names it
  // (UiSelection.requestId); null, as by default: none named (a selection
  // over several rows, in a pane or the prompt), which every test before the
  // "Go to selection" button assumed.
  selectedRow: string | null
  models: { model: string; system?: string; prompt: string }[]
  registered: { name: string; model?: string; tools?: readonly string[]; description: string; prompt: string; omitClaudeMd?: true }[]
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
  // The pane that holds the keys (null: the prompt does), as the engine
  // keeps it (focusedId): a pane opened anew shows only while none does
  // (otherwise the one holding them stays shown); a close of it hands them
  // back to the prompt. A test sets it to stand for the person giving a tab
  // the keys (a click on it); /quick-actions gives the dialog's tab them.
  focused: string | null
  // The pane that asked for the keys (focus) and has not had them yet
  // (focusRequest): it gets them, from the prompt alone, once it is shown;
  // asking does not show it.
  focusRequest: string | null
  // Whether an open of a pane already open shows it (true), or only retitles
  // it, leaving it behind the shown one (false), the two ways a host may go.
  reopenShows: boolean
  // What $.store holds, by key: the test's entries, then what the plugin wrote.
  stored: Record<string, unknown>
  // How many times the engine drew each site beneath the plugin, by
  // `<component>:<requestId>`: a transcript row drawn again asks the engine's
  // drawing again.
  drawn: Record<string, number>
}

const reply = (s: Stage, text: string) => {
  return s.answer === 'empty'
    ? ({ isAnswered: false, reason: 'empty-reply', usage } as const)
    : ({ isAnswered: true, text, usage } as const)
}

/** What stage() starts the mocked $.store with: its entries, as `{ usage: { … } }`. */
export type StageOptions = { store?: Readonly<Record<string, unknown>> }

export const stage = (on: On, options: StageOptions = {}): Stage => {
  const s: Stage = { selected: null, selectedRow: null, models: [], registered: [], commands: [], spawned: [], forks: [], toasts: [], answer: 'text', spawnDeny: null, refuse: null, settings: {}, settingsReads: 0, settingsDeny: null, hold: null, opened: [], closed: [], rows: {}, panes: [], shown: null, focused: null, focusRequest: null, reopenShows: true, stored: { ...options.store }, drawn: {} }
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
    const site = `${e.component}:${e.requestId}`
    s.drawn[site] = (s.drawn[site] ?? 0) + 1
    // The question dialog is the engine's own drawing (one engine node, which
    // a plugin's tree must hold exactly once); the rest a Box standing for it.
    if (e.component === 'AskUserQuestion') return { type: 'engine', ref: 0 } as const
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.selection', () => ({
    value: s.selected === null ? undefined : { text: s.selected, ...(s.selectedRow === null ? {} : { requestId: s.selectedRow }) },
  }))
  on('ui.open', (_$, e) => {
    s.opened.push({ id: e.id, title: e.title, focus: e.focus, closeOnEscape: e.closeOnEscape, columns: e.columns })
    s.rows[e.id] = e.rows
    const isNew = !s.panes.includes(e.id)
    if (isNew) {
      s.panes.push(e.id)
      s.shown = s.focused ?? e.id
    } else if (s.reopenShows) s.shown = e.id
    if (e.focus === true) s.focusRequest = e.id
    if (s.focusRequest !== null && s.focusRequest === s.shown) {
      if (s.focused === null) s.focused = s.focusRequest
      s.focusRequest = null
    }
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    s.closed.push(e.id)
    s.panes = s.panes.filter(id => id !== e.id)
    if (s.focused === e.id) s.focused = null
    if (s.focusRequest === e.id) s.focusRequest = null
    if (s.shown === e.id) s.shown = s.panes.at(-1) ?? null
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: s.panes.map(id => ({ id, title: id, isShown: id === s.shown, isFocused: id === s.focused, isPlaced: true })),
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
    s.registered.push({ name: e.name, model: e.model, tools: e.tools, description: e.description, prompt: e.prompt, ...(e.omitClaudeMd === undefined ? {} : { omitClaudeMd: e.omitClaudeMd }) })
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

/**
 * The ⋯ dialog's filter row and close button as drawn in the language of `t`,
 * the field holding `value` (Clear beside it once it does) and some action
 * left to run (SELM-00070).
 */
export const pickerDialogRows = (t: Messages, value = ''): { filterRow: FilterRow; close: string } => ({
  filterRow: { placeholder: t.pickerFilterPlaceholder, value, submitLabel: t.pickerFilterSubmit, ...(value !== '' && { clear: t.pickerFilterClear }) },
  close: t.pickerClose,
})

/** The rows those take at `columns` (see pickerDialogRows). */
export const pickerFixedRows = (t: Messages, columns: number, value = '') => fixedRows(columns, pickerDialogRows(t, value))

/** The ⋯ dialog's page buttons, back and on. */
export const PICKER_PREV = '_picker-prev'
export const PICKER_NEXT = '_picker-next'

/** The text the ⋯ dialog draws between its page buttons: the page shown of how many, and the count listed in all. */
export const pageText = (t: Messages, page: number, pages: number, count: number) => ` ${t.pickerPage(page, pages, count)} `

/**
 * The page the ⋯ dialog's texts say is shown, of how many, for `count`
 * actions listed in all: `[page, pages]`, read from the one text drawn
 * between the page buttons; undefined when `texts` is not that one text.
 */
export function pageShown(texts: readonly string[], t: Messages, count: number): [number, number] | undefined {
  if (texts.length !== 1) return undefined
  const m = /(\d+) \/ (\d+)/.exec(texts[0] ?? '')
  if (m === null) return undefined
  const [page, pages] = [Number(m[1]), Number(m[2])]
  return texts[0] === pageText(t, page, pages, count) ? [page, pages] : undefined
}
