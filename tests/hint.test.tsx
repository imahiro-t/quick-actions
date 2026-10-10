import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND, EN, JA, SURFACES, stage, start } from './stage'

// Which icons the hint line shows, for the `actions` setting the test stores.
const iconsFor = async ($: Engine, surface: (typeof SURFACES)[number]) => {
  const band = await $.ui.mount({ ...BAND, surface })
  const icons = (await band.findAll({ type: 'Button' })).map(b => b.props.label)
  await band.unmount()
  return icons
}

for (const surface of SURFACES) {
  test(`[${surface}] icons take the hint line only while text is selected`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)

    await clock.advance(400)
    let band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Button' })).toBeUndefined()
    await band.unmount()

    s.selected = 'ECONNREFUSED 127.0.0.1:3306'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Button' })).toBeDefined()
    expect(await band.find({ text: /ECONNREFUSED/ })).toBeUndefined()
    await band.unmount()
  })

  // No pins and no usage yet: the default set leads, its actions on the
  // selection ([ ]) before its others (< > on the conversation; the standalone
  // timer { } after them), the rest following, the first six shown, then ✕ and ⋯.
  // (Before SELM-00025 the default set's kinds were drawn mixed, [💡] <🧭> [🌐] …:
  // with a selection, the actions on it now come first.)
  test(`[${surface}] unset: the default set first, then the rest, six in all, then ✕ and ⋯`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'some text'
    await clock.advance(400)

    expect(await iconsFor($, surface)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '<🧭>', '<✅>', '✕', '⋯'])
  })

  test(
    `[${surface}] the setting pins actions first, in its order; the rest follow`,
    { options: { actions: 'summarize,explain,ask' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['[📝]', '[💡]', '[💬]', '[🌐]', '[🔤]', '[🧸]', '✕', '⋯'])
    },
  )

  test(
    `[${surface}] unknown IDs are ignored; case, spaces and repeats are tolerated`,
    { options: { actions: 'nope,translate-ja, EXPLAIN ,translate-ja,,' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['[🌐]', '[💡]', '[🔤]', '[🧸]', '[🔬]', '[💬]', '✕', '⋯'])
    },
  )

  test(
    `[${surface}] a setting with no known ID pins nothing: the default set leads, as unset`,
    { options: { actions: 'nope,zzz' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '<🧭>', '<✅>', '✕', '⋯'])
    },
  )

  // Clearing the selection ($.ui.selection() answering undefined) takes the
  // icons off by the next poll: on a hint line drawn afresh and on one that
  // stays mounted, which the write to the selection redraws.
  test(`[${surface}] clearing the selection takes the icons off by the next poll`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const mounted = await $.ui.mount({ ...BAND, surface })
    expect(await mounted.find({ type: 'Button' })).toBeDefined()

    s.selected = null
    await clock.advance(400)
    expect(await mounted.find({ type: 'Button' })).toBeUndefined()
    await mounted.unmount()

    const fresh = await $.ui.mount({ ...BAND, surface })
    expect(await fresh.find({ type: 'Button' })).toBeUndefined()
    await fresh.unmount()

    // Selecting again brings them back.
    s.selected = 'exit 1'
    await clock.advance(400)
    const again = await $.ui.mount({ ...BAND, surface })
    expect(await again.find({ type: 'Button' })).toBeDefined()
    await again.unmount()
  })

  test(`[${surface}] ✕ hides the icons for that selection only`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    let band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'close' })
    await band.unmount()
    band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Button' })).toBeUndefined()
    await band.unmount()

    s.selected = 'exit 1'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Button' })).toBeDefined()
    await band.unmount()
  })

  // The engine keeps answering a selection after a click elsewhere takes its
  // highlight down, so pressing an action is what puts its icons away.
  test(`[${surface}] pressing an action hides the icons until another selection`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    let band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'explain' })
    await clock.advance(400)
    expect(await band.find({ type: 'Button' })).toBeUndefined()
    await band.unmount()
    expect(s.models.length).toBe(1)

    s.selected = 'exit 1'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Button' })).toBeDefined()
    await band.unmount()

    // Once the selection is cleared, the same text selected again shows them.
    s.selected = null
    await clock.advance(400)
    s.selected = 'exit 137'
    await clock.advance(400)
    band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Button' })).toBeDefined()
    await band.unmount()
  })

  test(`[${surface}] ✕ is labelled 閉じる in Japanese`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ key: 'close' })).toBeDefined()
    expect(await band.find({ text: /閉じる/ })).toBeDefined()
    await band.unmount()
  })

  test(`[${surface}] and Close in English`, { options: EN }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ key: 'close' })).toBeDefined()
    expect(await band.find({ text: /Close/ })).toBeDefined()
    expect(await band.find({ text: /閉じる/ })).toBeUndefined()
    await band.unmount()
  })
}
