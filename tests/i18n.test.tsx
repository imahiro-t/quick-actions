import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor, takesArg } from '../hooks/actions'
import { MESSAGES, explicitLanguage, resolveLanguage } from '../hooks/i18n'
import { HINT_KINDS, ofKind } from '../hooks/order'
import { ANSWER_LANGUAGE_ONLY, BAND, EVERY_ACTION_FITS, EN, JA, JAPANESE, NO_STYLE, PANE, PLUGIN, SURFACES, reselect, runCommand, showKind, stage, start, submitArg } from './stage'
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
    { options: { ...EN, pinActions: 'explain,translate-ja,code,ask,why' } },
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
    { options: { ...JA, pinActions: 'explain,translate-ja,code,ask,why' } },
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
  // code, web-check, then find-usages, find-tests (the repository) and official-docs, search-error, package-info (the web),
  // then the seven standalone repository surveys (repo-overview to repo-onboarding).
  const repo = { en: 'Searching the repository…', ja: 'リポジトリを調査中…' }
  const web = { en: 'Checking the web…', ja: 'Webで調査中…' }
  for (const lang of ['en', 'ja'] as const) {
    expect(running(lang)).toEqual([repo, web, repo, repo, web, web, web, ...Array(7).fill(repo)].map(t => t[lang]))
  }
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

// Pressed a kind at a time (SELM-00070), each kind's actions pinned alone,
// so that no one test presses all 313 under a loaded machine's timeout; the
// three kinds together press every action (checked below).
test('the answer-language runs by kind together press every action once: none left out, none twice', () => {
  const pressed = HINT_KINDS.flatMap(kind => ofKind(ACTIONS, kind).map(a => a.id))
  expect(pressed).toHaveLength(313)
  expect(new Set(pressed).size).toBe(313)
  expect([...pressed].sort()).toEqual(ACTIONS.map(a => a.id).sort())
  // So the complete, fork and subagent actions each test checks add up to all of them.
  for (const k of ['complete', 'fork', 'subagent'] as const) {
    expect(HINT_KINDS.reduce((sum, kind) => sum + ofKind(ACTIONS, kind).filter(a => a.kind === k).length, 0)).toBe(ACTIONS.filter(a => a.kind === k).length)
  }
  // In both languages the same actions, in the same order, of the same kind.
  for (const language of ['en', 'ja'] as const) {
    for (const kind of HINT_KINDS) expect(ofKind(actionsFor(language), kind).map(a => a.id)).toEqual(ofKind(ACTIONS, kind).map(a => a.id))
  }
})

for (const language of ['en', 'ja'] as const) {
  const name = language === 'en' ? 'English' : 'Japanese'
  const other = language === 'en' ? 'Japanese' : 'English'

  for (const kind of HINT_KINDS) {
    const actions = ofKind(ACTIONS, kind)
    test(
      `[${language}] every ${kind} action asks for an answer in ${name}, translations aside`,
      { options: { language, pinActions: actions.map(a => a.id).join(',') }, timeoutMs: 90_000 },
      async ($, on) => {
        const clock = mock.clock(on)
        const s = stage(on)
        await start($)
        s.selected = 'const x = 1'
        await clock.advance(400)

        const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: EVERY_ACTION_FITS })
        for (const a of actions) {
          await reselect(s, clock)
          // One kind at a time on the line (SELM-00050), and a run puts it back on the selection's:
          // the others are switched to each time.
          if (kind !== 'selection') await showKind(band, kind)
          await band.press({ key: a.id })
          // One that takes an argument asks for it first: Enter with the field empty, its default.
          if (takesArg(a)) await submitArg($)
        }
        await band.unmount()

        // Each complete action asked the model once, in the order pressed.
        const completes = ofKind(actionsFor(language), kind).filter(a => a.kind === 'complete')
        expect(s.models).toHaveLength(completes.length)
        const systems = new Map(completes.map((a, i) => [a.id, s.models[i]?.system ?? ''] as const))
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
        expect(s.forks).toHaveLength(actions.filter(a => a.kind === 'fork').length)
        // A subagent is registered as it is first pressed: this kind's, each once.
        for (const r of s.registered) {
          expect(r.prompt).toContain(`Answer in ${name}`)
          expect(r.prompt).not.toContain(`Answer in ${other}`)
        }
        expect(s.registered.map(r => r.name)).toEqual(actions.filter(a => a.kind === 'subagent').map(a => a.id))
        // Nothing is left of the placeholders.
        for (const text of [...s.models.map(m => m.system ?? ''), ...s.forks, ...s.registered.map(r => r.prompt)]) {
          expect(text).not.toMatch(/\{STYLE\}|\{ANSWER_LANGUAGE\}/)
        }
      },
    )
  }

  test(
    `[${language}] the translations keep their target language; only the labels follow the setting`,
    { options: { language, pinActions: 'translate-ja,translate-en' } },
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
