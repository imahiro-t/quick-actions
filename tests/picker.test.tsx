import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor, isContext, isStandalone, markedIcon, needsSelection } from '../hooks/actions'
import { matchesFilter } from '../hooks/filter'
import { FILTER_KEY, toFilterField } from '../hooks/focus'
import { MESSAGES } from '../hooks/i18n'
import { BAND, COMPOSE_TOGGLE, EN, JA, KIND_KEY, PANE, PICKER, PICKER_ARG, PICKER_CLOSE, PICKER_FILTER, PICKER_FILTER_CLEAR, PICKER_KIND, PICKER_PANE, listBox, listedActions, listedOptions, pickAction, pickerKindButtons, showPickerKind, PICKER_LIST, PICKER_NEXT, PICKER_PREV, SURFACES, pageText, promptOf, runCommand, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// The ⋯ dialog: every action, the most used first, picked with the
// keyboard or a click, run on the text selected as it opened (with none, the
// context actions alone, on the conversation). Opened by the hint line's ⋯
// and by /quick-actions without an ID.

const MORE = '_more'

// The notice the dialog once drew while it did not hold the keyboard
// (SELM-00068 took it off): never drawn, focused or not, in either language.
const OLD_NOTICES = [
  '入力欄が空のときに ⋯ を押すか /quick-actions を実行すると、キーボードで選べます。クリックでも選べます。',
  'Press ⋯ while the prompt is empty, or run /quick-actions, to pick with the keyboard. You can also click one.',
]
/** Whether any string drawn in `node` (a text, a label) holds a part of the old notice. */
const holdsNotice = (node: unknown): boolean => {
  const strings = (n: unknown): string[] => {
    if (typeof n === 'string') return [n]
    if (typeof n !== 'object' || n === null) return []
    const o = n as { props?: Record<string, unknown>; children?: unknown[] }
    const own = ['label', 'placeholder', 'submitLabel'].flatMap(k => (typeof o.props?.[k] === 'string' ? [String(o.props[k])] : []))
    return [...own, ...(o.children ?? []).flatMap(strings)]
  }
  return strings(node).some(text => OLD_NOTICES.some(notice => text.includes(notice) || (text.length > 20 && notice.includes(text))) || /キーボードで選べます|pick with the keyboard/.test(text))
}

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

  test(`[${surface}] the dialog lists every action, custom ones too, in the order of definition while none is used, as marked icon and label`, { options: { ...JA, ...CUSTOM } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    const hint = (await band.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => k !== 'close' && k !== MORE && k !== '_chain-mode' && !k.startsWith(KIND_KEY))
    await band.unmount()

    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    const options = await listedOptions(picker)
    const defs = actionsFor('ja')
    // As many as the pane's height holds, and the page buttons to reach the rest.
    const total = ACTIONS.length + 1
    expect(options.length).toBeLessThan(total)
    expect(options.length).toBeGreaterThan(10)
    expect(await picker.find({ key: PICKER_NEXT })).toBeDefined()
    // Nothing used yet and nothing pinned: every kind in the order of definition, the
    // default set not led as on the hint line (SELM-00068), whose actions are all there.
    expect(options.map(o => o.value)).toEqual(defs.slice(0, options.length).map(d => d.id))
    expect(hint.length).toBeGreaterThan(0)
    for (const id of hint) expect(defs.map(d => d.id)).toContain(id)
    for (const o of options) {
      const def = defs.find(d => d.id === o.value)
      if (def !== undefined) expect(o.label).toBe(`${markedIcon(def)} ${def.label}`)
    }
    expect(options.find(o => o.value === 'translate-ja')?.label).toBe('[🌐] 日本語訳')
    // The custom one is in the list too, past those listed: the filter reaches it.
    expect(options.map(o => o.value)).not.toContain('mine')
    await picker.input({ key: PICKER_FILTER, text: 'mine', kind: 'change' })
    const reached = await listedOptions(picker)
    expect(reached.find(o => o.value === 'mine')?.label).toBe('[🪄] 海賊風の要約')
    await picker.input({ key: PICKER_FILTER, text: 'recap', kind: 'change' })
    expect((await listedOptions(picker)).find(o => o.value === 'recap')?.label).toBe('<🧭> 会話の要約')
    await picker.input({ key: PICKER_FILTER, text: '', kind: 'change' })
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
  await clock.advance(400)

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'explain')
  expect(s.models).toHaveLength(1)
  expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')
})

