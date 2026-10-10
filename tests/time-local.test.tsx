import { expect, test } from 'claude-code/testing'

import { ACTIONS, LOCAL_TEXT_LIMIT } from '../hooks/actions'
import type { LocalInput, LocalOutput, TickerFrame } from '../hooks/actions'
import { DURATION_MAX_MS, localMidnight } from '../hooks/args'
import {
  NEW_MOON_EPOCH,
  SYNODIC_MONTH,
  breathing,
  businessDays,
  calendar,
  clock,
  countdownTo,
  dateInfo,
  dateOffset,
  durationConvert,
  eto,
  eyeRest,
  isoDuration,
  isoWeek,
  moonAge,
  moonPhase,
  moonPhaseIndex,
  pomodoro,
  progressBar,
  sleepCalc,
  stopwatch,
  timeAfter,
  toWareki,
  wallToInstant,
  wareki,
  weekday,
  weekdaysAfter,
  yearProgress,
} from '../hooks/time-local'

const JST = () => 540
// Saturday 10 October 2026, 12:00 in Tokyo.
const NOW = Date.UTC(2026, 9, 10, 3, 0, 0)

const BASE: LocalInput = {
  text: undefined,
  arg: undefined,
  now: NOW,
  timeZone: 'Asia/Tokyo',
  lang: 'ja',
  utcOffsetMinutes: JST,
  random: () => 0.5,
  randomBytes: n => new Uint8Array(n).fill(7),
}

const input = (over: Partial<LocalInput>): LocalInput => ({ ...BASE, ...over })

/** A `date` argument as register.tsx passes it: the local midnight of the day. */
const date = (y: number, m: number, d: number) => localMidnight({ y, m, d }, JST)

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function textOf(out: LocalOutput): string {
  if (!('text' in out)) throw new Error(`not a text: ${JSON.stringify(out)}`)
  return out.text
}

function frameOf(out: LocalOutput): (now: number) => TickerFrame {
  if (!('ticker' in out)) throw new Error(`not a ticker: ${JSON.stringify(out)}`)
  expect(out.ticker.intervalMs).toBe(1000)
  return out.ticker.frame
}

/** The frame's text and whether it is done, with no toast of its own (the generic one says it is over). */
function show(frame: (now: number) => TickerFrame, at: number): [string, boolean] {
  const f = frame(at)
  expect('toast' in f).toBe(false)
  return [f.text, f.done]
}

const isError = (out: LocalOutput) => Object.keys(out).length === 1 && typeof (out as Record<string, unknown>).error === 'string'

// ---------------------------------------------------------------------------
// Arguments: a compute that takes one answers `{ error }` for one of another
// type or out of its range (never falling back to the default), and runs on
// the bounds of its range.

type Compute = (input: LocalInput) => LocalOutput
const ARG_CASES: readonly (readonly [string, Compute, readonly unknown[], readonly unknown[]])[] = [
  ['pomodoro', pomodoro, [undefined, '4', 0, 9, 1.5, Number.NaN], [1, 8]],
  ['date-offset', dateOffset, [undefined, '30', 36501, -36501, 0.5], [-36500, 0, 36500]],
  ['countdown-to', countdownTo, [undefined, '18:00', -1, 1440, 1.5], [0, 1439]],
  ['sleep-calc', sleepCalc, [undefined, '07:00', -1, 1440, 1.5], [0, 1439]],
  ['breathing', breathing, [undefined, 4, '447', 'BOX'], ['box', '478']],
  ['calendar', calendar, [undefined, 'today', Number.NaN, Number.POSITIVE_INFINITY, date(10000, 1, 1), date(0, 12, 31)], [date(1, 1, 1), date(9999, 12, 31)]],
  ['date-info', dateInfo, [undefined, 'today', Number.NaN, date(10000, 1, 1), date(0, 12, 31)], [date(1, 1, 1), date(9999, 12, 31)]],
  ['business-days', businessDays, [undefined, '+1m', Number.NaN, date(10000, 1, 1), date(0, 12, 31)], [date(1, 1, 1), date(9999, 12, 31)]],
  ['time-after', timeAfter, [undefined, '1h', 0, 999, -1000, DURATION_MAX_MS + 1, Number.NaN], [1000, DURATION_MAX_MS]],
  ['duration-convert', durationConvert, [undefined, '90m', 0, 999, DURATION_MAX_MS + 1, Number.NaN], [1000, DURATION_MAX_MS]],
  ['wareki', wareki, [2026, 0], [undefined, '2026']],
]

