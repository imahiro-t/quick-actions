import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { PALETTES, contrastRatio, paneStyle, parsePaneTheme } from '../hooks/palette'
import { BAND, JA, PANE, PICKER, PICKER_CLOSE, PICKER_FILTER, PICKER_KIND, PICKER_PANE, SURFACES, listedActions, pickAction, pickerKindButtons, reselect, showPickerKind, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// The `paneTheme` setting: auto (Claude Code's theme, as before) or a fixed
// light or dark palette for the docked result pane and the ⋯ dialog. The
// inline pane keeps its colours whatever the setting.

const t = MESSAGES.ja
const MORE = '_more'
const THEMES = ['light', 'dark'] as const

// Two custom definitions left out (an unusable tool, an unknown model), one kept.
const MIXED = {
  customActions: JSON.stringify([
    { id: 'shell-look', icon: '👀', label: 'Look', kind: 'subagent', model: 'sonnet', task: 'Look.', prompt: 'Look.', tools: ['Read', 'Bash'] },
    { id: 'mine', icon: '🪄', label: { ja: '海賊風の要約', en: 'Pirate summary' }, kind: 'complete', model: 'haiku', prompt: 'Talk like a pirate.' },
    { id: 'gpt', icon: '🤖', label: 'GPT', kind: 'complete', model: 'gpt-4', prompt: 'Answer.' },
  ]),
}

/** The outermost Box of a drawing: the first Box in document order. */
async function outer(m: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) {
  return (await m.findAll({ type: 'Box' }))[0]
}

/** The Texts (not the Boxes around them) whose shown text matches. */
async function texts(m: { findAll: (q: { text: string | RegExp }) => Promise<{ type: string; props: Record<string, unknown> }[]> }, text: string | RegExp) {
  return (await m.findAll({ text })).filter(f => f.type === 'Text')
}

/** One explain (answered), one explain (no answer) and a third held running, on the selected text. */
async function results($: Engine, s: Stage, clock: Clock, surface: (typeof SURFACES)[number]) {
  s.selected = 'Permission denied (publickey)'
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface })
  await band.press({ key: 'explain' })
  s.answer = 'empty'
  await reselect(s, clock)
  await band.press({ key: 'explain' })
  s.answer = 'text'
  let release = () => {}
  s.hold = new Promise<void>(resolve => (release = resolve))
  await reselect(s, clock)
  const held = band.press({ key: 'explain' })
  return { band, settle: async () => (release(), await held) }
}

// The notice the ⋯ dialog drew without the keyboard, gone since SELM-00068.
const NOTICE = /キーボードで選べます|pick with the keyboard/

/** A mounted ⋯ dialog, as the kind button helpers take it. */
type PickerMount = Parameters<typeof pickerKindButtons>[0]

/**
 * The ⋯ dialog's kind buttons where the style leaves the colours to core (auto
 * docked, and inline whatever the setting): every kind listed, none stands
 * out; one listed, it is bold with no colour of its own, the others dimColor.
 */
async function kindsLeftToCore(picker: PickerMount) {
  const before = await pickerKindButtons(picker)
  expect(before.map(k => k.kind)).toEqual(['selection', 'context', 'standalone'])
  expect(before.map(k => [k.bold, k.dimColor, k.color])).toEqual(before.map(() => [false, false, undefined]))
  expect(before.map(k => k.label)).toEqual([t.hintKindTips.selection, t.hintKindTips.context, t.hintKindTips.standalone])
  await showPickerKind(picker, 'context')
  const after = await pickerKindButtons(picker)
  expect(after.map(k => [k.kind, k.bold, k.dimColor, k.color])).toEqual([
    ['selection', false, true, undefined],
    ['context', true, false, undefined],
    ['standalone', false, true, undefined],
  ])
  expect(after[1]?.label).toBe(t.hintKindShown(t.hintKindTips.context))
  // Pressed again: every kind, none standing out.
  await showPickerKind(picker, 'context')
  expect((await pickerKindButtons(picker)).map(k => [k.bold, k.dimColor])).toEqual([[false, false], [false, false], [false, false]])
}

