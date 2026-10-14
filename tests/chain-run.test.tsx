import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { LOCAL_SELECTION_LIMIT, LOCAL_TEXT_LIMIT } from '../hooks/actions'
import { utf8Encode } from '../hooks/codec'
import { displaySafe } from '../hooks/custom'
import { ALLOWLIST_RELATIVE, APPROVALS_KEY, ENV_BIN, EXEC_STDIN_MAX, HISTORY_KEY } from '../hooks/exec'
import { MESSAGES } from '../hooks/i18n'
import { sha256 } from '../hooks/sha'
import { BAND, EN, EVERY_ACTION_FITS, PANE, PICKER_FILTER, PICKER_PANE, PLUGIN, defaultProcessAnswer, execWorld, hintIcons, listedActions, runCommand, showKind, stage, start, storedUsage } from './stage'
import type { Stage } from './stage'

// Chains (kind `chain`, SELM-00123) run through the plugin: each step on the
// output of the one before, the step shown while it runs, the last output (or
// every step's) at the end, a failure stopping the chain where it happens,
// and the exec guards a chain may not get round: the gate, the checks and
// the approval before any model is called, and the checks again right before
// the exec step. The models, the file system, the settings, the approval
// dialog and the process are all mocked (tests/stage.tsx): nothing here
// starts a command.

const HOME = '/Users/me'
const ALLOW = `${HOME}/${ALLOWLIST_RELATIVE}`
const TOOL = `${HOME}/bin/save.sh`
const SCRIPT = '#!/bin/sh\ncat >> notes.txt\n'
const OTHER = '#!/bin/sh\nrm -rf ~\n'
const hashOf = (text: string) => sha256(utf8Encode(text))

const ASK = { id: 'mine', icon: 'A', label: 'Ask', kind: 'complete', model: 'haiku', prompt: 'Translate.' }
const TWO = { id: 'two', icon: 'B', label: 'Sum', kind: 'complete', model: 'sonnet', prompt: 'Summarize.' }
const SUB = { id: 'sub', icon: 'S', label: 'Look', kind: 'subagent', model: 'sonnet', prompt: 'Look.', task: 'Look it up.' }
const SAVE = { id: 'save', icon: '🫙', label: 'Save', kind: 'exec', command: TOOL }
const chain = (id: string, steps: string[], more: Record<string, unknown> = {}) => ({ id, icon: '🔗', label: `Chain ${id}`, kind: 'chain', steps, ...more })

const CC = chain('cc', ['mine', 'two'])
const SHOWN = chain('shown', ['mine', 'two'], { showSteps: true })
const CS = chain('cs', ['mine', 'sub'])
const CE = chain('ce', ['mine', 'save'])
const CE2 = chain('ce2', ['save', 'mine', 'save'], { showSteps: true })
const URLS = chain('urls', ['mine', 'open-urls', 'two'], { showSteps: true })
const COUNT = chain('count', ['mine', 'count-text'])
const TIMED = chain('timed', ['timer', 'mine'])
const LONG = chain('long', ['save', 'mine'], { showSteps: true })
const SC = chain('sc', ['sub', 'two'])
const DEFS = [ASK, TWO, SUB, SAVE, CC, SHOWN, CS, CE, CE2, URLS, COUNT, TIMED, LONG, SC]
const SETTING = JSON.stringify(DEFS)
const OPTIONS = { ...EN, customActions: SETTING }

const t = MESSAGES.en

/** The user settings that hold `setting` as this plugin's customActions, under one entry. */
const userSettings = (setting: string, more: Record<string, unknown> = {}) => ({ pluginConfigs: { [`${PLUGIN}@market`]: { options: { customActions: setting, ...more } } } })

