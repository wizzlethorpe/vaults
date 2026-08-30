// Renaming the foundry block's keys in place.
//
// The risk here is not the rename. It is `data`, an ordinary word that means
// something else nearly everywhere it appears: a document field called `data`,
// a `data:` under some other top-level key, a URI in a body. Each one this
// touches is silent corruption of somebody's campaign, so most of these tests
// are about what it must leave alone.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { rewriteFoundryKeys } from "../src/migrate/0.15-foundry-patch-keys.js";

const fm = (body: string, after = "\n# Page\n") => `---\n${body}\n---\n${after}`;

describe("rewriteFoundryKeys", () => {
  it("renames all three keys", () => {
    const out = rewriteFoundryKeys(fm(`foundry:
  base: Compendium.dnd5e.actors24.Actor.mmGuardCaptain00
  data:
    name: Theodric
  data_json: sheets/theodric.json`));
    assert.match(out!, /\n  source: Compendium\./);
    assert.match(out!, /\n  patch:\n/);
    assert.match(out!, /\n  patch_json: sheets/);
    assert.doesNotMatch(out!, /\n  (base|data|data_json):/);
  });

  it("keeps comments inside the block, which is why this is not a YAML round trip", () => {
    const out = rewriteFoundryKeys(fm(`foundry:
  base: Compendium.dnd5e.actors24.Actor.x
  data:
    prototypeToken:
      # 30 = HOVER: everyone sees the name on hover, nothing painted on
      # the map. 20 owner-only, 40 always-for-owner, 50 always-for-all.
      displayName: 30`));
    assert.match(out!, /# 30 = HOVER: everyone sees the name on hover/);
    assert.match(out!, /# the map\. 20 owner-only/);
  });

  it("leaves a nested 'data' alone, because that one is a document field", () => {
    const out = rewriteFoundryKeys(fm(`foundry:
  base: Compendium.x.y.Actor.z
  data:
    system:
      data: keep me`));
    assert.match(out!, /\n      data: keep me/);
    assert.equal((out!.match(/patch:/g) ?? []).length, 1);
  });

  it("leaves 'data' under a different top-level key alone", () => {
    assert.equal(rewriteFoundryKeys(fm(`default_frontmatter:
  - match: '**'
    data:
      role: DM`)), null);
  });

  it("stops at the next top-level key", () => {
    const out = rewriteFoundryKeys(fm(`foundry:
  base: Compendium.x.y.Actor.z
role: public
data: not the foundry one`));
    assert.match(out!, /\n  source: Compendium/);
    assert.match(out!, /\ndata: not the foundry one/);
  });

  it("ignores 'data:' in the body, which is prose or a code sample", () => {
    assert.equal(rewriteFoundryKeys(fm("role: public", "\nSet `data:` in your frontmatter.\n")), null);
  });

  it("preserves the rest of the frontmatter byte for byte", () => {
    const before = fm(`role: public
species: human
born: "1474-06-21"
foundry:
  base: Compendium.x.y.Actor.z
  embed: true`);
    const out = rewriteFoundryKeys(before)!;
    assert.equal(out, before.replace("  base:", "  source:"));
  });

  it("is idempotent, so a second build changes nothing", () => {
    const once = rewriteFoundryKeys(fm(`foundry:
  base: Compendium.x.y.Actor.z`))!;
    assert.equal(rewriteFoundryKeys(once), null);
  });

  it("does nothing to a page with no foundry block", () => {
    assert.equal(rewriteFoundryKeys(fm("role: public\ntitle: Hello")), null);
  });

  it("does nothing to a page with no frontmatter at all", () => {
    assert.equal(rewriteFoundryKeys("# Just a page\n\nWith text.\n"), null);
  });

  it("leaves an inline empty block alone, which opens nothing", () => {
    assert.equal(rewriteFoundryKeys(fm("foundry: {}\nrole: public")), null);
  });

  it("handles a block indented with four spaces", () => {
    const out = rewriteFoundryKeys(fm(`foundry:
    base: Compendium.x.y.Actor.z
    data:
        name: X`));
    assert.match(out!, /\n    source: Compendium/);
    assert.match(out!, /\n    patch:/);
    assert.match(out!, /\n        name: X/);
  });

  it("survives unterminated frontmatter rather than corrupting the file", () => {
    assert.equal(rewriteFoundryKeys("---\nfoundry:\n  base: X\n"), null);
  });
});