async function openPicker($: Engine, s: Stage, clock: Clock, surface: 'terminal' | 'desktop' | 'mobile') {
  s.selected = 'ECONNREFUSED 127.0.0.1:3306'
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface })
  await band.press({ key: MORE })
  await band.unmount()
}

// ---------------------------------------------------------------------------
// The setting

test('paneTheme: light and dark in any case, anything else auto', () => {
  expect(parsePaneTheme('light')).toBe('light')
  expect(parsePaneTheme('dark')).toBe('dark')
  expect(parsePaneTheme('Dark')).toBe('dark')
  expect(parsePaneTheme(' LIGHT ')).toBe('light')
  for (const v of [undefined, null, '', '  ', 'auto', 'sepia', 'darker', 42, true, ['dark']]) {
    expect(parsePaneTheme(v)).toBe('auto')
  }
})

test('paneStyle: auto docked and every inline are the colours as they always were', () => {
  const auto = { background: undefined, heading: 'text', body: 'text', failed: 'error', muted: undefined }
  const inline = { background: undefined, heading: undefined, body: undefined, failed: 'red', muted: undefined }
  expect(paneStyle('auto', 'dock')).toEqual(auto)
  for (const theme of ['auto', ...THEMES] as const) expect(paneStyle(theme, 'inline')).toEqual(inline)
  for (const theme of THEMES) expect(paneStyle(theme, 'dock')).toEqual(PALETTES[theme])
})

// ---------------------------------------------------------------------------
// Contrast: every text colour of each palette reads at WCAG AA (4.5:1) on its background

test('contrastRatio follows WCAG 2.x', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  expect(contrastRatio('#ffffff', '#000000')).toBe(21)
  expect(contrastRatio('#777777', '#777777')).toBe(1)
  // #767676 on white is the well-known 4.54:1.
  expect(Math.abs(contrastRatio('#767676', '#FFFFFF') - 4.54) < 0.01).toBe(true)
  expect(() => contrastRatio('red', '#ffffff')).toThrow()
})

for (const theme of THEMES) {
  test(`[${theme}] heading, body, failure and muted texts each reach 4.5:1 on the background`, () => {
    const p = PALETTES[theme]
    for (const role of ['heading', 'body', 'failed', 'muted'] as const) {
      expect(contrastRatio(p[role], p.background)).toBeGreaterThanOrEqual(4.5)
    }
  })
}

// A 256-colour terminal (Terminal.app among them) draws a hex colour as the
// nearest of its palette, picked as chalk (ansi-styles' rgbToAnsi256) picks
// it: a grey to the 24-step grey ramp (or black / white at its ends), any
// other colour to the 6x6x6 cube. This gives that colour back as #rrggbb.
const CUBE = [0, 95, 135, 175, 215, 255] as const
function to256(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
  const rgb = (v: readonly number[]) => `#${v.map(c => c.toString(16).padStart(2, '0')).join('')}`
  if (r === g && g === b) {
    if (r < 8) return '#000000'
    if (r > 248) return '#ffffff'
    const grey = 8 + 10 * Math.round(((r - 8) / 247) * 24)
    return rgb([grey, grey, grey])
  }
  return rgb([r, g, b].map(c => CUBE[Math.round((c / 255) * 5)]!))
}

test('to256 rounds as a 256-colour terminal does', () => {
  expect(to256('#fafafa')).toBe('#ffffff')
  expect(to256('#1e1e1e')).toBe('#1c1c1c')
  expect(to256('#c62828')).toBe('#d75f5f')
  expect(to256('#af0000')).toBe('#af0000')
})

for (const theme of THEMES) {
  test(`[${theme}] every text colour still reaches 4.5:1 rounded to 256 colours`, () => {
    const p = PALETTES[theme]
    for (const role of ['heading', 'body', 'failed', 'muted'] as const) {
      expect(contrastRatio(to256(p[role]), to256(p.background))).toBeGreaterThanOrEqual(4.5)
    }
  })
}

