import { expect, test } from './kit'

import { ACTIONS } from '../hooks/actions'
import { base64Encode, utf8Encode } from '../hooks/codec'
import { parseCustomActions, problemLine } from '../hooks/custom'
import {
  ALLOWLIST_RELATIVE,
  ENV_BIN,
  EXEC_ARGS_MAX,
  EXEC_ARG_MAX,
  EXEC_FILE_MAX,
  EXEC_OUTPUT_MAX,
  EXEC_PATH,
  EXEC_STDERR_MAX,
  EXEC_STDIN_MAX,
  EXEC_TIMEOUT_DEFAULT_MS,
  EXEC_TIMEOUT_MAX_MS,
  EXEC_TIMEOUT_MIN_MS,
  allowlistOf,
  allowlistPlace,
  approvalQuestion,
  buildInvocation,
  conversationInput,
  cutText,
  execFailureText,
  execOutputText,
  hashOf,
  isSafeExecPath,
  isTimeout,
  locate,
  matchAllowlist,
  parseAllowlist,
  parseApprovals,
  pathShown,
  sameApproval,
  scopeVerdict,
  tidied,
  usableHome,
  utf8Length,
} from '../hooks/exec'
import type { ExecHostEnv } from '../hooks/exec'
import { MESSAGES } from '../hooks/i18n'
import { showHiddenNoted } from '../hooks/selection-local'
import { sha256 } from '../hooks/sha'

// The exec kind of custom action (SELM-00117), its pure parts: the
// definition's checks, the allowlist, the argument vector and the standard
// input, the approval's record and question, and the output as shown.

const RESERVED = [...ACTIONS.map(a => a.id), 'close', 'hint']
const json = (defs: unknown[]) => JSON.stringify(defs)

const UPPER = { id: 'upper', icon: '🔠', label: 'Upper', kind: 'exec', command: '/opt/tools/upper.sh' }

// ---------------------------------------------------------------------------
// The definition

test('exec: valid on each of the three targets, with its defaults', () => {
  const { specs, problems } = parseCustomActions(
    json([
      UPPER,
      { ...UPPER, id: 'talk', target: 'context', args: ['--json', '$(x)'], timeoutMs: 5000 },
      { ...UPPER, id: 'free', target: 'none', runningText: 'Running…' },
    ]),
    RESERVED,
  )
  expect(problems).toEqual([])
  expect(specs).toHaveLength(3)
  expect(specs[0]).toEqual({ id: 'upper', icon: '🔠', label: { ja: 'Upper', en: 'Upper' }, kind: 'exec', command: '/opt/tools/upper.sh', args: [], timeoutMs: EXEC_TIMEOUT_DEFAULT_MS })
  // The fixed arguments are kept exactly as written, `$(x)` included: never expanded.
  expect(specs[1]).toMatchObject({ kind: 'exec', target: 'context', args: ['--json', '$(x)'], timeoutMs: 5000 })
  expect(specs[2]).toMatchObject({ kind: 'exec', target: 'none', arg: { type: 'text' }, runningText: { ja: 'Running…', en: 'Running…' } })
})

test('exec: a command that is not an absolute path written as it lands is refused (execPath)', () => {
  const bad = ['upper.sh', './upper.sh', '~/bin/upper.sh', 'jq', '/opt/../bin/sh', '/opt/./x', '/opt//x', '/opt/x/', '/opt/a=b', '/opt/x\u0000y', '/opt/x\ny', '/opt/\u202Ex', '/']
  for (const command of bad) {
    const { specs, problems } = parseCustomActions(json([{ ...UPPER, command }]), RESERVED)
    expect(specs).toEqual([])
    expect(problems[0]?.reason).toMatchObject({ code: 'execPath', field: 'command' })
  }
  const missing = parseCustomActions(json([{ ...UPPER, command: undefined }]), RESERVED)
  expect(missing.problems[0]?.reason).toEqual({ code: 'missing', field: 'command' })
  const long = parseCustomActions(json([{ ...UPPER, command: `/${'a'.repeat(5000)}` }]), RESERVED)
  expect(long.problems[0]?.reason).toMatchObject({ code: 'execPath' })
})

