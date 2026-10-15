import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ACTIONS, actionsFor, markedIcon, needsSelection } from '../hooks/actions'
import { ADHOC_CHAIN_ID, CHAIN_ICON } from '../hooks/compose'
import { reasonText } from '../hooks/custom'
import { ALLOWLIST_RELATIVE, ENV_BIN } from '../hooks/exec'
import { MESSAGES } from '../hooks/i18n'
import type { Lang } from '../hooks/i18n'
import type { Result } from '../types'
import {
  BAND,
  EN,
  EVERY_ACTION_FITS,
  JA,
  PANE,
  PICKER_CLOSE,
  PICKER_FILTER,
  PICKER_PANE,
  PLUGIN,
  configWorld,
  defaultProcessAnswer,
  execWorld,
  hintIcons,
  listedActions,
  pickAction,
  promptOf,
  runCommand,
  showKind,
  stage,
  start,
  storedUsage,
} from './stage'
import type { Stage } from './stage'

/** The mocked clock, as far as these tests need it. */
type Clock = { advance: (ms: number) => Promise<unknown>; settle: () => Promise<unknown> }

// Chains put together on the spot (SELM-00128): the hint line's ⛓ mode and
// the ⋯ dialog's multi-select stack actions rather than run them, run them in
// order through the chain's own way (runChain: its gate, checks and
// approvals), and the result pane saves one as a custom action (kind
// `chain`) in the user settings' customActions. The models, the settings,
// the file system and $.config.set are all mocked (tests/stage.tsx).

const t = MESSAGES.ja
const MODE = '_chain-mode'
const UNDO = '_chain-undo'
const RUN = '_chain-run'
const TOGGLE = '_compose-toggle'
const C_UNDO = '_compose-undo'
const C_RUN = '_compose-run'
const saveKey = (id: number) => `_save-${id}`
const savedKey = (id: number) => `_saved-${id}`
const againKey = (id: number) => `_again-${id}`

const defsJa = actionsFor('ja')
const defOf = (id: string, l: Lang = 'ja') => actionsFor(l).find(d => d.id === id)!
const labelOf = (id: string, l: Lang = 'ja') => defOf(id, l).label
const systemOf = (id: string) => promptOf(defsJa.find(d => d.id === id))
/** The built-in on the selection whose labels are the longest (the shorter of the two languages'). */
const LONGEST = ACTIONS.filter(a => needsSelection(a) && a.kind !== 'local').sort((a, b) => Math.min(b.label.ja.length, b.label.en.length) - Math.min(a.label.ja.length, a.label.en.length))[0]!.id

/** The user settings that hold `setting` as this plugin's customActions, under one entry. */
const userSettings = (setting: string) => ({ pluginConfigs: { [`${PLUGIN}@market`]: { options: { customActions: setting } } } })

/**
 * The plugin's state as written (`results`, `composing`), and values a test
 * forces it to read instead (as a reload or another surface would leave them).
 */
type Watch = { results: Result[]; composing: { steps: string[] } | null; force: Partial<Record<'results' | 'composing', unknown>> }
function watch(on: On): Watch {
  const w: Watch = { results: [], composing: null, force: {} }
  on('state.set', async (_$, e, next) => {
    const r = await next(e)
    const key = (e as { key?: string }).key
    const value = (e as { value?: unknown }).value
    if ((r as { deny?: unknown }).deny === undefined && (key === 'results' || key === 'composing')) {
      if (key === 'results') w.results = value as Result[]
      else w.composing = value as Watch['composing']
      // Forced until the plugin writes it: from then on, what it wrote.
      delete w.force[key]
    }
    return r
  })
  on('state.get', async (_$, e, next) => {
    const got = await next(e)
    const key = (e as { key?: string }).key
    if ((key !== 'results' && key !== 'composing') || !Object.prototype.hasOwnProperty.call(w.force, key)) return got
    // The value forced, at the version the engine holds, so a write over it goes through.
    const held = (got as { value?: { version?: number } }).value
    return { value: { ...held, value: w.force[key] } } as never
  })
  return w
}

/** The hint line on `text` selected now, every action fitting. */
async function hintOn($: Engine, s: Stage, clock: Clock, text: string | null) {
  s.selected = text
  await clock.advance(400)
  return $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
}

/** What these tests need of a mounted hint line, dialog or pane. */
type Mounted = {
  findAll: (query: { type?: string; key?: string }) => Promise<{ key: string | undefined; props: Record<string, unknown>; text: string }[]>
  find: (query: { type?: string; key?: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> } | undefined>
  press: (target: { key: string }) => Promise<unknown>
}

/** The keys of the Buttons drawn. */
const keysOf = async (m: Mounted) => (await m.findAll({ type: 'Button' })).map(b => String(b.key))

/** Every text drawn. */
const textsOf = async (m: Mounted) => (await m.findAll({ type: 'Text' })).map(f => f.text)

/** Every text the result pane draws now. */
async function paneTexts($: Engine): Promise<string> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = await textsOf(pane)
  await pane.unmount()
  return texts.join('\n')
}

/** The result pane's buttons by key now. */
async function paneKeys($: Engine): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = await keysOf(pane)
  await pane.unmount()
  return keys
}

