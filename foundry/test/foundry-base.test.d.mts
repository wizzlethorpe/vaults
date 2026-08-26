// Type surface for the shared `foundry.base` case table.
//
// foundry/test runs under plain `node --test`, so the table lives in a .mjs
// file; cli/test runs under tsx and imports it for the conformance check.
// This declaration is what lets the CLI's typecheck see it.

/** [input, expected document type] pairs. */
export declare const CASES: ReadonlyArray<readonly [unknown, string | null]>;
