import { expect, test } from './kit'

import { ACTIONS, actionsFor } from '../hooks/actions'
import type { ActionDef, ActionSpec } from '../hooks/actions'
import { ADHOC_CHAIN_ID, CHAIN_ICON, adhocChain, baseDefinitions, chainDefinition, chainIdFree, composeProblem, cutLabel, prepareSave, stackProblem } from '../hooks/compose'
import { CHAIN_STEPS_MAX, ID_FORMAT, LABEL_MAX, parseCustomActions } from '../hooks/custom'

// The pure part of a chain put together on the spot (SELM-00128): what may be
// stacked and run, held to the rules of a chain written in the setting; the
// chain run, its target and argument its first step's; and the definition a
// save adds to customActions.

const defs = actionsFor('en')
const def = (id: string) => defs.find(d => d.id === id)!
const specs = new Map<string, ActionSpec>(ACTIONS.map(a => [a.id, a]))
const RESERVED = [...ACTIONS.map(a => a.id), 'close', 'hint', 'exec-approvals']
const CHAIN: ActionDef = { id: 'my-chain', icon: '🔗', label: 'Mine', kind: 'chain', steps: ['explain', 'summarize'], showSteps: false }

// ---------------------------------------------------------------------------
// stackProblem: at the time of stacking

test('stackProblem: any kind first; after it, actions on the selection alone', () => {
  for (const id of ['translate-ja', 'recap', 'gitignore-template']) expect(stackProblem([], def(id))).toBeUndefined()
  expect(stackProblem(['recap'], def('summarize'))).toBeUndefined()
  expect(stackProblem(['translate-ja'], def('recap'))).toEqual({ code: 'chainStepTarget', step: 2, id: 'recap' })
  expect(stackProblem(['translate-ja', 'summarize'], def('gitignore-template'))).toEqual({ code: 'chainStepTarget', step: 3, id: 'gitignore-template' })
})

test('stackProblem: a chain is never stacked (no nesting), first or not', () => {
  expect(stackProblem([], CHAIN)).toEqual({ code: 'chainNested', step: 1, id: 'my-chain' })
  expect(stackProblem(['explain'], CHAIN)).toEqual({ code: 'chainNested', step: 2, id: 'my-chain' })
})

test('stackProblem: up to eight; the ninth is refused', () => {
  const seven = Array.from({ length: 7 }, () => 'summarize')
  expect(stackProblem(seven, def('summarize'))).toBeUndefined()
  expect(stackProblem([...seven, 'summarize'], def('summarize'))).toEqual({ code: 'chainSteps', min: 2, max: CHAIN_STEPS_MAX })
})

// ---------------------------------------------------------------------------
// composeProblem: at the time of running

test('composeProblem: fewer than two or more than eight steps', () => {
  expect(composeProblem([], defs)).toEqual({ code: 'chainSteps', min: 2, max: 8 })
  expect(composeProblem(['explain'], defs)).toEqual({ code: 'chainSteps', min: 2, max: 8 })
  expect(composeProblem(['explain', 'summarize'], defs)).toBeUndefined()
  expect(composeProblem(Array.from({ length: 8 }, () => 'summarize'), defs)).toBeUndefined()
  expect(composeProblem(Array.from({ length: 9 }, () => 'summarize'), defs)).toEqual({ code: 'chainSteps', min: 2, max: 8 })
})

test('composeProblem: an ID no longer there (a reload), a chain, a step after the first not on the selection: as chainProblem says', () => {
  expect(composeProblem(['foo', 'summarize'], defs)).toEqual({ code: 'chainStepUnknown', step: 1, id: 'foo' })
  expect(composeProblem(['explain', 'my-chain'], [...defs, CHAIN])).toEqual({ code: 'chainNested', step: 2, id: 'my-chain' })
  expect(composeProblem(['explain', 'recap'], defs)).toEqual({ code: 'chainStepTarget', step: 2, id: 'recap' })
})

// ---------------------------------------------------------------------------
// adhocChain: the chain run

test('adhocChain: an ID no definition can take, the chain icon, the labels joined, every step shown', () => {
  const chain = adhocChain(['translate-ja', 'summarize'], defs)
  expect(ID_FORMAT.test(ADHOC_CHAIN_ID)).toBe(false)
  expect(chain).toEqual({ id: ADHOC_CHAIN_ID, icon: CHAIN_ICON, label: `${def('translate-ja').label} → ${def('summarize').label}`, kind: 'chain', steps: ['translate-ja', 'summarize'], showSteps: true })
  // In the other language, its labels.
  expect(adhocChain(['translate-ja', 'summarize'], actionsFor('ja')).label).toBe('日本語訳 → 要約')
  // An ID no longer there is shown as it is, nothing else read from it.
  expect(adhocChain(['foo', 'summarize'], defs).label).toBe(`foo → ${def('summarize').label}`)
})