test('each that takes an argument answers { error } for one of another type or out of range, and runs on its bounds', () => {
  for (const [id, compute, bad, good] of ARG_CASES) {
    for (const lang of ['ja', 'en'] as const) {
      for (const arg of bad) {
        const out = compute(input({ arg: arg as LocalInput['arg'], lang }))
        if (!isError(out)) throw new Error(`${id} took ${String(arg)}: ${JSON.stringify(out)}`)
        const error = (out as { error: string }).error
        expect(error.startsWith(lang === 'ja' ? '引数が正しくありません: ' : 'Invalid argument: ')).toBe(true)
      }
      for (const arg of good) {
        const out = compute(input({ arg: arg as LocalInput['arg'], lang }))
        if (isError(out)) throw new Error(`${id} refused ${String(arg)}: ${JSON.stringify(out)}`)
      }
    }
  }
})

test('those that take no argument answer the same with one or none (register.tsx refuses one before compute)', () => {
  for (const compute of [clock, yearProgress, moonPhase]) {
    expect(compute(input({ arg: 'x' }))).toEqual(compute(input({ arg: undefined })))
  }
  for (const compute of [stopwatch, eyeRest]) {
    const a = frameOf(compute(input({ arg: 'x' })))
    const b = frameOf(compute(input({ arg: undefined })))
    for (const at of [NOW, NOW + 5000, NOW + 20_000, NOW + HOUR]) expect(a(at)).toEqual(b(at))
  }
})

// ---------------------------------------------------------------------------
// Runs over time.

test('stopwatch: counts up as mm:ss, h:mm:ss from an hour, and is never done by itself', () => {
  const frame = frameOf(stopwatch(BASE))
  expect(show(frame, NOW)).toEqual(['🏃 00:00 経過', false])
  expect(show(frame, NOW + 59_999)).toEqual(['🏃 00:59 経過', false])
  expect(show(frame, NOW + HOUR - 1)).toEqual(['🏃 59:59 経過', false])
  expect(show(frame, NOW + HOUR)).toEqual(['🏃 1:00:00 経過', false])
  expect(show(frame, NOW + DAY)).toEqual(['🏃 24:00:00 経過', false])
  expect(show(frameOf(stopwatch(input({ lang: 'en' }))), NOW + 61_000)).toEqual(['🏃 01:01 elapsed', false])
})

test('pomodoro: 25 minutes of work and 5 of break, N times; done at the end of the last break', () => {
  const frame = frameOf(pomodoro(input({ arg: 4 })))
  expect(show(frame, NOW)).toEqual(['🍅 作業 1/4 残り 25:00', false])
  expect(show(frame, NOW + 25 * MIN - 1)).toEqual(['🍅 作業 1/4 残り 00:01', false])
  expect(show(frame, NOW + 25 * MIN)).toEqual(['☕ 休憩 1/4 残り 05:00', false])
  expect(show(frame, NOW + 30 * MIN - 1)).toEqual(['☕ 休憩 1/4 残り 00:01', false])
  expect(show(frame, NOW + 30 * MIN)).toEqual(['🍅 作業 2/4 残り 25:00', false])
  expect(show(frame, NOW + 120 * MIN - 1)).toEqual(['☕ 休憩 4/4 残り 00:01', false])
  expect(show(frame, NOW + 120 * MIN)).toEqual(['🍅 全 4 回 終了', true])
  const one = frameOf(pomodoro(input({ arg: 1 })))
  expect(show(one, NOW + 30 * MIN - 1)).toEqual(['☕ 休憩 1/1 残り 00:01', false])
  expect(show(one, NOW + 30 * MIN)).toEqual(['🍅 全 1 回 終了', true])
  const eight = frameOf(pomodoro(input({ arg: 8, lang: 'en' })))
  expect(show(eight, NOW)).toEqual(['🍅 Work 1/8 · 25:00 left', false])
  expect(show(eight, NOW + 235 * MIN)).toEqual(['☕ Break 8/8 · 05:00 left', false])
  expect(show(eight, NOW + 240 * MIN)).toEqual(['🍅 All 8 rounds done', true])
  expect(show(frameOf(pomodoro(input({ arg: 1, lang: 'en' }))), NOW + 30 * MIN)).toEqual(['🍅 All 1 round done', true])
})

test('countdown-to: to today\'s time, or tomorrow\'s when it is now or past; done when it is reached', () => {
  // 18:00 in Tokyo is 09:00 UTC.
  const frame = frameOf(countdownTo(input({ arg: 18 * 60 })))
  const target = Date.UTC(2026, 9, 10, 9, 0)
  expect(show(frame, NOW)).toEqual(['🔜 18:00 まで 残り 6:00:00', false])
  expect(show(frame, target - 1)).toEqual(['🔜 18:00 まで 残り 00:01', false])
  expect(show(frame, target)).toEqual(['🔜 18:00 になりました', true])
  // 9:00 has passed: tomorrow's.
  expect(show(frameOf(countdownTo(input({ arg: 9 * 60 }))), NOW)).toEqual(['🔜 明日 09:00 まで 残り 21:00:00', false])
  // The very time it is now: tomorrow's, not done at once.
  expect(show(frameOf(countdownTo(input({ arg: 12 * 60 }))), NOW)).toEqual(['🔜 明日 12:00 まで 残り 24:00:00', false])
  expect(show(frameOf(countdownTo(input({ arg: 18 * 60, lang: 'en' }))), NOW)).toEqual(['🔜 6:00:00 left until 18:00', false])
  expect(show(frameOf(countdownTo(input({ arg: 9 * 60, lang: 'en' }))), NOW)).toEqual(['🔜 21:00:00 left until 09:00 tomorrow', false])
})

