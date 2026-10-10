import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor, isContext, markedIcon } from '../hooks/actions'
import { MESSAGES, answerStyle } from '../hooks/i18n'
import { BAND, EN, JA, JAPANESE, PANE, PICKER_PANE, PICKER_SELECT, SURFACES, runCommand, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// Context actions: on the conversation itself, with no selected text, a fork
// of the session. They share the hint line, the ⋯ dialog and the order with
// the actions on the selection, told apart by < > around the icon ([ ] for
// those on the selection); `/quick-actions hint` opens the hint line without
// a selection (the context actions alone) or with one (both kinds).
//
// The engine stops answering a selection once a command has run; the stub
// does not, so every test that runs `/quick-actions hint` then clears
// `s.selected` and lets the poll see it, as the engine would have it.

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_000 * DAY
const at = (score: number) => ({ score, at: NOW })

const CONTEXT = [
  { id: 'recap', icon: '🧭', ja: '会話の要約' },
  { id: 'decisions', icon: '✅', ja: 'ここまでの決定事項' },
  { id: 'todo', icon: '📋', ja: '次にやること' },
  { id: 'open-questions', icon: '❓', ja: '未解決の疑問' },
  { id: 'simplify-last', icon: '🧸', ja: '直前の回答をやさしく' },
  { id: 'translate-last', icon: '🌐', ja: '直前の回答を翻訳' },
  { id: 'assumptions', icon: '🧱', ja: '前提・仮定の洗い出し' },
  { id: 'risks', icon: '⚠️', ja: 'リスク・懸念点' },
  { id: 'changed-files', icon: '🗂', ja: '変更したファイルとその内容' },
  { id: 'next-questions', icon: '💭', ja: '次に聞くとよい質問' },
  { id: 'handoff', icon: '📝', ja: '引き継ぎメモ' },
]

const labelsOf = async ($: Engine, surface: (typeof SURFACES)[number] = 'terminal') => {
  const band = await $.ui.mount({ ...BAND, surface })
  const labels = (await band.findAll({ type: 'Button' })).map(b => String(b.props.label))
  await band.unmount()
  return labels
}

/** `/quick-actions hint`, then the selection gone, as the engine has it after a command, and a poll. */
async function openHint($: Engine, s: Stage, clock: Clock) {
  const r = await runCommand($, 'hint')
  s.selected = null
  await clock.advance(400)
  return r
}

// ---------------------------------------------------------------------------
// The definitions

test('eleven built-in context actions, as the ticket names them, in both languages', () => {
  const context = ACTIONS.filter(isContext).flatMap(a => (a.kind === 'fork' ? [a] : []))
  expect(context.map(a => a.id)).toEqual(CONTEXT.map(c => c.id))
  for (const [i, a] of context.entries()) {
    expect(a.icon).toBe(CONTEXT[i]!.icon)
    expect(a.label.ja).toBe(CONTEXT[i]!.ja)
    expect(a.label.en).not.toBe('')
    expect(a.label.en).not.toMatch(JAPANESE)
    expect(a.kind).toBe('fork')
    // On the conversation, with nothing guessed; the answer language comes at run time.
    expect(a.prompt).toContain('this conversation')
    expect(a.prompt).toContain('instead of guessing')
    expect(a.prompt).not.toContain('{STYLE}')
  }
  // Both languages resolve them, as context actions still.
  for (const lang of ['ja', 'en'] as const) {
    expect(actionsFor(lang).filter(isContext).map(a => a.id)).toEqual(CONTEXT.map(c => c.id))
  }
  // The translation decides its own target language, over the answer language.
  const last = context.find(a => a.id === 'translate-last')!
  expect(last.prompt).toContain('into natural English')
  expect(last.prompt).toContain('into natural Japanese')
  expect(last.prompt).toContain('takes precedence')
})

test('the marks: [icon] on the selection, <icon> on the conversation', () => {
  expect(markedIcon({ icon: '💡' })).toBe('[💡]')
  expect(markedIcon({ icon: '💡', target: 'selection' })).toBe('[💡]')
  expect(markedIcon({ icon: '🧭', target: 'context' })).toBe('<🧭>')
})

// ---------------------------------------------------------------------------
// /quick-actions hint

for (const surface of SURFACES) {
  test(`[${surface}] with nothing selected, /quick-actions hint shows the context actions alone, and ✕ closes it`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await clock.advance(400)
    expect(await labelsOf($, surface)).toEqual([])

    const r = await openHint($, s, clock)
    expect(JSON.stringify(r)).toContain(MESSAGES.en.hintOpened)
    const labels = await labelsOf($, surface)
    // The default set's context and standalone actions first, then the rest in the order of definition; six in all.
    expect(labels).toEqual(['<🧭>', '<✅>', '{⏳}', '<📋>', '<❓>', '<🧸>', '✕', '⋯'])

    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'close' })
    await band.unmount()
    await clock.advance(400)
    expect(await labelsOf($, surface)).toEqual([])
    expect(s.forks).toEqual([])
  })
}

