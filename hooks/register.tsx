import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Result, ResultOrigin } from '../types'
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
import { buttonWidth, COMPACT_BELOW, dockWidth, hintCountFor, hintLineColumns, hintTarget } from './hint-width'
import { HINT_KINDS, USAGE_KEY, arrange, defaultsLead, hintKindFor, ofKind, orderActions, parseHintCount, parsePins, parseUsage, recordUse, settleIn } from './order'
import type { HintKind, OrderSlot } from './order'
import { HIGHLIGHT, paneStyle, parsePaneTheme } from './palette'
import { HIGHLIGHT_ROWS, clearHighlight, highlightedRowsOf, isHighlighted, nextEntryId, sameRows } from './highlight'
import type { PaneStyle } from './palette'
import { random, randomBytes } from './random'
import { FILTER_KEY, toFilterField } from './focus'
import { settleQuietly, toLatest, toRow } from './scroll'

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
/** The most options the engine takes in one Select. */
export const SELECT_MAX_OPTIONS = 64
const PICKER_CLOSE_KEY = '_picker-close'
// The Box the list is drawn in, keyed by its rows as well (see the dialog).
const PICKER_LIST_KEY = '_picker-list'
// The dialog's filter field, and the button beside it that empties it.
const PICKER_FILTER_KEY = FILTER_KEY
const PICKER_FILTER_CLEAR_KEY = '_filter-clear'
// The most candidates an unknown ID is answered with.
const CANDIDATES = 10
// The ⋯ dialog's rows at most: past them, the pane scrolls.
const PICKER_MAX_ROWS = 30
// The hint line's kind buttons, one per kind (./order), and the button under
// an AskUserQuestion dialog that opens the panes.
const kindKey = (kind: HintKind) => `_kind-${kind}`
const ASK_OPEN_KEY = '_ask-open'
// The rows the ⋯ dialog's list leaves for the rest of the dialog at most: the
// notice, the legend, the filter row, the "n more" row and the close button.
const PICKER_CHROME_ROWS = 5
// The fewest rows the list is sized to, however short the pane.
const PICKER_MIN_LIST_ROWS = 3
// What the dock is taken to be before this plugin's pane has been drawn
// docked: the width every open asks for, and its frame.
const ASSUMED_DOCK = dockWidth(PANE_COLUMNS)
// The terminal docks a pane from this width, in fullscreen.
const DOCK_FROM_COLUMNS = 110
// The stop button of a run over time in the result pane, one per entry.
const stopKey = (id: number) => `_stop-${id}`
// The two buttons of an entry run on a selection that lies in one transcript
// row: back to that row, and its highlight off. One of each per entry.
const gotoKey = (id: number) => `_goto-${id}`
const unmarkKey = (id: number) => `_unmark-${id}`

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
const highlightedRows = atom({ plugin: 'quick-actions', key: 'highlightedRows' } as const, [])
const hintKind = atom({ plugin: 'quick-actions', key: 'hintKind' } as const, null)
const asking = atom({ plugin: 'quick-actions', key: 'asking' } as const, 0)

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

// The module's count of entries. A reload starts it again from 1 while the
// results stay, so begin() takes the next ID past those too (nextEntryId).
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

/**
 * Brings `highlightedRows` in line with what `results` says, written only when
 * the rows differ: the transcript rows read it while they draw, so a write of
 * `results` that leaves the rows as they were (a tick, a settle) redraws none.
 * Called after every write that can change the rows (an entry added, and so
 * one pushed out; a highlight cleared) and as a session starts. Read again
 * after a write, should `results` have changed meanwhile.
 */
async function syncHighlights($: EngineInterface) {
  for (;;) {
    const rows = highlightedRowsOf(await read($, results))
    if (sameRows(await read($, highlightedRows), rows)) return
    await update($, highlightedRows, () => rows)
  }
}

/** What a new entry says it ran on, and, for a selection in one transcript row, where that lies. */
type EntryHead = Pick<Result, 'target' | 'quote' | 'arg' | 'origin'>

/**
 * A selection as the engine answers it: its text, trimmed, and the transcript
 * row it lies in when the engine names one (a selection within one row).
 */
type Picked = { text: string; requestId?: string }

