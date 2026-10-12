import { test as kitTest } from 'claude-code/testing'
import type { TestRest } from 'claude-code/testing'

// The kit every test file takes its test, expect and mock from: the testing
// kit's own, except that a test given no timeoutMs gets DEFAULT_TIMEOUT_MS
// rather than the kit's 5 seconds (SELM-00087).
//
// Each test loads the plugin and starts a session before its body runs; on a
// machine running several `claude plugin test .` at once that fixed cost and
// the renders after it grow several times over, and tests that pass in a
// tenth of a second alone ran past 5 seconds and failed on time alone, with
// nothing they check wrong. The longer default only changes how long a test
// may run before it counts as failed: a passing run takes as long as before,
// and every check is the same. A test that names its own timeoutMs keeps it.
//
// Named *.ts, not *.test.ts, so that the runner does not take it for a test file.
//
// A test file takes test from here, never straight from 'claude-code/testing'
// (that one keeps the 5 seconds): `node scripts/check-test-imports.mjs` checks
// every tests/*.test.ts[x] for it (SELM-00099).

export { expect, mock } from 'claude-code/testing'

/** How long a test may run when it names no timeoutMs of its own. */
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * The kit's test, with DEFAULT_TIMEOUT_MS for a test given no timeoutMs:
 * `test(name, body)` runs as `test(name, { timeoutMs: DEFAULT_TIMEOUT_MS }, body)`,
 * and `test(name, options, body)` gets it only when options has no timeoutMs,
 * its other keys passed on as they are.
 */
export const test = (name: string, ...rest: TestRest): void => {
  if (rest.length === 1) {
    kitTest(name, { timeoutMs: DEFAULT_TIMEOUT_MS }, rest[0])
    return
  }
  const [options, body] = rest
  kitTest(name, { ...options, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }, body)
}
