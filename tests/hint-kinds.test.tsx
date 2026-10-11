import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { buttonWidth } from '../hooks/hint-width'
import { MESSAGES } from '../hooks/i18n'
import { BAND, EN, JA, PANE, PICKER_CLOSE, PICKER_PANE, PICKER_SELECT, SURFACES, hintIcons, hintKinds, kindButtons, runCommand, showKind, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// The hint line under the prompt (SELM-00050).
//
// The engine keeps answering a selection after its highlight goes, and tells
// the module nothing when it goes: $.ui.selection() is documented to answer
// the last selection "until they select again, dismiss it, or their next
// prompt or command has run", and UiSelection carries its text alone, no
// "shown" flag, with no event for the highlight going. So the line cannot
// follow what the screen shows; instead it shows one kind at a time, switched
// by three buttons at its start ([選択] <会話> {単独}), and opens on the
// selection's actions when there is text to run on.
//
// How many icons follows the line's width: `hintCount` at 80 columns, more in
// proportion on a wider line, never more than fit, the dock of this plugin's
// pane beside the transcript taken off.

const SELECTED = 'ECONNREFUSED 127.0.0.1:3306'

async function select(s: Stage, clock: Clock, text: string | null) {
  s.selected = text
  await clock.advance(400)
}

/** The hint line drawn on a terminal of `columns` (no viewport: unmeasured). */
const mountBand = ($: Engine, columns?: number, isFullscreen = false) =>
  $.ui.mount({ ...BAND, surface: 'terminal', ...(columns === undefined ? {} : { viewport: { columns, rows: 40, isFullscreen } }) })

/**
 * The cells the whole line takes: every button as drawn and its gap (the
 * hover labels are cut where the row ends). A kind button draws its mark, not
 * its label (its accessible name); every other one draws its label.
 */
async function lineWidth(band: Parameters<typeof hintIcons>[0]) {
  const kinds = (await kindButtons(band)).reduce((sum, b) => sum + buttonWidth(b.drawn), 0)
  return kinds + (await hintIcons(band)).reduce<number>((sum, label) => sum + buttonWidth(String(label)), 0)
}

/** How many actions the line shows (its icons, less ✕ and ⋯). */
const actionCount = async (band: Parameters<typeof hintIcons>[0]) => (await hintIcons(band)).length - 2

// ---------------------------------------------------------------------------
// The kinds

for (const surface of SURFACES) {
  test(`[${surface}] a selection opens the line on its actions, and the kind buttons switch it`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)

    const band = await $.ui.mount({ ...BAND, surface })
    expect(await hintKinds(band)).toEqual(['selection', 'context', 'standalone'])
    // Drawn in the kinds' own marks, the one shown bold; named by what each
    // shows, the one shown saying so (SELM-00050-08: bold alone reaches no name).
    const buttons = await kindButtons(band)
    expect(buttons.map(b => b.drawn)).toEqual(['[選択]', '<会話>', '{単独}'])
    expect(buttons.map(b => b.label)).toEqual(['選択範囲へのアクション（表示中）', '会話へのアクション', '単独で使うアクション'])
    const bold = (await band.findAll({ type: 'Text' })).filter(t => t.props.bold === true).map(t => t.text)
    expect(bold).toEqual(['[選択]'])
    const icons = async () => (await hintIcons(band)).slice(0, -2).map(String)
    expect((await icons()).every(l => l.startsWith('['))).toBe(true)

    await showKind(band, 'context')
    expect((await icons()).every(l => l.startsWith('<'))).toBe(true)
    expect((await band.findAll({ type: 'Text' })).filter(t => t.props.bold === true).map(t => t.text)).toEqual(['<会話>'])
    // The name of the one shown moves with it.
    expect((await kindButtons(band)).map(b => b.label)).toEqual(['選択範囲へのアクション', '会話へのアクション（表示中）', '単独で使うアクション'])

    await showKind(band, 'standalone')
    expect((await icons()).every(l => l.startsWith('{'))).toBe(true)
    expect(await icons()).toHaveLength(6)

    await showKind(band, 'selection')
    expect((await icons()).every(l => l.startsWith('['))).toBe(true)
    await band.unmount()
  })
}

test('the kind buttons read what they show on hover, in each language', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const band = await mountBand($)
  for (const tip of Object.values(MESSAGES.en.hintKindTips)) expect(await band.find({ text: new RegExp(tip) })).toBeDefined()
  const buttons = await kindButtons(band)
  expect(buttons.map(b => b.drawn)).toEqual(['[selection]', '<context>', '{standalone}'])
  expect(buttons.map(b => b.label)).toEqual(['Actions on the selection (shown)', 'Actions on the conversation', 'Standalone actions'])
  await band.unmount()
})

