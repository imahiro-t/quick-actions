import { expect, test } from './kit'

import { TEXT_ARG_LIMIT, formatClock, localMidnight, parseArg, splitCommandArgs, utcLabel } from '../hooks/args'
import type { ArgEnv, ArgSpec } from '../hooks/args'

// The argument of a standalone action: each kind parsed by hand-written rules,
// its default when none is given. The time and the local offset are fixed
// here, so nothing depends on the machine's clock or time zone.

const S = 1000
const M = 60 * S
const H = 60 * M
const D = 24 * H

// 2026-10-10 03:00 UTC: 12:00 in Tokyo (+9), 22:00 the day before in New York (-5).
const NOW = Date.UTC(2026, 9, 10, 3, 0, 0)
const fixed = (minutes: number) => () => minutes
const TOKYO: ArgEnv = { now: NOW, utcOffsetMinutes: fixed(540) }
const NEW_YORK: ArgEnv = { now: NOW, utcOffsetMinutes: fixed(-300) }
const UTC: ArgEnv = { now: NOW, utcOffsetMinutes: fixed(0) }

const spec = (s: Omit<ArgSpec, 'hint'>): ArgSpec => ({ hint: 'how', ...s })
const ok = (value: unknown) => ({ ok: true, value })
const NO = { ok: false }

test('duration: units, clocks and bare minutes, in ms', () => {
  const d = spec({ type: 'duration', default: '25m' })
  expect(parseArg(d, '90s', UTC)).toEqual(ok(90 * S))
  expect(parseArg(d, '5m', UTC)).toEqual(ok(5 * M))
  expect(parseArg(d, '5M', UTC)).toEqual(ok(5 * M))
  expect(parseArg(d, '1h30m', UTC)).toEqual(ok(90 * M))
  expect(parseArg(d, '1h2m3s', UTC)).toEqual(ok(H + 2 * M + 3 * S))
  expect(parseArg(d, '2h', UTC)).toEqual(ok(2 * H))
  // A unit may carry over; the total is bounded.
  expect(parseArg(d, '1h90m', UTC)).toEqual(ok(150 * M))
  expect(parseArg(d, '25', UTC)).toEqual(ok(25 * M))
  expect(parseArg(d, '5:00', UTC)).toEqual(ok(5 * M))
  expect(parseArg(d, '0:30', UTC)).toEqual(ok(30 * S))
  expect(parseArg(d, '1:02:03', UTC)).toEqual(ok(H + 2 * M + 3 * S))
  expect(parseArg(d, ' 10m ', UTC)).toEqual(ok(10 * M))
})

test('duration: not valid out of order, twice a unit, past the bounds, or written otherwise', () => {
  const d = spec({ type: 'duration', default: '25m' })
  for (const bad of ['0', '0s', '0:00', '25h', '24h1s', '1441', '1:60', '1:00:60', '1:60:00', 'm', '5x', '30m1h', '1m1m', '-5m', '1.5m', '5 m', 'abc', '1e3']) {
    expect(parseArg(d, bad, UTC)).toEqual(NO)
  }
  // The bounds: 1 second and 24 hours.
  expect(parseArg(d, '1s', UTC)).toEqual(ok(S))
  expect(parseArg(d, '24h', UTC)).toEqual(ok(D))
  expect(parseArg(d, '1440', UTC)).toEqual(ok(D))
  // A spec's own bounds narrow them, never widen.
  const narrow = spec({ type: 'duration', default: '5m', min: M, max: 10 * M })
  expect(parseArg(narrow, '30s', UTC)).toEqual(NO)
  expect(parseArg(narrow, '11m', UTC)).toEqual(NO)
  expect(parseArg(narrow, '10m', UTC)).toEqual(ok(10 * M))
  const wide = spec({ type: 'duration', default: '5m', max: 2 * D })
  expect(parseArg(wide, '25h', UTC)).toEqual(NO)
})

