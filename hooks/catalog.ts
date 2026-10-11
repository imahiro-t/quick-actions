// The action catalog (docs/index.html): the built-ins by category, with what
// the page shows of each. The page reads docs/actions-data.js, which
// scripts/gen-catalog.mjs writes from buildCatalog(); tests/catalog.test.ts
// fails when that file no longer matches the definitions, or when a built-in
// has no category or summary.
//
// Nothing at run time imports this module (register.tsx does not): it is for
// the catalog and its test alone.

import { ACTIONS, argSpecOf, emojiIcon, isContext, isStandalone } from './actions'
import type { ActionSpec, Target } from './actions'
import { MESSAGES } from './i18n'
import type { Localized } from './i18n'

/** A category of the catalog: the built-ins it holds name it in their `category`. */
export type Category = {
  /** The ID a built-in's `category` names: lowercase letters and hyphens. */
  id: string
  /** What its actions work on: a category holds actions of one kind alone. */
  target: Target
  /** The heading, as the README's action list has it. */
  label: Localized
}

/**
 * The categories in the order the catalog shows them, as in the README's action
 * list: those on the selection, then the context actions, then the standalone
 * ones, each in the order its actions are defined in ACTIONS.
 */
export const CATEGORIES: readonly Category[] = [
  // On the selection.
  { id: 'translation', target: 'selection', label: { ja: '翻訳', en: 'Translation' } },
  { id: 'meaning', target: 'selection', label: { ja: '意味', en: 'Meaning' } },
  { id: 'summary-structure', target: 'selection', label: { ja: '要約・整理', en: 'Summary and structure' } },
  { id: 'writing', target: 'selection', label: { ja: '文章', en: 'Writing' } },
  { id: 'code', target: 'selection', label: { ja: 'コード', en: 'Code' } },
  { id: 'evidence', target: 'selection', label: { ja: '根拠', en: 'Evidence' } },
  { id: 'research', target: 'selection', label: { ja: '調査', en: 'Research' } },
  { id: 'data', target: 'selection', label: { ja: 'データ', en: 'Data' } },
  { id: 'learning', target: 'selection', label: { ja: '学習', en: 'Learning' } },
  { id: 'checks', target: 'selection', label: { ja: '検証', en: 'Checks' } },
  // On the conversation.
  { id: 'essentials', target: 'context', label: { ja: '定番', en: 'Essentials' } },
  { id: 'looking-back', target: 'context', label: { ja: '振り返り', en: 'Looking back' } },
  { id: 'last-answer', target: 'context', label: { ja: '直前の回答', en: 'The last answer' } },
  { id: 'work-ahead', target: 'context', label: { ja: '作業の進め方', en: 'How the work goes on' } },
  { id: 'viewpoint-checks', target: 'context', label: { ja: '観点チェック', en: 'Checks from one point of view' } },
  { id: 'drafts', target: 'context', label: { ja: '下書き', en: 'Drafts' } },
  { id: 'conversation-learning', target: 'context', label: { ja: '会話からの学び', en: 'Learning from the conversation' } },
  { id: 'conversation-analysis', target: 'context', label: { ja: '会話の分析', en: 'Analysing the conversation' } },
  // Standalone.
  { id: 'timers', target: 'none', label: { ja: 'タイマー類', en: 'Timers' } },
  { id: 'clock-calendar', target: 'none', label: { ja: '時刻と暦', en: 'Clock and calendar' } },
  { id: 'random-generated', target: 'none', label: { ja: '乱数と生成', en: 'Random and generated' } },
  { id: 'calc-convert', target: 'none', label: { ja: '計算と換算', en: 'Calculations and conversions' } },
  { id: 'reference-tables', target: 'none', label: { ja: '早見表', en: 'Reference tables' } },
  { id: 'ideas', target: 'none', label: { ja: '発想', en: 'Ideas' } },
  { id: 'drafting', target: 'none', label: { ja: 'コマンドとコードの作成', en: 'Drafting commands and code' } },
  { id: 'templates', target: 'none', label: { ja: '雛形', en: 'Templates' } },
  { id: 'conventions', target: 'none', label: { ja: '規約とチェックリスト', en: 'Conventions and checklists' } },
  { id: 'knowledge', target: 'none', label: { ja: '学びと知識', en: 'Learning and knowledge' } },
  { id: 'team', target: 'none', label: { ja: 'コミュニケーション', en: 'Team communication' } },
  { id: 'break', target: 'none', label: { ja: '息抜き', en: 'A break' } },
  { id: 'repo-surveys', target: 'none', label: { ja: 'リポジトリ調査', en: 'Repository surveys' } },
]

