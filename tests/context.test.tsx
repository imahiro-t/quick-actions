import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import { ACTIONS, actionsFor, isContext, isStandalone, markedIcon } from '../hooks/actions'
import { MESSAGES, answerStyle } from '../hooks/i18n'
import { BAND, EN, JA, JAPANESE, PANE, PICKER_PANE, listedOptions, pickAction, SURFACES, hintIcons, hintKinds, runCommand, showKind, stage, start } from './stage'
import type { Clock, HintKindName, Stage } from './stage'

// Context actions: on the conversation itself, with no selected text, a fork
// of the session. They share the hint line, the ⋯ dialog and the order with
// the actions on the selection, told apart by < > around the icon ([ ] for
// those on the selection); `/quick-actions hint` opens the hint line without
// a selection (the context actions alone) or with one (both kinds).
//
// The hint line shows one kind at a time (since SELM-00050), switched by its
// kind buttons: with a selection it opens on the actions on it, without one on
// the context actions.
//
// The engine stops answering a selection once a command has run; the stub
// does not, so every test that runs `/quick-actions hint` then clears
// `s.selected` and lets the poll see it, as the engine would have it.

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_000 * DAY
const at = (score: number) => ({ score, at: NOW })

const CONTEXT = [
  { id: 'recap', icon: '🧭', ja: '会話の要約' },
  { id: 'decisions', icon: '✅', ja: 'ここまでの決定事項' },
  { id: 'todo', icon: '📋', ja: '次にやること' },
  { id: 'open-questions', icon: '❓', ja: '未解決の疑問' },
  { id: 'simplify-last', icon: '🧸', ja: '直前の回答をやさしく' },
  { id: 'translate-last', icon: '🌐', ja: '直前の回答を翻訳' },
  { id: 'assumptions', icon: '🧱', ja: '前提・仮定の洗い出し' },
  { id: 'risks', icon: '⚠️', ja: 'リスク・懸念点' },
  { id: 'changed-files', icon: '🗂️', ja: '変更したファイルとその内容' },
  { id: 'next-questions', icon: '💭', ja: '次に聞くとよい質問' },
  { id: 'handoff', icon: '📝', ja: '引き継ぎメモ' },
  { id: 'recap-oneline', icon: '🪶', ja: '会話を一行で' },
  { id: 'recap-recent', icon: '🔁', ja: '直近のやりとりの要約' },
  { id: 'session-timeline', icon: '🕒', ja: '会話の経緯（時系列）' },
  { id: 'goal', icon: '🎯', ja: 'この会話の目的' },
  { id: 'my-requests', icon: '🙋', ja: '依頼ごとの対応状況' },
  { id: 'key-facts', icon: '📌', ja: '判明した事実' },
  { id: 'commands-run', icon: '📟', ja: '実行したコマンド' },
  { id: 'errors-seen', icon: '🧯', ja: '出たエラーと対処' },
  { id: 'files-read', icon: '📖', ja: '読んだファイル' },
  { id: 'failed-attempts', icon: '🔙', ja: 'うまくいかなかった試み' },
  { id: 'alternatives-considered', icon: '🔀', ja: '検討した代替案' },
  { id: 'constraints', icon: '📏', ja: '制約・要件の一覧' },
  { id: 'translate-last-en', icon: '🔤', ja: '直前の回答を英訳' },
  { id: 'translate-last-ja', icon: '🗾', ja: '直前の回答を日本語訳' },
  { id: 'summarize-last', icon: '📄', ja: '直前の回答を要約' },
  { id: 'tldr-last', icon: '⚡', ja: '直前の回答を一行で' },
  { id: 'explain-last', icon: '🔬', ja: '直前の回答を詳しく' },
  { id: 'example-last', icon: '📎', ja: '直前の回答の具体例' },
  { id: 'steps-last', icon: '🪜', ja: '直前の回答を手順に' },
  { id: 'table-last', icon: '📊', ja: '直前の回答を表に' },
  { id: 'diagram-last', icon: '🌳', ja: '直前の回答を図に' },
  { id: 'terms-last', icon: '🔠', ja: '直前の回答の用語解説' },
  { id: 'counter-last', icon: '🥊', ja: '直前の回答への反論' },
  { id: 'verify-last', icon: '🔍', ja: '直前の回答の確からしさ' },
  { id: 'caveats-last', icon: '🚸', ja: '直前の回答の注意点' },
  { id: 'alternatives-last', icon: '🚏', ja: '直前の回答の別解' },
  { id: 'questions-last', icon: '❔', ja: '直前の回答への確認質問' },
  { id: 'code-explain-last', icon: '💻', ja: '直前のコードを解説' },
  { id: 'command-explain-last', icon: '🐚', ja: '直前のコマンドを解説' },
  { id: 'error-explain-last', icon: '🚨', ja: '直前のエラーを解説' },
  { id: 'change-explain-last', icon: '🧾', ja: '直前の変更を解説' },
  { id: 'review-last', icon: '🧐', ja: '直前の変更のレビュー' },
  { id: 'next-move', icon: '👣', ja: '次の一手' },
  { id: 'blind-spots', icon: '🔦', ja: '見落としチェック' },
  { id: 'unstuck', icon: '🆘', ja: '行き詰まりの打開策' },
  { id: 'root-cause', icon: '🌱', ja: '原因の仮説' },
  { id: 'debug-plan', icon: '🐞', ja: 'デバッグの進め方' },
  { id: 'simpler-approach', icon: '🪄', ja: 'もっと簡単な方法' },
  { id: 'devil-advocate', icon: '😈', ja: 'あえて反対意見' },
  { id: 'premortem', icon: '🪦', ja: '失敗の事前検討' },
  { id: 'tradeoffs', icon: '🤝', ja: 'トレードオフ' },
  { id: 'scope-check', icon: '🧩', ja: 'スコープの確認' },
  { id: 'done-check', icon: '🏁', ja: '完了条件の確認' },
  { id: 'verify-plan', icon: '🩺', ja: '確認手順' },
  { id: 'rollback-plan', icon: '⏪', ja: '戻し方' },
  { id: 'impact', icon: '💥', ja: '影響範囲' },
  { id: 'effort-estimate', icon: '⏳', ja: '残作業の見積もり' },
  { id: 'task-dependencies', icon: '🧶', ja: '作業の依存関係' },
  { id: 'session-tests', icon: '🧪', ja: '会話のテスト観点' },
  { id: 'session-edge-cases', icon: '🧷', ja: '会話のエッジケース' },
  { id: 'session-security', icon: '🔐', ja: '会話のセキュリティ点検' },
  { id: 'session-perf', icon: '🚄', ja: '会話の性能点検' },
  { id: 'session-error-handling', icon: '🦺', ja: '会話のエラー処理点検' },
  { id: 'session-compat', icon: '🧬', ja: '会話の互換性点検' },
  { id: 'session-a11y', icon: '♿', ja: '会話のアクセシビリティ点検' },
  { id: 'session-i18n', icon: '🌏', ja: '会話の国際化点検' },
  { id: 'session-observability', icon: '🪵', ja: '会話のログ・監視点検' },
  { id: 'session-refactor', icon: '🔨', ja: '会話のリファクタリング案' },
  { id: 'session-tech-debt', icon: '🧹', ja: '会話で生じた技術的負債' },
  { id: 'session-docs', icon: '📚', ja: '会話の変更で要るドキュメント更新' },
  { id: 'session-naming', icon: '🪧', ja: '会話の新規要素の命名案' },
  { id: 'session-release-check', icon: '🚀', ja: '会話の変更のリリース前チェック' },
  { id: 'draft-commit', icon: '💾', ja: 'コミットメッセージ案' },
  { id: 'draft-pr', icon: '📬', ja: 'PR 説明文の下書き' },
  { id: 'draft-changelog', icon: '📰', ja: '変更履歴の下書き' },
  { id: 'draft-status', icon: '📣', ja: '進捗報告の下書き' },
  { id: 'draft-issue', icon: '🐛', ja: 'Issue の下書き' },
  { id: 'draft-review-request', icon: '🙏', ja: 'レビュー依頼文' },
  { id: 'draft-question', icon: '📨', ja: '質問文の下書き' },
  { id: 'draft-adr', icon: '📜', ja: '設計判断の記録（ADR）' },
  { id: 'draft-resume-prompt', icon: '🎬', ja: '再開用プロンプト' },
  { id: 'draft-stakeholder-update', icon: '👔', ja: '非エンジニア向け説明' },
  { id: 'draft-retro', icon: '🔄', ja: '振り返り（KPT）' },
  { id: 'learnings', icon: '🎓', ja: '今回の学び' },
  { id: 'session-glossary', icon: '📒', ja: '会話の用語集' },
  { id: 'concepts', icon: '🧠', ja: '押さえるべき概念' },
  { id: 'session-cheatsheet', icon: '📇', ja: '会話のチートシート' },
  { id: 'session-quiz', icon: '🎲', ja: '会話の理解度クイズ' },
  { id: 'session-faq', icon: '💁', ja: '会話の FAQ' },
  { id: 'study-next', icon: '🔖', ja: '会話から次に学ぶテーマ' },
  { id: 'session-keywords', icon: '🔑', ja: '会話のテーマの検索キーワード' },
  { id: 'tips', icon: '💡', ja: '会話で知った小技' },
  { id: 'mistakes', icon: '🙈', ja: 'Claude の誤り' },
  { id: 'prompt-tips', icon: '💬', ja: '指示の出し方の改善' },
  { id: 'claude-md-ideas', icon: '📐', ja: 'CLAUDE.md に書くとよいこと' },
  { id: 'contradictions', icon: '🔃', ja: '矛盾の検出' },
  { id: 'code-map', icon: '🏠', ja: '登場したコードの地図' },
  { id: 'workflow-diagram', icon: '🧵', ja: '作業の流れ図' },
  { id: 'environment', icon: '💽', ja: '環境情報の整理' },
  { id: 'packages', icon: '📦', ja: '追加・変更したパッケージ' },
  { id: 'links', icon: '🔗', ja: '登場した URL・資料' },
]

