// End-to-end tests for the Obsidian Bases plugin.
//
// All assertions go through the public renderBase() entry point because
// the rendered HTML is the contract: it's what ships to readers and what
// the JS in BASES_SCRIPT consumes. Internal-only helpers (parseExpr,
// applySort, etc.) are intentionally not re-exported for testing — if a
// behaviour matters, it should be observable in the HTML.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderBase } from "../src/render/bases.js";
import {
  mkContext,
  tableTitles,
  cardTitles,
  listTitles,
  countTableRows,
} from "./bases-helpers.js";

// ── Default behaviours ─────────────────────────────────────────────────────

describe("renderBase: defaults", () => {
  it("with no views, renders a single table containing every page", () => {
    const ctx = mkContext([
      { path: "A.md" },
      { path: "B.md" },
      { path: "C.md" },
    ]);
    const html = renderBase("", ctx);
    assert.equal(countTableRows(html), 3);
    assert.deepEqual(tableTitles(html), ["A", "B", "C"]);
  });

  it("default sort is alphabetical by title when no sort spec given", () => {
    const ctx = mkContext([
      { path: "Charlie.md" },
      { path: "Alpha.md" },
      { path: "Bravo.md" },
    ]);
    const html = renderBase(`views: [{ type: table }]`, ctx);
    assert.deepEqual(tableTitles(html), ["Alpha", "Bravo", "Charlie"]);
  });

  it("renders an error block when the YAML is malformed", () => {
    const ctx = mkContext([{ path: "A.md" }]);
    const html = renderBase("filters: [unbalanced", ctx);
    assert.match(html, /bases-error/);
    assert.match(html, /Failed to parse base YAML/);
  });
});

// ── Filters ────────────────────────────────────────────────────────────────

describe("renderBase: filters", () => {
  it("string expression filters by frontmatter property", () => {
    const ctx = mkContext([
      { path: "Sword.md", fm: { class: "weapon" } },
      { path: "Cloak.md", fm: { class: "armor" } },
      { path: "Bow.md", fm: { class: "weapon" } },
    ]);
    const html = renderBase(`filters: 'class == "weapon"'`, ctx);
    assert.deepEqual(tableTitles(html).sort(), ["Bow", "Sword"]);
  });

  it("file.inFolder restricts to a folder subtree", () => {
    const ctx = mkContext([
      { path: "NPCs/Alice.md" },
      { path: "NPCs/Bob.md" },
      { path: "Items/Sword.md" },
    ]);
    const html = renderBase(`filters: 'file.inFolder("NPCs")'`, ctx);
    assert.deepEqual(tableTitles(html).sort(), ["Alice", "Bob"]);
  });

  it("file.hasTag matches with or without leading #", () => {
    const ctx = mkContext([
      { path: "A.md", fm: { tags: ["villain"] } },
      { path: "B.md", fm: { tags: ["#hero"] } },
      { path: "C.md", fm: { tags: ["minor"] } },
    ]);
    const a = renderBase(`filters: 'file.hasTag("villain")'`, ctx);
    const b = renderBase(`filters: 'file.hasTag("hero")'`, ctx);
    assert.deepEqual(tableTitles(a), ["A"]);
    assert.deepEqual(tableTitles(b), ["B"]);
  });

  it("and tree requires every branch to pass", () => {
    const ctx = mkContext([
      { path: "X.md", fm: { tier: 1, kind: "boss" } },
      { path: "Y.md", fm: { tier: 1, kind: "minion" } },
      { path: "Z.md", fm: { tier: 2, kind: "boss" } },
    ]);
    const html = renderBase(
      `filters:\n  and:\n    - 'tier == 1'\n    - 'kind == "boss"'`,
      ctx,
    );
    assert.deepEqual(tableTitles(html), ["X"]);
  });

  it("or tree requires at least one branch to pass", () => {
    const ctx = mkContext([
      { path: "X.md", fm: { kind: "boss" } },
      { path: "Y.md", fm: { kind: "minion" } },
      { path: "Z.md", fm: { kind: "noble" } },
    ]);
    const html = renderBase(
      `filters:\n  or:\n    - 'kind == "boss"'\n    - 'kind == "noble"'`,
      ctx,
    );
    assert.deepEqual(tableTitles(html).sort(), ["X", "Z"]);
  });

  it("not tree inverts an inner expression", () => {
    const ctx = mkContext([
      { path: "X.md", fm: { active: true } },
      { path: "Y.md", fm: { active: false } },
    ]);
    const html = renderBase(`filters:\n  not:\n    - 'active'`, ctx);
    assert.deepEqual(tableTitles(html), ["Y"]);
  });

  it("comparison operators handle numbers and strings", () => {
    const ctx = mkContext([
      { path: "A.md", fm: { weight: 5 } },
      { path: "B.md", fm: { weight: 10 } },
      { path: "C.md", fm: { weight: 15 } },
    ]);
    const html = renderBase(`filters: 'weight >= 10'`, ctx);
    assert.deepEqual(tableTitles(html).sort(), ["B", "C"]);
  });

  it("string method .contains is case-insensitive", () => {
    const ctx = mkContext([
      { path: "A.md", fm: { name: "The Crimson Lord" } },
      { path: "B.md", fm: { name: "Blackbriar" } },
    ]);
    const html = renderBase(`filters: 'name.contains("crimson")'`, ctx);
    assert.deepEqual(tableTitles(html), ["A"]);
  });
});

