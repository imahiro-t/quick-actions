import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ActionId, Result } from '../types'

const PANE = 'explain'
const PANE_COLUMNS = 56
const FINDER = 'code-finder'
const POLL_MS = 300
const KEEP = 20

const selection = atom({ plugin: 'explain', key: 'selection' } as const, null)
const dismissed = atom({ plugin: 'explain', key: 'dismissed' } as const, null)
const results = atom({ plugin: 'explain', key: 'results' } as const, [])

type Action = { id: ActionId; icon: string; label: string; hotkey: string }

const ACTIONS: readonly Action[] = [
  { id: 'meaning', icon: '💡', label: '意味', hotkey: '1' },
  { id: 'translate', icon: '🌐', label: '日本語訳', hotkey: '2' },
  { id: 'code', icon: '🔎', label: 'コードの根拠', hotkey: '3' },
  { id: 'ask', icon: '💬', label: 'Claudeに聞く', hotkey: '4' },
]

const actionOf = (id: ActionId): Action => ACTIONS.find(a => a.id === id) ?? ACTIONS[0]!

const STYLE = 'Answer in Japanese, in plain prose suited to a terminal pane (no headings, no tables).'

const MEANING = [
  'You explain text a developer selected in their Claude Code terminal session:',
  'command output, error messages, logs, code or unfamiliar terms.',
  'Say what it means, why it likely appeared, and what to do about it if anything.',
  'Keep it under about 15 lines.',
  STYLE,
].join(' ')

const TRANSLATE = [
  'Translate the selected text into natural Japanese.',
  'Keep code, identifiers, paths and commands as they are.',
  'Reply with the translation alone.',
].join(' ')

const FINDER_PROMPT = [
  'You locate the code in the current repository that the given text comes from or depends on:',
  'where a message, error, log line, identifier or behaviour originates.',
  'Search with Grep and Glob, read with Read; change nothing.',
  'Reply with the few most relevant locations as `path:line`, each followed by one or two lines',
  'on why it is the evidence, then a short conclusion. If nothing in the repository matches, say so.',
  STYLE,
].join(' ')

const quoteOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}

const wrap = (text: string) => `<selected>\n${text}\n</selected>`

let nextId = 1
let isFinderReady = false
const finders = new Map<string, number>()

async function settle($: EngineInterface, id: number, ok: boolean, text: string) {
  const status: Result['status'] = ok ? 'done' : 'failed'
  await update($, results, list =>
    list.map(r => (r.id === id ? { ...r, status, text } : r)),
  )
}

async function ensureFinder($: EngineInterface) {
  if (isFinderReady) return
  await $.agent.register({
    name: FINDER,
    description: 'Locates the repository code a piece of selected text comes from (explain mod only)',
    prompt: FINDER_PROMPT,
    tools: ['Read', 'Grep', 'Glob'],
    model: 'sonnet',
  })
  isFinderReady = true
}

async function run($: EngineInterface, actionId: ActionId, text: string) {
  const id = nextId++
  const result: Result = { id, action: actionId, quote: quoteOf(text), status: 'running', text: '' }
  await update($, results, list => [result, ...list].slice(0, KEEP))
  await $.ui.open({ id: PANE, title: 'Explain', columns: PANE_COLUMNS })

  if (actionId === 'code') {
    try {
      await ensureFinder($)
      const spawned = await $.agent.spawn({
        subagentType: `explain:${FINDER}`,
        description: 'Find code evidence',
        prompt: `Find where in this repository the following text comes from.\n\n${wrap(text)}`,
      })
      if (spawned.deny !== undefined || spawned.agentId === undefined) {
        await settle($, id, false, `起動できませんでした: ${spawned.deny ?? 'no agent id'}`)
        return
      }
      finders.set(spawned.agentId, id)
    } catch (err) {
      await settle($, id, false, `起動できませんでした: ${String(err)}`)
    }
    return
  }

  const r =
    actionId === 'ask'
      ? await $.model.fork({
          prompt: `${wrap(text)}\n\nExplain the selected text in the context of what we are working on in this session. ${STYLE}`,
        })
      : await $.model.complete({
          model: actionId === 'translate' ? 'haiku' : 'sonnet',
          system: actionId === 'translate' ? TRANSLATE : MEANING,
          prompt: wrap(text),
          effort: 'low',
          maxTokens: 1500,
          timeoutMs: 60_000,
        })

  await settle($, id, r.isAnswered, r.isAnswered ? r.text.trim() : `回答なし (${r.reason})`)
}

async function runOnSelection($: EngineInterface, actionId: ActionId) {
  const picked = (await $.ui.selection())?.text.trim()
  if (!picked) {
    $.ui.toast('選択されたテキストがありません')
    return
  }
  await run($, actionId, picked)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'explain',
      description: 'Explain the text selected in the transcript (opens the Explain pane)',
      immediate: true,
    })

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

  on('agent.offer', { agent: 'explain:code-finder' }, () => ({ isOffered: false }))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId === undefined ? undefined : finders.get(e.agentId)
    if (e.agentId !== undefined && id !== undefined) {
      finders.delete(e.agentId)
      const ok = e.reason === 'answer' && e.answer.trim() !== ''
      await settle($, id, ok, ok ? e.answer.trim() : `回答なし (${e.reason})`)
    }

    return next(e)
  })

  on('command.run', { command: 'explain' }, async $ => {
    await runOnSelection($, 'meaning')

    return { text: 'Explain ペインに表示します。' }
  })

  // The icons take the hint line under the prompt, a row that is always there:
  // a band above the prompt would add a row mid-drag and shift the transcript.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = await read($, selection)
    if (e.props.isDraft || text === null || text === (await read($, dismissed))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        {ACTIONS.map(a => (
          <Box key={`act-${a.id}`} hover={{ scope: `tip-${a.id}` }}>
            <Button
              key={a.id}
              label={a.icon}
              hotkey={a.hotkey}
              onPress={() => runOnSelection($, a.id)}
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
        {ACTIONS.map(a => (
          <Box display="none" hover={{ scope: `tip-${a.id}`, display: 'flex' }}>
            <Text color="cyan"> {a.label}</Text>
          </Box>
        ))}
        <Box display="none" hover={{ scope: 'tip-close', display: 'flex' }}>
          <Text color="cyan"> 閉じる</Text>
        </Box>
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
          <Text dimColor>テキストを選択して、プロンプト上のアイコンを押してください。</Text>
        )}
        {list.map(r => {
          const a = actionOf(r.action)
          return (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>
                {a.icon} {a.label} <Text dimColor>「{r.quote}」</Text>
              </Text>
              {r.status === 'running' ? (
                <Text dimColor>{r.action === 'code' ? 'リポジトリを調査中…' : '考え中…'}</Text>
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
