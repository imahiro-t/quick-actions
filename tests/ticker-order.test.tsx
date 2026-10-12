import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import type { Result } from '../types'
import { MESSAGES } from '../hooks/i18n'
import { EN, PANE, PICKER_CLOSE, PICKER_PANE, runCommand, stage, start } from './stage'

// The order startTicker keeps (hooks/register.tsx): the run goes into the map
// of runs before its entry is marked `timed`, and a run stopped while that
// mark was being written sets no period.
//
// The pane draws an entry marked `timed` with no run in the map as one a
// reload stopped (stopped, with "again"), so were the mark written first, a
// timer just started would be drawn stopped for a moment. These tests look at
// the pane at the moment the mark is written, from inside its write.

const STOP = (id: number) => `_stop-${id}`

/** What the result pane draws now: its texts and its buttons' keys. */
async function paneNow($: Engine) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  const buttons = (await pane.findAll({ type: 'Button' })).map(b => String(b.key))
  await pane.unmount()
  return { texts, buttons }
}

type On = Parameters<typeof stage>[0]

/**
 * Calls `then` once, right after the write that first marks entry `id` as
 * `timed` is through (inside that write, before startTicker goes on), and
 * `each` with every write of the results once it is through.
 */
function onceMarked(on: On, id: number, then: () => Promise<void>, each?: (list: Result[]) => void) {
  let seen = false
  on('state.set', async (_$, e, next) => {
    const list = e.key === 'results' ? (e.value as Result[]) : undefined
    const marked = !seen && list !== undefined && list.some(r => r.id === id && r.timed === true)
    if (marked) seen = true
    const out = await next(e)
    if (list !== undefined) each?.(list)
    if (marked) await then()
    return out
  })
  return () => seen
}

test('a timer just started is never drawn stopped, the moment its entry is marked timed', { options: EN }, async ($, on) => {
  let atMark: { texts: string[]; buttons: string[] } | undefined
  const marked = onceMarked(on, 1, async () => {
    atMark = await paneNow($)
  })
  mock.clock(on)
  stage(on)
  await start($)
  await runCommand($, 'timer 1m')
  expect(marked()).toBe(true)
  // Looked at in the write's handler, checked here. Marked but with no frame
  // yet, it is drawn as running (no button); with no run in the map it would
  // be drawn stopped, offered again.
  expect(atMark).toBeDefined()
  expect(atMark!.texts).not.toContain(MESSAGES.en.tickerStopped())
  expect(atMark!.buttons).toEqual([])
  // Then its first frame, with the stop button.
  const now = await paneNow($)
  expect(now.texts).toContain(MESSAGES.en.timerLeft('01:00'))
  expect(now.buttons).toEqual([STOP(1)])
})

test('a timer stopped while its entry is being marked timed (the pane closed meanwhile) goes no further: stopped, nothing written after', { options: EN }, async ($, on) => {
  // The writes of the results after the one that settled entry 1.
  let settled = false
  let after = 0
  const counted = (list: Result[]) => {
    if (settled) after++
    else if (list.some(r => r.id === 1 && r.status !== 'running')) settled = true
  }
  // The pane closed by its close button, as the person's close does: every run stops.
  const marked = onceMarked(
    on,
    1,
    async () => {
      const picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
      await picker.press({ key: PICKER_CLOSE })
      await picker.unmount()
    },
    counted,
  )
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await runCommand($, 'timer 1m')
  expect(marked()).toBe(true)
  await clock.settle()
  expect(settled).toBe(true)
  let now = await paneNow($)
  expect(now.texts).toContain(MESSAGES.en.tickerStopped('00:00'))
  expect(now.buttons).toEqual(['_again-1', '_set-arg-1'])
  // No period and no first frame: nothing more is written, however long.
  await clock.advance(120_000)
  now = await paneNow($)
  expect(now.texts).toContain(MESSAGES.en.tickerStopped('00:00'))
  expect(now.texts.some(t => t.includes('left'))).toBe(false)
  expect(after).toBe(0)
  expect(s.toasts).toEqual([])
})
