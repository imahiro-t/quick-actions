import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import { BAND, EN, JA, SURFACES, hintIcons, hintKinds, kindButtons, showKind, stage, start } from './stage'
import { MESSAGES } from '../hooks/i18n'

// Which icons the hint line shows, for the `pinActions` setting the test stores:
// those of the kind it shows, the kind buttons before them left out.
const iconsFor = async ($: Engine, surface: (typeof SURFACES)[number]) => {
  const band = await $.ui.mount({ ...BAND, surface })
  const icons = await hintIcons(band)
  await band.unmount()
  return icons
}

type Mounted = Parameters<typeof hintIcons>[0]

// The kind shown now, by its kind button's name (hintKindShown marks it).
const shownKind = (buttons: { kind: string; label: string }[]) =>
  buttons.find(b => b.label.endsWith('（表示中）') || b.label.endsWith('(shown)'))?.kind

// The hint line as it is with no selection (SELM-00131: always drawn): the
// conversation's and the standalone kind buttons, no selection's, and the
// conversation's actions (<…>), then ✕, ⋯ and ⛓.
async function expectNoSelection(band: Mounted) {
  expect(await hintKinds(band)).toEqual(['context', 'standalone'])
  const icons = await hintIcons(band)
  expect(icons.slice(-3)).toEqual(['✕', '⋯', '⛓️'])
  const actions = icons.slice(0, -3)
  expect(actions.length).toBeGreaterThan(0)
  for (const icon of actions) expect(icon).toMatch(/^<.*>$/)
}

// The hint line on a selection: every kind button, the selection's actions ([…]).
async function expectSelection(band: Mounted) {
  expect(await hintKinds(band)).toEqual(['selection', 'context', 'standalone'])
  const actions = (await hintIcons(band)).slice(0, -3)
  expect(actions.length).toBeGreaterThan(0)
  for (const icon of actions) expect(icon).toMatch(/^\[.*\]$/)
}

