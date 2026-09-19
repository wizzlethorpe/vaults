// Where the add-on's migrations sit among core's.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listMigrations } from "../../cli/src/migrate/run.js";

describe("the add-on's migrations", () => {
  it("run after core's", async () => {
    // 0.23 reads .vaults/settings.yaml, which 0.22 writes. Run first, it finds nothing and settles for good.
    assert.deepEqual((await listMigrations()).map((m) => m.id), [
      "0.7-vaults-dir", "0.22-settings-yaml",
      "0.15-foundry-patch-keys", "0.15-foundry-pinned-id", "0.23-foundry-enabled",
    ]);
  });
});
