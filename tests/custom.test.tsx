import { expect, mock, test } from 'claude-code/testing'

import { ACTIONS, ANSWER_LANGUAGE, STYLE, resolveSpec } from '../hooks/actions'
import { ALLOWED_SUBAGENT_TOOLS, KINDS, MODELS, parseCustomActions, problemFor, problemLine, withProblems } from '../hooks/custom'
import type { CustomReason } from '../hooks/custom'
import { MESSAGES, answerStyle } from '../hooks/i18n'
import { BAND, EN, JA, JAPANESE, PANE, PLUGIN, SURFACES, reselect, runCommand, stage, start } from './stage'

// The person's own actions, from the `customActions` setting: read, checked,
// shown on the hint line and run like the built-ins.

const RESERVED = [...ACTIONS.map(a => a.id), 'close']

// One valid definition of each kind, in the shapes the README shows.
const MINE = {
  id: 'mine',
  icon: '🪄',
  label: { ja: '海賊風の要約', en: 'Pirate summary' },
  kind: 'complete',
  model: 'haiku',
  maxTokens: 300,
  prompt: 'Summarize the selected text the way a pirate would.',
  runningText: { ja: '海賊が考え中…', en: 'The pirate is thinking…' },
}
const RELATE = {
  id: 'relate',
  icon: '🧭',
  label: 'Relate',
  kind: 'fork',
  // A STYLE here would say the answer language twice: it is dropped.
  prompt: 'Relate the selected text to what we are working on. {STYLE}',
  runningText: 'Relating…',
}
const REVIEW = {
  id: 'review-pr',
  icon: '🧪',
  label: { ja: 'レビュー', en: 'Review' },
  kind: 'subagent',
  model: 'opus',
  task: 'Review the following code.',
  prompt: 'You review code and answer in {ANSWER_LANGUAGE}.',
  description: { ja: 'コードをレビューします', en: 'Reviews code' },
  tools: ['Read', 'Grep', 'WebFetch', 'Read'],
}
const LOOK = {
  id: 'look',
  icon: '👀',
  label: 'Look around',
  kind: 'subagent',
  model: 'sonnet',
  task: 'Look into the following text.',
  prompt: 'You look into the repository; change nothing.',
  runningText: { ja: '調べ中…', en: 'Looking…' },
}
const VALID = [MINE, RELATE, REVIEW, LOOK]
const json = (defs: unknown[]) => JSON.stringify(defs)

// ---------------------------------------------------------------------------
// parseCustomActions

test('parse: unset or blank gives nothing and no problem', () => {
  for (const setting of [undefined, null, '', '   ']) {
    expect(parseCustomActions(setting, RESERVED)).toEqual({ specs: [], problems: [] })
  }
})

test('parse: a value that is not a string leaves every definition out, and says so', () => {
  // An array written into settings.json without quoting it is the likely one.
  // Claude Code refuses to load the module with such a value (the options must
  // fit plugin.json's userConfig), so this is a guard should one get through.
  for (const setting of [[MINE], {}, [], 42, true]) {
    expect(parseCustomActions(setting, RESERVED)).toEqual({
      specs: [],
      problems: [{ index: null, id: null, reason: { code: 'notString' } }],
    })
  }
})

test('parse: a setting that is not a JSON array leaves every definition out, with the reason', () => {
  const broken = parseCustomActions('[{"id": "mine",', RESERVED)
  expect(broken.specs).toEqual([])
  expect(broken.problems).toHaveLength(1)
  expect(broken.problems[0]).toMatchObject({ index: null, id: null, reason: { code: 'json' } })

  for (const setting of ['{"id": "mine"}', '"mine"', '42', 'null']) {
    expect(parseCustomActions(setting, RESERVED)).toEqual({
      specs: [],
      problems: [{ index: null, id: null, reason: { code: 'notArray' } }],
    })
  }
})

