// Custom actions of kind `exec`: a local executable of the person's own, run
// with no shell, what it works on written to its standard input, its standard
// output shown in the pane (see README).
//
// The setting can come from a project's .claude/settings.json, which a cloned
// repository brings along, so nothing written there may run a command. An
// exec action runs only when all of these hold:
//
// - its definition is the person's own: the merged `customActions` is the
//   very text of their user settings (~/.claude/settings.json), and no
//   project, local or flag settings move HOME or set a variable the dynamic
//   loader reads (LD_*, DYLD_*), which could reach `/usr/bin/env` itself
//   (scopeVerdict);
// - the executable it lands on, every symbolic link followed, is written
//   exactly so in the allowlist of their home (ALLOWLIST_RELATIVE), never one in
//   the session's project, with its SHA-256 matching when the entry has one;
// - they approved that path, its fixed arguments and its SHA-256 once, at
//   their terminal (the approval is kept in the plugin's own $.store, which no
//   setting can write); anything of the three changed asks again.
//
// - with `execOrigin: terminal` in the person's user settings, it is asked
//   from their own hand: a press at the terminal or the command typed at the
//   prompt (originRestricted), approved or not;
// - fewer than EXEC_CONCURRENT_MAX exec actions are running in the session
//   (takeSlot).
//
// A layer of defence beside these: a /config change from other than the
// person (another plugin's $.config.set, the bridge) may neither take
// execOrigin off terminal (weakensExecOrigin) nor add or alter an exec
// definition in customActions (addsExecDefinition), which would land in the
// user settings and so pass scopeVerdict; register.tsx's config.set hook
// refuses it.
//
// It then runs through `/usr/bin/env -i` (the environment cut down to a few
// variables), in the home directory, with a timeout, its output cut at a limit
// and its hidden characters escaped as a model's answer's are. Each run is
// kept in a short history ($.store, HISTORY_KEY): when, which action, what ran
// and how it ended, never what it was given or what it wrote.
// `/quick-actions exec-approvals` lists the approvals and the history, and
// revokes approvals (approvalsListText).
//
// Everything here is pure (the checks, the argument vector, the texts) and
// tested on its own: register.tsx reads the settings and the files, as only
// it may hand `$` on, and these judge what it read.

import { base64Decode } from './codec'
import type { ActionSpec } from './actions'
import type { CustomReason } from './custom'
import { MESSAGES } from './i18n'
import type { Lang } from './i18n'
import { showHiddenNoted } from './selection-local'
import { sha256 } from './sha'
import type { ExecSlot } from '../types'

/** How long an exec action may run when its definition says nothing, in milliseconds. */
export const EXEC_TIMEOUT_DEFAULT_MS = 30_000
/** The shortest timeout a definition may ask for. */
export const EXEC_TIMEOUT_MIN_MS = 1_000
/** The longest timeout a definition may ask for. */
export const EXEC_TIMEOUT_MAX_MS = 120_000
/** The most of the standard output shown, in UTF-16 code units: past it, cut and said so. */
export const EXEC_OUTPUT_MAX = 100_000
/** The most of the standard error shown with a failure, in UTF-16 code units. */
export const EXEC_STDERR_MAX = 4_000
/** The most written to the standard input, in UTF-8 bytes (1 MiB). */
export const EXEC_STDIN_MAX = 1_048_576
/** The longest path a definition may name, in UTF-16 code units. */
export const EXEC_PATH_MAX = 4_096
/** The most fixed arguments a definition may have. */
export const EXEC_ARGS_MAX = 32
/** The longest fixed argument, in UTF-16 code units. */
export const EXEC_ARG_MAX = 4_096
/** The largest executable whose SHA-256 can be checked: what $.fs.read reads at most (4 MiB). */
export const EXEC_FILE_MAX = 4 * 1024 * 1024

/** The allowlist's place under the home directory. */
export const ALLOWLIST_RELATIVE = '.claude/quick-actions/allowed-executables.json'
/** What runs every exec action, with `-i`: it starts the executable with only the variables given. */
export const ENV_BIN = '/usr/bin/env'
/** The PATH the executable is given: the system's directories alone. */
export const EXEC_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
/** The $.store key the approvals are kept under, by action ID. */
export const APPROVALS_KEY = 'execApprovals'

/**
 * The settings sources other than the person's own whose `env` may set
 * neither HOME nor a variable of the dynamic loader (LOADER_VARIABLE).
 */
export const HOME_SOURCES = ['project', 'local', 'flag'] as const

/**
 * The variables the dynamic loader reads (LD_PRELOAD, LD_LIBRARY_PATH,
 * DYLD_INSERT_LIBRARIES and the like): set in a settings' `env`, they may
 * reach `/usr/bin/env` itself as Claude Code starts it, before `-i` clears
 * anything. Capitals only, as the loaders read them.
 */
export const LOADER_VARIABLE = /^(LD_|DYLD_)/

