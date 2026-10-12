import { expect, mock, test } from './kit'
import type { Engine } from 'claude-code/testing'

import { MESSAGES } from '../hooks/i18n'
import { BAND, EN, JA, PANE, reselect, stage, start } from './stage'
import type { Clock, Stage } from './stage'

// A model's answer and the heading's quote in the result pane (SELM-00090):
// hidden characters shown escaped, as a decoder's output is, with its note.
// Invisible characters are written as \u{...} escapes here, never raw.

const RLO = '\u{202e}'
const ESC = '\u{1b}'
const NOTE = {
  en: '(Control, bidirectional, zero-width and other invisible characters, tag characters and stray variation selectors are shown escaped, as \\u001b; a backslash in the text is shown as \\\\.)',
  ja: '（制御文字・双方向制御文字・ゼロ幅文字などの不可視文字・タグ文字・余分な異体字セレクタは \\u001b のような形で、元のテキストのバックスラッシュは \\\\ と表示しています）',
} as const

/** Selects `text` and presses `id` on the hint line. */
async function press($: Engine, s: Stage, clock: Clock, text: string, id: string) {
  s.selected = text
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await reselect(s, clock)
  await band.press({ key: id })
  await band.unmount()
}

/** The texts the result pane draws, each Text's whole text. */
async function paneTexts($: Engine): Promise<string[]> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await pane.findAll({ type: 'Text' })).map(f => f.text)
  await pane.unmount()
  return texts
}

for (const [options, lang] of [[EN, 'en'], [JA, 'ja']] as const) {
  test(`[${lang}] complete: an answer with hidden characters is drawn escaped, with the note`, { options }, async ($, on) => {
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    s.answerText = `  Use **this**: \`x${RLO}y\`\r\n${ESC}[31mred C:\\tmp  `
    await press($, s, clock, 'Permission denied (publickey)', 'explain')

    const texts = await paneTexts($)
    const answer = `Use **this**: \`x\\u202ey\`\n\\u001b[31mred C:\\\\tmp\n\n${NOTE[lang]}`
    expect(texts).toContain(answer)
    // Nothing hidden reaches the pane raw (a raw ESC would have the engine refuse the tree).
    for (const t of texts) expect(t).not.toMatch(/[\u{1b}\u{202e}\r]/u)
  })
}

test('fork: the answer in context is shown the same way', { options: { ...EN, pinActions: 'ask' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.answerText = `in context ${RLO}`
  await press($, s, clock, 'exit 137', 'ask')
  expect(await paneTexts($)).toContain(`in context \\u202e\n\n${NOTE.en}`)
})

test('complete: an answer with nothing hidden is drawn as it is, backslashes and markdown alike, no note', { options: EN }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.answerText = '# Fix\n\n- run `grep -E "\\d+"`\n\n```sh\necho C:\\tmp\n```'
  await press($, s, clock, 'Permission denied (publickey)', 'explain')
  const texts = await paneTexts($)
  expect(texts).toContain(s.answerText)
  expect(texts.some(t => t.includes(NOTE.en))).toBe(false)
})

// A subagent's answer comes through turn.complete, settled by the same
// showHiddenNoted (hooks/register.tsx). Its agent id is set by core alone, so
// a test cannot run one through the pane (see kinds.test.tsx); the helper
// itself is checked in selection-local.test.tsx.

for (const [options, lang] of [[EN, 'en'], [JA, 'ja']] as const) {
  test(`[${lang}] the heading quotes the selection with its hidden characters escaped`, { options }, async ($, on) => {
    const t = MESSAGES[lang]
    const clock = mock.clock(on)
    const s = stage(on)
    await start($)
    await press($, s, clock, `exe.${RLO}gpj\nC:\\x`, 'explain')
    const texts = await paneTexts($)
    expect(texts.some(x => x.includes(t.quote('exe.\\u202egpj C:\\\\x')))).toBe(true)
    for (const x of texts) expect(x).not.toMatch(/\u{202e}/u)
    // The selection itself goes to the model as it is.
    expect(s.models[0]?.prompt).toContain(`exe.${RLO}gpj`)
  })
}