test('wallToInstant: a local wall time on a day a clock change falls on', () => {
  // New York: -4 h until 2026-11-01 06:00 UTC, -5 h after.
  const ny = (ms: number) => (ms < Date.UTC(2026, 10, 1, 6) ? -240 : -300)
  expect(wallToInstant({ y: 2026, m: 11, d: 1 }, 30, ny)).toBe(Date.UTC(2026, 10, 1, 4, 30))
  expect(wallToInstant({ y: 2026, m: 11, d: 1 }, 12 * 60, ny)).toBe(Date.UTC(2026, 10, 1, 17, 0))
  expect(wallToInstant({ y: 2026, m: 10, d: 10 }, 18 * 60, JST)).toBe(Date.UTC(2026, 9, 10, 9, 0))
})

test('breathing: box and 478, each phase counted down a second at a time; done after four cycles', () => {
  const box = frameOf(breathing(input({ arg: 'box' })))
  const s = (n: number) => NOW + n * 1000
  expect(show(box, s(0))).toEqual(['🫁 吸う 4 秒（サイクル 1/4）', false])
  expect(show(box, s(1))).toEqual(['🫁 吸う 3 秒（サイクル 1/4）', false])
  expect(show(box, s(3) + 999)).toEqual(['🫁 吸う 1 秒（サイクル 1/4）', false])
  expect(show(box, s(4))).toEqual(['🫁 止める 4 秒（サイクル 1/4）', false])
  expect(show(box, s(8))).toEqual(['🫁 吐く 4 秒（サイクル 1/4）', false])
  expect(show(box, s(12))).toEqual(['🫁 止める 4 秒（サイクル 1/4）', false])
  expect(show(box, s(16))).toEqual(['🫁 吸う 4 秒（サイクル 2/4）', false])
  expect(show(box, s(63))).toEqual(['🫁 止める 1 秒（サイクル 4/4）', false])
  expect(show(box, s(64))).toEqual(['🫁 4 サイクル終了', true])
  const b478 = frameOf(breathing(input({ arg: '478', lang: 'en' })))
  expect(show(b478, s(0))).toEqual(['🫁 Breathe in · 4 s (cycle 1/4)', false])
  expect(show(b478, s(4))).toEqual(['🫁 Hold · 7 s (cycle 1/4)', false])
  expect(show(b478, s(11))).toEqual(['🫁 Breathe out · 8 s (cycle 1/4)', false])
  expect(show(b478, s(18))).toEqual(['🫁 Breathe out · 1 s (cycle 1/4)', false])
  expect(show(b478, s(19))).toEqual(['🫁 Breathe in · 4 s (cycle 2/4)', false])
  expect(show(b478, s(75))).toEqual(['🫁 Breathe out · 1 s (cycle 4/4)', false])
  expect(show(b478, s(76))).toEqual(['🫁 4 cycles done', true])
})

test('eye-rest: 20 seconds counted down, rounded up; done at zero', () => {
  const frame = frameOf(eyeRest(BASE))
  expect(show(frame, NOW)).toEqual(['👀 遠くを見てください 残り 20 秒', false])
  expect(show(frame, NOW + 1)).toEqual(['👀 遠くを見てください 残り 20 秒', false])
  expect(show(frame, NOW + 19_000)).toEqual(['👀 遠くを見てください 残り 1 秒', false])
  expect(show(frame, NOW + 19_999)).toEqual(['👀 遠くを見てください 残り 1 秒', false])
  expect(show(frame, NOW + 20_000)).toEqual(['👀 20 秒の休憩が終わりました', true])
  expect(show(frameOf(eyeRest(input({ lang: 'en' }))), NOW + 5000)).toEqual(['👀 Look at something far away · 15 s left', false])
})

// ---------------------------------------------------------------------------
// The clock and the calendar.

