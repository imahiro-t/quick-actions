import { expect, test } from 'claude-code/testing'

import { ACTIONS } from '../hooks/actions'
import type { LocalInput, LocalOutput } from '../hooks/actions'
import { base64Decode, base64Encode, toHex, utf8Decode, utf8Encode } from '../hooks/codec'
import { layoutJson } from '../hooks/json-text'
import {
  base64DecodeText,
  base64EncodeText,
  caseVariants,
  colorConvert,
  compareCodePoints,
  countText,
  csvToTable,
  decodeJwt,
  dedupeLines,
  epochToDate,
  formatJson,
  hashText,
  minifyJson,
  parseUrl,
  sortLines,
  urlDecode,
  urlEncode,
  wordsOf,
} from '../hooks/selection-local'
import { sha1, sha256 } from '../hooks/sha'

// The local actions on the selection (SELM-00029), checked directly: every
// value of the input fixed, the time, the zone and the offset included.

const INPUT: LocalInput = {
  text: undefined,
  arg: undefined,
  now: Date.UTC(2026, 9, 10, 3, 0, 0),
  timeZone: 'Asia/Tokyo',
  lang: 'en',
  utcOffsetMinutes: () => 540,
  random: () => 0.5,
  randomBytes: n => new Uint8Array(n).fill(7),
}

type Compute = (input: LocalInput) => LocalOutput

const run = (compute: Compute, text: string, lang: 'ja' | 'en' = 'en', extra: Partial<LocalInput> = {}) =>
  compute({ ...INPUT, ...extra, lang, text })

/** The text of a result, failing the test on anything else. */
const textOf = (out: LocalOutput): string => {
  if (!('text' in out)) throw new Error(`expected a text, got ${JSON.stringify(out)}`)
  return out.text
}

/** The error of a result, failing the test on anything else. */
const errorOf = (out: LocalOutput): string => {
  if (!('error' in out)) throw new Error(`expected an error, got ${JSON.stringify(out)}`)
  return out.error
}

const ALL: readonly [string, Compute][] = [
  ['count-text', countText],
  ['format-json', formatJson],
  ['minify-json', minifyJson],
  ['csv-to-table', csvToTable],
  ['sort-lines', sortLines],
  ['dedupe-lines', dedupeLines],
  ['case-variants', caseVariants],
  ['base64-decode', base64DecodeText],
  ['base64-encode', base64EncodeText],
  ['url-decode', urlDecode],
  ['url-encode', urlEncode],
  ['parse-url', parseUrl],
  ['decode-jwt', decodeJwt],
  ['epoch-to-date', epochToDate],
  ['hash-text', hashText],
  ['color-convert', colorConvert],
]

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuWkqumDjiIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.sig'

// A representative input each computes a text from.
const SAMPLE: Record<string, string> = {
  'count-text': 'Hello 世界 🍣\nline two',
  'format-json': '{"a":[1,2,{"b":null}],"c":"日本"}',
  'minify-json': '{ "a" : [ 1, 2 ] }',
  'csv-to-table': 'name,age\n"Doe, J",42',
  'sort-lines': 'b\nA\na\nあ',
  'dedupe-lines': 'x\ny\nx',
  'case-variants': 'HTTPServerError',
  'base64-decode': '5pel5pys6Kqe8J+Now==',
  'base64-encode': '日本語🍣',
  'url-decode': '%E6%97%A5%E6%9C%AC',
  'url-encode': 'a b&c=日',
  'parse-url': 'https://user:pw@example.com:8080/a/b?q=hello+world&x=%E6%97%A5#top',
  'decode-jwt': JWT,
  'epoch-to-date': '1700000000',
  'hash-text': 'abc',
  'color-convert': '#ff8800',
}

test('the sixteen are the local actions of ACTIONS on the selection, in their order, with these computes', () => {
  const local = ACTIONS.filter(a => a.kind === 'local' && a.target === undefined)
  expect(local.map(a => a.id)).toEqual(ALL.map(([id]) => id))
  for (const [id, compute] of ALL) {
    const spec = local.find(a => a.id === id)
    expect(spec?.kind === 'local' && spec.compute).toBe(compute)
  }
})