// ── Sort ───────────────────────────────────────────────────────────────────

describe("renderBase: sort", () => {
  it("single key ASC", () => {
    const ctx = mkContext([
      { path: "Heavy.md", fm: { weight: 9 } },
      { path: "Light.md", fm: { weight: 1 } },
      { path: "Medium.md", fm: { weight: 5 } },
    ]);
    const html = renderBase(
      `views:\n  - type: table\n    sort:\n      - column: note.weight\n        direction: ASC`,
      ctx,
    );
    assert.deepEqual(tableTitles(html), ["Light", "Medium", "Heavy"]);
  });

  it("single key DESC", () => {
    const ctx = mkContext([
      { path: "Heavy.md", fm: { weight: 9 } },
      { path: "Light.md", fm: { weight: 1 } },
      { path: "Medium.md", fm: { weight: 5 } },
    ]);
    const html = renderBase(
      `views:\n  - type: table\n    sort:\n      - column: note.weight\n        direction: DESC`,
      ctx,
    );
    assert.deepEqual(tableTitles(html), ["Heavy", "Medium", "Light"]);
  });

  it("multi-key uses later entries to break ties", () => {
    const ctx = mkContext([
      { path: "Apple.md", fm: { tier: 1 } },
      { path: "Cherry.md", fm: { tier: 1 } },
      { path: "Banana.md", fm: { tier: 1 } },
      { path: "Zebra.md", fm: { tier: 2 } },
    ]);
    const html = renderBase(
      `views:\n  - type: table\n    sort:\n      - column: note.tier\n        direction: ASC\n      - column: file.name\n        direction: ASC`,
      ctx,
    );
    assert.deepEqual(tableTitles(html), ["Apple", "Banana", "Cherry", "Zebra"]);
  });

  it("sort by formula", () => {
    const ctx = mkContext([
      { path: "Short.md", fm: { name: "ab" } },
      { path: "Long.md", fm: { name: "abcdefgh" } },
      { path: "Mid.md", fm: { name: "abcd" } },
    ]);
    const html = renderBase(
      `formulas:\n  len: 'name.length'\nviews:\n  - type: table\n    sort:\n      - column: formula.len\n        direction: ASC`,
      ctx,
    );
    assert.deepEqual(tableTitles(html), ["Short", "Mid", "Long"]);
  });
});

// ── Formulas ───────────────────────────────────────────────────────────────

