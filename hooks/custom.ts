// The person's own actions, from the `customActions` setting: a JSON array of
// definitions in the same shape as ACTIONS (see README). Each one is checked
// here; a valid one becomes an ActionSpec beside the built-ins, an invalid one
// is left out with the first reason found, and a setting that is not a JSON
// array leaves them all out. Nothing here throws, so the built-ins always run.
//
// The reasons are kept as data and put into words only when shown
// (problemLine), since the language is not known yet when the setting is read.

import { ACTIONS, ANSWER_LANGUAGE, READ_ONLY_TOOLS, STYLE, WEB_TOOLS, needsSelection } from './actions'
import type { ActionSpec, BuiltinSpec, ChainAction, Target } from './actions'
import type { ArgSpec } from './args'
import { EXEC_ARGS_MAX, EXEC_ARG_MAX, EXEC_TIMEOUT_DEFAULT_MS, EXEC_TIMEOUT_MAX_MS, EXEC_TIMEOUT_MIN_MS, isSafeExecPath } from './exec'
import { MESSAGES } from './i18n'
import type { Lang, Localized } from './i18n'

/** The tools a custom subagent may have: the read-only three, plus the web ones when asked for. */
export const ALLOWED_SUBAGENT_TOOLS: readonly string[] = [...READ_ONLY_TOOLS, ...WEB_TOOLS]

/** The models a custom complete or subagent action may name. */
export const MODELS: readonly string[] = ['haiku', 'sonnet', 'opus']

export const KINDS: readonly string[] = ['complete', 'fork', 'subagent', 'exec', 'chain']

/** The fewest and the most steps a chain may have. */
export const CHAIN_STEPS_MIN = 2
export const CHAIN_STEPS_MAX = 8

/**
 * The fields of the other kinds a chain definition may not have (`target`
 * among them: a chain's is its first step's). One there says its author meant
 * something else, so it is refused rather than run.
 */
export const NOT_CHAIN_FIELDS: readonly string[] = [
  'prompt',
  'model',
  'tools',
  'task',
  'maxTokens',
  'description',
  'command',
  'args',
  'timeoutMs',
  'target',
]

/**
 * The fields of the other kinds an exec definition may not have: one there
 * says its author meant another kind, so it is refused rather than run.
 */
export const NOT_EXEC_FIELDS: readonly string[] = ['prompt', 'model', 'tools', 'task', 'maxTokens', 'description']

/** What a custom action may work on: the selection (the default), the conversation, or neither (standalone). */
export const TARGETS: readonly string[] = ['selection', 'context', 'none']

/** The ID format, the same as the built-ins': lowercase letters and digits, joined by single hyphens. */
export const ID_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * The longest ID, in characters: the ID is the name a custom subagent is
 * registered under (`$.agent.register({ name })`), and a subagent's name is
 * limited to 64 characters.
 */
export const ID_MAX = 64

/** The longest icon, in code points: room for a ZWJ sequence (a family) or a flag's tag sequence. */
export const ICON_MAX = 16
/** The longest label, in code points (each language's, for `{ ja, en }`). */
export const LABEL_MAX = 64
/** The longest runningText, in code points (each language's). */
export const RUNNING_TEXT_MAX = 64
/** The longest description, in code points (each language's). */
export const DESCRIPTION_MAX = 500

/**
 * Characters the texts shown on screen (icon, label, runningText, description)
 * may not have: control characters (\p{Cc}: NUL, ESC, tab, newline, DEL and
 * the C1 ones; with ESC and U+009D refused, no escape sequence such as an OSC 8
 * hyperlink gets in), the bidirectional controls (U+061C, U+200E, U+200F,
 * U+202A to U+202E, U+2066 to U+2069) and the line and paragraph separators.
 * ZWJ (U+200D) and the variation selectors are not among them: emoji are made
 * of them.
 */
export const DISPLAY_FORBIDDEN = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029]/u
/** DISPLAY_FORBIDDEN, matching every occurrence (for displaySafe). */
const DISPLAY_FORBIDDEN_ALL = new RegExp(DISPLAY_FORBIDDEN.source, 'gu')

