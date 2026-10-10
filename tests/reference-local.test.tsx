import { expect, test } from 'claude-code/testing'

import { ACTIONS, LOCAL_TEXT_LIMIT } from '../hooks/actions'
import type { LocalInput, LocalOutput } from '../hooks/actions'
import { localMidnight } from '../hooks/args'
import { CONTROLS, HTTP_STATUSES, MIME_TYPES, PORTS, asciiTable, httpStatus, mimeTypes, portNumbers } from '../hooks/reference-local'
import {
  breathing,
  businessDays,
  calendar,
  clock,
  countdownTo,
  dateInfo,
  dateOffset,
  durationConvert,
  eyeRest,
  moonPhase,
  pomodoro,
  sleepCalc,
  stopwatch,
  timeAfter,
  wareki,
  yearProgress,
} from '../hooks/time-local'

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

type Compute = (input: LocalInput) => LocalOutput

test('each that takes a text answers { error } for an argument that is not text, in both languages', () => {
  for (const compute of [httpStatus, mimeTypes, portNumbers]) {
    for (const lang of ['ja', 'en'] as const) {
      const out = compute(input({ arg: 404, lang }))
      expect(isError(out)).toBe(true)
      expect((out as { error: string }).error.startsWith(lang === 'ja' ? '引数が正しくありません: ' : 'Invalid argument: ')).toBe(true)
    }
  }
})

test('ascii-table: 0x20 to 0x7E in decimal, hexadecimal and character, then the main control characters', () => {
  const text = textOf(asciiTable(BASE))
  const lines = text.split('\n')
  expect(lines[0]).toBe('表示可能な ASCII 文字（0x20〜0x7E。SP は空白）:')
  expect(lines[1]).toBe('Dec Hx Ch   Dec Hx Ch   Dec Hx Ch   Dec Hx Ch   Dec Hx Ch')
  // Column by column: 32 to 50 down the first.
  expect(lines[2]).toBe(' 32 20 SP    51 33 3     70 46 F     89 59 Y    108 6C l')
  for (let code = 0x20; code <= 0x7e; code++) {
    const ch = code === 0x20 ? 'SP' : String.fromCharCode(code)
    const hex = code.toString(16).toUpperCase()
    expect(text).toContain(`${String(code).padStart(3, ' ')} ${hex} ${ch}`)
  }
  expect(text).toContain('126 7E ~')
  expect(text).not.toContain('127 7F')
  expect(text).toContain('NUL    0  0x00  \\0   ヌル文字（C の文字列の終端）')
  expect(text).toContain('LF    10  0x0A  \\n   改行（Unix の行末）')
  expect(text).toContain('ESC   27  0x1B  \\e   エスケープ（端末の制御シーケンスの開始）')
  expect(text).toContain('DEL  127  0x7F  -    削除')
  expect(CONTROLS.map(c => c.name)).toEqual(['NUL', 'BEL', 'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', 'ESC', 'DEL'])
  const en = textOf(asciiTable(input({ lang: 'en' })))
  expect(en).toContain('TAB    9  0x09  \\t   horizontal tab')
  // No raw control character reaches the pane.
  for (const t of [text, en]) expect(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(t)).toBe(false)
  expect(text.length).toBeLessThan(LOCAL_TEXT_LIMIT)
})