test('a selection made while the dialog is up is the one run on next, each time', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock)
  await band.unmount()
  s.selected = null
  await clock.advance(400)

  s.selected = 'something else'
  await clock.advance(400)
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'explain')
  await picker.unmount()
  expect(s.models.at(-1)?.prompt).toContain('something else')
  expect(s.models.at(-1)?.prompt).not.toContain('ECONNREFUSED 127.0.0.1:3306')

  // After that run (the results in front, the dialog behind): a third one.
  s.selected = 'a third text'
  await clock.advance(400)
  const again = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(again, 'explain')
  await again.unmount()
  expect(s.models.at(-1)?.prompt).toContain('a third text')
  expect(s.models.at(-1)?.prompt).not.toContain('something else')
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
  test(`[${options.language}] without the keyboard: no line about it (SELM-00068), the list still answers a click, and the close button closes it`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock)
    await band.unmount()

    const focused = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    expect(holdsNotice(await focused.drawn())).toBe(false)
    const focusedList = await listedActions(focused)
    await focused.unmount()

    const unfocused = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, isFocused: false } })
    expect(holdsNotice(await unfocused.drawn())).toBe(false)
    // The same list, focused or not: no row goes to a notice.
    expect(await listedActions(unfocused)).toEqual(focusedList)
    expect((await listedActions(unfocused)).length).toBeGreaterThan(0)
    const close = await unfocused.find({ key: PICKER_CLOSE })
    expect(close?.props.label).toBe(t.pickerClose)
    await unfocused.press({ key: PICKER_CLOSE })
    await unfocused.unmount()

    // The close button closes the whole pane, both tabs (SELM-00050).
    expect(s.closed).toEqual([PICKER, PANE.requestId])
    expect(s.models).toEqual([])
  })

  test(`[${options.language}] [terminal] without the keyboard, a click on the list still runs the action`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock)
    await band.unmount()

    const unfocused = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, isFocused: false } })
    expect(holdsNotice(await unfocused.drawn())).toBe(false)
    const first = (await listedActions(unfocused))[0] ?? ''
    expect(first).not.toBe('')
    await unfocused.press({ key: first })
    await unfocused.unmount()
    expect(s.models).toHaveLength(1)
    expect(s.shown).toBe(PANE.requestId)
  })

  test(`[${options.language}] [desktop] without the keyboard, no line about it either`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, 'desktop')
    await band.unmount()

    const focused = await $.ui.mount({ ...PICKER_PANE, surface: 'desktop' })
    expect(holdsNotice(await focused.drawn())).toBe(false)
    await focused.unmount()

    const unfocused = await $.ui.mount({ ...PICKER_PANE, surface: 'desktop', props: { ...PICKER_PANE.props, isFocused: false } })
    expect(holdsNotice(await unfocused.drawn())).toBe(false)
    expect((await listedActions(unfocused)).length).toBeGreaterThan(0)
    await unfocused.unmount()
  })

  test(`[${options.language}] [mobile] no line about the keyboard, focused or not: the actions are buttons to tap`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, 'mobile')
    await band.unmount()

    const focused = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
    expect(holdsNotice(await focused.drawn())).toBe(false)
    await focused.unmount()

    const unfocused = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile', props: { ...PICKER_PANE.props, isFocused: false } })
    expect(holdsNotice(await unfocused.drawn())).toBe(false)
    // The rest of the dialog is drawn as usual: the kind buttons, the multi-select toggle, the actions' buttons, then Close.
    const labels = (await unfocused.findAll({ type: 'Button' })).map(b => String(b.props.label))
    expect(labels).toHaveLength(4 + 1 + ACTIONS.length + 1)
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
    // As many as the pane's height holds; past that, the page buttons.
    const ids = free.map(d => d.id)
    for (const o of listed) expect(ids).toContain(o.value)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.length).toBeLessThanOrEqual(free.length)
    if (free.length > listed.length) {
      expect(await picker.find({ key: PICKER_NEXT })).toBeDefined()
    }
    expect(free.filter(isContext).length).toBeGreaterThan(0)
    expect(free.filter(isStandalone).map(d => d.id)).toEqual(ACTIONS.filter(isStandalone).map(a => a.id))
    for (const o of listed) expect(o.label.startsWith('<') || o.label.startsWith('{')).toBe(true)
    // The kind buttons name the kinds listed: no selection's with no selection.
    expect((await pickerKindButtons(picker)).map(b => b.kind)).toEqual(['all', 'context', 'standalone'])
    expect(await picker.find({ key: `${PICKER_KIND}selection` })).toBeUndefined()
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
  // The kind buttons, the multi-select toggle, every action, icon and label, then the close button.
  expect(labels).toHaveLength(4 + 1 + ACTIONS.length + 2)
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
  pinActions: 'more,picker,picker-close',
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
    // Past the kind buttons, the three pinned first, then the rest; ✕, ⋯ and ⛓ last.
    expect(buttonKeys.slice(0, 3)).toEqual(['more', 'picker', 'picker-close'])
    expect(buttonKeys.slice(-3)).toEqual(['close', MORE, '_chain-mode'])
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