/** Presses the result pane's button `key`. */
async function pressInPane($: Engine, key: string) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key })
  await pane.unmount()
}

/** Stacks `ids` on the hint line in the chain mode (turned on first). */
async function stack(band: Mounted, ids: readonly string[]) {
  if (!(await keysOf(band)).includes(UNDO) && !(await textsOf(band)).some(x => x.includes(t.chainModeGuide))) await band.press({ key: MODE })
  for (const id of ids) await band.press({ key: id })
}

/** Runs `ids` from the hint line on `text`, to the end. */
async function runStack($: Engine, s: Stage, clock: Clock, text: string | null, ids: readonly string[]) {
  const band = await hintOn($, s, clock, text)
  await stack(band, ids)
  await band.press({ key: RUN })
  await clock.settle()
  await band.unmount()
}

// ---------------------------------------------------------------------------
// The hint line's ⛓ mode

test('⛓ beside ✕ and ⋯, named off; pressed, it is on (bold, underlined), named so, and the line says what a press does', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  expect((await hintIcons(band)).slice(-3)).toEqual(['✕', '⋯', CHAIN_ICON])
  expect((await band.find({ key: MODE }))?.props.label).toBe(t.chainModeName(false))
  expect(await textsOf(band)).toContain(` ${t.chainModeTip}`)
  await band.press({ key: MODE })
  const mode = await band.find({ key: MODE })
  expect(mode?.props.label).toBe(t.chainModeName(true))
  const drawn = (await band.findAll({ type: 'Text' })).find(f => f.text === CHAIN_ICON)
  expect([drawn?.props.bold, drawn?.props.underline]).toEqual([true, true])
  expect(await textsOf(band)).toContain(` ${t.chainModeGuide}`)
  // Nothing stacked yet: no ⌫ and no ▶.
  expect(await keysOf(band)).not.toContain(UNDO)
  expect(await keysOf(band)).not.toContain(RUN)
  await band.unmount()
})

test('in the chain mode a press stacks rather than runs: the icons in order, each with its label on hover, then ⌫ and ▶', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  await stack(band, ['translate-ja', 'summarize'])
  await clock.settle()
  expect(s.models).toEqual([])
  expect(s.opened).toEqual([])
  expect(w.composing).toEqual({ steps: ['translate-ja', 'summarize'] })
  const texts = await textsOf(band)
  const icons = texts.filter(x => x === defOf('translate-ja').icon || x === defOf('summarize').icon)
  expect(icons).toEqual([defOf('translate-ja').icon, defOf('summarize').icon])
  expect(texts).toContain(' › ')
  expect(texts).toContain(` ${labelOf('translate-ja')}`)
  expect(texts).toContain(` ${labelOf('summarize')}`)
  expect(await keysOf(band)).toEqual(expect.arrayContaining([UNDO, RUN]))
  expect((await band.find({ key: UNDO }))?.props.label).toBe(t.chainUndoName)
  expect((await band.find({ key: RUN }))?.props.label).toBe(t.chainRunName)
  // ⌫: the last taken off, nothing run.
  await band.press({ key: UNDO })
  expect(w.composing).toEqual({ steps: ['translate-ja'] })
  expect(s.models).toEqual([])
  // ⛓ again: off, what was stacked dropped; a press runs as before.
  await band.press({ key: MODE })
  expect(w.composing).toBeNull()
  expect(await keysOf(band)).not.toContain(RUN)
  expect((await band.find({ key: MODE }))?.props.label).toBe(t.chainModeName(false))
  await band.press({ key: 'translate-ja' })
  await clock.settle()
  expect(s.models).toHaveLength(1)
  expect(s.models[0]?.system).toBe(systemOf('translate-ja'))
  await band.unmount()
})

test('✕ on the hint line ends the chain mode: shown again, ⛓ is off and nothing is stacked', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  let band = await hintOn($, s, clock, 'Hello world')
  await stack(band, ['translate-ja'])
  await band.press({ key: 'close' })
  await band.unmount()
  expect(w.composing).toBeNull()
  expect(s.models).toEqual([])
  band = await hintOn($, s, clock, 'Hello again')
  expect((await band.find({ key: MODE }))?.props.label).toBe(t.chainModeName(false))
  expect(await keysOf(band)).not.toContain(RUN)
  await band.unmount()
})

test('closing the whole pane (closeAll) ends the chain mode too', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  await stack(band, ['translate-ja'])
  await band.press({ key: '_more' })
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.press({ key: PICKER_CLOSE })
  await picker.unmount()
  expect(w.composing).toBeNull()
  expect(s.models).toEqual([])
  expect((await band.find({ key: MODE }))?.props.label).toBe(t.chainModeName(false))
  await band.unmount()
})