/** The first name in `env` that LOADER_VARIABLE matches; undefined when none does. */
export const loaderVariable = (env: Readonly<Record<string, unknown>>): string | undefined =>
  Object.keys(env).find(name => LOADER_VARIABLE.test(name))

// Control characters (NUL, ESC, newline, DEL, the C1 ones), the bidirectional
// controls and the line and paragraph separators: none may be in a path, so
// none can hide what the approval shows or break the argument vector.
const PATH_FORBIDDEN = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029]/u
const SHA256_FORMAT = /^[0-9a-fA-F]{64}$/

/**
 * Whether `path` may name an executable: absolute, written as it lands (no
 * `.` or `..` part, no `//`, no `/` at its end), with no `=` (`env` would take
 * it for a variable) and none of PATH_FORBIDDEN, and at most EXEC_PATH_MAX
 * long. A command (as written), the path it lands on and an allowlist entry
 * are all checked by this one rule.
 */
export function isSafeExecPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length < 2 || path.length > EXEC_PATH_MAX) return false
  if (!path.startsWith('/') || path.endsWith('/')) return false
  if (path.includes('=') || PATH_FORBIDDEN.test(path)) return false
  return path
    .slice(1)
    .split('/')
    .every(part => part !== '' && part !== '.' && part !== '..')
}

/** One entry of the allowlist: an executable's path as it lands, and its SHA-256 (lowercase) when given. */
export type AllowEntry = { path: string; sha256?: string }

