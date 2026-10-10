import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Result } from '../types'
import {
  ACTIONS,
  PLUGIN,
  READ_ONLY_TOOLS,
  findAction,
  messageOf,
  resolveActions,
  resolveAll,
  subagentType,
  wrap,
} from './actions'
import type { ActionDef, ActionSpec, ResolvedSubagentAction } from './actions'
import { parseCustomActions, problemFor, problemLine, reasonText, withProblems } from './custom'
import { MESSAGES, answerStyle, explicitLanguage, resolveLanguage } from './i18n'
import type { Lang } from './i18n'
import { settleQuietly, toLatest } from './scroll'

// Everything below is driven by the definitions in ./actions and the person's
// own from the `customActions` setting (./custom): no action is named here, so
// adding one needs no change in this file. Every string the person reads comes
// from MESSAGES or the definitions resolved for the language (defsFor), never
// from a literal here.

const PANE = PLUGIN
const PANE_TITLE = 'Selection Actions'
const PANE_COLUMNS = 56
const COMMAND = PLUGIN
const POLL_MS = 300
const KEEP = 20
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const

// The pane's text colours, by placement. Docked on the right,
// the pane sits on a background core paints in the theme
// (composerSidebarBackground), while text with no colour is drawn in the
// terminal's own foreground: when the theme and the terminal disagree (a dark
// terminal on the light theme, or the other way round) that text vanishes.
// A theme key is drawn in the same theme as that background, so it reads
// either way. Inline, nothing paints the background, so the heading and body
// keep the terminal's foreground there, which suits the terminal's own
// background. A failure follows the same split: docked it is the theme's
// `error`; inline it stays the raw name `red`, as it was, which the terminal
// draws from its own palette, tuned to its own background where the theme's
// `error` is not (a colour prop admits a theme key, a name or hex, never an
// `ansi:` value). dimColor needs nothing: core draws it in the theme's
// `inactive`.
const PANE_COLORS = {
  dock: { heading: 'text', body: 'text', failed: 'error' },
  inline: { heading: undefined, body: undefined, failed: 'red' },
} as const

// The engine reads these references statically before the module runs, so
// `plugin` has to be the string literal itself: PLUGIN cannot stand in here.
// types/index.d.ts types these keys under the same name, so a drift fails tsc.
const selection = atom({ plugin: 'selection-actions', key: 'selection' } as const, null)
const dismissed = atom({ plugin: 'selection-actions', key: 'dismissed' } as const, null)
const results = atom({ plugin: 'selection-actions', key: 'results' } as const, [])

const quoteOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}

// The language: settled in register when the setting names one; for `auto`,
// by the first hook that needs it, whichever event comes first, and once only.
// A reload loads the module afresh, and register sets these again.
// Hooks read settledLanguage only through ensureLanguage, and pass the Lang it
// returns down as an argument (`lang` below is always that settled value).
let languageSetting: unknown
let settledLanguage: Lang | undefined
let pendingLanguage: Promise<Lang> | undefined

async function readQuietly<T>(pending: Promise<T>): Promise<T | undefined> {
  try {
    return await pending
  } catch {
    return undefined
  }
}

/**
 * resolveLanguage over what the engine answers: Claude Code's settings and the
 * locale, each read on its own, a failed read counting as unset. Never rejects.
 */
async function detectLanguage($: EngineInterface): Promise<Lang> {
  const [settings, LC_ALL, LC_MESSAGES, LANG] = await Promise.all([
    readQuietly($.settings.read()),
    readQuietly($.env.get('LC_ALL')),
    readQuietly($.env.get('LC_MESSAGES')),
    readQuietly($.env.get('LANG')),
  ])
  return resolveLanguage(languageSetting, { claudeLanguage: settings?.['language'], LC_ALL, LC_MESSAGES, LANG })
}

/** The language every hook draws and asks in: detected once, shared by concurrent callers. */
async function ensureLanguage($: EngineInterface): Promise<Lang> {
  if (settledLanguage !== undefined) return settledLanguage
  pendingLanguage ??= detectLanguage($).then(l => (settledLanguage = l))
  return pendingLanguage
}

let nextId = 1
const registeredAgents = new Set<string>()
const pendingAgents = new Map<string, number>()

async function settle($: EngineInterface, id: number, ok: boolean, text: string) {
  const status: Result['status'] = ok ? 'done' : 'failed'
  await update($, results, list => list.map(r => (r.id === id ? { ...r, status, text } : r)))
}