test('▶ runs the steps in order through the chain\'s own way: each on the output before it, one entry headed by the labels joined, every step shown; the mode ends', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'summarize'])
  expect(s.models.map(m => m.system)).toEqual([systemOf('translate-ja'), systemOf('summarize')])
  expect(s.models[0]?.prompt).toContain('Hello world')
  expect(s.models[1]?.prompt).toContain(`<selected>\nanswer from ${s.models[0]?.model}\n</selected>`)
  expect(s.models[1]?.prompt).not.toContain('Hello world')
  expect(w.composing).toBeNull()
  const entry = w.results[0]!
  expect([entry.action, entry.chain, entry.status]).toEqual([ADHOC_CHAIN_ID, ['translate-ja', 'summarize'], 'done'])
  const pane = await paneTexts($)
  expect(pane).toContain(`${labelOf('translate-ja')} → ${labelOf('summarize')}`)
  expect(pane).not.toContain(ADHOC_CHAIN_ID)
  expect(pane).toContain(t.chainStep(1, 2, labelOf('translate-ja')))
  expect(pane).toContain(t.chainStep(2, 2, labelOf('summarize')))
  // No use counted for it: it is no action of its own.
  await clock.settle()
  expect(Object.keys(storedUsage(s) ?? {})).not.toContain(ADHOC_CHAIN_ID)
  expect(await paneKeys($)).toContain(saveKey(entry.id))
})

test('with a step stacked, the selection\'s actions are shown though no text is held; out of the mode, as before', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'hint')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  const before = await hintIcons(band)
  // No text: no selection kind, and none of its actions.
  expect(before.some(i => String(i).startsWith('['))).toBe(false)
  await band.press({ key: MODE })
  expect(await hintIcons(band)).toEqual(before.map(i => (i === CHAIN_ICON ? CHAIN_ICON : i)))
  await showKind(band, 'standalone')
  await band.press({ key: 'gitignore-template' })
  // Turned to the selection's actions.
  expect((await hintIcons(band)).some(i => String(i) === markedIcon(defOf('summarize')))).toBe(true)
  await band.unmount()
})

test('standalone first: no argument screen; its default argument; its output passed on', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  await runCommand($, 'hint')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  await band.press({ key: MODE })
  await showKind(band, 'standalone')
  await band.press({ key: 'gitignore-template' })
  await band.press({ key: 'summarize' })
  await band.press({ key: RUN })
  await clock.settle()
  await band.unmount()
  // No argument screen: the dialog was never opened on one.
  expect(s.opened.filter(o => o.focus === true)).toEqual([])
  expect(s.models.map(m => m.system)).toEqual([systemOf('gitignore-template'), systemOf('summarize')])
  expect(s.models[0]?.prompt).toContain('node')
  expect(s.models[1]?.prompt).toContain(`answer from ${s.models[0]?.model}`)
  expect(w.results[0]?.chain).toEqual(['gitignore-template', 'summarize'])
  expect(w.results[0]?.target).toBe('none')
  expect(await paneKeys($)).toContain(saveKey(w.results[0]!.id))
})

test('the conversation first: run as the context action is (a fork, no selection sent), its output passed on', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  await band.press({ key: MODE })
  await showKind(band, 'context')
  await band.press({ key: 'recap' })
  await band.press({ key: 'translate-ja' })
  await band.press({ key: RUN })
  await clock.settle()
  await band.unmount()
  expect(s.forks).toHaveLength(1)
  expect(s.forks[0]).not.toContain('Hello world')
  expect(s.models.map(m => m.system)).toEqual([systemOf('translate-ja')])
  expect(s.models[0]?.prompt).toContain('<selected>\nanswer in context\n</selected>')
  expect(w.results[0]?.chain).toEqual(['recap', 'translate-ja'])
  const pane = await paneTexts($)
  expect(pane).toContain(`${labelOf('recap')} → ${labelOf('translate-ja')}`)
  expect(pane).not.toContain(ADHOC_CHAIN_ID)
  expect(await paneKeys($)).toContain(saveKey(w.results[0]!.id))
})

test('on the selection first, with the text held gone by ▶: refused as with no selection, nothing run', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  let band = await hintOn($, s, clock, 'Hello world')
  await stack(band, ['translate-ja', 'summarize'])
  await band.unmount()
  s.selected = null
  await clock.advance(400)
  await runCommand($, 'hint')
  band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
  expect(w.composing).toEqual({ steps: ['translate-ja', 'summarize'] })
  await band.press({ key: RUN })
  await clock.settle()
  await band.unmount()
  expect(s.toasts).toContain(t.noSelection)
  expect(s.models).toEqual([])
})

test('the steps, ⌫ and ▶ are kept whole and count in the line\'s width: fewer actions beside them', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'Hello world'
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: { columns: 160, rows: 40, isFullscreen: false } })
  const actions = async () => (await hintIcons(band)).filter(i => String(i).startsWith('[')).length
  const before = await actions()
  await band.press({ key: MODE })
  await band.press({ key: 'translate-ja' })
  await band.press({ key: 'summarize' })
  await band.press({ key: 'explain' })
  expect(await actions()).toBeLessThan(before)
  const boxes = await band.findAll({ type: 'Box' })
  for (const key of ['act-_chain-mode', '_chain-steps', 'act-_chain-undo', 'act-_chain-run']) {
    expect([key, boxes.find(b => b.key === key)?.props.flexShrink]).toEqual([key, 0])
  }
  await band.unmount()
})

// ---------------------------------------------------------------------------
// What may not be stacked or run: refused, saying why