/** The allowlist as read: its entries, and the places (from 1) of those left out as not valid. */
export type Allowlist = { entries: AllowEntry[]; ignored: number[] }

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * The allowlist file's text read: `{ "executables": [{ "path": "/abs/path",
 * "sha256": "<64 hex digits>" }] }`, `sha256` optional. An entry whose path
 * is not isSafeExecPath, or whose sha256 is not 64 hexadecimal digits, is left
 * out (`ignored`). Undefined when the text is not that shape at all.
 */
export function parseAllowlist(text: string): Allowlist | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['executables'])) return undefined
  const entries: AllowEntry[] = []
  const ignored: number[] = []
  parsed['executables'].forEach((e: unknown, i) => {
    if (!isRecord(e) || !isSafeExecPath(e['path'])) {
      ignored.push(i + 1)
      return
    }
    const hash = e['sha256']
    if (hash === undefined) {
      entries.push({ path: e['path'] })
      return
    }
    if (typeof hash !== 'string' || !SHA256_FORMAT.test(hash)) {
      ignored.push(i + 1)
      return
    }
    entries.push({ path: e['path'], sha256: hash.toLowerCase() })
  })
  return { entries, ignored }
}

/**
 * The entry for the executable at `realPath` (where the command lands, every
 * link followed), matched as written: an entry's own path is never resolved,
 * so a link at the allowlisted path that leads elsewhere matches nothing.
 * The first entry of that path when there are several.
 */
export const matchAllowlist = (entries: readonly AllowEntry[], realPath: string): AllowEntry | undefined =>
  entries.find(e => e.path === realPath)

/** What an approval holds: the executable's path as it lands, its fixed arguments and its SHA-256. */
export type ExecApproval = { path: string; args: readonly string[]; sha256: string }

/** The approvals as $.store holds them, by action ID; anything not of that shape left out. */
export function parseApprovals(value: unknown): Record<string, ExecApproval> {
  const out: Record<string, ExecApproval> = {}
  if (!isRecord(value)) return out
  for (const [id, a] of Object.entries(value)) {
    if (!isRecord(a)) continue
    const { path, args, sha256: hash } = a
    if (typeof path !== 'string' || typeof hash !== 'string' || !Array.isArray(args) || !args.every(x => typeof x === 'string')) continue
    out[id] = { path, args: args as string[], sha256: hash }
  }
  return out
}

/** Whether an approval kept is for exactly this path, these arguments in this order and this SHA-256. */
export const sameApproval = (kept: ExecApproval | undefined, now: ExecApproval): boolean =>
  kept !== undefined &&
  kept.path === now.path &&
  kept.sha256 === now.sha256 &&
  kept.args.length === now.args.length &&
  kept.args.every((a, i) => a === now.args[i])

/** The variables passed on from the host, as read: each left out when unset. */
export type ExecHostEnv = { HOME: string; LANG?: string; LC_ALL?: string; TMPDIR?: string }

/** What one exec action is run with: the argument vector, the working directory and the standard input. */
export type ExecInvocation = { argv: string[]; cwd: string; stdin: string }

/** A variable's value that may be passed: set, and with no NUL or line break in it. */
const passable = (v: string | undefined): v is string => v !== undefined && v !== '' && !/[\0\n\r]/.test(v)

/**
 * How the executable at `realPath` is run: `/usr/bin/env -i`, then the
 * variables it is given (PATH fixed to EXEC_PATH, HOME, LANG, LC_ALL and
 * TMPDIR as the host has them, QUICK_ACTIONS_TARGET and QUICK_ACTIONS_LANG),
 * then the path and the fixed arguments as written, in the home directory.
 * What it works on (`stdin`) is never put in the argument vector. Undefined
 * when `realPath` is not isSafeExecPath or an argument has a NUL in it, which
 * the checks before refuse already: nothing is run then.
 */
export function buildInvocation(p: {
  realPath: string
  args: readonly string[]
  env: ExecHostEnv
  target: 'selection' | 'context' | 'none'
  lang: Lang
  stdin: string
}): ExecInvocation | undefined {
  if (!isSafeExecPath(p.realPath) || !isSafeExecPath(p.env.HOME)) return undefined
  if (p.args.some(a => typeof a !== 'string' || a.includes('\0'))) return undefined
  const vars: [string, string | undefined][] = [
    ['PATH', EXEC_PATH],
    ['HOME', p.env.HOME],
    ['LANG', p.env.LANG],
    ['LC_ALL', p.env.LC_ALL],
    ['TMPDIR', p.env.TMPDIR],
    ['QUICK_ACTIONS_TARGET', p.target],
    ['QUICK_ACTIONS_LANG', p.lang],
  ]
  const assignments = vars.flatMap(([name, value]) => (passable(value) ? [`${name}=${value}`] : []))
  return { argv: [ENV_BIN, '-i', ...assignments, p.realPath, ...p.args], cwd: p.env.HOME, stdin: p.stdin }
}

/** How many bytes `text` takes in UTF-8 (a lone surrogate as U+FFFD's three). */
export function utf8Length(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}

/**
 * The conversation as a context action's executable reads it: a JSON array of
 * `{ role, text }`, oldest first, tool calls and their results left out. Past
 * EXEC_STDIN_MAX bytes the oldest messages go first, until it fits.
 */
export function conversationInput(messages: readonly { role: string; text: string }[]): string {
  const kept: { role: string; text: string }[] = []
  // Two bytes for the brackets; each message its JSON and a comma.
  let size = 2
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    const one = { role: m.role, text: m.text }
    const bytes = utf8Length(JSON.stringify(one)) + (kept.length === 0 ? 0 : 1)
    if (size + bytes > EXEC_STDIN_MAX) break
    size += bytes
    kept.push(one)
  }
  return JSON.stringify(kept.reverse())
}

/** `text` cut to at most `max` UTF-16 code units, never inside a surrogate pair; whether it was cut. */
export function cutText(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false }
  let end = max
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return { text: text.slice(0, end), cut: true }
}

/**
 * Where the blank lines at the start of `raw` end, whatever their line breaks
 * (\r, \r\n or \n): just past the last break before anything but spaces,
 * tabs and breaks, so the first line with text keeps its leading spaces and
 * tabs. A loop, not a repeated regex group, which runs out of stack on a few
 * million blank lines.
 */
function leadingBlankEnd(raw: string): number {
  let end = 0
  for (let i = 0; i < raw.length; ) {
    const c = raw.charCodeAt(i)
    if (c === 0x20 || c === 0x09) i++
    else if (c === 0x0d) {
      i++
      if (raw.charCodeAt(i) === 0x0a) i++
      end = i
    } else if (c === 0x0a) end = ++i
    else break
  }
  return end
}

/**
 * An output as shown, at most `max` code units: blank lines at its start and
 * white space at its end gone, line breaks made \n; whether it was cut (by
 * this or, `cutBefore`, by $.process.run). Linear in the output's length
 * however it is made (no /\s+$/, which is quadratic in a run of white space
 * that something follows), and past its start only about twice `max` of it is
 * ever tidied: a \r\n made \n halves it at most, so what is kept of that is
 * still longer than `max` whenever more follows.
 */
export function tidied(raw: string, max: number, cutBefore = false): { text: string; cut: boolean } {
  const start = raw.slice(leadingBlankEnd(raw))
  const head = cutText(start, 2 * max + 2)
  // Something but white space past the part kept: the output goes on, so the
  // part's end is not the output's end and keeps its white space.
  const more = head.cut && /\S/u.test(start.slice(head.text.length))
  const lines = head.text.replace(/\r\n?/g, '\n')
  const { text, cut } = cutText(more ? lines : lines.trimEnd(), max)
  return { text, cut: cut || more || cutBefore }
}

/**
 * What an exec action that exited 0 shows: its standard output, cut at
 * EXEC_OUTPUT_MAX (or as $.process.run cut it, `cutBefore`) and said so, its
 * hidden characters escaped as a model's answer's are (showHiddenNoted);
 * nothing written, the text that says so.
 */
export function execOutputText(stdout: string, cutBefore: boolean, lang: Lang): string {
  const t = MESSAGES[lang]
  const { text, cut } = tidied(stdout, EXEC_OUTPUT_MAX, cutBefore)
  if (text === '') return cut ? t.execTruncated : t.execNoOutput
  const shown = showHiddenNoted(text, lang)
  return cut ? `${shown}\n\n${t.execTruncated}` : shown
}

/**
 * What an exec action that exited with another code shows: the code, then
 * its standard error (cut at EXEC_STDERR_MAX) and its standard output (cut at
 * EXEC_OUTPUT_MAX), each under its heading when there is any, escaped as
 * above, and said to be cut when it was (by this, or by $.process.run:
 * `processCut.stderrCut` / `processCut.stdoutCut`).
 */
export function execFailureText(
  exitCode: number,
  stdout: string,
  stderr: string,
  lang: Lang,
  processCut: { stdoutCut?: boolean; stderrCut?: boolean } = {},
): string {
  const t = MESSAGES[lang]
  const parts = [t.failed(t.execExit(exitCode))]
  const section = (heading: string, part: { text: string; cut: boolean }) => {
    if (part.text === '' && !part.cut) return
    const body = [part.text === '' ? undefined : showHiddenNoted(part.text, lang), part.cut ? t.execTruncated : undefined]
    parts.push([heading, ...body.filter(line => line !== undefined)].join('\n'))
  }
  section(t.execStderr, tidied(stderr, EXEC_STDERR_MAX, processCut.stderrCut))
  section(t.execStdout, tidied(stdout, EXEC_OUTPUT_MAX, processCut.stdoutCut))
  return parts.join('\n\n')
}

// A rejection this close to the timeout is the timeout: the clock read around
// the call is a little off either way.
const TIMEOUT_MESSAGE = /timed?[\s-]?out/i
const TIMEOUT_SHARE = 0.9

/** Whether a rejected run was the timeout (its message says so, or it took about as long), not a start that failed. */
export const isTimeout = (message: string, elapsedMs: number, timeoutMs: number) =>
  TIMEOUT_MESSAGE.test(message) || elapsedMs >= timeoutMs * TIMEOUT_SHARE

// U+XXXX for each character of PATH_FORBIDDEN, so the question shows them rather than draws them.
const PATH_FORBIDDEN_ALL = new RegExp(PATH_FORBIDDEN.source, 'gu')
const named = (s: string) =>
  s.replace(PATH_FORBIDDEN_ALL, ch => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`)