test('http-status: a code, part of a name, or the common ones; codes out of 100 to 599 and names not found are errors', () => {
  expect(HTTP_STATUSES.length).toBeGreaterThan(35)
  const list = textOf(httpStatus(BASE))
  expect(list).toContain('200 OK: 成功')
  expect(list).toContain('504 Gateway Timeout: 上流のサーバーが時間切れ')
  expect(list).not.toContain('418')
  expect(list).not.toContain('100 Continue')
  expect(textOf(httpStatus(input({ arg: '404' })))).toBe('404 Not Found: 見つからない\n分類: 4xx クライアントエラー')
  expect(textOf(httpStatus(input({ arg: '404', lang: 'en' })))).toBe('404 Not Found: not found\nClass: 4xx client error')
  expect(textOf(httpStatus(input({ arg: '100' })))).toContain('100 Continue')
  expect(textOf(httpStatus(input({ arg: '599' })))).toBe('599: この表にはありません。分類: 5xx サーバーエラー')
  expect(textOf(httpStatus(input({ arg: '299', lang: 'en' })))).toBe('299: not in this table. Class: 2xx success')
  expect(textOf(httpStatus(input({ arg: 'TEAPOT' })))).toContain("418 I'm a teapot")
  expect(textOf(httpStatus(input({ arg: 'gateway' })))).toBe(['502 Bad Gateway: 上流のサーバーから不正な応答', '504 Gateway Timeout: 上流のサーバーが時間切れ'].join('\n'))
  for (const arg of ['99', '600', '0', 'zzz', '404 not']) {
    for (const lang of ['ja', 'en'] as const) expect(isError(httpStatus(input({ arg, lang })))).toBe(true)
  }
})

test('mime-types: an extension (or a file name) to its type, a type to its extensions, or the table', () => {
  expect(MIME_TYPES.length).toBeGreaterThan(55)
  expect(new Set(MIME_TYPES.map(([e]) => e)).size).toBe(MIME_TYPES.length)
  const list = textOf(mimeTypes(BASE)).split('\n')
  expect(list[0]).toBe('よく使う拡張子と MIME タイプ:')
  expect(list).toHaveLength(MIME_TYPES.length + 1)
  expect(textOf(mimeTypes(input({ arg: 'json' })))).toBe('.json  application/json')
  expect(textOf(mimeTypes(input({ arg: '.JSON' })))).toBe('.json  application/json')
  expect(textOf(mimeTypes(input({ arg: 'file.tar.gz' })))).toBe('.gz  application/gzip')
  expect(textOf(mimeTypes(input({ arg: 'image/PNG' })))).toBe('image/png の拡張子: .png')
  expect(textOf(mimeTypes(input({ arg: 'image/jpeg', lang: 'en' })))).toBe('Extensions of image/jpeg: .jpg, .jpeg')
  expect(textOf(mimeTypes(input({ arg: 'text/html; charset=utf-8' })))).toBe('text/html の拡張子: .html, .htm')
  for (const arg of ['xyz', 'foo/bar', '.', 'a b', 'file.']) {
    for (const lang of ['ja', 'en'] as const) expect(isError(mimeTypes(input({ arg, lang })))).toBe(true)
  }
})

test('port-numbers: a number to its service and range, a name to its port, or the table; numbers past 65535 are errors', () => {
  expect(PORTS.length).toBeGreaterThan(35)
  const list = textOf(portNumbers(BASE))
  expect(list).toContain('   22/TCP     ssh (sftp, scp): SSH（SFTP・SCP も）')
  expect(list).toContain(' 5432/TCP     postgresql (postgres): PostgreSQL')
  expect(textOf(portNumbers(input({ arg: '5432' })))).toBe(' 5432/TCP     postgresql (postgres): PostgreSQL\n範囲: 登録済みポート（1024〜49151）')
  expect(textOf(portNumbers(input({ arg: 'Postgres' })))).toBe(' 5432/TCP     postgresql (postgres): PostgreSQL')
  expect(textOf(portNumbers(input({ arg: 'SSH', lang: 'en' })))).toBe('   22/TCP     ssh (sftp, scp): SSH (SFTP and SCP too)')
  expect(textOf(portNumbers(input({ arg: '0' })))).toBe('0: この表にはありません（ウェルノウンポート（0〜1023））。')
  expect(textOf(portNumbers(input({ arg: '1023' })))).toContain('ウェルノウンポート')
  expect(textOf(portNumbers(input({ arg: '1024' })))).toContain('登録済みポート（1024〜49151）')
  expect(textOf(portNumbers(input({ arg: '49152' })))).toContain('動的・プライベートポート（49152〜65535）')
  expect(textOf(portNumbers(input({ arg: '65535', lang: 'en' })))).toBe('65535: not in this table (dynamic or private ports (49152 to 65535)).')
  for (const arg of ['65536', '99999999', 'nope', 'ssh2']) {
    for (const lang of ['ja', 'en'] as const) expect(isError(portNumbers(input({ arg, lang })))).toBe(true)
  }
})

