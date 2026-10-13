import type { Engine } from 'claude-code/testing'

import { expect, mock, test } from './kit'
import { LINEAR_TIMEOUT_MS, expectLinear, runOf } from './timing'

import { ACTIONS } from '../hooks/actions'
import type { LocalInput, LocalOutput } from '../hooks/actions'
import { MESSAGES } from '../hooks/i18n'
import { runLocal } from '../hooks/local'
import { LOCAL_TEXT_LIMIT } from '../hooks/actions'
import {
  LINUX_OPEN_SCRIPT,
  OPEN_TIMEOUT_MS,
  OPEN_URL_LIMIT,
  attemptOfExit,
  attemptOfRejection,
  copyResultText,
  copyUrls,
  extractUrls,
  isHttpUrl,
  openCommandFor,
  openResultText,
  openSucceeded,
  openUrls,
  MESSAGE_LIMIT,
  shownUrl,
} from '../hooks/url-local'
import type { OpenAttempt } from '../hooks/url-local'
import { hasHidden, hiddenCharPattern } from '../hooks/selection-local'
import { BAND, PANE, runCommand, stage, start } from './stage'
import type { Stage } from './stage'

// open-urls and copy-urls (SELM-00089): the URLs of the selection, found by
// pure functions, and the effect register.tsx carries out through
// $.process.run and $.ui.copy. Every stage test answers both from the stage
// (tests/stage.tsx), so no browser is ever opened and no clipboard written.

const INPUT: LocalInput = {
  text: undefined,
  arg: undefined,
  now: 0,
  timeZone: 'UTC',
  lang: 'en',
  utcOffsetMinutes: () => 0,
  random: () => 0.5,
  randomBytes: n => new Uint8Array(n),
}

const run = (compute: (input: LocalInput) => LocalOutput, text: string | undefined, lang: 'ja' | 'en' = 'en') => compute({ ...INPUT, text, lang })

const NO_URL = {
  ja: '選択範囲に URL が見つかりません。http:// または https:// で始まる URL を含めて選択してください。',
  en: 'No URL was found in the selection. Select text that holds a URL starting with http:// or https://.',
}

// ---------------------------------------------------------------------------
// Finding the URLs.

test('extractUrls: one URL, a URL in a sentence, with a query and a fragment, any case of the scheme', () => {
  expect(extractUrls('https://example.com')).toEqual(['https://example.com'])
  expect(extractUrls('see https://example.com/a/b for more')).toEqual(['https://example.com/a/b'])
  expect(extractUrls('http://example.com/p?q=1&r=two#frag')).toEqual(['http://example.com/p?q=1&r=two#frag'])
  expect(extractUrls('HTTPS://Example.com/Path')).toEqual(['HTTPS://Example.com/Path'])
  // Kept as written, not normalised by URL.
  expect(extractUrls('https://EXAMPLE.com:443/a/../b')).toEqual(['https://EXAMPLE.com:443/a/../b'])
  expect(extractUrls('https://例え.テスト/パス')).toEqual(['https://例え.テスト/パス'])
})

