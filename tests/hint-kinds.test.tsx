import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import { LEAD_RESERVE, TIP_RESERVE, buttonWidth, dockReturn, hintLayout, hintLineColumns, hintMost, leadFor } from '../hooks/hint-width'
import { CHAIN_ICON } from '../hooks/compose'
import { MESSAGES } from '../hooks/i18n'
import { BAND, EN, JA, PANE, PICKER_CLOSE, PICKER_PANE, PLUGIN, pickAction, SURFACES, hintIcons, hintKinds, kindButtons, runCommand, showKind, stage, start } from './stage'
import type { Clock, Stage } from './stage'

/**
 * `drawn` is the engine's own drawing, as no plugin's hook rewrote it: its
 * type and props exactly the engine's, and, where the kit says who drew it
 * (`part`), not this plugin.
 */
function expectEngineDrawn(drawn: unknown) {
  const { part, ...rest } = drawn as { part?: { plugin?: string } }
  expect(rest).toEqual({ type: 'Box', props: { key: 'engine' } })
  expect(part?.plugin).not.toBe(PLUGIN)
}

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
// How many icons follows the line's width: as many as fit. The width is the
// viewport's columns as the engine hands them (on the terminal the
// transcript's column, a docked pane's already off: SELM-00066), with the
// dock given back, the line running under it: this plugin's (SELM-00068) or
// another plugin's (SELM-00067).

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
const actionCount = async (band: Parameters<typeof hintIcons>[0]) => (await hintIcons(band)).length - 3

/** The cells the line has on a viewport `columns` wide: the permission mode at the row's left (LEAD_RESERVE) taken off. */
const room = (columns: number) => hintLineColumns(columns, leadFor('terminal'))

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
    const icons = async () => (await hintIcons(band)).slice(0, -3).map(String)
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

// The kind shown is bold and underlined in the terminal's foreground, and the
// hover labels in the foreground alone (SELM-00112): nothing paints the line's
// background, so a theme colour (`suggestion`) falls to about 1.8:1 where the
// theme and the terminal disagree, and raw `cyan` to 1.9-3.4:1 on a light
// background (SELM-00085). The buttons' names stay as they were.
for (const surface of SURFACES) {
  test(`[${surface}] the kind shown bold and underlined, the hover labels, both in the foreground, no raw cyan`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)
    const band = await $.ui.mount({ ...BAND, surface })
    const all = async () => band.findAll({ type: 'Text' })
    const shown = async () => (await all()).filter(t => t.props.bold === true).map(t => [t.text, t.props.underline, t.props.color])
    expect(await shown()).toEqual([['[選択]', true, undefined]])
    const tips = (await all()).filter(t => t.props.wrap === 'truncate')
    expect(tips.length).toBeGreaterThan(0)
    for (const tip of tips) expect([tip.props.color, tip.props.bold, tip.props.underline]).toEqual([undefined, undefined, undefined])
    expect((await all()).filter(t => t.props.color === 'cyan')).toEqual([])
    await showKind(band, 'standalone')
    expect(await shown()).toEqual([['{単独}', true, undefined]])
    expect((await all()).filter(t => t.props.color === 'cyan')).toEqual([])
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
  expect((await hintIcons(band)).slice(0, -3).every(l => String(l).startsWith('<'))).toBe(true)
  await showKind(band, 'standalone')
  expect((await hintIcons(band)).slice(0, -3).every(l => String(l).startsWith('{'))).toBe(true)
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

test('wider, more icons: as many as fit, more than six on a wide terminal', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)

  const counts: number[] = []
  for (const columns of [80, 120, 160, 200]) {
    const band = await mountBand($, columns)
    counts.push(await actionCount(band))
    expect(await lineWidth(band)).toBeLessThanOrEqual(room(columns))
    await band.unmount()
  }
  // One at 80 columns beside the permission mode, not the six counted before
  // SELM-00058: six never fit once each button's frame is counted (two before
  // SELM-00128 put ⛓ beside ✕ and ⋯).
  expect(counts[0]).toBe(1)
  for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!)
  expect(counts[2]!).toBeGreaterThan(counts[0]!)
  expect(counts.at(-1)!).toBeGreaterThan(6)
})