test('every one answers a text on its sample and an error on no text, in both languages, never throwing', () => {
  for (const [id, compute] of ALL) {
    for (const lang of ['ja', 'en'] as const) {
      expect(typeof textOf(run(compute, SAMPLE[id]!, lang))).toBe('string')
      expect(errorOf(compute({ ...INPUT, lang, text: undefined }))).toBe(lang === 'ja' ? 'テキストが選択されていません。' : 'No text is selected.')
      expect(errorOf(run(compute, '', lang))).not.toBe('')
      // Odd input never throws: an answer of one of the two shapes.
      for (const odd of ['\u0000', '\ud800', '%', '{', '"', '.', '#', '-', 'x'.repeat(5000), '🍣'.repeat(300)]) {
        const out = run(compute, odd, lang)
        expect(['text' in out, 'error' in out].filter(Boolean)).toHaveLength(1)
      }
    }
  }
})

// No API whose answer varies by machine or that the hooks module may lack:
// each is replaced by one that throws while the computes run (synchronously),
// and put back whatever happens.
test('none of them reaches Intl, localeCompare, toLocale*, Date.now, Math.random, TextEncoder, atob, URL, crypto or Buffer', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const thrower = (name: string) => () => {
    throw new Error(`${name} was used`)
  }
  const blocked = new Proxy({}, {
    get: (_t, key) => {
      throw new Error(`a blocked global was read (${String(key)})`)
    },
  })
  const replaced: [object, string, PropertyDescriptor | undefined][] = []
  // The test kit freezes the built-in prototypes and Date.now / Math.random
  // (as the hooks' own environment does): those cannot be replaced here, and
  // are named instead. The globals (Intl, the web APIs, crypto) are replaced.
  // The source of the four modules is also checked for every one of these
  // names outside comments (by grep, when the change was made).
  const frozen: string[] = []
  const replace = (owner: object, key: string, value: unknown, name = key) => {
    const desc = Object.getOwnPropertyDescriptor(owner, key)
    if (desc !== undefined && desc.configurable === false) {
      frozen.push(name)
      return
    }
    replaced.push([owner, key, desc])
    Object.defineProperty(owner, key, { value, configurable: true, writable: true })
  }
  const answers: LocalOutput[] = []
  try {
    for (const name of ['Intl', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'URL', 'URLSearchParams', 'structuredClone']) {
      replace(g, name, name === 'Intl' ? blocked : thrower(name))
    }
    for (const name of ['crypto', 'Buffer']) if (name in g) replace(g, name, blocked)
    replace(Date, 'now', thrower('Date.now'), 'Date.now')
    replace(Math, 'random', thrower('Math.random'), 'Math.random')
    for (const name of ['localeCompare', 'toLocaleLowerCase', 'toLocaleUpperCase']) replace(String.prototype, name, thrower(name), `String#${name}`)
    for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) replace(Date.prototype, name, thrower(name), `Date#${name}`)
    replace(Number.prototype, 'toLocaleString', thrower('Number#toLocaleString'), 'Number#toLocaleString')
    replace(Array.prototype, 'toLocaleString', thrower('Array#toLocaleString'), 'Array#toLocaleString')
    for (const [id, compute] of ALL) {
      for (const lang of ['ja', 'en'] as const) answers.push(run(compute, SAMPLE[id]!, lang))
    }
  } finally {
    for (const [owner, key, desc] of replaced.reverse()) {
      if (desc === undefined) delete (owner as Record<string, unknown>)[key]
      else Object.defineProperty(owner, key, desc)
    }
  }
  // Put back: the real ones answer again.
  expect(typeof Date.now()).toBe('number')
  expect('a'.localeCompare('b')).toBe(-1)
  expect(answers).toHaveLength(32)
  // Only what the kit itself freezes went unreplaced: every global was replaced.
  const kitFrozen = [
    'Date.now', 'Math.random', 'String#localeCompare', 'String#toLocaleLowerCase', 'String#toLocaleUpperCase',
    'Date#toLocaleString', 'Date#toLocaleDateString', 'Date#toLocaleTimeString', 'Number#toLocaleString', 'Array#toLocaleString',
  ]
  for (const name of frozen) expect(kitFrozen).toContain(name)
  for (const name of ['Intl', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'URL', 'crypto']) expect(replaced.some(([, key]) => key === name)).toBe(true)
  for (const out of answers) expect('text' in out).toBe(true)
})

