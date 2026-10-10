import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Result } from '../types'
import {
  ACTIONS,
  DEFAULT_ACTION_IDS,
  NO_INPUT,
  PLUGIN,
  READ_ONLY_TOOLS,
  TICKER_LIMIT,
  findAction,
  isContext,
  isStandalone,
  markedIcon,
  messageOf,
  needsSelection,
  resolveAll,
  subagentType,
  wrap,
  wrapInput,
} from './actions'
import type { ActionDef, ActionSpec, LocalAction, ResolvedSubagentAction } from './actions'
import { formatClock, parseArg, splitCommandArgs, utcLabel } from './args'
import type { ArgValue } from './args'
import { parseCustomActions, problemFor, problemLine, reasonText, withProblems } from './custom'
import { filterActions } from './filter'
import { MESSAGES, answerStyle, explicitLanguage, resolveLanguage } from './i18n'
import type { Lang } from './i18n'
import { localInputFor, runLocal, tickerStep } from './local'
import type { Frame } from './local'
import { USAGE_KEY, arrange, defaultsLead, orderActions, parseHintCount, parsePins, parseUsage, recordUse, settleIn } from './order'
import type { OrderSlot } from './order'
import { paneStyle, parsePaneTheme } from './palette'
import type { PaneStyle } from './palette'
import { random, randomBytes } from './random'
import { settleQuietly, toLatest } from './scroll'

// Everything below is driven by the definitions in ./actions and the person's
// own from the `customActions` setting (./custom): no action is named here, so
// adding one needs no change in this file. Every string the person reads comes
// from MESSAGES or the definitions resolved for the language (defsFor), never
// from a literal here.

const PANE = PLUGIN
const PANE_TITLE = 'Quick Actions'
const PANE_COLUMNS = 56
const COMMAND = PLUGIN
// `/quick-actions hint`: the hint line without a selection. Reserved, so no
// custom action can take it as its ID.
const HINT_ARG = 'hint'
const POLL_MS = 300
const KEEP = 20
// The ⋯ dialog: a pane of its own beside the results. The keys of what it
// adds (⋯ on the hint line, the dialog's list and close button) start with
// `_`, which no action's ID can (those are lowercase letters, digits and
// hyphens), so no custom action's element ever shares one.
const PICKER = `${PLUGIN}-picker`
const MORE_KEY = '_more'
const PICKER_SELECT_KEY = '_picker'
const PICKER_CLOSE_KEY = '_picker-close'
// The dialog's filter field, and the button beside it that empties it.
const PICKER_FILTER_KEY = '_filter'
const PICKER_FILTER_CLEAR_KEY = '_filter-clear'
// The most candidates an unknown ID is answered with.
const CANDIDATES = 10
// The ⋯ dialog's rows at most: past them, the pane scrolls.
const PICKER_MAX_ROWS = 30
// The stop button of a run over time in the result pane, one per entry.
const stopKey = (id: number) => `_stop-${id}`

// The colours of the result pane and the ⋯ dialog (the `paneTheme` setting)
// are worked out in ./palette, why they are as they are included. These two
// add no prop at all where the style leaves it to core (auto, inline), so
// those draw exactly as they always have.

/** The Box props that paint the style's background: none when it has none. */
const painted = (style: PaneStyle) => (style.background === undefined ? {} : { backgroundColor: style.background })

/** The Text props of a secondary text: the palette's muted colour, or dimColor as before. */
const muted = (style: PaneStyle) => (style.muted === undefined ? { dimColor: true } : { color: style.muted })

// The engine reads these references statically before the module runs, so
// `plugin` has to be the string literal itself: PLUGIN cannot stand in here.
// types/index.d.ts types these keys under the same name, so a drift fails tsc.
const selection = atom({ plugin: 'quick-actions', key: 'selection' } as const, null)
const dismissed = atom({ plugin: 'quick-actions', key: 'dismissed' } as const, null)
const results = atom({ plugin: 'quick-actions', key: 'results' } as const, [])
const picking = atom({ plugin: 'quick-actions', key: 'picking' } as const, null)
const hint = atom({ plugin: 'quick-actions', key: 'hint' } as const, null)

const quoteOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}

// The language: settled in register when the setting names one; for `auto`,
// by the first hook that needs it, whichever event comes first, and once only.
// A reload loads the module afresh, and register sets these again.
// Hooks read settledLanguage only through ensureLanguage, and pass the Lang it
// returns down as an argument (`lang` below is always that settled value).
let languageSetting: unknown
let settledLanguage: Lang | undefined
let pendingLanguage: Promise<Lang> | undefined

async function readQuietly<T>(pending: Promise<T>): Promise<T | undefined> {
  try {
    return await pending
  } catch {
    return undefined
  }
}

/**
 * resolveLanguage over what the engine answers: Claude Code's settings and the
 * locale, each read on its own, a failed read counting as unset. Never rejects.
 */
async function detectLanguage($: EngineInterface): Promise<Lang> {
  const [settings, LC_ALL, LC_MESSAGES, LANG] = await Promise.all([
    readQuietly($.settings.read()),
    readQuietly($.env.get('LC_ALL')),
    readQuietly($.env.get('LC_MESSAGES')),
    readQuietly($.env.get('LANG')),
  ])
  return resolveLanguage(languageSetting, { claudeLanguage: settings?.['language'], LC_ALL, LC_MESSAGES, LANG })
}

