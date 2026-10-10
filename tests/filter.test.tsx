import { expect, test } from 'claude-code/testing'

import { ACTIONS } from '../hooks/actions'
import type { ActionSpec } from '../hooks/actions'
import { filterActions, matchesFilter, normalizeForSearch, parseQuery, searchKey, toNfkc } from '../hooks/filter'
import type { Normalize, Searchable } from '../hooks/filter'

// The ⋯ dialog's filter and the unknown ID's candidates (./hooks/filter): a
// query against every action's ID, its labels in both languages and the names
// of its kind, normalized; its words all must match; a kind mark narrows to
// that kind; the order given is kept, but for an exact ID, which comes first.

const ids = (list: readonly { id: string }[]) => list.map(a => a.id)
const only = (query: string) => ids(filterActions(ACTIONS, query))
const byId = (id: string): ActionSpec => {
  const spec = ACTIONS.find(a => a.id === id)
  if (spec === undefined) throw new Error(`no action ${id}`)
  return spec
}

// ---------------------------------------------------------------------------
// Normalizing

test('normalizing: NFKC, lowercase, katakana as hiragana', () => {
  expect(normalizeForSearch('ＥＸＰＬＡＩＮ')).toBe('explain')
  expect(normalizeForSearch('ﾀｲﾏｰ')).toBe('たいまー')
  expect(normalizeForSearch('タイマー')).toBe('たいまー')
  expect(normalizeForSearch('Deep Dive')).toBe('deep dive')
  expect(normalizeForSearch('ヴ')).toBe('ゔ')
  // Outside the katakana letters (the long-vowel mark, the middle dot): kept.
  expect(normalizeForSearch('ー・')).toBe('ー・')
})

test('a query in full-width letters, half-width kana, hiragana or capitals finds the action', () => {
  expect(only('ＥＸＰ')).toContain('explain')
  expect(only('ﾀｲﾏｰ')).toEqual(['timer'])
  expect(only('たいまー')).toEqual(['timer'])
  expect(only('EXPLAIN')[0]).toBe('explain')
})

// The runtime's String.prototype cannot be patched (it is frozen), so the
// engine without normalize is stood for by passing none.
test('with no normalize, full-width letters and spaces are still made half-width', () => {
  expect(normalizeForSearch('ＴＬ；ＤＲ', null)).toBe('tl;dr')
  expect(normalizeForSearch('ＥＸＰＬＡＩＮ', null)).toBe('explain')
  expect(normalizeForSearch('日本\u3000訳', null)).toBe('日本 訳')
  // Katakana still become hiragana; half-width kana are what the fallback leaves alone.
  expect(normalizeForSearch('タイマー', null)).toBe('たいまー')
  expect(normalizeForSearch('ｱ', null)).toBe('ｱ')
  expect(toNfkc('Ａ\u3000Ｂ', null)).toBe('A B')
  // With it, as the engine has it: half-width kana too.
  expect(normalizeForSearch('ｱ')).toBe('あ')
})

test('a normalize that throws, or answers no string, falls back the same way', () => {
  const throwing: Normalize = () => {
    throw new RangeError('no NFKC')
  }
  expect(normalizeForSearch('ＣＯＤＥ', throwing)).toBe('code')
  const broken = (() => undefined) as unknown as Normalize
  expect(toNfkc('ＣＯＤＥ', broken)).toBe('CODE')
})

// ---------------------------------------------------------------------------
// What is searched

test('the ID, the label in either language, whatever the display language', () => {
  expect(only('deep-dive')).toEqual(['deep-dive'])
  expect(only('日本語訳')).toEqual(['translate-ja', 'translate-last-ja'])
  expect(only('japanese')).toEqual(['translate-ja', 'easy-japanese', 'translate-last-ja', 'keigo-phrases'])
  expect(only('handoff')).toEqual(['handoff'])
  expect(only('引き継ぎ')).toEqual(['handoff'])
})

test('the names of the kinds, in both languages', () => {
  const selection = ids(ACTIONS.filter(a => a.target === undefined || a.target === 'selection'))
  const context = ids(ACTIONS.filter(a => a.target === 'context'))
  const standalone = ids(ACTIONS.filter(a => a.target === 'none'))
  expect(only('選択')).toEqual(selection)
  expect(only('selection')).toEqual(selection)
  expect(only('会話')).toEqual(context)
  expect(only('context')).toEqual(context)
  for (const word of ['単独', 'コンテキストなし', 'standalone', 'none']) expect(only(word)).toEqual(standalone)
  // コンテキスト is part of コンテキストなし: the context actions and the standalone ones.
  expect(only('コンテキスト')).toEqual([...context, ...standalone])
})

test('a custom action\'s single label is searched as it is', () => {
  const mine: Searchable = { id: 'mine', label: 'Pirate summary' }
  expect(matchesFilter(mine, 'pirate')).toBe(true)
  expect(matchesFilter(mine, 'PIRATE sum')).toBe(true)
  expect(matchesFilter(mine, 'selection')).toBe(true)
  expect(matchesFilter(mine, 'context')).toBe(false)
})