test('codec: UTF-8 with multibyte characters, lone surrogates and malformed bytes', () => {
  expect(toHex(utf8Encode('aé日🍣'))).toBe('61c3a9e697a5f09f8da3')
  // A lone surrogate becomes U+FFFD.
  expect(toHex(utf8Encode('a\ud800b'))).toBe('61efbfbd62')
  expect(toHex(utf8Encode('\udc00'))).toBe('efbfbd')
  expect(utf8Decode(Uint8Array.from([0x61, 0xc3, 0xa9, 0xe6, 0x97, 0xa5, 0xf0, 0x9f, 0x8d, 0xa3]))).toBe('aé日🍣')
  expect(utf8Decode(new Uint8Array(0))).toBe('')
  // A stray continuation, a cut sequence, an overlong form, a surrogate, past U+10FFFF.
  for (const bad of [[0x80], [0xe6, 0x97], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff]]) {
    expect(utf8Decode(Uint8Array.from(bad))).toBeUndefined()
  }
  // A long text decodes whole (past the slice handed to fromCodePoint at once).
  const long = '日'.repeat(10_000)
  expect(utf8Decode(utf8Encode(long))).toBe(long)
})

test('codec: Base64, standard and URL-safe, padded or not, and its errors with positions', () => {
  expect(base64Encode(utf8Encode('日本語🍣'))).toBe('5pel5pys6Kqe8J+Now==')
  expect(base64Encode(new Uint8Array(0))).toBe('')
  expect(base64Encode(Uint8Array.from([0xfb, 0xff, 0xbf]))).toBe('+/+/')
  expect(base64Encode(utf8Encode('a'))).toBe('YQ==')
  expect(base64Encode(utf8Encode('ab'))).toBe('YWI=')
  const bytesOf = (s: string) => {
    const r = base64Decode(s)
    if ('error' in r) throw new Error(JSON.stringify(r.error))
    return toHex(r.bytes)
  }
  expect(bytesOf('-_-_')).toBe('fbffbf')
  expect(bytesOf('+/+/')).toBe('fbffbf')
  expect(bytesOf('YQ==')).toBe('61')
  expect(bytesOf('YQ')).toBe('61')
  expect(bytesOf('YWI')).toBe('6162')
  expect(bytesOf('5pel 5pys\n6Kqe8J+Now')).toBe('e697a5e69cace8aa9ef09f8da3')
  expect(base64Decode('YW$h')).toEqual({ error: { reason: 'char', index: 3, char: '$' } })
  expect(base64Decode('Y')).toEqual({ error: { reason: 'length' } })
  expect(base64Decode('YQ=')).toEqual({ error: { reason: 'length' } })
  expect(base64Decode('YQ===')).toEqual({ error: { reason: 'padding', index: 5 } })
  expect(base64Decode('Y=Q=')).toEqual({ error: { reason: 'padding', index: 3 } })
  expect(base64Decode('====')).toEqual({ error: { reason: 'padding', index: 3 } })
})

test('sha: SHA-256 and SHA-1 of the known vectors, the padding boundaries and UTF-8 text', () => {
  const vectors: [string, string, string][] = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    ],
    ['a'.repeat(55), '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318', 'c1c8bbdc22796e28c0e15163d20899b65621d65a'],
    ['a'.repeat(56), 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a', 'c2db330f6083854c99d4b5bfb6e8f29f201be699'],
    ['a'.repeat(64), 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb', '0098ba824b5c16427bd7a1122a5a442a25ec644d'],
    ['こんにちは、世界', '93b4a40efbb52fdbe7e92a79df511b46882a5fbb329107eac7733715886350b1', '1add009237084549b47987665ae0578379a0c8fe'],
  ]
  for (const [text, s256, s1] of vectors) {
    expect(sha256(utf8Encode(text))).toBe(s256)
    expect(sha1(utf8Encode(text))).toBe(s1)
  }
})

test('hash-text: the two digests in lowercase hex, and what they are computed over', () => {
  const en = textOf(run(hashText, 'abc'))
  expect(en.split('\n').slice(0, 2)).toEqual([
    'SHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'SHA-1: a9993e364706816aba3e25717850c26c9cd0d89d',
  ])
  expect(en).toContain('UTF-8 bytes')
  expect(en).not.toContain('MD5')
  const ja = textOf(run(hashText, 'こんにちは、世界', 'ja'))
  expect(ja).toContain('SHA-256: 93b4a40efbb52fdbe7e92a79df511b46882a5fbb329107eac7733715886350b1')
  expect(ja).toContain('SHA-1: 1add009237084549b47987665ae0578379a0c8fe')
  expect(ja).toContain('UTF-8 バイト列')
})