test('parse: valid definitions of each kind, with labels as one string or { ja, en }', () => {
  const { specs, problems } = parseCustomActions(json(VALID), RESERVED)
  expect(problems).toEqual([])
  expect(specs.map(s => s.id)).toEqual(['mine', 'relate', 'review-pr', 'look'])

  const [mine, relate, review, look] = specs
  expect(mine).toMatchObject({ kind: 'complete', model: 'haiku', maxTokens: 300, label: MINE.label, runningText: MINE.runningText })
  // Nothing about the language in it: STYLE is added, as sys() does for the built-ins.
  expect(mine?.prompt).toBe(`${MINE.prompt} ${STYLE}`)

  // One string serves both languages; the fork's STYLE is gone.
  expect(relate).toMatchObject({ kind: 'fork', label: { ja: 'Relate', en: 'Relate' }, runningText: { ja: 'Relating…', en: 'Relating…' } })
  expect(relate?.prompt).toBe('Relate the selected text to what we are working on.')

  // ANSWER_LANGUAGE says how already: nothing is added. Tools are kept once each.
  expect(review).toMatchObject({ kind: 'subagent', model: 'opus', task: REVIEW.task, description: REVIEW.description, tools: ['Read', 'Grep', 'WebFetch'] })
  expect(review?.prompt).toBe(REVIEW.prompt)

  // No tools given: none are set, so the read-only default applies.
  expect(look).toMatchObject({ kind: 'subagent' })
  expect(look && 'tools' in look ? look.tools : undefined).toBeUndefined()
})

test('parse: keys that do not apply to the kind, and unknown keys, are ignored', () => {
  const { specs, problems } = parseCustomActions(
    json([
      { ...RELATE, model: 'gpt-4', maxTokens: -1, task: 7, tools: ['Bash'], description: 'x', extra: true },
      { ...MINE, id: 'mine-2', task: 7, tools: ['Bash'], description: 'x' },
    ]),
    RESERVED,
  )
  expect(problems).toEqual([])
  expect(specs.map(s => s.id)).toEqual(['relate', 'mine-2'])
  for (const spec of specs) {
    expect(spec).not.toHaveProperty('tools')
    expect(spec).not.toHaveProperty('description')
    expect(spec).not.toHaveProperty('extra')
  }
})