/** The world where the exec actions may run, as tests/exec-run.test.tsx sets it up: the person's own settings, TOOL allowed, the dialog approving. */
function setUp(on: On, opts: { setting?: string; answer?: string | null } = {}) {
  const s = stage(on)
  const w = execWorld(on, {
    env: { HOME, LANG: 'en_US.UTF-8' },
    files: {
      [HOME]: { kind: 'dir' },
      '/repo': { kind: 'dir' },
      [ALLOW]: { content: JSON.stringify({ executables: [{ path: TOOL }] }) },
      [TOOL]: { content: SCRIPT },
    },
    answer: opts.answer === undefined ? t.execApprove : opts.answer,
  })
  s.sourceSettings.user = userSettings(opts.setting ?? SETTING)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: 'SAVED\n' } : defaultProcessAnswer(argv))
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

const paneText = async ($: Engine) => (await paneTexts($)).join('\n')

/** A held model call: every complete and fork call waits until `release()`. */
function holdModels(s: Stage) {
  let release = () => {}
  s.hold = new Promise<void>(resolve => (release = resolve))
  return () => {
    s.hold = null
    release()
  }
}

const fromAfar = (kind: 'bridge' | 'sdk', args: string) =>
  ({ command: PLUGIN, args, origin: { kind }, presentation: { isFullscreen: true, columns: 120 } }) as const

// ---------------------------------------------------------------------------
// Steps one after another

test('complete then complete: the second step gets the first one\'s output as its selection; the last output alone is shown', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'hello world'
  await clock.advance(400)
  const r = await runCommand($, 'cc')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(t.showing('Quick Actions', 'Chain cc'))
  expect(s.models.map(m => m.model)).toEqual(['haiku', 'sonnet'])
  expect(s.models[0]?.prompt).toContain('hello world')
  expect(s.models[0]?.system).toContain('Translate.')
  expect(s.models[1]?.prompt).toContain('<selected>\nanswer from haiku\n</selected>')
  expect(s.models[1]?.prompt).not.toContain('hello world')
  expect(s.models[1]?.system).toContain('Summarize.')
  const texts = await paneTexts($)
  expect(texts).toContain('answer from sonnet')
  expect(texts.join('\n')).not.toContain('answer from haiku')
  expect(texts.join('\n')).not.toContain(t.chainStep(1, 2, 'Ask'))
  // One use, the chain's.
  await clock.settle()
  expect(Object.keys(storedUsage(s) ?? {})).toEqual(['cc'])
})

test('showSteps: every step\'s output under its heading, in order', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'shown')
  await clock.settle()
  expect(await paneTexts($)).toContain(`${t.chainStep(1, 2, 'Ask')}\nanswer from haiku\n\n${t.chainStep(2, 2, 'Sum')}\nanswer from sonnet`)
})

test('while it runs, the pane shows the step at which it is: step n/N and its label', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  const release = holdModels(s)
  const run = runCommand($, 'cc')
  await clock.settle()
  expect(await paneTexts($)).toContain(t.chainStep(1, 2, 'Ask'))
  release()
  await run
  await clock.settle()
  expect(await paneTexts($)).toContain('answer from sonnet')
})

test('from the hint line and the ⋯ dialog: a chain on the selection is listed and runs as any action', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  expect(await hintIcons(band)).toContain('[🔗]')
  await band.press({ key: 'cc' })
  await clock.settle()
  expect(s.models).toHaveLength(2)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  // The most used first: the chain just run.
  expect((await listedActions(picker))[0]).toBe('cc')
})

