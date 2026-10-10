import { expect, test } from 'claude-code/testing'

import { random, randomBytes, randomBytesWith, unitFrom } from '../hooks/random'

// The randomness every local run is handed (LocalInput.random / randomBytes),
// checked as register.tsx passes it: these are the functions themselves, not
// stand-ins.

test('unitFrom: four bytes make a number in [0, 1), the first the most significant', () => {
  expect(unitFrom(0, 0, 0, 0)).toBe(0)
  // A first byte of 0x80 or more is no sign: the upper half, never below 0.
  expect(unitFrom(0x80, 0, 0, 0)).toBe(0.5)
  expect(unitFrom(200, 0, 0, 0)).toBe(200 / 256)
  expect(unitFrom(0x7f, 0xff, 0xff, 0xff)).toBe((2 ** 31 - 1) / 2 ** 32)
  const top = unitFrom(0xff, 0xff, 0xff, 0xff)
  expect(top).toBe((2 ** 32 - 1) / 2 ** 32)
  expect(top < 1).toBe(true)
  expect(unitFrom(0, 0, 0, 1)).toBe(1 / 2 ** 32)
})

test('random: always in [0, 1), and reaching both halves', () => {
  let low = 0
  let high = 0
  for (let i = 0; i < 2000; i++) {
    const r = random()
    expect(typeof r).toBe('number')
    expect(r >= 0 && r < 1).toBe(true)
    if (r < 0.5) low++
    else high++
  }
  // Each half with 2,000 draws: missing one has a chance of 2^-2000.
  expect(low > 0).toBe(true)
  expect(high > 0).toBe(true)
})

test('randomBytes: as many bytes as asked, none for a count below one or no number', () => {
  expect(randomBytes(4).length).toBe(4)
  expect(randomBytes(2.9).length).toBe(2)
  expect(randomBytes(0).length).toBe(0)
  expect(randomBytes(-3).length).toBe(0)
  expect(randomBytes(Number.NaN).length).toBe(0)
  // Past one crypto call's 65,536 bytes: filled throughout, the last chunk too.
  const many = randomBytes(70_000)
  expect(many.length).toBe(70_000)
  expect(many.subarray(65_536).some(b => b !== 0)).toBe(true)
  expect(randomBytes(64).some(b => b !== 0)).toBe(true)
})

test('randomBytesWith: filled a chunk of at most 65,536 bytes at a time', () => {
  const sizes: number[] = []
  const bytes = randomBytesWith(140_000, chunk => {
    sizes.push(chunk.length)
    chunk.fill(7)
  })
  expect(sizes).toEqual([65_536, 65_536, 140_000 - 2 * 65_536])
  expect(bytes.every(b => b === 7)).toBe(true)
})

test('randomBytesWith: where the fill throws (no crypto), bytes from Math.random instead', () => {
  const bytes = randomBytesWith(256, () => {
    throw new Error('no crypto')
  })
  expect(bytes.length).toBe(256)
  expect(bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255)).toBe(true)
  expect(bytes.some(b => b !== 0)).toBe(true)
})