/**
 * The tools that hand a subagent the contents of files: Read, and Grep, whose
 * matches are the lines themselves. A subset of READ_ONLY_TOOLS; Glob is not
 * one, as it gives the paths alone.
 */
export const FILE_CONTENT_TOOLS: readonly string[] = ['Read', 'Grep']

/** The longest answer a custom complete action may ask for. */
export const MAX_TOKENS_LIMIT = 32_000

/** Why a definition, or the whole setting, was left out. */
export type CustomReason =
  | { code: 'json'; detail: string }
  | { code: 'notString' }
  | { code: 'notArray' }
  | { code: 'notObject' }
  | { code: 'idFormat' }
  | { code: 'idReserved' }
  | { code: 'idDuplicate' }
  | { code: 'tooLong'; field: string; max: number }
  /** `char` is written `U+001B`, so no raw control character reaches a list or a toast. */
  | { code: 'forbiddenChar'; field: string; char: string }
  | { code: 'missing'; field: string }
  | { code: 'invalid'; field: string }
  | { code: 'kind'; value: string; allowed: readonly string[] }
  | { code: 'model'; value: string; allowed: readonly string[] }
  | { code: 'tools'; names: string[]; allowed: readonly string[] }
  | { code: 'target'; value: string; allowed: readonly string[] }
  | { code: 'contextKind'; kind: string }
  | { code: 'noneKind'; kind: string }
  | { code: 'unexpected'; detail: string }
  // An exec definition (./exec). `path` is shown as is: hidden characters named, cut short.
  /** A command that is not an absolute path written as it lands (the definition's), or a path it lands on that no `env` can run (`realPath`). */
  | { code: 'execPath'; field: 'command' | 'realPath'; path: string }
  /** A field of another kind (NOT_EXEC_FIELDS) in an exec definition. */
  | { code: 'execField'; field: string }
  /** Not the person's own: see ./exec scopeVerdict. `name`, with `loader`: the variable (shown safe). */
  | { code: 'execScope'; why: 'unreadable' | 'keys' | 'mismatch' | 'home' | 'loader'; name?: string }
  /** The allowlist cannot be used: see ./exec allowlistPlace and allowlistOf (read by ./register loadAllowlist). */
  | { code: 'execAllowlist'; why: 'noHome' | 'missing' | 'unreadable' | 'invalid' | 'inProject' }
  /** An entry of the allowlist left out (its place, from 1). */
  | { code: 'execAllowlistEntry'; entry: number }
  /** The executable the command lands on is in no entry of the allowlist. */
  | { code: 'execNotAllowed'; path: string }
  /** The command leads to no regular file. */
  | { code: 'execMissing'; path: string }
  /** Exec actions do not run here (Windows). */
  | { code: 'execUnsupported' }
  // Found as an exec action is about to run.
  /** Too large to have its SHA-256 checked. */
  | { code: 'execTooLarge'; max: number }
  /** Its bytes could not be read to check its SHA-256. */
  | { code: 'execUnreadable'; path: string }
  /** Its SHA-256 is not the allowlist entry's. */
  | { code: 'execHashMismatch'; path: string }
  /** Not approved, and asked from where no approval can be given (not the person's terminal). */
  | { code: 'execRemote' }
  /** The approval was not given. */
  | { code: 'execDeclined' }
  /** The executable changed between its approval (or its check) and its start. */
  | { code: 'execChanged' }
  /** What it would be given on its standard input is past the limit (bytes). */
  | { code: 'execInputTooLarge'; max: number }
  /**
   * Asked from other than the person's own hand while execOrigin is terminal
   * (./exec originRestricted); `unreadable`: the user settings could not be
   * read to tell, which counts as terminal.
   */
  | { code: 'execOrigin'; unreadable?: true }
  /** Already `max` exec actions running in the session (./exec EXEC_CONCURRENT_MAX). */
  | { code: 'execBusy'; max: number }
  /** The running exec actions could not be counted (the slots not written): not run, the safe side. */
  | { code: 'execSlotFailed' }
  // A chain definition (kind `chain`). `step` is the step's place, from 1; `id` the ID as written (shown safe).
  /** `steps` not an array of `min` to `max` strings. */
  | { code: 'chainSteps'; min: number; max: number }
  /** A step that names no built-in and no valid custom definition (one left out counts as none). */
  | { code: 'chainStepUnknown'; step: number; id: string }
  /** A step that is a chain (itself included). */
  | { code: 'chainNested'; step: number; id: string }
  /** A step after the first that is not an action on the selection. */
  | { code: 'chainStepTarget'; step: number; id: string }
  /** A field of another kind (NOT_CHAIN_FIELDS) in a chain definition. */
  | { code: 'chainField'; field: string }
  // Found by the exec gate, or as a chain runs.
  /** An exec step the exec gate refused (`reason`): the chain is refused with it. */
  | { code: 'chainStepRejected'; step: number; id: string; reason: CustomReason }
  /** The settings were read again (the module reloaded) while the chain ran: its exec steps are not run. */
  | { code: 'chainReloaded' }
  /** The approval of an exec step was taken away (or changed) while the chain ran: not asked again there, not run. */
  | { code: 'execApprovalGone' }