/** The fixed arguments as the approval shows them: a JSON array, every hidden character named U+XXXX. */
export const shownArgs = (args: readonly string[]) => named(JSON.stringify(args))

/** The question the approval asks: what runs (the path as it lands, the arguments, the SHA-256), ending in a question mark. */
export const approvalQuestion = (lang: Lang, label: string, id: string, a: ExecApproval) =>
  MESSAGES[lang].execApproveQuestion(named(label), id, a.path, shownArgs(a.args), a.sha256)

// ---------------------------------------------------------------------------
// What register.tsx reads (the settings, the files) is judged here: it does the
// reading alone, as only it may hand `$` on, and these say what it comes to.

/** Where an exec action's command lands, and the allowlist entry that names it. */
export type Located = { realPath: string; size: number; entry: AllowEntry }

/** What a $.fs.stat with `resolve` answered, as far as these need it; undefined when it rejected. */
export type StatSeen = { kind: 'file' | 'dir' | 'other'; size: number; realPath?: string } | undefined

/** HOME as it may be used: an absolute path fit to run in (isSafeExecPath); else undefined. */
export const usableHome = (home: unknown): string | undefined => (isSafeExecPath(home) ? home : undefined)

/** The allowlist's path under the home directory `home`. */
export const allowlistPath = (home: string) => `${home}/${ALLOWLIST_RELATIVE}`

/**
 * Whether `key` names this plugin (`plugin`) in settings: the plugin's name
 * alone, or with its marketplace (`plugin@marketplace`). The one rule every
 * check of the plugin's own settings goes by (scopeVerdict,
 * originRestricted, isOwnFieldKey).
 */
export const isOwnPluginKey = (key: string, plugin: string) => key === plugin || key.startsWith(`${plugin}@`)

/** The `options` of every entry of this plugin (isOwnPluginKey) in the settings' `pluginConfigs`, in their order. */
export function ownOptions(settings: Readonly<Record<string, unknown>>, plugin: string): Record<string, unknown>[] {
  const configs = settings['pluginConfigs']
  if (!isRecord(configs)) return []
  return Object.entries(configs).flatMap(([key, v]) => (isOwnPluginKey(key, plugin) && isRecord(v) && isRecord(v['options']) ? [v['options']] : []))
}

/**
 * Whether exec definitions are the person's own, by the settings: undefined
 * when they are. Their user settings (`user`; undefined: not readable) must
 * have exactly one entry of `plugin` in `pluginConfigs` with
 * `options.customActions`, and the merged `customActions` (`merged`) must be
 * that entry's text exactly; none of `others` (the project, local and flag
 * settings; undefined: not readable) may set HOME in its `env`.
 */