test('exec: args, timeoutMs and the fields of other kinds are checked', () => {
  const cases: [Record<string, unknown>, unknown][] = [
    [{ args: 'x' }, { code: 'invalid', field: 'args' }],
    [{ args: [1] }, { code: 'invalid', field: 'args' }],
    [{ args: ['a\u0000b'] }, { code: 'invalid', field: 'args' }],
    [{ args: Array.from({ length: EXEC_ARGS_MAX + 1 }, () => 'a') }, { code: 'invalid', field: 'args' }],
    [{ args: ['a'.repeat(EXEC_ARG_MAX + 1)] }, { code: 'invalid', field: 'args' }],
    [{ timeoutMs: EXEC_TIMEOUT_MIN_MS - 1 }, { code: 'invalid', field: 'timeoutMs' }],
    [{ timeoutMs: EXEC_TIMEOUT_MAX_MS + 1 }, { code: 'invalid', field: 'timeoutMs' }],
    [{ timeoutMs: 1500.5 }, { code: 'invalid', field: 'timeoutMs' }],
    [{ timeoutMs: '5000' }, { code: 'invalid', field: 'timeoutMs' }],
    [{ prompt: 'Do it.' }, { code: 'execField', field: 'prompt' }],
    [{ model: 'haiku' }, { code: 'execField', field: 'model' }],
    [{ tools: ['Bash'] }, { code: 'execField', field: 'tools' }],
    [{ task: 'x' }, { code: 'execField', field: 'task' }],
    [{ maxTokens: 10 }, { code: 'execField', field: 'maxTokens' }],
    [{ target: 'everything' }, { code: 'target', value: 'everything', allowed: ['selection', 'context', 'none'] }],
  ]
  for (const [extra, reason] of cases) {
    const { specs, problems } = parseCustomActions(json([{ ...UPPER, ...extra }]), RESERVED)
    expect(specs).toEqual([])
    expect(problems[0]?.reason).toEqual(reason)
  }
  // The bounds themselves and the most arguments are fine.
  const ok = parseCustomActions(
    json([
      { ...UPPER, id: 'a', timeoutMs: EXEC_TIMEOUT_MIN_MS },
      { ...UPPER, id: 'b', timeoutMs: EXEC_TIMEOUT_MAX_MS, args: Array.from({ length: EXEC_ARGS_MAX }, () => 'x'.repeat(EXEC_ARG_MAX)) },
    ]),
    RESERVED,
  )
  expect(ok.problems).toEqual([])
})

test('exec: every reason reads in both languages, English with no Japanese', () => {
  const { problems } = parseCustomActions(json([{ ...UPPER, command: 'jq' }, { ...UPPER, id: 'p', prompt: 'x' }]), RESERVED)
  expect(problemLine(problems[0]!, 'ja')).toBe(
    '#1 (upper): command は実行ファイルの絶対パスで書いてください（PATH からは探しません。~・相対パス・.・..・連続した /・末尾の /・=・制御文字は使えません。指定: jq）',
  )
  expect(problemLine(problems[0]!, 'en')).toBe(
    "#1 (upper): write command as the executable's absolute path (PATH is not searched; no ~, relative path, . or .. part, double /, / at the end, = or control character; given: jq)",
  )
  expect(problemLine(problems[1]!, 'en')).toBe('#2 (p): a definition of kind exec cannot have prompt')
  const reasons = [
    { code: 'execScope', why: 'unreadable' },
    { code: 'execScope', why: 'keys' },
    { code: 'execScope', why: 'mismatch' },
    { code: 'execScope', why: 'home' },
    { code: 'execAllowlist', why: 'noHome' },
    { code: 'execAllowlist', why: 'missing' },
    { code: 'execAllowlist', why: 'unreadable' },
    { code: 'execAllowlist', why: 'invalid' },
    { code: 'execAllowlist', why: 'inProject' },
    { code: 'execAllowlistEntry', entry: 2 },
    { code: 'execNotAllowed', path: '/opt/x' },
    { code: 'execMissing', path: '/opt/x' },
    { code: 'execPath', field: 'realPath', path: '/opt/a=b' },
    { code: 'execUnsupported' },
    { code: 'execTooLarge', max: EXEC_FILE_MAX },
    { code: 'execUnreadable', path: '/opt/x' },
    { code: 'execHashMismatch', path: '/opt/x' },
    { code: 'execRemote' },
    { code: 'execDeclined' },
    { code: 'execChanged' },
    { code: 'execInputTooLarge', max: EXEC_STDIN_MAX },
  ] as const
  for (const reason of reasons) {
    const ja = MESSAGES.ja.customReason(reason)
    const en = MESSAGES.en.customReason(reason)
    expect(ja).not.toBe('')
    expect(en).not.toMatch(/[　-ヿ一-鿿＀-￯]/)
  }
})

