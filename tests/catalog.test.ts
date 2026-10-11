import { expect, test } from 'claude-code/testing'

import { ACTIONS, isContext, isStandalone, resolveSpec, translateInto } from '../hooks/actions'
import { CATALOG_METHODS, CATEGORIES, buildCatalog, kindOfTarget } from '../hooks/catalog'
import type { Catalog } from '../hooks/catalog'
import { MESSAGES } from '../hooks/i18n'
// The committed catalog data, a classic script that sets QUICK_ACTIONS_CATALOG
// (what docs/index.html reads; written by scripts/gen-catalog.mjs).
import '../docs/actions-data.js'

const REGENERATE = 'docs/actions-data.js differs from hooks/actions.ts: run `node scripts/gen-catalog.mjs` (Node 24 or later) and commit the result'

const committed = (globalThis as { QUICK_ACTIONS_CATALOG?: Catalog }).QUICK_ACTIONS_CATALOG

const targetOf = (def: { target?: string }) => def.target ?? 'selection'

// A built-in with no category, a category not in CATEGORIES, or no summary in
// either language is left out of the catalog: each must be filled in.
test('every built-in names a category in CATEGORIES and has a summary in both languages', () => {
  const ids = new Set(CATEGORIES.map(c => c.id))
  const unsorted = ACTIONS.filter(a => a.category === undefined || !ids.has(a.category)).map(a => a.id)
  expect(unsorted).toEqual([])
  const undescribed = ACTIONS.filter(
    a => typeof a.summary?.ja !== 'string' || a.summary.ja.trim() === '' || typeof a.summary?.en !== 'string' || a.summary.en.trim() === '',
  ).map(a => a.id)
  expect(undescribed).toEqual([])
})

test("an action's kind is its category's", () => {
  const byId = new Map(CATEGORIES.map(c => [c.id, c]))
  const mismatched = ACTIONS.filter(a => targetOf(byId.get(a.category ?? '') ?? {}) !== targetOf(a)).map(a => a.id)
  expect(mismatched).toEqual([])
})

test('the categories are unique, none is empty, and they come in the kinds’ order', () => {
  const ids = CATEGORIES.map(c => c.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const c of CATEGORIES) expect(ACTIONS.some(a => a.category === c.id)).toBe(true)
  const rank = { selection: 0, context: 1, none: 2 } as const
  const ranks = CATEGORIES.map(c => rank[c.target])
  expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
  // The actions of a category are defined together, and the categories in their order.
  const order = ACTIONS.map(a => ids.indexOf(a.category ?? ''))
  expect(order).toEqual([...order].sort((x, y) => x - y))
})

test('the categories hold as many actions of each kind as the README says', () => {
  const count = (target: string) => {
    const cats = CATEGORIES.filter(c => c.target === target)
    return [cats.length, ACTIONS.filter(a => cats.some(c => c.id === a.category)).length]
  }
  expect(count('selection')).toEqual([10, 104])
  expect(count('context')).toEqual([8, 102])
  expect(count('none')).toEqual([13, 105])
})

test('category and summary stay out of the resolved definitions', () => {
  for (const spec of ACTIONS) {
    for (const lang of ['ja', 'en'] as const) {
      const def = resolveSpec(spec, lang) as Record<string, unknown>
      expect('category' in def).toBe(false)
      expect('summary' in def).toBe(false)
    }
  }
})

test('translateInto puts its action in the translation category with the summary given', () => {
  const summary = { ja: 'テスト用', en: 'For the test' }
  const spec = translateInto('translate-xx', '🧪', { ja: 'X', en: 'X' }, 'X', summary)
  expect(spec.category).toBe('translation')
  expect(spec.summary).toStrictEqual(summary)
})

test('buildCatalog lists every built-in once, in order, with its categories and kinds', () => {
  const catalog = buildCatalog()
  expect(catalog.total).toBe(ACTIONS.length)
  expect(catalog.actions.map(a => a.id)).toEqual(ACTIONS.map(a => a.id))
  expect(catalog.methods).toEqual(['complete', 'fork', 'subagent', 'local'])
  expect(catalog.methods).toEqual([...CATALOG_METHODS])
  expect(catalog.categories.map(c => c.id)).toEqual(CATEGORIES.map(c => c.id))
  expect(catalog.categories.flatMap(c => c.ids).sort()).toEqual(ACTIONS.map(a => a.id).sort())
  for (const c of catalog.categories) {
    expect(c.kind).toBe(kindOfTarget(CATEGORIES.find(x => x.id === c.id)?.target))
    expect(c.ids.length).toBeGreaterThan(0)
  }
  expect(catalog.kinds.map(k => k.id)).toEqual(['selection', 'context', 'standalone'])
  for (const k of catalog.kinds) {
    expect(k.name).toEqual({ ja: MESSAGES.ja.hintKinds[k.id], en: MESSAGES.en.hintKinds[k.id] })
    expect(k.tip).toEqual({ ja: MESSAGES.ja.hintKindTips[k.id], en: MESSAGES.en.hintKindTips[k.id] })
  }
})

test("each catalog entry carries the definition's texts, its kind, method, model and argument hint", () => {
  const catalog = buildCatalog()
  ACTIONS.forEach((spec, i) => {
    const a = catalog.actions[i]
    if (a === undefined) throw new Error(`no catalog entry for ${spec.id}`)
    expect(a.label).toEqual({ ja: spec.label.ja, en: spec.label.en })
    expect(a.summary).toEqual({ ja: spec.summary?.ja, en: spec.summary?.en })
    expect(a.category).toBe(spec.category)
    expect(a.method).toBe(spec.kind)
    expect(a.kind).toBe(isContext(spec) ? 'context' : isStandalone(spec) ? 'standalone' : 'selection')
    expect(a.icon.length).toBeGreaterThan(0)
    if (spec.kind === 'complete' || spec.kind === 'subagent') expect(a.model).toBe(spec.model)
    else expect('model' in a).toBe(false)
    const arg = isStandalone(spec) && spec.kind !== 'fork' ? spec.arg : undefined
    if (arg === undefined) expect('arg' in a).toBe(false)
    else expect(a.arg).toEqual({ ja: arg.hint.ja, en: arg.hint.en })
  })
  // Each method and the argument hint occur among the built-ins.
  for (const m of CATALOG_METHODS) expect(catalog.actions.some(a => a.method === m)).toBe(true)
  expect(catalog.actions.some(a => a.arg !== undefined)).toBe(true)
})

// The committed data must be what the definitions make now: change an action
// and forget to regenerate, and this fails.
test('docs/actions-data.js is what scripts/gen-catalog.mjs writes from the definitions now', () => {
  expect(committed, REGENERATE).toBeDefined()
  const now = buildCatalog()
  const stale = now.actions
    .filter((a, i) => JSON.stringify(a) !== JSON.stringify(committed?.actions[i]))
    .map(a => a.id)
  expect(stale, REGENERATE).toEqual([])
  expect(committed, REGENERATE).toEqual(now)
})
