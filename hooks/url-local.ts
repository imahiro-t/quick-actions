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
// In the host, Japanese after any half-width symbol ends the URL before the
// symbol (HOST_SYMBOL_JAPANESE), except after a `-` or `.` that follows a
// non-ASCII character, so an IDN host (`https://例え.テスト`) stays whole. The
// price: a Japanese path segment written straight after ASCII
// (`/wiki/Python入門`) is cut before the Japanese; a `.` and Japanese written
// straight after an IDN host (`https://例え.テスト.を参照`) stay in it, read as
// one longer IDN host, since that `.` cannot be told from the one between its
// labels; and an ASCII label followed by a Japanese top-level label
// (`https://example.みんな`) is cut at the `.` and gives `https://example`,
// since that `.` cannot be told from the one in `https://example.com.を参照`.
// Global: it is searched forward from a position (see nextMatchFrom).
const JAPANESE_AFTER = new RegExp(`[A-Za-z0-9)\\]}'](?=${JAPANESE})`, 'gu')

// A half-width symbol that may run on in a URL's host: an ASCII printable
// character that is not a letter or digit, except the characters that end the
// authority (`/ ? # \`, AUTHORITY_END) and `]`, which closes an IPv6 literal
// (`https://[::1]を参照` must keep its `]`; JAPANESE_AFTER and trimEnd deal
// with it). Spelled out it is !"$%&'()*+,-.:;<=>@[^_`{|}~ (the range `:->`
// and `@` are kept apart, since `:-@` would take in `?`).
const HOST_SYMBOL = '[!"$-.:->@\\[^_`{-~]'

// Half-width symbols in a URL's host with Japanese straight after them, or
// after `]`s (`https://example.com@を参照`, `https://example.com-を参照`,
// `https://a.example-]を参照`), where the URL ends before the run of symbols,
// so neither the Japanese nor what is left of the host is read as another
// host: after `@` the Japanese would be the host itself, the ASCII host its
// user info, and a symbol kept at the end (`https://example.com-`) could
// still name a host of its own. One rule for every symbol, with one
// exception: a run of only `-` and `.` that follows a non-ASCII character and
// has Japanese straight after it stays, being the hyphen inside or the dot
// between the labels of an IDN host (`https://例え-テスト.jp`,
// `https://例え.テスト`, `https://ü-テスト.de`). Any other run after
// non-ASCII (`https://例え.テスト@を参照`) is cut too. The price, besides
// JAPANESE_AFTER's: a label mixing ASCII, a symbol and Japanese
// (`https://abc-テスト.jp`) gives `https://abc`, and Japanese after user info
// (`https://user@例え.jp`) gives `https://user`, since neither can be told
// from `https://example.com-を参照` or `https://example.com@を参照`. A `]`
// that splits a run (`https://example.com-]-を参照`) is not part of it, so the
// cut before the last run leaves symbols and `]`s at the end; backOverBrackets
// drops them too. A match only starts at the start of a run of symbols (the
// leading lookbehind), so a long run with no Japanese after it is read a
// bounded number of times, not once from each of its characters: linear.
// Only searched in the host (urlsInRun): in the path, query or fragment
// (`/a,日本`) such Japanese is the URL's own. Global: searched forward.
const HOST_SYMBOL_JAPANESE = new RegExp(
  `(?<!${HOST_SYMBOL})(?:(?<![^\\x00-\\x7F])|(?![-.]+${JAPANESE}))${HOST_SYMBOL}+(?=\\]*${JAPANESE})`,
  'gu',
)

// One character of HOST_SYMBOL (tested on one UTF-16 unit).
const HOST_SYMBOL_CHAR = new RegExp(`^${HOST_SYMBOL}$`)

/**
 * Where a URL cut before a run of symbols in its host (HOST_SYMBOL_JAPANESE,
 * at `cut`, at or after `hostFrom`, where the host starts) ends, once no
 * symbols are left before it behind `]`s. HOST_SYMBOL leaves out `]`, so in
 * `https://example.com-]-を参照` only the last `-` is cut off, and trimEnd
 * would then drop the unpaired `]` and leave `https://example.com-`, another
 * host. So while the URL ends with `]`s right after a symbol, those `]`s and
 * the run of symbols before them are dropped too, giving `https://example.com`.
 * The `]` that closes an IPv6 literal (the first `]` after a `[` in the host)
 * is kept, with all before it: `https://[::1]-を参照` gives `https://[::1]`,
 * and so does `https://[::]]-を参照` (after trimEnd), though `:` is a symbol.
 * Only the stretch of the host before `cut` is read, a bounded number of
 * times, and the next URL starts past `cut` (what is dropped holds only
 * symbols and `]`s, never a scheme), so urlsInRun stays linear.
 */
