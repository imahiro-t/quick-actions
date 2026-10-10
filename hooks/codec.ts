// UTF-8, Base64 and hexadecimal, written out in plain TypeScript for the local
// actions on the selection (./selection-local). The hooks module may not count
// on TextEncoder / TextDecoder or atob / btoa being there, so these stand in
// for them: synchronous, pure, never throwing.

/** The text's UTF-8 bytes; a lone surrogate becomes U+FFFD, as TextEncoder does. */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i)
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00)
        i++
      } else {
        cp = 0xfffd
      }
    } else if (cp >= 0xd800 && cp <= 0xdfff) {
      cp = 0xfffd
    }
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return Uint8Array.from(out)
}

/**
 * The bytes read as UTF-8, or undefined when they are not well-formed UTF-8:
 * a stray continuation byte, a sequence cut short, an overlong form, a
 * surrogate or a code point past U+10FFFF.
 */
export function utf8Decode(bytes: Uint8Array): string | undefined {
  const parts: string[] = []
  let chunk: number[] = []
  const flush = () => {
    if (chunk.length > 0) parts.push(String.fromCodePoint(...chunk))
    chunk = []
  }
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!
    let cp: number
    let need: number
    let min: number
    if (b < 0x80) {
      cp = b
      need = 0
      min = 0
    } else if (b >= 0xc2 && b <= 0xdf) {
      cp = b & 0x1f
      need = 1
      min = 0x80
    } else if (b >= 0xe0 && b <= 0xef) {
      cp = b & 0x0f
      need = 2
      min = 0x800
    } else if (b >= 0xf0 && b <= 0xf4) {
      cp = b & 0x07
      need = 3
      min = 0x10000
    } else {
      return undefined
    }
    // A sequence cut short meets undefined here.
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]
      if (c === undefined || (c & 0xc0) !== 0x80) return undefined
      cp = (cp << 6) | (c & 0x3f)
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return undefined
    chunk.push(cp)
    // Spread arguments have a limit: hand them over in slices.
    if (chunk.length >= 4096) flush()
    i += need + 1
  }
  flush()
  return parts.join('')
}

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The bytes in standard Base64, padded with `=`. */
export function base64Encode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += STANDARD[(n >> 18) & 63]! + STANDARD[(n >> 12) & 63]!
    out += b === undefined ? '=' : STANDARD[(n >> 6) & 63]!
    out += c === undefined ? '=' : STANDARD[n & 63]!
  }
  return out
}

/** The value of a Base64 character, in the standard alphabet or the URL-safe one (`-` and `_`). */
function sextet(ch: string): number {
  const i = STANDARD.indexOf(ch)
  if (i >= 0) return i
  if (ch === '-') return 62
  if (ch === '_') return 63
  return -1
}

/** Why a Base64 text could not be decoded: `index` is the 1-based position (in characters) in the text given. */
export type Base64Error = { reason: 'char'; index: number; char: string } | { reason: 'length' } | { reason: 'padding'; index: number }

/**
 * Base64 decoded: the standard alphabet and the URL-safe one alike, padded or
 * not; white space is skipped. A character of neither alphabet, padding before
 * the end, or a length no Base64 can have is an error.
 */
export function base64Decode(text: string): { bytes: Uint8Array } | { error: Base64Error } {
  const values: number[] = []
  let padding = 0
  let position = 0
  for (const ch of text) {
    position++
    if (/\s/u.test(ch)) continue
    if (ch === '=') {
      padding++
      if (padding > 2) return { error: { reason: 'padding', index: position } }
      continue
    }
    if (padding > 0) return { error: { reason: 'padding', index: position } }
    const v = sextet(ch)
    if (v < 0) return { error: { reason: 'char', index: position, char: ch } }
    values.push(v)
  }
  const rest = values.length % 4
  if (values.length === 0 || rest === 1) return { error: { reason: 'length' } }
  // Padding, when there is any, fills the last group to four exactly.
  if (padding > 0 && (rest === 0 || rest + padding !== 4)) return { error: { reason: 'length' } }
  const out: number[] = []
  for (let i = 0; i < values.length; i += 4) {
    const group = values.slice(i, i + 4)
    const n = ((group[0] ?? 0) << 18) | ((group[1] ?? 0) << 12) | ((group[2] ?? 0) << 6) | (group[3] ?? 0)
    out.push((n >> 16) & 255)
    if (group.length > 2) out.push((n >> 8) & 255)
    if (group.length > 3) out.push(n & 255)
  }
  return { bytes: Uint8Array.from(out) }
}

/** The bytes as lowercase hexadecimal, two digits each, joined by `sep`. */
export const toHex = (bytes: Uint8Array, sep = '') => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(sep)