test('a chain starting on the conversation, or standalone, is listed and run as its first step is', { options: { ...EN, customActions: JSON.stringify([ASK, chain('talk', ['recap', 'mine']), chain('alone', ['uuid', 'mine'])]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'hint')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  await showKind(band, 'context')
  expect(await hintIcons(band)).toContain('<🔗>')
  await band.press({ key: 'talk' })
  await clock.settle()
  expect(s.forks).toHaveLength(1)
  expect(s.models[0]?.prompt).toContain('answer in context')
  // Standalone: its first step's argument (a local one here), then the model on its output.
  await runCommand($, 'alone')
  await clock.settle()
  expect(s.models).toHaveLength(2)
  expect(s.models[1]?.prompt).toMatch(/<selected>\n(\S*?)[0-9a-f]{8}-[0-9a-f]{4}-4/)
})

// The subagent's id is set by core alone, so a test cannot run one to its
// answer (see tests/kinds.test.tsx): this checks the spawn on the output
// before it, and that a spawn answered with no id fails the step rather than
// leaving the chain running.
test('subagent as a step: spawned on the output before it, as the action is; no agent id fails the step, never left running', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'cs')
  await clock.settle()
  expect(s.registered.map(r => r.name)).toEqual(['sub'])
  expect(s.spawned).toHaveLength(1)
  expect(s.spawned[0]?.subagentType).toBe(`${PLUGIN}:sub`)
  expect(s.spawned[0]?.prompt).toContain('Look it up.')
  expect(s.spawned[0]?.prompt).toContain('<selected>\nanswer from haiku\n</selected>')
  expect(s.spawned[0]?.prompt).not.toContain('hello')
  expect(await paneTexts($)).toContain(t.chainStepFailed(2, 2, 'Look', t.couldNotStart('no agent id')))
})

test('subagent as a step: a spawn refused stops the chain there, saying why', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  s.spawnDeny = 'no room'
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'cs')
  await clock.settle()
  expect(await paneText($)).toContain(t.chainStepFailed(2, 2, 'Look', t.couldNotStart('no room')))
})

test('subagent as a step: registering it throwing stops the chain there, saying it could not start', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.refuse = 'not now'
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'sc')
  await clock.settle()
  expect(s.spawned).toEqual([])
  expect(s.models).toEqual([])
  const text = await paneText($)
  expect(text).toContain(t.chainStepFailed(1, 2, 'Look', t.couldNotStart('')))
  expect(text).toContain('not now')
})

// A step's subagent that could not start says why with displaySafe applied,
// as the action run alone does: refused or thrown, a raw control or
// bidirectional character in the reason is shown as U+XXXX.
const UNSAFE = 'bad\u0007\u202Ename'

test('subagent as a step: a spawn refused for a reason with control characters shows them as U+XXXX', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  s.spawnDeny = UNSAFE
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'cs')
  await clock.settle()
  const text = await paneText($)
  expect(text).toContain(t.chainStepFailed(2, 2, 'Look', t.couldNotStart(displaySafe(UNSAFE))))
  expect(text).not.toContain('\u0007')
  expect(text).not.toContain('\u202E')
})

test('subagent as a step: registering it throwing with control characters shows them as U+XXXX', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.refuse = UNSAFE
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'sc')
  await clock.settle()
  const text = await paneText($)
  expect(text).toContain(t.chainStepFailed(1, 2, 'Look', t.couldNotStart('')))
  expect(text).toContain('badU+0007U+202Ename')
  expect(text).not.toContain('\u0007')
  expect(text).not.toContain('\u202E')
})

// ---------------------------------------------------------------------------
// Failures

test('a step that fails stops the chain there: the steps after it never run; what failed and why shown, with the outputs so far under showSteps', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  // The first step's output has a URL: open-urls would open it, which a chain does not do.
  s.answerText = 'see https://example.com/'
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'urls')
  await clock.settle()
  expect(s.models).toHaveLength(1)
  expect(s.processRuns.filter(r => r.argv[0] !== 'uname')).toEqual([])
  const text = await paneText($)
  expect(text).toContain(`${t.chainStep(1, 3, 'Ask')}\nsee https://example.com/\n\n${t.chainStepFailed(2, 3, 'Open URLs', t.chainLocalEffect)}`)
})

test('the first step failing: nothing after it, the failure alone without showSteps', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.answer = 'empty'
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'cc')
  await clock.settle()
  expect(s.models).toHaveLength(1)
  expect(await paneTexts($)).toContain(t.chainStepFailed(1, 2, 'Ask', t.noAnswer('empty-reply')))
})