test('any kind first; after it, an action not on the selection is refused, saying at which step and why', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  await stack(band, ['translate-ja'])
  expect(s.toasts).toEqual([])
  await showKind(band, 'context')
  await band.press({ key: 'recap' })
  await showKind(band, 'standalone')
  await band.press({ key: 'gitignore-template' })
  expect(s.toasts).toEqual([
    reasonText({ code: 'chainStepTarget', step: 2, id: 'recap' }, 'ja'),
    reasonText({ code: 'chainStepTarget', step: 2, id: 'gitignore-template' }, 'ja'),
  ])
  expect(s.toasts[0]).toContain('ステップ 2')
  expect(w.composing).toEqual({ steps: ['translate-ja'] })
  await band.unmount()
})

test('a chain of the setting is refused as nested; a ninth step as past the limit', { options: { ...JA, customActions: JSON.stringify([{ id: 'my-chain', icon: '🔗', label: 'Mine', kind: 'chain', steps: ['explain', 'summarize'] }]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  await band.press({ key: MODE })
  await band.press({ key: 'my-chain' })
  expect(s.toasts).toEqual([reasonText({ code: 'chainNested', step: 1, id: 'my-chain' }, 'ja')])
  expect(w.composing).toEqual({ steps: [] })
  for (let i = 0; i < 9; i++) await band.press({ key: 'summarize' })
  expect(w.composing?.steps).toHaveLength(8)
  expect(s.toasts.at(-1)).toBe(reasonText({ code: 'chainSteps', min: 2, max: 8 }, 'ja'))
  await band.unmount()
})

test('▶ with one step: refused, nothing run, the mode and the step kept', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  await stack(band, ['translate-ja'])
  await band.press({ key: RUN })
  await clock.settle()
  expect(s.toasts).toEqual([reasonText({ code: 'chainSteps', min: 2, max: 8 }, 'ja')])
  expect(s.models).toEqual([])
  expect(w.composing).toEqual({ steps: ['translate-ja'] })
  await band.unmount()
})

test('a step no longer there by ▶ (the settings read again): refused, saying which, nothing run', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  w.force.composing = { steps: ['foo', 'summarize'] }
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  await band.press({ key: RUN })
  await clock.settle()
  await band.unmount()
  expect(s.toasts).toEqual([reasonText({ code: 'chainStepUnknown', step: 1, id: 'foo' }, 'ja')])
  expect(s.models).toEqual([])
})

test('a local step that opens URLs fails at that step as it runs, saying why; nothing after it', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.answerText = 'see https://example.com'
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'open-urls', 'summarize'])
  expect(s.models).toHaveLength(1)
  const pane = await paneTexts($)
  expect(pane).toContain(t.chainStepFailed(2, 3, labelOf('open-urls'), t.chainLocalEffect))
  expect(s.processRuns.filter(r => r.argv[0] !== 'uname')).toEqual([])
})

// The exec guards hold for a chain put together on the spot as for one written.
const HOME = '/Users/me'
const ALLOW = `${HOME}/${ALLOWLIST_RELATIVE}`
const TOOL = `${HOME}/bin/save.sh`
const SCRIPT = '#!/bin/sh\ncat >> notes.txt\n'
const MY_EXEC = { id: 'my-exec', icon: '🫙', label: 'Save', kind: 'exec', command: TOOL }
const EXEC_SETTING = JSON.stringify([MY_EXEC])

function execSetUp(on: On, allowed: boolean, answer: string | null) {
  const s = stage(on)
  const w = execWorld(on, {
    env: { HOME, LANG: 'ja_JP.UTF-8' },
    files: {
      [HOME]: { kind: 'dir' },
      '/repo': { kind: 'dir' },
      [ALLOW]: { content: JSON.stringify({ executables: allowed ? [{ path: TOOL }] : [] }) },
      [TOOL]: { content: SCRIPT },
    },
    answer,
  })
  s.sourceSettings.user = userSettings(EXEC_SETTING)
  s.processAnswer = argv => (argv[0] === ENV_BIN ? { exitCode: 0, stdout: 'SAVED\n' } : defaultProcessAnswer(argv))
  return { s, w }
}
const execRuns = (s: Stage) => s.processRuns.filter(r => r.argv[0] === ENV_BIN)

test('an exec step the gate refuses: no step runs; the entry opens failed at step 2 saying why, and a toast says so', { options: { ...JA, customActions: EXEC_SETTING } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = execSetUp(on, false, t.execApprove)
  const w = watch(on)
  // Refused by the gate, it is on neither the line nor the dialog: stacked before, say on another surface.
  w.force.composing = { steps: ['translate-ja', 'my-exec'] }
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  await band.press({ key: RUN })
  await clock.settle()
  await band.unmount()
  expect(s.models).toEqual([])
  expect(execRuns(s)).toEqual([])
  expect(w.results[0]?.status).toBe('failed')
  expect(w.results[0]?.text).toContain(t.chainStepFailed(2, 2, 'Save', '').slice(0, 10))
  expect(w.results[0]?.text).toContain('Save')
  expect(s.toasts.some(x => x.includes('ステップ 2/2'))).toBe(true)
})

