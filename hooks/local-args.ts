// Helpers the standalone local actions share for reading their argument as
// register.tsx parsed it (./args) and for answering one they do not take.

import type { LocalOutput } from './actions'
import type { Lang } from './i18n'

/** A text in each language. */
export type Texts = Record<Lang, string>

/** `{ error }` for an argument the action does not take, saying what it takes. */
export const invalid = (lang: Lang, expected: Texts): LocalOutput => ({
  error: lang === 'ja' ? `引数が正しくありません: ${expected.ja}` : `Invalid argument: ${expected.en}`,
})

/** What an int argument from min to max is, for `invalid`. */
export const INT_TEXT = (min: number, max: number): Texts => ({ ja: `${min}〜${max} の整数`, en: `a whole number from ${min} to ${max}` })

/** Whether the argument is a whole number from min to max. */
export const isInt = (arg: unknown, min: number, max: number): arg is number =>
  typeof arg === 'number' && Number.isInteger(arg) && arg >= min && arg <= max

/** The argument as text: '' for none, undefined when it is no string. */
export const textOf = (arg: unknown): string | undefined => (arg === undefined ? '' : typeof arg === 'string' ? arg.trim() : undefined)
