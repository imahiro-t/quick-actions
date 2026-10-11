// The local actions on the selection: each a `compute` that takes the selected
// text (trimmed) and answers at once with a text to show, or an error saying
// what in the text could not be read and where. No model, no network: the
// selected text goes nowhere.
//
// Synchronous and pure, as LocalAction asks, and stricter still: ECMAScript's
// built-ins alone. UTF-8, Base64, SHA and the JSON layout are this module's own
// (./codec, ./sha, ./json-text), and no web API is used (TextEncoder,
// TextDecoder, atob, btoa, URL), nor Intl, localeCompare or toLocale*String,
// whose answers vary by machine; the local time comes from
// `utcOffsetMinutes`. None of them throws: whatever the text, an answer.

import type { LocalInput, LocalOutput } from './actions'
import { base64Decode, base64Encode, toHex, utf8Decode, utf8Encode } from './codec'
import type { Base64Error } from './codec'
import type { Lang } from './i18n'
import { layoutJson } from './json-text'
import type { JsonError } from './json-text'
import { sha1, sha256 } from './sha'

type Texts = Record<Lang, string>

const pick = (lang: Lang, t: Texts) => t[lang]

const NO_TEXT: Texts = { ja: 'テキストが選択されていません。', en: 'No text is selected.' }

/** The compute of a local action on the selection, from what it does with a non-empty text. */
const onText =
  (run: (text: string, input: LocalInput) => LocalOutput) =>
  (input: LocalInput): LocalOutput => {
    const text = input.text
    if (text === undefined || text === '') return { error: pick(input.lang, NO_TEXT) }
    return run(text, input)
  }