for (const [options, name, t] of [[JA, 'ja', MESSAGES.ja], [EN, 'en', MESSAGES.en]] as const) {
  test(`[${name}] narrow, fewer icons and the kind buttons their marks alone: the line never runs past its width`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)
    const marks = ['[ ]', '< >', '{ }'].reduce((sum, l) => sum + buttonWidth(l), 0)
    for (const columns of [80, 70, 60, 50, 40, 30, 20]) {
      const band = await mountBand($, columns)
      // ✕ and ⋯ are drawn however narrow; whatever more is laid out fits beside them.
      if (room(columns) >= buttonWidth('✕') + buttonWidth('⋯') + buttonWidth(CHAIN_ICON)) expect(await lineWidth(band)).toBeLessThanOrEqual(room(columns))
      // ✕ and ⋯ stay, so every action is still a press away.
      const icons = await hintIcons(band)
      expect(icons.slice(-3)).toEqual(['✕', '⋯', '⛓️'])
      const kinds = await kindButtons(band)
      const named = Object.values(t.hintKinds).every(k => kinds.some(b => b.drawn.includes(k)))
      if (!named && kinds.length > 0) {
        // Drawn as their marks alone, yet still named by what each shows
        // (SELM-00050-08): three bare marks would name nothing.
        expect(kinds.map(b => b.drawn)).toEqual(['[ ]', '< >', '{ }'])
        expect(kinds.map(b => b.label)).toEqual([t.hintKindShown(t.hintKindTips.selection), t.hintKindTips.context, t.hintKindTips.standalone])
      }
      // Too narrow even for the kinds' marks beside ✕ and ⋯: none.
      if (room(columns) < marks + buttonWidth('✕') + buttonWidth('⋯') + buttonWidth(CHAIN_ICON)) expect(kinds).toEqual([])
      await band.unmount()
    }
    // 90 and 80 columns: their marks alone, still with an action beside them
    // (80 and 70 before SELM-00128 put ⛓ beside ✕ and ⋯).
    for (const columns of [90, 80]) {
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

// SELM-00066: with a pane docked, the engine hands PromptHint the transcript's
// column, the dock already off (seen in a pseudo-terminal: 160, 180 and 200
// columns with this plugin's pane docked at its body of 56 give 103, 123 and
// 143). SELM-00068: the line itself runs under the dock across the whole
// terminal, so this plugin's dock, as measured where the pane is drawn (its
// body and the rule beside it, dockReturn), is given back: the pane opening or
// closing leaves the line's count as it was.
const DOCKED_VIEWPORTS = [[160, 103], [180, 123], [200, 143]] as const

for (const [terminal, viewport] of DOCKED_VIEWPORTS) {
  test(`docked on ${terminal} columns (a viewport of ${viewport}): the line keeps its count, never more than the terminal holds; closed, as before`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)

    // No dock: the whole terminal, as it always was.
    let band = await mountBand($, terminal, true)
    const alone = await actionCount(band)
    expect(alone).toBe(expected(terminal, 'ja').count)
    // ⋯ opens the tabs, and the pane is drawn docked.
    await band.press({ key: '_more' })
    await band.unmount()
    // The dock seen in the pseudo-terminal is what the pane measures.
    expect(viewport + dockReturn(56)).toBe(terminal)
    const pane = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' } })

    // The line drawn on what the engine hands over beside the dock: the dock given back.
    band = await mountBand($, viewport, true)
    expect(await actionCount(band)).toBe(alone)
    expect(await lineWidth(band)).toBeLessThanOrEqual(terminal - LEAD_RESERVE)
    await band.unmount()

    // Closed: the whole terminal again, the count as before the dock.
    await pane.press({ key: PICKER_CLOSE })
    await pane.unmount()
    band = await mountBand($, terminal, true)
    expect(await actionCount(band)).toBe(alone)
    await band.unmount()
  })
}

test('before the pane is drawn docked, nothing is given back: the viewport alone, never more than it holds', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  let band = await mountBand($, 160, true)
  const alone = await actionCount(band)
  await band.press({ key: '_more' })
  await band.unmount()
  // The tabs are open (by the engine's record), the pane not drawn yet: no dock assumed.
  expect(s.panes.length).toBeGreaterThan(0)
  band = await mountBand($, 103, true)
  expect(await actionCount(band)).toBe(expected(103, 'ja').count)
  expect(await actionCount(band)).toBeLessThan(alone)
  expect(await lineWidth(band)).toBeLessThanOrEqual(103 - LEAD_RESERVE)
  await band.unmount()
  // Drawn: given back at once.
  const pane = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' } })
  band = await mountBand($, 103, true)
  expect(await actionCount(band)).toBe(alone)
  await band.unmount()
  await pane.unmount()
})