test('an output empty before the last step fails it: nothing is passed on', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.answerText = '   '
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'cc')
  await clock.settle()
  expect(s.models).toHaveLength(1)
  expect(await paneTexts($)).toContain(t.chainStepFailed(1, 2, 'Ask', t.chainEmptyOutput))
})

test('a text past a local step\'s limit fails that step, saying how long it is', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.answerText = 'x'.repeat(LOCAL_SELECTION_LIMIT + 1)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'count')
  await clock.settle()
  expect(await paneText($)).toContain(t.chainStepFailed(2, 2, 'Count characters', t.selectionTooLong(LOCAL_SELECTION_LIMIT + 1, LOCAL_SELECTION_LIMIT)))
  // Within it, the local step runs on the output.
  s.answerText = 'abc'
  await runCommand($, 'count')
  await clock.settle()
  expect((await paneTexts($)).some(x => x.includes('3'))).toBe(true)
})

test('a local step that would run over time fails: a chain does not', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'timed 5m')
  await clock.settle()
  expect(s.models).toEqual([])
  expect(await paneText($)).toContain(t.chainStepFailed(1, 2, 'Timer', t.chainLocalTicker))
  // Run again, the same.
  await runCommand($, 'timed')
  await clock.settle()
  expect((await paneTexts($)).filter(x => x.includes(t.chainLocalTicker))).toHaveLength(2)
})

// ---------------------------------------------------------------------------
// Exec steps

test('selection, model, then exec: approved before any model is called; the model\'s output on the exec step\'s stdin', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  let modelsAtAsk = -1
  w.onAsk = () => {
    modelsAtAsk = s.models.length
  }
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'ce')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(modelsAtAsk).toBe(0)
  expect(w.asked[0]?.question).toContain(TOOL)
  expect(s.stored[APPROVALS_KEY]).toEqual({ save: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } })
  expect(execRuns(s).map(r => r.stdin)).toEqual(['answer from haiku'])
  expect(execRuns(s)[0]?.argv).toContain('QUICK_ACTIONS_TARGET=selection')
  expect(await paneTexts($)).toContain('SAVED')
  // The history keeps the exec step by its own ID.
  expect((s.stored[HISTORY_KEY] as { id: string }[]).map(e => e.id)).toEqual(['save'])
  // Approved once: shared with the action run alone.
  await runCommand($, 'save')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
})

test('one exec definition in two steps: asked once; each step\'s output passed on as written, shown escaped', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: 'line \u001b[1m\n' } : defaultProcessAnswer(argv))
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'ce2')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(execRuns(s).map(r => r.stdin)).toEqual(['hello', 'answer from haiku'])
  // The model got the exec step's output as written.
  expect(s.models[0]?.prompt).toContain('line \u001b[1m')
  const text = await paneText($)
  expect(text).toContain(`${t.chainStep(1, 3, 'Save')}\nline \\u001b[1m`)
  expect(text).not.toContain('\u001b')
})

test('an exec step\'s output cut at its limit is not passed on: the step fails', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: 'partial', isStdoutTruncated: true } : defaultProcessAnswer(argv))
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'ce2')
  await clock.settle()
  expect(s.models).toEqual([])
  expect(await paneText($)).toContain(t.chainStepFailed(1, 3, 'Save', t.chainOutputCut))
})

test('a text past 1 MiB for an exec step fails that step: nothing runs', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  await start($)
  s.answerText = 'x'.repeat(EXEC_STDIN_MAX + 1)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'ce')
  await clock.settle()
  expect(execRuns(s)).toEqual([])
  expect(await paneText($)).toContain(t.chainStepFailed(2, 2, 'Save', t.customReason({ code: 'execInputTooLarge', max: EXEC_STDIN_MAX })))
})

