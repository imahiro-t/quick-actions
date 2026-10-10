import { expect, test } from 'claude-code/testing'

import type { LocalInput, LocalOutput } from '../hooks/actions'
import {
  BREAK_IDEAS,
  CANDIDATES_MAX,
  CROCKFORD,
  DIGITS,
  DUMMY_JA_MODIFIERS,
  DUMMY_JA_PREDICATES,
  DUMMY_JA_SUBJECTS,
  LOREM_FIRST,
  LOREM_WORDS,
  LOWER,
  NANOID_ALPHABET,
  PASSPHRASE_WORDS,
  PASSWORD_CHARS,
  SYMBOLS,
  UNIFORM_RETRIES,
  UPPER,
  base64UrlEncode,
  breakIdea,
  coinFlip,
  dice,
  dummyJa,
  lorem,
  makeUlid,
  makeUuid,
  nanoid,
  passphrase,
  passphraseEntropy,
  password,
  passwordEntropy,
  pickOne,
  pickOneAction,
  randomColor,
  randomNumber,
  randomToken,
  shuffle,
  shuffleInPlace,
  splitCandidates,
  ulid,
  uniformInt,
  uuid,
} from '../hooks/random-local'

const BASE: LocalInput = {
  text: undefined,
  arg: undefined,
  now: Date.UTC(2026, 9, 10, 3, 0, 0),
  timeZone: 'Asia/Tokyo',
  lang: 'ja',
  utcOffsetMinutes: () => 540,
  random: () => 0.5,
  randomBytes: n => new Uint8Array(n).fill(7),
}

const input = (over: Partial<LocalInput>): LocalInput => ({ ...BASE, ...over })

function textOf(out: LocalOutput): string {
  if (!('text' in out)) throw new Error(`not a text: ${JSON.stringify(out)}`)
  return out.text
}

const isError = (out: LocalOutput) => Object.keys(out).length === 1 && typeof (out as Record<string, unknown>).error === 'string'

/** Bytes handed out in order from `seq`, over and over. */
function sequence(seq: readonly number[]): (n: number) => Uint8Array {
  let i = 0
  return n => Uint8Array.from({ length: n }, () => seq[i++ % seq.length]!)
}

/** Bytes counting up from 0 (wrapping at 256), a fresh run of them each call: varied but fixed. */
function counting(): (n: number) => Uint8Array {
  let i = 0
  return n => Uint8Array.from({ length: n }, () => i++ % 256)
}

type Compute = (input: LocalInput) => LocalOutput

test('uniformInt: equally likely by rejection, the next draw taken after a rejected one, and an end even when every draw is rejected', () => {
  // n = 6 in one byte: 252 and up (the last whole multiple) is rejected; 255 then 9 gives 9 % 6.
  const bytes = sequence([255, 9])
  expect(uniformInt(6, bytes)).toBe(3)
  // Below the limit: the remainder at once.
  expect(uniformInt(6, sequence([13]))).toBe(1)
  // Always rejected (0xFF): settles for the last draw's remainder, after UNIFORM_RETRIES draws again.
  let calls = 0
  const allFF = (n: number) => {
    calls++
    return new Uint8Array(n).fill(0xff)
  }
  expect(uniformInt(6, allFF)).toBe(255 % 6)
  expect(calls).toBe(UNIFORM_RETRIES + 1)
  // Two bytes for n past 256, read most significant first.
  expect(uniformInt(1000, sequence([0x01, 0x02]))).toBe(0x0102 % 1000)
  // n = 1 needs nothing; 2^32 takes four bytes, none rejected.
  expect(uniformInt(1, () => { throw new Error('no bytes needed') })).toBe(0)
  expect(uniformInt(2 ** 32, sequence([0xff]))).toBe(2 ** 32 - 1)
  // Each value turns up equally often over a full byte cycle (n divides 256).
  const seen = new Map<number, number>()
  const all = counting()
  for (let i = 0; i < 256; i++) {
    const v = uniformInt(8, all)
    seen.set(v, (seen.get(v) ?? 0) + 1)
  }
  expect([...seen.values()]).toEqual(new Array(8).fill(32))
})