// The notice the dialog drew without the keyboard is gone from the messages (SELM-00068).
for (const lang of ['ja', 'en'] as const) {
  test(`[${lang}] no message holds the notice without the keyboard any more`, () => {
    expect('pickerNoFocus' in MESSAGES[lang]).toBe(false)
    expect('pickerLegend' in MESSAGES[lang]).toBe(false)
    for (const value of Object.values(MESSAGES[lang])) {
      if (typeof value === 'string') expect(OLD_NOTICES).not.toContain(value)
    }
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
      // Its label, drawn before it and its name (SELM-00086).
      expect(field?.props.label).toBe(t.pickerFilterLabel)
      // What Enter does, in the dialog's language: the first action left runs;
      // with none left, it says so.
      expect(field?.props.submitLabel).toBe(t.pickerFilterSubmit)
      await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
      expect((await picker.find({ key: PICKER_FILTER }))?.props.submitLabel).toBe(t.pickerFilterSubmitNone)
      await picker.input({ key: PICKER_FILTER, text: '', kind: 'change' })
      expect((await picker.find({ key: PICKER_FILTER }))?.props.submitLabel).toBe(t.pickerFilterSubmit)
      for (const b of await picker.findAll({ type: 'Button' })) expect(b.props.autoFocus).toBeUndefined()
      expect(await picker.find({ key: PICKER_FILTER_CLEAR })).toBeUndefined()
      // Drawn after the kind buttons (where the legend was) and before the list.
      const order = (await picker.findAll({}))
        .map(f => (f.key === PICKER_FILTER ? 'field' : String(f.key).startsWith(PICKER_LIST) ? 'list' : String(f.key).startsWith(PICKER_KIND) ? 'kind' : null))
        .filter(x => x !== null)
      expect(order).toEqual(['kind', 'kind', 'kind', 'kind', 'field', 'list'])
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
  expect((await picker.findAll({ type: 'Button' })).filter(b => b.key !== PICKER_CLOSE && b.key !== COMPOSE_TOGGLE && !String(b.key).startsWith(PICKER_KIND))).toHaveLength(ACTIONS.length)
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
      (await picker.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => ![PICKER_CLOSE, PICKER_FILTER_CLEAR, PICKER_PREV, PICKER_NEXT, COMPOSE_TOGGLE].includes(k) && !k.startsWith(PICKER_KIND))
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

// ---------------------------------------------------------------------------
// SELM-00068: the kind buttons above the list, and the list by usage

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_000 * DAY
const used = (score: number) => ({ score, at: NOW })

/** The definitions in the language, by ID. */
const defOf = (lang: 'ja' | 'en', id: string) => actionsFor(lang).find(d => d.id === id)

for (const surface of SURFACES) {
  for (const [options, t] of [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const) {
    test(`[${surface}] [${options.language}] the kind buttons: "all" stands out as it opens; a press lists that kind alone, "all" or again every kind`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      const band = await openByMore($, s, clock, surface)
      await band.unmount()

      const KINDS = ['all', 'selection', 'context', 'standalone'] as const
      const name = (k: (typeof KINDS)[number]) => (k === 'all' ? t.allActions : t.hintKindTips[k])
      const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 400 } } })
      const all = await listedActions(picker)
      expect(all).toHaveLength(ACTIONS.length)
      // "all", then every kind with a text held; drawn as their marks and names, "all" bold and named as shown, the rest dim.
      const opened = await pickerKindButtons(picker)
      expect(opened.map(k => k.kind)).toEqual([...KINDS])
      expect(opened.map(k => k.drawn)).toEqual([t.pickerAll, t.pickerKinds.selection, t.pickerKinds.context, t.pickerKinds.standalone])
      expect(opened.map(k => [k.bold, k.dimColor])).toEqual([[true, false], [false, true], [false, true], [false, true]])
      expect(opened.map(k => k.label)).toEqual([t.hintKindShown(t.allActions), t.hintKindTips.selection, t.hintKindTips.context, t.hintKindTips.standalone])
      // The field keeps the focus ring as the dialog opens; no kind button takes it.
      expect((await picker.find({ key: PICKER_FILTER }))?.props.autoFocus).toBe(true)
      for (const b of await picker.findAll({ type: 'Button' })) expect(b.props.autoFocus).toBeUndefined()

      for (const [kind, of] of [['selection', needsSelection], ['context', isContext], ['standalone', isStandalone]] as const) {
        await showPickerKind(picker, kind)
        const listed = await listedActions(picker)
        // That kind alone, every one of it, in the dialog's order.
        expect(listed).toEqual(all.filter(id => of(defOf(options.language, id) ?? { id: '' } as never)))
        expect(listed.length).toBeGreaterThan(0)
        const kinds = await pickerKindButtons(picker)
        expect(kinds.map(k => [k.kind, k.bold, k.dimColor])).toEqual(KINDS.map(k => [k, k === kind, k !== kind]))
        expect(kinds.map(k => k.label)).toEqual(KINDS.map(k => (k === kind ? t.hintKindShown(name(k)) : name(k))))
      }
      const everyKind = [[true, false], [false, true], [false, true], [false, true]]
      // Pressed again: every kind again, "all" standing out.
      await showPickerKind(picker, 'standalone')
      expect(await listedActions(picker)).toEqual(all)
      expect((await pickerKindButtons(picker)).map(k => [k.bold, k.dimColor])).toEqual(everyKind)
      // "all": every kind, from any kind; pressed again, still every kind.
      await showPickerKind(picker, 'context')
      await showPickerKind(picker, 'all')
      expect(await listedActions(picker)).toEqual(all)
      expect((await pickerKindButtons(picker)).map(k => [k.bold, k.dimColor])).toEqual(everyKind)
      await showPickerKind(picker, 'all')
      expect(await listedActions(picker)).toEqual(all)
      // Switched, then the dialog opened afresh: every kind again.
      await showPickerKind(picker, 'context')
      await picker.unmount()
      expect(s.models).toEqual([])
      const again = await openByMore($, s, clock, surface)
      await again.unmount()
      const reopened = await $.ui.mount({ ...PICKER_PANE, surface, props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 400 } } })
      expect(await listedActions(reopened)).toEqual(all)
      expect((await pickerKindButtons(reopened)).map(k => k.bold)).toEqual([true, false, false, false])
      await reopened.unmount()
    })
  }

  test(`[${surface}] the filter narrows within the kind listed, and Enter runs the first of it`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()
    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 400 } } })
    // 要約 matches actions of several kinds; switched to the conversation's, those alone.
    await picker.input({ key: PICKER_FILTER, text: '要約', kind: 'change' })
    const every = await listedActions(picker)
    expect(every.some(id => needsSelection(defOf('ja', id) ?? ({} as never)))).toBe(true)
    expect(every.some(id => isContext(defOf('ja', id) ?? ({} as never)))).toBe(true)
    await showPickerKind(picker, 'context')
    const narrowed = await listedActions(picker)
    expect(narrowed).toEqual(every.filter(id => isContext(defOf('ja', id) ?? ({} as never))))
    // The filter is kept as the kind switches.
    expect((await picker.find({ key: PICKER_FILTER }))?.props.value).toBe('要約')
    // Enter: the first of that kind runs (a context action, a fork on the conversation).
    await picker.input({ key: PICKER_FILTER, text: '要約' })
    await picker.unmount()
    expect(s.models).toEqual([])
    expect(s.forks).toHaveLength(1)
    expect(Object.keys(s.stored['usage'] as object)).toEqual([narrowed[0]])
  })

  test(`[${surface}] the kind is kept through a pick, the filter emptied`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()
    const picker = await $.ui.mount({ ...PICKER_PANE, surface })
    await showPickerKind(picker, 'context')
    await pickAction(picker, 'recap')
    expect(s.forks).toHaveLength(1)
    expect((await picker.find({ key: PICKER_FILTER }))?.props.value).toBe('')
    expect((await pickerKindButtons(picker)).map(k => k.bold)).toEqual([false, false, true, false])
    expect((await listedActions(picker)).every(id => isContext(defOf('ja', id) ?? ({} as never)))).toBe(true)
    await picker.unmount()
  })
}