/** The hint line's icons, ✕ and ⋯ (the kind buttons left out), switched to `kind` first when one is given. */
const labelsOf = async ($: Engine, surface: (typeof SURFACES)[number] = 'terminal', kind?: HintKindName) => {
  const band = await $.ui.mount({ ...BAND, surface })
  if (kind !== undefined) await showKind(band, kind)
  const labels = (await hintIcons(band)).map(String)
  await band.unmount()
  return labels
}

/** `/quick-actions hint`, then the selection gone, as the engine has it after a command, and a poll. */
async function openHint($: Engine, s: Stage, clock: Clock) {
  const r = await runCommand($, 'hint')
  s.selected = null
  await clock.advance(400)
  return r
}

// ---------------------------------------------------------------------------
// The definitions

test('a hundred and two built-in context actions, as the tickets name them, in both languages', () => {
  const context = ACTIONS.filter(isContext).flatMap(a => (a.kind === 'fork' ? [a] : []))
  expect(context.map(a => a.id)).toEqual(CONTEXT.map(c => c.id))
  for (const [i, a] of context.entries()) {
    expect(a.icon).toBe(CONTEXT[i]!.icon)
    expect(a.label.ja).toBe(CONTEXT[i]!.ja)
    expect(a.label.en).not.toBe('')
    expect(a.label.en).not.toMatch(JAPANESE)
    expect(a.kind).toBe('fork')
    // On the conversation, with nothing guessed; the answer language comes at run time.
    expect(a.prompt).toContain('this conversation')
    expect(a.prompt).toContain('instead of guessing')
    expect(a.prompt).not.toContain('{STYLE}')
  }
  // Both languages resolve them, as context actions still.
  for (const lang of ['ja', 'en'] as const) {
    expect(actionsFor(lang).filter(isContext).map(a => a.id)).toEqual(CONTEXT.map(c => c.id))
  }
  // The translation decides its own target language, over the answer language.
  const last = context.find(a => a.id === 'translate-last')!
  expect(last.prompt).toContain('into natural English')
  expect(last.prompt).toContain('into natural Japanese')
  expect(last.prompt).toContain('takes precedence')
})