// ---------------------------------------------------------------------------
// Paths and the allowlist

test('isSafeExecPath: absolute, as it lands, with no = and nothing hidden', () => {
  for (const ok of ['/usr/bin/tr', '/Users/me/bin/my tool', '/opt/日本語/x.sh', '/a']) expect(isSafeExecPath(ok)).toBe(true)
  for (const bad of ['', '/', 'tr', 'bin/tr', '~/tr', '/a/../b', '/a/./b', '/a//b', '/a/', '/a=b', '/a\u0000', '/a\nb', '/a\u001bb', '/a\u2066b', 5, undefined]) {
    expect(isSafeExecPath(bad)).toBe(false)
  }
})

test('parseAllowlist: the shape, each entry checked; one not valid is left out with its place', () => {
  const hash = 'AB'.repeat(32)
  const list = parseAllowlist(
    JSON.stringify({
      executables: [
        { path: '/opt/a.sh' },
        { path: '/opt/b.sh', sha256: hash },
        { path: 'relative.sh' },
        { path: '/opt/../c.sh' },
        { path: '/opt/d=e.sh' },
        { path: '/opt/e.sh', sha256: 'abc' },
        'x',
      ],
    }),
  )
  expect(list).toEqual({ entries: [{ path: '/opt/a.sh' }, { path: '/opt/b.sh', sha256: hash.toLowerCase() }], ignored: [3, 4, 5, 6, 7] })
  for (const text of ['', 'nope', '[]', '{}', '{"executables": {}}']) expect(parseAllowlist(text)).toBeUndefined()
  expect(allowlistOf(undefined)).toEqual({ code: 'execAllowlist', why: 'unreadable' })
  expect(allowlistOf('[]')).toEqual({ code: 'execAllowlist', why: 'invalid' })
})

test('matchAllowlist: the path as written alone, never resolved, never a prefix', () => {
  const entries = [{ path: '/opt/a.sh' }, { path: '/opt/b' }]
  expect(matchAllowlist(entries, '/opt/a.sh')).toEqual({ path: '/opt/a.sh' })
  expect(matchAllowlist(entries, '/opt/b/c')).toBeUndefined()
  expect(matchAllowlist(entries, '/OPT/a.sh')).toBeUndefined()
  expect(matchAllowlist(entries, '/opt/a.sh2')).toBeUndefined()
})