test('clock: local time, UTC, ISO 8601, UNIX time, weekday, ISO week and day of the year', () => {
  const seconds = NOW / 1000
  expect(textOf(clock(BASE))).toBe(
    [
      'ローカル: 2026年10月10日（土） 12:00:00 UTC+09:00（Asia/Tokyo）',
      'UTC: 2026年10月10日（土） 03:00:00',
      'ISO 8601: 2026-10-10T12:00:00+09:00 / 2026-10-10T03:00:00.000Z',
      `UNIX 時刻: ${seconds}（秒） / ${NOW}（ミリ秒）`,
      '曜日: 土曜日',
      'ISO 週番号: 2026-W41',
      '通算日: 283 日目（365 日中）',
    ].join('\n'),
  )
  expect(textOf(clock(input({ lang: 'en' })))).toBe(
    [
      'Local: Sat, 10 Oct 2026 12:00:00 UTC+09:00 (Asia/Tokyo)',
      'UTC: Sat, 10 Oct 2026 03:00:00',
      'ISO 8601: 2026-10-10T12:00:00+09:00 / 2026-10-10T03:00:00.000Z',
      `UNIX time: ${seconds} (seconds) / ${NOW} (milliseconds)`,
      'Weekday: Saturday',
      'ISO week: 2026-W41',
      'Day of the year: 283 of 365',
    ].join('\n'),
  )
  // West of UTC, the local day is the day before.
  const west = textOf(clock(input({ utcOffsetMinutes: () => -300, timeZone: 'America/New_York', now: NOW + 123 })))
  expect(west).toContain('ローカル: 2026年10月9日（金） 22:00:00 UTC-05:00（America/New_York）')
  expect(west).toContain('2026-10-09T22:00:00-05:00 / 2026-10-10T03:00:00.123Z')
  expect(west).toContain('曜日: 金曜日')
})

test('ISO weeks across the turn of the year', () => {
  expect(isoWeek({ y: 2026, m: 12, d: 31 })).toEqual({ year: 2026, week: 53 })
  expect(isoWeek({ y: 2027, m: 1, d: 1 })).toEqual({ year: 2026, week: 53 })
  expect(isoWeek({ y: 2027, m: 1, d: 4 })).toEqual({ year: 2027, week: 1 })
  expect(isoWeek({ y: 2024, m: 12, d: 30 })).toEqual({ year: 2025, week: 1 })
  expect(isoWeek({ y: 2026, m: 1, d: 1 })).toEqual({ year: 2026, week: 1 })
  expect(isoWeek({ y: 2026, m: 10, d: 10 })).toEqual({ year: 2026, week: 41 })
})

test('calendar: the month, Sunday first, the day given marked with an asterisk', () => {
  expect(textOf(calendar(input({ arg: date(2026, 10, 10) })))).toBe(
    [
      '2026年10月',
      '  日  月  火  水  木  金  土',
      '                   1   2   3',
      '   4   5   6   7   8   9 *10',
      '  11  12  13  14  15  16  17',
      '  18  19  20  21  22  23  24',
      '  25  26  27  28  29  30  31',
      '',
      '*10 = 2026年10月10日（土）',
    ].join('\n'),
  )
  const en = textOf(calendar(input({ arg: date(2026, 10, 1), lang: 'en' }))).split('\n')
  expect(en[0]).toBe('October 2026')
  expect(en[1]).toBe('  Su  Mo  Tu  We  Th  Fr  Sa')
  expect(en[2]).toBe('                  *1   2   3')
  expect(en.at(-1)).toBe('*1 = Thu, 1 Oct 2026')
  // February: 29 days in a leap year, 28 otherwise (February 2026 starts on a Sunday: four full rows).
  const leap = textOf(calendar(input({ arg: date(2024, 2, 29) })))
  expect(leap).toContain(' *29')
  expect(leap).not.toContain('30')
  const feb = textOf(calendar(input({ arg: date(2026, 2, 1) }))).split('\n')
  expect(feb.slice(2, 6)).toEqual([
    '  *1   2   3   4   5   6   7',
    '   8   9  10  11  12  13  14',
    '  15  16  17  18  19  20  21',
    '  22  23  24  25  26  27  28',
  ])
  expect(feb[6]).toBe('')
  // A two-digit day given keeps every cell four columns wide and stays apart from the day before.
  const rows = textOf(calendar(input({ arg: date(2026, 10, 17), lang: 'en' }))).split('\n').slice(2, -2)
  for (const row of rows) expect(row.length).toBeLessThanOrEqual(7 * 4)
  expect(rows).toContain('  11  12  13  14  15  16 *17')
  expect(rows.join('\n')).not.toMatch(/\d\*/)
})

