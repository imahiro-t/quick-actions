import { atom, read, update } from 'claude-code'
import type { ButtonProps, ElementConstructor, EngineInterface, PaneCloseOrigin, PromptOrigin, Register, RenderSurface, TextProps } from 'claude-code'

import type { ArgInput, Result, ResultOrigin } from '../types'
import {
  ACTIONS,
  DEFAULT_ACTION_IDS,
  NO_INPUT,
  PLUGIN,
  READ_ONLY_TOOLS,
  TICKER_LIMIT,
  argSpecOf,
  findAction,
  isContext,
  isStandalone,
  markedIcon,
  emojiIcon,
  messageOf,
  needsSelection,
  resolveAll,
  subagentType,
  takesArg,
  wrap,
  wrapInput,
} from './actions'
import type { ActionDef, ActionSpec, ExecAction, LocalAction, LocalEffect, ResolvedSubagentAction } from './actions'
import { formatClock, parseArg, splitCommandArgs, utcLabel } from './args'
import type { ArgSpec, ArgValue } from './args'
import { kindOfTarget } from './catalog'
import { definitionIndex, displaySafe, parseCustomActions, problemFor, problemLine, reasonText, warningLine, withNotices } from './custom'
import type { CustomProblem, CustomReason } from './custom'
import {
  APPROVALS_KEY,
  EXEC_ADMIN_ARG,
  EXEC_CONCURRENT_MAX,
  EXEC_FILE_MAX,
  EXEC_SLOT_GRACE_MS,
  EXEC_STDIN_MAX,
  HISTORY_KEY,
  HOME_SOURCES,
  NO_GATE,
  allowlistOf,
  allowlistPath,
  allowlistPlace,
  appendHistory,
  approvalQuestion,
  approvalsListText,
  buildInvocation,
  conversationInput,
  execFailureText,
  execOutputText,
  fromName,
  gateAll,
  hashOf,
  historyEntry,
  isTimeout,
  liveSlots,
  locate,
  originRestricted,
  parseApprovals,
  parseHistory,
  pathShown,
  releaseSlot,
  sameApproval,
  scopeVerdict,
  takeSlot,
  unexpected,
  usableHome,
  utf8Length,
  weakensExecOrigin,
} from './exec'
import type { Allowlist, ExecApproval, ExecGateResult, ExecHistoryEntry, ExecHostEnv, Located, StatSeen } from './exec'
import { filterActions } from './filter'
import { MESSAGES, answerStyle, explicitLanguage, resolveLanguage } from './i18n'
import type { Lang } from './i18n'
import { localInputFor, runLocal, tickerStep, truncate } from './local'
import { quoteLine, showHiddenNoted } from './selection-local'
import type { Frame } from './local'
import { pagerWidest, pickerKindLabels, pickerKindsShown, pickerPages } from './picker-rows'
import { TIP_RESERVE, buttonWidth, dockGivenBack, dockReturn, hintLayout, hintLineColumns, hintMost, isStaleDock, leadFor } from './hint-width'
import type { DockMeasure } from './hint-width'
import {
  HINT_KINDS,
  USAGE_KEY,
  arrange,
  defaultsLead,
  hintKindFor,
  ofKind,
  orderActions,
  parsePins,
  parseUsage,
  pickerKindFor,
  pickerList,
  pickerOrder,
  recordUse,
  settleIn,
} from './order'
import type { HintKind, OrderSlot } from './order'
import { paneStyle, parsePaneTheme } from './palette'
import { nextEntryId } from './entries'
import type { PaneStyle } from './palette'
import { random, randomBytes } from './random'
import { ARG_KEY, FILTER_KEY, toArgField, toFilterField } from './focus'
import { settleQuietly, toLatest, toRow } from './scroll'
import {
  OPEN_TIMEOUT_MS,
  attemptOfExit,
  attemptOfRejection,
  copyResultText,
  copyTextOf,
  openCommandFor,
  openResultText,
  openSucceeded,
} from './url-local'
import type { OpenAttempt, Platform } from './url-local'

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
const PICKER_CLOSE_KEY = '_picker-close'
// The Box the list is drawn in, keyed by how many it lists as well (see the dialog).
const PICKER_LIST_KEY = '_picker-list'
/** Each row of the ⋯ dialog's list is a Box keyed by this and the action's ID. */
const PICKER_ROW_KEY = '_picker-row'
// The hint line's Box of the actions, the one part of the row that shrinks.
const HINT_ACTIONS_KEY = '_hint-actions'
// The flexShrink of that Box of the actions.
const ACTIONS_SHRINK = 1
// The flexShrink of a hover label's Box: a hundred times ACTIONS_SHRINK, so
// where the row runs short a label shown shrinks first, all but wholly, and
// the actions stay as laid out.
const TIP_SHRINK = 100
// The dialog's filter field, and the button beside it that empties it.
const PICKER_FILTER_KEY = FILTER_KEY
const PICKER_FILTER_CLEAR_KEY = '_filter-clear'
// The most candidates an unknown ID is answered with.
const CANDIDATES = 10
// The ⋯ dialog's rows at most: past them, the pane scrolls.
const PICKER_MAX_ROWS = 30
// The hint line's kind buttons, one per kind (./order).
const kindKey = (kind: HintKind) => `_kind-${kind}`
// The ⋯ dialog's kind buttons above its list, one per kind.
const PICKER_KIND_KEY = '_picker-kind'
const pickerKindKey = (kind: HintKind | 'all') => `${PICKER_KIND_KEY}-${kind}`
// The ⋯ dialog's page buttons under a list longer than the pane holds.
const PICKER_PREV_KEY = '_picker-prev'
const PICKER_NEXT_KEY = '_picker-next'
// The stop button of a run over time in the result pane, one per entry.
const stopKey = (id: number) => `_stop-${id}`
// The button of an entry run on a selection that lies in one transcript row:
// back to that row. One per entry.
const gotoKey = (id: number) => `_goto-${id}`
// A timer's (or the like's) buttons once it no longer runs: again with the
// same argument, and the argument screen.
const againKey = (id: number) => `_again-${id}`
const setArgKey = (id: number) => `_set-arg-${id}`
// The ⋯ dialog's argument screen: its field, and the button back to the list.
const PICKER_ARG_KEY = ARG_KEY
const PICKER_ARG_BACK_KEY = '_arg-back'

/**
 * Whether an Input can be drawn here: everywhere the surface's table has one
 * but the mobile app. Without it, the argument screen is never shown and an
 * action that takes an argument runs at once with its default, as before.
 * A type guard, so where it holds the table's Input can be taken as it is.
 */
const canInput = <T extends object>(surface: RenderSurface, elements: T): elements is Extract<T, { Input: unknown }> =>
  surface !== 'mobile' && 'Input' in elements

// The colours of the result pane and the ⋯ dialog (the `paneTheme` setting)
// are worked out in ./palette, why they are as they are included. These two
// add no prop at all where the style leaves it to core (auto, inline), so
// those draw exactly as they always have.

/** The Box props that paint the style's background: none when it has none. */
const painted = (style: PaneStyle) => (style.background === undefined ? {} : { backgroundColor: style.background })

/**
 * The Text props of a secondary text: dimColor as before (auto, docked), the
 * palette's muted colour, or none, the terminal's foreground (inline).
 */
const muted = (style: PaneStyle) =>
  style.dimMuted ? { dimColor: true } : style.muted === undefined ? {} : { color: style.muted }

/**
 * A button of the result pane or the ⋯ dialog (stop, again, back, close, ...):
 * as it always was, in the surface's own colour; with a palette, its label a
 * child Text in the palette's muted colour (a Button's own label takes no
 * colour). One asked `dim` (the ⋯ dialog's close) is dimColor where core
 * paints the theme's background behind it (auto, docked: `dimMuted`), and in
 * the terminal's foreground inline, where nothing does and the theme's
 * `inactive` falls to about 2.9:1 (see ./palette).
 *
 * With a `name`, the button still draws its `label` (as a child, a string or
 * the muted Text) and is named `name` instead: the Button's label is then its
 * accessible name (what a desktop's native button and assistive tech read),
 * and the drawing is left as it was. Its address stays `key`.
 */
const mutedButton = (
  { Button, Text }: { Button: ElementConstructor<ButtonProps>; Text: ElementConstructor<TextProps> },
  style: PaneStyle,
  key: string,
  { name, ...props }: ButtonProps & { label: string; name?: string },
  dim = false,
) => {
  const dimmed = dim && style.dimMuted
  if (name === undefined) {
    return style.background !== undefined ? (
      <Button key={key} {...props}>
        <Text color={style.muted}>{props.label}</Text>
      </Button>
    ) : (
      <Button key={key} {...props} {...(dimmed && { dimColor: true })} />
    )
  }
  return style.background !== undefined ? (
    <Button key={key} {...props} label={name}>
      <Text color={style.muted}>{props.label}</Text>
    </Button>
  ) : (
    <Button key={key} {...props} label={name} {...(dimmed && { dimColor: true })}>
      {props.label}
    </Button>
  )
}

// The engine reads these references statically before the module runs, so
// `plugin` has to be the string literal itself: PLUGIN cannot stand in here.
// types/index.d.ts types these keys under the same name, so a drift fails tsc.
const selection = atom({ plugin: 'quick-actions', key: 'selection' } as const, null)
const dismissed = atom({ plugin: 'quick-actions', key: 'dismissed' } as const, null)
const results = atom({ plugin: 'quick-actions', key: 'results' } as const, [])
const picking = atom({ plugin: 'quick-actions', key: 'picking' } as const, null)
const hint = atom({ plugin: 'quick-actions', key: 'hint' } as const, null)
const hintKind = atom({ plugin: 'quick-actions', key: 'hintKind' } as const, null)
const asking = atom({ plugin: 'quick-actions', key: 'asking' } as const, 0)
// The exec actions running now, a slot each (./exec takeSlot): kept with the
// session rather than in the module, so a reload (an option changed) does not
// forget the runs still going.
const execSlots = atom({ plugin: 'quick-actions', key: 'execSlots' } as const, [])

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