test('no word matches across two parts of the key', () => {
  // The ID `tldr` then the label `一行で要約`: never one word `tldr一行`.
  expect(only('tldr一行')).toEqual([])
})

// ---------------------------------------------------------------------------
// Words: every one must match

test('words split at spaces, half- or full-width, all must match', () => {
  expect(only('日本 訳')).toEqual(['translate-ja', 'translate-last-ja'])
  expect(only('日本　訳')).toEqual(['translate-ja', 'translate-last-ja'])
  expect(only('  要約   会話 ')).toEqual(['recap', 'recap-recent', 'summarize-last'])
  expect(only('日本 zzz')).toEqual([])
  expect(only('zzz')).toEqual([])
})

test('an empty query, or spaces alone, keeps every action in its order', () => {
  expect(only('')).toEqual(ids(ACTIONS))
  expect(only('  　 ')).toEqual(ids(ACTIONS))
  expect(matchesFilter(byId('timer'), '')).toBe(true)
})

// ---------------------------------------------------------------------------
// Kind marks

test('a kind mark narrows to that kind, rather than matching text', () => {
  const selection = ids(ACTIONS.filter(a => a.target === undefined || a.target === 'selection'))
  const context = ids(ACTIONS.filter(a => a.target === 'context'))
  const standalone = ids(ACTIONS.filter(a => a.target === 'none'))
  expect(only('[')).toEqual(selection)
  expect(only('[]')).toEqual(selection)
  expect(only('<')).toEqual(context)
  expect(only('<>')).toEqual(context)
  expect(only('{')).toEqual(standalone)
  expect(only('{}')).toEqual(standalone)
  expect(parseQuery('[ 要約')).toEqual({ words: ['要約'], target: 'selection' })
})

test('a mark with words: that kind and every word', () => {
  expect(only('[ 要約')).toEqual(['summarize', 'tldr'])
  expect(only('< 要約')).toEqual(['recap', 'recap-recent', 'summarize-last'])
  expect(only('{ 要約')).toEqual([])
  // The same mark twice is that kind still.
  expect(only('< <> 要約')).toEqual(['recap', 'recap-recent', 'summarize-last'])
})

test('marks of two kinds at once match nothing', () => {
  expect(parseQuery('[ <').target).toBe('conflict')
  expect(only('[ <')).toEqual([])
  expect(only('{} [] timer')).toEqual([])
})

test('a mark inside a word is text, not a kind', () => {
  expect(parseQuery('[要約').words).toEqual(['[要約'])
  expect(only('[要約')).toEqual([])
})

// ---------------------------------------------------------------------------
// Order

test('the order given is kept, an exact ID first', () => {
  // `code` is code's ID, and may be in other keys too: the exact one leads.
  const matched = only('code')
  expect(matched[0]).toBe('code')
  const rest = ids(ACTIONS).filter(id => matched.includes(id) && id !== 'code')
  expect(matched.slice(1)).toEqual(rest)

  const translate = only('translate-ja')
  expect(translate[0]).toBe('translate-ja')
  // Spaces and case around it: the same.
  expect(only('  Translate-JA ')[0]).toBe('translate-ja')
})

test('an exact ID behind others moves to the front; the others keep their order', () => {
  const defs: Searchable[] = [
    { id: 'summarize-all', label: 'A' },
    { id: 'x', label: 'summarize this' },
    { id: 'summarize', label: 'B' },
  ]
  expect(ids(filterActions(defs, 'summarize'))).toEqual(['summarize', 'summarize-all', 'x'])
  // The input is left as it was.
  expect(ids(defs)).toEqual(['summarize-all', 'x', 'summarize'])
})

// ---------------------------------------------------------------------------
// Cache and scale

test('a key is made once per object and kept', () => {
  const spec = byId('explain')
  const first = searchKey(spec)
  expect(searchKey(spec)).toBe(first)
  expect(first).toContain('explain')
  expect(first).toContain('意味')
  expect(first).toContain('選択')
})

test('300 actions: narrowed by their words alone, in their order', () => {
  const many: Searchable[] = Array.from({ length: 300 }, (_, i) => ({
    id: `act-${i}`,
    label: { ja: `アクション${i}`, en: `Action number ${i}` },
    target: i % 3 === 0 ? undefined : i % 3 === 1 ? 'context' : 'none',
  }))
  expect(filterActions(many, '')).toHaveLength(300)
  expect(ids(filterActions(many, 'act-29'))).toEqual(['act-29', ...['act-290', 'act-291', 'act-292', 'act-293', 'act-294', 'act-295', 'act-296', 'act-297', 'act-298', 'act-299']])
  expect(filterActions(many, '{')).toHaveLength(100)
  // Context (i % 3 === 1) and 15 in the ID or label: 115, 151, 154, 157.
  expect(ids(filterActions(many, 'あくしょん 15 <'))).toEqual(['act-115', 'act-151', 'act-154', 'act-157'])
  expect(filterActions(many, 'number 299')).toHaveLength(1)
})