test('date-info: weekday, ISO week, day of the year, days left, from today, era and sexagenary year', () => {
  expect(textOf(dateInfo(input({ arg: date(2026, 10, 10) })))).toBe(
    [
      '2026年10月10日（土）',
      '曜日: 土曜日',
      'ISO 週番号: 2026-W41',
      '通算日: 283 日目（365 日中）',
      '年末まで: 82 日',
      '今日から: 今日',
      '和暦: 令和8年',
      '干支: 丙午（ひのえうま）',
      '※ 干支は暦年で数えた概算です（立春は考慮していません）。',
    ].join('\n'),
  )
  const info = (y: number, m: number, d: number, lang: 'ja' | 'en' = 'ja') => textOf(dateInfo(input({ arg: date(y, m, d), lang })))
  expect(info(2019, 4, 30)).toContain('和暦: 平成31年')
  expect(info(2019, 5, 1)).toContain('和暦: 令和元年')
  expect(info(1989, 1, 7)).toContain('和暦: 昭和64年')
  expect(info(1989, 1, 8)).toContain('和暦: 平成元年')
  expect(info(1868, 10, 23)).toContain('和暦: 明治元年')
  expect(info(1868, 10, 22)).toContain('和暦: 対象外（明治より前）')
  expect(info(2026, 12, 31)).toContain('年末まで: 0 日')
  expect(info(2024, 12, 31)).toContain('通算日: 366 日目（366 日中）')
  expect(info(2026, 11, 9)).toContain('今日から: 30 日後')
  expect(info(2026, 10, 5)).toContain('今日から: 5 日前')
  expect(info(2026, 10, 11, 'en')).toContain('From today: in 1 day')
  expect(info(2026, 10, 5, 'en')).toContain('From today: 5 days ago')
  expect(info(2026, 10, 10, 'en')).toContain('Japanese era: Reiwa 8')
  expect(info(2026, 10, 10, 'en')).toContain('Sexagenary year: 丙午 (Yang Fire Horse)')
  expect(eto(1984, 'ja')).toBe('甲子（きのえね）')
  expect(eto(2026, 'ja')).toBe('丙午（ひのえうま）')
  expect(eto(1, 'en')).toBe('辛酉 (Yin Metal Rooster)')
  expect(toWareki({ y: 1868, m: 10, d: 22 })).toBeUndefined()
})

test('date-offset: N days from today, in weeks and roughly in months', () => {
  expect(textOf(dateOffset(input({ arg: 30 })))).toBe(['30 日後: 2026年11月9日（月）', '30 日 = 4 週 2 日', '約 1.0 か月後'].join('\n'))
  expect(textOf(dateOffset(input({ arg: 0 })))).toBe(['今日: 2026年10月10日（土）', '0 日 = 0 週 0 日'].join('\n'))
  expect(textOf(dateOffset(input({ arg: -1 })))).toBe(['1 日前: 2026年10月9日（金）', '1 日 = 0 週 1 日', '約 0.0 か月前'].join('\n'))
  expect(textOf(dateOffset(input({ arg: 36500 })))).toContain('36500 日後: 2126年')
  expect(textOf(dateOffset(input({ arg: -36500 })))).toContain('36500 日前: 1926年')
  expect(textOf(dateOffset(input({ arg: 30, lang: 'en' })))).toBe(
    ['30 days from today: Mon, 9 Nov 2026', '30 days = 4 weeks 2 days', 'About 1.0 month from today'].join('\n'),
  )
  expect(textOf(dateOffset(input({ arg: -1, lang: 'en' })))).toBe(
    ['1 day before today: Fri, 9 Oct 2026', '1 day = 0 weeks 1 day', 'About 0.0 months before today'].join('\n'),
  )
  expect(textOf(dateOffset(input({ arg: 0, lang: 'en' })))).toBe(['Today: Sat, 10 Oct 2026', '0 days = 0 weeks 0 days'].join('\n'))
  expect(textOf(dateOffset(input({ arg: -31, lang: 'en' })))).toContain('About 1.0 month before today')
  expect(textOf(dateOffset(input({ arg: 61, lang: 'en' })))).toContain('About 2.0 months from today')
})