test('count-text: characters as code points with and without white space, words, lines of any break, UTF-8 bytes, and how they are counted', () => {
  const en = textOf(run(countText, 'Hello 世界 🍣\r\nline two\rthree'))
  expect(en).toContain('- Characters (with spaces): 26')
  expect(en).toContain('- Characters (without spaces): 20')
  expect(en).toContain('- Words: 6')
  expect(en).toContain('- Lines: 3')
  // Hello(5)+space+世界(6)+space+🍣(4)+CRLF(2)+line two(8)+CR+three(5)
  expect(en).toContain('- UTF-8 bytes: 33')
  // The way words are counted is said: text without spaces is one word per run.
  expect(en).toContain('words as the runs between white space')
  expect(en).toContain('Japanese')
  const ja = textOf(run(countText, '日本語の文です', 'ja'))
  expect(ja).toContain('- 文字数（空白込み）: 7')
  expect(ja).toContain('- 語数: 1')
  expect(ja).toContain('- 行数: 1')
  expect(ja).toContain('- UTF-8 バイト数: 21')
  expect(ja).toContain('語は空白で区切った数（日本語のように空白で区切らない文はひと続きで 1 語）')
  // One character, an emoji: one code point, four bytes.
  expect(textOf(run(countText, '🍣'))).toContain('- Characters (with spaces): 1')
  expect(textOf(run(countText, '🍣'))).toContain('- UTF-8 bytes: 4')
})

test('format-json and minify-json: layout kept to the spelling of every value; errors with line and column', () => {
  expect(textOf(run(formatJson, '{"a":[1,2,{"b":null}],"c":"日本","e":{},"f":[]}'))).toBe(
    '{\n  "a": [\n    1,\n    2,\n    {\n      "b": null\n    }\n  ],\n  "c": "日本",\n  "e": {},\n  "f": []\n}',
  )
  // As JSON.stringify lays out what it can hold.
  const plain = '{"x":[true,false,"s\\n"],"y":{"z":-1.5}}'
  expect(textOf(run(formatJson, plain))).toBe(JSON.stringify(JSON.parse(plain), null, 2))
  // A big integer, 1.0 and a repeated key stay as written.
  expect(textOf(run(minifyJson, '{ "id" : 12345678901234567890 , "v": 1.0, "v": 2 }'))).toBe('{"id":12345678901234567890,"v":1.0,"v":2}')
  expect(textOf(run(formatJson, '[ ]'))).toBe('[]')
  expect(textOf(run(formatJson, '"just a string"'))).toBe('"just a string"')
  expect(textOf(run(minifyJson, '\n[\n 1 ,\n [ ] ]\n'))).toBe('[1,[]]')
  // Errors: where, in both languages.
  expect(errorOf(run(formatJson, '{"a": 1,\n  "b": }'))).toBe('Not valid JSON: line 2, column 8: unexpected token "}".')
  expect(errorOf(run(formatJson, '{"a": 1,\n  "b": }', 'ja'))).toBe('JSON として読めません: 2 行 8 列目、予期しない記号「}」。')
  expect(errorOf(run(minifyJson, '[1, 2'))).toBe('Not valid JSON: line 1, column 6: unexpected end of the text.')
  expect(errorOf(run(minifyJson, '{"a": 01}'))).toContain('column 7: invalid number')
  expect(errorOf(run(minifyJson, "{'a': 1}"))).toContain('column 2: unexpected character "\'"')
  expect(errorOf(run(minifyJson, '{"a": tru}'))).toContain('unexpected character "tru"')
  expect(errorOf(run(minifyJson, '{"a": 1} [2]'))).toBe('Not valid JSON: line 1, column 10: extra content after the value "[".')
  expect(errorOf(run(minifyJson, '{"a": 1} x'))).toContain('column 10: unexpected character "x"')
  expect(errorOf(run(minifyJson, '["a\tb"]'))).toContain('control character')
  expect(errorOf(run(minifyJson, '["\\x"]'))).toContain('invalid escape')
  expect(errorOf(run(minifyJson, '["abc'))).toContain('line 1, column 2: unterminated string')
  expect(errorOf(run(minifyJson, '[1,]'))).toContain('unexpected token "]"')
  expect(errorOf(run(minifyJson, '{"a" 1}'))).toContain('unexpected token "1"')
  expect(errorOf(run(minifyJson, '[1}'))).toContain('unexpected token "}"')
  // Columns count code points: an emoji before the error is one.
  expect(errorOf(run(minifyJson, '["🍣" x]'))).toContain('column 6')
  // Deep nesting does not overflow.
  const deep = `${'['.repeat(5000)}${']'.repeat(5000)}`
  expect(textOf(run(minifyJson, deep))).toBe(deep)
  expect(layoutJson('', 2)).toMatchObject({ error: { problem: 'empty' } })
})