function backOverBrackets(run: string, hostFrom: number, cut: number): number {
  if (run[cut - 1] !== ']') return cut
  // Searched only up to `cut`: a `]` lies right before it, so the second
  // search ends there too.
  let open = hostFrom
  while (open < cut && run[open] !== '[') open++
  const closer = open < cut ? run.indexOf(']', open) : -1
  let end = cut
  for (;;) {
    let brackets = end
    while (brackets > hostFrom && run[brackets - 1] === ']') brackets--
    if (brackets === end || (closer >= brackets && closer < end)) return end
    let symbols = brackets
    while (symbols > hostFrom && HOST_SYMBOL_CHAR.test(run[symbols - 1]!)) symbols--
    if (symbols === brackets) return end
    end = symbols
  }
}

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
 * straight on (JAPANESE_AFTER) or, in the host, half-width symbols with
 * Japanese straight after them (HOST_SYMBOL_JAPANESE, cut before the symbols),
 * whichever comes first, or to its end. What is
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
  const nextHostSymbol = nextMatchFrom(HOST_SYMBOL_JAPANESE, run)
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
    const hostSymbol = nextHostSymbol(hostFrom)
    // The cut goes after the ASCII character or closer, before the Japanese;
    // before the run of symbols in the host, and before any symbols and `]`s
    // left in front of it (backOverBrackets).
    const end = Math.min(
      nextHidden(start),
      japanese < run.length ? japanese + 1 : run.length,
      hostSymbol < nextAuthorityEnd(hostFrom) ? backOverBrackets(run, hostFrom, hostSymbol) : run.length,
    )
    found.push(run.slice(start, end))
    // `end` is past `start`, at `hostFrom` at least: the scheme holds no
    // hidden character, no Japanese can follow a character of it, and the
    // host search starts after it. So a URL is never empty (a cut right at
    // `hostFrom`, as in `https://@を`, leaves `https://`, which isHttpUrl
    // drops).
    start = end < run.length ? nextScheme(end) : run.length
  }
  return found
}

/**
 * The http(s) URLs in `text`, in the order they first appear, each once, as
 * written: a URL is `http://` or `https://` (any case) and what follows up to
 * white space (CANDIDATE), cut at a hidden character, where Japanese runs
 * on, or before half-width symbols with Japanese after them in the host
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
  // is two, each then trimmed of its unpaired `)`, and so does a closing quote
  // right before it: `'https://a.example'(https://b.example)` is two, the first
  // trimmed of its unpaired `'` (one in a path right before `(` and the scheme,
  // as in `https://a.example/x'(https://b.example)`, splits the same way). Only
  // white space is put in, so each URL is still taken as written.
  const split = text
    .replaceAll('](', '] (')
    .replace(/,(?=https?:\/\/)/giu, ', ')
    .replace(/([)}'])(?=\(https?:\/\/)/giu, '$1 ')
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

/**
 * open-urls: the first OPEN_URL_LIMIT URLs of the selection with no user info
 * to open, the rest of them listed as skipped; those with user info (see
 * userInfoHost) are never opened, but listed as withheld with the host they
 * would actually open, and not counted toward the limit. A selection whose
 * URLs all carry user info answers the withheld list as an error, so nothing
 * is run.
 */
export function openUrls(input: LocalInput): LocalOutput {
  const urls = urlsOf(input)
  if (!Array.isArray(urls)) return urls
  const plain = urls.filter(u => userInfoHost(u) === undefined)
  const withheld = urls.filter(u => userInfoHost(u) !== undefined)
  if (plain.length === 0) return { error: withheldText(input.lang, withheld) }
  return { effect: { kind: 'open', urls: plain.slice(0, OPEN_URL_LIMIT), skipped: plain.slice(OPEN_URL_LIMIT), withheld } }
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
  const a = authorityOf(url)
  if (a === undefined) return url
  const { start, authority } = a
  const at = authority.lastIndexOf('@')
  if (at < 0) return url
  const colon = authority.indexOf(':')
  if (colon < 0 || colon > at) return url
  return `${url.slice(0, start)}${authority.slice(0, colon)}:***${url.slice(start + at)}`
}

/**
 * A URL's authority (user info, host and port) as written, and where it
 * starts: from right after the first `//` up to the first of `/ ? #`. This is
 * the authority as RFC 3986 reads it, and as macOS `open` (NSURL) does: unlike
 * URL (WHATWG), which also ends an http(s) URL's authority at `\`, it reads
 * `https://good.com\@evil.com/x` as user info `good.com\` and host `evil.com`.
 * Taking the longer of the two readings, an `@` either of them sees as ending
 * user info is one. Undefined when there is no `//`.
 */