/** The text's lines: split at \r\n, \r and \n alike. */
const linesOf = (text: string) => text.split(/\r\n|\r|\n/)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Control characters: C0 but tab and line breaks, DEL and C1 (U+009B is the
// 8-bit CSI). Decoding makes them out of text that showed none (%1B, \u009b in
// a JWT), and the pane would hand them to the terminal raw: a screen cleared,
// a link disguised, the clipboard written. So whatever a decoder brings out is
// either refused (base64-decode shows the bytes in hexadecimal) or shown with
// each of them escaped, as `\u001b`.
//
// Bidirectional controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to
// U+2069) and zero-width or invisible format characters (U+200B, U+200C,
// U+200D, U+2060 to U+2064, the deprecated U+206A to U+206F, U+FEFF, the
// interlinear annotation marks U+FFF9 to U+FFFB, U+180E) work no terminal, but
// they disguise what is shown: a host or a token read backwards, a word split
// where none shows. A decoder's output is there to show what the text holds,
// so they are escaped the same way (together with the controls, "hidden"
// characters below). The one exception is a ZWJ (U+200D) inside an emoji
// sequence (an emoji, at most one U+FE0F or skin tone modifier, the ZWJ, an
// emoji: man ZWJ woman, white flag U+FE0F ZWJ rainbow): there it only joins
// the emoji into one, which can disguise nothing, and escaping it would break
// the emoji.
//
// Tag characters (U+E0000 to U+E007F) show as nothing at all, yet each stands
// for an ASCII character: a whole sentence can ride hidden after a word
// ("ASCII smuggling"), read by a model though no one sees it. They are hidden
// characters too, escaped as their UTF-16 surrogate pair (`\udb40\udc41` for
// U+E0041), which is the same value in a JSON string. The one exception is a
// flag emoji's tag sequence (`inFlag`): a black flag U+1F3F4, three to seven
// tags of a lowercase letter or digit (a CLDR subdivision ID, such as gbeng
// for England), and CANCEL TAG U+E007F. There the tags only pick the flag
// shown, and escaping them would break it; anything longer, of other tags, or
// not so closed is escaped whole (the flag's own U+1F3F4 is no hidden
// character and stays).
//
// Two ways to show them, by what the output is:
// - JSON (format-json, minify-json, decode-jwt, a JSON error's token):
//   `escapeHidden`, the hidden characters alone escaped, as `\u202e`. Inside
//   a JSON string that is the same value, and a backslash of the text is
//   already written `\\` there, so the two never look alike.
// - Not JSON (url-decode, parse-url and its port error, base64-decode as
//   text): `showHidden`.
//   There a backslash of the text would look like an escape (the text's
//   `\u001b` and a real ESC alike), so once anything is escaped, each
//   backslash of the text is shown doubled, `\\`, in the same one pass.
//   Output with nothing hidden is left as it is, backslashes and all.
// A base64 error names one character only (a backslash, or six characters of
// an escape: never both), so `escapeHidden` is enough there.
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g

/** Whether the text holds a control character the pane must not show raw. */
export const hasControls = (s: string) => s.search(CONTROLS) >= 0

// The hidden characters: the controls above, the bidirectional controls, the
// zero-width and invisible format characters (U+200D among them: whether a ZWJ
// is kept is `joinsEmoji`'s to say) and the tag characters (whether a tag is
// kept is `inFlag`'s to say).
const HIDDEN = /[\u{0}-\u{8}\u{b}\u{c}\u{e}-\u{1f}\u{7f}-\u{9f}\u{61c}\u{180e}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{206f}\u{feff}\u{fff9}-\u{fffb}\u{e0000}-\u{e007f}]/gu

// The same, or a backslash: what `showHidden` writes anew, in one pass.
const SHOWN = new RegExp(`\\\\|${HIDDEN.source}`, 'gu')

const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u
const EMOJI_TAIL = /^[\u{fe0f}\p{Emoji_Modifier}]$/u

/** The code point that ends just before `end`, and where it starts. */
function codePointBefore(s: string, end: number): { char: string; start: number } | undefined {
  if (end <= 0) return undefined
  const low = s.charCodeAt(end - 1)
  const high = end >= 2 ? s.charCodeAt(end - 2) : 0
  const start = low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? end - 2 : end - 1
  return { char: s.slice(start, end), start }
}

/** Whether the ZWJ at `at` joins two emoji: an emoji, at most one U+FE0F or skin tone modifier, the ZWJ, an emoji. */
function joinsEmoji(s: string, at: number): boolean {
  const next = s.codePointAt(at + 1)
  if (next === undefined || !PICTOGRAPHIC.test(String.fromCodePoint(next))) return false
  let before = codePointBefore(s, at)
  if (before !== undefined && EMOJI_TAIL.test(before.char)) before = codePointBefore(s, before.start)
  return before !== undefined && PICTOGRAPHIC.test(before.char)
}

/**
 * A flag emoji's tag sequence: a black flag, three to seven tags of a
 * lowercase letter or digit (a CLDR subdivision ID: a region of two letters or
 * three digits and one to four more), CANCEL TAG. Kept that short so a flag
 * can carry no hidden sentence.
 */
const FLAG = /\u{1f3f4}(?:[\u{e0030}-\u{e0039}\u{e0061}-\u{e007a}]){3,7}\u{e007f}/gu

/** Where `s`'s flag emoji are, as [start, end) in UTF-16 units: none without a black flag. */
const flagsIn = (s: string): [number, number][] =>
  s.includes('\u{1f3f4}') ? Array.from(s.matchAll(FLAG), m => [m.index!, m.index! + m[0].length] as [number, number]) : []

/** Whether the tag character at `at` belongs to one of `flags`. */
const inFlag = (flags: readonly [number, number][], at: number) => flags.some(([start, end]) => at > start && at < end)

const isTag = (c: string) => (c.codePointAt(0) ?? 0) >= 0xe0000

/**
 * Whether the hidden character `c` at `at` in `s` is to be escaped: all but a
 * ZWJ joining emoji and a tag inside a flag emoji (`flags`, from flagsIn).
 */
const escapes = (s: string, c: string, at: number, flags: readonly [number, number][]) =>
  c === '\u{200d}' ? !joinsEmoji(s, at) : !isTag(c) || !inFlag(flags, at)

/**
 * One hidden character as `\u202e`; one past the BMP (a tag character) as its
 * UTF-16 surrogate pair, `\udb40\udc41`, which a JSON string reads as the
 * same character.
 */
const escapeOne = (c: string) => {
  let out = ''
  for (let i = 0; i < c.length; i++) out += `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`
  return out
}

/** Whether the text holds a hidden character the pane must not show raw. */
export function hasHidden(s: string): boolean {
  const flags = flagsIn(s)
  for (const m of s.matchAll(HIDDEN)) if (escapes(s, m[0], m.index!, flags)) return true
  return false
}

/** The text with each hidden character written as `\u202e`, backslashes left alone: the same in a JSON string. For JSON. */
export function escapeHidden(s: string): string {
  const flags = flagsIn(s)
  return s.replace(HIDDEN, (c: string, at: number) => (escapes(s, c, at, flags) ? escapeOne(c) : c))
}

/**
 * For what is not JSON: the text as it is when nothing in it is hidden;
 * otherwise each hidden character written as `\u202e` and each backslash of
 * the text as `\\` (in one pass, so the escapes' own backslashes stay
 * single), with `escaped` saying a note is due.
 */
export function showHidden(s: string): { shown: string; escaped: boolean } {
  if (!hasHidden(s)) return { shown: s, escaped: false }
  const flags = flagsIn(s)
  const shown = s.replace(SHOWN, (c: string, at: number) => (c === '\\' ? '\\\\' : escapes(s, c, at, flags) ? escapeOne(c) : c))
  return { shown, escaped: true }
}

const HIDDEN_NOTE: Texts = {
  ja: '（制御文字・双方向制御文字・ゼロ幅文字・タグ文字は \\u001b のような形で、元のテキストのバックスラッシュは \\\\ と表示しています）',
  en: '(Control, bidirectional, zero-width and tag characters are shown escaped, as \\u001b; a backslash in the text is shown as \\\\.)',
}

/** The decoded text with its hidden characters (and then its backslashes) escaped, and a note saying so when there were any. */
const withHiddenShown = (decoded: string, lang: Lang): string[] => {
  const { shown, escaped } = showHidden(decoded)
  return escaped ? [shown, pick(lang, HIDDEN_NOTE)] : [decoded]
}

// ---------------------------------------------------------------------------
// count-text

/** Characters (code points, with and without white space), words (runs between white space), lines and UTF-8 bytes. */
export const countText = onText((text, { lang }) => {
  const chars = [...text]
  const nonSpace = chars.filter(c => !/\s/u.test(c)).length
  const words = text.split(/\s+/u).filter(w => w !== '').length
  const lines = linesOf(text).length
  const bytes = utf8Encode(text).length
  if (lang === 'ja') {
    return {
      text: [
        `- 文字数（空白込み）: ${chars.length}`,
        `- 文字数（空白除く）: ${nonSpace}`,
        `- 語数: ${words}`,
        `- 行数: ${lines}`,
        `- UTF-8 バイト数: ${bytes}`,
        '',
        '数え方: 文字はコードポイント単位（絵文字も 1 文字）、語は空白で区切った数（日本語のように空白で区切らない文はひと続きで 1 語）、行は改行（\\n・\\r\\n・\\r）で区切った数です。前後の空白を除いた選択テキストを数えています。',
      ].join('\n'),
    }
  }
  return {
    text: [
      `- Characters (with spaces): ${chars.length}`,
      `- Characters (without spaces): ${nonSpace}`,
      `- Words: ${words}`,
      `- Lines: ${lines}`,
      `- UTF-8 bytes: ${bytes}`,
      '',
      'How they are counted: characters as code points (an emoji is one), words as the runs between white space (text written without spaces, such as Japanese, counts as one word per run), lines as split at line breaks (\\n, \\r\\n, \\r). The selected text is counted without its leading and trailing white space.',
    ].join('\n'),
  }
})

// ---------------------------------------------------------------------------
// format-json / minify-json

const JSON_PROBLEMS: Record<JsonError['problem'], Texts> = {
  char: { ja: '予期しない文字', en: 'unexpected character' },
  string: { ja: '閉じていない文字列', en: 'unterminated string' },
  escape: { ja: '不正なエスケープ', en: 'invalid escape' },
  control: { ja: '文字列の中の制御文字（改行・タブはエスケープが必要）', en: 'control character in a string (a line break or tab must be escaped)' },
  number: { ja: '不正な数値', en: 'invalid number' },
  end: { ja: '途中で終わっている', en: 'unexpected end of the text' },
  token: { ja: '予期しない記号', en: 'unexpected token' },
  trailing: { ja: '値の後ろに余分な内容', en: 'extra content after the value' },
  empty: { ja: '値がない', en: 'no value' },
}

/** A JSON error as the pane shows it: what and where. */
export function jsonErrorText(err: JsonError, lang: Lang): string {
  const what = pick(lang, JSON_PROBLEMS[err.problem])
  // The token is the JSON as written (a string token cut at 20 characters,
  // before it is escaped, so no escape is cut short), so a backslash of the
  // text is already `\\` there and a hidden character's escape is told from it
  // as in the layout. A string cut just after a lone backslash (the first half
  // of an escape) ends in one: it shows only the token's start, so that is left.
  const token = err.found === undefined ? undefined : escapeHidden(err.found)
  const found = token === undefined ? '' : lang === 'ja' ? `「${token}」` : ` "${token}"`
  return lang === 'ja'
    ? `JSON として読めません: ${err.line} 行 ${err.column} 列目、${what}${found}。`
    : `Not valid JSON: line ${err.line}, column ${err.column}: ${what}${found}.`
}

/**
 * How long a layout grows (in UTF-16 units) before it stops: past what the
 * pane shows (LOCAL_TEXT_LIMIT, 20,000 code points of at most two units), so
 * the pane still cuts it and says so, and short of what deep nesting would
 * build (the length times the depth).
 */
export const JSON_LAYOUT_LIMIT = 50_000

/**
 * The JSON laid out, its hidden characters escaped. Only DEL, C1 and the
 * bidirectional and zero-width characters can be there (JSON has no raw C0 in
 * a string, and a leading BOM is skipped), and only in a string, where `\u007f`
 * means the same: the JSON stays the same JSON.
 */
const laidOut = (json: string, indent: number): { text: string } | { error: JsonError } => {
  const r = layoutJson(json, indent, JSON_LAYOUT_LIMIT)
  return 'error' in r ? r : { text: escapeHidden(r.text) }
}

const layout = (indent: number) =>
  onText((text, { lang }) => {
    const r = laidOut(text, indent)
    return 'error' in r ? { error: jsonErrorText(r.error, lang) } : { text: r.text }
  })

/** The JSON laid out with two spaces per level. */
export const formatJson = layout(2)

/** The JSON on one line, with no white space. */
export const minifyJson = layout(0)

// ---------------------------------------------------------------------------
// csv-to-table

type CsvRecord = { line: number; cells: string[] }

/** The delimiter: a tab if the first line (outside quotes) has one, else a comma. */
function delimiterOf(text: string): string {
  let quoted = false
  for (const c of text) {
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) break
    else if (!quoted && c === '\t') return '\t'
  }
  return ','
}