/** The language every hook draws and asks in: detected once, shared by concurrent callers. */
async function ensureLanguage($: EngineInterface): Promise<Lang> {
  if (settledLanguage !== undefined) return settledLanguage
  pendingLanguage ??= detectLanguage($).then(l => (settledLanguage = l))
  return pendingLanguage
}

let nextId = 1
const registeredAgents = new Set<string>()
const pendingAgents = new Map<string, number>()

async function settle($: EngineInterface, id: number, ok: boolean, text: string) {
  const status: Result['status'] = ok ? 'done' : 'failed'
  await update($, results, list => list.map(r => (r.id === id ? { ...r, status, text } : r)))
}

async function ensureAgent($: EngineInterface, def: ResolvedSubagentAction) {
  if (registeredAgents.has(def.id)) return
  await $.agent.register({
    name: def.id,
    description: def.description,
    prompt: def.prompt,
    tools: [...(def.tools ?? READ_ONLY_TOOLS)],
    model: def.model,
  })
  registeredAgents.add(def.id)
}

// A subagent answers later, through turn.complete; the others answer here.
// `prompt` is its task with what it works on (the selection, or a standalone
// action's argument, or nothing more).
async function startSubagent($: EngineInterface, def: ResolvedSubagentAction, lang: Lang, id: number, prompt: string) {
  const t = MESSAGES[lang]
  try {
    await ensureAgent($, def)
    const spawned = await $.agent.spawn({
      subagentType: subagentType(def),
      description: def.label,
      prompt,
    })
    if (spawned.deny !== undefined || spawned.agentId === undefined) {
      await settle($, id, false, t.couldNotStart(spawned.deny ?? 'no agent id'))
      return
    }
    pendingAgents.set(spawned.agentId, id)
  } catch (err) {
    await settle($, id, false, t.couldNotStart(messageOf(err)))
  }
}

// The usage scores (./order) are read, added to and written back one use at a
// time, so two runs close together never lose one. A failure (the store
// refused, over its 4 MiB) loses that use alone: the action runs regardless.
let usageWrite: Promise<void> = Promise.resolve()

/** Adds one use of `id` to its score in `$.store`. Never rejects; the returned promise settles once it is written. */
function recordUsage($: EngineInterface, id: string): Promise<void> {
  usageWrite = usageWrite.then(async () => {
    try {
      const now = await $.clock.now()
      const usage = parseUsage(await $.store.get(USAGE_KEY))
      await $.store.set(USAGE_KEY, recordUse(usage, id, now))
    } catch {
      // This use goes unrecorded; see above.
    }
  })
  return usageWrite
}

// The local offset and the time zone's label, read here alone: a local
// action's compute is handed them (see LocalInput), never the globals.
const utcOffsetMinutes = (ms: number) => -new Date(ms).getTimezoneOffset()

/** The time zone's name, or `UTC+09:00` when Intl cannot tell (or there is no Intl). */
function timeZoneLabel(now: number): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof zone === 'string' && zone !== '') return zone
  } catch {
    // No Intl here: the offset stands in.
  }
  return utcLabel(utcOffsetMinutes(now))
}

// The runs over time going on now, by their entry's ID: how to stop the
// period, when it started, and the text last shown. A reload ends every one
// of them (see register) and starts with none: an entry left running is then
// drawn as stopped (see the pane).
type Ticker = { cancel: () => void; startedAt: number; lastText: string | undefined }
const tickers = new Map<number, Ticker>()

/** Ends the run of entry `id`, if one goes on: its period cancelled, out of the map. Whether there was one. */
function endTicker(id: number): boolean {
  const ticker = tickers.get(id)
  if (ticker === undefined) return false
  tickers.delete(id)
  ticker.cancel()
  return true
}

/**
 * Stops the run of entry `id` (its stop button, the pane closing): the entry
 * is done, saying how long it ran. No toast: the person stopped it.
 */
async function stopTicker($: EngineInterface, lang: Lang, id: number) {
  const ticker = tickers.get(id)
  if (ticker === undefined || !endTicker(id)) return
  await settleStopped($, lang, id, ticker.startedAt)
}

/** Settles entry `id`, whose run started at `startedAt` and was ended: done, saying how long it ran. */
async function settleStopped($: EngineInterface, lang: Lang, id: number, startedAt: number) {
  const now = (await readQuietly($.clock.now())) ?? startedAt
  await settle($, id, true, MESSAGES[lang].tickerStopped(formatClock(now - startedAt)))
}

/**
 * Writes the entry's text while it runs. Only while it runs: a write retried
 * after the entry settled (stopped, done) leaves the settled text as it is.
 */
async function showFrame($: EngineInterface, id: number, text: string) {
  await update($, results, list =>
    list.map(r => (r.id === id && r.status === 'running' ? { ...r, ticker: true as const, text } : r)),
  )
}

/** Tells the person a run is done; a toast that fails is let go. */
function finishedToast($: EngineInterface, text: string) {
  void Promise.resolve()
    .then(() => $.ui.toast(text))
    .catch(() => {
      // The pane says it is done.
    })
}

/** One period of the run of entry `id`: what tickerStep says, done through `$`. */
async function tick($: EngineInterface, lang: Lang, id: number, label: string, frame: Frame) {
  const ticker = tickers.get(id)
  if (ticker === undefined) return
  const now = await readQuietly($.clock.now())
  // Stopped meanwhile, or no time to show it at.
  if (now === undefined || tickers.get(id) !== ticker) return
  await applyStep($, lang, id, label, ticker, tickerStep(frame, { startedAt: ticker.startedAt, now, lastText: ticker.lastText, lang }), now)
}