test('none given (or blank): the default, parsed the same way', () => {
  const d = spec({ type: 'duration', default: '25m' })
  expect(parseArg(d, undefined, UTC)).toEqual(ok(25 * M))
  expect(parseArg(d, '', UTC)).toEqual(ok(25 * M))
  expect(parseArg(d, '   ', UTC)).toEqual(ok(25 * M))
  // A default that is no value is not one either; no default and not text: not valid.
  expect(parseArg(spec({ type: 'duration', default: 'soon' }), undefined, UTC)).toEqual(NO)
  expect(parseArg(spec({ type: 'int', min: 1, max: 9 }), undefined, UTC)).toEqual(NO)
})

test('int: signed whole numbers within the bounds', () => {
  const i = spec({ type: 'int', default: '6', min: -3, max: 100 })
  expect(parseArg(i, undefined, UTC)).toEqual(ok(6))
  expect(parseArg(i, '42', UTC)).toEqual(ok(42))
  expect(parseArg(i, '-3', UTC)).toEqual(ok(-3))
  expect(parseArg(i, '+7', UTC)).toEqual(ok(7))
  expect(parseArg(i, '-0', UTC)).toEqual(ok(0))
  for (const bad of ['-4', '101', '1.5', '1e2', '0x10', 'six', '', '9'.repeat(20)]) {
    if (bad === '') continue
    expect(parseArg(i, bad, UTC)).toEqual(NO)
  }
})

test('number: decimals with a point, no exponent; bounds when given', () => {
  const n = spec({ type: 'number', default: '1.5' })
  expect(parseArg(n, undefined, UTC)).toEqual(ok(1.5))
  expect(parseArg(n, '3.14', UTC)).toEqual(ok(3.14))
  expect(parseArg(n, '-0.5', UTC)).toEqual(ok(-0.5))
  expect(parseArg(n, '.5', UTC)).toEqual(ok(0.5))
  expect(parseArg(n, '12', UTC)).toEqual(ok(12))
  for (const bad of ['1e3', '1.', 'NaN', 'Infinity', '0x1', '1,5', '--1']) expect(parseArg(n, bad, UTC)).toEqual(NO)
  const bounded = spec({ type: 'number', default: '0', min: 0, max: 1 })
  expect(parseArg(bounded, '1.01', UTC)).toEqual(NO)
  expect(parseArg(bounded, '-0.01', UTC)).toEqual(NO)
  expect(parseArg(bounded, '1', UTC)).toEqual(ok(1))
})

test('date: the local midnight of the day, by the offset given', () => {
  const d = spec({ type: 'date', default: 'today' })
  // Tokyo: it is 10 October, 12:00; its midnight is 9 October 15:00 UTC.
  expect(parseArg(d, undefined, TOKYO)).toEqual(ok(Date.UTC(2026, 9, 9, 15)))
  expect(parseArg(d, 'today', TOKYO)).toEqual(ok(Date.UTC(2026, 9, 9, 15)))
  expect(parseArg(d, 'tomorrow', TOKYO)).toEqual(ok(Date.UTC(2026, 9, 10, 15)))
  expect(parseArg(d, 'Yesterday', TOKYO)).toEqual(ok(Date.UTC(2026, 9, 8, 15)))
  // New York: still 9 October there; its midnight is 9 October 05:00 UTC.
  expect(parseArg(d, 'today', NEW_YORK)).toEqual(ok(Date.UTC(2026, 9, 9, 5)))
  expect(parseArg(d, 'today', UTC)).toEqual(ok(Date.UTC(2026, 9, 10)))
  expect(parseArg(d, '2026-12-25', UTC)).toEqual(ok(Date.UTC(2026, 11, 25)))
  expect(parseArg(d, '2026/12/25', TOKYO)).toEqual(ok(Date.UTC(2026, 11, 24, 15)))
  expect(parseArg(d, '2024-02-29', UTC)).toEqual(ok(Date.UTC(2024, 1, 29)))
  // Years 1 to 9999.
  const year1 = new Date(0)
  year1.setUTCFullYear(1, 0, 1)
  expect(parseArg(d, '0001-01-01', UTC)).toEqual(ok(year1.getTime()))
  expect(parseArg(d, '9999-12-31', UTC)).toEqual(ok(Date.UTC(9999, 11, 31)))
  for (const bad of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '0000-01-01', '2026-1-1x', '2026-10/10', '10/10/2026', 'next week', '+d']) {
    expect(parseArg(d, bad, UTC)).toEqual(NO)
  }
})

