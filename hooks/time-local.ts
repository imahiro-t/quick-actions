// The standalone local actions on time: the runs over time (stopwatch,
// pomodoro, countdown-to, breathing, eye-rest) and the clock and calendar
// answers (clock, calendar, date-info, date-offset, business-days, wareki,
// year-progress, time-after, duration-convert, sleep-calc, moon-phase).
//
// Synchronous and pure, as LocalAction asks: ECMAScript's built-ins alone.
// The time comes from `input.now`, the local time from `utcOffsetMinutes`
// added to it and read with Date's UTC methods; dates and weekdays are written
// in this module's own fixed form, never through Intl, localeCompare or
// toLocale*String (their answers vary by machine). The time zone's name is
// only shown.
//
// Each takes its argument as register.tsx parsed it (./args); one of another
// type or out of its range is not put back to the default but answered with
// `{ error }`, so a wrong call is never hidden. A run over time ends by saying
// `done` with no toast of its own: the generic one (tickerFinishedToast) says
// it is over.

import type { LocalInput, LocalOutput, TickerFrame } from './actions'
import { DURATION_MAX_MS, DURATION_MIN_MS, addDays, dayOf, daysIn, formatClock, localDay, localMidnight, utcLabel, utcMidnight } from './args'
import type { Day } from './args'
import type { Lang } from './i18n'
import { INT_TEXT, invalid, isInt } from './local-args'
import type { Texts } from './local-args'

const pick = (lang: Lang, t: Texts) => t[lang]

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const two = (n: number) => String(n).padStart(2, '0')

// ---------------------------------------------------------------------------
// Days and their written forms.

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const WEEKDAY_EN_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const MONTH_EN_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** The day of the week, 0 for Sunday. */
export const weekday = (day: Day) => new Date(utcMidnight(day)).getUTCDay()

/** The days from `a` to `b` (negative when `b` is earlier), counted on the calendar: no clock change moves it. */
export const daysBetween = (a: Day, b: Day) => Math.round((utcMidnight(b) - utcMidnight(a)) / DAY)

/** The day's number in its year, 1 for 1 January. */
export const dayOfYear = (day: Day) => daysBetween({ y: day.y, m: 1, d: 1 }, day) + 1

const isLeap = (y: number) => daysIn(y, 2) === 29

/** The ISO 8601 week (Monday first; week 1 holds the year's first Thursday) and the year it belongs to. */
export function isoWeek(day: Day): { year: number; week: number } {
  const iso = ((weekday(day) + 6) % 7) + 1
  const thursday = addDays(day, 4 - iso)
  return { year: thursday.y, week: Math.floor((dayOfYear(thursday) - 1) / 7) + 1 }
}

/** `2026-W41`. */
const isoWeekText = (day: Day) => {
  const { year, week } = isoWeek(day)
  return `${year}-W${two(week)}`
}

/** `2026年10月10日（土）` / `Sat, 10 Oct 2026`. */
export function formatDay(day: Day, lang: Lang): string {
  const w = weekday(day)
  return lang === 'ja' ? `${day.y}年${day.m}月${day.d}日（${WEEKDAY_JA[w]}）` : `${WEEKDAY_EN[w]}, ${day.d} ${MONTH_EN[day.m - 1]} ${day.y}`
}

const weekdayName = (day: Day, lang: Lang) => (lang === 'ja' ? `${WEEKDAY_JA[weekday(day)]}曜日` : WEEKDAY_EN_LONG[weekday(day)]!)

/** The local wall clock at `ms`: its day, hour, minute, second, and the offset in force. */
export function localFields(ms: number, input: Pick<LocalInput, 'utcOffsetMinutes'>): { day: Day; h: number; mi: number; s: number; offset: number } {
  const offset = input.utcOffsetMinutes(ms)
  const t = new Date(ms + offset * MINUTE)
  return { day: dayOf(t.getTime()), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), offset }
}

/**
 * The instant of a local wall time (`minutes` after the local midnight of
 * `day`), in ms. The offset is found in two steps, as localMidnight does, so a
 * day a clock change falls on still comes out right.
 */
export function wallToInstant(day: Day, minutes: number, utcOffsetMinutes: (ms: number) => number): number {
  const wall = utcMidnight(day) + minutes * MINUTE
  const guess = wall - utcOffsetMinutes(wall) * MINUTE
  return wall - utcOffsetMinutes(guess) * MINUTE
}