test('the palettes are hex #rrggbb, as the contrast check needs', () => {
  for (const theme of THEMES) {
    for (const v of Object.values(PALETTES[theme])) expect(/^#[0-9a-f]{6}$/i.test(v)).toBe(true)
  }
})

// ---------------------------------------------------------------------------
// auto (unset, `auto`, or not a theme): as before

for (const options of [{ ...JA }, { ...JA, paneTheme: 'auto' }, { ...JA, paneTheme: 'sepia' }] as const) {
  const name = 'paneTheme' in options ? options.paneTheme : 'unset'
  test(`[${name}] the docked pane and the ⋯ dialog draw as they always have`, { options: { ...options, ...MIXED } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)

    const empty = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await outer(empty))?.props.backgroundColor).toBeUndefined()
    expect((await texts(empty, t.emptyPane)).map(f => [f.props.dimColor, f.props.color])).toEqual([[true, undefined]])
    await empty.unmount()

    const { settle } = await results($, s, clock, 'terminal')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await outer(pane))?.props.backgroundColor).toBeUndefined()
    expect((await texts(pane, t.thinking)).map(f => f.props.dimColor)).toEqual([true])
    await settle()
    expect((await texts(pane, 'answer from sonnet')).map(f => f.props.color)).toEqual(['text', 'text'])
    expect((await texts(pane, /回答なし/)).map(f => f.props.color)).toEqual(['error'])
    expect((await texts(pane, t.customProblemsHeading)).map(f => f.props.color)).toEqual(['error'])
    const quotes = await texts(pane, t.quote('Permission denied (publickey)'))
    expect(quotes.filter(f => f.props.bold !== true).map(f => [f.props.dimColor, f.props.color])).toEqual([[true, undefined], [true, undefined], [true, undefined]])
    expect(quotes.filter(f => f.props.bold === true).map(f => f.props.color)).toEqual(['text', 'text', 'text'])
    await pane.unmount()

    await openPicker($, s, clock, 'terminal')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, isFocused: false } })
    expect((await outer(picker))?.props.backgroundColor).toBeUndefined()
    // No Select: the list is buttons, drawn as before with no palette (no child Text, no colour of their own).
    expect(await picker.find({ type: 'Select' })).toBeUndefined()
    const listed = await listedActions(picker)
    expect(listed.length).toBeGreaterThan(0)
    for (const id of listed) {
      const b = await picker.find({ key: id })
      expect(b?.children.filter(c => typeof c === 'object')).toEqual([])
      expect(b?.props.color).toBeUndefined()
      expect(b?.props.dimColor).toBeUndefined()
    }
    // No notice without the keyboard (SELM-00068).
    expect(await texts(picker, NOTICE)).toEqual([])
    await kindsLeftToCore(picker)
    const close = await picker.find({ key: PICKER_CLOSE })
    expect(close?.props.dimColor).toBe(true)
    await picker.unmount()
  })
}

// ---------------------------------------------------------------------------
// light / dark: the palette's background and text colours

