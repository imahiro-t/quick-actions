// The order the hint line and the ⋯ dialog list the actions in, and the usage
// score it follows: pure functions over plain data, nothing here reaches `$`
// or throws. register.tsx reads and writes the score through `$.store`.
//
// The order: the actions the `actions` setting names (pinned), in its order;
// then the rest by their usage score, highest first, a tie or an unused one
// keeping the order of definition (built-ins, then custom ones). With no pin
// and no usage of any action that exists, the default set leads instead.
// Each use adds 1 to the action's score, and a score halves every 30 days, so
// the order follows what the person uses lately.

import { DEFAULT_ACTION_IDS } from './actions'

/** A score halves over this long (30 days). */
export const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

/** How many actions the hint line shows when `hintCount` is unset or not usable. */
export const DEFAULT_HINT_COUNT = 6

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
  const hasUsage = [...scores.values()].some(score => score > 0)
  const lead = pins.length === 0 && !hasUsage ? pickActions(defs, defaultIds) : pickActions(defs, pins.map(p => p.id))
  const leading = new Set(lead.map(d => d.id))
  const rest = defs
    .map((d, index) => ({ d, index, score: scores.get(d.id) ?? 0 }))
    .filter(({ d }) => !leading.has(d.id))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ d }) => d)
  return [...lead, ...rest]
}

/** The `hintCount` setting: a whole number of 1 or more (a number or its digits), else the default. */
export function parseHintCount(value: unknown): number {
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) n = Number(value.trim())
  else return DEFAULT_HINT_COUNT
  return Number.isSafeInteger(n) && n >= 1 ? n : DEFAULT_HINT_COUNT
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
