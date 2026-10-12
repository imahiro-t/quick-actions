// Checks that every test file in tests/ (tests/*.test.ts and *.test.tsx, not
// its subdirectories) takes test from './kit' and not straight from
// 'claude-code/testing' (SELM-00099). Run it after adding a test file:
//
//   node scripts/check-test-imports.mjs
//
// tests/kit.ts gives a test with no timeoutMs 30 seconds instead of the
// testing kit's 5 (SELM-00087); a file that imports the kit's own test falls
// back to 5 and fails on time alone on a busy machine. What counts as taking
// test straight from the kit is decided by directTestImports in
// scripts/test-imports.mjs, which tests/test-imports.test.ts checks.
//
// A script rather than a test because `claude plugin test` gives a test no
// file system to list and read tests/ with. Exits with 1, naming each file and
// statement, when a file takes test straight from the kit or when there is no
// test file to check. Plain JavaScript: any Node 20 or later runs it.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { directTestImports } from './test-imports.mjs'

const testsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests')

let files
try {
  files = readdirSync(testsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
} catch (error) {
  console.error(`check-test-imports: cannot read ${testsDir}: ${error.message}`)
  process.exit(1)
}
if (files.length === 0) {
  console.error(`check-test-imports: no *.test.ts or *.test.tsx in ${testsDir}`)
  process.exit(1)
}

const problems = files.flatMap(name =>
  directTestImports(readFileSync(join(testsDir, name), 'utf8')).map(found => `tests/${name}: ${found}`),
)
if (problems.length > 0) {
  console.error(`check-test-imports: take test from './kit', not from 'claude-code/testing' (SELM-00087):`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`check-test-imports: ${files.length} files, all take test from ./kit`)
