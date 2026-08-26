// The CLI's reading of `foundry.base` must match the Foundry module's.
//
// build.ts derives the document type to validate a priority list (every entry
// must name one type), and links.mjs derives it to decide where a wikilink
// points. If those two disagree, the CLI ships a manifest the module reads
// differently — which is exactly how `base: actor:npc` ended up creating an
// Actor while every inbound link addressed a nonexistent "actor".
//
// foundry/scripts/foundry-base.mjs is canonical and owns the case table. This
// asserts cli/src/foundry-meta.ts against the same one. The two implementations stay separate
// only because the CLI is a TypeScript package with rootDir: ./src.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CASES } from "../../foundry/test/foundry-base.test.mjs";
import { foundryBaseDocName } from "../src/foundry-meta.js";

describe("foundry.base doc-type conformance", () => {
  it("matches the Foundry module on every case", () => {
    const mismatches: string[] = [];
    for (const [input, expected] of CASES) {
      // The CLI's helper takes a single spec; a list is answered by the first
      // entry that names a type, which is the rule build.ts applies when
      // validating one. Not simply the first entry: a Moulinette rung names
      // none, and a list led by one still has a type further down.
      const specs = Array.isArray(input) ? input : [input];
      let actual: string | null = null;
      for (const spec of specs) {
        if (typeof spec !== "string" || spec.length === 0) continue;
        const docName = foundryBaseDocName(spec);
        if (docName) { actual = docName; break; }
      }
      if (actual !== expected) {
        mismatches.push(`${JSON.stringify(input)}: cli=${JSON.stringify(actual)} module=${JSON.stringify(expected)}`);
      }
    }
    assert.deepEqual(mismatches, [], "CLI and Foundry module disagree on foundry.base");
  });
});
