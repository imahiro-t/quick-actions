import { expect, test } from 'claude-code/testing'

import { LOCAL_TEXT_LIMIT, TICKER_MAX_MS, TICKER_MIN_INTERVAL_MS } from '../hooks/actions'
import type { LocalAction, LocalInput, LocalOutput } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { clampInterval, localInputFor, runLocal, tickerStep } from '../hooks/local'
import type { LocalSource } from '../hooks/local'

// What a local action's run decides, checked directly: register.tsx only does
// what these say. No built-in runs locally on the selection yet, so these
// definitions are the tests' own and never join ACTIONS.

const SOURCE: LocalSource = {
  text: 'SELECTED TEXT',
  arg: 42,
  now: 1_000_000,
  timeZone: 'Asia/Tokyo',
  lang: 'en',
  utcOffsetMinutes: () => 540,
  random: () => 0.25,
  randomBytes: n => new Uint8Array(n).fill(1),
}

const on = (compute: (input: LocalInput) => LocalOutput, target?: 'none'): LocalAction => ({
  id: 'test-local',
  icon: '🧪',
  label: 'Test',
  kind: 'local',
  ...(target === undefined ? {} : { target }),
  compute,
})

const echo = on(input => ({ text: `${input.text ?? '-'}|${input.arg ?? '-'}` }))
const echoStandalone = on(input => ({ text: `${input.text ?? '-'}|${input.arg ?? '-'}` }), 'none')

test('localInputFor: on the selection, the text and no argument', () => {
  const input = localInputFor(echo, SOURCE)
  expect(input.text).toBe('SELECTED TEXT')
  expect(input.arg).toBeUndefined()
  expect(input).toMatchObject({ now: 1_000_000, timeZone: 'Asia/Tokyo', lang: 'en' })
  expect(input.utcOffsetMinutes(0)).toBe(540)
  expect(input.random()).toBe(0.25)
  expect([...input.randomBytes(3)]).toEqual([1, 1, 1])
})

test('localInputFor: standalone, the argument and never the text, though one is passed', () => {
  const input = localInputFor(echoStandalone, SOURCE)
  expect(input.text).toBeUndefined()
  expect(input.arg).toBe(42)
  expect(input.now).toBe(1_000_000)
  expect(localInputFor(echoStandalone, { ...SOURCE, arg: undefined }).arg).toBeUndefined()
})

test('runLocal: a text is the result as it is; an action on the selection gets the selected text', () => {
  const r = runLocal(echo, localInputFor(echo, SOURCE), { selection: true, lang: 'en' })
  expect(r).toEqual({ kind: 'settle', ok: true, text: 'SELECTED TEXT|-' })
  const s = runLocal(echoStandalone, localInputFor(echoStandalone, SOURCE), { selection: false, lang: 'en' })
  expect(s).toEqual({ kind: 'settle', ok: true, text: '-|42' })
})

test('runLocal: a result past 20,000 characters is cut there and marked, in each language', () => {
  expect(LOCAL_TEXT_LIMIT).toBe(20_000)
  const exact = on(() => ({ text: 'a'.repeat(20_000) }))
  expect(runLocal(exact, localInputFor(exact, SOURCE), { selection: true, lang: 'en' })).toEqual({ kind: 'settle', ok: true, text: 'a'.repeat(20_000) })
  const over = on(() => ({ text: `${'a'.repeat(20_000)}b` }))
  for (const lang of ['ja', 'en'] as const) {
    const r = runLocal(over, localInputFor(over, SOURCE), { selection: true, lang })
    expect(r).toEqual({ kind: 'settle', ok: true, text: `${'a'.repeat(20_000)}\n${MESSAGES[lang].truncated}` })
  }
  expect(MESSAGES.ja.truncated).toBe('（以下省略）')
  expect(MESSAGES.en.truncated).toBe('(truncated)')
})

