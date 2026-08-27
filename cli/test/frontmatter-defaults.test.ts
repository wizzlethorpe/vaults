// `default_frontmatter`: frontmatter supplied by glob, before anything reads it.
//
// The reason it exists is that a vault has one answer to "what does this page
// say", and the wiki, the Foundry sync manifest and the module compiler all
// read it. The alternative — a module-only setting for the same idea — is a
// way for a synced world and an installed module to disagree about one page,
// which is exactly what they must not do.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyFrontmatterDefaults, compileFrontmatterRules } from "../src/frontmatter-defaults.js";

const rules = compileFrontmatterRules([
  { match: "**", data: { role: "public" } },
  { match: "Compendium/**", data: { foundry: { journal: false } } },
]);

function apply(path: string, fm: Record<string, unknown> = {}): Record<string, unknown> {
  return applyFrontmatterDefaults(path, fm, rules);
}

describe("default_frontmatter", () => {
  it("fills in what a page did not say", () => {
    assert.deepEqual(apply("Rules/Chapter 1.md"), { role: "public" });
  });

  it("never overrides what a page did say", () => {
    // Defaults, not overrides: the page is always the authority on itself.
    assert.deepEqual(apply("Rules/Secret.md", { role: "dm" }), { role: "dm" });
  });

  it("applies a narrower rule on top of a broader one", () => {
    assert.deepEqual(apply("Compendium/Spells/Accio.md"), {
      role: "public",
      foundry: { journal: false },
    });
  });

  it("matches a folder prefix without matching a similarly-named sibling", () => {
    assert.equal(apply("Compendiums/x.md")["foundry"], undefined);
  });

  it("merges into a foundry block the page already started", () => {
    // A page naming its own base must still pick up the folder's journal rule,
    // or an author would have to restate the default on every such page.
    const out = apply("Compendium/Spells/Accio.md", { foundry: { base: "Item:spell" } });
    assert.deepEqual(out["foundry"], { base: "Item:spell", journal: false });
  });

  it("does not reach past a key the page answered with a scalar", () => {
    // `foundry: false` is a page saying no. A default must not patch a
    // sub-key into it and turn that into a yes.
    assert.equal(apply("Compendium/Spells/Accio.md", { foundry: false })["foundry"], false);
  });

  it("ignores a malformed rule instead of failing the build", () => {
    const bad = compileFrontmatterRules([
      { match: "**" } as never,
      { data: { role: "x" } } as never,
      { match: "**", data: { ok: true } },
    ]);
    assert.deepEqual(applyFrontmatterDefaults("a.md", {}, bad), { ok: true });
  });
});
