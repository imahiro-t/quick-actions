import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor, isContext, isStandalone, markedIcon, needsSelection } from '../hooks/actions'
import { matchesFilter } from '../hooks/filter'
import { FILTER_KEY, toFilterField } from '../hooks/focus'
import { MESSAGES } from '../hooks/i18n'
import { BAND, EN, JA, KIND_KEY, PANE, PICKER, PICKER_ARG, PICKER_CLOSE, PICKER_FILTER, PICKER_FILTER_CLEAR, PICKER_PANE, listBox, listedActions, listedOptions, pickAction, PICKER_LIST, SURFACES, promptOf, runCommand, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// The ⋯ dialog: every action, in the hint line's order, picked with the
// keyboard or a click, run on the text selected as it opened (with none, the
// context actions alone, on the conversation). Opened by the hint line's ⋯
// and by /quick-actions without an ID.

const MORE = '_more'

// Both tabs, as ⋯ and /quick-actions open them (SELM-00050): the results'
// behind, then the dialog's, shown and asking for the keys; both closing on
// Escape, at the result pane's width.
const pickerOpens = (t: { pickerTitle: string }) => [
  { id: PANE.requestId, title: 'Quick Actions', closeOnEscape: true, columns: 56 },
  { id: PICKER, title: t.pickerTitle, focus: true, closeOnEscape: true, columns: 56 },
]

// A custom action, so the dialog is seen to list those too.
const CUSTOM = {
  customActions: JSON.stringify([
    { id: 'mine', icon: '🪄', label: { ja: '海賊風の要約', en: 'Pirate summary' }, kind: 'complete', model: 'haiku', prompt: 'Talk like a pirate.' },
  ]),
}

async function openByMore($: Engine, s: Stage, clock: Clock, surface: (typeof SURFACES)[number] | 'mobile' = 'terminal') {
  s.selected = 'ECONNREFUSED 127.0.0.1:3306'
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface })
  await band.press({ key: MORE })
  return band
}

for (const surface of SURFACES) {
  test(`[${surface}] ⋯ opens the dialog with the keyboard asked for and Escape closing it`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    expect(s.opened).toEqual(pickerOpens(MESSAGES.en))
    expect(s.shown).toBe(PICKER)
    // Opening runs nothing.
    expect(s.models).toEqual([])
  })

  test(`[${surface}] the dialog opens at the result pane's width, so the dock keeps its width`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await pickAction(picker, 'tldr')
    await picker.unmount()

    const dialog = s.opened.find(o => o.id === PICKER)
    const results = s.opened.find(o => o.id === PANE.requestId)
    expect(dialog?.columns).toBe(56)
    expect(results?.columns).toBe(56)
    expect(dialog?.columns).toBe(results?.columns)
  })

  test(`[${surface}] the dialog lists every action, custom ones too, in the hint line's order, as marked icon and label`, { options: { ...JA, ...CUSTOM } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    const hint = (await band.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => k !== 'close' && k !== MORE && !k.startsWith(KIND_KEY))
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    const options = await listedOptions(picker)
    const defs = actionsFor('ja')
    // As many as the pane's height holds, and a line saying how many more the filter reaches.
    const total = ACTIONS.length + 1
    expect(options.length).toBeLessThan(total)
    expect(options.length).toBeGreaterThan(10)
    expect(await picker.find({ text: MESSAGES.ja.pickerMore(total - options.length) })).toBeDefined()
    // The hint line is the dialog's first few of the kind it shows (on the selection).
    const onSelection = options.map(o => o.value).filter(v => needsSelection(defs.find(d => d.id === v) ?? {}))
    expect(onSelection.slice(0, hint.length)).toEqual(hint)
    for (const o of options) {
      const def = defs.find(d => d.id === o.value)
      if (def !== undefined) expect(o.label).toBe(`${markedIcon(def)} ${def.label}`)
    }
    expect(options.find(o => o.value === 'translate-ja')?.label).toBe('[🌐] 日本語訳')
    expect(options.find(o => o.value === 'recap')?.label).toBe('<🧭> 会話の要約')
    // The custom one is in the list too, past those listed: the filter reaches it.
    expect(options.map(o => o.value)).not.toContain('mine')
    await picker.input({ key: PICKER_FILTER, text: 'mine', kind: 'change' })
    const reached = await listedOptions(picker)
    expect(reached.find(o => o.value === 'mine')?.label).toBe('[🪄] 海賊風の要約')
    // The filter field above the list takes the focus, so the list does not.
    for (const b of await picker.findAll({ type: 'Button' })) expect(b.props.autoFocus).toBeUndefined()
    expect((await picker.find({ key: PICKER_FILTER }))?.props.autoFocus).toBe(true)
    await picker.unmount()
  })

  test(`[${surface}] a pick runs on the selected text, keeps the dialog's tab and shows the result`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await pickAction(picker, 'tldr')
    await picker.unmount()

    // A pick keeps the dialog's tab and shows the results' (SELM-00050).
    expect(s.closed).toEqual([])
    expect(s.shown).toBe(PANE.requestId)
    expect(s.models).toHaveLength(1)
    expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')
    // Both tabs opened again with the results' last, so it is the one shown.
    expect(s.opened.map(o => o.id)).toEqual([PANE.requestId, PICKER, PICKER, PANE.requestId])
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ text: /answer from/ })).toBeDefined()
    await pane.unmount()

    // Picked, the text's icons go as after an icon's press.
    const again = await $.ui.mount({ ...BAND, surface })
    expect(await again.find({ type: 'Button' })).toBeUndefined()
    await again.unmount()
  })
}