test('this plugin\'s pane drawn docked gives its own width back, drawn inline nothing, whichever tab', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  let band = await mountBand($, 123, true)
  const at123 = await actionCount(band)
  expect(at123).toBeGreaterThanOrEqual(1)
  await band.press({ key: '_more' })
  await band.unmount()
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 90, placement: 'dock' } })
  for (const [props, line] of [
    [{ bodyColumns: 90, placement: 'dock' }, 123 + 91],
    [{ bodyColumns: 56, placement: 'dock' }, 123 + 57],
    [{ bodyColumns: 120, placement: 'inline' }, 123],
  ] as const) {
    await picker.redraw({ ...PICKER_PANE.props, ...props })
    band = await mountBand($, 123, true)
    expect([props, await actionCount(band)]).toEqual([props, expected(line, 'en').count])
    expect(await lineWidth(band)).toBeLessThanOrEqual(line - LEAD_RESERVE)
    await band.unmount()
  }
  await picker.unmount()
  // The result pane, too.
  await runCommand($, '')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 100, placement: 'dock' } })
  band = await mountBand($, 123, true)
  expect(await actionCount(band)).toBe(expected(123 + 101, 'en').count)
  expect(await lineWidth(band)).toBeLessThanOrEqual(123 + 101 - LEAD_RESERVE)
  await band.unmount()
  await pane.unmount()
})

test('not measured (no viewport): UNMEASURED_COUNT', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const band = await mountBand($)
  expect(await actionCount(band)).toBe(6)
  await band.unmount()
})

// ---------------------------------------------------------------------------
// Another plugin's docked pane (SELM-00067)

// A pane of another plugin: a `ui.render` matcher naming no requestId is
// handed its drawing too (seen in a pseudo-terminal: a test plugin's pane
// docked at a body of 40 on 180 columns drawn with a viewport of 139, 150
// columns with 109, a body of 30 beside this plugin's on 160 columns with 129).
const OTHER_PANE = { ...PANE, requestId: 'other-plugin-pane', props: { ...PANE.props, title: 'Other', isFocused: false } } as const

/** Another plugin's pane drawn on `surface` beside a viewport `viewport` wide, docked at a body `body` wide. */
const mountOther = ($: Engine, viewport: number | undefined, body: number, surface: 'terminal' | 'desktop' = 'terminal', placement: 'dock' | 'inline' = 'dock') =>
  $.ui.mount({
    ...OTHER_PANE,
    surface,
    props: { ...OTHER_PANE.props, bodyColumns: body, placement },
    ...(viewport === undefined ? {} : { viewport: { columns: viewport, rows: 40, isFullscreen: true } }),
  })

for (const [terminal, body] of [[180, 40], [150, 40], [160, 30], [200, 56]] as const) {
  const viewport = terminal - dockReturn(body)
  test(`another plugin's pane docked at ${body} on ${terminal} columns (a viewport of ${viewport}): the line keeps its count, never more than the terminal holds; closed, as before`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)

    let band = await mountBand($, terminal, true)
    const alone = await actionCount(band)
    expect(alone).toBe(expected(terminal, 'ja').count)
    await band.unmount()

    // Its pane drawn docked: the transcript's column handed over, its dock given back.
    const other = await mountOther($, viewport, body)
    band = await mountBand($, viewport, true)
    expect(await actionCount(band)).toBe(alone)
    expect(await lineWidth(band)).toBeLessThanOrEqual(terminal - LEAD_RESERVE)
    await band.unmount()

    // Closed, unheard: the line is handed the whole terminal again, and drops the measure.
    await other.unmount()
    band = await mountBand($, terminal, true)
    expect(await actionCount(band)).toBe(alone)
    await band.unmount()
    // The terminal then resized to the very columns the transcript had beside
    // the dock: nothing given back, the line those columns alone.
    band = await mountBand($, viewport, true)
    expect(await actionCount(band)).toBe(expected(viewport, 'ja').count)
    expect(await lineWidth(band)).toBeLessThanOrEqual(viewport - LEAD_RESERVE)
    await band.unmount()
  })
}

