// The display and answer language: which one the `language` setting picks,
// and every string the person reads, in both. Nothing here throws.

export type Lang = 'ja' | 'en'

/** A string in both languages. */
export type Localized = { ja: string; en: string }

/** What `resolveLanguage` reads besides the setting: Claude Code's own `language`, then the locale. */
export type LanguageHints = {
  claudeLanguage?: unknown
  LC_ALL?: unknown
  LC_MESSAGES?: unknown
  LANG?: unknown
}

// `ja` alone or followed by a separator (`ja_JP.UTF-8`, `ja-JP`), never the
// start of another word (`javanese`).
const JA_LOCALE = /^ja([-_.@]|$)/i
const JA_LANGUAGE = /^(ja([-_.@]|$)|japanese|日本語|nihongo)/i

const nonEmpty = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

/** `ja` or `en` when the setting names one (case and spaces aside); anything else is `auto`. */
export function explicitLanguage(setting: unknown): Lang | undefined {
  const v = nonEmpty(setting)?.toLowerCase()
  return v === 'ja' || v === 'en' ? v : undefined
}

/**
 * The language to use: the setting when it names `ja` or `en`; else Claude
 * Code's `language` setting when it has one (Japanese or not); else the first
 * locale variable set, in POSIX order (LC_ALL, LC_MESSAGES, LANG); else English.
 */
export function resolveLanguage(setting: unknown, hints: LanguageHints): Lang {
  const explicit = explicitLanguage(setting)
  if (explicit !== undefined) return explicit

  const h = hints !== null && typeof hints === 'object' ? hints : {}
  const claude = nonEmpty(h.claudeLanguage)
  if (claude !== undefined) return JA_LANGUAGE.test(claude) ? 'ja' : 'en'

  const locale = nonEmpty(h.LC_ALL) ?? nonEmpty(h.LC_MESSAGES) ?? nonEmpty(h.LANG)
  return locale !== undefined && JA_LOCALE.test(locale) ? 'ja' : 'en'
}

export type Messages = {
  thinking: string
  couldNotStart: (reason: string) => string
  noAnswer: (reason: string) => string
  failed: (reason: string) => string
  noSelection: string
  unknownId: (id: string, ids: readonly string[]) => string
  showing: (pane: string, label: string) => string
  commandDescription: string
  emptyPane: string
  inlineHint: string
  quote: (text: string) => string
  /** The answer language and style appended to an action's instructions to the model. */
  answerStyle: string
  /** The language's name in English, for instructions such as "explain the changes in …". */
  languageName: string
  agentDescription: (label: string) => string
}

export const MESSAGES: Record<Lang, Messages> = {
  ja: {
    thinking: '考え中…',
    couldNotStart: reason => `起動できませんでした: ${reason}`,
    noAnswer: reason => `回答なし (${reason})`,
    failed: reason => `失敗しました: ${reason}`,
    noSelection: '選択されたテキストがありません',
    unknownId: (id, ids) => `不明なアクション ID です: ${id}（使える ID: ${ids.join(', ')}）`,
    showing: (pane, label) => `${pane} ペインに ${label} の結果を表示します。`,
    commandDescription:
      'トランスクリプトで選択中のテキストにアクションを実行します（省略時はヒント行の先頭のアクション）',
    emptyPane: 'テキストを選択して、プロンプト下のヒント行のアイコンを押してください。',
    inlineHint: 'ターミナル幅を 110 桁以上にすると、このペインは右側に表示されます（フルスクリーン表示時）。',
    quote: text => `「${text}」`,
    answerStyle: 'Answer in Japanese, in plain prose suited to a terminal pane (no headings, no tables).',
    languageName: 'Japanese',
    agentDescription: label => `選択テキストの${label}（selection-actions 専用）`,
  },
  en: {
    thinking: 'Thinking…',
    couldNotStart: reason => `Could not start: ${reason}`,
    noAnswer: reason => `No answer (${reason})`,
    failed: reason => `Failed: ${reason}`,
    noSelection: 'No text is selected',
    unknownId: (id, ids) => `Unknown action ID: ${id} (available IDs: ${ids.join(', ')})`,
    showing: (pane, label) => `Showing the ${label} result in the ${pane} pane.`,
    commandDescription:
      'Run a selection action on the text selected in the transcript (default: the first enabled action)',
    emptyPane: 'Select some text, then press an icon on the hint line below the prompt.',
    inlineHint: 'Widen the terminal to 110 columns or more to show this pane on the right (in fullscreen).',
    quote: text => `"${text}"`,
    answerStyle: 'Answer in English, in plain prose suited to a terminal pane (no headings, no tables).',
    languageName: 'English',
    agentDescription: label => `${label} for the selected text (selection-actions only)`,
  },
}