test('date: relative days, weeks and months from today; a month end is kept to the shorter month', () => {
  const d = spec({ type: 'date', default: 'today' })
  expect(parseArg(d, '+3d', UTC)).toEqual(ok(Date.UTC(2026, 9, 13)))
  expect(parseArg(d, '-10d', UTC)).toEqual(ok(Date.UTC(2026, 8, 30)))
  expect(parseArg(d, '+2w', UTC)).toEqual(ok(Date.UTC(2026, 9, 24)))
  expect(parseArg(d, '-1w', TOKYO)).toEqual(ok(Date.UTC(2026, 9, 2, 15)))
  expect(parseArg(d, '+1m', UTC)).toEqual(ok(Date.UTC(2026, 10, 10)))
  expect(parseArg(d, '-12m', UTC)).toEqual(ok(Date.UTC(2025, 9, 10)))
  // 31 January + 1 month: 28 February (29 in a leap year).
  const jan31: ArgEnv = { now: Date.UTC(2026, 0, 31, 12), utcOffsetMinutes: fixed(0) }
  expect(parseArg(d, '+1m', jan31)).toEqual(ok(Date.UTC(2026, 1, 28)))
  const jan31leap: ArgEnv = { now: Date.UTC(2028, 0, 31, 12), utcOffsetMinutes: fixed(0) }
  expect(parseArg(d, '+1m', jan31leap)).toEqual(ok(Date.UTC(2028, 1, 29)))
  // Past year 9999: not valid.
  expect(parseArg(d, '+99999m', UTC)).toEqual(NO)
})

test('date: a day a clock change falls on starts at its own midnight', () => {
  // An offset of +1 h before 2026-03-29 01:00 UTC and +2 h from then (as in central Europe).
  const change = Date.UTC(2026, 2, 29, 1)
  const offset = (ms: number) => (ms < change ? 60 : 120)
  const env: ArgEnv = { now: Date.UTC(2026, 2, 29, 12), utcOffsetMinutes: offset }
  // Its midnight was still at +1: 28 March 23:00 UTC.
  expect(parseArg(spec({ type: 'date', default: 'today' }), undefined, env)).toEqual(ok(Date.UTC(2026, 2, 28, 23)))
  // The next day's, at +2: 29 March 22:00 UTC.
  expect(parseArg(spec({ type: 'date', default: 'today' }), 'tomorrow', env)).toEqual(ok(Date.UTC(2026, 2, 29, 22)))
  expect(localMidnight({ y: 2026, m: 3, d: 30 }, offset)).toBe(Date.UTC(2026, 2, 29, 22))
})

test('time: HH:MM on the 24-hour clock, as minutes since midnight', () => {
  const t = spec({ type: 'time', default: '9:00' })
  expect(parseArg(t, undefined, UTC)).toEqual(ok(540))
  expect(parseArg(t, '09:05', UTC)).toEqual(ok(545))
  expect(parseArg(t, '9:05', UTC)).toEqual(ok(545))
  expect(parseArg(t, '00:00', UTC)).toEqual(ok(0))
  expect(parseArg(t, '23:59', UTC)).toEqual(ok(1439))
  for (const bad of ['24:00', '12:60', '1230', '12:5', '-1:00', '9am', '12:00:00']) expect(parseArg(t, bad, UTC)).toEqual(NO)
})

test('choice: one of its values, case aside, as the lowercase value', () => {
  const c = spec({ type: 'choice', default: 'v4', choices: ['v4', 'v7'] })
  expect(parseArg(c, undefined, UTC)).toEqual(ok('v4'))
  expect(parseArg(c, 'V7', UTC)).toEqual(ok('v7'))
  expect(parseArg(c, 'v5', UTC)).toEqual(NO)
  expect(parseArg(spec({ type: 'choice', default: 'a' }), 'a', UTC)).toEqual(NO)
})