test('another plugin\'s dock measured beside other columns is never given back: a line handed different columns drops it, drawn by the plugin or not', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const other = await mountOther($, 139, 40)
  await other.unmount()
  // Resized while the line is the engine's own (a draft in the prompt): the
  // measure is dropped all the same.
  const draft = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isDraft: true }, viewport: { columns: 150, rows: 40, isFullscreen: true } })
  await draft.unmount()
  let band = await mountBand($, 139, true)
  expect(await actionCount(band)).toBe(expected(139, 'en').count)
  await band.unmount()

  // With no selection nor line opened (the engine's line drawn), the same.
  const again = await mountOther($, 139, 40)
  await again.unmount()
  s.selected = null
  await clock.advance(400)
  const plain = await mountBand($, 150, true)
  expect(await hintIcons(plain)).toEqual([])
  await plain.unmount()
  await select(s, clock, SELECTED)
  band = await mountBand($, 139, true)
  expect(await actionCount(band)).toBe(expected(139, 'en').count)
  await band.unmount()

  // A pane drawn where nothing was measured (no viewport) gives nothing back.
  const unmeasured = await mountOther($, undefined, 40)
  band = await mountBand($, 139, true)
  expect(await actionCount(band)).toBe(expected(139, 'en').count)
  await band.unmount()
  await unmeasured.unmount()
})

test('this plugin\'s and another plugin\'s panes as tabs of one dock: the last drawn holds, and a line drawn out of step comes out narrower, never wider', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  let band = await mountBand($, 160, true)
  const alone = await actionCount(band)
  await band.press({ key: '_more' })
  await band.unmount()

  // This plugin's pane docked at 56 on 160 columns: a viewport of 103.
  const pane = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' }, viewport: { columns: 103, rows: 40, isFullscreen: true } })
  band = await mountBand($, 103, true)
  expect(await actionCount(band)).toBe(alone)
  await band.unmount()

  // Another plugin's opens beside it at 30: the dock narrows to its tab, a viewport of 129.
  const other = await mountOther($, 129, 30)
  band = await mountBand($, 129, true)
  expect(await actionCount(band)).toBe(alone)
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - LEAD_RESERVE)
  await band.unmount()

  // A line still handed the old 103: this plugin's 57 is no longer the dock,
  // and the other's 31 was measured beside 129, so nothing is given back.
  band = await mountBand($, 103, true)
  expect(await actionCount(band)).toBe(expected(103, 'ja').count)
  expect(await lineWidth(band)).toBeLessThanOrEqual(103 - LEAD_RESERVE)
  await band.unmount()

  // This plugin's tab shown again, drawn beside 103: its own dock again.
  await other.unmount()
  await pane.redraw({ ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' })
  band = await mountBand($, 103, true)
  expect(await actionCount(band)).toBe(alone)
  await band.unmount()
  await pane.unmount()
})

test('closing this plugin\'s pane leaves another plugin\'s dock measured', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  let band = await mountBand($, 180, true)
  const alone = await actionCount(band)
  await band.press({ key: '_more' })
  await band.unmount()
  const pane = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' } })
  // Another plugin's tab drawn last, beside 139.
  const other = await mountOther($, 139, 40)
  await pane.press({ key: PICKER_CLOSE })
  await pane.unmount()
  band = await mountBand($, 139, true)
  expect(await actionCount(band)).toBe(alone)
  expect(await lineWidth(band)).toBeLessThanOrEqual(180 - LEAD_RESERVE)
  await band.unmount()
  await other.unmount()
})

test('another plugin\'s pane changes nothing on the desktop, and drawn inline gives nothing back', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const desktop = await mountOther($, 100, 40, 'desktop')
  const desktopBand = await $.ui.mount({ ...BAND, surface: 'desktop', viewport: { columns: 100, rows: 40, isFullscreen: true } })
  expect(await actionCount(desktopBand)).toBe(expected(100, 'ja').count)
  await desktopBand.unmount()
  await desktop.unmount()

  const inline = await mountOther($, 139, 40, 'terminal', 'inline')
  const band = await mountBand($, 139, true)
  expect(await actionCount(band)).toBe(expected(139, 'ja').count)
  await band.unmount()
  await inline.unmount()
})

