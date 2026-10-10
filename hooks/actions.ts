// Action definitions: the only place an action lives. The hint line, the pane
// and the runner in register.tsx read nothing but these, so adding one entry to
// ACTIONS makes a new action available (its ID can then go in the setting).
//
// Each definition carries what the person reads in both languages (`label`,
// `runningText`, `description` as `{ ja, en }`); `actionsFor(lang)` hands out
// the definitions with those resolved, which is all the rest of the module sees.

import { MESSAGES, answerStyle } from './i18n'
import type { Lang, Localized } from './i18n'

type ActionBase<T> = {
  /** The ID written in the `actions` setting: lowercase letters, digits, hyphens. */
  id: string
  /** The glyph on the hint line. */
  icon: string
  /** Shown on hover on the hint line and as the pane heading. */
  label: T
  /** Shown in the pane while the action runs (default: Thinking… / 考え中…). */
  runningText?: T
}

/** One model call on its own: `prompt` is the system prompt, the selection the user turn. */
export type CompleteAction<T = string> = ActionBase<T> & {
  kind: 'complete'
  model: string
  prompt: string
  maxTokens?: number
}

/** A fork of the session, so the answer knows the conversation: `prompt` follows the selection. */
export type ForkAction<T = string> = ActionBase<T> & {
  kind: 'fork'
  prompt: string
}

/** A subagent of its own: `prompt` is its system prompt, `task` opens the request it is spawned with. */
export type SubagentAction<T = string> = ActionBase<T> & {
  kind: 'subagent'
  model: string
  prompt: string
  task: string
  /** What the subagent type says it is for (default: built from the label). */
  description?: T
  /** Its tools (default: read-only Read, Grep, Glob). */
  tools?: readonly string[]
}

/** A subagent definition resolved for one language: its description is always filled in (see resolveSpec). */
export type ResolvedSubagentAction = SubagentAction & { description: string }

/** A definition with its texts resolved for one language: what the hint line, the pane and the runner use. */
export type ActionDef = CompleteAction | ForkAction | ResolvedSubagentAction

/** A definition as written in ACTIONS, its texts in both languages. */
export type ActionSpec = CompleteAction<Localized> | ForkAction<Localized> | SubagentAction<Localized>

export const PLUGIN = 'selection-actions'

/** Stands in a prompt for the answer language and style (answerStyle(lang)). */
export const STYLE = '{STYLE}'
/**
 * Stands in a prompt for the answer language's name (MESSAGES[lang].languageName).
 * Not called LANG, so it is not read as the locale variable of that name.
 */
export const ANSWER_LANGUAGE = '{ANSWER_LANGUAGE}'

export const READ_ONLY_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob']

export const wrap = (text: string) => `<selected>\n${text}\n</selected>`

// What a failure shows after its label: an Error's String() would repeat
// "Error: " there, so an Error gives its message; anything else, String().
export const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Joins the lines and ends them with the answer language and style, filled in by language. */
export const sys = (...lines: string[]) => [...lines, STYLE].join(' ')

/** A prompt with its STYLE and ANSWER_LANGUAGE filled in for the language. */
export const localizePrompt = (prompt: string, lang: Lang) =>
  prompt.split(STYLE).join(answerStyle(lang)).split(ANSWER_LANGUAGE).join(MESSAGES[lang].languageName)

/**
 * One definition with its texts and prompts resolved for the language. This is
 * the only place a subagent's default description is built.
 */
export function resolveSpec(spec: ActionSpec, lang: Lang): ActionDef {
  const label = spec.label[lang]
  const texts = spec.runningText === undefined ? { label } : { label, runningText: spec.runningText[lang] }
  const prompt = localizePrompt(spec.prompt, lang)
  if (spec.kind === 'subagent') {
    const { label: _l, runningText: _r, description, ...rest } = spec
    return {
      ...rest,
      ...texts,
      prompt,
      task: localizePrompt(spec.task, lang),
      description: description?.[lang] ?? MESSAGES[lang].agentDescription(label),
    }
  }
  // complete and fork carry no other text to resolve.
  const { label: _l, runningText: _r, ...rest } = spec
  return { ...rest, ...texts, prompt }
}