test('locate: where the command lands is what is matched, and what must be safe', () => {
  const entries = [{ path: '/opt/real.sh' }]
  // A link to an allowlisted file: matched by where it lands.
  expect(locate('/home/me/bin/link', { kind: 'file', size: 3, realPath: '/opt/real.sh' }, entries)).toEqual({ realPath: '/opt/real.sh', size: 3, entry: { path: '/opt/real.sh' } })
  // The allowlisted path itself, now a link to another file: that other file is not allowlisted.
  expect(locate('/opt/real.sh', { kind: 'file', size: 3, realPath: '/tmp/evil.sh' }, entries)).toEqual({ code: 'execNotAllowed', path: '/tmp/evil.sh' })
  // A link with no = to a path with one: never handed to env.
  expect(locate('/opt/plain', { kind: 'file', size: 3, realPath: '/opt/a=b' }, entries)).toEqual({ code: 'execPath', field: 'realPath', path: '/opt/a=b' })
  expect(locate('/opt/gone', undefined, entries)).toEqual({ code: 'execMissing', path: '/opt/gone' })
  expect(locate('/opt', { kind: 'dir', size: 0, realPath: '/opt' }, entries)).toEqual({ code: 'execMissing', path: '/opt' })
  expect(locate('/opt/x', { kind: 'file', size: 0 }, entries)).toEqual({ code: 'execMissing', path: '/opt/x' })
})

test('allowlistPlace: a regular file outside the project, unless the project is the home directory', () => {
  const file = { kind: 'file' as const, size: 10, realPath: `/Users/me/${ALLOWLIST_RELATIVE}` }
  expect(allowlistPlace(file, '/Users/me', ['/repo', '/repo/sub'])).toEqual({ path: file.realPath })
  expect(allowlistPlace(undefined, '/Users/me', ['/repo', '/repo'])).toEqual({ code: 'execAllowlist', why: 'missing' })
  expect(allowlistPlace({ ...file, kind: 'dir' }, '/Users/me', ['/repo', '/repo'])).toEqual({ code: 'execAllowlist', why: 'missing' })
  // HOME moved into the repository, or the file a link into it.
  const inRepo = { ...file, realPath: `/repo/${ALLOWLIST_RELATIVE}` }
  expect(allowlistPlace(inRepo, '/repo/fake-home', ['/repo', '/repo'])).toEqual({ code: 'execAllowlist', why: 'inProject' })
  expect(allowlistPlace(inRepo, '/Users/me', ['/elsewhere', '/repo'])).toEqual({ code: 'execAllowlist', why: 'inProject' })
  // Claude Code run in the home directory itself.
  expect(allowlistPlace(file, '/Users/me', ['/Users/me', '/Users/me'])).toEqual({ path: file.realPath })
  // A root under no prefix of the path.
  expect(allowlistPlace(file, '/Users/me', ['/Users/m', '/Users/m'])).toEqual({ path: file.realPath })
  expect(allowlistPlace(file, '/Users/me', [undefined, '/repo'])).toEqual({ code: 'execAllowlist', why: 'unreadable' })
})

test('usableHome: an absolute path alone', () => {
  expect(usableHome('/Users/me')).toBe('/Users/me')
  for (const bad of [undefined, '', 'relative', '/a/../b', '/a=b']) expect(usableHome(bad)).toBeUndefined()
})

// ---------------------------------------------------------------------------
// Where the definition came from

const SETTING = JSON.stringify([UPPER])
const userWith = (configs: Record<string, unknown>) => ({ pluginConfigs: configs })
const own = (setting: string) => ({ options: { customActions: setting } })

