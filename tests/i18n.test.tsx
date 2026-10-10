import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor } from '../hooks/actions'
import { MESSAGES, explicitLanguage, resolveLanguage } from '../hooks/i18n'
import { ANSWER_LANGUAGE_ONLY, BAND, EN, JA, JAPANESE, NO_STYLE, PANE, PLUGIN, SURFACES, reselect, runCommand, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// ---------------------------------------------------------------------------
// resolveLanguage: the setting, then Claude Code's language, then the locale.

test('resolveLanguage: an explicit ja or en wins over everything detected', () => {
  const japanese = { claudeLanguage: 'japanese', LANG: 'ja_JP.UTF-8' }
  const english = { claudeLanguage: 'english', LANG: 'en_US.UTF-8' }
  expect(resolveLanguage('en', japanese)).toBe('en')
  expect(resolveLanguage(' EN ', japanese)).toBe('en')
  expect(resolveLanguage('ja', english)).toBe('ja')
  expect(resolveLanguage(' Ja', english)).toBe('ja')
  expect(explicitLanguage('JA')).toBe('ja')
  expect(explicitLanguage('auto')).toBeUndefined()
})

test('resolveLanguage: auto, empty and unknown values detect', () => {
  const japanese = { LANG: 'ja_JP.UTF-8' }
  for (const setting of ['auto', 'AUTO', '', '  ', 'fr', 'xx', 42, undefined, null]) {
    expect(resolveLanguage(setting, japanese)).toBe('ja')
    expect(resolveLanguage(setting, {})).toBe('en')
  }
})

test("resolveLanguage: Claude Code's language setting decides on its own", () => {
  for (const v of ['japanese', 'Japanese', '日本語', 'ja', 'ja-JP', 'nihongo']) {
    expect(resolveLanguage('auto', { claudeLanguage: v, LANG: 'en_US.UTF-8' })).toBe('ja')
  }
  // Not Japanese: English, even with a Japanese locale; `javanese` is no `ja`.
  for (const v of ['english', 'French', 'javanese', 'jav']) {
    expect(resolveLanguage('auto', { claudeLanguage: v, LANG: 'ja_JP.UTF-8' })).toBe('en')
  }
  // Empty or not a string: the locale decides.
  expect(resolveLanguage('auto', { claudeLanguage: '', LANG: 'ja_JP.UTF-8' })).toBe('ja')
  expect(resolveLanguage('auto', { claudeLanguage: 7, LANG: 'ja_JP.UTF-8' })).toBe('ja')
})

test('resolveLanguage: the locale in POSIX order, LC_ALL then LC_MESSAGES then LANG', () => {
  expect(resolveLanguage('auto', { LC_ALL: 'ja_JP.UTF-8' })).toBe('ja')
  expect(resolveLanguage('auto', { LANG: 'ja_JP.UTF-8' })).toBe('ja')
  expect(resolveLanguage('auto', { LANG: 'ja' })).toBe('ja')
  expect(resolveLanguage('auto', { LC_ALL: 'en_US.UTF-8', LANG: 'ja_JP.UTF-8' })).toBe('en')
  expect(resolveLanguage('auto', { LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'en_US.UTF-8' })).toBe('ja')
  expect(resolveLanguage('auto', { LC_ALL: '', LANG: 'ja_JP.UTF-8' })).toBe('ja')
  expect(resolveLanguage('auto', { LANG: 'C' })).toBe('en')
  expect(resolveLanguage('auto', { LANG: 'POSIX' })).toBe('en')
  expect(resolveLanguage('auto', {})).toBe('en')
})

test('resolveLanguage never throws', () => {
  const odd: unknown[] = [undefined, null, 0, {}, [], { ja: 1 }, Symbol('x')]
  for (const setting of odd) {
    for (const hints of odd) {
      const l = resolveLanguage(setting, hints as never)
      expect(['ja', 'en']).toContain(l)
    }
    expect(['ja', 'en']).toContain(resolveLanguage('auto', { claudeLanguage: setting, LC_ALL: setting, LANG: setting }))
  }
})

// ---------------------------------------------------------------------------
// What the person reads, in each language.

const texts = async (ui: { findAll: (q: { type: string }) => Promise<readonly { text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text)

/** Runs one icon of each kind (and a failure of each) so every pane text is drawn. */
const fillPane = async ($: Engine, s: Stage, clock: Clock, surface: (typeof SURFACES)[number]) => {
  const band = await $.ui.mount({ ...BAND, surface })
  await reselect(s, clock)
  await band.press({ key: 'explain' })
  await reselect(s, clock)
  await band.press({ key: 'ask' })
  await reselect(s, clock)
  await band.press({ key: 'code' })
  s.answer = 'empty'
  await reselect(s, clock)
  await band.press({ key: 'explain' })
  s.refuse = 'rate limited'
  await reselect(s, clock)
  await band.press({ key: 'ask' })
  s.refuse = null
  s.spawnDeny = 'not allowed here'
  await reselect(s, clock)
  await band.press({ key: 'code' })
  await band.unmount()
}

for (const surface of SURFACES) {
  test(
    `[${surface}] en: the hint line, the pane, the command and the toast are in English`,
    { options: { ...EN, actions: 'explain,translate-ja,code,ask,why' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)

      // Registered in English: the command and the subagent types.
      expect(s.commands).toEqual([{ name: PLUGIN, description: MESSAGES.en.commandDescription }])

      // Nothing selected: the empty pane, and the toast for an action on the selection.
      let pane = await $.ui.mount({ ...PANE, surface })
      expect(await pane.find({ text: MESSAGES.en.emptyPane })).toBeDefined()
      await pane.unmount()
      pane = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, placement: 'inline' } })
      expect(await pane.find({ text: MESSAGES.en.inlineHint })).toBeDefined()
      await pane.unmount()
      const none = await runCommand($, 'explain')
      expect(s.toasts).toEqual(['No text is selected'])
      expect(JSON.stringify(none)).toContain(MESSAGES.en.noSelection)

      s.selected = 'segfault at 0x0'
      await clock.advance(400)

      // The hover labels.
      const band = await $.ui.mount({ ...BAND, surface })
      for (const label of ['Explain', 'To Japanese', 'Find the code', 'Ask Claude', 'Why so']) {
        expect(await band.find({ text: new RegExp(label) })).toBeDefined()
      }
      expect((await texts(band)).join('\n')).not.toMatch(JAPANESE)
      await band.unmount()

      await fillPane($, s, clock, surface)
      pane = await $.ui.mount({ ...PANE, surface })
      const shown = (await texts(pane)).join('\n')
      expect(shown).toContain('Explain "segfault at 0x0"')
      expect(shown).toContain('No answer (empty-reply)')
      expect(shown).toMatch(/Failed: \S.*rate limited/)
      expect(shown).toContain('Could not start: not allowed here')
      expect(shown).not.toMatch(JAPANESE)

      // The command's answers.
      const ran = await runCommand($, 'translate-ja')
      expect(JSON.stringify(ran)).toContain('Showing the To Japanese result in the Quick Actions pane.')
      const unknown = await runCommand($, 'nope')
      expect(JSON.stringify(unknown)).toContain('Unknown action ID: nope. Run /quick-actions (no ID) to search the list')
      for (const r of [none, ran, unknown]) expect(JSON.stringify(r)).not.toMatch(JAPANESE)
      expect(s.toasts.join('\n')).not.toMatch(JAPANESE)

      // The subagent types say what they are for in English.
      expect(s.registered.map(r => r.name)).toEqual(['code'])
      for (const r of s.registered) expect(r.description).not.toMatch(JAPANESE)
    },
  )

  test(
    `[${surface}] ja: the same places read in Japanese, as before the setting`,
    { options: { ...JA, actions: 'explain,translate-ja,code,ask,why' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      expect(s.commands).toEqual([{ name: PLUGIN, description: MESSAGES.ja.commandDescription }])

      const none = await runCommand($, 'explain')
      expect(s.toasts).toEqual(['選択されたテキストがありません'])
      expect(JSON.stringify(none)).toContain(MESSAGES.ja.noSelection)

      s.selected = 'segfault at 0x0'
      await clock.advance(400)
      const band = await $.ui.mount({ ...BAND, surface })
      for (const label of ['意味', '日本語訳', 'コードの根拠', 'Claudeに聞く', '根拠を説明']) {
        expect(await band.find({ text: new RegExp(label) })).toBeDefined()
      }
      await band.unmount()

      await fillPane($, s, clock, surface)
      const pane = await $.ui.mount({ ...PANE, surface })
      const shown = (await texts(pane)).join('\n')
      expect(shown).toContain('意味 「segfault at 0x0」')
      expect(shown).toContain('回答なし (empty-reply)')
      expect(shown).toMatch(/失敗しました: \S.*rate limited/)
      expect(shown).toContain('起動できませんでした: not allowed here')

      const unknown = await runCommand($, 'nope')
      expect(JSON.stringify(unknown)).toContain('不明なアクション ID です: nope。/quick-actions（ID なし）で一覧から検索できます')
    },
  )
}

test('the subagents\' running texts exist in both languages', () => {
  const running = (lang: 'ja' | 'en') => actionsFor(lang).flatMap(a => (a.runningText === undefined ? [] : [a.runningText]))
  expect(running('en')).toEqual(['Searching the repository…', 'Checking the web…'])
  expect(running('ja')).toEqual(['リポジトリを調査中…', 'Webで調査中…'])
})

for (const [options, thinking] of [
  [EN, 'Thinking…'],
  [JA, '考え中…'],
] as const) {
  test(`[${options.language}] a running call shows "${thinking}" until it answers`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.selected = 'exit 137'
    await clock.advance(400)

    let release = () => {}
    s.hold = new Promise<void>(resolve => (release = resolve))
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const pressed = band.press({ key: 'explain' })
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ text: thinking })).toBeDefined()

    release()
    await pressed
    expect(await pane.find({ text: thinking })).toBeUndefined()
    expect(await pane.find({ text: 'answer from sonnet' })).toBeDefined()
  })
}