test('the text selected as the dialog opened is the one run on, though the selection is gone', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock)
  await band.unmount()

  // The selection goes (a click elsewhere, a prompt) while the dialog is up.
  s.selected = null
  await clock.advance(400)
  s.selected = 'something else'
  await clock.advance(400)

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'explain')
  expect(s.models).toHaveLength(1)
  expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')
  expect(s.models[0]?.prompt).not.toContain('something else')
})

// Escape closes the dialog through closeOnEscape, which the engine raises as
// `ui.close` (origin person); the plugin's hook on it lets go of the text and
// runs nothing. The test kit cannot raise a person's close (its $ has no
// ui.close), so here the close button, which lets go of the text the same
// way, is checked; Escape itself is checked in a real session.
test('the close button runs nothing and leaves no text behind', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock)
  await band.unmount()
  expect(s.opened.every(o => o.closeOnEscape === true)).toBe(true)

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.press({ key: PICKER_CLOSE })
  // The close button closes the whole pane, both tabs (SELM-00050).
  expect(s.closed).toEqual([PICKER, PANE.requestId])
  expect(s.models).toEqual([])
  expect(s.forks).toEqual([])
  expect(s.spawned).toEqual([])
  await picker.unmount()
  // The text it held went with it: drawn again, it has none to run on.
  const again = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  expect(await listedActions(again)).toEqual([])
  expect(await again.find({ text: MESSAGES.en.noSelection })).toBeDefined()
  await again.unmount()
})

