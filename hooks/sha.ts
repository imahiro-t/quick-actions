// SHA-256 and SHA-1 (FIPS 180-4) in plain TypeScript, synchronous, for the
// hash-text action (./selection-local): crypto.subtle answers a promise and
// Node's crypto is not there, so the hooks module computes them itself.
// 32-bit arithmetic throughout: `>>> 0` keeps every word unsigned.

/** The message padded to whole 64-byte blocks: a 1 bit, zeros, then its length in bits as 64 bits, big-endian. */
function padded(bytes: Uint8Array): Uint8Array {
  const length = bytes.length
  const total = Math.ceil((length + 9) / 64) * 64
  const out = new Uint8Array(total)
  out.set(bytes)
  out[length] = 0x80
  const bits = length * 8
  // The high 32 bits of the length, then the low 32.
  const high = Math.floor(bits / 0x100000000)
  const low = bits >>> 0
  out[total - 8] = (high >>> 24) & 255
  out[total - 7] = (high >>> 16) & 255
  out[total - 6] = (high >>> 8) & 255
  out[total - 5] = high & 255
  out[total - 4] = (low >>> 24) & 255
  out[total - 3] = (low >>> 16) & 255
  out[total - 2] = (low >>> 8) & 255
  out[total - 1] = low & 255
  return out
}

const word = (m: Uint8Array, at: number) => ((m[at]! << 24) | (m[at + 1]! << 16) | (m[at + 2]! << 8) | m[at + 3]!) >>> 0

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0
const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0

const hexOf = (words: Uint32Array) => Array.from(words, w => w.toString(16).padStart(8, '0')).join('')

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** The SHA-256 digest of the bytes, as 64 lowercase hexadecimal digits. */
export function sha256(bytes: Uint8Array): string {
  const m = padded(bytes)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let block = 0; block < m.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = word(m, block + t * 4)
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3)
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10)
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!]
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K256[t]! + w[t]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = h[0]! + a
    h[1] = h[1]! + b
    h[2] = h[2]! + c
    h[3] = h[3]! + d
    h[4] = h[4]! + e
    h[5] = h[5]! + f
    h[6] = h[6]! + g
    h[7] = h[7]! + hh
  }
  return hexOf(h)
}

/** The SHA-1 digest of the bytes, as 40 lowercase hexadecimal digits. */
export function sha1(bytes: Uint8Array): string {
  const m = padded(bytes)
  const h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0])
  const w = new Uint32Array(80)
  for (let block = 0; block < m.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = word(m, block + t * 4)
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1)
    let [a, b, c, d, e] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!]
    for (let t = 0; t < 80; t++) {
      let f: number
      let k: number
      if (t < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (t < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[t]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }
    h[0] = h[0]! + a
    h[1] = h[1]! + b
    h[2] = h[2]! + c
    h[3] = h[3]! + d
    h[4] = h[4]! + e
  }
  return hexOf(h)
}