// ---------------------------------------------------------------------------
// What the model is asked to answer in.

const everyId = ACTIONS.map(a => a.id).join(',')

for (const language of ['en', 'ja'] as const) {
  const name = language === 'en' ? 'English' : 'Japanese'
  const other = language === 'en' ? 'Japanese' : 'English'

  test(
    `[${language}] every action asks for an answer in ${name}, translations aside`,
    { options: { language, actions: everyId, hintCount: String(ACTIONS.length) }, timeoutMs: 30_000 },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'const x = 1'
      await clock.advance(400)

      const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
      for (const a of ACTIONS) {
        await reselect(s, clock)
        await band.press({ key: a.id })
      }
      await band.unmount()

      const systems = new Map(
        actionsFor(language)
          .filter(a => a.kind === 'complete')
          .map((a, i) => [a.id, s.models[i]?.system ?? ''] as const),
      )
      for (const [id, system] of systems) {
        // A translation or a converted text asks for no answer style; never for the other language either.
        if (NO_STYLE.includes(id)) {
          expect(system).not.toContain(`Answer in ${other}`)
          // Those with a short note name its language: this one, never the other.
          if (ANSWER_LANGUAGE_ONLY.includes(id)) {
            expect(system).toContain(`in ${name}`)
            expect(system).not.toContain(`in ${other}`)
          }
          continue
        }
        expect(system).not.toContain(`Answer in ${other}`)
        expect(system).not.toContain(`in ${other}.`)
        expect(system).toContain(`Answer in ${name}`)
      }
      for (const fork of s.forks) {
        expect(fork).toContain(`Answer in ${name}`)
        expect(fork).not.toContain(`Answer in ${other}`)
      }
      expect(s.forks).toHaveLength(ACTIONS.filter(a => a.kind === 'fork').length)
      for (const r of s.registered) {
        expect(r.prompt).toContain(`Answer in ${name}`)
        expect(r.prompt).not.toContain(`Answer in ${other}`)
      }
      expect(s.registered).toHaveLength(ACTIONS.filter(a => a.kind === 'subagent').length)
      // Nothing is left of the placeholders.
      for (const text of [...s.models.map(m => m.system ?? ''), ...s.forks, ...s.registered.map(r => r.prompt)]) {
        expect(text).not.toMatch(/\{STYLE\}|\{ANSWER_LANGUAGE\}/)
      }
    },
  )

  test(
    `[${language}] the translations keep their target language; only the labels follow the setting`,
    { options: { language, actions: 'translate-ja,translate-en' } },
    async ($, on) => {
      const clock = mock.clock(on)
      const s = stage(on)
      await start($)
      s.selected = 'hello'
      await clock.advance(400)

      const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
      const labels = language === 'en' ? ['To Japanese', 'To English'] : ['日本語訳', '英訳']
      for (const label of labels) expect(await band.find({ text: new RegExp(label) })).toBeDefined()
      await reselect(s, clock)
      await band.press({ key: 'translate-ja' })
      await reselect(s, clock)
      await band.press({ key: 'translate-en' })
      await band.unmount()

      expect(s.models[0]?.system).toContain('into natural Japanese')
      expect(s.models[1]?.system).toContain('into natural English')
      for (const m of s.models) expect(m.system).not.toContain('Answer in')
    },
  )
}