test('another plugin\'s pane asks for a redraw only as its dock changes, and the redraws settle', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  let invalidated = 0
  on('ui.invalidate', (_$, e, next) => {
    invalidated++
    return next(e)
  })
  await start($)
  await select(s, clock, SELECTED)
  const before = invalidated
  const other = await mountOther($, 139, 40)
  expect(invalidated - before).toBe(1)
  for (let i = 0; i < 3; i++) await other.redraw({ ...OTHER_PANE.props, bodyColumns: 40, placement: 'dock' })
  expect(invalidated - before).toBe(1)
  // Its own drawing is left as the engine draws it, not drawn by this plugin.
  expectEngineDrawn(await other.drawn())
  await other.redraw({ ...OTHER_PANE.props, bodyColumns: 30, placement: 'dock' })
  expect(invalidated - before).toBe(2)
  await other.unmount()
})

// ---------------------------------------------------------------------------
// Surface by surface (SELM-00050-07), and a tab unloaded unheard
// (SELM-00050-05)

// SELM-00050-07: each surface gives back its own dock alone, measured where
// the pane was drawn on it, and the redraws that measuring asks for settle.
test('each surface\'s hint line gives back its own surface\'s dock alone, and the redraws the measuring asks for settle', { options: JA }, async ($, on) => {
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
  const whole = await actionCount(band)
  await band.press({ key: '_more' })
  await band.unmount()

  // One pane, two surfaces: docked on the terminal, inline on the desktop.
  const before = invalidated
  const terminal = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' } })
  const desktop = await $.ui.mount({ ...PICKER_PANE, surface: 'desktop', props: { ...PICKER_PANE.props, bodyColumns: 70, placement: 'inline' } })
  // Each surface's first measure asks once for a redraw.
  const measured = invalidated
  expect(measured - before).toBe(2)

  // The terminal's line beside its dock: the viewport it is handed (103), its dock given back.
  band = await mountBand($, 103, true)
  expect(await actionCount(band)).toBe(whole)
  await band.unmount()

  // The desktop's line has its own viewport's whole width, the terminal's dock nothing to it.
  const desktopBand = await $.ui.mount({ ...BAND, surface: 'desktop', viewport: { columns: 160, rows: 40, isFullscreen: true } })
  expect(await actionCount(desktopBand)).toBe(whole)
  expect(await lineWidth(desktopBand)).toBeLessThanOrEqual(160 - LEAD_RESERVE)
  await desktopBand.unmount()

  // Drawn again in either order: each line still its own, and nothing more asked (bounded).
  for (let i = 0; i < 3; i++) {
    await terminal.redraw({ ...PICKER_PANE.props, bodyColumns: 56, placement: 'dock' })
    await desktop.redraw({ ...PICKER_PANE.props, bodyColumns: 70, placement: 'inline' })
  }
  expect(invalidated).toBe(measured)
  band = await mountBand($, 103, true)
  expect(await actionCount(band)).toBe(whole)
  await band.unmount()
  const again = await $.ui.mount({ ...BAND, surface: 'desktop', viewport: { columns: 160, rows: 40, isFullscreen: true } })
  expect(await actionCount(again)).toBe(whole)
  await again.unmount()
  await terminal.unmount()
  await desktop.unmount()
})