/** `HH:MM` for minutes after midnight (taken modulo a day). */
const hhmm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${two(Math.floor(m / 60))}:${two(m % 60)}`
}

/** `1 時間 30 分 5 秒` / `1 h 30 min 5 s`, the parts that are not zero (whole seconds). */
function durationWords(ms: number, lang: Lang): string {
  const total = Math.floor(ms / SECOND)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (lang === 'ja') {
    if (h > 0) parts.push(`${h} 時間`)
    if (m > 0) parts.push(`${m} 分`)
    if (s > 0 || parts.length === 0) parts.push(`${s} 秒`)
  } else {
    if (h > 0) parts.push(`${h} h`)
    if (m > 0) parts.push(`${m} min`)
    if (s > 0 || parts.length === 0) parts.push(`${s} s`)
  }
  return parts.join(' ')
}

/** A number with up to six decimals and no trailing zeros. */
const decimal = (n: number) => String(Number(n.toFixed(6)))

const isYear = (y: number) => y >= 1 && y <= 9999

// ---------------------------------------------------------------------------
// The checks of an argument, by its type.

const TIME_TEXT: Texts = { ja: '時刻（0:00〜23:59 を 0 時からの分で）', en: 'a time from 0:00 to 23:59 (minutes after midnight)' }
const DATE_TEXT: Texts = { ja: '1〜9999 年の日付', en: 'a date in the years 1 to 9999' }
const DURATION_TEXT: Texts = { ja: '1 秒〜24 時間の時間', en: 'a duration from 1 second to 24 hours' }

const isTime = (arg: unknown): arg is number => isInt(arg, 0, 1439)

const isDuration = (arg: unknown): arg is number =>
  typeof arg === 'number' && Number.isFinite(arg) && arg >= DURATION_MIN_MS && arg <= DURATION_MAX_MS

/** The local day of a `date` argument (its local midnight in ms), or undefined when it is none in the years 1 to 9999. */
function dateArg(arg: unknown, input: LocalInput): Day | undefined {
  if (typeof arg !== 'number' || !Number.isFinite(arg)) return undefined
  const day = localDay(arg, input.utcOffsetMinutes)
  return Number.isFinite(day.y) && isYear(day.y) ? day : undefined
}

// ---------------------------------------------------------------------------
// Runs over time. Each counts from `input.now`, the moment it was started:
// time left is rounded up to the second, time gone by rounded down, as the
// timer's is.

const ticker = (frame: (at: number) => TickerFrame): LocalOutput => ({ ticker: { intervalMs: 1000, frame } })

const roundUp = (ms: number) => Math.ceil(ms / SECOND) * SECOND

/** Counts up from 0; it never ends by itself (the stop button settles it with the time gone by, the 24-hour limit ends it). */
export const stopwatch = ({ now, lang }: LocalInput): LocalOutput =>
  ticker(at => ({ text: lang === 'ja' ? `🏃 ${formatClock(at - now)} 経過` : `🏃 ${formatClock(at - now)} elapsed`, done: false }))

export const POMODORO_WORK_MS = 25 * MINUTE
export const POMODORO_BREAK_MS = 5 * MINUTE

/** `arg` rounds of 25 minutes' work and 5 minutes' break; done at the end of the last break. */
export const pomodoro = ({ arg, now, lang }: LocalInput): LocalOutput => {
  if (!isInt(arg, 1, 8)) return invalid(lang, INT_TEXT(1, 8))
  const rounds = arg
  const cycle = POMODORO_WORK_MS + POMODORO_BREAK_MS
  return ticker(at => {
    const gone = Math.max(0, at - now)
    if (gone >= rounds * cycle) {
      return { text: lang === 'ja' ? `🍅 全 ${rounds} 回 終了` : `🍅 All ${rounds} ${rounds === 1 ? 'round' : 'rounds'} done`, done: true }
    }
    const round = Math.floor(gone / cycle) + 1
    const within = gone % cycle
    const work = within < POMODORO_WORK_MS
    const left = formatClock(roundUp((work ? POMODORO_WORK_MS : cycle) - within))
    if (lang === 'ja') return { text: work ? `🍅 作業 ${round}/${rounds} 残り ${left}` : `☕ 休憩 ${round}/${rounds} 残り ${left}`, done: false }
    return { text: work ? `🍅 Work ${round}/${rounds} · ${left} left` : `☕ Break ${round}/${rounds} · ${left} left`, done: false }
  })
}

/** Counts down to the time given (today's, or tomorrow's when today's is not still to come); done when it is reached. */
export const countdownTo = (input: LocalInput): LocalOutput => {
  const { arg, now, lang } = input
  if (!isTime(arg)) return invalid(lang, TIME_TEXT)
  const today = localDay(now, input.utcOffsetMinutes)
  let target = wallToInstant(today, arg, input.utcOffsetMinutes)
  const tomorrow = target <= now
  if (tomorrow) target = wallToInstant(addDays(today, 1), arg, input.utcOffsetMinutes)
  const time = hhmm(arg)
  return ticker(at => {
    const left = target - at
    if (left <= 0) return { text: lang === 'ja' ? `🔜 ${time} になりました` : `🔜 It is ${time}`, done: true }
    const clock = formatClock(roundUp(left))
    if (lang === 'ja') return { text: `🔜 ${tomorrow ? '明日 ' : ''}${time} まで 残り ${clock}`, done: false }
    return { text: `🔜 ${clock} left until ${time}${tomorrow ? ' tomorrow' : ''}`, done: false }
  })
}

type Breath = 'in' | 'hold' | 'out'

/** The phases of one cycle, in seconds. */
export const BREATHING: Readonly<Record<'box' | '478', readonly (readonly [Breath, number])[]>> = {
  box: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]],
  '478': [['in', 4], ['hold', 7], ['out', 8]],
}

export const BREATHING_CYCLES = 4

const BREATH_WORDS: Record<Breath, Texts> = {
  in: { ja: '吸う', en: 'Breathe in' },
  hold: { ja: '止める', en: 'Hold' },
  out: { ja: '吐く', en: 'Breathe out' },
}

/** Says each second which way to breathe and for how many seconds more; done after four cycles. */
export const breathing = ({ arg, now, lang }: LocalInput): LocalOutput => {
  if (arg !== 'box' && arg !== '478') return invalid(lang, { ja: 'box か 478', en: 'box or 478' })
  const phases = BREATHING[arg]
  const length = phases.reduce((sum, [, s]) => sum + s, 0)
  return ticker(at => {
    const second = Math.floor(Math.max(0, at - now) / SECOND)
    if (second >= length * BREATHING_CYCLES) {
      return { text: lang === 'ja' ? `🫁 ${BREATHING_CYCLES} サイクル終了` : `🫁 ${BREATHING_CYCLES} cycles done`, done: true }
    }
    const cycle = Math.floor(second / length) + 1
    let pos = second % length
    for (const [breath, seconds] of phases) {
      if (pos < seconds) {
        const left = seconds - pos
        const word = pick(lang, BREATH_WORDS[breath])
        return {
          text: lang === 'ja' ? `🫁 ${word} ${left} 秒（サイクル ${cycle}/${BREATHING_CYCLES}）` : `🫁 ${word} · ${left} s (cycle ${cycle}/${BREATHING_CYCLES})`,
          done: false,
        }
      }
      pos -= seconds
    }
    // Not reached: the phases add up to the cycle's length.
    return { text: '🫁', done: false }
  })
}

export const EYE_REST_MS = 20 * SECOND

/** The 20-20-20 rule's break: 20 seconds counted down; done at zero. */
export const eyeRest = ({ now, lang }: LocalInput): LocalOutput =>
  ticker(at => {
    const left = now + EYE_REST_MS - at
    if (left <= 0) return { text: lang === 'ja' ? '👀 20 秒の休憩が終わりました' : '👀 The 20-second break is over', done: true }
    const s = Math.ceil(left / SECOND)
    return { text: lang === 'ja' ? `👀 遠くを見てください 残り ${s} 秒` : `👀 Look at something far away · ${s} s left`, done: false }
  })

// ---------------------------------------------------------------------------
// The clock and the calendar.

const isoDate = (day: Day) => `${String(day.y).padStart(4, '0')}-${two(day.m)}-${two(day.d)}`

/** `+09:00`. */
const offsetSuffix = (offset: number) => utcLabel(offset).slice(3)

/** The time now, locally and in UTC, as ISO 8601 and as a UNIX time, with its weekday, ISO week and day of the year. */
export const clock = (input: LocalInput): LocalOutput => {
  const { now, lang } = input
  const local = localFields(now, input)
  const utc = new Date(now)
  const utcDay = dayOf(now)
  const time = (h: number, mi: number, s: number) => `${two(h)}:${two(mi)}:${two(s)}`
  const localTime = time(local.h, local.mi, local.s)
  const utcTime = time(utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds())
  const ms = String(utc.getUTCMilliseconds()).padStart(3, '0')
  const isoLocal = `${isoDate(local.day)}T${localTime}${offsetSuffix(local.offset)}`
  const isoUtc = `${isoDate(utcDay)}T${utcTime}.${ms}Z`
  const seconds = Math.floor(now / SECOND)
  const yearDays = isLeap(local.day.y) ? 366 : 365
  const day = local.day
  if (lang === 'ja') {
    return {
      text: [
        `ローカル: ${formatDay(day, 'ja')} ${localTime} ${utcLabel(local.offset)}（${input.timeZone}）`,
        `UTC: ${formatDay(utcDay, 'ja')} ${utcTime}`,
        `ISO 8601: ${isoLocal} / ${isoUtc}`,
        `UNIX 時刻: ${seconds}（秒） / ${now}（ミリ秒）`,
        `曜日: ${weekdayName(day, 'ja')}`,
        `ISO 週番号: ${isoWeekText(day)}`,
        `通算日: ${dayOfYear(day)} 日目（${yearDays} 日中）`,
      ].join('\n'),
    }
  }
  return {
    text: [
      `Local: ${formatDay(day, 'en')} ${localTime} ${utcLabel(local.offset)} (${input.timeZone})`,
      `UTC: ${formatDay(utcDay, 'en')} ${utcTime}`,
      `ISO 8601: ${isoLocal} / ${isoUtc}`,
      `UNIX time: ${seconds} (seconds) / ${now} (milliseconds)`,
      `Weekday: ${weekdayName(day, 'en')}`,
      `ISO week: ${isoWeekText(day)}`,
      `Day of the year: ${dayOfYear(day)} of ${yearDays}`,
    ].join('\n'),
  }
}

/** A cell four columns wide, right-aligned. */
const cell = (s: string) => s.padStart(4, ' ')

/**
 * The month holding the date given (today by default), Sunday first, each day
 * four columns wide and the date given marked by an asterisk just before its
 * number (` *10`, `  *1`), which keeps every column four wide and leaves at
 * least one space between it and the day before. The
 * Japanese weekdays are full width: two columns each, after two spaces.
 */
export const calendar = (input: LocalInput): LocalOutput => {
  const { lang } = input
  const day = dateArg(input.arg, input)
  if (day === undefined) return invalid(lang, DATE_TEXT)
  const heading = lang === 'ja' ? `${day.y}年${day.m}月` : `${MONTH_EN_LONG[day.m - 1]} ${day.y}`
  const header = (lang === 'ja' ? WEEKDAY_JA.map(w => `  ${w}`) : WEEKDAY_EN.map(w => cell(w.slice(0, 2)))).join('')
  const first = weekday({ y: day.y, m: day.m, d: 1 })
  const cells: string[] = Array.from({ length: first }, () => '    ')
  for (let d = 1; d <= daysIn(day.y, day.m); d++) cells.push(d === day.d ? cell(`*${d}`) : cell(String(d)))
  const rows: string[] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join('').trimEnd())
  const mark = `*${day.d} = ${formatDay(day, lang)}`
  return { text: [heading, header, ...rows, '', mark].join('\n') }
}

// The eras from Meiji, each from the day it began. Meiji's is the day of the
// edict (1868-10-23), which was applied back to 1 January of that year; the
// calendar was the lunisolar one until Meiji 5 (1872).
type Era = { ja: string; en: string; abbr: string; start: Day }
export const ERAS: readonly Era[] = [
  { ja: '明治', en: 'Meiji', abbr: 'M', start: { y: 1868, m: 10, d: 23 } },
  { ja: '大正', en: 'Taisho', abbr: 'T', start: { y: 1912, m: 7, d: 30 } },
  { ja: '昭和', en: 'Showa', abbr: 'S', start: { y: 1926, m: 12, d: 25 } },
  { ja: '平成', en: 'Heisei', abbr: 'H', start: { y: 1989, m: 1, d: 8 } },
  { ja: '令和', en: 'Reiwa', abbr: 'R', start: { y: 2019, m: 5, d: 1 } },
]

const isBefore = (a: Day, b: Day) => utcMidnight(a) < utcMidnight(b)

/** The last year (in the era's count) of era `i`: the year the next began, or up to 9999. */
const lastEraYear = (i: number) => (i + 1 < ERAS.length ? ERAS[i + 1]!.start.y : 9999) - ERAS[i]!.start.y + 1

/** `令和8年` / `令和元年` / `Reiwa 8`. */
const eraYear = (era: Era, n: number, lang: Lang) => (lang === 'ja' ? `${era.ja}${n === 1 ? '元' : n}年` : `${era.en} ${n}`)

/** The era and its year on `day`, or undefined before Meiji began. */
export function toWareki(day: Day): { era: Era; year: number } | undefined {
  for (let i = ERAS.length - 1; i >= 0; i--) {
    const era = ERAS[i]!
    if (!isBefore(day, era.start)) return { era, year: day.y - era.start.y + 1 }
  }
  return undefined
}

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const
const STEM_READINGS = ['きのえ', 'きのと', 'ひのえ', 'ひのと', 'つちのえ', 'つちのと', 'かのえ', 'かのと', 'みずのえ', 'みずのと'] as const
const STEM_EN = ['Yang Wood', 'Yin Wood', 'Yang Fire', 'Yin Fire', 'Yang Earth', 'Yin Earth', 'Yang Metal', 'Yin Metal', 'Yang Water', 'Yin Water'] as const
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const
const BRANCH_READINGS = ['ね', 'うし', 'とら', 'う', 'たつ', 'み', 'うま', 'ひつじ', 'さる', 'とり', 'いぬ', 'い'] as const
const BRANCH_EN = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'] as const

/** The sexagenary year (`丙午（ひのえうま）` / `丙午 (Yang Fire Horse)`), by the calendar year alone. */
export function eto(year: number, lang: Lang): string {
  const i = (((year - 4) % 60) + 60) % 60
  const s = i % 10
  const b = i % 12
  const name = `${STEMS[s]}${BRANCHES[b]}`
  return lang === 'ja' ? `${name}（${STEM_READINGS[s]}${BRANCH_READINGS[b]}）` : `${name} (${STEM_EN[s]} ${BRANCH_EN[b]})`
}

const ETO_NOTE: Texts = {
  ja: '※ 干支は暦年で数えた概算です（立春は考慮していません）。',
  en: 'Note: the sexagenary year is counted by the calendar year (the start of spring is not taken into account).',
}

/** `今日` / `30 日後` / `5 日前`; `today` / `in 30 days` / `5 days ago`. */
function fromToday(days: number, lang: Lang): string {
  if (lang === 'ja') return days === 0 ? '今日' : days > 0 ? `${days} 日後` : `${-days} 日前`
  if (days === 0) return 'today'
  const n = Math.abs(days)
  const unit = n === 1 ? 'day' : 'days'
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`
}