for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
  test(`[${options.language}] without the keyboard: a line says how, and the close button closes it, running nothing`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock)
    await band.unmount()

    const focused = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    expect(await focused.find({ text: t.pickerNoFocus })).toBeUndefined()
    await focused.unmount()

    const unfocused = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, isFocused: false } })
    expect(await unfocused.find({ text: t.pickerNoFocus })).toBeDefined()
    expect((await listedActions(unfocused)).length).toBeGreaterThan(0)
    const close = await unfocused.find({ key: PICKER_CLOSE })
    expect(close?.props.label).toBe(t.pickerClose)
    await unfocused.press({ key: PICKER_CLOSE })
    await unfocused.unmount()

    // The close button closes the whole pane, both tabs (SELM-00050).
    expect(s.closed).toEqual([PICKER, PANE.requestId])
    expect(s.models).toEqual([])
  })

  test(`[${options.language}] [desktop] without the keyboard, the line says how too`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, 'desktop')
    await band.unmount()

    const focused = await $.ui.mount({ ...PICKER_PANE, surface: 'desktop' })
    expect(await focused.find({ text: t.pickerNoFocus })).toBeUndefined()
    await focused.unmount()

    const unfocused = await $.ui.mount({ ...PICKER_PANE, surface: 'desktop', props: { ...PICKER_PANE.props, isFocused: false } })
    expect(await unfocused.find({ text: t.pickerNoFocus })).toBeDefined()
    await unfocused.unmount()
  })

  test(`[${options.language}] [mobile] no line about the keyboard, focused or not: the actions are buttons to tap`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, 'mobile')
    await band.unmount()

    const focused = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
    expect(await focused.find({ text: t.pickerNoFocus })).toBeUndefined()
    await focused.unmount()

    const unfocused = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile', props: { ...PICKER_PANE.props, isFocused: false } })
    expect(await unfocused.find({ text: t.pickerNoFocus })).toBeUndefined()
    // The rest of the dialog is drawn as usual: the actions' buttons, then Close.
    const labels = (await unfocused.findAll({ type: 'Button' })).map(b => String(b.props.label))
    expect(labels).toHaveLength(ACTIONS.length + 1)
    const close = await unfocused.find({ key: PICKER_CLOSE })
    expect(close?.props.label).toBe(t.pickerClose)
    await unfocused.unmount()
  })

  test(`[${options.language}] ⋯ reads ${t.allActions} on hover, and the dialog is titled ${t.pickerTitle}`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock)
    expect(await band.find({ key: MORE })).toBeDefined()
    expect(await band.find({ text: new RegExp(t.allActions) })).toBeDefined()
    await band.unmount()
    expect(s.opened.find(o => o.id === PICKER)?.title).toBe(t.pickerTitle)
  })
}

// ---------------------------------------------------------------------------
// /quick-actions without an ID

for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
  test(`[${options.language}] /quick-actions without an ID opens the dialog and runs nothing`, { options }, async ($, on) => {
    const s = stage(on)
    await start($)
    s.selected = 'Bonjour'

    const r = await runCommand($, '  ')
    expect(JSON.stringify(r)).toContain(t.pickerOpened)
    expect(s.opened).toEqual(pickerOpens(t))
    expect(s.models).toEqual([])
    expect(s.toasts).toEqual([])
  })

  test(`[${options.language}] /quick-actions without an ID and nothing selected: the dialog opens on the context and standalone actions alone`, { options }, async ($, on) => {
    const s = stage(on)
    await start($)

    const r = await runCommand($, '')
    expect(s.toasts).toEqual([])
    expect(JSON.stringify(r)).toContain(t.pickerOpened)
    expect(s.opened).toEqual(pickerOpens(t))

    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    const listed = await listedOptions(picker)
    const free = actionsFor(options.language).filter(d => !needsSelection(d))
    // As many as the pane's height holds; past that, a line saying how many more the filter reaches.
    const ids = free.map(d => d.id)
    for (const o of listed) expect(ids).toContain(o.value)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.length).toBeLessThanOrEqual(free.length)
    if (free.length > listed.length) {
      expect(await picker.find({ text: t.pickerMore(free.length - listed.length) })).toBeDefined()
    }
    expect(free.filter(isContext).length).toBeGreaterThan(0)
    expect(free.filter(isStandalone).map(d => d.id)).toEqual(ACTIONS.filter(isStandalone).map(a => a.id))
    for (const o of listed) expect(o.label.startsWith('<') || o.label.startsWith('{')).toBe(true)
    // The legend names the kinds listed: no [ ] with no selection.
    expect(await picker.find({ text: t.pickerLegend(false) })).toBeDefined()
    // Picked, a context action runs on the conversation: a fork with no selection in it.
    await pickAction(picker, 'recap')
    await picker.unmount()
    // A pick keeps the dialog's tab and shows the results' (SELM-00050).
    expect(s.closed).toEqual([])
    expect(s.shown).toBe(PANE.requestId)
    expect(s.forks).toHaveLength(1)
    expect(s.forks[0]).not.toContain('<selected>')
    expect(s.models).toEqual([])
  })
}

test('a pick after /quick-actions runs on the text selected when the command ran', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'Bonjour'
  await runCommand($, '')

  // After a command has run the engine answers no selection.
  s.selected = null
  await clock.advance(400)
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'translate-ja')
  expect(s.models.map(m => m.model)).toEqual(['haiku'])
  expect(s.models[0]?.prompt).toContain('Bonjour')
  // A pick keeps the dialog's tab and shows the results' (SELM-00050).
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
})

