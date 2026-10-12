import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import { TICKER_LIMIT, actionsFor } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { paneStyle } from '../hooks/palette'
import { BAND, EN, JA, PANE, PICKER, PICKER_ARG, PICKER_FILTER, PICKER_PANE, listedOptions, pickAction, pickerKindButtons, showPickerKind, SURFACES, hintIcons, runCommand, showKind, stage, start, storedUsage, submitArg } from './stage'
import type { Clock, Stage } from './stage'

// Standalone actions ({icon}): on neither the selection nor the conversation.
// The built-in timer stands for them here: pressed on the hint line or picked
// in the ⋯ dialog it asks for its argument first (tests/arg-input.test.tsx),
// and Enter with the field empty runs it with none (25 minutes), whatever is
// selected or held, sending no text; `/quick-actions timer <duration>` gives
// it one. The mobile app, with no field, runs it at once.
// It counts down in the result pane once a second, with a stop button, and
// says it is done in a toast.

const STOP = (id: number) => `_stop-${id}`
const SECRET = 'SECRET selected text'

/** The texts the result pane draws now. */
async function paneTexts($: Engine, surface: (typeof SURFACES)[number] | 'mobile' = 'terminal'): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, surface })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  await pane.unmount()
  return texts
}

/** The keys of the result pane's buttons now. */
async function paneButtons($: Engine): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const keys = (await pane.findAll({ type: 'Button' })).map(b => String(b.key))
  await pane.unmount()
  return keys
}

const labelsOf = async ($: Engine) => {
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const labels = (await hintIcons(band)).map(String)
  await band.unmount()
  return labels
}

/** Nothing was sent anywhere: no model, no fork, no subagent. */
const sentNothing = (s: Stage) => {
  expect(s.models).toEqual([])
  expect(s.forks).toEqual([])
  expect(s.spawned).toEqual([])
}

async function select(s: Stage, clock: Clock, text: string | null) {
  s.selected = text
  await clock.advance(400)
}

// ---------------------------------------------------------------------------
// Pressed on the hint line, picked in the ⋯ dialog: no argument, no text

for (const surface of SURFACES) {
  test(`[${surface}] the hint line with a selection: timer runs with no argument, the selection unsent, its icons put away`, { options: { ...EN, pinActions: 'timer' } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SECRET)

    // Pinned, it leads the standalone actions, a press of their kind button away.
    const band = await $.ui.mount({ ...BAND, surface })
    await showKind(band, 'standalone')
    expect((await hintIcons(band))[0]).toBe('{⏳}')
    await band.press({ key: 'timer' })
    await band.unmount()
    await submitArg($, '', surface)

    sentNothing(s)
    expect(s.toasts).not.toContain(MESSAGES.en.noSelection)
    const texts = await paneTexts($, surface)
    expect(texts).toContain('⏳ 25:00 left')
    // Headed "standalone", never by the selection.
    expect(texts.join('\n')).toContain(MESSAGES.en.standalone)
    expect(texts.join('\n')).not.toContain('SECRET')
    // The selection is still answered; its icons stay away.
    await clock.advance(400)
    expect(s.selected).toBe(SECRET)
    expect(await labelsOf($)).toEqual([])
  })
}

test('the hint line /quick-actions hint opened with no selection: timer runs, and the line closes', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'hint')
  await select(s, clock, null)
  // It opens on the context actions; the standalone ones (the default set's first) a press away.
  expect((await labelsOf($)).slice(0, 2)).toEqual(['<🧭>', '<✅>'])

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await showKind(band, 'standalone')
  expect((await hintIcons(band))[0]).toBe('{⏳}')
  await band.press({ key: 'timer' })
  await band.unmount()
  await submitArg($)
  sentNothing(s)
  expect(s.toasts).toEqual([])
  expect(await paneTexts($)).toContain('⏳ 25:00 残り')
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
})

