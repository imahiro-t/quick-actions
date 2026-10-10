// The ⋯ dialog's filter, and the candidates an unknown ID is answered with:
// which actions a query matches. Pure functions, no engine: the dialog and
// the command in register.tsx call them.
//
// What is searched is the same in either display language: an action's ID,
// its label in both languages (a custom action's single label as it is), and
// the names of its kind in both. Pass the specs (ActionSpec, whose labels are
// `{ ja, en }`), never the definitions resolved for one language (ActionDef),
// whose labels hold that language's alone.

import type { Target } from './actions'
import type { Localized } from './i18n'

/** What a query is matched against: an action's ID, its label, its kind. */
export type Searchable = { id: string; label: string | Localized; target?: Target }

// The names of each kind, in both languages. The words a person might type
// for it: `コンテキスト` is the context actions' and, being part of
// `コンテキストなし`, the standalone ones' too.
const KIND_WORDS: Record<Target, readonly string[]> = {
  selection: ['選択', 'selection'],
  context: ['会話', 'コンテキスト', 'context'],
  none: ['単独', 'コンテキストなし', 'standalone', 'none'],
}

// The marks of the kinds, as the dialog's legend shows them: a word that is
// one of these narrows to that kind rather than matching text.
const KIND_MARKS: Readonly<Record<string, Target>> = {
  '[': 'selection',
  '[]': 'selection',
  '<': 'context',
  '<>': 'context',
  '{': 'none',
  '{}': 'none',
}

// Between the parts of a search key: no query word can hold it, so no word
// matches across two parts.
const SEPARATOR = '\u0000'

/** Full-width ASCII to half-width and the ideographic space to a space: NFKC's part that matters here, where there is no normalize. */
function widthFallback(s: string): string {
  return s.replace(/[！-～　]/g, c => (c === '　' ? ' ' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
}

/** What String.prototype.normalize is: called on the string, with the form. */
export type Normalize = (this: string, form: 'NFKC') => string

/**
 * NFKC through `normalize` (String.prototype.normalize unless given; null:
 * none), or widthFallback where there is none or it throws.
 */
export function toNfkc(s: string, normalize: Normalize | null = typeof s.normalize === 'function' ? s.normalize : null): string {
  if (typeof normalize === 'function') {
    try {
      const out = normalize.call(s, 'NFKC')
      if (typeof out === 'string') return out
    } catch {
      // Falls through to the fallback.
    }
  }
  return widthFallback(s)
}

/**
 * The form a key and a query are compared in: NFKC (full-width letters and
 * half-width kana made one), lowercase, katakana as hiragana. Never throws.
 * `normalize` stands in for String.prototype.normalize (null: an engine with
 * none), for a test; left out, that.
 */
export function normalizeForSearch(s: string, normalize?: Normalize | null): string {
  return toNfkc(s, normalize)
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

const kindOf = (a: { target?: Target }): Target => a.target ?? 'selection'

// One key per action object, made the first time it is searched: the specs of
// a load are made once, so their keys are too, and the key does not depend on
// the language, so one serves both. A reload makes new specs, and new keys.
const keys = new WeakMap<object, string>()

/** What a query is matched against for `a`, normalized: its ID, label(s) and kind names. Cached per object. */
export function searchKey(a: Searchable): string {
  const cached = keys.get(a)
  if (cached !== undefined) return cached
  const labels = typeof a.label === 'string' ? [a.label] : [a.label.ja, a.label.en]
  const key = normalizeForSearch([a.id, ...labels, ...KIND_WORDS[kindOf(a)]].join(SEPARATOR))
  keys.set(a, key)
  return key
}

/**
 * A query split into its words (normalized; split at half- and full-width
 * spaces) and the kind its marks narrow to. Marks of two kinds at once match
 * nothing (`conflict`): every word must hold, and no action is of both.
 */
export function parseQuery(query: string): { words: string[]; target?: Target | 'conflict' } {
  const words: string[] = []
  let target: Target | 'conflict' | undefined
  for (const word of normalizeForSearch(query).split(/[\s　]+/)) {
    if (word === '') continue
    const mark = KIND_MARKS[word]
    if (mark === undefined) words.push(word)
    else target = target === undefined || target === mark ? mark : 'conflict'
  }
  return target === undefined ? { words } : { words, target }
}

type Parsed = ReturnType<typeof parseQuery>

const matchesParsed = (a: Searchable, q: Parsed): boolean => {
  if (q.target === 'conflict') return false
  if (q.target !== undefined && kindOf(a) !== q.target) return false
  if (q.words.length === 0) return true
  const key = searchKey(a)
  return q.words.every(w => key.includes(w))
}

/** Whether `a` matches `query`: of the kind its marks name, and every word in its key. An empty query matches all. */
export function matchesFilter(a: Searchable, query: string): boolean {
  return matchesParsed(a, parseQuery(query))
}

/**
 * The actions of `defs` that match `query`, in their order there, but for one
 * whose ID is the whole query (normalized, spaces trimmed): that one first.
 * An empty query keeps them all. A new array; `defs` is left as it is.
 */
export function filterActions<D extends Searchable>(defs: readonly D[], query: string): D[] {
  const q = parseQuery(query)
  const shown = defs.filter(a => matchesParsed(a, q))
  const whole = normalizeForSearch(query).trim()
  if (whole === '') return shown
  const exact = shown.findIndex(a => normalizeForSearch(a.id) === whole)
  if (exact > 0) shown.unshift(...shown.splice(exact, 1))
  return shown
}