test('each ACTIONS entry runs this module\'s compute', () => {
  const byId: Record<string, Compute> = { 'ascii-table': asciiTable, 'http-status': httpStatus, 'mime-types': mimeTypes, 'port-numbers': portNumbers }
  for (const [id, compute] of Object.entries(byId)) {
    const spec = ACTIONS.find(a => a.id === id)
    if (spec?.kind !== 'local') throw new Error(`${id} is not local`)
    expect(spec.compute).toBe(compute)
  }
})

// All twenty, each with a sample argument as register.tsx would pass it.
const date = (y: number, m: number, d: number) => localMidnight({ y, m, d }, () => 540)
const ALL: readonly (readonly [string, Compute, LocalInput['arg']])[] = [
  ['stopwatch', stopwatch, undefined],
  ['pomodoro', pomodoro, 4],
  ['countdown-to', countdownTo, 18 * 60],
  ['breathing', breathing, '478'],
  ['eye-rest', eyeRest, undefined],
  ['clock', clock, undefined],
  ['calendar', calendar, date(2026, 10, 10)],
  ['date-info', dateInfo, date(2019, 5, 1)],
  ['date-offset', dateOffset, -400],
  ['business-days', businessDays, date(2027, 1, 1)],
  ['wareki', wareki, 'H31'],
  ['year-progress', yearProgress, undefined],
  ['time-after', timeAfter, 13 * 3600_000],
  ['duration-convert', durationConvert, 5400_000],
  ['sleep-calc', sleepCalc, 7 * 60],
  ['moon-phase', moonPhase, undefined],
  ['ascii-table', asciiTable, undefined],
  ['http-status', httpStatus, '404'],
  ['mime-types', mimeTypes, 'image/png'],
  ['port-numbers', portNumbers, 'ssh'],
]

// No API whose answer varies by machine or that the hooks module may lack:
// each is replaced by one that throws while the computes (and the frames of
// the runs over time) run, and put back whatever happens.
test('none of the twenty reaches Intl, localeCompare, toLocale*, Date.now, Math.random, crypto or Buffer', () => {
  expect(ALL).toHaveLength(20)
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
  // The test kit freezes the built-in prototypes and Date.now / Math.random:
  // those cannot be replaced here, and are named instead. The source of both
  // modules is also checked for every one of these names (by grep, when the
  // change was made).
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
  const answers: string[] = []
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
    for (const [, compute, arg] of ALL) {
      for (const lang of ['ja', 'en'] as const) {
        const out = compute(input({ arg, lang }))
        if ('ticker' in out) {
          for (const at of [0, 1000, 25 * 60_000, 3 * 3600_000, 24 * 3600_000]) answers.push(out.ticker.frame(BASE.now + at).text)
        } else {
          answers.push(textOf(out))
        }
      }
    }
  } finally {
    for (const [owner, key, desc] of replaced.reverse()) {
      if (desc === undefined) delete (owner as Record<string, unknown>)[key]
      else Object.defineProperty(owner, key, desc)
    }
  }
  expect('a'.localeCompare('b')).toBe(-1)
  expect(answers).toHaveLength(15 * 2 + 5 * 2 * 5)
  const kitFrozen = [
    'Date.now', 'Math.random', 'String#localeCompare', 'String#toLocaleLowerCase', 'String#toLocaleUpperCase',
    'Date#toLocaleString', 'Date#toLocaleDateString', 'Date#toLocaleTimeString', 'Number#toLocaleString', 'Array#toLocaleString',
  ]
  for (const name of frozen) expect(kitFrozen).toContain(name)
  for (const name of ['Intl', 'crypto']) expect(replaced.some(([, key]) => key === name)).toBe(true)
  for (const text of answers) expect(text).not.toBe('')
})