test('an exec step not approved yet: asked before any model; approved, the steps run in order', { options: { ...JA, customActions: EXEC_SETTING } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = execSetUp(on, true, t.execApprove)
  let modelsAtAsk = -1
  w.onAsk = () => {
    modelsAtAsk = s.models.length
  }
  await start($)
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'my-exec'])
  expect(w.asked).toHaveLength(1)
  expect(modelsAtAsk).toBe(0)
  expect(s.models).toHaveLength(1)
  expect(execRuns(s).map(r => r.stdin)).toEqual([`answer from ${s.models[0]?.model}`])
  expect(await paneTexts($)).toContain('SAVED')
})

test('an exec step whose approval is cancelled: no step runs; the entry fails at step 2, not approved', { options: { ...JA, customActions: EXEC_SETTING } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s, w } = execSetUp(on, true, t.execCancel)
  await start($)
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'my-exec'])
  expect(w.asked).toHaveLength(1)
  expect(s.models).toEqual([])
  expect(execRuns(s)).toEqual([])
  expect(await paneTexts($)).toContain(t.chainStepFailed(2, 2, 'Save', reasonText({ code: 'execDeclined' }, 'ja')))
})

// ---------------------------------------------------------------------------
// The ⋯ dialog's multi-select

/** The ⋯ dialog open on `text`. */
async function dialogOn($: Engine, s: Stage, clock: Clock, text: string | null) {
  s.selected = text
  await clock.advance(400)
  await runCommand($, '')
  return $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 200 } } })
}

test('the dialog: the multi-select toggle under the kind buttons; on, a pick stacks, numbered, with undo and run all; nothing run', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const picker = await dialogOn($, s, clock, 'Hello world')
  expect((await picker.find({ key: TOGGLE }))?.props.label).toBe(t.composeToggleName(false))
  await picker.press({ key: TOGGLE })
  expect((await picker.find({ key: TOGGLE }))?.props.label).toBe(t.composeToggleName(true))
  expect(await textsOf(picker)).toContain(t.composeGuide)
  await picker.press({ key: 'translate-ja' })
  await picker.press({ key: 'summarize' })
  expect(s.models).toEqual([])
  expect(w.composing).toEqual({ steps: ['translate-ja', 'summarize'] })
  const tj = defOf('translate-ja')
  const su = defOf('summarize')
  expect(await textsOf(picker)).toContain(`1. ${tj.icon} ${tj.label} → 2. ${su.icon} ${su.label}`)
  expect(await keysOf(picker)).toEqual(expect.arrayContaining([C_UNDO, C_RUN]))
  await picker.press({ key: C_UNDO })
  expect(w.composing).toEqual({ steps: ['translate-ja'] })
  expect(await textsOf(picker)).toContain(`1. ${tj.icon} ${tj.label}`)
  await picker.unmount()
})

test('the dialog: Enter in the filter stacks the first left, runs nothing', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const picker = await dialogOn($, s, clock, 'Hello world')
  await picker.press({ key: TOGGLE })
  await picker.input({ key: PICKER_FILTER, text: 'translate-ja' })
  expect(w.composing).toEqual({ steps: ['translate-ja'] })
  expect(s.models).toEqual([])
  await picker.unmount()
})

test('the dialog: run all runs them in order on the text it holds, as ▶ does', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const picker = await dialogOn($, s, clock, 'Hello world')
  // The selection gone meanwhile: the dialog holds the text.
  s.selected = null
  await clock.advance(400)
  await picker.press({ key: TOGGLE })
  await picker.press({ key: 'translate-ja' })
  await picker.press({ key: 'summarize' })
  await picker.press({ key: C_RUN })
  await clock.settle()
  await picker.unmount()
  expect(s.models.map(m => m.system)).toEqual([systemOf('translate-ja'), systemOf('summarize')])
  expect(s.models[0]?.prompt).toContain('Hello world')
  expect(w.composing).toBeNull()
  expect(w.results[0]?.chain).toEqual(['translate-ja', 'summarize'])
})

test('the dialog: what may not follow is refused as on the hint line', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const picker = await dialogOn($, s, clock, 'Hello world')
  await picker.press({ key: TOGGLE })
  await picker.press({ key: 'translate-ja' })
  await picker.press({ key: 'recap' })
  expect(s.toasts).toEqual([reasonText({ code: 'chainStepTarget', step: 2, id: 'recap' }, 'ja')])
  expect(w.composing).toEqual({ steps: ['translate-ja'] })
  await picker.unmount()
})

test('the dialog with no text: once a first step is chosen, the selection\'s actions are listed', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const picker = await dialogOn($, s, clock, null)
  expect(await listedActions(picker)).not.toContain('summarize')
  await picker.press({ key: TOGGLE })
  await picker.press({ key: 'gitignore-template' })
  expect(await listedActions(picker)).toContain('summarize')
  expect(await keysOf(picker)).toContain('_picker-kind-selection')
  await picker.unmount()
})

