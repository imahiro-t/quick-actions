// The display and answer language: which one the `language` setting picks,
// and every string the person reads, in both. Nothing here throws.

import type { ArgType } from './args'
import type { CustomReason, CustomWarningReason } from './custom'

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
  /** The command's result for an ID no action has: up to ten that match it (none: the pointer to the dialog alone). */
  unknownId: (id: string, candidates: readonly string[]) => string
  showing: (pane: string, label: string) => string
  commandDescription: string
  emptyPane: string
  inlineHint: string
  quote: (text: string) => string
  /** The hover label of the hint line's ✕ button. */
  close: string
  /** The hover label of the hint line's ⋯ button, which opens the dialog of every action. */
  allActions: string
  /** The title of the ⋯ dialog's pane. */
  pickerTitle: string
  /** The ⋯ dialog's close button. */
  pickerClose: string
  /** Drawn dim in the ⋯ dialog's empty filter field. */
  pickerFilterPlaceholder: string
  /** The button beside the filter field that empties it. */
  pickerFilterClear: string
  /** What Enter in the filter field does, drawn beside it while it has focus. */
  pickerFilterSubmit: string
  /** The same, while the filter matches no action (Enter then runs nothing). */
  pickerFilterSubmitNone: string
  /** Stands for the ⋯ dialog's list when the filter matches no action. */
  pickerNoMatch: string
  /** The ⋯ dialog's page buttons, under a list longer than the pane holds: back a page, on a page. */
  pickerPrev: string
  pickerNext: string
  /** Between the page buttons: the page shown of how many, and the actions listed in all. */
  pickerPage: (page: number, pages: number, count: number) => string
  /** The command's result when it opened the ⋯ dialog. */
  pickerOpened: string
  /** The command's result when `/quick-actions hint` opened the hint line. */
  hintOpened: string
  /** Stands in the pane heading for the quote of a context action, which has no selected text. */
  onConversation: string
  /** The hint line's kind buttons, by kind: the name drawn inside the kind's mark (`[選択]`). */
  hintKinds: { selection: string; context: string; standalone: string }
  /** The hover labels of the kind buttons: which actions each shows. */
  hintKindTips: { selection: string; context: string; standalone: string }
  /**
   * The accessible name of the kind button shown now: its hover label marked
   * as the one shown, since bold and dim alone do not reach a name.
   */
  hintKindShown: (name: string) => string
  /** The command's result while an AskUserQuestion dialog is up: nothing runs. */
  askingUnavailable: string
  /** The language's name in English, for instructions to the model such as "explain the changes in …". */
  languageName: string
  agentDescription: (label: string) => string
  /** Why a custom definition (or the whole `customActions` setting) was left out. */
  customReason: (reason: CustomReason) => string
  /** Heads the list of problems after a command's result and at the top of the pane. */
  customProblemsHeading: string
  /** The toast at session start when the setting has problems: how many, and the first one. */
  customIgnoredToast: (count: number, first: string) => string
  /** A custom definition that was kept, but allows something worth knowing about. */
  customWarning: (reason: CustomWarningReason) => string
  /** Heads the list of warnings after a command's result and at the top of the pane, below the problems. */
  customWarningsHeading: string
  /** The toast at session start when the setting has warnings but no problems: how many, and the first one. */
  customWarningToast: (count: number, first: string) => string
  /** The command's result for an ID whose custom definition was left out. */
  customIgnoredId: (id: string, reason: string) => string
  /** The command's argument hint: an ID with its argument, or `hint`. */
  argumentHint: string
  /** Stands in the pane heading of a standalone action run with no argument. */
  standalone: string
  /** The command's result when an action (or `hint`) is given an argument it does not take. */
  argsNotAccepted: (id: string, arg: string) => string
  /** The command's result when an argument does not parse: `hint` says how to write one. */
  invalidArg: (id: string, arg: string, hint: string) => string
  /**
   * The ⋯ dialog's kind buttons above its list, by kind: the kind's mark and
   * name. A press lists that kind alone.
   */
  pickerKinds: { selection: string; context: string; standalone: string }
  /** The ⋯ dialog's button ahead of the kind buttons that lists every kind; named as allActions. */
  pickerAll: string
  /** Ends a local action's result cut at its limit. */
  truncated: string
  /** A local action that answered with a promise rather than at once. */
  localAsync: string
  /** A local action on the selection refused for a selection past the limit: its length and the limit (UTF-16 code units). */
  selectionTooLong: (length: number, limit: number) => string
  /** A local action on the selection that asked to run over time, which only a standalone one may. */
  localTickerOnSelection: string
  /** A standalone action (`target: 'none'`) that answered an effect (open or copy URLs), which only an action on the selection may. */
  localEffectStandalone: string
  /** A local action that needed random numbers where crypto could give none: nothing was made. */
  randomUnavailable: string
  /** The stop button of a running timer (or anything else that runs over time). */
  stop: string
  /** The button of a result on a selection that scrolls the transcript back to where that selection lies. */
  gotoSelection: string
  /** A run over time, stopped: after how long, or with no time when it is not known any more. */
  tickerStopped: (elapsed?: string) => string
  /** A run over time, done. */
  tickerDone: string
  /** Refused: this many already run over time. */
  tickerLimit: (limit: number) => string
  /** The toast when a run over time is done. */
  tickerFinishedToast: (label: string) => string
  /** The toast when a timer is done: its label and how long it ran for. */
  timerFinishedToast: (label: string, duration: string) => string
  /** A timer running: the time left. */
  timerLeft: (clock: string) => string
  /** The argument of a custom standalone action, when shown with an invalid one. */
  customArgHint: string
  /** The ⋯ dialog's argument screen: what Enter with the field empty does, the action's default shown. */
  argDefault: (value: string) => string
  /** The same, for an argument with no default (a custom action's free text): it runs with none. */
  argNoDefault: string
  /** What Enter in the argument field does, drawn beside it while it has focus. */
  argSubmit: string
  /** The argument screen's button back to the list. */
  argBack: string
  /** Drawn dim in an empty argument field with no default to show: the kind of argument. */
  argPlaceholder: (type: ArgType) => string
  /** The result pane's button that runs a timer (or the like) again with the same argument. */
  again: string
  /** The result pane's button that opens the argument screen of a timer (or the like), named by its kind. */
  setArg: (type: ArgType) => string
  /**
   * The accessible name of an action button on the hint line (it draws only
   * its marked icon): the mark, the action's label and its kind's name, so
   * that `[🌐]` and `<🌐>` (one icon, two kinds) are told apart.
   */
  hintActionName: (mark: string, label: string, kindTip: string) => string
  /** The accessible name of the hint line's ✕. */
  hintCloseName: string
  /** The accessible name of the hint line's ⋯. */
  hintMoreName: string
  /** The ⋯ dialog's filter field: drawn before it (an Input's label), its name. */
  pickerFilterLabel: string
  /** The argument screen's field: drawn before it (an Input's label), its name. */
  argFieldLabel: string
  /** The accessible name of a result entry's button (stop, again, set the argument): the button's text and the entry's action. */
  entryButtonName: (button: string, entry: string) => string
  /** An exec action's output cut at its limit: said after it. */
  execTruncated: string
  /** An exec action that exited 0 and wrote nothing. */
  execNoOutput: string
  /** An exec action that exited with another code. */
  execExit: (code: number) => string
  /** Heads an exec action's standard error, shown with a failure. */
  execStderr: string
  /** Heads an exec action's standard output, shown with a failure. */
  execStdout: string
  /** An exec action stopped at its timeout (in seconds). */
  execTimeout: (seconds: number) => string
  /** An exec action that could not start: why. */
  execNotStarted: (reason: string) => string
  /**
   * The approval asked before an exec action first runs, or runs changed: the
   * action, the executable's path as it lands, its fixed arguments (JSON) and
   * its SHA-256. Ends in a question mark.
   */
  execApproveQuestion: (label: string, id: string, path: string, args: string, sha256: string) => string
  /** The approval dialog's chip (12 characters at most). */
  execApproveHeader: string
  /** The approval dialog's options: approve and run, or not. */
  execApprove: string
  execCancel: string
  /** The toast when an exec action was not run: its label and why. */
  execRefusedToast: (label: string, reason: string) => string
  /** `/quick-actions exec-approvals`: its first line, whether execOrigin keeps exec actions to the person's own hand. */
  execAdminOrigin: (restricted: boolean) => string
  /** Heads the approvals kept: how many. */
  execAdminApprovals: (count: number) => string
  /** Stands for the approvals when none is kept. */
  execAdminNoApprovals: string
  /** One approval: the action ID, the executable's path, its fixed arguments (JSON) and the start of its SHA-256. */
  execAdminApprovalLine: (id: string, path: string, args: string, sha: string) => string
  /** Heads the runs listed: how many shown, of how many kept. */
  execAdminHistory: (shown: number, kept: number) => string
  /** Stands for the runs when none is kept. */
  execAdminNoHistory: string
  /** One run: when, the action ID, the executable's path, how it ended and where it was asked from. */
  execAdminHistoryLine: (when: string, id: string, path: string, outcome: string, from: string) => string
  /** Stands for when a run started, the clock not read then. */
  execAdminUnknownTime: string
  /** How a run ended, in words (the exit code with `exit`). */
  execAdminOutcome: (result: 'ok' | 'exit' | 'timeout' | 'notStarted', exitCode?: number) => string
  /** How to revoke, after the list. */
  execAdminUsage: string
  /** `revoke <id>`: the approval removed. */
  execAdminRevoked: (id: string) => string
  /** `revoke <id>`: no approval kept for it. */
  execAdminNotApproved: (id: string) => string
  /** `revoke --all`: how many approvals were removed. */
  execAdminRevokedAll: (count: number) => string
  /** An argument `exec-approvals` does not take: how to write it, nothing changed. */
  execAdminBadArgs: (given: string) => string
  /** The approvals could not be read or written: nothing (more) changed. */
  execAdminFailed: string
  /** Why a change of execOrigin away from terminal was refused: it came from other than the person in /config. */
  execOriginConfigDenied: string
}