/** What the date given (today by default) is: weekday, ISO week, day of the year, days left in it and from today, the era and the sexagenary year. */
export const dateInfo = (input: LocalInput): LocalOutput => {
  const { lang } = input
  const day = dateArg(input.arg, input)
  if (day === undefined) return invalid(lang, DATE_TEXT)
  const today = localDay(input.now, input.utcOffsetMinutes)
  const yearDays = isLeap(day.y) ? 366 : 365
  const left = yearDays - dayOfYear(day)
  const wareki = toWareki(day)
  if (lang === 'ja') {
    return {
      text: [
        formatDay(day, 'ja'),
        `曜日: ${weekdayName(day, 'ja')}`,
        `ISO 週番号: ${isoWeekText(day)}`,
        `通算日: ${dayOfYear(day)} 日目（${yearDays} 日中）`,
        `年末まで: ${left} 日`,
        `今日から: ${fromToday(daysBetween(today, day), 'ja')}`,
        `和暦: ${wareki === undefined ? '対象外（明治より前）' : eraYear(wareki.era, wareki.year, 'ja')}`,
        `干支: ${eto(day.y, 'ja')}`,
        pick('ja', ETO_NOTE),
      ].join('\n'),
    }
  }
  return {
    text: [
      formatDay(day, 'en'),
      `Weekday: ${weekdayName(day, 'en')}`,
      `ISO week: ${isoWeekText(day)}`,
      `Day of the year: ${dayOfYear(day)} of ${yearDays}`,
      `Days left in the year: ${left}`,
      `From today: ${fromToday(daysBetween(today, day), 'en')}`,
      `Japanese era: ${wareki === undefined ? 'none (before Meiji)' : eraYear(wareki.era, wareki.year, 'en')}`,
      `Sexagenary year: ${eto(day.y, 'en')}`,
      pick('en', ETO_NOTE),
    ].join('\n'),
  }
}

