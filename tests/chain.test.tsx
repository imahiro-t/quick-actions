import { expect, test } from './kit'

import { ACTIONS } from '../hooks/actions'
import type { ActionSpec, ChainAction } from '../hooks/actions'
import { CHAIN_STEPS_MAX, CHAIN_STEPS_MIN, NOT_CHAIN_FIELDS, parseCustomActions, problemLine } from '../hooks/custom'
import type { CustomReason } from '../hooks/custom'
import { chainExecSteps } from '../hooks/exec'
import { MESSAGES } from '../hooks/i18n'
import type { Localized } from '../hooks/i18n'
import { JAPANESE } from './stage'

// Chains (kind `chain`, SELM-00123) as the setting is read: what a valid one
// becomes (its target and argument from its first step), and every way one
// is left out, each with its reason. Running them is tests/chain-run.test.tsx.

const RESERVED = [...ACTIONS.map(a => a.id), 'close', 'hint', 'exec-approvals']
const parse = (defs: unknown[]) => parseCustomActions(JSON.stringify(defs), RESERVED)

const ASK = { id: 'mine', icon: 'A', label: 'Ask', kind: 'complete', model: 'haiku', prompt: 'p' }
const ALONE = { id: 'alone', icon: 'L', label: 'Alone', kind: 'complete', model: 'haiku', prompt: 'p', target: 'none' }
const SAVE = { id: 'save', icon: 'S', label: 'Save', kind: 'exec', command: '/Users/me/bin/save.sh' }
const chainOf = (steps: unknown, more: Record<string, unknown> = {}) => ({ id: 'flow', icon: '🔗', label: { ja: '連結', en: 'Flow' }, kind: 'chain', steps, ...more })

const specOf = (specs: readonly ActionSpec[], id: string) => specs.find(s => s.id === id) as ChainAction<Localized> | undefined

/** The one problem of a setting, as its reason. */
function reasonOf(defs: unknown[]): CustomReason | undefined {
  const r = parse(defs)
  const flow = r.problems.find(p => p.id === 'flow')
  return flow?.reason
}

// ---------------------------------------------------------------------------
// Valid chains

test('a chain of built-ins: kept as written, showSteps false by default, on the selection', () => {
  const r = parse([chainOf(['translate-ja', 'summarize'])])
  expect(r.problems).toEqual([])
  const flow = specOf(r.specs, 'flow')
  expect(flow).toEqual({ id: 'flow', icon: '🔗', label: { ja: '連結', en: 'Flow' }, kind: 'chain', steps: ['translate-ja', 'summarize'], showSteps: false })
  expect(flow?.target).toBeUndefined()
})

test('a chain of custom definitions, one written after it, with showSteps', () => {
  const r = parse([ASK, chainOf(['mine', 'save', 'translate-en'], { showSteps: true }), SAVE])
  expect(r.problems).toEqual([])
  expect(r.specs.map(s => s.id)).toEqual(['mine', 'flow', 'save'])
  expect(specOf(r.specs, 'flow')?.showSteps).toBe(true)
  // The same step twice is fine.
  expect(parse([ASK, chainOf(['mine', 'mine'])]).problems).toEqual([])
})

test(`${CHAIN_STEPS_MIN} and ${CHAIN_STEPS_MAX} steps are both kept`, () => {
  expect(parse([chainOf(Array(CHAIN_STEPS_MIN).fill('summarize'))]).problems).toEqual([])
  expect(parse([chainOf(Array(CHAIN_STEPS_MAX).fill('summarize'))]).problems).toEqual([])
})

// ---------------------------------------------------------------------------
// The target, from the first step

test('the target is the first step\'s: the conversation for a context action', () => {
  const flow = specOf(parse([chainOf(['recap', 'summarize'])]).specs, 'flow')
  expect(flow?.target).toBe('context')
  expect(flow?.arg).toBeUndefined()
})

test('a standalone first step makes the chain standalone, taking its argument: a built-in\'s own', () => {
  const timerArg = ACTIONS.find(a => a.id === 'uuid' || a.id === 'timer')
  expect(timerArg).toBeDefined()
  const flow = specOf(parse([chainOf(['timer', 'summarize'])]).specs, 'flow')
  expect(flow?.target).toBe('none')
  const timer = ACTIONS.find(a => a.id === 'timer')!
  expect(flow?.arg).toEqual(timer.kind === 'fork' ? undefined : timer.arg)
})