async function applyStep(
  $: EngineInterface,
  lang: Lang,
  id: number,
  label: string,
  ticker: Ticker,
  step: ReturnType<typeof tickerStep>,
  now: number,
) {
  const t = MESSAGES[lang]
  switch (step.kind) {
    case 'same':
      return
    case 'show':
      ticker.lastText = step.text
      await showFrame($, id, step.text)
      return
    case 'done':
      endTicker(id)
      await settle($, id, true, step.text)
      finishedToast($, step.toast ?? t.tickerFinishedToast(label))
      return
    case 'limit':
      endTicker(id)
      await settle($, id, true, t.tickerStopped(formatClock(now - ticker.startedAt)))
      return
    case 'failed':
      endTicker(id)
      await settle($, id, false, t.failed(step.reason))
  }
}

/** Starts a run over time on entry `id`: its first frame now, then one every `intervalMs`. */
async function startTicker($: EngineInterface, lang: Lang, id: number, label: string, now: number, run: { intervalMs: number; frame: Frame }) {
  const t = MESSAGES[lang]
  if (tickers.size >= TICKER_LIMIT) {
    await settle($, id, false, t.tickerLimit(TICKER_LIMIT))
    return
  }
  const ticker: Ticker = { cancel: () => {}, startedAt: now, lastText: undefined }
  tickers.set(id, ticker)
  try {
    const period = $.clock.every(run.intervalMs, () => {
      void tick($, lang, id, label, run.frame)
    })
    ticker.cancel = () => period.cancel()
    // Stopped before the period was set (the pane closed meanwhile): stop it too.
    if (tickers.get(id) !== ticker) period.cancel()
  } catch (err) {
    endTicker(id)
    await settle($, id, false, t.failed(messageOf(err)))
    return
  }
  await applyStep($, lang, id, label, ticker, tickerStep(run.frame, { startedAt: now, now, lastText: undefined, lang }), now)
}

/**
 * A local action on entry `id`: its compute on the text (an action on the
 * selection) or the argument (a standalone one), what comes of it decided by
 * runLocal. Only the time, the zone, the offset and the randomness are read here.
 */
async function runLocalAction($: EngineInterface, def: LocalAction, lang: Lang, id: number, src: { text?: string; arg?: ArgValue }) {
  const t = MESSAGES[lang]
  let now: number
  try {
    now = await $.clock.now()
  } catch (err) {
    await settle($, id, false, t.failed(messageOf(err)))
    return
  }
  const input = localInputFor(def, { ...src, now, timeZone: timeZoneLabel(now), lang, utcOffsetMinutes, random, randomBytes })
  const outcome = runLocal(def, input, { selection: needsSelection(def), lang })
  if (outcome.kind === 'settle') {
    await settle($, id, outcome.ok, outcome.text)
    return
  }
  await startTicker($, lang, id, def.label, now, outcome)
}

/** What a new entry says it ran on. */
type EntryHead = Pick<Result, 'target' | 'quote' | 'arg'>

/**
 * What every run does first, whatever it runs on: one more use of the action,
 * the hint line `/quick-actions hint` opened closed, a new entry (running) at
 * the top of the pane, the pane open and brought back to its top. An entry
 * pushed out past KEEP stops its run over time, if it has one. The new entry's ID.
 */
async function begin($: EngineInterface, def: ActionDef, head: EntryHead): Promise<number> {
  // Not awaited: the score must not hold up the answer.
  void recordUsage($, def.id)
  await update($, hint, () => null)
  const id = nextId++
  const result: Result = { id, action: def.id, ...head, status: 'running', text: '' }
  await update($, results, list => [result, ...list].slice(0, KEEP))
  if (tickers.size > 0) {
    const kept = new Set((await read($, results)).map(r => r.id))
    for (const running of [...tickers.keys()]) if (!kept.has(running)) endTicker(running)
  }
  await $.ui.open({ id: PANE, title: PANE_TITLE, columns: PANE_COLUMNS })
  // Back to the top, where this newest result is drawn (see ./scroll).
  await settleQuietly($.ui.scroll(toLatest(PANE)))
  return id
}

/** A model call on entry `id`, settled with its answer or why there is none. */
type ModelAnswer = { isAnswered: true; text: string } | { isAnswered: false; reason: string }
async function complete($: EngineInterface, lang: Lang, id: number, call: () => Promise<ModelAnswer>) {
  const t = MESSAGES[lang]
  try {
    const r = await call()
    await settle($, id, r.isAnswered, r.isAnswered ? r.text.trim() : t.noAnswer(r.reason))
  } catch (err) {
    // A thrown call must not leave the entry "running" for good.
    await settle($, id, false, t.failed(messageOf(err)))
  }
}

// Every way an action on the selection or the conversation runs (an icon, the
// ⋯ dialog, the command) comes here. `text` is the selected text a selection
// action runs on; a context action runs on the conversation and reads none.
// Any run closes the hint line that `/quick-actions hint` opened. A
// standalone action runs through runStandalone instead, which takes no text.
async function run($: EngineInterface, def: ActionDef, lang: Lang, text: string) {
  const context = isContext(def)
  const id = await begin($, def, context ? { target: 'context', quote: '' } : { target: 'selection', quote: quoteOf(text) })

  if (def.kind === 'local') {
    await runLocalAction($, def, lang, id, { text })
    return
  }
  if (def.kind === 'subagent') {
    await startSubagent($, def, lang, id, `${def.task}\n\n${wrap(text)}`)
    return
  }
  await complete($, lang, id, () =>
    def.kind === 'fork'
      ? $.model.fork({
          prompt: context ? `${def.prompt} ${answerStyle(lang)}` : `${wrap(text)}\n\n${def.prompt} ${answerStyle(lang)}`,
        })
      : $.model.complete({
          model: def.model,
          system: def.prompt,
          prompt: wrap(text),
          effort: 'low',
          maxTokens: def.maxTokens ?? 1500,
          timeoutMs: 60_000,
        }),
  )
}

