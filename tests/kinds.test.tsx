import { expect, mock, test } from 'claude-code/testing'

import { MESSAGES } from '../hooks/i18n'
import { BAND, JA, PANE, PICKER, PLUGIN, SURFACES, reselect, runCommand, stage, start } from './stage'

// The default set has no fork: these name one (💬 ask) beside the complete and subagent defaults.
const WITH_ASK = { ...JA, actions: 'explain,translate,ask,code' }

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
    await reselect(s, clock)
    await band.press({ key: 'explain' })
    await reselect(s, clock)
    await band.press({ key: 'translate' })

    expect(s.models.map(m => m.model)).toEqual(['sonnet', 'haiku'])
    expect(s.models[0]?.prompt).toContain('Permission denied (publickey)')
    expect(s.models[0]?.system).toContain('You explain text a developer selected')
    expect(s.models[1]?.system).toContain('Translate the selected text into natural Japanese')

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
    expect(await pane.find({ text: 'answer from haiku' })).toBeDefined()
  })

  test(`[${surface}] fork: the session answers with the selection and the action's instruction`, { options: { ...JA, actions: 'ask' } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    await reselect(s, clock)
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
    await reselect(s, clock)
    await band.press({ key: 'code' })
    await reselect(s, clock)
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

// web-check is not in the default set: pinned in the setting, it joins the hint
// line, and pressed or run by the command it registers a subagent with the web
// tools alone, described in the configured language.
for (const language of ['ja', 'en'] as const) {
  test(
    `[${language}] web-check: on the hint line once named, runs by key and by command with WebSearch / WebFetch only`,
    { options: { language, actions: 'explain,code,web-check' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'Node.js 18 reached end-of-life in April 2025'
      await clock.advance(400)

      const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
      const icons = (await band.findAll({ type: 'Button' })).map(b => b.props.label)
      expect(icons).toEqual(['[💡]', '[🔎]', '[📚]', '[🌐]', '[🔤]', '[🧸]', '✕', '⋯'])

      await reselect(s, clock)
      await band.press({ key: 'web-check' })
      expect(s.registered.map(r => r.name)).toEqual(['web-check'])
      expect([...(s.registered[0]?.tools ?? [])]).toEqual(['WebFetch', 'WebSearch'])
      expect(s.registered[0]?.model).toBe('sonnet')
      expect(s.registered[0]?.description).toBe(
        language === 'ja'
          ? '選択テキストの主張を Web の出典で確かめます（Quick Actions 専用）'
          : 'Checks the claims in a piece of selected text against sources on the web (Quick Actions only)',
      )
      expect(s.registered[0]?.prompt).toContain(language === 'ja' ? 'Answer in Japanese' : 'Answer in English')
      expect(s.spawned.map(x => x.subagentType)).toEqual([`${PLUGIN}:web-check`])
      expect(s.spawned[0]?.prompt).toContain('Check the claims in the following text against sources on the web.')
      expect(s.spawned[0]?.prompt).toContain('Node.js 18 reached end-of-life in April 2025')
      await band.unmount()

      // The command runs it too, on the same registered type.
      await runCommand($, 'web-check')
      expect(s.spawned.map(x => x.subagentType)).toEqual([`${PLUGIN}:web-check`, `${PLUGIN}:web-check`])
      expect(s.registered.map(r => r.name)).toEqual(['web-check'])

      const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
      expect(await pane.find({ text: language === 'ja' ? /Webで裏どり/ : /Check on the web/ })).toBeDefined()
    },
  )
}

test('the empty pane points at the hint line under the prompt', { options: JA }, async ($, on) => {
  stage(on)
  await start($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ text: /プロンプト下のヒント行/ })).toBeDefined()
})

test('/quick-actions without an ID opens the ⋯ dialog and runs nothing', { options: { ...JA, actions: 'translate,explain' } }, async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'Bonjour'

  const r = await runCommand($, '')
  expect(s.models).toEqual([])
  expect(s.opened.map(o => o.id)).toEqual([PICKER])
  expect(JSON.stringify(r)).toContain(MESSAGES.ja.pickerOpened)
})

test('/quick-actions <id> runs that action; an unknown ID is told, not run', { options: JA }, async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'ls -la | grep foo'

  // Case and spaces around the ID are ignored.
  await runCommand($, ' Explain ')
  expect(s.models.map(m => m.model)).toEqual(['sonnet'])
  expect(s.models[0]?.system).toContain('You explain text a developer selected')

  const r = await runCommand($, 'nope')
  expect(s.models).toHaveLength(1)
  // Told once, as the result, with the IDs to pick from: no toast besides.
  expect(s.toasts).toEqual([])
  expect(JSON.stringify(r)).toContain('不明なアクション ID です: nope')
  expect(JSON.stringify(r)).toContain('translate-en')
})

