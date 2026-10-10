import { expect, test } from 'claude-code/testing'

import type { LocalInput, LocalOutput } from '../hooks/actions'
import {
  UNITS,
  UNIT_ALIASES,
  aspectRatio,
  baseConvert,
  bumpVersion,
  byteSize,
  calc,
  chmodCalc,
  englishWords,
  evaluate,
  factorize,
  fromRoman,
  ipCalc,
  kanjiNotation,
  manNotation,
  numberReading,
  pxRem,
  readConversion,
  romanNumeral,
  semverBump,
  splitBill,
  taxCalc,
  taxOf,
  toRoman,
  unitConvert,
  unitOf,
} from '../hooks/calc-local'

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

const run = (compute: Compute, arg: unknown, lang: 'ja' | 'en' = 'ja') => compute(input({ arg, lang }))
const answer = (compute: Compute, arg: unknown, lang: 'ja' | 'en' = 'ja') => textOf(run(compute, arg, lang))

// ---------------------------------------------------------------------------
// calc

test('calc: precedence, functions, constants and rounding to 15 digits', () => {
  const cases: [string, string][] = [
    ['1 + 2 * 3', '7'],
    ['(1 + 2) * 3', '9'],
    ['10 / 4', '2.5'],
    ['7 % 3', '1'],
    ['-7 % 3', '-1'],
    ['2^10', '1024'],
    ['-2^2', '-4'],
    ['(-2)^2', '4'],
    ['2^3^2', '512'],
    ['2^-1', '0.5'],
    ['1e3', '1000'],
    ['2.5e-3', '0.0025'],
    ['.5 + 1.', '1.5'],
    ['0.1+0.2', '0.3'],
    ['sqrt(16)', '4'],
    ['abs(-3.5)', '3.5'],
    ['round(2.5)', '3'],
    ['floor(-1.5)', '-2'],
    ['ceil(1.2)', '2'],
    ['min(3, 1, 2)', '1'],
    ['max(3, 7, 5)', '7'],
    ['max(4)', '4'],
    ['pi', '3.14159265358979'],
    ['2*e', '5.43656365691809'],
    ['e^2', '7.38905609893065'],
    ['PI * Sqrt(4)', '6.28318530717959'],
    ['--3', '3'],
    ['+3', '3'],
  ]
  for (const [expr, value] of cases) expect(answer(calc, expr)).toBe(`${expr} = ${value}`)
  expect(evaluate('2 * (3 + 4) - 5 / 5')).toBe(13)
})

test('calc: division by zero, sqrt of a negative, unknown names, missing operators, unbalanced parentheses and wrong argument counts are errors', () => {
  const bad = [
    '1/0', '7 % 0', 'sqrt(-1)', 'foo', 'foo(1)', '2e', '2pi', '2(3)', '1e', '(1 + 2', '1 + 2)', '()', '1 +', '* 2',
    'sqrt(1, 2)', 'min()', 'sqrt 4', '10^400', '(-8)^(1/3)', '1.2.3', '3 # 4', '1,2',
  ]
  for (const expr of bad) {
    const out = run(calc, expr)
    expect(isError(out)).toBe(true)
    expect((out as { error: string }).error.startsWith('計算できません: ')).toBe(true)
  }
  expect((run(calc, '2pi', 'en') as { error: string }).error).toBe('Cannot calculate: an operator is missing before "pi" at position 2')
  expect((run(calc, '(1 + 2', 'en') as { error: string }).error).toBe('Cannot calculate: a ")" is missing')
  expect((run(calc, 'foo', 'en') as { error: string }).error).toContain('unknown name "foo"')
  expect((run(calc, '1/0', 'en') as { error: string }).error).toContain('division by zero')
  expect(isError(run(calc, 12))).toBe(true)
})

test('calc: no expression shows what can be written and examples, in both languages', () => {
  expect(answer(calc, undefined)).toContain('書ける式')
  expect(answer(calc, '', 'en')).toContain('What you can write')
  // The examples listed are right.
  for (const line of answer(calc, undefined, 'en').split('\n').filter(l => /^ {2}[^A-Z].* = /.test(l))) {
    const [expr, value] = line.trim().split(' = ')
    expect(answer(calc, expr!)).toBe(`${expr} = ${value}`)
  }
})

// ---------------------------------------------------------------------------
// unit-convert

