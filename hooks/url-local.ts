// The URL actions on the selection (open-urls, copy-urls): the URLs found in
// the selected text, and what to do with them. Like every local action's
// compute, these are pure and synchronous and never reach `$`: a compute here
// answers an effect (`{ effect }`, see LocalEffect) saying which URLs to open
// or copy, and register.tsx carries it out through `$.process.run` (the OS's
// default handler) or `$.ui.copy`, then words what came of it with the
// functions below. No model is called, and the selected text is sent nowhere:
// only the URLs, to the OS's handler or the clipboard.
//
// Only http and https URLs are taken, each one read by `URL` (as LocalAction
// allows) and kept as it was written, so the URL opened or copied is the one
// the person saw.

import type { LocalEffect, LocalInput, LocalOutput } from './actions'
import type { Lang } from './i18n'
import { escapeHidden, hasHidden, hiddenCharPattern } from './selection-local'

type Texts = Record<Lang, string>

/** The most URLs open-urls opens in one run; the rest are listed, not opened. */
export const OPEN_URL_LIMIT = 5

/**
 * How long one command that opens a URL (or `uname -s`) may run, in ms. `open`,
 * `rundll32` and the detached start on Linux each return in well under a
 * second, so this is a bound for something gone wrong, not a wait.
 */
export const OPEN_TIMEOUT_MS = 3_000

/**
 * The script the Linux start runs under `/bin/sh -c`. It is a constant: the
 * URL is never written into it, but passed as its first positional argument
 * and used as `"$1"`, so no URL can change what the shell runs. xdg-open's
 * standard streams go to /dev/null and it is put in the background, so `sh`
 * exits at once and `$.process.run`'s pipes close: the browser xdg-open may
 * exec holds none of them, and nothing is left for the timeout to kill. With
 * no xdg-open on the machine it ends at once with 127.
 */
export const LINUX_OPEN_SCRIPT = 'command -v xdg-open >/dev/null 2>&1 || exit 127; xdg-open "$1" </dev/null >/dev/null 2>&1 &'

/** The OS the commands are chosen for, as register.tsx makes it out. */
export type Platform = 'darwin' | 'win32' | 'linux'

/**
 * The argument vector that hands `url` to the OS's default handler: `open` on
 * macOS, `rundll32 url.dll,FileProtocolHandler` on Windows (both run with no
 * shell), and on Linux xdg-open started detached through LINUX_OPEN_SCRIPT,
 * the URL its positional argument. `url` is an http(s) URL (isHttpUrl), so it
 * never starts with `-` and is never read as an option.
 */
export function openCommandFor(platform: Platform, url: string): string[] {
  if (platform === 'darwin') return ['open', url]
  if (platform === 'win32') return ['rundll32', 'url.dll,FileProtocolHandler', url]
  return ['/bin/sh', '-c', LINUX_OPEN_SCRIPT, 'sh', url]
}

/** Whether `s` reads as an http or https URL with a host. */
export function isHttpUrl(s: string): boolean {
  // A host right after `//`: `http:///x`, which URL reads as http://x/, is not taken.
  if (!/^https?:\/\/[^/\\]/i.test(s) || /\s/u.test(s) || hasHidden(s)) return false
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== ''
  } catch {
    return false
  }
}