export const ACTIONS: readonly ActionSpec[] = [
  {
    id: 'explain',
    icon: '💡',
    label: { ja: '意味', en: 'Explain' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'You explain text a developer selected in their Claude Code terminal session:',
      'command output, error messages, logs, code or unfamiliar terms.',
      'Say what it means, why it likely appeared, and what to do about it if anything.',
      'Keep it under about 15 lines.',
    ),
  },
  {
    id: 'translate',
    icon: '🌐',
    label: { ja: '日本語訳', en: 'To Japanese' },
    kind: 'complete',
    model: 'haiku',
    prompt: [
      'Translate the selected text into natural Japanese.',
      'Keep code, identifiers, paths and commands as they are.',
      'Reply with the translation alone.',
    ].join(' '),
  },
  {
    id: 'code',
    icon: '🔎',
    label: { ja: 'コードの根拠', en: 'Find the code' },
    kind: 'subagent',
    model: 'sonnet',
    runningText: { ja: 'リポジトリを調査中…', en: 'Searching the repository…' },
    description: {
      ja: '選択テキストの出どころとなるリポジトリのコードを探します（selection-actions 専用）',
      en: 'Locates the repository code a piece of selected text comes from (selection-actions only)',
    },
    task: 'Find where in this repository the following text comes from.',
    prompt: sys(
      'You locate the code in the current repository that the given text comes from or depends on:',
      'where a message, error, log line, identifier or behaviour originates.',
      'Search with Grep and Glob, read with Read; change nothing.',
      'Reply with the few most relevant locations as `path:line`, each followed by one or two lines',
      'on why it is the evidence, then a short conclusion. If nothing in the repository matches, say so.',
    ),
  },
  {
    id: 'ask',
    icon: '💬',
    label: { ja: 'Claudeに聞く', en: 'Ask Claude' },
    kind: 'fork',
    prompt: 'Explain the selected text in the context of what we are working on in this session.',
  },
  {
    id: 'summarize',
    icon: '📝',
    label: { ja: '要約', en: 'Summarize' },
    kind: 'complete',
    model: 'haiku',
    prompt: sys(
      'Summarize the selected text for a developer in a few short sentences or up to five bullet points.',
      'Keep the facts, numbers and names that matter; drop the rest.',
    ),
  },
  {
    id: 'translate-en',
    icon: '🔤',
    label: { ja: '英訳', en: 'To English' },
    kind: 'complete',
    model: 'haiku',
    prompt: [
      'Translate the selected text into natural English.',
      'Keep code, identifiers, paths and commands as they are.',
      'Reply with the translation alone.',
    ].join(' '),
  },
  {
    id: 'command',
    icon: '💻',
    label: { ja: 'コマンドの説明', en: 'Explain command' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'The selection is a shell command or command line.',
      'Explain what it does part by part (the program, each option and argument, pipes and redirections),',
      'and point out anything destructive or surprising it would do.',
    ),
  },
  {
    id: 'error',
    icon: '🩹',
    label: { ja: 'エラーの対処', en: 'Fix the error' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'The selection is an error message or failing output.',
      'Name the most likely causes, most likely first, and for each the concrete steps or commands to check and fix it.',
    ),
  },
  {
    id: 'regex',
    icon: '🧩',
    label: { ja: '正規表現の説明', en: 'Explain regex' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'The selection contains a regular expression.',
      'Break it down token by token, say what it matches overall, give two or three strings it matches and one it does not,',
      'and mention pitfalls such as greedy quantifiers, anchors, escaping or flavour differences.',
    ),
  },
  {
    id: 'code-explain',
    icon: '📖',
    label: { ja: 'コードの説明', en: 'Explain code' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'The selection is a piece of source code.',
      'Explain what it does and how, step by step at the level of a code reader, and note any non-obvious behaviour.',
    ),
  },
  {
    id: 'review',
    icon: '🧐',
    label: { ja: 'コードレビュー', en: 'Code review' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'Review the selected code as a careful senior engineer.',
      'List concrete problems (bugs, edge cases, unclear naming, needless complexity), most important first,',
      'each with a short suggestion. If it looks fine, say so briefly.',
    ),
  },
  {
    id: 'stacktrace',
    icon: '🧵',
    label: { ja: 'スタックトレース解析', en: 'Stack trace' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'The selection is a stack trace.',
      'Say what was thrown and where it most likely originated (the first frame in application code rather than library code),',
      'the call path that led there, and what to look at first.',
    ),
  },
  {
    id: 'log',
    icon: '📜',
    label: { ja: 'ログの読み解き', en: 'Read logs' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'The selection is log output.',
      'Say what happened in order, which lines matter (warnings, errors, timing gaps), and whether anything needs attention.',
    ),
  },
  {
    id: 'security',
    icon: '🔒',
    label: { ja: 'セキュリティ観点', en: 'Security check' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'Look at the selection (code, a command, configuration or output) from a security point of view.',
      'Point out risks such as injection, secrets in the open, unsafe permissions or unvalidated input, each with a fix.',
      'If you see nothing of concern, say so briefly.',
    ),
  },
  {
    id: 'test-ideas',
    icon: '🧪',
    label: { ja: 'テスト観点', en: 'Test ideas' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'Suggest test cases for the selected code or behaviour:',
      'the normal path, boundaries, error cases and edge cases worth covering, one line each.',
    ),
  },
  {
    id: 'glossary',
    icon: '📚',
    label: { ja: '用語の解説', en: 'Glossary' },
    kind: 'complete',
    model: 'haiku',
    prompt: sys(
      'Explain the technical terms, abbreviations and names in the selection, one short line each,',
      'in the sense they most likely carry in software development.',
    ),
  },
  {
    id: 'simplify',
    icon: '🌱',
    label: { ja: 'やさしく言い換え', en: 'Simplify' },
    kind: 'complete',
    model: 'haiku',
    prompt: sys(
      'Rewrite the selected text in plain, easy words for someone new to the topic,',
      'keeping its meaning. Reply with the rewrite alone.',
    ),
  },
  {
    id: 'proofread',
    icon: '✅',
    label: { ja: '校正', en: 'Proofread' },
    kind: 'complete',
    model: 'haiku',
    prompt: [
      'Proofread the selected text in its own language.',
      `Give the corrected text first, then list the changes briefly in ${ANSWER_LANGUAGE}.`,
      `If nothing needs fixing, say so in ${ANSWER_LANGUAGE}.`,
    ].join(' '),
  },
  {
    id: 'structure',
    icon: '🧱',
    label: { ja: 'JSON/YAMLの構造', en: 'Data structure' },
    kind: 'complete',
    model: 'haiku',
    prompt: sys(
      'The selection is structured data such as JSON, YAML or TOML.',
      'Describe its shape (top-level keys, nesting, arrays and the types of values) and what it seems to configure or represent.',
      'Mention syntax errors if there are any.',
    ),
  },
  {
    id: 'naming',
    icon: '🔖',
    label: { ja: '命名案', en: 'Name ideas' },
    kind: 'complete',
    model: 'haiku',
    prompt: sys(
      'Suggest five clear names for the thing the selection describes or implements,',
      'in the naming style the selection already uses, each with a few words on why.',
    ),
  },
  {
    id: 'usages',
    icon: '🧭',
    label: { ja: '使用箇所を探す', en: 'Find usages' },
    kind: 'subagent',
    model: 'sonnet',
    runningText: { ja: '使用箇所を調査中…', en: 'Searching for usages…' },
    description: {
      ja: '識別子やコード片がリポジトリのどこで使われているかを探します（selection-actions 専用）',
      en: 'Finds where an identifier or snippet is used in the repository (selection-actions only)',
    },
    task: 'Find where the following identifier or snippet is defined and used in this repository.',
    prompt: sys(
      'You find where an identifier, function, type, config key or snippet is defined and used in the current repository.',
      'Search with Grep and Glob, read with Read; change nothing.',
      'Reply with the definition first, then the usages as `path:line` with a few words each, then a one-line summary.',
      'If nothing matches, say so.',
    ),
  },
  {
    id: 'docs',
    icon: '📄',
    label: { ja: '関連ドキュメントを探す', en: 'Find docs' },
    kind: 'subagent',
    model: 'haiku',
    runningText: { ja: 'ドキュメントを調査中…', en: 'Searching the docs…' },
    description: {
      ja: '選択テキストに関連するリポジトリのドキュメントを探します（selection-actions 専用）',
      en: 'Finds the repository documentation related to selected text (selection-actions only)',
    },
    task: 'Find the documentation in this repository related to the following text.',
    prompt: sys(
      'You find documentation in the current repository (README, docs folders, comments, changelogs) related to the given text.',
      'Search with Grep and Glob, read with Read; change nothing.',
      'Reply with the most relevant places as `path:line` with what each says in a line or two. If nothing matches, say so.',
    ),
  },
  {
    id: 'next-step',
    icon: '👉',
    label: { ja: '次の一手', en: 'Next step' },
    kind: 'fork',
    prompt: 'Given what we are working on in this session, suggest the next concrete step to take about the selected text, and why.',
  },
  {
    id: 'send',
    icon: '📨',
    label: { ja: 'Claudeへの質問として送る', en: 'Send to Claude' },
    kind: 'fork',
    prompt: 'Treat the selected text as my question and answer it in the context of this session.',
  },
]