test('csv-to-table: a Markdown table, quotes and TSV handled, rows of another width listed by line', () => {
  expect(textOf(run(csvToTable, 'name,age\n"Doe, J",42\n"He said ""hi""",7'))).toBe(
    ['| name | age |', '| --- | --- |', '| Doe, J | 42 |', '| He said "hi" | 7 |'].join('\n'),
  )
  // Tab-separated: commas stay in the cells. A pipe is escaped, a line break in a quoted cell is <br>.
  expect(textOf(run(csvToTable, 'a\tb\n1,5\t"x\ny|z"'))).toBe(['| a | b |', '| --- | --- |', '| 1,5 | x<br>y\\|z |'].join('\n'))
  // Rows of another width: filled out in the table, then listed by the line they start on.
  const odd = textOf(run(csvToTable, 'a,b\n1,2,3\n\n4\n"multi\nline",5'))
  expect(odd).toBe(
    [
      '| a | b |  |',
      '| --- | --- | --- |',
      '| 1 | 2 | 3 |',
      '| 4 |  |  |',
      '| multi<br>line | 5 |  |',
      '',
      "Rows whose number of columns differs from the header's 2: line 2 (3 columns), line 4 (1 column)",
    ].join('\n'),
  )
  expect(textOf(run(csvToTable, 'a,b\n1,2,3', 'ja'))).toContain('列数が揃わない行（見出しは 2 列）: 2 行目（3 列）')
  // A header alone, and a single column.
  expect(textOf(run(csvToTable, 'only'))).toBe('| only |\n| --- |')
  // An unclosed quote: an error saying where it opened.
  expect(errorOf(run(csvToTable, 'a,b\n1,"open\n2,3'))).toBe('Not a readable CSV: the quote (") opened on line 2 is never closed.')
  expect(errorOf(run(csvToTable, 'a,b\n1,"open', 'ja'))).toBe('CSV として読めません: 2 行目で始まる引用符（"）が閉じていません。')
})

test('sort-lines: code point order with case ignored, stable, the same on any machine', () => {
  expect(textOf(run(sortLines, 'banana\nApple\napple\nCherry\nあ\nア\n亜\n10\n9\nApple'))).toBe(
    ['10', '9', 'Apple', 'apple', 'Apple', 'banana', 'Cherry', 'あ', 'ア', '亜'].join('\n'),
  )
  // By code point, not by UTF-16 unit: U+1F363 (🍣) after U+FF21 (Ａ) and U+E000.
  expect(textOf(run(sortLines, '🍣\n\nＡ\nz'))).toBe(['z', '', 'Ａ', '🍣'].join('\n'))
  expect(compareCodePoints('🍣', '￿')).toBe(1)
  expect(compareCodePoints('ab', 'a')).toBe(1)
  expect(compareCodePoints('a', 'ab')).toBe(-1)
  expect(compareCodePoints('x', 'x')).toBe(0)
  // Any line break; the result joined by \n. Empty lines first.
  expect(textOf(run(sortLines, 'b\r\na\r\rc'))).toBe(['', 'a', 'b', 'c'].join('\n'))
  expect(textOf(run(sortLines, 'one'))).toBe('one')
})

test('dedupe-lines: the first of each line kept in order, and how many were removed', () => {
  expect(textOf(run(dedupeLines, 'x\ny\nx\nz\ny\nx'))).toBe('x\ny\nz\n\n(Removed 3 repeated lines.)')
  expect(textOf(run(dedupeLines, 'a\nA\r\na'))).toBe('a\nA\n\n(Removed 1 repeated line.)')
  expect(textOf(run(dedupeLines, 'a\nb'))).toBe('a\nb\n\n(No line was repeated.)')
  expect(textOf(run(dedupeLines, 'a\na', 'ja'))).toBe('a\n\n（重複した 1 行を除きました）')
  expect(textOf(run(dedupeLines, 'a', 'ja'))).toBe('a\n\n（重複した行はありませんでした）')
})