/** `picked` as the engine answered it: the text trimmed, an empty or missing row left out. */
function pickedOf(text: string, requestId: unknown): Picked {
  return typeof requestId === 'string' && requestId !== '' ? { text, requestId } : { text }
}

/**
 * What every run does first, whatever it runs on: one more use of the action,
 * the hint line `/quick-actions hint` opened closed (its kind with it), a new
 * entry (running) at the top of the pane, both tabs open with the results
 * shown and brought back to their top. An entry pushed out past KEEP stops its
 * run over time, if it has one. The new entry's ID.
 *
 * `text` is the selected text a selection action runs on, which the ⋯
 * dialog's tab then holds; left out (a context or standalone action), the
 * tab keeps what it holds, or, closed, opens on the text selected now.
 */
async function begin($: EngineInterface, def: ActionDef, lang: Lang, head: EntryHead, text?: Picked): Promise<number> {
  // Not awaited: the score must not hold up the answer.
  void recordUsage($, def.id)
  await update($, hint, () => null)
  await update($, hintKind, () => null)
  // Worked out on the list it is added to, in the same update: past every ID
  // kept, whatever a reload did to nextId. The update may run the change again
  // (another write came first): the ID is the one its last run settled on.
  let id = nextId
  await update($, results, list => {
    id = nextEntryId(list, nextId)
    const result: Result = { id, action: def.id, ...head, status: 'running', text: '' }
    return [result, ...list].slice(0, KEEP)
  })
  nextId = Math.max(nextId, id + 1)
  await syncHighlights($)
  if (tickers.size > 0) {
    const kept = new Set((await read($, results)).map(r => r.id))
    for (const running of [...tickers.keys()]) if (!kept.has(running)) endTicker(running)
  }
  // The text the dialog's tab holds while it is up; a tab the engine unloaded
  // unheard holds nothing (openPicking), so a stale text is never run on.
  const open = await openPicking($)
  const held = text ?? (open === null ? await pickedNow($) : open.text === null ? null : pickedOf(open.text, open.requestId))
  await openPanes($, lang, 'results', held, false)
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
// `requestId` is the transcript row the selection lies in, when the engine
// named one: the entry then keeps it (its origin), highlighted.
async function run($: EngineInterface, def: ActionDef, lang: Lang, text: string, requestId?: string) {
  const context = isContext(def)
  const origin: ResultOrigin | undefined = context || requestId === undefined ? undefined : { requestId, highlighted: true }
  const id = await begin(
    $,
    def,
    lang,
    context ? { target: 'context', quote: '' } : { target: 'selection', quote: quoteOf(text), ...(origin === undefined ? {} : { origin }) },
    context ? undefined : pickedOf(text, requestId),
  )

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
  const id = await begin($, def, lang, { target: 'none', quote: '', ...(given === undefined ? {} : { arg: quoteOf(given.raw) }) })

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

/** The selection now, its text trimmed, with its row; undefined (and a toast saying so) when there is none. */
async function selectedText($: EngineInterface, lang: Lang): Promise<Picked | undefined> {
  const picked = await pickedNow($)
  if (picked === null) {
    $.ui.toast(MESSAGES[lang].noSelection)
    return undefined
  }
  return picked
}

async function runOnText($: EngineInterface, def: ActionDef, lang: Lang, picked: Picked) {
  // Done with this selection: its icons go until another one is made. The
  // engine keeps answering it after a click elsewhere, so this is what hides them.
  await update($, dismissed, () => picked.text)
  await run($, def, lang, picked.text, picked.requestId)
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

/** The selection now, its text trimmed, with its row; null when there is none. No toast. */
async function pickedNow($: EngineInterface): Promise<Picked | null> {
  const selected = await $.ui.selection()
  const text = selected?.text.trim()
  return text ? pickedOf(text, selected?.requestId) : null
}

/** The text selected now, trimmed; null when there is none. No toast. */
async function selectionNow($: EngineInterface): Promise<string | null> {
  return (await pickedNow($))?.text ?? null
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

// The rows both tabs ask for while seated inline above the prompt: tall
// enough for every action in the ⋯ dialog, set by register for its load.
let paneRows = PICKER_MAX_ROWS

/** Which of the two tabs an open shows: the results ("Quick Actions") or the ⋯ dialog ("Select an action"). */
type Shown = 'results' | 'picker'

/**
 * Opens the right pane as two tabs, always both: the results ("Quick
 * Actions") and the ⋯ dialog ("Select an action"), the one `show` names
 * last, so it is the one shown. The dialog's tab holds `held`'s text (null:
 * none, the context and standalone actions alone) and the transcript row it
 * lies in, so a pick runs on it however the selection changes meanwhile; every
 * open starts its filter empty.
 *
 * Each open sets `closeOnEscape` and `rows` anew (PaneOpenArgs), so both tabs
 * are opened with the same options every time, whoever opens them: the title,
 * the width (an open without `columns` resets the dock to its default share),
 * Escape closing them, the inline rows. `focus` alone differs: asked for the
 * tab shown, and only when `focus` says the person asked for it.
 *
 * Should the tab opened last stay behind the other (an open of an id already
 * open retitles it, and need not show it), it is closed and opened afresh,
 * which shows it.
 */
async function openPanes($: EngineInterface, lang: Lang, show: Shown, held: Picked | null, focus: boolean) {
  await update($, picking, () => ({ text: held?.text ?? null, ...(held?.requestId === undefined ? {} : { requestId: held.requestId }), filter: '' }))
  const options = { closeOnEscape: true as const, rows: paneRows, columns: PANE_COLUMNS }
  const resultsTab = { id: PANE, title: PANE_TITLE, ...options }
  const pickerTab = { id: PICKER, title: MESSAGES[lang].pickerTitle, ...options }
  const [behind, front] = show === 'results' ? [pickerTab, resultsTab] : [resultsTab, pickerTab]
  await $.ui.open(behind)
  const last = focus ? { ...front, focus: true as const } : front
  await $.ui.open(last)
  const panes = await readQuietly($.ui.panes())
  const frontPane = panes?.find(p => p.id === front.id)
  if (frontPane !== undefined && frontPane.isPlaced && !frontPane.isShown) {
    await readQuietly($.ui.close({ id: front.id }))
    await $.ui.open(last)
  }
}

// The cells this plugin's docked pane takes off the transcript's column (its
// body and frame), as last drawn on each surface; 0 while it is drawn inline
// there; absent while it is closed or not yet drawn there (a reload starts
// with none). One entry per surface: a session may draw on several at once,
// each seating the pane its own way (a terminal docked, a desktop inline), and
// each hint line takes off its own surface's dock alone. Kept in the module,
// not in the state: a render hook may not write the state, and this is what
// one measures.
const measuredDock = new Map<RenderSurface, number>()

/**
 * The ⋯ dialog's state while its tabs are up, by the engine's record
 * ($.ui.panes()), not the state's alone: a pane the engine unloads (its
 * drawing threw) is gone before any hook hears of it, so closeAll never runs
 * and `picking` stays; here it then reads as closed. Should the record not
 * answer, the state is taken at its word.
 */
async function openPicking($: EngineInterface) {
  const state = await read($, picking)
  if (state === null) return null
  const panes = await readQuietly($.ui.panes())
  if (panes === undefined) return state
  return panes.some(p => p.id === PANE || p.id === PICKER) ? state : null
}

/** Ends every run over time, each entry done and saying how long it ran. Never rejects. */
async function stopAllTickers($: EngineInterface) {
  if (tickers.size === 0) return
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

/**
 * Whether a close of one of the two tabs closes the whole pane: the person's
 * (the close mark, ctrl+x x, Escape through closeOnEscape) does; the
 * plugin's own (closeAll, a tab reopened to show it) and an unload do not, so
 * no close the plugin makes comes back to close more.
 */
export const closesWhole = (origin: { kind: 'plugin' | 'person' | 'unload' }) => origin.kind === 'person'

/**
 * Closes the whole right pane, both tabs, in one go: every run over time
 * stops, the ⋯ dialog lets go of its text and the dock of its width. `closing`
 * is a tab the person is closing already (its own `ui.close`), left to that.
 *
 * A model call or a subagent under way goes on: its answer lands in the
 * results, shown the next time the pane opens. Never rejects.
 */
async function closeAll($: EngineInterface, closing?: string) {
  await stopAllTickers($)
  await update($, picking, () => null)
  measuredDock.clear()
  for (const id of [PICKER, PANE]) {
    if (id !== closing) await readQuietly($.ui.close({ id }))
  }
}

/**
 * Notes the width this plugin's pane takes off the transcript's column on
 * `surface`, as the pane is drawn there: docked, its body and frame; inline,
 * none. On a change the plugin's drawings are asked again, so that surface's
 * hint line follows it (the pane's own redraw then finds it unchanged, and
 * asks nothing more). Each surface writes its own entry alone, so two seating
 * the pane differently never undo each other's: the redraws settle.
 */
function noteDock($: EngineInterface, surface: RenderSurface, isOpen: boolean, placement: 'dock' | 'inline', bodyColumns: number) {
  // A drawing after closeAll (the state it cleared redraws the pane before it
  // goes) measures nothing: the pane is on its way out.
  if (!isOpen) {
    measuredDock.delete(surface)
    return
  }
  const width = placement === 'dock' ? dockWidth(bodyColumns) : 0
  if (measuredDock.get(surface) === width) return
  measuredDock.set(surface, width)
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The hint line takes the width at its next drawing.
  }
}

/**
 * A pick in the ⋯ dialog: runs `def` on the text the dialog opened on; a
 * context action, on the conversation. Either way, that text's icons go, as
 * after a press on them. The dialog's tab stays, its filter emptied, its text
 * kept; the run shows the results' tab (begin).
 */
async function pick($: EngineInterface, lang: Lang, def: ActionDef | undefined) {
  const held = await read($, picking)
  const text = held?.text ?? null
  await update($, picking, p => (p === null ? p : { ...p, filter: '' }))
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
  await runOnText($, def, lang, pickedOf(text, held?.requestId))
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
  // Both tabs ask for it (see openPanes), so the inline block keeps one height whichever is shown.
  const pickerRows = Math.min(allSpecs.length + 6, PICKER_MAX_ROWS)
  paneRows = pickerRows

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
  // The dock is measured afresh by this load's drawings.
  measuredDock.clear()

  on('session.start', async ($, e, next) => {
    const l = await ensureLanguage($)
    // The rows as the results kept say, should they have been kept without them.
    await syncHighlights($)
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
          // A new selection (or none) opens the hint line on its own kind again.
          await update($, hintKind, () => null)
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
      await openPanes($, l, 'picker', await pickedNow($), true)
      return { text: withProblems(t.pickerOpened, problems, l) }
    }
    // An argument nothing takes: told, and nothing runs (no pane, no use counted).
    const refuse = (id: string, given: string) => ({ text: withProblems(t.argsNotAccepted(id, given), problems, l) })
    // `hint`: the hint line, on the text selected now, held here while the
    // engine still answers it (see the poll in session.start).
    if (wanted === HINT_ARG) {
      if (arg !== undefined) return refuse(wanted, arg)
      const held = await pickedNow($)
      await update($, hint, () => ({ text: held?.text ?? null, ...(held?.requestId === undefined ? {} : { requestId: held.requestId }), armed: false }))
      await update($, hintKind, () => null)
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
  // Shown on the text selected now; else, while `/quick-actions hint` holds it
  // open, on the text it held or, with none, without the selection's actions.
  //
  // The engine keeps answering a selection after its highlight goes (see the
  // poll), and nothing tells the module the highlight went: the line cannot
  // follow what the screen shows. So it shows one kind at a time, and three
  // buttons at its start switch it: the selection's ([選択]), the
  // conversation's (<会話>) and the standalone ones ({単独}). It opens on the
  // selection's when there is text to run on (a new selection, or `hint` run
  // over one), else on the conversation's; the selection's button is drawn
  // only with text. A line left up after the highlight went is still of use:
  // switched to the conversation's or the standalone ones.
  //
  // How many icons: the `hintCount` setting is the count on an 80-column line;
  // the line's width (the terminal's, less this plugin's dock beside it) moves
  // it in proportion, never past what fits (./hint-width).
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
    const kind = hintKindFor(await read($, hintKind), text !== null)
    const kinds = HINT_KINDS.filter(k => k !== 'selection' || text !== null)
    // The order of the kinds that apply, pins first, of the kind shown.
    const ordered = inOrder(await ensureOrder($, orderLoad), l)
    const candidates = ofKind(arrange(ordered, pins, text !== null, orderLoad.defaults), kind)

    // The line's width: the terminal's less this plugin's dock, as drawn, or,
    // before it is drawn, as every open asks for it while the tabs are open on
    // a terminal wide enough to dock them.
    const viewport = e.viewport
    let columns: number | undefined
    if (viewport !== undefined) {
      // Open by the engine's record: a tab unloaded unheard takes nothing off.
      const isOpen = (await openPicking($)) !== null
      // This surface's own dock, never another's (a desktop's inline pane
      // says nothing of the terminal's docked one).
      const measured = isOpen ? measuredDock.get(e.surface) : undefined
      const docked = isOpen && viewport.isFullscreen === true && viewport.columns >= DOCK_FROM_COLUMNS
      columns = hintLineColumns(viewport.columns, measured ?? (docked ? ASSUMED_DOCK : 0))
    }
    // Narrow, the kind buttons are drawn as their marks alone; their hover
    // labels say which.
    const compact = columns !== undefined && columns < COMPACT_BELOW
    const kindLabel = (k: HintKind) => markedIcon({ icon: compact ? ' ' : t.hintKinds[k], target: k === 'standalone' ? 'none' : k })
    // What each kind button is named, whatever it draws (a desktop's native
    // button and assistive tech read the label, not the drawing): which actions
    // it shows, and, for the one shown now, that it is.
    const kindName = (k: HintKind) => (k === kind ? t.hintKindShown(t.hintKindTips[k]) : t.hintKindTips[k])
    // ✕ and ⋯ always; the kind buttons while they fit beside them (on a line
    // too narrow even for their marks, the kind shown stays as it is).
    const ends = buttonWidth('✕') + buttonWidth('⋯')
    const kindsWidth = kinds.reduce((sum, k) => sum + buttonWidth(kindLabel(k)), 0)
    const shownKinds = columns === undefined || ends + kindsWidth <= columns ? kinds : []
    const reserved = ends + (shownKinds.length > 0 ? kindsWidth : 0)
    // Widths measured for as many as the line could take at most, not every candidate.
    const most = columns === undefined ? hintCount : hintTarget(columns, hintCount)
    const count = hintCountFor(columns, hintCount, reserved, candidates.slice(0, most).map(a => buttonWidth(markedIcon(a))))
    const enabled = candidates.slice(0, count)
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
        await run($, a, l, text, opened?.requestId)
      }
    }
    // What the ⋯ dialog opens on: the selection now with its row (as read
    // now, should the engine still answer it), else the text the line holds.
    const forPicker = async (): Promise<Picked | null> => {
      if (current !== null) {
        const now = await pickedNow($)
        return now !== null && now.text === current ? now : { text: current }
      }
      return text === null ? null : pickedOf(text, opened?.requestId)
    }
    const close = async () => {
      if (current !== null) await update($, dismissed, () => current)
      await update($, hint, () => null)
      await update($, hintKind, () => null)
    }
    // The hover labels: cut where the row ends rather than wrapped onto another.
    const tip = (scope: string, label: string) => (
      <Box display="none" flexShrink={1} hover={{ scope, display: 'flex' }}>
        <Text color="cyan" wrap="truncate"> {label}</Text>
      </Box>
    )

    return (
      <Box flexDirection="row">
        {shownKinds.map(k => (
          <Box key={`act-${kindKey(k)}`} hover={{ scope: `tip-kind-${k}` }}>
            {k === kind ? (
              <Button key={kindKey(k)} label={kindName(k)} onPress={() => update($, hintKind, () => k)}>
                <Text bold color="cyan">{kindLabel(k)}</Text>
              </Button>
            ) : (
              <Button key={kindKey(k)} label={kindName(k)} dimColor onPress={() => update($, hintKind, () => k)}>
                {kindLabel(k)}
              </Button>
            )}
          </Box>
        ))}
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
            onPress={async () => openPanes($, l, 'picker', await forPicker(), true)}
          />
        </Box>
        {shownKinds.map(k => tip(`tip-kind-${k}`, t.hintKindTips[k]))}
        {enabled.map(a => tip(`tip-action-${a.id}`, a.label))}
        {tip('tip-close', t.close)}
        {tip('tip-more', t.allActions)}
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
  // runs). Escape closes the whole pane through closeOnEscape (both tabs; the
  // filter too, rather than emptying it), as the close button does.
  // Focus is a request the engine refuses while the composer holds text: then
  // a line says how to get the keys, and the list and the close button still
  // answer a click. The mobile app draws no field and gets no such line: its
  // actions are buttons to tap, every one of them, and no keys.
  //
  // While an AskUserQuestion dialog is up it holds the keys, and the engine
  // refuses the pane any focus asked for: the list is buttons to click then
  // (no field, no Select, which want the keys), under a line saying so.
  //
  // The list fills the pane's height: it is drawn in a Box keyed by the rows it
  // has (scroll.bodyRows less the rest of the dialog), so a terminal shrunk and
  // grown again draws the Select anew at the new height rather than keeping
  // the rows it was first laid out in.
  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const state = await read($, picking)
    noteDock($, e.surface, state !== null, e.props.placement, e.props.bodyColumns)
    const isAsking = (await read($, asking)) > 0
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
    const Select = e.surface !== 'mobile' && !fixed && !isAsking && 'Select' in elements ? elements.Select : undefined
    // The filter field: wherever an Input is drawn, a palette's dialog included.
    const Input = e.surface !== 'mobile' && !isAsking && 'Input' in elements ? elements.Input : undefined
    const filter = Input === undefined ? '' : (state?.filter ?? '')
    const shown = filterDefs(ordered, filter)
    // A Select takes 64 options at most: past that it lists the first 64 (in
    // the dialog's order, so the most used come first) and a line under it says
    // how many more the filter reaches. Every surface that draws a Select draws
    // an Input too (all but mobile carry both, and a table handed out is
    // completed to every name), so wherever a Select is drawn the filter field
    // is there to reach the rest; buttons (mobile, a palette) list them all.
    const listed = Select === undefined ? shown : shown.slice(0, SELECT_MAX_OPTIONS)
    const keyboardNotice = e.surface !== 'mobile' && !isAsking && !e.props.isFocused
    // The rows the list has: the pane's, less the rest of the dialog.
    const listRows = Math.max(PICKER_MIN_LIST_ROWS, e.props.scroll.bodyRows - PICKER_CHROME_ROWS)
    // The close button's props; it is drawn dimColor as before, or in the
    // palette's muted colour. It closes the whole pane, both tabs.
    const close = { label: t.pickerClose, role: 'dismiss' as const, onPress: () => closeAll($) }

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
    // Clear empties the field and hands the focus ring back to it (see ./focus).
    const clear = {
      label: t.pickerFilterClear,
      onPress: async () => {
        await setFilter('')
        await settleQuietly($.ui.focus(toFilterField(PICKER)))
      },
    }

    return (
      <Box flexDirection="column" {...painted(style)}>
        {keyboardNotice && <Text {...muted(style)}>{t.pickerNoFocus}</Text>}
        {isAsking && e.surface !== 'mobile' && <Text {...muted(style)}>{t.pickerAsking}</Text>}
        {state !== null && <Text {...muted(style)}>{t.pickerLegend(hasSelection)}</Text>}
        {state !== null && Input !== undefined && (
          <Box flexDirection="row">
            <Input
              key={PICKER_FILTER_KEY}
              placeholder={t.pickerFilterPlaceholder}
              value={filter}
              submitLabel={shown.length === 0 ? t.pickerFilterSubmitNone : t.pickerFilterSubmit}
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
          <Box key={`${PICKER_LIST_KEY}-${listRows}`} flexDirection="column">
            <Select
              key={PICKER_SELECT_KEY}
              label={t.pickerLabel}
              options={listed.map(a => ({ value: a.id, label: `${markedIcon(a)} ${a.label}` }))}
              onSelect={value => pick($, l, findAction(listed, value))}
            />
            {shown.length > listed.length && <Text {...muted(style)}>{t.pickerMore(shown.length - listed.length)}</Text>}
          </Box>
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

  // The transcript row a result's selection lies in, highlighted until that
  // result's "Clear highlight" (or until it is pushed out of the pane): the
  // engine's own drawing of the row, untouched, inside a Box of the highlight
  // colour. A row with no highlight is left to the engine, as it always was.
  // Closing the pane leaves the highlights alone. It reads highlightedRows
  // alone, never `results`, so the rows are drawn again only when the
  // highlighted rows change, not on every write of the results.
  on('ui.render', { component: HIGHLIGHT_ROWS }, async ($, e, next) => {
    if (!isHighlighted(await read($, highlightedRows), e)) return next(e)
    const drawn = await next(e)
    const { Box } = $.ui.resolve(e)
    return <Box backgroundColor={HIGHLIGHT}>{drawn}</Box>
  })

  // The person's close of either tab (Escape through closeOnEscape, the close
  // mark, ctrl+x x) closes the whole pane: the other tab with it, every run
  // over time stopped (its entry done, saying how long it ran), the text the
  // ⋯ dialog held let go; nothing runs. The plugin's own closes (closeAll, a
  // tab reopened to show it) chain nothing, so no close comes back here.
  for (const id of [PICKER, PANE]) {
    on('ui.close', { id }, async ($, e, next) => {
      if (closesWhole(e.origin)) await closeAll($, id)
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const defs = defsFor(l)
    const { Box, Button, Text } = $.ui.resolve(e)
    noteDock($, e.surface, (await read($, picking)) !== null, e.props.placement, e.props.bodyColumns)
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
    /** A button of the pane: in the palette's muted colour when it paints one, else the surface's own. */
    const paneButton = (key: string, label: string, onPress: () => unknown) =>
      fixed ? (
        <Button key={key} label={label} onPress={onPress}>
          <Text color={style.muted}>{label}</Text>
        </Button>
      ) : (
        <Button key={key} label={label} onPress={onPress} />
      )
    /** A running entry: its frame and stop button while it runs over time, stopped once its run is gone (a reload), else the running text. */
    const running = (r: Result, def: ActionDef | undefined) => {
      if (r.ticker !== true) return <Text {...muted(style)}>{def?.runningText ?? t.thinking}</Text>
      if (!tickers.has(r.id)) return <Text {...muted(style)}>{t.tickerStopped()}</Text>
      return (
        <Box flexDirection="column">
          <Text color={style.body}>{r.text}</Text>
          {paneButton(stopKey(r.id), t.stop, () => stopTicker($, l, r.id))}
        </Box>
      )
    }
    /**
     * The buttons of an entry run on a selection in one transcript row: back
     * to that row (scrolled to as the answer to the press itself, which is
     * when the engine moves the transcript), and, while the row shows it, the
     * entry's highlight off. A refused scroll (the row no longer kept) does nothing.
     */
    const marks = (r: Result, origin: ResultOrigin) => (
      <Box flexDirection="row">
        {paneButton(gotoKey(r.id), t.gotoSelection, () => settleQuietly($.ui.scroll(toRow(origin.requestId))))}
        {origin.highlighted &&
          paneButton(unmarkKey(r.id), t.clearHighlight, async () => {
            await update($, results, list => clearHighlight(list, r.id))
            await syncHighlights($)
          })}
      </Box>
    )

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
              {r.origin !== undefined && marks(r, r.origin)}
            </Box>
          )
        })}
      </Box>
    )
  })

  // An AskUserQuestion dialog holds the keys while it is up (the composer is
  // gone, so /quick-actions cannot be typed, and the engine refuses a pane any
  // focus asked for). Counted while each is up, so the ⋯ dialog draws its
  // actions as buttons to click meanwhile; down again however the call ends.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await update($, asking, n => n + 1)
    try {
      return await next(e)
    } finally {
      await update($, asking, n => Math.max(0, n - 1))
    }
  })

  // Over the dialog, a button that opens the pane on the ⋯ dialog's tab, so
  // the actions are there while the question is (to look something up before
  // answering): the composer is gone meanwhile, so /quick-actions cannot be
  // typed. Over it, since the engine refuses a tree that draws below its
  // dialog, and around its own drawing (the one engine node a tree must hold).
  // The dialog's props are untouched; should this tree be refused, the engine
  // draws the dialog alone.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const drawn = await next(e)
    const l = await ensureLanguage($)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Button key={ASK_OPEN_KEY} label={MESSAGES[l].askOpen} onPress={async () => openPanes($, l, 'picker', await pickedNow($), true)} />
        </Box>
        {drawn}
      </Box>
    )
  })
}
