// A file Cloudflare Pages refuses fails the push, so the build refuses it first.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertDeployable } from "../src/foundry-build.js";
import { PAGES_FILE_BYTES } from "../src/settings.js";

describe("assertDeployable", () => {
  it("refuses a file larger than Pages deploys, naming it and its size", () => {
    assert.throws(() => assertDeployable("dm's grafts.json", PAGES_FILE_BYTES + 1),
      new RegExp(`dm's grafts\\.json is ${PAGES_FILE_BYTES + 1} bytes`));
    assert.doesNotThrow(() => assertDeployable("dm's grafts.json", PAGES_FILE_BYTES));
  });
});
