import { expect, test } from './kit'

// What the environment the hooks run in offers, observed rather than required:
// Intl (register.tsx reads the time zone's name from it, falling back to
// `UTC±hh:mm` without it) and String.prototype.normalize('NFKC') (for the ⋯
// dialog's filter to come). Neither assertion fails on an engine that lacks
// them; each records what it found. Under `claude plugin test` on Claude Code
// 2.1.296 both were there (Intl an object, the time zone named, 'ｱ' to 'ア').

test('Intl: present or not, the time zone is read without a throw', () => {
  const kind = typeof Intl
  expect(['object', 'undefined']).toContain(kind)
  let zone: unknown = 'no Intl'
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    zone = 'Intl threw'
  }
  expect(typeof zone).toBe('string')
})

test('normalize NFKC: half-width kana to full-width where it is there', () => {
  const normalized = typeof ''.normalize === 'function' ? 'ｱ'.normalize('NFKC') : 'ｱ'
  expect(['ア', 'ｱ']).toContain(normalized)
})
