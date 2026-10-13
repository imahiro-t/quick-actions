import { expect, test } from './kit'

import { parseCustomActions } from '../hooks/custom'
import {
  EXEC_ADMIN_ARG,
  EXEC_CONCURRENT_MAX,
  EXEC_HISTORY_MAX,
  HISTORY_ARGS_MAX,
  HISTORY_FROM_MAX,
  HISTORY_LISTED,
  appendHistory,
  addsExecDefinition,
  approvalsListText,
  configSetFailureDenial,
  execBaseline,
  fromName,
  historyEntry,
  isOwnCustomActionsChange,
  isOwnFieldKey,
  isOwnPluginKey,
  liveSlots,
  loaderVariable,
  localStamp,
  originRestricted,
  ownOptions,
  parseHistory,
  releaseSlot,
  scopeVerdict,
  takeSlot,
  weakensExecOrigin,
} from '../hooks/exec'
import type { ExecHistoryEntry } from '../hooks/exec'
import { MESSAGES } from '../hooks/i18n'

// The guards SELM-00120 adds to exec actions, as pure functions: the dynamic
// loader's variables in the settings, where a run may be asked from
// (execOrigin), how many run at once, the history of runs and what
// `/quick-actions exec-approvals` lists.

const PLUGIN = 'quick-actions'
const SETTING = '[]'
const user = (configs: Record<string, unknown>) => ({ pluginConfigs: configs })
const own = { [`${PLUGIN}@market`]: { options: { customActions: SETTING } } }

// ---------------------------------------------------------------------------
// The loader's variables

test('loaderVariable: LD_* and DYLD_* in capitals, nothing else', () => {
  expect(loaderVariable({ LD_PRELOAD: '/x.so' })).toBe('LD_PRELOAD')
  expect(loaderVariable({ PATH: '/bin', DYLD_INSERT_LIBRARIES: '/x.dylib' })).toBe('DYLD_INSERT_LIBRARIES')
  for (const name of ['OLD_X', 'ld_preload', 'LDX', 'Ld_PRELOAD', 'XLD_PRELOAD', 'DYLDX']) expect(loaderVariable({ [name]: 'x' })).toBeUndefined()
  expect(loaderVariable({})).toBeUndefined()
})

test('scopeVerdict: a loader variable in the project, local or flag settings turns exec off, named', () => {
  for (const name of ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES']) {
    for (const at of [0, 1, 2]) {
      const others = [{}, {}, {}].map((o, i) => (i === at ? { env: { [name]: '/evil' } } : o))
      expect(scopeVerdict(user(own), others, SETTING, PLUGIN)).toEqual({ code: 'execScope', why: 'loader', name })
    }
  }
  // Not one of them.
  for (const name of ['OLD_X', 'ld_preload', 'LDX']) expect(scopeVerdict(user(own), [{ env: { [name]: 'x' } }, {}, {}], SETTING, PLUGIN)).toBeUndefined()
  // The person's own settings may set one: those are theirs.
  expect(scopeVerdict({ ...user(own), env: { LD_PRELOAD: '/mine.so' } }, [{}, {}, {}], SETTING, PLUGIN)).toBeUndefined()
  // HOME beside it is told first.
  expect(scopeVerdict(user(own), [{ env: { LD_PRELOAD: '/x', HOME: '/repo' } }, {}, {}], SETTING, PLUGIN)).toEqual({ code: 'execScope', why: 'home' })
  // A hidden character in its name is shown named.
  expect(scopeVerdict(user(own), [{ env: { 'LD_\u001bX': '1' } }, {}, {}], SETTING, PLUGIN)).toEqual({ code: 'execScope', why: 'loader', name: 'LD_U+001BX' })
})

test('the loader reason, in both languages, names the variable', () => {
  for (const lang of ['ja', 'en'] as const) {
    const text = MESSAGES[lang].customReason({ code: 'execScope', why: 'loader', name: 'LD_PRELOAD' })
    expect(text).toContain('LD_PRELOAD')
    expect(text).toContain('exec')
  }
})

// ---------------------------------------------------------------------------
// Where a run may be asked from

