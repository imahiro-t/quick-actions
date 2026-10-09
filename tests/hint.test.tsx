import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND, SURFACES, stage, start } from './stage'

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

  test(`[${surface}] unset: the default set, in the original order`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'some text'
    await clock.advance(400)

    expect(await iconsFor($, surface)).toEqual(['💡', '🌐', '🔎', '💬', '✕'])
  })

  test(
    `[${surface}] the setting picks the actions and their order`,
    { options: { actions: 'summarize,explain,ask' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['📝', '💡', '💬', '✕'])
    },
  )

  test(
    `[${surface}] unknown IDs are ignored; case, spaces and repeats are tolerated`,
    { options: { actions: 'nope,translate, EXPLAIN ,translate,,' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['🌐', '💡', '✕'])
    },
  )

  test(
    `[${surface}] a setting with no known ID falls back to the default set`,
    { options: { actions: 'nope,zzz' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      expect(await iconsFor($, surface)).toEqual(['💡', '🌐', '🔎', '💬', '✕'])
    },
  )

  test(`[${surface}] dismiss hides the icons for that selection only`, async ($, on) => {
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
}