/**
 * A standalone action: on neither the selection nor the conversation, so it
 * takes no text, only its argument. `given` is the one the command gave and
 * already parsed (`raw` as typed, `value` what it came to); with none, the
 * action's default is parsed here.
 */
async function runStandalone($: EngineInterface, def: ActionDef, lang: Lang, given?: { raw: string; value: ArgValue | undefined }) {
  const t = MESSAGES[lang]
  const id = await begin($, def, { target: 'none', quote: '', ...(given === undefined ? {} : { arg: quoteOf(given.raw) }) })

  let value: ArgValue | undefined = given?.value
  if (given === undefined && def.kind !== 'fork' && def.arg !== undefined) {
    const now = (await readQuietly($.clock.now())) ?? 0
    const parsed = parseArg(def.arg, undefined, { now, utcOffsetMinutes })
    if (!parsed.ok) {
      await settle($, id, false, t.invalidArg(def.id, '', def.arg.hint))
      return
    }
    value = parsed.value
  }

  if (def.kind === 'local') {
    await runLocalAction($, def, lang, id, value === undefined ? {} : { arg: value })
    return
  }
  // A model is sent the instructions and the argument alone, as text.
  const input = value === undefined ? undefined : String(value)
  if (def.kind === 'subagent') {
    await startSubagent($, def, lang, id, input === undefined ? def.task : `${def.task}\n\n${wrapInput(input)}`)
    return
  }
  if (def.kind === 'fork') {
    // Never defined (a fork carries the conversation); not run should one be.
    await settle($, id, false, t.failed('fork'))
    return
  }
  await complete($, lang, id, () =>
    $.model.complete({
      model: def.model,
      system: def.prompt,
      prompt: input === undefined ? NO_INPUT : wrapInput(input),
      effort: 'low',
      maxTokens: def.maxTokens ?? 1500,
      timeoutMs: 60_000,
    }),
  )
}

/** The text selected now, trimmed; undefined (and a toast saying so) when there is none. */
async function selectedText($: EngineInterface, lang: Lang): Promise<string | undefined> {
  const picked = (await $.ui.selection())?.text.trim()
  if (!picked) {
    $.ui.toast(MESSAGES[lang].noSelection)
    return undefined
  }
  return picked
}

async function runOnText($: EngineInterface, def: ActionDef, lang: Lang, text: string) {
  // Done with this selection: its icons go until another one is made. The
  // engine keeps answering it after a click elsewhere, so this is what hides them.
  await update($, dismissed, () => text)
  await run($, def, lang, text)
}

/** Runs `def` on the text selected now; false (and a toast saying so) when there is none. */
async function runOnSelection($: EngineInterface, def: ActionDef, lang: Lang): Promise<boolean> {
  const picked = await selectedText($, lang)
  if (picked === undefined) return false
  await runOnText($, def, lang, picked)
  return true
}

/** A context action: on the conversation, with no selection to read. */
async function runOnConversation($: EngineInterface, def: ActionDef, lang: Lang) {
  await run($, def, lang, '')
}

/** The text selected now, trimmed; null when there is none. No toast. */
async function selectionNow($: EngineInterface): Promise<string | null> {
  return (await $.ui.selection())?.text.trim() || null
}

/** The order of `specs` (every action of this load) by ID, `pins` first, from the usage scores as they stand now. Never rejects. */
async function computeOrder($: EngineInterface, load: OrderLoad): Promise<readonly string[]> {
  // An unreadable store counts as no usage: the actions still show.
  const usage = parseUsage(await readQuietly($.store.get(USAGE_KEY)))
  const now = (await readQuietly($.clock.now())) ?? 0
  // Settled with the order, once: whether the default set leads it (see arrange).
  load.defaults = defaultsLead(load.specs, load.pins, usage, now) ? DEFAULT_ACTION_IDS.map(id => ({ id })) : []
  return orderActions(load.specs, load.pins, usage, now).map(a => a.id)
}

/**
 * What one load orders: every action of it, its pins, where its settled order
 * is kept, and the default set when that leads it (set as the order settles).
 */
type OrderLoad = { specs: readonly ActionSpec[]; pins: readonly ActionSpec[]; slot: OrderSlot; defaults: readonly { id: string }[] }

/** The settled order of `load`'s actions by ID, computed the first time it is asked for. Never rejects. */
async function ensureOrder($: EngineInterface, load: OrderLoad): Promise<readonly string[]> {
  return settleIn(load.slot, () => computeOrder($, load))
}

/**
 * Opens the ⋯ dialog on `text` (null: none), or, left out, on the text
 * selected now. The text is kept in `picking` as it opens, so a pick runs on
 * it however the selection changes meanwhile. With no text, the dialog lists
 * the context and standalone actions alone.
 */