test('extractUrls: trailing punctuation, full-width punctuation and unpaired brackets and quotes are left out', () => {
  expect(extractUrls('Go to https://example.com.')).toEqual(['https://example.com'])
  expect(extractUrls('https://a.example, https://b.example; https://c.example: https://d.example! https://e.example?')).toEqual([
    'https://a.example',
    'https://b.example',
    'https://c.example',
    'https://d.example',
    'https://e.example',
  ])
  expect(extractUrls('詳細はhttps://example.com/docsを参照。')).toEqual(['https://example.com/docs'])
  expect(extractUrls('詳細は https://example.com/docs 、または（https://example.org）。「https://example.net」')).toEqual([
    'https://example.com/docs',
    'https://example.org',
    'https://example.net',
  ])
  expect(extractUrls('(see https://example.com/x)')).toEqual(['https://example.com/x'])
  expect(extractUrls("'https://example.com/q'")).toEqual(['https://example.com/q'])
  expect(extractUrls('"https://example.com/d"')).toEqual(['https://example.com/d'])
  expect(extractUrls('**https://example.com/bold**')).toEqual(['https://example.com/bold'])
  // A bracket paired inside the URL is its own.
  expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  expect(extractUrls('(https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
})

test('extractUrls: Japanese run straight on from a URL is not taken into it; an IDN host and a Japanese path or query are kept', () => {
  // Right after the host: the host is not taken for an IDN one.
  expect(extractUrls('詳細はhttps://example.comを参照してください')).toEqual(['https://example.com'])
  // Right after the path.
  expect(extractUrls('https://example.com/docsを見て')).toEqual(['https://example.com/docs'])
  expect(extractUrls('https://example.com/a?q=1で検索、https://example.org/b参照')).toEqual(['https://example.com/a?q=1', 'https://example.org/b'])
  expect(extractUrls('https://example.com/docsのページとhttps://example.org/カタカナ')).toEqual(['https://example.com/docs', 'https://example.org/カタカナ'])
  // Japanese after `/`, `.`, `=` or `//` is the URL's own.
  expect(extractUrls('https://ja.wikipedia.org/wiki/日本')).toEqual(['https://ja.wikipedia.org/wiki/日本'])
  expect(extractUrls('https://ja.wikipedia.org/wiki/東京_(曖昧さ回避) を見て')).toEqual(['https://ja.wikipedia.org/wiki/東京_(曖昧さ回避)'])
  expect(extractUrls('https://example.com/search?q=東京')).toEqual(['https://example.com/search?q=東京'])
  expect(extractUrls('https://例え.テスト/パス')).toEqual(['https://例え.テスト/パス'])
})

test('extractUrls: Japanese right after a closing bracket or quote ends the URL too; a paired bracket stays', () => {
  expect(extractUrls('(https://example.com)を見て')).toEqual(['https://example.com'])
  expect(extractUrls('(https://example.com/foo)を参照')).toEqual(['https://example.com/foo'])
  expect(extractUrls('[https://example.com/a]を参照')).toEqual(['https://example.com/a'])
  expect(extractUrls('{https://example.com/b}を参照')).toEqual(['https://example.com/b'])
  expect(extractUrls("'https://example.com/c'を参照")).toEqual(['https://example.com/c'])
  expect(extractUrls('[リンク](https://example.com/d)を参照')).toEqual(['https://example.com/d'])
  expect(extractUrls('詳細は(https://example.com)、または(https://example.org)で')).toEqual(['https://example.com', 'https://example.org'])
  // A pair inside the URL is the URL's own, Japanese or not after it.
  expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)を参照')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  expect(extractUrls('(https://en.wikipedia.org/wiki/Foo_(bar))を参照')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  expect(extractUrls('https://ja.wikipedia.org/wiki/東京_(曖昧さ回避)の記事')).toEqual(['https://ja.wikipedia.org/wiki/東京_(曖昧さ回避)'])
  // And the URL that follows in the same run is still found.
  expect(extractUrls('(https://a.example)とhttps://b.example')).toEqual(['https://a.example', 'https://b.example'])
})

test('extractUrls: an ellipsis right after a URL ends it', () => {
  expect(extractUrls('https://a.example…')).toEqual(['https://a.example'])
  expect(extractUrls('https://a.example/x…')).toEqual(['https://a.example/x'])
  expect(extractUrls('続きは https://a.example/y‥')).toEqual(['https://a.example/y'])
})

test('extractUrls: URLs joined by a comma with no space are two; a comma inside a path is the URL\'s own', () => {
  expect(extractUrls('https://a.example,https://b.example,HTTP://c.example')).toEqual(['https://a.example', 'https://b.example', 'HTTP://c.example'])
  expect(extractUrls('https://a.example/x,y,z')).toEqual(['https://a.example/x,y,z'])
})

test('extractUrls: in the host, half-width ! , ; or . with Japanese straight after ends the URL; Japanese in the path, query or fragment and an IDN host stay', () => {
  // SELM-00101: the Japanese is not read as part of an IDN host.
  expect(extractUrls('https://example.com,を参照')).toEqual(['https://example.com'])
  expect(extractUrls('https://example.com.を参照')).toEqual(['https://example.com'])
  expect(extractUrls('https://example.com!を見て')).toEqual(['https://example.com'])
  expect(extractUrls('https://example.com;を参照')).toEqual(['https://example.com'])
  expect(extractUrls('詳細はhttps://example.com,を参照してください')).toEqual(['https://example.com'])
  // With a port and user info.
  expect(extractUrls('https://user@example.com:8080,を参照')).toEqual(['https://user@example.com:8080'])
  expect(extractUrls('http://127.0.0.1.を参照')).toEqual(['http://127.0.0.1'])
  // The URL that follows in the same run is still found.
  expect(extractUrls('https://a.example,を見てhttps://b.example')).toEqual(['https://a.example', 'https://b.example'])
  expect(extractUrls('https://a.example.をhttps://b.example;を')).toEqual(['https://a.example', 'https://b.example'])
  // Kept as before: Japanese in the path, query or fragment, and an IDN host.
  expect(extractUrls('https://ja.wikipedia.org/wiki/日本')).toEqual(['https://ja.wikipedia.org/wiki/日本'])
  expect(extractUrls('https://example.com/?q=東京')).toEqual(['https://example.com/?q=東京'])
  expect(extractUrls('https://example.com/#見出し')).toEqual(['https://example.com/#見出し'])
  expect(extractUrls('https://example.com?q=東京')).toEqual(['https://example.com?q=東京'])
  expect(extractUrls('https://例え.テスト/パス')).toEqual(['https://例え.テスト/パス'])
  expect(extractUrls('https://例え.テスト')).toEqual(['https://例え.テスト'])
  // Only in the host: punctuation and Japanese in the path are the URL's own.
  expect(extractUrls('https://example.com/a,日本')).toEqual(['https://example.com/a,日本'])
  expect(extractUrls('https://example.com/a.日本')).toEqual(['https://example.com/a.日本'])
  expect(extractUrls('https://example.com/?q=a;日本')).toEqual(['https://example.com/?q=a;日本'])
  // Punctuation followed by ASCII is as before.
  expect(extractUrls('https://example.com,https://b.example')).toEqual(['https://example.com', 'https://b.example'])
  expect(extractUrls('https://example.com.')).toEqual(['https://example.com'])
  expect(extractUrls('https://example.com,see')).toEqual(['https://example.com,see'])
  // `!`, `,` and `;` end the URL right after an IDN host too.
  expect(extractUrls('https://例え.テスト,を参照')).toEqual(['https://例え.テスト'])
  expect(extractUrls('https://例え.テスト!を見て')).toEqual(['https://例え.テスト'])
})

test('extractUrls: in the host, any half-width symbol with Japanese straight after ends the URL before the symbol; an IDN host, an IPv6 literal and the path stay', () => {
  // SELM-00104: one rule for every symbol, so no other host is read out of the Japanese.
  for (const c of ['@', '-', '~', '_', '&', '+', '$', '*', '|', ':', '%', '=', '^', '{', '(']) {
    expect({ c, urls: extractUrls(`https://example.com${c}を参照`) }).toEqual({ c, urls: ['https://example.com'] })
  }
  // A run of symbols is dropped whole, so no `https://example.com-` is left.
  expect(extractUrls('https://example.com--を参照')).toEqual(['https://example.com'])
  expect(extractUrls('https://example.com.-を参照')).toEqual(['https://example.com'])
  expect(extractUrls('https://example.com@-を参照')).toEqual(['https://example.com'])
  // `]`s between the symbols and the Japanese.
  expect(extractUrls('https://a.example-]を参照')).toEqual(['https://a.example'])
  expect(extractUrls('https://a.example@]]を参照')).toEqual(['https://a.example'])
  // With a port and user info.
  expect(extractUrls('https://user@example.com:8080@を参照')).toEqual(['https://user@example.com:8080'])
  expect(extractUrls('https://example.com:8080-を参照')).toEqual(['https://example.com:8080'])
  // An IPv6 literal keeps its `]`, and a symbol after it is cut.
  expect(extractUrls('https://[::1]を参照')).toEqual(['https://[::1]'])
  expect(extractUrls('https://[::1]:8080を参照')).toEqual(['https://[::1]:8080'])
  expect(extractUrls('https://[::1]@を参照')).toEqual(['https://[::1]'])
  expect(extractUrls('https://[::1].を参照')).toEqual(['https://[::1]'])
  expect(extractUrls('https://[::1]:8080/')).toEqual(['https://[::1]:8080/'])
  // A closing bracket or quote, as before.
  expect(extractUrls('https://example.com)を参照')).toEqual(['https://example.com'])
  expect(extractUrls('https://example.com]を参照')).toEqual(['https://example.com'])
  expect(extractUrls('https://example.com}を参照')).toEqual(['https://example.com'])
  expect(extractUrls("https://a.example@'を参照")).toEqual(['https://a.example'])
  // The URL that follows in the same run is still found.
  expect(extractUrls('https://a.example@を見てhttps://b.example')).toEqual(['https://a.example', 'https://b.example'])
  expect(extractUrls('https://a.example-をhttps://b.example~を')).toEqual(['https://a.example', 'https://b.example'])
  // Symbols at the very start of the host: nothing is left to take.
  expect(extractUrls('https://@を参照')).toEqual([])
  expect(extractUrls('https://-を参照')).toEqual([])
  // An IDN host stays whole: `-` and `.` between non-ASCII characters.
  expect(extractUrls('https://例え-テスト.jp')).toEqual(['https://例え-テスト.jp'])
  expect(extractUrls('https://例え.テスト')).toEqual(['https://例え.テスト'])
  expect(extractUrls('https://例え-テスト.jp/パス')).toEqual(['https://例え-テスト.jp/パス'])
  expect(extractUrls('https://例え.テスト-日本')).toEqual(['https://例え.テスト-日本'])
  expect(extractUrls('https://ü-テスト.de')).toEqual(['https://ü-テスト.de'])
  // Any other symbol after non-ASCII is cut, `@` above all.
  expect(extractUrls('https://例え.テスト@を参照')).toEqual(['https://例え.テスト'])
  expect(extractUrls('https://例え.テスト~を参照')).toEqual(['https://例え.テスト'])
  expect(extractUrls('https://例え.テスト-@を参照')).toEqual(['https://例え.テスト'])
  // Only in the host: symbols and Japanese in the path, query or fragment are the URL's own.
  expect(extractUrls('https://example.com/a@日本')).toEqual(['https://example.com/a@日本'])
  expect(extractUrls('https://example.com/-日本')).toEqual(['https://example.com/-日本'])
  expect(extractUrls('https://example.com/?q=a&東京')).toEqual(['https://example.com/?q=a&東京'])
  expect(extractUrls('https://example.com/#a-見出し')).toEqual(['https://example.com/#a-見出し'])
  expect(extractUrls('https://example.com?q=a@東京')).toEqual(['https://example.com?q=a@東京'])
  expect(extractUrls('https://example.com-/を参照')).toEqual(['https://example.com-/を参照'])
  // A symbol followed by ASCII is as before.
  expect(extractUrls('https://example.com-a')).toEqual(['https://example.com-a'])
  expect(extractUrls('https://user@example.com')).toEqual(['https://user@example.com'])
  expect(extractUrls('https://example.com:8080')).toEqual(['https://example.com:8080'])
})

test('extractUrls: the known limits of the symbol rule in the host, as intended', () => {
  // A symbol after ASCII cannot be told from the one in `https://example.com-を参照`,
  // so a label mixing ASCII, a symbol and Japanese is cut before the symbol.
  expect(extractUrls('https://abc-テスト.jp')).toEqual(['https://abc'])
  // Nor `@` before a Japanese host from `https://example.com@を参照`.
  expect(extractUrls('https://user@例え.jp')).toEqual(['https://user'])
})

test('extractUrls: the two known limits of the `.` rule in the host, as intended', () => {
  // A `.` after Japanese cannot be told from the dot between the labels of an
  // IDN host, so `.` and Japanese straight after an IDN host stay in it.
  expect(extractUrls('https://例え.テスト.を参照')).toEqual(['https://例え.テスト.を参照'])
  // A `.` after ASCII cannot be told from the one in `https://example.com.を参照`,
  // so an ASCII label followed by a Japanese top-level label is cut at the `.`.
  expect(extractUrls('https://example.みんな')).toEqual(['https://example'])
  // White space or full-width punctuation still ends the URL after an IDN host.
  expect(extractUrls('https://例え.テスト。を参照')).toEqual(['https://例え.テスト'])
  expect(extractUrls('https://例え.テスト .を参照')).toEqual(['https://例え.テスト'])
})

test('extractUrls: URLs in brackets joined with no space are two; a bracket paired inside the URL stays', () => {
  expect(extractUrls('(https://a.example)(https://b.example)')).toEqual(['https://a.example', 'https://b.example'])
  expect(extractUrls('(http://a.example/x)(HTTPS://b.example/y)')).toEqual(['http://a.example/x', 'HTTPS://b.example/y'])
  expect(extractUrls('{https://a.example}(https://b.example)')).toEqual(['https://a.example', 'https://b.example'])
  expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)(https://b.example)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://b.example'])
  expect(extractUrls('[a](https://a.example)(https://b.example)')).toEqual(['https://a.example', 'https://b.example'])
  expect(extractUrls('(https://a.example)(https://b.example)(https://c.example)')).toEqual(['https://a.example', 'https://b.example', 'https://c.example'])
  // As before.
  expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  expect(extractUrls('(see https://a.example)')).toEqual(['https://a.example'])
  expect(extractUrls('https://a.example/f(x)(y)')).toEqual(['https://a.example/f(x)(y)'])
})

test('extractUrls: a long run of closing brackets (or of brackets and periods) is trimmed in linear time', { timeoutMs: LINEAR_TIMEOUT_MS }, () => {
  for (const [label, piece, n] of [['closing parentheses', ')', 200_000], ['parentheses and periods', ').', 100_000], ['closing square brackets', ']', 200_000], ['braces and punctuation', '}.,;', 50_000]] as const) {
    const text = (k: number) => `https://a.example/${piece.repeat(k)}`
    expect({ label, urls: extractUrls(text(n)) }).toEqual({ label, urls: ['https://a.example/'] })
    expectLinear(label, text, extractUrls, { n })
  }
  // At the selection limit of a local action, through the compute.
  const atLimit = (k: number) => `https://a.example/${')'.repeat(k)}`
  expect(run(copyUrls, atLimit(999_000))).toEqual({ effect: { kind: 'copy', urls: ['https://a.example/'] } })
  expectLinear('closing parentheses, through copy-urls', atLimit, t => run(copyUrls, t), { n: 999_000 })
  // The pairing still holds after the change.
  expect(extractUrls('((https://en.wikipedia.org/wiki/Foo_(bar))))')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
})

test('extractUrls: a run of URLs each cut by Japanese or a hidden character, with no space, is read in linear time', { timeoutMs: LINEAR_TIMEOUT_MS }, () => {
  /** The text at its size n read as `check` expects, then extractUrls timed in linear time over the size. */
  const linear = (label: string, text: (k: number) => string, n: number, check: (urls: string[]) => void) => {
    check(extractUrls(text(n)))
    expectLinear(label, text, extractUrls, { n })
  }
  // The same URL over and over: one URL, each cut found once.
  linear('kana cuts', runOf('https://aあ'), 20_000, urls => expect(urls).toEqual(['https://a']))
  linear('zero-width cuts', runOf('https://a\u200b'), 40_000, urls => expect(urls).toEqual(['https://a']))
  linear('bracketed, kana cuts', runOf('(https://a.example)を'), 10_000, urls => expect(urls).toEqual(['https://a.example']))
  // Cut in the host by punctuation and Japanese (SELM-00101), and URLs in brackets joined with no space.
  linear('host punctuation cuts', runOf('https://a.example,あ'), 10_000, urls => expect(urls).toEqual(['https://a.example']))
  linear('host period cuts', runOf('https://a.example.あ'), 10_000, urls => expect(urls).toEqual(['https://a.example']))
  linear('different URLs, host punctuation cuts', k => Array.from({ length: k }, (_, i) => `https://a${i}.example;を`).join(''), 20_000, urls => {
    expect(urls.length).toBe(20_000)
    expect(urls[19_999]).toBe('https://a19999.example')
  })
  linear('bracketed URLs joined', runOf('(https://a.example)'), 20_000, urls => expect(urls).toEqual(['https://a.example']))
  // Cut in the host by any symbol and Japanese (SELM-00104), and long runs of symbols.
  linear('host @ cuts', runOf('https://a.example@あ'), 10_000, urls => expect(urls).toEqual(['https://a.example']))
  linear('host hyphen cuts', runOf('https://a.example-あ'), 10_000, urls => expect(urls).toEqual(['https://a.example']))
  linear('host hyphen and ] cuts', runOf('https://a.example-]あ'), 10_000, urls => expect(urls).toEqual(['https://a.example']))
  linear('a long run of hyphens', k => `https://a${'-'.repeat(k)}.example`, 400_000, urls => expect(urls.length).toBe(1))
  linear('a long run of @ and -', k => `https://a${'@-'.repeat(k)}x`, 200_000, urls => expect(urls.length).toBe(1))
  // `]` outside an IPv6 literal is no host URL reads, so nothing is taken; only the time counts.
  linear('a long run of ]', k => `https://a-${']'.repeat(k)}x`, 400_000, urls => expect(urls).toEqual([]))
  linear('a long run of - and ]', k => `https://a${'-]'.repeat(k)}x`, 200_000, urls => expect(urls).toEqual([]))
  // Not cut before the run (a host this long is more than URL takes, so it is not taken either).
  linear('a long IDN run of - and .', k => `https://例${'-.'.repeat(k)}テ`, 200_000, urls => expect(urls).not.toContain('https://例'))
  linear('a long IDN run of - and . then @', k => `https://例${'-.'.repeat(k)}@を`, 200_000, urls => expect(urls).toEqual(['https://例']))
  // A long host with no path, then a cut, and a long path after one URL with no cut.
  linear('a long host before a cut', k => `https://${'a.'.repeat(k)}example,を`, 400_000, urls => expect(urls).toEqual([`https://${'a.'.repeat(400_000)}example`]))
  linear('a long run of hosts', k => `https://${'a,'.repeat(k)}`, 400_000, urls => expect(urls.length).toBe(1))
  // Every one a different URL.
  linear('different URLs', k => Array.from({ length: k }, (_, i) => `https://a${i}.exampleを`).join(''), 20_000, urls => {
    expect(urls.length).toBe(20_000)
    expect(urls[19_999]).toBe('https://a19999.example')
  })
  // One cut and a long run after it with no other URL, and a long run of hidden characters.
  linear('a long run after a cut', k => `https://a.exampleを${'あa'.repeat(k)}`, 400_000, urls => expect(urls).toEqual(['https://a.example']))
  linear('a long run of zero-width spaces', k => `https://a.example${'\u200b'.repeat(k)}`, 900_000, urls => expect(urls).toEqual(['https://a.example']))
})

test('copy-urls: a run of URLs each cut by Japanese, a hidden character or a closing bracket, at the selection limit, is read in linear time', { timeoutMs: LINEAR_TIMEOUT_MS }, () => {
  // At the selection limit of a local action, through the compute: kana, zero-width and closing brackets.
  for (const unit of ['https://aあ', 'https://a\u200b', '(https://a)を']) {
    const n = Math.floor(999_000 / unit.length)
    const text = (k: number) => unit.repeat(k)
    expect({ unit, out: run(copyUrls, text(n)) }).toEqual({ unit, out: { effect: { kind: 'copy', urls: ['https://a'] } } })
    expectLinear(`through copy-urls: ${unit}`, text, t => run(copyUrls, t), { n })
  }
})

test('hiddenCharPattern: each character it matches is one hasHidden flags on its own', () => {
  // The kinds hasHidden keeps in context (a ZWJ, selectors, Mongolian ones, a tag) are flagged alone.
  for (const c of ['\u0000', '\u0007', '\u007f', '\u0085', '\u00ad', '\u200b', '\u200d', '\u202e', '\u2066', '\u2028', '\ufe0f', '\ufe00', '\u180b', '\u180e', '\u{e0041}', '\u{e007f}', '\u{e0100}', '\u3164', '\ufeff']) {
    expect(new RegExp(hiddenCharPattern().source, 'u').test(c)).toBe(true)
    expect(hasHidden(c)).toBe(true)
  }
  for (const c of ['a', 'あ', ' ', '\n', '👍']) expect(hiddenCharPattern().test(c)).toBe(false)
})

test('extractUrls: the same URLs as reading again from each cut (the rule before it was made linear), on random text', () => {
  // The rule, written the plain way: a candidate, cut at its first hidden
  // character (hasHidden a character) and where Japanese runs on, read again
  // from the cut, trimmed by counting afresh at each step. Slow on long text,
  // so only short texts are compared.
  const count = (s: string, c: string) => s.split(c).length - 1
  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const trim = (s: string) => {
    for (;;) {
      const last = s.at(-1)
      if (last === undefined) return s
      const opener = closers[last]
      if (!('.,;:!?*_~'.includes(last) || (opener !== undefined && count(s, last) > count(s, opener)) || (last === "'" && count(s, "'") % 2 === 1))) return s
      s = s.slice(0, -1)
    }
  }
  const japanese = /[A-Za-z0-9)\]}'](?=[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々〆])/u
  const reference = (text: string) => {
    const candidate = /https?:\/\/[^\s<>"`、。，．！？「」『』（）【】＜＞［］｛｝…‥]+/giu
    const split = text
      .replaceAll('](', '] (')
      .replace(/,(?=https?:\/\/)/giu, ', ')
      .replace(/\)\(http(s?):\/\//giu, ') (http$1://')
      .replace(/\}\(http(s?):\/\//giu, '} (http$1://')
    const urls: string[] = []
    for (let m = candidate.exec(split); m !== null; m = candidate.exec(split)) {
      let cut = ''
      for (const ch of m[0]) {
        if (hasHidden(ch)) break
        cut += ch
      }
      const j = japanese.exec(cut)
      if (j !== null) cut = cut.slice(0, j.index + 1)
      // In the host, the first run of half-width symbols (ASCII printable,
      // not a letter or digit, not `/ ? # \` and not `]`, which closes an
      // IPv6 literal) with Japanese after it, or after `]`s, read off the
      // whole candidate: cut before the run, unless the run is only `-` and
      // `.` after a non-ASCII character with Japanese straight after it.
      const scheme = m[0].slice(0, 8).toLowerCase() === 'https://' ? 8 : 7
      const host = m[0].slice(scheme).split(/[/?#\\]/)[0]!
      const isSymbol = (c: string | undefined) =>
        c !== undefined && c.length === 1 && c >= '!' && c <= '~' && !/[A-Za-z0-9]/.test(c) && !'/?#\\]'.includes(c)
      const isJapanese = (s: string) => /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々〆]/u.test(s)
      for (let i = 0; i < host.length; i++) {
        if (!isSymbol(host[i]) || isSymbol(host[i - 1])) continue
        let j = i
        while (isSymbol(host[j])) j++
        let k = j
        while (host[k] === ']') k++
        if (!isJapanese(host.slice(k))) continue
        const afterNonAscii = i > 0 && host.charCodeAt(i - 1) > 0x7f
        const idn = afterNonAscii && /^[-.]+$/.test(host.slice(i, j)) && k === j
        if (!idn) {
          cut = cut.slice(0, Math.min(cut.length, scheme + i))
          break
        }
      }
      candidate.lastIndex = m.index + cut.length
      const url = trim(cut)
      if (!urls.includes(url) && isHttpUrl(url)) urls.push(url)
    }
    return urls
  }
  const pieces = ['https://', 'http://', 'HTTPS://', 'a', 'b9', '.', '/', 'x', 'あ', '漢', 'カ', 'ー', '(', ')', '[', ']', '{', '}', "'", '](', ',', ' ', '、', '…', '=', '?', '@', ':', '\u200b', '\u202e', '\u200d', '\ufe0f', '👍', '\u{e0041}', '\u0007', '!', ';', '(https://', '[::1]', '-', '~', '_', '&', '+', '$', '*', '|', '%', 'ü']
  let seed = 12345
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  let withUrls = 0
  for (let i = 0; i < 5_000; i++) {
    let text = ''
    for (let k = 1 + next(30); k > 0; k--) text += pieces[next(pieces.length)]
    const urls = extractUrls(text)
    expect({ text, urls }).toEqual({ text, urls: reference(text) })
    if (urls.length > 0) withUrls++
  }
  expect(withUrls).toBeGreaterThan(500)
})

test('shownUrl: the password of the user info is hidden, as parse-url hides it; nothing else changes', () => {
  expect(shownUrl('https://user:secret@example.com/p')).toBe('https://user:***@example.com/p')
  expect(shownUrl('https://user:se:c@r@et@example.com')).toBe('https://user:***@example.com')
  expect(shownUrl('https://user@example.com/p')).toBe('https://user@example.com/p')
  expect(shownUrl('https://example.com:8080/a@b')).toBe('https://example.com:8080/a@b')
  expect(shownUrl('https://example.com/?u=a:b@c')).toBe('https://example.com/?u=a:b@c')
  expect(shownUrl('https://example.com')).toBe('https://example.com')
})

test('copyResultText / openResultText: a URL\'s password is hidden in the result; an engine message is cut at MESSAGE_LIMIT', () => {
  const u = 'https://me:hunter2@example.com/x'
  expect(copyResultText('en', [u])).toBe('Copied 1 URL to the clipboard, one per line:\n- https://me:***@example.com/x')
  const open = openResultText('en', [{ url: u, status: 'requested' }, { url: u, status: 'failed', reason: { exitCode: 1 } }, { url: u, status: 'unconfirmed' }], [u])
  expect(open).not.toContain('hunter2')
  expect(open).toContain('- https://me:***@example.com/x — exit code 1')
  const long = 'x'.repeat(MESSAGE_LIMIT * 10)
  const copied = copyResultText('en', ['https://a.example'], { thrown: long })
  expect(copied).toContain(`${'x'.repeat(MESSAGE_LIMIT)}…`)
  expect(copied).not.toContain('x'.repeat(MESSAGE_LIMIT + 1))
  const notStarted = openResultText('ja', [{ url: 'https://a.example', status: 'failed', reason: { notStarted: long } }], [])
  expect(notStarted).not.toContain('x'.repeat(MESSAGE_LIMIT + 1))
})

test('extractUrls: a Markdown link and an angle-bracketed URL give the URL alone', () => {
  expect(extractUrls('[the docs](https://example.com/docs)')).toEqual(['https://example.com/docs'])
  expect(extractUrls('<https://example.com/a>')).toEqual(['https://example.com/a'])
  expect(extractUrls('[https://example.com/l](https://example.com/r)')).toEqual(['https://example.com/l', 'https://example.com/r'])
})

test('extractUrls: other schemes, bare hosts and URLs with no host are not taken', () => {
  for (const text of ['javascript:alert(1)', 'ftp://example.com/f', 'file:///etc/passwd', 'mailto:a@example.com', 'www.example.com', 'example.com/path', 'https://', 'http:///x', 'data:text/html,hi']) {
    expect([text, extractUrls(text)]).toEqual([text, []])
  }
  // A javascript: URL inside an http one's query is part of that URL, opened as it.
  expect(extractUrls('https://example.com/?next=javascript:alert(1)')).toEqual(['https://example.com/?next=javascript:alert(1)'])
})

test('extractUrls: a URL ends at a hidden character (a control, bidirectional or zero-width one)', () => {
  expect(extractUrls('https://example.com/a‮gnp.exe')).toEqual(['https://example.com/a'])
  expect(extractUrls('https://example.com/b​more')).toEqual(['https://example.com/b'])
  expect(extractUrls('https://example.com/c\u001b[31m')).toEqual(['https://example.com/c'])
  for (const url of extractUrls('https://a.example/⁦x https://b.example/\u0007')) expect(/[\u0000-\u001f​-‏‪-‮⁦-⁩]/.test(url)).toBe(false)
})

test('extractUrls: several URLs in the order they first appear, each once', () => {
  expect(extractUrls('https://b.example https://a.example\nhttps://b.example\thttps://c.example https://a.example')).toEqual([
    'https://b.example',
    'https://a.example',
    'https://c.example',
  ])
  // The same URL written in another case is another URL as written.
  expect(extractUrls('https://a.example/X https://a.example/x')).toEqual(['https://a.example/X', 'https://a.example/x'])
})

test('isHttpUrl: http(s) with a host only, no white space, no hidden character', () => {
  expect(isHttpUrl('https://example.com')).toBe(true)
  expect(isHttpUrl('http://127.0.0.1:8080/x')).toBe(true)
  for (const bad of ['', 'https://', 'ftp://example.com', 'javascript:alert(1)', 'https://exa mple.com', 'https://example.com/‮', ' https://example.com', '-https://example.com']) {
    expect([bad, isHttpUrl(bad)]).toEqual([bad, false])
  }
})

// ---------------------------------------------------------------------------
// The computes: an effect, or the no-URL guidance.

test('open-urls and copy-urls are local actions on the selection of category data, after parse-url', () => {
  const ids = ACTIONS.map(a => a.id)
  expect(ids.slice(ids.indexOf('parse-url'), ids.indexOf('parse-url') + 3)).toEqual(['parse-url', 'open-urls', 'copy-urls'])
  const open = ACTIONS.find(a => a.id === 'open-urls')
  const copy = ACTIONS.find(a => a.id === 'copy-urls')
  expect(open).toMatchObject({ kind: 'local', category: 'data', label: { ja: 'URLを開く', en: 'Open URLs' } })
  expect(copy).toMatchObject({ kind: 'local', category: 'data', label: { ja: 'URLをコピー', en: 'Copy URLs' } })
  expect(open?.kind === 'local' && open.compute).toBe(openUrls)
  expect(copy?.kind === 'local' && copy.compute).toBe(copyUrls)
  expect(open?.target).toBeUndefined()
  expect(copy?.target).toBeUndefined()
})

test('no URL: both actions answer the guidance as an error, in both languages; no text: the usual one', () => {
  for (const lang of ['ja', 'en'] as const) {
    for (const compute of [openUrls, copyUrls]) {
      expect(run(compute, 'no link here, only www.example.com and ftp://x.example', lang)).toEqual({ error: NO_URL[lang] })
      expect(run(compute, undefined, lang)).toEqual({ error: lang === 'ja' ? 'テキストが選択されていません。' : 'No text is selected.' })
      expect(run(compute, '', lang)).toEqual({ error: lang === 'ja' ? 'テキストが選択されていません。' : 'No text is selected.' })
    }
  }
})

test('open-urls: the first five to open, the rest skipped; copy-urls: every URL', () => {
  const seven = Array.from({ length: 7 }, (_, i) => `https://e${i}.example/`)
  expect(OPEN_URL_LIMIT).toBe(5)
  expect(run(openUrls, seven.join(' '))).toEqual({ effect: { kind: 'open', urls: seven.slice(0, 5), skipped: seven.slice(5) } })
  expect(run(openUrls, 'a https://a.example b https://a.example')).toEqual({ effect: { kind: 'open', urls: ['https://a.example'], skipped: [] } })
  expect(run(copyUrls, seven.join('\n'))).toEqual({ effect: { kind: 'copy', urls: seven } })
})

test('runLocal: an effect of an action on the selection is handed on; of a standalone one, or of an unknown shape, a failure', () => {
  const t = MESSAGES.en
  const def = (compute: (input: LocalInput) => LocalOutput) => ({ compute })
  const input = { ...INPUT, text: 'https://a.example https://b.example' }
  expect(runLocal(def(openUrls), input, { selection: true, lang: 'en' })).toEqual({
    kind: 'effect',
    effect: { kind: 'open', urls: ['https://a.example', 'https://b.example'], skipped: [] },
  })
  expect(runLocal(def(copyUrls), input, { selection: true, lang: 'en' })).toEqual({
    kind: 'effect',
    effect: { kind: 'copy', urls: ['https://a.example', 'https://b.example'] },
  })
  expect(runLocal(def(copyUrls), input, { selection: false, lang: 'en' })).toEqual({ kind: 'settle', ok: false, text: t.failed(t.localEffectStandalone) })
  const odd = (effect: unknown) => runLocal(def(() => ({ effect }) as unknown as LocalOutput), input, { selection: true, lang: 'en' })
  for (const effect of [
    null,
    { kind: 'copy', urls: [] },
    { kind: 'copy', urls: ['javascript:alert(1)'] },
    { kind: 'copy', urls: ['file:///etc/passwd'] },
    { kind: 'open', urls: ['https://a.example'] },
    { kind: 'open', urls: Array.from({ length: 6 }, (_, i) => `https://e${i}.example`), skipped: [] },
    { kind: 'open', urls: ['https://a.example'], skipped: ['ftp://x.example'] },
    { kind: 'run', urls: ['https://a.example'] },
  ]) {
    expect(odd(effect)).toMatchObject({ kind: 'settle', ok: false })
  }
})

// ---------------------------------------------------------------------------
// The commands and the words.

test('openCommandFor: open on macOS, rundll32 on Windows, xdg-open detached through a fixed script on Linux', () => {
  const url = 'https://example.com/a?b=c&d=e'
  expect(openCommandFor('darwin', url)).toEqual(['open', url])
  expect(openCommandFor('win32', url)).toEqual(['rundll32', 'url.dll,FileProtocolHandler', url])
  expect(openCommandFor('linux', url)).toEqual(['/bin/sh', '-c', LINUX_OPEN_SCRIPT, 'sh', url])
  // The script redirects xdg-open's streams, puts it in the background and says 127 with none.
  expect(LINUX_OPEN_SCRIPT).toBe('command -v xdg-open >/dev/null 2>&1 || exit 127; xdg-open "$1" </dev/null >/dev/null 2>&1 &')
})

test('openCommandFor on Linux: the URL is only ever the positional argument, whatever it holds', () => {
  for (const url of [
    "https://example.com/'quoted'",
    'https://example.com/$(touch%20x)',
    'https://example.com/a;rm',
    'https://example.com/`id`',
    'https://example.com/a&b|c',
    'https://example.com/$HOME',
  ]) {
    expect([url, isHttpUrl(url)]).toEqual([url, true])
    const argv = openCommandFor('linux', url)
    expect(argv).toHaveLength(5)
    expect(argv.slice(0, 4)).toEqual(['/bin/sh', '-c', LINUX_OPEN_SCRIPT, 'sh'])
    expect(argv[4]).toBe(url)
    expect(LINUX_OPEN_SCRIPT.includes(url)).toBe(false)
  }
})

test('copyResultText: the URLs copied, or why not with the URLs to copy by hand, in both languages', () => {
  const urls = ['https://a.example', 'https://b.example']
  expect(copyResultText('en', urls)).toBe('Copied 2 URLs to the clipboard, one per line:\n- https://a.example\n- https://b.example')
  expect(copyResultText('en', urls.slice(0, 1))).toBe('Copied 1 URL to the clipboard, one per line:\n- https://a.example')
  expect(copyResultText('ja', urls)).toBe('2 件の URL をクリップボードにコピーしました（改行区切り）:\n- https://a.example\n- https://b.example')
  expect(copyResultText('en', urls, { reason: 'no-surface' })).toBe(
    'Could not copy the URLs to the clipboard: there is no screen to copy on (a -p run, for one)\nThe URLs found (2):\n- https://a.example\n- https://b.example',
  )
  expect(copyResultText('en', urls, { reason: 'no-clipboard' })).toContain('nothing could be written to a clipboard')
  expect(copyResultText('en', urls, { reason: 'refused' })).toContain('the copy was refused')
  expect(copyResultText('ja', urls, { reason: 'no-surface' })).toContain('URL をクリップボードにコピーできませんでした: コピー先の画面がありません')
  expect(copyResultText('ja', urls, { reason: 'no-clipboard' })).toContain('クリップボードに書き込めませんでした')
  expect(copyResultText('ja', urls, { reason: 'refused' })).toContain('コピーが拒否されました')
  // A thrown message is shown with its hidden characters escaped.
  expect(copyResultText('en', urls, { thrown: 'bad\u001b[2J' })).toContain('bad\\u001b[2J')
})

test('attemptOfExit / attemptOfRejection: 0 is asked, others fail, 127 on Linux is xdg-open missing, a timeout is unconfirmed', () => {
  const u = 'https://a.example'
  expect(attemptOfExit('darwin', u, 0)).toEqual({ url: u, status: 'requested' })
  expect(attemptOfExit('darwin', u, 1)).toEqual({ url: u, status: 'failed', reason: { exitCode: 1 } })
  expect(attemptOfExit('darwin', u, 127)).toEqual({ url: u, status: 'failed', reason: { exitCode: 127 } })
  expect(attemptOfExit('linux', u, 127)).toEqual({ url: u, status: 'failed', reason: { missingXdgOpen: true } })
  expect(attemptOfRejection(u, 'ENOENT: no such file', 5)).toEqual({ url: u, status: 'failed', reason: { notStarted: 'ENOENT: no such file' } })
  expect(attemptOfRejection(u, 'the command timed out', 5)).toEqual({ url: u, status: 'unconfirmed' })
  expect(attemptOfRejection(u, 'Timeout', 5)).toEqual({ url: u, status: 'unconfirmed' })
  // No word of a timeout, but as long as one (a little short of it too).
  expect(OPEN_TIMEOUT_MS).toBe(3_000)
  expect(attemptOfRejection(u, 'still running', OPEN_TIMEOUT_MS)).toEqual({ url: u, status: 'unconfirmed' })
  expect(attemptOfRejection(u, 'still running', OPEN_TIMEOUT_MS * 0.95)).toEqual({ url: u, status: 'unconfirmed' })
  expect(attemptOfRejection(u, 'killed', OPEN_TIMEOUT_MS * 0.5)).toMatchObject({ status: 'failed' })
})

test('openResultText: each outcome under its own heading, empty ones left out; done unless every URL failed', () => {
  const asked: OpenAttempt = { url: 'https://a.example', status: 'requested' }
  const failed: OpenAttempt = { url: 'https://b.example', status: 'failed', reason: { exitCode: 2 } }
  const missing: OpenAttempt = { url: 'https://c.example', status: 'failed', reason: { missingXdgOpen: true } }
  const notStarted: OpenAttempt = { url: 'https://d.example', status: 'failed', reason: { notStarted: 'spawn ENOENT' } }
  const unconfirmed: OpenAttempt = { url: 'https://e.example', status: 'unconfirmed' }

  expect(openResultText('en', [asked], [])).toBe('Asked the system to open in the browser (1):\n- https://a.example')
  expect(openResultText('ja', [asked], [])).toBe('ブラウザで開くよう依頼しました（1 件）:\n- https://a.example')
  expect(openResultText('en', [asked, failed, missing, notStarted, unconfirmed], ['https://f.example'])).toBe(
    [
      'Asked the system to open in the browser (1):\n- https://a.example',
      'Could not open (3):\n- https://b.example — exit code 2\n- https://c.example — xdg-open was not found\n- https://d.example — could not start (spawn ENOENT)',
      'Started, but could not confirm it finished (1; the browser may have opened it):\n- https://e.example',
      'Not opened, past the limit of 5 a run (1):\n- https://f.example',
    ].join('\n\n'),
  )
  const ja = openResultText('ja', [failed, missing, notStarted, unconfirmed], ['https://f.example'])
  expect(ja).toContain('開けませんでした（3 件）:\n- https://b.example — 終了コード 2\n- https://c.example — xdg-open が見つかりません\n- https://d.example — 起動できませんでした（spawn ENOENT）')
  expect(ja).toContain('起動しましたが完了を確認できませんでした（1 件。ブラウザでは開いている場合があります）:\n- https://e.example')
  expect(ja).toContain('上限の 5 件を超えたため開かなかった URL（1 件）:\n- https://f.example')
  // Never says "opened" outright.
  expect(openResultText('en', [asked], [])).not.toContain('Opened')

  expect(openSucceeded([asked, failed])).toBe(true)
  expect(openSucceeded([unconfirmed])).toBe(true)
  expect(openSucceeded([failed, missing, notStarted])).toBe(false)
})

// ---------------------------------------------------------------------------
// Through register.tsx: what reaches $.process.run and $.ui.copy, and the entry.

/** The entry's Text in the pane starting with `head`, with whether it is drawn as a failure. */
async function entry($: Engine, head: string): Promise<{ text: string; failed: boolean } | undefined> {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = await pane.findAll({ type: 'Text' })
  await pane.unmount()
  const t = texts.find(x => typeof x.text === 'string' && x.text.startsWith(head))
  return t === undefined || typeof t.text !== 'string' ? undefined : { text: t.text, failed: t.props.color === 'error' }
}

const select = async (s: Stage, clock: { advance: (ms: number) => Promise<unknown> }, text: string) => {
  s.selected = null
  await clock.advance(400)
  s.selected = text
  await clock.advance(400)
}

test('copy-urls: the URLs reach $.ui.copy one per line, and the entry is done; refused, failed with the URLs listed', { options: { language: 'en', pinActions: 'copy-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)

  await select(s, clock, 'see https://a.example/x, and (https://b.example/y). Again: https://a.example/x')
  await runCommand($, 'copy-urls')
  expect(s.copies).toEqual([{ text: 'https://a.example/x\nhttps://b.example/y' }])
  expect(s.processRuns).toEqual([])
  expect(await entry($, 'Copied 2 URLs')).toEqual({ text: 'Copied 2 URLs to the clipboard, one per line:\n- https://a.example/x\n- https://b.example/y', failed: false })

  s.copyAnswer = { isCopied: false, reason: 'no-clipboard' }
  await select(s, clock, 'https://c.example')
  await runCommand($, 'copy-urls')
  expect(s.copies.at(-1)).toEqual({ text: 'https://c.example' })
  expect(await entry($, 'Could not copy')).toEqual({
    text: 'Could not copy the URLs to the clipboard: nothing could be written to a clipboard\nThe URLs found (1):\n- https://c.example',
    failed: true,
  })
})

test('copy-urls pressed on the hint line copies on the surface it was pressed on', { options: { language: 'en', pinActions: 'copy-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  s.selected = 'https://a.example'
  await clock.advance(400)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'copy-urls' })
  await band.unmount()
  expect(s.copies).toEqual([{ text: 'https://a.example', surface: 'terminal' }])
})

test('open-urls on macOS: open with each URL in order, at most five, with the timeout; the rest listed; uname asked once', { options: { language: 'en', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const seven = Array.from({ length: 7 }, (_, i) => `https://e${i}.example/`)

  await select(s, clock, seven.join(' '))
  await runCommand($, 'open-urls')
  expect(s.processRuns).toEqual([
    { argv: ['uname', '-s'], timeoutMs: OPEN_TIMEOUT_MS },
    ...seven.slice(0, 5).map(u => ({ argv: ['open', u], timeoutMs: OPEN_TIMEOUT_MS })),
  ])
  expect(s.copies).toEqual([])
  const done = await entry($, 'Asked the system to open')
  expect(done?.failed).toBe(false)
  expect(done?.text).toBe(
    `Asked the system to open in the browser (5):\n${seven.slice(0, 5).map(u => `- ${u}`).join('\n')}\n\nNot opened, past the limit of 5 a run (2):\n- ${seven[5]}\n- ${seven[6]}`,
  )

  // Again: the OS is known, uname is not asked again.
  await select(s, clock, 'https://again.example')
  await runCommand($, 'open-urls')
  expect(s.processRuns.filter(r => r.argv[0] === 'uname')).toHaveLength(1)
  expect(s.processRuns.at(-1)).toEqual({ argv: ['open', 'https://again.example'], timeoutMs: OPEN_TIMEOUT_MS })
})

test('open-urls on Windows: OS=Windows_NT gives rundll32, and uname is never asked', { options: { language: 'en', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { OS: 'Windows_NT' })
  const s = stage(on)
  await start($)
  await select(s, clock, 'https://a.example/?q=1&r=2')
  await runCommand($, 'open-urls')
  expect(s.processRuns).toEqual([{ argv: ['rundll32', 'url.dll,FileProtocolHandler', 'https://a.example/?q=1&r=2'], timeoutMs: OPEN_TIMEOUT_MS }])
  expect((await entry($, 'Asked the system'))?.failed).toBe(false)
})

test('open-urls on Linux: the detached start, and 127 says xdg-open is missing (failed)', { options: { language: 'en', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  s.processAnswer = argv => (argv[0] === 'uname' ? { exitCode: 0, stdout: 'Linux\n' } : { exitCode: 127 })
  await start($)
  await select(s, clock, 'https://a.example')
  await runCommand($, 'open-urls')
  expect(s.processRuns).toEqual([
    { argv: ['uname', '-s'], timeoutMs: OPEN_TIMEOUT_MS },
    { argv: ['/bin/sh', '-c', LINUX_OPEN_SCRIPT, 'sh', 'https://a.example'], timeoutMs: OPEN_TIMEOUT_MS },
  ])
  expect(await entry($, 'Could not open')).toEqual({ text: 'Could not open (1):\n- https://a.example — xdg-open was not found', failed: true })
})

test('open-urls: uname failing counts as Linux', { options: { language: 'en', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  s.processAnswer = argv => (argv[0] === 'uname' ? { deny: 'no uname here' } : { exitCode: 0 })
  await start($)
  await select(s, clock, 'https://a.example')
  await runCommand($, 'open-urls')
  expect(s.processRuns.at(-1)?.argv.slice(0, 4)).toEqual(['/bin/sh', '-c', LINUX_OPEN_SCRIPT, 'sh'])
})

test('open-urls: a uname that failed is not kept: the next run asks again, and macOS is found then', { options: { language: 'en', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  let unameFails = true
  s.processAnswer = argv => (argv[0] === 'uname' ? (unameFails ? { deny: 'timed out' } : { exitCode: 0, stdout: 'Darwin\n' }) : { exitCode: 0 })
  await start($)
  await select(s, clock, 'https://a.example')
  await runCommand($, 'open-urls')
  expect(s.processRuns.at(-1)?.argv[0]).toBe('/bin/sh')

  unameFails = false
  await select(s, clock, 'https://b.example')
  await runCommand($, 'open-urls')
  expect(s.processRuns.slice(-2)).toEqual([
    { argv: ['uname', '-s'], timeoutMs: OPEN_TIMEOUT_MS },
    { argv: ['open', 'https://b.example'], timeoutMs: OPEN_TIMEOUT_MS },
  ])

  // Known for sure now: not asked a third time.
  await select(s, clock, 'https://c.example')
  await runCommand($, 'open-urls')
  expect(s.processRuns.filter(r => r.argv[0] === 'uname')).toHaveLength(2)
  expect(s.processRuns.at(-1)).toEqual({ argv: ['open', 'https://c.example'], timeoutMs: OPEN_TIMEOUT_MS })
})

test('open-urls: a uname ending with another exit code is not kept either', { options: { language: 'en', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  let unameExit = 1
  s.processAnswer = argv => (argv[0] === 'uname' ? { exitCode: unameExit, stdout: unameExit === 0 ? 'Darwin\n' : '' } : { exitCode: 0 })
  await start($)
  await select(s, clock, 'https://a.example')
  await runCommand($, 'open-urls')
  unameExit = 0
  await select(s, clock, 'https://b.example')
  await runCommand($, 'open-urls')
  expect(s.processRuns.filter(r => r.argv[0] === 'uname')).toHaveLength(2)
  expect(s.processRuns.at(-1)?.argv).toEqual(['open', 'https://b.example'])
})

test('copy-urls: every URL is copied, but the result shown is cut at the result limit; a password is hidden in it, not in the copy', { options: { language: 'en', pinActions: 'copy-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  const urls = ['https://me:hunter2@example.com/x', ...Array.from({ length: 2_000 }, (_, i) => `https://host${i}.example/path`)]
  await select(s, clock, urls.join(' '))
  await runCommand($, 'copy-urls')
  expect(s.copies).toEqual([{ text: urls.join('\n') }])
  const r = await entry($, 'Copied 2001 URLs')
  expect(r?.failed).toBe(false)
  expect(r?.text.startsWith('Copied 2001 URLs to the clipboard, one per line:\n- https://me:***@example.com/x\n')).toBe(true)
  expect(r?.text).not.toContain('hunter2')
  expect(r?.text.endsWith(`\n${MESSAGES.en.truncated}`)).toBe(true)
  expect(Array.from(r?.text ?? '').length).toBeLessThanOrEqual(LOCAL_TEXT_LIMIT + 1 + MESSAGES.en.truncated.length)

  // Failed too: the URLs listed to copy by hand are cut the same way.
  s.copyAnswer = { isCopied: false, reason: 'refused' }
  await select(s, clock, urls.join(' '))
  await runCommand($, 'copy-urls')
  const f = await entry($, 'Could not copy')
  expect(f?.failed).toBe(true)
  expect(f?.text.endsWith(`\n${MESSAGES.en.truncated}`)).toBe(true)
})

test('open-urls: asked, failed, not started and timed out told apart in one run; done while any was not a failure', { options: { language: 'en', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  s.processAnswer = argv => {
    if (argv[0] === 'uname') return { exitCode: 0, stdout: 'Darwin\n' }
    const url = argv[1]
    if (url === 'https://fail.example') return { exitCode: 1 }
    if (url === 'https://nostart.example') return { deny: 'spawn ENOENT' }
    if (url === 'https://slow.example') return { deny: 'the command timed out' }
    return { exitCode: 0 }
  }
  await start($)
  await select(s, clock, 'https://ok.example https://fail.example https://nostart.example https://slow.example')
  await runCommand($, 'open-urls')
  const r = await entry($, 'Asked the system')
  expect(r?.failed).toBe(false)
  expect(r?.text).toContain('Asked the system to open in the browser (1):\n- https://ok.example')
  expect(r?.text).toContain('Could not open (2):\n- https://fail.example — exit code 1\n- https://nostart.example — could not start (')
  expect(r?.text).toContain('spawn ENOENT')
  expect(r?.text).toContain('Started, but could not confirm it finished (1; the browser may have opened it):\n- https://slow.example')
})

test('open-urls: every URL timing out is done (never left running), said as unconfirmed', { options: { language: 'en', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  s.processAnswer = argv => (argv[0] === 'uname' ? { exitCode: 0, stdout: 'Darwin\n' } : { deny: 'timed out' })
  await start($)
  await select(s, clock, 'https://a.example https://b.example')
  await runCommand($, 'open-urls')
  expect(await entry($, 'Started, but')).toEqual({
    text: 'Started, but could not confirm it finished (2; the browser may have opened it):\n- https://a.example\n- https://b.example',
    failed: false,
  })
})

test('open-urls: every URL failing to start is failed, each with why', { options: { language: 'ja', pinActions: 'open-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  s.processAnswer = argv => (argv[0] === 'uname' ? { exitCode: 0, stdout: 'Darwin\n' } : { deny: 'spawn ENOENT' })
  await start($)
  await select(s, clock, 'https://a.example')
  await runCommand($, 'open-urls')
  const r = await entry($, '開けませんでした')
  expect(r?.failed).toBe(true)
  expect(r?.text).toContain('- https://a.example — 起動できませんでした（')
})

test('no URL in the selection: neither $.process.run nor $.ui.copy is called, and the guidance is shown failed', { options: { language: 'ja', pinActions: 'open-urls,copy-urls' } }, async ($, on) => {
  const clock = mock.clock(on)
  const s = stage(on)
  await start($)
  for (const id of ['open-urls', 'copy-urls']) {
    await select(s, clock, 'リンクはありません: www.example.com / ftp://x.example')
    await runCommand($, id)
    expect(await entry($, '選択範囲に URL が見つかりません')).toEqual({ text: NO_URL.ja, failed: true })
  }
  expect(s.processRuns).toEqual([])
  expect(s.copies).toEqual([])
})