test('unit-convert: lengths, masses, temperatures, areas, volumes and speeds', () => {
  const first = (arg: string) => answer(unitConvert, arg).split('\n')[0]
  expect(first('10 km mi')).toBe('10 km = 6.213711922 mi')
  expect(first('100 F C')).toBe('100 °F = 37.77777778 °C')
  expect(first('5 kg lb')).toBe('5 kg = 11.02311311 lb')
  expect(first('0 C K')).toBe('0 °C = 273.15 K')
  expect(first('-40 c f')).toBe('-40 °C = -40 °F')
  expect(first('1 坪 m2')).toBe('1 坪 = 3.305785124 m2')
  expect(first('1 gal L')).toBe('1 gal = 3.785411784 L')
  expect(first('100 km/h mph')).toBe('100 km/h = 62.13711922 mph')
  expect(first('1 kn km/h')).toBe('1 kn = 1.852 km/h')
  expect(first('1 ha a')).toBe('1 ha = 100 a')
  expect(first('2.5 MI KM')).toBe('2.5 mi = 4.02336 km')
  // The other units of the quantity follow.
  expect(answer(unitConvert, '1 m cm')).toContain('  1000 mm')
})

test('unit-convert: how in is read, by the number of tokens', () => {
  const first = (arg: string) => answer(unitConvert, arg).split('\n')[0]
  expect(first('10 in cm')).toBe('10 in = 25.4 cm')
  expect(first('10 ft in')).toBe('10 ft = 120 in')
  expect(first('10 ft in m')).toBe('10 ft = 3.048 m')
  expect(first('10 km to mi')).toBe('10 km = 6.213711922 mi')
  expect(first('10 in in cm')).toBe('10 in = 25.4 cm')
  expect(first('10km mi')).toBe('10 km = 6.213711922 mi')
  expect(first('10　km　mi')).toBe('10 km = 6.213711922 mi')
  expect(readConversion('10 ft cm m')).toBeUndefined()
  expect(readConversion('10 km')).toBeUndefined()
  for (const bad of ['10 ft cm m', '10 km', '10', 'km mi', '1e3 km mi', 'x km mi', '10 km mi m cm', '10 km TO']) {
    expect(isError(run(unitConvert, bad))).toBe(true)
  }
})

test('unit-convert: units of different kinds, unknown units and a non-text argument are errors', () => {
  const out = run(unitConvert, '10 km kg', 'en') as { error: string }
  expect(out.error).toBe('Cannot convert between units of different kinds: km (length) and kg (mass)')
  expect((run(unitConvert, '10 km parsec', 'en') as { error: string }).error).toContain('Unknown unit: parsec')
  expect(isError(run(unitConvert, '5 C kg'))).toBe(true)
  expect(isError(run(unitConvert, 10))).toBe(true)
})

test('unit-convert: no two aliases the same, each lowercase and naming a known unit; m, mi, mm, t, c, f, k and cup kept apart', () => {
  const aliases = UNIT_ALIASES.map(([a]) => a)
  expect(new Set(aliases).size).toBe(aliases.length)
  const ids = new Set(UNITS.map(u => u.id))
  for (const [alias, id] of UNIT_ALIASES) {
    expect(alias).toBe(alias.toLowerCase())
    expect(ids.has(id)).toBe(true)
  }
  // Every unit has at least one name.
  for (const u of UNITS) expect(UNIT_ALIASES.some(([, id]) => id === u.id)).toBe(true)
  const expected: [string, string][] = [
    ['m', 'm'], ['M', 'm'], ['mi', 'mi'], ['mm', 'mm'], ['t', 't'], ['c', '°C'], ['C', '°C'], ['℃', '°C'],
    ['f', '°F'], ['k', 'K'], ['K', 'K'], ['cup', 'cup'], ['in', 'in'], ['kph', 'km/h'], ['ml', 'mL'], ['L', 'L'],
  ]
  for (const [name, id] of expected) expect(unitOf(name)?.id).toBe(id)
})

test('unit-convert: no argument shows the table of common conversions', () => {
  expect(answer(unitConvert, undefined)).toContain('1 in = 2.54 cm')
  expect(answer(unitConvert, '', 'en')).toContain('Common conversions')
})

// ---------------------------------------------------------------------------
// base-convert

