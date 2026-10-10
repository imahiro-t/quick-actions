// The person's own actions, from the `customActions` setting: a JSON array of
// definitions in the same shape as ACTIONS (see README). Each one is checked
// here; a valid one becomes an ActionSpec beside the built-ins, an invalid one
// is left out with the first reason found, and a setting that is not a JSON
// array leaves them all out. Nothing here throws, so the built-ins always run.
//
// The reasons are kept as data and put into words only when shown
// (problemLine), since the language is not known yet when the setting is read.

import { ANSWER_LANGUAGE, READ_ONLY_TOOLS, STYLE } from './actions'
import type { ActionSpec } from './actions'
import { MESSAGES } from './i18n'
import type { Lang, Localized } from './i18n'

/** The tools a custom subagent may have: the read-only three, plus the web ones when asked for. */
export const ALLOWED_SUBAGENT_TOOLS: readonly string[] = [...READ_ONLY_TOOLS, 'WebFetch', 'WebSearch']

/** The models a custom complete or subagent action may name. */
export const MODELS: readonly string[] = ['haiku', 'sonnet', 'opus']

export const KINDS: readonly string[] = ['complete', 'fork', 'subagent']

/** The ID format, the same as the built-ins': lowercase letters and digits, joined by single hyphens. */
export const ID_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The longest answer a custom complete action may ask for. */
export const MAX_TOKENS_LIMIT = 32_000

/** Why a definition, or the whole setting, was left out. */
export type CustomReason =
  | { code: 'json'; detail: string }
  | { code: 'notArray' }
  | { code: 'notObject' }
  | { code: 'idFormat' }
  | { code: 'idReserved' }
  | { code: 'idDuplicate' }
  | { code: 'missing'; field: string }
  | { code: 'invalid'; field: string }
  | { code: 'kind'; value: string }
  | { code: 'model'; value: string }
  | { code: 'tools'; names: string[] }

/**
 * One problem with the setting: `index` is the definition's place in the array
 * (from 0) and `id` its ID when it has a string one; both are null when the
 * whole setting was left out.
 */
export type CustomProblem = { index: number | null; id: string | null; reason: CustomReason }

export type CustomActions = { specs: ActionSpec[]; problems: CustomProblem[] }

const NONE: CustomActions = { specs: [], problems: [] }

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

const absent = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** A value as the person wrote it, short enough for one line. */
const shown = (v: unknown): string => {
  let s: string
  try {
    s = typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v))
  } catch {
    s = String(v)
  }
  return s.length > 40 ? `${s.slice(0, 37)}...` : s
}

/** A text in both languages: one string for both, or `{ ja, en }` with both filled in. */
const localized = (v: unknown): Localized | undefined => {
  if (filled(v)) return { ja: v, en: v }
  if (isRecord(v) && filled(v['ja']) && filled(v['en'])) return { ja: v['ja'], en: v['en'] }
  return undefined
}

// Thrown inside parseOne only, to stop at the first reason; caught there.
class Invalid {
  constructor(readonly reason: CustomReason) {}
}
const fail = (reason: CustomReason): never => {
  throw new Invalid(reason)
}

const required = (d: Record<string, unknown>, field: string): string => {
  const v = d[field]
  if (absent(v)) fail({ code: 'missing', field })
  if (!filled(v)) fail({ code: 'invalid', field })
  return v as string
}

const requiredText = (d: Record<string, unknown>, field: string): Localized => {
  if (absent(d[field])) fail({ code: 'missing', field })
  return localized(d[field]) ?? fail({ code: 'invalid', field })
}

const optionalText = (d: Record<string, unknown>, field: string): Localized | undefined =>
  d[field] === undefined ? undefined : (localized(d[field]) ?? fail({ code: 'invalid', field }))

const model = (d: Record<string, unknown>): string => {
  if (absent(d['model'])) fail({ code: 'missing', field: 'model' })
  const v = d['model']
  if (typeof v !== 'string' || !MODELS.includes(v)) fail({ code: 'model', value: shown(v) })
  return v as string
}

/** The answer language for complete and subagent: their prompt gets STYLE unless it already says how. */
const withStyle = (prompt: string) =>
  prompt.includes(STYLE) || prompt.includes(ANSWER_LANGUAGE) ? prompt : `${prompt} ${STYLE}`

/** A fork gets the answer style at run time, so a STYLE in its prompt would say it twice: it goes. */
const withoutStyle = (prompt: string) =>
  prompt
    .split(STYLE)
    .map(part => part.trim())
    .filter(part => part !== '')
    .join(' ')

const tools = (d: Record<string, unknown>): string[] | undefined => {
  const v = d['tools']
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length === 0) fail({ code: 'invalid', field: 'tools' })
  const list = v as unknown[]
  const refused = list.filter(t => typeof t !== 'string' || !ALLOWED_SUBAGENT_TOOLS.includes(t))
  // One tool outside the list voids the whole definition: dropping it quietly
  // would run something other than what its author wrote.
  if (refused.length > 0) fail({ code: 'tools', names: [...new Set(refused.map(shown))] })
  return [...new Set(list as string[])]
}

