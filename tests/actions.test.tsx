import { expect, mock, test } from 'claude-code/testing'

import { ACTIONS, DEFAULT_ACTION_IDS, actionsFor, messageOf, resolveActions, resolveSpec, sys } from '../hooks/actions'
import type { ActionSpec } from '../hooks/actions'
import { BAND, PANE, PLUGIN, reselect, stage, start } from './stage'

// The built-ins, in the order of their purpose: translation, meaning, summary, evidence.
const BUILT_IN = ['translate', 'translate-en', 'explain', 'eli5', 'deep-dive', 'ask', 'summarize', 'tldr', 'code', 'why']

// The built-ins taken out (SELM-00010): written in the setting, they are ignored like any unknown ID.
const REMOVED = [
  'command', 'error', 'regex', 'code-explain', 'review', 'stacktrace', 'log', 'security', 'test-ideas',
  'glossary', 'simplify', 'proofread', 'structure', 'naming', 'usages', 'docs', 'next-step', 'send',
]

test('the ten built-ins, unique IDs, every field filled in', () => {
  const ids = ACTIONS.map(a => a.id)
  expect(ids).toEqual(BUILT_IN)
  for (const id of REMOVED) expect(ids).not.toContain(id)
  expect(new Set(ids).size).toBe(ids.length)
  // `close` is the ✕ button's key on the hint line.
  expect(ids).not.toContain('close')
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

test('the kept six are unchanged and the new four are defined as planned', () => {
  const byId = new Map(ACTIONS.map(a => [a.id, a]))
  expect(byId.get('translate')).toMatchObject({ icon: '🌐', label: { ja: '日本語訳', en: 'To Japanese' }, kind: 'complete', model: 'haiku' })
  expect(byId.get('translate-en')).toMatchObject({ icon: '🔤', label: { ja: '英訳', en: 'To English' }, kind: 'complete', model: 'haiku' })
  expect(byId.get('explain')).toMatchObject({ icon: '💡', label: { ja: '意味', en: 'Explain' }, kind: 'complete', model: 'sonnet' })
  expect(byId.get('ask')).toMatchObject({ icon: '💬', label: { ja: 'Claudeに聞く', en: 'Ask Claude' }, kind: 'fork' })
  expect(byId.get('summarize')).toMatchObject({ icon: '📝', label: { ja: '要約', en: 'Summarize' }, kind: 'complete', model: 'haiku' })
  expect(byId.get('code')).toMatchObject({ icon: '🔎', label: { ja: 'コードの根拠', en: 'Find the code' }, kind: 'subagent', model: 'sonnet' })

  expect(byId.get('eli5')).toMatchObject({ icon: '🧸', label: { ja: 'やさしく説明', en: 'Explain simply' }, kind: 'complete', model: 'haiku' })
  expect(byId.get('deep-dive')).toMatchObject({ icon: '🔬', label: { ja: '詳しく解説', en: 'Deep dive' }, kind: 'complete', model: 'sonnet' })
  expect(byId.get('tldr')).toMatchObject({ icon: '⚡', label: { ja: '一行で要約', en: 'TL;DR' }, kind: 'complete', model: 'haiku' })
  expect(byId.get('why')).toMatchObject({ icon: '🧾', label: { ja: '根拠を説明', en: 'Why so?' }, kind: 'fork' })

  // The new complete ones answer in the configured language.
  for (const id of ['eli5', 'deep-dive', 'tldr']) {
    const spec = byId.get(id)!
    expect(resolveSpec(spec, 'en').prompt).toContain('Answer in English')
    expect(resolveSpec(spec, 'ja').prompt).toContain('Answer in Japanese')
  }
  // Icons are told apart on the hint line.
  expect(new Set(ACTIONS.map(a => a.icon)).size).toBe(ACTIONS.length)
})

test('the default set is one per purpose: explain, translate, summarize, code', () => {
  expect([...DEFAULT_ACTION_IDS]).toEqual(['explain', 'translate', 'summarize', 'code'])
  // A removed ID in the setting is ignored like an unknown one.
  expect(resolveActions(ACTIONS, 'send,usages').map(a => a.id)).toEqual([...DEFAULT_ACTION_IDS])
  expect(resolveActions(ACTIONS, 'proofread,why').map(a => a.id)).toEqual(['why'])
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
      expect(icons).toEqual([...ACTIONS.map(a => a.icon), '✕'])

      for (const a of defs) {
        const before = { models: s.models.length, forks: s.forks.length, spawned: s.spawned.length }
        await reselect(s, clock)
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
