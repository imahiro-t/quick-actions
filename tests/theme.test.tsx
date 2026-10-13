import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import { ACTIONS } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { HINT_ACCENT, PALETTES, contrastRatio, paneStyle, parsePaneTheme } from '../hooks/palette'
import { BAND, EN, JA, KIND_KEY, PANE, PICKER, PICKER_CLOSE, PICKER_FILTER, PICKER_KIND, PICKER_NEXT, PICKER_PANE, PICKER_PREV, SURFACES, listedActions, pickAction, pickerKindButtons, reselect, showPickerKind, stage, start } from './stage'
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
async function texts(m: { findAll: (q: { text: string | RegExp }) => Promise<{ type: string; text: string; props: Record<string, unknown> }[]> }, text: string | RegExp) {
  return (await m.findAll({ text })).filter(f => f.type === 'Text')
}

/** Each Text's `[dimColor, color]`: `[undefined, undefined]` is drawn in the terminal's foreground. */
function plain(fs: { props: Record<string, unknown> }[]) {
  return fs.map(f => [f.props.dimColor, f.props.color])
}

type Found = { type: string; text: string; props: Record<string, unknown>; children: unknown[] }

/**
 * The result headings on `quote`: each heading line's Text (its colour), the
 * bold Text in it (the action's label) and the quote's own Text. Bold is the
 * label's alone, so no bold Text holds the quote (SELM-00085): a nested Text
 * takes its parent's bold, which would draw the quote as the heading inline.
 */