for (const surface of SURFACES) {
  // SELM-00131: the line is always there. With nothing selected (and no
  // `/quick-actions hint` run), the conversation's actions; with a selection,
  // the selection's. Before, it was left to the engine without a selection.
  test(`[${surface}] the hint line is always drawn: the conversation's actions with no selection, the selection's with one`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)

    await clock.advance(400)
    let band = await $.ui.mount({ ...BAND, surface })
    await expectNoSelection(band)
    await band.unmount()

    s.selected = 'ECONNREFUSED 127.0.0.1:3306'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface })
    await expectSelection(band)
    expect(await band.find({ text: /ECONNREFUSED/ })).toBeUndefined()
    await band.unmount()
  })

  // Even before the first poll has run (no selection read yet), the line is drawn.
  test(`[${surface}] drawn as with no selection before any poll`, async ($, on) => {
    mock.clock(on)
    stage(on)
    await start($)

    const band = await $.ui.mount({ ...BAND, surface })
    await expectNoSelection(band)
    await band.unmount()
  })

  // While a draft is typed, the engine's own line is left as it is (no button of this plugin's).
  test(`[${surface}] a draft leaves the engine's own hint line, with or without a selection`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await clock.advance(400)

    let band = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isDraft: true } })
    expect(await band.find({ type: 'Button' })).toBeUndefined()
    await band.unmount()

    s.selected = 'exit 137'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isDraft: true } })
    expect(await band.find({ type: 'Button' })).toBeUndefined()
    await band.unmount()
  })

  // No pins and no usage yet: the default set leads, the rest following, the
  // first six shown, then ✕ and ⋯. With a selection the line shows the actions
  // on it ([ ]) alone; the other kinds are a press of a kind button away.
  // (Before SELM-00025 the default set's kinds were drawn mixed, [💡] <🧭> [🌐] …;
  // before SELM-00050 its context actions <🧭> <✅> followed on the same line.)
  test(`[${surface}] unset: the default set first, then the rest, six in all, then ✕ and ⋯`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'some text'
    await clock.advance(400)

    expect(await iconsFor($, surface)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '[🔤]', '[🀄]', '✕', '⋯', '⛓️'])
  })

  test(
    `[${surface}] the setting pins actions first, in its order; the rest follow`,
    { options: { pinActions: 'summarize,explain,ask' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['[📝]', '[💡]', '[💬]', '[🌐]', '[🔤]', '[🀄]', '✕', '⋯', '⛓️'])
    },
  )

  test(
    `[${surface}] unknown IDs are ignored; case, spaces and repeats are tolerated`,
    { options: { pinActions: 'nope,translate-ja, EXPLAIN ,translate-ja,,' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['[🌐]', '[💡]', '[🔤]', '[🀄]', '[🏮]', '[🌏]', '✕', '⋯', '⛓️'])
    },
  )

  test(
    `[${surface}] a setting with no known ID pins nothing: the default set leads, as unset`,
    { options: { pinActions: 'nope,zzz' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '[🔤]', '[🀄]', '✕', '⋯', '⛓️'])
    },
  )

  // Clearing the selection ($.ui.selection() answering undefined) puts the
  // line back to no selection by the next poll: on a hint line drawn afresh
  // and on one that stays mounted, which the write to the selection redraws.
  // The line itself stays.
  test(`[${surface}] clearing the selection puts the line back to no selection by the next poll`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const mounted = await $.ui.mount({ ...BAND, surface })
    await expectSelection(mounted)

    s.selected = null
    await clock.advance(400)
    await expectNoSelection(mounted)
    await mounted.unmount()

    const fresh = await $.ui.mount({ ...BAND, surface })
    await expectNoSelection(fresh)
    await fresh.unmount()

    // Selecting again brings the selection's back.
    s.selected = 'exit 1'
    await clock.advance(400)
    const again = await $.ui.mount({ ...BAND, surface })
    await expectSelection(again)
    await again.unmount()
  })

  test(`[${surface}] ✕ puts the line back to no selection for that selection only; the line stays`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    let band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'close' })
    await expectNoSelection(band)
    await band.unmount()
    band = await $.ui.mount({ ...BAND, surface })
    await expectNoSelection(band)
    await band.unmount()

    s.selected = 'exit 1'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface })
    await expectSelection(band)
    await band.unmount()
  })

  // ✕ also puts back the kind switched to and turns the chain mode off.
  test(`[${surface}] ✕ puts back the kind switched to and turns the chain mode off`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    await showKind(band, 'standalone')
    await band.press({ key: '_chain-mode' })
    expect(shownKind(await kindButtons(band))).toBe('standalone')
    expect(await band.find({ key: '_chain-guide' })).toBeDefined()

    await band.press({ key: 'close' })
    await expectNoSelection(band)
    expect(shownKind(await kindButtons(band))).toBe('context')
    expect(await band.find({ key: '_chain-guide' })).toBeUndefined()
    await band.unmount()
  })

  // With no selection, ✕ changes nothing that is drawn, and the line stays.
  test(`[${surface}] ✕ with no selection leaves the line as it opens`, async ($, on) => {
    const clock = mock.clock(on)
    stage(on)
    await start($)
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    await showKind(band, 'standalone')
    expect(shownKind(await kindButtons(band))).toBe('standalone')
    await band.press({ key: 'close' })
    await expectNoSelection(band)
    expect(shownKind(await kindButtons(band))).toBe('context')
    await band.unmount()
  })

  // The engine keeps answering a selection after a click elsewhere takes its
  // highlight down, so pressing an action is what puts its icons away.
  test(`[${surface}] pressing an action puts the line back to no selection until another selection`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    let band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'explain' })
    await clock.advance(400)
    await expectNoSelection(band)
    await band.unmount()
    expect(s.models.length).toBe(1)

    s.selected = 'exit 1'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface })
    await expectSelection(band)
    await band.unmount()

    // Once the selection is cleared, the same text selected again shows them.
    s.selected = null
    await clock.advance(400)
    s.selected = 'exit 137'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface })
    await expectSelection(band)
    await band.unmount()
  })

  test(`[${surface}] ✕ is labelled 選択なしの表示に戻す in Japanese`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    const close = await band.find({ key: 'close' })
    expect(close?.props.label).toBe(MESSAGES.ja.hintResetName)
    expect(await band.find({ text: new RegExp(MESSAGES.ja.hintResetTip) })).toBeDefined()
    expect(await band.find({ text: /閉じる/ })).toBeUndefined()
    await band.unmount()
  })

  test(`[${surface}] and Back to no selection in English`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    const close = await band.find({ key: 'close' })
    expect(close?.props.label).toBe(MESSAGES.en.hintResetName)
    expect(await band.find({ text: /Back to no selection/ })).toBeDefined()
    expect(await band.find({ text: /選択なし/ })).toBeUndefined()
    await band.unmount()
  })
}
