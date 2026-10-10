// The one argument a standalone action takes from `/quick-actions <id> <argument>`,
// and its default when it is run with none (from the hint line, the ⋯ dialog,
// or the command without one). Pure functions over plain data: nothing here
// reaches `$`, reads the clock or throws. The time a `date` is counted from
// and the local offset come in as arguments, so a test fixes both.

/** The kinds of argument an action can declare: a fixed set, each parsed below. */
export type ArgType = 'duration' | 'int' | 'number' | 'date' | 'time' | 'choice' | 'text'

/**
 * What an action takes as its argument. `default` is parsed as the argument
 * would be when none is given; left out, the argument is optional (`text`
 * only), and none gives undefined. `min` / `max` bound an `int`, a `number` or
 * a `duration` (in ms); `choices` lists a `choice`'s values (lowercase). `hint`
 * says how to write it, shown with an invalid argument.
 */
export type ArgSpec<T = string> = {
  type: ArgType
  default?: string
  min?: number
  max?: number
  choices?: readonly string[]
  hint: T
}

/**
 * A parsed argument: ms for a `duration`, the number for an `int` or a
 * `number`, the local midnight in ms for a `date`, minutes since midnight for
 * a `time`, the lowercase value for a `choice`, the trimmed text for a `text`.
 */
export type ArgValue = number | string

/** What a `date` is counted from: the time now and the local offset from UTC (minutes, east positive) at a given time. */
export type ArgEnv = { now: number; utcOffsetMinutes: (ms: number) => number }

/** A parsed argument, or not valid; `value` is undefined for an optional `text` given none. */
export type ParsedArg = { ok: true; value: ArgValue | undefined } | { ok: false }

/** The longest `text` argument, in characters. */
export const TEXT_ARG_LIMIT = 500

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The bounds of a `duration`: 1 second to 24 hours, narrowed by the spec's own. */
export const DURATION_MIN_MS = SECOND
export const DURATION_MAX_MS = DAY

const INVALID: ParsedArg = { ok: false }
const valid = (value: ArgValue | undefined): ParsedArg => ({ ok: true, value })

const inRange = (n: number, min: number | undefined, max: number | undefined) =>
  (min === undefined || n >= min) && (max === undefined || n <= max)

const int = (digits: string | undefined) => (digits === undefined ? 0 : Number(digits))

/** `90s`, `5m`, `1h30m`, `1h2m3s` (h, m, s once each, in that order), `m:ss`, `h:mm:ss`, or whole minutes. */
function parseDuration(spec: ArgSpec<unknown>, raw: string): ParsedArg {
  const s = raw.toLowerCase()
  let ms: number
  let m: RegExpExecArray | null
  if (/^\d{1,6}$/.test(s)) {
    ms = Number(s) * MINUTE
  } else if ((m = /^(\d{1,6}):([0-5]\d)$/.exec(s)) !== null) {
    ms = int(m[1]) * MINUTE + int(m[2]) * SECOND
  } else if ((m = /^(\d{1,6}):([0-5]\d):([0-5]\d)$/.exec(s)) !== null) {
    ms = int(m[1]) * HOUR + int(m[2]) * MINUTE + int(m[3]) * SECOND
  } else if ((m = /^(?:(\d{1,6})h)?(?:(\d{1,6})m)?(?:(\d{1,6})s)?$/.exec(s)) !== null && s !== '') {
    // Each unit may carry over (1h90m is 2h30m): the total is what is bounded.
    ms = int(m[1]) * HOUR + int(m[2]) * MINUTE + int(m[3]) * SECOND
  } else {
    return INVALID
  }
  const min = Math.max(DURATION_MIN_MS, spec.min ?? DURATION_MIN_MS)
  const max = Math.min(DURATION_MAX_MS, spec.max ?? DURATION_MAX_MS)
  return inRange(ms, min, max) ? valid(ms) : INVALID
}

function parseInt_(spec: ArgSpec<unknown>, raw: string): ParsedArg {
  if (!/^[+-]?\d{1,15}$/.test(raw)) return INVALID
  const n = Number(raw)
  return Number.isSafeInteger(n) && inRange(n, spec.min, spec.max) ? valid(n === 0 ? 0 : n) : INVALID
}

function parseNumber(spec: ArgSpec<unknown>, raw: string): ParsedArg {
  // Decimals with a point; no exponent, no hex, no Infinity.
  if (!/^[+-]?(\d{1,15}(\.\d{1,15})?|\.\d{1,15})$/.test(raw)) return INVALID
  const n = Number(raw)
  return Number.isFinite(n) && inRange(n, spec.min, spec.max) ? valid(n === 0 ? 0 : n) : INVALID
}

/** A calendar day: a year from 1 to 9999, a month from 1, a day from 1. */
type Day = { y: number; m: number; d: number }

const daysIn = (y: number, m: number) => {
  const t = new Date(0)
  t.setUTCFullYear(y, m, 0)
  return t.getUTCDate()
}

/** The UTC midnight of a day, in ms (years below 100 included, which Date.UTC would move). */
const utcMidnight = ({ y, m, d }: Day) => {
  const t = new Date(0)
  t.setUTCFullYear(y, m - 1, d)
  t.setUTCHours(0, 0, 0, 0)
  return t.getTime()
}