export function scopeVerdict(
  user: Readonly<Record<string, unknown>> | undefined,
  others: readonly (Readonly<Record<string, unknown>> | undefined)[],
  merged: unknown,
  plugin: string,
): CustomReason | undefined {
  if (user === undefined) return { code: 'execScope', why: 'unreadable' }
  const holders = ownOptions(user, plugin).filter(options => options['customActions'] !== undefined)
  if (holders.length !== 1) return { code: 'execScope', why: 'keys' }
  const own = holders[0]!['customActions']
  if (typeof own !== 'string' || own !== merged) return { code: 'execScope', why: 'mismatch' }
  for (const settings of others) {
    if (settings === undefined) return { code: 'execScope', why: 'unreadable' }
    const env = settings['env']
    if (!isRecord(env)) continue
    if (Object.prototype.hasOwnProperty.call(env, 'HOME')) return { code: 'execScope', why: 'home' }
    const loader = loaderVariable(env)
    if (loader !== undefined) return { code: 'execScope', why: 'loader', name: pathShown(loader) }
  }
  return undefined
}

/** The `execOrigin` value that keeps exec actions to the person's own hand. */
export const EXEC_ORIGIN_TERMINAL = 'terminal'

/** The `userConfig` field that sets it. */
export const EXEC_ORIGIN_FIELD = 'execOrigin'

/** A `/config` change (config.set) as the guards read it: the row's key, the new value and where it came from. */
export type ConfigChange = { key: string; value: unknown; origin: { kind: string } }

/** Whether a config.set `key` is this plugin's `field`: `<plugin>.<field>` or `<plugin>@<marketplace>.<field>` (isOwnPluginKey). */
export function isOwnFieldKey(key: string, plugin: string, field: string): boolean {
  const suffix = `.${field}`
  return key.endsWith(suffix) && isOwnPluginKey(key.slice(0, -suffix.length), plugin)
}

/**
 * Whether a `/config` change (config.set) would take execOrigin off
 * `terminal` from other than the person in the menu (a plugin's
 * `$.config.set`, the bridge): its key is `<plugin>.execOrigin` (or
 * `<plugin>@<marketplace>.execOrigin`), its origin not `composer` and its
 * value not `terminal`. A layer of defence only: what counts is the user
 * settings read at each run (originRestricted).
 */
export function weakensExecOrigin(e: ConfigChange, plugin: string): boolean {
  return isOwnFieldKey(e.key, plugin, EXEC_ORIGIN_FIELD) && e.origin.kind !== 'composer' && e.value !== EXEC_ORIGIN_TERMINAL
}

/** The `userConfig` field that holds the custom definitions, exec ones among them. */
export const EXEC_CUSTOM_ACTIONS_FIELD = 'customActions'

/**
 * Whether a `/config` change (config.set) is to this plugin's customActions
 * (`<plugin>.customActions` or `<plugin>@<marketplace>.customActions`) from
 * other than the person in the menu (a plugin's `$.config.set`, the bridge).
 * Such a change may not add or alter an exec definition (addsExecDefinition).
 */
export const isOwnCustomActionsChange = (e: ConfigChange, plugin: string): boolean =>
  isOwnFieldKey(e.key, plugin, EXEC_CUSTOM_ACTIONS_FIELD) && e.origin.kind !== 'composer'

/**
 * The customActions text a change from other than the person is judged
 * against: the person's own, in their user settings (`user`; undefined: not
 * readable, and so is the result). By scopeVerdict's rule: the text of the one
 * entry of `plugin` in `pluginConfigs` that has `options.customActions`, when
 * it is a string; anything else (none, several, not a string) holds no exec
 * definition that may run, so it is `''`. Never the change's `previous`,
 * which is the merged value and may come from a project's settings: judged
 * against it, the project's exec definitions could be copied into the user
 * settings, and so pass scopeVerdict.
 */
export function execBaseline(user: Readonly<Record<string, unknown>> | undefined, plugin: string): string | undefined {
  if (user === undefined) return undefined
  const holders = ownOptions(user, plugin).filter(options => options[EXEC_CUSTOM_ACTIONS_FIELD] !== undefined)
  if (holders.length !== 1) return ''
  const own = holders[0]![EXEC_CUSTOM_ACTIONS_FIELD]
  return typeof own === 'string' ? own : ''
}

/** `value` as JSON with every object's keys in order, at any depth: the same definition written in another key order reads the same. */
function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : isRecord(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, sorted(v[k])]),
          )
        : v
  return JSON.stringify(sorted(value)) ?? ''
}

/**
 * Whether the valid definitions after a change (`next`, parseCustomActions'
 * specs) hold an exec definition not in the valid ones it is judged against
 * (`base`; undefined: not known, so any exec definition counts): one whose ID
 * is new to `base`'s exec definitions, or whose definition differs in any
 * field (its command, arguments, label, timeout, …), key order aside. The
 * valid definitions are compared, not the text, so one made valid (its
 * duplicate before it taken out, its mistake mended) counts as added too.
 * Taking exec definitions out, turning one into another kind, reordering them
 * and changing the other kinds' do not.
 */
