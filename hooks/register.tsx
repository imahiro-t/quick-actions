import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Result } from '../types'
import {
  ACTIONS,
  PLUGIN,
  READ_ONLY_TOOLS,
  findAction,
  isContext,
  markedIcon,
  messageOf,
  resolveAll,
  subagentType,
  wrap,
} from './actions'
import type { ActionDef, ActionSpec, ResolvedSubagentAction } from './actions'
import { parseCustomActions, problemFor, problemLine, reasonText, withProblems } from './custom'
import { MESSAGES, answerStyle, explicitLanguage, resolveLanguage } from './i18n'
import type { Lang } from './i18n'
import { USAGE_KEY, orderActions, parseHintCount, parsePins, parseUsage, recordUse, settleIn } from './order'
import type { OrderSlot } from './order'
import { settleQuietly, toLatest } from './scroll'

// Everything below is driven by the definitions in ./actions and the person's
// own from the `customActions` setting (./custom): no action is named here, so
// adding one needs no change in this file. Every string the person reads comes
// from MESSAGES or the definitions resolved for the language (defsFor), never
// from a literal here.

const PANE = PLUGIN
const PANE_TITLE = 'Quick Actions'
const PANE_COLUMNS = 56
const COMMAND = PLUGIN
// `/quick-actions hint`: the hint line without a selection. Reserved, so no
// custom action can take it as its ID.
const HINT_ARG = 'hint'
const POLL_MS = 300
const KEEP = 20
// The ⋯ dialog: a pane of its own beside the results. The keys of what it
// adds (⋯ on the hint line, the dialog's list and close button) start with
// `_`, which no action's ID can (those are lowercase letters, digits and
// hyphens), so no custom action's element ever shares one.
const PICKER = `${PLUGIN}-picker`
const MORE_KEY = '_more'
const PICKER_SELECT_KEY = '_picker'
const PICKER_CLOSE_KEY = '_picker-close'

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
const selection = atom({ plugin: 'quick-actions', key: 'selection' } as const, null)
const dismissed = atom({ plugin: 'quick-actions', key: 'dismissed' } as const, null)
const results = atom({ plugin: 'quick-actions', key: 'results' } as const, [])
const picking = atom({ plugin: 'quick-actions', key: 'picking' } as const, null)
const hint = atom({ plugin: 'quick-actions', key: 'hint' } as const, null)

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

// The usage scores (./order) are read, added to and written back one use at a
// time, so two runs close together never lose one. A failure (the store
// refused, over its 4 MiB) loses that use alone: the action runs regardless.
let usageWrite: Promise<void> = Promise.resolve()

/** Adds one use of `id` to its score in `$.store`. Never rejects; the returned promise settles once it is written. */
function recordUsage($: EngineInterface, id: string): Promise<void> {
  usageWrite = usageWrite.then(async () => {
    try {
      const now = await $.clock.now()
      const usage = parseUsage(await $.store.get(USAGE_KEY))
      await $.store.set(USAGE_KEY, recordUse(usage, id, now))
    } catch {
      // This use goes unrecorded; see above.
    }
  })
  return usageWrite
}