test('a kind left as the selection\'s with no text held lists every kind there is (no selection button)', async ($, on) => {
  const PICKING = { text: null, filter: '', kind: 'selection' }
  on('state.get', (_$, e, next) => (e.key === 'picking' ? { value: { value: PICKING, version: 1 } } : next(e)))
  mock.clock(on)
  stage(on)
  await start($)
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 400 } } })
  expect((await pickerKindButtons(picker)).map(k => [k.kind, k.bold, k.dimColor])).toEqual([['all', true, false], ['context', false, true], ['standalone', false, true]])
  expect(await listedActions(picker)).toEqual(ACTIONS.filter(a => !needsSelection(a)).map(a => a.id))
  await picker.unmount()
})

test('[mobile] the kind buttons above the list; the first action, not a kind button, takes the focus ring with a palette', { options: { ...JA, paneTheme: 'dark' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const band = await openByMore($, s, clock, 'mobile')
  await band.unmount()
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'mobile' })
  const kinds = (await picker.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith(PICKER_KIND))
  expect(kinds).toHaveLength(4)
  for (const k of kinds) expect(k.props.autoFocus).toBeUndefined()
  const first = (await listedActions(picker))[0]
  expect((await picker.find({ key: String(first) }))?.props.autoFocus).toBe(true)
  await showPickerKind(picker, 'standalone')
  const standalone = await listedActions(picker)
  expect(standalone.every(id => isStandalone(defOf('ja', id) ?? ({} as never)))).toBe(true)
  expect((await picker.find({ key: String(standalone[0]) }))?.props.autoFocus).toBe(true)
  await picker.unmount()
})

