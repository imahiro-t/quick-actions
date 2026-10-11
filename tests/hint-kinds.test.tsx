import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { LEAD_RESERVE, buttonWidth, hintLayout, hintLineColumns, hintTarget, leadWidth } from '../hooks/hint-width'
import { MESSAGES } from '../hooks/i18n'
import { BAND, EN, JA, PANE, PICKER_CLOSE, PICKER_PANE, PLUGIN, pickAction, SURFACES, hintIcons, hintKinds, kindButtons, runCommand, showKind, stage, start } from './stage'
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

/**
 * The engine draws the session's mode at the row's left (SessionMode) with
 * `modes`, on `surface`: the hint line there takes its cells off from then on.
 */
async function drawModes($: Engine, modes: readonly string[], surface: 'terminal' | 'desktop' = 'terminal') {
  const mode = await $.ui.mount({ plugin: PLUGIN, component: 'SessionMode', surface, props: { modes } })
  await mode.unmount()
}

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

test('wider, more icons: in proportion to hintCount at 80 columns, more than six on a wide terminal', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  // No mode drawn beside the line: it has the terminal's whole width.
  await drawModes($, [])

  const counts: number[] = []
  for (const columns of [80, 120, 160, 200]) {
    const band = await mountBand($, columns)
    counts.push(await actionCount(band))
    expect(await lineWidth(band)).toBeLessThanOrEqual(columns)
    await band.unmount()
  }
  // Three at 80 columns, not the six counted before SELM-00058: six never fit
  // once each button's frame is counted.
  expect(counts[0]).toBe(3)
  for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!)
  expect(counts.at(-1)!).toBeGreaterThan(6)
})