// ---------------------------------------------------------------------------
// The mobile app: its element table names a Select it does not draw, so the
// dialog lists the actions as buttons there.

test('[mobile] the dialog lists every action as a button, and a press runs it', { options: { ...JA, ...CUSTOM } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock, 'mobile')
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
  expect(await picker.find({ type: 'Select' })).toBeUndefined()
  const labels = (await picker.findAll({ type: 'Button' })).map(b => String(b.props.label))
  const defs = actionsFor('ja')
  // Every action, icon and label, then the close button.
  expect(labels).toHaveLength(ACTIONS.length + 2)
  expect(labels).toContain('[🪄] 海賊風の要約')
  for (const def of defs) expect(labels).toContain(`${markedIcon(def)} ${def.label}`)
  expect(labels.at(-1)).toBe(MESSAGES.ja.pickerClose)

  await picker.press({ key: 'tldr' })
  await picker.unmount()
  // A pick keeps the dialog's tab and shows the results' (SELM-00050).
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
  expect(s.models).toHaveLength(1)
  expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')
})

// ---------------------------------------------------------------------------
// Custom actions whose IDs read like the keys the dialog adds: each keeps its
// own element, and the dialog's own still do as they say.

const LOOKALIKES = {
  customActions: JSON.stringify(
    ['more', 'picker', 'picker-close'].map((id, i) => ({
      id,
      icon: ['🅰', '🅱', '🅾'][i],
      label: { ja: id, en: id },
      kind: 'complete',
      model: 'haiku',
      prompt: `Answer as ${id}.`,
    })),
  ),
  actions: 'more,picker,picker-close',
}

const unique = (keys: readonly unknown[]) => new Set(keys).size === keys.length

for (const surface of [...SURFACES, 'mobile'] as const) {
  test(`[${surface}] custom IDs more, picker and picker-close share no key with ⋯ or the dialog`, { options: LOOKALIKES }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    const boxKeys = (await band.findAll({ type: 'Box' })).map(b => b.key).filter(k => k !== null && k !== undefined)
    expect(boxKeys).toContain('act-more')
    expect(unique(boxKeys)).toBe(true)
    const buttonKeys = (await band.findAll({ type: 'Button' })).map(b => b.key).filter(k => !String(k).startsWith(KIND_KEY))
    // Past the kind buttons, the three pinned first, then the rest; ✕ and ⋯ last.
    expect(buttonKeys.slice(0, 3)).toEqual(['more', 'picker', 'picker-close'])
    expect(buttonKeys.slice(-2)).toEqual(['close', MORE])
    expect(unique(buttonKeys)).toBe(true)
    await band.unmount()
    // ⋯ opened the dialog's tab, shown; nothing ran.
    expect(s.opened.map(o => o.id)).toEqual([PANE.requestId, PICKER])
    expect(s.models).toEqual([])

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    const keys = (await picker.findAll({ type: 'Button' })).map(b => b.key)
    expect(unique(keys)).toBe(true)
    // The close button closes, running nothing.
    await picker.press({ key: PICKER_CLOSE })
    await picker.unmount()
    // The close button closes the whole pane, both tabs (SELM-00050).
    expect(s.closed).toEqual([PICKER, PANE.requestId])
    expect(s.models).toEqual([])
  })
}

test('[mobile] a custom action with the ID picker-close runs from the dialog', { options: LOOKALIKES }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock, 'mobile')
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
  await picker.press({ key: 'picker-close' })
  await picker.unmount()
  // A pick keeps the dialog's tab and shows the results' (SELM-00050).
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
  expect(s.models.map(m => m.system)).toEqual([expect.stringContaining('Answer as picker-close.')])
})

test('a custom action with the ID picker runs from the dialog list', { options: LOOKALIKES }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock)
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'picker')
  await picker.unmount()
  expect(s.models.map(m => m.system)).toEqual([expect.stringContaining('Answer as picker.')])
})

// The close button is drawn as the surface's own dismiss control, its label its name.
test('the close button is a dismiss control', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock)
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  const close = await picker.find({ key: PICKER_CLOSE })
  expect(close?.props.role).toBe('dismiss')
  await picker.unmount()
})