test('the switch holds while the line is up; a new selection opens it on the selection\'s again', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)

  let band = await mountBand($)
  await showKind(band, 'standalone')
  await band.unmount()
  // Drawn again (the poll, a redraw): still the standalone ones.
  await clock.advance(400)
  band = await mountBand($)
  expect(String((await hintIcons(band))[0])).toMatch(/^\{/)
  await band.unmount()

  // Another selection: its own actions first again.
  await select(s, clock, 'exit 137')
  band = await mountBand($)
  expect(String((await hintIcons(band))[0])).toMatch(/^\[/)
  await band.unmount()
})

test('with no text to run on, no selection button: the line opens on the conversation\'s', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'hint')
  await select(s, clock, null)

  const band = await mountBand($)
  expect(await hintKinds(band)).toEqual(['context', 'standalone'])
  expect((await hintIcons(band)).slice(0, -2).every(l => String(l).startsWith('<'))).toBe(true)
  await showKind(band, 'standalone')
  expect((await hintIcons(band)).slice(0, -2).every(l => String(l).startsWith('{'))).toBe(true)
  await band.unmount()
})

test('/quick-actions hint over a selection opens it on the selection\'s, though switched before', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  let band = await mountBand($)
  await showKind(band, 'context')
  await band.unmount()

  await runCommand($, 'hint')
  band = await mountBand($)
  expect(String((await hintIcons(band))[0])).toMatch(/^\[/)
  await band.unmount()
})

test('✕ and a run put the switch away with the line', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'hint')
  await select(s, clock, null)

  let band = await mountBand($)
  await showKind(band, 'standalone')
  await band.press({ key: 'close' })
  await band.unmount()
  await runCommand($, 'hint')
  band = await mountBand($)
  expect(String((await hintIcons(band))[0])).toMatch(/^</)
  // A run from the standalone ones closes the line and its kind with it.
  await showKind(band, 'standalone')
  await band.press({ key: 'timer' })
  await band.unmount()
  await runCommand($, 'hint')
  band = await mountBand($)
  expect(String((await hintIcons(band))[0])).toMatch(/^</)
  await band.unmount()
})

// ---------------------------------------------------------------------------
// The width

test('wider, more icons: in proportion to hintCount at 80 columns, more than six on a wide terminal', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)

  const counts: number[] = []
  for (const columns of [80, 120, 160, 200]) {
    const band = await mountBand($, columns)
    counts.push(await actionCount(band))
    expect(await lineWidth(band)).toBeLessThanOrEqual(columns)
    await band.unmount()
  }
  expect(counts[0]).toBe(6)
  for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!)
  expect(counts.at(-1)!).toBeGreaterThan(6)
})

test('a small hintCount keeps its proportion: 3 at 80 columns, 6 at 160', { options: { hintCount: '3' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  for (const [columns, want] of [[80, 3], [160, 6]] as const) {
    const band = await mountBand($, columns)
    expect(await actionCount(band)).toBe(want)
    await band.unmount()
  }
})

for (const [options, name, t] of [[JA, 'ja', MESSAGES.ja], [EN, 'en', MESSAGES.en]] as const) {
  test(`[${name}] narrow, fewer icons and the kind buttons their marks alone: the line never runs past its width`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)
    for (const columns of [60, 50, 40, 30, 20]) {
      const band = await mountBand($, columns)
      expect(await lineWidth(band)).toBeLessThanOrEqual(columns)
      // ✕ and ⋯ stay, so every action is still a press away.
      const icons = await hintIcons(band)
      expect(icons.slice(-2)).toEqual(['✕', '⋯'])
      if (columns < 60 && columns >= 30) {
        // Drawn as their marks alone, yet still named by what each shows
        // (SELM-00050-08): three bare marks would name nothing.
        const kinds = await kindButtons(band)
        expect(kinds.map(b => b.drawn)).toEqual(['[ ]', '< >', '{ }'])
        expect(kinds.map(b => b.label)).toEqual([t.hintKindShown(t.hintKindTips.selection), t.hintKindTips.context, t.hintKindTips.standalone])
      }
      await band.unmount()
    }
    // Too narrow even for the kinds' marks: ✕ and ⋯ alone, and the line still fits.
    const tiny = await mountBand($, 20)
    expect(await hintKinds(tiny)).toEqual([])
    await tiny.unmount()
    // 40 columns still shows some.
    const band = await mountBand($, 40)
    expect(await actionCount(band)).toBeGreaterThan(0)
    await band.unmount()
  })
}

