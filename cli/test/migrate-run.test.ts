// The migration runner's settled record.
//
// needs() may read the whole vault to answer. Recording what has settled turns that from a permanent per-command cost into a one-time scan.
// The record is also load-bearing for correctness: a file written back in the old form after migration is somebody's deliberate choice, not a vault to rewrite again behind their back.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../src/migrate/run.js";
import type { Migration } from "../src/migrate/types.js";

/** Needed whenever the page says "old", which a settled vault can come to say again. */
const respell: Migration = {
  id: "test-respell",
  description: "old -> new",
  needs: async (dir) => (await readFile(join(dir, "A.md"), "utf8")) === "old",
  apply: (dir) => writeFile(join(dir, "A.md"), "new"),
};
const opts = { silent: true, migrations: [respell] };

async function vault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vaults-migrate-"));
  await writeFile(join(dir, "A.md"), "old");
  return dir;
}

describe("runMigrations settled record", () => {
  it("records what ran, and does not run it again", async () => {
    const dir = await vault();
    assert.deepEqual((await runMigrations(dir, opts)).applied, ["test-respell"]);
    assert.deepEqual(JSON.parse(await readFile(join(dir, ".vaults", "migrations.json"), "utf8")), ["test-respell"]);

    // The old form written back is a choice, not a vault to rewrite again.
    await writeFile(join(dir, "A.md"), "old");
    assert.deepEqual((await runMigrations(dir, opts)).applied, []);
    assert.equal(await readFile(join(dir, "A.md"), "utf8"), "old");
  });

  it("`only` ignores the record, so a migration can be forced by hand", async () => {
    const dir = await vault();
    await runMigrations(dir, opts);
    await writeFile(join(dir, "A.md"), "old");
    assert.deepEqual((await runMigrations(dir, { ...opts, only: "test-respell" })).applied, ["test-respell"]);
    assert.equal(await readFile(join(dir, "A.md"), "utf8"), "new");
  });

  it("a dry run records nothing", async () => {
    const dir = await vault();
    assert.deepEqual((await runMigrations(dir, { ...opts, dryRun: true })).applied, ["test-respell"]);
    await assert.rejects(() => readFile(join(dir, ".vaults", "migrations.json"), "utf8"));
    assert.deepEqual((await runMigrations(dir, opts)).applied, ["test-respell"], "still runs for real");
  });
});