async function openPicker($: EngineInterface, lang: Lang, rows: number, text?: string | null) {
  const picked = text === undefined ? await selectionNow($) : text
  // Every open starts with the filter empty: every action listed.
  await update($, picking, () => ({ text: picked, filter: '' }))
  // The same width as the results: an open without `columns` resets the dock to
  // its default share, which widens it for as long as the dialog is open.
  await $.ui.open({ id: PICKER, title: MESSAGES[lang].pickerTitle, focus: true, closeOnEscape: true, rows, columns: PANE_COLUMNS })
}

/**
 * Closes the ⋯ dialog from within (a pick, its close button) and lets go of
 * the text it held. The plugin's own close does not pass through its own
 * `ui.close` hook, which covers the person's (Escape, the close mark).
 */
async function closePicker($: EngineInterface) {
  await update($, picking, () => null)
  await readQuietly($.ui.close({ id: PICKER }))
}

/**
 * A pick in the ⋯ dialog: runs `def` on the text the dialog opened on, read
 * before the dialog closes and lets go of it; a context action, on the
 * conversation. Either way, that text's icons go, as after a press on them.
 */
async function pick($: EngineInterface, lang: Lang, def: ActionDef | undefined) {
  const text = (await read($, picking))?.text ?? null
  await closePicker($)
  if (def === undefined) return
  // Standalone: run with no argument, the held text neither sent nor needed.
  if (isStandalone(def)) {
    if (text !== null) await update($, dismissed, () => text)
    await runStandalone($, def, lang)
    return
  }
  if (isContext(def)) {
    if (text !== null) await update($, dismissed, () => text)
    await runOnConversation($, def, lang)
    return
  }
  if (text === null) {
    $.ui.toast(MESSAGES[lang].noSelection)
    return
  }
  await runOnText($, def, lang, text)
}