// ---------------------------------------------------------------------------
// auto: Claude Code's language, then the locale, then English.

const emptyPaneIn = async ($: Engine) => {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const ja = await pane.find({ text: MESSAGES.ja.emptyPane })
  const en = await pane.find({ text: MESSAGES.en.emptyPane })
  await pane.unmount()
  return ja !== undefined && en === undefined ? 'ja' : en !== undefined && ja === undefined ? 'en' : 'neither'
}

test('auto: a Japanese LANG shows Japanese', async ($, on) => {
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  stage(on)
  await start($)
  expect(await emptyPaneIn($)).toBe('ja')
})

test('auto: an English LANG shows English', async ($, on) => {
  mock.env(on, { LANG: 'en_US.UTF-8' })
  stage(on)
  await start($)
  expect(await emptyPaneIn($)).toBe('en')
})

test('auto: with no settings and no locale at all, English', async ($, on) => {
  const s = stage(on)
  await start($)
  expect(await emptyPaneIn($)).toBe('en')
  expect(s.settingsReads).toBe(1)
})

test("auto: Claude Code's language setting wins over the locale", async ($, on) => {
  mock.env(on, { LANG: 'en_US.UTF-8' })
  const s = stage(on)
  s.settings = { language: 'japanese' }
  await start($)
  expect(await emptyPaneIn($)).toBe('ja')
})