test('base-convert: a whole number of any size in bases 2, 8, 10 and 16', () => {
  expect(answer(baseConvert, '255')).toBe('2 進: 0b11111111\n8 進: 0o377\n10 進: 255\n16 進: 0xFF')
  for (const s of ['0xff', '0XFF', '0b1111_1111', '0o377', '2_5_5']) expect(answer(baseConvert, s)).toContain('10 進: 255')
  expect(answer(baseConvert, '-10', 'en')).toBe('Binary: -0b1010\nOctal: -0o12\nDecimal: -10\nHexadecimal: -0xA')
  expect(answer(baseConvert, '0')).toContain('2 進: 0b0')
  // Past 2^53, exactly.
  const big = answer(baseConvert, '0x1' + '0'.repeat(32))
  expect(big).toContain(`10 進: ${(BigInt(2) ** BigInt(128)).toString()} (340,282,366,920,938,463,463,374,607,431,768,211,456)`)
  for (const bad of ['', 'abc', '0x', '0b102', '0o8', '1.5', '_1', '1_', '1__0', '0xg', 25]) expect(isError(run(baseConvert, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// byte-size

test('byte-size: bytes and the decimal and binary units', () => {
  const gib = answer(byteSize, '1GiB').split('\n')
  expect(gib[0]).toBe('B: 1,073,741,824')
  expect(gib).toContain('  1.073741824 GB')
  expect(gib).toContain('  1 GiB')
  expect(gib).toContain('  1048576 KiB')
  expect(gib).toContain('  9.536743164e-7 PiB')
  const mb = answer(byteSize, '500MB').split('\n')
  expect(mb[0]).toBe('B: 500,000,000')
  expect(mb).toContain('  476.8371582 MiB')
  expect(answer(byteSize, '123456789').split('\n')[0]).toBe('B: 123,456,789')
  expect(answer(byteSize, '1.5 kb').split('\n')[0]).toBe('B: 1,500')
  expect(answer(byteSize, '2Ki').split('\n')[0]).toBe('B: 2,048')
  expect(answer(byteSize, '0').split('\n')[0]).toBe('B: 0')
  expect(answer(byteSize, '1000PB').split('\n')[0]).toBe('B: 1,000,000,000,000,000,000')
  expect(answer(byteSize, '1GiB', 'en')).toContain('Decimal (1 KB = 1000 B):')
  for (const bad of ['', 'abc', '1XB', '-1MB', '1.2.3GB', '1001PB', '1e3', 1024]) expect(isError(run(byteSize, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// tax-calc

test('tax-calc: 10% and 8%, before tax and with tax, fractions of a yen rounded down', () => {
  expect(taxOf(100_000, 10)).toEqual({ addTax: 10_000, withTax: 110_000, beforeTax: 90_900, taxIncluded: 9_100 })
  const text = answer(taxCalc, 1000)
  expect(text).toContain('金額: 1,000 円')
  expect(text).toContain('税抜として: 税込 1,100 円（税 100 円）')
  expect(text).toContain('税込として: 税抜 909 円（税 91 円）')
  expect(text).toContain('税抜として: 税込 1,080 円（税 80 円）')
  expect(text).toContain('税込として: 税抜 925 円（税 75 円）')
  expect(text).toContain('端数は 1 円未満を切り捨てています。')
  // A decimal amount, taken in whole sen both ways: 999.5 → tax 99.95 rounded down to 99; with tax, 999.5 / 1.1 = 908.6… → 908.
  const dec = answer(taxCalc, 999.5)
  expect(dec).toContain('金額: 999.5 円')
  expect(dec).toContain('税込 1,098.5 円（税 99 円）')
  expect(dec).toContain('税抜 908 円（税 91.5 円）')
  // 0.1 + 0.2 kind of amounts stay exact: 19.99 at 10% is 1.999 → 1 yen.
  expect(answer(taxCalc, 19.99)).toContain('税込 20.99 円（税 1 円）')
  // The bounds.
  expect(answer(taxCalc, 0)).toContain('税込 0 円（税 0 円）')
  expect(answer(taxCalc, 1e12)).toContain('税込 1,100,000,000,000 円（税 100,000,000,000 円）')
  expect(answer(taxCalc, 1000, 'en')).toContain('As with tax: 909 yen before tax (tax 91 yen)')
  for (const bad of [-1, 1e12 + 1, '1000', Number.NaN, undefined]) expect(isError(run(taxCalc, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// split-bill

test('split-bill: the share, the rest, and how to collect it rounded up to 1 or 100 yen', () => {
  const lines = answer(splitBill, '10000/3').split('\n')
  expect(lines).toEqual([
    '10,000 円を 3 人で割り勘',
    '',
    '1 人あたり: 3,333 円（余り 1 円）',
    '  ちょうど集めるなら: 3,334 円 × 1 人 + 3,333 円 × 2 人',
    '1 円単位で切り上げ: 1 人 3,334 円、合計 10,002 円（余剰 2 円）',
    '100 円単位で切り上げ: 1 人 3,400 円、合計 10,200 円（余剰 200 円）',
  ])
  expect(answer(splitBill, '9000 ／ 3')).not.toContain('ちょうど集めるなら')
  expect(answer(splitBill, '1/2', 'en')).toContain('Each: 0 yen (1 yen left over)')
  expect(isError(run(splitBill, '1000000000000/1000'))).toBe(false)
  for (const bad of ['', '10000', '10000/1', '10000/1001', '0/3', '1000000000001/2', '10000/3.5', 'a/b', 3]) {
    expect(isError(run(splitBill, bad))).toBe(true)
  }
})

// ---------------------------------------------------------------------------
// factorize

test('factorize: prime factors, the count and list of divisors (up to 100), and whether it is prime', () => {
  expect(answer(factorize, 360).split('\n')).toEqual([
    '360 = 2^3 × 3^2 × 5',
    '素数: いいえ',
    '約数の個数: 24',
    '約数: 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 18, 20, 24, 30, 36, 40, 45, 60, 72, 90, 120, 180, 360',
  ])
  expect(answer(factorize, 2).split('\n').slice(0, 3)).toEqual(['2 = 2', '素数: はい', '約数の個数: 2'])
  // The largest prime below 10^12, found by trial division up to 10^6.
  expect(answer(factorize, 999_999_999_989, 'en')).toContain('Prime: yes')
  // 10^12 = 2^12 × 5^12: 169 divisors, 100 shown.
  const big = answer(factorize, 1e12, 'en').split('\n')
  expect(big[0]).toBe('1000000000000 = 2^12 × 5^12')
  expect(big[2]).toBe('Number of divisors: 169')
  expect(big[3]!.endsWith(' and 69 more')).toBe(true)
  expect(big[3]!.replace('Divisors: ', '').replace(' and 69 more', '').split(', ')).toHaveLength(100)
  for (const bad of [1, 1e12 + 1, 2.5, '360', undefined]) expect(isError(run(factorize, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// roman-numeral

test('roman-numeral: both ways, told apart by the form; 1 to 3999 and standard spellings only', () => {
  expect(answer(romanNumeral, '2024')).toBe('2024 = MMXXIV')
  expect(answer(romanNumeral, '1')).toBe('1 = I')
  expect(answer(romanNumeral, '3999')).toBe('3999 = MMMCMXCIX')
  expect(answer(romanNumeral, 'mmxxiv')).toBe('MMXXIV = 2024')
  expect(answer(romanNumeral, 'XLIX')).toBe('XLIX = 49')
  for (let n = 1; n <= 3999; n++) expect(fromRoman(toRoman(n))).toBe(n)
  for (const bad of ['0', '4000', 'IIII', 'VX', 'IC', 'MMMM', 'ABC', '12a', '', 2024]) expect(isError(run(romanNumeral, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// number-reading

test('number-reading: grouped digits, 万 notation, kanji and English', () => {
  expect(answer(numberReading, '1234567').split('\n')).toEqual([
    '桁区切り: 1,234,567',
    '万進: 123万4567',
    '漢数字: 百二十三万四千五百六十七',
    '英語: one million two hundred thirty-four thousand five hundred sixty-seven',
  ])
  expect(manNotation('123456789')).toBe('1億2345万6789')
  expect(manNotation('100000001')).toBe('1億1')
  expect(kanjiNotation('123456789')).toBe('一億二千三百四十五万六千七百八十九')
  expect(kanjiNotation('10000')).toBe('一万')
  expect(kanjiNotation('1111')).toBe('千百十一')
  expect(englishWords('1000001')).toBe('one million one')
  expect(englishWords('20')).toBe('twenty')
  expect(englishWords('115')).toBe('one hundred fifteen')
  expect(answer(numberReading, '0', 'en')).toContain('English: zero')
  expect(answer(numberReading, '-1,000', 'en')).toContain('English: minus one thousand')
  // The largest taken: 24 digits, in 垓 and sextillion.
  const max = answer(numberReading, '9'.repeat(24))
  expect(max).toContain('万進: 9999垓9999京9999兆9999億9999万9999')
  expect(answer(numberReading, '1' + '0'.repeat(21), 'en')).toContain('English: one sextillion')
  for (const bad of ['1' + '0'.repeat(24), '1.5', '1,23', 'abc', '', '12,345,67', 1234567]) expect(isError(run(numberReading, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// semver-bump

test('semver-bump: npm semver inc for releases and prereleases, build metadata dropped', () => {
  expect(bumpVersion('1.4.2')).toEqual({ patch: '1.4.3', minor: '1.5.0', major: '2.0.0', prerelease: '1.4.3-0' })
  expect(bumpVersion('2.0.0-rc.1')).toEqual({ patch: '2.0.0', minor: '2.0.0', major: '2.0.0', prerelease: '2.0.0-rc.2' })
  expect(bumpVersion('1.2.3-beta')).toEqual({ patch: '1.2.3', minor: '1.3.0', major: '2.0.0', prerelease: '1.2.3-beta.0' })
  expect(bumpVersion('1.2.0-beta')?.minor).toBe('1.2.0')
  expect(bumpVersion('1.2.0-beta')?.major).toBe('2.0.0')
  expect(bumpVersion('1.0.0-alpha.1.beta')?.prerelease).toBe('1.0.0-alpha.2.beta')
  expect(bumpVersion('v1.0.0+build.5')).toEqual({ patch: '1.0.1', minor: '1.1.0', major: '2.0.0', prerelease: '1.0.1-0' })
  expect(answer(semverBump, '1.4.2')).toBe('patch: 1.4.3\nminor: 1.5.0\nmajor: 2.0.0\nprerelease: 1.4.3-0')
  for (const bad of ['1.2', '01.2.3', '1.2.3-', '1.2.3-01', 'a.b.c', '', '1.2.3.4', 1.2]) expect(isError(run(semverBump, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// ip-calc

test('ip-calc: network, broadcast, host range and count, mask and wildcard', () => {
  expect(answer(ipCalc, '192.168.0.0/24').split('\n')).toEqual([
    'ネットワークアドレス: 192.168.0.0/24',
    'ブロードキャスト: 192.168.0.255',
    'ホスト範囲: 192.168.0.1 - 192.168.0.254',
    'ホスト数: 254',
    'サブネットマスク: 255.255.255.0',
    'ワイルドカード: 0.0.0.255',
  ])
  const zero = answer(ipCalc, '0.0.0.0/0', 'en')
  expect(zero).toContain('Subnet mask: 0.0.0.0')
  expect(zero).toContain('Hosts: 4,294,967,294')
  expect(zero).toContain('Broadcast: 255.255.255.255')
  const p31 = answer(ipCalc, '10.0.0.0/31', 'en')
  expect(p31).toContain('Hosts: 2')
  expect(p31).toContain('Host range: 10.0.0.0 - 10.0.0.1')
  expect(p31).toContain('RFC 3021')
  const p32 = answer(ipCalc, '10.0.0.7/32', 'en')
  expect(p32).toContain('Hosts: 1')
  expect(p32).toContain('Host range: 10.0.0.7')
  expect(p32).toContain('Subnet mask: 255.255.255.255')
  const off = answer(ipCalc, '192.168.1.130/25', 'en')
  expect(off).toContain('Network: 192.168.1.128/25')
  expect(off).toContain('192.168.1.130 is not on the network boundary')
  expect(answer(ipCalc, '172.16.0.0/12')).toContain('ブロードキャスト: 172.31.255.255')
  for (const bad of ['192.168.0.0', '192.168.01.0/24', '256.0.0.0/24', '1.2.3.4/33', '1.2.3/24', '1.2.3.4/024', 'abc', '', 24]) {
    expect(isError(run(ipCalc, bad))).toBe(true)
  }
})

// ---------------------------------------------------------------------------
// aspect-ratio

test('aspect-ratio: the ratio in lowest terms and as a decimal, with the common sizes of that ratio', () => {
  const lines = answer(aspectRatio, '1920x1080').split('\n')
  expect(lines[0]).toBe('1920x1080 = 16:9 (1.78:1)')
  expect(lines).toContain('  3840x2160 (4K UHD)')
  expect(lines).toContain('  1280x720 (HD)')
  expect(answer(aspectRatio, '1024 × 768')).toContain('= 4:3 (1.33:1)')
  expect(answer(aspectRatio, '1920:1200')).toContain('  2560x1600 (WQXGA)')
  expect(answer(aspectRatio, '1X1')).toContain('  1080x1080 (Square)')
  expect(answer(aspectRatio, '7x5', 'en')).toContain('  none')
  expect(answer(aspectRatio, '100000x1').split('\n')[0]).toBe('100000x1 = 100000:1 (100000.00:1)')
  for (const bad of ['', '1920', '0x1080', '1920x0', '100001x1', '19.2x10', 'axb', 1920]) expect(isError(run(aspectRatio, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// px-rem

test('px-rem: px, rem, em and pt on a 16px root', () => {
  expect(answer(pxRem, '16px').split('\n').slice(0, 4)).toEqual(['16px', '1rem', '1em', '12pt'])
  expect(answer(pxRem, '1.5rem').split('\n').slice(0, 4)).toEqual(['24px', '1.5rem', '1.5em', '18pt'])
  expect(answer(pxRem, '12pt').split('\n').slice(0, 4)).toEqual(['16px', '1rem', '1em', '12pt'])
  expect(answer(pxRem, '16PX').split('\n')[1]).toBe('1rem')
  expect(answer(pxRem, '.5em').split('\n')[0]).toBe('8px')
  expect(answer(pxRem, '0px').split('\n')[0]).toBe('0px')
  expect(answer(pxRem, '1000000px').split('\n')[1]).toBe('62500rem')
  expect(answer(pxRem, '10px', 'en')).toContain('when the parent\'s font size is 16px')
  for (const bad of ['1.2.3px', '.px', 'px', '16', '-1px', '1000001px', '16 vw', '', 16]) expect(isError(run(pxRem, bad))).toBe(true)
})

// ---------------------------------------------------------------------------
// chmod-calc

test('chmod-calc: octal to symbols and back, with each class spelt out', () => {
  expect(answer(chmodCalc, '755').split('\n')).toEqual([
    '755 = rwxr-xr-x',
    '',
    '所有者 (7): 読み・書き・実行',
    'グループ (5): 読み・実行',
    'その他 (5): 読み・実行',
    '',
    'chmod 755 <file>',
  ])
  expect(answer(chmodCalc, 'rw-r--r--').split('\n')[0]).toBe('644 = rw-r--r--')
  // Ten characters: a file type in front.
  expect(answer(chmodCalc, 'drwxr-xr-x').split('\n')[0]).toBe('755 = rwxr-xr-x')
  expect(answer(chmodCalc, '-rw-------').split('\n')[0]).toBe('600 = rw-------')
  expect(answer(chmodCalc, '000', 'en')).toContain('Owner (0): none')
  // The special bits, both ways.
  expect(answer(chmodCalc, '4755').split('\n')[0]).toBe('4755 = rwsr-xr-x')
  expect(answer(chmodCalc, '1777').split('\n')[0]).toBe('1777 = rwxrwxrwt')
  expect(answer(chmodCalc, '2644').split('\n')[0]).toBe('2644 = rw-r-Sr--')
  expect(answer(chmodCalc, 'rwsr-xr-x').split('\n')[0]).toBe('4755 = rwsr-xr-x')
  expect(answer(chmodCalc, 'drwxrwxrwT').split('\n')[0]).toBe('1776 = rwxrwxrwT')
  expect(answer(chmodCalc, '4755')).toContain('setuid')
  expect(answer(chmodCalc, '0755').split('\n')[0]).toBe('755 = rwxr-xr-x')
  for (const bad of ['', '75', '78', '77777', 'rwxr-xr-', 'rwxr-xr-xx', 'xwrr-xr-x', 'zrwxr-xr-x', 'rwtr-xr-x', 755]) {
    expect(isError(run(chmodCalc, bad))).toBe(true)
  }
})

test('every one that takes text answers an argument of another type with the usual words, in both languages', () => {
  const computes: Compute[] = [calc, unitConvert, baseConvert, byteSize, splitBill, romanNumeral, numberReading, semverBump, ipCalc, aspectRatio, pxRem, chmodCalc]
  for (const compute of computes) {
    for (const lang of ['ja', 'en'] as const) {
      const out = compute(input({ arg: 404, lang })) as { error: string }
      expect(out.error.startsWith(lang === 'ja' ? '引数が正しくありません: ' : 'Invalid argument: ')).toBe(true)
    }
  }
  for (const lang of ['ja', 'en'] as const) {
    for (const compute of [taxCalc, factorize]) {
      const out = compute(input({ arg: 'x', lang })) as { error: string }
      expect(out.error.startsWith(lang === 'ja' ? '引数が正しくありません: ' : 'Invalid argument: ')).toBe(true)
    }
  }
})
