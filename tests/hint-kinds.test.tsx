import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { buttonWidth } from '../hooks/hint-width'
import { MESSAGES } from '../hooks/i18n'
import { BAND, EN, JA, KIND_KEY, PANE, PICKER_CLOSE, PICKER_PANE, SURFACES, hintIcons, hintKinds, runCommand, showKind, stage, start } from './stage'
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

/** The cells the whole line takes: every button and its gap (the hover labels are cut where the row ends). */
async function lineWidth(band: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) {
  return (await band.findAll({ type: 'Button' })).reduce((sum, b) => sum + buttonWidth(String(b.props.label)), 0)
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
    // Labelled in the kinds' own marks, the one shown drawn bold.
    const labels = (await band.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith(KIND_KEY)).map(b => b.props.label)
    expect(labels).toEqual(['[選択]', '<会話>', '{単独}'])
    const bold = (await band.findAll({ type: 'Text' })).filter(t => t.props.bold === true).map(t => t.text)
    expect(bold).toEqual(['[選択]'])
    const icons = async () => (await hintIcons(band)).slice(0, -2).map(String)
    expect((await icons()).every(l => l.startsWith('['))).toBe(true)

    await showKind(band, 'context')
    expect((await icons()).every(l => l.startsWith('<'))).toBe(true)
    expect((await band.findAll({ type: 'Text' })).filter(t => t.props.bold === true).map(t => t.text)).toEqual(['<会話>'])

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
  const labels = (await band.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith(KIND_KEY)).map(b => b.props.label)
  expect(labels).toEqual(['[selection]', '<context>', '{standalone}'])
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

for (const [options, name] of [[JA, 'ja'], [EN, 'en']] as const) {
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
        const kinds = (await band.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith(KIND_KEY)).map(b => b.props.label)
        expect(kinds).toEqual(['[ ]', '< >', '{ }'])
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
