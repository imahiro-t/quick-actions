import { expect, test } from './kit'

import { directTestImports } from '../scripts/test-imports.mjs'

// directTestImports decides what scripts/check-test-imports.mjs reports: a
// test file that takes test straight from 'claude-code/testing' instead of
// from ./kit, and so loses kit's 30-second default timeout (SELM-00087,
// SELM-00099). The sources below are strings, so that this file itself takes
// test from ./kit only.

const TAKES_TEST: Array<[string, string]> = [
  ['a named import', "import { test } from 'claude-code/testing'"],
  ['test after expect', "import { expect, test } from 'claude-code/testing'"],
  ['test under another name', "import { test as kitTest } from 'claude-code/testing'"],
  ['double quotes', 'import { test } from "claude-code/testing"'],
  ['a clause over several lines', "import {\n  expect,\n  test,\n} from 'claude-code/testing'"],
  ['a type specifier beside the value test', "import { type Engine, test } from 'claude-code/testing'"],
  ['a re-export', "export { test } from 'claude-code/testing'"],
  ['a re-export under another name', "export { test as kitTest } from 'claude-code/testing'"],
  ['a namespace import', "import * as kit from 'claude-code/testing'"],
  ['a star export', "export * from 'claude-code/testing'"],
  ['a namespace export', "export * as kit from 'claude-code/testing'"],
  ['a default import', "import kit from 'claude-code/testing'"],
  ['a dynamic import', "const { test } = await import('claude-code/testing')"],
  ['a require', "const { test } = require('claude-code/testing')"],
  ['a second statement on a line', "import { expect } from './kit'; import { test } from 'claude-code/testing'"],
]

const LEAVES_TEST: Array<[string, string]> = [
  ['test from ./kit', "import { expect, test } from './kit'"],
  ['a type import', "import type { Engine } from 'claude-code/testing'"],
  ['a type import of test', "import type { test } from 'claude-code/testing'"],
  ['a type re-export', "export type { TestRest } from 'claude-code/testing'"],
  ['a type namespace import', "import type * as kit from 'claude-code/testing'"],
  ['a type specifier of test', "import { type test } from 'claude-code/testing'"],
  ['another name', "import { expect, mock } from 'claude-code/testing'"],
  ['a name that only starts with test', "import { testing } from 'claude-code/testing'"],
  ['test from another module', "import { test } from 'claude-code/testing-extra'"],
  ['a side-effect import', "import 'claude-code/testing'"],
  ['a line comment', "// import { test } from 'claude-code/testing'"],
  ['a block comment', "/*\nimport { test } from 'claude-code/testing'\n*/"],
  ['a string', "const text = \"import { test } from 'claude-code/testing'\""],
  ['a template', "const text = `import { test } from 'claude-code/testing'`"],
  ['a URL in a string before the import', "const url = 'https://example.com'\nimport { test } from './kit'"],
]

for (const [what, source] of TAKES_TEST) {
  test(`takes test straight from the kit: ${what}`, () => {
    expect(directTestImports(source)).toHaveLength(1)
  })
}

for (const [what, source] of LEAVES_TEST) {
  test(`does not take test straight from the kit: ${what}`, () => {
    expect(directTestImports(source)).toEqual([])
  })
}

test('the head of a test file as they are written passes', () => {
  const source = [
    "import { expect, test } from './kit'",
    '',
    "import type { Engine } from 'claude-code/testing'",
    "import { ACTIONS } from '../hooks/actions'",
    '',
    "test('something', () => {",
    "  expect(1).toBe(1)",
    '})',
  ].join('\n')
  expect(directTestImports(source)).toEqual([])
})

test('names the line and the statement of each, in order', () => {
  const source = [
    "import type { Engine } from 'claude-code/testing'",
    'import {',
    '  expect,',
    '  test,',
    "} from 'claude-code/testing'",
    "export * from 'claude-code/testing'",
  ].join('\n')
  expect(directTestImports(source)).toEqual([
    "line 2: import { expect, test, } from 'claude-code/testing'",
    "line 6: export * from 'claude-code/testing'",
  ])
})

test('a statement after a template with code in it is still found', () => {
  const source = "const label = `${{ a: 1 }.a} item`\nimport { test } from 'claude-code/testing'"
  expect(directTestImports(source)).toEqual(["line 2: import { test } from 'claude-code/testing'"])
})