/** The average month, in days (365.2425 / 12). */
const MONTH_DAYS = 30.436875

/** The date N days from today (before it when negative), with N in weeks and roughly in months. */
export const dateOffset = (input: LocalInput): LocalOutput => {
  const { arg, lang } = input
  if (!isInt(arg, -36500, 36500)) return invalid(lang, INT_TEXT(-36500, 36500))
  const today = localDay(input.now, input.utcOffsetMinutes)
  const day = addDays(today, arg)
  if (!isYear(day.y)) return invalid(lang, DATE_TEXT)
  const n = Math.abs(arg)
  const weeks = Math.floor(n / 7)
  const rest = n % 7
  const months = (n / MONTH_DAYS).toFixed(1)
  if (lang === 'ja') {
    const when = arg === 0 ? '今日' : arg > 0 ? `${n} 日後` : `${n} 日前`
    return {
      text: [`${when}: ${formatDay(day, 'ja')}`, `${n} 日 = ${weeks} 週 ${rest} 日`, ...(arg === 0 ? [] : [`約 ${months} か月${arg > 0 ? '後' : '前'}`])].join('\n'),
    }
  }
  const when = arg === 0 ? 'Today' : arg > 0 ? `${n} ${n === 1 ? 'day' : 'days'} from today` : `${n} ${n === 1 ? 'day' : 'days'} before today`
  return {
    text: [
      `${when}: ${formatDay(day, 'en')}`,
      `${n} ${n === 1 ? 'day' : 'days'} = ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ${rest} ${rest === 1 ? 'day' : 'days'}`,
      ...(arg === 0 ? [] : [`About ${months} ${months === '1.0' ? 'month' : 'months'} ${arg > 0 ? 'from' : 'before'} today`]),
    ].join('\n'),
  }
}