test('originRestricted: the user settings turn it on, and nothing else turns it off', () => {
  const terminal = { options: { execOrigin: 'terminal' } }
  // On in the user settings: on, whatever the merge says.
  expect(originRestricted(user({ [`${PLUGIN}@market`]: terminal }), 'anywhere', PLUGIN)).toBe(true)
  expect(originRestricted(user({ [PLUGIN]: terminal }), undefined, PLUGIN)).toBe(true)
  // Not set by the person, but the merge says terminal (another settings file strengthening it): on.
  expect(originRestricted(user({}), 'terminal', PLUGIN)).toBe(true)
  expect(originRestricted(undefined, 'terminal', PLUGIN)).toBe(true)
  // Neither: off.
  expect(originRestricted(user({}), 'anywhere', PLUGIN)).toBe(false)
  expect(originRestricted(user({ [`${PLUGIN}@market`]: { options: { execOrigin: 'anywhere' } } }), undefined, PLUGIN)).toBe(false)
  expect(originRestricted({}, undefined, PLUGIN)).toBe(false)
  // The user settings not readable: on (the safe side), whatever the merge says.
  expect(originRestricted(undefined, undefined, PLUGIN)).toBe(true)
  expect(originRestricted(undefined, 'anywhere', PLUGIN)).toBe(true)
  // Another plugin's entry does not count.
  expect(originRestricted(user({ [`${PLUGIN}-x@market`]: terminal }), 'anywhere', PLUGIN)).toBe(false)
})

test('isOwnPluginKey / ownOptions: the plugin by its name alone or with a marketplace, nothing else', () => {
  expect(isOwnPluginKey(PLUGIN, PLUGIN)).toBe(true)
  expect(isOwnPluginKey(`${PLUGIN}@market`, PLUGIN)).toBe(true)
  for (const other of [`${PLUGIN}-x`, `${PLUGIN}-x@market`, `x${PLUGIN}`, `x@${PLUGIN}`, '']) expect(isOwnPluginKey(other, PLUGIN)).toBe(false)
  const settings = user({
    [PLUGIN]: { options: { a: 1 } },
    [`${PLUGIN}@market`]: { options: { b: 2 } },
    [`${PLUGIN}@bare`]: { enabled: true },
    [`${PLUGIN}@odd`]: { options: 'text' },
    [`${PLUGIN}-x`]: { options: { c: 3 } },
  })
  expect(ownOptions(settings, PLUGIN)).toEqual([{ a: 1 }, { b: 2 }])
  expect(ownOptions({}, PLUGIN)).toEqual([])
  expect(ownOptions({ pluginConfigs: 'x' }, PLUGIN)).toEqual([])
})

test('weakensExecOrigin: execOrigin off terminal from other than the person in /config', () => {
  const change = (key: string, value: unknown, kind: string) => ({ key, value, origin: { kind } })
  for (const key of [`${PLUGIN}.execOrigin`, `${PLUGIN}@market.execOrigin`]) {
    expect(weakensExecOrigin(change(key, 'anywhere', 'plugin'), PLUGIN)).toBe(true)
    expect(weakensExecOrigin(change(key, 'anywhere', 'bridge'), PLUGIN)).toBe(true)
    // The person in the menu, or a change to terminal: let through.
    expect(weakensExecOrigin(change(key, 'anywhere', 'composer'), PLUGIN)).toBe(false)
    expect(weakensExecOrigin(change(key, 'terminal', 'plugin'), PLUGIN)).toBe(false)
  }
  // Another field, or another plugin's.
  expect(weakensExecOrigin(change(`${PLUGIN}.language`, 'en', 'plugin'), PLUGIN)).toBe(false)
  expect(weakensExecOrigin(change(`${PLUGIN}-x.execOrigin`, 'anywhere', 'plugin'), PLUGIN)).toBe(false)
  expect(weakensExecOrigin(change('execOrigin', 'anywhere', 'plugin'), PLUGIN)).toBe(false)
})

test('isOwnCustomActionsChange: customActions changed from other than the person in /config', () => {
  const change = (key: string, kind: string) => ({ key, value: '[]', origin: { kind } })
  for (const key of [`${PLUGIN}.customActions`, `${PLUGIN}@market.customActions`]) {
    expect(isOwnCustomActionsChange(change(key, 'plugin'), PLUGIN)).toBe(true)
    expect(isOwnCustomActionsChange(change(key, 'bridge'), PLUGIN)).toBe(true)
    expect(isOwnCustomActionsChange(change(key, 'composer'), PLUGIN)).toBe(false)
  }
  for (const key of [`${PLUGIN}.language`, `${PLUGIN}-x.customActions`, `${PLUGIN}-x@market.customActions`, 'customActions', `${PLUGIN}.customActionsX`]) {
    expect(isOwnCustomActionsChange(change(key, 'plugin'), PLUGIN)).toBe(false)
  }
  expect(isOwnFieldKey(`${PLUGIN}@market.execOrigin`, PLUGIN, 'execOrigin')).toBe(true)
  expect(isOwnFieldKey(`${PLUGIN}@market.execOrigin`, PLUGIN, 'customActions')).toBe(false)
})