async function headings(m: { findAll: (q: { text: string | RegExp }) => Promise<Found[]> }, quote: string) {
  const found = (await m.findAll({ text: quote })).filter(f => f.type === 'Text')
  const lines = found.filter(f => f.text !== quote)
  const labels = lines.flatMap(l => l.children.filter((c): c is Found => typeof c === 'object' && c !== null && (c as Found).type === 'Text' && (c as Found).props?.bold === true))
  return {
    lines,
    labels,
    quotes: found.filter(f => f.text === quote),
    bold: found.filter(f => f.props.bold === true),
  }
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
 * docked, and inline whatever the setting): every kind listed, "all" stands
 * out; one listed, it is bold, the others not. Docked under auto (core paints
 * the theme's background) the one listed has no colour of its own and the
 * others are dimColor, as before. Inline nothing paints the background, so
 * none is dimColor (the theme's `inactive` falls to about 2.9:1 there,
 * SELM-00109): the others keep the terminal's foreground, and the one listed
 * is bold and underlined, also with no colour of its own, so that it stands
 * apart by more than bold without HINT_ACCENT, which falls to about 1.8:1
 * where the theme and the terminal disagree.
 */
async function kindsLeftToCore(picker: PickerMount, placement: 'dock' | 'inline') {
  const docked = placement === 'dock'
  const kindAs = (listing: boolean) => [listing, docked && !listing, undefined, listing && !docked]
  const everyKind = [kindAs(true), kindAs(false), kindAs(false), kindAs(false)]
  const before = await pickerKindButtons(picker)
  expect(before.map(k => k.kind)).toEqual(['all', 'selection', 'context', 'standalone'])
  expect(before.map(k => [k.bold, k.dimColor, k.color, k.underline])).toEqual(everyKind)
  expect(before.map(k => k.label)).toEqual([t.hintKindShown(t.allActions), t.hintKindTips.selection, t.hintKindTips.context, t.hintKindTips.standalone])
  await showPickerKind(picker, 'context')
  const after = await pickerKindButtons(picker)
  expect(after.map(k => [k.kind, k.bold, k.dimColor, k.color, k.underline])).toEqual([
    ['all', ...kindAs(false)],
    ['selection', ...kindAs(false)],
    ['context', ...kindAs(true)],
    ['standalone', ...kindAs(false)],
  ])
  expect(after[2]?.label).toBe(t.hintKindShown(t.hintKindTips.context))
  // Pressed again: every kind, "all" standing out.
  await showPickerKind(picker, 'context')
  expect((await pickerKindButtons(picker)).map(k => [k.bold, k.dimColor, k.color, k.underline])).toEqual(everyKind)
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

test('paneStyle: auto docked as it always was; inline the terminal\'s colours, its secondary texts included', () => {
  const auto = { background: undefined, heading: 'text', body: 'text', failed: 'error', muted: undefined, dimMuted: true }
  const inline = { background: undefined, heading: undefined, body: undefined, failed: 'red', muted: undefined, dimMuted: false }
  expect(paneStyle('auto', 'dock')).toEqual(auto)
  for (const theme of ['auto', ...THEMES] as const) expect(paneStyle(theme, 'inline')).toEqual(inline)
  for (const theme of THEMES) expect(paneStyle(theme, 'dock')).toEqual({ ...PALETTES[theme], dimMuted: false })
})

// The buttons colour their label with `muted` whenever a background is
// painted: it is then a real colour, and with none painted there is none to
// pass (dimColor is `dimMuted`, never a value of `muted`).
test('paneStyle: muted is a #rrggbb colour where a background is painted, and undefined where none is', () => {
  for (const theme of ['auto', ...THEMES] as const) {
    for (const placement of ['dock', 'inline'] as const) {
      const style = paneStyle(theme, placement)
      if (style.background !== undefined) {
        expect(/^#[0-9a-f]{6}$/i.test(String(style.muted))).toBe(true)
        expect(style.dimMuted).toBe(false)
      } else expect(style.muted).toBeUndefined()
    }
  }
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
    expect(plain(await texts(empty, t.emptyPane))).toEqual([[true, undefined]])
    await empty.unmount()

    const { settle } = await results($, s, clock, 'terminal')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await outer(pane))?.props.backgroundColor).toBeUndefined()
    expect((await texts(pane, t.thinking)).map(f => f.props.dimColor)).toEqual([true])
    await settle()
    expect((await texts(pane, 'answer from sonnet')).map(f => f.props.color)).toEqual(['text', 'text'])
    expect((await texts(pane, /回答なし/)).map(f => f.props.color)).toEqual(['error'])
    expect((await texts(pane, t.customProblemsHeading)).map(f => f.props.color)).toEqual(['error'])
    const h = await headings(pane, t.quote('Permission denied (publickey)'))
    expect(h.lines.map(f => f.props.color)).toEqual(['text', 'text', 'text'])
    expect(h.labels).toHaveLength(3)
    expect(h.bold).toEqual([])
    expect(h.quotes.map(f => [f.props.dimColor, f.props.color, f.props.bold])).toEqual([[true, undefined, undefined], [true, undefined, undefined], [true, undefined, undefined]])
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
    await kindsLeftToCore(picker, 'dock')
    const close = await picker.find({ key: PICKER_CLOSE })
    expect(close?.props.dimColor).toBe(true)
    await picker.unmount()
  })

  // Inline under auto, the default: nothing paints the background either, so
  // the secondary texts keep the terminal's foreground rather than dimColor
  // (SELM-00085), drawn here rather than only through paneStyle.
  test(`[${name}] inline: the pane's secondary texts (thinking, inline hint, empty pane) in the terminal's foreground`, { options: { ...options, ...MIXED } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const inline = { ...PANE.props, placement: 'inline' } as const

    const empty = await $.ui.mount({ ...PANE, surface: 'terminal', props: inline })
    expect((await outer(empty))?.props.backgroundColor).toBeUndefined()
    expect(plain(await texts(empty, t.emptyPane))).toEqual([[undefined, undefined]])
    expect(plain(await texts(empty, t.inlineHint))).toEqual([[undefined, undefined]])
    await empty.unmount()

    const { settle } = await results($, s, clock, 'terminal')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: inline })
    expect((await outer(pane))?.props.backgroundColor).toBeUndefined()
    expect(plain(await texts(pane, t.thinking))).toEqual([[undefined, undefined]])
    await settle()
    expect(plain(await texts(pane, t.inlineHint))).toEqual([[undefined, undefined]])
    // No text is left to dimColor, the theme's `inactive`.
    expect((await pane.findAll({ type: 'Text' })).filter(f => f.props.dimColor === true)).toEqual([])
    await pane.unmount()
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
      const h = await headings(pane, t.quote('Permission denied (publickey)'))
      expect(h.lines.map(f => f.props.color)).toEqual([p.heading, p.heading, p.heading])
      expect(h.labels).toHaveLength(3)
      expect(h.bold).toEqual([])
      expect(h.quotes.map(f => [f.props.color, f.props.dimColor, f.props.bold])).toEqual([
        [p.muted, undefined, undefined],
        [p.muted, undefined, undefined],
        [p.muted, undefined, undefined],
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

      // The kind buttons: every kind listed as the dialog opens, "all" bold in
      // the heading colour; one listed, it is bold in the heading colour; the
      // others in the muted colour (the palette's dim), never dimColor.
      const everyKind = [
        ['all', true, false, p.heading, false],
        ...['selection', 'context', 'standalone'].map(k => [k, false, true, p.muted, false]),
      ]
      const kinds = await pickerKindButtons(picker, p.muted)
      expect(kinds.map(k => [k.kind, k.bold, k.dim, k.color, k.dimColor])).toEqual(everyKind)
      for (const b of (await picker.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith(PICKER_KIND))) expect(b.props.autoFocus).toBeUndefined()
      await showPickerKind(picker, 'selection')
      expect((await pickerKindButtons(picker, p.muted)).map(k => [k.kind, k.bold, k.dim, k.color, k.dimColor])).toEqual([
        ['all', false, true, p.muted, false],
        ['selection', true, false, p.heading, false],
        ['context', false, true, p.muted, false],
        ['standalone', false, true, p.muted, false],
      ])
      expect(contrastRatio(p.heading, p.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.muted, p.background)).toBeGreaterThanOrEqual(4.5)
      await showPickerKind(picker, 'selection')
      expect((await pickerKindButtons(picker, p.muted)).map(k => [k.kind, k.bold, k.dim, k.color, k.dimColor])).toEqual(everyKind)

      const buttons = (await picker.findAll({ type: 'Button' })).filter(b => ![PICKER_CLOSE, PICKER_PREV, PICKER_NEXT].includes(String(b.key)) && !String(b.key).startsWith(PICKER_KIND))
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

  // Inline, nothing paints the background, so the secondary texts keep the
  // terminal's foreground too: dimColor (the theme's `inactive`) falls to
  // about 2.9:1 where the theme and the terminal disagree (SELM-00085).
  test(`[${theme}] inline: the pane and the ⋯ dialog keep the terminal's colours, their secondary texts included`, { options: { ...JA, ...MIXED, paneTheme: theme } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    const inline = { ...PANE.props, placement: 'inline' } as const

    const empty = await $.ui.mount({ ...PANE, surface: 'terminal', props: inline })
    expect(plain(await texts(empty, t.emptyPane))).toEqual([[undefined, undefined]])
    expect(plain(await texts(empty, t.inlineHint))).toEqual([[undefined, undefined]])
    await empty.unmount()

    const { settle } = await results($, s, clock, 'terminal')
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: inline })
    expect((await outer(pane))?.props.backgroundColor).toBeUndefined()
    expect(plain(await texts(pane, t.thinking))).toEqual([[undefined, undefined]])
    await settle()
    expect(plain(await texts(pane, t.inlineHint))).toEqual([[undefined, undefined]])
    expect((await texts(pane, 'answer from sonnet')).map(f => f.props.color)).toEqual([undefined, undefined])
    expect((await texts(pane, /回答なし/)).map(f => f.props.color)).toEqual(['red'])
    expect((await texts(pane, t.customProblemsHeading)).map(f => f.props.color)).toEqual(['red'])
    // The heading's label bold, the quote beside it not: both in the terminal's foreground.
    const h = await headings(pane, t.quote('Permission denied (publickey)'))
    expect(h.lines.map(f => f.props.color)).toEqual([undefined, undefined, undefined])
    expect(h.labels.map(f => [f.props.bold, f.props.color])).toEqual([[true, undefined], [true, undefined], [true, undefined]])
    expect(h.bold).toEqual([])
    expect(h.quotes.map(f => [f.props.dimColor, f.props.color, f.props.bold])).toEqual([[undefined, undefined, undefined], [undefined, undefined, undefined], [undefined, undefined, undefined]])
    // No text is left to dimColor, the theme's `inactive`.
    expect((await pane.findAll({ type: 'Text' })).filter(f => f.props.dimColor === true)).toEqual([])
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
    await kindsLeftToCore(picker, 'inline')
    // Close, too, in the terminal's foreground rather than dimColor (SELM-00109).
    const close = await picker.find({ key: PICKER_CLOSE })
    expect([close?.text, close?.props.dimColor, close?.props.color]).toEqual([t.pickerClose, undefined, undefined])
    // No button or text of the dialog is left to dimColor, the theme's `inactive`.
    expect((await picker.findAll({ type: 'Button' })).filter(f => f.props.dimColor === true)).toEqual([])
    expect((await picker.findAll({ type: 'Text' })).filter(f => f.props.dimColor === true)).toEqual([])
    // The page shown between the page buttons, and "no match", in the terminal's foreground.
    const page = (await texts(picker, /\d+ \/ \d+/)).filter(f => /^ \d+ \/ \d+/.test(f.text))
    expect(plain(page)).toEqual([[undefined, undefined]])
    await picker.input({ key: PICKER_FILTER, text: 'zzzz', kind: 'change' })
    expect(plain(await texts(picker, t.pickerNoMatch))).toEqual([[undefined, undefined]])
    await picker.unmount()

    // Drawn with no text held: the line saying so, likewise.
    const again = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, placement: 'inline' } })
    await again.press({ key: PICKER_CLOSE })
    expect(plain(await texts(again, t.noSelection))).toEqual([[undefined, undefined]])
    await again.unmount()
  })
}

