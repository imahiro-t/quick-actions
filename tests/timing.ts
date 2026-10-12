// Checking that a piece of code runs in linear time, by a ratio rather than a
// clock limit (SELM-00093).
//
// The performance tests used to fail when one call took more than 200ms (or
// 2s, or 5s). On a loaded machine (several `claude plugin test .` at once, a
// load average over 140) a call that takes a millisecond alone can take far
// longer, and those tests failed with nothing they check wrong. What they are
// there to catch is a change in how the time grows: an algorithm that turned
// quadratic (SELM-00069's backtracking regular expression), not a slow machine.
//
// So expectLinear runs the code on an input of size n / factor and on one of
// size n, and passes when one call on the large one takes at most
// factor * SLACK times as long as one on the small one: about factor when
// linear, factor squared when quadratic (8 against 64 with the default
// factor, the limit 32 in between). Load slows both sides alike, so the ratio
// holds where a clock limit fails.
//
// - Batches of equal work: one call on a small input can take less than a
//   microsecond, below what the timer tells apart, so each side is timed over
//   a batch of calls: r on the small input, r / factor on the large one. When
//   the code is linear the two batches do the same work and take about as
//   long, so a busy machine, which takes the processor away now and then,
//   interrupts both alike. (With the same r on both sides the large batch took
//   factor times as long, met that many more interruptions, and its ratio grew
//   with the load: up to 30 on a loaded run where it was 8 alone.)
// - Calibration: r doubles from factor until the small batch takes TARGET_MS,
//   and doubles again whenever a measured small batch comes in under half of
//   it (the first calls were slower, before the code was compiled). TARGET_MS
//   only picks r: whether the test passes depends on the ratio alone, never on
//   a time in milliseconds. r stops at MAX_REPS, for code that returns at once
//   on any input (a length limit); 2^20 calls still take a few milliseconds,
//   well above the timer's step.
// - Warm-up: both inputs run once before the calibration, so a memo filled on
//   the first call (tagChar's) or the first compilation is not timed on one
//   side only.
// - Measurement: pairs of batches, small then large, keeping the fastest of
//   each side, until the two pass after at least MIN_ROUNDS pairs, or
//   MAX_ROUNDS pairs have run. MIN_ROUNDS keeps a small batch that happened
//   to be held up from passing a large one on its own. On an idle machine
//   the first MIN_ROUNDS pairs pass. On a loaded one a batch is now and then
//   held up far longer than it runs (a load average of 100 on 10 cores held
//   10ms batches up past 40ms), and taking the fastest leaves those out: a
//   pair that runs clear on both sides comes along within a few rounds.
// - Cut-off: a large batch stops once it has run past the time the ratio
//   allows (SLACK times the fastest small batch so far), and counts for
//   nothing, so code that turned quadratic does not run its whole batch. One
//   call cannot be stopped partway, so it may still take one call's time:
//   such code fails after MAX_ROUNDS * TRIES of those calls.
// - Retries: a failing check is tried again, from the calibration, up to
//   TRIES times in all and passes if any try does. Load comes and goes; a
//   quadratic algorithm fails every try, so a regression is still caught.
//
// Named *.ts, not *.test.ts, so that the runner does not take it for a test file.

/** How long a small batch should take, at least (picks r only). */
export const TARGET_MS = 10
/** The most calls in a small batch. */
export const MAX_REPS = 2 ** 20
/** The fewest pairs of batches measured per try. */
export const MIN_ROUNDS = 3
/** The most pairs of batches measured per try. */
export const MAX_ROUNDS = 15
/** Tries before a check fails. */
export const TRIES = 2
/** How many times factor one large call may take: factor * SLACK is the limit on the ratio. */
export const SLACK = 4

/** The timeout a test that calls expectLinear names for itself (a loaded machine runs each case many times slower). */
export const LINEAR_TIMEOUT_MS = 120_000

/** What one check measured: the calls in a small batch, the fastest batch of each side, and the ratio of one call to one call. */
export type Linearity = { label: string; reps: number; small: number; large: number; ratio: number; rounds: number; tries: number }

/** The time `r` calls of run(input) take, or Infinity once past `budget` (checked about 64 times along the way). */
const timeCalls = <T>(run: (input: T) => unknown, input: T, r: number, budget = Infinity): number => {
  const stride = Math.max(1, Math.floor(r / 64))
  const started = performance.now()
  for (let i = 0; i < r; i++) {
    run(input)
    if ((i + 1) % stride === 0 && performance.now() - started > budget) return Infinity
  }
  return performance.now() - started
}

/**
 * Fails unless run() takes about linear time in the size: one call on make(n)
 * at most factor * SLACK times one on make(n / factor), timed in batches of
 * equal work, calibrated, measured and retried as above. The inputs are made
 * before any timing. Whether run() answers correctly is for the test to
 * check, once, outside this. factor is a power of two.
 */
export function expectLinear<T>(
  label: string,
  make: (size: number) => T,
  run: (input: T) => unknown,
  { n, factor = 8 }: { n: number; factor?: number },
): Linearity {
  const small = make(Math.max(1, Math.round(n / factor)))
  const large = make(n)
  const limit = factor * SLACK
  run(small)
  run(large)
  let last: Linearity | undefined
  for (let tries = 1; tries <= TRIES; tries++) {
    let reps = factor
    while (reps < MAX_REPS && timeCalls(run, small, reps) < TARGET_MS) reps *= 2
    let tSmall = Infinity
    let tLarge = Infinity
    let rounds = 0
    while (rounds < MAX_ROUNDS) {
      const s = timeCalls(run, small, reps)
      if (s < TARGET_MS / 2 && reps < MAX_REPS) {
        // Faster than when calibrated: a larger batch, and the rounds afresh.
        reps *= 2
        tSmall = tLarge = Infinity
        rounds = 0
        continue
      }
      rounds++
      tSmall = Math.min(tSmall, s)
      tLarge = Math.min(tLarge, timeCalls(run, large, reps / factor, SLACK * tSmall))
      if (rounds >= MIN_ROUNDS && tLarge <= SLACK * tSmall) break
    }
    // One call to one call: the large batch made factor times fewer calls.
    last = { label, reps, small: tSmall, large: tLarge, ratio: (tLarge * factor) / tSmall, rounds, tries }
    if (last.ratio <= limit) return last
  }
  const { reps, small: s, large: l, ratio, rounds, tries } = last!
  throw new Error(
    `${label}: not linear: ${reps} calls took ${s.toFixed(2)}ms at size ${Math.round(n / factor)} and ` +
      `${reps / factor} calls ${Number.isFinite(l) ? `${l.toFixed(2)}ms` : `over ${(SLACK * s).toFixed(2)}ms (cut off)`} at size ${n}, ` +
      `a ratio of ${Number.isFinite(ratio) ? ratio.toFixed(1) : `more than ${limit}`} per call against at most ${limit} (${tries} tries, ${rounds} rounds in the last)`,
  )
}