/** The records of a CSV (RFC 4180 quotes: `""` inside a quoted field, delimiters and line breaks in one), each with the line it starts on. Blank lines are skipped. */
function parseCsv(text: string, delim: string): { records: CsvRecord[] } | { unclosed: number } {
  const records: CsvRecord[] = []
  let line = 1
  let cells: string[] = []
  let cell = ''
  let startLine = 1
  let sawQuote = false
  let i = 0
  const endRecord = () => {
    cells.push(cell)
    if (!(cells.length === 1 && cells[0] === '' && !sawQuote)) records.push({ line: startLine, cells })
    cells = []
    cell = ''
    sawQuote = false
  }
  while (i < text.length) {
    const c = text[i]!
    if (c === '"' && cell === '') {
      // A quoted field: up to the quote not doubled.
      sawQuote = true
      const quoteLine = line
      i++
      for (;;) {
        if (i >= text.length) return { unclosed: quoteLine }
        const d = text[i]!
        if (d === '"') {
          if (text[i + 1] === '"') {
            cell += '"'
            i += 2
            continue
          }
          i++
          break
        }
        if (d === '\r' && text[i + 1] === '\n') {
          cell += '\n'
          i += 2
          line++
          continue
        }
        if (d === '\n' || d === '\r') {
          cell += '\n'
          i++
          line++
          continue
        }
        cell += d
        i++
      }
      continue
    }
    if (c === delim) {
      cells.push(cell)
      cell = ''
      i++
      continue
    }
    if (c === '\r' || c === '\n') {
      endRecord()
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
      line++
      startLine = line
      continue
    }
    cell += c
    i++
  }
  endRecord()
  return { records }
}

const tableCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>')

/** The CSV (or TSV) as a Markdown table, the first record its header; the rows of another width listed after it. */
export const csvToTable = onText((text, { lang }) => {
  const delim = delimiterOf(text)
  const parsed = parseCsv(text, delim)
  if ('unclosed' in parsed) {
    return {
      error:
        lang === 'ja'
          ? `CSV として読めません: ${parsed.unclosed} 行目で始まる引用符（"）が閉じていません。`
          : `Not a readable CSV: the quote (") opened on line ${parsed.unclosed} is never closed.`,
    }
  }
  const { records } = parsed
  const header = records[0]!
  // Not Math.max(...): a long CSV would pass too many arguments.
  const width = records.reduce((w, r) => Math.max(w, r.cells.length), 0)
  const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, k) => tableCell(cells[k] ?? '')).join(' | ')} |`
  const out = [row(header.cells), `|${' --- |'.repeat(width)}`, ...records.slice(1).map(r => row(r.cells))]
  const odd = records.slice(1).filter(r => r.cells.length !== header.cells.length)
  if (odd.length > 0) {
    out.push('')
    out.push(
      lang === 'ja'
        ? `列数が揃わない行（見出しは ${header.cells.length} 列）: ${odd.map(r => `${r.line} 行目（${r.cells.length} 列）`).join('、')}`
        : `Rows whose number of columns differs from the header's ${header.cells.length}: ${odd
            .map(r => `line ${r.line} (${plural(r.cells.length, 'column', 'columns')})`)
            .join(', ')}`,
    )
  }
  return { text: out.join('\n') }
})

// ---------------------------------------------------------------------------
// sort-lines / dedupe-lines

/** Compares two strings by code point (not by UTF-16 unit, which puts U+10000 and above before U+E000 to U+FFFF). */
export function compareCodePoints(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!
    const y = b.codePointAt(j)!
    if (x !== y) return x < y ? -1 : 1
    i += x > 0xffff ? 2 : 1
    j += y > 0xffff ? 2 : 1
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0
}

/** The lines in code point order, case ignored (toLowerCase, the same on every machine); equal ones keep their order. */
export const sortLines = onText(text => {
  const lines = linesOf(text).map((line, index) => ({ line, key: line.toLowerCase(), index }))
  lines.sort((p, q) => compareCodePoints(p.key, q.key) || p.index - q.index)
  return { text: lines.map(l => l.line).join('\n') }
})

/** The lines with each repeat after the first left out, and how many were. */
export const dedupeLines = onText((text, { lang }) => {
  const seen = new Set<string>()
  const kept: string[] = []
  let removed = 0
  for (const line of linesOf(text)) {
    if (seen.has(line)) removed++
    else {
      seen.add(line)
      kept.push(line)
    }
  }
  const note =
    lang === 'ja'
      ? removed === 0
        ? '（重複した行はありませんでした）'
        : `（重複した ${removed} 行を除きました）`
      : removed === 0
        ? '(No line was repeated.)'
        : `(Removed ${plural(removed, 'repeated line', 'repeated lines')}.)`
  return { text: `${kept.join('\n')}\n\n${note}` }
})

// ---------------------------------------------------------------------------
// case-variants

/** The words of an identifier or a phrase: split at anything but letters and digits, and where the case changes (HTTPServer: HTTP, Server). */
export function wordsOf(text: string): string[] {
  const words: string[] = []
  for (const chunk of text.split(/[^\p{L}\p{N}]+/u)) {
    for (const m of chunk.matchAll(/\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+\p{N}*|\p{Lu}+\p{N}*|\p{N}+|[^\p{Lu}\p{Ll}\p{N}]+/gu)) {
      words.push(m[0])
    }
  }
  return words
}

const capitalize = (w: string) => {
  const [first = '', ...rest] = [...w]
  return first.toUpperCase() + rest.join('').toLowerCase()
}

/** The selected word or identifier in camelCase, PascalCase, snake_case, kebab-case and CONSTANT_CASE. */
export const caseVariants = onText((text, { lang }) => {
  const words = text.length > 200 || /[\r\n]/.test(text) ? [] : wordsOf(text)
  if (words.length === 0) {
    return {
      error:
        lang === 'ja'
          ? '1 つの語か識別子（改行なし、200 文字まで、英字か数字を含む）を選択してください。'
          : 'Select a single word or identifier (one line, up to 200 characters, with letters or digits).',
    }
  }
  const lower = words.map(w => w.toLowerCase())
  return {
    text: [
      `camelCase: ${lower[0]}${words.slice(1).map(capitalize).join('')}`,
      `PascalCase: ${words.map(capitalize).join('')}`,
      `snake_case: ${lower.join('_')}`,
      `kebab-case: ${lower.join('-')}`,
      `CONSTANT_CASE: ${words.map(w => w.toUpperCase()).join('_')}`,
    ].join('\n'),
  }
})

// ---------------------------------------------------------------------------
// base64-decode / base64-encode

/** A Base64 error as the pane shows it. */
function base64ErrorText(err: Base64Error, lang: Lang): string {
  if (err.reason === 'char') {
    const char = escapeHidden(err.char)
    return lang === 'ja'
      ? `Base64 として読めません: ${err.index} 文字目の「${char}」は Base64 の文字ではありません。`
      : `Not valid Base64: character ${err.index} ("${char}") is not a Base64 character.`
  }
  if (err.reason === 'padding') {
    return lang === 'ja'
      ? `Base64 として読めません: ${err.index} 文字目、パディング（=）の位置か数が正しくありません。`
      : `Not valid Base64: at character ${err.index}, the padding (=) is misplaced or too long.`
  }
  return lang === 'ja'
    ? 'Base64 として読めません: 長さが Base64 として正しくありません。'
    : 'Not valid Base64: its length is not one Base64 can have.'
}


/** The Base64 (standard or URL-safe) decoded as UTF-8; bytes that are not text, by their length and first bytes in hexadecimal. */
export const base64DecodeText = onText((text, { lang }) => {
  const r = base64Decode(text)
  if ('error' in r) return { error: base64ErrorText(r.error, lang) }
  const decoded = utf8Decode(r.bytes)
  // Control characters: the bytes. Bidirectional and zero-width ones only (a
  // BOM, say): the text, with them escaped and a note.
  if (decoded !== undefined && !hasControls(decoded)) return { text: withHiddenShown(decoded, lang).join('\n\n') }
  const head = toHex(r.bytes.subarray(0, 32), ' ') + (r.bytes.length > 32 ? ' …' : '')
  return {
    text:
      lang === 'ja'
        ? [`UTF-8 のテキストとして表示できないバイト列です。`, `バイト長: ${r.bytes.length}`, `先頭 ${Math.min(32, r.bytes.length)} バイト（16 進）: ${head}`].join('\n')
        : [`These bytes do not read as UTF-8 text.`, `Length: ${plural(r.bytes.length, 'byte', 'bytes')}`, `First ${Math.min(32, r.bytes.length)} bytes (hex): ${head}`].join('\n'),
  }
})

/** The text's UTF-8 bytes in standard Base64, padded. */
export const base64EncodeText = onText(text => ({ text: base64Encode(utf8Encode(text)) }))

// ---------------------------------------------------------------------------
// url-decode / url-encode

/** The percent-encoded text decoded: each run of %XX read as UTF-8, hidden characters (and then backslashes) escaped; `+` is left as it is. */
export const urlDecode = onText((text, { lang }) => {
  const out: string[] = []
  let i = 0
  let position = 0
  const bad = (at: number) => ({
    error:
      lang === 'ja'
        ? `URL エンコードとして読めません: ${at} 文字目の % の後ろが正しい 16 進 2 桁ではないか、UTF-8 として正しくないバイト列です。`
        : `Not valid percent-encoding: the % at character ${at} is not followed by two hex digits, or its bytes are not valid UTF-8.`,
  })
  while (i < text.length) {
    if (text[i] === '%') {
      const runStart = position + 1
      const bytes: number[] = []
      while (text[i] === '%') {
        const hex = text.slice(i + 1, i + 3)
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) return bad(position + 1)
        bytes.push(parseInt(hex, 16))
        i += 3
        position += 3
      }
      const decoded = utf8Decode(Uint8Array.from(bytes))
      if (decoded === undefined) return bad(runStart)
      out.push(decoded)
      continue
    }
    const cp = text.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    out.push(ch)
    i += ch.length
    position++
  }
  const [shown, ...notes] = withHiddenShown(out.join(''), lang)
  if (text.includes('+')) notes.push(lang === 'ja' ? '（「+」は空白に変えていません）' : '(A "+" is left as it is, not read as a space.)')
  return { text: [shown, ...notes].join('\n\n') }
})

/** The text percent-encoded as encodeURIComponent does it. */
export const urlEncode = onText((text, { lang }) => {
  try {
    return { text: encodeURIComponent(text) }
  } catch {
    return {
      error:
        lang === 'ja'
          ? 'URL エンコードできません: 対になっていないサロゲート（壊れた文字）を含んでいます。'
          : 'Cannot percent-encode it: it holds an unpaired surrogate (a broken character).',
    }
  }
})

// ---------------------------------------------------------------------------
// parse-url

const decodeQueryPart = (s: string): string | undefined => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return undefined
  }
}

/** The URL taken apart: scheme, user (password hidden), host, port, path, query (each key and value decoded; hidden characters, and then backslashes, escaped) and fragment. */
export const parseUrl = onText((text, { lang }) => {
  const ja = lang === 'ja'
  const err = (why: Texts) => ({ error: `${ja ? 'URL として読めません: ' : 'Not a readable URL: '}${pick(lang, why)}` })
  if (/\s/u.test(text)) return err({ ja: '空白や改行を含んでいます。', en: 'it holds white space or a line break.' })
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/su.exec(text)
  if (m === null) return err({ ja: 'スキーム（https: など）がありません。', en: 'it has no scheme (such as https:).' })
  const scheme = m[1]!
  let rest = m[2]!
  let fragment: string | undefined
  let query: string | undefined
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    fragment = rest.slice(hash + 1)
    rest = rest.slice(0, hash)
  }
  const q = rest.indexOf('?')
  if (q >= 0) {
    query = rest.slice(q + 1)
    rest = rest.slice(0, q)
  }
  let userinfo: string | undefined
  let host: string | undefined
  let port: string | undefined
  let path = rest
  if (rest.startsWith('//')) {
    const slash = rest.indexOf('/', 2)
    let authority = slash >= 0 ? rest.slice(2, slash) : rest.slice(2)
    path = slash >= 0 ? rest.slice(slash) : ''
    const at = authority.lastIndexOf('@')
    if (at >= 0) {
      userinfo = authority.slice(0, at)
      authority = authority.slice(at + 1)
    }
    if (authority.startsWith('[')) {
      const close = authority.indexOf(']')
      if (close < 0) return err({ ja: 'IPv6 アドレスの [ が閉じていません。', en: 'the [ of its IPv6 address is never closed.' })
      host = authority.slice(0, close + 1)
      const after = authority.slice(close + 1)
      if (after !== '') {
        if (!after.startsWith(':')) return err({ ja: 'IPv6 アドレスの後ろが正しくありません。', en: 'what follows its IPv6 address is not a port.' })
        port = after.slice(1)
      }
    } else {
      const colon = authority.lastIndexOf(':')
      host = colon >= 0 ? authority.slice(0, colon) : authority
      if (colon >= 0) port = authority.slice(colon + 1)
    }
    if (port !== undefined && port !== '' && (!/^[0-9]{1,5}$/.test(port) || Number(port) > 65535)) {
      // Any text but white space can be there, a backslash and a hidden
      // character alike: shown as the body is, with the same note.
      const { shown, escaped } = showHidden(port)
      const why = err({ ja: `ポート「${shown}」は 0〜65535 の数ではありません。`, en: `its port "${shown}" is not a number from 0 to 65535.` })
      return escaped ? { error: `${why.error}\n\n${pick(lang, HIDDEN_NOTE)}` } : why
    }
  }
  const none = ja ? '（なし）' : '(none)'
  const lines = [`${ja ? 'スキーム' : 'Scheme'}: ${scheme}`]
  if (userinfo !== undefined) {
    const colon = userinfo.indexOf(':')
    lines.push(`${ja ? 'ユーザー情報' : 'User info'}: ${colon >= 0 ? `${userinfo.slice(0, colon)}:***` : userinfo}`)
  }
  lines.push(`${ja ? 'ホスト' : 'Host'}: ${host === undefined || host === '' ? none : host}`)
  lines.push(`${ja ? 'ポート' : 'Port'}: ${port === undefined || port === '' ? (ja ? '（省略。スキームの既定）' : "(left out: the scheme's default)") : port}`)
  lines.push(`${ja ? 'パス' : 'Path'}: ${path === '' ? none : path}`)
  if (query === undefined || query === '') {
    lines.push(`${ja ? 'クエリ' : 'Query'}: ${none}`)
  } else {
    lines.push(`${ja ? 'クエリ' : 'Query'}:`)
    for (const pair of query.split('&')) {
      if (pair === '') continue
      const eq = pair.indexOf('=')
      const rawKey = eq >= 0 ? pair.slice(0, eq) : pair
      const rawValue = eq >= 0 ? pair.slice(eq + 1) : undefined
      const key = decodeQueryPart(rawKey)
      const value = rawValue === undefined ? undefined : decodeQueryPart(rawValue)
      const undecodable = key === undefined || (rawValue !== undefined && value === undefined)
      const shownKey = key ?? rawKey
      const shownValue = rawValue === undefined ? (ja ? '（値なし）' : '(no value)') : (value ?? rawValue)
      lines.push(`  - ${shownKey} = ${shownValue}${undecodable ? (ja ? '（デコードできないため元のまま）' : ' (could not be decoded: shown as written)') : ''}`)
    }
  }
  lines.push(`${ja ? 'フラグメント' : 'Fragment'}: ${fragment === undefined || fragment === '' ? none : fragment}`)
  return { text: withHiddenShown(lines.join('\n'), lang).join('\n\n') }
})

// ---------------------------------------------------------------------------
// Dates: epoch-to-date and decode-jwt

const two = (n: number) => String(n).padStart(2, '0')

/** The year as ISO 8601 writes it: four digits, or a sign and six outside 0 to 9999. */
const isoYear = (y: number) => (y >= 0 && y <= 9999 ? String(y).padStart(4, '0') : `${y < 0 ? '-' : '+'}${String(Math.abs(y)).padStart(6, '0')}`)

/** The UTC fields of `d` as ISO 8601 without the zone: milliseconds only when there are any. */
function isoFields(d: Date): string {
  const ms = d.getUTCMilliseconds()
  return (
    `${isoYear(d.getUTCFullYear())}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}` +
    `T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}` +
    (ms === 0 ? '' : `.${String(ms).padStart(3, '0')}`)
  )
}

const offsetText = (minutes: number) => {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`
}