export const register: Register = (on, options) => {
  // Options change reloads the module, so reading the settings once here is
  // enough. The custom definitions join the built-ins after them; one that is
  // invalid is left out, with its reason kept in `problems` to show the person.
  const custom = parseCustomActions(options.customActions, [...ACTIONS.map(a => a.id), 'close', HINT_ARG])
  const problems = custom.problems
  const allSpecs: readonly ActionSpec[] = [...ACTIONS, ...custom.specs]

  // The pins and the count alone are read here: they do not depend on the language.
  const pins = parsePins(allSpecs, options.actions)
  const hintCount = parseHintCount(options.hintCount)
  // Tall enough for every action in the ⋯ dialog, its notice, its legend, its
  // filter field and its button, up to PICKER_MAX_ROWS: with hundreds of
  // actions the pane scrolls rather than asks for more rows than there are.
  const pickerRows = Math.min(allSpecs.length + 6, PICKER_MAX_ROWS)

  // The specs by ID, for the filter: it searches a spec's labels in both
  // languages, which a definition resolved for one language no longer has.
  // Made once per load, as the specs are; the search keys are cached on them
  // (./filter), so a keystroke matches against keys already made.
  const specById = new Map(allSpecs.map(spec => [spec.id, spec]))
  /** The definitions of `defs` that match `query`, in their order (one whose ID is the query first). */
  const filterDefs = (defs: readonly ActionDef[], query: string): readonly ActionDef[] => {
    if (query.trim() === '') return defs
    const byId = new Map(defs.map(d => [d.id, d]))
    const specs = defs.flatMap(d => specById.get(d.id) ?? [])
    return filterActions(specs, query).flatMap(spec => byId.get(spec.id) ?? [])
  }

  // The order of every action, settled once per load: at session start, or by
  // whichever hook needs it first. Uses during the session do not move it, so
  // an icon stays where the person reaches for it. Kept with this load, not in
  // the module: a settling an earlier load started (with its own definitions)
  // may finish after a reload, and must not become this load's order.
  const orderLoad: OrderLoad = { specs: allSpecs, pins, slot: {}, defaults: [] }

  // Kept here, with this load's settings, rather than in a module-level cache
  // like actionsFor's: the custom definitions change with the setting, and
  // nothing from an earlier load may linger should the module be reused.
  const resolvedDefs: Partial<Record<Lang, readonly ActionDef[]>> = {}
  const defsFor = (l: Lang): readonly ActionDef[] => (resolvedDefs[l] ??= resolveAll(allSpecs, l))

  /** Every action in the settled order, resolved for the language: the ⋯ dialog's list; its first hintCount, the hint line's. */
  const inOrder = (ids: readonly string[], l: Lang): ActionDef[] => {
    const defs = defsFor(l)
    return ids.flatMap(id => findAction(defs, id) ?? [])
  }

  // The pane's colours: Claude Code's theme (auto), or a fixed palette.
  const paneTheme = parsePaneTheme(options.paneTheme)

  // The runs over time of an earlier load end with it: each period cancelled
  // here, whether or not the engine has already done so.
  for (const id of [...tickers.keys()]) endTicker(id)

  languageSetting = options.language
  settledLanguage = explicitLanguage(options.language)
  pendingLanguage = undefined

  on('session.start', async ($, e, next) => {
    const l = await ensureLanguage($)
    // The order for this session, from the usage so far.
    await ensureOrder($, orderLoad)
    await $.command.register({
      name: COMMAND,
      description: MESSAGES[l].commandDescription,
      argumentHint: MESSAGES[l].argumentHint,
      immediate: true,
    })

    // The icons follow $.ui.selection(): once it answers undefined, the next
    // poll writes null and the hint line redraws without them. The engine
    // keeps answering the last selection after its highlight goes (so a press
    // can still read it) until the person selects again or their next prompt
    // or command has run: no event tells the module more, so a press of an
    // action or ✕ hides the icons for that selection (see `dismissed`).
    //
    // The hint line `/quick-actions hint` opened (`hint`) holds the text
    // selected as the command ran, since running the command is itself what
    // makes the engine stop answering that selection: its going closes
    // nothing. A selection made after it opened arms it (one whose text is the
    // held one does not: that may be the held selection itself, seen late),
    // and that selection going closes it, as a selection's going hides its icons.
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const text = await selectionNow($)
        // Read before the write below, so the change is seen.
        const previous = await read($, selection)
        if (text !== previous) {
          await update($, selection, () => text)
        }
        const opened = await read($, hint)
        if (opened !== null) {
          if (!opened.armed && text !== null && text !== previous && text !== opened.text) {
            await update($, hint, h => (h === null ? h : { ...h, armed: true }))
          } else if (opened.armed && previous !== null && text === null) {
            await update($, hint, () => null)
          }
        }
        // Gone for good: the same text selected later shows its icons again.
        if (text === null && (await read($, dismissed)) !== null) {
          await update($, dismissed, () => null)
        }
      })()
    })

    // Told once per session, with the first reason; the command's result has
    // them all. Not awaited, like the noSelection toast: a toast that is slow
    // or cannot show must hold up neither the icons nor the next handler.
    if (problems.length > 0) {
      const text = MESSAGES[l].customIgnoredToast(problems.length, problemLine(problems[0]!, l))
      void Promise.resolve()
        .then(() => $.ui.toast(text))
        .catch(() => {
          // The command's result still lists them.
        })
    }

    return next(e)
  })

  // The subagent types exist for the icons alone: the main model is not offered them.
  for (const def of allSpecs) {
    if (def.kind !== 'subagent') continue
    on('agent.offer', { agent: subagentType(def) }, () => ({ isOffered: false })).catch(() => ({ isOffered: false }))
  }

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId === undefined ? undefined : pendingAgents.get(e.agentId)
    if (e.agentId !== undefined && id !== undefined) {
      pendingAgents.delete(e.agentId)
      const l = await ensureLanguage($)
      const ok = e.reason === 'answer' && e.answer.trim() !== ''
      await settle($, id, ok, ok ? e.answer.trim() : MESSAGES[l].noAnswer(e.reason))
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const defs = defsFor(l)
    // The ID (lowercased) and, after the first space, its argument (as written).
    const { id: wanted, arg } = splitCommandArgs(e.args)
    // Without an ID: the ⋯ dialog, on the text selected now (with none, the context and standalone actions).
    if (wanted === '') {
      await openPicker($, l, pickerRows)
      return { text: withProblems(t.pickerOpened, problems, l) }
    }
    // An argument nothing takes: told, and nothing runs (no pane, no use counted).
    const refuse = (id: string, given: string) => ({ text: withProblems(t.argsNotAccepted(id, given), problems, l) })
    // `hint`: the hint line, on the text selected now, held here while the
    // engine still answers it (see the poll in session.start).
    if (wanted === HINT_ARG) {
      if (arg !== undefined) return refuse(wanted, arg)
      const held = await selectionNow($)
      await update($, hint, () => ({ text: held, armed: false }))
      await update($, dismissed, () => null)
      return { text: withProblems(t.hintOpened, problems, l) }
    }
    const def = findAction(defs, wanted)
    // Whatever the result, the custom definitions left out follow it, so this
    // command is where the person can always read why.
    if (def === undefined) {
      // Told once, as the command's result: why its definition was left out,
      // or else up to CANDIDATES actions the ID matches as the ⋯ dialog's
      // filter would (in its order, every kind), never the whole list.
      const ignored = problemFor(problems, wanted)
      if (ignored !== undefined) return { text: withProblems(t.customIgnoredId(wanted, reasonText(ignored.reason, l)), problems, l) }
      const specs = (await ensureOrder($, orderLoad)).flatMap(id => specById.get(id) ?? [])
      const laidOut = arrange(specs, pins, true, orderLoad.defaults)
      const candidates = filterActions(laidOut, wanted).slice(0, CANDIDATES).map(a => a.id)
      return { text: withProblems(t.unknownId(wanted, candidates), problems, l) }
    }
    if (isStandalone(def)) {
      // The argument is parsed once, here: invalid, it is refused before
      // anything runs; valid, its value is what the run uses.
      let given: { raw: string; value: ArgValue | undefined } | undefined
      if (arg !== undefined) {
        if (def.kind === 'fork' || def.arg === undefined) return refuse(def.id, arg)
        const now = (await readQuietly($.clock.now())) ?? 0
        const parsed = parseArg(def.arg, arg, { now, utcOffsetMinutes })
        if (!parsed.ok) return { text: withProblems(t.invalidArg(def.id, arg, def.arg.hint), problems, l) }
        given = { raw: arg, value: parsed.value }
      }
      // A selection there now is not used: its icons go, as after a press.
      const current = await selectionNow($)
      if (current !== null) await update($, dismissed, () => current)
      await runStandalone($, def, l, given)
    } else if (arg !== undefined) {
      return refuse(def.id, arg)
    } else if (isContext(def)) await runOnConversation($, def, l)
    else if (!(await runOnSelection($, def, l))) return { text: withProblems(t.noSelection, problems, l) }

    return { text: withProblems(t.showing(PANE_TITLE, def.label), problems, l) }
  })

  // The icons take the hint line under the prompt, a row that is always there:
  // a band above the prompt would add a row mid-drag and shift the transcript.
  //
  // Shown on the text selected now, every kind of action (those on it first,
  // see arrange); else, while `/quick-actions hint` holds it open, on the text
  // it held (every kind) or, with none, the context and standalone actions alone.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.props.isDraft) return next(e)
    const selected = await read($, selection)
    const current = selected !== null && selected !== (await read($, dismissed)) ? selected : null
    const opened = await read($, hint)
    if (current === null && opened === null) return next(e)
    // What a selection action on this line runs on.
    const text = current ?? opened?.text ?? null

    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    // The first hintCount in the order, of the kinds that apply; pins beyond it too wait under ⋯.
    const ordered = inOrder(await ensureOrder($, orderLoad), l)
    const enabled = arrange(ordered, pins, text !== null, orderLoad.defaults).slice(0, hintCount)
    const { Box, Button, Text } = $.ui.resolve(e)

    // A press puts this line away, whichever kind it runs: the selection's
    // icons (dismissed) and the line `hint` opened.
    const press = async (a: ActionDef) => {
      // Standalone: run with no argument; the selection (or held text) is not sent.
      if (isStandalone(a)) {
        if (current !== null) await update($, dismissed, () => current)
        await runStandalone($, a, l)
      } else if (isContext(a)) {
        if (current !== null) await update($, dismissed, () => current)
        await runOnConversation($, a, l)
      } else if (current !== null) {
        await runOnSelection($, a, l)
      } else if (text !== null) {
        await run($, a, l, text)
      }
    }
    const close = async () => {
      if (current !== null) await update($, dismissed, () => current)
      await update($, hint, () => null)
    }

    return (
      <Box flexDirection="row">
        {enabled.map(a => (
          <Box key={`act-${a.id}`} hover={{ scope: `tip-action-${a.id}` }}>
            <Button
              key={a.id}
              label={markedIcon(a)}
              onPress={() => press(a)}
            />
          </Box>
        ))}
        <Box key="act-close" hover={{ scope: 'tip-close' }}>
          <Button
            key="close"
            label="✕"
            dimColor
            role="dismiss"
            onPress={close}
          />
        </Box>
        <Box key={`act-${MORE_KEY}`} hover={{ scope: 'tip-more' }}>
          <Button
            key={MORE_KEY}
            label="⋯"
            onPress={() => openPicker($, l, pickerRows, text)}
          />
        </Box>
        {enabled.map(a => (
          <Box display="none" hover={{ scope: `tip-action-${a.id}`, display: 'flex' }}>
            <Text color="cyan"> {a.label}</Text>
          </Box>
        ))}
        <Box display="none" hover={{ scope: 'tip-close', display: 'flex' }}>
          <Text color="cyan"> {t.close}</Text>
        </Box>
        <Box display="none" hover={{ scope: 'tip-more', display: 'flex' }}>
          <Text color="cyan"> {t.allActions}</Text>
        </Box>
      </Box>
    )
  })

  // The ⋯ dialog: every action, in the hint line's order, as "[icon] label",
  // "<icon> label" or "{icon} label" under a legend of the marks; opened with
  // no text, the context and standalone actions alone.
  // A filter field above the list narrows it as the person types (./filter:
  // ID, labels in both languages, kind names, kind marks), and Enter in it runs
  // the first action left; Clear beside it, or deleting its text, lists them
  // all again. The field takes the focus as the dialog opens; the focus ring
  // moves on to the list, where a Select takes the keys (arrows move, Enter
  // runs). Escape closes the dialog through closeOnEscape, its filter with it.
  // Focus is a request the engine refuses while the composer holds text: then
  // a line says how to get the keys, and the list and the close button still
  // answer a click. The mobile app draws no field and gets no such line: its
  // actions are buttons to tap, every one of them, and no keys.
  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const state = await read($, picking)
    const all = inOrder(await ensureOrder($, orderLoad), l)
    const hasSelection = state !== null && state.text !== null
    const ordered = arrange(all, pins, hasSelection, orderLoad.defaults)
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // The mobile app draws no Select (though its table names one): there the
    // actions are buttons.
    // A palette draws buttons too: a Select takes no colour, and core's (the
    // theme's) need not read on the palette's background.
    const style = paneStyle(paneTheme, e.props.placement)
    const fixed = style.background !== undefined
    const Select = e.surface !== 'mobile' && !fixed && 'Select' in elements ? elements.Select : undefined
    // The filter field: wherever an Input is drawn, a palette's dialog included.
    const Input = e.surface !== 'mobile' && 'Input' in elements ? elements.Input : undefined
    const filter = Input === undefined ? '' : (state?.filter ?? '')
    const shown = filterDefs(ordered, filter)
    const keyboardNotice = e.surface !== 'mobile' && !e.props.isFocused
    // The close button's props; it is drawn dimColor as before, or in the palette's muted colour.
    const close = { label: t.pickerClose, role: 'dismiss' as const, onPress: () => closePicker($) }

    const setFilter = (value: string) => update($, picking, p => (p === null ? p : { ...p, filter: value }))
    // Enter in the field: the first action its text leaves, worked out from
    // that text rather than the last drawn list, in case a change had not
    // reached the state yet. None left: the dialog stays, with that filter.
    const submit = async (value: string) => {
      const first = filterDefs(ordered, value)[0]
      if (first === undefined) {
        await setFilter(value)
        return
      }
      await pick($, l, first)
    }
    const clear = { label: t.pickerFilterClear, onPress: () => setFilter('') }

    return (
      <Box flexDirection="column" {...painted(style)}>
        {keyboardNotice && <Text {...muted(style)}>{t.pickerNoFocus}</Text>}
        {state !== null && <Text {...muted(style)}>{t.pickerLegend(hasSelection)}</Text>}
        {state !== null && Input !== undefined && (
          <Box flexDirection="row">
            <Input
              key={PICKER_FILTER_KEY}
              placeholder={t.pickerFilterPlaceholder}
              value={filter}
              autoFocus
              onInput={value => {
                void setFilter(value)
              }}
              onSubmit={value => {
                void submit(value)
              }}
            />
            {filter !== '' &&
              (fixed ? (
                <Button key={PICKER_FILTER_CLEAR_KEY} {...clear}>
                  <Text color={style.muted}>{t.pickerFilterClear}</Text>
                </Button>
              ) : (
                <Button key={PICKER_FILTER_CLEAR_KEY} {...clear} />
              ))}
          </Box>
        )}
        {state === null ? (
          <Text {...muted(style)}>{t.noSelection}</Text>
        ) : shown.length === 0 ? (
          // A Select takes one option at least: with none, this line instead.
          <Text {...muted(style)}>{t.pickerNoMatch}</Text>
        ) : Select !== undefined ? (
          <Select
            key={PICKER_SELECT_KEY}
            label={t.pickerLabel}
            options={shown.map(a => ({ value: a.id, label: `${markedIcon(a)} ${a.label}` }))}
            onSelect={value => pick($, l, findAction(shown, value))}
          />
        ) : (
          <Box flexDirection="column">
            {shown.map((a, i) => {
              const label = `${markedIcon(a)} ${a.label}`
              const button = { label, onPress: () => pick($, l, a) }
              // With a palette the label is a child Text in its colour, and,
              // with no filter field to take it, the first takes the focus ring
              // as the dialog takes the keys, as the Select would; otherwise
              // the button stays as it always was.
              return fixed ? (
                <Button key={a.id} {...button} {...(i === 0 && Input === undefined && { autoFocus: true as const })}>
                  <Text color={style.body}>{label}</Text>
                </Button>
              ) : (
                <Button key={a.id} {...button} />
              )
            })}
          </Box>
        )}
        {fixed ? (
          <Button key={PICKER_CLOSE_KEY} {...close}>
            <Text color={style.muted}>{t.pickerClose}</Text>
          </Button>
        ) : (
          <Button key={PICKER_CLOSE_KEY} {...close} dimColor />
        )}
      </Box>
    )
  })

  // The person's close (Escape through closeOnEscape, the close mark): the
  // text it held goes with it and nothing runs. Closes from within go
  // through closePicker, which does the same.
  on('ui.close', { id: PICKER }, async ($, e, next) => {
    await update($, picking, () => null)
    return next(e)
  })

  // The person closed the result pane: every run over time stops with it, its
  // entry done and saying how long it ran. The plugin never closes this pane
  // itself, so this is the only close to follow.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (tickers.size > 0) {
      // Every period is cancelled first, before anything is awaited, so none
      // runs on whatever else fails; the entries are settled after.
      const stopping = [...tickers.entries()]
      for (const [id] of stopping) endTicker(id)
      try {
        const l = await ensureLanguage($)
        await Promise.all(stopping.map(([id, ticker]) => settleStopped($, l, id, ticker.startedAt)))
      } catch {
        // The entries may stay running in the state; with no run behind them, the pane draws them stopped.
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const defs = defsFor(l)
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, results)
    const style = paneStyle(paneTheme, e.props.placement)
    const fixed = style.background !== undefined
    /** What the entry's heading says it ran on. */
    const onWhat = (r: Result) => {
      const target = r.target ?? (r.quote === '' ? 'context' : 'selection')
      if (target === 'context') return t.onConversation
      if (target === 'none') return r.arg === undefined ? t.standalone : t.quote(r.arg)
      return t.quote(r.quote)
    }
    /** A running entry: its frame and stop button while it runs over time, stopped once its run is gone (a reload), else the running text. */
    const running = (r: Result, def: ActionDef | undefined) => {
      if (r.ticker !== true) return <Text {...muted(style)}>{def?.runningText ?? t.thinking}</Text>
      if (!tickers.has(r.id)) return <Text {...muted(style)}>{t.tickerStopped()}</Text>
      const stop = { label: t.stop, onPress: () => stopTicker($, l, r.id) }
      return (
        <Box flexDirection="column">
          <Text color={style.body}>{r.text}</Text>
          {fixed ? (
            <Button key={stopKey(r.id)} {...stop}>
              <Text color={style.muted}>{t.stop}</Text>
            </Button>
          ) : (
            <Button key={stopKey(r.id)} {...stop} />
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" {...painted(style)}>
        {problems.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color={style.failed}>{t.customProblemsHeading}</Text>
            {problems.map((p, i) => (
              <Text key={String(i)} color={style.failed}>- {problemLine(p, l)}</Text>
            ))}
          </Box>
        )}
        {e.props.placement === 'inline' && (
          <Text dimColor>{t.inlineHint}</Text>
        )}
        {list.length === 0 && (
          <Text {...muted(style)}>{t.emptyPane}</Text>
        )}
        {list.map(r => {
          const def = findAction(defs, r.action)
          return (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color={style.heading}>
                {def?.icon ?? '•'} {def?.label ?? r.action}{' '}
                <Text {...muted(style)}>{onWhat(r)}</Text>
              </Text>
              {r.status === 'running' ? (
                running(r, def)
              ) : (
                <Text color={r.status === 'failed' ? style.failed : style.body}>{r.text}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