test('parse: each invalid definition alone is left out, with the first reason found', () => {
  const cases: [unknown, CustomReason][] = [
    ['not an object', { code: 'notObject' }],
    [{ ...MINE, id: undefined }, { code: 'missing', field: 'id' }],
    [{ ...MINE, id: 'Bad_ID' }, { code: 'idFormat' }],
    [{ ...MINE, id: 'my--id' }, { code: 'idFormat' }],
    [{ ...MINE, id: 'close' }, { code: 'idReserved' }],
    [{ ...MINE, id: 'explain' }, { code: 'idReserved' }],
    [{ ...MINE, id: 'code' }, { code: 'idReserved' }],
    [{ ...MINE, id: 'mine' }, { code: 'idDuplicate' }],
    [{ ...MINE, id: 'no-icon', icon: undefined }, { code: 'missing', field: 'icon' }],
    [{ ...MINE, id: 'no-label', label: undefined }, { code: 'missing', field: 'label' }],
    [{ ...MINE, id: 'half-label', label: { ja: 'だけ' } }, { code: 'invalid', field: 'label' }],
    [{ ...MINE, id: 'odd-running', runningText: 5 }, { code: 'invalid', field: 'runningText' }],
    [{ ...MINE, id: 'no-kind', kind: undefined }, { code: 'missing', field: 'kind' }],
    [{ ...MINE, id: 'bad-kind', kind: 'shell' }, { code: 'kind', value: 'shell', allowed: KINDS }],
    [{ ...MINE, id: 'no-prompt', prompt: '  ' }, { code: 'missing', field: 'prompt' }],
    [{ ...MINE, id: 'no-model', model: undefined }, { code: 'missing', field: 'model' }],
    [{ ...MINE, id: 'bad-model', model: 'gpt-4' }, { code: 'model', value: 'gpt-4', allowed: MODELS }],
    [{ ...MINE, id: 'cased-model', model: 'Haiku' }, { code: 'model', value: 'Haiku', allowed: MODELS }],
    [{ ...MINE, id: 'zero-tokens', maxTokens: 0 }, { code: 'invalid', field: 'maxTokens' }],
    [{ ...MINE, id: 'many-tokens', maxTokens: 32_001 }, { code: 'invalid', field: 'maxTokens' }],
    [{ ...MINE, id: 'odd-tokens', maxTokens: '300' }, { code: 'invalid', field: 'maxTokens' }],
    [{ ...LOOK, id: 'no-task', task: undefined }, { code: 'missing', field: 'task' }],
    [{ ...LOOK, id: 'sub-no-model', model: undefined }, { code: 'missing', field: 'model' }],
    [{ ...LOOK, id: 'bad-tools', tools: ['Read', 'Bash'] }, { code: 'tools', names: ['Bash'], allowed: ALLOWED_SUBAGENT_TOOLS }],
    [{ ...LOOK, id: 'write-tools', tools: ['Write', 'Edit', 'Write'] }, { code: 'tools', names: ['Write', 'Edit'], allowed: ALLOWED_SUBAGENT_TOOLS }],
    [{ ...LOOK, id: 'cased-tools', tools: ['read'] }, { code: 'tools', names: ['read'], allowed: ALLOWED_SUBAGENT_TOOLS }],
    [{ ...LOOK, id: 'empty-tools', tools: [] }, { code: 'invalid', field: 'tools' }],
    [{ ...LOOK, id: 'string-tools', tools: 'Read' }, { code: 'invalid', field: 'tools' }],
    [{ ...LOOK, id: 'odd-description', description: { en: 'only' } }, { code: 'invalid', field: 'description' }],
    [{ ...RELATE, id: 'only-style', prompt: '{STYLE}' }, { code: 'missing', field: 'prompt' }],
  ]
  // The valid ones around them stay.
  const web = { ...LOOK, id: 'web', tools: ['WebFetch', 'WebSearch'] }
  const { specs, problems } = parseCustomActions(json([MINE, ...cases.map(c => c[0]), web]), RESERVED)
  expect(specs.map(s => s.id)).toEqual(['mine', 'web'])
  expect(problems.map(p => p.reason)).toEqual(cases.map(c => c[1]))
  expect(problems.map(p => p.index)).toEqual(cases.map((_, i) => i + 1))
  // The ID is kept when it is a string, for the command to name.
  expect(problems.find(p => p.reason.code === 'idFormat')?.id).toBe('Bad_ID')
  expect(problems[0]?.id).toBeNull()
})

test('parse: only a valid definition takes its ID; a later one with it is then valid', () => {
  const { specs, problems } = parseCustomActions(json([{ ...MINE, model: 'gpt-4' }, MINE]), RESERVED)
  expect(specs.map(s => s.id)).toEqual(['mine'])
  expect(problems.map(p => p.index)).toEqual([0])
})

// Copied from the README (both languages show the same ones): tests cannot
// read files, so keep these in step with it when it changes.
const README_EXAMPLES = [
  { id: 'pirate', icon: '🦜', label: { ja: '海賊風に言い換え', en: 'Pirate talk' }, kind: 'complete', model: 'haiku', maxTokens: 500, prompt: 'Retell the selected text the way a pirate would.' },
  { id: 'cause', icon: '❓', label: { ja: '原因は？', en: 'What caused this?' }, kind: 'fork', prompt: 'Explain why this happened, given what we did earlier in this session.' },
  {
    id: 'review-pr',
    icon: '🧪',
    label: { ja: 'コードレビュー', en: 'Code review' },
    kind: 'subagent',
    model: 'sonnet',
    task: 'Review the following code, reading the files around it.',
    prompt: 'You review code for bugs and risky patterns. Search with Grep and Glob, read with Read; change nothing.',
    runningText: { ja: 'レビュー中…', en: 'Reviewing…' },
    tools: ['Read', 'Grep', 'Glob'],
  },
]
const README_SETTING =
  '[{"id":"pirate","icon":"🦜","label":{"ja":"海賊風に言い換え","en":"Pirate talk"},"kind":"complete","model":"haiku","prompt":"Retell the selected text the way a pirate would."}]'

