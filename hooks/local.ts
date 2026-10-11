// What a local action's run decides, as pure functions: what its `compute` is
// handed, what its answer comes to (a result, a failure, or a run over time),
// and each step of a run over time. register.tsx reads the clock, the time
// zone and the randomness, calls these and does what they say through `$`;
// nothing here reaches `$`, so a test checks every case directly, the ones no
// built-in has yet (a local action on the selection) included.

import { LOCAL_TEXT_LIMIT, TICKER_MAX_MS, TICKER_MIN_INTERVAL_MS, messageOf, needsSelection, textOf } from './actions'
import type { LocalAction, LocalInput, TickerFrame } from './actions'
import type { ArgValue } from './args'
import { MESSAGES } from './i18n'
import { RandomUnavailableError } from './random'
import type { Lang } from './i18n'

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

/** What a local run comes to: its entry settled now (done or failed, with its text), or a run over time to start. */
export type LocalOutcome =
  | { kind: 'settle'; ok: boolean; text: string }
  | { kind: 'ticker'; intervalMs: number; frame: Frame }

/** A run's period, raised to the shortest allowed (and a period that is no number, to it too). */
export const clampInterval = (ms: number) =>
  Number.isFinite(ms) && ms > TICKER_MIN_INTERVAL_MS ? ms : TICKER_MIN_INTERVAL_MS

/**
 * A result past the limit, cut there and marked as cut. Characters are counted
 * as code points, as a text argument's are, so an emoji is one and is never
 * split in half.
 */
export function truncate(text: string, lang: Lang): string {
  // No more code points than code units: a text this short is within the limit.
  if (text.length <= LOCAL_TEXT_LIMIT) return text
  let end = 0
  for (let count = 0; count < LOCAL_TEXT_LIMIT; count++) {
    if (end >= text.length) return text
    const code = text.codePointAt(end) ?? 0
    end += code > 0xffff ? 2 : 1
  }
  return end >= text.length ? text : `${text.slice(0, end)}\n${MESSAGES[lang].truncated}`
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'

/**
 * Runs `def`'s compute on `input`, synchronously, and says what comes of it.
 * A throw, a promise or an answer of no known shape is a failure; so is a run
 * over time asked for by an action on the selection (`selection`), which may
 * only answer at once. Never throws.
 */
export function runLocal(def: Pick<LocalAction, 'compute'>, input: LocalInput, opts: { selection: boolean; lang: Lang }): LocalOutcome {
  const t = MESSAGES[opts.lang]
  // The compute's run and the reading of its answer alike: a getter on that
  // answer may throw too.
  try {
    return outcomeOf(def.compute(input), opts.selection, opts.lang)
  } catch (err) {
    // No secure random numbers: said in the user's language, not as the error's own English.
    const reason = err instanceof RandomUnavailableError ? t.randomUnavailable : messageOf(err)
    return { kind: 'settle', ok: false, text: t.failed(reason) }
  }
}

function outcomeOf(out: unknown, selection: boolean, lang: Lang): LocalOutcome {
  const t = MESSAGES[lang]
  if (isRecord(out) && typeof out['then'] === 'function') {
    // Not awaited: a compute is synchronous by contract. Its rejection, if any, goes nowhere.
    void Promise.resolve(out).catch(() => {})
    return { kind: 'settle', ok: false, text: t.failed(t.localAsync) }
  }
  if (isRecord(out) && typeof out['text'] === 'string') {
    return { kind: 'settle', ok: true, text: truncate(out['text'], lang) }
  }
  if (isRecord(out) && typeof out['error'] === 'string') {
    // Cut as a text is: an error can quote the input (parse-url's port) at any length.
    return { kind: 'settle', ok: false, text: truncate(out['error'], lang) }
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
    const reason = err instanceof RandomUnavailableError ? MESSAGES[at.lang].randomUnavailable : messageOf(err)
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
