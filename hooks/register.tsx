import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Result } from '../types'
import {
  ACTIONS,
  PLUGIN,
  READ_ONLY_TOOLS,
  STYLE,
  findAction,
  messageOf,
  resolveActions,
  subagentType,
  wrap,
} from './actions'
import type { ActionDef, SubagentAction } from './actions'
import { settleQuietly, toLatest } from './scroll'

// Everything below is driven by the definitions in ./actions: no action is
// named here, so adding one there needs no change in this file.

const PANE = PLUGIN
const PANE_TITLE = 'Selection Actions'
const PANE_COLUMNS = 56
const COMMAND = PLUGIN
const POLL_MS = 300
const KEEP = 20
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const

// The engine reads these references statically before the module runs, so
// `plugin` has to be the string literal itself: PLUGIN cannot stand in here.
// types/index.d.ts types these keys under the same name, so a drift fails tsc.
const selection = atom({ plugin: 'selection-actions', key: 'selection' } as const, null)
const results = atom({ plugin: 'selection-actions', key: 'results' } as const, [])

const quoteOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}

let nextId = 1
const registeredAgents = new Set<string>()
const pendingAgents = new Map<string, number>()

async function settle($: EngineInterface, id: number, ok: boolean, text: string) {
  const status: Result['status'] = ok ? 'done' : 'failed'
  await update($, results, list => list.map(r => (r.id === id ? { ...r, status, text } : r)))
}

async function ensureAgent($: EngineInterface, def: SubagentAction) {
  if (registeredAgents.has(def.id)) return
  await $.agent.register({
    name: def.id,
    description: def.description ?? `${def.label} for the selected text (selection-actions only)`,
    prompt: def.prompt,
    tools: [...(def.tools ?? READ_ONLY_TOOLS)],
    model: def.model,
  })
  registeredAgents.add(def.id)
}

// A subagent answers later, through turn.complete; the others answer here.
async function startSubagent($: EngineInterface, def: SubagentAction, id: number, text: string) {
  try {
    await ensureAgent($, def)
    const spawned = await $.agent.spawn({
      subagentType: subagentType(def),
      description: def.label,
      prompt: `${def.task}\n\n${wrap(text)}`,
    })
    if (spawned.deny !== undefined || spawned.agentId === undefined) {
      await settle($, id, false, `起動できませんでした: ${spawned.deny ?? 'no agent id'}`)
      return
    }
    pendingAgents.set(spawned.agentId, id)
  } catch (err) {
    await settle($, id, false, `起動できませんでした: ${messageOf(err)}`)
  }
}

async function run($: EngineInterface, def: ActionDef, text: string) {
  const id = nextId++
  const result: Result = { id, action: def.id, quote: quoteOf(text), status: 'running', text: '' }
  await update($, results, list => [result, ...list].slice(0, KEEP))
  await $.ui.open({ id: PANE, title: PANE_TITLE, columns: PANE_COLUMNS })
  // Back to the top, where this newest result is drawn (see ./scroll).
  await settleQuietly($.ui.scroll(toLatest(PANE)))

  if (def.kind === 'subagent') {
    await startSubagent($, def, id, text)
    return
  }

  try {
    const r =
      def.kind === 'fork'
        ? await $.model.fork({ prompt: `${wrap(text)}\n\n${def.prompt} ${STYLE}` })
        : await $.model.complete({
            model: def.model,
            system: def.prompt,
            prompt: wrap(text),
            effort: 'low',
            maxTokens: def.maxTokens ?? 1500,
            timeoutMs: 60_000,
          })

    await settle($, id, r.isAnswered, r.isAnswered ? r.text.trim() : `回答なし (${r.reason})`)
  } catch (err) {
    // A thrown call must not leave the entry "running" for good.
    await settle($, id, false, `失敗しました: ${messageOf(err)}`)
  }
}

async function runOnSelection($: EngineInterface, def: ActionDef) {
  const picked = (await $.ui.selection())?.text.trim()
  if (!picked) {
    $.ui.toast('選択されたテキストがありません')
    return
  }
  await run($, def, picked)
}

export const register: Register = (on, options) => {
  // Options change reloads the module, so resolving once here is enough.
  const enabled = resolveActions(ACTIONS, options.actions)
  const first = enabled[0]!

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Run a selection action on the text selected in the transcript (default: the first enabled action)',
      argumentHint: '[action-id]',
      immediate: true,
    })

    // The icons follow $.ui.selection(): once it answers undefined, the next
    // poll writes null and the hint line redraws without them. The engine
    // keeps answering the last selection after its highlight goes (so a press
    // can still read it) until the person selects again, dismisses it, or
    // their next prompt or command has run: no event tells the module more.
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const text = (await $.ui.selection())?.text.trim() || null
        if (text !== (await read($, selection))) {
          await update($, selection, () => text)
        }
      })()
    })

    return next(e)
  })

  // The subagent types exist for the icons alone: the main model is not offered them.
  for (const def of ACTIONS) {
    if (def.kind !== 'subagent') continue
    on('agent.offer', { agent: subagentType(def) }, () => ({ isOffered: false })).catch(() => ({ isOffered: false }))
  }

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId === undefined ? undefined : pendingAgents.get(e.agentId)
    if (e.agentId !== undefined && id !== undefined) {
      pendingAgents.delete(e.agentId)
      const ok = e.reason === 'answer' && e.answer.trim() !== ''
      await settle($, id, ok, ok ? e.answer.trim() : `回答なし (${e.reason})`)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const def = wanted === '' ? first : findAction(ACTIONS, wanted)
    if (def === undefined) {
      // Told once, as the command's result, with the IDs that do exist.
      return { text: `不明なアクション ID です: ${wanted}（使える ID: ${ACTIONS.map(a => a.id).join(', ')}）` }
    }
    await runOnSelection($, def)

    return { text: `${PANE_TITLE} ペインに ${def.label} の結果を表示します。` }
  })

  // The icons take the hint line under the prompt, a row that is always there:
  // a band above the prompt would add a row mid-drag and shift the transcript.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = await read($, selection)
    if (e.props.isDraft || text === null) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        {enabled.map((a, i) => (
          <Box key={`act-${a.id}`} hover={{ scope: `tip-action-${a.id}` }}>
            <Button
              key={a.id}
              label={a.icon}
              hotkey={HOTKEYS[i]}
              onPress={() => runOnSelection($, a)}
            />
          </Box>
        ))}
        {enabled.map(a => (
          <Box display="none" hover={{ scope: `tip-action-${a.id}`, display: 'flex' }}>
            <Text color="cyan"> {a.label}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, results)

    return (
      <Box flexDirection="column">
        {e.props.placement === 'inline' && (
          <Text dimColor>
            ターミナル幅を 110 桁以上にすると、このペインは右側に表示されます（フルスクリーン表示時）。
          </Text>
        )}
        {list.length === 0 && (
          <Text dimColor>テキストを選択して、プロンプト下のヒント行のアイコンを押してください。</Text>
        )}
        {list.map(r => {
          const def = findAction(ACTIONS, r.action)
          return (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>
                {def?.icon ?? '•'} {def?.label ?? r.action} <Text dimColor>「{r.quote}」</Text>
              </Text>
              {r.status === 'running' ? (
                <Text dimColor>{def?.runningText ?? '考え中…'}</Text>
              ) : (
                <Text color={r.status === 'failed' ? 'red' : undefined}>{r.text}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