test('text: trimmed, optional with no default, up to 500 characters', () => {
  const optional = spec({ type: 'text' })
  expect(parseArg(optional, undefined, UTC)).toEqual(ok(undefined))
  expect(parseArg(optional, '   ', UTC)).toEqual(ok(undefined))
  expect(parseArg(optional, '  Tea Ceremony ', UTC)).toEqual(ok('Tea Ceremony'))
  expect(parseArg(spec({ type: 'text', default: 'cats' }), undefined, UTC)).toEqual(ok('cats'))
  expect(TEXT_ARG_LIMIT).toBe(500)
  expect(parseArg(optional, 'x'.repeat(500), UTC)).toEqual(ok('x'.repeat(500)))
  expect(parseArg(optional, 'x'.repeat(501), UTC)).toEqual(NO)
  // Counted in characters, not UTF-16 units: 500 emoji are fine.
  expect(parseArg(optional, '🍵'.repeat(500), UTC)).toEqual(ok('🍵'.repeat(500)))
})

test('parseArg never throws: an offset function that does is not valid', () => {
  const env: ArgEnv = {
    now: NOW,
    utcOffsetMinutes: () => {
      throw new Error('no offset')
    },
  }
  expect(parseArg(spec({ type: 'date', default: 'today' }), undefined, env)).toEqual(NO)
})

test('splitCommandArgs: the ID lowercased, the rest after the first space kept as written', () => {
  expect(splitCommandArgs('')).toEqual({ id: '', arg: undefined })
  expect(splitCommandArgs('   ')).toEqual({ id: '', arg: undefined })
  expect(splitCommandArgs('timer')).toEqual({ id: 'timer', arg: undefined })
  expect(splitCommandArgs(' TIMER ')).toEqual({ id: 'timer', arg: undefined })
  expect(splitCommandArgs('TIMER 5M')).toEqual({ id: 'timer', arg: '5M' })
  expect(splitCommandArgs('ideas  Tea Ceremony  ')).toEqual({ id: 'ideas', arg: 'Tea Ceremony' })
  // A full-width space or a tab splits too.
  expect(splitCommandArgs('timer　5m')).toEqual({ id: 'timer', arg: '5m' })
  expect(splitCommandArgs('timer\t5m')).toEqual({ id: 'timer', arg: '5m' })
  expect(splitCommandArgs('　ideas　お茶　の話　')).toEqual({ id: 'ideas', arg: 'お茶　の話' })
  expect(splitCommandArgs('ideas line one\nline two')).toEqual({ id: 'ideas', arg: 'line one\nline two' })
})

test('formatClock: mm:ss, h:mm:ss from an hour, whole seconds, never below zero', () => {
  expect(formatClock(0)).toBe('00:00')
  expect(formatClock(999)).toBe('00:00')
  expect(formatClock(1000)).toBe('00:01')
  expect(formatClock(5 * M)).toBe('05:00')
  expect(formatClock(25 * M)).toBe('25:00')
  expect(formatClock(H - S)).toBe('59:59')
  expect(formatClock(H)).toBe('1:00:00')
  expect(formatClock(90 * M + 5 * S)).toBe('1:30:05')
  expect(formatClock(D)).toBe('24:00:00')
  expect(formatClock(-5 * S)).toBe('00:00')
  expect(formatClock(Number.NaN)).toBe('00:00')
})

test('utcLabel: the offset as UTC±hh:mm', () => {
  expect(utcLabel(540)).toBe('UTC+09:00')
  expect(utcLabel(-300)).toBe('UTC-05:00')
  expect(utcLabel(0)).toBe('UTC+00:00')
  expect(utcLabel(345)).toBe('UTC+05:45')
  expect(utcLabel(-570)).toBe('UTC-09:30')
})
