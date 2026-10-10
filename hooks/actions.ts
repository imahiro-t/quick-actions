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

// In the order of their purpose, so the hint line keeps them together when all
// are shown: translation, meaning, summary, then evidence.
export const ACTIONS: readonly ActionSpec[] = [
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
    id: 'eli5',
    icon: '🧸',
    label: { ja: 'やさしく説明', en: 'Explain simply' },
    kind: 'complete',
    model: 'haiku',
    prompt: sys(
      'Explain the selected text to someone with no background in the topic at all.',
      'Use an everyday analogy, avoid jargon, and if a technical term is unavoidable, say in plain words what it means right there.',
      'Keep it short, about 10 lines at most.',
    ),
  },
  {
    id: 'deep-dive',
    icon: '🔬',
    label: { ja: '詳しく解説', en: 'Deep dive' },
    kind: 'complete',
    model: 'sonnet',
    prompt: sys(
      'Explain the selected text in depth for a developer who wants to understand it thoroughly:',
      'how it works, the background behind it, why it is the way it is, related concepts, and caveats or pitfalls.',
      'Organize it into short paragraphs and bullet points, one aspect each, so it stays easy to scan.',
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
    id: 'tldr',
    icon: '⚡',
    label: { ja: '一行で要約', en: 'TL;DR' },
    kind: 'complete',
    model: 'haiku',
    prompt: sys(
      'Summarize the selected text in a single sentence on a single line.',
      'Reply with that sentence alone, with no preamble.',
    ),
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
    id: 'why',
    icon: '🧾',
    label: { ja: '根拠を説明', en: 'Why so?' },
    kind: 'fork',
    prompt: [
      'The selected text is something you (Claude) said earlier in this session.',
      'Find that statement in our conversation; if you cannot find it, say so instead of guessing.',
      'Then explain what grounds it: the files you read, the results of commands that were run,',
      'facts established earlier in the conversation, or general knowledge, saying which is which.',
      'Point out plainly any part that rests on weak evidence or is only an inference.',
    ].join(' '),
  },
]

/** Shown when the setting is empty or names no known action: one per purpose, meaning first. */
export const DEFAULT_ACTION_IDS: readonly string[] = ['explain', 'translate', 'summarize', 'code']

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