export function addsExecDefinition(next: readonly ActionSpec[], base: readonly ActionSpec[] | undefined): boolean {
  const execs = next.filter(spec => spec.kind === 'exec')
  if (base === undefined) return execs.length > 0
  const known = new Map(base.filter(spec => spec.kind === 'exec').map(spec => [spec.id, canonicalJson(spec)]))
  return execs.some(spec => known.get(spec.id) !== canonicalJson(spec))
}

/**
 * What a config.set hook that failed before passing the change on refuses,
 * without reading it any further (the safe side): an execOrigin taken off
 * `terminal` (weakensExecOrigin), or any change to customActions from other
 * than the person (isOwnCustomActionsChange), exec definition or not; else
 * undefined, to pass it on.
 */
export function configSetFailureDenial(e: ConfigChange, plugin: string): 'execOriginConfigDenied' | 'customActionsConfigDenied' | undefined {
  if (weakensExecOrigin(e, plugin)) return 'execOriginConfigDenied'
  if (isOwnCustomActionsChange(e, plugin)) return 'customActionsConfigDenied'
  return undefined
}

/** `/quick-actions exec-approvals`: lists the approvals and the history, and revokes approvals. Reserved, as `hint` is. */
export const EXEC_ADMIN_ARG = 'exec-approvals'

/**
 * Whether exec actions run only from the person's own hand (a press at the
 * terminal, the command typed at the prompt): `execOrigin` is `terminal` in
 * any entry of `plugin` (or `plugin@…`) in their user settings' `pluginConfigs`
 * (`user`; undefined: not readable), or in the merged options (`merged`). The
 * user settings decide it, so no project, local or flag settings can turn it
 * off; any of them may still turn it on. User settings that cannot be read
 * count as on (the safe side): they are read again at each run, after the
 * exec gate's one read at load, so a file being edited or broken mid-session
 * must not let a run through that the person meant to keep to their hand.
 */
export function originRestricted(user: Readonly<Record<string, unknown>> | undefined, merged: unknown, plugin: string): boolean {
  if (merged === EXEC_ORIGIN_TERMINAL || user === undefined) return true
  return ownOptions(user, plugin).some(options => options[EXEC_ORIGIN_FIELD] === EXEC_ORIGIN_TERMINAL)
}