test('tabs the engine unloaded unheard leave the line as it was, and a run never holds their old text', async ($, on) => {
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

  // The dock it measured is given back to nothing: the line as it was, never wider than the terminal.
  band = await mountBand($, 160, true)
  expect(await actionCount(band)).toBe(alone)
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - LEAD_RESERVE)
  await band.unmount()

  // A conversation action run on a new selection opens the tabs on that
  // selection, not on the text the unloaded tab held.
  await select(s, clock, 'exit 137')
  band = await mountBand($)
  await showKind(band, 'context')
  const first = (await hintIcons(band))[0]
  const context = (await band.findAll({ type: 'Button' })).find(b => b.text === first)
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
// `[ label ]` flush against the next, with the rest of the row (the permission
// mode the engine draws at its left, LEAD_RESERVE) taken off, and none of them
// squeezed onto a second row.

/** The kind buttons' cells, named (`ja`/`en`) or as their marks alone. */
const KIND_CELLS = {
  ja: ['[選択]', '<会話>', '{単独}'].reduce((sum, l) => sum + buttonWidth(l), 0),
  en: ['[selection]', '<context>', '{standalone}'].reduce((sum, l) => sum + buttonWidth(l), 0),
  marks: ['[ ]', '< >', '{ }'].reduce((sum, l) => sum + buttonWidth(l), 0),
}

/** What hintLayout gives for a viewport `columns` wide, with `lead` cells beside the buttons, every candidate 9 cells, room kept for the hover label. */
function expected(columns: number, lang: 'ja' | 'en', lead = LEAD_RESERVE) {
  const line = hintLineColumns(columns, lead)
  return hintLayout({
    line,
    kindsLabeled: KIND_CELLS[lang],
    kindsMarks: KIND_CELLS.marks,
    ends: buttonWidth('✕') + buttonWidth('⋯') + buttonWidth(CHAIN_ICON),
    widths: Array.from({ length: hintMost(line) }, () => 9),
    tip: TIP_RESERVE,
  })
}

/** How the line draws its kind buttons: named, marks alone, or none. */
async function kindsDrawn(band: Parameters<typeof kindButtons>[0]) {
  const kinds = await kindButtons(band)
  if (kinds.length === 0) return 'none'
  return kinds.every(k => ['[ ]', '< >', '{ }'].includes(k.drawn)) ? 'marks' : 'labeled'
}

for (const [options, lang] of [[JA, 'ja'], [EN, 'en']] as const) {
  test(`[${lang}] the line for each width, the permission mode's room taken off: as the table`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)

    // Thirteen candidates and more (as many as fit at 160 columns with nothing
    // off the row), each a single emoji in its mark (9 cells), so the count is
    // never short of candidates.
    const wide = await mountBand($, 400)
    const icons = (await hintIcons(wide)).slice(0, -3).map(String)
    expect(icons.length).toBeGreaterThanOrEqual(13)
    for (const icon of icons.slice(0, 13)) expect(buttonWidth(icon)).toBe(9)
    await wide.unmount()

    const table = {
      // ⛓ (SELM-00128) beside ✕ and ⋯ takes a few cells more off the actions.
      ja: [[60, 'none', 1], [80, 'marks', 1], [100, 'labeled', 2], [160, 'labeled', 7]],
      en: [[60, 'none', 1], [80, 'marks', 1], [100, 'marks', 2], [160, 'labeled', 6]],
    } as const
    for (const [columns, kinds, count] of table[lang]) {
      const band = await mountBand($, columns)
      expect({ columns, kinds: await kindsDrawn(band), count: await actionCount(band) }).toEqual({ columns, kinds, count })
      expect(expected(columns, lang)).toMatchObject({ kinds, count })
      await band.unmount()
    }
  })
}

test('the buttons drawn never take more than the line less the rest of the row, a pane docked or not', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  for (const columns of [50, 60, 80, 100, 160]) {
    const band = await mountBand($, columns)
    expect(await lineWidth(band)).toBeLessThanOrEqual(columns - LEAD_RESERVE)
    expect(await actionCount(band)).toBe(expected(columns, 'ja').count)
    await band.unmount()
  }
  // A pane docked at a body of 37 on 160 columns: the engine hands over 122, and the dock (38) is given back.
  let band = await mountBand($, 160, true)
  await band.press({ key: '_more' })
  await band.unmount()
  const pane = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal', props: { ...PICKER_PANE.props, bodyColumns: 37, placement: 'dock' } })
  band = await mountBand($, 160 - dockReturn(37), true)
  expect(await lineWidth(band)).toBeLessThanOrEqual(160 - LEAD_RESERVE)
  expect(await actionCount(band)).toBe(expected(160, 'ja').count)
  await band.unmount()
  await pane.unmount()
})

test('45 columns: no action and no kind button, yet ✕ and ⋯, and ⋯ reaches them all', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const band = await mountBand($, 45)
  expect(await hintIcons(band)).toEqual(['✕', '⋯', '⛓️'])
  expect(await kindsDrawn(band)).toBe('none')
  await band.press({ key: '_more' })
  await band.unmount()
  const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  await pickAction(picker, 'explain')
  await picker.unmount()
  expect(s.models.at(-1)?.prompt).toContain(SELECTED)
})

