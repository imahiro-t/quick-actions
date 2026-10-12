import { expect, test } from 'claude-code/testing'

import { LOCAL_SELECTION_LIMIT, LOCAL_TEXT_LIMIT, TICKER_MAX_MS, TICKER_MIN_INTERVAL_MS, messageOf, textOf } from '../hooks/actions'
import type { LocalAction, LocalInput, LocalOutput } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { clampInterval, localInputFor, runLocal, tickerStep, truncate } from '../hooks/local'
import type { LocalSource } from '../hooks/local'

// What a local action's run decides, checked directly: register.tsx only does
// what these say. These definitions are the tests' own and never join ACTIONS;
// the built-in local actions on the selection are run through register.tsx's
// run() in the stage tests of tests/selection-local.test.tsx.

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

test('runLocal: an error past 20,000 characters is cut there and marked too', () => {
  const over = on(() => ({ error: `${'e'.repeat(20_000)}x` }))
  for (const lang of ['ja', 'en'] as const) {
    const r = runLocal(over, localInputFor(over, SOURCE), { selection: true, lang })
    expect(r).toEqual({ kind: 'settle', ok: false, text: `${'e'.repeat(20_000)}\n${MESSAGES[lang].truncated}` })
  }
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
  expect(tickerStep(frame, { startedAt: 0, now: 1000, lastText: undefined, lang: 'en' })).toEqual({ kind: 'show', text: 'A' })
  expect(tickerStep(frame, { startedAt: 0, now: 2000, lastText: 'A', lang: 'en' })).toEqual({ kind: 'same' })
  expect(tickerStep(frame, { startedAt: 0, now: 3000, lastText: 'A', lang: 'en' })).toEqual({ kind: 'show', text: 'B' })
  expect(tickerStep(frame, { startedAt: 0, now: 5000, lastText: 'B', lang: 'en' })).toEqual({ kind: 'done', text: 'B', toast: 'over' })
  // Done with no toast of its own: the generic one is register's to say.
  expect(tickerStep(() => ({ text: 'x', done: true }), { startedAt: 0, now: 1, lastText: 'x', lang: 'en' })).toEqual({ kind: 'done', text: 'x' })
  // 24 hours on, still not done: the limit.
  expect(TICKER_MAX_MS).toBe(24 * 60 * 60 * 1000)
  const forever = () => ({ text: 'running', done: false })
  expect(tickerStep(forever, { startedAt: 0, now: TICKER_MAX_MS - 1, lastText: 'running', lang: 'en' })).toEqual({ kind: 'same' })
  expect(tickerStep(forever, { startedAt: 0, now: TICKER_MAX_MS, lastText: 'running', lang: 'en' })).toEqual({ kind: 'limit' })
  expect(
    tickerStep(
      () => {
        throw new Error('bad frame')
      },
      { startedAt: 0, now: 1, lastText: undefined, lang: 'en' },
    ),
  ).toEqual({ kind: 'failed', reason: 'bad frame' })
})

test('truncate: counts code points, so an emoji on the limit is kept whole or left out whole, never split', () => {
  const emoji = '😀'
  expect(emoji.length).toBe(2)
  const marker = `\n${MESSAGES.en.truncated}`
  // 20,000 characters (20,001 code units, the emoji last): within the limit, as it is.
  const atLimit = `${'a'.repeat(LOCAL_TEXT_LIMIT - 1)}${emoji}`
  expect(truncate(atLimit, 'en')).toBe(atLimit)
  // One more: cut after the emoji, which stays whole.
  expect(truncate(`${atLimit}b`, 'en')).toBe(`${atLimit}${marker}`)
  // The emoji is the 20,001st character, its first half the 20,000th code unit: left out whole.
  const across = `${'a'.repeat(LOCAL_TEXT_LIMIT - 1)}b${emoji}`
  expect(truncate(across, 'en')).toBe(`${'a'.repeat(LOCAL_TEXT_LIMIT - 1)}b${marker}`)
  // Emoji only: 20,000 of them kept, and no lone surrogate before the mark.
  const out = truncate(emoji.repeat(LOCAL_TEXT_LIMIT + 1), 'ja')
  expect(out).toBe(`${emoji.repeat(LOCAL_TEXT_LIMIT)}\n${MESSAGES.ja.truncated}`)
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false)
  // 20,000 emoji (40,000 code units) are within the limit.
  expect(truncate(emoji.repeat(LOCAL_TEXT_LIMIT), 'en')).toBe(emoji.repeat(LOCAL_TEXT_LIMIT))
})