test('execBaseline: the one user entry\'s customActions text; none, several or not a string hold none; unreadable is unknown', () => {
  expect(execBaseline(user({ [`${PLUGIN}@market`]: { options: { customActions: '[1]' } }, [PLUGIN]: { options: { language: 'en' } } }), PLUGIN)).toBe('[1]')
  expect(execBaseline(user({}), PLUGIN)).toBe('')
  expect(execBaseline({}, PLUGIN)).toBe('')
  expect(execBaseline(user({ [PLUGIN]: { options: { customActions: '[1]' } }, [`${PLUGIN}@market`]: { options: { customActions: '[1]' } } }), PLUGIN)).toBe('')
  expect(execBaseline(user({ [PLUGIN]: { options: { customActions: [1] } } }), PLUGIN)).toBe('')
  expect(execBaseline(user({ [`${PLUGIN}-x`]: { options: { customActions: '[1]' } } }), PLUGIN)).toBe('')
  expect(execBaseline(undefined, PLUGIN)).toBeUndefined()
})

test('addsExecDefinition: a new or altered valid exec definition; taking out, other kinds, key order and reordering are not', () => {
  const specs = (defs: unknown[]) => parseCustomActions(JSON.stringify(defs), ['close']).specs
  const UP = { id: 'up', icon: 'U', label: { en: 'Up', ja: '上' }, kind: 'exec', command: '/Users/me/bin/up', args: ['-x'], timeoutMs: 5000 }
  const ASK = { id: 'ask', icon: 'A', label: 'Ask', kind: 'complete', model: 'haiku', prompt: 'p' }
  const base = specs([UP, ASK])
  // Added, or any field changed.
  expect(addsExecDefinition(specs([UP, ASK, { ...UP, id: 'up2' }]), base)).toBe(true)
  for (const changed of [{ command: '/Users/me/bin/evil' }, { args: ['-y'] }, { args: [] }, { label: { en: 'Down', ja: '上' } }, { icon: 'D' }, { timeoutMs: 6000 }, { target: 'context' }]) {
    expect(addsExecDefinition(specs([{ ...UP, ...changed }, ASK]), base)).toBe(true)
  }
  // Another kind turned into exec under the same ID.
  expect(addsExecDefinition(specs([UP, { id: 'ask', icon: 'A', label: 'Ask', kind: 'exec', command: '/Users/me/bin/ask' }]), base)).toBe(true)
  // An exec definition left out as a duplicate, made valid by taking out the one before it.
  const EVIL = { ...UP, command: '/Users/me/bin/evil' }
  const dupBase = specs([UP, EVIL])
  expect(dupBase).toHaveLength(1)
  expect(addsExecDefinition(specs([EVIL]), dupBase)).toBe(true)
  // An invalid one mended.
  const broken = specs([UP, { ...UP, id: 'up2', command: 'relative/path' }])
  expect(addsExecDefinition(specs([UP, { ...UP, id: 'up2' }]), broken)).toBe(true)
  // Not added: taken out, other kinds only, the same in another key order or another place, exec turned into another kind.
  expect(addsExecDefinition(specs([ASK]), base)).toBe(false)
  expect(addsExecDefinition(specs([]), base)).toBe(false)
  expect(addsExecDefinition(specs([UP, { ...ASK, prompt: 'q' }, { ...ASK, id: 'ask2' }]), base)).toBe(false)
  const reordered = { timeoutMs: 5000, args: ['-x'], command: UP.command, kind: 'exec', label: { ja: '上', en: 'Up' }, icon: 'U', id: 'up' }
  expect(addsExecDefinition(specs([ASK, reordered]), base)).toBe(false)
  expect(addsExecDefinition(specs([{ id: 'up', icon: 'U', label: 'Up', kind: 'complete', model: 'haiku', prompt: 'p' }]), base)).toBe(false)
  // Against nothing known: any exec definition counts.
  expect(addsExecDefinition(specs([UP]), undefined)).toBe(true)
  expect(addsExecDefinition(specs([ASK]), undefined)).toBe(false)
  expect(addsExecDefinition(specs([UP]), [])).toBe(true)
})