// Without the keyboard, the notice names the way that needs no pointer.
for (const lang of ['ja', 'en'] as const) {
  test(`[${lang}] the notice without the keyboard names /quick-actions`, () => {
    expect(MESSAGES[lang].pickerNoFocus).toContain('/quick-actions')
  })
}

// ---------------------------------------------------------------------------
// The filter field: above the list, it narrows it as the person types (by ID,
// label in either language, kind name or mark; ./filter has the rules), and
// Enter in it runs the first action left.

/** The IDs the dialog's list holds now; undefined when it draws none. */
async function listed(picker: Parameters<typeof listedActions>[0]) {
  return (await listBox(picker)) === undefined ? undefined : listedActions(picker)
}

/** The spec of a built-in, to match as the dialog does. */
const specOf = (id: string) => {
  const spec = ACTIONS.find(a => a.id === id)
  if (spec === undefined) throw new Error(`no action ${id}`)
  return spec
}

// Clear hands the focus ring back to the filter field with
// settleQuietly($.ui.focus(toFilterField(PICKER))). The test kit has no
// implementation of a plugin's own $.ui.focus (it rejects with "no
// implementation for ui.focus", and a test's ui.focus hook is not reached by
// it), so what the move asks for is checked on toFilterField, and the presses
// below check that Clear still empties the field with the move refused.
test('Clear asks for the focus ring on the dialog\'s filter field', () => {
  expect(toFilterField(PICKER)).toEqual({ requestId: PICKER, key: PICKER_FILTER })
  expect(FILTER_KEY).toBe(PICKER_FILTER)
})