test('case-variants: the five forms, from any form, and an error on no single word', () => {
  expect(textOf(run(caseVariants, 'HTTPServerError'))).toBe(
    ['camelCase: httpServerError', 'PascalCase: HttpServerError', 'snake_case: http_server_error', 'kebab-case: http-server-error', 'CONSTANT_CASE: HTTP_SERVER_ERROR'].join('\n'),
  )
  expect(textOf(run(caseVariants, 'user_id'))).toContain('camelCase: userId')
  expect(textOf(run(caseVariants, 'foo-bar baz'))).toContain('PascalCase: FooBarBaz')
  expect(textOf(run(caseVariants, 'MAX_RETRY_COUNT'))).toContain('kebab-case: max-retry-count')
  expect(textOf(run(caseVariants, 'parseURL2Json'))).toContain('snake_case: parse_url2_json')
  expect(textOf(run(caseVariants, 'a.b/c'))).toContain('CONSTANT_CASE: A_B_C')
  expect(wordsOf('getHTTPResponse')).toEqual(['get', 'HTTP', 'Response'])
  expect(wordsOf('ユーザー_id')).toEqual(['ユーザー', 'id'])
  for (const bad of ['---', 'two\nlines', 'x'.repeat(201)]) {
    expect(errorOf(run(caseVariants, bad))).toContain('Select a single word')
    expect(errorOf(run(caseVariants, bad, 'ja'))).toContain('1 つの語か識別子')
  }
  expect('text' in run(caseVariants, 'x'.repeat(200))).toBe(true)
})

test('base64-decode and base64-encode: UTF-8 text both ways, URL-safe too, bytes that are not text by their hex', () => {
  expect(textOf(run(base64EncodeText, '日本語🍣'))).toBe('5pel5pys6Kqe8J+Now==')
  expect(textOf(run(base64EncodeText, 'a'))).toBe('YQ==')
  expect(textOf(run(base64DecodeText, '5pel5pys6Kqe8J+Now=='))).toBe('日本語🍣')
  // URL-safe, unpadded.
  expect(textOf(run(base64DecodeText, '5pel5pys6Kqe8J-Now'))).toBe('日本語🍣')
  expect(textOf(run(base64DecodeText, 'bGluZTEKbGluZTI='))).toBe('line1\nline2')
  // Not text: length and the first bytes in hex.
  expect(textOf(run(base64DecodeText, 'iVBORw0KGgoA'))).toBe(
    ['These bytes do not read as UTF-8 text.', 'Length: 9 bytes', 'First 9 bytes (hex): 89 50 4e 47 0d 0a 1a 0a 00'].join('\n'),
  )
  const long = textOf(run(base64DecodeText, base64Encode(new Uint8Array(40).fill(0xff)), 'ja'))
  expect(long).toContain('バイト長: 40')
  expect(long).toContain(`先頭 32 バイト（16 進）: ${'ff '.repeat(32).trim()} …`)
  // Control characters (but tab and line breaks) are not text.
  expect(textOf(run(base64DecodeText, base64Encode(Uint8Array.from([0x61, 0x07]))))).toContain('do not read as UTF-8 text')
  expect(errorOf(run(base64DecodeText, 'YW$h'))).toBe('Not valid Base64: character 3 ("$") is not a Base64 character.')
  expect(errorOf(run(base64DecodeText, 'YW$h', 'ja'))).toBe('Base64 として読めません: 3 文字目の「$」は Base64 の文字ではありません。')
  expect(errorOf(run(base64DecodeText, 'Y'))).toContain('length')
  expect(errorOf(run(base64DecodeText, 'Y=Q='))).toContain('at character 3')
})