test("the README's examples are valid definitions", () => {
  const listed = parseCustomActions(json(README_EXAMPLES), RESERVED)
  expect(listed.problems).toEqual([])
  expect(listed.specs.map(sp => sp.id)).toEqual(['pirate', 'cause', 'review-pr'])
  const set = parseCustomActions(README_SETTING, RESERVED)
  expect(set.problems).toEqual([])
  expect(set.specs.map(sp => sp.id)).toEqual(['pirate'])
  // The fixed-language example: the answer language is left to its author.
  const french = 'Translate the selected text into French. Write any note on it in {ANSWER_LANGUAGE}.'
  const [fr] = parseCustomActions(json([{ ...README_EXAMPLES[0], id: 'french', prompt: french }]), RESERVED).specs
  expect(fr?.prompt).toBe(french)
})

test('the allowed tools and models are exactly the ones the ticket names', () => {
  expect([...ALLOWED_SUBAGENT_TOOLS]).toEqual(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])
  expect([...MODELS]).toEqual(['haiku', 'sonnet', 'opus'])
  expect([...KINDS]).toEqual(['complete', 'fork', 'subagent'])
})

test('the reasons name the allowed values from the one list that checks them', () => {
  const { problems } = parseCustomActions(
    json([{ ...MINE, kind: 'shell' }, { ...MINE, id: 'm', model: 'gpt-4' }, { ...LOOK, tools: ['Bash'] }]),
    RESERVED,
  )
  for (const lang of ['ja', 'en'] as const) {
    const [kind, model, tools] = problems.map(p => problemLine(p, lang))
    for (const k of KINDS) expect(kind).toContain(k)
    for (const m of MODELS) expect(model).toContain(m)
    for (const t of ALLOWED_SUBAGENT_TOOLS) expect(tools).toContain(t)
  }
})

test('a long ID is kept whole to match, and shortened only when shown', () => {
  const long = `a${'-very'.repeat(10)}-long-id`
  expect(long.length).toBeGreaterThan(40)
  const { problems } = parseCustomActions(json([{ ...LOOK, id: long, task: undefined }, { ...LOOK, id: ' Spaced ' }]), RESERVED)
  expect(problems[0]?.id).toBe(long)
  expect(problemFor(problems, long)).toBe(problems[0])
  const line = problemLine(problems[0]!, 'en')
  expect(line).toContain('...')
  expect(line).not.toContain(long)
  // The command trims and lowercases what it is given: the written ID is matched the same way.
  expect(problemFor(problems, 'spaced')).toBe(problems[1])
})

test('the answer language: STYLE and ANSWER_LANGUAGE are filled in for each language, never twice', () => {
  const { specs } = parseCustomActions(
    json([MINE, REVIEW, { ...MINE, id: 'styled', prompt: 'Be brief. {STYLE}' }, { ...RELATE, prompt: 'In {ANSWER_LANGUAGE}, relate it. {STYLE}' }]),
    RESERVED,
  )
  for (const [lang, name] of [['ja', 'Japanese'], ['en', 'English']] as const) {
    const [mine, review, styled, relate] = specs.map(s => resolveSpec(s, lang))
    expect(mine?.prompt).toBe(`${MINE.prompt} ${answerStyle(lang)}`)
    expect(review?.prompt).toBe(`You review code and answer in ${name}.`)
    expect(styled?.prompt).toBe(`Be brief. ${answerStyle(lang)}`)
    // A fork's answer style comes at run time; only the language's name is put in here.
    expect(relate?.prompt).toBe(`In ${name}, relate it.`)
    for (const d of [mine, review, styled, relate]) {
      expect(d?.prompt).not.toContain(STYLE)
      expect(d?.prompt).not.toContain(ANSWER_LANGUAGE)
      expect(d?.prompt.split('Answer in').length ?? 0).toBeLessThanOrEqual(2)
    }
  }
})