test('with text selected, /quick-actions hint keeps both kinds though the command took the selection away', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'ECONNREFUSED 127.0.0.1:3306'
  await clock.advance(400)

  await openHint($, s, clock)
  await clock.advance(400)
  expect(await labelsOf($)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '<🧭>', '<✅>', '✕', '⋯'])

  // An action on the selection runs on the text held as the command ran, and the line closes.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'explain' })
  await band.unmount()
  expect(s.models).toHaveLength(1)
  expect(s.models[0]?.prompt).toContain('<selected>')
  expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
})

test('a selection made after /quick-actions hint arms it: that selection going closes the line', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openHint($, s, clock)

  s.selected = 'exit 137'
  await clock.advance(400)
  expect(await labelsOf($)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '<🧭>', '<✅>', '✕', '⋯'])

  s.selected = null
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
  // Closed for good: no selection keeps nothing open.
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
})

test('the selection held as the command ran, seen late by the poll, does not arm it', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  // Selected just now: no poll has seen it yet.
  s.selected = 'exit 137'
  await runCommand($, 'hint')
  // The next poll still sees it, before the engine lets go of it.
  await clock.advance(400)
  s.selected = null
  await clock.advance(400)
  // Its going closes nothing: the line stays, on the text it held.
  expect(await labelsOf($)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '<🧭>', '<✅>', '✕', '⋯'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'summarize' })
  await band.unmount()
  expect(s.models[0]?.prompt).toContain('exit 137')
})

// ---------------------------------------------------------------------------
// Running a context action

for (const [options, lang] of [[JA, 'ja'], [EN, 'en']] as const) {
  test(`[${lang}] a context action on the hint line forks the session with no selection, closes the line and shows "${MESSAGES[lang].onConversation}"`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openHint($, s, clock)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'recap' })
    await band.unmount()
    await clock.settle()

    const recap = actionsFor(lang).find(a => a.id === 'recap')!
    if (recap.kind !== 'fork') throw new Error('recap is not a fork')
    expect(s.forks).toEqual([`${recap.prompt} ${answerStyle(lang)}`])
    expect(s.forks[0]).not.toContain('<selected>')
    expect(s.models).toEqual([])
    await clock.advance(400)
    expect(await labelsOf($)).toEqual([])

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ text: MESSAGES[lang].onConversation })).toBeDefined()
    expect(await pane.find({ text: new RegExp(recap.label) })).toBeDefined()
    expect(await pane.find({ text: 'answer in context' })).toBeDefined()
    await pane.unmount()
  })
}

test('on a hint line drawn by a selection alone, a context action puts its icons away too', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'decisions' })
  await band.unmount()
  expect(s.forks).toHaveLength(1)
  expect(s.forks[0]).not.toContain('exit 137')
  // The selection is still answered, yet its icons stay away.
  await clock.advance(400)
  expect(s.selected).toBe('exit 137')
  expect(await labelsOf($)).toEqual([])
})

test('opened by /quick-actions hint with a selection there now, a context action closes it as well', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openHint($, s, clock)
  s.selected = 'exit 137'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'recap' })
  await band.unmount()
  await clock.advance(400)
  expect(s.selected).toBe('exit 137')
  expect(await labelsOf($)).toEqual([])
})

test('/quick-actions recap runs with nothing selected', async ($, on) => {
  const s = stage(on)
  await start($)
  const r = await runCommand($, 'recap')
  expect(s.forks).toHaveLength(1)
  expect(s.forks[0]).not.toContain('<selected>')
  expect(s.toasts).toEqual([])
  expect(JSON.stringify(r)).toContain('Showing the Recap result')
})

