// A bases block as a Foundry journal page carries it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderBase } from "../../cli/src/render/bases.js";
import { journalBody } from "../src/foundry-html.js";
import { mkContext } from "../../cli/test/bases-helpers.js";

describe("renderBase: in a Foundry journal", () => {
  it("keeps the tab strip on the wiki and leaves it out of a journal", () => {
    const ctx = mkContext([{ path: "A.md" }]);
    const html = renderBase("views:\n  - type: table\n    name: One\n  - type: list\n    name: Two\n", ctx);
    assert.match(html, /bases-tab-strip/);
    assert.doesNotMatch(journalBody(html, { secretRoles: new Set(), css: "" }), /bases-tab-strip/);
  });
});