describe("renderBase: formulas", () => {
  it("evaluates a simple formula and renders it as a column value", () => {
    const ctx = mkContext([
      { path: "A.md", fm: { first: "Aldric", last: "Stone" } },
    ]);
    const html = renderBase(
      `formulas:\n  full: 'first + " " + last'\nviews:\n  - type: table\n    order:\n      - file.name\n      - formula.full`,
      ctx,
    );
    assert.match(html, /Aldric Stone/);
  });

  it("formula referencing another formula resolves transitively", () => {
    const ctx = mkContext([
      { path: "A.md", fm: { x: 3 } },
    ]);
    const html = renderBase(
      `formulas:\n  doubled: 'x * 2'\n  quadrupled: 'formula.doubled * 2'\nviews:\n  - type: table\n    order:\n      - file.name\n      - formula.quadrupled`,
      ctx,
    );
    // 3 * 2 * 2 = 12
    assert.match(html, /\b12\b/);
  });

  it("cycle between formulas is reported inline (does not crash the build)", () => {
    const ctx = mkContext([{ path: "A.md" }]);
    const html = renderBase(
      `formulas:\n  a: 'formula.b'\n  b: 'formula.a'\nviews:\n  - type: table\n    order: [file.name, formula.a]`,
      ctx,
    );
    assert.match(html, /bases-error/);
    assert.match(html, /[Ff]ormula cycle/);
  });

  it("malformed formula expression raises an inline error", () => {
    const ctx = mkContext([{ path: "A.md" }]);
    const html = renderBase(
      `formulas:\n  bad: '+ + +'\nviews:\n  - type: table\n    order: [file.name, formula.bad]`,
      ctx,
    );
    assert.match(html, /bases-error/);
  });

  it("formula referenced from filters passes/fails accordingly", () => {
    const ctx = mkContext([
      { path: "A.md", fm: { x: 5 } },
      { path: "B.md", fm: { x: 12 } },
      { path: "C.md", fm: { x: 20 } },
    ]);
    const html = renderBase(
      `formulas:\n  big: 'x > 10'\nfilters: 'formula.big'`,
      ctx,
    );
    assert.deepEqual(tableTitles(html).sort(), ["B", "C"]);
  });
});

// ── Views: table ───────────────────────────────────────────────────────────

describe("renderBase: table view", () => {
  it("emits header cells for each column in `order`", () => {
    const ctx = mkContext([{ path: "A.md", fm: { weight: 1 } }]);
    const html = renderBase(
      `properties:\n  note.weight: { displayName: Weight }\nviews:\n  - type: table\n    order:\n      - file.name\n      - note.weight`,
      ctx,
    );
    assert.match(html, /<th[^>]*>Name<\/th>/);
    assert.match(html, /<th[^>]*>Weight<\/th>/);
  });

  it("respects view.limit", () => {
    const ctx = mkContext([
      { path: "A.md" }, { path: "B.md" }, { path: "C.md" },
      { path: "D.md" }, { path: "E.md" },
    ]);
    const html = renderBase(`views:\n  - type: table\n    limit: 2`, ctx);
    assert.equal(countTableRows(html), 2);
  });

  it("per-view filter narrows beyond the document-level filter", () => {
    const ctx = mkContext([
      { path: "Items/Sword.md", fm: { rarity: "common" } },
      { path: "Items/Excalibur.md", fm: { rarity: "legendary" } },
      { path: "Notes/Foo.md", fm: { rarity: "legendary" } },
    ]);
    const html = renderBase(
      `filters: 'file.inFolder("Items")'\nviews:\n  - type: table\n    filters: 'rarity == "legendary"'`,
      ctx,
    );
    assert.deepEqual(tableTitles(html), ["Excalibur"]);
  });
});

// ── Views: cards ───────────────────────────────────────────────────────────

