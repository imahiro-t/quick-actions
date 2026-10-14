// What a local action's run decides, as pure functions: what its `compute` is
// handed, what its answer comes to (a result, a failure, or a run over time),
// and each step of a run over time. register.tsx reads the clock, the time
// zone and the randomness, calls these and does what they say through `$`;
// nothing here reaches `$`, so a test checks every case directly, the ones no
// built-in has yet (a local action on the selection) included.

import { LOCAL_SELECTION_LIMIT, LOCAL_TEXT_LIMIT, TICKER_MAX_MS, TICKER_MIN_INTERVAL_MS, messageOf, needsSelection, textOf } from './actions'
import type { LocalAction, LocalEffect, LocalInput, TickerFrame } from './actions'
import type { ArgValue } from './args'
import { displaySafe } from './custom'
import { MESSAGES } from './i18n'
import { RandomUnavailableError } from './random'
import type { Lang } from './i18n'
import { OPEN_URL_LIMIT, isHttpUrl, userInfoHost } from './url-local'

/** What register.tsx gathers for one run: the text or the argument, and the environment's values. */
export type LocalSource = {
  /** The selected text (trimmed), for an action on the selection. */
  text?: string
  /** The parsed argument, for a standalone action. */
  arg?: ArgValue
  now: number
  timeZone: string
  lang: Lang
  utcOffsetMinutes: (ms: number) => number
  random: () => number
  randomBytes: (n: number) => Uint8Array
}

/**
 * The input of `def`'s compute: an action on the selection gets the text and
 * no argument; a standalone one its argument and never the text, whatever was
 * passed, so no selected text can reach it.
 */
export function localInputFor(def: Pick<LocalAction, 'target'>, src: LocalSource): LocalInput {
  const selection = needsSelection(def)
  return {
    text: selection ? src.text : undefined,
    arg: selection ? undefined : src.arg,
    now: src.now,
    timeZone: src.timeZone,
    lang: src.lang,
    utcOffsetMinutes: src.utcOffsetMinutes,
    random: src.random,
    randomBytes: src.randomBytes,
  }
}

/** The frame function of a run over time. */
export type Frame = (now: number) => TickerFrame

/**
 * What a local run comes to: its entry settled now (done or failed, with its
 * text), a run over time to start, or an effect for register.tsx to carry out
 * through `$` (an action on the selection's only), the entry settled with what
 * came of it.
 */
export type LocalOutcome =
  | { kind: 'settle'; ok: boolean; text: string }
  | { kind: 'ticker'; intervalMs: number; frame: Frame }
  | { kind: 'effect'; effect: LocalEffect }

/** A run's period, raised to the shortest allowed (and a period that is no number, to it too). */
export const clampInterval = (ms: number) =>
  Number.isFinite(ms) && ms > TICKER_MIN_INTERVAL_MS ? ms : TICKER_MIN_INTERVAL_MS

/**
 * The first `max` code points of `text` (all of it when it has fewer):
 * `end`, the code unit they end at, and `count`, how many they are. An
 * emoji (a surrogate pair) is one code point and is never split in half;
 * a `max` of 0 or less takes none.
 */