/** The weekdays (Monday to Friday) among the `n` days that follow a day of weekday `start` (0 for Sunday). */
export function weekdaysAfter(start: number, n: number): number {
  const weeks = Math.floor(n / 7)
  let count = weeks * 5
  for (let k = 1; k <= n - weeks * 7; k++) {
    const w = (start + k) % 7
    if (w !== 0 && w !== 6) count++
  }
  return count
}

const NO_HOLIDAYS: Texts = { ja: '※ 祝日は考慮していません（土日以外を平日として数えています）。', en: 'Note: public holidays are not taken into account (every day but Saturday and Sunday counts).' }

/**
 * The days from today to the date given (a month from today by default),
 * today not counted and that day counted (before today: that day counted and
 * today not), and the weekdays among them.
 */
export const businessDays = (input: LocalInput): LocalOutput => {
  const { lang } = input
  const day = dateArg(input.arg, input)
  if (day === undefined) return invalid(lang, DATE_TEXT)
  const today = localDay(input.now, input.utcOffsetMinutes)
  const diff = daysBetween(today, day)
  const n = Math.abs(diff)
  // Ahead: the n days after today. Behind: the n days from that day, which follow the day before it.
  const weekdays = diff >= 0 ? weekdaysAfter(weekday(today), n) : weekdaysAfter((weekday(day) + 6) % 7, n)
  if (lang === 'ja') {
    const span = diff === 0 ? '0 日（今日）' : diff > 0 ? `${n} 日後（今日を含めず、指定日を含む）` : `${n} 日前（指定日を含め、今日を含めない）`
    return {
      text: [`今日 ${formatDay(today, 'ja')} → ${formatDay(day, 'ja')}`, `日数: ${span}`, `平日: ${weekdays} 日（土日を除く）`, pick('ja', NO_HOLIDAYS)].join('\n'),
    }
  }
  const days = (k: number) => `${k} ${k === 1 ? 'day' : 'days'}`
  const span = diff === 0 ? '0 days (today)' : diff > 0 ? `${days(n)} ahead (today not counted, that day counted)` : `${days(n)} ago (that day counted, today not)`
  return {
    text: [`Today ${formatDay(today, 'en')} → ${formatDay(day, 'en')}`, `Days: ${span}`, `Weekdays: ${days(weekdays)} (Saturdays and Sundays left out)`, pick('en', NO_HOLIDAYS)].join('\n'),
  }
}

/** The names an era goes by, lowercase: its kanji, its romanized names, its abbreviation. */
const ERA_NAMES: readonly (readonly string[])[] = [
  ['明治', 'meiji', 'm'],
  ['大正', 'taisho', 'taishou', 'taishō', 't'],
  ['昭和', 'showa', 'shouwa', 'shōwa', 's'],
  ['平成', 'heisei', 'h'],
  ['令和', 'reiwa', 'r'],
]