for (const surface of SURFACES) {
  for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
    test(`[${surface}] [${options.language}] the filter field: above the list, its placeholder, the focus; no Clear while empty`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      const band = await openByMore($, s, clock, surface)
      await band.unmount()

      const picker = await $.ui.mount({ ...PICKER_PANE, surface })
      const field = await picker.find({ key: PICKER_FILTER })
      expect(field?.type).toBe('Input')
      expect(field?.props.placeholder).toBe(t.pickerFilterPlaceholder)
      expect(field?.props.value).toBe('')
      expect(field?.props.autoFocus).toBe(true)
      expect(field?.props.label).toBeUndefined()
      // What Enter does, in the dialog's language: the first action left runs;
      // with none left, it says so.
      expect(field?.props.submitLabel).toBe(t.pickerFilterSubmit)
      await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
      expect((await picker.find({ key: PICKER_FILTER }))?.props.submitLabel).toBe(t.pickerFilterSubmitNone)
      await picker.input({ key: PICKER_FILTER, text: '', kind: 'change' })
      expect((await picker.find({ key: PICKER_FILTER }))?.props.submitLabel).toBe(t.pickerFilterSubmit)
      for (const b of await picker.findAll({ type: 'Button' })) expect(b.props.autoFocus).toBeUndefined()
      expect(await picker.find({ key: PICKER_FILTER_CLEAR })).toBeUndefined()
      // Drawn after the legend and before the list.
      const order = (await picker.findAll({})).map(f => (f.key === PICKER_FILTER ? 'field' : String(f.key).startsWith(PICKER_LIST) ? 'list' : f.text === t.pickerLegend(true) ? 'legend' : null)).filter(x => x !== null)
      expect(order).toEqual(['legend', 'field', 'list'])
      await picker.unmount()
    })
  }

  test(`[${surface}] typing narrows the list to the actions that match, in the dialog's order`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    // The first of the dialog's order, as many as the pane's height holds.
    const all = (await listed(picker)) ?? []
    const max = all.length
    expect(max).toBeLessThan(ACTIONS.length)
    for (const query of ['要約', 'japanese', '< 要約', 'ﾀｲﾏｰ', 'context']) {
      await picker.input({ key: PICKER_FILTER, text: query, kind: 'change' })
      const narrowed = (await listed(picker)) ?? []
      // Every action that matches (up to as many as fit), and nothing else: those among the
      // first listed first, in their order, then the ones past them.
      const matching = ACTIONS.filter(a => matchesFilter(a, query)).map(a => a.id)
      const head = all.filter(id => matchesFilter(specOf(id), query))
      if (matching.length <= max) expect([...narrowed].sort()).toEqual([...matching].sort())
      else expect(narrowed.length).toBeLessThan(matching.length)
      for (const id of narrowed) expect(matching).toContain(id)
      expect(narrowed.slice(0, head.length)).toEqual(head.slice(0, narrowed.length))
      expect((await picker.find({ key: PICKER_FILTER }))?.props.value).toBe(query)
    }
    // An exact ID leads, whatever the order.
    await picker.input({ key: PICKER_FILTER, text: 'code', kind: 'change' })
    expect((await listed(picker))?.[0]).toBe('code')
    // Nothing ran while typing.
    expect(s.models).toEqual([])
    expect(s.closed).toEqual([])
    await picker.unmount()
  })

  test(`[${surface}] nothing matches: a line says so, and no list is drawn`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
    expect(await listBox(picker)).toBeUndefined()
    expect(await picker.find({ text: MESSAGES.en.pickerNoMatch })).toBeDefined()
    // The field and the close button stay.
    expect(await picker.find({ key: PICKER_FILTER })).toBeDefined()
    expect(await picker.find({ key: PICKER_CLOSE })).toBeDefined()
    await picker.unmount()
  })

  test(`[${surface}] Enter in the field runs the first action left and closes the dialog`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    // Typed and Enter at once: the text Enter carries is the one matched.
    await picker.input({ key: PICKER_FILTER, text: 'tldr' })
    await picker.unmount()
    // A pick keeps the dialog's tab and shows the results' (SELM-00050).
    expect(s.closed).toEqual([])
    expect(s.shown).toBe(PANE.requestId)
    expect(s.models).toHaveLength(1)
    expect(s.models[0]?.system).toBe(promptOf(actionsFor('en').find(d => d.id === 'tldr')))
    expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')
  })

  test(`[${surface}] Enter on a filter that matches nothing runs nothing, the dialog stays`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await picker.input({ key: PICKER_FILTER, text: 'zzzz' })
    expect(s.closed).toEqual([])
    expect(s.models).toEqual([])
    expect(s.forks).toEqual([])
    expect(await picker.find({ text: MESSAGES.en.pickerNoMatch })).toBeDefined()
    expect((await picker.find({ key: PICKER_FILTER }))?.props.value).toBe('zzzz')
    await picker.unmount()
  })

  test(`[${surface}] Clear shows while the field holds text, and lists every action again`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    const all = await listed(picker)
    await picker.input({ key: PICKER_FILTER, text: '要約', kind: 'change' })
    const clear = await picker.find({ key: PICKER_FILTER_CLEAR })
    expect(clear?.props.label).toBe(MESSAGES.ja.pickerFilterClear)
    expect((await listed(picker))?.length).toBeLessThan(all?.length ?? 0)
    await picker.press({ key: PICKER_FILTER_CLEAR })
    expect(await listed(picker)).toEqual(all)
    expect((await picker.find({ key: PICKER_FILTER }))?.props.value).toBe('')
    expect(await picker.find({ key: PICKER_FILTER_CLEAR })).toBeUndefined()
    // Emptying the field by hand does the same.
    await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
    await picker.input({ key: PICKER_FILTER, text: '', kind: 'change' })
    expect(await listed(picker)).toEqual(all)
    expect(await picker.find({ key: PICKER_FILTER_CLEAR })).toBeUndefined()
    // Clearing ran nothing and closed nothing.
    expect(s.models).toEqual([])
    expect(s.closed).toEqual([])
    await picker.unmount()
  })
}

test('every open starts with the filter empty', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock)
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  const all = await listed(picker)
  await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
  await picker.press({ key: PICKER_CLOSE })
  await picker.unmount()

  // Opened again, by the command this time.
  s.selected = 'ECONNREFUSED 127.0.0.1:3306'
  await runCommand($, '')
  const again = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  expect((await again.find({ key: PICKER_FILTER }))?.props.value).toBe('')
  expect(await listed(again)).toEqual(all)
  await again.unmount()
})