test('textOf / messageOf: any value as text, never throwing', () => {
  const bare = Object.create(null) as object
  const throwing = {
    toString() {
      throw new Error('no text')
    },
  }
  expect(textOf(42)).toBe('42')
  expect(textOf(undefined)).toBe('undefined')
  expect(textOf(bare)).toBe('[object]')
  expect(textOf(throwing)).toBe('[object]')
  expect(messageOf(new Error('boom'))).toBe('boom')
  expect(messageOf(bare)).toBe('[object]')
  const badMessage = new Error('x')
  Object.defineProperty(badMessage, 'message', {
    get() {
      throw new Error('no message')
    },
  })
  expect(typeof messageOf(badMessage)).toBe('string')
})

test('runLocal: never throws, whatever the compute answers or throws', () => {
  const failed = (compute: () => unknown) => {
    const r = runLocal(on(compute as (input: LocalInput) => LocalOutput, 'none'), localInputFor({ target: 'none' }, SOURCE), {
      selection: false,
      lang: 'en',
    })
    expect(r.kind).toBe('settle')
    expect(r.kind === 'settle' && r.ok).toBe(false)
  }
  // An answer with no prototype, one whose toString throws, a getter that throws.
  failed(() => Object.create(null))
  failed(() => ({
    toString() {
      throw new Error('no text')
    },
  }))
  failed(() => ({
    get text(): string {
      throw new Error('no text')
    },
  }))
  // A throw of a value with no prototype.
  failed(() => {
    throw Object.create(null)
  })
})

test('tickerStep: never throws on a frame of no known shape, and cuts a frame past the limit', () => {
  const at = { startedAt: 0, now: 1, lastText: undefined, lang: 'en' as const }
  expect(tickerStep(() => Object.create(null), at)).toEqual({ kind: 'failed', reason: '[object]' })
  expect(
    tickerStep(
      () =>
        ({
          get text(): string {
            throw new Error('no text')
          },
          done: false,
        }) as { text: string; done: boolean },
      at,
    ),
  ).toEqual({ kind: 'failed', reason: 'no text' })
  const long = 'x'.repeat(LOCAL_TEXT_LIMIT + 5)
  const cut = `${'x'.repeat(LOCAL_TEXT_LIMIT)}\n${MESSAGES.ja.truncated}`
  expect(tickerStep(() => ({ text: long, done: false }), { ...at, lang: 'ja' })).toEqual({ kind: 'show', text: cut })
  expect(tickerStep(() => ({ text: long, done: true }), { ...at, lang: 'ja' })).toEqual({ kind: 'done', text: cut })
  // The cut text is what is compared with the last one shown.
  expect(tickerStep(() => ({ text: long, done: false }), { ...at, lang: 'ja', lastText: cut })).toEqual({ kind: 'same' })
})

// SELM-00082: a local action on the selection refuses a selection past
// LOCAL_SELECTION_LIMIT (UTF-16 code units) before its compute is called.

test('runLocal: a selection of up to 1,000,000 code units runs; one more is refused with its length and the limit', () => {
  expect(LOCAL_SELECTION_LIMIT).toBe(1_000_000)
  let calls = 0
  const counted = on(input => {
    calls++
    return { text: String(input.text?.length) }
  })
  const at = 'a'.repeat(LOCAL_SELECTION_LIMIT)
  expect(runLocal(counted, localInputFor(counted, { ...SOURCE, text: at }), { selection: true, lang: 'en' })).toEqual({ kind: 'settle', ok: true, text: '1000000' })
  expect(calls).toBe(1)
  const over = `${at}b`
  const ja = runLocal(counted, localInputFor(counted, { ...SOURCE, text: over }), { selection: true, lang: 'ja' })
  expect(ja).toEqual({ kind: 'settle', ok: false, text: '失敗しました: 選択テキストが長すぎます（1,000,001 文字。ローカル実行の上限は 1,000,000 文字）' })
  const en = runLocal(counted, localInputFor(counted, { ...SOURCE, text: over }), { selection: true, lang: 'en' })
  expect(en).toEqual({ kind: 'settle', ok: false, text: 'Failed: the selection is too long (1,000,001 characters; a local action takes up to 1,000,000)' })
  expect(calls).toBe(1)
  // Counted in code units: an emoji outside the BMP is two.
  const emoji = '😀'.repeat(LOCAL_SELECTION_LIMIT / 2 + 1)
  expect(runLocal(counted, localInputFor(counted, { ...SOURCE, text: emoji }), { selection: true, lang: 'en' })).toMatchObject({ ok: false })
  expect(calls).toBe(1)
})

test('runLocal: the selection limit is not applied to a standalone action', () => {
  const big = on(() => ({ text: 'ran' }), 'none')
  const input = { ...localInputFor(big, SOURCE), text: 'a'.repeat(LOCAL_SELECTION_LIMIT + 1) }
  expect(runLocal(big, input, { selection: false, lang: 'en' })).toEqual({ kind: 'settle', ok: true, text: 'ran' })
})