export function codePointPrefix(text: string, max: number): { end: number; count: number } {
  let end = 0
  let count = 0
  for (; end < text.length && count < max; count++) end += (text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1
  return { end, count }
}

/**
 * A result past the limit (`limit` code points, LOCAL_TEXT_LIMIT unless said),
 * cut there and marked as cut. Characters are counted as code points, as a
 * text argument's are, so an emoji is one and is never split in half.
 */
export function truncate(text: string, lang: Lang, limit: number = LOCAL_TEXT_LIMIT): string {
  // No more code points than code units: a text this short is within the limit.
  if (text.length <= limit) return text
  const { end } = codePointPrefix(text, limit)
  return end >= text.length ? text : `${text.slice(0, end)}\n${MESSAGES[lang].truncated}`
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'

const isUrlList = (v: unknown): v is string[] => Array.isArray(v) && v.every(u => typeof u === 'string' && isHttpUrl(u))

const hasUserInfo = (u: string) => userInfoHost(u) !== undefined

/**
 * `v` as an effect when it is one of a known shape, copied (so a getter on it
 * is read once, here): URLs that are all http(s), at least one to act on, and
 * no more than OPEN_URL_LIMIT to open; to open, none with user info among
 * those opened or skipped, and all of the withheld with it. Anything else:
 * undefined.
 */
function effectOf(v: unknown): LocalEffect | undefined {
  if (!isRecord(v)) return undefined
  const urls = v['urls']
  if (!isUrlList(urls) || urls.length === 0) return undefined
  if (v['kind'] === 'copy') return { kind: 'copy', urls: [...urls] }
  if (v['kind'] !== 'open') return undefined
  const skipped = v['skipped']
  const withheld = v['withheld']
  if (urls.length > OPEN_URL_LIMIT || !isUrlList(skipped) || !isUrlList(withheld)) return undefined
  const [opened, passed, held] = [[...urls], [...skipped], [...withheld]]
  if (opened.some(hasUserInfo) || passed.some(hasUserInfo) || !held.every(hasUserInfo)) return undefined
  return { kind: 'open', urls: opened, skipped: passed, withheld: held }
}

/**
 * Runs `def`'s compute on `input`, synchronously, and says what comes of it.
 * A throw, a promise or an answer of no known shape is a failure; so is a run
 * over time asked for by an action on the selection (`selection`), which may
 * only answer at once, and an effect asked for by a standalone one (or one of
 * no known shape: see effectOf). A selection longer than LOCAL_SELECTION_LIMIT (code
 * units of `input.text`, as the caller passes it) is refused before the compute is called, saying
 * how long it is and the limit. `whole`: a text answered is kept whole, not
 * cut at LOCAL_TEXT_LIMIT (a chain's step, whose output is passed on: it cuts
 * only what it shows). Never throws.
 */
export function runLocal(
  def: Pick<LocalAction, 'compute'>,
  input: LocalInput,
  opts: { selection: boolean; lang: Lang; whole?: boolean },
): LocalOutcome {
  const t = MESSAGES[opts.lang]
  const length = typeof input.text === 'string' ? input.text.length : 0
  if (opts.selection && length > LOCAL_SELECTION_LIMIT) {
    return { kind: 'settle', ok: false, text: t.failed(t.selectionTooLong(length, LOCAL_SELECTION_LIMIT)) }
  }
  // The compute's run and the reading of its answer alike: a getter on that
  // answer may throw too.
  try {
    return outcomeOf(def.compute(input), opts.selection, opts.lang, opts.whole === true)
  } catch (err) {
    // No secure random numbers: said in the user's language, not as the error's own English.
    const reason = err instanceof RandomUnavailableError ? t.randomUnavailable : displaySafe(messageOf(err))
    return { kind: 'settle', ok: false, text: t.failed(reason) }
  }
}

function outcomeOf(out: unknown, selection: boolean, lang: Lang, whole: boolean): LocalOutcome {
  const t = MESSAGES[lang]
  if (isRecord(out) && typeof out['then'] === 'function') {
    // Not awaited: a compute is synchronous by contract. Its rejection, if any, goes nowhere.
    void Promise.resolve(out).catch(() => {})
    return { kind: 'settle', ok: false, text: t.failed(t.localAsync) }
  }
  if (isRecord(out) && typeof out['text'] === 'string') {
    return { kind: 'settle', ok: true, text: whole ? out['text'] : truncate(out['text'], lang) }
  }
  if (isRecord(out) && typeof out['error'] === 'string') {
    // Cut as a text is: an error can quote the input (parse-url's port) at any length.
    return { kind: 'settle', ok: false, text: truncate(out['error'], lang) }
  }
  if (isRecord(out) && 'effect' in out) {
    // Something done outside the module: an action on the selection's alone, of a known shape.
    if (!selection) return { kind: 'settle', ok: false, text: t.failed(t.localEffectStandalone) }
    const effect = effectOf(out['effect'])
    if (effect === undefined) return { kind: 'settle', ok: false, text: t.failed(textOf(out['effect'])) }
    return { kind: 'effect', effect }
  }
  if (isRecord(out) && isRecord(out['ticker']) && typeof out['ticker']['frame'] === 'function') {
    if (selection) return { kind: 'settle', ok: false, text: t.failed(t.localTickerOnSelection) }
    const ticker = out['ticker'] as { intervalMs: unknown; frame: Frame }
    return { kind: 'ticker', intervalMs: clampInterval(Number(ticker.intervalMs)), frame: ticker.frame }
  }
  return { kind: 'settle', ok: false, text: t.failed(textOf(out)) }
}

/** One step of a run over time. */
export type TickerStep =
  | { kind: 'same' }
  | { kind: 'show'; text: string }
  | { kind: 'done'; text: string; toast?: string }
  | { kind: 'limit' }
  | { kind: 'failed'; reason: string }

/**
 * What a run over time shows at `now`: its frame when the text changed
 * (`show`) or nothing new (`same`); `done` when the frame says it is over;
 * `limit` once it has gone on for TICKER_MAX_MS; `failed` when the frame throws
 * or answers no text. A frame's text past the limit is cut as a result's is
 * (in `lang`). Never throws.
 */
export function tickerStep(
  frame: Frame,
  at: { startedAt: number; now: number; lastText: string | undefined; lang: Lang },
): TickerStep {
  try {
    return stepOf(frame(at.now), at)
  } catch (err) {
    const reason = err instanceof RandomUnavailableError ? MESSAGES[at.lang].randomUnavailable : displaySafe(messageOf(err))
    return { kind: 'failed', reason }
  }
}

function stepOf(f: unknown, at: { startedAt: number; now: number; lastText: string | undefined; lang: Lang }): TickerStep {
  if (!isRecord(f) || typeof f['text'] !== 'string') return { kind: 'failed', reason: textOf(f) }
  const text = truncate(f['text'], at.lang)
  if (f['done'] === true) {
    const toast = f['toast']
    return typeof toast === 'string' ? { kind: 'done', text, toast } : { kind: 'done', text }
  }
  if (at.now - at.startedAt >= TICKER_MAX_MS) return { kind: 'limit' }
  return text === at.lastText ? { kind: 'same' } : { kind: 'show', text }
}