test('the dialog: the toggle off drops what was chosen; a pick runs again, and one taking an argument opens its screen', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  const picker = await dialogOn($, s, clock, 'Hello world')
  await picker.press({ key: TOGGLE })
  await picker.press({ key: 'translate-ja' })
  await picker.press({ key: 'summarize' })
  await picker.press({ key: TOGGLE })
  expect(w.composing).toBeNull()
  expect(await keysOf(picker)).not.toContain(C_RUN)
  expect(s.models).toEqual([])
  await pickAction(picker as never, 'gitignore-template')
  expect(await picker.find({ key: '_arg' })).toBeDefined()
  expect(s.models).toEqual([])
  await picker.press({ key: '_arg-back' })
  await pickAction(picker as never, 'translate-ja')
  await clock.settle()
  expect(s.models).toHaveLength(1)
  await picker.unmount()
})

for (const where of ['hint', 'dialog'] as const) {
  test(`one state for both: turned off on the ${where === 'hint' ? 'hint line' : 'dialog'}, both are off; stacked on one, the other shows it`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await hintOn($, s, clock, 'Hello world')
    await stack(band, ['translate-ja'])
    await band.press({ key: '_more' })
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 200 } } })
    const tj = defOf('translate-ja')
    expect((await picker.find({ key: TOGGLE }))?.props.label).toBe(t.composeToggleName(true))
    expect(await textsOf(picker)).toContain(`1. ${tj.icon} ${tj.label}`)
    await picker.press({ key: 'summarize' })
    expect((await textsOf(band)).filter(x => x === defOf('summarize').icon)).toHaveLength(1)
    if (where === 'hint') await band.press({ key: MODE })
    else await picker.press({ key: TOGGLE })
    expect((await band.find({ key: MODE }))?.props.label).toBe(t.chainModeName(false))
    expect((await picker.find({ key: TOGGLE }))?.props.label).toBe(t.composeToggleName(false))
    expect(await keysOf(band)).not.toContain(RUN)
    expect(await keysOf(picker)).not.toContain(C_RUN)
    await picker.unmount()
    await band.unmount()
  })
}

test('the dialog\'s rows for the multi-select are taken off the list: it never spills', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'Hello world'
  await clock.advance(400)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 30 } } })
  const listed = await listedActions(picker)
  const before = listed.length
  await picker.press({ key: TOGGLE })
  // Three on the selection, the first listed (the list is the selection's first, with text).
  for (const id of listed.slice(0, 3)) await picker.press({ key: id })
  expect((await textsOf(picker)).some(x => x.startsWith('1. ') && x.includes(' → 3. '))).toBe(true)
  // The steps' line and the undo and run row: two rows fewer.
  expect((await listedActions(picker)).length).toBe(before - 2)
  await picker.unmount()
})

// ---------------------------------------------------------------------------
// The result pane: again, and the save as a custom action

test('no save button while it runs, nor on an action run alone', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  let release = () => {}
  s.hold = new Promise<void>(resolve => (release = resolve))
  const band = await hintOn($, s, clock, 'Hello world')
  await stack(band, ['translate-ja', 'summarize'])
  const running = band.press({ key: RUN })
  await clock.settle()
  const id = w.results[0]!.id
  expect(w.results[0]?.status).toBe('running')
  expect(await paneKeys($)).not.toContain(saveKey(id))
  s.hold = null
  release()
  await running
  await clock.settle()
  expect(await paneKeys($)).toContain(saveKey(id))
  // An action run alone: none.
  await band.unmount()
  const again = await hintOn($, s, clock, 'Hello again')
  await again.press({ key: 'translate-ja' })
  await clock.settle()
  await again.unmount()
  expect(w.results[0]?.chain).toBeUndefined()
  expect(await paneKeys($)).not.toContain(saveKey(w.results[0]!.id))
})

const MINE = { id: 'mine', icon: 'M', label: 'Mine', kind: 'complete', model: 'haiku', prompt: 'Do it.' }

test('saved: one definition added last to the user settings\' customActions, the rest as they were; a toast, and "saved (chain-1)"', { options: { ...JA, customActions: JSON.stringify([MINE]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const c = configWorld(on)
  const w = watch(on)
  s.sourceSettings.user = userSettings(JSON.stringify([MINE]))
  await start($)
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'summarize'])
  const id = w.results[0]!.id
  await pressInPane($, saveKey(id))
  await clock.settle()
  expect(c.sets).toHaveLength(1)
  expect(c.sets[0]?.key).toBe(`${PLUGIN}.customActions`)
  expect(JSON.parse(String(c.sets[0]?.value))).toEqual([
    MINE,
    {
      id: 'chain-1',
      icon: CHAIN_ICON,
      label: { ja: `${labelOf('translate-ja', 'ja')} → ${labelOf('summarize', 'ja')}`, en: `${labelOf('translate-ja', 'en')} → ${labelOf('summarize', 'en')}` },
      kind: 'chain',
      steps: ['translate-ja', 'summarize'],
      showSteps: true,
    },
  ])
  expect(s.toasts).toContain(t.composeSavedToast('chain-1'))
  expect(w.results[0]?.saved).toBe('chain-1')
  const keys = await paneKeys($)
  expect(keys).not.toContain(saveKey(id))
  expect(await paneTexts($)).toContain(` ${t.composeSaved('chain-1')}`)
})

test('saved with customActions unset: the chain alone; with chain-1 taken, chain-2', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const c = configWorld(on)
  const w = watch(on)
  s.sourceSettings.user = {}
  await start($)
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'summarize'])
  await pressInPane($, saveKey(w.results[0]!.id))
  await clock.settle()
  const written = JSON.parse(String(c.sets[0]?.value)) as { id: string }[]
  expect(written.map(d => d.id)).toEqual(['chain-1'])
})