/** The instant in UTC and in local time (its offset and the zone's name), or undefined when Date cannot hold it. */
function bothTimes(ms: number, input: LocalInput): { utc: string; local: string } | undefined {
  const utc = new Date(ms)
  if (!Number.isFinite(utc.getTime())) return undefined
  const offset = Math.round(input.utcOffsetMinutes(ms))
  const shifted = new Date(ms + offset * 60_000)
  if (!Number.isFinite(shifted.getTime()) || !Number.isFinite(offset)) return undefined
  return { utc: `${isoFields(utc)}Z`, local: `${isoFields(shifted)}${offsetText(offset)} (${input.timeZone})` }
}

/** A UNIX time (seconds up to 11 digits, milliseconds from 12 to 14) in UTC and in local time, ISO 8601. */
export const epochToDate = onText((text, input) => {
  const ja = input.lang === 'ja'
  const m = /^([+-]?)([0-9]+)(?:\.([0-9]+))?$/.exec(text)
  if (m === null) {
    return { error: ja ? 'UNIX 時刻として読めません: 整数（秒かミリ秒）を選択してください。' : 'Not a UNIX time: select a whole number of seconds or milliseconds.' }
  }
  const [, sign, intPart, frac = ''] = m
  const digits = intPart!.replace(/^0+(?=.)/, '').length
  const seconds = digits <= 11
  if (digits > 14) {
    return { error: ja ? `UNIX 時刻として読めません: 整数部が ${digits} 桁です（秒は 11 桁まで、ミリ秒は 12〜14 桁）。` : `Not a UNIX time: its whole part has ${digits} digits (seconds up to 11, milliseconds 12 to 14).` }
  }
  if (!seconds && frac !== '') {
    return {
      error: ja
        ? 'UNIX 時刻として読めません: ミリ秒（整数部 12〜14 桁）に小数部は付けられません。'
        : 'Not a UNIX time: milliseconds (a whole part of 12 to 14 digits) take no fraction.',
    }
  }
  const whole = Number(intPart)
  const ms = (seconds ? whole * 1000 + Number(frac.padEnd(3, '0').slice(0, 3)) : whole) * (sign === '-' ? -1 : 1)
  const times = bothTimes(ms, input)
  if (times === undefined) {
    return { error: ja ? 'UNIX 時刻として読めません: 日時の範囲外です。' : 'Not a UNIX time: it is out of the range of dates.' }
  }
  const unit = seconds ? (ja ? '秒' : 'seconds') : ja ? 'ミリ秒' : 'milliseconds'
  return {
    text: ja
      ? [`単位: ${unit}（整数部 ${digits} 桁から判定）`, `UTC: ${times.utc}`, `ローカル: ${times.local}`].join('\n')
      : [`Unit: ${unit} (from its ${plural(digits, 'digit', 'digits')})`, `UTC: ${times.utc}`, `Local: ${times.local}`].join('\n'),
  }
})