test('/quick-actions <id> of an action on the selection, with nothing selected, says so', { options: JA }, async ($, on) => {
  const s = stage(on)
  await start($)

  const r = await runCommand($, 'explain')
  expect(s.models).toEqual([])
  expect(s.toasts).toContain('選択されたテキストがありません')
  expect(JSON.stringify(r)).toContain('選択されたテキストがありません')
})

// Docked, a failure is the theme's error colour, on the background core paints
// in the theme; inline, it is the raw red the terminal draws, on the terminal's own background.
for (const surface of SURFACES) {
  for (const placement of ['dock', 'inline'] as const) {
    test(`[${surface}] ${placement}: a failed call shows in the colour that suits the background, never stuck at running`, { options: WITH_ASK }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'segfault'
      await clock.advance(400)
      const band = await $.ui.mount({ ...BAND, surface })

      s.answer = 'empty'
      await reselect(s, clock)
      await band.press({ key: 'explain' })
      await reselect(s, clock)
      await band.press({ key: 'ask' })
      s.spawnDeny = 'not allowed here'
      await reselect(s, clock)
      await band.press({ key: 'code' })

      const pane = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, placement } })
      const failed = await pane.findAll({ text: /回答なし \(empty-reply\)|起動できませんでした: not allowed here/ })
      // The boxes around them match too; the texts themselves are the three.
      const expected = placement === 'dock' ? 'error' : 'red'
      expect(failed.filter(f => f.type === 'Text').map(f => f.props.color)).toEqual([expected, expected, expected])
      expect(await pane.find({ text: '考え中…' })).toBeUndefined()
    })
  }
}

for (const surface of SURFACES) {
  test(`[${surface}] a call that rejects shows its message alone, without a repeated "Error: "`, { options: WITH_ASK }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'segfault'
    await clock.advance(400)
    const band = await $.ui.mount({ ...BAND, surface })

    // Refused beneath the plugin, each call rejects with an Error.
    s.refuse = 'rate limited'
    await reselect(s, clock)
    await band.press({ key: 'explain' })
    await reselect(s, clock)
    await band.press({ key: 'ask' })
    await reselect(s, clock)
    await band.press({ key: 'code' })

    const pane = await $.ui.mount({ ...PANE, surface })
    // The boxes around them match too; the texts themselves are the three, in the theme's error colour.
    const texts = (await pane.findAll({ text: /rate limited/ })).filter(f => f.type === 'Text')
    expect(texts.map(f => f.props.color)).toEqual(['error', 'error', 'error'])
    const shown = texts.map(f => f.text)
    // Newest first: the subagent, the fork, the completion.
    expect(shown[0]).toMatch(/^起動できませんでした: \S.*rate limited$/)
    expect(shown[1]).toMatch(/^失敗しました: \S.*rate limited$/)
    expect(shown[2]).toMatch(/^失敗しました: \S.*rate limited$/)
    expect(await pane.find({ text: /Error:/ })).toBeUndefined()
    expect(await pane.find({ text: '考え中…' })).toBeUndefined()
  })
}

// Docked, core paints the pane's background in the theme, so the heading and
// the answer are drawn in the theme too; inline, nothing is painted, so they
// keep the terminal's foreground. The dimmed texts are the theme's either way.
for (const surface of SURFACES) {
  for (const placement of ['dock', 'inline'] as const) {
    test(`[${surface}] ${placement}: heading and answer colours follow what paints the background`, { options: JA }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'Permission denied (publickey)'
      await clock.advance(400)
      const band = await $.ui.mount({ ...BAND, surface })
      await reselect(s, clock)
      await band.press({ key: 'explain' })

      const pane = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, placement } })
      const expected = placement === 'dock' ? 'text' : undefined
      const answer = (await pane.findAll({ text: 'answer from sonnet' })).filter(f => f.type === 'Text')
      expect(answer.map(f => f.props.color)).toEqual([expected])
      const heading = (await pane.findAll({ text: /「Permission denied \(publickey\)」/ })).filter(
        f => f.type === 'Text' && f.props.bold === true,
      )
      expect(heading.map(f => f.props.color)).toEqual([expected])
      const quote = (await pane.findAll({ text: '「Permission denied (publickey)」' })).filter(f => f.type === 'Text')
      expect(quote.map(f => f.props.dimColor)).toContain(true)
    })
  }
}