test('the reasons read in each language, English with no Japanese in it', () => {
  const { problems } = parseCustomActions(
    json([{ ...LOOK, tools: ['Bash'] }, { ...MINE, model: 'gpt-4' }, 'x', { ...MINE, id: 'close' }]),
    RESERVED,
  )
  expect(problemLine(problems[0]!, 'ja')).toBe(
    '#1 (look): subagent で使えないツール Bash を指定しています（使えるのは Read, Grep, Glob, WebFetch, WebSearch）',
  )
  expect(problemLine(problems[0]!, 'en')).toBe(
    '#1 (look): tools a subagent cannot have: Bash (allowed: Read, Grep, Glob, WebFetch, WebSearch)',
  )
  expect(problemLine(problems[2]!, 'en')).toBe('#3: the definition is not an object')
  const en = withProblems('result', problems, 'en')
  expect(en.split('\n')).toEqual(['result', '', MESSAGES.en.customProblemsHeading, ...problems.map(p => `- ${problemLine(p, 'en')}`)])
  expect(en).not.toMatch(JAPANESE)
  expect(withProblems('result', [], 'ja')).toBe('result')
})

// ---------------------------------------------------------------------------
// On the hint line, by press and by command

const WITH_CUSTOM = { customActions: json(VALID), actions: 'mine,explain,relate,review-pr,look' }

for (const surface of SURFACES) {
  for (const [options, labels] of [
    [{ ...JA, ...WITH_CUSTOM }, ['海賊風の要約', '意味', 'Relate', 'レビュー', 'Look around']],
    [{ ...EN, ...WITH_CUSTOM }, ['Pirate summary', 'Explain', 'Relate', 'Review', 'Look around']],
  ] as const) {
    test(`[${surface}] [${options.language}] custom actions take their place on the hint line as \`actions\` orders them`, { options }, async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'some text'
      await clock.advance(400)

      const band = await $.ui.mount({ ...BAND, surface })
      const icons = (await band.findAll({ type: 'Button' })).map(b => b.props.label)
      expect(icons).toEqual(['🪄', '💡', '🧭', '🧪', '👀', '✕'])
      for (const label of labels) expect(await band.find({ text: new RegExp(label) })).toBeDefined()
      // Nothing was wrong: no toast.
      expect(s.toasts).toEqual([])
    })
  }

  test(`[${surface}] each custom kind runs by its press as its definition says`, { options: { ...JA, ...WITH_CUSTOM } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'TypeError: x is undefined'
    await clock.advance(400)
    const band = await $.ui.mount({ ...BAND, surface })

    await reselect(s, clock)
    await band.press({ key: 'mine' })
    expect(s.models).toEqual([
      { model: 'haiku', system: `${MINE.prompt} ${answerStyle('ja')}`, prompt: expect.stringContaining('TypeError: x is undefined') },
    ])

    await reselect(s, clock)
    await band.press({ key: 'relate' })
    expect(s.forks).toHaveLength(1)
    expect(s.forks[0]).toContain('TypeError: x is undefined')
    expect(s.forks[0]).toContain('Relate the selected text to what we are working on.')
    // The answer language once, from the run itself.
    expect(s.forks[0]?.split('Answer in Japanese')).toHaveLength(2)
    expect(s.forks[0]).not.toContain(STYLE)

    await reselect(s, clock)
    await band.press({ key: 'review-pr' })
    await reselect(s, clock)
    await band.press({ key: 'look' })
    expect(s.registered).toEqual([
      { name: 'review-pr', model: 'opus', tools: ['Read', 'Grep', 'WebFetch'], description: 'コードをレビューします', prompt: 'You review code and answer in Japanese.' },
      {
        name: 'look',
        model: 'sonnet',
        tools: ['Read', 'Grep', 'Glob'],
        description: MESSAGES.ja.agentDescription('Look around'),
        prompt: `${LOOK.prompt} ${answerStyle('ja')}`,
      },
    ])
    expect(s.spawned.map(x => x.subagentType)).toEqual([`${PLUGIN}:review-pr`, `${PLUGIN}:look`])
    expect(s.spawned[0]?.prompt).toContain('Review the following code.')
    expect(s.spawned[0]?.prompt).toContain('TypeError: x is undefined')

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ text: /海賊風の要約/ })).toBeDefined()
    expect(await pane.find({ text: 'answer from haiku' })).toBeDefined()
    expect(await pane.find({ text: 'answer in context' })).toBeDefined()
  })
}