const SIGNATURE_NOTE: Texts = {
  ja: '※ 署名は検証していません（中身をデコードして表示しただけです）。',
  en: 'Note: the signature is not verified (the contents are only decoded).',
}

/** A JWT's header and payload decoded and laid out, exp/iat/nbf as dates; always saying the signature is not verified. */
export const decodeJwt = onText((text, input) => {
  const { lang } = input
  const ja = lang === 'ja'
  const parts = text.split('.')
  if (parts.length === 5) {
    return { error: ja ? 'JWT として読めません: 5 つに区切られた JWE（暗号化されたトークン）は読めません。' : 'Not a readable JWT: a JWE (an encrypted token, in five parts) cannot be read.' }
  }
  if (parts.length !== 3) {
    return { error: ja ? `JWT として読めません: 「.」で 3 つに区切られていません（${parts.length} 個）。` : `Not a readable JWT: it is not three parts separated by "." (${parts.length}).` }
  }
  const decoded: string[] = []
  let payloadJson = ''
  for (const [index, part] of [parts[0]!, parts[1]!].entries()) {
    const name = index === 0 ? (ja ? 'ヘッダ' : 'header') : ja ? 'ペイロード' : 'payload'
    const bytes = base64Decode(part)
    const json = 'error' in bytes ? undefined : utf8Decode(bytes.bytes)
    if (json === undefined) {
      return { error: ja ? `JWT として読めません: ${name}が Base64URL の UTF-8 テキストではありません。` : `Not a readable JWT: its ${name} is not UTF-8 text in Base64URL.` }
    }
    const laid = laidOut(json, 2)
    if ('error' in laid) return { error: `${ja ? `JWT の${name}: ` : `The JWT's ${name}: `}${jsonErrorText(laid.error, lang)}` }
    decoded.push(laid.text)
    payloadJson = json
  }
  const lines = [pick(lang, SIGNATURE_NOTE), '', ja ? 'ヘッダ:' : 'Header:', decoded[0]!, '', ja ? 'ペイロード:' : 'Payload:', decoded[1]!]
  // Valid JSON by now (the payload as decoded: its layout may be cut short),
  // so JSON.parse reads it, unless it nests deeper than the engine can go;
  // only the three claims are read from it.
  let payload: unknown
  try {
    payload = JSON.parse(payloadJson)
  } catch {
    payload = undefined
  }
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const claims = payload as Record<string, unknown>
    const times: string[] = []
    for (const claim of ['exp', 'iat', 'nbf'] as const) {
      const v = claims[claim]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      const ms = Math.round(v * 1000)
      const t = bothTimes(ms, input)
      if (t === undefined) continue
      let state = ''
      if (claim === 'exp' && ms <= input.now) state = ja ? '（期限切れ）' : ' (expired)'
      if (claim === 'nbf' && ms > input.now) state = ja ? '（まだ有効になっていません）' : ' (not valid yet)'
      times.push(ja ? `- ${claim}: ${v} → UTC ${t.utc} / ローカル ${t.local}${state}` : `- ${claim}: ${v} → UTC ${t.utc} / local ${t.local}${state}`)
    }
    if (times.length > 0) lines.push('', ja ? '時刻:' : 'Times:', ...times)
  }
  return { text: lines.join('\n') }
})

