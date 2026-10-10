import { expect, mock, test } from 'claude-code/testing'

import { ACTIONS, DEFAULT_ACTION_IDS, actionsFor, messageOf, resolveActions, resolveSpec, sys } from '../hooks/actions'
import type { ActionSpec } from '../hooks/actions'
import { BAND, PANE, PLUGIN, stage, start } from './stage'

test('at least 20 actions, unique IDs, every field filled in', () => {
  expect(ACTIONS.length).toBeGreaterThanOrEqual(20)
  const ids = ACTIONS.map(a => a.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const a of ACTIONS) {
    expect(a.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(a.icon).not.toBe('')
    expect(a.label.ja).not.toBe('')
    expect(a.label.en).not.toBe('')
    if (a.runningText !== undefined) {
      expect(a.runningText.ja).not.toBe('')
      expect(a.runningText.en).not.toBe('')
    }
    if (a.kind === 'subagent' && a.description !== undefined) {
      expect(a.description.ja).not.toBe('')
      expect(a.description.en).not.toBe('')
    }
    expect(a.prompt).not.toBe('')
    expect(['complete', 'fork', 'subagent']).toContain(a.kind)
    if (a.kind !== 'fork') expect(a.model).not.toBe('')
    if (a.kind === 'subagent') expect(a.task).not.toBe('')
  }
  for (const id of DEFAULT_ACTION_IDS) expect(ids).toContain(id)
  for (const kind of ['complete', 'fork', 'subagent']) {
    expect(ACTIONS.some(a => a.kind === kind)).toBe(true)
  }
  // Both languages resolve every definition, in the same order.
  expect(actionsFor('ja').map(a => a.id)).toEqual(ids)
  expect(actionsFor('en').map(a => a.id)).toEqual(ids)
})

test('the original four are kept', () => {
  const byId = new Map(ACTIONS.map(a => [a.id, a]))
  expect(byId.get('explain')).toMatchObject({ icon: '💡', kind: 'complete', model: 'sonnet' })
  expect(byId.get('translate')).toMatchObject({ icon: '🌐', kind: 'complete', model: 'haiku' })
  expect(byId.get('code')).toMatchObject({ icon: '🔎', kind: 'subagent', model: 'sonnet' })
  expect(byId.get('ask')).toMatchObject({ icon: '💬', kind: 'fork' })
})

test('resolveActions: one more definition is all a new action needs', () => {
  const extra: ActionSpec = {
    id: 'shout',
    icon: '📣',
    label: { ja: '大声で', en: 'Shout' },
    kind: 'complete',
    model: 'haiku',
    prompt: sys('Shout it.'),
  }
  const defs = [...ACTIONS, extra]
  expect(resolveActions(defs, 'shout,explain').map(a => a.id)).toEqual(['shout', 'explain'])
  expect(resolveActions(ACTIONS, 'shout,explain').map(a => a.id)).toEqual(['explain'])
  // Resolved, it reads in the language and asks for an answer in it.
  expect(resolveSpec(extra, 'en')).toMatchObject({ label: 'Shout', prompt: expect.stringContaining('Answer in English') })
  expect(resolveSpec(extra, 'ja')).toMatchObject({ label: '大声で', prompt: expect.stringContaining('Answer in Japanese') })
})

test('resolveActions: unset, empty, unknown and odd values never throw', () => {
  const defaults = [...DEFAULT_ACTION_IDS]
  expect(resolveActions(ACTIONS, undefined).map(a => a.id)).toEqual(defaults)
  expect(resolveActions(ACTIONS, '').map(a => a.id)).toEqual(defaults)
  expect(resolveActions(ACTIONS, ' , ,').map(a => a.id)).toEqual(defaults)
  expect(resolveActions(ACTIONS, 'nope').map(a => a.id)).toEqual(defaults)
  expect(resolveActions(ACTIONS, 42).map(a => a.id)).toEqual(defaults)
  expect(resolveActions(ACTIONS, 'ask, ASK ,nope,summarize').map(a => a.id)).toEqual(['ask', 'summarize'])
})

// Every definition, enabled through the setting, is drawn and run by the
// generic code exactly as its definition says: nothing is wired per action.
for (const language of ['ja', 'en'] as const) {
  const defs = actionsFor(language)
  test(
    `[${language}] every definition is drawn in order and runs by its kind`,
    { options: { language, actions: ACTIONS.map(a => a.id).join(',') }, timeoutMs: 30_000 },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'TypeError: x is undefined'
      await clock.advance(400)

      const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
      const icons = (await band.findAll({ type: 'Button' })).map(b => b.props.label)
      expect(icons).toEqual(ACTIONS.map(a => a.icon))

      for (const a of defs) {
        const before = { models: s.models.length, forks: s.forks.length, spawned: s.spawned.length }
        await band.press({ key: a.id })
        if (a.kind === 'complete') {
          expect(s.models.length).toBe(before.models + 1)
          expect(s.models.at(-1)).toMatchObject({ model: a.model, system: a.prompt })
          expect(s.models.at(-1)?.prompt).toContain('TypeError: x is undefined')
        } else if (a.kind === 'fork') {
          expect(s.forks.length).toBe(before.forks + 1)
          expect(s.forks.at(-1)).toContain(a.prompt)
          expect(s.forks.at(-1)).toContain('TypeError: x is undefined')
        } else {
          expect(s.spawned.length).toBe(before.spawned + 1)
          expect(s.spawned.at(-1)?.subagentType).toBe(`${PLUGIN}:${a.id}`)
          expect(s.spawned.at(-1)?.prompt).toContain(a.task)
          expect(s.registered.at(-1)).toMatchObject({ name: a.id, model: a.model })
        }
      }
      await band.unmount()

      const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
      expect(await pane.find({ text: new RegExp(defs.at(-1)!.label) })).toBeDefined()
    },
  )
}

test('a failure shows an Error by its message, anything else as String() gives it', () => {
  expect(messageOf(new Error('rate limited'))).toBe('rate limited')
  expect(messageOf(new TypeError('bad input'))).toBe('bad input')
  expect(messageOf('plain string')).toBe('plain string')
  expect(messageOf(42)).toBe('42')
  expect(messageOf(undefined)).toBe('undefined')
})