for (const theme of THEMES) {
  const p = PALETTES[theme]
  for (const surface of SURFACES) {
    test(`[${theme}] [${surface}] the docked pane: the palette's background, heading, body, failure and muted texts`, { options: { ...JA, ...MIXED, paneTheme: theme } }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)

      const empty = await $.ui.mount({ ...PANE, surface })
      expect((await outer(empty))?.props.backgroundColor).toBe(p.background)
      expect((await texts(empty, t.emptyPane)).map(f => [f.props.color, f.props.dimColor])).toEqual([[p.muted, undefined]])
      await empty.unmount()

      const { settle } = await results($, s, clock, surface)
      const pane = await $.ui.mount({ ...PANE, surface })
      expect((await outer(pane))?.props.backgroundColor).toBe(p.background)
      expect((await texts(pane, t.thinking)).map(f => [f.props.color, f.props.dimColor])).toEqual([[p.muted, undefined]])
      await settle()
      expect(await pane.find({ text: t.thinking })).toBeUndefined()

      expect((await texts(pane, 'answer from sonnet')).map(f => f.props.color)).toEqual([p.body, p.body])
      expect((await texts(pane, /回答なし \(empty-reply\)/)).map(f => f.props.color)).toEqual([p.failed])
      // The custom definitions left out: the heading and each reason.
      expect((await texts(pane, t.customProblemsHeading)).map(f => f.props.color)).toEqual([p.failed])
      expect((await texts(pane, /^- #\d/)).map(f => f.props.color)).toEqual([p.failed, p.failed])
      const quotes = await texts(pane, t.quote('Permission denied (publickey)'))
      expect(quotes.filter(f => f.props.bold === true).map(f => f.props.color)).toEqual([p.heading, p.heading, p.heading])
      expect(quotes.filter(f => f.props.bold !== true).map(f => [f.props.color, f.props.dimColor])).toEqual([
        [p.muted, undefined],
        [p.muted, undefined],
        [p.muted, undefined],
      ])
      // No text is left to dimColor, the theme's `inactive`.
      expect((await pane.findAll({ type: 'Text' })).filter(f => f.props.dimColor === true)).toEqual([])
      await pane.unmount()
    })
  }

  for (const surface of [...SURFACES, 'mobile'] as const) {
    test(`[${theme}] [${surface}] the ⋯ dialog: the palette's background, its actions as buttons in the body colour`, { options: { ...JA, paneTheme: theme } }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      await openPicker($, s, clock, surface)

      const picker = await $.ui.mount({ ...PICKER_PANE, surface, props: { ...PICKER_PANE.props, isFocused: false } })
      expect((await outer(picker))?.props.backgroundColor).toBe(p.background)
      expect(await picker.find({ type: 'Select' })).toBeUndefined()
      // Without the keyboard, no notice (SELM-00068).
      expect(await texts(picker, NOTICE)).toEqual([])

      // The kind buttons: every kind listed as the dialog opens, none standing
      // out, each in the body colour; one listed, it is bold in the heading
      // colour, the others in the muted colour (the palette's dim), never dimColor.
      const kinds = await pickerKindButtons(picker, p.muted)
      expect(kinds.map(k => [k.kind, k.bold, k.dim, k.color, k.dimColor])).toEqual(
        ['selection', 'context', 'standalone'].map(k => [k, false, false, p.body, false]),
      )
      for (const b of (await picker.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith(PICKER_KIND))) expect(b.props.autoFocus).toBeUndefined()
      await showPickerKind(picker, 'selection')
      expect((await pickerKindButtons(picker, p.muted)).map(k => [k.kind, k.bold, k.dim, k.color, k.dimColor])).toEqual([
        ['selection', true, false, p.heading, false],
        ['context', false, true, p.muted, false],
        ['standalone', false, true, p.muted, false],
      ])
      expect(contrastRatio(p.heading, p.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.muted, p.background)).toBeGreaterThanOrEqual(4.5)
      await showPickerKind(picker, 'selection')
      expect((await pickerKindButtons(picker, p.muted)).map(k => [k.bold, k.dim])).toEqual([[false, false], [false, false], [false, false]])

      const buttons = (await picker.findAll({ type: 'Button' })).filter(b => b.key !== PICKER_CLOSE && !String(b.key).startsWith(PICKER_KIND))
      // Every action on mobile, which draws no filter field; elsewhere as many as the pane's height holds.
      expect(buttons.map(b => b.key)).toEqual(await listedActions(picker))
      if (surface === 'mobile') expect(buttons).toHaveLength(ACTIONS.length)
      else expect(buttons.length).toBeLessThan(ACTIONS.length)
      for (const b of buttons) {
        // Its label still names it; its text is drawn in the body colour.
        const label = String(b.props.label)
        const shown = (await picker.findAll({ type: 'Text', text: label })).filter(f => f.text === label)
        expect(shown.map(f => f.props.color)).toEqual([p.body])
        expect(b.props.dimColor).toBeUndefined()
      }
      // The filter field takes the focus ring as the dialog takes the keys;
      // on mobile, which draws no field, the first button does.
      const field = await picker.find({ key: PICKER_FILTER })
      if (surface === 'mobile') {
        expect(field).toBeUndefined()
        expect(buttons.map(b => b.props.autoFocus)).toEqual([true, ...buttons.slice(1).map(() => undefined)])
      } else {
        expect(field?.props.autoFocus).toBe(true)
        expect(buttons.map(b => b.props.autoFocus)).toEqual(buttons.map(() => undefined))
      }

      const close = await picker.find({ key: PICKER_CLOSE })
      expect(close?.props.label).toBe(t.pickerClose)
      expect(close?.props.role).toBe('dismiss')
      expect(close?.props.dimColor).toBeUndefined()
      expect((await texts(picker, t.pickerClose)).map(f => f.props.color)).toEqual([p.muted])

      // A press runs that action on the text the dialog opened on, and closes it.
      await pickAction(picker, 'tldr')
      await picker.unmount()
      // A pick keeps the dialog's tab and shows the results' (SELM-00050).
      expect(s.closed).toEqual([])
      expect(s.shown).toBe(PANE.requestId)
      expect(s.models).toHaveLength(1)
      expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')

      // Closed (the dialog's tab stays after a pick), then drawn with no text
      // held: the line saying so is muted too.
      const again = await $.ui.mount({ ...PICKER_PANE, surface })
      await again.press({ key: PICKER_CLOSE })
      expect((await texts(again, t.noSelection)).map(f => [f.props.color, f.props.dimColor])).toEqual([[p.muted, undefined]])
      await again.unmount()
    })
  }

  test(`[${theme}] the ⋯ dialog's close button closes it, running nothing`, { options: { ...JA, paneTheme: theme } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openPicker($, s, clock, 'terminal')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
    await picker.press({ key: PICKER_CLOSE })
    await picker.unmount()
    // The close button closes the whole pane, both tabs (SELM-00050).
    expect(s.closed).toEqual([PICKER, PANE.requestId])
    expect(s.models).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Inline: whatever the setting, as before

  test(`[${theme}] inline: the pane and the ⋯ dialog keep their colours`, { options: { ...JA, ...MIXED, paneTheme: theme } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const inline = { ...PANE.props, placement: 'inline' } as const

    const { settle } = await results($, s, clock, 'terminal')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: inline })
    expect((await outer(pane))?.props.backgroundColor).toBeUndefined()
    expect((await texts(pane, t.thinking)).map(f => [f.props.dimColor, f.props.color])).toEqual([[true, undefined]])
    await settle()
    expect((await texts(pane, t.inlineHint)).map(f => f.props.dimColor)).toEqual([true])
    expect((await texts(pane, 'answer from sonnet')).map(f => f.props.color)).toEqual([undefined, undefined])
    expect((await texts(pane, /回答なし/)).map(f => f.props.color)).toEqual(['red'])
    expect((await texts(pane, t.customProblemsHeading)).map(f => f.props.color)).toEqual(['red'])
    const quotes = await texts(pane, t.quote('Permission denied (publickey)'))
    expect(quotes.filter(f => f.props.bold === true).map(f => f.props.color)).toEqual([undefined, undefined, undefined])
    expect(quotes.filter(f => f.props.bold !== true).map(f => [f.props.dimColor, f.props.color])).toEqual([[true, undefined], [true, undefined], [true, undefined]])
    await pane.unmount()

    await openPicker($, s, clock, 'terminal')
    const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, placement: 'inline', isFocused: false } })
    expect((await outer(picker))?.props.backgroundColor).toBeUndefined()
    // No Select: the list is buttons, drawn as before with no palette (no child Text, no colour of their own).
    expect(await picker.find({ type: 'Select' })).toBeUndefined()
    const listed = await listedActions(picker)
    expect(listed.length).toBeGreaterThan(0)
    for (const id of listed) {
      const b = await picker.find({ key: id })
      expect(b?.children.filter(c => typeof c === 'object')).toEqual([])
      expect(b?.props.color).toBeUndefined()
      expect(b?.props.dimColor).toBeUndefined()
    }
    expect(await texts(picker, NOTICE)).toEqual([])
    await kindsLeftToCore(picker)
    expect((await picker.find({ key: PICKER_CLOSE }))?.props.dimColor).toBe(true)
    await picker.unmount()
  })
}