// A URL's start, then what it runs on. It ends at white space, at the
// characters a URL never holds as written (< > " `, which also close `<url>`
// and the like), at full-width punctuation and brackets, which in Japanese
// text often follow a URL with no space between, and at an ellipsis (… ‥),
// which a sentence cut short ends with.
const CANDIDATE = /https?:\/\/[^\s<>"`、。，．！？「」『』（）【】＜＞［］｛｝…‥]+/giu

// A kana or a kanji (with the long-vowel mark and the iteration marks), as
// written straight after a URL in Japanese text.
const JAPANESE = '[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}ー々〆]'

// Japanese text run straight on from a URL (`https://example.comを参照`): a
// letter or digit of ASCII, or a closing bracket or quote (`) ] } '`), followed
// by a kana or a kanji. The URL ends between the two, so `(https://example.com)を見て`
// gives `https://example.com)` and trimEnd then drops the unpaired `)`, while
// `https://en.wikipedia.org/wiki/Foo_(bar)を参照` keeps its paired one.
// Japanese right after `//`, `/`, `=` and the like is kept, so a Japanese path
// or query (`https://ja.wikipedia.org/wiki/日本`, `?q=東京`) stays whole.
// Japanese after `.` is kept too, except in the host (HOST_PUNCT_JAPANESE),
// where it is kept only when the `.` follows Japanese, so an IDN host
// (`https://例え.テスト`) stays whole. The price: a Japanese path segment
// written straight after ASCII (`/wiki/Python入門`) is cut before the
// Japanese; a `.` and Japanese written straight after an IDN host
// (`https://例え.テスト.を参照`) stay in it, read as one longer IDN host, since
// that `.` cannot be told from the one between its labels; and an ASCII label
// followed by a Japanese top-level label (`https://example.みんな`) is cut at
// the `.` and gives `https://example`, since that `.` cannot be told from the
// one in `https://example.com.を参照`.
// Global: it is searched forward from a position (see nextMatchFrom).
const JAPANESE_AFTER = new RegExp(`[A-Za-z0-9)\\]}'](?=${JAPANESE})`, 'gu')

// Half-width sentence punctuation in a URL's host with Japanese straight after
// it (`https://example.com,を参照`), where the URL ends, so the Japanese is not
// read as part of an IDN host: `!`, `,` or `;` (never written between the
// labels of a host), and `.` after an ASCII letter or digit (`example.com.を参照`;
// after Japanese, as in `例え.テスト`, it is the dot between two labels and
// stays). Only searched in the host (urlsInRun): in the path, query or fragment
// (`/a,日本`) such Japanese is the URL's own. Global: searched forward.
const HOST_PUNCT_JAPANESE = new RegExp(`(?:[!,;]|(?<=[A-Za-z0-9])\\.)(?=${JAPANESE})`, 'gu')

// Where a URL's authority (user info, host and port) ends: the characters URL
// reads as starting the path, query or fragment of an http(s) URL (shownUrl
// uses the same). Global: searched forward.
const AUTHORITY_END = /[/?#\\]/g

// A URL's start inside a candidate, where another URL may begin once one is cut.
const SCHEME = /https?:\/\//gi

// What a URL is seldom meant to end with: sentence punctuation and Markdown emphasis.
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', '*', '_', '~'])
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/**
 * A search for the global `pattern` in `s` that only ever moves forward: each
 * call answers where its first match at or after `from` starts (`s.length`
 * when there is none), and the calls' `from` must never go back. A match found
 * once is kept while it still lies ahead, so `s` is read once in all, however
 * many times it is asked: no stretch is searched twice.
 */
function nextMatchFrom(pattern: RegExp, s: string): (from: number) => number {
  const re = new RegExp(pattern)
  let found = -1
  return from => {
    if (found >= from) return found
    re.lastIndex = from
    const m = re.exec(s)
    found = m === null ? s.length : m.index
    return found
  }
}

/**
 * The candidate without what follows the URL in the text: trailing
 * punctuation, a closing bracket with no opening one inside the URL (so
 * `(see https://a.example)` and `[label](https://a.example)` lose theirs while
 * `https://en.wikipedia.org/wiki/Foo_(bar)` keeps its own), and a quote left
 * unpaired.
 */
function trimEnd(s: string): string {
  // Linear however long the run trimmed off: the brackets and quotes are
  // counted once, and each character dropped from the end takes itself off
  // its count, so nothing is counted again (a run of n closing brackets is n
  // steps, not n scans of the URL).
  const counts = new Map<string, number>()
  for (const c of s) if (c in CLOSERS || c === '(' || c === '[' || c === '{' || c === "'") counts.set(c, (counts.get(c) ?? 0) + 1)
  const n = (c: string) => counts.get(c) ?? 0
  let end = s.length
  while (end > 0) {
    const last = s[end - 1]!
    const opener = CLOSERS[last]
    if (!(TRAILING.has(last) || (opener !== undefined && n(last) > n(opener)) || (last === "'" && n("'") % 2 === 1))) break
    counts.set(last, n(last) - 1)
    end--
  }
  return s.slice(0, end)
}

/**
 * The URLs written in one candidate (`run`: a match of CANDIDATE, so it starts
 * with a scheme), before trimEnd: from its start up to its first hidden
 * character (a control, a bidirectional or zero-width one), Japanese run
 * straight on (JAPANESE_AFTER) or, in the host, half-width punctuation with
 * Japanese straight after it (HOST_PUNCT_JAPANESE, cut after the punctuation,
 * which trimEnd then drops), whichever comes first, or to its end. What is
 * cut off may hold another URL (`https://a.exampleを見てhttps://b.example`),
 * so the next one starts at the next `http://` or `https://` after the cut,
 * and is cut the same way. A candidate with no cut is one URL, whatever it
 * holds (`https://a.example/?u=https://b.example`). Each of the five
 * searches only moves forward (nextMatchFrom), so the run is read a bounded
 * number of times however many cuts it has: linear in its length.
 */
function urlsInRun(run: string): string[] {
  const nextHidden = nextMatchFrom(hiddenCharPattern(), run)
  const nextJapanese = nextMatchFrom(JAPANESE_AFTER, run)
  const nextAuthorityEnd = nextMatchFrom(AUTHORITY_END, run)
  const nextHostPunct = nextMatchFrom(HOST_PUNCT_JAPANESE, run)
  const nextScheme = nextMatchFrom(SCHEME, run)
  const found: string[] = []
  let start = 0
  while (start < run.length) {
    const japanese = nextJapanese(start)
    // The host starts right after the scheme (`http://` or `https://`). The
    // two host searches start there, never at `start`, where the `//` of the
    // scheme would end the authority at once. `hostFrom` never goes back, as
    // nextMatchFrom needs: the next URL starts at or after this one's end,
    // and the end is never before `hostFrom` (see below).
    const hostFrom = start + (run[start + 4] === ':' ? 7 : 8)
    const hostPunct = nextHostPunct(hostFrom)
    // The cut goes after the ASCII character or closer, before the Japanese;
    // after the punctuation in the host.
    const end = Math.min(
      nextHidden(start),
      japanese < run.length ? japanese + 1 : run.length,
      hostPunct < nextAuthorityEnd(hostFrom) ? hostPunct + 1 : run.length,
    )
    found.push(run.slice(start, end))
    // `end` is past `start`, at `hostFrom` at least: the scheme holds no
    // hidden character, no Japanese can follow a character of it, and the
    // host search starts after it. So a URL is never empty.
    start = end < run.length ? nextScheme(end) : run.length
  }
  return found
}

/**
 * The http(s) URLs in `text`, in the order they first appear, each once, as
 * written: a URL is `http://` or `https://` (any case) and what follows up to
 * white space (CANDIDATE), cut at a hidden character, where Japanese runs
 * on, or at half-width punctuation with Japanese after it in the host
 * (urlsInRun) and trimmed of what follows it (trimEnd), kept when `URL`
 * reads it as http(s) with a host. Other schemes (javascript:, file:, ftp:)
 * and bare `www.` are not taken. Linear in the length of `text`: each
 * candidate is read once by urlsInRun, and the search goes on from its end.
 */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  // Where a Markdown link's text ends and its target starts (`](`), one URL
  // ends: in `[https://a.example](https://b.example)` the two are two URLs.
  // So does a comma right before the next URL's scheme: `https://a.example,https://b.example`
  // is two (a comma elsewhere in a path is the URL's own). So does a closing
  // bracket right before `(` and the next URL's scheme: `(https://a.example)(https://b.example)`
  // is two, each then trimmed of its unpaired `)`. Only white space is put in,
  // so each URL is still taken as written.
  const split = text
    .replaceAll('](', '] (')
    .replace(/,(?=https?:\/\/)/giu, ', ')
    .replace(/([)}])(?=\(https?:\/\/)/giu, '$1 ')
  for (const m of split.matchAll(CANDIDATE)) {
    for (const cut of urlsInRun(m[0])) {
      const url = trimEnd(cut)
      if (seen.has(url) || !isHttpUrl(url)) continue
      seen.add(url)
      urls.push(url)
    }
  }
  return urls
}