async function ensureAgent($: EngineInterface, def: ResolvedSubagentAction) {
  if (registeredAgents.has(def.id)) return
  await $.agent.register({
    name: def.id,
    description: def.description,
    prompt: def.prompt,
    tools: [...(def.tools ?? READ_ONLY_TOOLS)],
    model: def.model,
  })
  registeredAgents.add(def.id)
}

// A subagent answers later, through turn.complete; the others answer here.
async function startSubagent($: EngineInterface, def: ResolvedSubagentAction, lang: Lang, id: number, text: string) {
  const t = MESSAGES[lang]
  try {
    await ensureAgent($, def)
    const spawned = await $.agent.spawn({
      subagentType: subagentType(def),
      description: def.label,
      prompt: `${def.task}\n\n${wrap(text)}`,
    })
    if (spawned.deny !== undefined || spawned.agentId === undefined) {
      await settle($, id, false, t.couldNotStart(spawned.deny ?? 'no agent id'))
      return
    }
    pendingAgents.set(spawned.agentId, id)
  } catch (err) {
    await settle($, id, false, t.couldNotStart(messageOf(err)))
  }
}

async function run($: EngineInterface, def: ActionDef, lang: Lang, text: string) {
  const t = MESSAGES[lang]
  const id = nextId++
  const result: Result = { id, action: def.id, quote: quoteOf(text), status: 'running', text: '' }
  await update($, results, list => [result, ...list].slice(0, KEEP))
  await $.ui.open({ id: PANE, title: PANE_TITLE, columns: PANE_COLUMNS })
  // Back to the top, where this newest result is drawn (see ./scroll).
  await settleQuietly($.ui.scroll(toLatest(PANE)))

  if (def.kind === 'subagent') {
    await startSubagent($, def, lang, id, text)
    return
  }

  try {
    const r =
      def.kind === 'fork'
        ? await $.model.fork({ prompt: `${wrap(text)}\n\n${def.prompt} ${answerStyle(lang)}` })
        : await $.model.complete({
            model: def.model,
            system: def.prompt,
            prompt: wrap(text),
            effort: 'low',
            maxTokens: def.maxTokens ?? 1500,
            timeoutMs: 60_000,
          })

    await settle($, id, r.isAnswered, r.isAnswered ? r.text.trim() : t.noAnswer(r.reason))
  } catch (err) {
    // A thrown call must not leave the entry "running" for good.
    await settle($, id, false, t.failed(messageOf(err)))
  }
}

async function runOnSelection($: EngineInterface, def: ActionDef, lang: Lang) {
  const picked = (await $.ui.selection())?.text.trim()
  if (!picked) {
    $.ui.toast(MESSAGES[lang].noSelection)
    return
  }
  // Done with this selection: its icons go until another one is made. The
  // engine keeps answering it after a click elsewhere, so this is what hides them.
  await update($, dismissed, () => picked)
  await run($, def, lang, picked)
}