test('saved next to a chain-1 already there: chain-2', { options: { ...JA, customActions: JSON.stringify([{ ...MINE, id: 'chain-1' }]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const c = configWorld(on)
  const w = watch(on)
  s.sourceSettings.user = userSettings(JSON.stringify([{ ...MINE, id: 'chain-1' }]))
  await start($)
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'summarize'])
  await pressInPane($, saveKey(w.results[0]!.id))
  await clock.settle()
  expect((JSON.parse(String(c.sets[0]?.value)) as { id: string }[]).map(d => d.id)).toEqual(['chain-1', 'chain-2'])
})

test('a long chain\'s labels are cut to 64 code points with an ellipsis', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const c = configWorld(on)
  const w = watch(on)
  await start($)
  await runStack($, s, clock, 'Hello world', Array.from({ length: 8 }, () => LONGEST))
  await pressInPane($, saveKey(w.results[0]!.id))
  await clock.settle()
  const label = (JSON.parse(String(c.sets[0]?.value)) as { label: { ja: string; en: string } }[])[0]!.label
  for (const l of [label.ja, label.en]) {
    expect([...l].length).toBeLessThanOrEqual(64)
    expect(l.endsWith('…')).toBe(true)
  }
})

// What the save wrote, as the settings then hold it: the plugin loaded again with it.
const SAVED = JSON.stringify([
  { id: 'chain-1', icon: CHAIN_ICON, label: { ja: '日本語訳 → 要約', en: 'Japanese → Summarize' }, kind: 'chain', steps: ['translate-ja', 'summarize'], showSteps: true },
])

test('loaded again with what was saved: chain-1 is a custom action on the hint line and in the dialog, and runs its steps in order', { options: { ...JA, customActions: SAVED } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await hintOn($, s, clock, 'Hello world')
  expect(await keysOf(band)).toContain('chain-1')
  await band.press({ key: '_more' })
  await band.unmount()
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 400 } } })
  expect(await listedActions(picker)).toContain('chain-1')
  await picker.press({ key: 'chain-1' })
  await clock.settle()
  await picker.unmount()
  expect(s.models.map(m => m.system)).toEqual([systemOf('translate-ja'), systemOf('summarize')])
})

test('the saved mark is kept in the state: drawn again (a reload), it stays', { options: JA }, async ($, on) => {
  const w = watch(on)
  w.force.results = [{ id: 7, action: ADHOC_CHAIN_ID, chain: ['translate-ja', 'summarize'], saved: 'chain-1', target: 'selection', quote: 'Hello', status: 'done', text: 'x' }]
  mock.clock(on)
  stage(on)
  await start($)
  const keys = await paneKeys($)
  expect(keys).not.toContain(saveKey(7))
  expect(await paneTexts($)).toContain(` ${t.composeSaved('chain-1')}`)
  // Its heading still the steps' labels.
  expect(await paneTexts($)).toContain(`${labelOf('translate-ja')} → ${labelOf('summarize')}`)
  void savedKey
})

test('again, before it is saved: the same steps on the text held, no argument screen, a new entry with its steps and its save button', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'summarize'])
  const first = w.results[0]!.id
  await pressInPane($, againKey(first))
  await clock.settle()
  expect(s.models.map(m => m.system)).toEqual([systemOf('translate-ja'), systemOf('summarize'), systemOf('translate-ja'), systemOf('summarize')])
  expect(s.models[2]?.prompt).toContain('Hello world')
  const newest = w.results[0]!
  expect(newest.id).not.toBe(first)
  expect(newest.chain).toEqual(['translate-ja', 'summarize'])
  expect(await paneKeys($)).toEqual(expect.arrayContaining([saveKey(newest.id), saveKey(first)]))
  expect(s.opened.filter(o => o.focus === true)).toEqual([])
})

test('again, once saved: the old entry keeps its mark', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  configWorld(on)
  const w = watch(on)
  await start($)
  await runStack($, s, clock, 'Hello world', ['translate-ja', 'summarize'])
  const first = w.results[0]!.id
  await pressInPane($, saveKey(first))
  await clock.settle()
  await pressInPane($, againKey(first))
  await clock.settle()
  expect(s.models).toHaveLength(4)
  expect(w.results.find(r => r.id === first)?.saved).toBe('chain-1')
  expect(w.results[0]?.saved).toBeUndefined()
})

// ---------------------------------------------------------------------------
// A save refused: why, and nothing written

async function savedOrRefused($: Engine, s: Stage, clock: Clock, w: Watch, steps: readonly string[] = ['translate-ja', 'summarize']) {
  await runStack($, s, clock, 'Hello world', steps)
  await pressInPane($, saveKey(w.results[0]!.id))
  await clock.settle()
}

