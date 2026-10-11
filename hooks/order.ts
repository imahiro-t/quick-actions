// The order the hint line and the ⋯ dialog list the actions in, and the usage
// score it follows: pure functions over plain data, nothing here reaches `$`
// or throws. register.tsx reads and writes the score through `$.store`.
//
// One order for every kind of action, those on the selection, on the
// conversation and standalone, mixed: the actions the `actions` setting names
// (pinned, of any kind), in its order; then the rest by their usage score,
// highest first, a tie or an unused one keeping the order of definition
// (built-ins on the selection, built-ins on the conversation, built-in
// standalone ones, then custom ones). With no pin and no usage of any action
// that exists, the default set leads instead. arrange then lays that order out
// for the moment: with a selection, the actions on it come before the others
// (the pins still first); with none, they are left out.
// Each use adds 1 to the action's score, and a score halves every 30 days, so
// the order follows what the person uses lately.

import { DEFAULT_ACTION_IDS, needsSelection } from './actions'
import type { Target } from './actions'

/** A score halves over this long (30 days). */
export const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

/** The key in `$.store` the usage scores are kept under. */
export const USAGE_KEY = 'usage'

/** An action's score as of `at` (ms since the epoch), when it was last updated. */
export type UsageEntry = { score: number; at: number }

/** The usage scores by action ID. An ID no action has any more is kept, and read by nothing. */
export type Usage = Record<string, UsageEntry>

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The usage held in the store, checked: anything that is not an object gives
 * none, and an entry whose score (finite, not negative) or time (finite) is
 * not usable is dropped. Never throws.
 */
export function parseUsage(raw: unknown): Usage {
  const usage: Usage = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return usage
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object') continue
    const { score, at } = entry as Record<string, unknown>
    if (!isFiniteNumber(score) || score < 0 || !isFiniteNumber(at)) continue
    usage[id] = { score, at }
  }
  return usage
}

/** The entry's score decayed to `now`; 0 for none. A clock that went back decays nothing. */
export function decayed(entry: UsageEntry | undefined, now: number): number {
  if (entry === undefined) return 0
  const elapsed = Math.max(0, now - entry.at)
  return entry.score * 0.5 ** (elapsed / HALF_LIFE_MS)
}

/** The usage with one more use of `id` at `now`: its decayed score plus 1. The others are kept as they are. */
export function recordUse(usage: Usage, id: string, now: number): Usage {
  return { ...usage, [id]: { score: decayed(usage[id], now) + 1, at: now } }
}

/** The IDs a comma-separated setting names: trimmed and lowercased, empty ones left out. */
export const settingIds = (setting: unknown): string[] =>
  (typeof setting === 'string' ? setting : '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s !== '')

/** The definitions the IDs name, in their order: unknown IDs and repeats skipped. */
export function pickActions<D extends { id: string }>(defs: readonly D[], ids: readonly string[]): D[] {
  const byId = new Map(defs.map(d => [d.id, d] as const))
  const seen = new Set<string>()
  const out: D[] = []
  for (const id of ids) {
    const def = byId.get(id)
    if (def === undefined || seen.has(id)) continue
    seen.add(id)
    out.push(def)
  }
  return out
}

/**
 * The actions the `actions` setting pins to the front, in its order. Unlike
 * the hint line of old, nothing stands in when it names none: no pins.
 */
export const parsePins = <D extends { id: string }>(defs: readonly D[], setting: unknown): D[] =>
  pickActions(defs, settingIds(setting))

/**
 * Every definition, in the order the hint line (its first N) and the ⋯ dialog
 * (all of them) show: the pins first, in their order; then the rest by their
 * decayed score, highest first, ties in the order of `defs`. With no pins and
 * no score above 0 among `defs`, the IDs of `defaultIds` that exist lead, the
 * rest in the order of `defs`. A score kept for an ID not in `defs` is never
 * read.
 */
export function orderActions<D extends { id: string }>(
  defs: readonly D[],
  pins: readonly D[],
  usage: Usage,
  now: number,
  defaultIds: readonly string[] = DEFAULT_ACTION_IDS,
): D[] {
  const scores = new Map(defs.map(d => [d.id, decayed(usage[d.id], now)] as const))
  const lead = defaultsLead(defs, pins, usage, now) ? pickActions(defs, defaultIds) : pickActions(defs, pins.map(p => p.id))
  const leading = new Set(lead.map(d => d.id))
  const rest = defs
    .map((d, index) => ({ d, index, score: scores.get(d.id) ?? 0 }))
    .filter(({ d }) => !leading.has(d.id))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ d }) => d)
  return [...lead, ...rest]
}

