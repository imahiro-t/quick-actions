import { expect, mock, test } from './kit'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { actionsFor, emojiIcon, markedIcon } from '../hooks/actions'
import type { ActionDef } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import type { Lang, Messages } from '../hooks/i18n'
import { paneStyle } from '../hooks/palette'
import { BAND, EN, EVERY_ACTION_FITS, JA, KIND_KEY, PANE, PICKER_ARG, PICKER_FILTER, PICKER_PANE, SURFACES, pickAction, runCommand, showKind, stage, start } from './stage'
import type { HintKindName } from './stage'
import type { Result } from '../types'

// SELM-00086: the names assistive tech (and a desktop's native buttons) read
// for the hint line's buttons, the ⋯ dialog's fields and the result pane's
// buttons. A Button drawing children is named by its `label` and draws the
// children: each button below draws what it always drew and is named apart
// from it. An Input's label is drawn before the field and names it.

const LANGS = [[JA, MESSAGES.ja], [EN, MESSAGES.en]] as const
const KINDS: readonly HintKindName[] = ['selection', 'context', 'standalone']
const STOP = (id: number) => `_stop-${id}`
const AGAIN = (id: number) => `_again-${id}`
const SET_ARG = (id: number) => `_set-arg-${id}`

/** The hint line drawn on a terminal wide enough for every action. */
const mountBand = ($: Engine, surface: (typeof SURFACES)[number] = 'terminal') => $.ui.mount({ ...BAND, surface, viewport: EVERY_ACTION_FITS })

type Band = Awaited<ReturnType<typeof mountBand>>

/** The hint line's buttons but the kind buttons, as drawn and as named, by key. */
const hintButtons = async (band: Band) =>
  (await band.findAll({ type: 'Button' }))
    .filter(b => !String(b.key).startsWith(KIND_KEY))
    .map(b => ({ key: String(b.key), drawn: b.text, name: String(b.props.label) }))

/** The built-in `id` in `lang`. */
const builtIn = (id: string, lang: Lang): ActionDef => {
  const def = actionsFor(lang).find(a => a.id === id)
  if (def === undefined) throw new Error(`no built-in ${id}`)
  return def
}

/** What a result entry of `def` is named by on its buttons: as its heading says it, the icon and the label. */
const entryOf = (def: ActionDef) => `${emojiIcon(def.icon)} ${def.label}`

// ---------------------------------------------------------------------------
// The hint line

for (const surface of SURFACES) {
  for (const [options, t] of LANGS) {
    test(`[${surface}] [${options.language}] each action button on the hint line draws its marked icon and is named by it, its label and its kind`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'ECONNREFUSED 127.0.0.1:3306'
      await clock.advance(400)
      const band = await mountBand($, surface)
      for (const kind of KINDS) {
        await showKind(band, kind)
        const buttons = (await hintButtons(band)).slice(0, -2)
        expect(buttons.length).toBeGreaterThan(0)
        for (const b of buttons) {
          const def = builtIn(b.key, options.language)
          expect([b.key, b.drawn]).toEqual([b.key, markedIcon(def)])
          expect([b.key, b.name]).toEqual([b.key, t.hintActionName(markedIcon(def), def.label, t.hintKindTips[kind])])
          // More than the icon: the label and the kind's name are in it.
          expect(b.name).toContain(def.label)
          expect(b.name).toContain(t.hintKindTips[kind])
        }
      }
      await band.unmount()
    })

    test(`[${surface}] [${options.language}] ✕ and ⋯ draw as before and are named by what they do`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)
      const band = await mountBand($, surface)
      const buttons = await hintButtons(band)
      await band.unmount()
      const [close, more] = buttons.slice(-2)
      expect([close?.key, close?.drawn, close?.name]).toEqual(['close', '✕', t.hintCloseName])
      expect([more?.drawn, more?.name]).toEqual(['⋯', t.hintMoreName])
    })
  }
}

// One icon on three actions, one of each kind: drawn [🧪], <🧪> and {🧪}, named apart.
const SAME_ICON = [
  { id: 'probe-sel', icon: '🧪', label: { ja: '試す', en: 'Probe' }, kind: 'complete', model: 'haiku', prompt: 'Probe the selected text.' },
  { id: 'probe-ctx', icon: '🧪', label: { ja: '試す', en: 'Probe' }, kind: 'fork', target: 'context', prompt: 'Probe the conversation.' },
  { id: 'probe-none', icon: '🧪', label: { ja: '試す', en: 'Probe' }, kind: 'complete', model: 'haiku', target: 'none', prompt: 'Probe <input>.' },
]
const SAME_ICON_KINDS: readonly [string, HintKindName, string][] = [
  ['probe-sel', 'selection', '[🧪]'],
  ['probe-ctx', 'context', '<🧪>'],
  ['probe-none', 'standalone', '{🧪}'],
]