// Every way an action runs (an icon, the ⋯ dialog, the command) comes here.
// `text` is the selected text a selection action runs on; a context action
// runs on the conversation and reads none. Any run closes the hint line that
// `/quick-actions hint` opened.
async function run($: EngineInterface, def: ActionDef, lang: Lang, text: string) {
  const t = MESSAGES[lang]
  const context = isContext(def)
  // Not awaited: the score must not hold up the answer.
  void recordUsage($, def.id)
  await update($, hint, () => null)
  const id = nextId++
  const result: Result = { id, action: def.id, quote: context ? '' : quoteOf(text), status: 'running', text: '' }
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
        ? await $.model.fork({
            prompt: context ? `${def.prompt} ${answerStyle(lang)}` : `${wrap(text)}\n\n${def.prompt} ${answerStyle(lang)}`,
          })
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

/** The text selected now, trimmed; undefined (and a toast saying so) when there is none. */
async function selectedText($: EngineInterface, lang: Lang): Promise<string | undefined> {
  const picked = (await $.ui.selection())?.text.trim()
  if (!picked) {
    $.ui.toast(MESSAGES[lang].noSelection)
    return undefined
  }
  return picked
}

async function runOnText($: EngineInterface, def: ActionDef, lang: Lang, text: string) {
  // Done with this selection: its icons go until another one is made. The
  // engine keeps answering it after a click elsewhere, so this is what hides them.
  await update($, dismissed, () => text)
  await run($, def, lang, text)
}

/** Runs `def` on the text selected now; false (and a toast saying so) when there is none. */
async function runOnSelection($: EngineInterface, def: ActionDef, lang: Lang): Promise<boolean> {
  const picked = await selectedText($, lang)
  if (picked === undefined) return false
  await runOnText($, def, lang, picked)
  return true
}

/** A context action: on the conversation, with no selection to read. */
async function runOnConversation($: EngineInterface, def: ActionDef, lang: Lang) {
  await run($, def, lang, '')
}

/** The text selected now, trimmed; null when there is none. No toast. */
async function selectionNow($: EngineInterface): Promise<string | null> {
  return (await $.ui.selection())?.text.trim() || null
}

/** The order of `specs` (every action of this load) by ID, `pins` first, from the usage scores as they stand now. Never rejects. */
async function computeOrder($: EngineInterface, specs: readonly ActionSpec[], pins: readonly ActionSpec[]): Promise<readonly string[]> {
  // An unreadable store counts as no usage: the actions still show.
  const usage = parseUsage(await readQuietly($.store.get(USAGE_KEY)))
  const now = (await readQuietly($.clock.now())) ?? 0
  return orderActions(specs, pins, usage, now).map(a => a.id)
}

/** What one load orders: every action of it, its pins, and where its settled order is kept. */
type OrderLoad = { specs: readonly ActionSpec[]; pins: readonly ActionSpec[]; slot: OrderSlot }

/** The settled order of `load`'s actions by ID, computed the first time it is asked for. Never rejects. */
async function ensureOrder($: EngineInterface, load: OrderLoad): Promise<readonly string[]> {
  return settleIn(load.slot, () => computeOrder($, load.specs, load.pins))
}

/**
 * Opens the ⋯ dialog on `text` (null: none), or, left out, on the text
 * selected now. The text is kept in `picking` as it opens, so a pick runs on
 * it however the selection changes meanwhile. With no text, the dialog lists
 * the context actions alone.
 */
async function openPicker($: EngineInterface, lang: Lang, rows: number, text?: string | null) {
  const picked = text === undefined ? await selectionNow($) : text
  await update($, picking, () => ({ text: picked }))
  // The same width as the results: an open without `columns` resets the dock to
  // its default share, which widens it for as long as the dialog is open.
  await $.ui.open({ id: PICKER, title: MESSAGES[lang].pickerTitle, focus: true, closeOnEscape: true, rows, columns: PANE_COLUMNS })
}

/**
 * Closes the ⋯ dialog from within (a pick, its close button) and lets go of
 * the text it held. The plugin's own close does not pass through its own
 * `ui.close` hook, which covers the person's (Escape, the close mark).
 */
async function closePicker($: EngineInterface) {
  await update($, picking, () => null)
  await readQuietly($.ui.close({ id: PICKER }))
}

/**
 * A pick in the ⋯ dialog: runs `def` on the text the dialog opened on, read
 * before the dialog closes and lets go of it; a context action, on the
 * conversation. Either way, that text's icons go, as after a press on them.
 */
async function pick($: EngineInterface, lang: Lang, def: ActionDef | undefined) {
  const text = (await read($, picking))?.text ?? null
  await closePicker($)
  if (def === undefined) return
  if (isContext(def)) {
    if (text !== null) await update($, dismissed, () => text)
    await runOnConversation($, def, lang)
    return
  }
  if (text === null) {
    $.ui.toast(MESSAGES[lang].noSelection)
    return
  }
  await runOnText($, def, lang, text)
}

export const register: Register = (on, options) => {
  // Options change reloads the module, so reading the settings once here is
  // enough. The custom definitions join the built-ins after them; one that is
  // invalid is left out, with its reason kept in `problems` to show the person.
  const custom = parseCustomActions(options.customActions, [...ACTIONS.map(a => a.id), 'close', HINT_ARG])
  const problems = custom.problems
  const allSpecs: readonly ActionSpec[] = [...ACTIONS, ...custom.specs]

  // The pins and the count alone are read here: they do not depend on the language.
  const pins = parsePins(allSpecs, options.actions)
  const hintCount = parseHintCount(options.hintCount)
  // Tall enough for every action in the ⋯ dialog, its notice and its button.
  const pickerRows = allSpecs.length + 4

  // The order of every action, settled once per load: at session start, or by
  // whichever hook needs it first. Uses during the session do not move it, so
  // an icon stays where the person reaches for it. Kept with this load, not in
  // the module: a settling an earlier load started (with its own definitions)
  // may finish after a reload, and must not become this load's order.
  const orderLoad: OrderLoad = { specs: allSpecs, pins, slot: {} }

  // Kept here, with this load's settings, rather than in a module-level cache
  // like actionsFor's: the custom definitions change with the setting, and
  // nothing from an earlier load may linger should the module be reused.
  const resolvedDefs: Partial<Record<Lang, readonly ActionDef[]>> = {}
  const defsFor = (l: Lang): readonly ActionDef[] => (resolvedDefs[l] ??= resolveAll(allSpecs, l))

  /** Every action in the settled order, resolved for the language: the ⋯ dialog's list; its first hintCount, the hint line's. */
  const inOrder = (ids: readonly string[], l: Lang): ActionDef[] => {
    const defs = defsFor(l)
    return ids.flatMap(id => findAction(defs, id) ?? [])
  }

  languageSetting = options.language
  settledLanguage = explicitLanguage(options.language)
  pendingLanguage = undefined

  on('session.start', async ($, e, next) => {
    const l = await ensureLanguage($)
    // The order for this session, from the usage so far.
    await ensureOrder($, orderLoad)
    await $.command.register({
      name: COMMAND,
      description: MESSAGES[l].commandDescription,
      argumentHint: `[action-id | ${HINT_ARG}]`,
      immediate: true,
    })

    // The icons follow $.ui.selection(): once it answers undefined, the next
    // poll writes null and the hint line redraws without them. The engine
    // keeps answering the last selection after its highlight goes (so a press
    // can still read it) until the person selects again or their next prompt
    // or command has run: no event tells the module more, so a press of an
    // action or ✕ hides the icons for that selection (see `dismissed`).
    //
    // The hint line `/quick-actions hint` opened (`hint`) holds the text
    // selected as the command ran, since running the command is itself what
    // makes the engine stop answering that selection: its going closes
    // nothing. A selection made after it opened arms it (one whose text is the
    // held one does not: that may be the held selection itself, seen late),
    // and that selection going closes it, as a selection's going hides its icons.
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const text = await selectionNow($)
        // Read before the write below, so the change is seen.
        const previous = await read($, selection)
        if (text !== previous) {
          await update($, selection, () => text)
        }
        const opened = await read($, hint)
        if (opened !== null) {
          if (!opened.armed && text !== null && text !== previous && text !== opened.text) {
            await update($, hint, h => (h === null ? h : { ...h, armed: true }))
          } else if (opened.armed && previous !== null && text === null) {
            await update($, hint, () => null)
          }
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
    // Without an ID: the ⋯ dialog, on the text selected now (with none, the context actions).
    if (wanted === '') {
      await openPicker($, l, pickerRows)
      return { text: withProblems(t.pickerOpened, problems, l) }
    }
    // `hint`: the hint line, on the text selected now, held here while the
    // engine still answers it (see the poll in session.start).
    if (wanted === HINT_ARG) {
      const held = await selectionNow($)
      await update($, hint, () => ({ text: held, armed: false }))
      await update($, dismissed, () => null)
      return { text: withProblems(t.hintOpened, problems, l) }
    }
    const def = findAction(defs, wanted)
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
    if (isContext(def)) await runOnConversation($, def, l)
    else if (!(await runOnSelection($, def, l))) return { text: withProblems(t.noSelection, problems, l) }

    return { text: withProblems(t.showing(PANE_TITLE, def.label), problems, l) }
  })

  // The icons take the hint line under the prompt, a row that is always there:
  // a band above the prompt would add a row mid-drag and shift the transcript.
  //
  // Shown on the text selected now, both kinds of action; else, while
  // `/quick-actions hint` holds it open, on the text it held (both kinds) or,
  // with none, the context actions alone.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.props.isDraft) return next(e)
    const selected = await read($, selection)
    const current = selected !== null && selected !== (await read($, dismissed)) ? selected : null
    const opened = await read($, hint)
    if (current === null && opened === null) return next(e)
    // What a selection action on this line runs on.
    const text = current ?? opened?.text ?? null

    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    // The first hintCount in the order, of the kinds that apply; pins beyond it too wait under ⋯.
    const ordered = inOrder(await ensureOrder($, orderLoad), l)
    const enabled = (text === null ? ordered.filter(isContext) : ordered).slice(0, hintCount)
    const { Box, Button, Text } = $.ui.resolve(e)

    // A press puts this line away, whichever kind it runs: the selection's
    // icons (dismissed) and the line `hint` opened.
    const press = async (a: ActionDef) => {
      if (isContext(a)) {
        if (current !== null) await update($, dismissed, () => current)
        await runOnConversation($, a, l)
      } else if (current !== null) {
        await runOnSelection($, a, l)
      } else if (text !== null) {
        await run($, a, l, text)
      }
    }
    const close = async () => {
      if (current !== null) await update($, dismissed, () => current)
      await update($, hint, () => null)
    }

    return (
      <Box flexDirection="row">
        {enabled.map(a => (
          <Box key={`act-${a.id}`} hover={{ scope: `tip-action-${a.id}` }}>
            <Button
              key={a.id}
              label={markedIcon(a)}
              onPress={() => press(a)}
            />
          </Box>
        ))}
        <Box key="act-close" hover={{ scope: 'tip-close' }}>
          <Button
            key="close"
            label="✕"
            dimColor
            role="dismiss"
            onPress={close}
          />
        </Box>
        <Box key={`act-${MORE_KEY}`} hover={{ scope: 'tip-more' }}>
          <Button
            key={MORE_KEY}
            label="⋯"
            onPress={() => openPicker($, l, pickerRows, text)}
          />
        </Box>
        {enabled.map(a => (
          <Box display="none" hover={{ scope: `tip-action-${a.id}`, display: 'flex' }}>
            <Text color="cyan"> {a.label}</Text>
          </Box>
        ))}
        <Box display="none" hover={{ scope: 'tip-close', display: 'flex' }}>
          <Text color="cyan"> {t.close}</Text>
        </Box>
        <Box display="none" hover={{ scope: 'tip-more', display: 'flex' }}>
          <Text color="cyan"> {t.allActions}</Text>
        </Box>
      </Box>
    )
  })

  // The ⋯ dialog: every action, in the hint line's order, as "[icon] label" or
  // "<icon> label"; opened with no text, the context actions alone.
  // Opened with focus, a Select takes the keys (arrows move, Enter runs);
  // Escape closes it through closeOnEscape. Focus is a request the engine
  // refuses while the composer holds text: then a line says how to get the
  // keys, and the list and the close button still answer a click. The mobile
  // app gets no such line: its actions are buttons to tap, and no keys.
  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const l = await ensureLanguage($)
    const t = MESSAGES[l]
    const state = await read($, picking)
    const all = inOrder(await ensureOrder($, orderLoad), l)
    const ordered = state?.text === null ? all.filter(isContext) : all
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // The mobile app draws no Select (though its table names one): there the
    // actions are buttons.
    const Select = e.surface !== 'mobile' && 'Select' in elements ? elements.Select : undefined
    const keyboardNotice = e.surface !== 'mobile' && !e.props.isFocused

    return (
      <Box flexDirection="column">
        {keyboardNotice && <Text dimColor>{t.pickerNoFocus}</Text>}
        {state === null ? (
          <Text dimColor>{t.noSelection}</Text>
        ) : Select !== undefined ? (
          <Select
            key={PICKER_SELECT_KEY}
            label={t.pickerLabel}
            autoFocus
            options={ordered.map(a => ({ value: a.id, label: `${markedIcon(a)} ${a.label}` }))}
            onSelect={value => pick($, l, findAction(ordered, value))}
          />
        ) : (
          <Box flexDirection="column">
            {ordered.map(a => (
              <Button key={a.id} label={`${markedIcon(a)} ${a.label}`} onPress={() => pick($, l, a)} />
            ))}
          </Box>
        )}
        <Button key={PICKER_CLOSE_KEY} label={t.pickerClose} dimColor role="dismiss" onPress={() => closePicker($)} />
      </Box>
    )
  })

  // The person's close (Escape through closeOnEscape, the close mark): the
  // text it held goes with it and nothing runs. Closes from within go
  // through closePicker, which does the same.
  on('ui.close', { id: PICKER }, async ($, e, next) => {
    await update($, picking, () => null)
    return next(e)
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
              <Text key={String(i)} color={colors.failed}>- {problemLine(p, l)}</Text>
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
                {def?.icon ?? '•'} {def?.label ?? r.action}{' '}
                <Text dimColor>{r.quote === '' ? t.onConversation : t.quote(r.quote)}</Text>
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