/** Full-width digits and letters as ASCII ones, and full-width spaces as spaces. */
const toHalfWidth = (s: string) =>
  s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ')

/** `2019年: 平成31年（〜4/30）／令和元年（5/1〜）` for a year, every era it falls in with the days of each. */
function yearToWareki(y: number, lang: Lang): string {
  const parts: string[] = []
  for (let i = 0; i < ERAS.length; i++) {
    const era = ERAS[i]!
    const next = ERAS[i + 1]
    const lastYear = next === undefined ? 9999 : next.start.y
    if (y < era.start.y || y > lastYear) continue
    // Meiji's first year is taken whole (the era was applied back to 1 January).
    const startsHere = y === era.start.y && i > 0
    const endsHere = next !== undefined && y === next.start.y
    const end = endsHere ? addDays(next.start, -1) : undefined
    let span = ''
    if (lang === 'ja') {
      if (startsHere && end !== undefined) span = `（${era.start.m}/${era.start.d}〜${end.m}/${end.d}）`
      else if (startsHere) span = `（${era.start.m}/${era.start.d}〜）`
      else if (end !== undefined) span = `（〜${end.m}/${end.d}）`
    } else {
      if (startsHere && end !== undefined) span = ` (${MONTH_EN[era.start.m - 1]} ${era.start.d} to ${MONTH_EN[end.m - 1]} ${end.d})`
      else if (startsHere) span = ` (from ${MONTH_EN[era.start.m - 1]} ${era.start.d})`
      else if (end !== undefined) span = ` (to ${MONTH_EN[end.m - 1]} ${end.d})`
    }
    parts.push(`${eraYear(era, y - era.start.y + 1, lang)}${span}`)
  }
  return lang === 'ja' ? `${y}年 = ${parts.join('／')}` : `${y} = ${parts.join(' / ')}`
}

const WAREKI_NOTE: Texts = {
  ja: '※ 明治の開始日は改元の詔の日です（同年 1 月 1 日にさかのぼって適用）。明治 5 年（1872 年）までは旧暦でした。',
  en: 'Note: Meiji begins on the day of its edict (applied back to 1 January of that year); the lunisolar calendar was in use until Meiji 5 (1872).',
}

const WAREKI_TEXT: Texts = {
  ja: '西暦の年（1868〜9999。例: 2026）か和暦（例: 令和8, R8, H31, 令和元年, Reiwa 8）',
  en: 'a year from 1868 to 9999 (e.g. 2026) or a Japanese era year (e.g. 令和8, R8, H31, 令和元年, Reiwa 8)',
}

/** The years 1868 to 9999 in the Japanese eras and back; with no argument, this year's and the table of eras. */
export const wareki = (input: LocalInput): LocalOutput => {
  const { arg, lang } = input
  if (arg !== undefined && typeof arg !== 'string') return invalid(lang, WAREKI_TEXT)
  const raw = toHalfWidth(arg ?? '').trim().toLowerCase()
  if (raw === '') {
    const thisYear = localDay(input.now, input.utcOffsetMinutes).y
    const rows = ERAS.map((era, i) => {
      const start = lang === 'ja' ? `${era.start.y}年${era.start.m}月${era.start.d}日` : `${era.start.d} ${MONTH_EN[era.start.m - 1]} ${era.start.y}`
      const last = i + 1 < ERAS.length ? (lang === 'ja' ? `${lastEraYear(i)} 年まで` : `to year ${lastEraYear(i)}`) : ''
      return lang === 'ja'
        ? `${era.ja}（${era.abbr}）: ${start} から（元年 = ${era.start.y}年）${last === '' ? '' : `、${last}`}`
        : `${era.en} (${era.abbr}): from ${start} (year 1 = ${era.start.y})${last === '' ? '' : `, ${last}`}`
    })
    const now = isYear(thisYear) && thisYear >= 1868 ? yearToWareki(thisYear, lang) : ''
    return {
      text: [lang === 'ja' ? `今年: ${now}` : `This year: ${now}`, '', lang === 'ja' ? '元号と西暦の対応:' : 'The eras:', ...rows, '', pick(lang, WAREKI_NOTE)].join('\n'),
    }
  }
  const western = /^(\d{1,4})\s*年?$/.exec(raw)
  if (western !== null) {
    const y = Number(western[1])
    if (y < 1868) {
      return { error: lang === 'ja' ? `${y} 年は対象外です: 1868 年（明治元年）以降の年を指定してください。` : `${y} is out of range: give a year from 1868 (Meiji 1) on.` }
    }
    return { text: [yearToWareki(y, lang), '', pick(lang, WAREKI_NOTE)].join('\n') }
  }
  const m = /^([^\d\s元]+?)\s*(元|\d{1,4})\s*年?$/.exec(raw)
  const index = m === null ? -1 : ERA_NAMES.findIndex(names => names.includes(m[1]!))
  if (m === null || index < 0) {
    return { error: lang === 'ja' ? `和暦・西暦として読めません: ${WAREKI_TEXT.ja} を指定してください。` : `Not a year: give ${WAREKI_TEXT.en}.` }
  }
  const era = ERAS[index]!
  const n = m[2] === '元' ? 1 : Number(m[2])
  const last = lastEraYear(index)
  if (n < 1 || n > last) {
    return {
      error:
        index === ERAS.length - 1
          ? lang === 'ja'
            ? `${era.ja}は元年以降の年を指定してください（西暦 9999 年まで）。`
            : `${era.en} begins with year 1: give year 1 or later (up to 9999 AD).`
          : lang === 'ja'
            ? `${era.ja}は元年から ${last} 年までです。`
            : `${era.en} runs from year 1 to ${last}.`,
    }
  }
  const y = era.start.y + n - 1
  // A year two eras share is shown with the days of each.
  const shared = y > ERAS[0]!.start.y && ERAS.some(e => e.start.y === y)
  const lines = [`${eraYear(era, n, lang)} = ${lang === 'ja' ? `${y}年` : y}`, ...(shared ? [yearToWareki(y, lang)] : [])]
  return { text: [...lines, '', pick(lang, WAREKI_NOTE)].join('\n') }
}