export const register: Register = (on, options) => {
  // Options change reloads the module, so reading the settings once here is
  // enough. The custom definitions join the built-ins after them; one that is
  // invalid is left out, with its reason kept in `problems` to show the person.
  const custom = parseCustomActions(options.customActions, [...ACTIONS.map(a => a.id), 'close'])
  const problems = custom.problems
  const allSpecs: readonly ActionSpec[] = [...ACTIONS, ...custom.specs]

  // The IDs alone are resolved here: they do not depend on the language.
  const enabledIds = resolveActions(allSpecs, options.actions).map(a => a.id)
  const firstId = enabledIds[0]!

  // Kept here, with this load's settings, rather than in a module-level cache
  // like actionsFor's: the custom definitions change with the setting, and
  // nothing from an earlier load may linger should the module be reused.
  const resolvedDefs: Partial<Record<Lang, readonly ActionDef[]>> = {}
  const defsFor = (l: Lang): readonly ActionDef[] => (resolvedDefs[l] ??= resolveAll(allSpecs, l))

  languageSetting = options.language
  settledLanguage = explicitLanguage(options.language)
  pendingLanguage = undefined

  const enabledFor = (l: Lang): ActionDef[] => {
    const defs = defsFor(l)
    return enabledIds.flatMap(id => findAction(defs, id) ?? [])
  }

  on('session.start', async ($, e, next) => {
    const l = await ensureLanguage($)
    await $.command.register({
      name: COMMAND,
      description: MESSAGES[l].commandDescription,
      argumentHint: '[action-id]',
      immediate: true,
    })

    // The icons follow $.ui.selection(): once it answers undefined, the next
    // poll writes null and the hint line redraws without them. The engine
    // keeps answering the last selection after its highlight goes (so a press
    // can still read it) until the person selects again or their next prompt
    // or command has run: no event tells the module more, so a press of an
    // action or ✕ hides the icons for that selection (see `dismissed`).
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const text = (await $.ui.selection())?.text.trim() || null
        if (text !== (await read($, selection))) {
          await update($, selection, () => text)
        }
        // Gone for good: the same text selected later shows its icons again.
        if (text === null && (await read($, dismissed)) !== null) {
          await update($, dismissed, () => null)
        }
      })()
    })

    // Told once per session, with the first reason; the command's result has
    // them all. Not awaited, like the noSelection toast: a toast that is slow
    // or cannot show must hold up neither the icons nor the next handler.
    if (problems.length > 0) {
      const text = MESSAGES[l].customIgnoredToast(problems.length, problemLine(problems[0]!, l))
      void Promise.resolve()
        .then(() => $.ui.toast(text))
        .catch(() => {
          // The command's result still lists them.
        })
    }

    return next(e)
  })

  // The subagent types exist for the icons alone: the main model is not offered them.
  for (const def of allSpecs) {
    if (def.kind !== 'subagent') continue
    on('agent.offer', { agent: subagentType(def) }, () => ({ isOffered: false })).catch(() => ({ isOffered: false }))
  }

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId === undefined ? undefined : pendingAgents.get(e.agentId)
    if (e.agentId !== undefined && id !== undefined) {
      pendingAgents.delete(e.agentId)
      const l = await ensureLanguage($)
      const ok = e.reason === 'answer' && e.answer.trim() !== ''
      await settle($, id, ok, ok ? e.answer.trim() : MESSAGES[l].noAnswer(e.reason))
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const defs = defsFor(l)
    const wanted = e.args.trim().toLowerCase()
    const def = findAction(defs, wanted === '' ? firstId : wanted)
    // Whatever the result, the custom definitions left out follow it, so this
    // command is where the person can always read why.
    if (def === undefined) {
      // Told once, as the command's result: why its definition was left out,
      // or else the IDs that do exist.
      const ignored = problemFor(problems, wanted)
      const text =
        ignored === undefined ? t.unknownId(wanted, defs.map(a => a.id)) : t.customIgnoredId(wanted, reasonText(ignored.reason, l))
      return { text: withProblems(text, problems, l) }
    }
    await runOnSelection($, def, l)

    return { text: withProblems(t.showing(PANE_TITLE, def.label), problems, l) }
  })

  // The icons take the hint line under the prompt, a row that is always there:
  // a band above the prompt would add a row mid-drag and shift the transcript.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = await read($, selection)
    if (e.props.isDraft || text === null || text === (await read($, dismissed))) {
      return next(e)
    }

    const l = await ensureLanguage($)
    const enabled = enabledFor(l)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        {enabled.map((a, i) => (
          <Box key={`act-${a.id}`} hover={{ scope: `tip-action-${a.id}` }}>
            <Button
              key={a.id}
              label={a.icon}
              hotkey={HOTKEYS[i]}
              onPress={() => runOnSelection($, a, l)}
            />
          </Box>
        ))}
        <Box key="act-close" hover={{ scope: 'tip-close' }}>
          <Button
            key="close"
            label="✕"
            dimColor
            role="dismiss"
            onPress={() => update($, dismissed, () => text)}
          />
        </Box>
        {enabled.map(a => (
          <Box display="none" hover={{ scope: `tip-action-${a.id}`, display: 'flex' }}>
            <Text color="cyan"> {a.label}</Text>
          </Box>
        ))}
        <Box display="none" hover={{ scope: 'tip-close', display: 'flex' }}>
          <Text color="cyan"> {MESSAGES[l].close}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const defs = defsFor(l)
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, results)
    const colors = e.props.placement === 'inline' ? PANE_COLORS.inline : PANE_COLORS.dock

    return (
      <Box flexDirection="column">
        {problems.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color={colors.failed}>{t.customProblemsHeading}</Text>
            {problems.map((p, i) => (
              <Text key={i} color={colors.failed}>- {problemLine(p, l)}</Text>
            ))}
          </Box>
        )}
        {e.props.placement === 'inline' && (
          <Text dimColor>{t.inlineHint}</Text>
        )}
        {list.length === 0 && (
          <Text dimColor>{t.emptyPane}</Text>
        )}
        {list.map(r => {
          const def = findAction(defs, r.action)
          return (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color={colors.heading}>
                {def?.icon ?? '•'} {def?.label ?? r.action} <Text dimColor>{t.quote(r.quote)}</Text>
              </Text>
              {r.status === 'running' ? (
                <Text dimColor>{def?.runningText ?? t.thinking}</Text>
              ) : (
                <Text color={r.status === 'failed' ? colors.failed : colors.body}>{r.text}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