test('url-decode and url-encode: percent-encoding of UTF-8; + left as it is; errors with positions', () => {
  expect(textOf(run(urlDecode, '%E6%97%A5%E6%9C%AC%20x%2Fy'))).toBe('日本 x/y')
  expect(textOf(run(urlDecode, 'a+b%20c'))).toBe('a+b c\n\n(A "+" is left as it is, not read as a space.)')
  expect(textOf(run(urlDecode, 'a+b', 'ja'))).toBe('a+b\n\n（「+」は空白に変えていません）')
  expect(textOf(run(urlDecode, '🍣%F0%9F%8D%A3'))).toBe('🍣🍣')
  expect(errorOf(run(urlDecode, 'ab%zz'))).toContain('the % at character 3')
  expect(errorOf(run(urlDecode, 'ab%4'))).toContain('character 3')
  // Bytes that are not UTF-8: where their run starts.
  expect(errorOf(run(urlDecode, 'x%E6%97'))).toContain('character 2')
  expect(errorOf(run(urlDecode, '%FF', 'ja'))).toContain('1 文字目の %')
  expect(textOf(run(urlEncode, 'a b&c=日/🍣'))).toBe('a%20b%26c%3D%E6%97%A5%2F%F0%9F%8D%A3')
  expect(textOf(run(urlEncode, "-_.!~*'()"))).toBe("-_.!~*'()")
  expect(errorOf(run(urlEncode, 'a\ud800'))).toContain('unpaired surrogate')
  expect(errorOf(run(urlEncode, 'a\ud800', 'ja'))).toContain('サロゲート')
})

test('parse-url: scheme, user (password hidden), host, port, path, query decoded, fragment; errors', () => {
  expect(textOf(run(parseUrl, 'https://user:pw@example.com:8080/a/b?q=hello+world&x=%E6%97%A5&flag#top'))).toBe(
    [
      'Scheme: https',
      'User info: user:***',
      'Host: example.com',
      'Port: 8080',
      'Path: /a/b',
      'Query:',
      '  - q = hello world',
      '  - x = 日',
      '  - flag = (no value)',
      'Fragment: top',
    ].join('\n'),
  )
  expect(textOf(run(parseUrl, 'http://[::1]:3000/', 'ja'))).toBe(
    ['スキーム: http', 'ホスト: [::1]', 'ポート: 3000', 'パス: /', 'クエリ: （なし）', 'フラグメント: （なし）'].join('\n'),
  )
  expect(textOf(run(parseUrl, 'https://example.com'))).toContain("Port: (left out: the scheme's default)")
  expect(textOf(run(parseUrl, 'mailto:someone@example.com'))).toContain('Path: someone@example.com')
  expect(textOf(run(parseUrl, 'https://e.com/?bad=%E6'))).toContain('bad = %E6 (could not be decoded: shown as written)')
  expect(errorOf(run(parseUrl, 'example.com/path'))).toBe('Not a readable URL: it has no scheme (such as https:).')
  expect(errorOf(run(parseUrl, 'https://a b'))).toContain('white space')
  expect(errorOf(run(parseUrl, 'https://e.com:99999/'))).toContain('"99999" is not a number from 0 to 65535')
  expect(errorOf(run(parseUrl, 'https://e.com:http/'))).toContain('port')
  expect(errorOf(run(parseUrl, 'http://[::1/'))).toContain('IPv6')
  expect(errorOf(run(parseUrl, 'ftp://e.com:x/', 'ja'))).toContain('0〜65535')
})