/** Whether `path` is `dir` or lies under it. */
export const within = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`)

/**
 * Whether the allowlist file may be read, from where it lands (`file`, its
 * stat), where the home directory lands (`realHome`) and where the session's
 * root and working directory land (`roots`; undefined: not known). It must
 * be a regular file, and not in the session's project: under neither root
 * (unless that root is the home directory itself), where a repository could
 * have put it. Its path to read when it may, else why not.
 */
export function allowlistPlace(file: StatSeen, realHome: string, roots: readonly (string | undefined)[]): { path: string } | CustomReason {
  if (file === undefined || file.kind !== 'file' || file.realPath === undefined) return { code: 'execAllowlist', why: 'missing' }
  for (const root of roots) {
    if (root === undefined) return { code: 'execAllowlist', why: 'unreadable' }
    if (root !== realHome && within(file.realPath, root)) return { code: 'execAllowlist', why: 'inProject' }
  }
  return { path: file.realPath }
}

/** The allowlist file's text (undefined: not readable) as the list, or why it cannot be used. */
export const allowlistOf = (text: string | undefined): Allowlist | CustomReason =>
  text === undefined ? { code: 'execAllowlist', why: 'unreadable' } : (parseAllowlist(text) ?? { code: 'execAllowlist', why: 'invalid' })

/** A path as a reason shows it: hidden characters named, at most 200 code units. */
export const pathShown = (path: string) => {
  const s = named(path)
  return s.length <= 200 ? s : `${s.slice(0, 197)}...`
}

/**
 * Where `command` lands (its stat) and the allowlist entry that names that
 * path, or why it may not run: it leads to no regular file, the path it lands
 * on is not isSafeExecPath (a link to a path with `=`, say), or no entry names it.
 */
export function locate(command: string, stat: StatSeen, entries: readonly AllowEntry[]): Located | CustomReason {
  if (stat === undefined || stat.kind !== 'file' || stat.realPath === undefined) return { code: 'execMissing', path: pathShown(command) }
  if (!isSafeExecPath(stat.realPath)) return { code: 'execPath', field: 'realPath', path: pathShown(stat.realPath) }
  const entry = matchAllowlist(entries, stat.realPath)
  if (entry === undefined) return { code: 'execNotAllowed', path: pathShown(stat.realPath) }
  return { realPath: stat.realPath, size: stat.size, entry }
}

/**
 * The SHA-256 (lowercase hex) of the executable at `realPath` from its bytes
 * as $.fs.read answered them (`base64`; undefined: not readable), or why it
 * cannot be had: past EXEC_FILE_MAX, or not readable.
 */
export function hashOf(realPath: string, base64: string | undefined): string | CustomReason {
  if (base64 === undefined) return { code: 'execUnreadable', path: pathShown(realPath) }
  const decoded = base64Decode(base64)
  if ('error' in decoded) return { code: 'execUnreadable', path: pathShown(realPath) }
  if (decoded.bytes.length > EXEC_FILE_MAX) return { code: 'execTooLarge', max: EXEC_FILE_MAX }
  return sha256(decoded.bytes)
}

/** What the exec gate says of the exec definitions of one load: those that may not run, each with why, and the allowlist's entries left out. */
export type ExecGateResult = { rejected: ReadonlyMap<string, CustomReason>; ignoredEntries: readonly number[] }

export const NO_GATE: ExecGateResult = { rejected: new Map(), ignoredEntries: [] }

/** Every one of `ids` refused for the same `reason`. */
export const gateAll = (ids: readonly string[], reason: CustomReason, ignoredEntries: readonly number[] = []): ExecGateResult => ({
  rejected: new Map(ids.map(id => [id, reason])),
  ignoredEntries,
})

/** A thrown error as a reason: never thrown on, its hidden characters named. */
export const unexpected = (err: unknown): CustomReason => ({
  code: 'unexpected',
  detail: err instanceof Error ? named(err.message).slice(0, 200) : 'exec',
})

// ---------------------------------------------------------------------------
// How many run at once, and the history of what ran.

/** The most exec actions running at once in one session: one more is refused (execBusy). */
export const EXEC_CONCURRENT_MAX = 3
/**
 * How long past its timeout a slot is still held: a run ends at its timeout at
 * the latest, so a slot held longer than that and this was never given back
 * (its run dropped by a reload, say) and is let go.
 */
export const EXEC_SLOT_GRACE_MS = 30_000

// A slot (ExecSlot, ../types) taken with the time unknown holds until 0:
// counted until the time can be read again, then let go at once, even if its
// run is still going, so a clock that cannot be read for a while may let the
// limit be passed briefly. A rare case, and the run still ends at its timeout.
export type { ExecSlot }

/**
 * `slots` with one more taken by `token`, when fewer than `max` are held:
 * those whose time is past (`until <= now`) let go first. With `now` unknown,
 * every slot counts (none is let go: the safe side) and the new one holds
 * until 0 (see ExecSlot). `holdMs`: how long the run may take (its timeout
 * and EXEC_SLOT_GRACE_MS). `taken`: whether it was.
 */
export function takeSlot(
  slots: readonly ExecSlot[],
  now: number | undefined,
  token: string,
  holdMs: number,
  max: number,
): { slots: ExecSlot[]; taken: boolean } {
  const live = now === undefined ? [...slots] : slots.filter(slot => slot.until > now)
  if (live.length >= max) return { slots: live, taken: false }
  return { slots: [...live, { token, until: now === undefined ? 0 : now + holdMs }], taken: true }
}

/** `slots` without the one `token` took (the others, whoever took them, kept). */
export const releaseSlot = (slots: readonly ExecSlot[], token: string): ExecSlot[] => slots.filter(slot => slot.token !== token)

/** `slots` less those whose time is past; all kept with `now` unknown. */
export const liveSlots = (slots: readonly ExecSlot[], now: number | undefined): ExecSlot[] =>
  now === undefined ? [...slots] : slots.filter(slot => slot.until > now)

/** The $.store key the history of exec runs is kept under. */
export const HISTORY_KEY = 'execHistory'
/** The most runs the history keeps: past it, the oldest go. */
export const EXEC_HISTORY_MAX = 50
/** The most of the fixed arguments (shownArgs) a history entry keeps, in UTF-16 code units. */
export const HISTORY_ARGS_MAX = 500
/** The most of where a run was asked from (fromName) a history entry keeps, in UTF-16 code units. */
export const HISTORY_FROM_MAX = 40
/** The most of the history `/quick-actions exec-approvals` lists, newest first. */
export const HISTORY_LISTED = 20

/** How a run ended: exit 0, another exit code, its timeout, or not started at all. */
export type ExecOutcome = 'ok' | 'exit' | 'timeout' | 'notStarted'
const OUTCOMES: readonly ExecOutcome[] = ['ok', 'exit', 'timeout', 'notStarted']

/**
 * One run as the history keeps it. `at`: when it started (ms since the epoch;
 * 0 when the clock could not be read). `path`: the executable as it lands
 * (pathShown: hidden characters named, at most 200 code units). `args`: its
 * fixed arguments (shownArgs, at most HISTORY_ARGS_MAX). `from`: where it was
 * asked from (fromName). What it was given and what it wrote are never kept.
 */
export type ExecHistoryEntry = {
  at: number
  id: string
  path: string
  args: string
  result: ExecOutcome
  exitCode?: number
  from: string
}

/** One run as the history keeps it (ExecHistoryEntry), every field shown safe and cut to its limit. */
export function historyEntry(p: {
  at: number | undefined
  id: string
  realPath: string
  args: readonly string[]
  result: ExecOutcome
  exitCode?: number
  from: string
}): ExecHistoryEntry {
  return {
    at: p.at !== undefined && Number.isSafeInteger(p.at) && p.at >= 0 ? p.at : 0,
    id: cutText(named(p.id), 100).text,
    path: pathShown(p.realPath),
    args: cutText(shownArgs(p.args), HISTORY_ARGS_MAX).text,
    result: p.result,
    ...(p.result === 'exit' && p.exitCode !== undefined ? { exitCode: p.exitCode } : {}),
    from: cutText(named(p.from), HISTORY_FROM_MAX).text,
  }
}

/** The history as $.store holds it, oldest first: an entry not of ExecHistoryEntry's shape left out; at most EXEC_HISTORY_MAX, the newest. */
export function parseHistory(value: unknown): ExecHistoryEntry[] {
  if (!Array.isArray(value)) return []
  const out: ExecHistoryEntry[] = []
  for (const e of value) {
    if (!isRecord(e)) continue
    const { at, id, path, args, result, exitCode, from } = e
    if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) continue
    if (typeof id !== 'string' || typeof path !== 'string' || typeof args !== 'string' || typeof from !== 'string') continue
    if (!OUTCOMES.includes(result as ExecOutcome)) continue
    if (exitCode !== undefined && (typeof exitCode !== 'number' || !Number.isInteger(exitCode))) continue
    out.push({ at, id, path, args, result: result as ExecOutcome, ...(typeof exitCode === 'number' ? { exitCode } : {}), from })
  }
  return out.slice(-EXEC_HISTORY_MAX)
}

/** `list` with `entry` after its last, the oldest gone past EXEC_HISTORY_MAX. */
export const appendHistory = (list: readonly ExecHistoryEntry[], entry: ExecHistoryEntry): ExecHistoryEntry[] =>
  [...list, entry].slice(-EXEC_HISTORY_MAX)

/**
 * Where a run was asked from, in a word for the history: the command's origin
 * (composer, bridge, sdk, plugin, peer, scheduled-trigger, …) when it has one,
 * else the surface pressed on (terminal, mobile, desktop, vscode), else
 * `unknown`.
 */
export const fromName = (from: { surface?: string; origin?: string }): string =>
  cutText(named(from.origin ?? from.surface ?? 'unknown'), HISTORY_FROM_MAX).text

const two = (n: number) => String(n).padStart(2, '0')

/** `ms` as the local `YYYY-MM-DD HH:MM:SS` (by `utcOffsetMinutes`); undefined for 0, the time not known. */
export function localStamp(ms: number, utcOffsetMinutes: (ms: number) => number): string | undefined {
  if (ms <= 0) return undefined
  const d = new Date(ms + utcOffsetMinutes(ms) * 60_000)
  if (Number.isNaN(d.getTime())) return undefined
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`
}

