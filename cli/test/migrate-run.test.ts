// The migration runner's settled record.
//
// needs() may read the whole vault to answer, and the two 0.15 migrations do.
// Recording what has settled turns that from a permanent per-command cost into
// a one-time scan — and the record is also load-bearing for correctness: a key
// written back in the old spelling after migration is somebody's deliberate
// choice, not a vault to rewrite again behind their back.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../src/migrate/run.js";

const OLD_STYLE = "---\nfoundry:\n  base: Scene\n---\n\nHi.\n";

async function vault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vaults-migrate-"));
  await mkdir(join(dir, "Pages"));
  await writeFile(join(dir, "Pages", "A.md"), OLD_STYLE);
  return dir;
}

describe("runMigrations settled record", () => {
  it("records what ran, and does not run it again", async () => {
    const dir = await vault();
    const first = await runMigrations(dir, { silent: true });
    assert.ok(first.applied.includes("0.15-foundry-patch-keys"), first.applied.join());
    const marker = JSON.parse(await readFile(join(dir, ".vaults", "migrations.json"), "utf8"));
    assert.ok(marker.includes("0.15-foundry-patch-keys"));

    // The old spelling written back is a choice, not a vault to rewrite again.
    await writeFile(join(dir, "Pages", "A.md"), OLD_STYLE);
    const second = await runMigrations(dir, { silent: true });
    assert.deepEqual(second.applied, []);
    assert.equal(await readFile(join(dir, "Pages", "A.md"), "utf8"), OLD_STYLE);
  });

  it("`only` ignores the record, so a migration can be forced by hand", async () => {
    const dir = await vault();
    await runMigrations(dir, { silent: true });
    await writeFile(join(dir, "Pages", "A.md"), OLD_STYLE);
    const forced = await runMigrations(dir, { silent: true, only: "0.15-foundry-patch-keys" });
    assert.deepEqual(forced.applied, ["0.15-foundry-patch-keys"]);
    assert.match(await readFile(join(dir, "Pages", "A.md"), "utf8"), /source: Scene/);
  });

  it("a dry run records nothing", async () => {
    const dir = await vault();
    const dry = await runMigrations(dir, { silent: true, dryRun: true });
    assert.ok(dry.applied.length > 0);
    await assert.rejects(() => readFile(join(dir, ".vaults", "migrations.json"), "utf8"));
    const real = await runMigrations(dir, { silent: true });
    assert.ok(real.applied.includes("0.15-foundry-patch-keys"), "still runs for real");
  });
});