const dayOf = (utcMs: number): Day => {
  const t = new Date(utcMs)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/**
 * The local midnight of a day, in ms since the epoch. The offset is the one
 * in force at that midnight, found in two steps so a day a clock change falls
 * on still starts at its own midnight.
 */
export function localMidnight(day: Day, utcOffsetMinutes: (ms: number) => number): number {
  const utc = utcMidnight(day)
  const guess = utc - utcOffsetMinutes(utc) * MINUTE
  return utc - utcOffsetMinutes(guess) * MINUTE
}

/** The local calendar day at `ms`. */
export const localDay = (ms: number, utcOffsetMinutes: (ms: number) => number): Day =>
  dayOf(ms + utcOffsetMinutes(ms) * MINUTE)

/** `day` moved by `months`, its day of the month brought back to the month's last when it has fewer. */
const addMonths = ({ y, m, d }: Day, months: number): Day => {
  const index = y * 12 + (m - 1) + months
  const ny = Math.floor(index / 12)
  const nm = index - ny * 12 + 1
  return { y: ny, m: nm, d: Math.min(d, daysIn(ny, nm)) }
}

const addDays = (day: Day, days: number): Day => dayOf(utcMidnight(day) + days * DAY)

const isDay = ({ y, m, d }: Day) => y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m)

/** `YYYY-MM-DD`, `YYYY/MM/DD`, `today`, `tomorrow`, `yesterday`, or `+Nd` `-Nw` `+Nm` from today. */
function parseDate(raw: string, env: ArgEnv): ParsedArg {
  const s = raw.toLowerCase()
  const today = localDay(env.now, env.utcOffsetMinutes)
  let day: Day
  let m: RegExpExecArray | null
  if (s === 'today') day = today
  else if (s === 'tomorrow') day = addDays(today, 1)
  else if (s === 'yesterday') day = addDays(today, -1)
  else if ((m = /^([+-])(\d{1,5})([dwm])$/.exec(s)) !== null) {
    const n = int(m[2]) * (m[1] === '-' ? -1 : 1)
    day = m[3] === 'm' ? addMonths(today, n) : addDays(today, m[3] === 'w' ? n * 7 : n)
  } else if ((m = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/.exec(s)) !== null) {
    day = { y: int(m[1]), m: int(m[3]), d: int(m[4]) }
  } else {
    return INVALID
  }
  return isDay(day) ? valid(localMidnight(day, env.utcOffsetMinutes)) : INVALID
}

/** `HH:MM` on the 24-hour clock (`9:05` too): minutes since midnight. */
function parseTime(raw: string): ParsedArg {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw)
  return m === null ? INVALID : valid(int(m[1]) * 60 + int(m[2]))
}

function parseChoice(spec: ArgSpec<unknown>, raw: string): ParsedArg {
  const s = raw.toLowerCase()
  return (spec.choices ?? []).includes(s) ? valid(s) : INVALID
}

/**
 * The argument `raw` (as the command gives it; undefined for none) parsed by
 * `spec`. None, or one that is blank, takes the default, parsed the same way;
 * with no default, an optional `text` gives undefined and any other kind is
 * not valid. Never throws.
 */
export function parseArg(spec: ArgSpec<unknown>, raw: string | undefined, env: ArgEnv): ParsedArg {
  const given = raw?.trim()
  if (given === undefined || given === '') {
    if (spec.default === undefined) return spec.type === 'text' ? valid(undefined) : INVALID
    return parseGiven(spec, spec.default.trim(), env)
  }
  return parseGiven(spec, given, env)
}

function parseGiven(spec: ArgSpec<unknown>, s: string, env: ArgEnv): ParsedArg {
  try {
    switch (spec.type) {
      case 'duration':
        return parseDuration(spec, s)
      case 'int':
        return parseInt_(spec, s)
      case 'number':
        return parseNumber(spec, s)
      case 'date':
        return parseDate(s, env)
      case 'time':
        return parseTime(s)
      case 'choice':
        return parseChoice(spec, s)
      case 'text':
        return [...s].length > TEXT_ARG_LIMIT ? INVALID : valid(s)
    }
  } catch {
    // An offset function that throws, say: not a value to run on.
  }
  return INVALID
}

/**
 * The command's arguments split at the first space (a full-width one or a tab
 * too): the action ID, lowercased, and the rest, trimmed with its case kept
 * (undefined when there is none).
 */
export function splitCommandArgs(args: string): { id: string; arg: string | undefined } {
  const s = args.trim()
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(s)
  if (m === null) return { id: '', arg: undefined }
  const arg = m[2]?.trim()
  return { id: m[1]!.toLowerCase(), arg: arg === undefined || arg === '' ? undefined : arg }
}

const two = (n: number) => String(n).padStart(2, '0')

/** A span of time as `mm:ss`, or `h:mm:ss` from an hour on; whole seconds (rounded down), never below 0. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / SECOND))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}

/** A local offset as a time zone's label: `UTC+09:00`, `UTC-05:00`, `UTC+00:00`. */
export function utcLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const abs = Math.abs(Math.trunc(offsetMinutes))
  return `UTC${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`
}