test('a small hintCount keeps its proportion: 3 at 80 columns, 6 at 160', { options: { ...JA, hintCount: '3' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  await drawModes($, [])
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
    await drawModes($, [])
    const marks = ['[ ]', '< >', '{ }'].reduce((sum, l) => sum + buttonWidth(l), 0)
    for (const columns of [80, 70, 60, 50, 40, 30, 20]) {
      const band = await mountBand($, columns)
      expect(await lineWidth(band)).toBeLessThanOrEqual(columns)
      // ✕ and ⋯ stay, so every action is still a press away.
      const icons = await hintIcons(band)
      expect(icons.slice(-2)).toEqual(['✕', '⋯'])
      const kinds = await kindButtons(band)
      const named = Object.values(t.hintKinds).every(k => kinds.some(b => b.drawn.includes(k)))
      if (!named && kinds.length > 0) {
        // Drawn as their marks alone, yet still named by what each shows
        // (SELM-00050-08): three bare marks would name nothing.
        expect(kinds.map(b => b.drawn)).toEqual(['[ ]', '< >', '{ }'])
        expect(kinds.map(b => b.label)).toEqual([t.hintKindShown(t.hintKindTips.selection), t.hintKindTips.context, t.hintKindTips.standalone])
      }
      // Too narrow even for the kinds' marks beside ✕ and ⋯: none.
      if (columns < marks + buttonWidth('✕') + buttonWidth('⋯')) expect(kinds).toEqual([])
      await band.unmount()
    }
    // 60 columns and narrower: their marks alone, still with an action beside them at 50.
    for (const columns of [60, 50]) {
      const band = await mountBand($, columns)
      expect((await kindButtons(band)).map(b => b.drawn)).toEqual(['[ ]', '< >', '{ }'])
      expect(await actionCount(band)).toBeGreaterThan(0)
      await band.unmount()
    }
    // Too narrow even for the kinds' marks: ✕ and ⋯ alone, and the line still fits.
    const tiny = await mountBand($, 20)
    expect(await hintKinds(tiny)).toEqual([])
    await tiny.unmount()
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
  await pickAction(picker, 'explain')
  await picker.unmount()
  expect(s.models.at(-1)?.prompt).toContain('exit 137')
  expect(s.models.at(-1)?.prompt).not.toContain(SELECTED)
})

// ---------------------------------------------------------------------------
// The buttons drawn whole (SELM-00058): each counted as the terminal draws it,
// `[ label ]`, with the mode the engine draws at the row's left taken off, and
// none of them squeezed onto a second row.

/** The kind buttons' cells, named (`ja`/`en`) or as their marks alone. */
const KIND_CELLS = {
  ja: ['[選択]', '<会話>', '{単独}'].reduce((sum, l) => sum + buttonWidth(l), 0),
  en: ['[selection]', '<context>', '{standalone}'].reduce((sum, l) => sum + buttonWidth(l), 0),
  marks: ['[ ]', '< >', '{ }'].reduce((sum, l) => sum + buttonWidth(l), 0),
}

/** What hintLayout gives for a terminal `columns` wide, with `lead` cells of mode and `dock` of pane, every candidate 10 cells. */
function expected(columns: number, lang: 'ja' | 'en', lead: number, dock = 0, hintCount = 6) {
  const target = hintTarget(hintLineColumns(columns, dock), hintCount)
  return hintLayout({
    line: hintLineColumns(columns, dock, lead),
    target,
    kindsLabeled: KIND_CELLS[lang],
    kindsMarks: KIND_CELLS.marks,
    ends: buttonWidth('✕') + buttonWidth('⋯'),
    widths: Array.from({ length: target }, () => 10),
  })
}

/** How the line draws its kind buttons: named, marks alone, or none. */
async function kindsDrawn(band: Parameters<typeof kindButtons>[0]) {
  const kinds = await kindButtons(band)
  if (kinds.length === 0) return 'none'
  return kinds.every(k => ['[ ]', '< >', '{ }'].includes(k.drawn)) ? 'marks' : 'labeled'
}

for (const [options, lang] of [[JA, 'ja'], [EN, 'en']] as const) {
  test(`[${lang}] the line for each width, with the mode drawn beside it and without: as the plan's table`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)

    // Twelve candidates and more (hintTarget at 160 columns), each a single
    // emoji in its mark (10 cells), so the count is never short of candidates.
    await drawModes($, [])
    expect(hintTarget(160, 6)).toBe(12)
    const wide = await mountBand($, 400)
    const icons = (await hintIcons(wide)).slice(0, -2).map(String)
    expect(icons.length).toBeGreaterThanOrEqual(12)
    for (const icon of icons) expect(buttonWidth(icon)).toBe(10)
    await wide.unmount()

    const table = {
      ja: { 18: [[60, 'marks', 0], [80, 'marks', 2], [100, 'labeled', 3], [160, 'labeled', 9]], 0: [[80, 'labeled', 3], [100, 'labeled', 5], [160, 'labeled', 11]] },
      en: { 18: [[60, 'marks', 0], [80, 'marks', 2], [100, 'labeled', 2], [160, 'labeled', 8]], 0: [[80, 'labeled', 2], [100, 'labeled', 4], [160, 'labeled', 10]] },
    } as const
    for (const [modes, lead] of [[['auto mode on'], 18], [[], 0]] as const) {
      await drawModes($, modes)
      expect(leadWidth(modes)).toBe(lead)
      for (const [columns, kinds, count] of table[lang][lead]) {
        const band = await mountBand($, columns)
        expect({ columns, lead, kinds: await kindsDrawn(band), count: await actionCount(band) }).toEqual({ columns, lead, kinds, count })
        expect(expected(columns, lang, lead)).toEqual({ kinds, count })
        await band.unmount()
      }
    }
  })
}

test('the buttons drawn never take more than the line less the dock and the mode', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  for (const [columns, lead] of [[40, 0], [60, 18], [80, 0], [80, 18], [100, 18], [160, 18]] as const) {
    await drawModes($, lead === 0 ? [] : ['auto mode on'])
    const band = await mountBand($, columns)
    expect(await lineWidth(band)).toBeLessThanOrEqual(columns - lead)
    expect(await actionCount(band)).toBe(expected(columns, 'ja', lead).count)
    await band.unmount()
  }
  // A dock of 40 cells (a pane body of 37 and its frame) and the mode, on 160 columns.
  await drawModes($, ['auto mode on'])
  let band = await mountBand($, 160, true)
  await band.press({ key: '_more' })
  await band.unmount()
  const pane = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 37, placement: 'dock' } })
  band = await mountBand($, 160, true)
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - 40 - 18)
  expect(await actionCount(band)).toBe(expected(160, 'ja', 18, 40).count)
  await band.unmount()
  await pane.unmount()
})

test('60 columns with the mode beside the line: no action, yet ✕ and ⋯, and ⋯ reaches them all', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  await drawModes($, ['auto mode on'])
  const band = await mountBand($, 60)
  expect(await hintIcons(band)).toEqual(['✕', '⋯'])
  expect(await kindsDrawn(band)).toBe('marks')
  await band.press({ key: '_more' })
  await band.unmount()
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'explain')
  await picker.unmount()
  expect(s.models.at(-1)?.prompt).toContain(SELECTED)
})