const NO_TEXT: Texts = { ja: 'テキストが選択されていません。', en: 'No text is selected.' }

const NO_URL: Texts = {
  ja: '選択範囲に URL が見つかりません。http:// または https:// で始まる URL を含めて選択してください。',
  en: 'No URL was found in the selection. Select text that holds a URL starting with http:// or https://.',
}

/** The URLs of the selection, or the error to show when there are none. */
function urlsOf(input: LocalInput): string[] | { error: string } {
  const text = input.text
  if (text === undefined || text === '') return { error: NO_TEXT[input.lang] }
  const urls = extractUrls(text)
  return urls.length === 0 ? { error: NO_URL[input.lang] } : urls
}

/** open-urls: the first OPEN_URL_LIMIT URLs of the selection to open, the rest listed as skipped. */
export function openUrls(input: LocalInput): LocalOutput {
  const urls = urlsOf(input)
  if (!Array.isArray(urls)) return urls
  return { effect: { kind: 'open', urls: urls.slice(0, OPEN_URL_LIMIT), skipped: urls.slice(OPEN_URL_LIMIT) } }
}

/** copy-urls: every URL of the selection, to copy one per line. */
export function copyUrls(input: LocalInput): LocalOutput {
  const urls = urlsOf(input)
  if (!Array.isArray(urls)) return urls
  return { effect: { kind: 'copy', urls } }
}

