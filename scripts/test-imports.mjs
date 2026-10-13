// Finds where a test file takes the testing kit's own test from
// 'claude-code/testing' instead of from tests/kit.ts (SELM-00099).
//
// tests/kit.ts wraps that test so that a test given no timeoutMs gets 30
// seconds rather than the kit's 5 (SELM-00087). A test file that imports test
// straight from 'claude-code/testing' falls back to 5 seconds and fails on time
// alone on a busy machine, so every test file takes it from './kit'.
//
// Plain JavaScript with no dependencies, so that both a plugin test
// (tests/test-imports.test.ts, which checks this logic) and a Node script
// (scripts/check-test-imports.mjs, which runs it over tests/*.test.ts[x]) can
// import it. It reads the source text, not a syntax tree:
//
// - Counted: a value import or re-export of test (`import { test }`,
//   `import { expect, test as t }`, `export { test } from`), a namespace
//   import or star export (`import * as t`, `export * from`, either of which
//   reaches test), a default import (including one named `type`:
//   `import type from`, `import type, { test } from`), and a dynamic
//   `import(...)` or `require(...)` of the module.
// - Not counted: `import type` / `export type` (`type` followed by a clause,
//   not by `,` or `from`), a `type` specifier (`import { type test }`), any
//   other name (`import { expect }`), a side-effect-only
//   `import 'claude-code/testing'`, an `import(...)` right after `typeof`
//   (`typeof import('claude-code/testing')`, a type, even across a line
//   break), other modules, and anything inside a comment or a string.
// - Not handled: a regular expression literal holding a quote can throw the
//   string scanning off for the rest of the file; a string-named specifier
//   (`import { "test" as t }`) is not recognized; an `import(...)` in a type
//   position without `typeof` (`let e: import('claude-code/testing').Engine`)
//   is counted, as the text alone does not tell it from a value import; JSX
//   text is read as code, so a backtick in it opens a template: a pair of them
//   (`<p>use `x` here</p>`) only blanks what lies between, and an odd one that
//   never closes is skipped, but an odd one followed by a real template pairs
//   with that template's backtick, so the code between them is read as a
//   string and what it takes is missed (as is code after a `${` in JSX text).

const MODULE = 'claude-code/testing'

/**
 * The source with every comment and the contents of every string replaced by
 * spaces (line breaks kept, so offsets and line numbers stay those of the
 * source), and the raw contents of each string keyed by the offset of its
 * opening quote.
 */
const blankCommentsAndStrings = source => {
  const out = source.split('')
  const strings = new Map()
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  // Each entry is the brace depth of code inside a template's `${`; the
  // template resumes at the `}` that closes it.
  const templates = []
  let i = 0
  // Scans a string's contents from i (just past its opening quote, or past the
  // `}` that ends a template's `${`) to its closing quote, which i ends past;
  // a template stops instead at `${`, its code scanned as code until the
  // matching `}`. The contents are keyed at `opening` (the opening quote), or
  // not at all for the rest of a template.
  const scanContents = (quote, opening) => {
    const from = i
    let stop = source.length
    let closed = false
    let resumeCode = false
    while (i < source.length) {
      const c = source[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === quote || (quote !== '`' && c === '\n')) {
        // (an unterminated quote ends at the line)
        stop = i
        closed = true
        break
      }
      if (quote === '`' && c === '$' && source[i + 1] === '{') {
        stop = i
        resumeCode = true
        break
      }
      i++
    }
    if (quote === '`' && opening !== undefined && !closed && !resumeCode) {
      // A backtick that never closes is no template in a valid file (it is,
      // say, in JSX text): read on from just past it as code.
      i = opening + 1
      return
    }
    stop = Math.min(stop, source.length)
    if (opening !== undefined) strings.set(opening, source.slice(from, stop))
    blank(from, stop)
    if (resumeCode) {
      i = stop + 2
      templates.push(0)
    } else {
      i = stop + 1
    }
  }
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      blank(i, stop)
      i = stop
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(i, stop)
      i = stop
    } else if (c === "'" || c === '"' || c === '`') {
      i++
      scanContents(c, i - 1)
    } else if (templates.length > 0 && c === '{') {
      templates[templates.length - 1]++
      i++
    } else if (templates.length > 0 && c === '}') {
      if (templates[templates.length - 1] === 0) {
        templates.pop()
        i++
        scanContents('`', undefined)
      } else {
        templates[templates.length - 1]--
        i++
      }
    } else {
      i++
    }
  }
  return { code: out.join(''), strings }
}

// `import` / `export`, its clause (identifiers, braces, commas, `*` and
// whitespace only, never running into a later statement), `from` and the
// opening quote of the module name.
const STATIC = /(?<![\w$.])(import|export)(?![\w$])((?:(?!(?<![\w$])(?:import|export)(?![\w$]))[\w$\s{},*])*?)(?<![\w$])from\s*(['"])/g
// `import(` (not right after `typeof`, which makes it a type) or `require(`
// and the opening quote of the module name.
const DYNAMIC = /(?<![\w$.])((?<!(?<![\w$.])typeof\s*)import|require)\s*\(\s*(['"`])/g

/** Whether an import / export clause brings in the value test (or what reaches it). */
const clauseTakesTest = (keyword, clause) => {
  const text = clause.trim()
  // import type / export type; `type` alone or before `,` is a default import named type
  if (/^type(?![\w$])\s*[^\s,]/.test(text)) return false
  if (text.includes('*')) return true // import * as t / export * (as t)
  const brace = text.indexOf('{')
  const head = (brace === -1 ? text : text.slice(0, brace)).replace(/,\s*$/, '').trim()
  if (keyword === 'import' && head !== '') return true // a default import
  if (brace === -1) return false
  const inner = text.slice(brace + 1, text.lastIndexOf('}') === -1 ? undefined : text.lastIndexOf('}'))
  return inner
    .split(',')
    .map(spec => spec.trim())
    .filter(spec => spec !== '' && !/^type\s/.test(spec))
    .some(spec => spec.split(/\s+/)[0] === 'test')
}

/**
 * The statements of a test file's source that take test from
 * 'claude-code/testing' other than through tests/kit.ts, each as
 * `line N: <statement>`, in source order; empty when there are none.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function directTestImports(source) {
  const { code, strings } = blankCommentsAndStrings(source)
  const found = []
  const report = (start, quoteAt) => {
    const close = source.indexOf(source[quoteAt], quoteAt + 1)
    const end = close === -1 ? quoteAt + 1 : close + 1
    const line = source.slice(0, start).split('\n').length
    found.push({ start, text: `line ${line}: ${source.slice(start, end).replace(/\s+/g, ' ')}` })
  }
  for (const m of code.matchAll(STATIC)) {
    const quoteAt = m.index + m[0].length - 1
    if (strings.get(quoteAt) === MODULE && clauseTakesTest(m[1], m[2])) report(m.index, quoteAt)
  }
  for (const m of code.matchAll(DYNAMIC)) {
    const quoteAt = m.index + m[0].length - 1
    if (strings.get(quoteAt) === MODULE) report(m.index, quoteAt)
  }
  return found.sort((a, b) => a.start - b.start).map(f => f.text)
}