// ---------------------------------------------------------------------------
// hash-text

/** SHA-256 and SHA-1 of the selected text's UTF-8 bytes, in lowercase hexadecimal. */
export const hashText = onText((text, { lang }) => {
  const bytes = utf8Encode(text)
  return {
    text: [
      `SHA-256: ${sha256(bytes)}`,
      `SHA-1: ${sha1(bytes)}`,
      '',
      lang === 'ja'
        ? '（前後の空白を除いた選択テキストの UTF-8 バイト列から計算しています）'
        : '(Computed over the UTF-8 bytes of the selected text, without its leading and trailing white space.)',
    ].join('\n'),
  }
})

// ---------------------------------------------------------------------------
// color-convert

type Rgb = [number, number, number]

const NUM = '([+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+))'
// A comma with white space around it, or white space alone: never white space
// split between two ways (`\s*` then `\s+` would backtrack polynomially).
const SEP = '(?:\\s*,\\s*|\\s+)'

const RGB = new RegExp(`^rgb\\(\\s*${NUM}${SEP}${NUM}${SEP}${NUM}\\s*\\)$`, 'i')
const HSL = new RegExp(`^hsl\\(\\s*${NUM}(?:deg)?${SEP}${NUM}%${SEP}${NUM}%\\s*\\)$`, 'i')