test('an exec step that exits with another code stops the chain, saying so', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 4, stderr: 'disk full' } : defaultProcessAnswer(argv))
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'ce2')
  await clock.settle()
  expect(s.models).toEqual([])
  const text = await paneText($)
  expect(text).toContain(t.chainStepFailed(1, 3, 'Save', t.execExit(4)))
  expect(text).toContain('disk full')
})

// ---------------------------------------------------------------------------
// What is shown when the outputs are long

test('showSteps, a long output before a failing step: the failure is still shown, the output before cut to make room', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  const long = 'x'.repeat(30_000)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: long } : defaultProcessAnswer(argv))
  s.answer = 'empty'
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'long')
  await clock.settle()
  const text = await paneText($)
  expect(text).toContain(t.chainStepFailed(2, 2, 'Ask', t.noAnswer('empty-reply')))
  expect(text).toContain(`${t.chainStep(1, 2, 'Save')}\n${'x'.repeat(LOCAL_TEXT_LIMIT)}\n${t.truncated}`)
  expect(text).not.toContain('x'.repeat(LOCAL_TEXT_LIMIT + 1))
})

test('showSteps, a long output before the last step: the last output is still shown, the output before cut to make room', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: 'x'.repeat(30_000) } : defaultProcessAnswer(argv))
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'long')
  await clock.settle()
  // The whole output was passed on; only its showing is cut.
  expect(s.models[0]?.prompt).toContain('x'.repeat(30_000))
  const text = await paneText($)
  expect(text).toContain(`${t.chainStep(1, 2, 'Save')}\n${'x'.repeat(LOCAL_TEXT_LIMIT)}\n${t.truncated}\n\n${t.chainStep(2, 2, 'Ask')}\nanswer from haiku`)
})

test('an exec last step: its output shown as the action run alone shows it, past LOCAL_TEXT_LIMIT, said to be cut once', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  const long = 'y'.repeat(LOCAL_TEXT_LIMIT + 5_000)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: long } : defaultProcessAnswer(argv))
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'ce')
  await clock.settle()
  let text = await paneText($)
  expect(text).toContain(long)
  expect(text).not.toContain(t.truncated)
  // Cut by $.process.run: said so once, as the action run alone says it.
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: 'partial', isStdoutTruncated: true } : defaultProcessAnswer(argv))
  await runCommand($, 'ce')
  await clock.settle()
  text = await paneText($)
  expect(text).toContain(`partial\n\n${t.execTruncated}`)
  expect(text).not.toContain(t.truncated)
  expect(text.split(t.execTruncated)).toHaveLength(2)
})

// ---------------------------------------------------------------------------
// The exec guards: before anything runs

test('the approval declined: no model is ever called, nothing runs; why shown and toasted', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on, { answer: t.execCancel })
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'ce')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(s.models).toEqual([])
  expect(execRuns(s)).toEqual([])
  const failure = t.chainStepFailed(2, 2, 'Save', t.customReason({ code: 'execDeclined' }))
  expect(await paneTexts($)).toContain(failure)
  expect(s.toasts.some(x => x.includes(failure))).toBe(true)
})

test('not approved and run from afar: never asked, no model called (execRemote)', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await $.command.run(fromAfar('bridge', 'ce'))
  await clock.settle()
  expect(w.asked).toEqual([])
  expect(s.models).toEqual([])
  expect(await paneText($)).toContain(t.chainStepFailed(2, 2, 'Save', t.customReason({ code: 'execRemote' })))
  // Approved at the terminal: then it runs from afar too.
  await runCommand($, 'ce')
  await clock.settle()
  await $.command.run(fromAfar('bridge', 'ce'))
  await clock.settle()
  expect(execRuns(s)).toHaveLength(2)
  expect(w.asked).toHaveLength(1)
})