// Every subagent is registered without the CLAUDE.md block (the person's, the
// project's, the rules): its prompt and the selection or argument are all it
// works from. With CLAUDE.md in its context, instructions hidden in the
// selection could have a web subagent put what CLAUDE.md says (an address,
// internal names) into a search query or a URL it fetches.
async function ensureAgent($: EngineInterface, def: ResolvedSubagentAction) {
  if (registeredAgents.has(def.id)) return
  await $.agent.register({
    name: def.id,
    description: def.description,
    prompt: def.prompt,
    tools: [...(def.tools ?? READ_ONLY_TOOLS)],
    model: def.model,
    omitClaudeMd: true,
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

// What a use written calls: the load's settled order let go, so the next
// drawing settles it afresh from the scores as they now stand. Set by register.
let usageRecorded: () => void = () => {}

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
    usageRecorded()
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
  // Nothing awaited between the check and the set, so the limit holds. Over
  // it, the entry is marked `timed` and failed in one write, so the pane
  // offers it again (see Result's `timed`) and never draws it running in
  // between.
  if (tickers.size >= TICKER_LIMIT) {
    const text = t.tickerLimit(TICKER_LIMIT)
    await update($, results, list =>
      list.map(r => (r.id === id ? { ...r, timed: true as const, status: 'failed' as const, text } : r)),
    )
    return
  }
  // In the map before the entry is marked `timed`: the pane draws an entry
  // marked `timed` with no run in the map as one a reload stopped, so the
  // mark must never be seen before the run is there.
  const ticker: Ticker = { cancel: () => {}, startedAt: now, lastText: undefined }
  tickers.set(id, ticker)
  // Marked before anything below can end it, so the pane offers it again
  // however it ends.
  await update($, results, list => list.map(r => (r.id === id ? { ...r, timed: true as const } : r)))
  // Stopped while it was being marked (the pane closed meanwhile): whoever
  // stopped it settled the entry, and no period is set.
  if (tickers.get(id) !== ticker) return
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
async function runLocalAction(
  $: EngineInterface,
  def: LocalAction,
  lang: Lang,
  id: number,
  src: { text?: string; arg?: ArgValue },
  surface?: RenderSurface,
) {
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
  if (outcome.kind === 'effect') {
    await runEffect($, lang, id, outcome.effect, surface)
    return
  }
  await startTicker($, lang, id, def.label, now, outcome)
}

/**
 * A local action's effect on entry `id` (open-urls, copy-urls), carried out
 * here through `$` and settled with what came of it, worded by ./url-local.
 * Never leaves the entry running: whatever throws settles it failed.
 */
async function runEffect($: EngineInterface, lang: Lang, id: number, effect: LocalEffect, surface: RenderSurface | undefined) {
  try {
    if (effect.kind === 'copy') {
      await copyEffect($, lang, id, effect, surface)
      return
    }
    const platform = await platformOf($)
    const attempts: OpenAttempt[] = []
    // One at a time, so the browser's tabs come in the order of the selection.
    for (const url of effect.urls) attempts.push(await openOne($, platform, url))
    await settle($, id, openSucceeded(attempts), truncate(openResultText(lang, attempts, effect.skipped, effect.withheld), lang))
  } catch (err) {
    await settle($, id, false, MESSAGES[lang].failed(messageOf(err)))
  }
}

/** copy-urls: the URLs on the clipboard of `surface` (the session's first when it is not known), one per line. */
async function copyEffect($: EngineInterface, lang: Lang, id: number, effect: Extract<LocalEffect, { kind: 'copy' }>, surface: RenderSurface | undefined) {
  const text = copyTextOf(effect)
  try {
    const r = await $.ui.copy(surface === undefined ? { text } : { text, surface })
    const shown = r.isCopied ? copyResultText(lang, effect.urls) : copyResultText(lang, effect.urls, { reason: r.reason })
    await settle($, id, r.isCopied, truncate(shown, lang))
  } catch (err) {
    await settle($, id, false, truncate(copyResultText(lang, effect.urls, { thrown: messageOf(err) }), lang))
  }
}

/**
 * One URL handed to the OS's default handler (openCommandFor), and what came
 * of it: the command's exit code, or, rejected, whether that was the timeout
 * (OPEN_TIMEOUT_MS) or a command that could not start.
 */
async function openOne($: EngineInterface, platform: Platform, url: string): Promise<OpenAttempt> {
  const startedAt = await readQuietly($.clock.now())
  try {
    const r = await $.process.run(openCommandFor(platform, url), { timeoutMs: OPEN_TIMEOUT_MS })
    return attemptOfExit(platform, url, r.exitCode)
  } catch (err) {
    const endedAt = await readQuietly($.clock.now())
    const elapsed = startedAt === undefined || endedAt === undefined ? 0 : endedAt - startedAt
    return attemptOfRejection(url, messageOf(err), elapsed)
  }
}

// The OS: there is no API that says it, so `OS` (Windows_NT on Windows), then
// `uname -s` (Darwin on macOS, anything else Linux and the like). Kept for the
// module load only once it is known for sure: OS=Windows_NT, or uname
// answering with 0. uname failing (timed out, rejected, another exit code) is
// taken for Linux for that run alone, and asked again on the next, so a
// moment's trouble on the first run never leaves macOS read as Linux.
let knownPlatform: Platform | undefined
let pendingPlatform: Promise<Platform> | undefined

function platformOf($: EngineInterface): Promise<Platform> {
  if (knownPlatform !== undefined) return Promise.resolve(knownPlatform)
  // Runs at the same time share one detection; once it ends, the next asks afresh unless it was sure.
  pendingPlatform ??= detectPlatform($).finally(() => {
    pendingPlatform = undefined
  })
  return pendingPlatform
}

async function detectPlatform($: EngineInterface): Promise<Platform> {
  if ((await readQuietly($.env.get('OS'))) === 'Windows_NT') return (knownPlatform = 'win32')
  const uname = await readQuietly($.process.run(['uname', '-s'], { timeoutMs: OPEN_TIMEOUT_MS }))
  if (uname === undefined || uname.exitCode !== 0) return 'linux'
  return (knownPlatform = uname.stdout.trim() === 'Darwin' ? 'darwin' : 'linux')
}

/** What a new entry says it ran on, and, for a selection in one transcript row, where that lies. */
type EntryHead = Pick<Result, 'target' | 'quote' | 'arg' | 'input' | 'origin'>

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
  if (tickers.size > 0) {
    const kept = new Set((await read($, results)).map(r => r.id))
    for (const running of [...tickers.keys()]) if (!kept.has(running)) endTicker(running)
  }
  // The text the dialog's tab holds while it is up; a tab the engine unloaded
  // unheard holds nothing (openPicking), so a stale text is never run on.
  const open = await openPicking($)
  const held = text ?? (open === null ? await pickedNow($) : open.text === null ? null : pickedOf(open.text, open.requestId))
  // The kind the dialog lists, kept while its tab stays up: a run shows the
  // results, and the dialog behind them is as the person left it.
  await openPanes($, lang, 'results', held, false, undefined, open?.kind)
  // Back to the top, where this newest result is drawn (see ./scroll).
  await settleQuietly($.ui.scroll(toLatest(PANE)))
  return id
}

/**
 * A model call on entry `id`, settled with its answer or why there is none.
 * The answer's hidden characters are escaped here, once, as it is kept
 * (showHiddenNoted; turn.complete does the same for a subagent's): never as
 * it is drawn, nor on a local action's output, which would double its
 * backslashes again.
 */
type ModelAnswer = { isAnswered: true; text: string } | { isAnswered: false; reason: string }
async function complete($: EngineInterface, lang: Lang, id: number, call: () => Promise<ModelAnswer>) {
  const t = MESSAGES[lang]
  try {
    const r = await call()
    await settle($, id, r.isAnswered, r.isAnswered ? showHiddenNoted(r.text.trim(), lang) : t.noAnswer(r.reason))
  } catch (err) {
    // A thrown call must not leave the entry "running" for good.
    await settle($, id, false, t.failed(messageOf(err)))
  }
}

/**
 * Where a run was asked from: the surface its button was pressed on, or the
 * command's origin. Only the person at their own terminal can approve an exec
 * action (canApprove); one asked from anywhere else runs only once approved.
 */
type RunFrom = { surface?: RenderSurface; origin?: PromptOrigin['kind'] }

const fromSurface = (surface: RenderSurface | undefined): RunFrom => (surface === undefined ? {} : { surface })

/** Whether the person can approve an exec action here: a press at the terminal, or the command typed at its prompt. */
const canApprove = (from: RunFrom) => from.surface === 'terminal' || from.origin === 'composer'

/** What the exec gate refused, by action ID, and the problems it tells (the refused definitions, then the allowlist's entries left out). */
type ExecGateView = { rejected: ReadonlyMap<string, CustomReason>; problems: readonly CustomProblem[] }

/**
 * What one load's exec gate checks (its exec definitions, the setting as
 * merged) and where its answer is kept; with the merged `execOrigin`, which
 * each run reads with the user settings (./exec originRestricted).
 */
type ExecLoad = { specs: readonly ExecAction<unknown>[]; setting: unknown; execOrigin: unknown; pending?: Promise<ExecGateView> }

const NO_GATE_VIEW: ExecGateView = { rejected: NO_GATE.rejected, problems: [] }

// The exec gate of the load running now, set by register, as usageRecorded
// is: a run checks it again. Before any load, nothing is exec.
let currentExecLoad: ExecLoad = { specs: [], setting: undefined, execOrigin: undefined }

/** Whether the host is Windows, for the exec gate. Never rejects. */
async function isWindows($: EngineInterface): Promise<boolean> {
  return (await platformOf($)) === 'win32'
}

/** One settings source as loaded; undefined when it cannot be read. */
async function settingsOf($: EngineInterface, source: 'user' | (typeof HOME_SOURCES)[number]) {
  return readQuietly($.settings.read({ source }))
}

/** Where `path` lands (a $.fs.stat with `resolve`); undefined when it cannot be told. */
async function statOf($: EngineInterface, path: string): Promise<StatSeen> {
  return readQuietly($.fs.stat(path, { resolve: true }))
}

/** HOME as it may be used (./exec usableHome). */
async function homeOf($: EngineInterface): Promise<string | undefined> {
  return usableHome(await readQuietly($.env.get('HOME')))
}

/**
 * The allowlist of the home directory (./exec ALLOWLIST_RELATIVE), read now,
 * or why there is none to use (./exec allowlistPlace, allowlistOf).
 */
async function loadAllowlist($: EngineInterface): Promise<Allowlist | CustomReason> {
  const home = await homeOf($)
  if (home === undefined) return { code: 'execAllowlist', why: 'noHome' }
  const file = await statOf($, allowlistPath(home))
  const realHome = (await statOf($, home))?.realPath ?? home
  const roots: (string | undefined)[] = []
  for (const root of [await readQuietly($.session.root()), await readQuietly($.session.cwd())]) {
    roots.push(root === undefined ? undefined : ((await statOf($, root))?.realPath ?? root))
  }
  const place = allowlistPlace(file, realHome, roots)
  if ('code' in place) return place
  return allowlistOf(await readQuietly($.fs.read(place.path)))
}

/** Where `command` lands and its allowlist entry, or why it may not run (./exec locate). */
async function locateExec($: EngineInterface, command: string, entries: Allowlist['entries']): Promise<Located | CustomReason> {
  return locate(command, await statOf($, command), entries)
}

/** The SHA-256 of the executable at `realPath`, of `size` bytes as last seen, or why it cannot be had (./exec hashOf). */
async function hashExec($: EngineInterface, realPath: string, size: number): Promise<string | CustomReason> {
  if (size > EXEC_FILE_MAX) return { code: 'execTooLarge', max: EXEC_FILE_MAX }
  const bytes = await readQuietly($.fs.read(realPath, { as: 'bytes' }))
  return hashOf(realPath, bytes?.base64)
}

/**
 * The exec gate (see ./exec): checked once per load, before an exec action
 * is shown or run. Every exec definition is refused, each with the same
 * reason, on Windows, when the settings say it is not the person's own
 * (scopeVerdict) or when the allowlist cannot be used; else each whose
 * command is not in the allowlist. Never rejects: what throws refuses them all.
 */
async function checkExecGate($: EngineInterface, load: ExecLoad): Promise<ExecGateResult> {
  const ids = load.specs.map(spec => spec.id)
  try {
    if (await isWindows($)) return gateAll(ids, { code: 'execUnsupported' })
    const user = await settingsOf($, 'user')
    const others = []
    for (const source of HOME_SOURCES) others.push(await settingsOf($, source))
    const scope = scopeVerdict(user, others, load.setting, PLUGIN)
    if (scope !== undefined) return gateAll(ids, scope)
    const list = await loadAllowlist($)
    if ('code' in list) return gateAll(ids, list)
    const rejected = new Map<string, CustomReason>()
    for (const spec of load.specs) {
      const located = await locateExec($, spec.command, list.entries)
      if ('code' in located) rejected.set(spec.id, located)
    }
    return { rejected, ignoredEntries: list.ignored }
  } catch (err) {
    return gateAll(ids, unexpected(err))
  }
}

/**
 * The exec gate of `load` (./exec checkExecGate), checked the first time it
 * is asked for and shared by every later or concurrent ask, as the order is.
 * With no exec definition it reads nothing and is settled at once. Never rejects.
 */
async function ensureExecGate($: EngineInterface, load: ExecLoad): Promise<ExecGateView> {
  if (load.specs.length === 0) return NO_GATE_VIEW
  load.pending ??= gateOf($, load)
  return load.pending
}

async function gateOf($: EngineInterface, load: ExecLoad): Promise<ExecGateView> {
  const gate = await checkExecGate($, load)
  return {
    rejected: gate.rejected,
    problems: [
      ...[...gate.rejected].map(([id, reason]) => ({ index: definitionIndex(load.setting, id), id, reason })),
      ...gate.ignoredEntries.map(entry => ({ index: null, id: null, reason: { code: 'execAllowlistEntry' as const, entry } })),
    ],
  }
}

// The approvals and the history are read, changed and written back one at a
// time, as the usage scores are, so two approved, run or revoked close
// together never lose one.
let execStoreWrite: Promise<unknown> = Promise.resolve()

/** `work` run after every earlier one of the queue: what it resolves to, or undefined when it rejected. Never rejects. */
function inExecStoreQueue<T>(work: () => Promise<T>): Promise<T | undefined> {
  const done = execStoreWrite.then(work).catch(() => undefined)
  execStoreWrite = done
  return done
}

/** Keeps `approval` for the action `id` in $.store. Never rejects: unsaved, it is asked again next time. */
async function saveApproval($: EngineInterface, id: string, approval: ExecApproval): Promise<void> {
  // Not kept: the next run asks again.
  await inExecStoreQueue(async () => {
    const kept = parseApprovals(await $.store.get(APPROVALS_KEY))
    await $.store.set(APPROVALS_KEY, { ...kept, [id]: { path: approval.path, args: [...approval.args], sha256: approval.sha256 } })
  })
}

/** Adds one run to the history in $.store (./exec appendHistory). Never rejects: unsaved, it is simply not listed. */
async function recordRun($: EngineInterface, entry: ExecHistoryEntry): Promise<void> {
  await inExecStoreQueue(async () => {
    await $.store.set(HISTORY_KEY, appendHistory(parseHistory(await $.store.get(HISTORY_KEY)), entry))
  })
}

/**
 * Removes the approval of the action `id` from $.store, or every approval
 * (`id` null): how many were removed; undefined when the store could not be
 * read or written. A run after that asks again (sameApproval fails).
 */
async function revokeApprovals($: EngineInterface, id: string | null): Promise<number | undefined> {
  return inExecStoreQueue(async () => {
    const kept = parseApprovals(await $.store.get(APPROVALS_KEY))
    if (id === null) {
      await $.store.set(APPROVALS_KEY, {})
      return Object.keys(kept).length
    }
    if (!Object.prototype.hasOwnProperty.call(kept, id)) return 0
    const { [id]: _gone, ...rest } = kept
    await $.store.set(APPROVALS_KEY, rest)
    return 1
  })
}

/** A config.set that would take execOrigin off `terminal` from other than the person (./exec weakensExecOrigin): its refusal; else undefined. */
async function execOriginGuard($: EngineInterface, e: { key: string; value: unknown; origin: { kind: string } }): Promise<{ deny: string } | undefined> {
  if (!weakensExecOrigin(e, PLUGIN)) return undefined
  return { deny: MESSAGES[await ensureLanguage($)].execOriginConfigDenied }
}

/** Whether exec actions are kept to the person's own hand now (./exec originRestricted), the user settings read afresh. */
async function execOriginRestricted($: EngineInterface, load: ExecLoad): Promise<boolean> {
  return originRestricted(await settingsOf($, 'user'), load.execOrigin, PLUGIN)
}

/**
 * `/quick-actions exec-approvals [revoke <id> | revoke --all]`: with no
 * argument, the approvals and the history (./exec approvalsListText), shown
 * only to the person's own hand while execOrigin is on, since they tell what
 * runs; `revoke` from anywhere, as it only takes away. Anything else: how to
 * write it, nothing changed.
 */
async function execAdmin($: EngineInterface, l: Lang, arg: string | undefined, from: RunFrom, load: ExecLoad): Promise<string> {
  const t = MESSAGES[l]
  if (arg === undefined) {
    const restricted = await execOriginRestricted($, load)
    if (restricted && !canApprove(from)) return reasonText({ code: 'execOrigin' }, l)
    const approvals = parseApprovals(await readQuietly($.store.get(APPROVALS_KEY)))
    const history = parseHistory(await readQuietly($.store.get(HISTORY_KEY)))
    return approvalsListText(l, approvals, history, restricted, utcOffsetMinutes)
  }
  const words = arg.split(/\s+/)
  if (words.length !== 2 || words[0]!.toLowerCase() !== 'revoke') return t.execAdminBadArgs(displaySafe(arg))
  const target = words[1]!
  if (target === '--all') {
    const count = await revokeApprovals($, null)
    return count === undefined ? t.execAdminFailed : t.execAdminRevokedAll(count)
  }
  // Action IDs are lowercase, as the command takes them.
  const id = target.toLowerCase()
  const shown = displaySafe(id)
  const count = await revokeApprovals($, id)
  if (count === undefined) return t.execAdminFailed
  return count === 0 ? t.execAdminNotApproved(shown) : t.execAdminRevoked(shown)
}

/** What an exec action works on: the selected text, the conversation (read as it starts) or a standalone one's argument. */
type ExecInput = { target: 'selection'; text: string } | { target: 'context' } | { target: 'none'; arg: string }

/** What an exec action may run as, its checks through: where its command lands, that file's size and its SHA-256. */
type ExecReady = { realPath: string; size: number; sha256: string }

/**
 * Every check before an exec action runs, in order, the first that fails its
 * reason: not Windows; not refused by this load's gate; asked from the
 * person's own hand, when execOrigin says so; the allowlist read
 * again and the command's landing path in it; that file's SHA-256 the
 * entry's, when it has one; and approved for that path, those arguments and
 * that SHA-256 (asked now, at the person's terminal alone, when it is not).
 */
async function prepareExec($: EngineInterface, def: ExecAction, lang: Lang, from: RunFrom): Promise<ExecReady | CustomReason> {
  if (await isWindows($)) return { code: 'execUnsupported' }
  const gated = (await ensureExecGate($, currentExecLoad)).rejected.get(def.id)
  if (gated !== undefined) return gated
  // Approved or not, only from the person's own hand while execOrigin is on;
  // read each run, so a change of the user settings counts from the next one.
  if (!canApprove(from) && (await execOriginRestricted($, currentExecLoad))) return { code: 'execOrigin' }
  const list = await loadAllowlist($)
  if ('code' in list) return list
  const located = await locateExec($, def.command, list.entries)
  if ('code' in located) return located
  const hash = await hashExec($, located.realPath, located.size)
  if (typeof hash !== 'string') return hash
  if (located.entry.sha256 !== undefined && located.entry.sha256 !== hash) return { code: 'execHashMismatch', path: pathShown(located.realPath) }
  const wanted: ExecApproval = { path: located.realPath, args: [...def.args], sha256: hash }
  const kept = parseApprovals(await readQuietly($.store.get(APPROVALS_KEY)))[def.id]
  if (!sameApproval(kept, wanted)) {
    if (!canApprove(from)) return { code: 'execRemote' }
    const t = MESSAGES[lang]
    // A cancel, a dismissal, an answer typed under "Other" or a run with no
    // one to ask: all but the approve label itself is no.
    const answer = await readQuietly(
      $.ui.ask(approvalQuestion(lang, def.label, def.id, wanted), { header: t.execApproveHeader, options: [t.execApprove, t.execCancel] }),
    )
    if (answer !== t.execApprove) return { code: 'execDeclined' }
    await saveApproval($, def.id, wanted)
  }
  return { realPath: located.realPath, size: located.size, sha256: hash }
}

/** The host's variables an exec action is given (./exec buildInvocation); undefined with no usable HOME. */
async function hostEnv($: EngineInterface): Promise<ExecHostEnv | undefined> {
  const home = await homeOf($)
  if (home === undefined) return undefined
  const [LANG, LC_ALL, TMPDIR] = await Promise.all([
    readQuietly($.env.get('LANG')),
    readQuietly($.env.get('LC_ALL')),
    readQuietly($.env.get('TMPDIR')),
  ])
  return {
    HOME: home,
    ...(LANG === undefined ? {} : { LANG }),
    ...(LC_ALL === undefined ? {} : { LC_ALL }),
    ...(TMPDIR === undefined ? {} : { TMPDIR }),
  }
}

/** What an exec action's standard input gets, or why it gets nothing: past EXEC_STDIN_MAX (the conversation is cut to fit instead). */
async function execStdin($: EngineInterface, input: ExecInput): Promise<string | CustomReason> {
  if (input.target === 'context') return conversationInput(await $.session.messages())
  const text = input.target === 'selection' ? input.text : input.arg
  return utf8Length(text) > EXEC_STDIN_MAX ? { code: 'execInputTooLarge', max: EXEC_STDIN_MAX } : text
}

/**
 * An exec action (./exec), from any of the three kinds. Its checks and its
 * approval come first, before its entry opens, as the approval's dialog puts
 * the pane away (see the tool.call hook): refused, the entry opens failed,
 * saying why, and a toast says so too. Then a slot of EXEC_CONCURRENT_MAX:
 * none free, refused the same way. Then, right before it starts, its
 * SHA-256 is read again (a change meanwhile is not run), and it runs with no
 * shell, what it works on given on its standard input alone. Exit 0: its
 * output; any other, the code and its standard error; the timeout or a start
 * that failed, said so. Never leaves the entry running.
 */
async function runExec($: EngineInterface, def: ExecAction, lang: Lang, head: EntryHead, picked: Picked | undefined, input: ExecInput, from: RunFrom) {
  const t = MESSAGES[lang]
  const refuse = async (reason: CustomReason, entry?: number) => {
    const why = reasonText(reason, lang)
    const id = entry ?? (await begin($, def, lang, head, picked))
    await settle($, id, false, t.failed(why))
    finishedToast($, t.execRefusedToast(def.label, why))
  }
  let ready: ExecReady | CustomReason
  try {
    ready = await prepareExec($, def, lang, from)
  } catch (err) {
    ready = { code: 'unexpected', detail: displaySafe(messageOf(err)) }
  }
  if ('code' in ready) {
    await refuse(ready)
    return
  }
  // A slot of EXEC_CONCURRENT_MAX, taken once the checks and the approval are
  // through (a dialog waiting holds none) and given back however the run ends.
  const token = await takeExecSlot($, def.timeoutMs)
  if (token === undefined) {
    await refuse({ code: 'execBusy', max: EXEC_CONCURRENT_MAX })
    return
  }
  try {
    await runExecReady($, def, lang, head, picked, input, from, ready, refuse)
  } finally {
    await giveExecSlotBack($, token)
  }
}

// Each slot's token is its own, whatever load took it: a reload starts the
// count again, so the time and a random part keep two apart.
let slotCount = 0

/**
 * Takes a slot for a run of at most `timeoutMs` (./exec takeSlot), those past
 * their time let go first: its token, or undefined when EXEC_CONCURRENT_MAX
 * are held (or the slots could not be read: the safe side).
 */
async function takeExecSlot($: EngineInterface, timeoutMs: number): Promise<string | undefined> {
  const now = await readQuietly($.clock.now())
  const token = `${now ?? 0}-${++slotCount}-${Math.random()}`
  let taken = false
  try {
    // The change may be tried more than once (update writes with ifVersion):
    // the try that was written is the last, so its answer is the one kept.
    await update($, execSlots, slots => {
      const r = takeSlot(slots ?? [], now, token, timeoutMs + EXEC_SLOT_GRACE_MS, EXEC_CONCURRENT_MAX)
      taken = r.taken
      return r.slots
    })
  } catch {
    return undefined
  }
  return taken ? token : undefined
}

/** Gives the slot `token` took back. Never rejects: one not given back is let go at its time (./exec takeSlot). */
async function giveExecSlotBack($: EngineInterface, token: string): Promise<void> {
  try {
    await update($, execSlots, slots => releaseSlot(slots ?? [], token))
  } catch {
    // Let go at its time.
  }
}

/**
 * The run of an exec action whose checks are through (runExec), its slot
 * held: its entry opened, its SHA-256 read again, then run, and kept in the
 * history however it ended once started (recordRun). Never leaves the entry running.
 */
async function runExecReady(
  $: EngineInterface,
  def: ExecAction,
  lang: Lang,
  head: EntryHead,
  picked: Picked | undefined,
  input: ExecInput,
  from: RunFrom,
  ready: ExecReady,
  refuse: (reason: CustomReason, entry?: number) => Promise<void>,
) {
  const t = MESSAGES[lang]
  const id = await begin($, def, lang, head, picked)
  try {
    const hash = await hashExec($, ready.realPath, ready.size)
    if (typeof hash !== 'string') return await refuse(hash, id)
    if (hash !== ready.sha256) return await refuse({ code: 'execChanged' }, id)
    const stdin = await execStdin($, input)
    if (typeof stdin !== 'string') return await refuse(stdin, id)
    const env = await hostEnv($)
    if (env === undefined) return await refuse({ code: 'execAllowlist', why: 'noHome' }, id)
    const invocation = buildInvocation({ realPath: ready.realPath, args: def.args, env, target: input.target, lang, stdin })
    if (invocation === undefined) return await refuse({ code: 'execPath', field: 'realPath', path: pathShown(ready.realPath) }, id)
    const startedAt = await readQuietly($.clock.now())
    // What the history keeps of this run: never what it was given or wrote.
    const record = (result: ExecHistoryEntry['result'], exitCode?: number) =>
      recordRun($, historyEntry({ at: startedAt, id: def.id, realPath: ready.realPath, args: def.args, result, ...(exitCode === undefined ? {} : { exitCode }), from: fromName(from) }))
    let r: Awaited<ReturnType<EngineInterface['process']['run']>>
    try {
      r = await $.process.run(invocation.argv, { cwd: invocation.cwd, stdin: invocation.stdin, timeoutMs: def.timeoutMs })
    } catch (err) {
      const endedAt = await readQuietly($.clock.now())
      const elapsed = startedAt === undefined || endedAt === undefined ? 0 : endedAt - startedAt
      const message = messageOf(err)
      const timedOut = isTimeout(message, elapsed, def.timeoutMs)
      const why = timedOut ? t.execTimeout(Math.round(def.timeoutMs / 1000)) : t.execNotStarted(displaySafe(message))
      await settle($, id, false, t.failed(why))
      await record(timedOut ? 'timeout' : 'notStarted')
      return
    }
    const ok = r.exitCode === 0
    await settle($, id, ok, ok ? execOutputText(r.stdout, r.isStdoutTruncated, lang) : execFailureText(r.exitCode, r.stdout, r.stderr, lang, { stdoutCut: r.isStdoutTruncated, stderrCut: r.isStderrTruncated }))
    await record(ok ? 'ok' : 'exit', ok ? undefined : r.exitCode)
  } catch (err) {
    // A thrown call must not leave the entry "running" for good.
    await settle($, id, false, t.failed(displaySafe(messageOf(err))))
  }
}

// Every way an action on the selection or the conversation runs (an icon, the
// ⋯ dialog, the command) comes here. `text` is the selected text a selection
// action runs on; a context action runs on the conversation and reads none.
// Any run closes the hint line that `/quick-actions hint` opened. A
// standalone action runs through runStandalone instead, which takes no text.
// `requestId` is the transcript row the selection lies in, when the engine
// named one: the entry then keeps it (its origin), to go back to.
async function run($: EngineInterface, def: ActionDef, lang: Lang, text: string, requestId?: string, from: RunFrom = {}) {
  const context = isContext(def)
  const origin: ResultOrigin | undefined = context || requestId === undefined ? undefined : { requestId }
  const head: EntryHead = context
    ? { target: 'context', quote: '' }
    : { target: 'selection', quote: quoteLine(text), ...(origin === undefined ? {} : { origin }) }
  const picked = context ? undefined : pickedOf(text, requestId)
  // An exec action opens its entry itself, once its checks and its approval are through.
  if (def.kind === 'exec') {
    await runExec($, def, lang, head, picked, context ? { target: 'context' } : { target: 'selection', text }, from)
    return
  }
  const id = await begin($, def, lang, head, picked)

  if (def.kind === 'local') {
    await runLocalAction($, def, lang, id, { text }, from.surface)
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

/** A standalone action's argument as given and parsed: `raw` as typed (trimmed), `value` what it came to. */
type GivenArg = { raw: string; value: ArgValue | undefined }

/**
 * An argument as typed (the command's, the argument screen's, the one "again"
 * runs with once more), parsed by `spec` for the action `id`: blank (or none)
 * gives no argument, which runStandalone takes as its default; one that does
 * not parse gives the error the person reads, in the same words wherever it
 * was typed (see invalidArgText), and what was typed, trimmed, which the
 * argument screen keeps to word the error anew in the language of the moment.
 * Never rejects.
 */
async function parseInputArg(
  $: EngineInterface,
  lang: Lang,
  id: string,
  spec: ArgSpec,
  raw: string | undefined,
): Promise<{ ok: true; given: GivenArg | undefined } | { ok: false; typed: string; error: string }> {
  const typed = raw?.trim()
  if (typed === undefined || typed === '') return { ok: true, given: undefined }
  const now = (await readQuietly($.clock.now())) ?? 0
  const parsed = parseArg(spec, typed, { now, utcOffsetMinutes })
  if (!parsed.ok) return { ok: false, typed, error: invalidArgText(lang, id, typed, spec) }
  return { ok: true, given: { raw: typed, value: parsed.value } }
}

/** The error of an argument `typed` (trimmed) that `spec` does not parse, for the action `id`, in `lang`. */
const invalidArgText = (lang: Lang, id: string, typed: string, spec: ArgSpec): string =>
  MESSAGES[lang].invalidArg(id, typed, spec.hint)

/**
 * A standalone action: on neither the selection nor the conversation, so it
 * takes no text, only its argument. `given` is the one the command or the
 * argument screen gave and already parsed (see parseInputArg); with none, the
 * action's default is parsed here. The entry keeps the argument as typed, for
 * "again".
 */
async function runStandalone($: EngineInterface, def: ActionDef, lang: Lang, given?: GivenArg, from: RunFrom = {}) {
  const t = MESSAGES[lang]
  const head: EntryHead = { target: 'none', quote: '', ...(given === undefined ? {} : { arg: quoteLine(given.raw), input: given.raw }) }
  // Its argument as typed is what its standard input gets (none: nothing).
  if (def.kind === 'exec') {
    await runExec($, def, lang, head, undefined, { target: 'none', arg: given?.value === undefined ? '' : String(given.value) }, from)
    return
  }
  const id = await begin($, def, lang, head)

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

async function runOnText($: EngineInterface, def: ActionDef, lang: Lang, picked: Picked, from: RunFrom = {}) {
  // Done with this selection: its icons go until another one is made. The
  // engine keeps answering it after a click elsewhere, so this is what hides them.
  await update($, dismissed, () => picked.text)
  await run($, def, lang, picked.text, picked.requestId, from)
}

/** Runs `def` on the text selected now; false (and a toast saying so) when there is none. */
async function runOnSelection($: EngineInterface, def: ActionDef, lang: Lang, from: RunFrom = {}): Promise<boolean> {
  const picked = await selectedText($, lang)
  if (picked === undefined) return false
  await runOnText($, def, lang, picked, from)
  return true
}

/** A context action: on the conversation, with no selection to read. */
async function runOnConversation($: EngineInterface, def: ActionDef, lang: Lang, from: RunFrom = {}) {
  await run($, def, lang, '', undefined, from)
}

/** The selection now, its text trimmed, with its row; null when there is none. No toast. */
async function pickedNow($: EngineInterface): Promise<Picked | null> {
  const selected = await $.ui.selection()
  const text = selected?.text.trim()
  return text ? pickedOf(text, selected?.requestId) : null
}

/** The ⋯ dialog's state `p` holding `picked`: its text and row, a row it held before left out. */
type Picking = { text: string | null; requestId?: string; filter: string; arg?: ArgInput; kind?: HintKind; page?: number }
function holding(p: Picking, picked: Picked): Picking {
  const { requestId: _held, ...rest } = p
  return { ...rest, text: picked.text, ...(picked.requestId === undefined ? {} : { requestId: picked.requestId }) }
}

/** The ⋯ dialog's state back on its first page: a new filter, kind or pick lists from the top. */
function withoutPage(p: Picking): Picking {
  const { page: _page, ...rest } = p
  return rest
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
 * lies in, so a pick runs on it once the selection goes (a new selection made
 * meanwhile replaces it: see the poll in session.start); every open starts
 * its filter empty and every kind listed, but for `kind`, the kind a run
 * keeps the dialog on while its tab stays up (begin). With `arg` (the hint
 * line, a result's button), the dialog's tab shows that standalone action's
 * argument screen.
 *
 * Each open sets `closeOnEscape` and `rows` anew (PaneOpenArgs), so both tabs
 * are opened with the same options every time, whoever opens them: the title,
 * the width (an open without `columns` resets the dock to its default share),
 * Escape closing them, the inline rows. `focus` alone differs: asked for the
 * tab shown, and only when `focus` says the person asked for it.
 *
 * Should the tab opened last stay behind the other (an open of an id already
 * open retitles it, and need not show it), it is closed and opened afresh,
 * which shows it as long as no tab holds the keys. A tab that holds them (the
 * person typing in the dialog's filter, its list or its argument field) stays
 * shown over a tab opened afresh: the engine shows a new tab only while the
 * keys are at the prompt, and a plugin has no call that shows a tab. So when
 * the tab is still behind after that, both tabs are closed, which hands the
 * keys back to the prompt, and opened afresh in order, the one `show` names
 * last, which then shows. That happens only when a tab holds the keys (a run
 * picked in the dialog), never twice: the hint line, the icons and the
 * command, run from the prompt, are settled by the first reopen or need none.
 */
async function openPanes($: EngineInterface, lang: Lang, show: Shown, held: Picked | null, focus: boolean, arg?: ArgInput, kind?: HintKind) {
  // Not while an AskUserQuestion dialog is up (see the tool.call hook).
  if ((await read($, asking)) > 0) return
  await update($, picking, () => ({
    text: held?.text ?? null,
    ...(held?.requestId === undefined ? {} : { requestId: held.requestId }),
    filter: '',
    ...(arg === undefined ? {} : { arg: { action: arg.action, value: arg.value } }),
    ...(kind === undefined ? {} : { kind }),
  }))
  const options = { closeOnEscape: true as const, rows: paneRows, columns: PANE_COLUMNS }
  const resultsTab = { id: PANE, title: PANE_TITLE, ...options }
  const pickerTab = { id: PICKER, title: MESSAGES[lang].pickerTitle, ...options }
  const [behind, front] = show === 'results' ? [pickerTab, resultsTab] : [resultsTab, pickerTab]
  await $.ui.open(behind)
  const last = focus ? { ...front, focus: true as const } : front
  await $.ui.open(last)
  const panes = await readQuietly($.ui.panes())
  const frontPane = panes?.find(p => p.id === front.id)
  if (frontPane === undefined || !frontPane.isPlaced || frontPane.isShown) return
  await readQuietly($.ui.close({ id: front.id }))
  await $.ui.open(last)
  const reopened = (await readQuietly($.ui.panes()))?.find(p => p.id === front.id)
  if (reopened === undefined || !reopened.isPlaced || reopened.isShown) return
  // Still behind: the other tab holds the keys. Closing both lets go of them
  // (the plugin's own closes, which close no more and go back to no list).
  await readQuietly($.ui.close({ id: front.id }))
  await readQuietly($.ui.close({ id: behind.id }))
  await $.ui.open(behind)
  await $.ui.open(last)
}

// The cells the docked pane last drawn on each surface took off the
// transcript's column (DockMeasure: dockReturn, its body and the rule beside
// it; 0 while drawn inline), this plugin's or another's (SELM-00067), given
// back to that surface's hint line, which is drawn under the dock across the
// terminal's whole width (./hint-width). The dock is one, its panes its tabs,
// so the last drawn holds. On the terminal kept with the viewport it was drawn
// beside: another plugin's pane closes unheard, and a line handed other
// columns drops it (isStaleDock). Absent while this plugin's pane is closed or
// no pane is drawn yet (a reload starts with none). One entry per surface: a
// session may draw on several at once, each seating the pane its own way (a
// terminal docked, a desktop inline), and each hint line gives back its own
// surface's dock alone. Kept in the module, not in the state: a render hook
// may not write the state, and this is what one measures.
const measuredDock = new Map<RenderSurface, DockMeasure>()

/** Whether two measures say the same. */
const sameDock = (a: DockMeasure | undefined, b: DockMeasure) => a !== undefined && a.dock === b.dock && a.viewport === b.viewport && a.own === b.own

/**
 * Notes the width a pane took off the transcript's column on `surface`, as it
 * is drawn there: docked, its body and the rule beside it; inline, none; with
 * the viewport's columns it was drawn beside on the terminal (the only
 * surface where that was seen to be the transcript's column; elsewhere none,
 * and only this plugin's pane is measured there). `own`: this plugin's pane,
 * `isOpen` its tabs open. On a change the plugin's drawings are asked again, so
 * that surface's hint line follows it (the panes' own redraws then find it
 * unchanged, and ask nothing more). Each surface writes its own entry alone,
 * so two seating the pane differently never undo each other's: the redraws settle.
 */
function noteDock($: EngineInterface, e: { surface: RenderSurface; viewport?: { columns: number }; props: { placement: 'dock' | 'inline'; bodyColumns: number } }, own: boolean, isOpen = true) {
  const surface = e.surface
  // A drawing of this plugin's pane after closeAll (the state it cleared
  // redraws the pane before it goes) measures nothing: the pane is on its way
  // out. Another plugin's measure stays.
  if (!isOpen) {
    if (measuredDock.get(surface)?.own === true) measuredDock.delete(surface)
    return
  }
  const viewport = surface === 'terminal' ? e.viewport?.columns : undefined
  const measure: DockMeasure = { dock: e.props.placement === 'dock' ? dockReturn(e.props.bodyColumns) : 0, own, ...(viewport === undefined ? {} : { viewport }) }
  if (sameDock(measuredDock.get(surface), measure)) return
  measuredDock.set(surface, measure)
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The hint line takes the width at its next drawing.
  }
}

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
  // This plugin's dock goes; another plugin's, measured, stays.
  for (const [surface, measure] of measuredDock) if (measure.own) measuredDock.delete(surface)
  for (const id of [PICKER, PANE]) {
    if (id !== closing) await readQuietly($.ui.close({ id }))
  }
}

/**
 * From the argument screen back to the list (its Back button, Escape): the
 * screen goes, the text and the filter stay, and the focus ring is asked back
 * on the filter field. Escape hands the keyboard back to the prompt as it
 * closes, so without that the list would not hold the keys; refused, the list
 * is shown regardless, and still answers a click.
 */
async function backToList($: EngineInterface) {
  await update($, picking, p => {
    if (p === null) return p
    const { arg: _arg, ...list } = p
    return list
  })
  await settleQuietly($.ui.focus(toFilterField(PICKER)))
}

/**
 * Whether a close of the ⋯ dialog goes back to its list instead: the person's
 * (Escape, the close mark) while the argument screen shows. Any other close
 * (the plugin's own, the engine's unload) or one from the list goes on as
 * closesWhole says.
 */
export const closeGoesBack = (state: { text: string | null; requestId?: string; filter: string; arg?: ArgInput } | null, origin: PaneCloseOrigin): boolean =>
  origin.kind === 'person' && state !== null && state.arg !== undefined

/**
 * A pick in the ⋯ dialog: runs `def` on the text the dialog opened on; a
 * context action, on the conversation. Either way, that text's icons go, as
 * after a press on them. The dialog's tab stays, its filter emptied, its text
 * kept; the run shows the results' tab (begin). An action that takes an
 * argument, where an Input can be drawn (`input`), runs nothing yet: the
 * dialog's tab turns to its argument screen.
 */
async function pick($: EngineInterface, lang: Lang, def: ActionDef | undefined, input: boolean, surface?: RenderSurface) {
  if (def !== undefined && input && takesArg(def)) {
    await update($, picking, p => (p === null ? p : { ...p, arg: { action: def.id, value: '' } }))
    // The list it was picked in is gone: the field takes the focus ring.
    await settleQuietly($.ui.focus(toArgField(PICKER)))
    return
  }
  const held = await read($, picking)
  const text = held?.text ?? null
  await update($, picking, p => (p === null ? p : { ...withoutPage(p), filter: '' }))
  if (def === undefined) return
  const from = fromSurface(surface)
  // Standalone: run with no argument, the held text neither sent nor needed.
  if (isStandalone(def)) {
    if (text !== null) await update($, dismissed, () => text)
    await runStandalone($, def, lang, undefined, from)
    return
  }
  if (isContext(def)) {
    if (text !== null) await update($, dismissed, () => text)
    await runOnConversation($, def, lang, from)
    return
  }
  if (text === null) {
    $.ui.toast(MESSAGES[lang].noSelection)
    return
  }
  await runOnText($, def, lang, pickedOf(text, held?.requestId), from)
}

export const register: Register = (on, options) => {
  // Options change reloads the module, so reading the settings once here is
  // enough. The custom definitions join the built-ins after them; one that is
  // invalid is left out, with its reason kept in `problems` to show the person.
  const custom = parseCustomActions(options.customActions, [...ACTIONS.map(a => a.id), 'close', HINT_ARG, EXEC_ADMIN_ARG])
  const problems = custom.problems
  const warnings = custom.warnings
  const allSpecs: readonly ActionSpec[] = [...ACTIONS, ...custom.specs]

  // The pins alone are read here: they do not depend on the language.
  const pins = parsePins(allSpecs, options.pinActions)
  // Tall enough for every action in the ⋯ dialog, its kind buttons, its
  // filter field and its close button, with rows to spare, up to
  // PICKER_MAX_ROWS: with hundreds of actions the pane scrolls rather than
  // asks for more rows than there are.
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

  // The order of every action, settled at session start, or by whichever hook
  // needs it first, and settled afresh after each use is written: the order
  // follows the usage during the session too. A line up as a use is written
  // has already been put away by the run (begin), so an icon never moves
  // under the pointer: the new order shows from the next line. Kept with this
  // load, not in the module: a settling an earlier load started (with its own
  // definitions) may finish after a reload, and must not become this load's order.
  const orderLoad: OrderLoad = { specs: allSpecs, pins, slot: {}, defaults: [] }
  usageRecorded = () => {
    orderLoad.slot = {}
  }

  // The exec gate (./exec checkExecGate): whether this load's exec
  // definitions are the person's own and in their allowlist, checked once,
  // by whichever hook needs it first (session.start starts it), and shared
  // by every hook after, as the order is. With no exec definition it reads
  // nothing and is settled at once, so the others draw as they always have.
  // What it refuses is left off the hint line and the ⋯ dialog, and told
  // with the problems of the setting (noticesOf); the run checks it again.
  const execLoad: ExecLoad = {
    specs: custom.specs.flatMap(spec => (spec.kind === 'exec' ? [spec] : [])),
    setting: options.customActions,
    execOrigin: options.execOrigin,
  }
  currentExecLoad = execLoad
  /** The problems and warnings to tell: the setting's, then the gate's. */
  const noticesOf = (gate: ExecGateView) => (gate.problems.length === 0 ? custom : { problems: [...problems, ...gate.problems], warnings })
  /** `list` without what the gate refused. */
  const allowed = <D extends { id: string }>(gate: ExecGateView, list: readonly D[]): D[] =>
    gate.rejected.size === 0 ? [...list] : list.filter(d => !gate.rejected.has(d.id))

  // Kept here, with this load's settings, rather than in a module-level cache
  // like actionsFor's: the custom definitions change with the setting, and
  // nothing from an earlier load may linger should the module be reused.
  const resolvedDefs: Partial<Record<Lang, readonly ActionDef[]>> = {}
  const defsFor = (l: Lang): readonly ActionDef[] => (resolvedDefs[l] ??= resolveAll(allSpecs, l))

  /** Every action in the settled order, resolved for the language: the ⋯ dialog's list; its first that fit, the hint line's. */
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
    //
    // The ⋯ dialog's tab, while open, follows a new selection: one made with
    // the pane open is what its selection actions run on. A selection's going
    // (the highlight down, a command run) leaves it the text it holds.
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const picked = await pickedNow($)
        const text = picked?.text ?? null
        // Read before the write below, so the change is seen.
        const previous = await read($, selection)
        if (text !== previous) {
          await update($, selection, () => text)
          // A new selection (or none) opens the hint line on its own kind again.
          await update($, hintKind, () => null)
          if (picked !== null) await update($, picking, p => (p === null ? p : holding(p, picked)))
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
    // Warnings alone (a definition kept, allowing something risky) get a toast of their own;
    // with problems as well, the problems' toast stands for both. The exec
    // gate's problems count with the setting's, so the toast waits for it.
    // The slots of runs a session before this one never gave back, past their time, let go.
    const now = await readQuietly($.clock.now())
    try {
      await update($, execSlots, slots => liveSlots(slots ?? [], now))
    } catch {
      // Let go at the next run's taking instead.
    }

    void ensureExecGate($, execLoad)
      .then(gate => {
        const notices = noticesOf(gate)
        const notice =
          notices.problems.length > 0
            ? MESSAGES[l].customIgnoredToast(notices.problems.length, problemLine(notices.problems[0]!, l))
            : notices.warnings.length > 0
              ? MESSAGES[l].customWarningToast(notices.warnings.length, warningLine(notices.warnings[0]!, l))
              : undefined
        if (notice !== undefined) $.ui.toast(notice)
      })
      .catch(() => {
        // The command's result still lists them.
      })

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
      await settle($, id, ok, ok ? showHiddenNoted(e.answer.trim(), l) : MESSAGES[l].noAnswer(e.reason))
    }

    return next(e)
  })

  // execOrigin taken off `terminal` by other than the person in /config (a
  // plugin's $.config.set, the bridge): refused. A layer of defence alone,
  // which neither a hook of another plugin running first nor a settings file
  // written directly passes through: what holds is that each run reads the
  // user settings (./exec originRestricted).
  // Failed before passing it on (the language not read, say): refused all the same, in English.
  on('config.set', async ($, e, next) => (await execOriginGuard($, e)) ?? next(e)).catch(($, e, next) =>
    next.called ? next(e) : weakensExecOrigin(e, PLUGIN) ? { deny: MESSAGES.en.execOriginConfigDenied } : next(e),
  )

  on('command.run', { command: COMMAND }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    // Not while an AskUserQuestion dialog is up (see the tool.call hook).
    if ((await read($, asking)) > 0) return { text: t.askingUnavailable }
    const gate = await ensureExecGate($, execLoad)
    const notices = noticesOf(gate)
    const from: RunFrom = { origin: e.origin.kind }
    const defs = defsFor(l)
    // The ID (lowercased) and, after the first space, its argument (as written).
    const { id: wanted, arg } = splitCommandArgs(e.args)
    // Without an ID: the ⋯ dialog, on the text selected now (with none, the context and standalone actions).
    if (wanted === '') {
      await openPanes($, l, 'picker', await pickedNow($), true)
      return { text: withNotices(t.pickerOpened, notices, l) }
    }
    // An argument nothing takes: told, and nothing runs (no pane, no use counted).
    const refuse = (id: string, given: string) => ({ text: withNotices(t.argsNotAccepted(id, given), notices, l) })
    // `hint`: the hint line, on the text selected now, held here while the
    // engine still answers it (see the poll in session.start).
    if (wanted === HINT_ARG) {
      if (arg !== undefined) return refuse(wanted, arg)
      const held = await pickedNow($)
      await update($, hint, () => ({ text: held?.text ?? null, ...(held?.requestId === undefined ? {} : { requestId: held.requestId }), armed: false }))
      await update($, hintKind, () => null)
      await update($, dismissed, () => null)
      return { text: withNotices(t.hintOpened, notices, l) }
    }
    // `exec-approvals`: the exec approvals and history listed, or approvals revoked.
    if (wanted === EXEC_ADMIN_ARG) return { text: withNotices(await execAdmin($, l, arg, from, execLoad), notices, l) }
    // An exec action the gate refused is defined, but cannot be run: told as one left out.
    const found = findAction(defs, wanted)
    const def = found === undefined || gate.rejected.has(found.id) ? undefined : found
    // Whatever the result, the custom definitions left out follow it, so this
    // command is where the person can always read why.
    if (def === undefined) {
      // Told once, as the command's result: why its definition was left out,
      // or else up to CANDIDATES actions the ID matches as the ⋯ dialog's
      // filter would (in its order, every kind), never the whole list.
      const ignored = problemFor(notices.problems, wanted)
      if (ignored !== undefined) return { text: withNotices(t.customIgnoredId(wanted, reasonText(ignored.reason, l)), notices, l) }
      const specs = allowed(gate, (await ensureOrder($, orderLoad)).flatMap(id => specById.get(id) ?? []))
      const laidOut = arrange(specs, pins, true, orderLoad.defaults)
      const candidates = filterActions(laidOut, wanted).slice(0, CANDIDATES).map(a => a.id)
      return { text: withNotices(t.unknownId(wanted, candidates), notices, l) }
    }
    if (isStandalone(def)) {
      // The argument is parsed once, here: invalid, it is refused before
      // anything runs; valid, its value is what the run uses.
      let given: GivenArg | undefined
      if (arg !== undefined) {
        const spec = argSpecOf(def)
        if (spec === undefined) return refuse(def.id, arg)
        const parsed = await parseInputArg($, l, def.id, spec, arg)
        if (!parsed.ok) return { text: withNotices(parsed.error, notices, l) }
        given = parsed.given
      }
      // A selection there now is not used: its icons go, as after a press.
      const current = await selectionNow($)
      if (current !== null) await update($, dismissed, () => current)
      await runStandalone($, def, l, given, from)
    } else if (arg !== undefined) {
      return refuse(def.id, arg)
    } else if (isContext(def)) await runOnConversation($, def, l, from)
    else if (!(await runOnSelection($, def, l, from))) return { text: withNotices(t.noSelection, notices, l) }

    return { text: withNotices(t.showing(PANE_TITLE, def.label), notices, l) }
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
  // How many icons: as many as fit in the line's width (the transcript's
  // column, with the docked pane given back, this plugin's or another's: the line runs under it)
  // beside the permission mode the engine draws at the row's left
  // (./hint-width).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // A dock measured beside other columns than this line is handed has since
    // opened, closed or changed, or the terminal resized: dropped at once,
    // before anything is awaited and however the line is drawn (or left to the
    // engine), so a dock closed is not given back should the terminal later
    // come to the columns it was measured beside (./hint-width).
    if (isStaleDock(measuredDock.get(e.surface), e.viewport?.columns)) measuredDock.delete(e.surface)
    if (e.props.isDraft) return next(e)
    // Not while an AskUserQuestion dialog is up (see the tool.call hook).
    if ((await read($, asking)) > 0) return next(e)
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
    // Less what the exec gate refused.
    const ordered = allowed(await ensureExecGate($, execLoad), inOrder(await ensureOrder($, orderLoad), l))
    const candidates = ofKind(arrange(ordered, pins, text !== null, orderLoad.defaults), kind)

    // The line's width: the viewport's columns, which on the terminal are the
    // transcript's column, a docked pane's already off (SELM-00066: 180
    // columns with this plugin's pane docked give a viewport of 123), with the
    // dock given back, since the line runs under it across the whole
    // terminal: a pane opening or closing leaves the line as it was
    // (SELM-00068; another plugin's pane too, SELM-00067). Given back only as
    // measured where a pane was drawn on this surface (noteDock), never assumed
    // before: until then the line is the viewport's alone, narrower than it is
    // for one drawing, never wider. On the terminal only beside the viewport it
    // was measured beside (dockGivenBack). This plugin's only while its tabs are
    // open by the engine's record: a tab unloaded unheard (its drawing threw)
    // leaves its measure behind, given back to nothing.
    const viewport = e.viewport
    // `columns`: the line's less the rest of the row (the mode at its left), what the buttons have.
    let columns: number | undefined
    if (viewport !== undefined) {
      const measure = measuredDock.get(e.surface)
      const ownOpen = measure?.own === true && (await openPicking($)) !== null
      columns = hintLineColumns(viewport.columns, leadFor(e.surface), dockGivenBack(measure, viewport.columns, ownOpen))
    }
    const kindMark = (k: HintKind, compact: boolean) => markedIcon({ icon: compact ? ' ' : t.hintKinds[k], target: k === 'standalone' ? 'none' : k })
    // What each kind button is named, whatever it draws (a desktop's native
    // button and assistive tech read the label, not the drawing): which actions
    // it shows, and, for the one shown now, that it is.
    const kindName = (k: HintKind) => (k === kind ? t.hintKindShown(t.hintKindTips[k]) : t.hintKindTips[k])
    // ✕ and ⋯ always; the kind buttons with their names while enough actions
    // still fit beside them, else as their marks alone (their hover labels say
    // which), else, too narrow even for those, left out (the kind shown stays
    // as it is). Then as many actions as fit (./hint-width hintLayout).
    const ends = buttonWidth('✕') + buttonWidth('⋯')
    const kindsWidth = (compact: boolean) => kinds.reduce((sum, k) => sum + buttonWidth(kindMark(k, compact)), 0)
    // Widths measured for as many as the line could take at most, not every candidate.
    const most = hintMost(columns)
    const layout = hintLayout({
      line: columns,
      kindsLabeled: kindsWidth(false),
      kindsMarks: kindsWidth(true),
      ends,
      widths: candidates.slice(0, most).map(a => buttonWidth(markedIcon(a))),
      // Room after ⋯ for the hover label, fewer actions laid out for it.
      tip: TIP_RESERVE,
    })
    const shownKinds = layout.kinds === 'none' ? [] : kinds
    const kindLabel = (k: HintKind) => kindMark(k, layout.kinds === 'marks')
    const enabled = candidates.slice(0, layout.count)
    // What the row has left beside its buttons, for a hover label: the line's
    // columns less the cells the buttons laid out take (hintLayout's `used`).
    // The label is cut there, so it neither pushes the mode at the row's left
    // nor takes the actions' room (undefined, not measured: it takes what is left).
    const tipColumns = columns === undefined ? undefined : Math.max(0, columns - layout.used)
    const hintElements = $.ui.resolve(e)
    const { Box, Button, Text } = hintElements
    const input = canInput(e.surface, hintElements)

    // A press puts this line away, whichever kind it runs: the selection's
    // icons (dismissed) and the line `hint` opened.
    const press = async (a: ActionDef) => {
      // Standalone taking an argument, where an Input can be drawn: nothing
      // runs yet; the ⋯ dialog opens on its argument screen, holding the text
      // as ⋯ does. The run there puts this line away.
      if (input && takesArg(a)) {
        await openPanes($, l, 'picker', await forPicker(), true, { action: a.id, value: '' })
        return
      }
      // Standalone: run with no argument; the selection (or held text) is not sent.
      const from = fromSurface(e.surface)
      if (isStandalone(a)) {
        if (current !== null) await update($, dismissed, () => current)
        await runStandalone($, a, l, undefined, from)
      } else if (isContext(a)) {
        if (current !== null) await update($, dismissed, () => current)
        await runOnConversation($, a, l, from)
      } else if (current !== null) {
        await runOnSelection($, a, l, from)
      } else if (text !== null) {
        await run($, a, l, text, opened?.requestId, from)
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
    // The hover labels: cut where the row ends rather than wrapped onto another,
    // in the terminal's foreground (nothing paints the line's background, so a
    // theme colour such as `suggestion` falls to about 1.8:1 where the theme
    // and the terminal disagree).
    const tip = (scope: string, label: string) => (
      <Box display="none" flexShrink={TIP_SHRINK} {...(tipColumns === undefined ? {} : { width: tipColumns })} hover={{ scope, display: 'flex' }}>
        <Text wrap="truncate"> {label}</Text>
      </Box>
    )

    // The row's Box has neither flexGrow nor a width: it takes no more than
    // what it holds, the buttons laid out (and a hover label shown), and never
    // grows to push the mode at its left. Each button (each kind button, each
    // action, ✕ and ⋯) is in a Box of its own kept whole (flexShrink 0):
    // squeezed, its `]` would fall onto a second row. The one Box that shrinks
    // and cuts is the actions' (HINT_ACTIONS_KEY, ACTIONS_SHRINK): should the
    // buttons still be more than the row holds, the actions are cut at its
    // end, while the kind buttons, ✕ and ⋯ stay whole, and ⋯ reaches every
    // action. A hover label's Box (its width tipColumns) shrinks with
    // TIP_SHRINK, a hundred times ACTIONS_SHRINK, so where the row runs short
    // the label gives way first and the actions' Box stays as laid out.
    // The kind shown is bold and underlined in the terminal's foreground, as
    // the inline ⋯ dialog's kind listed is: it stands apart by more than bold
    // without a colour of its own.
    return (
      <Box flexDirection="row" overflow="hidden">
        {shownKinds.map(k => (
          <Box key={`act-${kindKey(k)}`} flexShrink={0} hover={{ scope: `tip-kind-${k}` }}>
            {k === kind ? (
              <Button key={kindKey(k)} label={kindName(k)} onPress={() => update($, hintKind, () => k)}>
                <Text bold underline>{kindLabel(k)}</Text>
              </Button>
            ) : (
              <Button key={kindKey(k)} label={kindName(k)} onPress={() => update($, hintKind, () => k)}>
                {kindLabel(k)}
              </Button>
            )}
          </Box>
        ))}
        <Box key={HINT_ACTIONS_KEY} flexDirection="row" flexShrink={ACTIONS_SHRINK} overflow="hidden">
          {enabled.map(a => (
            <Box key={`act-${a.id}`} flexShrink={0} hover={{ scope: `tip-action-${a.id}` }}>
              <Button
                key={a.id}
                label={t.hintActionName(markedIcon(a), a.label, t.hintKindTips[kindOfTarget(a.target)])}
                onPress={() => press(a)}
              >
                {markedIcon(a)}
              </Button>
            </Box>
          ))}
        </Box>
        <Box key="act-close" flexShrink={0} hover={{ scope: 'tip-close' }}>
          <Button
            key="close"
            label={t.hintCloseName}
            role="dismiss"
            onPress={close}
          >
            ✕
          </Button>
        </Box>
        <Box key={`act-${MORE_KEY}`} flexShrink={0} hover={{ scope: 'tip-more' }}>
          <Button
            key={MORE_KEY}
            label={t.hintMoreName}
            onPress={async () => openPanes($, l, 'picker', await forPicker(), true)}
          >
            ⋯
          </Button>
        </Box>
        {shownKinds.map(k => tip(`tip-kind-${k}`, t.hintKindTips[k]))}
        {enabled.map(a => tip(`tip-action-${a.id}`, a.label))}
        {tip('tip-close', t.close)}
        {tip('tip-more', t.allActions)}
      </Box>
    )
  })

  // Every pane's drawing, another plugin's too (a matcher naming no
  // requestId is handed them all: SELM-00067, seen in a pseudo-terminal),
  // measures the dock for the hint line on the terminal (noteDock), and is
  // left as drawn. This plugin's own two are measured where they are drawn
  // (below). Not on the other surfaces: where a desktop docks another
  // plugin's pane, and what its viewport then is, has not been seen, so its
  // line counts as before.
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (e.surface === 'terminal' && e.requestId !== PICKER && e.requestId !== PANE) noteDock($, e, false)
    return next(e)
  })

  // The ⋯ dialog: every action, the most used first (./order pickerOrder: the
  // pins, then by usage score, a tie or an unused one in the order of
  // definition, whatever its kind), as "[icon] label", "<icon> label" or
  // "{icon} label"; opened with no text, the context and standalone actions
  // alone. Above the list, a button per kind, its mark and name ([ ] selection,
  // < > context, { } standalone; the selection's only with text, as on the
  // hint line), lists that kind alone: that button drawn bold while it does,
  // the others dim; pressed again, every kind again. Ahead of them, "all"
  // lists every kind. As the dialog opens it lists every kind, "all" bold.
  // A filter field above the list narrows what it lists as the person types
  // (./filter: ID, labels in both languages, kind names, kind marks), within
  // the kind shown, and Enter in it runs the first action left; Clear beside
  // it, or deleting its text, lists them all again. The field takes the focus
  // as the dialog opens; the focus ring moves on to the list's buttons (Enter
  // runs the one it is on). Escape closes the whole pane through
  // closeOnEscape (both tabs; the filter too, rather than emptying it), as the
  // close button does.
  // Focus is a request the engine refuses while the composer holds text: the
  // list, the kind buttons and the close button still answer a click. The
  // mobile app draws no field: its actions are buttons to tap, every one of
  // them, and no keys.
  //
  // The list is a column of buttons, there from the start (no drop-down to
  // open). With the filter field it fills the pane's height: as many actions
  // as fit (./picker-rows: each button's rows as its label wraps at its words,
  // less the rest of the dialog, the kind buttons' row, the filter row and
  // the close button counted as they wrap too, in a narrow pane onto two rows
  // or more), a page at a time, then the page buttons that reach the rest
  // (back, the page of how many, on; round from either end).
  // It is drawn in a Box keyed by that count, so a terminal shrunk and grown
  // again lists as many as the new height holds. Without the field (mobile)
  // every action is listed on one page, and the pane scrolls.
  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const state = await read($, picking)
    noteDock($, e, true, state !== null)
    // Less what the exec gate refused.
    const gate = await ensureExecGate($, execLoad)
    const all = allowed(gate, inOrder(await ensureOrder($, orderLoad), l))
    const hasSelection = state !== null && state.text !== null
    // The kind listed (undefined: every kind), and what is listed of it in the
    // dialog's order; the filter searches that alone.
    const kind = pickerKindFor(state?.kind, hasSelection)
    const ordered = pickerList(pickerOrder(all, allowed(gate, defsFor(l)), orderLoad.defaults.length > 0), hasSelection, kind)
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const style = paneStyle(paneTheme, e.props.placement)
    const fixed = style.background !== undefined
    // The filter field: wherever an Input is drawn, a palette's dialog included.
    const Input = canInput(e.surface, elements) ? elements.Input : undefined
    const input = Input !== undefined
    const filter = Input === undefined ? '' : (state?.filter ?? '')
    const shown = filterDefs(ordered, filter)
    const kinds = pickerKindsShown(hasSelection)
    const labelOf = (a: ActionDef) => `${markedIcon(a)} ${a.label}`
    // The filter row as drawn below, and so as counted: one set of strings for both.
    const filterRow = {
      label: t.pickerFilterLabel,
      placeholder: t.pickerFilterPlaceholder,
      value: filter,
      submitLabel: shown.length === 0 ? t.pickerFilterSubmitNone : t.pickerFilterSubmit,
      ...(filter !== '' && { clear: t.pickerFilterClear }),
    }
    // As many as the pane's height holds a page (in the dialog's order, so
    // the most used come first), the page buttons under them reaching the
    // rest, as the filter does; without the field (mobile), all of them on
    // one page, the pane scrolling.
    const starts =
      Input === undefined
        ? [0]
        : pickerPages({
            bodyRows: e.props.scroll.bodyRows,
            bodyColumns: e.props.bodyColumns,
            chrome: [],
            filterRow,
            close: t.pickerClose,
            // The kind buttons' row, drawn while the dialog is open alone
            // (not in the redraw as it closes).
            buttons: state === null ? [] : pickerKindLabels(t, hasSelection),
            labels: shown.map(labelOf),
            // Measured at its widest: as many pages as there are actions.
            more: () => pagerWidest(t, shown.length),
          })
    const pages = starts.length
    // The page asked for, kept within what there is (a shorter pane or list).
    const page = Math.min(Math.max(0, state?.page ?? 0), pages - 1)
    const listed = shown.slice(starts[page], starts[page + 1] ?? shown.length)
    // Back or on a page, round from either end.
    const turn = (by: number) => update($, picking, p => (p === null ? p : { ...p, page: (page + by + pages) % pages }))
    // The close button's props; it is drawn dimColor as before where core
    // paints the theme's background (auto, docked), in the terminal's
    // foreground inline, or in the palette's muted colour. It closes the
    // whole pane, both tabs.
    const close = { label: t.pickerClose, role: 'dismiss' as const, onPress: () => closeAll($) }
    const closeButton = mutedButton(elements, style, PICKER_CLOSE_KEY, close, true)

    const setFilter = (value: string) => update($, picking, p => (p === null ? p : { ...withoutPage(p), filter: value }))
    // Enter in the field: the first action its text leaves, worked out from
    // that text rather than the last drawn list, in case a change had not
    // reached the state yet. None left: the dialog stays, with that filter.
    const submit = async (value: string) => {
      const first = filterDefs(ordered, value)[0]
      if (first === undefined) {
        await setFilter(value)
        return
      }
      await pick($, l, first, input, e.surface)
    }
    // A kind button: lists its kind alone, or, pressed while it does, every
    // kind again; ahead of them, "all" lists every kind. Named as the hint
    // line's are (which actions it shows, and, for the one listed now, that it
    // is: bold and dim reach no name). The one listing now (all, as the dialog
    // opens) is drawn bold, in the palette's heading colour where one is
    // painted; the others in the palette's muted colour, as its buttons are.
    // Under auto, docked (core paints the theme's background), the others are
    // dimColor as before. Inline nothing paints the background, so the others
    // keep the terminal's foreground (the theme's `inactive` falls to about
    // 2.9:1 where the theme and the terminal disagree), and the one listing
    // is bold and underlined, also in the foreground, as the hint line's kind
    // shown is: it stands apart by more than bold without a colour of its own,
    // as the theme's accent (`suggestion`) would fall to about 1.8:1 there.
    const switchKind = (k: HintKind | 'all') =>
      update($, picking, p => {
        if (p === null) return p
        const { kind: was, ...rest } = withoutPage(p)
        return k === 'all' || was === k ? rest : { ...rest, kind: k }
      })
    const kindButton = (k: HintKind | 'all') => {
      const drawn = k === 'all' ? t.pickerAll : t.pickerKinds[k]
      const name = k === 'all' ? t.allActions : t.hintKindTips[k]
      const listing = k === 'all' ? kind === undefined : k === kind
      const props = { key: pickerKindKey(k), label: listing ? t.hintKindShown(name) : name, onPress: () => switchKind(k) }
      if (listing) {
        return (
          <Button {...props}>
            <Text bold {...(fixed ? { color: style.heading } : !style.dimMuted && { underline: true })}>{drawn}</Text>
          </Button>
        )
      }
      if (fixed) {
        return (
          <Button {...props}>
            <Text color={style.muted}>{drawn}</Text>
          </Button>
        )
      }
      return (
        <Button {...props} {...(style.dimMuted && { dimColor: true })}>
          {drawn}
        </Button>
      )
    }
    // Clear empties the field and hands the focus ring back to it (see ./focus).
    const clear = {
      label: t.pickerFilterClear,
      onPress: async () => {
        await setFilter('')
        await settleQuietly($.ui.focus(toFilterField(PICKER)))
      },
    }

    // The argument screen of the action picked (or pressed on the hint line,
    // or named by a result's button), in place of the list: its icon and
    // label, how to write the argument, what Enter with the field empty does,
    // the field, and why the last Enter ran nothing. Enter runs it (empty: its
    // default); Back, or Escape (see the ui.close hook), goes to the list.
    const argState = state?.arg
    const argDef = argState === undefined ? undefined : findAction(defsFor(l), argState.action)
    const argSpec = argDef === undefined ? undefined : argSpecOf(argDef)
    if (state !== null && argState !== undefined && argDef !== undefined && argSpec !== undefined && Input !== undefined) {
      const heldText = state.text
      const submitArg = async (value: string) => {
        const parsed = await parseInputArg($, l, argDef.id, argSpec, value)
        if (!parsed.ok) {
          // Nothing runs and no use is counted: the field keeps what was typed.
          // What did not parse is kept, not its error: that is worded as it is
          // drawn, so a change of language rewords it at once.
          await update($, picking, p => (p === null || p.arg === undefined ? p : { ...p, arg: { ...p.arg, value, invalid: parsed.typed } }))
          return
        }
        // Back to the list, the text kept, as after any pick; the run shows the results' tab (begin).
        await update($, picking, p => {
          if (p === null) return p
          const { arg: _arg, ...list } = p
          return { ...list, filter: '' }
        })
        // As any pick of a standalone action: the held text is neither sent nor needed, its icons go.
        if (heldText !== null) await update($, dismissed, () => heldText)
        await runStandalone($, argDef, l, parsed.given, fromSurface(e.surface))
      }
      const back = { label: t.argBack, onPress: () => backToList($) }
      return (
        <Box flexDirection="column" {...painted(style)}>
          <Text bold color={style.heading}>
            {emojiIcon(argDef.icon)} {argDef.label}
          </Text>
          <Text color={style.body}>{argSpec.hint}</Text>
          <Text {...muted(style)}>{argSpec.default === undefined ? t.argNoDefault : t.argDefault(argSpec.default)}</Text>
          <Input
            key={PICKER_ARG_KEY}
            label={t.argFieldLabel}
            placeholder={argSpec.default ?? t.argPlaceholder(argSpec.type)}
            value={argState.value}
            submitLabel={t.argSubmit}
            autoFocus
            onInput={value => {
              void update($, picking, p => (p === null || p.arg === undefined ? p : { ...p, arg: { ...p.arg, value } }))
            }}
            onSubmit={value => {
              void submitArg(value)
            }}
          />
          {argState.invalid !== undefined && (
            <Text color={style.failed}>{invalidArgText(l, argDef.id, argState.invalid, argSpec)}</Text>
          )}
          <Box flexDirection="row">
            {mutedButton(elements, style, PICKER_ARG_BACK_KEY, back)}
            {closeButton}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" {...painted(style)}>
        {state !== null && (
          <Box flexDirection="row" flexWrap="wrap">
            {kindButton('all')}
            {kinds.map(kindButton)}
          </Box>
        )}
        {state !== null && Input !== undefined && (
          <Box flexDirection="row">
            <Input
              key={PICKER_FILTER_KEY}
              label={filterRow.label}
              placeholder={filterRow.placeholder}
              value={filterRow.value}
              submitLabel={filterRow.submitLabel}
              autoFocus
              onInput={value => {
                void setFilter(value)
              }}
              onSubmit={value => {
                void submit(value)
              }}
            />
            {filterRow.clear !== undefined && mutedButton(elements, style, PICKER_FILTER_CLEAR_KEY, clear)}
          </Box>
        )}
        {state === null ? (
          <Text {...muted(style)}>{t.noSelection}</Text>
        ) : shown.length === 0 ? (
          <Text {...muted(style)}>{t.pickerNoMatch}</Text>
        ) : (
          <Box key={`${PICKER_LIST_KEY}-${listed.length}`} flexDirection="column">
            {listed.map((a, i) => {
              const label = labelOf(a)
              const button = { label, onPress: () => pick($, l, a, input, e.surface) }
              // With a palette the label is a child Text in its colour, and,
              // with no filter field to take it, the first takes the focus ring
              // as the dialog takes the keys; otherwise the button is its label.
              // Either way the same text, in a row kept whole (flexShrink 0):
              // a column short of height would squeeze a wrapped label onto
              // fewer rows than it takes, its rows drawn over one another.
              return (
                <Box key={`${PICKER_ROW_KEY}-${a.id}`} flexShrink={0}>
                  {fixed ? (
                    <Button key={a.id} {...button} {...(i === 0 && Input === undefined && { autoFocus: true as const })}>
                      <Text color={style.body}>{label}</Text>
                    </Button>
                  ) : (
                    <Button key={a.id} {...button} />
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        {state !== null && pages > 1 && (
          <Box flexDirection="row" flexWrap="wrap">
            {mutedButton(elements, style, PICKER_PREV_KEY, { label: t.pickerPrev, onPress: () => turn(-1) })}
            <Text {...muted(style)}>{` ${t.pickerPage(page + 1, pages, shown.length)} `}</Text>
            {mutedButton(elements, style, PICKER_NEXT_KEY, { label: t.pickerNext, onPress: () => turn(1) })}
          </Box>
        )}
        {closeButton}
      </Box>
    )
  })

  // The person's close of either tab (Escape through closeOnEscape, the close
  // mark, ctrl+x x) closes the whole pane: the other tab with it, every run
  // over time stopped (its entry done, saying how long it ran), the text the
  // ⋯ dialog held let go; nothing runs. The plugin's own closes (closeAll, a
  // tab reopened to show it) chain nothing, so no close comes back here. On
  // the dialog's argument screen it goes back to the list instead, both tabs
  // left open (answered without next), and the next close closes them.
  for (const id of [PICKER, PANE]) {
    on('ui.close', { id }, async ($, e, next) => {
      if (id === PICKER && closeGoesBack(await read($, picking), e.origin)) {
        await backToList($)
        return { value: undefined }
      }
      if (closesWhole(e.origin)) await closeAll($, id)
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const defs = defsFor(l)
    const paneElements = $.ui.resolve(e)
    const { Box, Text } = paneElements
    const input = canInput(e.surface, paneElements)
    noteDock($, e, true, (await read($, picking)) !== null)
    // The setting's problems with the exec gate's (noticesOf).
    const { problems: shownProblems } = noticesOf(await ensureExecGate($, execLoad))
    const list = await read($, results)
    const style = paneStyle(paneTheme, e.props.placement)
    /** What the entry's heading says it ran on. */
    const onWhat = (r: Result) => {
      const target = r.target ?? (r.quote === '' ? 'context' : 'selection')
      if (target === 'context') return t.onConversation
      if (target === 'none') return r.arg === undefined ? t.standalone : t.quote(r.arg)
      return t.quote(r.quote)
    }
    /** A button of the pane: in the palette's muted colour when it paints one, else the surface's own. */
    const paneButton = (key: string, label: string, onPress: () => unknown, name?: string) =>
      mutedButton(paneElements, style, key, { label, onPress, ...(name !== undefined && { name }) })
    /** What an entry's buttons name it by, as its heading does: the action's icon and label, else its id. */
    const entryName = (r: Result, def: ActionDef | undefined) => (def === undefined ? r.action : `${emojiIcon(def.icon)} ${def.label}`)
    /** The accessible name of an entry's button drawn `label`: that text and the entry's action, so that each entry's are told apart. */
    const entryButton = (r: Result, def: ActionDef | undefined, label: string) => t.entryButtonName(label, entryName(r, def))
    /**
     * Whether the entry ran over time (a frame drawn, or only marked `timed`
     * before its first frame) and its run is gone: a reload ended it, so it
     * is drawn stopped and offered again.
     */
    const orphaned = (r: Result) => (r.ticker === true || r.timed === true) && !tickers.has(r.id)
    /** A running entry: its frame and stop button while it runs over time, stopped once its run is gone (a reload), else the running text. */
    const running = (r: Result, def: ActionDef | undefined) => {
      if (orphaned(r)) return <Text {...muted(style)}>{t.tickerStopped()}</Text>
      if (r.ticker !== true) return <Text {...muted(style)}>{def?.runningText ?? t.thinking}</Text>
      return (
        <Box flexDirection="column">
          <Text color={style.body}>{r.text}</Text>
          {paneButton(stopKey(r.id), t.stop, () => stopTicker($, l, r.id), entryButton(r, def, t.stop))}
        </Box>
      )
    }
    /**
     * The button of an entry run on a selection in one transcript row: back
     * to that row (scrolled to as the answer to the press itself, which is
     * when the engine moves the transcript). The row is left as the engine
     * draws it: nothing marks the selection in it (see ./entries). A refused
     * scroll (the row no longer kept) does nothing. Named, as the entry's
     * other buttons are, with the entry's action (entryButton).
     */
    const marks = (r: Result, def: ActionDef | undefined, origin: ResultOrigin) => (
      <Box flexDirection="row">
        {paneButton(
          gotoKey(r.id),
          t.gotoSelection,
          () => settleQuietly($.ui.scroll(toRow(origin.requestId))),
          entryButton(r, def, t.gotoSelection),
        )}
      </Box>
    )

    /** "Again": a new entry at the top, with the argument the entry ran with (as typed), parsed afresh. */
    const again = async (r: Result, def: ActionDef) => {
      const spec = argSpecOf(def)
      if (spec === undefined || r.input === undefined) {
        await runStandalone($, def, l, undefined, fromSurface(e.surface))
        return
      }
      const parsed = await parseInputArg($, l, def.id, spec, r.input)
      if (parsed.ok) {
        await runStandalone($, def, l, parsed.given, fromSurface(e.surface))
        return
      }
      // Not expected (it parsed once): the new entry fails, saying why.
      const id = await begin($, def, l, { target: 'none', quote: '', arg: quoteLine(r.input), input: r.input })
      await settle($, id, false, parsed.error)
    }
    /**
     * A timer's (or the like's) buttons once it no longer runs (done, failed,
     * stopped, or drawn stopped after a reload): "again", and, for one that
     * takes an argument where an Input can be drawn, the argument screen with
     * the last argument in its field.
     */
    const rerun = (r: Result, def: ActionDef) => {
      const spec = argSpecOf(def)
      // The argument screen on the ⋯ dialog's tab, which keeps the text it holds.
      const setArg = async () => {
        const open = await openPicking($)
        const held = open === null || open.text === null ? null : pickedOf(open.text, open.requestId)
        await openPanes($, l, 'picker', held, true, { action: def.id, value: r.input ?? '' })
      }
      return (
        <Box flexDirection="row">
          {paneButton(againKey(r.id), t.again, () => again(r, def), entryButton(r, def, t.again))}
          {spec !== undefined && input && paneButton(setArgKey(r.id), t.setArg(spec.type), setArg, entryButton(r, def, t.setArg(spec.type)))}
        </Box>
      )
    }
    /** Whether the entry is a timer's (or the like's) that no longer runs: what rerun is drawn for. */
    const idle = (r: Result) => r.status !== 'running' || orphaned(r)

    return (
      <Box flexDirection="column" {...painted(style)}>
        {shownProblems.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color={style.failed}>{t.customProblemsHeading}</Text>
            {shownProblems.map((p, i) => (
              <Text key={String(i)} color={style.failed}>- {problemLine(p, l)}</Text>
            ))}
          </Box>
        )}
        {warnings.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold {...muted(style)}>{t.customWarningsHeading}</Text>
            {warnings.map((w, i) => (
              <Text key={String(i)} {...muted(style)}>- {warningLine(w, l)}</Text>
            ))}
          </Box>
        )}
        {e.props.placement === 'inline' && (
          <Text {...muted(style)}>{t.inlineHint}</Text>
        )}
        {list.length === 0 && (
          <Text {...muted(style)}>{t.emptyPane}</Text>
        )}
        {list.map(r => {
          const def = findAction(defs, r.action)
          return (
            <Box flexDirection="column" marginBottom={1}>
              {/* Bold is the label's alone: a nested Text takes its parent's
                  bold, which would draw the quote as the heading inline. */}
              <Text color={style.heading}>
                <Text bold>{def === undefined ? '•' : emojiIcon(def.icon)} {def?.label ?? r.action}</Text>{' '}
                <Text {...muted(style)}>{onWhat(r)}</Text>
              </Text>
              {r.status === 'running' ? (
                running(r, def)
              ) : (
                <Text color={r.status === 'failed' ? style.failed : style.body}>{r.text}</Text>
              )}
              {r.timed === true && def !== undefined && isStandalone(def) && idle(r) && rerun(r, def)}
              {r.origin !== undefined && marks(r, def, r.origin)}
            </Box>
          )
        })}
      </Box>
    )
  })

  // An AskUserQuestion dialog holds the keys while it is up: the composer is
  // gone, and the engine gives a pane neither the keys nor its tab switch, so
  // Quick Actions is put away meanwhile. The right pane closes, as the
  // person's close does (every run over time stops), and nothing opens it
  // again until the question is answered: the hint line is not drawn and the
  // command runs nothing. Counted while each is up; down again however the
  // call ends. The pane stays closed after.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await update($, asking, n => n + 1)
    await closeAll($)
    try {
      return await next(e)
    } finally {
      await update($, asking, n => Math.max(0, n - 1))
    }
  })
}