// ---------------------------------------------------------------------------
// One order for both kinds

// One order by score; laid out for the moment (arrange): with a selection the
// actions on it first, so a context action used more than they are still
// waits behind them (changed with the standalone actions, SELM-00025: with a
// few hundred actions, scores alone would push the actions on the selection
// off the line while the person is selecting).
test('the usage scores order the kinds as one; with a selection, the actions on it come first', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on, { store: { usage: { recap: at(5), 'translate-ja': at(3), decisions: at(1) } } })
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  expect(await labelsOf($)).toEqual(['[🌐]', '[🔤]', '[🀄]', '[🏮]', '[🌏]', '[💃]', '✕', '⋯'])

  // With nothing selected, the same order with the context actions alone.
  s.selected = null
  await clock.advance(400)
  await openHint($, s, clock)
  expect(await labelsOf($)).toEqual(['<🧭>', '<✅>', '<📋>', '<❓>', '<🧸>', '<🌐>', '✕', '⋯'])
})

test('`actions` pins either kind', { options: { actions: 'recap,explain,handoff' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  expect(await labelsOf($)).toEqual(['<🧭>', '[💡]', '<📝>', '[🌐]', '[🔤]', '[🀄]', '✕', '⋯'])

  s.selected = null
  await clock.advance(400)
  await openHint($, s, clock)
  expect(await labelsOf($)).toEqual(['<🧭>', '<📝>', '<✅>', '<📋>', '<❓>', '<🧸>', '✕', '⋯'])
})

// ---------------------------------------------------------------------------
// The ⋯ dialog

test('the ⋯ dialog: both kinds, marked, with a selection; the context actions alone from the hint line without one', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: '_more' })
  await band.unmount()

  let picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  let listed = ((await picker.find({ type: 'Select' }))?.props.options ?? []) as { value: string; label: string }[]
  expect(listed).toHaveLength(ACTIONS.length)
  expect(listed.find(o => o.value === 'explain')?.label).toBe('[💡] 意味')
  expect(listed.find(o => o.value === 'timer')?.label).toBe('{⏳} タイマー')
  expect(listed.find(o => o.value === 'handoff')?.label).toBe('<📝> 引き継ぎメモ')
  await picker.press({ key: '_picker-close' })
  await picker.unmount()

  // No selection: `/quick-actions hint`, then its ⋯.
  s.selected = null
  await clock.advance(400)
  await openHint($, s, clock)
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: '_more' })
  await band.unmount()
  picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  listed = ((await picker.find({ type: 'Select' }))?.props.options ?? []) as { value: string; label: string }[]
  // The context actions and the standalone one: nothing that needs a selection.
  expect(listed.map(o => o.value).sort()).toEqual([...CONTEXT.map(c => c.id), 'timer'].sort())
  await picker.select({ key: PICKER_SELECT, value: 'todo' })
  await picker.unmount()
  expect(s.forks).toHaveLength(1)
  expect(s.forks[0]).toContain('to-do list')
  // A pick closes the hint line too.
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
})

// ---------------------------------------------------------------------------
// Custom context actions

const STANDUP = {
  id: 'standup',
  icon: '📣',
  label: { ja: '進捗報告', en: 'Status update' },
  kind: 'fork',
  target: 'context',
  prompt: 'Write a short status update on this session.',
}
const PIRATE = { id: 'pirate', icon: '🦜', label: 'Pirate talk', kind: 'fork', prompt: 'Retell the selected text the way a pirate would.' }

test('a custom context action runs with no selection, marked < >; one with no target waits for a selection', { options: { customActions: JSON.stringify([STANDUP, PIRATE]), actions: 'standup,pirate' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openHint($, s, clock)
  const labels = await labelsOf($)
  expect(labels[0]).toBe('<📣>')
  expect(labels).not.toContain('[🦜]')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'standup' })
  await band.unmount()
  expect(s.forks).toEqual([`Write a short status update on this session. ${answerStyle('en')}`])

  // With a selection, the one with no target is an action on it.
  s.selected = 'segfault'
  await clock.advance(400)
  expect((await labelsOf($)).slice(0, 2)).toEqual(['<📣>', '[🦜]'])
})