test('configSetFailureDenial: a failed hook refuses execOrigin weakened and any customActions change from other than the person', () => {
  const change = (key: string, value: unknown, kind: string) => ({ key, value, origin: { kind } })
  expect(configSetFailureDenial(change(`${PLUGIN}.execOrigin`, 'anywhere', 'plugin'), PLUGIN)).toBe('execOriginConfigDenied')
  expect(configSetFailureDenial(change(`${PLUGIN}@market.customActions`, '[]', 'plugin'), PLUGIN)).toBe('customActionsConfigDenied')
  expect(configSetFailureDenial(change(`${PLUGIN}.customActions`, '', 'bridge'), PLUGIN)).toBe('customActionsConfigDenied')
  expect(configSetFailureDenial(change(`${PLUGIN}.customActions`, '[]', 'composer'), PLUGIN)).toBeUndefined()
  expect(configSetFailureDenial(change(`${PLUGIN}.execOrigin`, 'terminal', 'plugin'), PLUGIN)).toBeUndefined()
  expect(configSetFailureDenial(change(`${PLUGIN}.language`, 'ja', 'plugin'), PLUGIN)).toBeUndefined()
  // The messages exist in both languages.
  for (const lang of ['en', 'ja'] as const) expect(MESSAGES[lang].customActionsConfigDenied).toContain('customActions')
})

test('fromName: the origin first, then the surface, else unknown; cut short and shown safe', () => {
  expect(fromName({ origin: 'bridge', surface: 'terminal' })).toBe('bridge')
  expect(fromName({ origin: 'composer' })).toBe('composer')
  expect(fromName({ surface: 'mobile' })).toBe('mobile')
  expect(fromName({})).toBe('unknown')
  expect(fromName({ origin: 'x'.repeat(100) })).toHaveLength(HISTORY_FROM_MAX)
  expect(fromName({ origin: 'a\u001bb' })).toBe('aU+001Bb')
})

// ---------------------------------------------------------------------------
// How many run at once

test('takeSlot: taken under the limit, refused at it; releaseSlot gives back its own alone', () => {
  let slots = takeSlot([], 1000, 'a', 500, 2).slots
  const second = takeSlot(slots, 1000, 'b', 500, 2)
  expect(second.taken).toBe(true)
  slots = second.slots
  expect(slots).toEqual([
    { token: 'a', until: 1500 },
    { token: 'b', until: 1500 },
  ])
  const third = takeSlot(slots, 1000, 'c', 500, 2)
  expect(third.taken).toBe(false)
  expect(third.slots).toEqual(slots)
  slots = releaseSlot(slots, 'a')
  expect(slots).toEqual([{ token: 'b', until: 1500 }])
  expect(releaseSlot(slots, 'zzz')).toEqual(slots)
  expect(takeSlot(slots, 1000, 'c', 500, 2).taken).toBe(true)
})

test('takeSlot: a slot past its time is let go, one not yet past is not', () => {
  const held = [
    { token: 'a', until: 1500 },
    { token: 'b', until: 2000 },
    { token: 'c', until: 2500 },
  ]
  expect(takeSlot(held, 1499, 'd', 100, EXEC_CONCURRENT_MAX).taken).toBe(false)
  const r = takeSlot(held, 1500, 'd', 100, EXEC_CONCURRENT_MAX)
  expect(r.taken).toBe(true)
  expect(r.slots.map(s => s.token)).toEqual(['b', 'c', 'd'])
  expect(liveSlots(held, 2000)).toEqual([{ token: 'c', until: 2500 }])
  expect(liveSlots(held, undefined)).toEqual(held)
})

test('takeSlot: with the time unknown, every slot counts and the new one holds until 0', () => {
  const held = [{ token: 'a', until: 10 }]
  const r = takeSlot(held, undefined, 'b', 100, 2)
  expect(r).toEqual({ slots: [{ token: 'a', until: 10 }, { token: 'b', until: 0 }], taken: true })
  expect(takeSlot(r.slots, undefined, 'c', 100, 2).taken).toBe(false)
  // The time read again: both let go.
  expect(takeSlot(r.slots, 11, 'c', 100, 2).slots).toEqual([{ token: 'c', until: 111 }])
})

