// Types of scripts/test-imports.mjs, for the TypeScript that imports it
// (tests/test-imports.test.ts).

/**
 * The statements of a test file's source that take test from
 * 'claude-code/testing' other than through tests/kit.ts, each as
 * `line N: <statement>`, in source order; empty when there are none.
 */
export declare function directTestImports(source: string): string[]
