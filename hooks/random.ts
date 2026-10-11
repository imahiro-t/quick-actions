// The randomness a local action is handed (LocalInput.random / randomBytes):
// bytes from crypto.getRandomValues, and a number in [0, 1) made of four of
// them. Where crypto cannot give them, both throw RandomUnavailableError rather
// than fall back on a weaker source such as Math.random: a password or token
// made of guessable numbers would look as good as a real one, so the action
// fails (runLocal says so) instead. Nothing here reaches `$`; register.tsx
// passes these to every local run, and a test calls them as they are.

/** Fills `bytes` with random values, as crypto.getRandomValues does (at most 65,536 bytes a call). */
export type Fill = (bytes: Uint8Array) => unknown

/** crypto.getRandomValues, read when called: an engine without crypto throws then, not on load. */
const cryptoFill: Fill = bytes => crypto.getRandomValues(bytes)

/** getRandomValues fills at most this many bytes a call. */
const FILL_CHUNK = 65_536

/** Thrown where no secure random numbers can be had (crypto.getRandomValues threw): nothing is made of a weaker source. */
export class RandomUnavailableError extends Error {
  override readonly name = 'RandomUnavailableError'
  constructor(cause?: unknown) {
    super('no secure random numbers are available (crypto.getRandomValues)', { cause })
  }
}

/**
 * `n` random bytes (none for a count below one or no number), filled by `fill`
 * a chunk at a time. Where `fill` throws, RandomUnavailableError (the throw as
 * its cause): no bytes at all, not those the chunks before it filled.
 */
export function randomBytesWith(n: number, fill: Fill): Uint8Array {
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  const bytes = new Uint8Array(count)
  try {
    for (let i = 0; i < bytes.length; i += FILL_CHUNK) fill(bytes.subarray(i, i + FILL_CHUNK))
  } catch (err) {
    throw new RandomUnavailableError(err)
  }
  return bytes
}

/** `n` random bytes from crypto; RandomUnavailableError where crypto cannot give them. */
export const randomBytes = (n: number): Uint8Array => randomBytesWith(n, cryptoFill)

/**
 * The number in [0, 1) that four bytes make, the first the most significant:
 * 0 for four zeros, (2^32 - 1) / 2^32 for four 0xFF. Multiplied rather than
 * shifted, since `<<` and `|` give a signed 32-bit integer (negative once the
 * first byte is 0x80 or more).
 */
export const unitFrom = (a: number, b: number, c: number, d: number): number =>
  (a * 2 ** 24 + b * 2 ** 16 + c * 2 ** 8 + d) / 2 ** 32

/** A random number in [0, 1), from four random bytes; RandomUnavailableError where crypto cannot give them. */
export const random = (): number => {
  const [a = 0, b = 0, c = 0, d = 0] = randomBytes(4)
  return unitFrom(a, b, c, d)
}