/** The share of [start, end) gone by at `now`, from 0 to 1. */
const shareOf = (now: number, start: number, end: number) => (end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0)

/** `[########------------] 41.2%`: 20 ASCII columns and the percentage rounded down to one decimal. */
export function progressBar(share: number): string {
  const filled = Math.floor(share * 20)
  const pct = (Math.floor(share * 1000) / 10).toFixed(1)
  return `[${'#'.repeat(filled)}${'-'.repeat(20 - filled)}] ${pct}%`
}

/**
 * How much of this year, month, week and day has gone by. The week starts on
 * Monday at 0:00, as an ISO week does; each period runs from one local
 * midnight to another (a day a clock change falls on is measured in real time).
 */
export const yearProgress = (input: LocalInput): LocalOutput => {
  const { now, lang } = input
  const off = input.utcOffsetMinutes
  const today = localDay(now, off)
  const at = (day: Day) => localMidnight(day, off)
  const monday = addDays(today, -((weekday(today) + 6) % 7))
  const sunday = addDays(monday, 6)
  const nextMonth = today.m === 12 ? { y: today.y + 1, m: 1, d: 1 } : { y: today.y, m: today.m + 1, d: 1 }
  const year = progressBar(shareOf(now, at({ y: today.y, m: 1, d: 1 }), at({ y: today.y + 1, m: 1, d: 1 })))
  const month = progressBar(shareOf(now, at({ y: today.y, m: today.m, d: 1 }), at(nextMonth)))
  const week = progressBar(shareOf(now, at(monday), at(addDays(monday, 7))))
  const dayBar = progressBar(shareOf(now, at(today), at(addDays(today, 1))))
  if (lang === 'ja') {
    return {
      text: [
        `今年（${today.y}年）: ${year}`,
        `今月（${today.m}月）: ${month}`,
        `今週（${monday.m}/${monday.d}〜${sunday.m}/${sunday.d}、月曜始まり）: ${week}`,
        `今日（${today.m}/${today.d}）: ${dayBar}`,
      ].join('\n'),
    }
  }
  return {
    text: [
      `This year (${today.y}): ${year}`,
      `This month (${MONTH_EN_LONG[today.m - 1]}): ${month}`,
      `This week (${MONTH_EN[monday.m - 1]} ${monday.d} to ${MONTH_EN[sunday.m - 1]} ${sunday.d}, from Monday): ${week}`,
      `Today (${MONTH_EN[today.m - 1]} ${today.d}): ${dayBar}`,
    ].join('\n'),
  }
}

/** The local time a duration from now (one hour by default), with the date when it is not today. */
export const timeAfter = (input: LocalInput): LocalOutput => {
  const { arg, now, lang } = input
  if (!isDuration(arg)) return invalid(lang, DURATION_TEXT)
  const start = localFields(now, input)
  const end = localFields(now + arg, input)
  const time = (f: { h: number; mi: number; s: number }) => `${two(f.h)}:${two(f.mi)}:${two(f.s)}`
  const days = daysBetween(start.day, end.day)
  const words = durationWords(arg, lang)
  if (lang === 'ja') {
    const when = days === 0 ? '' : `${days === 1 ? '明日 ' : ''}${formatDay(end.day, 'ja')} `
    return { text: [`今: ${time(start)}`, `${words}後: ${when}${time(end)}`].join('\n') }
  }
  const when = days === 0 ? '' : `${days === 1 ? 'tomorrow, ' : ''}${formatDay(end.day, 'en')} `
  return { text: [`Now: ${time(start)}`, `In ${words}: ${when}${time(end)}`].join('\n') }
}

/** `PT1H30M`: the hours, minutes and seconds that are not zero (`PT0S` for none). */
export function isoDuration(ms: number): string {
  const h = Math.floor(ms / HOUR)
  const m = Math.floor((ms % HOUR) / MINUTE)
  const s = (ms % MINUTE) / SECOND
  const parts = `${h > 0 ? `${h}H` : ''}${m > 0 ? `${m}M` : ''}${s > 0 ? `${decimal(s)}S` : ''}`
  return `PT${parts === '' ? '0S' : parts}`
}

