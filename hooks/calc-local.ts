// The standalone local actions that calculate or convert: calc, unit-convert,
// base-convert, byte-size, tax-calc, split-bill, factorize, roman-numeral,
// number-reading, semver-bump, ip-calc, aspect-ratio, px-rem and chmod-calc.
// Their tables (unit factors, screen resolutions) live here, in the source;
// nothing is fetched.
//
// Synchronous and pure, as LocalAction asks: ECMAScript's built-ins alone and
// nothing that formats by locale (digits are grouped by hand). calc reads its
// expression with its own parser; nothing is evaluated as code.
//
// Each takes its argument as register.tsx parsed it (./args); a text that does
// not read as what the action takes, or a value of another type or out of its
// range, is answered with `{ error }` saying how to write it.

import type { LocalInput, LocalOutput } from './actions'
import type { Lang } from './i18n'

type Texts = Record<Lang, string>

/** `{ error }` for an argument the action does not take, saying what it takes. */
const invalid = (lang: Lang, expected: Texts): LocalOutput => ({
  error: lang === 'ja' ? `引数が正しくありません: ${expected.ja}` : `Invalid argument: ${expected.en}`,
})

const isInt = (arg: unknown, min: number, max: number): arg is number =>
  typeof arg === 'number' && Number.isInteger(arg) && arg >= min && arg <= max

/** The argument as text: '' for none, undefined when it is no string. */
const textOf = (arg: unknown): string | undefined => (arg === undefined ? '' : typeof arg === 'string' ? arg.trim() : undefined)

/** Digits grouped by three with commas, a sign kept in front. */
export const groupDigits = (digits: string): string => {
  const sign = digits.startsWith('-') ? '-' : ''
  const body = sign === '' ? digits : digits.slice(1)
  return sign + body.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** A number rounded to `precision` significant digits, written without trailing zeros (and never as -0). */
export const fmt = (n: number, precision = 10): string => {
  const v = Number(n.toPrecision(precision))
  return String(v === 0 ? 0 : v)
}

// ---------------------------------------------------------------------------
// calc: a small expression language, read by a recursive-descent parser.
//
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%') unary)*
//   unary   := ('+' | '-') unary | power
//   power   := primary ('^' unary)?              (right-associative: 2^3^2 = 512)
//   primary := number | constant | function '(' expr (',' expr)* ')' | '(' expr ')'
//
// `-2^2` is -4, as in mathematics. A number may carry an exponent (1e3) only
// when digits follow the `e`; nothing is multiplied without an operator, so
// `2e`, `2pi` and `2(3)` are errors.

type Token =
  | { kind: 'num'; value: number; text: string; at: number }
  | { kind: 'id'; name: string; text: string; at: number }
  | { kind: 'op'; op: string; text: string; at: number }

class CalcError extends Error {
  texts: Texts
  constructor(texts: Texts) {
    super(texts.en)
    this.texts = texts
  }
}

const fail = (ja: string, en: string): never => {
  throw new CalcError({ ja, en })
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    const num = /^(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
    if (num !== null) {
      tokens.push({ kind: 'num', value: Number(num[0]), text: num[0], at: i })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id !== null) {
      tokens.push({ kind: 'id', name: id[0].toLowerCase(), text: id[0], at: i })
      i += id[0].length
      continue
    }
    if ('+-*/%^(),'.includes(c)) {
      tokens.push({ kind: 'op', op: c, text: c, at: i })
      i++
      continue
    }
    fail(`使えない文字「${c}」があります（${i + 1} 文字目）`, `unexpected character "${c}" at position ${i + 1}`)
  }
  return tokens
}

export const CALC_CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E }

const UNARY_FUNCTIONS: Readonly<Record<string, (x: number) => number>> = {
  sqrt: x => (x < 0 ? fail('負の数の sqrt は計算できません', 'sqrt of a negative number') : Math.sqrt(x)),
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
}
const VARIADIC_FUNCTIONS: Readonly<Record<string, (xs: number[]) => number>> = {
  min: xs => Math.min(...xs),
  max: xs => Math.max(...xs),
}

const at = (t: Token | undefined, src: string) => (t === undefined ? src.length + 1 : t.at + 1)

/** The value of an expression, or the reason it has none (thrown as CalcError, caught by calc). */
export function evaluate(src: string): number {
  const tokens = tokenize(src)
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (op: string) => {
    const t = peek()
    return t !== undefined && t.kind === 'op' && t.op === op
  }
  const missingOperator = (t: Token) =>
    fail(`「${t.text}」の前に演算子がありません（${t.at + 1} 文字目）`, `an operator is missing before "${t.text}" at position ${t.at + 1}`)

  function expr(): number {
    let v = term()
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { op: string }).op
      const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  function term(): number {
    let v = unary()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (tokens[pos++] as { op: string }).op
      const r = unary()
      if ((op === '/' || op === '%') && r === 0) fail('0 で割ることはできません', 'division by zero')
      v = op === '*' ? v * r : op === '/' ? v / r : v % r
    }
    return v
  }
  function unary(): number {
    if (isOp('+')) {
      pos++
      return unary()
    }
    if (isOp('-')) {
      pos++
      return -unary()
    }
    return power()
  }
  function power(): number {
    const base = primary()
    if (isOp('^')) {
      pos++
      return Math.pow(base, unary())
    }
    return base
  }
  function primary(): number {
    const t = peek()
    if (t === undefined) return fail('式が途中で終わっています', 'the expression ends too early')
    if (t.kind === 'num') {
      pos++
      return t.value
    }
    if (t.kind === 'op' && t.op === '(') {
      pos++
      const v = expr()
      if (!isOp(')')) closeParen()
      pos++
      return v
    }
    if (t.kind === 'id') {
      pos++
      const unaryFn = UNARY_FUNCTIONS[t.name]
      const variadicFn = VARIADIC_FUNCTIONS[t.name]
      if (unaryFn !== undefined || variadicFn !== undefined) {
        if (!isOp('(')) fail(`関数 ${t.name} の後に ( がありません`, `"(" is missing after the function ${t.name}`)
        pos++
        const args = [expr()]
        while (isOp(',')) {
          pos++
          args.push(expr())
        }
        if (!isOp(')')) closeParen()
        pos++
        if (unaryFn !== undefined) {
          if (args.length !== 1) fail(`${t.name} の引数は 1 個です（${args.length} 個あります）`, `${t.name} takes one argument (${args.length} given)`)
          return unaryFn(args[0]!)
        }
        return variadicFn!(args)
      }
      const constant = CALC_CONSTANTS[t.name]
      if (constant !== undefined) return constant
      return fail(`知らない名前「${t.text}」があります（${t.at + 1} 文字目）`, `unknown name "${t.text}" at position ${t.at + 1}`)
    }
    return fail(`「${t.text}」の前に値がありません（${t.at + 1} 文字目）`, `a value is missing before "${t.text}" at position ${t.at + 1}`)
  }
  function closeParen(): never {
    const t = peek()
    if (t === undefined) return fail('閉じ括弧 ) が足りません', 'a ")" is missing')
    if (t.kind === 'num' || t.kind === 'id' || (t.kind === 'op' && t.op === '(')) return missingOperator(t)
    return fail(`「${t.text}」の位置に ) が必要です（${at(t, src)} 文字目）`, `")" is expected at "${t.text}", position ${at(t, src)}`)
  }

  if (tokens.length === 0) fail('式が空です', 'the expression is empty')
  const v = expr()
  const rest = peek()
  if (rest !== undefined) {
    if (rest.kind === 'op' && rest.op === ')') fail(`閉じ括弧 ) が多すぎます（${rest.at + 1} 文字目）`, `too many ")" at position ${rest.at + 1}`)
    if (rest.kind === 'num' || rest.kind === 'id' || (rest.kind === 'op' && rest.op === '(')) missingOperator(rest)
    fail(`「${rest.text}」を読めません（${rest.at + 1} 文字目）`, `cannot read "${rest.text}" at position ${rest.at + 1}`)
  }
  if (!Number.isFinite(v)) fail('結果が有限の数になりません', 'the result is not a finite number')
  return v
}