test('the ⋯ dialog from the line /quick-actions hint opened on a held text: timer runs without it', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = SECRET
  await runCommand($, 'hint')
  await select(s, clock, null)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: '_more' })
  await band.unmount()
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'timer')
  await picker.input({ key: PICKER_ARG, text: '' })
  await picker.unmount()
  sentNothing(s)
  expect(s.toasts).toEqual([])
  expect((await paneTexts($)).join('\n')).not.toContain('SECRET')
})

test('the ⋯ dialog holding a text: timer runs without it, the text\'s icons put away', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SECRET)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: '_more' })
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  // The kind buttons, all three with a text held after "all": their marks and names, "all" standing out.
  const kinds = await pickerKindButtons(picker)
  expect(kinds.map(k => k.kind)).toEqual(['all', 'selection', 'context', 'standalone'])
  expect(kinds.map(k => k.drawn)).toEqual(['all', '[ ] selection', '< > context', '{ } standalone'])
  expect(kinds.map(k => k.bold)).toEqual([true, false, false, false])
  await picker.input({ key: PICKER_FILTER, text: 'timer', kind: 'change' })
  const listed = await listedOptions(picker)
  expect(listed.find(o => o.value === 'timer')?.label).toBe('{⏳} Timer')
  await pickAction(picker, 'timer')
  await picker.input({ key: PICKER_ARG, text: '' })
  await picker.unmount()

  // A pick keeps the dialog's tab and shows the results' (SELM-00050).
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
  sentNothing(s)
  expect(s.toasts).toEqual([])
  const texts = await paneTexts($)
  expect(texts).toContain('⏳ 25:00 left')
  expect(texts.join('\n')).not.toContain('SECRET')
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
})

test('the ⋯ dialog with no text: timer runs, and no "nothing selected" toast', { options: JA }, async ($, on) => {
  mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  // The kind buttons without the selection's: no text to run it on.
  expect((await pickerKindButtons(picker)).map(k => [k.kind, k.drawn])).toEqual([['all', '全て'], ['context', '< > 会話'], ['standalone', '{ } 単独']])
  await pickAction(picker, 'timer')
  await picker.input({ key: PICKER_ARG, text: '' })
  await picker.unmount()
  // A pick keeps the dialog's tab and shows the results' (SELM-00050).
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
  sentNothing(s)
  expect(s.toasts).toEqual([])
  expect(await paneTexts($)).toContain('⏳ 25:00 残り')
})

test('[mobile] the ⋯ dialog lists the timer as a button with the kind buttons above, and a tap runs it', { options: JA }, async ($, on) => {
  mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
  expect((await pickerKindButtons(picker)).map(k => [k.kind, k.drawn])).toEqual([['all', '全て'], ['context', '< > 会話'], ['standalone', '{ } 単独']])
  // Switched to the standalone actions: the timer among them.
  await showPickerKind(picker, 'standalone')
  expect((await picker.find({ key: 'timer' }))?.props.label).toBe('{⏳} タイマー')
  await picker.press({ key: 'timer' })
  await picker.unmount()
  sentNothing(s)
  expect(await paneTexts($, 'mobile')).toContain('⏳ 25:00 残り')
})

// ---------------------------------------------------------------------------
// /quick-actions <id> [argument]