test('decode-jwt: header and payload laid out, the times in UTC and local time, expiry; the signature never verified', () => {
  const en = textOf(run(decodeJwt, JWT))
  expect(en.split('\n')[0]).toBe('Note: the signature is not verified (the contents are only decoded).')
  expect(en).toContain('Header:\n{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
  expect(en).toContain('"name": "太郎"')
  expect(en).toContain('- iat: 1700000000 → UTC 2023-11-14T22:13:20Z / local 2023-11-15T07:13:20+09:00 (Asia/Tokyo)')
  expect(en).toContain('- exp: 1700003600 → UTC 2023-11-14T23:13:20Z / local 2023-11-15T08:13:20+09:00 (Asia/Tokyo) (expired)')
  const ja = textOf(run(decodeJwt, JWT, 'ja'))
  expect(ja.split('\n')[0]).toBe('※ 署名は検証していません（中身をデコードして表示しただけです）。')
  expect(ja).toContain('- exp: 1700003600 → UTC 2023-11-14T23:13:20Z / ローカル 2023-11-15T08:13:20+09:00 (Asia/Tokyo)（期限切れ）')
  // Not yet expired, and not valid yet, at a fixed now; another offset.
  const enc = (o: unknown) => base64Encode(utf8Encode(JSON.stringify(o))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const future = `${enc({ alg: 'none' })}.${enc({ exp: 1900000000, nbf: 1900000000 })}.`
  const f = textOf(run(decodeJwt, future, 'en', { utcOffsetMinutes: () => -300, timeZone: 'America/New_York' }))
  expect(f).toContain('- exp: 1900000000 → UTC 2030-03-17T17:46:40Z / local 2030-03-17T12:46:40-05:00 (America/New_York)\n')
  expect(f).toContain('(not valid yet)')
  expect(f).not.toContain('(expired)')
  // Errors.
  expect(errorOf(run(decodeJwt, 'a.b'))).toContain('not three parts')
  expect(errorOf(run(decodeJwt, 'a.b.c.d.e'))).toContain('JWE')
  expect(errorOf(run(decodeJwt, '$$.e30.x'))).toContain('header is not UTF-8 text in Base64URL')
  expect(errorOf(run(decodeJwt, `${enc({ a: 1 })}.${base64Encode(utf8Encode('{"a":'))}.x`))).toBe(
    "The JWT's payload: Not valid JSON: line 1, column 6: unexpected end of the text.",
  )
})

test('epoch-to-date: seconds or milliseconds by the digits, in UTC and local time; errors out of range', () => {
  expect(textOf(run(epochToDate, '1700000000'))).toBe(
    ['Unit: seconds (from its 10 digits)', 'UTC: 2023-11-14T22:13:20Z', 'Local: 2023-11-15T07:13:20+09:00 (Asia/Tokyo)'].join('\n'),
  )
  expect(textOf(run(epochToDate, '1700000000123', 'ja'))).toBe(
    ['単位: ミリ秒（整数部 13 桁から判定）', 'UTC: 2023-11-14T22:13:20.123Z', 'ローカル: 2023-11-15T07:13:20.123+09:00 (Asia/Tokyo)'].join('\n'),
  )
  expect(textOf(run(epochToDate, '0'))).toContain('UTC: 1970-01-01T00:00:00Z')
  expect(textOf(run(epochToDate, '-86400'))).toContain('UTC: 1969-12-31T00:00:00Z')
  expect(textOf(run(epochToDate, '1.5'))).toContain('UTC: 1970-01-01T00:00:01.500Z')
  // The boundary: 11 digits are seconds, 12 milliseconds.
  expect(textOf(run(epochToDate, '99999999999'))).toContain('UTC: 5138-11-16T09:46:39Z')
  expect(textOf(run(epochToDate, '100000000000'))).toContain('Unit: milliseconds')
  expect(textOf(run(epochToDate, '0', 'en', { utcOffsetMinutes: () => -570 }))).toContain('Local: 1969-12-31T14:30:00-09:30 (Asia/Tokyo)')
  expect(errorOf(run(epochToDate, '123456789012345'))).toContain('15 digits')
  expect(errorOf(run(epochToDate, 'yesterday'))).toContain('Not a UNIX time')
  expect(errorOf(run(epochToDate, '12:00', 'ja'))).toContain('UNIX 時刻として読めません')
})

test('color-convert: #RGB, #RRGGBB, rgb() and hsl() to all three; errors on others and out of range', () => {
  const orange = ['HEX: #ff8800', 'RGB: rgb(255, 136, 0)', 'HSL: hsl(32, 100%, 50%)'].join('\n')
  expect(textOf(run(colorConvert, '#ff8800'))).toBe(orange)
  expect(textOf(run(colorConvert, '#F80'))).toBe(orange)
  expect(textOf(run(colorConvert, 'rgb(255, 136, 0)'))).toBe(orange)
  expect(textOf(run(colorConvert, 'RGB(255 136 0)'))).toBe(orange)
  expect(textOf(run(colorConvert, 'hsl(120, 100%, 25%)'))).toBe(['HEX: #008000', 'RGB: rgb(0, 128, 0)', 'HSL: hsl(120, 100%, 25%)'].join('\n'))
  expect(textOf(run(colorConvert, 'hsl(0deg 0% 100%)'))).toBe(['HEX: #ffffff', 'RGB: rgb(255, 255, 255)', 'HSL: hsl(0, 0%, 100%)'].join('\n'))
  expect(textOf(run(colorConvert, '#000'))).toContain('HSL: hsl(0, 0%, 0%)')
  for (const bad of ['rgb(256, 0, 0)', 'hsl(10, 120%, 50%)', '#12345', 'red', 'rgba(0,0,0,0.5)']) {
    expect(errorOf(run(colorConvert, bad))).toContain('Not a readable colour')
    expect(errorOf(run(colorConvert, bad, 'ja'))).toContain('色として読めません')
  }
})