test('execOrigin terminal: approved, still refused from afar before any model call', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  s.sourceSettings.user = userSettings(SETTING, { execOrigin: 'terminal' })
  s.stored[APPROVALS_KEY] = { save: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await $.command.run(fromAfar('sdk', 'ce'))
  await clock.settle()
  expect(s.models).toEqual([])
  expect(execRuns(s)).toEqual([])
  expect(await paneText($)).toContain(t.customReason({ code: 'execOrigin' }))
})

test('an exec step not in the allowlist: the chain is refused by the gate, on neither the hint line nor the dialog, told at its own place', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  w.files[ALLOW] = { content: JSON.stringify({ executables: [{ path: `${HOME}/bin/other.sh` }] }) }
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  const inner = t.customReason({ code: 'execNotAllowed', path: TOOL })
  const reason = t.customReason({ code: 'chainStepRejected', step: 2, id: 'save', reason: { code: 'execNotAllowed', path: TOOL } })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  const icons = await hintIcons(band)
  expect(icons).toContain('[A]')
  expect(icons).not.toContain('[🫙]')
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  // The chains alone, by their labels.
  await picker.input({ key: PICKER_FILTER, text: 'Chain', kind: 'change' })
  const listed = await listedActions(picker)
  expect(listed).toEqual(expect.arrayContaining(['cc', 'shown', 'cs', 'urls']))
  for (const id of ['ce', 'ce2']) expect(listed).not.toContain(id)
  const r = await runCommand($, 'ce')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(JSON.stringify(t.customIgnoredId('ce', reason)).slice(1, -1))
  expect(JSON.stringify(r)).toContain(JSON.stringify(`#8 (ce): ${reason}`).slice(1, -1))
  expect(reason).toContain(inner)
  expect(w.asked).toEqual([])
  expect(s.models).toEqual([])
  expect(execRuns(s)).toEqual([])
})

test('a chain from other than the person\'s user settings (a project\'s): its exec step refused, so is the chain', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  s.sourceSettings.user = userSettings('[]')
  s.sourceSettings.project = userSettings(SETTING)
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  const r = await runCommand($, 'ce')
  await clock.settle()
  expect(JSON.stringify(r)).toContain(JSON.stringify(t.customReason({ code: 'chainStepRejected', step: 2, id: 'save', reason: { code: 'execScope', why: 'mismatch' } })).slice(1, -1))
  expect(w.asked).toEqual([])
  expect(s.models).toEqual([])
  expect(execRuns(s)).toEqual([])
  // A chain with no exec step runs as before.
  await runCommand($, 'cc')
  await clock.settle()
  expect(s.models).toHaveLength(2)
})

test('no exec definition: a chain alone reads no settings source and no file', { options: { ...EN, customActions: JSON.stringify([ASK, TWO, CC]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = execWorld(on, {})
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'cc')
  await clock.settle()
  expect(s.models).toHaveLength(2)
  expect(s.sourceReads).toEqual([])
  expect(w.reads).toEqual([])
})

// ---------------------------------------------------------------------------
// The exec guards: again, right before the exec step, after a model's step

/**
 * Runs `ce` from `from` with the model held, does `change` while it waits,
 * then lets the model answer: the exec step's checks run after the change.
 */
async function changedMidway($: Engine, s: Stage, clock: { settle: () => Promise<void> }, change: () => Promise<void> | void, args: Parameters<Engine['command']['run']>[0] | string = 'ce') {
  s.selected = 'hello'
  await clock.settle()
  const release = holdModels(s)
  const run = typeof args === 'string' ? runCommand($, args) : $.command.run(args)
  await clock.settle()
  expect(s.models).toHaveLength(1)
  await change()
  release()
  await run
  await clock.settle()
}

const approved = (s: Stage) => {
  s.stored[APPROVALS_KEY] = { save: { path: TOOL, args: [], sha256: hashOf(SCRIPT) } }
}

test('the approval revoked while a model\'s step ran: the exec step does not run, nothing asked (execApprovalGone)', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  approved(s)
  await start($)
  await changedMidway($, s, clock, async () => {
    await runCommand($, 'exec-approvals revoke save')
  })
  expect(w.asked).toEqual([])
  expect(execRuns(s)).toEqual([])
  expect(await paneText($)).toContain(t.chainStepFailed(2, 2, 'Save', t.customReason({ code: 'execApprovalGone' })))
})