/** A whole number with its digits grouped by commas (1,234,567), in either language, with no locale data needed. */
export const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',')

/** The kinds of argument by name, as an empty argument field with no default says what it takes. */
const ARG_TYPE_NAMES: Record<Lang, Record<ArgType, string>> = {
  ja: { duration: '時間', int: '整数', number: '数値', date: '日付', time: '時刻', choice: '種類', text: 'テキスト' },
  en: { duration: 'duration', int: 'whole number', number: 'number', date: 'date', time: 'time', choice: 'choice', text: 'text' },
}

/** The result pane's button to the argument screen, in the words of the kind of argument it asks for. */
const SET_ARG: Record<Lang, Record<ArgType, string>> = {
  ja: { duration: '時間を指定', int: '回数を指定', number: '数値を指定', date: '日付を指定', time: '時刻を指定', choice: '種類を指定', text: '引数を指定' },
  en: { duration: 'Set duration', int: 'Set count', number: 'Set number', date: 'Set date', time: 'Set time', choice: 'Choose type', text: 'Set argument' },
}

export const MESSAGES: Record<Lang, Messages> = {
  ja: {
    thinking: '考え中…',
    couldNotStart: reason => `起動できませんでした: ${reason}`,
    noAnswer: reason => `回答なし (${reason})`,
    failed: reason => `失敗しました: ${reason}`,
    noSelection: '選択されたテキストがありません',
    unknownId: (id, candidates) =>
      `不明なアクション ID です: ${id}${candidates.length === 0 ? '' : `（候補: ${candidates.join(', ')}）`}。/quick-actions（ID なし）で一覧から検索できます`,
    showing: (pane, label) => `${pane} ペインに ${label} の結果を表示します。`,
    commandDescription:
      '選択中のテキストか今の会話にアクションを実行します。単独のアクションは選択も会話も使わずに実行し、ID の後に引数を書けます（例: timer 5m）。ID を省くと、すべてのアクションから選ぶダイアログを開きます。hint で選択がなくてもヒント行を開きます',
    emptyPane: 'テキストを選択するか /quick-actions hint を実行して、プロンプト下のヒント行のアイコンを押してください。',
    inlineHint: 'ターミナル幅を 110 桁以上にすると、このペインは右側に表示されます（フルスクリーン表示時）。',
    quote: text => `「${text}」`,
    close: '閉じる',
    allActions: 'すべてのアクション',
    pickerTitle: 'アクションを選択',
    pickerClose: '閉じる',
    pickerFilterPlaceholder: 'ID・名前・種類',
    pickerFilterClear: 'クリア',
    pickerFilterSubmit: '先頭を実行',
    pickerFilterSubmitNone: '一致なし',
    pickerNoMatch: '一致するアクションがありません',
    pickerPrev: '前へ',
    pickerNext: '次へ',
    pickerPage: (page, pages, count) => `${page} / ${pages}（${count} 件）`,
    pickerOpened: 'ダイアログでアクションを選んでください。',
    hintOpened: 'プロンプト下のヒント行からアクションを選んでください。',
    onConversation: '今の会話',
    languageName: 'Japanese',
    agentDescription: label => `選択テキストの${label}（Quick Actions 専用）`,
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
        case 'tooLong':
          return `${r.field} が長すぎます（${r.max} 文字まで）`
        case 'forbiddenChar':
          return `${r.field} に使えない文字 ${r.char} が含まれています（制御文字・双方向制御文字・行区切りは使えません）`
        case 'idReserved':
          return 'id が標準アクション・close・hint のいずれかと重なっています'
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
        case 'target':
          return `target は ${r.allowed.join(' / ')} のいずれかにしてください（指定: ${r.value}）`
        case 'contextKind':
          return `target が context の定義は kind を fork か exec にしてください（指定: ${r.kind}）`
        case 'noneKind':
          return `target が none のアクションは complete・subagent・exec のいずれかで書いてください（指定: ${r.kind}）`
        case 'unexpected':
          return `定義を読めませんでした: ${r.detail}`
        case 'execPath':
          return r.field === 'command'
            ? `command は実行ファイルの絶対パスで書いてください（PATH からは探しません。~・相対パス・.・..・連続した /・末尾の /・=・制御文字は使えません。指定: ${r.path}）`
            : `実行ファイルの実体のパスに使えない文字や形が含まれているため実行できません（=・制御文字など。実体: ${r.path}）`
        case 'execField':
          return `kind が exec の定義には ${r.field} を書けません`
        case 'execScope':
          switch (r.why) {
            case 'unreadable':
              return 'exec の定義の出どころを確かめられないため無効にしました（設定を読めませんでした）'
            case 'keys':
              return 'exec の定義はユーザー設定（~/.claude/settings.json）の pluginConfigs で本プラグインの customActions を持つ項目が 1 つのときだけ使えます'
            case 'mismatch':
              return 'exec の定義はユーザー設定（~/.claude/settings.json）に書いたものだけが使えます（プロジェクトなどの設定が customActions を上書きしています）'
            case 'home':
              return 'プロジェクト・ローカル・--settings の設定の env が HOME を変えているため、exec の定義を無効にしました'
            case 'loader':
              return `プロジェクト・ローカル・--settings の設定の env にローダー系の変数${r.name === undefined ? '' : ` ${r.name}`} があるため、exec の定義を無効にしました`
          }
          return 'exec の定義を無効にしました'
        case 'execAllowlist':
          switch (r.why) {
            case 'noHome':
              return 'HOME が絶対パスでないため、ホワイトリストを読めません（exec の定義を無効にしました）'
            case 'missing':
              return 'ホワイトリスト ~/.claude/quick-actions/allowed-executables.json がありません（exec の定義を無効にしました）'
            case 'unreadable':
              return 'ホワイトリスト ~/.claude/quick-actions/allowed-executables.json を読めません（exec の定義を無効にしました）'
            case 'invalid':
              return 'ホワイトリスト ~/.claude/quick-actions/allowed-executables.json が {"executables": [{"path": ..., "sha256": ...}]} の形ではありません（exec の定義を無効にしました）'
            case 'inProject':
              return 'ホワイトリストの実体が今のプロジェクトの中にあるため読みません（exec の定義を無効にしました）'
          }
          return 'ホワイトリストを使えません'
        case 'execAllowlistEntry':
          return `ホワイトリストの ${r.entry} 番目の項目を無視しました（path は実体の絶対パス、sha256 は 64 桁の16進数で書いてください）`
        case 'execNotAllowed':
          return `実行ファイル ${r.path} がホワイトリストにありません（シンボリックリンクは実体のパスで照合します）`
        case 'execMissing':
          return `command が通常のファイルを指していません: ${r.path}`
        case 'execUnsupported':
          return 'exec のアクションは macOS と Linux でだけ使えます'
        case 'execTooLarge':
          return `実行ファイルが大きすぎて SHA-256 を確かめられません（${grouped(r.max)} バイトまで。ラッパースクリプトを使ってください）`
        case 'execUnreadable':
          return `実行ファイルを読めないため SHA-256 を確かめられません: ${r.path}`
        case 'execHashMismatch':
          return `実行ファイル ${r.path} の SHA-256 がホワイトリストと一致しません`
        case 'execRemote':
          return 'このアクションはまだ承認されていません。ローカルの端末で一度実行して承認してください'
        case 'execDeclined':
          return '承認されなかったため実行しませんでした'
        case 'execChanged':
          return '確認のあとで実行ファイルが変わったため実行しませんでした'
        case 'execInputTooLarge':
          return `渡す内容が大きすぎます（${grouped(r.max)} バイトまで）`
        case 'execOrigin':
          return 'この起動元からは exec のアクションを実行しない設定です（execOrigin: terminal）。ローカルの端末で押すか /quick-actions <id> と入力してください'
        case 'execBusy':
          return `exec のアクションがすでに ${r.max} つ実行中のため実行しませんでした`
      }
    },
    customProblemsHeading: 'customActions で無視した定義:',
    customIgnoredToast: (count, first) =>
      `Quick Actions: customActions に問題が ${count} 件あり、該当する定義を無視しました（${first}）。全件は /quick-actions を実行すると結果に表示されます`,
    customWarning: r => `${r.read.join('・')} と ${r.web.join('・')} を同時に許しているため、読んだファイルの内容を外部へ送り得ます`,
    customWarningsHeading: 'customActions の注意:',
    customWarningToast: (count, first) =>
      `Quick Actions: customActions に注意が ${count} 件あります（${first}）。全件は /quick-actions を実行すると結果に表示されます`,
    customIgnoredId: (id, reason) => `${id} は customActions の定義が無効なため使えません: ${reason}`,
    argumentHint: '[action-id [引数] | hint | exec-approvals]',
    standalone: '単独',
    argsNotAccepted: (id, arg) => `${id} は引数を受け付けません: ${arg}`,
    invalidArg: (id, arg, hint) => `${id} の引数が正しくありません: ${arg}（${hint}）`,
    pickerKinds: { selection: '[ ] 選択', context: '< > 会話', standalone: '{ } 単独' },
    pickerAll: '全て',
    hintKinds: { selection: '選択', context: '会話', standalone: '単独' },
    hintKindTips: { selection: '選択範囲へのアクション', context: '会話へのアクション', standalone: '単独で使うアクション' },
    hintKindShown: name => `${name}（表示中）`,
    askingUnavailable: '質問ダイアログの表示中は Quick Actions を使えません。',
    truncated: '（以下省略）',
    localAsync: '結果をすぐに返しませんでした',
    selectionTooLong: (length, limit) =>
      `選択テキストが長すぎます（${grouped(length)} 文字。ローカル実行の上限は ${grouped(limit)} 文字）`,
    localTickerOnSelection: '選択テキストへのアクションは時間経過のある実行をできません',
    localEffectStandalone: '単独のアクションは URL を開く・コピーする操作をできません',
    randomUnavailable: '安全な乱数（crypto.getRandomValues）が使えないため、生成しませんでした',
    stop: '停止',
    gotoSelection: '選択箇所に戻る',
    tickerStopped: elapsed => (elapsed === undefined ? '停止しました' : `停止しました（経過 ${elapsed}）`),
    tickerDone: '終了',
    tickerLimit: limit => `同時に動かせるのは ${limit} 個までです。停止してから実行してください`,
    tickerFinishedToast: label => `${label} が終了しました`,
    timerFinishedToast: (label, duration) => `⏳ ${label} ${duration} が終了しました`,
    timerLeft: clock => `⏳ ${clock} 残り`,
    customArgHint: '自由テキスト（省略可、500 文字まで）',
    argDefault: value => `空欄で Enter: 既定値（${value}）で実行`,
    argNoDefault: '空欄で Enter: 引数なしで実行',
    argSubmit: '実行',
    argBack: '戻る',
    argPlaceholder: type => ARG_TYPE_NAMES.ja[type],
    again: 'もう一度',
    setArg: type => SET_ARG.ja[type],
    hintActionName: (mark, label, kindTip) => `${mark} ${label}（${kindTip}）`,
    hintCloseName: 'クイックアクションのヒントを閉じる',
    hintMoreName: 'すべてのアクションを開く',
    pickerFilterLabel: '絞り込み',
    argFieldLabel: '引数',
    entryButtonName: (button, entry) => `${button}: ${entry}`,
    execTruncated: '（出力が上限を超えたため、以降を省略しました）',
    execNoOutput: '（出力なし）',
    execExit: code => `終了コード ${code}`,
    execStderr: '標準エラー:',
    execStdout: '標準出力:',
    execTimeout: seconds => `${seconds} 秒で時間切れになったため停止しました`,
    execNotStarted: reason => `起動できませんでした（${reason}）`,
    execApproveQuestion: (label, id, path, args, sha) =>
      `Quick Actions のアクション「${label}」（${id}）は次の実行ファイルを実行します。ホワイトリストに載っていても、内容を確かめてから承認してください。選択テキストや会話はこのプログラムに渡ります。\n実行ファイル: ${path}\n固定引数: ${args}\nSHA-256: ${sha}\n承認して実行しますか?`,
    execApproveHeader: '実行の承認',
    execApprove: '承認して実行',
    execCancel: 'キャンセル',
    execRefusedToast: (label, reason) => `Quick Actions: ${label} を実行しませんでした（${reason}）`,
    execAdminOrigin: restricted =>
      restricted
        ? '起動元の制限（execOrigin）: 有効。exec のアクションはターミナルでの押下か /quick-actions <id> の入力からだけ実行します'
        : '起動元の制限（execOrigin）: 無効。承認済みの exec のアクションはどの起動元からも実行します',
    execAdminApprovals: count => `exec の承認（${count} 件）:`,
    execAdminNoApprovals: 'exec の承認はありません。',
    execAdminApprovalLine: (id, path, args, sha) => `${id}: ${path} 固定引数 ${args} SHA-256 ${sha}…`,
    execAdminHistory: (shown, kept) => `exec の実行履歴（新しい順に ${shown} 件。保存は ${kept} 件）:`,
    execAdminNoHistory: 'exec の実行履歴はありません。',
    execAdminHistoryLine: (when, id, path, outcome, from) => `${when} ${id} ${path} ${outcome}（起動元: ${from}）`,
    execAdminUnknownTime: '時刻不明',
    execAdminOutcome: (result, exitCode) =>
      result === 'ok'
        ? '成功'
        : result === 'exit'
          ? `終了コード ${exitCode ?? '?'}`
          : result === 'timeout'
            ? '時間切れ'
            : '起動失敗',
    execAdminUsage: '承認を取り消すには /quick-actions exec-approvals revoke <id>（全件は revoke --all）。取り消した後の実行では再び承認を求めます。',
    execAdminRevoked: id => `${id} の承認を取り消しました。次に実行するときに再び承認を求めます。`,
    execAdminNotApproved: id => `${id} の承認はありません。`,
    execAdminRevokedAll: count => `exec の承認を ${count} 件すべて取り消しました。`,
    execAdminBadArgs: given =>
      `exec-approvals の引数が正しくありません: ${given}（使い方: /quick-actions exec-approvals、revoke <id>、revoke --all）。何も変更していません。`,
    execAdminFailed: 'exec の承認を読み書きできませんでした。何も変更していません。',
    execOriginConfigDenied: 'Quick Actions の execOrigin を terminal から外せるのは、本人が /config で変更したときだけです',
  },
  en: {
    thinking: 'Thinking…',
    couldNotStart: reason => `Could not start: ${reason}`,
    noAnswer: reason => `No answer (${reason})`,
    failed: reason => `Failed: ${reason}`,
    noSelection: 'No text is selected',
    unknownId: (id, candidates) =>
      `Unknown action ID: ${id}${candidates.length === 0 ? '' : ` (candidates: ${candidates.join(', ')})`}. Run /quick-actions (no ID) to search the list`,
    showing: (pane, label) => `Showing the ${label} result in the ${pane} pane.`,
    commandDescription:
      'Run an action on the selected text or on this conversation; a standalone action uses neither and takes an argument after its ID (e.g. timer 5m). Without an ID: pick one from every action in a dialog; hint: open the hint line, with or without a selection',
    emptyPane: 'Select some text or run /quick-actions hint, then press an icon on the hint line below the prompt.',
    inlineHint: 'Widen the terminal to 110 columns or more to show this pane on the right (in fullscreen).',
    quote: text => `"${text}"`,
    close: 'Close',
    allActions: 'All actions',
    pickerTitle: 'Select an action',
    pickerClose: 'Close',
    pickerFilterPlaceholder: 'ID, name or kind',
    pickerFilterClear: 'Clear',
    pickerFilterSubmit: 'run first',
    pickerFilterSubmitNone: 'no match',
    pickerNoMatch: 'No action matches',
    pickerPrev: 'Prev',
    pickerNext: 'Next',
    pickerPage: (page, pages, count) => `${page} / ${pages} (${count})`,
    pickerOpened: 'Pick an action in the dialog.',
    hintOpened: 'Pick an action on the hint line below the prompt.',
    onConversation: 'this conversation',
    languageName: 'English',
    agentDescription: label => `${label} for the selected text (Quick Actions only)`,
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
        case 'tooLong':
          return `${r.field} is too long (up to ${r.max} characters)`
        case 'forbiddenChar':
          return `${r.field} contains a character it cannot have: ${r.char} (no control, bidirectional control or line separator characters)`
        case 'idReserved':
          return 'the id is taken by a built-in action, close or hint'
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
        case 'target':
          return `target must be one of ${r.allowed.join(', ')} (given: ${r.value})`
        case 'contextKind':
          return `a definition with target context must have kind fork or exec (given: ${r.kind})`
        case 'noneKind':
          return `an action with target none must be complete, subagent or exec (given: ${r.kind})`
        case 'unexpected':
          return `the definition could not be read: ${r.detail}`
        case 'execPath':
          return r.field === 'command'
            ? `write command as the executable's absolute path (PATH is not searched; no ~, relative path, . or .. part, double /, / at the end, = or control character; given: ${r.path})`
            : `the path the executable lands on has a character or form that cannot be run (= or a control character, say; it lands on: ${r.path})`
        case 'execField':
          return `a definition of kind exec cannot have ${r.field}`
        case 'execScope':
          switch (r.why) {
            case 'unreadable':
              return 'exec definitions are off: where they came from could not be checked (the settings could not be read)'
            case 'keys':
              return 'exec definitions work only when exactly one entry of this plugin in pluginConfigs of your user settings (~/.claude/settings.json) has customActions'
            case 'mismatch':
              return 'exec definitions work only as written in your user settings (~/.claude/settings.json); other settings (a project\'s, say) override customActions'
            case 'home':
              return 'exec definitions are off: the env of the project, local or --settings settings changes HOME'
            case 'loader':
              return `exec definitions are off: the env of the project, local or --settings settings sets a variable of the dynamic loader${r.name === undefined ? '' : ` (${r.name})`}`
          }
          return 'exec definitions are off'
        case 'execAllowlist':
          switch (r.why) {
            case 'noHome':
              return 'HOME is not an absolute path, so the allowlist cannot be read (exec definitions are off)'
            case 'missing':
              return 'there is no allowlist ~/.claude/quick-actions/allowed-executables.json (exec definitions are off)'
            case 'unreadable':
              return 'the allowlist ~/.claude/quick-actions/allowed-executables.json cannot be read (exec definitions are off)'
            case 'invalid':
              return 'the allowlist ~/.claude/quick-actions/allowed-executables.json is not {"executables": [{"path": ..., "sha256": ...}]} (exec definitions are off)'
            case 'inProject':
              return 'the allowlist lands inside the current project, so it is not read (exec definitions are off)'
          }
          return 'the allowlist cannot be used'
        case 'execAllowlistEntry':
          return `entry ${r.entry} of the allowlist is ignored (write path as the executable's real absolute path and sha256 as 64 hexadecimal digits)`
        case 'execNotAllowed':
          return `the executable ${r.path} is not in the allowlist (a symbolic link is matched by the path it lands on)`
        case 'execMissing':
          return `command does not lead to a regular file: ${r.path}`
        case 'execUnsupported':
          return 'exec actions work on macOS and Linux only'
        case 'execTooLarge':
          return `the executable is too large to check its SHA-256 (up to ${grouped(r.max)} bytes; use a wrapper script)`
        case 'execUnreadable':
          return `the executable cannot be read to check its SHA-256: ${r.path}`
        case 'execHashMismatch':
          return `the SHA-256 of the executable ${r.path} does not match the allowlist`
        case 'execRemote':
          return 'this action is not approved yet: run it once at your own terminal to approve it'
        case 'execDeclined':
          return 'not run: it was not approved'
        case 'execChanged':
          return 'not run: the executable changed after it was checked'
        case 'execInputTooLarge':
          return `what it would be given is too large (up to ${grouped(r.max)} bytes)`
        case 'execOrigin':
          return 'exec actions are set not to run from here (execOrigin: terminal): press it at your own terminal or type /quick-actions <id>'
        case 'execBusy':
          return `not run: ${r.max} exec actions are running already`
      }
    },
    customProblemsHeading: 'Ignored in customActions:',
    customIgnoredToast: (count, first) =>
      `Quick Actions: ${count} problem(s) in customActions; the definitions concerned are ignored (${first}). Run /quick-actions to see them all in its result`,
    customWarning: r =>
      `it allows ${r.read.join(', ')} together with ${r.web.join(', ')}, so it could send the contents of files it reads out to the web`,
    customWarningsHeading: 'Warnings in customActions:',
    customWarningToast: (count, first) =>
      `Quick Actions: ${count} warning(s) in customActions (${first}). Run /quick-actions to see them all in its result`,
    customIgnoredId: (id, reason) => `${id} cannot be used: its definition in customActions is invalid: ${reason}`,
    argumentHint: '[action-id [argument] | hint | exec-approvals]',
    standalone: 'standalone',
    argsNotAccepted: (id, arg) => `${id} takes no argument: ${arg}`,
    invalidArg: (id, arg, hint) => `Invalid argument for ${id}: ${arg} (${hint})`,
    pickerKinds: { selection: '[ ] selection', context: '< > context', standalone: '{ } standalone' },
    pickerAll: 'all',
    hintKinds: { selection: 'selection', context: 'context', standalone: 'standalone' },
    hintKindTips: { selection: 'Actions on the selection', context: 'Actions on the conversation', standalone: 'Standalone actions' },
    hintKindShown: name => `${name} (shown)`,
    askingUnavailable: 'Quick Actions cannot be used while a question dialog is up.',
    truncated: '(truncated)',
    localAsync: 'the result did not come at once',
    selectionTooLong: (length, limit) =>
      `the selection is too long (${grouped(length)} characters; a local action takes up to ${grouped(limit)})`,
    localTickerOnSelection: 'an action on the selection cannot run over time',
    localEffectStandalone: 'a standalone action cannot open or copy URLs',
    randomUnavailable: 'no secure random numbers are available (crypto.getRandomValues), so nothing was generated',
    stop: 'Stop',
    gotoSelection: 'Go to selection',
    tickerStopped: elapsed => (elapsed === undefined ? 'Stopped' : `Stopped (after ${elapsed})`),
    tickerDone: 'Done',
    tickerLimit: limit => `Up to ${limit} can run at once. Stop one, then run this again`,
    tickerFinishedToast: label => `${label} is done`,
    timerFinishedToast: (label, duration) => `⏳ ${label} ${duration} is done`,
    timerLeft: clock => `⏳ ${clock} left`,
    customArgHint: 'free text (optional, up to 500 characters)',
    argDefault: value => `Enter with it empty: run with the default (${value})`,
    argNoDefault: 'Enter with it empty: run with no argument',
    argSubmit: 'run',
    argBack: 'Back',
    argPlaceholder: type => ARG_TYPE_NAMES.en[type],
    again: 'Again',
    setArg: type => SET_ARG.en[type],
    hintActionName: (mark, label, kindTip) => `${mark} ${label} (${kindTip})`,
    hintCloseName: 'Close the Quick Actions hint',
    hintMoreName: 'Open all actions',
    pickerFilterLabel: 'Filter',
    argFieldLabel: 'Argument',
    entryButtonName: (button, entry) => `${button}: ${entry}`,
    execTruncated: '(the output passed its limit; the rest is left out)',
    execNoOutput: '(no output)',
    execExit: code => `exit code ${code}`,
    execStderr: 'Standard error:',
    execStdout: 'Standard output:',
    execTimeout: seconds => `stopped: it ran past its timeout of ${seconds} s`,
    execNotStarted: reason => `could not start (${reason})`,
    execApproveQuestion: (label, id, path, args, sha) =>
      `The Quick Actions action "${label}" (${id}) runs this executable. Even though it is in your allowlist, check it before you approve: the selected text or the conversation goes to it.\nExecutable: ${path}\nFixed arguments: ${args}\nSHA-256: ${sha}\nApprove and run it?`,
    execApproveHeader: 'Approve run',
    execApprove: 'Approve and run',
    execCancel: 'Cancel',
    execRefusedToast: (label, reason) => `Quick Actions: ${label} was not run (${reason})`,
    execAdminOrigin: restricted =>
      restricted
        ? 'Origin limit (execOrigin): on. Exec actions run only from a press at the terminal or /quick-actions <id> typed at the prompt'
        : 'Origin limit (execOrigin): off. Approved exec actions run from anywhere',
    execAdminApprovals: count => `Exec approvals (${count}):`,
    execAdminNoApprovals: 'No exec approvals.',
    execAdminApprovalLine: (id, path, args, sha) => `${id}: ${path} fixed arguments ${args} SHA-256 ${sha}…`,
    execAdminHistory: (shown, kept) => `Exec runs (newest first, ${shown} of ${kept} kept):`,
    execAdminNoHistory: 'No exec runs recorded.',
    execAdminHistoryLine: (when, id, path, outcome, from) => `${when} ${id} ${path} ${outcome} (from: ${from})`,
    execAdminUnknownTime: 'unknown time',
    execAdminOutcome: (result, exitCode) =>
      result === 'ok'
        ? 'succeeded'
        : result === 'exit'
          ? `exit code ${exitCode ?? '?'}`
          : result === 'timeout'
            ? 'timed out'
            : 'not started',
    execAdminUsage: 'To revoke an approval: /quick-actions exec-approvals revoke <id> (all of them: revoke --all). A run after that asks for approval again.',
    execAdminRevoked: id => `The approval of ${id} is revoked. Its next run asks for approval again.`,
    execAdminNotApproved: id => `${id} has no approval.`,
    execAdminRevokedAll: count => `All ${count} exec approval(s) revoked.`,
    execAdminBadArgs: given =>
      `Invalid argument for exec-approvals: ${given} (use /quick-actions exec-approvals, revoke <id> or revoke --all). Nothing changed.`,
    execAdminFailed: 'The exec approvals could not be read or written. Nothing changed.',
    execOriginConfigDenied: 'Quick Actions execOrigin can be moved off terminal only by you, in /config',
  },
}

/** The answer language and style appended to an action's instructions to the model. */
export const answerStyle = (lang: Lang) =>
  `Answer in ${MESSAGES[lang].languageName}, in plain prose suited to a terminal pane (no headings, no tables).`