test('docked beside the transcript, the pane\'s width comes off the line; closed, the line has it back', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)

  let band = await mountBand($, 160, true)
  const alone = await actionCount(band)
  // ⋯ opens the tabs: before the pane is drawn, the width every open asks for (56) and its frame come off.
  await band.press({ key: '_more' })
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - 56 - 3)
  expect(await actionCount(band)).toBeLessThan(alone)
  await band.unmount()

  // Drawn docked at the width the person dragged it to: that width comes off.
  const pane = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 90, placement: 'dock' } })
  band = await mountBand($, 160, true)
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - 90 - 3)
  await band.unmount()

  // Drawn inline (a narrower terminal): nothing comes off.
  await pane.redraw({ ...PICKER_PANE.props, placement: 'inline' })
  band = await mountBand($, 160, true)
  expect(await actionCount(band)).toBe(alone)
  await band.unmount()

  // Closed: the whole width again.
  await pane.redraw({ ...PICKER_PANE.props, bodyColumns: 90, placement: 'dock' })
  await pane.press({ key: PICKER_CLOSE })
  await pane.unmount()
  band = await mountBand($, 160, true)
  expect(await actionCount(band)).toBe(alone)
  await band.unmount()
})

test('the result pane drawn docked takes its width off the line too', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  await runCommand($, '')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 100, placement: 'dock' } })
  const band = await mountBand($, 160, true)
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - 100 - 3)
  await band.unmount()
  await pane.unmount()
})

test('not measured (no viewport): hintCount as it always was', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const band = await mountBand($)
  expect(await actionCount(band)).toBe(6)
  await band.unmount()
})

// ---------------------------------------------------------------------------
// The dock, surface by surface (SELM-00050-07), and a tab unloaded unheard
// (SELM-00050-05)

test('each surface\'s hint line takes off its own surface\'s dock alone, and the redraws settle', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  let invalidated = 0
  on('ui.invalidate', (_$, e, next) => {
    invalidated++
    return next(e)
  })
  await start($)
  await select(s, clock, SELECTED)

  let band = await mountBand($, 160, true)
  const alone = await actionCount(band)
  await band.press({ key: '_more' })
  await band.unmount()

  // One pane, two surfaces: docked on the terminal, inline on the desktop.
  const terminal = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' } })
  const desktop = await $.ui.mount({ ...PICKER_PANE, surface: 'desktop', props: { ...PICKER_PANE.props, bodyColumns: 70, placement: 'inline' } })
  band = await mountBand($, 160, true)
  const docked = await actionCount(band)
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - 56 - 3)
  expect(docked).toBeLessThan(alone)
  await band.unmount()

  // The terminal drawn again after the desktop: still its own dock, not the desktop's none.
  await terminal.redraw({ ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' })
  await desktop.redraw({ ...PICKER_PANE.props, bodyColumns: 70, placement: 'inline' })
  band = await mountBand($, 160, true)
  expect(await actionCount(band)).toBe(docked)
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - 56 - 3)
  await band.unmount()

  // The desktop's hint line has its whole width: its pane sits inline.
  const desktopBand = await $.ui.mount({ ...BAND, surface: 'desktop', viewport: { columns: 160, rows: 40, isFullscreen: true } })
  expect(await actionCount(desktopBand)).toBe(alone)
  await desktopBand.unmount()

  // Unchanged widths ask for no redraw, however often either surface draws.
  const before = invalidated
  for (let i = 0; i < 3; i++) {
    await terminal.redraw({ ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' })
    await desktop.redraw({ ...PICKER_PANE.props, bodyColumns: 70, placement: 'inline' })
  }
  expect(invalidated).toBe(before)
  await terminal.unmount()
  await desktop.unmount()
})

test('tabs the engine unloaded unheard take nothing off the line, and a run never holds their old text', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)

  let band = await mountBand($, 160, true)
  const alone = await actionCount(band)
  await band.press({ key: '_more' })
  await band.unmount()
  const pane = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' } })
  await pane.unmount()

  // The engine unloads both tabs (a drawing threw): gone before any hook
  // hears of it, so no close hook runs and the module's state stays.
  s.panes = []
  s.shown = null

  band = await mountBand($, 160, true)
  expect(await actionCount(band)).toBe(alone)
  await band.unmount()

  // A conversation action run on a new selection opens the tabs on that
  // selection, not on the text the unloaded tab held.
  await select(s, clock, 'exit 137')
  band = await mountBand($)
  await showKind(band, 'context')
  const first = (await hintIcons(band))[0]
  const context = (await band.findAll({ type: 'Button' })).find(b => b.props.label === first)
  await band.press({ key: String(context?.key) })
  await band.unmount()

  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await picker.select({ key: PICKER_SELECT, value: 'explain' })
  await picker.unmount()
  expect(s.models.at(-1)?.prompt).toContain('exit 137')
  expect(s.models.at(-1)?.prompt).not.toContain(SELECTED)
})