for (const [options, t] of LANGS) {
  test(
    `[${options.language}] actions of different kinds with the same icon (and label) get different names, each with its kind`,
    { options: { ...options, customActions: JSON.stringify(SAME_ICON), pinActions: 'probe-sel,probe-ctx,probe-none' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)
      const band = await mountBand($)
      const names: string[] = []
      for (const [id, kind, drawn] of SAME_ICON_KINDS) {
        await showKind(band, kind)
        const button = (await hintButtons(band)).find(b => b.key === id)
        const label = options.language === 'ja' ? '試す' : 'Probe'
        expect([id, button?.drawn]).toEqual([id, drawn])
        expect([id, button?.name]).toEqual([id, t.hintActionName(drawn, label, t.hintKindTips[kind])])
        names.push(String(button?.name))
      }
      await band.unmount()
      // Three names, none alike, each naming its own kind and no other.
      expect(new Set(names).size).toBe(3)
      SAME_ICON_KINDS.forEach(([, kind], i) => {
        for (const other of KINDS) expect([kind, other, names[i]?.includes(t.hintKindTips[other])]).toEqual([kind, other, other === kind])
      })
    },
  )
}

// ---------------------------------------------------------------------------
// The ⋯ dialog's fields

for (const surface of SURFACES) {
  for (const [options, t] of LANGS) {
    test(`[${surface}] [${options.language}] the filter field and the argument field are labelled`, { options }, async ($, on) => {
      mock.clock(on)
      stage(on)
      await start($)
      await runCommand($, '')
      const picker = await $.ui.mount({ ...PICKER_PANE, surface })
      const filter = await picker.find({ key: PICKER_FILTER })
      expect([filter?.type, filter?.props.label]).toEqual(['Input', t.pickerFilterLabel])
      await pickAction(picker, 'timer')
      const arg = await picker.find({ key: PICKER_ARG })
      expect([arg?.type, arg?.props.label]).toEqual(['Input', t.argFieldLabel])
      await picker.unmount()
    })
  }
}

// ---------------------------------------------------------------------------
// The result pane's buttons

/** The result pane's buttons as drawn and as named, by key. */
async function paneButtons($: Engine, surface: (typeof SURFACES)[number] = 'terminal') {
  const pane = await $.ui.mount({ ...PANE, surface })
  const buttons = (await pane.findAll({ type: 'Button' })).map(b => ({ key: String(b.key), drawn: b.text, name: String(b.props.label) }))
  await pane.unmount()
  return buttons
}

async function pressInPane($: Engine, key: string) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key })
  await pane.unmount()
}

const byKey = (buttons: { key: string; drawn: string; name: string }[], key: string) => buttons.find(b => b.key === key)

for (const surface of SURFACES) {
  for (const [options, t] of LANGS) {
    test(`[${surface}] [${options.language}] stop, again and set draw as before and are named with their entry's action`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      stage(on)
      await start($)
      const l = options.language
      const timer = entryOf(builtIn('timer', l))
      const stopwatch = entryOf(builtIn('stopwatch', l))
      await runCommand($, 'timer 5m')
      await runCommand($, 'stopwatch')
      // Running: a stop button each, drawn alike, named apart by their actions.
      let buttons = await paneButtons($, surface)
      const stops = [byKey(buttons, STOP(2)), byKey(buttons, STOP(1))]
      expect(stops.map(b => b?.drawn)).toEqual([t.stop, t.stop])
      expect(stops.map(b => b?.name)).toEqual([t.entryButtonName(t.stop, stopwatch), t.entryButtonName(t.stop, timer)])
      expect(stops[0]?.name).not.toBe(stops[1]?.name)
      expect(stops[1]?.name).toContain(builtIn('timer', l).label)

      await clock.advance(1000)
      await pressInPane($, STOP(1))
      await pressInPane($, STOP(2))
      buttons = await paneButtons($, surface)
      const again = [byKey(buttons, AGAIN(2)), byKey(buttons, AGAIN(1))]
      expect(again.map(b => b?.drawn)).toEqual([t.again, t.again])
      expect(again.map(b => b?.name)).toEqual([t.entryButtonName(t.again, stopwatch), t.entryButtonName(t.again, timer)])
      const set = byKey(buttons, SET_ARG(1))
      expect([set?.drawn, set?.name]).toEqual([t.setArg('duration'), t.entryButtonName(t.setArg('duration'), timer)])
      // The stopwatch takes no argument: no set button.
      expect(byKey(buttons, SET_ARG(2))).toBeUndefined()
    })
  }
}

