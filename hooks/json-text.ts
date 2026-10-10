// JSON (RFC 8259) checked and laid out again token by token, for the local
// actions format-json, minify-json and decode-jwt (./selection-local). Every
// string and number keeps the spelling it was written with, so an integer past
// 2^53, `1.0` or a repeated key comes out as it went in, which a round trip
// through JSON.parse and JSON.stringify would not keep. Where the text is not
// JSON, the error says what and where (line and column, 1-based), in the same
// words on every engine (JSON.parse's messages differ by engine).
//
// No recursion: a stack of open containers, so deep nesting cannot overflow.

type Token = { kind: '{' | '}' | '[' | ']' | ':' | ',' | 'value'; raw: string; at: number }

/** Why the text is not JSON. `found` is the character or token met (undefined at the end of the text). */
export type JsonProblem = 'char' | 'string' | 'escape' | 'control' | 'number' | 'end' | 'token' | 'trailing' | 'empty'

export type JsonError = { problem: JsonProblem; line: number; column: number; found?: string }

/** The line and column (1-based, in code points) of the UTF-16 offset `at`. */
function where(text: string, at: number): { line: number; column: number } {
  let line = 1
  let column = 1
  for (let i = 0; i < at && i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x0a) {
      line++
      column = 1
    } else if (c === 0x0d) {
      // CR LF counts as one line break.
      if (text.charCodeAt(i + 1) !== 0x0a) {
        line++
        column = 1
      }
    } else if (c >= 0xdc00 && c <= 0xdfff && i > 0 && text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff) {
      // The second half of a pair: the same code point.
    } else {
      column++
    }
  }
  return { line, column }
}

const fail = (text: string, at: number, problem: JsonProblem, found?: string): { error: JsonError } => ({
  error: { problem, ...where(text, at), ...(found === undefined ? {} : { found }) },
})

const charAt = (text: string, at: number) => String.fromCodePoint(text.codePointAt(at) ?? 0)

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y

function tokenize(text: string): { tokens: Token[] } | { error: JsonError } {
  const tokens: Token[] = []
  let i = 0
  // A byte order mark at the very start is not part of the value.
  if (text.charCodeAt(0) === 0xfeff) i = 1
  while (i < text.length) {
    const c = text[i]!
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
    } else if (c === '{' || c === '}' || c === '[' || c === ']' || c === ':' || c === ',') {
      tokens.push({ kind: c, raw: c, at: i })
      i++
    } else if (c === '"') {
      const start = i
      i++
      for (;;) {
        if (i >= text.length) return fail(text, start, 'string')
        const d = text.charCodeAt(i)
        if (d === 0x22) break
        if (d < 0x20) return fail(text, i, 'control')
        if (d === 0x5c) {
          const e = text[i + 1]
          if (e === 'u') {
            if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return fail(text, i, 'escape')
            i += 6
          } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
            i += 2
          } else {
            return fail(text, i, 'escape')
          }
        } else {
          i++
        }
      }
      i++
      tokens.push({ kind: 'value', raw: text.slice(start, i), at: start })
    } else if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(text)
      if (m === null) return fail(text, i, 'number')
      const end = i + m[0].length
      // A number runs into no letter, digit or dot: `01`, `1.`, `1e` are not numbers.
      if (end < text.length && /[0-9A-Za-z.+-]/.test(text[end]!)) return fail(text, i, 'number')
      tokens.push({ kind: 'value', raw: m[0], at: i })
      i = end
    } else {
      const word = /[A-Za-z]+/y
      word.lastIndex = i
      const m = word.exec(text)
      if (m !== null && (m[0] === 'true' || m[0] === 'false' || m[0] === 'null')) {
        tokens.push({ kind: 'value', raw: m[0], at: i })
        i += m[0].length
      } else {
        return fail(text, i, 'char', m !== null ? m[0] : charAt(text, i))
      }
    }
  }
  return { tokens }
}

// What may come next, inside the container on top of the stack (or at the top level).
type Expect = 'value' | 'value-or-close' | 'key' | 'key-or-close' | 'colon' | 'comma-or-close' | 'end'

/**
 * The JSON text laid out again: with `indent` spaces per level (as
 * JSON.stringify(value, null, indent) lays it out), or on one line with no
 * white space when `indent` is 0. Or why it is not JSON.
 */
export function layoutJson(text: string, indent: number): { text: string } | { error: JsonError } {
  const lexed = tokenize(text)
  if ('error' in lexed) return lexed
  const { tokens } = lexed
  if (tokens.length === 0) return fail(text, text.length, 'empty')
  const pad = (level: number) => (indent > 0 ? `\n${' '.repeat(indent * level)}` : '')
  const out: string[] = []
  const stack: ('{' | '[')[] = []
  let expect: Expect = 'value'
  // Whether the container just opened is still empty (so `{}` and `[]` stay on one line).
  let justOpened = false
  const afterValue = (): Expect => (stack.length === 0 ? 'end' : 'comma-or-close')
  for (const tok of tokens) {
    const unexpected = () => fail(text, tok.at, 'token', tok.raw.length > 20 ? `${tok.raw.slice(0, 20)}…` : tok.raw)
    switch (expect) {
      case 'end':
        return fail(text, tok.at, 'trailing', tok.raw.length > 20 ? `${tok.raw.slice(0, 20)}…` : tok.raw)
      case 'colon':
        if (tok.kind !== ':') return unexpected()
        out.push(indent > 0 ? ': ' : ':')
        expect = 'value'
        continue
      case 'key':
      case 'key-or-close':
        if (tok.kind === '}' && expect === 'key-or-close') break
        if (tok.kind !== 'value' || !tok.raw.startsWith('"')) return unexpected()
        if (justOpened) out.push(pad(stack.length))
        justOpened = false
        out.push(tok.raw)
        expect = 'colon'
        continue
      case 'comma-or-close':
        if (tok.kind === ',') {
          out.push(`,${pad(stack.length)}`)
          expect = stack.at(-1) === '{' ? 'key' : 'value'
          continue
        }
        break
      case 'value':
      case 'value-or-close':
        if (tok.kind === ']' && expect === 'value-or-close') break
        if (tok.kind === 'value') {
          if (justOpened) out.push(pad(stack.length))
          justOpened = false
          out.push(tok.raw)
          expect = afterValue()
          continue
        }
        if (tok.kind === '{' || tok.kind === '[') {
          if (justOpened) out.push(pad(stack.length))
          out.push(tok.kind)
          stack.push(tok.kind)
          justOpened = true
          expect = tok.kind === '{' ? 'key-or-close' : 'value-or-close'
          continue
        }
        return unexpected()
    }
    // A closing bracket: it must close the container on top.
    const open = stack.at(-1)
    if ((tok.kind === '}' && open === '{') || (tok.kind === ']' && open === '[')) {
      stack.pop()
      out.push(justOpened ? tok.kind : `${pad(stack.length)}${tok.kind}`)
      justOpened = false
      expect = afterValue()
      continue
    }
    return unexpected()
  }
  if (expect !== 'end') return fail(text, text.length, 'end')
  return { text: out.join('') }
}