/** A duration (90 minutes by default) as hours, minutes and seconds, in each unit in total, and in ISO 8601. */
export const durationConvert = (input: LocalInput): LocalOutput => {
  const { arg, lang } = input
  if (!isDuration(arg)) return invalid(lang, DURATION_TEXT)
  const h = Math.floor(arg / HOUR)
  const m = Math.floor((arg % HOUR) / MINUTE)
  const s = decimal((arg % MINUTE) / SECOND)
  if (lang === 'ja') {
    return {
      text: [
        `${h} 時間 ${m} 分 ${s} 秒`,
        `時間: ${decimal(arg / HOUR)}`,
        `分: ${decimal(arg / MINUTE)}`,
        `秒: ${decimal(arg / SECOND)}`,
        `ミリ秒: ${arg}`,
        `ISO 8601: ${isoDuration(arg)}`,
      ].join('\n'),
    }
  }
  return {
    text: [
      `${h} h ${m} min ${s} s`,
      `Hours: ${decimal(arg / HOUR)}`,
      `Minutes: ${decimal(arg / MINUTE)}`,
      `Seconds: ${decimal(arg / SECOND)}`,
      `Milliseconds: ${arg}`,
      `ISO 8601: ${isoDuration(arg)}`,
    ].join('\n'),
  }
}

export const SLEEP_CYCLE_MINUTES = 90
export const FALL_ASLEEP_MINUTES = 15

/** Bedtimes for the wake-up time given (7:00 by default): 6 down to 3 sleep cycles of 90 minutes, 15 minutes to fall asleep. */
export const sleepCalc = (input: LocalInput): LocalOutput => {
  const { arg, lang } = input
  if (!isTime(arg)) return invalid(lang, TIME_TEXT)
  const rows = [6, 5, 4, 3].map(n => {
    const bed = arg - FALL_ASLEEP_MINUTES - n * SLEEP_CYCLE_MINUTES
    const sleep = n * SLEEP_CYCLE_MINUTES
    const length = `${Math.floor(sleep / 60)}:${two(sleep % 60)}`
    const before = bed < 0
    return lang === 'ja'
      ? `就寝 ${hhmm(bed)}${before ? '（前日）' : ''} → ${n} 周期（睡眠 ${length}）`
      : `Bed at ${hhmm(bed)}${before ? ' (the day before)' : ''} → ${n} cycles (${length} of sleep)`
  })
  if (lang === 'ja') {
    return {
      text: [
        `起床 ${hhmm(arg)} の就寝時刻の目安（睡眠周期 90 分、寝付くまで 15 分）:`,
        ...rows,
        '',
        '※ 目安です。睡眠周期には個人差があります。',
      ].join('\n'),
    }
  }
  return {
    text: [
      `Bedtimes to wake up at ${hhmm(arg)} (sleep cycles of 90 minutes, 15 minutes to fall asleep):`,
      ...rows,
      '',
      'Note: a rough guide only; sleep cycles vary from person to person.',
    ].join('\n'),
  }
}

/** The mean synodic month, in days. */
export const SYNODIC_MONTH = 29.530588853
/** A new moon to count from: 2000-01-06 18:14 UTC. */
export const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14)

const PHASES: readonly Texts[] = [
  { ja: '新月', en: 'new moon' },
  { ja: '三日月', en: 'waxing crescent' },
  { ja: '上弦の月', en: 'first quarter' },
  { ja: '満ちていく月', en: 'waxing gibbous' },
  { ja: '満月', en: 'full moon' },
  { ja: '欠けていく月', en: 'waning gibbous' },
  { ja: '下弦の月', en: 'last quarter' },
  { ja: '有明月', en: 'waning crescent' },
]

/** The moon's age in days at `ms` (from 0 up to the synodic month), by the mean synodic month. */
export const moonAge = (ms: number) => {
  const days = (ms - NEW_MOON_EPOCH) / DAY
  return ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH
}

/** The phase's index, 0 (new) to 7: the four main phases each at the middle of its eighth. */
export const moonPhaseIndex = (age: number) => Math.floor((age / SYNODIC_MONTH) * 8 + 0.5) % 8

/** The moon's age now, its phase, and the days to the next new and full moon; roughly, by the mean synodic month. */
export const moonPhase = (input: LocalInput): LocalOutput => {
  const { now, lang } = input
  const age = moonAge(now)
  const phase = pick(lang, PHASES[moonPhaseIndex(age)]!)
  const toNew = SYNODIC_MONTH - age
  const half = SYNODIC_MONTH / 2
  const toFullRaw = (((half - age) % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH
  const toFull = toFullRaw === 0 ? SYNODIC_MONTH : toFullRaw
  const dayAfter = (days: number) => formatDay(localDay(now + days * DAY, input.utcOffsetMinutes), lang)
  if (lang === 'ja') {
    return {
      text: [
        `月齢: ${age.toFixed(1)}`,
        `月相: ${phase}`,
        `次の新月まで: 約 ${toNew.toFixed(1)} 日（${dayAfter(toNew)}ごろ）`,
        `次の満月まで: 約 ${toFull.toFixed(1)} 日（${dayAfter(toFull)}ごろ）`,
        '',
        '※ 平均朔望月による概算です（±1 日程度ずれることがあります）。',
      ].join('\n'),
    }
  }
  return {
    text: [
      `Moon age: ${age.toFixed(1)} days`,
      `Phase: ${phase}`,
      `Next new moon: in about ${toNew.toFixed(1)} days (around ${dayAfter(toNew)})`,
      `Next full moon: in about ${toFull.toFixed(1)} days (around ${dayAfter(toFull)})`,
      '',
      'Note: a rough estimate from the mean synodic month (it can be off by about a day).',
    ].join('\n'),
  }
}