/** One definition checked against the IDs already taken; the first reason found if it is not valid. */
function parseOne(d: unknown, taken: ReadonlySet<string>, reserved: ReadonlySet<string>): ActionSpec | CustomReason {
  try {
    if (!isRecord(d)) return fail({ code: 'notObject' })
    if (absent(d['id'])) fail({ code: 'missing', field: 'id' })
    const id = d['id']
    if (typeof id !== 'string' || !ID_FORMAT.test(id)) fail({ code: 'idFormat' })
    if (reserved.has(id as string)) fail({ code: 'idReserved' })
    if (taken.has(id as string)) fail({ code: 'idDuplicate' })

    const icon = required(d, 'icon')
    const label = requiredText(d, 'label')
    const runningText = optionalText(d, 'runningText')
    if (absent(d['kind'])) fail({ code: 'missing', field: 'kind' })
    const kind = d['kind']
    if (typeof kind !== 'string' || !KINDS.includes(kind)) fail({ code: 'kind', value: shown(kind) })
    const prompt = required(d, 'prompt')
    const base = { id: id as string, icon, label, ...(runningText === undefined ? {} : { runningText }) }

    if (kind === 'fork') {
      const forkPrompt = withoutStyle(prompt)
      if (forkPrompt === '') fail({ code: 'missing', field: 'prompt' })
      return { ...base, kind: 'fork', prompt: forkPrompt }
    }

    const m = model(d)
    if (kind === 'complete') {
      const maxTokens = d['maxTokens']
      if (
        maxTokens !== undefined &&
        (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_LIMIT)
      ) {
        fail({ code: 'invalid', field: 'maxTokens' })
      }
      return {
        ...base,
        kind: 'complete',
        model: m,
        prompt: withStyle(prompt),
        ...(maxTokens === undefined ? {} : { maxTokens: maxTokens as number }),
      }
    }

    const task = required(d, 'task')
    const description = optionalText(d, 'description')
    const allowed = tools(d)
    return {
      ...base,
      kind: 'subagent',
      model: m,
      prompt: withStyle(prompt),
      task,
      ...(description === undefined ? {} : { description }),
      ...(allowed === undefined ? {} : { tools: allowed }),
    }
  } catch (err) {
    if (err instanceof Invalid) return err.reason
    // Not expected; still never thrown out of here.
    return { code: 'notObject' }
  }
}

/**
 * The custom actions in the setting, and what was wrong with it. `reservedIds`
 * are the IDs a custom one may not take (the built-ins' and `close`). An unset
 * or blank setting gives nothing and no problem. Never throws.
 */
export function parseCustomActions(setting: unknown, reservedIds: readonly string[]): CustomActions {
  if (typeof setting !== 'string' || setting.trim() === '') return NONE

  let parsed: unknown
  try {
    parsed = JSON.parse(setting)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { specs: [], problems: [{ index: null, id: null, reason: { code: 'json', detail } }] }
  }
  if (!Array.isArray(parsed)) {
    return { specs: [], problems: [{ index: null, id: null, reason: { code: 'notArray' } }] }
  }

  const reserved = new Set(reservedIds)
  const taken = new Set<string>()
  const specs: ActionSpec[] = []
  const problems: CustomProblem[] = []
  parsed.forEach((d: unknown, index) => {
    const r = parseOne(d, taken, reserved)
    if ('code' in r) {
      const rawId = isRecord(d) && typeof d['id'] === 'string' ? d['id'] : null
      problems.push({ index, id: rawId === null ? null : shown(rawId), reason: r })
    } else {
      // First come, first served, as with an ID written twice in `actions`.
      taken.add(r.id)
      specs.push(r)
    }
  })
  return { specs, problems }
}

/** Why a definition was left out, in the language. */
export const reasonText = (reason: CustomReason, lang: Lang) => MESSAGES[lang].customReason(reason)

/** One problem on one line: the definition's place (from 1) and ID, then why. */
export function problemLine(p: CustomProblem, lang: Lang): string {
  const why = reasonText(p.reason, lang)
  if (p.index === null) return why
  return `#${p.index + 1}${p.id === null ? '' : ` (${p.id})`}: ${why}`
}

/** The problem that left out the custom definition with this ID (as a command names it), if any. */
export const problemFor = (problems: readonly CustomProblem[], id: string): CustomProblem | undefined =>
  id === '' ? undefined : problems.find(p => p.id !== null && p.id.toLowerCase() === id)

/** A command's result with the list of problems after it, or as it is when there are none. */
export function withProblems(text: string, problems: readonly CustomProblem[], lang: Lang): string {
  if (problems.length === 0) return text
  const t = MESSAGES[lang]
  return [text, '', t.customProblemsHeading, ...problems.map(p => `- ${problemLine(p, lang)}`)].join('\n')
}