test('shuffleInPlace, pickOne and splitCandidates', () => {
  const items = Array.from({ length: 10 }, (_, i) => i)
  const out = shuffleInPlace([...items], counting())
  expect([...out].sort((a, b) => a - b)).toEqual(items)
  expect(pickOne(['a', 'b', 'c'], sequence([4]))).toBe('b')
  expect(splitCandidates('a, b、c，d e　f  ,,')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  expect(splitCandidates('   ')).toEqual([])
})

test('uuid: five lines of v4 by default (version 4, variant 10), v7 with the time in its first 48 bits', () => {
  const v4 = textOf(uuid(input({ arg: 'v4', randomBytes: n => new Uint8Array(n).fill(0xff) }))).split('\n')
  expect(v4).toHaveLength(5)
  for (const u of v4) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  // All 0xFF: the version nibble and the variant bits are forced, the rest kept.
  expect(v4[0]).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  expect(makeUuid('v4', 0, n => new Uint8Array(n))).toBe('00000000-0000-4000-8000-000000000000')

  const now = 0x0123456789ab
  const v7 = textOf(uuid(input({ arg: 'v7', now, randomBytes: n => new Uint8Array(n) }))).split('\n')
  expect(v7).toHaveLength(5)
  expect(v7[0]).toBe('01234567-89ab-7000-8000-000000000000')
  for (const u of v7) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  // The time of the fixed input, read back.
  const fromTime = makeUuid('v7', BASE.now, n => new Uint8Array(n))
  expect(parseInt(fromTime.replace(/-/g, '').slice(0, 12), 16)).toBe(BASE.now)

  for (const bad of ['v1', 'V4', 4, undefined]) expect(isError(uuid(input({ arg: bad })))).toBe(true)
})

test('ulid: five of 26 Crockford characters, the first 10 the time', () => {
  const out = textOf(ulid(input({ randomBytes: n => new Uint8Array(n).fill(0xff) }))).split('\n')
  expect(out).toHaveLength(5)
  for (const u of out) expect(u).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  expect(out[0]!.slice(10)).toBe('Z'.repeat(16))
  // 1 ms is 0000000001; the time 2^48 - 1 is 7ZZZZZZZZZ.
  expect(makeUlid(1, n => new Uint8Array(n)).slice(0, 10)).toBe('0000000001')
  expect(makeUlid(2 ** 48 - 1, n => new Uint8Array(n))).toBe(`7${'Z'.repeat(9)}${'0'.repeat(16)}`)
  // The fixed time, read back from Base32.
  const head = makeUlid(BASE.now, n => new Uint8Array(n)).slice(0, 10)
  expect([...head].reduce((a, c) => a * 32 + CROCKFORD.indexOf(c), 0)).toBe(BASE.now)
  // Five random bytes 0x00 0x00 0x00 0x00 0x21 (33) make eight characters ending 11.
  expect(makeUlid(0, sequence([0, 0, 0, 0, 33])).slice(10, 18)).toBe('00000011')
})

test('nanoid: five of the given length (4 to 64, 21 by default) from the URL-safe alphabet', () => {
  expect(NANOID_ALPHABET).toHaveLength(64)
  expect(new Set(NANOID_ALPHABET).size).toBe(64)
  for (const n of [4, 21, 64]) {
    const out = textOf(nanoid(input({ arg: n, randomBytes: counting() }))).split('\n')
    expect(out).toHaveLength(5)
    for (const id of out) expect(id).toMatch(new RegExp(`^[A-Za-z0-9_-]{${n}}$`))
  }
  // byte & 63: 0 is A, 63 is -, 64 is A again.
  expect(textOf(nanoid(input({ arg: 4, randomBytes: sequence([0, 63, 64, 127]) }))).split('\n')[0]).toBe('A-A-')
  for (const bad of [3, 65, 21.5, '21', undefined]) expect(isError(nanoid(input({ arg: bad })))).toBe(true)
})

test('password: three of the given length (8 to 128) with every kind of character, and the estimated entropy', () => {
  for (const n of [8, 20, 128]) {
    const lines = textOf(password(input({ arg: n, randomBytes: counting() }))).split('\n')
    const list = lines.slice(0, 3)
    for (const p of list) {
      expect([...p]).toHaveLength(n)
      expect([...p].some(c => UPPER.includes(c))).toBe(true)
      expect([...p].some(c => LOWER.includes(c))).toBe(true)
      expect([...p].some(c => DIGITS.includes(c))).toBe(true)
      expect([...p].some(c => SYMBOLS.includes(c))).toBe(true)
      expect([...p].every(c => PASSWORD_CHARS.includes(c))).toBe(true)
    }
    expect(lines[3]).toBe('')
    expect(lines[4]).toContain(`${passwordEntropy(n).toFixed(1)} ビット`)
  }
  // Even constant bytes (every draw the same) give each kind once.
  const same = textOf(password(input({ arg: 8 }))).split('\n')[0]!
  expect([...same].some(c => SYMBOLS.includes(c))).toBe(true)
  // 76 characters: 20 × log2(76) ≈ 124.96 bits.
  expect(PASSWORD_CHARS).toHaveLength(76)
  expect(passwordEntropy(20).toFixed(1)).toBe('125.0')
  expect(textOf(password(input({ arg: 20, lang: 'en' })))).toContain('about 125.0 bits')
  for (const bad of [7, 129, '20', undefined]) expect(isError(password(input({ arg: bad })))).toBe(true)
})

test('passphrase: 1024 distinct words of 3 to 8 lowercase letters, three phrases of the given words, 10 bits a word', () => {
  expect(PASSPHRASE_WORDS).toHaveLength(1024)
  expect(new Set(PASSPHRASE_WORDS).size).toBe(1024)
  for (const w of PASSPHRASE_WORDS) expect(w).toMatch(/^[a-z]{3,8}$/)
  expect(passphraseEntropy(5)).toBe(50)
  for (const n of [3, 5, 10]) {
    const lines = textOf(passphrase(input({ arg: n, randomBytes: counting() }))).split('\n')
    for (const p of lines.slice(0, 3)) {
      const words = p.split('-')
      expect(words).toHaveLength(n)
      for (const w of words) expect(PASSPHRASE_WORDS).toContain(w)
    }
    expect(lines[4]).toBe(`推定エントロピー: ${(n * 10).toFixed(1)} ビット（${n} 語 × log2(1024)。組み込みの 1024 語から選択）`)
  }
  // Two bytes 0x00 0x00 pick the first word; 0x03 0xFF the last.
  expect(textOf(passphrase(input({ arg: 3, randomBytes: sequence([0x03, 0xff]) }))).split('\n')[0]).toBe(
    Array(3).fill(PASSPHRASE_WORDS[1023]).join('-'),
  )
  expect(textOf(passphrase(input({ arg: 5, lang: 'en' })))).toContain('Estimated entropy: 50.0 bits')
  for (const bad of [2, 11, '5', undefined]) expect(isError(passphrase(input({ arg: bad })))).toBe(true)
})

test('random-token: hexadecimal and Base64URL of the given bytes (8 to 256)', () => {
  // Base64URL: no padding, - and _ in place of + and /.
  expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
  expect(base64UrlEncode(new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61]))).toBe('Zm9vYmE')
  expect(base64UrlEncode(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('Zm9v')
  const lines = textOf(randomToken(input({ arg: 8, randomBytes: n => new Uint8Array(n).fill(0xfb) }))).split('\n')
  expect(lines[3]).toBe('fb'.repeat(8))
  expect(lines[6]).toBe('-_v7-_v7-_s')
  for (const n of [8, 256]) {
    const l = textOf(randomToken(input({ arg: n }))).split('\n')
    expect(l[3]).toHaveLength(n * 2)
    expect(l[6]).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(l[6]).toHaveLength(Math.ceil((n * 4) / 3))
  }
  for (const bad of [7, 257, '32', undefined]) expect(isError(randomToken(input({ arg: bad })))).toBe(true)
})

test('dice: NdM and NdM+K rolled, each die and the total; out of range or unreadable is an error', () => {
  // 2d6+1 with draws 2 and 4 (one byte each): dice 3 and 5, total 9.
  expect(textOf(dice(input({ arg: '2d6+1', randomBytes: sequence([2, 4]) })))).toBe('2d6+1: 3, 5 (+1)\n合計: 9')
  expect(textOf(dice(input({ arg: '1D20', lang: 'en', randomBytes: sequence([19]) })))).toBe('1d20: 20\nTotal: 20')
  // The bounds: 1 and 100 dice, 2 and 1000 sides, a bonus of 0 and 10000.
  for (const ok of ['1d2', '100d1000', '1d6+0', '1d6+10000', '1d6']) expect(isError(dice(input({ arg: ok })))).toBe(false)
  const hundred = textOf(dice(input({ arg: '100d6', randomBytes: counting() }))).split('\n')[0]!
  expect(hundred.split(': ')[1]!.split(', ')).toHaveLength(100)
  for (const bad of ['0d6', '101d6', '1d1', '1d1001', '1d6+10001', '1d6+99999', 'abc', 'd6', '2d', '2d6-1', '', 6]) {
    expect(isError(dice(input({ arg: bad })))).toBe(true)
  }
})

test('coin-flip: heads or tails from one bit', () => {
  expect(textOf(coinFlip(input({ randomBytes: sequence([0]) })))).toBe('表')
  expect(textOf(coinFlip(input({ randomBytes: sequence([1]) })))).toBe('裏')
  expect(textOf(coinFlip(input({ lang: 'en', randomBytes: sequence([2]) })))).toBe('Heads')
  expect(textOf(coinFlip(input({ lang: 'en', randomBytes: sequence([3]) })))).toBe('Tails')
})

test('random-number: from 1 to N (2 to 1000000000)', () => {
  expect(textOf(random(100, [41])).split('\n')[0]).toBe('42')
  expect(textOf(random(2, [1])).split('\n')[0]).toBe('2')
  // 1000000000 takes four bytes: 0 0 0 0 is 1.
  expect(textOf(random(1_000_000_000, [0])).split('\n')[0]).toBe('1')
  expect(textOf(random(100, [0]))).toContain('1〜100')
  for (const bad of [1, 1_000_000_001, '100', undefined]) expect(isError(randomNumber(input({ arg: bad })))).toBe(true)

  function random(n: number, seq: number[]) {
    return randomNumber(input({ arg: n, randomBytes: sequence(seq) }))
  }
})

test('pick-one: one of the candidates, yes or no with none; separators alone, one candidate alone or over 100 is an error', () => {
  expect(textOf(pickOneAction(input({ arg: '寿司, ラーメン、カレー', randomBytes: sequence([1]) })))).toBe('ラーメン\n\n（3 個の候補から）')
  expect(textOf(pickOneAction(input({ arg: undefined, randomBytes: sequence([0]) }))).split('\n')[0]).toBe('はい')
  expect(textOf(pickOneAction(input({ arg: '', lang: 'en', randomBytes: sequence([1]) }))).split('\n')[0]).toBe('No')
  const hundred = Array.from({ length: CANDIDATES_MAX }, (_, i) => `c${i}`).join(' ')
  expect(isError(pickOneAction(input({ arg: hundred })))).toBe(false)
  for (const bad of ['only', `${hundred} extra`, 3, ',,,', '、、', ', 、，']) expect(isError(pickOneAction(input({ arg: bad })))).toBe(true)
})

test('shuffle: the candidates in a random order, numbered; 1 to 10 with none; separators alone are an error', () => {
  const out = textOf(shuffle(input({ arg: 'a b c', randomBytes: counting() }))).split('\n')
  expect(out).toHaveLength(3)
  expect(out.map(l => l.replace(/^\d+\. /, '')).sort()).toEqual(['a', 'b', 'c'])
  expect(out[0]).toMatch(/^1\. /)
  const ten = textOf(shuffle(input({ arg: undefined, randomBytes: counting() }))).split('\n')
  expect(ten).toHaveLength(10)
  expect(ten[0]).toMatch(/^ 1\. /)
  expect(ten.map(l => Number(l.replace(/^\s*\d+\. /, ''))).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  for (const bad of ['solo', Array.from({ length: 101 }, (_, i) => i).join(','), 5, ',,,', '、、']) expect(isError(shuffle(input({ arg: bad })))).toBe(true)
})

test('random-color: five colours as HEX, RGB and HSL', () => {
  const lines = textOf(randomColor(input({ randomBytes: sequence([255, 0, 0, 0, 0, 0, 255, 255, 255, 0, 128, 0, 18, 52, 86]) }))).split('\n')
  expect(lines).toEqual([
    '#ff0000  rgb(255, 0, 0)  hsl(0, 100%, 50%)',
    '#000000  rgb(0, 0, 0)  hsl(0, 0%, 0%)',
    '#ffffff  rgb(255, 255, 255)  hsl(0, 0%, 100%)',
    '#008000  rgb(0, 128, 0)  hsl(120, 100%, 25%)',
    '#123456  rgb(18, 52, 86)  hsl(210, 65%, 20%)',
  ])
})

test('lorem: the given paragraphs (1 to 20), the first opening with the set sentence, words from the vocabulary', () => {
  const words = new Set(LOREM_WORDS)
  for (const n of [1, 3, 20]) {
    const text = textOf(lorem(input({ arg: n, randomBytes: counting() })))
    const paragraphs = text.split('\n\n')
    expect(paragraphs).toHaveLength(n)
    expect(paragraphs[0]!.startsWith(LOREM_FIRST)).toBe(true)
    for (const p of paragraphs) {
      const sentences = p.split(/(?<=\.) /)
      expect(sentences.length).toBeGreaterThanOrEqual(4)
      expect(sentences.length).toBeLessThanOrEqual(7)
      for (const s of sentences.slice(p === paragraphs[0] ? 1 : 0)) {
        const w = s.replace(/\.$/, '').toLowerCase().split(' ')
        expect(w.length).toBeGreaterThanOrEqual(6)
        expect(w.length).toBeLessThanOrEqual(12)
        for (const x of w) expect(words.has(x)).toBe(true)
      }
    }
  }
  for (const bad of [0, 21, '3', undefined]) expect(isError(lorem(input({ arg: bad })))).toBe(true)
})

test('dummy-ja: the given paragraphs (1 to 20) of sentences made of the built-in parts', () => {
  for (const parts of [DUMMY_JA_SUBJECTS, DUMMY_JA_MODIFIERS, DUMMY_JA_PREDICATES]) {
    expect(parts.length).toBeGreaterThanOrEqual(10)
    expect(parts.length).toBeLessThanOrEqual(15)
  }
  for (const n of [1, 3, 20]) {
    const paragraphs = textOf(dummyJa(input({ arg: n, randomBytes: counting() }))).split('\n\n')
    expect(paragraphs).toHaveLength(n)
    for (const p of paragraphs) {
      const sentences = p.split('。').filter(s => s !== '')
      expect(sentences.length).toBeGreaterThanOrEqual(3)
      expect(sentences.length).toBeLessThanOrEqual(6)
      for (const s of sentences) expect(DUMMY_JA_SUBJECTS.some(subject => s.startsWith(subject))).toBe(true)
    }
  }
  // Constant bytes pick the same parts each time.
  const first = DUMMY_JA_SUBJECTS[7 % DUMMY_JA_SUBJECTS.length]!
  expect(textOf(dummyJa(input({ arg: 1 }))).startsWith(first)).toBe(true)
  for (const bad of [0, 21, '3', undefined]) expect(isError(dummyJa(input({ arg: bad })))).toBe(true)
})

test('break-idea: one of the thirty built-in ideas, in the language', () => {
  expect(BREAK_IDEAS).toHaveLength(30)
  expect(textOf(breakIdea(input({ randomBytes: sequence([0]) })))).toBe(BREAK_IDEAS[0]!.ja)
  expect(textOf(breakIdea(input({ lang: 'en', randomBytes: sequence([29]) })))).toBe(BREAK_IDEAS[29]!.en)
  for (const idea of BREAK_IDEAS) {
    expect(idea.ja).not.toBe('')
    expect(idea.en).not.toBe('')
  }
})

test('every one answers in both languages, an invalid argument with the usual words', () => {
  const withArgs: [Compute, unknown][] = [
    [uuid, 'x'], [nanoid, 0], [password, 0], [passphrase, 0], [randomToken, 0], [dice, 'x'], [randomNumber, 0],
    [pickOneAction, 'x'], [shuffle, 'x'], [lorem, 0], [dummyJa, 0],
  ]
  for (const [compute, bad] of withArgs) {
    for (const lang of ['ja', 'en'] as const) {
      const out = compute(input({ arg: bad, lang })) as { error: string }
      expect(out.error.startsWith(lang === 'ja' ? '引数が正しくありません: ' : 'Invalid argument: ')).toBe(true)
    }
  }
})