test('the executable taken out of the allowlist while a model\'s step ran: the exec step does not run', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  approved(s)
  await start($)
  await changedMidway($, s, clock, () => {
    w.files[ALLOW] = { content: JSON.stringify({ executables: [] }) }
  })
  expect(execRuns(s)).toEqual([])
  expect(await paneText($)).toContain(t.chainStepFailed(2, 2, 'Save', t.customReason({ code: 'execNotAllowed', path: TOOL })))
})

test('the executable replaced while a model\'s step ran: the exec step does not run (execChanged), nothing asked', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  approved(s)
  await start($)
  await changedMidway($, s, clock, () => {
    w.files[TOOL] = { content: OTHER }
  })
  expect(w.asked).toEqual([])
  expect(execRuns(s)).toEqual([])
  expect(await paneText($)).toContain(t.chainStepFailed(2, 2, 'Save', t.customReason({ code: 'execChanged' })))
})

test('execOrigin set to terminal while a model\'s step ran (run from afar): the exec step does not run', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  approved(s)
  await start($)
  await changedMidway(
    $,
    s,
    clock,
    () => {
      s.sourceSettings.user = userSettings(SETTING, { execOrigin: 'terminal' })
    },
    fromAfar('bridge', 'ce'),
  )
  expect(execRuns(s)).toEqual([])
  expect(await paneText($)).toContain(t.chainStepFailed(2, 2, 'Save', t.customReason({ code: 'execOrigin' })))
})

test('run once more: every step runs again, and the exec checks and the approval are done again before any model call', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = setUp(on)
  await start($)
  s.selected = 'hello'
  await clock.advance(400)
  await runCommand($, 'ce')
  await clock.settle()
  expect(w.asked).toHaveLength(1)
  expect(s.models).toHaveLength(1)
  expect(execRuns(s)).toHaveLength(1)
  // A chain's entry runs over no time: it offers no "again" button; running it once more is running it again.
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => k.startsWith('_again-'))).toEqual([])
  await pane.unmount()
  // The executable changed since: the approval no longer holds, so it is asked again, before the model.
  w.files[TOOL] = { content: `${SCRIPT}# v2\n` }
  let modelsAtAsk = -1
  w.onAsk = () => {
    modelsAtAsk = s.models.length
  }
  await runCommand($, 'ce')
  await clock.settle()
  expect(w.asked).toHaveLength(2)
  expect(modelsAtAsk).toBe(1)
  expect(s.models).toHaveLength(2)
  expect(execRuns(s).map(r => r.stdin)).toEqual(['answer from haiku', 'answer from haiku'])
  expect(s.stored[APPROVALS_KEY]).toEqual({ save: { path: TOOL, args: [], sha256: hashOf(`${SCRIPT}# v2\n`) } })
  // Declined this time: nothing runs, no model is called.
  w.files[TOOL] = { content: OTHER }
  w.answer = t.execCancel
  await runCommand($, 'ce')
  await clock.settle()
  expect(w.asked).toHaveLength(3)
  expect(s.models).toHaveLength(2)
  expect(execRuns(s)).toHaveLength(2)
})

// A reload while a chain runs (chainReloaded) cannot be made here: the kit
// loads the module once per test, and a test's own import of it is another
// instance. recheckExec checks it first, by the load's identity alone.

test('nothing changed meanwhile: the exec step runs after the held model\'s step', { options: OPTIONS }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = setUp(on)
  approved(s)
  await start($)
  await changedMidway($, s, clock, () => {}, fromAfar('bridge', 'ce'))
  expect(execRuns(s).map(r => r.stdin)).toEqual(['answer from haiku'])
})