test('scopeVerdict: exactly one entry of the plugin with customActions, whose text is the merged one', () => {
  const clean = [{}, {}, {}]
  expect(scopeVerdict(userWith({ 'quick-actions@market': own(SETTING) }), clean, SETTING, 'quick-actions')).toBeUndefined()
  expect(scopeVerdict(userWith({ 'quick-actions': own(SETTING) }), clean, SETTING, 'quick-actions')).toBeUndefined()
  // Another plugin's entry, or this one's with no customActions, does not count.
  expect(
    scopeVerdict(userWith({ 'quick-actions@a': own(SETTING), 'quick-actions-x@a': own('[]'), 'quick-actions@b': { options: { language: 'ja' } } }), clean, SETTING, 'quick-actions'),
  ).toBeUndefined()
  // None, or two (another marketplace, @inline): which one is meant is not known.
  expect(scopeVerdict(userWith({}), clean, SETTING, 'quick-actions')).toEqual({ code: 'execScope', why: 'keys' })
  expect(scopeVerdict({}, clean, SETTING, 'quick-actions')).toEqual({ code: 'execScope', why: 'keys' })
  expect(scopeVerdict(userWith({ 'quick-actions@a': own(SETTING), 'quick-actions@inline': own(SETTING) }), clean, SETTING, 'quick-actions')).toEqual({ code: 'execScope', why: 'keys' })
  // The project's text in the merge, not the person's.
  expect(scopeVerdict(userWith({ 'quick-actions@a': own('[]') }), clean, SETTING, 'quick-actions')).toEqual({ code: 'execScope', why: 'mismatch' })
  expect(scopeVerdict(userWith({ 'quick-actions@a': own(` ${SETTING}`) }), clean, SETTING, 'quick-actions')).toEqual({ code: 'execScope', why: 'mismatch' })
  // HOME moved by the project, local or flag settings.
  for (const at of [0, 1, 2]) {
    const others = [{}, {}, {}].map((o, i) => (i === at ? { env: { HOME: '/repo' } } : o))
    expect(scopeVerdict(userWith({ 'quick-actions@a': own(SETTING) }), others, SETTING, 'quick-actions')).toEqual({ code: 'execScope', why: 'home' })
  }
  // Settings that cannot be read refuse it.
  expect(scopeVerdict(undefined, clean, SETTING, 'quick-actions')).toEqual({ code: 'execScope', why: 'unreadable' })
  expect(scopeVerdict(userWith({ 'quick-actions@a': own(SETTING) }), [{}, undefined, {}], SETTING, 'quick-actions')).toEqual({ code: 'execScope', why: 'unreadable' })
})

// ---------------------------------------------------------------------------
// The argument vector and the standard input

const ENV: ExecHostEnv = { HOME: '/Users/me', LANG: 'ja_JP.UTF-8', TMPDIR: '/var/folders/x/' }
const NASTY = ['; rm -rf ~', '$(touch /tmp/pwned)', '`id`', 'a | nc evil 1', 'x && y', 'line\nbreak', "'quoted' \"too\"", '${HOME}', '> /etc/passwd'].join(' ')

test('buildInvocation: env -i, the allowed variables, the path as it lands, the arguments as written; the input on stdin alone', () => {
  for (const target of ['selection', 'context', 'none'] as const) {
    const inv = buildInvocation({ realPath: '/opt/real.sh', args: ['--mode', '$(x)'], env: ENV, target, lang: 'en', stdin: NASTY })
    expect(inv).toEqual({
      argv: [
        ENV_BIN,
        '-i',
        `PATH=${EXEC_PATH}`,
        'HOME=/Users/me',
        'LANG=ja_JP.UTF-8',
        'TMPDIR=/var/folders/x/',
        `QUICK_ACTIONS_TARGET=${target}`,
        'QUICK_ACTIONS_LANG=en',
        '/opt/real.sh',
        '--mode',
        '$(x)',
      ],
      cwd: '/Users/me',
      stdin: NASTY,
    })
    // Not one piece of the input in the argument vector.
    for (const piece of NASTY.split(/\s+/).filter(p => p.length > 1)) for (const a of inv!.argv) expect(a.includes(piece) && a !== '$(x)').toBe(false)
  }
})

test('buildInvocation: a variable unset, empty or with a line break is not passed', () => {
  const inv = buildInvocation({ realPath: '/opt/x', args: [], env: { HOME: '/h', LANG: '', LC_ALL: 'C\nX=1', TMPDIR: 'a\u0000b' }, target: 'none', lang: 'ja', stdin: '' })
  expect(inv?.argv).toEqual([ENV_BIN, '-i', `PATH=${EXEC_PATH}`, 'HOME=/h', 'QUICK_ACTIONS_TARGET=none', 'QUICK_ACTIONS_LANG=ja', '/opt/x'])
})