// ---------------------------------------------------------------------------
// The history

const entry = (n: number, over: Partial<ExecHistoryEntry> = {}): ExecHistoryEntry => ({
  at: n,
  id: 'upper',
  path: '/Users/me/bin/upper.sh',
  args: '[]',
  result: 'ok',
  from: 'composer',
  ...over,
})

test('historyEntry: the path and arguments shown safe and cut, the exit code with exit alone, an unknown time 0', () => {
  const e = historyEntry({ at: 5, id: 'upper', realPath: '/a\u001b', args: ['x'.repeat(1000)], result: 'exit', exitCode: 3, from: 'bridge' })
  expect(e.path).toBe('/aU+001B')
  expect(e.args).toHaveLength(HISTORY_ARGS_MAX)
  expect(e).toMatchObject({ at: 5, id: 'upper', result: 'exit', exitCode: 3, from: 'bridge' })
  expect(historyEntry({ at: 5, id: 'u', realPath: '/a', args: [], result: 'ok', exitCode: 0, from: 'x' })).not.toHaveProperty('exitCode')
  expect(historyEntry({ at: undefined, id: 'u', realPath: '/a', args: [], result: 'timeout', from: 'x' }).at).toBe(0)
  expect(historyEntry({ at: -1, id: 'u', realPath: '/a', args: [], result: 'notStarted', from: 'x' }).at).toBe(0)
  // The path cut as a reason shows it (pathShown: at most 200).
  expect(historyEntry({ at: 1, id: 'u', realPath: `/${'p'.repeat(400)}`, args: [], result: 'ok', from: 'x' }).path).toHaveLength(200)
})

test('parseHistory: what is not of the shape left out, 0 kept as an unknown time, the newest EXEC_HISTORY_MAX', () => {
  expect(parseHistory(undefined)).toEqual([])
  expect(parseHistory({})).toEqual([])
  const good = [entry(0), entry(2, { result: 'exit', exitCode: 1 }), entry(3, { result: 'timeout' }), entry(4, { result: 'notStarted' })]
  const bad = [null, 'x', entry(-1), entry(1.5), { ...entry(5), id: 3 }, { ...entry(6), result: 'boom' }, { ...entry(7), exitCode: 'x' }, { ...entry(8), from: undefined }]
  expect(parseHistory([...good, ...bad])).toEqual(good)
  const many = Array.from({ length: EXEC_HISTORY_MAX + 5 }, (_, i) => entry(i + 1))
  expect(parseHistory(many)).toEqual(many.slice(5))
})

test('appendHistory: added last, the oldest gone past EXEC_HISTORY_MAX', () => {
  let list: ExecHistoryEntry[] = []
  for (let i = 1; i <= EXEC_HISTORY_MAX; i++) list = appendHistory(list, entry(i))
  expect(list).toHaveLength(EXEC_HISTORY_MAX)
  list = appendHistory(list, entry(EXEC_HISTORY_MAX + 1))
  expect(list).toHaveLength(EXEC_HISTORY_MAX)
  expect(list[0]?.at).toBe(2)
  expect(list.at(-1)?.at).toBe(EXEC_HISTORY_MAX + 1)
})

// ---------------------------------------------------------------------------
// What `/quick-actions exec-approvals` lists

const UTC = () => 0
const APPROVAL = { path: '/Users/me/bin/upper.sh', args: ['--fixed'], sha256: 'abcdef0123456789'.repeat(4) }

test('approvalsListText: nothing kept, said so, with the origin limit and how to revoke', () => {
  for (const lang of ['ja', 'en'] as const) {
    const t = MESSAGES[lang]
    const text = approvalsListText(lang, {}, [], false, UTC)
    expect(text).toContain(t.execAdminOrigin(false))
    expect(text).toContain(t.execAdminNoApprovals)
    expect(text).toContain(t.execAdminNoHistory)
    expect(text).toContain(t.execAdminUsage)
    expect(approvalsListText(lang, {}, [], true, UTC)).toContain(t.execAdminOrigin(true))
  }
})