/**
 * One problem with the setting: `index` is the definition's place in the array
 * (from 0) and `id` its ID, as written, when it has a string one; both are null
 * when the whole setting was left out. The ID is kept whole, for the command to
 * match; it is shortened only when shown (problemLine).
 */
export type CustomProblem = { index: number | null; id: string | null; reason: CustomReason }

/** What a kept definition allows that is worth knowing: a file-reading tool beside a web one (the tools as written). */
export type CustomWarningReason = { code: 'fileReadWithWeb'; read: string[]; web: string[] }

/** A definition kept as it is, with something to tell about it: its place in the array (from 0) and its ID. */
export type CustomWarning = { index: number; id: string; reason: CustomWarningReason }

export type CustomActions = { specs: ActionSpec[]; problems: CustomProblem[]; warnings: CustomWarning[] }

const NONE: CustomActions = { specs: [], problems: [], warnings: [] }

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

const absent = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** A code point as `U+XXXX` (four hex digits at least). */
const codePointName = (ch: string) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`

/**
 * `s` with every DISPLAY_FORBIDDEN character written as U+XXXX, so a value
 * from a definition (an id, a kind, a JSON error quoting the file) never puts
 * a raw control or bidirectional character into the problem list or a toast.
 */
export const displaySafe = (s: string): string => s.replace(DISPLAY_FORBIDDEN_ALL, codePointName)

/**
 * A value as the person wrote it, with displaySafe applied, short enough for
 * one line: at most 40 code units as is, or else at most 37 and "...".
 */
const shown = (v: unknown): string => {
  let s: string
  try {
    s = typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v))
  } catch {
    s = String(v)
  }
  // One piece per code point: its U+XXXX name when DISPLAY_FORBIDDEN, else itself.
  // Cutting only between pieces never leaves half a U+XXXX name or half a surrogate pair.
  const pieces = Array.from(s, ch => (DISPLAY_FORBIDDEN.test(ch) ? codePointName(ch) : ch))
  const whole = pieces.join('')
  if (whole.length <= 40) return whole
  let head = ''
  for (const piece of pieces) {
    if (head.length + piece.length > 37) break
    head += piece
  }
  return `${head}...`
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

/**
 * Checks one text shown on screen: no DISPLAY_FORBIDDEN character first (so a
 * long value with an escape in it is told for the escape), then no more than
 * `max` code points.
 */
const displayText = (field: string, value: string, max: number): void => {
  const bad = DISPLAY_FORBIDDEN.exec(value)
  if (bad !== null) fail({ code: 'forbiddenChar', field, char: codePointName(bad[0]) })
  // No more code points than code units: a value this short is within it.
  if (value.length > max && [...value].length > max) fail({ code: 'tooLong', field, max })
}

/** displayText on both languages of a text. */
const displayLocalized = (field: string, value: Localized, max: number): void => {
  displayText(field, value.ja, max)
  if (value.en !== value.ja) displayText(field, value.en, max)
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
  if (typeof v !== 'string' || !MODELS.includes(v)) fail({ code: 'model', value: shown(v), allowed: MODELS })
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
  if (refused.length > 0) fail({ code: 'tools', names: [...new Set(refused.map(shown))], allowed: ALLOWED_SUBAGENT_TOOLS })
  return [...new Set(list as string[])]
}

/** The definition's `target`: left out, null or blank is `selection`; a value not in TARGETS fails. */
const targetOf = (d: Record<string, unknown>): Target => {
  const v = d['target']
  if (absent(v)) return 'selection'
  if (typeof v !== 'string' || !TARGETS.includes(v)) fail({ code: 'target', value: shown(v), allowed: TARGETS })
  return v as Target
}

/**
 * The argument of a custom standalone action: always an optional free text,
 * since a custom definition declares no argument of its own.
 */
const CUSTOM_ARG: ArgSpec<Localized> = {
  type: 'text',
  hint: { ja: MESSAGES.ja.customArgHint, en: MESSAGES.en.customArgHint },
}

/**
 * An exec definition, checked as written (./exec checks the rest as it is
 * shown and run): no field of another kind; `command` an absolute path
 * written as it lands (isSafeExecPath); `args` up to EXEC_ARGS_MAX strings of
 * up to EXEC_ARG_MAX, none with a NUL, taken as they are; `timeoutMs` a whole
 * number of milliseconds within its bounds; any target. Called within
 * parseOne, so it fails as the others do.
 */
function parseExec(d: Record<string, unknown>, base: { id: string; icon: string; label: Localized; runningText?: Localized }): ActionSpec {
  const other = NOT_EXEC_FIELDS.find(f => d[f] !== undefined)
  if (other !== undefined) fail({ code: 'execField', field: other })
  if (absent(d['command'])) fail({ code: 'missing', field: 'command' })
  const command = d['command']
  if (!isSafeExecPath(command)) fail({ code: 'execPath', field: 'command', path: shown(command) })
  const args = d['args'] ?? []
  if (
    !Array.isArray(args) ||
    args.length > EXEC_ARGS_MAX ||
    !args.every(a => typeof a === 'string' && a.length <= EXEC_ARG_MAX && !a.includes('\0'))
  ) {
    fail({ code: 'invalid', field: 'args' })
  }
  const timeoutMs = d['timeoutMs'] ?? EXEC_TIMEOUT_DEFAULT_MS
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < EXEC_TIMEOUT_MIN_MS || timeoutMs > EXEC_TIMEOUT_MAX_MS) {
    fail({ code: 'invalid', field: 'timeoutMs' })
  }
  const target = targetOf(d)
  return {
    ...base,
    kind: 'exec',
    ...(target === 'selection' ? {} : { target }),
    ...(target === 'none' ? { arg: CUSTOM_ARG } : {}),
    command: command as string,
    args: [...(args as string[])],
    timeoutMs: timeoutMs as number,
  }
}

/**
 * A chain definition as written: no field of another kind (NOT_CHAIN_FIELDS);
 * `steps` an array of CHAIN_STEPS_MIN to CHAIN_STEPS_MAX strings; `showSteps`
 * a boolean, false when left out. What its steps name is checked once every
 * definition is read (chainProblem), so it may name one written after it.
 * Called within parseOne, so it fails as the others do.
 */
function parseChain(d: Record<string, unknown>, base: { id: string; icon: string; label: Localized; runningText?: Localized }): ActionSpec {
  const other = NOT_CHAIN_FIELDS.find(f => d[f] !== undefined)
  if (other !== undefined) fail({ code: 'chainField', field: other })
  const steps = d['steps']
  if (steps === undefined || steps === null) fail({ code: 'missing', field: 'steps' })
  if (
    !Array.isArray(steps) ||
    steps.length < CHAIN_STEPS_MIN ||
    steps.length > CHAIN_STEPS_MAX ||
    !steps.every(step => typeof step === 'string')
  ) {
    fail({ code: 'chainSteps', min: CHAIN_STEPS_MIN, max: CHAIN_STEPS_MAX })
  }
  const showSteps = d['showSteps'] ?? false
  if (typeof showSteps !== 'boolean') fail({ code: 'invalid', field: 'showSteps' })
  return { ...base, kind: 'chain', steps: [...(steps as string[])], showSteps: showSteps as boolean }
}

/**
 * Why the chain `chain` may not be kept, by what its steps name: `steps` are
 * the actions a step may be (the built-ins and the valid custom definitions
 * that are not chains), `chains` the IDs of every chain read (valid or not,
 * itself included), none of which a step may be. Each step in order: a
 * chain (chainNested), else one that is not there (chainStepUnknown), else,
 * after the first, one not on the selection (chainStepTarget). Undefined when
 * every step is fine. Shared with the chains put together on the spot
 * (./compose), so both are held to the same rules.
 */
export function chainProblem(
  chain: { steps: readonly string[] },
  steps: ReadonlyMap<string, { target?: Target }>,
  chains: ReadonlySet<string>,
): CustomReason | undefined {
  for (const [i, id] of chain.steps.entries()) {
    const step = i + 1
    if (chains.has(id)) return { code: 'chainNested', step, id: shown(id) }
    const def = steps.get(id)
    if (def === undefined) return { code: 'chainStepUnknown', step, id: shown(id) }
    if (i > 0 && !needsSelection(def)) return { code: 'chainStepTarget', step, id: shown(id) }
  }
  return undefined
}

/**
 * A chain whose steps are fine, with what its first step works on: its
 * `target` (left out for the selection), and, standalone, its argument.
 */
export function withFirstTarget<T>(chain: ChainAction<T>, first: { target?: Target; kind: string; arg?: ArgSpec<T> }): ChainAction<T> {
  const { target: _t, arg: _a, ...rest } = chain
  if (first.target === undefined || first.target === 'selection') return rest
  if (first.target === 'context') return { ...rest, target: 'context' }
  const arg = first.kind === 'fork' ? undefined : first.arg
  return { ...rest, target: 'none', ...(arg === undefined ? {} : { arg }) }
}

/** One definition checked against the IDs already taken; the first reason found if it is not valid. */
function parseOne(d: unknown, taken: ReadonlySet<string>, reserved: ReadonlySet<string>): ActionSpec | CustomReason {
  try {
    if (!isRecord(d)) return fail({ code: 'notObject' })
    if (absent(d['id'])) fail({ code: 'missing', field: 'id' })
    const id = d['id']
    // Before the format, so a huge ID is told for its length without a match run over it.
    if (typeof id === 'string' && id.length > ID_MAX) fail({ code: 'tooLong', field: 'id', max: ID_MAX })
    if (typeof id !== 'string' || !ID_FORMAT.test(id)) fail({ code: 'idFormat' })
    if (reserved.has(id as string)) fail({ code: 'idReserved' })
    if (taken.has(id as string)) fail({ code: 'idDuplicate' })

    const icon = required(d, 'icon')
    displayText('icon', icon, ICON_MAX)
    const label = requiredText(d, 'label')
    displayLocalized('label', label, LABEL_MAX)
    const runningText = optionalText(d, 'runningText')
    if (runningText !== undefined) displayLocalized('runningText', runningText, RUNNING_TEXT_MAX)
    if (absent(d['kind'])) fail({ code: 'missing', field: 'kind' })
    const kind = d['kind']
    if (typeof kind !== 'string' || !KINDS.includes(kind)) fail({ code: 'kind', value: shown(kind), allowed: KINDS })
    const base = { id: id as string, icon, label, ...(runningText === undefined ? {} : { runningText }) }
    if (kind === 'exec') return parseExec(d, base)
    if (kind === 'chain') return parseChain(d, base)
    const prompt = required(d, 'prompt')
    const target = targetOf(d)
    const context = target === 'context'
    // A context action works on the conversation, which only a fork of the session knows.
    if (context && kind !== 'fork') fail({ code: 'contextKind', kind: kind as string })
    // A standalone one has no conversation to carry: never a fork.
    if (target === 'none' && kind === 'fork') fail({ code: 'noneKind', kind: kind as string })
    const standalone = target === 'none' ? { target: 'none' as const, arg: CUSTOM_ARG } : {}

    if (kind === 'fork') {
      const forkPrompt = withoutStyle(prompt)
      if (forkPrompt === '') fail({ code: 'missing', field: 'prompt' })
      return context
        ? { ...base, kind: 'fork', target: 'context', prompt: forkPrompt }
        : { ...base, kind: 'fork', prompt: forkPrompt }
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
        ...standalone,
        kind: 'complete',
        model: m,
        prompt: withStyle(prompt),
        ...(maxTokens === undefined ? {} : { maxTokens: maxTokens as number }),
      }
    }

    const task = required(d, 'task')
    const description = optionalText(d, 'description')
    if (description !== undefined) displayLocalized('description', description, DESCRIPTION_MAX)
    const allowed = tools(d)
    return {
      ...base,
      ...standalone,
      kind: 'subagent',
      model: m,
      prompt: withStyle(prompt),
      task,
      ...(description === undefined ? {} : { description }),
      ...(allowed === undefined ? {} : { tools: allowed }),
    }
  } catch (err) {
    if (err instanceof Invalid) return err.reason
    // Not expected; still never thrown out of here, and not told as some other reason.
    return { code: 'unexpected', detail: shown(err instanceof Error ? err.message : err) }
  }
}

/**
 * The warning a kept definition earns, if any: a subagent allowed one of
 * FILE_CONTENT_TOOLS and one of WEB_TOOLS could send what it reads out. Not
 * refused (its author may mean it), only told. With no `tools`, a subagent
 * has the read-only three alone, so it earns none; nor does Glob with the web.
 */
function warningOf(spec: ActionSpec): CustomWarningReason | undefined {
  if (spec.kind !== 'subagent' || spec.tools === undefined) return undefined
  const read = spec.tools.filter(t => FILE_CONTENT_TOOLS.includes(t))
  const web = spec.tools.filter(t => WEB_TOOLS.includes(t))
  return read.length > 0 && web.length > 0 ? { code: 'fileReadWithWeb', read, web } : undefined
}

/**
 * The custom actions in the setting, what was wrong with it, and what is
 * worth knowing about the definitions kept (`warnings`). `reservedIds`
 * are the IDs a custom one may not take (the built-ins', `close` and `hint`);
 * `builtins` the built-ins a chain's step may name (ACTIONS when left out).
 * An unset or blank setting gives nothing and no problem; any other value that
 * is not a string (an array written in settings.json without quoting it, say)
 * leaves them all out and says so. Never throws.
 *
 * Read in two passes: every definition first, as before (an ID taken by the
 * first that has it, a chain's included, whatever comes of it after); then
 * what each chain's steps name, against the built-ins and the custom
 * definitions kept that are not chains, wherever they are written. A chain
 * refused there is told at its own place among the problems.
 */
export function parseCustomActions(setting: unknown, reservedIds: readonly string[], builtins: readonly BuiltinSpec[] = ACTIONS): CustomActions {
  if (setting === undefined || setting === null) return NONE
  if (typeof setting !== 'string') {
    return { specs: [], problems: [{ index: null, id: null, reason: { code: 'notString' } }], warnings: [] }
  }
  if (setting.trim() === '') return NONE

  let parsed: unknown
  try {
    parsed = JSON.parse(setting)
  } catch (err) {
    const detail = displaySafe(err instanceof Error ? err.message : String(err))
    return { specs: [], problems: [{ index: null, id: null, reason: { code: 'json', detail } }], warnings: [] }
  }
  if (!Array.isArray(parsed)) {
    return { specs: [], problems: [{ index: null, id: null, reason: { code: 'notArray' } }], warnings: [] }
  }

  const reserved = new Set(reservedIds)
  const taken = new Set<string>()
  const kept: { index: number; spec: ActionSpec }[] = []
  const problems: CustomProblem[] = []
  const warnings: CustomWarning[] = []
  parsed.forEach((d: unknown, index) => {
    const r = parseOne(d, taken, reserved)
    if ('code' in r) {
      const rawId = isRecord(d) && typeof d['id'] === 'string' ? d['id'] : null
      problems.push({ index, id: rawId, reason: r })
    } else {
      // First come, first served, as with an ID written twice in `pinActions`.
      taken.add(r.id)
      kept.push({ index, spec: r })
      const warning = warningOf(r)
      if (warning !== undefined) warnings.push({ index, id: r.id, reason: warning })
    }
  })

  // The second pass: what the chains' steps name.
  const chains = new Set(kept.flatMap(k => (k.spec.kind === 'chain' ? [k.spec.id] : [])))
  if (chains.size === 0) return { specs: kept.map(k => k.spec), problems, warnings }
  const stepPool = new Map<string, ActionSpec>()
  for (const b of builtins) stepPool.set(b.id, b)
  for (const k of kept) if (k.spec.kind !== 'chain' && !stepPool.has(k.spec.id)) stepPool.set(k.spec.id, k.spec)
  const specs: ActionSpec[] = []
  for (const k of kept) {
    if (k.spec.kind !== 'chain') {
      specs.push(k.spec)
      continue
    }
    const why = chainProblem(k.spec, stepPool, chains)
    if (why !== undefined) {
      problems.push({ index: k.index, id: k.spec.id, reason: why })
      continue
    }
    specs.push(withFirstTarget(k.spec, stepPool.get(k.spec.steps[0]!)!))
  }
  // In the order the definitions are written, the chains refused last among them.
  problems.sort((a, b) => (a.index ?? -1) - (b.index ?? -1))
  return { specs, problems, warnings }
}

/** Why a definition was left out, in the language. */
export const reasonText = (reason: CustomReason, lang: Lang) => MESSAGES[lang].customReason(reason)

/** One problem on one line: the definition's place (from 1) and ID, then why. */
export function problemLine(p: CustomProblem, lang: Lang): string {
  const why = reasonText(p.reason, lang)
  if (p.index === null) return why
  return `#${p.index + 1}${p.id === null ? '' : ` (${shown(p.id)})`}: ${why}`
}