test('buildInvocation: a path it lands on with = (a link to it), a bad HOME or a NUL in an argument builds nothing', () => {
  const base = { args: [], env: ENV, target: 'selection' as const, lang: 'en' as const, stdin: '' }
  expect(buildInvocation({ ...base, realPath: '/opt/a=b' })).toBeUndefined()
  expect(buildInvocation({ ...base, realPath: 'relative' })).toBeUndefined()
  expect(buildInvocation({ ...base, realPath: '/opt/x', env: { HOME: 'nowhere' } })).toBeUndefined()
  expect(buildInvocation({ ...base, realPath: '/opt/x', args: ['a\u0000b'] })).toBeUndefined()
})

test('conversationInput: the messages as JSON, role and text alone, the oldest dropped past the limit', () => {
  const messages = [
    { role: 'user', text: 'hi `id`', toolUses: [{ secret: 1 }] },
    { role: 'assistant', text: 'hello $(x)' },
  ]
  expect(JSON.parse(conversationInput(messages))).toEqual([
    { role: 'user', text: 'hi `id`' },
    { role: 'assistant', text: 'hello $(x)' },
  ])
  const big = 'あ'.repeat(200_000) // 600,000 bytes each
  const cut = conversationInput([
    { role: 'user', text: `old ${big}` },
    { role: 'assistant', text: `new ${big}` },
  ])
  expect(utf8Length(cut)).toBeLessThanOrEqual(EXEC_STDIN_MAX)
  expect(JSON.parse(cut)).toEqual([{ role: 'assistant', text: `new ${big}` }])
  expect(conversationInput([])).toBe('[]')
})

test('utf8Length counts as UTF-8 does', () => {
  for (const s of ['', 'abc', 'é', 'あ', '😀', 'a\uD800b', 'x\uDC00']) expect(utf8Length(s)).toBe(utf8Encode(s).length)
})

// ---------------------------------------------------------------------------
// The approval

test('the approval is for that path, those arguments in order and that SHA-256 alone', () => {
  const a = { path: '/opt/x', args: ['a', 'b'], sha256: 'f'.repeat(64) }
  expect(sameApproval(a, { ...a, args: ['a', 'b'] })).toBe(true)
  expect(sameApproval(undefined, a)).toBe(false)
  expect(sameApproval(a, { ...a, path: '/opt/y' })).toBe(false)
  expect(sameApproval(a, { ...a, args: ['b', 'a'] })).toBe(false)
  expect(sameApproval(a, { ...a, args: ['a'] })).toBe(false)
  expect(sameApproval(a, { ...a, sha256: '0'.repeat(64) })).toBe(false)
  expect(parseApprovals({ ok: a, bad: { path: 1 }, worse: 'x', args: { path: '/p', args: [1], sha256: 'x' } })).toEqual({ ok: a })
  expect(parseApprovals(undefined)).toEqual({})
  expect(parseApprovals([a])).toEqual({})
})

test('the approval question shows the path, the arguments with hidden characters named, the SHA-256, and ends in ?', () => {
  const a = { path: '/opt/x', args: ['--a', 'b\u001bc', 'd\u202Ee'], sha256: 'f'.repeat(64) }
  for (const lang of ['ja', 'en'] as const) {
    const q = approvalQuestion(lang, 'Up\u202Eper', 'upper', a)
    expect(q.endsWith('?')).toBe(true)
    expect(q).toContain('/opt/x')
    expect(q).toContain('f'.repeat(64))
    expect(q).toContain('U+202E')
    expect(q).toContain('\\u001b')
    expect(q).not.toMatch(/[\u001b\u202E]/)
  }
})