test('the marks: [icon] on the selection, <icon> on the conversation', () => {
  expect(markedIcon({ icon: '💡' })).toBe('[💡]')
  expect(markedIcon({ icon: '💡', target: 'selection' })).toBe('[💡]')
  expect(markedIcon({ icon: '🧭', target: 'context' })).toBe('<🧭>')
})

// ---------------------------------------------------------------------------
// /quick-actions hint

for (const surface of SURFACES) {
  test(`[${surface}] with nothing selected, /quick-actions hint shows the context actions alone, and ✕ closes it`, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await clock.advance(400)
    expect(await labelsOf($, surface)).toEqual([])

    const r = await openHint($, s, clock)
    expect(JSON.stringify(r)).toContain(MESSAGES.en.hintOpened)
    const labels = await labelsOf($, surface)
    // The context actions: the default set's first, then the rest in the order of definition; six in all.
    expect(labels).toEqual(['<🧭>', '<✅>', '<📋>', '<❓>', '<🧸>', '<🌐>', '✕', '⋯', '⛓️'])
    // With no text to run on, no kind button for the selection's actions; the standalone ones a press away.
    const kinds = await $.ui.mount({ ...BAND, surface })
    expect(await hintKinds(kinds)).toEqual(['context', 'standalone'])
    await kinds.unmount()
    expect((await labelsOf($, surface, 'standalone')).slice(0, 1)).toEqual(['{⏳}'])

    const band = await $.ui.mount({ ...BAND, surface })
    await band.press({ key: 'close' })
    await band.unmount()
    await clock.advance(400)
    expect(await labelsOf($, surface)).toEqual([])
    expect(s.forks).toEqual([])
  })
}