test('each custom kind runs by `/selection-actions <id>`, in English too', { options: { ...EN, ...WITH_CUSTOM } }, async ($, on) => {
  const s = stage(on)
  await start($)
  s.selected = 'ECONNREFUSED'

  const ran = await runCommand($, 'mine')
  expect(JSON.stringify(ran)).toContain('Showing the Pirate summary result in the Selection Actions pane.')
  expect(s.models).toEqual([{ model: 'haiku', system: `${MINE.prompt} ${answerStyle('en')}`, prompt: expect.stringContaining('ECONNREFUSED') }])

  await runCommand($, ' RELATE ')
  expect(s.forks[0]?.split('Answer in English')).toHaveLength(2)

  await runCommand($, 'review-pr')
  expect(s.registered[0]).toMatchObject({ name: 'review-pr', tools: ['Read', 'Grep', 'WebFetch'], prompt: 'You review code and answer in English.' })
  expect(s.spawned.map(x => x.subagentType)).toEqual([`${PLUGIN}:review-pr`])

  // With no ID, the first on the hint line: here a custom one.
  await runCommand($, '')
  expect(s.models).toHaveLength(2)
})

for (const [options, texts] of [
  [{ ...JA, ...WITH_CUSTOM }, ['海賊が考え中…', 'Relating…', '調べ中…']],
  [{ ...EN, ...WITH_CUSTOM }, ['The pirate is thinking…', 'Relating…', 'Looking…']],
] as const) {
  test(`[${options.language}] a custom runningText shows while each kind runs`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    // Shown while the call (for the subagent, its registration) is held, gone once it settles.
    for (const [key, text] of [['mine', texts[0]], ['relate', texts[1]], ['look', texts[2]]] as const) {
      let release = () => {}
      s.hold = new Promise<void>(resolve => (release = resolve))
      await reselect(s, clock)
      const pressed = band.press({ key })
      const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
      expect(await pane.find({ text })).toBeDefined()
      release()
      await pressed
      expect(await pane.find({ text })).toBeUndefined()
      await pane.unmount()
    }
  })
}

// ---------------------------------------------------------------------------
// Invalid definitions: left out, the reason told, the built-ins untouched

const BAD_TOOLS = { ...LOOK, id: 'shell-look', tools: ['Read', 'Bash'] }
const BAD_MODEL = { ...MINE, id: 'gpt', model: 'gpt-4' }
const MIXED = { customActions: json([BAD_TOOLS, MINE, BAD_MODEL]), actions: 'mine,shell-look,gpt,explain' }

test('invalid definitions: a toast at start with the count and the first reason', { options: { ...JA, ...MIXED } }, async ($, on) => {
  const s = stage(on)
  await start($)
  expect(s.toasts).toHaveLength(1)
  expect(s.toasts[0]).toContain('2 件')
  expect(s.toasts[0]).toContain('#1 (shell-look): subagent で使えないツール Bash')
  expect(s.toasts[0]).toContain('/selection-actions')
})

test('invalid definitions: the toast in English has no Japanese', { options: { ...EN, ...MIXED } }, async ($, on) => {
  const s = stage(on)
  await start($)
  expect(s.toasts).toHaveLength(1)
  expect(s.toasts[0]).toContain('2 problem(s)')
  expect(s.toasts[0]).toContain('#1 (shell-look): tools a subagent cannot have: Bash')
  expect(s.toasts[0]).not.toMatch(JAPANESE)
})

for (const surface of SURFACES) {
  test(`[${surface}] invalid definitions: only the valid ones show, and the built-ins still run`, { options: { ...JA, ...MIXED } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'segfault'
    await clock.advance(400)

    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['🪄', '💡', '✕'])
    await reselect(s, clock)
    await band.press({ key: 'explain' })
    expect(s.models.map(m => m.model)).toEqual(['sonnet'])
    expect(s.registered).toEqual([])
  })
}