for (const paneTheme of ['light', 'dark'] as const) {
  test(`[${paneTheme}] with a palette, the buttons still draw their text (in the muted colour) and carry the same names`, { options: { ...EN, paneTheme } }, async ($, on) => {
    const clock = mock.clock(on)
    stage(on)
    await start($)
    const t: Messages = MESSAGES.en
    const timer = entryOf(builtIn('timer', 'en'))
    await runCommand($, 'timer 2s')
    const running = byKey(await paneButtons($), STOP(1))
    expect([running?.drawn, running?.name]).toEqual([t.stop, t.entryButtonName(t.stop, timer)])
    await clock.advance(2000)
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    for (const [key, drawn] of [[AGAIN(1), t.again], [SET_ARG(1), t.setArg('duration')]] as const) {
      const button = await pane.find({ key })
      expect([key, button?.text, button?.props.label]).toEqual([key, drawn, t.entryButtonName(drawn, timer)])
      const inside = (await pane.findAll({ text: drawn })).filter(f => f.type === 'Text')
      expect(inside.map(f => f.props.color)).toEqual([paneStyle(paneTheme, 'dock').muted])
    }
    await pane.unmount()
  })
}

// SELM-00095: an entry whose action is no longer defined (a custom action
// taken out of customActions while it ran, say) has no definition to name its
// buttons by: they are named with the action's ID, as its heading shows it.
// Changing customActions reloads the module, whose runs over time are then
// gone and the entry drawn stopped; a running entry without its definition is
// laid here by renaming its action as the pane reads the results, beneath the
// plugin, while the run itself goes on. Only the read is changed: its version
// is passed on, so the entry's own writes are taken as before.

/** An action ID nothing defines. */
const GONE = 'gone-action'

/** Once `on` is true, the results read with entry `id`'s action renamed to GONE. */
function undefineAction(on: On, id: number) {
  const switched = { on: false }
  on('state.get', async (_$, e, next) => {
    const got = await next(e)
    if (!switched.on || e.key !== 'results' || !Array.isArray(got.value?.value)) return got
    const list = (got.value.value as Result[]).map(r => (r.id === id ? { ...r, action: GONE } : r))
    return { value: { ...got.value, value: list } }
  })
  return switched
}

for (const surface of SURFACES) {
  for (const [options, t] of LANGS) {
    test(`[${surface}] [${options.language}] an entry whose action is no longer defined: its stop button draws as before and is named with the action's ID`, { options }, async ($, on) => {
      mock.clock(on)
      stage(on)
      const gone = undefineAction(on, 1)
      await start($)
      const l = options.language
      await runCommand($, 'timer 5m')
      await runCommand($, 'stopwatch')
      gone.on = true
      const buttons = await paneButtons($, surface)
      const stop = byKey(buttons, STOP(1))
      expect(stop?.drawn).toBe(t.stop)
      expect(stop?.name).toBe(t.entryButtonName(t.stop, GONE))
      expect(stop?.name).toContain(GONE)
      expect(stop?.name).not.toContain('undefined')
      expect(stop?.name.trim()).not.toBe('')
      // The entry still defined is named by its action, apart from the one that is not.
      const known = byKey(buttons, STOP(2))
      expect([known?.drawn, known?.name]).toEqual([t.stop, t.entryButtonName(t.stop, entryOf(builtIn('stopwatch', l)))])
      expect(known?.name).not.toBe(stop?.name)
      // Pressed, it stops the run as before: the button is gone.
      await pressInPane($, STOP(1))
      expect(byKey(await paneButtons($, surface), STOP(1))).toBeUndefined()
    })
  }
}

// Again and set run the entry's action afresh, so they are drawn only for an
// entry whose action is defined: one that is not has no definition to run and
// gets neither, and the stop button is the only one its action's ID names.
for (const [options, t] of LANGS) {
  test(`[${options.language}] an entry whose action is no longer defined gets no again or set button, the one beside it still does`, { options }, async ($, on) => {
    const ENTRIES: Result[] = [
      { id: 4, action: GONE, target: 'none', quote: '', arg: '5m', input: '5m', timed: true, status: 'done', text: 'x' },
      { id: 3, action: 'timer', target: 'none', quote: '', arg: '5m', input: '5m', timed: true, status: 'done', text: 'x' },
    ]
    on('state.get', (_$, e, next) => (e.key === 'results' ? { value: { value: ENTRIES, version: 1 } } : next(e)))
    mock.clock(on)
    stage(on)
    await start($)
    const timer = entryOf(builtIn('timer', options.language))
    const buttons = await paneButtons($)
    expect(byKey(buttons, AGAIN(4))).toBeUndefined()
    expect(byKey(buttons, SET_ARG(4))).toBeUndefined()
    const again = byKey(buttons, AGAIN(3))
    const set = byKey(buttons, SET_ARG(3))
    expect([again?.drawn, again?.name]).toEqual([t.again, t.entryButtonName(t.again, timer)])
    expect([set?.drawn, set?.name]).toEqual([t.setArg('duration'), t.entryButtonName(t.setArg('duration'), timer)])
  })
}