test('business-days: calendar days and weekdays to the date, today not counted; holidays not taken into account', () => {
  const run = (y: number, m: number, d: number) => textOf(businessDays(input({ arg: date(y, m, d) })))
  expect(run(2026, 10, 10)).toBe(
    ['今日 2026年10月10日（土） → 2026年10月10日（土）', '日数: 0 日（今日）', '平日: 0 日（土日を除く）', '※ 祝日は考慮していません（土日以外を平日として数えています）。'].join('\n'),
  )
  // A month from today (the default): Sunday 11 October to Tuesday 10 November.
  expect(run(2026, 11, 10)).toContain('日数: 31 日後（今日を含めず、指定日を含む）')
  expect(run(2026, 11, 10)).toContain('平日: 22 日（土日を除く）')
  // Over a weekend: Sunday and Monday.
  expect(run(2026, 10, 12)).toContain('平日: 1 日')
  // Behind: Monday 5 to Friday 9 October.
  expect(run(2026, 10, 5)).toContain('日数: 5 日前（指定日を含め、今日を含めない）')
  expect(run(2026, 10, 5)).toContain('平日: 5 日')
  const en = textOf(businessDays(input({ arg: date(2026, 11, 10), lang: 'en' })))
  expect(en).toContain('Days: 31 days ahead')
  expect(en).toContain('Weekdays: 22 days')
  expect(en).toContain('public holidays are not taken into account')
  // Over decades, as counted day by day.
  const count = (from: { y: number; m: number; d: number }, n: number) => {
    let k = 0
    for (let i = 1; i <= n; i++) {
      const w = (weekday(from) + i) % 7
      if (w !== 0 && w !== 6) k++
    }
    return k
  }
  const ahead = (Date.UTC(2060, 0, 1) - Date.UTC(2026, 9, 10)) / DAY
  const behind = (Date.UTC(2026, 9, 10) - Date.UTC(1990, 2, 3)) / DAY
  expect(run(2060, 1, 1)).toContain(`日数: ${ahead} 日後`)
  expect(run(2060, 1, 1)).toContain(`平日: ${count({ y: 2026, m: 10, d: 10 }, ahead)} 日`)
  expect(run(1990, 3, 3)).toContain(`日数: ${behind} 日前`)
  expect(run(1990, 3, 3)).toContain(`平日: ${count({ y: 1990, m: 3, d: 2 }, behind)} 日`)
  for (let start = 0; start < 7; start++) {
    for (let n = 0; n < 30; n++) {
      let k = 0
      for (let i = 1; i <= n; i++) if ((start + i) % 7 !== 0 && (start + i) % 7 !== 6) k++
      expect(weekdaysAfter(start, n)).toBe(k)
    }
  }
})

test('wareki: years to eras and back; with none, this year and the table', () => {
  const run = (arg: string | undefined, lang: 'ja' | 'en' = 'ja') => wareki(input({ arg, lang }))
  const first = (arg: string | undefined, lang: 'ja' | 'en' = 'ja') => textOf(run(arg, lang)).split('\n')[0]
  expect(first('2026')).toBe('2026年 = 令和8年')
  expect(first('2026年')).toBe('2026年 = 令和8年')
  expect(first('2019')).toBe('2019年 = 平成31年（〜4/30）／令和元年（5/1〜）')
  expect(first('1989')).toBe('1989年 = 昭和64年（〜1/7）／平成元年（1/8〜）')
  expect(first('1926')).toBe('1926年 = 大正15年（〜12/24）／昭和元年（12/25〜）')
  expect(first('1912')).toBe('1912年 = 明治45年（〜7/29）／大正元年（7/30〜）')
  expect(first('1868')).toBe('1868年 = 明治元年')
  expect(first('9999')).toBe('9999年 = 令和7981年')
  for (const s of ['令和8', '令和8年', 'R8', 'r8', 'Reiwa 8', 'reiwa8', 'ｒ８', '令和 8 年']) expect(first(s)).toBe('令和8年 = 2026年')
  expect(textOf(run('令和元年'))).toContain('令和元年 = 2019年\n2019年 = 平成31年（〜4/30）／令和元年（5/1〜）')
  expect(first('H31')).toBe('平成31年 = 2019年')
  expect(first('昭和64')).toBe('昭和64年 = 1989年')
  expect(first('M45')).toBe('明治45年 = 1912年')
  expect(first('Taisho 1')).toBe('大正元年 = 1912年')
  expect(first('2019', 'en')).toBe('2019 = Heisei 31 (to Apr 30) / Reiwa 1 (from May 1)')
  expect(first('Reiwa 8', 'en')).toBe('Reiwa 8 = 2026')
  for (const s of ['令和0', '平成32', '明治46', '大正16', '1867', '0', 'abc', 'X8', '令和', '20260']) {
    for (const lang of ['ja', 'en'] as const) expect(isError(run(s, lang))).toBe(true)
  }
  // A closed era names its last year; the current one only its first.
  expect(run('平成32')).toEqual({ error: '平成は元年から 31 年までです。' })
  expect(run('令和0')).toEqual({ error: '令和は元年以降の年を指定してください（西暦 9999 年まで）。' })
  expect(run('令和0', 'en')).toEqual({ error: 'Reiwa begins with year 1: give year 1 or later (up to 9999 AD).' })
  const none = textOf(run(undefined))
  expect(none).toContain('今年: 2026年 = 令和8年')
  expect(none).toContain('明治（M）: 1868年10月23日 から（元年 = 1868年）、45 年まで')
  expect(none).toContain('平成（H）: 1989年1月8日 から（元年 = 1989年）、31 年まで')
  expect(none).toContain('令和（R）: 2019年5月1日 から（元年 = 2019年）')
  expect(none).toContain('旧暦')
  expect(textOf(run(undefined, 'en'))).toContain('Reiwa (R): from 1 May 2019 (year 1 = 2019)')
  expect(textOf(run(''))).toBe(none)
})