function authorityOf(url: string): { start: number; authority: string } | undefined {
  const slashes = url.indexOf('//')
  if (slashes < 0) return undefined
  const start = slashes + 2
  const rest = url.slice(start)
  const authorityEnd = rest.search(/[/?#]/u)
  return { start, authority: authorityEnd < 0 ? rest : rest.slice(0, authorityEnd) }
}

/**
 * The host (and port) `url` would actually open when it carries user info
 * (anything before an `@` in its authority, empty included; see authorityOf),
 * as written after the authority's last `@`, up to a `\` if any:
 * `https://good.com@evil.com`, `https://good.com]@evil.com` and
 * `https://good.com\@evil.com/x` give `evil.com`. Undefined when there is no
 * user info (an `@` in the path, query or fragment is not one). User info is
 * how a URL shows one host and opens another, so open-urls never opens such a
 * URL, and both actions name the host it would open.
 */
export function userInfoHost(url: string): string | undefined {
  const a = authorityOf(url)
  if (a === undefined) return undefined
  const at = a.authority.lastIndexOf('@')
  if (at < 0) return undefined
  const host = a.authority.slice(at + 1)
  const backslash = host.indexOf('\\')
  return backslash < 0 ? host : host.slice(0, backslash)
}

/**
 * The host URL (WHATWG, as browsers read a URL) gives `url`, normalized
 * (lowercased, an IPv4 address in dotted decimal, ...), when it is not the
 * one userInfoHost names as written: `0x7f.1` for `https://good.com@0x7f.1` is
 * `127.0.0.1`, and `https://good.com\@evil.com` is `good.com` to URL.
 */
function urlStandardHost(url: string, written: string): string | undefined {
  try {
    const host = new URL(url).host
    return host === written.toLowerCase() ? undefined : host
  } catch {
    return undefined
  }
}

const items = (lines: readonly string[]) => lines.map(l => `- ${l}`).join('\n')
const list = (urls: readonly string[]) => items(urls.map(shownUrl))

/** One URL with user info as a result lists it: shown (password hidden), with the host it would actually open. */
function userInfoItem(lang: Lang, url: string): string {
  const host = userInfoHost(url) ?? ''
  const other = urlStandardHost(url, host)
  const note = other === undefined ? '' : lang === 'ja' ? `（URL 標準での解釈: ${other}）` : ` (as the URL standard reads it: ${other})`
  return `${shownUrl(url)} — ${lang === 'ja' ? `実際に開かれるホスト: ${host}` : `the host it would actually open: ${host}`}${note}`
}

const userInfoList = (lang: Lang, urls: readonly string[]) => items(urls.map(u => userInfoItem(lang, u)))

/** open-urls' section on the URLs not opened for their user info (`withheld`, not empty). */
function withheldText(lang: Lang, withheld: readonly string[]): string {
  const n = withheld.length
  const head = lang === 'ja' ? `ユーザー情報（@ より前の部分）付きのため開かなかった URL（${n} 件）:` : `Not opened, as they carry user info (the part before @) (${n}):`
  return `${head}\n${userInfoList(lang, withheld)}`
}

/** copy-urls' warning on the URLs with user info among those found, put first in its result; empty when there are none. */
function userInfoWarning(lang: Lang, urls: readonly string[]): string {
  const flagged = urls.filter(u => userInfoHost(u) !== undefined)
  if (flagged.length === 0) return ''
  const n = flagged.length
  const head =
    lang === 'ja'
      ? `注意: ユーザー情報（@ より前の部分）付きの URL があります。開くと @ の後のホストに接続します（${n} 件）:`
      : `Warning: some URLs carry user info (the part before @); opening one connects to the host after @ (${n}):`
  return `${head}\n${userInfoList(lang, flagged)}\n\n`
}

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
 * URLs with user info are copied all the same (`user@host` has its honest
 * uses), but a warning naming the host each would actually open comes first,
 * so a result cut at its limit still holds it.
 */
export function copyResultText(lang: Lang, urls: readonly string[], failure?: CopyFailure): string {
  const n = urls.length
  const warning = userInfoWarning(lang, urls)
  if (failure === undefined) {
    const head = lang === 'ja' ? `${n} 件の URL をクリップボードにコピーしました（改行区切り）:` : `Copied ${n} ${n === 1 ? 'URL' : 'URLs'} to the clipboard, one per line:`
    return `${warning}${head}\n${list(urls)}`
  }
  const why = 'reason' in failure ? COPY_REASONS[failure.reason][lang] : messageShown(failure.thrown)
  const head =
    lang === 'ja'
      ? `URL をクリップボードにコピーできませんでした: ${why}\n見つかった URL（${n} 件）:`
      : `Could not copy the URLs to the clipboard: ${why}\nThe URLs found (${n}):`
  return `${warning}${head}\n${list(urls)}`
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
 * opened (with why), those started with no word of their end, those not
 * opened for their user info (`withheld`, with the host each would open), and
 * those past OPEN_URL_LIMIT that were not tried, each under its own heading,
 * empty ones left out. Never says a URL "opened": the handler was asked to.
 */
export function openResultText(lang: Lang, attempts: readonly OpenAttempt[], skipped: readonly string[], withheld: readonly string[] = []): string {
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
  if (withheld.length > 0) sections.push(withheldText(lang, withheld))
  if (skipped.length > 0) {
    const head = ja
      ? `上限の ${OPEN_URL_LIMIT} 件を超えたため開かなかった URL（${skipped.length} 件）:`
      : `Not opened, past the limit of ${OPEN_URL_LIMIT} a run (${skipped.length}):`
    sections.push(`${head}\n${list(skipped)}`)
  }
  return sections.join('\n\n')
}