for (const surface of SURFACES) {
  test(`[${surface}] the list by usage: pins first, then the scores highest first, ties and the unused in the order of definition; the same within a kind`, { options: { ...JA, pinActions: 'why' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const s = stage(on, { store: { usage: { 'timer': used(5), 'recap': used(3), 'explain': used(3), 'translate-en': used(1) } } })
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()
    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 400 } } })
    const scored = ['why', 'timer', 'explain', 'recap', 'translate-en']
    // As the dialog opens: the pin, then by score (a standalone, a selection and a context action mixed), explain before recap (tied, defined first).
    const listed = await listedActions(picker)
    expect(listed.slice(0, 5)).toEqual(scored)
    expect(listed.slice(5)).toEqual(ACTIONS.map(a => a.id).filter(id => !scored.includes(id)))
    // Within a kind, the same rule.
    await showPickerKind(picker, 'selection')
    expect((await listedActions(picker)).slice(0, 3)).toEqual(['why', 'explain', 'translate-en'])
    await showPickerKind(picker, 'context')
    expect((await listedActions(picker))[0]).toBe('recap')
    await showPickerKind(picker, 'standalone')
    expect((await listedActions(picker))[0]).toBe('timer')
    await picker.unmount()
  })

  test(`[${surface}] nothing used and nothing pinned: the list in the order of definition, the default set not led`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const s = stage(on)
    await start($)
    const band = await openByMore($, s, clock, surface)
    await band.unmount()
    const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: { ...PICKER_PANE.props, scroll: { offset: 0, bodyRows: 400 } } })
    expect(await listedActions(picker)).toEqual(ACTIONS.map(a => a.id))
    await showPickerKind(picker, 'context')
    expect(await listedActions(picker)).toEqual(ACTIONS.filter(isContext).map(a => a.id))
    await picker.unmount()
  })
}