test('with text selected, /quick-actions hint keeps every kind though the command took the selection away', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'ECONNREFUSED 127.0.0.1:3306'
  await clock.advance(400)

  await openHint($, s, clock)
  await clock.advance(400)
  // It opens on the actions on the text it held; the other kinds a press away.
  expect(await labelsOf($)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '[🔤]', '[🀄]', '✕', '⋯', '⛓️'])
  expect((await labelsOf($, 'terminal', 'context')).slice(0, 2)).toEqual(['<🧭>', '<✅>'])
  await labelsOf($, 'terminal', 'selection')

  // An action on the selection runs on the text held as the command ran, and the line closes.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'explain' })
  await band.unmount()
  expect(s.models).toHaveLength(1)
  expect(s.models[0]?.prompt).toContain('<selected>')
  expect(s.models[0]?.prompt).toContain('ECONNREFUSED 127.0.0.1:3306')
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
})

test('a selection made after /quick-actions hint arms it: that selection going closes the line', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openHint($, s, clock)

  s.selected = 'exit 137'
  await clock.advance(400)
  expect(await labelsOf($)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '[🔤]', '[🀄]', '✕', '⋯', '⛓️'])

  s.selected = null
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
  // Closed for good: no selection keeps nothing open.
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
})

test('the selection held as the command ran, seen late by the poll, does not arm it', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  // Selected just now: no poll has seen it yet.
  s.selected = 'exit 137'
  await runCommand($, 'hint')
  // The next poll still sees it, before the engine lets go of it.
  await clock.advance(400)
  s.selected = null
  await clock.advance(400)
  // Its going closes nothing: the line stays, on the text it held.
  expect(await labelsOf($)).toEqual(['[💡]', '[🌐]', '[📝]', '[🔎]', '[🔤]', '[🀄]', '✕', '⋯', '⛓️'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'summarize' })
  await band.unmount()
  expect(s.models[0]?.prompt).toContain('exit 137')
})

