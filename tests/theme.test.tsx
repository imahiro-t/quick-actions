import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { PALETTES, contrastRatio, paneStyle, parsePaneTheme } from '../hooks/palette'
import { BAND, JA, PANE, PICKER, PICKER_CLOSE, PICKER_PANE, SURFACES, reselect, stage, start } from './stage'
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
    expect(await picker.find({ type: 'Select' })).toBeDefined()
    expect((await texts(picker, t.pickerNoFocus)).map(f => [f.props.dimColor, f.props.color])).toEqual([[true, undefined]])
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
      // Without the keyboard, the line says how, in the muted colour (never on mobile).
      const notice = await texts(picker, t.pickerNoFocus)
      expect(notice.map(f => [f.props.color, f.props.dimColor])).toEqual(surface === 'mobile' ? [] : [[p.muted, undefined]])

      const buttons = (await picker.findAll({ type: 'Button' })).filter(b => b.key !== PICKER_CLOSE)
      expect(buttons).toHaveLength(ACTIONS.length)
      for (const b of buttons) {
        // Its label still names it; its text is drawn in the body colour.
        const label = String(b.props.label)
        const shown = (await picker.findAll({ type: 'Text', text: label })).filter(f => f.text === label)
        expect(shown.map(f => f.props.color)).toEqual([p.body])
        expect(b.props.dimColor).toBeUndefined()
      }
      // The first takes the focus ring as the dialog takes the keys.
      expect(buttons.map(b => b.props.autoFocus)).toEqual([true, ...buttons.slice(1).map(() => undefined)])

      const close = await picker.find({ key: PICKER_CLOSE })
      expect(close?.props.label).toBe(t.pickerClose)
      expect(close?.props.role).toBe('dismiss')
      expect(close?.props.dimColor).toBeUndefined()
      expect((await texts(picker, t.pickerClose)).map(f => f.props.color)).toEqual([p.muted])

      // A press runs that action on the text the dialog opened on, and closes it.
      await picker.press({ key: 'tldr' })
      await picker.unmount()
      expect(s.closed).toEqual([PICKER])
      expect(s.models).toHaveLength(1)
      expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')

      // Drawn again with no text held: the line saying so is muted too.
      const again = await $.ui.mount({ ...PICKER_PANE, surface })
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
    expect(s.closed).toEqual([PICKER])
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
    expect(await picker.find({ type: 'Select' })).toBeDefined()
    expect((await texts(picker, t.pickerNoFocus)).map(f => [f.props.dimColor, f.props.color])).toEqual([[true, undefined]])
    expect((await picker.find({ key: PICKER_CLOSE }))?.props.dimColor).toBe(true)
    await picker.unmount()
  })
}