test('year-progress: the year, month, week (from Monday 0:00) and day gone by, as 20-column bars', () => {
  expect(textOf(yearProgress(BASE))).toBe(
    [
      '今年（2026年）: [###############-----] 77.3%',
      '今月（10月）: [######--------------] 30.6%',
      '今週（10/5〜10/11、月曜始まり）: [###############-----] 78.5%',
      '今日（10/10）: [##########----------] 50.0%',
    ].join('\n'),
  )
  const week = (now: number) => textOf(yearProgress(input({ now }))).split('\n')[2]
  // Monday 5 October, 0:00 in Tokyo: the week has just begun.
  expect(week(Date.UTC(2026, 9, 4, 15, 0))).toBe('今週（10/5〜10/11、月曜始まり）: [--------------------] 0.0%')
  // Sunday 11 October, noon: the last day of the week that began on Monday (not the first of one from Sunday).
  expect(week(Date.UTC(2026, 9, 11, 3, 0))).toBe('今週（10/5〜10/11、月曜始まり）: [##################--] 92.8%')
  // Sunday 23:59:59.999: not yet the next week.
  expect(week(Date.UTC(2026, 9, 11, 14, 59, 59, 999))).toBe('今週（10/5〜10/11、月曜始まり）: [###################-] 99.9%')
  // The turn of the year in Tokyo.
  const newYear = textOf(yearProgress(input({ now: Date.UTC(2026, 11, 31, 15, 0) }))).split('\n')
  expect(newYear[0]).toBe('今年（2027年）: [--------------------] 0.0%')
  const lastMs = textOf(yearProgress(input({ now: Date.UTC(2026, 11, 31, 14, 59, 59, 999) }))).split('\n')
  expect(lastMs[0]).toBe('今年（2026年）: [###################-] 99.9%')
  expect(lastMs[1]).toBe('今月（12月）: [###################-] 99.9%')
  // A day a clock change falls on lasts 25 hours: 11:30 in New York on 1 November is halfway.
  const ny = (ms: number) => (ms < Date.UTC(2026, 10, 1, 6) ? -240 : -300)
  expect(textOf(yearProgress(input({ now: Date.UTC(2026, 10, 1, 16, 30), utcOffsetMinutes: ny }))).split('\n')[3]).toBe(
    '今日（11/1）: [##########----------] 50.0%',
  )
  expect(textOf(yearProgress(input({ lang: 'en' })))).toContain('This week (Oct 5 to Oct 11, from Monday): [###############-----] 78.5%')
  for (const share of [0, 0.049, 0.05, 0.5, 0.999, 1]) expect(progressBar(share)).toMatch(/^\[[#-]{20}\] \d+\.\d%$/)
  expect(progressBar(1)).toBe('[####################] 100.0%')
})

test('time-after: the local time a duration from now, with the date when it is another day', () => {
  expect(textOf(timeAfter(input({ arg: HOUR })))).toBe(['今: 12:00:00', '1 時間後: 13:00:00'].join('\n'))
  expect(textOf(timeAfter(input({ arg: 90 * MIN })))).toBe(['今: 12:00:00', '1 時間 30 分後: 13:30:00'].join('\n'))
  expect(textOf(timeAfter(input({ arg: 1000 })))).toBe(['今: 12:00:00', '1 秒後: 12:00:01'].join('\n'))
  expect(textOf(timeAfter(input({ arg: 13 * HOUR })))).toBe(['今: 12:00:00', '13 時間後: 明日 2026年10月11日（日） 01:00:00'].join('\n'))
  expect(textOf(timeAfter(input({ arg: DURATION_MAX_MS })))).toBe(['今: 12:00:00', '24 時間後: 明日 2026年10月11日（日） 12:00:00'].join('\n'))
  expect(textOf(timeAfter(input({ arg: 13 * HOUR, lang: 'en' })))).toBe(['Now: 12:00:00', 'In 13 h: tomorrow, Sun, 11 Oct 2026 01:00:00'].join('\n'))
})

test('duration-convert: h m s, totals in each unit, ISO 8601', () => {
  expect(textOf(durationConvert(input({ arg: 90 * MIN })))).toBe(
    ['1 時間 30 分 0 秒', '時間: 1.5', '分: 90', '秒: 5400', 'ミリ秒: 5400000', 'ISO 8601: PT1H30M'].join('\n'),
  )
  expect(textOf(durationConvert(input({ arg: 1000, lang: 'en' })))).toBe(
    ['0 h 0 min 1 s', 'Hours: 0.000278', 'Minutes: 0.016667', 'Seconds: 1', 'Milliseconds: 1000', 'ISO 8601: PT1S'].join('\n'),
  )
  expect(textOf(durationConvert(input({ arg: DURATION_MAX_MS })))).toContain('ISO 8601: PT24H')
  expect(isoDuration(HOUR + 5000)).toBe('PT1H5S')
  expect(isoDuration(1500)).toBe('PT1.5S')
  expect(isoDuration(0)).toBe('PT0S')
})

test('sleep-calc: bedtimes 6 to 3 cycles of 90 minutes before waking, 15 minutes to fall asleep', () => {
  expect(textOf(sleepCalc(input({ arg: 7 * 60 })))).toBe(
    [
      '起床 07:00 の就寝時刻の目安（睡眠周期 90 分、寝付くまで 15 分）:',
      '就寝 21:45（前日） → 6 周期（睡眠 9:00）',
      '就寝 23:15（前日） → 5 周期（睡眠 7:30）',
      '就寝 00:45 → 4 周期（睡眠 6:00）',
      '就寝 02:15 → 3 周期（睡眠 4:30）',
      '',
      '※ 目安です。睡眠周期には個人差があります。',
    ].join('\n'),
  )
  const one = textOf(sleepCalc(input({ arg: 60, lang: 'en' })))
  expect(one).toContain('Bed at 15:45 (the day before) → 6 cycles (9:00 of sleep)')
  expect(one).toContain('Bed at 20:15 (the day before) → 3 cycles (4:30 of sleep)')
  expect(one).toContain('a rough guide only')
  expect(textOf(sleepCalc(input({ arg: 1439 })))).toContain('就寝 14:44 → 6 周期')
})

test('moon-phase: age, phase in eight, next new and full moon; a rough estimate', () => {
  const at = (age: number) => NEW_MOON_EPOCH + age * DAY
  const ja = textOf(moonPhase(input({ now: NEW_MOON_EPOCH })))
  expect(ja).toContain('月齢: 0.0')
  expect(ja).toContain('月相: 新月')
  expect(ja).toContain('次の新月まで: 約 29.5 日（2000年2月5日（土）ごろ）')
  expect(ja).toContain('次の満月まで: 約 14.8 日（2000年1月21日（金）ごろ）')
  expect(ja).toContain('平均朔望月による概算')
  expect(textOf(moonPhase(input({ now: at(14.77) })))).toContain('月相: 満月')
  const ja8 = ['新月', '三日月', '上弦の月', '満ちていく月', '満月', '欠けていく月', '下弦の月', '有明月']
  const en8 = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent']
  for (let k = 0; k < 8; k++) {
    const now = at((k * SYNODIC_MONTH) / 8)
    expect(textOf(moonPhase(input({ now })))).toContain(`月相: ${ja8[k]}`)
    expect(textOf(moonPhase(input({ now, lang: 'en' })))).toContain(`Phase: ${en8[k]}`)
    // Each eighth runs 1/16 of a month either side.
    const edge = ((2 * k + 1) * SYNODIC_MONTH) / 16
    expect(moonPhaseIndex(edge - 0.01)).toBe(k)
    expect(moonPhaseIndex(edge + 0.01)).toBe((k + 1) % 8)
  }
  // Before the epoch, the age is still from 0 up.
  expect(Math.abs(moonAge(NEW_MOON_EPOCH - DAY) - (SYNODIC_MONTH - 1))).toBeLessThan(1e-6)
  expect(textOf(moonPhase(input({ now: NEW_MOON_EPOCH - DAY })))).toContain('月相: 新月')
  expect(textOf(moonPhase(input({ now: NEW_MOON_EPOCH - 10 * DAY })))).toContain('月相: 欠けていく月')
  const full = textOf(moonPhase(input({ now: at(SYNODIC_MONTH / 2 + 0.001), lang: 'en' })))
  expect(full).toContain('Next new moon: in about 14.8 days')
  expect(full).toContain('Next full moon: in about 29.5 days')
})

// ---------------------------------------------------------------------------
// As defined.

const BY_ID: Record<string, Compute> = {
  stopwatch,
  pomodoro,
  'countdown-to': countdownTo,
  breathing,
  'eye-rest': eyeRest,
  clock,
  calendar,
  'date-info': dateInfo,
  'date-offset': dateOffset,
  'business-days': businessDays,
  wareki,
  'year-progress': yearProgress,
  'time-after': timeAfter,
  'duration-convert': durationConvert,
  'sleep-calc': sleepCalc,
  'moon-phase': moonPhase,
}

test('each ACTIONS entry runs this module\'s compute, and every answer is within the limit', () => {
  for (const [id, compute] of Object.entries(BY_ID)) {
    const spec = ACTIONS.find(a => a.id === id)
    if (spec?.kind !== 'local') throw new Error(`${id} is not local`)
    expect(spec.compute).toBe(compute)
  }
  for (const out of [wareki(BASE), calendar(input({ arg: date(2026, 10, 10) })), clock(BASE)]) {
    expect(textOf(out).length).toBeLessThan(LOCAL_TEXT_LIMIT)
  }
})