/** Shown when the setting is empty or names no known action: the original four, in their order. */
export const DEFAULT_ACTION_IDS: readonly string[] = ['explain', 'translate', 'code', 'ask']

/**
 * The actions the setting names, in its order: comma-separated IDs, trimmed and
 * lowercased, unknown ones and repeats skipped. Falls back to the defaults when
 * nothing usable is left. Never throws.
 */
export function resolveActions<D extends { id: string }>(defs: readonly D[], setting: unknown): D[] {
  const byId = new Map(defs.map(d => [d.id, d] as const))
  const pick = (ids: readonly string[]) => {
    const seen = new Set<string>()
    const out: D[] = []
    for (const id of ids) {
      const def = byId.get(id)
      if (def === undefined || seen.has(id)) continue
      seen.add(id)
      out.push(def)
    }
    return out
  }

  const ids = (typeof setting === 'string' ? setting : '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s !== '')
  const chosen = pick(ids)
  return chosen.length > 0 ? chosen : pick(DEFAULT_ACTION_IDS)
}

/** The action a pane entry or a command names, if it is defined. */
export const findAction = <D extends { id: string }>(defs: readonly D[], id: string): D | undefined =>
  defs.find(d => d.id === id)

/** The `<plugin>:<name>` a subagent action's type is registered and spawned under: by ID alone, in any language. */
export const subagentType = (def: { id: string }) => `${PLUGIN}:${def.id}`

const resolved: Partial<Record<Lang, readonly ActionDef[]>> = {}

/** Every definition in ACTIONS, in its order, resolved for the language (once per language). */
export const actionsFor = (lang: Lang): readonly ActionDef[] => (resolved[lang] ??= ACTIONS.map(spec => resolveSpec(spec, lang)))