/** What copy-urls puts on the clipboard: its URLs, one per line. */
export const copyTextOf = (effect: Extract<LocalEffect, { kind: 'copy' }>) => effect.urls.join('\n')

/**
 * `url` as a result shows it: as written, but with the password of its user
 * info (`user:password@`) hidden as `***`, as parse-url shows it. What is
 * opened or copied is the URL as written; only the text shown and kept in the
 * results is masked.
 */
export function shownUrl(url: string): string {
  const slashes = url.indexOf('//')
  if (slashes < 0) return url
  const start = slashes + 2
  const rest = url.slice(start)
  const authorityEnd = rest.search(/[/?#\\]/u)
  const authority = authorityEnd < 0 ? rest : rest.slice(0, authorityEnd)
  const at = authority.lastIndexOf('@')
  if (at < 0) return url
  const colon = authority.indexOf(':')
  if (colon < 0 || colon > at) return url
  return `${url.slice(0, start)}${authority.slice(0, colon)}:***${url.slice(start + at)}`
}

const items = (lines: readonly string[]) => lines.map(l => `- ${l}`).join('\n')
const list = (urls: readonly string[]) => items(urls.map(shownUrl))

/** The most code points of an engine's message (a rejection's, an exception's) a result shows. */
export const MESSAGE_LIMIT = 500

/** An engine's message as a result shows it: hidden characters escaped, cut at MESSAGE_LIMIT code points. */
function messageShown(message: string): string {
  const points = Array.from(message)
  const cut = points.length > MESSAGE_LIMIT ? `${points.slice(0, MESSAGE_LIMIT).join('')}…` : message
  return escapeHidden(cut)
}

/** Why a copy did not take, as `$.ui.copy` says (`reason`) or as its call threw (`thrown`). */
export type CopyFailure = { reason: 'no-surface' | 'no-clipboard' | 'refused' } | { thrown: string }

const COPY_REASONS: Record<'no-surface' | 'no-clipboard' | 'refused', Texts> = {
  'no-surface': { ja: 'コピー先の画面がありません（-p での実行など）', en: 'there is no screen to copy on (a -p run, for one)' },
  'no-clipboard': { ja: 'クリップボードに書き込めませんでした', en: 'nothing could be written to a clipboard' },
  refused: { ja: 'コピーが拒否されました', en: 'the copy was refused' },
}

/**
 * The text of a copy-urls run: how many URLs were copied and which, or, when
 * the copy did not take (`failure`), why, with the URLs listed to copy by hand.
 */
export function copyResultText(lang: Lang, urls: readonly string[], failure?: CopyFailure): string {
  const n = urls.length
  if (failure === undefined) {
    const head = lang === 'ja' ? `${n} 件の URL をクリップボードにコピーしました（改行区切り）:` : `Copied ${n} ${n === 1 ? 'URL' : 'URLs'} to the clipboard, one per line:`
    return `${head}\n${list(urls)}`
  }
  const why = 'reason' in failure ? COPY_REASONS[failure.reason][lang] : messageShown(failure.thrown)
  const head =
    lang === 'ja'
      ? `URL をクリップボードにコピーできませんでした: ${why}\n見つかった URL（${n} 件）:`
      : `Could not copy the URLs to the clipboard: ${why}\nThe URLs found (${n}):`
  return `${head}\n${list(urls)}`
}

/**
 * How one URL's open came out: asked of the OS's handler (`requested`: the
 * command ended with 0), not opened (`failed`, with why), or started with no
 * word of its end (`unconfirmed`: the command was still running at
 * OPEN_TIMEOUT_MS, so the handler may well have opened it).
 */
export type OpenAttempt =
  | { url: string; status: 'requested' }
  | { url: string; status: 'failed'; reason: OpenFailure }
  | { url: string; status: 'unconfirmed' }

/** Why a URL was not opened: the command's exit code, xdg-open missing, or the command not starting (its message). */
export type OpenFailure = { exitCode: number } | { missingXdgOpen: true } | { notStarted: string }

/** What the command that opened `url` came to, resolved with its exit code, on `platform`. */
export function attemptOfExit(platform: Platform, url: string, exitCode: number): OpenAttempt {
  if (exitCode === 0) return { url, status: 'requested' }
  if (platform === 'linux' && exitCode === 127) return { url, status: 'failed', reason: { missingXdgOpen: true } }
  return { url, status: 'failed', reason: { exitCode } }
}

// A rejection is read as the timeout when its message says so, or when it came
// this close to OPEN_TIMEOUT_MS: the clock read around the call is a little
// off either way, so a timeout is not missed for a few milliseconds.
const TIMEOUT_MESSAGE = /timed?[\s-]?out/i
const TIMEOUT_SHARE = 0.9

/** What a rejected command for `url` came to: the timeout (`unconfirmed`) or a start that failed. */
export function attemptOfRejection(url: string, message: string, elapsedMs: number): OpenAttempt {
  if (TIMEOUT_MESSAGE.test(message) || elapsedMs >= OPEN_TIMEOUT_MS * TIMEOUT_SHARE) return { url, status: 'unconfirmed' }
  return { url, status: 'failed', reason: { notStarted: message } }
}

function failureText(lang: Lang, reason: OpenFailure): string {
  if ('exitCode' in reason) return lang === 'ja' ? `終了コード ${reason.exitCode}` : `exit code ${reason.exitCode}`
  if ('missingXdgOpen' in reason) return lang === 'ja' ? 'xdg-open が見つかりません' : 'xdg-open was not found'
  const message = messageShown(reason.notStarted)
  return lang === 'ja' ? `起動できませんでした（${message}）` : `could not start (${message})`
}

/** Whether an open-urls run counts as done: anything but every URL failing. */
export const openSucceeded = (attempts: readonly OpenAttempt[]) => attempts.some(a => a.status !== 'failed')

/**
 * The text of an open-urls run: the URLs asked of the OS's handler, those not
 * opened (with why), those started with no word of their end, and those past
 * OPEN_URL_LIMIT that were not tried, each under its own heading, empty ones
 * left out. Never says a URL "opened": the handler was asked to.
 */
export function openResultText(lang: Lang, attempts: readonly OpenAttempt[], skipped: readonly string[]): string {
  const ja = lang === 'ja'
  const requested = attempts.filter(a => a.status === 'requested').map(a => a.url)
  const failed = attempts.flatMap(a => (a.status === 'failed' ? [`${shownUrl(a.url)} — ${failureText(lang, a.reason)}`] : []))
  const unconfirmed = attempts.filter(a => a.status === 'unconfirmed').map(a => a.url)
  const sections: string[] = []
  if (requested.length > 0) {
    sections.push(`${ja ? `ブラウザで開くよう依頼しました（${requested.length} 件）:` : `Asked the system to open in the browser (${requested.length}):`}\n${list(requested)}`)
  }
  if (failed.length > 0) {
    sections.push(`${ja ? `開けませんでした（${failed.length} 件）:` : `Could not open (${failed.length}):`}\n${items(failed)}`)
  }
  if (unconfirmed.length > 0) {
    const head = ja
      ? `起動しましたが完了を確認できませんでした（${unconfirmed.length} 件。ブラウザでは開いている場合があります）:`
      : `Started, but could not confirm it finished (${unconfirmed.length}; the browser may have opened it):`
    sections.push(`${head}\n${list(unconfirmed)}`)
  }
  if (skipped.length > 0) {
    const head = ja
      ? `上限の ${OPEN_URL_LIMIT} 件を超えたため開かなかった URL（${skipped.length} 件）:`
      : `Not opened, past the limit of ${OPEN_URL_LIMIT} a run (${skipped.length}):`
    sections.push(`${head}\n${list(skipped)}`)
  }
  return sections.join('\n\n')
}
