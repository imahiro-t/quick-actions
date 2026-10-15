// Chains put together on the spot (SELM-00128): the hint line's ⛓ mode and
// the ⋯ dialog's multi-select stack actions one after another, run them as a
// chain (kind `chain`, through runChain in ./register, the same way as a chain
// the person wrote), and the result pane saves one as a custom action.
//
// Everything here is pure: what may be stacked and run (held to the rules of
// a chain written in the setting, ./custom chainProblem), the chain run (its
// target and argument its first step's, ./custom withFirstTarget), and the
// definition a save appends to the person's own customActions. register.tsx
// reads the state and the settings, and hands them here.

import { needsSelection } from './actions'
import type { ActionDef, ActionSpec, BuiltinSpec, ChainAction, Target } from './actions'
import { CHAIN_STEPS_MAX, CHAIN_STEPS_MIN, LABEL_MAX, chainProblem, displaySafe, parseCustomActions, withFirstTarget } from './custom'
import type { CustomReason } from './custom'
import type { Lang, Localized } from './i18n'

/**
 * The ID of a chain put together on the spot as it runs: not one a
 * definition may take (./custom ID_FORMAT has no `_`), so it never meets a
 * custom action's, and it is never counted as a use, pinned or gated.
 */
export const ADHOC_CHAIN_ID = '_chain'

/**
 * The icon of the ⛓ button, of a chain put together on the spot and of one
 * saved from it: ⛓ (U+26D3, text by default) with VS16, so the engine counts
 * it two cells, as the terminal draws it (see ./actions emojiIcon).
 */
export const CHAIN_ICON = '⛓️'

/** What a step put on the stack is known by: its ID, its kind and what it works on. */
type Stackable = { id: string; kind: string; target?: Target }

/**
 * Why `next` may not be stacked after `steps` (the IDs stacked so far), as a
 * chain written in the setting would be refused: a chain (no nesting:
 * chainNested), a ninth step (chainSteps), or, after the first, an action
 * not on the selection (chainStepTarget). Undefined when it may.
 */
export function stackProblem(steps: readonly string[], next: Stackable): CustomReason | undefined {
  const step = steps.length + 1
  if (next.kind === 'chain') return { code: 'chainNested', step, id: displaySafe(next.id) }
  if (steps.length >= CHAIN_STEPS_MAX) return { code: 'chainSteps', min: CHAIN_STEPS_MIN, max: CHAIN_STEPS_MAX }
  if (steps.length > 0 && !needsSelection(next)) return { code: 'chainStepTarget', step, id: displaySafe(next.id) }
  return undefined
}

/**
 * Why the steps stacked may not run as a chain, now, among `defs` (the
 * load's definitions): fewer than two or more than eight (chainSteps), then
 * each step as ./custom chainProblem checks a chain written in the setting
 * (a chain, one no longer there after a reload, one after the first not on
 * the selection). Undefined when they may.
 */
export function composeProblem(steps: readonly string[], defs: readonly { id: string; kind: string; target?: Target }[]): CustomReason | undefined {
  if (steps.length < CHAIN_STEPS_MIN || steps.length > CHAIN_STEPS_MAX) return { code: 'chainSteps', min: CHAIN_STEPS_MIN, max: CHAIN_STEPS_MAX }
  const pool = new Map<string, { target?: Target }>()
  const chains = new Set<string>()
  for (const def of defs) {
    if (def.kind === 'chain') chains.add(def.id)
    else if (!pool.has(def.id)) pool.set(def.id, def)
  }
  return chainProblem({ steps }, pool, chains)
}

/** The label of a chain of steps with these labels: joined by an arrow (the callers put an unknown step's ID, shown safe, in its place). */
const joinedLabel = (labels: readonly string[]) => labels.join(' → ')

/**
 * The chain the steps stacked run as (and as which its entry is drawn again
 * from them): ADHOC_CHAIN_ID, CHAIN_ICON, the steps' labels joined, every
 * step's output shown (showSteps), and what its first step works on, with
 * its argument (./custom withFirstTarget).
 */
