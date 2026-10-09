// Action definitions: the only place an action lives. The hint line, the pane
// and the runner in register.tsx read nothing but these, so adding one entry to
// ACTIONS makes a new action available (its ID can then go in the setting).

type ActionBase = {
  /** The ID written in the `actions` setting: lowercase letters, digits, hyphens. */
  id: string
  /** The glyph on the hint line. */
  icon: string
  /** Shown on hover on the hint line and as the pane heading. */
  label: string
  /** Shown in the pane while the action runs (default: 考え中…). */
  runningText?: string
}

/** One model call on its own: `prompt` is the system prompt, the selection the user turn. */
export type CompleteAction = ActionBase & {
  kind: 'complete'
  model: string
  prompt: string
  maxTokens?: number
}

/** A fork of the session, so the answer knows the conversation: `prompt` follows the selection. */
export type ForkAction = ActionBase & {
  kind: 'fork'
  prompt: string
}

/** A subagent of its own: `prompt` is its system prompt, `task` opens the request it is spawned with. */
export type SubagentAction = ActionBase & {
  kind: 'subagent'
  model: string
  prompt: string
  task: string
  /** What the subagent type says it is for (default: built from the label). */
  description?: string
  /** Its tools (default: read-only Read, Grep, Glob). */
  tools?: readonly string[]
}

export type ActionDef = CompleteAction | ForkAction | SubagentAction

export const PLUGIN = 'selection-actions'

export const STYLE = 'Answer in Japanese, in plain prose suited to a terminal pane (no headings, no tables).'

export const READ_ONLY_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob']

export const wrap = (text: string) => `<selected>\n${text}\n</selected>`

const sys = (...lines: string[]) => [...lines, STYLE].join(' ')

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'explain',
    icon: '💡',
    label: '意味',
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
    label: '日本語訳',
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
    label: 'コードの根拠',
    kind: 'subagent',
    model: 'sonnet',
    runningText: 'リポジトリを調査中…',
    description: 'Locates the repository code a piece of selected text comes from (selection-actions only)',
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
    label: 'Claudeに聞く',
    kind: 'fork',
    prompt: 'Explain the selected text in the context of what we are working on in this session.',
  },
  {
    id: 'summarize',
    icon: '📝',
    label: '要約',
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
    label: '英訳',
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
    label: 'コマンドの説明',
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
    label: 'エラーの対処',
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
    label: '正規表現の説明',
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
    label: 'コードの説明',
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
    label: 'コードレビュー',
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
    label: 'スタックトレース解析',
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
    label: 'ログの読み解き',
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
    label: 'セキュリティ観点',
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
    label: 'テスト観点',
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
    label: '用語の解説',
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
    label: 'やさしく言い換え',
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
    label: '校正',
    kind: 'complete',
    model: 'haiku',
    prompt: [
      'Proofread the selected text in its own language.',
      'Give the corrected text first, then list the changes briefly in Japanese.',
      'If nothing needs fixing, say so in Japanese.',
    ].join(' '),
  },
  {
    id: 'structure',
    icon: '🧱',
    label: 'JSON/YAMLの構造',
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
    label: '命名案',
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
    label: '使用箇所を探す',
    kind: 'subagent',
    model: 'sonnet',
    runningText: '使用箇所を調査中…',
    description: 'Finds where an identifier or snippet is used in the repository (selection-actions only)',
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
    label: '関連ドキュメントを探す',
    kind: 'subagent',
    model: 'haiku',
    runningText: 'ドキュメントを調査中…',
    description: 'Finds the repository documentation related to selected text (selection-actions only)',
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
    label: '次の一手',
    kind: 'fork',
    prompt: 'Given what we are working on in this session, suggest the next concrete step to take about the selected text, and why.',
  },
  {
    id: 'send',
    icon: '📨',
    label: 'Claudeへの質問として送る',
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
export function resolveActions(defs: readonly ActionDef[], setting: unknown): ActionDef[] {
  const byId = new Map(defs.map(d => [d.id, d] as const))
  const pick = (ids: readonly string[]) => {
    const seen = new Set<string>()
    const out: ActionDef[] = []
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
export const findAction = (defs: readonly ActionDef[], id: string): ActionDef | undefined =>
  defs.find(d => d.id === id)

/** The `<plugin>:<name>` a subagent action's type is registered and spawned under. */
export const subagentType = (def: SubagentAction) => `${PLUGIN}:${def.id}`