/** The kinds as the catalog names them: on the selection, on the conversation, standalone. */
export type CatalogKind = 'selection' | 'context' | 'standalone'

export const CATALOG_KINDS: readonly CatalogKind[] = ['selection', 'context', 'standalone']

/** How an action runs, in the catalog's order. */
export const CATALOG_METHODS = ['complete', 'fork', 'subagent', 'local'] as const

export type CatalogMethod = (typeof CATALOG_METHODS)[number]

/** One built-in as the catalog shows it. */
export type CatalogAction = {
  id: string
  /** The icon as the hint line draws it inside its marks (emojiIcon). */
  icon: string
  kind: CatalogKind
  method: CatalogMethod
  /** The model of a complete or subagent action (a fork uses the conversation's, a local one none). */
  model?: string
  category: string
  label: Localized
  summary: Localized
  /** The hint of a standalone action's argument, when it takes one. */
  arg?: Localized
}

/** What docs/actions-data.js holds: the page needs nothing else. */
export type Catalog = {
  total: number
  kinds: { id: CatalogKind; name: Localized; tip: Localized }[]
  methods: CatalogMethod[]
  categories: { id: string; kind: CatalogKind; label: Localized; ids: string[] }[]
  actions: CatalogAction[]
}

/** A target as the catalog's kind. */
export const kindOfTarget = (target: Target | undefined): CatalogKind =>
  isContext({ target }) ? 'context' : isStandalone({ target }) ? 'standalone' : 'selection'

const both = (pick: (lang: keyof Localized) => Record<CatalogKind, string>, kind: CatalogKind): Localized => ({
  ja: pick('ja')[kind],
  en: pick('en')[kind],
})

/** One built-in as the catalog shows it. Its `category` and `summary` must be set (see tests/catalog.test.ts). */
export function catalogAction(spec: ActionSpec): CatalogAction {
  const arg = argSpecOf(spec)
  return {
    id: spec.id,
    icon: emojiIcon(spec.icon),
    kind: kindOfTarget(spec.target),
    method: spec.kind,
    ...(spec.kind === 'complete' || spec.kind === 'subagent' ? { model: spec.model } : {}),
    category: spec.category ?? '',
    label: { ja: spec.label.ja, en: spec.label.en },
    summary: { ja: spec.summary?.ja ?? '', en: spec.summary?.en ?? '' },
    ...(arg === undefined ? {} : { arg: { ja: arg.hint.ja, en: arg.hint.en } }),
  }
}

/**
 * The catalog of the built-ins (`specs`, ACTIONS by default) in both languages:
 * the actions in their order of definition, the categories in CATEGORIES' order
 * with the IDs of theirs, and the kinds' names from MESSAGES. Plain data alone,
 * so it can be written out as JSON.
 */
export function buildCatalog(specs: readonly ActionSpec[] = ACTIONS): Catalog {
  const actions = specs.map(catalogAction)
  return {
    total: actions.length,
    kinds: CATALOG_KINDS.map(id => ({
      id,
      name: both(lang => MESSAGES[lang].hintKinds, id),
      tip: both(lang => MESSAGES[lang].hintKindTips, id),
    })),
    methods: [...CATALOG_METHODS],
    categories: CATEGORIES.map(c => ({
      id: c.id,
      kind: kindOfTarget(c.target),
      label: { ja: c.label.ja, en: c.label.en },
      ids: actions.filter(a => a.category === c.id).map(a => a.id),
    })),
    actions,
  }
}