test('hintCount 1 on 100 columns with no mode: the kinds named and one action', { options: { ...JA, hintCount: '1' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  await drawModes($, [])
  const band = await mountBand($, 100)
  expect(await kindsDrawn(band)).toBe('labeled')
  expect(await actionCount(band)).toBe(1)
  await band.unmount()
})

test('SessionMode is watched, not drawn: it passes on as the engine hands it', async ($, on) => {
  stage(on)
  await start($)
  for (const modes of [['auto mode on'], []]) {
    const mode = await $.ui.mount({ plugin: PLUGIN, component: 'SessionMode', surface: 'terminal', props: { modes } })
    // The engine's own drawing, which no plugin's hook rewrote.
    expect(await mode.drawn()).toEqual({ type: 'Box', props: { key: 'engine' } })
    await mode.unmount()
  }
})

test('the modes drawn beside the line take their cells off it: fewer actions with a mode than with none', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  // 103 columns: the mode's 18 cells and LEAD_RESERVE's 22 leave room for different counts.
  await drawModes($, [])
  let band = await mountBand($, 103)
  const none = await actionCount(band)
  await band.unmount()
  await drawModes($, ['auto mode on'])
  band = await mountBand($, 103)
  const withMode = await actionCount(band)
  await band.unmount()
  expect(withMode).toBeLessThan(none)
  expect(none).toBe(expected(103, 'ja', 0).count)
  expect(withMode).toBe(expected(103, 'ja', 18).count)
})

test('before SessionMode is drawn on a surface, LEAD_RESERVE comes off; one surface\'s modes are not another\'s', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const at = async (surface: 'terminal' | 'desktop') => {
    const band = await $.ui.mount({ ...BAND, surface, viewport: { columns: 103, rows: 40, isFullscreen: false } })
    const count = await actionCount(band)
    await band.unmount()
    return count
  }
  // Nothing drawn yet on either: the reserve.
  expect(expected(103, 'ja', LEAD_RESERVE).count).not.toBe(expected(103, 'ja', 18).count)
  for (const surface of SURFACES) expect(await at(surface)).toBe(expected(103, 'ja', LEAD_RESERVE).count)
  // The terminal's mode: its own 18 cells there; the desktop still the reserve.
  await drawModes($, ['auto mode on'], 'terminal')
  expect(await at('terminal')).toBe(expected(103, 'ja', 18).count)
  expect(await at('desktop')).toBe(expected(103, 'ja', LEAD_RESERVE).count)
  // Drawn with none on the terminal: nothing comes off there.
  await drawModes($, [], 'terminal')
  expect(await at('terminal')).toBe(expected(103, 'ja', 0).count)
})

test('SessionMode props that cannot be read: nothing thrown, its drawing passes on, and LEAD_RESERVE comes off', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  await drawModes($, ['auto mode on'])
  const mode = await $.ui.mount({ plugin: PLUGIN, component: 'SessionMode', surface: 'terminal', props: { modes: 'auto mode on' as unknown as string[] } })
  expect(await mode.drawn()).toEqual({ type: 'Box', props: { key: 'engine' } })
  await mode.unmount()
  const band = await mountBand($, 103)
  expect(await actionCount(band)).toBe(expected(103, 'ja', LEAD_RESERVE).count)
  await band.unmount()
})

for (const surface of SURFACES) {
  test(`[${surface}] each button is kept whole in a row that does not wrap; the hover labels still shrink and are cut`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)
    await drawModes($, ['auto mode on'], surface)
    const band = await $.ui.mount({ ...BAND, surface, viewport: { columns: 80, rows: 40, isFullscreen: false } })
    const boxes = await band.findAll({ type: 'Box' })
    const acts = boxes.filter(b => String(b.key).startsWith('act-'))
    // The kinds, the actions, ✕ and ⋯.
    expect(acts.length).toBe(3 + (await actionCount(band)) + 2)
    for (const box of acts) expect(box.props.flexShrink).toBe(0)
    const row = boxes[0]!
    expect(row.props.flexDirection).toBe('row')
    expect(row.props.flexWrap).toBeUndefined()
    expect(row.props.overflow).toBe('hidden')
    const tips = boxes.filter(b => b.props.display === 'none')
    expect(tips.length).toBe(acts.length)
    for (const tip of tips) expect(tip.props.flexShrink).toBe(1)
    const tipTexts = (await band.findAll({ type: 'Text' })).filter(t => t.props.wrap !== undefined)
    expect(tipTexts.length).toBe(tips.length)
    for (const text of tipTexts) expect(text.props.wrap).toBe('truncate')
    await band.unmount()
  })
}