/** A result to 15 significant digits, so 0.1 + 0.2 shows as 0.3. */
export const formatCalc = (v: number) => fmt(v, 15)

const CALC_HELP: Texts = {
  ja: [
    '書ける式:',
    '  演算子: + - * / %（剰余） ^（べき乗、右結合）と括弧',
    '  関数: sqrt abs round floor ceil（引数 1 個）、min max（引数 1 個以上）',
    '  定数: pi e',
    '  数値: 12、3.5、.5、1e3、2.5e-3',
    '  -2^2 は -4（^ は単項マイナスより先に計算）。2pi のような省略した掛け算は書けません',
    '',
    '例:',
    '  (1 + 2) * 3 = 9',
    '  2^10 = 1024',
    '  sqrt(2) = 1.4142135623731',
    '  max(3, 7, 5) = 7',
    '  2 * pi * 10 = 62.8318530717959',
  ].join('\n'),
  en: [
    'What you can write:',
    '  Operators: + - * / % (remainder) ^ (power, right-associative) and parentheses',
    '  Functions: sqrt abs round floor ceil (one argument), min max (one or more)',
    '  Constants: pi e',
    '  Numbers: 12, 3.5, .5, 1e3, 2.5e-3',
    '  -2^2 is -4 (^ binds tighter than a leading minus). Multiplication needs its operator: write 2*pi, not 2pi',
    '',
    'Examples:',
    '  (1 + 2) * 3 = 9',
    '  2^10 = 1024',
    '  sqrt(2) = 1.4142135623731',
    '  max(3, 7, 5) = 7',
    '  2 * pi * 10 = 62.8318530717959',
  ].join('\n'),
}

/** The expression in the argument, worked out; with none, what can be written and examples. */
export const calc = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  if (s === undefined) return invalid(lang, { ja: '数式', en: 'an expression' })
  if (s === '') return { text: CALC_HELP[lang] }
  try {
    return { text: `${s} = ${formatCalc(evaluate(s))}` }
  } catch (err) {
    if (err instanceof CalcError) return { error: lang === 'ja' ? `計算できません: ${err.texts.ja}` : `Cannot calculate: ${err.texts.en}` }
    throw err
  }
}

// ---------------------------------------------------------------------------
// unit-convert.

type Quantity = 'length' | 'mass' | 'area' | 'volume' | 'speed' | 'temperature'

type Unit = { id: string; quantity: Quantity; /** In the quantity's base unit (m, kg, m², L, m/s); none for a temperature. */ factor?: number }

export const UNITS: readonly Unit[] = [
  { id: 'm', quantity: 'length', factor: 1 },
  { id: 'km', quantity: 'length', factor: 1000 },
  { id: 'cm', quantity: 'length', factor: 0.01 },
  { id: 'mm', quantity: 'length', factor: 0.001 },
  { id: 'mi', quantity: 'length', factor: 1609.344 },
  { id: 'yd', quantity: 'length', factor: 0.9144 },
  { id: 'ft', quantity: 'length', factor: 0.3048 },
  { id: 'in', quantity: 'length', factor: 0.0254 },
  { id: 'nmi', quantity: 'length', factor: 1852 },
  { id: 'kg', quantity: 'mass', factor: 1 },
  { id: 'g', quantity: 'mass', factor: 0.001 },
  { id: 'mg', quantity: 'mass', factor: 0.000001 },
  { id: 't', quantity: 'mass', factor: 1000 },
  { id: 'lb', quantity: 'mass', factor: 0.45359237 },
  { id: 'oz', quantity: 'mass', factor: 0.028349523125 },
  { id: 'm2', quantity: 'area', factor: 1 },
  { id: 'km2', quantity: 'area', factor: 1_000_000 },
  { id: 'cm2', quantity: 'area', factor: 0.0001 },
  { id: 'ha', quantity: 'area', factor: 10_000 },
  { id: 'a', quantity: 'area', factor: 100 },
  { id: 'ft2', quantity: 'area', factor: 0.09290304 },
  { id: 'acre', quantity: 'area', factor: 4046.8564224 },
  { id: '坪', quantity: 'area', factor: 400 / 121 },
  { id: 'L', quantity: 'volume', factor: 1 },
  { id: 'mL', quantity: 'volume', factor: 0.001 },
  { id: 'm3', quantity: 'volume', factor: 1000 },
  { id: 'gal', quantity: 'volume', factor: 3.785411784 },
  { id: 'qt', quantity: 'volume', factor: 0.946352946 },
  { id: 'pt', quantity: 'volume', factor: 0.473176473 },
  { id: 'cup', quantity: 'volume', factor: 0.2365882365 },
  { id: 'floz', quantity: 'volume', factor: 0.0295735295625 },
  { id: 'm/s', quantity: 'speed', factor: 1 },
  { id: 'km/h', quantity: 'speed', factor: 1 / 3.6 },
  { id: 'mph', quantity: 'speed', factor: 0.44704 },
  { id: 'kn', quantity: 'speed', factor: 1852 / 3600 },
  { id: '°C', quantity: 'temperature' },
  { id: '°F', quantity: 'temperature' },
  { id: 'K', quantity: 'temperature' },
]