/**
 * What `/quick-actions exec-approvals` shows: whether execOrigin keeps exec
 * actions to the person's own hand (`restricted`), every approval kept (by
 * ID), then the newest HISTORY_LISTED runs, newest first, and how to revoke.
 * Either list undefined: $.store could not be read, said so (never as none
 * kept, which would pass for nothing approved). Every value from $.store has
 * its hidden characters named.
 */
export function approvalsListText(
  lang: Lang,
  approvals: Readonly<Record<string, ExecApproval>> | undefined,
  history: readonly ExecHistoryEntry[] | undefined,
  restricted: boolean,
  utcOffsetMinutes: (ms: number) => number,
): string {
  const t = MESSAGES[lang]
  const lines = [t.execAdminOrigin(restricted), '']
  const ids = approvals === undefined ? [] : Object.keys(approvals).sort()
  if (approvals === undefined) lines.push(t.execAdminApprovalsUnreadable)
  else if (ids.length === 0) lines.push(t.execAdminNoApprovals)
  else {
    lines.push(t.execAdminApprovals(ids.length))
    for (const id of ids) {
      const a = approvals![id]!
      lines.push(`- ${t.execAdminApprovalLine(cutText(named(id), 100).text, pathShown(a.path), cutText(shownArgs(a.args), HISTORY_ARGS_MAX).text, named(a.sha256.slice(0, 12)))}`)
    }
  }
  lines.push('')
  if (history === undefined) lines.push(t.execAdminHistoryUnreadable)
  else if (history.length === 0) lines.push(t.execAdminNoHistory)
  else {
    const shown = history.slice(-HISTORY_LISTED).reverse()
    lines.push(t.execAdminHistory(shown.length, history.length))
    for (const e of shown) {
      const when = localStamp(e.at, utcOffsetMinutes) ?? t.execAdminUnknownTime
      // e.path was named (pathShown) when it was recorded; it is named again
      // here because $.store is read back as found, and a value put there by
      // other than historyEntry must not reach the terminal raw.
      lines.push(`- ${t.execAdminHistoryLine(when, named(e.id), named(e.path), t.execAdminOutcome(e.result, e.exitCode), named(e.from))}`)
    }
  }
  lines.push('', t.execAdminUsage)
  return lines.join('\n')
}
