// The display and answer language: which one the `language` setting picks,
// and every string the person reads, in both. Nothing here throws.

import type { CustomReason } from './custom'

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
  /** The hover label of the hint line's ✕ button. */
  close: string
  /** The language's name in English, for instructions to the model such as "explain the changes in …". */
  languageName: string
  agentDescription: (label: string) => string
  /** Why a custom definition (or the whole `customActions` setting) was left out. */
  customReason: (reason: CustomReason) => string
  /** Heads the list of problems after a command's result and at the top of the pane. */
  customProblemsHeading: string
  /** The toast at session start when the setting has problems: how many, and the first one. */
  customIgnoredToast: (count: number, first: string) => string
  /** The command's result for an ID whose custom definition was left out. */
  customIgnoredId: (id: string, reason: string) => string
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
    close: '閉じる',
    languageName: 'Japanese',
    agentDescription: label => `選択テキストの${label}（selection-actions 専用）`,
    customReason: r => {
      switch (r.code) {
        case 'json':
          return `customActions を JSON として読めません（定義をすべて無視しました）: ${r.detail}`
        case 'notArray':
          return 'customActions が JSON の配列ではありません（定義をすべて無視しました）'
        case 'notString':
          return 'customActions は文字列で書いてください。settings.json では JSON の配列を引用符で囲み、中の引用符をエスケープします（定義をすべて無視しました）'
        case 'notObject':
          return '定義がオブジェクトではありません'
        case 'idFormat':
          return 'id は小文字の英数字とハイフンで書いてください（例: review-pr）'
        case 'idReserved':
          return 'id が標準アクションまたは close と重なっています'
        case 'idDuplicate':
          return 'id が先にあるカスタム定義と重なっています'
        case 'missing':
          return `必須の項目 ${r.field} がありません`
        case 'invalid':
          return `${r.field} の値が正しくありません`
        case 'kind':
          return `kind は ${r.allowed.join(' / ')} のいずれかにしてください（指定: ${r.value}）`
        case 'model':
          return `model は ${r.allowed.join(' / ')} のいずれかにしてください（指定: ${r.value}）`
        case 'tools':
          return `subagent で使えないツール ${r.names.join(', ')} を指定しています（使えるのは ${r.allowed.join(', ')}）`
        case 'unexpected':
          return `定義を読めませんでした: ${r.detail}`
      }
    },
    customProblemsHeading: 'customActions で無視した定義:',
    customIgnoredToast: (count, first) =>
      `selection-actions: customActions に問題が ${count} 件あり、該当する定義を無視しました（${first}）。全件は /selection-actions を実行すると結果に表示されます`,
    customIgnoredId: (id, reason) => `${id} は customActions の定義が無効なため使えません: ${reason}`,
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
    close: 'Close',
    languageName: 'English',
    agentDescription: label => `${label} for the selected text (selection-actions only)`,
    customReason: r => {
      switch (r.code) {
        case 'json':
          return `customActions is not valid JSON (all definitions ignored): ${r.detail}`
        case 'notArray':
          return 'customActions is not a JSON array (all definitions ignored)'
        case 'notString':
          return 'write customActions as a string: in settings.json, put the JSON array in quotes and escape the quotes inside it (all definitions ignored)'
        case 'notObject':
          return 'the definition is not an object'
        case 'idFormat':
          return 'write the id in lowercase letters, digits and hyphens (e.g. review-pr)'
        case 'idReserved':
          return 'the id is taken by a built-in action or close'
        case 'idDuplicate':
          return 'the id is taken by an earlier custom definition'
        case 'missing':
          return `the required field ${r.field} is missing`
        case 'invalid':
          return `the value of ${r.field} is not valid`
        case 'kind':
          return `kind must be one of ${r.allowed.join(', ')} (given: ${r.value})`
        case 'model':
          return `model must be one of ${r.allowed.join(', ')} (given: ${r.value})`
        case 'tools':
          return `tools a subagent cannot have: ${r.names.join(', ')} (allowed: ${r.allowed.join(', ')})`
        case 'unexpected':
          return `the definition could not be read: ${r.detail}`
      }
    },
    customProblemsHeading: 'Ignored in customActions:',
    customIgnoredToast: (count, first) =>
      `selection-actions: ${count} problem(s) in customActions; the definitions concerned are ignored (${first}). Run /selection-actions to see them all in its result`,
    customIgnoredId: (id, reason) => `${id} cannot be used: its definition in customActions is invalid: ${reason}`,
  },
}

/** The answer language and style appended to an action's instructions to the model. */
export const answerStyle = (lang: Lang) =>
  `Answer in ${MESSAGES[lang].languageName}, in plain prose suited to a terminal pane (no headings, no tables).`