/** Each name a unit is written as (all lowercase) and the unit's ID. A name is never listed twice (a test checks). */
export const UNIT_ALIASES: readonly (readonly [string, string])[] = [
  ...['m', 'meter', 'meters', 'metre', 'metres', 'メートル'].map(a => [a, 'm'] as const),
  ...['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'キロメートル'].map(a => [a, 'km'] as const),
  ...['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres', 'センチ', 'センチメートル'].map(a => [a, 'cm'] as const),
  ...['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres', 'ミリ', 'ミリメートル'].map(a => [a, 'mm'] as const),
  ...['mi', 'mile', 'miles', 'マイル'].map(a => [a, 'mi'] as const),
  ...['yd', 'yard', 'yards', 'ヤード'].map(a => [a, 'yd'] as const),
  ...['ft', 'foot', 'feet', 'フィート'].map(a => [a, 'ft'] as const),
  ...['in', 'inch', 'inches', 'インチ'].map(a => [a, 'in'] as const),
  ...['nmi', 'nautical-mile', '海里'].map(a => [a, 'nmi'] as const),
  ...['kg', 'kilogram', 'kilograms', 'キロ', 'キログラム'].map(a => [a, 'kg'] as const),
  ...['g', 'gram', 'grams', 'グラム'].map(a => [a, 'g'] as const),
  ...['mg', 'milligram', 'milligrams', 'ミリグラム'].map(a => [a, 'mg'] as const),
  ...['t', 'ton', 'tons', 'tonne', 'tonnes', 'トン'].map(a => [a, 't'] as const),
  ...['lb', 'lbs', 'pound', 'pounds', 'ポンド'].map(a => [a, 'lb'] as const),
  ...['oz', 'ounce', 'ounces', 'オンス'].map(a => [a, 'oz'] as const),
  ...['m2', 'm²', 'sqm', '㎡', '平方メートル'].map(a => [a, 'm2'] as const),
  ...['km2', 'km²', '㎢', '平方キロメートル'].map(a => [a, 'km2'] as const),
  ...['cm2', 'cm²', '㎠', '平方センチメートル'].map(a => [a, 'cm2'] as const),
  ...['ha', 'hectare', 'hectares', 'ヘクタール'].map(a => [a, 'ha'] as const),
  ...['a', 'are', 'ares', 'アール'].map(a => [a, 'a'] as const),
  ...['ft2', 'ft²', 'sqft'].map(a => [a, 'ft2'] as const),
  ...['acre', 'acres', 'エーカー'].map(a => [a, 'acre'] as const),
  ...['坪', 'tsubo'].map(a => [a, '坪'] as const),
  ...['l', 'liter', 'liters', 'litre', 'litres', 'ℓ', 'リットル'].map(a => [a, 'L'] as const),
  ...['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'cc', 'ミリリットル'].map(a => [a, 'mL'] as const),
  ...['m3', 'm³', '㎥', '立方メートル'].map(a => [a, 'm3'] as const),
  ...['gal', 'gallon', 'gallons', 'ガロン'].map(a => [a, 'gal'] as const),
  ...['qt', 'quart', 'quarts', 'クォート'].map(a => [a, 'qt'] as const),
  ...['pt', 'pint', 'pints', 'パイント'].map(a => [a, 'pt'] as const),
  ...['cup', 'cups', 'カップ'].map(a => [a, 'cup'] as const),
  ...['floz', 'fl-oz', 'fl.oz', '液量オンス'].map(a => [a, 'floz'] as const),
  ...['m/s', 'mps'].map(a => [a, 'm/s'] as const),
  ...['km/h', 'kph', 'kmh', 'km/hr'].map(a => [a, 'km/h'] as const),
  ...['mph', 'mi/h'].map(a => [a, 'mph'] as const),
  ...['kn', 'kt', 'knot', 'knots', 'ノット'].map(a => [a, 'kn'] as const),
  ...['c', '°c', '℃', 'celsius', '摂氏'].map(a => [a, '°C'] as const),
  ...['f', '°f', '℉', 'fahrenheit', '華氏'].map(a => [a, '°F'] as const),
  ...['k', 'kelvin', 'ケルビン'].map(a => [a, 'K'] as const),
]

const UNIT_BY_ID = new Map(UNITS.map(u => [u.id, u]))
const UNIT_BY_ALIAS = new Map(UNIT_ALIASES.map(([alias, id]) => [alias, UNIT_BY_ID.get(id)!]))

/** The unit a name stands for (case folded), or undefined. */
export const unitOf = (name: string): Unit | undefined => UNIT_BY_ALIAS.get(name.toLowerCase())

const toKelvin = (v: number, id: string) => (id === '°C' ? v + 273.15 : id === '°F' ? ((v - 32) * 5) / 9 + 273.15 : v)
const fromKelvin = (k: number, id: string) => (id === '°C' ? k - 273.15 : id === '°F' ? ((k - 273.15) * 9) / 5 + 32 : k)

/** `value` in unit `from` converted to unit `to` (of the same quantity). */
export function convertUnit(value: number, from: Unit, to: Unit): number {
  if (from.quantity === 'temperature') return fromKelvin(toKelvin(value, from.id), to.id)
  return (value * from.factor!) / to.factor!
}

const QUANTITY_NAMES: Readonly<Record<Quantity, Texts>> = {
  length: { ja: '長さ', en: 'length' },
  mass: { ja: '重さ', en: 'mass' },
  area: { ja: '面積', en: 'area' },
  volume: { ja: '体積', en: 'volume' },
  speed: { ja: '速度', en: 'speed' },
  temperature: { ja: '温度', en: 'temperature' },
}

const UNIT_FORMAT: Texts = {
  ja: '<値> <単位> <単位>（例: 10 km mi、100 F C、5 kg lb。10 km to mi とも書ける）',
  en: '<value> <unit> <unit>, e.g. 10 km mi, 100 F C, 5 kg lb (10 km to mi works too)',
}

const UNIT_TABLE: Texts = {
  ja: [
    'よく使う換算（書式: <値> <単位> <単位>。例: 10 km mi）:',
    '  1 in = 2.54 cm、1 ft = 30.48 cm、1 yd = 0.9144 m、1 mi = 1.609344 km',
    '  1 lb = 453.59237 g、1 oz = 28.349523125 g',
    '  1 坪 ≈ 3.30579 m²、1 acre ≈ 4046.86 m²、1 ha = 10000 m²',
    '  1 gal（米）= 3.785411784 L、1 cup = 236.5882365 mL',
    '  1 mph = 1.609344 km/h、1 kn = 1.852 km/h、1 m/s = 3.6 km/h',
    '  0 °C = 32 °F = 273.15 K、100 °C = 212 °F',
    '',
    '単位: 長さ m km cm mm mi yd ft in nmi／重さ kg g mg t lb oz／面積 m2 km2 cm2 ha a ft2 acre 坪／体積 L mL m3 gal qt pt cup floz／速度 m/s km/h mph kn／温度 C F K',
  ].join('\n'),
  en: [
    'Common conversions (write <value> <unit> <unit>, e.g. 10 km mi):',
    '  1 in = 2.54 cm, 1 ft = 30.48 cm, 1 yd = 0.9144 m, 1 mi = 1.609344 km',
    '  1 lb = 453.59237 g, 1 oz = 28.349523125 g',
    '  1 tsubo ≈ 3.30579 m², 1 acre ≈ 4046.86 m², 1 ha = 10000 m²',
    '  1 US gal = 3.785411784 L, 1 cup = 236.5882365 mL',
    '  1 mph = 1.609344 km/h, 1 kn = 1.852 km/h, 1 m/s = 3.6 km/h',
    '  0 °C = 32 °F = 273.15 K, 100 °C = 212 °F',
    '',
    'Units: length m km cm mm mi yd ft in nmi; mass kg g mg t lb oz; area m2 km2 cm2 ha a ft2 acre tsubo; volume L mL m3 gal qt pt cup floz; speed m/s km/h mph kn; temperature C F K',
  ].join('\n'),
}

/**
 * The argument read as `<value> <from> <to>`: split at spaces (a full-width
 * one too), a value written against its unit (`10km`) split in two. Three
 * tokens are value, from and to (`in` is the inch there); four have `to` or
 * `in` third, skipped. Anything else is undefined.
 */
export function readConversion(s: string): { value: number; from: string; to: string } | undefined {
  const tokens = s.split(/[\s　]+/).filter(t => t !== '')
  const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/
  const glued = tokens.length > 0 ? /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([^\d.+-].*)$/.exec(tokens[0]!) : null
  if (glued !== null) tokens.splice(0, 1, glued[1]!, glued[2]!)
  let parts: string[]
  if (tokens.length === 3) parts = tokens
  else if (tokens.length === 4 && /^(to|in)$/i.test(tokens[2]!)) parts = [tokens[0]!, tokens[1]!, tokens[3]!]
  else return undefined
  if (!NUMBER.test(parts[0]!)) return undefined
  return { value: Number(parts[0]), from: parts[1]!, to: parts[2]! }
}

/** A value converted between two units of one quantity, with the other units of that quantity; with no argument, a table of common conversions. */
export const unitConvert = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  if (s === undefined) return invalid(lang, UNIT_FORMAT)
  if (s === '') return { text: UNIT_TABLE[lang] }
  const read = readConversion(s)
  if (read === undefined) return invalid(lang, UNIT_FORMAT)
  const from = unitOf(read.from)
  const to = unitOf(read.to)
  const unknown = [from === undefined ? read.from : undefined, to === undefined ? read.to : undefined].filter(u => u !== undefined)
  if (unknown.length > 0) {
    return { error: lang === 'ja' ? `知らない単位です: ${unknown.join('、')}（${UNIT_FORMAT.ja}）` : `Unknown unit: ${unknown.join(', ')} (${UNIT_FORMAT.en})` }
  }
  if (from!.quantity !== to!.quantity) {
    const a = QUANTITY_NAMES[from!.quantity][lang]
    const b = QUANTITY_NAMES[to!.quantity][lang]
    return {
      error:
        lang === 'ja'
          ? `種類の違う単位どうしは換算できません: ${from!.id}（${a}）と ${to!.id}（${b}）`
          : `Cannot convert between units of different kinds: ${from!.id} (${a}) and ${to!.id} (${b})`,
    }
  }
  const result = convertUnit(read.value, from!, to!)
  const others = UNITS.filter(u => u.quantity === from!.quantity && u.id !== from!.id && u.id !== to!.id).map(
    u => `  ${fmt(convertUnit(read.value, from!, u))} ${u.id}`,
  )
  return {
    text: [
      `${fmt(read.value)} ${from!.id} = ${fmt(result)} ${to!.id}`,
      '',
      lang === 'ja' ? `ほかの単位（${QUANTITY_NAMES[from!.quantity].ja}）:` : `In other units (${QUANTITY_NAMES[from!.quantity].en}):`,
      ...others,
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// base-convert.

const BASE_TEXT: Texts = {
  ja: '整数（例: 255、0xff、0b1010、0o17。_ で区切ってもよい）',
  en: 'a whole number, e.g. 255, 0xff, 0b1010, 0o17 (underscores between digits are allowed)',
}

/** A whole number written in base 10 or with 0x, 0b or 0o, underscores between digits allowed; undefined when it is none. */
export function readInteger(s: string): bigint | undefined {
  const m = /^([+-]?)(0x[0-9a-f]+(?:_[0-9a-f]+)*|0b[01]+(?:_[01]+)*|0o[0-7]+(?:_[0-7]+)*|\d+(?:_\d+)*)$/i.exec(s)
  if (m === null) return undefined
  const body = m[2]!.replace(/_/g, '').toLowerCase()
  const n = BigInt(body)
  return m[1] === '-' ? -n : n
}

/** A whole number (any size) in bases 2, 8, 10 and 16; 255 by default. */
export const baseConvert = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const n = s === undefined || s === '' ? undefined : readInteger(s)
  if (n === undefined) return invalid(lang, BASE_TEXT)
  const negative = n < BigInt(0)
  const abs = negative ? -n : n
  const sign = negative ? '-' : ''
  const dec = n.toString(10)
  return {
    text: [
      `${lang === 'ja' ? '2 進' : 'Binary'}: ${sign}0b${abs.toString(2)}`,
      `${lang === 'ja' ? '8 進' : 'Octal'}: ${sign}0o${abs.toString(8)}`,
      `${lang === 'ja' ? '10 進' : 'Decimal'}: ${dec}${dec.replace('-', '').length > 3 ? ` (${groupDigits(dec)})` : ''}`,
      `${lang === 'ja' ? '16 進' : 'Hexadecimal'}: ${sign}0x${abs.toString(16).toUpperCase()}`,
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// byte-size.

const BYTE_UNITS: readonly (readonly [string, number])[] = [
  ['KB', 1e3], ['MB', 1e6], ['GB', 1e9], ['TB', 1e12], ['PB', 1e15],
  ['KiB', 2 ** 10], ['MiB', 2 ** 20], ['GiB', 2 ** 30], ['TiB', 2 ** 40], ['PiB', 2 ** 50],
]

/** Each unit written (lowercase) and its bytes: `k` and `kb` are 1000, `ki` and `kib` 1024, and so on. */
export const BYTE_FACTORS: ReadonlyMap<string, number> = new Map<string, number>([
  ['', 1],
  ['b', 1],
  ...['k', 'm', 'g', 't', 'p'].flatMap((p, i) => [
    [p, 1000 ** (i + 1)] as [string, number],
    [`${p}b`, 1000 ** (i + 1)] as [string, number],
    [`${p}i`, 1024 ** (i + 1)] as [string, number],
    [`${p}ib`, 1024 ** (i + 1)] as [string, number],
  ]),
])

/** The largest size taken, in bytes: 1 EB. */
export const BYTE_MAX = 1e18

const BYTE_TEXT: Texts = {
  ja: 'データ量（例: 1GiB、500MB、123456789。単位は B・KB〜PB・KiB〜PiB、最大 1 EB）',
  en: 'a data size, e.g. 1GiB, 500MB, 123456789 (units B, KB to PB, KiB to PiB; at most 1 EB)',
}

/** A data size in bytes and in the decimal (KB...) and binary (KiB...) units, each to 10 significant digits; 1GiB by default. */
export const byteSize = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const m = s === undefined ? null : /^(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)$/i.exec(s)
  const factor = m === null ? undefined : BYTE_FACTORS.get(m[2]!.toLowerCase())
  if (m === null || factor === undefined) return invalid(lang, BYTE_TEXT)
  const bytes = Number(m[1]) * factor
  if (!Number.isFinite(bytes) || bytes > BYTE_MAX) return invalid(lang, BYTE_TEXT)
  // Up to BYTE_MAX, a whole number of bytes is written out in full digits (String gives no exponent below 1e21).
  const whole = Number.isInteger(bytes)
  const b = whole ? groupDigits(String(bytes)) : fmt(bytes)
  return {
    text: [
      `B: ${b}`,
      '',
      lang === 'ja' ? '10 進（1 KB = 1000 B）:' : 'Decimal (1 KB = 1000 B):',
      ...BYTE_UNITS.slice(0, 5).map(([u, f]) => `  ${fmt(bytes / f)} ${u}`),
      '',
      lang === 'ja' ? '2 進（1 KiB = 1024 B）:' : 'Binary (1 KiB = 1024 B):',
      ...BYTE_UNITS.slice(5).map(([u, f]) => `  ${fmt(bytes / f)} ${u}`),
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// tax-calc.

export const TAX_RATES = [10, 8] as const

/** An amount in sen (1/100 yen) as yen: digits grouped, the sen shown only when there are any. */
export const yen = (sen: number): string => {
  const whole = Math.floor(sen / 100)
  const rest = sen - whole * 100
  return groupDigits(String(whole)) + (rest === 0 ? '' : `.${String(rest).padStart(2, '0').replace(/0$/, '')}`)
}

/**
 * The tax on an amount, both ways, in whole sen so no binary fraction creeps in.
 * Taken as before tax: the tax is the amount × rate, rounded down to the yen,
 * and the total the amount plus it. Taken as with tax: the amount before tax is
 * the amount ÷ (1 + rate), rounded down to the yen, and the tax what is left.
 */
export function taxOf(sen: number, rate: number): { addTax: number; withTax: number; beforeTax: number; taxIncluded: number } {
  const addTax = Math.floor((sen * rate) / 10_000) * 100
  const beforeTax = Math.floor(sen / (100 + rate)) * 100
  return { addTax, withTax: sen + addTax, beforeTax, taxIncluded: sen - beforeTax }
}

/** The consumption tax at 10% and 8% on an amount (1000 yen by default), as before tax and as with tax, fractions of a yen rounded down. */
export const taxCalc = ({ arg, lang }: LocalInput): LocalOutput => {
  if (typeof arg !== 'number' || !Number.isFinite(arg) || arg < 0 || arg > 1e12) {
    return invalid(lang, { ja: '0〜1000000000000 の金額', en: 'an amount from 0 to 1000000000000' })
  }
  const sen = Math.round(arg * 100)
  const ja = lang === 'ja'
  const lines = [ja ? `金額: ${yen(sen)} 円` : `Amount: ${yen(sen)} yen`]
  for (const rate of TAX_RATES) {
    const t = taxOf(sen, rate)
    lines.push(
      '',
      `${rate}%:`,
      ja
        ? `  税抜として: 税込 ${yen(t.withTax)} 円（税 ${yen(t.addTax)} 円）`
        : `  As before tax: ${yen(t.withTax)} yen with tax (tax ${yen(t.addTax)} yen)`,
      ja
        ? `  税込として: 税抜 ${yen(t.beforeTax)} 円（税 ${yen(t.taxIncluded)} 円）`
        : `  As with tax: ${yen(t.beforeTax)} yen before tax (tax ${yen(t.taxIncluded)} yen)`,
    )
  }
  lines.push('', ja ? '端数は 1 円未満を切り捨てています。' : 'Fractions of a yen are rounded down.')
  return { text: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// split-bill.

const SPLIT_TEXT: Texts = {
  ja: '<金額>/<人数>（例: 10000/3。金額は 1〜1000000000000、人数は 2〜1000）',
  en: '<amount>/<people>, e.g. 10000/3 (an amount from 1 to 1000000000000, 2 to 1000 people)',
}

/** A bill split among people (10000/3 by default): each one's share and the rest, and how to collect it rounded up to 1 or 100 yen. */
export const splitBill = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const m = s === undefined ? null : /^(\d{1,13})\s*[/／]\s*(\d{1,4})$/.exec(s)
  if (m === null) return invalid(lang, SPLIT_TEXT)
  const amount = Number(m[1])
  const people = Number(m[2])
  if (amount < 1 || amount > 1e12 || people < 2 || people > 1000) return invalid(lang, SPLIT_TEXT)
  const share = Math.floor(amount / people)
  const rest = amount - share * people
  const g = (n: number) => groupDigits(String(n))
  const ja = lang === 'ja'
  const lines = [
    ja ? `${g(amount)} 円を ${people} 人で割り勘` : `${g(amount)} yen split ${people} ways`,
    '',
    ja ? `1 人あたり: ${g(share)} 円（余り ${g(rest)} 円）` : `Each: ${g(share)} yen (${g(rest)} yen left over)`,
  ]
  if (rest > 0) {
    lines.push(
      ja
        ? `  ちょうど集めるなら: ${g(share + 1)} 円 × ${rest} 人 + ${g(share)} 円 × ${people - rest} 人`
        : `  To collect it exactly: ${g(share + 1)} yen × ${rest} + ${g(share)} yen × ${people - rest}`,
    )
  }
  for (const unit of [1, 100]) {
    const each = Math.ceil(amount / (people * unit)) * unit
    const total = each * people
    lines.push(
      ja
        ? `${unit} 円単位で切り上げ: 1 人 ${g(each)} 円、合計 ${g(total)} 円（余剰 ${g(total - amount)} 円）`
        : `Rounded up to ${unit} yen: ${g(each)} yen each, ${g(total)} yen in all (${g(total - amount)} yen over)`,
    )
  }
  return { text: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// factorize.

/** The prime factors of n (2 and up) with their exponents, smallest first, by trial division. */
export function primeFactors(n: number): [number, number][] {
  const out: [number, number][] = []
  let rest = n
  for (let p = 2; p * p <= rest; p += p === 2 ? 1 : 2) {
    let e = 0
    while (rest % p === 0) {
      rest /= p
      e++
    }
    if (e > 0) out.push([p, e])
  }
  if (rest > 1) out.push([rest, 1])
  return out
}

/** The divisors of a number from its prime factors, in ascending order. */
export function divisorsOf(factors: readonly (readonly [number, number])[]): number[] {
  let ds = [1]
  for (const [p, e] of factors) {
    const next: number[] = []
    for (const d of ds) {
      let m = d
      for (let i = 0; i <= e; i++) {
        next.push(m)
        m *= p
      }
    }
    ds = next
  }
  return ds.sort((a, b) => a - b)
}

export const DIVISORS_SHOWN = 100

/** A whole number (360 by default) in prime factors, the count and list of its divisors (up to 100), and whether it is prime. */
export const factorize = ({ arg, lang }: LocalInput): LocalOutput => {
  if (!isInt(arg, 2, 1e12)) return invalid(lang, { ja: '2〜1000000000000 の整数', en: 'a whole number from 2 to 1000000000000' })
  const factors = primeFactors(arg)
  const count = factors.reduce((a, [, e]) => a * (e + 1), 1)
  const divisors = divisorsOf(factors)
  const shown = divisors.slice(0, DIVISORS_SHOWN).join(', ')
  const more = divisors.length - DIVISORS_SHOWN
  const ja = lang === 'ja'
  return {
    text: [
      `${arg} = ${factors.map(([p, e]) => (e === 1 ? String(p) : `${p}^${e}`)).join(' × ')}`,
      ja ? `素数: ${count === 2 ? 'はい' : 'いいえ'}` : `Prime: ${count === 2 ? 'yes' : 'no'}`,
      ja ? `約数の個数: ${count}` : `Number of divisors: ${count}`,
      ja ? `約数: ${shown}${more > 0 ? ` ほか ${more} 個` : ''}` : `Divisors: ${shown}${more > 0 ? ` and ${more} more` : ''}`,
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// roman-numeral.

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

export function toRoman(n: number): string {
  let rest = n
  let out = ''
  for (const [v, s] of ROMAN) {
    while (rest >= v) {
      out += s
      rest -= v
    }
  }
  return out
}

/** A Roman numeral in its standard form (case folded) as a number, or undefined. */
export function fromRoman(s: string): number | undefined {
  const r = s.toUpperCase()
  if (r === '' || !/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(r)) return undefined
  let i = 0
  let n = 0
  for (const [v, sym] of ROMAN) {
    while (r.startsWith(sym, i)) {
      n += v
      i += sym.length
    }
  }
  return n
}

const ROMAN_TEXT: Texts = {
  ja: '1〜3999 の整数かローマ数字（例: 2024、MMXXIV）',
  en: 'a whole number from 1 to 3999 or a Roman numeral, e.g. 2024, MMXXIV',
}

/** A whole number from 1 to 3999 as a Roman numeral, or a Roman numeral as a number (told apart by its form); 2024 by default. */
export const romanNumeral = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  if (s === undefined || s === '') return invalid(lang, ROMAN_TEXT)
  if (/^\d{1,6}$/.test(s)) {
    const n = Number(s)
    if (n < 1 || n > 3999) return invalid(lang, ROMAN_TEXT)
    return { text: `${n} = ${toRoman(n)}` }
  }
  const n = fromRoman(s)
  return n === undefined ? invalid(lang, ROMAN_TEXT) : { text: `${s.toUpperCase()} = ${n}` }
}

// ---------------------------------------------------------------------------
// number-reading.

const MAN_UNITS = ['', '万', '億', '兆', '京', '垓'] as const
const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion', 'sextillion'] as const
const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
] as const
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const

/** Digits (no sign, no leading zeros) cut into groups of `size` from the right, the most significant first. */
const groupsOf = (digits: string, size: number): string[] => {
  const out: string[] = []
  for (let end = digits.length; end > 0; end -= size) out.unshift(digits.slice(Math.max(0, end - size), end))
  return out
}

/** `1億2345万6789`: groups of four digits with their units, the empty ones left out. */
export function manNotation(digits: string): string {
  if (/^0+$/.test(digits)) return '0'
  const groups = groupsOf(digits, 4)
  return groups
    .map((g, i) => {
      const v = Number(g)
      return v === 0 ? '' : `${v}${MAN_UNITS[groups.length - 1 - i]}`
    })
    .join('')
}

/** `一億二千三百四十五万六千七百八十九`: the same in kanji numerals (一 left out before 十, 百 and 千). */
export function kanjiNotation(digits: string): string {
  if (/^0+$/.test(digits)) return '零'
  const groups = groupsOf(digits, 4)
  const four = (g: string) => {
    const d = g.padStart(4, '0')
    return ['千', '百', '十', '']
      .map((unit, i) => {
        const n = Number(d[i])
        if (n === 0) return ''
        return (n === 1 && unit !== '' ? '' : KANJI_DIGITS[n]) + unit
      })
      .join('')
  }
  return groups.map((g, i) => (Number(g) === 0 ? '' : four(g) + MAN_UNITS[groups.length - 1 - i])).join('')
}

/** `one million two hundred thirty-four thousand five hundred sixty-seven`. */
export function englishWords(digits: string): string {
  if (/^0+$/.test(digits)) return 'zero'
  const below1000 = (n: number) => {
    const words: string[] = []
    if (n >= 100) words.push(`${EN_ONES[Math.floor(n / 100)]} hundred`)
    const r = n % 100
    if (r > 0 && r < 20) words.push(EN_ONES[r]!)
    else if (r >= 20) words.push(EN_TENS[Math.floor(r / 10)]! + (r % 10 === 0 ? '' : `-${EN_ONES[r % 10]}`))
    return words.join(' ')
  }
  const groups = groupsOf(digits, 3)
  return groups
    .map((g, i) => {
      const v = Number(g)
      const scale = EN_SCALES[groups.length - 1 - i]
      return v === 0 ? '' : scale === '' ? below1000(v) : `${below1000(v)} ${scale}`
    })
    .filter(s => s !== '')
    .join(' ')
}

const READING_TEXT: Texts = {
  ja: '整数（例: 1234567、1,234,567。絶対値は 10^24 未満）',
  en: 'a whole number, e.g. 1234567 or 1,234,567 (below 10^24 in absolute value)',
}

/** A whole number (1234567 by default) with its digits grouped, in Japanese 万 notation and kanji, and read in English. */
export const numberReading = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const m = s === undefined ? null : /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)$/.exec(s)
  if (m === null) return invalid(lang, READING_TEXT)
  const digits = m[2]!.replace(/,/g, '').replace(/^0+(?=\d)/, '')
  if (digits.length > 24) return invalid(lang, READING_TEXT)
  const negative = m[1] === '-' && !/^0+$/.test(digits)
  const sign = negative ? '-' : ''
  return {
    text: [
      `${lang === 'ja' ? '桁区切り' : 'Grouped'}: ${sign}${groupDigits(digits)}`,
      `${lang === 'ja' ? '万進' : 'Japanese (man)'}: ${sign}${manNotation(digits)}`,
      `${lang === 'ja' ? '漢数字' : 'Kanji'}: ${negative ? 'マイナス' : ''}${kanjiNotation(digits)}`,
      `${lang === 'ja' ? '英語' : 'English'}: ${negative ? 'minus ' : ''}${englishWords(digits)}`,
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// semver-bump.

const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export type Bumps = { patch: string; minor: string; major: string; prerelease: string }

/** The next versions after a semantic version, by npm semver's `inc` (build metadata dropped); undefined when it is none. */
export function bumpVersion(s: string): Bumps | undefined {
  const m = SEMVER.exec(s)
  if (m === null) return undefined
  const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (![x, y, z].every(Number.isSafeInteger)) return undefined
  const pre = m[4]
  if (pre === undefined) {
    return { patch: `${x}.${y}.${z + 1}`, minor: `${x}.${y + 1}.0`, major: `${x + 1}.0.0`, prerelease: `${x}.${y}.${z + 1}-0` }
  }
  const ids = pre.split('.')
  let bumped = false
  for (let i = ids.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(ids[i]!)) {
      ids[i] = String(Number(ids[i]) + 1)
      bumped = true
      break
    }
  }
  if (!bumped) ids.push('0')
  return {
    patch: `${x}.${y}.${z}`,
    minor: z === 0 ? `${x}.${y}.0` : `${x}.${y + 1}.0`,
    major: y === 0 && z === 0 ? `${x}.0.0` : `${x + 1}.0.0`,
    prerelease: `${x}.${y}.${z}-${ids.join('.')}`,
  }
}

/** The next patch, minor, major and prerelease versions after a semantic version; 1.4.2 by default. */
export const semverBump = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const b = s === undefined ? undefined : bumpVersion(s)
  if (b === undefined) {
    return invalid(lang, { ja: 'セマンティックバージョン（例: 1.4.2、2.0.0-rc.1）', en: 'a semantic version, e.g. 1.4.2, 2.0.0-rc.1' })
  }
  return { text: [`patch: ${b.patch}`, `minor: ${b.minor}`, `major: ${b.major}`, `prerelease: ${b.prerelease}`].join('\n') }
}

// ---------------------------------------------------------------------------
// ip-calc.

const OCTET = '(0|[1-9]\\d{0,2})'
const CIDR = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}/(0|[1-9]\\d?)$`)

const dotted = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')

/** An IPv4 CIDR block's figures, or undefined when it is none. */
export function subnetOf(s: string): { address: number; prefix: number; mask: number; network: number; broadcast: number; hosts: number } | undefined {
  const m = CIDR.exec(s)
  if (m === null) return undefined
  const octets = [m[1], m[2], m[3], m[4]].map(Number)
  const prefix = Number(m[5])
  if (octets.some(o => o > 255) || prefix > 32) return undefined
  const address = octets.reduce((a, o) => a * 256 + o, 0)
  // A shift's count is taken modulo 32, so << 32 would shift by none: /0 is its own case.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (address & mask) >>> 0
  const broadcast = (network | ~mask) >>> 0
  const hosts = prefix === 32 ? 1 : prefix === 31 ? 2 : 2 ** (32 - prefix) - 2
  return { address, prefix, mask, network, broadcast, hosts }
}

/** An IPv4 CIDR block (192.168.0.0/24 by default): its network, broadcast, host range and count, mask and wildcard. */
export const ipCalc = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const n = s === undefined ? undefined : subnetOf(s)
  if (n === undefined) {
    return invalid(lang, { ja: 'IPv4 の CIDR（例: 192.168.0.0/24。各オクテットは 0〜255、プレフィックスは 0〜32）', en: 'an IPv4 CIDR block, e.g. 192.168.0.0/24 (octets 0 to 255, a prefix from 0 to 32)' })
  }
  const ja = lang === 'ja'
  const [first, last] = n.prefix >= 31 ? [n.network, n.broadcast] : [n.network + 1, n.broadcast - 1]
  const lines = [
    `${ja ? 'ネットワークアドレス' : 'Network'}: ${dotted(n.network)}/${n.prefix}`,
    `${ja ? 'ブロードキャスト' : 'Broadcast'}: ${n.prefix >= 31 ? (ja ? 'なし' : 'none') : dotted(n.broadcast)}`,
    `${ja ? 'ホスト範囲' : 'Host range'}: ${first === last ? dotted(first) : `${dotted(first)} - ${dotted(last)}`}`,
    `${ja ? 'ホスト数' : 'Hosts'}: ${groupDigits(String(n.hosts))}`,
    `${ja ? 'サブネットマスク' : 'Subnet mask'}: ${dotted(n.mask)}`,
    `${ja ? 'ワイルドカード' : 'Wildcard'}: ${dotted(~n.mask >>> 0)}`,
  ]
  if (n.prefix === 31) lines.push(ja ? '/31 は 2 つのアドレスをどちらもホストに使う 2 点間リンク用（RFC 3021）。' : 'A /31 uses both of its addresses for hosts, for point-to-point links (RFC 3021).')
  if (n.prefix === 32) lines.push(ja ? '/32 は 1 つのホストだけを表します。' : 'A /32 stands for a single host.')
  if (n.address !== n.network) {
    lines.push(
      ja
        ? `入力の ${dotted(n.address)} はネットワークの境界にありません（ネットワークアドレスは ${dotted(n.network)}）。`
        : `${dotted(n.address)} is not on the network boundary (the network address is ${dotted(n.network)}).`,
    )
  }
  return { text: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// aspect-ratio.

export const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** Common screen and image sizes: width, height and a name. */
export const RESOLUTIONS: readonly (readonly [number, number, string])[] = [
  [640, 360, 'nHD'], [1280, 720, 'HD'], [1600, 900, 'HD+'], [1920, 1080, 'Full HD'], [2560, 1440, 'QHD'],
  [3840, 2160, '4K UHD'], [7680, 4320, '8K UHD'],
  [1280, 800, 'WXGA'], [1440, 900, 'WXGA+'], [1680, 1050, 'WSXGA+'], [1920, 1200, 'WUXGA'], [2560, 1600, 'WQXGA'],
  [640, 480, 'VGA'], [800, 600, 'SVGA'], [1024, 768, 'XGA'], [1600, 1200, 'UXGA'],
  [1280, 1024, 'SXGA'],
  [2560, 1080, 'UW-FHD'], [3440, 1440, 'UW-QHD'], [5120, 2160, 'UW5K'],
  [2160, 1440, '3:2'], [3000, 2000, '3:2'],
  [1080, 1080, 'Square'], [1080, 1920, 'Vertical Full HD'], [1080, 1350, 'Portrait 4:5'],
]

const RATIO_TEXT: Texts = {
  ja: '<幅>x<高さ>（例: 1920x1080。各 1〜100000）',
  en: '<width>x<height>, e.g. 1920x1080 (each from 1 to 100000)',
}

/** A width and height's ratio in lowest terms and as a decimal, with the common sizes of that ratio; 1920x1080 by default. */
export const aspectRatio = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const m = s === undefined ? null : /^(\d{1,6})\s*[x×X*:]\s*(\d{1,6})$/.exec(s)
  if (m === null) return invalid(lang, RATIO_TEXT)
  const [w, h] = [Number(m[1]), Number(m[2])]
  if (w < 1 || h < 1 || w > 100_000 || h > 100_000) return invalid(lang, RATIO_TEXT)
  const d = gcd(w, h)
  const [rw, rh] = [w / d, h / d]
  const same = RESOLUTIONS.filter(([a, b]) => a * rh === b * rw).map(([a, b, name]) => `  ${a}x${b} (${name})`)
  const ja = lang === 'ja'
  return {
    text: [
      `${w}x${h} = ${rw}:${rh} (${(w / h).toFixed(2)}:1)`,
      '',
      ja ? '同じ比率のよく使うサイズ:' : 'Common sizes of the same ratio:',
      ...(same.length > 0 ? same : [ja ? '  該当なし' : '  none']),
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// px-rem.

export const ROOT_PX = 16
export const PX_MAX = 1_000_000

const PX_TEXT: Texts = {
  ja: '16px・1.5rem・12pt のような値と単位（px・rem・em・pt。0〜1000000）',
  en: 'a value and a unit such as 16px, 1.5rem, 12pt (px, rem, em or pt; 0 to 1000000)',
}

/** A size in px, rem, em or pt in each of the four, on a 16px root; 16px by default. */
export const pxRem = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const m = s === undefined ? null : /^(\d+(?:\.\d+)?|\.\d+)\s*(px|rem|em|pt)$/i.exec(s)
  if (m === null) return invalid(lang, PX_TEXT)
  const value = Number(m[1])
  if (!(value >= 0 && value <= PX_MAX)) return invalid(lang, PX_TEXT)
  const unit = m[2]!.toLowerCase()
  const px = unit === 'px' ? value : unit === 'pt' ? (value * 4) / 3 : value * ROOT_PX
  const f = (n: number) => String(Number(n.toFixed(4)))
  return {
    text: [
      `${f(px)}px`,
      `${f(px / ROOT_PX)}rem`,
      `${f(px / ROOT_PX)}em`,
      `${f((px * 3) / 4)}pt`,
      '',
      lang === 'ja'
        ? `基準: 1rem = ${ROOT_PX}px、1pt = 4/3px。em は親要素の文字サイズが ${ROOT_PX}px のときの値です。`
        : `On a ${ROOT_PX}px root: 1rem = ${ROOT_PX}px, 1pt = 4/3px. The em figure holds when the parent's font size is ${ROOT_PX}px.`,
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// chmod-calc.

const CHMOD_TEXT: Texts = {
  ja: '8 進（例: 755、4755）か記号（例: rwxr-xr-x、drwxr-xr-x）のパーミッション',
  en: 'permissions in octal (e.g. 755, 4755) or symbols (e.g. rwxr-xr-x, drwxr-xr-x)',
}

/** Permission bits (with setuid 0o4000, setgid 0o2000, sticky 0o1000) as nine symbols. */
export function toSymbolic(mode: number): string {
  const triple = (bits: number, special: boolean, on: string, off: string) =>
    (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-') + (special ? (bits & 1 ? on : off) : bits & 1 ? 'x' : '-')
  return (
    triple((mode >> 6) & 7, (mode & 0o4000) !== 0, 's', 'S') +
    triple((mode >> 3) & 7, (mode & 0o2000) !== 0, 's', 'S') +
    triple(mode & 7, (mode & 0o1000) !== 0, 't', 'T')
  )
}

/** Nine permission symbols (a file-type character in front allowed) as the mode bits, or undefined. */
export function fromSymbolic(s: string): number | undefined {
  const m = /^[-dlcbps]?([r-][w-][xsS-])([r-][w-][xsS-])([r-][w-][xtT-])$/.exec(s)
  if (m === null) return undefined
  let mode = 0
  const read = (t: string, shift: number, special: number) => {
    if (t[0] === 'r') mode |= 4 << shift
    if (t[1] === 'w') mode |= 2 << shift
    if (t[2] === 'x' || t[2] === 's' || t[2] === 't') mode |= 1 << shift
    if (t[2] === 's' || t[2] === 'S' || t[2] === 't' || t[2] === 'T') mode |= special
  }
  read(m[1]!, 6, 0o4000)
  read(m[2]!, 3, 0o2000)
  read(m[3]!, 0, 0o1000)
  return mode
}

/** File permissions in octal as symbols or the other way round (told apart by the form), each class's rights spelt out; 755 by default. */
export const chmodCalc = ({ arg, lang }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  if (s === undefined || s === '') return invalid(lang, CHMOD_TEXT)
  const mode = /^[0-7]{3,4}$/.test(s) ? parseInt(s, 8) : fromSymbolic(s)
  if (mode === undefined) return invalid(lang, CHMOD_TEXT)
  const ja = lang === 'ja'
  const octal = (mode > 0o777 ? mode.toString(8).padStart(4, '0') : mode.toString(8).padStart(3, '0'))
  const rights = (bits: number) => {
    const r = [bits & 4 ? (ja ? '読み' : 'read') : '', bits & 2 ? (ja ? '書き' : 'write') : '', bits & 1 ? (ja ? '実行' : 'execute') : ''].filter(x => x !== '')
    return r.length === 0 ? (ja ? 'なし' : 'none') : r.join(ja ? '・' : ', ')
  }
  const lines = [
    `${octal} = ${toSymbolic(mode)}`,
    '',
    `${ja ? '所有者' : 'Owner'} (${(mode >> 6) & 7}): ${rights((mode >> 6) & 7)}`,
    `${ja ? 'グループ' : 'Group'} (${(mode >> 3) & 7}): ${rights((mode >> 3) & 7)}`,
    `${ja ? 'その他' : 'Others'} (${mode & 7}): ${rights(mode & 7)}`,
  ]
  if (mode & 0o4000) lines.push(ja ? 'setuid: 実行時に所有者の権限で動く' : 'setuid: runs with the owner\'s rights')
  if (mode & 0o2000) lines.push(ja ? 'setgid: 実行時にグループの権限で動く（ディレクトリでは中のファイルがグループを引き継ぐ）' : 'setgid: runs with the group\'s rights (in a directory, new files take its group)')
  if (mode & 0o1000) lines.push(ja ? 'スティッキービット: ディレクトリ内のファイルは所有者だけが削除・改名できる' : 'sticky bit: in a directory, only a file\'s owner may delete or rename it')
  lines.push('', `chmod ${octal} <file>`)
  return { text: lines.join('\n') }
}
