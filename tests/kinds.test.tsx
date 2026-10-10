import { expect, mock, test } from 'claude-code/testing'

import { BAND, JA, PANE, PLUGIN, SURFACES, runCommand, stage, start } from './stage'

// These check the Japanese texts as they were before the language setting,
// so each pins `language: 'ja'` (left to `auto`, a test would see English).

for (const surface of SURFACES) {
  test(`[${surface}] complete: each action on its model and system prompt, answer in the pane`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'Permission denied (publickey)'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'explain' })
    await band.press({ key: 'translate' })

    expect(s.models.map(m => m.model)).toEqual(['sonnet', 'haiku'])
    expect(s.models[0]?.prompt).toContain('Permission denied (publickey)')
    expect(s.models[0]?.system).toContain('You explain text a developer selected')
    expect(s.models[1]?.system).toContain('Translate the selected text into natural Japanese')

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
    expect(await pane.find({ text: 'answer from haiku' })).toBeDefined()
  })

  test(`[${surface}] fork: the session answers with the selection and the action's instruction`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'ask' })

    expect(s.forks[0]).toContain('exit 137')
    expect(s.forks[0]).toContain('in the context of what we are working on in this session')
    expect(s.models).toEqual([])

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ text: 'answer in context' })).toBeDefined()
  })

  // The subagent's id is set by core alone, so a test cannot run one: this
  // checks the request; its answer arrives through turn.complete in a session.
  test(`[${surface}] subagent: registers its read-only type once and spawns it on the selection`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'graph-engine: node is not executable'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'code' })
    await band.press({ key: 'code' })

    expect(s.registered.map(r => r.name)).toEqual(['code'])
    expect(s.registered[0]?.tools).toEqual(['Read', 'Grep', 'Glob'])
    expect(s.registered[0]?.model).toBe('sonnet')
    expect(s.spawned.map(x => x.subagentType)).toEqual([`${PLUGIN}:code`, `${PLUGIN}:code`])
    expect(s.spawned[0]?.prompt).toContain('graph-engine: node is not executable')

    // The entry is headed by the definition's icon and label.
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ text: /コードの根拠/ })).toBeDefined()
  })
}

test('the empty pane points at the hint line under the prompt', { options: JA }, async ($, on) => {
  stage(on)
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /プロンプト下のヒント行/ })).toBeDefined()
})

test('/selection-actions runs the first enabled action', { options: { ...JA, actions: 'translate,explain' } }, async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'Bonjour'

  const r = await runCommand($, '')
  expect(s.models.map(m => m.model)).toEqual(['haiku'])
  expect(JSON.stringify(r)).toContain('日本語訳')
})

test('/selection-actions <id> runs that action; an unknown ID is told, not run', { options: JA }, async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'ls -la | grep foo'

  await runCommand($, ' Command ')
  expect(s.models.map(m => m.model)).toEqual(['sonnet'])
  expect(s.models[0]?.system).toContain('shell command')

  const r = await runCommand($, 'nope')
  expect(s.models).toHaveLength(1)
  // Told once, as the result, with the IDs to pick from: no toast besides.
  expect(s.toasts).toEqual([])
  expect(JSON.stringify(r)).toContain('不明なアクション ID です: nope')
  expect(JSON.stringify(r)).toContain('translate-en')
})

test('/selection-actions with nothing selected says so', { options: JA }, async ($, on) => {
  const s = stage(on)
  await start($)

  await runCommand($, '')
  expect(s.models).toEqual([])
  expect(s.toasts).toContain('選択されたテキストがありません')
})

for (const surface of SURFACES) {
  test(`[${surface}] a failed call shows in red in the pane, never stuck at running`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'segfault'
    await clock.advance(400)
    const band = await $.ui.mount({ ...BAND, surface })

    s.answer = 'empty'
    await band.press({ key: 'explain' })
    await band.press({ key: 'ask' })
    s.spawnDeny = 'not allowed here'
    await band.press({ key: 'code' })

    const pane = await $.ui.mount({ ...PANE, surface })
    const failed = await pane.findAll({ text: /回答なし \(empty-reply\)|起動できませんでした: not allowed here/ })
    // The boxes around them match too; the texts themselves are the three, in red.
    expect(failed.filter(f => f.type === 'Text').map(f => f.props.color)).toEqual(['red', 'red', 'red'])
    expect(await pane.find({ text: '考え中…' })).toBeUndefined()
  })
}

for (const surface of SURFACES) {
  test(`[${surface}] a call that rejects shows its message alone, without a repeated "Error: "`, { options: JA }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'segfault'
    await clock.advance(400)
    const band = await $.ui.mount({ ...BAND, surface })

    // Refused beneath the plugin, each call rejects with an Error.
    s.refuse = 'rate limited'
    await band.press({ key: 'explain' })
    await band.press({ key: 'ask' })
    await band.press({ key: 'code' })

    const pane = await $.ui.mount({ ...PANE, surface })
    // The boxes around them match too; the texts themselves are the three, in red.
    const texts = (await pane.findAll({ text: /rate limited/ })).filter(f => f.type === 'Text')
    expect(texts.map(f => f.props.color)).toEqual(['red', 'red', 'red'])
    const shown = texts.map(f => f.text)
    // Newest first: the subagent, the fork, the completion.
    expect(shown[0]).toMatch(/^起動できませんでした: \S.*rate limited$/)
    expect(shown[1]).toMatch(/^失敗しました: \S.*rate limited$/)
    expect(shown[2]).toMatch(/^失敗しました: \S.*rate limited$/)
    expect(await pane.find({ text: /Error:/ })).toBeUndefined()
    expect(await pane.find({ text: '考え中…' })).toBeUndefined()
  })
}
