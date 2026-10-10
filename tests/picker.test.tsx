import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor, isContext, isStandalone, markedIcon, needsSelection } from '../hooks/actions'
import { matchesFilter } from '../hooks/filter'
import { FILTER_KEY, toFilterField } from '../hooks/focus'
import { MESSAGES } from '../hooks/i18n'
import { BAND, EN, JA, PANE, PICKER, PICKER_CLOSE, PICKER_FILTER, PICKER_FILTER_CLEAR, PICKER_PANE, PICKER_SELECT, SURFACES, promptOf, runCommand, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// The ⋯ dialog: every action, in the hint line's order, picked with the
// keyboard or a click, run on the text selected as it opened (with none, the
// context actions alone, on the conversation). Opened by the hint line's ⋯
// and by /quick-actions without an ID.

const MORE = '_more'

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

    expect(s.opened).toEqual([{ id: PICKER, title: MESSAGES.en.pickerTitle, focus: true, closeOnEscape: true, columns: 56 }])
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
    await picker.select({ key: PICKER_SELECT, value: 'tldr' })
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
    const hint = (await band.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => k !== 'close' && k !== MORE)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    const select = await picker.find({ type: 'Select' })
    const options = select?.props.options as { value: string; label: string }[]
    const defs = actionsFor('ja')
    expect(options).toHaveLength(ACTIONS.length + 1)
    // The hint line is the dialog's first few.
    expect(options.slice(0, hint.length).map(o => o.value)).toEqual(hint)
    expect(options.map(o => o.value)).toContain('mine')
    for (const o of options) {
      const def = defs.find(d => d.id === o.value)
      if (def !== undefined) expect(o.label).toBe(`${markedIcon(def)} ${def.label}`)
    }
    expect(options.find(o => o.value === 'translate-ja')?.label).toBe('[🌐] 日本語訳')
    expect(options.find(o => o.value === 'recap')?.label).toBe('<🧭> 会話の要約')
    expect(options.find(o => o.value === 'mine')?.label).toBe('[🪄] 海賊風の要約')
    // The filter field above the list takes the focus, so the list does not.
    expect(select?.props.autoFocus).toBeUndefined()
    expect((await picker.find({ key: PICKER_FILTER }))?.props.autoFocus).toBe(true)
    await picker.unmount()
  })

  test(`[${surface}] a pick runs on the selected text, closes the dialog and shows the result`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await picker.select({ key: PICKER_SELECT, value: 'tldr' })
    await picker.unmount()

    expect(s.closed).toEqual([PICKER])
    expect(s.models).toHaveLength(1)
    expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')
    expect(s.opened.map(o => o.id)).toEqual([PICKER, PANE.requestId])
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
  await picker.select({ key: PICKER_SELECT, value: 'explain' })
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
  expect(s.opened[0]?.closeOnEscape).toBe(true)

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.press({ key: PICKER_CLOSE })
  expect(s.closed).toEqual([PICKER])
  expect(s.models).toEqual([])
  expect(s.forks).toEqual([])
  expect(s.spawned).toEqual([])
  await picker.unmount()
  // The text it held went with it: drawn again, it has none to run on.
  const again = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Select' })).toBeUndefined()
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
    expect(await unfocused.find({ type: 'Select' })).toBeDefined()
    const close = await unfocused.find({ key: PICKER_CLOSE })
    expect(close?.props.label).toBe(t.pickerClose)
    await unfocused.press({ key: PICKER_CLOSE })
    await unfocused.unmount()

    expect(s.closed).toEqual([PICKER])
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
    expect(s.opened[0]?.title).toBe(t.pickerTitle)
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
    expect(s.opened).toEqual([{ id: PICKER, title: t.pickerTitle, focus: true, closeOnEscape: true, columns: 56 }])
    expect(s.models).toEqual([])
    expect(s.toasts).toEqual([])
  })

  test(`[${options.language}] /quick-actions without an ID and nothing selected: the dialog opens on the context and standalone actions alone`, { options }, async ($, on) => {
    const s = stage(on)
    await start($)

    const r = await runCommand($, '')
    expect(s.toasts).toEqual([])
    expect(JSON.stringify(r)).toContain(t.pickerOpened)
    expect(s.opened).toEqual([{ id: PICKER, title: t.pickerTitle, focus: true, closeOnEscape: true, columns: 56 }])

    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    const listed = (await picker.find({ type: 'Select' }))?.props.options as { value: string; label: string }[]
    const free = actionsFor(options.language).filter(d => !needsSelection(d))
    expect(listed.map(o => o.value)).toEqual(expect.arrayContaining(free.map(d => d.id)))
    expect(listed).toHaveLength(free.length)
    expect(free.filter(isContext).length).toBeGreaterThan(0)
    expect(free.filter(isStandalone).map(d => d.id)).toEqual(['timer'])
    for (const o of listed) expect(o.label.startsWith('<') || o.label.startsWith('{')).toBe(true)
    // The legend names the kinds listed: no [ ] with no selection.
    expect(await picker.find({ text: t.pickerLegend(false) })).toBeDefined()
    // Picked, a context action runs on the conversation: a fork with no selection in it.
    await picker.select({ key: PICKER_SELECT, value: 'recap' })
    await picker.unmount()
    expect(s.closed).toEqual([PICKER])
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
  await picker.select({ key: PICKER_SELECT, value: 'translate-ja' })
  expect(s.models.map(m => m.model)).toEqual(['haiku'])
  expect(s.models[0]?.prompt).toContain('Bonjour')
  expect(s.closed).toEqual([PICKER])
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
  expect(s.closed).toEqual([PICKER])
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
    const buttonKeys = (await band.findAll({ type: 'Button' })).map(b => b.key)
    // The three pinned first, then the rest; ✕ and ⋯ last.
    expect(buttonKeys.slice(0, 3)).toEqual(['more', 'picker', 'picker-close'])
    expect(buttonKeys.slice(-2)).toEqual(['close', MORE])
    expect(unique(buttonKeys)).toBe(true)
    await band.unmount()
    // ⋯ opened the dialog; nothing ran.
    expect(s.opened.map(o => o.id)).toEqual([PICKER])
    expect(s.models).toEqual([])

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    const keys = [...(await picker.findAll({ type: 'Button' })), ...(await picker.findAll({ type: 'Select' }))].map(b => b.key)
    expect(unique(keys)).toBe(true)
    // The close button closes, running nothing.
    await picker.press({ key: PICKER_CLOSE })
    await picker.unmount()
    expect(s.closed).toEqual([PICKER])
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
  expect(s.closed).toEqual([PICKER])
  expect(s.models.map(m => m.system)).toEqual([expect.stringContaining('Answer as picker-close.')])
})