test('a standalone custom first step: the free text argument every custom standalone one takes', () => {
  const r = parse([ALONE, chainOf(['alone', 'summarize'])])
  const alone = r.specs.find(s => s.id === 'alone')!
  const flow = specOf(r.specs, 'flow')
  expect(flow?.target).toBe('none')
  expect(flow?.arg).toEqual(alone.kind === 'fork' ? undefined : alone.arg)
  expect(flow?.arg?.hint).toEqual({ ja: MESSAGES.ja.customArgHint, en: MESSAGES.en.customArgHint })
})

test('an exec first step on the conversation: the chain is on the conversation', () => {
  const r = parse([{ ...SAVE, target: 'context' }, chainOf(['save', 'summarize'])])
  expect(specOf(r.specs, 'flow')?.target).toBe('context')
})

// ---------------------------------------------------------------------------
// Invalid chains, each with its reason

test('steps not an array of 2 to 8 strings: chainSteps', () => {
  const steps = { code: 'chainSteps', min: CHAIN_STEPS_MIN, max: CHAIN_STEPS_MAX }
  expect(reasonOf([chainOf(['summarize'])])).toEqual(steps)
  expect(reasonOf([chainOf(Array(CHAIN_STEPS_MAX + 1).fill('summarize'))])).toEqual(steps)
  expect(reasonOf([chainOf([])])).toEqual(steps)
  expect(reasonOf([chainOf('summarize,translate-ja')])).toEqual(steps)
  expect(reasonOf([chainOf(['summarize', 3])])).toEqual(steps)
  expect(reasonOf([chainOf(['summarize', { id: 'x', kind: 'complete' }])])).toEqual(steps)
  // Left out: missing.
  const { steps: _s, ...none } = chainOf([])
  expect(reasonOf([none])).toEqual({ code: 'missing', field: 'steps' })
})

test('a step that names nothing valid: chainStepUnknown, with its place', () => {
  expect(reasonOf([chainOf(['summarize', 'nope'])])).toEqual({ code: 'chainStepUnknown', step: 2, id: 'nope' })
  // A custom definition left out for its own mistake is none.
  expect(reasonOf([{ ...ASK, model: 'gpt' }, chainOf(['mine', 'summarize'])])).toEqual({ code: 'chainStepUnknown', step: 1, id: 'mine' })
  // The reserved words are no actions.
  for (const id of ['close', 'hint', 'exec-approvals']) expect(reasonOf([chainOf(['summarize', id])])).toEqual({ code: 'chainStepUnknown', step: 2, id })
  // A hidden character in it is named.
  expect(reasonOf([chainOf(['summarize', 'a\u001bb'])])).toEqual({ code: 'chainStepUnknown', step: 2, id: 'aU+001Bb' })
})

test('a chain as a step, itself or another, valid or not: chainNested', () => {
  expect(reasonOf([chainOf(['summarize', 'flow'])])).toEqual({ code: 'chainNested', step: 2, id: 'flow' })
  const other = { ...chainOf(['summarize', 'translate-ja']), id: 'other' }
  expect(reasonOf([other, chainOf(['other', 'summarize'])])).toEqual({ code: 'chainNested', step: 1, id: 'other' })
  // Another chain that is itself refused is still a chain.
  const broken = { ...chainOf(['summarize', 'nope']), id: 'other' }
  expect(reasonOf([chainOf(['summarize', 'other']), broken])).toEqual({ code: 'chainNested', step: 2, id: 'other' })
  // Two chains naming each other: both refused, no loop.
  const a = { ...chainOf(['summarize', 'b']), id: 'a' }
  const b = { ...chainOf(['summarize', 'a']), id: 'b' }
  const r = parse([a, b])
  expect(r.specs).toEqual([])
  expect(r.problems.map(p => p.reason.code)).toEqual(['chainNested', 'chainNested'])
})

test('a step after the first not on the selection: chainStepTarget', () => {
  expect(reasonOf([chainOf(['summarize', 'recap'])])).toEqual({ code: 'chainStepTarget', step: 2, id: 'recap' })
  expect(reasonOf([chainOf(['summarize', 'timer'])])).toEqual({ code: 'chainStepTarget', step: 2, id: 'timer' })
  expect(reasonOf([ALONE, chainOf(['summarize', 'translate-ja', 'alone'])])).toEqual({ code: 'chainStepTarget', step: 3, id: 'alone' })
  expect(reasonOf([{ ...SAVE, target: 'context' }, chainOf(['summarize', 'save'])])).toEqual({ code: 'chainStepTarget', step: 2, id: 'save' })
})

test('a field of another kind: chainField, the definition left out', () => {
  for (const field of NOT_CHAIN_FIELDS) {
    expect(reasonOf([chainOf(['summarize', 'translate-ja'], { [field]: field === 'args' ? [] : 'x' })])).toEqual({ code: 'chainField', field })
  }
  expect(NOT_CHAIN_FIELDS).toEqual(expect.arrayContaining(['prompt', 'model', 'command', 'target']))
})