test('approvalsListText: a store that could not be read is said so, never passed off as nothing kept', () => {
  for (const lang of ['ja', 'en'] as const) {
    const t = MESSAGES[lang]
    const neither = approvalsListText(lang, undefined, undefined, false, UTC)
    expect(neither).toContain(t.execAdminApprovalsUnreadable)
    expect(neither).toContain(t.execAdminHistoryUnreadable)
    expect(neither).not.toContain(t.execAdminNoApprovals)
    expect(neither).not.toContain(t.execAdminNoHistory)
    expect(neither).toContain(t.execAdminUsage)
    // One read, the other not: each said as it is.
    const approvalsOnly = approvalsListText(lang, { free: APPROVAL }, undefined, false, UTC)
    expect(approvalsOnly).toContain(t.execAdminApprovals(1))
    expect(approvalsOnly).toContain(t.execAdminHistoryUnreadable)
    const historyOnly = approvalsListText(lang, undefined, [], false, UTC)
    expect(historyOnly).toContain(t.execAdminApprovalsUnreadable)
    expect(historyOnly).toContain(t.execAdminNoHistory)
  }
})

test('approvalsListText: the approvals by ID, the start of each SHA-256', () => {
  const t = MESSAGES.en
  const text = approvalsListText('en', { zeta: APPROVAL, alpha: { ...APPROVAL, args: [] } }, [], false, UTC)
  expect(text).toContain(t.execAdminApprovals(2))
  expect(text).toContain(`- ${t.execAdminApprovalLine('alpha', APPROVAL.path, '[]', 'abcdef012345')}`)
  expect(text).toContain(`- ${t.execAdminApprovalLine('zeta', APPROVAL.path, '["--fixed"]', 'abcdef012345')}`)
  expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zeta'))
  expect(text).toContain(t.execAdminNoHistory)
})

test('approvalsListText: the runs newest first, HISTORY_LISTED of them, an unknown time and origin said so', () => {
  const t = MESSAGES.ja
  const history = Array.from({ length: 25 }, (_, i) => entry(Date.UTC(2026, 9, 13, 12, 0, i), { id: `a${i}` }))
  history.push(entry(0, { id: 'nowhen', result: 'exit', exitCode: 7, from: 'unknown' }))
  const text = approvalsListText('ja', {}, history, false, UTC)
  expect(text).toContain(t.execAdminHistory(HISTORY_LISTED, history.length))
  expect(text).toContain(`- ${t.execAdminHistoryLine(t.execAdminUnknownTime, 'nowhen', entry(0).path, t.execAdminOutcome('exit', 7), 'unknown')}`)
  expect(text).toContain(`- ${t.execAdminHistoryLine('2026-10-13 12:00:24', 'a24', entry(0).path, t.execAdminOutcome('ok'), 'composer')}`)
  expect(text.indexOf('nowhen')).toBeLessThan(text.indexOf('a24'))
  // The oldest beyond HISTORY_LISTED left out.
  expect(text).not.toContain(' a5 ')
  expect(text).toContain(' a6 ')
})

test('approvalsListText: hidden characters from the store are named', () => {
  const text = approvalsListText('en', { 'x‮': { ...APPROVAL, path: '/a\u001b' } }, [entry(1, { path: '/b⁦', from: 'c\u0007' })], false, UTC)
  expect(text).not.toMatch(/[\u001b‮⁦\u0007]/)
  expect(text).toContain('xU+202E')
  expect(text).toContain('/aU+001B')
  expect(text).toContain('/bU+2066')
  expect(text).toContain('cU+0007')
})

test('localStamp: the local wall clock; 0 is no time', () => {
  const at = Date.UTC(2026, 0, 2, 3, 4, 5)
  expect(localStamp(at, () => 0)).toBe('2026-01-02 03:04:05')
  expect(localStamp(at, () => 540)).toBe('2026-01-02 12:04:05')
  expect(localStamp(0, () => 0)).toBeUndefined()
})

test('exec-approvals is a reserved ID: a custom definition with it is left out', () => {
  const r = parseCustomActions(JSON.stringify([{ id: EXEC_ADMIN_ARG, icon: 'x', label: 'X', kind: 'complete', model: 'haiku', prompt: 'p' }]), [EXEC_ADMIN_ARG])
  expect(r.specs).toEqual([])
  expect(r.problems[0]?.reason).toEqual({ code: 'idReserved' })
})