test('refused: a chain with an exec step (only you add one, in /config)', { options: { ...JA, customActions: EXEC_SETTING } }, async ($, on) => {
  const clock = mock.clock(on)
  const { s } = execSetUp(on, true, t.execApprove)
  const c = configWorld(on)
  const w = watch(on)
  await start($)
  await savedOrRefused($, s, clock, w, ['translate-ja', 'my-exec'])
  expect(c.sets).toEqual([])
  expect(s.toasts).toContain(t.composeSaveRefused(t.composeSaveExec))
  expect(t.composeSaveExec).toContain('/config')
})

test('refused: customActions loaded from other than the user settings', { options: { ...JA, customActions: JSON.stringify([MINE]) } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const c = configWorld(on)
  const w = watch(on)
  s.sourceSettings.user = {}
  await start($)
  await savedOrRefused($, s, clock, w)
  expect(c.sets).toEqual([])
  expect(s.toasts).toContain(t.composeSaveRefused(t.composeSaveNotUser))
})

test('refused: the user settings unreadable', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const c = configWorld(on)
  const w = watch(on)
  s.sourceDeny = ['user']
  await start($)
  await savedOrRefused($, s, clock, w)
  expect(c.sets).toEqual([])
  expect(s.toasts).toContain(t.composeSaveRefused(t.composeSaveUnreadable))
})

for (const [what, setting] of [['broken JSON', '[{"id":'], ['a JSON object', '{"id":"mine"}']] as const) {
  test(`refused: customActions ${what}, not overwritten`, { options: { ...JA, customActions: setting } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    const c = configWorld(on)
    const w = watch(on)
    s.sourceSettings.user = userSettings(setting)
    await start($)
    await savedOrRefused($, s, clock, w)
    expect(c.sets).toEqual([])
    expect(s.toasts).toContain(t.composeSaveRefused(t.composeSaveNotArray))
  })
}

test('refused: the chain not read back with the setting (a step no longer there), saying why', { options: JA }, async ($, on) => {
  const w = watch(on)
  w.force.results = [{ id: 3, action: ADHOC_CHAIN_ID, chain: ['foo', 'summarize'], target: 'selection', quote: 'Hello', status: 'done', text: 'x' }]
  mock.clock(on)
  const s = stage(on)
  const c = configWorld(on)
  await start($)
  await pressInPane($, saveKey(3))
  expect(c.sets).toEqual([])
  expect(s.toasts).toContain(t.composeSaveRefused(reasonText({ code: 'chainStepUnknown', step: 1, id: 'foo' }, 'ja')))
})

test('a deny of $.config.set is told, and the entry is not marked saved', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const c = configWorld(on)
  c.answer = { deny: 'a trusted source owns it' }
  const w = watch(on)
  await start($)
  await savedOrRefused($, s, clock, w)
  expect(c.sets).toHaveLength(1)
  expect(s.toasts).toContain(t.composeSaveRefused('a trusted source owns it'))
  expect(w.results[0]?.saved).toBeUndefined()
  expect(await paneKeys($)).toContain(saveKey(w.results[0]!.id))
})

// A hook that throws is skipped, so the failure is the engine's own: nothing
// beneath the plugin answers config.set here, and $.config.set fails.
test('a save whose $.config.set fails is told, never silently', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  const w = watch(on)
  await start($)
  await savedOrRefused($, s, clock, w)
  expect(s.toasts).toHaveLength(1)
  expect(s.toasts[0]?.startsWith(t.composeSaveRefused('').slice(0, -1))).toBe(true)
  expect(s.toasts[0]).toContain('config.set')
  expect(w.results[0]?.saved).toBeUndefined()
})

// ---------------------------------------------------------------------------
// In English as in Japanese

for (const [options, l] of [[EN, 'en'], [JA, 'ja']] as const) {
  test(`[${l}] the chain mode, the multi-select and the save in the language`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    const w = watch(on)
    const m = MESSAGES[l]
    await start($)
    const band = await hintOn($, s, clock, 'Hello world')
    expect((await band.find({ key: MODE }))?.props.label).toBe(m.chainModeName(false))
    await band.press({ key: MODE })
    expect(await textsOf(band)).toContain(` ${m.chainModeGuide}`)
    await band.press({ key: 'translate-ja' })
    await band.press({ key: 'summarize' })
    expect((await band.find({ key: UNDO }))?.props.label).toBe(m.chainUndoName)
    expect((await band.find({ key: RUN }))?.props.label).toBe(m.chainRunName)
    await band.press({ key: '_more' })
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 200 } } })
    expect((await picker.find({ key: TOGGLE }))?.props.label).toBe(m.composeToggleName(true))
    expect((await picker.find({ key: C_UNDO }))?.props.label).toBe(m.composeUndo)
    expect((await picker.find({ key: C_RUN }))?.props.label).toBe(m.composeRun)
    await picker.press({ key: C_RUN })
    await clock.settle()
    await picker.unmount()
    await band.unmount()
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const save = await pane.find({ key: saveKey(w.results[0]!.id) })
    expect(String(save?.props.label)).toContain(m.composeSave)
    await pane.unmount()
    if (l === 'en') {
      for (const text of [m.chainModeName(true), m.chainModeGuide, m.composeToggle, m.composeRun, m.composeSave, m.composeSaved('chain-1'), m.composeSaveExec, m.composeSaveNotUser]) {
        expect(text).not.toMatch(/[　-ヿ一-鿿＀-￯]/)
      }
    }
  })
}