for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
  test(`[${options.language}] /quick-actions timer 5m: five minutes, headed by its argument`, { options }, async ($, on) => {
    mock.clock(on)
    const s = stage(on)
    await start($)
    const r = await runCommand($, 'timer 5m')
    expect(JSON.stringify(r)).toContain(t.showing('Quick Actions', options.language === 'ja' ? 'タイマー' : 'Timer'))
    sentNothing(s)
    const texts = await paneTexts($)
    expect(texts).toContain(t.timerLeft('05:00'))
    expect(texts).toContain(t.quote('5m'))
  })

  test(`[${options.language}] an argument that does not parse runs nothing: no pane, no use counted`, { options }, async ($, on) => {
    mock.clock(on)
    const s = stage(on)
    await start($)
    const timer = actionsFor(options.language).find(a => a.id === 'timer')
    const hint = timer?.kind === 'local' ? (timer.arg?.hint ?? '') : ''
    expect(hint).toContain(options.language === 'ja' ? '1 秒〜24 時間' : 'from 1 second to 24 hours')
    for (const bad of ['abc', '0', '25h', '-5m']) {
      const r = await runCommand($, `timer ${bad}`)
      expect(JSON.stringify(r)).toContain(JSON.stringify(t.invalidArg('timer', bad, hint)).slice(1, -1))
    }
    expect(s.opened).toEqual([])
    expect(storedUsage(s)).toBeUndefined()
    sentNothing(s)
  })

  test(`[${options.language}] an argument to an action that takes none, or to hint, is refused`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, 'some text')
    for (const [args, id, arg] of [['explain foo', 'explain', 'foo'], ['recap  the last hour', 'recap', 'the last hour'], ['hint foo', 'hint', 'foo']] as const) {
      const r = await runCommand($, args)
      expect(JSON.stringify(r)).toContain(t.argsNotAccepted(id, arg))
    }
    expect(s.opened).toEqual([])
    expect(s.toasts).toEqual([])
    expect(storedUsage(s)).toBeUndefined()
    sentNothing(s)
  })
}

test('/quick-actions TIMER 5M: the ID is lowercased, the argument read as written', { options: EN }, async ($, on) => {
  mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, '  TIMER　5M ')
  sentNothing(s)
  const texts = await paneTexts($)
  expect(texts).toContain('⏳ 05:00 left')
  expect(texts).toContain('"5M"')
})

test('/quick-actions timer with text selected: runs, the selection unsent and its icons put away', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SECRET)
  await runCommand($, 'timer')
  sentNothing(s)
  expect(s.toasts).toEqual([])
  expect((await paneTexts($)).join('\n')).not.toContain('SECRET')
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
  // Counted as a use, as any run is.
  await clock.settle()
  expect(storedUsage(s)?.['timer']?.score).toBe(1)
})

// ---------------------------------------------------------------------------
// The timer counting down: drawn, stopped, done

test('the pane draws the time left and a stop button, not "Thinking…", and counts down once a second', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  stage(on)
  await start($)
  await runCommand($, 'timer')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let texts = (await pane.findAll({ type: 'Text' })).map(x => x.text)
  expect(texts).toContain('⏳ 25:00 left')
  expect(texts).not.toContain(MESSAGES.en.thinking)
  const stop = await pane.find({ key: STOP(1) })
  // Drawn Stop; named by it and the entry's action (SELM-00086).
  expect(stop?.text).toBe(MESSAGES.en.stop)
  expect(stop?.props.label).toBe(MESSAGES.en.entryButtonName(MESSAGES.en.stop, '⏳ Timer'))

  // The mounted pane redraws as the time goes.
  await clock.advance(1000)
  texts = (await pane.findAll({ type: 'Text' })).map(x => x.text)
  expect(texts).toContain('⏳ 24:59 left')
  await clock.advance(59_000)
  expect((await pane.findAll({ type: 'Text' })).map(x => x.text)).toContain('⏳ 24:00 left')
  await pane.unmount()
})

for (const [options, t, label] of [[JA, MESSAGES.ja, 'タイマー'], [EN, MESSAGES.en, 'Timer']] as const) {
  test(`[${options.language}] done at zero: the entry says so, the toast too, and the button goes`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await runCommand($, 'timer 90s')
    await clock.advance(89_000)
    expect(await paneTexts($)).toContain(t.timerLeft('00:01'))
    expect(s.toasts).toEqual([])
    await clock.advance(1000)
    const texts = await paneTexts($)
    expect(texts).toContain(`⏳ 01:30 ${t.tickerDone}`)
    expect(s.toasts).toEqual([t.timerFinishedToast(label, '01:30')])
    // The stop button goes; "again" and the argument screen's take its place.
    expect(await paneButtons($)).toEqual(['_again-1', '_set-arg-1'])
    // Over: nothing more happens.
    await clock.advance(5000)
    expect(s.toasts).toHaveLength(1)
  })

  test(`[${options.language}] the stop button stops it: how long it ran, no toast, no more ticks`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await runCommand($, 'timer 1m')
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await pane.press({ key: STOP(1) })
    await pane.unmount()
    expect(await paneTexts($)).toContain(t.tickerStopped('00:02'))
    expect(await paneButtons($)).toEqual(['_again-1', '_set-arg-1'])
    await clock.advance(120_000)
    expect(await paneTexts($)).toContain(t.tickerStopped('00:02'))
    expect(s.toasts).toEqual([])
  })
}