test('invalid definitions: every result of /selection-actions lists them all', { options: { ...JA, ...MIXED } }, async ($, on) => {
  const s = stage(on)
  await start($)
  const listed = (r: unknown) => {
    const text = JSON.stringify(r)
    expect(text).toContain(MESSAGES.ja.customProblemsHeading)
    expect(text).toContain('- #1 (shell-look): subagent で使えないツール Bash を指定しています')
    expect(text).toContain('- #3 (gpt): model は haiku / sonnet / opus のいずれかにしてください（指定: gpt-4）')
  }

  // No ID, nothing selected.
  const none = await runCommand($, '')
  expect(s.toasts).toContain('選択されたテキストがありません')
  listed(none)

  // A valid ID, with a selection.
  s.selected = 'segfault'
  const ran = await runCommand($, 'mine')
  expect(s.models.map(m => m.model)).toEqual(['haiku'])
  expect(JSON.stringify(ran)).toContain('Selection Actions ペインに 海賊風の要約 の結果を表示します。')
  listed(ran)

  // The ID of a definition left out: why, and nothing run.
  const ignored = await runCommand($, 'Shell-Look')
  expect(JSON.stringify(ignored)).toContain('shell-look は customActions の定義が無効なため使えません: subagent で使えないツール Bash')
  expect(JSON.stringify(ignored)).not.toContain('不明なアクション ID')
  listed(ignored)

  // An unknown ID: the IDs that exist, custom ones included, then the list.
  const unknown = await runCommand($, 'nope')
  expect(JSON.stringify(unknown)).toContain('不明なアクション ID です: nope')
  expect(JSON.stringify(unknown)).toContain('mine')
  listed(unknown)

  expect(s.models).toHaveLength(1)
  expect(s.spawned).toEqual([])
})

for (const placement of ['dock', 'inline'] as const) {
  test(`[${placement}] invalid definitions: an open pane lists them at the top, in the failure colour`, { options: { ...JA, ...MIXED } }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'segfault'
    await clock.advance(400)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'mine' })

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement } })
    const expected = placement === 'dock' ? 'error' : 'red'
    const heading = (await pane.findAll({ text: MESSAGES.ja.customProblemsHeading })).filter(f => f.type === 'Text')
    expect(heading.map(f => f.props.color)).toEqual([expected])
    const reasons = (await pane.findAll({ text: /^- #\d/ })).filter(f => f.type === 'Text')
    expect(reasons.map(f => f.text)).toEqual([
      expect.stringContaining('#1 (shell-look)'),
      expect.stringContaining('#3 (gpt)'),
    ])
    expect(reasons.map(f => f.props.color)).toEqual([expected, expected])
    expect(await pane.find({ text: 'answer from haiku' })).toBeDefined()
  })
}

test('broken JSON: the built-in default set shows, and the command tells why', { options: { ...JA, customActions: '[{"id": "mine",', actions: 'mine' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  expect(s.toasts).toHaveLength(1)
  expect(s.toasts[0]).toContain('customActions を JSON として読めません')
  s.selected = 'some text'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['💡', '🌐', '📝', '🔎', '✕'])
  await band.unmount()

  const r = await runCommand($, '')
  expect(s.models.map(m => m.model)).toEqual(['sonnet'])
  expect(JSON.stringify(r)).toContain('customActions を JSON として読めません')
})

test('a long ID left out: the command names its reason, not an unknown ID', { options: { ...EN, customActions: json([{ ...LOOK, id: `a${'-very'.repeat(10)}-long-id`, task: undefined }]) } }, async ($, on) => {
  const s = stage(on)
  await start($)
  const r = JSON.stringify(await runCommand($, `a${'-very'.repeat(10)}-long-id`))
  expect(r).toContain('cannot be used: its definition in customActions is invalid: the required field task is missing')
  expect(r).not.toContain('Unknown action ID')
  expect(s.spawned).toEqual([])
})

test('unset or all valid: the command and the toasts are as they were', { options: { ...JA, ...WITH_CUSTOM } }, async ($, on) => {
  const s = stage(on)
  await start($)
  expect(s.toasts).toEqual([])
  const r = await runCommand($, 'nope')
  expect(JSON.stringify(r)).not.toContain(MESSAGES.ja.customProblemsHeading)
  expect(s.toasts).toEqual([])
})