/**
 * Whether the default set leads the order (see orderActions): no pins, and no
 * score above 0 among `defs`.
 */
export function defaultsLead(defs: readonly { id: string }[], pins: readonly unknown[], usage: Usage, now: number): boolean {
  return pins.length === 0 && !defs.some(d => decayed(usage[d.id], now) > 0)
}

/**
 * The settled order laid out for the hint line (its first N) and the ⋯ dialog
 * (all of it), as the selection stands. With a selection (selected now, or
 * held by `hint` or the dialog): the pins of any kind, in their order; then
 * the rest of the actions on the selection; then the rest of the others (on
 * the conversation and standalone, mixed), each in the order given. With
 * none: the same less the actions on the selection.
 *
 * `defaults` is the default set when it leads the order (no pins and no usage
 * yet; else none): with a selection it is laid out first, its actions on the
 * selection before its others, and the rest after it as above. So a first
 * selection shows the default set's actions on it and then its context
 * actions ([💡] [🌐] [📝] [🔎] <🧭> <✅>), rather than every action on the
 * selection before any other; with none, its context and standalone actions
 * lead (<🧭> <✅> {⏳}).
 */
export function arrange<D extends { id: string; target?: Target }>(
  ordered: readonly D[],
  pins: readonly { id: string }[],
  hasSelection: boolean,
  defaults: readonly { id: string }[] = [],
): D[] {
  const free = (d: D) => !needsSelection(d)
  const byKind = (list: readonly D[]) => [...list.filter(d => needsSelection(d)), ...list.filter(free)]
  const pinned = pickActions(ordered, pins.map(p => p.id))
  const lead = [...pinned, ...pickActions(ordered, defaults.map(p => p.id)).filter(d => !pinned.includes(d))]
  const leading = new Set(lead.map(d => d.id))
  const rest = ordered.filter(d => !leading.has(d.id))
  const leadDefaults = lead.slice(pinned.length)
  if (!hasSelection) return [...pinned.filter(free), ...leadDefaults.filter(free), ...rest.filter(free)]
  return [...pinned, ...byKind(leadDefaults), ...byKind(rest)]
}

/** Where one load keeps the order it settles: register makes a fresh one per load. */
export type OrderSlot = { pending?: Promise<readonly string[]> }

/**
 * The order kept in `slot`, started by `compute` the first time it is asked
 * for: every later or concurrent ask answers what that one settles to. A
 * settling an earlier load started lands in that load's slot alone, so it is
 * never a later load's order.
 */
export function settleIn(slot: OrderSlot, compute: () => Promise<readonly string[]>): Promise<readonly string[]> {
  return (slot.pending ??= compute())
}

/**
 * Which actions the hint line shows: those on the selection, those on the
 * conversation (context) or the standalone ones, switched by the buttons at
 * its start.
 */
export type HintKind = 'selection' | 'context' | 'standalone'

/** The hint line's kinds, in the order their buttons are drawn. */
export const HINT_KINDS: readonly HintKind[] = ['selection', 'context', 'standalone']

/** Whether an action of `def`'s target is of `kind`. */
export const isOfKind = (def: { target?: Target }, kind: HintKind): boolean =>
  kind === 'selection' ? needsSelection(def) : kind === 'context' ? def.target === 'context' : def.target === 'none'

/** The actions of `kind` among `defs`, in their order. */
export const ofKind = <D extends { target?: Target }>(defs: readonly D[], kind: HintKind): D[] => defs.filter(d => isOfKind(d, kind))

/**
 * The kind the hint line shows: the one the person switched to while it is
 * up (`chosen`), else the selection's when there is text to run on and the
 * conversation's when there is none. The selection's needs text: without it,
 * the conversation's.
 */
export function hintKindFor(chosen: HintKind | null, hasText: boolean): HintKind {
  const kind = chosen ?? (hasText ? 'selection' : 'context')
  return kind === 'selection' && !hasText ? 'context' : kind
}