export function adhocChain(steps: readonly string[], defs: readonly ActionDef[]): ChainAction {
  const byId = new Map<string, ActionDef>()
  for (const def of defs) if (!byId.has(def.id)) byId.set(def.id, def)
  const chain: ChainAction = {
    id: ADHOC_CHAIN_ID,
    icon: CHAIN_ICON,
    label: joinedLabel(steps.map(id => byId.get(id)?.label ?? displaySafe(id))),
    kind: 'chain',
    steps: [...steps],
    showSteps: true,
  }
  const first = steps[0] === undefined ? undefined : byId.get(steps[0])
  return first === undefined ? chain : withFirstTarget(chain, first)
}

/** `text` cut to `max` code points at most, its end an ellipsis when cut. */
export function cutLabel(text: string, max = LABEL_MAX): string {
  const points = [...text]
  return points.length <= max ? text : `${points.slice(0, max - 1).join('')}…`
}

/** The ID a saved chain takes: the first of `chain-1`, `chain-2`, ... not in `taken`. */
export function chainIdFree(taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `chain-${n}`
    if (!taken.has(id)) return id
  }
}

/** A chain definition as a save writes it into customActions. */
export type ChainRecord = { id: string; icon: string; label: Localized; kind: 'chain'; steps: string[]; showSteps: true }

/**
 * The definition a chain of `steps` is saved as: its ID free of `taken`
 * (chainIdFree), CHAIN_ICON, its label in both languages (each step's label
 * in that language joined, cut to LABEL_MAX), every step's output shown.
 * `specs` are the load's definitions by ID, both languages in each.
 */
export function chainDefinition(steps: readonly string[], specs: ReadonlyMap<string, ActionSpec>, taken: ReadonlySet<string>): ChainRecord {
  const labelIn = (lang: Lang) => cutLabel(joinedLabel(steps.map(id => specs.get(id)?.label[lang] ?? displaySafe(id))))
  return { id: chainIdFree(taken), icon: CHAIN_ICON, label: { ja: labelIn('ja'), en: labelIn('en') }, kind: 'chain', steps: [...steps], showSteps: true }
}

/**
 * The definitions of a customActions setting as written (the person's own
 * text): blank or unset, none; a JSON array, its items as they are; anything
 * else (not JSON, not an array), undefined: a save would overwrite it.
 */
export function baseDefinitions(setting: string): unknown[] | undefined {
  if (setting.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(setting)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Why a save is refused before anything is written, as ./i18n words it. */
export type SaveRefusal =
  /** The setting is not a JSON array: a save would overwrite it. */
  | { code: 'notArray' }
  /** The setting with the chain added is not read back with it: why (./custom). */
  | { code: 'invalid'; reason: CustomReason }

/**
 * What a save of a chain of `steps` writes into customActions, from the
 * person's own text (`setting`): every definition there kept as it is (the
 * text written anew as JSON), the chain's (chainDefinition) added last, with
 * an ID none of `reserved` and none there takes. Then read back as the load
 * reads it (./custom parseCustomActions, `reserved` and `builtins`), which
 * must keep the chain: else refused, with why.
 */
export function prepareSave(
  setting: string,
  steps: readonly string[],
  specs: ReadonlyMap<string, ActionSpec>,
  reserved: readonly string[],
  builtins: readonly BuiltinSpec[],
): { ok: true; value: string; record: ChainRecord } | { ok: false; refusal: SaveRefusal } {
  const base = baseDefinitions(setting)
  if (base === undefined) return { ok: false, refusal: { code: 'notArray' } }
  const taken = new Set<string>(reserved)
  for (const d of base) {
    if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
      const id = (d as Record<string, unknown>)['id']
      if (typeof id === 'string') taken.add(id)
    }
  }
  const record = chainDefinition(steps, specs, taken)
  const value = JSON.stringify([...base, record])
  const read = parseCustomActions(value, reserved, builtins)
  if (!read.specs.some(spec => spec.id === record.id)) {
    const problem = read.problems.find(p => p.id === record.id)
    return { ok: false, refusal: { code: 'invalid', reason: problem?.reason ?? { code: 'unexpected', detail: record.id } } }
  }
  return { ok: true, value, record }
}