/**
 * The problem that left out the custom definition with this ID, if any. `id` is
 * as the command names it (trimmed, lowercase), so the written ID is matched
 * the same way, whole: an ID with stray spaces or capitals still finds its reason.
 */
export const problemFor = (problems: readonly CustomProblem[], id: string): CustomProblem | undefined =>
  id === '' ? undefined : problems.find(p => p.id !== null && p.id.trim().toLowerCase() === id)

/**
 * The place (from 0) of the definition the custom action `id` was read from,
 * in the setting: the first object with that ID, as parseCustomActions keeps
 * the first. Null when it cannot be found (the setting is not that JSON).
 */
export function definitionIndex(setting: unknown, id: string): number | null {
  if (typeof setting !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(setting)
    if (!Array.isArray(parsed)) return null
    const i = parsed.findIndex(d => isRecord(d) && d['id'] === id)
    return i < 0 ? null : i
  } catch {
    return null
  }
}

/** One warning on one line: the definition's place (from 1) and ID, then what it allows. */
export const warningLine = (w: CustomWarning, lang: Lang): string =>
  `#${w.index + 1} (${shown(w.id)}): ${MESSAGES[lang].customWarning(w.reason)}`

/**
 * A command's result with the list of problems after it, then the list of
 * warnings, each under its own heading; as it is when there are neither.
 */
export function withNotices(
  text: string,
  notices: { problems: readonly CustomProblem[]; warnings: readonly CustomWarning[] },
  lang: Lang,
): string {
  const { problems, warnings } = notices
  if (problems.length === 0 && warnings.length === 0) return text
  const t = MESSAGES[lang]
  const lines = [text]
  if (problems.length > 0) lines.push('', t.customProblemsHeading, ...problems.map(p => `- ${problemLine(p, lang)}`))
  if (warnings.length > 0) lines.push('', t.customWarningsHeading, ...warnings.map(w => `- ${warningLine(w, lang)}`))
  return lines.join('\n')
}