test('auto: a refused settings read falls through to the locale', async ($, on) => {
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  const s = stage(on)
  s.settingsDeny = 'not readable here'
  await start($)
  expect(await emptyPaneIn($)).toBe('ja')
})

// A value outside the field's options counts as unset, so as the default `auto`.
test('auto: an unknown language value is auto', { options: { language: 'xx' } }, async ($, on) => {
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  stage(on)
  await start($)
  expect(await emptyPaneIn($)).toBe('ja')
})

test('an explicit language never reads the settings', { options: EN }, async ($, on) => {
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  const s = stage(on)
  s.settings = { language: 'japanese' }
  await start($)
  expect(await emptyPaneIn($)).toBe('en')
  expect(s.settingsReads).toBe(0)
})

// ---------------------------------------------------------------------------
// The language is settled by whichever hook comes first, not by session.start.

test('auto, before session.start: the pane is drawn in the detected language from the first draw', async ($, on) => {
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  stage(on)
  expect(await emptyPaneIn($)).toBe('ja')
})

test('auto, before session.start: the command answers in the detected language', async ($, on) => {
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  const s = stage(on)
  const r = await runCommand($, 'nope')
  expect(JSON.stringify(r)).toContain('不明なアクション ID です: nope')
  await runCommand($, 'explain')
  expect(s.toasts).toEqual(['選択されたテキストがありません'])
})

// The hint line has no counterpart here: its icons wait for the selection
// poll, which session.start starts, so before it the line draws nothing of
// its own. Its labels are covered with session.start above.

test('auto: hooks arriving together detect once', async ($, on) => {
  mock.clock(on)
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  const s = stage(on)
  const [pane] = await Promise.all([$.ui.mount({ ...PANE, surface: 'terminal' }), runCommand($, 'nope'), start($)])
  await pane.unmount()
  expect(s.settingsReads).toBe(1)
  await emptyPaneIn($)
  await runCommand($, 'nope')
  expect(s.settingsReads).toBe(1)
})

// A reload loads the module afresh with the new options: nothing from the
// previous load's language carries over (each test registers the module anew).
test('reload, first load: auto on a Japanese locale', async ($, on) => {
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  stage(on)
  await start($)
  expect(await emptyPaneIn($)).toBe('ja')
})

test('reload, next load: switched to en, the same locale shows English', { options: EN }, async ($, on) => {
  mock.env(on, { LANG: 'ja_JP.UTF-8' })
  stage(on)
  await start($)
  expect(await emptyPaneIn($)).toBe('en')
})

test('reload, next load: back to auto, detected again', async ($, on) => {
  mock.env(on, { LANG: 'en_US.UTF-8' })
  const s = stage(on)
  await start($)
  expect(await emptyPaneIn($)).toBe('en')
  expect(s.settingsReads).toBe(1)
})