test('runLocal: an error, a throw and a promise are failures', () => {
  const error = on(() => ({ error: 'the units do not match' }))
  expect(runLocal(error, localInputFor(error, SOURCE), { selection: true, lang: 'en' })).toEqual({ kind: 'settle', ok: false, text: 'the units do not match' })
  const thrown = on(() => {
    throw new Error('broken')
  })
  expect(runLocal(thrown, localInputFor(thrown, SOURCE), { selection: true, lang: 'ja' })).toEqual({ kind: 'settle', ok: false, text: MESSAGES.ja.failed('broken') })
  const later = on(() => Promise.resolve({ text: 'late' }) as unknown as LocalOutput)
  expect(runLocal(later, localInputFor(later, SOURCE), { selection: true, lang: 'en' })).toEqual({
    kind: 'settle',
    ok: false,
    text: MESSAGES.en.failed(MESSAGES.en.localAsync),
  })
  const odd = on(() => 42 as unknown as LocalOutput)
  expect(runLocal(odd, localInputFor(odd, SOURCE), { selection: true, lang: 'en' })).toMatchObject({ kind: 'settle', ok: false })
})

test('runLocal: a run over time is a standalone action\'s only; its period is at least 250 ms', () => {
  const frame = () => ({ text: 'tick', done: false })
  const fast = on(() => ({ ticker: { intervalMs: 100, frame } }))
  // On the selection: a failure, in the language.
  for (const lang of ['ja', 'en'] as const) {
    expect(runLocal(fast, localInputFor(fast, SOURCE), { selection: true, lang })).toEqual({
      kind: 'settle',
      ok: false,
      text: MESSAGES[lang].failed(MESSAGES[lang].localTickerOnSelection),
    })
  }
  // Standalone: a run, its period raised to the shortest allowed.
  const standalone = on(() => ({ ticker: { intervalMs: 100, frame } }), 'none')
  const r = runLocal(standalone, localInputFor(standalone, SOURCE), { selection: false, lang: 'en' })
  expect(r.kind).toBe('ticker')
  if (r.kind === 'ticker') {
    expect(r.intervalMs).toBe(250)
    expect(r.frame).toBe(frame)
  }
  const second = on(() => ({ ticker: { intervalMs: 1000, frame } }), 'none')
  expect(runLocal(second, localInputFor(second, SOURCE), { selection: false, lang: 'en' })).toMatchObject({ kind: 'ticker', intervalMs: 1000 })
})

test('clampInterval: 250 at least, and for a period that is no number', () => {
  expect(TICKER_MIN_INTERVAL_MS).toBe(250)
  expect(clampInterval(100)).toBe(250)
  expect(clampInterval(250)).toBe(250)
  expect(clampInterval(1000)).toBe(1000)
  expect(clampInterval(Number.NaN)).toBe(250)
  expect(clampInterval(-5)).toBe(250)
})

test('tickerStep: same, show, done (with its toast), the 24-hour limit and a frame that throws', () => {
  const frame = (now: number) => ({ text: now < 3000 ? 'A' : 'B', done: now >= 5000, ...(now >= 5000 ? { toast: 'over' } : {}) })
  expect(tickerStep(frame, { startedAt: 0, now: 1000, lastText: undefined })).toEqual({ kind: 'show', text: 'A' })
  expect(tickerStep(frame, { startedAt: 0, now: 2000, lastText: 'A' })).toEqual({ kind: 'same' })
  expect(tickerStep(frame, { startedAt: 0, now: 3000, lastText: 'A' })).toEqual({ kind: 'show', text: 'B' })
  expect(tickerStep(frame, { startedAt: 0, now: 5000, lastText: 'B' })).toEqual({ kind: 'done', text: 'B', toast: 'over' })
  // Done with no toast of its own: the generic one is register's to say.
  expect(tickerStep(() => ({ text: 'x', done: true }), { startedAt: 0, now: 1, lastText: 'x' })).toEqual({ kind: 'done', text: 'x' })
  // 24 hours on, still not done: the limit.
  expect(TICKER_MAX_MS).toBe(24 * 60 * 60 * 1000)
  const forever = () => ({ text: 'running', done: false })
  expect(tickerStep(forever, { startedAt: 0, now: TICKER_MAX_MS - 1, lastText: 'running' })).toEqual({ kind: 'same' })
  expect(tickerStep(forever, { startedAt: 0, now: TICKER_MAX_MS, lastText: 'running' })).toEqual({ kind: 'limit' })
  expect(
    tickerStep(
      () => {
        throw new Error('bad frame')
      },
      { startedAt: 0, now: 1, lastText: undefined },
    ),
  ).toEqual({ kind: 'failed', reason: 'bad frame' })
})