test('the stop button stops its own timer alone', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'timer 10s')
  await runCommand($, 'timer 20s')
  expect(await paneButtons($)).toEqual([STOP(2), STOP(1)])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: STOP(1) })
  await pane.unmount()
  expect(await paneButtons($)).toEqual([STOP(2), '_again-1', '_set-arg-1'])
  await clock.advance(20_000)
  // The other one ran on to its end.
  expect(s.toasts).toEqual([MESSAGES.en.timerFinishedToast('Timer', '00:20')])
})

test('pushed out of the pane (past 20 results): the timer stops, no toast', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'timer 5s')
  for (let i = 0; i < 20; i++) await runCommand($, 'recap')
  expect(s.forks).toHaveLength(20)
  expect((await paneTexts($)).join('\n')).not.toContain('⏳')
  await clock.advance(10_000)
  expect(s.toasts).toEqual([])
  // Its place is free: five more can run.
  for (let i = 0; i < TICKER_LIMIT; i++) await runCommand($, 'timer 1h')
  expect(await paneButtons($)).toHaveLength(TICKER_LIMIT)
})

test(`up to ${TICKER_LIMIT} run at once: the next one fails, saying so, and the others run on`, { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  for (let i = 0; i < TICKER_LIMIT; i++) await runCommand($, 'timer 10s')
  await runCommand($, 'timer 5s')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 60 } } })
  const failed = (await pane.findAll({ text: MESSAGES.ja.tickerLimit(TICKER_LIMIT) })).filter(f => f.type === 'Text')
  expect(failed.map(f => f.props.color)).toEqual(['error'])
  await pane.unmount()
  // The one refused offers to run again; the others have their stop button.
  expect(await paneButtons($)).toEqual(['_again-6', '_set-arg-6', ...[5, 4, 3, 2, 1].map(STOP)])
  await clock.advance(10_000)
  expect(s.toasts).toHaveLength(TICKER_LIMIT)
  expect((await paneButtons($)).filter(k => k.startsWith('_stop-'))).toEqual([])
})

// After a reload the module has no timer running (the engine cancelled them),
// though the pane's state still holds the entry as running: it is drawn as
// stopped, with no button. The pane's state is written here as a reload
// leaves it.
test('a running timer entry with no timer behind it (after a reload) is drawn as stopped, with no button', { options: EN }, async ($, on) => {
  const RELOADED = [
    { id: 7, action: 'timer', target: 'none', quote: '', ticker: true, status: 'running', text: '⏳ 12:34 left' },
    { id: 6, action: 'explain', target: 'selection', quote: 'x', status: 'running', text: '' },
  ]
  // Beneath the plugin, the pane's results read as a reload leaves them.
  on('state.get', (_$, e, next) => (e.key === 'results' ? { value: { value: RELOADED, version: 1 } } : next(e)))
  mock.clock(on)
  stage(on)
  await start($)
  const texts = await paneTexts($)
  expect(texts).toContain(MESSAGES.en.tickerStopped())
  expect(texts).not.toContain('⏳ 12:34 left')
  // A call still awaited is drawn as before.
  expect(texts).toContain(MESSAGES.en.thinking)
  expect(await paneButtons($)).toEqual([])
})