test('hashOf: the SHA-256 of the bytes read, or why there is none', () => {
  const bytes = utf8Encode('#!/bin/sh\necho hi\n')
  expect(hashOf('/opt/x', base64Encode(bytes))).toBe(sha256(bytes))
  expect(hashOf('/opt/x', undefined)).toEqual({ code: 'execUnreadable', path: '/opt/x' })
  expect(hashOf('/opt/x', '***')).toEqual({ code: 'execUnreadable', path: '/opt/x' })
})

// ---------------------------------------------------------------------------
// The output

test('execOutputText: tidied, its hidden characters escaped as a model answer is, cut at the limit and said so', () => {
  expect(execOutputText('\n\nHELLO\r\nWORLD  \n\n', false, 'en')).toBe('HELLO\nWORLD')
  expect(execOutputText('', false, 'ja')).toBe(MESSAGES.ja.execNoOutput)
  expect(execOutputText('  \n', false, 'en')).toBe(MESSAGES.en.execNoOutput)
  const hidden = 'red \u001b[31mtext\u001b[0m and \u202Eevil\u200B'
  expect(execOutputText(hidden, false, 'en')).toBe(showHiddenNoted(hidden, 'en'))
  expect(execOutputText(hidden, false, 'en')).not.toMatch(/[\u001b\u202E\u200B]/)
  const long = 'x'.repeat(EXEC_OUTPUT_MAX + 10)
  expect(execOutputText(long, false, 'ja')).toBe(`${'x'.repeat(EXEC_OUTPUT_MAX)}\n\n${MESSAGES.ja.execTruncated}`)
  // Cut by $.process.run already (past 4 MiB): said so too.
  expect(execOutputText('abc', true, 'en')).toBe(`abc\n\n${MESSAGES.en.execTruncated}`)
  // Never between the halves of a surrogate pair.
  const pair = `${'x'.repeat(EXEC_OUTPUT_MAX - 1)}😀`
  expect(cutText(pair, EXEC_OUTPUT_MAX)).toEqual({ text: 'x'.repeat(EXEC_OUTPUT_MAX - 1), cut: true })
})

test('execFailureText: the exit code, then the standard error and output under their headings, escaped and cut', () => {
  expect(execFailureText(2, '', '', 'en')).toBe(MESSAGES.en.failed(MESSAGES.en.execExit(2)))
  const text = execFailureText(1, 'partial', 'bad \u001b thing\n', 'ja')
  expect(text).toBe(
    [MESSAGES.ja.failed(MESSAGES.ja.execExit(1)), `${MESSAGES.ja.execStderr}\n${showHiddenNoted('bad \u001b thing', 'ja')}`, `${MESSAGES.ja.execStdout}\npartial`].join('\n\n'),
  )
  const long = execFailureText(1, '', 'e'.repeat(EXEC_STDERR_MAX + 5), 'en')
  expect(long).toContain(`${'e'.repeat(EXEC_STDERR_MAX)}\n${MESSAGES.en.execTruncated}`)
  expect(long).not.toContain('e'.repeat(EXEC_STDERR_MAX + 1))
})

test('execFailureText: what $.process.run cut is said to be cut, even when nothing of it is left to show', () => {
  const text = execFailureText(1, 'out', 'err', 'en', { stdoutCut: true, stderrCut: true })
  expect(text).toBe(
    [
      MESSAGES.en.failed(MESSAGES.en.execExit(1)),
      `${MESSAGES.en.execStderr}\nerr\n${MESSAGES.en.execTruncated}`,
      `${MESSAGES.en.execStdout}\nout\n${MESSAGES.en.execTruncated}`,
    ].join('\n\n'),
  )
  expect(execFailureText(1, '', '', 'en', { stdoutCut: true })).toBe(
    [MESSAGES.en.failed(MESSAGES.en.execExit(1)), `${MESSAGES.en.execStdout}\n${MESSAGES.en.execTruncated}`].join('\n\n'),
  )
  // Not cut: no note, as before.
  expect(execFailureText(1, 'out', '', 'en', { stdoutCut: false })).toBe(
    [MESSAGES.en.failed(MESSAGES.en.execExit(1)), `${MESSAGES.en.execStdout}\nout`].join('\n\n'),
  )
})