// ---------------------------------------------------------------------------
// The buttons once drawn dimColor (SELM-00109): the hint line's kinds not
// shown and its ✕, the ⋯ dialog's kinds not listed and its close. Where
// nothing paints the background (the hint line, inline), dimColor (the
// theme's `inactive`) falls to about 2.9:1 where the theme and the terminal
// disagree, so they keep the terminal's foreground there; the kind shown
// still stands apart, bold in HINT_ACCENT on the hint line, bold and
// underlined in the inline ⋯ dialog. Docked under auto they stay dimColor,
// on the theme's own background (see the tests above).

for (const options of [JA, EN, { ...JA, paneTheme: 'auto' }, { ...JA, paneTheme: 'light' }, { ...JA, paneTheme: 'dark' }] as const) {
  const name = `${options.language}${'paneTheme' in options ? ` ${options.paneTheme}` : ''}`
  for (const surface of SURFACES) {
    test(`[${name}] [${surface}] the hint line: the kinds not shown and ✕ in the terminal's foreground, the kind shown bold in the accent`, { options: { ...options, ...MIXED } }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'ECONNREFUSED 127.0.0.1:3306'
      await clock.advance(400)
      const band = await $.ui.mount({ ...BAND, surface })
      for (const shown of ['selection', 'context', 'standalone'] as const) {
        await band.press({ key: `${KIND_KEY}${shown}` })
        const kinds = (await band.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith(KIND_KEY))
        expect(kinds.length).toBeGreaterThan(1)
        for (const b of kinds) {
          const listing = String(b.key) === `${KIND_KEY}${shown}`
          const text = b.children.find(c => typeof c === 'object' && c !== null) as { props?: Record<string, unknown> } | undefined
          expect([b.key, b.props.dimColor, b.props.color]).toEqual([b.key, undefined, undefined])
          if (listing) expect([text?.props?.['bold'], text?.props?.['color']]).toEqual([true, HINT_ACCENT])
          else expect(text).toBeUndefined()
        }
      }
      const close = await band.find({ key: 'close' })
      expect([close?.text, close?.props.dimColor, close?.props.color]).toEqual(['✕', undefined, undefined])
      expect((await band.findAll({ type: 'Button' })).filter(f => f.props.dimColor === true)).toEqual([])
      expect((await band.findAll({ type: 'Text' })).filter(f => f.props.dimColor === true)).toEqual([])
      await band.unmount()
    })
  }
}

// Inline under auto, the default, as the light and dark tests above draw it.
test('[auto] inline: the ⋯ dialog\'s kinds not listed and close in the terminal\'s foreground, the kind listed bold and underlined', { options: { ...JA, ...MIXED } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openPicker($, s, clock, 'terminal')
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, placement: 'inline', isFocused: false } })
  await kindsLeftToCore(picker, 'inline')
  const close = await picker.find({ key: PICKER_CLOSE })
  expect([close?.text, close?.props.dimColor, close?.props.color]).toEqual([t.pickerClose, undefined, undefined])
  expect((await picker.findAll({ type: 'Button' })).filter(f => f.props.dimColor === true)).toEqual([])
  expect((await picker.findAll({ type: 'Text' })).filter(f => f.props.dimColor === true)).toEqual([])
  await picker.unmount()
})
