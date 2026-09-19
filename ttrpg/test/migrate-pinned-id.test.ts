// Moving a pinned document id inside the patch.
//
// The risk is the same as any structural edit of hand-written YAML: land the
// key at the wrong indent and the whole `foundry:` block reads as something
// else, silently, on a page nobody opens again for a month.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { movePinnedId } from "../src/migrate/0.15-foundry-pinned-id.js";

const fm = (body: string) => `---\n${body}\n---\n\n# Page\n`;

describe("movePinnedId", () => {
  it("creates the patch when there isn't one", () => {
    assert.equal(movePinnedId(fm(`foundry:
  source: Scene
  id: marloHomeScene00`)), fm(`foundry:
  source: Scene
  patch:
    _id: marloHomeScene00`));
  });

  it("adds to a patch that already exists", () => {
    assert.equal(movePinnedId(fm(`foundry:
  source: Scene
  id: marloHomeScene00
  patch:
    name: Home`)), fm(`foundry:
  source: Scene
  patch:
    _id: marloHomeScene00
    name: Home`));
  });

  it("matches the indent the patch already uses", () => {
    const out = movePinnedId(fm(`foundry:
  source: Scene
  id: marloHomeScene00
  patch:
      name: Home`))!;
    assert.match(out, /\n      _id: marloHomeScene00\n      name: Home/);
  });

  it("handles the patch coming before the id", () => {
    assert.equal(movePinnedId(fm(`foundry:
  source: Scene
  patch:
    name: Home
  id: marloHomeScene00`)), fm(`foundry:
  source: Scene
  patch:
    _id: marloHomeScene00
    name: Home`));
  });

  it("keeps comments in the block", () => {
    const out = movePinnedId(fm(`foundry:
  # pinned so a rename does not orphan the scene
  id: marloHomeScene00
  source: Scene`))!;
    assert.match(out, /# pinned so a rename does not orphan the scene/);
  });

  it("keeps the value exactly, quotes and all", () => {
    assert.match(movePinnedId(fm(`foundry:
  id: "marloHomeScene00"`))!, /_id: "marloHomeScene00"/);
  });

  it("leaves an id under a different key alone", () => {
    assert.equal(movePinnedId(fm(`author:
  id: not-a-foundry-id
foundry:
  source: Scene`)), null);
  });

  it("leaves a deeper id alone, which is somebody's document field", () => {
    assert.equal(movePinnedId(fm(`foundry:
  source: Scene
  patch:
    tokens:
      id: keep-me`)), null);
  });

  it("does not touch an inline patch it cannot edit safely", () => {
    assert.equal(movePinnedId(fm(`foundry:
  id: marloHomeScene00
  patch: { name: Home }`)), null);
  });

  it("is idempotent", () => {
    const once = movePinnedId(fm(`foundry:
  source: Scene
  id: marloHomeScene00`))!;
    assert.equal(movePinnedId(once), null);
  });

  it("does nothing to a page with no foundry block, or no frontmatter", () => {
    assert.equal(movePinnedId(fm("role: public\nid: x")), null);
    assert.equal(movePinnedId("# Just a page\n"), null);
  });

  it("survives unterminated frontmatter rather than corrupting the file", () => {
    assert.equal(movePinnedId("---\nfoundry:\n  id: x\n"), null);
  });
});