/** The longest text tried as a colour: room to spare (`hsl(359.5deg, 100.0%, 100.0%)` is 30 characters), and no long run for a pattern to try. */
const COLOR_MAX = 64

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360
  const sat = s / 100
  const light = l / 100
  if (sat === 0) {
    const v = Math.round(light * 255)
    return [v, v, v]
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q
  const channel = (t0: number) => {
    const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [Math.round(channel(hue + 1 / 3) * 255), Math.round(channel(hue) * 255), Math.round(channel(hue - 1 / 3) * 255)]
}

export function rgbToHsl([r0, g0, b0]: Rgb): [number, number, number] {
  const r = r0 / 255
  const g = g0 / 255
  const b = b0 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [Math.round(h * 60) % 360, Math.round(s * 100), Math.round(l * 100)]
}

/** A colour (#RGB, #RRGGBB, rgb() or hsl()) as HEX, RGB and HSL. */
export const colorConvert = onText((text, { lang }) => {
  const ja = lang === 'ja'
  const unsupported = {
    error: ja
      ? '色として読めません: #RGB・#RRGGBB・rgb(r, g, b)（0〜255）・hsl(h, s%, l%)（s・l は 0〜100%）のいずれかを選択してください。'
      : 'Not a readable colour: select #RGB, #RRGGBB, rgb(r, g, b) (0 to 255) or hsl(h, s%, l%) (s and l from 0 to 100%).',
  }
  if (text.length > COLOR_MAX) return unsupported
  let rgb: Rgb | undefined
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex !== null) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map(c => c + c).join('') : hex[1]!
    rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const r = rgb === undefined ? RGB.exec(text) : null
  if (r !== null) {
    const values = [Number(r[1]), Number(r[2]), Number(r[3])]
    if (values.some(v => !(v >= 0 && v <= 255))) return unsupported
    rgb = values.map(v => Math.round(v)) as Rgb
  }
  const hs = rgb === undefined ? HSL.exec(text) : null
  if (hs !== null) {
    const [h, sat, light] = [Number(hs[1]), Number(hs[2]), Number(hs[3])]
    if (!Number.isFinite(h) || !(sat >= 0 && sat <= 100) || !(light >= 0 && light <= 100)) return unsupported
    rgb = hslToRgb(h, sat, light)
  }
  if (rgb === undefined) return unsupported
  const [hh, ss, ll] = rgbToHsl(rgb)
  return {
    text: [
      `HEX: #${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`,
      `RGB: rgb(${rgb.join(', ')})`,
      `HSL: hsl(${hh}, ${ss}%, ${ll}%)`,
    ].join('\n'),
  }
})
