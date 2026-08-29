// The CLI's reading of `foundry.source` must match the Foundry module's.
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
import { resolveSelfContainedBase, PACK_KEY } from "../src/foundry-module.js";
import { CORE_PAGE_TYPES, journalPageSpec } from "../src/foundry-meta.js";
import {
  PACK_KEY as MODULE_PACK_KEY, CORE_PAGE_TYPES as MODULE_CORE_PAGE_TYPES,
  journalPageSpec as moduleJournalPageSpec,
} from "../../foundry/scripts/foundry-base.mjs";

describe("foundry.source doc-type conformance", () => {
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
    assert.deepEqual(mismatches, [], "CLI and Foundry module disagree on foundry.source");
  });

  // The module compiler reads `foundry.source` a third time. It answers a
  // narrower question — what can be built with no reader and no world — so it
  // cannot share `foundryBaseDocName` outright. But where a spec names a blank
  // document, all three implementations must agree on which type that is, or a
  // page compiles into one kind of document and links as another.
  it("the module compiler agrees on every blank-document case", () => {
    const mismatches: string[] = [];
    for (const [input, expected] of CASES) {
      const specs = (Array.isArray(input) ? input : [input])
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      // Only the self-contained forms: a UUID or a Moulinette reference is
      // deliberately unbuildable by the module, and that is tested elsewhere.
      const buildable = specs.filter((s) => !s.includes(".") && !s.startsWith("@moulinette/"));
      if (buildable.length === 0) continue;
      const actual = resolveSelfContainedBase(specs)?.blank ?? null;
      if (actual !== expected) {
        mismatches.push(`${JSON.stringify(input)}: module=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
      }
    }
    assert.deepEqual(mismatches, [], "module compiler disagrees on foundry.source");
  });

  // Sync and the module compiler both name packs "<namespace>-<key>", differing
  // only in the namespace (a vault id vs a module id). If the two key tables
  // drift, the same vault produces "…-tables" one way and "…-rolltables" the
  // other, and the equivalence between a synced vault and a downloaded module
  // quietly stops holding for that document type.
  it("agrees with the module on every compendium pack key", () => {
    assert.deepEqual(PACK_KEY, MODULE_PACK_KEY);
  });

  // `foundry.journal` is read twice, once by the sync client and once by the
  // compiler, and they must agree on the page each produces. A disagreement
  // here is a page that is one type when synced and another when installed.
  it("agrees with the module on every foundry.journal shape", () => {
    assert.deepEqual(CORE_PAGE_TYPES, MODULE_CORE_PAGE_TYPES);
    const cases: Array<Record<string, unknown> | undefined> = [
      undefined,
      {},
      { journal: false },
      { journal: true },
      { journal: {} },
      { journal: { type: "spells" } },
      { journal: { type: "map", system: { grouping: "level" } } },
      { journal: { title: { show: false, level: 2 } } },
      { journal: { type: "", title: {} } },
      { journal: ["not", "an", "object"] },
      { journal: "text" },
    ];
    for (const fm of cases) {
      assert.deepEqual(
        journalPageSpec(fm), moduleJournalPageSpec(fm),
        `disagreed on ${JSON.stringify(fm)}`,
      );
    }
  });
});