test('tidied: the same as trimming the whole output, and cut only when something but white space is left out', () => {
  const max = 10
  expect(tidied(' \r\n\t\n\rab \r\n', max)).toEqual({ text: 'ab', cut: false })
  expect(tidied('a\r\nb', max)).toEqual({ text: 'a\nb', cut: false })
  // Longer than kept before tidying, but only white space past it: not cut.
  expect(tidied(`abc${' '.repeat(100)}`, max)).toEqual({ text: 'abc', cut: false })
  expect(tidied(`abc${'\r\n'.repeat(100)}`, max)).toEqual({ text: 'abc', cut: false })
  // Something after a long run of white space: cut, and the white space kept up to `max`.
  expect(tidied(`abc${' '.repeat(100)}z`, max)).toEqual({ text: `abc${' '.repeat(7)}`, cut: true })
  // \r\n made \n: the first `max` of the tidied output, as if it all were tidied.
  expect(tidied(`${'a\r\n'.repeat(20)}`, max)).toEqual({ text: 'a\na\na\na\na\n', cut: true })
  expect(tidied(`${'\r\n'.repeat(max)}x${'\r\n'.repeat(max)}y`, max)).toEqual({ text: `x${'\n'.repeat(9)}`, cut: true })
  // Leading blank lines, however many, are gone before anything is cut.
  expect(tidied(`${'\n'.repeat(1000)}hello`, max)).toEqual({ text: 'hello', cut: false })
  // Cut by $.process.run: said so.
  expect(tidied('ab', max, true)).toEqual({ text: 'ab', cut: true })
})

test('tidied: a long run of white space or blank lines in an output takes linear time, not quadratic', () => {
  const n = 100_000
  const outputs = [
    `a${' '.repeat(n)}b`,
    `a${'\n'.repeat(n)}b`,
    `a${' \t\r\n'.repeat(n / 4)}b`,
    `a${' '.repeat(n)}`,
    `${'\n'.repeat(n)}`,
    `a${' '.repeat(4_000_000)}b`,
  ]
  const started = Date.now()
  for (const out of outputs) {
    execOutputText(out, false, 'en')
    execFailureText(1, out, out, 'en')
  }
  // The old /\s+$/ took seconds for the 100,000 runs alone (and hours for 4,000,000).
  expect(Date.now() - started).toBeLessThan(1000)
  expect(execOutputText(`a${' '.repeat(n)}b`, false, 'en')).toBe(`a${' '.repeat(EXEC_OUTPUT_MAX - 1)}\n\n${MESSAGES.en.execTruncated}`)
  expect(execOutputText(`a${'\n'.repeat(n)}`, false, 'en')).toBe('a')
  expect(execFailureText(1, '', `e${' '.repeat(n)}f`, 'en')).toBe(
    [MESSAGES.en.failed(MESSAGES.en.execExit(1)), `${MESSAGES.en.execStderr}\ne${' '.repeat(EXEC_STDERR_MAX - 1)}\n${MESSAGES.en.execTruncated}`].join('\n\n'),
  )
})

test('pathShown: hidden characters named, cut short at 200 code units', () => {
  expect(pathShown('/opt/tool')).toBe('/opt/tool')
  const long = `/${'d'.repeat(4000)}`
  expect(pathShown(long).length).toBe(200)
  expect(pathShown(long).endsWith('...')).toBe(true)
})

test('isTimeout: the message says so, or it ran about as long as allowed', () => {
  expect(isTimeout('Command timed out after 30000ms', 10, 30_000)).toBe(true)
  expect(isTimeout('spawn ENOENT', 29_000, 30_000)).toBe(true)
  expect(isTimeout('spawn ENOENT', 5, 30_000)).toBe(false)
})