describe("renderBase: cards view", () => {
  it("renders one card per row with a link to the page", () => {
    const ctx = mkContext([{ path: "A.md" }, { path: "B.md" }]);
    const html = renderBase(`views: [{ type: cards }]`, ctx);
    assert.deepEqual(cardTitles(html).sort(), ["A", "B"]);
    assert.match(html, /href="\/A"/);
    assert.match(html, /href="\/B"/);
  });

  it("uses view.image as the cover when a frontmatter property is named", () => {
    const ctx = mkContext(
      [{ path: "Hero.md", fm: { portrait: "hero.webp" } }],
      [{ source: "hero.webp", output: "hero.webp" }],
    );
    const html = renderBase(
      `views:\n  - type: cards\n    image: portrait`,
      ctx,
    );
    assert.match(html, /<img src="\/hero\.webp"/);
  });

  it("falls back to the first body image embed when no view.image is set", () => {
    const ctx = mkContext(
      [{ path: "Hero.md", body: "Some text\n![[hero.webp]]\nMore text." }],
      [{ source: "hero.webp", output: "hero.webp" }],
    );
    const html = renderBase(`views: [{ type: cards }]`, ctx);
    assert.match(html, /<img src="\/hero\.webp"/);
  });

  it("renders no cover element when no image source is found", () => {
    const ctx = mkContext([{ path: "Plain.md", body: "no images here" }]);
    const html = renderBase(`views: [{ type: cards }]`, ctx);
    assert.doesNotMatch(html, /bases-card-cover/);
  });

  it("imageFit: contain emits the contain class", () => {
    const ctx = mkContext(
      [{ path: "Hero.md", fm: { portrait: "hero.webp" } }],
      [{ source: "hero.webp" }],
    );
    const html = renderBase(
      `views:\n  - type: cards\n    image: portrait\n    imageFit: contain`,
      ctx,
    );
    assert.match(html, /bases-card-cover-contain/);
  });
});

// ── Views: list ────────────────────────────────────────────────────────────

describe("renderBase: list view", () => {
  it("renders one li per row, sorted by the spec", () => {
    const ctx = mkContext([
      { path: "C.md" },
      { path: "A.md" },
      { path: "B.md" },
    ]);
    const html = renderBase(`views: [{ type: list }]`, ctx);
    assert.deepEqual(listTitles(html), ["A", "B", "C"]);
  });

  it("renders meta fields after the title from `order`", () => {
    const ctx = mkContext([
      { path: "A.md", fm: { weight: 3 } },
    ]);
    const html = renderBase(
      `views:\n  - type: list\n    order: [file.name, note.weight]`,
      ctx,
    );
    assert.match(html, /class="bases-list-meta"[^>]*>3</);
  });
});

// ── Embedded view name (![[Foo#ViewName]]) ─────────────────────────────────

describe("renderBase: viewName scoping", () => {
  it("renders only the matching view when viewName is given", () => {
    const ctx = mkContext([{ path: "A.md" }, { path: "B.md" }]);
    const yaml = `views:\n  - type: table\n    name: Tab\n  - type: list\n    name: Lst`;
    const onlyTable = renderBase(yaml, ctx, undefined, "Tab");
    const onlyList = renderBase(yaml, ctx, undefined, "Lst");
    assert.match(onlyTable, /bases-table/);
    assert.doesNotMatch(onlyTable, /bases-list-block/);
    assert.match(onlyList, /bases-list-block/);
    assert.doesNotMatch(onlyList, /bases-table/);
  });

  it("returns an error block when the named view does not exist", () => {
    const ctx = mkContext([{ path: "A.md" }]);
    const html = renderBase(
      `views: [{ type: table, name: Tab }]`,
      ctx,
      undefined,
      "Missing",
    );
    assert.match(html, /bases-error/);
    assert.match(html, /no view named/);
  });
});

// ── Unknown view types ─────────────────────────────────────────────────────

describe("renderBase: unsupported view types", () => {
  it("emits an error block but still renders the supported views around it", () => {
    const ctx = mkContext([{ path: "A.md" }]);
    const html = renderBase(
      `views:\n  - type: kanban\n  - type: table`,
      ctx,
    );
    assert.match(html, /bases-error/);
    assert.match(html, /not supported/);
    // The valid view should still be present.
    assert.match(html, /bases-table/);
  });
});