// ---------------------------------------------------------------------------
// Running a context action

for (const [options, lang] of [[JA, 'ja'], [EN, 'en']] as const) {
  test(`[${lang}] a context action on the hint line forks the session with no selection, closes the line and shows "${MESSAGES[lang].onConversation}"`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await openHint($, s, clock)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'recap' })
    await band.unmount()
    await clock.settle()

    const recap = actionsFor(lang).find(a => a.id === 'recap')!
    if (recap.kind !== 'fork') throw new Error('recap is not a fork')
    expect(s.forks).toEqual([`${recap.prompt} ${answerStyle(lang)}`])
    expect(s.forks[0]).not.toContain('<selected>')
    expect(s.models).toEqual([])
    await clock.advance(400)
    expect(await labelsOf($)).toEqual([])

    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await pane.find({ text: MESSAGES[lang].onConversation })).toBeDefined()
    expect(await pane.find({ text: new RegExp(recap.label) })).toBeDefined()
    expect(await pane.find({ text: 'answer in context' })).toBeDefined()
    await pane.unmount()
  })
}

test('on a hint line drawn by a selection alone, a context action puts its icons away too', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'exit 137'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await showKind(band, 'context')
  await band.press({ key: 'decisions' })
  await band.unmount()
  expect(s.forks).toHaveLength(1)
  expect(s.forks[0]).not.toContain('exit 137')
  // The selection is still answered, yet its icons stay away.
  await clock.advance(400)
  expect(s.selected).toBe('exit 137')
  expect(await labelsOf($)).toEqual([])
})

test('opened by /quick-actions hint with a selection there now, a context action closes it as well', async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openHint($, s, clock)
  s.selected = 'exit 137'
  await clock.advance(400)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await showKind(band, 'context')
  await band.press({ key: 'recap' })
  await band.unmount()
  await clock.advance(400)
  expect(s.selected).toBe('exit 137')
  expect(await labelsOf($)).toEqual([])
})

test('/quick-actions recap runs with nothing selected', async ($, on) => {
  const s = stage(on)
  await start($)
  const r = await runCommand($, 'recap')
  expect(s.forks).toHaveLength(1)
  expect(s.forks[0]).not.toContain('<selected>')
  expect(s.toasts).toEqual([])
  expect(JSON.stringify(r)).toContain('Showing the Recap result')
})

// ---------------------------------------------------------------------------
// One order for both kinds

// One order by score; laid out for the moment (arrange): with a selection the
// actions on it first, so a context action used more than they are still
// waits behind them (changed with the standalone actions, SELM-00025: with a
// few hundred actions, scores alone would push the actions on the selection
// off the line while the person is selecting).
test('the usage scores order the kinds as one; with a selection, the actions on it come first', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const s = stage(on, { store: { usage: { recap: at(5), 'translate-ja': at(3), decisions: at(1) } } })
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  expect(await labelsOf($)).toEqual(['[🌐]', '[🔤]', '[🀄]', '[🏮]', '[🌏]', '[💃]', '✕', '⋯', '⛓️'])
  // Its context actions by the same scores, a press away.
  expect(await labelsOf($, 'terminal', 'context')).toEqual(['<🧭>', '<✅>', '<📋>', '<❓>', '<🧸>', '<🌐>', '✕', '⋯', '⛓️'])

  // With nothing selected, the same order with the context actions alone.
  s.selected = null
  await clock.advance(400)
  await openHint($, s, clock)
  expect(await labelsOf($)).toEqual(['<🧭>', '<✅>', '<📋>', '<❓>', '<🧸>', '<🌐>', '✕', '⋯', '⛓️'])
})