test('with nothing selected, the filter narrows the context and standalone actions alone', async ($, on) => {
  const s = stage(on)
  await start($)
  await runCommand($, '')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  // The actions on the selection are not listed, so none of them match.
  await picker.input({ key: PICKER_FILTER, text: '[', kind: 'change' })
  expect(await listed(picker)).toBeUndefined()
  expect(await picker.find({ text: MESSAGES.en.pickerNoMatch })).toBeDefined()
  await picker.input({ key: PICKER_FILTER, text: 'timer' })
  // The timer takes an argument: asked for first, then run with its default.
  expect(s.closed).toEqual([])
  await picker.input({ key: PICKER_ARG, text: '' })
  await picker.unmount()
  // A pick keeps the dialog's tab and shows the results' (SELM-00050).
  expect(s.closed).toEqual([])
  expect(s.shown).toBe(PANE.requestId)
  expect(s.toasts).toEqual([])
  expect(s.models).toEqual([])
})

test('[mobile] no filter field: every action is a button, as before', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock, 'mobile')
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
  expect(await picker.find({ key: PICKER_FILTER })).toBeUndefined()
  expect(await picker.find({ type: 'Input' })).toBeUndefined()
  expect(await picker.find({ key: PICKER_FILTER_CLEAR })).toBeUndefined()
  expect((await picker.findAll({ type: 'Button' })).filter(b => b.key !== PICKER_CLOSE)).toHaveLength(ACTIONS.length)
  await picker.unmount()
})

for (const surface of SURFACES) {
  test(`[${surface}] [paneTheme] the field narrows the buttons by the same rules, and Enter runs the first`, { options: { ...JA, paneTheme: 'dark' } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    const actionButtons = async () =>
      (await picker.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => k !== PICKER_CLOSE && k !== PICKER_FILTER_CLEAR)
    expect(await picker.find({ type: 'Select' })).toBeUndefined()
    expect((await picker.find({ key: PICKER_FILTER }))?.props.autoFocus).toBe(true)
    // With the field there, as many as the pane's height holds, as without a palette.
    const all = await actionButtons()
    expect(all).toEqual(await listedActions(picker))
    expect(all.length).toBeLessThan(ACTIONS.length)

    await picker.input({ key: PICKER_FILTER, text: '要約', kind: 'change' })
    const narrowed = await actionButtons()
    const matching = ACTIONS.filter(a => matchesFilter(a, '要約')).map(a => a.id)
    expect(narrowed.length).toBeGreaterThan(0)
    for (const id of narrowed) expect(matching).toContain(id)
    const head = all.filter(id => matchesFilter(specOf(id), '要約'))
    expect(narrowed.slice(0, head.length)).toEqual(head.slice(0, narrowed.length))
    // Clear, in the palette's muted colour; pressed, it lists every action again.
    const clear = await picker.find({ key: PICKER_FILTER_CLEAR })
    expect(clear).toBeDefined()
    await picker.press({ key: PICKER_FILTER_CLEAR })
    expect(await actionButtons()).toEqual(all)
    await picker.input({ key: PICKER_FILTER, text: '要約', kind: 'change' })

    await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
    expect(await actionButtons()).toEqual([])
    expect(await picker.find({ text: MESSAGES.ja.pickerNoMatch })).toBeDefined()

    await picker.input({ key: PICKER_FILTER, text: '要約' })
    await picker.unmount()
    // A pick keeps the dialog's tab and shows the results' (SELM-00050).
    expect(s.closed).toEqual([])
    expect(s.shown).toBe(PANE.requestId)
    expect(s.models).toHaveLength(1)
    expect(s.models[0]?.system).toBe(promptOf(actionsFor('ja').find(d => d.id === narrowed[0])))
  })
}

// The dialog asks for rows enough for its list, its lines, its field and its
// button, up to 30: past that the pane scrolls.
for (const [count, rows] of [[0, Math.min(ACTIONS.length + 6, 30)], [1, Math.min(ACTIONS.length + 7, 30)], [20, 30]] as const) {
  const customActions = JSON.stringify(
    Array.from({ length: count }, (_, i) => ({ id: `extra-${i}`, icon: '🧩', label: `Extra ${i}`, kind: 'complete', model: 'haiku', prompt: 'Answer.' })),
  )
  test(`with ${count} custom actions, the dialog asks for ${rows} rows`, { options: { customActions } }, async ($, on) => {
    const s = stage(on)
    await start($)
    await runCommand($, '')
    expect(s.rows[PICKER]).toBe(Math.min(ACTIONS.length + count + 6, 30))
    expect(s.rows[PICKER]).toBe(rows)
  })
}