test('showSteps not a boolean: invalid', () => {
  for (const showSteps of ['yes', 1, 'true', {}]) {
    expect(reasonOf([chainOf(['summarize', 'translate-ja'], { showSteps })])).toEqual({ code: 'invalid', field: 'showSteps' })
  }
})

test('the common checks come first, as for every kind: the ID, the icon, the label', () => {
  expect(parse([{ ...chainOf(['summarize', 'translate-ja']), id: 'summarize' }]).problems[0]?.reason).toEqual({ code: 'idReserved' })
  expect(reasonOf([{ ...chainOf(['summarize', 'translate-ja']), icon: '' }])).toEqual({ code: 'missing', field: 'icon' })
})

test('a chain refused for its steps is told at its own place among the problems, and keeps its ID', () => {
  const r = parse([{ ...ASK, id: 'bad', model: 'gpt' }, chainOf(['summarize', 'nope']), { ...ASK, prompt: '' }, { ...ASK, id: 'flow' }, ASK])
  expect(r.problems.map(p => [p.index, p.reason.code])).toEqual([
    [0, 'model'],
    [1, 'chainStepUnknown'],
    [2, 'missing'],
    [3, 'idDuplicate'],
  ])
  expect(r.specs.map(s => s.id)).toEqual(['mine'])
})

// ---------------------------------------------------------------------------
// The exec steps, and the reasons in words

test('chainExecSteps: the exec steps, their places from 1 and their IDs', () => {
  const r = parse([ASK, SAVE, chainOf(['mine', 'save', 'translate-ja', 'save'])])
  const flow = specOf(r.specs, 'flow')!
  expect(chainExecSteps(flow, r.specs)).toEqual([
    { step: 2, id: 'save' },
    { step: 4, id: 'save' },
  ])
  expect(chainExecSteps({ steps: ['mine', 'summarize'] }, r.specs)).toEqual([])
})

test('every chain reason in both languages, English with no Japanese, a step\'s place and ID named', () => {
  const reasons: CustomReason[] = [
    { code: 'chainSteps', min: 2, max: 8 },
    { code: 'chainStepUnknown', step: 2, id: 'nope' },
    { code: 'chainNested', step: 1, id: 'other' },
    { code: 'chainStepTarget', step: 3, id: 'recap' },
    { code: 'chainField', field: 'prompt' },
    { code: 'chainStepRejected', step: 2, id: 'save', reason: { code: 'execNotAllowed', path: '/x' } },
    { code: 'chainReloaded' },
    { code: 'execApprovalGone' },
  ]
  for (const reason of reasons) {
    for (const lang of ['ja', 'en'] as const) {
      const text = MESSAGES[lang].customReason(reason)
      expect(text.length).toBeGreaterThan(0)
      if (lang === 'en') expect(text).not.toMatch(JAPANESE)
      if ('id' in reason) expect(text).toContain(reason.id)
      if ('step' in reason) expect(text).toContain(String(reason.step))
    }
  }
  // The exec reason inside is told too.
  expect(MESSAGES.en.customReason(reasons[5]!)).toContain(MESSAGES.en.customReason({ code: 'execNotAllowed', path: '/x' }))
  // As a problem line: the place and the ID first.
  const r = parse([chainOf(['summarize', 'nope'])])
  expect(problemLine(r.problems[0]!, 'en')).toBe(`#1 (flow): ${MESSAGES.en.customReason({ code: 'chainStepUnknown', step: 2, id: 'nope' })}`)
})

test('the chain messages in both languages', () => {
  for (const lang of ['ja', 'en'] as const) {
    const t = MESSAGES[lang]
    expect(t.chainStep(2, 3, 'Sum')).toContain('2/3')
    expect(t.chainStep(2, 3, 'Sum')).toContain('Sum')
    expect(t.chainStepFailed(2, 3, 'Sum', 'boom')).toContain('boom')
    for (const text of [t.chainLocalEffect, t.chainLocalTicker, t.chainEmptyOutput, t.chainOutputCut]) expect(text.length).toBeGreaterThan(0)
  }
  for (const text of [MESSAGES.en.chainLocalEffect, MESSAGES.en.chainLocalTicker, MESSAGES.en.chainEmptyOutput, MESSAGES.en.chainOutputCut, MESSAGES.en.chainStepFailed(1, 2, 'x', 'y')]) {
    expect(text).not.toMatch(JAPANESE)
  }
})