test('`pinActions` pins either kind', { options: { pinActions: 'recap,explain,handoff' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  // Each kind's pins lead it.
  expect(await labelsOf($)).toEqual(['[💡]', '[🌐]', '[🔤]', '[🀄]', '[🏮]', '[🌏]', '✕', '⋯', '⛓️'])
  expect(await labelsOf($, 'terminal', 'context')).toEqual(['<🧭>', '<📝>', '<✅>', '<📋>', '<❓>', '<🧸>', '✕', '⋯', '⛓️'])

  s.selected = null
  await clock.advance(400)
  await openHint($, s, clock)
  expect(await labelsOf($)).toEqual(['<🧭>', '<📝>', '<✅>', '<📋>', '<❓>', '<🧸>', '✕', '⋯', '⛓️'])
})

// ---------------------------------------------------------------------------
// The ⋯ dialog

test('the ⋯ dialog: both kinds, marked, with a selection; the context actions alone from the hint line without one', { options: JA }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'some text'
  await clock.advance(400)
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: '_more' })
  await band.unmount()

  let picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  let listed = await listedOptions(picker)
  // As many as the pane's height holds; the filter reaches the rest.
  expect(listed.length).toBeGreaterThan(0)
  expect(listed.length).toBeLessThan(ACTIONS.length)
  expect(listed.find(o => o.value === 'explain')?.label).toBe('[💡] 意味')
  for (const [id, label] of [['timer', '{⏳} タイマー'], ['handoff', '<📝> 引き継ぎメモ']] as const) {
    await picker.input({ key: '_filter', text: id, kind: 'change' })
    const found = await listedOptions(picker)
    expect(found.find(o => o.value === id)?.label).toBe(label)
  }
  await picker.press({ key: '_picker-close' })
  await picker.unmount()

  // No selection: `/quick-actions hint`, then its ⋯.
  s.selected = null
  await clock.advance(400)
  await openHint($, s, clock)
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: '_more' })
  await band.unmount()
  picker = await $.ui.mount({ ...PICKER_PANE, surface: 'terminal' })
  listed = await listedOptions(picker)
  // The context actions and the standalone ones: nothing that needs a selection. As many as the
  // pane's height holds; the filter reaches the rest.
  const free = [...CONTEXT.map(c => c.id), ...ACTIONS.filter(isStandalone).map(a => a.id)]
  expect(listed.length).toBeGreaterThan(0)
  expect(listed.length).toBeLessThanOrEqual(free.length)
  for (const o of listed) expect(free).toContain(o.value)
  await picker.input({ key: '_filter', text: 'session-release-check', kind: 'change' })
  const reached = await listedOptions(picker)
  expect(reached.map(o => o.value)).toContain('session-release-check')
  await picker.input({ key: '_filter', text: '', kind: 'change' })
  await pickAction(picker, 'todo')
  await picker.unmount()
  expect(s.forks).toHaveLength(1)
  expect(s.forks[0]).toContain('to-do list')
  // A pick closes the hint line too.
  await clock.advance(400)
  expect(await labelsOf($)).toEqual([])
})

// ---------------------------------------------------------------------------
// Custom context actions

const STANDUP = {
  id: 'standup',
  icon: '📣',
  label: { ja: '進捗報告', en: 'Status update' },
  kind: 'fork',
  target: 'context',
  prompt: 'Write a short status update on this session.',
}
const PIRATE = { id: 'pirate', icon: '🦜', label: 'Pirate talk', kind: 'fork', prompt: 'Retell the selected text the way a pirate would.' }

test('a custom context action runs with no selection, marked < >; one with no target waits for a selection', { options: { customActions: JSON.stringify([STANDUP, PIRATE]), pinActions: 'standup,pirate' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  await openHint($, s, clock)
  const labels = await labelsOf($)
  expect(labels[0]).toBe('<📣>')
  expect(labels).not.toContain('[🦜]')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'standup' })
  await band.unmount()
  expect(s.forks).toEqual([`Write a short status update on this session. ${answerStyle('en')}`])

  // With a selection, the one with no target is an action on it.
  s.selected = 'segfault'
  await clock.advance(400)
  expect((await labelsOf($)).slice(0, 1)).toEqual(['[🦜]'])
  expect((await labelsOf($, 'terminal', 'context')).slice(0, 1)).toEqual(['<📣>'])
})