test('adhocChain: its target and argument are its first step\'s; a fork\'s, none', () => {
  expect(adhocChain(['translate-ja', 'summarize'], defs).target).toBeUndefined()
  const context = adhocChain(['recap', 'summarize'], defs)
  expect([context.target, context.arg]).toEqual(['context', undefined])
  const standalone = adhocChain(['gitignore-template', 'summarize'], defs)
  expect(standalone.target).toBe('none')
  expect(standalone.arg?.default).toBe('node')
})

// ---------------------------------------------------------------------------
// The definition a save writes

test('chainIdFree: the first chain-N not taken', () => {
  expect(chainIdFree(new Set())).toBe('chain-1')
  expect(chainIdFree(new Set(['chain-1', 'chain-3']))).toBe('chain-2')
  expect(chainIdFree(new Set(['chain-1', 'chain-2']))).toBe('chain-3')
})

test('cutLabel: at most LABEL_MAX code points, an ellipsis at the end when cut', () => {
  expect(cutLabel('a'.repeat(LABEL_MAX))).toBe('a'.repeat(LABEL_MAX))
  const cut = cutLabel('😀'.repeat(LABEL_MAX + 5))
  expect([...cut]).toHaveLength(LABEL_MAX)
  expect(cut.endsWith('…')).toBe(true)
})

test('chainDefinition: its ID free, the chain icon, each language\'s labels joined, every step shown', () => {
  const record = chainDefinition(['translate-ja', 'summarize'], specs, new Set(['chain-1']))
  expect(record).toEqual({
    id: 'chain-2',
    icon: CHAIN_ICON,
    label: { ja: '日本語訳 → 要約', en: `${specs.get('translate-ja')!.label.en} → ${specs.get('summarize')!.label.en}` },
    kind: 'chain',
    steps: ['translate-ja', 'summarize'],
    showSteps: true,
  })
})

test('chainDefinition: labels past LABEL_MAX are cut, in both languages', () => {
  // The built-in whose labels are the longest (the shorter of the two languages'), eight times.
  const longest = [...ACTIONS].sort((a, b) => Math.min(b.label.ja.length, b.label.en.length) - Math.min(a.label.ja.length, a.label.en.length))[0]!
  const record = chainDefinition(Array.from({ length: 8 }, () => longest.id), specs, new Set())
  for (const label of [record.label.ja, record.label.en]) {
    expect([...label].length).toBeLessThanOrEqual(LABEL_MAX)
    expect(label.endsWith('…')).toBe(true)
  }
})

test('baseDefinitions: blank is none; a JSON array as it is; anything else undefined', () => {
  expect(baseDefinitions('')).toEqual([])
  expect(baseDefinitions('  ')).toEqual([])
  expect(baseDefinitions('[{"id":"a"}]')).toEqual([{ id: 'a' }])
  expect(baseDefinitions('{"id":"a"}')).toBeUndefined()
  expect(baseDefinitions('[{"id":')).toBeUndefined()
  expect(baseDefinitions('42')).toBeUndefined()
})

const MINE = { id: 'mine', icon: 'M', label: 'Mine', kind: 'complete', model: 'haiku', prompt: 'Do it.' }

test('prepareSave: the definitions there kept as they are, the chain added last, read back with it', () => {
  const setting = JSON.stringify([MINE])
  const r = prepareSave(setting, ['translate-ja', 'summarize'], specs, RESERVED, ACTIONS)
  expect(r.ok).toBe(true)
  if (!r.ok) return
  const written = JSON.parse(r.value) as unknown[]
  expect(written).toEqual([MINE, r.record])
  expect(r.record.id).toBe('chain-1')
  expect(parseCustomActions(r.value, RESERVED, ACTIONS).specs.map(s => s.id)).toEqual(['mine', 'chain-1'])
})

test('prepareSave: unset gives the chain alone; an ID taken there (even by a definition left out) is passed over', () => {
  const alone = prepareSave('', ['translate-ja', 'summarize'], specs, RESERVED, ACTIONS)
  expect(alone.ok && JSON.parse(alone.value)).toEqual([alone.ok && alone.record])
  const taken = prepareSave(JSON.stringify([{ id: 'chain-1', broken: true }]), ['translate-ja', 'summarize'], specs, RESERVED, ACTIONS)
  expect(taken.ok && taken.record.id).toBe('chain-2')
})

test('prepareSave: a setting that is not a JSON array is not overwritten', () => {
  for (const setting of ['{"id":"a"}', '[{"id":', 'nope']) {
    expect(prepareSave(setting, ['translate-ja', 'summarize'], specs, RESERVED, ACTIONS)).toEqual({ ok: false, refusal: { code: 'notArray' } })
  }
})

test('prepareSave: a chain the load would not keep is refused, with why (a step no longer there)', () => {
  expect(prepareSave('', ['foo', 'summarize'], specs, RESERVED, ACTIONS)).toEqual({
    ok: false,
    refusal: { code: 'invalid', reason: { code: 'chainStepUnknown', step: 1, id: 'foo' } },
  })
})