test('a custom action with the ID picker runs from the dialog list', { options: LOOKALIKES }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock)
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.select({ key: PICKER_SELECT, value: 'picker' })
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

/** The values the dialog's Select lists now; undefined when it draws none. */
async function listed(picker: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  const select = await picker.find({ type: 'Select' })
  return select === undefined ? undefined : (select.props.options as { value: string }[]).map(o => o.value)
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
      expect((await picker.find({ type: 'Select' }))?.props.autoFocus).toBeUndefined()
      expect(await picker.find({ key: PICKER_FILTER_CLEAR })).toBeUndefined()
      // Drawn after the legend and before the list.
      const order = (await picker.findAll({})).map(f => (f.key === PICKER_FILTER ? 'field' : f.type === 'Select' ? 'list' : f.text === t.pickerLegend(true) ? 'legend' : null)).filter(x => x !== null)
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
    const all = (await listed(picker)) ?? []
    expect(all).toHaveLength(ACTIONS.length)
    for (const query of ['要約', 'japanese', '< 要約', 'ﾀｲﾏｰ', 'context']) {
      await picker.input({ key: PICKER_FILTER, text: query, kind: 'change' })
      const narrowed = await listed(picker)
      expect(narrowed).toEqual(all.filter(id => matchesFilter(specOf(id), query)))
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

  test(`[${surface}] nothing matches: a line says so, and no Select is drawn`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
    expect(await picker.find({ type: 'Select' })).toBeUndefined()
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
    expect(s.closed).toEqual([PICKER])
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
  await picker.unmount()
  expect(s.closed).toEqual([PICKER])
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
    const all = await actionButtons()
    expect(all).toHaveLength(ACTIONS.length)

    await picker.input({ key: PICKER_FILTER, text: '要約', kind: 'change' })
    const narrowed = await actionButtons()
    expect(narrowed).toEqual(all.filter(id => matchesFilter(specOf(id), '要約')))
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
    expect(s.closed).toEqual([PICKER])
    expect(s.models).toHaveLength(1)
    expect(s.models[0]?.system).toBe(promptOf(actionsFor('ja').find(d => d.id === narrowed[0])))
  })
}

// The dialog asks for rows enough for its list, its lines, its field and its
// button, up to 30: past that the pane scrolls.
for (const [count, rows] of [[0, ACTIONS.length + 6], [1, Math.min(ACTIONS.length + 7, 30)], [20, 30]] as const) {
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