// A reload between the start of a run (the entry marked `timed`) and its first
// frame (`ticker`) leaves an entry running with neither a frame nor a run
// behind it. It is drawn stopped, never left at "Thinking…", with "again" and
// the argument screen's button, so the person can run it once more.
test('a timer entry reloaded before its first frame is drawn as stopped, with again and set', { options: EN }, async ($, on) => {
  const RELOADED = [
    { id: 8, action: 'timer', target: 'none', quote: '', timed: true, status: 'running', text: '' },
    { id: 6, action: 'explain', target: 'selection', quote: 'x', status: 'running', text: '' },
  ]
  on('state.get', (_$, e, next) => (e.key === 'results' ? { value: { value: RELOADED, version: 1 } } : next(e)))
  mock.clock(on)
  stage(on)
  await start($)
  const texts = await paneTexts($)
  expect(texts).toContain(MESSAGES.en.tickerStopped())
  // Thinking… is the model call's alone, not the timer's.
  expect(texts.filter(t => t === MESSAGES.en.thinking)).toHaveLength(1)
  expect(await paneButtons($)).toEqual(['_again-8', '_set-arg-8'])
})

test('again on a timer entry reloaded before its first frame runs it anew with its argument', { options: EN }, async ($, on) => {
  const RELOADED = [{ id: 8, action: 'timer', target: 'none', quote: '', arg: '5m', input: '5m', timed: true, status: 'running', text: '' }]
  let preloaded = true
  on('state.get', (_$, e, next) => (preloaded && e.key === 'results' ? { value: { value: RELOADED, version: 1 } } : next(e)))
  const clock = mock.clock(on)
  stage(on)
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  preloaded = false
  await pane.press({ key: '_again-8' })
  await pane.unmount()
  await clock.advance(1000)
  const texts = await paneTexts($)
  expect(texts).toContain(MESSAGES.en.timerLeft('04:59'))
  expect((await paneButtons($)).filter(k => k.startsWith('_stop-'))).toHaveLength(1)
})

// Inline, the stopped line keeps the terminal's foreground (SELM-00085);
// docked under auto it stays dimColor.
for (const placement of ['dock', 'inline'] as const) {
  test(`${placement}: a timer entry with no timer behind it is drawn stopped, ${placement === 'dock' ? 'dimColor' : 'in the terminal\'s foreground'}`, { options: EN }, async ($, on) => {
    const RELOADED = [{ id: 7, action: 'timer', target: 'none', quote: '', ticker: true, status: 'running', text: '⏳ 12:34 left' }]
    on('state.get', (_$, e, next) => (e.key === 'results' ? { value: { value: RELOADED, version: 1 } } : next(e)))
    mock.clock(on)
    stage(on)
    await start($)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement } })
    const stopped = (await pane.findAll({ text: MESSAGES.en.tickerStopped() })).filter(f => f.type === 'Text')
    expect(stopped.map(f => [f.props.dimColor, f.props.color])).toEqual([placement === 'dock' ? [true, undefined] : [undefined, undefined]])
    await pane.unmount()
  })
}

// The person's close of the result pane (its close mark) stops every timer,
// through the same stop as the button. The test kit cannot raise a person's
// close (its $ has no ui.close), so that hook is checked in a session; the
// stop it calls is the one checked above with the button.

// ---------------------------------------------------------------------------
// The pane's colours and keys with a timer in it

for (const paneTheme of ['light', 'dark'] as const) {
  test(`[${paneTheme}] the stop button is drawn in the palette's muted colour`, { options: { ...EN, paneTheme } }, async ($, on) => {
    mock.clock(on)
    stage(on)
    await start($)
    await runCommand($, 'timer')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const stop = await pane.find({ key: STOP(1) })
    expect(stop).toBeDefined()
    const label = (await pane.findAll({ text: MESSAGES.en.stop })).filter(f => f.type === 'Text')
    expect(label).toHaveLength(1)
    expect(label[0]?.props.color).toBe(paneStyle(paneTheme, 'dock').muted)
    // The time left is in the body colour.
    const left = (await pane.findAll({ text: '⏳ 25:00 left' })).filter(f => f.type === 'Text')
    expect(left.map(f => f.props.color)).toEqual([paneStyle(paneTheme, 'dock').body])
    await pane.unmount()
  })
}