test('the permission mode\'s room comes off on the terminal and the desktop alike, always', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const at = async (surface: 'terminal' | 'desktop') => {
    const band = await $.ui.mount({ ...BAND, surface, viewport: { columns: 103, rows: 40, isFullscreen: false } })
    const count = await actionCount(band)
    expect(await lineWidth(band)).toBeLessThanOrEqual(103 - LEAD_RESERVE)
    await band.unmount()
    return count
  }
  expect(expected(103, 'ja', LEAD_RESERVE).count).not.toBe(expected(103, 'ja', 0).count)
  for (const surface of SURFACES) expect(await at(surface)).toBe(expected(103, 'ja', LEAD_RESERVE).count)
})

test('SessionMode (drawn on the row above) is left alone, and its labels change nothing on the line', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await select(s, clock, SELECTED)
  const before = await mountBand($, 103)
  const count = await actionCount(before)
  await before.unmount()
  for (const modes of [['focus', 'memory paused'], []]) {
    const mode = await $.ui.mount({ plugin: PLUGIN, component: 'SessionMode', surface: 'terminal', props: { modes } })
    // The engine's own drawing, which no plugin's hook rewrote (nor this plugin drew).
    expectEngineDrawn(await mode.drawn())
    await mode.unmount()
    const band = await mountBand($, 103)
    expect(await actionCount(band)).toBe(count)
    await band.unmount()
  }
})

for (const surface of SURFACES) {
  test(`[${surface}] each button is kept whole; only the actions' Box shrinks and cuts; the hover labels are sized to the room left`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await select(s, clock, SELECTED)
    const band = await $.ui.mount({ ...BAND, surface, viewport: { columns: 80, rows: 40, isFullscreen: false } })
    const boxes = await band.findAll({ type: 'Box' })
    const acts = boxes.filter(b => String(b.key).startsWith('act-'))
    const count = await actionCount(band)
    // The kinds, the actions, ✕, ⋯ and ⛓, in that order, every one kept whole.
    expect(acts.map(b => String(b.key))).toEqual([
      'act-_kind-selection', 'act-_kind-context', 'act-_kind-standalone',
      ...acts.slice(3, 3 + count).map(b => String(b.key)),
      'act-close', 'act-_more', 'act-_chain-mode',
    ])
    for (const box of acts) expect(box.props.flexShrink).toBe(0)
    const row = boxes[0]!
    expect(row.props.flexDirection).toBe('row')
    expect(row.props.flexWrap).toBeUndefined()
    expect(row.props.overflow).toBe('hidden')
    // The actions sit in a Box of their own, the one part of the row that
    // shrinks: should they be more than the row holds, they are cut at its
    // end, never the kind buttons, ✕ or ⋯.
    const actions = boxes.find(b => b.key === '_hint-actions')!
    expect(actions.props.flexShrink).toBe(1)
    expect(actions.props.overflow).toBe('hidden')
    expect(actions.props.flexDirection).toBe('row')
    const inActions = actions.children.map(c => String((c as { key?: unknown; props?: { key?: unknown } }).key ?? (c as { props?: { key?: unknown } }).props?.key))
    expect(inActions).toEqual(acts.slice(3, 3 + count).map(b => String(b.key)))
    // The hover labels: sized to what the buttons leave of the row, so one
    // shown neither pushes the mode at the row's left nor squeezes the
    // actions, and giving way first (a far larger weight) should it still not fit.
    const tips = boxes.filter(b => b.props.display === 'none')
    expect(tips.length).toBe(acts.length)
    const used = await lineWidth(band)
    for (const tip of tips) {
      expect(tip.props.flexShrink).toBeGreaterThan(actions.props.flexShrink as number)
      expect(tip.props.width).toBe(80 - LEAD_RESERVE - used)
    }
    const tipTexts = (await band.findAll({ type: 'Text' })).filter(t => t.props.wrap !== undefined)
    expect(tipTexts.length).toBe(tips.length)
    for (const text of tipTexts) expect(text.props.wrap).toBe('truncate')
    await band.unmount()
  })
}
